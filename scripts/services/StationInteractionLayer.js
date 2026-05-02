/**
 * StationInteractionLayer
 *
 * Manages interactive PIXI overlays on campsite station tokens during the activity phase.
 * Each station token grows a glowing overlay that players click to open the station
 * activity picker. After a player chooses, non-meal overlays dim for that actor.
 *
 * Overlay lifecycle:
 *   activate(actorMap)  → attach overlays to canvas tokens
 *   setPlayerState(...)  → dim/restore overlays per actor state
 *   deactivate()         → remove all overlays, clean up ticker
 */

import { CAMP_STATIONS, STATION_RANGE_SQUARES, inferCanvasStationForActivity } from "../apps/RestConstants.js";
import { isGearDeployed, measureWorldDistanceFeet } from "./CompoundCampPlacer.js";
import { getPartyActors } from "./partyActors.js";

const MODULE_ID = "ionrift-respite";

// furnitureKeys that remain interactive after an activity is chosen (meals)
const MEAL_STATION_KEYS = new Set(["campfire", "cookingArea"]);

// Font Awesome 6 Free Solid (matches `station.icon` classes in RestConstants)
const FA_SOLID_CODEPOINT = {
    "fa-tools":                 0xf7d9, // screwdriver-wrench (workbench tools)
    "fa-shield-alt":            0xf3ed, // shield-halved
    "fa-hand-holding-medical":  0xe05c,
    "fa-bed":                   0xf236,
    "fa-fire":                  0xf06d,
    "fa-utensils":              0xf2e7,
};

/**
 * @param {string} iconClass e.g. "fas fa-tools"
 * @returns {string} single UTF-16 glyph or empty if unknown
 */
function _faGlyphFromIconClass(iconClass) {
    if (!iconClass || typeof iconClass !== "string") return "";
    const parts = iconClass.trim().split(/\s+/);
    const faName = parts.find(p => p.startsWith("fa-"));
    if (!faName) return "";
    const cp = FA_SOLID_CODEPOINT[faName];
    return cp != null ? String.fromCodePoint(cp) : "";
}

const _faRasterCache = new Map();

function _hexRgb(n) {
    return `#${(n >>> 0).toString(16).padStart(6, "0")}`;
}

/** Matches `--ionrift-font-stack` in ionrift-library (PIXI.Text does not inherit app CSS). */
const UI_FONT_STACK = "Signika, sans-serif";

/**
 * Parse getComputedStyle(..., "::before").content into a single glyph (FA PUA).
 */
function _parseCssContentToGlyph(content) {
    if (!content || content === "none" || content === "normal") return null;
    let s = String(content).trim();
    if (s.length >= 2
        && ((s[0] === "\"" && s[s.length - 1] === "\"")
            || (s[0] === "'" && s[s.length - 1] === "'"))) {
        s = s.slice(1, -1);
    }
    if (s.length === 1) return s;
    if (s.length === 2 && s.charCodeAt(0) >= 0xd800 && s.charCodeAt(0) <= 0xdbff) return s;
    if (s[0] === "\\") {
        const hexMatch = /^\\([0-9a-fA-F]{1,6})/i.exec(s);
        if (hexMatch) {
            const cp = parseInt(hexMatch[1], 16);
            if (cp > 0 && cp <= 0x10ffff) return String.fromCodePoint(cp);
        }
    }
    return null;
}

/**
 * Same approach as CampfirePhysics._getCachedIcon: probe a real <i class="fas ..."> so
 * Canvas2D uses the same ::before glyph and font stack the DOM uses. Hard-coded FA
 * codepoints often miss version renames (e.g. fa-shield-alt), which reads as an empty box.
 */
function _glyphFontFromFaProbe(iconClass, pixelSize) {
    if (!iconClass || typeof iconClass !== "string") return { glyph: null, fontCss: null };
    try {
        const probe = document.createElement("i");
        probe.className = iconClass.trim();
        probe.style.cssText = "position:absolute;left:-9999px;top:-9999px;visibility:hidden;font-size:16px;";
        document.body.appendChild(probe);
        const computed = window.getComputedStyle(probe, "::before");
        const content = computed.content;
        const fontFamily = computed.fontFamily;
        const fontWeight = computed.fontWeight || "900";
        document.body.removeChild(probe);
        const glyph = _parseCssContentToGlyph(content);
        if (!glyph || !fontFamily) return { glyph: null, fontCss: null };
        return { glyph, fontCss: `${fontWeight} ${pixelSize}px ${fontFamily}` };
    } catch {
        return { glyph: null, fontCss: null };
    }
}

/**
 * FA or initial letter drawn to a texture via Canvas2D (WebGL PIXI.Text cannot embed FA).
 */
function _textureFromStationIcon(station, fillColor, pixelSize) {
    const fallback = (station.label ?? "?").trim().charAt(0).toUpperCase() || "?";
    const { glyph: probedGlyph, fontCss } = _glyphFontFromFaProbe(station.icon, pixelSize);
    const mapGlyph = probedGlyph ? null : _faGlyphFromIconClass(station.icon);
    const key = `${station.id}|${fillColor}|${pixelSize}|${probedGlyph ? "p" : mapGlyph ? "m" : "f"}`;
    if (_faRasterCache.has(key)) return _faRasterCache.get(key);

    const pad  = 4;
    const size = Math.ceil(pixelSize + pad * 2);
    const cvs  = document.createElement("canvas");
    cvs.width = size;
    cvs.height = size;
    const ctx = cvs.getContext("2d");
    if (!ctx) return null;

    ctx.clearRect(0, 0, size, size);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = _hexRgb(fillColor);

    let glyph = probedGlyph;
    let fontCssUse = fontCss;
    if (!glyph && mapGlyph) {
        glyph = mapGlyph;
        fontCssUse = `900 ${pixelSize}px "Font Awesome 5 Free", "Font Awesome 6 Free", sans-serif`;
    }
    if (!glyph) {
        glyph = fallback;
        fontCssUse = `bold ${pixelSize}px ${UI_FONT_STACK}`;
    }
    ctx.font = fontCssUse;
    ctx.fillText(glyph, size / 2, size / 2);
    if (probedGlyph || mapGlyph) {
        const w = ctx.measureText(glyph).width;
        if (w < 0.5) {
            ctx.clearRect(0, 0, size, size);
            ctx.fillStyle = _hexRgb(fillColor);
            ctx.font = `bold ${pixelSize}px ${UI_FONT_STACK}`;
            ctx.fillText(fallback, size / 2, size / 2);
        }
    }

    const tex = PIXI.Texture.from(cvs);
    _faRasterCache.set(key, tex);
    return tex;
}

// V2: circular icon badge with floating portrait bubbles
const OV = {
    BADGE_R:       18,
    ICON_RING_PAD: 3,
    SHADOW_OFFSET: 2,
    SHADOW_ALPHA:  0.34,
    BG_COLOR:      0x0c0b10,
    BG_ALPHA:      0.86,
    BORDER_GLASS:  0xffffff,
    BORDER_HOVER:  0xc4b5fd,
    BORDER_MEAL:   0xfbbf24,
    BORDER_FAR:    0xf43f5e,
    OUTLINE_IDLE:  0.11,
    OUTLINE_HOVER: 0.24,
    OUTLINE_MEAL:  0.42,
    OUTLINE_FAR:   0.55,
    FONT_TOOLTIP:  { fontFamily: UI_FONT_STACK, fontSize: 9, fill: 0xffffff, fontWeight: "bold" },
    FONT_FAR:      { fontFamily: UI_FONT_STACK, fontSize: 8, fill: 0xfca5a5 },
    ICON_TEX_PX:   16,
    PULSE_SPEED:   0.0015,
    PULSE_MIN:     0.9,
    PULSE_MAX:     1.0,
    EMPTY_PULSE_MIN: 0.4,
    EMPTY_PULSE_MAX: 0.58,
    DIM_ALPHA:     0.22,
    MEAL_BODY_ALPHA: 0.92,
    PORTRAIT_R:    13,
    PORTRAIT_GAP:  2,
    PORTRAIT_STACK_OVERLAP: 9,
    PORTRAIT_STACK_MAX:    4,
    MEAL_GAP:      2,
    /** Smaller than PORTRAIT_R: rations debt queue vs major-activity pick portraits. */
    MEAL_PORTRAIT_R:     8,
    MEAL_PORTRAIT_STEP:  6,
    MEAL_PORTRAIT_STACK_MAX: 5,
    LABEL_GAP:     4,
    /** Ring for portraits meaning “major activity committed at this station.” */
    PORTRAIT_ACTIVITY_BORDER:    0x7dd3fc,
    PORTRAIT_ACTIVITY_BORDER_W:  2,
    /** Corner chip on activity portraits (pinned pick). */
    PORTRAIT_ACTIVITY_PIN:       0x34d399,
    /** Meal-debt portraits: warm ring (also see BORDER_MEAL on badge). */
    MEAL_PORTRAIT_BORDER:        0xf59e0b,
    MEAL_PORTRAIT_BORDER_W:      2,
    /** Corner marker on meal portraits (rations still owed this rest). */
    MEAL_PORTRAIT_CORNER:        0xfbbf24
};

/**
 * Portrait URLs for characters whose pick maps to this station only (one station per pick).
 * @param {string} stationId
 * @param {Map<string, string>} characterChoicesMap  characterId -> activityId
 * @param {Map<string, string>|null} [explicitStationByCharacter]  characterId -> canvas station id when chosen from a station
 * @returns {string[]}
 */
function _portraitUrlsForStation(stationId, characterChoicesMap, explicitStationByCharacter = null) {
    const urls = [];
    if (!stationId || !(characterChoicesMap instanceof Map)) return urls;
    const explicit = explicitStationByCharacter instanceof Map ? explicitStationByCharacter : null;
    const seen = new Set();
    for (const [charId, actId] of characterChoicesMap) {
        if (!charId || !actId || seen.has(charId)) continue;
        const canonical = explicit?.get(charId) ?? inferCanvasStationForActivity(actId, charId);
        if (canonical !== stationId) continue;
        const actor = game.actors.get(charId);
        const src = actor?.img ?? "icons/svg/mystery-man.svg";
        urls.push(src);
        seen.add(charId);
    }
    return urls;
}

/**
 * One overlay attached to a canvas Token PIXI object.
 */
class StationOverlay {
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
        this._permanentlyDimmed = false;
        this._farTimeout = null;
        this._hoverHighlight = false;
        this._bodyRoot = null;
        this._portraitRoot = null;
        this._portraitLoadToken = null;
        this._mealRowRoot = null;
        this._mealPortraitLoadToken = null;

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

        const tex = _textureFromStationIcon(this.station, 0xffffff, OV.ICON_TEX_PX);
        if (tex) {
            const spr = new PIXI.Sprite(tex);
            spr.anchor.set(0.5, 0.5);
            spr.x = 0;
            spr.y = 0;
            const maxD = 20;
            const sc = Math.min(maxD / spr.texture.width, maxD / spr.texture.height, 1.2);
            spr.scale.set(sc);
            if ("eventMode" in spr) spr.eventMode = "none";
            bodyRoot.addChild(spr);
            this._iconSprite = spr;
        } else {
            this._iconSprite = null;
        }

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

        if (_overlayContainer) {
            _overlayContainer.addChild(container);
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
     * Repositions the badge for token size. Badge center sits above the token top edge.
     * Also adjusts right-side bubble rows so portraits and meals don't overlap.
     */
    _syncNoticeLayout() {
        if (!this._container || !this.token?.document) return;
        if (!_stationTokenStillOnScene(this.token)) return;
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
        if (a == null) return;
        this._mealRowRoot.alpha = a;
    }

    _syncPortraitRowAlpha() {
        if (!this._portraitRoot?.visible) return;
        const a = this._bodyRoot?.alpha;
        if (a == null) return;
        this._portraitRoot.alpha = a;
    }

    _applyEmptyNoticePalette() {
        if (this._iconSprite) {
            this._iconSprite.tint = 0xa8a8b8;
        }
        const lineColor = this._mealOnly ? OV.BORDER_MEAL : OV.BORDER_GLASS;
        const outline = this._mealOnly ? OV.OUTLINE_MEAL : OV.OUTLINE_IDLE * 0.55;
        this._drawBg(this._bg, lineColor, OV.BG_ALPHA * 0.88, outline);
    }

    _applyDefaultNoticePalette() {
        if (this._iconSprite) {
            this._iconSprite.tint = 0xffffff;
        }
    }

    /**
     * Updates muted "no activities" styling when the roster or rest context changes.
     * @param {boolean} enabled
     */
    setEmptyNoticeFade(enabled) {
        const next = !!enabled;
        if (this._emptyNoticeFade === next) return;
        this._emptyNoticeFade = next;
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
        g.clear();
        if (mode === "idle") return;
        const r = OV.ICON_TEX_PX / 2 + OV.ICON_RING_PAD;
        if (mode === "hover") {
            g.lineStyle(1, 0xffffff, 0.22);
            g.drawCircle(cx, cy, r);
        } else if (mode === "meal") {
            g.lineStyle(1.2, OV.BORDER_MEAL, 0.88);
            g.drawCircle(cx, cy, r);
        } else if (mode === "far") {
            g.lineStyle(1.2, OV.BORDER_FAR, 1);
            g.drawCircle(cx, cy, r);
        }
    }

    _onHover(over) {
        if (this._dimmed) return;
        this._hoverHighlight = over;
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
        if (this._dimmed) return;
        if (!_stationTokenStillOnScene(this.token)) return;
        console.log(`${MODULE_ID} | Station overlay _onClick`, { stationId: this.station.id, dimmed: this._dimmed });
        if (this._skipProximity) {
            this.onClickFn(this.station.id, this.token, this);
            return;
        }
        // Proximity check: find the user's actor token
        const actorIds = Object.keys(this.actorMap);
        let playerActorId = null;
        if (typeof _getProximityActorId === "function") {
            const pid = _getProximityActorId();
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
                    console.log(`${MODULE_ID} | Station too far`, { dist, maxDist, playerActorId });
                    this._showFarWarning(Math.round(dist));
                    return;
                }
            } else {
                console.warn(`${MODULE_ID} | Station proximity: no canvas token for actor`, { playerActorId });
            }
        } else {
            console.warn(`${MODULE_ID} | Station proximity: no owned actor in actorMap`, { actorIds });
        }

        console.log(`${MODULE_ID} | Station opening picker`, { stationId: this.station.id });
        this.onClickFn(this.station.id, this.token, this);
    }

    _showFarWarning(distFt) {
        this._drawBg(this._bg, OV.BORDER_FAR, OV.BG_ALPHA, OV.OUTLINE_FAR);
        this._drawIconRing(this._iconRing, 0, 0, "far");
        if (this._hoverLabel) this._hoverLabel.visible = false;
        this._farText.text    = `${distFt}ft away`;
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
            }
            this._farText.visible = false;
        }, 2500);
    }

    /** Called each ticker tick. Returns the updated pulse phase. */
    tick(delta) {
        if (this._dimmed || this._mealOnly || this._hoverHighlight) return;
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
        if (this._emptyNoticeFade) {
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
        if (this._container) {
            const parent = this._container.parent;
            if (parent) parent.removeChild(this._container);
            this._container.destroy({ children: true });
        }
        this._container = null;
    }
}

// Module-level singleton state
let _overlays          = [];       // StationOverlay[]
let _actorMap          = {};       // { [actorId]: { hasBedroll, assignedTokenId } }
let _tickerFn          = null;
let _active            = false;
let _clickCallback     = null;
let _overlayContainer       = null;  // PIXI.Container (TokensLayer when available)
let _savedTokensSortable    = false;
let _tokensSortablePrev     = false;
let _domClickHandler   = null;     // capture-phase pointerdown on #board
let _domHoverHandler   = null;     // pointermove on #board for cursor + highlight
let _prevHoveredOv     = null;     // last overlay that was hovered
/** GM: returns actor id in party for station distance checks (roster or controlled token). */
let _getProximityActorId = null;
let _tokenUpdateHook     = null;

/**
 * True when the overlay's station token is still the live placeable for this id on
 * the canvas. Stale references remain after a bedroll (or other gear) is picked up;
 * using them in layout or getBounds() can throw in PIXI (null transform / position).
 * @param {Token|null|undefined} token
 * @returns {boolean}
 */
function _stationTokenStillOnScene(token) {
    if (!token?.document) return false;
    if (!canvas?.ready) return true;
    try {
        return canvas.tokens?.get?.(token.id) === token;
    } catch {
        return false;
    }
}

function _clientToCanvasXY(clientX, clientY) {
    const view = canvas.app?.view;
    if (!view) return null;
    const rect = view.getBoundingClientRect();
    return {
        x: (clientX - rect.left) * (view.width / rect.width),
        y: (clientY - rect.top) * (view.height / rect.height)
    };
}

function _pointInGlobalBounds(canvasX, canvasY, b) {
    if (!b || (b.width <= 0 && b.height <= 0)) return false;
    return canvasX >= b.x && canvasX <= b.x + b.width
        && canvasY >= b.y && canvasY <= b.y + b.height;
}

/**
 * Notice card or the station token sprite (both open the picker).
 */
function _hitTestOverlayScreen(ov, clientX, clientY) {
    if (ov._dimmed && !ov._mealOnly) return false;
    const p = _clientToCanvasXY(clientX, clientY);
    if (!p) return false;
    let notice = null;
    try {
        notice = ov._container?.getBounds();
    } catch {
        return false;
    }
    if (_pointInGlobalBounds(p.x, p.y, notice)) return true;
    if (!_stationTokenStillOnScene(ov.token)) return false;
    let tokenB = null;
    try {
        tokenB = ov.token?.getBounds?.();
    } catch {
        return false;
    }
    if (_pointInGlobalBounds(p.x, p.y, tokenB)) return true;
    return false;
}

/**
 * Party actor id for the current client (station UI / bedroll ownership). Matches RestSetupApp._resolveStationActorForUser for non-GM.
 * @returns {string|null}
 */
function _currentUserPartyActorId() {
    if (game.user?.isGM) return null;
    const partyActors = getPartyActors();
    const inParty = a => a && partyActors.some(p => p.id === a.id);
    const assigned = game.user?.character;
    if (assigned && inParty(assigned) && assigned.isOwner) return assigned.id;
    const owned = partyActors.filter(a => a.isOwner);
    if (owned.length === 1) return owned[0].id;
    if (owned.length > 1) {
        const fromToken = canvas.tokens?.controlled?.[0]?.actor;
        if (fromToken && owned.some(a => a.id === fromToken.id)) return fromToken.id;
        return owned[0].id;
    }
    const OBS = CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER;
    const playable = partyActors.find(a => a.testUserPermission(game.user, OBS));
    return playable?.id ?? null;
}

/**
 * Reposition any overlay whose token refreshed (fires continuously during drag animation).
 * @param {Token} token - Foundry Token placeable
 */
function _onRefreshTokenForOverlays(token) {
    const f = token.document?.flags?.[MODULE_ID];
    if (!f?.isCampFurniture && !f?.isPlayerGear) return;
    if (!_stationTokenStillOnScene(token)) return;
    const id = token.id;
    for (const ov of _overlays) {
        if (ov.token?.id === id) {
            ov._syncNoticeLayout();
            break;
        }
    }
}

/**
 * Activate overlays for all placed station tokens.
 *
 * @param {Object} actorMap  - { [actorId]: { hasBedroll: bool, assignedTokenId: string } }
 * @param {Function} onStationClick - (stationId, token, overlay) called when player clicks a station
 * @param {object} [options]
 * @param {() => string|null|undefined} [options.getProximityActorId] - GM client: party actor id for distance
 * @param {Record<string, boolean>} [options.stationEmptyNoticeFade] - station id -> muted notice when no available activities
 * @param {boolean} [options.campPitModeOnly] - Only the campfire pit token, with Make Camp copy (all clients)
 * @param {boolean} [options.campPitUnlit] - "Light the fire" vs "Campfire" label
 */
export function activateStationLayer(actorMap, onStationClick, options = {}) {
    deactivateStationLayer();

    _actorMap      = actorMap ?? {};
    _active        = true;
    _clickCallback = onStationClick;
    _getProximityActorId = typeof options.getProximityActorId === "function"
        ? options.getProximityActorId
        : null;
    const emptyFadeMap = options.stationEmptyNoticeFade && typeof options.stationEmptyNoticeFade === "object"
        ? options.stationEmptyNoticeFade
        : {};
    const campPitModeOnly = !!options.campPitModeOnly;
    const campPitUnlit    = options.campPitUnlit !== false;

    // Parent to TokensLayer so notices draw above furniture tokens; high zIndex
    // keeps the whole tray above per-token elevation sorting.
    _overlayContainer = new PIXI.Container();
    _overlayContainer.sortableChildren = true;
    if ("eventMode" in _overlayContainer) {
        _overlayContainer.eventMode = "passive";
    } else {
        _overlayContainer.interactiveChildren = true;
    }
    _overlayContainer.zIndex = 1_000_000;

    let host;
    if (canvas.tokens?.addChild) {
        host = canvas.tokens;
        _savedTokensSortable = true;
        _tokensSortablePrev  = host.sortableChildren;
        host.sortableChildren = true;
    } else {
        host = canvas.interface ?? canvas.stage;
        if (host === canvas.interface && "sortableChildren" in host) host.sortableChildren = true;
        _savedTokensSortable = false;
    }
    host.addChild(_overlayContainer);
    console.log(`${MODULE_ID} | StationInteractionLayer: overlay container added to`, host.constructor?.name ?? "stage");

    const sceneTokens = canvas.tokens?.placeables ?? [];
    console.log(`${MODULE_ID} | StationInteractionLayer.activate`, {
        isGM: game.user.isGM,
        sceneTokenCount: sceneTokens.length,
        actorMapKeys:    Object.keys(_actorMap)
    });

    for (const station of CAMP_STATIONS) {
        if (campPitModeOnly) {
            if (station.furnitureKey !== "campfire") continue;
        } else if (!station.furnitureKey) {
            continue; // bedroll: separate pass
        }

        const token = sceneTokens.find(t => {
            const flags = t.document.flags?.[MODULE_ID];
            if (!flags?.isCampFurniture) return false;
            if (campPitModeOnly) {
                return flags.furnitureKey === "campfire" && flags.isCampfireBase;
            }
            return flags.furnitureKey === station.furnitureKey;
        });

        if (!token) continue;

        const displayOverride = campPitModeOnly
            ? (campPitUnlit
                ? { title: "Light the fire", tagline: "Set up camp and light the fire" }
                : { title: "Campfire", tagline: (station.tagline ?? "").replace(/,/g, " · ") })
            : null;

        const overlay = new StationOverlay(
            token,
            station,
            _actorMap,
            _clickCallback,
            {
                emptyNoticeFade: !!emptyFadeMap[station.id],
                displayOverride: displayOverride ?? undefined,
                skipProximity:  !!campPitModeOnly
            }
        );
        _overlays.push(overlay);
        if (campPitModeOnly) break;
    }

    // Player bedroll tokens (named per owner)
    const bedrollStation = CAMP_STATIONS.find(s => s.id === "bedroll");
    if (bedrollStation && !campPitModeOnly) {
        for (const actorId of Object.keys(_actorMap)) {
            if (!isGearDeployed(actorId, "bedroll")) continue;
            const token = sceneTokens.find(t => {
                const f = t.document.flags?.[MODULE_ID];
                return f?.isPlayerGear && f?.furnitureKey === "bedroll" && f?.ownerActorId === actorId;
            });
            if (!token) continue;
            const ownerActor = game.actors.get(actorId);
            const ownerName = ownerActor?.name ?? "Bedroll";
            const overlay = new StationOverlay(
                token,
                bedrollStation,
                _actorMap,
                _clickCallback,
                {
                    emptyNoticeFade: !!emptyFadeMap.bedroll,
                    displayOverride: { title: `${ownerName}'s Bedroll` }
                }
            );
            _overlays.push(overlay);
            const me = _currentUserPartyActorId();
            if (me != null && actorId !== me) {
                overlay._permanentlyDimmed = true;
                overlay.setDimmed();
            }
        }
    }

    if (!_tokenUpdateHook) {
        _tokenUpdateHook = _onRefreshTokenForOverlays;
        Hooks.on("refreshToken", _tokenUpdateHook);
    }

    // Ticker for pulse animation
    _tickerFn = (delta) => {
        for (const ov of _overlays) ov.tick(delta);
    };
    canvas.app.ticker.add(_tickerFn);

    // DOM-level event handlers (capture phase) so clicks and hover work regardless
    // of how Foundry/PIXI routes events through canvas layers.
    const board = document.getElementById("board");
    if (board) {
        _domClickHandler = (event) => {
            if (!_active || _overlays.length === 0) return;
            for (let i = _overlays.length - 1; i >= 0; i--) {
                const ov = _overlays[i];
                if (_hitTestOverlayScreen(ov, event.clientX, event.clientY)) {
                    event.stopPropagation();
                    event.preventDefault();
                    console.log(`${MODULE_ID} | DOM pointerdown hit`, { stationId: ov.station.id });
                    ov._onClick();
                    return;
                }
            }
        };
        board.addEventListener("pointerdown", _domClickHandler, true);

        _domHoverHandler = (event) => {
            if (!_active || _overlays.length === 0) return;
            let hit = null;
            for (let i = _overlays.length - 1; i >= 0; i--) {
                const ov = _overlays[i];
                if (_hitTestOverlayScreen(ov, event.clientX, event.clientY)) { hit = ov; break; }
            }
            if (hit !== _prevHoveredOv) {
                if (_prevHoveredOv) _prevHoveredOv._onHover(false);
                if (hit) hit._onHover(true);
                _prevHoveredOv = hit;
                board.style.cursor = hit ? "pointer" : "";
            }
        };
        board.addEventListener("pointermove", _domHoverHandler);
    } else {
        console.warn(`${MODULE_ID} | #board element not found; overlay clicks will not work`);
    }

    console.log(`${MODULE_ID} | StationInteractionLayer: ${_overlays.length} overlay(s) attached, DOM handlers registered`);
}

/**
 * Remove all overlays and stop the ticker.
 */
export function deactivateStationLayer() {
    if (_tokenUpdateHook) {
        Hooks.off("refreshToken", _tokenUpdateHook);
        _tokenUpdateHook = null;
    }
    if (_tickerFn) {
        canvas.app?.ticker.remove(_tickerFn);
        _tickerFn = null;
    }
    for (const ov of _overlays) ov.destroy();
    _overlays = [];
    for (const tex of _faRasterCache.values()) tex?.destroy?.(true);
    _faRasterCache.clear();

    if (_overlayContainer) {
        const parent = _overlayContainer.parent;
        if (parent) parent.removeChild(_overlayContainer);
        _overlayContainer.destroy({ children: true });
        _overlayContainer = null;
    }

    if (_savedTokensSortable && canvas.tokens) {
        canvas.tokens.sortableChildren = _tokensSortablePrev;
        _savedTokensSortable = false;
    }

    const board = document.getElementById("board");
    if (_domClickHandler) {
        board?.removeEventListener("pointerdown", _domClickHandler, true);
        _domClickHandler = null;
    }
    if (_domHoverHandler) {
        board?.removeEventListener("pointermove", _domHoverHandler);
        _domHoverHandler = null;
    }
    if (board) board.style.cursor = "";
    _prevHoveredOv = null;

    _active        = false;
    _actorMap      = {};
    _clickCallback = null;
    _getProximityActorId = null;
}

/**
 * Called after an actor chooses an activity. Dims non-meal overlays for that actor.
 * Meal stations (campfire, cookingArea) switch to meal-only style.
 *
 * @param {string} actorId
 * @param {string} chosenStationId  - the station the actor chose at
 * @param {Map<string, string>|null} [characterChoicesMap] - when set (e.g. RestSetupApp._characterChoices), all stations show stacked portraits for matching picks (GM + full party).
 * @param {Map<string, string>|null} [explicitStationByCharacter] - characterId -> station id from canvas pick (optional)
 */
export function setStationPlayerState(actorId, chosenStationId, characterChoicesMap = null, explicitStationByCharacter = null) {
    if (!_active) return;

    const actor = game.actors.get(actorId);
    // GMs usually have OWNER on all PCs; `isOwner` alone would dim the whole camp on the GM
    // client after any player picks. Only the assigned player client gets the locked-in layout.
    const isPickingPlayerClient = !game.user.isGM && !!actor?.isOwner;
    const portraitSrc = actor?.img ?? "icons/svg/mystery-man.svg";
    const choicesMap = characterChoicesMap instanceof Map ? characterChoicesMap : null;
    const explicitMap = explicitStationByCharacter instanceof Map ? explicitStationByCharacter : null;

    for (const ov of _overlays) {
        ov.clearChosenPortrait();
    }

    // Dim peripheral stations for the player who locked a choice (not for GM clients).
    // Portraits still use choicesMap so the GM sees who picked where.
    for (const ov of _overlays) {
        const isMeal = MEAL_STATION_KEYS.has(ov.station.furnitureKey);
        if (ov.station.id === chosenStationId) {
            if (isMeal && isPickingPlayerClient) {
                ov.setDimmed(true);
            } else if (!isMeal) {
                ov.setDimmed(false);
            }
        } else if (isMeal) {
            ov.setDimmed(true); // mealOnly = true
        } else if (isPickingPlayerClient) {
            ov.setDimmed(false);
        }

        const urls = choicesMap
            ? _portraitUrlsForStation(ov.station.id, choicesMap, explicitMap)
            : (ov.station.id === chosenStationId && isPickingPlayerClient ? [portraitSrc] : []);
        if (urls.length) ov.setChosenPortraits(urls);
    }
}

/**
 * Restores all station overlays to the default active look on this client.
 * Used when a player clears an activity pick that had updated local overlay styling.
 */
export function resetStationOverlaysLocal() {
    if (!_active) return;
    for (const ov of _overlays) ov.setActive();
}

/**
 * Updates stacked portraits on all station notices from the canonical activity map.
 * Does not change dim state (use {@link setStationPlayerState} after a local pick).
 * @param {Map<string, string>} characterChoicesMap  characterId -> activityId
 * @param {Map<string, string>|null} [explicitStationByCharacter]  characterId -> canvas station id when known
 */
export function refreshStationPortraitsFromChoices(characterChoicesMap, explicitStationByCharacter = null) {
    if (!_active || !(characterChoicesMap instanceof Map)) return;
    const explicitMap = explicitStationByCharacter instanceof Map ? explicitStationByCharacter : null;
    for (const ov of _overlays) {
        ov.clearChosenPortrait();
    }
    for (const ov of _overlays) {
        const urls = _portraitUrlsForStation(ov.station.id, characterChoicesMap, explicitMap);
        if (urls.length) ov.setChosenPortraits(urls);
    }
}

/**
 * Updates muted notice styling when the roster actor or rest context changes.
 * @param {{ _buildStationEmptyNoticeMap?: () => Record<string, boolean> }} restApp
 */
export function refreshStationEmptyNoticeFade(restApp) {
    if (!_active || typeof restApp?._buildStationEmptyNoticeMap !== "function") return;
    const map = restApp._buildStationEmptyNoticeMap();
    for (const ov of _overlays) {
        ov.setEmptyNoticeFade(!!map[ov.station.id]);
    }
}

/**
 * Activity-phase rations queue on one station notice (cooking token if present, else campfire).
 * @param {{ _getPendingMealCanvasPlan?: () => { stationId: string|null, urls: string[] } }} restApp
 */
export function refreshStationMealPortraits(restApp) {
    if (!_active || typeof restApp?._getPendingMealCanvasPlan !== "function") return;
    const { stationId, urls } = restApp._getPendingMealCanvasPlan();
    for (const ov of _overlays) {
        if (ov.station.id === "bedroll") {
            ov.clearMealPortraits();
            continue;
        }
        if (stationId && ov.station.id === stationId && urls.length > 0) {
            ov.setMealPortraits(urls);
        } else {
            ov.clearMealPortraits();
        }
    }
}

/**
 * Returns whether the station layer is currently active.
 */
export function isStationLayerActive() {
    return _active;
}
