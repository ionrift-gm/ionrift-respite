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
import { getPartyActors } from "../../../services/party/partyActors.js";
import {
    executePlayerRoll,
    waitForDiceSoNice,
    postRollToChat
} from "../../../services/ui/rollRequest/RollRequestManager.js";
import {
    emitTravelDeclaration,
    emitTravelDeclarationsSync,
    emitTravelRollRequest,
    emitTravelRollResult,
    emitTravelLootRollPrompt,
    emitTravelLootRollResult,
    emitTravelDebrief,
    emitPhaseChanged
} from "../../../services/socket/SocketController.js";
import { applyPlayerTravelDeclarationToGm } from "../../../services/travel/settings/travelDeclarationSync.js";

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

    /** Public alias for extracted RestSetupApp method bodies that use this._app. */
    get _app() {
        return this.#app;
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
    async onSelfRollTravelCheck(event, target) {
        const app = this._app;

        event.preventDefault?.();
        const actorId = target.dataset.actorId;
        const day = parseInt(target.dataset.day) || (app._travelActiveDay ?? 1);
        const activity = target.dataset.activity;
        const dc = parseInt(target.dataset.dc) || 0;
        if (!actorId || !activity) return;

        const actor = game.actors.get(actorId);
        if (!actor || !actor.isOwner) return;

        if (app._playerTravelRolled?.[day]?.[actorId]) return;
        if (app._syncedTravelRolled?.[day]?.[actorId]) return;
        if (app._syncedTravelResolved?.[day]?.[actorId]) return;

        if (activity === "forage") {
            const terrainTag = app._selectedTerrain ?? app._engine?.terrainTag ?? "forest";
            const gate = app._travel?.getForageGate?.(terrainTag);
            if (gate?.disabled) {
                try {
                    ui.notifications?.warn(game.i18n.localize(
                        gate.disabledReasonKey ?? "ionrift-respite.travel.forage.requires_pack"
                    ));
                } catch { /* noop */ }
                return;
            }
        }

        // Confirm the declaration to the GM first
        emitTravelDeclaration({
                    declarations: { [actorId]: activity },
                    confirmed: true,
                    day,
                    userId: game.user.id
                });

        if (!app._playerTravelConfirmed) app._playerTravelConfirmed = {};
        if (!app._playerTravelConfirmed[day]) app._playerTravelConfirmed[day] = {};
        app._playerTravelConfirmed[day][actorId] = true;

        let modifier, flavor;
        const _adapter = game.ionrift?.respite?.adapter;
        if (activity === "scout") {
            const prc = _adapter ? _adapter.getSkillTotal(actor, "prc") : (actor.system?.skills?.prc?.total ?? 0);
            const sur = _adapter ? _adapter.getSkillTotal(actor, "sur") : (actor.system?.skills?.sur?.total ?? 0);
            modifier = Math.max(prc, sur);
            const skillLabel = prc >= sur ? "Perception" : "Survival";
            flavor = `<strong>${actor.name}</strong> - Scout (${skillLabel})`;
        } else {
            const sur = _adapter ? _adapter.getSkillTotal(actor, "sur") : (actor.system?.skills?.sur?.total ?? 0);
            const nat = _adapter ? _adapter.getSkillTotal(actor, "nat") : (actor.system?.skills?.nat?.total ?? 0);
            modifier = Math.max(sur, nat);
            const actLabel = activity === "forage" ? "Forage" : "Hunt";
            flavor = `<strong>${actor.name}</strong> - ${actLabel} (Survival)${dc ? ` DC ${dc}` : ""}`;
        }

        target.disabled = true;
        target.innerHTML = `<i class="fas fa-spinner fa-spin"></i>`;

        const roll = await new Roll(`1d20 + ${modifier}`).evaluate();
        await roll.toMessage({
            speaker: ChatMessage.getSpeaker({ actor }),
            flavor
        });

        if (game.modules.get("dice-so-nice")?.active) {
            await new Promise(resolve => {
                const timeout = setTimeout(resolve, 5000);
                Hooks.once("diceSoNiceRollComplete", () => {
                    clearTimeout(timeout);
                    resolve();
                });
            });
        }

        if (!app._playerTravelRolled) app._playerTravelRolled = {};
        if (!app._playerTravelRolled[day]) app._playerTravelRolled[day] = {};
        app._playerTravelRolled[day][actorId] = true;

        emitTravelRollResult({
                    actorId,
                    actorName: actor.name,
                    total: roll.total,
                    natD20: getNatD20FromRoll(roll),
                    day
                });

        ui.notifications.info(`${actor.name} rolled ${roll.total}.`);
        app.render();
    
    }

    async onResolveTravelDay(event, target) {
        const app = this._app;

        if (!game.user.isGM) return;
        const day = parseInt(target.dataset.day) || app._travel.activeDay;
        const partyActors = getPartyActors();
        const terrainTag = app._engine?.terrainTag ?? app._selectedTerrain ?? "forest";

        await app._travel.resolveDay(day, partyActors, terrainTag);

        if (app._travel.isFullyResolved()) {
            app._applyScoutingFromTravel();
        }

        const perPlayerResults = {};
        const allTravelPlayerUserIds = new Set();
        for (const actor of partyActors) {
            const ownerIds = Object.entries(actor.ownership ?? {})
                .filter(([id, level]) => level >= 3 && id !== "default")
                .map(([id]) => id);
            for (const uid of ownerIds) {
                allTravelPlayerUserIds.add(uid);
            }
            const debrief = app._travel.getPlayerDebrief(actor.id);
            for (const uid of ownerIds) {
                if (!perPlayerResults[uid]) perPlayerResults[uid] = [];
                perPlayerResults[uid].push(...debrief);
            }
        }

        const scoutingDebrief = app._travel.getScoutingDebrief(terrainTag);
        app._scoutingDebrief = scoutingDebrief;

        // Send debrief to each player with a character in the party (include empty `results` so flags still apply)
        for (const userId of allTravelPlayerUserIds) {
            emitTravelDebrief({
                    targetUserId: userId,
                    results: perPlayerResults[userId] ?? [],
                    scoutingDone: !!scoutingDebrief,
                    fullyResolved: app._travel.isFullyResolved()
                });
        }

        // Auto-advance to camp phase as soon as all days are resolved ,  no second click needed.
        if (app._travel.isFullyResolved()) {
            app._phase = "camp";
            app._campStep2Entered = false;
            if (await app._skipCampForTheater()) return;
            if (await app._skipCampForSafeRest()) return;
            // Comfort off: waive the Make Camp fire phase
            if (await app._skipCampForComfortOff()) return;
            app._broadcastMakeCampPhaseSync();
            await app._saveRestState();
            app.render();
            return;
        }

        emitPhaseChanged("travel", {
                activeDay: app._travel.activeDay,
                fullyResolved: app._travel.isFullyResolved(),
                scoutingDone: !!scoutingDebrief
            });

        await app._saveRestState();
        app.render();
    
    }

    receiveTravelRollResult(data) {
        const app = this._app;

        const day = data.day ?? app._travel.activeDay;
        const accepted = app._travel.receiveRollResult(
            data.actorId, data.total, day, data.natD20 ?? null
        );
        if (!accepted) return;

        emitPhaseChanged("travel", {
                travelRollUpdate: {
                    actorId: data.actorId,
                    actorName: data.actorName,
                    total: data.total,
                    day
                }
            });

        app.render();

        const terrainTag = app._engine?.terrainTag ?? app._selectedTerrain ?? "forest";
        const entry = app._travel._getEntry(day, data.actorId);
        if (!entry || (entry.activity !== "forage" && entry.activity !== "hunt")) {
            void app._saveRestState();
            return;
        }

        void (async () => {
            try {
                const staged = await app._travel.processSkillRoll(data.actorId, day, terrainTag);
                this._broadcastTravelDeclarations();

                if (staged?.awaitingLoot) {
                    const actor = game.actors.get(data.actorId);
                    if (actor) {
                        const ownerIds = Object.entries(actor.ownership ?? {})
                            .filter(([id, level]) => id !== "default" && level >= 3)
                            .map(([id]) => id);
                        for (const uid of ownerIds) {
                            emitTravelLootRollPrompt({
                                targetUserId: uid,
                                actorId: data.actorId,
                                actorName: data.actorName ?? actor.name,
                                day,
                                activity: entry.activity,
                                lootDraws: staged.lootDraws
                            });
                        }
                    }
                    return;
                }

                if (staged?.result) {
                    await this.emitTravelIndividualDebriefForRow(staged, data.actorId);
                }
            } catch (err) {
                console.error("[Respite] processSkillRoll", err);
            } finally {
                await app._saveRestState();
                app.render();
            }
        })();
    
    }

    _broadcastTravelDeclarations() {
        const app = this._app;

        const allDayDeclarations = {};
        const rolledByDay = {};
        const resolvedByDay = {};
        const awaitingLootByDay = {};
        const travelEntries = app._travel.serialize()?.entries ?? {};

        for (const [key, entry] of Object.entries(travelEntries)) {
            const colon = key.indexOf(":");
            if (colon < 0) continue;
            const day = parseInt(key.slice(0, colon), 10);
            const actorId = key.slice(colon + 1);
            if (!day || !actorId) continue;
            if (entry.status === "rolled" || entry.status === "resolved" || entry.status === "awaiting_loot") {
                rolledByDay[day] ??= {};
                rolledByDay[day][actorId] = true;
            }
            if (entry.status === "awaiting_loot") {
                awaitingLootByDay[day] ??= {};
                awaitingLootByDay[day][actorId] = {
                    lootDraws: entry.lootDraws ?? 1,
                    activity: entry.activity
                };
            }
            if (entry.status === "resolved") {
                resolvedByDay[day] ??= {};
                resolvedByDay[day][actorId] = true;
            }
        }

        for (let d = 1; d <= app._travel.totalDays; d++) {
            const decl = app._travel.getDayDeclarations(d);
            const confirmed = {};
            for (const actorId of Object.keys(decl)) {
                if (app._travel.isConfirmed(actorId, d)) confirmed[actorId] = true;
            }
            decl._confirmed = confirmed;
            allDayDeclarations[d] = decl;
        }
        emitTravelDeclarationsSync({
                    declarations: allDayDeclarations,
                    rolled: rolledByDay,
                    resolved: resolvedByDay,
                    awaitingLoot: awaitingLootByDay,
                    activeDay: app._travel.activeDay,
                    totalDays: app._travel.totalDays,
                    scoutingAllowed: app._travel.scoutingAllowed,
                    forageDC: app._travel.forageDC,
                    huntDC: app._travel.huntDC,
                    travelGather: app._buildTravelGatherPayload()
                });
    
    }

    _applyPlayerTravelRestore(pt) {
        const app = this._app;

        if (!pt || app._isGM) return;

        if (pt.totalDays != null) app._travelTotalDays = pt.totalDays;
        if (pt.activeDay != null) app._travelActiveDay = pt.activeDay;
        if (pt.forageDC != null) app._travelForageDC = pt.forageDC;
        if (pt.huntDC != null) app._travelHuntDC = pt.huntDC;
        if (pt.scoutingAllowed != null) app._travelScoutingAllowed = pt.scoutingAllowed;

        if (pt.declarations) {
            app._playerTravelDeclarations = foundry.utils.mergeObject(
                app._playerTravelDeclarations ?? {},
                pt.declarations,
                { inplace: false, insertKeys: true, insertValues: true }
            );
        }
        if (pt.confirmed) {
            app._playerTravelConfirmed = foundry.utils.mergeObject(
                app._playerTravelConfirmed ?? {},
                pt.confirmed,
                { inplace: false, insertKeys: true, insertValues: true }
            );
        }
        if (pt.rolled) {
            app._playerTravelRolled = foundry.utils.mergeObject(
                app._playerTravelRolled ?? {},
                pt.rolled,
                { inplace: false, insertKeys: true, insertValues: true }
            );
        }
        if (pt.awaitingLoot) {
            app._playerTravelAwaitingLoot = foundry.utils.mergeObject(
                app._playerTravelAwaitingLoot ?? {},
                pt.awaitingLoot,
                { inplace: false, insertKeys: true, insertValues: true }
            );
        }
        if (pt.debrief?.length) {
            const merged = [...(app._travelDebrief ?? [])];
            for (const row of pt.debrief) {
                const actorId = row.result?.actorId;
                const dup = merged.some(
                    d => d.day === row.day && d.result?.actorId === actorId
                );
                if (!dup) merged.push(row);
            }
            app._travelDebrief = merged;
        }
        if (pt.fullyResolved != null) app._travelFullyResolved = !!pt.fullyResolved;
        if (pt.scoutingDone != null) app._travelScoutingDone = !!pt.scoutingDone;
    
    }

    async onRollTravelCheck(event, target) {
        const app = this._app;

        event.preventDefault?.();
        const actorId = target.dataset.characterId ?? target.dataset.actorId;
        const day = parseInt(target.dataset.day) || 1;
        if (!actorId) return;

        const actor = game.actors.get(actorId);
        if (!actor || !actor.isOwner) return;

        const pending = app._pendingTravelRoll;
        if (!pending) return;
        const entry = pending.activities?.find(a => a.actorId === actorId);
        if (!entry) return;
        if (pending.rolledCharacters?.has(actorId)) return;

        let skillKey = entry.skill ?? "sur";
        let flavor;
        const dc = entry.dc ?? 0;

        if (entry.activity === "scout") {
            skillKey = pickBestSkill(actor, ["prc", "sur"]);
            const skillLabel = skillKey === "prc" ? "Perception" : "Survival";
            flavor = `<strong>${actor.name}</strong> - Scout (${skillLabel})`;
        } else if (entry.activity === "other") {
            skillKey = entry.skill ?? "sur";
            flavor = `<strong>${actor.name}</strong> - ${entry.skillName ?? "Survival"} DC ${entry.dc}`;
        } else {
            skillKey = pickBestSkill(actor, ["sur", "nat"]);
            const actLabel = entry.activity === "forage" ? "Forage" : "Hunt";
            flavor = `<strong>${actor.name}</strong> - ${actLabel} (Survival) DC ${entry.dc}`;
        }

        const { total, roll } = await executePlayerRoll(actor, skillKey, dc, flavor, target);

        if (!pending.rolledCharacters) pending.rolledCharacters = new Set();
        pending.rolledCharacters.add(actorId);

        emitTravelRollResult({
                    actorId,
                    actorName: actor.name,
                    total,
                    natD20: getNatD20FromRoll(roll),
                    day
                });

        ui.notifications.info(`${actor.name} rolled ${total}.`);
        app.render();
    
    }

    async onSkipTravelPhase(event, target) {
        const app = this._app;

        if (!game.user.isGM) return;

        if (app._travel && !app._travel.isFullyResolved() && app._travel.hasDeclarations()) {
            const confirmed = await new Promise(resolve => {
                const overlay = document.createElement("div");
                overlay.classList.add("ionrift-armor-modal-overlay");
                overlay.innerHTML = `
                    <div class="ionrift-armor-modal">
                        <h3><i class="fas fa-exclamation-triangle"></i> Unresolved Travel Activities</h3>
                        <p>Not all travel days have been resolved. Characters with pending foraging, hunting, or scouting rolls will lose their results.</p>
                        <p>Are you sure you want to skip?</p>
                        <div class="ionrift-armor-modal-buttons">
                            <button class="btn-armor-confirm"><i class="fas fa-forward"></i> Skip Anyway</button>
                            <button class="btn-armor-cancel"><i class="fas fa-clock"></i> Go Back</button>
                        </div>
                    </div>`;
                document.body.appendChild(overlay);
                overlay.querySelector(".btn-armor-confirm").addEventListener("click", () => { overlay.remove(); resolve(true); });
                overlay.querySelector(".btn-armor-cancel").addEventListener("click", () => { overlay.remove(); resolve(false); });
            });
            if (!confirmed) return;
        }

        if (app._travel?.scoutingResult) {
            app._applyScoutingFromTravel();
        }

        app._phase = "camp";
        app._campStep2Entered = false;

        if (await app._skipCampForTheater()) return;
        if (await app._skipCampForSafeRest()) return;
        // Comfort off: waive the Make Camp fire phase
        if (await app._skipCampForComfortOff()) return;

        app._broadcastMakeCampPhaseSync();

        app._saveRestState();
        app.render();
    
    }

    async onRollTravelLoot(event, target) {
        const app = this._app;

        event.preventDefault?.();
        const actorId = target.dataset.actorId;
        const day = parseInt(target.dataset.day) || 1;
        const draws = parseInt(target.dataset.draws) || 1;
        if (!actorId) return;

        const actor = game.actors.get(actorId);
        if (!actor || !actor.isOwner) return;

        const activity = target.dataset.activity ?? "forage";
        const actLabel = activity === "hunt" ? "Hunt yield" : "Forage loot";
        const rolls = [];

        target.disabled = true;
        target.innerHTML = `<i class="fas fa-spinner fa-spin"></i>`;

        for (let index = 0; index < draws; index++) {
            const flavor = draws > 1
                ? `<strong>${actor.name}</strong> - ${actLabel} (${index + 1}/${draws})`
                : `<strong>${actor.name}</strong> - ${actLabel}`;
            const roll = await new Roll("1d100").evaluate();
            await postRollToChat(actor, roll, flavor);
            await waitForDiceSoNice();
            rolls.push(roll.total);
        }

        if (app._playerTravelAwaitingLoot?.[day]) {
            delete app._playerTravelAwaitingLoot[day][actorId];
        }

        emitTravelLootRollResult({
            actorId,
            actorName: actor.name,
            rolls,
            day
        });

        ui.notifications.info(`${actor.name} rolled loot (${rolls.join(", ")}).`);
        app.render();
    
    }

    onRequestTravelRolls(event, target) {
        const app = this._app;

        if (!game.user.isGM) return;
        const day = parseInt(target.dataset.day) || app._travel.activeDay;
        const payloads = app._travel.getAllRollRequestPayloads(day);
        if (!payloads.length) return;

        for (const p of payloads) {
            app._travel.markRequested(p.actorId, day);
        }

        emitTravelRollRequest({
                    activities: payloads,
                    day
                });

        emitPhaseChanged("travel", {
                travelRollRequest: { activities: payloads, day }
            });

        ui.notifications.info(`Day ${day} roll requests sent to ${payloads.length} character(s).`);
        app._saveRestState();
        app.render();
    
    }

    onAdjustGlobalDC(event, target) {
        const app = this._app;

        event.preventDefault?.();
        if (!game.user.isGM) return;
        const activity = target.dataset.activity;
        const delta = parseInt(target.dataset.delta) || 0;
        if (!activity || !delta) return;
        app._travel.adjustGlobalDC(activity, delta);
        app._saveRestState();
        app.render();
    
    }

    async onRollTravelForPlayer(event, target) {
        const app = this._app;

        if (!game.user.isGM) return;
        const actorId = target.dataset.actorId;
        const day = parseInt(target.dataset.day) || app._travel.activeDay;
        if (!actorId) return;

        const entry = app._travel._getEntry(day, actorId);
        if (!entry) return;
        if (entry.status !== "idle" && entry.status !== "requested") return;

        if (entry.activity === "nothing" && !entry.customDC) return;

        const actor = game.actors.get(actorId);
        if (!actor) return;

        let skills, dcLabel;
        if (entry.activity === "scout") {
            skills = ["prc", "sur"];
            dcLabel = "Scout";
        } else if (entry.activity === "nothing" && entry.customDC) {
            skills = [entry.customSkill ?? "sur"];
            dcLabel = `Other (DC ${entry.customDC})`;
        } else {
            skills = ["sur", "nat"];
            dcLabel = entry.activity === "forage" ? "Forage (Survival)" : "Hunt (Survival)";
        }

        const result = await rollForPlayer(actor, skills, entry.customDC ?? entry.dc ?? 0, dcLabel);

        app.receiveTravelRollResult({
            actorId,
            actorName: actor.name,
            total: result.total,
            natD20: result.natD20,
            day
        });
    
    }

    receiveTravelLootRollResult(data) {
        const app = this._app;

        const day = data.day ?? app._travel.activeDay;
        const entry = app._travel._getEntry(day, data.actorId);
        if (!entry || entry.status !== "awaiting_loot") return;

        emitPhaseChanged("travel", {
            travelLootRollUpdate: {
                actorId: data.actorId,
                actorName: data.actorName,
                rolls: data.rolls,
                day
            }
        });

        app.render();

        const terrainTag = app._engine?.terrainTag ?? app._selectedTerrain ?? "forest";
        void (async () => {
            try {
                const row = await app._travel.resolveLootAndFinish(
                    data.actorId,
                    day,
                    terrainTag,
                    data.rolls ?? []
                );
                if (row) {
                    await this.emitTravelIndividualDebriefForRow(row, data.actorId);
                }
                app._broadcastTravelDeclarations();
            } catch (err) {
                console.error("[Respite] resolveLootAndFinish", err);
            } finally {
                await app._saveRestState();
                app.render();
            }
        })();
    
    }

    async onRollTravelLootForPlayer(event, target) {
        const app = this._app;

        if (!game.user.isGM) return;
        const actorId = target.dataset.actorId;
        const day = parseInt(target.dataset.day) || app._travel.activeDay;
        if (!actorId) return;

        const entry = app._travel._getEntry(day, actorId);
        if (!entry || entry.status !== "awaiting_loot") return;

        const actor = game.actors.get(actorId);
        if (!actor) return;

        const draws = entry.lootDraws ?? 1;
        const activity = entry.activity;
        const actLabel = activity === "hunt" ? "Hunt yield" : "Forage loot";
        const rolls = [];

        for (let index = 0; index < draws; index++) {
            const flavor = draws > 1
                ? `<strong>${actor.name}</strong> - ${actLabel} (${index + 1}/${draws})`
                : `<strong>${actor.name}</strong> - ${actLabel}`;
            const roll = await new Roll("1d100").evaluate();
            await postRollToChat(actor, roll, flavor);
            await waitForDiceSoNice();
            rolls.push(roll.total);
        }

        this.receiveTravelLootRollResult({
            actorId,
            actorName: actor.name,
            rolls,
            day
        });
    
    }

    onRequestOtherRoll(event, target) {
        const app = this._app;

        if (!game.user.isGM) return;
        const actorId = target.dataset.actorId;
        const day = parseInt(target.dataset.day) || app._travel.activeDay;
        if (!actorId) return;

        const row = target.closest(".travel-other-inline");
        const dcInput = row?.querySelector(".travel-other-dc-input");
        const dc = parseInt(dcInput?.value) || 12;

        app._travel.setOtherCustomDC(actorId, dc, "sur", day);
        app._travel.markRequested(actorId, day);

        const payload = app._travel.getRollRequestPayload(actorId, day);
        if (!payload) return;

        emitTravelRollRequest({
                    activities: [payload],
                    day
                });

        emitPhaseChanged("travel", {
                travelRollRequest: { activities: [payload], day }
            });

        ui.notifications.info(`Custom roll request (DC ${dc}) sent for ${game.actors.get(actorId)?.name ?? "character"}.`);
        app._saveRestState();
        app.render();
    
    }

    async onResolveTravelPhase(event, target) {
        const app = this._app;

        const partyActors = getPartyActors();
        const terrainTag = app._engine?.terrainTag ?? app._selectedTerrain ?? "forest";

        await app._travel.resolveAll(partyActors, terrainTag);
        this._applyScoutingFromTravel();

        app._phase = "camp";
        app._campStep2Entered = false;

        if (await app._skipCampForTheater()) return;
        if (await app._skipCampForSafeRest()) return;
        // Comfort off: waive the Make Camp fire phase
        if (await app._skipCampForComfortOff()) return;

        app._broadcastMakeCampPhaseSync();

        await app._saveRestState();
        app.render();
    
    }

    receiveTravelDeclaration(data) {
        const app = this._app;

        const { applied, rejected } = applyPlayerTravelDeclarationToGm({
            travel: app._travel,
            actorLookup: id => game.actors.get(id),
            data
        });
        if (rejected.length) {
            for (const r of rejected) {
                console.warn(`${MODULE_ID} | travel declaration rejected for ${r.actorId}: ${r.reason}`);
            }
        }
        if (!applied.length) return;

        // GM's own render still fires so the confirmation badge appears even if
        // the player-side sync errors.
        try {
            app._broadcastTravelDeclarations();
        } catch (err) {
            console.error(`${MODULE_ID} | _broadcastTravelDeclarations failed`, err);
        }
        app._saveRestState();
        app.render();
    
    }

    _applyScoutingFromTravel() {
        const app = this._app;

        if (!app._engine) return;
        if (!isScoutingEnabled() || app._travel?.isEffectiveSafeRestSpot?.()) {
            app._engine.scoutingResult = "none";
            app._engine.scoutingComplication = false;
            if (!app._engine._encounterBreakdown) app._engine._encounterBreakdown = {};
            app._engine._encounterBreakdown.scouting = 0;
            app._engine._encounterBreakdown.scoutingResult = "none";
            const bd = app._engine._encounterBreakdown;
            app._engine.shelterEncounterMod = (bd.shelter ?? 0) + (bd.weather ?? 0);
            return;
        }
        const effects = app._travel.scoutingEffects;
        const tier = app._travel.scoutingResult ?? "none";

        app._engine.scoutingResult = tier;
        app._engine.scoutingComplication = effects.complication;

        if (!app._engine._encounterBreakdown) app._engine._encounterBreakdown = {};
        app._engine._encounterBreakdown.scouting = effects.encounterDC;
        app._engine._encounterBreakdown.scoutingResult = tier;

        // Recalculate total shelter encounter mod. Scouting stays in the
        // breakdown only; getEffectiveEncounterDC adds it once from there.
        const bd = app._engine._encounterBreakdown;
        app._engine.shelterEncounterMod = (bd.shelter ?? 0) + (bd.weather ?? 0);

        if (effects.comfortBonus > 0) {
            let rank = COMFORT_RANK[app._engine.comfort] ?? 0;
            rank = Math.min(COMFORT_RANK.safe, rank + effects.comfortBonus);
            app._engine.comfort = RANK_TO_KEY[rank];
        }
    
    }


}
