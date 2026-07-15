import {
    notifyDetectMagicScanApplied,
    notifyDetectMagicScanCleared
} from "../../../services/crafting/detectMagic/DetectMagicInventoryGlowBridge.js";
import {
    emitDetectMagicScanBroadcast,
    emitDetectMagicScanCleared
} from "../../../services/socket/SocketController.js";
import { getPartyActors } from "../../../services/party/partyActors.js";

/** Measured templates from rest-scan casts are removed after this delay (ms). */
const DETECT_MAGIC_TEMPLATE_CLEANUP_MS = 5000;

const pendingTemplateCleanupTimers = new Set();

const trackedDetectMagicTemplateUuids = new Set();

/** Wizard class (Ritual Adept: ritual from spellbook unprepared, PHB 2024 p.115). */
function actorIsWizard(actor) {
    if (actor.classes?.wizard) return true;
    return !!(actor.items?.find(i2 => i2.type === "class" && i2.name?.toLowerCase() === "wizard"));
}

/**
 * Cantrip / prepared / always / innate, or Wizard ritual-from-spellbook (PHB p.115).
 * Ritual Caster feat uses mode "always"; no separate branch.
 */
function actorHasNamedSpellAccess(actor, spellNameLower) {
    if (!actor?.items) return false;
    for (const i of actor.items) {
        if (i.type !== "spell") continue;
        if (i.name?.toLowerCase() !== spellNameLower) continue;
        const level = i.system?.level ?? 0;
        if (level === 0) return true;

        // properties Set (modern) or components.ritual (legacy)
        const isRitual = (i.system?.properties instanceof Set && i.system.properties.has("ritual"))
            || i.system?.properties?.ritual === true
            || i.system?.components?.ritual === true;
        if (isRitual && actorIsWizard(actor)) return true;

        // Prefer dnd5e 5.1+ method/prepared; avoid deprecated preparation getter.
        let mode, isPrepared;
        if (i.system !== null && "method" in i.system) {
            mode = i.system.method;
            isPrepared = i.system.prepared;
        } else {
            const prep = i.system?.preparation;
            mode = prep?.mode;
            isPrepared = prep?.prepared;
        }

        if (mode === "innate" || mode === "always") return true;
        if (isPrepared === true) return true;
    }
    return false;
}

/**
 * @returns {Set<string>}
 */
function snapshotSceneTemplateIds() {
    const ids = new Set();
    for (const doc of canvas.scene?.templates?.contents ?? []) {
        if (doc?.id) ids.add(doc.id);
    }
    return ids;
}

/**
 * @param {string} uuid
 * @returns {Promise<void>}
 */
async function deleteMeasuredTemplateUuid(uuid) {
    if (!uuid) return;
    try {
        const doc = typeof fromUuid === "function" ? await fromUuid(uuid) : null;
        if (doc?.documentName !== "MeasuredTemplate") return;
        if (doc.canUser?.("DELETE", game.user) || game.user?.isGM) {
            await doc.delete();
        }
    } catch {
    // Non-fatal: template may already be gone or owned by another client.
    }
}

/**
 * @param {string[]} templateUuids
 * @param {number} delayMs
 */
function scheduleDetectMagicTemplateCleanup(templateUuids, delayMs = DETECT_MAGIC_TEMPLATE_CLEANUP_MS) {
    for (const uuid of templateUuids ?? []) {
        if (!uuid) continue;
        trackedDetectMagicTemplateUuids.add(uuid);
    }
    if (!templateUuids?.length) return;

    const timerId = setTimeout(() => {
        pendingTemplateCleanupTimers.delete(timerId);
        for (const uuid of templateUuids) {
            trackedDetectMagicTemplateUuids.delete(uuid);
            void deleteMeasuredTemplateUuid(uuid);
        }
    }, delayMs);
    pendingTemplateCleanupTimers.add(timerId);
}

export function cancelPendingDetectMagicTemplateCleanups() {
    for (const timerId of pendingTemplateCleanupTimers) clearTimeout(timerId);
    pendingTemplateCleanupTimers.clear();
}

/**
 * @param {ActiveEffect} effect
 * @returns {boolean}
 */
function isDetectMagicRestEffect(effect) {
    if (!effect) return false;
    const name = (effect.name ?? "").toLowerCase();
    if (name.includes("detect magic")) return true;

    const flagItem = effect.flags?.dnd5e?.item;
    const flaggedName = flagItem?.data?.name ?? flagItem?.name ?? "";
    if (flaggedName.toLowerCase() === "detect magic") return true;

    if (typeof fromUuidSync === "function" && effect.origin) {
        try {
            const origin = fromUuidSync(effect.origin);
            if (origin?.name?.toLowerCase() === "detect magic") return true;
        } catch {
            // ignore bad origin uuid
        }
    }
    return false;
}

/**
 * @param {Actor[]} actors
 * @returns {Promise<void>}
 */
async function purgeTrackedDetectMagicTemplates() {
    const uuids = [...trackedDetectMagicTemplateUuids];
    trackedDetectMagicTemplateUuids.clear();
    cancelPendingDetectMagicTemplateCleanups();
    await Promise.allSettled(uuids.map(uuid => deleteMeasuredTemplateUuid(uuid)));
}

/** Rest/workbench scan cast: no slot, no concentration. */
async function castDetectMagicForRestScan(spellItem) {
    if (!spellItem?.isOwner) return;

    const usage = {
        scaling: false,
        consume: false,
        concentration: { begin: false },
        midiOptions: {
            configureDialog: false,
            workflowOptions: {
                autoConsumeResource: "none",
                noConcentrationCheck: true
            }
        }
    };
    const dialog = { configure: false };
    const message = { create: true };

    const templateIdsBefore = snapshotSceneTemplateIds();
    const capturedTemplateUuids = new Set();
    const onPostUseActivity = (activity, _usageConfig, results) => {
        if (activity.item?.name?.toLowerCase() !== "detect magic") return;
        for (const templateDoc of results?.templates ?? []) {
            const uuid = templateDoc?.uuid ?? templateDoc?.document?.uuid;
            if (uuid) capturedTemplateUuids.add(uuid);
        }
    };
    const postUseHookId = Hooks.on("dnd5e.postUseActivity", onPostUseActivity);

    try {
        const midi = globalThis.MidiQOL;
        let workflow;
        if (midi?.completeItemUse) {
            workflow = await midi.completeItemUse(spellItem, usage, dialog, message);
        } else if (typeof spellItem.use === "function") {
            await spellItem.use(usage, dialog, message);
        }
        for (const uuid of workflow?.templateUuids ?? []) {
            if (uuid) capturedTemplateUuids.add(uuid);
        }

        await new Promise(resolve => setTimeout(resolve, 300));
        for (const doc of canvas.scene?.templates?.contents ?? []) {
            if (doc?.id && !templateIdsBefore.has(doc.id) && doc.uuid) {
                capturedTemplateUuids.add(doc.uuid);
            }
        }
    } finally {
        Hooks.off("dnd5e.postUseActivity", postUseHookId);
    }

    scheduleDetectMagicTemplateCleanup([...capturedTemplateUuids]);
}

export async function purgeDetectMagicRestArtifacts(actors) {
    await purgeTrackedDetectMagicTemplates();
    await purgeDetectMagicEffects(actors);
}

/**
 * @param {Actor[]} partyActors
 * @param {{ restrictUnidentifiedToActorId?: string|null }} [options]
 * @returns {{
 *   unidentifiedItems: object[],
 *   identifyCasters: { id: string, name: string }[],
 *   detectMagicCasters: { id: string, name: string }[]
 * }}
 */
export function collectPartyIdentifyEmbedData(partyActors, options = {}) {
    const restrictUnidentifiedActorId = options.restrictUnidentifiedToActorId ?? null;
    const unidentifiedItems = [];
    const identifyCasters = [];
    const detectMagicCasters = [];
    for (const a of partyActors) {
        if (!restrictUnidentifiedActorId || a.id === restrictUnidentifiedActorId) {
            for (const item of a.items ?? []) {
                if (item.system?.identified === false) {
                    const hasUnidentifiedData = !!(item.system?.unidentified?.name || item.system?.unidentified?.description);
                    const isPotion = item.type === "consumable" && item.system?.type?.value === "potion";
                    const rawRarity = (item.system?.rarity ?? "common").replace(/\s+(\w)/g, (_, c) => c.toUpperCase());
                    unidentifiedItems.push({
                        itemId: item.id,
                        actorId: a.id,
                        actorName: a.name,
                        name: item.system?.unidentified?.name || item.name || "Unknown Item",
                        img: item.img || "icons/svg/mystery-man.svg",
                        rarity: rawRarity,
                        rarityLabel: rawRarity.replace(/([A-Z])/g, " $1").replace(/^./, c => c.toUpperCase()).trim(),
                        type: item.type,
                        isPotion,
                        hasUnidentifiedData,
                        requiresAttunement: (att => att === "required" || att === 1)(item.system?.attunement),
                        identified: false
                    });
                }
            }
        }
        if (actorHasNamedSpellAccess(a, "identify")) {
            identifyCasters.push({ id: a.id, name: a.name });
        }
        if (actorHasNamedSpellAccess(a, "detect magic")) {
            detectMagicCasters.push({ id: a.id, name: a.name });
        }
    }
    return { unidentifiedItems, identifyCasters, detectMagicCasters };
}

/** GM always; players only with an owned Detect Magic caster. */
export function computeCanTriggerDetectMagicScan(partyActors) {
    if (game.user?.isGM) return true;
    const { detectMagicCasters } = collectPartyIdentifyEmbedData(partyActors);
    if (!detectMagicCasters.length) return false;
    const ids = new Set(detectMagicCasters.map(c => c.id));
    return partyActors.some(a => ids.has(a.id) && a.isOwner);
}

/** GM always; players only when a controllable caster exists. */
export function computeCanShowDetectMagicScanButton(partyActors) {
    if (game.user?.isGM) return true;
    return computeCanTriggerDetectMagicScan(partyActors);
}

/** Player tooltip for scan access; null for GM or no access. */
export function getDetectMagicPlayerAccessReason(partyActors) {
    if (game.user?.isGM) return null;
    for (const actor of partyActors) {
        if (!actor.isOwner) continue;
        for (const item of actor.items ?? []) {
            if (item.type !== "spell") continue;
            if (item.name?.toLowerCase() !== "detect magic") continue;
            const level = item.system?.level ?? 0;
            if (level === 0) {
                return `${actor.name} has Detect Magic as a cantrip.`;
            }
            const isRitual = (item.system?.properties instanceof Set && item.system.properties.has("ritual"))
                || item.system?.properties?.ritual === true
                || item.system?.components?.ritual === true;
            // Ritual Adept: Wizard may cast from spellbook unprepared.
            if (isRitual && actorIsWizard(actor)) {
                return `${actor.name} can cast Detect Magic as a ritual (Wizard – Ritual Adept, PHB p.115).`;
            }
            let mode, isPrepared;
            if (item.system !== null && "method" in item.system) {
                mode = item.system.method;
                isPrepared = item.system.prepared;
            } else {
                const prep = item.system?.preparation;
                mode = prep?.mode;
                isPrepared = prep?.prepared;
            }
            if (mode === "innate") return `${actor.name} can cast Detect Magic innately.`;
            // mode="always" covers Ritual Caster feat (PHB p.204) and similar always-prepared sources.
            if (mode === "always") return `${actor.name} always has Detect Magic available (Ritual Caster or similar, PHB p.204).`;
            if (isPrepared === true && isRitual) return `${actor.name} has Detect Magic prepared with the Ritual tag; can cast as a ritual.`;
            if (isPrepared === true) return `${actor.name} has Detect Magic prepared.`;
        }
    }
    return null;
}

/** @param {Actor[]} actors */
export async function purgeDetectMagicEffects(actors) {
    const toDelete = [];
    for (const actor of actors ?? []) {
        const spellItem = actor.items?.find(
            i => i.type === "spell" && i.name?.toLowerCase() === "detect magic"
        );
        if (spellItem && typeof actor.endConcentration === "function") {
            try {
                await actor.endConcentration(spellItem);
            } catch {
                // Non-fatal: concentration may already be cleared.
            }
        }
        for (const effect of actor.effects ?? []) {
            if (isDetectMagicRestEffect(effect)) toDelete.push(effect);
        }
    }
    if (!toDelete.length) return;
    await Promise.allSettled(toDelete.map(e => e.delete().catch(err =>
        console.warn(`[Respite] Failed to delete Detect Magic effect on ${e.parent?.name}:`, err)
    )));
}

/** Ripples on document.body so they survive app re-render. */
export function spawnDetectMagicCastRipple(element) {
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    for (let i = 0; i < 3; i++) {
        const ring = document.createElement("span");
        ring.className = "dm-cast-ripple";
        ring.style.left = `${cx}px`;
        ring.style.top = `${cy}px`;
        ring.style.animationDelay = `${i * 130}ms`;
        document.body.appendChild(ring);
        ring.addEventListener("animationend", () => ring.remove(), { once: true });
    }
}

export class DetectMagicDelegate {

    constructor(app) {
        this._app = app;
    }

    get scanResults() { return this._app._magicScanResults; }

    get scanComplete() { return !!this._app._magicScanComplete; }

    clearScanSession(opts = {}) {
        const skipSave = !!opts.skipSave;
        void purgeDetectMagicRestArtifacts(this._resolvePartyActors());
        this._app._magicScanResults = null;
        this._app._magicScanComplete = false;
        this._app._workbench?.clearAll();
    notifyDetectMagicScanCleared();
        if (game.user?.isGM) {
            emitDetectMagicScanCleared();
            if (!skipSave) {
                if (this._app._engine && typeof this._app._saveRestState === "function") {
                    void this._app._saveRestState();
                } else if (typeof this._app._saveShortRestState === "function") {
                    void this._app._saveShortRestState();
                }
            }
        }
    }

    /** Requires `_magicScanResults` / `_magicScanComplete` already set. */
    broadcastPartyScan(getPartyActors) {
        if (!this._app._magicScanComplete) return;
        const partyActorIds = getPartyActors().map(a => a.id);
        emitDetectMagicScanBroadcast({
            results: this._app._magicScanResults ?? [],
            partyActorIds,
            magicScanComplete: true
        });
        notifyDetectMagicScanApplied(this._app, partyActorIds);
        if (game.user.isGM) {
            if (this._app._engine && typeof this._app._saveRestState === "function") {
                void this._app._saveRestState();
            } else if (typeof this._app._saveShortRestState === "function") {
                void this._app._saveShortRestState();
            }
        }
    }

    _resolvePartyActors() {
        if (typeof this._app._getPartyActorsForRest === "function") {
            return this._app._getPartyActorsForRest();
        }
        return getPartyActors();
    }

    async cleanupCastArtifactsOnPhaseExit(partyActors, opts = {}) {
        const clearUi = opts.clearUi !== false;
        await purgeDetectMagicRestArtifacts(partyActors);
        if (!clearUi || !this.scanComplete) return;
        this._app._magicScanResults = null;
        this._app._magicScanComplete = false;
    notifyDetectMagicScanCleared();
    }

    async runScan(getPartyActors) {
        const party = getPartyActors();
        if (!game.user?.isGM && !computeCanTriggerDetectMagicScan(party)) {
            const { detectMagicCasters } = collectPartyIdentifyEmbedData(party);
            ui.notifications.warn(
                detectMagicCasters.length
                    ? "You need a party member with Detect Magic who you control to run the scan."
                    : "Nobody in the party has Detect Magic available to cast."
            );
            return;
        }

    // Players: invoke the spell on their character so animations and SFX fire normally.
        if (!game.user?.isGM) {
            const caster = party.find(a => a.isOwner && actorHasNamedSpellAccess(a, "detect magic"));
            if (caster) {
                const spellItem = caster.items.find(
                    i => i.type === "spell" && i.name?.toLowerCase() === "detect magic"
                );
                if (spellItem) {
                    try {
                        await castDetectMagicForRestScan(spellItem);
                    } catch {
                        // Non-fatal: proceed to scan even if the item use flow fails.
                    }
                }
            }
        }

        const { DetectMagicScanner } = await import("../../../services/crafting/detectMagic/DetectMagicScanner.js");
        const actorIds = party.map(a => a.id);
        const results = DetectMagicScanner.scanParty(actorIds);
        this._app._magicScanResults = results;
        this._app._magicScanComplete = true;
        if (results.length === 0) {
            ui.notifications.info("No unidentified magical items detected among the party's gear.");
        }
        this._app.render();
        this.broadcastPartyScan(getPartyActors);
    }

        async identifyScannedItem(actorId, itemId, getPartyActors) {
        if (!game.user.isGM) return;
        try {
            const { DetectMagicScanner } = await import("../../../services/crafting/detectMagic/DetectMagicScanner.js");
            const result = await DetectMagicScanner.identifyItem(actorId, itemId);
            if (this._app._magicScanResults) {
                for (const actorResult of this._app._magicScanResults) {
                    if (actorResult.actorId === actorId) {
                        const item = actorResult.items.find(i => i.itemId === itemId);
                        if (item) {
                            item.identified = true;
                            item.trueName = result.trueName;
                            item.requiresAttunement = result.requiresAttunement;
                        }
                    }
                }
            }
            ui.notifications.info(`Identified: ${result.trueName} (${DetectMagicScanner.schoolLabel(result.school)})`);
            this._app.render();
            this.broadcastPartyScan(getPartyActors);
        } catch (e) {
            console.error(`[Respite] Failed to identify item:`, e);
            ui.notifications.error(`Failed to identify item: ${e.message}`);
        }
    }
}
