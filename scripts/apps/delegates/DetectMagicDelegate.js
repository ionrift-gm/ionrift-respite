/**
 * DetectMagicDelegate.js
 * Handles Detect Magic party scan, scanned-item identification, scan state
 * management, and glow bridge notifications during the Activity phase.
 *
 * Extracted from RestSetupApp to reduce God Class complexity (Milestone 1.8).
 * Follows the established delegate pattern (see WorkbenchDelegate.js).
 */

import {
    notifyDetectMagicScanApplied,
    notifyDetectMagicScanCleared
} from "../../services/DetectMagicInventoryGlowBridge.js";
import {
    emitDetectMagicScanBroadcast,
    emitDetectMagicScanCleared
} from "../../services/SocketController.js";
import { getPartyActors } from "../../services/partyActors.js";

/** Measured templates from rest-scan casts are removed after this delay (ms). */
const DETECT_MAGIC_TEMPLATE_CLEANUP_MS = 5000;

/** @type {Set<number>} */
const pendingTemplateCleanupTimers = new Set();

/** @type {Set<string>} */
const trackedDetectMagicTemplateUuids = new Set();

// ── Free-function helpers (copied from RSA module scope) ────────────────────

/**
 * Whether an actor is a Wizard (Ritual Adept class feature).
 * Wizards can ritual-cast any Ritual-tagged spell directly from their spellbook
 * without having it prepared (PHB 2024 p.115).
 * @param {Actor} actor
 * @returns {boolean}
 */
function actorIsWizard(actor) {
    // dnd5e 3+: actor.classes is a keyed object of class items
    if (actor.classes?.wizard) return true;
    // Fallback: scan items for a class named "wizard"
    return !!(actor.items?.find(i2 => i2.type === "class" && i2.name?.toLowerCase() === "wizard"));
}

/**
 * Whether an actor can cast a named spell from their sheet
 * (dnd5e: cantrips, prepared, always, innate, or Wizard ritual-from-spellbook).
 *
 * PHB 2024 p.234 — Ritual tag: you can cast a ritual spell without expending a
 * spell slot, but ONLY if the spell is prepared. Exception: Wizards with the
 * Ritual Adept class feature (PHB p.115) can ritual-cast any Ritual-tagged spell
 * directly from their spellbook without preparation. The Ritual Caster feat
 * (PHB p.204) grants its spells as "always prepared" (mode="always"), which is
 * already caught by the mode check below — no special case needed.
 *
 * @param {Actor} actor
 * @param {string} spellNameLower
 * @returns {boolean}
 */
function actorHasNamedSpellAccess(actor, spellNameLower) {
    if (!actor?.items) return false;
    for (const i of actor.items) {
        if (i.type !== "spell") continue;
        if (i.name?.toLowerCase() !== spellNameLower) continue;
        const level = i.system?.level ?? 0;
        if (level === 0) return true;

        // PHB 2024 p.234 + p.115: Ritual Adept (Wizard only) — can cast ritual
        // spells from spellbook without preparation.
        // Modern dnd5e: system.properties is a Set; legacy: system.components.ritual.
        const isRitual = (i.system?.properties instanceof Set && i.system.properties.has("ritual"))
            || i.system?.properties?.ritual === true
            || i.system?.components?.ritual === true;
        if (isRitual && actorIsWizard(actor)) return true;
        // Non-Wizards with a ritual-tagged spell still need it prepared — that
        // is caught by the isPrepared check below (Ritual Caster feat sets
        // preparation mode to "always", so it also passes through).

        // dnd5e 5.1+ renamed preparation.mode → system.method
        //                      preparation.prepared → system.prepared
        // Check for the new API first so we never touch the deprecated getter.
        let mode, isPrepared;
        if (i.system !== null && "method" in i.system) {
            mode = i.system.method;       // dnd5e 5.1+
            isPrepared = i.system.prepared; // dnd5e 5.1+
        } else {
            const prep = i.system?.preparation; // legacy dnd5e
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

/**
 * Cast Detect Magic for the rest/workbench scan without slot use or concentration.
 * dnd5e v4 expects usage/dialog/message; legacy configureDialog on item.use is ignored.
 * @param {Item5e} spellItem
 * @returns {Promise<void>}
 */
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

/**
 * Removes Detect Magic templates and active effects applied during a rest scan.
 * @param {Actor[]} actors
 * @returns {Promise<void>}
 */
export async function purgeDetectMagicRestArtifacts(actors) {
    await purgeTrackedDetectMagicTemplates();
    await purgeDetectMagicEffects(actors);
}

/**
 * Party unidentified items plus ritual Identify vs Detect Magic casters.
 * Used by the rest UI and workbench station.
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

/**
 * Scan trigger check: GM always (party-wide narrative scan); players only when they
 * own a party member with Detect Magic available (ritual, prepared, cantrip, etc.).
 * @param {Actor[]} partyActors
 * @returns {boolean}
 */
export function computeCanTriggerDetectMagicScan(partyActors) {
    if (game.user?.isGM) return true;
    const { detectMagicCasters } = collectPartyIdentifyEmbedData(partyActors);
    if (!detectMagicCasters.length) return false;
    const ids = new Set(detectMagicCasters.map(c => c.id));
    return partyActors.some(a => ids.has(a.id) && a.isOwner);
}

/**
 * Toolbar visibility: GM always; players only when a controllable caster exists.
 * @param {Actor[]} partyActors
 * @returns {boolean}
 */
export function computeCanShowDetectMagicScanButton(partyActors) {
    if (game.user?.isGM) return true;
    return computeCanTriggerDetectMagicScan(partyActors);
}

/**
 * Returns a human-readable tooltip string explaining why this player can
 * trigger the Detect Magic scan, e.g. "Lyra has Detect Magic as a cantrip."
 * Returns null for GMs (they have their own static title) and for players
 * with no access.
 * @param {Actor[]} partyActors
 * @returns {string|null}
 */
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
            // PHB 2024 p.115: Wizard Ritual Adept — can cast from spellbook unprepared.
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
            if (isPrepared === true && isRitual) return `${actor.name} has Detect Magic prepared with the Ritual tag — can cast as a ritual.`;
            if (isPrepared === true) return `${actor.name} has Detect Magic prepared.`;
        }
    }
    return null;
}

/**
 * Deletes Detect Magic spell and concentration effects from the given actors.
 * Called when the scan is dismissed, activity ends, or rest concludes.
 * @param {Actor[]} actors
 * @returns {Promise<void>}
 */
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

/**
 * Spawn 3 concentric expanding ring ripples centered on an element, appended to
 * document.body so they survive an app re-render that replaces the source element.
 * @param {HTMLElement|null} element
 */
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

    /** @param {RestSetupApp} app */
    constructor(app) {
        this._app = app;
    }

    // ── State Accessors ─────────────────────────────────────────────────

    /** @returns {object[]|null} Current scan results array (or null if no scan). */
    get scanResults() { return this._app._magicScanResults; }

    /** @returns {boolean} Whether a scan has completed this session. */
    get scanComplete() { return !!this._app._magicScanComplete; }

    // ── Clear ───────────────────────────────────────────────────────────

    /**
     * Clears Detect Magic scan state, workbench staging, and notifies the glow adapter.
     * @param {{ skipSave?: boolean }} [opts] Pass skipSave when abandoning after activeRest was already wiped.
     */
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

    // ── Broadcast ────────────────────────────────────────────────────────

    /**
     * Pushes current Detect Magic results to all clients (inventory glow + Identify UI).
     * Caller must already have set `_magicScanResults` / `_magicScanComplete`.
     * @param {Function} getPartyActors - Party actors helper.
     */
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

    /**
     * Party actors for this rest session (long or short).
     * @returns {Actor[]}
     */
    _resolvePartyActors() {
        if (typeof this._app._getPartyActorsForRest === "function") {
            return this._app._getPartyActorsForRest();
        }
        return getPartyActors();
    }

    /**
     * Strip spell templates and actor effects when leaving activity or dismissing the scan.
     * @param {Actor[]} partyActors
     * @param {{ clearUi?: boolean }} [opts]
     * @returns {Promise<void>}
     */
    async cleanupCastArtifactsOnPhaseExit(partyActors, opts = {}) {
        const clearUi = opts.clearUi !== false;
        await purgeDetectMagicRestArtifacts(partyActors);
        if (!clearUi || !this.scanComplete) return;
        this._app._magicScanResults = null;
        this._app._magicScanComplete = false;
        notifyDetectMagicScanCleared();
    }

    // ── Scan ─────────────────────────────────────────────────────────────

    /**
     * Detect Magic party scan (main UI and workbench station).
     * @param {Function} getPartyActors - Party actors helper.
     */
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

        const { DetectMagicScanner } = await import("../../services/DetectMagicScanner.js");
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

    // ── Identify Scanned Item ────────────────────────────────────────────

    /**
     * GM: ritual Identify on a scanned item (main UI and workbench station).
     * @param {string} actorId
     * @param {string} itemId
     * @param {Function} getPartyActors - Party actors helper.
     */
    async identifyScannedItem(actorId, itemId, getPartyActors) {
        if (!game.user.isGM) return;
        try {
            const { DetectMagicScanner } = await import("../../services/DetectMagicScanner.js");
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
