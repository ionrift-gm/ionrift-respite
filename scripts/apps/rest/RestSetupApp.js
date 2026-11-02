import { Logger } from "../../utils/Logger.js";
import { RestFlowEngine, readTerrainBaseDc } from "../../services/rest/flow/RestFlowEngine.js";
import { TerrainRegistry } from "../../services/events/resolve/TerrainRegistry.js";
import { ActivityResolver } from "../../services/rest/flow/ActivityResolver.js";
import { EventResolver } from "../../services/events/resolve/EventResolver.js";
import { countPoolEventsForTerrain } from "../../services/events/catalog/EventCatalogLoader.js";
import { pickPoolEvent } from "../events/AdHocEventDialogs.js";
import { openEventPoolApp } from "../../services/events/catalog/EventPoolMigration.js";
import { CraftingEngine } from "../../services/crafting/engine/CraftingEngine.js";
import { applyCustomRecipesToEngine } from "../../services/crafting/recipes/RecipeCatalog.js";
import { ResourcePoolRoller } from "../../services/rest/recovery/ResourcePoolRoller.js";
import { GrantLedger } from "../../services/crafting/outcomes/GrantLedger.js";
import {
    clearMealExhaustionFloors,
    clearDeprivationExhaustionFloors
} from "../../services/meal/phase/MealExhaustionGuard.js";
import { CampGearScanner } from "../../services/camp/gear/CampGearScanner.js";
import {
    clearCampTokens,
    hasCampfirePlaced,
    resetCampSession,
    getCampSceneId
} from "../../services/camp/props/CompoundCampPlacer.js";
import { CraftingPickerApp } from "../crafting/CraftingPickerApp.js";
import { MonstrousFeastBridge } from "../../services/meal/provisions/MonstrousFeastBridge.js";
import { CraftingDelegate } from "../delegates/crafting/CraftingDelegate.js";
import { MealDelegate } from "../delegates/meal/MealDelegate.js";
import { sustenanceActorId } from "../delegates/meal/SustenanceMeterBinding.js";
import { CopySpellDelegate } from "../delegates/crafting/CopySpellDelegate.js";
import { GatherYieldService } from "../../services/rest/forage/GatherYieldService.js";
import {
    clearGatherDraft,
    dailyChoiceStatus,
    gatherAlreadyResolved,
    publishCampProgress
} from "../../services/rest/session/campProgressState.js";
import { ForageActivityValidator } from "../../services/travel/forage/ForageActivityValidator.js";
import { isForagingEnabled, isHuntingEnabled } from "../../services/travel/settings/TravelSettings.js";
import { RestSetupDebugJumps } from "../delegates/rest/debug/RestSetupDebugJumps.js";
import { CampCeremonyDelegate } from "../delegates/camp/CampCeremonyDelegate.js";
import { CampPlacementDelegate } from "../delegates/camp/CampPlacementDelegate.js";
import { CampLogisticsDelegate, defaultFoodDaysNeeded } from "../delegates/camp/CampLogisticsDelegate.js";
import { RestWindowLayout } from "../delegates/rest/layout/RestWindowLayout.js";
import { RestPrepareContext } from "../delegates/rest/RestPrepareContext.js";
import { RestFlowActions } from "../delegates/rest/flow/RestFlowActions.js";
import { RestSessionDelegate } from "../delegates/rest/flow/RestSessionDelegate.js";
import { TotmActivityDelegate } from "../delegates/rest/activity/TotmActivityDelegate.js";
import { RestTrainingDelegate } from "../delegates/rest/activity/RestTrainingDelegate.js";
import { RestRenderBindings } from "../delegates/rest/layout/RestRenderBindings.js";
import { RestResolveDelegate } from "../delegates/rest/flow/RestResolveDelegate.js";
import { DawnExhaustionDelegate } from "../delegates/rest/flow/DawnExhaustionDelegate.js";
import { MealBuffBeatDelegate } from "../delegates/rest/flow/MealBuffBeatDelegate.js";
import { RestSnapshotSync } from "../delegates/rest/sync/RestSnapshotSync.js";
import { ActivityStationsDelegate } from "../delegates/rest/activity/ActivityStationsDelegate.js";
import { EventsPhaseDelegate } from "../delegates/events/EventsPhaseDelegate.js";
import { WorkbenchDelegate } from "../delegates/crafting/WorkbenchDelegate.js";
import { DetectMagicDelegate, collectPartyIdentifyEmbedData, spawnDetectMagicCastRipple } from "../delegates/crafting/DetectMagicDelegate.js";
import { WEATHER_TABLE, getComfortTip, inferCanvasStationForActivity } from "../../data/RestConstants.js";
import { isComfortEnabled } from "../../services/camp/gear/ComfortCalculator.js";
import { buildCampConditionsBar } from "../../services/camp/gear/CampConditionsBarBuilder.js";
import { deactivateStationLayer } from "../../services/camp/props/StationInteractionLayer.js";
import {
    closeOpenStationDialog,
    StationActivityDialog
} from "../camp/StationActivityDialog.js";
import { CampfireMakeCampDialog } from "../camp/CampfireMakeCampDialog.js";
import { RestLedger } from "../../services/rest/flow/RestLedger.js";
import { RestLedgerApp } from "./RestLedgerApp.js";
import { ShortRestApp } from "./ShortRestApp.js";
import { BivouacApp } from "../bivouac/BivouacApp.js";
import { DowntimeLedgerApp } from "../downtime/DowntimeLedgerApp.js";
import { emitRestSessionStarted } from "../../services/rest/session/RestSessionSync.js";
import {
    registerActiveRestApp,
    clearActiveRestApp,
    retainGmRestAppFooter,
    setActiveRestData,
    _showGmRestIndicator,
    _removeGmRestIndicator,
    _refreshGmRestIndicator
} from "../../module.js";
import { getPartyActors } from "../../services/party/partyActors.js";
import {
    emitRestStarted,
    emitRestSnapshot,
    emitRestResolved,
    emitPhaseChanged,
    emitCampFirewoodPledge,
    emitCampFirewoodReclaim
} from "../../services/socket/SocketController.js";
import { MODULE_ID } from "../../data/moduleId.js";

import { applyRestSetupStateHelpers } from "./RestSetupStateHelpers.js";
import { RestSetupActionHandlers } from "./RestSetupActionHelpers.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * F12: globalThis.DEBUG_IONRIFT_RESITE_SHEET = true logs GM rest sheet render/close/advance.
 */
export function _logGmRestSheet(phase, msg, extra = null) {
    try {
        if (typeof globalThis !== "undefined" && globalThis.DEBUG_IONRIFT_RESITE_SHEET) {
            Logger.log(`${MODULE_ID} | respite GM sheet [${phase}]`, msg, extra ?? "");
        }
    } catch { /* ignore */ }
}

export function _noteEngineFreePath(methodName, app) {
    if (app._engine) return;
        Logger.log(`ionrift-respite | [engine-free] ${methodName} ,  no engine (player client, OK)`);
}

export class RestSetupApp extends HandlebarsApplicationMixin(ApplicationV2) {

    static DEFAULT_OPTIONS = {
        id: "ionrift-respite-setup",
        classes: ["ionrift-window", "glass-ui", "ionrift-respite-app"],
        window: {
            title: "ionrift-respite.restSetup.windowTitle",
            resizable: true
        },
        position: {
            width: 720,
            height: "auto"
        },
        actions: {
            beginRest: RestSetupApp.#onBeginRest,
            beginShortRest: RestSetupApp.#onBeginShortRest,
            submitActivities: RestSetupApp.#onSubmitActivities,
            setFireLevel: RestSetupApp.#onSetFireLevel,
            rollEvents: RestSetupApp.#onRollEvents,
            improviseEvent: RestSetupApp.#onImproviseEvent,
            nightPasses: RestSetupApp.#onNightPasses,
            improviseNight: RestSetupApp.#onImproviseNight,
            pickPoolEvent: RestSetupApp.#onPickPoolEvent,
            setEventsMode: RestSetupApp.#onSetEventsMode,
            commitEventsMode: RestSetupApp.#onCommitEventsMode,
            resolveEvents: RestSetupApp.#onResolveEvents,
            enterDawn: RestSetupApp.#onEnterDawn,
            applyMealBuffs: RestSetupApp.#onApplyMealBuffs,
            applyOneMealBuff: RestSetupApp.#onApplyOneMealBuff,
            continueToNight: RestSetupApp.#onContinueToNight,
            returnToNight: RestSetupApp.#onReturnToNight,
            completeDawn: RestSetupApp.#onCompleteDawn,
            rollActorExhaustionSave: RestSetupApp.#onRollActorExhaustionSave,
            rollAllExhaustionSaves: RestSetupApp.#onRollAllExhaustionSaves,
            waiveAllExhaustionSaves: RestSetupApp.#onWaiveAllExhaustionSaves,
            toggleMustRollExhaustion: RestSetupApp.#onToggleMustRollExhaustion,
            toggleExhaustionOverride: RestSetupApp.#onToggleExhaustionOverride,
            adjustExhaustionDC: RestSetupApp.#onAdjustExhaustionDC,
            adjustAllExhaustionDC: RestSetupApp.#onAdjustAllExhaustionDC,
            setExhaustionAdvMode: RestSetupApp.#onSetExhaustionAdvMode,
            setAllExhaustionAdvMode: RestSetupApp.#onSetAllExhaustionAdvMode,
            cycleExhaustionAdvMode: RestSetupApp.#onCycleExhaustionAdvMode,
            resolveTreeChoice: RestSetupApp.#onResolveTreeChoice,
            applyStallPenalty: RestSetupApp.#onApplyStallPenalty,
            treeDcAdjUp: RestSetupApp.#onTreeDcAdjUp,
            treeDcAdjDown: RestSetupApp.#onTreeDcAdjDown,
            acknowledgeEncounter: RestSetupApp.#onAcknowledgeEncounter,
            openCrafting: RestSetupApp.#onOpenCrafting,
            openCraftingPopout: RestSetupApp.#onOpenCrafting,
            openMonsterCookbook: RestSetupApp.#onOpenMonsterCookbook,
            craftDrawerSelectRecipe: RestSetupApp.#onCraftDrawerSelectRecipe,
            craftDrawerSelectRisk: RestSetupApp.#onCraftDrawerSelectRisk,
            craftDrawerCraft: RestSetupApp.#onCraftDrawerCraft,
            craftDrawerToggleMissing: RestSetupApp.#onCraftDrawerToggleMissing,
            craftDrawerClose: RestSetupApp.#onCraftDrawerClose,
            activityDetailConfirm: RestSetupApp.#onActivityDetailConfirm,
            activityDetailBack: RestSetupApp.#onActivityDetailBack,
            finalize: RestSetupApp.#onFinalize,
            gmOverride: RestSetupApp.#onGmOverride,
            selectRosterCharacter: RestSetupApp.#onSelectRosterCharacter,
            rollExhaustionSave: RestSetupApp.#onRollExhaustionSave,
            toggleShelter: RestSetupApp.#onToggleShelter,
            setupContinue: RestSetupApp.#onSetupContinue,
            setupBack: RestSetupApp.#onSetupBack,
            setupDefaults: RestSetupApp.#onSetupDefaults,
            encounterAdjUp: RestSetupApp.#onEncounterAdjUp,
            encounterAdjDown: RestSetupApp.#onEncounterAdjDown,
            adjustEncounterDc: RestSetupApp.#onAdjustEncounterDc,
            resolveSkillCheck: RestSetupApp.#onResolveSkillCheck,
            lockEventConsequence: RestSetupApp.#onLockEventConsequence,
            adjustEventDc: RestSetupApp.#onAdjustEventDc,
            cycleEventRollMode: RestSetupApp.#onCycleEventRollMode,
            rollEventCheck: RestSetupApp.#onRollEventCheck,
            ionriftRoll: RestSetupApp.#onIonriftRoll,
            rollGather: RestSetupApp.#onRollGather,
            cancelGather: RestSetupApp.#onCancelGather,
            disasterChoice: RestSetupApp.#onDisasterChoice,
            rollCampCheck: RestSetupApp.#onRollCampCheck,
            adjustCampDC: RestSetupApp.#onAdjustCampDC,
            requestCampRoll: RestSetupApp.#onRequestCampRoll,
            grantDiscoveryItem: RestSetupApp.#onGrantDiscoveryItem,
            completeEncounter: RestSetupApp.#onCompleteEncounter,
            detectMagicScan: RestSetupApp.#onDetectMagicScan,
            identifyScannedItem: RestSetupApp.#onIdentifyScannedItem,
            abandonRest: RestSetupApp.#onAbandonRest,
            approveCopySpell: RestSetupApp.#onApproveCopySpell,
            declineCopySpell: RestSetupApp.#onDeclineCopySpell,
            processGmCopySpell: RestSetupApp.#onProcessGmCopySpell,
            dismissGmCopySpell: RestSetupApp.#onDismissGmCopySpell,
            resendCopySpellRoll: RestSetupApp.#onResendCopySpellRoll,
            gmCopySpellFallback: RestSetupApp.#onGmCopySpellFallback,
            rollCopySpellArcana: RestSetupApp.#onRollCopySpellArcana,
            mealSelectFood: RestSetupApp.#onMealSelectFood,
            mealSelectWater: RestSetupApp.#onMealSelectWater,
            proceedFromMeal: RestSetupApp.#onProceedFromMeal,
            submitMealChoices: RestSetupApp.#onSubmitMealChoices,
            consumeMealDay: RestSetupApp.#onConsumeMealDay,
            skipPendingSaves: RestSetupApp.#onSkipPendingSaves,
            hideWindow: RestSetupApp.#onHideWindow,
            rollTreeForPlayer: RestSetupApp.#onRollTreeForPlayer,
            cycleTreeRollMode: RestSetupApp.#onCycleTreeRollMode,
            resendTreeRollRequest: RestSetupApp.#onResendTreeRollRequest,
            rollEventForPlayer: RestSetupApp.#onRollEventForPlayer,
            rollCampForPlayer: RestSetupApp.#onRollCampForPlayer,
            rollTreeCheck: RestSetupApp.#onRollTreeCheck,
            sendTreeRollRequest: RestSetupApp.#onSendTreeRollRequest,
            toggleGmGuidance: RestSetupApp.#onToggleGmGuidance,
            lightCampfire: RestSetupApp.#onLightCampfire,
            campLightFire: RestSetupApp.#onCampLightFire,
            campPledgeFirewood: RestSetupApp.#onCampPledgeFirewood,
            campReclaimFirewood: RestSetupApp.#onCampReclaimFirewood,
            selectCampFireLevel: RestSetupApp.#onSelectCampFireLevel,
            selectCampColdCamp: RestSetupApp.#onSelectCampColdCamp,
            previewCampFireLevel: RestSetupApp.#onPreviewCampFireLevel,
            campColdCamp: RestSetupApp.#onCampColdCamp,
            continueToCampLayout: RestSetupApp.#onContinueToCampLayout,
            proceedFromCamp: RestSetupApp.#onProceedFromMakeCamp,
            proceedFromMakeCamp: RestSetupApp.#onProceedFromMakeCamp,
            clearAllCampScene: RestSetupApp.#onClearAllCampScene,
            clearMyCampGear: RestSetupApp.#onClearMyCampGear,
            reclaimCampGear: RestSetupApp.#onReclaimCampGear,
            reclaimCampStation: RestSetupApp.#onReclaimCampStation,
            reclaimCampfire: RestSetupApp.#onReclaimCampfire,
            exitStationChoiceReview: RestSetupApp.#onExitStationChoiceReview,
            dismissCampfireCanvasPanel: RestSetupApp.#onDismissCampfireCanvasPanel,
            retryCampPitPlacement: RestSetupApp.#onRetryCampPitPlacement,
            dismissEventPoolNudge: RestSetupApp.#onDismissEventPoolNudge,
            openEventPoolCurator: RestSetupApp.#onOpenEventPoolCurator,
            selectTotmActivity: RestSetupApp.#onSelectTotmActivity,
            confirmTotmFollowUp: RestSetupApp.#onConfirmTotmFollowUp,
            cancelTotmFollowUp: RestSetupApp.#onCancelTotmFollowUp,
            unlockTotmActivity: RestSetupApp.#onUnlockTotmActivity,
            unlockSustenance: RestSetupApp.#onUnlockSustenance,
            proceedFromTotmCamp: RestSetupApp.#onProceedFromMakeCamp,
            switchTotmTab: RestSetupApp.#onSwitchTotmTab,
            submitWorkbenchIdentify: RestSetupApp.#onSubmitWorkbenchIdentifyTotm,
            dismissWorkbenchIdentifyAck: RestSetupApp.#onDismissWorkbenchIdentifyAckTotm,
            stationDetectMagicScan: RestSetupApp.#onDetectMagicScanTotm,
            craftSelectRecipe: RestSetupApp.#onTotmCraftSelectRecipe,
            craftSelectRisk: RestSetupApp.#onTotmCraftSelectRisk,
            craftCommit: RestSetupApp.#onTotmCraftCommit,
            craftToggleMissing: RestSetupApp.#onTotmCraftToggleMissing,
            craftClose: RestSetupApp.#onTotmCraftClose,
            feastServeNow: RestSetupApp.#onTotmFeastServeNow,
            trainingRoll: RestSetupApp.#onTrainingRoll,
            openLedger: RestSetupApp.#onOpenLedger,
            toggleLogisticsDrawer: RestSetupApp.#onToggleLogisticsDrawer,
            adjustSustenanceDC: RestSetupApp.#onAdjustSustenanceDC,
            stepFoodDays: RestSetupApp.#onStepFoodDays,
            giftWood: RestSetupApp.#onGiftWood,
            toggleGearFactor: RestSetupApp.#onToggleGearFactor,
            switchWorkflow: RestSetupApp.#onSwitchWorkflow,
            toggleExamine: RestSetupApp.#onToggleExamine,
            skipGather: RestSetupApp.#onSkipGather,
            confirmGatherSkip: RestSetupApp.#onConfirmGatherSkip,
            toggleCharacterReady: RestSetupApp.#onToggleCharacterReady,
            clearSustenanceFood: RestSetupApp.#onClearSustenanceFood,
            assignSustenanceFood: RestSetupApp.#onAssignSustenanceFood,
            clearSustenanceWater: RestSetupApp.#onClearSustenanceWater,
            assignSustenanceWater: RestSetupApp.#onAssignSustenanceWater,
            toggleDevRestVariant: RestSetupApp.#onToggleDevRestVariant,
            toggleUiTheme: RestSetupApp.#onToggleUiTheme
        }
    };

    static PARTS = {
        "rest-setup": {
            template: `modules/${MODULE_ID}/templates/rest-setup.hbs`
        }
    };

    /** Legacy activeRest/broadcast shape; fire level is canonical (minigame removed). */
    static _campfireSnapshotFromFireLevel(fireLevel) {
        return CampCeremonyDelegate.campfireSnapshotFromFireLevel(fireLevel);
    }

    constructor(options = {}, restData = null) {
        super(options);
        this._isGM = game.user.isGM;
        this._phase = restData?.phase ?? (restData ? "activity" : "setup");
        if (this._isGM && this._phase !== "setup") {
            registerActiveRestApp(this);
        }
        this._restVariant = game.ionrift?.respite?.adapter?.getRestVariant?.() ?? "normal";
        const supportsShortRest = game.ionrift?.respite?.adapter?.supportsShortRest ?? true;
        const requestedRestType = options.restType ?? (restData?.restType ?? "long");
        this._selectedRestType = (!supportsShortRest && requestedRestType === "short") ? "long" : requestedRestType;
        // Setup screen default: always 1 day.
        this._daysSinceLastRest = 1;
        this._engine = null;
        this._activityResolver = new ActivityResolver();
        this._eventResolver = new EventResolver();
        this._craftingEngine = new CraftingEngine();
        this._poolRoller = new ResourcePoolRoller();
        this._outcomes = [];
        this._triggeredEvents = [];
        this._activeTreeState = null;
        /** @type {"random"|"improvise"|"pick"} */
        this._eventsMode = "random";
        this._eventsCommitPending = false;
        this._craftingResults = new Map();
        this._fireLevel = "unlit";
        this._campFirePreviewLevel = null;
        this._stationFirePreviewLevel = null;
        this._campFireWoodSpendUserId = null;
        this._fireLitBy = null;
        this._firewoodPledges = new Map();
        /** Staged kindling; spent on Proceed, not on light. */
        this._makeCampStagedWood = [];
        this._makeCampStagedWoodTier = null;
        this._coldCampDecided = false;
        this._campPitCursorInFlight = false;
        this._campPitPlacementCancelled = false;
        this._campPitPickerCancel = null;
        this._campPlaceholdersEnsured = false;
        this._campToActivityDone = false;
        this._campStep2Entered = false;
        this._campfireApp = null;
        /** @type {"camp"|"totm"|"station"|null} */
        this._campfireEmbedHost = null;
        /** @type {import("../camp/StationActivityDialog.js").StationActivityDialog|null} */
        this._stationFireMinigameDialog = null;
        this._selectedCharacterId = null;
        this._finishedActorIds = new Set();
        this._gatherSkipIds = new Set();
        /** @type {Map<string, "act_forage"|"act_hunt">} */
        this._gatherChoices = new Map();
        /** @type {Map<string, { activityId: string, haul: string, success: boolean }>} */
        this._gatherResults = new Map();
        this._activitySubTab = "identify"; // identify | activity | meal
        /** @type {"activities"|"identify"|"fire"} */
        this._totmActiveTab = "activities";
        this._canvasFocusedStationId = null;
        this._gmControlTokenHook = null;
        this._activityMealRationsSubmitted = new Set();
        this._workbenchIdentifyStaging = new Map();
        this._workbenchIdentifyAcknowledge = new Map();
        this._workbenchFocusUsed = new Set();
        this._gmMinimizedToFooter = false;
        this._postStationChoiceReview = false;
        this._stationReviewCharacterId = null;
        this._boundCampCanvasDrop = this._onCampCanvasDrop.bind(this);
        // Foundry only fires drop when dragover preventDefaults.
        this._boundCampCanvasDragOver = (event) => {
            event.preventDefault();
            if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
        };

        this._craftingDrawerOpen = false;
        this._craftingDrawerProfession = null;
        this._craftingDrawerRecipeId = null;
        this._craftingDrawerRisk = "standard";
        this._craftingDrawerResult = null;
        this._craftingDrawerHasCrafted = false;
        this._craftingDrawerShowMissing = false;

        this._activityDetailId = null;
        this._totmFollowUpExpanded = null;
        this._restWindowResizeObserver = null;
        this._restWindowRecenterPending = false;
        this._restWindowUserPositioned = false;
        this._lastRenderedPhase = undefined;
        this._restWindowRecenterSuppressed = 0;
        this._safeRestPulseAlert = false;
        /** Forces TotM for this rest only; never writes restInterfaceMode. */
        this._tavernTotmOverride = false;
        this._commitMakeCampCeremonyInFlight = false;

        this._characterChoices = new Map();
        this._stationCanvasIdByCharacter = new Map();
        this._earlyResults = new Map();
        this._trainingStates = new Map();
        this._playerSubmissions = new Map();
        this._gmOverrides = new Map();
        this._gmFollowUps = new Map();
        this._lockedCharacters = new Set();

        this._grantLedger = new GrantLedger();
        this._restLedger = new RestLedger();
        /** @type {RestLedgerApp|null} */
        this._restLedgerApp = null;

        this._crafting = new CraftingDelegate(this);
        this._meals = new MealDelegate(this);
        this._copySpell = new CopySpellDelegate(this);
        this._campCeremony = new CampCeremonyDelegate(this);
        this._campPlacement = new CampPlacementDelegate(this);
        this._windowLayout = new RestWindowLayout(this);
        this._prepareCtx = new RestPrepareContext(this);
        this._flowActions = new RestFlowActions(this);
        this._session = new RestSessionDelegate(this);
        this._totm = new TotmActivityDelegate(this);
        this._training = new RestTrainingDelegate(this);
        this._renderBindings = new RestRenderBindings(this);
        this._resolve = new RestResolveDelegate(this);
        this._exhaustionDraft = new Map();
        this._expandedExhaustionOverrides = new Set();
        this._dawn = new DawnExhaustionDelegate(this);
        this._mealBuffQueue = [];
        this._mealBuffs = new MealBuffBeatDelegate(this);
        this._sync = new RestSnapshotSync(this);
        this._stations = new ActivityStationsDelegate(this);
        this._events = new EventsPhaseDelegate(this);
        this._workbench = new WorkbenchDelegate(this);
        this._detectMagic = new DetectMagicDelegate(this);
        this._campLogistics = new CampLogisticsDelegate(this);
        if (!this._isGrittyLong) {
            this._campLogistics._foodDaysNeeded = defaultFoodDaysNeeded(false);
        }

        this._restData = restData;
        if (restData) {
            this._restId = restData.restId ?? null;
            if (restData.phase) this._phase = restData.phase;
            if (restData.fireLevel) this._fireLevel = restData.fireLevel;
            if (restData.coldCampDecided !== undefined) {
                this._coldCampDecided = !!restData.coldCampDecided;
            }
            this._selectedTerrain = restData.terrainTag ?? null;
            this._selectedRestType = restData.restType ?? "long";
            this._activities = restData.activities ?? [];
            this._activityResolver.load(this._activities);
            if (restData.recipes) {
                for (const [profId, recipeList] of Object.entries(restData.recipes)) {
                    this._craftingEngine.load(profId, recipeList);
                }
                // Snapshot may predate mid-rest homebrew edits; world settings win.
                applyCustomRecipesToEngine(this._craftingEngine);
            }
            // Player clone: engine needed so comfort/fire do not fall back to terrain defaults.
            this._engine = new RestFlowEngine({
                restType: restData.restType ?? "long",
                terrainTag: restData.terrainTag ?? "forest",
                comfort: restData.comfort ?? "rough",
                safeRestSpot: restData.safeRestSpot ?? false
            });
            if (restData.tavernTotmOverride) {
                this._tavernTotmOverride = true;
            } else if (restData.terrainTag === "tavern") {
                this._applyTavernTotmOverrideForRestStart("tavern");
            }
            if (restData.fireLevel) {
                this._engine.fireLevel = restData.fireLevel;
            }
            if (restData.travelGather && typeof restData.travelGather === "object") {
                this._syncedTravelGather = { ...restData.travelGather };
            }
            this._myCharacterIds = new Set(
                game.actors.filter(a => a.hasPlayerOwner && a.isOwner && a.type === "character")
                    .map(a => a.id)
            );
        } else {
            this._dataReady = this._loadData();
        }

        this._debugJumps = new RestSetupDebugJumps(this, {
            registerActiveRestApp,
            setActiveRestData,
            emitRestStarted,
            emitRestSnapshot,
            emitPhaseChanged
        });
        if (!game.ionrift) game.ionrift = {};
        if (!game.ionrift.respite) game.ionrift.respite = {};

        game.ionrift.respite.jumpToResolution = () => this._debugJumps.jumpToResolution();
        game.ionrift.respite.jumpToEncounter = () => this._debugJumps.jumpToEncounter();
        game.ionrift.respite.jumpToDisaster = () => this._debugJumps.jumpToDisaster();
        game.ionrift.respite.jumpToRecoveryPenalty = () => this._debugJumps.jumpToRecoveryPenalty();
        game.ionrift.respite.jumpToDamageTest = () => this._debugJumps.jumpToDamageTest();
        game.ionrift.respite.jumpToHostileComfort = () => this._debugJumps.jumpToHostileComfort();
        game.ionrift.respite.jumpToSingleEvent = () => this._debugJumps.jumpToSingleEvent();
        game.ionrift.respite.jumpToNights = () => this._debugJumps.jumpToNights();
        game.ionrift.respite.jumpToExhaustion = () => this._debugJumps.jumpToExhaustion();
        game.ionrift.respite.jumpToLosses = () => this._debugJumps.jumpToLosses();
        game.ionrift.respite.fillRestParty = () => RestSetupDebugJumps.fillRestParty();
        game.ionrift.respite.addSupplies = (qty = 50) => RestSetupDebugJumps.addSupplies(qty);
        game.ionrift.respite.toggleRestVariant = () => this.toggleDevRestVariant();

        this._inventoryDebounce = null;
        this._inventoryHookHandler = (item) => {
            if (this._phase !== "meal") return;
            if (this._inventoryDebounce) clearTimeout(this._inventoryDebounce);
            this._inventoryDebounce = setTimeout(() => {

                Logger.log(`${MODULE_ID} | Inventory changed (${item?.name}), refreshing meal panel`);
                this.render();
            }, 500);
        };
        this._inventoryHookIds = [
            Hooks.on("createItem", this._inventoryHookHandler),
            Hooks.on("deleteItem", this._inventoryHookHandler),
            Hooks.on("updateItem", this._inventoryHookHandler)
        ];
    }

    /** True when this session is a Gritty Realism 7-day long rest. */
    get _isGrittyLong() {
        return (this._restVariant ?? "normal") === "gritty" && (this._selectedRestType ?? "long") !== "short";
    }

    /** TotM when override, gritty long rest, or restInterfaceMode === "theater"; unset setting falls back to theater. */
    get _isTotM() {
        if (this._tavernTotmOverride) return true;
        if (this._isGrittyLong) return true;
        try { return game.settings.get(MODULE_ID, "restInterfaceMode") === "theater"; }
        catch { return true; }
    }


    async close(options = {}) {

        CampfireMakeCampDialog.closeIfOpen();
        this._cancelCampPlacementCanvasMode();
        this._tearDownCampfireEmbed();
        await closeOpenStationDialog();
        if (this._isGM) {
            // Resolution phase: closing the window (X, Escape, or close()) breaks camp and posts to chat
            if (this._phase === "resolve" && !options.abandoned) {
                options.resolved = true;
            }

            // Mid-rest (camp, activity, events, etc.): X minimizes to the status bar. No modal.
            // Setup: closes app; Resolve: breaks camp and posts to chat; Mid-rest: minimizes to status bar indicator.
            const restActive = this._phase && this._phase !== "resolve" && this._phase !== "setup";
            if (options?.retainGmRestApp) {
                this._gmMinimizedToFooter = true;
                retainGmRestAppFooter();
                _showGmRestIndicator(this);
            } else if (restActive && !options.resolved) {
                this._gmMinimizedToFooter = true;
                _showGmRestIndicator(this);
            } else {
                this._gmMinimizedToFooter = false;
                if (options.resolved && !options.abandoned) {
                    if (this._phase === "resolve" && !this._masterCardPosted) {
                        try {
                            await this._resolve?.postMasterRestCard?.();
                        } catch (err) {
                            console.warn(`${MODULE_ID} | Failed to post master rest card:`, err);
                        }
                    }
                    await this._clearRestState();
                    clearMealExhaustionFloors();
                    await clearDeprivationExhaustionFloors(getPartyActors());
                    emitRestResolved();
                    clearCampTokens(getCampSceneId()).catch(err => console.warn(`${MODULE_ID} | Camp cleanup failed:`, err));
                    resetCampSession();
                    Hooks.callAll("ionrift.respite.restCleanup");
                }
                if (options.abandoned) {
                    this._terminated = true;
                    this._abandoned = true;
                    this._engine = null;
                    await this._removeBeddingDown();
                    await this._clearRestState();
                    Hooks.callAll("ionrift.respite.restCleanup");
                }
                this._tearDownStationLayerCanvas();
                this._removeGmStationTokenSyncHook();
                if (!options.abandoned) this._clearDetectMagicScanSession();
                if (!options?.retainGmRestApp) {
                    clearActiveRestApp();
                } else {
                    retainGmRestAppFooter();
                }
                _removeGmRestIndicator();
            }
        }
        if (this._inventoryHookIds) {
            Hooks.off("createItem", this._inventoryHookIds[0]);
            Hooks.off("deleteItem", this._inventoryHookIds[1]);
            Hooks.off("updateItem", this._inventoryHookIds[2]);
            this._inventoryHookIds = null;
        }
        // Tear down the body-level GM guidance flyout so it doesn't linger over the canvas
        document.getElementById("ionrift-gm-guidance-flyout")?.remove();
        this._disposeRestWindowResizeObserver();
        this._restWindowUserPositioned = false;
        this._lastRenderedPhase = undefined;
        return super.close(options);
    }

    _campRestWindowTargetWidth() { return this._windowLayout.campRestWindowTargetWidth(...arguments); }
    buildCampfireDrawerContextForMapDialog() { return this._campCeremony.buildCampfireDrawerContextForMapDialog(); }
    runMakeCampLightFireFromUi(event, target) { return RestSetupApp.#onCampLightFire.call(this, event, target); }
    runMakeCampPledgeFromUi(event, target) { return RestSetupApp.#onCampPledgeFirewood.call(this, event, target); }
    runMakeCampReclaimFromUi() { return RestSetupApp.#onCampReclaimFirewood.call(this, new Event("click"), null); }
    runMakeCampColdFromUi() { return RestSetupApp.#onSelectCampColdCamp.call(this, new Event("click"), null); }
    runMakeCampConfirmColdFromUi() { return RestSetupApp.#onConfirmCampColdCamp.call(this, new Event("click"), null); }
    runMakeCampSelectFireLevelFromUi(event, target) { return RestSetupApp.#onSelectCampFireLevel.call(this, event, target); }
    _buildEncounterPlayerFactors(params) { return this._campCeremony._buildEncounterPlayerFactors(params); }
    _buildArmorWarningForActor(a) { return this._stations._buildArmorWarningForActor(a); }
    _buildActivityDetailContext(selectedCharacter) { return this._stations._buildActivityDetailContext(selectedCharacter); }
    _formatCheckLabel(check, character) { return this._session._formatCheckLabel(check, character); }
    getCampGearContextForActor(actorId) { return this._stations.getCampGearContextForActor(actorId); }
    getCampGearFlavorPanelForActor(actorId) { return this._stations.getCampGearFlavorPanelForActor(actorId); }
    _getCampScanDataForActivityStationDialog() { return this._session._getCampScanDataForActivityStationDialog(); }
    getFireTabContextForStationDialog() { return this._campCeremony.getFireTabContextForStationDialog(); }
    getCampPersonalCardForActor(actorId) { return this._campCeremony.getCampPersonalCardForActor(actorId); }
    _buildResolutionCards(outcomes) { return this._resolve._buildResolutionCards(outcomes); }
    _findIncompleteTrainingCharacterId() { return this._session._findIncompleteTrainingCharacterId(); }
    _buildTrainingViewContext(characterId) { return this._training._buildTrainingViewContext(characterId); }
    _activityFireUiEnabled() { return this._campCeremony._activityFireUiEnabled(...arguments); }
    _pickPitWorldPoint(options = {}) { return this._campPlacement._pickPitWorldPoint(...arguments); }

    static #onToggleShelter(event, target) { return RestSetupActionHandlers.onToggleShelter.call(this, event, target); }
    static #onSetupContinue(event, target) { this._session.onSetupContinue(event, target); }
    static #onSetupBack(event, target) { return RestSetupActionHandlers.onSetupBack.call(this, event, target); }
    static async #onToggleDevRestVariant(event, target) { return RestSetupActionHandlers.onToggleDevRestVariant.call(this, event, target); }
    async toggleDevRestVariant() { return RestSetupApp.#onToggleDevRestVariant.call(this, null, null); }
    static #onSetupDefaults(event, target) { return RestSetupActionHandlers.onSetupDefaults.call(this, event, target); }
    static #onEncounterAdjUp(event, target) { return RestSetupActionHandlers.onEncounterAdjUp.call(this, event, target); }
    static #onEncounterAdjDown(event, target) { return RestSetupActionHandlers.onEncounterAdjDown.call(this, event, target); }
    static #onAdjustEncounterDc(event, target) { return RestSetupActionHandlers.onAdjustEncounterDc.call(this, event, target); }
    static async #onRollCampCheck(event, target) { return this._events.onRollCampCheck(event, target); }
    static #onAdjustCampDC(event, target) { return RestSetupActionHandlers.onAdjustCampDC.call(this, event, target); }
    static #onRequestCampRoll(event, target) { this._events.onRequestCampRoll(event, target); }
    async receiveCampRollResult(data) { await this._events.receiveCampRollResult(data); }
    static #onAdjustEventDc(event, target) { return RestSetupActionHandlers.onAdjustEventDc.call(this, event, target); }
    static #onCycleEventRollMode(event, target) { this._events.onCycleEventRollMode(event, target); }
    static async #onResolveSkillCheck(event, target) { return this._flowActions.onResolveSkillCheck(event, target); }
    static async #onLockEventConsequence(event, target) { return this._flowActions.onLockEventConsequence(event, target); }
    static async #evaluateLockCount(countSpec, poolSize) { return RestSetupActionHandlers.evaluateLockCount(countSpec, poolSize); }
    static #pickRandomN(pool, n) { return RestSetupActionHandlers.pickRandomN(pool, n); }
    async receiveRollResult(data) { return this._events.receiveRollResult(data); }
    receiveRollRequest(data) { return this._events.receiveRollRequest(data); }
    receiveTreeRollRequest(data) { return this._events.receiveTreeRollRequest(data); }
    static async #onRollTreeCheck(event, target) { return this._flowActions.onRollTreeCheck(event, target); }
    static #formatGmGuidance(text) { return RestSetupActionHandlers.formatGmGuidance(text); }
    static #openGmGuidanceFlyout(triggerEl, guidanceHtml) { this._events.openGmGuidanceFlyout(triggerEl, guidanceHtml); }
    static #onToggleGmGuidance(event, target) { this._events.onToggleGmGuidance(event, target); }

    /** @override */
    async render(options = {}) {
        const phaseChanged = this._lastRenderedPhase !== undefined && this._lastRenderedPhase !== this._phase;
        if (phaseChanged) {
            this._restWindowUserPositioned = false;
        }
        this._lastRenderedPhase = this._phase;
        const preservePos = this._restWindowUserPositioned && this.rendered && this.element;
        let savedPos = null;
        if (preservePos) {
            const rect = this.element.getBoundingClientRect();
            savedPos = {
                left: Math.round(rect.left),
                top: Math.round(rect.top),
                width: this.element.offsetWidth || this.position?.width
            };
            if (typeof this.position.height === "number") savedPos.height = this.position.height;
        }
        const result = await super.render(options);
        if (savedPos && Number.isFinite(savedPos.left) && Number.isFinite(savedPos.top)) {
            this.setPosition(savedPos);
        }
        return result;
    }

    static async #onIonriftRoll(event, target) { return this._events.onIonriftRoll(event, target); }
    static async #onRollGather(event, target) { return this._totm.onRollGather(event, target); }
    static #onCancelGather() { return RestSetupActionHandlers.onCancelGather.call(this); }
    static async #onRollEventCheck(event, target) { return this._events.onRollEventCheck(event, target); }
    static async #onGrantDiscoveryItem(event, target) { return this._events.onGrantDiscoveryItem(event, target); }
    static async _applyTrainingXP(outcomes) { return this._session._applyTrainingXP(outcomes); }
    static _buildTrainingProgressBar(training) { return RestSetupActionHandlers._buildTrainingProgressBar(training); }
    static async #onBeginShortRest(event, target) { return this._launchShortRestFromSetup(); }

    /** Sole launch point for a short rest, for both the short and long submit paths. */
    async _launchShortRestFromSetup() {
        if (game.ionrift?.respite?.adapter?.supportsShortRest === false) return;
        const form = this.element?.querySelector("form");
        const formData = form ? Object.fromEntries(new FormData(form)) : {};
        const terrainTag = formData.terrain ?? this._selectedTerrain ?? "forest";
        game.settings.set(MODULE_ID, "lastTerrain", terrainTag);

        if (this._restVariant === "gritty") {
            const isSafeRest = !!(formData.safeRestSpot || this._effectiveSafeRestSpot?.() || terrainTag === "tavern");
            await this._loadTerrainEvents(terrainTag);
            const dangerDC = readTerrainBaseDc(this._eventResolver, terrainTag);
            await this.close({});
            game.settings.set(MODULE_ID, "activeRest", {}).catch(() => {});
            new BivouacApp({ terrainTag, safePassage: isSafeRest, dangerDC }).render({ force: true });
            emitRestSessionStarted("bivouac", { terrainTag, safePassage: isSafeRest, dangerDC });
            return;
        }

        const activeShelter = Object.entries(this._shelterOverrides ?? {})
            .find(([, v]) => v)?.[0] ?? "none";
        await this.close({});
        new ShortRestApp({ initialShelter: activeShelter }).render({ force: true });
    }

    static async #onBeginRest(event, target) { return this._flowActions.onBeginRest(event, target); }


    static #onGmOverride(event, target) { this._events.onGmOverride(event, target); }
    static #onSelectRosterCharacter(event, target) { return RestSetupActionHandlers.onSelectRosterCharacter.call(this, event, target); }
    static async #onRollExhaustionSave(event, target) { return RestSetupActionHandlers.onRollExhaustionSave.call(this, event, target); }
    openCraftingDrawer(event, target) { return RestSetupApp.#onOpenCrafting.call(this, event, target); }
    static #onOpenCrafting(event, target) { this._stations.onOpenCrafting(event, target); }
    static #onOpenMonsterCookbook(event, target) { return RestSetupActionHandlers.onOpenMonsterCookbook.call(this, event, target); }
    static #onCraftDrawerSelectRecipe(event, target) { this._crafting.onSelectRecipe(event, target); }
    static #onCraftDrawerSelectRisk(event, target) { this._crafting.onSelectRisk(event, target); }
    static async #onCraftDrawerCraft(event, target) { await this._crafting.onCraft(event, target); }
    static #onCraftDrawerToggleMissing(event, target) { this._crafting.onToggleMissing(event, target); }
    static #onCraftDrawerClose(event, target) { this._crafting.onClose(event, target); }
    static #onActivityDetailConfirm(event, target) { this._flowActions.onActivityDetailConfirm(event, target); }
    static #onActivityDetailBack(event, target) { return RestSetupActionHandlers.onActivityDetailBack.call(this, event, target); }
    static async #onSubmitActivities(event, target) { return this._flowActions.onSubmitActivities(event, target); }
    static _formatCampFirewoodDonors(names) { return CampCeremonyDelegate.formatCampFirewoodDonors(names); }
    static async #onSetFireLevel(event, target) { return await this._campCeremony.onSetFireLevel(...arguments); }
    static #onMealSelectFood(event, target) { this._meals.onSelectFood(event, target); }
    static #onMealSelectWater(event, target) { this._meals.onSelectWater(event, target); }
    static async #onConsumeMealDay(event, target) { await this._meals.onConsumeMealDay(event, target); }
    static async #onSubmitMealChoices(event, target) { return RestSetupActionHandlers.onSubmitMealChoices.call(this, event, target); }
    static async #onProceedFromMeal(event, target) { await this._meals.onProceedFromMeal(event, target); }
    static async #onSkipPendingSaves(event, target) { await this._meals.onSkipPendingSaves(event, target); }
    static #beginEventsCommit() { return this._events.beginEventsCommit(...arguments); }
    static #endEventsCommit() { return this._events.endEventsCommit(...arguments); }
    static async #onRollEvents(event, target) { return await this._events.onRollEvents(...arguments); }
    static async #finalizeEventsRoll() { return await this._events.finalizeEventsRoll(...arguments); }
    static async #onImproviseEvent(event, target) { return await this._events.onImproviseEvent(...arguments); }
    static async #onNightPasses(event, target) { return await this._events.onNightPasses(...arguments); }
    static async #onImproviseNight(event, target) { return await this._events.onImproviseNight(...arguments); }
    static async #onPickPoolEvent(event, target) { return await this._events.onPickPoolEvent(...arguments); }
    static async #onSetEventsMode(event, target) { return await this._events.onSetEventsMode(...arguments); }
    static async #onCommitEventsMode(event, target) { return await this._events.onCommitEventsMode(...arguments); }
    static async #onAcknowledgeEncounter(event, target) { return await this._events.onAcknowledgeEncounter(...arguments); }
    static async #onCompleteEncounter(event, target) { return await this._events.onCompleteEncounter(...arguments); }
    static #onHideWindow(event, target) { return RestSetupActionHandlers.onHideWindow.call(this, event, target); }
    static async #onExitStationChoiceReview(event, target) { return RestSetupActionHandlers.onExitStationChoiceReview.call(this, event, target); }
    static async #onDetectMagicScan(event, target) { return RestSetupActionHandlers.onDetectMagicScan.call(this, event, target); }
    static async #onIdentifyScannedItem(event, target) { return RestSetupActionHandlers.onIdentifyScannedItem.call(this, event, target); }
    static async #onAbandonRest(event, target) { return this._resolve.onAbandonRest(event, target); }
    static #onApproveCopySpell(event, target) { this._copySpell.onApprove(event, target); }
    static #onDeclineCopySpell(event, target) { this._copySpell.onDecline(event, target); }
    static async #onProcessGmCopySpell(event, target) { await this._copySpell.onProcessGm(event, target); }
    static async #onDismissGmCopySpell(event, target) { await this._copySpell.onDismiss(event, target); }
    static #onResendCopySpellRoll(event, target) { this._copySpell.onResendRoll(event, target); }
    static async #onGmCopySpellFallback(event, target) { await this._copySpell.onGmFallback(event, target); }
    static async #onRollCopySpellArcana(event, target) { await this._copySpell.onRollArcana(event, target); }
    static async #onDisasterChoice(event, target) { return await this._events.onDisasterChoice(...arguments); }
    static async #onResolveTreeChoice(event, target) { return await this._events.onResolveTreeChoice(...arguments); }
    static async #onSendTreeRollRequest(event, target) { return await this._events.onSendTreeRollRequest(...arguments); }
    static async #onRollTreeForPlayer(event, target) { return await this._events.onRollTreeForPlayer(...arguments); }
    static #onResendTreeRollRequest(event, target) { return this._events.onResendTreeRollRequest(...arguments); }
    static #onCycleTreeRollMode(event, target) { return this._events.onCycleTreeRollMode(...arguments); }
    static #broadcastTreeRollModes() { return this._events.broadcastTreeRollModes(...arguments); }
    static async #onRollEventForPlayer(event, target) { return await this._events.onRollEventForPlayer(...arguments); }
    static async #onRollCampForPlayer(event, target) { return this._events.onRollCampForPlayer(event, target); }
    static async #onApplyStallPenalty(event, target) { return await this._events.onApplyStallPenalty(...arguments); }
    static #onTreeDcAdjUp(event, target) { return this._events.onTreeDcAdjUp(...arguments); }
    static #onTreeDcAdjDown(event, target) { return this._events.onTreeDcAdjDown(...arguments); }
    static async #showResourceLossApproval(unified) { return this._resolve.showResourceLossApproval(unified); }
    static #rehydrateItemLossProposal(eff) { return this._events.rehydrateItemLossProposal(eff); }
    static async #onResolveEvents(event, target) { return this._resolve.onResolveEvents(event, target); }
    static async #onEnterDawn(event, target) { return this._dawn.enterDawn(); }
    static async #onApplyMealBuffs(event, target) { return this._mealBuffs.applyAll(); }
    static async #onApplyOneMealBuff(event, target) { return this._mealBuffs.applyOne(target?.dataset?.rowId); }
    static async #onContinueToNight(event, target) { return this._mealBuffs.continueToNight(); }
    static async #onReturnToNight(event, target) { return this._dawn.returnToNight(); }
    static async #onCompleteDawn(event, target) { return this._dawn.completeDawn(event, target); }
    static async #onRollActorExhaustionSave(event, target) { return this._dawn.rollActor(target?.dataset?.actorId); }
    static async #onRollAllExhaustionSaves(event, target) { return this._dawn.rollAll(); }
    static #onWaiveAllExhaustionSaves(event, target) { return this._dawn.waiveAll(); }
    static #onToggleMustRollExhaustion(event, target) {
        const input = target?.matches?.("input") ? target : target?.querySelector?.("input");
        return this._dawn.toggleMustRoll(target?.dataset?.actorId, input?.checked ?? target?.checked);
    }
    static #onToggleExhaustionOverride(event, target) { return this._dawn.toggleOverride(target?.dataset?.actorId); }
    static #onAdjustExhaustionDC(event, target) { return this._dawn.adjustDc(target?.dataset?.actorId, Number(target?.dataset?.delta)); }
    static #onAdjustAllExhaustionDC(event, target) { return this._dawn.adjustAllDc(Number(target?.dataset?.delta)); }
    static #onSetExhaustionAdvMode(event, target) { return this._dawn.setAdvMode(target?.dataset?.actorId, target?.dataset?.mode); }
    static #onSetAllExhaustionAdvMode(event, target) { return this._dawn.setAllAdvMode(target?.dataset?.mode); }
    static #onCycleExhaustionAdvMode(event, target) { return this._dawn.cycleAdvMode(target?.dataset?.actorId); }
    static async #onFinalize(event, target) { return this._events.onFinalize(event, target); }
    static #onOpenLedger(event, target) { return RestSetupActionHandlers.onOpenLedger.call(this, event, target); }
    static #onToggleLogisticsDrawer(event, target) { return RestSetupActionHandlers.onToggleLogisticsDrawer.call(this, event, target); }
    static #onAdjustSustenanceDC(event, target) { return RestSetupActionHandlers.onAdjustSustenanceDC.call(this, event, target); }
    static #onStepFoodDays(event, target) { return RestSetupActionHandlers.onStepFoodDays.call(this, event, target); }
    static async #onGiftWood(event, target) { return RestSetupActionHandlers.onGiftWood.call(this, event, target); }
    static #onToggleGearFactor(event, target) { return RestSetupActionHandlers.onToggleGearFactor.call(this, event, target); }
    static async #onTrainingRoll(event, target) { return this._training.onTrainingRoll(event, target); }
    static _inferCanvasStationForActivity(activityId, actorId = null) { return inferCanvasStationForActivity(activityId, actorId); }
    static _resolveStationActorForUser(partyActors, restApp = null) { return ActivityStationsDelegate.resolveStationActorForUser(partyActors, restApp); }
    static async #onLightCampfire(event, target) { await RestSetupApp.#onSelectCampFireLevel.call(this, event, { dataset: { fireLevel: "campfire" } }); }
    static async #onCampLightFire(event, target) { return this._session.onCampLightFire(event, target); }
    static async #onCampPledgeFirewood(event, target) { return RestSetupActionHandlers.onCampPledgeFirewood.call(this, event, target); }
    static async #onCampReclaimFirewood(event, target) { return RestSetupActionHandlers.onCampReclaimFirewood.call(this, event, target); }
    static async #onSelectCampFireLevel(event, target) { return await this._campPlacement.onSelectCampFireLevel(...arguments); }
    static async #onDismissCampfireCanvasPanel() { return RestSetupActionHandlers.onDismissCampfireCanvasPanel.call(this); }
    static async #onRetryCampPitPlacement() { return await this._campPlacement.onRetryCampPitPlacement(...arguments); }
    static async #onDismissEventPoolNudge(event, target) { return RestSetupActionHandlers.onDismissEventPoolNudge.call(this, event, target); }
    static #onOpenEventPoolCurator(event, target) { return RestSetupActionHandlers.onOpenEventPoolCurator.call(this, event, target); }
    static async #onSelectTotmActivity(event, target) { return this._totm.onSelectTotmActivity(event, target); }
    static async #onConfirmTotmFollowUp(event, target) { return this._totm.onConfirmTotmFollowUp(event, target); }
    static #onCancelTotmFollowUp() { this._totm.onCancelTotmFollowUp(); }
    static async #onUnlockTotmActivity(event, target) { return this._totm.onUnlockTotmActivity(event, target); }
    static async #onUnlockSustenance(event, target) { return RestSetupActionHandlers.onUnlockSustenance.call(this, event, target); }
    static #onSwitchTotmTab(event, target) { this._totm.onSwitchTotmTab(event, target); }
    static async #onSubmitWorkbenchIdentifyTotm(event, target) { return RestSetupActionHandlers.onSubmitWorkbenchIdentifyTotm.call(this, event, target); }
    static #onDismissWorkbenchIdentifyAckTotm(event, target) { return RestSetupActionHandlers.onDismissWorkbenchIdentifyAckTotm.call(this, event, target); }
    static async #onDetectMagicScanTotm(event, target) { return RestSetupActionHandlers.onDetectMagicScanTotm.call(this, event, target); }
    static #onTotmCraftSelectRecipe(event, target) { return RestSetupActionHandlers.onTotmCraftSelectRecipe.call(this, event, target); }
    static #onTotmCraftSelectRisk(event, target) { return RestSetupActionHandlers.onTotmCraftSelectRisk.call(this, event, target); }
    static async #onTotmCraftCommit(event, target) { return await this._crafting.onTotmCraftCommit(...arguments); }
    static #onTotmCraftToggleMissing(event, target) { return RestSetupActionHandlers.onTotmCraftToggleMissing.call(this, event, target); }
    static #onTotmCraftClose(event, target) { this._totm.onTotmCraftClose(event, target); }
    static async #onTotmFeastServeNow() { return await this._crafting.onTotmFeastServeNow(...arguments); }
    static async #onCampColdCamp(event, target) { return await this._campPlacement.onCampColdCamp(...arguments); }
    static async #onSelectCampColdCamp(event, target) { return await this._campPlacement.onSelectCampColdCamp(...arguments); }
    static async #onConfirmCampColdCamp() { return await this._campPlacement.onConfirmCampColdCamp(...arguments); }
    static async #onPreviewCampFireLevel(event, target) { return RestSetupActionHandlers.onPreviewCampFireLevel.call(this, event, target); }
    static async #onContinueToCampLayout(event, target) { return RestSetupActionHandlers.onContinueToCampLayout.call(this, event, target); }
    static #onSwitchWorkflow(event, target) { return RestSetupActionHandlers.onSwitchWorkflow.call(this, event, target); }
    static #onToggleExamine(event, target) {
        this._holdWindowHeight();
        if (this._selectedWorkflowStep === "examine") {
            this._selectedWorkflowStep = this._lastWorkflowStep || "activities";
            this._totmFollowUpExpanded = null;
        } else {
            const actorId = this._selectedCharacterId ?? game.user.character?.id ?? getPartyActors()[0]?.id;
            this._lastWorkflowStep = this._selectedWorkflowStep;
            this._selectedWorkflowStep = "examine";
            this._totmFollowUpExpanded = { activityId: "act_identify", characterId: actorId, isIdentify: true };
        }
        this.render({ force: true });
    }
    static #onSkipGather(event, target) { return RestSetupActionHandlers.onSkipGather.call(this, event, target); }
    static #onConfirmGatherSkip() { return RestSetupActionHandlers.onConfirmGatherSkip.call(this); }
    static #onClearSustenanceFood(event, target) { return RestSetupActionHandlers.onClearSustenanceFood.call(this, event, target); }
    static #onAssignSustenanceFood(event, target) { return RestSetupActionHandlers.onAssignSustenanceFood.call(this, event, target); }
    static #onClearSustenanceWater(event, target) { return RestSetupActionHandlers.onClearSustenanceWater.call(this, event, target); }
    static #onAssignSustenanceWater(event, target) { return RestSetupActionHandlers.onAssignSustenanceWater.call(this, event, target); }
    static #onToggleCharacterReady(event, target) {
        const actorId = target?.dataset?.actorId
            ?? this._selectedCharacterId
            ?? game.user.character?.id;
        if (!actorId) return;
        if (!this._finishedActorIds) this._finishedActorIds = new Set();
        if (this._finishedActorIds.has(actorId)) this._finishedActorIds.delete(actorId);
        else this._finishedActorIds.add(actorId);
        publishCampProgress(this, {
            finishedActorId: actorId,
            finished: this._finishedActorIds.has(actorId)
        });
        this.render({ force: true });
    }
    static async #onProceedFromMakeCamp(event, target) { return await this._campPlacement.onProceedFromMakeCamp(...arguments); }
    static async #onReclaimCampfire(event, target) { return await this._campPlacement.onReclaimCampfire(...arguments); }
    static async #onClearAllCampScene(event, target) { return await this._campPlacement.onClearAllCampScene(...arguments); }
    static async #onClearMyCampGear(event, target) { return await this._campPlacement.onClearMyCampGear(...arguments); }
    static async reclaimCampGearFromDialog(restApp, event, target) { return RestSetupApp.#onReclaimCampGear.call(restApp, event, target); }
    static async #onReclaimCampGear(event, target) { return await this._campPlacement.onReclaimCampGear(...arguments); }
    static async #onReclaimCampStation(event, target) { return await this._campPlacement.onReclaimCampStation(...arguments); }
    static async #onToggleUiTheme(event, target) { return RestSetupActionHandlers.onToggleUiTheme.call(this, event, target); }
}

applyRestSetupStateHelpers(RestSetupApp);
