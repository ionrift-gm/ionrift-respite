import { Logger } from "../lib/Logger.js";
/**
 * StationActivityDialog
 *
 * Lightweight popup that opens when a player clicks a campsite station overlay.
 * Shows the activities offered by that station, filtered for the actor,
 * and submits the choice via the same socket path as the panel Confirm button.
 */

import {
    ACTIVITY_ICONS,
    applyActivityPortraitAssignments,
    buildPartyState,
    getActivityAdvisory,
    DETECT_MAGIC_BTN_LABEL_GM,
    DETECT_MAGIC_BTN_LABEL_PLAYER,
    DETECT_MAGIC_BTN_LABEL_DISMISS,
    DETECT_MAGIC_BTN_TITLE_GM,
    isWorkbenchExamineUiEnabled,
    isWorkbenchIdentifyUiEnabled
} from "./RestConstants.js";
import { buildActivityListItem, buildActivityDetailContext } from "./ActivityDetailBuilder.js";
import { computeCanShowDetectMagicScanButton, computeCanTriggerDetectMagicScan, getDetectMagicPlayerAccessReason, spawnDetectMagicCastRipple } from "./delegates/DetectMagicDelegate.js";
import { canPlaceStation, actorHasBrewingTools } from "../services/CompoundCampPlacer.js";
import { getPartyActors } from "../services/partyActors.js";
import { MealPhaseHandler } from "../services/MealPhaseHandler.js";
import { emitFeastServeRequest } from "../services/SocketController.js";
import { isStationLayerActive, refreshStationEmptyNoticeFade } from "../services/StationInteractionLayer.js";
import { TerrainRegistry } from "../services/TerrainRegistry.js";
import { guardEmbedItems } from "../services/MintGuard.js";
import { GrantLedger } from "../services/GrantLedger.js";
import { ItemOutcomeHandler } from "../services/ItemOutcomeHandler.js";
import { _refreshGmRestIndicator } from "../module.js";

const MODULE_ID = "ionrift-respite";
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Lets RestSetupApp refresh this dialog after meal drag without a full rest window render. */
export function notifyStationMealChoicesUpdated() {
    Hooks.callAll(`${MODULE_ID}.stationMealChoicesTouched`);
}

/** Workbench identify staging changed; refresh open station dialog. */
export function notifyWorkbenchIdentifyStagingTouched() {
    Hooks.callAll(`${MODULE_ID}.workbenchIdentifyStagingTouched`);
}

/**
 * Closes the open station dialog when it was built for a different actor than the
 * current roster or token focus (GM switches character while a picker is open).
 * @param {string|null|undefined} contextActorId
 */
export function closeStationDialogIfDifferentActor(contextActorId) {
    if (!_openDialog || !contextActorId) return;
    if (_openDialog._actor?.id === contextActorId) return;
    void _openDialog.close();
}

/** Re-build context after GM changes fire (or any shared rest data) from socket. */
export function refreshOpenStationDialog() {
    if (_openDialog) {
        _openDialog._resyncStationActivitiesFromRestApp();
        void _openDialog.render(true);
    }
}

/** Close any open canvas station dialog (rest abandoned, phase change, camp cleared, etc.). */
export async function closeOpenStationDialog() {
    const dlg = _openDialog;
    if (!dlg) return;
    await dlg.close();
}

/**
 * Credit feast satiation in the active rest's meal state for all recipients.
 * Fills + locks food/water slots based on the feast's satiates array, folds
 * selections into consumedDays, and marks each character as rations-submitted.
 *
 * Called after a party meal is served via the "Feast: Serve Now" button.
 *
 * @param {object} restApp - The active RestSetupApp instance
 * @param {string[]} partyIds - Actor IDs of all party members
 * @param {string[]} satiates - Satiates array from the feast item flags (e.g. ["food", "water"])
 */
function _creditFeastMealState(restApp, partyIds, satiates) {
    if (!restApp) return;
    if (!restApp._mealChoices) restApp._mealChoices = new Map();
    if (!restApp._activityMealRationsSubmitted) restApp._activityMealRationsSubmitted = new Set();

    // Determine per-day slot counts from terrain meal rules
    const terrainTag = restApp._engine?.terrainTag ?? restApp._selectedTerrain ?? "forest";
    const terrainMealRules = TerrainRegistry.getDefaults(terrainTag)?.mealRules ?? {};
    const fpd = terrainMealRules.foodPerDay ?? 1;
    const wpd = terrainMealRules.waterPerDay ?? 2;

    for (const pid of partyIds) {
        // Skip characters already submitted; feast credit is additive, not overwriting
        if (restApp._activityMealRationsSubmitted.has(pid)) continue;

        const existing = restApp._mealChoices.get(pid) ?? {};

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

        // Fold filled selections into consumedDays and mark submitted
        const consumedDays = Array.isArray(existing.consumedDays) ? [...existing.consumedDays] : [];
        consumedDays.push({
            food: [...(existing.food ?? [])],
            water: [...(existing.water ?? [])],
            essence: [...(existing.essence ?? [])]
        });

        restApp._mealChoices.set(pid, {
            ...existing,
            consumedDays,
            currentDay: consumedDays.length,
            food: [],
            water: [],
            essence: existing.essence ?? [],
            itemsConsumed: true,
            foodLockedSlots: existing.foodLockedSlots ?? [],
            waterLockedSlots: existing.waterLockedSlots ?? []
        });

        restApp._activityMealRationsSubmitted.add(pid);
    }

    // Persist and broadcast
    try {
        if (typeof restApp._saveRestState === "function") restApp._saveRestState();
    } catch (e) { console.warn(`${MODULE_ID} | _creditFeastMealState: save failed`, e); }

    // Feast covers the whole party; mark meal as submitted so the snapshot
    // carries mealSubmitted:true to players, replacing "Submit Meals" with
    // "Waiting for GM to proceed".
    restApp._mealSubmitted = true;

    try {
        const snap = typeof restApp.getRestSnapshot === "function" ? restApp.getRestSnapshot() : null;
        if (snap) game.socket.emit(`module.${MODULE_ID}`, { type: "restSnapshot", snapshot: snap });
    } catch (e) { console.warn(`${MODULE_ID} | _creditFeastMealState: broadcast failed`, e); }

    notifyStationMealChoicesUpdated();
    if (restApp.rendered) restApp.render();
    _refreshGmRestIndicator(restApp);
    if (typeof restApp._refreshStationOverlayMeals === "function") restApp._refreshStationOverlayMeals();
    if (isStationLayerActive()) refreshStationEmptyNoticeFade(restApp);
    Logger.log(`${MODULE_ID} | _creditFeastMealState: credited ${partyIds.length} party members`, { satiates });
}

export const COOK_ACTIVITY_IDS = new Set(["act_cook", "act_brew"]);

const DIALOG_WIDTH = 320;
/** Campfire dialog: comfort + 3-column gear grid; wider than default. */
const CAMPFIRE_DIALOG_WIDTH = 400;
/** Crafting split panel needs a wider dialog to fit the master-detail layout. */
const CRAFT_SPLIT_WIDTH = 760;
const ANCHOR_ABOVE_PX = 40;
const EST_HEIGHT = 260;
const VIS_CLOSE_RATIO = 0.12;
const PAN_TRIGGER_RATIO = 0.55;

let _openDialog = null;

export class StationActivityDialog extends HandlebarsApplicationMixin(ApplicationV2) {

    static DEFAULT_OPTIONS = {
        id: "ionrift-station-activity-dialog",
        classes: ["ionrift-window", "glass-ui", "ionrift", "ionrift-station-dialog"],
        window: {
            title: "Choose Activity",
            resizable: false,
            minimizable: false
        },
        position: {
            width: DIALOG_WIDTH,
            height: "auto"
        },
        actions: {
            selectActivity: StationActivityDialog.#onSelectActivity,
            confirmActivity: StationActivityDialog.#onConfirm,
            backToList: StationActivityDialog.#onBackToList,
            dismissResult: StationActivityDialog.#onDismissResult,
            switchStationPanelTab: StationActivityDialog.#onSwitchStationPanelTab,
            setFireLevel: StationActivityDialog.#onSetFireLevel,
            requestFireLevel: StationActivityDialog.#onRequestFireLevel,
            previewFireLevel: StationActivityDialog.#onPreviewFireLevel,
            submitStationRations: StationActivityDialog.#onSubmitStationRations,
            stationDetectMagicScan: StationActivityDialog.#onStationDetectMagicScan,
            stationIdentifyScannedItem: StationActivityDialog.#onStationIdentifyScannedItem,
            submitWorkbenchIdentify: StationActivityDialog.#onSubmitWorkbenchIdentify,
            workbenchIdentifyRemovePotion: StationActivityDialog.#onWorkbenchIdentifyRemovePotion,
            dismissWorkbenchIdentifyAck: StationActivityDialog.#onDismissWorkbenchIdentifyAck,
            reclaimCampGear: StationActivityDialog.#onReclaimCampGearFromDialog,
            craftSelectRecipe: StationActivityDialog.#onCraftSelectRecipe,
            craftSelectRisk: StationActivityDialog.#onCraftSelectRisk,
            craftCommit: StationActivityDialog.#onCraftCommit,
            craftToggleMissing: StationActivityDialog.#onCraftToggleMissing,
            craftClose: StationActivityDialog.#onCraftClose,
            serveToParty: StationActivityDialog.#onServeToParty,
            feastServeNow: StationActivityDialog.#onFeastServeNow,
            identifyPoolItem: StationActivityDialog.#onIdentifyPoolItem
        }
    };

    static PARTS = {
        "station-activity": {
            template: `modules/${MODULE_ID}/templates/station-activity-dialog.hbs`
        }
    };

    /**
     * @param {Object} options
     * @param {Object}   options.station        - CAMP_STATIONS entry
     * @param {Actor}    options.actor          - The choosing actor
     * @param {Object[]} options.available      - Available activity schemas for this station
     * @param {Object[]} options.faded          - Faded (prereq-blocked) activity schemas
     * @param {Object}   options.restSession    - Current rest session context (fireLevel, etc.)
     * @param {object|null} options.restApp - parent RestSetupApp instance (canvas flow)
     * @param {string|null} options.canvasStationId - station id for overlay dimming
     * @param {object|null} options.partyState       - buildPartyState(...) for advisories (from RestSetupApp)
     * @param {Token|null} options.stationToken     - token to anchor position and track while open
     * @param {boolean} [options.showStationTabs]    - campfire / cooking / workbench hub (multi-tab)
     * @param {string} [options.initialStationTab]   - activity | meal | cooking | identify
     * @param {Object[]} [options.cookingAvailable]  - act_cook / act_brew only (cooking station)
     * @param {Object[]} [options.cookingFaded]
     */
    constructor({
        station,
        actor,
        available,
        faded,
        restSession,
        restApp = null,
        canvasStationId = null,
        partyState = null,
        stationToken = null,
        showStationTabs = false,
        initialStationTab = "activity",
        cookingAvailable = [],
        cookingFaded = [],
        actorHasCookingUtensils = false,
        stationHasCooking = true,
        actorChoiceLocked = null
    } = {}, appOptions = {}) {
        super(appOptions);
        this._station          = station;
        this._actor            = actor;
        this._available        = available ?? [];
        this._faded            = faded ?? [];
        this._cookingAvailable = cookingAvailable ?? [];
        this._cookingFaded     = cookingFaded ?? [];
        /** Station-level: was this token placed with cook's utensils? Hides the Cooking tab if false. */
        this._stationHasCooking = !!stationHasCooking;
        /** Per-actor: cook's utensils unlock the Cooking tab at the cooking station. */
        this._actorHasCookingUtensils = !!actorHasCookingUtensils;
        this._actorChoiceLocked = actorChoiceLocked ?? null;
        this._showStationTabs  = !!showStationTabs;
        this._stationPanelTab  = initialStationTab || "activity";
        this._restSession      = restSession ?? {};
        this._restApp          = restApp;
        this._canvasStationId  = canvasStationId;
        this._partyState       = partyState;
        this._stationToken     = stationToken;
        /** @type {(() => void) | null} */
        this._tickerFn         = null;
        /** @type {(() => void) | null} */
        this._canvasPanFn      = null;
        /** @type {((...args: unknown[]) => void) | null} */
        this._mealHookBound    = null;
        this._trackStarted     = false;
        /** Set when user manually drags the dialog; stops auto-tracking to token. */
        this._userDragged      = false;

        /** @type {"list"|"detail"|"result"|"crafting"} */
        this._dialogState      = "list";
        this._selectedActivityId = null;
        this._activityResult   = null;
        this._followUpValue    = null;

        // Inline crafting state
        this._craftProfession  = null;
        this._craftRecipeId    = null;
        this._craftRisk        = "standard";
        this._craftResult      = null;
        this._craftHasCrafted  = false;
        this._craftShowMissing = false;
        /** Set after the crafting result has been committed to RestSetupApp. Prevents double-commit on X-close. */
        this._craftCommitted   = false;
        /** True while {@link CraftingEngine.resolve} runs (includes chat roll + Dice So Nice wait). */
        this._craftRollPending = false;
        /** Width before entering crafting, restored on close. */
        this._preCraftWidth    = null;
        /** Detail panel scroll position preserved across crafting re-renders. */
        this._craftDetailScrollTop = 0;
        /** Party feast: Serve Now finished successfully; hide repeat serve / keep actions. */
        this._partyMealOutcomeResolved = false;
        /** Prevents double-submit while feast serve awaits async work. */
        this._feastServeInFlight = false;

        this._hydrateCraftStateFromRest();
    }

    /**
     * Restore inline crafting UI after refresh when this rest already recorded a craft.
     */
    _hydrateCraftStateFromRest() {
        const actorId = this._actor?.id;
        const restApp = this._restApp;
        if (!actorId || !restApp) return;

        const prior = restApp._craftingResults?.get(actorId);
        if (!prior && !restApp.hasCompletedCrafting?.(actorId)) return;

        this._craftResult = prior ?? { success: true, narrative: "Craft already completed this rest." };
        this._craftHasCrafted = true;
        this._craftCommitted = true;
        this._craftRecipeId = prior?.recipeId ?? null;
        if (prior?.recipeId && restApp._craftingEngine) {
            for (const [profId, recipes] of restApp._craftingEngine.recipes ?? []) {
                if (recipes?.some(r => r.id === prior.recipeId)) {
                    this._craftProfession = profId;
                    break;
                }
            }
        }
        if (!this._craftProfession) this._craftProfession = "cooking";
    }

    async render(options = {}) {
        const preserveCraftScroll = this._dialogState === "crafting"
            && this.rendered
            && !options.resetCraftScroll;
        if (preserveCraftScroll) {
            const scrollEl = this.element?.querySelector(
                ".station-crafting-panel.crafting-split .crafting-detail-panel"
            );
            this._craftDetailScrollTop = scrollEl?.scrollTop ?? 0;
        }
        const result = await super.render(options);
        if (preserveCraftScroll && this._craftDetailScrollTop > 0) {
            queueMicrotask(() => {
                const scrollEl = this.element?.querySelector(
                    ".station-crafting-panel.crafting-split .crafting-detail-panel"
                );
                if (scrollEl) scrollEl.scrollTop = this._craftDetailScrollTop;
            });
        }
        return result;
    }

    async _prepareContext(options) {
        Logger.log(`ionrift-respite | _prepareContext`, { state: this._dialogState, width: this.position?.width, actor: this._actor?.name });
        const base = {
            station:    this._station,
            actorName:  this._actor?.name ?? "Unknown",
            dialogState: this._dialogState
        };

        if (this._dialogState === "detail") return { ...base, ...this._buildDetailContext() };
        if (this._dialogState === "result") return { ...base, ...this._buildResultContext() };
        if (this._dialogState === "crafting") return { ...base, ...this._buildCraftingContext() };
        return { ...base, ...this._buildListContext() };
    }

    _buildListContext() {
        const ps = this._partyState ?? buildPartyState([], new Map(), 14);
        const mapAct = (act, isAvail) => {
            const item = buildActivityListItem(act.id, act, isAvail ? this._actor : null, ps, isAvail);
            return item;
        };

        const activityItems = this._available.map(act => mapAct(act, true));
        const fadedItems    = this._faded.map(act => mapAct(act, false));

        const cookActItems = this._cookingAvailable.map(act => mapAct(act, true));
        const cookFaded    = this._cookingFaded.map(act => mapAct(act, false));

        // UX-9: Inject portrait assignments into each activity item
        const assignments = this._buildActivityAssignments();
        const _injectAssignments = (items) => {
            for (const item of items) {
                applyActivityPortraitAssignments(item, assignments[item.id] ?? []);
            }
        };
        _injectAssignments(activityItems);
        _injectAssignments(fadedItems);
        _injectAssignments(cookActItems);
        _injectAssignments(cookFaded);

        const hubEligible = this._showStationTabs;
        const mealCard = (hubEligible && this._station.id !== "workbench" && this._restApp?.getStationMealCardForActor && this._actor?.id)
            ? this._restApp.getStationMealCardForActor(this._actor.id)
            : null;
        const hasAnyGeneral = activityItems.length > 0;
        const hasCookingAvail = cookActItems.length > 0;

        // ── Shared pool gating (must be before tab building) ──────────────
        // Determine early whether this viewer can see the party-wide Identify tab.
        // GM and actors with the Identify spell prepared can see it.
        const _identifyGateData = (hubEligible && isWorkbenchIdentifyUiEnabled() && this._station?.id === "workbench" && this._restApp?.getStationIdentifyEmbedContext)
            ? this._restApp.getStationIdentifyEmbedContext({})
            : { identifyCasters: [], unidentifiedItems: [] };
        const isIdentifyCaster = _identifyGateData.identifyCasters?.some(c => c.id === this._actor?.id);
        this._canSeeSharedPool = !!game.user?.isGM || !!isIdentifyCaster;
        // Group ALL party unidentified gear (not potions) by owner for the Identify tab list
        const _byOwner = new Map();
        for (const item of (_identifyGateData.unidentifiedItems ?? []).filter(it => !it.isPotion)) {
            if (!_byOwner.has(item.actorId)) {
                _byOwner.set(item.actorId, {
                    ownerName: item.actorName,
                    ownerId: item.actorId,
                    items: []
                });
            }
            _byOwner.get(item.actorId).items.push(item);
        }
        const unidentifiedItemsByOwner = [..._byOwner.values()];

        const stationTabs = [];
        if (hubEligible && this._station.id === "cooking_station") {
            if (mealCard) {
                stationTabs.push({ id: "meal", label: "Rations" });
            }
            if (this._stationHasCooking) {
                stationTabs.push({
                    id: "cooking",
                    label: "Cooking",
                    hintClass: this._actorHasCookingUtensils ? "" : "station-sub-tab-hint",
                    title: this._actorHasCookingUtensils
                        ? ""
                        : "Requires cook's utensils"
                });
            }
        } else if (hubEligible && this._station.id === "workbench") {
            if (hasAnyGeneral && !this._actorChoiceLocked) {
                stationTabs.push({ id: "activity", label: "Activities" });
            }
            if (isWorkbenchExamineUiEnabled()) {
                stationTabs.push({ id: "examine", label: "Examine" });
            }
            if (isWorkbenchIdentifyUiEnabled() && this._canSeeSharedPool) {
                stationTabs.push({ id: "identify", label: "Identify" });
            }
        } else if (hubEligible && this._station.id === "campfire") {
            const fireTabCtx = this._restApp?.getFireTabContextForStationDialog?.() ?? null;
            if (fireTabCtx) {
                stationTabs.push({ id: "camp", label: "Camp" });
                stationTabs.push({ id: "fire", label: "Fire" });
            }
        }

        const tabIds = new Set(stationTabs.map(t => t.id));
        if (!tabIds.has(this._stationPanelTab)) {
            this._stationPanelTab = stationTabs[0]?.id ?? "activity";
        }
        if (this._station.id === "campfire" && stationTabs.length > 0 && this._stationPanelTab === "activity") {
            this._stationPanelTab = "camp";
        }

        const showStationTabs = stationTabs.length > 0;
        const showTabBar = stationTabs.length > 1;

        const campGearAtFire = (this._station?.id === "campfire" && this._restApp?.getCampGearContextForActor)
            ? this._restApp.getCampGearContextForActor(this._actor?.id)
            : null;
        const campComfortAtFire = (this._station?.id === "campfire" && this._restApp?.getCampComfortAdvisoryForStationDialog)
            ? this._restApp.getCampComfortAdvisoryForStationDialog()
            : null;
        const campPersonalCard = (this._station?.id === "campfire" && this._restApp?.getCampPersonalCardForActor && this._actor?.id)
            ? this._restApp.getCampPersonalCardForActor(this._actor.id)
            : null;
        const fireTabContext = (this._station?.id === "campfire" && this._restApp?.getFireTabContextForStationDialog)
            ? this._restApp.getFireTabContextForStationDialog()
            : null;

        // Identify embed context: Examine tab uses own-only; Identify tab uses party-wide.
        // canSeeSharedPool was pre-computed at construction in _buildListContext preamble.
        const identifyEmbedOwn = (isWorkbenchExamineUiEnabled()
            && this._station?.id === "workbench"
            && this._restApp?.getStationIdentifyEmbedContext)
            ? this._restApp.getStationIdentifyEmbedContext({
                restrictUnidentifiedToActorId: this._actor?.id ?? null
            })
            : { unidentifiedItems: [], identifyCasters: [], detectMagicCasters: [] };
        const identifyEmbed = identifyEmbedOwn;

        const wbWorkbenchDefaults = {
            workbenchIdentifyActorId: null,
            workbenchGearChip: null,
            workbenchPotionChip: null,
            workbenchSubmitLocked: true,
            workbenchSubmitPending: false,
            workbenchIdentifyAcknowledgement: null,
            workbenchAckRevealReady: true,
            workbenchFocusExhausted: false
        };
        const wbCtx = (isWorkbenchExamineUiEnabled()
            && this._station?.id === "workbench"
            && this._restApp?.getWorkbenchIdentifyDragContext)
            ? this._restApp.getWorkbenchIdentifyDragContext(this._actor?.id ?? null)
            : wbWorkbenchDefaults;


        return {
            activities:       [...activityItems, ...fadedItems],
            hasAny:           activityItems.length > 0 || fadedItems.length > 0,
            cookingActivities: [...cookActItems, ...cookFaded],
            hasCookingAny:    cookActItems.length > 0 || cookFaded.length > 0,
            actorHasCookingUtensils: this._actorHasCookingUtensils,
            actorChoiceLocked: this._actorChoiceLocked,
            showStationTabs,
            showTabBar,
            stationTabs,
            stationPanelTab:  this._stationPanelTab,
            mealCard,
            mealCardNeedsEssence: !!(mealCard?.needsEssence),
            workbenchExamineEnabled: this._station?.id === "workbench" && isWorkbenchExamineUiEnabled(),
            workbenchIdentifyUiEnabled: isWorkbenchIdentifyUiEnabled(),
            unidentifiedItems: identifyEmbed.unidentifiedItems ?? [],
            unidentifiedItemsByOwner,
            canSeeSharedPool: this._canSeeSharedPool,
            identifyCasters: _identifyGateData.identifyCasters ?? [],
            campGearAtFire,
            campComfortAtFire,
            campComfortLine: campComfortAtFire?.mapComfortLine ?? null,
            campPersonalCard,
            fireTabContext,
            hideNoActivitiesMessage: this._station?.id === "campfire",
            isGmUser:           !!game.user?.isGM,
            canShowDetectMagicScanButton: computeCanShowDetectMagicScanButton(getPartyActors()),
            canTriggerDetectMagicScan: computeCanTriggerDetectMagicScan(getPartyActors()),
            detectMagicScanButtonLabel: this._restApp?._magicScanComplete
                ? DETECT_MAGIC_BTN_LABEL_DISMISS
                : (game.user?.isGM ? DETECT_MAGIC_BTN_LABEL_GM : DETECT_MAGIC_BTN_LABEL_PLAYER),
            detectMagicScanButtonTitle: game.user?.isGM
                ? DETECT_MAGIC_BTN_TITLE_GM
                : (getDetectMagicPlayerAccessReason(getPartyActors()) ?? ""),
            magicScanResults: this._restApp?._magicScanResults ?? [],
            magicScanComplete: !!this._restApp?._magicScanComplete,
            magicScanActive: !!this._restApp?._magicScanComplete,
            ...wbCtx,
            workbenchFocusExhausted: wbCtx.workbenchFocusExhausted ?? false
        };
    }

    _buildDetailContext() {
        const activityId = this._selectedActivityId;
        const resolver = this._restApp?._activityResolver;
        const activity = resolver?.activities?.get(activityId);
        if (!activity) return { activityDetail: null };

        const actor = this._actor;
        const comfort = this._restApp?._engine?.comfort ?? "sheltered";
        const followUpValue =
            this._followUpValue
            ?? this._restApp?._gmFollowUps?.get(actor?.id)
            ?? this._restApp?._getFollowUpForCharacter?.(actor?.id)
            ?? null;
        let armorRuleEnabled = false;
        try { armorRuleEnabled = !!game.settings.get("ionrift-respite", "armorDoffRule"); } catch { /* ok */ }
        const safeSpot = !!(this._restApp?._engine?.safeRestSpot ?? this._restApp?._restData?.safeRestSpot);
        let fromSetting = false;
        try { fromSetting = !!game.settings.get("ionrift-respite", "safeRestSpot"); } catch { /* ok */ }
        const effectiveSafe = safeSpot || fromSetting;
        const armorForDetail = !effectiveSafe && armorRuleEnabled;

        const ps = this._partyState ?? buildPartyState([], new Map(), 14);

        const detail = buildActivityDetailContext(activityId, activity, actor, ps, {
            comfort,
            followUpValue,
            armorRuleEnabled: armorForDetail,
            getArmorWarning: armorForDetail
                ? (this._restApp?.getArmorWarningForActivityDetail?.bind(this._restApp) ?? null)
                : null
        });

        return { activityDetail: { ...detail, characterId: actor?.id } };
    }

    _buildResultContext() {
        const r = this._activityResult;
        if (!r) return { activityResult: null };

        const resolver = this._restApp?._activityResolver;
        const activity = resolver?.activities?.get(r.activityId);
        const icon = ACTIVITY_ICONS[r.activityId] ?? activity?.icon ?? "fas fa-circle";
        const hasCheck = !!activity?.check;

        let tierLabel, tierClass;
        if (!hasCheck && r.result === "success") {
            tierLabel = "Confirmed";
            tierClass = "confirmed";
        } else {
            switch (r.result) {
                case "exceptional":
                    tierLabel = "Exceptional!"; tierClass = "exceptional"; break;
                case "success":
                    tierLabel = "Success"; tierClass = "success"; break;
                case "failure_complication":
                    tierLabel = "Failed (complication)"; tierClass = "failure"; break;
                case "failure":
                    tierLabel = "Failed"; tierClass = "failure"; break;
                case "pending_approval":
                    tierLabel = "Pending Approval"; tierClass = "pending"; break;
                default:
                    tierLabel = r.result ?? "Complete"; tierClass = "confirmed";
            }
        }

        return {
            activityResult: {
                name: activity?.name ?? r.activityId,
                icon,
                tierLabel,
                tierClass,
                narrative: r.narrative ?? "",
                isPending: r.result === "pending_approval"
            }
        };
    }

    /**
     * Format a recipe buff definition into a display-ready preview object.
     * @param {object|null} buff - The buff definition from outputFlags
     * @returns {object|null}
     */
    _formatBuffPreview(buff) {
        if (!buff) return null;
        const labels = {
            temp_hp: "Temp HP",
            advantage: "Advantage",
            exhaustion_save: "Exhaustion Save"
        };
        const durationLabels = {
            immediate: "Immediate",
            untilLongRest: "Until long rest",
            nextSave: "Next save"
        };
        return {
            label: labels[buff.type] ?? buff.type,
            formula: buff.formula ?? "",
            duration: durationLabels[buff.duration] ?? buff.duration ?? "",
            target: buff.target ?? "self"
        };
    }

    /** Compute station tab definitions. Shared by list and crafting contexts. */
    _buildStationTabs() {
        if (!this._showStationTabs) return [];
        const stationTabs = [];
        if (this._station.id === "cooking_station") {
            const mealCard = this._restApp?.getStationMealCardForActor?.(this._actor?.id) ?? null;
            if (mealCard) {
                stationTabs.push({ id: "meal", label: "Rations" });
            }
            if (this._stationHasCooking) {
                stationTabs.push({
                    id: "cooking",
                    label: "Cooking",
                    hintClass: this._actorHasCookingUtensils ? "" : "station-sub-tab-hint",
                    title: this._actorHasCookingUtensils ? "" : "Requires cook's utensils"
                });
            }
        } else if (this._station.id === "workbench") {
            const hasGeneral = this._available.length > 0;
            if (hasGeneral && !this._actorChoiceLocked) {
                stationTabs.push({ id: "activity", label: "Activities" });
            }
            if (isWorkbenchExamineUiEnabled()) {
                stationTabs.push({ id: "examine", label: "Examine" });
            }
            if (isWorkbenchIdentifyUiEnabled() && this._canSeeSharedPool) {
                stationTabs.push({ id: "identify", label: "Identify" });
            }
        } else if (this._station.id === "campfire") {
            const fireTabCtx = this._restApp?.getFireTabContextForStationDialog?.() ?? null;
            if (fireTabCtx) {
                stationTabs.push({ id: "camp", label: "Camp" });
                stationTabs.push({ id: "fire", label: "Fire" });
            }
        }
        return stationTabs;
    }

    /**
     * UX-9: Build per-activity portrait assignments for the current station.
     * Iterates _characterChoices, filters to activities visible at this station,
     * and annotates with resolution status from _earlyResults.
     *
     * @returns {Object<string, Object[]>} Map of activityId → array of
     *   { actorId, actorName, portraitImg, status: 'pending'|'success'|'fail' }
     */
    _buildActivityAssignments() {
        const assignments = {};
        const restApp = this._restApp;
        if (!restApp?._characterChoices?.size) return assignments;

        // Activity IDs visible at this station (available + faded)
        const stationActIds = new Set([
            ...this._available.map(a => a.id),
            ...this._faded.map(a => a.id),
            ...this._cookingAvailable.map(a => a.id),
            ...this._cookingFaded.map(a => a.id)
        ]);

        for (const [charId, actId] of restApp._characterChoices) {
            if (!stationActIds.has(actId)) continue;

            const actor = game.actors.get(charId);
            if (!actor) continue;

            // Derive status from early results
            let status = "pending";
            const earlyResult = restApp._earlyResults?.get(charId);
            if (earlyResult) {
                if (earlyResult.result === "success" || earlyResult.result === "exceptional") {
                    status = "success";
                } else if (earlyResult.result === "failure" || earlyResult.result === "failure_complication") {
                    status = "fail";
                }
                // pending_approval stays as "pending"
            }

            if (!assignments[actId]) assignments[actId] = [];
            assignments[actId].push({
                actorId: charId,
                actorName: actor.name,
                portraitImg: actor.img ?? actor.prototypeToken?.texture?.src ?? "icons/svg/mystery-man.svg",
                status
            });
        }

        return assignments;
    }

    _buildCraftingContext() {
        const actor = this._actor;
        const engine = this._restApp?._craftingEngine;
        Logger.log(`ionrift-respite | _buildCraftingContext`, { hasActor: !!actor, hasEngine: !!engine, profession: this._craftProfession });
        if (!actor || !engine) return { crafting: null };

        const professionId = this._craftProfession;
        const professionLabels = {
            cooking: "Cooking", alchemy: "Alchemy",
            smithing: "Smithing", leatherworking: "Leatherworking",
            brewing: "Brewing", tailoring: "Tailoring"
        };

        const terrainTag = this._restApp?._engine?.terrainTag ?? this._restApp?._restData?.terrainTag ?? null;
        const partySize = getPartyActors().length;
        const status = engine.getRecipeStatus(actor, professionId, terrainTag, partySize);

        const enrichRecipe = (recipe) => {
            const dcBreakdown = engine.getDcBreakdown(actor, recipe, this._craftRisk, terrainTag);
            const flags = recipe.outputFlags?.["ionrift-respite"];
            return {
                ...recipe,
                dcDisplay: dcBreakdown.total,
                dcBreakdown,
                outputName: recipe.output?.name ?? "Unknown",
                outputImg: recipe.output?.img ?? "icons/consumables/food/bowl-stew-brown.webp",
                ambitiousOutput: recipe.ambitiousOutput,
                isSelected: recipe.id === this._craftRecipeId,
                description: recipe.description ?? "",
                buffPreview: this._formatBuffPreview(flags?.buff),
                isPartyMeal: !!flags?.partyMeal,
                isWellFed: !!flags?.wellFed,
                satiates: flags?.satiates ?? [],
                ambitiousName: recipe.ambitiousOutput?.name ?? null,
                ambitiousBuffPreview: this._formatBuffPreview(
                    recipe.ambitiousOutputFlags?.["ionrift-respite"]?.buff ?? flags?.buff
                ),
                ingredientList: (recipe.ingredients ?? []).map(ing => {
                    const detail = recipe.ingredientStatus?.details?.find(d => d.name === ing.name);
                    const invKey = ing.name.toLowerCase().trim();
                    const invEntry = actor.items?.find(i => i.name.toLowerCase().trim() === invKey);
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
        const selectedRecipe = available.find(r => r.id === this._craftRecipeId)
            ?? partial.find(r => r.id === this._craftRecipeId);

        let commitSummary = null;
        if (selectedRecipe && !this._craftHasCrafted) {
            const outputForRisk = this._craftRisk === "ambitious" && selectedRecipe.ambitiousOutput
                ? selectedRecipe.ambitiousOutput : selectedRecipe.output;
            commitSummary = {
                recipeName: selectedRecipe.name,
                dc: selectedRecipe.dcBreakdown.total,
                dcBreakdown: selectedRecipe.dcBreakdown,
                risk: this._craftRisk,
                riskLabel: { standard: "Standard", ambitious: "Ambitious" }[this._craftRisk],
                outputName: outputForRisk?.name ?? selectedRecipe.outputName,
                outputImg: outputForRisk?.img ?? selectedRecipe.outputImg ?? "icons/svg/mystery-man.svg",
                outputQuantity: outputForRisk?.quantity ?? 1,
                ingredients: (selectedRecipe.ingredients ?? []).map(ing => {
                    const invKey = ing.name.toLowerCase().trim();
                    const invEntry = actor.items?.find(i => i.name.toLowerCase().trim() === invKey);
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

        // Include station tab bar so tabs persist during crafting
        const stationTabs = this._buildStationTabs();
        const showTabBar = stationTabs.length > 1;

        return {
            showTabBar,
            stationTabs,
            stationPanelTab: this._stationPanelTab,
            craftRollPending: this._craftRollPending,
            crafting: {
                profession: professionLabels[professionId] ?? professionId,
                professionId,
                actorName: actor.name,
                actorImg: actor.img,
                selectedRisk: this._craftRisk,
                selectedRecipeId: this._craftRecipeId,
                hasCrafted: this._craftHasCrafted,
                rollPending: this._craftRollPending,
                showMissing: this._craftShowMissing,
                riskTiers: [
                    { id: "standard", label: "Standard", hint: "Base DC · Ingredients used", selected: this._craftRisk === "standard" },
                    { id: "ambitious", label: "Ambitious", hint: "DC +5 · Better yield", selected: this._craftRisk === "ambitious" }
                ],
                available,
                partial,
                selectedRecipe: selectedRecipe ?? null,
                isAmbitiousSelected: this._craftRisk === "ambitious",
                commitSummary,
                craftingResult: this._craftResult ? {
                    ...this._craftResult,
                    isPartyMeal: !!(selectedRecipe?.isPartyMeal ?? false),
                    partyMealDispositionDone: this._partyMealOutcomeResolved,
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

    /**
     * After rations submit or meal UI refresh: close when this hub has no station tabs left
     * and no general activities (only the empty placeholder would remain).
     */
    async _closeIfEmptyHubAfterRender() {
        if (!this.rendered) return;
        if (!this._showStationTabs) return;
        if (this._dialogState !== "list") return;
        const sid = this._station?.id;
        if (sid !== "cooking_station") return;

        const ctx = this._buildListContext();
        if (ctx.showStationTabs) return;
        if (ctx.hasAny) return;
        await this.close();
    }

    static #onSelectActivity(event, target) {
        const activityId = target.dataset.activityId;
        Logger.log(`ionrift-respite | #onSelectActivity`, { activityId, target: target?.outerHTML?.slice(0,120) });
        if (!activityId) return;
        this._selectedActivityId = activityId;
        this._followUpValue = null;

        // Cooking activities skip the detail/confirm step. Go straight to crafting.
        if (COOK_ACTIVITY_IDS.has(activityId)) {
            const resolver = this._restApp?._activityResolver;
            const activity = resolver?.activities?.get(activityId)
                ?? this._cookingAvailable?.find(a => a.id === activityId);
            this._craftProfession  = activity?.crafting?.profession ?? (activityId === "act_cook" ? "cooking" : activityId === "act_brew" ? "brewing" : "cooking");
            this._craftRecipeId    = null;
            this._craftRisk        = "standard";
            this._craftResult      = null;
            this._craftHasCrafted  = false;
            this._craftCommitted   = false;
            this._craftRollPending = false;
            this._craftShowMissing = false;
            this._partyMealOutcomeResolved = false;
            this._dialogState      = "crafting";
            this._preCraftWidth    = this.position?.width ?? DIALOG_WIDTH;
            this._craftDetailScrollTop = 0;
            Logger.log(`ionrift-respite | cooking shortcut → crafting state`, { profession: this._craftProfession, width: this.position?.width });
            this.setPosition({ width: CRAFT_SPLIT_WIDTH });
            this.render({ resetCraftScroll: true });
            return;
        }

        this._dialogState = "detail";
        this.render();
    }

    static async #onConfirm() {
        try {
        const activityId = this._selectedActivityId;
        if (!activityId || !this._restApp?.finalizeActivityChoiceFromStation) return;

        Logger.log(`ionrift-respite | #onConfirm`, { activityId, hasRestApp: !!this._restApp?.finalizeActivityChoiceFromStation });
        const resolver = this._restApp._activityResolver;
        const activity = resolver?.activities?.get(activityId)
            // Cooking activities live in _cookingAvailable, not the resolver
            ?? this._cookingAvailable?.find(a => a.id === activityId)
            ?? this._available?.find(a => a.id === activityId);
        Logger.log(`ionrift-respite | #onConfirm activity`, { activity: activity?.id, isCrafting: !!activity?.crafting?.enabled, isCookId: !!COOK_ACTIVITY_IDS.has(activityId) });

        // Armor penalty gate: warn before locking an activity that penalises sleeping in armor.
        const effectiveSafe = !!(this._restApp?._engine?.safeRestSpot ?? this._restApp?._restData?.safeRestSpot)
            || (() => { try { return !!game.settings.get("ionrift-respite", "safeRestSpot"); } catch { return false; } })();
        if (!effectiveSafe && !activity?.armorSleepWaiver) {
            try {
                const armorRuleEnabled = game.settings.get("ionrift-respite", "armorDoffRule");
                if (armorRuleEnabled) {
                    const equippedArmor = this._actor?.items?.find(i =>
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

        // Crafting activities: transition to inline crafting picker
        if (activity?.crafting?.enabled || COOK_ACTIVITY_IDS.has(activityId)) {
            this._craftProfession  = activity?.crafting?.profession ?? (activityId === "act_cook" ? "cooking" : activityId === "act_brew" ? "brewing" : "cooking");
            this._craftRecipeId    = null;
            this._craftRisk        = "standard";
            this._craftResult      = null;
            this._craftHasCrafted  = false;
            this._craftCommitted   = false;
            this._craftRollPending = false;
            this._craftShowMissing = false;
            this._partyMealOutcomeResolved = false;
            this._dialogState      = "crafting";
            // Widen for the split-panel crafting layout
            this._preCraftWidth = this.position?.width ?? DIALOG_WIDTH;
            this._craftDetailScrollTop = 0;
            Logger.log(`ionrift-respite | entering crafting state`, { profession: this._craftProfession, preCraftWidth: this._preCraftWidth, newWidth: CRAFT_SPLIT_WIDTH });
            this.setPosition({ width: CRAFT_SPLIT_WIDTH });
            this.render({ resetCraftScroll: true });
            return;
        }

        const result = await this._restApp.finalizeActivityChoiceFromStation(
            this._actor?.id,
            activityId,
            this._canvasStationId,
            { followUpValue: this._followUpValue }
        );

        if (result) {
            this._activityResult = result;
            this._dialogState = "result";
            this.render();
        } else {
            this.close();
        }
        } catch (err) {
            console.error(`ionrift-respite | #onConfirm error`, err);
        }
    }

    static #onBackToList() {
        this._dialogState = "list";
        this._selectedActivityId = null;
        this._followUpValue = null;
        this.render();
    }

    static #onDismissResult() {
        this.close();
    }

    // ── Inline Crafting Handlers ──────────────────────────────────────

    static #onCraftSelectRecipe(event, target) {
        if (this._craftRollPending || this._craftHasCrafted) return;
        this._craftRecipeId = target.dataset.recipeId;
        this.render();
    }

    static #onCraftSelectRisk(event, target) {
        if (this._craftRollPending || this._craftHasCrafted) return;
        this._craftRisk = target.dataset.risk;
        this.render();
    }

    static async #onCraftCommit() {
        if (this._craftRollPending || this._craftHasCrafted || !this._craftRecipeId) return;
        const engine = this._restApp?._craftingEngine;
        const actor = this._actor;
        const restApp = this._restApp;
        if (!engine || !actor) return;

        if (restApp?.hasCompletedCrafting?.(actor.id, this._craftProfession)) {
            ui.notifications.warn(`${actor.name} has already crafted during this rest.`);
            return;
        }

        const ledger = restApp?._grantLedger;
        const slotKey = GrantLedger.craftingSlotKey(actor.id, this._craftProfession, this._craftRecipeId);
        if (ledger?.has(slotKey)) {
            ui.notifications.warn("That recipe was already crafted this rest.");
            return;
        }

        this._partyMealOutcomeResolved = false;

        const terrainTag = this._restApp?._engine?.terrainTag ?? this._restApp?._restData?.terrainTag ?? null;
        const partySize = engine.getRecipePartySize(this._craftRecipeId, this._craftProfession);

        this._craftRollPending = true;
        this.render();
        try {
            this._craftResult = await engine.resolve(
                actor, this._craftRecipeId, this._craftProfession, this._craftRisk, terrainTag, partySize,
                { ledger }
            );
            this._craftHasCrafted = true;
            if (this._craftResult?.success) {
                await this._autoCommitCraftResult();
                this._resyncStationActivitiesFromRestApp();
            }
        } finally {
            this._craftRollPending = false;
            this.render();
        }
    }

    static #onCraftToggleMissing() {
        if (this._craftRollPending) return;
        this._craftShowMissing = !this._craftShowMissing;
        this.render();
    }

    /**
     * Commits the in-progress crafting result to RestSetupApp exactly once.
     * Called from the explicit Close/Keep button and from close() as a safety net,
     * so that closing via the window X still locks the actor's activity.
     */
    async _autoCommitCraftResult() {
        if (this._craftCommitted) return;
        if (!this._craftHasCrafted || !this._craftResult) return;

        const characterId = this._actor?.id;
        const profession  = this._craftProfession;
        const result      = this._craftResult;
        const restApp     = this._restApp;
        if (!restApp || !characterId) return;

        this._craftCommitted = true;

        restApp._craftingResults?.set(characterId, result);

        const resolver  = restApp._activityResolver;
        const craftAct  = resolver?.activities
            ? [...resolver.activities.values()].find(a => a.crafting?.profession === profession)
            : null;
        const activityId = craftAct?.id ?? this._selectedActivityId;
        Logger.log(`ionrift-respite | _autoCommitCraftResult DEBUG`, {
            profession,
            resolverSize: resolver?.activities?.size ?? "no-resolver",
            craftActId: craftAct?.id ?? null,
            selectedActivityId: this._selectedActivityId,
            resolvedActivityId: activityId,
            characterChoicesBefore: Object.fromEntries(restApp._characterChoices ?? [])
        });

        if (restApp._isGM) {
            restApp._gmOverrides?.set(characterId, activityId);
            restApp._rebuildCharacterChoices?.();
            const submissions = {};
            for (const [charId, actId] of restApp._characterChoices) {
                const act = resolver?.activities?.get(actId);
                submissions[charId] = {
                    activityId: actId,
                    activityName: act?.name ?? actId,
                    source: restApp._gmOverrides?.has(charId) ? "gm" : "player"
                };
            }
            game.socket.emit(`module.${MODULE_ID}`, { type: "submissionUpdate", submissions });
        } else {
            restApp._characterChoices?.set(characterId, activityId);
            restApp._lockedCharacters = restApp._lockedCharacters ?? new Set();
            restApp._lockedCharacters.add(characterId);
            const choicesPayload = Object.fromEntries(restApp._characterChoices);
            Logger.log(`ionrift-respite | _autoCommitCraftResult EMIT`, {
                activityId,
                choicesPayload,
                characterId
            });
            game.socket.emit(`module.${MODULE_ID}`, {
                type: "activityChoice",
                userId: game.user.id,
                choices: choicesPayload,
                craftingResults: { [characterId]: result }
            });
            ui.notifications.info(`${this._actor?.name}'s activity submitted.`);
        }
        if (restApp.rendered) restApp.render();
        // activityChoice socket is GM-only; refresh overlays locally so committed players see faded stations.
        if (restApp._phase === "activity" && isStationLayerActive()) {
            restApp._refreshStationOverlayForFocusChange?.();
        }
    }

    static async #onCraftClose() {
        if (this._craftRollPending || this._feastServeInFlight) return;
        await this._autoCommitCraftResult();

        // Restore pre-craft dialog width
        if (this._preCraftWidth) {
            this.setPosition({ width: this._preCraftWidth });
            this._preCraftWidth = null;
        }
        this.close();
    }

    static #onSwitchStationPanelTab(event, target) {
        const tab = target?.dataset?.tab;
        if (!tab) return;
        if (target.disabled || target.getAttribute("aria-disabled") === "true") return;
        if (this._craftRollPending) return;
        this._stationPanelTab = tab;
        if (tab !== "fire") this._restApp?.setStationFirePreviewLevel?.(null);

        // Cooking tab with utensils → auto-enter crafting split panel (fresh session only).
        // If a craft already resolved this session, keep result state so Rations ↔ Cooking
        // tab switches do not wipe the finished craft before Close commits the activity.
        const canEnterCookingCraft = (this._cookingAvailable?.length ?? 0) > 0;
        const craftBlocked = this._restApp?.hasCompletedCrafting?.(this._actor?.id);
        if (tab === "cooking" && this._actorHasCookingUtensils && !this._actorChoiceLocked && canEnterCookingCraft && !craftBlocked) {
            this._dialogState = "crafting";
            if (!this._craftHasCrafted) {
                const cookId = "act_cook";
                this._selectedActivityId = cookId;
                this._followUpValue = null;
                this._craftProfession  = "cooking";
                this._craftRecipeId    = null;
                this._craftRisk        = "standard";
                this._craftResult      = null;
                this._craftCommitted   = false;
                this._craftRollPending = false;
                this._craftShowMissing = false;
                this._partyMealOutcomeResolved = false;
                this._preCraftWidth    = this.position?.width ?? DIALOG_WIDTH;
            }
        } else {
            // Switching away from cooking → reset to list state
            this._dialogState = "list";
            this._selectedActivityId = null;
        }

        this.render();
    }

    static async #onSetFireLevel(event, target) {
        if (!game.user.isGM) return;
        if (!this._restApp?.changeFireLevelDuringActivity) return;
        const level = target?.dataset?.fireLevel
            ?? target?.closest?.("[data-fire-level]")?.dataset?.fireLevel;
        if (!level || !["embers", "campfire", "bonfire"].includes(level)) return;
        if (target.disabled) return;
        try {
            const result = await this._restApp.changeFireLevelDuringActivity(level);
            if (result?.ok) {
                void this.render(true);
            } else if (result?.error && !result?.cancelled) {
                console.warn(`${MODULE_ID} | setFireLevel`, result.error);
            }
        } catch (e) {
            console.warn(`${MODULE_ID} | setFireLevel`, e);
        }
    }

    static #onRequestFireLevel(event, target) {
        if (game.user.isGM) return;
        const level = target?.dataset?.fireLevel
            ?? target?.closest?.("[data-fire-level]")?.dataset?.fireLevel;
        if (!level || !["embers", "campfire", "bonfire"].includes(level)) return;
        if (target.disabled) return;
        game.socket.emit(`module.${MODULE_ID}`, {
            type: "activityFireLevelRequest",
            userId: game.user.id,
            fireLevel: level
        });
        this._restApp?.setStationFirePreviewLevel?.(null);
        ui.notifications.info("Fire change sent to the GM.");
    }

    /**
     * Activity-phase campfire station: select a fire tier to preview its comfort and
     * encounter impact on the header before committing with Set or Request. Re-clicking
     * the previewed tier clears the preview. Local only; never broadcast.
     */
    static #onPreviewFireLevel(event, target) {
        const level = target?.dataset?.fireLevel
            ?? target?.closest?.("[data-fire-level]")?.dataset?.fireLevel;
        if (!level || !["embers", "campfire", "bonfire"].includes(level)) return;
        if (!this._restApp?.setStationFirePreviewLevel) return;
        const cur = this._restApp._stationFirePreviewLevel ?? null;
        this._restApp.setStationFirePreviewLevel(cur === level ? null : level);
        void this.render(true);
    }

    static async #onSubmitStationRations() {
        const actorId = this._actor?.id;
        if (!actorId || !this._restApp?.submitActivityMealRationsFromStation) return;
        await this._restApp.submitActivityMealRationsFromStation(actorId);
        await this.render(true);
        await this._closeIfEmptyHubAfterRender();
    }

    static async #onSubmitWorkbenchIdentify() {
        const actorId = this._actor?.id;
        if (!actorId || !this._restApp?.submitWorkbenchIdentifyFromStation) return;
        await this._restApp.submitWorkbenchIdentifyFromStation(actorId);
        await this.render(true);
    }

    static async #onWorkbenchIdentifyRemovePotion(event, target) {
        const actorId = this._actor?.id;
        if (!actorId || !this._restApp?.removeWorkbenchIdentifyPotionFromStation) return;
        this._restApp.removeWorkbenchIdentifyPotionFromStation(actorId);
        await this.render(true);
    }

    static async #onDismissWorkbenchIdentifyAck() {
        const actorId = this._actor?.id;
        if (!actorId || !this._restApp?.dismissWorkbenchIdentifyAcknowledgement) return;
        const ack = this._restApp._workbenchIdentifyAcknowledge?.get(actorId);
        if (!ack || Date.now() < ack.revealAt) return;
        this._restApp.dismissWorkbenchIdentifyAcknowledgement(actorId);
        await this.render(true);
    }

    static async #onReclaimCampGearFromDialog(event, target) {
        const app = this._restApp;
        if (!app) return;
        const { RestSetupApp } = await import("./RestSetupApp.js");
        await RestSetupApp.reclaimCampGearFromDialog(app, event, target);
        if (app._phase === "activity" && typeof app.refreshCanvasStationOverlaysIfActivity === "function") {
            app.refreshCanvasStationOverlaysIfActivity();
        }
        await this.render(true);
    }

    static async #onStationDetectMagicScan(event) {
        if (!this._restApp) return;
        const btn = event?.currentTarget ?? null;
        btn?.classList.add("is-casting");
        spawnDetectMagicCastRipple(btn);
        if (this._restApp._magicScanComplete) {
            this._restApp._clearDetectMagicScanSession();
        } else {
            if (!this._restApp.runDetectMagicScan) return;
            await this._restApp.runDetectMagicScan();
        }
        await this.render(true);
    }

    static async #onStationIdentifyScannedItem(event, target) {
        const actorId = target?.dataset?.actorId;
        const itemId = target?.dataset?.itemId;
        if (!actorId || !itemId || !this._restApp?.identifyScannedMagicItem) return;
        await this._restApp.identifyScannedMagicItem(actorId, itemId);
        await this.render(true);
    }

    static async #onServeToParty(event, target) {
        const itemId = target.dataset.itemId;
        const actorId = target.dataset.actorId;
        if (!itemId || !actorId) return;

        const cookActor = game.actors.get(actorId);
        if (!cookActor) return;

        if (!game.user.isGM && !cookActor.isOwner) {
            ui.notifications.warn("Only the GM or the cook's player can serve party meals.");
            return;
        }

        const sourceItem = cookActor.items.get(itemId);
        if (!sourceItem) return;

        const partyActors = getPartyActors().filter(a => a.id !== actorId);
        if (!partyActors.length) {
            ui.notifications.warn("No other party members to serve.");
            return;
        }

        const qty = sourceItem.system?.quantity ?? 1;
        const servings = Math.min(qty, partyActors.length);
        const recipients = partyActors.slice(0, servings);

        if (servings < partyActors.length) {
            console.warn(`[Respite:Serve] Only ${servings} serving${servings !== 1 ? "s" : ""} available, not enough for the full party (${partyActors.length} members).`);
            ui.notifications.warn(`Only ${servings} serving${servings !== 1 ? "s" : ""} available. Not enough for the full party.`);
        }

        const itemData = sourceItem.toObject();
        itemData.system = { ...itemData.system, quantity: 1 };
        delete itemData._id;

        if (game.user.isGM) {
            const ledger = this._restApp?._grantLedger;
            const itemRef = itemData.flags?.[MODULE_ID]?.itemRef ?? itemData.name ?? "feast_serving";
            for (const recipient of recipients) {
                const slotKey = GrantLedger.mealSlotKey(recipient.id, itemRef);
                const grant = [{
                    name: itemData.name,
                    type: itemData.type ?? "loot",
                    img: itemData.img ?? "icons/svg/item-bag.svg",
                    quantity: 1,
                    system: { ...(itemData.system ?? {}), quantity: 1 },
                    flags: itemData.flags ?? {}
                }];
                guardEmbedItems(grant);
                const perform = () => ItemOutcomeHandler.grantItemsToActor(recipient, grant);
                if (ledger) {
                    await ledger.grantOnce(slotKey, perform);
                } else {
                    await perform();
                }
            }
        } else {
            emitFeastServeRequest({
                cookActorId: actorId,
                itemSnapshot: itemData,
                partyIds: recipients.map(a => a.id),
                feastMode: "partyServe"
            });
        }

        if (qty - servings > 0) {
            await sourceItem.update({ "system.quantity": qty - servings });
        } else {
            await cookActor.deleteEmbeddedDocuments("Item", [itemId]);
        }

        await ChatMessage.create({
            content: `<div class="respite-recovery-chat"><p><i class="fas fa-utensils"></i> <strong>${cookActor.name}</strong> serves <strong>${sourceItem.name}</strong> to the party.</p></div>`,
            speaker: ChatMessage.getSpeaker({ actor: cookActor })
        });

        notifyStationMealChoicesUpdated();
        await this.render(true);
    }

    static async #onFeastServeNow() {
        if (this._partyMealOutcomeResolved || this._feastServeInFlight) return;
        const craftResult = this._craftResult;
        if (!craftResult?.output) return;

        const actor = game.actors.get(this._actor?.id);
        if (!actor) return;

        const item = actor.items?.find(i =>
            i.name === craftResult.output?.name
            && i.flags?.[MODULE_ID]?.partyMeal === true
        );
        if (!item) {
            ui.notifications.warn("Could not find the feast item in inventory.");
            return;
        }

        this._feastServeInFlight = true;
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
            await this._autoCommitCraftResult();
            this._partyMealOutcomeResolved = true;

            // ── Sync meal state: credit feast satiation for all recipients ──
            const restApp = this._restApp;
            if (restApp) {
                const feastFlags = snapshot.flags?.[MODULE_ID] ?? {};
                const satiates = Array.isArray(feastFlags.satiates) ? feastFlags.satiates : [];
                if (satiates.length) {
                    _creditFeastMealState(restApp, partyIds, satiates);
                }
            }

            await this.render(true);
        } finally {
            this._feastServeInFlight = false;
        }
    }

    /**
     * Click-to-identify from the Identify tab's party item list.
     * Identifies the item on the owner's actor and whispers the owner.
     */
    static async #onIdentifyPoolItem(event, target) {
        const itemActorId = target.closest("[data-item-actor-id]")?.dataset.itemActorId;
        const itemId = target.closest("[data-item-id]")?.dataset.itemId;
        if (!itemActorId || !itemId) return;
        const caster = this._actor;
        const ownerActor = game.actors.get(itemActorId);
        if (!ownerActor) {
            ui.notifications.warn("Item owner not found.");
            return;
        }
        const itemBefore = ownerActor.items.get(itemId);
        if (!itemBefore) {
            ui.notifications.warn("Item not found.");
            return;
        }
        // Use the WorkbenchDelegate's existing identify pipeline
        const wb = this._restApp?._workbench;
        if (!wb) return;
        const did = await wb.identifyItem(itemActorId, itemId);
        if (!did) return;
        const itemAfter = ownerActor.items.get(itemId);
        const trueName = itemAfter?.name ?? itemBefore.name;
        ui.notifications.info(`Identified: ${trueName}`);
        // Notify the item owner when a different caster identifies their item
        if (caster && itemActorId !== caster.id) {
            const ownerUsers = game.users.filter(
                u => !u.isGM && ownerActor.testUserPermission(u, "OWNER")
            );
            if (ownerUsers.length > 0) {
                ChatMessage.create({
                    content: `<div class="ionrift-identify-reveal"><i class="fas fa-hat-wizard"></i> <strong>${caster.name}</strong> identified your <strong>${trueName}</strong>.</div>`,
                    speaker: ChatMessage.getSpeaker({ alias: "Respite" }),
                    whisper: ownerUsers.map(u => u.id)
                });
            }
        }
        if (this.rendered) this.render();
    }

    _onRender(context, options) {
        super._onRender?.(context, options);
        this._attachTrackers();
        // Allow user to drag the dialog by its header; stops auto-tracking to token
        const header = this.element?.querySelector?.(".window-header");
        if (header && !header._ionriftDragBound) {
            header._ionriftDragBound = true;
            header.addEventListener("pointerdown", () => { this._userDragged = true; });
        }
        // Force width on DOM. Foundry's setPosition doesn't reliably expand beyond content width.
        if (this._dialogState === "crafting"
            || (this._station?.id === "cooking_station" && this._stationHasCooking)) {
            const el = this.element;
            if (el) {
                el.style.width = `${CRAFT_SPLIT_WIDTH}px`;
                el.style.maxWidth = `${CRAFT_SPLIT_WIDTH}px`;
                el.style.minWidth = `${CRAFT_SPLIT_WIDTH}px`;
            }
        }
        queueMicrotask(() => this._bindStationMealIfNeeded());
        queueMicrotask(() => this._bindStationWorkbenchIdentifyIfNeeded());
        queueMicrotask(() => this._scheduleWorkbenchAckRevealIfNeeded());
        queueMicrotask(() => this._bindFollowUpSelect());
        queueMicrotask(() => this._bindCampGearIfNeeded());
        queueMicrotask(() => this._bindStationArmorTogglesIfNeeded());
    }

    _bindCampGearIfNeeded() {
        if (!this.rendered || !this.element) return;
        if (this._station?.id !== "campfire" || !this._restApp?._bindCampDragHandlers) return;
        if (!this.element.querySelector("[data-camp-gear-row]")) return;
        this._restApp._bindCampDragHandlers(this.element);
    }

    _bindStationArmorTogglesIfNeeded() {
        if (!this.rendered || !this.element || this._dialogState !== "detail") return;
        if (!this.element.querySelector(".btn-armor-toggle")) return;
        if (!this._restApp?._bindArmorToggleHandlers) return;
        this._restApp._bindArmorToggleHandlers(this.element, () => {
            this._restApp.render();
            void this.render(true);
        });
    }

    _bindFollowUpSelect() {
        if (!this.rendered || !this.element || this._dialogState !== "detail") return;
        const sel = this.element.querySelector(".station-followup-input");
        if (!sel) return;
        sel.addEventListener("change", (e) => {
            this._followUpValue = e.target.value || null;
        });
        const radios = this.element.querySelectorAll("input.station-followup-radio");
        for (const r of radios) {
            r.addEventListener("change", (e) => {
                if (e.target.checked) this._followUpValue = e.target.value || null;
            });
        }
    }

    _bindStationMealIfNeeded() {
        if (!this.rendered || !this.element) return;
        if (!this._showStationTabs || this._stationPanelTab !== "meal") return;
        if (!this._restApp?._bindMealDragDrop) return;
        this._restApp._bindMealDragDrop(this.element);
    }

    _bindStationWorkbenchIdentifyIfNeeded() {
        if (!this.rendered || !this.element) return;
        if (this._station?.id !== "workbench" || (this._stationPanelTab !== "identify" && this._stationPanelTab !== "examine")) return;
        if (!this._restApp?._bindWorkbenchIdentifyDragDrop) return;
        this._restApp._bindWorkbenchIdentifyDragDrop(this.element);
    }

    _clearWorkbenchAckRevealTimer() {
        if (this._wbAckRevealTimer) {
            clearTimeout(this._wbAckRevealTimer);
            this._wbAckRevealTimer = null;
        }
    }

    /** Re-render when the post-identify Continue button should unlock. */
    _scheduleWorkbenchAckRevealIfNeeded() {
        if (!this.rendered || !this.element) return;
        if (this._station?.id !== "workbench" || (this._stationPanelTab !== "identify" && this._stationPanelTab !== "examine")) return;
        const actorId = this._actor?.id;
        if (!actorId || !this._restApp?._workbenchIdentifyAcknowledge) return;
        const ack = this._restApp._workbenchIdentifyAcknowledge.get(actorId);
        if (!ack) return;
        if (Date.now() >= ack.revealAt) return;
        this._clearWorkbenchAckRevealTimer();
        const delay = Math.max(40, ack.revealAt - Date.now());
        this._wbAckRevealTimer = setTimeout(() => {
            this._wbAckRevealTimer = null;
            if (!this.rendered) return;
            void this.render(true);
        }, delay);
    }

    /** Idempotent: starts canvasPan + ticker follow for the station token anchor. */
    _attachTrackers() {
        if (!this._stationToken || !canvas?.ready || this._trackStarted) return;
        this._trackStarted = true;
        this._canvasPanFn = () => this._syncTrackPosition();
        this._tickerFn     = () => this._syncTrackPosition();
        Hooks.on("canvasPan", this._canvasPanFn);
        canvas.app.ticker.add(this._tickerFn);

        if (!this._mealHookBound) {
            this._mealHookBound = () => {
                if (!this.rendered) return;
                void this.render(true).then(() => {
                    void this._closeIfEmptyHubAfterRender();
                });
            };
            Hooks.on(`${MODULE_ID}.stationMealChoicesTouched`, this._mealHookBound);
            Hooks.on(`${MODULE_ID}.workbenchIdentifyStagingTouched`, this._mealHookBound);
        }

        // GM: when a different party token is selected, re-resolve the dialog's actor
        if (game.user?.isGM && !this._controlTokenHookBound) {
            this._controlTokenHookBound = (_token, controlled) => {
                if (!controlled || !this.rendered) return;
                const newActor = _token?.actor;
                if (!newActor || newActor.type !== "character") return;
                if (newActor.id === this._actor?.id) return;
                // Only swap if this actor is in the party
                const partyIds = new Set(getPartyActors().map(a => a.id));
                if (!partyIds.has(newActor.id)) return;
                Logger.log(`ionrift-respite | Station dialog: GM token switch ${this._actor?.name} → ${newActor.name}`);
                this._actor = newActor;
                // Rebuild utensil state for the new actor
                this._actorHasCookingUtensils = this._stationHasCooking && this._station?.id === "cooking_station"
                    ? canPlaceStation(newActor, "cookingArea")
                    : false;
                // Reset to list state so they start fresh
                this._dialogState = "list";
                this._selectedActivityId = null;
                this.render();
            };
            Hooks.on("controlToken", this._controlTokenHookBound);
        }
    }

    _stopTokenTracking() {
        this._clearWorkbenchAckRevealTimer();
        if (this._tickerFn && canvas?.app?.ticker) {
            canvas.app.ticker.remove(this._tickerFn);
        }
        this._tickerFn = null;
        if (this._canvasPanFn) {
            Hooks.off("canvasPan", this._canvasPanFn);
        }
        this._canvasPanFn = null;
        this._trackStarted = false;
        if (this._mealHookBound) {
            Hooks.off(`${MODULE_ID}.stationMealChoicesTouched`, this._mealHookBound);
            Hooks.off(`${MODULE_ID}.workbenchIdentifyStagingTouched`, this._mealHookBound);
            this._mealHookBound = null;
        }
        if (this._controlTokenHookBound) {
            Hooks.off("controlToken", this._controlTokenHookBound);
            this._controlTokenHookBound = null;
        }
    }

    /**
     * Client (viewport CSS) pixel position for the token anchor used to place the dialog.
     * Uses Canvas#clientCoordinatesFromCanvas when present. Do not multiply PIXI global
     * positions by stage scale; getGlobalPosition already includes pan and zoom.
     *
     * @param {Token} stationToken
     * @returns {{ x: number, y: number } | null}
     */
    static _anchorClientPoint(stationToken) {
        if (!stationToken || !canvas?.ready) return null;
        const view = canvas.app?.view;
        if (!view) return null;
        const rect = view.getBoundingClientRect();

        if (typeof canvas.clientCoordinatesFromCanvas === "function") {
            const c = canvas.clientCoordinatesFromCanvas(stationToken.center);
            return { x: c.x, y: c.y };
        }

        const tp = stationToken.getGlobalPosition();
        const scaleX = rect.width / view.width;
        const scaleY = rect.height / view.height;
        return {
            x: rect.left + tp.x * scaleX,
            y: rect.top + tp.y * scaleY
        };
    }

    /**
     * @param {Token} stationToken
     * @param {number} width
     * @param {number} height
     * @returns {{ left: number, top: number, rawLeft: number, rawTop: number, clamped: boolean } | null}
     */
    static _dialogScreenRect(stationToken, width, height) {
        const anchor = StationActivityDialog._anchorClientPoint(stationToken);
        if (!anchor) return null;

        const rawLeft = anchor.x - width / 2;
        const rawTop  = anchor.y - height / 2;
        const pad = 8;
        const left = Math.max(pad, Math.min(window.innerWidth - width - pad, rawLeft));
        const top  = Math.max(pad, Math.min(window.innerHeight - height - pad, rawTop));
        return {
            left,
            top,
            rawLeft,
            rawTop,
            clamped: left !== rawLeft || top !== rawTop
        };
    }

    /**
     * @param {number} left
     * @param {number} top
     * @param {number} w
     * @param {number} h
     * @returns {number} visible area ratio 0..1
     */
    static _visibleRatio(left, top, w, h) {
        const ix = Math.max(0, Math.min(window.innerWidth, left + w) - Math.max(0, left));
        const iy = Math.max(0, Math.min(window.innerHeight, top + h) - Math.max(0, top));
        if (w <= 0 || h <= 0) return 0;
        return (ix * iy) / (w * h);
    }

    _readDialogSize() {
        const el = this.element;
        const w = el?.offsetWidth > 0 ? el.offsetWidth : DIALOG_WIDTH;
        const h = el?.offsetHeight > 0 ? el.offsetHeight : EST_HEIGHT;
        return { w, h };
    }

    _syncTrackPosition() {
        if (!this.rendered) return;
        if (!this._stationToken || !canvas?.ready) return;
        if (!this._stationToken.document?.parent) {
            this.close();
            return;
        }

        const { w, h } = this._readDialogSize();
        const pos = StationActivityDialog._dialogScreenRect(this._stationToken, w, h);
        if (!pos) return;

        const rawVis = StationActivityDialog._visibleRatio(pos.rawLeft, pos.rawTop, w, h);
        if (rawVis < VIS_CLOSE_RATIO) {
            this.close();
            return;
        }

        // If user dragged the dialog, only keep the visibility check (close if off-screen)
        // but skip repositioning so the user's drag position is preserved.
        if (!this._userDragged) {
            this.setPosition({ left: pos.left, top: pos.top });
        }
    }

    async close(options = {}) {
        if (this._craftRollPending) {
            ui.notifications.info("Wait for the dice to finish.");
            return;
        }
        // Safety net: commit crafting result even when closed via the window X button.
        if (this._craftHasCrafted && !this._craftCommitted) {
            await this._autoCommitCraftResult();
        }
        this._stopTokenTracking();
        this._restApp?.setStationFirePreviewLevel?.(null);
        _openDialog = null;
        return super.close(options);
    }

    /**
     * Re-query {@link ActivityResolver} using live {@link RestSetupApp#_fireLevel}.
     * Canvas {@link restSession} snapshots fire at layer activation; fire tier changes during
     * activity only update the rest app until this runs.
     */
    _resyncStationActivitiesFromRestApp() {
        const resolver = this._restApp?._activityResolver;
        if (!resolver || !this._actor) return;
        const lists = StationActivityDialog._computeStationActivityLists(
            this._station,
            this._actor,
            resolver,
            this._restApp,
            this._restSession
        );
        this._actorChoiceLocked = lists.actorChoiceLocked;
        this._available = lists.generalAvailable;
        this._faded = lists.generalFaded;
        this._cookingAvailable = lists.cookingAvailable;
        this._cookingFaded = lists.cookingFaded;
        if (this._restSession && typeof this._restSession === "object") {
            this._restSession.fireLevel = this._restApp?._fireLevel ?? this._restSession.fireLevel ?? "unlit";
        }
    }

    /**
     * @returns {{ generalAvailable: Object[], generalFaded: Object[], cookingAvailable: Object[], cookingFaded: Object[], actorChoiceLocked: string|null }}
     */
    static _computeStationActivityLists(station, actor, activityResolver, restApp, restSession) {
        if (!activityResolver) {
            return {
                generalAvailable: [],
                generalFaded: [],
                cookingAvailable: [],
                cookingFaded: [],
                actorChoiceLocked: null
            };
        }
        const restType = restSession?.restType ?? "long";
        const fireLevel = restApp?._fireLevel ?? restSession?.fireLevel ?? "unlit";
        const isFireLit = !!(fireLevel && fireLevel !== "unlit");
        const forageOpts = restApp?._forageResolverOpts?.() ?? {};
        const { available: allAvail, faded: allFaded } = activityResolver
            .getAvailableActivitiesWithFaded(actor, restType, { isFireLit, fireLevel, ...forageOpts });

        const stationIds = new Set(station?.activities ?? []);
        let available = allAvail.filter(a => stationIds.has(a.id));
        let faded = allFaded.filter(a => stationIds.has(a.id));

        let actorChoiceLocked = null;
        const craftDone = actor?.id && restApp?.hasCompletedCrafting?.(actor.id);
        if (actor?.id && (restApp?._characterChoices?.has(actor.id) || craftDone)) {
            const chosenId = restApp._characterChoices.get(actor.id)
                ?? (craftDone ? "act_cook" : null);
            const resolver = restApp._activityResolver;
            const chosenAct = resolver?.activities?.get(chosenId);
            actorChoiceLocked = chosenAct?.name ?? chosenId;
            // Move all available activities to faded so they show dimmed/read-only
            for (const act of available) {
                faded.push({ ...act, fadedHint: `Already assigned to ${actorChoiceLocked}` });
            }
            available = [];
        }

        const order = station?.activities ?? [];
        const stationRank = (id) => {
            const idx = order.indexOf(id);
            return idx === -1 ? 999 : idx;
        };
        available.sort((a, b) => stationRank(a.id) - stationRank(b.id));
        faded.sort((a, b) => stationRank(a.id) - stationRank(b.id));

        const cookingAvailable = available.filter(a => COOK_ACTIVITY_IDS.has(a.id));
        const cookingFaded = faded.filter(a => COOK_ACTIVITY_IDS.has(a.id));
        const generalAvailable = available.filter(a => !COOK_ACTIVITY_IDS.has(a.id));
        const generalFaded = faded.filter(a => !COOK_ACTIVITY_IDS.has(a.id));

        return {
            generalAvailable,
            generalFaded,
            cookingAvailable,
            cookingFaded,
            actorChoiceLocked
        };
    }

    /**
     * Open the dialog for a station click.
     * Closes any previously open dialog first.
     *
     * @param {Object} station         - CAMP_STATIONS entry
     * @param {Actor}  actor           - The choosing actor
     * @param {Object} activityResolver - ActivityResolver instance (for filtering)
     * @param {Object} restSession     - { fireLevel, restType, ... }
     * @param {Token}  stationToken    - The canvas token that was clicked (for positioning)
     * @param {object|null} restApp - parent RestSetupApp instance
     * @param {string|null} canvasStationId - station id (canvas hint; list comes from station.activities)
     */
    static async openForStation(station, actor, activityResolver, restSession, stationToken, restApp, canvasStationId = null) {
        if (_openDialog) {
            await _openDialog.close();
            _openDialog = null;
        }

        const lists = StationActivityDialog._computeStationActivityLists(
            station,
            actor,
            activityResolver,
            restApp,
            restSession
        );
        const actorChoiceLocked = lists.actorChoiceLocked;
        const generalAvailable = lists.generalAvailable;
        const generalFaded = lists.generalFaded;
        const cookingAvailable = lists.cookingAvailable;
        const cookingFaded = lists.cookingFaded;

        const trackFood = game.settings.get(MODULE_ID, "trackFood");
        const workbenchHub = station.id === "workbench" && isWorkbenchExamineUiEnabled();
        const longRest = (restSession?.restType ?? "long") !== "short";
        const campfireHub = station.id === "campfire"
            && longRest
            && restApp?._phase === "activity";
        const showStationTabs = ((station.id === "cooking_station" && trackFood) || workbenchHub || campfireHub);
        const stationHasCooking = station.id === "cooking_station"
            ? !!(stationToken?.document?.flags?.[MODULE_ID]?.partyHasCookingUtensils)
            : true;
        const actorHasCookingUtensils = stationHasCooking && station.id === "cooking_station" && actor
            ? (canPlaceStation(actor, "cookingArea") || actorHasBrewingTools(actor))
            : false;

        let initialStationTab = "activity";
        if (showStationTabs && station.id === "cooking_station") {
            const mealCardOpen = restApp?.getStationMealCardForActor?.(actor?.id);
            const rationsDoneOpen = !!(mealCardOpen?.allDaysConsumed || mealCardOpen?.playerSubmitted);
            initialStationTab = (rationsDoneOpen && stationHasCooking) ? "cooking" : "meal";
        }
        if (workbenchHub) {
            if (actorChoiceLocked || generalAvailable.length === 0) {
                initialStationTab = "examine";
            } else if (isWorkbenchIdentifyUiEnabled() && generalAvailable.length === 0) {
                initialStationTab = "identify";
            }
        }
        if (campfireHub) initialStationTab = "camp";

        let dialogWidth = DIALOG_WIDTH;
        if (showStationTabs && station.id === "cooking_station") {
            dialogWidth = CRAFT_SPLIT_WIDTH;
        } else if (workbenchHub) {
            dialogWidth = 350;
        } else if (station.id === "campfire") {
            dialogWidth = CAMPFIRE_DIALOG_WIDTH;
        }

        const partyState = restApp?.getPartyStateForAdvisory?.()
            ?? buildPartyState([], new Map(), 14);

        if (stationToken && canvas?.ready) {
            const pre = StationActivityDialog._dialogScreenRect(stationToken, dialogWidth, EST_HEIGHT);
            if (pre) {
                const rawVis = StationActivityDialog._visibleRatio(pre.rawLeft, pre.rawTop, dialogWidth, EST_HEIGHT);
                if (rawVis < PAN_TRIGGER_RATIO || pre.clamped) {
                    try {
                        await canvas.animatePan({
                            x: stationToken.center.x,
                            y: stationToken.center.y,
                            duration: 200
                        });
                    } catch (e) {
                        console.warn(`${MODULE_ID} | Station dialog pan`, e);
                    }
                }
            }
        }

        const pos = StationActivityDialog._dialogScreenRect(stationToken, dialogWidth, EST_HEIGHT);
        const left = pos?.left ?? (window.innerWidth / 2 - dialogWidth / 2);
        const top  = pos?.top ?? (window.innerHeight / 2 - EST_HEIGHT / 2);

        const sid = canvasStationId ?? station.id;
        const dialog = new StationActivityDialog(
            {
                station,
                actor,
                available: generalAvailable,
                faded: generalFaded,
                cookingAvailable,
                cookingFaded,
                showStationTabs,
                initialStationTab,
                actorHasCookingUtensils,
                stationHasCooking,
                restSession,
                restApp,
                canvasStationId: sid,
                partyState,
                stationToken,
                actorChoiceLocked
            },
            {
                position: { left, top, width: dialogWidth },
                window:   { title: station?.label ?? "Choose Activity" }
            }
        );
        _openDialog = dialog;
        Logger.log(`ionrift-respite | openForStation width`, { requested: dialogWidth, defaultWidth: DIALOG_WIDTH });
        await dialog.render(true);
        // Force width. ApplicationV2 DEFAULT_OPTIONS may cap the constructor-passed position.
        if (dialogWidth !== DIALOG_WIDTH) {
            dialog.setPosition({ width: dialogWidth });
            Logger.log(`ionrift-respite | openForStation setPosition forced`, { width: dialogWidth, actual: dialog.position?.width });
        }
        dialog._attachTrackers();
        dialog._syncTrackPosition();
        return dialog;
    }
}
