import { Logger } from "../../../utils/Logger.js";
import { MODULE_ID } from "../../../data/moduleId.js";
import { STATION_RANGE_SQUARES } from "../../../data/RestConstants.js";
import { measureWorldDistanceFeet } from "./CompoundCampPlacer.js";
import { UI_FONT_STACK, _iconTextureAsync, _layoutIconSprite, OV, ICON_RASTER_PX } from "./StationIconRenderer.js";
import { stationTokenStillOnScene, getProximityActorIdFn, getOverlayContainer } from "./StationInteractionLayer.js";

/**
 * One overlay attached to a canvas Token PIXI object.
 */
export class StationOverlay {
    /**
     * @param {Token}  token       - Foundry Token PlaceableObject
     * @param {Object} station     - Entry from CAMP_STATIONS
     * @param {Object} actorMap    - { [actorId]: { hasBedroll, assignedTokenId, extraActivities? } }
     * @param {Function} onClickFn - (stationId, token, overlay) callback
     * @param {Object} [overlayOpts]
     * @param {boolean} [overlayOpts.emptyNoticeFade] - Muted notice when this station has no available activities
     * @param {{ title?: string, tagline?: string }} [overlayOpts.displayOverride] - Title for hover tooltip (camp pit notice)
     * @param {boolean} [overlayOpts.skipProximity] - If true, do not require token range (Make Camp pit)
     */
    constructor(token, station, actorMap, onClickFn, overlayOpts = {}) {
        const emptyNoticeFade = typeof overlayOpts === "boolean" ? overlayOpts : !!overlayOpts?.emptyNoticeFade;
        this.token      = token;
        this.station    = station;
        this.actorMap   = actorMap;
        this.onClickFn  = onClickFn;
        this._emptyNoticeFade = emptyNoticeFade;
        this._displayOverride = (typeof overlayOpts === "object" && overlayOpts?.displayOverride) ? overlayOpts.displayOverride : null;
        this._skipProximity = !!(typeof overlayOpts === "object" && overlayOpts?.skipProximity);

        this._container  = null;
        this._bg         = null;
        this._iconRing   = null;
        this._iconSprite = null;
        this._hoverLabel = null;
        this._farText    = null;
        this._pulseT     = Math.random() * Math.PI * 2;
        this._dimmed     = false;
        this._mealOnly   = false;
        this._detectMagicGlow = false;
        this._dmEmanationT = 0;
        this._dmGlowIntroT = 0;
        this._permanentlyDimmed = false;
        this._farTimeout = null;
        this._hoverHighlight = false;
        this._bodyRoot = null;
        this._portraitRoot = null;
        this._portraitLoadToken = null;
        this._mealRowRoot = null;
        this._mealPortraitLoadToken = null;
        this._dmAura = null;

        this._build();
        if (this._emptyNoticeFade) {
            this._applyEmptyNoticePalette();
            if (this._bodyRoot) {
                const mid = (OV.EMPTY_PULSE_MIN + OV.EMPTY_PULSE_MAX) / 2;
                this._bodyRoot.alpha = mid;
            }
        }
    }

    /**
     * Builds the V2 circular icon badge with portrait/meal bubble slots.
     * Local coordinate origin (0,0) = badge center.
     */
    _build() {
        const R = OV.BADGE_R;

        const container = new PIXI.Container();
        container.cursor = "pointer";
        if ("eventMode" in container) {
            container.eventMode = "static";
        } else {
            container.interactive = true;
        }

        const portraitRoot = new PIXI.Container();
        portraitRoot.visible = false;
        portraitRoot.sortableChildren = true;
        portraitRoot.y = 0;
        if ("eventMode" in portraitRoot) portraitRoot.eventMode = "none";
        else portraitRoot.interactive = false;
        container.addChild(portraitRoot);
        this._portraitRoot = portraitRoot;

        const dmAura = new PIXI.Graphics();
        dmAura.visible = false;
        if ("eventMode" in dmAura) dmAura.eventMode = "none";
        else dmAura.interactive = false;
        container.addChild(dmAura);
        this._dmAura = dmAura;

        const bodyRoot = new PIXI.Container();
        this._bodyRoot = bodyRoot;
        container.addChild(bodyRoot);

        const shadow = new PIXI.Graphics();
        shadow.beginFill(0x000000, OV.SHADOW_ALPHA);
        shadow.drawCircle(OV.SHADOW_OFFSET, OV.SHADOW_OFFSET + 1, R);
        shadow.endFill();
        if ("eventMode" in shadow) shadow.eventMode = "none";
        bodyRoot.addChild(shadow);

        const bg = new PIXI.Graphics();
        this._drawBg(bg, OV.BORDER_GLASS, OV.BG_ALPHA, OV.OUTLINE_IDLE);
        if ("eventMode" in bg) bg.eventMode = "none";
        bodyRoot.addChild(bg);
        this._bg = bg;

        const iconRing = new PIXI.Graphics();
        this._drawIconRing(iconRing, 0, 0, "idle");
        if ("eventMode" in iconRing) iconRing.eventMode = "none";
        bodyRoot.addChild(iconRing);
        this._iconRing = iconRing;

        const labelText = this._displayOverride?.title ?? this.station.label;
        const hoverLabel = new PIXI.Text(labelText, OV.FONT_TOOLTIP);
        hoverLabel.anchor.set(0.5, 0);
        hoverLabel.x = 0;
        hoverLabel.y = R + OV.LABEL_GAP;
        hoverLabel.visible = false;
        if ("eventMode" in hoverLabel) hoverLabel.eventMode = "none";
        bodyRoot.addChild(hoverLabel);
        this._hoverLabel = hoverLabel;

        const farText = new PIXI.Text("", OV.FONT_FAR);
        farText.anchor.set(0.5, 0);
        farText.x = 0;
        farText.y = R + OV.LABEL_GAP;
        farText.visible = false;
        if ("eventMode" in farText) farText.eventMode = "none";
        bodyRoot.addChild(farText);
        this._farText = farText;

        const mealRowRoot = new PIXI.Container();
        mealRowRoot.visible = false;
        mealRowRoot.sortableChildren = true;
        mealRowRoot.y = 0;
        if ("eventMode" in mealRowRoot) mealRowRoot.eventMode = "none";
        container.addChild(mealRowRoot);
        this._mealRowRoot = mealRowRoot;

        container.on("pointerover", () => this._onHover(true));
        container.on("pointerout",  () => this._onHover(false));
        container.on("pointerdown", (ev) => {
            ev?.stopPropagation?.();
            if (ev?.nativeEvent?.stopImmediatePropagation) ev.nativeEvent.stopImmediatePropagation();
            this._onClick();
        });

        const overlayContainer = getOverlayContainer();
        if (overlayContainer) {
            overlayContainer.addChild(container);
        } else {
            console.warn(`${MODULE_ID} | _overlayContainer not ready; falling back to token child`);
            this.token.addChild(container);
        }
        this._container = container;

        const hitPad = 8;
        const halfSide = Math.ceil(OV.PORTRAIT_STACK_MAX / 2);
        const sideExtent = R + OV.PORTRAIT_GAP + OV.PORTRAIT_R
            + halfSide * (2 * OV.PORTRAIT_R - OV.PORTRAIT_STACK_OVERLAP) + hitPad;
        const hitVert = Math.max(OV.PORTRAIT_R, OV.MEAL_PORTRAIT_R) + hitPad;
        container.hitArea = new PIXI.Rectangle(-sideExtent, -(R + hitPad), sideExtent * 2, (R + hitPad) + hitVert + R);

        this._syncNoticeLayout();
    }

    /**
     * Build (or refresh) the station icon once Font Awesome faces are loaded.
     * Rasterizes the glyph through Canvas2D and uploads it as a sprite texture.
     * @returns {Promise<void>}
     */
    async refreshIcon() {
        const tex = await _iconTextureAsync(this.station, 0xffffff, ICON_RASTER_PX);
        if (!tex || !this._container || this._container.destroyed || !this._bodyRoot || this._bodyRoot.destroyed) return;
        if (this._iconSprite) {
            const prevTint = this._iconSprite.tint;
            this._iconSprite.texture = tex;
            _layoutIconSprite(this._iconSprite, tex);
            this._iconSprite.tint = prevTint;
            return;
        }
        const spr = new PIXI.Sprite(tex);
        _layoutIconSprite(spr, tex);
        if ("eventMode" in spr) spr.eventMode = "none";
        this._bodyRoot.addChild(spr);
        this._iconSprite = spr;
        if (this._emptyNoticeFade || this._dimmed) this._applyEmptyNoticePalette();
        else this._applyDefaultNoticePalette();
    }

    /**
     * Repositions the badge for token size. Badge center sits above the token top edge.
     * Also adjusts right-side bubble rows so portraits and meals don't overlap.
     */
    _syncNoticeLayout() {
        if (!this._container || !this.token?.document) return;
        if (!stationTokenStillOnScene(this.token)) return;
        const gs = canvas.grid?.size ?? 100;
        const tW = (this.token.document.width ?? 1) * gs;
        const tH = (this.token.document.height ?? 1) * gs;
        const R = OV.BADGE_R;
        const topGap = R - Math.min(8, Math.max(3, Math.floor(tH * 0.08)));
        this._container.x = this.token.x + tW / 2;
        this._container.y = this.token.y - topGap;

        const pVis = this._portraitRoot?.visible;
        const mVis = this._mealRowRoot?.visible;
        if (pVis && mVis) {
            const gap = OV.PORTRAIT_GAP + 3;
            this._portraitRoot.y = -(OV.MEAL_PORTRAIT_R + gap);
            this._mealRowRoot.y = OV.PORTRAIT_R + gap;
        } else {
            if (this._portraitRoot) this._portraitRoot.y = 0;
            if (this._mealRowRoot)  this._mealRowRoot.y = 0;
        }

        this._syncMealRowAlpha();
        this._syncPortraitRowAlpha();
    }

    _syncMealRowAlpha() {
        if (!this._mealRowRoot?.visible) return;
        const a = this._bodyRoot?.alpha;
        if (a === null) return;
        this._mealRowRoot.alpha = a;
    }

    _syncPortraitRowAlpha() {
        if (!this._portraitRoot?.visible) return;
        const a = this._bodyRoot?.alpha;
        if (a === null) return;
        this._portraitRoot.alpha = a;
    }

    _applyEmptyNoticePalette() {
        if (this._iconSprite) this._iconSprite.tint = 0xa8a8b8;
        const lineColor = this._mealOnly ? OV.BORDER_MEAL : OV.BORDER_GLASS;
        const outline = this._mealOnly ? OV.OUTLINE_MEAL : OV.OUTLINE_IDLE * 0.55;
        this._drawBg(this._bg, lineColor, OV.BG_ALPHA * 0.88, outline);
    }

    _applyDefaultNoticePalette() {
        if (this._iconSprite) this._iconSprite.tint = 0xffffff;
    }

    /**
     * Updates muted "no activities" styling when the roster or rest context changes.
     * @param {boolean} enabled
     */
    setEmptyNoticeFade(enabled) {
        const next = !!enabled;
        if (this._emptyNoticeFade === next) return;
        this._emptyNoticeFade = next;
        if (this._detectMagicGlow) return;
        if (this._mealOnly) {
            this._syncMealRowAlpha();
            return;
        }
        if (next) {
            this._applyEmptyNoticePalette();
            if (this._bodyRoot) {
                this._bodyRoot.alpha = this._dimmed
                    ? OV.DIM_ALPHA
                    : (OV.EMPTY_PULSE_MIN + OV.EMPTY_PULSE_MAX) / 2;
            }
            this._drawIconRing(this._iconRing, 0, 0, "idle");
        } else {
            this._applyDefaultNoticePalette();
            const lineColor = this._hoverHighlight ? OV.BORDER_HOVER : OV.BORDER_GLASS;
            const outline = this._hoverHighlight ? OV.OUTLINE_HOVER : OV.OUTLINE_IDLE;
            this._drawBg(this._bg, lineColor, OV.BG_ALPHA, outline);
            if (this._bodyRoot) {
                this._bodyRoot.alpha = this._dimmed
                    ? OV.DIM_ALPHA
                    : (this._hoverHighlight
                        ? 1.0
                        : OV.PULSE_MIN + (OV.PULSE_MAX - OV.PULSE_MIN) * 0.5);
            }
            this._drawIconRing(this._iconRing, 0, 0, this._hoverHighlight ? "hover" : "idle");
        }
        this._syncMealRowAlpha();
    }

    _drawBg(g, borderColor, bgAlpha, outlineAlpha = 0) {
        if (!g || g.destroyed) return;
        const R = OV.BADGE_R;
        g.clear();
        g.beginFill(OV.BG_COLOR, bgAlpha);
        if (outlineAlpha > 0.01) g.lineStyle(1, borderColor, outlineAlpha);
        g.drawCircle(0, 0, R);
        g.endFill();
    }

    /**
     * @param {"idle"|"hover"|"meal"|"far"} mode
     */
    _drawIconRing(g, cx, cy, mode) {
        if (!g || g.destroyed) return;
        g.clear();
        if (mode === "idle") return;
        const r = OV.ICON_TEX_PX / 2 + OV.ICON_RING_PAD;
        if (mode === "hover") {
            g.lineStyle(1, 0xffffff, 0.22);
            g.drawCircle(cx, cy, r);
        } else if (mode === "meal") {
            g.lineStyle(1.2, OV.BORDER_MEAL, 0.88);
            g.drawCircle(cx, cy, r);
        } else if (mode === "detectMagic") {
            g.lineStyle(1.4, OV.BORDER_DM, 0.88);
            g.drawCircle(cx, cy, r);
        } else if (mode === "far") {
            g.lineStyle(1.2, OV.BORDER_FAR, 1);
            g.drawCircle(cx, cy, r);
        }
    }

    _drawDetectMagicEmanation() {
        const g = this._dmAura;
        if (!g || !this._detectMagicGlow) return;
        g.clear();
        const baseR = OV.BADGE_R;
        const maxExtra = OV.DM_EMANATION_EXTRA;
        const intro = OV.DM_EMANATION_INTRO_MS > 0
            ? Math.min(1, this._dmGlowIntroT / OV.DM_EMANATION_INTRO_MS)
            : 1;
        const birthSpan = OV.DM_EMANATION_BIRTH;

        for (let i = 0; i < OV.DM_EMANATION_RINGS; i++) {
            const phase = (this._dmEmanationT + i / OV.DM_EMANATION_RINGS) % 1;
            const ease = 1 - (1 - phase) * (1 - phase);
            const birthT = birthSpan > 0 ? Math.min(1, phase / birthSpan) : 1;
            const birthFade = birthT * birthT;
            const radius = baseR + maxExtra * ease;
            const alpha = (1 - phase) * OV.DM_EMANATION_ALPHA * birthFade * intro;
            if (alpha < 0.04) continue;
            g.lineStyle(1.1 + (1 - phase) * 1.4, OV.BORDER_DM, alpha);
            g.drawCircle(0, 0, radius);
        }
    }

    /** Purple badge tint without a static ring (emanation carries the motion). */
    _applyDetectMagicBadgeBase() {
        if (this._iconSprite) this._iconSprite.tint = OV.DM_ICON_TINT;
        this._drawBg(this._bg, OV.BORDER_DM, OV.BG_ALPHA, 0);
        this._drawIconRing(this._iconRing, 0, 0, "idle");
    }

    _applyDetectMagicPalette() {
        this._applyDetectMagicBadgeBase();
        if (this._dmAura) this._dmAura.visible = true;
        this._drawDetectMagicEmanation();
        if (this._bodyRoot) {
            this._bodyRoot.alpha = (OV.DM_PULSE_MIN + OV.DM_PULSE_MAX) / 2;
        }
    }

    /**
     * Purple pulse on the workbench badge while a Detect Magic scan is active.
     * @param {boolean} enabled
     */
    setDetectMagicGlow(enabled) {
        const next = !!enabled;
        if (this._detectMagicGlow === next) {
            if (next && !this._mealOnly && !this._dimmed) {
                this._applyDetectMagicPalette();
            }
            return;
        }
        this._detectMagicGlow = next;
        if (this._dimmed && !this._mealOnly) return;
        if (this._mealOnly) return;
        if (next) {
            this._dmEmanationT = 0;
            this._dmGlowIntroT = 0;
            this._applyDetectMagicPalette();
        } else {
            this._dmGlowIntroT = 0;
            if (this._dmAura) {
                this._dmAura.clear();
                this._dmAura.visible = false;
            }
            if (this._emptyNoticeFade) {
                this._applyEmptyNoticePalette();
                if (this._bodyRoot) {
                    this._bodyRoot.alpha = (OV.EMPTY_PULSE_MIN + OV.EMPTY_PULSE_MAX) / 2;
                }
                this._drawIconRing(this._iconRing, 0, 0, "idle");
            } else {
                this._applyDefaultNoticePalette();
                this._drawBg(this._bg, OV.BORDER_GLASS, OV.BG_ALPHA, OV.OUTLINE_IDLE);
                this._drawIconRing(this._iconRing, 0, 0, "idle");
                if (this._bodyRoot) this._bodyRoot.alpha = OV.PULSE_MAX;
            }
        }
        this._syncMealRowAlpha();
    }

    _onHover(over) {
        if (this._dimmed) return;
        this._hoverHighlight = over;
        if (this._detectMagicGlow && !this._mealOnly) {
            this._applyDetectMagicBadgeBase();
            if (this._hoverLabel) {
                this._hoverLabel.visible = over && !this._farText?.visible;
            }
            if (this._bodyRoot) {
                this._bodyRoot.alpha = over
                    ? OV.DM_PULSE_MAX
                    : OV.DM_PULSE_MIN + (OV.DM_PULSE_MAX - OV.DM_PULSE_MIN) * 0.5;
            }
            this._syncMealRowAlpha();
            return;
        }
        const lineColor = this._mealOnly ? OV.BORDER_MEAL
            : over ? OV.BORDER_HOVER : OV.BORDER_GLASS;
        const outline = this._mealOnly ? OV.OUTLINE_MEAL
            : over ? OV.OUTLINE_HOVER : OV.OUTLINE_IDLE;
        const outlineUse = this._emptyNoticeFade && !this._mealOnly
            ? outline * (over ? 1 : 0.55)
            : outline;
        this._drawBg(this._bg, lineColor, OV.BG_ALPHA, outlineUse);
        const ringMode = this._mealOnly ? "meal" : over ? "hover" : "idle";
        this._drawIconRing(this._iconRing, 0, 0, ringMode);
        if (this._hoverLabel) {
            this._hoverLabel.visible = over && !this._farText?.visible;
        }
        if (this._bodyRoot) {
            if (this._emptyNoticeFade && !this._mealOnly) {
                this._bodyRoot.alpha = over
                    ? 0.82
                    : OV.EMPTY_PULSE_MIN + (OV.EMPTY_PULSE_MAX - OV.EMPTY_PULSE_MIN) * 0.5;
            } else {
                this._bodyRoot.alpha = over ? 1.0 : OV.PULSE_MIN + (OV.PULSE_MAX - OV.PULSE_MIN) * 0.5;
            }
        }
        this._syncMealRowAlpha();
    }

    _onClick() {
        if (!stationTokenStillOnScene(this.token)) return;
        Logger.log(`${MODULE_ID} | Station overlay _onClick`, { stationId: this.station.id, dimmed: this._dimmed });
        if (this._skipProximity) {
            this.onClickFn(this.station.id, this.token, this);
            return;
        }
        // Proximity check: find the user's actor token
        const actorIds = Object.keys(this.actorMap);
        let playerActorId = null;
        const proxFn = getProximityActorIdFn(); if (typeof proxFn === "function") {
            const pid = proxFn();
            if (pid && actorIds.includes(pid)) playerActorId = pid;
        }
        if (!playerActorId) {
            playerActorId = actorIds.find(id => {
                const actor = game.actors.get(id);
                return actor?.isOwner && actor?.hasPlayerOwner;
            });
        }

        if (playerActorId) {
            const controlled = canvas.tokens?.controlled ?? [];
            const fromControl = controlled.find(t => t.actor?.id === playerActorId);
            const assignedTokenId = this.actorMap[playerActorId]?.assignedTokenId;
            const playerToken = fromControl
                ?? (assignedTokenId ? canvas.tokens.get(assignedTokenId) : null)
                ?? canvas.tokens.placeables.find(t => t.actor?.id === playerActorId);

            if (playerToken) {
                const dist = measureWorldDistanceFeet(
                    playerToken.center,
                    this.token.center
                );
                const maxDist = STATION_RANGE_SQUARES * (canvas.grid?.distance ?? 5);

                if (dist > maxDist) {
                    Logger.log(`${MODULE_ID} | Station too far`, { dist, maxDist, playerActorId });
                    this._showFarWarning(Math.round(dist));
                    return;
                }
            } else {
                console.warn(`${MODULE_ID} | Station proximity: no canvas token for actor`, { playerActorId });
            }
        } else {
            console.warn(`${MODULE_ID} | Station proximity: no owned actor in actorMap`, { actorIds });
        }

        Logger.log(`${MODULE_ID} | Station opening picker`, { stationId: this.station.id });
        this.onClickFn(this.station.id, this.token, this);
    }

    _showFarWarning(distFt) {
        this._drawBg(this._bg, OV.BORDER_FAR, OV.BG_ALPHA, OV.OUTLINE_FAR);
        this._drawIconRing(this._iconRing, 0, 0, "far");
        if (this._hoverLabel) this._hoverLabel.visible = false;
        this._farText.text    = game.i18n.format("ionrift-respite.stationOverlay.distanceAway", { distance: distFt });
        this._farText.visible = true;

        clearTimeout(this._farTimeout);
        this._farTimeout = setTimeout(() => {
            if (!this._dimmed) {
                if (this._mealOnly) {
                    this._drawBg(this._bg, OV.BORDER_MEAL, OV.BG_ALPHA, OV.OUTLINE_MEAL);
                } else if (this._emptyNoticeFade) {
                    this._applyEmptyNoticePalette();
                } else {
                    this._drawBg(this._bg, OV.BORDER_GLASS, OV.BG_ALPHA, OV.OUTLINE_IDLE);
                }
                this._drawIconRing(
                    this._iconRing,
                    0, 0,
                    this._mealOnly ? "meal" : "idle"
                );
                if (this._detectMagicGlow) {
                    this._applyDetectMagicPalette();
                }
            }
            this._farText.visible = false;
        }, 2500);
    }

    /** Called each ticker tick. Returns the updated pulse phase. */
    tick(delta) {
        if (this._detectMagicGlow && !this._dimmed && !this._mealOnly) {
            this._pulseT += OV.PULSE_SPEED * delta;
            this._dmGlowIntroT += delta;
            this._dmEmanationT += OV.DM_EMANATION_SPEED * delta;
            if (this._dmEmanationT >= 1) this._dmEmanationT -= Math.floor(this._dmEmanationT);
            this._drawDetectMagicEmanation();
            const t = (Math.sin(this._pulseT) + 1) / 2;
            if (this._bodyRoot && !this._hoverHighlight) {
                this._bodyRoot.alpha = OV.DM_PULSE_MIN + (OV.DM_PULSE_MAX - OV.DM_PULSE_MIN) * t;
            }
            this._syncMealRowAlpha();
            return;
        }

        if (this._dimmed || this._mealOnly) return;
        if (this._hoverHighlight) return;
        this._pulseT += OV.PULSE_SPEED * delta;
        const t = (Math.sin(this._pulseT) + 1) / 2; // 0..1
        if (this._bodyRoot) {
            if (this._emptyNoticeFade) {
                this._bodyRoot.alpha = OV.EMPTY_PULSE_MIN + (OV.EMPTY_PULSE_MAX - OV.EMPTY_PULSE_MIN) * t;
            } else {
                this._bodyRoot.alpha = OV.PULSE_MIN + (OV.PULSE_MAX - OV.PULSE_MIN) * t;
            }
        }
        this._syncMealRowAlpha();
    }

    /**
     * Dim this overlay (activity chosen elsewhere; or activity chosen at this station).
     * @param {boolean} mealOnly - If true, overlay stays interactive for meals but changes style.
     */
    setDimmed(mealOnly = false) {
        if (mealOnly) {
            this._mealOnly = true;
            this._dimmed   = false;
            if ("eventMode" in this._container) this._container.eventMode = "static";
            else this._container.interactive = true;
            if (this._bodyRoot) this._bodyRoot.alpha = OV.MEAL_BODY_ALPHA;
            this._drawBg(this._bg, OV.BORDER_MEAL, OV.BG_ALPHA, OV.OUTLINE_MEAL);
            this._drawIconRing(this._iconRing, 0, 0, "meal");
            if (this._iconSprite) this._iconSprite.tint = 0xffffff;
        } else {
            this._dimmed = true;
            this._hoverHighlight = false;
            if ("eventMode" in this._container) this._container.eventMode = "none";
            else this._container.interactive = false;
            if (this._emptyNoticeFade) {
                this._applyEmptyNoticePalette();
            }
            if (this._bodyRoot) this._bodyRoot.alpha = OV.DIM_ALPHA;
        }
        if (this._iconSprite && !mealOnly) this._iconSprite.tint = 0xa8a8b8;
        this._syncMealRowAlpha();
    }

    setActive() {
        if (this._permanentlyDimmed) return;
        this.clearChosenPortrait();
        this._dimmed   = false;
        this._mealOnly = false;
        this._hoverHighlight = false;
        if ("eventMode" in this._container) this._container.eventMode = "static";
        else this._container.interactive = true;
        this._farText.visible = false;
        if (this._hoverLabel) this._hoverLabel.visible = false;
        if (this._detectMagicGlow) {
            this._applyDetectMagicPalette();
        } else if (this._emptyNoticeFade) {
            this._applyEmptyNoticePalette();
            if (this._bodyRoot) {
                this._bodyRoot.alpha = (OV.EMPTY_PULSE_MIN + OV.EMPTY_PULSE_MAX) / 2;
            }
        } else {
            this._applyDefaultNoticePalette();
            if (this._bodyRoot) this._bodyRoot.alpha = OV.PULSE_MAX;
            this._drawBg(this._bg, OV.BORDER_GLASS, OV.BG_ALPHA, OV.OUTLINE_IDLE);
        }
        this._drawIconRing(this._iconRing, 0, 0, "idle");
        this._syncMealRowAlpha();
    }

    clearChosenPortrait() {
        this._portraitLoadToken = null;
        if (!this._portraitRoot) return;
        for (const ch of [...this._portraitRoot.children]) {
            ch.destroy({ children: true });
        }
        this._portraitRoot.removeChildren();
        this._portraitRoot.visible = false;
        this._syncNoticeLayout();
    }

    /**
     * Shows stacked circular portraits balanced left and right of the badge.
     * @param {string|string[]} imgSrcs
     */
    setChosenPortraits(imgSrcs) {
        this.clearChosenPortrait();
        const list = (Array.isArray(imgSrcs) ? imgSrcs : [imgSrcs]).filter(Boolean);
        if (!list.length || !this._portraitRoot) return;

        const r  = OV.PORTRAIT_R;
        const cy = 0;
        const step = Math.max(1, 2 * r - OV.PORTRAIT_STACK_OVERLAP);
        const maxShow = OV.PORTRAIT_STACK_MAX;
        const show = list.slice(0, maxShow);
        const overflow = list.length - show.length;
        const edgeGap = OV.BADGE_R + OV.PORTRAIT_GAP + r;

        const rightCount = Math.ceil(show.length / 2);
        const leftCount  = show.length - rightCount;

        const loadId = foundry.utils.randomID();
        this._portraitLoadToken = loadId;

        const addOne = (imgSrc, cx, zBase) => {
            const backing = new PIXI.Graphics();
            backing.lineStyle(OV.PORTRAIT_ACTIVITY_BORDER_W, OV.PORTRAIT_ACTIVITY_BORDER, 0.92);
            backing.beginFill(0x000000, 1);
            backing.drawCircle(cx, cy, r);
            backing.endFill();
            backing.zIndex = zBase;
            if ("eventMode" in backing) backing.eventMode = "none";

            const mask = new PIXI.Graphics();
            mask.beginFill(0xffffff);
            mask.drawCircle(cx, cy, r * 0.92);
            mask.endFill();
            mask.zIndex = zBase + 1;
            if ("eventMode" in mask) mask.eventMode = "none";

            const spr = PIXI.Sprite.from(imgSrc);
            spr.anchor.set(0.5, 0.5);
            spr.x = cx;
            spr.y = cy;
            spr.mask = mask;
            spr.zIndex = zBase + 2;
            if ("eventMode" in spr) spr.eventMode = "none";

            const pin = new PIXI.Graphics();
            pin.lineStyle(1, 0x0c0b10, 0.85);
            pin.beginFill(OV.PORTRAIT_ACTIVITY_PIN, 1);
            pin.drawCircle(cx + r * 0.52, cy + r * 0.52, 3);
            pin.endFill();
            pin.zIndex = zBase + 6;
            if ("eventMode" in pin) pin.eventMode = "none";

            const place = () => {
                if (this._portraitLoadToken !== loadId || !this._portraitRoot) return;
                const tw = spr.texture?.width || 1;
                const th = spr.texture?.height || 1;
                const sc = Math.min((r * 2) / tw, (r * 2) / th) * 0.96;
                spr.scale.set(sc);
                this._portraitRoot.addChild(backing);
                this._portraitRoot.addChild(mask);
                this._portraitRoot.addChild(spr);
                this._portraitRoot.addChild(pin);
            };

            if (spr.texture?.valid) place();
            else {
                const once = () => {
                    spr.texture?.off?.("update", once);
                    if (spr.texture?.valid) place();
                };
                spr.texture?.on?.("update", once);
                setTimeout(() => {
                    if (this._portraitLoadToken === loadId) place();
                }, 400);
            }
        };

        for (let i = 0; i < rightCount; i++) {
            const cx = edgeGap + i * step;
            addOne(show[i], cx, i * 10);
        }
        for (let i = 0; i < leftCount; i++) {
            const cx = -(edgeGap + i * step);
            addOne(show[rightCount + i], cx, (rightCount + i) * 10);
        }

        if (overflow > 0) {
            const cx = edgeGap + rightCount * step;
            const bg = new PIXI.Graphics();
            bg.lineStyle(1, 0xffffff, 0.12);
            bg.beginFill(0x000000, 0.92);
            bg.drawCircle(cx, cy, r * 0.85);
            bg.endFill();
            bg.zIndex = 500;
            if ("eventMode" in bg) bg.eventMode = "none";

            const badge = new PIXI.Text(`+${overflow}`, {
                fontFamily: UI_FONT_STACK,
                fontSize: 8,
                fill: 0xffffff,
                fontWeight: "bold"
            });
            badge.anchor.set(0.5, 0.5);
            badge.x = cx;
            badge.y = cy;
            badge.zIndex = 501;
            if ("eventMode" in badge) badge.eventMode = "none";

            this._portraitRoot.addChild(bg);
            this._portraitRoot.addChild(badge);
        }

        this._portraitRoot.visible = true;
        this._syncNoticeLayout();
    }

    /**
     * @param {string} imgSrc
     */
    setChosenPortrait(imgSrc) {
        this.setChosenPortraits(imgSrc);
    }

    /**
     * Clears the activity-phase rations row (amber mini-portraits).
     * @param {{ skipLayout?: boolean }} [options]
     */
    clearMealPortraits(options = {}) {
        this._mealPortraitLoadToken = null;
        if (!this._mealRowRoot) return;
        for (const ch of [...this._mealRowRoot.children]) {
            ch.destroy({ children: true });
        }
        this._mealRowRoot.removeChildren();
        this._mealRowRoot.visible = false;
        if (!options.skipLayout) this._syncNoticeLayout();
    }

    /**
     * Shows characters still owing activity-phase rations as floating amber bubbles balanced around the badge.
     * @param {string[]} imgSrcs
     */
    setMealPortraits(imgSrcs) {
        this.clearMealPortraits({ skipLayout: true });
        const list = (Array.isArray(imgSrcs) ? imgSrcs : [imgSrcs]).filter(Boolean);
        if (!list.length || !this._mealRowRoot) {
            this._syncNoticeLayout();
            return;
        }

        const r = OV.MEAL_PORTRAIT_R;
        const cy = 0;
        const step = Math.max(1, 2 * r - OV.MEAL_PORTRAIT_STEP);
        const maxShow = OV.MEAL_PORTRAIT_STACK_MAX;
        const show = list.slice(0, maxShow);
        const overflow = list.length - show.length;
        const mealBorder = OV.MEAL_PORTRAIT_BORDER;
        const edgeGap = OV.BADGE_R + OV.MEAL_GAP + r;

        const rightCount = Math.ceil(show.length / 2);
        const leftCount  = show.length - rightCount;

        const loadId = foundry.utils.randomID();
        this._mealPortraitLoadToken = loadId;

        const addOneMeal = (imgSrc, cx, zBase) => {
            const backing = new PIXI.Graphics();
            backing.lineStyle(OV.MEAL_PORTRAIT_BORDER_W, mealBorder, 0.95);
            backing.beginFill(0x1a1208, 1);
            backing.drawCircle(cx, cy, r);
            backing.endFill();
            backing.zIndex = zBase;
            if ("eventMode" in backing) backing.eventMode = "none";

            const mask = new PIXI.Graphics();
            mask.beginFill(0xffffff);
            mask.drawCircle(cx, cy, r * 0.9);
            mask.endFill();
            mask.zIndex = zBase + 1;
            if ("eventMode" in mask) mask.eventMode = "none";

            const spr = PIXI.Sprite.from(imgSrc);
            spr.anchor.set(0.5, 0.5);
            spr.x = cx;
            spr.y = cy;
            spr.mask = mask;
            spr.zIndex = zBase + 2;
            if ("eventMode" in spr) spr.eventMode = "none";

            const corner = new PIXI.Graphics();
            corner.lineStyle(1, 0x0c0b10, 0.8);
            corner.beginFill(OV.MEAL_PORTRAIT_CORNER, 1);
            corner.drawRoundedRect(cx + r * 0.35, cy + r * 0.35, 4, 4, 1);
            corner.endFill();
            corner.zIndex = zBase + 6;
            if ("eventMode" in corner) corner.eventMode = "none";

            const place = () => {
                if (this._mealPortraitLoadToken !== loadId || !this._mealRowRoot) return;
                const tw = spr.texture?.width || 1;
                const th = spr.texture?.height || 1;
                const sc = Math.min((r * 2) / tw, (r * 2) / th) * 0.94;
                spr.scale.set(sc);
                this._mealRowRoot.addChild(backing);
                this._mealRowRoot.addChild(mask);
                this._mealRowRoot.addChild(spr);
                this._mealRowRoot.addChild(corner);
            };

            if (spr.texture?.valid) place();
            else {
                const once = () => {
                    spr.texture?.off?.("update", once);
                    if (spr.texture?.valid) place();
                };
                spr.texture?.on?.("update", once);
                setTimeout(() => {
                    if (this._mealPortraitLoadToken === loadId) place();
                }, 400);
            }
        };

        for (let i = 0; i < rightCount; i++) {
            const cx = edgeGap + i * step;
            addOneMeal(show[i], cx, 20 + i * 10);
        }
        for (let i = 0; i < leftCount; i++) {
            const cx = -(edgeGap + i * step);
            addOneMeal(show[rightCount + i], cx, 20 + (rightCount + i) * 10);
        }

        if (overflow > 0) {
            const cx = edgeGap + rightCount * step;
            const bg = new PIXI.Graphics();
            bg.lineStyle(1, mealBorder, 0.35);
            bg.beginFill(0x000000, 0.9);
            bg.drawCircle(cx, cy, r * 0.82);
            bg.endFill();
            bg.zIndex = 500;
            if ("eventMode" in bg) bg.eventMode = "none";

            const badge = new PIXI.Text(`+${overflow}`, {
                fontFamily: UI_FONT_STACK,
                fontSize: 7,
                fill: OV.BORDER_MEAL,
                fontWeight: "bold"
            });
            badge.anchor.set(0.5, 0.5);
            badge.x = cx;
            badge.y = cy;
            badge.zIndex = 501;
            if ("eventMode" in badge) badge.eventMode = "none";

            this._mealRowRoot.addChild(bg);
            this._mealRowRoot.addChild(badge);
        }

        this._mealRowRoot.visible = true;
        this._syncNoticeLayout();
    }

    destroy() {
        clearTimeout(this._farTimeout);
        this.token = null;
        this.clearChosenPortrait();
        this.clearMealPortraits({ skipLayout: true });
        if (this._container && !this._container.destroyed) {
            this._container.parent?.removeChild?.(this._container);
            this._container.destroy({ children: true });
        }
        this._container = null;
        this._bg = null;
        this._bodyRoot = null;
        this._iconSprite = null;
        this._iconRing = null;
    }
}
