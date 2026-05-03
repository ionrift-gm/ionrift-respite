import { TravelResolver } from "../../services/TravelResolver.js";
import { TravelMishapHandler } from "../../services/TravelMishapHandler.js";
import { TerrainRegistry } from "../../services/TerrainRegistry.js";
import { ForageActivityValidator } from "../../services/ForageActivityValidator.js";

const MODULE_ID = "ionrift-respite";
const MAX_TRAVEL_DAYS = 3;

const SCOUTING_EFFECTS = {
    none:    { comfortBonus: 0, encounterDC: 0, complication: false, tier: "none" },
    nat1:    { comfortBonus: 0, encounterDC: 0, complication: true,  tier: "nat1" },
    poor:    { comfortBonus: 0, encounterDC: 0, complication: false, tier: "poor" },
    average: { comfortBonus: 1, encounterDC: 0, complication: false, tier: "average" },
    good:    { comfortBonus: 1, encounterDC: 1, complication: false, tier: "good" },
    nat20:   { comfortBonus: 2, encounterDC: 0, complication: false, tier: "nat20" }
};

/**
 * TravelResolutionDelegate
 * Manages the Travel Resolution phase with multi-day support.
 * Entries are keyed by "day:actorId" for per-day per-character tracking.
 * Scouting is available on the final day only.
 *
 * States per entry:
 *   "idle"      - GM is configuring (activity select)
 *   "requested" - Roll request sent to player, awaiting roll
 *   "rolled"    - Player rolled, result received
 *   "resolved"  - Pool draws done, items granted
 */
export class TravelResolutionDelegate {

    /** @type {import('../RestSetupApp.js').RestSetupApp} */
    #app;

    /** @type {TravelResolver} */
    #resolver;

    /** @type {Map<string, Object>} "day:actorId" -> entry */
    #entries = new Map();

    /** @type {number} Total travel days (capped at MAX_TRAVEL_DAYS) */
    #totalDays = 1;

    /** @type {number} Currently active day (1-indexed) */
    #activeDay = 1;

    /** @type {Map<number, boolean>} day -> resolved */
    #dayResolved = new Map();

    /** @type {boolean} Whether pools have been loaded. */
    #poolsLoaded = false;

    /** True when resource pools came from an imported content pack (not a local stub). */
    #resourcePoolsFromPack = false;

    /** GM-tweakable DC overrides (null = use default) */
    #forageDCOverride = null;
    #huntDCOverride = null;

    /** @type {boolean} Whether scouting is allowed (GM toggle) */
    #scoutingAllowed = true;

    /** @type {string|null} Best scouting tier result from final day ("none","nat1","poor","average","good","nat20") */
    #scoutingResult = null;

    /** @type {Array|null} All scout rolls: [{actorId, actorName, total}] */
    #scoutRolls = null;

    /** @type {Map<string, boolean>} "day:actorId" -> confirmed by player */
    #confirmed = new Map();

    constructor(app) {
        this.#app = app;
        this.#resolver = new TravelResolver();
        const idx = game.ionrift?.respite?.travelBasePoolIndex;
        if (idx) this.#resolver.loadBaseItems(idx);
    }

    // ── Day management ──

    get totalDays() { return this.#totalDays; }
    get activeDay() { return this.#activeDay; }

    setTotalDays(daysSinceLastRest) {
        this.#totalDays = Math.max(1, Math.min(MAX_TRAVEL_DAYS, daysSinceLastRest));
    }

    setActiveDay(day) {
        this.#activeDay = Math.max(1, Math.min(this.#totalDays, day));
    }

    isDayResolved(day) {
        return this.#dayResolved.get(day) ?? false;
    }

    isFullyResolved() {
        for (let d = 1; d <= this.#totalDays; d++) {
            if (!this.isDayResolved(d)) return false;
        }
        return true;
    }

    /**
     * All party members are ready to resolve: rolls in where required, or confirmed for plain Other.
     * @param {number} day
     * @param {Actor[]} partyActors
     */
    isDayReadyToResolve(day, partyActors) {
        if (!partyActors?.length) return false;
        return partyActors.every(actor => {
            const entry = this._getEntry(day, actor.id);
            const activity = entry?.activity ?? "nothing";
            const status = entry?.status ?? "idle";
            const hasCustomRoll = !!(entry?.customDC && entry?.activity === "nothing");
            if (activity === "nothing") {
                if (hasCustomRoll) {
                    return status === "rolled" || status === "resolved";
                }
                return this.isConfirmed(actor.id, day);
            }
            return status === "rolled" || status === "resolved";
        });
    }

    // ── DC management ──

    get forageDC() {
        return this.#forageDCOverride ?? TravelResolver.FORAGE_DC;
    }

    get huntDC() {
        return this.#huntDCOverride ?? TravelResolver.HUNT_DC;
    }

    adjustGlobalDC(activity, delta) {
        if (activity === "forage") {
            this.#forageDCOverride = Math.max(1, this.forageDC + delta);
        } else if (activity === "hunt") {
            this.#huntDCOverride = Math.max(1, this.huntDC + delta);
        }
        for (const [, entry] of this.#entries) {
            if (entry.activity === activity) {
                entry.dc = activity === "forage" ? this.forageDC : this.huntDC;
            }
        }
    }

    // ── Scouting ──

    get scoutingAllowed() { return this.#scoutingAllowed; }
    set scoutingAllowed(v) { this.#scoutingAllowed = !!v; }

    get scoutingResult() { return this.#scoutingResult; }
    get scoutingEffects() { return SCOUTING_EFFECTS[this.#scoutingResult] ?? SCOUTING_EFFECTS.none; }

    static get SCOUTING_EFFECTS() { return SCOUTING_EFFECTS; }

    _getScoutSkillDisplay(actor) {
        const prc = actor.system?.skills?.prc?.total ?? 0;
        const sur = actor.system?.skills?.sur?.total ?? 0;
        const best = Math.max(prc, sur);
        const skill = prc >= sur ? "Perception" : "Survival";
        const sign = best >= 0 ? "+" : "";
        return { mod: `${sign}${best}`, skill, total: best };
    }

    // ── Pool / yield loading ──

    /**
     * Load resource pool definitions (merges into the shared roller).
     * @param {Object[]} poolData
     * @param {Object} [opts]
     * @param {boolean} [opts.fromImportedPack=false] - Enables travel/camp forage when pools are drawable.
     */
    loadPoolsFromData(poolData, { fromImportedPack = false } = {}) {
        if (!Array.isArray(poolData) || !poolData.length) return;
        this.#resolver.loadPools(poolData);
        this.#poolsLoaded = true;
        if (fromImportedPack) this.#resourcePoolsFromPack = true;
    }

    /** @returns {boolean} */
    get resourcePoolsFromPack() {
        return this.#resourcePoolsFromPack;
    }

    /** @returns {import("../../services/ResourcePoolRoller.js").ResourcePoolRoller} */
    getResourcePoolRoller() {
        return this.#resolver.resourcePoolRoller;
    }

    /** @returns {TravelResolver} */
    getTravelResolver() {
        return this.#resolver;
    }

    /** Terrain tag for forage gating when not passed explicitly (matches RestSetupApp travel context). */
    _terrainTagForForageGate() {
        return this.#app?._engine?.terrainTag
            ?? this.#app?._selectedTerrain
            ?? "forest";
    }

    /**
     * Travel / UI gate for picking Forage (requires imported pack pools and a drawable table).
     * @param {string} terrainTag
     * @returns {{ disabled: boolean, disabledReasonKey: string|null }}
     */
    getForageGate(terrainTag) {
        const disabledReasonKey = "ionrift-respite.travel.forage.requires_pack";
        if (!ForageActivityValidator.isForageAvailable(this.#resolver, terrainTag)) {
            return { disabled: true, disabledReasonKey };
        }
        return { disabled: false, disabledReasonKey: null };
    }

    /**
     * Reset pool/yield state (for re-import scenarios).
     */
    resetPools() {
        this.#poolsLoaded = false;
        this.#resourcePoolsFromPack = false;
    }

    /** @returns {boolean} true if pool data has been loaded. */
    get poolsLoaded() {
        return this.#poolsLoaded;
    }

    // ── Entry key helpers ──

    static _key(day, actorId) { return `${day}:${actorId}`; }

    _getEntry(day, actorId) {
        return this.#entries.get(TravelResolutionDelegate._key(day, actorId));
    }

    _setEntry(day, actorId, entry) {
        this.#entries.set(TravelResolutionDelegate._key(day, actorId), entry);
    }

    // Flat lookup for backward compat (active day)
    getEntry(actorId) {
        return this._getEntry(this.#activeDay, actorId);
    }

    // ── Declarations ──

    setDeclaration(actorId, activity, day = null) {
        const d = day ?? this.#activeDay;
        if (activity === "forage" && this.getForageGate(this._terrainTagForForageGate()).disabled) {
            return;
        }
        const existing = this._getEntry(d, actorId);
        if (existing
            && existing.activity === "nothing"
            && !existing.customDC
            && this.isConfirmed(actorId, d)) {
            if (activity === "nothing") return;
            return;
        }
        const dc = activity === "hunt" ? this.huntDC
            : activity === "scout" ? 0
            : activity === "nothing" ? 0
            : this.forageDC;
        this._setEntry(d, actorId, {
            activity,
            dc,
            baseDC: dc,
            status: "idle",
            requested: false,
            total: null,
            result: null,
            customDC: null,
            customSkill: null
        });
    }

    /**
     * Set a custom DC for an "other" activity entry (GM ad-hoc check).
     */
    setOtherCustomDC(actorId, dc, skill = "sur", day = null) {
        const d = day ?? this.#activeDay;
        const entry = this._getEntry(d, actorId);
        if (!entry || entry.activity !== "nothing") return;
        entry.customDC = dc;
        entry.customSkill = skill;
    }

    // ── Player confirmation ──

    setConfirmed(actorId, day = null, value = true) {
        const d = day ?? this.#activeDay;
        this.#confirmed.set(`${d}:${actorId}`, value);
    }

    isConfirmed(actorId, day = null) {
        const d = day ?? this.#activeDay;
        return this.#confirmed.get(`${d}:${actorId}`) ?? false;
    }

    // ── Roll request payloads ──

    markRequested(actorId, day = null) {
        const d = day ?? this.#activeDay;
        const entry = this._getEntry(d, actorId);
        if (!entry) return;
        if (entry.activity === "nothing" && !entry.customDC) return;
        entry.requested = true;
    }

    getRollRequestPayload(actorId, day = null) {
        const d = day ?? this.#activeDay;
        const entry = this._getEntry(d, actorId);
        if (!entry) return null;

        if (entry.activity === "scout") {
            const actor = game.actors.get(actorId);
            const scoutInfo = actor ? this._getScoutSkillDisplay(actor) : { skill: "Perception", mod: "+0", total: 0 };
            return {
                actorId, day: d,
                activity: "scout",
                activityLabel: "Scout",
                skill: scoutInfo.skill === "Perception" ? "prc" : "sur",
                skillName: scoutInfo.skill,
                dc: 0
            };
        }

        if (entry.activity === "nothing" && entry.customDC) {
            const SKILL_LABELS = { sur: "Survival", nat: "Nature", prc: "Perception", ath: "Athletics", ste: "Stealth" };
            return {
                actorId, day: d,
                activity: "other",
                activityLabel: "Other",
                skill: entry.customSkill ?? "sur",
                skillName: SKILL_LABELS[entry.customSkill] ?? "Survival",
                dc: entry.customDC
            };
        }

        if (entry.activity === "nothing") return null;

        if (entry.activity === "forage" && this.getForageGate(this._terrainTagForForageGate()).disabled) {
            return null;
        }

        return {
            actorId, day: d,
            activity: entry.activity,
            activityLabel: entry.activity === "forage" ? "Forage" : "Hunt",
            skill: "sur",
            skillName: "Survival",
            dc: entry.dc
        };
    }

    getAllRollRequestPayloads(day = null) {
        const d = day ?? this.#activeDay;
        const payloads = [];
        for (const [key, entry] of this.#entries) {
            if (!key.startsWith(`${d}:`)) continue;
            if (entry.activity === "nothing" && !entry.customDC) continue;
            const actorId = key.split(":")[1];
            const p = this.getRollRequestPayload(actorId, d);
            if (p) payloads.push(p);
        }
        return payloads;
    }

    // ── Receive roll results ──

    receiveRollResult(actorId, total, day = null, natD20 = null) {
        const d = day ?? this.#activeDay;
        const entry = this._getEntry(d, actorId);
        if (!entry) return;
        entry.total = total;
        if (natD20 !== null) entry.natD20 = natD20;
        entry.status = "rolled";
    }

    /**
     * Resolve forage or hunt for one character as soon as the roll is received.
     * Scout and Other still resolve in resolveDay. Skips if already resolved.
     * @returns {Promise<{ day: number, activity: string, result: object }|null>} debrief row, or null
     */
    async resolveIndividualResult(actorId, day, terrainTag) {
        if (!this.#poolsLoaded) {
            console.warn("[Respite:TravelDelegate] No resource pools loaded from content packs. Foraging will produce no results.");
        }
        const entry = this._getEntry(day, actorId);
        if (!entry) return null;
        if (entry.status === "resolved") return null;
        if (entry.status !== "rolled") return null;
        if (entry.activity !== "forage" && entry.activity !== "hunt") return null;

        const actor = game.actors.get(actorId);
        if (!actor) return null;

        let result;
        if (entry.activity === "forage") {
            result = await this.#resolver.resolveForageFromTotal(actor, terrainTag, entry.total, entry.dc);
        } else {
            result = await this.#resolver.resolveHuntFromTotal(actor, terrainTag, entry.total, entry.dc);
        }

        if (result.success && result.items?.length) {
            await this.#resolver.grantItems(actor, result.items);
        }

        if (result.mishap) {
            const engine = this.#app.getRestFlowEngine?.() ?? null;
            await TravelMishapHandler.applyMishapEffects(actor, result.mishap, engine, { mutateTarget: result.mishap });
        }

        await this.#resolver.whisperResult(result);
        entry.result = result;
        entry.status = "resolved";
        entry.individualDebriefEmitted = true;
        try { await actor.setFlag(MODULE_ID, "lastTravelActivity", entry.activity); } catch { /* noop */ }

        return {
            day,
            activity: entry.activity,
            result
        };
    }

    // ── Context building ──

    buildContext(partyActors, terrainTag) {
        const terrain = TerrainRegistry.get(terrainTag);
        const allowed = terrain?.travelActivities ?? ["forage", "hunt", "scout"];
        const canForage = allowed.includes("forage");
        const canHunt = allowed.includes("hunt");
        const canScout = allowed.includes("scout") && this.#scoutingAllowed;
        const hasTravelOptions = canForage || canHunt || canScout;

        let disabledReason = null;
        if (!canForage && !canHunt) {
            const label = terrain?.label ?? terrainTag;
            if (terrainTag === "tavern") {
                disabledReason = `No need to forage or hunt at a ${label}. Supplies are available for purchase.`;
            } else if (terrainTag === "dungeon") {
                disabledReason = `Foraging and hunting are not possible in a ${label}. The party must rely on supplies.`;
            } else if (terrainTag === "urban") {
                disabledReason = `Foraging and hunting are not available in an ${label} environment. Markets and shops serve that need.`;
            } else {
                disabledReason = `Foraging and hunting are not available in ${label}.`;
            }
        }

        const days = [];
        for (let d = 1; d <= this.#totalDays; d++) {
            const isFinalDay = d === this.#totalDays;
            const dayCanScout = isFinalDay && canScout;
            const dayResolved = this.isDayResolved(d);

            const characters = partyActors.map(actor => {
                const entry = this._getEntry(d, actor.id);
                const activity = entry?.activity ?? "nothing";
                const status = entry?.status ?? "idle";
                const lastActivity = actor.getFlag?.(MODULE_ID, "lastTravelActivity") ?? null;
                const lastLabel = lastActivity === "forage" ? "Forage"
                    : lastActivity === "hunt" ? "Hunt"
                    : lastActivity === "scout" ? "Scout" : null;

                const hasCustomRoll = !!(entry?.customDC && entry?.activity === "nothing");
                const charCtx = {
                    id: actor.id,
                    name: actor.name,
                    img: actor.img ?? "icons/svg/mystery-man.svg",
                    isOwner: actor.isOwner,
                    activity,
                    status,
                    confirmed: this.isConfirmed(actor.id, d),
                    lastActivity: lastLabel,
                    requested: entry?.requested ?? false,
                    dc: entry?.dc ?? 0,
                    baseDC: entry?.baseDC ?? 0,
                    total: entry?.total ?? null,
                    survivalMod: this._getSurvivalDisplay(actor),
                    result: entry?.result ?? null,
                    customDC: entry?.customDC ?? null,
                    customSkill: entry?.customSkill ?? null,
                    hasCustomRoll,
                    otherLockedIn: activity === "nothing" && !hasCustomRoll && this.isConfirmed(actor.id, d)
                };

                if (dayCanScout) {
                    const scoutInfo = this._getScoutSkillDisplay(actor);
                    charCtx.scoutMod = scoutInfo.mod;
                    charCtx.scoutSkill = scoutInfo.skill;
                }

                if (!dayResolved) {
                    if (activity === "nothing") {
                        charCtx.awaitingPlayerResponse = !charCtx.confirmed;
                    } else {
                        charCtx.awaitingPlayerResponse = status !== "rolled" && status !== "resolved";
                    }
                } else {
                    charCtx.awaitingPlayerResponse = false;
                }

                return charCtx;
            });

            const activeDeclarations = characters.filter(c =>
                c.activity !== "nothing" || c.hasCustomRoll
            );
            const allRollsIn = this.isDayReadyToResolve(d, partyActors);
            const anyRequested = characters.some(c => c.requested && c.status !== "rolled" && c.status !== "resolved");
            const hasDeclarations = activeDeclarations.length > 0;
            const locked = anyRequested || allRollsIn || dayResolved ||
                characters.some(c => c.status === "rolled" || c.status === "resolved" || c.requested);

            days.push({
                day: d,
                label: this.#totalDays === 1 ? null : `Day ${d}`,
                isFinalDay,
                canScout: dayCanScout,
                resolved: dayResolved,
                isActive: d === this.#activeDay,
                locked,
                characters,
                allRollsIn,
                anyRequested,
                hasDeclarations,
                declarationCount: activeDeclarations.length
            });
        }

        const forageGate = this.getForageGate(terrainTag);
        const forageDisabled = canForage && forageGate.disabled;
        const forageDisabledReasonKey = forageDisabled ? forageGate.disabledReasonKey : null;

        return {
            days,
            totalDays: this.#totalDays,
            isMultiDay: this.#totalDays > 1,
            activeDay: this.#activeDay,
            canForage,
            canHunt,
            canScout,
            hasTravelOptions,
            travelSkipRecommended: !canForage && !canHunt,
            disabledReason,
            terrainTag,
            terrainLabel: terrain?.label ?? terrainTag,
            fullyResolved: this.isFullyResolved(),
            scoutingAllowed: this.#scoutingAllowed,
            scoutingResult: this.#scoutingResult,
            forageDC: this.forageDC,
            huntDC: this.huntDC,
            forageDisabled,
            forageDisabledReasonKey,
            forageDisabledTooltip: forageDisabledReasonKey
                ? game.i18n.localize(forageDisabledReasonKey)
                : null,
            forageGMAdj: this.#forageDCOverride !== null
                ? ((this.forageDC - TravelResolver.FORAGE_DC >= 0 ? "+" : "") + (this.forageDC - TravelResolver.FORAGE_DC))
                : null,
            huntGMAdj: this.#huntDCOverride !== null
                ? ((this.huntDC - TravelResolver.HUNT_DC >= 0 ? "+" : "") + (this.huntDC - TravelResolver.HUNT_DC))
                : null
        };
    }

    // ── Day resolution ──

    /**
     * Resolve a single day's rolled results.
     * For scouting (final day), determines the best scout tier.
     */
    async resolveDay(day, partyActors, terrainTag) {
        if (!this.isDayReadyToResolve(day, partyActors)) {
            try { ui.notifications?.warn("Not everyone has rolled or confirmed for this day yet."); } catch { /* noop */ }
            return;
        }
        if (!this.#poolsLoaded) {
            console.warn("[Respite:TravelDelegate] No resource pools loaded from content packs. Foraging will produce no results.");
        }

        const scoutTotals = [];

        for (const actor of partyActors) {
            const entry = this._getEntry(day, actor.id);
            if (!entry || entry.status === "resolved") continue;
            if (entry.status !== "rolled") continue;
            if (entry.activity === "nothing" && !entry.customDC) continue;

            // "Other" with custom DC: just mark resolved with the total, no pool draws
            if (entry.activity === "nothing" && entry.customDC) {
                const success = entry.total >= entry.customDC;
                entry.status = "resolved";
                entry.result = {
                    activity: "other", actorId: actor.id, actorName: actor.name,
                    total: entry.total, dc: entry.customDC, success
                };
                continue;
            }

            if (entry.activity === "scout") {
                scoutTotals.push({
                    actorId: actor.id,
                    total: entry.total,
                    actorName: actor.name,
                    natD20: entry.natD20 ?? null
                });
                entry.status = "resolved";
                entry.result = {
                    activity: "scout",
                    actorId: actor.id,
                    actorName: actor.name,
                    total: entry.total,
                    natD20: entry.natD20 ?? null
                };
                try { await actor.setFlag(MODULE_ID, "lastTravelActivity", "scout"); } catch { /* noop */ }
                continue;
            }

            if (entry.activity !== "forage" && entry.activity !== "hunt") {
                continue;
            }

            let result;
            if (entry.activity === "forage") {
                result = await this.#resolver.resolveForageFromTotal(actor, terrainTag, entry.total, entry.dc);
            } else {
                result = await this.#resolver.resolveHuntFromTotal(actor, terrainTag, entry.total, entry.dc);
            }

            if (result.success && result.items?.length) {
                await this.#resolver.grantItems(actor, result.items);
            }

            if (result.mishap && !result.mishap.effectsApplied) {
                const engine = this.#app.getRestFlowEngine?.() ?? null;
                await TravelMishapHandler.applyMishapEffects(actor, result.mishap, engine, { mutateTarget: result.mishap });
            }

            await this.#resolver.whisperResult(result);
            entry.result = result;
            entry.status = "resolved";

            try { await actor.setFlag(MODULE_ID, "lastTravelActivity", entry.activity); } catch { /* noop */ }
        }

        // Scouting: take highest total and map to tier
        if (scoutTotals.length > 0) {
            const best = scoutTotals.reduce((a, b) => b.total > a.total ? b : a);
            const tier = this._totalToScoutTier(best.total, best.natD20 ?? null);
            this.#scoutingResult = tier;
            this.#scoutRolls = scoutTotals.map(s => ({
                ...s,
                tier: this._totalToScoutTier(s.total, s.natD20 ?? null),
                isBest: s.actorId === best.actorId
            }));

            const allNames = scoutTotals.map(s => `${s.actorName}: ${s.total}`).join(", ");
            const bestMsg = scoutTotals.length > 1
                ? `Best: ${best.actorName} (${best.total}) → ${tier}`
                : `${best.actorName} rolled ${best.total} → ${tier}`;

            ChatMessage.create({
                content: `<div class="ionrift-chat-msg"><strong>🔭 Scouting Results</strong><br>${allNames}<br><em>${bestMsg}</em></div>`,
                whisper: ChatMessage.getWhisperRecipients("GM").map(u => u.id),
                speaker: { alias: "Respite" }
            });
        }

        for (const actor of partyActors) {
            const entry = this._getEntry(day, actor.id);
            if (!entry) continue;
            if (entry.activity === "nothing" && !entry.customDC && this.isConfirmed(actor.id, day)) {
                entry.status = "resolved";
            }
        }

        this.#dayResolved.set(day, true);

        // Auto-advance to next day
        if (day < this.#totalDays) {
            this.#activeDay = day + 1;
        }
    }

    /**
     * Map a raw d20 + modifier total to a scouting tier.
     * Uses the same breakpoints as the old setup dropdown.
     */
    /**
     * @param {number} total - d20 + modifier total
     * @param {number|null} natD20 - face of the d20 (from roll.terms[0].results[0].result); required for nat-20 tier
     */
    _totalToScoutTier(total, natD20 = null) {
        if (total <= 1) return "nat1";
        if (total < 10) return "poor";
        if (total < 15) return "average";
        if (natD20 === 20) return "nat20";
        return "good";
    }

    // ── Backward compat: resolveAll resolves all unresolved days ──

    async resolveAll(partyActors, terrainTag) {
        for (let d = 1; d <= this.#totalDays; d++) {
            if (!this.isDayResolved(d)) {
                await this.resolveDay(d, partyActors, terrainTag);
            }
        }
    }

    isResolved() { return this.isFullyResolved(); }

    hasDeclarations() {
        return [...this.#entries.values()].some(e => e.activity !== "nothing");
    }

    allRollsCollected(day = null) {
        const d = day ?? this.#activeDay;
        const dayEntries = [...this.#entries]
            .filter(([key]) => key.startsWith(`${d}:`))
            .map(([, e]) => e);
        const active = dayEntries.filter(e => e.activity !== "nothing" || e.customDC);
        if (active.length === 0) return false;
        return active.every(e => e.status === "rolled" || e.status === "resolved");
    }

    // ── Get all declarations for a day (for socket broadcast) ──

    getDayDeclarations(day = null) {
        const d = day ?? this.#activeDay;
        const declarations = {};
        for (const [key, entry] of this.#entries) {
            if (!key.startsWith(`${d}:`)) continue;
            const actorId = key.split(":")[1];
            declarations[actorId] = entry.activity;
        }
        return declarations;
    }

    /**
     * Build per-actor debrief data (only resolved entries with results).
     * Used to send private results to each player.
     */
    getPlayerDebrief(actorId) {
        const results = [];
        for (let d = 1; d <= this.#totalDays; d++) {
            const entry = this._getEntry(d, actorId);
            if (!entry || entry.status !== "resolved" || !entry.result) continue;
            if (entry.activity === "scout") continue; // scouting is blind
            if (entry.individualDebriefEmitted) continue; // already sent via travelIndividualDebrief
            results.push({
                day: d,
                activity: entry.activity,
                result: entry.result
            });
        }
        return results;
    }

    /**
     * Build the GM scouting debrief panel data.
     */
    getScoutingDebrief(terrainTag) {
        if (!this.#scoutingResult) return null;

        const terrain = TerrainRegistry.get(terrainTag);
        const effects = SCOUTING_EFFECTS[this.#scoutingResult] ?? SCOUTING_EFFECTS.none;
        const isNat1 = this.#scoutingResult === "nat1";

        const TIER_LABELS = {
            nat1: "Nat 1: Hidden Complication",
            poor: "Poor", average: "Average", good: "Good",
            nat20: "Nat 20: Perfect Campsite"
        };

        // Build per-scout narratives from the flavor pool
        const scouts = (this.#scoutRolls ?? []).map(s => {
            const sTier = s.tier ?? this._totalToScoutTier(s.total, s.natD20 ?? null);
            const pool = terrain?.scoutFlavor?.[sTier];
            const narrative = pool ? pool[Math.floor(Math.random() * pool.length)] : null;
            return {
                actorName: s.actorName,
                actorId: s.actorId,
                total: s.total,
                tier: sTier,
                tierLabel: TIER_LABELS[sTier] ?? sTier,
                isBest: !!s.isBest,
                narrative
            };
        });

        const bestScout = scouts.find(s => s.isBest);
        const winningNarrative = bestScout?.narrative ?? null;

        return {
            tier: this.#scoutingResult,
            tierLabel: TIER_LABELS[this.#scoutingResult] ?? "None",
            narrative: winningNarrative,
            scouts,
            bestName: bestScout?.actorName ?? null,
            multipleScouts: scouts.length > 1,
            isNat1,
            comfortBonus: effects.comfortBonus,
            encounterDC: effects.encounterDC,
            encounterCampModLabel: (() => {
                const v = effects.encounterDC;
                if (!v) return null;
                return v > 0 ? `+${v}` : `${v}`;
            })(),
            complication: effects.complication,
            gmHint: isNat1
                ? "Describe the site as if it were good. The complication will be revealed during events."
                : null
        };
    }

    // ── Serialization ──

    serialize() {
        return {
            entries: Object.fromEntries(
                [...this.#entries].map(([key, e]) => [key, {
                    activity: e.activity,
                    dc: e.dc,
                    baseDC: e.baseDC,
                    status: e.status,
                    requested: e.requested,
                    total: e.total,
                    natD20: e.natD20 ?? null,
                    customDC: e.customDC ?? null,
                    customSkill: e.customSkill ?? null,
                    individualDebriefEmitted: !!e.individualDebriefEmitted,
                    result: e.result ? {
                        activity: e.result.activity,
                        actorId: e.result.actorId,
                        actorName: e.result.actorName,
                        success: e.result.success,
                        nat20: e.result.nat20,
                        nat1: e.result.nat1,
                        exceptional: e.result.exceptional,
                        total: e.result.total,
                        dc: e.result.dc,
                        items: e.result.items,
                        warningKey: e.result.warningKey ?? null,
                        mishap: e.result.mishap
                            ? {
                                type: e.result.mishap.type,
                                description: e.result.mishap.description,
                                effects: e.result.mishap.effects,
                                effectsApplied: e.result.mishap.effectsApplied,
                                appliedSummaries: e.result.mishap.appliedSummaries
                            }
                            : null
                    } : null
                }])
            ),
            totalDays: this.#totalDays,
            activeDay: this.#activeDay,
            dayResolved: Object.fromEntries(this.#dayResolved),
            forageDCOverride: this.#forageDCOverride,
            huntDCOverride: this.#huntDCOverride,
            scoutingAllowed: this.#scoutingAllowed,
            scoutingResult: this.#scoutingResult,
            scoutRolls: this.#scoutRolls,
            confirmed: Object.fromEntries(this.#confirmed)
        };
    }

    deserialize(data) {
        if (!data) return;
        if (data.entries) {
            this.#entries = new Map(Object.entries(data.entries));
        }
        if (data.totalDays !== null) this.#totalDays = data.totalDays;
        if (data.activeDay !== null) this.#activeDay = data.activeDay;
        if (data.dayResolved) {
            this.#dayResolved = new Map(Object.entries(data.dayResolved).map(([k, v]) => [parseInt(k), v]));
        }
        if (data.forageDCOverride !== null) this.#forageDCOverride = data.forageDCOverride;
        if (data.huntDCOverride !== null) this.#huntDCOverride = data.huntDCOverride;
        if (data.scoutingAllowed !== null) this.#scoutingAllowed = data.scoutingAllowed;
        if (data.scoutingResult !== null) this.#scoutingResult = data.scoutingResult;
        if (data.scoutRolls) this.#scoutRolls = data.scoutRolls;
        if (data.confirmed) this.#confirmed = new Map(Object.entries(data.confirmed));
    }

    _getSurvivalDisplay(actor) {
        const sur = actor.system?.skills?.sur;
        const nat = actor.system?.skills?.nat;
        const best = Math.max(sur?.total ?? 0, nat?.total ?? 0);
        const sign = best >= 0 ? "+" : "";
        return `${sign}${best}`;
    }
}
