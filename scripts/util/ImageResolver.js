/**
 * ImageResolver
 *
 * Centralizes image path resolution for Respite with a two-tier model:
 *
 *   - Art pack imported (via Zip Importer): resolve from ionrift-data/respite/art/
 *   - Art pack absent: return the universal fallback banner directly
 *
 * When hand-drawn per-terrain art ships in the base module, add the
 * filenames to KNOWN_BASE_IMAGES so they resolve without probing.
 */

const MODULE_ID = "ionrift-respite";
const FALLBACK_BANNER = `modules/${MODULE_ID}/assets/placeholder-banner.webp`;

// Foundry v13 namespaced FilePicker; fall back to global for v12
const FP = foundry.applications?.apps?.FilePicker ?? FilePicker;

// Hand-drawn images known to exist in the base module's terrain folders.
// Add entries here as the partner delivers replacement art.
// Format: "terrain/filename" e.g. "forest/banner.png"
const KNOWN_BASE_IMAGES = new Set([
    // "forest/banner.png",
]);

export class ImageResolver {

    /** Resolved base path for image assets. */
    static #basePath = `modules/${MODULE_ID}`;

    /** Whether an imported art pack was detected. */
    static #artPackActive = false;

    /** The ionrift-data path for imported art. */
    static #importedArtPath = null;

    /**
     * Call once during the ready hook.
     * Detects whether an art pack has been imported via the Zip Importer.
     */
    static async init() {
        // Check the shared ionrift-data directory for imported art
        const importedPath = game.ionrift?.library?.getZipTargetDir?.("respite", "art");
        if (importedPath) {
            try {
                const browse = await FP.browse("data", importedPath);
                // Consider art pack active if at least one file or subdirectory exists
                if (browse.dirs?.length > 0 || browse.files?.length > 0) {
                    this.#artPackActive = true;
                    this.#importedArtPath = importedPath;
                    this.#basePath = importedPath;
                }
            } catch {
                // Directory doesn't exist yet, no art imported
            }
        }

        console.log(`${MODULE_ID} | ImageResolver: artPack=${this.#artPackActive}${this.#artPackActive ? ` (${this.#importedArtPath})` : ""}`);
    }

    /**
     * Resolve a terrain banner path.
     *
     * Art pack active: returns the imported art terrain-specific path.
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
     * Resolve an image path relative to the active base (imported art or module).
     */
    static resolve(relativePath) {
        return `${this.#basePath}/${relativePath}`;
    }

    /** Universal fallback banner path. */
    static get fallbackBanner() {
        return FALLBACK_BANNER;
    }

    /** Whether an art pack is currently active. */
    static get hasArtPack() {
        return this.#artPackActive;
    }

    /** The resolved art pack path, or null if none imported. */
    static get artPackPath() {
        return this.#importedArtPath;
    }
}
