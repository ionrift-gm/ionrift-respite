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

// Forge VTT monkey-patches the global FilePicker but NOT the v13
// namespaced version. Use the global on Forge so browse("forgevtt")
// resolves correctly; use namespaced on self-hosted to avoid deprecation.
const FP = (typeof ForgeVTT !== "undefined" && ForgeVTT.usingTheForge)
    ? FilePicker
    : (foundry.applications?.apps?.FilePicker ?? FilePicker);

/**
 * Returns the correct FilePicker source for the hosting platform.
 * Forge VTT uses "forgevtt" (S3-backed Assets Library);
 * self-hosted Foundry uses "data".
 */
export function _fileSource() {
    return (typeof ForgeVTT !== "undefined" && ForgeVTT.usingTheForge)
        ? "forgevtt" : "data";
}

// Hand-drawn images known to exist in the base module's assets/terrains/ folders.
// Add entries here as bundled art is committed to the module.
// Format: "terrain/filename" e.g. "forest/banner.png"
const KNOWN_BASE_IMAGES = new Set([
    // No bundled art yet — all terrain art ships via the Patreon art pack.
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
     * GM: probes the filesystem and caches results in a world setting.
     * Player: reads the cached setting (FilePicker.browse is GM-only).
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

        if (!game.user.isGM) {
            // Non-GM: read the cached detection result written by the GM
            const cache = game.settings.get(MODULE_ID, "artPackCache") ?? {};
            if (cache.active && cache.path) {
                this.#artPackActive = true;
                this.#importedArtPath = cache.path;
                this.#basePath = cache.path;
                this.#artTerrains = cache.terrains ?? [];
            }
            console.log(`${MODULE_ID} | ImageResolver (player): artPack=${this.#artPackActive}${this.#artPackActive ? ` (${this.#importedArtPath}, ${this.#artTerrains.length} terrains)` : ""}`);
            return;
        }

        // GM: probe the filesystem
        const importedPath = game.ionrift?.library?.getZipTargetDir?.("respite", "art");
        if (importedPath) {
            try {
                const source = _fileSource();
                const browse = await FP.browse(source, importedPath);
                if (browse.dirs?.length > 0 || browse.files?.length > 0) {
                    this.#artPackActive = true;
                    this.#importedArtPath = importedPath;
                    this.#basePath = importedPath;

                    let fileCount = 0;
                    const terrains = [];

                    const walk = async (path, depth = 0) => {
                        try {
                            const result = await FP.browse(source, path);
                            fileCount += result.files?.length ?? 0;
                            for (const subDir of (result.dirs ?? [])) {
                                const dirName = subDir.split("/").pop();
                                const parentName = path.split("/").pop();
                                if (parentName === "terrains" && dirName) {
                                    terrains.push(dirName);
                                }
                                await walk(subDir, depth + 1);
                            }
                        } catch { /* skip inaccessible dirs */ }
                    };
                    await walk(importedPath);
                    this.#artFileCount = fileCount;
                    this.#artTerrains = terrains.sort();
                }
            } catch {
                // Directory doesn't exist yet, no art imported
            }
        }

        // Persist detection to world setting so players can read it
        try {
            await game.settings.set(MODULE_ID, "artPackCache", {
                active: this.#artPackActive,
                path: this.#importedArtPath,
                terrains: this.#artTerrains
            });
        } catch (e) {
            console.warn(`${MODULE_ID} | ImageResolver: failed to persist art pack cache:`, e);
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
        // Art pack active AND this terrain is covered by the pack
        if (this.#artPackActive && this.#artTerrains.includes(terrain)) {
            return `${this.#basePath}/data/terrains/${terrain}/${filename}`;
        }
        const key = `${terrain}/${filename}`;
        if (KNOWN_BASE_IMAGES.has(key)) {
            return `modules/${MODULE_ID}/assets/terrains/${terrain}/${filename}`;
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
