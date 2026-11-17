import { MODULE_ID } from "../../data/moduleId.js";
import { CampLogisticsDelegate } from "../delegates/camp/CampLogisticsDelegate.js";
import { getPartyActors } from "../../services/party/partyActors.js";
import { ActivityBudgetDelegate } from "./ActivityBudgetDelegate.js";
import {
    registerRestSessionApp,
    unregisterRestSessionApp,
    drainPendingRestSessionDeltas
} from "../../services/rest/session/RestSessionSync.js";
import { DOWNTIME_STATE_SCHEMA } from "../../services/rest/session/restSessionSchemas.js";
import { CampGearScanner } from "../../services/camp/gear/CampGearScanner.js";
import { _showGmRestIndicator, _removeGmRestIndicator, setRespiteFlowActive } from "../../module.js";
import { WorkbenchDelegate } from "../delegates/crafting/WorkbenchDelegate.js";
import { DetectMagicDelegate } from "../delegates/crafting/DetectMagicDelegate.js";
import { normalizeGatheringSchedule } from "./DowntimeSustenanceBuilder.js";
import { applyDowntimeSyncAndRenderHelpers } from "./DowntimeSyncAndRenderHelpers.js";
import { DowntimePlanningActions, applyDowntimePlanningHelpers } from "./DowntimePlanningAndSustenanceActions.js";
import { DowntimeActivityAndNightActions } from "./DowntimeActivityAndNightActions.js";
import { DowntimeResolutionActions, applyDowntimeResolutionHelpers } from "./DowntimeResolutionAndWorkbenchActions.js";

const GATHERING_DAYS = 7;

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Downtime Ledger Application.
 * Single-screen 7-day downtime management for Gritty Realism Long Rests.
 */
export class DowntimeLedgerApp extends HandlebarsApplicationMixin(ApplicationV2) {

    static DEFAULT_OPTIONS = {
        id: "ionrift-downtime-ledger",
        classes: ["ionrift-window", "glass-ui", "ionrift-respite-app", "downtime-ledger-window"],
        tag: "div",
        window: {
            title: "ionrift-respite.downtimeLedger.titleCampPlanning",
            resizable: true
        },
        position: {
            width: 820,
            height: "auto"
        },
        actions: {
            toggleUiTheme: DowntimeLedgerApp.#onToggleUiTheme,
            abandonDowntime: DowntimeLedgerApp.#onAbandonDowntime,
            setHaven: DowntimeLedgerApp.#onSetHaven,
            switchTab: DowntimeLedgerApp.#onSwitchTab,
            selectRosterCharacter: DowntimeLedgerApp.#onSelectRosterCharacter,
            switchWorkflow: DowntimeLedgerApp.#onSwitchWorkflow,
            rollExhaustionSave: DowntimeLedgerApp.#onRollExhaustionSave,
            toggleExamine: DowntimeLedgerApp.#onToggleExamine,
            toggleLogisticsDrawer: DowntimeLedgerApp.#onToggleLogisticsDrawer,
            stepFoodDays: DowntimeLedgerApp.#onStepFoodDays,
            stepPatronDays: DowntimeLedgerApp.#onStepFoodDays,
            clearActivity: DowntimeLedgerApp.#onClearActivity,
            dumpActivity: DowntimeLedgerApp.#onDumpActivity,
            stepActivity: DowntimeLedgerApp.#onStepActivity,
            toggleDrillDown: DowntimeLedgerApp.#onToggleDrillDown,
            rollNightCheck: DowntimeLedgerApp.#onRollNightCheck,
            improviseNightCheck: DowntimeLedgerApp.#onImproviseNightCheck,
            pickPoolNightEvent: DowntimeLedgerApp.#onPickPoolNightEvent,
            setNightQuiet: DowntimeLedgerApp.#onSetNightQuiet,
            improviseNightOverride: DowntimeLedgerApp.#onImproviseNightOverride,
            setNightSeverity: DowntimeLedgerApp.#onSetNightSeverity,
            toggleNightsVariant: DowntimeLedgerApp.#onToggleNightsVariant,
            rerollNight: DowntimeLedgerApp.#onRerollNight,
            dropNight: DowntimeLedgerApp.#onDropNight,
            cycleNightState: DowntimeLedgerApp.#onCycleNightState,
            selectNominatedFood: DowntimeLedgerApp.#onSelectNominatedFood,
            stepNominatedFood: DowntimeLedgerApp.#onStepNominatedFood,
            selectDepartureMeal: DowntimeLedgerApp.#onSelectDepartureMeal,
            selectDepartureDrink: DowntimeLedgerApp.#onSelectDepartureDrink,
            toggleTierReveal: DowntimeLedgerApp.#onToggleTierReveal,
            rerollAllDraft: DowntimeLedgerApp.#onRerollAllDraft,
            adjustDraftDC: DowntimeLedgerApp.#onAdjustDraftDC,
            adjustNightDC: DowntimeLedgerApp.#onAdjustNightDC,
            adjustSustenanceDC: DowntimeLedgerApp.#onAdjustSustenanceDC,
            giftWood: DowntimeLedgerApp.#onGiftWood,
            toggleGearFactor: DowntimeLedgerApp.#onToggleGearFactor,
            toggleGatheringDay: DowntimeLedgerApp.#onToggleGatheringDay,
            rollGatheringDay: DowntimeLedgerApp.#onRollGatheringDay,
            rollAllGathering: DowntimeLedgerApp.#onRollAllGathering,
            rollActivityDay: DowntimeLedgerApp.#onRollActivityDay,
            rollAllActivities: DowntimeLedgerApp.#onRollAllActivities,
            commitActivities: DowntimeLedgerApp.#onCommitActivities,
            unlockActivities: DowntimeLedgerApp.#onUnlockActivities,
            openCraftQueue: DowntimeLedgerApp.#onOpenCraftQueue,
            selectSustenanceRole: DowntimeLedgerApp.#onSelectSustenanceRoleLegacy,
            rollSustenance: DowntimeLedgerApp.#onRollSustenanceLegacy,
            proceedToResolutionFlow: DowntimeLedgerApp.#onProceedToResolutionFlow,
            returnToPlanning: DowntimeLedgerApp.#onReturnToPlanning,
            setPacingNight: DowntimeLedgerApp.#onSetPacingNight,
            nextPacingNight: DowntimeLedgerApp.#onNextPacingNight,
            applyMealBuffs: DowntimeLedgerApp.#onApplySendoffBuffs,
            applyOneMealBuff: DowntimeLedgerApp.#onApplyOneSendoffBuff,
            previousPacingNight: DowntimeLedgerApp.#onPreviousPacingNight,
            minimizeForCombat: DowntimeLedgerApp.#onMinimizeForCombat,
            completeCombatForNight: DowntimeLedgerApp.#onCompleteCombatForNight,
            resolveDowntime: DowntimeLedgerApp.#onResolveDowntime,
            toggleIdentifyDrawer: DowntimeLedgerApp.#onToggleIdentifyDrawer,
            stationDetectMagicScan: DowntimeLedgerApp.#onStationDetectMagicScan,
            stationIdentifyScannedItem: DowntimeLedgerApp.#onStationIdentifyScannedItem,
            submitWorkbenchIdentify: DowntimeLedgerApp.#onSubmitWorkbenchIdentify,
            workbenchIdentifyRemovePotion: DowntimeLedgerApp.#onWorkbenchIdentifyRemovePotion,
            dismissWorkbenchIdentifyAck: DowntimeLedgerApp.#onDismissWorkbenchIdentifyAck,
            clearSustenanceFood: DowntimeLedgerApp.#onClearSustenanceFood,
            assignSustenanceFood: DowntimeLedgerApp.#onAssignSustenanceFood,
            clearSustenanceWater: DowntimeLedgerApp.#onClearSustenanceWater,
            lockMeals: DowntimeLedgerApp.#onLockMeals,
            unlockMeals: DowntimeLedgerApp.#onUnlockMeals,
            toggleMustRollExhaustion: DowntimeLedgerApp.#onToggleMustRollExhaustion,
            setExhaustionAdvMode: DowntimeLedgerApp.#onSetExhaustionAdvMode,
            rollActorExhaustionSave: DowntimeLedgerApp.#onRollActorExhaustionSave,
            rollAllExhaustionSaves: DowntimeLedgerApp.#onRollAllExhaustionSaves,
            waiveAllExhaustionSaves: DowntimeLedgerApp.#onWaiveAllExhaustionSaves,
            adjustExhaustionDC: DowntimeLedgerApp.#onAdjustExhaustionDC,
            toggleExhaustionOverride: DowntimeLedgerApp.#onToggleExhaustionOverride
        }
    };

    static PARTS = {
        main: {
            template: "modules/ionrift-respite/templates/downtime/downtime-ledger.hbs",
            scrollable: [".downtime-gm-roster", ".downtime-player-roster", ".window-content"]
        }
    };

    /** @type {WorkbenchDelegate} */
    _workbench;

    /** @type {DetectMagicDelegate} */
    _detectMagic;

    /** @type {Map<string, object>} actorId -> staging */
    _workbenchIdentifyStaging = new Map();

    /** @type {Map<string, object>} actorId -> ack */
    _workbenchIdentifyAcknowledge = new Map();

    /** @type {Set<string>} actorIds whose submit is processing */
    _workbenchIdentifySubmitPending = new Set();

    /** @type {Set<string>} actorIds who used focus */
    _workbenchFocusUsed = new Set();

    /** @type {Map<string, number>} actorId -> count of items focused */
    _workbenchFocusCounts = new Map();

    /** @type {object|null} */
    _magicScanResults = null;

    /** @type {boolean} */
    _magicScanComplete = false;

    /** @type {number|null} */
    _workbenchHookId = null;

    /** @type {ActivityBudgetDelegate} */
    _budgetDelegate;

    /** @type {number} */

    /** @type {Map<string, {itemId: string, quantity: number}>} actorId -> nominated food */
    _foodNominations = new Map();

    /** @type {Map<string, string>} actorId -> departure meal itemId */
    _departureMeals = new Map();

    /** actorId -> { food: { [dayIndex]: ""|{itemId,name} }, water: { [dayIndex]: pours[] } } */
    _sustenanceEdits = new Map();

    /** Last rendered slots, so a click can find the first open day. */
    _sustenanceSnapshot = new Map();

    /** @type {Map<string, string>} actorId -> departure drink itemId */
    _departureDrinks = new Map();

    /** @type {Map<string, Set<string>>} actorId -> Set of expanded tier keys ('activities' | 'gathering' | 'sustenance') */
    _expandedTiers = new Map();

    /** @type {Set<string>} */
    _drilledDownActorIds = new Set();

    /** @type {Set<string>} actorIds whose activities are committed/locked in */
    _committedActorIds = new Set();

    /** @type {Set<string>} actorIds whose food and water plan is locked */
    _mealsLockedActorIds = new Set();

    /** @type {string|null} Currently selected character tab for scoped panel view */
    _selectedCharacterId = null;

    /** @type {string} Currently selected workflow step: 'gather' | 'activities' | 'sustenance' */
    _selectedWorkflowStep = "gather";

    /** @type {Array<object>} */
    _encounterDraft = [];

    /** @type {string} */
    _terrainTag = "forest";

    /** @type {string} */
    _weather = "clear";

    /** @type {string|null} */
    _campComfort = null;

    /** @type {Array<string>} */
    _activeShelters = [];

    /** @type {object|null} */
    _campScanData = null;

    /** @type {number} */
    _dangerDC = 15;

    /** @type {boolean} True when pacing through the resolution workflow */
    _pacingActive = false;

    /** @type {number} Total nights in resolution flow (7 for gritty downtime, 1 for single-night bivouac) */
    _totalNights = 7;

    /** @type {number} Current active night index during pacing (1-7) */
    _activePacingNight = 1;

    /** True while the send-off beat is up, before the last watch. */
    _sendoffOpen = false;

    /** Servings already applied on the send-off beat. */
    _sendoffApplied = [];

    /** @type {boolean} True when the GM minimized the app to run combat on the canvas */
    _awaitingCombat = false;

    /** @type {Set<number>} Nights where combat/encounter has been resolved/acknowledged */
    _completedCombatNights = new Set();

    /** @type {string|undefined} */
    _lastTrackedCampComfort = undefined;

    /** @type {Map<string, string|null>} Last personal comfort seen per actor. */
    _personalComfortMemory = new Map();

    /** @type {Map<string, Array<{day: number, mode: string, rolled: boolean, rollTotal: number|null, dc: number|null, success: boolean|null, yield: number}>>} */
    _gatheringSchedule = new Map();

    /** @type {Map<string, Array<{day: number, activityId: string|null, rolled: boolean, rollTotal: number|null, dc: number|null, success: boolean|null, skillUsed: string|null}>>} */
    _activityRolls = new Map();

    /** @type {CraftingEngine|null} */
    _craftingEngine = null;

    /**
     * Backward compatibility view for legacy sustenanceRoles consumers.
     */
    get _sustenanceRoles() {
        const self = this;
        return {
            get(actorId) {
                const schedule = self._gatheringSchedule.get(actorId);
                if (!schedule || !schedule.length) return undefined;
                const d1 = schedule[0];
                return {
                    role: d1.mode,
                    rolled: d1.rolled,
                    rollTotal: d1.rollTotal,
                    dc: d1.dc,
                    success: d1.success,
                    yield: d1.yield
                };
            },
            set(actorId, roleData) {
                const mode = roleData?.role === "hunt" ? "hunt" : "forage";
                const schedule = normalizeGatheringSchedule(null, mode).map(entry => ({
                    ...entry,
                    rolled: roleData?.rolled ?? false,
                    rollTotal: roleData?.rollTotal ?? null,
                    dc: roleData?.dc ?? null,
                    success: roleData?.success ?? null,
                    yield: roleData?.yield ?? 0
                }));
                self._gatheringSchedule.set(actorId, schedule);
                return this;
            },
            has(actorId) {
                return self._gatheringSchedule.has(actorId);
            },
            entries() {
                const arr = [];
                for (const [k] of self._gatheringSchedule.entries()) {
                    arr.push([k, this.get(k)]);
                }
                return arr[Symbol.iterator]();
            }
        };
    }

    set _sustenanceRoles(val) {
        if (!val) return;
        const entries = val instanceof Map ? val.entries() : Object.entries(val);
        for (const [actorId, data] of entries) {
            if (Array.isArray(data)) {
                this._gatheringSchedule.set(actorId, data);
            } else {
                const mode = data?.role === "hunt" ? "hunt" : "forage";
                this._gatheringSchedule.set(actorId, normalizeGatheringSchedule(null, mode).map(entry => ({
                    ...entry,
                    rolled: data?.rolled ?? false,
                    rollTotal: data?.rollTotal ?? null,
                    dc: data?.dc ?? null,
                    success: data?.success ?? null,
                    yield: data?.yield ?? 0
                })));
            }
        }
    }

    get foodDaysNeeded() {
        return this._campLogistics._foodDaysNeeded;
    }

    /**
     * Schema fields still use `_{key}` on the app. Live values live on
     * CampLogisticsDelegate. These accessors keep persist, reconnect, and
     * live sync pointed at the same object.
     */
    get _forageDC() {
        return this._campLogistics?._forageDC;
    }

    set _forageDC(value) {
        if (this._campLogistics) this._campLogistics._forageDC = value;
    }

    get _huntDC() {
        return this._campLogistics?._huntDC;
    }

    set _huntDC(value) {
        if (this._campLogistics) this._campLogistics._huntDC = value;
    }

    get _foodDaysNeeded() {
        return this._campLogistics?._foodDaysNeeded;
    }

    set _foodDaysNeeded(value) {
        if (this._campLogistics) this._campLogistics._foodDaysNeeded = value;
    }

    get _enforceBedroll() {
        return this._campLogistics?._enforceBedroll;
    }

    set _enforceBedroll(value) {
        if (this._campLogistics) this._campLogistics._enforceBedroll = value;
    }

    get _enforceTent() {
        return this._campLogistics?._enforceTent;
    }

    set _enforceTent(value) {
        if (this._campLogistics) this._campLogistics._enforceTent = value;
    }

    get _enforceMessKit() {
        return this._campLogistics?._enforceMessKit;
    }

    set _enforceMessKit(value) {
        if (this._campLogistics) this._campLogistics._enforceMessKit = value;
    }

    get _patronSuppliedDays() {
        return Math.max(0, 7 - this._campLogistics._foodDaysNeeded);
    }

    set _patronSuppliedDays(val) {
        this._campLogistics._foodDaysNeeded = Math.max(0, Math.min(7, 7 - (Number(val) || 0)));
    }

    get title() {
        if (this._pacingActive) {
            const total = this._totalNights || (this._isGrittyLongRest ? 7 : 1);
            if (this._activePacingNight > total) return game.i18n.localize("ionrift-respite.downtimeLedger.titleDawnFinalization");
            return this._totalNights === 1 ? game.i18n.localize("ionrift-respite.downtimeLedger.titleOvernightVigil") : game.i18n.localize("ionrift-respite.downtimeLedger.titleNightVigil");
        }
        return this._budgetDelegate?.haven === "civilized" ? game.i18n.localize("ionrift-respite.downtimeLedger.titleSafeRest") : game.i18n.localize("ionrift-respite.downtimeLedger.titleCampPlanning");
    }

    constructor(options = {}) {
        super(options);
        this._campLogistics = new CampLogisticsDelegate(this);
        this._isGM = options.isGM ?? (game.user?.isGM ?? false);
        this._terrainTag = options.terrainTag ?? "forest";
        this._weather = options.weather || this._resolveDefaultWeather(this._terrainTag);
        this._campComfort = options.campComfort ?? null;
        this._activeShelters = Array.isArray(options.activeShelters) ? [...options.activeShelters] : [];
        this._campScanData = options.campScanData ?? null;

        const partyActors = getPartyActors();
        const initialFirewood = partyActors.reduce((sum, a) => sum + CampGearScanner.countActorFirewood(a), 0);
        const initialHasTinder = partyActors.some(a => CampGearScanner.actorHasTinderbox(a));

        const VALID_FIRE_LEVELS = new Set(["cold_camp", "embers", "campfire", "bonfire"]);
        if (options.fireLevel && VALID_FIRE_LEVELS.has(options.fireLevel)) {
            this._fireLevel = options.fireLevel;
        } else if (options.fireLevel === "unlit") {
            this._fireLevel = "cold_camp";
        } else if (partyActors.length && initialHasTinder && initialFirewood >= 2) {
            this._fireLevel = "campfire";
        } else if (partyActors.length && initialHasTinder && initialFirewood >= 1) {
            this._fireLevel = "embers";
        } else {
            this._fireLevel = options.fireLevel ?? null;
        }

        if (this._activeShelters.length === 0 && !options.haven?.includes("civilized")) {
            const party = getPartyActors();
            const hasTent = party.some(a => CampGearScanner.scanActor(a).hasTent);
            if (hasTent) this._activeShelters = ["tent"];
        }

        this._dangerDC = options.dangerDC ?? options.baseDC ?? 15;
        this._campLogistics._forageDC = typeof options.forageDC === "number" ? options.forageDC : 12;
        this._campLogistics._huntDC = typeof options.huntDC === "number" ? options.huntDC : 14;

        if (options.gatheringSchedule) {
            this._gatheringSchedule = options.gatheringSchedule instanceof Map
                ? options.gatheringSchedule
                : new Map(Object.entries(options.gatheringSchedule));
        } else if (options.sustenanceRoles) {
            const legacy = options.sustenanceRoles instanceof Map
                ? options.sustenanceRoles
                : new Map(Object.entries(options.sustenanceRoles));
            for (const [actorId, data] of legacy.entries()) {
                if (Array.isArray(data)) {
                    this._gatheringSchedule.set(actorId, normalizeGatheringSchedule(data));
                } else {
                    const mode = data?.role === "hunt" ? "hunt" : "forage";
                    this._gatheringSchedule.set(actorId, normalizeGatheringSchedule(null, mode).map(entry => ({
                        ...entry,
                        rolled: data?.rolled ?? false,
                        rollTotal: data?.rollTotal ?? null,
                        dc: data?.dc ?? null,
                        success: data?.success ?? null,
                        yield: data?.yield ?? 0
                    })));
                }
            }
        }

        if (options.activityRolls) {
            this._activityRolls = options.activityRolls instanceof Map
                ? options.activityRolls
                : new Map(Object.entries(options.activityRolls));
        }

        if (options.exhaustionDraft) {
            this._exhaustionDraft = options.exhaustionDraft instanceof Map
                ? options.exhaustionDraft
                : new Map(Object.entries(options.exhaustionDraft));
        } else {
            this._exhaustionDraft = new Map();
        }
        this._expandedExhaustionOverrides = new Set();

        if (typeof options.foodDaysNeeded === "number") {
            this._campLogistics._foodDaysNeeded = Math.max(0, Math.min(7, options.foodDaysNeeded));
        } else if (typeof options.patronSuppliedDays === "number") {
            this._campLogistics._foodDaysNeeded = Math.max(0, Math.min(7, 7 - options.patronSuppliedDays));
        } else {
            this._campLogistics._foodDaysNeeded = 7;
        }

        this._campLogistics._enforceBedroll = options.enforceBedroll !== false;
        this._campLogistics._enforceTent = options.enforceTent !== false;
        this._campLogistics._enforceMessKit = options.enforceMessKit !== false;

        this._budgetDelegate = new ActivityBudgetDelegate({
            haven: options.haven ?? "wilderness"
        });

        // Pre-populate party allocations from last saved downtime allocations (or leave empty)
        const party = getPartyActors();
        for (const actor of party) {
            const saved = actor.getFlag?.(MODULE_ID, "lastDowntimeAllocations");
            if (saved) {
                this._budgetDelegate.repeatAllocations(actor.id, saved);
            }
        }

        // Pre-kick encounter draft generation for Wilderness mode so it is ready on initial render.
        // GM only: the draft is withheld from players over the socket, so a player client
        // rolling its own copy here would hand them the week's encounters anyway.
        this._encounterDraftPromise = (this._isGM && (options.haven ?? "wilderness") === "wilderness")
            ? this._initEncounterDraft()
            : null;

        this._workbench = new WorkbenchDelegate(this);
        this._detectMagic = new DetectMagicDelegate(this);

        registerRestSessionApp("downtime", this);
        setRespiteFlowActive(true);

        this._inventoryHookHandler = () => {
            if (this._inventoryDebounce) clearTimeout(this._inventoryDebounce);
            this._inventoryDebounce = setTimeout(() => {
                this.render();
            }, 300);
        };
        this._inventoryHookIds = [
            Hooks.on("createItem", this._inventoryHookHandler),
            Hooks.on("deleteItem", this._inventoryHookHandler),
            Hooks.on("updateItem", this._inventoryHookHandler)
        ];
    }

    /**
     * Focus budget for a 7-day downtime. Examine is not a day activity, so the
     * week allows one focus per day without spending the day on it.
     * @param {string} _actorId
     * @returns {number}
     */
    getFocusBudget(_actorId) {
        return 7;
    }

    async close(options = {}) {
        if (!options.retainGmRestApp && !this._awaitingCombat) {
            unregisterRestSessionApp("downtime");
        }
        if (this._workbenchHookId) {
            Hooks.off(`${MODULE_ID}.workbenchIdentifyStagingTouched`, this._workbenchHookId);
            this._workbenchHookId = null;
        }
        if (this._inventoryHookIds?.length) {
            Hooks.off("createItem", this._inventoryHookIds[0]);
            Hooks.off("deleteItem", this._inventoryHookIds[1]);
            Hooks.off("updateItem", this._inventoryHookIds[2]);
            this._inventoryHookIds = [];
        }
        if (this._inventoryDebounce) clearTimeout(this._inventoryDebounce);
        // Every client sets this on open, so every client has to clear it.
        if (options.resolved || options.abandoned) setRespiteFlowActive(false);
        if (this._isGM) {
            if (options.resolved || options.abandoned) {
                unregisterRestSessionApp("downtime");
                _removeGmRestIndicator();
                DOWNTIME_STATE_SCHEMA.clear().catch(() => {});
            } else {
                this._saveSessionState();
                _showGmRestIndicator(this);
            }
        }
        return super.close(options);
    }

    /**
     * Haven as stored for the resume path. The budget delegate owns the live
     * value; this exists so the constructor can read it back off a saved state.
     * @returns {string}
     */
    get _havenForResume() {
        return this._budgetDelegate?.toJSON?.().haven ?? "wilderness";
    }

    /**
     * Persists current state to world settings so GM F5 can recover.
     */
    async _saveSessionState() {
        await DOWNTIME_STATE_SCHEMA.save(this);
    }

    /**
     * Exports a snapshot for socket transmission to players.
     * @returns {object}
     */
    _exportSnapshot() {
        return DOWNTIME_STATE_SCHEMA.serializeForPlayers(this);
    }

    /**
     * Rehydrates state from a saved settings object or socket snapshot.
     * @param {object} saved
     */
    _rehydrate(saved) {
        DOWNTIME_STATE_SCHEMA.apply(this, saved);
        drainPendingRestSessionDeltas("downtime");
    }

    static async #onToggleUiTheme(event, target) { return DowntimePlanningActions.onToggleUiTheme.call(this, event, target); }
    static async #onAbandonDowntime(event, target) { return DowntimePlanningActions.onAbandonDowntime.call(this, event, target); }
    static #onSetHaven(event, target) { return DowntimePlanningActions.onSetHaven.call(this, event, target); }
    static #onSelectRosterCharacter(event, target) { return DowntimePlanningActions.onSelectRosterCharacter.call(this, event, target); }
    static #onSwitchTab(event, target) { return DowntimePlanningActions.onSwitchTab.call(this, event, target); }
    static #onSwitchWorkflow(event, target) { return DowntimePlanningActions.onSwitchWorkflow.call(this, event, target); }
    static async #onRollExhaustionSave(event, target) { return DowntimePlanningActions.onRollExhaustionSave.call(this, event, target); }
    static #onToggleExamine(_event, _target) {
        this._holdWindowHeight();
        const actorId = this._selectedCharacterId;
        if (!actorId) return;
        if (!this._expandedTiers.has(actorId)) {
            this._expandedTiers.set(actorId, new Set());
        }
        const expanded = this._expandedTiers.get(actorId);
        if (this._selectedWorkflowStep === "examine") {
            expanded.delete("identify");
            this._selectedWorkflowStep = this._lastWorkflowStep || "activities";
        } else {
            this._lastWorkflowStep = this._selectedWorkflowStep;
            this._selectedWorkflowStep = "examine";
            expanded.add("identify");
        }
        this.render();
    }
    static #onStepFoodDays(event, target) { return DowntimePlanningActions.onStepFoodDays.call(this, event, target); }
    static #onStepPatronDays(event, target) { return DowntimePlanningActions.onStepPatronDays.call(this, event, target); }
    static #onClearActivity(event, target) { return DowntimePlanningActions.onClearActivity.call(this, event, target); }
    static #onDumpActivity(event, target) { return DowntimePlanningActions.onDumpActivity.call(this, event, target); }
    static #onStepActivity(event, target) { return DowntimePlanningActions.onStepActivity.call(this, event, target); }
    static #onToggleDrillDown(event, target) { return DowntimePlanningActions.onToggleDrillDown.call(this, event, target); }
    static #onToggleLogisticsDrawer(event, target) { return DowntimePlanningActions.onToggleLogisticsDrawer.call(this, event, target); }
    static #onAdjustDraftDC(event, target) { return DowntimePlanningActions.onAdjustDraftDC.call(this, event, target); }
    static #onAdjustNightDC(event, target) { return DowntimePlanningActions.onAdjustNightDC.call(this, event, target); }
    static async #onRerollNight(event, target) { return DowntimePlanningActions.onRerollNight.call(this, event, target); }
    static #onDropNight(event, target) { return DowntimePlanningActions.onDropNight.call(this, event, target); }
    static #onCycleNightState(event, target) { return DowntimePlanningActions.onCycleNightState.call(this, event, target); }
    static #onSelectNominatedFood(event, target) { return DowntimePlanningActions.onSelectNominatedFood.call(this, event, target); }
    static #onStepNominatedFood(event, target) { return DowntimePlanningActions.onStepNominatedFood.call(this, event, target); }
    static #onClearSustenanceFood(event, target) { return DowntimePlanningActions.onClearSustenanceFood.call(this, event, target); }
    static #onAssignSustenanceFood(event, target) { return DowntimePlanningActions.onAssignSustenanceFood.call(this, event, target); }
    static #onClearSustenanceWater(event, target) { return DowntimePlanningActions.onClearSustenanceWater.call(this, event, target); }
    static #onAssignSustenanceWater(event, target) { return DowntimePlanningActions.onAssignSustenanceWater.call(this, event, target); }
    static #onLockMeals(event, target) { return DowntimePlanningActions.onLockMeals.call(this, event, target); }
    static #onUnlockMeals(event, target) { return DowntimePlanningActions.onUnlockMeals.call(this, event, target); }
    static #onSelectDepartureMeal(event, target) { return DowntimePlanningActions.onSelectDepartureMeal.call(this, event, target); }
    static #onSelectDepartureDrink(event, target) { return DowntimePlanningActions.onSelectDepartureDrink.call(this, event, target); }
    static #onToggleTierReveal(event, target) { return DowntimePlanningActions.onToggleTierReveal.call(this, event, target); }
    static async #onRerollAllDraft(event, target) { return DowntimePlanningActions.onRerollAllDraft.call(this, event, target); }
    static #onAdjustSustenanceDC(event, target) { return DowntimePlanningActions.onAdjustSustenanceDC.call(this, event, target); }
    static async #onGiftWood(event, target) { return DowntimePlanningActions.onGiftWood.call(this, event, target); }
    static #onToggleGearFactor(event, target) { return DowntimePlanningActions.onToggleGearFactor.call(this, event, target); }
    static #onToggleGatheringDay(event, target) { return DowntimePlanningActions.onToggleGatheringDay.call(this, event, target); }
    static #onToggleGatheringDetail(event, target) { return DowntimePlanningActions.onToggleGatheringDetail.call(this, event, target); }
    static async #onRollGatheringDay(event, target) { return DowntimePlanningActions.onRollGatheringDay.call(this, event, target); }
    static async #onRollAllGathering(event, target) { return DowntimePlanningActions.onRollAllGathering.call(this, event, target); }
    static async #onRollActivityDay(event, target) { return DowntimeActivityAndNightActions.onRollActivityDay.call(this, event, target); }
    static async #onRollAllActivities(event, target) { return DowntimeActivityAndNightActions.onRollAllActivities.call(this, event, target); }
    static async #onCommitActivities(event, target) { return DowntimeActivityAndNightActions.onCommitActivities.call(this, event, target); }
    static async #onUnlockActivities(event, target) { return DowntimeActivityAndNightActions.onUnlockActivities.call(this, event, target); }
    static async #onOpenCraftQueue(event, target) { return DowntimeActivityAndNightActions.onOpenCraftQueue.call(this, event, target); }
    static #onSelectSustenanceRoleLegacy(event, target) { return DowntimeActivityAndNightActions.onSelectSustenanceRoleLegacy.call(this, event, target); }
    static async #onRollSustenanceLegacy(event, target) { return DowntimeActivityAndNightActions.onRollSustenanceLegacy.call(this, event, target); }
    static async #onSelectFireLevel(event, target) { return DowntimeActivityAndNightActions.onSelectFireLevel.call(this, event, target); }
    static #onProceedToResolutionFlow(event, target) { return DowntimeActivityAndNightActions.onProceedToResolutionFlow.call(this, event, target); }
    static #onReturnToPlanning(event, target) { return DowntimeActivityAndNightActions.onReturnToPlanning.call(this, event, target); }
    static async #onRollNightCheck(event, target) { return DowntimeActivityAndNightActions.onRollNightCheck.call(this, event, target); }
    static async #onImproviseNightCheck(event, target) { return DowntimeActivityAndNightActions.onImproviseNightCheck.call(this, event, target); }
    static #onImproviseNightOverride(event, target) { return DowntimeActivityAndNightActions.onImproviseNightOverride.call(this, event, target); }
    static async #onPickPoolNightEvent(event, target) { return DowntimeResolutionActions.onPickPoolNightEvent.call(this, event, target); }
    static #onSetNightQuiet(event, target) { return DowntimeResolutionActions.onSetNightQuiet.call(this, event, target); }
    static #onSetNightSeverity(event, target) { return DowntimeResolutionActions.onSetNightSeverity.call(this, event, target); }
    static async #onToggleNightsVariant(event, target) { return DowntimeResolutionActions.onToggleNightsVariant.call(this, event, target); }
    static #onSetPacingNight(event, target) { return DowntimeResolutionActions.onSetPacingNight.call(this, event, target); }
    static #onNextPacingNight(event, target) { return DowntimeResolutionActions.onNextPacingNight.call(this, event, target); }
    static #onPreviousPacingNight(event, target) { return DowntimeResolutionActions.onPreviousPacingNight.call(this, event, target); }
    static async #onApplyOneSendoffBuff(event, target) { return DowntimeResolutionActions.onApplyOneSendoffBuff.call(this, event, target); }
    static async #onApplySendoffBuffs() { return DowntimeResolutionActions.onApplySendoffBuffs.call(this); }
    static async #onMinimizeForCombat(event, target) { return DowntimeResolutionActions.onMinimizeForCombat.call(this, event, target); }
    static #onCompleteCombatForNight(event, target) { return DowntimeResolutionActions.onCompleteCombatForNight.call(this, event, target); }
    static #onToggleMustRollExhaustion(event, target) { return DowntimeResolutionActions.onToggleMustRollExhaustion.call(this, event, target); }
    static #onSetExhaustionAdvMode(event, target) { return DowntimeResolutionActions.onSetExhaustionAdvMode.call(this, event, target); }
    static async #onRollActorExhaustionSave(event, target) { return DowntimeResolutionActions.onRollActorExhaustionSave.call(this, event, target); }
    static async #onRollAllExhaustionSaves(event, target) { return DowntimeResolutionActions.onRollAllExhaustionSaves.call(this, event, target); }
    static #onWaiveAllExhaustionSaves(event, target) { return DowntimeResolutionActions.onWaiveAllExhaustionSaves.call(this, event, target); }
    static #onAdjustExhaustionDC(event, target) { return DowntimeResolutionActions.onAdjustExhaustionDC.call(this, event, target); }
    static #onChangeExhaustionDCInput(event, target) { return DowntimeResolutionActions.onChangeExhaustionDCInput.call(this, event, target); }
    static #onToggleExhaustionOverride(event, target) { return DowntimeResolutionActions.onToggleExhaustionOverride.call(this, event, target); }
    static async #onResolveDowntime(event, target) { return DowntimeResolutionActions.onResolveDowntime.call(this, event, target); }
    static #onToggleIdentifyDrawer(event, target) { return DowntimeResolutionActions.onToggleIdentifyDrawer.call(this, event, target); }
    static async #onStationDetectMagicScan(event, target) { return DowntimeResolutionActions.onStationDetectMagicScan.call(this, event, target); }
    static async #onStationIdentifyScannedItem(event, target) { return DowntimeResolutionActions.onStationIdentifyScannedItem.call(this, event, target); }
    static async #onSubmitWorkbenchIdentify(event, target) { return DowntimeResolutionActions.onSubmitWorkbenchIdentify.call(this, event, target); }
    static #onWorkbenchIdentifyRemovePotion(event, target) { return DowntimeResolutionActions.onWorkbenchIdentifyRemovePotion.call(this, event, target); }
    static async #onDismissWorkbenchIdentifyAck(event, target) { return DowntimeResolutionActions.onDismissWorkbenchIdentifyAck.call(this, event, target); }
}

applyDowntimeSyncAndRenderHelpers(DowntimeLedgerApp);
applyDowntimePlanningHelpers(DowntimeLedgerApp);
applyDowntimeResolutionHelpers(DowntimeLedgerApp);
