/**
 * ImageResolver
 *
 * Centralizes image path resolution for Respite with a two-tier model:
 *
 *   - Art pack active: resolve from ionrift-respite-art terrain folders
 *   - Art pack absent: return the universal fallback banner directly
 *
 * When hand-drawn per-terrain art ships in the base module, add the
 * filenames to KNOWN_BASE_IMAGES so they resolve without probing.
 */

const MODULE_ID = "ionrift-respite";
const ART_PACK_ID = "ionrift-respite-art";
const FALLBACK_BANNER = `modules/${MODULE_ID}/assets/placeholder-banner.webp`;

// Hand-drawn images known to exist in the base module's terrain folders.
// Add entries here as the partner delivers replacement art.
// Format: "terrain/filename" e.g. "forest/banner.png"
const KNOWN_BASE_IMAGES = new Set([
    // "forest/banner.png",
]);

export class ImageResolver {

    /** Resolved base path for image assets. */
    static #basePath = `modules/${MODULE_ID}`;

    /** Whether the art pack is active. */
    static #artPackActive = false;

    /**
     * Call once during the ready hook.
     * Detects whether the art pack is installed and active.
     */
    static init() {
        const artPack = game.modules.get(ART_PACK_ID);
        this.#artPackActive = !!artPack?.active;

        if (this.#artPackActive) {
            this.#basePath = `modules/${ART_PACK_ID}`;
        }

        console.log(`${MODULE_ID} | ImageResolver: artPack=${this.#artPackActive}`);
    }

    /**
     * Resolve a terrain banner path.
     *
     * Art pack active: returns the art pack terrain-specific path.
     * Art pack absent: returns a known base-module image if one exists
     * for that terrain, otherwise the universal fallback.
     */
    static terrainBanner(terrain, filename) {
        if (this.#artPackActive) {
            return `${this.#basePath}/data/terrains/${terrain}/${filename}`;
        }

        const key = `${terrain}/${filename}`;
        if (KNOWN_BASE_IMAGES.has(key)) {
            return `modules/${MODULE_ID}/data/terrains/${terrain}/${filename}`;
        }

        return FALLBACK_BANNER;
    }

    /**
     * Resolve an image path relative to the active base (art pack or module).
     */
    static resolve(relativePath) {
        return `${this.#basePath}/${relativePath}`;
    }

    /** Universal fallback banner path. */
    static get fallbackBanner() {
        return FALLBACK_BANNER;
    }

    /** Whether the art pack is currently active. */
    static get hasArtPack() {
        return this.#artPackActive;
    }
}
