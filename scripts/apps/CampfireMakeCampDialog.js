/**
 * Make Camp: popup at the campfire pit token (mirrors StationActivityDialog anchoring).
 */

import { StationActivityDialog } from "./StationActivityDialog.js";

const MODULE_ID = "ionrift-respite";
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const DIALOG_WIDTH = 380;
const EST_HEIGHT = 420;
const PAN_TRIGGER_RATIO = 0.55;

let _openMapCampfire = null;

export class CampfireMakeCampDialog extends HandlebarsApplicationMixin(ApplicationV2) {

    static DEFAULT_OPTIONS = {
        id: "ionrift-campfire-make-camp-dialog",
        tag: "div",
        classes: ["ionrift-window", "glass-ui", "ionrift", "ionrift-campfire-map-dialog"],
        window: {
            title: "Campfire",
            resizable: false,
            minimizable: false
        },
        position: {
            width: DIALOG_WIDTH,
            height: "auto"
        },
        actions: {
            campLightFireMap: CampfireMakeCampDialog.#onCampLightFire,
            campPledgeFirewoodMap: CampfireMakeCampDialog.#onCampPledge,
            campReclaimFirewoodMap: CampfireMakeCampDialog.#onCampReclaim,
            campColdCampMap: CampfireMakeCampDialog.#onCampCold
        }
    };

    static PARTS = {
        body: {
            template: `modules/${MODULE_ID}/templates/campfire-make-camp-dialog.hbs`
        }
    };

    /**
     * @param {import("./RestSetupApp.js").RestSetupApp} restApp
     * @param {Token} stationToken
     */
    constructor({ restApp, stationToken } = {}, appOptions = {}) {
        super(appOptions);
        this._restApp = restApp;
        this._stationToken = stationToken;
        this._tickerFn = null;
        this._canvasPanFn = null;
        this._trackStarted = false;
    }

    async _prepareContext() {
        const ctx = this._restApp?.buildCampfireDrawerContextForMapDialog?.() ?? null;
        if (!ctx) {
            return {
                campFireIsLit: false,
                campFireLighters: [],
                campFireTierCards: [],
                mapComfortTierClass: "comfort-rough",
                isGM: !!game.user?.isGM
            };
        }
        return { ...ctx, isGM: !!game.user?.isGM };
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
        if (rawVis < 0.12) {
            this.close();
            return;
        }
        this.setPosition({ left: pos.left, top: pos.top });
    }

    _attachTrackers() {
        if (!this._stationToken || !canvas?.ready || this._trackStarted) return;
        this._trackStarted = true;
        this._canvasPanFn = () => this._syncTrackPosition();
        this._tickerFn = () => this._syncTrackPosition();
        Hooks.on("canvasPan", this._canvasPanFn);
        canvas.app.ticker.add(this._tickerFn);
    }

    _stopTokenTracking() {
        if (this._tickerFn && canvas?.app?.ticker) {
            canvas.app.ticker.remove(this._tickerFn);
        }
        this._tickerFn = null;
        if (this._canvasPanFn) {
            Hooks.off("canvasPan", this._canvasPanFn);
        }
        this._canvasPanFn = null;
        this._trackStarted = false;
    }

    async close(options = {}) {
        this._restApp?._setShowCampfireCanvasPanel?.(false);
        this._stopTokenTracking();
        if (_openMapCampfire === this) {
            _openMapCampfire = null;
        }
        return super.close(options);
    }

    async _onRender(context, options) {
        await super._onRender(context, options);
        this._syncTrackPosition();
    }

    static async #onCampLightFire(event, target) {
        await this._restApp?.runMakeCampLightFireFromUi?.(event, target);
        await this._afterRestAction();
    }

    static async #onCampPledge(event, target) {
        await this._restApp?.runMakeCampPledgeFromUi?.(event, target);
        await this._afterRestAction();
    }

    static async #onCampReclaim() {
        await this._restApp?.runMakeCampReclaimFromUi?.();
        await this._afterRestAction();
    }

    static async #onCampCold() {
        await this._restApp?.runMakeCampColdFromUi?.();
        await this._afterRestAction();
    }

    async _afterRestAction() {
        try {
            await this._restApp?.render?.({ force: true });
        } catch { /* ignore */ }
        try {
            await this.render({ force: true });
        } catch { /* ignore */ }
    }

    /**
     * @param {import("./RestSetupApp.js").RestSetupApp} restApp
     * @param {Token} stationToken
     * @returns {Promise<CampfireMakeCampDialog|null>}
     */
    static async open(restApp, stationToken) {
        if (!restApp || !stationToken) return null;
        if (typeof restApp.buildCampfireDrawerContextForMapDialog !== "function") return null;

        const ctx = restApp.buildCampfireDrawerContextForMapDialog();
        if (!ctx) {
            ui.notifications?.warn("Campfire is not available right now.");
            return null;
        }

        if (_openMapCampfire) {
            try {
                await _openMapCampfire.close();
            } catch { /* ignore */ }
            _openMapCampfire = null;
        }

        if (stationToken && canvas?.ready) {
            const pre = StationActivityDialog._dialogScreenRect(stationToken, DIALOG_WIDTH, EST_HEIGHT);
            if (pre) {
                const rawVis = StationActivityDialog._visibleRatio(pre.rawLeft, pre.rawTop, DIALOG_WIDTH, EST_HEIGHT);
                if (rawVis < PAN_TRIGGER_RATIO || pre.clamped) {
                    try {
                        await canvas.animatePan({
                            x: stationToken.center.x,
                            y: stationToken.center.y,
                            duration: 200
                        });
                    } catch (e) {
                        console.warn(`${MODULE_ID} | Campfire map dialog pan`, e);
                    }
                }
            }
        }

        const pos = StationActivityDialog._dialogScreenRect(stationToken, DIALOG_WIDTH, EST_HEIGHT);
        const left = pos?.left ?? (window.innerWidth / 2 - DIALOG_WIDTH / 2);
        const top  = pos?.top ?? (window.innerHeight / 2 - EST_HEIGHT / 2);

        const dialog = new CampfireMakeCampDialog(
            { restApp, stationToken },
            { position: { left, top, width: DIALOG_WIDTH } }
        );
        _openMapCampfire = dialog;
        restApp._setShowCampfireCanvasPanel?.(false);
        await dialog.render(true);
        dialog._attachTrackers();
        dialog._syncTrackPosition();
        return dialog;
    }

    static closeIfOpen() {
        if (_openMapCampfire) {
            void _openMapCampfire.close();
            _openMapCampfire = null;
        }
    }

    /**
     * @param {import("./RestSetupApp.js").RestSetupApp} restApp
     */
    static refreshIfOpen(restApp) {
        if (!_openMapCampfire || _openMapCampfire._restApp !== restApp) return;
        void _openMapCampfire.render({ force: true });
    }
}
