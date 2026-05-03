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

// ── Free-function helpers (copied from RSA module scope) ────────────────────

/**
 * Whether an actor can cast a named spell from their sheet
 * (dnd5e: cantrips, prepared, always, innate).
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

        // Ritual spells can be cast from the spellbook without preparation.
        // Modern dnd5e: system.properties is a Set; legacy: system.components.ritual.
        const isRitual = (i.system?.properties instanceof Set && i.system.properties.has("ritual"))
            || i.system?.properties?.ritual === true
            || i.system?.components?.ritual === true;
        if (isRitual) return true;

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
                        requiresAttunement: !!item.system?.attunement,
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
                if (spellItem && typeof spellItem.use === "function") {
                    try {
                        await spellItem.use({ configureDialog: false });
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
