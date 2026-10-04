import { MODULE_ID } from "../../data/moduleId.js";
import { presentRoll } from "/modules/ionrift-library/scripts/services/rolls/DiceSettle.js";
import { CampLogisticsDelegate, fireEncounterDcNudge } from "../delegates/camp/CampLogisticsDelegate.js";
import { Logger } from "../../utils/Logger.js";
import { getPartyActors } from "../../services/party/partyActors.js";
import { ItemClassifier } from "../../services/party/ItemClassifier.js";
import { ItemOutcomeHandler } from "../../services/crafting/outcomes/ItemOutcomeHandler.js";
import { ActivityRegistry } from "../../data/downtime/ActivityRegistry.js";
import { ImageResolver } from "../../utils/ImageResolver.js";
import { RestPresentationHelper } from "../../utils/RestPresentationHelper.js";
import { RestDockContext } from "../../utils/RestDockContext.js";
import { ActivityBudgetDelegate } from "./ActivityBudgetDelegate.js";
import { DowntimeBatchEngine } from "../../services/downtime/DowntimeBatchEngine.js";
import {
    buildSkillCheckSummary,
    formatFletchGrantNotice,
    pickFletchKind,
    rollDowntimeSkillDay
} from "../../services/downtime/DowntimeSkillCheck.js";
import {
    craftPlanNeedsEscape,
    keepsRolledActivityDays,
    rebindActivityRolls,
    unresolvedCraftProfessions
} from "../../services/downtime/craftPlanEscape.js";
import { EncounterDraftService, combineNightDc } from "../../services/rest/gritty/EncounterDraftService.js";
import { CalendarHandler } from "../../services/rest/session/CalendarHandler.js";
import { describeItemMealBuff } from "../../services/meal/buffs/MealBuffPresets.js";
import { SpoilageClock } from "../../services/meal/spoilage/SpoilageClock.js";
import {
    registerRestSessionApp,
    unregisterRestSessionApp,
    drainPendingRestSessionDeltas,
    emitRestSessionDelta,
    emitRestSessionSync,
    emitRestSessionResolved,
    emitRestSessionAbandoned,
    userControlsActor
} from "../../services/rest/session/RestSessionSync.js";
import { DOWNTIME_STATE_SCHEMA } from "../../services/rest/session/restSessionSchemas.js";
import { FRESH_FORAGE_NOTE, GatherYieldService } from "../../services/rest/forage/GatherYieldService.js";
import {
    applySendoffServing,
    collectSendoffRows,
    holdsForSendoff
} from "../../services/rest/gritty/SendoffBuffBeat.js";
import { confirmAbandonRest } from "../rest/confirmAbandonRest.js";
import { CraftingEngine } from "../../services/crafting/engine/CraftingEngine.js";
import { STUB_RECIPES } from "../../data/stub-content.js";
import { applyCustomRecipesToEngine } from "../../services/crafting/recipes/RecipeCatalog.js";
import { CraftingPickerApp } from "../crafting/CraftingPickerApp.js";
import { TerrainRegistry } from "../../services/events/resolve/TerrainRegistry.js";
import { EventResolver } from "../../services/events/resolve/EventResolver.js";
import { pickPoolEvent } from "../events/AdHocEventDialogs.js";
import { listPoolEventsForTerrain, loadAllCatalogEvents } from "../../services/events/catalog/EventCatalogLoader.js";
import { WEATHER_TABLE, getComfortTip } from "../../data/RestConstants.js";
import { CampGearScanner } from "../../services/camp/gear/CampGearScanner.js";
import { isComfortEnabled, boostComfort } from "../../services/camp/gear/ComfortCalculator.js";

function tipEsc(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/'/g, "&#39;")
        .replace(/"/g, "&quot;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

/** Short HTML tooltip: a title plus one fact per line. */
function bulletTip(title, lines) {
    const items = (lines ?? []).filter(Boolean).map(line => `<li>${tipEsc(line)}</li>`).join("");
    const head = title ? `<div class='tooltip-title'>${tipEsc(title)}</div>` : "";
    return `<div class='ledger-tip'>${head}<ul>${items}</ul></div>`;
}

const GATHERING_DAYS = 7;

function emptyGatherDay(day, mode = "forage") {
    return {
        day,
        mode,
        rolled: false,
        rollTotal: null,
        dc: null,
        success: null,
        yield: 0
    };
}

function normalizeGatheringSchedule(existing, defaultMode = "forage") {
    const byDay = new Map((Array.isArray(existing) ? existing : []).map(entry => [entry.day, entry]));
    return Array.from({ length: GATHERING_DAYS }, (_, i) => {
        const day = i + 1;
        const prev = byDay.get(day);
        if (prev) return { ...emptyGatherDay(day, prev.mode ?? defaultMode), ...prev, day };
        return emptyGatherDay(day, day === 7 ? "skip" : defaultMode);
    });
}

import { buildCampConditionsBar } from "../../services/camp/gear/CampConditionsBarBuilder.js";

/**
 * Build the `sustenanceDiegetic` context consumed by
 * `templates/partials/sustenance-diegetic.hbs`. Maps existing per-character
 * sustenance data into the mock's two-column pile / vessel shape.
 */
function buildSustenanceDiegetic({
    actorId, foodFlow, waterFlow, foodDailyPips, waterDailyPips,
    selectedDepartureMeal, selectedDepartureDrink,
    departureFoodOptions, departureDrinkOptions,
    climateLabel, climateTooltip, isTraitPill,
    waterNeedPerDay, mealsLocked, canUnlock
}) {
    const foodBudgetDone = !foodFlow?.isShort;
    const waterBudgetDone = !waterFlow?.isShort;
    const itemArt = new Map();
    const spoilById = new Map();
    for (const option of [...(departureFoodOptions ?? []), ...(departureDrinkOptions ?? [])]) {
        if (option?.id && option.img) itemArt.set(option.id, option.img);
        if (option?.id && option.perishable) spoilById.set(option.id, option);
    }
    const artFor = (itemId, fallback) => (itemId && itemArt.get(itemId)) || fallback || "";
    const spoilFor = (itemId) => SpoilageClock.viewFromOption(itemId ? spoilById.get(itemId) : null);

    const foodSlots = (foodDailyPips ?? []).map((pip, i) => ({
        day: pip.day ?? i + 1,
        isEmpty: !pip.isFed || pip.isCleared,
        name: pip.isCleared ? "" : (pip.name ?? ""),
        img: pip.isCleared ? "" : artFor(pip.itemId, pip.img),
        ...spoilFor(pip.isCleared ? "" : pip.itemId),
        isSend: pip.isDeparture ?? false,
        isBuff: false,
        editable: !!pip.editable
    }));

    const need = waterNeedPerDay ?? (waterFlow?.needed ? Math.ceil(waterFlow.needed / 7) : 2);

    const waterDays = (waterDailyPips ?? []).map((pip, i) => {
        const isSend = pip.isDeparture ?? false;
        const pints = [];
        const pours = Array.isArray(pip.pours) ? pip.pours : null;
        if (pours) {
            for (const pour of pours) {
                for (let n = 0; n < (pour.pints || 0) && pints.length < need; n++) {
                    pints.push({
                        filled: true,
                        sourceId: pour.itemId ?? "waterskin",
                        sourceClass: normalizeBeverageClass(pour.name),
                        name: pour.name ?? "",
                        img: artFor(pour.itemId, pour.img),
                        ...spoilFor(pour.itemId),
                        editable: !!pip.editable
                    });
                }
            }
            while (pints.length < need) {
                pints.push({ filled: false, sourceId: "", sourceClass: "", name: "", editable: !!pip.editable });
            }
        } else {
            const filledCount = pip.isHydrated ? need : (pip.filledPints ?? 0);
            for (let p = 0; p < need; p++) {
                pints.push({
                    filled: p < filledCount,
                    sourceId: pip.sourceId ?? "waterskin",
                    sourceClass: normalizeBeverageClass(pip.name),
                    name: pip.name ?? "",
                    img: p < filledCount ? artFor(pip.sourceId, pip.img) : "",
                    ...(p < filledCount ? spoilFor(pip.sourceId) : SpoilageClock.viewFromOption(null)),
                    editable: false
                });
            }
        }
        let lastFilledIdx = -1;
        for (let p = pints.length - 1; p >= 0; p--) {
            if (pints[p].filled) {
                lastFilledIdx = p;
                break;
            }
        }
        if (lastFilledIdx >= 0) {
            pints[lastFilledIdx].isSurface = true;
        }
        return {
            day: pip.day ?? i + 1,
            isSend,
            hasBuff: pip.hasBuff ?? false,
            dayIndex: i,
            pints,
            ...waterGlassFromPints(pints)
        };
    });

    const foodSendoff = selectedDepartureMeal
        ? { empty: false, itemName: selectedDepartureMeal.name, hasBuff: selectedDepartureMeal.hasBuff, buffSummary: selectedDepartureMeal.buffSummary ?? "" }
        : { empty: true };
    const waterSendoff = selectedDepartureDrink
        ? { empty: false, itemName: selectedDepartureDrink.name, hasBuff: selectedDepartureDrink.hasBuff, buffSummary: selectedDepartureDrink.buffSummary ?? "" }
        : { empty: true };

    const foodInventory = (departureFoodOptions ?? []).map(o => ({
        id: o.id, name: o.name, img: o.img ?? "", available: o.quantity, hasBuff: o.hasBuff, isDry: o.quantity <= 0, isSelected: o.isSelected,
        ...SpoilageClock.viewFromOption(o)
    }));
    const waterInventory = (departureDrinkOptions ?? []).map(o => ({
        id: o.id, name: o.name, img: o.img ?? "", available: o.quantity, hasBuff: o.hasBuff, isDry: o.quantity <= 0, isSelected: o.isSelected,
        ...SpoilageClock.viewFromOption(o)
    }));

    return {
        actorId,
        isMultiDay: true,
        mealsLocked: Boolean(mealsLocked),
        canUnlock: Boolean(canUnlock),
        canInteract: Boolean(canUnlock),
        trait: isTraitPill ? { label: climateLabel, tooltip: climateTooltip } : null,
        food: {
            budget: { text: foodBudgetDone ? "Fed" : `${foodFlow?.shortfallDays ?? 0}d short`, isDone: foodBudgetDone },
            slots: foodSlots,
            sendoff: foodSendoff,
            inventory: foodInventory
        },
        water: {
            budget: { text: waterBudgetDone ? "Hydrated" : `${waterFlow?.shortfallDays ?? 0}d short`, isDone: waterBudgetDone },
            days: waterDays,
            sendoff: waterSendoff,
            inventory: waterInventory,
            need
        }
    };
}
import { getActorMealNeeds } from "../../services/meal/phase/MealContextBuilder.js";
import {
    addPints, applySustenancePlan, clonePours, ensureSustenancePlan, pourCount, removeLastPour, waterGlassFromPints
} from "../../services/meal/phase/SustenanceEditPlan.js";
import { bindSustenanceMeters, sustenanceActorId } from "../delegates/meal/SustenanceMeterBinding.js";
import { MEAL_DEFAULTS } from "../../services/meal/inventory/MealConstants.js";
import { buildWaterOptions, normalizeBeverageClass } from "../../services/meal/phase/MealOptionBuilder.js";
import { SustenanceAlertBuilder } from "../../services/meal/phase/SustenanceAlertBuilder.js";
import { _showGmRestIndicator, _removeGmRestIndicator, setRespiteFlowActive } from "../../module.js";
import { WorkbenchDelegate } from "../delegates/crafting/WorkbenchDelegate.js";
import {
    DetectMagicDelegate,
    collectPartyIdentifyEmbedData,
    spawnDetectMagicCastRipple,
    purgeDetectMagicRestArtifacts
} from "../delegates/crafting/DetectMagicDelegate.js";
import { isWorkbenchIdentifyUiEnabled } from "../../data/RestConstants.js";

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
            title: "Camp Planning",
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
     * Lazy-initializes and returns the shared CraftingEngine instance.
     * @returns {CraftingEngine}
     */
    _getCraftingEngine() {
        if (!this._craftingEngine) {
            this._craftingEngine = new CraftingEngine();
            for (const [profId, recipeList] of Object.entries(STUB_RECIPES)) {
                this._craftingEngine.load(profId, recipeList);
            }
            applyCustomRecipesToEngine(this._craftingEngine);
        }
        return this._craftingEngine;
    }

    /** @type {EventResolver|null} */
    _eventResolver = null;

    /**
     * Lazy-initializes and loads the EventResolver with curated catalog events and terrain tables.
     * @returns {Promise<EventResolver>}
     */
    async _getEventResolver() {
        if (!this._eventResolver) {
            this._eventResolver = new EventResolver();
            try {
                await TerrainRegistry.init();
                const allEvents = await loadAllCatalogEvents();
                this._eventResolver.load([], allEvents);

                // Load camp disasters
                try {
                    const disasterResp = await fetch(`modules/${MODULE_ID}/data/core/events/camp_disasters.json`);
                    if (disasterResp.ok) {
                        const disasters = await disasterResp.json();
                        this._eventResolver.load(disasters.tables ?? [], disasters.events ?? []);
                    }
                } catch {}

                // Load terrain-specific table/events if available
                const path = TerrainRegistry.getEventsPath(this._terrainTag) ?? `modules/${MODULE_ID}/data/terrains/${this._terrainTag}/events.json`;
                try {
                    const resp = await fetch(path);
                    if (resp.ok) {
                        const data = await resp.json();
                        this._eventResolver.load(data.tables ?? [], data.events ?? []);
                    }
                } catch {}
            } catch (err) {
                Logger.warn(`${MODULE_ID} | Failed to load EventResolver in DowntimeLedgerApp:`, err);
            }
        }
        return this._eventResolver;
    }

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

    /**
     * Gets or initializes the 7-day gathering schedule for an actor.
     * @param {string} actorId
     * @returns {Array<{day: number, mode: string, rolled: boolean, rollTotal: number|null, dc: number|null, success: boolean|null, yield: number}>}
     */
    _getOrCreateGatheringSchedule(actorId) {
        let schedule = this._gatheringSchedule.get(actorId);
        if (!Array.isArray(schedule) || schedule.length !== GATHERING_DAYS) {
            schedule = normalizeGatheringSchedule(schedule, "forage");
            this._gatheringSchedule.set(actorId, schedule);
        }
        return schedule;
    }

    /**
     * Gets or synchronizes the 7-day activity roll entries for an actor based on current segment allocations.
     * @param {string} actorId
     * @returns {Array<{day: number, activityId: string|null, rolled: boolean, rollTotal: number|null, dc: number|null, success: boolean|null, skillUsed: string|null}>}
     */
    _getOrCreateActivityRolls(actorId) {
        const actor = game.actors.get(actorId);
        const viewModel = actor ? this._budgetDelegate.getActorViewModel(actor) : null;
        const segments = viewModel?.segments ?? [];

        let rolls = this._activityRolls.get(actorId);
        if (!Array.isArray(rolls) || rolls.length !== 7) {
            rolls = [1, 2, 3, 4, 5, 6, 7].map(day => ({
                day,
                activityId: null,
                rolled: false,
                rollTotal: null,
                dc: null,
                success: null,
                skillUsed: null
            }));
            this._activityRolls.set(actorId, rolls);
        }

        const planChanged = rolls.some((roll, index) => {
            const seg = segments[index];
            const currentActId = (seg && seg.filled) ? seg.activityId : null;
            return roll.activityId !== currentActId;
        });
        if (!planChanged) return rolls;

        // Results follow the activity when a day is reassigned, so dropping
        // an unmade brew day does not wipe a check that already landed.
        const rebound = rebindActivityRolls(rolls, segments);
        this._activityRolls.set(actorId, rebound);
        return rebound;
    }

    /**
     * Recipe counts for unresolved cook, brew, and craft days.
     * A failed lookup counts as available so a bad read does not unlock the plan.
     * @param {Actor} actor
     * @param {object[]} rolls
     * @returns {Record<string, number>}
     */
    _craftAvailableCounts(actor, rolls) {
        const engine = this._getCraftingEngine();
        // The craft window lists recipes for a single serving. Use that same
        // check so Change plan appears only when that window has nothing to make.
        const counts = {};
        for (const profession of unresolvedCraftProfessions(rolls)) {
            try {
                const status = engine.getRecipeStatus(actor, profession, this._terrainTag ?? null, 1);
                counts[profession] = status?.available?.length ?? 0;
            } catch {
                counts[profession] = 1;
            }
        }
        return counts;
    }

    /**
     * @param {string} actorId
     * @param {string} activityId
     * @param {number} nextCount
     * @returns {boolean}
     */
    _keepsRolledActivityDays(actorId, activityId, nextCount) {
        const rolls = this._getOrCreateActivityRolls(actorId);
        return keepsRolledActivityDays(rolls, activityId, nextCount);
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
            if (this._activePacingNight > total) return "Dawn Finalization";
            return this._totalNights === 1 ? "Overnight Vigil" : "Night Vigil";
        }
        return this._budgetDelegate?.haven === "civilized" ? "Safe Rest" : "Camp Planning";
    }

    /**
     * Resolves default weather for a terrain if not explicitly supplied.
     * @param {string} terrainTag
     * @returns {string}
     */
    _resolveDefaultWeather(terrainTag) {
        let lastWeather = "";
        try {
            lastWeather = game.settings.get(MODULE_ID, "lastWeather") ?? "";
        } catch { /* settings not ready */ }
        const valid = TerrainRegistry.getWeather ? TerrainRegistry.getWeather(terrainTag) : [];
        const defaultKey = valid[0] ?? "clear";
        return lastWeather || defaultKey || "clear";
    }

    /**
     * Builds the camp conditions bar data (Terrain, Comfort, Weather, Tent) aligned with vanilla Respite.
     * @param {object|null} [scanResult=null]
     * @param {object} [options={}]
     * @returns {object}
     */
    _buildCampConditionsBar(scanResult = null, options = {}) {
        const haven = this._budgetDelegate?.haven ?? "wilderness";
        const isCivilized = haven === "civilized";
        const safeRestSpot = isCivilized || this._terrainTag === "tavern";
        const isGM = options.isGM ?? this._isGM;
        const playerCharacters = this._partyActors?.filter(a => a.isOwner && !a.isGM) ?? [];
        return buildCampConditionsBar({
            terrainTag: this._terrainTag ?? "forest",
            weatherKey: this._weather ?? "clear",
            fireLevel: this._fireLevel ?? "campfire",
            activeShelters: this._activeShelters ?? [],
            campScanData: scanResult ?? this._campScanData,
            safeRestSpot,
            encountersEnabled: true,
            isGM,
            viewerActorId: options.viewerActorId ?? (isGM ? null : (playerCharacters[0]?.id ?? null)),
            enforceTent: options.enforceTent ?? this._campLogistics._enforceTent
        });
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

    /**
     * Retrieves or initializes the exhaustion tracking entry for a character.
     * @param {Actor} actor
     * @param {object|null} personalCard
     * @param {boolean} hasStarvationRisk
     * @param {string} currentFire
     * @returns {object}
     */
    _getOrCreateExhaustionEntry(actor, personalCard = null, hasStarvationRisk = false, currentFire = "unlit") {
        if (!actor) return null;
        if (!this._exhaustionDraft) this._exhaustionDraft = new Map();
        let entry = this._exhaustionDraft.get(actor.id);
        if (!entry) {
            const haven = this._budgetDelegate?.haven ?? "wilderness";
            const isSafeHaven = haven === "civilized";
            const comfort = personalCard?.personalComfort ?? "rough";
            const exhaustionDC = isSafeHaven ? null : (personalCard?.recovery?.exhaustionDC ?? (comfort === "rough" ? 10 : (comfort === "hostile" ? 15 : null)));
            const starvationDC = hasStarvationRisk ? 15 : null;
            const targetDC = Math.max(exhaustionDC ?? 10, starvationDC ?? 10);
            const hasHazard = !isSafeHaven && (Boolean(exhaustionDC) || hasStarvationRisk || comfort === "rough" || comfort === "hostile");

            const reasons = [];
            if (isSafeHaven) {
                reasons.push("Safe Haven: warm shelter & supplies");
            } else {
                if (hasStarvationRisk) reasons.push("Food/water shortfall");
                if (comfort === "hostile") reasons.push("Hostile wilderness exposure");
                else if (comfort === "rough") reasons.push("Rough camp conditions");
                if (!personalCard?.hasBedroll && !personalCard?.bedrollWaived) reasons.push("Missing bedroll");
            }
            if (!reasons.length) reasons.push("Safe and sheltered sleep");

            const hasMessKit = personalCard?.hasMessKit ?? false;
            const fireLit = currentFire !== "cold_camp" && currentFire !== "unlit";
            const defaultAdvMode = (hasMessKit && fireLit) ? "adv" : "norm";

            entry = {
                actorId: actor.id,
                actorName: actor.name,
                actorImg: (actor.img && actor.img.trim() !== "") ? actor.img : "icons/svg/mystery-man.svg",
                mustRoll: hasHazard,
                waived: !hasHazard,
                advMode: defaultAdvMode,
                dc: targetDC,
                reason: reasons.join(" · "),
                rolled: false,
                rollTotal: null,
                passed: null
            };
            this._exhaustionDraft.set(actor.id, entry);
        }
        return entry;
    }

    /**
     * Evaluates and records a Constitution saving throw for exhaustion against the target DC.
     * @param {string} actorId
     * @returns {Promise<object|null>}
     */
    async _rollActorExhaustion(actorId) {
        const actor = game.actors.get(actorId);
        if (!actor) return null;
        const entry = this._getOrCreateExhaustionEntry(actor);
        if (!entry) return null;

        let conMod = 0;
        try {
            const rollData = actor.getRollData?.() ?? {};
            const fromRollData = rollData?.abilities?.con?.save;
            if (typeof fromRollData === "number") {
                conMod = fromRollData;
            } else {
                const mod = actor.system?.abilities?.con?.mod ?? 0;
                const prof = actor.system?.attributes?.prof ?? 0;
                const proficient = actor.system?.abilities?.con?.proficient ?? 0;
                conMod = mod + (proficient > 0 ? prof : 0);
            }
        } catch {
            conMod = actor.system?.abilities?.con?.mod ?? 0;
        }

        const formula = entry.advMode === "adv" ? "2d20kh" : (entry.advMode === "dis" ? "2d20kl" : "1d20");
        const rollString = conMod >= 0 ? `${formula} + ${conMod}` : `${formula} - ${Math.abs(conMod)}`;
        const roll = await new Roll(rollString).evaluate();

        await presentRoll(roll);

        const passed = roll.total >= entry.dc;
        entry.rolled = true;
        entry.rollTotal = roll.total;
        entry.passed = passed;

        const advText = entry.advMode === "adv" ? " (Advantage)" : (entry.advMode === "dis" ? " (Disadvantage)" : "");
        const resultText = passed
            ? `<strong style="color: #2ecc71;">Passed</strong> (no exhaustion gained)`
            : `<strong style="color: #e74c3c;">Failed</strong> (+1 Exhaustion)`;

        await roll.toMessage({
            speaker: ChatMessage.getSpeaker({ actor }),
            flavor: `<strong>${actor.name}</strong>: Constitution save vs Exhaustion DC ${entry.dc}${advText}<br>${resultText}`,
            whisper: game.users.filter(u => u.isGM).map(u => u.id)
        });

        return entry;
    }

    /**
     * Inspects party member activity allocations for the specified day/night index (1 to 7).
     * Calculates activity nudges (Fortify -2 DC, Guard -1 DC) and determines active Sentry.
     *
     * @param {number} nightIndex 1 to 7
     * @returns {{
     *   nightIndex: number,
     *   fortifyCount: number,
     *   guardCount: number,
     *   fortifyActors: string[],
     *   guardActors: string[],
     *   activityNudge: number,
     *   sentryActor: Actor|null,
     *   hasActiveGuard: boolean
     * }}
     */
    _getNightActivityModifiers(nightIndex) {
        const party = getPartyActors();
        let fortifyCount = 0;
        let failedFortifyCount = 0;
        let pendingFortifyCount = 0;
        let guardCount = 0;
        const fortifyActors = [];
        const failedFortifyActors = [];
        const pendingFortifyActors = [];
        const guardActors = [];

        for (const actor of party) {
            const viewModel = this._budgetDelegate.getActorViewModel(actor);
            const seg = viewModel?.segments?.[nightIndex - 1];
            if (seg && seg.filled) {
                if (seg.activityId === "fortify") {
                    const rolls = this._getOrCreateActivityRolls(actor.id);
                    const dayRoll = rolls.find(r => r.day === nightIndex);
                    if (dayRoll && dayRoll.rolled) {
                        if (dayRoll.success) {
                            fortifyCount++;
                            fortifyActors.push(actor.name);
                        } else {
                            failedFortifyCount++;
                            failedFortifyActors.push(actor.name);
                        }
                    } else {
                        pendingFortifyCount++;
                        pendingFortifyActors.push(actor.name);
                    }
                } else if (seg.activityId === "guard") {
                    guardCount++;
                    guardActors.push(actor);
                }
            }
        }

        const activityNudge = (fortifyCount === 0 && guardCount === 0)
            ? 0
            : -(fortifyCount * 2) - (guardCount * 1);

        let sentryActor = null;
        if (guardActors.length > 0) {
            sentryActor = guardActors.reduce((best, a) => {
                const pp = a?.system?.skills?.prc?.passive ?? a?.system?.attributes?.passive?.perception ?? 10;
                const bestPp = best?.system?.skills?.prc?.passive ?? best?.system?.attributes?.passive?.perception ?? 10;
                return pp > bestPp ? a : best;
            }, guardActors[0]);
        }

        return {
            nightIndex,
            fortifyCount,
            failedFortifyCount,
            pendingFortifyCount,
            guardCount,
            fortifyActors,
            failedFortifyActors,
            pendingFortifyActors,
            guardActors: guardActors.map(a => a.name),
            activityNudge,
            sentryActor,
            hasActiveGuard: guardActors.length > 0
        };
    }

    /**
     * Synchronizes all drafted nights with the current global dangerDC,
     * dynamic activity nudges (Fortify & Guard), and GM manual offsets.
     */
    _syncDraftDCs() {
        if (!this._encounterDraft || !this._encounterDraft.length) return;
        const haven = this._budgetDelegate?.haven ?? "wilderness";
        if (haven !== "wilderness") return;

        const fireNudge = fireEncounterDcNudge(this._fireLevel);

        for (const entry of this._encounterDraft) {
            const mods = this._getNightActivityModifiers(entry.nightIndex);
            entry.activityNudge = mods.activityNudge;
            entry.fireNudge = fireNudge;
            entry.fortifyCount = mods.fortifyCount;
            entry.guardCount = mods.guardCount;
            entry.fortifyActors = mods.fortifyActors;
            entry.guardActors = mods.guardActors;
            entry.hasActiveGuard = mods.hasActiveGuard;
            if (mods.sentryActor) {
                entry.sentryName = mods.sentryActor.name;
                entry.sentryActorId = mods.sentryActor.id;
            } else {
                entry.sentryName = null;
                entry.sentryActorId = null;
            }

            const manualOffset = entry.manualOffset ?? 0;
            const newDC = combineNightDc(this._dangerDC, mods.activityNudge, fireNudge, manualOffset);
            const isTerminalNight = (entry.nightIndex === this._encounterDraft.length);

            EncounterDraftService.evaluateNightTrigger(entry, newDC, this._terrainTag, isTerminalNight);
        }
    }

    async _initEncounterDraft() {
        const draftGen = (this._encounterDraftGen = (this._encounterDraftGen ?? 0) + 1);
        try {
            const party = getPartyActors();
            const totalNights = Math.max(1, this._totalNights || 7);
            const draft = await EncounterDraftService.batchDowntimeEncounters({
                days: totalNights,
                terrainTag: this._terrainTag,
                partyActors: party,
                safePassage: false,
                baseDC: this._dangerDC ?? 15,
                nightOptions: (nightIndex) => {
                    const mods = this._getNightActivityModifiers(nightIndex);
                    const existingEntry = this._encounterDraft?.find?.(e => e.nightIndex === nightIndex);
                    const manualOffset = existingEntry?.manualOffset ?? 0;
                    const fireNudge = fireEncounterDcNudge(this._fireLevel);
                    return {
                        effectiveDC: combineNightDc(this._dangerDC, mods.activityNudge, fireNudge, manualOffset),
                        sentryActor: mods.sentryActor,
                        hasActiveGuard: mods.hasActiveGuard
                    };
                }
            });
            if (draftGen !== this._encounterDraftGen) return this._encounterDraft;
            this._encounterDraft = draft;
            for (const entry of this._encounterDraft) {
                const mods = this._getNightActivityModifiers(entry.nightIndex);
                entry.activityNudge = mods.activityNudge;
                entry.fortifyCount = mods.fortifyCount;
                entry.guardCount = mods.guardCount;
                entry.fortifyActors = mods.fortifyActors;
                entry.guardActors = mods.guardActors;
                entry.hasActiveGuard = mods.hasActiveGuard;
                if (entry.isRolled === undefined) {
                    entry.isRolled = false;
                }
            }
        } catch (err) {
            Logger.error(`${MODULE_ID} | Failed to initialize encounter draft:`, err);
            if (draftGen === this._encounterDraftGen) this._encounterDraft = [];
        }
        return this._encounterDraft;
    }

    async _prepareContext(options) {
        drainPendingRestSessionDeltas("downtime");
        const isGM = this._isGM;
        const party = getPartyActors();
        const haven = this._budgetDelegate.haven;

        if (!isGM) {
            const owned = party.find(a => a.isOwner && !a.isGM) ?? party.find(a => a.isOwner);
            if (!this._selectedCharacterId || !party.some(a => a.id === this._selectedCharacterId && (owned ? a.isOwner : true))) {
                this._selectedCharacterId = owned?.id ?? party[0]?.id ?? null;
            }
        } else if (!this._selectedCharacterId || !party.some(a => a.id === this._selectedCharacterId)) {
            this._selectedCharacterId = party[0]?.id ?? null;
        }
        const isCivilized = haven === "civilized";
        const safeRestSpot = isCivilized || this._terrainTag === "tavern";
        const workbenchIdentifyUiEnabled = isWorkbenchIdentifyUiEnabled();

        const fuelStockTotal = party.reduce((sum, a) => sum + CampGearScanner.countActorFirewood(a), 0);
        const hasTinderbox = party.some(a => CampGearScanner.actorHasTinderbox(a));
        const defaultFire = (hasTinderbox && fuelStockTotal >= 2) ? "campfire"
                          : (hasTinderbox && fuelStockTotal >= 1) ? "embers"
                          : "cold_camp";
        const currentFire = this._fireLevel ?? defaultFire;

        const terrain = TerrainRegistry.get(this._terrainTag);
        const terrainLabel = terrain?.label ?? (this._terrainTag.charAt(0).toUpperCase() + this._terrainTag.slice(1));
        const shelterSpell = this._activeShelters.find(s => ["tiny_hut", "magnificent_mansion"].includes(s)) ?? null;

        let baseTerrainComfort = terrain?.comfort ?? "rough";
        const weatherKey = this._weather ?? "clear";
        const wx = WEATHER_TABLE[weatherKey] ?? WEATHER_TABLE.clear;
        const partyHasScannedTent = party.some(a => CampGearScanner.scanActor(a).hasTent);
        const hasTent = !this._campLogistics._enforceTent || (this._activeShelters ?? []).includes("tent") || partyHasScannedTent;
        const hasHut = (this._activeShelters ?? []).some(s => ["tiny_hut", "magnificent_mansion"].includes(s));

        let weatherPenalty = wx.comfortPenalty ?? 0;
        if (hasHut) {
            weatherPenalty = 0;
        } else if (hasTent) {
            if (wx.tentCancels) {
                weatherPenalty = 0;
            } else if (wx.tentReduces) {
                weatherPenalty = Math.max(0, weatherPenalty - 1);
            }
        }
        if (weatherPenalty > 0 && isComfortEnabled()) {
            baseTerrainComfort = boostComfort(baseTerrainComfort, -weatherPenalty);
        }

        const scanResult = CampGearScanner.scan(
            baseTerrainComfort,
            currentFire,
            shelterSpell,
            terrain?.comfortReason ?? "",
            terrainLabel,
            0,
            safeRestSpot,
            {
                enforceBedroll: this._campLogistics._enforceBedroll,
                enforceTent: this._campLogistics._enforceTent,
                enforceMessKit: this._campLogistics._enforceMessKit
            }
        );
        this._campScanData = scanResult;
        this._campComfort = scanResult.campComfort;

        if (isGM && haven === "wilderness" && (!this._encounterDraft || this._encounterDraft.length === 0)) {
            await (this._encounterDraftPromise ?? this._initEncounterDraft());
        }

        let totalNominatedRations = 0;

        const characters = party.map(actor => {
            const isOwner = isGM || actor.isOwner;
            const budget = this._budgetDelegate.getActorViewModel(actor);
            const isDrilledDown = this._drilledDownActorIds.has(actor.id);
            const identifyDays = this._budgetDelegate?.getActivityDays?.(actor.id, "identify") ?? 0;
            const focusBudget = this.getFocusBudget(actor.id);
            const focusCount = this._workbench ? this._workbench.getFocusCount(actor.id) : 0;
            const focusRemaining = Math.max(0, focusBudget - focusCount);
            const isIdentifyOpen = this._selectedWorkflowStep === "examine"
                || (this._expandedTiers.get(actor.id)?.has("identify") ?? false);
            const workbenchEmbed = (workbenchIdentifyUiEnabled && isIdentifyOpen)
                ? this._workbench.buildEmbedContext(actor.id, getPartyActors)
                : null;
            const fallbackComfort = safeRestSpot ? "safe" : (terrain?.comfort ?? "rough");
            const fallbackTotalHd = actor?.system?.attributes?.hd?.max ?? actor?.system?.details?.level ?? 0;
            const fallbackCurrentHd = actor?.system?.attributes?.hd?.value ?? fallbackTotalHd;
            const fallbackIsAlreadyFull = fallbackCurrentHd >= fallbackTotalHd;
            const personalCard = scanResult.personalCards?.find(c => c.actorId === actor.id) ?? {
                personalComfort: fallbackComfort,
                personalComfortLabel: safeRestSpot ? "Safe" : "Rough",
                hasBedroll: !this._campLogistics._enforceBedroll,
                hasTent: !this._campLogistics._enforceTent,
                hasMessKit: !this._campLogistics._enforceMessKit,
                bedrollWaived: !this._campLogistics._enforceBedroll,
                tentWaived: !this._campLogistics._enforceTent,
                messKitWaived: !this._campLogistics._enforceMessKit,
                recovery: {
                    hpFull: true,
                    hdLabel: fallbackIsAlreadyFull ? `Already at max Hit Dice (${fallbackTotalHd}/${fallbackTotalHd})` : "Normal HD recovery",
                    exhaustionDC: fallbackComfort === "rough" ? 10 : (fallbackComfort === "hostile" ? 15 : null),
                    isAlreadyFull: fallbackIsAlreadyFull,
                    currentHd: fallbackCurrentHd,
                    totalHd: fallbackTotalHd,
                    benefitSummary: CampGearScanner.formatBenefitSummary({
                        personalComfort: fallbackComfort,
                        isAlreadyFull: fallbackIsAlreadyFull,
                        hpFraction: 1.0
                    })
                }
            };

            // Day 7 Departure Meal ID for this actor
            const selectedDepartureMealId = this._departureMeals.get(actor.id) ?? null;
            const selectedDepItem = selectedDepartureMealId ? (actor.items?.get ? actor.items.get(selectedDepartureMealId) : actor.items?.find?.(i => i.id === selectedDepartureMealId)) : null;
            const selectedDepFlags = selectedDepItem?.flags?.[MODULE_ID] ?? {};
            const selectedDepSatiates = Array.isArray(selectedDepFlags.satiates) ? selectedDepFlags.satiates : [];
            const selectedDepIsDual = selectedDepSatiates.includes("water") || selectedDepFlags.satiatesWater === true;

            // Sustenance needs & climate rules (Unified Centralized Terrain & Actor flags)
            const terrainDefaults = TerrainRegistry.getDefaults(this._terrainTag);
            const terrainMealRules = terrainDefaults?.mealRules ?? { waterPerDay: MEAL_DEFAULTS.waterPerDay, foodPerDay: MEAL_DEFAULTS.foodPerDay };
            const effectiveRules = { ...MEAL_DEFAULTS, ...terrainMealRules };
            const mealNeeds = getActorMealNeeds(actor, terrainMealRules);
            const fpd = Math.max(0, mealNeeds?.foodPerDay ?? effectiveRules.foodPerDay);
            const wpd = Math.max(0, mealNeeds?.waterPerDay ?? effectiveRules.waterPerDay);

            const terrainLabel = terrainDefaults?.label ?? (this._terrainTag ? (this._terrainTag.charAt(0).toUpperCase() + this._terrainTag.slice(1)) : "Standard");
            const alertData = SustenanceAlertBuilder.build({
                terrainLabel,
                terrainMealRules,
                effectiveRules,
                mealNeeds
            });
            const climateLabel = alertData.label;
            const climateTooltip = alertData.tooltip;
            const isTraitPill = alertData.isTraitPill;

            // Plain food items (auto-consumed for routine sustenance)
            const plainFoodItems = (actor.items ?? []).filter(i => {
                if (!ItemClassifier.isFood(i, actor)) return false;
                if (ItemClassifier.isSpoiled?.(i)) return false;
                const flags = i.flags?.[MODULE_ID] ?? {};
                // Exclude buff/magic food from routine auto-consumption
                if (flags.chefTreat || flags.buff || flags.wellFedBuff || flags.magicFood || flags.wellFed) return false;
                return (i.system?.quantity ?? 1) > 0;
            }).map(i => {
                const flags = i.flags?.[MODULE_ID] ?? {};
                const satiates = Array.isArray(flags.satiates) ? flags.satiates : [];
                const isDual = satiates.includes("water") || flags.satiatesWater === true;
                return {
                    id: i.id,
                    name: i.name,
                    img: i.img,
                    quantity: i.system?.quantity ?? 1,
                    isDual
                };
            });

            // Pre-calculate gathering yield from rolled days so wild harvest directly offsets sustenance
            const rawSchedule = this._getOrCreateGatheringSchedule(actor.id);
            let charHarvestedRolled = 0;
            let rolledCount = 0;
            let forageCount = 0;
            let huntCount = 0;
            let skipCount = 0;

            for (const entry of rawSchedule) {
                const mode = entry.mode ?? "forage";
                if (mode === "skip") skipCount++;
                else if (mode === "hunt") huntCount++;
                else forageCount++;

                if (entry.rolled && mode !== "skip") {
                    rolledCount++;
                    if (entry.success) {
                        charHarvestedRolled += (entry.yield ?? 0);
                    }
                }
            }

            // Days 1–6 routine sustenance (neededDays1to6 per character)
            const days1to6Needed = (haven === "civilized") ? 0 : Math.max(0, this._campLogistics._foodDaysNeeded - 1);
            const isSelectedDepartureMeal = Boolean(selectedDepartureMealId);
            const day7RoutineFoodNeeded = (haven === "civilized" || isSelectedDepartureMeal) ? 0 : 1;
            const totalFoodUnitsNeeded1to6 = days1to6Needed * fpd;
            const totalRoutineFoodUnitsNeeded = (days1to6Needed + day7RoutineFoodNeeded) * fpd;

            let autoFoodRemaining = totalRoutineFoodUnitsNeeded;
            let waterFromDualFood = 0;
            const autoConsumed1to6 = [];
            const consumedByItem = new Map();
            let day7RoutineFoodCovered = (haven === "civilized" || isSelectedDepartureMeal);

            // Harvest is a list of finds, not a second pantry. Food only comes
            // off items the character is actually carrying.
            const foragedFoodUsed = 0;

            for (const food of plainFoodItems) {
                if (autoFoodRemaining <= 0) break;
                // If this item is currently selected for Day 7 departure meal, reserve 1 unit
                const isSelectedForDay7 = (food.id === selectedDepartureMealId);
                const maxAvailable = isSelectedForDay7
                    ? Math.max(0, food.quantity - 1)
                    : food.quantity;

                if (maxAvailable <= 0) continue;

                // First satisfy Days 1–6
                const days1to6RemainingUnits = Math.max(0, totalFoodUnitsNeeded1to6 - foragedFoodUsed - autoConsumed1to6.reduce((sum, f) => sum + f.quantity, 0));
                const takeFor1to6 = Math.min(maxAvailable, days1to6RemainingUnits);
                if (takeFor1to6 > 0) {
                    autoConsumed1to6.push({
                        id: food.id,
                        name: food.name,
                        quantity: takeFor1to6,
                        totalInPack: food.quantity,
                        isDual: food.isDual
                    });
                    consumedByItem.set(food.id, (consumedByItem.get(food.id) ?? 0) + takeFor1to6);
                    autoFoodRemaining -= takeFor1to6;
                    if (food.isDual) {
                        waterFromDualFood += takeFor1to6;
                    }
                }

                // If Day 7 still needs a routine ration and this item has stock left
                const remainingOnThisItem = maxAvailable - takeFor1to6;
                if (!day7RoutineFoodCovered && remainingOnThisItem > 0 && autoFoodRemaining > 0) {
                    const neededForDay7 = fpd;
                    const takeForDay7 = Math.min(remainingOnThisItem, neededForDay7);
                    if (takeForDay7 > 0) {
                        consumedByItem.set(food.id, (consumedByItem.get(food.id) ?? 0) + takeForDay7);
                        day7RoutineFoodCovered = true;
                        autoFoodRemaining -= takeForDay7;
                        if (food.isDual) {
                            waterFromDualFood += takeForDay7;
                        }
                    }
                }
            }

            // If selected departure meal is dual-satiating, credit 1 water unit toward Day 7
            if (isSelectedDepartureMeal && selectedDepIsDual) {
                waterFromDualFood += 1;
            }

            const totalAutoConsumed = totalRoutineFoodUnitsNeeded - autoFoodRemaining;
            const foodShortfallUnits = autoFoodRemaining;
            let foodShortfallDays = (haven === "wilderness" && fpd > 0)
                ? Math.ceil(foodShortfallUnits / fpd)
                : 0;
            let hasStarvationRisk = (haven === "wilderness") && (foodShortfallDays > 0);

            const fedDaysCount = (haven === "civilized")
                ? 7
                : Math.max(0, 7 - foodShortfallDays);

            // Water calculations
            const totalDaysWaterNeeded = (haven === "civilized") ? 0 : this._campLogistics._foodDaysNeeded;
            const totalWaterUnitsNeeded = totalDaysWaterNeeded * wpd;
            const waterOptions = (haven === "civilized") ? [] : buildWaterOptions(actor, terrainMealRules);
            const totalPackWaterPints = waterOptions.reduce((sum, opt) => sum + (opt.totalPints ?? 0), 0);

            // Water from dual-satiating food directly offsets water needed from water sources
            const waterNeededFromSources = Math.max(0, totalWaterUnitsNeeded - waterFromDualFood);
            const waterUnitsTakenFromSources = Math.min(waterNeededFromSources, totalPackWaterPints);
            const totalWaterFulfilled = (haven === "civilized")
                ? totalWaterUnitsNeeded
                : Math.min(totalWaterUnitsNeeded, waterFromDualFood + waterUnitsTakenFromSources);

            const waterShortfallUnits = (haven === "civilized")
                ? 0
                : Math.max(0, totalWaterUnitsNeeded - totalWaterFulfilled);
            let waterShortfallDays = (haven === "civilized" || wpd <= 0)
                ? 0
                : Math.ceil(waterShortfallUnits / wpd);
            let hasDehydrationRisk = (haven === "wilderness") && (waterShortfallDays > 0);
            const hydratedDaysCount = (haven === "civilized")
                ? 7
                : Math.max(0, 7 - waterShortfallDays);
            const waterPintsRemainingInPack = Math.max(0, totalPackWaterPints - waterUnitsTakenFromSources);

            // Format Days 1–6 food summary with remaining pack stock
            let autoFoodSummary = null;
            let autoFoodTooltip = null;
            if (autoConsumed1to6.length > 0) {
                autoFoodSummary = autoConsumed1to6.map(f => {
                    const totalConsumedOfItem = consumedByItem.get(f.id) ?? f.quantity;
                    const reservedForDay7 = (f.id === selectedDepartureMealId) ? 1 : 0;
                    const leftInPack = Math.max(0, f.totalInPack - totalConsumedOfItem - reservedForDay7);
                    const dualTag = f.isDual ? " [dual]" : "";
                    return `${f.quantity}× ${f.name}${dualTag} (${leftInPack} in pack)`;
                }).join(", ");
                autoFoodTooltip = bulletTip("From the pack", autoConsumed1to6.map(f => {
                    const totalConsumedOfItem = consumedByItem.get(f.id) ?? f.quantity;
                    const reservedForDay7 = (f.id === selectedDepartureMealId) ? 1 : 0;
                    const leftInPack = Math.max(0, f.totalInPack - totalConsumedOfItem - reservedForDay7);
                    return `${f.quantity}× ${f.name} (${leftInPack} left)`;
                }));
            }

            // Format Days 1–6 water summary
            let autoWaterSummary = null;
            let autoWaterTooltip = null;
            if (haven === "wilderness") {
                const dualNote = waterFromDualFood > 0 ? ` (${waterFromDualFood}u from food)` : "";
                if (hasDehydrationRisk) {
                    autoWaterSummary = `${totalWaterFulfilled}/${totalWaterUnitsNeeded}u (${waterShortfallUnits}u short)`;
                    autoWaterTooltip = bulletTip("Water short", [
                        `${totalWaterFulfilled} of ${totalWaterUnitsNeeded} units${dualNote}`,
                        `${waterShortfallDays} days short`,
                        "DC 15 Constitution save, or exhaustion"
                    ]);
                } else {
                    autoWaterSummary = `${totalWaterFulfilled}/${totalWaterUnitsNeeded}u (${waterPintsRemainingInPack} in pack)`;
                    autoWaterTooltip = bulletTip("Water", [
                        `${totalWaterFulfilled} of ${totalWaterUnitsNeeded} units drunk${dualNote}`,
                        `${waterPintsRemainingInPack} left in the pack`
                    ]);
                }
            }

            const daysToFeed = days1to6Needed;
            totalNominatedRations += totalAutoConsumed;

            const surMod = Number(actor.system?.skills?.sur?.total ?? actor.system?.skills?.sur?.mod ?? 0);
            const survivalModFormatted = surMod >= 0 ? `+${surMod}` : `${surMod}`;

            const hasAnyRolled = rawSchedule.some(entry => entry.rolled && entry.mode !== "skip");

            const gatheringSchedule = rawSchedule.map(entry => {
                const mode = entry.mode ?? "forage";
                const isSkip = mode === "skip";
                const isHunt = mode === "hunt";
                const isForage = mode === "forage";
                const dc = isSkip ? null : (isHunt ? (this._campLogistics._huntDC ?? 14) : (this._campLogistics._forageDC ?? 12));

                const canToggle = !entry.rolled && isOwner && (!hasAnyRolled || isGM);
                let tooltip;
                if (isSkip) {
                    const editHint = canToggle ? (isGM ? " Click to toggle choice." : " Click to toggle.") : "";
                    tooltip = `Day ${entry.day}: Skipped (no roll or rations).${editHint}`;
                } else if (entry.rolled) {
                    const outcomeText = entry.detail
                        ? entry.detail
                        : (entry.success ? "find recorded" : "nothing");
                    tooltip = bulletTip(`Day ${entry.day} ${isHunt ? "Hunt" : "Forage"}`, [
                        `Check ${entry.rollTotal} vs DC ${dc}`,
                        outcomeText
                    ]);
                } else {
                    const toggleHint = isOwner ? " Click to toggle." : "";
                    tooltip = `Day ${entry.day}: ${isHunt ? "Hunt" : "Forage"} (DC ${dc}).${toggleHint}`;
                }

                return {
                    ...entry,
                    dc,
                    isForage,
                    isHunt,
                    isSkip,
                    icon: isSkip ? "fas fa-minus" : (isHunt ? "fas fa-crosshairs" : "fas fa-leaf"),
                    label: isSkip ? "Skip" : (isHunt ? "Hunt" : "Forage"),
                    modeLabel: isSkip ? "Camp" : (isHunt ? "Hunt" : "Forage"),
                    canToggle,
                    tooltip,
                    finds: GatherYieldService.presentItems(entry.items, {
                        rations: entry.fromTable ? 0 : (entry.yield ?? 0)
                    })
                };
            });

            const activeCount = forageCount + huntCount;
            const unrolledCount = activeCount - rolledCount;
            const isAllRolled = rawSchedule.every(entry => entry.mode === "skip" || entry.rolled);
            const hasRolled = rolledCount > 0;

            let roleClass = "role-mixed";
            if (activeCount === 0) {
                roleClass = "role-skip";
            } else if (huntCount === 0) {
                roleClass = "role-forage";
            } else if (forageCount === 0) {
                roleClass = "role-hunt";
            }

            const labelParts = [];
            if (forageCount > 0) labelParts.push(`${forageCount}🌿`);
            if (huntCount > 0) labelParts.push(`${huntCount}🎯`);
            if (skipCount > 0) labelParts.push(`${skipCount}➖`);
            const configLabel = labelParts.length > 0 ? labelParts.join(" ") : "All Skipped";

            const dayBreakdownLines = rawSchedule.map(d => {
                if (d.mode === "skip") return `Day ${d.day}: Skipped (In Camp)`;
                const type = d.mode === "hunt" ? "Hunt" : "Forage";
                if (d.rolled) {
                    const dc = d.mode === "hunt" ? (this._campLogistics._huntDC ?? 14) : (this._campLogistics._forageDC ?? 12);
                    const found = d.detail || (d.success ? "find recorded" : "nothing");
                    return `Day ${d.day}: ${type} (Check ${d.rollTotal} vs DC ${dc}): ${found}`;
                }
                return `Day ${d.day}: ${type} (Unrolled)`;
            });

            const rolledHauls = rawSchedule.filter(entry => entry.rolled && entry.mode !== "skip");
            const haulLines = rolledHauls.map(entry => {
                const kind = entry.mode === "hunt" ? "Hunt" : "Forage";
                const found = entry.detail || (entry.success ? "find recorded" : "nothing");
                return `Day ${entry.day} ${kind}: ${found}`;
            });
            const findCount = rolledHauls.filter(entry => {
                if (Array.isArray(entry.items) && entry.items.length > 0) return true;
                return Boolean(entry.detail) && entry.success;
            }).length;
            const gatheringSummary = {
                forageCount,
                huntCount,
                skipCount,
                activeCount,
                unrolledCount,
                rolledCount,
                totalYield: charHarvestedRolled,
                isAllRolled,
                hasRolled,
                findCount,
                hasFinds: findCount > 0,
                freshForageNote: rawSchedule.some(entry => GatherYieldService.includesPerishable(entry.items))
                    ? FRESH_FORAGE_NOTE
                    : "",
                label: hasRolled ? (findCount > 0 ? `${findCount} found` : "none found") : configLabel,
                roleClass,
                breakdownTooltip: dayBreakdownLines.join("\n"),
                harvestLines: rawSchedule
                    .filter(entry => entry.rolled && entry.mode !== "skip" && entry.detail)
                    .map(entry => `Day ${entry.day}: ${entry.detail}`),
                reportLine: [
                    forageCount > 0 ? `${forageCount} foraging` : "",
                    huntCount > 0 ? `${huntCount} hunting` : "",
                    skipCount > 0 ? `${skipCount} in camp` : ""
                ].filter(Boolean).join(", "),
                tooltip: bulletTip("Gathering, days 1-6", [
                    `${forageCount} forage (DC ${this._campLogistics._forageDC})`,
                    `${huntCount} hunt (DC ${this._campLogistics._huntDC})`,
                    skipCount > 0 ? `${skipCount} skipped` : "",
                    `Survival ${survivalModFormatted}`,
                    ...haulLines
                ])
            };

            const sustenanceRole = {
                role: rawSchedule.find(d => d.mode !== "skip")?.mode ?? "skip",
                rolled: isAllRolled,
                yield: charHarvestedRolled,
                success: charHarvestedRolled > 0
            };

            // Day 7 Departure Meals (buff food or available plain food)
            const departureFoodOptions = (actor.items ?? []).filter(i => {
                if (ItemClassifier.isSpoiled?.(i)) return false;
                const qty = i.system?.quantity ?? 1;
                if (qty <= 0) return false;
                const flags = i.flags?.[MODULE_ID] ?? {};
                return ItemClassifier.isFood(i, actor) || flags.wellFed || flags.buff || flags.chefTreat;
            }).map(i => {
                const flags = i.flags?.[MODULE_ID] ?? {};
                const satiates = Array.isArray(flags.satiates) ? flags.satiates : [];
                const isDual = satiates.includes("water") || flags.satiatesWater === true;
                const { buffSummary, hasBuff } = describeItemMealBuff(flags);

                const totalQty = i.system?.quantity ?? 1;
                const usedForSustenance = consumedByItem.get(i.id) ?? 0;
                const isSelected = i.id === selectedDepartureMealId;
                const availableQty = isSelected
                    ? Math.max(1, totalQty - usedForSustenance)
                    : Math.max(0, totalQty - usedForSustenance);

                return {
                    id: i.id,
                    name: i.name,
                    img: i.img,
                    quantity: availableQty,
                    buffSummary,
                    hasBuff,
                    isDual,
                    isSelected,
                    ...SpoilageClock.chipFields(i)
                };
            });

            const selectedDepartureMeal = departureFoodOptions.find(f => f.id === selectedDepartureMealId) ?? null;

            // Day 7 Departure Drinks (special beverages or water)
            const selectedDepartureDrinkId = this._departureDrinks.get(actor.id) ?? null;
            const departureDrinkOptions = (actor.items ?? []).filter(i => {
                if (ItemClassifier.isSpoiled?.(i)) return false;
                const qty = i.system?.quantity ?? 1;
                if (qty <= 0) return false;
                return ItemClassifier.isWater(i, actor);
            }).map(i => {
                const flags = i.flags?.[MODULE_ID] ?? {};
                const { buffSummary, hasBuff } = describeItemMealBuff(flags);

                const isSelected = i.id === selectedDepartureDrinkId;
                return {
                    id: i.id,
                    name: i.name,
                    img: i.img,
                    quantity: i.system?.quantity ?? 1,
                    buffSummary,
                    hasBuff,
                    isSelected,
                    ...SpoilageClock.chipFields(i)
                };
            });
            const selectedDepartureDrink = departureDrinkOptions.find(d => d.id === selectedDepartureDrinkId) ?? null;

            // Symmetrical Food & Water Inventory Flows
            const totalPackFoodRations = plainFoodItems.reduce((sum, f) => sum + f.quantity, 0);
            const totalFoodAvailable = totalPackFoodRations + (isSelectedDepartureMeal ? 1 : 0);
            const foodConsumedTotal = totalAutoConsumed + (isSelectedDepartureMeal ? 1 : 0);
            const foodRemainingInPack = Math.max(0, totalFoodAvailable - foodConsumedTotal);

            const foodFlow = {
                consumed: foodConsumedTotal,
                inPack: totalFoodAvailable,
                remaining: foodRemainingInPack,
                shortfallDays: foodShortfallDays,
                isShort: hasStarvationRisk,
                fedDaysCount
            };

            const waterFlow = {
                consumed: totalWaterFulfilled,
                needed: totalWaterUnitsNeeded,
                inPack: totalPackWaterPints,
                remaining: waterPintsRemainingInPack,
                shortfallDays: waterShortfallDays,
                shortfallUnits: waterShortfallUnits,
                isShort: hasDehydrationRisk,
                hydratedDaysCount
            };

            // 7-Day Day-Pip Timeline Breakdown (Illustrated Asset Consumption)
            const esc = s => String(s ?? "").replace(/&/g, "&amp;").replace(/'/g, "&#39;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
            const sanitizeImg = (img, fallback) => {
                if (!img || typeof img !== "string" || img.includes("mystery-man")) return fallback;
                return img;
            };

            const buildSustenanceTooltip = ({ day, type, name, img, icon, detail, buff, isShortfall }) => {
                const iconHtml = img
                    ? `<img class='tooltip-img' src='${esc(img)}' alt='${esc(name)}'>`
                    : `<div class='tooltip-icon-fallback'><i class='${esc(icon || "fas fa-utensils")}'></i></div>`;
                const buffHtml = buff
                    ? `<div class='tooltip-buff'><i class='fas fa-wand-magic-sparkles'></i> ${esc(buff)}</div>`
                    : "";
                const detailClass = isShortfall ? "tooltip-body shortfall" : "tooltip-body";
                return `<div class='sustenance-tooltip'>` +
                    `<div class='tooltip-header'>` +
                    iconHtml +
                    `<div class='tooltip-titles'>` +
                    `<span class='tooltip-day-label'>Day ${day} ${esc(type)}</span>` +
                    `<strong class='tooltip-item-name'>${esc(name)}</strong>` +
                    `</div></div>` +
                    `<div class='${detailClass}'>${esc(detail)}</div>` +
                    buffHtml +
                    `</div>`;
            };

            // Setup pools for daily food allocation
            const harvestFoodRemaining = 0;
            const harvestImg = (huntCount > 0 && forageCount === 0)
                ? "icons/consumables/meat/meat-chunk-red.webp"
                : "icons/consumables/fruit/berries-cluster-purple.webp";
            const harvestName = (huntCount > 0 && forageCount === 0)
                ? "Gathered Game"
                : ((forageCount > 0 && huntCount === 0) ? "Foraged Provisions" : "Camp Harvest");

            const packFoodPool = plainFoodItems.map(f => ({
                id: f.id,
                name: f.name,
                img: sanitizeImg(f.img, "icons/consumables/food/bread-loaf-round-white.webp"),
                available: (f.id === selectedDepartureMealId) ? Math.max(0, f.quantity - 1) : f.quantity,
                totalInPack: f.quantity,
                isDual: f.isDual
            }));

            const dailyFoodRecord = [];
            const foodDailyPips = [];

            for (let d = 1; d <= 7; d++) {
                const isDeparture = (d === 7);
                if (isDeparture) {
                    if (haven === "civilized") {
                        const mealName = selectedDepartureMeal ? selectedDepartureMeal.name : "Settlement Feast";
                        const mealImg = sanitizeImg(selectedDepartureMeal?.img, "icons/consumables/food/bowl-stew-brown.webp");
                        const buffNote = selectedDepartureMeal?.buffSummary || "Lodgings & Meals Covered";
                        const tooltip = buildSustenanceTooltip({
                            day: d,
                            type: "Departure Meal",
                            name: mealName,
                            img: mealImg,
                            detail: "Covered by settlement lodgings & lifestyle.",
                            buff: selectedDepartureMeal?.buffSummary
                        });
                        foodDailyPips.push({
                            day: d,
                            isFed: true,
                            img: mealImg,
                            name: mealName,
                            icon: "fas fa-utensils",
                            isDeparture: true,
                            tooltip
                        });
                        dailyFoodRecord.push({ isDual: selectedDepartureMeal?.isDual ?? false, name: mealName, img: mealImg });
                    } else if (selectedDepartureMeal) {
                        const mealName = selectedDepartureMeal.name;
                        const mealImg = sanitizeImg(selectedDepartureMeal.img, "icons/consumables/food/bread-loaf-round-white.webp");
                        const tooltip = buildSustenanceTooltip({
                            day: d,
                            type: "Departure Meal",
                            name: mealName,
                            img: mealImg,
                            detail: `Send-off meal before departure${selectedDepartureMeal.isDual ? " (satiates food & water)" : ""}.`,
                            buff: selectedDepartureMeal.buffSummary
                        });
                        foodDailyPips.push({
                            day: d,
                            isFed: true,
                            img: mealImg,
                            name: mealName,
                            icon: selectedDepartureMeal.hasBuff ? "fas fa-wand-magic-sparkles" : "fas fa-bread-slice",
                            isDeparture: true,
                            tooltip
                        });
                        dailyFoodRecord.push({ isDual: selectedDepartureMeal.isDual, name: mealName, img: mealImg });
                    } else {
                        // Day 7 routine food needed
                        let dayUnitsNeeded = fpd;
                        const consumedItems = [];
                        if (harvestFoodRemaining > 0) {
                            const take = Math.min(harvestFoodRemaining, dayUnitsNeeded);
                            harvestFoodRemaining -= take;
                            dayUnitsNeeded -= take;
                            consumedItems.push({ name: harvestName, img: harvestImg, take, isHarvest: true, isDual: false });
                        }
                        for (const item of packFoodPool) {
                            if (dayUnitsNeeded <= 0) break;
                            if (item.available <= 0) continue;
                            const take = Math.min(item.available, dayUnitsNeeded);
                            item.available -= take;
                            dayUnitsNeeded -= take;
                            consumedItems.push({
                                id: item.id,
                                name: item.name,
                                img: item.img,
                                take,
                                isHarvest: false,
                                isDual: item.isDual,
                                remaining: item.available
                            });
                        }
                        const isFed = (dayUnitsNeeded === 0);
                        if (isFed) {
                            const primary = consumedItems[0];
                            const itemImg = primary.img;
                            const itemName = consumedItems.length === 1 ? primary.name : consumedItems.map(c => `${c.take}× ${c.name}`).join(", ");
                            const detail = primary.isHarvest
                                ? `Consumed from camp harvest (+${charHarvestedRolled} rolled).`
                                : `Routine departure ration (${primary.take} used, ${primary.remaining ?? 0} left in pack).`;
                            const tooltip = buildSustenanceTooltip({
                                day: d,
                                type: "Departure Ration",
                                name: itemName,
                                img: itemImg,
                                detail
                            });
                            foodDailyPips.push({
                                day: d,
                                isFed: true,
                                img: itemImg,
                                name: itemName,
                                itemId: primary.id ?? null,
                                units: primary.take ?? fpd,
                                editable: !primary.isHarvest && !!primary.id,
                                icon: "fas fa-bread-slice",
                                isDeparture: true,
                                tooltip
                            });
                            dailyFoodRecord.push({ isDual: consumedItems.some(c => c.isDual), name: itemName, img: itemImg });
                        } else {
                            const tooltip = buildSustenanceTooltip({
                                day: d,
                                type: "Departure",
                                name: "Starvation",
                                icon: "fas fa-triangle-exclamation text-rose",
                                detail: "No food available for departure send-off.",
                                isShortfall: true
                            });
                            foodDailyPips.push({
                                day: d,
                                isFed: false,
                                img: null,
                                name: "Starvation",
                                editable: true,
                                icon: "fas fa-times",
                                isDeparture: true,
                                tooltip
                            });
                            dailyFoodRecord.push({ isDual: false, name: "Starvation", img: null });
                        }
                    }
                } else {
                    // Days 1–6
                    if (haven === "civilized") {
                        const mealName = "Settlement Meal";
                        const mealImg = "icons/consumables/food/bowl-stew-brown.webp";
                        const tooltip = buildSustenanceTooltip({
                            day: d,
                            type: "Sustenance",
                            name: mealName,
                            img: mealImg,
                            detail: "Provided by town lodgings & lifestyle."
                        });
                        foodDailyPips.push({
                            day: d,
                            isFed: true,
                            img: mealImg,
                            name: mealName,
                            icon: "fas fa-bread-slice",
                            isDeparture: false,
                            tooltip
                        });
                        dailyFoodRecord.push({ isDual: false, name: mealName, img: mealImg });
                    } else if (d > days1to6Needed) {
                        // Supplies exempt by GM logistics setting
                        const mealName = "Supplies Exempt";
                        const mealImg = "icons/consumables/food/bread-loaf-round-white.webp";
                        const tooltip = buildSustenanceTooltip({
                            day: d,
                            type: "Sustenance",
                            name: mealName,
                            img: mealImg,
                            detail: "No camp provisions required for this day."
                        });
                        foodDailyPips.push({
                            day: d,
                            isFed: true,
                            img: mealImg,
                            name: mealName,
                            icon: "fas fa-check",
                            isDeparture: false,
                            tooltip
                        });
                        dailyFoodRecord.push({ isDual: false, name: mealName, img: mealImg });
                    } else {
                        let dayUnitsNeeded = fpd;
                        const consumedItems = [];
                        if (harvestFoodRemaining > 0) {
                            const take = Math.min(harvestFoodRemaining, dayUnitsNeeded);
                            harvestFoodRemaining -= take;
                            dayUnitsNeeded -= take;
                            consumedItems.push({ name: harvestName, img: harvestImg, take, isHarvest: true, isDual: false });
                        }
                        for (const item of packFoodPool) {
                            if (dayUnitsNeeded <= 0) break;
                            if (item.available <= 0) continue;
                            const take = Math.min(item.available, dayUnitsNeeded);
                            item.available -= take;
                            dayUnitsNeeded -= take;
                            consumedItems.push({
                                id: item.id,
                                name: item.name,
                                img: item.img,
                                take,
                                isHarvest: false,
                                isDual: item.isDual,
                                remaining: item.available
                            });
                        }
                        const isFed = (dayUnitsNeeded === 0);
                        if (isFed) {
                            const primary = consumedItems[0];
                            const itemImg = primary.img;
                            const itemName = consumedItems.length === 1 ? primary.name : consumedItems.map(c => `${c.take}× ${c.name}`).join(", ");
                            const dualTag = primary.isDual ? " (satiates food & water)" : "";
                            const detail = (primary.isHarvest
                                ? `Harvested camp provisions (${primary.take} used).`
                                : `Pack provisions (${primary.take} used, ${primary.remaining ?? 0} left in pack).`) + dualTag;
                            const tooltip = buildSustenanceTooltip({
                                day: d,
                                type: "Sustenance",
                                name: itemName,
                                img: itemImg,
                                detail
                            });
                            foodDailyPips.push({
                                day: d,
                                isFed: true,
                                img: itemImg,
                                name: itemName,
                                itemId: primary.id ?? null,
                                units: primary.take ?? fpd,
                                editable: !primary.isHarvest && !!primary.id,
                                icon: "fas fa-bread-slice",
                                isDeparture: false,
                                tooltip
                            });
                            dailyFoodRecord.push({ isDual: consumedItems.some(c => c.isDual), name: itemName, img: itemImg });
                        } else {
                            const tooltip = buildSustenanceTooltip({
                                day: d,
                                type: "Sustenance",
                                name: "Starvation",
                                icon: "fas fa-triangle-exclamation text-rose",
                                detail: "No food available in pack or camp harvest.",
                                isShortfall: true
                            });
                            foodDailyPips.push({
                                day: d,
                                isFed: false,
                                img: null,
                                name: "Starvation",
                                editable: true,
                                icon: "fas fa-times",
                                isDeparture: false,
                                tooltip
                            });
                            dailyFoodRecord.push({ isDual: false, name: "Starvation", img: null });
                        }
                    }
                }
            }

            // Setup pools for daily water allocation
            const packWaterPool = waterOptions.map(opt => ({
                id: opt.itemId,
                name: opt.name,
                img: sanitizeImg(opt.icon, "icons/tools/instruments/waterskin.webp"),
                availablePints: (opt.itemId === selectedDepartureDrinkId) ? Math.max(0, opt.totalPints - 1) : opt.totalPints,
                totalInPack: opt.totalPints
            }));

            const waterDailyPips = [];

            for (let d = 1; d <= 7; d++) {
                const isDeparture = (d === 7);
                if (haven === "civilized") {
                    const drinkName = isDeparture && selectedDepartureDrink ? selectedDepartureDrink.name : "Tavern Ale & Fresh Water";
                    const drinkImg = isDeparture && selectedDepartureDrink ? sanitizeImg(selectedDepartureDrink.img, "icons/consumables/drinks/pitcher-stoneware-white.webp") : "icons/consumables/drinks/pitcher-stoneware-white.webp";
                    const buffNote = isDeparture && selectedDepartureDrink?.buffSummary ? selectedDepartureDrink.buffSummary : "Clean water & lodging beverages provided";
                    const tooltip = buildSustenanceTooltip({
                        day: d,
                        type: isDeparture ? "Departure Drink" : "Hydration",
                        name: drinkName,
                        img: drinkImg,
                        detail: `${buffNote}.`
                    });
                    waterDailyPips.push({
                        day: d,
                        isHydrated: true,
                        img: drinkImg,
                        name: drinkName,
                        icon: "fas fa-droplet",
                        isDeparture,
                        tooltip
                    });
                } else if (d > totalDaysWaterNeeded && !isDeparture) {
                    const drinkName = "Hydration Exempt";
                    const drinkImg = "icons/magic/water/water-drop-swirl-blue.webp";
                    const tooltip = buildSustenanceTooltip({
                        day: d,
                        type: "Hydration",
                        name: drinkName,
                        img: drinkImg,
                        detail: "No water required from camp supplies."
                    });
                    waterDailyPips.push({
                        day: d,
                        isHydrated: true,
                        img: drinkImg,
                        name: drinkName,
                        icon: "fas fa-check",
                        isDeparture,
                        tooltip
                    });
                } else {
                    const foodOfThisDay = dailyFoodRecord[d - 1];
                    let unitsNeeded = wpd;
                    const waterSourcesUsed = [];

                    // 1. Dual-satiating food credit
                    if (foodOfThisDay?.isDual && unitsNeeded > 0) {
                        unitsNeeded -= 1;
                        waterSourcesUsed.push({
                            name: `${foodOfThisDay.name} (Moisture)`,
                            img: foodOfThisDay.img || "icons/consumables/fruit/berries-cluster-purple.webp",
                            pints: 1,
                            isDualFood: true
                        });
                    }

                    // 2. Day 7 departure drink credit
                    if (isDeparture && selectedDepartureDrink && unitsNeeded > 0) {
                        unitsNeeded -= 1;
                        waterSourcesUsed.push({
                            name: selectedDepartureDrink.name,
                            img: sanitizeImg(selectedDepartureDrink.img, "icons/magic/water/water-drop-swirl-blue.webp"),
                            pints: 1,
                            isDepartureDrink: true,
                            buff: selectedDepartureDrink.buffSummary
                        });
                    }

                    // 3. Pack water sources
                    for (const source of packWaterPool) {
                        if (unitsNeeded <= 0) break;
                        if (source.availablePints <= 0) continue;
                        const take = Math.min(source.availablePints, unitsNeeded);
                        source.availablePints -= take;
                        unitsNeeded -= take;
                        waterSourcesUsed.push({
                            itemId: source.id,
                            name: source.name,
                            img: source.img,
                            pints: take,
                            remaining: source.availablePints
                        });
                    }

                    const isHydrated = (unitsNeeded === 0);
                    if (isHydrated) {
                        const primary = waterSourcesUsed[0];
                        const itemImg = primary ? primary.img : "icons/tools/instruments/waterskin.webp";
                        const itemName = waterSourcesUsed.length === 1 ? primary.name : waterSourcesUsed.map(s => `${s.pints}u ${s.name}`).join(" + ");
                        let detail = "";
                        if (primary?.isDepartureDrink) {
                            detail = `Departure beverage${primary.buff ? ` (${primary.buff})` : ""}.`;
                        } else if (primary?.isDualFood) {
                            detail = `Hydrated by moisture from ${primary.name}.`;
                        } else if (primary) {
                            detail = `${primary.pints} units consumed (${primary.remaining ?? 0} left in pack).`;
                        } else {
                            detail = "Hydrated.";
                        }
                        const tooltip = buildSustenanceTooltip({
                            day: d,
                            type: isDeparture ? "Departure Drink" : "Hydration",
                            name: itemName,
                            img: itemImg,
                            detail,
                            buff: isDeparture ? selectedDepartureDrink?.buffSummary : null
                        });
                        waterDailyPips.push({
                            day: d,
                            isHydrated: true,
                            img: itemImg,
                            name: itemName,
                            icon: isDeparture ? (selectedDepartureDrink?.hasBuff ? "fas fa-wine-glass" : "fas fa-droplet") : "fas fa-droplet",
                            isDeparture,
                            tooltip,
                            pours: waterSourcesUsed.map(source => ({
                                itemId: source.itemId ?? null,
                                name: source.name,
                                img: source.img ?? null,
                                pints: source.pints
                            })),
                            need: wpd,
                            editable: waterSourcesUsed.some(source => source.itemId)
                        });
                    } else {
                        const tooltip = buildSustenanceTooltip({
                            day: d,
                            type: isDeparture ? "Departure Drink" : "Hydration",
                            name: "Dehydration",
                            icon: "fas fa-droplet-slash text-rose",
                            detail: "No water available in waterskins or pack sources.",
                            isShortfall: true
                        });
                        waterDailyPips.push({
                            day: d,
                            isHydrated: false,
                            img: null,
                            name: "Dehydration",
                            icon: "fas fa-times",
                            isDeparture,
                            tooltip,
                            pours: waterSourcesUsed.map(source => ({
                                itemId: source.itemId ?? null,
                                name: source.name,
                                img: source.img ?? null,
                                pints: source.pints
                            })),
                            need: wpd,
                            editable: true
                        });
                    }
                }
            }

            const sustenancePlan = this._sustenanceEdits.get(actor.id) ?? null;
            const edited = applySustenancePlan(sustenancePlan, foodDailyPips, waterDailyPips, departureFoodOptions);
            foodShortfallDays = edited.foodShort;
            waterShortfallDays = edited.waterShort;
            hasStarvationRisk = haven === "wilderness" && foodShortfallDays > 0;
            hasDehydrationRisk = haven === "wilderness" && waterShortfallDays > 0;
            foodFlow.shortfallDays = foodShortfallDays;
            foodFlow.isShort = hasStarvationRisk;
            foodFlow.fedDaysCount = haven === "civilized" ? 7 : Math.max(0, 7 - foodShortfallDays);
            waterFlow.shortfallDays = waterShortfallDays;
            waterFlow.isShort = hasDehydrationRisk;
            waterFlow.hydratedDaysCount = haven === "civilized" ? 7 : Math.max(0, 7 - waterShortfallDays);
            this._sustenanceSnapshot.set(actor.id, {
                food: foodDailyPips.map(pip => ({
                    empty: !pip.isFed || !!pip.isCleared,
                    editable: !!pip.editable,
                    itemId: pip.itemId ?? null,
                    units: pip.units || fpd || 1
                })),
                water: waterDailyPips.map(pip => ({
                    editable: !!pip.editable,
                    need: pip.need ?? wpd,
                    pours: clonePours(pip.pours)
                }))
            });

            // Sustenance breakdown drawer auto-opens on the Sustenance
            // workflow step so the mock's diegetic 7-day pile / vessel is
            // visible by default (mock: rest-dock-gritty sustenance).
            const isSustenanceDrawerOpen = (this._selectedWorkflowStep === "sustenance")
                || (this._expandedTiers.get(actor.id)?.has("sustenance") ?? false);
            const foodTooltip = hasStarvationRisk
                ? bulletTip("Food short", [
                    `${foodShortfallDays} days with nothing to eat`,
                    "Risks exhaustion"
                ])
                : bulletTip("Food", [
                    `${foodConsumedTotal} used`,
                    `${foodRemainingInPack} left in the pack`
                ]);

            let day7Subtext = isCivilized ? "Covered by Lodgings" : "Standard Camp Sustenance";
            let day7SubtextClass = "neutral";
            if (selectedDepartureMeal?.hasBuff) {
                day7Subtext = selectedDepartureMeal.buffSummary;
                day7SubtextClass = "meal-buff";
            } else if (hasDehydrationRisk) {
                day7Subtext = `⚠ Dehydration (${waterShortfallDays}d Short)`;
                day7SubtextClass = "fail";
            } else if (hasStarvationRisk && day7RoutineFoodNeeded > 0) {
                day7Subtext = `⚠ Starvation (${foodShortfallDays}d Short)`;
                day7SubtextClass = "fail";
            }

            // Station activity roll states & fortify summary
            const activityRolls = this._getOrCreateActivityRolls(actor.id);
            const isCommitted = this._committedActorIds.has(actor.id);
            let rollableDaysCount = 0;
            let rolledDaysCount = 0;
            let skillCheckDaysCount = 0;
            let skillCheckRolledCount = 0;
            let skillCheckSuccessCount = 0;
            let fletchYieldTotal = 0;
            const skillLabels = [];
            let skillActDef = null;
            let fortifyAssignedDays = 0;
            let fortifyRolledCount = 0;
            let fortifySuccessCount = 0;
            let fortifyFailCount = 0;
            let craftDaysCount = 0;
            let craftResolvedCount = 0;

            const augmentedSegments = budget.segments.map(seg => {
                const dayNum = seg.dayNumber;
                const actDef = seg.filled ? ActivityRegistry.getActivity(seg.activityId) : null;
                const checkDef = actDef?.check ?? null;
                const isCraft = seg.filled && ["cook", "brew", "craft"].includes(seg.activityId);
                const isRollable = !!checkDef || isCraft;
                const roll = activityRolls.find(r => r.day === dayNum);

                let rollStatus = "none";
                if (isCraft) {
                    craftDaysCount++;
                    if (roll && roll.rolled) {
                        craftResolvedCount++;
                        rollStatus = roll.success ? "pass" : "fail";
                    } else {
                        rollStatus = "pending";
                    }
                } else if (isRollable) {
                    rollableDaysCount++;
                    if (roll && roll.rolled) {
                        rolledDaysCount++;
                        rollStatus = roll.success ? "pass" : "fail";
                    } else {
                        rollStatus = "pending";
                    }

                    if (seg.activityId === "fortify") {
                        fortifyAssignedDays++;
                        if (roll && roll.rolled) {
                            fortifyRolledCount++;
                            if (roll.success) fortifySuccessCount++;
                            else fortifyFailCount++;
                        }
                    } else {
                        skillCheckDaysCount++;
                        if (actDef?.label && !skillLabels.includes(actDef.label)) skillLabels.push(actDef.label);
                        if (!skillActDef) skillActDef = actDef;
                        if (roll?.rolled) {
                            skillCheckRolledCount++;
                            if (roll.success) skillCheckSuccessCount++;
                        }
                        if (seg.activityId === "fletch" && roll?.yieldQty) {
                            fletchYieldTotal += Number(roll.yieldQty) || 0;
                        }
                    }
                }

                let pipTooltip = `Day ${dayNum}: ${seg.label}`;
                if (isCraft) {
                    if (roll && roll.rolled) {
                        pipTooltip += ` · Resolved (${roll.success ? "Success" : "Failed"})`;
                        if (this._isGM) pipTooltip += " · Click to reroll";
                    } else if (isCommitted || this._isGM) {
                        pipTooltip += ` · Unresolved Craft. Click to resolve`;
                    } else {
                        pipTooltip += ` · Unresolved Craft (Lock in choices to resolve)`;
                    }
                } else if (isRollable) {
                    if (roll && roll.rolled) {
                        pipTooltip += ` · Check: ${roll.rollTotal} vs DC ${roll.dc ?? checkDef.dc} (${roll.success ? "Held" : "Failed"})`;
                        if (this._isGM) pipTooltip += " · Click to reroll";
                    } else if (isCommitted || this._isGM) {
                        pipTooltip += ` · Unrolled (DC ${checkDef.dc}). Click to roll`;
                    } else {
                        pipTooltip += ` · Unrolled (DC ${checkDef.dc}). Lock in choices to roll`;
                    }
                }

                const canRollPip = isRollable && (isCommitted || this._isGM);

                return {
                    ...seg,
                    isRollable,
                    canRollPip,
                    rollStatus,
                    rollTotal: roll?.rollTotal ?? null,
                    dc: roll?.dc ?? checkDef?.dc ?? (isCraft ? 12 : null),
                    rollSuccess: roll?.success ?? null,
                    pipTooltip
                };
            });
            budget.segments = augmentedSegments;
            budget.activeActivities = budget.activities.filter(a => a.isActive);

            // Build flat 7-day slot array for the activities day strip
            const activityDaySlots = [];
            for (const act of budget.activeActivities) {
                for (let i = 0; i < act.assignedDays; i++) {
                    activityDaySlots.push({ day: activityDaySlots.length + 1, label: act.label, icon: act.icon, hint: act.hint ?? "" });
                }
            }
            while (activityDaySlots.length < 7) {
                const d = activityDaySlots.length + 1;
                activityDaySlots.push({ day: d, label: "Open", icon: "fas fa-question", hint: "Unallocated day", isEmpty: true });
            }

            const hasFortify = fortifyAssignedDays > 0;
            const fortifySummary = hasFortify ? {
                assignedDays: fortifyAssignedDays,
                rolledCount: fortifyRolledCount,
                unrolledCount: fortifyAssignedDays - fortifyRolledCount,
                successCount: fortifySuccessCount,
                failCount: fortifyFailCount,
                isAllRolled: fortifyRolledCount === fortifyAssignedDays,
                hasUnrolled: fortifyRolledCount < fortifyAssignedDays,
                allSuccess: fortifyRolledCount > 0 && fortifyFailCount === 0,
                hasSuccess: fortifySuccessCount > 0,
                resultLabel: fortifySuccessCount > 0
                    ? `${fortifySuccessCount}/${fortifyAssignedDays} Fortified`
                    : `0/${fortifyAssignedDays} Fortified`,
                resultClass: fortifySuccessCount > 0 ? "pass" : "neutral",
                resultIcon: "fas fa-shield-alt",
                statusText: fortifyRolledCount === 0
                    ? `${fortifyAssignedDays}d Unrolled`
                    : `${fortifySuccessCount}/${fortifyAssignedDays} Fortified`,
                tooltip: `Fortify Defenses (DC 12): ${fortifySuccessCount}/${fortifyAssignedDays} days holding (-${fortifySuccessCount * 2} DC).`
            } : null;

            const hasCraftingActivities = craftDaysCount > 0;
            const craftDaysRemaining = Math.max(0, craftDaysCount - craftResolvedCount);
            const isAllCraftsResolved = hasCraftingActivities ? (craftResolvedCount === craftDaysCount) : true;

            const hasDefenseRolls = fortifyAssignedDays > 0;
            const skillCheckSummary = buildSkillCheckSummary({
                dayCount: skillCheckDaysCount,
                rolledCount: skillCheckRolledCount,
                successCount: skillCheckSuccessCount,
                labels: skillLabels,
                actDef: skillActDef,
                fletchYield: fletchYieldTotal
            });
            const hasSkillChecks = !!skillCheckSummary;
            const hasRollableActivities = rollableDaysCount > 0;
            const isAllActivitiesRolled = hasRollableActivities ? (rolledDaysCount === rollableDaysCount) : true;

            if (!this._isGM) {
                for (const act of budget.activities ?? []) {
                    const rolled = activityRolls.filter(r => r.activityId === act.id && r.rolled).length;
                    act.canStepDown = act.assignedDays > rolled;
                    act.canClear = rolled === 0;
                }
            } else {
                for (const act of budget.activities ?? []) {
                    act.canClear = true;
                }
            }

            const canChangeCraftPlan = !this._isGM
                && !!actor.isOwner
                && isCommitted
                && craftPlanNeedsEscape(activityRolls, this._craftAvailableCounts(actor, activityRolls));

            const isAllocated = budget.isComplete;
            const isStarving = (haven === "wilderness") && (foodShortfallDays > 0);
            const isDehydrated = (haven === "wilderness") && (waterShortfallDays > 0);
            const isSustenanceRisk = isStarving || isDehydrated;
            const isDefensePending = hasDefenseRolls && !!fortifySummary && !fortifySummary.isAllRolled;
            const isSkillCheckPending = hasSkillChecks && !skillCheckSummary.isAllRolled;
            const isCraftPending = hasCraftingActivities && !isAllCraftsResolved;
            const isGatheringPending = (haven === "wilderness") && gatheringSummary && !gatheringSummary.isAllRolled;

            const isPendingRolls = isDefensePending || isSkillCheckPending || isCraftPending || isGatheringPending;
            const mealsLocked = this._mealsLockedActorIds.has(actor.id);
            const planSettled = isAllocated && isCommitted && mealsLocked && !isPendingRolls;
            const isReady = planSettled && !isSustenanceRisk;
            const isAtRisk = planSettled && isSustenanceRisk;
            const isPending = !isReady && !isAtRisk;

            let statusState = "pending";
            let statusLabel = `${budget.unallocatedDays}d left`;
            let statusIcon = "fas fa-clock";
            let statusTooltip = `${budget.unallocatedDays} days left to plan`;

            if (!isAllocated) {
                statusState = "pending";
                statusLabel = `${budget.unallocatedDays}d left`;
                statusIcon = "fas fa-clock";
                statusTooltip = `${budget.unallocatedDays} days left to plan`;
            } else if (!isCommitted) {
                statusState = "pending";
                statusLabel = "Drafting";
                statusIcon = "fas fa-pencil";
                statusTooltip = "All days planned: waiting to lock in";
            } else if (isCraftPending) {
                statusState = "pending";
                const hasCook = budget.segments.some(s => s.filled && s.activityId === "cook");
                const hasBrew = budget.segments.some(s => s.filled && s.activityId === "brew");
                let craftPrefix = "Craft";
                if (hasCook && !hasBrew) craftPrefix = "Cook";
                else if (hasBrew && !hasCook) craftPrefix = "Brew";
                statusLabel = `${craftPrefix} (${craftDaysRemaining}d)`;
                statusIcon = hasCook ? "fas fa-utensils" : (hasBrew ? "fas fa-flask-vial" : "fas fa-tools");
                statusTooltip = `Crafting rolls pending (${craftDaysRemaining}d remaining)`;
            } else if (isSkillCheckPending) {
                statusState = "pending";
                statusLabel = `${skillCheckSummary.statusName} (${skillCheckSummary.unrolledCount}d)`;
                statusIcon = "fas fa-dice-d20";
                statusTooltip = skillCheckSummary.tooltip;
            } else if (isDefensePending) {
                statusState = "pending";
                const unrolledDef = fortifySummary?.unrolledCount ?? (rollableDaysCount - rolledDaysCount);
                statusLabel = `Defenses (${unrolledDef}d)`;
                statusIcon = "fas fa-shield-halved";
                statusTooltip = `Camp defense rolls pending (${unrolledDef} remaining)`;
            } else if (isGatheringPending) {
                statusState = "pending";
                statusLabel = "Roll Gathering";
                statusIcon = "fas fa-seedling";
                statusTooltip = `Gathering rolls pending (${gatheringSummary.rolledCount}/6 rolled)`;
            } else if (!mealsLocked) {
                statusState = "pending";
                statusLabel = "Meals open";
                statusIcon = "fas fa-utensils";
                statusTooltip = "Food and water are still a draft";
            } else if (isDehydrated && isStarving) {
                statusState = "at-risk";
                statusLabel = `Short (${Math.max(waterShortfallDays, foodShortfallDays)}d)`;
                statusIcon = "fas fa-triangle-exclamation";
                statusTooltip = bulletTip("Short", [
                    `${waterShortfallDays} days of water`,
                    `${foodShortfallDays} days of food`,
                    "Risks exhaustion"
                ]);
            } else if (isDehydrated) {
                statusState = "at-risk";
                statusLabel = `Dehydrated (${waterShortfallDays}d)`;
                statusIcon = "fas fa-droplet-slash";
                statusTooltip = `Short ${waterShortfallDays} days of water (risks exhaustion)`;
            } else if (isStarving) {
                statusState = "at-risk";
                statusLabel = `Starving (${foodShortfallDays}d)`;
                statusIcon = "fas fa-triangle-exclamation";
                statusTooltip = `Short ${foodShortfallDays} days of food (risks exhaustion)`;
            } else if (isReady) {
                statusState = "ready";
                statusLabel = "Ready";
                statusIcon = "fas fa-check-circle";
                statusTooltip = "Locked in and ready";
            }

            return {
                id: actor.id,
                name: actor.name,
                img: actor.img,
                isGM: this._isGM,
                canInteract: isOwner,
                isDrilledDown,
                isCommitted,
                canChangeCraftPlan,
                budget,
                survivalModFormatted,
                forageDC: this._campLogistics._forageDC ?? 12,
                huntDC: this._campLogistics._huntDC ?? 14,
                gatheringSchedule,
                gatheringSummary,
                showGatheringSchedule: this._expandedTiers.get(actor.id)?.has("gathering") ?? false,
                isActivitiesExpanded: this._expandedTiers.get(actor.id)?.has("activities") ?? false,
                activeActivities: budget.activeActivities,
                activityDaySlots,
                sustenanceRole,
                hasRollableActivities,
                hasDefenseRolls,
                hasSkillChecks,
                skillCheckSummary,
                isAllActivitiesRolled,
                hasCraftingActivities,
                craftDaysCount,
                craftResolvedCount,
                craftDaysRemaining,
                isAllCraftsResolved,
                fortifySummary,
                climateLabel,
                climateTooltip,
                isTraitPill,
                sustenanceDiegetic: buildSustenanceDiegetic({
                    actorId: actor.id,
                    foodFlow,
                    waterFlow,
                    foodDailyPips,
                    waterDailyPips,
                    selectedDepartureMeal,
                    selectedDepartureDrink,
                    departureFoodOptions,
                    departureDrinkOptions,
                    climateLabel,
                    climateTooltip,
                    isTraitPill,
                    waterNeedPerDay: wpd ?? 2,
                    mealsLocked,
                    canUnlock: isOwner || this._isGM
                }),
                foodFlow,
                waterFlow,
                foodDailyPips,
                waterDailyPips,
                foodTooltip,
                isSustenanceDrawerOpen,
                autoFoodSummary,
                autoFoodTooltip,
                autoWaterSummary,
                autoWaterTooltip,
                totalAutoConsumed,
                foodShortfall: foodShortfallDays,
                foodShortfallDays,
                hasStarvationRisk,
                totalWaterFulfilled,
                totalWaterUnitsNeeded,
                waterShortfallUnits,
                waterShortfallDays,
                hasDehydrationRisk,
                hydratedDaysCount,
                waterPintsRemainingInPack,
                tier1Done: isCommitted && isAllActivitiesRolled && isAllCraftsResolved,
                tier2Done: (haven === "civilized") || (gatheringSummary ? gatheringSummary.isAllRolled : true),
                tier3Done: mealsLocked,
                mealsLocked,
                isFullySubmitted: isReady,
                isAllocated,
                isReady,
                isAtRisk,
                isPending,
                statusState,
                statusLabel,
                statusIcon,
                statusTooltip,
                daysToFeed,
                fedDaysCount,
                isWilderness: haven === "wilderness",
                isCivilized: haven === "civilized",
                day7Subtext,
                day7SubtextClass,
                departureFoodOptions,
                selectedDepartureMeal,
                selectedDepartureMealId,
                departureDrinkOptions,
                selectedDepartureDrink,
                selectedDepartureDrinkId,
                forageDC: this._campLogistics._forageDC,
                huntDC: this._campLogistics._huntDC,
                personalComfort: personalCard.personalComfort,
                personalComfortLabel: personalCard.personalComfortLabel,
                hasBedroll: personalCard.hasBedroll,
                hasTent: personalCard.hasTent,
                hasMessKit: personalCard.hasMessKit,
                bedrollWaived: !!personalCard.bedrollWaived,
                tentWaived: !!personalCard.tentWaived,
                messKitWaived: !!personalCard.messKitWaived,
                recovery: personalCard.recovery,
                personalMatchesCamp: personalCard.personalComfort === scanResult.campComfort,
                headerTooltip: bulletTip(actor.name, [
                    `${personalCard.personalComfortLabel} rest`,
                    personalCard.hasBedroll ? (personalCard.bedrollWaived ? "Bedroll: +1 comfort (Waived)" : "Bedroll: +1 comfort") : "No bedroll",
                    personalCard.hasMessKit ? (personalCard.messKitWaived ? "Mess kit: save advantage (Waived)" : "Mess kit: save advantage") : "",
                    personalCard.recovery?.hdLabel
                ]),
                bedrollTooltip: personalCard.hasBedroll
                    ? bulletTip(personalCard.bedrollWaived ? "Bedroll (Waived)" : "Bedroll", ["+1 personal comfort", "Protects Hit Dice", personalCard.bedrollWaived ? "Factor waived by GM" : "Clears the exhaustion save"])
                    : bulletTip("No bedroll", ["Resting at the camp's comfort"]),
                tentTooltip: personalCard.hasTent
                    ? bulletTip(personalCard.tentWaived ? "Tent (Waived)" : "Tent", ["Shields weather penalties", "Lowers encounter risk", ...(personalCard.tentWaived ? ["Factor waived by GM"] : [])])
                    : bulletTip("No tent", ["Exposed to the weather"]),
                messKitTooltip: personalCard.hasMessKit
                    ? bulletTip(personalCard.messKitWaived ? "Mess kit (Waived)" : "Mess kit", ["Advantage on exhaustion saves", ...(personalCard.messKitWaived ? ["Factor waived by GM"] : [])])
                    : "No mess kit. Exhaustion saves are normal.",
                recoveryTooltip: bulletTip("Recovery", [
                    personalCard.recovery?.hdLabel,
                    personalCard.recovery?.exhaustionDC
                        ? `Constitution save DC ${personalCard.recovery.exhaustionDC}, or exhaustion`
                        : "No exhaustion risk"
                ]),
                identifyDays,
                focusBudget,
                focusCount,
                focusRemaining,
                isIdentifyOpen,
                workbenchEmbed,
                workbenchIdentifyUiEnabled
            };
        });

        // Scoped for player view: owned characters only; GM sees all
        const playerCharacters = isGM
            ? characters
            : characters.filter(c => c.canInteract);

        const rosterSummary = characters.map(c => ({
            id: c.id,
            name: c.name,
            img: c.img,
            isComplete: c.isAllocated,
            isAllocated: c.isAllocated,
            isReady: c.isReady,
            isAtRisk: c.isAtRisk,
            isPending: c.isPending,
            unallocatedDays: c.budget.unallocatedDays,
            statusState: c.statusState,
            statusLabel: c.statusLabel,
            statusIcon: c.statusIcon,
            statusTooltip: c.statusTooltip
        }));

        const roster = characters.map(c => ({
            id: c.id,
            name: c.name.split(" ")[0] || c.name,
            fullName: c.name,
            img: c.img,
            isOwner: isGM || c.canInteract,
            isSelected: c.id === this._selectedCharacterId,
            isReady: c.isReady,
            source: c.isReady ? "player" : "pending",
            activityLabel: c.statusLabel,
            hasStarvationRisk: c.hasStarvationRisk,
            exhaustion: c.exhaustion ?? 0,
            isAfk: false
        }));

        const totalCount = characters.length;
        const allocatedCount = characters.filter(c => c.isAllocated).length;
        const committedCount = characters.filter(c => c.isCommitted).length;
        const readyCount = characters.filter(c => c.isReady).length;
        const atRiskCount = characters.filter(c => c.isAtRisk).length;
        const settledCount = readyCount + atRiskCount;
        const isAllAllocated = totalCount > 0 && allocatedCount === totalCount;
        const isAllCommitted = totalCount > 0 && committedCount === totalCount;
        const isAllReady = totalCount > 0 && readyCount === totalCount;
        const isAllComplete = totalCount > 0 && settledCount === totalCount;

        const unreadyCharacters = characters.filter(c => !c.isReady && !c.isAtRisk);
        const atRiskCharacters = characters.filter(c => c.isAtRisk);
        const unallocatedNames = characters.filter(c => !c.isAllocated).map(c => `${c.name} (${c.budget?.unallocatedDays ?? 0}d left)`).join(", ");

        let badgeClass = "pending";
        let badgeText = `${readyCount}/${totalCount} Ready`;
        let tooltip = "";

        if (isAllReady) {
            badgeClass = "complete";
            badgeText = `${totalCount}/${totalCount} Ready`;
            tooltip = `All ${totalCount} characters are locked in and ready to rest.`;
        } else if (isAllComplete && atRiskCount > 0) {
            badgeClass = "at-risk";
            badgeText = `${readyCount}/${totalCount} Ready (${atRiskCount} at risk)`;
            tooltip = bulletTip("Party", [
                `${readyCount} of ${totalCount} ready`,
                ...atRiskCharacters.map(c => {
                    if (c.hasDehydrationRisk && c.hasStarvationRisk) return `${c.name}: ${c.waterShortfallDays}d water, ${c.foodShortfallDays}d food`;
                    if (c.hasDehydrationRisk) return `${c.name}: ${c.waterShortfallDays}d water`;
                    return `${c.name}: ${c.foodShortfallDays}d food`;
                })
            ]);
        } else {
            badgeClass = "pending";
            badgeText = `${readyCount}/${totalCount} Ready${atRiskCount > 0 ? ` (${atRiskCount} at risk)` : ""}`;
            tooltip = bulletTip("Waiting on", [
                ...unreadyCharacters.map(c => {
                    if (c.budget.unallocatedDays > 0) return `${c.name}: ${c.budget.unallocatedDays}d left`;
                    if (!c.isCommitted) return `${c.name}: activities still a draft`;
                    if (!c.mealsLocked) return `${c.name}: meals still a draft`;
                    return `${c.name}: ${c.statusLabel}`;
                }),
                ...atRiskCharacters.map(c => `${c.name} at risk`)
            ]);
        }

        const partyReadiness = {
            readyCount,
            allocatedCount,
            committedCount,
            atRiskCount,
            totalCount,
            isAllComplete,
            isAllAllocated,
            isAllCommitted,
            isAllReady,
            badgeClass,
            badgeText,
            tooltip,
            unreadyNames: unallocatedNames,
            unreadyTooltip: tooltip
        };

        const totalRationsNeeded = this._campLogistics._foodDaysNeeded * party.length;

        const totalNights = Math.max(1, this._totalNights || (this._isGrittyLongRest ? 7 : 1));
        const isSingleNight = totalNights === 1;

        if (isGM && haven === "wilderness" && this._encounterDraft?.length) {
            this._syncDraftDCs();
        }

        let draftEntries = this._encounterDraft;
        if (!isGM && (!draftEntries || draftEntries.length === 0)) {
            draftEntries = Array.from({ length: totalNights }, (_, idx) => {
                const nightIndex = idx + 1;
                const mods = this._getNightActivityModifiers(nightIndex);
                const fireNudge = fireEncounterDcNudge(this._fireLevel);
                const effectiveDC = combineNightDc(this._dangerDC ?? 15, mods.activityNudge, fireNudge, 0);
                return {
                    nightIndex,
                    effectiveDC,
                    isRolled: false,
                    state: null,
                    category: null,
                    isDisaster: false,
                    triggered: false,
                    forcedSafe: false,
                    rollTotal: null,
                    event: null,
                    sentryName: mods.sentryActor?.name ?? null,
                    sentrySurprised: false,
                    hasActiveGuard: mods.hasActiveGuard,
                    fortifyCount: mods.fortifyCount,
                    guardCount: mods.guardCount,
                    fortifyActors: mods.fortifyActors,
                    guardActors: mods.guardActors,
                    manualOffset: 0,
                    activityNudge: mods.activityNudge,
                    fireNudge
                };
            });
        }

        const decoratedDraft = (draftEntries ?? []).map(entry => {
            const isRed = entry.state === "red" || (entry.triggered && !entry.state);
            const isAmber = entry.state === "amber";
            const isGreen = !isRed && !isAmber;
            const isDisaster = Boolean(entry.isDisaster || entry.category === "disaster");

            let statusLabel = "Quiet Night";
            let statusIcon = "fas fa-moon";

            if (isRed) {
                statusLabel = entry.event?.title ?? "Hostile Ambush";
                statusIcon = "fas fa-skull";
            } else if (isAmber) {
                statusLabel = entry.event?.title ?? "Encounter";
                statusIcon = "fas fa-compass";
            } else if (entry.event?.title) {
                statusLabel = entry.event.title;
            }

            const mods = this._getNightActivityModifiers(entry.nightIndex);
            const fortifyCount = mods.fortifyCount;
            const failedFortifyCount = mods.failedFortifyCount ?? 0;
            const pendingFortifyCount = mods.pendingFortifyCount ?? 0;
            const guardCount = mods.guardCount;
            const hasFortify = (fortifyCount + failedFortifyCount + pendingFortifyCount) > 0;
            const hasGuard = guardCount > 0;
            let fortifyTooltip = "";
            if (hasFortify) {
                const parts = [];
                if (fortifyCount > 0) parts.push(`${mods.fortifyActors.join(", ")} holding (-${fortifyCount * 2} DC)`);
                if (failedFortifyCount > 0) parts.push(`${mods.failedFortifyActors.join(", ")} failed`);
                if (pendingFortifyCount > 0) parts.push(`${mods.pendingFortifyActors.join(", ")} unrolled`);
                fortifyTooltip = `Defenses: ${parts.join(" · ")}`;
            }
            const guardTooltip = hasGuard
                ? (guardCount > 1
                    ? `Watch: ${mods.guardActors.join(", ")} guarding (-${guardCount} DC, Sentry: ${mods.sentryActor?.name})`
                    : `Watch: ${mods.guardActors[0]} guarding (-1 DC)`)
                : "";

            const effectiveDC = entry.effectiveDC ?? this._dangerDC ?? 15;
            const isReducedDC = effectiveDC < this._dangerDC;
            const isIncreasedDC = effectiveDC > this._dangerDC;

            const fn = fireEncounterDcNudge(this._fireLevel);
            const hearthDeltaLabel = fn > 0 ? `+${fn}` : (fn < 0 ? `${fn}` : "0");
            const fortifyDelta = fortifyCount * 2;
            const fortifyDeltaLabel = fortifyDelta > 0 ? `-${fortifyDelta}` : "0";

            const parts = [`Base DC: ${this._dangerDC}`];
            if (fn !== 0) {
                parts.push(`Hearth: ${fn > 0 ? "+" + fn : fn}`);
            }
            if (hasFortify && fortifyCount > 0) parts.push(`Fortify: -${fortifyCount * 2}`);
            if (hasGuard) parts.push(`Guard: -${guardCount}`);
            if (entry.manualOffset) {
                parts.push(`GM: ${entry.manualOffset > 0 ? "+" + entry.manualOffset : entry.manualOffset}`);
            }
            const dcTooltip = `Night ${entry.nightIndex} DC ${effectiveDC} (${parts.join(" | ")})`;

            const sentryActor = mods.sentryActor ?? party[0] ?? null;
            const sentryPP = sentryActor?.system?.skills?.prc?.passive ?? sentryActor?.system?.attributes?.passive?.perception ?? 10;
            const sentryImg = (sentryActor?.img && sentryActor.img.trim() !== "") ? sentryActor.img : "icons/svg/mystery-man.svg";
            const sentryName = mods.sentryActor?.name ?? sentryActor?.name ?? "Camp Watch";
            const isRolled = Boolean(entry.isRolled);

            return {
                ...entry,
                effectiveDC,
                isDisaster,
                isRed,
                isAmber,
                isGreen,
                statusLabel,
                statusIcon,
                hasFortify,
                hasGuard,
                fortifyTooltip,
                guardTooltip,
                isReducedDC,
                isIncreasedDC,
                dcTooltip,
                hearthDelta: fn,
                hearthDeltaLabel,
                fortifyDelta,
                fortifyDeltaLabel,
                sentryActor,
                sentryPP,
                sentryImg,
                sentryName,
                isRolled
            };
        });

        const partyNightDefenses = [1, 2, 3, 4, 5, 6, 7].map(nightIndex => {
            const mods = this._getNightActivityModifiers(nightIndex);
            const fortifyHeld = mods.fortifyCount;
            const fortifyFailed = mods.failedFortifyCount ?? 0;
            const fortifyPending = mods.pendingFortifyCount ?? 0;
            const guardCount = mods.guardCount;
            const hasFortify = (fortifyHeld + fortifyFailed + fortifyPending) > 0;
            const hasGuard = guardCount > 0;
            const sentryName = hasGuard ? (mods.sentryActor?.name ?? null) : null;
            const activityNudge = mods.activityNudge;

            let defenseClass = "default";
            let statusLabel = "Standard Camp";
            let statusIcon = "fas fa-campground";

            if (fortifyHeld > 0 && hasGuard) {
                defenseClass = "active";
                statusLabel = "Defended & Guarded";
                statusIcon = "fas fa-shield-alt";
            } else if (fortifyHeld > 0) {
                defenseClass = "active";
                statusLabel = "Defenses Holding";
                statusIcon = "fas fa-shield-alt";
            } else if (hasGuard) {
                defenseClass = "active";
                statusLabel = "Sentry on Watch";
                statusIcon = "fas fa-eye";
            } else if (fortifyPending > 0) {
                defenseClass = "default";
                statusLabel = "Defenses Unrolled";
                statusIcon = "fas fa-hourglass-half";
            } else {
                defenseClass = "default";
                statusLabel = "Standard Camp";
                statusIcon = "fas fa-campground";
            }

            const impactLabel = activityNudge < 0 ? `${activityNudge} DC` : "0 DC";

            const tooltipParts = [];
            const fn = fireEncounterDcNudge(this._fireLevel);
            if (fn !== 0) {
                tooltipParts.push(`Hearth: ${fn > 0 ? "+" + fn : fn} DC`);
            }
            if (fortifyHeld > 0) tooltipParts.push(`Defenses: ${mods.fortifyActors.join(", ")} holding (-${fortifyHeld * 2} DC)`);
            if (fortifyPending > 0) tooltipParts.push(`Defenses: ${mods.pendingFortifyActors.join(", ")} unrolled`);
            if (hasGuard) tooltipParts.push(`Watch: ${mods.guardActors.join(", ")} (-${guardCount} DC)`);
            if (hasGuard && sentryName && guardCount > 1) tooltipParts.push(`Sentry: ${sentryName}`);
            const tooltip = `Night ${nightIndex}: ${tooltipParts.length ? tooltipParts.join(" · ") : "Standard camp (no DC modifiers)"}`;

            return {
                nightIndex,
                activityNudge,
                impactLabel,
                hasFortify,
                fortifyHeld: fortifyHeld > 0,
                fortifyFailed: fortifyFailed > 0,
                fortifyPending: fortifyPending > 0,
                hasGuard,
                sentryName,
                defenseClass,
                statusLabel,
                statusIcon,
                tooltip
            };
        });

        const coveredDays = Math.max(0, 7 - this._campLogistics._foodDaysNeeded);
        const coveredDaysLabel = coveredDays === 0
            ? null
            : (coveredDays === 1 ? "Day 1" : `Days 1–${coveredDays}`);
        const neededDays1to6 = Math.max(0, 6 - coveredDays);
        const neededDaysLabel = neededDays1to6 === 0
            ? "Fully Covered"
            : (coveredDays === 0 ? "Days 1–6" : (coveredDays === 5 ? "Day 6" : `Days ${coveredDays + 1}–6`));

        const pacingActive = Boolean(this._pacingActive);
        const maxPacingNight = totalNights + 1;
        const activePacingNight = Math.max(1, Math.min(maxPacingNight, this._activePacingNight || 1));
        const isDawnCheck = pacingActive && activePacingNight > totalNights;
        const nextPacingNight = Math.min(maxPacingNight, activePacingNight + 1);
        const prevPacingNight = activePacingNight > 1 ? activePacingNight - 1 : null;
        const isFirstPacingNight = activePacingNight === 1;
        const isFinalPacingNight = activePacingNight === totalNights;

        const includeNight = haven !== "civilized";
        const headerStepDefs = [
            { key: "camp", label: "Camp Planning" },
            ...(includeNight ? [{ key: "night", label: isSingleNight ? "Overnight Vigil" : "Night Vigil" }] : []),
            { key: "resolve", label: "Resolution" }
        ];
        const headerPhase = pacingActive ? (isDawnCheck ? "resolve" : (includeNight ? "night" : "resolve")) : "camp";
        const headerIndex = headerStepDefs.findIndex(step => step.key === headerPhase);
        const phaseSteps = headerStepDefs.map((step, index) => ({
            label: step.label,
            active: index === headerIndex,
            complete: index < headerIndex
        }));
        const phaseLabel = pacingActive
            ? (isDawnCheck ? "Dawn Finalization" : (isSingleNight ? "Overnight Vigil" : "Night Vigil"))
            : (haven === "civilized" ? "Safe Rest" : "Camp Planning");

        const partyActors = party;
        const fuelBurnCost = (haven === "wilderness" && currentFire !== "cold_camp")
            ? (CampGearScanner.FIREWOOD_COST_BY_LEVEL[currentFire] ?? 2)
            : 0;
        const hasEnoughFuel = fuelStockTotal >= fuelBurnCost;
        const fireLabel = String(currentFire ?? "").replace("_", " ");
        const fuelStockTooltip = hasTinderbox
            ? bulletTip("Fuel", hasEnoughFuel
                ? [`${fuelStockTotal} firewood in the party`, `${fuelBurnCost} used for ${fireLabel}`]
                : [`${fuelStockTotal} firewood in the party`, `${fuelBurnCost} needed for ${fireLabel}`])
            : "No tinderbox or flint and steel in the party. Fires cannot be lit.";

        const fireTierOptions = [
            {
                id: "cold_camp",
                label: "❄️ Cold Camp",
                costLabel: "0 Fuel",
                comfortDelta: "−1 Comf",
                dcDelta: "−2 DC",
                selected: currentFire === "cold_camp",
                disabled: false,
                disabledReason: null
            },
            {
                id: "embers",
                label: "🪵 Embers",
                costLabel: "1 Fuel",
                comfortDelta: null,
                dcDelta: "±0 DC",
                selected: currentFire === "embers",
                disabled: !hasTinderbox || fuelStockTotal < 1,
                disabledReason: !hasTinderbox ? "Needs Tinderbox" : (fuelStockTotal < 1 ? "Needs 1 Fuel" : null)
            },
            {
                id: "campfire",
                label: "🔥 Campfire",
                costLabel: "2 Fuel",
                comfortDelta: null,
                dcDelta: "+1 DC",
                selected: currentFire === "campfire",
                disabled: !hasTinderbox || fuelStockTotal < 2,
                disabledReason: !hasTinderbox ? "Needs Tinderbox" : (fuelStockTotal < 2 ? "Needs 2 Fuel" : null)
            },
            {
                id: "bonfire",
                label: "💥 Bonfire",
                costLabel: "3 Fuel",
                comfortDelta: "+1 Comf",
                dcDelta: "+2 DC",
                selected: currentFire === "bonfire",
                disabled: !hasTinderbox || fuelStockTotal < 3,
                disabledReason: !hasTinderbox ? "Needs Tinderbox" : (fuelStockTotal < 3 ? "Needs 3 Fuel" : null)
            }
        ];

        const pacingDraft = decoratedDraft.map(entry => {
            const isResolvedCombat = this._completedCombatNights.has(entry.nightIndex);
            const isCurrentNight = entry.nightIndex === activePacingNight;
            const isVeiled = !isSingleNight && entry.nightIndex > activePacingNight && !entry.isRolled;
            const isRolled = Boolean(entry.isRolled);
            return {
                ...entry,
                isCurrentNight,
                isResolvedCombat,
                isVeiled,
                isRolled,
                isDawnStep: false
            };
        });

        if (!isSingleNight) {
            const allNightsRolled = decoratedDraft.every(e => e.isRolled);
            const isCurrentDawn = activePacingNight > totalNights;
            pacingDraft.push({
                nightIndex: totalNights + 1,
                label: "Dawn",
                isDawnStep: true,
                isCurrentNight: isCurrentDawn,
                isVeiled: !allNightsRolled && !isCurrentDawn,
                isRolled: false,
                effectiveDC: null,
                statusIcon: "fa-sun",
                statusLabel: "Dawn Finalization",
                tooltip: "Dawn: Final adjudication, Constitution saves vs Exhaustion & morning transition"
            });
        }

        const currentNightEntry = isDawnCheck
            ? {
                nightIndex: totalNights + 1,
                isDawnStep: true,
                isRolled: false,
                effectiveDC: 10,
                sentryName: "Party",
                sentryImg: "icons/svg/sun.svg",
                sentryPP: 10,
                statusLabel: "Dawn Finalization",
                statusIcon: "fa-sun"
            }
            : (pacingDraft.find(e => e.nightIndex === activePacingNight) ?? pacingDraft[0] ?? null);

        if (currentNightEntry) {
            if (!currentNightEntry.sentryImg || typeof currentNightEntry.sentryImg !== "string" || !currentNightEntry.sentryImg.trim()) {
                currentNightEntry.sentryImg = party[0]?.img || "icons/svg/mystery-man.svg";
            }
            if (!currentNightEntry.sentryName) {
                currentNightEntry.sentryName = party[0]?.name || "Camp Watch";
            }
            if (currentNightEntry.sentryPP === undefined || currentNightEntry.sentryPP === null) {
                const firstActor = party[0];
                currentNightEntry.sentryPP = firstActor?.system?.skills?.prc?.passive ?? firstActor?.system?.attributes?.passive?.perception ?? 10;
            }
            if (currentNightEntry.effectiveDC === undefined || currentNightEntry.effectiveDC === null) {
                currentNightEntry.effectiveDC = this._dangerDC ?? 15;
            }
        }

        const isCombatDoneForCurrentNight = this._completedCombatNights.has(activePacingNight);

        let watchRotation = [];
        if (isSingleNight) {
            const watchDefs = [
                { key: "dusk", label: "Dusk", hours: "0–2h", icon: "fa-cloud-sun", isPeakHazard: false },
                { key: "midnight", label: "Midnight", hours: "2–4h", icon: "fa-moon", isPeakHazard: false },
                { key: "deep", label: "Deep Night", hours: "4–6h", icon: "fa-shield-moon", isPeakHazard: true },
                { key: "dawn", label: "Pre-Dawn", hours: "6–8h", icon: "fa-sun", isPeakHazard: false }
            ];
            watchRotation = watchDefs.map((w, idx) => {
                const actor = party[idx % party.length] ?? null;
                const pp = actor?.system?.skills?.prc?.passive ?? actor?.system?.attributes?.passive?.perception ?? 10;
                return {
                    ...w,
                    watchIndex: idx + 1,
                    actor,
                    actorName: actor?.name ?? "Party Sentry",
                    actorImg: (actor?.img && actor.img.trim() !== "") ? actor.img : "icons/svg/mystery-man.svg",
                    passivePerception: pp,
                    isSurprised: currentNightEntry?.isRolled && currentNightEntry?.sentrySurprised && w.isPeakHazard,
                    isVigilant: !currentNightEntry?.sentrySurprised || !w.isPeakHazard
                };
            });
        }

        const campConditionsBar = this._buildCampConditionsBar(scanResult, {
            isGM,
            viewerActorId: isGM ? null : (playerCharacters[0]?.id ?? party[0]?.id)
        });
        const currentCampComfort = campConditionsBar?.campComfort ?? null;
        const campComfortFlashing = this._lastTrackedCampComfort !== undefined && this._lastTrackedCampComfort !== currentCampComfort;
        this._lastTrackedCampComfort = currentCampComfort;
        if (campConditionsBar) campConditionsBar.flashing = campComfortFlashing;

        const focusedComfort = characters.find(c => c.id === this._selectedCharacterId) ?? characters[0] ?? null;
        if (!(this._personalComfortMemory instanceof Map)) this._personalComfortMemory = new Map();
        const personalComfortFlashing = RestDockContext.noteComfortFlash(
            this._personalComfortMemory,
            focusedComfort?.id ?? null,
            focusedComfort?.personalComfort ?? null
        );

        const exhaustionRoster = party.map(actor => {
            const personalCard = characters.find(c => c.id === actor.id) ?? null;
            const hasStarvation = Boolean(personalCard?.hasStarvationRisk);
            const entry = this._getOrCreateExhaustionEntry(actor, personalCard, hasStarvation, currentFire);

            let conMod = 0;
            try {
                const rollData = actor.getRollData?.() ?? {};
                const fromRollData = rollData?.abilities?.con?.save;
                if (typeof fromRollData === "number") {
                    conMod = fromRollData;
                } else {
                    const mod = actor.system?.abilities?.con?.mod ?? 0;
                    const prof = actor.system?.attributes?.prof ?? 0;
                    const proficient = actor.system?.abilities?.con?.proficient ?? 0;
                    conMod = mod + (proficient > 0 ? prof : 0);
                }
            } catch {
                conMod = actor.system?.abilities?.con?.mod ?? 0;
            }
            const conModString = conMod >= 0 ? `+${conMod}` : `${conMod}`;
            const currentExhaustion = actor.system?.attributes?.exhaustion ?? 0;

            return {
                actorId: actor.id,
                actorName: actor.name,
                actorImg: actor.img || "icons/svg/mystery-man.svg",
                currentExhaustion,
                conModString,
                mustRoll: entry.mustRoll,
                waived: entry.waived,
                advMode: entry.advMode || "norm",
                dc: entry.dc,
                reason: entry.reason,
                rolled: entry.rolled,
                rollTotal: entry.rollTotal,
                passed: entry.passed,
                isOverrideOpen: Boolean(this._expandedExhaustionOverrides?.has(actor.id))
            };
        });

        const pendingRollsCount = exhaustionRoster.filter(e => e.mustRoll && !e.rolled).length;
        const failedRollsCount = exhaustionRoster.filter(e => e.rolled && !e.passed).length;
        const passedRollsCount = exhaustionRoster.filter(e => e.rolled && e.passed).length;
        const waivedCount = exhaustionRoster.filter(e => e.waived || !e.mustRoll).length;
        const exhaustionSummary = {
            total: exhaustionRoster.length,
            pending: pendingRollsCount,
            failed: failedRollsCount,
            passed: passedRollsCount,
            waived: waivedCount,
            allSettled: pendingRollsCount === 0
        };

        return {
            isGM,
            isGrittyLongRest: true,
            isCivilized: haven === "civilized",
            isWilderness: haven === "wilderness",
            campConditionsBar,
            campComfortFlashing,
            phaseSteps,
            phaseLabel,
            dangerDC: this._dangerDC,
            forageDC: this._campLogistics._forageDC,
            huntDC: this._campLogistics._huntDC,
            foodDaysNeeded: this._campLogistics._foodDaysNeeded,
            logisticsTooltip: bulletTip("Camp logistics", [
                `${this._campLogistics._foodDaysNeeded} days of food needed`,
                `Forage DC ${this._campLogistics._forageDC}`,
                `Hunt DC ${this._campLogistics._huntDC}`,
                !this._campLogistics._enforceTent ? "Tent factor waived" : null,
                !this._campLogistics._enforceBedroll ? "Bedroll factor waived" : null,
                !this._campLogistics._enforceMessKit ? "Mess kit factor waived" : null
            ].filter(Boolean)),
            patronSuppliedDays: this._patronSuppliedDays,
            coveredDays,
            coveredDaysLabel,
            neededDays1to6,
            neededDaysLabel,
            isDay7Covered: this._campLogistics._foodDaysNeeded === 0,
            totalRationsNeeded,
            totalNominatedRations,
            fuelStockTotal,
            hasTinderbox,
            fuelBurnCost,
            hasEnoughFuel,
            fuelStockTooltip,
            fireTierOptions,
            fireTiers: fireTierOptions,
            fireLevel: currentFire,
            bannerFireClass: ImageResolver.bannerFireClass(currentFire),
            rosterSummary,
            partyReadiness,
            characterReady: Boolean(characters.find(c => c.id === this._selectedCharacterId)?.isReady),
            characters,
            roster,
            ...ImageResolver.resolveRestBannerContext(this._terrainTag, headerPhase),
            ...RestPresentationHelper.resolveRestHeaderContext({
                type: "downtime",
                terrainTag: this._terrainTag,
                terrainLabel,
                pacingActive,
                activePacingNight,
                totalNights,
                isDawnCheck,
                phaseSteps,
                abandonAction: "abandonDowntime",
                canReturnToPlanning: !Boolean(this._encounterDraft?.some(e => e.isRolled)),
                isGM
            }),
            canReturnToPlanning: !Boolean(this._encounterDraft?.some(e => e.isRolled)),
            hasAnyRolls: Boolean(this._encounterDraft?.some(e => e.isRolled)),
            playerCharacters,
            partyNightDefenses,
            encounterDraft: decoratedDraft,
            pacingDraft,
            pacingActive,
            isSingleNight,
            totalNights,
            watchRotation,
            activePacingNight,
            nextPacingNight,
            prevPacingNight,
            isFirstPacingNight,
            isFinalPacingNight,
            isDawnCheck,
            sendoffOpen: Boolean(this._sendoffOpen),
            sendoffReady: holdsForSendoff({
                totalNights,
                activeNight: activePacingNight,
                pending: this.#sendoffPending()
            }) && !this._sendoffOpen,
            mealBuffRoster: this.#sendoffRoster(),
            mealBuffPending: this.#sendoffPending(),
            mealBuffTitle: "The send-off takes hold",
            mealBuffHint: "Apply each meal and drink before the last watch. It carries into the next day.",
            maxPacingNight,
            finalPacingStep: maxPacingNight,
            exhaustionRoster,
            exhaustionSummary,
            currentNightEntry,
            awaitingCombat: this._awaitingCombat,
            isCombatDoneForCurrentNight,
            enforceBedroll: this._campLogistics._enforceBedroll,
            enforceTent: this._campLogistics._enforceTent,
            enforceMessKit: this._campLogistics._enforceMessKit,
            logisticsDrawerOpen: this._campLogistics._drawerOpen,
            selectedCharacterId: this._selectedCharacterId,
            workflowMark: (() => {
                const focused = characters.find(c => c.id === this._selectedCharacterId) ?? characters[0] ?? null;
                if (!focused) return { gather: "draft", activities: "draft", sustenance: "draft" };
                return {
                    gather: focused.tier2Done ? "complete" : "draft",
                    activities: focused.tier1Done ? "complete" : (focused.isCommitted ? "locked" : "draft"),
                    sustenance: focused.mealsLocked ? "complete" : "draft"
                };
            })(),
            workflowComplete: (() => {
                const focused = characters.find(c => c.id === this._selectedCharacterId) ?? characters[0] ?? null;
                return {
                    gather: Boolean(focused?.tier2Done),
                    activities: Boolean(focused?.tier1Done),
                    sustenance: Boolean(focused?.mealsLocked)
                };
            })(),
            restDock: RestDockContext.buildDockContext({
                party,
                selectedId: this._selectedCharacterId,
                personalScan: characters.find(c => c.id === this._selectedCharacterId) ?? null,
                comfortFlashing: personalComfortFlashing,
                finishedActorIds: new Set(characters.filter(c => c.isReady).map(c => c.id)),
                characterState: new Map(characters.map(c => [c.id, {
                    hasStarvationRisk: c.hasStarvationRisk,
                    hasDehydrationRisk: c.hasDehydrationRisk,
                    hasExhaustionRisk: Boolean(c.recovery?.exhaustionDC),
                    exhaustionDC: c.recovery?.exhaustionDC ?? null,
                    statusLabel: c.statusLabel
                }])),
                isGM
            }),
            selectedWorkflowStep: this._selectedWorkflowStep,
            showGatherStep: true,
            workbenchIdentifyUiEnabled,
            isIdentifyActive: this._selectedWorkflowStep === "examine"
                || Boolean(this._selectedCharacterId && this._expandedTiers?.get(this._selectedCharacterId)?.has("identify"))
        };
    }

    _onRender(context, options) {
        super._onRender(context, options);
        const html = this.element;
        if (!html) return;

        let currentTheme = "glass";
        try {
            currentTheme = game.settings.get(MODULE_ID, "uiTheme") ?? "glass";
        } catch { /* ignore */ }
        html.classList.toggle("theme-ionrift-glass", currentTheme === "glass");
        html.classList.toggle("theme-respite-cockpit", currentTheme === "cockpit");

        if (this.window?.title) {
            this.window.title.textContent = this.title;
        } else {
            const titleEl = html.querySelector(".window-header .window-title");
            if (titleEl) titleEl.textContent = this.title;
        }

        html.classList.toggle("pacing-flow-active", Boolean(this._pacingActive));
        if (this._pacingActive) {
            html.style.removeProperty("height");
            const content = html.querySelector(".window-content");
            if (content) content.style.removeProperty("height");
        }

        if (this._isGM && !this._workbenchHookId) {
            this._workbenchHookId = Hooks.on(
                `${MODULE_ID}.workbenchIdentifyStagingTouched`,
                () => this._onWorkbenchStagingTouchedFromHook()
            );
        }

        queueMicrotask(() => {
            if (this._workbench && this.element) {
                this._workbench.bindDragDrop(this.element);
            }
        });

        bindSustenanceMeters(this, html);

        html.querySelectorAll("select.departure-select-compact.departure-meal-select, select.departure-meal-select, select.departure-select-compact:not(.departure-drink-select)").forEach(select => {
            select.addEventListener("change", event => {
                DowntimeLedgerApp.#onSelectDepartureMeal.call(this, event, event.currentTarget);
            });
        });

        html.querySelectorAll("select.departure-select-compact.departure-drink-select").forEach(select => {
            select.addEventListener("change", event => {
                DowntimeLedgerApp.#onSelectDepartureDrink.call(this, event, event.currentTarget);
            });
        });

        html.querySelectorAll("select.hearth-tier-select").forEach(select => {
            select.addEventListener("change", event => {
                DowntimeLedgerApp.#onSelectFireLevel.call(this, event, event.currentTarget);
            });
        });

        html.querySelectorAll("input.dawn-toggle-must-roll").forEach(input => {
            input.addEventListener("change", event => {
                DowntimeLedgerApp.#onToggleMustRollExhaustion.call(this, event, event.currentTarget);
            });
        });

        html.querySelectorAll("input.dawn-dc-input").forEach(input => {
            input.addEventListener("change", event => {
                DowntimeLedgerApp.#onChangeExhaustionDCInput.call(this, event, event.currentTarget);
            });
        });
    }

    // ─── Socket Delta Handlers ──────────────────────────────────────────

    onReceiveDelta(action, payload, userId) {
        if (!this._isGM) return;

        // Deltas naming an actor are only honoured from a user who owns it.
        if (payload?.actorId && !userControlsActor(userId, payload.actorId)) {
            Logger.warn(`${MODULE_ID} | Rejected Downtime ${action} for unowned actor ${payload.actorId}`);
            return;
        }

        switch (action) {
            case "SET_HAVEN": {
                this._budgetDelegate.setHaven(payload.haven);
                this._syncDraftDCs();
                break;
            }
            case "DUMP_ACTIVITY": {
                if (payload.actorId && payload.activityId) {
                    this._budgetDelegate.dumpDays(payload.actorId, payload.activityId);
                    this._syncDraftDCs();
                }
                break;
            }
            case "STEP_ACTIVITY": {
                if (payload.actorId && payload.activityId && payload.delta) {
                    if (payload.delta < 0) {
                        const current = this._budgetDelegate.getActivityDays(payload.actorId, payload.activityId);
                        if (!this._keepsRolledActivityDays(payload.actorId, payload.activityId, current + payload.delta)) break;
                    }
                    this._budgetDelegate.stepDays(payload.actorId, payload.activityId, payload.delta);
                    this._syncDraftDCs();
                }
                break;
            }
            case "AUTO_REST": {
                if (payload.actorId) {
                    this._budgetDelegate.autoRest(payload.actorId);
                    this._syncDraftDCs();
                }
                break;
            }
            case "CLEAR_ACTIVITY": {
                if (payload.actorId && payload.activityId) {
                    if (!this._keepsRolledActivityDays(payload.actorId, payload.activityId, 0)) break;
                    this._budgetDelegate.clearDays(payload.actorId, payload.activityId);
                    this._syncDraftDCs();
                }
                break;
            }
            case "SET_FOOD_NOMINATION": {
                if (payload.actorId) {
                    if (payload.itemId) {
                        this._foodNominations.set(payload.actorId, {
                            itemId: payload.itemId,
                            quantity: payload.quantity ?? this._campLogistics._foodDaysNeeded
                        });
                    } else {
                        this._foodNominations.delete(payload.actorId);
                    }
                }
                break;
            }
            case "SET_DEPARTURE_MEAL": {
                if (payload.actorId) {
                    if (payload.itemId) {
                        this._departureMeals.set(payload.actorId, payload.itemId);
                    } else {
                        this._departureMeals.delete(payload.actorId);
                    }
                }
                break;
            }
            case "SET_DEPARTURE_DRINK": {
                if (payload.actorId) {
                    if (payload.itemId) {
                        this._departureDrinks.set(payload.actorId, payload.itemId);
                    } else {
                        this._departureDrinks.delete(payload.actorId);
                    }
                }
                break;
            }
            case "TOGGLE_GATHERING_DAY": {
                if (payload.actorId) {
                    const currentSchedule = this._getOrCreateGatheringSchedule(payload.actorId);
                    const dayNum = Number(payload.day);
                    const existingEntry = currentSchedule.find(s => s.day === dayNum);
                    // Security guard: If any active day was already rolled, only the GM can toggle it!
                    const hasRolled = currentSchedule.some(s => s.rolled && s.mode !== "skip");
                    if (hasRolled || existingEntry?.rolled) {
                        break;
                    }
                    if (payload.schedule) {
                        const hadRolledMismatch = currentSchedule.some((s, idx) => s.rolled && payload.schedule[idx]?.mode !== s.mode);
                        if (!hadRolledMismatch) {
                            this._gatheringSchedule.set(payload.actorId, payload.schedule);
                        }
                    } else if (existingEntry) {
                        let nextMode;
                        if (existingEntry.mode === "forage") nextMode = "hunt";
                        else if (existingEntry.mode === "hunt") nextMode = "skip";
                        else nextMode = "forage";
                        existingEntry.mode = payload.mode ?? nextMode;
                        existingEntry.rolled = false;
                        existingEntry.rollTotal = null;
                        existingEntry.dc = null;
                        existingEntry.success = null;
                        existingEntry.yield = 0;
                    }
                }
                break;
            }
            case "ROLL_GATHERING_DAY": {
                // Deprecated: Individual rolls superseded by parallel Roll All
                break;
            }
            case "ROLL_ALL_GATHERING": {
                if (payload.actorId && Array.isArray(payload.schedule)) {
                    const currentSchedule = this._getOrCreateGatheringSchedule(payload.actorId);
                    const merged = currentSchedule.map(day => {
                        if (day.rolled) return day;
                        const incoming = payload.schedule.find(entry => entry.day === day.day);
                        return incoming?.rolled ? incoming : day;
                    });
                    this._gatheringSchedule.set(payload.actorId, merged);
                }
                break;
            }
            case "ROLL_ACTIVITY_DAY": {
                if (payload.actorId && payload.day && payload.rollData) {
                    const rolls = this._getOrCreateActivityRolls(payload.actorId);
                    const entry = rolls.find(r => r.day === Number(payload.day));
                    if (entry) {
                        Object.assign(entry, payload.rollData);
                    }
                    this._syncDraftDCs();
                }
                break;
            }
            case "ROLL_ALL_ACTIVITIES": {
                if (payload.actorId && Array.isArray(payload.rolls)) {
                    this._activityRolls.set(payload.actorId, payload.rolls);
                    this._syncDraftDCs();
                }
                break;
            }
            case "SET_SUSTENANCE_ROLE": {
                if (payload.actorId && payload.roleData) {
                    this._sustenanceRoles.set(payload.actorId, payload.roleData);
                }
                break;
            }
            case "ROLL_SUSTENANCE": {
                if (payload.actorId && payload.roleData) {
                    this._sustenanceRoles.set(payload.actorId, payload.roleData);
                }
                break;
            }
            case "COMMIT_ACTIVITIES": {
                if (payload.actorId) {
                    if (payload.committed) {
                        this._committedActorIds.add(payload.actorId);
                    } else {
                        this._committedActorIds.delete(payload.actorId);
                    }
                }
                break;
            }
            case "LOCK_MEALS": {
                if (payload.actorId) {
                    if (payload.locked) this._mealsLockedActorIds.add(payload.actorId);
                    else this._mealsLockedActorIds.delete(payload.actorId);
                }
                break;
            }
            case "APPLY_SENDOFF": {
                const row = this.#sendoffRows().find(entry =>
                    entry.actorId === payload.actorId
                    && entry.kind === payload.kind
                    && entry.itemId === payload.itemId
                );
                void this.#applySendoffRow(row);
                return;
            }
            case "SET_SUSTENANCE_PLAN": {
                if (payload.actorId && payload.plan) {
                    this._sustenanceEdits.set(payload.actorId, payload.plan);
                }
                break;
            }
            case "SET_FIRE_LEVEL": {
                if (payload.fireLevel) {
                    this._fireLevel = payload.fireLevel;
                    this._syncDraftDCs();
                }
                break;
            }
            case "WORKBENCH_STAGING": {
                this.applyWorkbenchStagingFromPlayer(payload);
                return;
            }
            case "WORKBENCH_ACK_DISMISS": {
                if (payload.actorId) {
                    this._workbench.dismissAcknowledgement(payload.actorId);
                    this._saveSessionState();
                    this._broadcastSync();
                }
                return;
            }
            default:
                Logger.warn(`${MODULE_ID} | Unrecognised Downtime delta:`, action);
        }

        this._broadcastSync();
        this.render();
        this._saveSessionState();
    }

    onReceiveSync(state) {
        if (this._isGM) return;
        const priorFireLevel = this._fireLevel;
        DOWNTIME_STATE_SCHEMA.apply(this, state);
        if (this._fireLevel !== priorFireLevel) this._syncDraftDCs();
        if (state.workbenchStaging || state.workbenchAck || state.workbenchFocusCounts) {
            this.applyWorkbenchStateFromHost(state);
        } else {
            this.render();
        }
    }

    _broadcastSync() {
        if (!this._isGM) return;
        emitRestSessionSync("downtime", DOWNTIME_STATE_SCHEMA.serializeForPlayers(this));
    }

    _onWorkbenchStagingTouchedFromHook() {
        if (!this._isGM) return;
        emitRestSessionDelta("downtime", "WORKBENCH_STAGING", {
            staging: Array.from(this._workbenchIdentifyStaging?.entries() ?? [])
        });
    }

    applyWorkbenchStagingFromPlayer(data) {
        if (!data?.staging) return;
        for (const [actorId, st] of data.staging) {
            this._workbench.setStaging(actorId, {
                gearItemId: st.gearItemId,
                gearActorId: st.gearActorId,
                potionItemId: st.potionItemId,
                spellItemId: st.spellItemId,
                spellActorId: st.spellActorId
            });
        }
        this.render();
        this._saveSessionState();
    }

    applyWorkbenchStateFromHost(data) {
        this._workbenchIdentifyStaging = new Map(data.workbenchStaging ?? []);
        this._workbenchIdentifyAcknowledge = new Map(data.workbenchAck ?? []);
        if (data.workbenchFocusCounts) {
            this._workbenchFocusCounts = new Map(data.workbenchFocusCounts);
        }
        this._magicScanResults = data.magicScanResults ?? null;
        this._magicScanComplete = !!data.magicScanComplete;
        this.render();
    }

    // ─── User Event Handlers ─────────────────────────────────────────────

    static async #onToggleUiTheme(event, target) {
        let currentTheme = "glass";
        try {
            currentTheme = game.settings.get(MODULE_ID, "uiTheme") ?? "glass";
        } catch { /* ignore */ }
        const nextTheme = currentTheme === "glass" ? "cockpit" : "glass";
        try {
            await game.settings.set(MODULE_ID, "uiTheme", nextTheme);
        } catch (e) {
            console.error("Failed to update uiTheme setting:", e);
        }
    }

    static async #onAbandonDowntime(event, target) {
        if (!this._isGM) return;

        const confirmed = await confirmAbandonRest({
            title: "Abandon Rest?",
            message: "This will cancel the rest for all players. Any unsaved progress will be lost."
        });
        if (!confirmed) return;

        emitRestSessionAbandoned("downtime");
        ui.notifications?.info?.("Rest abandoned.");
        this.close({ abandoned: true });
    }

    static #onSetHaven(event, target) {
        if (!this._isGM) return;
        const haven = target.dataset.haven;
        this._budgetDelegate.setHaven(haven);
        this._syncDraftDCs();
        this._broadcastSync();
        this.render();
        this._saveSessionState();
    }

    static #onSelectRosterCharacter(event, target) {
        const actorId = target.dataset.actorId || target.dataset.rosterId;
        if (!actorId) return;
        if (!this._isGM) {
            const actor = typeof game.actors?.get === "function" ? game.actors.get(actorId) : (Array.isArray(game.actors) ? game.actors.find(a => a?.id === actorId) : null);
            if (actor && !actor.isOwner) return;
        }
        this._selectedCharacterId = actorId;
        this.render();
    }

    static #onSwitchTab(event, target) {
        return DowntimeLedgerApp.#onSelectRosterCharacter.call(this, event, target);
    }

    #holdWindowHeight() {
        const height = this.element?.offsetHeight;
        if (height > 0) this.position.height = height;
    }

    static #onSwitchWorkflow(event, target) {
        const step = target.dataset.step;
        if (!step || !["gather", "activities", "sustenance"].includes(step)) return;
        if (step === this._selectedWorkflowStep) return;
        this.#holdWindowHeight();
        this._selectedWorkflowStep = step;
        const actorId = this._selectedCharacterId;
        if (actorId && this._expandedTiers?.has(actorId)) {
            this._expandedTiers.get(actorId).delete("identify");
        }
        this.render();
    }

    static async #onRollExhaustionSave(event, target) {
        event?.preventDefault?.();
        event?.stopPropagation?.();
        const actorId = target?.dataset?.actorId || this._selectedCharacterId;
        const actor = game.actors.get(actorId);
        if (!actor) return;
        if (typeof actor.rollSavingThrow === "function") {
            return actor.rollSavingThrow({ ability: "con" });
        } else if (typeof actor.rollAbilitySave === "function") {
            return actor.rollAbilitySave("con");
        } else if (typeof actor.saves?.fortitude?.roll === "function") {
            return actor.saves.fortitude.roll(event);
        }
    }

    static #onToggleExamine(event, target) {
        this.#holdWindowHeight();
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

    static #onStepFoodDays(event, target) {
        if (!this._isGM) return;
        this._campLogistics.stepFoodDays(target.dataset.delta);
        this._broadcastSync();
        this._saveSessionState();
    }

    static #onStepPatronDays(event, target) {
        return DowntimeLedgerApp.#onStepFoodDays.call(this, event, target);
    }

    static #onClearActivity(event, target) {
        const actorId = target.dataset.actorId;
        const activityId = target.dataset.activityId;
        if (!actorId || !activityId) return;

        if (!this._isGM && !this._keepsRolledActivityDays(actorId, activityId, 0)) {
            ui.notifications?.warn("Those days are already rolled.");
            return;
        }

        if (this._isGM) {
            this._budgetDelegate.clearDays(actorId, activityId);
            this._syncDraftDCs();
            this._broadcastSync();
            this.render();
            this._saveSessionState();
        } else {
            emitRestSessionDelta("downtime", "CLEAR_ACTIVITY", { actorId, activityId });
        }
    }

    static #onDumpActivity(event, target) {
        const actorId = target.dataset.actorId;
        const activityId = target.dataset.activityId;
        if (!actorId || !activityId) return;

        if (this._isGM) {
            this._budgetDelegate.dumpDays(actorId, activityId);
            this._syncDraftDCs();
            this._broadcastSync();
            this.render();
            this._saveSessionState();
        } else {
            emitRestSessionDelta("downtime", "DUMP_ACTIVITY", { actorId, activityId });
        }
    }

    static #onStepActivity(event, target) {
        const actorId = target.dataset.actorId;
        const activityId = target.dataset.activityId;
        const delta = Number(target.dataset.delta) || 0;
        if (!actorId || !activityId || !delta) return;

        if (!this._isGM && delta < 0) {
            const current = this._budgetDelegate.getActivityDays(actorId, activityId);
            if (!this._keepsRolledActivityDays(actorId, activityId, current + delta)) {
                ui.notifications?.warn("Those days are already rolled.");
                return;
            }
        }

        if (this._isGM) {
            this._budgetDelegate.stepDays(actorId, activityId, delta);
            this._syncDraftDCs();
            this._broadcastSync();
            this.render();
            this._saveSessionState();
        } else {
            emitRestSessionDelta("downtime", "STEP_ACTIVITY", { actorId, activityId, delta });
        }
    }

    static #onToggleDrillDown(event, target) {
        if (!this._isGM) return;
        const actorId = target.dataset.actorId;
        if (!actorId) return;

        if (this._drilledDownActorIds.has(actorId)) {
            this._drilledDownActorIds.delete(actorId);
        } else {
            this._drilledDownActorIds.add(actorId);
        }
        this.render();
    }

    static #onToggleLogisticsDrawer(event, target) {
        if (!this._isGM) return;
        this._campLogistics.toggleDrawer();
    }

    // ─── GM Draft Controls ──────────────────────────────────────────────

    static #onAdjustDraftDC(event, target) {
        if (!this._isGM) return;
        const delta = Number(target.dataset.delta) || 0;
        const newDC = Math.max(1, Math.min(30, (this._dangerDC ?? 15) + delta));
        if (newDC === this._dangerDC) return;
        this._dangerDC = newDC;

        this._syncDraftDCs();
        this._broadcastSync();
        this.render();
        this._saveSessionState();
    }

    static #onAdjustNightDC(event, target) {
        if (!this._isGM) return;
        const nightIndex = Number(target.dataset.night);
        const delta = Number(target.dataset.delta) || 0;
        const entry = this._encounterDraft.find(e => e.nightIndex === nightIndex);
        if (!entry) return;

        entry.manualOffset = (entry.manualOffset ?? 0) + delta;
        this._syncDraftDCs();
        this.render();
        this._saveSessionState();
    }

    static async #onRerollNight(event, target) {
        if (!this._isGM) return;
        const nightIndex = Number(target.dataset.night);
        const entry = this._encounterDraft.find(e => e.nightIndex === nightIndex);
        if (!entry) return;

        const mods = this._getNightActivityModifiers(nightIndex);
        const fireNudge = fireEncounterDcNudge(this._fireLevel);
        const manualOffset = entry.manualOffset ?? 0;
        const targetDC = combineNightDc(this._dangerDC, mods.activityNudge, fireNudge, manualOffset);
        const totalNights = this._totalNights || 7;
        const isTerminalNight = (nightIndex === totalNights);

        const roll = await new Roll("1d20").evaluate();
        await presentRoll(roll);

        const party = getPartyActors();
        const sentryActor = mods.sentryActor ?? party[0] ?? null;
        const pp = sentryActor?.system?.skills?.prc?.passive ?? sentryActor?.system?.attributes?.passive?.perception ?? 10;
        const sentrySurprised = mods.hasActiveGuard ? false : pp < 12;

        const rollTotal = roll.total;
        const triggered = rollTotal < targetDC;
        let state = "green";
        let category = "ambient";
        let isDisaster = false;
        let eventObj = null;

        if (triggered) {
            if (rollTotal === 1) {
                state = isTerminalNight ? "disaster" : "red";
                category = isTerminalNight ? "disaster" : "combat";
                isDisaster = isTerminalNight;
                eventObj = {
                    title: isTerminalNight ? "Camp Disaster" : "Severe Ambush",
                    description: isTerminalNight
                        ? `A camp-wiping disaster strikes in the ${this._terrainTag}!`
                        : `A ferocious assault strikes the camp perimeter in the ${this._terrainTag}!`,
                    category: isTerminalNight ? "disaster" : "encounter",
                    isDisaster: isTerminalNight,
                    terrainTag: this._terrainTag,
                    sentryName: sentryActor?.name ?? "Camp Watch",
                    sentrySurprised
                };
            } else if (rollTotal <= 6) {
                state = "red";
                category = "combat";
                eventObj = {
                    title: "Hostile Ambush",
                    description: `Predators or hostile foes assault the campsite in the ${this._terrainTag}!`,
                    category: "encounter",
                    isDisaster: false,
                    terrainTag: this._terrainTag,
                    sentryName: sentryActor?.name ?? "Camp Watch",
                    sentrySurprised
                };
            } else {
                state = "amber";
                category = "discovery";
                eventObj = {
                    title: "Nocturnal Encounter",
                    description: `Strange sounds, curious wildlife, or wanderers approach the campsite in the ${this._terrainTag}.`,
                    category: "discovery",
                    isDisaster: false,
                    terrainTag: this._terrainTag,
                    sentryName: sentryActor?.name ?? "Camp Watch",
                    sentrySurprised: false
                };
            }
        }

        entry.state = state;
        entry.category = category;
        entry.isDisaster = isDisaster;
        entry.triggered = triggered;
        entry.forcedSafe = false;
        entry.rollTotal = rollTotal;
        entry.effectiveDC = targetDC;
        entry.activityNudge = mods.activityNudge;
        entry.fortifyCount = mods.fortifyCount;
        entry.guardCount = mods.guardCount;
        entry.fortifyActors = mods.fortifyActors;
        entry.guardActors = mods.guardActors;
        entry.hasActiveGuard = mods.hasActiveGuard;
        entry.event = eventObj;
        entry.sentryName = sentryActor?.name ?? "Camp Watch";
        entry.sentrySurprised = sentrySurprised;
        entry.isRolled = true;

        this.render();
        this._saveSessionState();
    }

    static #onDropNight(event, target) {
        if (!this._isGM) return;
        const nightIndex = Number(target.dataset.night);
        const entry = this._encounterDraft.find(e => e.nightIndex === nightIndex);
        if (entry) {
            entry.state = "green";
            entry.category = "ambient";
            entry.isDisaster = false;
            entry.triggered = false;
            entry.forcedSafe = true;
            entry.event = null;
        }
        this.render();
        this._saveSessionState();
    }

    static #onCycleNightState(event, target) {
        if (!this._isGM) return;
        const nightIndex = Number(target.dataset.night);
        const entry = this._encounterDraft.find(e => e.nightIndex === nightIndex);
        if (entry) {
            const isTerminalNight = (nightIndex === this._encounterDraft.length);
            EncounterDraftService.cycleNight(entry, isTerminalNight, this._terrainTag);
            this.render();
            this._saveSessionState();
        }
    }

    static #onSelectNominatedFood(event, target) {
        const actorId = target.dataset.actorId;
        const itemId = target.value;
        if (!actorId) return;

        if (this._isGM) {
            if (itemId) {
                const actor = game.actors.get(actorId);
                const item = actor?.items.get(itemId);
                const maxQty = item?.system?.quantity ?? 1;
                const defaultQty = Math.min(this._campLogistics._foodDaysNeeded, maxQty);
                this._foodNominations.set(actorId, { itemId, quantity: defaultQty });
            } else {
                this._foodNominations.delete(actorId);
            }
            this._broadcastSync();
            this.render();
            this._saveSessionState();
        } else {
            emitRestSessionDelta("downtime", "SET_FOOD_NOMINATION", {
                actorId,
                itemId: itemId || null,
                quantity: this._campLogistics._foodDaysNeeded
            });
        }
    }

    static #onStepNominatedFood(event, target) {
        const actorId = target.dataset.actorId;
        const delta = Number(target.dataset.delta) || 0;
        if (!actorId) return;

        const current = this._foodNominations.get(actorId);
        if (!current?.itemId) return;

        const actor = game.actors.get(actorId);
        const item = actor?.items.get(current.itemId);
        const maxQty = item?.system?.quantity ?? 1;
        const newQty = Math.max(1, Math.min(maxQty, (current.quantity || 1) + delta));

        if (this._isGM) {
            this._foodNominations.set(actorId, { itemId: current.itemId, quantity: newQty });
            this._broadcastSync();
            this.render();
            this._saveSessionState();
        } else {
            emitRestSessionDelta("downtime", "SET_FOOD_NOMINATION", {
                actorId,
                itemId: current.itemId,
                quantity: newQty
            });
        }
    }

    static #onClearSustenanceFood(event, target) {
        const actorId = sustenanceActorId(target, this);
        const slot = Number(target.dataset.slot);
        if (!actorId || Number.isNaN(slot) || this.#mealsAreLocked(actorId)) return;
        const snap = this._sustenanceSnapshot.get(actorId);
        const day = snap?.food?.[slot];
        if (!day?.editable || day.empty) return;
        const plan = ensureSustenancePlan(this._sustenanceEdits, actorId);
        plan.food[slot] = "";
        this.#commitSustenanceEdit(actorId);
    }

    static #onAssignSustenanceFood(event, target) {
        this.applySustenanceChip("food", target.dataset.item, sustenanceActorId(target, this), {
            name: target.dataset.name
        });
    }

    static #onClearSustenanceWater(event, target) {
        const actorId = sustenanceActorId(target, this);
        const dayIndex = Number(target.dataset.wday);
        if (!actorId || Number.isNaN(dayIndex)) return;
        const snap = this._sustenanceSnapshot.get(actorId);
        const day = snap?.water?.[dayIndex];
        if (!day?.editable || this.#mealsAreLocked(actorId)) return;
        const plan = ensureSustenancePlan(this._sustenanceEdits, actorId);
        plan.water[dayIndex] = target.dataset.undo === "all" ? [] : removeLastPour(day.pours);
        this.#commitSustenanceEdit(actorId);
    }

    static #onAssignSustenanceWater(event, target) {
        this.applySustenanceChip("water", target.dataset.item, sustenanceActorId(target, this), {
            name: target.dataset.name,
            waterDay: Number(target.dataset.wday)
        });
    }

    applySustenanceChip(kind, itemId, actorId, target = {}) {
        const id = actorId || this._selectedCharacterId;
        if (!id || !itemId || this.#mealsAreLocked(id)) return;
        const actor = game.actors.get(id);
        const item = actor?.items?.get?.(itemId);
        const name = target.name || item?.name || "";
        const img = target.img || item?.img || "";
        if (kind === "water") this.#pourSustenanceChip(id, itemId, name, target.waterDay, img, target.available);
        else this.#placeSustenanceChip(id, itemId, name, target.foodSlot, img);
    }

    #placeSustenanceChip(actorId, itemId, name, slotIndex, img) {
        const snap = this._sustenanceSnapshot.get(actorId);
        if (!snap?.food?.length) return;
        const preferred = Number.isInteger(slotIndex) ? slotIndex : -1;
        const preferredOpen = preferred >= 0 && snap.food[preferred]?.editable && snap.food[preferred]?.empty;
        const hole = preferredOpen
            ? preferred
            : snap.food.findIndex(day => day.editable && day.empty);
        if (hole < 0) return;
        const plan = ensureSustenancePlan(this._sustenanceEdits, actorId);
        plan.food[hole] = { itemId, name: name || "Ration", img: img || "" };
        this.#commitSustenanceEdit(actorId);
    }

    #pourSustenanceChip(actorId, itemId, name, dayIndex, img, available) {
        const snap = this._sustenanceSnapshot.get(actorId);
        if (!snap?.water?.length) return;
        const open = (index) => {
            const day = snap.water[index];
            if (!day?.editable) return false;
            const need = day.need || 0;
            return need > 0 && pourCount(day.pours) < need;
        };
        const preferred = Number.isInteger(dayIndex) && !Number.isNaN(dayIndex) ? dayIndex : -1;
        const hole = preferred >= 0 && open(preferred)
            ? preferred
            : snap.water.findIndex((_, index) => open(index));
        if (hole < 0) return;
        const day = snap.water[hole];
        const room = (day.need || 0) - pourCount(day.pours);
        const already = (day.pours ?? [])
            .filter(pour => pour.itemId === itemId)
            .reduce((sum, pour) => sum + (pour.pints || 0), 0);
        const stock = Number(available);
        const left = Number.isFinite(stock) ? Math.max(0, stock - already) : room;
        const take = Math.min(room, left);
        if (take <= 0) return;
        const plan = ensureSustenancePlan(this._sustenanceEdits, actorId);
        plan.water[hole] = addPints(day.pours, itemId, name || "Waterskin", img, take);
        this.#commitSustenanceEdit(actorId);
    }

    #mealsAreLocked(actorId) {
        return this._mealsLockedActorIds.has(actorId);
    }

    #canEditMeals(actorId) {
        if (!actorId) return false;
        if (this._isGM) return true;
        const actor = typeof game.actors?.get === "function"
            ? game.actors.get(actorId)
            : (Array.isArray(game.actors) ? game.actors.find(a => a.id === actorId) : null);
        return Boolean(actor?.isOwner);
    }

    #setMealsLocked(actorId, locked) {
        if (!this.#canEditMeals(actorId)) return;
        if (locked) {
            this._mealsLockedActorIds.add(actorId);
            const actor = typeof game.actors?.get === "function"
                ? game.actors.get(actorId)
                : (Array.isArray(game.actors) ? game.actors.find(a => a.id === actorId) : null);
            if (actor) {
                const budget = this._budgetDelegate?.getActorViewModel?.(actor);
                if (budget?.isComplete && !this._committedActorIds.has(actorId)) {
                    this._committedActorIds.add(actorId);
                    if (!this._isGM) {
                        emitRestSessionDelta("downtime", "COMMIT_ACTIVITIES", { actorId, committed: true });
                    }
                }
            }
        } else {
            this._mealsLockedActorIds.delete(actorId);
        }
        if (this._isGM) {
            this._saveSessionState();
            this._broadcastSync();
            this.render();
        } else {
            emitRestSessionDelta("downtime", "LOCK_MEALS", { actorId, locked });
            this.render();
        }
    }

    #commitSustenanceEdit(actorId) {
        if (this._isGM) {
            this._saveSessionState();
            this._broadcastSync();
        } else {
            const plan = this._sustenanceEdits.get(actorId) ?? { food: {}, water: {} };
            emitRestSessionDelta("downtime", "SET_SUSTENANCE_PLAN", { actorId, plan });
        }
        this.render();
    }

    static #onLockMeals(event, target) {
        const actorId = target?.dataset?.actorId || sustenanceActorId(target, this);
        if (!actorId) return;
        this.#setMealsLocked(actorId, true);
    }

    static #onUnlockMeals(event, target) {
        const actorId = target?.dataset?.actorId || sustenanceActorId(target, this);
        if (!actorId) return;
        this.#setMealsLocked(actorId, false);
    }

    #unreadyParty() {
        const unready = [];
        for (const actor of getPartyActors()) {
            const budget = this._budgetDelegate.getActorViewModel(actor);
            if (!budget.isComplete) {
                unready.push(`${actor.name} (${budget.unallocatedDays}d left)`);
                continue;
            }
            if (!this._committedActorIds.has(actor.id)) {
                unready.push(`${actor.name} (activities still a draft)`);
                continue;
            }
            const craftDaysCount = budget.segments.filter(s => s.filled && (s.activityId === "craft" || s.activityId === "cook" || s.activityId === "brew")).length;
            const craftResolvedCount = (this._activityRolls.get(actor.id) ?? []).filter(r => r.activityId === "craft" || r.activityId === "cook" || r.activityId === "brew").length;
            if (craftDaysCount > craftResolvedCount) {
                unready.push(`${actor.name} (${craftDaysCount - craftResolvedCount}d craft pending)`);
                continue;
            }
            const fortifyDaysCount = budget.segments.filter(s => s.filled && s.activityId === "fortify").length;
            const fortifyResolvedCount = (this._activityRolls.get(actor.id) ?? []).filter(r => r.activityId === "fortify").length;
            if (fortifyDaysCount > fortifyResolvedCount) {
                unready.push(`${actor.name} (${fortifyDaysCount - fortifyResolvedCount}d defenses pending)`);
                continue;
            }
            if (this._budgetDelegate.haven === "wilderness") {
                const sched = this._gatheringSchedule.get(actor.id) ?? [];
                // Camp days are a skip. They have no roll, same as the Gather check.
                if (sched.some(d => d.mode !== "skip" && !d.rolled)) {
                    unready.push(`${actor.name} (gathering rolls pending)`);
                    continue;
                }
            }
            if (!this._mealsLockedActorIds.has(actor.id)) {
                unready.push(`${actor.name} (meals still a draft)`);
            }
        }
        return unready;
    }

    static #onSelectDepartureMeal(event, target) {
        const actorId = target.dataset.actorId;
        const itemId = target.value;
        if (!actorId) return;

        if (this._isGM) {
            if (itemId) {
                this._departureMeals.set(actorId, itemId);
            } else {
                this._departureMeals.delete(actorId);
            }
            this._broadcastSync();
            this.render();
            this._saveSessionState();
        } else {
            emitRestSessionDelta("downtime", "SET_DEPARTURE_MEAL", {
                actorId,
                itemId: itemId || null
            });
        }
    }

    static #onSelectDepartureDrink(event, target) {
        const actorId = target.dataset.actorId;
        const itemId = target.value;
        if (!actorId) return;

        if (this._isGM) {
            if (itemId) {
                this._departureDrinks.set(actorId, itemId);
            } else {
                this._departureDrinks.delete(actorId);
            }
            this._broadcastSync();
            this.render();
            this._saveSessionState();
        } else {
            emitRestSessionDelta("downtime", "SET_DEPARTURE_DRINK", {
                actorId,
                itemId: itemId || null
            });
        }
    }

    /**
     * Unified toggle for revealing/hiding day-by-day breakdowns in any tier.
     * Reads data-tier ('activities' | 'gathering' | 'sustenance') and data-actor-id from the target.
     */
    static #onToggleTierReveal(event, target) {
        const actorId = target.dataset.actorId;
        const tier = target.dataset.tier;
        if (!actorId || !tier) return;

        if (!this._expandedTiers.has(actorId)) {
            this._expandedTiers.set(actorId, new Set());
        }
        const expanded = this._expandedTiers.get(actorId);
        if (expanded.has(tier)) {
            expanded.delete(tier);
        } else {
            expanded.add(tier);
        }
        this.render();
    }

    static async #onRerollAllDraft(event, target) {
        if (!this._isGM) return;
        await this._initEncounterDraft();
        this.render();
        this._saveSessionState();
    }

    static #onAdjustSustenanceDC(event, target) {
        if (!this._isGM) return;
        this._campLogistics.adjustSustenanceDC(target.dataset.activity, target.dataset.delta);
        this._broadcastSync();
        this._saveSessionState();
    }

    static async #onGiftWood(event, target) {
        if (!this._isGM) return;
        const qty = Number(target?.dataset?.qty) || 2;
        await this._campLogistics.giftWood(qty);
        this._broadcastSync();
        this._saveSessionState();
    }

    static #onToggleGearFactor(event, target) {
        if (!this._isGM) return;
        this._campLogistics.toggleGearFactor(target?.dataset?.factor);
        this._broadcastSync();
        this._saveSessionState();
    }

    static #onToggleGatheringDay(event, target) {
        const actorId = target.dataset.actorId;
        const day = Number(target.dataset.day);
        if (!actorId || !day) return;
        if (!this._isGM) {
            const actor = typeof game.actors?.get === "function" ? game.actors.get(actorId) : (Array.isArray(game.actors) ? game.actors.find(a => a?.id === actorId) : null);
            if (actor && !actor.isOwner) return;
        }

        const schedule = this._getOrCreateGatheringSchedule(actorId);
        const dayEntry = schedule.find(d => d.day === day);
        if (!dayEntry) return;

        if (dayEntry.rolled) {
            ui.notifications?.warn("This day's haul is already set.");
            return;
        }
        const hasRolled = schedule.some(d => d.rolled && d.mode !== "skip");
        if (hasRolled && !this._isGM) {
            ui.notifications?.warn("Only the GM can modify gathering assignments after rolls are made.");
            return;
        }

        let newMode;
        if (dayEntry.mode === "forage") newMode = "hunt";
        else if (dayEntry.mode === "hunt") newMode = "skip";
        else newMode = "forage";

        dayEntry.mode = newMode;
        dayEntry.rolled = false;
        dayEntry.rollTotal = null;
        dayEntry.dc = null;
        dayEntry.success = null;
        dayEntry.yield = 0;
        dayEntry.detail = "";
        dayEntry.items = [];
        dayEntry.fromTable = false;

        if (this._isGM) {
            this._gatheringSchedule.set(actorId, schedule);
            this._broadcastSync();
            this.render();
            this._saveSessionState();
        } else {
            emitRestSessionDelta("downtime", "TOGGLE_GATHERING_DAY", { actorId, day, mode: newMode, schedule });
        }
    }

    static #onToggleGatheringDetail(event, target) {
        // Legacy compat: delegate to unified tier reveal with tier='gathering'
        target.dataset.tier = "gathering";
        DowntimeLedgerApp.#onToggleTierReveal.call(this, event, target);
    }

    static async #onRollGatheringDay(event, target) {
        // Individual day rolling is superseded by parallel Roll All
        return DowntimeLedgerApp.#onRollAllGathering.call(this, event, target);
    }

    static async #onRollAllGathering(event, target) {
        const actorId = target.dataset.actorId;
        if (!actorId) return;
        if (!this._isGM) {
            const actor = typeof game.actors?.get === "function" ? game.actors.get(actorId) : (Array.isArray(game.actors) ? game.actors.find(a => a?.id === actorId) : null);
            if (actor && !actor.isOwner) {
                ui.notifications?.warn("You do not have permission to roll gathering for this character.");
                return;
            }
        }
        const actor = typeof game.actors?.get === "function" ? game.actors.get(actorId) : (Array.isArray(game.actors) ? game.actors.find(a => a?.id === actorId) : null);
        if (!actor) return;

        const schedule = this._getOrCreateGatheringSchedule(actorId);
        const surMod = Number(actor.system?.skills?.sur?.total ?? actor.system?.skills?.sur?.mod ?? 0);
        const formula = surMod >= 0 ? `1d20 + ${surMod}` : `1d20 - ${Math.abs(surMod)}`;

        const activeDays = schedule.filter(d => d.mode !== "skip");
        if (activeDays.length === 0) {
            ui.notifications?.info("No active gathering days to roll (all days are skipped).");
            return;
        }

        const targetDays = activeDays.filter(d => !d.rolled);
        if (targetDays.length === 0) {
            ui.notifications?.info("Gathering is already rolled. Those finds stay.");
            return;
        }

        // Roll all target days in parallel
        await Promise.all(targetDays.map(async (dayEntry) => {
            const isHunt = dayEntry.mode === "hunt";
            const dc = isHunt ? (this._campLogistics._huntDC ?? 14) : (this._campLogistics._forageDC ?? 12);

            let rollTotal = 10 + surMod;
            try {
                const r = new Roll(formula);
                await r.evaluate();
                rollTotal = r.total;
                await presentRoll(r);
            } catch {
                rollTotal = 10 + surMod;
            }

            const gathered = await GatherYieldService.resolveGatherDay({
                actor,
                mode: isHunt ? "hunt" : "forage",
                terrainTag: this._terrainTag ?? "forest",
                total: rollTotal,
                dc
            });
            const haul = gathered.fromTable
                ? GatherYieldService.describeItems(gathered.items)
                : (gathered.rations > 0 ? `${gathered.rations} rations` : "");
            const detail = [haul, gathered.mishap].filter(Boolean).join(". ");

            dayEntry.rolled = true;
            dayEntry.rollTotal = rollTotal;
            dayEntry.dc = dc;
            dayEntry.success = gathered.success && !gathered.mishap;
            dayEntry.yield = gathered.fromTable
                ? GatherYieldService.countUnits(gathered.items)
                : gathered.rations;
            dayEntry.detail = detail;
            dayEntry.items = gathered.items ?? [];
            dayEntry.fromTable = gathered.fromTable;
        }));

        this._gatheringSchedule.set(actorId, schedule);
        if (this._isGM) {
            this._broadcastSync();
            this.render();
            this._saveSessionState();
        } else {
            emitRestSessionDelta("downtime", "ROLL_ALL_GATHERING", { actorId, schedule });
            this.render();
        }
    }

    static async #onRollActivityDay(event, target) {
        const actorId = target.dataset.actorId;
        const day = Number(target.dataset.day);
        if (!actorId || !day) return;
        const actor = game.actors.get(actorId);
        if (!actor) return;

        const isOwner = actor.isOwner || this._isGM;
        if (!isOwner) {
            ui.notifications?.warn("You do not have permission to roll activities for this character.");
            return;
        }

        const isCommitted = this._committedActorIds.has(actorId);
        if (!isCommitted && !this._isGM) {
            ui.notifications?.warn("Lock in choices first before rolling activities.");
            return;
        }

        const rolls = this._getOrCreateActivityRolls(actorId);
        let dayRoll = rolls.find(r => r.day === day);
        if (!dayRoll) return;

        if (!dayRoll.activityId && target.dataset.activity) {
            dayRoll.activityId = target.dataset.activity;
        }
        if (!dayRoll.activityId) return;

        if (dayRoll.rolled && !this._isGM) {
            ui.notifications?.info(`Day ${day} (${dayRoll.activityId}) has already been resolved.`);
            return;
        }

        if (["cook", "brew", "craft"].includes(dayRoll.activityId)) {
            // Craft day clicked on timeline
            if (event.shiftKey) {
                const surMod = Number(actor.system?.skills?.sur?.total ?? actor.system?.skills?.sur?.mod ?? 0);
                const wisMod = Number(actor.system?.abilities?.wis?.mod ?? 0);
                const bestMod = Math.max(surMod, wisMod);
                const dc = 12;
                const formula = bestMod >= 0 ? `1d20 + ${bestMod}` : `1d20 - ${Math.abs(bestMod)}`;
                let rollTotal = 10 + bestMod;
                try {
                    const r = new Roll(formula);
                    await r.evaluate();
                    rollTotal = r.total;
                    await presentRoll(r);
                } catch {
                    rollTotal = 10 + bestMod;
                }
                dayRoll.rolled = true;
                dayRoll.rollTotal = rollTotal;
                dayRoll.dc = dc;
                dayRoll.success = rollTotal >= dc;
                dayRoll.skillUsed = "sur";

                this._activityRolls.set(actorId, rolls);
                if (this._isGM) {
                    this._syncDraftDCs();
                    this._broadcastSync();
                    this.render();
                    this._saveSessionState();
                } else {
                    emitRestSessionDelta("downtime", "ROLL_ACTIVITY_DAY", {
                        actorId,
                        day,
                        rollData: { ...dayRoll }
                    });
                    this.render();
                }
                return;
            }

            const profId = (dayRoll.activityId === "cook") ? "cooking"
                         : (dayRoll.activityId === "brew") ? "brewing"
                         : "crafting";
            const engine = this._getCraftingEngine();
            const picker = new CraftingPickerApp(
                actor,
                profId,
                engine,
                async (result) => {
                    if (!result) return;
                    dayRoll.rolled = true;
                    dayRoll.rollTotal = result.checkTotal ?? result.rollTotal ?? (result.success ? 15 : 8);
                    dayRoll.dc = result.dc ?? 12;
                    dayRoll.success = !!result.success;
                    dayRoll.skillUsed = profId;

                    if (this._isGM) {
                        this._activityRolls.set(actorId, rolls);
                        this._syncDraftDCs();
                        this._broadcastSync();
                        this.render();
                        this._saveSessionState();
                    } else {
                        emitRestSessionDelta("downtime", "ROLL_ACTIVITY_DAY", {
                            actorId,
                            day,
                            rollData: { ...dayRoll }
                        });
                        this.render();
                    }
                },
                this._terrainTag
            );
            picker.render(true);
            return;
        }

        const actDef = ActivityRegistry.getActivity(dayRoll.activityId);
        const checkDef = actDef?.check;
        if (!checkDef) return;

        if (dayRoll.activityId !== "fortify") {
            const result = await rollDowntimeSkillDay(actor, dayRoll);
            if (this._isGM) {
                this._activityRolls.set(actorId, rolls);
                this._syncDraftDCs();
                this._broadcastSync();
                this.render();
                this._saveSessionState();
            } else {
                emitRestSessionDelta("downtime", "ROLL_ACTIVITY_DAY", {
                    actorId,
                    day,
                    rollData: { ...dayRoll }
                });
                this.render();
            }
            const notice = formatFletchGrantNotice(result.granted ? [result.granted] : []);
            if (notice) ui.notifications?.info?.(notice);
            return;
        }

        const dc = checkDef.dc ?? 12;

        let bestMod = -99;
        let bestSkill = checkDef.skills?.[0] ?? "sur";
        if (Array.isArray(checkDef.skills)) {
            for (const skillKey of checkDef.skills) {
                const mod = Number(actor.system?.skills?.[skillKey]?.total ?? actor.system?.skills?.[skillKey]?.mod ?? 0);
                if (mod > bestMod) {
                    bestMod = mod;
                    bestSkill = skillKey;
                }
            }
        } else {
            bestMod = Number(actor.system?.skills?.sur?.total ?? actor.system?.skills?.sur?.mod ?? 0);
        }
        if (bestMod === -99) bestMod = 0;

        const formula = bestMod >= 0 ? `1d20 + ${bestMod}` : `1d20 - ${Math.abs(bestMod)}`;
        let rollTotal = 10 + bestMod;
        try {
            const r = new Roll(formula);
            await r.evaluate();
            rollTotal = r.total;
            await presentRoll(r);
        } catch {
            rollTotal = 10 + bestMod;
        }

        const isSuccess = rollTotal >= dc;
        dayRoll.rolled = true;
        dayRoll.rollTotal = rollTotal;
        dayRoll.dc = dc;
        dayRoll.success = isSuccess;
        dayRoll.skillUsed = bestSkill;

        if (this._isGM) {
            this._activityRolls.set(actorId, rolls);
            this._syncDraftDCs();
            this._broadcastSync();
            this.render();
            this._saveSessionState();
        } else {
            emitRestSessionDelta("downtime", "ROLL_ACTIVITY_DAY", {
                actorId,
                day,
                rollData: { ...dayRoll }
            });
        }
    }

    static async #onRollAllActivities(event, target) {
        const actorId = target.dataset.actorId;
        if (!actorId) return;
        const actor = game.actors.get(actorId);
        if (!actor) return;

        const rolls = this._getOrCreateActivityRolls(actorId);
        const rollableDays = rolls.filter(r => {
            if (!r.activityId) return false;
            const actDef = ActivityRegistry.getActivity(r.activityId);
            return !!actDef?.check;
        });

        if (!rollableDays.length) return;

        const kind = target.dataset.rollKind || "all";
        const selected = rollableDays.filter(entry => {
            if (kind === "defense") return entry.activityId === "fortify";
            if (kind === "skill") return entry.activityId !== "fortify";
            return true;
        });
        if (!selected.length) return;

        const allRolled = selected.every(entry => entry.rolled);
        if (allRolled && !this._isGM) {
            ui.notifications?.warn("Only the GM can reroll these checks.");
            return;
        }

        const targetDays = allRolled ? selected : selected.filter(entry => !entry.rolled);
        if (targetDays.length === 0) return;

        const skillDays = targetDays.filter(entry => entry.activityId !== "fortify");
        const defenseDays = targetDays.filter(entry => entry.activityId === "fortify");
        const grants = [];
        if (skillDays.length) {
            const fletchKind = pickFletchKind(actor);
            for (const dayRoll of skillDays) {
                const result = await rollDowntimeSkillDay(actor, dayRoll, { fletchKind });
                if (result.granted) grants.push(result.granted);
            }
        }

        if (defenseDays.length) await Promise.all(defenseDays.map(async (dayRoll) => {
            const actDef = ActivityRegistry.getActivity(dayRoll.activityId);
            const checkDef = actDef?.check;
            const dc = checkDef?.dc ?? 12;

            let bestMod = -99;
            let bestSkill = checkDef?.skills?.[0] ?? "sur";
            if (Array.isArray(checkDef?.skills)) {
                for (const skillKey of checkDef.skills) {
                    const mod = Number(actor.system?.skills?.[skillKey]?.total ?? actor.system?.skills?.[skillKey]?.mod ?? 0);
                    if (mod > bestMod) {
                        bestMod = mod;
                        bestSkill = skillKey;
                    }
                }
            } else {
                bestMod = Number(actor.system?.skills?.sur?.total ?? actor.system?.skills?.sur?.mod ?? 0);
            }
            if (bestMod === -99) bestMod = 0;

            const formula = bestMod >= 0 ? `1d20 + ${bestMod}` : `1d20 - ${Math.abs(bestMod)}`;
            let rollTotal = 10 + bestMod;
            try {
                const r = new Roll(formula);
                await r.evaluate();
                rollTotal = r.total;
                await presentRoll(r);
            } catch {
                rollTotal = 10 + bestMod;
            }

            dayRoll.rolled = true;
            dayRoll.rollTotal = rollTotal;
            dayRoll.dc = dc;
            dayRoll.success = rollTotal >= dc;
            dayRoll.skillUsed = bestSkill;
        }));

        this._activityRolls.set(actorId, rolls);
        if (this._isGM) {
            this._syncDraftDCs();
            this._broadcastSync();
            this.render();
            this._saveSessionState();
        } else {
            emitRestSessionDelta("downtime", "ROLL_ALL_ACTIVITIES", { actorId, rolls });
            this.render();
        }
        const notice = formatFletchGrantNotice(grants);
        if (notice) ui.notifications?.info?.(notice);
    }

    static async #onCommitActivities(event, target) {
        const actorId = target.dataset.actorId;
        if (!actorId) return;

        if (this._isGM) {
            this._committedActorIds.add(actorId);
            this._broadcastSync();
            this.render();
            this._saveSessionState();
        } else {
            this._committedActorIds.add(actorId);
            emitRestSessionDelta("downtime", "COMMIT_ACTIVITIES", { actorId, committed: true });
            this.render();
        }
    }

    static async #onUnlockActivities(event, target) {
        const actorId = target.dataset.actorId;
        if (!actorId) return;
        const actor = game.actors.get(actorId);
        const rolls = this._getOrCreateActivityRolls(actorId);
        const ownerEscape = !this._isGM
            && !!actor?.isOwner
            && this._committedActorIds.has(actorId)
            && craftPlanNeedsEscape(rolls, this._craftAvailableCounts(actor, rolls));
        if (!this._isGM && !ownerEscape) {
            ui.notifications.warn("Only the GM can revoke committed downtime plans.");
            return;
        }

        this._committedActorIds.delete(actorId);
        if (this._isGM) {
            this._broadcastSync();
            this.render();
            this._saveSessionState();
            return;
        }

        emitRestSessionDelta("downtime", "COMMIT_ACTIVITIES", { actorId, committed: false });
        this.render();
        ui.notifications?.info("Plan unlocked. Assign those days to another activity.");
    }

    static async #onOpenCraftQueue(event, target) {
        const actorId = target.dataset.actorId;
        if (!actorId) return;
        const actor = game.actors.get(actorId);
        if (!actor) return;

        const isOwner = actor.isOwner || this._isGM;
        if (!isOwner) {
            ui.notifications.warn("You do not have permission to resolve crafts for this character.");
            return;
        }

        const rolls = this._getOrCreateActivityRolls(actorId);
        const unresolvedCrafts = rolls.filter(r => ["cook", "brew", "craft"].includes(r.activityId) && !r.rolled);

        if (!unresolvedCrafts.length) {
            ui.notifications.info(`${actor.name} has already resolved all crafting activities.`);
            return;
        }

        // Shift+Click: Fast quick-roll for all remaining craft days (Survival/Wisdom vs DC 12)
        if (event.shiftKey) {
            const surMod = Number(actor.system?.skills?.sur?.total ?? actor.system?.skills?.sur?.mod ?? 0);
            const wisMod = Number(actor.system?.abilities?.wis?.mod ?? 0);
            const bestMod = Math.max(surMod, wisMod);
            const dc = 12;

            await Promise.all(unresolvedCrafts.map(async (craftRoll) => {
                const formula = bestMod >= 0 ? `1d20 + ${bestMod}` : `1d20 - ${Math.abs(bestMod)}`;
                let rollTotal = 10 + bestMod;
                try {
                    const r = new Roll(formula);
                    await r.evaluate();
                    rollTotal = r.total;
                    await presentRoll(r);
                } catch {
                    rollTotal = 10 + bestMod;
                }

                craftRoll.rolled = true;
                craftRoll.rollTotal = rollTotal;
                craftRoll.dc = dc;
                craftRoll.success = rollTotal >= dc;
                craftRoll.skillUsed = "sur";
            }));

            this._activityRolls.set(actorId, rolls);
            if (this._isGM) {
                this._syncDraftDCs();
                this._broadcastSync();
                this.render();
                this._saveSessionState();
            } else {
                emitRestSessionDelta("downtime", "ROLL_ALL_ACTIVITIES", {
                    actorId,
                    rolls: [...rolls]
                });
                this.render();
            }

            ui.notifications.info(`${actor.name}: Quick-rolled ${unresolvedCrafts.length} craft check(s) vs DC ${dc}.`);
            return;
        }

        // Standard Click: Open CraftingPickerApp for the first unresolved craft day
        const nextCraft = unresolvedCrafts[0];
        const profId = (nextCraft.activityId === "cook") ? "cooking"
                     : (nextCraft.activityId === "brew") ? "brewing"
                     : "crafting";

        const engine = this._getCraftingEngine();
        const picker = new CraftingPickerApp(
            actor,
            profId,
            engine,
            async (result) => {
                if (!result) return;
                nextCraft.rolled = true;
                nextCraft.rollTotal = result.checkTotal ?? result.rollTotal ?? (result.success ? 15 : 8);
                nextCraft.dc = result.dc ?? 12;
                nextCraft.success = !!result.success;
                nextCraft.skillUsed = profId;

                this._activityRolls.set(actorId, rolls);
                if (this._isGM) {
                    this._syncDraftDCs();
                    this._broadcastSync();
                    this.render();
                    this._saveSessionState();
                } else {
                    emitRestSessionDelta("downtime", "ROLL_ACTIVITY_DAY", {
                        actorId,
                        day: nextCraft.day,
                        rollData: { ...nextCraft }
                    });
                    this.render();
                }

                const remaining = unresolvedCrafts.length - 1;
                if (remaining > 0) {
                    ui.notifications.info(`${actor.name}: Day ${nextCraft.day} ${nextCraft.activityId} resolved! ${remaining} craft day(s) remaining.`);
                } else {
                    ui.notifications.info(`${actor.name}: All craft activities resolved!`);
                }
            },
            this._terrainTag
        );
        picker.render(true);
    }

    static #onSelectSustenanceRoleLegacy(event, target) {
        const actorId = target.dataset.actorId;
        const role = target.value || target.dataset.role || "forage";
        if (!actorId) return;
        const schedule = normalizeGatheringSchedule(null, role === "hunt" ? "hunt" : "forage");
        this._gatheringSchedule.set(actorId, schedule);
        if (this._isGM) {
            this._broadcastSync();
            this.render();
            this._saveSessionState();
        } else {
            emitRestSessionDelta("downtime", "ROLL_ALL_GATHERING", { actorId, schedule });
        }
    }

    static async #onRollSustenanceLegacy(event, target) {
        return DowntimeLedgerApp.#onRollAllGathering.call(this, event, target);
    }

    static async #onSelectFireLevel(event, target) {
        const level = target?.value || target?.dataset?.fireLevel;
        if (!level) return;
        if (target.disabled || target.classList?.contains("disabled")) return;

        const partyActors = getPartyActors();
        const fuelStockTotal = partyActors.reduce((sum, a) => sum + CampGearScanner.countActorFirewood(a), 0);
        const hasTinderbox = partyActors.some(a => CampGearScanner.actorHasTinderbox(a));
        const requiredFuel = CampGearScanner.FIREWOOD_COST_BY_LEVEL[level] ?? 0;

        if (level !== "cold_camp" && !hasTinderbox) {
            ui.notifications?.warn("Cannot light fire: No tinderbox or flint and steel in the party.");
            this.render();
            return;
        }
        if (fuelStockTotal < requiredFuel) {
            ui.notifications?.warn(`Not enough fuel: ${requiredFuel} firewood required for ${level.replace('_', ' ')}.`);
            this.render();
            return;
        }

        this._fireLevel = level;
        this._syncDraftDCs();

        if (this._isGM) {
            this._saveSessionState();
            this._broadcastSync();
            this.render();
        } else {
            emitRestSessionDelta("downtime", "SET_FIRE_LEVEL", { fireLevel: level });
            this.render();
        }
    }

    static #onProceedToResolutionFlow(event, target) {
        if (!this._isGM) return;
        const unready = this.#unreadyParty();
        if (unready.length > 0) {
            ui.notifications?.warn(`Still drafting: ${unready.join(", ")}.`);
            return;
        }
        this._pacingActive = true;
        this._activePacingNight = 1;
        this._saveSessionState();
        this._broadcastSync();
        this.setPosition({ height: "auto" });
        this.render();
    }

    static #onReturnToPlanning(event, target) {
        if (!this._isGM) return;
        const hasAnyRolls = Boolean(this._encounterDraft?.some(e => e.isRolled));
        if (hasAnyRolls) {
            ui.notifications?.warn("Cannot return to camp planning once night checks have been rolled.");
            return;
        }
        this._pacingActive = false;
        this._saveSessionState();
        this._broadcastSync();
        this.setPosition({ height: 820 });
        this.render();
    }

    static async #onRollNightCheck(event, target) {
        if (!this._isGM) return;
        const nightIndex = Number(target?.dataset?.night) || this._activePacingNight || 1;
        const entry = this._encounterDraft.find(e => e.nightIndex === nightIndex);
        if (!entry) return;

        const mods = this._getNightActivityModifiers(nightIndex);
        const fireNudge = fireEncounterDcNudge(this._fireLevel);
        const manualOffset = entry.manualOffset ?? 0;
        const targetDC = combineNightDc(this._dangerDC, mods.activityNudge, fireNudge, manualOffset);

        const roll = await new Roll("1d20").evaluate();
        await presentRoll(roll);

        const rollTotal = roll.total;
        const triggered = rollTotal < targetDC;
        let state = "green";
        let category = "ambient";
        let isDisaster = false;
        let eventObj = null;

        const party = getPartyActors();
        const sentryActor = mods.sentryActor ?? party[0] ?? null;
        const pp = sentryActor?.system?.skills?.prc?.passive ?? sentryActor?.system?.attributes?.passive?.perception ?? 10;
        const sentrySurprised = mods.hasActiveGuard ? false : pp < 12;

        if (triggered) {
            const resolver = await this._getEventResolver();
            if (rollTotal === 1) {
                isDisaster = true;
                state = "red";
                category = "disaster";
                const disaster = resolver._pickFromPool
                    ? resolver._pickFromPool(this._terrainTag, { tier: "disaster" })
                    : null;
                if (disaster) {
                    eventObj = {
                        title: disaster.name,
                        description: disaster.description,
                        category: "disaster",
                        isDisaster: true,
                        terrainTag: this._terrainTag,
                        mechanical: disaster.mechanical,
                        id: disaster.id,
                        sentryName: sentryActor?.name ?? "Camp Watch",
                        sentrySurprised
                    };
                } else {
                    eventObj = {
                        title: "Wilderness Disaster",
                        description: `A critical disaster strikes the campsite in the ${this._terrainTag}!`,
                        category: "disaster",
                        isDisaster: true,
                        terrainTag: this._terrainTag,
                        sentryName: sentryActor?.name ?? "Camp Watch",
                        sentrySurprised
                    };
                }
                await roll.toMessage({
                    speaker: { alias: "Night Watch" },
                    flavor: `<strong>Night check</strong> (${this._terrainTag}) threshold ${targetDC}<br><em style="color:#e74c3c;">Natural 1: Disaster strikes the camp! (${eventObj.title})</em>`,
                    whisper: game.users.filter(u => u.isGM).map(u => u.id)
                });
            } else {
                const poolEvents = listPoolEventsForTerrain(resolver, this._terrainTag);
                const catalogEvent = poolEvents.length > 0
                    ? (resolver._pickFromPool ? resolver._pickFromPool(this._terrainTag, { tier: "normal", hasWatch: Boolean(mods.sentryActor) }) : null) ?? poolEvents[Math.floor(Math.random() * poolEvents.length)]
                    : null;

                if (catalogEvent) {
                    const isCombat = catalogEvent.category === "encounter" || catalogEvent.category === "combat";
                    state = isCombat ? "red" : "amber";
                    category = catalogEvent.category ?? "discovery";
                    eventObj = {
                        title: catalogEvent.name,
                        description: catalogEvent.description,
                        category: catalogEvent.category,
                        isDisaster: false,
                        terrainTag: this._terrainTag,
                        mechanical: catalogEvent.mechanical,
                        id: catalogEvent.id,
                        sentryName: sentryActor?.name ?? "Camp Watch",
                        sentrySurprised
                    };
                    await roll.toMessage({
                        speaker: { alias: "Night Watch" },
                        flavor: `<strong>Night check</strong> (${this._terrainTag}) threshold ${targetDC}<br><em>${catalogEvent.name}</em> triggered (roll ${rollTotal} below threshold).`,
                        whisper: game.users.filter(u => u.isGM).map(u => u.id)
                    });
                } else {
                    state = "amber";
                    category = "encounter";
                    eventObj = {
                        title: "Improvised Encounter",
                        description: `Night check threshold ${targetDC} not met (${rollTotal}). No events in curated pool for ${this._terrainTag}. Run your own scenario at the table.`,
                        category: "encounter",
                        isDisaster: false,
                        terrainTag: this._terrainTag,
                        sentryName: sentryActor?.name ?? "Camp Watch",
                        sentrySurprised,
                        adHoc: true
                    };
                    await roll.toMessage({
                        speaker: { alias: "Night Watch" },
                        flavor: `<strong>Night check</strong> (${this._terrainTag}) threshold ${targetDC}<br><em>Roll ${rollTotal} below threshold. Run your own scenario at the table.</em>`,
                        whisper: game.users.filter(u => u.isGM).map(u => u.id)
                    });
                }
            }
        } else {
            await roll.toMessage({
                speaker: { alias: "Night Watch" },
                flavor: `<strong>Night check</strong> (${this._terrainTag}) threshold ${targetDC}<br>${rollTotal} meets or beats the threshold. The night passes without incident.`,
                whisper: game.users.filter(u => u.isGM).map(u => u.id)
            });
        }

        entry.state = state;
        entry.category = category;
        entry.isDisaster = isDisaster;
        entry.triggered = triggered;
        entry.forcedSafe = !triggered;
        entry.rollTotal = rollTotal;
        entry.effectiveDC = targetDC;
        entry.event = eventObj;
        entry.isRolled = true;
        entry.sentryName = sentryActor?.name ?? "Camp Watch";
        entry.sentrySurprised = sentrySurprised;

        this._saveSessionState();
        this._broadcastSync();
        this.render();
    }

    static async #onImproviseNightCheck(event, target) {
        if (!this._isGM) return;
        const nightIndex = Number(target?.dataset?.night) || this._activePacingNight || 1;
        const entry = this._encounterDraft.find(e => e.nightIndex === nightIndex);
        if (!entry) return;

        const mods = this._getNightActivityModifiers(nightIndex);
        const fireNudge = fireEncounterDcNudge(this._fireLevel);
        const manualOffset = entry.manualOffset ?? 0;
        const targetDC = combineNightDc(this._dangerDC, mods.activityNudge, fireNudge, manualOffset);

        const roll = await new Roll("1d20").evaluate();
        await presentRoll(roll);

        const rollTotal = roll.total;
        const triggered = rollTotal < targetDC;
        const party = getPartyActors();
        const sentryActor = mods.sentryActor ?? party[0] ?? null;

        if (triggered) {
            await roll.toMessage({
                speaker: { alias: "Night Watch" },
                flavor: `<strong>Improvised night check</strong> (${this._terrainTag}) threshold ${targetDC}<br>${rollTotal} below threshold. Run your own scenario at the table.`,
                whisper: game.users.filter(u => u.isGM).map(u => u.id)
            });
            entry.state = "amber";
            entry.category = "encounter";
            entry.isDisaster = false;
            entry.triggered = true;
            entry.forcedSafe = false;
            entry.event = {
                title: "Improvised Encounter",
                description: `Improvised night check threshold ${targetDC} not met (${rollTotal}). Run your own scenario at the table.`,
                category: "encounter",
                isDisaster: false,
                terrainTag: this._terrainTag,
                sentryName: sentryActor?.name ?? "Camp Watch",
                sentrySurprised: false,
                adHoc: true
            };
        } else {
            await roll.toMessage({
                speaker: { alias: "Night Watch" },
                flavor: `<strong>Improvised night check</strong> (${this._terrainTag}) threshold ${targetDC}<br>${rollTotal} meets or beats the threshold. The night passes without incident.`,
                whisper: game.users.filter(u => u.isGM).map(u => u.id)
            });
            entry.state = "green";
            entry.category = "ambient";
            entry.isDisaster = false;
            entry.triggered = false;
            entry.forcedSafe = true;
            entry.event = null;
        }

        entry.rollTotal = rollTotal;
        entry.effectiveDC = targetDC;
        entry.isRolled = true;
        entry.sentryName = sentryActor?.name ?? "Camp Watch";
        entry.sentrySurprised = false;

        this._saveSessionState();
        this._broadcastSync();
        this.render();
    }

    static #onImproviseNightOverride(event, target) {
        if (!this._isGM) return;
        const nightIndex = Number(target?.dataset?.night) || this._activePacingNight || 1;
        const entry = this._encounterDraft.find(e => e.nightIndex === nightIndex);
        if (!entry) return;

        entry.isRolled = true;
        entry.triggered = true;
        entry.forcedSafe = false;
        entry.state = "amber";
        entry.isDisaster = false;
        entry.category = "encounter";
        entry.event = {
            title: "Improvised Encounter",
            description: "Table-side scenario. Narrate and run your own encounter at the table.",
            category: "encounter",
            isDisaster: false,
            terrainTag: this._terrainTag,
            sentryName: entry.sentryName ?? "Camp Watch",
            sentrySurprised: false,
            adHoc: true
        };

        this._saveSessionState();
        this._broadcastSync();
        this.render();
    }

    static async #onPickPoolNightEvent(event, target) {
        if (!this._isGM) return;
        const nightIndex = Number(target?.dataset?.night) || this._activePacingNight || 1;
        const entry = this._encounterDraft.find(e => e.nightIndex === nightIndex);
        if (!entry) return;

        const resolver = await this._getEventResolver();
        let poolEvents = listPoolEventsForTerrain(resolver, this._terrainTag);
        if (!poolEvents.length) {
            try {
                const all = await loadAllCatalogEvents();
                resolver.load([], all);
                poolEvents = listPoolEventsForTerrain(resolver, this._terrainTag);
            } catch {}
        }

        if (!poolEvents.length) {
            ui.notifications?.warn("No events in the curated pool for this terrain. Curate the pool in settings first.");
            return;
        }

        const terrain = TerrainRegistry.get(this._terrainTag);
        const terrainLabel = terrain?.label ?? this._terrainTag;
        const eventId = await pickPoolEvent(poolEvents, terrainLabel, this._terrainTag);
        if (!eventId) return;

        const catalogEvent = resolver.events.get(eventId) ?? poolEvents.find(e => e.id === eventId);
        if (!catalogEvent) return;

        const isCombat = catalogEvent.category === "encounter" || catalogEvent.category === "combat" || catalogEvent.tier === "disaster";
        entry.isRolled = true;
        entry.triggered = true;
        entry.forcedSafe = false;
        entry.state = isCombat ? "red" : "amber";
        entry.isDisaster = catalogEvent.tier === "disaster";
        entry.category = catalogEvent.category ?? "discovery";
        entry.event = {
            title: catalogEvent.name,
            description: catalogEvent.description,
            category: catalogEvent.category,
            isDisaster: entry.isDisaster,
            mechanical: catalogEvent.mechanical,
            id: catalogEvent.id,
            terrainTag: this._terrainTag,
            sentryName: entry.sentryName ?? "Camp Watch",
            sentrySurprised: false
        };

        this._saveSessionState();
        this._broadcastSync();
        this.render();
    }

    static #onSetNightQuiet(event, target) {
        if (!this._isGM) return;
        const nightIndex = Number(target?.dataset?.night) || this._activePacingNight || 1;
        const entry = this._encounterDraft.find(e => e.nightIndex === nightIndex);
        if (!entry) return;

        entry.isRolled = true;
        entry.forcedSafe = true;
        entry.triggered = false;
        entry.state = "green";
        entry.isDisaster = false;
        entry.category = "ambient";
        entry.event = null;

        this._saveSessionState();
        this._broadcastSync();
        this.render();
    }


    static #onSetNightSeverity(event, target) {
        if (!this._isGM) return;
        const nightIndex = Number(target.dataset.night) || this._activePacingNight || 1;
        const state = target.dataset.state;
        const entry = this._encounterDraft.find(e => e.nightIndex === nightIndex);
        if (!entry || !state) return;

        entry.isRolled = true;
        entry.forcedSafe = (state === "green");
        entry.state = state;
        entry.isDisaster = false;
        entry.triggered = (state !== "green");

        if (state === "green") {
            entry.category = "ambient";
            entry.event = null;
        } else if (state === "amber") {
            entry.category = "discovery";
            entry.event = {
                title: "Nocturnal Encounter",
                description: `Strange sounds, curious wildlife, or wanderers approach the campsite in the ${this._terrainTag}.`,
                category: "discovery",
                isDisaster: false,
                terrainTag: this._terrainTag,
                sentryName: entry.sentryName ?? "Camp Watch",
                sentrySurprised: false
            };
        } else if (state === "red") {
            entry.category = "combat";
            entry.event = {
                title: "Hostile Ambush",
                description: `Hostile foes assault the campsite in the ${this._terrainTag}!`,
                category: "encounter",
                isDisaster: false,
                terrainTag: this._terrainTag,
                sentryName: entry.sentryName ?? "Camp Watch",
                sentrySurprised: entry.sentrySurprised ?? false
            };
        }

        this._saveSessionState();
        this._broadcastSync();
        this.render();
    }

    static async #onToggleNightsVariant(event, target) {
        if (!this._isGM) return;
        this._totalNights = this._totalNights === 1 ? 7 : 1;
        this._activePacingNight = 1;
        await this._initEncounterDraft();
        this._saveSessionState();
        this._broadcastSync();
        this.render();
    }

    #sendoffRows() {
        return collectSendoffRows({
            actors: getPartyActors(),
            meals: this._departureMeals,
            drinks: this._departureDrinks,
            applied: this._sendoffApplied ?? []
        });
    }

    #sendoffPending() {
        return this.#sendoffRows().filter(row => !row.applied).length;
    }

    #sendoffRoster() {
        return this.#sendoffRows().map(row => ({
            ...row,
            canApply: !row.applied && this.#canEditMeals(row.actorId)
        }));
    }

    #rememberSendoff(record) {
        const applied = [...(this._sendoffApplied ?? [])];
        const id = `${record.actorId}:${record.kind}:${record.itemId}`;
        const next = applied.filter(row => `${row.actorId}:${row.kind}:${row.itemId}` !== id);
        next.push(record);
        this._sendoffApplied = next;
        this._saveSessionState();
        this._broadcastSync();
        this.render();
    }

    async #applySendoffRow(row) {
        if (!row || row.applied) return;
        if (!this.#canEditMeals(row.actorId)) return;
        if (!this._isGM) {
            emitRestSessionDelta("downtime", "APPLY_SENDOFF", {
                actorId: row.actorId,
                kind: row.kind,
                itemId: row.itemId
            });
            return;
        }
        const actor = typeof game.actors?.get === "function" ? game.actors.get(row.actorId) : null;
        const partyIds = getPartyActors().map(member => member.id);
        const outcome = await applySendoffServing({
            actor,
            itemId: row.itemId,
            kind: row.kind,
            partyIds
        });
        if (!outcome.ok) {
            ui.notifications?.warn?.(outcome.resultLine || "Could not serve that.");
            return;
        }
        this.#rememberSendoff(outcome.record);
    }

    static #onSetPacingNight(event, target) {
        const night = Number(target.dataset.night) || 1;
        const total = this._totalNights || (this._isGrittyLongRest ? 7 : 1);
        const maxStep = total + 1;
        if (!this._isGM) {
            const entry = this._encounterDraft?.find?.(e => e.nightIndex === night);
            const isVeiled = night > (this._activePacingNight || 1) && !entry?.isRolled;
            if (isVeiled) return;
        }
        if (this._isGM && total > 1 && night > total - 1 && this.#sendoffPending() > 0) {
            this._sendoffOpen = true;
            this._activePacingNight = total - 1;
            this._saveSessionState();
            this._broadcastSync();
            this.render();
            return;
        }
        if (night <= total - 1) this._sendoffOpen = false;
        this._activePacingNight = Math.max(1, Math.min(maxStep, night));
        if (this._isGM) {
            this._saveSessionState();
            this._broadcastSync();
        }
        this.render();
    }

    static #onNextPacingNight(event, target) {
        if (!this._isGM) return;
        const total = this._totalNights || (this._isGrittyLongRest ? 7 : 1);
        const maxStep = total + 1;
        if (this._sendoffOpen) {
            if (this.#sendoffPending() > 0) {
                ui.notifications?.warn?.("Apply each meal and drink before the last watch.");
                return;
            }
            this._sendoffOpen = false;
            this._activePacingNight = total;
            this._saveSessionState();
            this._broadcastSync();
            this.render();
            return;
        }
        if (holdsForSendoff({
            totalNights: total,
            activeNight: this._activePacingNight,
            pending: this.#sendoffPending()
        })) {
            this._sendoffOpen = true;
            this._saveSessionState();
            this._broadcastSync();
            this.render();
            return;
        }
        this._activePacingNight = Math.min(maxStep, this._activePacingNight + 1);
        this._saveSessionState();
        this._broadcastSync();
        this.render();
    }

    static #onPreviousPacingNight(event, target) {
        if (!this._isGM) return;
        if (this._sendoffOpen) {
            this._sendoffOpen = false;
            this._saveSessionState();
            this._broadcastSync();
            this.render();
            return;
        }
        this._activePacingNight = Math.max(1, this._activePacingNight - 1);
        this._saveSessionState();
        this._broadcastSync();
        this.render();
    }

    static async #onApplyOneSendoffBuff(event, target) {
        const rowId = target?.dataset?.rowId;
        if (!rowId) return;
        const row = this.#sendoffRows().find(entry => entry.id === rowId);
        await this.#applySendoffRow(row);
    }

    static async #onApplySendoffBuffs() {
        if (!this._isGM) return;
        for (const row of this.#sendoffRows()) {
            if (!row.applied) await this.#applySendoffRow(row);
        }
    }

    static async #onMinimizeForCombat(event, target) {
        if (!this._isGM) return;
        this._awaitingCombat = true;
        this._saveSessionState();
        this._broadcastSync();
        _showGmRestIndicator(this);
        ui.notifications?.info?.(`Night ${this._activePacingNight} combat active. Respite minimized. Click 'Resume' in the status bar or complete combat on canvas.`);
        this.close({ retainGmRestApp: true });
    }

    static #onCompleteCombatForNight(event, target) {
        if (!this._isGM) return;
        this._completedCombatNights.add(this._activePacingNight);
        this._awaitingCombat = false;
        this._saveSessionState();
        this._broadcastSync();
        this.render();
        ui.notifications?.info?.(`Night ${this._activePacingNight} combat marked resolved.`);
    }

    static #onToggleMustRollExhaustion(event, target) {
        if (!this._isGM) return;
        const actorId = target.dataset.actorId;
        if (!actorId) return;
        const entry = this._getOrCreateExhaustionEntry(game.actors.get(actorId));
        if (!entry) return;
        entry.mustRoll = Boolean(target.checked);
        entry.waived = !entry.mustRoll;
        this._saveSessionState();
        this._broadcastSync();
        this.render();
    }

    static #onSetExhaustionAdvMode(event, target) {
        if (!this._isGM) return;
        const actorId = target.dataset.actorId;
        const mode = target.dataset.mode;
        if (!actorId || !mode) return;
        const entry = this._getOrCreateExhaustionEntry(game.actors.get(actorId));
        if (!entry) return;
        entry.advMode = mode;
        this._saveSessionState();
        this._broadcastSync();
        this.render();
    }

    static async #onRollActorExhaustionSave(event, target) {
        if (!this._isGM) return;
        const actorId = target.dataset.actorId;
        if (!actorId) return;
        await this._rollActorExhaustion(actorId);
        this._saveSessionState();
        this._broadcastSync();
        this.render();
    }

    static async #onRollAllExhaustionSaves(event, target) {
        if (!this._isGM) return;
        const party = getPartyActors();
        for (const actor of party) {
            const entry = this._getOrCreateExhaustionEntry(actor);
            if (entry && entry.mustRoll && !entry.rolled) {
                await this._rollActorExhaustion(actor.id);
            }
        }
        this._saveSessionState();
        this._broadcastSync();
        this.render();
    }

    static #onWaiveAllExhaustionSaves(event, target) {
        if (!this._isGM) return;
        const party = getPartyActors();
        for (const actor of party) {
            const entry = this._getOrCreateExhaustionEntry(actor);
            if (entry) {
                entry.mustRoll = false;
                entry.waived = true;
            }
        }
        this._saveSessionState();
        this._broadcastSync();
        this.render();
    }

    static #onAdjustExhaustionDC(event, target) {
        if (!this._isGM) return;
        const actorId = target.dataset.actorId;
        const delta = parseInt(target.dataset.delta, 10);
        if (!actorId || Number.isNaN(delta)) return;
        const entry = this._getOrCreateExhaustionEntry(game.actors.get(actorId));
        if (!entry) return;
        entry.dc = Math.max(5, Math.min(30, (entry.dc ?? 10) + delta));
        this._saveSessionState();
        this._broadcastSync();
        this.render();
    }

    static #onChangeExhaustionDCInput(event, target) {
        if (!this._isGM) return;
        const actorId = target.dataset.actorId;
        const val = parseInt(target.value, 10);
        if (!actorId || Number.isNaN(val)) return;
        const entry = this._getOrCreateExhaustionEntry(game.actors.get(actorId));
        if (!entry) return;
        entry.dc = Math.max(5, Math.min(30, val));
        this._saveSessionState();
        this._broadcastSync();
        this.render();
    }

    static #onToggleExhaustionOverride(event, target) {
        if (!this._isGM) return;
        const actorId = target.dataset.actorId || target.closest("[data-actor-id]")?.dataset?.actorId;
        if (!actorId) return;
        if (!this._expandedExhaustionOverrides) this._expandedExhaustionOverrides = new Set();
        if (this._expandedExhaustionOverrides.has(actorId)) {
            this._expandedExhaustionOverrides.delete(actorId);
        } else {
            this._expandedExhaustionOverrides.add(actorId);
        }
        this.render();
    }

    static async #onResolveDowntime(event, target) {
        if (!this._isGM) return;

        const party = getPartyActors();
        const pendingExhaustion = party.filter(actor => {
            const entry = this._exhaustionDraft?.get(actor.id);
            return entry?.mustRoll && !entry.rolled;
        });
        if (pendingExhaustion.length > 0) {
            ui.notifications?.warn(`Roll or waive the remaining exhaustion saves before completing the rest (${pendingExhaustion.length} still open).`);
            return;
        }

        if (this.#sendoffPending() > 0) {
            ui.notifications?.warn?.("Apply each meal and drink before completing the rest.");
            const total = this._totalNights || 7;
            if (total > 1) this._activePacingNight = total - 1;
            this._sendoffOpen = true;
            this._saveSessionState();
            this._broadcastSync();
            this.render();
            return;
        }

        const unready = this.#unreadyParty();

        if (unready.length > 0) {
            ui.notifications?.warn(`Cannot resolve downtime: Party is not ready: ${unready.join(", ")}.`);
            return;
        }

        const conditions = this._buildCampConditionsBar();
        const effectiveCampComfort = conditions?.safeRestSpot ? "safe" : (conditions?.campComfort ?? "rough");

        // 1. Resolve 2-phase pipeline, supply commissary, and full recovery
        const result = await DowntimeBatchEngine.resolveDowntime({
            partyActors: party,
            budgetDelegate: this._budgetDelegate,
            haven: this._budgetDelegate.haven,
            fireLevel: this._fireLevel,
            campComfort: effectiveCampComfort,
            terrainTag: this._terrainTag,
            foodDaysNeeded: this._campLogistics._foodDaysNeeded,
            patronSuppliedDays: this._patronSuppliedDays,
            foodNominations: this._foodNominations,
            departureMeals: this._departureMeals,
            sendoffApplied: this._sendoffApplied ?? [],
            gatheringSchedule: this._gatheringSchedule,
            sustenanceRoles: this._gatheringSchedule,
            forageDC: this._campLogistics._forageDC,
            huntDC: this._campLogistics._huntDC,
            activityRolls: this._activityRolls,
            encounterResults: this._encounterDraft,
            enforceBedroll: this._campLogistics._enforceBedroll,
            enforceTent: this._campLogistics._enforceTent,
            enforceMessKit: this._campLogistics._enforceMessKit,
            exhaustionResults: Array.from((this._exhaustionDraft ?? new Map()).entries()).map(([actorId, entry]) => ({
                actorId,
                mustRoll: entry.mustRoll,
                waived: entry.waived,
                rolled: entry.rolled,
                passed: entry.passed,
                gainLevel: (entry.mustRoll && entry.rolled && !entry.passed) ? 1 : 0
            }))
        });

        // 2. Advance calendar (7 days = 10,080 minutes)
        await CalendarHandler.advanceRestTime("long");
        await CalendarHandler.recordRestDate({ announce: false });

        // 3. Render and post Master Chat Card
        const templateData = DowntimeLedgerApp._curateMasterCardData(
            result,
            this._budgetDelegate.haven,
            this._terrainTag,
            this._fireLevel,
            effectiveCampComfort
        );
        const cardHtml = await renderTemplate("modules/ionrift-respite/templates/downtime/master-card.hbs", templateData);

        await ChatMessage.create({
            content: cardHtml,
            speaker: { alias: this._budgetDelegate?.haven === "civilized" ? "Respite 7-Day Safe Rest" : "Respite 7-Day Camp" }
        });

        ui.notifications.info(`${this._budgetDelegate?.haven === "civilized" ? "7-Day Safe Rest" : "7-Day Camp"} resolved. Full recovery applied.`);
        if (this._detectMagic) {
            await purgeDetectMagicRestArtifacts(party);
        }
        emitRestSessionResolved("downtime", result);
        this.close({ resolved: true });
    }

    static _curateMasterCardData(result, haven, terrainTag, fireLevel, campComfort) {
        const bannerContext = ImageResolver.resolveRestBannerContext(terrainTag, "resolve");
        const bannerFireClass = ImageResolver.bannerFireClass(fireLevel);
        const showBanner = !bannerContext.hideTerrainBanner && !!bannerContext.terrainBanner;

        const isCivilized = haven === "civilized";
        const terrainEntry = terrainTag ? TerrainRegistry.get(terrainTag) : null;
        const terrainLabel = terrainEntry?.label ?? (terrainTag ? (terrainTag.charAt(0).toUpperCase() + terrainTag.slice(1)) : (isCivilized ? "Civilized Haven" : "Wilderness"));
        const comfortLabels = { safe: "Safe Spot", rough: "Rough Camp", hostile: "Hostile Ground" };
        const comfortLabel = comfortLabels[campComfort] ?? "Camp";
        const subtitle = isCivilized
            ? "Safe Rest · 7 Nights · Full Recovery"
            : `${terrainLabel} · ${comfortLabel} · 7 Nights`;

        const anySetback = result.characters.some(c =>
            c.notes?.some(n =>
                n.toLowerCase().includes("failed") ||
                n.toLowerCase().includes("starvation") ||
                n.toLowerCase().includes("dehydration")
            )
        );

        const partyStatus = anySetback
            ? { label: "Setbacks Incurred", icon: "fas fa-triangle-exclamation", class: "setback" }
            : { label: "7-Day Rest Complete", icon: "fas fa-sparkles", class: "positive" };

        const characters = result.characters.map(char => {
            let roleLabel = "Rest";
            let roleIcon = "fas fa-bed";
            const sumStr = (char.activitiesSummary || []).join(" ").toLowerCase();
            if (sumStr.includes("gathering") || sumStr.includes("forage") || sumStr.includes("hunt")) {
                roleLabel = "Gather";
                roleIcon = "fas fa-seedling";
            } else if (sumStr.includes("cook")) {
                roleLabel = "Cook";
                roleIcon = "fas fa-utensils";
            } else if (sumStr.includes("tend")) {
                roleLabel = "Heal";
                roleIcon = "fas fa-heart-pulse";
            } else if (sumStr.includes("fortify")) {
                roleLabel = "Fortify";
                roleIcon = "fas fa-shield";
            } else if (sumStr.includes("fletch")) {
                roleLabel = "Fletch";
                roleIcon = "fas fa-feather";
            } else if (sumStr.includes("brew")) {
                roleLabel = "Brew";
                roleIcon = "fas fa-flask";
            } else if (sumStr.includes("train")) {
                roleLabel = "Train";
                roleIcon = "fas fa-dumbbell";
            } else if (sumStr.includes("craft")) {
                roleLabel = "Craft";
                roleIcon = "fas fa-hammer";
            }

            const hasSetback = char.notes?.some(n =>
                n.toLowerCase().includes("failed") ||
                n.toLowerCase().includes("starvation") ||
                n.toLowerCase().includes("dehydration")
            );
            const statusPill = hasSetback
                ? { label: "Setback", icon: "fas fa-triangle-exclamation", class: "setback" }
                : { label: "Full Recovery", icon: "fas fa-sparkles", class: "positive" };

            const rollGroupsMap = new Map();
            for (const r of (char.rolls || [])) {
                const act = r.activity || "Check";
                if (!rollGroupsMap.has(act)) {
                    rollGroupsMap.set(act, { activity: act, checks: [] });
                }
                const group = rollGroupsMap.get(act);
                for (const c of (r.checks || [])) {
                    group.checks.push({
                        day: r.day,
                        total: c.total,
                        yield: c.yield,
                        success: c.success,
                        detail: c.detail
                    });
                }
            }
            const groupedRolls = Array.from(rollGroupsMap.values());
            const totalRollCount = groupedRolls.reduce((sum, g) => sum + g.checks.length, 0);

            const notes = (char.notes || []).map(note => {
                let icon = "fas fa-circle-info";
                let color = "#94a3b8";
                const lower = note.toLowerCase();
                if (lower.includes("starvation")) {
                    icon = "fas fa-drumstick-bite";
                    color = "#f87171";
                } else if (lower.includes("dehydration")) {
                    icon = "fas fa-tint-slash";
                    color = "#f87171";
                } else if (lower.includes("failed")) {
                    icon = "fas fa-triangle-exclamation";
                    color = "#f87171";
                } else if (lower.includes("passed") || lower.includes("resisted") || lower.includes("recovered")) {
                    icon = "fas fa-shield";
                    color = "#34d399";
                }
                return { text: note, icon, color };
            });

            return {
                id: char.actor?.id,
                name: char.name,
                img: char.img,
                rolePill: { label: roleLabel, icon: roleIcon },
                statusPill,
                activitiesSummary: char.activitiesSummary || [],
                groupedRolls,
                totalRollCount,
                hasRolls: totalRollCount > 0,
                notes
            };
        });

        const encounters = (result.encounters || []).map(enc => {
            const isRewarding = enc.state === "amber" || enc.category === "ambient" || enc.event?.isRewarding;
            const isDanger = enc.state === "red" || enc.isDisaster;
            let itemClass = "ambient";
            let icon = "fas fa-compass";
            if (isDanger) {
                itemClass = "danger";
                icon = "fas fa-shield-halved";
            } else if (isRewarding) {
                itemClass = "rewarding";
                icon = "fas fa-sparkles";
            }
            return {
                nightIndex: enc.nightIndex,
                title: enc.event?.title ?? "Encounter",
                description: enc.event?.description ?? "",
                itemClass,
                icon,
                isRewarding
            };
        });

        const hasThreats = encounters.some(e => e.itemClass === "danger");
        const incidentsMeta = hasThreats
            ? { badgeIcon: "fas fa-shield-halved", badgeLabel: `Incidents Resolved (${encounters.length})`, containerClass: "hostile" }
            : { badgeIcon: "fas fa-sparkles", badgeLabel: `Discoveries Logged (${encounters.length})`, containerClass: "ambient" };

        return {
            title: "7-Day Downtime Complete",
            subtitle,
            terrainBanner: bannerContext.terrainBanner,
            terrainBannerFallback: bannerContext.terrainBannerFallback,
            terrainBannerPos: bannerContext.terrainBannerPos ?? "center",
            bannerFireClass,
            showBanner,
            partyStatus,
            incidentsMeta,
            encounters,
            characters,
            freshForageNote: result.summary?.freshForageNote ?? ""
        };
    }

    static #onToggleIdentifyDrawer(event, target) {
        const actorId = target?.dataset?.actorId || target?.closest?.("[data-actor-id]")?.dataset?.actorId;
        if (!actorId) return;

        if (!this._expandedTiers.has(actorId)) {
            this._expandedTiers.set(actorId, new Set());
        }
        const expanded = this._expandedTiers.get(actorId);
        if (expanded.has("identify")) {
            expanded.delete("identify");
        } else {
            expanded.add("identify");
        }
        this.render();
    }

    static async #onStationDetectMagicScan(event, target) {
        const actorId = target?.closest?.(".station-workbench-identify-embed")?.dataset?.workbenchActorId || target?.dataset?.actorId;
        if (!actorId) return;
        await this._detectMagic.castDetectMagic(actorId, getPartyActors);
        if (this._isGM) {
            void this._saveSessionState();
            this._broadcastSync();
        }
    }

    static async #onStationIdentifyScannedItem(event, target) {
        const actorId = target?.closest?.(".station-workbench-identify-embed")?.dataset?.workbenchActorId || target?.dataset?.actorId;
        const itemId = target?.dataset?.itemId;
        if (!actorId || !itemId) return;
        await this._detectMagic.identifyScannedItem(actorId, itemId, getPartyActors);
        if (this._isGM) {
            void this._saveSessionState();
            this._broadcastSync();
        }
    }

    static async #onSubmitWorkbenchIdentify(event, target) {
        const actorId = target?.closest?.(".station-workbench-identify-embed")?.dataset?.workbenchActorId || target?.dataset?.actorId;
        if (!actorId) return;
        await this._workbench.submitFromStation(actorId);
        if (this._isGM) {
            void this._saveSessionState();
            this._broadcastSync();
        }
    }

    static #onWorkbenchIdentifyRemovePotion(event, target) {
        const actorId = target?.closest?.(".station-workbench-identify-embed")?.dataset?.workbenchActorId || target?.dataset?.actorId;
        if (!actorId) return;
        this._workbench.removePotionFromStation(actorId);
        if (this._isGM) {
            void this._saveSessionState();
            this._broadcastSync();
        }
    }

    static async #onDismissWorkbenchIdentifyAck(event, target) {
        const actorId = target?.closest?.(".station-workbench-identify-embed")?.dataset?.workbenchActorId || target?.dataset?.actorId;
        if (!actorId) return;
        const ack = this._workbenchIdentifyAcknowledge?.get(actorId);
        if (!ack || Date.now() < ack.revealAt) return;
        this._workbench.dismissAcknowledgement(actorId);
        if (this._isGM) {
            void this._saveSessionState();
            this._broadcastSync();
        } else {
            emitRestSessionDelta("downtime", "WORKBENCH_ACK_DISMISS", { actorId });
        }
    }
}
