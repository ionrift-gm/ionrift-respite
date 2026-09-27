/**
 * CampfireAssetCache
 * Handles offscreen rasterization and caching of FontAwesome glyphs and item images
 * for the 2D HTML5 canvas campfire simulation.
 */

/**
 * Bitmap box for a glyph so the ink, including side bearings, stays inside the canvas.
 * A tight em-square crop clips wide marks (the fish tail) and leaves a hard edge.
 * @param {Pick<TextMetrics, "actualBoundingBoxLeft"|"actualBoundingBoxRight"|"actualBoundingBoxAscent"|"actualBoundingBoxDescent">|null|undefined} metrics
 * @param {number} size Font size in px
 * @returns {{ width: number, height: number, x: number, y: number }}
 */
/**
 * First Font Awesome private-use character in a CSS content value.
 * Extra characters after the icon (a hyphen, a space) paint as a stray stroke.
 * @param {string|null|undefined} content
 * @returns {string|null}
 */
export function iconGlyph(content) {
    if (!content || content === "none" || content === "normal") return null;
    const unquoted = String(content).replace(/^['"]+|['"]+$/g, "");
    const chars = Array.from(unquoted);
    const pua = chars.find(ch => {
        const code = ch.codePointAt(0) ?? 0;
        return (code >= 0xE000 && code <= 0xF8FF) || (code >= 0xF0000 && code <= 0xFFFFD);
    });
    if (pua) return pua;
    return chars.length === 1 ? chars[0] : null;
}

/**
 * Detached 1-2px rules under an icon. The font paints a baseline stroke
 * that is not part of the mark.
 * @param {number[]} rowCounts
 * @param {number} width
 * @returns {Array<[number, number]>}
 */
export function hairlineRowsToClear(rowCounts, width) {
    const height = rowCounts.length;
    let bestStart = 0;
    let bestEnd = 0;
    let best = 0;
    let runStart = -1;
    for (let y = 0; y <= height; y++) {
        const on = y < height && rowCounts[y] > 0;
        if (on && runStart < 0) runStart = y;
        if (!on && runStart >= 0) {
            const len = y - runStart;
            if (len > best) {
                best = len;
                bestStart = runStart;
                bestEnd = y;
            }
            runStart = -1;
        }
    }

    const ranges = [];
    const wideEnough = Math.max(8, Math.floor(width * 0.35));
    let y = 0;
    while (y < height) {
        if (rowCounts[y] === 0 || (y >= bestStart && y < bestEnd)) {
            y++;
            continue;
        }
        let end = y;
        while (end < height && rowCounts[end] > 0 && (end < bestStart || end >= bestEnd)) end++;
        const thick = end - y;
        let wide = 0;
        for (let row = y; row < end; row++) wide = Math.max(wide, rowCounts[row]);
        if (thick <= 2 && wide >= wideEnough) ranges.push([y, end]);
        y = end;
    }
    return ranges;
}

function scrubGlyphHairline(canvas) {
    const ctx = canvas.getContext("2d");
    const { width, height } = canvas;
    if (!width || !height) return;
    const image = ctx.getImageData(0, 0, width, height);
    const data = image.data;
    const rowCounts = new Array(height).fill(0);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (data[(y * width + x) * 4 + 3] > 80) rowCounts[y]++;
        }
    }
    const ranges = hairlineRowsToClear(rowCounts, width);
    if (!ranges.length) return;
    for (const [start, end] of ranges) {
        for (let y = start; y < end; y++) {
            for (let x = 0; x < width; x++) {
                const i = (y * width + x) * 4;
                data[i] = data[i + 1] = data[i + 2] = data[i + 3] = 0;
            }
        }
    }
    ctx.putImageData(image, 0, 0);
}

export function glyphRasterBox(metrics, size) {
    const ink = (value, fallback) => (typeof value === "number" && value > 0 ? value : fallback);
    const left = ink(metrics?.actualBoundingBoxLeft, size);
    const right = ink(metrics?.actualBoundingBoxRight, size);
    const ascent = ink(metrics?.actualBoundingBoxAscent, size);
    const descent = ink(metrics?.actualBoundingBoxDescent, size * 0.35);
    const pad = Math.ceil(size * 0.45);
    return {
        width: Math.ceil(left + right + pad * 2),
        height: Math.ceil(ascent + descent + pad * 2),
        x: pad + left,
        y: pad + ascent
    };
}

export class CampfireAssetCache {

    constructor() {
        /** @type {Map<string, HTMLCanvasElement>} icon key -> rendered offscreen canvas */
        this._iconCache = new Map();
        /** @type {Map<string, HTMLCanvasElement>} src@size -> rendered offscreen canvas */
        this._imageCache = new Map();
        /** @type {Set<string>} */
        this._imageLoadPending = new Set();
        /** Whether icon font is ready */
        this._fontReady = false;

        // Pre-render icons once fonts are loaded
        if (typeof document !== "undefined" && document.fonts?.ready) {
            document.fonts.ready.then(() => {
                this._fontReady = true;
                this._iconCache.clear();
            });
        }
    }

    get isFontReady() {
        return this._fontReady;
    }

    /** Warm the image cache before the first kindling drop. */
    preloadImage(src, size = 24) {
        if (src) this.getCachedImage(src, size);
    }

    /**
     * @param {string} src
     * @param {number} size
     * @returns {HTMLCanvasElement|null}
     */
    getCachedImage(src, size) {
        const key = `${src}@${size}`;
        if (this._imageCache.has(key)) return this._imageCache.get(key);
        if (this._imageLoadPending.has(key)) return null;
        if (typeof Image === "undefined") return null;

        this._imageLoadPending.add(key);
        const img = new Image();
        img.addEventListener("load", () => {
            const padding = 4;
            const canvasSize = size + padding * 2;
            const offscreen = document.createElement("canvas");
            offscreen.width = canvasSize;
            offscreen.height = canvasSize;
            const octx = offscreen.getContext("2d");
            octx.drawImage(img, padding, padding, size, size);
            this._imageCache.set(key, offscreen);
            this._imageLoadPending.delete(key);
        }, { once: true });
        img.addEventListener("error", () => {
            this._imageLoadPending.delete(key);
        }, { once: true });
        img.src = src;
        return null;
    }

    /**
     * Get or create a cached icon rendering by probing the DOM for the actual FA glyph.
     * @param {string} iconClass
     * @param {string} color
     * @param {number} size
     * @returns {HTMLCanvasElement|null}
     */
    getCachedIcon(iconClass, color, size) {
        const key = `${iconClass}|${color}`;
        if (this._iconCache.has(key)) return this._iconCache.get(key);

        if (typeof document === "undefined") return null;

        // Probe the DOM: create a temporary FA element, read its computed glyph + font
        const probe = document.createElement("i");
        probe.className = iconClass;
        probe.style.cssText = "position:absolute;left:-9999px;top:-9999px;visibility:hidden;font-size:16px;";
        document.body.appendChild(probe);

        const computed = window.getComputedStyle(probe, "::before");
        const content = computed.content;  // e.g. '"\\f6d3"' or '"\uf6d3"'
        const fontFamily = computed.fontFamily;
        const fontWeight = computed.fontWeight || "900";
        document.body.removeChild(probe);

        // Extract the actual character from the content property
        // content comes as '"X"' where X is the unicode char
        const glyph = iconGlyph(content);
        if (!glyph) return null;

        const font = `${fontWeight} ${size}px ${fontFamily}`;
        const measure = document.createElement("canvas").getContext("2d");
        measure.font = font;
        const box = glyphRasterBox(measure.measureText(glyph), size);

        const offscreen = document.createElement("canvas");
        offscreen.width = box.width;
        offscreen.height = box.height;
        const octx = offscreen.getContext("2d");

        octx.font = font;
        octx.fillStyle = color;
        octx.textAlign = "left";
        octx.textBaseline = "alphabetic";
        octx.shadowBlur = 0;
        octx.fillText(glyph, box.x, box.y);
        scrubGlyphHairline(offscreen);

        this._iconCache.set(key, offscreen);
        return offscreen;
    }

    clear() {
        this._iconCache.clear();
        this._imageCache.clear();
        this._imageLoadPending.clear();
    }
}
