import { Logger } from "../lib/Logger.js";
import { RestFlowEngine } from "../services/RestFlowEngine.js";
import {
    executePlayerRoll, executeAbilityRoll, rollForPlayer, pickBestSkill, SKILL_DISPLAY_NAMES,
    waitForDiceSoNice, getNatD20FromRoll, disableRollButton, postRollToChat
} from "../services/RollRequestManager.js";
import { buildEventPlayerRollContext, buildRollTargetLabel, buildEventGmRollContext, centerRollRequestRoster, buildTreePlayerRollContext, buildCampActivityRollContext, buildTravelActivityRollContext, buildCopySpellRollContext } from "../services/RollRequestView.js";
import { ensureDcPulseAnimation } from "../services/RollRequestDcPulse.js";
import { TerrainRegistry } from "../services/TerrainRegistry.js";
import { ActivityResolver } from "../services/ActivityResolver.js";
import { EventResolver } from "../services/EventResolver.js";
import { countPoolEventsForTerrain, listPoolEventsForTerrain } from "../services/EventCatalogLoader.js";
import { pickPoolEvent } from "./AdHocEventDialogs.js";
import { openEventPoolApp } from "../services/EventPoolMigration.js";
import { DecisionTreeResolver } from "../services/DecisionTreeResolver.js";
import { CraftingEngine } from "../services/CraftingEngine.js";
import { ResourcePoolRoller } from "../services/ResourcePoolRoller.js";
import { ItemOutcomeHandler } from "../services/ItemOutcomeHandler.js";
import { GrantLedger } from "../services/GrantLedger.js";
import { RecoveryHandler } from "../services/RecoveryHandler.js";
import { CalendarHandler } from "../services/CalendarHandler.js";
import { CopySpellHandler } from "../services/CopySpellHandler.js";
import { MealPhaseHandler } from "../services/MealPhaseHandler.js";
import { ConditionAdvisory } from "../services/ConditionAdvisory.js";
import { ResourceSink } from "../services/ResourceSink.js";
import { CampfireTokenLinker } from "../services/CampfireTokenLinker.js";
import {
    CampGearScanner,
    countActorFirewood,
    findConsumableFirewoodItem
} from "../services/CampGearScanner.js";
import {
    placeCampfire,
    placeStation,
    placePlayerGear,
    clearCampTokens,
    clearPlayerCampGear,
    clearPlayerCampGearType,
    clearSharedCampStation,
    hasCampPlaced,
    hasCampfirePlaced,
    isGearDeployed,
    isStationDeployed,
    canPlaceStation,
    stationPlacementRequirementHint,
    validatePlayerGearDrop,
    validateStationEquipmentDrop,
    CAMP_STATION_PLACEMENT_KEYS,
    getCampStationPlacementKeys,
    resetCampSession,
    placeStationPlaceholders,
    promoteAllPlaceholders,
    pickCampfirePitBaseTexture,
    getStationPlaceholderPreviewsForPitCenter
} from "../services/CompoundCampPlacer.js";
import {
    notifyDetectMagicScanApplied,
    notifyDetectMagicScanCleared
} from "../services/DetectMagicInventoryGlowBridge.js";
import { ImageResolver } from "../util/ImageResolver.js";
import { CraftingPickerApp } from "./CraftingPickerApp.js";
import { CraftingDelegate } from "./delegates/CraftingDelegate.js";
import { MealDelegate } from "./delegates/MealDelegate.js";
import { CopySpellDelegate } from "./delegates/CopySpellDelegate.js";
import { SoundDelegate } from "./delegates/SoundDelegate.js";
import { TravelResolutionDelegate } from "./delegates/TravelResolutionDelegate.js";
import { CampCeremonyDelegate } from "./delegates/CampCeremonyDelegate.js";
import { EventsPhaseDelegate } from "./delegates/EventsPhaseDelegate.js";
import { WorkbenchDelegate } from "./delegates/WorkbenchDelegate.js";
import { DetectMagicDelegate, collectPartyIdentifyEmbedData, computeCanShowDetectMagicScanButton, computeCanTriggerDetectMagicScan, spawnDetectMagicCastRipple, purgeDetectMagicRestArtifacts } from "./delegates/DetectMagicDelegate.js";
import { WEATHER_TABLE, SKILL_NAMES, COMFORT_RANK, RANK_TO_KEY, ACTIVITY_ICONS, SHELTER_SPELLS, COMFORT_TIPS, getComfortTip, CAMP_STATIONS, getStationsForTerrain, inferCanvasStationForActivity, getActivityAdvisory, buildPartyState, buildActivityAssignments, applyActivityPortraitAssignments, isWorkbenchExamineUiEnabled, isWorkbenchIdentifyUiEnabled } from "./RestConstants.js";
import { isComfortEnabled } from "../services/ComfortCalculator.js";
import { isSimpleStationsMode, requiresMapCampFire, isCampfireMinigameEnabled } from "../services/RestProfileSettings.js";
import { isScoutingEnabled } from "../services/ScoutingSettings.js";
import { buildActivityListItem, buildActivityDetailContext } from "./ActivityDetailBuilder.js";
import {
    activateStationLayer,
    deactivateStationLayer,
    isStationLayerActive,
    refreshStationEmptyNoticeFade,
    refreshStationDetectMagicGlow,
    refreshStationMealPortraits,
    refreshStationPortraitsFromChoices,
    resetStationOverlaysLocal,
    setStationPlayerState
} from "../services/StationInteractionLayer.js";
import {
    closeOpenStationDialog,
    closeStationDialogIfDifferentActor,
    refreshOpenStationDialog,
    notifyStationMealChoicesUpdated,
    notifyWorkbenchIdentifyStagingTouched,
    StationActivityDialog
} from "./StationActivityDialog.js";
import { CampfireMakeCampDialog } from "./CampfireMakeCampDialog.js";
import { CampfireEmbed } from "./CampfireEmbed.js";

import { STUB_RECIPES } from "../data/stub-content.js";
import { ShortRestApp } from "./ShortRestApp.js";
import {
    registerActiveRestApp,
    clearActiveRestApp,
    registerCampfireEmbed,
    clearCampfireEmbed,
    retainGmRestAppFooter,
    setActiveRestData,
    _showGmRestIndicator,
    _removeGmRestIndicator,
    _refreshGmRestIndicator,
    _refreshRejoinBar,
    _ensureRejoinBar,
    _removeRejoinBar,
    showAfkPanel
} from "../module.js";
import { getPartyActors } from "../services/partyActors.js";
import * as RestAfkState from "../services/RestAfkState.js";
import { pushAllStateToAdapters } from "../services/afk/AfkBridgeService.js";
import {
    emitRestStarted, emitRestSnapshot, emitRestPreparing, emitRestResolved,
    emitRestAbandoned, emitPhaseChanged, emitSubmissionUpdate,
    emitActivityChoice, emitArmorToggle,
    emitCampLightFire, emitCampFireLevelRequest, emitActivityFireLevelRequest,
    emitCampColdCampRequest, emitCampColdCampCommit, emitActivityColdCampRequest,
    emitCampFirewoodPledge, emitCampFirewoodReclaim,
    emitCampGearPlace, emitCampGearPlaced, emitCampGearClearPlayer,
    emitCampGearReclaim, emitCampStationPlace, emitCampStationPlaced,
    emitCampStationReclaim, emitCampSceneCleared, emitCampRollResult,
    emitDetectMagicScanBroadcast, emitDetectMagicScanCleared,
    emitEventRollRequest, emitEventRollResult,
    emitTreeRollRequest, emitTreeRollResult,
    emitTravelDeclaration, emitTravelDeclarationsSync,
    emitTravelRollRequest, emitTravelRollResult,
    emitTravelDebrief, emitTravelIndividualDebrief,
    emitCopySpellProposal,
    emitFeastServeRequest,
    emitTrainingStateUpdate,
    emitTrainingComplete
} from "../services/SocketController.js";

const MODULE_ID = "ionrift-respite";
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * F12: globalThis.DEBUG_IONRIFT_RESITE_SHEET = true
 * to log GM rest sheet render / close / activity advance (filter console: "respite GM sheet")
 */
function _logGmRestSheet(phase, msg, extra = null) {
    try {
        if (typeof globalThis !== "undefined" && globalThis.DEBUG_IONRIFT_RESITE_SHEET) {
            Logger.log(`${MODULE_ID} | respite GM sheet [${phase}]`, msg, extra ?? "");
        }
    } catch { /* ignore */ }
}

/**
 * Dev-mode guard for methods that previously bailed on !this._engine but now
 * run engine-free on player clients. Fires console.debug so the pattern is
 * visible in verbose DevTools without polluting production logs.
 *
 * @param {string} methodName
 * @param {{ _engine: any, _isGM: boolean }} app
 */
function _noteEngineFreePath(methodName, app) {
    if (app._engine) return;
        Logger.log(`ionrift-respite | [engine-free] ${methodName} â€” no engine (player client, OK)`);
}

/**
 * RestSetupApp (v2)
 * GM-facing application for initiating and managing a rest phase.
 * Handles the four-phase flow: Setup, Activity, Events, Resolution.
 * Broadcasts to player clients and live-tracks incoming choices.
 */
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
            proceedFromCamp: RestSetupApp.#onProceedFromCamp,
            clearAllCampScene: RestSetupApp.#onClearAllCampScene,
            clearMyCampGear: RestSetupApp.#onClearMyCampGear,
            reclaimCampGear: RestSetupApp.#onReclaimCampGear,
            reclaimCampStation: RestSetupApp.#onReclaimCampStation,
            exitStationChoiceReview: RestSetupApp.#onExitStationChoiceReview,
            dismissCampfireCanvasPanel: RestSetupApp.#onDismissCampfireCanvasPanel,
            retryCampPitPlacement: RestSetupApp.#onRetryCampPitPlacement,
            dismissArtNudge: RestSetupApp.#onDismissArtNudge,
            dismissEventPoolNudge: RestSetupApp.#onDismissEventPoolNudge,
            openEventPoolCurator: RestSetupApp.#onOpenEventPoolCurator,
            openArtPackPatreon: RestSetupApp.#onOpenArtPackPatreon,
            openArtPackImport: RestSetupApp.#onOpenArtPackImport,
            selectTotmActivity: RestSetupApp.#onSelectTotmActivity,
            confirmTotmFollowUp: RestSetupApp.#onConfirmTotmFollowUp,
            cancelTotmFollowUp: RestSetupApp.#onCancelTotmFollowUp,
            proceedFromTotmCamp: RestSetupApp.#onProceedFromTotmCamp,
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
            trainingRoll: RestSetupApp.#onTrainingRoll
        }
    };

    static PARTS = {
        "rest-setup": {
            template: `modules/${MODULE_ID}/templates/rest-setup.hbs`
        }
    };

    /**
     * Legacy snapshot shape for activeRest / broadcast (minigame removed; fire level is canonical).
     * @param {string} fireLevel
     * @returns {object|null}
     */
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
        this._phase = restData ? "activity" : "setup";
        this._outcomes = [];
        this._triggeredEvents = [];
        this._activeTreeState = null;
        /** Events phase: which mode the GM is about to commit. "random" | "improvise" | "pick". */
        this._eventsMode = "random";
        /** Events phase: night check / pool pick in flight (blocks UI until resolve). */
        this._eventsCommitPending = false;
        this._craftingResults = new Map();
        this._fireLevel = "unlit";
        /** Make Camp step 1: hover preview for fire tier comfort (embers | campfire | bonfire). */
        this._campFirePreviewLevel = null;
        /** Activity-phase campfire station: local (non-broadcast) tier preview before Set/Request. */
        this._stationFirePreviewLevel = null;
        /** Prefer this user's owned actors when spending firewood at proceed (player fire-tier request). */
        this._campFireWoodSpendUserId = null;
        /** Make Camp: who lit the fire. { userId, actorId, actorName, method } or null. */
        this._fireLitBy = null;
        /** Make Camp: firewood pledged per user before proceeding. userId -> { actorId, actorName, count } */
        this._firewoodPledges = new Map();
        /** TotM ceremony: staged kindling in the pit (not spent until Proceed). */
        this._makeCampStagedWood = [];
        /** Tracks last preview tier cost to clear staged wood when tier drops. */
        this._makeCampStagedWoodTier = null;
        /** Make Camp: table decided to skip fire and sleep cold. Satisfies the fire gate without lighting. */
        this._coldCampDecided = false;
        this._campPitCursorInFlight = false;
        this._campPitPlacementCancelled = false;
        this._showCampfireCanvasPanel = false;
        this._campToActivityDone = false;
        /** Make Camp: GM moved past fire ceremony to gear placement and station layout (step 2 UI). */
        this._campStep2Entered = false;
        this._campfireApp = null;
        this._campfireSnapshot = null;
        this._selectedCharacterId = null;
        this._activitySubTab = "identify"; // identify | activity | meal
        /** TotM Activity phase: which tab is active. "activities" | "identify" | "fire" */
        this._totmActiveTab = "activities";
        /** When set, activity-phase station grid highlights this station (canvas interaction). */
        this._canvasFocusedStationId = null;
        /** controlToken hook: GM roster sync; all users station overlay refresh in activity phase. */
        this._gmControlTokenHook = null;
        /** Activity phase: character ids whose station rations were submitted (persists in activeRest). */
        this._activityMealRationsSubmitted = new Set();
        /** Workbench Identify: actorId -> { gearItemId: string|null, potionItemId: string|null } before submit. */
        this._workbenchIdentifyStaging = new Map();
        /** actorId -> { items: { itemId, name, img, requiresAttunement }[], revealAt: number } post-submit ritual */
        this._workbenchIdentifyAcknowledge = new Map();
        /** actorIds that have used the Workbench Focus identify slot this rest */
        this._workbenchFocusUsed = new Set();
        /** GM: main window closed while rest is active; ignore non-forced render until Resume. */
        this._gmMinimizedToFooter = false;
        /** Player: main window reopened after picking from a station; Back minimises again. */
        this._postStationChoiceReview = false;
        /** Actor id for revert on Back after a station pick. */
        this._stationReviewCharacterId = null;
        this._deployedGear = new Map();
        this._boundCampCanvasDrop = this._onCampCanvasDrop.bind(this);

        // Inline crafting drawer state
        this._craftingDrawerOpen = false;
        this._craftingDrawerProfession = null;
        this._craftingDrawerRecipeId = null;
        this._craftingDrawerRisk = "standard";
        this._craftingDrawerResult = null;
        this._craftingDrawerHasCrafted = false;
        this._craftingDrawerShowMissing = false;

        // Activity detail panel state
        this._activityDetailId = null;

        // TotM inline follow-up panel state: { activityId, characterId } or null
        this._totmFollowUpExpanded = null;
        /** ResizeObserver + rAF debounce for TotM window recenter when content height changes. */
        this._restWindowResizeObserver = null;
        this._restWindowRecenterPending = false;
        /** Guards duplicate ceremony commit from ignite + heat notify. */
        this._commitMakeCampCeremonyInFlight = false;

        // Dual-track: GM overrides and player submissions
        this._characterChoices = new Map();
        /** Activity phase: character id -> canvas station id after a station pick (player multi-PC dim sync). */
        this._stationCanvasIdByCharacter = new Map();
        this._earlyResults = new Map();
        /** @type {Map<string, object>} In-progress training roll state keyed by character id. */
        this._trainingStates = new Map();
        this._playerSubmissions = new Map();
        this._gmOverrides = new Map();
        this._gmFollowUps = new Map();
        this._lockedCharacters = new Set();

        /** Per-rest idempotent reward grants (travel, crafting, discoveries, meals). */
        this._grantLedger = new GrantLedger();

        // Delegates
        this._crafting = new CraftingDelegate(this);
        this._meals = new MealDelegate(this);
        this._copySpell = new CopySpellDelegate(this);
        this._travel = new TravelResolutionDelegate(this);
        this._campCeremony = new CampCeremonyDelegate(this);
        this._events = new EventsPhaseDelegate(this);
        this._workbench = new WorkbenchDelegate(this);
        this._detectMagic = new DetectMagicDelegate(this);

        // Player mode: receive rest data from socket instead of loading files
        this._restData = restData;
        if (restData) {
            this._restId = restData.restId ?? null;
            this._selectedTerrain = restData.terrainTag ?? null;
            this._selectedRestType = restData.restType ?? "long";
            this._activities = restData.activities ?? [];
            this._activityResolver.load(this._activities);
            if (restData.recipes) {
                for (const [profId, recipeList] of Object.entries(restData.recipes)) {
                    this._craftingEngine.load(profId, recipeList);
                }
            }
            // Create a minimal engine so comfort/fire/shelter state is available
            // on the player side (prevents fallback to terrain defaults).
            this._engine = new RestFlowEngine({
                restType: restData.restType ?? "long",
                terrainTag: restData.terrainTag ?? "forest",
                comfort: restData.comfort ?? "rough",
                safeRestSpot: restData.safeRestSpot ?? false
            });
            // Identify this player's characters
            this._myCharacterIds = new Set(
                game.actors.filter(a => a.hasPlayerOwner && a.isOwner && a.type === "character")
                    .map(a => a.id)
            );
        } else {
            this._dataReady = this._loadData();
        }

        // Expose debug API
        if (!game.ionrift) game.ionrift = {};
        if (!game.ionrift.respite) game.ionrift.respite = {};
        game.ionrift.respite.jumpToResolution = () => this._debugJumpToResolution();
        game.ionrift.respite.jumpToEncounter = () => this._debugJumpToEncounter();
        game.ionrift.respite.jumpToDisaster = () => this._debugJumpToDisaster();
        game.ionrift.respite.jumpToRecoveryPenalty = () => this._debugJumpToRecoveryPenalty();
        game.ionrift.respite.jumpToDamageTest = () => this._debugJumpToDamageTest();
        game.ionrift.respite.jumpToHostileComfort = () => this._debugJumpToHostileComfort();
        game.ionrift.respite.jumpToSingleEvent = () => this._debugJumpToSingleEvent();
        game.ionrift.respite.addSupplies = (qty = 50) => RestSetupApp._debugAddSupplies(qty);

        // Inventory sync: auto-refresh meal options when items change (e.g. player transfers)
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

    // ── Mode Detection ──────────────────────────────────────────────────

    /**
     * Whether the rest is running in Theater of the Mind mode.
     * Single source of truth for the mode check. The fallback matches the
     * registered default ("theater") so a not-yet-ready setting read resolves
     * to the same mode a fresh world starts in.
     * @returns {boolean}
     */
    get _isTotM() {
        try { return game.settings.get(MODULE_ID, "restInterfaceMode") === "theater"; }
        catch { return true; }
    }

    /**
     * Engine flag, active rest payload, then world setting (same merge as getData).
     * @returns {boolean}
     */
    _effectiveSafeRestSpot() {
        let fromSetting = false;
        try {
            fromSetting = !!game.settings.get(MODULE_ID, "safeRestSpot");
        } catch { /* settings not ready */ }
        return !!(this._engine?.safeRestSpot ?? this._restData?.safeRestSpot ?? fromSetting);
    }

    /**
     * Rest flow engine (travel mishap encounter mods, recovery, etc.).
     * @returns {import("../services/RestFlowEngine.js").RestFlowEngine|null}
     */
    getRestFlowEngine() {
        return this._engine ?? null;
    }

    /**
     * Forces "Other" camp activity for characters who lost their slot to a travel mishap.
     */
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

    /**
     * When Other is the only evening activity left (Simple profile and similar),
     * pre-assign it so the activity gate opens without a manual pick per character.
     * Simple + camp stations: always assign Other for the whole party (same as TotM).
     * @returns {boolean} True if any new assignments were made.
     */
    _applyAutoOtherWhenSoleActivity() {
        if (this._phase !== "activity" || !this._isGM) return false;

        const forceOtherForAll = isSimpleStationsMode();
        const partyActors = getPartyActors();
        if (!partyActors.length) return false;

        const restType = this._engine?.restType ?? "long";
        const safeRestSpot = this._effectiveSafeRestSpot();
        const fireLevel = this._fireLevel ?? "unlit";
        const isFireLit = !!(this._fireLevel && this._fireLevel !== "unlit");
        const resolverOpts = { isFireLit, fireLevel, safeRestSpot, ...this._forageResolverOpts() };

        let changed = false;
        for (const actor of partyActors) {
            if (this._characterChoices.has(actor.id)) continue;
            if (this._gmOverrides.has(actor.id)) continue;
            if (this._getPlayerChoiceForCharacter(actor.id)?.activityId) continue;

            const { available } = this._activityResolver.getAvailableActivitiesWithFaded(
                actor, restType, resolverOpts
            );

            const shouldAssign = forceOtherForAll
                ? available.some(a => a.id === "act_other")
                : (available.length === 1 && available[0].id === "act_other");

            if (!shouldAssign) continue;

            this._characterChoices.set(actor.id, "act_other");
            this._lockedCharacters.add(actor.id);
            if (!this._stationCanvasIdByCharacter) this._stationCanvasIdByCharacter = new Map();
            this._stationCanvasIdByCharacter.set(actor.id, "bedroll");
            changed = true;
        }

        if (!changed) return false;

        const submissions = {};
        for (const [charId, actId] of this._characterChoices) {
            const act = this._activities?.find(a => a.id === actId);
            submissions[charId] = {
                activityId: actId,
                activityName: act?.name ?? actId,
                source: forceOtherForAll || this._gmOverrides.has(charId) ? "gm" : "player"
            };
        }
        emitSubmissionUpdate(submissions);
        _refreshGmRestIndicator(this);

        if (this._phase === "activity" && isStationLayerActive()) {
            refreshStationEmptyNoticeFade(this);
            refreshStationPortraitsFromChoices(this._characterChoices, this._stationCanvasIdByCharacter);
            this._refreshStationOverlayMeals();
        }
        return true;
    }

    /**
     * Debug: Jump to events phase with exactly one resolved event.
     * Validates a single resolved event card renders fully expanded.
     * Usage: game.ionrift.respite.jumpToSingleEvent()
     */
    async _debugJumpToSingleEvent() {
        if (!game.user.isGM) return console.warn("GM only");

        const { RestFlowEngine } = await import("../services/RestFlowEngine.js");
        const terrainTag = "forest";
        const targets = getPartyActors().map(a => a.id);

        if (targets.length === 0) {
            ui.notifications.warn("No player-owned characters found.");
            return;
        }

        this._engine = new RestFlowEngine({ restType: "long", terrainTag, comfort: "rough" });
        for (const id of targets) {
            this._engine.registerChoice(id, "act_keep_watch");
            this._characterChoices.set(id, "act_keep_watch");
        }

        // Inject exactly ONE resolved complication
        this._triggeredEvents = [{
            id: "test_single_event", name: "Wolf Tracks", category: "complication",
            description: "Fresh wolf tracks circle the camp perimeter.",
            narrative: "Fresh wolf tracks circle the camp perimeter.",
            mechanical: {
                type: "skill_check", skill: "sur", dc: 12, targets: "watch",
                onSuccess: { narrative: "The pack moves on.", effects: [] },
                onFailure: { narrative: "The wolves grow bolder.", effects: [] }
            },
            targets, result: "triggered",
            resolvedOutcome: "success",
            resolvedRolls: targets.map(id => ({ id, name: game.actors.get(id)?.name ?? "Unknown", total: 15, passed: true })),
            groupAverage: 15,
            skillName: "Survival",
            effects: []
        }];

        this._eventsRolled = true;
        this._phase = "events";
        this._engine._phase = "events";
        registerActiveRestApp(this);

        this.render(true);
        Logger.log("[Respite:Debug] Single event injected.");
        ui.notifications.info("Single event loaded.");
    }

    /**
     * Debug: Jump directly to the resolution phase with a discovery event.
     * Usage: game.ionrift.respite.jumpToResolution()
     */
    async _debugJumpToResolution() {
        if (!game.user.isGM) return console.warn("GM only");

        const { RestFlowEngine } = await import("../services/RestFlowEngine.js");
        const terrainTag = this._engine?.terrainTag ?? "forest";
        const targets = getPartyActors().map(a => a.id);

        // Create a minimal engine if none exists
        if (!this._engine) {
            this._engine = new RestFlowEngine({
                restType: "long", terrainTag, comfort: "rough"
            });
        }

        // Register all player characters for Keep Watch
        for (const id of targets) {
            this._engine.registerChoice(id, "act_keep_watch");
            this._characterChoices.set(id, "act_keep_watch");
        }

        // Inject a discovery event with items
        this._triggeredEvents = [{
            id: "test_discovery", name: "Hidden Grove", category: "discovery",
            description: "A cluster of medicinal plants grows near the campsite.",
            mechanical: {
                type: "skill_check", skill: "nat", dc: 10, targets: "watch",
                onSuccess: { narrative: "You gather the herbs carefully.", items: [{ itemRef: "jungle_herbs", quantity: "1d4" }] },
                onFailure: { narrative: "The plants crumble at your touch.", effects: [] }
            },
            targets, rollTotal: 15, result: "triggered",
            narrative: "A cluster of medicinal plants grows near the campsite.",
            resolvedOutcome: "success",
            items: [{ itemRef: "jungle_herbs", quantity: "1d4" }],
            effects: []
        }];

        // Build outcomes via the engine
        this._eventsRolled = true;
        this._outcomes = await this._engine.resolve(this._activityResolver, this._triggeredEvents, new Map());
        this._phase = "resolve";
        this._engine._phase = "resolve";

        // Register app so socket handlers and state syncs work properly
        registerActiveRestApp(this);

        // Broadcast to player clients
        await this._saveRestState();
        const restPayload = {
            restId: `rest_${Date.now()}`, terrainTag: this._engine.terrainTag, comfort: this._engine.comfort,
            restType: this._engine.restType, activities: this._activities ?? [],
            recipes: Object.fromEntries(this._craftingEngine?.recipes || []),
            forageActivityGate: this._forageActivityGatePayload()
        };
        setActiveRestData(restPayload);
        emitRestStarted(restPayload);

        setTimeout(() => {
            const snapshot = this.getRestSnapshot?.();
            if (snapshot) emitRestSnapshot(snapshot);
            emitPhaseChanged("resolve", { outcomes: this._outcomes });
        }, 200);

        this.render(true);
        Logger.log("[Respite:Debug] Jumped to resolution with Hidden Grove discovery");
    }

    /**
     * Debug: Jump to the events phase with activities assigned and force an encounter.
     * Usage: game.ionrift.respite.jumpToEncounter()
     * After calling, click "Roll Events" to trigger the encounter and see the combat buff whisper.
     */
    async _debugJumpToEncounter() {
        if (!game.user.isGM) return console.warn("GM only");

        const { RestFlowEngine } = await import("../services/RestFlowEngine.js");
        const terrainTag = this._engine?.terrainTag ?? "forest";
        const targets = getPartyActors().map(a => a.id);

        if (!this._engine) {
            this._engine = new RestFlowEngine({
                restType: "long", terrainTag, comfort: "rough"
            });
        }

        // Mixed activities for combat buff variety
        const activities = ["act_keep_watch", "act_set_defenses", "act_keep_watch", "act_keep_watch", "act_keep_watch"];
        for (let i = 0; i < targets.length; i++) {
            const actId = activities[i % activities.length];
            this._engine.registerChoice(targets[i], actId);
            this._characterChoices.set(targets[i], actId);
        }

        // Inject a mock encounter event (already triggered)
        this._triggeredEvents = [{
            id: "debug_encounter", name: "Prowling Predators", category: "encounter",
            description: "A pack of creatures stalks the edge of your campfire light.",
            narrative: "A pack of creatures stalks the edge of your campfire light.",
            targets, result: "triggered", resolvedOutcome: null,
            effects: []
        }];
        this._eventsRolled = true;
        this._phase = "events";
        this._engine._phase = "events";

        // Generate combat buffs from the registered activities
        if (this._activityResolver) {
            this._combatBuffs = this._engine.aggregateCombatBuffs(this._activityResolver);
        }

        // Register app so socket handlers and state syncs work properly
        registerActiveRestApp(this);

        // Broadcast to player clients
        await this._saveRestState();
        const restPayload = {
            restId: `rest_${Date.now()}`, terrainTag: this._engine.terrainTag, comfort: this._engine.comfort,
            restType: this._engine.restType, activities: this._activities ?? [],
            recipes: Object.fromEntries(this._craftingEngine?.recipes || []),
            forageActivityGate: this._forageActivityGatePayload()
        };
        setActiveRestData(restPayload);
        emitRestStarted(restPayload);

        setTimeout(() => {
            const snapshot = this.getRestSnapshot?.();
            if (snapshot) emitRestSnapshot(snapshot);
            emitPhaseChanged("events", { triggeredEvents: this._triggeredEvents, eventsRolled: true });
        }, 200);

        this.render(true);
        Logger.log("[Respite:Debug] Jumped to events phase with mock encounter and combat readiness report.");
    }

    /**
     * Debug: Jump to the events phase with the Flash Flood disaster decision tree active.
     * Usage: game.ionrift.respite.jumpToDisaster()
     */
    async _debugJumpToDisaster() {
        if (!game.user.isGM) return console.warn("GM only");

        const { RestFlowEngine } = await import("../services/RestFlowEngine.js");
        const terrainTag = this._engine?.terrainTag ?? "forest";
        const targets = getPartyActors().map(a => a.id);

        if (!this._engine) {
            this._engine = new RestFlowEngine({
                restType: "long", terrainTag, comfort: "rough"
            });
        }

        for (const id of targets) {
            this._engine.registerChoice(id, "act_keep_watch");
            this._characterChoices.set(id, "act_keep_watch");
        }

        // Load Flash Flood from JSON
        const resp = await fetch("modules/ionrift-respite/data/core/events/camp_disasters.json");
        const data = await resp.json();
        const flood = data.events.find(e => e.id === "evt_disaster_flash_flood");
        if (!flood) {
            ui.notifications.error("Flash Flood event not found in camp_disasters.json");
            return;
        }

        // Inject as triggered event and create tree state
        this._triggeredEvents = [flood];
        this._eventsRolled = true;
        this._activeTreeState = DecisionTreeResolver.createTreeState(flood, targets);
        // Ensure stallPenalty is present (bypass ES module cache)
        if (flood.mechanical?.stallPenalty) {
            this._activeTreeState.stallPenalty = flood.mechanical.stallPenalty;
            this._activeTreeState.hasStallPenalty = true;
            this._activeTreeState.stalled = false;
        }
        this._phase = "events";
        this._engine._phase = "events";

        registerActiveRestApp(this);
        await this._saveRestState();

        const restPayload = {
            restId: `rest_${Date.now()}`, terrainTag: this._engine.terrainTag, comfort: this._engine.comfort,
            restType: this._engine.restType, activities: this._activities ?? [],
            recipes: Object.fromEntries(this._craftingEngine?.recipes || []),
            forageActivityGate: this._forageActivityGatePayload()
        };
        setActiveRestData(restPayload);
        emitRestStarted(restPayload);

        setTimeout(() => {
            const snapshot = this.getRestSnapshot?.();
            if (snapshot) emitRestSnapshot(snapshot);
            emitPhaseChanged("events", {
                triggeredEvents: this._triggeredEvents,
                activeTreeState: this._activeTreeState,
                eventsRolled: true
            });
        }, 200);

        this.render(true);
        Logger.log("[Respite:Debug] Jumped to events phase with Flash Flood decision tree.");
        ui.notifications.info("Flash Flood disaster injected. Decision tree active.");
    }

    /**
     * Debug: Jump directly to the resolution phase with a pre-resolved Bog Rot
     * failure event, demonstrating the 0.5 hpMultiplier recovery penalty.
     *
     * Sets all player characters to half HP first, so the recovery gap is visible.
     * On the Resolution screen, you should see recovery = floor(gap * 0.5).
     *
     * Usage: game.ionrift.respite.jumpToRecoveryPenalty()
     */
    async _debugJumpToRecoveryPenalty() {
        if (!game.user.isGM) return console.warn("GM only");

        const { RestFlowEngine } = await import("../services/RestFlowEngine.js");
        const terrainTag = "swamp";
        const targets = getPartyActors().map(a => a.id);

        if (targets.length === 0) {
            ui.notifications.warn("No player-owned characters found.");
            return;
        }

        // Set all player characters to half HP so the recovery gap is obvious
        for (const id of targets) {
            const actor = game.actors.get(id);
            if (!actor) continue;
            const maxHp = actor.system?.attributes?.hp?.max ?? 0;
            const halfHp = Math.floor(maxHp / 2);
            await actor.update({ "system.attributes.hp.value": halfHp });
        Logger.log(`[Respite:Debug] ${actor.name}: HP set to ${halfHp}/${maxHp}`);
        }

        // Create engine at rough comfort (so base recovery is normal, penalty comes from event)
        this._engine = new RestFlowEngine({
            restType: "long", terrainTag, comfort: "rough"
        });

        for (const id of targets) {
            this._engine.registerChoice(id, "act_keep_watch");
            this._characterChoices.set(id, "act_keep_watch");
        }

        // Inject Bog Rot as already resolved with a failure outcome (0.5 hpMultiplier)
        this._triggeredEvents = [{
            id: "evt_swamp_bog_rot",
            name: "Bog Rot",
            category: "complication",
            description: "Infected wounds fester. Recovery will be slower.",
            narrative: "Infected wounds fester. Recovery will be slower.",
            targets,
            result: "failure",
            resolvedOutcome: "failure",
            effects: [
                {
                    type: "recovery_penalty",
                    hpMultiplier: 0.5,
                    description: "Infected wounds reduce healing."
                }
            ]
        }];

        // Build outcomes via the engine (this runs _calculateRecovery with the penalty)
        this._eventsRolled = true;
        this._outcomes = await this._engine.resolve(this._activityResolver, this._triggeredEvents, new Map());
        this._phase = "resolve";
        this._engine._phase = "resolve";

        // Register and broadcast
        registerActiveRestApp(this);
        await this._saveRestState();
        const restPayload = {
            restId: `rest_${Date.now()}`, terrainTag: this._engine.terrainTag, comfort: this._engine.comfort,
            restType: this._engine.restType, activities: this._activities ?? [],
            recipes: Object.fromEntries(this._craftingEngine?.recipes || [])
        };
        setActiveRestData(restPayload);
        emitRestStarted(restPayload);

        setTimeout(() => {
            const snapshot = this.getRestSnapshot?.();
            if (snapshot) emitRestSnapshot(snapshot);
            emitPhaseChanged("resolve", { outcomes: this._outcomes });
        }, 200);

        this.render(true);

        // Log expected values for easy verification
        for (const o of this._outcomes) {
            const actor = game.actors.get(o.characterId);
            const maxHp = actor?.system?.attributes?.hp?.max ?? 0;
            const curHp = actor?.system?.attributes?.hp?.value ?? 0;
            const gap = maxHp - curHp;
            const expected = Math.floor(gap * 0.5);
        Logger.log(`[Respite:Debug] ${o.characterName}: gap=${gap}, expected recovery=${expected}, actual recovery=${o.recovery?.hpRestored ?? "?"}`);
        }

        Logger.log("[Respite:Debug] Jumped to resolution with Bog Rot 0.5x hpMultiplier penalty.");
        ui.notifications.info("Recovery penalty scenario loaded. Check the resolution screen.");
    }

    /**
     * Debug: Jump directly to the resolution phase with a pre-resolved damage
     * event. Sets Randal (or first PC) to 5 HP, then runs a rest with 10
     * bludgeoning damage. Expected final HP = max - 10.
     *
     * Usage: game.ionrift.respite.jumpToDamageTest()
     */
    async _debugJumpToDamageTest() {
        if (!game.user.isGM) return console.warn("GM only");

        const { RestFlowEngine } = await import("../services/RestFlowEngine.js");
        const terrainTag = "forest";
        const targets = getPartyActors().map(a => a.id);

        if (targets.length === 0) {
            ui.notifications.warn("No player-owned characters found.");
            return;
        }

        // Set all player characters to 5 HP so the long rest healing is visible
        for (const id of targets) {
            const actor = game.actors.get(id);
            if (!actor) continue;
            const maxHp = actor.system?.attributes?.hp?.max ?? 0;
            const startHp = Math.min(5, maxHp);
            await actor.update({ "system.attributes.hp.value": startHp });
        Logger.log(`[Respite:Debug] ${actor.name}: HP set to ${startHp}/${maxHp}`);
        }

        // Create engine at sheltered comfort (standard recovery)
        this._engine = new RestFlowEngine({
            restType: "long", terrainTag, comfort: "sheltered"
        });

        for (const id of targets) {
            this._engine.registerChoice(id, "act_rest_fully");
            this._characterChoices.set(id, "act_rest_fully");
        }

        // Inject a simple damage event (no decision tree, no checks)
        this._triggeredEvents = [{
            id: "evt_test_damage",
            name: "Falling Branch",
            category: "complication",
            description: "A large branch cracks loose and crashes into camp.",
            narrative: "A large branch cracks loose and crashes into camp.",
            targets,
            resolved: true,
            resolvedOutcome: "failure",
            effects: [
                { type: "damage", formula: "10", damageType: "bludgeoning", description: "Struck by falling branch." }
            ]
        }];

        // Build outcomes
        this._eventsRolled = true;
        this._outcomes = await this._engine.resolve(this._activityResolver, this._triggeredEvents, new Map());
        this._phase = "resolve";
        this._engine._phase = "resolve";

        // Inject eventDamage into recovery (normally done by RecoveryHandler.applyAll)
        for (const o of this._outcomes) {
            // Sum up all damage effects from event outcomes
            let totalDamage = 0;
            for (const sub of (o.outcomes ?? [])) {
                if (sub.source === "event" && !["success", "triumph"].includes(sub.resolvedOutcome)) {
                    for (const eff of (sub.effects ?? [])) {
                        if (eff.type === "damage") {
                            // Parse flat formula or use the number directly
                            const dmg = parseInt(eff.formula) || 0;
                            totalDamage += dmg;
                        }
                    }
                }
            }
            if (totalDamage > 0 && o.recovery) {
                o.recovery.eventDamage = totalDamage;
            }
        }

        // Register and broadcast
        registerActiveRestApp(this);
        await this._saveRestState();
        const restPayload = {
            restId: `rest_${Date.now()}`, terrainTag: this._engine.terrainTag, comfort: this._engine.comfort,
            restType: this._engine.restType, activities: this._activities ?? [],
            recipes: Object.fromEntries(this._craftingEngine?.recipes || [])
        };
        setActiveRestData(restPayload);
        emitRestStarted(restPayload);

        setTimeout(() => {
            const snapshot = this.getRestSnapshot?.();
            if (snapshot) emitRestSnapshot(snapshot);
            emitPhaseChanged("resolve", { outcomes: this._outcomes });
        }, 200);

        this.render(true);

        // Log expected values
        for (const o of this._outcomes) {
            const actor = game.actors.get(o.characterId);
            const maxHp = actor?.system?.attributes?.hp?.max ?? 0;
        Logger.log(`[Respite:Debug] ${o.characterName}: maxHp=${maxHp}, recovery=${o.recovery?.hpRestored ?? "?"}, expected final=${maxHp} - 10 = ${maxHp - 10}`);
            // Check if damage effects came through
            for (const sub of (o.outcomes ?? [])) {
                if (sub.source === "event") {

                    Logger.log(`  Event outcome: ${sub.eventName}, resolvedOutcome=${sub.resolvedOutcome}, effects=${JSON.stringify(sub.effects)}`);
                }
            }
        }

        Logger.log("[Respite:Debug] Jumped to resolution with 10 bludgeoning damage event.");
        ui.notifications.info("Damage test scenario loaded. Click 'Apply Results' to apply.");
    }

    /**
     * Debug: Jump to resolution at hostile camp comfort.
     * First PC gets Rest Fully (comfort boosted to rough, CON DC 10).
     * Others get Keep Watch (stays hostile, CON DC 15).
     * No events injected - clean rest to inspect exhaustion advisory text.
     *
     * Usage: game.ionrift.respite.jumpToHostileComfort()
     */
    async _debugJumpToHostileComfort() {
        if (!game.user.isGM) return console.warn("GM only");

        const { RestFlowEngine } = await import("../services/RestFlowEngine.js");
        const terrainTag = "forest";
        const targets = getPartyActors().map(a => a.id);

        if (targets.length === 0) {
            ui.notifications.warn("No player-owned characters found.");
            return;
        }

        // Set all PCs to half HP so recovery numbers are visible
        for (const id of targets) {
            const actor = game.actors.get(id);
            if (!actor) continue;
            const maxHp = actor.system?.attributes?.hp?.max ?? 0;
            const halfHp = Math.floor(maxHp / 2);
            await actor.update({ "system.attributes.hp.value": halfHp });
        Logger.log(`[Respite:Debug] ${actor.name}: HP set to ${halfHp}/${maxHp}`);
        }

        // Hostile camp comfort
        this._engine = new RestFlowEngine({
            restType: "long", terrainTag, comfort: "hostile"
        });

        // First PC: Rest Fully (gets comfort boost), others: Keep Watch
        const firstId = targets[0];
        this._engine.registerChoice(firstId, "act_rest_fully");
        this._characterChoices.set(firstId, "act_rest_fully");
        for (const id of targets.slice(1)) {
            this._engine.registerChoice(id, "act_keep_watch");
            this._characterChoices.set(id, "act_keep_watch");
        }

        // No events - clean rest
        this._triggeredEvents = [];
        this._eventsRolled = true;
        this._outcomes = await this._engine.resolve(this._activityResolver, this._triggeredEvents, new Map());
        this._phase = "resolve";
        this._engine._phase = "resolve";

        // Register and broadcast
        registerActiveRestApp(this);
        await this._saveRestState();
        const restPayload = {
            restId: `rest_${Date.now()}`, terrainTag: this._engine.terrainTag, comfort: this._engine.comfort,
            restType: this._engine.restType, activities: this._activities ?? [],
            recipes: Object.fromEntries(this._craftingEngine?.recipes || [])
        };
        setActiveRestData(restPayload);
        emitRestStarted(restPayload);

        setTimeout(() => {
            const snapshot = this.getRestSnapshot?.();
            if (snapshot) emitRestSnapshot(snapshot);
            emitPhaseChanged("resolve", { outcomes: this._outcomes });
        }, 200);

        this.render(true);

        // Log results
        for (const o of this._outcomes) {
            const eff = o.recovery?.comfortLevel ?? "?";
            const camp = o.recovery?.campComfort ?? "?";
        Logger.log(`[Respite:Debug] ${o.characterName}: camp=${camp}, effective=${eff}, exhaustionDC=${o.recovery?.exhaustionDC ?? "none"}`);
        }

        Logger.log("[Respite:Debug] Hostile comfort scenario loaded.");
        ui.notifications.info("Hostile comfort scenario loaded. Check exhaustion advisories.");
    }

    /**
     * Debug: Add supplies to all party actors.
     * Usage: game.ionrift.respite.addSupplies(qty)
     */
    static async _debugAddSupplies(qty = 50) {
        if (!game.user.isGM) return console.warn("GM only");

        const actors = getPartyActors();
        for (const actor of actors) {
            // Check if they already have supplies
            const existing = actor.items.find(i =>
                ["supplies", "adventuring supplies", "camp supplies"].includes(i.name.toLowerCase().trim())
            );
            if (existing) {
                await actor.updateEmbeddedDocuments("Item", [
                    { _id: existing.id, "system.quantity": (existing.system?.quantity ?? 0) + qty }
                ]);
        Logger.log(`[Respite:Debug] ${actor.name}: added ${qty} to existing ${existing.name} (now ${(existing.system?.quantity ?? 0) + qty})`);
            } else {
                await actor.createEmbeddedDocuments("Item", [{
                    name: "Supplies",
                    type: "loot",
                    img: "icons/containers/bags/pack-leather-brown.webp",
                    system: { quantity: qty, weight: { value: 0.5 }, price: { value: 1, denomination: "gp" } }
                }]);
        Logger.log(`[Respite:Debug] ${actor.name}: created Supplies x${qty}`);
            }
        }
        ui.notifications.info(`Added ${qty} supplies to ${actors.length} party members.`);
    }

    // â”€â”€ Rest State Persistence â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    /**
     * Persists the current rest state to a world setting.
     * Called on every phase transition and before combat blocking.
     */
    async _saveRestState() {
        if (!game.user.isGM || !this._engine || this._restApplied) return;
        const state = {
            engine: this._engine.serialize(),
            phase: this._phase,
            triggeredEvents: this._triggeredEvents,
            eventsRolled: this._eventsRolled ?? false,
            activeTreeState: this._activeTreeState,
            ...this._campCeremony.serialize(),
            campFireWoodSpendUserId: this._campFireWoodSpendUserId ?? null,
            campStep2Entered: this._campStep2Entered ?? false,
            selectedTerrain: this._selectedTerrain,
            selectedRestType: this._selectedRestType,
            selectedWeather: this._selectedWeather,
            characterChoices: Array.from(this._characterChoices.entries()),
            earlyResults: Array.from(this._earlyResults.entries()),
            gmOverrides: Array.from(this._gmOverrides.entries()),
            playerSubmissions: Array.from(this._playerSubmissions.entries()),
            lockedCharacters: Array.from(this._lockedCharacters),
            gmFollowUps: Array.from(this._gmFollowUps.entries()),
            craftingResults: Array.from(this._craftingResults.entries()),
            trainingStates: this._trainingStates?.size
                ? Array.from(this._trainingStates.entries()).map(([id, s]) => [id, { ...s, rolling: false }])
                : [],
            awaitingCombat: this._awaitingCombat ?? false,
            gmCopySpellProposal: this._gmCopySpellProposal?.charged ? this._gmCopySpellProposal : null,
            mealChoices: this._mealChoices ? Array.from(this._mealChoices.entries()) : [],
            mealSubmissions: this._mealSubmissions ? Array.from(this._mealSubmissions.entries()) : [],
            activityMealRationsSubmitted: [...(this._activityMealRationsSubmitted ?? [])],
            totmFeastServed: this._totmFeastServed ?? false,
            daysSinceLastRest: this._daysSinceLastRest ?? 1,
            campfireSnapshot: RestSetupApp._campfireSnapshotFromFireLevel(this._fireLevel),
            travelState: this._travel?.serialize() ?? null,
            grantLedger: this._grantLedger?.serialize() ?? null,
            magicScanComplete: this._magicScanComplete ?? false,
            magicScanResults: this._magicScanResults ?? null,
            timestamp: Date.now()
        };
        await game.settings.set(MODULE_ID, "activeRest", state);
    }

    /**
     * Attempts to restore rest state from a world setting.
     * @returns {boolean} True if state was found and restored.
     */
    async _loadRestState() {
        const state = game.settings.get(MODULE_ID, "activeRest");
        if (!state?.engine) return false;

        this._engine = RestFlowEngine.deserialize(state.engine);
        this._phase = state.phase ?? "setup";
        this._triggeredEvents = state.triggeredEvents ?? [];
        this._eventsRolled = state.eventsRolled ?? false;
        this._activeTreeState = state.activeTreeState ?? null;
        this._campCeremony.restore(state);
        this._campFireWoodSpendUserId = state.campFireWoodSpendUserId ?? null;
        this._campStep2Entered = state.campStep2Entered ?? false;
        this._selectedTerrain = state.selectedTerrain;
        this._selectedRestType = state.selectedRestType;
        this._selectedWeather = state.selectedWeather;
        this._characterChoices = new Map(state.characterChoices ?? []);
        this._earlyResults = new Map(state.earlyResults ?? []);
        this._gmOverrides = new Map(state.gmOverrides ?? []);
        this._playerSubmissions = new Map(state.playerSubmissions ?? []);

        // Prune stale charId-keyed entries that may have been written by a prior
        // bug in receiveSubmissionUpdate / receiveRestSnapshot. Those methods
        // incorrectly used charId as the map key; the schema requires userId.
        // Any key that is not a recognised Foundry userId is garbage and must be
        // dropped so _rebuildCharacterChoices can correctly derive _characterChoices.
        let pruned = 0;
        for (const key of this._playerSubmissions.keys()) {
            if (!game.users.get(key)) {
                this._playerSubmissions.delete(key);
                pruned++;
            }
        }
        if (pruned > 0) {

            Logger.warn(`[state-restore] Pruned ${pruned} invalid (non-userId) entries from _playerSubmissions. This indicates a prior schema corruption that has now been fixed.`);
        }
        this._lockedCharacters = new Set(state.lockedCharacters ?? []);
        this._gmFollowUps = new Map(state.gmFollowUps ?? []);
        this._craftingResults = new Map(state.craftingResults ?? []);
        this._trainingStates = new Map(state.trainingStates ?? []);
        this._clearStaleTrainingRollingFlags();
        this._awaitingCombat = state.awaitingCombat ?? false;
        this._gmCopySpellProposal = state.gmCopySpellProposal ?? null;
        this._mealChoices = new Map(state.mealChoices ?? []);
        this._mealSubmissions = new Map(state.mealSubmissions ?? []);
        this._activityMealRationsSubmitted = new Set(state.activityMealRationsSubmitted ?? []);
        this._totmFeastServed = state.totmFeastServed ?? false;
        this._daysSinceLastRest = state.daysSinceLastRest ?? 1;
        this._campfireSnapshot = state.campfireSnapshot ?? null;

        this._magicScanResults = state.magicScanResults ?? null;
        this._magicScanComplete = state.magicScanComplete ?? false;

        if (!this._grantLedger) this._grantLedger = new GrantLedger();
        this._grantLedger.deserialize(state.grantLedger ?? null);

        if (state.travelState) {
            this._travel.deserialize(state.travelState);
        }

        const legacyDiscoveries = state.grantedDiscoveries;
        if (legacyDiscoveries?.length) {
            for (const [grantKey, result] of legacyDiscoveries) {
                const colon = grantKey.indexOf(":");
                if (colon < 0) continue;
                const slotKey = GrantLedger.discoverySlotKey(
                    grantKey.slice(0, colon),
                    grantKey.slice(colon + 1)
                );
                if (!this._grantLedger.has(slotKey)) {
                    this._grantLedger.record(slotKey, result);
                }
            }
        }

        // Ensure _loadData has finished so resolvers and _activities are available
        if (this._dataReady) await this._dataReady;

        // Rebuild _characterChoices from the restored submissions and overrides
        this._rebuildCharacterChoices();

        if (this._magicScanComplete) {
            notifyDetectMagicScanApplied(this, getPartyActors().map(a => a.id));
        }

        this._syncIncompleteTrainingView();

        return true;
    }

    /**
     * After world-flag restore while in activity phase: match a live session (station
     * overlays, rest bar, window minimised like Proceed).
     */
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

    /**
     * Station overlays plus bottom rest bar (shared by phase change, snapshot resync, restore).
     */
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

    /**
     * Removes station overlays only. GM {@link #_installGmStationTokenSyncHook} is tied to
     * roster phases and removed in {@link #_onRender} when leaving camp/travel/activity/meal.
     */
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

    /**
     * GM: roster selection tracks the controlled party token.
     * Players: same hook refreshes station overlay dimming when switching owned characters.
     */
    _installGmStationTokenSyncHook() {
        if (this._gmControlTokenHook) return;
        const rosterPhases = new Set(["camp", "travel", "activity", "meal"]);
        this._gmControlTokenHook = (token, controlled) => {
            if (!controlled || !rosterPhases.has(this._phase)) return;
            const actor = token?.actor;
            if (!actor || actor.type !== "character") return;
            const partyActors = getPartyActors();
            if (!partyActors.some(a => a.id === actor.id)) return;
            if (this._isGM) {
                if (this._selectedCharacterId === actor.id) return;
                this._selectedCharacterId = actor.id;
            }
            if (this._phase === "activity") {
                closeStationDialogIfDifferentActor(actor.id);
                if (isStationLayerActive()) {
                    if (!this._isGM) this._refreshStationOverlayForFocusChange();
                    else {
                        refreshStationEmptyNoticeFade(this);
                        this._refreshStationOverlayMeals();
                    }
                }
            }
            if (this._isGM) this.render();
        };
        Hooks.on("controlToken", this._gmControlTokenHook);
    }

    /**
     * Clears persisted rest state. Called on rest completion or cancellation.
     */
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

    /**
     * @param {string} actorId
     * @param {string} [professionId]
     * @returns {boolean}
     */
    hasCompletedCrafting(actorId, professionId = null) {
        if (!actorId) return false;
        if (this._craftingResults?.has(actorId)) return true;
        return this._grantLedger?.hasCraftingForActor(actorId, professionId) ?? false;
    }

    async _clearRestState() {
        if (!game.user.isGM) return;
        this._grantLedger?.reset();
        try {
            await game.settings.set(MODULE_ID, "activeRest", {});
        } catch (e) {
            // Setting may not be registered yet
        }
    }

    /**
     * Rebuilds the in-memory event pool after the GM saves eventPoolSelection.
     * Needed because EventResolver.load() applies selection at ingest time.
     */
    async _refreshEventPool() {
        const terrainTag = this._engine?.terrainTag ?? this._selectedTerrain;
        this._eventResolver = new EventResolver();
        await this._loadData();
        if (terrainTag) {
            await this._loadTerrainEvents(terrainTag);
        }
    }

    async _loadData() {
        try {
            const activityResp = await fetch(`modules/${MODULE_ID}/data/activities/default_activities.json`);
            const activities = await activityResp.json();
            this._activities = activities;
            this._activityResolver.load(activities);

            // Always load shared camp disasters (terrain-agnostic decision tree events)
            const disasterResp = await fetch(`modules/${MODULE_ID}/data/core/events/camp_disasters.json`);
            const disasters = await disasterResp.json();
            this._eventResolver.load(disasters.tables, disasters.events);

            // Content packs: loaded from world storage via Import Pack workflow.
            // Packs are NOT Foundry modules. They are JSON files downloaded from
            // Ionrift and imported through Respite's Content Packs settings UI.
            await this._loadContentPacks();

            // Ensure the travel delegate's resolver has base pool items from the
            // shipped compendium. The delegate constructor may have fired before
            // the compendium index was ready (race condition on startup/restore).
            if (this._travel && game.ionrift?.respite?.travelBasePoolIndex) {
                const resolver = this._travel.getTravelResolver();
                if (resolver && resolver.basePoolCoverage.length === 0) {
                    resolver.loadBaseItems(game.ionrift.respite.travelBasePoolIndex);
                }
            }
        } catch (e) {

            console.error(`${MODULE_ID} | Failed to load seed data:`, e);
        }
    }

    /**
     * Loads imported content pack events from world storage.
     * Packs are stored as world-level settings after being imported
     * through the Content Packs UI (JSON file upload from Ionrift).
     */
    async _loadContentPacks() {
        const enabledPacks = game.settings.get(MODULE_ID, "enabledPacks") ?? {};
        const importedPacks = game.settings.get(MODULE_ID, "importedPacks") ?? {};

        let totalRecipes = 0, totalPools = 0;

        for (const [packId, packData] of Object.entries(importedPacks)) {
            if (enabledPacks[packId] === false) {

                Logger.log(`${MODULE_ID} | Pack ${packId}: disabled`);
                continue;
            }

            try {
                const loaded = [];
                const events = packData.events ?? [];
                if (events.length) {
                    this._eventResolver.load(packData.tables ?? null, events);
                    loaded.push(`${events.length} events`);
                }

                // Recipes -- keyed by profession (e.g. { cooking: [...] })
                if (packData.recipes && typeof packData.recipes === "object") {
                    for (const [profId, recipeList] of Object.entries(packData.recipes)) {
                        if (Array.isArray(recipeList) && recipeList.length) {
                            this._craftingEngine.load(profId, recipeList);
                            totalRecipes += recipeList.length;
                        }
                    }
                    loaded.push(`${totalRecipes} recipes`);
                }

                // Resource Pools
                if (Array.isArray(packData.resourcePools) && packData.resourcePools.length && this._travel) {
                    this._travel.loadPoolsFromData(packData.resourcePools, { fromImportedPack: true });
                    totalPools += packData.resourcePools.length;
                    loaded.push(`${packData.resourcePools.length} pools`);
                }

                if (loaded.length) {

                    Logger.log(`${MODULE_ID} | Pack ${packId}: loaded ${loaded.join(", ")}`);
                }
            } catch (e) {

                console.warn(`${MODULE_ID} | Failed to load pack ${packId}:`, e);
            }
        }

        // Fall back to built-in stub content when no packs provided data
        if (totalRecipes === 0) {
            for (const [profId, recipeList] of Object.entries(STUB_RECIPES)) {
                this._craftingEngine.load(profId, recipeList);
            }

            Logger.log(`${MODULE_ID} | Using built-in stub recipes`);
        }
    }


    /** @returns {Object} Merged into ActivityResolver travel/camp forage checks on this client. */
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

    /** GM-only advisory when no terrain art pack is active OR pack is outdated (Make Camp phase). */
    _shouldShowArtNudge() {
        if (!game.user.isGM) return false;
        if (ImageResolver.hasArtPack && ImageResolver.hasStationTokens) return false;
        if (game.settings.get(MODULE_ID, "artNudgeSuppressed")) return false;
        const snoozedUntil = game.settings.get(MODULE_ID, "artNudgeSnoozedUntil");
        if (snoozedUntil) {
            const snoozeDate = new Date(snoozedUntil);
            if (!isNaN(snoozeDate.getTime()) && snoozeDate > new Date()) return false;
        }
        return true;
    }

    /** GM-only banner when the curated event pool is empty for the current terrain. */
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

    /**
     * Loads terrain-specific event data. Additive; safe to call multiple times.
     */
    async _loadTerrainEvents(terrainTag) {
        if (this._eventResolver.tables.has(terrainTag)) return;

        // Resolve path from TerrainRegistry manifest; fall back to convention
        const path = TerrainRegistry.getEventsPath(terrainTag)
            ?? `modules/${MODULE_ID}/data/terrains/${terrainTag}/events.json`;

        try {
            const resp = await fetch(path);
            if (!resp.ok) {
                // Try overlay-delivered events (Patreon Library content packs)
                const loaded = await this._loadTerrainEventsFromOverlay(terrainTag);
                if (!loaded) {

                    console.warn(`${MODULE_ID} | No event file for terrain: ${terrainTag}`);
                }
                return;
            }
            const data = await resp.json();
            this._eventResolver.load(data.tables, data.events);
        } catch (e) {

            console.warn(`${MODULE_ID} | Failed to load events for ${terrainTag}:`, e);
        }
    }

    /**
     * Attempts to load terrain events from overlay packs.
     * @param {string} terrainTag
     * @returns {Promise<boolean>} True if events were found and loaded.
     */
    async _loadTerrainEventsFromOverlay(terrainTag) {
        try {
            const { OverlayEventLoader } = await import("../services/OverlayEventLoader.js");
            const packs = await OverlayEventLoader.loadAll();
            for (const { data } of packs) {
                const hasMatchingEvents = (data.events ?? []).some(
                    e => e.terrainTags?.includes(terrainTag)
                );
                if (hasMatchingEvents) {
                    this._eventResolver.load(data.tables, data.events);
        Logger.log(`${MODULE_ID} | Loaded overlay events for terrain: ${terrainTag}`);
                    return true;
                }
            }
        } catch (e) {

            console.warn(`${MODULE_ID} | Overlay event lookup failed for ${terrainTag}:`, e);
        }
        return false;
    }

    render(options = {}) {
        if (this._terminated) {

            return;
        }
        const preserveTotmCraftScroll = this._totmFollowUpExpanded?.isCrafting
            && this.rendered
            && !options.resetCraftScroll;
        if (preserveTotmCraftScroll) {
            const scrollEl = this.element?.querySelector(".totm-crafting-embed .crafting-detail-panel")
                ?? this.element?.querySelector(".totm-crafting-embed .crafting-split-body");
            this._totmCraftScrollTop = scrollEl?.scrollTop ?? 0;
        }
        if (this._isGM) {
            if (options.force) {
                this._gmMinimizedToFooter = false;
            } else if (this._gmMinimizedToFooter) {
                _logGmRestSheet("render", "skip (minimized, no force)", { phase: this._phase });
                return;
            }
            registerActiveRestApp(this);
            if (!this._prepBroadcast) {
                this._prepBroadcast = true;
                emitRestPreparing();
            }
        }
        try {
            const out = super.render(options);
            void Promise.resolve(out)
                .then(() => {
                    if (preserveTotmCraftScroll && (this._totmCraftScrollTop ?? 0) > 0) {
                        const scrollEl = this.element?.querySelector(".totm-crafting-embed .crafting-detail-panel")
                            ?? this.element?.querySelector(".totm-crafting-embed .crafting-split-body");
                        if (scrollEl) scrollEl.scrollTop = this._totmCraftScrollTop;
                    }
                    showAfkPanel();
                })
                .catch((err) => {

                    console.error(`${MODULE_ID} | RestSetupApp render failed:`, err);
                    if (this._isGM) clearActiveRestApp();
                });
            return out;
        } catch (err) {

            console.error(`${MODULE_ID} | RestSetupApp render failed:`, err);
            if (this._isGM) clearActiveRestApp();
            throw err;
        }
    }

    async close(options = {}) {

        CampfireMakeCampDialog.closeIfOpen();
        this._tearDownCampfireEmbed();
        await closeOpenStationDialog();
        if (this._isGM) {
            // If rest is in resolution phase but auto-apply hasn't completed, confirm
            if (this._phase === "resolve" && !this._restApplied && !options.resolved) {
                // Check for ungranted discoveries
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
                    clearCampTokens().catch(err => console.warn(`${MODULE_ID} | Camp cleanup failed:`, err));
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
                if (options.resolved) {
                    await this._clearRestState();
                    emitRestResolved();
                    clearCampTokens().catch(err => console.warn(`${MODULE_ID} | Camp cleanup failed:`, err));
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
        // Deregister inventory hooks
        if (this._inventoryHookIds) {
            Hooks.off("createItem", this._inventoryHookIds[0]);
            Hooks.off("deleteItem", this._inventoryHookIds[1]);
            Hooks.off("updateItem", this._inventoryHookIds[2]);
            this._inventoryHookIds = null;
        }
        // Tear down the body-level GM guidance flyout so it doesn't linger over the canvas
        document.getElementById("ionrift-gm-guidance-flyout")?.remove();
        this._disposeRestWindowResizeObserver();
        return super.close(options);
    }

    _disposeRestWindowResizeObserver() {
        if (!this._restWindowResizeObserver) return;
        this._restWindowResizeObserver.disconnect();
        this._restWindowResizeObserver = null;
    }

    _bindRestWindowResizeObserver() {
        const el = this.element;
        if (!el || this._restWindowResizeObserver) return;
        if (!this._isTotM) return;
        const watchCamp = this._phase === "camp";
        const watchActivityCampfire = this._phase === "activity" && this._totmCampfireMinigamePanelEnabled();
        if (!watchCamp && !watchActivityCampfire) return;

        this._restWindowResizeObserver = new ResizeObserver(() => {
            this._scheduleRestWindowRecenter();
        });
        this._restWindowResizeObserver.observe(el);
    }

    /** Re-center after layout settles (banner, minigame embed, async images). */
    _scheduleRestWindowRecenter() {
        if (this._restWindowRecenterPending) return;
        this._restWindowRecenterPending = true;
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                this._restWindowRecenterPending = false;
                if (!this.rendered) return;
                this._recenterRestSetupWindow();
            });
        });
    }

    _recenterRestSetupWindow() {
        const el = this.element;
        if (!el) return;
        const h = el.offsetHeight;
        if (h < 1) return;

        if (this._phase === "camp" && !this._isTotM) {
            el.classList.add("ionrift-camp-dock");
            const w = el.offsetWidth;
            this.setPosition({
                top: 64,
                left: Math.max(8, window.innerWidth - w - 16)
            });
            return;
        }

        el.classList.remove("ionrift-camp-dock");
        const top = Math.max(10, Math.round((window.innerHeight - h) / 2));
        const pos = { top };

        if (this._isTotM && this._phase === "camp") {
            const targetW = 720;
            pos.width = targetW;
            pos.left = Math.max(20, Math.round((window.innerWidth - targetW) / 2));
        } else if (this._isTotM && this._phase === "activity" && this._totmCampfireMinigamePanelEnabled()) {
            const targetW = Math.min(780, Math.round(window.innerWidth * 0.92));
            pos.width = targetW;
            pos.left = Math.max(20, Math.round((window.innerWidth - targetW) / 2));
        } else {
            const w = el.offsetWidth;
            pos.left = Math.max(10, Math.round((window.innerWidth - w) / 2));
        }

        this.setPosition(pos);
    }

    /**
     * Context for {@link CampfireMakeCampDialog} (Make Camp fire controls at the pit token).
     * Kept in sync with camp-phase fire block in _prepareContext.
     * @returns {object|null}
     */
    buildCampfireDrawerContextForMapDialog() {
        if (this._phase !== "camp") return null;

        let campScanData = null;
        let campFireEncounterHint = "";
        let campFirePickerLevels = [];
        let campColdCampDecided = false;
        if (this._phase === "camp") {
            const terrainTagCamp = this._selectedTerrain ?? this._engine?.terrainTag ?? "forest";
            const terrainCamp = TerrainRegistry.get(terrainTagCamp);
            const shelterSpellCamp = (this._engine?.activeShelters ?? []).find(s => s !== "tent" && s !== "none")
                ? SHELTER_SPELLS[(this._engine?.activeShelters ?? []).find(s => s !== "tent" && s !== "none")]?.label ?? null
                : null;
            const campfirePlacedGate = hasCampfirePlaced();
            const fireCommitted = (this._fireLevel ?? "unlit") !== "unlit" || !!this._coldCampDecided;
            campColdCampDecided = !!this._coldCampDecided;
            // When fire hasn't been committed, preview defaults to "embers" (the
            // default highlighted tab), NOT "unlit" which applies a no-fire penalty.
            const effectiveScanLevel = (campfirePlacedGate && fireCommitted)
                ? (this._coldCampDecided ? "cold_camp" : (this._fireLevel ?? "unlit"))
                : (this._campFirePreviewLevel ?? (this._fireLevel !== "unlit" ? this._fireLevel : "embers"));
            const encMod = CampGearScanner.FIRE_ENCOUNTER_MOD_BY_LEVEL[effectiveScanLevel] ?? 0;
            if (effectiveScanLevel === "cold_camp") {
                campFireEncounterHint = "Cold camp: harder for enemies to spot (lower encounter chance).";
            } else if (effectiveScanLevel === "unlit") {
                campFireEncounterHint = "Choose a fire level or go cold camp.";
            } else if (effectiveScanLevel === "embers") {
                campFireEncounterHint = "Embers: no change to encounter chance.";
            } else if (effectiveScanLevel === "campfire") {
                campFireEncounterHint = "Campfire: light makes the camp easier for enemies to spot.";
            } else if (effectiveScanLevel === "bonfire") {
                campFireEncounterHint = "Bonfire: visible from far off; enemies spot the camp easily.";
            } else {
                campFireEncounterHint = "";
            }
            const baseTerrainComfort = this._engine?.comfort
                ?? TerrainRegistry.getDefaults(terrainTagCamp).comfort
                ?? "rough";
            campScanData = CampGearScanner.scan(
                baseTerrainComfort,
                effectiveScanLevel,
                shelterSpellCamp,
                terrainCamp?.comfortReason ?? "",
                terrainCamp?.label ?? terrainTagCamp,
                encMod,
                !!this._engine?.safeRestSpot
            );
            const fs = campScanData.fireSelection ?? {};
            const cur = this._fireLevel ?? "unlit";
            const preview = this._campFirePreviewLevel ?? "embers";
            const coldSelected = !!this._coldCampDecided || (preview === "cold_camp");
            const hasTinder = campScanData?.canLightFire ?? false;
            const tierDisabledReason = (canPick, cost) => {
                if (canPick) return "";
                if (!hasTinder) return "Someone needs a tinderbox or flint and steel.";
                return `Need at least ${cost} firewood in the party.`;
            };
            campFirePickerLevels = [
                {
                    id: "embers",
                    label: "Embers",
                    costLabel: CampGearScanner.firewoodCostLabel("embers"),
                    disabled: !fs.canPickEmbers,
                    disabledReason: tierDisabledReason(fs.canPickEmbers, fs.costEmbers ?? 1),
                    selected: !coldSelected && (cur !== "unlit" ? cur === "embers" : preview === "embers")
                },
                {
                    id: "campfire",
                    label: "Campfire",
                    costLabel: CampGearScanner.firewoodCostLabel("campfire"),
                    disabled: !fs.canPickCampfire,
                    disabledReason: tierDisabledReason(fs.canPickCampfire, fs.costCampfire ?? 2),
                    selected: !coldSelected && (cur !== "unlit" ? cur === "campfire" : preview === "campfire")
                },
                {
                    id: "bonfire",
                    label: "Bonfire",
                    costLabel: CampGearScanner.firewoodCostLabel("bonfire"),
                    disabled: !fs.canPickBonfire,
                    disabledReason: tierDisabledReason(fs.canPickBonfire, fs.costBonfire ?? 3),
                    selected: !coldSelected && (cur !== "unlit" ? cur === "bonfire" : preview === "bonfire")
                }
            ];
        }

        let campFireIsLit = false;
        let campFireLitBy = null;
        let campFireLighters = [];
        let campFirewoodPledgeList = [];
        let campMyPledge = null;
        let campCanAddFirewood = false;
        let campMyFirewoodActorId = null;
        let campFireTierCards = [];
        let campFireTotalPledged = 0;
        let campViewerCanLight = false;
        let campFireOtherLighterCount = 0;
        let campFireLighterNames = "";
        if (this._phase === "camp" && campScanData) {
            campFireIsLit = (this._fireLevel ?? "unlit") !== "unlit";
            campFireLitBy = this._fireLitBy ?? null;
            campFireTotalPledged = Array.from(this._firewoodPledges.values()).reduce((s, p) => s + p.count, 0);

            const rawLighters = campScanData.fireLighters ?? [];
            const OWNER = CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
            const fireCantrips = game.ionrift?.respite?.adapter?.getFireCantrips?.() ?? [];
            const cantripLighters = [];
            for (const actor of getPartyActors()) {
                if (rawLighters.some(l => l.actorId === actor.id)) continue;
                const cantrip = fireCantrips.length > 0
                    ? actor.items.find(i => i.type === "spell" && (i.system?.level === 0) && fireCantrips.includes(i.name))
                    : null;
                if (cantrip) cantripLighters.push({ actorId: actor.id, actorName: actor.name, method: cantrip.name });
            }
            const rawLightersTagged = rawLighters.map(l => ({ ...l, methodType: "item", methodIcon: "fas fa-box" }));
            const cantripLightersTagged = cantripLighters.map(l => ({ ...l, methodType: "spell", methodIcon: "fas fa-magic" }));
            const allLighters = [...rawLightersTagged, ...cantripLightersTagged];

            campFireLighters = allLighters.map(l => ({
                ...l,
                isViewerActor: (game.actors.get(l.actorId)?.ownership?.[game.user.id] ?? 0) >= OWNER
            }));
            campViewerCanLight = campFireLighters.some(l => l.isViewerActor);
            campFireLighterNames = campFireLighters.map(l => l.actorName).filter((v, i, a) => a.indexOf(v) === i).join(", ");
            campFireOtherLighterCount = campFireLighters.filter(l => !l.isViewerActor).length;

            campFirewoodPledgeList = Array.from(this._firewoodPledges.values())
                .filter(p => p.count > 0)
                .map(p => ({ actorName: p.actorName, count: p.count }));

            campMyPledge = this._firewoodPledges.get(game.user.id) ?? null;

            if (campFireIsLit && campFireTotalPledged < 2) {
                if (game.user.isGM) {
                    campCanAddFirewood = true;
                    campMyFirewoodActorId = "__gm__";
                } else {
                    const firewoodHolders = campScanData.firewoodHolders ?? [];
                    const myPledgeCount = campMyPledge?.count ?? 0;
                    const ownedWithWood = firewoodHolders.find(h => {
                        const a = game.actors.get(h.actorId);
                        return a && (a.ownership?.[game.user.id] ?? 0) >= OWNER && h.count > myPledgeCount;
                    });
                    if (ownedWithWood) {
                        campCanAddFirewood = true;
                        campMyFirewoodActorId = ownedWithWood.actorId;
                    }
                }
            }

            const TIER_BODIES = {
                embers: "No cooking. No comfort change.",
                campfire: "Cooking and warmth. Easier for enemies to spot.",
                bonfire: "+1 camp comfort. Visible from far off."
            };
            const COMFORT_TIERS = ["hostile", "rough", "sheltered", "safe"];
            const TIER_LABELS = Object.fromEntries(
                COMFORT_TIERS.map(k => [k, CampGearScanner.getRules(k).label])
            );
            const baseComfort = campScanData.campComfortPreFire ?? campScanData.campComfort ?? "rough";
            const baseIdx = COMFORT_TIERS.indexOf(baseComfort);
            const COMFORT_DELTA = { embers: 0, campfire: 0, bonfire: 1 };
            // Highlight the chosen tier: committed level once lit, otherwise the live
            // preview. Cold camp suppresses any fire-tier highlight.
            const curLevel = this._fireLevel ?? "unlit";
            const previewLevel = this._campFirePreviewLevel ?? "embers";
            const coldActive = !!this._coldCampDecided || previewLevel === "cold_camp";
            campFireTierCards = ["embers", "campfire", "bonfire"].map(id => {
                const delta = COMFORT_DELTA[id] ?? 0;
                const resultIdx = Math.min(baseIdx + delta, COMFORT_TIERS.length - 1);
                const resultComfort = COMFORT_TIERS[resultIdx] ?? baseComfort;
                const resultLabel = TIER_LABELS[resultComfort] ?? resultComfort;
                const comfortHint = delta !== 0
                    ? `${TIER_LABELS[baseComfort] ?? baseComfort} to ${resultLabel}`
                    : resultLabel;
                return {
                    id,
                    label: id.charAt(0).toUpperCase() + id.slice(1),
                    costLabel: CampGearScanner.firewoodCostLabel(id),
                    body: TIER_BODIES[id],
                    comfortHint,
                    comfortChanged: delta !== 0,
                    active: !coldActive && (curLevel !== "unlit" ? curLevel === id : previewLevel === id)
                };
            });
        }

        const mapComfortLabel = campScanData?.campComfortLabel ?? "";
        const mapComfortLine = campScanData
            ? (campScanData.comfortReason
                ? `${campScanData.terrainLabel ? `${campScanData.terrainLabel}: ` : ""}${campScanData.comfortReason}`
                : (campScanData.terrainLabel
                    ? `${campScanData.terrainLabel} (${mapComfortLabel})`
                    : `Camp comfort: ${mapComfortLabel}`))
            : "";
        const mapComfortTierClass = campScanData?.campComfort
            ? `comfort-${campScanData.campComfort}`
            : "comfort-rough";

        // Personal rest outcome (HP / Hit Dice / exhaustion) for the viewer, scanned at the
        // previewed fire level so the risk/reward of each tier is tangible before lighting.
        let mapRestCard = null;
        let mapRestActorName = "";
        if (campScanData?.personalCards?.length) {
            const OWNER = CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
            let chosen = null;
            if (game.user.isGM) {
                chosen = this._selectedCharacterId
                    ? campScanData.personalCards.find(p => p.actorId === this._selectedCharacterId)
                    : null;
            } else {
                chosen = campScanData.personalCards.find(p => {
                    const a = game.actors.get(p.actorId);
                    return a && (a.ownership?.[game.user.id] ?? 0) >= OWNER;
                });
            }
            mapRestCard = chosen ?? campScanData.personalCards[0] ?? null;
            if (mapRestCard) {
                mapRestActorName = game.actors.get(mapRestCard.actorId)?.name ?? mapRestCard.actorName ?? "";
            }
        }

        return {
            campFireEncounterHint,
            campFireIsLit,
            campCurrentFireLevel: this._fireLevel ?? "unlit",
            mapRestCard,
            mapRestActorName,
            campFireLitBy,
            campFireLighters,
            campFirewoodPledgeList,
            campMyPledge,
            campCanAddFirewood,
            campMyFirewoodActorId,
            campFireTierCards,
            campFireTotalPledged,
            campColdCampDecided,
            campScanData,
            campFirePickerLevels,
            campFirePreviewLevel: this._campFirePreviewLevel ?? "embers",
            campPreviewIsColdCamp: this._isCampColdCampPreview(),
            campViewerCanLight,
            campFireOtherLighterCount,
            campFireLighterNames,
            mapComfortLabel,
            mapComfortLine,
            mapComfortTierClass
        };
    }

    _setShowCampfireCanvasPanel(v) {
        this._showCampfireCanvasPanel = !!v;
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

    /**
     * Player-facing night-check factors without numeric DC values.
     * @param {object} params
     * @returns {object[]}
     */
    _buildEncounterPlayerFactors(params) {
        const {
            terrainLabel,
            weather,
            weatherName,
            shelter,
            scouting,
            scoutingResult,
            complication,
            fire,
            fireLevel,
            totalDefenses,
            defensesPending,
            defensesFailed
        } = params;

        const factors = [{
            label: "Terrain DC",
            tone: "neutral",
            icon: "fas fa-mountain",
            tooltip: `${terrainLabel} sets the baseline camp exposure for this rest.`
        }];

        const wx = WEATHER_TABLE[weatherName ?? ""] ?? null;
        if (weather !== 0 || (wx && (wx.encounterDC !== 0 || wx.comfortPenalty > 0))) {
            factors.push({
                label: wx?.label ?? "Weather",
                tone: (wx?.encounterDC ?? 0) > 0 ? "risk" : "neutral",
                icon: "fas fa-cloud-sun-rain",
                tooltip: wx?.hint ?? "Weather shapes how exposed the camp feels tonight."
            });
        }

        if (shelter !== 0) {
            factors.push({
                label: "Shelter",
                tone: "help",
                icon: "fas fa-campground",
                tooltip: "Cover or a shelter spell hides the camp from wandering threats."
            });
        }

        if (scouting !== 0) {
            const tier = scoutingResult ?? "?";
            const tierLabel = tier === "none" ? "Scouting" : `Scout (${tier})`;
            factors.push({
                label: tierLabel,
                tone: scouting > 0 ? "help" : (scouting < 0 ? "risk" : "neutral"),
                icon: "fas fa-binoculars",
                tooltip: "Travel scouting shifts how prepared the camp is for the night."
            });
        }

        if (complication) {
            factors.push({
                label: "Complication",
                tone: "risk",
                icon: "fas fa-exclamation-triangle",
                tooltip: "Something from travel may surface during the night."
            });
        }

        if (fire !== 0) {
            const fireLabels = {
                embers: "Embers",
                campfire: "Campfire",
                bonfire: "Bonfire",
                cold_camp: "Cold camp",
                unlit: "Unlit"
            };
            factors.push({
                label: fireLabels[fireLevel] ?? "Fire",
                tone: fire < 0 ? "risk" : "help",
                icon: "fas fa-fire",
                tooltip: fire < 0
                    ? "Light makes the camp easier to spot."
                    : "A dark camp is harder for threats to find."
            });
        }

        if (totalDefenses !== 0) {
            factors.push({
                label: "Defenses",
                tone: "help",
                icon: "fas fa-shield-alt",
                tooltip: "Camp defenses are in place and holding."
            });
        } else if (defensesPending) {
            factors.push({
                label: "Defenses",
                tone: defensesFailed ? "risk" : "pending",
                icon: "fas fa-shield-alt",
                tooltip: defensesFailed
                    ? "Defenses were tried but did not hold."
                    : "Defenders are assigned. Outcome still pending."
            });
        }

        return factors;
    }

    /**
     * Header badges for Make Camp: terrain, live camp comfort, and weather impact.
     * @param {object|null} campScanData
     * @param {{ safeRestSpot?: boolean, encountersEnabled?: boolean }} opts
     * @returns {object|null}
     */
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

    /**
     * Resolve weather for setup UI and Begin Rest. Keeps the selection valid for the
     * active terrain and falls back to that terrain's default when unset or stale.
     * @param {string} terrainTag
     * @param {string|null|undefined} [candidate]
     * @returns {string}
     */
    _resolveSetupWeather(terrainTag, candidate) {
        const valid = TerrainRegistry.getWeather(terrainTag);
        const defaultKey = valid[0] ?? "clear";
        const pick = candidate ?? this._selectedWeather ?? defaultKey;
        return valid.includes(pick) ? pick : defaultKey;
    }

    async _prepareContext(options) {
        // Ensure terrain registry is loaded (no-ops after first call)
        await TerrainRegistry.init();
        // Ensure content packs and event data are loaded before building terrain options
        if (this._dataReady) await this._dataReady;

        if (!this._pendingSelections) this._pendingSelections = new Map();
        if (!this._expandedCards) this._expandedCards = new Set();
        if (!this._craftingInProgress) this._craftingInProgress = new Set();
        if (!this._shelterOverrides) this._shelterOverrides = {};

        if (this._phase === "activity") {
            this._applyLoseActivityTravelLocks();
            this._applyAutoOtherWhenSoleActivity();
            this._ensureTrainingStateForLockedChoices();
        }

        const partyActors = getPartyActors();
        const emptyParty = partyActors.length === 0;
        if (!this._selectedTerrain) {
            const lastTerrain = game.settings.get(MODULE_ID, "lastTerrain");
            if (lastTerrain && TerrainRegistry.get(lastTerrain)) this._selectedTerrain = lastTerrain;
        }
        const terrainDefaults = TerrainRegistry.getDefaults(this._selectedTerrain ?? "forest");
        const defaultComfort = terrainDefaults.comfort;

        if (this._phase === "setup" && !emptyParty) {
            this._selectedWeather = this._resolveSetupWeather(this._selectedTerrain ?? "forest");
        }

        // â”€â”€ Shelter detection â”€â”€


        // Determine current rest type from state (defaults to long)
        const currentRestType = this._selectedRestType ?? "long";

        let safeRestSpotFromSetting = false;
        try {
            safeRestSpotFromSetting = !!game.settings.get(MODULE_ID, "safeRestSpot");
        } catch { /* settings not ready */ }
        const safeRestSpot = !!(this._engine?.safeRestSpot ?? this._restData?.safeRestSpot ?? safeRestSpotFromSetting);

        let encountersEnabled = true;
        try {
            encountersEnabled = !!game.settings.get(MODULE_ID, "enableEncounters");
        } catch { /* settings not ready */ }

        if ((safeRestSpot || !isComfortEnabled() || !this._totmFireTabVisible())
            && this._isTotM && this._phase === "activity" && this._totmActiveTab === "fire") {
            this._totmActiveTab = "activities";
        }
        if (!isWorkbenchIdentifyUiEnabled() && this._isTotM && this._phase === "activity" && this._totmActiveTab === "identify") {
            this._totmActiveTab = "activities";
        }
        if (this._isTotM && this._phase === "activity" && this._totmActiveTab === "campfire") {
            this._totmActiveTab = "activities";
        }

        // Detect tents from party inventory
        const tentOwners = partyActors.filter(a =>
            a.items?.some(i => i.name?.toLowerCase().includes("tent"))
        );
        const tentAvailable = tentOwners.length > 0;
        const tentOwnerNames = tentOwners.map(a => a.name).join(", ");

        // Detect shelter spells from party spell lists, filtered by rest type
        const shelterOptions = SHELTER_SPELLS
            .filter(spell => spell.restTypes.includes(currentRestType))
            .map(spell => {
                const casters = partyActors.filter(a =>
                    a.items?.some(i => {
                        if (i.type !== "spell") return false;
                        const spellName = i.name?.toLowerCase() ?? "";
                        return spell.altNames.some(alt => spellName.includes(alt));
                    })
                );
                const hasCaster = casters.length > 0;
                return {
                    ...spell,
                    available: hasCaster,
                    casterNames: casters.map(a => a.name).join(", "),
                    hint: hasCaster ? spell.hint : `Requires ${spell.name} spell. No one in the party has it prepared.`,
                    active: !!this._shelterOverrides[spell.id]
                };
            });

        // Add tent as first shelter option (long rest only)
        if (currentRestType === "long") {
            shelterOptions.unshift({
                id: "tent",
                name: "Tent",
                icon: "fas fa-campground",
                available: tentAvailable,
                casterNames: tentOwnerNames,
                hint: tentAvailable ? `Carried by ${tentOwnerNames}. Weather shield. Encounter DC +2.` : "No tent in party inventory.",
                rpPrompt: "Who sets it up? Where do they pitch it? Is it large enough for everyone, or do some sleep outside?",
                comfortFloor: null,
                encounterMod: 2,
                active: !!this._shelterOverrides.tent
            });
        }

        // Add "No Shelter" as the last option (always available)
        shelterOptions.push({
            id: "none",
            name: "Open Air",
            icon: "fas fa-cloud-moon",
            available: true,
            casterNames: null,
            hint: "Under the open sky. No protection from weather or encounters.",
            rpPrompt: null,
            comfortFloor: null,
            encounterMod: 0,
            active: !!this._shelterOverrides.none
        });

        // Compute active shelter effect for comfort indicator
        const activeShelterId = Object.entries(this._shelterOverrides ?? {}).find(([, v]) => v)?.[0];
        const isTavern = (this._selectedTerrain ?? "forest") === "tavern";
        const shelterChosen = isTavern || !!activeShelterId;
        const activeShelter = activeShelterId ? shelterOptions.find(s => s.id === activeShelterId) : null;

        const shelterEffect = activeShelter ? {
            name: activeShelter.name,
            comfortFloor: activeShelter.comfortFloor,
            encounterMod: activeShelter.encounterMod ?? 0,
            rpPrompt: activeShelter.rpPrompt ?? null,
            casterNames: activeShelter.casterNames ?? null
        } : null;



        // Activity icon mapping

        // Pre-compute party state for contextual advisories
        const partyState = this.getPartyStateForAdvisory();
        const characterStatuses = partyActors.map(a => {
            const gmOverride = this._gmOverrides.get(a.id);
            const playerChoice = this._getPlayerChoiceForCharacter(a.id);
            const effectiveChoice = gmOverride ?? playerChoice?.activityId ?? this._characterChoices?.get(a.id) ?? null;
            let source = gmOverride ? "gm" : playerChoice ? "player" : "pending";

            // Fallback: choices restored via receiveSubmissionUpdate land in
            // _characterChoices (keyed by charId) but not in _playerSubmissions
            // (keyed by userId). Count them as "player" sourced.
            if (source === "pending" && this._characterChoices?.has(a.id)) {
                source = "player";
            }

            let activityName = null;
            if (effectiveChoice) {
                const act = this._activities?.find(act => act.id === effectiveChoice);
                activityName = act?.name ?? effectiveChoice;
            }

            // Fallback: use submission status from socket for non-owned characters (player side)
            if (!this._isGM && source === "pending" && this._submissionStatus?.[a.id]) {
                const sub = this._submissionStatus[a.id];
                source = sub.source ?? "player";
                activityName = sub.activityName ?? activityName;
            }

            // Derive profession badges from available crafting activities
            const professionBadges = [];
            const professionIcons = {
                cooking: "fas fa-utensils", alchemy: "fas fa-flask",
                smithing: "fas fa-hammer", leatherworking: "fas fa-shield-alt",
                brewing: "fas fa-flask", tailoring: "fas fa-cut"
            };
            const fireLevel = this._fireLevel ?? "unlit";
            const isFireLit = !!(this._fireLevel && this._fireLevel !== "unlit");
            const { available: avail, faded: fadedActivities, minor: minorActivities, fadedMinor: fadedMinorActivities } = this._activityResolver.getAvailableActivitiesWithFaded(a, this._engine?.restType ?? "long", {
                isFireLit,
                fireLevel,
                safeRestSpot,
                ...this._forageResolverOpts()
            });
            for (const act of avail) {
                if (act.crafting?.enabled) {
                    professionBadges.push({
                        label: act.name,
                        icon: professionIcons[act.crafting.profession] ?? "fas fa-tools"
                    });
                }
            }

            // Armor don/doff advisory (Xanathar's optional rule; full UI on activity detail)
            const armorWarning = this._buildArmorWarningForActor(a);

            // Build unified tile list with tooltips
            const pendingId = this._pendingSelections.get(a.id);
            const tileActivities = avail.map(act => {
                // Build tooltip lines
                const lines = [act.description];
                if (act.check) {
                    if (act.check.ability) {
                        const abilityLabel = act.check.ability.toUpperCase();
                        lines.push(`Check: ${abilityLabel}, DC ${act.check.dc ?? 12}`);
                    } else {
                        const primary = SKILL_NAMES[act.check.skill] ?? act.check.skill;
                        const alt = act.check.altSkill ? ` or ${SKILL_NAMES[act.check.altSkill] ?? act.check.altSkill}` : "";
                        lines.push(`Check: ${primary}${alt}, DC ${act.check.dc ?? 12}`);
                    }
                }
                if (act.outcomes?.success?.effects?.length) {
                    lines.push(act.outcomes.success.effects.map(e => e.description).join(". "));
                }
                if (act.outcomes?.success?.items?.length) {
                    lines.push(act.outcomes.success.items.map(i => {
                        const qty = i.quantity ?? 1;
                        return `Creates: ${typeof qty === "string" ? qty : qty + "x"} ${i.itemRef ?? i.pool ?? "items"}`;
                    }).join(", "));
                }
                if (!act.check && act.outcomes?.success?.narrative) {
                    lines.push(act.outcomes.success.narrative);
                }



                // Determine type tag
                let typeTag = "Passive";
                if (act.crafting?.enabled) typeTag = "Craft";
                else if (act.check) typeTag = "Skill";
                if (act.group) typeTag = "Group";

                const advisory = getActivityAdvisory(act.id, a, partyState);

                return {
                    id: act.id,
                    name: act.name,
                    description: act.description ?? "",
                    icon: ACTIVITY_ICONS[act.id] ?? "fas fa-circle",
                    typeTag,
                    category: act.category ?? "active",
                    tooltip: lines.join("\n"),
                    isCrafting: !!act.crafting?.enabled,
                    profession: act.crafting?.profession ?? null,
                    isSelected: pendingId === act.id,
                    isDisabled: false,
                    check: act.check ?? null,
                    outcomes: act.outcomes ?? null,
                    combatModifiers: act.combatModifiers ?? null,
                    followUp: act.followUp ?? null,
                    armorSleepWaiver: act.armorSleepWaiver ?? false,

                    hint: advisory.text,
                    hintUrgent: advisory.urgent
                };
            });

            // Build faded tile objects
            const fadedTiles = fadedActivities.map(act => {
                let typeTag = "Spell";
                if (act.crafting?.enabled) typeTag = "Craft";
                else if (act.check) typeTag = "Skill";
                return {
                    id: act.id,
                    name: act.name,
                    icon: ACTIVITY_ICONS[act.id] ?? "fas fa-circle",
                    typeTag,
                    category: act.category ?? "arcane",
                    tooltip: act.fadedHint,
                    isCrafting: !!act.crafting?.enabled,
                    profession: act.crafting?.profession ?? null,
                    isSelected: false,
                    isDisabled: true,
                    isFaded: true,
                    fadedHint: act.fadedHint,
                    combatModifiers: act.combatModifiers ?? null,
                    followUp: act.followUp ?? null,
                    armorSleepWaiver: act.armorSleepWaiver ?? false
                };
            });

            // Group non-crafting tiles by category (ordered martial -> clerical)
            const allTiles = [...tileActivities.filter(t => !t.isCrafting), ...fadedTiles];
            const CATEGORY_ORDER = [
                { keys: ["camp", "recovery"], label: "Camp Duties" },
                { keys: ["active", "arcane"], label: "Personal" }
            ];
            // Arcane tiles (Attune, Copy Spell) sort last within Personal
            const SORT_LAST_CATS = new Set(["arcane"]);
            const tileCategories = CATEGORY_ORDER
                .map(cat => ({
                    label: cat.label,
                    tiles: allTiles
                        .filter(t => cat.keys.includes(t.category))
                        .sort((a, b) => (SORT_LAST_CATS.has(a.category) ? 1 : 0) - (SORT_LAST_CATS.has(b.category) ? 1 : 0))
                }))
                .filter(cat => cat.tiles.length > 0);

            const professionTiles = [
                ...tileActivities.filter(t => t.isCrafting),
                ...fadedTiles.filter(t => t.isCrafting)
            ];

            // Station-grouped activity cards (terrain-filtered)
            const allAvailableIds = new Set(allTiles.map(t => t.id));
            const terrainStations = getStationsForTerrain(this._selectedTerrain ?? this._engine?.terrainTag ?? "forest", safeRestSpot);
            const stationCards = terrainStations
                .map(station => {
                    const stationTiles = station.activities
                        .filter(id => allAvailableIds.has(id))
                        .map(id => allTiles.find(t => t.id === id))
                        .filter(Boolean);
                    if (!stationTiles.length) return null;
                    return {
                        id: station.id,
                        label: station.label,
                        icon: station.icon,
                        furnitureKey: station.furnitureKey,
                        tiles: stationTiles
                    };
                })
                .filter(Boolean);

            /** Two flex columns so short stations (e.g. Workbench) do not leave a tall row gap above the next left card. */
            const stationCardColumns = [[], []];
            for (let i = 0; i < stationCards.length; i++) {
                stationCardColumns[i % 2].push(stationCards[i]);
            }

            // Comfort gear badges
            const actorItems = a.items?.map(i => i.name?.toLowerCase()) ?? [];
            const gearBadges = [
                { id: "bedroll", icon: "fas fa-bed", name: "Bedroll", present: actorItems.some(n => n?.includes("bedroll")), tooltip: "Bedroll: +1 Hit Die recovered during long rest" },
                { id: "messkit", icon: "fas fa-utensils", name: "Mess Kit", present: actorItems.some(n => n?.includes("mess kit") || (n?.includes("cook") && n?.includes("utensil"))), tooltip: "Mess Kit: advantage on exhaustion saves (requires lit fire)" },
                { id: "tent", icon: "fas fa-campground", name: "Tent", present: actorItems.some(n => n?.includes("tent")), tooltip: "Tent: personal shelter, cancels or reduces weather penalties" }
            ];

            return {
                id: a.id,
                name: a.name,
                img: a.img || "icons/svg/mystery-man.svg",
                choice: effectiveChoice,
                activityName,
                source,
                professionBadges,
                tileCategories,
                stationCards,
                stationCardColumns,
                professionTiles,
                armorWarning,
                gearBadges,
                minorActivities: minorActivities.map(m => ({
                    id: m.id,
                    name: m.name,
                    description: m.description,
                    icon: ACTIVITY_ICONS[m.id] ?? "fas fa-circle"
                })),
                fadedMinorActivities: (fadedMinorActivities ?? []).map(m => ({
                    id: m.id,
                    name: m.name,
                    fadedHint: m.fadedHint,
                    icon: ACTIVITY_ICONS[m.id] ?? "fas fa-circle"
                })),
                hasProfessionTiles: professionTiles.length > 0,
                hasPending: !!pendingId,
                isOwner: this._isGM || this._myCharacterIds?.has(a.id),
                isAfk: RestAfkState.isAfk(a.id),
                isLocked: source !== "pending" || this._lockedCharacters.has(a.id),
                earlyResult: (() => {
                    // Suppress early result if a Copy Spell result exists (final replaces pending)
                    if (this._copySpellResult?.actorId === a.id) return null;
                    const er = this._earlyResults?.get(a.id);
                    if (!er) return null;
                    const tier = er.result === "exceptional" ? "Exceptional"
                        : er.result === "success" ? "Success"
                        : er.result === "failure_complication" ? "Failed"
                        : er.result === "failure" ? "Failed"
                        : er.result === "pending_approval" ? "Pending"
                        : er.result;
                    const isPending = er.result === "pending_approval";
                    return { tier, narrative: er.narrative ?? "", isSuccess: er.result === "success" || er.result === "exceptional", isFailure: er.result === "failure" || er.result === "failure_complication", isPending };
                })(),
                isExpanded: this._isGM ? (this._expandedCards?.has(a.id) ?? false) : true,
                isCraftingInProgress: this._craftingInProgress?.has(a.id) ?? false,
                exhaustion: a.system?.attributes?.exhaustion ?? 0,
                copySpellProposal: this._copySpellProposal?.actorId === a.id ? this._copySpellProposal : null,
                copySpellResult: this._copySpellResult?.actorId === a.id ? this._copySpellResult : null
            };
        });

        // Early-init: ensure _selectedCharacterId is set before card builders use it.
        // On first render _selectedCharacterId is null; pick the first owned character.
        if (!this._selectedCharacterId && partyActors.length > 0) {
            if (this._isGM) {
                this._selectedCharacterId = partyActors[0].id;
            } else {
                const owned = partyActors.find(a => a.isOwner);
                this._selectedCharacterId = owned?.id ?? partyActors[0].id;
            }
        }

        if (this._phase === "activity") {
            this._syncIncompleteTrainingView();
        }

        // ── TotM station cards (global, not per-character) ─────────────────
        const totmStationCards = (() => {
            if (!this._isTotM) return [];
            if (this._phase !== "activity") return [];

            // Gather the union of available + faded activity IDs across all party members
            const fireLevel = this._fireLevel ?? "unlit";
            const isFireLit = !!(this._fireLevel && this._fireLevel !== "unlit");
            const resolverOpts = { isFireLit, fireLevel, safeRestSpot, ...this._forageResolverOpts() };
            const restType = this._engine?.restType ?? "long";
            const seenIds = new Set();
            const unionTiles = [];

            // Advisory and availability are computed for the selected actor only.
            // This ensures "No one is injured" etc. reflect the chosen character's perspective.
            const selectedActor = game.actors.get(this._selectedCharacterId);
            const actorsToScan = selectedActor ? [selectedActor] : partyActors;

            for (const a of actorsToScan) {
                const { available: avail, faded } = this._activityResolver.getAvailableActivitiesWithFaded(a, restType, resolverOpts);
                for (const act of [...avail, ...faded]) {
                    if (seenIds.has(act.id)) continue;
                    seenIds.add(act.id);
                    const isAvail = avail.some(x => x.id === act.id);
                    unionTiles.push(buildActivityListItem(act.id, act, a, partyState, isAvail));
                }
            }

            // Portrait assignments
            const assignments = buildActivityAssignments(this._characterChoices, this._earlyResults);
            for (const tile of unionTiles) {
                applyActivityPortraitAssignments(tile, assignments[tile.id] ?? []);
            }

            // If the selected character already has a locked activity, downgrade all tiles to faded
            const charLocked = this._lockedCharacters?.has(this._selectedCharacterId)
                || (this._isGM && this._gmOverrides?.has(this._selectedCharacterId));
            if (charLocked) {
                for (const tile of unionTiles) {
                    tile.available = false;
                    tile.nonViable = false;
                }
            }

            // Detail panel data is built in the totmDetailPanel variable below.
            // Tiles do not carry expanded state â€” the grid is hidden entirely when detail is open.

            const tileMap = new Map(unionTiles.map(t => [t.id, t]));
            const terrain = this._selectedTerrain ?? this._engine?.terrainTag ?? "forest";
            const terrainStations = getStationsForTerrain(terrain, safeRestSpot);

            // TotM: keep all stations as separate sections, skip only campfire.
            // Identify goes to a future tab; deduplicate activities across stations.
            const SKIP_STATIONS = new Set(["campfire"]);
            const IDENTIFY_TAB_IDS = new Set(["act_identify"]);
            const TOTM_LABELS = { medical_bed: "First Aid" };
            const TOTM_ORDER = { weapon_rack: 0, workbench: 1, cooking_station: 2, medical_bed: 3, bedroll: 4 };
            const usedIds = new Set();

            const cards = [];
            for (const station of terrainStations) {
                if (SKIP_STATIONS.has(station.id)) continue;

                const tiles = station.activities
                    .filter(id => !IDENTIFY_TAB_IDS.has(id) && !usedIds.has(id))
                    .map(id => tileMap.get(id))
                    .filter(Boolean);

                for (const t of tiles) usedIds.add(t.id);

                if (!tiles.length) continue;
                cards.push({
                    id: station.id,
                    label: TOTM_LABELS[station.id] ?? station.label,
                    icon: station.icon,
                    tiles
                });
            }
            cards.sort((a, b) => (TOTM_ORDER[a.id] ?? 99) - (TOTM_ORDER[b.id] ?? 99));
            return cards;
        })();

        // TotM detail panel: full-width view replacing the grid when an activity is being inspected.
        // Single authoritative source: buildActivityDetailContext() from ActivityDetailBuilder.
        const totmDetailPanel = (() => {
            if (this._phase !== "activity") return null;
            if (!this._isTotM) return null;

            let expanded = this._totmFollowUpExpanded;
            const selectedId = this._selectedCharacterId;

            // After Training is confirmed, keep the detail view open until all sets are rolled.
            if (!expanded && selectedId
                && this._trainingStates?.has(selectedId)
                && !this._earlyResults?.has(selectedId)
                && this._characterChoices?.get(selectedId) === "act_train") {
                expanded = { activityId: "act_train", characterId: selectedId, trainingActive: true };
            }

            if (!expanded) return null;
            const expandActor = game.actors.get(expanded.characterId);
            if (!expandActor) return null;

            // ── Crafting branch: inline crafting using the STATION UI layout ──
            // Produces the same `crafting` context shape as StationActivityDialog._buildCraftingContext()
            // so the template can reuse the station split-panel markup verbatim (no split-brain).
            if (expanded.isCrafting) {
                const professionId = expanded.profession;
                const professionLabels = {
                    cooking: "Cooking", alchemy: "Alchemy",
                    smithing: "Smithing", leatherworking: "Leatherworking",
                    brewing: "Brewing", tailoring: "Tailoring"
                };
                const engine = this._craftingEngine;
                const terrainTag = this._engine?.terrainTag ?? this._restData?.terrainTag ?? null;
                const risk = this._totmCraftRisk ?? "standard";
                const partySize = getPartyActors().length;
                const status = engine.getRecipeStatus(expandActor, professionId, terrainTag, partySize);

                const _formatBuffPreview = (buff) => {
                    if (!buff) return null;
                    const labels = { temp_hp: "Temp HP", advantage: "Advantage", exhaustion_save: "Exhaustion Save" };
                    const dur = { immediate: "Immediate", untilLongRest: "Until long rest", nextSave: "Next save" };
                    return { label: labels[buff.type] ?? buff.type, formula: buff.formula ?? "", duration: dur[buff.duration] ?? buff.duration ?? "", target: buff.target ?? "self" };
                };

                const enrichRecipe = (recipe) => {
                    const dcBreakdown = engine.getDcBreakdown(expandActor, recipe, risk, terrainTag);
                    const flags = recipe.outputFlags?.["ionrift-respite"];
                    return {
                        ...recipe,
                        dcDisplay: dcBreakdown.total,
                        dcBreakdown,
                        outputName: recipe.output?.name ?? "Unknown",
                        outputImg: recipe.output?.img ?? "icons/consumables/food/bowl-stew-brown.webp",
                        ambitiousOutput: recipe.ambitiousOutput,
                        isSelected: recipe.id === this._totmCraftRecipeId,
                        description: recipe.description ?? "",
                        buffPreview: _formatBuffPreview(flags?.buff),
                        isPartyMeal: !!flags?.partyMeal,
                        isWellFed: !!flags?.wellFed,
                        satiates: flags?.satiates ?? [],
                        ambitiousName: recipe.ambitiousOutput?.name ?? null,
                        ambitiousBuffPreview: _formatBuffPreview(
                            recipe.ambitiousOutputFlags?.["ionrift-respite"]?.buff ?? flags?.buff
                        ),
                        ingredientList: (recipe.ingredients ?? []).map(ing => {
                            const detail = recipe.ingredientStatus?.details?.find(d => d.name === ing.name);
                            const invKey = ing.name.toLowerCase().trim();
                            const invEntry = expandActor.items?.find(i => i.name.toLowerCase().trim() === invKey);
                            const fallbackIcon = ing.resourceType === "water"
                                ? "icons/magic/water/water-drop-swirl-blue.webp"
                                : "icons/consumables/food/bread-loaf-round-white.webp";
                            const rawImg = invEntry?.img;
                            return {
                                name: ing.name,
                                required: ing.quantity ?? 1,
                                available: detail?.available ?? 0,
                                met: detail?.met ?? false,
                                img: (rawImg && !rawImg.includes("mystery-man")) ? rawImg : fallbackIcon
                            };
                        })
                    };
                };

                const available = status.available.map(r => enrichRecipe(r));
                const partial = status.partial.map(r => enrichRecipe(r));
                const selectedRecipe = available.find(r => r.id === this._totmCraftRecipeId)
                    ?? partial.find(r => r.id === this._totmCraftRecipeId);

                let commitSummary = null;
                if (selectedRecipe && !this._totmCraftHasCrafted) {
                    const outputForRisk = risk === "ambitious" && selectedRecipe.ambitiousOutput
                        ? selectedRecipe.ambitiousOutput : selectedRecipe.output;
                    commitSummary = {
                        recipeName: selectedRecipe.name,
                        dc: selectedRecipe.dcBreakdown.total,
                        dcBreakdown: selectedRecipe.dcBreakdown,
                        risk,
                        riskLabel: { standard: "Standard", ambitious: "Ambitious" }[risk],
                        outputName: outputForRisk?.name ?? selectedRecipe.outputName,
                        outputImg: outputForRisk?.img ?? selectedRecipe.outputImg ?? "icons/svg/mystery-man.svg",
                        outputQuantity: outputForRisk?.quantity ?? 1,
                        ingredients: (selectedRecipe.ingredients ?? []).map(ing => {
                            const invKey = ing.name.toLowerCase().trim();
                            const invEntry = expandActor.items?.find(i => i.name.toLowerCase().trim() === invKey);
                            const fallbackIcon = ing.resourceType === "water"
                                ? "icons/magic/water/water-drop-swirl-blue.webp"
                                : "icons/consumables/food/bread-loaf-round-white.webp";
                            const rawImg = invEntry?.img;
                            return {
                                name: ing.name,
                                quantity: ing.quantity ?? 1,
                                img: (rawImg && !rawImg.includes("mystery-man")) ? rawImg : fallbackIcon
                            };
                        }),
                        ingredientCost: (selectedRecipe.ingredients ?? []).map(i => `${i.quantity ?? 1}x ${i.name}`).join(", "),
                        failConsequence: "Ingredients consumed on failure",
                        skill: (selectedRecipe.skill ?? "sur").toUpperCase()
                    };
                }

                return {
                    isCrafting: true,
                    name: professionLabels[professionId] ?? professionId,
                    icon: "fas fa-hammer",
                    actorName: expandActor.name,
                    actorPortrait: expandActor.img ?? expandActor.prototypeToken?.texture?.src ?? "icons/svg/mystery-man.svg",
                    // Station-compatible `crafting` sub-object (same shape as StationActivityDialog)
                    crafting: {
                        profession: professionLabels[professionId] ?? professionId,
                        professionId,
                        actorName: expandActor.name,
                        actorImg: expandActor.img,
                        selectedRisk: risk,
                        selectedRecipeId: this._totmCraftRecipeId,
                        hasCrafted: !!this._totmCraftHasCrafted,
                        rollPending: !!this._totmCraftRollPending,
                        showMissing: !!this._totmCraftShowMissing,
                        riskTiers: [
                            { id: "standard", label: "Standard", hint: "Base DC · Ingredients used", selected: risk === "standard" },
                            { id: "ambitious", label: "Ambitious", hint: "DC +5 · Better yield", selected: risk === "ambitious" }
                        ],
                        available,
                        partial,
                        selectedRecipe: selectedRecipe ?? null,
                        isAmbitiousSelected: risk === "ambitious",
                        commitSummary,
                        craftingResult: this._totmCraftResult ? {
                            ...this._totmCraftResult,
                            isPartyMeal: !!(selectedRecipe?.isPartyMeal ?? false),
                            partyMealDispositionDone: !!this._totmFeastServed,
                            partyRoster: getPartyActors().map(a => ({
                                id: a.id,
                                name: a.name,
                                img: a.img || "icons/svg/mystery-man.svg",
                                alreadyWellFed: a.effects?.some(e => e.flags?.[MODULE_ID]?.wellFed === true) ?? false
                            }))
                        } : null
                    }
                };
            }

            // ── Standard activity detail panel ──
            const expandActivity = this._activityResolver?.activities?.get(expanded.activityId);
            if (!expandActivity) return null;
            const comfort = this._engine?.comfort ?? "sheltered";
            const existingFollowUp = this._gmFollowUps?.get(expanded.characterId) ?? null;
            let armorDoffSetting = false;
            try { armorDoffSetting = !!game.settings.get(MODULE_ID, "armorDoffRule"); } catch { /* ok */ }
            const armorRuleEnabled = !safeRestSpot && armorDoffSetting;
            const detail = buildActivityDetailContext(
                expanded.activityId, expandActivity, expandActor, partyState,
                {
                    comfort,
                    followUpValue: existingFollowUp,
                    armorRuleEnabled,
                    getArmorWarning: armorRuleEnabled
                        ? (this.getArmorWarningForActivityDetail?.bind(this) ?? null)
                        : null
                }
            );
            const trainingPending = expanded.activityId === "act_train"
                && this._trainingStates?.has(expanded.characterId)
                && !this._earlyResults?.has(expanded.characterId);
            const trainingPanel = trainingPending
                ? this._buildTrainingViewContext(expanded.characterId)
                : null;
            return {
                ...detail,
                actorName:    expandActor.name,
                actorPortrait: expandActor.img ?? expandActor.prototypeToken?.texture?.src ?? "icons/svg/mystery-man.svg",
                trainingPanel,
                isTrainingRolling: !!trainingPanel
            };
        })();

        // Split into hero cards (owned, interactive) and party cards (others, info only)
        // GM sees all as heroes since they manage all characters
        const heroCharacters = this._isGM
            ? characterStatuses
            : characterStatuses.filter(c => c.isOwner);
        const partyCharacters = this._isGM
            ? []
            : characterStatuses.filter(c => !c.isOwner);

        // Roster strip: compact summary for ALL characters (everyone sees the full party)
        if (!this._selectedCharacterId && heroCharacters.length > 0) {
            this._selectedCharacterId = heroCharacters[0].id;
            closeStationDialogIfDifferentActor(this._selectedCharacterId);
        }
        const roster = characterStatuses.map(c => {
            // Check event/tree roll status for this character. The roster strip is the
            // shared status surface: when an event or decision-tree roll is in flight the
            // roll-request component suppresses its own avatar list and delegates the
            // pending/rolled/forced state here so every client sees the same picture.
            let pendingRoll = false;
            let rolledResult = null;
            let rollMode = null;

            if (this._isGM) {
                // GM: check triggeredEvents for awaiting rolls
                const awaitingEvent = (this._triggeredEvents ?? []).find(e => e.awaitingRolls);
                if (awaitingEvent) {
                    if (awaitingEvent.pendingRolls?.includes(c.id)) pendingRoll = true;
                    const resolved = awaitingEvent.resolvedRolls?.find(r => r.characterId === c.id);
                    if (resolved) rolledResult = resolved.total;
                    rollMode = awaitingEvent.rollModes?.[c.id] ?? rollMode;
                }
                // Decision-tree rolls dispatched from the active tree state
                if (!pendingRoll && !rolledResult) {
                    const ts = this._activeTreeState;
                    if (ts?.awaitingRolls) {
                        const resolved = (ts.resolvedRolls ?? []).find(r => (r.characterId ?? r.actorId) === c.id);
                        if (resolved) rolledResult = resolved.total ?? "done";
                        else if (ts.pendingRolls?.includes(c.id)) pendingRoll = true;
                        if (pendingRoll || rolledResult) rollMode = ts.pendingRollModes?.[c.id] ?? rollMode;
                    }
                }
                // Also check camp activity rolls
                if (!pendingRoll && !rolledResult && this._pendingCampRolls?.length) {
                    const campEntry = this._pendingCampRolls.find(p => p.characterId === c.id);
                    if (campEntry) {
                        if (campEntry.status === "pending") pendingRoll = true;
                        else rolledResult = campEntry.total ?? "done";
                    }
                }
            } else {
                // Player: check pendingEventRoll
                if (this._pendingEventRoll) {
                    const targets = this._pendingEventRoll.targets ?? [];
                    if (targets.includes(c.id)) {
                        if (this._pendingEventRoll.rolledCharacters?.has(c.id)) {
                            rolledResult = "done";
                        } else {
                            pendingRoll = true;
                        }
                        rollMode = this._pendingEventRoll.rollModes?.[c.id] ?? rollMode;
                    }
                }
                // Decision-tree rolls dispatched to the player
                if (!pendingRoll && !rolledResult && this._pendingTreeRoll) {
                    const targets = this._pendingTreeRoll.targets ?? [];
                    if (targets.includes(c.id)) {
                        if (this._pendingTreeRoll.rolledCharacters?.has(c.id)) {
                            const res = this._pendingTreeRoll.rolledResults?.get?.(c.id);
                            rolledResult = res?.total ?? "done";
                        } else {
                            pendingRoll = true;
                        }
                        rollMode = this._pendingTreeRoll.rollModes?.[c.id] ?? rollMode;
                    }
                }
                // Also check camp activity rolls
                if (!pendingRoll && !rolledResult && this._pendingCampRoll) {
                    const campAct = this._pendingCampRoll.activities?.find(a => a.characterId === c.id);
                    if (campAct) {
                        if (this._pendingCampRoll.rolledCharacters?.has(c.id)) {
                            rolledResult = "done";
                        } else {
                            pendingRoll = true;
                        }
                    }
                }
            }

            // Training: activity locked but the three sets are not finished yet.
            if (!pendingRoll && !rolledResult
                && this._trainingStates?.has(c.id)
                && !this._earlyResults?.has(c.id)) {
                pendingRoll = true;
            }

            // Forced outcomes resolve without a roll; surface them as settled, not pending.
            if (pendingRoll && (rollMode === "force-pass" || rollMode === "force-fail")) {
                pendingRoll = false;
            }

            // Look up assigned activity for roster label (all phases once chosen)
            let activityLabel = null;
            const actId = this._gmOverrides?.get(c.id) ?? this._characterChoices?.get(c.id);
            if (actId) {
                const act = this._activities?.find(a => a.id === actId);
                activityLabel = act?.name ?? null;
            }

            // Travel phase: surface the travel declaration as the activity label
            if (!activityLabel && this._phase === "travel") {
                const activeDay = this._travelActiveDay ?? 1;
                const decl = this._isGM
                    ? (this._travel?.getDayDeclarations?.(activeDay)?.[c.id] ?? "nothing")
                    : (this._playerTravelDeclarations?.[activeDay]?.[c.id]
                        ?? this._syncedTravelDeclarations?.[activeDay]?.[c.id]
                        ?? this._syncedTravelDeclarations?.[c.id]
                        ?? "nothing");
                const TRAVEL_LABELS = { forage: "Forage", hunt: "Hunt", scout: "Scout" };
                activityLabel = TRAVEL_LABELS[decl] ?? null;
            }

            const isBeddedDown = (this._phase === "events" || this._phase === "reflection")
                && !this._nightWatchActorIds().has(c.id);

            // Meal phase: surface each character's ration fill status on the chip so
            // the GM can see at a glance who still has no food/water assigned before
            // running the group-wide Process Rations step.
            let mealStatus = null;
            if (this._phase === "meal" && (this._isGM || c.isOwner) && game.settings.get(MODULE_ID, "trackFood")) {
                const card = this.getStationMealCardForActor(c.id);
                if (card) {
                    const submitted = card.playerSubmitted === true;
                    const consumed = card.allDaysConsumed === true || (card.consumedDaysCount ?? 0) > 0;
                    const foodOk = !!card.foodSufficient;
                    const waterOk = !!card.waterSufficient;
                    const anyFilled = (card.foodFilledCount ?? 0) > 0 || (card.waterFilledCount ?? 0) > 0;
                    let state;
                    if (submitted || consumed || (foodOk && waterOk)) state = "ready";
                    else if (anyFilled) state = "partial";
                    else state = "empty";
                    const tooltip = submitted ? "Rations submitted"
                        : consumed ? "Meals consumed"
                        : state === "ready" ? "Food and water assigned"
                        : state === "partial" ? `Incomplete: ${foodOk ? "food set" : "food missing"}, ${waterOk ? "water set" : "water missing"}`
                        : "No rations assigned";
                    mealStatus = { state, foodOk, waterOk, submitted, consumed, tooltip };
                }
            }

            return {
                id: c.id,
                name: c.name.split(" ")[0],  // First name only
                fullName: c.name,
                img: c.img,
                source: c.source,
                isAfk: RestAfkState.isAfk(c.id),
                isOwner: c.isOwner,
                isSelected: c.id === this._selectedCharacterId,
                exhaustion: c.exhaustion,
                pendingRoll,
                rolledResult,
                rollMode,
                activityLabel,
                isBeddedDown,
                mealStatus
            };
        });

        const selectedCharacter = heroCharacters.find(c => c.id === this._selectedCharacterId) ?? heroCharacters[0] ?? null;

        const totalCharacters = partyActors.length;
        const resolvedCount = characterStatuses.filter(c => c.source !== "pending").length;
        const trackFoodSetting = game.settings.get(MODULE_ID, "trackFood");
        const allRationsSubmitted = !trackFoodSetting
            || this._isTotM  // TotM: rations are collected in the dedicated Meal phase, not activity-phase station tabs
            || (this._activityMealRationsSubmitted?.size ?? 0) >= totalCharacters;
        const hasPendingTraining = (this._trainingStates?.size > 0)
            || [...(this._characterChoices?.entries() ?? [])].some(
                ([charId, actId]) => actId === "act_train" && !this._earlyResults?.has(charId)
            );
        const allResolved = resolvedCount === totalCharacters
            && !this._gmCopySpellProposal
            && allRationsSubmitted
            && !hasPendingTraining;
        const viewerHasSubmitted = !this._isGM && characterStatuses
            .filter(c => c.isOwner)
            .every(c => c.source !== "pending");
        const activityPhasePlayerOverview =
            this._phase === "activity"
                ? {
                      resolvedCount,
                      totalCharacters,
                      allResolved,
                      viewerHasSubmitted,
                      trackFood: !!trackFoodSetting,
                      simpleStations: isSimpleStationsMode(),
                      mealRationsSubmitted: this._activityMealRationsSubmitted?.size ?? 0,
                      activityProgressPercent:
                          totalCharacters > 0
                              ? Math.round((resolvedCount / totalCharacters) * 100)
                              : 0,
                      mealRationsProgressPercent:
                          totalCharacters > 0
                              ? Math.round(
                                    ((this._activityMealRationsSubmitted?.size ?? 0) / totalCharacters) * 100
                                )
                              : 0
                  }
                : null;

        // Build recovery summary for the resolution phase
        let recoverySummary = [];
        let activitySummary = [];
        let partyDiscoveries = [];
        if (this._phase === "resolve" && this._outcomes?.length) {
            const scopedOutcomes = this._isGM
                ? this._outcomes
                : this._outcomes.filter(o => this._myCharacterIds?.has(o.characterId));
            recoverySummary = scopedOutcomes.map(o => {
                const actor = game.actors?.get(o.characterId);
                let hpAtMax = false;
                let hdAtMax = false;
                if (actor) {
                    const hp = actor.system?.attributes?.hp;
                    if (hp) hpAtMax = (hp.value ?? 0) >= (hp.max ?? 1);
                    const classes = actor.items?.filter(i => i.type === "class") ?? [];
                    const totalHdSpent = classes.reduce((sum, cls) => {
                        return sum + (cls.system?.hd?.spent ?? cls.system?.hitDiceUsed ?? 0);
                    }, 0);
                    hdAtMax = totalHdSpent <= 0;
                }
                return {
                    name: o.characterName,
                    hp: o.recovery?.hpRestored ?? 0,
                    hd: o.recovery?.hdRestored ?? 0,
                    hpAtMax,
                    hdAtMax,
                    eventDamage: o.recovery?.eventDamage ?? 0,
                    exhaustionDelta: o.recovery?.exhaustionDelta ?? 0,
                    exhaustionDC: o.recovery?.exhaustionDC ?? 0,
                    exhaustionSaveResult: o.recovery?.exhaustionSaveResult ?? null,
                    gearBonuses: o.recovery?.gearBonuses ?? {},
                    gearDescriptors: o.recovery?.gearDescriptors ?? []
                };
            });
            // Extract activity outcomes for badges
            for (const o of scopedOutcomes) {
                for (const sub of (o.outcomes ?? [])) {
                    if (sub.source === "activity" && sub.activityId) {
                        const act = this._activityResolver?.activities?.get(sub.activityId);
                        activitySummary.push({
                            name: o.characterName,
                            activityName: act?.name ?? sub.activityId ?? "Activity",
                            result: sub.result ?? "success"
                        });
                    }
                }
            }
            // Group passes and failures rather than interlacing them in the chip row.
            const isFailureChip = (r) => r === "failure" || r === "failure_complication";
            activitySummary.sort((a, b) => Number(isFailureChip(a.result)) - Number(isFailureChip(b.result)));

            // Aggregate event item rewards into party discoveries (shown once, not per-character)
            const seenEvents = new Set();
            for (const o of this._outcomes ?? []) {
                for (const sub of (o.outcomes ?? [])) {
                    if (sub.source === "event" && sub.items?.length && !seenEvents.has(sub.eventId)) {
                        seenEvents.add(sub.eventId);
                        for (const item of sub.items) {
                            const grantKey = `${sub.eventId}:${item.itemRef ?? item.name}`;
                            const grantInfo = this._getDiscoveryGrant(grantKey);
                            partyDiscoveries.push({
                                eventName: sub.eventName ?? "Event",
                                itemRef: item.itemRef ?? item.name ?? "Unknown",
                                name: item.name ?? null,
                                quantity: item.quantity ?? 1,
                                grantKey,
                                granted: !!grantInfo,
                                grantedTo: grantInfo?.actorName ?? null,
                                grantedQty: grantInfo?.rolled ?? null,
                                grantedItemName: grantInfo?.itemName ?? null
                            });
                        }
                    }
                }
            }
        }

        // Player: filter outcomes to owned characters
        const personalOutcomes = this._isGM
            ? this._outcomes
            : (this._outcomes ?? []).filter(o => this._myCharacterIds?.has(o.characterId));

        // Grouped resolution cards: split each character's results into a Recovered
        // (positive) cluster and a Setbacks (negative) cluster so the report card no
        // longer interlaces pass/fail badges. Verdicts carry the activity/event name
        // so a "Failed" badge reads in context.
        const resolutionCards = this._phase === "resolve"
            ? this._buildResolutionCards(personalOutcomes ?? [])
            : [];

        let campScanData = null;
        let campMakeCampPlacementUnlocked = false;
        let campMakeCampStep = 1;
        let campFireEncounterHint = "";
        let campFirePickerLevels = [];
        let campFireGatePit = false;
        let campFireGateLevel = false;
        let campColdCampDecided = false;
        let campComfortIsHostile = false;
        let canContinueToCampLayout = false;
        const _needsFireData = this._phase === "camp"
            || (this._phase === "activity" && this._isTotM && this._totmFireTabVisible());
        if (_needsFireData) {
            const terrainTagCamp = this._selectedTerrain ?? this._engine?.terrainTag ?? "forest";
            const terrainCamp = TerrainRegistry.get(terrainTagCamp);
            const shelterSpellCamp = (this._engine?.activeShelters ?? []).find(s => s !== "tent" && s !== "none")
                ? SHELTER_SPELLS[(this._engine?.activeShelters ?? []).find(s => s !== "tent" && s !== "none")]?.label ?? null
                : null;
            const campfirePlacedGate = hasCampfirePlaced();
            // Gate: fire is lit, OR table decided cold camp (no fire)
            const fireCommitted = (this._fireLevel ?? "unlit") !== "unlit" || !!this._coldCampDecided;
            campColdCampDecided = !!this._coldCampDecided;
            const campGatesReady = campfirePlacedGate && fireCommitted;
            campMakeCampPlacementUnlocked = false;
            campMakeCampStep = 1;
            canContinueToCampLayout = false;
            campFireGatePit = campfirePlacedGate;
            campFireGateLevel = fireCommitted;
            // When fire hasn't been committed, preview defaults to "embers" (the
            // default highlighted tab), NOT "unlit" which applies a no-fire penalty.
            const effectiveScanLevel = (fireCommitted && (campfirePlacedGate || this._isTotM))
                ? (this._coldCampDecided ? "cold_camp" : (this._fireLevel ?? "unlit"))
                : (this._campFirePreviewLevel ?? (this._fireLevel !== "unlit" ? this._fireLevel : "embers"));
            const encMod = CampGearScanner.FIRE_ENCOUNTER_MOD_BY_LEVEL[effectiveScanLevel] ?? 0;
            // RestFlowEngine: effectiveDC = baseDC - campMods. Negative fireRollModifier
            // subtracts a negative, RAISING effectiveDC (harder to avoid encounters).
            // "Fire is a beacon"; see CampGearScanner.FIRE_ENCOUNTER_MOD_BY_LEVEL.
            if (effectiveScanLevel === "cold_camp") {
                campFireEncounterHint = "Cold camp: harder for enemies to spot (lower encounter chance).";
            } else if (effectiveScanLevel === "unlit") {
                campFireEncounterHint = "No fire is lit yet. The tier row shows what each level would do.";
            } else if (effectiveScanLevel === "embers") {
                campFireEncounterHint = "Embers: no change to encounter chance.";
            } else if (effectiveScanLevel === "campfire") {
                campFireEncounterHint = "Campfire: light makes the camp easier for enemies to spot.";
            } else if (effectiveScanLevel === "bonfire") {
                campFireEncounterHint = "Bonfire: visible from far off; enemies spot the camp easily.";
            } else {
                campFireEncounterHint = "";
            }
            const baseTerrainComfort = this._engine?.comfort
                ?? TerrainRegistry.getDefaults(terrainTagCamp).comfort
                ?? "rough";
            campScanData = CampGearScanner.scan(
                baseTerrainComfort,
                effectiveScanLevel,
                shelterSpellCamp,
                terrainCamp?.comfortReason ?? "",
                terrainCamp?.label ?? terrainTagCamp,
                encMod,
                !!this._engine?.safeRestSpot
            );
            const fs = campScanData.fireSelection ?? {};
            const cur = this._fireLevel ?? "unlit";
            const preview = this._campFirePreviewLevel ?? "embers";
            const coldSelected = !!this._coldCampDecided || (preview === "cold_camp");
            const hasTinder = campScanData?.canLightFire ?? false;
            const tierDisabledReason = (canPick, cost) => {
                if (canPick) return "";
                if (!hasTinder) return "Someone needs a tinderbox or flint and steel.";
                return `Need at least ${cost} firewood in the party.`;
            };
            campFirePickerLevels = [
                {
                    id: "embers",
                    label: "Embers",
                    costLabel: CampGearScanner.firewoodCostLabel("embers"),
                    disabled: !fs.canPickEmbers,
                    disabledReason: tierDisabledReason(fs.canPickEmbers, fs.costEmbers ?? 1),
                    selected: !coldSelected && (cur !== "unlit" ? cur === "embers" : preview === "embers")
                },
                {
                    id: "campfire",
                    label: "Campfire",
                    costLabel: CampGearScanner.firewoodCostLabel("campfire"),
                    disabled: !fs.canPickCampfire,
                    disabledReason: tierDisabledReason(fs.canPickCampfire, fs.costCampfire ?? 2),
                    selected: !coldSelected && (cur !== "unlit" ? cur === "campfire" : preview === "campfire")
                },
                {
                    id: "bonfire",
                    label: "Bonfire",
                    costLabel: CampGearScanner.firewoodCostLabel("bonfire"),
                    disabled: !fs.canPickBonfire,
                    disabledReason: tierDisabledReason(fs.canPickBonfire, fs.costBonfire ?? 3),
                    selected: !coldSelected && (cur !== "unlit" ? cur === "bonfire" : preview === "bonfire")
                }
            ];
        }

        // â”€â”€ Fire contribution UI context â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        let campFireIsLit = false;

        // ── Fire bill: itemized requirements for the selected/previewed tier ──
        const _fireBillLevel = (this._fireLevel ?? "unlit") !== "unlit"
            ? this._fireLevel
            : (this._campFirePreviewLevel ?? "embers");
        const _COST_MAP = CampGearScanner.FIREWOOD_COST_BY_LEVEL;
        const campSelectedFirewoodCost = _COST_MAP[_fireBillLevel] ?? 0;
        const campPartyFirewood = campScanData?.totalFirewood ?? 0;
        const campHasEnoughFirewood = campPartyFirewood >= campSelectedFirewoodCost;
        const campCanLight = campScanData?.canLightFire ?? false;
        let campFireLitBy = null;
        let campFireLighters = [];
        let campFirewoodPledgeList = [];
        let campMyPledge = null;
        let campCanAddFirewood = false;
        let campMyFirewoodActorId = null;
        let campFireTierCards = [];
        let campFireTotalPledged = 0;
        let campViewerCanLight = false;
        let campFireOtherLighterCount = 0;
        let campFireLighterNames = "";
        if (_needsFireData && campScanData) {
            campFireIsLit = (this._fireLevel ?? "unlit") !== "unlit";
            campFireLitBy = this._fireLitBy ?? null;
            campFireTotalPledged = Array.from(this._firewoodPledges.values()).reduce((s, p) => s + p.count, 0);

            // Enrich fireLighters with cantrip-capable actors (from adapter)
            const rawLighters = campScanData.fireLighters ?? [];
            const OWNER = CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
            const fireCantrips = game.ionrift?.respite?.adapter?.getFireCantrips?.() ?? [];
            const cantripLighters = [];
            for (const actor of getPartyActors()) {
                if (rawLighters.some(l => l.actorId === actor.id)) continue; // already in tinderbox list
                const cantrip = fireCantrips.length > 0
                    ? actor.items.find(i => i.type === "spell" && (i.system?.level === 0) && fireCantrips.includes(i.name))
                    : null;
                if (cantrip) cantripLighters.push({ actorId: actor.id, actorName: actor.name, method: cantrip.name });
            }
            const rawLightersTagged = rawLighters.map(l => ({ ...l, methodType: "item", methodIcon: "fas fa-box" }));
            const cantripLightersTagged = cantripLighters.map(l => ({ ...l, methodType: "spell", methodIcon: "fas fa-magic" }));
            const allLighters = [...rawLightersTagged, ...cantripLightersTagged];

            // Resolve which lighters the current user can act on (owns the actor)
            campFireLighters = allLighters.map(l => ({
                ...l,
                isViewerActor: (game.actors.get(l.actorId)?.ownership?.[game.user.id] ?? 0) >= OWNER
            }));
            campViewerCanLight = campFireLighters.some(l => l.isViewerActor);
            campFireLighterNames = campFireLighters.map(l => l.actorName).filter((v, i, a) => a.indexOf(v) === i).join(", ");
            campFireOtherLighterCount = campFireLighters.filter(l => !l.isViewerActor).length;

            // Firewood pledge list for summary display
            campFirewoodPledgeList = Array.from(this._firewoodPledges.values())
                .filter(p => p.count > 0)
                .map(p => ({ actorName: p.actorName, count: p.count }));

            // Current viewer's pledge
            campMyPledge = this._firewoodPledges.get(game.user.id) ?? null;

            // Can this user add firewood? Fire lit + under bonfire.
            // GM has infinite firewood; players need a party actor with enough wood.
            if (campFireIsLit && campFireTotalPledged < 2) {
                if (game.user.isGM) {
                    campCanAddFirewood = true;
                    campMyFirewoodActorId = "__gm__";
                } else {
                    const firewoodHolders = campScanData.firewoodHolders ?? [];
                    const myPledgeCount = campMyPledge?.count ?? 0;
                    const ownedWithWood = firewoodHolders.find(h => {
                        const a = game.actors.get(h.actorId);
                        return a && (a.ownership?.[game.user.id] ?? 0) >= OWNER && h.count > myPledgeCount;
                    });
                    if (ownedWithWood) {
                        campCanAddFirewood = true;
                        campMyFirewoodActorId = ownedWithWood.actorId;
                    }
                }
            }

            // Tier cards for map campfire dialog and camp context
            if (this._phase === "camp") {
                const TIER_BODIES = {
                    embers: "No cooking. No comfort change.",
                    campfire: "Cooking and warmth. Easier for enemies to spot.",
                    bonfire: "+1 camp comfort. Visible from far off."
                };
                const COMFORT_TIERS = ["hostile", "rough", "sheltered", "safe"];
                const TIER_LABELS = Object.fromEntries(
                    COMFORT_TIERS.map(k => [k, CampGearScanner.getRules(k).label])
                );
                const baseComfort = campScanData.campComfortPreFire ?? campScanData.campComfort ?? "rough";
                const baseIdx = COMFORT_TIERS.indexOf(baseComfort);
                // Bonfire shifts comfort +1 tier; embers/campfire leave it unchanged
                const COMFORT_DELTA = { embers: 0, campfire: 0, bonfire: 1 };
                // Before the fire is committed, the selected tier is the live preview so the
                // clicked card highlights; once lit, it tracks the committed level.
                const selectedTier = (this._fireLevel ?? "unlit") !== "unlit"
                    ? this._fireLevel
                    : (this._coldCampDecided ? null : this._campFirePreviewLevel);
                campFireTierCards = ["embers", "campfire", "bonfire"].map(id => {
                    const delta = COMFORT_DELTA[id] ?? 0;
                    const resultIdx = Math.min(baseIdx + delta, COMFORT_TIERS.length - 1);
                    const resultComfort = COMFORT_TIERS[resultIdx] ?? baseComfort;
                    const resultLabel = TIER_LABELS[resultComfort] ?? resultComfort;
                    const comfortHint = delta !== 0
                        ? `${TIER_LABELS[baseComfort] ?? baseComfort} to ${resultLabel}`
                        : resultLabel;
                    return {
                        id,
                        label: id.charAt(0).toUpperCase() + id.slice(1),
                        costLabel: CampGearScanner.firewoodCostLabel(id),
                        body: TIER_BODIES[id],
                        comfortHint,
                        comfortChanged: delta !== 0,
                        active: selectedTier === id
                    };
                });
            }
        }
        if (campScanData) {
            campComfortIsHostile = (campScanData.campComfort ?? "rough") === "hostile";
        }

        const campPersonalSelected = campScanData && this._selectedCharacterId
            ? (campScanData.personalCards.find(p => p.actorId === this._selectedCharacterId) ?? null)
            : null;
        const campGearForSelected = (() => {
            if (this._phase !== "camp" || !this._selectedCharacterId) return null;
            const a = game.actors.get(this._selectedCharacterId);
            if (!a) return null;
            const items = a.items?.map(i => i.name?.toLowerCase() ?? "") ?? [];
            const hasBedroll = items.some(n => n.includes("bedroll"));
            const hasTent = items.some(n => n.includes("tent"));
            const hasMessKit = items.some(n =>
                n.includes("mess kit") || (n.includes("cook") && n.includes("utensil"))
            );
            const canDrag = this._isGM || !!a.isOwner;
            const isOwner = !!a.isOwner;
            const personalCamp = campScanData?.personalCards?.find(p => p.actorId === this._selectedCharacterId);
            const exhaustionRisk = !!personalCamp?.recovery?.exhaustionDC;
            const fireIsLit = (this._fireLevel ?? "unlit") !== "unlit";
            const tentDeployed = isGearDeployed(a.id, "tent");
            const bedrollDeployed = isGearDeployed(a.id, "bedroll");
            const messKitDeployed = isGearDeployed(a.id, "messkit");
            const hasDeployedCampGear = tentDeployed || bedrollDeployed || messKitDeployed;
            const placementUnlocked = (this._phase === "activity");
            const canDragGear = canDrag && (hasDeployedCampGear || placementUnlocked);
            return {
                actorId: a.id,
                actorName: a.name,
                actorImg: a.img || "icons/svg/mystery-man.svg",
                hasBedroll,
                hasTent,
                hasMessKit,
                bedrollDeployed,
                tentDeployed,
                messKitDeployed,
                canDrag: canDragGear,
                isOwner,
                showClearOwnGear: !this._isGM && isOwner && hasDeployedCampGear,
                fireIsLit,
                exhaustionRisk,
                sceneHasDroppables: hasTent || hasBedroll || hasMessKit,
                /** Mess kit: advantage is inactive when a save is relevant and fire is out. */
                messAdvantageOff: hasMessKit && !fireIsLit && exhaustionRisk
            };
        })();

        const campPlacementRuleHint = this._phase === "camp"
            ? "Place within 3 squares of the campfire. Tokens cannot overlap."
            : "";

        const campfirePlaced = this._phase === "camp" && hasCampfirePlaced();

        const campStationCards = (() => {
            if (this._phase !== "camp") return [];
            const actor = this._selectedCharacterId ? game.actors.get(this._selectedCharacterId) : null;
            const rosterSelected = !!actor;
            const placementKeys = getCampStationPlacementKeys(!!this._engine?.safeRestSpot, {
                simpleStations: isSimpleStationsMode()
            });
            return placementKeys.map(key => {
                const st = CAMP_STATIONS.find(s => s.furnitureKey === key);
                const deployed = isStationDeployed(key);
                const meetsRequirement = actor ? canPlaceStation(actor, key) : false;
                const isOwner = !!actor?.isOwner;
                let canDrag = false;
                if (campMakeCampPlacementUnlocked && campfirePlaced && !deployed) {
                    if (this._isGM) canDrag = true;
                    else if (rosterSelected && isOwner && meetsRequirement) canDrag = true;
                }
                const canRecallStation = deployed && (
                    this._isGM || (rosterSelected && isOwner && meetsRequirement)
                );
                return {
                    furnitureKey: key,
                    label: st?.label ?? key,
                    icon: st?.icon ?? "fas fa-cube",
                    deployed,
                    canDrag,
                    canRecallStation,
                    requirementHint: stationPlacementRequirementHint(key),
                    rosterSelected,
                    meetsRequirement,
                    isOwner,
                    actorId: actor?.id ?? ""
                };
            });
        })();

        // Whether the Meal phase runs as a distinct step this rest (drives the stepper).
        // Matches the gate in #beginEvents: tracked food, Theater of the Mind, a long
        // rest, not a safe spot, and a terrain that actually imposes meal rules.
        const _mealStepTerrain = this._engine?.terrainTag ?? this._selectedTerrain ?? "forest";
        const _mealStepRules = TerrainRegistry.getDefaults(_mealStepTerrain)?.mealRules ?? {};
        const showMealStep = !!trackFoodSetting
            && this._isTotM
            && !safeRestSpot
            && (this._selectedRestType ?? "long") !== "short"
            && ((_mealStepRules.waterPerDay > 0) || (_mealStepRules.foodPerDay > 0));

        // Stepper pips: only show phases that actually run this rest, so the dot
        // count and labels match the real flow. Travel is long-rest + professions
        // only (mirrors the skip in #beginRest). Events are skipped on short rests
        // and safe rest spots (mirrors _advanceToEvents).
        const _stepRestType = this._selectedRestType ?? "long";
        let _enableProfessions = false;
        try { _enableProfessions = !!game.settings.get(MODULE_ID, "enableProfessions"); } catch (e) { /* */ }
        const _includeTravelStep = _stepRestType === "long" && _enableProfessions;
        const _includeEventsStep = _stepRestType !== "short" && !safeRestSpot;
        const _phaseStepDefs = [
            { key: "setup", label: "Setup", include: true },
            { key: "travel", label: "Travel", include: _includeTravelStep },
            { key: "camp", label: "Make Camp", include: true },
            { key: "activity", label: "Activities", include: true },
            { key: "meal", label: "Meal", include: showMealStep },
            { key: "events", label: "Events", include: _includeEventsStep },
            { key: "resolve", label: "Resolution", include: true }
        ].filter(s => s.include);
        const _currentStepIndex = _phaseStepDefs.findIndex(s => s.key === this._phase);
        const phaseSteps = _phaseStepDefs.map((s, i) => ({
            key: s.key,
            label: s.label,
            active: i === _currentStepIndex,
            complete: _currentStepIndex >= 0 && i < _currentStepIndex
        }));
        const phaseLabel = _currentStepIndex >= 0 ? _phaseStepDefs[_currentStepIndex].label : "";

        // Activity-phase "proceed" button label tracks the actual next step, so it
        // never promises a Rations stage that this configuration skips.
        const _activityNextStep = showMealStep ? "meal" : (_includeEventsStep ? "events" : "resolve");
        const activityProceed = ({
            meal:    { label: "Proceed to Rations", icon: "fas fa-arrow-right" },
            events:  { label: "Proceed to Events", icon: "fas fa-moon" },
            resolve: { label: "Proceed to Resolution", icon: "fas fa-arrow-right" }
        })[_activityNextStep];

        // Setup-screen summary of the settings that reshape this rest, so global
        // toggles read as local context instead of silently changing the flow.
        const restConfigBadges = (this._isGM && this._phase === "setup"
            && (this._selectedRestType ?? "long") !== "short")
            ? (() => {
                const g = (k) => { try { return !!game.settings.get(MODULE_ID, k); } catch (e) { return false; } };
                const comfort = g("enableComfort");
                const professions = g("enableProfessions");
                const meals = g("trackFood");
                const comfortActive = comfort && !safeRestSpot;
                return [
                    { on: comfortActive, icon: "fas fa-temperature-half", label: "Comfort", tooltip: safeRestSpot ? "Comfort bypassed: safe rest spot negates comfort penalties, fire, and exhaustion saves." : comfort ? "Comfort tiers, fire, and exhaustion saves are on. Change under Recovery Rules." : "Comfort off: no fire phase and no terrain exhaustion saves. Change under Recovery Rules." },
                    { on: professions, icon: "fas fa-hammer", label: "Professions", tooltip: professions ? "Crafting professions and the travel phase are on. Change under Rest Activities." : "Professions off: the travel phase is skipped. Change under Rest Activities." },
                    { on: meals, icon: "fas fa-drumstick-bite", label: "Meals", tooltip: meals ? "Food and water tracking is on; the Meal phase runs." : "Meal tracking off: no rations or dehydration saves. Change in module settings." }
                ];
            })()
            : [];

        return {
            isGM: this._isGM,
            isTheaterMode: this._isTotM,
            simpleStationsMode: isSimpleStationsMode(),
            workbenchIdentifyUiEnabled: isWorkbenchIdentifyUiEnabled(),
            encountersEnabled,
            showMealStep,
            phaseSteps,
            phaseLabel,
            activityProceed,
            restConfigBadges,
            totmActiveTab: this._totmActiveTab,
            showTotmCampfirePanel: this._totmCampfireMinigamePanelEnabled(),
            totmFireTabVisible: this._totmFireTabVisible(),
            totmStationCards,
            totmDetailPanel,
            totmCharacterLocked: (() => {
                const cid = this._selectedCharacterId;
                if (!cid) return null;
                const isLocked = this._lockedCharacters?.has(cid)
                    || (this._isGM && this._gmOverrides?.has(cid));
                if (!isLocked) return null;
                const actId = this._characterChoices?.get(cid);
                const act = actId ? this._activityResolver?.activities?.get(actId) : null;
                return act?.name ?? actId ?? "an activity";
            })(),
            ...(this._isTotM && this._phase === "activity" && this._totmActiveTab === "identify" && isWorkbenchIdentifyUiEnabled() ? (() => {
                const rosterSelected = this._selectedCharacterId || getPartyActors()[0]?.id || null;
                return this._workbench.buildEmbedContext(rosterSelected, getPartyActors);
            })() : {}),
            emptyParty,
            rosterInfo: (() => {
                const roster = getPartyActors();
                return {
                    count: roster.length,
                    names: roster.map(a => a.name),
                    portraits: roster.slice(0, 6).map(a => ({
                        img: a.img ?? "icons/svg/mystery-man.svg",
                        name: a.name
                    })),
                    overflow: Math.max(0, roster.length - 6)
                };
            })(),
            trackFood: trackFoodSetting,
            gmCopySpellProposal: this._gmCopySpellProposal ?? null,
            copySpellRollPrompt: this._copySpellRollPrompt ?? null,
            copySpellRollRequest: buildCopySpellRollContext(this._copySpellRollPrompt),
            phase: this._phase,
            postStationChoiceReview: !this._isGM && this._phase === "activity" && !!this._postStationChoiceReview,
            activitySubTab: null,
            travelContext: (() => {
                if (this._phase !== "travel") return null;
                const terrainTag = this._selectedTerrain ?? this._engine?.terrainTag ?? "forest";
                if (this._isGM) {
                    return this._travel.buildContext(partyActors, terrainTag);
                }
                // Player-side context: multi-day aware
                const terrain = TerrainRegistry.get(terrainTag);
                const allowed = terrain?.travelActivities ?? ["forage", "hunt", "scout"];
                const canForage = allowed.includes("forage");
                const canHunt = allowed.includes("hunt");
                const scoutAllowed = isScoutingEnabled() && (this._travelScoutingAllowed ?? true);
                const canScout = !safeRestSpot && allowed.includes("scout") && scoutAllowed;
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
                const totalDays = this._travelTotalDays ?? 1;
                const activeDay = this._travelActiveDay ?? 1;
                const localDecl = this._playerTravelDeclarations ?? {};
                const syncedDecl = this._syncedTravelDeclarations ?? {};

                const buildChars = (day) => {
                    const dayLocal = localDecl[day] ?? {};
                    const daySynced = syncedDecl[day] ?? syncedDecl; // fallback flat for compat
                    const chars = partyActors.map(a => {
                        const decl = a.isOwner
                            ? (dayLocal[a.id] ?? daySynced[a.id] ?? "nothing")
                            : (daySynced[a.id] ?? "nothing");
                        const lastAct = a.getFlag?.("ionrift-respite", "lastTravelActivity") ?? null;
                        const lastLabel = lastAct === "forage" ? "Forage"
                            : lastAct === "hunt" ? "Hunt"
                            : lastAct === "scout" ? "Scout" : null;
                        const confirmed = a.isOwner
                            ? !!(this._playerTravelConfirmed?.[day]?.[a.id]
                                || daySynced._confirmed?.[a.id])
                            : !!(syncedDecl[day]?._confirmed?.[a.id] ?? daySynced._confirmed?.[a.id]);
                        const rolled = !!(this._playerTravelRolled?.[day]?.[a.id]
                            || this._syncedTravelRolled?.[day]?.[a.id]
                            || this._syncedTravelResolved?.[day]?.[a.id]);
                        const forageDC = this._travelForageDC ?? 12;
                        const huntDC = this._travelHuntDC ?? 14;
                        return {
                            id: a.id,
                            name: a.name,
                            img: a.img ?? "icons/svg/mystery-man.svg",
                            isOwner: a.isOwner,
                            confirmed,
                            rolled,
                            lastActivity: lastLabel,
                            showLastHint: !!(lastLabel && lastAct !== decl),
                            survivalMod: (() => {
                                const _adapter = game.ionrift?.respite?.adapter;
                                const sur = _adapter ? _adapter.getSkillTotal(a, "sur") : (a.system?.skills?.sur?.total ?? 0);
                                const nat = _adapter ? _adapter.getSkillTotal(a, "nat") : (a.system?.skills?.nat?.total ?? 0);
                                const best = Math.max(sur, nat);
                                return (best >= 0 ? "+" : "") + best;
                            })(),
                            declaration: decl,
                            declarationIcon: decl === "forage" ? "fa-seedling"
                                : decl === "hunt" ? "fa-crosshairs"
                                : decl === "scout" ? "fa-binoculars" : null,
                            declarationLabel: decl === "forage" ? "Forage"
                                : decl === "hunt" ? "Hunt"
                                : decl === "scout" ? "Scout" : null,
                            activityFlavor: decl === "forage"
                                ? `Search for edible plants and fungi along the route. A strong roll yields exceptional finds. Survival, DC ${forageDC}.`
                                : decl === "hunt"
                                ? `Track and bring down game while travelling. Harder than foraging, but a good result means more food for the party. Survival, DC ${huntDC}.`
                                : decl === "scout"
                                ? `Survey the terrain on arrival to find a good campsite. Better scouting improves camp comfort and reduces the chance of a night encounter.`
                                : `Travel without a specific task. Tend wounds, keep watch, or handle personal business. Let the GM know what you're up to.`
                        };
                    });
                    chars.sort((a, b) => (b.isOwner ? 1 : 0) - (a.isOwner ? 1 : 0));
                    return chars;
                };

                const days = [];
                for (let d = 1; d <= totalDays; d++) {
                    const isFinalDay = d === totalDays;
                    const chars = buildChars(d);
                    const owned = chars.filter(c => c.isOwner);
                    days.push({
                        day: d,
                        label: totalDays === 1 ? null : `Day ${d}`,
                        isFinalDay,
                        canScout: isFinalDay && canScout,
                        isActive: d === activeDay,
                        characters: chars,
                        playerDone: owned.length > 0 && owned.every(c => c.confirmed || c.rolled)
                    });
                }

                const forageGate = this._travel?.getForageGate?.(terrainTag)
                    ?? { disabled: true, disabledReasonKey: "ionrift-respite.travel.forage.requires_pack" };
                const forageDisabled = canForage && forageGate.disabled;
                const forageDisabledReasonKey = forageDisabled ? forageGate.disabledReasonKey : null;

                // Build peer roster (non-owned characters) in roster-strip chip shape
                // so the travel phase can use {{> rosterStrip}} like every other phase.
                const activeChars = (days.find(d => d.isActive)?.characters ?? []);
                const travelPeerRoster = activeChars
                    .filter(c => !c.isOwner)
                    .map(c => ({
                        id: c.id,
                        name: c.name.split(" ")[0],
                        fullName: c.name,
                        img: c.img ?? "icons/svg/mystery-man.svg",
                        source: c.confirmed ? "player" : "pending",
                        isOwner: false,
                        isSelected: false,
                        isAfk: false,
                        isBeddedDown: false,
                        exhaustion: null,
                        pendingRoll: false,
                        rolledResult: c.rolled ? "done" : null,
                        // Show declaration as the activity label (Forage, Hunt, Scout, or null for Other)
                        activityLabel: c.declarationLabel ?? null,
                        mealStatus: null
                    }));

                return {
                    days,
                    totalDays,
                    isMultiDay: totalDays > 1,
                    activeDay,
                    canForage, canHunt, canScout, hasTravelOptions,
                    travelSkipRecommended: !canForage && !canHunt,
                    disabledReason,
                    terrainTag,
                    terrainLabel: terrain?.label ?? terrainTag,
                    hasOwnedCharacters: partyActors.some(a => a.isOwner),
                    forageDC: this._travelForageDC ?? 12,
                    huntDC: this._travelHuntDC ?? 14,
                    forageDisabled,
                    forageDisabledReasonKey,
                    forageDisabledTooltip: forageDisabledReasonKey
                        ? game.i18n.localize(forageDisabledReasonKey)
                        : null,
                    travelPeerRoster
                };
            })(),
            pendingTravelRoll: this._pendingTravelRoll ? (() => {
                const activities = (this._pendingTravelRoll.activities ?? []).map(a => {
                    const actor = game.actors.get(a.actorId);
                    const isOwner = actor?.isOwner ?? false;
                    const rolled = this._pendingTravelRoll.rolledCharacters?.has(a.actorId) ?? false;
                    const enriched = { ...a, isOwner, rolled, actorName: actor?.name ?? a.actorId, activityLabel: a.activityLabel ?? a.activity };
                    return {
                        ...enriched,
                        rollRequest: buildTravelActivityRollContext(enriched, this._pendingTravelRoll.rolledCharacters)
                    };
                });
                return { activities };
            })() : null,
            travelDebrief: this._travelDebrief?.length ? this._travelDebrief : null,
            travelFullyResolved: this._travelFullyResolved ?? false,
            travelScoutingDone: this._travelScoutingDone ?? false,
            scoutingDebrief: this._isGM ? (() => {
                if (this._travel?.isEffectiveSafeRestSpot?.()) return null;
                if (this._travel?.scoutingResult) {
                    const terrainTag = this._selectedTerrain ?? this._engine?.terrainTag ?? "forest";
                    this._scoutingDebrief ??= this._travel.getScoutingDebrief(terrainTag);
                    return this._scoutingDebrief;
                }
                return null;
            })() : null,
            terrainOptionGroups: (() => {
                const lastTerrain = game.settings.get(MODULE_ID, "lastTerrain");
                return TerrainRegistry.getOptionGroups({ lastTerrain });
            })(),
            terrainPreview: (() => {
                const t = this._selectedTerrain ?? "forest";
                const d = TerrainRegistry.getDefaults(t);
                const comfort = (d.comfort ?? "sheltered").charAt(0).toUpperCase() + (d.comfort ?? "sheltered").slice(1);
                const travel = safeRestSpot
                    ? "Travel activities are skipped for a safe rest spot."
                    : (d.travelAvailable ? "Travel available (forage, hunt, scout)." : "No travel activities.");
                return `Implied comfort: ${comfort}. ${travel}`;
            })(),
            setupStatusLine: (() => {
                const t = this._selectedTerrain ?? "forest";
                const d = TerrainRegistry.getDefaults(t);
                const comfort = (d.comfort ?? "sheltered").charAt(0).toUpperCase() + (d.comfort ?? "sheltered").slice(1);
                const parts = [`${comfort} camp`];
                const w = this._resolveSetupWeather(t);
                const wData = WEATHER_TABLE[w];
                if (wData && (wData.comfortPenalty > 0 || wData.encounterDC !== 0)) {
                    const fx = [];
                    if (wData.comfortPenalty > 0) fx.push(`comfort −${wData.comfortPenalty}`);
                    if (wData.encounterDC > 0) fx.push(`encounter DC +${wData.encounterDC}`);
                    if (wData.encounterDC < 0) fx.push(`encounter DC ${wData.encounterDC}`);
                    parts.push(fx.join(", "));
                }
                if (!safeRestSpot && d.travelAvailable) parts.push("travel available");
                return parts.join(" · ");
            })(),
            weatherOptions: (() => {
                const defaultKey = TerrainRegistry.getWeather(this._selectedTerrain ?? "forest")[0] ?? "clear";
                return TerrainRegistry.getWeather(this._selectedTerrain ?? "forest")
                    .map(key => ({ value: key, ...WEATHER_TABLE[key] }))
                    .filter(w => w.label)
                    .map(w => w.value === defaultKey ? { ...w, label: `${w.label} (Default)` } : w);
            })(),
            defaultWeather: TerrainRegistry.getWeather(this._selectedTerrain ?? "forest")[0] ?? "clear",
            selectedWeather: this._selectedWeather ?? this._resolveSetupWeather(this._selectedTerrain ?? "forest"),
            comfortOptions: (() => {
                const opts = [
                    { value: "safe", label: "Safe", hint: "Full HP. HD: half level recovered. No exhaustion risk. Taverns, strongholds, warded sanctuaries." },
                    { value: "sheltered", label: "Sheltered", hint: "Full HP. HD: half level recovered. No exhaustion risk. Caves, solid ruins, decent cover." },
                    { value: "rough", label: "Rough", hint: "Full HP. HD: half level minus 1 recovered. CON DC 10 or +1 exhaustion. Open wilderness, exposed camps." },
                    { value: "hostile", label: "Hostile", hint: "3/4 HP. HD: half level minus 2 recovered. CON DC 15 or +1 exhaustion. Enemy territory, cursed ground." }
                ];
                const match = opts.find(o => o.value === defaultComfort);
                if (match) match.label += " (terrain default)";
                return opts;
            })(),
            comfortReason: TerrainRegistry.get(this._selectedTerrain ?? "forest")?.comfortReason ?? "",
            restModeOptions: (() => {
                const current = this._isTotM ? "theater" : "stations";
                return [
                    { value: "theater", label: "One window", selected: current === "theater" },
                    { value: "stations", label: "Camp stations (place on scene)", selected: current === "stations" }
                ];
            })(),
            setupStep: this._setupStep ?? 1,
            selectedTerrain: this._selectedTerrain ?? "forest",
            terrainBanner: (() => {
                const t = this._selectedTerrain ?? this._engine?.terrainTag ?? "forest";
                const p = this._phase ?? "setup";
                
                // All terrains look in their specific folder.
                const filename = (p === "activity" || p === "meal" || p === "travel" || p === "camp") ? "banner.png" : `${p}.png`;
                return ImageResolver.terrainBanner(t, filename);
            })(),
            terrainBannerFallback: ImageResolver.fallbackBanner,
            terrainBannerPos: "center", // banners are pre-cropped 640x120 strips
            selectedTerrainLabel: this._terrainLabel ?? "Forest",
            selectedRestType: this._selectedRestType ?? "long",
            selectedRestTypeLabel: this._selectedRestType === "short" ? "Short Rest" : "Long Rest",
            isShortRest: (this._selectedRestType ?? "long") === "short",
            safeRestSpot,
            selectedWeatherLabel: WEATHER_TABLE[this._resolveSetupWeather(this._selectedTerrain ?? "forest")]?.label ?? "Clear",
            shelterNeeded: (this._selectedTerrain ?? "forest") !== "tavern",
            defaultComfort,
            shelterOptions,
            shelterEffect,
            shelterChosen,
            heroCharacters,
            roster,
            canvasFocusedStationId: this._canvasFocusedStationId ?? null,
            selectedCharacter,
            partyCharacters,
            totalCharacters,
            resolvedCount,
            allResolved,
            activityPhasePlayerOverview,
            outcomes: personalOutcomes ?? [],
            resolutionCards,
            triggeredEvents: (this._triggeredEvents ?? []).map((e, eventIndex) => {
                // Resolve target IDs to actor names for the template
                const eventRollModes = e.rollModes ?? {};
                const targetActors = (e.targets ?? [])
                    .map(id => game.actors.get(id))
                    .filter(Boolean)
                    .map(a => {
                        const rollMode = eventRollModes[a.id] ?? "normal";
                        return {
                            id: a.id,
                            name: a.name,
                            img: a.img || "icons/svg/mystery-man.svg",
                            rollMode,
                            rollModeAdvantage: rollMode === "advantage",
                            rollModeDisadvantage: rollMode === "disadvantage"
                        };
                    });
                const targetNames = targetActors.map(a => a.name);
                const skillName = e.mechanical?.skill
                    ? (SKILL_NAMES[e.mechanical.skill] ?? e.mechanical.skill)
                    : null;
                // Backfill GM narration from the live catalog by id. Events persisted
                // before these fields existed (or built by inline paths) carry only an
                // id, so rehydrate the authored copy. GM-only: players get a stripped
                // copy and must not regain this content via the catalog.
                const catalog = this._isGM ? this._eventResolver?.events?.get(e.id) : null;
                const gmPrompt = e.gmPrompt ?? catalog?.gmPrompt ?? null;
                const gmGuidance = e.gmGuidance ?? catalog?.gmGuidance ?? null;
                const description = e.description ?? catalog?.description ?? null;
                const targetScope = e.mechanical?.targets === "all" ? "the whole party" : "the watch";
                const checkContext = e.checkContext ?? catalog?.checkContext
                    ?? (skillName ? `${skillName} check for ${targetScope}.` : null);
                const readAloud = gmPrompt || description || e.narrative || null;
                // Enrich resolved rolls with ownership for player-side filtering
                const resolvedRolls = (e.resolvedRolls ?? []).map(r => ({
                    ...r,
                    isOwner: game.actors.get(r.characterId)?.isOwner ?? false
                }));
                // Player-facing forewarning of locked consequences. Once the GM
                // locks a hit or a loss, each affected player sees what is coming
                // on the far side of the rest, phrased without GM mechanics.
                const playerConsequences = [];
                if (e.resolvedOutcome && !["success", "triumph"].includes(e.resolvedOutcome)) {
                    const consTierKey = { mixed: "onMixed", failure: "onFailure" }[e.resolvedOutcome] ?? "onFailure";
                    const consEffects = e.mechanical?.[consTierKey]?.effects ?? e.mechanical?.onFailure?.effects ?? [];
                    for (const eff of consEffects) {
                        if (!eff._locked) continue;
                        if (eff.type === "damage" && Array.isArray(eff._lockedTargets)) {
                            for (const t of eff._lockedTargets) {
                                if (!(this._isGM || this._myCharacterIds?.has(t.id))) continue;
                                if (!(t.amount > 0)) continue;
                                playerConsequences.push({ icon: "fa-heart-broken", text: `${t.name} takes ${t.amount} damage after the rest.` });
                            }
                        } else if (eff.type === "consume_resource" && eff._lockedLoss) {
                            const loss = eff._lockedLoss;
                            for (const grp of (loss.provisionGroups ?? [])) {
                                playerConsequences.push({ icon: "fa-box-open", text: `The party loses ${grp.total} ${grp.kind} after the rest.` });
                            }
                            for (const g of (loss.gear ?? [])) {
                                if (!(this._isGM || this._myCharacterIds?.has(g.actorId))) continue;
                                const label = g.lossQty > 1 ? `${g.itemName} x${g.lossQty}` : g.itemName;
                                playerConsequences.push({ icon: "fa-times-circle", text: `${g.actorName} loses ${label} after the rest.` });
                            }
                        } else if (eff.type === "item_at_risk" && Array.isArray(eff._lockedItems)) {
                            // The specific haul stays hidden until it is committed at
                            // resolution. Players only learn that gear will go missing,
                            // so the GM can re-roll the selection without spoiling it.
                            const affectsMe = eff._lockedItems.some(li => this._isGM || this._myCharacterIds?.has(li.actorId));
                            if (affectsMe && eff._lockedItems.length) {
                                playerConsequences.push({ icon: "fa-mask", text: `A thief is going through the packs. Some gear will be missing after the rest.` });
                            }
                        } else if (eff.type === "consume_gold" && eff._lockedGold) {
                            const affectsMe = (eff._lockedGold.breakdown ?? []).some(b => (this._isGM || this._myCharacterIds?.has(b.actorId)) && b.lossGp > 0);
                            if (affectsMe && eff._lockedGold.totalLoss > 0) {
                                playerConsequences.push({ icon: "fa-coins", text: `Coin will be lighter after the rest.` });
                            }
                        }
                    }
                }
                return { ...e, targetNames, targetActors, skillName, gmPrompt, gmGuidance, description, checkContext, readAloud, resolvedRolls, playerConsequences,
                    gmRollRequest: e.awaitingRolls && this._isGM ? buildEventGmRollContext({ ...e, skillName, checkContext }, eventIndex) : null
                };
            }),
            // A skill-check event blocks resolution only until it has an outcome.
            // Once resolvedOutcome is set the check is done; a lingering
            // awaitingRolls flag (e.g. from a force-resolve on stale state) must
            // not re-lock Proceed.
            allEventChecksResolved: !(this._triggeredEvents ?? []).some(
                e => e.mechanical?.type === "skill_check" && !e.resolvedOutcome
            ),
            // Every failed-event damage/loss consequence must be GM-locked before
            // the rest can proceed, so each lands deliberately on the far side.
            allConsequencesResolved: !(this._triggeredEvents ?? []).some(e => {
                // Resolved disaster trees carry no resolvedOutcome but still gate
                // on their committed losses (read from the synthetic onFailure tier).
                const isTree = e.treeOutcome === true;
                if (!isTree && (!e.resolvedOutcome || ["success", "triumph"].includes(e.resolvedOutcome))) return false;
                const tierKey = { mixed: "onMixed", failure: "onFailure" }[e.resolvedOutcome] ?? "onFailure";
                const effects = e.mechanical?.[tierKey]?.effects ?? e.mechanical?.onFailure?.effects ?? [];
                return effects.some(eff => (eff.type === "damage" || eff.type === "consume_resource" || eff.type === "item_at_risk" || eff.type === "consume_gold" || eff.type === "supply_loss") && !eff._locked);
            }),
            anyEventAwaitingRolls: (this._triggeredEvents ?? []).some(e => e.awaitingRolls),
            pendingEventRoll: this._pendingEventRoll ? (() => {
                const ownedTargets = (this._pendingEventRoll.targets ?? [])
                    .map(id => game.actors.get(id))
                    .filter(a => a?.isOwner)
                    .map(a => ({
                        id: a.id,
                        name: a.name,
                        rolled: this._pendingEventRoll.rolledCharacters?.has(a.id) ?? false
                    }));
                const merged = { ...this._pendingEventRoll, ownedTargets };
                const triggeredEvent = this._triggeredEvents?.[this._pendingEventRoll.eventIndex] ?? null;
                return {
                    ...merged,
                    rollRequest: buildEventPlayerRollContext(merged, triggeredEvent)
                };
            })() : null,
            pendingTreeRoll: this._pendingTreeRoll ? {
                ...this._pendingTreeRoll,
                rollRequest: buildTreePlayerRollContext(this._pendingTreeRoll)
            } : null,
            actorLookup: (() => {
                const lookup = {};
                for (const a of getPartyActors()) {
                    lookup[a.id] = { name: a.name, img: a.img };
                }
                return lookup;
            })(),
            eventsRolled: this._eventsRolled ?? false,
            eventsCommitPending: this._eventsCommitPending ?? false,
            pendingCampRolls: this._pendingCampRolls ?? [],
            campPrepsResolved: !this._pendingCampRolls?.length || this._pendingCampRolls.every(p => p.status !== "pending"),
            pendingCampRoll: this._pendingCampRoll ? {
                activities: (this._pendingCampRoll.activities ?? []).filter(a => {
                    const actor = game.actors.get(a.characterId);
                    return actor?.isOwner;
                }).map(a => ({
                    ...a,
                    rolled: this._pendingCampRoll.rolledCharacters?.has(a.characterId) ?? false,
                    status: a.status ?? "pending",
                    total: a.total ?? null,
                    rollRequest: (a.status === "pass" || a.status === "fail")
                        ? null
                        : buildCampActivityRollContext(a, this._pendingCampRoll.rolledCharacters)
                }))
            } : null,
            disasterChoice: this._disasterChoice ? (() => {
                const dc = this._disasterChoice;
                const normalsLabel = (dc.normals?.length ?? 0) > 1
                    ? "Two Complications" : "One Complication";
                let n = 1;
                const treeNum = dc.tree ? n++ : 0;
                const encounterNum = dc.encounter ? n++ : 0;
                const normalsNum = dc.normals?.length ? n++ : 0;
                return {
                    ...dc,
                    normalsLabel,
                    treeNum, encounterNum, normalsNum,
                    optionCount: n - 1
                };
            })() : null,
            hasEncounterEvent: (this._triggeredEvents ?? []).some(e => e.category === "encounter" && !["success", "triumph"].includes(e.resolvedOutcome)) && !this._awaitingCombat && !this._combatAcknowledged,
            combatBuffs: this._combatBuffs ?? null,
            awaitingCombat: this._awaitingCombat ?? false,
            encounterAwareness: (() => {
                const enc = (this._triggeredEvents ?? []).find(e => e.category === "encounter" && !["success", "triumph"].includes(e.resolvedOutcome));
                if (!enc) return null;
                const hints = enc.mechanical?.onFailure?.effects?.find(ef => ef.type === "encounter")?.encounterHints;
                return hints?.awareness ?? null;
            })(),
            fireLevel: this._fireLevel ?? "unlit",
            campfireTokenDetected: CampfireTokenLinker.hasCampfireToken(),
            campfireTokenSettingName: CampfireTokenLinker.getTokenName(),
            activeTreeState: (() => {
                const ts = this._activeTreeState;
                if (!ts) return null;
                // Enrich pending rolls with actor name and rollMode for clean template iteration
                const rollModes = ts.pendingRollModes ?? {};
                const pendingRollsEnriched = (ts.pendingRolls ?? []).map(id => {
                    const actor = game.actors.get(id);
                    const rollMode = rollModes[id] ?? "normal";
                    return {
                        id,
                        name: actor?.name ?? id,
                        img: actor?.img || "icons/svg/mystery-man.svg",
                        rollMode,
                        rollModeAdvantage: rollMode === "advantage",
                        rollModeDisadvantage: rollMode === "disadvantage",
                        rollModeForcePass: rollMode === "force-pass",
                        rollModeForceFail: rollMode === "force-fail"
                    };
                });
                // Once resolved, bind the consequence list to the canonical copy on
                // the triggered event so Roll & lock state stays live, and expose
                // the event index the lock buttons need.
                let finalEffects = ts.finalEffects;
                let eventIndex = -1;
                if (ts.resolved) {
                    eventIndex = (this._triggeredEvents ?? []).findIndex(e => e.id === ts.eventId);
                    const te = this._triggeredEvents?.[eventIndex];
                    if (te?.mechanical?.onFailure?.effects) finalEffects = te.mechanical.onFailure.effects;
                }
                // Number the options for the choice cards (Option 1, Option 2, ...).
                const options = (ts.options ?? []).map((o, i) => ({ ...o, optionNum: i + 1 }));
                const treeEvent = (this._triggeredEvents ?? []).find(e => e.id === ts.eventId);
                const gmPrompt = ts.gmPrompt ?? treeEvent?.gmPrompt ?? "";
                const checkContext = ts.checkContext ?? treeEvent?.checkContext ?? null;
                let readAloud = ts.readAloud;
                let showDecisionPrompt = ts.showDecisionPrompt;
                if (!readAloud) {
                    const narration = DecisionTreeResolver.computeNarrationFields(
                        { gmPrompt, description: ts.description },
                        { prompt: ts.prompt },
                        ts.depth ?? 0
                    );
                    readAloud = narration.readAloud;
                    showDecisionPrompt = narration.showDecisionPrompt;
                }
                let treeDcAdjNote = null;
                const treeDcAdj = ts.treeDcAdj ?? 0;
                if (treeDcAdj !== 0) {
                    const mag = Math.abs(treeDcAdj);
                    const tier = treeDcAdj > 0 ? "higher" : "lower";
                    const who = (ts.options?.length === 2) ? "Both choices" : "Every choice";
                    treeDcAdjNote = `${who} are ${mag} DC ${tier}`;
                }
                return {
                    ...ts,
                    gmPrompt,
                    checkContext,
                    readAloud,
                    showDecisionPrompt: !!showDecisionPrompt,
                    treeDcAdjNote,
                    options,
                    pendingRollsEnriched,
                    finalEffects,
                    eventIndex
                };
            })(),
            engine: this._engine,
            recoverySummary,
            activitySummary,
            partyDiscoveries,
            grantActors: getPartyActors().map(a => ({ id: a.id, name: a.name })),
            activityDetail: this._buildActivityDetailContext(selectedCharacter),
            campStatus: this._engine ? (() => {
                // Use effective camp comfort (includes fire/shelter modifiers) rather than raw terrain
                const rawComfort = this._engine.comfort;
                const fireIsLit = (this._fireLevel ?? "unlit") !== "unlit";
                const activeShelters = this._engine.activeShelters ?? [];
                const shelterSpell = activeShelters.find(s => s !== "tent" && s !== "none") ? SHELTER_SPELLS[activeShelters.find(s => s !== "tent" && s !== "none")]?.label ?? null : null;
                const tiers = RANK_TO_KEY;
                let effectiveIdx = COMFORT_RANK[rawComfort] ?? COMFORT_RANK.rough;
                if (shelterSpell) {
                    effectiveIdx = Math.max(effectiveIdx, COMFORT_RANK.sheltered);
                }
                if (fireIsLit) effectiveIdx = Math.min(COMFORT_RANK.safe, effectiveIdx + 1);
                const comfort = RANK_TO_KEY[effectiveIdx];

                const weatherKey = this._engine.weather ?? "clear";
                const wx = WEATHER_TABLE[weatherKey] ?? WEATHER_TABLE.clear;
                const weatherParts = [];
                if (wx.comfortPenalty > 0) weatherParts.push(`Comfort -${wx.comfortPenalty} step`);
                if (wx.encounterDC > 0) weatherParts.push(`Night check mod +${wx.encounterDC}`);
                if (wx.tentCancels) weatherParts.push("Tent cancels");
                else if (wx.tentReduces) weatherParts.push("Tent reduces by 1");
                const SHELTER_TOOLTIPS = {
                    tent: "Tent: encounter threshold -2, cancels or reduces weather",
                    tiny_hut: "Tiny Hut: comfort floor sheltered, encounter threshold -5",
                    rope_trick: "Rope Trick: extradimensional shelter, hidden from the outside",
                    magnificent_mansion: "Mansion: comfort floor safe, no encounters"
                };
                const FIRE_TIPS = {
                    unlit: "Unlit: -1 comfort step at resolution",
                    embers: "Embers: no change to encounter chance.",
                    campfire: "Campfire: +1 encounter DC (light draws attention).",
                    bonfire: "+1 camp comfort. +2 encounter DC (beacon in the dark)."
                };
                return this._campStatus = {
                    comfort,
                    comfortTooltip: getComfortTip(comfort),
                    weather: weatherKey !== "clear" ? weatherKey : null,
                    weatherLabel: wx.label,
                    weatherTooltip: weatherParts.length ? `${wx.label}: ${weatherParts.join(", ")}` : wx.label,
                    fireLevel: this._fireLevel ?? "unlit",
                    fireTooltip: FIRE_TIPS[this._fireLevel ?? "unlit"] ?? "Fire",
                    hasTent: (this._engine.activeShelters ?? []).includes("tent"),
                    activeShelters: (this._engine.activeShelters ?? []).map(id => {
                        const SHELTER_LABELS = { tent: "Tent", tiny_hut: "Tiny Hut", rope_trick: "Rope Trick", magnificent_mansion: "Mansion", none: "Open Air" };
                        const SHELTER_ICONS = { tent: "fas fa-campground", tiny_hut: "fas fa-igloo", rope_trick: "fas fa-hat-wizard", magnificent_mansion: "fas fa-chess-rook", none: "fas fa-cloud-moon" };
                        return { id, name: SHELTER_LABELS[id] ?? id, icon: SHELTER_ICONS[id] ?? "fas fa-shield-alt", tooltip: SHELTER_TOOLTIPS[id] ?? SHELTER_LABELS[id] ?? id };
                    })
                };
            })() : this._campStatus ?? null,
            campConditionsBar: this._buildCampConditionsBar(campScanData, { safeRestSpot, encountersEnabled }),
            campScan: campScanData,
            comfortEnabled: isComfortEnabled(),
            campMakeCampPlacementUnlocked,
            campGatesReady: this._phase === "camp" && !!(campMakeCampStep === 1 && campFireGatePit && campFireGateLevel),
            canContinueToCampLayout: false,
            canProceedFromCamp: false,
            campMinimalMode: this._phase === "camp",
            showArtNudge: this._phase === "camp" && this._shouldShowArtNudge(),
            artNudgeIsUpdate: this._phase === "camp" && ImageResolver.hasArtPack && !ImageResolver.hasStationTokens,
            ...(this._phase === "events" && !this._eventsRolled ? (() => {
                const terrainTag = this._engine?.terrainTag ?? this._selectedTerrain ?? "forest";
                const poolCount = countPoolEventsForTerrain(this._eventResolver, terrainTag);
                const terrain = TerrainRegistry.get(terrainTag);
                const eventsMode = this._eventsMode ?? "random";
                const pickAvailable = poolCount > 0;
                const effectiveMode = (eventsMode === "pick" && !pickAvailable) ? "random" : eventsMode;
                return {
                    eventPoolCount: poolCount,
                    showEventPoolNudge: encountersEnabled && this._shouldShowEventPoolNudge(terrainTag),
                    eventPoolTerrainLabel: terrain?.label ?? terrainTag,
                    eventsMode: effectiveMode,
                    eventsModePickAvailable: pickAvailable,
                    eventsModeIsRandom: effectiveMode === "random",
                    eventsModeIsImprovise: effectiveMode === "improvise",
                    eventsModeIsPick: effectiveMode === "pick"
                };
            })() : {
                eventPoolCount: null,
                showEventPoolNudge: false,
                eventPoolTerrainLabel: "",
                eventsMode: "random",
                eventsModePickAvailable: false,
                eventsModeIsRandom: true,
                eventsModeIsImprovise: false,
                eventsModeIsPick: false
            }),
            campPitPlacementCancelled: !!this._campPitPlacementCancelled,
            showCampfireCanvasPanel: !!this._showCampfireCanvasPanel,
            campMakeCampStep,
            campFireEncounterHint,
            showCampCeremonyMinigame: this._campCeremonyMinigameEnabled(),
            campFirePreviewLabel: (() => {
                if (this._coldCampDecided || this._isCampColdCampPreview()) return "Cold camp";
                const p = this._campFirePreviewLevel ?? "embers";
                return p.charAt(0).toUpperCase() + p.slice(1);
            })(),
            campFirePickerLevels,
            campFirePreviewLevel: this._campFirePreviewLevel ?? "embers",
            campPreviewIsColdCamp: this._isCampColdCampPreview(),
            campFireGatePit,
            campFireGateLevel,
            campFireIsLit,
            campFireLabel: (() => {
                const l = this._fireLevel ?? "unlit";
                return l.charAt(0).toUpperCase() + l.slice(1);
            })(),
            campFireLitBy,
            campSelectedFirewoodCost,
            campPartyFirewood,
            campHasEnoughFirewood,
            campCanLight,
            campFireLighters,
            campFirewoodPledgeList,
            campMyPledge,
            campCanAddFirewood,
            campMyFirewoodActorId,
            campColdCampDecided,
            campComfortIsHostile,
            campFireTierCards,
            campFireTotalPledged,
            campViewerCanLight,
            campFireOtherLighterCount,
            campFireLighterNames,
            campPersonalSelected,
            campGearForSelected,
            campPlacementRuleHint,
            campfirePlaced,
            campStationCards,
            craftingDrawer: this._buildCraftingDrawerContext(),
            encounterBar: (this._engine && !this._eventsRolled && !this._engine.safeRestSpot && encountersEnabled) ? (() => {
                const bd = this._engine._encounterBreakdown ?? {};
                const shelter = bd.shelter ?? 0;
                const weather = bd.weather ?? 0;
                const scouting = bd.scouting ?? 0;
                const fireUncommitted = (this._fireLevel ?? "unlit") === "unlit" && !this._coldCampDecided;
                const fire = (this._phase === "camp" && fireUncommitted)
                    ? (CampGearScanner.FIRE_ENCOUNTER_MOD_BY_LEVEL[this._campFirePreviewLevel ?? "embers"] ?? 0)
                    : (this._engine.fireRollModifier ?? 0);
                const gmAdj = this._engine.gmEncounterAdj ?? 0;
                const complication = this._engine.scoutingComplication ?? false;
                const defenses = bd.defenses ?? 0;
                // Include early defense results (resolved during Activities phase)
                let earlyDefenseBonus = 0;
                if (defenses === 0) {
                    for (const [, er] of (this._earlyResults ?? [])) {
                        if (er.activityId === "act_defenses" && (er.result === "success" || er.result === "exceptional")) {
                            earlyDefenseBonus += 2;
                        }
                    }
                }
                const totalDefenses = defenses + earlyDefenseBonus;
                const total = shelter + weather + scouting + fire;
                const terrainTable = this._eventResolver?.tables?.get(this._engine.terrainTag);
                const baseDC = terrainTable?.noEventThreshold ?? 15;
                const effectiveDC = Math.max(1, baseDC - total + gmAdj - totalDefenses);
        Logger.log(`[Respite:UI] encounterBar: baseDC=${baseDC}, shelter=${shelter}, weather=${weather}, scouting=${scouting}, fire=${fire}, total=${total}, defenses=${defenses}, earlyDefenseBonus=${earlyDefenseBonus}, gmAdj=${gmAdj}, effectiveDC=${effectiveDC}`);
                const fmt = (v) => v > 0 ? `+${v}` : `${v}`;
                const terrainObj = TerrainRegistry.get(this._engine.terrainTag);
                const terrainLabel = terrainObj?.label ?? this._engine.terrainTag ?? "Terrain";
                const chips = [];
                if (weather !== 0) chips.push({ label: bd.weatherName ?? "Weather", value: fmt(weather), icon: "fas fa-cloud-sun-rain", tooltip: "Weather shifts the night check. Rough weather makes a camp event more likely. The value is this factor's effect on the DC." });
                if (shelter !== 0) chips.push({ label: "Shelter", value: fmt(shelter), icon: "fas fa-campground", tooltip: "A tent or shelter spell hides the camp and lowers the chance of a night event." });
                if (scouting !== 0) chips.push({ label: `Scout: ${bd.scoutingResult ?? "?"}`, value: fmt(scouting), icon: "fas fa-binoculars", tooltip: "Scouting result during travel. A good scout lowers the event chance; a poor scout raises it." });
                if (complication) chips.push({ label: "Complication", value: "", icon: "fas fa-exclamation-triangle", warn: true, tooltip: "A failed scout left a hidden complication that will trigger during events." });
                if (fire !== 0) chips.push({ label: this._fireLevel ?? "Fire", value: fmt(-fire), icon: "fas fa-fire", tooltip: "A lit fire is a beacon. A larger fire raises the encounter DC and draws attention." });
                const defensesAttempted = this._pendingCampRolls?.some(p => p.activityId === "act_defenses");
                const defensesChosen = [...(this._characterChoices?.values() ?? [])].includes("act_defenses");
                let defensesFailed = false;
                let defensesPending = false;
                if (totalDefenses !== 0) {
                    chips.push({ label: "Defenses", value: `-${totalDefenses}`, icon: "fas fa-shield-alt", tooltip: `${totalDefenses / 2} defender(s) passed. Each lowers the threshold by 2.` });
                } else if (defensesAttempted || defensesChosen) {
                    let earlyDefenseCount = 0;
                    for (const [, er] of (this._earlyResults ?? [])) {
                        if (er.activityId === "act_defenses") earlyDefenseCount++;
                    }
                    defensesPending = true;
                    defensesFailed = earlyDefenseCount > 0 || defensesAttempted;
                    if (defensesFailed) {
                        chips.push({ label: "Defenses", value: "0", icon: "fas fa-shield-alt", warn: true, tooltip: "Defenses were attempted but failed. No reduction applied." });
                    } else {
                        chips.push({ label: "Defenses", value: "pending", icon: "fas fa-shield-alt", tooltip: "Defenders assigned. Reduction applies after a successful roll." });
                    }
                }
                if (gmAdj !== 0) chips.push({ label: "GM", value: fmt(gmAdj), icon: "fas fa-gavel", tooltip: "Manual GM adjustment to the encounter DC, set with the plus and minus buttons." });

                const playerFactors = this._buildEncounterPlayerFactors({
                    terrainLabel,
                    weather,
                    weatherName: bd.weatherName,
                    shelter,
                    scouting,
                    scoutingResult: bd.scoutingResult,
                    complication,
                    fire,
                    fireLevel: this._fireLevel ?? "unlit",
                    totalDefenses,
                    defensesPending,
                    defensesFailed
                });

                return {
                    total,
                    baseDC,
                    effectiveDC,
                    terrainLabel,
                    totalLabel: `Encounter DC ${effectiveDC}`,
                    chips,
                    playerFactors,
                    complication,
                    isGM: game.user.isGM,
                    gmAdj
                };
            })() : null,
            magicScanResults: this._magicScanResults ?? null,
            magicScanComplete: this._magicScanComplete ?? false,

            // Meal phase context
            mealCards: (() => {
                if (this._phase !== "meal") return null;

                // GM: roster characters only. Player: only owned + rostered characters.
                const rosterIds = new Set(getPartyActors().map(a => a.id));
                let characterIds;
                if (this._isGM) {
                    characterIds = this._engine?.characterChoices
                        ? Array.from(this._engine.characterChoices.keys()).filter(id => rosterIds.has(id))
                        : [];
                } else {
                    characterIds = this._myCharacterIds
                        ? Array.from(this._myCharacterIds).filter(id => rosterIds.has(id))
                        : [];
                }

                const allCards = characterIds
                    .map(id => this.getStationMealCardForActor(id))
                    .filter(Boolean);

                // Mark cards where the owning player has already submitted their choices
                if (this._isGM && this._mealSubmissions) {
                    for (const card of allCards) {
                        const actor = game.actors.get(card.characterId);
                        if (!actor) continue;
                        const ownerUser = game.users.find(u => !u.isGM && actor.testUserPermission(u, "OWNER"));
                        if (ownerUser && this._mealSubmissions.has(ownerUser.id)) {
                            card.playerSubmitted = true;
                        }
                    }
                }

                // Feast advisory: mark cards pre-covered by a TotM Serve Now feast.
                // Only show when an actual party feast was served, not for individual rations
                // like porridge that happen to satiate water.
                if (this._totmFeastServed && this._activityMealRationsSubmitted?.size) {
                    for (const card of allCards) {
                        if (this._activityMealRationsSubmitted.has(card.characterId)) {
                            card.feastAdvisory = true;
                        }
                    }
                }

                // GM: filter to selected roster character
                if (this._isGM && this._selectedCharacterId) {
                    const filtered = allCards.filter(c => c.characterId === this._selectedCharacterId);
                    return filtered.length > 0 ? filtered : allCards.slice(0, 1);
                }

                return allCards;
            })(),
            mealSubmitted: this._mealSubmitted ?? false,
            mealSubmissions: this._mealSubmissions ? Object.fromEntries(this._mealSubmissions) : {},
            daysSinceLastRest: this._daysSinceLastRest ?? 1,
            // Global multi-day flags (computed from ALL characters, not roster-filtered)
            allMealsConsumed: (() => {
                if (this._phase !== "meal") return false;
                const characterIds = this._engine?.characterChoices ? Array.from(this._engine.characterChoices.keys()) : [];
                if (!characterIds.length) return false;
                const totalDays = Math.max(1, this._daysSinceLastRest ?? 1);
                if (totalDays <= 1) return true; // single-day: no consume step needed
                for (const charId of characterIds) {
                    const choice = this._mealChoices?.get(charId);
                    const consumed = choice?.consumedDays?.length ?? 0;
                    if (consumed < totalDays) return false;
                }
                return true;
            })(),
            pendingDehydrationSaves: this._pendingDehydrationSaves?.length > 0 ? this._pendingDehydrationSaves.length : 0,
            allDehydrationResolved: this._pendingDehydrationSaves?.length > 0 && this._pendingDehydrationSaves.every(s => s.resolved),
            hasUnresolvedSaves: this._pendingDehydrationSaves?.length > 0 && this._pendingDehydrationSaves.some(s => !s.resolved),
            dehydrationResults: (() => {
                // GM: use pending saves data; Player: use broadcast results
                const fromPending = (this._pendingDehydrationSaves ?? []).filter(s => s.resolved).map(s => ({
                    actorName: s.actorName,
                    total: s.total ?? 0,
                    dc: s.dc,
                    passed: s.passed ?? false,
                    reason: s.reason ?? null,
                    pending: false
                }));
                return fromPending.length > 0 ? fromPending : (this._dehydrationResults ?? []);
            })(),
            isMultiDay: (this._daysSinceLastRest ?? 1) > 1,
            mealCurrentDay: (() => {
                if (this._phase !== "meal") return 1;
                const characterIds = this._engine?.characterChoices ? Array.from(this._engine.characterChoices.keys()) : [];
                if (!characterIds.length) return 1;
                let minDay = Infinity;
                for (const charId of characterIds) {
                    const choice = this._mealChoices?.get(charId);
                    const consumed = choice?.consumedDays?.length ?? 0;
                    minDay = Math.min(minDay, consumed + 1);
                }
                return minDay === Infinity ? 1 : minDay;
            })(),
            mealProcessed: this._mealProcessed ?? false,
            campPlaced: hasCampPlaced()
        };
    }

    /**
     * Builds context data for the inline crafting drawer.
     */
    _buildCraftingDrawerContext() {
        return this._crafting.buildContext();
    }

    /**
     * Xanathar optional rule: payload for don/doff controls. Uses _doffedArmor map.
     * @param {Actor|null} a
     * @returns {object|null}
     */
    _buildArmorWarningForActor(a) {
        if (!a) return null;
        if (this._effectiveSafeRestSpot()) return null;
        try {
            const armorDoffEnabled = game.settings.get(MODULE_ID, "armorDoffRule");
            if (!armorDoffEnabled) return null;
            if (!this._doffedArmor) this._doffedArmor = new Map();
            const doffedItemId = this._doffedArmor.get(a.id);

            const equippedArmor = a.itemTypes?.equipment?.find(i =>
                i.system?.equipped && i.system?.type?.value === "heavy"
            ) ?? a.itemTypes?.equipment?.find(i =>
                i.system?.equipped && i.system?.type?.value === "medium"
            );

            if (equippedArmor) {
                const armorType = equippedArmor.system?.type?.value;
                const donTime = armorType === "heavy" ? "10 min" : "5 min";
                return {
                    type: armorType,
                    name: equippedArmor.name,
                    itemId: equippedArmor.id,
                    actorId: a.id,
                    isDoffed: false,
                    donTime,
                    hint: `${equippedArmor.name} (${armorType}) equipped. Don time: ${donTime}.`
                };
            }
            if (doffedItemId) {
                const doffedItem = a.items.get(doffedItemId);
                if (doffedItem) {
                    const armorType = doffedItem.system?.type?.value ?? "medium";
                    const donTime = armorType === "heavy" ? "10 min" : "5 min";
                    return {
                        type: armorType,
                        name: doffedItem.name,
                        itemId: doffedItemId,
                        actorId: a.id,
                        isDoffed: true,
                        donTime,
                        hint: `${doffedItem.name} removed for rest. Better recovery, but vulnerable if attacked. Don time: ${donTime}.`
                    };
                }
            }
            const inventoryArmor = a.itemTypes?.equipment?.find(i =>
                !i.system?.equipped && i.system?.type?.value === "heavy"
            ) ?? a.itemTypes?.equipment?.find(i =>
                !i.system?.equipped && i.system?.type?.value === "medium"
            );
            if (inventoryArmor) {
                const armorType = inventoryArmor.system?.type?.value;
                const donTime = armorType === "heavy" ? "10 min" : "5 min";
                return {
                    type: armorType,
                    name: inventoryArmor.name,
                    itemId: inventoryArmor.id,
                    actorId: a.id,
                    isDoffed: true,
                    donTime,
                    hint: `${inventoryArmor.name} available in inventory. Don time: ${donTime}.`
                };
            }
        } catch (e) { /* setting may not exist yet */ }
        return null;
    }

    /**
     * Don/doff block for an activity that interacts with sleep penalties (e.g. Rest Fully).
     * Waiver activities (e.g. watch) omit the block unless doff/inv armor needs a Don path.
     * @param {Actor|null} actor
     * @param {object} tile  Activity definition with armorSleepWaiver
     * @returns {object|null}
     */
    getArmorWarningForActivityDetail(actor, tile) {
        const aw = this._buildArmorWarningForActor(actor);
        if (!aw || !tile) return null;
        if (aw.isDoffed) return aw;
        if (!tile.armorSleepWaiver) return aw;
        return null;
    }

    /**
     * Binds .btn-armor-toggle inside a subtree. Defaults to re-rendering this app.
     * @param {HTMLElement} element
     * @param {() => void} [onAfter]
     */
    _bindArmorToggleHandlers(element, onAfter) {
        if (!element) return;
        const done = onAfter ?? (() => this.render());
        const armorToggles = element.querySelectorAll(".btn-armor-toggle");
        for (const btn of armorToggles) {
            btn.addEventListener("click", async (ev) => {
                ev.stopPropagation();
                const actorId = btn.dataset.actorId;
                const itemId = btn.dataset.itemId;
                const isDoffed = btn.dataset.isDoffed === "true";
                if (!actorId || !itemId) return;

                const actor = game.actors.get(actorId);
                const item = actor?.items.get(itemId);
                if (!item) return;

                if (!this._doffedArmor) this._doffedArmor = new Map();

                if (isDoffed) {
                    await item.update({ "system.equipped": true });
                    this._doffedArmor.delete(actorId);
                } else {
                    await item.update({ "system.equipped": false });
                    this._doffedArmor.set(actorId, itemId);
                }

                emitArmorToggle({
                    actorId,
                    itemId,
                    isDoffed: !isDoffed
                });

                done();
            });
        }
    }

    /**
     * Builds context data for the activity detail preview panel.
     */
    _buildActivityDetailContext(selectedCharacter) {
        if (!this._activityDetailId || !selectedCharacter) return null;

        // Find the tile from the selected character's tiles (search both flat and station views)
        const allTiles = [
            ...(selectedCharacter.tileCategories?.flatMap(c => c.tiles) ?? []),
            ...(selectedCharacter.stationCards?.flatMap(s => s.tiles) ?? []),
            ...(selectedCharacter.professionTiles ?? [])
        ];
        const tile = allTiles.find(t => t.id === this._activityDetailId);
        if (!tile) return null;

        // Build outcome hints from success, exceptional, and failure
        const outcomeHints = [];
        if (tile.outcomes?.success?.effects?.length) {
            for (const eff of tile.outcomes.success.effects) {
                outcomeHints.push({ text: eff.description, type: "success" });
            }
        }
        if (tile.outcomes?.exceptional?.effects?.length) {
            for (const eff of tile.outcomes.exceptional.effects) {
                outcomeHints.push({ text: eff.description, type: "exceptional" });
            }
        }
        if (tile.outcomes?.failure?.effects?.length) {
            for (const eff of tile.outcomes.failure.effects) {
                outcomeHints.push({ text: eff.description, type: "failure" });
            }
        }

        // Build follow-up interactive data for GM
        let followUpData = null;
        if (tile.followUp) {
            const currentValue = this._getFollowUpForCharacter(selectedCharacter.id)
                ?? this._gmFollowUps?.get(selectedCharacter.id) ?? null;
            followUpData = {
                type: tile.followUp.type,
                label: tile.followUp.label,
                currentValue
            };

            if (tile.followUp.type === "partyMember") {
                const partyActors = getPartyActors().filter(a => a.id !== selectedCharacter.id);
                followUpData.options = partyActors.sort((a, b) => {
                    const aRatio = a.system.attributes?.hp?.value / a.system.attributes?.hp?.max;
                    const bRatio = b.system.attributes?.hp?.value / b.system.attributes?.hp?.max;
                    return aRatio - bRatio;
                }).map(a => {
                    const hp = a.system.attributes?.hp;
                    const hpText = hp ? ` (${hp.value}/${hp.max} HP)` : "";
                    return { value: a.id, label: `${a.name}${hpText}`, isSelected: a.id === currentValue };
                });
            } else if (tile.followUp.type === "radio" || tile.followUp.type === "select") {
                const selectedVal = currentValue || tile.followUp.default || tile.followUp.options?.[0]?.value;

                // Copy Spell: enrich options with gold awareness
                if (tile.id === "act_scribe") {
                    const actor = game.actors.get(selectedCharacter.id);
                    const currentGold = actor?.system?.currency?.gp ?? 0;
                    followUpData.goldInfo = `${actor?.name ?? "Character"} has ${currentGold}gp`;

                    followUpData.options = tile.followUp.options.map(opt => {
                        const cost = parseInt(opt.value, 10) * 50;
                        const canAfford = currentGold >= cost;
                        return {
                            ...opt,
                            label: canAfford ? opt.label : `${opt.label} (can't afford)`,
                            isSelected: opt.value === selectedVal,
                            isDisabled: !canAfford
                        };
                    });
                } else {
                    followUpData.options = tile.followUp.options.map(opt => ({
                        ...opt,
                        isSelected: opt.value === selectedVal
                    }));
                }

                // Safety net: if somehow no option is selected, force-select the first
                if (followUpData.options?.length && !followUpData.options.some(o => o.isSelected)) {
                    followUpData.options[0].isSelected = true;
                }
            } else if (tile.followUp.type === "actorItem" && tile.followUp.filter === "attuneable") {
                const actor = game.actors.get(selectedCharacter.id);
                const attuneItems = (actor?.items ?? []).filter(i => {
                    const att = i.system?.attunement;
                    // Requires attunement but NOT currently attuned
                    return (att === "required" || att === 1) && !i.system?.attuned;
                });
                followUpData.options = attuneItems.map(i => ({
                    value: i.id,
                    label: i.name,
                    isSelected: i.id === currentValue
                }));
                // Attunement slot counter
                const attunement = actor?.system?.attributes?.attunement;
                if (attunement) {
                    const current = attunement.value ?? 0;
                    const max = attunement.max ?? 3;
                    followUpData.slotInfo = `${current}/${max}${current >= max ? " (at capacity)" : ""}`;
                }
            }
        }

        // Build armor-aware hint (gated by Xanathar's rest rules setting; omitted for safe rest spot)
        let armorHint = null;
        let armorWarning = null;
        if (!this._effectiveSafeRestSpot()) {
            try {
                const armorRuleEnabled = game.settings.get("ionrift-respite", "armorDoffRule");
                if (armorRuleEnabled) {
                    const actorForHint = game.actors.get(selectedCharacter.id);
                    const equippedArmor = actorForHint?.items?.find(i => i.type === "equipment" && i.system?.equipped && ["medium", "heavy"].includes(i.system?.type?.value ?? i.system?.armor?.type));
                    if (equippedArmor && tile.armorSleepWaiver) {
                        armorHint = { text: "Sleeping light between rotations. Armor stays on, weapon close. No HP or HD recovery penalty.", type: "positive" };
                    } else if (equippedArmor && !tile.armorSleepWaiver) {
                        armorHint = { text: "Sleeping in armor. Recover only 1/4 Hit Dice, exhaustion not reduced (Xanathar's). Consider doffing first.", type: "warning" };
                    }
                }
            } catch (e) { /* setting may not exist yet */ }

            const actor = game.actors.get(selectedCharacter.id);
            armorWarning = this.getArmorWarningForActivityDetail(actor, tile);
        }

        return {
            id: tile.id,
            name: tile.name,
            description: tile.description || "No additional details available.",
            icon: tile.icon,
            typeTag: tile.typeTag,
            isCrafting: tile.isCrafting,
            profession: tile.profession,
            check: tile.check ? this._formatCheckLabel(tile.check, selectedCharacter) : null,
            outcomeHints,
            combatModifiers: tile.combatModifiers ?? null,
            followUpData,
            armorHint,
            armorWarning,
            characterId: selectedCharacter.id
        };
    }

    /**
     * Formats a check label, resolving "best" ability to the character's highest score.
     */
    _formatCheckLabel(check, character) {
        let abilityLabel = check.ability?.toUpperCase() ?? "";

        if (check.ability === "best" && character?.id) {
            const actor = game.actors.get(character.id);
            if (actor) {
                const fmtAdapter = game.ionrift?.respite?.adapter;
                const abilityKeys = ["str", "dex", "con", "int", "wis", "cha"];
                let bestKey = null;
                let bestVal = -1;
                for (const key of abilityKeys) {
                    const mod = fmtAdapter ? fmtAdapter.getAbilityMod(actor, key) : (actor.system?.abilities?.[key]?.mod ?? 0);
                    if (mod > bestVal) { bestVal = mod; bestKey = key; }
                }
                if (bestKey) abilityLabel = `${bestKey.toUpperCase()} (${bestVal})`;
            }
        }

        const skillPart = check.skill ? ` (${check.skill})` : "";
        return `${abilityLabel}${skillPart} DC ${check.dc ?? "?"}`;
    }

    /**
     * Activity phase: tent, bedroll, mess kit for the map (campfire station dialog).
     * @param {string} actorId
     * @returns {object|null}
     */
    getCampGearContextForActor(actorId) {
        if (this._phase !== "activity" || !actorId) return null;
        const a = game.actors.get(actorId);
        if (!a) return null;
        const items = a.items?.map(i => i.name?.toLowerCase() ?? "") ?? [];
        const hasBedroll = items.some(n => n.includes("bedroll"));
        const hasTent = items.some(n => /(?:^|[\s,\-])tent\b/i.test(n));
        const hasActualMessKit = items.some(n => n.includes("mess kit"));
        const hasCooksUtensils = items.some(n => n.includes("cook") && n.includes("utensil"));
        const hasMessKit = hasActualMessKit || hasCooksUtensils;
        /** @type {"messkit"|"utensils"|null} */
        const messKitSource = hasActualMessKit ? "messkit" : (hasCooksUtensils ? "utensils" : null);
        const isOwner = !!a.isOwner;
        const canDragUser = this._isGM || isOwner;
        const fireIsLit = (this._fireLevel ?? "unlit") !== "unlit";
        const tentDeployed = isGearDeployed(a.id, "tent");
        const bedrollDeployed = isGearDeployed(a.id, "bedroll");
        const messKitDeployed = isGearDeployed(a.id, "messkit");
        const hasDeployedCampGear = tentDeployed || bedrollDeployed || messKitDeployed;
        const exhaustionRisk = false;
        const canDragBedroll = canDragUser && hasBedroll && !bedrollDeployed;
        const canDragTent = canDragUser && hasTent && !tentDeployed;
        const canDragMessKit = canDragUser && hasMessKit && !messKitDeployed;
        const canDrag = canDragBedroll || canDragTent || canDragMessKit;
        return {
            actorId: a.id,
            actorName: a.name,
            actorImg: a.img || "icons/svg/mystery-man.svg",
            hasBedroll,
            hasTent,
            hasMessKit,
            messKitSource,
            bedrollDeployed,
            tentDeployed,
            messKitDeployed,
            canDrag,
            canDragBedroll,
            canDragTent,
            canDragMessKit,
            isOwner,
            showClearOwnGear: !this._isGM && isOwner && hasDeployedCampGear,
            fireIsLit,
            exhaustionRisk,
            sceneHasDroppables: hasTent || hasBedroll || hasMessKit,
            messAdvantageOff: hasMessKit && !fireIsLit && exhaustionRisk
        };
    }

    /**
     * CampGearScanner result for activity-phase station dialogs. Player clients often have no
     * RestFlowEngine; comfort and fire rows use terrain + snapshot fields only.
     * @returns {object|null}
     */
    _getCampScanDataForActivityStationDialog() {
        if (this._phase !== "activity") return null;
        const restType = this._engine?.restType
            ?? this._selectedRestType
            ?? this._restData?.restType
            ?? "long";
        if (restType === "short") return null;
        const terrainTagCamp = this._selectedTerrain ?? this._engine?.terrainTag ?? "forest";
        const terrainCamp = TerrainRegistry.get(terrainTagCamp);
        const shelterKey = (this._engine?.activeShelters ?? []).find(s => s !== "tent" && s !== "none");
        const shelterSpellCamp = shelterKey
            ? (SHELTER_SPELLS[shelterKey]?.label ?? null)
            : null;
        // Local preview (player or GM hovering a tier) overrides the committed level so the
        // comfort header moves before Set/Request, matching the TotM Make Camp picker.
        const previewLevel = ["embers", "campfire", "bonfire"].includes(this._stationFirePreviewLevel)
            ? this._stationFirePreviewLevel
            : null;
        const effectiveScanLevel = previewLevel ?? this._fireLevel ?? "unlit";
        const encMod = CampGearScanner.FIRE_ENCOUNTER_MOD_BY_LEVEL[effectiveScanLevel] ?? 0;
        const baseTerrainComfort = this._engine?.comfort
            ?? TerrainRegistry.getDefaults(terrainTagCamp).comfort
            ?? "rough";
        return CampGearScanner.scan(
            baseTerrainComfort,
            effectiveScanLevel,
            shelterSpellCamp,
            terrainCamp?.comfortReason ?? "",
            terrainCamp?.label ?? terrainTagCamp,
            encMod,
            !!this._engine?.safeRestSpot
        ) ?? null;
    }

    /**
     * Activity phase: camp comfort line for the campfire station dialog (matches Make Camp advisory).
     * @returns {{ mapComfortTier: string, mapComfortLabel: string, mapComfortLine: string, mapComfortTierClass: string }|null}
     */
    getCampComfortAdvisoryForStationDialog() {
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

    /**
     * Activity phase: Fire tab on the campfire station (tier strip, encounter hint, GM set flags).
     * @returns {object|null}
     */
    getFireTabContextForStationDialog() {
        const campScanData = this._getCampScanDataForActivityStationDialog();
        if (!campScanData) return null;

        const coldCamp = !!this._coldCampDecided;
        const curLevel = this._fireLevel ?? "unlit";
        // Local preview wins for the hint and header so the impact is visible before commit.
        const previewLevel = (!coldCamp && ["embers", "campfire", "bonfire"].includes(this._stationFirePreviewLevel)
            && this._stationFirePreviewLevel !== curLevel)
            ? this._stationFirePreviewLevel
            : null;
        const effectiveScanLevel = coldCamp ? "cold_camp" : (previewLevel ?? curLevel);

        let campFireEncounterHint = "";
        if (effectiveScanLevel === "cold_camp") {
            campFireEncounterHint = "Cold camp: harder for enemies to spot (lower encounter chance).";
        } else if (effectiveScanLevel === "unlit") {
            campFireEncounterHint = "No fire is lit. The tier row shows what each level would do.";
        } else if (effectiveScanLevel === "embers") {
            campFireEncounterHint = "Embers: no change to encounter chance.";
        } else if (effectiveScanLevel === "campfire") {
            campFireEncounterHint = "Campfire: light makes the camp easier for enemies to spot.";
        } else if (effectiveScanLevel === "bonfire") {
            campFireEncounterHint = "Bonfire: visible from far off; enemies spot the camp easily.";
        }
        if (previewLevel) {
            campFireEncounterHint = `Previewing ${previewLevel}. ${campFireEncounterHint}`;
        }

        const COMFORT_TIERS = ["hostile", "rough", "sheltered", "safe"];
        const TIER_LABELS = Object.fromEntries(
            COMFORT_TIERS.map(k => [k, CampGearScanner.getRules(k).label])
        );
        const baseComfort = campScanData.campComfortPreFire ?? campScanData.campComfort ?? "rough";
        const baseIdx = COMFORT_TIERS.indexOf(baseComfort);
        const COMFORT_DELTA = { embers: 0, campfire: 0, bonfire: 1 };
        const campFireTierCards = ["embers", "campfire", "bonfire"].map(id => {
            const delta = COMFORT_DELTA[id] ?? 0;
            const resultIdx = Math.min(baseIdx + delta, COMFORT_TIERS.length - 1);
            const resultComfort = COMFORT_TIERS[resultIdx] ?? baseComfort;
            const resultLabel = TIER_LABELS[resultComfort] ?? resultComfort;
            const comfortHint = delta !== 0
                ? `${TIER_LABELS[baseComfort] ?? baseComfort} to ${resultLabel}`
                : resultLabel;
            const isActive = curLevel === id;
            const F = CampGearScanner.FIREWOOD_COST_BY_LEVEL;
            const costNew = F[id] ?? 0;
            const costCur = (curLevel === "unlit") ? 0 : (F[curLevel] ?? 0);
            const isGm = !!game.user?.isGM;
            let tierChangeBlocked = true;
            if (!coldCamp && !isActive) {
                if (costNew < costCur) {
                    tierChangeBlocked = false;
                } else {
                    const need = costNew - costCur;
                    const actors = getPartyActors();
                    const totalFirewood = actors.reduce((sum, a) => {
                        const it = a.items.find(i => {
                            const n = i.name?.toLowerCase() ?? "";
                            return n.includes("firewood") || n === "kindling";
                        });
                        return sum + (it?.system?.quantity ?? 0);
                    }, 0);
                    tierChangeBlocked = need > 0 && totalFirewood < need;
                }
            }
            return {
                id,
                label: id.charAt(0).toUpperCase() + id.slice(1),
                    costLabel: CampGearScanner.firewoodCostLabel(id),
                comfortHint,
                comfortChanged: delta !== 0,
                active: isActive,
                previewActive: previewLevel === id,
                actionBlocked: isActive ? false : tierChangeBlocked,
                setDisabled: isActive ? false : (isGm ? tierChangeBlocked : true),
                requestDisabled: tierChangeBlocked
            };
        });

        const campFirewoodPledgeList = Array.from(this._firewoodPledges.values())
            .filter(p => p.count > 0)
            .map(p => ({ actorName: p.actorName, count: p.count }));

        return {
            campFireTierCards,
            campFireEncounterHint,
            campFirewoodPledgeList,
            campFireIsLit: (this._fireLevel ?? "unlit") !== "unlit",
            campFireTabColdCamp: coldCamp,
            campFireTabGm: !!game.user?.isGM,
            campFirePreviewLevel: previewLevel,
            campFirePreviewLabel: previewLevel ? (previewLevel.charAt(0).toUpperCase() + previewLevel.slice(1)) : null
        };
    }

    /**
     * Activity-phase campfire station: set or clear the local tier preview (non-broadcast).
     * Lets a player or GM see the comfort/encounter impact before pressing Set or Request.
     * @param {string|null} level - "embers" | "campfire" | "bonfire", or null to clear.
     */
    setStationFirePreviewLevel(level) {
        const next = ["embers", "campfire", "bonfire"].includes(level) ? level : null;
        if (this._stationFirePreviewLevel === next) return;
        this._stationFirePreviewLevel = next;
    }

    /**
     * Activity phase: per-actor personal comfort for the campfire station (matches Make Camp / CampGearScanner).
     * @param {string} actorId
     * @returns {{
     *   personalComfort: string,
     *   personalComfortLabel: string,
     *   personalMatchesCamp: boolean,
     *   gearBreakdown: Array<{ label: string, icon: string, delta: number }>,
     *   recovery: { hpLabel: string, hpSeverity: string, hdLabel: string, hdSeverity: string, exhaustionDC: number|null, exhaustionLabel: string, exhaustionSeverity: string|null },
     *   mitigationHints: string[],
     *   hasMitigationHints: boolean,
     *   fireFactorRow: { tierLabel: string, statusLine: string },
     *   hasBedroll: boolean,
     *   hasTent: boolean,
     *   hasMessKit: boolean,
     *   actorId: string,
     *   gearSlots: Array<{
     *     gearType: string, title: string, icon: string,
     *     isMissing: boolean, isPlaced: boolean, canDrag: boolean, isReadonlyOwned: boolean,
     *     benefitLine: string, missingLine: string
     *   }>
     * }|null}
     */
    getCampPersonalCardForActor(actorId) {
        if (this._phase !== "activity" || !actorId) return null;
        const gearCtx = this.getCampGearContextForActor(actorId);
        if (!gearCtx) return null;
        const campScanData = this._getCampScanDataForActivityStationDialog();
        if (!campScanData?.personalCards?.length) return null;
        const card = campScanData.personalCards.find(p => p.actorId === actorId);
        if (!card) return null;

        const g = gearCtx;
        const slot = (def) => {
            const owned = def.owned;
            const deployed = def.deployed;
            const canDrag = def.canDrag;
            return {
                gearType: def.gearType,
                title: def.title,
                icon: def.icon,
                actorId: g.actorId,
                isMissing: !owned,
                isPlaced: owned && deployed,
                canDrag: owned && canDrag,
                isReadonlyOwned: owned && !canDrag && !deployed,
                benefitLine: def.benefitLine,
                missingLine: def.missingLine
            };
        };
        const gearSlots = [
            slot({
                gearType: "bedroll",
                title: "Bedroll",
                icon: "fas fa-bed",
                owned: g.hasBedroll,
                deployed: g.bedrollDeployed,
                canDrag: g.canDragBedroll,
                benefitLine: "+1 personal comfort tier and +1 Hit Die recovery from inventory.",
                missingLine: "No bedroll. Comfort stays at camp level."
            }),
            slot({
                gearType: "tent",
                title: "Tent",
                icon: "fas fa-campground",
                owned: g.hasTent,
                deployed: g.tentDeployed,
                canDrag: g.canDragTent,
                benefitLine: "Weather and encounter modifiers while a tent is owned.",
                missingLine: "No tent. No tent modifiers."
            }),
            slot({
                gearType: "messkit",
                title: g.messKitSource === "utensils" ? "Cook's Utensils" : "Mess kit",
                icon: g.messKitSource === "utensils" ? "fas fa-mortar-pestle" : "fas fa-utensils",
                owned: g.hasMessKit,
                deployed: g.messKitDeployed,
                canDrag: g.canDragMessKit,
                benefitLine: g.messKitSource === "utensils"
                    ? "Cook's utensils serve as a mess kit. Advantage on exhaustion saves when fire is lit."
                    : "Advantage on exhaustion saves when the fire is lit.",
                missingLine: "No mess kit or cook's utensils. No camp-gear advantage on exhaustion saves."
            })
        ];

        const rec = card.recovery ?? {};
        const hpSev = rec.hpSeverity ?? "";
        const hdSev = rec.hdSeverity ?? "";
        const exSev = rec.exhaustionSeverity ?? null;
        const hasSuboptimalLine =
            hpSev === "danger" || hpSev === "warning" ||
            hdSev === "danger" || hdSev === "warning" ||
            exSev === "danger" || exSev === "warning";

        const mitigationHints = [];
        if (hasSuboptimalLine) {
            if (!g.hasBedroll) {
                mitigationHints.push("Carry a bedroll in inventory to raise personal comfort by one tier.");
            } else {
                mitigationHints.push("Bedroll is in inventory: it already applies to this preview.");
            }
            if (!campScanData.fireIsLit) {
                mitigationHints.push("Light a fire (embers or higher) to remove the no-fire comfort step.");
            } else {
                const fl = campScanData.fireLevel;
                if (fl && fl !== "unlit" && fl !== "bonfire") {
                    mitigationHints.push("A bonfire can add one camp comfort step (Fire tab).");
                }
            }
            mitigationHints.push("Choose Rest Fully for +1 comfort tier.");
        }

        const fireLevelRaw = campScanData.fireLevel ?? "embers";
        const fireTierLabels = {
            unlit: "No fire",
            embers: "Embers",
            campfire: "Campfire",
            bonfire: "Bonfire"
        };
        const fireStatusLines = {
            unlit: "-1 camp comfort until a fire is lit",
            embers: "No comfort change from fire size",
            campfire: "Cooking and warmth",
            bonfire: "+1 camp comfort"
        };
        const fireFactorRow = {
            tierLabel: fireTierLabels[fireLevelRaw] ?? fireLevelRaw,
            statusLine: fireStatusLines[fireLevelRaw] ?? ""
        };

        return {
            personalComfort: card.personalComfort,
            personalComfortLabel: card.personalComfortLabel,
            personalMatchesCamp: !!card.personalMatchesCamp,
            fireFactorRow,
            gearBreakdown: card.gearBreakdown ?? [],
            recovery: {
                hpLabel: rec.hpLabel ?? "",
                hpSeverity: hpSev,
                hdLabel: rec.hdLabel ?? "",
                hdSeverity: hdSev,
                exhaustionDC: rec.exhaustionDC ?? null,
                exhaustionLabel: rec.exhaustionLabel ?? "",
                exhaustionSeverity: exSev
            },
            mitigationHints,
            hasMitigationHints: mitigationHints.length > 0,
            hasBedroll: !!card.hasBedroll,
            hasTent: !!card.hasTent,
            hasMessKit: !!card.hasMessKit,
            actorId: g.actorId,
            gearSlots
        };
    }

    /**
     * Builds grouped resolution cards from raw rest outcomes. Each card splits its
     * sub-outcomes and recovery readout into a positive (Recovered) cluster and a
     * negative (Setbacks) cluster, and labels every verdict with the activity or
     * event name so badges carry context on their own.
     * @param {Array<Object>} outcomes
     * @returns {Array<Object>}
     */
    _buildResolutionCards(outcomes) {
        const activityResolver = this._activityResolver;

        const classifyActivity = (result) => {
            switch (result) {
                case "exceptional": return { valence: "positive", label: "Exceptional", icon: "fas fa-star" };
                case "success": return { valence: "positive", label: "Success", icon: "fas fa-check" };
                case "failure":
                case "failure_complication": return { valence: "negative", label: "Failed", icon: "fas fa-times" };
                default: return { valence: "neutral", label: null, icon: "fas fa-circle" };
            }
        };
        const classifyEvent = (resolvedOutcome) => {
            switch (resolvedOutcome) {
                case "triumph": return { valence: "positive", label: "Triumph", icon: "fas fa-star" };
                case "success": return { valence: "positive", label: "Passed", icon: "fas fa-check" };
                case "partial": return { valence: "partial", label: "Partial", icon: "fas fa-exclamation-triangle" };
                case "failure":
                case "failure_complication": return { valence: "negative", label: "Failed", icon: "fas fa-times" };
                default: return { valence: "neutral", label: null, icon: "fas fa-moon" };
            }
        };

        // Locked consequences live on the triggered events, keyed by event id.
        // Pulled from the tier that actually resolved so the conclusion names
        // who took the hit and what each pack lost, rather than echoing the raw
        // formula as if the card's owner took it.
        const LOCK_TIER_MAP = { triumph: "onTriumph", success: "onSuccess", mixed: "onMixed", failure: "onFailure" };
        const lockedByEvent = new Map();
        for (const te of (this._triggeredEvents ?? [])) {
            if (!te.resolvedOutcome || ["success", "triumph"].includes(te.resolvedOutcome)) continue;
            const tierKey = LOCK_TIER_MAP[te.resolvedOutcome] ?? "onFailure";
            const block = te.mechanical?.[tierKey] ?? te.mechanical?.onFailure ?? {};
            const lockedDamage = [];
            const lockedLosses = [];
            const lockedItems = [];
            const lockedGold = [];
            const lockedSupply = [];
            for (const eff of (block.effects ?? [])) {
                if (!eff._locked) continue;
                if (eff.type === "damage" && Array.isArray(eff._lockedTargets)) {
                    for (const t of eff._lockedTargets) {
                        if (t.amount > 0) lockedDamage.push({ name: t.name, amount: t.amount, damageType: eff.damageType ?? "" });
                    }
                } else if (eff.type === "consume_resource" && eff._lockedLoss) {
                    lockedLosses.push(eff._lockedLoss);
                } else if (eff.type === "item_at_risk" && Array.isArray(eff._lockedItems)) {
                    for (const li of eff._lockedItems) {
                        lockedItems.push({ actorId: li.actorId, actorName: li.actorName, itemName: li.itemName, lossQty: li.lossQty });
                    }
                } else if (eff.type === "consume_gold" && eff._lockedGold) {
                    for (const b of (eff._lockedGold.breakdown ?? [])) {
                        if (b.lossGp > 0) lockedGold.push({ actorId: b.actorId, actorName: b.actorName, lossGp: b.lossGp });
                    }
                } else if (eff.type === "supply_loss" && eff._lockedSupply) {
                    for (const b of (eff._lockedSupply.breakdown ?? [])) {
                        if (b.lossQty > 0) lockedSupply.push({ actorId: b.actorId, actorName: b.actorName, itemName: b.itemName, lossQty: b.lossQty });
                    }
                }
            }
            if (lockedDamage.length || lockedLosses.length || lockedItems.length || lockedGold.length || lockedSupply.length) {
                lockedByEvent.set(te.eventId, { lockedDamage, lockedLosses, lockedItems, lockedGold, lockedSupply });
            }
        }

        return (outcomes ?? []).map(o => {
            const recovery = o.recovery ?? {};
            const positives = [];
            const setbacks = [];
            const neutrals = [];

            for (const sub of (o.outcomes ?? [])) {
                if (sub.source === "event") {
                    const cls = classifyEvent(sub.resolvedOutcome);
                    // Passive discoveries (no check, but items found) read as a gain.
                    if (cls.valence === "neutral" && (sub.items?.length || sub.effects?.length === 0)) {
                        cls.valence = sub.items?.length ? "positive" : "neutral";
                    }
                    const locked = lockedByEvent.get(sub.eventId) ?? {};
                    // Scope itemised losses to this card's owner so each player sees
                    // what they lost ("Lost 1 Rations"), not the whole party's tally.
                    const allSupply = locked.lockedSupply ?? [];
                    const mine = (entry) => entry.actorId === o.characterId;
                    const enriched = {
                        ...sub,
                        displayName: sub.eventName ?? "Event",
                        verdictLabel: cls.label,
                        verdictIcon: cls.icon,
                        valence: cls.valence,
                        lockedDamage: locked.lockedDamage ?? [],
                        lockedLosses: locked.lockedLosses ?? [],
                        lockedItems: locked.lockedItems ?? [],
                        lockedGold: locked.lockedGold ?? [],
                        lockedSupply: allSupply.filter(mine),
                        // Suppress the generic "Minor supply losses." line on every card
                        // once the GM has rolled the specifics, even for players who
                        // happened to lose nothing in the spread.
                        supplyLocked: allSupply.length > 0
                    };
                    if (cls.valence === "positive") positives.push(enriched);
                    else if (cls.valence === "neutral") neutrals.push(enriched);
                    else setbacks.push(enriched);
                } else {
                    const act = sub.activityId ? activityResolver?.activities?.get(sub.activityId) : null;
                    const cls = classifyActivity(sub.result);
                    const enriched = {
                        ...sub,
                        displayName: act?.name ?? sub.activityId ?? "Activity",
                        verdictLabel: cls.label,
                        verdictIcon: cls.icon,
                        valence: cls.valence
                    };
                    if (cls.valence === "positive") positives.push(enriched);
                    else if (cls.valence === "neutral") neutrals.push(enriched);
                    else setbacks.push(enriched);
                }
            }

            const exhaustionSavePassed = !!recovery.exhaustionDC && recovery.exhaustionSaveResult === "passed";
            const exhaustionSaveFailed = !!recovery.exhaustionDC && recovery.exhaustionSaveResult === "failed";
            const hostileBlocksRecovery = recovery.comfortLevel === "hostile" && !(recovery.exhaustionDelta < 0);
            const deprivationBlocksRecovery = !!recovery.noFoodOrWater && !(recovery.exhaustionDelta < 0);
            const eventDamage = recovery.eventDamage ?? 0;
            const hpRestored = recovery.hpRestored ?? 0;
            const hdRestored = recovery.hdRestored ?? 0;
            const hasGain = hpRestored > 0 || hdRestored > 0;

            // Detect whether recovery fills the resource to max
            const actor = game.actors?.get(o.characterId);
            let hpAtMax = false;
            let hdAtMax = false;
            if (actor) {
                const hp = actor.system?.attributes?.hp;
                if (hp) hpAtMax = (hp.value ?? 0) >= (hp.max ?? 1);
                const classes = actor.items?.filter(i => i.type === "class") ?? [];
                const totalHdSpent = classes.reduce((sum, cls) => {
                    return sum + (cls.system?.hd?.spent ?? cls.system?.hitDiceUsed ?? 0);
                }, 0);
                hdAtMax = totalHdSpent <= 0;
            }

            const exhaustionConditionLabel = recovery.comfortLevel === "hostile" ? "Hostile" : "Rough";

            const hasRecovered = positives.length > 0 || exhaustionSavePassed || hasGain;
            const hasSetback = setbacks.length > 0 || exhaustionSaveFailed
                || hostileBlocksRecovery || deprivationBlocksRecovery || eventDamage > 0 || !!o.eventDisrupted;

            return {
                characterId: o.characterId,
                characterName: o.characterName,
                comfortLevel: recovery.comfortLevel ?? null,
                eventDisrupted: !!o.eventDisrupted,
                gearDescriptors: recovery.gearDescriptors ?? [],
                neutrals,
                positives,
                setbacks,
                hasRecovered,
                hasSetback,
                hpRestored,
                hdRestored,
                hpAtMax,
                hdAtMax,
                hasGain,
                gearBonusBedroll: !!recovery.gearBonuses?.hd,
                exhaustionDC: recovery.exhaustionDC ?? null,
                exhaustionAdvantage: !!recovery.exhaustionAdvantage,
                exhaustionSavePassed,
                exhaustionSaveFailed,
                exhaustionDelta: recovery.exhaustionDelta ?? 0,
                exhaustionConditionLabel,
                hostileBlocksRecovery,
                deprivationBlocksRecovery,
                eventDamage
            };
        });
    }

    _onRenderBindings(context, options) {
        const showTotmCampfirePanelEarly = this._totmCampfireMinigamePanelEnabled();
        if (this._isTotM && (this._phase === "camp" || (this._phase === "activity" && showTotmCampfirePanelEarly))) {
            this._bindRestWindowResizeObserver();
        } else {
            this._disposeRestWindowResizeObserver();
        }
        this._scheduleRestWindowRecenter();

        // Bind meal drag-drop when in meal phase
        if (this._phase === "meal") {
            this._bindMealDragDrop(this.element);
        }

        // TotM Activity: bind workbench drag-drop when Identify tab is active
        if (this._phase === "activity" && this._isTotM && this._totmActiveTab === "identify" && isWorkbenchIdentifyUiEnabled()) {
            this._workbench.bindDragDrop(this.element);
        }

        // TotM Activity: campfire minigame in the permanent right-hand panel
        const showTotmCampfirePanel = this._totmCampfireMinigamePanelEnabled();
        if (this.element) {
            this.element.classList.toggle("totm-activity-campfire-panel", showTotmCampfirePanel);
        }
        if (showTotmCampfirePanel) {
            this._mountCampfireEmbed("activity");
        } else if (this._phase !== "camp" || !this._campCeremonyMinigameEnabled()) {
            this._tearDownCampfireEmbed();
        }

        // Camp: crosshair pit (GM), map notice for all clients, optional canvas panel (gear drag)
        if (this._phase === "camp") {
            if (this._campCeremonyMinigameEnabled()) {
                this._mountCampfireEmbed("camp");
                this._syncCampCeremonyPreviewToEmbed();
            } else {
                this._tearDownCampfireEmbed();
            }
            if (!this._isTotM && this._isGM && !hasCampfirePlaced() && !this._campPitCursorInFlight && !this._campPitPlacementCancelled) {
                void this._startCampPitCursorFlow();
            } else if (!this._isTotM && hasCampfirePlaced() && !this._campToActivityDone && !isStationLayerActive()) {
                void this._refreshCampPitNoticeLayer();
            }
            // TotM camp: mark the window so CSS can target Make Camp layout.
            if (this.element) this.element.classList.toggle("totm-camp-active", this._isTotM);
            const picker = this.element?.querySelector(".camp-fire-tier-picker");
            if (picker && !picker.dataset.ionriftPreviewBound) {
                picker.dataset.ionriftPreviewBound = "1";
                picker.addEventListener(
                    "pointerenter",
                    (e) => {
                        const row = e.target.closest?.("[data-fire-preview]");
                        if (!row || (this._fireLevel ?? "unlit") !== "unlit") return;
                        const lev = row.dataset.firePreview;
                        if (!lev || this._campFirePreviewLevel === lev) return;
                        this._campFirePreviewLevel = lev;
                        this.render({ force: true });
                    },
                    true
                );
                picker.addEventListener("pointerleave", (e) => {
                    if (!picker.contains(e.relatedTarget)) {
                        if (this._campFirePreviewLevel !== null && this._campFirePreviewLevel !== undefined) {
                            this._campFirePreviewLevel = null;
                            if ((this._fireLevel ?? "unlit") === "unlit") {
                                this.render({ force: true });
                            }
                        }
                    }
                });
            }
            CampfireMakeCampDialog.refreshIfOpen(this);
        } else {
            // Remove camp-specific class when NOT in camp phase (banner height etc.)
            if (this.element) this.element.classList.remove("totm-camp-active");
        }

        // Bind travel activity selects (change event, not click)
        if (this._phase === "travel") {
            if (this._isGM) {
                this.element?.querySelectorAll(".travel-activity-select")?.forEach(sel => {
                    sel.addEventListener("change", () => {
                        const actorId = sel.dataset.actorId;
                        const day = parseInt(sel.dataset.day) || this._travel.activeDay;
                        this._travel.setDeclaration(actorId, sel.value, day);
                        this._broadcastTravelDeclarations();
                        this._saveRestState();
                        this.render();
                    });
                });
            } else {
                this.element?.querySelectorAll(".travel-player-select")?.forEach(sel => {
                    sel.addEventListener("change", () => {
                        const actorId = sel.dataset.actorId;
                        const day = parseInt(sel.dataset.day) || (this._travelActiveDay ?? 1);
                        if (!this._playerTravelDeclarations) this._playerTravelDeclarations = {};
                        if (!this._playerTravelDeclarations[day]) this._playerTravelDeclarations[day] = {};
                        this._playerTravelDeclarations[day][actorId] = sel.value;

                        emitTravelDeclaration({
                    declarations: { [actorId]: sel.value },
                    confirmed: false,
                    day,
                    userId: game.user.id
                });

                        if (this._playerTravelConfirmed?.[day]?.[actorId]) {
                            this._playerTravelConfirmed[day][actorId] = false;
                        }
                        this.render();
                    });
                });

                this.element?.querySelectorAll(".travel-confirm-btn")?.forEach(btn => {
                    btn.addEventListener("click", () => {
                        const actorId = btn.dataset.actorId;
                        const day = parseInt(btn.dataset.day) || (this._travelActiveDay ?? 1);

                        if (!this._playerTravelConfirmed) this._playerTravelConfirmed = {};
                        if (!this._playerTravelConfirmed[day]) this._playerTravelConfirmed[day] = {};
                        this._playerTravelConfirmed[day][actorId] = true;

                        const activity = this._playerTravelDeclarations?.[day]?.[actorId] ?? "nothing";
                        emitTravelDeclaration({
                    declarations: { [actorId]: activity },
                    confirmed: true,
                    day,
                    userId: game.user.id
                });
                        this.render();
                    });
                });
            }
        }

        if (this._phase === "activity" && this._isTotM) {
            // Campfire embed mounts via showTotmCampfirePanel block above.
        } else if (this._phase === "meal" || this._phase === "activity") {
            const drawerContainer = this.element?.querySelector(".campfire-drawer-content");
            if (drawerContainer) {
                this._openCampfire();
                const drawer = this.element?.querySelector(".campfire-drawer");
                if (drawer && !this._campfireCollapsed) {
                    drawer.style.transition = "none";
                    drawer.classList.add("open");
                    requestAnimationFrame(() => {
                        requestAnimationFrame(() => {
                            drawer.style.transition = "";
                        });
                    });
                }
            }
        }

        // GM follow-up input binding (Tier 2 activity pickers)
        const gmFollowUpPanel = this.element.querySelector(".gm-followup");
        if (gmFollowUpPanel) {
            const charId = gmFollowUpPanel.dataset.characterId;
            const inputs = gmFollowUpPanel.querySelectorAll(".gm-followup-input");
            for (const input of inputs) {
                input.addEventListener("change", () => {
                    if (input.type === "radio") {
                        if (input.checked) this._gmFollowUps.set(charId, input.value);
                    } else {
                        this._gmFollowUps.set(charId, input.value);
                    }
                });
            }
            // Auto-set default for first render if no value exists
            if (!this._gmFollowUps.has(charId)) {
                const firstSelect = gmFollowUpPanel.querySelector("select");
                const checkedRadio = gmFollowUpPanel.querySelector("input[type=radio]:checked");
                if (firstSelect?.value) this._gmFollowUps.set(charId, firstSelect.value);
                else if (checkedRadio?.value) this._gmFollowUps.set(charId, checkedRadio.value);
            }
        }

        // Rest type toggle buttons: update hidden input on click
        const restTypeButtons = this.element.querySelectorAll('.rest-type-btn');
        const restTypeInput = this.element.querySelector('[name="restType"]');
        const restTypeHint = this.element.querySelector('.rest-type-hint');
        if (restTypeButtons.length && restTypeInput) {
            const hints = {
                long: "8 hrs. HP and Hit Dice recovery varies by comfort and conditions.",
                short: "1 hr. Spend Hit Dice to heal. Continue to pick a shelter."
            };
            const _applyRestType = (value, rerender) => {
                const isShort = value === "short";
                restTypeInput.value = value;
                this._selectedRestType = value;
                restTypeButtons.forEach(btn => {
                    btn.classList.toggle("active", btn.dataset.restType === value);
                });
                if (restTypeHint) restTypeHint.textContent = hints[value] ?? "";
                const daysBlock = this.element.querySelector(".days-since-rest-block");
                if (daysBlock) daysBlock.style.display = isShort ? "none" : "";
                const envBlock = this.element.querySelector(".scene-environment");
                if (envBlock) envBlock.style.display = isShort ? "none" : "";
                const wxBlock = this.element.querySelector(".scene-weather");
                if (wxBlock) wxBlock.style.display = isShort ? "none" : "";
                const advBlock = this.element.querySelector(".scene-advanced-drawer");
                if (advBlock) advBlock.style.display = isShort ? "none" : "";
                if (rerender) this.render();
            };
            restTypeButtons.forEach(btn => {
                btn.addEventListener("click", () => _applyRestType(btn.dataset.restType, true));
            });
            // Apply initial state from hidden input value (no rerender: avoids binding recursion)
            _applyRestType(restTypeInput.value ?? "long", false);
        }

        // Comfort hint: update on dropdown change
        const comfortSelect = this.element.querySelector('[name="comfort"]');
        const comfortHint = this.element.querySelector('.comfort-hint');
        if (comfortSelect && comfortHint) {
            comfortSelect.addEventListener("change", () => {
                const selected = comfortSelect.options[comfortSelect.selectedIndex];
                comfortHint.textContent = selected?.title ?? "";
            });
        }

        const safeRestSpotCb = this.element.querySelector('input[name="safeRestSpot"]');
        if (safeRestSpotCb && game.user.isGM) {
            safeRestSpotCb.addEventListener("change", async () => {
                try {
                    await game.settings.set(MODULE_ID, "safeRestSpot", !!safeRestSpotCb.checked);
                } catch (e) {

                    console.warn(`${MODULE_ID} | safeRestSpot setting`, e);
                }
                this.render();
            });
        }

        // Rest interface override: writes the world setting so players and the
        // scattered mode checks stay on the same source of truth.
        const restModeSelect = this.element.querySelector('[name="restInterfaceMode"]');
        if (restModeSelect && game.user.isGM) {
            restModeSelect.addEventListener("change", async () => {
                try {
                    await game.settings.set(MODULE_ID, "restInterfaceMode", restModeSelect.value);
                } catch (e) {

                    console.warn(`${MODULE_ID} | restInterfaceMode setting`, e);
                }
                this.render();
            });
        }

        // Terrain change: update weather dropdown options
        const terrainSelect = this.element.querySelector('[name="terrain"]');
        if (terrainSelect) {
            terrainSelect.addEventListener("change", () => {
                this._selectedTerrain = terrainSelect.value;
                this._selectedWeather = this._resolveSetupWeather(this._selectedTerrain);
                this.render();
            });
        }

        // Weather change: re-render to update status line
        const weatherSelect = this.element.querySelector('[name="weather"]');
        if (weatherSelect) {
            weatherSelect.addEventListener("change", () => {
                this._selectedWeather = this._resolveSetupWeather(
                    this._selectedTerrain ?? "forest",
                    weatherSelect.value
                );
                this.render();
            });
        }

        // (Sub-tab and meal auto-consume bindings removed: activity phase uses unified progress panel)

        // Bind identify item buttons
        for (const btn of this.element.querySelectorAll("[data-action='identifyItem']")) {
            btn.addEventListener("click", async (e) => {
                const { itemId, actorId } = e.currentTarget.dataset;
                if (!itemId || !actorId) return;
                await this.identifyItemFromWorkbenchStation(actorId, itemId);
            });
        }

        // Bind click events on activity tiles
        const tiles = this.element.querySelectorAll(".activity-card");
        for (const tile of tiles) {
            tile.addEventListener("click", () => {
                // Activity phase uses station columns; legacy grids used .activity-grid only.
                const host =
                    tile.closest(".activity-grid")
                    || tile.closest(".station-activities")
                    || tile.closest(".character-detail");
                const characterId = host?.dataset?.characterId;
                const activityId = tile.dataset.activityId;
                if (!characterId || !activityId) return;

                // Block if crafting picker is open for this character
                if (this._craftingInProgress?.has(characterId)) return;

                // Crafting tiles: open the crafting drawer directly
                if (tile.dataset.isCrafting === "true") {
                    const syntheticTarget = { dataset: { characterId, profession: tile.dataset.profession } };
                    RestSetupApp.#onOpenCrafting.call(this, null, syntheticTarget);
                    return;
                }

                // Non-crafting tiles: open the detail preview panel
                this._activityDetailId = activityId;
                this.render();
            });
        }

        // Bind confirm buttons (player only)
        const confirmBtns = this.element.querySelectorAll(".btn-confirm-activity");
        for (const btn of confirmBtns) {
            btn.addEventListener("click", async () => {
                const characterId = btn.dataset.characterId;
                const activityId = this._pendingSelections?.get(characterId);
                if (!characterId || !activityId) return;

                // Block if crafting picker is open for this character
                if (this._craftingInProgress?.has(characterId)) return;

                // Check if this is a crafting activity - open picker instead of locking
                const activity = this._activities?.find(a => a.id === activityId);
                if (activity?.crafting?.enabled) {
                    const syntheticTarget = { dataset: { characterId, profession: activity.crafting.profession } };
                    RestSetupApp.#onOpenCrafting.call(this, null, syntheticTarget);
                    this._pendingSelections.delete(characterId);
                    return;
                }

                // Lock and submit
                this._characterChoices.set(characterId, activityId);
                this._lockedCharacters.add(characterId);
                this._pendingSelections.delete(characterId);

                // Early resolve: roll the activity now so the player sees results immediately
                const actor = game.actors.get(characterId);

                // Copy Spell: send proposal via socket instead of resolving immediately
                // This runs outside the _engine guard because players don't have the engine
                if (activityId === "act_scribe" && actor) {
                    const followUpValue = this._gmFollowUps?.get(characterId) ?? this._getFollowUpForCharacter(characterId);
                    const spellLevel = parseInt(followUpValue, 10) || 1;
                    const cost = spellLevel * 50;
                    const dc = 10 + spellLevel;

                    if (game.user.isGM) {
                        // GM initiated: send proposal to player for gold approval
                        CopySpellHandler.sendProposal(characterId, spellLevel);
                    } else {
                        // Player initiated: notify GM
                        emitCopySpellProposal({
                    actorId: characterId,
                    actorName: actor.name,
                    spellLevel,
                    cost,
                    dc,
                    initiatedBy: game.user.name
                });
                    }

                    this._earlyResults.set(characterId, {
                        source: "activity",
                        activityId,
                        result: "pending_approval",
                        narrative: `Level ${spellLevel} spell (${cost}gp, DC ${dc}). Awaiting transaction.`
                    });
                    this.render();
                } else if (activityId === "act_train" && actor && this._engine) {
                    this._initTrainingState(characterId, activityId, actor);
                    ui.notifications.info(`${actor.name}: Training started. Roll your sets in the rest window.`);
                    this.render();
                } else if (actor && this._engine) {
                    const followUpValue = this._gmFollowUps?.get(characterId) ?? this._getFollowUpForCharacter(characterId);
                    this._activityResolver.resolve(
                        activityId, actor, this._engine.terrainTag, this._engine.comfort, {
                            followUpValue,
                            safeRestSpot: !!this._engine.safeRestSpot
                        }
                    ).then(result => {
                        this._earlyResults.set(characterId, result);
                        const tier = result.result === "exceptional" ? "Exceptional!"
                            : result.result === "success" ? "Success"
                            : result.result === "failure_complication" ? "Failed (complication)"
                            : result.result === "failure" ? "Failed" : result.result;
                        const actName = activity?.name ?? activityId;
                        ui.notifications.info(`${actor.name}: ${actName} - ${tier}`);
                        this.render();
                    });
                }

                // Optimistic UI update
                let mySub = this._playerSubmissions.get(game.user.id) || { choices: {}, userName: game.user.name, timestamp: Date.now() };
                mySub.choices[characterId] = activityId;
                this._playerSubmissions.set(game.user.id, mySub);

                emitActivityChoice(
                    game.user.id,
                    Object.fromEntries(this._characterChoices),
                    null,
                    null,
                    this._earlyResults?.size ? Object.fromEntries(this._earlyResults) : null
                );

                const actName = activity?.name ?? activityId;
                ui.notifications.info(`${game.actors.get(characterId)?.name ?? "Character"} will ${actName}.`);
                if (this._phase === "activity" && isStationLayerActive()) {
                    refreshStationEmptyNoticeFade(this);
                    refreshStationPortraitsFromChoices(this._characterChoices, this._stationCanvasIdByCharacter);
                    this._refreshStationOverlayMeals();
                }
                this.render();
            });
        }

        // Roster chip click: switch selected character
        const rosterChips = this.element.querySelectorAll("[data-roster-id]");
        for (const chip of rosterChips) {
            chip.addEventListener("click", () => {
                if (chip.classList.contains("not-owned")) return;
                const charId = chip.dataset.rosterId;
                if (!charId || charId === this._selectedCharacterId) return;
                this._selectedCharacterId = charId;
                closeStationDialogIfDifferentActor(charId);
                this._canvasFocusedStationId = null;
                this._activityDetailId = null;
                this._craftingDrawerOpen = false;
                // Collapse any expanded TotM detail/crafting panel on character switch
                this._totmFollowUpExpanded = null;
                this._resetTotmCraftState();
                if (isStationLayerActive()) {
                    if (!this._isGM) this._refreshStationOverlayForFocusChange();
                    else {
                        refreshStationEmptyNoticeFade(this);
                        this._refreshStationOverlayMeals();
                    }
                }
                this.render();
            });
        }

        // AFK checkboxes (both GM and player)
        this._bindArmorToggleHandlers(this.element);

    }

    // â”€â”€â”€â”€â”€â”€â”€â”€ Static action handlers â”€â”€â”€â”€â”€â”€â”€â”€

    /**
     * Toggle a shelter option in the setup form.
     */
    static #onToggleShelter(event, target) {
        const shelterId = target.dataset.shelterId;
        if (!shelterId) return;
        if (!this._shelterOverrides) this._shelterOverrides = {};

        // Radio-style: deselect all others, toggle the clicked one
        const wasActive = !!this._shelterOverrides[shelterId];
        for (const key of Object.keys(this._shelterOverrides)) {
            this._shelterOverrides[key] = false;
        }
        this._shelterOverrides[shelterId] = !wasActive;

        this.render();
    }

    /** Setup wizard: advance to next section, capturing form values. */
    static #onSetupContinue(event, target) {
        const step = parseInt(target.dataset.step, 10);
        const form = this.element.querySelector("form");
        const formData = form ? Object.fromEntries(new FormData(form)) : {};

        if (step === 1) {
            this._selectedTerrain = formData.terrain ?? this._selectedTerrain ?? "forest";
            this._selectedRestType = formData.restType ?? "long";
            const terrainOpt = this.element.querySelector('[name="terrain"] option:checked');
            this._terrainLabel = terrainOpt?.textContent?.trim()?.replace(" (last used)", "") ?? this._selectedTerrain;
            // Persist last-used terrain
            game.settings.set(MODULE_ID, "lastTerrain", this._selectedTerrain);
            this._daysSinceLastRest = this._daysSinceLastRest ?? 1;

            // Short rest: advance to shelter step (step 2) instead of bypassing entirely
            if (this._selectedRestType === "short") {
                if (!this._shelterOverrides) this._shelterOverrides = {};
                this._setupStep = 2;
                this.render();
                return;
            }
        } else if (step === 2) {
            this._selectedWeather = formData.weather ?? "clear";
            this._selectedComfort = formData.comfort ?? "sheltered";
            // Skip shelter for tavern
            if (this._selectedTerrain === "tavern") {
                this._setupStep = 3;
                this.render();
                return;
            }
        }

        this._setupStep = step + 1;
        this.render();
    }

    /** Setup wizard: go back to a previous section. */
    static #onSetupBack(event, target) {
        const step = parseInt(target.dataset.step, 10);
        this._setupStep = step;
        this.render();
    }

    /** Adjust days since last rest via +/- stepper buttons. */
    static #onAdjustDaysSinceRest(event, target) {
        const delta = parseInt(target.dataset.delta, 10) || 0;
        this._daysSinceLastRest = Math.max(1, Math.min(9, (this._daysSinceLastRest ?? 1) + delta));
        this.render();
    }

    /** Setup wizard: skip to section 3 with defaults. */
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

    /**
     * Player action: roll a camp activity check (Set Up Defenses, Scout Perimeter).
     * Mirrors the event roll check pattern.
     */
    static async #onRollCampCheck(event, target) {
        event.preventDefault?.();
        const characterId = target.dataset.characterId;
        const pending = this._pendingCampRoll;
        if (!pending || !characterId) return;

        const activityEntry = pending.activities?.find(a => a.characterId === characterId);
        if (!activityEntry) return;

        const actor = game.actors.get(characterId);
        if (!actor || !actor.isOwner) return;

        if (pending.rolledCharacters?.has(characterId)) return;

        const flavor = `<strong>${actor.name}</strong> - ${activityEntry.activityName} (${activityEntry.skillName}) DC ${activityEntry.dc}`;
        const { total } = await executePlayerRoll(
            actor,
            activityEntry.skill,
            activityEntry.dc,
            flavor,
            target
        );

        if (!pending.rolledCharacters) pending.rolledCharacters = new Set();
        pending.rolledCharacters.add(characterId);

        emitCampRollResult({
                    characterId,
                    characterName: actor.name,
                    activityId: activityEntry.activityId,
                    total
                });

        ui.notifications.info(`${actor.name} rolled ${total} for ${activityEntry.activityName}.`);
        this.render();
    }

    /**
     * GM adjusts camp activity DC for a specific character.
     */
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

    /**
     * GM requests a camp activity roll from a specific player.
     */
    static #onRequestCampRoll(event, target) {
        event.preventDefault?.();
        if (!game.user.isGM) return;

        const characterId = target.dataset.characterId;
        if (!characterId) return;

        const entry = this._pendingCampRolls?.find(p => p.characterId === characterId);
        if (!entry || entry.status !== "pending") return;

        // Mark as requested so controls disable and snapshot only sends released entries
        entry.requested = true;

        emitPhaseChanged("events", {
                eventsRolled: this._eventsRolled ?? false,
                fireLevel: this._fireLevel,
                campStatus: this._campStatus,
                campRollRequest: {
                    activities: [{
                        characterId: entry.characterId,
                        activityId: entry.activityId,
                        activityName: entry.activityName,
                        skill: entry.skill,
                        skillName: entry.skillName,
                        dc: entry.dc,
                        status: entry.status,
                        total: entry.total
                    }]
                }
            });

        ui.notifications.info(`Roll request sent to ${entry.characterName} for ${entry.activityName}.`);
        this.render();
    }


    /**
     * GM receives a camp activity roll result from a player.
     * Updates _pendingCampRolls, consumes effects, re-renders.
     */
    receiveCampRollResult(data) {
        if (!this._pendingCampRolls) return;

        const entry = this._pendingCampRolls.find(
            p => p.characterId === data.characterId && p.activityId === data.activityId
        );
        if (!entry) return;

        entry.total = data.total;
        entry.status = data.total >= entry.dc ? "pass" : "fail";

        // Look up the activity for narrative/effect data
        const activity = this._activities?.find(a => a.id === data.activityId);
        const outcomeKey = entry.status === "pass" ? "success" : "failure";
        const outcome = activity?.outcomes?.[outcomeKey];

        // Store narrative and effects on the pending entry for GM display
        entry.narrative = outcome?.narrative ?? "";
        entry.effectDescriptions = (outcome?.effects ?? []).map(e => e.description).filter(Boolean);

        // Consume encounter_reduction effect for Set Up Defenses success
        if (entry.status === "pass" && entry.activityId === "act_defenses") {
            const defenseMod = 2; // encounter_reduction value from activity data
            if (this._engine?._encounterBreakdown) {
                this._engine._encounterBreakdown.defenses = (this._engine._encounterBreakdown.defenses ?? 0) + defenseMod;
            }
        }

        // Store early result so it's not re-rolled at resolution
        this._earlyResults.set(data.characterId, {
            source: "activity",
            activityId: data.activityId,
            result: entry.status === "pass" ? "success" : "failure",
            total: data.total,
            effects: outcome?.effects ?? [],
            narrative: entry.narrative
        });

        // Check if all camp rolls are resolved
        const allDone = this._pendingCampRolls.every(p => p.status !== "pending");

        // Broadcast updated state to players
        emitPhaseChanged("events", {
                eventsRolled: this._eventsRolled ?? false,
                fireLevel: this._fireLevel,
                campStatus: this._campStatus,
                campRollsUpdate: this._pendingCampRolls.map(p => ({
                    characterId: p.characterId,
                    activityName: p.activityName,
                    status: p.status,
                    total: p.total,
                    narrative: p.narrative ?? "",
                    effectDescriptions: p.effectDescriptions ?? []
                }))
            });

        this.render();
    }

    /**
     * Resolve a skill check event. Auto-rolls using the best watcher's modifier,
     * or force-sets the outcome if GM overrides.
     */
    /**
     * GM nudges an event check DC before requesting rolls. Local-only until the
     * roll request is broadcast, so players never see the DC change mid-adjust.
     */
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

    /**
     * GM clicks a contributor's portrait to cycle their roll mode for this event.
     * Order: normal -> advantage -> disadvantage -> normal. Local until rolls are
     * requested; the active modes ride along in the roll request broadcast.
     */
    static #onCycleEventRollMode(event, target) {
        event.preventDefault?.();
        if (!game.user.isGM) return;

        const eventIndex = parseInt(target.dataset.eventIndex ?? target.closest("[data-event-index]")?.dataset.eventIndex);
        const characterId = target.dataset.characterId;
        const triggeredEvent = this._triggeredEvents?.[eventIndex];
        if (!triggeredEvent?.mechanical || !characterId || triggeredEvent.awaitingRolls || triggeredEvent.resolvedOutcome) return;

        if (!triggeredEvent.rollModes) triggeredEvent.rollModes = {};
        const CYCLE = { normal: "advantage", advantage: "disadvantage", disadvantage: "normal" };
        const current = triggeredEvent.rollModes[characterId] ?? "normal";
        const next = CYCLE[current] ?? "advantage";
        triggeredEvent.rollModes[characterId] = next;

        // Update the portrait in place. A full re-render would reset the scroll
        // position; this is a local toggle only consumed when rolls are requested.
        const button = target.closest(".check-avatar") ?? target;
        button.classList.toggle("adv", next === "advantage");
        button.classList.toggle("dis", next === "disadvantage");
        const name = button.getAttribute("data-tooltip")?.split(" \u00b7 ")[0] ?? "";
        const modeLabel = next === "advantage" ? "Advantage" : next === "disadvantage" ? "Disadvantage" : "Normal";
        button.setAttribute("data-tooltip", `${name} \u00b7 ${modeLabel} (click to change)`);
        button.querySelector(".check-avatar-mode")?.remove();
        if (next !== "normal") {
            const badge = document.createElement("span");
            badge.className = `check-avatar-mode ${next === "advantage" ? "adv" : "dis"}`;
            badge.innerHTML = `<i class="fas fa-angle-${next === "advantage" ? "up" : "down"}"></i>`;
            button.appendChild(badge);
        }
    }

    static async #onResolveSkillCheck(event, target) {
        if (!game.user.isGM) return;
        event.preventDefault?.();

        const eventIndex = parseInt(target.dataset.eventIndex ?? target.closest("[data-event-index]")?.dataset.eventIndex);
        const outcomeMode = target.dataset.outcome ?? target.closest("[data-outcome]")?.dataset.outcome ?? "auto";
        const triggeredEvent = this._triggeredEvents?.[eventIndex];
        if (!triggeredEvent || !triggeredEvent.mechanical) return;

        // Block if another event is currently awaiting rolls (prevent multi-event collision)
        const anotherAwaiting = (this._triggeredEvents ?? []).some(
            (e, i) => i !== eventIndex && e.awaitingRolls
        );
        if (anotherAwaiting) {
            ui.notifications.warn("Resolve the current event check before starting another.");
            return;
        }

        const dc = triggeredEvent.mechanical.dc ?? 10;
        const skill = triggeredEvent.mechanical.skill ?? "sur";

        const skillKey = skill;

         let outcome = outcomeMode;

        if (outcomeMode === "auto") {
            // Instead of rolling here, broadcast a roll request to players
            const watchIds = triggeredEvent.targets ?? [];
            const actors = watchIds.length > 0
                ? watchIds.map(id => game.actors.get(id)).filter(Boolean)
                : getPartyActors();

            const pendingRolls = actors.map(a => a.id);
            triggeredEvent.awaitingRolls = true;
            triggeredEvent.pendingRolls = [...pendingRolls];
            triggeredEvent.resolvedRolls = [];

            const skillName = SKILL_NAMES[skill] ?? skill;

            // Broadcast roll request to players
            emitEventRollRequest({
                    eventIndex,
                    skill: skillKey,
                    skillName,
                    dc,
                    targets: pendingRolls,
                    rollModes: triggeredEvent.rollModes ?? {},
                    eventTitle: triggeredEvent.title ?? "Event",
                    targetLabel: buildRollTargetLabel(triggeredEvent.mechanical)
                });

            // Also broadcast the updated event state so players see the pending UI
            emitPhaseChanged("events", {
                    triggeredEvents: this._triggeredEvents,
                    activeTreeState: this._activeTreeState,
                    eventsRolled: true,
                    campStatus: this._campStatus
                });

            await this._saveRestState();
            this.render();
            return; // Wait for player results via receiveRollResult
        }

        // Force Pass/Fail: resolve immediately. Clear any awaiting-roll state so
        // allEventChecksResolved flips true (Proceed unblocks) and players stop
        // showing roll buttons on the next broadcast.
        triggeredEvent.resolvedOutcome = outcome;
        triggeredEvent.awaitingRolls = false;
        triggeredEvent.pendingRolls = [];

        // Broadcast to players
        emitPhaseChanged("events", {
                triggeredEvents: this._triggeredEvents,
                activeTreeState: this._activeTreeState,
                eventsRolled: true,
                campStatus: this._campStatus
            });

        await this._saveRestState();
        this.render();
    }

    /**
     * GM locks a single failed-event consequence ahead of resolution.
     *
     * Damage effects roll their target(s) and amount now, but the HP loss is
     * applied on the far side of the rest (after recovery) so the night's
     * healing cannot erase it. Resource losses are locked for the same pass.
     * Rolled values are stamped on the shared effect object so RecoveryHandler
     * skips its own auto-roll and #onResolveEvents applies them post-recovery.
     * Re-invoking on an already locked effect re-rolls it.
     */
    static async #onLockEventConsequence(event, target) {
        if (!game.user.isGM) return;
        event.preventDefault?.();

        const eventIndex = parseInt(target.dataset.eventIndex);
        const effectIndex = parseInt(target.dataset.effectIndex);
        const te = this._triggeredEvents?.[eventIndex];
        if (!te || !te.mechanical) return;

        const TIER_MAP = { triumph: "onTriumph", success: "onSuccess", mixed: "onMixed", failure: "onFailure" };
        const tierKey = TIER_MAP[te.resolvedOutcome] ?? "onFailure";
        const block = te.mechanical[tierKey] ?? te.mechanical.onFailure ?? {};
        const effect = block.effects?.[effectIndex];
        if (!effect) return;

        if (effect.type === "damage") {
            // Build the target pool with the same watch/sleeping semantics as
            // RecoveryHandler._resolveEventScopes, using the live watch roster.
            const party = getPartyActors();
            const allIds = party.map(a => a.id);
            const watchIds = new Set((this._engine?.watchRoster ?? []).map(w => w.characterId));
            const awakeIds = allIds.filter(id => watchIds.has(id));
            const sleepingIds = allIds.filter(id => !watchIds.has(id));
            const poolFor = (pool) => pool === "awake" ? (awakeIds.length ? awakeIds : allIds)
                : pool === "sleeping" ? (sleepingIds.length ? sleepingIds : allIds)
                    : allIds;

            const scope = effect.scope ?? "all";
            let targetIds = [];
            if (scope === "random" || scope === "randomTarget") {
                const spec = effect.randomTarget ?? {};
                const pool = poolFor(spec.pool ?? "all");
                const count = await RestSetupApp.#evaluateLockCount(spec.count, pool.length);
                targetIds = RestSetupApp.#pickRandomN(pool, count);
            } else if (scope === "failed") {
                targetIds = (te.resolvedRolls ?? [])
                    .filter(r => r && r.passed === false)
                    .map(r => r.characterId)
                    .filter(Boolean);
            } else {
                targetIds = allIds;
            }

            const lockedTargets = [];
            for (const id of targetIds) {
                const actor = game.actors.get(id);
                if (!actor) continue;
                let amount = 0;
                try {
                    const roll = await new Roll(effect.formula ?? "0").evaluate();
                    amount = roll.total;
                    await roll.toMessage({
                        speaker: { alias: te.name ?? "Rest Event" },
                        flavor: `<strong>${actor.name}</strong>: ${effect.formula} ${effect.damageType ?? ""} damage (applied after the rest)`,
                        whisper: game.users.filter(u => u.isGM).map(u => u.id)
                    });
                } catch (e) {

                    console.warn(`${MODULE_ID} | Failed to roll locked consequence damage:`, e);
                }
                lockedTargets.push({ id, name: actor.name, amount });
            }

            effect._resolvedTargetIds = targetIds;
            effect._lockedDamage = Object.fromEntries(lockedTargets.map(t => [t.id, t.amount]));
            effect._lockedTargets = lockedTargets;
            effect._locked = true;
        } else if (effect.type === "consume_resource") {
            // Roll and freeze the exact loss now so the locked breakdown is what
            // actually lands after the rest (no re-roll at resolution). The
            // abstract "supplies" resource expands into a composite proposal
            // (provisions + gear at risk); concrete keys (rations/water) stay
            // a simple bulk loss.
            const proposal = effect.resource === "supplies"
                ? await ResourceSink.proposeSuppliesLoss(effect, { characters: getPartyActors() })
                : await ResourceSink.proposeConsumeResource(effect, { characters: getPartyActors() });
            effect._lockedLoss = proposal;
            effect._locked = true;

            const parts = [];
            for (const grp of (proposal.provisionGroups ?? [])) {
                const lines = grp.entries
                    .map(e => `${e.actorName} &times;${e.lossQty}`)
                    .join(", ");
                parts.push(`<p><strong>${grp.total}</strong> ${grp.kind} lost: ${lines}</p>`);
            }
            if (proposal.gear?.length) {
                const gearLines = proposal.gear
                    .map(g => `${g.actorName}: ${g.itemName}${g.lossQty > 1 ? ` &times;${g.lossQty}` : ""}`)
                    .join("<br>");
                parts.push(`<p><strong>Gear lost from the pack:</strong></p><p>${gearLines}</p>`);
            }
            if (parts.length) {
                await ChatMessage.create({
                    speaker: { alias: te.name ?? "Rest Event" },
                    whisper: game.users.filter(u => u.isGM).map(u => u.id),
                    content: `${parts.join("")}<p><em>Applied after the rest.</em></p>`
                });
            }
        } else if (effect.type === "item_at_risk") {
            // Roll which specific items go missing now and freeze them to ids, so
            // the same items leave the packs at resolution regardless of inventory
            // churn. Re-invoking re-rolls the selection.
            const proposal = await ResourceSink._resolveItemAtRisk(effect, { characters: getPartyActors() });
            const lockedItems = (proposal.candidates ?? []).map(c => ({
                actorId: c.actor.id,
                actorName: c.actor.name,
                itemId: c.item.id,
                itemName: c.item.name,
                itemImg: c.item.img ?? "icons/svg/mystery-man.svg",
                currentQty: c.currentQty,
                lossQty: c.lossQty
            }));
            effect._lockedItems = lockedItems;
            effect._locked = true;

            if (lockedItems.length) {
                const lines = lockedItems
                    .map(i => `${i.actorName}: ${i.itemName}${i.lossQty > 1 ? ` &times;${i.lossQty}` : ""}`)
                    .join("<br>");
                await ChatMessage.create({
                    speaker: { alias: te.name ?? "Rest Event" },
                    whisper: game.users.filter(u => u.isGM).map(u => u.id),
                    content: `<p><strong>Taken from the packs:</strong></p><p>${lines}</p><p><em>Applied after the rest.</em></p>`
                });
            } else {
                await ChatMessage.create({
                    speaker: { alias: te.name ?? "Rest Event" },
                    whisper: game.users.filter(u => u.isGM).map(u => u.id),
                    content: `<p><em>Nothing worth taking was within reach.</em></p>`
                });
            }
        } else if (effect.type === "consume_gold") {
            // Roll and freeze the coin taken now so the locked amount is what
            // leaves the purses at resolution. Re-invoking re-rolls it.
            const proposal = await ResourceSink.proposeGoldLoss(effect, { characters: getPartyActors() });
            effect._lockedGold = proposal;
            effect._locked = true;

            if (proposal.totalLoss > 0) {
                const lines = (proposal.breakdown ?? [])
                    .map(b => `${b.actorName}: &minus;${b.lossGp} gp`)
                    .join("<br>");
                await ChatMessage.create({
                    speaker: { alias: te.name ?? "Rest Event" },
                    whisper: game.users.filter(u => u.isGM).map(u => u.id),
                    content: `<p><strong>Coin lifted:</strong> ${proposal.totalLoss} gp</p><p>${lines}</p><p><em>Applied after the rest.</em></p>`
                });
            } else {
                await ChatMessage.create({
                    speaker: { alias: te.name ?? "Rest Event" },
                    whisper: game.users.filter(u => u.isGM).map(u => u.id),
                    content: `<p><em>No coin in the purses to lift.</em></p>`
                });
            }
        } else if (effect.type === "supply_loss") {
            // Roll and freeze how much of the supply pool is swept away now, so
            // the locked breakdown is what actually leaves the packs at
            // resolution. Re-invoking re-rolls it. Used by disaster outcomes.
            const proposal = await ResourceSink.proposeSupplyLoss(effect, { characters: getPartyActors() });
            effect._lockedSupply = proposal;
            effect._locked = true;

            if (proposal.totalLoss > 0) {
                const lines = (proposal.breakdown ?? [])
                    .map(b => `${b.actorName}: ${b.itemName ?? "supplies"}${b.lossQty > 1 ? ` &times;${b.lossQty}` : ""}`)
                    .join("<br>");
                await ChatMessage.create({
                    speaker: { alias: te.name ?? "Rest Event" },
                    whisper: game.users.filter(u => u.isGM).map(u => u.id),
                    content: `<p><strong>Lost to the disaster:</strong></p><p>${lines}</p><p><em>Applied after the rest.</em></p>`
                });
            } else {
                await ChatMessage.create({
                    speaker: { alias: te.name ?? "Rest Event" },
                    whisper: game.users.filter(u => u.isGM).map(u => u.id),
                    content: `<p><em>No supplies on hand to lose.</em></p>`
                });
            }
        } else {
            return;
        }

        await this._saveRestState();
        emitPhaseChanged("events", {
            triggeredEvents: this._triggeredEvents,
            activeTreeState: this._activeTreeState,
            eventsRolled: true,
            campStatus: this._campStatus
        });
        this.render();
    }

    /** Evaluate a randomTarget count spec (number, numeric string, or dice formula). */
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

    /** Fisher-Yates pick of N distinct entries from a pool. */
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

    /**
     * GM receives a skill check roll result from a player.
     * Collects results and auto-resolves when all expected rolls are in.
     */
    /** @deprecated Thin proxy â€” delegates to EventsPhaseDelegate */
    async receiveRollResult(data) {
        return this._events.receiveRollResult(data);
    }

    /**
     * Player receives a roll request from the GM.
     * Stores the request so the template can show Roll buttons for owned characters.
     */
    /** @deprecated Thin proxy â€” delegates to EventsPhaseDelegate */
    receiveRollRequest(data) {
        return this._events.receiveRollRequest(data);
    }

    /**
     * Player receives a tree roll request from the GM.
     * Stores the request so the template can show Roll buttons for owned characters.
     */
    /** @deprecated Thin proxy â€” delegates to EventsPhaseDelegate */
    receiveTreeRollRequest(data) {
        return this._events.receiveTreeRollRequest(data);
    }

    /**
     * Player action: roll a decision tree skill check for an owned character.
     * Posts the roll to chat and sends the result back to the GM.
     * Respects rollMode (advantage/disadvantage/force-pass/force-fail).
     */
    static async #onRollTreeCheck(event, target) {
        event.preventDefault?.();
        const characterId = target.dataset.characterId;
        const pending = this._pendingTreeRoll;
        if (!pending || !characterId) return;

        const actor = game.actors.get(characterId);
        if (!actor) return;

        if (!actor.isOwner) {
            ui.notifications.warn("You do not own this character.");
            return;
        }

        // Already rolled?
        if (pending.rolledCharacters?.has(characterId)) return;

        const rollMode = pending.rollModes?.[characterId] ?? "normal";
        const dc = pending.dc;

        // Force outcomes: send a synthetic total without rolling dice
        if (rollMode === "force-pass" || rollMode === "force-fail") {
            const total = rollMode === "force-pass" ? dc : 0;
            if (!pending.rolledCharacters) pending.rolledCharacters = new Set();
            pending.rolledCharacters.add(characterId);
            if (!pending.rolledResults) pending.rolledResults = new Map();
            pending.rolledResults.set(characterId, { total, passed: rollMode === "force-pass" });
            emitTreeRollResult({
                    characterId,
                    characterName: actor.name,
                    total
                });
            ui.notifications.info(`${actor.name}: ${rollMode === "force-pass" ? "Auto-success" : "Auto-fail"} applied.`);
            this.render();
            return;
        }

        const skill = pickBestSkill(actor, pending.skills);
        const modeLabel = rollMode === "advantage" ? " [Advantage]" : rollMode === "disadvantage" ? " [Disadvantage]" : "";
        const flavor = `<strong>${actor.name}</strong> - ${pending.eventName} (${pending.skillName}) DC ${dc}${modeLabel}`;
        const { total } = await executePlayerRoll(actor, skill, dc, flavor, target, rollMode);

        // Mark as rolled locally and store result for display
        if (!pending.rolledCharacters) pending.rolledCharacters = new Set();
        pending.rolledCharacters.add(characterId);
        if (!pending.rolledResults) pending.rolledResults = new Map();
        pending.rolledResults.set(characterId, { total, passed: total >= dc });

        // Send result to GM
        emitTreeRollResult({
                    characterId,
                    characterName: actor.name,
                    total
                });

        ui.notifications.info(`${actor.name} rolled ${total} for ${pending.skillName}.`);
        this.render();
    }

    /**
     * Converts \n\n-delimited guidance text into <p> tags for paragraph styling.
     * @param {string} text - Raw gmGuidance string.
     * @returns {string} HTML string.
     */
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

    /**
     * Opens (or repositions) the GM guidance flyout, anchored to the left edge
     * of the Foundry app window. Creates the body-level singleton on first call.
     * @param {HTMLElement} triggerEl - The button that triggered the open.
     * @param {string} guidanceHtml - Formatted HTML content for the flyout body.
     */
    static #openGmGuidanceFlyout(triggerEl, guidanceHtml) {
        const FLYOUT_ID = "ionrift-gm-guidance-flyout";
        let flyout = document.getElementById(FLYOUT_ID);

        if (!flyout) {
            flyout = document.createElement("div");
            flyout.id = FLYOUT_ID;
            flyout.className = "tree-gm-sidebar";
            flyout.innerHTML = `
                <div class="tree-gm-sidebar-header">
                    <span><i class="fas fa-book-reader"></i> GM Guidance</span>
                    <button type="button" class="tree-gm-sidebar-close"><i class="fas fa-times"></i></button>
                </div>
                <div class="tree-gm-sidebar-body"></div>
            `;
            document.body.appendChild(flyout);
            flyout.querySelector(".tree-gm-sidebar-close").addEventListener("click", () => {
                flyout.classList.remove("open");
                // Clear active state on whichever button opened it
                document.querySelectorAll(".tree-gm-notes-btn.active").forEach(b => b.classList.remove("active"));
            });
        }

        flyout.querySelector(".tree-gm-sidebar-body").innerHTML = guidanceHtml;

        // Anchor flyout: right of window (X), level with the button (Y)
        const windowEl = triggerEl.closest(".ionrift-window");
        const windowRect = windowEl?.getBoundingClientRect() ?? triggerEl.getBoundingClientRect();
        const btnRect = triggerEl.getBoundingClientRect();

        const applyPosition = (wRect, bTopOffset) => {
            flyout.style.left = `${wRect.right + 4}px`;
            flyout.style.top  = `${Math.max(8, Math.min(wRect.top + bTopOffset, window.innerHeight - 400))}px`;
        };

        // Store the button's vertical offset relative to the window top
        const btnTopOffset = btnRect.top - windowRect.top;
        applyPosition(windowRect, btnTopOffset);

        // Track window drag â€” reposition flyout whenever the window moves
        if (flyout._dragObserver) flyout._dragObserver.disconnect();
        if (windowEl) {
            flyout._dragObserver = new MutationObserver(() => {
                if (!flyout.classList.contains("open")) return;
                applyPosition(windowEl.getBoundingClientRect(), btnTopOffset);
            });
            flyout._dragObserver.observe(windowEl, { attributes: true, attributeFilter: ["style"] });
        }

        // Disconnect observer when flyout is closed
        flyout.querySelector(".tree-gm-sidebar-close").addEventListener("click", () => {
            flyout._dragObserver?.disconnect();
        }, { once: true });

        flyout.classList.add("open");
    }

    /**
     * GM action: toggle the GM Guidance flyout.
     */
    static #onToggleGmGuidance(event, target) {
        event.preventDefault?.();
        const FLYOUT_ID = "ionrift-gm-guidance-flyout";
        const flyout = document.getElementById(FLYOUT_ID);

        // If already open, close it and clear button state
        if (flyout?.classList.contains("open")) {
            flyout.classList.remove("open");
            document.querySelectorAll(".tree-gm-notes-btn.active").forEach(b => b.classList.remove("active"));
            return;
        }

        // Get guidance text from the hidden data holder in the tree
        const tree = target.closest(".respite-decision-tree");
        if (!tree) return;
        const raw = tree.querySelector(".tree-gm-sidebar-body")?.textContent?.trim();
        if (!raw) return;

        target.classList.add("active");
        RestSetupApp.#openGmGuidanceFlyout(target, RestSetupApp.#formatGmGuidance(raw));
    }

    /** @override */
    _onRender(context, options) {
        super._onRender?.(context, options);
        this._onRenderBindings(context, options);
        centerRollRequestRoster(this.element);
        ensureDcPulseAnimation(this.element);

        // Belt-and-braces: the rejoin bar's only job is to reopen this window.
        // If we just rendered, the bar is by definition stale. Clear it to
        // prevent the "main UI + collapsed footer" double state during F5
        // rejoin races. Stations + activity phase doesn't render the player
        // RSA, so this only fires in modes/phases where the bar is wrong.
        if (!this._isGM) {
            _removeRejoinBar();
        }

        const titleEl =
            this.element?.querySelector(".window-header .window-title")
            ?? this.element?.querySelector(".window-title")
            ?? this.element?.querySelector("header.window-header h4");
        if (titleEl) {
            let t = "Respite: Rest Phase";
            if (this._phase === "activity" && this._isGM) t = "Respite: GM overview";
            else if (this._phase === "activity" && !this._isGM) t = "Respite: Party progress";
            titleEl.textContent = t;
        }

        {
            const rosterPhases = new Set(["camp", "travel", "activity", "meal"]);
            if (rosterPhases.has(this._phase)) this._installGmStationTokenSyncHook();
            else this._removeGmStationTokenSyncHook();
        }

    }

    /**
     * Unified player roll action. Routes to flow-specific handlers.
     */
    static async #onIonriftRoll(event, target) {
        event.preventDefault?.();
        const flow = target.dataset.flow ?? "event";
        // Preserve the application instance as `this`; these sub-handlers read
        // per-instance pending-roll state (this._pendingTreeRoll, etc.).
        switch (flow) {
            case "event":
                return RestSetupApp.#onRollEventCheck.call(this, event, target);
            case "tree":
                return RestSetupApp.#onRollTreeCheck.call(this, event, target);
            case "camp":
                return RestSetupApp.#onRollCampCheck.call(this, event, target);
            case "travel":
                return RestSetupApp.#onRollTravelCheck.call(this, event, target);
            case "copySpell":
                return RestSetupApp.#onRollCopySpellArcana.call(this, event, target);
            default:
                return undefined;
        }
    }

    /**
     * Player action: roll a skill check for an owned character.
     * Posts the roll to chat and sends the result back to the GM.
     */
    static async #onRollEventCheck(event, target) {
        event.preventDefault?.();
        const characterId = target.dataset.characterId;
        const pending = this._pendingEventRoll;
        if (!pending || !characterId) return;

        const actor = game.actors.get(characterId);
        if (!actor) return;

        // Verify this player owns this actor
        if (!actor.isOwner) {
            ui.notifications.warn("You do not own this character.");
            return;
        }

        // Already rolled?
        if (pending.rolledCharacters?.has(characterId)) return;

        const rollMode = pending.rollModes?.[characterId] ?? "normal";
        const modeLabel = rollMode === "advantage" ? " [Advantage]" : rollMode === "disadvantage" ? " [Disadvantage]" : "";
        const flavor = `<strong>${actor.name}</strong> attempts ${pending.skillName} check (DC ${pending.dc})${modeLabel}`;

        const { total } = await executePlayerRoll(
            actor,
            pending.skill,
            pending.dc,
            flavor,
            target,
            rollMode
        );

        // Mark as rolled locally and store the result so the player's own DC badge can
        // acknowledge pass/fail immediately, before the GM's resolved snapshot syncs back.
        if (!pending.rolledCharacters) pending.rolledCharacters = new Set();
        pending.rolledCharacters.add(characterId);
        if (!pending.rolledResults) pending.rolledResults = new Map();
        pending.rolledResults.set(characterId, { total, passed: total >= pending.dc });

        // Send result to GM
        emitEventRollResult({
                    eventIndex: pending.eventIndex,
                    characterId,
                    characterName: actor.name,
                    total
                });

        ui.notifications.info(`${actor.name} rolled ${total} for ${pending.skillName}.`);
        this.render();
    }

    /**
     * Grant a discovered item to a selected actor.
     * Rolls quantity dice, creates item on actor sheet via ItemOutcomeHandler.
     */
    static async #onGrantDiscoveryItem(event, target) {
        if (!game.user.isGM) return;

        const grantKey = target.dataset.grantKey;
        const itemRef = target.dataset.itemRef;
        const quantity = target.dataset.quantity;

        // Find the sibling select element for actor selection
        const row = target.closest(".party-discovery-item");
        const select = row?.querySelector(".discovery-actor-select");
        const actorId = select?.value;

        if (!actorId || !itemRef) {
            ui.notifications.warn("Select a character to receive the items.");
            return;
        }

        try {
            const { ItemOutcomeHandler } = await import("../services/ItemOutcomeHandler.js");
            const colon = grantKey.indexOf(":");
            const eventId = colon >= 0 ? grantKey.slice(0, colon) : grantKey;
            const ref = colon >= 0 ? grantKey.slice(colon + 1) : itemRef;
            const result = await ItemOutcomeHandler.grantToActor(actorId, itemRef, quantity, {
                ledger: this._grantLedger,
                slotKey: GrantLedger.discoverySlotKey(eventId, ref)
            });
            ui.notifications.info(`Granted ${result.rolled}x ${result.itemName} to ${result.actorName}.`);
            this.render();
        } catch (e) {

            console.error(`[Respite] Failed to grant item:`, e);
            ui.notifications.error(`Failed to grant ${itemRef}: ${e.message}`);
        }
    }

    /**
     * Writes training XP onto each actor's sheet. Scans resolved outcomes for
     * `training_xp` effects and adds the already-reduced value to the dnd5e XP
     * track. Runs GM-side so updates to any party member are permitted.
     *
     * @param {Object[]} outcomes Resolved per-character outcome records.
     */
    static async _applyTrainingXP(outcomes) {
        if (!Array.isArray(outcomes) || !outcomes.length) return;

        for (const outcome of outcomes) {
            const award = (outcome.outcomes ?? [])
                .filter(sub => sub.source === "activity")
                .flatMap(sub => sub.effects ?? [])
                .filter(eff => eff.type === "training_xp")
                .reduce((sum, eff) => sum + (eff.value ?? 0), 0);
            if (award <= 0) continue;

            const actor = game.actors.get(outcome.characterId);
            if (!actor) continue;

            const current = actor.system?.details?.xp?.value ?? 0;
            try {
                await actor.update({ "system.details.xp.value": current + award });
            } catch (e) {

                console.warn(`${MODULE_ID} | Failed to apply ${award} training XP to ${actor.name}:`, e);
            }
        }
    }

    /**
     * Builds a segmented training progress bar for chat summaries. One segment
     * per set, filled when the set landed, plus the XP gained and any
     * diminishing-returns note.
     *
     * @param {Object} training The `training` payload from a training outcome.
     * @returns {string} HTML markup.
     */
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

    /**
     * Auto-grants party discovery items (event loot) to watch roster members.
     * Single watcher â†’ all items. Multiple watchers â†’ round-robin random distribution.
     * Falls back to full party if nobody is on watch.
     */
    async _autoGrantPartyDiscoveries() {
        if (!this._outcomes?.length) return;

        // Collect ungranted discovery items
        const discoveries = [];
        const seenEvents = new Set();
        for (const o of this._outcomes) {
            for (const sub of (o.outcomes ?? [])) {
                if (sub.source === "event" && sub.items?.length && !seenEvents.has(sub.eventId)) {
                    seenEvents.add(sub.eventId);
                    for (const item of sub.items) {
                        const grantKey = `${sub.eventId}:${item.itemRef ?? item.name}`;
                        if (!this._hasDiscoveryGrant(grantKey)) {
                            discoveries.push({
                                grantKey,
                                itemRef: item.itemRef ?? item.name,
                                quantity: item.quantity ?? 1
                            });
                        }
                    }
                }
            }
        }
        if (discoveries.length === 0) return;

        // Build eligible recipient pool: watch roster first, fall back to all party
        let recipientIds = (this._engine?.watchRoster ?? []).map(w => w.characterId);
        if (recipientIds.length === 0) {
            recipientIds = getPartyActors().map(a => a.id);
        }
        // Validate actors exist
        recipientIds = recipientIds.filter(id => game.actors.get(id));
        if (recipientIds.length === 0) return;

        // Shuffle recipients for fair round-robin distribution
        const shuffled = [...recipientIds];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }

        const { ItemOutcomeHandler } = await import("../services/ItemOutcomeHandler.js");

        for (let i = 0; i < discoveries.length; i++) {
            const disc = discoveries[i];
            const actorId = shuffled.length === 1
                ? shuffled[0]
                : shuffled[i % shuffled.length];

            try {
                const colon = disc.grantKey.indexOf(":");
                const eventId = colon >= 0 ? disc.grantKey.slice(0, colon) : disc.grantKey;
                const ref = colon >= 0 ? disc.grantKey.slice(colon + 1) : disc.itemRef;
                const result = await ItemOutcomeHandler.grantToActor(actorId, disc.itemRef, disc.quantity, {
                    ledger: this._grantLedger,
                    slotKey: GrantLedger.discoverySlotKey(eventId, ref)
                });
        Logger.log(`${MODULE_ID} | Auto-granted ${result.rolled}x ${result.itemName} to ${result.actorName}`);
            } catch (e) {

                console.warn(`${MODULE_ID} | Auto-grant failed for ${disc.itemRef}:`, e);
            }
        }
    }

    /**
     * Begin Short Rest: reads selected shelter and launches ShortRestApp.
     * Called from the short-rest shelter step (step 2).
     */
    static async #onBeginShortRest(event, target) {
        RestSetupApp.#launchShortRestFromSetup.call(this);
    }

    /**
     * Shared path: close setup and open the short rest panel (no long-rest engine or camp phase).
     */
    static #launchShortRestFromSetup() {
        const activeShelter = Object.entries(this._shelterOverrides ?? {})
            .find(([, v]) => v)?.[0] ?? "none";
        this.close();
        new ShortRestApp({ initialShelter: activeShelter }).render({ force: true });
    }

    /**
     * Phase 1 -> 2: Begin rest, broadcast to all connected players.
     */
    static async #onBeginRest(event, target) {
        const form = this.element.querySelector("form");
        const formData = Object.fromEntries(new FormData(form));

        if ((formData.restType ?? "long") === "short") {
            RestSetupApp.#launchShortRestFromSetup.call(this);
            return;
        }

        const terrainTag = formData.terrain ?? this._selectedTerrain ?? "forest";
        this._selectedTerrain = terrainTag;
        game.settings.set(MODULE_ID, "lastTerrain", terrainTag);
        await this._loadTerrainEvents(terrainTag);

        // Determine shelter effects from active overrides
        const activeShelters = Object.entries(this._shelterOverrides ?? {})
            .filter(([, v]) => v)
            .map(([id]) => id);
        let shelterComfortFloor = null;
        let shelterEncounterMod = 0;
        const SHELTER_EFFECTS = {
            tent: { comfortFloor: null, encounterMod: 2 },
            tiny_hut: { comfortFloor: "sheltered", encounterMod: 5 },
            rope_trick: { comfortFloor: null, encounterMod: 5 },
            magnificent_mansion: { comfortFloor: "safe", encounterMod: 99 }
        };
        const comfortRank = COMFORT_RANK;
        for (const id of activeShelters) {
            const effect = SHELTER_EFFECTS[id];
            if (!effect) continue;
            shelterEncounterMod = Math.max(shelterEncounterMod, effect.encounterMod);
            if (effect.comfortFloor && (COMFORT_RANK[effect.comfortFloor] ?? 0) > (COMFORT_RANK[shelterComfortFloor] ?? -1)) {
                shelterComfortFloor = effect.comfortFloor;
            }
        }

        const terrainDefaults = TerrainRegistry.getDefaults(terrainTag);

        // Apply comfort floor override from shelters (Tiny Hut, Mansion)
        let effectiveComfort = this._selectedComfort ?? formData.comfort ?? terrainDefaults.comfort ?? "sheltered";
        if (shelterComfortFloor && (COMFORT_RANK[shelterComfortFloor] ?? 0) > (COMFORT_RANK[effectiveComfort] ?? 0)) {
            effectiveComfort = shelterComfortFloor;
        }

        // Scout comfort and encounter mods come from travel resolution, not setup.
        this._selectedWeather = this._resolveSetupWeather(terrainTag, formData.weather);
        const weather = this._selectedWeather;
        const wx = WEATHER_TABLE[weather] ?? WEATHER_TABLE.clear;
        const hasTentActive = activeShelters.includes("tent");
        const hasHutActive = activeShelters.some(s => ["tiny_hut", "magnificent_mansion"].includes(s));

        // Hut cancels all weather. Tent fully cancels (tentCancels) or partially reduces (tentReduces).
        let weatherPenalty = wx.comfortPenalty;
        let weatherCancelled = false;
        if (hasHutActive) {
            weatherPenalty = 0;
            weatherCancelled = true;
        } else if (hasTentActive) {
            if (wx.tentCancels) {
                weatherPenalty = 0;
                weatherCancelled = true;
            } else if (wx.tentReduces) {
                weatherPenalty = Math.max(0, weatherPenalty - 1);
            }
        }

        if (weatherPenalty > 0) {
            let rank = COMFORT_RANK[effectiveComfort] ?? 2;
            rank = Math.max(0, rank - weatherPenalty);
            effectiveComfort = RANK_TO_KEY[rank];
        }

        // Add weather encounter DC modifier
        const weatherEncounterMod = weatherCancelled ? 0 : (wx.encounterDC ?? 0);

        const safeRestSpot = !!(formData.safeRestSpot === "on" || formData.safeRestSpot === true || formData.safeRestSpot === "1");
        try {
            await game.settings.set(MODULE_ID, "safeRestSpot", safeRestSpot);
        } catch (e) {

            console.warn(`${MODULE_ID} | Could not persist safeRestSpot`, e);
        }

        this._engine = new RestFlowEngine({
            restType: formData.restType ?? "long",
            terrainTag,
            comfort: effectiveComfort,
            safeRestSpot
        });
        this._engine.shelterEncounterMod = shelterEncounterMod + weatherEncounterMod;
        // Store individual modifiers for encounter bar breakdown
        this._engine._encounterBreakdown = {
            shelter: shelterEncounterMod,
            weather: weatherEncounterMod,
            scouting: 0,
            weatherName: weather,
            scoutingResult: "none"
        };
        this._engine.gmEncounterAdj = this._engine.gmEncounterAdj ?? 0;
        this._engine.activeShelters = activeShelters;
        this._engine.weather = weather;
        this._engine.scoutingResult = "none";
        this._engine.scoutingComplication = false;
        // Store base DC from terrain table on engine for event roll threshold calculation
        const terrainTable = this._eventResolver?.tables?.get(terrainTag);
        this._engine._baseDC = terrainTable?.noEventThreshold ?? 15;
        this._engine.setup();

        if (safeRestSpot) {
            this._engine.comfort = "safe";
            this._engine.shelterEncounterMod = 0;
            this._engine._encounterBreakdown = {
                shelter: 0,
                weather: 0,
                scouting: 0,
                defenses: 0,
                travelMishap: 0,
                weatherName: weather,
                scoutingResult: "none"
            };
            this._engine.scoutingComplication = false;
            this._engine.fireRollModifier = 0;
            this._engine.fireLevel = "campfire";
            this._engine.gmEncounterAdj = 0;
            this._fireLevel = "campfire";
        }

        const restPayload = {
            restId: `rest_${Date.now()}`,
            terrainTag: this._engine.terrainTag,
            comfort: this._engine.comfort,
            restType: this._engine.restType,
            safeRestSpot: this._engine.safeRestSpot,
            activities: this._activities ?? [],
            recipes: Object.fromEntries(this._craftingEngine.recipes)
        };

        setActiveRestData(restPayload);

        emitRestStarted(restPayload);

        ui.notifications.info("Rest phase started. Activity pickers sent to all players.");

        // Long rests show the Travel Resolution phase unless professions are disabled
        // (travel activities are redundant when resource-gathering is off).
        if (this._engine.restType === "long") {
            let skipTravel = false;
            try { skipTravel = !game.settings.get(MODULE_ID, "enableProfessions"); } catch (e) { /* */ }

            if (skipTravel) {
                this._phase = "camp";
            } else {
                this._phase = "travel";
                this._travel.setTotalDays(this._daysSinceLastRest ?? 1);
                this._travel.scoutingAllowed = isScoutingEnabled() && (this._scoutingAllowed ?? true);

                setTimeout(() => {
                    emitPhaseChanged("travel", {
                            selectedTerrain: this._selectedTerrain ?? "forest",
                            travelDays: this._travel.totalDays,
                            scoutingAllowed: this._travel.scoutingAllowed
                        });
                    this._broadcastTravelDeclarations();
                }, 200);
            }
        } else {
            this._phase = "camp";
        }

        this._campStep2Entered = false;

        // Campfire token: ensure hidden at rest start (fire not lit yet)
        CampfireTokenLinker.setLightState(false);
        // Reset event-related state from any prior rest
        this._eventsRolled = false;
        this._triggeredEvents = [];
        this._earlyResults = new Map();
        this._disasterChoice = null;
        this._activeTreeState = null;
        this._clearDetectMagicScanSession();

        // Strip Well Fed effects from the prior rest â€” the effect persists
        // between sessions but expires when a new long rest begins.
        await MealPhaseHandler.cleanupWellFedEffects(getPartyActors());
        await this._saveRestState();

        // Theater of the Mind: skip camp phase, jump to activity
        if (this._phase === "camp" && await this._skipCampForTheater()) return;
        // Tavern: skip camp phase entirely (no campfire/furniture to place)
        if (this._phase === "camp" && await this._skipCampForSafeRest()) return;
        // Comfort off: the fire ceremony has no mechanical effect, so waive it.
        if (this._phase === "camp" && await this._skipCampForComfortOff()) return;

        // Campfire opens after render (see _onRender)
        this.render();
    }

    /**
     * GM manually overrides a character's activity selection.
     */
    static #onGmOverride(event, target) {
        const characterId = target.dataset.characterId;
        const activityId = target.value;

        if (activityId) {
            this._gmOverrides.set(characterId, activityId);
        } else {
            this._gmOverrides.delete(characterId);
        }

        this._rebuildCharacterChoices();
        this._saveRestState();
        if (this._phase === "activity" && isStationLayerActive()) {
            refreshStationEmptyNoticeFade(this);
            refreshStationPortraitsFromChoices(this._characterChoices, this._stationCanvasIdByCharacter);
            this._refreshStationOverlayMeals();
        }
        this.render();

        // Broadcast updated submission status to players
        const submissions = {};
        for (const [charId, actId] of this._characterChoices) {
            const act = this._activities?.find(a => a.id === actId);
            submissions[charId] = { activityId: actId, activityName: act?.name ?? actId, source: this._gmOverrides.has(charId) ? "gm" : "player" };
        }
        emitSubmissionUpdate(submissions);
    }

    /**
     * Opens the CraftingPickerApp for a character.
     * GM: stores result locally, broadcasts submission update.
     * Player: auto-submits choice + crafting result to GM.
     */
    static #onOpenCrafting(event, target) {
        const characterId = target.dataset.characterId;
        const profession = target.dataset.profession;
        if (!characterId || !profession) return;

        if (this._lockedCharacters?.has(characterId) || this.hasCompletedCrafting(characterId, profession)) {
            ui.notifications.warn("This character has already completed crafting for this rest.");
            return;
        }

        const actor = game.actors.get(characterId);
        if (!actor) return;

        // Mark crafting as in progress
        if (!this._craftingInProgress) this._craftingInProgress = new Set();
        this._craftingInProgress.add(characterId);
        this._pendingSelections?.delete(characterId);

        const terrainTag = this._engine?.terrainTag ?? this._restData?.terrainTag ?? null;
        const app = this;

        // Open the standalone crafting picker window
        const picker = new CraftingPickerApp(
            actor, profession, this._craftingEngine,
            (result) => {
                // Completion callback: commit the crafting result
                app._craftingInProgress?.delete(characterId);
                if (!result) {
                    // Crafting cancelled or no result â€” re-enable selection
                    if (app.rendered) app.render();
                    return;
                }
                app._craftingResults.set(characterId, result);

                // Find the matching crafting activity to record the choice
                const resolver = app._activityResolver;
                const craftAct = resolver?.activities ? [...resolver.activities.values()].find(
                    a => a.crafting?.profession === profession
                ) : null;
                const activityId = craftAct?.id ?? `act_cook`;

                if (app._isGM) {
                    app._gmOverrides.set(characterId, activityId);
                    app._rebuildCharacterChoices?.();
                    const submissions = {};
                    for (const [charId, actId] of app._characterChoices) {
                        const act = resolver?.activities?.get(actId);
                        submissions[charId] = {
                            activityId: actId,
                            activityName: act?.name ?? actId,
                            source: app._gmOverrides.has(charId) ? "gm" : "player"
                        };
                    }
                    game.socket.emit(`module.ionrift-respite`, { type: "submissionUpdate", submissions });
                } else {
                    app._characterChoices.set(characterId, activityId);
                    app._lockedCharacters = app._lockedCharacters ?? new Set();
                    app._lockedCharacters.add(characterId);
                    game.socket.emit(`module.ionrift-respite`, {
                        type: "activityChoice",
                        userId: game.user.id,
                        choices: Object.fromEntries(app._characterChoices),
                        craftingResults: { [characterId]: result }
                    });
                    ui.notifications.info(`${actor.name}'s activity submitted.`);
                }
                if (app.rendered) app.render();
            },
            terrainTag,
            this._grantLedger
        );
        picker.render({ force: true });
    }

    /**
     * Crafting drawer: select a recipe.
     */
    static #onCraftDrawerSelectRecipe(event, target) { this._crafting.onSelectRecipe(event, target); }
    static #onCraftDrawerSelectRisk(event, target) { this._crafting.onSelectRisk(event, target); }
    static async #onCraftDrawerCraft(event, target) { await this._crafting.onCraft(event, target); }
    static #onCraftDrawerToggleMissing(event, target) { this._crafting.onToggleMissing(event, target); }
    static #onCraftDrawerClose(event, target) { this._crafting.onClose(event, target); }

    /**
     * Activity detail panel: confirm the selected activity.
     */
    static #onActivityDetailConfirm(event, target) {
        const characterId = this._selectedCharacterId;
        const activityId = this._activityDetailId;
        if (!characterId || !activityId) return;

        // Armor sleep penalty confirmation (gated by Xanathar's setting; skipped at a safe rest spot)
        if (!this._armorConfirmed && !this._effectiveSafeRestSpot()) {
            try {
                const armorRuleEnabled = game.settings.get(MODULE_ID, "armorDoffRule");
                if (armorRuleEnabled) {
                    const actor = game.actors.get(characterId);
                    const equippedArmor = actor?.items?.find(i =>
                        i.type === "equipment" && i.system?.equipped &&
                        ["medium", "heavy"].includes(i.system?.type?.value ?? i.system?.armor?.type)
                    );
                    const activity = this._activities?.find(a => a.id === activityId);
                    if (equippedArmor && !activity?.armorSleepWaiver) {
                        const armorType = equippedArmor.system?.type?.value ?? "heavy";
                        // Custom modal overlay (not Foundry Dialog) for full styling control
                        const overlay = document.createElement("div");
                        overlay.classList.add("ionrift-armor-modal-overlay");
                        overlay.innerHTML = `
                            <div class="ionrift-armor-modal">
                                <h3><i class="fas fa-shield-alt"></i> Sleeping in Armor</h3>
                                <p><strong>${actor.name}</strong> is wearing <strong>${equippedArmor.name}</strong> (${armorType}).</p>
                                <p>Sleeping in medium or heavy armor reduces Hit Dice recovery to 1/4 and prevents exhaustion reduction (Xanathar's).</p>
                                <p>Confirm this activity, or go back and doff armor first?</p>
                                <div class="ionrift-armor-modal-buttons">
                                    <button class="btn-armor-confirm"><i class="fas fa-check"></i> Confirm</button>
                                    <button class="btn-armor-cancel"><i class="fas fa-times"></i> Go Back</button>
                                </div>
                            </div>`;
                        document.body.appendChild(overlay);
                        overlay.querySelector(".btn-armor-confirm").addEventListener("click", () => {
                            overlay.remove();
                            this._armorConfirmed = true;
                            RestSetupApp.#onActivityDetailConfirm.call(this, event, target);
                        });
                        overlay.querySelector(".btn-armor-cancel").addEventListener("click", () => {
                            overlay.remove();
                        });
                        return;
                    }
                }
            } catch (e) { /* setting may not exist */ }
        }
        this._armorConfirmed = false;

        if (this._isGM) {
            // Check if player already submitted for this character
            const actor = game.actors.get(characterId);
            const ownerUser = actor ? game.users.find(u => !u.isGM && actor.testUserPermission(u, "OWNER")) : null;
            const playerAlreadySubmitted = ownerUser && this._playerSubmissions?.has(ownerUser.id);
            if (playerAlreadySubmitted && !this._gmOverrides.has(characterId)) {
                ui.notifications.warn(`${actor.name}'s player already submitted. Overriding their choice.`);
            }
            // GM: override + broadcast
            this._gmOverrides.set(characterId, activityId);
            this._characterChoices.set(characterId, activityId);
            this._rebuildCharacterChoices();

            const submissions = {};
            for (const [charId, actId] of this._characterChoices) {
                const act = this._activities?.find(a => a.id === actId);
                submissions[charId] = {
                    activityId: actId,
                    activityName: act?.name ?? actId,
                    source: this._gmOverrides.has(charId) ? "gm" : "player"
                };
            }
            emitSubmissionUpdate(submissions);
        } else {
            // Player: submit + lock
            this._characterChoices.set(characterId, activityId);
            this._lockedCharacters = this._lockedCharacters ?? new Set();
            this._lockedCharacters.add(characterId);

            // Copy Spell: send proposal to GM instead of normal submission
            if (activityId === "act_scribe") {
                const actor = game.actors.get(characterId);
                // Read followUp value from the dropdown in the detail panel
                const followUpEl = this.element?.querySelector(".gm-followup-input");
                const followUpValue = followUpEl?.value ?? "1";
                const spellLevel = parseInt(followUpValue, 10) || 1;
                const cost = spellLevel * 50;
                const dc = 10 + spellLevel;

                emitCopySpellProposal({
                    actorId: characterId,
                    actorName: actor?.name ?? "Unknown",
                    spellLevel,
                    cost,
                    dc,
                    initiatedBy: game.user.name
                });

                // Show pending state
                this._earlyResults = this._earlyResults ?? new Map();
                this._earlyResults.set(characterId, {
                    source: "activity",
                    activityId,
                    result: "pending_approval",
                    narrative: `Level ${spellLevel} spell (${cost}gp, DC ${dc}). Awaiting transaction.`
                });

                if (actor) ui.notifications.info(`${actor.name}: Copy Spell Level ${spellLevel} submitted.`);
            } else {
                const actor = game.actors.get(characterId);
                if (actor) ui.notifications.info(`${actor.name}'s activity submitted.`);
            }

            emitActivityChoice(
                    game.user.id,
                    Object.fromEntries(this._characterChoices),
                    null,
                    null,
                    this._earlyResults?.size ? Object.fromEntries(this._earlyResults) : null
                );
            this._saveRestState();
        }

        this._activityDetailId = null;
        if (this._phase === "activity" && isStationLayerActive()) {
            refreshStationEmptyNoticeFade(this);
            refreshStationPortraitsFromChoices(this._characterChoices, this._stationCanvasIdByCharacter);
            this._refreshStationOverlayMeals();
        }
        this.render();
    }

    /**
     * Activity detail panel: go back to the activity grid.
     */
    static #onActivityDetailBack(event, target) {
        this._activityDetailId = null;
        this.render();
    }

    /**
     * Status id for â€œasleep for the nightâ€ (Foundry / system CONFIG).
     * watchRoster also includes act_defenses and act_scout; only Keep Watch
     * should stay alert for this beat.
     */
    _beddingStatusEffectId() {
        const fromConfig = CONFIG.statusEffects?.find?.(e => e.id === "incapacitated");
        if (fromConfig) return "incapacitated";
        if ( CONFIG.statusEffects?.find?.(e => e.id === "unconscious") ) return "unconscious";
        return "incapacitated";
    }

    /**
     * Actor ids on literal night watch (Keep Watch), not the full alert roster.
     */
    _nightWatchActorIds() {
        const ids = new Set();
        for (const [characterId, entry] of this._engine?.characterChoices ?? []) {
            if (entry?.activityId === "act_keep_watch") ids.add(characterId);
        }
        return ids;
    }

    /**
     * Status ids applied when the camp beds down for the night.
     * Incapacitated is the overlay; prone adds the visual "down" posture.
     */
    _beddingStatusIds() {
        const all = CONFIG.statusEffects ?? [];
        const has = (id) => all.some(e => e.id === id);
        const incap = has("incapacitated") ? "incapacitated" : (has("unconscious") ? "unconscious" : "incapacitated");
        const statusIds = [incap];
        if (has("prone")) statusIds.push("prone");
        return statusIds;
    }

    /**
     * Apply Incapacitated + Prone to party members not on Keep Watch,
     * signalling the camp has bedded down for the night.
     */
    async _applyBeddingDown() {
        if (!game.user?.isGM) return;
        const keepWatchIds = this._nightWatchActorIds();
        const [primaryId, ...rest] = this._beddingStatusIds();
        const scene = game.scenes?.active;
        for (const actor of getPartyActors()) {
            if (keepWatchIds.has(actor.id)) continue;
            try {
                await actor.toggleStatusEffect(primaryId, { active: true, overlay: true });
                for (const id of rest) {
                    await actor.toggleStatusEffect(id, { active: true });
                }
            } catch (err) {

                console.warn(`[Respite] Could not apply sleep effects to ${actor.name}:`, err);
            }
            // Mark tokens on the active scene so the Zzz hook can render.
            if (scene) {
                const tokens = scene.tokens.filter(t => t.actor?.id === actor.id);
                for (const td of tokens) {
                    await td.setFlag(MODULE_ID, "beddingDown", true).catch(() => {});
                }
            }
        }
    }

    /**
     * Clear Incapacitated + Prone and token Zzz flags for the party.
     * Called when rest resolves, when an encounter pulls the table into combat,
     * or when the rest is abandoned â€” not when leaving reflection for events.
     */
    async _removeBeddingDown() {
        if (!game.user?.isGM) return;
        const statusIds = this._beddingStatusIds();
        const scene = game.scenes?.active;
        for (const actor of getPartyActors()) {
            for (const id of statusIds) {
                try {
                    await actor.toggleStatusEffect(id, { active: false });
                } catch (err) {

                    console.warn(`[Respite] Could not remove ${id} from ${actor.name}:`, err);
                }
            }
            if (scene) {
                const tokens = scene.tokens.filter(t => t.actor?.id === actor.id);
                for (const td of tokens) {
                    await td.unsetFlag(MODULE_ID, "beddingDown").catch(() => {});
                }
            }
        }
    }

    /**
     * Auto-process rations inline (spoilage, consumption, starvation,
     * dehydration) so the old Meal phase UI can be skipped entirely.
     * Choices come from station submissions stored in _mealChoices.
     * Dehydration saves are GM-auto-rolled; interactive flow deferred.
     */
    async _autoProcessRations() {
        const rosterIds = new Set(getPartyActors().map(a => a.id));
        const characterIds = this._engine?.characterChoices
            ? Array.from(this._engine.characterChoices.keys()).filter(id => rosterIds.has(id))
            : [];

        if (!this._mealChoices) this._mealChoices = new Map();

        const terrainTag = this._engine?.terrainTag ?? "forest";
        const terrainMealRules = TerrainRegistry.getDefaults(terrainTag)?.mealRules ?? {};
        const totalDays = this._daysSinceLastRest ?? 1;

        for (const charId of characterIds) {
            if (!this._mealChoices.has(charId)) {
                const cards = MealPhaseHandler.buildMealContext(
                    [charId], terrainTag, terrainMealRules,
                    totalDays, this._mealChoices
                );
                if (cards.length > 0) {
                    this._mealChoices.set(charId, {
                        food: cards[0].selectedFood,
                        water: cards[0].selectedWater
                    });
                }
            }
        }

        if (!this._spoilageProcessed) {
            this._spoilageProcessed = true;
            try {
                await MealPhaseHandler.resolveSpoilage(characterIds, totalDays);
            } catch (err) {

                console.error(`[Respite:Meal] Auto-process spoilage error:`, err);
            }
        }

        let mealResults = [];
        if (!this._mealProcessed) {
            this._mealProcessed = true;
            try {
                const outcome = await MealPhaseHandler.processAndApply(this._mealChoices, totalDays, terrainMealRules);
                mealResults = outcome.results;
                this._mealResults = mealResults;
        Logger.log(`[Respite:Meal] Auto-process consumption results:`, mealResults);
            } catch (err) {

                console.error(`[Respite:Meal] Auto-process consumption error:`, err);
            }

            for (const r of mealResults) {
                if (r.starvationExhaustion > 0) {
                    const actor = game.actors.get(r.characterId);
                    if (!actor) continue;
                    const adapter = game.ionrift?.respite?.adapter;
                    if (adapter) {
                        await adapter.applyExhaustionDelta(actor, r.starvationExhaustion);
                    } else {
                        const current = actor.system?.attributes?.exhaustion ?? 0;
                        const newLevel = Math.min(6, current + r.starvationExhaustion);
                        if (newLevel > current) {
                            await actor.update({ "system.attributes.exhaustion": newLevel });
                        }
                    }
                    await ChatMessage.create({
                        content: `<div class="respite-recovery-chat"><strong>${r.actorName}</strong> gains <strong>${r.starvationExhaustion}</strong> level${r.starvationExhaustion > 1 ? "s" : ""} of exhaustion from starvation.</div>`,
                        speaker: ChatMessage.getSpeaker({ actor })
                    });
                }
                if ((r.essenceExhaustion ?? 0) > 0) {
                    const actor = game.actors.get(r.characterId);
                    if (!actor) continue;
                    const adapter = game.ionrift?.respite?.adapter;
                    if (adapter) {
                        await adapter.applyExhaustionDelta(actor, r.essenceExhaustion);
                    } else {
                        const current = actor.system?.attributes?.exhaustion ?? 0;
                        const newLevel = Math.min(6, current + r.essenceExhaustion);
                        if (newLevel > current) {
                            await actor.update({ "system.attributes.exhaustion": newLevel });
                        }
                    }
                    await ChatMessage.create({
                        content: `<div class="respite-recovery-chat"><strong>${r.actorName}</strong> gains <strong>${r.essenceExhaustion}</strong> level${r.essenceExhaustion > 1 ? "s" : ""} of exhaustion from essence depletion.</div>`,
                        speaker: ChatMessage.getSpeaker({ actor })
                    });
                }

                if (r.dehydrationAutoFail) {
                    const actor = game.actors.get(r.characterId);
                    if (!actor) continue;
                    const adapter = game.ionrift?.respite?.adapter;
                    if (adapter) {
                        await adapter.applyExhaustionDelta(actor, 1);
                    } else {
                        const current = actor.system?.attributes?.exhaustion ?? 0;
                        const newLevel = Math.min(6, current + 1);
                        if (newLevel > current) {
                            await actor.update({ "system.attributes.exhaustion": newLevel });
                        }
                    }
                    const restsSinceWater = actor.getFlag("ionrift-respite", "restsSinceWater") ?? 0;
                    await ChatMessage.create({
                        content: `<div class="respite-recovery-chat"><strong>${r.actorName}</strong> gains 1 level of exhaustion from severe dehydration (auto-fail, ${restsSinceWater} rests without water).</div>`,
                        speaker: ChatMessage.getSpeaker({ actor })
                    });
                } else if (r.dehydrationSaveDC > 0) {
                    const actor = game.actors.get(r.characterId);
                    if (!actor) continue;
                    const _adapter = game.ionrift?.respite?.adapter;
                    const saveBonus = _adapter
                        ? _adapter.getSaveBonus(actor, "con")
                        : (() => {
                            const conMod = actor.system?.abilities?.con?.mod ?? 0;
                            const profBonus = actor.system?.abilities?.con?.save
                                ? (actor.system?.attributes?.prof ?? 0) : 0;
                            return conMod + profBonus;
                        })();
                    const roll = await new Roll(`1d20 + ${saveBonus}`).evaluate();
                    if (game.dice3d) {
                        await game.dice3d.showForRoll(roll, game.user, true);
                    }
                    if (roll.total < r.dehydrationSaveDC) {
                        const adapter = game.ionrift?.respite?.adapter;
                        if (adapter) {
                            await adapter.applyExhaustionDelta(actor, 1);
                        } else {
                            const current = actor.system?.attributes?.exhaustion ?? 0;
                            const newLevel = Math.min(6, current + 1);
                            if (newLevel > current) {
                                await actor.update({ "system.attributes.exhaustion": newLevel });
                            }
                        }
                        await ChatMessage.create({
                            content: `<div class="respite-recovery-chat"><strong>${r.actorName}</strong> fails the CON save (${roll.total} vs DC ${r.dehydrationSaveDC}) and gains 1 level of exhaustion from dehydration.</div>`,
                            speaker: ChatMessage.getSpeaker({ actor })
                        });
                    } else {
                        await ChatMessage.create({
                            content: `<div class="respite-recovery-chat"><strong>${r.actorName}</strong> passes the CON save (${roll.total} vs DC ${r.dehydrationSaveDC}) and fights off dehydration.</div>`,
                            speaker: ChatMessage.getSpeaker({ actor })
                        });
                    }
                }
            }
        }
    }

    /**
     * Phase 2 -> 3: Lock in all choices, transition to events phase.
     * Event roll is deferred until GM clicks 'Roll for Events'.
     */
    static async #onSubmitActivities(event, target) {
        await closeOpenStationDialog();
        this._tearDownStationLayerCanvas();
        if (this._phase === "activity") {
            void this._detectMagic?.cleanupCastArtifactsOnPhaseExit(getPartyActors());
        }
        for (const [characterId, activityId] of this._characterChoices) {
            const followUpValue = this._gmFollowUps?.get(characterId) ?? this._getFollowUpForCharacter(characterId);
            this._engine.registerChoice(characterId, activityId, { followUpValue });
            const actor = game.actors.get(characterId);
            if (actor) {
                try {
                    const pen = actor.getFlag(MODULE_ID, "travelMishapPenalty");
                    if (pen === "lose_activity") {
                        await actor.unsetFlag(MODULE_ID, "travelMishapPenalty");
                    } else if (pen === "activity_disadvantage" && activityId === "act_other") {
                        await actor.unsetFlag(MODULE_ID, "travelMishapPenalty");
                    }
                } catch { /* noop */ }
            }
        }

        // Short rest: skip reflection and events entirely
        if (this._engine.restType === "short") {
            this._triggeredEvents = [];
            this._eventsRolled = true;
            SoundDelegate.stopAll();
            this._phase = "resolve";
        } else {
            const trackFood = game.settings.get(MODULE_ID, "trackFood");
            const terrainTag = this._engine?.terrainTag ?? "forest";
            const terrainMealRules = TerrainRegistry.getDefaults(terrainTag)?.mealRules ?? {};
            const hasMealRules = terrainMealRules.waterPerDay > 0 || terrainMealRules.foodPerDay > 0;

            if (trackFood && hasMealRules && this._isTotM) {
                // TotM: show the meal phase UI so players can submit rations.
                // _activityMealRationsSubmitted may already have feast-covered characters
                // from #onTotmFeastServeNow; those cards show the feast advisory banner.
                this._mealChoices = this._mealChoices ?? new Map();
                this._daysSinceLastRest = this._daysSinceLastRest ?? 1;
                this._phase = "meal";
            } else if (trackFood && hasMealRules) {
                // Spatial mode: rations were submitted via station tabs; auto-process now.
                this._mealChoices = this._mealChoices ?? new Map();
                this._daysSinceLastRest = this._daysSinceLastRest ?? 1;
                await this._autoProcessRations();
                await this._applyBeddingDown();
                // Reflection phase skipped (v2.1); advance straight to events.
                await this._advanceToEvents();
                return;
            } else {
                await this._applyBeddingDown();
                // Reflection phase skipped (v2.1); advance straight to events.
                await this._advanceToEvents();
                return;
            }
        }

        // Broadcast phase change to players
        emitPhaseChanged(this._phase, {
                campStatus: this._campStatus,
                daysSinceLastRest: this._daysSinceLastRest ?? 1,
                selectedTerrain: this._selectedTerrain ?? "forest"
            });

        await this._saveRestState();
        this.render();
    }

    /**
     * Opens the campfire drawer with a read-only fire level (set during Make Camp).
     */
    _openCampfire() {
        const magicalShelters = ["tiny_hut", "rope_trick", "magnificent_mansion"];
        const activeShelterIds = Object.entries(this._shelterOverrides ?? {})
            .filter(([, v]) => v)
            .map(([id]) => id);
        if (activeShelterIds.some(id => magicalShelters.includes(id))) {

            Logger.log(`${MODULE_ID} | Campfire drawer skipped: magical shelter active`);
            return;
        }

        const drawerContainer = this.element?.querySelector(".campfire-drawer-content");
        if (!drawerContainer) {

            console.warn(`${MODULE_ID} | No .campfire-drawer-content found in DOM`);
            return;
        }

        const level = this._fireLevel ?? "unlit";
        const LEVEL_LABELS = {
            unlit: "Unlit",
            embers: "Embers",
            campfire: "Campfire",
            bonfire: "Bonfire"
        };
        drawerContainer.innerHTML = `
            <div class="campfire-static-status">
                <div class="campfire-static-inner">
                    <i class="fas fa-fire" aria-hidden="true"></i>
                    <span class="campfire-static-title">${LEVEL_LABELS[level] ?? level}</span>
                </div>
                <p class="campfire-static-hint">Fire level was chosen during Make Camp.</p>
            </div>`;
        const drawer = this.element?.querySelector(".campfire-drawer");
        if (drawer) drawer.classList.add("open");
    }

    _closeCampfire() {
        this._tearDownCampfireEmbed();
        const drawerContent = this.element?.querySelector(".campfire-drawer-content");
        if (drawerContent) drawerContent.innerHTML = "";
        const drawer = this.element?.querySelector(".campfire-drawer");
        if (drawer) drawer.classList.remove("open");
    }

    /**
     * Shared gates for TotM fire UI (comfort on, not safe rest, no sealed shelter).
     * @returns {boolean}
     */
    _totmFireUiEnabled() {
        if (!this._isTotM || this._phase !== "activity") return false;
        if (!isComfortEnabled()) return false;
        let safeFromSetting = false;
        try {
            safeFromSetting = !!game.settings.get(MODULE_ID, "safeRestSpot");
        } catch { /* noop */ }
        const effectiveSafe = !!(this._engine?.safeRestSpot ?? this._restData?.safeRestSpot ?? safeFromSetting);
        if (effectiveSafe) return false;
        const magicalShelters = ["tiny_hut", "rope_trick", "magnificent_mansion"];
        const activeShelterIds = Object.entries(this._shelterOverrides ?? {})
            .filter(([, v]) => v)
            .map(([id]) => id);
        if (activeShelterIds.some(id => magicalShelters.includes(id))) return false;
        return true;
    }

    /** @returns {boolean} */
    _totmCampfireMinigamePanelEnabled() {
        return isCampfireMinigameEnabled() && this._totmFireUiEnabled();
    }

    /** Fire tier tab only when the minigame side panel is off (minigame supplants it). */
    _totmFireTabVisible() {
        return this._totmFireUiEnabled() && !isCampfireMinigameEnabled();
    }

    _isCampColdCampPreview() {
        return !!this._coldCampPreview || this._campFirePreviewLevel === "cold_camp";
    }

    _partyFirewoodTotal() {
        return getPartyActors().reduce((sum, a) => sum + countActorFirewood(a), 0);
    }

    _campPreviewFirewoodCost(level = null) {
        const lv = level ?? this._campFirePreviewLevel ?? "embers";
        if (lv === "cold_camp") return 0;
        return CampGearScanner.FIREWOOD_COST_BY_LEVEL[lv] ?? 0;
    }

    _portraitForCeremonyActor(actorId, userId) {
        const actor = game.actors.get(actorId);
        if (actor?.img) return actor.img;
        const user = game.users.get(userId);
        return user?.avatar ?? "";
    }

    _stagedWoodCountForActor(actorId) {
        return (this._makeCampStagedWood ?? []).filter(s => s.actorId === actorId).length;
    }

    _canReclaimCeremonyStagedSlot(slot) {
        if (!slot) return false;
        return game.user.isGM || slot.userId === game.user.id;
    }

    _buildMakeCampCeremonyRequirementSlots() {
        const level = this._isCampColdCampPreview() ? null : (this._campFirePreviewLevel ?? "embers");
        const cost = level ? this._campPreviewFirewoodCost(level) : 0;
        const actor = this._selectedCharacterId ? game.actors.get(this._selectedCharacterId) : null;
        const kindlingImg = findConsumableFirewoodItem(actor)?.img
            ?? "icons/commodities/wood/kindling-sticks-brown.webp";
        const party = this._partyFirewoodTotal();
        const staged = this._makeCampStagedWood ?? [];
        const slots = [];
        for (let i = 0; i < cost; i++) {
            const s = staged[i];
            if (s) {
                slots.push({
                    filled: true,
                    id: s.id,
                    kindlingImg,
                    portrait: s.portrait ?? "",
                    actorName: s.actorName ?? "",
                    canReclaim: this._canReclaimCeremonyStagedSlot(s),
                    tooltip: `${s.actorName}: click to return kindling`
                });
            } else {
                slots.push({
                    filled: false,
                    kindlingImg,
                    insufficient: (i + 1) > party,
                    tooltip: "Drag kindling here"
                });
            }
        }
        return slots;
    }

    _maybeClearStagedWoodOnTierChange(newLevel) {
        const newCost = this._campPreviewFirewoodCost(newLevel);
        const prev = this._makeCampStagedWoodTier;
        if (prev !== null && newCost < prev && (this._makeCampStagedWood?.length ?? 0) > 0) {
            this.clearCeremonyStagedWood({ silent: true });
        }
        this._makeCampStagedWoodTier = newCost;
    }

    async clearCeremonyStagedWood({ silent = false } = {}) {
        if (!this._makeCampStagedWood?.length) return;
        this._makeCampStagedWood = [];
        if (game.user.isGM) {
            emitPhaseChanged(this._phase, {
                makeCampStagedWood: [],
                selectedTerrain: this._selectedTerrain ?? null
            });
            this._syncCampCeremonyPreviewToEmbed();
            if (this._campfireApp) void this._campfireApp.render();
            else this.render();
        } else if (!silent) {
            ui.notifications.info("Tier changed: placed kindling returned to owners.");
        }
    }

    async stageCeremonyWood(userId, actorId) {
        const cost = this._campPreviewFirewoodCost();
        if (this._isCampColdCampPreview() || cost <= 0) return false;
        if ((this._makeCampStagedWood?.length ?? 0) >= cost) {
            ui.notifications.warn("Enough kindling is placed for this tier.");
            return false;
        }
        const actor = game.actors.get(actorId);
        if (!actor) return false;
        const available = countActorFirewood(actor) - this._stagedWoodCountForActor(actorId);
        if (available <= 0) {
            ui.notifications.warn(`${actor.name} has no kindling left to place.`);
            return false;
        }
        const slot = {
            id: foundry.utils.randomID(),
            userId,
            actorId,
            actorName: actor.name,
            portrait: this._portraitForCeremonyActor(actorId, userId)
        };
        if (!game.user.isGM) {
            game.socket.emit(`module.${MODULE_ID}`, {
                type: "campCeremonyStageWood",
                userId,
                actorId,
                slot
            });
            return true;
        }
        this._makeCampStagedWood = [...(this._makeCampStagedWood ?? []), slot];
        emitPhaseChanged(this._phase, {
            makeCampStagedWood: [...this._makeCampStagedWood],
            selectedTerrain: this._selectedTerrain ?? null
        });
        this._syncCampCeremonyPreviewToEmbed();
        if (this._campfireApp) void this._campfireApp.render();
        else this.render();
        return true;
    }

    /** GM: grant one kindling to the roster-selected character (preview only, not staged). */
    async giftCeremonyWoodToFocusedActor() {
        if (!game.user.isGM) return;
        const actor = this._selectedCharacterId ? game.actors.get(this._selectedCharacterId) : null;
        if (!actor) {
            ui.notifications.warn("Select a character in the roster first.");
            return;
        }
        try {
            const result = await ItemOutcomeHandler.grantToActor(actor.id, "kindling", 1);
            ui.notifications.info(`Gifted kindling to ${result.actorName}.`);
            this._syncCampCeremonyPreviewToEmbed();
            if (this._campfireApp) void this._campfireApp.render();
            else this.render();
        } catch (err) {
            console.error(`${MODULE_ID} | giftCeremonyWood:`, err);
            ui.notifications.warn("Could not gift kindling to that character.");
        }
    }

    async unstageCeremonyWood(slotId) {
        const slot = (this._makeCampStagedWood ?? []).find(s => s.id === slotId);
        if (!slot) return;
        if (!this._canReclaimCeremonyStagedSlot(slot)) {
            ui.notifications.warn("Only the contributor or GM can reclaim that kindling.");
            return;
        }
        if (!game.user.isGM) {
            game.socket.emit(`module.${MODULE_ID}`, {
                type: "campCeremonyUnstageWood",
                userId: game.user.id,
                slotId
            });
            return;
        }
        this._makeCampStagedWood = this._makeCampStagedWood.filter(s => s.id !== slotId);
        emitPhaseChanged(this._phase, {
            makeCampStagedWood: [...this._makeCampStagedWood],
            selectedTerrain: this._selectedTerrain ?? null
        });
        this._syncCampCeremonyPreviewToEmbed();
        if (this._campfireApp) void this._campfireApp.render();
        else this.render();
    }

    async _spendCeremonyStagedWood(cost) {
        const spendNames = [];
        if (cost <= 0) return { ok: true, spendNames };
        const staged = (this._makeCampStagedWood ?? []).slice(0, cost);
        if (staged.length < cost) {
            return { ok: false, spendNames, error: "Not enough kindling placed for this fire tier." };
        }
        for (const slot of staged) {
            const actor = game.actors.get(slot.actorId);
            if (!actor) return { ok: false, spendNames, error: "Placed kindling actor missing." };
            const item = findConsumableFirewoodItem(actor);
            if (!item || (item.system?.quantity ?? 0) <= 0) {
                return { ok: false, spendNames, error: `${slot.actorName} no longer has that kindling.` };
            }
            const qty = item.system?.quantity ?? 1;
            if (qty <= 1) await item.delete();
            else await item.update({ "system.quantity": qty - 1 });
            spendNames.push(slot.actorName);
        }
        this._makeCampStagedWood = [];
        return { ok: true, spendNames };
    }

    _syncCampCeremonyPreviewToEmbed() {
        if (!this._campfireApp || !this._campCeremonyMinigameEnabled()) return;
        const preview = this._isCampColdCampPreview()
            ? "cold_camp"
            : (this._campFirePreviewLevel ?? "embers");
        const slots = this._buildMakeCampCeremonyRequirementSlots();
        const cost = this._campPreviewFirewoodCost();
        const ceremonyReady = (this._makeCampStagedWood?.length ?? 0) >= cost && cost > 0;
        this._campfireApp.syncMakeCampPreview(
            preview,
            this._partyFirewoodTotal(),
            slots,
            ceremonyReady
        );
    }

    /** Make Camp (TotM): minigame ceremony before fire is committed. */
    _campCeremonyMinigameEnabled() {
        if (!isCampfireMinigameEnabled() || !this._isTotM || this._phase !== "camp") return false;
        if (!isComfortEnabled()) return false;
        let safeFromSetting = false;
        try {
            safeFromSetting = !!game.settings.get(MODULE_ID, "safeRestSpot");
        } catch { /* noop */ }
        const effectiveSafe = !!(this._engine?.safeRestSpot ?? this._restData?.safeRestSpot ?? safeFromSetting);
        if (effectiveSafe) return false;
        if ((this._fireLevel ?? "unlit") !== "unlit" || !!this._coldCampDecided) return false;
        return true;
    }

    /**
     * First successful minigame ignite during Make Camp commits the previewed tier (segment picker).
     * @param {{ readyToLight?: boolean }} [opts]
     */
    async _commitMakeCampCeremonyIgnite(opts = {}) {
        if (this._commitMakeCampCeremonyInFlight) return;
        if (this._phase !== "camp" || this._campToActivityDone) return;
        if (!isCampfireMinigameEnabled() || !this._isTotM) return;
        if (this._isCampColdCampPreview()) return;

        const chosenLevel = ["embers", "campfire", "bonfire"].includes(this._campFirePreviewLevel)
            ? this._campFirePreviewLevel
            : "embers";
        const cost = this._campPreviewFirewoodCost(chosenLevel);
        const staged = this._makeCampStagedWood?.length ?? 0;
        const readyToLight = opts.readyToLight
            ?? this._campfireApp?._ceremonyReadyToLight
            ?? staged >= cost;
        if (!readyToLight && staged < cost && this._partyFirewoodTotal() < cost) {
            ui.notifications.warn(`Place ${cost} kindling for ${chosenLevel} before lighting.`);
            return;
        }

        const actor = this._selectedCharacterId
            ? game.actors.get(this._selectedCharacterId)
            : null;
        const actorId = actor?.id ?? getPartyActors()[0]?.id;
        if (!actorId) return;

        if ((this._fireLevel ?? "unlit") !== "unlit") {
            if (game.user.isGM) await this._totmAdvanceCampAfterCeremonyIgnite();
            return;
        }

        if (!game.user.isGM) {
            emitCampLightFire(game.user.id, actorId, "Minigame", chosenLevel);
            return;
        }

        this._commitMakeCampCeremonyInFlight = true;
        try {
            await this._campCeremony.lightFire(
                game.user.id,
                actorId,
                "Minigame",
                chosenLevel,
                { autoAdvanceTotm: true }
            );
            if (this._phase === "camp" && !this._campToActivityDone) {
                await this._totmAdvanceCampAfterCeremonyIgnite();
            }
        } finally {
            this._commitMakeCampCeremonyInFlight = false;
        }
    }

    /** @deprecated Use _commitMakeCampCeremonyIgnite via onCeremonyIgnited. */
    async applyCampFireFromMinigameCeremony() {
        if (!this._campCeremonyMinigameEnabled()) return;
        await this._commitMakeCampCeremonyIgnite();
    }

    /**
     * TotM + campfire minigame: after ceremony ignite, spend placed kindling and advance
     * to Activities (skips the redundant post-light tier picker step).
     */
    async _totmAdvanceCampAfterCeremonyIgnite() {
        if (!game.user.isGM) return;
        if (!isCampfireMinigameEnabled() || !this._isTotM || this._phase !== "camp" || this._campToActivityDone) {
            return;
        }
        this._tearDownCampfireEmbed();
        await this._totmSpendMakeCampFirewood();
        await this._advanceCampToActivity();
    }

    /** Spend firewood for the committed Make Camp fire (TotM, non-pledge path). */
    async _totmSpendMakeCampFirewood() {
        if (!!this._engine?.safeRestSpot) return;

        const cost = CampGearScanner.FIREWOOD_COST_BY_LEVEL[this._fireLevel ?? "unlit"] ?? 0;
        if (cost <= 0) return;

        const lighterUserId = this._fireLitBy?.userId ?? null;
        const spend = (this._makeCampStagedWood?.length ?? 0) >= cost
            ? await this._spendCeremonyStagedWood(cost)
            : await this._spendPartyFirewoodForMakeCamp(cost, lighterUserId);

        const level = this._fireLevel ?? "campfire";
        const label = level.charAt(0).toUpperCase() + level.slice(1);
        const lighterName = this._fireLitBy?.actorName ?? null;
        const donors = spend.spendNames.join(" and ");

        if (!spend.spendNames.length) {
            ui.notifications.info(`Firewood for the ${label} is provided.`);
        } else if (!spend.ok) {
            ui.notifications.info(`Firewood for ${label} taken from ${donors}; the rest is provided.`);
        } else {
            const allFromLighter = lighterName && spend.spendNames.every(n => n === lighterName);
            if (allFromLighter) {
                ui.notifications.info(`${donors} provides firewood for the ${label}.`);
            } else {
                ui.notifications.info(`Firewood for ${label} taken from ${donors}.`);
            }
        }
    }

    _syncTotmCampfireEmbedFromRest() {
        this._campfireApp?.syncFromRestFireLevel?.(
            this._fireLevel ?? "unlit",
            !!this._coldCampDecided
        );
    }

    /**
     * Apply a fire tier change from the minigame meter (douse, fuel). Uses the same spend rules as the Fire tab.
     * @param {string} level - embers | campfire | bonfire | unlit
     */
    async applyTotmFireLevelFromMinigame(level) {
        if (!this._totmFireUiEnabled()) return;
        const cur = this._fireLevel ?? "unlit";
        if (level === cur) return;

        if (level === "unlit") {
            if (!game.user.isGM) {
                ui.notifications.warn("Only the GM can fully extinguish the fire.");
                this._syncTotmCampfireEmbedFromRest();
                return;
            }
            await this.setColdCampDuringActivity();
            this.render();
            return;
        }

        if (!["embers", "campfire", "bonfire"].includes(level)) return;
        if (game.user.isGM) {
            await this.changeFireLevelDuringActivity(level, { fromMinigame: true });
        } else {
            emitActivityFireLevelRequest(level, game.user.id);
        }
        this._syncTotmCampfireEmbedFromRest();
    }

    /**
     * Mount campfire minigame embed (Make Camp ceremony or Activities side panel).
     * @param {"camp"|"activity"} mode
     */
    _mountCampfireEmbed(mode) {
        const forCamp = mode === "camp";
        if (forCamp && !this._campCeremonyMinigameEnabled()) return;
        if (!forCamp && !this._totmCampfireMinigamePanelEnabled()) return;

        const hostSelector = forCamp
            ? ".totm-camp-minigame-host"
            : ".totm-campfire-minigame-host";
        const host = this.element?.querySelector(hostSelector);
        if (!host) return;

        if (this._campfireApp) {
            this._campfireApp.rebindContainer(host);
            this._campfireApp.setContextActorId(this._selectedCharacterId);
            if (forCamp) {
                this._campfireApp.syncFromRestFireLevel("unlit", false);
                this._syncCampCeremonyPreviewToEmbed();
            } else {
                this._syncTotmCampfireEmbedFromRest();
            }
            void this._campfireApp.render().then(() => {
                this._scheduleRestWindowRecenter();
            });
            return;
        }

        const restApp = this;
        const partyCharacterIds = getPartyActors().map(a => a.id);
        const terrainTag = this._engine?.terrainTag ?? this._selectedTerrain ?? "forest";

        this._campfireApp = new CampfireEmbed(host, {
            partyCharacterIds,
            terrainTag,
            contextActorId: this._selectedCharacterId,
            disableDecay: true,
            showDouseBtn: !forCamp,
            makeCampCeremony: forCamp,
            onStageCeremonyWood: () => {
                const a = restApp._selectedCharacterId
                    ? game.actors.get(restApp._selectedCharacterId)
                    : null;
                const actorId = a?.id ?? getPartyActors()[0]?.id;
                if (!actorId) return Promise.resolve(false);
                return restApp.stageCeremonyWood(game.user.id, actorId);
            },
            onUnstageCeremonyWood: (slotId) => restApp.unstageCeremonyWood(slotId),
            onGiftCeremonyWood: () => restApp.giftCeremonyWoodToFocusedActor(),
            onCeremonyIgnited: (data) => restApp._commitMakeCampCeremonyIgnite({
                readyToLight: data?.readyToLight
            }),
            onFireLevelChange: (level) => {
                if (!forCamp) void restApp.applyTotmFireLevelFromMinigame(level);
            }
        });

        if (forCamp) {
            this._campfireApp.syncFromRestFireLevel("unlit", false);
            this._syncCampCeremonyPreviewToEmbed();
        } else {
            this._syncTotmCampfireEmbedFromRest();
        }

        registerCampfireEmbed(this._campfireApp);
        void this._campfireApp.render()
            .then(() => this._scheduleRestWindowRecenter())
            .catch(err => {
                console.error(`${MODULE_ID} | CampfireEmbed render failed:`, err);
            });
    }

    _tearDownCampfireEmbed() {
        if (!this._campfireApp) return;
        this._campfireApp.destroy();
        this._campfireApp = null;
        clearCampfireEmbed();
    }

    /**
     * Phase 3 (reflection): GM adjusts the campfire level.
     * Syncs fire level to all players.
     */
    static async #onSetFireLevel(event, target) {
        const level = target.dataset.fireLevel;
        if (!level) return;
        this._fireLevel = level;

        if (game.user.isGM && ["embers", "campfire", "bonfire"].includes(level)) {
            void CampfireTokenLinker.setLightState(true, level);
        }

        // Sync to players
        emitPhaseChanged("reflection", { fireLevel: level });

        this.render();
    }

    // â”€â”€ Meal Phase Handlers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    /**
     * Bind drag-and-drop for meal inventory items onto plate/goblet drop zones.
     * Pattern mirrors CampfireApp._bindTrinketDragDrop.
     */
    _bindMealDragDrop(el) {
        if (!el) return;
        if (this._mealSubmitted) return; // Lock UI after submission

        const stationEmbed = el?.closest?.(".station-meal-embed");
        if (stationEmbed) {
            const cid = stationEmbed.querySelector(".meal-drop-zone[data-character-id]")?.dataset?.characterId
                ?? stationEmbed.querySelector("[data-character-id]")?.dataset?.characterId;
            if (cid && this._activityMealRationsSubmitted?.has(cid)) return;
        }

        // Clear any stuck drag classes from previous render cycles or cancelled drags
        el.querySelectorAll(".dragging").forEach(n => n.classList.remove("dragging"));
        el.querySelectorAll(".drop-hover").forEach(n => n.classList.remove("drop-hover"));

        const items = el.querySelectorAll(".meal-inv-item[draggable], .meal-inv-card[draggable]");
        const dropZones = el.querySelectorAll(".meal-drop-zone");

        // Helper: set choice for a slot (both food and water are arrays)
        const setChoice = (charId, slot, itemId, slotIndex) => {
            if (!this._mealChoices) this._mealChoices = new Map();
            const existing = this._mealChoices.get(charId) ?? {};
            const arr = Array.isArray(existing[slot]) ? [...existing[slot]] : [];

            // Respect inventory-consumed locked slots
            const lockedKey = slot === "food" ? "foodLockedSlots" : "waterLockedSlots";
            const lockedSlots = Array.isArray(existing[lockedKey]) ? existing[lockedKey] : [];
            if (slotIndex !== undefined && lockedSlots.includes(slotIndex)) return;

            // Check available quantity -- prevent over-assignment
            const trayItem = el.querySelector(
                `.meal-inv-item[data-item-id="${itemId}"][data-slot="${slot}"][data-character-id="${charId}"],` +
                `.meal-inv-card[data-item-id="${itemId}"][data-slot="${slot}"][data-character-id="${charId}"]`
            );
            const available = trayItem ? parseInt(trayItem.dataset.available || "1") : 1;
            const alreadyAssigned = arr.filter(v => v === itemId).length;

            // If assigning to a specific slot that already has this item, it's a re-assign (allow)
            const isReassign = slotIndex !== undefined && arr[slotIndex] === itemId;
            if (!isReassign && alreadyAssigned >= available) {
                ui.notifications.warn(`Not enough ${slot === "food" ? "rations" : "water"} to fill another slot.`);
                return;
            }

            if (slotIndex !== undefined) {
                arr[slotIndex] = itemId;
            } else {
                // Fill first empty AND unlocked slot
                const emptyIdx = arr.findIndex((v, i) => (!v || v === "skip") && !lockedSlots.includes(i));
                if (emptyIdx >= 0) {
                    arr[emptyIdx] = itemId;
                } else {
                    arr.push(itemId);
                }
            }
            this._mealChoices.set(charId, { ...existing, [slot]: arr });
            // When food with satiates:water is placed, trim excess water entries
            if (slot === "food") this._autoTrimExcessWater(charId);
            notifyStationMealChoicesUpdated();
            this._refreshStationOverlayMeals();
            if (this.rendered) this.render();
        };

        const fillWaterPool = (charId, itemId, elRoot) => {
            if (!this._mealChoices) this._mealChoices = new Map();
            const existing = this._mealChoices.get(charId) ?? {};
            const arr = Array.isArray(existing.water) ? [...existing.water] : [];
            const lockedSlots = Array.isArray(existing.waterLockedSlots) ? existing.waterLockedSlots : [];

            const poolBar = elRoot.querySelector(".water-pool-bar");
            const wpd = parseInt(poolBar?.dataset?.target ?? "2", 10) || 0;
            while (arr.length < wpd) arr.push("skip");

            // Account for meal-based water credits from food slots
            const foodArr = Array.isArray(existing.food) ? existing.food : [];
            const satiatesLookup = this._buildSatiatesLookup();
            let bonusWater = 0;
            const actor = game.actors.get(charId);
            for (const fid of foodArr) {
                if (!fid || fid === "skip" || fid.startsWith?.("__")) continue;
                const fItem = actor?.items?.get(fid);
                if (!fItem) continue;
                const fFlags = fItem.flags?.[MODULE_ID] ?? {};
                let fSat = fFlags.satiates;
                if (!Array.isArray(fSat) && satiatesLookup) {
                    fSat = satiatesLookup.get(fItem.name.toLowerCase().trim()) ?? null;
                }
                if (Array.isArray(fSat) && fSat.includes("water")) bonusWater++;
            }

            let slotsNeeded = 0;
            for (let i = 0; i < wpd; i++) {
                if (lockedSlots.includes(i)) continue;
                const v = arr[i];
                if (!v || v === "skip") slotsNeeded++;
            }
            // Subtract bonus water from meal credits
            slotsNeeded = Math.max(0, slotsNeeded - bonusWater);
            if (slotsNeeded <= 0) {
                ui.notifications.info("Water is already sufficient.");
                return;
            }

            const trayCard = elRoot.querySelector(
                `.meal-inv-card[data-item-id="${itemId}"][data-slot="water"][data-character-id="${charId}"]`
            );
            let totalPints = parseInt(trayCard?.dataset?.totalPints ?? trayCard?.dataset?.available ?? "0", 10);
            if (!Number.isFinite(totalPints) || totalPints < 0) totalPints = 0;
            if (totalPints <= 0) {
                ui.notifications.warn("This water source is empty.");
                return;
            }

            const pintsToFill = Math.min(slotsNeeded, totalPints);
            for (let i = 0; i < pintsToFill; i++) {
                const emptyIdx = arr.findIndex((v, j) =>
                    j < wpd && (!v || v === "skip") && !lockedSlots.includes(j));
                if (emptyIdx >= 0) arr[emptyIdx] = itemId;
                else break;
            }
            this._mealChoices.set(charId, { ...existing, water: arr });
            notifyStationMealChoicesUpdated();
            this._refreshStationOverlayMeals();
            if (this.rendered) this.render();
        };

        // Draggable + clickable inventory items
        for (const item of items) {
            if (item._mealBound) continue;
            item._mealBound = true;
            item.addEventListener("dragstart", (e) => {
                e.dataTransfer.setData("text/plain", `meal:${item.dataset.slot}:${item.dataset.itemId}:${item.dataset.characterId}`);
                item.classList.add("dragging");
            });
            item.addEventListener("dragend", () => item.classList.remove("dragging"));

            // Click to select
            item.addEventListener("click", () => {
                const slot = item.dataset.slot;
                const charId = item.dataset.characterId;
                const itemId = item.dataset.itemId;
                if (!slot || !charId || !itemId) return;
                if (slot === "water") {
                    fillWaterPool(charId, itemId, el);
                    return;
                }
                setChoice(charId, slot, itemId);
            });
        }

        // Drop zones (plates and goblets)
        for (const zone of dropZones) {
            if (zone._mealBound) continue;
            zone._mealBound = true;

            // Slots consumed from inventory are locked â€” no interaction allowed
            if (zone.dataset.locked === "true") continue;

            const slot = zone.dataset.slot;
            const charId = zone.dataset.characterId;
            const slotIndex = zone.dataset.slotIndex !== undefined ? parseInt(zone.dataset.slotIndex) : undefined;

            zone.addEventListener("dragover", (e) => {
                if (slot === "water" && zone.dataset.poolFull === "true") return;
                if (!e.dataTransfer.types.includes("text/plain")) return;
                e.preventDefault();
                zone.classList.add("drop-hover");
            });

            zone.addEventListener("dragleave", (e) => {
                if (zone.contains(e.relatedTarget)) return;
                zone.classList.remove("drop-hover");
            });

            zone.addEventListener("drop", (e) => {
                e.preventDefault();
                zone.classList.remove("drop-hover");
                if (slot === "water" && zone.dataset.poolFull === "true") return;
                const raw = e.dataTransfer.getData("text/plain");
                if (!raw?.startsWith("meal:")) return;

                const [, dragSlot, itemId, dragCharId] = raw.split(":");
                if (dragSlot !== slot || dragCharId !== charId) return;
                if (slot === "water") {
                    fillWaterPool(charId, itemId, el);
                    return;
                }
                setChoice(charId, slot, itemId, slotIndex);
            });

            // Click on filled zone = clear it
            zone.addEventListener("click", () => {
                if (!this._mealChoices) return;
                if (slot === "water") {
                    const existing = this._mealChoices.get(charId) ?? {};
                    const lockedSlots = Array.isArray(existing.waterLockedSlots) ? existing.waterLockedSlots : [];
                    const prev = Array.isArray(existing.water) ? existing.water : [];
                    const poolBar = el.querySelector(".water-pool-bar");
                    const wpd = parseInt(poolBar?.dataset?.target ?? "2", 10) || 0;
                    const len = Math.max(wpd, prev.length);
                    const arr = [];
                    for (let i = 0; i < len; i++) {
                        arr[i] = lockedSlots.includes(i) ? prev[i] : "skip";
                    }
                    this._mealChoices.set(charId, { ...existing, water: arr });
                    notifyStationMealChoicesUpdated();
                    this._refreshStationOverlayMeals();
                    if (this.rendered) this.render();
                    return;
                }
                const existing = this._mealChoices.get(charId) ?? {};
                const arr = Array.isArray(existing[slot]) ? [...existing[slot]] : [];
                if (slotIndex !== undefined && arr[slotIndex] && arr[slotIndex] !== "skip") {
                    arr[slotIndex] = "skip";
                    this._mealChoices.set(charId, { ...existing, [slot]: arr });
                    notifyStationMealChoicesUpdated();
                    this._refreshStationOverlayMeals();
                    if (this.rendered) this.render();
                }
            });
        }
    }

    /**
     * Workbench Identify: drag unidentified items onto focus vs potion circles (station dialog).
     */
    /** @deprecated Use this._workbench.bindDragDrop() */
    _bindWorkbenchIdentifyDragDrop(el) {
        this._workbench.bindDragDrop(el);
    }

    /**
     * Meal: GM selects a food option for a character.
     */
    static #onMealSelectFood(event, target) { this._meals.onSelectFood(event, target); }
    static #onMealSelectWater(event, target) { this._meals.onSelectWater(event, target); }

    /**
     * Meal: Consume the current day's food/water for all owned characters.
     * Deducts items from inventory immediately, saves state, advances to next day.
     */
    static async #onConsumeMealDay(event, target) { await this._meals.onConsumeMealDay(event, target); }

    /**
     * Meal: Submit rations for the current character (GM) or all unsubmitted owned characters (player).
     * Delegates to submitActivityMealRationsFromStation, which handles both GM direct-consume and
     * player socket paths.
     */
    static async #onSubmitMealChoices(event, target) {
        if (this._isGM) {
            const charId = this._selectedCharacterId
                ?? target.closest("[data-character-id]")?.dataset.characterId;
            if (charId) await this.submitActivityMealRationsFromStation(charId);
            return;
        }
        // Player: submit for each owned character not yet recorded
        const submitted = this._activityMealRationsSubmitted ?? new Set();
        for (const charId of (this._myCharacterIds ?? [])) {
            if (!submitted.has(charId)) {
                await this.submitActivityMealRationsFromStation(charId);
            }
        }
    }

    /**
     * GM receives meal choices from a player via socket.
     * Merges into _mealChoices and tracks submission status.
     */
    receiveMealChoices(userId, choices) {
        void this._meals.receiveMealChoices(userId, choices).catch(err => {

            console.warn(`${MODULE_ID} | receiveMealChoices`, err);
        });
    }

    /**
     * Advance from post-activity bedding directly to the events phase.
     * Applies fire-level comfort modifiers, builds camp-preparation roll
     * requests, and broadcasts the phase change.
     */
    async _advanceToEvents() {
        if (this._phase === "activity") {
            void this._detectMagic?.cleanupCastArtifactsOnPhaseExit(getPartyActors());
        }
        // Bedding / Zzz persist through events until resolve or encounter interrupt.

        // Restore default window size and center on screen so the full events
        // header is visible regardless of how the user moved the window.
        const defaultWidth = RestSetupApp.DEFAULT_OPTIONS.position?.width ?? 720;
        this.setPosition({
            width: defaultWidth,
            left: Math.max(8, Math.round((window.innerWidth - defaultWidth) / 2))
        });

        if (this._engine?.safeRestSpot) {
            if (this._engine) {
                this._engine.fireRollModifier = 0;
                this._engine.fireLevel = "campfire";
            }
            this._fireLevel = "campfire";
            this._closeCampfire();
            this._triggeredEvents = [];
            this._eventsRolled = true;
            this._pendingCampRolls = [];
            await this._saveRestState();
            await RestSetupApp.#onResolveEvents.call(this, null, null);
            return;
        }

        // Apply fire level comfort modifications
        // Unlit: -1 comfort step | Embers: 0 | Campfire: 0 | Bonfire: +1 camp comfort
        const FIRE_COMFORT_MOD = { unlit: -1, embers: 0, campfire: 0, bonfire: 1 };
        const fireComfortMod = FIRE_COMFORT_MOD[this._fireLevel] ?? 0;
        if (fireComfortMod !== 0 && this._engine) {
            let rank = COMFORT_RANK[this._engine.comfort] ?? 1;
            rank = Math.max(0, Math.min(3, rank + fireComfortMod));
            this._engine.comfort = RANK_TO_KEY[rank];
        }

        if (this._engine) {
            this._engine.fireRollModifier = CampGearScanner.FIRE_ENCOUNTER_MOD_BY_LEVEL[this._fireLevel] ?? 0;
            this._engine.fireLevel = this._fireLevel;
        }

        // Close campfire panel
        this._closeCampfire();

        this._eventsRolled = false;
        this._phase = "events";
        this._eventPoolQuietNightBypass = false;

        // === Camp Preparations: identify camp activities needing pre-event rolls ===
        this._pendingCampRolls = [];
        const campActivities = (this._activities ?? []).filter(a => a.category === "camp");
        const partyActors = getPartyActors();

        for (const actor of partyActors) {
            const gmOverride = this._gmOverrides.get(actor.id);
            const playerChoice = this._getPlayerChoiceForCharacter(actor.id);
            const activityId = gmOverride ?? playerChoice?.activityId ?? null;
            if (!activityId) continue;

            const activity = campActivities.find(a => a.id === activityId);
            if (!activity) continue;

            if (!activity.check) {
                // Keep Watch: no check, auto-resolve immediately
                this._earlyResults.set(actor.id, {
                    source: "activity",
                    activityId,
                    result: "success",
                    effects: activity.outcomes?.success?.effects ?? [],
                    narrative: activity.outcomes?.success?.narrative ?? activity.description
                });
                continue;
            }

            const existingResult = this._earlyResults?.get(actor.id);
            if (existingResult && existingResult.activityId === activityId
                && existingResult.result !== "pending_approval") {
                continue;
            }

            // Activity needs a player roll (Set Up Defenses, Scout Perimeter)
            // Calculate adjusted DC with comfort friction
            const comfortDcMod = { safe: 0, sheltered: 0, rough: 2, hostile: 5 };
            const baseDc = activity.check.dc ?? 12;
            const adjustedDc = baseDc + (comfortDcMod[this._engine?.comfort] ?? 0);

            // Determine best skill for this character
            let skillKey = activity.check.skill;
            if (activity.check.altSkill) {
                const primary = actor.system?.skills?.[activity.check.skill]?.total ?? 0;
                const alt = actor.system?.skills?.[activity.check.altSkill]?.total ?? 0;
                if (alt > primary) skillKey = activity.check.altSkill;
            }
            const skillName = SKILL_NAMES[skillKey] ?? skillKey;

            this._pendingCampRolls.push({
                characterId: actor.id,
                characterName: actor.name,
                activityId,
                activityName: activity.name,
                icon: activity.id === "act_defenses" ? "fas fa-shield-alt" : "fas fa-binoculars",
                skill: skillKey,
                skillName,
                dc: adjustedDc,
                baseDC: adjustedDc,
                requested: false,
                status: "pending",
                total: null,
                result: null
            });
        }

        await this._saveRestState();

        // Broadcast phase change (camp roll requests are sent individually via GM "request roll" button)
        emitPhaseChanged("events", {
                eventsRolled: false,
                fireLevel: this._fireLevel,
                campStatus: this._campStatus
            });

        this.render();
    }

    receiveMealDayConsumeRequest(userId, consumeByCharacter) {
        return this._meals.receiveMealDayConsumeRequest(userId, consumeByCharacter);
    }

    async receiveMealDayConsumed(userId, clientChoices) { await this._meals.receiveMealDayConsumed(userId, clientChoices); }

    async receiveDehydrationPrompt(characterId, actorName, dc) { await this._meals.receiveDehydrationPrompt(characterId, actorName, dc); }

    async receiveDehydrationResult(data) { await this._meals.receiveDehydrationResult(data); }

    /**
     * Meal -> Reflection: GM proceeds from meal phase.
     * Applies consumption (decrements rations/waterskin) and updates tracking flags.
     */
    static async #onProceedFromMeal(event, target) { await this._meals.onProceedFromMeal(event, target); }

    /**
     * GM skips all unresolved dehydration saves, auto-failing them.
     * Applies exhaustion and posts chat for each, then unblocks the flow.
     */
    static async #onSkipPendingSaves(event, target) { await this._meals.onSkipPendingSaves(event, target); }

    /**
     * Lock the events-phase UI while a night check or pool pick resolves.
     * @returns {boolean} false if a commit is already in flight or the phase is closed.
     */
    static #beginEventsCommit() {
        if (this._eventsCommitPending || this._eventsRolled) return false;
        if (!this._engine || this._phase !== "events") return false;
        this._eventsCommitPending = true;
        this.render();
        return true;
    }

    /** Clear the events-phase commit lock and re-render if still pre-roll. */
    static #endEventsCommit() {
        if (!this._eventsCommitPending) return;
        this._eventsCommitPending = false;
        if (!this._eventsRolled) this.render();
    }

    /**
     * Phase 3: GM rolls for events. Performs the actual event table roll
     * and displays results.
     */
    static async #onRollEvents(event, target) {
        // Debug: force an encounter event if flag is set
        if (this._forceEncounter) {
            this._forceEncounter = false;
            const terrainTag = this._engine?.terrainTag ?? "forest";
            const table = this._eventResolver.tables.get(terrainTag);
            if (table) {
                const encounterEntry = table.entries.find(e => {
                    const ev = this._eventResolver.events.get(e.eventId);
                    return ev?.category === "encounter";
                });
                if (encounterEntry) {
                    const ev = this._eventResolver.events.get(encounterEntry.eventId);
                    const targets = getPartyActors().map(a => a.id);
                    this._triggeredEvents = [{
                        id: ev.id, name: ev.name, category: ev.category,
                        description: ev.description, mechanical: ev.mechanical,
                        isDecisionTree: ev.mechanical?.type === "decision_tree",
                        targets, rollTotal: 1, result: "triggered",
                        narrative: ev.description,
                        items: ev.mechanical?.onSuccess?.items ?? [],
                        effects: ev.mechanical?.onFailure?.effects ?? []
                    }];
                    ui.notifications.info(`Forced encounter: ${ev.name}`);
                } else {
                    this._triggeredEvents = await this._engine.resolveEvents(this._eventResolver, this._engine._encounterBreakdown?.scoutingResult);
                }
            } else {
                this._triggeredEvents = await this._engine.resolveEvents(this._eventResolver, this._engine._encounterBreakdown?.scoutingResult);
            }
        } else {
            this._triggeredEvents = await this._engine.resolveEvents(this._eventResolver, this._engine._encounterBreakdown?.scoutingResult);
        }

        // Check for disaster choice (nat 1)
        if (this._triggeredEvents.disasterChoice) {
            this._disasterChoice = this._triggeredEvents.disasterChoice;
            this._triggeredEvents = []; // Clear until GM picks
            this._eventsRolled = true;
            await this._saveRestState();
            this.render();
            return; // Wait for GM to pick via #onDisasterChoice
        }

        this._eventsRolled = true;

        await RestSetupApp.#finalizeEventsRoll.call(this);
    }

    /**
     * Shared tail after any events-phase roll or manual pick: combat buff chat,
     * decision-tree init, player sync, persist, and re-render.
     */
    static async #finalizeEventsRoll() {
        // Store combat buff summary for UI display when encounter detected
        const hasEncounter = this._triggeredEvents?.some(e => e.category === "encounter" || e.category === "combat");
        if (hasEncounter && this._engine && this._activityResolver) {
            const buffs = this._engine.aggregateCombatBuffs(this._activityResolver);
            this._combatBuffs = buffs;
            if (buffs.perCharacter.length > 0) {
                const lines = buffs.perCharacter.map(b => `<strong>${b.characterName}</strong> (${b.activityName}): ${b.summary}`);
                if (buffs.partyWide.summary) lines.push(`<em>${buffs.partyWide.summary}</em>`);
                await ChatMessage.create({
                    content: `<div style="border-left:3px solid #7eb8da;padding-left:8px;"><strong>Combat Readiness</strong><br>${lines.join("<br>")}</div>`,
                    speaker: { alias: "Respite" }
                });
            }
        }

        // Check for decision tree events
        const treeEvent = this._triggeredEvents.find(e => e.isDecisionTree);
        if (treeEvent) {
            this._activeTreeState = DecisionTreeResolver.createTreeState(
                { id: treeEvent.id, name: treeEvent.name, description: treeEvent.description, mechanical: treeEvent.mechanical },
                treeEvent.targets
            );
            if (treeEvent.mechanical?.stallPenalty) {
                this._activeTreeState.stallPenalty = treeEvent.mechanical.stallPenalty;
                this._activeTreeState.hasStallPenalty = true;
                this._activeTreeState.stalled = false;
            }
        }

        emitPhaseChanged("events", {
                triggeredEvents: this._triggeredEvents,
                activeTreeState: this._activeTreeState,
                eventsRolled: true
            });

        await this._saveRestState();
        this.render();
    }

    /**
     * GM rolls the night check but runs their own off-the-cuff scenario on a
     * trigger instead of drawing from the pool. Nat 1 triggers (no disaster pool picker).
     */
    static async #onImproviseEvent(event, target) {
        if (!game.user.isGM) return;
        if (!this._engine || this._phase !== "events" || this._eventsRolled) return;

        const effectiveDC = this._engine.getEffectiveEncounterDC();
        const roll = await new Roll("1d20").evaluate();
        const rawDie = roll.total;
        const triggered = rawDie === 1 || rawDie < effectiveDC;
        const terrainTag = this._engine.terrainTag ?? "forest";

        if (triggered) {
            await roll.toMessage({
                speaker: { alias: "Night Watch" },
                flavor: `<strong>Improvised night check</strong> (${terrainTag}) threshold ${effectiveDC}<br>${rawDie} below the threshold. Run your own scenario at the table.`,
                whisper: game.users.filter(u => u.isGM).map(u => u.id)
            });
            this._triggeredEvents = [{
                id: `adhoc_${Date.now()}`,
                name: "Improvised Encounter",
                category: "encounter",
                description: "",
                mechanical: null,
                isDecisionTree: false,
                targets: [],
                rollTotal: rawDie,
                result: "triggered",
                narrative: "",
                adHoc: true
            }];
        } else {
            await roll.toMessage({
                speaker: { alias: "Night Watch" },
                flavor: `<strong>Improvised night check</strong> (${terrainTag}) threshold ${effectiveDC}<br>${rawDie} meets or beats the threshold. The night passes without incident.`,
                whisper: game.users.filter(u => u.isGM).map(u => u.id)
            });
            this._triggeredEvents = [];
        }

        this._eventsRolled = true;
        await RestSetupApp.#finalizeEventsRoll.call(this);
    }

    /**
     * GM override: declare a quiet night with no event. No dice, no DC.
     * Available when encounters are on (footer link) or off (primary button).
     */
    static async #onNightPasses(event, target) {
        if (!game.user.isGM) return;
        if (!RestSetupApp.#beginEventsCommit.call(this)) return;
        try {
            await ChatMessage.create({
                speaker: { alias: "Night Watch" },
                content: `<div style="border-left:3px solid #7eb8da;padding-left:8px;"><strong>Night Watch</strong><br>The night passes without incident.</div>`,
                whisper: game.users.filter(u => u.isGM).map(u => u.id)
            });
            this._triggeredEvents = [];
            this._eventsRolled = true;
            await RestSetupApp.#finalizeEventsRoll.call(this);
        } finally {
            RestSetupApp.#endEventsCommit.call(this);
        }
    }

    /**
     * Encounters-off night: the GM chooses to run an event by hand. No dice;
     * an ad-hoc event is staged for the GM to narrate at the table.
     */
    static async #onImproviseNight(event, target) {
        if (!game.user.isGM) return;
        if (!this._engine || this._phase !== "events" || this._eventsRolled) return;
        try {
            if (!game.settings.get(MODULE_ID, "enableEncounters")) return;
        } catch { /* settings not ready */ }
        this._triggeredEvents = [{
            id: `adhoc_${Date.now()}`,
            name: "Improvised Encounter",
            category: "encounter",
            description: "",
            mechanical: null,
            isDecisionTree: false,
            targets: [],
            rollTotal: null,
            result: "triggered",
            narrative: "",
            adHoc: true
        }];
        this._eventsRolled = true;
        await RestSetupApp.#finalizeEventsRoll.call(this);
    }

    /**
     * GM picks a curated pool event without rolling the night check.
     */
    static async #onPickPoolEvent(event, target) {
        if (!game.user.isGM) return;
        if (!this._engine || this._phase !== "events" || this._eventsRolled) return;

        const terrainTag = this._engine.terrainTag ?? this._selectedTerrain ?? "forest";
        const poolEvents = listPoolEventsForTerrain(this._eventResolver, terrainTag);
        if (!poolEvents.length) {
            ui.notifications.warn("No events in the curated pool for this terrain. Curate the pool first.");
            return;
        }

        const terrain = TerrainRegistry.get(terrainTag);
        const terrainLabel = terrain?.label ?? terrainTag;
        const eventId = await pickPoolEvent(poolEvents, terrainLabel, terrainTag);
        if (!eventId) return;

        const catalogEvent = this._eventResolver.events.get(eventId);
        if (!catalogEvent) {
            ui.notifications.error("Selected event is no longer in the pool.");
            return;
        }

        const watchRoster = this._engine.watchRoster ?? [];
        this._triggeredEvents = [
            this._eventResolver.buildManualResult(catalogEvent, watchRoster, { result: "manual_pick" })
        ];
        this._eventsRolled = true;
        await RestSetupApp.#finalizeEventsRoll.call(this);
    }

    /**
     * Switch the pre-roll events mode (segmented control on the Night Watch
     * card). Updates instance state and re-renders the card body and the
     * single primary commit button.
     */
    static async #onSetEventsMode(event, target) {
        if (!game.user.isGM) return;
        if (this._eventsCommitPending) return;
        if (this._phase !== "events" || this._eventsRolled) return;
        const mode = target?.dataset?.mode;
        if (!["random", "improvise", "pick"].includes(mode)) return;
        if (this._eventsMode === mode) return;
        this._eventsMode = mode;
        this.render();
    }

    /**
     * Single commit dispatcher for the Night Watch card. Routes to the
     * existing handler for the currently selected mode.
     */
    static async #onCommitEventsMode(event, target) {
        if (!game.user.isGM) return;
        if (!RestSetupApp.#beginEventsCommit.call(this)) return;
        try {
            switch (this._eventsMode) {
                case "improvise":
                    await RestSetupApp.#onImproviseEvent.call(this, event, target);
                    break;
                case "pick":
                    await RestSetupApp.#onPickPoolEvent.call(this, event, target);
                    break;
                case "random":
                default:
                    await RestSetupApp.#onRollEvents.call(this, event, target);
                    break;
            }
        } finally {
            RestSetupApp.#endEventsCommit.call(this);
        }
    }

    /**
     * GM acknowledges an encounter event and begins combat.
     * Sets awaitingCombat flag, saves state, and closes the rest window
     * so the GM can set up the fight. The GM indicator bar will appear.
     */
    static async #onAcknowledgeEncounter(event, target) {
        await this._removeBeddingDown();
        this._awaitingCombat = true;
        this._combatAcknowledged = false;
        this._combatBuffs = this._combatBuffs ?? null;
        await this._saveRestState();

        // Broadcast to players
        emitPhaseChanged("events", {
                triggeredEvents: this._triggeredEvents,
                activeTreeState: this._activeTreeState,
                eventsRolled: true,
                awaitingCombat: true
            });

        ui.notifications.info("Set up and run the encounter. Reopen Respite and click 'Combat Complete' when done.");

        // Close the window (GM indicator bar will show)
        this.close();
    }

    /**
     * GM marks the encounter combat as complete.
     * Clears the awaiting flag so the GM can proceed to resolution.
     */
    static async #onCompleteEncounter(event, target) {
        this._awaitingCombat = false;
        this._combatAcknowledged = true;
        await this._saveRestState();

        // Broadcast to players
        emitPhaseChanged("events", {
                triggeredEvents: this._triggeredEvents,
                activeTreeState: this._activeTreeState,
                eventsRolled: true,
                awaitingCombat: false
            });

        this.render();
    }

    /**
     * Hide the rest window during combat without ending the rest.
     * GM can reopen via the persistent GM banner.
     */
    static #onHideWindow(event, target) {
        this.close();
    }

    /**
     * Player: leave post-station review, revert that activity pick, hide the window again.
     */
    static async #onExitStationChoiceReview(event, target) {
        event?.preventDefault?.();
        if (!this._postStationChoiceReview) return;
        const charId = this._stationReviewCharacterId;
        this._postStationChoiceReview = false;
        this._stationReviewCharacterId = null;
        if (charId) this._revertStationActivityChoice(charId);
        await this.close({ retainPlayerApp: true, skipRejoin: true });
    }

    /**
     * Detect Magic: scan party inventories, or dismiss an active scan on second click.
     */
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

    /**
     * Identify a specific scanned item via ritual casting.
     */
    static async #onIdentifyScannedItem(event, target) {
        const actorId = target.dataset.actorId;
        const itemId = target.dataset.itemId;
        if (!actorId || !itemId) return;
        await this.identifyScannedMagicItem(actorId, itemId);
    }

    /**
     * GM: Abandon the active rest after confirmation.
     * Clears state, notifies players, and closes the window.
     */
    static async #onAbandonRest(event, target) {
        if (!game.user.isGM) return;
        if (this._eventsCommitPending) return;

        const confirmed = await new Promise(resolve => {
            const overlay = document.createElement("div");
            overlay.classList.add("ionrift-armor-modal-overlay");
            overlay.innerHTML = `
                <div class="ionrift-armor-modal">
                    <h3><i class="fas fa-exclamation-triangle"></i> Abandon Rest?</h3>
                    <p>This will cancel the rest for all players. Any unsaved progress will be lost.</p>
                    <div class="ionrift-armor-modal-buttons">
                        <button class="btn-armor-confirm"><i class="fas fa-times"></i> Abandon</button>
                        <button class="btn-armor-cancel"><i class="fas fa-arrow-left"></i> Continue Resting</button>
                    </div>
                </div>`;
            document.body.appendChild(overlay);
            overlay.querySelector(".btn-armor-confirm").addEventListener("click", () => {
                overlay.remove();
                resolve(true);
            });
            overlay.querySelector(".btn-armor-cancel").addEventListener("click", () => {
                overlay.remove();
                resolve(false);
            });
        });
        if (!confirmed) return;

        await this._removeBeddingDown();

        // Clear persisted rest state
        await game.settings.set(MODULE_ID, "activeRest", {});

        // Detect Magic + workbench staging (skip save: activeRest already cleared)
        this._clearDetectMagicScanSession({ skipSave: true });

        // Broadcast to players so they close their windows
        emitRestAbandoned();

        // Clean up camp tokens from the scene
        clearCampTokens().catch(err => console.warn(`${MODULE_ID} | Camp cleanup failed:`, err));
        resetCampSession();
        this._campFireWoodSpendUserId = null;
        this._fireLitBy = null;
        this._firewoodPledges = new Map();
        this._coldCampDecided = false;
        this._campStep2Entered = false;
        this._tearDownStationLayerCanvas();
        this._removeGmStationTokenSyncHook();

        // Clear module-level references
        const { clearActiveRestApp } = await import("../module.js");
        clearActiveRestApp();

        ui.notifications.info("Rest abandoned.");
        this.close({ resolved: true, abandoned: true });
    }

    /**
     * Player approves a Copy Spell transaction.
     */
    static #onApproveCopySpell(event, target) { this._copySpell.onApprove(event, target); }
    static #onDeclineCopySpell(event, target) { this._copySpell.onDecline(event, target); }
    static async #onProcessGmCopySpell(event, target) { await this._copySpell.onProcessGm(event, target); }
    static async #onDismissGmCopySpell(event, target) { await this._copySpell.onDismiss(event, target); }
    static #onResendCopySpellRoll(event, target) { this._copySpell.onResendRoll(event, target); }
    static async #onGmCopySpellFallback(event, target) { await this._copySpell.onGmFallback(event, target); }
    static async #onRollCopySpellArcana(event, target) { await this._copySpell.onRollArcana(event, target); }

    /**
     * Phase 3 (events): GM chooses between disaster tree, combat encounter, or two normal events after a nat 1.
     */
    static async #onDisasterChoice(event, target) {
        const pick = target.dataset.pick; // "tree", "encounter", "normals", or "dismiss"
        if (!this._disasterChoice || !pick) return;

        if (pick === "dismiss") {
            // GM discretion: skip disaster events entirely
            this._disasterChoice = null;
        } else if (pick === "tree" && this._disasterChoice.tree) {
            this._triggeredEvents = [this._disasterChoice.tree];
        } else if (pick === "encounter" && this._disasterChoice.encounter) {
            this._triggeredEvents = [this._disasterChoice.encounter];
        } else if (pick === "normals" && this._disasterChoice.normals?.length) {
            this._triggeredEvents = [...this._disasterChoice.normals];
        } else {
            // Fallback: use whatever is available (tree > encounter > normals)
            this._triggeredEvents = this._disasterChoice.tree
                ? [this._disasterChoice.tree]
                : this._disasterChoice.encounter
                    ? [this._disasterChoice.encounter]
                    : [...(this._disasterChoice.normals ?? [])];
        }

        this._disasterChoice = null;

        // Store combat buff summary for UI display when encounter/combat events chosen
        const hasEncounter = this._triggeredEvents?.some(e => e.category === "encounter" || e.category === "combat");
        if (hasEncounter && this._engine && this._activityResolver) {
            const buffs = this._engine.aggregateCombatBuffs(this._activityResolver);
            this._combatBuffs = buffs;
            if (buffs.perCharacter.length > 0) {
                const lines = buffs.perCharacter.map(b => `<strong>${b.characterName}</strong> (${b.activityName}): ${b.summary}`);
                if (buffs.partyWide.summary) lines.push(`<em>${buffs.partyWide.summary}</em>`);
                await ChatMessage.create({
                    content: `<div style="border-left:3px solid #7eb8da;padding-left:8px;"><strong>Combat Readiness</strong><br>${lines.join("<br>")}</div>`,
                    speaker: { alias: "Respite" }
                });
            }
        }

        // Check for decision tree events
        const treeEvent = this._triggeredEvents.find(e => e.isDecisionTree);
        if (treeEvent) {
            this._activeTreeState = DecisionTreeResolver.createTreeState(
                { id: treeEvent.id, name: treeEvent.name, description: treeEvent.description, mechanical: treeEvent.mechanical },
                treeEvent.targets
            );
        }

        // Broadcast results to players
        emitPhaseChanged("events", {
                triggeredEvents: this._triggeredEvents,
                activeTreeState: this._activeTreeState,
                eventsRolled: true
            });

        await this._saveRestState();
        this.render();
    }

    /**
     * Phase 3 (events): GM selects a decision tree choice.
     * Enters the configure-modifiers phase (no request sent to players yet).
     * The GM must click "Send Roll Request" to dispatch.
     */
    static async #onResolveTreeChoice(event, target) {
        const choiceId = target.dataset.choiceId;
        if (!choiceId || !this._activeTreeState) return;

        const prepared = DecisionTreeResolver.prepareChoice(this._activeTreeState, choiceId);
        if (!prepared) return;

        // Enter pending-roll state â€” but do NOT dispatch to players yet
        this._activeTreeState.awaitingRolls = true;
        this._activeTreeState.rollRequestSent = false;
        this._activeTreeState.pendingChoice = choiceId;
        this._activeTreeState.pendingRolls = [...prepared.targetIds];
        this._activeTreeState.resolvedRolls = [];
        this._activeTreeState.pendingCheck = prepared.check;
        // Roll modes: per-character override map (normal/advantage/disadvantage/force-pass/force-fail)
        this._activeTreeState.pendingRollModes = {};
        // Spell rulings advisory for the awaiting panel
        this._activeTreeState.pendingChoiceSpellRulings = prepared.option.spellRulings ?? null;
        this._activeTreeState.pendingCheckContext = prepared.check?.checkContext ?? null;

        // Determine skill name for display
        const skillKey = pickBestSkill(
            game.actors.get(prepared.targetIds[0]),
            prepared.skills
        );
        const skillName = SKILL_DISPLAY_NAMES[skillKey] ?? skillKey;
        this._activeTreeState.pendingSkillName = skillName;
        this._activeTreeState.pendingSkillKey = skillKey;
        this._activeTreeState.pendingDC = prepared.dc;

        await this._saveRestState();
        this.render();
    }

    /**
     * GM dispatches the tree roll request to players.
     * Called after the GM has finished configuring per-character modifiers.
     */
    static async #onSendTreeRollRequest(event, target) {
        if (!game.user.isGM) return;
        if (!this._activeTreeState?.awaitingRolls) return;

        this._activeTreeState.rollRequestSent = true;

        // A force override is the GM's decision, not the player's. Resolve those
        // characters here so the player is never asked to confirm an outcome the
        // GM already set. Snapshot the ids first since receiveTreeRollResult
        // mutates pendingRolls as each result lands.
        const modes = this._activeTreeState.pendingRollModes ?? {};
        const dc = this._activeTreeState.pendingDC ?? 12;
        const forcedIds = (this._activeTreeState.pendingRolls ?? []).filter(
            id => modes[id] === "force-pass" || modes[id] === "force-fail"
        );
        for (const characterId of forcedIds) {
            const actor = game.actors.get(characterId);
            const total = modes[characterId] === "force-pass" ? dc : 0;
            await this.receiveTreeRollResult({ characterId, characterName: actor?.name ?? "Unknown", total });
        }

        // If forcing resolved every participant, the tree is done; nothing to dispatch.
        if (!this._activeTreeState?.awaitingRolls) return;

        // Broadcast roll request to the remaining (non-forced) players
        const resolvedRolls = this._activeTreeState.resolvedRolls ?? [];
        emitTreeRollRequest({
                    choiceId: this._activeTreeState.pendingChoice,
                    skills: this._activeTreeState.pendingCheck?.skills ?? [],
                    skillName: this._activeTreeState.pendingSkillName ?? "Skill",
                    dc: this._activeTreeState.pendingDC ?? 12,
                    targets: [
                        ...(this._activeTreeState.pendingRolls ?? []),
                        ...resolvedRolls.map(r => r.characterId ?? r.actorId)
                    ],
                    eventName: this._activeTreeState.eventName,
                    rollModes: this._activeTreeState.pendingRollModes ?? {},
                    resolvedRolls
                });

        // Broadcast updated tree state so players see roll buttons
        emitPhaseChanged("events", {
                triggeredEvents: this._triggeredEvents,
                activeTreeState: this._activeTreeState,
                eventsRolled: true,
                campStatus: this._campStatus
            });

        await this._saveRestState();
        this.render();
    }

    /**
     * GM receives a decision tree roll result from a player.
     * Collects results and auto-resolves when all expected rolls are in.
     */
    /** @deprecated Thin proxy â€” delegates to EventsPhaseDelegate */
    async receiveTreeRollResult(data) {
        return this._events.receiveTreeRollResult(data);
    }

    /**
     * GM rolls a tree check on behalf of an unresponsive player.
     * Respects the pendingRollModes flag for that character.
     * Force-pass / force-fail bypass the dice entirely.
     */
    static async #onRollTreeForPlayer(event, target) {
        if (!game.user.isGM) return;
        const characterId = target.dataset.characterId;
        if (!characterId || !this._activeTreeState?.awaitingRolls) return;

        const actor = game.actors.get(characterId);
        if (!actor) return;

        const rollMode = this._activeTreeState.pendingRollModes?.[characterId] ?? "normal";
        const dc = this._activeTreeState.pendingDC ?? 12;

        // Force outcomes inject a synthetic total
        if (rollMode === "force-pass" || rollMode === "force-fail") {
            const total = rollMode === "force-pass" ? dc : 0;
            await this.receiveTreeRollResult({ characterId, characterName: actor.name, total });
            return;
        }

        const skills = this._activeTreeState.pendingCheck?.skills ?? [];
        const context = `${this._activeTreeState.eventName} - Decision`;

        const result = await rollForPlayer(actor, skills, dc, context, rollMode);

        // Feed the result back through the normal collection path
        await this.receiveTreeRollResult({
            characterId,
            characterName: actor.name,
            total: result.total
        });
    }

    /**
     * GM re-broadcasts the tree roll request for crash recovery.
     * Includes current rollModes so players get any existing flags.
     */
    static #onResendTreeRollRequest(event, target) {
        if (!game.user.isGM) return;
        if (!this._activeTreeState?.awaitingRolls) return;

        const resolvedRolls = this._activeTreeState.resolvedRolls ?? [];
        emitTreeRollRequest({
                    choiceId: this._activeTreeState.pendingChoice,
                    skills: this._activeTreeState.pendingCheck?.skills ?? [],
                    skillName: this._activeTreeState.pendingSkillName ?? "Skill",
                    dc: this._activeTreeState.pendingDC ?? 12,
                    targets: [
                        ...(this._activeTreeState.pendingRolls ?? []),
                        ...resolvedRolls.map(r => r.characterId ?? r.actorId)
                    ],
                    eventName: this._activeTreeState.eventName,
                    rollModes: this._activeTreeState.pendingRollModes ?? {},
                    resolvedRolls
                });

        ui.notifications.info("Tree roll request re-sent to players.");
    }

    /**
     * GM cycles roll modifier for one character: normal, advantage, disadvantage,
     * auto-pass, auto-fail. One click target (the portrait) keeps the axis unambiguous.
     */
    static #onCycleTreeRollMode(event, target) {
        event.preventDefault?.();
        if (!game.user.isGM) return;
        const characterId = target.dataset.characterId;
        if (!characterId || !this._activeTreeState?.awaitingRolls) return;

        if (!this._activeTreeState.pendingRollModes) this._activeTreeState.pendingRollModes = {};
        const CYCLE = {
            normal: "advantage",
            advantage: "disadvantage",
            disadvantage: "force-pass",
            "force-pass": "force-fail",
            "force-fail": "normal"
        };
        const current = this._activeTreeState.pendingRollModes[characterId] ?? "normal";
        this._activeTreeState.pendingRollModes[characterId] = CYCLE[current] ?? "normal";

        RestSetupApp.#broadcastTreeRollModes.call(this);
        this.render();
    }

    /**
     * Push current tree roll modes to players so their badges refresh live.
     */
    static #broadcastTreeRollModes() {
        emitPhaseChanged("events", {
                triggeredEvents: this._triggeredEvents,
                activeTreeState: this._activeTreeState,
                eventsRolled: true,
                campStatus: this._campStatus
            });
    }

    /**
     * GM rolls an event check on behalf of an unresponsive player.
     */
    static async #onRollEventForPlayer(event, target) {
        if (!game.user.isGM) return;
        const button = target.closest(".btn-roll-for-player") ?? target;
        const characterId = button.dataset.characterId;
        const eventIndex = Number.parseInt(button.dataset.eventIndex, 10);
        if (!Number.isFinite(eventIndex)) {
            ui.notifications.warn("Could not resolve which event check to roll for.");
            return;
        }
        const pendingKey = `${eventIndex}:${characterId}`;
        if (!this._eventGmRollPending) this._eventGmRollPending = new Set();
        if (this._eventGmRollPending.has(pendingKey)) return;

        const triggeredEvent = this._triggeredEvents?.[eventIndex];
        if (!triggeredEvent?.awaitingRolls || !characterId) {
            ui.notifications.warn("This event is not waiting for that roll.");
            return;
        }
        if (triggeredEvent.resolvedRolls?.some(r => r.characterId === characterId)) {
            ui.notifications.info(`${triggeredEvent.resolvedRolls.find(r => r.characterId === characterId)?.name ?? "That character"} already rolled.`);
            return;
        }

        const actor = game.actors.get(characterId);
        if (!actor) return;

        this._eventGmRollPending.add(pendingKey);
        disableRollButton(button);

        try {
            const skill = triggeredEvent.mechanical?.skill ?? "sur";
            const dc = triggeredEvent.mechanical?.dc ?? 10;
            const skillName = SKILL_DISPLAY_NAMES[skill] ?? skill;
            const context = `${triggeredEvent.name ?? "Event"} (${skillName})`;
            const rollMode = triggeredEvent.rollModes?.[characterId] ?? "normal";

            const result = await rollForPlayer(actor, [skill], dc, context, rollMode);

            await this.receiveRollResult({
                eventIndex,
                characterId,
                characterName: actor.name,
                total: result.total
            });
        } catch (err) {

            console.error("[Respite] GM event roll for player failed:", err);
            ui.notifications.error(`Failed to roll for ${actor.name}.`);
            this.render();
        } finally {
            this._eventGmRollPending.delete(pendingKey);
        }
    }

    /**
     * GM rolls a camp activity check on behalf of an unresponsive player.
     */
    static async #onRollCampForPlayer(event, target) {
        if (!game.user.isGM) return;
        const characterId = target.dataset.characterId;
        if (!characterId) return;

        const entry = this._pendingCampRolls?.find(
            p => p.characterId === characterId && p.status === "pending" && p.requested
        );
        if (!entry) return;

        const actor = game.actors.get(characterId);
        if (!actor) return;

        const context = `${entry.activityName} (${entry.skillName})`;
        const result = await rollForPlayer(actor, [entry.skill], entry.dc, context);

        // Feed through the normal collection path
        this.receiveCampRollResult({
            characterId,
            characterName: actor.name,
            activityId: entry.activityId,
            total: result.total
        });
    }

    /**
     * Phase 3 (events): GM applies the stall penalty to the decision tree.
     * Bumps all option DCs, posts the stall narrative, and marks as stalled.
     */
    static async #onApplyStallPenalty(event, target) {
        if (!this._activeTreeState?.stallPenalty) return;

        const penalty = this._activeTreeState.stallPenalty;
        const bump = penalty.dcBump ?? 2;
        const stallCount = (this._activeTreeState.stallCount ?? 0) + 1;

        // Bump DC on all current options
        for (const opt of this._activeTreeState.options) {
            if (opt.check) opt.check.dc += bump;
        }

        this._activeTreeState.stalled = true;
        this._activeTreeState.stallCount = stallCount;
        this._activeTreeState.totalStallBump = (this._activeTreeState.totalStallBump ?? 0) + bump;

        // If rolls are in progress, bump the pending DC for remaining rolls
        if (this._activeTreeState.awaitingRolls && this._activeTreeState.pendingDC) {
            this._activeTreeState.pendingDC += bump;
        }

        // Post stall narrative to chat
        const suffix = stallCount > 1 ? ` (x${stallCount})` : "";
        ChatMessage.create({
            content: `<div class="respite-stall-message"><strong>The party stalled${suffix}.</strong><br>${penalty.narrative}</div>`,
            speaker: { alias: "Respite" }
        });

        // Track upfront loss as an effect to apply at resolution
        if (penalty.upfrontLoss) {
            if (!this._activeTreeState.stallEffects) this._activeTreeState.stallEffects = [];
            this._activeTreeState.stallEffects.push(penalty.upfrontLoss);
        }

        await this._saveRestState();
        this.render();
    }

    /**
     * Phase 3 (events): GM adjusts the DC on all decision tree options up by 1.
     */
    static #onTreeDcAdjUp(event, target) {
        if (!this._activeTreeState?.options) return;
        for (const opt of this._activeTreeState.options) {
            if (opt.check) opt.check.dc += 1;
        }
        this._activeTreeState.treeDcAdj = (this._activeTreeState.treeDcAdj ?? 0) + 1;
        this._saveRestState();
        this.render();
    }

    /**
     * Phase 3 (events): GM adjusts the DC on all decision tree options down by 1.
     */
    static #onTreeDcAdjDown(event, target) {
        if (!this._activeTreeState?.options) return;
        for (const opt of this._activeTreeState.options) {
            if (opt.check) opt.check.dc = Math.max(1, opt.check.dc - 1);
        }
        this._activeTreeState.treeDcAdj = (this._activeTreeState.treeDcAdj ?? 0) - 1;
        this._saveRestState();
        this.render();
    }

    /**
     * Show a unified GM approval modal for all disaster resource losses.
     * Handles supply_loss, item_at_risk, and consume_gold in one overlay.
     *
     * @param {Object} unified - { supplyProposals, itemAtRiskProposals, goldProposals }
     * @returns {Promise<boolean>}
     */
    static async #showResourceLossApproval(unified) {
        const { supplyProposals, itemAtRiskProposals, goldProposals } = unified;

        // Track all checkable entries for tally
        const allEntries = [];

        // Collect all loss rows keyed by actorId
        // Each entry: { uid, actorId, actorName, img, name, qtyLabel, rangeLabel }
        const byActor = new Map();

        function ensureActor(actorId, actorName) {
            if (!byActor.has(actorId)) byActor.set(actorId, { name: actorName, rows: [] });
            return byActor.get(actorId);
        }

        // â”€â”€ Supplies â”€â”€
        for (const proposal of supplyProposals) {
            for (const entry of proposal.breakdown) {
                const uid = `supply-${entry.actorId}-${entry.itemId}`;
                const actor = game.actors.get(entry.actorId);
                const item = actor?.items.get(entry.itemId);
                const img = item?.img ?? "icons/containers/bags/pack-leather-brown.webp";
                const remaining = entry.currentQty - entry.lossQty;
                entry._uid = uid;
                allEntries.push({ uid });
                ensureActor(entry.actorId, entry.actorName).rows.push({
                    uid, img, name: item?.name ?? entry.itemName,
                    qtyLabel: `-${entry.lossQty}`,
                    rangeLabel: `${entry.currentQty} to ${remaining}`
                });
            }
        }

        // â”€â”€ Items at Risk â”€â”€
        for (const proposal of itemAtRiskProposals) {
            for (const candidate of proposal.candidates) {
                const uid = `item-${candidate.actor.id}-${candidate.item.id}`;
                candidate._uid = uid;
                const remaining = candidate.currentQty - candidate.lossQty;
                allEntries.push({ uid });
                ensureActor(candidate.actor.id, candidate.actor.name).rows.push({
                    uid, img: candidate.item.img ?? "icons/svg/mystery-man.svg",
                    name: candidate.item.name,
                    qtyLabel: candidate.lossQty > 1 ? `-${candidate.lossQty}` : "lost",
                    rangeLabel: candidate.currentQty > 1 ? `${candidate.currentQty} to ${remaining}` : "removed"
                });
            }
        }

        // â”€â”€ Gold â”€â”€
        for (const proposal of goldProposals) {
            for (const entry of proposal.breakdown) {
                const uid = `gold-${entry.actorId}`;
                entry._uid = uid;
                const remaining = entry.currentGp - entry.lossGp;
                allEntries.push({ uid });
                ensureActor(entry.actorId, entry.actorName).rows.push({
                    uid, img: "icons/commodities/currency/coins-assorted-mix-copper-silver-gold.webp",
                    name: "Gold",
                    qtyLabel: `-${entry.lossGp} gp`,
                    rangeLabel: `${entry.currentGp} to ${remaining} gp`
                });
            }
        }

        // If nothing to show at all
        if (allEntries.length === 0) {
            return new Promise(resolve => {
                const overlay = document.createElement("div");
                overlay.classList.add("ionrift-armor-modal-overlay");
                overlay.innerHTML = `
                    <div class="ionrift-armor-modal" style="max-width:420px;">
                        <h3><i class="fas fa-water"></i> Disaster Losses</h3>
                        <p>The disaster had no material impact. No supplies, items, or gold were at risk.</p>
                        <div class="ionrift-armor-modal-buttons">
                            <button class="btn-armor-confirm"><i class="fas fa-check"></i> Acknowledged</button>
                        </div>
                    </div>`;
                document.body.appendChild(overlay);
                overlay.querySelector(".btn-armor-confirm").addEventListener("click", () => {
                    overlay.remove();
                    resolve(true);
                });
            });
        }

        // Build per-actor sections
        let scrollContent = "";
        for (const [actorId, group] of byActor) {
            let rows = "";
            for (const r of group.rows) {
                rows += `
                    <label class="loss-item-row" data-uid="${r.uid}">
                        <input type="checkbox" checked data-uid="${r.uid}" class="loss-checkbox" />
                        <img src="${r.img}" width="20" height="20" style="border-radius:3px; border:1px solid rgba(255,255,255,0.1);" />
                        <span class="loss-item-name">${r.name}</span>
                        <span class="loss-item-qty">${r.qtyLabel}</span>
                        <span class="loss-item-current">${r.rangeLabel}</span>
                    </label>`;
            }
            scrollContent += `
                <div class="loss-actor-section">
                    <div class="loss-section-label"><i class="fas fa-user"></i> ${group.name}</div>
                    ${rows}
                </div>`;
        }

        return new Promise(resolve => {
            const overlay = document.createElement("div");
            overlay.classList.add("ionrift-armor-modal-overlay");
            overlay.innerHTML = `
                <div class="ionrift-armor-modal" style="max-width:520px;">
                    <h3><i class="fas fa-water"></i> Disaster Loss Approval</h3>
                    <div class="loss-summary">
                        <i class="fas fa-exclamation-triangle"></i>
                        <span>The disaster proposes <strong>${allEntries.length}</strong> losses across the party. Review and confirm.</span>
                    </div>
                    <div class="loss-controls">
                        <button type="button" class="loss-select-all"><i class="fas fa-check-double"></i> Select All</button>
                        <button type="button" class="loss-select-none"><i class="fas fa-times"></i> Select None</button>
                    </div>
                    <div class="loss-scrollable">
                        ${scrollContent}
                    </div>
                    <div class="loss-tally">
                        <i class="fas fa-calculator"></i>
                        <span class="loss-tally-count">${allEntries.length} losses selected</span>
                    </div>
                    <div class="ionrift-armor-modal-buttons">
                        <button class="btn-armor-confirm"><i class="fas fa-check"></i> Confirm Losses</button>
                        <button class="btn-armor-cancel"><i class="fas fa-times"></i> Cancel</button>
                    </div>
                </div>`;
            document.body.appendChild(overlay);

            function updateTally() {
                const count = overlay.querySelectorAll(".loss-checkbox:checked").length;
                const tally = overlay.querySelector(".loss-tally-count");
                if (tally) tally.textContent = `${count} losses selected`;
            }

            overlay.querySelector(".loss-select-all").addEventListener("click", () => {
                overlay.querySelectorAll(".loss-checkbox").forEach(cb => cb.checked = true);
                updateTally();
            });
            overlay.querySelector(".loss-select-none").addEventListener("click", () => {
                overlay.querySelectorAll(".loss-checkbox").forEach(cb => cb.checked = false);
                updateTally();
            });
            overlay.querySelectorAll(".loss-checkbox").forEach(cb => cb.addEventListener("change", updateTally));

            // Confirm: mark approved entries on the original proposals
            overlay.querySelector(".btn-armor-confirm").addEventListener("click", () => {
                const checked = new Set(
                    [...overlay.querySelectorAll(".loss-checkbox:checked")].map(cb => cb.dataset.uid)
                );

                for (const p of supplyProposals) {
                    p.breakdown = p.breakdown.filter(e => checked.has(e._uid));
                    p.totalLoss = p.breakdown.reduce((s, e) => s + e.lossQty, 0);
                }
                for (const p of itemAtRiskProposals) {
                    for (const c of p.candidates) c._approved = checked.has(c._uid);
                }
                for (const p of goldProposals) {
                    p.breakdown = p.breakdown.filter(e => checked.has(e._uid));
                    p.totalLoss = p.breakdown.reduce((s, e) => s + e.lossGp, 0);
                }

                overlay.remove();
                resolve(true);
            });

            overlay.querySelector(".btn-armor-cancel").addEventListener("click", () => {
                overlay.remove();
                resolve(false);
            });
        });
    }

    /**
     * Rebuild an item_at_risk approval proposal from a GM-locked selection.
     * Re-fetches each actor and item by id so the modal renders and applies the
     * exact items the GM previewed. Items that have since left the sheet are
     * dropped silently.
     *
     * @param {Object} eff - A locked item_at_risk effect with `_lockedItems`.
     * @returns {Object} Proposal shaped like ResourceSink._resolveItemAtRisk.
     */
    static #rehydrateItemLossProposal(eff) {
        const candidates = [];
        for (const li of (eff._lockedItems ?? [])) {
            const actor = game.actors.get(li.actorId);
            const item = actor?.items?.get(li.itemId);
            if (!actor || !item) continue;
            candidates.push({
                actor,
                item,
                currentQty: item.system?.quantity ?? li.currentQty ?? 1,
                lossQty: li.lossQty
            });
        }
        return {
            type: "item_at_risk",
            candidates,
            narrative: eff.narrative ?? "Some items were lost.",
            severity: eff.severity ?? 1
        };
    }

    /**
     * Phase 3 -> 4: Resolve rest outcomes.
     * Injects stored crafting results into activity outcomes.
     */
    static async #onResolveEvents(event, target) {
        // Collect ALL resource-loss effects from resolved tree and stall penalties.
        // Pull from the resolved tier (onMixed/onFailure) so a partial success
        // applies its own lighter losses rather than the failure set, and a
        // passed check applies nothing. Decision-tree events deliver their
        // losses through stallEffects and the tree resolution, not here.
        const allEffects = [];
        const LOSS_TYPES = ["supply_loss", "item_at_risk", "consume_gold"];
        const RESOLVED_TIER = { mixed: "onMixed", failure: "onFailure" };
        for (const evt of (this._triggeredEvents ?? [])) {
            if (evt.isDecisionTree) continue;
            if (evt.resolvedOutcome && ["success", "triumph"].includes(evt.resolvedOutcome)) continue;
            const tierKey = RESOLVED_TIER[evt.resolvedOutcome] ?? "onFailure";
            const tierEffects = evt.mechanical?.[tierKey]?.effects ?? evt.effects ?? [];
            for (const eff of tierEffects) {
                if (LOSS_TYPES.includes(eff.type)) {
                    allEffects.push(eff);
                }
            }
        }
        if (this._activeTreeState?.stallEffects) {
            for (const eff of this._activeTreeState.stallEffects) {
                if (["supply_loss", "item_at_risk", "consume_gold"].includes(eff.type)) {
                    allEffects.push(eff);
                }
            }
        }


        if (allEffects.length > 0) {
            const characters = getPartyActors();
            const context = { characters };

            // Build unified proposal: { supplyProposals, itemAtRiskProposals, goldProposals }
            const unified = { supplyProposals: [], itemAtRiskProposals: [], goldProposals: [] };

            for (const eff of allEffects) {
                if (eff.type === "supply_loss") {
                    // Use the GM's locked roll if present, so the approval modal
                    // matches the amount previewed on the disaster outcome card.
                    unified.supplyProposals.push(
                        eff._locked && eff._lockedSupply
                            ? eff._lockedSupply
                            : await ResourceSink.proposeSupplyLoss(eff, context)
                    );
                } else if (eff.type === "item_at_risk") {
                    // If the GM already rolled and locked the exact items on the
                    // event card, apply that frozen selection instead of rolling
                    // a fresh one, so the approval modal matches the preview.
                    unified.itemAtRiskProposals.push(
                        eff._locked
                            ? RestSetupApp.#rehydrateItemLossProposal(eff)
                            : await ResourceSink._resolveItemAtRisk(eff, context)
                    );
                } else if (eff.type === "consume_gold") {
                    // Use the GM's locked roll if present, so the approval modal
                    // matches the amount previewed on the event card.
                    unified.goldProposals.push(
                        eff._locked && eff._lockedGold
                            ? eff._lockedGold
                            : await ResourceSink.proposeGoldLoss(eff, context)
                    );
                }
            }


            const approved = await RestSetupApp.#showResourceLossApproval(unified);
            if (!approved) return; // GM cancelled

            // Apply all approved losses
            for (const p of unified.supplyProposals) {
                if (p.totalLoss > 0) await ResourceSink.applySupplyLossProposal(p);
            }
            for (const p of unified.itemAtRiskProposals) {
                const checked = p.candidates.filter(c => c._approved);
                if (checked.length > 0) await ResourceSink.applyItemLoss(checked);
            }
            for (const p of unified.goldProposals) {
                if (p.totalLoss > 0) await ResourceSink.applyGoldLossProposal(p);
            }

            // Whisper each player what they lost
            const lossByActor = new Map();
            function addLoss(actorId, actorName, line) {
                if (!lossByActor.has(actorId)) lossByActor.set(actorId, { name: actorName, lines: [] });
                lossByActor.get(actorId).lines.push(line);
            }

            for (const p of unified.supplyProposals) {
                for (const e of p.breakdown) {
                    addLoss(e.actorId, e.actorName,
                        `<i class="fas fa-box-open" style="color:#f1948a;"></i> <strong>${e.itemName ?? "Supplies"}</strong> &times;${e.lossQty} lost`);
                }
            }
            for (const p of unified.itemAtRiskProposals) {
                for (const c of p.candidates) {
                    if (!c._approved) continue;
                    const label = c.lossQty > 1 ? `${c.item.name} &times;${c.lossQty}` : c.item.name;
                    addLoss(c.actor.id, c.actor.name,
                        `<i class="fas fa-times-circle" style="color:#f1948a;"></i> <strong>${label}</strong> lost`);
                }
            }
            for (const p of unified.goldProposals) {
                for (const e of p.breakdown) {
                    addLoss(e.actorId, e.actorName,
                        `<i class="fas fa-coins" style="color:#f1948a;"></i> <strong>${e.lossGp} gp</strong> lost`);
                }
            }

            for (const [actorId, data] of lossByActor) {
                if (data.lines.length === 0) continue;
                const actor = game.actors.get(actorId);
                if (!actor) continue;
                const ownerUser = game.users.find(u => !u.isGM && actor.testUserPermission(u, "OWNER"));
                const whisperTargets = ownerUser ? [ownerUser.id] : game.users.filter(u => u.isGM).map(u => u.id);

                try {
                    await ChatMessage.create({
                        content: `<h3><i class="fas fa-water"></i> ${data.name}'s Disaster Losses</h3>\n${data.lines.join("\n")}`,
                        whisper: whisperTargets,
                        speaker: { alias: "Respite" },
                        flags: { [MODULE_ID]: { type: "disasterLoss" } }
                    });
                } catch (e) {

                    console.warn(`${MODULE_ID} | Failed to whisper disaster loss to ${data.name}:`, e);
                }
            }
        }

        // Clear the resolved tree state now that we're proceeding past events
        // but first collect any condition effects (exhaustion) from the tree.
        // EventResolver._buildResult always populates evt.effects from the
        // mechanical.onFailure block, so we must skip events whose actual
        // resolution was success or triumph; otherwise a triumph-resolved
        // event still applies its onFailure exhaustion to the party.
        const conditionEffects = [];
        for (const evt of (this._triggeredEvents ?? [])) {
            if (!evt.effects) continue;
            if (["success", "triumph"].includes(evt.resolvedOutcome)) continue;
            for (const eff of evt.effects) {
                if (eff.type === "condition" && eff.condition === "exhaustion") {
                    conditionEffects.push(eff);
                }
            }
        }
        if (this._activeTreeState?.stallEffects) {
            for (const eff of this._activeTreeState.stallEffects) {
                if (eff.type === "condition" && eff.condition === "exhaustion") {
                    conditionEffects.push(eff);
                }
            }
        }

        // Apply disaster exhaustion to actors and track per-actor gains.
        // `preAppliedConditions` records the `${actorId}:${condition}` tuples
        // we touched directly via the adapter so ConditionAdvisory can render
        // them as already-applied without firing a second Convenient Effects
        // add on top of the system value.
        const disasterExhaustion = new Map();
        const preAppliedConditions = new Set();
        if (conditionEffects.length > 0) {
            const characters = getPartyActors();
            const adapter = game.ionrift?.respite?.adapter;
            for (const eff of conditionEffects) {
                const level = eff.level ?? 1;
                const scope = eff.scope ?? "all";
                let targets;
                if (scope === "all") {
                    targets = characters;
                } else if (scope === "random" || scope === "randomTarget") {
                    // Disaster-tree path runs before the engine resolves outcomes,
                    // so the pool/count metadata on randomTarget can't be honored
                    // here. Treat it as a single random pick; the per-outcome
                    // pre-resolution in RecoveryHandler handles the richer case.
                    targets = characters.length > 0
                        ? [characters[Math.floor(Math.random() * characters.length)]]
                        : [];
                } else {
                    targets = characters.filter(a => a.id === scope);
                }

                for (const actor of targets) {
                    const gain = disasterExhaustion.get(actor.id) ?? 0;
                    disasterExhaustion.set(actor.id, gain + level);
                    if (adapter) {
                        await adapter.applyExhaustionDelta(actor, level);
                    } else {
                        // Fallback: direct 5e path
                        const current = actor.system?.attributes?.exhaustion ?? 0;
                        const newLevel = Math.min(6, current + gain + level);
                        await actor.update({ "system.attributes.exhaustion": newLevel });
                    }
                    preAppliedConditions.add(`${actor.id}:${eff.condition}`);
                }
            }
        }
        this._preAppliedConditions = preAppliedConditions;

        this._activeTreeState = null;

        this._outcomes = await this._engine.resolve(this._activityResolver, this._triggeredEvents, this._earlyResults);

        // Inject disaster exhaustion into recovery so RecoveryHandler
        // won't undo it with the natural -1 long rest reduction.
        for (const outcome of this._outcomes) {
            const gain = disasterExhaustion.get(outcome.characterId);
            if (gain && outcome.recovery) {
                outcome.recovery.exhaustionGain = (outcome.recovery.exhaustionGain ?? 0) + gain;
            }
        }

        // Inject crafting results into outcomes
        for (const outcome of this._outcomes) {
            const craftResult = this._craftingResults.get(outcome.characterId);
            if (!craftResult) continue;

            // Find the activity outcome and replace it
            for (const sub of (outcome.outcomes ?? [])) {
                if (sub.source === "activity" && ["act_cook", "act_brew", "act_tailor"].includes(sub.activityId)) {
                    sub.narrative = craftResult.narrative;
                    sub.result = craftResult.success ? "success" : "failure";
                    if (craftResult.success && craftResult.output) {
                        sub.items = [{
                            name: craftResult.output.name,
                            quantity: craftResult.output.quantity ?? 1,
                            img: craftResult.output.img ?? "icons/consumables/food/bowl-stew-brown.webp"
                        }];
                    } else {
                        sub.items = [];
                    }
                    sub.craftingResult = craftResult;
                }
            }
        }

        await this._removeBeddingDown();

        SoundDelegate.stopAll();
        this._phase = "resolve";
        await this._clearRestState();

        // Auto re-equip doffed armor if no encounter occurred
        const reequippedArmor = new Map();
        if (this._doffedArmor?.size > 0) {
            const hadEncounter = (this._triggeredEvents ?? []).some(e =>
                e.category === "encounter" || e.category === "combat"
            );
            if (!hadEncounter) {
                for (const [actorId, itemId] of this._doffedArmor) {
                    try {
                        const actor = game.actors.get(actorId);
                        const item = actor?.items.get(itemId);
                        if (item) {
                            await item.update({ "system.equipped": true });
                            reequippedArmor.set(actorId, item.name);
        Logger.log(`${MODULE_ID} | Auto re-equipped ${item.name} on ${actor.name}`);

                            // Also inject narrative note into the outcome
                            const outcome = this._outcomes.find(o => o.characterId === actorId);
                            if (outcome) {
                                if (!outcome.outcomes) outcome.outcomes = [];
                                outcome.outcomes.push({
                                    source: "armor",
                                    narrative: `You don your ${item.name} as you break camp.`,
                                    items: []
                                });
                            }
                        }
                    } catch (e) {

                        console.warn(`${MODULE_ID} | Failed to re-equip armor:`, e);
                    }
                }
                this._doffedArmor.clear();
            }
        }

        // PHB p.185: exhaustion recovery requires adequate food and drink.
        // Stamp recovery objects so RecoveryHandler blocks the -1 reduction
        // for characters who skipped meals or water during the meal phase.
        if (this._mealResults?.length) {
            for (const outcome of this._outcomes) {
                const mr = this._mealResults.find(r => r.characterId === outcome.characterId);
                if (mr && (!mr.ate || !mr.drank) && outcome.recovery) {
                    outcome.recovery.noFoodOrWater = true;
                }
            }
        }

        // Apply recovery (HP, HD, exhaustion) immediately at resolution
        const skipRecovery = game.settings.get(MODULE_ID, "restRecoveryDetected");
        const recoveryResults = await RecoveryHandler.applyAll(this._outcomes, skipRecovery);

        // Inject event damage into outcomes so the whispers and UI can display it
        for (const outcome of this._outcomes) {
            const res = recoveryResults.find(r => r.characterId === outcome.characterId);
            if (res?.eventDamage > 0) {
                outcome.recovery.eventDamage = res.eventDamage;
            }
        }

        // Apply GM-locked event consequences AFTER recovery so morning wounds and
        // resource losses survive the night's healing. RecoveryHandler skips any
        // effect flagged `_locked`, so this is the sole application of these.
        {
            const LOCK_TIER_MAP = { triumph: "onTriumph", success: "onSuccess", mixed: "onMixed", failure: "onFailure" };
            const lockedConsumeEffects = [];
            const lockedDamageByActor = new Map();
            for (const te of (this._triggeredEvents ?? [])) {
                if (!te.resolvedOutcome || ["success", "triumph"].includes(te.resolvedOutcome)) continue;
                const tierKey = LOCK_TIER_MAP[te.resolvedOutcome] ?? "onFailure";
                const block = te.mechanical?.[tierKey] ?? te.mechanical?.onFailure ?? {};
                for (const eff of (block.effects ?? [])) {
                    if (!eff._locked) continue;
                    if (eff.type === "damage" && eff._lockedDamage) {
                        for (const [actorId, amount] of Object.entries(eff._lockedDamage)) {
                            if (amount > 0) lockedDamageByActor.set(actorId, (lockedDamageByActor.get(actorId) ?? 0) + amount);
                        }
                    } else if (eff.type === "consume_resource" && eff._lockedLoss) {
                        lockedConsumeEffects.push(eff);
                    }
                }
            }

            const dmgAdapter = game.ionrift?.respite?.adapter;
            for (const [actorId, totalDamage] of lockedDamageByActor) {
                const actor = game.actors.get(actorId);
                if (!actor || totalDamage <= 0) continue;
                if (dmgAdapter) {
                    await dmgAdapter.applyHPDamage(actor, totalDamage);
                } else {
                    const hp = actor.system?.attributes?.hp;
                    if (!hp) continue;
                    const newHp = Math.max(0, (hp.value ?? 0) - totalDamage);
                    await actor.update({ "system.attributes.hp.value": newHp });
                }
                const outcome = this._outcomes.find(o => o.characterId === actorId);
                if (outcome?.recovery) {
                    outcome.recovery.eventDamage = (outcome.recovery.eventDamage ?? 0) + totalDamage;
                }
            }

            for (const eff of lockedConsumeEffects) {
                try {
                    await ResourceSink.applyResourceLossBreakdown(eff._lockedLoss.breakdown);
                    if (eff._lockedLoss.gear?.length) {
                        await ResourceSink.applyResourceLossBreakdown(eff._lockedLoss.gear);
                    }
                } catch (e) {

                    console.warn(`${MODULE_ID} | Failed to apply locked resource loss:`, e);
                }
            }
        }

        // Trigger native rest for spell slots, class features, item uses.
        // HP/HD/Exhaustion already handled by RecoveryHandler above.
        // For hookable systems (DnD5e), preRestCompleted suppresses double-dipping.
        // For non-hookable systems (PF2e), the adapter calls the native rest API directly.
        if (!skipRecovery) {
            const nativeAdapter = game.ionrift?.respite?.adapter;
            const restType = this._engine?.restType ?? "long";
            for (const outcome of this._outcomes) {
                const actor = game.actors.get(outcome.characterId);
                if (!actor) continue;
                try {
                    if (nativeAdapter) {
                        await nativeAdapter.triggerNativeRest(actor, restType);
                    } else if (game.system.id === "dnd5e") {
                        if (restType === "long") {
                            await actor.longRest({ dialog: false, chat: false, advanceTime: false });
                        } else {
                            await actor.shortRest({ dialog: false, chat: false, advanceTime: false });
                        }
                    }

                    Logger.log(`${MODULE_ID} | Native ${restType} rest applied for ${actor.name}.`);
                } catch (e) {

                    console.warn(`${MODULE_ID} | Native rest failed for ${actor.name}:`, e);
                }
            }
        } else if (!skipRecovery) {

            Logger.log(`${MODULE_ID} | Skipping native rest call (system: ${game.system.id} â€” no longRest/shortRest API).`);
        }

        // Strip any Detect Magic active effects left on party actors from the rest scan.
        try {
            await purgeDetectMagicRestArtifacts(getPartyActors());
        } catch (e) {

            console.warn(`${MODULE_ID} | Failed to purge Detect Magic effects:`, e);
        }

        // Stamp Well Fed AEs with DAE longRest specialDuration now that native rest has run.
        // Eating happens before recovery, so the flag is intentionally omitted at AE
        // creation to prevent DAE from stripping the buff during longRest(). Adding
        // it here means the AE will auto-expire at the START of the next rest instead.
        try {
            await MealPhaseHandler.stampWellFedDuration(getPartyActors());
        } catch (e) {

            console.warn(`${MODULE_ID} | Well Fed duration stamp failed:`, e);
        }

        // Create items from outcomes (forage, crafts, etc.)
        try {
            const itemSummary = await ItemOutcomeHandler.processAll(this._outcomes);
            const totalItems = itemSummary.reduce((sum, s) => sum + s.items.length, 0);
            if (totalItems > 0) {
                ui.notifications.info(`Rest complete: ${totalItems} item${totalItems === 1 ? "" : "s"} created.`);
            } else {
                ui.notifications.info("Rest complete.");
            }
        } catch (e) {

            console.warn(`${MODULE_ID} | Item processing failed:`, e);
            ui.notifications.info("Rest complete.");
        }

        // Write training XP onto the sheet. Runs GM-side where this resolution
        // path executes, so the GM has permission to update every actor.
        try {
            await RestSetupApp._applyTrainingXP(this._outcomes);
        } catch (e) {

            console.warn(`${MODULE_ID} | Training XP application failed:`, e);
        }

        // Auto-grant party discoveries (event loot) to watch roster members
        try {
            await this._autoGrantPartyDiscoveries();
        } catch (e) {

            console.warn(`${MODULE_ID} | Auto-grant party discoveries failed:`, e);
        }

        // Post condition advisory for any unhandled condition/temp_hp effects.
        // Pass the disaster-path applied set so the advisory renders those as
        // already-applied and skips a redundant CE add for the same condition.
        try {
            await ConditionAdvisory.processAll(this._outcomes, {
                preApplied: this._preAppliedConditions ?? new Set()
            });
        } catch (e) {

            console.warn(`${MODULE_ID} | Condition advisory failed:`, e);
        }
        this._preAppliedConditions = null;

        // Send private whispered rest summary to each player
        for (const outcome of this._outcomes) {
            const actor = game.actors.get(outcome.characterId);
            if (!actor) continue;

            const ownerUser = game.users.find(u =>
                !u.isGM && actor.testUserPermission(u, "OWNER")
            );
            if (!ownerUser) continue;

            const lines = [`<h3>${actor.name}'s Rest</h3>`];
            for (const sub of (outcome.outcomes ?? [])) {
                lines.push(`<p><em>${sub.narrative}</em></p>`);
                if (sub.training?.rolls?.length) {
                    lines.push(RestSetupApp._buildTrainingProgressBar(sub.training));
                }
                if (sub.items?.length) {
                    for (const item of sub.items) {
                        const qty = item.quantity > 1 ? ` x${item.quantity}` : "";
                        lines.push(`<p><i class="fas fa-plus-circle"></i> <strong>${item.name || item.itemRef}${qty}</strong></p>`);
                    }
                }
            }

            const recovery = outcome.recovery;
            if (recovery) {
                const recParts = [];
                if (recovery.hpRestored > 0) recParts.push(`+${recovery.hpRestored} HP`);
                if (recovery.hdRestored > 0) recParts.push(`+${recovery.hdRestored} HD`);
                if (recParts.length) {
                    lines.push(`<p><i class="fas fa-heartbeat"></i> ${recParts.join(", ")} restored</p>`);
                }
                // Exhaustion change with reason
                if (recovery.exhaustionDelta < 0) {
                    lines.push(`<p><i class="fas fa-arrow-down" style="color:#82e0aa;"></i> <span style="color:#82e0aa;">${Math.abs(recovery.exhaustionDelta)} exhaustion recovered</span></p>`);
                } else if (recovery.exhaustionDelta > 0) {
                    const reason = recovery.exhaustionDC ? `failed CON save DC ${recovery.exhaustionDC}` : "rest conditions";
                    lines.push(`<p><i class="fas fa-arrow-up" style="color:#f1948a;"></i> <span style="color:#f1948a;">+${recovery.exhaustionDelta} exhaustion (${reason})</span></p>`);
                } else if (recovery.exhaustionDelta === 0 && recovery.exhaustionSaveResult === "failed") {
                    lines.push(`<p><i class="fas fa-arrow-right" style="color:#f9d77e;"></i> <span style="color:#f9d77e;">Failed CON save DC ${recovery.exhaustionDC} (+1 exhaustion, offset by rest recovery -1)</span></p>`);
                }
                if (recovery.comfortLevel === "hostile") {
                    lines.push(`<p style="font-size:0.85em;color:#f9d77e;"><i class="fas fa-skull"></i> Hostile conditions prevent natural exhaustion recovery</p>`);
                }
                if (recovery.noFoodOrWater) {
                    lines.push(`<p style="font-size:0.85em;color:#f9d77e;"><i class="fas fa-tint-slash"></i> Lack of food or water prevents exhaustion recovery</p>`);
                }
                // Surface gear contributions so the player sees their inventory mattered
                if (recovery.gearDescriptors?.length) {
                    const gearLine = recovery.gearDescriptors.map(d => `<i class="fas fa-cog"></i> ${d}`).join("<br>");
                    lines.push(`<p style="font-size:0.85em;opacity:0.8;">${gearLine}</p>`);
                }
                
                // Display event damage visually
                if (recovery.eventDamage > 0) {
                    const dmgEvents = (outcome.outcomes ?? [])
                        .filter(sub => sub.source === "event" && sub.effects?.some(e => e.type === "damage"))
                        .map(sub => sub.eventName);
                    const sourceText = dmgEvents.length > 0 ? dmgEvents.join(", ") : "an event";
                    lines.push(`<p><i class="fas fa-tint" style="color:#e74c3c;"></i> <strong style="color:#e74c3c;">Took ${recovery.eventDamage} damage</strong> from ${sourceText}</p>`);
                }
            }

            const reequipped = reequippedArmor.get(outcome.characterId);
            if (reequipped) {
                lines.push(`<p><i class="fas fa-shield-alt"></i> You don your <strong>${reequipped}</strong> as you break camp.</p>`);
            }

            try {
                await ChatMessage.create({
                    content: lines.join("\n"),
                    whisper: [ownerUser.id],
                    speaker: { alias: "Respite" },
                    flags: { [MODULE_ID]: { type: "restSummary" } }
                });
            } catch (e) {

                console.warn(`${MODULE_ID} | Failed to whisper rest summary to ${ownerUser.name}:`, e);
            }
        }

        // Record rest date via calendar handler
        await CalendarHandler.recordRestDate();

        // Broadcast phase change to players with outcome data
        emitPhaseChanged("resolve", {
                outcomes: this._outcomes.map(o => ({
                    characterId: o.characterId,
                    characterName: o.characterName,
                    outcomes: o.outcomes,
                    recovery: o.recovery
                }))
            });

        // Mark rest as applied so close guard doesn't fire
        this._restApplied = true;
        this.render();
    }

    /**
     * Phase 4: Finalize. Now just closes the window since auto-apply handles everything.
     */
    static async #onFinalize(event, target) {
        // Warn if there are ungranted party discoveries
        if (this._grantLedger && this._outcomes?.length) {
            const seenEvents = new Set();
            let ungrantedCount = 0;
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
            if (ungrantedCount > 0) {
                const overlay = document.createElement("div");
                overlay.classList.add("ionrift-armor-modal-overlay");
                overlay.innerHTML = `
                    <div class="ionrift-armor-modal">
                        <h3><i class="fas fa-gem"></i> Ungranted Discoveries</h3>
                        <p>${ungrantedCount} discovered item${ungrantedCount > 1 ? "s have" : " has"} not been granted to anyone.</p>
                        <p>Close anyway and lose these items?</p>
                        <div class="ionrift-armor-modal-buttons">
                            <button class="btn-armor-confirm"><i class="fas fa-times"></i> Close Anyway</button>
                            <button class="btn-armor-cancel"><i class="fas fa-arrow-left"></i> Go Back</button>
                        </div>
                    </div>`;
                document.body.appendChild(overlay);
                overlay.querySelector(".btn-armor-confirm").addEventListener("click", () => {
                    overlay.remove();
                    this.close({ resolved: true });
                });
                overlay.querySelector(".btn-armor-cancel").addEventListener("click", () => {
                    overlay.remove();
                });
                return;
            }
        }
        this.close({ resolved: true });
    }

    // â”€â”€â”€â”€â”€â”€â”€â”€ Instance methods â”€â”€â”€â”€â”€â”€â”€â”€

    /**
     * Receives player-submitted choices from the socket handler.
     */
    receivePlayerChoices(userId, choices, craftingResults = null, followUps = null, earlyResults = null) {
        const user = game.users.get(userId);
        this._playerSubmissions.set(userId, {
            choices,
            followUps: followUps ?? {},
            userName: user?.name ?? "Unknown",
            timestamp: Date.now()
        });

        // Merge crafting results from the player
        if (craftingResults) {
            for (const [charId, result] of Object.entries(craftingResults)) {
                if (!result) continue;
                this._craftingResults.set(charId, result);
                this._lockedCharacters.add(charId);
            }
        }

        // Merge early results from the player (resolved camp rolls, crafting outcomes, etc.)
        // so the GM doesn't re-prompt rolls the player already completed.
        if (earlyResults) {
            if (!this._earlyResults) this._earlyResults = new Map();
            for (const [charId, result] of Object.entries(earlyResults)) {
                if (result && result.result !== "pending_approval") {
                    this._earlyResults.set(charId, result);
                }
            }
        }

        this._rebuildCharacterChoices();
        this._pruneEarlyResultsWithoutChoice();
        this._saveRestState();

        if (this._phase === "activity" && isStationLayerActive()) {
            refreshStationEmptyNoticeFade(this);
            refreshStationPortraitsFromChoices(this._characterChoices, this._stationCanvasIdByCharacter);
            this._refreshStationOverlayMeals();
        }
        this.render();
        // Refresh the GM footer bar in-place (it bakes the count at creation time).
        _refreshGmRestIndicator(this);

        // Broadcast submission status to all players
        const submissions = {};
        for (const [charId, actId] of this._characterChoices) {
            const act = this._activities?.find(a => a.id === actId);
            submissions[charId] = { activityId: actId, activityName: act?.name ?? actId, source: "player" };
        }
        for (const [charId, actId] of this._gmOverrides) {
            const act = this._activities?.find(a => a.id === actId);
            submissions[charId] = { activityId: actId, activityName: act?.name ?? actId, source: "gm" };
        }
        emitSubmissionUpdate(submissions);

        const snapshot = this.getRestSnapshot?.();
        if (snapshot) emitRestSnapshot(snapshot);
    }

    /**
     * Updates the activity-phase rest bar progress line when the main window is minimised.
     */
    _updateRestBarProgress() {
        _refreshGmRestIndicator(this);
    }

    _pruneEarlyResultsWithoutChoice() {
        if (!this._earlyResults?.size) return;
        for (const charId of [...this._earlyResults.keys()]) {
            if (!this._characterChoices.has(charId)) this._earlyResults.delete(charId);
        }
    }

    /**
     * Player: undo a station-submitted activity for one character and sync sockets.
     * @param {string} characterId
     */
    _revertStationActivityChoice(characterId) {
        if (!characterId || this._isGM) return;

        this._characterChoices.delete(characterId);
        this._lockedCharacters.delete(characterId);
        this._earlyResults.delete(characterId);
        this._trainingStates?.delete(characterId);
        this._stationCanvasIdByCharacter?.delete(characterId);

        const mySub = this._playerSubmissions.get(game.user.id);
        if (mySub?.choices) {
            delete mySub.choices[characterId];
            this._playerSubmissions.set(game.user.id, mySub);
        }

        this._rebuildCharacterChoices();
        this._pruneEarlyResultsWithoutChoice();

        emitActivityChoice(
                    game.user.id,
                    Object.fromEntries(this._characterChoices),
                    null,
                    null,
                    this._earlyResults?.size ? Object.fromEntries(this._earlyResults) : null
                );

        resetStationOverlaysLocal();
        if (isStationLayerActive()) {
            if (!this._isGM) this._refreshStationOverlayForFocusChange();
            else {
                refreshStationEmptyNoticeFade(this);
                this._refreshStationOverlayMeals();
            }
        }
        this._updateRestBarProgress();
    }

    /**
     * Player clients: rebuild training roll state when a locked act_train choice
     * arrives from the GM without a matching local state (snapshot / resync).
     */
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

    /**
     * Character id with Training locked but sets not finished. Prefers owned
     * characters on player clients.
     * @returns {string|null}
     */
    _findIncompleteTrainingCharacterId() {
        const seen = new Set();
        const candidates = [];

        for (const charId of this._trainingStates?.keys() ?? []) {
            if (seen.has(charId)) continue;
            seen.add(charId);
            if (this._earlyResults?.has(charId)) continue;
            if (this._characterChoices?.get(charId) !== "act_train") continue;
            candidates.push(charId);
        }
        for (const charId of this._lockedCharacters ?? []) {
            if (seen.has(charId)) continue;
            if (this._characterChoices?.get(charId) !== "act_train") continue;
            if (this._earlyResults?.has(charId)) continue;
            candidates.push(charId);
        }

        if (!candidates.length) return null;

        if (!this._isGM) {
            return candidates.find(id => game.actors.get(id)?.isOwner) ?? null;
        }
        if (this._selectedCharacterId && candidates.includes(this._selectedCharacterId)) {
            return this._selectedCharacterId;
        }
        return candidates[0];
    }

    /**
     * Keeps the TotM detail view on incomplete Training after refresh or resync.
     * Without this, the activities grid shows with all tiles faded and no way back in.
     */
    _syncIncompleteTrainingView() {
        if (this._phase !== "activity" || !this._isTotM) return;

        const characterId = this._findIncompleteTrainingCharacterId();
        if (!characterId) return;

        this._selectedCharacterId = characterId;
        this._totmFollowUpExpanded = { activityId: "act_train", characterId, trainingActive: true };

        if (!this._trainingStates?.has(characterId)) {
            const actor = game.actors.get(characterId);
            if (actor) this._initTrainingState(characterId, "act_train", actor);
        }

        this._clearStaleTrainingRollingFlags();
    }

    /**
     * Clears transient rolling flags restored from persistence or socket sync.
     */
    _clearStaleTrainingRollingFlags() {
        for (const state of this._trainingStates?.values() ?? []) {
            state.rolling = false;
        }
    }

    /**
     * Sets up in-panel training roll state for one character.
     * @param {string} characterId
     * @param {string} activityId
     * @param {Actor} actor
     */
    _initTrainingState(characterId, activityId, actor) {
        const activity = this._activityResolver?.activities?.get(activityId)
            ?? this._activities?.find(a => a.id === activityId);
        if (!activity || !actor) return;

        const comfort = this._engine?.comfort ?? "rough";
        const safeRestSpot = !!this._engine?.safeRestSpot;
        const context = this._activityResolver.getTrainingContext(activity, actor, comfort, safeRestSpot);

        this._trainingStates = this._trainingStates ?? new Map();
        const state = {
            activityId,
            context,
            rolls: [],
            rolling: false
        };
        this._trainingStates.set(characterId, state);

        if (!game.user.isGM) {
            emitTrainingStateUpdate(characterId, state);
        } else {
            void this._saveRestState();
        }
    }

    /**
     * Template context for the inline training panel.
     * @param {string} characterId
     * @returns {object|null}
     */
    _buildTrainingViewContext(characterId) {
        const ts = this._trainingStates?.get(characterId);
        if (!ts) return null;

        // rolling is transient UI state; a mid-roll save must not block the next set.
        if (ts.rolling) ts.rolling = false;

        const ctx = ts.context ?? {};
        const numRolls = ctx.numRolls ?? 3;
        const rolled = ts.rolls?.length ?? 0;
        const actor = game.actors.get(characterId);

        const segments = [];
        for (let i = 0; i < numRolls; i++) {
            const r = ts.rolls[i];
            let state = "pending";
            if (r) state = r.passed ? "pass" : "fail";
            else if (i === rolled) state = "current";
            segments.push({ state });
        }

        const xpReduction = ctx.xpReduction ?? 0;
        let diminishHint = null;
        if (xpReduction > 0) {
            diminishHint = `Streak ${ctx.streak ?? 0}: up to ${xpReduction} XP held back this rest.`;
        }

        const canRoll = !!actor
            && rolled < numRolls
            && !ts.rolling
            && (actor.isOwner || game.user.isGM);

        return {
            characterId,
            actorName: actor?.name ?? "",
            rollLabel: ctx.rollLabel ?? "",
            dc: ctx.adjustedDc ?? 13,
            numRolls,
            rolls: ts.rolls ?? [],
            segments,
            nextRollNumber: rolled + 1,
            canRoll,
            rolling: !!ts.rolling,
            diminishHint
        };
    }

    /**
     * One training set roll from the inline panel. Posts to chat, waits for Dice So Nice,
     * then finalizes into _earlyResults when all sets are done.
     */
    static async #onTrainingRoll(event, target) {
        const characterId = target?.dataset?.characterId;
        if (!characterId) return;

        const state = this._trainingStates?.get(characterId);
        if (!state || state.rolling) return;

        const ctx = state.context ?? {};
        const numRolls = ctx.numRolls ?? 3;
        if ((state.rolls?.length ?? 0) >= numRolls) return;

        const actor = game.actors.get(characterId);
        if (!actor) return;
        if (!actor.isOwner && !game.user.isGM) {
            ui.notifications.warn("Only the character's owner can roll training checks.");
            return;
        }

        const activity = this._activityResolver?.activities?.get(state.activityId)
            ?? this._activities?.find(a => a.id === state.activityId);
        if (!activity) return;

        state.rolling = true;
        this.render();

        const setNumber = state.rolls.length + 1;
        const abilityName = SKILL_DISPLAY_NAMES[ctx.abilityKey] ?? ctx.rollLabel ?? "Ability";

        try {
            let total;
            let passed;

            if (game.user.isGM && !actor.isOwner) {
                const roll = await new Roll(`1d20 + ${ctx.modifier ?? 0}`).evaluate();
                const flavor = `<strong>Training</strong> Set ${setNumber}/${numRolls} (${abilityName}) · DC ${ctx.adjustedDc} [GM roll]`;
                await postRollToChat(actor, roll, flavor);
                await waitForDiceSoNice();
                total = roll.total;
                passed = total >= ctx.adjustedDc;
            } else {
                const flavor = `<strong>Training</strong> Set ${setNumber}/${numRolls} (${abilityName}) · DC ${ctx.adjustedDc}`;
                const result = await executeAbilityRoll(
                    actor,
                    ctx.abilityKey ?? "str",
                    ctx.modifier ?? 0,
                    ctx.adjustedDc ?? 13,
                    flavor,
                    target
                );
                total = result.total;
                passed = result.passed;
            }

            state.rolls.push({ set: setNumber, total, passed });
            state.rolling = false;

            if (state.rolls.length >= numRolls) {
                const outcome = await this._activityResolver.finalizeTraining(
                    activity,
                    state.activityId,
                    actor,
                    state.rolls,
                    ctx,
                    { whisper: true }
                );
                this._earlyResults.set(characterId, outcome);
                this._trainingStates.delete(characterId);
                this._totmFollowUpExpanded = null;

                const award = outcome.training?.awardedXP ?? 0;
                ui.notifications.info(`${actor.name}: Training complete · +${award} XP`);

                if (!game.user.isGM) {
                    emitTrainingComplete(characterId, outcome);
                    emitActivityChoice(
                        game.user.id,
                        Object.fromEntries(this._characterChoices),
                        null,
                        null,
                        Object.fromEntries(this._earlyResults)
                    );
                } else {
                    this._saveRestState();
                }
            } else if (!game.user.isGM) {
                emitTrainingStateUpdate(characterId, state);
            } else {
                this._saveRestState();
            }
        } catch (err) {
            console.warn(`${MODULE_ID} | Training roll failed:`, err);
            ui.notifications.error("Training roll failed. Try again.");
        } finally {
            state.rolling = false;
            this.render();
            if (this._phase === "activity" && isStationLayerActive()) {
                refreshStationPortraitsFromChoices(this._characterChoices, this._stationCanvasIdByCharacter);
            }
        }
    }

    /**
     * Confirms an activity chosen from the canvas station dialog (same path as the panel Confirm button).
     * @param {string} characterId
     * @param {string} activityId
     * @param {string|null} canvasStationId - station id for overlay dimming
     */
    async finalizeActivityChoiceFromStation(characterId, activityId, canvasStationId = null, options = {}) {
        if (!characterId || !activityId) return null;
        if (this._craftingInProgress?.has(characterId)) return null;

        // Look up activity from the resolver, then fall back to known crafting IDs
        const CRAFTING_PROFESSIONS = { act_cook: "cooking", act_brew: "alchemy" };
        const activity = this._activityResolver?.activities?.get(activityId);
        const craftingProfession = activity?.crafting?.profession ?? CRAFTING_PROFESSIONS[activityId];
        if (activity?.crafting?.enabled || craftingProfession) {
            const syntheticTarget = { dataset: { characterId, profession: craftingProfession } };
            RestSetupApp.#onOpenCrafting.call(this, null, syntheticTarget);
            return { source: "activity", activityId, result: "crafting_redirect" };
        }


        this._characterChoices.set(characterId, activityId);
        this._lockedCharacters.add(characterId);
        this._pendingSelections?.delete(characterId);

        const actor = game.actors.get(characterId);
        let activityResult = null;

        if (activityId === "act_scribe" && actor) {
            const followUpValue = options.followUpValue ?? this._gmFollowUps?.get(characterId) ?? this._getFollowUpForCharacter(characterId);
            const spellLevel = parseInt(followUpValue, 10) || 1;
            const cost = spellLevel * 50;
            const dc = 10 + spellLevel;

            if (game.user.isGM) {
                CopySpellHandler.sendProposal(characterId, spellLevel);
            } else {
                emitCopySpellProposal({
                    actorId: characterId,
                    actorName: actor.name,
                    spellLevel,
                    cost,
                    dc,
                    initiatedBy: game.user.name
                });
            }

            activityResult = {
                source: "activity",
                activityId,
                result: "pending_approval",
                narrative: `Level ${spellLevel} spell (${cost}gp, DC ${dc}). Awaiting transaction.`
            };
            this._earlyResults.set(characterId, activityResult);
            if (this.rendered) this.render();
        } else if (activityId === "act_train" && actor && this._engine) {
            this._initTrainingState(characterId, activityId, actor);
            ui.notifications.info(`${actor.name}: Training started. Roll your sets in the rest window.`);
            if (this.rendered) this.render();
        } else if (actor && this._engine) {
            const followUpValue = options.followUpValue ?? this._gmFollowUps?.get(characterId) ?? this._getFollowUpForCharacter(characterId);
            activityResult = await this._activityResolver.resolve(
                activityId, actor, this._engine.terrainTag, this._engine.comfort, {
                    followUpValue,
                    safeRestSpot: !!this._engine.safeRestSpot
                }
            );
            this._earlyResults.set(characterId, activityResult);
            const tier = activityResult.result === "exceptional" ? "Exceptional!"
                : activityResult.result === "success" ? "Success"
                : activityResult.result === "failure_complication" ? "Failed (complication)"
                : activityResult.result === "failure" ? "Failed" : activityResult.result;
            const actName = activity?.name ?? activityId;
            ui.notifications.info(`${actor.name}: ${actName} - ${tier}`);
            if (this.rendered) this.render();
        }

        let mySub = this._playerSubmissions.get(game.user.id) || { choices: {}, userName: game.user.name, timestamp: Date.now() };
        mySub.choices[characterId] = activityId;
        this._playerSubmissions.set(game.user.id, mySub);
        this._saveRestState();

        // Build follow-ups to send to GM (arrows vs bolts, tend target, etc.)
        const followUps = {};
        for (const [cid] of this._characterChoices) {
            const fu = this._gmFollowUps?.get(cid);
            if (fu !== null && fu !== undefined) followUps[cid] = fu;
        }
        emitActivityChoice(
                    game.user.id,
                    Object.fromEntries(this._characterChoices),
                    null,
                    Object.keys(followUps).length ? followUps : null,
                    this._earlyResults?.size ? Object.fromEntries(this._earlyResults) : null
                );

        const actName = activity?.name ?? activityId;
        ui.notifications.info(`${game.actors.get(characterId)?.name ?? "Character"} will ${actName}.`);

        if (canvasStationId) {
            this._stationCanvasIdByCharacter.set(characterId, canvasStationId);
            setStationPlayerState(characterId, canvasStationId, this._characterChoices, this._stationCanvasIdByCharacter);
        } else {
            this._stationCanvasIdByCharacter.delete(characterId);
        }

        this._updateRestBarProgress();
        _refreshRejoinBar(this);

        // GM: advance focus to the next unchosen party member so overlays
        // reflect who still needs to pick, not the character who just committed.
        if (this._isGM && this._phase === "activity") {
            const partyActors = getPartyActors();
            const nextUnchosen = partyActors.find(a => !this._characterChoices.has(a.id));
            if (nextUnchosen) {
                this._selectedCharacterId = nextUnchosen.id;
            }
        }

        // Reset all overlays to active, then reapply fade/portraits for the new context.
        if (this._phase === "activity" && isStationLayerActive()) {
            resetStationOverlaysLocal();
            refreshStationEmptyNoticeFade(this);
            refreshStationPortraitsFromChoices(this._characterChoices, this._stationCanvasIdByCharacter);
            this._refreshStationOverlayMeals();
        }

        if (!this._isGM && this._phase === "activity") {
            this._postStationChoiceReview = true;
            this._stationReviewCharacterId = characterId;
            this._activitySubTab = "activity";
            this._activitySubTabUserSet = true;
            this._selectedCharacterId = characterId;
            this._activityDetailId = null;
            // Do NOT force-open the window â€” the player chose from the canvas and
            // should stay there. State is staged so the review panel shows when
            // they voluntarily resume via the footer bar.
            if (this.rendered) this.render();
        } else if (this.rendered) {
            this.render();
        }

        return activityResult;
    }

    /**
     * Canvas station id for post-pick overlay dimming when the activity was not chosen from a station.
     */
    static _inferCanvasStationForActivity(activityId, actorId = null) {
        return inferCanvasStationForActivity(activityId, actorId);
    }

    /**
     * Player: rebuild station dimming after token or roster focus changes (multi-PC).
     */
    _refreshStationOverlayForFocusChange() {
        if (this._phase !== "activity" || !isStationLayerActive()) return;
        const partyActors = getPartyActors();
        const viewer = RestSetupApp._resolveStationActorForUser(partyActors, this);
        const choices = this._characterChoices;
        if (!(choices instanceof Map)) return;

        resetStationOverlaysLocal();
        refreshStationEmptyNoticeFade(this);
        this._refreshStationOverlayMeals();

        if (game.user.isGM) {
            refreshStationPortraitsFromChoices(choices, this._stationCanvasIdByCharacter);
            return;
        }
        const vid = viewer?.id;
        if (vid && viewer.isOwner && choices.has(vid)) {
            const actId = choices.get(vid);
            const sid = this._stationCanvasIdByCharacter.get(vid)
                ?? RestSetupApp._inferCanvasStationForActivity(actId, vid);
            setStationPlayerState(vid, sid, choices, this._stationCanvasIdByCharacter);
        } else {
            refreshStationPortraitsFromChoices(choices, this._stationCanvasIdByCharacter);
        }
    }

    /**
     * Activity phase + track food: this actor still owes rations at a station dialog (meal tab).
     * Matches {@link #_getPendingMealCanvasPlan} per-actor eligibility.
     * @param {string} actorId
     * @returns {boolean}
     */
    _actorOwesActivityPhaseMealRations(actorId) {
        _noteEngineFreePath("_actorOwesActivityPhaseMealRations", this);
        if (!actorId || !game.settings.get(MODULE_ID, "trackFood") || this._phase !== "activity") {
            return false;
        }
        const terrainTag = this._engine?.terrainTag ?? this._selectedTerrain ?? this._restData?.terrainTag ?? "forest";
        const terrainMealRules = TerrainRegistry.getDefaults(terrainTag)?.mealRules ?? {};
        const fp = terrainMealRules.foodPerDay ?? 0;
        const wp = terrainMealRules.waterPerDay ?? 0;
        const terrainFoodWater = fp > 0 || wp > 0;
        const card = this.getStationMealCardForActor(actorId);
        if (!card || card.playerSubmitted) return false;
        if (!terrainFoodWater && !(card.needsEssence && card.essenceRequired > 0)) return false;
        return true;
    }

    /**
     * Per {@link StationActivityDialog.openForStation}, which stations have zero **available**
     * (non-faded) major activities for anyone in the party who has not yet committed a pick.
     * (Single-actor or "already chosen" shortcuts were wrong for GM: the next unchosen character
     * could still have a heal spell and kept the medical bed bright for everyone.)
     * When the resolved station actor ({@link #_resolveStationActorForUser}) has committed
     * an activity, the map is built for that character only. That matches
     * {@link StationActivityDialog.openForStation}, which clears all station activity lists for
     * an actor who already has a major pick (the resolver can still list activities, but they
     * get no further activity cards). Faded here means no meaningful station action is left, except
     * meal rations on the cooking or campfire station when that actor still owes rations. When the viewer has
     * committed a major pick, campfire and cooking both follow that meal-debt rule (no extra
     * blanket bright campfire).
     * Cooking station stays bright while any unchosen party member owes activity-phase rations (meal tab).
     * In single-character mode, meal stations stay bright while that actor still owes rations.
     * Workbench never fades: Identify stays available for potions and gear even when the resolver
     * lists no station activities or this actor already committed a major pick.
     * @returns {Record<string, boolean>}
     */
    _buildStationEmptyNoticeMap() {
        const map = {};
        const partyActors = getPartyActors();
        if (!this._activityResolver) return map;

        const restType = this._engine?.restType ?? "long";
        const fireLevel = this._fireLevel ?? "unlit";
        const isFireLit = !!(this._fireLevel && this._fireLevel !== "unlit");
        const safeRestSpot = !!(this._engine?.safeRestSpot ?? this._restData?.safeRestSpot);
        const choices = this._characterChoices;
        const unchosen = partyActors.filter(a => a?.id && !choices?.has(a.id));

        // For GM: any unchosen party member who owes rations keeps the cooking station bright.
        // For players: only the viewer's own actor matters â€” other players' ration debts are
        // opaque to this client and must not hold the station bright after the viewer has eaten.
        // Bug history: before this fix, mealBrightParty evaluated ALL unchosen actors,
        // keeping the cooking station bright on the submitting player's client because the
        // other players hadn't submitted yet â€” even when this player had no remaining ration debt.
        const viewer = RestSetupApp._resolveStationActorForUser(partyActors, this);
        let mealBrightParty;
        if (this._isGM) {
            mealBrightParty = unchosen.some(a => this._actorOwesActivityPhaseMealRations(a.id));
        } else {
            mealBrightParty = !!viewer
                && unchosen.some(a => a.id === viewer.id)
                && this._actorOwesActivityPhaseMealRations(viewer.id);
        }

        Logger.log(
            `viewer=${viewer?.name ?? "none"}`,
            `isGM=${this._isGM}`,
            `unchosenCount=${unchosen.length}`
        );

        const hasAvailableAtStation = (actor, stationIdSet) => {
            const { available: allAvail } = this._activityResolver.getAvailableActivitiesWithFaded(
                actor, restType, { isFireLit, fireLevel, safeRestSpot, ...this._forageResolverOpts() }
            );
            return allAvail.some(a => stationIdSet.has(a.id));
        };

        const terrainStationsForMap = getStationsForTerrain(this._selectedTerrain ?? this._engine?.terrainTag ?? "forest", safeRestSpot);

        if (viewer && this._characterChoices.has(viewer.id)) {
            for (const station of terrainStationsForMap) {
                if (!station.furnitureKey) continue;
                if (station.id === "workbench") {
                    map[station.id] = false;
                    continue;
                }
                if ((station.id === "cooking_station" || station.id === "campfire")
                    && this._actorOwesActivityPhaseMealRations(viewer.id)) {
                    map[station.id] = false;
                    continue;
                }
                // One major activity per rest: the station dialog offers no further picks for
                // this actor (lists cleared), even when the raw resolver would still return some.
                map[station.id] = true;
            }
            map.bedroll = true;
            return map;
        }

        for (const station of terrainStationsForMap) {
            if (!station.furnitureKey) continue;
            const stationIds = new Set(station.activities ?? []);

            const hasAny = unchosen.some(a => hasAvailableAtStation(a, stationIds));
            let empty = !hasAny;
            if (empty && mealBrightParty && station.id === "cooking_station") {
                empty = false;
            }
            if (station.id === "workbench" && isWorkbenchExamineUiEnabled()) {
                empty = false;
            }
            map[station.id] = empty;
        }

        const bedrollStation = terrainStationsForMap.find(s => s.id === "bedroll");
        if (bedrollStation) {
            const stationIds = new Set(bedrollStation.activities ?? []);
            map.bedroll = !unchosen.some(a => hasAvailableAtStation(a, stationIds));
        }

        if (this._phase === "activity") {
            map.campfire = false;
        }

        return map;
    }

    _refreshStationOverlayMeals() {
        if (isStationLayerActive()) refreshStationMealPortraits(this);
    }

    /**
     * @returns {{ stationId: string|null, urls: string[] }}
     */
    _getPendingMealCanvasPlan() {
        _noteEngineFreePath("_getPendingMealCanvasPlan", this);
        const empty = { stationId: null, urls: [] };
        if (!game.settings.get(MODULE_ID, "trackFood") || this._phase !== "activity") {
            return empty;
        }
        const urls = [];
        for (const actor of getPartyActors()) {
            if (!this._actorOwesActivityPhaseMealRations(actor.id)) continue;
            urls.push(actor.img ?? "icons/svg/mystery-man.svg");
        }
        if (!urls.length) return empty;

        const hasCooking = canvas?.ready && canvas.tokens.placeables.some(t => {
            const f = t.document.flags?.[MODULE_ID];
            return f?.isCampFurniture && f?.furnitureKey === "cookingArea";
        });
        const stationId = hasCooking ? "cooking_station" : "campfire";
        return { stationId, urls };
    }

    /**
     * Attaches interactive overlays to campsite station tokens (GM and players).
     */
    _activateCanvasStationLayer() {
        if (!canvas?.ready) return;
        // Make Camp pit dialog is camp-phase only; close any stray instance before activity station UI.
        CampfireMakeCampDialog.closeIfOpen();

        const partyActors = getPartyActors();
        const actorMap = {};
        for (const actor of partyActors) {
            const items = actor.items?.map(i => i.name?.toLowerCase() ?? "") ?? [];
            const hasBedroll = items.some(n => n.includes("bedroll"));
            const sceneToken = canvas.tokens?.placeables.find(t => t.actor?.id === actor.id);
            actorMap[actor.id] = {
                hasBedroll,
                assignedTokenId: sceneToken?.id ?? null
            };
        }

        const restSession = {
            fireLevel: this._fireLevel,
            restType:  this._engine?.restType
                ?? this._selectedRestType
                ?? this._restData?.restType
                ?? "long"
        };
        /* restSession.fireLevel is refreshed on each station click; the object is created once
         * when the layer activates and would otherwise keep the tier from that moment only. */

        const app = this;
        const proximityOpts = this._isGM
            ? {
                getProximityActorId: () => {
                    const roster = getPartyActors();
                    const a = RestSetupApp._resolveStationActorForUser(roster, app);
                    return a?.id ?? null;
                }
            }
            : {};

        const stationEmptyNoticeFade = this._buildStationEmptyNoticeMap();

        activateStationLayer(actorMap, async (stationId, token) => {
            const roster = getPartyActors();
            const actor = RestSetupApp._resolveStationActorForUser(roster, app);
            if (!actor) {

                console.warn(`${MODULE_ID} | Station click: no party actor for this user (assign a character or fix roster)`, {
                    userId: game.user.id,
                    partyIds: roster.map(a => a.id)
                });
                ui.notifications.warn("No character assigned for you in this rest. Ask the GM to check the party roster.");
                return;
            }
            const terrainTagForStation = app._selectedTerrain ?? app._engine?.terrainTag ?? "forest";
            const safeSpot = !!(app._engine?.safeRestSpot ?? app._restData?.safeRestSpot);
            const effectiveStations = getStationsForTerrain(terrainTagForStation, safeSpot);
            const station = effectiveStations.find(s => s.id === stationId);
            if (!station) return;

            const tokenFlags = token?.document?.flags?.[MODULE_ID];
            const isSharedBedroll = tokenFlags?.furnitureKey === "sharedBedroll";

            if (stationId === "bedroll" && !isSharedBedroll) {
                const bedrollOwnerActorId = tokenFlags?.ownerActorId;
                if (bedrollOwnerActorId !== actor.id) {
                    if (!game.user.isGM) {
                        const ownerName = bedrollOwnerActorId
                            ? (game.actors.get(bedrollOwnerActorId)?.name ?? "someone else")
                            : "someone else";
                        ui.notifications.warn(`That bedroll belongs to ${ownerName}.`);
                    }
                    return;
                }
            }

            if (stationId === "campfire" && isSimpleStationsMode()) {
                return;
            }


            Logger.log(`${MODULE_ID} | Station overlay click`, { stationId, actorId: actor.id, tokenId: token?.id });
            app._canvasFocusedStationId = stationId;
            app._activitySubTab = "activity";

            restSession.fireLevel = app._fireLevel ?? "unlit";
            restSession.restType = app._engine?.restType
                ?? app._selectedRestType
                ?? app._restData?.restType
                ?? "long";

            const dialogStation = (stationId === "bedroll" && !isSharedBedroll)
                ? { ...station, label: `${actor.name}'s ${station.label}` }
                : station;

            try {
                const restType = restSession.restType ?? "long";
                const fireLevel = app._fireLevel ?? restSession.fireLevel ?? "unlit";
                const isFireLit = !!(fireLevel && fireLevel !== "unlit");
                const resolverLoaded = !!(app._activityResolver?.activities?.size);
                const resolvedAvail = resolverLoaded
                    ? app._activityResolver.getAvailableActivitiesWithFaded(actor, restType, {
                        isFireLit,
                        fireLevel,
                        safeRestSpot: safeSpot,
                        ...(app._forageResolverOpts?.() ?? {})
                    })
                    : { available: [], faded: [] };
                const stationActIds = new Set(station.activities ?? []);
                await StationActivityDialog.openForStation(
                    dialogStation, actor, app._activityResolver, restSession, token, app, stationId
                );
            } catch (e) {

                console.warn(`${MODULE_ID} | Station activity dialog`, e);
            }
        }, {
            ...proximityOpts,
            stationEmptyNoticeFade,
            terrainTag: this._selectedTerrain ?? this._engine?.terrainTag ?? "forest",
            onLayerReady: () => {
                this._refreshStationOverlayMeals();
                refreshStationDetectMagicGlow(this);
                if (this._characterChoices?.size) {
                    refreshStationPortraitsFromChoices(this._characterChoices, this._stationCanvasIdByCharacter);
                    refreshStationEmptyNoticeFade(this);
                }
            }
        });

        this._installGmStationTokenSyncHook();
    }

    /**
     * Rebuild station overlays when new map tokens appear (bedroll, tent, shared furniture).
     * The layer is built at activity start; it does not auto-update until this runs.
     */
    refreshCanvasStationOverlaysIfActivity() {
        if (this._phase !== "activity") return;
        if (canvas?.ready) {
            this._activateCanvasStationLayer();
        } else {
            Hooks.once("canvasReady", () => {
                if (this._phase === "activity") this._activateCanvasStationLayer();
            });
        }
    }

    /**
     * Camp gear tokens changed on the scene; re-bind {@link StationActivityDialog} so drag / pick-up state matches.
     * (Rest window `render` does not re-render the separate station picker.)
     */
    refreshOpenStationDialogAfterCampGear() {
        void refreshOpenStationDialog();
    }

    /**
     * Party actor to use for canvas station activity (current user).
     * @param {Actor[]} partyActors
     * @param {RestSetupApp|null} [restApp] - GM: controlled party token wins over roster so canvas notices and clicks match the token on the board.
     * @returns {Actor|null}
     */
    static _resolveStationActorForUser(partyActors, restApp = null) {
        const inParty = (a) => a && partyActors.some(p => p.id === a.id);

        if (game.user?.isGM && restApp) {
            const fromTok = canvas.tokens?.controlled?.[0]?.actor;
            if (fromTok?.type === "character" && inParty(fromTok)) return fromTok;
            if (restApp._selectedCharacterId) {
                const sel = game.actors.get(restApp._selectedCharacterId);
                if (sel?.type === "character" && inParty(sel)) return sel;
            }
        }

        const assigned = game.user?.character;
        if (assigned && partyActors.some(a => a.id === assigned.id) && assigned.isOwner) {
            return assigned;
        }
        const owned = partyActors.filter(a => a.isOwner);
        if (owned.length === 1) return owned[0];
        if (owned.length > 1) {
            const fromToken = canvas.tokens?.controlled?.[0]?.actor;
            if (fromToken && owned.some(a => a.id === fromToken.id)) return fromToken;
            return owned[0];
        }
        const OBS = CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER;
        const playable = partyActors.find(a => a.testUserPermission(game.user, OBS));
        return playable ?? null;
    }

    _rebuildCharacterChoices() {
        this._characterChoices.clear();

        for (const [userId, submission] of this._playerSubmissions) {
            if (!submission?.choices || typeof submission.choices !== "object") continue;
            for (const [charId, actId] of Object.entries(submission.choices)) {
                this._characterChoices.set(charId, actId);
            }
        }

        for (const [charId, actId] of this._gmOverrides) {
            this._characterChoices.set(charId, actId);
        }
    }

    /**
     * Encounter line + watch list for activity advisories (main panel and station dialog).
     */
    getPartyStateForAdvisory() {
        const partyActors = getPartyActors();
        const _bd = this._engine?._encounterBreakdown ?? {};
        const _baseDC = this._eventResolver?.tables?.get(this._engine?.terrainTag)?.noEventThreshold ?? 15;
        const _mods = (_bd.shelter ?? 0) + (_bd.weather ?? 0) + (_bd.scouting ?? 0) + (this._engine?.fireRollModifier ?? 0);
        const _defenses = _bd.defenses ?? 0;
        const _currentDC = Math.max(1, _baseDC - _mods + (this._engine?.gmEncounterAdj ?? 0) - _defenses);
        // Merge confirmed choices, GM overrides, and pending selections into one view.
        // Pending wins over confirmed (latest player intent); GM overrides win over both.
        const allSelections = new Map([
            ...(this._characterChoices ?? []),
            ...(this._pendingSelections ?? []),
            ...(this._gmOverrides ?? []),
        ]);
        return buildPartyState(partyActors, allSelections, _currentDC, this._engine?.comfort);
    }

    /**
     * One meal card for the canvas station dialog (activity phase rations tab).
     * @param {string} actorId
     * @returns {object|null}
     */
    getStationMealCardForActor(actorId) {
        if (!actorId || !game.settings.get(MODULE_ID, "trackFood")) return null;
        // Players don't have a RestFlowEngine â€” derive terrainTag from snapshot state instead.
        const terrainTag = this._engine?.terrainTag ?? this._selectedTerrain ?? "forest";
        const terrainMealRules = TerrainRegistry.getDefaults(terrainTag)?.mealRules ?? {};
        const cards = MealPhaseHandler.buildMealContext(
            [actorId],
            terrainTag,
            terrainMealRules,
            this._daysSinceLastRest ?? 1,
            this._mealChoices ?? new Map(),
            this._buildSatiatesLookup()
        );
        const card = cards[0] ?? null;
        if (!card) return null;
        if (this._activityMealRationsSubmitted?.has(actorId)) card.playerSubmitted = true;
        if (!this._isGM && this._mealSubmitted && this._meals._mealObligatedOwnedCharacterIds(this).has(actorId)) {
            card.playerSubmitted = true;
        }
        return card;
    }

    /**
     * Build a nameâ†’satiates lookup from loaded CraftingEngine recipes.
     * Used so items crafted before outputFlags was applied can still be
     * recognised by name match for the water credit UI.
     * @returns {Map<string, string[]>|null}
     */
    _buildSatiatesLookup() {
        const engine = this._craftingEngine;
        if (!engine?.recipes?.size) return null;
        const lookup = new Map();
        for (const recipes of engine.recipes.values()) {
            for (const recipe of recipes) {
                const sat = recipe.outputFlags?.["ionrift-respite"]?.satiates;
                if (Array.isArray(sat) && recipe.output?.name) {
                    lookup.set(recipe.output.name.toLowerCase().trim(), sat);
                }
                const ambSat = recipe.ambitiousOutputFlags?.["ionrift-respite"]?.satiates
                    ?? recipe.outputFlags?.["ionrift-respite"]?.satiates;
                if (Array.isArray(ambSat) && recipe.ambitiousOutput?.name) {
                    lookup.set(recipe.ambitiousOutput.name.toLowerCase().trim(), ambSat);
                }
            }
        }
        return lookup.size ? lookup : null;
    }

    /**
     * After a food slot is assigned, check if the food satiates water and
     * remove excess water pool entries that are no longer needed.
     * Only trims non-locked entries from the end.
     * @param {string} charId
     */
    _autoTrimExcessWater(charId) {
        if (!this._mealChoices) return;
        const choice = this._mealChoices.get(charId);
        if (!choice) return;
        const actor = game.actors.get(charId);
        if (!actor) return;

        const foodArr = Array.isArray(choice.food) ? choice.food : [];
        const satiatesLookup = this._buildSatiatesLookup();

        let bonusWater = 0;
        for (const itemId of foodArr) {
            if (!itemId || itemId === "skip" || itemId.startsWith?.("__")) continue;
            const item = actor.items.get(itemId);
            if (!item) continue;
            const flags = item.flags?.[MODULE_ID] ?? {};
            let satiates = flags.satiates;
            if (!Array.isArray(satiates) && satiatesLookup) {
                satiates = satiatesLookup.get(item.name.toLowerCase().trim()) ?? null;
            }
            if (Array.isArray(satiates) && satiates.includes("water")) bonusWater++;
        }
        if (bonusWater <= 0) return;

        const terrainTag = this._engine?.terrainTag ?? this._selectedTerrain ?? "forest";
        const wpd = TerrainRegistry.getDefaults(terrainTag)?.mealRules?.waterPerDay ?? 2;
        const manualNeeded = Math.max(0, wpd - bonusWater);

        const waterArr = Array.isArray(choice.water) ? [...choice.water] : [];
        const lockedSlots = Array.isArray(choice.waterLockedSlots) ? choice.waterLockedSlots : [];

        // Count filled non-locked water entries
        const filledNonLocked = waterArr.reduce((n, v, i) => {
            if (lockedSlots.includes(i)) return n;
            return (v && v !== "skip" && !v.startsWith?.("__")) ? n + 1 : n;
        }, 0);
        if (filledNonLocked <= manualNeeded) return;

        // Trim excess from the end
        let toRemove = filledNonLocked - manualNeeded;
        for (let i = waterArr.length - 1; i >= 0 && toRemove > 0; i--) {
            if (lockedSlots.includes(i)) continue;
            if (waterArr[i] && waterArr[i] !== "skip" && !waterArr[i].startsWith?.("__")) {
                waterArr[i] = "skip";
                toRemove--;
            }
        }
        this._mealChoices.set(charId, { ...choice, water: waterArr });
    }

    /**
     * Workbench station Identify tab: caster lists are party-wide; Taste/Focus rows
     * are only for {@link options.restrictUnidentifiedToActorId} when set.
     * @param {{ restrictUnidentifiedToActorId?: string|null }} [options]
     * @returns {{
     *   unidentifiedItems: object[],
     *   identifyCasters: { id: string, name: string }[],
     *   detectMagicCasters: { id: string, name: string }[]
     * }}
     */
    getStationIdentifyEmbedContext(options = {}) {
        return collectPartyIdentifyEmbedData(getPartyActors(), options);
    }

    /** Toolbar: GM always; players only when they control a party member with Detect Magic. */
    canShowDetectMagicScanButtonFromParty() {
        return computeCanShowDetectMagicScanButton(getPartyActors());
    }

    /** True when a party member can actually trigger the Detect Magic scan (not just see the button). */
    canTriggerDetectMagicScanFromParty() {
        return computeCanTriggerDetectMagicScan(getPartyActors());
    }

    /** @deprecated Use this._workbench.getStaging() */
    _getWorkbenchIdentifyStaging(actorId) {
        return this._workbench.getStaging(actorId);
    }

    /** @deprecated Use this._workbench.setStaging() */
    _setWorkbenchIdentifyStaging(actorId, partial) {
        this._workbench.setStaging(actorId, partial);
    }

    /**
     * Station workbench: staged chips for Identify (items are dragged from the character sheet, not listed here).
     * @param {string|null} actorId
     */
    /** @deprecated Use this._workbench.getDragContext() */
    getWorkbenchIdentifyDragContext(actorId) {
        return this._workbench.getDragContext(actorId, collectPartyIdentifyEmbedData, getPartyActors);
    }

    /** @deprecated Use this._workbench.dismissAcknowledgement() */
    dismissWorkbenchIdentifyAcknowledgement(actorId) {
        this._workbench.dismissAcknowledgement(actorId);
    }

    /** @deprecated Use this._detectMagic.clearScanSession() */
    _clearDetectMagicScanSession(opts = {}) {
        this._detectMagic.clearScanSession(opts);
    }

    /** @deprecated Use this._detectMagic.broadcastPartyScan() */
    _broadcastDetectMagicPartyScan() {
        this._detectMagic.broadcastPartyScan(getPartyActors);
    }

    /** @deprecated Use this._workbench.removePotionFromStation() */
    removeWorkbenchIdentifyPotionFromStation(actorId, itemId) {
        this._workbench.removePotionFromStation(actorId, itemId);
    }

    /** @deprecated Use this._workbench.submitFromStation() */
    async submitWorkbenchIdentifyFromStation(actorId) {
        await this._workbench.submitFromStation(actorId);
    }

    /** @deprecated Use this._workbench.identifyItem() */
    async identifyItemFromWorkbenchStation(actorId, itemId, options = {}) {
        return this._workbench.identifyItem(actorId, itemId, options);
    }

    /** @deprecated Use this._detectMagic.runScan() */
    async runDetectMagicScan() {
        await this._detectMagic.runScan(getPartyActors);
    }

    /** @deprecated Use this._detectMagic.identifyScannedItem() */
    async identifyScannedMagicItem(actorId, itemId) {
        await this._detectMagic.identifyScannedItem(actorId, itemId, getPartyActors);
    }

    /**
     * Workbench: attune a prepared item to the given actor (SR or long rest station).
     * @param {string} actorId
     * @param {string} itemId
     */
    async attuneWorkbenchItemForActor(actorId, itemId) {
        const actor = game.actors.get(actorId);
        if (!actor) return;
        if (!actor.isOwner && !game.user.isGM) return;
        const item = actor.items.get(itemId);
        if (!item) return;
        const att = item.system?.attunement;
        if ((att !== "required" && att !== 1) || item.system?.attuned) {
            ui.notifications.warn("That item cannot be attuned here.");
            return;
        }
        const attuneSlots = actor.system?.attributes?.attunement;
        if (attuneSlots) {
            const current = attuneSlots.value ?? 0;
            const max = attuneSlots.max ?? 3;
            if (current >= max) {
                ui.notifications.warn(`${actor.name} is already attuned to the maximum number of items (${max}).`);
                return;
            }
        }
        try {
            await item.update({ "system.attuned": true });
            ui.notifications.info(`${actor.name} attunes to ${item.name}.`);
        } catch (e) {

            console.warn(`${MODULE_ID} | attuneWorkbenchItemForActor:`, e);
            ui.notifications.error("Could not attune that item.");
            return;
        }
        if (this.rendered) this.render();
    }

    /**
     * Activity phase: commit station rations for one character (GM records locally; player uses meal socket).
     * @param {string} actorId
     */
    async submitActivityMealRationsFromStation(actorId) {
        if (!actorId) return;
        _noteEngineFreePath("submitActivityMealRationsFromStation", this);
        const actor = game.actors.get(actorId);
        if (!actor) return;

        if (this._isGM) {
            if (this._activityMealRationsSubmitted?.has(actorId)) return;
            const skippedSlots = [];
            const choice = this._mealChoices?.get(actorId) ?? {};
            const foodArr = Array.isArray(choice.food) ? choice.food : [];
            const foodEmpty = foodArr.filter(v => !v || v === "skip").length;
            if (foodArr.length === 0 || foodEmpty > 0) {
                skippedSlots.push(
                    foodArr.length === 0
                        ? `${actor.name}: no food`
                        : `${actor.name}: ${foodEmpty} food slot${foodEmpty > 1 ? "s" : ""} empty`
                );
            }
            const waterArr = Array.isArray(choice.water) ? choice.water : [];
            // Account for food-based water credits before raising a skip warning.
            // Matches the smart-submit logic below so the dialog fires only when
            // water is genuinely short after food credits are applied.
            let warnBonusWater = 0;
            const warnSatiatesLookup = this._buildSatiatesLookup();
            for (const fid of foodArr) {
                if (!fid || fid === "skip" || fid.startsWith?.("__")) continue;
                const fItem = actor.items.get(fid);
                if (!fItem) continue;
                const fFlags = fItem.flags?.[MODULE_ID] ?? {};
                let fSat = fFlags.satiates;
                if (!Array.isArray(fSat) && warnSatiatesLookup) {
                    fSat = warnSatiatesLookup.get(fItem.name.toLowerCase().trim()) ?? null;
                }
                if (Array.isArray(fSat) && fSat.includes("water")) warnBonusWater++;
            }
            const warnTerrainTag = this._engine?.terrainTag ?? this._selectedTerrain ?? "forest";
            const warnWpd = TerrainRegistry.getDefaults(warnTerrainTag)?.mealRules?.waterPerDay ?? 2;
            const warnWaterNeeded = Math.max(0, warnWpd - warnBonusWater);
            const waterFilled = waterArr.filter(v => v && v !== "skip" && !v.startsWith?.("__")).length;
            const waterShortfall = Math.max(0, warnWaterNeeded - waterFilled);
            if (warnWaterNeeded > 0 && waterArr.length === 0 && waterShortfall > 0) {
                skippedSlots.push(`${actor.name}: no water`);
            } else if (waterShortfall > 0) {
                skippedSlots.push(`${actor.name}: ${waterShortfall} water pint${waterShortfall > 1 ? "s" : ""} still needed`);
            }
            if (skippedSlots.length > 0) {
                const confirmed = await new Promise(resolve => {
                    const overlay = document.createElement("div");
                    overlay.classList.add("ionrift-armor-modal-overlay");
                    overlay.innerHTML = `
                    <div class="ionrift-armor-modal">
                        <h3><i class="fas fa-exclamation-triangle"></i> Skip Meals?</h3>
                        <p>The following meals are empty:</p>
                        <ul>${skippedSlots.map(s => `<li>${s}</li>`).join("")}</ul>
                        <p>Skipping meals has consequences.</p>
                        <div class="ionrift-armor-modal-buttons">
                            <button class="btn-armor-confirm"><i class="fas fa-check"></i> Continue</button>
                            <button class="btn-armor-cancel"><i class="fas fa-arrow-left"></i> Go Back</button>
                        </div>
                    </div>`;
                    document.body.appendChild(overlay);
                    overlay.querySelector(".btn-armor-confirm").addEventListener("click", () => {
                        overlay.remove();
                        resolve(true);
                    });
                    overlay.querySelector(".btn-armor-cancel").addEventListener("click", () => {
                        overlay.remove();
                        resolve(false);
                    });
                });
                if (!confirmed) return;
            }

            // Consume items immediately and apply Well Fed buffs
            // (matches inventory consumption path for parity)
            const food = Array.isArray(choice.food) ? [...choice.food] : [];
            const water = Array.isArray(choice.water) ? [...choice.water] : [];
            const essence = Array.isArray(choice.essence) ? [...choice.essence] : [];

            // Snapshot food items before consumption for Well Fed resolution
            const foodSnapshots = new Map();
            for (const itemId of food) {
                if (itemId && itemId !== "skip") {
                    const item = actor.items.get(itemId);
                    if (item) foodSnapshots.set(itemId, item.toObject(false));
                }
            }

            const partyIds = this._mealChoices ? [...this._mealChoices.keys()] : [actorId];
            for (const itemId of food) {
                if (itemId && itemId !== "skip" && !itemId.startsWith("__")) {
                    const consumed = await MealPhaseHandler._consumeItem(actor, itemId, 1);
                    const snapshot = foodSnapshots.get(itemId);
                    if (snapshot && consumed > 0) {
                        await MealPhaseHandler._dispatchWellFedMealServing({
                            consumerActor: actor,
                            itemSnapshot: snapshot,
                            partyIds
                        });
                    }
                }
            }
            // â”€â”€ Smart submit: only consume water entries that are actually
            //    needed after accounting for meal-based water credits. â”€â”€
            let submitBonusWater = 0;
            const submitSatiatesLookup = this._buildSatiatesLookup();
            for (const fid of food) {
                if (!fid || fid === "skip" || fid.startsWith?.("__")) continue;
                const fItem = actor.items.get(fid);
                if (!fItem) continue;
                const fFlags = fItem.flags?.[MODULE_ID] ?? {};
                let fSat = fFlags.satiates;
                if (!Array.isArray(fSat) && submitSatiatesLookup) {
                    fSat = submitSatiatesLookup.get(fItem.name.toLowerCase().trim()) ?? null;
                }
                if (Array.isArray(fSat) && fSat.includes("water")) submitBonusWater++;
            }
            const submitTerrainTag = this._engine?.terrainTag ?? this._selectedTerrain ?? "forest";
            const submitWpd = TerrainRegistry.getDefaults(submitTerrainTag)?.mealRules?.waterPerDay ?? 2;
            const waterToConsume = Math.max(0, submitWpd - submitBonusWater);
            let waterConsumed = 0;
            for (const itemId of water) {
                if (waterConsumed >= waterToConsume) break;
                if (itemId && itemId !== "skip" && !itemId.startsWith("__")) {
                    await MealPhaseHandler._consumeItem(actor, itemId, 1);
                    waterConsumed++;
                }
            }
            for (const itemId of essence) {
                if (itemId && itemId !== "skip") {
                    await MealPhaseHandler._consumeItem(actor, itemId, 1);
                }
            }

            // Fold selections into consumedDays so processAndApply won't
            // re-consume them during the meal phase resolution
            const consumedDays = Array.isArray(choice.consumedDays) ? [...choice.consumedDays] : [];
            consumedDays.push({ food, water, essence });
            this._mealChoices.set(actorId, {
                ...choice,
                consumedDays,
                currentDay: consumedDays.length,
                food: [],
                water: [],
                essence: [],
                itemsConsumed: true,
                // Preserve locked slots for UI state
                foodLockedSlots: choice.foodLockedSlots ?? [],
                waterLockedSlots: choice.waterLockedSlots ?? []
            });

            if (!this._activityMealRationsSubmitted) this._activityMealRationsSubmitted = new Set();
            this._activityMealRationsSubmitted.add(actorId);
            await this._saveRestState();
            const snapshot = this.getRestSnapshot();
            if (snapshot) {
                emitRestSnapshot(snapshot);
            }
            notifyStationMealChoicesUpdated();
            if (isStationLayerActive()) {
                refreshStationEmptyNoticeFade(this);
                this._refreshStationOverlayMeals();
            }
            if (this.rendered) this.render();
            _refreshGmRestIndicator(this);
            ui.notifications.info(`${actor.name}: rations recorded for this rest.`);
            return;
        }

        if (!this._myCharacterIds?.has(actorId)) return;
        await this._meals.onSubmitStationMealChoices(actorId);
        notifyStationMealChoicesUpdated();
        if (isStationLayerActive()) {
            refreshStationEmptyNoticeFade(this);
            this._refreshStationOverlayMeals();
        }
        if (this.rendered) this.render();
        _refreshRejoinBar(this);
    }

    _getPlayerChoiceForCharacter(characterId) {
        for (const [userId, submission] of this._playerSubmissions) {
            // Guard: choices may be missing on malformed/legacy entries.
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

    /**
     * Build per-user travel UI state from serialized delegate data (GM or activeRest).
     * @param {object} travelState - Output of TravelResolutionDelegate.serialize()
     * @param {string} userId
     * @param {object} [opts]
     * @returns {object|null}
     */
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

            if (entry.status === "rolled" || entry.status === "resolved") {
                rolled[day] ??= {};
                rolled[day][actorId] = true;
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

    /**
     * Per-user travel slice for rejoin snapshots (owned actors only).
     * @param {string} userId
     * @returns {object|null}
     */
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

    /**
     * Apply travel UI state on a player client (rejoin, debrief, or world fallback).
     * @param {object} pt
     */
    _applyPlayerTravelRestore(pt) {
        if (!pt || this._isGM) return;

        if (pt.totalDays != null) this._travelTotalDays = pt.totalDays;
        if (pt.activeDay != null) this._travelActiveDay = pt.activeDay;
        if (pt.forageDC != null) this._travelForageDC = pt.forageDC;
        if (pt.huntDC != null) this._travelHuntDC = pt.huntDC;
        if (pt.scoutingAllowed != null) this._travelScoutingAllowed = pt.scoutingAllowed;

        if (pt.declarations) {
            this._playerTravelDeclarations = foundry.utils.mergeObject(
                this._playerTravelDeclarations ?? {},
                pt.declarations,
                { inplace: false, insertKeys: true, insertValues: true }
            );
        }
        if (pt.confirmed) {
            this._playerTravelConfirmed = foundry.utils.mergeObject(
                this._playerTravelConfirmed ?? {},
                pt.confirmed,
                { inplace: false, insertKeys: true, insertValues: true }
            );
        }
        if (pt.rolled) {
            this._playerTravelRolled = foundry.utils.mergeObject(
                this._playerTravelRolled ?? {},
                pt.rolled,
                { inplace: false, insertKeys: true, insertValues: true }
            );
        }
        if (pt.debrief?.length) {
            const merged = [...(this._travelDebrief ?? [])];
            for (const row of pt.debrief) {
                const actorId = row.result?.actorId;
                const dup = merged.some(
                    d => d.day === row.day && d.result?.actorId === actorId
                );
                if (!dup) merged.push(row);
            }
            this._travelDebrief = merged;
        }
        if (pt.fullyResolved != null) this._travelFullyResolved = !!pt.fullyResolved;
        if (pt.scoutingDone != null) this._travelScoutingDone = !!pt.scoutingDone;
    }

    /**
     * Player socket receiver: travel declarations, rolls, and debrief for owned actors.
     * @param {object} pt - Same shape as buildPlayerTravelRestoreFromSerialized output
     */
    receiveTravelPlayerState(pt) {
        this._applyPlayerTravelRestore(pt);
        this.render();
    }

    /**
     * Exports a snapshot of the current rest state for late-joining/rejoining players.
     * @returns {Object} Full state snapshot
     */
    getRestSnapshot() {
        // Build submissions map for player display
        const submissions = {};
        for (const [charId, actId] of this._characterChoices) {
            const act = this._activities?.find(a => a.id === actId);
            submissions[charId] = { activityId: actId, activityName: act?.name ?? actId, source: "snapshot" };
        }


        return {
            phase: this._phase,
            submissions,
            triggeredEvents: (this._triggeredEvents ?? []).map(e => ({
                ...e,
                name: undefined,
                narrative: undefined
            })),
            activeTreeState: this._activeTreeState ?? null,
            outcomes: (this._outcomes ?? []).map(o => ({
                characterId: o.characterId,
                characterName: o.characterName,
                outcomes: o.outcomes,
                recovery: o.recovery
            })),
            afkCharacters: RestAfkState.getAfkCharacterIds(),
            doffedArmor: this._doffedArmor ? [...this._doffedArmor] : [],
            eventsRolled: this._eventsRolled ?? false,
            fireLevel: this._fireLevel ?? "unlit",
            fireLitBy: this._fireLitBy ?? null,
            firewoodPledges: Array.from(this._firewoodPledges?.entries() ?? []),
            makeCampStagedWood: [...(this._makeCampStagedWood ?? [])],
            campfireSnapshot: RestSetupApp._campfireSnapshotFromFireLevel(this._fireLevel),
            campStatus: this._campStatus ?? null,
            daysSinceLastRest: this._daysSinceLastRest ?? 1,
            selectedTerrain: this._selectedTerrain ?? "forest",
            campRollRequest: this._pendingCampRolls?.some(p => p.requested) ? {
                activities: this._pendingCampRolls.filter(p => p.requested).map(p => ({
                    characterId: p.characterId,
                    activityId: p.activityId,
                    activityName: p.activityName,
                    skill: p.skill,
                    skillName: p.skillName,
                    dc: p.dc,
                    status: p.status,
                    total: p.total
                }))
            } : null,
            mealChoices: this._mealChoices ? Object.fromEntries(this._mealChoices) : null,
            mealSubmitted: this._mealSubmitted ?? false,
            activityMealRationsSubmitted: [...(this._activityMealRationsSubmitted ?? [])],
            totmFeastServed: this._totmFeastServed ?? false,
            dehydrationResults: (this._pendingDehydrationSaves ?? []).filter(s => s.resolved).map(s => ({
                actorName: s.actorName,
                total: s.total,
                passed: s.passed,
                dc: s.dc,
                reason: s.reason ?? null
            })),
            magicScanComplete: !!this._magicScanComplete,
            magicScanResults: this._magicScanComplete ? (this._magicScanResults ?? []) : null,
            coldCampDecided: this._coldCampDecided ?? false,
            campStep2Entered: this._campStep2Entered ?? false,
            safeRestSpot: !!this._engine?.safeRestSpot,
            comfort: this._engine?.comfort ?? "rough",
            activeShelters: this._engine?.activeShelters ?? [],
            // Include the activity list so late-joining players can load their resolver.
            activities: this._activities ?? [],
            lockedCharacters: Array.from(this._lockedCharacters ?? []),
            craftingResults: Object.fromEntries(this._craftingResults ?? []),
            earlyResults: Object.fromEntries(this._earlyResults ?? []),
            trainingStates: Object.fromEntries(
                [...(this._trainingStates ?? [])].map(([id, s]) => [id, { ...s, rolling: false }])
            )
        };
    }

    /**
     * Snapshot for a specific reconnecting player (includes owned travel state).
     * @param {string} userId
     * @returns {Object}
     */
    getRestSnapshotForUser(userId) {
        const snapshot = this.getRestSnapshot();
        if (!userId || this._phase !== "travel") return snapshot;
        const playerTravel = this._buildPlayerTravelRestore(userId);
        if (playerTravel) snapshot.playerTravel = playerTravel;
        return snapshot;
    }

    // â”€â”€â”€â”€â”€â”€â”€â”€ Player-mode socket receivers â”€â”€â”€â”€â”€â”€â”€â”€

    /**
     * Receives a phase change from the GM and re-renders.
     */
    async receivePhaseChange(phase, phaseData = {}) {
        const prevPhase = this._phase;
        if (prevPhase === "activity" && phase !== "activity") {
            void this._detectMagic?.cleanupCastArtifactsOnPhaseExit(getPartyActors());
        }
        const enteringTotmCamp = this._isTotM && phase === "camp" && prevPhase !== "camp";
        this._phase = phase;
        if (phaseData.triggeredEvents) {
            this._triggeredEvents = this._isGM ? phaseData.triggeredEvents
                : phaseData.triggeredEvents.map(e => ({ ...e, name: undefined, narrative: undefined, description: undefined, gmPrompt: undefined, checkContext: undefined, gmGuidance: undefined, readAloud: undefined }));

            if (this._pendingEventRoll) {
                const evt = phaseData.triggeredEvents[this._pendingEventRoll.eventIndex];
                if (evt?.resolvedRolls?.length) {
                    if (!this._pendingEventRoll.rolledCharacters) {
                        this._pendingEventRoll.rolledCharacters = new Set();
                    }
                    for (const entry of evt.resolvedRolls) {
                        this._pendingEventRoll.rolledCharacters.add(entry.characterId);
                    }
                }
            }
        }
        if (phaseData.activeTreeState) this._activeTreeState = phaseData.activeTreeState;
        if (phaseData.eventsRolled !== undefined) this._eventsRolled = phaseData.eventsRolled;
        if (phaseData.fireLevel !== undefined && phaseData.fireLevel !== null) {
            this._fireLevel = phaseData.fireLevel;
            this._campFirePreviewLevel = null;
            if (this._engine) {
                this._engine.fireLevel = phaseData.fireLevel;
                const enc = CampGearScanner.FIRE_ENCOUNTER_MOD_BY_LEVEL[phaseData.fireLevel] ?? 0;
                this._engine.fireRollModifier = enc;
            }
            if (phase === "camp") {
                const fl = phaseData.fireLevel;
                if (!game.user.isGM) {
                    void CampfireTokenLinker.setLightState(
                        fl !== "unlit",
                        fl && fl !== "unlit" ? fl : undefined
                    );
                }
                CampfireMakeCampDialog.refreshIfOpen(this);
            }
        }
        if (phaseData.comfort && this._engine) {
            this._engine.comfort = phaseData.comfort;
        }
        if (phaseData.activeShelters && this._engine) {
            this._engine.activeShelters = phaseData.activeShelters;
            if (!game.user.isGM) {
                const fl = phaseData.fireLevel;
                void CampfireTokenLinker.setLightState(
                    fl !== "unlit",
                    fl && fl !== "unlit" ? fl : null
                );
            }
            void refreshOpenStationDialog();
        }
        if (phaseData.fireLitBy !== undefined) this._fireLitBy = phaseData.fireLitBy ?? null;
        if (phaseData.firewoodPledges !== undefined) this._firewoodPledges = new Map(phaseData.firewoodPledges ?? []);
        if (phaseData.makeCampStagedWood !== undefined) {
            this._makeCampStagedWood = [...(phaseData.makeCampStagedWood ?? [])];
            this._makeCampStagedWoodTier = this._campPreviewFirewoodCost();
        }
        if (phaseData.coldCampDecided !== undefined) {
            this._coldCampDecided = !!phaseData.coldCampDecided;
            if (phaseData.coldCampDecided) {
                this._campFirePreviewLevel = null;
                if (phase === "camp" && !game.user.isGM) {
                    void CampfireTokenLinker.setLightState(false);
                }
                CampfireMakeCampDialog.refreshIfOpen(this);
            }
        }
        // Synced preview state: fire level preview and cold camp preview (not committed)
        if (phaseData.campFirePreviewLevel !== undefined) {
            this._campFirePreviewLevel = phaseData.campFirePreviewLevel;
        }
        if (phaseData.coldCampPreview !== undefined) {
            this._coldCampPreview = !!phaseData.coldCampPreview;
            // If cold camp preview is active, set preview level to cold_camp
            if (this._coldCampPreview) {
                this._campFirePreviewLevel = "cold_camp";
            }
        }
        if (phaseData.campFirePreviewLevel !== undefined) {
            this._maybeClearStagedWoodOnTierChange(phaseData.campFirePreviewLevel);
        }
        if (phaseData.coldCampPreview) {
            this._makeCampStagedWood = [];
            this._makeCampStagedWoodTier = 0;
        }
        if (
            phase === "camp"
            && (phaseData.campFirePreviewLevel !== undefined
                || phaseData.coldCampPreview !== undefined
                || phaseData.makeCampStagedWood !== undefined)
        ) {
            this._syncCampCeremonyPreviewToEmbed();
        }
        if (phaseData.campStep2Entered) this._campStep2Entered = true;
        if (phaseData.campStatus) this._campStatus = phaseData.campStatus;
        if (phaseData.outcomes) this._outcomes = phaseData.outcomes;
        if (phaseData.awaitingCombat !== undefined) {
            this._awaitingCombat = phaseData.awaitingCombat;
            // Reset meal processing flag when combat is acknowledged (i.e., moving past meal phase)
            this._mealProcessed = false;
        }

        // Meal phase data from GM
        if (phaseData.daysSinceLastRest !== null && phaseData.daysSinceLastRest !== undefined) {
            this._daysSinceLastRest = phaseData.daysSinceLastRest;
        }
        if (phaseData.selectedTerrain) this._selectedTerrain = phaseData.selectedTerrain;
        if (phase === "meal") {
            // Only reset submission if this is a genuinely new meal phase,
            // not a reconnect/resume where the player already submitted
            if (!this._mealSubmitted) {
                this._mealSubmitted = false;
            }
            this._mealChoices = this._mealChoices ?? new Map();
            // Restore meal choices (including consumedDays) from world setting on reconnect
            try {
                const saved = game.settings.get(MODULE_ID, "activeRest");
                if (saved?.mealChoices) {
                    const savedChoices = new Map(saved.mealChoices);
                    for (const [charId, choice] of savedChoices) {
                        const existing = this._mealChoices.get(charId);
                        // Only restore if client has no data yet (fresh reconnect)
                        if (!existing || !existing.consumedDays?.length) {
                            this._mealChoices.set(charId, choice);
                        }
                    }
                }
                if (saved?.daysSinceLastRest) this._daysSinceLastRest = saved.daysSinceLastRest;
            } catch (e) { /* setting may not exist */ }
        }

        // Camp roll request: merge individual GM requests into pending pool
        if (phaseData.campRollRequest) {
            if (!this._pendingCampRoll) {
                this._pendingCampRoll = { activities: [], rolledCharacters: new Set() };
            }
            for (const act of phaseData.campRollRequest.activities ?? []) {
                if (!this._pendingCampRoll.activities.some(a => a.characterId === act.characterId)) {
                    this._pendingCampRoll.activities.push(act);
                }
            }
        }

        // Camp roll results update: sync pass/fail outcomes from GM
        if (phaseData.campRollsUpdate && this._pendingCampRoll) {
            for (const update of phaseData.campRollsUpdate) {
                const act = this._pendingCampRoll.activities?.find(a => a.characterId === update.characterId);
                if (act) {
                    act.status = update.status;
                    act.total = update.total;
                    act.narrative = update.narrative ?? "";
                    act.effectDescriptions = update.effectDescriptions ?? [];
                    if (update.status !== "pending") {
                        this._pendingCampRoll.rolledCharacters.add(update.characterId);
                    }
                }
            }
        }

        // Campfire panel lifecycle for players
        // NOTE: Reflection phase skipped (v2.1); always close.
        this._closeCampfire();

        // Activity phase: canvas station overlays for all clients; players minimise to the rest bar
        if (phase === "activity") {
            const isTheater = this._isTotM;
            if (!this._isGM) {
                _removeGmRestIndicator();
            }
            if (!isTheater) {
                this._attachActivityPhaseCanvasChrome();
                if (!this._isGM) {

                    Logger.log(`${MODULE_ID} | Activity phase (player): minimise rest window, retain app for station sockets`);
                    await this.close({ retainPlayerApp: true });
                    return;
                }
            }
        } else if (prevPhase === "activity" && phase !== "activity") {
            await closeOpenStationDialog();
            this._tearDownStationLayerCanvas();
            // Player was minimised during activity phase â€” auto-open the RSA so they
            // see the current rest phase (events, meal, reflection, etc.)
            if (!this._isGM) {
                _removeRejoinBar();
        Logger.log(`${MODULE_ID} | Phase ${prevPhase}â†’${phase} (player): removing rejoin bar, auto-opening RSA`);
            }
        }

        if (phaseData.campPitCursorDone && phase === "camp") {
            requestAnimationFrame(() => {
                if (this._refreshCampPitNoticeLayer) void this._refreshCampPitNoticeLayer();
            });
        }

        if (this._isGM && phase === "activity") {
            if (this._gmMinimizedToFooter) {
                _logGmRestSheet("receivePhaseChange", "GM early return (already minimized)", { phase, prevPhase });
                return;
            }
            this._gmMinimizedToFooter = true;
            _showGmRestIndicator(this);
            if (this.rendered) {
                _logGmRestSheet("receivePhaseChange", "GM close (socket not used for GM in module; local call only)", { phase, prevPhase });
                await this.close({ retainGmRestApp: true });
            }
            return;
        }
        // Reset position when re-opening from a retained-but-closed state
        // so the window appears centered at its natural width, not thin/off-right.
        if (!this._isGM && prevPhase === "activity") {
            const defaultWidth = 720;
            this.setPosition({
                width: defaultWidth,
                left: Math.max(0, (window.innerWidth - defaultWidth) / 2),
                top: Math.max(0, (window.innerHeight - 600) / 2)
            });
        }
        const phaseRenderPromise = Promise.resolve(this.render({ force: true }));
        if (enteringTotmCamp) {
            phaseRenderPromise.then(() => this._scheduleRestWindowRecenter());
        }

        // If the player RSA render fails outright, fall back to the rejoin bar
        // so the player can still see the current phase and resume manually.
        // The previous 300ms setTimeout was a guess; on a slow refresh it
        // could fire before render finished and leave both the bar and the
        // RSA visible.
        if (!this._isGM) {
            phaseRenderPromise.catch((err) => {

                Logger.log(`${MODULE_ID} | Phase ${phase}: player RSA render failed, falling back to rejoin bar`, err);
                _ensureRejoinBar(this);
            });
        }
    }

    /**
     * Receives updated submission statuses from the GM.
     */
    receiveSubmissionUpdate(submissions) {
        if (!submissions || typeof submissions !== "object") {

            Logger.warn("[receiveSubmissionUpdate] received null/undefined submissions â€” ignored.");
            return;
        }

        // Store submission status for display (non-owned characters).
        this._submissionStatus = submissions;

        // Apply the GM's canonical choices directly to _characterChoices.
        // Do NOT write into _playerSubmissions â€” that map is keyed by userId,
        // and writing charId-keyed entries here corrupts the schema and crashes
        // _getPlayerChoiceForCharacter when it accesses submission.choices.
        for (const [charId, info] of Object.entries(submissions)) {
            if (info?.activityId) {
                this._characterChoices.set(charId, info.activityId);
                this._lockedCharacters.add(charId);
            }
        }
        this._updateRestBarProgress();
        // Refresh the player rejoin bar in-place (it bakes the count at creation time).
        _refreshRejoinBar(this);
        if (this._phase === "activity" && isStationLayerActive()) {
            refreshStationPortraitsFromChoices(this._characterChoices, this._stationCanvasIdByCharacter);
            refreshStationEmptyNoticeFade(this);
            this._refreshStationOverlayMeals();
        }
        this.render();
    }

    /**
     * Receives a full rest state snapshot and applies it in one shot.
     * Used for visibility resync and rejoin to avoid race conditions.
     */
    receiveRestSnapshot(snapshot) {
        if (!this._isGM) {
            _removeGmRestIndicator();
        }
        // Apply submissions
        if (snapshot.submissions) {
            // Apply canonical choices directly to _characterChoices.
            // Do NOT write into _playerSubmissions â€” that map is keyed by userId.
            // Writing charId-keyed entries here corrupts the schema and crashes render.
            for (const [charId, info] of Object.entries(snapshot.submissions)) {
                const actId = info?.activityId ?? info?.activityName;
                if (actId) this._characterChoices.set(charId, actId);
            }
        }

        if (snapshot.afkCharacters !== undefined) {
            RestAfkState.replaceAll(snapshot.afkCharacters ?? []);
            pushAllStateToAdapters();
        }

        // Apply phase + phase data
        if (snapshot.phase) {
            this._phase = snapshot.phase;
        }
        if (this._restData && snapshot.safeRestSpot !== undefined) {
            this._restData = { ...this._restData, safeRestSpot: !!snapshot.safeRestSpot };
        }
        if (snapshot.triggeredEvents) {
            this._triggeredEvents = this._isGM ? snapshot.triggeredEvents
                : snapshot.triggeredEvents.map(e => ({ ...e, name: undefined, narrative: undefined, description: undefined, gmPrompt: undefined, checkContext: undefined, gmGuidance: undefined, readAloud: undefined }));
        }
        if (snapshot.activeTreeState) {
            this._activeTreeState = snapshot.activeTreeState;
            // Reconstruct player-side tree roll request from tree state, but only
            // once the GM has explicitly dispatched it. Between picking an option
            // and pressing Send the GM is still configuring modifiers, so players
            // must not see a roll prompt yet.
            if (!this._isGM && snapshot.activeTreeState.awaitingRolls && snapshot.activeTreeState.rollRequestSent) {
                const alreadyRolled = new Set(
                    (snapshot.activeTreeState.resolvedRolls ?? []).map(r => r.characterId ?? r.actorId)
                );
                this._pendingTreeRoll = {
                    choiceId: snapshot.activeTreeState.pendingChoice,
                    skills: snapshot.activeTreeState.pendingCheck?.skills ?? [],
                    skillName: snapshot.activeTreeState.pendingSkillName ?? "Skill",
                    dc: snapshot.activeTreeState.pendingDC ?? 12,
                    targets: [
                        ...(snapshot.activeTreeState.pendingRolls ?? []),
                        ...(snapshot.activeTreeState.resolvedRolls ?? []).map(r => r.characterId ?? r.actorId)
                    ],
                    eventName: snapshot.activeTreeState.eventName,
                    rollModes: snapshot.activeTreeState.pendingRollModes ?? {},
                    rolledCharacters: alreadyRolled,
                    rolledResults: new Map(
                        (snapshot.activeTreeState.resolvedRolls ?? []).map(r => [
                            r.characterId ?? r.actorId,
                            { total: r.total, passed: r.passed }
                        ])
                    )
                };
            } else if (!this._isGM) {
                // Not yet dispatched (GM still configuring) or already resolved:
                // drop any stale prompt so the player UI stays in step.
                this._pendingTreeRoll = null;
            }
        }
        // Reconstruct player-side event roll request from triggered events.
        // The event roll request lives only in _pendingEventRoll (set via socket) and
        // is not otherwise in the snapshot, so an alt-tab resync would drop it and the
        // player would fall back to "The GM is adjudicating...". Rebuild it here.
        if (!this._isGM) {
            const awaitingIndex = (this._triggeredEvents ?? []).findIndex(e => e?.awaitingRolls);
            if (awaitingIndex >= 0) {
                const evt = this._triggeredEvents[awaitingIndex];
                const resolved = evt.resolvedRolls ?? [];
                const skillKey = evt.mechanical?.skill ?? "sur";
                const targetIds = evt.targets?.length
                    ? evt.targets
                    : [...(evt.pendingRolls ?? []), ...resolved.map(r => r.characterId)];
                const priorRolled = (this._pendingEventRoll?.eventIndex === awaitingIndex)
                    ? this._pendingEventRoll.rolledCharacters
                    : null;
                const rolledCharacters = priorRolled ?? new Set();
                for (const r of resolved) rolledCharacters.add(r.characterId ?? r.id);
                this._pendingEventRoll = {
                    eventIndex: awaitingIndex,
                    skill: skillKey,
                    skillName: SKILL_NAMES[skillKey] ?? skillKey,
                    dc: evt.mechanical?.dc ?? 10,
                    targets: [...new Set(targetIds.filter(Boolean))],
                    rollModes: evt.rollModes ?? {},
                    eventTitle: evt.title ?? "Event",
                    targetLabel: buildRollTargetLabel(evt.mechanical),
                    rolledCharacters
                };
            } else if (this._pendingEventRoll) {
                this._pendingEventRoll = null;
            }
        }
        if (snapshot.outcomes?.length) this._outcomes = snapshot.outcomes;
        if (snapshot.eventsRolled !== undefined) this._eventsRolled = snapshot.eventsRolled;
        if (snapshot.fireLevel !== undefined && snapshot.fireLevel !== null) {
            this._fireLevel = snapshot.fireLevel;
            if (this._engine) {
                this._engine.fireLevel = snapshot.fireLevel;
                const enc = CampGearScanner.FIRE_ENCOUNTER_MOD_BY_LEVEL[snapshot.fireLevel] ?? 0;
                this._engine.fireRollModifier = enc;
            }
        }
        if (snapshot.comfort && this._engine) {
            this._engine.comfort = snapshot.comfort;
        }
        if (snapshot.activeShelters && this._engine) {
            this._engine.activeShelters = snapshot.activeShelters;
        }
        if (snapshot.safeRestSpot !== undefined && this._engine) {
            this._engine.safeRestSpot = !!snapshot.safeRestSpot;
        }
        if (snapshot.fireLitBy !== undefined) this._fireLitBy = snapshot.fireLitBy ?? null;
        if (snapshot.firewoodPledges !== undefined) {
            this._firewoodPledges = new Map(snapshot.firewoodPledges ?? []);
        }
        if (snapshot.makeCampStagedWood !== undefined) {
            this._makeCampStagedWood = [...(snapshot.makeCampStagedWood ?? [])];
            this._makeCampStagedWoodTier = this._campPreviewFirewoodCost();
        }
        if (snapshot.coldCampDecided !== undefined) {
            this._coldCampDecided = !!snapshot.coldCampDecided;
        }
        if (snapshot.campStep2Entered !== undefined) {
            this._campStep2Entered = !!snapshot.campStep2Entered;
        }
        if (snapshot.campfireSnapshot) {
            this._campfireSnapshot = snapshot.campfireSnapshot;
        }
        if (snapshot.campStatus) this._campStatus = snapshot.campStatus;

        // Restore camp roll data for pending camp activity checks
        if (snapshot.campRollRequest) {
            this._pendingCampRoll = {
                activities: snapshot.campRollRequest.activities ?? [],
                rolledCharacters: new Set(
                    (snapshot.campRollRequest.activities ?? [])
                        .filter(a => a.status && a.status !== "pending")
                        .map(a => a.characterId)
                )
            };
        }

        // Apply armor state
        if (snapshot.doffedArmor?.length) {
            if (!this._doffedArmor) this._doffedArmor = new Map();
            for (const [actorId, itemId] of snapshot.doffedArmor) {
                this._doffedArmor.set(actorId, itemId);
            }
        }

        // Restore meal state from snapshot
        if (snapshot.mealChoices) {
            this._mealChoices = new Map(Object.entries(snapshot.mealChoices));
        }
        // Only set mealSubmitted to true, never clear it (player's local state takes precedence)
        if (snapshot.mealSubmitted) {
            this._mealSubmitted = true;
        }
        if (Array.isArray(snapshot.activityMealRationsSubmitted)) {
            this._activityMealRationsSubmitted = new Set(snapshot.activityMealRationsSubmitted);
        }
        if (snapshot.totmFeastServed != null) {
            this._totmFeastServed = !!snapshot.totmFeastServed;
        }
        if (snapshot.daysSinceLastRest) {
            this._daysSinceLastRest = snapshot.daysSinceLastRest;
        }
        if (snapshot.selectedTerrain) {
            this._selectedTerrain = snapshot.selectedTerrain;
        }
        if (snapshot.dehydrationResults?.length) {
            this._dehydrationResults = snapshot.dehydrationResults;
        }

        if ("magicScanComplete" in snapshot) {
            if (snapshot.magicScanComplete) {
                this._magicScanResults = snapshot.magicScanResults ?? [];
                this._magicScanComplete = true;
                notifyDetectMagicScanApplied(this, getPartyActors().map(a => a.id));
            } else {
                const hadComplete = this._magicScanComplete;
                this._magicScanResults = null;
                this._magicScanComplete = false;
                if (hadComplete) notifyDetectMagicScanCleared();
            }
        }

        // Reload activity resolver from snapshot if it arrives without one.
        // This covers late-joining players who missed the initial emitRestStarted.
        if (snapshot.lockedCharacters?.length) {
            this._lockedCharacters = new Set(snapshot.lockedCharacters);
        }
        if (snapshot.craftingResults && typeof snapshot.craftingResults === "object") {
            this._craftingResults = new Map(Object.entries(snapshot.craftingResults));
            for (const charId of this._craftingResults.keys()) {
                this._lockedCharacters.add(charId);
            }
        }
        if (snapshot.earlyResults && typeof snapshot.earlyResults === "object") {
            this._earlyResults = this._earlyResults ?? new Map();
            for (const [charId, result] of Object.entries(snapshot.earlyResults)) {
                if (result && !this._earlyResults.has(charId)) {
                    this._earlyResults.set(charId, result);
                }
            }
        }
        if (snapshot.trainingStates && typeof snapshot.trainingStates === "object") {
            this._trainingStates = new Map(Object.entries(snapshot.trainingStates));
            this._clearStaleTrainingRollingFlags();
        }

        if (this._phase === "activity") {
            this._ensureTrainingStateForLockedChoices();
            this._syncIncompleteTrainingView();
        }

        if (snapshot.playerTravel) {
            this._applyPlayerTravelRestore(snapshot.playerTravel);
        } else if (!this._isGM && this._phase === "travel") {
            try {
                const saved = game.settings.get(MODULE_ID, "activeRest");
                if (saved?.travelState) {
                    const pt = RestSetupApp.buildPlayerTravelRestoreFromSerialized(
                        saved.travelState,
                        game.user.id
                    );
                    if (pt) this._applyPlayerTravelRestore(pt);
                }
            } catch { /* setting may be unavailable */ }
        }

        if (Array.isArray(snapshot.activities) && snapshot.activities.length > 0
            && !(this._activityResolver?.activities?.size)) {
            this._activities = snapshot.activities;
            this._activityResolver.load(this._activities);
        }

        if (this._phase === "activity" && isStationLayerActive()) {
            refreshStationPortraitsFromChoices(this._characterChoices, this._stationCanvasIdByCharacter);
            refreshStationEmptyNoticeFade(this);
            this._refreshStationOverlayMeals();
        }

        // Campfire panel lifecycle on snapshot restore
        // NOTE: Reflection phase skipped (v2.1); always close.
        this._closeCampfire();

        // Activity phase: same as receivePhaseChange (F5 rejoin after GM already advanced)
        const _isTheaterRestore = this._isTotM;
        if (this._phase === "activity" && !this._isGM) {
            if (!_isTheaterRestore) {
                this._attachActivityPhaseCanvasChrome();
                if (this.rendered) {
                    // Mirror the GM guard above: only close when there's a
                    // rendered window to dismiss. Closing an unrendered app
                    // races with any pending force-render and leaves both
                    // the RSA and the rejoin bar visible.
                    void this.close({ retainPlayerApp: true });
                } else {
                    // Stations + activity wants the canvas-only surface;
                    // skip the render and put up the rejoin bar directly.
                    _ensureRejoinBar(this);
                }
                return;
            }
        }
        if (this._phase === "activity" && this._isGM) {
            if (!_isTheaterRestore) {
                this._attachActivityPhaseCanvasChrome();
                this._gmMinimizedToFooter = true;
                _showGmRestIndicator(this);
                if (this.rendered) {
                    void this.close({});
                }
                return;
            }
        }

        // Single render with all state applied. Force-render so the first
        // pass works on a fresh app (handleRestStarted now defers to us when
        // a snapshot is included; without force, ApplicationV2 may no-op on
        // a state-NONE or state-CLOSED app).
        const snapshotRenderPromise = Promise.resolve(this.render({ force: true }));

        // If render fails, fall back to the rejoin bar so the player can
        // still resume manually. Replaces the previous 300ms setTimeout
        // guess, which mis-fired on slow refreshes and left the bar visible
        // alongside a successfully rendered RSA.
        if (!this._isGM) {
            snapshotRenderPromise.catch((err) => {

                Logger.log(`${MODULE_ID} | receiveRestSnapshot: player RSA render failed, falling back to rejoin bar`, err);
                _ensureRejoinBar(this);
            });
        }
    }

    /**
     * Receives armor doff/don state from another client.
     */
    receiveArmorToggle(actorId, itemId, isDoffed) {
        if (!this._doffedArmor) this._doffedArmor = new Map();
        if (isDoffed) {
            this._doffedArmor.set(actorId, itemId);
        } else {
            this._doffedArmor.delete(actorId);
        }
        this.render();
    }

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    //  TRAVEL RESOLUTION PHASE
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

    /**
     * GM adjusts the global forage or hunt DC.
     */
    static #onAdjustGlobalDC(event, target) {
        event.preventDefault?.();
        if (!game.user.isGM) return;
        const activity = target.dataset.activity;
        const delta = parseInt(target.dataset.delta) || 0;
        if (!activity || !delta) return;
        this._travel.adjustGlobalDC(activity, delta);
        this._saveRestState();
        this.render();
    }

    /**
     * GM sends roll requests for the active day's declared characters.
     */
    static #onRequestTravelRolls(event, target) {
        if (!game.user.isGM) return;
        const day = parseInt(target.dataset.day) || this._travel.activeDay;
        const payloads = this._travel.getAllRollRequestPayloads(day);
        if (!payloads.length) return;

        for (const p of payloads) {
            this._travel.markRequested(p.actorId, day);
        }

        emitTravelRollRequest({
                    activities: payloads,
                    day
                });

        emitPhaseChanged("travel", {
                travelRollRequest: { activities: payloads, day }
            });

        ui.notifications.info(`Day ${day} roll requests sent to ${payloads.length} character(s).`);
        this._saveRestState();
        this.render();
    }

    /**
     * GM sends an ad-hoc roll request for an "Other" character with a custom DC.
     */
    static #onRequestOtherRoll(event, target) {
        if (!game.user.isGM) return;
        const actorId = target.dataset.actorId;
        const day = parseInt(target.dataset.day) || this._travel.activeDay;
        if (!actorId) return;

        const row = target.closest(".travel-other-inline");
        const dcInput = row?.querySelector(".travel-other-dc-input");
        const dc = parseInt(dcInput?.value) || 12;

        this._travel.setOtherCustomDC(actorId, dc, "sur", day);
        this._travel.markRequested(actorId, day);

        const payload = this._travel.getRollRequestPayload(actorId, day);
        if (!payload) return;

        emitTravelRollRequest({
                    activities: [payload],
                    day
                });

        emitPhaseChanged("travel", {
                travelRollRequest: { activities: [payload], day }
            });

        ui.notifications.info(`Custom roll request (DC ${dc}) sent for ${game.actors.get(actorId)?.name ?? "character"}.`);
        this._saveRestState();
        this.render();
    }

    /**
     * GM marks a character's "Other" choice as confirmed (absent player, voice at table).
     */
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

    /**
     * Player rolls their own travel check.
     */
    static async #onRollTravelCheck(event, target) {
        event.preventDefault?.();
        const actorId = target.dataset.characterId ?? target.dataset.actorId;
        const day = parseInt(target.dataset.day) || 1;
        if (!actorId) return;

        const actor = game.actors.get(actorId);
        if (!actor || !actor.isOwner) return;

        const pending = this._pendingTravelRoll;
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
        this.render();
    }

    /**
     * Player self-initiates a travel roll without waiting for a GM request.
     * Declaration is confirmed and roll result sent in one action.
     */
    static async #onSelfRollTravelCheck(event, target) {
        event.preventDefault?.();
        const actorId = target.dataset.actorId;
        const day = parseInt(target.dataset.day) || (this._travelActiveDay ?? 1);
        const activity = target.dataset.activity;
        const dc = parseInt(target.dataset.dc) || 0;
        if (!actorId || !activity) return;

        const actor = game.actors.get(actorId);
        if (!actor || !actor.isOwner) return;

        if (this._playerTravelRolled?.[day]?.[actorId]) return;
        if (this._syncedTravelRolled?.[day]?.[actorId]) return;
        if (this._syncedTravelResolved?.[day]?.[actorId]) return;

        if (activity === "forage") {
            const terrainTag = this._selectedTerrain ?? this._engine?.terrainTag ?? "forest";
            const gate = this._travel?.getForageGate?.(terrainTag);
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

        if (!this._playerTravelConfirmed) this._playerTravelConfirmed = {};
        if (!this._playerTravelConfirmed[day]) this._playerTravelConfirmed[day] = {};
        this._playerTravelConfirmed[day][actorId] = true;

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

        if (!this._playerTravelRolled) this._playerTravelRolled = {};
        if (!this._playerTravelRolled[day]) this._playerTravelRolled[day] = {};
        this._playerTravelRolled[day][actorId] = true;

        emitTravelRollResult({
                    actorId,
                    actorName: actor.name,
                    total: roll.total,
                    natD20: getNatD20FromRoll(roll),
                    day
                });

        ui.notifications.info(`${actor.name} rolled ${roll.total}.`);
        this.render();
    }

    /**
     * GM rolls a travel check on behalf of an absent player.
     */
    static async #onRollTravelForPlayer(event, target) {
        if (!game.user.isGM) return;
        const actorId = target.dataset.actorId;
        const day = parseInt(target.dataset.day) || this._travel.activeDay;
        if (!actorId) return;

        const entry = this._travel._getEntry(day, actorId);
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

        this.receiveTravelRollResult({
            actorId,
            actorName: actor.name,
            total: result.total,
            natD20: result.natD20,
            day
        });
    }

    /**
     * GM receives a travel roll result (from player socket or roll-for-player).
     */
    receiveTravelRollResult(data) {
        const day = data.day ?? this._travel.activeDay;
        const accepted = this._travel.receiveRollResult(
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

        const terrainTag = this._engine?.terrainTag ?? this._selectedTerrain ?? "forest";
        void (async () => {
            try {
                const row = await this._travel.resolveIndividualResult(data.actorId, day, terrainTag);
                if (row) {
                    const actor = game.actors.get(data.actorId);
                    if (actor) {
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
                }
            } catch (e) {

                console.error("[Respite] resolveIndividualResult", e);
            } finally {
                await this._saveRestState();
                this.render();
            }
        })();
    }

    /**
     * GM switches the active travel day tab.
     */
    static #onSwitchTravelDay(event, target) {
        if (!game.user.isGM) return;
        const day = parseInt(target.dataset.day);
        if (!day) return;
        this._travel.setActiveDay(day);
        this._saveRestState();
        this.render();
    }

    /**
     * GM resolves a single day's collected rolls.
     */
    static async #onResolveTravelDay(event, target) {
        if (!game.user.isGM) return;
        const day = parseInt(target.dataset.day) || this._travel.activeDay;
        const partyActors = getPartyActors();
        const terrainTag = this._engine?.terrainTag ?? this._selectedTerrain ?? "forest";

        await this._travel.resolveDay(day, partyActors, terrainTag);

        if (this._travel.isFullyResolved()) {
            this._applyScoutingFromTravel();
        }

        // Build per-player private debrief data (excludes entries already sent via travelIndividualDebrief)
        const perPlayerResults = {};
        const allTravelPlayerUserIds = new Set();
        for (const actor of partyActors) {
            const ownerIds = Object.entries(actor.ownership ?? {})
                .filter(([id, level]) => level >= 3 && id !== "default")
                .map(([id]) => id);
            for (const uid of ownerIds) {
                allTravelPlayerUserIds.add(uid);
            }
            const debrief = this._travel.getPlayerDebrief(actor.id);
            for (const uid of ownerIds) {
                if (!perPlayerResults[uid]) perPlayerResults[uid] = [];
                perPlayerResults[uid].push(...debrief);
            }
        }

        const scoutingDebrief = this._travel.getScoutingDebrief(terrainTag);
        this._scoutingDebrief = scoutingDebrief;

        // Send debrief to each player with a character in the party (include empty `results` so flags still apply)
        for (const userId of allTravelPlayerUserIds) {
            emitTravelDebrief({
                    targetUserId: userId,
                    results: perPlayerResults[userId] ?? [],
                    scoutingDone: !!scoutingDebrief,
                    fullyResolved: this._travel.isFullyResolved()
                });
        }

        // Auto-advance to camp phase as soon as all days are resolved â€” no second click needed.
        if (this._travel.isFullyResolved()) {
            this._phase = "camp";
            this._campStep2Entered = false;
            // Theater of the Mind: skip camp, jump to activity
            if (await this._skipCampForTheater()) return;
            // Tavern: skip camp phase entirely
            if (await this._skipCampForSafeRest()) return;
            // Comfort off: waive the Make Camp fire phase
            if (await this._skipCampForComfortOff()) return;
            emitPhaseChanged(this._phase, {});
            await this._saveRestState();
            this.render();
            return;
        }

        emitPhaseChanged("travel", {
                activeDay: this._travel.activeDay,
                fullyResolved: this._travel.isFullyResolved(),
                scoutingDone: !!scoutingDebrief
            });

        await this._saveRestState();
        this.render();
    }

    /**
     * GM resolves all remaining days and advances to activities.
     */
    static async #onResolveTravelPhase(event, target) {
        const partyActors = getPartyActors();
        const terrainTag = this._engine?.terrainTag ?? this._selectedTerrain ?? "forest";

        await this._travel.resolveAll(partyActors, terrainTag);
        this._applyScoutingFromTravel();

        this._phase = "camp";
        this._campStep2Entered = false;

        // Theater of the Mind: skip camp, jump to activity
        if (await this._skipCampForTheater()) return;
        // Tavern: skip camp phase entirely
        if (await this._skipCampForSafeRest()) return;
        // Comfort off: waive the Make Camp fire phase
        if (await this._skipCampForComfortOff()) return;

        emitPhaseChanged(this._phase, { travelResults: this._travel.serialize() });

        await this._saveRestState();
        this.render();
    }

    /**
     * GM skips the travel phase (or continues after full resolution).
     * Warns if any travel days have unresolved declarations.
     */
    static async #onSkipTravelPhase(event, target) {
        if (this._travel && !this._travel.isFullyResolved() && this._travel.hasDeclarations()) {
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

        if (this._travel?.scoutingResult) {
            this._applyScoutingFromTravel();
        }

        this._phase = "camp";
        this._campStep2Entered = false;

        // Theater of the Mind: skip camp, jump to activity
        if (await this._skipCampForTheater()) return;
        // Tavern: skip camp phase entirely
        if (await this._skipCampForSafeRest()) return;
        // Comfort off: waive the Make Camp fire phase
        if (await this._skipCampForComfortOff()) return;

        emitPhaseChanged(this._phase, {});

        this._saveRestState();
        this.render();
    }

    /**
     * Player receives a travel roll request via socket.
     */
    receiveTravelRollRequest(data) {
        this._pendingTravelRoll = {
            activities: data.activities ?? [],
            rolledCharacters: new Set()
        };
        this.render();
    }

    /**
     * Broadcast all current travel declarations to players for live sync.
     */
    _broadcastTravelDeclarations() {
        const allDayDeclarations = {};
        const rolledByDay = {};
        const resolvedByDay = {};
        const travelEntries = this._travel.serialize()?.entries ?? {};

        for (const [key, entry] of Object.entries(travelEntries)) {
            const colon = key.indexOf(":");
            if (colon < 0) continue;
            const day = parseInt(key.slice(0, colon), 10);
            const actorId = key.slice(colon + 1);
            if (!day || !actorId) continue;
            if (entry.status === "rolled" || entry.status === "resolved") {
                rolledByDay[day] ??= {};
                rolledByDay[day][actorId] = true;
            }
            if (entry.status === "resolved") {
                resolvedByDay[day] ??= {};
                resolvedByDay[day][actorId] = true;
            }
        }

        for (let d = 1; d <= this._travel.totalDays; d++) {
            const decl = this._travel.getDayDeclarations(d);
            const confirmed = {};
            for (const actorId of Object.keys(decl)) {
                if (this._travel.isConfirmed(actorId, d)) confirmed[actorId] = true;
            }
            decl._confirmed = confirmed;
            allDayDeclarations[d] = decl;
        }
        emitTravelDeclarationsSync({
                    declarations: allDayDeclarations,
                    rolled: rolledByDay,
                    resolved: resolvedByDay,
                    activeDay: this._travel.activeDay,
                    totalDays: this._travel.totalDays,
                    scoutingAllowed: this._travel.scoutingAllowed,
                    forageDC: this._travel.forageDC,
                    huntDC: this._travel.huntDC
                });
    }

    /**
     * GM receives a travel declaration from a player.
     * Validates ownership, updates delegate, broadcasts to all players.
     */
    receiveTravelDeclaration(data) {
        if (!data.declarations) return;
        const day = data.day ?? this._travel.activeDay;
        for (const [actorId, activity] of Object.entries(data.declarations)) {
            const actor = game.actors.get(actorId);
            if (!actor) continue;
            const owners = Object.entries(actor.ownership ?? {})
                .filter(([id, level]) => level >= 3 && id !== "default")
                .map(([id]) => id);
            if (!owners.includes(data.userId)) continue;
            this._travel.setDeclaration(actorId, activity, day);
            if (data.confirmed === true) {
                this._travel.setConfirmed(actorId, day, true);
            } else if (data.confirmed === false) {
                this._travel.setConfirmed(actorId, day, false);
            }
        }

        this._broadcastTravelDeclarations();
        this._saveRestState();
        this.render();
    }

    /**
     * Apply scouting result from the travel delegate to RestFlowEngine.
     * Called after travel resolution completes (all days resolved).
     */
    _applyScoutingFromTravel() {
        if (!this._engine) return;
        if (!isScoutingEnabled() || this._travel?.isEffectiveSafeRestSpot?.()) {
            this._engine.scoutingResult = "none";
            this._engine.scoutingComplication = false;
            if (!this._engine._encounterBreakdown) this._engine._encounterBreakdown = {};
            this._engine._encounterBreakdown.scouting = 0;
            this._engine._encounterBreakdown.scoutingResult = "none";
            const bd = this._engine._encounterBreakdown;
            this._engine.shelterEncounterMod = (bd.shelter ?? 0) + (bd.weather ?? 0);
            return;
        }
        const effects = this._travel.scoutingEffects;
        const tier = this._travel.scoutingResult ?? "none";

        this._engine.scoutingResult = tier;
        this._engine.scoutingComplication = effects.complication;

        // Add scouting encounter mod to the breakdown
        if (!this._engine._encounterBreakdown) this._engine._encounterBreakdown = {};
        this._engine._encounterBreakdown.scouting = effects.encounterDC;
        this._engine._encounterBreakdown.scoutingResult = tier;

        // Recalculate total shelter encounter mod
        const bd = this._engine._encounterBreakdown;
        this._engine.shelterEncounterMod = (bd.shelter ?? 0) + (bd.weather ?? 0) + effects.encounterDC;

        // Apply comfort bonus
        if (effects.comfortBonus > 0) {
            let rank = COMFORT_RANK[this._engine.comfort] ?? 0;
            rank = Math.min(COMFORT_RANK.safe, rank + effects.comfortBonus);
            this._engine.comfort = RANK_TO_KEY[rank];
        }
    }

    // =========================== Make Camp Phase Handlers ===========================

    /**
     * Player or GM lights the campfire during Make Camp.
     * Only the GM may change Item documents; players request via socket.
     */
    static async #onLightCampfire(event, target) {
        await RestSetupApp.#onSelectCampFireLevel.call(this, event, { dataset: { fireLevel: "campfire" } });
    }

    /** Player or GM clicks "Light Fire with [item]" in the new contribution UI. */
    static async #onCampLightFire(event, target) {
        const root = target?.closest?.("[data-action=\"campLightFire\"]") ?? target;
        let actorId = root?.dataset?.actorId;
        const method = root?.dataset?.method ?? "Tinderbox";
        // GM override: no party member had a tinderbox/cantrip, use first party actor
        if (actorId === "__gm__" && game.user.isGM) {
            const partyActors = getPartyActors();
            actorId = partyActors[0]?.id ?? null;
        }
        if (!actorId) return;
        // The selected tier (or default embers) is committed at light time so the picker
        // is the ceremony: no need to re-engage to set the level afterward.
        const chosenLevel = ["embers", "campfire", "bonfire"].includes(this._campFirePreviewLevel)
            ? this._campFirePreviewLevel
            : "embers";
        if (!game.user.isGM) {
            emitCampLightFire(game.user.id, actorId, method, chosenLevel);
            return;
        }
        await this._campCeremony.lightFire(game.user.id, actorId, method, chosenLevel);
    }

    /** Player or GM pledges 1 firewood to raise the fire tier. */
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

    /** Player or GM takes back their pledged firewood. */
    static async #onCampReclaimFirewood(event, target) {
        if (!game.user.isGM) {
            emitCampFirewoodReclaim(game.user.id);
            return;
        }
        await this._campCeremony.removeFirewoodPledge(game.user.id);
    }

    static async #onSelectCampFireLevel(event, target) {
        const root = target?.closest?.("[data-action=\"selectCampFireLevel\"]") ?? target;
        const level = root?.dataset?.fireLevel;
        if (!level || !["embers", "campfire", "bonfire"].includes(level)) return;

        // Activity-phase fire changes use a separate socket + handler
        // so the GM runs changeFireLevelDuringActivity (which confirms cost deltas).
        if (this._phase === "activity" && this._isTotM) {
            if (!game.user.isGM) {
                // Player-side pre-validation with modal dialogs
                const cur = this._fireLevel ?? "unlit";
                if (level === cur) return;

                const F = CampGearScanner.FIREWOOD_COST_BY_LEVEL;
                const costOf = (l) => (l === "unlit" ? 0 : (F[l] ?? 0));
                const curCost = costOf(cur);
                const newCost = costOf(level);
                const levelLabel = level.charAt(0).toUpperCase() + level.slice(1);

                if (newCost > curCost) {
                    // Promoting fire: check kindling locally (any party member can have tinderbox)
                    const allActors = getPartyActors();
                    const hasTinderbox = cur !== "unlit" || allActors.some(a => a.items.some(i => {
                        const n = i.name?.toLowerCase() ?? "";
                        return n.includes("tinderbox") || n.includes("flint and steel") || n.includes("flint & steel");
                    }));
                    if (cur === "unlit" && !hasTinderbox) {
                        await game.ionrift.library.confirm({
                            title: "Cannot Light Fire",
                            content: "<p>No one in the party has a tinderbox or flint and steel. You cannot start a fire.</p>",
                            yesLabel: "Close",
                            noLabel: null,
                            yesIcon: "fas fa-times",
                            defaultYes: true
                        });
                        return;
                    }
                    // Only count firewood from the player's own characters
                    const myActors = allActors.filter(a => a.isOwner);
                    const need = newCost - curCost;
                    const myFirewood = myActors.reduce((sum, a) => {
                        const it = a.items.find(i => {
                            const n = i.name?.toLowerCase() ?? "";
                            return n.includes("firewood") || n === "kindling";
                        });
                        return sum + (it?.system?.quantity ?? 0);
                    }, 0);
                    if (need > 0 && myFirewood < need) {
                        await game.ionrift.library.confirm({
                            title: "Not Enough Firewood",
                            content: `<p>Raising the fire to <strong>${levelLabel}</strong> requires ${need} firewood, but your characters only have ${myFirewood}.</p>`,
                            yesLabel: "Close",
                            noLabel: null,
                            yesIcon: "fas fa-times",
                            defaultYes: true
                        });
                        return;
                    }
                    // Confirm firewood consumption from the player's own stock
                    const confirmed = await game.ionrift.library.confirm({
                        title: `Raise Fire to ${levelLabel}`,
                        content: `<p>This will consume <strong>${need} firewood</strong> from your inventory. Continue?</p>`,
                        yesLabel: "Light It",
                        noLabel: "Cancel",
                        yesIcon: "fas fa-fire",
                        noIcon: "fas fa-times",
                        defaultYes: true
                    });
                    if (!confirmed) return;
                } else if (newCost < curCost) {
                    // Reducing fire: player can do this directly, just confirm no refund
                    const confirmed = await game.ionrift.library.confirm({
                        title: `Lower Fire to ${levelLabel}`,
                        content: "<p>Reducing the fire discards spent firewood. There is no refund. Continue?</p>",
                        yesLabel: "Lower Fire",
                        noLabel: "Cancel",
                        yesIcon: "fas fa-arrow-down",
                        noIcon: "fas fa-times",
                        defaultYes: false
                    });
                    if (!confirmed) return;
                }
                emitActivityFireLevelRequest(level, game.user.id);
            } else {
                await this.changeFireLevelDuringActivity(level);
            }
            return;
        }

        // Camp phase: broadcast preview to all players via GM relay.
        // The segment strip updates are a party decision, so all clients must see them.
        if (!game.user.isGM) {
            emitCampFireLevelRequest(level, game.user.id);
            return;
        }
        // GM: set local preview and broadcast to all clients. Picking a fire tier
        // also clears any committed cold camp so the table can switch back.
        this._maybeClearStagedWoodOnTierChange(level);
        this._campFirePreviewLevel = level;
        this._coldCampPreview = false;
        this._coldCampDecided = false;
        emitPhaseChanged(this._phase, {
            campFirePreviewLevel: level,
            coldCampPreview: false,
            coldCampDecided: false,
            makeCampStagedWood: [...(this._makeCampStagedWood ?? [])],
            selectedTerrain: this._selectedTerrain ?? null
        });
        this._syncCampCeremonyPreviewToEmbed();
        this.render();
    }

    /**
     * GM-only: deduct `cost` units of party firewood (one per loop). Prefer actors owned by `requestingUserId` when set.
     * @param {number} cost
     * @param {string|null} requestingUserId
     * @returns {Promise<{ ok: boolean, spendNames: string[], error?: string }>}
     */
    async _spendPartyFirewoodForMakeCamp(cost, requestingUserId = null) {
        const spendNames = [];
        if (cost <= 0) return { ok: true, spendNames };

        const actors = getPartyActors();
        const OWNER = CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
        const sortedActors = requestingUserId
            ? [...actors].sort((a, b) => {
                const aOwn = (a.ownership?.[requestingUserId] ?? 0) >= OWNER ? 1 : 0;
                const bOwn = (b.ownership?.[requestingUserId] ?? 0) >= OWNER ? 1 : 0;
                return bOwn - aOwn;
            })
            : actors;

        let remaining = cost;
        while (remaining > 0) {
            let spentOne = false;
            for (const actor of sortedActors) {
                const firewoodItem = actor.items.find(i => {
                    const n = i.name?.toLowerCase() ?? "";
                    return n.includes("firewood") || n === "kindling";
                });
                if (!firewoodItem || (firewoodItem.system?.quantity ?? 0) <= 0) continue;
                const qty = firewoodItem.system?.quantity ?? 1;
                if (qty <= 1) await firewoodItem.delete();
                else await firewoodItem.update({ "system.quantity": qty - 1 });
                spendNames.push(actor.name);
                remaining--;
                spentOne = true;
                break;
            }
            if (!spentOne) {
                return { ok: false, spendNames, error: "Could not spend firewood (inventory changed)." };
            }
        }
        return { ok: true, spendNames };
    }

    /**
     * GM-only: set fire level and encounter modifier, sync token light and clients. Firewood is spent when leaving
     * Make Camp via Proceed to activities, not here, so the GM can change tier until then.
     * @param {string} level - embers | campfire | bonfire
     * @param {string|null} requestingUserId - reserved for spend order when spend runs at proceed (player request path)
     */
    /** @deprecated Use this._campCeremony.deriveCampFireLevel() */
    _deriveCampFireLevel() {
        return this._campCeremony.deriveCampFireLevel();
    }

    /** @deprecated Use this._campCeremony._syncFireLevelFromPledges() */
    async _syncFireLevelFromPledges() {
        return this._campCeremony._syncFireLevelFromPledges();
    }

    /**
     * Theater of the Mind: skip the camp phase entirely.
     * Camp is a canvas-placement ceremony (pit cursor, furniture tokens,
     * station overlays) that has no meaning without a map.  Jump straight
     * to the activity phase so the GM and players pick activities inline.
     *
     * Fire defaults to unlit.  The TotM fire-lighting UI is handled in
     * the inline Activities tab (Batch 3).
     *
     * @returns {boolean} True if skipped (caller should return early).
     */
    async _skipCampForTheater() {
        // Theater mode now shows an inline Make Camp phase instead of skipping.
        // Return false so the camp phase renders normally in the RestSetupApp window.
        return false;
    }

    /**
     * Safe rest spots (taverns, safe camps) and tavern terrain skip camp and
     * activity phases entirely. The environment is secure: no campfire ceremony,
     * no station tokens, no activity selection needed.
     *
     * All characters are auto-assigned "Rest Fully" and meals are waived.
     * Advances straight to reflection for long rests, or resolve for short rests.
     *
     * @returns {boolean} True if the phase was skipped (caller should not proceed to camp render).
     */
    async _skipCampForSafeRest() {
        const terrain = this._selectedTerrain ?? this._engine?.terrainTag ?? "forest";
        const isSafeRest = !!(this._engine?.safeRestSpot);
        if (terrain !== "tavern" && !isSafeRest) return false;
        if (!game.user.isGM) return false;

        // Fire is implicitly "campfire" (the establishment's hearth).
        this._fireLevel = "campfire";
        this._coldCampDecided = false;
        this._campToActivityDone = true;
        this._campStep2Entered = true;

        _logGmRestSheet("_skipCampForSafeRest", "tavern terrain â€” skipping camp + activity, auto-assigning rest");

        // Auto-assign act_rest_fully to every party member and register with engine.
        const partyActors = getPartyActors();
        for (const actor of partyActors) {
            this._characterChoices.set(actor.id, "act_rest_fully");
            this._engine?.registerChoice(actor.id, "act_rest_fully", {});
        }

        // Waive meals â€” mark everyone as submitted so the gate is clear.
        if (!this._activityMealRationsSubmitted) this._activityMealRationsSubmitted = new Set();
        for (const actor of partyActors) {
            this._activityMealRationsSubmitted.add(actor.id);
        }

        // Short rest: skip reflection and events entirely (same as #onSubmitActivities).
        if (this._engine?.restType === "short") {
            this._triggeredEvents = [];
            this._eventsRolled = true;
            SoundDelegate.stopAll();
            this._phase = "resolve";
        } else {
            // Auto-process rations only for tavern terrain (the inn may still
            // charge food/water).  Non-tavern safe rest spots waive meals
            // entirely; no dehydration or starvation saves.
            if (terrain === "tavern") {
                const trackFood = game.settings.get(MODULE_ID, "trackFood");
                const terrainMealRules = TerrainRegistry.getDefaults(terrain)?.mealRules ?? {};
                if (trackFood && (terrainMealRules.waterPerDay > 0 || terrainMealRules.foodPerDay > 0)) {
                    this._mealChoices = this._mealChoices ?? new Map();
                    this._daysSinceLastRest = this._daysSinceLastRest ?? 1;
                    await this._autoProcessRations();
                }
            }
            await this._applyBeddingDown();
            // Reflection phase skipped (v2.1); advance straight to events.
            await this._advanceToEvents();
            return true;
        }

        // Broadcast phase change to players.
        emitPhaseChanged(this._phase, {
            campStatus: this._campStatus,
            fireLevel: this._fireLevel,
            daysSinceLastRest: this._daysSinceLastRest ?? 1,
            selectedTerrain: terrain
        });

        await this._saveRestState();
        this.render();
        return true;
    }

    /**
     * Comfort system disabled: the Make Camp fire ceremony only exists to derive
     * comfort (tiers, exhaustion saves, fire encounter modifier). With comfort
     * off there is nothing for it to do, so the phase is waived and the flow
     * advances straight to Activities. The fire is recorded as unlit (no beacon,
     * no penalty) since its value is inert when comfort is off.
     *
     * @returns {Promise<boolean>} True if the phase was waived (caller stops).
     */
    async _skipCampForComfortOff() {
        if (isComfortEnabled()) return false;
        if (!game.user.isGM) return false;
        if (this._engine?.safeRestSpot) return false;
        // Simple + camp stations still needs the map camp (fire, workbench, bedrolls).
        if (!this._isTotM) return false;

        this._fireLevel = "unlit";
        this._coldCampDecided = true;
        this._campToActivityDone = true;
        this._campStep2Entered = true;

        _logGmRestSheet("_skipCampForComfortOff", "comfort off, waiving Make Camp fire phase");

        this._phase = "activity";
        this._applyLoseActivityTravelLocks();

        const isTheater = this._isTotM;
        if (!isTheater) {
            await this.close({});
        }

        emitPhaseChanged(this._phase, {
            campStatus: this._campStatus,
            fireLevel: this._fireLevel
        });
        await this._saveRestState();
        if (!isTheater) {
            this._activateCanvasStationLayer();
        } else {
            this.render({ force: true });
        }
        return true;
    }

    /**
     * Simple + camp stations: light the fire at campfire tier without firewood
     * and advance to the activity phase (stations promote on advance).
     * @returns {Promise<void>}
     */
    async _autoLightCampfireForSimpleStations() {
        if (!game.user.isGM) return;
        if (!isSimpleStationsMode()) return;
        if (this._phase !== "camp" || this._campToActivityDone) return;
        if ((this._fireLevel ?? "unlit") !== "unlit" || this._coldCampDecided) return;

        const actorId = getPartyActors()[0]?.id;
        if (!actorId) return;

        await this._campCeremony.lightFire(game.user.id, actorId, "Campfire", "campfire");
    }

    /**
     * After the fire is committed (lit tiers or cold camp), spend fuel, go to activity.
     * @returns {Promise<void>}
     */
    async _advanceCampToActivity() {
        if (!game.user.isGM) return;
        if (this._phase !== "camp" || this._campToActivityDone) return;

        CampfireMakeCampDialog.closeIfOpen();
        this._campToActivityDone = true;
        this._campStep2Entered = true;

        await promoteAllPlaceholders(!!this._engine?.safeRestSpot, {
            simpleStations: isSimpleStationsMode()
        });

        if (!this._engine?.safeRestSpot) {
            const pledges = Array.from(this._firewoodPledges.entries());
            for (const [, pledge] of pledges) {
                if (pledge.gmPledge) continue;
                const actor = game.actors.get(pledge.actorId);
                if (!actor) continue;
                const firewoodItem = actor.items.find(i => {
                    const n = i.name?.toLowerCase() ?? "";
                    return n.includes("firewood") || n === "kindling";
                });
                if (firewoodItem && (firewoodItem.system?.quantity ?? 0) >= pledge.count) {
                    await firewoodItem.update({ "system.quantity": (firewoodItem.system.quantity - pledge.count) });
                } else {
                    const fallback = await this._spendPartyFirewoodForMakeCamp(pledge.count, null);
                    if (!fallback.ok) {
                        ui.notifications.warn(`Could not spend firewood for ${pledge.actorName}. Proceeding anyway.`);
                    }
                }
            }
            if (pledges.length > 0) {
                const level = this._fireLevel ?? "unlit";
                const label = level.charAt(0).toUpperCase() + level.slice(1);
                const names = pledges.map(([, p]) => p.actorName).join(" and ");
                ui.notifications.info(`${names} ${pledges.length === 1 ? "spends" : "spend"} firewood for ${label}.`);
            }
        }
        this._campFireWoodSpendUserId = null;

        this._phase = "activity";
        this._applyLoseActivityTravelLocks();
        this._applyAutoOtherWhenSoleActivity();
        _logGmRestSheet("_advanceCampToActivity", "phase -> activity, closing window");

        const isTheater = this._isTotM;
        if (!isTheater) {
            await this.close({});
        }

        emitPhaseChanged(this._phase, {
                campStatus: this._campStatus,
                fireLevel: this._fireLevel
            });
        await this._saveRestState();
        if (!isTheater) {
            this._activateCanvasStationLayer();
        } else {
            this.render({ force: true });
        }
        _logGmRestSheet("_advanceCampToActivity", "advance complete", { rendered: this.rendered });
    }

    /**
     * Picks a canvas point (GM). Left click confirms; right-click or Escape cancels.
     * Shows a semi-transparent pit sprite and build-site stub ghosts; all snap to the grid.
     * @param {{ pitBaseTextureSrc?: string, safeRestSpot?: boolean }} [options] - Art for the ghost; same source should be passed to {@link placeCampfire}.
     * @returns {Promise<{x: number, y: number}|null>}
     */
    _pickPitWorldPoint(options = {}) {
        return new Promise((resolve) => {
            if (!canvas?.ready) {
                resolve(null);
                return;
            }
            const pitBaseTextureSrc = options.pitBaseTextureSrc ?? "";
            const safeRestSpot = !!options.safeRestSpot;
            const canvasEl = document.getElementById("board");
            const originalCursor = canvasEl?.style.cursor;
            if (canvasEl) canvasEl.style.cursor = "crosshair";
            ui.notifications.info("Click the map to place the campfire pit. Right-click or Escape to cancel.");

            const gs = canvas.grid?.size ?? canvas.dimensions?.size ?? 100;
            const snapMode = CONST.GRID_SNAPPING_MODES?.CENTER ?? 1;
            const parent = canvas.tokens?.addChild ? canvas.tokens : (canvas.primary ?? canvas.stage);
            const sortPrev = parent.sortableChildren;
            if (parent.sortableChildren !== undefined) parent.sortableChildren = true;

            const container = new PIXI.Container();
            container.name = "ionrift-camp-pit-preview";
            if ("eventMode" in container) container.eventMode = "none";
            container.zIndex = 2_000_000;
            parent.addChild(container);

            const phRoot = new PIXI.Container();
            if ("eventMode" in phRoot) phRoot.eventMode = "none";
            phRoot.name = "ionrift-camp-stub-previews";
            container.addChild(phRoot);
            const phSprites = [];
            const simpleStations = isSimpleStationsMode();
            const maxStub = simpleStations ? 2 : (safeRestSpot ? 3 : 4);

            const updateStubGhosts = (pitCX, pitCY) => {
                if (!container.parent) return;
                const slots = getStationPlaceholderPreviewsForPitCenter(pitCX, pitCY, safeRestSpot, {
                    simpleStations
                });
                for (let i = 0; i < maxStub; i++) {
                    if (i >= slots.length) {
                        if (phSprites[i]) phSprites[i].visible = false;
                        continue;
                    }
                    const slot = slots[i];
                    if (!phSprites[i]) {
                        const s = PIXI.Sprite.from(slot.textureSrc);
                        s.anchor.set(0.5, 0.5);
                        if ("eventMode" in s) s.eventMode = "none";
                        phRoot.addChild(s);
                        phSprites[i] = s;
                    }
                    const s = phSprites[i];
                    s.visible = true;
                    s.alpha = slot.valid ? 0.4 : 0.2;
                    const wPx = slot.gridW * gs;
                    const hPx = slot.gridH * gs;
                    s.x = slot.tx + wPx / 2;
                    s.y = slot.ty + hPx / 2;
                    const tw = s.texture?.width || 1;
                    const th = s.texture?.height || 1;
                    const sc = Math.min(wPx / tw, hPx / th) * 0.9;
                    s.scale.set(sc);
                }
            };

            let spr = null;
            if (pitBaseTextureSrc) {
                spr = PIXI.Sprite.from(pitBaseTextureSrc);
                spr.anchor.set(0.5, 0.5);
                spr.alpha = 0.5;
                spr.visible = false;
                if ("eventMode" in spr) spr.eventMode = "none";
                container.addChild(spr);
                const applyScale = () => {
                    if (!spr?.texture?.valid) return;
                    const tw = spr.texture.width || 1;
                    const th = spr.texture.height || 1;
                    const sc = gs / Math.max(tw, th);
                    spr.scale.set(sc);
                };
                if (spr.texture?.valid) applyScale();
                else spr.texture?.on?.("update", applyScale);
            }

            const updateGhost = (wx, wy) => {
                if (!container.parent) return;
                const snapped = canvas.grid?.getSnappedPoint?.({ x: wx, y: wy }, { mode: snapMode });
                const cx = snapped?.x ?? wx;
                const cy = snapped?.y ?? wy;
                updateStubGhosts(cx, cy);
                if (spr) {
                    spr.x = cx;
                    spr.y = cy;
                    spr.visible = true;
                }
            };

            const onPointerMove = (event) => {
                const pos = event.data?.getLocalPosition?.(canvas.stage);
                if (pos) updateGhost(pos.x, pos.y);
            };

            const cleanup = (result) => {
                canvas.stage?.off("pointermove", onPointerMove);
                canvas.stage?.off("pointerdown", onPointerDown);
                document.removeEventListener("keydown", onKeyDown);
                document.removeEventListener("contextmenu", onRightClick);
                if (canvasEl) canvasEl.style.cursor = originalCursor ?? "";
                if (parent?.sortableChildren !== undefined) parent.sortableChildren = sortPrev;
                if (container.parent) {
                    parent.removeChild(container);
                    container.destroy({ children: true });
                }
                resolve(result);
            };

            const onPointerDown = (event) => {
                if (event.data?.button !== 0 && event.button !== 0) return;
                const pos = event.data?.getLocalPosition?.(canvas.stage)
                    ?? canvas.stage.toLocal(event.global ?? event);
                const snapped = canvas.grid?.getSnappedPoint?.({ x: pos.x, y: pos.y }, { mode: snapMode });
                const x = snapped?.x ?? pos.x;
                const y = snapped?.y ?? pos.y;
                cleanup({ x, y });
            };
            const onRightClick = (event) => {
                event.preventDefault();
                cleanup(null);
            };
            const onKeyDown = (event) => {
                if (event.key === "Escape") cleanup(null);
            };

            canvas.stage.on("pointermove", onPointerMove);
            canvas.stage.on("pointerdown", onPointerDown);
            document.addEventListener("keydown", onKeyDown);
            document.addEventListener("contextmenu", onRightClick);
        });
    }

    /**
     * GM: crosshair to place the pit, then placeholders and the "Light the fire" notice.
     * @returns {Promise<void>}
     */
    async _startCampPitCursorFlow() {
        if (!game.user.isGM || this._phase !== "camp" || this._campPitCursorInFlight) return;
        if (hasCampfirePlaced()) return;
        this._campPitCursorInFlight = true;
        try {
            const pitBaseTextureSrc = pickCampfirePitBaseTexture();
            const pos = await this._pickPitWorldPoint({
                pitBaseTextureSrc,
                safeRestSpot: !!this._engine?.safeRestSpot
            });
            if (!pos) {
                this._campPitPlacementCancelled = true;
                this.render({ force: true });
                return;
            }
            const res = await placeCampfire(pos.x, pos.y, { pitBaseTextureSrc });
            if (!res) return;
            await placeStationPlaceholders(!!this._engine?.safeRestSpot, {
                simpleStations: isSimpleStationsMode()
            });
            if (isSimpleStationsMode()) {
                await this._autoLightCampfireForSimpleStations();
                return;
            }
            await CampfireTokenLinker.setLightState(false, "unlit");
            await this._saveRestState();
            emitPhaseChanged("camp", { campPitCursorDone: true });
            this.render({ force: true });
            await this._refreshCampPitNoticeLayer();
        } catch (e) {

            console.error(`${MODULE_ID} | _startCampPitCursorFlow`, e);
        } finally {
            this._campPitCursorInFlight = false;
        }
    }

    /**
     * All clients: notice over the pit during Make Camp (unlit: invite to light).
     * @returns {Promise<void>}
     */
    async _refreshCampPitNoticeLayer() {
        if (this._phase !== "camp" || !canvas?.ready) return;
        if (!hasCampfirePlaced()) return;
        if (this._campToActivityDone) return;
        const fireCommitted = !!this._fireLitBy
            || (this._fireLevel ?? "unlit") !== "unlit"
            || !!this._coldCampDecided;
        const unlit = !fireCommitted;
        const partyActors = getPartyActors();
        const actorMap = {};
        for (const actor of partyActors) {
            const items = actor.items?.map(i => i.name?.toLowerCase() ?? "") ?? [];
            const hasBedroll = items.some(n => n.includes("bedroll"));
            const sceneToken = canvas.tokens?.placeables.find(t => t.actor?.id === actor.id);
            actorMap[actor.id] = { hasBedroll, assignedTokenId: sceneToken?.id ?? null };
        }
        const app = this;
        activateStationLayer(
            actorMap,
            (stationId, token) => {
                if (stationId === "campfire" && token) {
                    void CampfireMakeCampDialog.open(app, token);
                }
            },
            { campPitModeOnly: true, campPitUnlit: unlit }
        );
    }

    static async #onDismissCampfireCanvasPanel() {
        this._showCampfireCanvasPanel = false;
        this.render({ force: true });
    }

    static async #onRetryCampPitPlacement() {
        this._campPitPlacementCancelled = false;
        await this._startCampPitCursorFlow();
    }

    /**
     * Opens the in-Foundry Respite guide for the clicking user. Players default
     * to the Player Quick Reference; GMs land on the GM Reference.
     */
    static async #onOpenGuide(event, _target) {
        event?.preventDefault?.();
        event?.stopPropagation?.();
        const pageId = game.user?.isGM ? "dvr4TYdYmX88MCCf" : "aQc3PtQPrYDi9Mlx";
        await game.ionrift?.respite?.openPlayerGuide?.(pageId);
    }

    static async #onDismissArtNudge(event, target) {
        const banner = this.element.querySelector(".art-nudge-banner");
        const suppress = banner?.querySelector(".art-nudge-suppress-checkbox")?.checked ?? false;

        if (suppress) {
            await game.settings.set(MODULE_ID, "artNudgeSuppressed", true);
        } else {
            const snoozeUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
            await game.settings.set(MODULE_ID, "artNudgeSnoozedUntil", snoozeUntil);
        }

        banner?.remove();
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

    static #onOpenArtPackPatreon(event, target) {
        window.open("https://www.patreon.com/posts/154985310", "_blank");
    }

    static async #onOpenArtPackImport(event, target) {
        const { PackRegistryApp } = await import("./PackRegistryApp.js");
        const app = new PackRegistryApp();
        app.render(true);
        setTimeout(() => {
            app.element?.querySelector('.pack-tab[data-tab="art"]')?.click();
        }, 200);
    }

    /**
     * TotM activity card click.
     * ALL activities (including crafting) open the inline detail panel.
     * Clicking the same card again while expanded collapses the panel.
     */
    static async #onSelectTotmActivity(event, target) {
        const activityId = target.closest("[data-activity-id]")?.dataset?.activityId;
        if (!activityId) return;
        const characterId = this._selectedCharacterId;
        if (!characterId) {
            ui.notifications.warn("Select a character from the roster first.");
            return;
        }
        if (this._lockedCharacters?.has(characterId)) {
            ui.notifications.warn("This character has already submitted their activity.");
            return;
        }
        const actor = game.actors.get(characterId);
        if (!actor) return;

        const activity = this._activityResolver?.activities?.get(activityId);
        const isCrafting = !!activity?.crafting?.enabled;

        if (isCrafting) {
            // Crafting: expand inline crafting panel (TotM only; station mode still uses CraftingPickerApp).
            const craftingProfession = activity.crafting.profession ?? "cooking";
            if (this._totmFollowUpExpanded?.isCrafting
                    && this._totmFollowUpExpanded?.profession === craftingProfession
                    && this._totmFollowUpExpanded?.characterId === characterId) {
                // Toggle off
                this._totmFollowUpExpanded = null;
                this._resetTotmCraftState();
            } else {
                // Reset crafting state, then restore a prior craft so a refresh
                // mid-rest shows the finished result instead of a fresh roll.
                this._resetTotmCraftState();
                this._hydrateTotmCraftStateFromRest(characterId, craftingProfession);
                this._totmFollowUpExpanded = { activityId, characterId, isCrafting: true, profession: craftingProfession };
            }
            this.render();
            return;
        }

        // All other activities: expand the inline detail panel.
        // Clicking the same card again while expanded collapses it (toggle).
        if (this._totmFollowUpExpanded?.activityId === activityId
                && this._totmFollowUpExpanded?.characterId === characterId) {
            this._totmFollowUpExpanded = null;
        } else {
            this._totmFollowUpExpanded = { activityId, characterId };
        }
        this.render();
    }

    /**
     * TotM inline follow-up panel: confirm button.
     * Reads the follow-up input value from the DOM, then finalizes the activity.
     */
    static async #onConfirmTotmFollowUp(event, target) {
        const expanded = this._totmFollowUpExpanded;
        if (!expanded) return;
        const { activityId, characterId } = expanded;

        if (this._lockedCharacters?.has(characterId)) {
            ui.notifications.warn("This character has already submitted their activity.");
            this._totmFollowUpExpanded = null;
            this.render();
            return;
        }

        // Read follow-up value from the inline detail view.
        // The container class is .totm-detail-followup (not .totm-followup-panel).
        const detailView = this.element?.querySelector(".totm-detail-view");
        let followUpValue = null;
        if (detailView) {
            const select = detailView.querySelector(".totm-followup-select");
            const radio = detailView.querySelector(".totm-followup-radio:checked");
            if (select) followUpValue = select.value || null;
            else if (radio) followUpValue = radio.value || null;
        }

        // Armor penalty gate (parity with StationActivityDialog.#onConfirm). Skipped for safe rest spot.
        const actor = game.actors.get(characterId);
        const resolver = this._activityResolver;
        const activity = resolver?.activities?.get(activityId);
        if (!this._effectiveSafeRestSpot() && actor && activity && !activity.armorSleepWaiver) {
            try {
                const armorRuleEnabled = game.settings.get("ionrift-respite", "armorDoffRule");
                if (armorRuleEnabled) {
                    const equippedArmor = actor.items?.find(i =>
                        i.type === "equipment"
                        && i.system?.equipped
                        && ["medium", "heavy"].includes(i.system?.type?.value ?? i.system?.armor?.type)
                    );
                    if (equippedArmor) {
                        const confirmFn = game.ionrift?.library?.confirm ?? Dialog.confirm.bind(Dialog);
                        const proceed = await confirmFn({
                            title: "Sleeping in Armor",
                            content: `<p><strong>${equippedArmor.name}</strong> is equipped. Sleeping in medium or heavy armor limits recovery to 1/4 Hit Dice and prevents exhaustion reduction (Xanathar's rules).</p><p>Doff the armor before confirming, or proceed and accept the penalty.</p>`,
                            yesLabel: "Confirm Anyway",
                            noLabel: "Cancel",
                            yesIcon: "fas fa-check",
                            noIcon: "fas fa-times",
                            defaultYes: false,
                        });
                        if (!proceed) return;
                    }
                }
            } catch (e) { /* setting may not be registered */ }
        }

        // Store the follow-up in the GM map so finalizeActivityChoiceFromStation picks it up.
        if (followUpValue) {
            if (!this._gmFollowUps) this._gmFollowUps = new Map();
            this._gmFollowUps.set(characterId, followUpValue);
        }

        this._totmFollowUpExpanded = null;
        await this.finalizeActivityChoiceFromStation(characterId, activityId, null, { followUpValue });

        // Training stays in the detail panel until all three sets are rolled.
        if (activityId === "act_train") {
            this._totmFollowUpExpanded = { activityId, characterId, trainingActive: true };
        }
        this.render();
    }

    /**
     * TotM inline follow-up panel: cancel button.
     * Collapses the panel without finalizing.
     */
    static #onCancelTotmFollowUp() {
        const expanded = this._totmFollowUpExpanded;
        const cid = expanded?.characterId ?? this._selectedCharacterId;
        if (cid && this._trainingStates?.has(cid) && !this._earlyResults?.has(cid)) {
            ui.notifications.warn("Finish your training sets before going back.");
            return;
        }
        this._totmFollowUpExpanded = null;
        this.render();
    }

    // ── TotM Activity Tabs ──────────────────────────────────────────────

    /**
     * TotM: switch between Activities / Identify / Fire tabs (Fire hidden when safe rest spot).
     */
    static #onSwitchTotmTab(event, target) {
        const tab = target.dataset.totmTab;
        if (!tab) return;
        let safeFromSetting = false;
        try {
            safeFromSetting = !!game.settings.get(MODULE_ID, "safeRestSpot");
        } catch { /* noop */ }
        const effectiveSafe = !!(this._engine?.safeRestSpot ?? this._restData?.safeRestSpot ?? safeFromSetting);
        // Remember the manual choice so the encounters-off default does not
        // override a GM who deliberately opened the Activities tab.
        this._totmTabUserSet = true;
        if (tab === "fire" && (effectiveSafe || isCampfireMinigameEnabled())) {
            this._totmActiveTab = "activities";
        } else {
            this._totmActiveTab = tab;
        }
        // Reset detail panel and crafting state when switching tabs
        this._totmFollowUpExpanded = null;
        this._resetTotmCraftState();
        this.render();
    }

    /**
     * TotM Identify tab: submit staged items for identify.
     */
    static async #onSubmitWorkbenchIdentifyTotm(event, target) {
        const actorId = target.dataset.workbenchActorId
            ?? this.element?.querySelector(".station-workbench-identify-embed")?.dataset?.workbenchActorId;
        if (!actorId) return;
        await this._workbench.submitFromStation(actorId);
    }

    /**
     * TotM Identify tab: dismiss reveal overlay.
     */
    static #onDismissWorkbenchIdentifyAckTotm(event, target) {
        const actorId = target.dataset.workbenchActorId
            ?? this.element?.querySelector(".station-workbench-identify-embed")?.dataset?.workbenchActorId;
        if (!actorId) return;
        this._workbench.dismissAcknowledgement(actorId);
    }

    /**
     * TotM Identify tab: trigger detect magic scan.
     */
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

    // ── TotM Inline Crafting Handlers ─────────────────────────────────────

    /**
     * Reset ephemeral crafting state for the TotM inline panel.
     * Called when the panel is collapsed or a new crafting session starts.
     */
    _resetTotmCraftState() {
        this._totmCraftRecipeId = null;
        this._totmCraftRisk = "standard";
        this._totmCraftResult = null;
        this._totmCraftHasCrafted = false;
        this._totmCraftShowMissing = false;
        this._totmCraftRollPending = false;
        this._totmCraftScrollTop = 0;
        this._totmFeastServed = false;
        this._totmFeastInFlight = false;
    }

    /**
     * Restore the inline crafting result after a refresh when this rest already
     * recorded a craft for the character. Mirrors
     * {@link StationActivityDialog._hydrateCraftStateFromRest} so the TotM panel
     * shows the finished craft as read-only instead of inviting a second roll.
     * @param {string} characterId
     * @param {string} profession
     * @returns {boolean} true when prior craft state was restored
     */
    _hydrateTotmCraftStateFromRest(characterId, profession) {
        if (!characterId) return false;
        const prior = this._craftingResults?.get(characterId);
        if (!prior && !this.hasCompletedCrafting(characterId, profession)) return false;
        this._totmCraftResult = prior ?? { success: true, narrative: "Craft already completed this rest." };
        this._totmCraftHasCrafted = true;
        this._totmCraftRecipeId = prior?.recipeId ?? null;
        return true;
    }

    /** TotM inline crafting: select a recipe. */
    static #onTotmCraftSelectRecipe(event, target) {
        if (this._totmCraftRollPending || this._totmCraftHasCrafted) return;
        this._totmCraftRecipeId = target.dataset.recipeId;
        this.render();
    }

    /** TotM inline crafting: select a risk tier. */
    static #onTotmCraftSelectRisk(event, target) {
        if (this._totmCraftRollPending || this._totmCraftHasCrafted) return;
        this._totmCraftRisk = target.dataset.risk;
        this.render();
    }

    /** TotM inline crafting: execute the craft roll. */
    static async #onTotmCraftCommit(event, target) {
        if (this._totmCraftRollPending || this._totmCraftHasCrafted || !this._totmCraftRecipeId) return;
        const expanded = this._totmFollowUpExpanded;
        if (!expanded?.isCrafting) return;

        const actor = game.actors.get(expanded.characterId);
        if (!actor) return;

        if (this.hasCompletedCrafting(actor.id, expanded.profession)) {
            ui.notifications.warn(`${actor.name} has already crafted during this rest.`);
            return;
        }

        const ledger = this._grantLedger;
        const slotKey = GrantLedger.craftingSlotKey(actor.id, expanded.profession, this._totmCraftRecipeId);
        if (ledger?.has(slotKey)) {
            ui.notifications.warn("That recipe was already crafted this rest.");
            return;
        }

        const terrainTag = this._engine?.terrainTag ?? this._restData?.terrainTag ?? null;
        const engine = this._craftingEngine;
        const partySize = engine.getRecipePartySize(this._totmCraftRecipeId, expanded.profession);

        this._totmCraftRollPending = true;
        this.render();
        try {
            this._totmCraftResult = await engine.resolve(
                actor, this._totmCraftRecipeId, expanded.profession, this._totmCraftRisk, terrainTag, partySize,
                { ledger }
            );
            this._totmCraftHasCrafted = true;
        } finally {
            this._totmCraftRollPending = false;
            this.render();
        }
    }

    /** TotM inline crafting: toggle partial recipe visibility. */
    static #onTotmCraftToggleMissing(event, target) {
        if (this._totmCraftRollPending) return;
        this._totmCraftShowMissing = !this._totmCraftShowMissing;
        this.render();
    }

    /**
     * TotM inline crafting: close the crafting panel and commit.
     * Mirrors CraftingDelegate.onClose submission logic.
     */
    static #onTotmCraftClose(event, target) {
        if (this._totmCraftRollPending) return;
        const expanded = this._totmFollowUpExpanded;
        if (!expanded?.isCrafting) {
            this._totmFollowUpExpanded = null;
            this.render();
            return;
        }

        const characterId = expanded.characterId;
        const profession = expanded.profession;
        const result = this._totmCraftResult;

        // Collapse the panel
        this._totmFollowUpExpanded = null;

        // If crafting was completed, commit the result
        if (this._totmCraftHasCrafted && result) {
            this._craftingResults.set(characterId, result);

            const resolver = this._activityResolver;
            const craftAct = resolver?.activities ? [...resolver.activities.values()].find(
                a => a.crafting?.profession === profession
            ) : null;
            const activityId = craftAct?.id ?? "act_cook";

            if (this._isGM) {
                this._gmOverrides.set(characterId, activityId);
                this._rebuildCharacterChoices?.();
                const submissions = {};
                for (const [charId, actId] of this._characterChoices) {
                    const act = resolver?.activities?.get(actId);
                    submissions[charId] = {
                        activityId: actId,
                        activityName: act?.name ?? actId,
                        source: this._gmOverrides.has(charId) ? "gm" : "player"
                    };
                }
                emitSubmissionUpdate(submissions);
            } else {
                this._characterChoices.set(characterId, activityId);
                this._lockedCharacters = this._lockedCharacters ?? new Set();
                this._lockedCharacters.add(characterId);
                emitActivityChoice(
                    game.user.id,
                    Object.fromEntries(this._characterChoices),
                    { [characterId]: result },
                    null,
                    this._earlyResults?.size ? Object.fromEntries(this._earlyResults) : null
                );
                const actor = game.actors.get(characterId);
                if (actor) ui.notifications.info(`${actor.name}'s activity submitted.`);
            }
        }

        this._resetTotmCraftState();
        this.render();
    }

    /**
     * TotM inline crafting: serve a feast to the party.
     * Mirrors StationActivityDialog.#onFeastServeNow.
     */
    static async #onTotmFeastServeNow() {
        if (this._totmFeastServed || this._totmFeastInFlight) return;
        const craftResult = this._totmCraftResult;
        if (!craftResult?.output) return;

        const expanded = this._totmFollowUpExpanded;
        if (!expanded?.isCrafting) return;
        const actor = game.actors.get(expanded.characterId);
        if (!actor) return;

        const item = actor.items?.find(i =>
            i.name === craftResult.output?.name
            && i.flags?.[MODULE_ID]?.partyMeal === true
        );
        if (!item) {
            ui.notifications.warn("Could not find the feast item in inventory.");
            return;
        }

        this._totmFeastInFlight = true;
        try {
            const partyIds = getPartyActors().map(a => a.id);
            const snapshot = item.toObject(false);

            if (game.user.isGM) {
                await MealPhaseHandler._dispatchWellFedMealServing({
                    consumerActor: actor,
                    itemSnapshot: snapshot,
                    partyIds
                });
            } else {
                emitFeastServeRequest({
                    cookActorId: actor.id,
                    itemSnapshot: snapshot,
                    partyIds,
                    feastMode: "feast"
                });
            }

            const consumed = await MealPhaseHandler._consumeItem(actor, item.id, 1);
            if (consumed < 1) {
                ui.notifications.error("Serving finished but the feast item could not be removed from inventory.");
                return;
            }
            ui.notifications.info(`${actor.name} serves ${craftResult.output.name} to the party!`);
            this._totmFeastServed = true;

            // Credit feast satiation for all party members
            const feastFlags = snapshot.flags?.[MODULE_ID] ?? {};
            const satiates = Array.isArray(feastFlags.satiates) ? feastFlags.satiates : [];
            if (satiates.length) {
                if (!this._mealChoices) this._mealChoices = new Map();
                if (!this._activityMealRationsSubmitted) this._activityMealRationsSubmitted = new Set();

                // Determine per-day slot counts from terrain meal rules
                const terrainTag = this._engine?.terrainTag ?? this._selectedTerrain ?? "forest";
                const terrainMealRules = TerrainRegistry.getDefaults(terrainTag)?.mealRules ?? {};
                const fpd = terrainMealRules.foodPerDay ?? 1;
                const wpd = terrainMealRules.waterPerDay ?? 2;

                for (const pid of partyIds) {
                    if (this._activityMealRationsSubmitted.has(pid)) continue;
                    const existing = this._mealChoices.get(pid) ?? {};
                    if (satiates.includes("food")) {
                        const foodArr = Array.isArray(existing.food) ? [...existing.food] : [];
                        const foodLocked = Array.isArray(existing.foodLockedSlots) ? [...existing.foodLockedSlots] : [];
                        // Fill ALL remaining food slots up to fpd
                        for (let i = 0; i < fpd; i++) {
                            if (!foodArr[i] || foodArr[i] === "skip") {
                                foodArr[i] = "__feast_food";
                                if (!foodLocked.includes(i)) foodLocked.push(i);
                            }
                        }
                        existing.food = foodArr;
                        existing.foodLockedSlots = foodLocked;
                    }
                    if (satiates.includes("water")) {
                        const waterArr = Array.isArray(existing.water) ? [...existing.water] : [];
                        const waterLocked = Array.isArray(existing.waterLockedSlots) ? [...existing.waterLockedSlots] : [];
                        // Fill ALL remaining water slots up to wpd
                        for (let i = 0; i < wpd; i++) {
                            if (!waterArr[i] || waterArr[i] === "skip") {
                                waterArr[i] = "__feast_water";
                                if (!waterLocked.includes(i)) waterLocked.push(i);
                            }
                        }
                        existing.water = waterArr;
                        existing.waterLockedSlots = waterLocked;
                    }
                    const consumedDays = Array.isArray(existing.consumedDays) ? [...existing.consumedDays] : [];
                    consumedDays.push({
                        food: [...(existing.food ?? [])],
                        water: [...(existing.water ?? [])],
                        essence: [...(existing.essence ?? [])]
                    });
                    this._mealChoices.set(pid, {
                        ...existing, consumedDays,
                        currentDay: consumedDays.length,
                        food: [], water: [],
                        essence: existing.essence ?? [],
                        itemsConsumed: true,
                        foodLockedSlots: existing.foodLockedSlots ?? [],
                        waterLockedSlots: existing.waterLockedSlots ?? []
                    });
                    this._activityMealRationsSubmitted.add(pid);
                }
                try { if (typeof this._saveRestState === "function") this._saveRestState(); } catch { /* ok */ }
                // Mark meal as submitted for all clients: feast covers the whole party.
                // The snapshot broadcast below will carry mealSubmitted:true to player windows,
                // replacing the "Submit Meals" button with the "Waiting for GM" label.
                this._mealSubmitted = true;
                try {
                    const snap = typeof this.getRestSnapshot === "function" ? this.getRestSnapshot() : null;
                    if (snap) game.socket.emit(`module.${MODULE_ID}`, { type: "restSnapshot", snapshot: snap });
                } catch { /* ok */ }
                notifyStationMealChoicesUpdated();
            }

            this.render();
        } finally {
            this._totmFeastInFlight = false;
        }
    }

    /** @deprecated Use this._campCeremony.lightFire() */
    async _lightFire(userId, actorId, method) {
        return this._campCeremony.lightFire(userId, actorId, method);
    }

    /** @deprecated Use this._campCeremony.addFirewoodPledge() */
    async _addFirewoodPledge(userId, actorId) {
        return this._campCeremony.addFirewoodPledge(userId, actorId);
    }

    /** @deprecated Use this._campCeremony.addGmFirewoodPledge() */
    async _addGmFirewoodPledge() {
        return this._campCeremony.addGmFirewoodPledge();
    }

    /** @deprecated Use this._campCeremony.removeFirewoodPledge() */
    async _removeFirewoodPledge(userId) {
        return this._campCeremony.removeFirewoodPledge(userId);
    }

    async _runSetCampFireLevelForGm(level, requestingUserId = null, gmOverride = false) {
        if (!game.user.isGM) return;
        if (!["embers", "campfire", "bonfire"].includes(level)) return;

        const actors = getPartyActors();
        if (!gmOverride) {
            const hasTinderbox = actors.some(a => a.items.some(i => {
                const n = i.name?.toLowerCase() ?? "";
                return n.includes("tinderbox") || n.includes("flint and steel") || n.includes("flint & steel");
            }));
            if (!hasTinderbox) {
                ui.notifications.warn("No one has a tinderbox or flint & steel to start a fire.");
                return;
            }
        }

        const cost = CampGearScanner.FIREWOOD_COST_BY_LEVEL[level] ?? 0;
        if (!gmOverride) {
            const totalFirewood = actors.reduce((sum, a) => {
                const it = a.items.find(i => {
                    const n = i.name?.toLowerCase() ?? "";
                    return n.includes("firewood") || n === "kindling";
                });
                return sum + (it?.system?.quantity ?? 0);
            }, 0);
            if (cost > totalFirewood) {
                ui.notifications.warn("Not enough firewood in the party for that fire size.");
                return;
            }
        }

        if (level === (this._fireLevel ?? "unlit")) return;

        this._coldCampDecided = false;
        this._campFireWoodSpendUserId = requestingUserId ?? null;

        const FIRE_ENCOUNTER_MOD = CampGearScanner.FIRE_ENCOUNTER_MOD_BY_LEVEL;
        this._fireLevel = level;
        this._campFirePreviewLevel = null;
        if (this._engine) {
            this._engine.fireLevel = level;
            this._engine.fireRollModifier = FIRE_ENCOUNTER_MOD[level] ?? 0;
        }

        await CampfireTokenLinker.setLightState(true, level);

        emitPhaseChanged("camp", {
                fireLevel: level,
                fireLitBy: this._fireLitBy ?? null,
                coldCampDecided: false,
                firewoodPledges: Array.from(this._firewoodPledges?.entries() ?? []),
                selectedTerrain: this._selectedTerrain ?? null
            });

        await this._saveRestState();
        const isTotmMode = this._isTotM;
        const willAdvance =
            !isTotmMode &&
            this._phase === "camp" && !this._campToActivityDone && (this._fireLevel ?? "unlit") !== "unlit";
        if (willAdvance) {
            await this._advanceCampToActivity();
        } else if (!this._campToActivityDone) {
            this.render();
        }
    }

    /**
     * Activity phase only: GM changes fire tier with immediate firewood spend on increase; no refund on decrease.
     * @param {string} level - embers | campfire | bonfire
     * @returns {Promise<{ ok: boolean, error?: string, cancelled?: boolean }>}
     */
    async changeFireLevelDuringActivity(level, { fromPlayer = false, requestingUserId = null, fromMinigame = false } = {}) {
        if (!game.user.isGM) return { ok: false, error: "GM only" };
        if (this._phase !== "activity") return { ok: false, error: "Wrong phase" };
        const restType = this._engine?.restType
            ?? this._selectedRestType
            ?? this._restData?.restType
            ?? "long";
        if (restType === "short") return { ok: false, error: "Short rest" };
        if (!["embers", "campfire", "bonfire"].includes(level)) return { ok: false, error: "Invalid level" };

        const cur = this._fireLevel ?? "unlit";
        if (level === cur) return { ok: true };

        const F = CampGearScanner.FIREWOOD_COST_BY_LEVEL;
        const costOf = (l) => (l === "unlit" ? 0 : (F[l] ?? 0));
        const curCost = costOf(cur);
        const newCost = costOf(level);

        const actors = getPartyActors();
        const hasTinderbox = actors.some(a => a.items.some(i => {
            const n = i.name?.toLowerCase() ?? "";
            return n.includes("tinderbox") || n.includes("flint and steel") || n.includes("flint & steel");
        }));

        if (newCost < curCost) {
            // Player request or minigame douse: deliberate action, no extra GM prompt
            if (!fromPlayer && !fromMinigame) {
                const confirmed = await Dialog.confirm({
                    title: "Lower the fire",
                    content: "<p>Reducing the fire discards spent firewood. There is no refund. Continue?</p>",
                    yes: () => true,
                    no: () => false,
                    defaultYes: false
                });
                if (!confirmed) return { ok: false, cancelled: true };
            }
        } else if (newCost > curCost) {
            const need = newCost - curCost;
            if (cur === "unlit" && !hasTinderbox) {
                ui.notifications.warn("No one has a tinderbox or flint and steel to start a fire.");
                return { ok: false, error: "No tinderbox" };
            }
            // When a player requests the change, only their actors' firewood counts
            const OWNER = CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
            const spendActors = requestingUserId
                ? actors.filter(a => (a.ownership?.[requestingUserId] ?? 0) >= OWNER)
                : actors;
            const totalFirewood = spendActors.reduce((sum, a) => {
                const it = a.items.find(i => {
                    const n = i.name?.toLowerCase() ?? "";
                    return n.includes("firewood") || n === "kindling";
                });
                return sum + (it?.system?.quantity ?? 0);
            }, 0);
            if (need > 0 && totalFirewood < need) {
                ui.notifications.warn("Not enough firewood in the party for that fire size.");
                return { ok: false, error: "Not enough wood" };
            }
            if (need > 0) {
                const spend = await this._spendPartyFirewoodForMakeCamp(need, requestingUserId);
                if (!spend.ok) {
                    ui.notifications.warn(spend.error ?? "Could not spend firewood.");
                    return { ok: false, error: spend.error };
                }
            }
        }

        this._fireLevel = level;
        this._coldCampDecided = false;
        this._campFirePreviewLevel = null;
        this._stationFirePreviewLevel = null;
        const FIRE_ENCOUNTER_MOD = CampGearScanner.FIRE_ENCOUNTER_MOD_BY_LEVEL;
        if (this._engine) {
            this._engine.fireLevel = level;
            this._engine.fireRollModifier = FIRE_ENCOUNTER_MOD[level] ?? 0;
        }

        await CampfireTokenLinker.setLightState(true, level);

        const label = level.charAt(0).toUpperCase() + level.slice(1);
        if (newCost > curCost && (newCost - curCost) > 0) {
            ui.notifications.info(`${label} set. ${newCost - curCost} firewood spent from party stock.`);
        } else if (newCost < curCost) {
            ui.notifications.info(`${label} set.`);
        } else {
            ui.notifications.info(`${label} set.`);
        }

        emitPhaseChanged("activity", {
                fireLevel: level,
                fireLitBy: this._fireLitBy ?? null,
                coldCampDecided: false,
                firewoodPledges: Array.from(this._firewoodPledges?.entries() ?? []),
                selectedTerrain: this._selectedTerrain ?? null,
                comfort: this._engine?.comfort ?? null,
                activeShelters: this._engine?.activeShelters ?? []
            });

        await this._saveRestState();
        this._syncTotmCampfireEmbedFromRest();
        this.render();
        void refreshOpenStationDialog();
        return { ok: true };
    }

    /**
     * Activity phase: GM sets cold camp (no fire, stealth bonus).
     * @returns {Promise<{ ok: boolean }>}
     */
    async setColdCampDuringActivity({ fromPlayer = false } = {}) {
        if (!game.user.isGM) return { ok: false };
        if (this._phase !== "activity") return { ok: false };
        if (this._coldCampDecided && (this._fireLevel ?? "unlit") === "unlit") return { ok: true };

        this._coldCampDecided = true;
        this._fireLitBy = null;
        this._fireLevel = "unlit";
        this._campFirePreviewLevel = null;
        const FIRE_MOD = CampGearScanner.FIRE_ENCOUNTER_MOD_BY_LEVEL;
        if (this._engine) {
            this._engine.fireLevel = "unlit";
            this._engine.fireRollModifier = FIRE_MOD.cold_camp ?? 0;
        }
        await CampfireTokenLinker.setLightState(false);

        emitPhaseChanged("activity", {
            coldCampDecided: true,
            fireLevel: "unlit",
            fireLitBy: null,
            selectedTerrain: this._selectedTerrain ?? null,
            comfort: this._engine?.comfort ?? null,
            activeShelters: this._engine?.activeShelters ?? []
        });

        await this._saveRestState();
        this._syncTotmCampfireEmbedFromRest();
        this.render();
        void refreshOpenStationDialog();
        if (!fromPlayer) {
            ui.notifications.info("Cold camp set.");
        }
        return { ok: true };
    }

    /**
     * GM records that the table decided to sleep cold (no fire).
     * Map-mode legacy path: selects cold camp and may advance to activities.
     */
    static async #onCampColdCamp(event, target) {
        if (!game.user.isGM) return;
        await this._campCeremony.decideColdCamp();
    }

    /** Synced cold camp pick during Make Camp or the activity Fire tab. */
    static async #onSelectCampColdCamp(event, target) {
        if (this._phase === "activity" && this._isTotM) {
            if (!game.user.isGM) {
                emitActivityColdCampRequest(game.user.id);
                return;
            }
            await this.setColdCampDuringActivity();
            return;
        }
        if (this._phase !== "camp") return;
        // Camp phase: cold camp is a preview toggle, not an instant lock-in.
        // Players and GM can preview cold camp and switch back to fire tiers.
        if (!game.user.isGM) {
            emitCampColdCampRequest(game.user.id);
            return;
        }
        // GM: toggle cold camp preview and broadcast
        this._maybeClearStagedWoodOnTierChange("cold_camp");
        this._coldCampPreview = true;
        this._campFirePreviewLevel = "cold_camp";
        void this.clearCeremonyStagedWood({ silent: true });
        emitPhaseChanged(this._phase, {
            coldCampPreview: true,
            campFirePreviewLevel: "cold_camp",
            makeCampStagedWood: [],
            selectedTerrain: this._selectedTerrain ?? null
        });
        this._syncCampCeremonyPreviewToEmbed();
        this.render();
    }

    /**
     * Commit cold camp during Make Camp. The cold-camp counterpart to lighting the
     * fire: no fire starter required, anyone at the table can lock it in. Players
     * request via socket; the GM applies through the ceremony delegate.
     */
    static async #onConfirmCampColdCamp() {
        if (this._phase !== "camp") return;
        if (this._coldCampDecided) return;
        if (!game.user.isGM) {
            emitCampColdCampCommit(game.user.id);
            return;
        }
        await this._campCeremony.selectColdCamp();
    }

    /**
     * Pre-light only: set the preview fire level (no fire lit, no state change).
     * Used by the 4-segment strip when fire is not yet lit.
     * Accepts 'cold_camp', 'embers', 'campfire', 'bonfire'.
     */
    static async #onPreviewCampFireLevel(event, target) {
        const root = target?.closest?.("[data-action=\"previewCampFireLevel\"]") ?? target;
        const level = root?.dataset?.fireLevel;
        if (!level || !["cold_camp", "embers", "campfire", "bonfire"].includes(level)) return;
        if (this._coldCampDecided) return;
        if (this._campFirePreviewLevel === level) return;
        this._campFirePreviewLevel = level;
        this.render();
    }

    /**
     * Legacy: campfire-first flow auto-advances. No-op if triggered from an old button.
     */
    static async #onContinueToCampLayout(event, target) {
        if (!game.user.isGM) return;
        ui.notifications?.info("Use the campfire on the map to finish Make Camp.");
    }

    /**
     * GM advances from Make Camp to Activities.
     */
    static async #onProceedFromCamp(event, target) {
        if (!game.user.isGM) return;
        if (this._phase !== "camp") return;
        if (this._campToActivityDone) {
            ui.notifications?.info("Already advanced from Make Camp.");
            return;
        }
        const comfortOn = isComfortEnabled();
        const mapCampFire = requiresMapCampFire();
        const pit = (comfortOn || mapCampFire) ? hasCampfirePlaced() : true;
        const fireOk = (comfortOn || mapCampFire)
            ? ((this._fireLevel ?? "unlit") !== "unlit" || !!this._coldCampDecided)
            : true;
        if (!pit || !fireOk) {
            ui.notifications?.warn("Place the pit and light the fire (or choose cold camp) from the map.");
            return;
        }
        await this._advanceCampToActivity();
    }

    /**
     * TotM Make Camp: advance to activities without the canvas pit gate.
     * Spends firewood for the committed fire level before advancing:
     *   1. Tries the actor who lit the fire first (preferred donor).
     *   2. Falls back to any other party member with firewood + toast notification.
     *   3. Blocks with a modal if cost > 0 and no firewood is found anywhere.
     * Safe rest spot skips spend and blocking (fire counts as lit without inventory cost).
     */
    static async #onProceedFromTotmCamp(event, target) {
        if (!game.user.isGM) return;
        if (this._phase !== "camp") return;
        if (this._campToActivityDone) {
            ui.notifications?.info("Already advanced from Make Camp.");
            return;
        }

        const coldCampPreview = !!this._coldCampPreview;
        const fireOk = !isComfortEnabled() || (this._fireLevel ?? "unlit") !== "unlit" || !!this._coldCampDecided || coldCampPreview;
        if (!fireOk) {
            ui.notifications?.warn("Light the fire or declare cold camp before proceeding.");
            return;
        }
        // Commit cold camp preview if active (the party previewed cold camp and GM hit Proceed)
        if (coldCampPreview && !this._coldCampDecided) {
            await this._campCeremony.selectColdCamp();
        }

        await this._totmSpendMakeCampFirewood();
        await this._advanceCampToActivity();
    }

    /**
     * GM: remove compound camp and all ionrift-respite camp tokens from the scene.
     */
    static async #onClearAllCampScene(event, target) {
        event.preventDefault?.();
        if (!game.user.isGM) return;
        const n = await clearCampTokens();
        if (n > 0) {
            ui.notifications.info(`Removed ${n} camp token(s) from the scene.`);
        } else {
            ui.notifications.info("No camp tokens to remove on this scene.");
        }
        emitCampSceneCleared({
                    resetFireLevel: true
                });
        this._fireLevel = "unlit";
        this._campFirePreviewLevel = null;
        this._campFireWoodSpendUserId = null;
        this._fireLitBy = null;
        this._firewoodPledges = new Map();
        this._makeCampStagedWood = [];
        this._makeCampStagedWoodTier = null;
        this._coldCampDecided = false;
        this._campStep2Entered = false;
        this._campPitPlacementCancelled = false;
        this._campToActivityDone = false;
        if (this._engine) {
            this._engine.fireLevel = "unlit";
            this._engine.fireRollModifier = 0;
        }
        void CampfireTokenLinker.setLightState(false);
        deactivateStationLayer();
        await closeOpenStationDialog();
        await this._saveRestState();
        this.render();
    }

    /**
     * Owner: request removal of own tent, bedroll, and mess kit tokens only.
     * GM may clear any character's placed gear from the roster view.
     */
    static async #onClearMyCampGear(event, target) {
        event.preventDefault?.();
        const root = target?.closest?.("[data-action=\"clearMyCampGear\"]") ?? target;
        const actorId = root?.dataset?.actorId;
        if (!actorId) return;

        const sceneIdGm = canvas?.scene?.id ?? null;

        if (game.user.isGM) {
            const n = await clearPlayerCampGear(actorId, sceneIdGm);
            if (n > 0) {
                ui.notifications.info(`Removed ${n} camp token(s) for that character.`);
                emitCampSceneCleared({ actorId });
            } else {
                ui.notifications.info("No camp tokens for that character on the scene.");
            }
            this.render();
            return;
        }

        const actor = game.actors.get(actorId);
        if (!actor?.isOwner) {
            ui.notifications.warn("You can only clear tokens for a character you own.");
            return;
        }

        const sceneId = canvas?.scene?.id ?? null;
        emitCampGearClearPlayer({
                    actorId,
                    userId: game.user.id,
                    sceneId
                });
    }

    /**
     * Bridge for StationActivityDialog: run reclaim with the rest app as `this`.
     * @param {RestSetupApp} restApp
     */
    static async reclaimCampGearFromDialog(restApp, event, target) {
        return RestSetupApp.#onReclaimCampGear.call(restApp, event, target);
    }

    /**
     * Pick up one deployed camp gear token (tent, bedroll, or mess kit) from the map.
     */
    static async #onReclaimCampGear(event, target) {
        event.preventDefault?.();
        const root = target?.closest?.("[data-action=\"reclaimCampGear\"]") ?? target;
        const actorId = root?.dataset?.actorId;
        const gearType = root?.dataset?.gearType;
        if (!actorId || !gearType) return;

        const sceneIdGm = canvas?.scene?.id ?? null;

        if (game.user.isGM) {
            const n = await clearPlayerCampGearType(actorId, gearType, sceneIdGm);
            if (n > 0) {
                ui.notifications.info("Gear picked up from the scene.");
                emitCampGearPlaced({
                    actorId,
                    gearType
                });
            } else {
                ui.notifications.info("Nothing to pick up on the scene for that slot.");
            }
            this.render();
            return;
        }

        const actor = game.actors.get(actorId);
        if (!actor?.isOwner) {
            ui.notifications.warn("You can only reclaim gear for a character you own.");
            return;
        }

        const sceneId = canvas?.scene?.id ?? null;
        emitCampGearReclaim({
                    actorId,
                    gearType,
                    userId: game.user.id,
                    sceneId
                });
        ui.notifications.info("Pick-up sent to the GM.");
    }

    /**
     * Pick up a shared camp station token (weapon rack, workbench, medical bed, cooking station).
     */
    static async #onReclaimCampStation(event, target) {
        event.preventDefault?.();
        const root = target?.closest?.("[data-action=\"reclaimCampStation\"]") ?? target;
        const actorId = root?.dataset?.actorId;
        const stationKey = root?.dataset?.stationKey;
        if (!actorId || !stationKey) return;

        if (game.user.isGM) {
            const n = await clearSharedCampStation(stationKey);
            if (n > 0) {
                ui.notifications.info("Station picked up from the scene.");
                emitCampStationPlaced();
            } else {
                ui.notifications.info("Nothing to pick up on the scene for that station.");
            }
            this.render();
            return;
        }

        const actor = game.actors.get(actorId);
        if (!actor?.isOwner) {
            ui.notifications.warn("You can only pick up stations for a character you own.");
            return;
        }
        if (!canPlaceStation(actor, stationKey)) {
            ui.notifications.warn("That character cannot pick up this station.");
            return;
        }

        emitCampStationReclaim({
                    actorId,
                    stationKey,
                    userId: game.user.id
                });
        ui.notifications.info("Pick-up sent to the GM.");
    }

    /**
     * Clone of the dragged control for HTML5 drag preview (semi-transparent).
     * @param {DragEvent} e
     * @param {HTMLElement} sourceEl
     */
    _applyCampDragGhost(e, sourceEl) {
        try {
            const ghost = document.createElement("div");
            ghost.className = "camp-drag-ghost-float";
            ghost.innerHTML = sourceEl.innerHTML;
            ghost.style.cssText = [
                "position:fixed",
                "left:-9999px",
                "top:0",
                "max-width:200px",
                "padding:6px 8px",
                "background:rgba(18,14,28,0.92)",
                "border:1px solid rgba(139,92,246,0.5)",
                "border-radius:8px",
                "box-shadow:0 8px 28px rgba(0,0,0,0.55)",
                "opacity:0.88",
                "pointer-events:none",
                "color:#e8e4f0",
                "font-size:0.72rem"
            ].join(";");
            document.body.appendChild(ghost);
            const w = ghost.offsetWidth || 120;
            const h = ghost.offsetHeight || 48;
            e.dataTransfer.setDragImage(ghost, Math.round(w / 2), Math.round(h / 2));
            requestAnimationFrame(() => ghost.remove());
        } catch {
            /* ignore */
        }
    }

    /**
     * Bind drag-to-canvas handlers for camp placement elements.
     * Called from _onRender when in the camp phase.
     */
    _bindCampDragHandlers(html) {
        // GM compound camp drag handle
        const campHandle = html.querySelector('.camp-drag-handle[draggable="true"]');
        if (campHandle) {
            campHandle.addEventListener("dragstart", (e) => {
                e.dataTransfer.setData("text/plain", JSON.stringify({ type: "ionrift-campfire-only" }));
                e.dataTransfer.effectAllowed = "copy";
                this._applyCampDragGhost(e, campHandle);
                campHandle.classList.add("dragging");

                const board = document.getElementById("board");
                if (board) {
                    board.addEventListener("drop", this._boundCampCanvasDrop, { once: true });
                }
            });
            campHandle.addEventListener("dragend", () => {
                campHandle.classList.remove("dragging");
            });
        }

        // Player gear drag handles (bedroll, tent, mess kit)
        // draggable is now on the outer .camp-gear-placeable-wrap; fall back to inner .gear-drag-handle for legacy
        const gearHandles = html.querySelectorAll('.camp-gear-placeable-wrap[draggable="true"], .gear-drag-handle[draggable="true"]:not(.camp-gear-placeable-wrap *)');
        for (const handle of gearHandles) {
            handle.addEventListener("dragstart", (e) => {
                const gearType = handle.dataset.gearType;
                const actorId = handle.dataset.actorId;
                e.dataTransfer.setData("text/plain", JSON.stringify({
                    type: "ionrift-player-gear",
                    gearType,
                    actorId
                }));
                e.dataTransfer.effectAllowed = "copy";
                this._applyCampDragGhost(e, handle);
                handle.classList.add("dragging");

                const board = document.getElementById("board");
                if (board) {
                    board.addEventListener("drop", this._boundCampCanvasDrop, { once: true });
                }
            });
            handle.addEventListener("dragend", () => {
                handle.classList.remove("dragging");
            });
        }

        const stationHandles = html.querySelectorAll(".camp-station-placeable[draggable=\"true\"]");
        for (const handle of stationHandles) {
            handle.addEventListener("dragstart", (e) => {
                const stationKey = handle.dataset.stationKey;
                const actorId = handle.dataset.actorId ?? "";
                e.dataTransfer.setData("text/plain", JSON.stringify({
                    type: "ionrift-camp-station",
                    stationKey,
                    actorId
                }));
                e.dataTransfer.effectAllowed = "copy";
                this._applyCampDragGhost(e, handle);
                handle.classList.add("dragging");
                const board = document.getElementById("board");
                if (board) {
                    board.addEventListener("drop", this._boundCampCanvasDrop, { once: true });
                }
            });
            handle.addEventListener("dragend", () => {
                handle.classList.remove("dragging");
            });
        }
    }

    /**
     * Canvas drop handler for camp placement (compound camp and player gear).
     * Converts browser coords to canvas world coords and dispatches placement.
     */
    async _onCampCanvasDrop(event) {
        event.preventDefault();

        let data;
        try {
            data = JSON.parse(event.dataTransfer.getData("text/plain"));
        } catch { return; }

        const t = canvas.stage.worldTransform;
        const x = (event.clientX - t.tx) / canvas.stage.scale.x;
        const y = (event.clientY - t.ty) / canvas.stage.scale.y;

        if (data?.type === "ionrift-campfire-only" || data?.type === "ionrift-compound-camp") {
            if (!game.user.isGM) return;
            await placeCampfire(x, y, { pitBaseTextureSrc: pickCampfirePitBaseTexture() });
            const fireIsLit = this._fireLevel && this._fireLevel !== "unlit";
            await CampfireTokenLinker.setLightState(
                fireIsLit,
                fireIsLit ? (this._fireLevel ?? "campfire") : null
            );
            if (this._phase === "camp") {
                await placeStationPlaceholders(!!this._engine?.safeRestSpot, {
                    simpleStations: isSimpleStationsMode()
                });
                if (isSimpleStationsMode()) {
                    await this._autoLightCampfireForSimpleStations();
                } else {
                    emitPhaseChanged("camp", { campPitCursorDone: true });
                    await this._saveRestState();
                    void this._refreshCampPitNoticeLayer();
                }
            }
            this.render();
            return;
        }

        if (data?.type === "ionrift-camp-station") {
            const { stationKey, actorId } = data;
            if (!stationKey) return;
            const preStation = validateStationEquipmentDrop(x, y, stationKey);
            if (!preStation.ok) {
                ui.notifications.warn(preStation.reason);
                return;
            }
            if (game.user.isGM) {
                const placed = await placeStation(x, y, stationKey);
                if (placed) {
                    emitCampStationPlaced();
                }
                this.render();
                this.refreshCanvasStationOverlaysIfActivity();
            } else {
                emitCampStationPlace({
                    stationKey,
                    actorId,
                    x,
                    y,
                    userId: game.user.id
                });
            }
            return;
        }

        if (data?.type === "ionrift-player-gear") {
            const { gearType, actorId } = data;
            const preGear = validatePlayerGearDrop(x, y, gearType);
            if (!preGear.ok) {
                ui.notifications.warn(preGear.reason);
                return;
            }
            if (game.user.isGM) {
                const placed = await placePlayerGear(x, y, gearType, actorId);
                this.render();
                this.refreshCanvasStationOverlaysIfActivity();
                if (placed) this.refreshOpenStationDialogAfterCampGear();
            } else {
                emitCampGearPlace({
                    actorId,
                    gearType,
                    x, y
                });
            }
            return;
        }
    }

}
