import { Logger } from "../lib/Logger.js";
import { RestFlowEngine } from "../services/RestFlowEngine.js";
import {
    executePlayerRoll, rollForPlayer, pickBestSkill, SKILL_DISPLAY_NAMES, waitForDiceSoNice, getNatD20FromRoll
} from "../services/RollRequestManager.js";
import { TerrainRegistry } from "../services/TerrainRegistry.js";
import { ActivityResolver } from "../services/ActivityResolver.js";
import { EventResolver } from "../services/EventResolver.js";
import { DecisionTreeResolver } from "../services/DecisionTreeResolver.js";
import { CraftingEngine } from "../services/CraftingEngine.js";
import { ResourcePoolRoller } from "../services/ResourcePoolRoller.js";
import { ItemOutcomeHandler } from "../services/ItemOutcomeHandler.js";
import { RecoveryHandler } from "../services/RecoveryHandler.js";
import { CalendarHandler } from "../services/CalendarHandler.js";
import { CopySpellHandler } from "../services/CopySpellHandler.js";
import { MealPhaseHandler } from "../services/MealPhaseHandler.js";
import { ConditionAdvisory } from "../services/ConditionAdvisory.js";
import { ResourceSink } from "../services/ResourceSink.js";
import { CampfireTokenLinker } from "../services/CampfireTokenLinker.js";
import { CampGearScanner } from "../services/CampGearScanner.js";
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
import { DetectMagicDelegate, collectPartyIdentifyEmbedData, computeCanShowDetectMagicScanButton, computeCanTriggerDetectMagicScan, spawnDetectMagicCastRipple } from "./delegates/DetectMagicDelegate.js";
import { WEATHER_TABLE, SKILL_NAMES, COMFORT_RANK, RANK_TO_KEY, ACTIVITY_ICONS, SHELTER_SPELLS, COMFORT_TIPS, CAMP_STATIONS, inferCanvasStationForActivity, getActivityAdvisory, buildPartyState } from "./RestConstants.js";
import {
    activateStationLayer,
    deactivateStationLayer,
    isStationLayerActive,
    refreshStationEmptyNoticeFade,
    refreshStationMealPortraits,
    refreshStationPortraitsFromChoices,
    resetStationOverlaysLocal,
    setStationPlayerState
} from "../services/StationInteractionLayer.js";
import {
    closeStationDialogIfDifferentActor,
    refreshOpenStationDialog,
    notifyStationMealChoicesUpdated,
    notifyWorkbenchIdentifyStagingTouched,
    StationActivityDialog
} from "./StationActivityDialog.js";
import { CampfireMakeCampDialog } from "./CampfireMakeCampDialog.js";

import { STUB_RECIPES, STUB_POOLS, STUB_HUNT_YIELDS } from "../data/stub-content.js";
import { ShortRestApp } from "./ShortRestApp.js";
import {
    registerActiveRestApp,
    clearActiveRestApp,
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
import {
    emitRestStarted, emitRestSnapshot, emitRestPreparing, emitRestResolved,
    emitRestAbandoned, emitPhaseChanged, emitSubmissionUpdate,
    emitActivityChoice, emitArmorToggle,
    emitCampLightFire, emitCampFireLevelRequest,
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
    emitCopySpellProposal
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
            // eslint-disable-next-line no-console
            console.log(`${MODULE_ID} | respite GM sheet [${phase}]`, msg, extra ?? "");
        }
    } catch { /* ignore */ }
}

/**
 * Whether an actor can cast a named spell from their sheet (dnd5e: cantrips, prepared, always, innate).
 * @param {Actor} actor
 * @param {string} spellNameLower
 * @returns {boolean}
 */
// ── Remaining item utility helpers (used by RSA + WorkbenchDelegate) ────────

function itemIsNativeUnidentified(item) {
    return item?.system?.identified === false;
}

function itemIsDnD5ePotionType(item) {
    return item?.type === "consumable" && item.system?.type?.value === "potion";
}

/** Matches DetectMagicScanner / workbench: native unidentified or Quartermaster-masked gear. */
function itemIsWorkbenchUnidentified(actor, item) {
    if (!item || !actor?.items?.has(item.id)) return false;
    const validTypes = new Set(["weapon", "equipment", "consumable", "tool", "loot", "container"]);
    if (!validTypes.has(item.type)) return false;
    const raw = item.toObject?.()?.system ?? {};
    const identifiedLive = item.system?.identified;
    const identifiedRaw = raw.identified;
    const summarise = game.ionrift?.workshop?.getLatentSummary ?? null;
    const quartermasterLatent = summarise?.(item);
    const isQmMasked = !!quartermasterLatent && quartermasterLatent.kind !== "mundane";
    const isNativeUnidentified = identifiedLive === false || identifiedRaw === false;
    return isQmMasked || isNativeUnidentified;
}

/**
 * Resolve an Item from a browser drop event (character sheet, sidebar, etc.).
 * @param {DragEvent} event
 * @returns {Promise<Item|null>}
 */
async function resolveItemFromDropEvent(event) {
    const TE = globalThis.foundry?.applications?.ux?.TextEditor ?? globalThis.TextEditor;
    let data = null;
    if (typeof TE?.getDragEventData === "function") {
        data = TE.getDragEventData(event);
    } else if (TE?.implementation && typeof TE.implementation.getDragEventData === "function") {
        data = TE.implementation.getDragEventData(event);
    }
    if (!data?.type) {
        try {
            data = JSON.parse(event.dataTransfer?.getData("text/plain") || "{}");
        } catch {
            data = null;
        }
    }
    if (!data?.type || data.type !== "Item") return null;
    if (data.uuid) {
        const doc = fromUuidSync(data.uuid);
        return doc instanceof Item ? doc : null;
    }
    if (typeof Item.implementation?.fromDropData === "function") {
        try {
            const doc = await Item.implementation.fromDropData(data);
            return doc instanceof Item ? doc : null;
        } catch {
            return null;
        }
    }
    return null;
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
    // eslint-disable-next-line no-console
    console.debug(`ionrift-respite | [engine-free] ${methodName} — no engine (player client, OK)`);
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
            proceedToEvents: RestSetupApp.#onProceedToEvents,
            setFireLevel: RestSetupApp.#onSetFireLevel,
            rollEvents: RestSetupApp.#onRollEvents,
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
            rollEventCheck: RestSetupApp.#onRollEventCheck,
            disasterChoice: RestSetupApp.#onDisasterChoice,
            rollCampCheck: RestSetupApp.#onRollCampCheck,
            adjustCampDC: RestSetupApp.#onAdjustCampDC,
            requestCampRoll: RestSetupApp.#onRequestCampRoll,
            toggleResolvedEvent: RestSetupApp.#onToggleResolvedEvent,
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
            adjustDaysSinceRest: RestSetupApp.#onAdjustDaysSinceRest,
            skipPendingSaves: RestSetupApp.#onSkipPendingSaves,
            hideWindow: RestSetupApp.#onHideWindow,
            rollTreeForPlayer: RestSetupApp.#onRollTreeForPlayer,
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
            campColdCamp: RestSetupApp.#onCampColdCamp,
            continueToCampLayout: RestSetupApp.#onContinueToCampLayout,
            proceedFromCamp: RestSetupApp.#onProceedFromCamp,
            clearAllCampScene: RestSetupApp.#onClearAllCampScene,
            clearMyCampGear: RestSetupApp.#onClearMyCampGear,
            reclaimCampGear: RestSetupApp.#onReclaimCampGear,
            reclaimCampStation: RestSetupApp.#onReclaimCampStation,
            exitStationChoiceReview: RestSetupApp.#onExitStationChoiceReview,
            dismissCampfireCanvasPanel: RestSetupApp.#onDismissCampfireCanvasPanel,
            retryCampPitPlacement: RestSetupApp.#onRetryCampPitPlacement
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
        this._craftingResults = new Map();
        this._fireLevel = "unlit";
        /** Make Camp step 1: hover preview for fire tier comfort (embers | campfire | bonfire). */
        this._campFirePreviewLevel = null;
        /** Prefer this user's owned actors when spending firewood at proceed (player fire-tier request). */
        this._campFireWoodSpendUserId = null;
        /** Make Camp: who lit the fire. { userId, actorId, actorName, method } or null. */
        this._fireLitBy = null;
        /** Make Camp: firewood pledged per user before proceeding. userId -> { actorId, actorName, count } */
        this._firewoodPledges = new Map();
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

        // Dual-track: GM overrides and player submissions
        this._characterChoices = new Map();
        /** Activity phase: character id -> canvas station id after a station pick (player multi-PC dim sync). */
        this._stationCanvasIdByCharacter = new Map();
        this._earlyResults = new Map();
        this._playerSubmissions = new Map();
        this._gmOverrides = new Map();
        this._gmFollowUps = new Map();
        this._lockedCharacters = new Set();

        // Party discovery item grants: key = "eventId:itemRef", value = { actorName, rolled, itemName }
        this._grantedDiscoveries = new Map();

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
                console.log(`${MODULE_ID} | Inventory changed (${item?.name}), refreshing meal panel`);
                this.render();
            }, 500);
        };
        this._inventoryHookIds = [
            Hooks.on("createItem", this._inventoryHookHandler),
            Hooks.on("deleteItem", this._inventoryHookHandler),
            Hooks.on("updateItem", this._inventoryHookHandler)
        ];
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
     * Debug: Jump to events phase with exactly one resolved event.
     * Validates single-event auto-expand (no collapsed class).
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
        console.log("[Respite:Debug] Single event injected. Card should be expanded (not collapsed).");
        ui.notifications.info("Single event loaded. Verify the card is expanded.");
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
        console.log("[Respite:Debug] Jumped to resolution with Hidden Grove discovery");
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
            recipes: Object.fromEntries(this._craftingEngine?.recipes || [])
        };
        setActiveRestData(restPayload);
        emitRestStarted(restPayload);

        setTimeout(() => {
            const snapshot = this.getRestSnapshot?.();
            if (snapshot) emitRestSnapshot(snapshot);
            emitPhaseChanged("events", { triggeredEvents: this._triggeredEvents, eventsRolled: true });
        }, 200);

        this.render(true);
        console.log("[Respite:Debug] Jumped to events phase with mock encounter and combat readiness report.");
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
            recipes: Object.fromEntries(this._craftingEngine?.recipes || [])
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
        console.log("[Respite:Debug] Jumped to events phase with Flash Flood decision tree.");
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
            console.log(`[Respite:Debug] ${actor.name}: HP set to ${halfHp}/${maxHp}`);
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
            console.log(`[Respite:Debug] ${o.characterName}: gap=${gap}, expected recovery=${expected}, actual recovery=${o.recovery?.hpRestored ?? "?"}`);
        }
        console.log("[Respite:Debug] Jumped to resolution with Bog Rot 0.5x hpMultiplier penalty.");
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
            console.log(`[Respite:Debug] ${actor.name}: HP set to ${startHp}/${maxHp}`);
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
            console.log(`[Respite:Debug] ${o.characterName}: maxHp=${maxHp}, recovery=${o.recovery?.hpRestored ?? "?"}, expected final=${maxHp} - 10 = ${maxHp - 10}`);
            // Check if damage effects came through
            for (const sub of (o.outcomes ?? [])) {
                if (sub.source === "event") {
                    console.log(`  Event outcome: ${sub.eventName}, resolvedOutcome=${sub.resolvedOutcome}, effects=${JSON.stringify(sub.effects)}`);
                }
            }
        }
        console.log("[Respite:Debug] Jumped to resolution with 10 bludgeoning damage event.");
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
            console.log(`[Respite:Debug] ${actor.name}: HP set to ${halfHp}/${maxHp}`);
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
            console.log(`[Respite:Debug] ${o.characterName}: camp=${camp}, effective=${eff}, exhaustionDC=${o.recovery?.exhaustionDC ?? "none"}`);
        }
        console.log("[Respite:Debug] Hostile comfort scenario loaded.");
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
                console.log(`[Respite:Debug] ${actor.name}: added ${qty} to existing ${existing.name} (now ${(existing.system?.quantity ?? 0) + qty})`);
            } else {
                await actor.createEmbeddedDocuments("Item", [{
                    name: "Supplies",
                    type: "loot",
                    img: "icons/containers/bags/pack-leather-brown.webp",
                    system: { quantity: qty, weight: { value: 0.5 }, price: { value: 1, denomination: "gp" } }
                }]);
                console.log(`[Respite:Debug] ${actor.name}: created Supplies x${qty}`);
            }
        }
        ui.notifications.info(`Added ${qty} supplies to ${actors.length} party members.`);
    }

    // ── Rest State Persistence ────────────────────────────────────

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
            selectedScout: this._selectedScout,
            characterChoices: Array.from(this._characterChoices.entries()),
            earlyResults: Array.from(this._earlyResults.entries()),
            gmOverrides: Array.from(this._gmOverrides.entries()),
            playerSubmissions: Array.from(this._playerSubmissions.entries()),
            lockedCharacters: Array.from(this._lockedCharacters),
            gmFollowUps: Array.from(this._gmFollowUps.entries()),
            craftingResults: Array.from(this._craftingResults.entries()),
            awaitingCombat: this._awaitingCombat ?? false,
            gmCopySpellProposal: this._gmCopySpellProposal?.charged ? this._gmCopySpellProposal : null,
            mealChoices: this._mealChoices ? Array.from(this._mealChoices.entries()) : [],
            mealSubmissions: this._mealSubmissions ? Array.from(this._mealSubmissions.entries()) : [],
            activityMealRationsSubmitted: [...(this._activityMealRationsSubmitted ?? [])],
            daysSinceLastRest: this._daysSinceLastRest ?? 1,
            campfireSnapshot: RestSetupApp._campfireSnapshotFromFireLevel(this._fireLevel),
            travelState: this._travel?.serialize() ?? null,
            magicScanComplete: this._magicScanComplete ?? false,
            magicScanResults: this._magicScanResults ?? null,
            timestamp: Date.now()
        };
        await game.settings.set(MODULE_ID, "activeRest", state);
        Logger.log(`[SYNC] _saveRestState: playerSubmissions=${state.playerSubmissions.length}, characterChoices=${state.characterChoices.length}, phase=${state.phase}`);
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
        console.log(`[Respite:State] _loadRestState — phase=${this._phase}, eventsRolled=${this._eventsRolled}, hasEngine=${!!this._engine}`);
        this._activeTreeState = state.activeTreeState ?? null;
        this._campCeremony.restore(state);
        this._campFireWoodSpendUserId = state.campFireWoodSpendUserId ?? null;
        this._campStep2Entered = state.campStep2Entered ?? false;
        this._selectedTerrain = state.selectedTerrain;
        this._selectedRestType = state.selectedRestType;
        this._selectedWeather = state.selectedWeather;
        this._selectedScout = state.selectedScout;
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
        this._awaitingCombat = state.awaitingCombat ?? false;
        this._gmCopySpellProposal = state.gmCopySpellProposal ?? null;
        this._mealChoices = new Map(state.mealChoices ?? []);
        this._mealSubmissions = new Map(state.mealSubmissions ?? []);
        this._activityMealRationsSubmitted = new Set(state.activityMealRationsSubmitted ?? []);
        this._daysSinceLastRest = state.daysSinceLastRest ?? 1;
        this._campfireSnapshot = state.campfireSnapshot ?? null;
        if (state.travelState) {
            this._travel.deserialize(state.travelState);
        }

        this._magicScanResults = state.magicScanResults ?? null;
        this._magicScanComplete = state.magicScanComplete ?? false;

        // Ensure _loadData has finished so resolvers and _activities are available
        if (this._dataReady) await this._dataReady;

        // Rebuild _characterChoices from the restored submissions and overrides
        this._rebuildCharacterChoices();

        Logger.log(`[SYNC] _loadRestState restored: characterChoices=${this._characterChoices.size}, playerSubmissions=${this._playerSubmissions.size}, gmOverrides=${this._gmOverrides.size}, submissionKeys=[${[...this._playerSubmissions.keys()].join(",")}], choiceKeys=[${[...this._characterChoices.keys()].join(",")}]`);

        if (this._magicScanComplete) {
            notifyDetectMagicScanApplied(this, getPartyActors().map(a => a.id));
        }

        return true;
    }

    /**
     * After world-flag restore while in activity phase: match a live session (station
     * overlays, rest bar, window minimised like Proceed).
     */
    async applyRestoredPhaseUi() {
        if (this._phase !== "activity") return;
        await this.render({ force: true });
        this._attachActivityPhaseCanvasChrome();
        await this.close({});
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
    async _clearRestState() {
        if (!game.user.isGM) return;
        try {
            await game.settings.set(MODULE_ID, "activeRest", {});
        } catch (e) {
            // Setting may not be registered yet
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
            // Patreon and imported through Respite's Content Packs settings UI.
            await this._loadContentPacks();
        } catch (e) {
            console.error(`${MODULE_ID} | Failed to load seed data:`, e);
        }
    }

    /**
     * Loads imported content pack data from world storage.
     * Packs are stored as world-level settings after being imported
     * through the Content Packs UI (JSON file upload from Patreon).
     * Feeds events, recipes, resource pools, and hunt yields into their engines.
     */
    async _loadContentPacks() {
        const enabledPacks = game.settings.get(MODULE_ID, "enabledPacks") ?? {};
        const importedPacks = game.settings.get(MODULE_ID, "importedPacks") ?? {};

        let totalRecipes = 0, totalPools = 0, totalYieldTerrains = 0;

        for (const [packId, packData] of Object.entries(importedPacks)) {
            if (enabledPacks[packId] === false) {
                console.log(`${MODULE_ID} | Pack ${packId}: disabled`);
                continue;
            }

            try {
                const loaded = [];

                // Events
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
                    this._travel.loadPoolsFromData(packData.resourcePools);
                    totalPools += packData.resourcePools.length;
                    loaded.push(`${packData.resourcePools.length} pools`);
                }

                // Hunt Yields
                if (packData.huntYields && typeof packData.huntYields === "object" && this._travel) {
                    this._travel.loadHuntYieldsFromData(packData.huntYields);
                    const terrainCount = Object.keys(packData.huntYields).length;
                    totalYieldTerrains += terrainCount;
                    loaded.push(`${terrainCount} hunt terrains`);
                }

                if (loaded.length) {
                    console.log(`${MODULE_ID} | Pack ${packId}: loaded ${loaded.join(", ")}`);
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
            console.log(`${MODULE_ID} | Using built-in stub recipes`);
        }
        if (totalPools === 0 && this._travel) {
            this._travel.loadPoolsFromData(STUB_POOLS);
            console.log(`${MODULE_ID} | Using built-in stub forage pools`);
        }
        if (totalYieldTerrains === 0 && this._travel) {
            this._travel.loadHuntYieldsFromData(STUB_HUNT_YIELDS);
            console.log(`${MODULE_ID} | Using built-in stub hunt yields`);
        }
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
                console.warn(`${MODULE_ID} | No event file for terrain: ${terrainTag}`);
                return;
            }
            const data = await resp.json();
            this._eventResolver.load(data.tables, data.events);
        } catch (e) {
            console.warn(`${MODULE_ID} | Failed to load events for ${terrainTag}:`, e);
        }
    }

    render(options = {}) {
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
                .then(() => showAfkPanel())
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
        if (this._isGM) {
            // If rest is in resolution phase but auto-apply hasn't completed, confirm
            if (this._phase === "resolve" && !this._restApplied && !options.resolved) {
                // Check for ungranted discoveries
                let ungrantedCount = 0;
                if (this._grantedDiscoveries && this._outcomes?.length) {
                    const seenEvents = new Set();
                    for (const o of this._outcomes) {
                        for (const sub of (o.outcomes ?? [])) {
                            if (sub.source === "event" && sub.items?.length && !seenEvents.has(sub.eventId)) {
                                seenEvents.add(sub.eventId);
                                for (const item of sub.items) {
                                    const key = `${sub.eventId}:${item.itemRef ?? item.name}`;
                                    if (!this._grantedDiscoveries.has(key)) ungrantedCount++;
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
        return super.close(options);
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
            const fireCommitted = !!this._fireLitBy || (this._fireLevel ?? "unlit") !== "unlit" || !!this._coldCampDecided;
            campColdCampDecided = !!this._coldCampDecided;
            const effectiveScanLevel = (campfirePlacedGate && fireCommitted)
                ? (this._fireLevel ?? "unlit")
                : (this._campFirePreviewLevel ?? this._fireLevel ?? "unlit");
            const encMod = CampGearScanner.FIRE_ENCOUNTER_MOD_BY_LEVEL[effectiveScanLevel] ?? 0;
            if (effectiveScanLevel === "unlit") {
                campFireEncounterHint = "No fire is lit yet. The tier row shows what each level would do.";
            } else if (effectiveScanLevel === "embers") {
                campFireEncounterHint = "Embers: no change to encounter DC.";
            } else if (effectiveScanLevel === "campfire") {
                campFireEncounterHint = "Campfire: +1 encounter DC.";
            } else if (effectiveScanLevel === "bonfire") {
                campFireEncounterHint = "Bonfire: +2 encounter DC.";
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
                encMod
            );
            const fs = campScanData.fireSelection ?? {};
            const cur = this._fireLevel ?? "unlit";
            campFirePickerLevels = [
                {
                    id: "embers",
                    label: "Embers",
                    costLabel: "0 firewood",
                    body: "No cooking. No comfort change.",
                    disabled: !fs.canPickEmbers,
                    disabledReason: fs.canPickEmbers ? "" : "Someone needs a tinderbox or flint and steel.",
                    selected: cur === "embers"
                },
                {
                    id: "campfire",
                    label: "Campfire",
                    costLabel: "1 firewood",
                    body: "Cooking and warmth. +1 encounter DC.",
                    disabled: !fs.canPickCampfire,
                    disabledReason: !fs.canPickCampfire
                        ? (!fs.canPickEmbers ? "Someone needs a tinderbox or flint and steel." : "Need at least 1 firewood in the party.")
                        : "",
                    selected: cur === "campfire"
                },
                {
                    id: "bonfire",
                    label: "Bonfire",
                    costLabel: "2 firewood",
                    body: "+1 camp comfort, full cooking. +2 encounter DC.",
                    disabled: !fs.canPickBonfire,
                    disabledReason: !fs.canPickBonfire
                        ? (!fs.canPickEmbers ? "Someone needs a tinderbox or flint and steel." : "Need at least 2 firewood in the party.")
                        : "",
                    selected: cur === "bonfire"
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
        if (this._phase === "camp" && campScanData) {
            campFireIsLit = !!this._fireLitBy || (this._fireLevel ?? "unlit") !== "unlit";
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
                campfire: "Cooking and warmth. +1 encounter DC.",
                bonfire: "+1 camp comfort, full cooking. +2 encounter DC."
            };
            const COMFORT_TIERS = ["hostile", "rough", "sheltered", "safe"];
            const TIER_LABELS = Object.fromEntries(
                COMFORT_TIERS.map(k => [k, CampGearScanner.getRules(k).label])
            );
            const baseComfort = campScanData.campComfortPreFire ?? campScanData.campComfort ?? "rough";
            const baseIdx = COMFORT_TIERS.indexOf(baseComfort);
            const COMFORT_DELTA = { embers: 0, campfire: 0, bonfire: 1 };
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
                    costLabel: id === "embers" ? "0 firewood" : id === "campfire" ? "1 firewood" : "2 firewood",
                    body: TIER_BODIES[id],
                    comfortHint,
                    comfortChanged: delta !== 0,
                    active: (this._fireLevel ?? "unlit") === id
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

        return {
            campFireEncounterHint,
            campFireIsLit,
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
        return RestSetupApp.#onCampColdCamp.call(this, new Event("click"), null);
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
        }

        const partyActors = getPartyActors();
        const emptyParty = partyActors.length === 0;
        if (!this._selectedTerrain) {
            const lastTerrain = game.settings.get(MODULE_ID, "lastTerrain");
            if (lastTerrain && TerrainRegistry.get(lastTerrain)) this._selectedTerrain = lastTerrain;
        }
        const terrainDefaults = TerrainRegistry.getDefaults(this._selectedTerrain ?? "forest");
        const defaultComfort = terrainDefaults.comfort;

        // ── Shelter detection ──


        // Determine current rest type from state (defaults to long)
        const currentRestType = this._selectedRestType ?? "long";

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
            const effectiveChoice = gmOverride ?? playerChoice?.activityId ?? null;
            let source = gmOverride ? "gm" : playerChoice ? "player" : "pending";

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
            const isFireLit = !!(this._fireLevel && this._fireLevel !== "unlit");
            const { available: avail, faded: fadedActivities, minor: minorActivities, fadedMinor: fadedMinorActivities } = this._activityResolver.getAvailableActivitiesWithFaded(a, this._engine?.restType ?? "long", { isFireLit });
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
                    hasAttuneable: act.id === "act_attune",
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

            // Station-grouped activity cards
            const allAvailableIds = new Set(allTiles.map(t => t.id));
            const stationCards = CAMP_STATIONS
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

        // Split into hero cards (owned, interactive) and party cards (others, info only)
        // GM sees all as heroes since they manage all characters
        const heroCharacters = this._isGM
            ? characterStatuses
            : characterStatuses.filter(c => c.isOwner);
        const partyCharacters = this._isGM
            ? []
            : characterStatuses.filter(c => !c.isOwner);

        // Roster strip: compact summary for ALL characters (everyone sees the full party)
        // Validate _selectedCharacterId against current roster — if the party
        // composition changed (e.g. PartyRosterApp save) the cached ID may
        // reference a character that is no longer in the party, which causes
        // GM overrides to be keyed to a stale ID and the confirm loop bug.
        const selectedStillValid = this._selectedCharacterId
            && heroCharacters.some(c => c.id === this._selectedCharacterId);
        if (!selectedStillValid && heroCharacters.length > 0) {
            this._selectedCharacterId = heroCharacters[0].id;
            closeStationDialogIfDifferentActor(this._selectedCharacterId);
        }
        const roster = characterStatuses.map(c => {
            // Check event roll status for this character
            let pendingRoll = false;
            let rolledResult = null;

            if (this._isGM) {
                // GM: check triggeredEvents for awaiting rolls
                const awaitingEvent = (this._triggeredEvents ?? []).find(e => e.awaitingRolls);
                if (awaitingEvent) {
                    if (awaitingEvent.pendingRolls?.includes(c.id)) pendingRoll = true;
                    const resolved = awaitingEvent.resolvedRolls?.find(r => r.characterId === c.id);
                    if (resolved) rolledResult = resolved.total;
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

            // Look up assigned activity for roster label (all phases once chosen)
            let activityLabel = null;
            const actId = this._gmOverrides?.get(c.id) ?? this._characterChoices?.get(c.id);
            if (actId) {
                const act = this._activities?.find(a => a.id === actId);
                activityLabel = act?.name ?? null;
            }

            const isBeddedDown = this._phase === "reflection"
                && !this._nightWatchActorIds().has(c.id);
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
                activityLabel,
                isBeddedDown
            };
        });

        const selectedCharacter = heroCharacters.find(c => c.id === this._selectedCharacterId) ?? heroCharacters[0] ?? null;

        const totalCharacters = partyActors.length;
        const resolvedCount = characterStatuses.filter(c => c.source !== "pending").length;
        const trackFoodSetting = game.settings.get(MODULE_ID, "trackFood");
        const allRationsSubmitted = !trackFoodSetting
            || (this._activityMealRationsSubmitted?.size ?? 0) >= totalCharacters;
        const allResolved = resolvedCount === totalCharacters
            && !this._gmCopySpellProposal
            && allRationsSubmitted;
        const activityPhasePlayerOverview =
            this._phase === "activity"
                ? {
                      resolvedCount,
                      totalCharacters,
                      allResolved,
                      trackFood: !!trackFoodSetting,
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
            recoverySummary = scopedOutcomes.map(o => ({
                name: o.characterName,
                hp: o.recovery?.hpRestored ?? 0,
                hd: o.recovery?.hdRestored ?? 0,
                eventDamage: o.recovery?.eventDamage ?? 0,
                exhaustionDelta: o.recovery?.exhaustionDelta ?? 0,
                exhaustionDC: o.recovery?.exhaustionDC ?? 0,
                exhaustionSaveResult: o.recovery?.exhaustionSaveResult ?? null,
                gearBonuses: o.recovery?.gearBonuses ?? {},
                gearDescriptors: o.recovery?.gearDescriptors ?? []
            }));
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

            // Aggregate event item rewards into party discoveries (shown once, not per-character)
            const seenEvents = new Set();
            for (const o of this._outcomes ?? []) {
                for (const sub of (o.outcomes ?? [])) {
                    if (sub.source === "event" && sub.items?.length && !seenEvents.has(sub.eventId)) {
                        seenEvents.add(sub.eventId);
                        for (const item of sub.items) {
                            const grantKey = `${sub.eventId}:${item.itemRef ?? item.name}`;
                            const grantInfo = this._grantedDiscoveries.get(grantKey);
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
        if (this._phase === "camp") {
            const terrainTagCamp = this._selectedTerrain ?? this._engine?.terrainTag ?? "forest";
            const terrainCamp = TerrainRegistry.get(terrainTagCamp);
            const shelterSpellCamp = (this._engine?.activeShelters ?? []).find(s => s !== "tent" && s !== "none")
                ? SHELTER_SPELLS[(this._engine?.activeShelters ?? []).find(s => s !== "tent" && s !== "none")]?.label ?? null
                : null;
            const campfirePlacedGate = hasCampfirePlaced();
            // Gate: fire is lit, OR table decided cold camp (no fire)
            const fireCommitted = !!this._fireLitBy || (this._fireLevel ?? "unlit") !== "unlit" || !!this._coldCampDecided;
            campColdCampDecided = !!this._coldCampDecided;
            const campGatesReady = campfirePlacedGate && fireCommitted;
            campMakeCampPlacementUnlocked = false;
            campMakeCampStep = 1;
            canContinueToCampLayout = false;
            campFireGatePit = campfirePlacedGate;
            campFireGateLevel = fireCommitted;
            const effectiveScanLevel = (campfirePlacedGate && fireCommitted)
                ? (this._fireLevel ?? "unlit")
                : (this._campFirePreviewLevel ?? this._fireLevel ?? "unlit");
            const encMod = CampGearScanner.FIRE_ENCOUNTER_MOD_BY_LEVEL[effectiveScanLevel] ?? 0;
            // RestFlowEngine: effectiveDC = baseDC - (… + fireRollModifier + …). Positive fireRollModifier
            // lowers the number shown as Encounter DC (fewer night events). Copy matches that display.
            if (effectiveScanLevel === "unlit") {
                campFireEncounterHint = "No fire is lit yet. The tier row shows what each level would do.";
            } else if (effectiveScanLevel === "embers") {
                campFireEncounterHint = "Embers: no change to encounter DC.";
            } else if (effectiveScanLevel === "campfire") {
                campFireEncounterHint = "Campfire: +1 encounter DC.";
            } else if (effectiveScanLevel === "bonfire") {
                campFireEncounterHint = "Bonfire: +2 encounter DC.";
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
                encMod
            );
            const fs = campScanData.fireSelection ?? {};
            const cur = this._fireLevel ?? "unlit";
            campFirePickerLevels = [
                {
                    id: "embers",
                    label: "Embers",
                    costLabel: "0 firewood",
                    body: "No cooking. No comfort change.",
                    disabled: !fs.canPickEmbers,
                    disabledReason: fs.canPickEmbers ? "" : "Someone needs a tinderbox or flint and steel.",
                    selected: cur === "embers"
                },
                {
                    id: "campfire",
                    label: "Campfire",
                    costLabel: "1 firewood",
                    body: "Cooking and warmth. +1 encounter DC.",
                    disabled: !fs.canPickCampfire,
                    disabledReason: !fs.canPickCampfire
                        ? (!fs.canPickEmbers ? "Someone needs a tinderbox or flint and steel." : "Need at least 1 firewood in the party.")
                        : "",
                    selected: cur === "campfire"
                },
                {
                    id: "bonfire",
                    label: "Bonfire",
                    costLabel: "2 firewood",
                    body: "+1 camp comfort, full cooking. +2 encounter DC.",
                    disabled: !fs.canPickBonfire,
                    disabledReason: !fs.canPickBonfire
                        ? (!fs.canPickEmbers ? "Someone needs a tinderbox or flint and steel." : "Need at least 2 firewood in the party.")
                        : "",
                    selected: cur === "bonfire"
                }
            ];
        }

        // ── Fire contribution UI context ───────────────────────────────────────────
        let campFireIsLit = false;
        let campFireLitBy = null;
        let campFireLighters = [];
        let campFirewoodPledgeList = [];
        let campMyPledge = null;
        let campCanAddFirewood = false;
        let campMyFirewoodActorId = null;
        let campFireTierCards = [];
        let campFireTotalPledged = 0;
        if (this._phase === "camp" && campScanData) {
            campFireIsLit = !!this._fireLitBy || (this._fireLevel ?? "unlit") !== "unlit";
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

            // Read-only tier cards shown when fire is lit
            if (campFireIsLit) {
                const TIER_BODIES = {
                    embers: "No cooking. No comfort change.",
                    campfire: "Cooking and warmth. +1 encounter DC.",
                    bonfire: "+1 camp comfort, full cooking. +2 encounter DC."
                };
                const COMFORT_TIERS = ["hostile", "rough", "sheltered", "safe"];
                const TIER_LABELS = Object.fromEntries(
                    COMFORT_TIERS.map(k => [k, CampGearScanner.getRules(k).label])
                );
                const baseComfort = campScanData.campComfortPreFire ?? campScanData.campComfort ?? "rough";
                const baseIdx = COMFORT_TIERS.indexOf(baseComfort);
                // Bonfire shifts comfort +1 tier; embers/campfire leave it unchanged
                const COMFORT_DELTA = { embers: 0, campfire: 0, bonfire: 1 };
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
                        costLabel: id === "embers" ? "0 firewood" : id === "campfire" ? "1 firewood" : "2 firewood",
                        body: TIER_BODIES[id],
                        comfortHint,
                        comfortChanged: delta !== 0,
                        active: (this._fireLevel ?? "unlit") === id
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
            return CAMP_STATION_PLACEMENT_KEYS.map(key => {
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

        return {
            isGM: this._isGM,
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
                const allowed = terrain?.travelActivities ?? [];
                const canForage = allowed.includes("forage");
                const canHunt = allowed.includes("hunt");
                const scoutAllowed = this._travelScoutingAllowed ?? true;
                const canScout = allowed.includes("scout") && scoutAllowed;
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
                            ? (dayLocal[a.id] ?? "nothing")
                            : (daySynced[a.id] ?? "nothing");
                        const lastAct = a.getFlag?.("ionrift-respite", "lastTravelActivity") ?? null;
                        const lastLabel = lastAct === "forage" ? "Forage"
                            : lastAct === "hunt" ? "Hunt"
                            : lastAct === "scout" ? "Scout" : null;
                        const confirmed = a.isOwner
                            ? !!(this._playerTravelConfirmed?.[day]?.[a.id])
                            : !!(syncedDecl[day]?._confirmed?.[a.id] ?? daySynced._confirmed?.[a.id]);
                        const rolled = a.isOwner
                            ? !!(this._playerTravelRolled?.[day]?.[a.id])
                            : false;
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
                                const sur = a.system?.skills?.sur?.total ?? 0;
                                const nat = a.system?.skills?.nat?.total ?? 0;
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
                    days.push({
                        day: d,
                        label: totalDays === 1 ? null : `Day ${d}`,
                        isFinalDay,
                        canScout: isFinalDay && canScout,
                        isActive: d === activeDay,
                        characters: buildChars(d)
                    });
                }

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
                    huntDC: this._travelHuntDC ?? 14
                };
            })(),
            pendingTravelRoll: this._pendingTravelRoll ? (() => {
                const activities = (this._pendingTravelRoll.activities ?? []).map(a => {
                    const actor = game.actors.get(a.actorId);
                    const isOwner = actor?.isOwner ?? false;
                    const rolled = this._pendingTravelRoll.rolledCharacters?.has(a.actorId) ?? false;
                    return { ...a, isOwner, rolled, actorName: actor?.name ?? a.actorId, activityLabel: a.activityLabel ?? a.activity };
                });
                return { activities };
            })() : null,
            travelDebrief: this._travelDebrief?.length ? this._travelDebrief : null,
            travelFullyResolved: this._travelFullyResolved ?? false,
            travelScoutingDone: this._travelScoutingDone ?? false,
            scoutingDebrief: this._isGM ? (this._scoutingDebrief ?? (() => {
                if (this._travel?.scoutingResult) {
                    const terrainTag = this._selectedTerrain ?? this._engine?.terrainTag ?? "forest";
                    this._scoutingDebrief = this._travel.getScoutingDebrief(terrainTag);
                    return this._scoutingDebrief;
                }
                return null;
            })()) : null,
            terrainOptions: (() => {
                const lastTerrain = game.settings.get(MODULE_ID, "lastTerrain");
                // Only show terrains that have event sources (core eventsFile or content pack events)
                const opts = TerrainRegistry.getAll()
                    .filter(t => {
                        // Has built-in core events file
                        if (t.eventsFile) return true;
                        // Has events loaded from an enabled content pack
                        if (this._eventResolver?.tables?.has(t.id)) return true;
                        return false;
                    })
                    .map(t => ({ value: t.id, label: t.label }));
                if (lastTerrain) {
                    const match = opts.find(o => o.value === lastTerrain);
                    if (match) match.label += " (last used)";
                }
                return opts;
            })(),
            terrainPreview: (() => {
                const t = this._selectedTerrain ?? "forest";
                const d = TerrainRegistry.getDefaults(t);
                const comfort = (d.comfort ?? "sheltered").charAt(0).toUpperCase() + (d.comfort ?? "sheltered").slice(1);
                const scout = d.scoutingAvailable !== false ? "Scouting available." : "No scouting.";
                return `Implied comfort: ${comfort}. ${scout}`;
            })(),
            weatherOptions: (() => {
                const defaultKey = TerrainRegistry.getWeather(this._selectedTerrain ?? "forest")[0] ?? "clear";
                return TerrainRegistry.getWeather(this._selectedTerrain ?? "forest")
                    .map(key => ({ value: key, ...WEATHER_TABLE[key] }))
                    .filter(w => w.label)
                    .map(w => w.value === defaultKey ? { ...w, label: `${w.label} (Default)` } : w);
            })(),
            defaultWeather: TerrainRegistry.getWeather(this._selectedTerrain ?? "forest")[0] ?? "clear",
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
            setupStep: this._setupStep ?? 1,
            selectedTerrain: this._selectedTerrain ?? "forest",
            terrainBanner: (() => {
                const t = this._selectedTerrain ?? this._engine?.terrainTag ?? "forest";
                const p = this._phase ?? "setup";
                
                // All terrains look in their specific folder.
                const filename = (p === "activity" || p === "reflection" || p === "meal" || p === "travel" || p === "camp") ? "banner.png" : `${p}.png`;
                return ImageResolver.terrainBanner(t, filename);
            })(),
            terrainBannerFallback: ImageResolver.fallbackBanner,
            terrainBannerPos: "center", // banners are pre-cropped 640×120 strips
            selectedTerrainLabel: this._terrainLabel ?? "Forest",
            selectedRestType: this._selectedRestType ?? "long",
            selectedRestTypeLabel: this._selectedRestType === "short" ? "Short Rest" : "Long Rest",
            isShortRest: (this._selectedRestType ?? "long") === "short",
            selectedWeatherLabel: WEATHER_TABLE[this._selectedWeather]?.label ?? "Clear",
            selectedScoutLabel: this._selectedScout ?? "None",
            scoutingAvailable: terrainDefaults.scoutingAvailable ?? false,
            scoutingAllowed: this._scoutingAllowed ?? true,
            scoutSkill: (() => {
                const g = terrainDefaults.scoutGuidance ?? "";
                return g.startsWith("Investigation") ? "Investigation" : "Survival";
            })(),
            scoutTiers: (() => {
                const g = terrainDefaults.scoutGuidance ?? "";
                const m = g.match(/Poor:\s*([^|]+)\|\s*Average:\s*([^|]+)\|\s*Good:\s*(.+?)\./);
                if (!m) return null;
                return { poor: m[1].trim(), average: m[2].trim(), good: m[3].trim() };
            })(),
            scoutAdvantage: (() => {
                const g = terrainDefaults.scoutGuidance ?? "";
                const parts = g.split(". ").filter(p => p.includes("advantage") || p.includes("disadvantage"));
                return parts.map(p => p.replace(/\.$/, "")).join(". ") || null;
            })(),
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
            triggeredEvents: (this._triggeredEvents ?? []).map(e => {
                // Resolve target IDs to actor names for the template
                const targetNames = (e.targets ?? [])
                    .map(id => game.actors.get(id)?.name)
                    .filter(Boolean);
                const skillName = e.mechanical?.skill
                    ? (SKILL_NAMES[e.mechanical.skill] ?? e.mechanical.skill)
                    : null;
                // Enrich resolved rolls with ownership for player-side filtering
                const resolvedRolls = (e.resolvedRolls ?? []).map(r => ({
                    ...r,
                    isOwner: game.actors.get(r.characterId)?.isOwner ?? false
                }));
                return { ...e, targetNames, skillName, resolvedRolls };
            }),
            allEventChecksResolved: !(this._triggeredEvents ?? []).some(
                e => e.mechanical?.type === "skill_check" && (!e.resolvedOutcome || e.awaitingRolls)
            ),
            anyEventAwaitingRolls: (this._triggeredEvents ?? []).some(e => e.awaitingRolls),
            pendingEventRoll: this._pendingEventRoll ? (() => {
                // Build list of targets this player owns and hasn't rolled yet
                const ownedTargets = (this._pendingEventRoll.targets ?? [])
                    .map(id => game.actors.get(id))
                    .filter(a => a?.isOwner)
                    .map(a => ({
                        id: a.id,
                        name: a.name,
                        rolled: this._pendingEventRoll.rolledCharacters?.has(a.id) ?? false
                    }));
                return { ...this._pendingEventRoll, ownedTargets };
            })() : null,
            pendingTreeRoll: this._pendingTreeRoll ? (() => {
                const rollModes = this._pendingTreeRoll.rollModes ?? {};
                const ownedTargets = (this._pendingTreeRoll.targets ?? [])
                    .map(id => game.actors.get(id))
                    .filter(a => a?.isOwner)
                    .map(a => {
                        const rolled = this._pendingTreeRoll.rolledCharacters?.has(a.id) ?? false;
                        const result = this._pendingTreeRoll.rolledResults?.get(a.id);
                        return {
                            id: a.id,
                            name: a.name,
                            rolled,
                            total: result?.total ?? null,
                            passed: result?.passed ?? null,
                            rollMode: rollModes[a.id] ?? "normal"
                        };
                    });
                return { ...this._pendingTreeRoll, ownedTargets };
            })() : null,
            actorLookup: (() => {
                const lookup = {};
                for (const a of getPartyActors()) {
                    lookup[a.id] = { name: a.name, img: a.img };
                }
                return lookup;
            })(),
            eventsRolled: this._eventsRolled ?? false,
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
                    total: a.total ?? null
                }))
            } : null,
            disasterChoice: this._disasterChoice ? {
                ...this._disasterChoice,
                normalsLabel: (this._disasterChoice.normals?.length ?? 0) > 1
                    ? "Two Complications"
                    : "One Complication"
            } : null,
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
                const pendingRollsEnriched = (ts.pendingRolls ?? []).map(id => ({
                    id,
                    name: game.actors.get(id)?.name ?? id,
                    rollMode: rollModes[id] ?? "normal"
                }));
                return { ...ts, pendingRollsEnriched };
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
                const tiers = ["hostile", "rough", "comfortable", "sheltered", "safe"];
                let effectiveIdx = tiers.indexOf(rawComfort);
                if (effectiveIdx < 0) effectiveIdx = 1;
                if (shelterSpell) {
                    const shelterIdx = tiers.indexOf("sheltered");
                    if (effectiveIdx < shelterIdx) effectiveIdx = shelterIdx;
                }
                if (fireIsLit) effectiveIdx = Math.min(effectiveIdx + 1, tiers.length - 1);
                const comfort = tiers[effectiveIdx];

                const weatherKey = this._engine.weather ?? "clear";
                const wx = WEATHER_TABLE[weatherKey] ?? WEATHER_TABLE.clear;
                const weatherParts = [];
                if (wx.comfortPenalty > 0) weatherParts.push(`Comfort -${wx.comfortPenalty} step`);
                if (wx.encounterDC > 0) weatherParts.push(`Night check mod +${wx.encounterDC}`);
                if (wx.tentCancels) weatherParts.push("Tent cancels");
                else if (wx.tentReduces) weatherParts.push("Tent reduces by 1");
                const SHELTER_TOOLTIPS = {
                    tent: "Tent: +2 encounter DC, cancels or reduces weather",
                    tiny_hut: "Tiny Hut: comfort floor sheltered, +5 encounter DC",
                    rope_trick: "Rope Trick: extradimensional shelter, hidden from the outside",
                    magnificent_mansion: "Mansion: comfort floor safe, no encounters"
                };
                const FIRE_TIPS = {
                    unlit: "Unlit: -1 comfort step at resolution",
                    embers: "Embers: no change to encounter DC.",
                    campfire: "Campfire: +1 encounter DC.",
                    bonfire: "Bonfire: +1 camp comfort, full cooking. +2 encounter DC."
                };
                return this._campStatus = {
                    comfort,
                    comfortTooltip: COMFORT_TIPS[comfort] ?? comfort,
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
            campScan: campScanData,
            campMakeCampPlacementUnlocked,
            campGatesReady: this._phase === "camp" && !!(campMakeCampStep === 1 && campFireGatePit && campFireGateLevel),
            canContinueToCampLayout: false,
            canProceedFromCamp: false,
            campMinimalMode: this._phase === "camp",
            campPitPlacementCancelled: !!this._campPitPlacementCancelled,
            showCampfireCanvasPanel: !!this._showCampfireCanvasPanel,
            campMakeCampStep,
            campFireEncounterHint,
            campFirePickerLevels,
            campFireGatePit,
            campFireGateLevel,
            campFireIsLit,
            campFireLitBy,
            campFireLighters,
            campFirewoodPledgeList,
            campMyPledge,
            campCanAddFirewood,
            campMyFirewoodActorId,
            campColdCampDecided,
            campComfortIsHostile,
            campFireTierCards,
            campFireTotalPledged,
            campPersonalSelected,
            campGearForSelected,
            campPlacementRuleHint,
            campfirePlaced,
            campStationCards,
            craftingDrawer: this._buildCraftingDrawerContext(),
            encounterBar: (this._engine && !this._eventsRolled) ? (() => {
                const bd = this._engine._encounterBreakdown ?? {};
                const shelter = bd.shelter ?? 0;
                const weather = bd.weather ?? 0;
                const scouting = bd.scouting ?? 0;
                const fire = this._engine.fireRollModifier ?? 0;
                const gmAdj = this._engine.gmEncounterAdj ?? 0;
                const complication = this._engine.scoutingComplication ?? false;
                const defenses = bd.defenses ?? 0;
                const total = shelter + weather + scouting + fire;
                const terrainTable = this._eventResolver?.tables?.get(this._engine.terrainTag);
                const baseDC = terrainTable?.noEventThreshold ?? 15;
                const effectiveDC = Math.max(1, baseDC - total + gmAdj - defenses);
                console.log(`[Respite:UI] encounterBar — baseDC=${baseDC}, shelter=${shelter}, weather=${weather}, scouting=${scouting}, fire=${fire}, total=${total}, defenses=${defenses}, gmAdj=${gmAdj} → effectiveDC=${effectiveDC}`);
                const fmt = (v) => v > 0 ? `+${v}` : `${v}`;
                const chips = [];
                if (weather !== 0) chips.push({ label: bd.weatherName ?? "Weather", value: fmt(weather), icon: "fas fa-cloud-sun-rain" });
                if (shelter !== 0) chips.push({ label: "Shelter", value: fmt(shelter), icon: "fas fa-campground" });
                if (scouting !== 0) chips.push({ label: `Scout: ${bd.scoutingResult ?? "?"}`, value: fmt(scouting), icon: "fas fa-binoculars" });
                if (complication) chips.push({ label: "Complication", value: "", icon: "fas fa-exclamation-triangle", warn: true });
                if (fire !== 0) chips.push({ label: this._fireLevel ?? "Fire", value: fmt(-fire), icon: "fas fa-fire" });
                if (defenses !== 0) chips.push({ label: "Defenses", value: fmt(-defenses), icon: "fas fa-shield-alt" });
                if (gmAdj !== 0) chips.push({ label: "GM", value: fmt(gmAdj), icon: "fas fa-gavel" });
                return {
                    total,
                    baseDC,
                    effectiveDC,
                    totalLabel: `Encounter DC ${effectiveDC}`,
                    chips,
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
                const terrainTag = this._engine?.terrainTag ?? this._selectedTerrain ?? "forest";
                const terrainMealRules = TerrainRegistry.getDefaults(terrainTag)?.mealRules ?? {};

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

                const allCards = MealPhaseHandler.buildMealContext(
                    characterIds, terrainTag, terrainMealRules,
                    this._daysSinceLastRest ?? 1, this._mealChoices ?? new Map()
                );

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
            mealTerrainNote: (() => {
                if (this._phase !== "meal") return null;
                const terrainTag = this._engine?.terrainTag ?? this._selectedTerrain ?? "forest";
                return TerrainRegistry.getDefaults(terrainTag)?.mealRules?.note ?? null;
            })(),
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

        // Build armor-aware hint (gated by Xanathar's rest rules setting)
        let armorHint = null;
        try {
            const armorRuleEnabled = game.settings.get("ionrift-respite", "armorDoffRule");
            if (armorRuleEnabled) {
                const actor = game.actors.get(selectedCharacter.id);
                const equippedArmor = actor?.items?.find(i => i.type === "equipment" && i.system?.equipped && ["medium", "heavy"].includes(i.system?.type?.value ?? i.system?.armor?.type));
                if (equippedArmor && tile.armorSleepWaiver) {
                    armorHint = { text: "Sleeping light between rotations. Armor stays on, weapon close. No HP or HD recovery penalty.", type: "positive" };
                } else if (equippedArmor && !tile.armorSleepWaiver) {
                    // Resting activities: armor sleep penalty applies
                    armorHint = { text: "Sleeping in armor. Recover only 1/4 Hit Dice, exhaustion not reduced (Xanathar's). Consider doffing first.", type: "warning" };
                }
            }
        } catch (e) { /* setting may not exist yet */ }

        const actor = game.actors.get(selectedCharacter.id);
        const armorWarning = this.getArmorWarningForActivityDetail(actor, tile);

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
            if (actor?.system?.abilities) {
                const abilities = actor.system.abilities;
                let bestKey = null;
                let bestVal = -1;
                for (const [key, data] of Object.entries(abilities)) {
                    const val = data.value ?? 0;
                    if (val > bestVal) { bestVal = val; bestKey = key; }
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
        const hasTent = items.some(n => n.includes("tent"));
        const hasMessKit = items.some(n =>
            n.includes("mess kit") || (n.includes("cook") && n.includes("utensil"))
        );
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
        const effectiveScanLevel = this._fireLevel ?? "unlit";
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
            encMod
        ) ?? null;
    }

    /**
     * Activity phase: camp comfort line for the campfire station dialog (matches Make Camp advisory).
     * @returns {{ mapComfortLabel: string, mapComfortLine: string, mapComfortTierClass: string }|null}
     */
    getCampComfortAdvisoryForStationDialog() {
        const campScanData = this._getCampScanDataForActivityStationDialog();
        if (!campScanData) return null;
        const mapComfortLabel = campScanData.campComfortLabel ?? "";
        const mapComfortLine = campScanData.comfortReason
            ? `${campScanData.terrainLabel ? `${campScanData.terrainLabel}: ` : ""}${campScanData.comfortReason}`
            : (campScanData.terrainLabel
                ? `${campScanData.terrainLabel} (${mapComfortLabel})`
                : `Camp comfort: ${mapComfortLabel}`);
        const mapComfortTierClass = campScanData.campComfort
            ? `comfort-${campScanData.campComfort}`
            : "comfort-rough";
        return { mapComfortLabel, mapComfortLine, mapComfortTierClass };
    }

    /**
     * Activity phase: Fire tab on the campfire station (tier strip, encounter hint, GM set flags).
     * @returns {object|null}
     */
    getFireTabContextForStationDialog() {
        const campScanData = this._getCampScanDataForActivityStationDialog();
        if (!campScanData) return null;

        const coldCamp = !!this._coldCampDecided;
        const effectiveScanLevel = this._fireLevel ?? "unlit";

        let campFireEncounterHint = "";
        if (effectiveScanLevel === "unlit") {
            campFireEncounterHint = "No fire is lit. The tier row shows what each level would do.";
        } else if (effectiveScanLevel === "embers") {
            campFireEncounterHint = "Embers: no change to encounter DC.";
        } else if (effectiveScanLevel === "campfire") {
            campFireEncounterHint = "Campfire: +1 encounter DC.";
        } else if (effectiveScanLevel === "bonfire") {
            campFireEncounterHint = "Bonfire: +2 encounter DC.";
        }

        const TIER_BODIES = {
            embers: "No cooking. No comfort change.",
            campfire: "Cooking and warmth. +1 encounter DC.",
            bonfire: "+1 camp comfort, full cooking. +2 encounter DC."
        };
        const COMFORT_TIERS = ["hostile", "rough", "sheltered", "safe"];
        const TIER_LABELS = Object.fromEntries(
            COMFORT_TIERS.map(k => [k, CampGearScanner.getRules(k).label])
        );
        const baseComfort = campScanData.campComfortPreFire ?? campScanData.campComfort ?? "rough";
        const baseIdx = COMFORT_TIERS.indexOf(baseComfort);
        const COMFORT_DELTA = { embers: 0, campfire: 0, bonfire: 1 };
        const curLevel = this._fireLevel ?? "unlit";
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
                costLabel: id === "embers" ? "0 firewood" : id === "campfire" ? "1 firewood" : "2 firewood",
                body: TIER_BODIES[id],
                comfortHint,
                comfortChanged: delta !== 0,
                active: isActive,
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
            campFireTabGm: !!game.user?.isGM
        };
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
                benefitLine: "+1 personal comfort, +1 Hit Die recovery when placed.",
                missingLine: "No bedroll. Comfort stays at camp level."
            }),
            slot({
                gearType: "tent",
                title: "Tent",
                icon: "fas fa-campground",
                owned: g.hasTent,
                deployed: g.tentDeployed,
                canDrag: g.canDragTent,
                benefitLine: "Weather shield and encounter protection when placed.",
                missingLine: "No tent. No weather shield."
            }),
            slot({
                gearType: "messkit",
                title: "Mess kit",
                icon: "fas fa-utensils",
                owned: g.hasMessKit,
                deployed: g.messKitDeployed,
                canDrag: g.canDragMessKit,
                benefitLine: "Advantage on exhaustion saves when the fire is lit.",
                missingLine: "No mess kit. No camp-gear advantage on exhaustion saves."
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

        return {
            personalComfort: card.personalComfort,
            personalComfortLabel: card.personalComfortLabel,
            personalMatchesCamp: !!card.personalMatchesCamp,
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

    _onRenderBindings(context, options) {
        // Re-center after content changes; dock Make Camp top-right so the map stays clear
        requestAnimationFrame(() => {
            const el = this.element;
            if (!el) return;
            const h = el.offsetHeight;
            if (this._phase === "camp") {
                const w = el.offsetWidth;
                el.classList.add("ionrift-camp-dock");
                this.setPosition({
                    top: 64,
                    left: Math.max(8, window.innerWidth - w - 16)
                });
            } else {
                el.classList.remove("ionrift-camp-dock");
                const top = Math.max(10, (window.innerHeight - h) / 2);
                this.setPosition({ top });
            }
        });

        // Bind meal drag-drop when in meal phase
        if (this._phase === "meal") {
            this._bindMealDragDrop(this.element);
        }

        // Camp: crosshair pit (GM), map notice for all clients, optional canvas panel (gear drag)
        if (this._phase === "camp") {
            if (this._isGM && !hasCampfirePlaced() && !this._campPitCursorInFlight && !this._campPitPlacementCancelled) {
                void this._startCampPitCursorFlow();
            } else if (hasCampfirePlaced() && !this._campToActivityDone && !isStationLayerActive()) {
                void this._refreshCampPitNoticeLayer();
            }
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
                        if (this._campFirePreviewLevel != null) {
                            this._campFirePreviewLevel = null;
                            if ((this._fireLevel ?? "unlit") === "unlit") {
                                this.render({ force: true });
                            }
                        }
                    }
                });
            }
            CampfireMakeCampDialog.refreshIfOpen(this);
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

        if (this._phase === "meal" || this._phase === "activity" || this._phase === "reflection") {
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

        // Rest type toggle buttons: update hidden input + hints on click
        const restTypeButtons = this.element.querySelectorAll('.rest-type-btn');
        const restTypeInput = this.element.querySelector('[name="restType"]');
        const restTypeHint = this.element.querySelector('.rest-type-hint');
        const terrainHint = this.element.querySelector('.terrain-hint');
        if (restTypeButtons.length && restTypeInput) {
            const hints = {
                long: "8 hrs. HP and Hit Dice recovery varies by comfort and conditions.",
                short: "1 hr. Spend Hit Dice to heal. Continue to pick a shelter."
            };
            const terrainHintShort = "Sets the backdrop for the rest.";
            // Cache server-rendered terrain hint for restoration
            if (terrainHint && !terrainHint.dataset.longHint) {
                terrainHint.dataset.longHint = terrainHint.textContent;
            }
            const _applyRestType = (value, rerender) => {
                const isShort = value === "short";
                restTypeInput.value = value;
                this._selectedRestType = value;
                restTypeButtons.forEach(btn => {
                    btn.classList.toggle("active", btn.dataset.restType === value);
                });
                if (restTypeHint) restTypeHint.textContent = hints[value] ?? "";
                if (terrainHint) {
                    terrainHint.textContent = isShort
                        ? terrainHintShort
                        : (terrainHint.dataset.longHint ?? terrainHint.textContent);
                }
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

        // Terrain change: update weather dropdown options
        const terrainSelect = this.element.querySelector('[name="terrain"]');
        if (terrainSelect) {
            terrainSelect.addEventListener("change", () => {
                this._selectedTerrain = terrainSelect.value;
                this.render();
            });
        }

        // Weather hint: update on dropdown change
        const weatherSelect = this.element.querySelector('[name="weather"]');
        const weatherHint = this.element.querySelector('.weather-hint');
        if (weatherSelect && weatherHint) {
            weatherSelect.addEventListener("change", () => {
                const selected = weatherSelect.options[weatherSelect.selectedIndex];
                weatherHint.textContent = selected?.title ?? "";
            });
        }

        // Live preview bar: compute effective comfort + encounter DC
        // Scouting no longer affects the preview (handled during Travel Resolution)
        const previewComfort = this.element.querySelector('#preview-comfort');
        const previewEncounter = this.element.querySelector('#preview-encounter');

        const COMFORT_TIERS = ["hostile", "rough", "sheltered", "safe"];
        const COMFORT_LABELS = { hostile: "Hostile", rough: "Rough", sheltered: "Sheltered", safe: "Safe" };

        const updatePreview = () => {
            if (!previewComfort || !previewEncounter) return;

            const baseComfort = comfortSelect?.value ?? "sheltered";
            let comfortIdx = COMFORT_TIERS.indexOf(baseComfort);
            if (comfortIdx < 0) comfortIdx = 1;

            const weatherVal = weatherSelect?.value ?? "clear";
            const weatherData = WEATHER_TABLE[weatherVal];
            if (weatherData?.comfortPenalty) comfortIdx -= weatherData.comfortPenalty;

            comfortIdx = Math.max(0, Math.min(COMFORT_TIERS.length - 1, comfortIdx));
            const effectiveComfort = COMFORT_TIERS[comfortIdx];
            previewComfort.textContent = COMFORT_LABELS[effectiveComfort];

            const comfortColors = { hostile: "#e55", rough: "#e95", sheltered: "#eb5", safe: "#5e8" };
            previewComfort.style.color = comfortColors[effectiveComfort] ?? "#fff";

            let encounterMod = weatherData?.encounterDC ?? 0;
            const sign = encounterMod >= 0 ? "+" : "";
            previewEncounter.textContent = `${sign}${encounterMod}`;
            previewEncounter.style.color = encounterMod > 0 ? "#5e8" : encounterMod < 0 ? "#e55" : "rgba(255,255,255,0.6)";

        };

        if (weatherSelect) weatherSelect.addEventListener("change", updatePreview);
        if (comfortSelect) comfortSelect.addEventListener("change", updatePreview);
        // Initial computation
        updatePreview();

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
            btn.addEventListener("click", () => {
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
                } else if (actor && this._engine) {
                    const followUpValue = this._gmFollowUps?.get(characterId) ?? this._getFollowUpForCharacter(characterId);
                    this._activityResolver.resolve(
                        activityId, actor, this._engine.terrainTag, this._engine.comfort, { followUpValue }
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

    // ──────── Static action handlers ────────

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
            this._scoutingAllowed = !!formData.scoutingAllowed;
            this._selectedScoutingValue = "none";
            this._selectedScout = this._scoutingAllowed ? "Travel Phase" : "Disabled";
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
        this._daysSinceLastRest = Math.max(1, Math.min(3, (this._daysSinceLastRest ?? 1) + delta));
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
        this._selectedScoutingValue = "none";
        this._selectedScout = "Travel Phase";
        this._scoutingAllowed = true;
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

        // Already rolled?
        if (pending.rolledCharacters?.has(characterId)) return;

        // Build roll using the actor's actual skill modifier (bypasses Midi-QoL wrapper issues)
        const skillData = actor.system?.skills?.[activityEntry.skill];
        const modifier = skillData?.total ?? 0;
        console.log(`[Respite:CampRoll] ${actor.name} rolling ${activityEntry.skillName} (${activityEntry.skill}), modifier: ${modifier}`);
        const roll = await new Roll(`1d20 + ${modifier}`).evaluate();
        const total = roll.total;
        await roll.toMessage({
            speaker: ChatMessage.getSpeaker({ actor }),
            flavor: `<strong>${actor.name}</strong> - ${activityEntry.activityName} (${activityEntry.skillName}) DC ${activityEntry.dc}`
        });

        // Disable roll button
        target.disabled = true;
        target.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Rolling...`;

        // Wait for Dice So Nice
        if (game.modules.get("dice-so-nice")?.active) {
            await new Promise(resolve => {
                const timeout = setTimeout(resolve, 5000);
                Hooks.once("diceSoNiceRollComplete", () => {
                    clearTimeout(timeout);
                    resolve();
                });
            });
        }

        // Mark as rolled locally
        if (!pending.rolledCharacters) pending.rolledCharacters = new Set();
        pending.rolledCharacters.add(characterId);

        // Send result to GM
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
                this._engine._encounterBreakdown.defenses = defenseMod;
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
                    eventTitle: triggeredEvent.title ?? "Event"
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

        // Force Pass/Fail: resolve immediately
        triggeredEvent.resolvedOutcome = outcome;

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
     * GM receives a skill check roll result from a player.
     * Collects results and auto-resolves when all expected rolls are in.
     */
    /** @deprecated Thin proxy — delegates to EventsPhaseDelegate */
    async receiveRollResult(data) {
        return this._events.receiveRollResult(data);
    }

    /**
     * Player receives a roll request from the GM.
     * Stores the request so the template can show Roll buttons for owned characters.
     */
    /** @deprecated Thin proxy — delegates to EventsPhaseDelegate */
    receiveRollRequest(data) {
        return this._events.receiveRollRequest(data);
    }

    /**
     * Player receives a tree roll request from the GM.
     * Stores the request so the template can show Roll buttons for owned characters.
     */
    /** @deprecated Thin proxy — delegates to EventsPhaseDelegate */
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

        // Track window drag — reposition flyout whenever the window moves
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

        // Roll mode selects: update state + broadcast without re-rendering (preserves scroll).
        if (game.user.isGM) {
            for (const sel of this.element.querySelectorAll(".select-roll-mode")) {
                sel.addEventListener("change", () => {
                    const characterId = sel.dataset.characterId;
                    const mode = sel.value;
                    if (!characterId || !this._activeTreeState?.awaitingRolls) return;

                    if (!this._activeTreeState.pendingRollModes) this._activeTreeState.pendingRollModes = {};
                    this._activeTreeState.pendingRollModes[characterId] = mode;

                    // Update this select's colour class in-place (no render)
                    sel.className = sel.className.replace(/roll-mode--\S+/, "") + ` roll-mode--${mode}`;

                    // Broadcast updated rollModes to players
                    emitPhaseChanged("events", {
                            triggeredEvents: this._triggeredEvents,
                            activeTreeState: this._activeTreeState,
                            eventsRolled: true,
                            campStatus: this._campStatus
                        });
                });
            }
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

        // Build roll using actor's actual skill modifier (bypasses Midi-QoL wrapper issues)
        const skillData = actor.system?.skills?.[pending.skill];
        const modifier = skillData?.total ?? 0;
        const roll = await new Roll(`1d20 + ${modifier}`).evaluate();
        const total = roll.total;
        const msg = await roll.toMessage({
            speaker: ChatMessage.getSpeaker({ actor }),
            flavor: `<strong>${actor.name}</strong> attempts ${pending.skillName} check (DC ${pending.dc})`
        });
        const rollMessageId = msg?.id ?? null;

        // Disable the button to prevent double-clicks
        target.disabled = true;
        target.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Rolling...`;

        // Wait for Dice So Nice animation to complete (if present)
        if (game.modules.get("dice-so-nice")?.active) {
            await new Promise(resolve => {
                const timeout = setTimeout(resolve, 5000); // 5s safety fallback
                Hooks.once("diceSoNiceRollComplete", () => {
                    clearTimeout(timeout);
                    resolve();
                });
            });
        }

        // Mark as rolled locally
        if (!pending.rolledCharacters) pending.rolledCharacters = new Set();
        pending.rolledCharacters.add(characterId);

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
     * Toggle expand/collapse on a resolved event card.
     */
    static #onToggleResolvedEvent(event, target) {
        const card = target.closest(".respite-event-card");
        if (card) card.classList.toggle("collapsed");
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
            const result = await ItemOutcomeHandler.grantToActor(actorId, itemRef, quantity);

            // Track the grant
            this._grantedDiscoveries.set(grantKey, result);
            ui.notifications.info(`Granted ${result.rolled}x ${result.itemName} to ${result.actorName}.`);
            this.render();
        } catch (e) {
            console.error(`[Respite] Failed to grant item:`, e);
            ui.notifications.error(`Failed to grant ${itemRef}: ${e.message}`);
        }
    }

    /**
     * Auto-grants party discovery items (event loot) to watch roster members.
     * Single watcher → all items. Multiple watchers → round-robin random distribution.
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
                        if (!this._grantedDiscoveries.has(grantKey)) {
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
                const result = await ItemOutcomeHandler.grantToActor(actorId, disc.itemRef, disc.quantity);
                this._grantedDiscoveries.set(disc.grantKey, result);
                console.log(`${MODULE_ID} | Auto-granted ${result.rolled}x ${result.itemName} to ${result.actorName}`);
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

        // Apply comfort floor override from shelters (Tiny Hut, Mansion)
        let effectiveComfort = this._selectedComfort ?? formData.comfort ?? "sheltered";
        if (shelterComfortFloor && (COMFORT_RANK[shelterComfortFloor] ?? 0) > (COMFORT_RANK[effectiveComfort] ?? 0)) {
            effectiveComfort = shelterComfortFloor;
        }

        // Scouting is now resolved during Travel Resolution phase.
        // Comfort/encounter adjustments are applied post-travel via _applyScoutingFromTravel().

        // Weather penalty: reduce comfort unless shelter cancels
        const weather = this._selectedWeather ?? formData.weather ?? "clear";
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
        this._engine = new RestFlowEngine({
            restType: formData.restType ?? "long",
            terrainTag,
            comfort: effectiveComfort
        });
        this._engine.shelterEncounterMod = shelterEncounterMod + weatherEncounterMod;
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

        const restPayload = {
            restId: `rest_${Date.now()}`,
            terrainTag: this._engine.terrainTag,
            comfort: this._engine.comfort,
            restType: this._engine.restType,
            activities: this._activities ?? [],
            recipes: Object.fromEntries(this._craftingEngine.recipes)
        };

        setActiveRestData(restPayload);

        emitRestStarted(restPayload);

        ui.notifications.info("Rest phase started. Activity pickers sent to all players.");

        // Long rests always show the Travel Resolution phase so the GM
        // understands why activities are or aren't available in this terrain.
        if (this._engine.restType === "long") {
            this._phase = "travel";
            this._travel.setTotalDays(this._daysSinceLastRest ?? 1);
            this._travel.scoutingAllowed = this._scoutingAllowed ?? true;

            setTimeout(() => {
                emitPhaseChanged("travel", {
                        selectedTerrain: this._selectedTerrain ?? "forest",
                        travelDays: this._travel.totalDays,
                        scoutingAllowed: this._travel.scoutingAllowed
                    });
                this._broadcastTravelDeclarations();
            }, 200);
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

        // Strip Well Fed effects from the prior rest — the effect persists
        // between sessions but expires when a new long rest begins.
        await MealPhaseHandler.cleanupWellFedEffects(getPartyActors());
        await this._saveRestState();

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

        // Block re-crafting for locked characters
        if (this._lockedCharacters?.has(characterId)) {
            ui.notifications.warn("This character has already submitted their activity.");
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
                // Completion callback — commit the crafting result
                app._craftingInProgress?.delete(characterId);
                if (!result) {
                    // Crafting cancelled or no result — re-enable selection
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
            terrainTag
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

        // Armor sleep penalty confirmation (gated by Xanathar's setting)
        if (!this._armorConfirmed) {
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
     * Status id for “asleep for the night” (Foundry / system CONFIG).
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
     * Clear Incapacitated + Prone from the whole party before events.
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
                console.log(`[Respite:Meal] Auto-process consumption results:`, mealResults);
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
                    const conMod = actor.system?.abilities?.con?.mod ?? 0;
                    const profBonus = actor.system?.abilities?.con?.save
                        ? (actor.system?.attributes?.prof ?? 0) : 0;
                    const roll = await new Roll(`1d20 + ${conMod} + ${profBonus}`).evaluate();
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
        this._tearDownStationLayerCanvas();
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

            if (trackFood && (terrainMealRules.waterPerDay > 0 || terrainMealRules.foodPerDay > 0)) {
                this._mealChoices = this._mealChoices ?? new Map();
                this._daysSinceLastRest = this._daysSinceLastRest ?? 1;
                await this._autoProcessRations();
            }
            this._phase = "reflection";
            await this._applyBeddingDown();
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
            console.log(`${MODULE_ID} | Campfire drawer skipped: magical shelter active`);
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
        const hadLegacyEmbed = !!this._campfireApp;
        if (this._campfireApp) {
            this._campfireApp.destroy();
            this._campfireApp = null;
        }
        const drawerContent = this.element?.querySelector(".campfire-drawer-content");
        if (drawerContent) drawerContent.innerHTML = "";
        const drawer = this.element?.querySelector(".campfire-drawer");
        if (drawer) drawer.classList.remove("open");

        if (hadLegacyEmbed) {
            CampfireTokenLinker.setLightState(false);
        }
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

    // ── Meal Phase Handlers ──────────────────────────────────────

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
                // Fill first empty slot
                const emptyIdx = arr.findIndex(v => !v || v === "skip");
                if (emptyIdx >= 0) {
                    arr[emptyIdx] = itemId;
                } else {
                    arr.push(itemId);
                }
            }
            this._mealChoices.set(charId, { ...existing, [slot]: arr });
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
                setChoice(charId, slot, itemId);
            });
        }

        // Drop zones (plates and goblets)
        for (const zone of dropZones) {
            if (zone._mealBound) continue;
            zone._mealBound = true;
            const slot = zone.dataset.slot;
            const charId = zone.dataset.characterId;
            const slotIndex = zone.dataset.slotIndex !== undefined ? parseInt(zone.dataset.slotIndex) : undefined;

            zone.addEventListener("dragover", (e) => {
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
                const raw = e.dataTransfer.getData("text/plain");
                if (!raw?.startsWith("meal:")) return;

                const [, dragSlot, itemId, dragCharId] = raw.split(":");
                if (dragSlot !== slot || dragCharId !== charId) return;
                setChoice(charId, slot, itemId, slotIndex);
            });

            // Click on filled zone = clear it
            zone.addEventListener("click", () => {
                if (!this._mealChoices) return;
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
     * Meal: Player submits their meal choices via socket to the GM.
     */
    static async #onSubmitMealChoices(event, target) { await this._meals.onSubmitMealChoices(event, target); }

    /**
     * GM receives meal choices from a player via socket.
     * Merges into _mealChoices and tracks submission status.
     */
    receiveMealChoices(userId, choices) {
        void this._meals.receiveMealChoices(userId, choices).catch(err => {
            console.warn(`${MODULE_ID} | receiveMealChoices`, err);
        });
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
     * Phase 3 (reflection) -> 4 (events): GM moves past campfire to the night.
     * Applies fire level comfort modifications before events.
     */
    static async #onProceedToEvents(event, target) {
        await this._removeBeddingDown();

        // Restore default window size and center on screen so the full events
        // header is visible regardless of how the user moved the window.
        const defaultWidth = RestSetupApp.DEFAULT_OPTIONS.position?.width ?? 720;
        this.setPosition({
            width: defaultWidth,
            left: Math.max(8, Math.round((window.innerWidth - defaultWidth) / 2))
        });

        // Apply fire level comfort modifications
        // Unlit: -1 comfort step | Embers: 0 | Campfire: 0 | Bonfire: +1 camp comfort
        const FIRE_COMFORT_MOD = { unlit: -1, embers: 0, campfire: 0, bonfire: 1 };
        const fireComfortMod = FIRE_COMFORT_MOD[this._fireLevel] ?? 0;
        if (fireComfortMod !== 0 && this._engine) {
            const comfortRank = COMFORT_RANK;
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
        console.log(`[Respite:State] #onProceedToEvents — eventsRolled reset to false`);
        this._phase = "events";

        // ── Camp Preparations: identify camp activities needing pre-event rolls ──
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
        console.log(`[Respite:State] #onRollEvents — eventsRolled set to true, events=${this._triggeredEvents?.length ?? 0}`);

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
            // Ensure stallPenalty is present
            if (treeEvent.mechanical?.stallPenalty) {
                this._activeTreeState.stallPenalty = treeEvent.mechanical.stallPenalty;
                this._activeTreeState.hasStallPenalty = true;
                this._activeTreeState.stalled = false;
            }
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
     * GM acknowledges an encounter event and begins combat.
     * Sets awaitingCombat flag, saves state, and closes the rest window
     * so the GM can set up the fight. The GM indicator bar will appear.
     */
    static async #onAcknowledgeEncounter(event, target) {
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

        // Enter pending-roll state — but do NOT dispatch to players yet
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

        // Broadcast roll request to players
        emitTreeRollRequest({
                    choiceId: this._activeTreeState.pendingChoice,
                    skills: this._activeTreeState.pendingCheck?.skills ?? [],
                    skillName: this._activeTreeState.pendingSkillName ?? "Skill",
                    dc: this._activeTreeState.pendingDC ?? 12,
                    targets: this._activeTreeState.pendingRolls ?? [],
                    eventName: this._activeTreeState.eventName,
                    rollModes: this._activeTreeState.pendingRollModes ?? {}
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
    /** @deprecated Thin proxy — delegates to EventsPhaseDelegate */
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

        emitTreeRollRequest({
                    choiceId: this._activeTreeState.pendingChoice,
                    skills: this._activeTreeState.pendingCheck?.skills ?? [],
                    skillName: this._activeTreeState.pendingSkillName ?? "Skill",
                    dc: this._activeTreeState.pendingDC ?? 12,
                    targets: this._activeTreeState.pendingRolls ?? [],
                    eventName: this._activeTreeState.eventName,
                    rollModes: this._activeTreeState.pendingRollModes ?? {}
                });

        ui.notifications.info("Tree roll request re-sent to players.");
    }

    /**
     * GM cycles the roll mode for a specific character in the pending tree roll.
     * Order: normal → advantage → disadvantage → force-pass → force-fail → normal
     * Broadcasts updated tree state so player badges update immediately.
     */
    static #onCycleTreeRollMode(event, target) {
        event.preventDefault?.();
        if (!game.user.isGM) return;
        const characterId = target.dataset.characterId;
        if (!characterId || !this._activeTreeState?.awaitingRolls) return;

        if (!this._activeTreeState.pendingRollModes) this._activeTreeState.pendingRollModes = {};
        const CYCLE = { "normal": "advantage", "advantage": "disadvantage", "disadvantage": "force-pass", "force-pass": "force-fail", "force-fail": "normal" };
        const current = this._activeTreeState.pendingRollModes[characterId] ?? "normal";
        this._activeTreeState.pendingRollModes[characterId] = CYCLE[current] ?? "normal";

        // Push updated rollModes to players so their badge refreshes live
        emitPhaseChanged("events", {
                triggeredEvents: this._triggeredEvents,
                activeTreeState: this._activeTreeState,
                eventsRolled: true,
                campStatus: this._campStatus
            });

        this.render();
    }

    /**
     * GM rolls an event check on behalf of an unresponsive player.
     */
    static async #onRollEventForPlayer(event, target) {
        if (!game.user.isGM) return;
        const characterId = target.dataset.characterId;
        const eventIndex = parseInt(target.dataset.eventIndex);
        const triggeredEvent = this._triggeredEvents?.[eventIndex];
        if (!triggeredEvent?.awaitingRolls || !characterId) return;

        const actor = game.actors.get(characterId);
        if (!actor) return;

        const skill = triggeredEvent.mechanical?.skill ?? "sur";
        const dc = triggeredEvent.mechanical?.dc ?? 10;
        const skillName = SKILL_DISPLAY_NAMES[skill] ?? skill;
        const context = `${triggeredEvent.name ?? "Event"} (${skillName})`;

        const result = await rollForPlayer(actor, [skill], dc, context);

        // Feed through the normal collection path
        await this.receiveRollResult({
            eventIndex,
            characterId,
            characterName: actor.name,
            total: result.total
        });
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

        // ── Supplies ──
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
                    rangeLabel: `${entry.currentQty} → ${remaining}`
                });
            }
        }

        // ── Items at Risk ──
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
                    rangeLabel: candidate.currentQty > 1 ? `${candidate.currentQty} → ${remaining}` : "removed"
                });
            }
        }

        // ── Gold ──
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
                    rangeLabel: `${entry.currentGp} → ${remaining} gp`
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
     * Phase 3 -> 4: Resolve rest outcomes.
     * Injects stored crafting results into activity outcomes.
     */
    static async #onResolveEvents(event, target) {
        // Collect ALL resource-loss effects from resolved tree and stall penalties
        const allEffects = [];
        for (const evt of (this._triggeredEvents ?? [])) {
            if (!evt.effects) continue;
            for (const eff of evt.effects) {
                if (["supply_loss", "item_at_risk", "consume_gold"].includes(eff.type)) {
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
                    unified.supplyProposals.push(await ResourceSink.proposeSupplyLoss(eff, context));
                } else if (eff.type === "item_at_risk") {
                    unified.itemAtRiskProposals.push(await ResourceSink._resolveItemAtRisk(eff, context));
                } else if (eff.type === "consume_gold") {
                    unified.goldProposals.push(await ResourceSink.proposeGoldLoss(eff, context));
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
        // but first collect any condition effects (exhaustion) from the tree
        const conditionEffects = [];
        for (const evt of (this._triggeredEvents ?? [])) {
            if (!evt.effects) continue;
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

        // Apply disaster exhaustion to actors and track per-actor gains
        const disasterExhaustion = new Map(); // actorId -> total levels gained
        if (conditionEffects.length > 0) {
            const characters = getPartyActors();
            const adapter = game.ionrift?.respite?.adapter;
            for (const eff of conditionEffects) {
                const level = eff.level ?? 1;
                const scope = eff.scope ?? "all";
                let targets;
                if (scope === "all") {
                    targets = characters;
                } else if (scope === "random") {
                    targets = [characters[Math.floor(Math.random() * characters.length)]];
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
                }
            }
        }

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
                            console.log(`${MODULE_ID} | Auto re-equipped ${item.name} on ${actor.name}`);

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

        // Trigger DnD5e native rest for spell slots, class features, item uses.
        // HP/HD/Exhaustion already handled by RecoveryHandler above;
        // the preRestCompleted hook in module.js suppresses those from the
        // system's own recovery so there is no double-dipping.
        // When rest-recovery module is active it handles everything, so we skip.
        // PF2e has no actor.longRest() — skip for non-5e systems.
        if (!skipRecovery && game.system.id === "dnd5e") {
            const restType = this._engine?.restType ?? "long";
            for (const outcome of this._outcomes) {
                const actor = game.actors.get(outcome.characterId);
                if (!actor) continue;
                try {
                    if (restType === "long") {
                        await actor.longRest({ dialog: false, chat: false, advanceTime: false });
                    } else {
                        await actor.shortRest({ dialog: false, chat: false, advanceTime: false });
                    }
                    console.log(`${MODULE_ID} | Native ${restType} rest applied for ${actor.name} (spell slots, features, item uses).`);
                } catch (e) {
                    console.warn(`${MODULE_ID} | Native rest failed for ${actor.name}:`, e);
                }
            }
        } else if (!skipRecovery && game.system.id !== "dnd5e") {
            console.log(`${MODULE_ID} | Skipping native rest call (system: ${game.system.id} — no longRest/shortRest API).`);
        }

        // Stamp Well Fed AEs with longRest specialDuration now that native rest has run.
        // Eating happens before recovery, so the flag is intentionally omitted at AE
        // creation to prevent dnd5e from stripping the buff during longRest(). Adding
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

        // Auto-grant party discoveries (event loot) to watch roster members
        try {
            await this._autoGrantPartyDiscoveries();
        } catch (e) {
            console.warn(`${MODULE_ID} | Auto-grant party discoveries failed:`, e);
        }

        // Post condition advisory for any unhandled condition/temp_hp effects
        try {
            await ConditionAdvisory.processAll(this._outcomes);
        } catch (e) {
            console.warn(`${MODULE_ID} | Condition advisory failed:`, e);
        }

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
                }
                if (recovery.comfortLevel === "hostile") {
                    lines.push(`<p style="font-size:0.85em;color:#f9d77e;"><i class="fas fa-skull"></i> Hostile conditions prevent natural exhaustion recovery</p>`);
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
        if (this._grantedDiscoveries && this._outcomes?.length) {
            const seenEvents = new Set();
            let ungrantedCount = 0;
            for (const o of this._outcomes) {
                for (const sub of (o.outcomes ?? [])) {
                    if (sub.source === "event" && sub.items?.length && !seenEvents.has(sub.eventId)) {
                        seenEvents.add(sub.eventId);
                        for (const item of sub.items) {
                            const key = `${sub.eventId}:${item.itemRef ?? item.name}`;
                            if (!this._grantedDiscoveries.has(key)) ungrantedCount++;
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

    // ──────── Instance methods ────────

    /**
     * Receives player-submitted choices from the socket handler.
     */
    receivePlayerChoices(userId, choices, craftingResults = null, followUps = null, earlyResults = null) {
        Logger.log(`[SYNC] receivePlayerChoices: userId=${userId}, choiceKeys=${Object.keys(choices ?? {}).join(",") || "none"}`, choices);
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
                if (result) this._craftingResults.set(charId, result);
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

        // Block act_attune if already at max attunement slots
        if (activityId === "act_attune") {
            const actor = game.actors.get(characterId);
            const attuneSlots = actor?.system?.attributes?.attunement;
            if (attuneSlots) {
                const current = attuneSlots.value ?? 0;
                const max = attuneSlots.max ?? 3;
                if (current >= max) {
                    ui.notifications.warn(`${actor.name} is already attuned to the maximum number of items (${max}).`);
                    return null;
                }
            }
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
        } else if (actor && this._engine) {
            const followUpValue = options.followUpValue ?? this._gmFollowUps?.get(characterId) ?? this._getFollowUpForCharacter(characterId);
            activityResult = await this._activityResolver.resolve(
                activityId, actor, this._engine.terrainTag, this._engine.comfort, { followUpValue }
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
            if (fu != null) followUps[cid] = fu;
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
            // Do NOT force-open the window — the player chose from the canvas and
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
     * workbench Identify (when the party has unidentified items) and meal rations on the
     * cooking or campfire station when that actor still owes rations. Campfire notice stays
     * non-faded during the activity phase.
     * Cooking station stays bright while any unchosen party member owes activity-phase rations (meal tab).
     * In single-character mode, meal stations stay bright while that actor still owes rations.
     * Workbench stays bright when the party has unidentified gear (Identify tab on the station dialog),
     * including after a major activity is already committed.
     * @returns {Record<string, boolean>}
     */
    _buildStationEmptyNoticeMap() {
        const map = {};
        const partyActors = getPartyActors();
        if (!this._activityResolver) return map;

        const restType = this._engine?.restType ?? "long";
        const isFireLit = !!(this._fireLevel && this._fireLevel !== "unlit");
        const choices = this._characterChoices;
        const unchosen = partyActors.filter(a => a?.id && !choices?.has(a.id));
        // eslint-disable-next-line no-console
        console.debug(`${MODULE_ID} | [SYNC-BISECT] _buildStationEmptyNoticeMap: resolverSize=${this._activityResolver?.activities?.size ?? 0}, partyCount=${partyActors.length}, unchosenCount=${unchosen.length}, choicesSize=${choices?.size ?? 0}, restType=${restType}, isFireLit=${isFireLit}, isGM=${this._isGM}`);

        let identifyParty = { unidentifiedItems: [], identifyCasters: [], detectMagicCasters: [] };
        try {
            identifyParty = collectPartyIdentifyEmbedData(partyActors);
        } catch (err) {
            console.warn(`${MODULE_ID} | _buildStationEmptyNoticeMap: collectPartyIdentifyEmbedData failed`, err);
        }
        const workbenchIdentifyBright = (identifyParty.unidentifiedItems?.length ?? 0) > 0;

        // For GM: any unchosen party member who owes rations keeps the cooking station bright.
        // For players: only the viewer's own actor matters — other players' ration debts are
        // opaque to this client and must not hold the station bright after the viewer has eaten.
        // Bug history: before this fix, mealBrightParty evaluated ALL unchosen actors,
        // keeping the cooking station bright on the submitting player's client because the
        // other players hadn't submitted yet — even when this player had no remaining ration debt.
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
            `[station-fade] mealBrightParty=${mealBrightParty}`,
            `viewer=${viewer?.name ?? "none"}`,
            `isGM=${this._isGM}`,
            `unchosenCount=${unchosen.length}`
        );

        const hasAvailableAtStation = (actor, stationIdSet) => {
            const { available: allAvail } = this._activityResolver.getAvailableActivitiesWithFaded(
                actor, restType, { isFireLit }
            );
            return allAvail.some(a => stationIdSet.has(a.id));
        };

        if (viewer && this._characterChoices.has(viewer.id)) {
            for (const station of CAMP_STATIONS) {
                if (!station.furnitureKey) continue;
                if (station.id === "workbench" && workbenchIdentifyBright) {
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
            if (this._phase === "activity") map.campfire = false;
            return map;
        }

        for (const station of CAMP_STATIONS) {
            if (!station.furnitureKey) continue;
            const stationIds = new Set(station.activities ?? []);

            const hasAny = unchosen.some(a => hasAvailableAtStation(a, stationIds));
            let empty = !hasAny;
            if (empty && mealBrightParty && station.id === "cooking_station") {
                empty = false;
            }
            if (empty && station.id === "workbench" && workbenchIdentifyBright) {
                empty = false;
            }
            map[station.id] = empty;
        }

        const bedrollStation = CAMP_STATIONS.find(s => s.id === "bedroll");
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
        // eslint-disable-next-line no-console
        console.debug(`${MODULE_ID} | [SYNC-BISECT] _activateCanvasStationLayer: resolverSize=${this._activityResolver?.activities?.size ?? 0}, phase=${this._phase}, isGM=${this._isGM}`);

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
            const station = CAMP_STATIONS.find(s => s.id === stationId);
            if (!station) return;

            if (stationId === "bedroll") {
                const bedrollOwnerActorId = token?.document?.flags?.[MODULE_ID]?.ownerActorId;
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

            console.log(`${MODULE_ID} | Station overlay click`, { stationId, actorId: actor.id, tokenId: token?.id });
            app._canvasFocusedStationId = stationId;
            app._activitySubTab = "activity";

            const dialogStation = stationId === "bedroll"
                ? { ...station, label: `${actor.name}'s Bedroll` }
                : station;

            try {
                const restType = restSession.restType ?? "long";
                const isFireLit = !!(this._fireLevel && this._fireLevel !== "unlit");
                const resolverLoaded = !!(app._activityResolver?.activities?.size);
                const resolvedAvail = resolverLoaded
                    ? app._activityResolver.getAvailableActivitiesWithFaded(actor, restType, { isFireLit })
                    : { available: [], faded: [] };
                const stationActIds = new Set(station.activities ?? []);
                await StationActivityDialog.openForStation(
                    dialogStation, actor, app._activityResolver, restSession, token, app, stationId
                );
            } catch (e) {
                console.warn(`${MODULE_ID} | Station activity dialog`, e);
            }
        }, { ...proximityOpts, stationEmptyNoticeFade });

        this._installGmStationTokenSyncHook();
        this._refreshStationOverlayMeals();

        // On resume (or re-activate), apply portraits and empty-notice fade for
        // characters that already committed before the layer was torn down.
        if (this._characterChoices?.size) {
            refreshStationPortraitsFromChoices(this._characterChoices, this._stationCanvasIdByCharacter);
            refreshStationEmptyNoticeFade(this);
        }
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
        // Players don't have a RestFlowEngine — derive terrainTag from snapshot state instead.
        const terrainTag = this._engine?.terrainTag ?? this._selectedTerrain ?? "forest";
        const terrainMealRules = TerrainRegistry.getDefaults(terrainTag)?.mealRules ?? {};
        const cards = MealPhaseHandler.buildMealContext(
            [actorId],
            terrainTag,
            terrainMealRules,
            this._daysSinceLastRest ?? 1,
            this._mealChoices ?? new Map()
        );
        const card = cards[0] ?? null;
        if (!card) return null;
        if (this._activityMealRationsSubmitted?.has(actorId)) card.playerSubmitted = true;
        if (!this._isGM && this._mealSubmitted && this._myCharacterIds?.has(actorId)) {
            card.playerSubmitted = true;
        }
        return card;
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
            const waterEmpty = waterArr.filter(v => !v || v === "skip").length;
            if (waterArr.length === 0 || waterEmpty > 0) {
                skippedSlots.push(
                    waterArr.length === 0
                        ? `${actor.name}: no water`
                        : `${actor.name}: ${waterEmpty} water slot${waterEmpty > 1 ? "s" : ""} empty`
                );
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
        await this._meals.onSubmitMealChoices(null, null);
        // Track ration submission locally so the rejoin bar updates immediately
        if (!this._activityMealRationsSubmitted) this._activityMealRationsSubmitted = new Set();
        this._activityMealRationsSubmitted.add(actorId);
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
        Logger.log(`[SYNC] getRestSnapshot: characterChoices=${this._characterChoices.size}, submissionKeys=${Object.keys(submissions).join(",") || "none"}`, Object.values(submissions)[0] ?? "(empty)");

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
            // Include the activity list so late-joining players can load their resolver.
            activities: this._activities ?? []
        };
    }

    // ──────── Player-mode socket receivers ────────

    /**
     * Receives a phase change from the GM and re-renders.
     */
    async receivePhaseChange(phase, phaseData = {}) {
        const prevPhase = this._phase;
        this._phase = phase;
        if (phaseData.triggeredEvents) {
            this._triggeredEvents = this._isGM ? phaseData.triggeredEvents
                : phaseData.triggeredEvents.map(e => ({ ...e, name: undefined, narrative: undefined }));
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
        if (phaseData.coldCampDecided !== undefined) this._coldCampDecided = !!phaseData.coldCampDecided;
        if (phaseData.campStep2Entered) this._campStep2Entered = true;
        if (phaseData.campStatus) this._campStatus = phaseData.campStatus;
        if (phaseData.outcomes) this._outcomes = phaseData.outcomes;

        // Travel metadata
        if (phaseData.travelDays != null) this._travelTotalDays = phaseData.travelDays;
        if (phaseData.scoutingAllowed != null) this._travelScoutingAllowed = phaseData.scoutingAllowed;
        if (phaseData.activeDay != null) this._travelActiveDay = phaseData.activeDay;
        if (phaseData.fullyResolved) this._travelFullyResolved = true;
        if (phaseData.scoutingDone) this._travelScoutingDone = true;

        // Travel roll requests from GM
        if (phaseData.travelRollRequest) {
            this._pendingTravelRoll = {
                activities: phaseData.travelRollRequest.activities ?? [],
                rolledCharacters: this._pendingTravelRoll?.rolledCharacters ?? new Set()
            };
        }
        if (phaseData.travelRollUpdate) {
            if (this._pendingTravelRoll) {
                if (!this._pendingTravelRoll.rolledCharacters) this._pendingTravelRoll.rolledCharacters = new Set();
                this._pendingTravelRoll.rolledCharacters.add(phaseData.travelRollUpdate.actorId);
            }
        }
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
        if (phase === "reflection") {
            this._openCampfire();
        } else {
            this._closeCampfire();
        }

        // Activity phase: canvas station overlays for all clients; players minimise to the rest bar
        if (phase === "activity") {
            if (!this._isGM) {
                _removeGmRestIndicator();
            }
            this._attachActivityPhaseCanvasChrome();
            if (!this._isGM) {
                console.log(`${MODULE_ID} | Activity phase (player): minimise rest window, retain app for station sockets`);
                await this.close({ retainPlayerApp: true });
                return;
            }
        } else if (prevPhase === "activity" && phase !== "activity") {
            this._tearDownStationLayerCanvas();
            // Player was minimised during activity phase — auto-open the RSA so they
            // see the current rest phase (events, meal, reflection, etc.)
            if (!this._isGM) {
                _removeRejoinBar();
                console.log(`${MODULE_ID} | Phase ${prevPhase}→${phase} (player): removing rejoin bar, auto-opening RSA`);
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
        this.render({ force: true });

        // Safety net: if the player RSA is not rendered after the phase transition
        // (e.g., the app was retained-but-closed during activity phase and render()
        // didn't produce a visible window), ensure the rejoin bar is visible so the
        // player can see the current phase and resume the rest UI.
        if (!this._isGM) {
            setTimeout(() => {
                if (!this.rendered) {
                    console.log(`${MODULE_ID} | Phase ${phase}: player RSA not rendered after 300ms — ensuring rejoin bar`);
                    _ensureRejoinBar(this);
                }
            }, 300);
        }
    }

    /**
     * Receives updated submission statuses from the GM.
     */
    receiveSubmissionUpdate(submissions) {
        if (!submissions || typeof submissions !== "object") {
            Logger.warn("[receiveSubmissionUpdate] received null/undefined submissions — ignored.");
            return;
        }
        Logger.log(`[SYNC] receiveSubmissionUpdate: keys=${Object.keys(submissions).join(",") || "none"}`, Object.values(submissions)[0] ?? "(empty)");
        // Store submission status for display (non-owned characters).
        this._submissionStatus = submissions;

        // Apply the GM's canonical choices directly to _characterChoices.
        // Do NOT write into _playerSubmissions — that map is keyed by userId,
        // and writing charId-keyed entries here corrupts the schema and crashes
        // _getPlayerChoiceForCharacter when it accesses submission.choices.
        for (const [charId, info] of Object.entries(submissions)) {
            if (info?.activityId) {
                this._characterChoices.set(charId, info.activityId);
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
        // eslint-disable-next-line no-console
        console.debug(`${MODULE_ID} | [REJOIN] receiveRestSnapshot: phase=${snapshot.phase}, submissionKeys=${Object.keys(snapshot.submissions ?? {}).join(",") || "none"}, choices=${this._characterChoices?.size ?? 0}`);
        // Apply submissions
        if (snapshot.submissions) {
            // Apply canonical choices directly to _characterChoices.
            // Do NOT write into _playerSubmissions — that map is keyed by userId.
            // Writing charId-keyed entries here corrupts the schema and crashes render.
            for (const [charId, info] of Object.entries(snapshot.submissions)) {
                const actId = info?.activityId ?? info?.activityName;
                if (actId) this._characterChoices.set(charId, actId);
            }
            // eslint-disable-next-line no-console
            console.debug(`${MODULE_ID} | [REJOIN] receiveRestSnapshot: choices after apply=${this._characterChoices?.size ?? 0}`);
        }

        if (snapshot.afkCharacters !== undefined) {
            RestAfkState.replaceAll(snapshot.afkCharacters ?? []);
        }

        // Apply phase + phase data
        if (snapshot.phase) {
            this._phase = snapshot.phase;
        }
        if (snapshot.triggeredEvents) {
            this._triggeredEvents = this._isGM ? snapshot.triggeredEvents
                : snapshot.triggeredEvents.map(e => ({ ...e, name: undefined, narrative: undefined }));
        }
        if (snapshot.activeTreeState) {
            this._activeTreeState = snapshot.activeTreeState;
            // Reconstruct player-side tree roll request from tree state
            if (!this._isGM && snapshot.activeTreeState.awaitingRolls) {
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
        if (snapshot.fireLitBy !== undefined) this._fireLitBy = snapshot.fireLitBy ?? null;
        if (snapshot.firewoodPledges !== undefined) {
            this._firewoodPledges = new Map(snapshot.firewoodPledges ?? []);
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
        const _resolverSizeBefore = this._activityResolver?.activities?.size ?? 0;
        // eslint-disable-next-line no-console
        console.debug(`${MODULE_ID} | [SYNC-BISECT] receiveRestSnapshot: resolverSize=${_resolverSizeBefore}, snapshotActivities=${snapshot.activities?.length ?? 0}, phase=${this._phase}, isGM=${this._isGM}`);
        if (Array.isArray(snapshot.activities) && snapshot.activities.length > 0
            && !(this._activityResolver?.activities?.size)) {
            this._activities = snapshot.activities;
            this._activityResolver.load(this._activities);
            // eslint-disable-next-line no-console
            console.debug(`${MODULE_ID} | [SYNC-BISECT] receiveRestSnapshot: resolver hydrated from snapshot (${this._activityResolver.activities.size} activities)`);
        } else {
            // eslint-disable-next-line no-console
            console.debug(`${MODULE_ID} | [SYNC-BISECT] receiveRestSnapshot: resolver NOT hydrated — resolverSize=${_resolverSizeBefore}, snapshotActivities=${snapshot.activities?.length ?? 0}`);
        }

        if (this._phase === "activity" && isStationLayerActive()) {
            refreshStationPortraitsFromChoices(this._characterChoices, this._stationCanvasIdByCharacter);
            refreshStationEmptyNoticeFade(this);
            this._refreshStationOverlayMeals();
        }

        // Campfire panel lifecycle on snapshot restore
        if (this._phase === "reflection") {
            this._openCampfire();
        } else {
            this._closeCampfire();
        }

        // Activity phase: same as receivePhaseChange (F5 rejoin after GM already advanced)
        if (this._phase === "activity" && !this._isGM) {
            // eslint-disable-next-line no-console
            console.debug(`${MODULE_ID} | [REJOIN] receiveRestSnapshot: activity phase → retain close, choices=${this._characterChoices?.size ?? 0}`);
            this._attachActivityPhaseCanvasChrome();
            void this.close({ retainPlayerApp: true });
            return;
        }
        if (this._phase === "activity" && this._isGM) {
            this._attachActivityPhaseCanvasChrome();
            this._gmMinimizedToFooter = true;
            _showGmRestIndicator(this);
            if (this.rendered) {
                void this.close({});
            }
            return;
        }

        // Single render with all state applied
        this.render();

        // Safety net: ensure rejoin bar if player RSA fails to render.
        // ApplicationV2 render is async, so use a 300ms timeout instead of rAF
        // to give the pipeline time to finish.
        if (!this._isGM) {
            setTimeout(() => {
                if (!this.rendered) {
                    console.log(`${MODULE_ID} | receiveRestSnapshot: player RSA not rendered after 300ms — ensuring rejoin bar`);
                    _ensureRejoinBar(this);
                }
            }, 300);
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

    // ═══════════════════════════════════════════════════════════════
    //  TRAVEL RESOLUTION PHASE
    // ═══════════════════════════════════════════════════════════════

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
        const actorId = target.dataset.actorId;
        const day = parseInt(target.dataset.day) || 1;
        if (!actorId) return;

        const actor = game.actors.get(actorId);
        if (!actor || !actor.isOwner) return;

        const pending = this._pendingTravelRoll;
        if (!pending) return;
        const entry = pending.activities?.find(a => a.actorId === actorId);
        if (!entry) return;
        if (pending.rolledCharacters?.has(actorId)) return;

        let modifier, flavor;
        if (entry.activity === "scout") {
            const prc = actor.system?.skills?.prc?.total ?? 0;
            const sur = actor.system?.skills?.sur?.total ?? 0;
            modifier = Math.max(prc, sur);
            const skillLabel = prc >= sur ? "Perception" : "Survival";
            flavor = `<strong>${actor.name}</strong> - Scout (${skillLabel})`;
        } else if (entry.activity === "other") {
            const skillKey = entry.skill ?? "sur";
            modifier = actor.system?.skills?.[skillKey]?.total ?? 0;
            flavor = `<strong>${actor.name}</strong> - ${entry.skillName ?? "Survival"} DC ${entry.dc}`;
        } else {
            const surData = actor.system?.skills?.sur?.total ?? 0;
            const natData = actor.system?.skills?.nat?.total ?? 0;
            modifier = Math.max(surData, natData);
            const actLabel = entry.activity === "forage" ? "Forage" : "Hunt";
            flavor = `<strong>${actor.name}</strong> - ${actLabel} (Survival) DC ${entry.dc}`;
        }

        const roll = await new Roll(`1d20 + ${modifier}`).evaluate();
        await roll.toMessage({
            speaker: ChatMessage.getSpeaker({ actor }),
            flavor
        });

        target.disabled = true;
        target.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Rolling...`;

        if (game.modules.get("dice-so-nice")?.active) {
            await new Promise(resolve => {
                const timeout = setTimeout(resolve, 5000);
                Hooks.once("diceSoNiceRollComplete", () => {
                    clearTimeout(timeout);
                    resolve();
                });
            });
        }

        if (!pending.rolledCharacters) pending.rolledCharacters = new Set();
        pending.rolledCharacters.add(actorId);

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
        if (activity === "scout") {
            const prc = actor.system?.skills?.prc?.total ?? 0;
            const sur = actor.system?.skills?.sur?.total ?? 0;
            modifier = Math.max(prc, sur);
            const skillLabel = prc >= sur ? "Perception" : "Survival";
            flavor = `<strong>${actor.name}</strong> - Scout (${skillLabel})`;
        } else {
            const sur = actor.system?.skills?.sur?.total ?? 0;
            const nat = actor.system?.skills?.nat?.total ?? 0;
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
        this._travel.receiveRollResult(data.actorId, data.total, day, data.natD20 ?? null);

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
                    result: row
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
            const COMFORT_RANK = { rough: 0, sheltered: 1, comfortable: 2, luxurious: 3 };
            const RANK_TO_KEY = ["rough", "sheltered", "comfortable", "luxurious"];
            let rank = COMFORT_RANK[this._engine.comfort] ?? 1;
            rank = Math.min(3, rank + effects.comfortBonus);
            this._engine.comfort = RANK_TO_KEY[rank];
        }
    }

    // ──────── Make Camp Phase Handlers ────────────────────────

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
        const actorId = root?.dataset?.actorId;
        const method = root?.dataset?.method ?? "Tinderbox";
        if (!actorId) return;
        if (!game.user.isGM) {
            emitCampLightFire(game.user.id, actorId, method);
            return;
        }
        await this._campCeremony.lightFire(game.user.id, actorId, method);
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

        if (!game.user.isGM) {
            emitCampFireLevelRequest({
                    userId: game.user.id,
                    fireLevel: level
                });
            ui.notifications.info("Fire choice sent to the GM.");
            return;
        }
        await this._runSetCampFireLevelForGm(level, null);
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
     * After the fire is committed (lit tiers or cold camp), spend fuel, go to activity.
     * @returns {Promise<void>}
     */
    async _advanceCampToActivity() {
        if (!game.user.isGM) return;
        if (this._phase !== "camp" || this._campToActivityDone) return;

        CampfireMakeCampDialog.closeIfOpen();
        this._campToActivityDone = true;
        this._campStep2Entered = true;

        await promoteAllPlaceholders();

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
        this._campFireWoodSpendUserId = null;

        this._phase = "activity";
        this._applyLoseActivityTravelLocks();
        _logGmRestSheet("_advanceCampToActivity", "phase -> activity, closing window");

        await this.close({});

        emitPhaseChanged(this._phase, {
                campStatus: this._campStatus,
                fireLevel: this._fireLevel
            });
        await this._saveRestState();
        this._activateCanvasStationLayer();
        _logGmRestSheet("_advanceCampToActivity", "advance complete", { rendered: this.rendered });
    }

    /**
     * Picks a canvas point (GM). Left click confirms; right-click or Escape cancels.
     * Shows a semi-transparent pit sprite and build-site stub ghosts; all snap to the grid.
     * @param {{ pitBaseTextureSrc?: string }} [options] - Art for the ghost; same source should be passed to {@link placeCampfire}.
     * @returns {Promise<{x: number, y: number}|null>}
     */
    _pickPitWorldPoint(options = {}) {
        return new Promise((resolve) => {
            if (!canvas?.ready) {
                resolve(null);
                return;
            }
            const pitBaseTextureSrc = options.pitBaseTextureSrc ?? "";
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
            const MAX_STUB = 4;

            const updateStubGhosts = (pitCX, pitCY) => {
                if (!container.parent) return;
                const slots = getStationPlaceholderPreviewsForPitCenter(pitCX, pitCY);
                for (let i = 0; i < MAX_STUB; i++) {
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
            const pos = await this._pickPitWorldPoint({ pitBaseTextureSrc });
            if (!pos) {
                this._campPitPlacementCancelled = true;
                this.render({ force: true });
                return;
            }
            const res = await placeCampfire(pos.x, pos.y, { pitBaseTextureSrc });
            if (!res) return;
            await CampfireTokenLinker.setLightState(false, "unlit");
            await placeStationPlaceholders();
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

    async _runSetCampFireLevelForGm(level, requestingUserId = null) {
        if (!game.user.isGM) return;
        if (!["embers", "campfire", "bonfire"].includes(level)) return;

        const actors = getPartyActors();
        const hasTinderbox = actors.some(a => a.items.some(i => {
            const n = i.name?.toLowerCase() ?? "";
            return n.includes("tinderbox") || n.includes("flint and steel") || n.includes("flint & steel");
        }));
        if (!hasTinderbox) {
            ui.notifications.warn("No one has a tinderbox or flint & steel to start a fire.");
            return;
        }

        const cost = CampGearScanner.FIREWOOD_COST_BY_LEVEL[level] ?? 0;
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

        if (level === (this._fireLevel ?? "unlit")) return;

        this._campFireWoodSpendUserId = requestingUserId ?? null;

        const FIRE_ENCOUNTER_MOD = CampGearScanner.FIRE_ENCOUNTER_MOD_BY_LEVEL;
        this._fireLevel = level;
        this._campFirePreviewLevel = null;
        if (this._engine) {
            this._engine.fireLevel = level;
            this._engine.fireRollModifier = FIRE_ENCOUNTER_MOD[level] ?? 0;
        }

        await CampfireTokenLinker.setLightState(true, level);

        const label = level.charAt(0).toUpperCase() + level.slice(1);
        if (cost > 0) {
            ui.notifications.info(`${label} selected. ${cost} firewood will be spent when you proceed to activities.`);
        } else {
            ui.notifications.info(`${label} selected.`);
        }

        emitPhaseChanged("camp", {
                fireLevel: level,
                fireLitBy: this._fireLitBy ?? null,
                firewoodPledges: Array.from(this._firewoodPledges?.entries() ?? []),
                selectedTerrain: this._selectedTerrain ?? null
            });

        await this._saveRestState();
        const willAdvance =
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
    async changeFireLevelDuringActivity(level) {
        if (!game.user.isGM) return { ok: false, error: "GM only" };
        if (this._phase !== "activity") return { ok: false, error: "Wrong phase" };
        const restType = this._engine?.restType
            ?? this._selectedRestType
            ?? this._restData?.restType
            ?? "long";
        if (restType === "short") return { ok: false, error: "Short rest" };
        if (!["embers", "campfire", "bonfire"].includes(level)) return { ok: false, error: "Invalid level" };
        if (this._coldCampDecided) {
            ui.notifications.warn("Cold camp is set. End the rest or adjust from setup if the table allows it.");
            return { ok: false, error: "Cold camp" };
        }

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
            const confirmed = await Dialog.confirm({
                title: "Lower the fire",
                content: "<p>Reducing the fire discards spent firewood. There is no refund. Continue?</p>",
                yes: () => true,
                no: () => false,
                defaultYes: false
            });
            if (!confirmed) return { ok: false, cancelled: true };
        } else if (newCost > curCost) {
            const need = newCost - curCost;
            if (cur === "unlit" && !hasTinderbox) {
                ui.notifications.warn("No one has a tinderbox or flint and steel to start a fire.");
                return { ok: false, error: "No tinderbox" };
            }
            const totalFirewood = actors.reduce((sum, a) => {
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
                const spend = await this._spendPartyFirewoodForMakeCamp(need, null);
                if (!spend.ok) {
                    ui.notifications.warn(spend.error ?? "Could not spend firewood.");
                    return { ok: false, error: spend.error };
                }
            }
        }

        this._fireLevel = level;
        this._campFirePreviewLevel = null;
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
                firewoodPledges: Array.from(this._firewoodPledges?.entries() ?? []),
                selectedTerrain: this._selectedTerrain ?? null
            });

        await this._saveRestState();
        this.render();
        return { ok: true };
    }

    /**
     * GM records that the table decided to sleep cold (no fire).
     * Satisfies the fire gate without lighting, broadcasts to all clients.
     */
    static async #onCampColdCamp(event, target) {
        if (!game.user.isGM) return;
        await this._campCeremony.decideColdCamp();
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
        const pit = hasCampfirePlaced();
        const fireOk = (this._fireLevel ?? "unlit") !== "unlit" || !!this._coldCampDecided;
        if (!pit || !fireOk) {
            ui.notifications?.warn("Place the pit and light the fire (or choose cold camp) from the map.");
            return;
        }
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
                await placeStationPlaceholders();
                emitPhaseChanged("camp", { campPitCursorDone: true });
                await this._saveRestState();
                void this._refreshCampPitNoticeLayer();
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
