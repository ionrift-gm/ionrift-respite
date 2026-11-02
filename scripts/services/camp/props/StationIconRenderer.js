import { inferCanvasStationForActivity } from "../../../data/RestConstants.js";

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
export function _faGlyphFromIconClass(iconClass) {
    if (!iconClass || typeof iconClass !== "string") return "";
    const parts = iconClass.trim().split(/\s+/);
    const faName = parts.find(p => p.startsWith("fa-"));
    if (!faName) return "";
    const cp = FA_SOLID_CODEPOINT[faName];
    return cp != null ? String.fromCodePoint(cp) : "";
}

let _activateGeneration = 0;

/** Matches `--ionrift-font-stack` in ionrift-library (PIXI.Text does not inherit app CSS). */
export const UI_FONT_STACK = "Signika, sans-serif";

let _solidFamilyCache = null;

/**
 * Resolve the Font Awesome SOLID family for the current install.
 *
 * "First weight-900 FA family" is not enough: Duotone also ships a 900 face,
 * and Duotone splits every icon into two layers, so a single codepoint renders
 * only one layer (the half-glyph / missing-wrench artifact). Brands is its own
 * icon set entirely. Probe the live `.fa-solid` computed family first, since
 * that is exactly what the page uses for solid icons; fall back to a weight-900
 * face that is neither Duotone nor Brands. Resolved once fonts are ready, then
 * cached for the session.
 * @returns {string}
 */
export function _faSolidFamily() {
    if (_solidFamilyCache) return _solidFamilyCache;
    try {
        const probe = document.createElement("i");
        probe.className = "fas fa-solid fa-fire";
        probe.style.cssText = "position:absolute;left:-9999px;top:0;opacity:0;";
        document.body.appendChild(probe);
        const famCss = window.getComputedStyle(probe, "::before").fontFamily
            || window.getComputedStyle(probe).fontFamily;
        probe.remove();
        const primary = (famCss || "").split(",")[0]?.trim().replace(/^['"]|['"]$/g, "") ?? "";
        if (/font\s*awesome/i.test(primary) && !/duotone|brands/i.test(primary)) {
            _solidFamilyCache = primary;
            return primary;
        }
    } catch { /* probe unsupported */ }
    try {
        for (const face of document.fonts) {
            if (!/font\s*awesome/i.test(face.family)) continue;
            if (/duotone|brands/i.test(face.family)) continue;
            const w = Number(String(face.weight).split(/\s+/)[0]) || 400;
            if (w === 900) {
                _solidFamilyCache = face.family.replace(/^['"]|['"]$/g, "");
                return _solidFamilyCache;
            }
        }
    } catch { /* iteration unsupported */ }
    return "Font Awesome 6 Free";
}

/**
 * Force-load every Font Awesome face the page registered.
 * @returns {Promise<void>}
 */
export function ensureIconFontsLoaded() {
    const fontApi = document.fonts;
    if (!fontApi?.load) return Promise.resolve();
    const work = async () => {
        await fontApi.ready;
        const pending = [];
        for (const face of fontApi) {
            if (/font\s*awesome/i.test(face.family)) {
                pending.push(face.load().catch(() => {}));
            }
        }
        pending.push(
            fontApi.load(`900 ${OV.ICON_TEX_PX}px "Font Awesome 6 Free"`, "\uf06d").catch(() => {}),
            fontApi.load(`900 ${OV.ICON_TEX_PX}px "Font Awesome 5 Free"`, "\uf06d").catch(() => {})
        );
        await Promise.allSettled(pending);
        await fontApi.ready;
    };
    return work().catch(() => undefined);
}

export function _hexRgb(n) {
    return `#${(n >>> 0).toString(16).padStart(6, "0")}`;
}

/** Pixel bounding box of opaque ink in a context, or null if empty. */
export function _scanInkBounds(ctx, w, h) {
    const data = ctx.getImageData(0, 0, w, h).data;
    let minX = w, minY = h, maxX = -1, maxY = -1;
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            if (data[(y * w + x) * 4 + 3] > 12) {
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
            }
        }
    }
    if (maxX < 0) return null;
    return { minX, minY, maxX, maxY };
}

/**
 * Rasterize a station's FA glyph onto a tightly cropped, centered canvas.
 *
 * Draws the glyph on a generous canvas and crops to scanned ink bounds, so the
 * full glyph always survives regardless of the font's reported metric box (FA
 * icons draw ink outside it). Render large for crispness; the sprite is scaled
 * down to badge size by _layoutIconSprite. The font family must be solid, not
 * Duotone; see _faSolidFamily.
 * @param {Object} station - CAMP_STATIONS entry
 * @param {number} fill    - glyph color
 * @param {number} px      - raster font size
 * @returns {HTMLCanvasElement|null}
 */
export function _rasterIconCanvas(station, fill, px) {
    const glyph = _faGlyphFromIconClass(station.icon);
    if (!glyph) return null;
    const family = _faSolidFamily();
    const fontCss = `900 ${px}px "${family.replace(/"/g, '\\"')}"`;
    const big = Math.max(64, px * 4);
    const scratch = document.createElement("canvas");
    scratch.width = big;
    scratch.height = big;
    const sctx = scratch.getContext("2d");
    sctx.clearRect(0, 0, big, big);
    sctx.fillStyle = _hexRgb(fill);
    sctx.font = fontCss;
    sctx.textAlign = "center";
    sctx.textBaseline = "middle";
    sctx.fillText(glyph, big / 2, big / 2);

    const bb = _scanInkBounds(sctx, big, big);
    if (!bb) return null;
    const gW = bb.maxX - bb.minX + 1;
    const gH = bb.maxY - bb.minY + 1;
    const pad = Math.max(2, Math.round(px * 0.12));
    const size = Math.max(gW, gH) + pad * 2;
    const out = document.createElement("canvas");
    out.width = size;
    out.height = size;
    out.getContext("2d").drawImage(
        scratch,
        bb.minX, bb.minY, gW, gH,
        Math.round((size - gW) / 2), Math.round((size - gH) / 2), gW, gH
    );
    return out;
}

const _iconTexCache = new Map();

/**
 * PIXI texture for a station icon, via the cropped Canvas2D raster. Canvas2D
 * rasters can upload blank through PIXI.Texture.from(canvas) on some WebGL
 * paths; a PNG data URL routed through an Image decodes reliably.
 * @returns {Promise<PIXI.Texture|null>}
 */
export function _iconTextureAsync(station, fill, px) {
    const glyph = _faGlyphFromIconClass(station.icon);
    const key = `${station.id}|${fill}|${px}|${glyph ? glyph.codePointAt(0).toString(16) : "none"}`;
    if (_iconTexCache.has(key)) return Promise.resolve(_iconTexCache.get(key));
    const cvs = _rasterIconCanvas(station, fill, px);
    if (!cvs) return Promise.resolve(null);
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            let tex = null;
            try {
                tex = PIXI.Texture.from(img);
                tex?.baseTexture?.update?.();
            } catch {
                tex = null;
            }
            if (tex) _iconTexCache.set(key, tex);
            resolve(tex);
        };
        img.onerror = () => resolve(null);
        img.src = cvs.toDataURL("image/png");
    });
}

const _ICON_SPRITE_MAX = 22;
// Rasterize larger than display size, then scale the sprite down for a crisp icon.
const ICON_RASTER_PX = 44;

/** @param {PIXI.Sprite} spr @param {PIXI.Texture} tex */
export function _layoutIconSprite(spr, tex) {
    spr.anchor.set(0.5, 0.5);
    spr.x = 0;
    spr.y = 0;
    const w = tex.width || _ICON_SPRITE_MAX;
    const h = tex.height || _ICON_SPRITE_MAX;
    const sc = Math.min(_ICON_SPRITE_MAX / w, _ICON_SPRITE_MAX / h, 1.5);
    spr.scale.set(sc);
}

// V2: circular icon badge with floating portrait bubbles
export const OV = {
    BADGE_R:       24,
    ICON_RING_PAD: 4,
    SHADOW_OFFSET: 2,
    SHADOW_ALPHA:  0.34,
    BG_COLOR:      0x0c0b10,
    BG_ALPHA:      0.86,
    BORDER_GLASS:  0xffffff,
    BORDER_HOVER:  0xc4b5fd,
    BORDER_MEAL:   0xfbbf24,
    BORDER_DM:     0xc4a0ff,
    BORDER_FAR:    0xf43f5e,
    OUTLINE_IDLE:  0.11,
    OUTLINE_HOVER: 0.24,
    OUTLINE_MEAL:  0.42,
    OUTLINE_DM:    0.58,
    OUTLINE_FAR:   0.55,
    FONT_TOOLTIP:  { fontFamily: UI_FONT_STACK, fontSize: 11, fill: 0xffffff, fontWeight: "bold" },
    FONT_FAR:      { fontFamily: UI_FONT_STACK, fontSize: 10, fill: 0xfca5a5 },
    ICON_TEX_PX:   22,
    PULSE_SPEED:   0.0015,
    PULSE_MIN:     0.9,
    PULSE_MAX:     1.0,
    EMPTY_PULSE_MIN: 0.4,
    EMPTY_PULSE_MAX: 0.58,
    DM_PULSE_MIN:    0.82,
    DM_PULSE_MAX:    1.0,
    DM_ICON_TINT:    0xe0c8ff,
    /** Expanding ripple rings while Detect Magic is active (ms-scaled ticker delta). */
    DM_EMANATION_SPEED: 0.00185,
    DM_EMANATION_EXTRA: 22,
    DM_EMANATION_RINGS: 3,
    DM_EMANATION_ALPHA: 0.72,
    /** Fraction of each ring cycle spent fading in at spawn (0..1). */
    DM_EMANATION_BIRTH: 0.08,
    /** Whole-aura fade when scan glow first turns on (ms). */
    DM_EMANATION_INTRO_MS: 140,
    DIM_ALPHA:     0.22,
    MEAL_BODY_ALPHA: 0.92,
    PORTRAIT_R:    17,
    PORTRAIT_GAP:  2,
    PORTRAIT_STACK_OVERLAP: 11,
    PORTRAIT_STACK_MAX:    4,
    MEAL_GAP:      2,
    /** Smaller than PORTRAIT_R: rations debt queue vs major-activity pick portraits. */
    MEAL_PORTRAIT_R:     11,
    MEAL_PORTRAIT_STEP:  8,
    MEAL_PORTRAIT_STACK_MAX: 5,
    LABEL_GAP:     5,
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
 * @param {Map<string, string>} characterChoicesMap
 * @param {Map<string, string>|null} [explicitStationByCharacter]
 * @returns {string[]}
 */
export function _portraitUrlsForStation(stationId, characterChoicesMap, explicitStationByCharacter = null) {
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
