/**
 * CampCeremonyDelegate.js
 * Handles fire lighting, firewood pledging/reclaiming, cold camp decisions,
 * and the fire level state machine during the Make Camp phase.
 *
 * Extracted from RestSetupApp to reduce God Class complexity (Phase 1.2).
 * Follows the established delegate pattern (see CraftingDelegate.js).
 */

import { CampGearScanner } from "../../services/CampGearScanner.js";
import { CampfireTokenLinker } from "../../services/CampfireTokenLinker.js";
import { emitPhaseChanged } from "../../services/SocketController.js";

const MODULE_ID = "ionrift-respite";

/**
 * Fire levels in ascending order.
 * @type {ReadonlyArray<string>}
 */
const FIRE_LEVELS = Object.freeze(["unlit", "embers", "campfire", "bonfire"]);

export class CampCeremonyDelegate {

    /** @param {RestSetupApp} app */
    constructor(app) {
        this._app = app;
    }

    // ── State Accessors ─────────────────────────────────────────────────

    /** @returns {string} Current fire level. */
    get fireLevel() { return this._app._fireLevel ?? "unlit"; }
    set fireLevel(v) { this._app._fireLevel = v; }

    /** @returns {object|null} Who lit the fire. */
    get fireLitBy() { return this._app._fireLitBy ?? null; }
    set fireLitBy(v) { this._app._fireLitBy = v; }

    /** @returns {Map<string, {actorId: string, actorName: string, count: number}>} */
    get firewoodPledges() { return this._app._firewoodPledges; }

    /** @returns {boolean} */
    get coldCampDecided() { return !!this._app._coldCampDecided; }
    set coldCampDecided(v) { this._app._coldCampDecided = v; }

    /** @returns {string|null} */
    get campFirePreviewLevel() { return this._app._campFirePreviewLevel ?? null; }
    set campFirePreviewLevel(v) { this._app._campFirePreviewLevel = v; }

    // ── Pure Derivations ────────────────────────────────────────────────

    /**
     * Derives the canonical fire level from lighting state and pledged firewood.
     * unlit → embers (0 wood) → campfire (1 wood) → bonfire (2+ wood)
     * @returns {string}
     */
    deriveCampFireLevel() {
        if (!this.fireLitBy) return "unlit";
        const total = this._totalPledged();
        if (total <= 0) return "embers";
        if (total === 1) return "campfire";
        return "bonfire";
    }

    /**
     * Total firewood pledged across all users.
     * @returns {number}
     */
    _totalPledged() {
        return Array.from(this.firewoodPledges.values()).reduce((s, p) => s + p.count, 0);
    }

    /**
     * Whether the fire has been committed (lit or cold camp decided).
     * @returns {boolean}
     */
    isFireCommitted() {
        return !!this.fireLitBy || this.fireLevel !== "unlit" || this.coldCampDecided;
    }

    /**
     * Builds a minimal campfire snapshot for the CampfireApp.
     * @param {string} fireLevel
     * @returns {object|null}
     */
    static campfireSnapshotFromFireLevel(fireLevel) {
        const fl = fireLevel ?? "unlit";
        if (fl === "unlit") return null;
        return {
            lit: true,
            litBy: null,
            heat: 0,
            strikeCount: 0,
            kindlingPlaced: 0,
            peakHeat: 0,
            lastFireLevel: fl
        };
    }

    // ── GM Mutations ────────────────────────────────────────────────────

    /**
     * Records who lit the campfire and advances fire to embers.
     * @param {string} userId
     * @param {string} actorId
     * @param {string} method - Item or cantrip name used (display string).
     */
    async lightFire(userId, actorId, method) {
        if (!game.user.isGM) return;
        const actor = game.actors.get(actorId);
        if (!actor) return;
        this.fireLitBy = { userId, actorId, actorName: actor.name, method };
        await this._syncFireLevelFromPledges();
    }

    /**
     * Player pledges 1 firewood from their character.
     * @param {string} userId
     * @param {string} actorId
     */
    async addFirewoodPledge(userId, actorId) {
        if (!game.user.isGM) return;
        if (!this.fireLitBy) {
            ui.notifications.warn("Light the fire first.");
            return;
        }
        const total = this._totalPledged();
        if (total >= 2) {
            ui.notifications.warn("The fire is already a bonfire.");
            return;
        }
        const actor = game.actors.get(actorId);
        if (!actor) return;
        const firewoodItem = actor.items.find(i => {
            const n = i.name?.toLowerCase() ?? "";
            return n.includes("firewood") || n === "kindling";
        });
        const existing = this.firewoodPledges.get(userId);
        const pledgedSoFar = existing?.count ?? 0;
        const available = firewoodItem?.system?.quantity ?? 0;
        if (available <= pledgedSoFar) {
            ui.notifications.warn(`${actor.name} has no more firewood to add.`);
            return;
        }
        this.firewoodPledges.set(userId, { actorId, actorName: actor.name, count: pledgedSoFar + 1 });
        await this._syncFireLevelFromPledges();
    }

    /**
     * GM pledges firewood from an infinite supply (no inventory required).
     */
    async addGmFirewoodPledge() {
        if (!game.user.isGM) return;
        if (!this.fireLitBy) {
            ui.notifications.warn("Light the fire first.");
            return;
        }
        const total = this._totalPledged();
        if (total >= 2) {
            ui.notifications.warn("The fire is already a bonfire.");
            return;
        }
        const existing = this.firewoodPledges.get(game.user.id);
        const pledgedSoFar = existing?.count ?? 0;
        this.firewoodPledges.set(game.user.id, {
            actorId: null, actorName: "GM", count: pledgedSoFar + 1, gmPledge: true
        });
        await this._syncFireLevelFromPledges();
    }

    /**
     * Removes this user's firewood pledge.
     * @param {string} userId
     */
    async removeFirewoodPledge(userId) {
        if (!game.user.isGM) return;
        if (!this.firewoodPledges.has(userId)) return;
        this.firewoodPledges.delete(userId);
        await this._syncFireLevelFromPledges();
    }

    /**
     * GM records that the table decided to sleep cold (no fire).
     * Satisfies the fire gate without lighting, broadcasts to all clients.
     */
    async decideColdCamp() {
        if (!game.user.isGM) return;
        this.coldCampDecided = true;
        this.fireLitBy = null;
        this.fireLevel = "unlit";
        emitPhaseChanged(this._app._phase, {
            coldCampDecided: true,
            fireLevel: "unlit",
            fireLitBy: null
        });
        await this._app._saveRestState();
        await this._app._advanceCampToActivity();
    }

    /**
     * Sync _fireLevel, engine, and campfire token light state from current pledge data.
     * Broadcasts phase update and may auto-advance from camp → activity.
     */
    async _syncFireLevelFromPledges() {
        const level = this.deriveCampFireLevel();
        this.fireLevel = level;
        this.campFirePreviewLevel = null;
        const FIRE_MOD = CampGearScanner.FIRE_ENCOUNTER_MOD_BY_LEVEL;
        if (this._app._engine) {
            this._app._engine.fireLevel = level;
            this._app._engine.fireRollModifier = FIRE_MOD[level] ?? 0;
        }
        await CampfireTokenLinker.setLightState(level !== "unlit", level !== "unlit" ? level : undefined);
        emitPhaseChanged("camp", {
            fireLevel: level,
            fireLitBy: this.fireLitBy,
            firewoodPledges: Array.from(this.firewoodPledges.entries()),
            selectedTerrain: this._app._selectedTerrain ?? null
        });
        await this._app._saveRestState();
        const willAdvance =
            this._app._phase === "camp" && !this._app._campToActivityDone && this.fireLevel !== "unlit";
        if (willAdvance) {
            await this._app._advanceCampToActivity();
        } else if (!this._app._campToActivityDone) {
            this._app.render();
        }
    }

    // ── Serialization helpers (for rest state persistence) ───────────────

    /**
     * Returns fire ceremony state for snapshot/save.
     * @returns {object}
     */
    serialize() {
        return {
            fireLevel: this.fireLevel,
            fireLitBy: this.fireLitBy,
            firewoodPledges: Array.from(this.firewoodPledges.entries()),
            coldCampDecided: this.coldCampDecided
        };
    }

    /**
     * Restores fire ceremony state from a snapshot/save.
     * @param {object} state
     */
    restore(state) {
        if (!state) return;
        this.fireLevel = state.fireLevel ?? "unlit";
        this.fireLitBy = state.fireLitBy ?? null;
        this._app._firewoodPledges = new Map(state.firewoodPledges ?? []);
        this.coldCampDecided = state.coldCampDecided ?? false;
    }
}
