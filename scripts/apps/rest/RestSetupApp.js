import { Logger } from "../../utils/Logger.js";
import { RestFlowEngine } from "../../services/rest/flow/RestFlowEngine.js";
import { TerrainRegistry } from "../../services/events/resolve/TerrainRegistry.js";
import { ActivityResolver } from "../../services/rest/flow/ActivityResolver.js";
import { EventResolver } from "../../services/events/resolve/EventResolver.js";
import { countPoolEventsForTerrain } from "../../services/events/catalog/EventCatalogLoader.js";
import { pickPoolEvent } from "../events/AdHocEventDialogs.js";
import { openEventPoolApp } from "../../services/events/catalog/EventPoolMigration.js";
import { CraftingEngine } from "../../services/crafting/engine/CraftingEngine.js";
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
import { CraftingDelegate } from "../delegates/crafting/CraftingDelegate.js";
import { MealDelegate } from "../delegates/meal/MealDelegate.js";
import { CopySpellDelegate } from "../delegates/crafting/CopySpellDelegate.js";
import { TravelResolutionDelegate } from "../delegates/travel/TravelResolutionDelegate.js";
import { RestSetupDebugJumps } from "../delegates/rest/debug/RestSetupDebugJumps.js";
import { CampCeremonyDelegate } from "../delegates/camp/CampCeremonyDelegate.js";
import { CampPlacementDelegate } from "../delegates/camp/CampPlacementDelegate.js";
import { RestWindowLayout } from "../delegates/rest/layout/RestWindowLayout.js";
import { RestPrepareContext } from "../delegates/rest/RestPrepareContext.js";
import { RestFlowActions } from "../delegates/rest/flow/RestFlowActions.js";
import { RestSessionDelegate } from "../delegates/rest/flow/RestSessionDelegate.js";
import { TotmActivityDelegate } from "../delegates/rest/activity/TotmActivityDelegate.js";
import { RestTrainingDelegate } from "../delegates/rest/activity/RestTrainingDelegate.js";
import { RestRenderBindings } from "../delegates/rest/layout/RestRenderBindings.js";
import { RestResolveDelegate } from "../delegates/rest/flow/RestResolveDelegate.js";
import { RestSnapshotSync } from "../delegates/rest/sync/RestSnapshotSync.js";
import { ActivityStationsDelegate } from "../delegates/rest/activity/ActivityStationsDelegate.js";
import { EventsPhaseDelegate } from "../delegates/events/EventsPhaseDelegate.js";
import { WorkbenchDelegate } from "../delegates/crafting/WorkbenchDelegate.js";
import { DetectMagicDelegate, collectPartyIdentifyEmbedData, spawnDetectMagicCastRipple } from "../delegates/crafting/DetectMagicDelegate.js";
import { WEATHER_TABLE, getComfortTip, inferCanvasStationForActivity } from "../../data/RestConstants.js";
import { isComfortEnabled } from "../../services/camp/gear/ComfortCalculator.js";
import { buildTravelGatherPayload } from "../../services/travel/resolve/TravelGatherPayload.js";
import { deactivateStationLayer } from "../../services/camp/props/StationInteractionLayer.js";
import {
    closeOpenStationDialog,
    StationActivityDialog
} from "../camp/StationActivityDialog.js";
import { CampfireMakeCampDialog } from "../camp/CampfireMakeCampDialog.js";
import { RestLedger } from "../../services/rest/flow/RestLedger.js";
import { RestLedgerApp } from "./RestLedgerApp.js";
import { ShortRestApp } from "./ShortRestApp.js";
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
    emitCampFirewoodReclaim,
    emitTravelIndividualDebrief
} from "../../services/socket/SocketController.js";
import { MODULE_ID } from "../../data/moduleId.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * F12: globalThis.DEBUG_IONRIFT_RESITE_SHEET = true logs GM rest sheet render/close/advance.
 */
function _logGmRestSheet(phase, msg, extra = null) {
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
            resolveTreeChoice: RestSetupApp.#onResolveTreeChoice,
            applyStallPenalty: RestSetupApp.#onApplyStallPenalty,
            treeDcAdjUp: RestSetupApp.#onTreeDcAdjUp,
            treeDcAdjDown: RestSetupApp.#onTreeDcAdjDown,
            acknowledgeEncounter: RestSetupApp.#onAcknowledgeEncounter,
            openCrafting: RestSetupApp.#onOpenCrafting,
            craftDrawerSelectRecipe: RestSetupApp.#onCraftDrawerSelectRecipe,
            craftDrawerSelectRisk: RestSetupApp.#onCraftDrawerSelectRisk,
            craftDrawerCraft: RestSetupApp.#onCraftDrawerCraft,
            craftDrawerToggleMissing: RestSetupApp.#onCraftDrawerToggleMissing,
            craftDrawerClose: RestSetupApp.#onCraftDrawerClose,
            activityDetailConfirm: RestSetupApp.#onActivityDetailConfirm,
            activityDetailBack: RestSetupApp.#onActivityDetailBack,
            finalize: RestSetupApp.#onFinalize,
            gmOverride: RestSetupApp.#onGmOverride,
            toggleShelter: RestSetupApp.#onToggleShelter,
            setupContinue: RestSetupApp.#onSetupContinue,
            setupBack: RestSetupApp.#onSetupBack,
            setupDefaults: RestSetupApp.#onSetupDefaults,
            encounterAdjUp: RestSetupApp.#onEncounterAdjUp,
            encounterAdjDown: RestSetupApp.#onEncounterAdjDown,
            resolveSkillCheck: RestSetupApp.#onResolveSkillCheck,
            lockEventConsequence: RestSetupApp.#onLockEventConsequence,
            adjustEventDc: RestSetupApp.#onAdjustEventDc,
            cycleEventRollMode: RestSetupApp.#onCycleEventRollMode,
            rollEventCheck: RestSetupApp.#onRollEventCheck,
            ionriftRoll: RestSetupApp.#onIonriftRoll,
            disasterChoice: RestSetupApp.#onDisasterChoice,
            rollCampCheck: RestSetupApp.#onRollCampCheck,
            adjustCampDC: RestSetupApp.#onAdjustCampDC,
            requestCampRoll: RestSetupApp.#onRequestCampRoll,
            grantDiscoveryItem: RestSetupApp.#onGrantDiscoveryItem,
            completeEncounter: RestSetupApp.#onCompleteEncounter,
            detectMagicScan: RestSetupApp.#onDetectMagicScan,
            identifyScannedItem: RestSetupApp.#onIdentifyScannedItem,
            abandonRest: RestSetupApp.#onAbandonRest,
            openGuide: RestSetupApp.#onOpenGuide,
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
            adjustDaysSinceRest: RestSetupApp.#onAdjustDaysSinceRest,
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
            resolveTravelPhase: RestSetupApp.#onResolveTravelPhase,
            resolveTravelDay: RestSetupApp.#onResolveTravelDay,
            switchTravelDay: RestSetupApp.#onSwitchTravelDay,
            skipTravelPhase: RestSetupApp.#onSkipTravelPhase,
            adjustGlobalDC: RestSetupApp.#onAdjustGlobalDC,
            requestTravelRolls: RestSetupApp.#onRequestTravelRolls,
            requestOtherRoll: RestSetupApp.#onRequestOtherRoll,
            confirmTravelForPlayer: RestSetupApp.#onConfirmTravelForPlayer,
            rollTravelCheck: RestSetupApp.#onRollTravelCheck,
            selfRollTravelCheck: RestSetupApp.#onSelfRollTravelCheck,
            rollTravelLoot: RestSetupApp.#onRollTravelLoot,
            rollTravelLootForPlayer: RestSetupApp.#onRollTravelLootForPlayer,
            rollTravelForPlayer: RestSetupApp.#onRollTravelForPlayer,
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
            openLedger: RestSetupApp.#onOpenLedger
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
        this._engine = null;
        this._activityResolver = new ActivityResolver();
        this._eventResolver = new EventResolver();
        this._craftingEngine = new CraftingEngine();
        this._poolRoller = new ResourcePoolRoller();
        this._phase = restData?.phase ?? (restData ? "activity" : "setup");
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
        this._travel = new TravelResolutionDelegate(this);
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
        this._sync = new RestSnapshotSync(this);
        this._stations = new ActivityStationsDelegate(this);
        this._events = new EventsPhaseDelegate(this);
        this._workbench = new WorkbenchDelegate(this);
        this._detectMagic = new DetectMagicDelegate(this);

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
        game.ionrift.respite.addSupplies = (qty = 50) => RestSetupDebugJumps.addSupplies(qty);

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

    /** TotM when override or restInterfaceMode === "theater"; unset setting falls back to theater. */
    get _isTotM() {
        if (this._tavernTotmOverride) return true;
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
        const gate = this._travel?.getForageGate?.(terrainTag) ?? null;
        return {
            forageActivityGate: gate,
            terrainTag,
            resourcePoolsFromPack: this._travel?.resourcePoolsFromPack ?? false,
            resourcePoolRoller: this._travel?.getResourcePoolRoller?.() ?? null,
            travelResolver: this._travel?.getTravelResolver?.() ?? null
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
            // If rest is in resolution phase but auto-apply hasn't completed, confirm
            if (this._phase === "resolve" && !this._restApplied && !options.resolved) {
                let ungrantedCount = 0;
                if (this._grantLedger && this._outcomes?.length) {
                    const seenEvents = new Set();
                    for (const o of this._outcomes) {
                        for (const sub of (o.outcomes ?? [])) {
                            if (sub.source === "event" && sub.items?.length && !seenEvents.has(sub.eventId)) {
                                seenEvents.add(sub.eventId);
                                for (const item of sub.items) {
                                    const key = `${sub.eventId}:${item.itemRef ?? item.name}`;
                                    if (!this._hasDiscoveryGrant(key)) ungrantedCount++;
                                }
                            }
                        }
                    }
                }

                const ungrantedNote = ungrantedCount > 0
                    ? `<p><strong>${ungrantedCount} discovered item${ungrantedCount > 1 ? "s have" : " has"} not been granted.</strong> These will be lost.</p>`
                    : "";

                const confirmed = await game.ionrift.library.confirm({
                    title: "Discard Rest?",
                    content: `<p>The rest has not been applied yet. Closing now will discard all results.</p>${ungrantedNote}`,
                    yesLabel: "Discard",
                    noLabel: "Go Back",
                    yesIcon: "fas fa-times",
                    noIcon: "fas fa-arrow-left",
                    defaultYes: false
                });

                if (confirmed) {
                    emitRestResolved();
                    clearCampTokens(getCampSceneId()).catch(err => console.warn(`${MODULE_ID} | Camp cleanup failed:`, err));
                    resetCampSession();
                    this._clearDetectMagicScanSession();
                    await super.close(options);
                }
                return;
            }

            // Mid-rest (camp, activity, events, etc.): X minimizes to the status bar. No modal.
            // Setup and resolve: no indicator; resolve uses the discard confirm branch above.
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
                    await this._clearRestState();
                    clearMealExhaustionFloors();
                    await clearDeprivationExhaustionFloors(getPartyActors());
                    emitRestResolved();
                    clearCampTokens(getCampSceneId()).catch(err => console.warn(`${MODULE_ID} | Camp cleanup failed:`, err));
                    resetCampSession();
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

    buildCampfireDrawerContextForMapDialog() { this._campCeremony.buildCampfireDrawerContextForMapDialog(); }

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

    _buildEncounterPlayerFactors(params) { this._campCeremony._buildEncounterPlayerFactors(params); }

_buildCampConditionsBar(campScanData, { safeRestSpot = false, encountersEnabled = true } = {}) {
        if (this._phase !== "camp" || !this._engine) return null;

        const terrainTag = this._engine.terrainTag ?? "forest";
        const terrain = TerrainRegistry.get(terrainTag);
        const terrainLabel = terrain?.label ?? terrainTag;
        const terrainIcon = terrain?.icon ?? "fas fa-mountain";

        if (safeRestSpot) {
            return {
                safeRestSpot: true,
                terrainLabel,
                terrainIcon
            };
        }

        if (!isComfortEnabled()) return null;

        const weatherKey = this._engine.weather ?? "clear";
        const wx = WEATHER_TABLE[weatherKey] ?? WEATHER_TABLE.clear;
        const campComfort = campScanData?.campComfort ?? this._engine.comfort ?? "rough";
        const campComfortLabel = campScanData?.campComfortLabel ?? CampGearScanner.getRules(campComfort).label;

        const impactParts = [];
        if (wx.comfortPenalty > 0) impactParts.push(`Comfort −${wx.comfortPenalty}`);
        if (wx.encounterDC > 0) impactParts.push(`Night +${wx.encounterDC}`);
        if (wx.encounterDC < 0) impactParts.push(`Night ${wx.encounterDC}`);

        const activeShelters = this._engine.activeShelters ?? [];
        const hasTent = activeShelters.includes("tent");
        const hasHut = activeShelters.some(s => ["tiny_hut", "magnificent_mansion"].includes(s));

        let weatherShieldNote = null;
        if (hasHut) {
            weatherShieldNote = "Shelter spell cancels weather penalties";
        } else if (hasTent && wx.tentCancels && (wx.comfortPenalty > 0 || wx.encounterDC !== 0)) {
            weatherShieldNote = "Tent cancels these weather effects";
        } else if (hasTent && wx.tentReduces && wx.comfortPenalty > 0) {
            weatherShieldNote = "Tent reduces weather comfort penalty by 1";
        }

        let comfortContext = null;
        if (campScanData?.campBreakdown?.length > 1) {
            comfortContext = campScanData.campBreakdown.map(b => b.label).join(", ");
        } else if (campScanData?.comfortReason) {
            comfortContext = campScanData.comfortReason;
        }

        return {
            terrainLabel,
            terrainIcon,
            campComfort,
            campComfortLabel,
            campComfortTooltip: getComfortTip(campComfort),
            comfortContext,
            weatherLabel: wx.label,
            weatherKey,
            weatherTooltip: wx.hint,
            weatherImpact: impactParts.length ? impactParts.join(" · ") : null,
            weatherIsNeutral: impactParts.length === 0,
            weatherShieldNote,
            showEncounterHint: encountersEnabled
        };
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

    async _prepareContext(options) { return this._prepareCtx.build(options); }

    _buildCraftingDrawerContext() { return this._crafting.buildContext(); }

    _buildArmorWarningForActor(a) { this._stations._buildArmorWarningForActor(a); }

getArmorWarningForActivityDetail(actor, tile) {
        const aw = this._buildArmorWarningForActor(actor);
        if (!aw || !tile) return null;
        if (aw.isDoffed) return aw;
        if (!tile.armorSleepWaiver) return aw;
        return null;
    }

    _bindArmorToggleHandlers(element, onAfter) { this._session._bindArmorToggleHandlers(element, onAfter); }

    _buildActivityDetailContext(selectedCharacter) { this._stations._buildActivityDetailContext(selectedCharacter); }

    _formatCheckLabel(check, character) { this._session._formatCheckLabel(check, character); }

    getCampGearContextForActor(actorId) { this._stations.getCampGearContextForActor(actorId); }

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

    getCampGearFlavorPanelForActor(actorId) { this._stations.getCampGearFlavorPanelForActor(actorId); }

    _getCampScanDataForActivityStationDialog() { this._session._getCampScanDataForActivityStationDialog(); }

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

    getFireTabContextForStationDialog() { this._campCeremony.getFireTabContextForStationDialog(); }

setStationFirePreviewLevel(level) {
        const next = ["embers", "campfire", "bonfire"].includes(level) ? level : null;
        if (this._stationFirePreviewLevel === next) return;
        this._stationFirePreviewLevel = next;
    }

    getCampPersonalCardForActor(actorId) { this._campCeremony.getCampPersonalCardForActor(actorId); }

    _buildResolutionCards(outcomes) { this._resolve._buildResolutionCards(outcomes); }

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

static #onAdjustDaysSinceRest(event, target) {
        const delta = parseInt(target.dataset.delta, 10) || 0;
        this._daysSinceLastRest = Math.max(1, Math.min(9, (this._daysSinceLastRest ?? 1) + delta));
        // Day stepper lives inside Advanced; keep the drawer open across re-render.
        this._setupAdvancedOpen = true;
        this.render();
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

    receiveCampRollResult(data) { this._events.receiveCampRollResult(data); }

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
        }
        const result = await super.render(options);
        if (savedPos && Number.isFinite(savedPos.left) && Number.isFinite(savedPos.top)) {
            this.setPosition(savedPos);
        }
        return result;
    }

    _onRender(context, options) { this._session._onRender(context, options); }

    static async #onIonriftRoll(event, target) { return this._events.onIonriftRoll(event, target); }

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

    static async #onBeginShortRest(event, target) { this._launchShortRestFromSetup(); }

    _launchShortRestFromSetup() {
        const activeShelter = Object.entries(this._shelterOverrides ?? {})
            .find(([, v]) => v)?.[0] ?? "none";
        this.close();
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

openCraftingDrawer(event, target) {
        return RestSetupApp.#onOpenCrafting.call(this, event, target);
    }

    static #onOpenCrafting(event, target) {
        this._stations.onOpenCrafting(event, target);
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

    /** Sleep status id. watchRoster includes defenses/scout; only Keep Watch stays alert. */
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
        if (this._isGM) {
            const charId = this._selectedCharacterId
                ?? target.closest("[data-character-id]")?.dataset.characterId;
            if (charId) await this.submitActivityMealRationsFromStation(charId);
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

    static #rehydrateItemLossProposal(eff) { this._events.rehydrateItemLossProposal(eff); }

    static async #onResolveEvents(event, target) { return this._resolve.onResolveEvents(event, target); }

    static async #onFinalize(event, target) { return this._events.onFinalize(event, target); }

    /** @override */
    async close(options = {}) {
        if (options?.resolved && game.user?.isGM) {
            try {
                await clearCampTokens();
            } catch (err) {
                console.warn(`${MODULE_ID} | Error cleaning up camp tokens on rest complete:`, err);
            }
        }
        return super.close(options);
    }

static #onOpenLedger(event, target) {
        if (!game.user.isGM) return;
        this.openLedgerPanel();
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

    _findIncompleteTrainingCharacterId() { this._session._findIncompleteTrainingCharacterId(); }

    _syncIncompleteTrainingView() { this._training._syncIncompleteTrainingView(); }

_clearStaleTrainingRollingFlags() {
        for (const state of this._trainingStates?.values() ?? []) {
            state.rolling = false;
        }
    }

    _initTrainingState(characterId, activityId, actor) { this._session._initTrainingState(characterId, activityId, actor); }

    _buildTrainingViewContext(characterId) { this._training._buildTrainingViewContext(characterId); }

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

static buildPlayerTravelRestoreFromSerialized(travelState, userId, opts = {}) {
        if (!travelState?.entries || !userId) return null;

        const ownedActorIds = new Set();
        for (const actor of getPartyActors()) {
            const owners = Object.entries(actor.ownership ?? {})
                .filter(([id, level]) => id !== "default" && level >= 3)
                .map(([id]) => id);
            if (owners.includes(userId)) ownedActorIds.add(actor.id);
        }
        if (!ownedActorIds.size) return null;

        const declarations = {};
        const confirmed = {};
        const rolled = {};
        const awaitingLoot = {};
        const debrief = [];

        for (const [key, entry] of Object.entries(travelState.entries)) {
            const colon = key.indexOf(":");
            if (colon < 0) continue;
            const day = parseInt(key.slice(0, colon), 10);
            const actorId = key.slice(colon + 1);
            if (!day || !ownedActorIds.has(actorId)) continue;

            declarations[day] ??= {};
            declarations[day][actorId] = entry.activity ?? "nothing";

            if (travelState.confirmed?.[`${day}:${actorId}`]) {
                confirmed[day] ??= {};
                confirmed[day][actorId] = true;
            }

            if (entry.status === "rolled" || entry.status === "resolved" || entry.status === "awaiting_loot") {
                rolled[day] ??= {};
                rolled[day][actorId] = true;
            }

            if (entry.status === "awaiting_loot") {
                awaitingLoot[day] ??= {};
                awaitingLoot[day][actorId] = {
                    lootDraws: entry.lootDraws ?? 1,
                    activity: entry.activity
                };
            }

            if (entry.status === "resolved" && entry.result
                && entry.activity !== "scout") {
                debrief.push({
                    day,
                    activity: entry.activity,
                    result: entry.result
                });
            }
        }

        if (!Object.keys(declarations).length && !debrief.length) return null;

        const totalDays = travelState.totalDays ?? 1;
        let fullyResolved = !!opts.fullyResolved;
        if (opts.fullyResolved === undefined && travelState.dayResolved) {
            fullyResolved = true;
            for (let d = 1; d <= totalDays; d++) {
                const resolved = travelState.dayResolved[d] ?? travelState.dayResolved[String(d)];
                if (!resolved) {
                    fullyResolved = false;
                    break;
                }
            }
        }

        return {
            declarations,
            confirmed,
            rolled,
            awaitingLoot: Object.keys(awaitingLoot).length ? awaitingLoot : null,
            debrief: debrief.length ? debrief : null,
            totalDays,
            activeDay: travelState.activeDay ?? 1,
            forageDC: opts.forageDC ?? null,
            huntDC: opts.huntDC ?? null,
            scoutingAllowed: travelState.scoutingAllowed ?? null,
            fullyResolved,
            scoutingDone: !!opts.scoutingDone || !!travelState.scoutingResult
        };
    }

_buildPlayerTravelRestore(userId) {
        if (!this._travel || !userId) return null;
        const base = RestSetupApp.buildPlayerTravelRestoreFromSerialized(
            this._travel.serialize(),
            userId,
            {
                fullyResolved: this._travel.isFullyResolved(),
                scoutingDone: !!this._scoutingDebrief
            }
        );
        if (!base) return null;
        base.forageDC = this._travel.forageDC;
        base.huntDC = this._travel.huntDC;
        base.scoutingAllowed = this._travel.scoutingAllowed;
        return base;
    }

    _applyPlayerTravelRestore(pt) { this._travel._applyPlayerTravelRestore(pt); }

receiveTravelPlayerState(pt) {
        this._applyPlayerTravelRestore(pt);
        this.render();
    }

    getRestSnapshot() { return this._sync.getRestSnapshot(...arguments); }

    getRestSnapshotForUser(userId) { return this._sync.getRestSnapshotForUser(...arguments); }

    async receivePhaseChange(phase, phaseData = {}) { return await this._sync.receivePhaseChange(...arguments); }

    receiveSubmissionUpdate(submissions) { return this._sync.receiveSubmissionUpdate(...arguments); }

    receiveRestSnapshot(snapshot) { return this._sync.receiveRestSnapshot(...arguments); }

    receiveArmorToggle(actorId, itemId, isDoffed) { return this._sync.receiveArmorToggle(...arguments); }

    static #onAdjustGlobalDC(event, target) { this._travel.onAdjustGlobalDC(event, target); }

    static #onRequestTravelRolls(event, target) { this._travel.onRequestTravelRolls(event, target); }

    static #onRequestOtherRoll(event, target) { this._travel.onRequestOtherRoll(event, target); }

static #onConfirmTravelForPlayer(event, target) {
        event.preventDefault?.();
        if (!game.user.isGM) return;
        const actorId = target.dataset.actorId;
        const day = parseInt(target.dataset.day) || this._travel?.activeDay;
        if (!actorId) return;
        this._travel.setConfirmed(actorId, day, true);
        this._broadcastTravelDeclarations();
        this._saveRestState();
        this.render();
    }

    static async #onRollTravelCheck(event, target) { return this._travel.onRollTravelCheck(event, target); }

    static async #onSelfRollTravelCheck(event, target) { return this._travel.onSelfRollTravelCheck(event, target); }

    static async #onRollTravelForPlayer(event, target) { return this._travel.onRollTravelForPlayer(event, target); }

    receiveTravelRollResult(data) { this._travel.receiveTravelRollResult(data); }

    receiveTravelLootRollResult(data) { this._travel.receiveTravelLootRollResult(data); }

receiveTravelLootRollPrompt(data) {
        const day = data.day ?? 1;
        if (!this._playerTravelAwaitingLoot) this._playerTravelAwaitingLoot = {};
        this._playerTravelAwaitingLoot[day] ??= {};
        this._playerTravelAwaitingLoot[day][data.actorId] = {
            lootDraws: data.lootDraws ?? 1,
            activity: data.activity
        };
        this.render();
    }

async #emitTravelIndividualDebriefForRow(row, actorId) {
        const actor = game.actors.get(actorId);
        if (!actor) return;
        const ownerIds = Object.entries(actor.ownership ?? {})
            .filter(([id, level]) => id !== "default" && level >= 3)
            .map(([id]) => id);
        for (const uid of ownerIds) {
            emitTravelIndividualDebrief({
                targetUserId: uid,
                result: row,
                playerTravel: this._buildPlayerTravelRestore(uid)
            });
        }
    }

    static async #onRollTravelLoot(event, target) { return this._travel.onRollTravelLoot(event, target); }

    static async #onRollTravelLootForPlayer(event, target) { return this._travel.onRollTravelLootForPlayer(event, target); }

static #onSwitchTravelDay(event, target) {
        if (!game.user.isGM) return;
        const day = parseInt(target.dataset.day);
        if (!day) return;
        this._travel.setActiveDay(day);
        this._saveRestState();
        this.render();
    }

    static async #onResolveTravelDay(event, target) { return this._travel.onResolveTravelDay(event, target); }

    static async #onResolveTravelPhase(event, target) { return this._travel.onResolveTravelPhase(event, target); }

    static async #onSkipTravelPhase(event, target) { return this._travel.onSkipTravelPhase(event, target); }

receiveTravelRollRequest(data) {
        this._pendingTravelRoll = {
            activities: data.activities ?? [],
            rolledCharacters: new Set()
        };
        this.render();
    }

    _broadcastTravelDeclarations() { this._travel._broadcastTravelDeclarations(); }

_buildTravelGatherPayload() {
        const terrainTag = this._selectedTerrain ?? this._engine?.terrainTag ?? "forest";
        const terrain = TerrainRegistry.get(terrainTag);
        const safeRest = this._travel?.isEffectiveSafeRestSpot?.()
            ?? !!(this._engine?.safeRestSpot ?? this._restData?.safeRestSpot);
        return buildTravelGatherPayload({
            terrainActivities: terrain?.travelActivities,
            safeRestSpot: safeRest,
            scoutingAllowed: this._travel?.scoutingAllowed ?? this._travelScoutingAllowed ?? true
        });
    }

    receiveTravelDeclaration(data) { this._travel.receiveTravelDeclaration(data); }

    _applyScoutingFromTravel() { this._travel._applyScoutingFromTravel(); }

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

static async #onOpenGuide(event, _target) {
        event?.preventDefault?.();
        event?.stopPropagation?.();
        const pageId = game.user?.isGM ? "dvr4TYdYmX88MCCf" : "aQc3PtQPrYDi9Mlx";
        await game.ionrift?.respite?.openPlayerGuide?.(pageId);
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

}
