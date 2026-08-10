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
    if (!actor) return false;
    if (actor.classes?.wizard) return true;
    return !!(actor.items?.find(i2 => i2.type === "class" && i2.name?.toLowerCase() === "wizard"));
}

/**
 * @param {Item} spellItem
 * @returns {{ isRitual: boolean, mode: string|undefined, isPrepared: boolean }}
 */
function readSpellPrep(spellItem) {
    const props = spellItem.system?.properties;
    const isRitual = (props instanceof Set && props.has("ritual"))
        || (Array.isArray(props) && props.includes("ritual"))
        || props?.ritual === true
        || spellItem.system?.components?.ritual === true
        || spellItem.system?.ritual === true;
    let mode;
    let preparedRaw;
    if (spellItem.system !== null && "method" in spellItem.system) {
        mode = spellItem.system.method;
        preparedRaw = spellItem.system.prepared;
    } else {
        const prep = spellItem.system?.preparation;
        mode = prep?.mode;
        preparedRaw = prep?.prepared;
    }
    if (preparedRaw === undefined && spellItem.system?.prepared !== undefined) {
        preparedRaw = spellItem.system.prepared;
    }
    // dnd5e 4+/5+: prepared may be 0|1|2 (unprepared|prepared|always).
    const isPrepared = preparedRaw === true || preparedRaw === 1 || preparedRaw === 2;
    return { isRitual, mode, isPrepared };
}

/**
 * @param {Item} spellItem
 * @param {string} spellNameLower
 * @returns {boolean}
 */
function spellItemMatchesName(spellItem, spellNameLower) {
    const name = String(spellItem?.name ?? "").toLowerCase().trim();
    if (name === spellNameLower) return true;
    if (name.startsWith(`${spellNameLower} `) || name.startsWith(`${spellNameLower}(`)) return true;
    const identifier = String(spellItem?.system?.identifier ?? "").toLowerCase();
    if (identifier === spellNameLower || identifier === spellNameLower.replace(/\s+/g, "")) return true;
    const source = String(
        spellItem?.flags?.core?.sourceId
        ?? spellItem?.system?.source?.revision
        ?? spellItem?._stats?.compendiumSource
        ?? ""
    ).toLowerCase();
    if (source.includes(`.${spellNameLower.replace(/\s+/g, "")}`) || source.includes(`/${spellNameLower}`)) {
        return true;
    }
    return false;
}

/**
 * @param {Actor} actor
 * @returns {Item[]}
 */
function actorSpellItems(actor) {
    if (Array.isArray(actor?.itemTypes?.spell)) return actor.itemTypes.spell;
    if (actor?.itemTypes?.spell) return [...actor.itemTypes.spell];
    const items = actor?.items;
    if (!items) return [];
    if (typeof items.filter === "function") {
        return items.filter(i => i.type === "spell");
    }
    const out = [];
    for (const i of items) {
        if (i?.type === "spell") out.push(i);
    }
    return out;
}

/**
 * Per-actor access for Identify / Detect Magic.
 * @param {Actor} actor
 * @param {string} spellNameLower
 * @returns {{
 *   state: "available"|"unprepared"|"unavailable",
 *   badge: ""|"Not prepared"|"Spell",
 *   caption: string,
 *   tooltip: string
 * }}
 */
export function getNamedSpellAccess(actor, spellNameLower) {
    const pretty = spellNameLower === "detect magic" ? "Detect Magic" : "Identify";
    if (!actor) {
        return {
            state: "unavailable",
            badge: "Spell",
            caption: `Requires the ${pretty} spell.`,
            tooltip: `Requires the ${pretty} spell.`
        };
    }
    const isWizard = actorIsWizard(actor);
    const unavailable = {
        state: "unavailable",
        badge: "Spell",
        caption: isWizard
            ? `${pretty} is not in the spellbook.`
            : `Requires the ${pretty} spell.`,
        tooltip: isWizard
            ? `${pretty} is not in the spellbook.`
            : `Requires the ${pretty} spell.`
    };

    let sawSpell = false;
    for (const i of actorSpellItems(actor)) {
        if (!spellItemMatchesName(i, spellNameLower)) continue;
        sawSpell = true;
        const level = i.system?.level ?? 0;
        if (level === 0) {
            return {
                state: "available",
                badge: "",
                caption: `${actor.name} has ${pretty} as a cantrip.`,
                tooltip: `${actor.name} has ${pretty} as a cantrip.`
            };
        }
        const { isRitual, mode, isPrepared } = readSpellPrep(i);
        // Ritual-only prep mode (Book of Ancient Secrets / Ritual Caster book).
        if (mode === "ritual") {
            return {
                state: "available",
                badge: "",
                caption: `${actor.name} can cast ${pretty} as a ritual.`,
                tooltip: `${actor.name} can cast ${pretty} as a ritual.`
            };
        }
        if ((isRitual || mode === "ritual") && isWizard) {
            return {
                state: "available",
                badge: "",
                caption: `${actor.name} can cast ${pretty} as a ritual from the spellbook without preparing it (Wizard – Ritual Adept, PHB p.115).`,
                tooltip: `${actor.name} can cast ${pretty} as a ritual from the spellbook without preparing it (Wizard – Ritual Adept, PHB p.115).`
            };
        }
        if (mode === "innate") {
            return {
                state: "available",
                badge: "",
                caption: `${actor.name} can cast ${pretty} innately.`,
                tooltip: `${actor.name} can cast ${pretty} innately.`
            };
        }
        if (mode === "always" || mode === "atwill") {
            return {
                state: "available",
                badge: "",
                caption: mode === "atwill"
                    ? `${actor.name} can cast ${pretty} at will.`
                    : `${actor.name} always has ${pretty} available (Ritual Caster or similar, PHB p.204).`,
                tooltip: mode === "atwill"
                    ? `${actor.name} can cast ${pretty} at will.`
                    : `${actor.name} always has ${pretty} available (Ritual Caster or similar, PHB p.204).`
            };
        }
        if (isPrepared) {
            return {
                state: "available",
                badge: "",
                caption: isRitual
                    ? `${actor.name} has ${pretty} prepared with the Ritual tag; can cast as a ritual.`
                    : `${actor.name} has ${pretty} prepared.`,
                tooltip: isRitual
                    ? `${actor.name} has ${pretty} prepared with the Ritual tag; can cast as a ritual.`
                    : `${actor.name} has ${pretty} prepared.`
            };
        }
    }

    if (sawSpell) {
        return {
            state: "unprepared",
            badge: "Not prepared",
            caption: `${pretty} is not prepared.`,
            tooltip: `${pretty} is not prepared.`
        };
    }
    return unavailable;
}

/**
 * Cantrip / prepared / always / innate, or Wizard ritual-from-spellbook (PHB p.115).
 * Ritual Caster feat uses mode "always"; no separate branch.
 */
function actorHasNamedSpellAccess(actor, spellNameLower) {
    return getNamedSpellAccess(actor, spellNameLower).state === "available";
}

/**
 * Shared SPELLS-column status for Identify + Detect Magic on one actor.
 * @param {Actor|null} actor
 * @param {{ magicScanActive?: boolean, isGmUser?: boolean }} [opts]
 * @returns {{
 *   identifyAccess: ReturnType<typeof getNamedSpellAccess>,
 *   detectMagicAccess: ReturnType<typeof getNamedSpellAccess>,
 *   identifyAvailable: boolean,
 *   detectMagicAvailable: boolean,
 *   arcaneBadge: string,
 *   arcaneStatus: string,
 *   detectMagicPill: string,
 *   identifyPill: string
 * }}
 */
export function buildArcaneWorkbenchAccess(actor, opts = {}) {
    const identifyAccess = getNamedSpellAccess(actor, "identify");
    const detectMagicAccess = getNamedSpellAccess(actor, "detect magic");
    const identifyAvailable = identifyAccess.state === "available";
    // GM may always trigger Detect Magic scan (party override).
    const detectMagicAvailable = !!opts.isGmUser || detectMagicAccess.state === "available";
    const isWizard = actorIsWizard(actor);
    const actorName = actor?.name || "This character";

    let identifyPill = identifyAvailable ? "" : identifyAccess.badge;
    let detectMagicPill = detectMagicAccess.state === "available" ? "" : detectMagicAccess.badge;
    let arcaneStatus = "";

    if (opts.magicScanActive) {
        arcaneStatus = "Scan active.";
        detectMagicPill = "";
    } else if (opts.isGmUser && detectMagicAccess.state !== "available") {
        // GM can run the scan; keep Identify reason so PHB/prep copy is not lost.
        const idCap = !identifyAvailable ? (identifyAccess.caption || "") : "";
        const gmCap = "GM override - cast Detect Magic on behalf of the party.";
        arcaneStatus = [idCap, gmCap].filter(Boolean).join(" ");
        detectMagicPill = "";
    } else if (identifyAvailable && detectMagicAccess.state === "available") {
        const idCap = identifyAccess.caption || "";
        const dmCap = detectMagicAccess.caption || "";
        if (idCap.includes("Ritual Adept") && dmCap.includes("Ritual Adept")) {
            arcaneStatus = `${actorName} can cast Identify and Detect Magic as rituals from the spellbook without preparing them (Wizard – Ritual Adept, PHB p.115).`;
        } else {
            arcaneStatus = [idCap, dmCap].filter(Boolean).join(" ");
        }
        identifyPill = "";
        detectMagicPill = "";
    } else if (!identifyAvailable && detectMagicAccess.state !== "available") {
        const idState = identifyAccess.state;
        const dmState = detectMagicAccess.state;
        if (idState === "unavailable" && dmState === "unavailable") {
            arcaneStatus = isWizard
                ? "Identify and Detect Magic are not in the spellbook."
                : "Requires Identify or Detect Magic.";
            identifyPill = "";
            detectMagicPill = "";
        } else if (idState === "unprepared" && dmState === "unprepared") {
            arcaneStatus = "Identify and Detect Magic are not prepared.";
            identifyPill = "";
            detectMagicPill = "";
        } else {
            // Mixed blocked states: short line naming the blockers; keep per-control pills.
            arcaneStatus = [identifyAccess.caption, detectMagicAccess.caption]
                .filter(Boolean)
                .join(" ");
        }
    } else if (!identifyAvailable) {
        // Identify blocked, Detect Magic available: keep both (blocker + PHB / ritual attribution).
        arcaneStatus = [identifyAccess.caption, detectMagicAccess.caption]
            .filter(Boolean)
            .join(" ");
    } else {
        // Identify available, Detect Magic blocked.
        arcaneStatus = [identifyAccess.caption, detectMagicAccess.caption]
            .filter(Boolean)
            .join(" ");
    }

    return {
        identifyAccess,
        detectMagicAccess,
        identifyAvailable,
        detectMagicAvailable,
        arcaneBadge: identifyPill || detectMagicPill,
        arcaneStatus,
        detectMagicPill,
        identifyPill
    };
}


function snapshotSceneTemplateIds() {
    const ids = new Set();
    for (const doc of canvas.scene?.templates?.contents ?? []) {
        if (doc?.id) ids.add(doc.id);
    }
    return ids;
}


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


export function getDetectMagicPlayerAccessReason(partyActors) {
    if (game.user?.isGM) return null;
    let blockedCaption = null;
    for (const actor of partyActors) {
        if (!actor.isOwner) continue;
        const access = getNamedSpellAccess(actor, "detect magic");
        if (access.state === "available") return access.caption;
        if (!blockedCaption) blockedCaption = access.caption;
    }
    return blockedCaption;
}

/**
 * Tooltip when Detect Magic cannot be triggered by this user.
 * @param {Actor[]} partyActors
 * @param {Actor|null} [focusActor]
 * @returns {string}
 */
export function getDetectMagicDisabledTooltip(partyActors, focusActor = null) {
    if (game.user?.isGM) return "";
    const actor = focusActor
        || partyActors.find(a => a.isOwner && getNamedSpellAccess(a, "detect magic").state !== "unavailable")
        || partyActors.find(a => a.isOwner)
        || null;
    if (!actor) return "Requires Detect Magic.";
    const access = getNamedSpellAccess(actor, "detect magic");
    if (access.state === "available") {
        // Owned caster exists but trigger failed (e.g. no ownership race).
        return "No Detect Magic available.";
    }
    return access.tooltip;
}


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
