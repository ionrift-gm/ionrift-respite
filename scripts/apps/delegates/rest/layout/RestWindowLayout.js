import { MODULE_ID } from "../../../../data/moduleId.js";

export function isTrailerFilmingMode() {
    return !!game.ionrift?.testharness?.isFilmingMode?.();
}

export class RestWindowLayout {
    constructor(app) {
        this._app = app;
    }

    bindUserMoveTracking() {
        const app = this._app;
        const el = app.element;
        if (!el) return;
        const header = el.querySelector("header.window-header") ?? el.querySelector(".window-header");
        if (!header || header.dataset.restUserMoveBound) return;
        header.dataset.restUserMoveBound = "1";
        header.addEventListener("pointerdown", () => {
            app._restWindowUserPositioned = true;
        });
    }

    campRestWindowTargetWidth() {
        const app = this._app;
        const campWithMinigame = app._phase === "camp" && app._showFullMakeCampPanel()
            && (app._campCeremonyMinigameEnabled?.() || app._totmCampfireMinigamePanelEnabled?.());
        const activityWithCampfirePanel = app._phase === "activity"
            && app._totmCampfireMinigamePanelEnabled?.();
        if (campWithMinigame || activityWithCampfirePanel) {
            return Math.min(780, Math.round(window.innerWidth * 0.92));
        }
        return 720;
    }

    repositionFilmingRestWindow(options = {}) {
        const app = this._app;
        if (!isTrailerFilmingMode()) return Promise.resolve();
        if (app._filmingWindowAnimating) return Promise.resolve();
        const el = app.element;
        if (!el) return;
        const h = el.offsetHeight;
        if (h < 1) return;

        const margin = app._filmingWindowMargin ?? 28;
        const anchor = app._filmingWindowAnchor ?? "left";

        const campLayout = app._phase === "camp"
            || (app._phase === "activity" && app._totmCampfireMinigamePanelEnabled?.());
        const width = campLayout
            ? this.campRestWindowTargetWidth()
            : ((el.offsetWidth || app.position?.width || app.constructor.DEFAULT_OPTIONS.position?.width) ?? 720);

        let left;
        if (anchor === "left") {
            left = margin;
        } else if (anchor === "right") {
            left = Math.max(margin, window.innerWidth - width - margin);
        } else {
            left = Math.max(margin, Math.round((window.innerWidth - width) / 2));
        }

        const top = Math.max(margin, Math.round((window.innerHeight - h) / 2));
        return this.applyRestWindowPosition({ left, top, width }, {
            smooth: !!options.smooth,
            filming: true,
            durationMs: options.durationMs
        });
    }

    scheduleFilmingWindowReposition(options = {}) {
        const app = this._app;
        if (!isTrailerFilmingMode()) return;
        if (app._filmingWindowRepositionPending) {
            app._filmingWindowRepositionOpts = { ...app._filmingWindowRepositionOpts, ...options };
            return;
        }
        app._filmingWindowRepositionPending = true;
        app._filmingWindowRepositionOpts = { ...options };
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                app._filmingWindowRepositionPending = false;
                const opts = app._filmingWindowRepositionOpts ?? {};
                app._filmingWindowRepositionOpts = null;
                if (!app.rendered) return;
                this.repositionFilmingRestWindow(opts);
            });
        });
    }

    presetRestWindowForCampEntry() {
        const app = this._app;
        if (isTrailerFilmingMode()) {
            this.repositionFilmingRestWindow();
            return;
        }
        if (app._restWindowUserPositioned) return;

        const targetW = this.campRestWindowTargetWidth();
        const el = app.element;
        const currentTop = Math.max(10, el?.offsetTop ?? app.position?.top ?? Math.round((window.innerHeight - 480) / 2));
        this.applyRestWindowPosition({
            width: targetW,
            left: Math.max(20, Math.round((window.innerWidth - targetW) / 2)),
            top: currentTop
        });
    }

    applyRestWindowPosition(pos, { smooth = false, filming = false, durationMs } = {}) {
        const app = this._app;
        if (filming && smooth && isTrailerFilmingMode()) {
            return this.animateFilmingRestWindowPosition(pos, durationMs ?? 420);
        }

        const root = app.element?.closest?.(".application") ?? app.element;
        const allowSmooth = smooth && !isTrailerFilmingMode();

        if (!allowSmooth || !root) {
            app.setPosition(pos);
            return Promise.resolve();
        }

        const settleMs = durationMs ?? 280;

        return new Promise((resolve) => {
            let settled = false;
            const finish = () => {
                if (settled) return;
                settled = true;
                root.classList.remove("rest-window-recenter-smooth");
                resolve();
            };

            root.classList.add("rest-window-recenter-smooth");
            void root.offsetWidth;

            requestAnimationFrame(() => {
                app.setPosition(pos);

                const onTransitionEnd = (ev) => {
                    if (ev.target !== root) return;
                    if (ev.propertyName === "left" || ev.propertyName === "top" || ev.propertyName === "width") {
                        finish();
                    }
                };

                root.addEventListener("transitionend", onTransitionEnd, { once: true });
                setTimeout(finish, settleMs + 80);
            });
        });
    }

    animateFilmingRestWindowPosition(targetPos, durationMs = 420) {
        const app = this._app;
        const root = app.element?.closest?.(".application") ?? app.element;
        if (!root) {
            app.setPosition(targetPos);
            return Promise.resolve();
        }

        if (app._filmingWindowAnimFrame) {
            cancelAnimationFrame(app._filmingWindowAnimFrame);
            app._filmingWindowAnimFrame = null;
        }

        app._filmingWindowAnimating = true;

        return new Promise((resolve) => {
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    const defaultWidth = app.constructor.DEFAULT_OPTIONS.position?.width ?? 720;
                    const startPos = {
                        left: Number.isFinite(app.position?.left) ? app.position.left : root.offsetLeft,
                        top: Number.isFinite(app.position?.top) ? app.position.top : root.offsetTop,
                        width: app.position?.width ?? root.offsetWidth ?? defaultWidth
                    };
                    const endPos = {
                        left: targetPos.left,
                        top: targetPos.top,
                        width: targetPos.width ?? startPos.width
                    };

                    const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
                    const t0 = performance.now();

                    const tick = (now) => {
                        const t = Math.min(1, (now - t0) / durationMs);
                        const eased = easeOutCubic(t);
                        const frame = {
                            left: Math.round(startPos.left + (endPos.left - startPos.left) * eased),
                            top: Math.round(startPos.top + (endPos.top - startPos.top) * eased),
                            width: Math.round(startPos.width + (endPos.width - startPos.width) * eased)
                        };

                        app.setPosition(frame);
                        root.style.setProperty("left", `${frame.left}px`);
                        root.style.setProperty("top", `${frame.top}px`);
                        root.style.setProperty("width", `${frame.width}px`);

                        if (t < 1) {
                            app._filmingWindowAnimFrame = requestAnimationFrame(tick);
                            return;
                        }

                        app._filmingWindowAnimFrame = null;
                        app._filmingWindowAnimating = false;
                        app.setPosition(endPos);
                        resolve();
                    };

                    app._filmingWindowAnimFrame = requestAnimationFrame(tick);
                });
            });
        });
    }

    async finalizeCampPhaseWindowLayout() {
        const app = this._app;
        try {
            await new Promise(resolve => requestAnimationFrame(resolve));
            if (app._campCeremonyMinigameEnabled?.() && app._campfireApp) {
                try {
                    await app._campfireApp.render();
                } catch (err) {
                    console.warn(`${MODULE_ID} | Campfire embed render during layout finalize:`, err);
                }
            }
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        } finally {
            this.endRestWindowRecenterSuppression(false);
            if (isTrailerFilmingMode()) {
                this.scheduleFilmingWindowReposition({ smooth: true });
            } else if (this.shouldAutoRecenterRestWindow()) {
                this.scheduleRestWindowRecenter({ smooth: true });
            }
        }
    }

    shouldAutoRecenterRestWindow() {
        const app = this._app;
        if (isTrailerFilmingMode()) return false;
        if (app._restWindowUserPositioned) return false;
        if (app._restWindowRecenterSuppressed > 0) return false;
        if (app._isTotM && app._phase === "activity" && app._totmActiveTab === "identify"
            && !app._totmCampfireMinigamePanelEnabled()) {
            return false;
        }
        return true;
    }

    disposeRestWindowResizeObserver() {
        const app = this._app;
        if (!app._restWindowResizeObserver) return;
        app._restWindowResizeObserver.disconnect();
        app._restWindowResizeObserver = null;
    }

    bindRestWindowResizeObserver() {
        const app = this._app;
        const el = app.element;
        if (!el || app._restWindowResizeObserver) return;
        const watchCampFullPanel = app._phase === "camp" && app._showFullMakeCampPanel();
        if (!app._isTotM && !watchCampFullPanel) return;
        const watchCamp = app._phase === "camp";
        const watchActivityCampfire = app._phase === "activity" && app._totmCampfireMinigamePanelEnabled();
        if (!watchCamp && !watchActivityCampfire) return;

        app._restWindowResizeObserver = new ResizeObserver(() => {
            if (isTrailerFilmingMode()) {
                this.scheduleFilmingWindowReposition();
            } else {
                this.scheduleRestWindowRecenter();
            }
        });
        app._restWindowResizeObserver.observe(el);
    }

    beginRestWindowRecenterSuppression() {
        const app = this._app;
        app._restWindowRecenterSuppressed = (app._restWindowRecenterSuppressed ?? 0) + 1;
    }

    endRestWindowRecenterSuppression(schedule = true) {
        const app = this._app;
        app._restWindowRecenterSuppressed = Math.max(0, (app._restWindowRecenterSuppressed ?? 1) - 1);
        if (schedule && !app._restWindowRecenterSuppressed) {
            this.scheduleRestWindowRecenter();
        }
    }

    scheduleRestWindowRecenter(options = {}) {
        const app = this._app;
        if (isTrailerFilmingMode()) {
            this.scheduleFilmingWindowReposition(options);
            return;
        }
        if (!this.shouldAutoRecenterRestWindow()) return;
        if (app._restWindowRecenterPending) {
            app._restWindowRecenterOpts = { ...app._restWindowRecenterOpts, ...options };
            return;
        }
        app._restWindowRecenterPending = true;
        app._restWindowRecenterOpts = { ...options };
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                app._restWindowRecenterPending = false;
                const opts = app._restWindowRecenterOpts ?? {};
                app._restWindowRecenterOpts = null;
                if (!app.rendered) return;
                this.recenterRestSetupWindow(opts);
            });
        });
    }

    recenterRestSetupWindow(options = {}) {
        const app = this._app;
        if (!this.shouldAutoRecenterRestWindow()) return;
        const el = app.element;
        if (!el) return;
        const h = el.offsetHeight;
        if (h < 1) return;

        if (app._phase === "camp" && app._usesStationsMinimalCampShell()) {
            el.classList.add("ionrift-camp-dock");
            const w = el.offsetWidth;
            app.setPosition({
                top: 64,
                left: Math.max(8, window.innerWidth - w - 16)
            });
            return;
        }

        el.classList.remove("ionrift-camp-dock");
        const top = Math.max(10, Math.round((window.innerHeight - h) / 2));
        const pos = { top };

        if ((app._phase === "camp" || app._phase === "activity")
            && (app._campCeremonyMinigameEnabled?.() || app._totmCampfireMinigamePanelEnabled?.())) {
            const targetW = this.campRestWindowTargetWidth();
            pos.width = targetW;
            pos.left = Math.max(20, Math.round((window.innerWidth - targetW) / 2));
        } else if (app._phase === "camp") {
            const targetW = this.campRestWindowTargetWidth();
            pos.width = targetW;
            pos.left = Math.max(20, Math.round((window.innerWidth - targetW) / 2));
        } else {
            const w = el.offsetWidth;
            pos.left = Math.max(10, Math.round((window.innerWidth - w) / 2));
        }

        this.applyRestWindowPosition(pos, { smooth: !!options.smooth });
    }
}
