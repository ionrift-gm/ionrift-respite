import { StationDialogContextMethods } from "./StationDialogContextBuilder.js";
import { StationDialogActionMethods } from "./StationDialogActions.js";
import { Logger } from "../../utils/Logger.js";
import { MODULE_ID } from "../../data/moduleId.js";

import {
    buildPartyState,
    isWorkbenchExamineUiEnabled,
    isWorkbenchIdentifyUiEnabled
} from "../../data/RestConstants.js";
import { cardHintTakenBy } from "../../data/activityCardHint.js";
import { canPlaceStation, actorHasBrewingTools } from "../../services/camp/props/CompoundCampPlacer.js";
import { getPartyActors } from "../../services/party/partyActors.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Refresh open station dialog after meal drag without full rest window render. */
export function notifyStationMealChoicesUpdated() {
    Hooks.callAll(`${MODULE_ID}.stationMealChoicesTouched`);
}

/** Workbench identify staging changed; refresh open station dialog. */
export function notifyWorkbenchIdentifyStagingTouched() {
    Hooks.callAll(`${MODULE_ID}.workbenchIdentifyStagingTouched`);
}


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


export async function closeOpenStationDialog() {
    const dlg = _openDialog;
    if (!dlg) return;
    await dlg.close();
}

export const COOK_ACTIVITY_IDS = new Set(["act_cook", "act_brew"]);

export const DIALOG_WIDTH = 320;
/** Campfire dialog: comfort + 3-column gear grid; wider than default. */
const CAMPFIRE_DIALOG_WIDTH = 400;
/** Crafting split panel needs a wider dialog to fit the master-detail layout. */
export const CRAFT_SPLIT_WIDTH = 760;
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
            title: "ionrift-respite.stationActivity.dialogTitle",
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
            setColdCamp: StationActivityDialog.#onSetColdCamp,
            requestColdCamp: StationActivityDialog.#onRequestColdCamp,
            submitStationRations: StationActivityDialog.#onSubmitStationRations,
            stationDetectMagicScan: StationActivityDialog.#onStationDetectMagicScan,
            stationIdentifyScannedItem: StationActivityDialog.#onStationIdentifyScannedItem,
            submitWorkbenchIdentify: StationActivityDialog.#onSubmitWorkbenchIdentify,
            workbenchIdentifyRemovePotion: StationActivityDialog.#onWorkbenchIdentifyRemovePotion,
            dismissWorkbenchIdentifyAck: StationActivityDialog.#onDismissWorkbenchIdentifyAck,
            reclaimCampGear: StationActivityDialog.#onReclaimCampGearFromDialog,
            openSpellbook: StationActivityDialog.#onOpenSpellbook,
            craftSelectRecipe: StationActivityDialog.#onCraftSelectRecipe,
            craftSelectRisk: StationActivityDialog.#onCraftSelectRisk,
            craftCommit: StationActivityDialog.#onCraftCommit,
            craftToggleMissing: StationActivityDialog.#onCraftToggleMissing,
            craftClose: StationActivityDialog.#onCraftClose,
            openMonsterCookbook: StationActivityDialog.#onOpenMonsterCookbook,
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
        const preservePos = this._userDragged && this.rendered && this.element;
        let savedPos = null;
        if (preservePos) {
            const rect = this.element.getBoundingClientRect();
            savedPos = {
                left: Math.round(rect.left),
                top: Math.round(rect.top),
                width: this.element.offsetWidth || this.position?.width
            };
        }
        const preserveCraftScroll = this._dialogState === "crafting"
            && this.rendered
            && !options.resetCraftScroll;
        if (preserveCraftScroll) {
            const panel = this.element?.querySelector(".station-crafting-panel.crafting-split");
            this._craftListScrollTop = panel?.querySelector(".crafting-list-panel")?.scrollTop ?? 0;
            this._craftDetailScrollTop = panel?.querySelector(".crafting-detail-panel")?.scrollTop ?? 0;
        }
        const result = await super.render(options);
        if (savedPos && Number.isFinite(savedPos.left) && Number.isFinite(savedPos.top)) {
            this.setPosition(savedPos);
        }
        if (preserveCraftScroll) {
            queueMicrotask(() => {
                const panel = this.element?.querySelector(".station-crafting-panel.crafting-split");
                const listEl = panel?.querySelector(".crafting-list-panel");
                const detailEl = panel?.querySelector(".crafting-detail-panel");
                if (listEl && this._craftListScrollTop > 0) listEl.scrollTop = this._craftListScrollTop;
                if (detailEl && this._craftDetailScrollTop > 0) detailEl.scrollTop = this._craftDetailScrollTop;
            });
        }
        this._syncStationFireMinigame();
        return result;
    }

    /** Mount or release the campfire minigame when the Stations Fire tab is active. */
    _syncStationFireMinigame() {
        if (this._station?.id !== "campfire") {
            this._restApp?.releaseStationFireMinigame?.(this);
            return;
        }
        const useMinigame = !!this._restApp?.isStationFireMinigameTab?.();
        const onFireTab = this._stationPanelTab === "fire";
        if (useMinigame && onFireTab && this._dialogState === "list") {
            const host = this.element?.querySelector("[data-station-fire-minigame-host]");
            this._restApp?.mountStationFireMinigame?.(host, this);
        } else {
            this._restApp?.releaseStationFireMinigame?.(this);
        }
    }

    async _prepareContext(...args) { return StationDialogContextMethods._prepareContext.apply(this, args); }
    _buildListContext(...args) { return StationDialogContextMethods._buildListContext.apply(this, args); }
    _buildDetailContext(...args) { return StationDialogContextMethods._buildDetailContext.apply(this, args); }
    _buildResultContext(...args) { return StationDialogContextMethods._buildResultContext.apply(this, args); }
    _formatBuffPreview(...args) { return StationDialogContextMethods._formatBuffPreview.apply(this, args); }
    _buildStationTabs(...args) { return StationDialogContextMethods._buildStationTabs.apply(this, args); }
    _buildActivityAssignments(...args) { return StationDialogContextMethods._buildActivityAssignments.apply(this, args); }
    _buildCraftingContext(...args) { return StationDialogContextMethods._buildCraftingContext.apply(this, args); }
    async _closeIfEmptyHubAfterRender(...args) { return StationDialogContextMethods._closeIfEmptyHubAfterRender.apply(this, args); }

    static #onOpenMonsterCookbook(event, target) { return StationDialogActionMethods.onOpenMonsterCookbook.call(this, event, target); }
    async _onMonstrousFeastCookCompleted(...args) { return StationDialogActionMethods._onMonstrousFeastCookCompleted.apply(this, args); }
    static #onSelectActivity(event, target) { return StationDialogActionMethods.onSelectActivity.call(this, event, target); }
    static async #onConfirm(event, target) { return StationDialogActionMethods.onConfirm.call(this, event, target); }
    static #onBackToList(event, target) { return StationDialogActionMethods.onBackToList.call(this, event, target); }
    static #onDismissResult(event, target) { return StationDialogActionMethods.onDismissResult.call(this, event, target); }
    static #onCraftSelectRecipe(event, target) { return StationDialogActionMethods.onCraftSelectRecipe.call(this, event, target); }
    static async #onCraftSelectRisk(event, target) { return StationDialogActionMethods.onCraftSelectRisk.call(this, event, target); }
    static async #onCraftCommit(event, target) { return StationDialogActionMethods.onCraftCommit.call(this, event, target); }
    static #onCraftToggleMissing(event, target) { return StationDialogActionMethods.onCraftToggleMissing.call(this, event, target); }
    async _autoCommitCraftResult(...args) { return StationDialogActionMethods._autoCommitCraftResult.apply(this, args); }
    static async #onCraftClose(event, target) { return StationDialogActionMethods.onCraftClose.call(this, event, target); }
    static #onSwitchStationPanelTab(event, target) { return StationDialogActionMethods.onSwitchStationPanelTab.call(this, event, target); }
    static async #onSetFireLevel(event, target) { return StationDialogActionMethods.onSetFireLevel.call(this, event, target); }
    static async #onRequestFireLevel(event, target) { return StationDialogActionMethods.onRequestFireLevel.call(this, event, target); }
    static async #onSetColdCamp(event, target) { return StationDialogActionMethods.onSetColdCamp.call(this, event, target); }
    static #onRequestColdCamp(event, target) { return StationDialogActionMethods.onRequestColdCamp.call(this, event, target); }
    static #onPreviewFireLevel(event, target) { return StationDialogActionMethods.onPreviewFireLevel.call(this, event, target); }
    static async #onSubmitStationRations(event, target) { return StationDialogActionMethods.onSubmitStationRations.call(this, event, target); }
    static async #onSubmitWorkbenchIdentify(event, target) { return StationDialogActionMethods.onSubmitWorkbenchIdentify.call(this, event, target); }
    static async #onWorkbenchIdentifyRemovePotion(event, target) { return StationDialogActionMethods.onWorkbenchIdentifyRemovePotion.call(this, event, target); }
    static async #onDismissWorkbenchIdentifyAck(event, target) { return StationDialogActionMethods.onDismissWorkbenchIdentifyAck.call(this, event, target); }
    static async #onReclaimCampGearFromDialog(event, target) { return StationDialogActionMethods.onReclaimCampGearFromDialog.call(this, event, target); }
    static async #onOpenSpellbook(event, target) { return StationDialogActionMethods.onOpenSpellbook.call(this, event, target); }
    static async #onStationDetectMagicScan(event, target) { return StationDialogActionMethods.onStationDetectMagicScan.call(this, event, target); }
    static async #onStationIdentifyScannedItem(event, target) { return StationDialogActionMethods.onStationIdentifyScannedItem.call(this, event, target); }
    static async #onServeToParty(event, target) { return StationDialogActionMethods.onServeToParty.call(this, event, target); }
    static async #onFeastServeNow(event, target) { return StationDialogActionMethods.onFeastServeNow.call(this, event, target); }
    static async #onIdentifyPoolItem(event, target) { return StationDialogActionMethods.onIdentifyPoolItem.call(this, event, target); }

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
                Logger.log(`ionrift-respite | Station dialog: GM token switch ${this._actor?.name} ,  ${newActor.name}`);
                this._actor = newActor;
                // Rebuild utensil state for the new actor
                this._actorHasCookingUtensils = this._stationHasCooking && this._station?.id === "cooking_station"
                    ? canPlaceStation(newActor, "cookingArea")
                    : false;
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
            ui.notifications.info(game.i18n.localize("ionrift-respite.stationActivity.waitForDice"));
            return;
        }
        // Safety net: commit crafting result even when closed via the window X button.
        if (this._craftHasCrafted && !this._craftCommitted) {
            await this._autoCommitCraftResult();
        }
        this._stopTokenTracking();
        this._restApp?.setStationFirePreviewLevel?.(null);
        this._restApp?.releaseStationFireMinigame?.(this);
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
        const resolverOpts = restApp?._activityResolverOpts?.({ isFireLit, fireLevel })
            ?? { isFireLit, fireLevel, ...(restApp?._forageResolverOpts?.() ?? {}) };
        const { available: allAvail, faded: allFaded } = activityResolver
            .getAvailableActivitiesWithFaded(actor, restType, resolverOpts);

        const stationIds = new Set(station?.activities ?? []);
        let available = allAvail.filter(a => stationIds.has(a.id));
        const faded = allFaded.filter(a => stationIds.has(a.id));

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
                faded.push({ ...act, fadedHint: cardHintTakenBy(actorChoiceLocked) });
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
                window:   { title: station?.label ?? game.i18n.localize("ionrift-respite.stationActivity.dialogTitle") }
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
