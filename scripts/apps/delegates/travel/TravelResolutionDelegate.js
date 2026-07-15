import { TravelResolver } from "../../../services/travel/resolve/TravelResolver.js";
import { TravelMishapHandler } from "../../../services/travel/resolve/TravelMishapHandler.js";
import { TerrainRegistry } from "../../../services/events/resolve/TerrainRegistry.js";
import { ForageActivityValidator } from "../../../services/travel/forage/ForageActivityValidator.js";
import { GrantLedger } from "../../../services/crafting/outcomes/GrantLedger.js";
import { isScoutingEnabled } from "../../../services/travel/settings/ScoutingSettings.js";
import {
    getTravelGatherAvailability,
    isForagingEnabled,
    isHuntingEnabled
} from "../../../services/travel/settings/TravelSettings.js";
import { MODULE_ID } from "../../../data/moduleId.js";

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
 * Travel entries keyed by "day:actorId". Scouting: final travel day only, not on a safe rest spot.
 * Entry states: idle, requested, rolled, awaiting_loot, resolved.
 */
export class TravelResolutionDelegate {

    #app;

    #resolver;

    #entries = new Map();

    #totalDays = 1;

    #activeDay = 1;

    #dayResolved = new Map();

    #poolsLoaded = false;

    #resourcePoolsFromPack = false;

    #forageDCOverride = null;
    #huntDCOverride = null;

    #scoutingAllowed = true;

    /** @type {string|null} Best scouting tier result from final day ("none","nat1","poor","average","good","nat20") */
    #scoutingResult = null;

    #scoutRolls = null;

    #confirmed = new Map();

    constructor(app) {
        this.#app = app;
        this.#resolver = new TravelResolver();
        const idx = game.ionrift?.respite?.travelBasePoolIndex;
        if (idx) this.#resolver.loadBaseItems(idx, game.ionrift?.respite?.travelFolderPathMap);
    }

    /**
     * Matches RestSetupApp getData merge: engine flag, active rest payload, then world setting.
     * @returns {boolean}
     */
    #effectiveSafeRestSpot() {
        let fromSetting = false;
        try {
            fromSetting = !!game.settings.get(MODULE_ID, "safeRestSpot");
        } catch { /* settings not ready */ }
        return !!(this.#app._engine?.safeRestSpot ?? this.#app._restData?.safeRestSpot ?? fromSetting);
    }

    isEffectiveSafeRestSpot() {
        return this.#effectiveSafeRestSpot();
    }

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
            if (activity === "scout") {
                return status === "rolled" || status === "resolved";
            }
            if (activity === "forage" || activity === "hunt") {
                return status === "resolved";
            }
            return status === "rolled" || status === "resolved";
        });
    }

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

    get scoutingAllowed() { return this.#scoutingAllowed; }
    set scoutingAllowed(v) { this.#scoutingAllowed = !!v; }

    get scoutingResult() { return this.#scoutingResult; }
    get scoutingEffects() { return SCOUTING_EFFECTS[this.#scoutingResult] ?? SCOUTING_EFFECTS.none; }

    static get SCOUTING_EFFECTS() { return SCOUTING_EFFECTS; }

    _getScoutSkillDisplay(actor) {
        const trdAdapter = game.ionrift?.respite?.adapter;
        const prc = trdAdapter ? trdAdapter.getSkillTotal(actor, trdAdapter.normalizeSkillKey("prc")) : (actor.system?.skills?.prc?.total ?? 0);
        const sur = trdAdapter ? trdAdapter.getSkillTotal(actor, trdAdapter.normalizeSkillKey("sur")) : (actor.system?.skills?.sur?.total ?? 0);
        const best = Math.max(prc, sur);
        const skill = prc >= sur ? "Perception" : "Survival";
        const sign = best >= 0 ? "+" : "";
        return { mod: `${sign}${best}`, skill, total: best };
    }

    loadPoolsFromData(poolData, { fromImportedPack = false } = {}) {
        if (!Array.isArray(poolData) || !poolData.length) return;
        this.#resolver.loadPools(poolData);
        this.#poolsLoaded = true;
        if (fromImportedPack) this.#resourcePoolsFromPack = true;
    }

    /**
     * @param {Record<string, { standard?: Object[], exceptional?: Object[] }>} yieldData
     */
    loadHuntYieldsFromData(yieldData) {
        if (!yieldData || typeof yieldData !== "object") return;
        this.#resolver.loadHuntYields(yieldData);
    }

    get resourcePoolsFromPack() {
        return this.#resourcePoolsFromPack;
    }

    getResourcePoolRoller() {
        return this.#resolver.resourcePoolRoller;
    }

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
     * Travel / UI gate for picking Hunt (homebrew-only worlds need compendium hunt items).
     * @param {string} terrainTag
     * @returns {{ disabled: boolean, disabledReasonKey: string|null }}
     */
    getHuntGate(terrainTag) {
        const disabledReasonKey = "ionrift-respite.travel.hunt.requires_provision";
        if (!ForageActivityValidator.isHuntAvailable(this.#resolver, terrainTag)) {
            return { disabled: true, disabledReasonKey };
        }
        return { disabled: false, disabledReasonKey: null };
    }

    resetPools() {
        this.#poolsLoaded = false;
        this.#resourcePoolsFromPack = false;
    }

    get poolsLoaded() {
        return this.#poolsLoaded;
    }

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

    setDeclaration(actorId, activity, day = null) {
        const d = day ?? this.#activeDay;
        if (activity === "forage") {
            if (!isForagingEnabled()) return;
            if (this.getForageGate(this._terrainTagForForageGate()).disabled) return;
        }
        if (activity === "hunt") {
            if (!isHuntingEnabled()) return;
            if (this.getHuntGate(this._terrainTagForForageGate()).disabled) return;
        }
        if (activity === "scout") {
            if (!isScoutingEnabled()) return;
            if (this.#effectiveSafeRestSpot()) return;
            if (!this.#scoutingAllowed) return;
            if (d !== this.#totalDays) return;
            const terrain = TerrainRegistry.get(this._terrainTagForForageGate());
            const allowed = terrain?.travelActivities ?? ["forage", "hunt", "scout"];
            if (!allowed.includes("scout")) return;
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

    setOtherCustomDC(actorId, dc, skill = "sur", day = null) {
        const d = day ?? this.#activeDay;
        const entry = this._getEntry(d, actorId);
        if (!entry || entry.activity !== "nothing") return;
        entry.customDC = dc;
        entry.customSkill = skill;
    }

    setConfirmed(actorId, day = null, value = true) {
        const d = day ?? this.#activeDay;
        this.#confirmed.set(`${d}:${actorId}`, value);
    }

    isConfirmed(actorId, day = null) {
        const d = day ?? this.#activeDay;
        return this.#confirmed.get(`${d}:${actorId}`) ?? false;
    }

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

        if (entry.activity === "hunt" && this.getHuntGate(this._terrainTagForForageGate()).disabled) {
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

    /**
     * @returns {boolean} false when the roll was ignored (already rolled or resolved).
     */
    receiveRollResult(actorId, total, day = null, natD20 = null) {
        const d = day ?? this.#activeDay;
        const entry = this._getEntry(d, actorId);
        if (!entry) return false;

        if (entry.status === "resolved") {
            console.warn(`${MODULE_ID} | Ignored duplicate travel roll for ${actorId} day ${d} (already resolved)`);
            return false;
        }
        if (entry.status === "rolled" && entry.total != null) {
            console.warn(`${MODULE_ID} | Ignored duplicate travel roll for ${actorId} day ${d} (already rolled)`);
            return false;
        }
        if (entry.status === "awaiting_loot") {
            console.warn(`${MODULE_ID} | Ignored travel skill roll for ${actorId} day ${d} (awaiting loot roll)`);
            return false;
        }

        entry.total = total;
        if (natD20 !== null) entry.natD20 = natD20;
        entry.status = "rolled";
        return true;
    }

        async processSkillRoll(actorId, day, terrainTag) {
        const entry = this._getEntry(day, actorId);
        if (!entry || entry.status !== "rolled") return null;
        if (entry.activity !== "forage" && entry.activity !== "hunt") return null;

        const actor = game.actors.get(actorId);
        if (!actor) return null;

        const skillEval = entry.activity === "forage"
            ? this.#resolver.evaluateForageSkill(actor, entry.total, entry.dc)
            : this.#resolver.evaluateHuntSkill(actor, entry.total, entry.dc);

        entry.skillEval = skillEval;

        if (!skillEval.success) {
            return await this.resolveLootAndFinish(actorId, day, terrainTag, []);
        }

        entry.status = "awaiting_loot";
        entry.lootDraws = entry.activity === "forage"
            ? ((skillEval.exceptional || skillEval.nat20) ? 2 : 1)
            : (skillEval.nat20 ? 2 : 1);
        return { awaitingLoot: true, lootDraws: entry.lootDraws };
    }

    async resolveLootAndFinish(actorId, day, terrainTag, lootRolls = []) {
        const entry = this._getEntry(day, actorId);
        if (!entry) return null;
        if (entry.status !== "awaiting_loot" && entry.status !== "rolled") return null;
        if (entry.activity !== "forage" && entry.activity !== "hunt") return null;

        const actor = game.actors.get(actorId);
        if (!actor) return null;

        const skillEval = entry.skillEval ?? (
            entry.activity === "forage"
                ? this.#resolver.evaluateForageSkill(actor, entry.total, entry.dc)
                : this.#resolver.evaluateHuntSkill(actor, entry.total, entry.dc)
        );

        let result;
        if (entry.activity === "forage") {
            result = await this.#resolver.buildForageResult(
                actor, terrainTag, entry.total, entry.dc, skillEval, lootRolls
            );
        } else {
            result = await this.#resolver.buildHuntResult(
                actor, terrainTag, entry.total, entry.dc, skillEval, lootRolls
            );
        }

        if (result.success && result.items?.length) {
            const slotKey = GrantLedger.travelSlotKey(day, actorId, entry.activity);
            await this.#resolver.grantItems(actor, result.items, {
                ledger: this.#app._grantLedger,
                slotKey
            });
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

    async resolveIndividualResult(actorId, day, terrainTag, lootRolls = []) {
        const entry = this._getEntry(day, actorId);
        if (!entry) return null;
        if (entry.status === "resolved") return null;
        if (entry.status === "awaiting_loot") {
            return await this.resolveLootAndFinish(actorId, day, terrainTag, lootRolls);
        }
        if (entry.status !== "rolled") return null;
        if (entry.activity !== "forage" && entry.activity !== "hunt") return null;

        const staged = await this.processSkillRoll(actorId, day, terrainTag);
        if (staged?.awaitingLoot) return null;
        if (staged?.day && staged?.result) {
            return {
                day: staged.day,
                activity: staged.activity,
                result: staged.result
            };
        }
        return null;
    }

    buildContext(partyActors, terrainTag) {
        const terrain = TerrainRegistry.get(terrainTag);
        const allowed = terrain?.travelActivities ?? ["forage", "hunt", "scout"];
        const { canForage, canHunt } = getTravelGatherAvailability(terrain?.travelActivities);
        const safeRest = this.#effectiveSafeRestSpot();
        const canScout = !safeRest && allowed.includes("scout") && isScoutingEnabled() && this.#scoutingAllowed;
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
                    awaitingLoot: status === "awaiting_loot",
                    lootDraws: entry?.lootDraws ?? 0,
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
                    } else if (status === "awaiting_loot") {
                        charCtx.awaitingPlayerResponse = true;
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
                characters.some(c => c.status === "rolled" || c.status === "resolved" || c.status === "awaiting_loot" || c.requested);

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
        const huntGate = this.getHuntGate(terrainTag);
        const huntDisabled = canHunt && huntGate.disabled;
        const huntDisabledReasonKey = huntDisabled ? huntGate.disabledReasonKey : null;

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
            huntDisabled,
            huntDisabledReasonKey,
            huntDisabledTooltip: huntDisabledReasonKey
                ? game.i18n.localize(huntDisabledReasonKey)
                : null,
            forageGMAdj: this.#forageDCOverride !== null
                ? ((this.forageDC - TravelResolver.FORAGE_DC >= 0 ? "+" : "") + (this.forageDC - TravelResolver.FORAGE_DC))
                : null,
            huntGMAdj: this.#huntDCOverride !== null
                ? ((this.huntDC - TravelResolver.HUNT_DC >= 0 ? "+" : "") + (this.huntDC - TravelResolver.HUNT_DC))
                : null
        };
    }

    async resolveDay(day, partyActors, terrainTag) {
        if (!this.isDayReadyToResolve(day, partyActors)) {
            try { ui.notifications?.warn("Not everyone has rolled or confirmed for this day yet."); } catch { /* noop */ }
            return;
        }

        const { isHomebrewProvisionOnly } = await import("../../../services/travel/settings/TravelSettings.js");
        if (isHomebrewProvisionOnly()) {
            const { applyTravelProvisionBatches } = await import("../../../services/travel/resolve/TravelProvisionIndex.js");
            await applyTravelProvisionBatches(this.#resolver);
            this.#poolsLoaded = this.#resolver.resourcePoolRoller.pools.size > 0;
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
                entry.status = "resolved";
                entry.result = {
                    activity: "scout",
                    actorId: actor.id,
                    actorName: actor.name,
                    total: entry.total,
                    natD20: entry.natD20 ?? null
                };
                if (!this.#effectiveSafeRestSpot()) {
                    scoutTotals.push({
                        actorId: actor.id,
                        total: entry.total,
                        actorName: actor.name,
                        natD20: entry.natD20 ?? null
                    });
                    try { await actor.setFlag(MODULE_ID, "lastTravelActivity", "scout"); } catch { /* noop */ }
                } else {
                    try { await actor.setFlag(MODULE_ID, "lastTravelActivity", "nothing"); } catch { /* noop */ }
                }
                continue;
            }

            if (entry.activity !== "forage" && entry.activity !== "hunt") {
                continue;
            }

            if (entry.status === "awaiting_loot") {
                continue;
            }

            let result;
            if (entry.activity === "forage") {
                result = await this.#resolver.resolveForageFromTotal(actor, terrainTag, entry.total, entry.dc);
            } else {
                result = await this.#resolver.resolveHuntFromTotal(actor, terrainTag, entry.total, entry.dc);
            }

            if (result.success && result.items?.length) {
                const slotKey = GrantLedger.travelSlotKey(day, actor.id, entry.activity);
                await this.#resolver.grantItems(actor, result.items, {
                    ledger: this.#app._grantLedger,
                    slotKey
                });
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
                ? `Best: ${best.actorName} (${best.total}), ${tier}`
                : `${best.actorName} rolled ${best.total}, ${tier}`;

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
     * @param {number} total - d20 + modifier
     * @param {number|null} natD20 - d20 face; required for nat20 tier (same breakpoints as old setup UI)
     */
    _totalToScoutTier(total, natD20 = null) {
        if (total <= 1) return "nat1";
        if (total < 10) return "poor";
        if (total < 15) return "average";
        if (natD20 === 20) return "nat20";
        return "good";
    }

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
        return active.every(e => {
            if (e.activity === "forage" || e.activity === "hunt") {
                return e.status === "resolved";
            }
            return e.status === "rolled" || e.status === "resolved";
        });
    }

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

    getScoutingDebrief(terrainTag) {
        if (!isScoutingEnabled()) return null;
        if (this.#effectiveSafeRestSpot()) return null;
        if (!this.#scoutingResult) return null;

        const terrain = TerrainRegistry.get(terrainTag);
        const effects = SCOUTING_EFFECTS[this.#scoutingResult] ?? SCOUTING_EFFECTS.none;
        const isNat1 = this.#scoutingResult === "nat1";

        const TIER_LABELS = {
            nat1: "Nat 1: Hidden Complication",
            poor: "Poor", average: "Average", good: "Good",
            nat20: "Nat 20: Perfect Campsite"
        };

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
                    skillEval: e.skillEval ?? null,
                    lootDraws: e.lootDraws ?? 0,
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
        const survAdapter = game.ionrift?.respite?.adapter;
        const surTotal = survAdapter ? survAdapter.getSkillTotal(actor, survAdapter.normalizeSkillKey("sur")) : (actor.system?.skills?.sur?.total ?? 0);
        const natTotal = survAdapter ? survAdapter.getSkillTotal(actor, survAdapter.normalizeSkillKey("nat")) : (actor.system?.skills?.nat?.total ?? 0);
        const best = Math.max(surTotal, natTotal);
        const sign = best >= 0 ? "+" : "";
        return `${sign}${best}`;
    }
}
