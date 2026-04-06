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

    /** Number of art files detected. */
    static #artFileCount = 0;

    /** Terrain directory names found in the art pack. */
    static #artTerrains = [];

    /**
     * Call once during the ready hook.
     * Detects whether an art pack has been imported via the Zip Importer.
     */
    static async init() {
        // Reset state for re-init (uninstall/re-import cycles)
        this.#artPackActive = false;
        this.#importedArtPath = null;
        this.#artFileCount = 0;
        this.#artTerrains = [];
        this.#basePath = `modules/${MODULE_ID}`;

        // Check for GM disable flag
        const disabled = game.settings.get(MODULE_ID, "artPackDisabled") ?? false;
        if (disabled) {
            console.log(`${MODULE_ID} | ImageResolver: artPack=disabled (GM override)`);
            return;
        }

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

                    // Count files and detect terrain dirs
                    let fileCount = browse.files?.length ?? 0;
                    const terrains = [];
                    for (const dir of (browse.dirs ?? [])) {
                        try {
                            const sub = await FP.browse("data", dir);
                            // Check for terrain subdirs (e.g. data/terrains/forest/)
                            for (const terrainDir of (sub.dirs ?? [])) {
                                const name = terrainDir.split("/").pop();
                                if (name) terrains.push(name);
                                try {
                                    const terrainBrowse = await FP.browse("data", terrainDir);
                                    fileCount += terrainBrowse.files?.length ?? 0;
                                } catch { /* skip */ }
                            }
                            fileCount += sub.files?.length ?? 0;
                        } catch { /* skip */ }
                    }
                    this.#artFileCount = fileCount;
                    this.#artTerrains = terrains.sort();
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

    /** Number of art files detected in the imported pack. */
    static get artFileCount() {
        return this.#artFileCount;
    }

    /** Terrain names found in the imported art pack. */
    static get artTerrains() {
        return this.#artTerrains;
    }
}
