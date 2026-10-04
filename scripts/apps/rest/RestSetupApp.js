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
            title: "Respite: Rest Phase",
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
        this._selectedRestType = options.restType ?? (restData?.restType ?? "long");
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

_showFullMakeCampPanel() {
        return this._isTotM || isComfortEnabled();
    }

_usesStationsMinimalCampShell() {
        return !this._isTotM && !isComfortEnabled();
    }

_stationsComfortAutoAdvanceAfterFireLit() {
        return !this._isTotM && isComfortEnabled();
    }

_campPitBlocksFireLighting() {
        if (this._isTotM) return false;
        if (this._engine?.safeRestSpot) return false;
        return !hasCampfirePlaced();
    }

_campPitIgniteBlockMessage() {
        if (!this._campPitBlocksFireLighting()) return "";
        if (game.user?.isGM) {
            return "Place the campfire on the map (Place fire) before anyone can light it.";
        }
        return "The GM must place the campfire on the map before you can light the fire.";
    }

    async _maybeSpendMakeCampCeremonyWoodBeforeAdvance() {
        if (!this._stationsComfortAutoAdvanceAfterFireLit()) return;
        const cost = CampGearScanner.FIREWOOD_COST_BY_LEVEL[this._fireLevel ?? "unlit"] ?? 0;
        if (cost <= 0) return;
        const staged = this._makeCampStagedWood?.length ?? 0;
        if (staged < cost) return;
        await this._totmSpendMakeCampFirewood();
        this._makeCampStagedWood = [];
        this._makeCampStagedWoodTier = null;
    }

    /** Tavern + stations mode: TotM for this rest only. Does not write restInterfaceMode. */
    _applyTavernTotmOverrideForRestStart(terrainTag) {
        if (terrainTag !== "tavern") {
            this._tavernTotmOverride = false;
            return;
        }
        try {
            this._tavernTotmOverride = game.settings.get(MODULE_ID, "restInterfaceMode") === "stations";
        } catch {
            this._tavernTotmOverride = false;
        }
    }

_clearTavernTotmOverride() {
        this._tavernTotmOverride = false;
    }

    /** Engine, then activeRest payload, then world setting (same merge as getData). */
    _effectiveSafeRestSpot() {
        let fromSetting = false;
        try {
            fromSetting = !!game.settings.get(MODULE_ID, "safeRestSpot");
        } catch { /* settings not ready */ }
        return !!(this._engine?.safeRestSpot ?? this._restData?.safeRestSpot ?? fromSetting);
    }

getRestFlowEngine() {
        return this._engine ?? null;
    }

_applyLoseActivityTravelLocks() {
        if (this._phase !== "activity") return;
        for (const actor of getPartyActors()) {
            try {
                if (actor.getFlag(MODULE_ID, "travelMishapPenalty") === "lose_activity") {
                    this._characterChoices.set(actor.id, "act_other");
                }
            } catch { /* noop */ }
        }
    }

    _applyAutoOtherWhenSoleActivity() { this._stations._applyAutoOtherWhenSoleActivity(); }

    async _saveRestState() { return this._session._saveRestState(); }

    async _loadRestState() { return this._session._loadRestState(); }

async applyRestoredPhaseUi() {
        if (this._phase !== "activity") return;
        this._syncIncompleteTrainingView();
        await this.render({ force: true });
        const isTheater = this._isTotM;
        if (!isTheater) {
            this._attachActivityPhaseCanvasChrome();
            await this.close({});
        }
    }

_attachActivityPhaseCanvasChrome() {
        const runActivate = () => {
            try {
                this._activateCanvasStationLayer();
            } catch (err) {

                console.error(`${MODULE_ID} | _activateCanvasStationLayer failed`, err);
            }
        };
        if (canvas?.ready) runActivate();
        else Hooks.once("canvasReady", runActivate);
        if (this._isGM) {
            _showGmRestIndicator(this);
        }
        this._updateRestBarProgress();
    }

_tearDownStationLayerCanvas() {
        deactivateStationLayer();
        this._stationCanvasIdByCharacter?.clear();
    }

    _removeGmStationTokenSyncHook() {
        if (this._gmControlTokenHook) {
            Hooks.off("controlToken", this._gmControlTokenHook);
            this._gmControlTokenHook = null;
        }
    }

    _installGmStationTokenSyncHook() { this._session._installGmStationTokenSyncHook(); }

_hasDiscoveryGrant(grantKey) {
        const colon = grantKey?.indexOf?.(":") ?? -1;
        if (colon < 0) return false;
        return this._grantLedger?.has(
            GrantLedger.discoverySlotKey(grantKey.slice(0, colon), grantKey.slice(colon + 1))
        ) ?? false;
    }

    _getDiscoveryGrant(grantKey) {
        const colon = grantKey?.indexOf?.(":") ?? -1;
        if (colon < 0) return null;
        return this._grantLedger?.get(
            GrantLedger.discoverySlotKey(grantKey.slice(0, colon), grantKey.slice(colon + 1))
        ) ?? null;
    }

hasCompletedCrafting(actorId, professionId = null) {
        if (!actorId) return false;
        if (this._craftingResults?.has(actorId)) return true;
        return this._grantLedger?.hasCraftingForActor(actorId, professionId) ?? false;
    }

    async _clearRestState() {
        if (!game.user.isGM) return;
        this._clearTavernTotmOverride();
        this._grantLedger?.reset();
        try {
            await game.settings.set(MODULE_ID, "activeRest", {});
        } catch (e) {
            // Setting may not be registered yet
        }
    }

_refreshLedgerApp() {
        if (this._restLedgerApp?.rendered) {
            this._restLedgerApp.render();
        }
    }

    /** EventResolver.load applies pool selection at ingest; reload after curator save. */
    async _refreshEventPool() {
        const terrainTag = this._engine?.terrainTag ?? this._selectedTerrain;
        this._eventResolver = new EventResolver();
        await this._loadData();
        if (terrainTag) {
            await this._loadTerrainEvents(terrainTag);
        }
    }

    async _loadData() { return this._session._loadData(); }

    async _loadContentPacks() { return this._session._loadContentPacks(); }

    _forageResolverOpts() {
        const terrainTag = this._engine?.terrainTag ?? this._selectedTerrain ?? this._restData?.terrainTag ?? "forest";
        const travelResolver = GatherYieldService.getResolver?.() ?? null;
        const available = ForageActivityValidator.isForageAvailable(travelResolver, terrainTag);
        const gate = available ? { disabled: false, disabledReasonKey: null } : { disabled: true, disabledReasonKey: "ionrift-respite.travel.forage.requires_pack" };
        return {
            forageActivityGate: gate,
            terrainTag,
            resourcePoolsFromPack: false,
            resourcePoolRoller: travelResolver?.resourcePoolRoller ?? null,
            travelResolver
        };
    }

_isTavernTerrain() {
        return (this._selectedTerrain ?? this._engine?.terrainTag ?? this._restData?.terrainTag ?? "") === "tavern";
    }

async _onSetupTerrainChanged(prevTerrain, nextTerrain) {
        this._selectedTerrain = nextTerrain;
        this._selectedWeather = this._resolveSetupWeather(nextTerrain);
        if (prevTerrain === "tavern" && nextTerrain !== "tavern") {
            this._safeRestPulseAlert = true;
            try {
                await game.settings.set(MODULE_ID, "safeRestSpot", false);
            } catch (e) {
                console.warn(`${MODULE_ID} | safeRestSpot setting`, e);
            }
        } else if (nextTerrain === "tavern") {
            this._safeRestPulseAlert = false;
        }
        this.render();
    }

_activityResolverOpts(overrides = {}) {
        const tavernRest = this._isTavernTerrain();
        const safeRestSpot = this._effectiveSafeRestSpot() || tavernRest;
        const fireLevel = overrides.fireLevel ?? this._fireLevel ?? "unlit";
        const isFireLit = overrides.isFireLit ?? !!(fireLevel && fireLevel !== "unlit");
        return {
            safeRestSpot,
            tavernRest,
            isFireLit,
            fireLevel,
            ...this._forageResolverOpts(),
            ...overrides
        };
    }

_shouldShowEventPoolNudge(terrainTag) {
        if (!game.user.isGM) return false;
        if (this._phase !== "events" || this._eventsRolled) return false;
        if (countPoolEventsForTerrain(this._eventResolver, terrainTag) > 0) return false;
        const snoozedUntil = game.settings.get(MODULE_ID, "eventPoolNudgeSnoozedUntil");
        if (snoozedUntil) {
            const snoozeDate = new Date(snoozedUntil);
            if (!isNaN(snoozeDate.getTime()) && snoozeDate > new Date()) return false;
        }
        return true;
    }

    async _loadTerrainEvents(terrainTag) { return this._session._loadTerrainEvents(terrainTag); }

    async _loadTerrainEventsFromOverlay(terrainTag) { return this._session._loadTerrainEventsFromOverlay(terrainTag); }

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
        return super.close(options);
    }

    _bindRestWindowUserMoveTracking() {
        return this._windowLayout.bindUserMoveTracking(...arguments);
    }

    _campRestWindowTargetWidth() { return this._windowLayout.campRestWindowTargetWidth(...arguments); }

    _repositionFilmingRestWindow(options = {}) { return this._windowLayout.repositionFilmingRestWindow(...arguments); }

    _scheduleFilmingWindowReposition(options = {}) { return this._windowLayout.scheduleFilmingWindowReposition(...arguments); }

    _presetRestWindowForCampEntry() { return this._windowLayout.presetRestWindowForCampEntry(...arguments); }

    _applyRestWindowPosition(pos, { smooth = false, filming = false, durationMs } = {}) { return this._windowLayout.applyRestWindowPosition(...arguments); }

    _animateFilmingRestWindowPosition(targetPos, durationMs = 420) { return this._windowLayout.animateFilmingRestWindowPosition(...arguments); }

    async _finalizeCampPhaseWindowLayout() { return await this._windowLayout.finalizeCampPhaseWindowLayout(...arguments); }

    _shouldAutoRecenterRestWindow() { return this._windowLayout.shouldAutoRecenterRestWindow(...arguments); }

    _disposeRestWindowResizeObserver() {
        return this._windowLayout.disposeRestWindowResizeObserver(...arguments);
    }

    _bindRestWindowResizeObserver() {
        return this._windowLayout.bindRestWindowResizeObserver(...arguments);
    }

    _beginRestWindowRecenterSuppression() {
        return this._windowLayout.beginRestWindowRecenterSuppression(...arguments);
    }

    _endRestWindowRecenterSuppression(schedule = true) {
        return this._windowLayout.endRestWindowRecenterSuppression(...arguments);
    }

    _scheduleRestWindowRecenter(options = {}) { return this._windowLayout.scheduleRestWindowRecenter(...arguments); }

    _recenterRestSetupWindow(options = {}) {
        return this._windowLayout.recenterRestSetupWindow(...arguments);
    }

    buildCampfireDrawerContextForMapDialog() { return this._campCeremony.buildCampfireDrawerContextForMapDialog(); }

    _setShowCampfireCanvasPanel(_v) {
    }

    runMakeCampLightFireFromUi(event, target) {
        return RestSetupApp.#onCampLightFire.call(this, event, target);
    }

    runMakeCampPledgeFromUi(event, target) {
        return RestSetupApp.#onCampPledgeFirewood.call(this, event, target);
    }

    runMakeCampReclaimFromUi() {
        return RestSetupApp.#onCampReclaimFirewood.call(this, new Event("click"), null);
    }

    runMakeCampColdFromUi() {
        return RestSetupApp.#onSelectCampColdCamp.call(this, new Event("click"), null);
    }

    runMakeCampConfirmColdFromUi() {
        return RestSetupApp.#onConfirmCampColdCamp.call(this, new Event("click"), null);
    }

    runMakeCampSelectFireLevelFromUi(event, target) {
        return RestSetupApp.#onSelectCampFireLevel.call(this, event, target);
    }

    _buildEncounterPlayerFactors(params) { return this._campCeremony._buildEncounterPlayerFactors(params); }

    _buildCampConditionsBar(campScanData, { safeRestSpot = false, encountersEnabled = true } = {}) {
        if ((this._phase !== "camp" && this._phase !== "activity") || !this._engine) return null;
        const effectiveFire = (this._campColdCampDecided || this._coldCampPreview)
            ? "cold_camp"
            : (this._fireLevel && this._fireLevel !== "unlit")
                ? this._fireLevel
                : (this._campFirePreviewLevel ?? this._engine?.fireLevel ?? "embers");
        return buildCampConditionsBar({
            terrainTag: this._engine.terrainTag ?? "forest",
            weatherKey: this._engine.weather ?? "clear",
            fireLevel: effectiveFire,
            activeShelters: this._engine.activeShelters ?? [],
            campScanData,
            safeRestSpot,
            encountersEnabled,
            isGM: game.user?.isGM
        });
    }

_resolveSetupWeather(terrainTag, candidate) {
        const valid = TerrainRegistry.getWeather(terrainTag);
        const defaultKey = valid[0] ?? "clear";
        let lastWeather = "";
        try {
            lastWeather = game.settings.get(MODULE_ID, "lastWeather") ?? "";
        } catch { /* settings not ready */ }
        const pick = candidate ?? this._selectedWeather ?? (lastWeather || defaultKey);
        return valid.includes(pick) ? pick : defaultKey;
    }

    async _prepareContext(options) {
        if (!this._activities || this._activities.length === 0) {
            await this._loadData();
        }
        const ctx = await this._prepareCtx.build(options);
        if (ctx && !ctx.isLoading) this._campLogistics.mergeContext(ctx);
        return ctx;
    }

    _buildCraftingDrawerContext() { return this._crafting.buildContext(); }

    _buildArmorWarningForActor(a) { return this._stations._buildArmorWarningForActor(a); }

    getArmorWarningForActivityDetail(actor, tile) {
        const aw = this._buildArmorWarningForActor(actor);
        if (!aw || !tile) return null;
        if (aw.isDoffed) return aw;
        if (!tile.armorSleepWaiver) return aw;
        return null;
    }

    _bindArmorToggleHandlers(element, onAfter) { this._session._bindArmorToggleHandlers(element, onAfter); }

    _buildActivityDetailContext(selectedCharacter) { return this._stations._buildActivityDetailContext(selectedCharacter); }

    _formatCheckLabel(check, character) { return this._session._formatCheckLabel(check, character); }

    getCampGearContextForActor(actorId) { return this._stations.getCampGearContextForActor(actorId); }

isCampfireStationFlavorOnly() {
        return this._phase === "activity" && !this._isTotM && !isComfortEnabled();
    }

getCampfireStationDialogTabs() {
        if (this._phase !== "activity" || this._isTotM) return [];
        if (this.isCampfireStationFlavorOnly()) {
            return [{ id: "camp", label: "Camp" }];
        }
        if (!this.getFireTabContextForStationDialog()) return [];
        return [
            { id: "camp", label: "Camp" },
            { id: "fire", label: "Fire" }
        ];
    }

    getCampGearFlavorPanelForActor(actorId) { return this._stations.getCampGearFlavorPanelForActor(actorId); }

    _getCampScanDataForActivityStationDialog() { return this._session._getCampScanDataForActivityStationDialog(); }

getCampComfortAdvisoryForStationDialog() {
        if (this.isCampfireStationFlavorOnly()) return null;
        const campScanData = this._getCampScanDataForActivityStationDialog();
        if (!campScanData) return null;
        const mapComfortTier = campScanData.campComfort ?? "rough";
        const mapComfortLabel = campScanData.campComfortLabel ?? "";
        const mapComfortLine = campScanData.comfortReason
            ? `${campScanData.terrainLabel ? `${campScanData.terrainLabel}: ` : ""}${campScanData.comfortReason}`
            : (campScanData.terrainLabel
                ? `${campScanData.terrainLabel} (${mapComfortLabel})`
                : `Camp comfort: ${mapComfortLabel}`);
        const mapComfortTierClass = `comfort-${mapComfortTier}`;
        return { mapComfortTier, mapComfortLabel, mapComfortLine, mapComfortTierClass };
    }

    getFireTabContextForStationDialog() { return this._campCeremony.getFireTabContextForStationDialog(); }

setStationFirePreviewLevel(level) {
        const next = ["embers", "campfire", "bonfire"].includes(level) ? level : null;
        if (this._stationFirePreviewLevel === next) return;
        this._stationFirePreviewLevel = next;
    }

    getCampPersonalCardForActor(actorId) { return this._campCeremony.getCampPersonalCardForActor(actorId); }

    _buildResolutionCards(outcomes) { return this._resolve._buildResolutionCards(outcomes); }

    _onRenderBindings(context, options) {
        this._renderBindings._onRenderBindings(context, options);
    }

static #onToggleShelter(event, target) {
        const shelterId = target.dataset.shelterId;
        if (!shelterId) return;
        if (!this._shelterOverrides) this._shelterOverrides = {};

        const wasActive = !!this._shelterOverrides[shelterId];
        for (const key of Object.keys(this._shelterOverrides)) {
            this._shelterOverrides[key] = false;
        }
        this._shelterOverrides[shelterId] = !wasActive;

        this.render();
    }

    static #onSetupContinue(event, target) { this._session.onSetupContinue(event, target); }

static #onSetupBack(event, target) {
        const step = parseInt(target.dataset.step, 10);
        this._setupStep = step;
        this.render();
    }

    /**
     * Short-term dev toggle to switch between Normal and Gritty Realism rest variants.
     */
    static async #onToggleDevRestVariant(event, target) {
        if (!game.user.isGM) return;

        const form = this.element?.querySelector("form");
        if (form) {
            const formData = Object.fromEntries(new FormData(form));
            if (formData.terrain) this._selectedTerrain = formData.terrain;
            if (formData.weather) this._selectedWeather = formData.weather;
            if (formData.restType) this._selectedRestType = formData.restType;
        }

        const current = this._restVariant ?? "normal";
        const next = current === "gritty" ? "normal" : "gritty";
        this._restVariant = next;
        if (this._isGrittyLong) {
            this._campLogistics._foodDaysNeeded = defaultFoodDaysNeeded(true);
        } else {
            this._daysSinceLastRest = 1;
            this._campLogistics._foodDaysNeeded = defaultFoodDaysNeeded(false);
        }

        const adapter = game.ionrift?.respite?.adapter;
        if (adapter) {
            if (typeof adapter.setDevRestVariant === "function") {
                adapter.setDevRestVariant(next);
            } else {
                adapter._devVariantOverride = next;
            }
        }

        if (game.system?.id === "dnd5e" && game.settings.settings.has("dnd5e.restVariant")) {
            try {
                await game.settings.set("dnd5e", "restVariant", next);
            } catch (err) {
                Logger.warn("[Respite] Could not sync dnd5e.restVariant setting:", err);
            }
        }

        ui.notifications.info(`Rest variant switched to ${next === "gritty" ? "Gritty Realism" : "Normal"}.`);
        this.render();
    }

    async toggleDevRestVariant() {
        return RestSetupApp.#onToggleDevRestVariant.call(this, null, null);
    }

static #onSetupDefaults(event, target) {
        const form = this.element.querySelector("form");
        const formData = form ? Object.fromEntries(new FormData(form)) : {};
        this._selectedTerrain = formData.terrain ?? this._selectedTerrain ?? "forest";
        this._selectedRestType = formData.restType ?? "long";

        const terrainOpt = this.element.querySelector('[name="terrain"] option:checked');
        this._terrainLabel = terrainOpt?.textContent?.trim() ?? this._selectedTerrain;
        this._selectedWeather = "clear";
        this._selectedComfort = "sheltered";
        this._setupStep = 3;
        this.render();
    }

    static #onEncounterAdjUp(event, target) {
        if (!game.user.isGM || !this._engine) return;
        this._engine.gmEncounterAdj = (this._engine.gmEncounterAdj ?? 0) + 1;
        this.render({ force: true });
    }

    static #onEncounterAdjDown(event, target) {
        if (!game.user.isGM || !this._engine) return;
        this._engine.gmEncounterAdj = (this._engine.gmEncounterAdj ?? 0) - 1;
        this.render({ force: true });
    }

    static #onAdjustEncounterDc(event, target) {
        if (!game.user.isGM || !this._engine) return;
        const delta = Number(target.dataset.delta) || 0;
        if (!delta) return;
        this._engine.gmEncounterAdj = (this._engine.gmEncounterAdj ?? 0) + delta;
        this.render({ force: true });
    }

    static async #onRollCampCheck(event, target) { return this._events.onRollCampCheck(event, target); }

static #onAdjustCampDC(event, target) {
        event.preventDefault?.();
        if (!game.user.isGM) return;

        const characterId = target.dataset.characterId;
        const delta = parseInt(target.dataset.delta) || 0;
        if (!characterId || !delta) return;

        const entry = this._pendingCampRolls?.find(p => p.characterId === characterId);
        if (!entry || entry.status !== "pending") return;

        entry.dc = Math.max(1, entry.dc + delta);

        // GM-local only: re-render to show updated DC. Player sees final DC only when GM sends request.
        this.render();
    }

    static #onRequestCampRoll(event, target) { this._events.onRequestCampRoll(event, target); }

    async receiveCampRollResult(data) { await this._events.receiveCampRollResult(data); }

    /** Local-only until the roll request broadcasts; players never see mid-adjust DC. */
    static #onAdjustEventDc(event, target) {
        event.preventDefault?.();
        if (!game.user.isGM) return;

        const eventIndex = parseInt(target.dataset.eventIndex ?? target.closest("[data-event-index]")?.dataset.eventIndex);
        const delta = parseInt(target.dataset.delta) || 0;
        const triggeredEvent = this._triggeredEvents?.[eventIndex];
        if (!triggeredEvent?.mechanical || !delta || triggeredEvent.awaitingRolls || triggeredEvent.resolvedOutcome) return;

        triggeredEvent.mechanical.dc = Math.max(1, (triggeredEvent.mechanical.dc ?? 10) + delta);
        this.render();
    }

    static #onCycleEventRollMode(event, target) { this._events.onCycleEventRollMode(event, target); }

    static async #onResolveSkillCheck(event, target) { return this._flowActions.onResolveSkillCheck(event, target); }

    static async #onLockEventConsequence(event, target) { return this._flowActions.onLockEventConsequence(event, target); }

static async #evaluateLockCount(countSpec, poolSize) {
        if (poolSize === 0) return 0;
        if (countSpec == null) return Math.min(1, poolSize);
        if (typeof countSpec === "number") return Math.max(0, Math.min(Math.floor(countSpec), poolSize));
        const s = String(countSpec).trim();
        if (/^\d+$/.test(s)) return Math.max(0, Math.min(parseInt(s, 10), poolSize));
        try {
            const roll = await new Roll(s).evaluate();
            return Math.max(0, Math.min(Math.floor(roll.total), poolSize));
        } catch (e) {
            return Math.min(1, poolSize);
        }
    }

static #pickRandomN(pool, n) {
        if (n <= 0 || pool.length === 0) return [];
        if (n >= pool.length) return [...pool];
        const shuffled = [...pool];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        return shuffled.slice(0, n);
    }

    async receiveRollResult(data) { return this._events.receiveRollResult(data); }

    receiveRollRequest(data) { return this._events.receiveRollRequest(data); }

    receiveTreeRollRequest(data) { return this._events.receiveTreeRollRequest(data); }

    static async #onRollTreeCheck(event, target) { return this._flowActions.onRollTreeCheck(event, target); }

static #formatGmGuidance(text) {
        return text.split(/\n\n+/).map((raw, i) => {
            const p = raw.trim();
            // Non-first paragraphs: auto-chip a leading "Label:" or "Label text:" prefix
            if (i > 0) {
                const labelMatch = p.match(/^([A-Z][^:]{2,30}):\s*/);
                if (labelMatch) {
                    const label = labelMatch[1];
                    const rest  = p.slice(labelMatch[0].length);
                    return `<p><strong>${label}</strong>${rest}</p>`;
                }
            }
            return `<p>${p}</p>`;
        }).join("");
    }

    static #openGmGuidanceFlyout(triggerEl, guidanceHtml) { this._events.openGmGuidanceFlyout(triggerEl, guidanceHtml); }

    static #onToggleGmGuidance(event, target) { this._events.onToggleGmGuidance(event, target); }

    /** @override */
    async render(options = {}) {
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

    _onRender(context, options) { this._session._onRender(context, options); }

    static async #onIonriftRoll(event, target) { return this._events.onIonriftRoll(event, target); }
    static async #onRollGather(event, target) { return this._totm.onRollGather(event, target); }

    static #onCancelGather() {
        const actorId = this._selectedCharacterId;
        if (!actorId) return;
        if (this._gatherResults?.has(actorId)) return;
        const pending = this._gatherPending;
        if (pending?.characterId === actorId && pending.phase === "findings") return;
        if (pending?.characterId === actorId) this._gatherPending = null;
        this._gatherChoices?.delete(actorId);
        this._gatherSkipIds?.delete(actorId);
        if (this._finishedActorIds?.has(actorId)) {
            this._finishedActorIds.delete(actorId);
            publishCampProgress(this, {
                finishedActorId: actorId,
                finished: false
            });
        }
        this.render();
    }

    static async #onRollEventCheck(event, target) { return this._events.onRollEventCheck(event, target); }

    static async #onGrantDiscoveryItem(event, target) { return this._events.onGrantDiscoveryItem(event, target); }

    static async _applyTrainingXP(outcomes) { return this._session._applyTrainingXP(outcomes); }

static _buildTrainingProgressBar(training) {
        const rolls = training.rolls ?? [];
        const segments = rolls.map(r => {
            const fill = r.passed ? "#1c6ea4" : "rgba(0,0,0,0.14)";
            return `<span title="Set ${r.set}: rolled ${r.total} vs DC ${training.dc}" style="flex:1;height:10px;border-radius:3px;background:${fill};"></span>`;
        }).join("");

        const xpLabel = training.awardedXP > 0
            ? `<i class="fas fa-dumbbell" style="color:#6b4f00;"></i> <strong style="color:#6b4f00;">+${training.awardedXP} XP</strong> (${training.successes}/${training.numRolls} sets landed)`
            : `<i class="fas fa-dumbbell" style="opacity:0.6;"></i> No XP this rest`;
        const reductionNote = training.xpReduction > 0
            ? `<br><span style="font-size:0.82em;opacity:0.75;">Diminishing returns: ${training.xpReduction} XP held back this rest.</span>`
            : "";

        return `<div style="margin:4px 0;">`
            + `<div style="display:flex;gap:4px;margin-bottom:3px;">${segments}</div>`
            + `<p style="margin:0;">${xpLabel}${reductionNote}</p>`
            + `</div>`;
    }

    async _autoGrantPartyDiscoveries() { return this._resolve._autoGrantPartyDiscoveries(); }

    static async #onBeginShortRest(event, target) { return this._launchShortRestFromSetup(); }

    /** Sole launch point for a short rest, for both the short and long submit paths. */
    async _launchShortRestFromSetup() {
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

    /** Snapshot before phaseChanged so players do not race ahead on the old 200ms delay path. */
    _broadcastMakeCampPhaseSync() {
        const snapshot = this.getRestSnapshot?.();
        if (snapshot) emitRestSnapshot(snapshot);
        emitPhaseChanged("camp", {
            selectedTerrain: this._selectedTerrain ?? null,
            fireLevel: this._fireLevel ?? "unlit",
            coldCampDecided: !!this._coldCampDecided,
            campFirePreviewLevel: this._campFirePreviewLevel ?? null,
            coldCampPreview: !!this._coldCampPreview,
            makeCampStagedWood: [...(this._makeCampStagedWood ?? [])]
        });
    }

    static #onGmOverride(event, target) { this._events.onGmOverride(event, target); }

    static #onSelectRosterCharacter(event, target) {
        const chip = target?.closest?.(".roster-chip, .rest-dock-mini") || target;
        if (chip?.classList?.contains("not-owned") || chip?.classList?.contains("is-locked")) return;
        const charId = chip?.dataset?.actorId || chip?.dataset?.rosterId;
        if (!charId || charId === this._selectedCharacterId) return;
        if (!this._isGM) {
            const actor = game.actors.get(charId);
            if (!actor?.isOwner) return;
        }
        this._selectedCharacterId = charId;
        this._activityDetailId = null;
        this._craftingDrawerOpen = false;
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

openCraftingDrawer(event, target) {
        return RestSetupApp.#onOpenCrafting.call(this, event, target);
    }

    static #onOpenCrafting(event, target) {
        this._stations.onOpenCrafting(event, target);
    }

    static #onOpenMonsterCookbook(event, target) {
        const charId = target?.dataset?.characterId || this._selectedCharacterId;
        const actor = charId ? game.actors.get(charId) : null;
        if (!actor) return;
        const opened = MonstrousFeastBridge.openCooking(actor, {
            onCooked: () => {
                const craftResult = {
                    success: true,
                    narrative: "Cooked from the Monster Cookbook.",
                    recipeId: null,
                    monstrousFeast: true,
                    ingredientsConsumed: true
                };
                this._craftingResults.set(charId, craftResult);
                this.finalizeActivityChoiceFromStation(charId, "act_cook", null, { craftResult });
                this.render();
            }
        });
        if (!opened) {
            ui.notifications.warn("The Monster Cooking book is not available right now.");
        }
    }

    static #onCraftDrawerSelectRecipe(event, target) { this._crafting.onSelectRecipe(event, target); }
    static #onCraftDrawerSelectRisk(event, target) { this._crafting.onSelectRisk(event, target); }
    static async #onCraftDrawerCraft(event, target) { await this._crafting.onCraft(event, target); }
    static #onCraftDrawerToggleMissing(event, target) { this._crafting.onToggleMissing(event, target); }
    static #onCraftDrawerClose(event, target) { this._crafting.onClose(event, target); }

    static #onActivityDetailConfirm(event, target) { this._flowActions.onActivityDetailConfirm(event, target); }

static #onActivityDetailBack(event, target) {
        this._activityDetailId = null;
        this.render();
    }

    /** Sleep status id. Only Keep Watch stays alert. Defenses do not. */
    _beddingStatusEffectId() {
        const fromConfig = CONFIG.statusEffects?.find?.(e => e.id === "incapacitated");
        if (fromConfig) return "incapacitated";
        if ( CONFIG.statusEffects?.find?.(e => e.id === "unconscious") ) return "unconscious";
        return "incapacitated";
    }

    /** Keep Watch only, not the full alert roster. */
    _nightWatchActorIds() {
        const ids = new Set();
        for (const [characterId, entry] of this._engine?.characterChoices ?? []) {
            if (entry?.activityId === "act_keep_watch") ids.add(characterId);
        }
        return ids;
    }

    /** Incapacitated overlay; prone for posture. */
    _beddingStatusIds() {
        return game.ionrift?.respite?.adapter?.getBeddingStatusIds?.()
            ?? ["incapacitated", "prone"];
    }

    async _applyBeddingDown() { return this._session._applyBeddingDown(); }

    async _removeBeddingDown() { return this._session._removeBeddingDown(); }

    async _autoProcessRations() { return this._meals._autoProcessRations(); }

    static async #onSubmitActivities(event, target) { return this._flowActions.onSubmitActivities(event, target); }

    _openCampfire() { return this._campCeremony._openCampfire(...arguments); }

    _closeCampfire(options = {}) {
        return this._campCeremony._closeCampfire(...arguments);
    }

    async _restoreCampfireUiAfterReconnect() { return await this._campCeremony._restoreCampfireUiAfterReconnect(...arguments); }

    async _syncCampfireTokenFromRestState() { return await this._campCeremony._syncCampfireTokenFromRestState(...arguments); }

    _activityFireUiEnabled() { return this._campCeremony._activityFireUiEnabled(...arguments); }

    _totmFireUiEnabled() { return this._campCeremony._totmFireUiEnabled(...arguments); }

    _stationsFireMinigameEnabled() { return this._campCeremony._stationsFireMinigameEnabled(...arguments); }

    isStationFireMinigameTab() { return this._campCeremony.isStationFireMinigameTab(...arguments); }

    mountStationFireMinigame(host, dialog = null) { return this._campCeremony.mountStationFireMinigame(...arguments); }

    releaseStationFireMinigame(dialog = null) { return this._campCeremony.releaseStationFireMinigame(...arguments); }

    _totmCampfireMinigamePanelEnabled() { return this._campCeremony._totmCampfireMinigamePanelEnabled(...arguments); }

    _shouldShowTotmCampfirePanel() { return this._campCeremony._shouldShowTotmCampfirePanel(...arguments); }
    _shouldMountFireRailEmbed() { return this._campCeremony._shouldMountFireRailEmbed(...arguments); }

    _campfireReconnectGateDetail() { return this._campCeremony._campfireReconnectGateDetail(...arguments); }

    _totmFireTabVisible() { return this._campCeremony._totmFireTabVisible(...arguments); }

    _isCampColdCampPreview() {
        return this._campCeremony._isCampColdCampPreview(...arguments);
    }

    _partyFirewoodTotal() {
        return this._campCeremony._partyFirewoodTotal(...arguments);
    }

    _campPreviewFirewoodCost(level = null) {
        return this._campCeremony._campPreviewFirewoodCost(...arguments);
    }

    _portraitForCeremonyActor(actorId, userId) {
        return this._campCeremony._portraitForCeremonyActor(...arguments);
    }

    _stagedWoodCountForActor(actorId) {
        return this._campCeremony._stagedWoodCountForActor(...arguments);
    }

    _canReclaimCeremonyStagedSlot(slot) {
        return this._campCeremony._canReclaimCeremonyStagedSlot(...arguments);
    }

    _buildMakeCampCeremonyRequirementSlots() {
        return this._campCeremony._buildMakeCampCeremonyRequirementSlots(...arguments);
    }

    _maybeClearStagedWoodOnTierChange(newLevel) {
        return this._campCeremony._maybeClearStagedWoodOnTierChange(...arguments);
    }

    async clearCeremonyStagedWood({ silent = false } = {}) {
        return await this._campCeremony.clearCeremonyStagedWood(...arguments);
    }

    async stageCeremonyWood(userId, actorId) {
        return await this._campCeremony.stageCeremonyWood(...arguments);
    }

    async giftCeremonyWoodToFocusedActor() { return await this._campCeremony.giftCeremonyWoodToFocusedActor(...arguments); }

    async unstageCeremonyWood(slotId) {
        return await this._campCeremony.unstageCeremonyWood(...arguments);
    }

    async _spendCeremonyStagedWood(cost) {
        return await this._campCeremony._spendCeremonyStagedWood(...arguments);
    }

    _syncCampCeremonyPreviewToEmbed(syncOpts = {}) {
        return this._campCeremony._syncCampCeremonyPreviewToEmbed(...arguments);
    }

    _emitCampCeremonyPhaseSync(extra = {}) {
        return this._campCeremony._emitCampCeremonyPhaseSync(...arguments);
    }

    _campCeremonyMinigameEnabled() { return this._campCeremony._campCeremonyMinigameEnabled(...arguments); }

    async _commitMakeCampCeremonyIgnite(opts = {}) { return await this._campCeremony._commitMakeCampCeremonyIgnite(...arguments); }

    async _totmAdvanceCampAfterCeremonyIgnite() { return await this._campCeremony._totmAdvanceCampAfterCeremonyIgnite(...arguments); }

    async _totmSpendMakeCampFirewood() { return await this._campCeremony._totmSpendMakeCampFirewood(...arguments); }

static _formatCampFirewoodDonors(names) {
        return CampCeremonyDelegate.formatCampFirewoodDonors(names);
    }

    _syncTotmCampfireEmbedFromRest() {
        return this._campCeremony._syncTotmCampfireEmbedFromRest(...arguments);
    }

    async applyActivityFireLevelFromMinigame(level) { return await this._campCeremony.applyActivityFireLevelFromMinigame(...arguments); }

    _mountCampfireEmbed(mode, options = {}) { return this._campCeremony._mountCampfireEmbed(...arguments); }

    _tearDownCampfireEmbed(reason = "unknown") {
        return this._campCeremony._tearDownCampfireEmbed(...arguments);
    }

    static async #onSetFireLevel(event, target) { return await this._campCeremony.onSetFireLevel(...arguments); }

    _bindMealDragDrop(el) { this._meals._bindMealDragDrop(el); }

    _bindWorkbenchIdentifyDragDrop(el) { this._workbench.bindDragDrop(el); }

    static #onMealSelectFood(event, target) { this._meals.onSelectFood(event, target); }
    static #onMealSelectWater(event, target) { this._meals.onSelectWater(event, target); }

static async #onConsumeMealDay(event, target) { await this._meals.onConsumeMealDay(event, target); }

static async #onSubmitMealChoices(event, target) {
        const targetActorId = target?.dataset?.actorId
            ?? target?.closest?.("[data-actor-id]")?.dataset?.actorId
            ?? target?.closest?.("[data-character-id]")?.dataset?.characterId;
        if (this._isGM) {
            const charId = targetActorId ?? this._selectedCharacterId;
            if (charId) await this.submitActivityMealRationsFromStation(charId);
            return;
        }
        if (targetActorId && this._myCharacterIds?.has(targetActorId)) {
            await this.submitActivityMealRationsFromStation(targetActorId);
            return;
        }
        const submitted = this._activityMealRationsSubmitted ?? new Set();
        for (const charId of (this._myCharacterIds ?? [])) {
            if (!submitted.has(charId)) {
                await this.submitActivityMealRationsFromStation(charId);
            }
        }
    }

receiveMealChoices(userId, choices) {
        void this._meals.receiveMealChoices(userId, choices).catch(err => {

            console.warn(`${MODULE_ID} | receiveMealChoices`, err);
        });
    }

    async _advanceToEvents() { return this._meals._advanceToEvents(); }

    receiveMealDayConsumeRequest(userId, consumeByCharacter) {
        return this._meals.receiveMealDayConsumeRequest(userId, consumeByCharacter);
    }

    async receiveMealDayConsumed(userId, clientChoices) { await this._meals.receiveMealDayConsumed(userId, clientChoices); }

    async receiveDehydrationPrompt(characterId, actorName, dc) { await this._meals.receiveDehydrationPrompt(characterId, actorName, dc); }

    async receiveDehydrationResult(data) { await this._meals.receiveDehydrationResult(data); }

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

static #onHideWindow(event, target) {
        this.close();
    }

static async #onExitStationChoiceReview(event, target) {
        event?.preventDefault?.();
        if (!this._postStationChoiceReview) return;
        const charId = this._stationReviewCharacterId;
        this._postStationChoiceReview = false;
        this._stationReviewCharacterId = null;
        if (charId) this._revertStationActivityChoice(charId);
        await this.close({ retainPlayerApp: true, skipRejoin: true });
    }

static async #onDetectMagicScan(event, target) {
        const btn = event?.currentTarget ?? null;
        btn?.classList.add("is-casting");
        spawnDetectMagicCastRipple(btn);
        if (this._magicScanComplete) {
            this._clearDetectMagicScanSession();
            this.render();
        } else {
            await this.runDetectMagicScan();
        }
    }

static async #onIdentifyScannedItem(event, target) {
        const actorId = target.dataset.actorId;
        const itemId = target.dataset.itemId;
        if (!actorId || !itemId) return;
        await this.identifyScannedMagicItem(actorId, itemId);
    }

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

    async receiveTreeRollResult(data) { return this._events.receiveTreeRollResult(data); }

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

    static async #onApplyOneMealBuff(event, target) {
        return this._mealBuffs.applyOne(target?.dataset?.rowId);
    }

    static async #onContinueToNight(event, target) { return this._mealBuffs.continueToNight(); }

    static async #onReturnToNight(event, target) { return this._dawn.returnToNight(); }

    static async #onCompleteDawn(event, target) { return this._dawn.completeDawn(event, target); }

    static async #onRollActorExhaustionSave(event, target) {
        return this._dawn.rollActor(target?.dataset?.actorId);
    }

    static async #onRollAllExhaustionSaves(event, target) { return this._dawn.rollAll(); }

    static #onWaiveAllExhaustionSaves(event, target) { return this._dawn.waiveAll(); }

    static #onToggleMustRollExhaustion(event, target) {
        const input = target?.matches?.("input") ? target : target?.querySelector?.("input");
        const required = input?.checked ?? target?.checked;
        return this._dawn.toggleMustRoll(target?.dataset?.actorId, required);
    }

    static #onToggleExhaustionOverride(event, target) {
        return this._dawn.toggleOverride(target?.dataset?.actorId);
    }

    static #onAdjustExhaustionDC(event, target) {
        return this._dawn.adjustDc(target?.dataset?.actorId, Number(target?.dataset?.delta));
    }

    static #onAdjustAllExhaustionDC(event, target) {
        return this._dawn.adjustAllDc(Number(target?.dataset?.delta));
    }

    static #onSetExhaustionAdvMode(event, target) {
        return this._dawn.setAdvMode(target?.dataset?.actorId, target?.dataset?.mode);
    }

    static #onSetAllExhaustionAdvMode(event, target) {
        return this._dawn.setAllAdvMode(target?.dataset?.mode);
    }

    static #onCycleExhaustionAdvMode(event, target) {
        return this._dawn.cycleAdvMode(target?.dataset?.actorId);
    }

    static async #onFinalize(event, target) { return this._events.onFinalize(event, target); }

static #onOpenLedger(event, target) {
        if (!game.user.isGM) return;
        this.openLedgerPanel();
    }

    /* ── Camp Logistics Delegate Handlers ── */

    static #onToggleLogisticsDrawer(event, target) {
        if (!this._isGM) return;
        this._campLogistics.toggleDrawer();
    }

    static #onAdjustSustenanceDC(event, target) {
        if (!this._isGM) return;
        this._campLogistics.adjustSustenanceDC(target.dataset.activity, target.dataset.delta);
    }

    static #onStepFoodDays(event, target) {
        if (!this._isGM) return;
        if (!this._isGrittyLong) {
            const delta = Number(target.dataset.delta) || 0;
            const next = Math.max(1, Math.min(30, this._campLogistics._foodDaysNeeded + delta));
            this._daysSinceLastRest = next;
        }
        this._campLogistics.stepFoodDays(target.dataset.delta);
    }

    static async #onGiftWood(event, target) {
        if (!this._isGM) return;
        const qty = Number(target?.dataset?.qty) || 2;
        await this._campLogistics.giftWood(qty);
    }

    static #onToggleGearFactor(event, target) {
        if (!this._isGM) return;
        this._campLogistics.toggleGearFactor(target?.dataset?.factor);
    }

openLedgerPanel() {
        if (!game.user.isGM) return;
        if (!this._restLedgerApp || !this._restLedgerApp.rendered) {
            this._restLedgerApp = new RestLedgerApp({}, this._restLedger);
            void this._restLedgerApp.render(true).then(() => {
                if (this._restLedgerApp?.element && this.element) {
                    this._restLedgerApp.positionBeside(this.element);
                }
            });
        } else {
            this._restLedgerApp.bringToFront?.();
        }
    }

    receivePlayerChoices(userId, choices, craftingResults = null, followUps = null, earlyResults = null) { this._events.receivePlayerChoices(userId, choices, craftingResults, followUps, earlyResults); }

_updateRestBarProgress() {
        _refreshGmRestIndicator(this);
    }

    _pruneEarlyResultsWithoutChoice() {
        if (!this._earlyResults?.size) return;
        for (const charId of [...this._earlyResults.keys()]) {
            if (!this._characterChoices.has(charId)) this._earlyResults.delete(charId);
        }
    }

    _revertStationActivityChoice(characterId) { this._events._revertStationActivityChoice(characterId); }

_ensureTrainingStateForLockedChoices() {
        if (this._isGM) return;
        for (const charId of this._lockedCharacters ?? []) {
            if (this._characterChoices.get(charId) !== "act_train") continue;
            if (this._earlyResults?.has(charId)) continue;
            if (this._trainingStates?.has(charId)) continue;
            const actor = game.actors.get(charId);
            if (!actor?.isOwner) continue;
            this._initTrainingState(charId, "act_train", actor);
        }
    }

    _findIncompleteTrainingCharacterId() { return this._session._findIncompleteTrainingCharacterId(); }

    _syncIncompleteTrainingView() { this._training._syncIncompleteTrainingView(); }

    _clearStaleTrainingRollingFlags() {
        for (const state of this._trainingStates?.values() ?? []) {
            state.rolling = false;
        }
    }

    _initTrainingState(characterId, activityId, actor) { this._session._initTrainingState(characterId, activityId, actor); }

    _buildTrainingViewContext(characterId) { return this._training._buildTrainingViewContext(characterId); }

    static async #onTrainingRoll(event, target) { return this._training.onTrainingRoll(event, target); }

    async finalizeActivityChoiceFromStation(characterId, activityId, canvasStationId = null, options = {}) { return await this._stations.finalizeActivityChoiceFromStation(...arguments); }

static _inferCanvasStationForActivity(activityId, actorId = null) {
        return inferCanvasStationForActivity(activityId, actorId);
    }

    _refreshStationOverlayForFocusChange() { return this._stations._refreshStationOverlayForFocusChange(...arguments); }

    _actorOwesActivityPhaseMealRations(actorId) { return this._stations._actorOwesActivityPhaseMealRations(...arguments); }

    _buildStationEmptyNoticeMap() { return this._stations._buildStationEmptyNoticeMap(...arguments); }

    _refreshStationOverlayMeals() {
        return this._stations._refreshStationOverlayMeals(...arguments);
    }

    _getPendingMealCanvasPlan() { return this._stations._getPendingMealCanvasPlan(...arguments); }

    _activateCanvasStationLayer() { return this._stations._activateCanvasStationLayer(...arguments); }

    refreshCanvasStationOverlaysIfActivity() { return this._stations.refreshCanvasStationOverlaysIfActivity(...arguments); }

    refreshOpenStationDialogAfterCampGear() { return this._stations.refreshOpenStationDialogAfterCampGear(...arguments); }

    /** GM: controlled party token wins over roster so canvas picks match the board. */
    static _resolveStationActorForUser(partyActors, restApp = null) {
        return ActivityStationsDelegate.resolveStationActorForUser(partyActors, restApp);
    }

    _rebuildCharacterChoices() {
        return this._stations._rebuildCharacterChoices(...arguments);
    }

    getPartyStateForAdvisory() { return this._stations.getPartyStateForAdvisory(...arguments); }

    getStationMealCardForActor(actorId) { return this._stations.getStationMealCardForActor(...arguments); }

    _buildSatiatesLookup() { return this._stations._buildSatiatesLookup(...arguments); }

    _autoTrimExcessWater(charId) { return this._stations._autoTrimExcessWater(...arguments); }

    getStationIdentifyEmbedContext(options = {}) { return this._stations.getStationIdentifyEmbedContext(...arguments); }

    canShowDetectMagicScanButtonFromParty() { return this._stations.canShowDetectMagicScanButtonFromParty(...arguments); }

    canTriggerDetectMagicScanFromParty() { return this._stations.canTriggerDetectMagicScanFromParty(...arguments); }

    getWorkbenchIdentifyDragContext(actorId) { return this._workbench.getDragContext(actorId, collectPartyIdentifyEmbedData, getPartyActors); }

    dismissWorkbenchIdentifyAcknowledgement(actorId) { this._workbench.dismissAcknowledgement(actorId); }

    _clearDetectMagicScanSession(opts = {}) { this._detectMagic.clearScanSession(opts); }

    async attuneWorkbenchItemForActor(actorId, itemId) { return await this._stations.attuneWorkbenchItemForActor(...arguments); }

    async submitActivityMealRationsFromStation(actorId) { return await this._stations.submitActivityMealRationsFromStation(...arguments); }

    async unlockSustenance(actorId) { return await this._stations.unlockSustenance(...arguments); }

    _getPlayerChoiceForCharacter(characterId) {
        for (const [userId, submission] of this._playerSubmissions) {
            if (!submission?.choices || typeof submission.choices !== "object") continue;
            if (submission.choices[characterId]) {
                return {
                    activityId: submission.choices[characterId],
                    userName: submission.userName
                };
            }
        }
        return null;
    }

    _getFollowUpForCharacter(characterId) {
        for (const [userId, submission] of this._playerSubmissions) {
            if (submission.followUps?.[characterId]) {
                return submission.followUps[characterId];
            }
        }
        return null;
    }

    getRestSnapshot() { return this._sync.getRestSnapshot(...arguments); }

    getRestSnapshotForUser(userId) { return this._sync.getRestSnapshotForUser(...arguments); }

    async receivePhaseChange(phase, phaseData = {}) { return await this._sync.receivePhaseChange(...arguments); }

    receiveSubmissionUpdate(submissions) { return this._sync.receiveSubmissionUpdate(...arguments); }

    receiveRestSnapshot(snapshot) { return this._sync.receiveRestSnapshot(...arguments); }

    receiveArmorToggle(actorId, itemId, isDoffed) { return this._sync.receiveArmorToggle(...arguments); }

    static async #onLightCampfire(event, target) {
        await RestSetupApp.#onSelectCampFireLevel.call(this, event, { dataset: { fireLevel: "campfire" } });
    }

static async #onCampLightFire(event, target) { return this._session.onCampLightFire(event, target); }

static async #onCampPledgeFirewood(event, target) {
        const root = target?.closest?.("[data-action=\"campPledgeFirewood\"]") ?? target;
        const actorId = root?.dataset?.actorId;
        if (!actorId) return;
        if (!game.user.isGM) {
            emitCampFirewoodPledge(game.user.id, actorId);
            return;
        }
        if (actorId === "__gm__") {
            await this._campCeremony.addGmFirewoodPledge();
        } else {
            await this._campCeremony.addFirewoodPledge(game.user.id, actorId);
        }
    }

static async #onCampReclaimFirewood(event, target) {
        if (!game.user.isGM) {
            emitCampFirewoodReclaim(game.user.id);
            return;
        }
        await this._campCeremony.removeFirewoodPledge(game.user.id);
    }

    static async #onSelectCampFireLevel(event, target) {
        return await this._campPlacement.onSelectCampFireLevel(...arguments);
    }

    async _spendPartyFirewoodForMakeCamp(cost, requestingUserId = null) { return this._session._spendPartyFirewoodForMakeCamp(cost, requestingUserId); }

    /** Sets fire tier now; firewood spends on Proceed to activities, not here. */
    async _skipCampForTheater() { return this._session._skipCampForTheater(); }

    async _skipCampForSafeRest() { return this._session._skipCampForSafeRest(); }

    _healOrphanCampfirePlacementState() { return this._campPlacement._healOrphanCampfirePlacementState(...arguments); }

    async _autoLightCampfireForComfortOffStations() { return this._session._autoLightCampfireForComfortOffStations(); }

    async _skipCampForComfortOff() { return this._session._skipCampForComfortOff(); }

async _advanceCampToActivity() { return this._session._advanceCampToActivity(); }

    _cancelCampPlacementCanvasMode() { return this._campPlacement._cancelCampPlacementCanvasMode(...arguments); }

    _campPlacementStillActive() { return this._campPlacement._campPlacementStillActive(...arguments); }

    _pickPitWorldPoint(options = {}) { return this._campPlacement._pickPitWorldPoint(...arguments); }

    async _commitStationsCampPlacement(worldX, worldY, options = {}) { return await this._campPlacement._commitStationsCampPlacement(...arguments); }

    async _startCampPitCursorFlow() { return await this._campPlacement._startCampPitCursorFlow(...arguments); }

    async _refreshCampPitNoticeLayer() { return await this._campPlacement._refreshCampPitNoticeLayer(...arguments); }

    static async #onDismissCampfireCanvasPanel() {
        this.render({ force: true });
    }

    static async #onRetryCampPitPlacement() {
        return await this._campPlacement.onRetryCampPitPlacement(...arguments);
    }

    static async #onDismissEventPoolNudge(event, target) {
        const snoozeUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
        await game.settings.set(MODULE_ID, "eventPoolNudgeSnoozedUntil", snoozeUntil);
        await this._saveRestState();
        this.render();
    }

    static #onOpenEventPoolCurator(event, target) {
        const terrainTag = this._engine?.terrainTag ?? this._selectedTerrain ?? "forest";
        openEventPoolApp(terrainTag);
    }

    static async #onSelectTotmActivity(event, target) { return this._totm.onSelectTotmActivity(event, target); }

    static async #onConfirmTotmFollowUp(event, target) { return this._totm.onConfirmTotmFollowUp(event, target); }

    static #onCancelTotmFollowUp() { this._totm.onCancelTotmFollowUp(); }

    static async #onUnlockTotmActivity(event, target) { return this._totm.onUnlockTotmActivity(event, target); }

    static async #onUnlockSustenance(event, target) {
        const actorId = target?.dataset?.actorId
            ?? target?.closest?.("[data-actor-id]")?.dataset?.actorId
            ?? this._selectedCharacterId
            ?? (this._isGM ? null : this._myCharacterIds?.values().next().value);
        if (!actorId) return;
        await this._stations.unlockSustenance(actorId);
    }

    static #onSwitchTotmTab(event, target) { this._totm.onSwitchTotmTab(event, target); }

static async #onSubmitWorkbenchIdentifyTotm(event, target) {
        const actorId = target.dataset.workbenchActorId
            ?? this.element?.querySelector(".station-workbench-identify-embed")?.dataset?.workbenchActorId;
        if (!actorId) return;
        await this._workbench.submitFromStation(actorId);
    }

static #onDismissWorkbenchIdentifyAckTotm(event, target) {
        const actorId = target.dataset.workbenchActorId
            ?? this.element?.querySelector(".station-workbench-identify-embed")?.dataset?.workbenchActorId;
        if (!actorId) return;
        this._workbench.dismissAcknowledgement(actorId);
    }

static async #onDetectMagicScanTotm(event, target) {
        const btn = event?.currentTarget ?? null;
        btn?.classList.add("is-casting");
        spawnDetectMagicCastRipple(btn);
        if (this._magicScanComplete) {
            this._clearDetectMagicScanSession();
            this.render();
        } else {
            await this._detectMagic.runScan(getPartyActors);
        }
    }

_resetTotmCraftState() {
        this._totmCraftRecipeId = null;
        this._totmCraftRisk = "standard";
        this._totmCraftResult = null;
        this._totmCraftHasCrafted = false;
        this._totmCraftShowMissing = false;
        this._totmCraftRollPending = false;
        this._totmFeastServed = false;
        this._totmFeastInFlight = false;
    }

_hydrateTotmCraftStateFromRest(characterId, profession) {
        if (!characterId) return false;
        const prior = this._craftingResults?.get(characterId);
        if (!prior && !this.hasCompletedCrafting(characterId, profession)) return false;
        this._totmCraftResult = prior ?? { success: true, narrative: "Craft already completed this rest." };
        this._totmCraftHasCrafted = true;
        this._totmCraftRecipeId = prior?.recipeId ?? null;
        return true;
    }

static #onTotmCraftSelectRecipe(event, target) {
        if (this._totmCraftRollPending || this._totmCraftHasCrafted) return;
        this._totmCraftRecipeId = target.dataset.recipeId;
        this.render();
    }

static #onTotmCraftSelectRisk(event, target) {
        if (this._totmCraftRollPending || this._totmCraftHasCrafted) return;
        this._totmCraftRisk = target.dataset.risk;
        this.render();
    }

    static async #onTotmCraftCommit(event, target) {
        return await this._crafting.onTotmCraftCommit(...arguments);
    }

    static #onTotmCraftToggleMissing(event, target) {
        if (this._totmCraftRollPending) return;
        this._totmCraftShowMissing = !this._totmCraftShowMissing;
        this.render();
    }

    static #onTotmCraftClose(event, target) {
        this._totm.onTotmCraftClose(event, target);
    }

    static async #onTotmFeastServeNow() {
        return await this._crafting.onTotmFeastServeNow(...arguments);
    }

    async _runSetCampFireLevelForGm(level, requestingUserId = null, gmOverride = false) {
        return await this._campPlacement._runSetCampFireLevelForGm(...arguments);
    }

    async changeFireLevelDuringActivity(level, { fromPlayer = false, requestingUserId = null, fromMinigame = false } = {}) { return await this._campPlacement.changeFireLevelDuringActivity(...arguments); }

    async setColdCampDuringActivity({ fromPlayer = false } = {}) { return await this._campPlacement.setColdCampDuringActivity(...arguments); }

    static async #onCampColdCamp(event, target) { return await this._campPlacement.onCampColdCamp(...arguments); }

    static async #onSelectCampColdCamp(event, target) { return await this._campPlacement.onSelectCampColdCamp(...arguments); }

    static async #onConfirmCampColdCamp() { return await this._campPlacement.onConfirmCampColdCamp(...arguments); }

static async #onPreviewCampFireLevel(event, target) {
        const root = target?.closest?.("[data-action=\"previewCampFireLevel\"]") ?? target;
        const level = root?.dataset?.fireLevel;
        if (!level || !["cold_camp", "embers", "campfire", "bonfire"].includes(level)) return;
        if (this._coldCampDecided) return;
        if (this._campFirePreviewLevel === level) return;
        this._campFirePreviewLevel = level;
        this.render();
    }

static async #onContinueToCampLayout(event, target) {
        if (!game.user.isGM) return;
        ui.notifications?.info("Use the campfire on the map to finish Make Camp.");
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
        // Leave the activity screen so the chosen tab shows its own view.
        // Training stays open and comes back when Activities is selected again.
        if (this._totmFollowUpExpanded?.activityId !== "act_train") {
            this._totmFollowUpExpanded = null;
        }
        // Stepper is visual sub-navigation only. Never mutate _phase.
        // Phase transitions are owned by RestFlowActions.
        this.render({ force: true });
    }

    static #onToggleExamine(event, target) {
        this.#holdWindowHeight();
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

    static #onSkipGather(event, target) {
        const actorId = this._selectedCharacterId ?? game.user.character?.id ?? getPartyActors()[0]?.id;
        if (!actorId) return;
        if (gatherAlreadyResolved(this, actorId)) {
            ui.notifications.info("Already gathered this rest.");
            return;
        }
        if (this._gatherPending?.characterId === actorId && this._gatherPending.phase === "findings") {
            ui.notifications.info("Roll for findings before skipping.");
            return;
        }
        if (this._gatherSkipIds?.has(actorId)) return;
        this._gatherPending = {
            characterId: actorId,
            activityId: "gather_skip",
            phase: "confirm"
        };
        this.render({ force: true });
    }

    static #onConfirmGatherSkip() {
        const actorId = this._selectedCharacterId ?? game.user.character?.id ?? getPartyActors()[0]?.id;
        const pending = this._gatherPending;
        if (!actorId || pending?.characterId !== actorId || pending.activityId !== "gather_skip") return;
        if (!this._gatherSkipIds) this._gatherSkipIds = new Set();
        this._gatherSkipIds.add(actorId);
        this._gatherPending = null;
        this._gatherChoices?.delete(actorId);
        publishCampProgress(this, {
            characterId: actorId,
            gatherSkip: true,
            gatherPending: null
        });
        const current = this._characterChoices?.get(actorId);
        if (current === "act_forage" || current === "act_hunt") {
            this._characterChoices.delete(actorId);
        }
        this.checkAndAutoMarkCharacterReady(actorId);
        this.render({ force: true });
    }

    static #onClearSustenanceFood(event, target) {
        const actorId = sustenanceActorId(target, this);
        const slot = Number(target.dataset.slot);
        if (!actorId || Number.isNaN(slot)) return;
        this._meals.clearDiegeticSlot(actorId, "food", slot);
    }

    static #onAssignSustenanceFood(event, target) {
        this.applySustenanceChip("food", target.dataset.item, sustenanceActorId(target, this), {
            name: target.dataset.name
        });
    }

    static #onClearSustenanceWater(event, target) {
        const actorId = sustenanceActorId(target, this);
        if (!actorId) return;
        this._meals.clearDiegeticWater(actorId, target.dataset.undo === "all" ? "all" : "pour");
    }

    static #onAssignSustenanceWater(event, target) {
        this.applySustenanceChip("water", target.dataset.item, sustenanceActorId(target, this), {
            name: target.dataset.name
        });
    }

    applySustenanceChip(kind, itemId, actorId, target = {}) {
        const id = actorId || this._selectedCharacterId;
        if (!id || !itemId) return;
        const slot = kind === "food" && Number.isInteger(target.foodSlot) ? target.foodSlot : undefined;
        this._meals.assignDiegeticItem(id, kind === "water" ? "water" : "food", itemId, slot, target.available, target.sources);
    }

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

    checkAndAutoMarkCharacterReady(actorId) {
        if (!actorId) return;
        const setupSafeHaven = (this._selectedTerrain ?? this._engine?.terrainTag ?? "forest") === "tavern"
            || !!this._engine?.isSafeHaven;
        const gatherOn = !setupSafeHaven && (isForagingEnabled() || isHuntingEnabled());
        const { gatherDone, activityDone } = dailyChoiceStatus(this, actorId, gatherOn);
        let trackFoodOn = false;
        let sustenanceDone = false;
        try {
            trackFoodOn = !!game.settings.get(MODULE_ID, "trackFood");
            if (!trackFoodOn) {
                sustenanceDone = true;
            } else {
                const card = this.getStationMealCardForActor(actorId);
                sustenanceDone = Boolean(this._activityMealRationsSubmitted?.has(actorId))
                    || Boolean(card?.playerSubmitted);
            }
        } catch { /* settings not ready */ }

        const complete = (gatherOn ? gatherDone : true)
            && activityDone
            && (trackFoodOn ? sustenanceDone : true);

        if (complete) {
            if (!this._finishedActorIds) this._finishedActorIds = new Set();
            if (!this._finishedActorIds.has(actorId)) {
                this._finishedActorIds.add(actorId);
                publishCampProgress(this, {
                    finishedActorId: actorId,
                    finished: true
                });
            }
        }
    }

    static async #onProceedFromMakeCamp(event, target) { return await this._campPlacement.onProceedFromMakeCamp(...arguments); }

    static async #onReclaimCampfire(event, target) { return await this._campPlacement.onReclaimCampfire(...arguments); }

    static async #onClearAllCampScene(event, target) { return await this._campPlacement.onClearAllCampScene(...arguments); }

    static async #onClearMyCampGear(event, target) { return await this._campPlacement.onClearMyCampGear(...arguments); }

static async reclaimCampGearFromDialog(restApp, event, target) {
        return RestSetupApp.#onReclaimCampGear.call(restApp, event, target);
    }

    static async #onReclaimCampGear(event, target) { return await this._campPlacement.onReclaimCampGear(...arguments); }

    static async #onReclaimCampStation(event, target) { return await this._campPlacement.onReclaimCampStation(...arguments); }

    _applyCampDragGhost(e, sourceEl) { return this._campPlacement._applyCampDragGhost(...arguments); }

    _bindCampDragHandlers(html) { return this._campPlacement._bindCampDragHandlers(...arguments); }

    async _onCampCanvasDrop(event) { return await this._campPlacement._onCampCanvasDrop(...arguments); }

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

}
