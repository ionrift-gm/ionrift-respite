/**
 * ImageResolver
 *
 * Centralizes image path resolution for Respite with a two-tier model:
 *
 *   - Art pack imported (via Zip Importer): resolve from ionrift-data/respite/art/
 *   - Art pack raw folder: resolve from ionrift-respite-art/
 *   - Art pack absent: return the universal fallback (banner or core SVG)
 *
 * Handles both terrain banners and camp station tokens.
 *
 * When per-terrain art ships in the base module, add the
 * filenames to KNOWN_BASE_IMAGES so they resolve without probing.
 */

const MODULE_ID = "ionrift-respite";
const FALLBACK_BANNER = `modules/${MODULE_ID}/assets/placeholder-banner.webp`;

/** Raw art pack folder (Ionrift art zip dropped directly into Data). */
const RAW_ART_FOLDER = "ionrift-respite-art";

/**
 * Station token filename map.
 * Keys match CompoundCampPlacer FURNITURE / PLAYER_GEAR keys.
 * Values are the webp filename inside assets/tokens/.
 */
const STATION_TOKEN_FILES = {
    table:       "workbench.webp",
    weaponRack:  "weapon_rack.webp",
    medicalBed:  "medical_bed.webp",
    cookingArea: "cooking_utensils.webp",
    cookingBasic:"cooking_basic.webp",
    bedroll:     "bedroll.webp",
    tent:        "tent.webp",
    messkit:     "messkit.webp",
    campfire:    "campfire_pit.webp",
    buildSite:   "build_site.webp"
};

/** Foundry core SVG fallbacks (used when art pack is absent). */
const STATION_CORE_FALLBACKS = {
    table:       "icons/svg/chest.svg",
    weaponRack:  "icons/svg/sword.svg",
    medicalBed:  "icons/svg/heal.svg",
    cookingArea: "icons/svg/fire.svg",
    cookingBasic:"icons/svg/fire.svg",
    bedroll:     "icons/svg/sleep.svg",
    tent:        "icons/svg/house.svg",
    messkit:     "icons/svg/tankard.svg",
    campfire:    "icons/svg/fire.svg",
    buildSite:   "icons/svg/circle.svg"
};

// Forge VTT monkey-patches the global FilePicker but NOT the v13
// namespaced version. Use the global on Forge so browse("forgevtt")
// resolves correctly; use namespaced on self-hosted to avoid deprecation.
const FP = (typeof ForgeVTT !== "undefined" && ForgeVTT.usingTheForge)
    ? FilePicker
    : (foundry.applications?.apps?.FilePicker ?? FilePicker);

/**
 * Returns the platform-correct FilePicker class and source string
 * via the kernel API. Falls back gracefully if the library hasn't
 * initialized yet (e.g. during early hooks).
 */
export function _fileSource() {
    return (typeof ForgeVTT !== "undefined" && ForgeVTT.usingTheForge)
        ? "forgevtt" : "data";
}

// Images known to exist in the base module's assets/terrains/ folders.
// Add entries here as bundled art is committed to the module.
// Format: "terrain/filename" e.g. "forest/banner.png"
const KNOWN_BASE_IMAGES = new Set([
    // No bundled art yet — all terrain art ships via the Ionrift art pack.
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

    /** Whether station tokens were found in the art pack. */
    static #hasStationTokens = false;

    /** Set of discovered station token filenames (basenames). */
    static #stationTokenFiles = new Set();

    /** Base path for station token resolution (may differ from #basePath if tokens live in a different location). */
    static #stationTokenBasePath = null;

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
        this.#hasStationTokens = false;
        this.#stationTokenFiles = new Set();
        this.#stationTokenBasePath = null;
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
                this.#hasStationTokens = cache.hasStationTokens ?? false;
                this.#stationTokenFiles = new Set(cache.stationTokenFiles ?? []);
                this.#stationTokenBasePath = cache.stationTokenBasePath ?? cache.path;
            }
            console.log(`${MODULE_ID} | ImageResolver (player): artPack=${this.#artPackActive}${this.#artPackActive ? ` (${this.#importedArtPath}, ${this.#artTerrains.length} terrains, tokens=${this.#hasStationTokens})` : ""}`);
            return;
        }

        // GM: probe the filesystem — check zip-imported path first, then raw folder
        const importedPath = game.ionrift?.library?.getZipTargetDir?.("respite", "art");
        const candidatePaths = [importedPath, RAW_ART_FOLDER].filter(Boolean);

        for (const candidatePath of candidatePaths) {
            if (this.#artPackActive) break;
            try {
                const source = _fileSource();
                const browse = await FP.browse(source, candidatePath);
                if (browse.dirs?.length > 0 || browse.files?.length > 0) {
                    this.#artPackActive = true;
                    this.#importedArtPath = candidatePath;
                    this.#basePath = candidatePath;

                    let fileCount = 0;
                    const terrains = [];
                    const tokenFiles = [];

                    const walk = async (path, depth = 0) => {
                        try {
                            const result = await FP.browse(source, path);
                            fileCount += result.files?.length ?? 0;
                            const dirName = path.split("/").pop();
                            for (const subDir of (result.dirs ?? [])) {
                                const childDirName = subDir.split("/").pop();
                                const parentName = path.split("/").pop();
                                if (parentName === "terrains" && childDirName) {
                                    terrains.push(childDirName);
                                }
                                await walk(subDir, depth + 1);
                            }
                            // Detect token files in assets/tokens/
                            if (dirName === "tokens") {
                                for (const f of (result.files ?? [])) {
                                    const basename = f.split("/").pop();
                                    if (basename) tokenFiles.push(basename);
                                }
                            }
                        } catch { /* skip inaccessible dirs */ }
                    };
                    await walk(candidatePath);
                    this.#artFileCount = fileCount;
                    this.#artTerrains = terrains.sort();
                    if (tokenFiles.length > 0) {
                        this.#hasStationTokens = true;
                        this.#stationTokenFiles = new Set(tokenFiles);
                        this.#stationTokenBasePath = candidatePath;
                    }
                }
            } catch {
                // Directory doesn't exist, try next candidate
            }
        }

        // Secondary probe: if the primary art pack has no tokens, check
        // remaining candidate paths specifically for an assets/tokens/ dir.
        // This handles the case where terrains are zip-imported but station
        // tokens live in the raw Ionrift art folder.
        if (this.#artPackActive && !this.#hasStationTokens) {
            const source = _fileSource();
            const remaining = candidatePaths.filter(p => p !== this.#importedArtPath);
            for (const probePath of remaining) {
                try {
                    const tokenDir = `${probePath}/assets/tokens`;
                    const result = await FP.browse(source, tokenDir);
                    const files = (result.files ?? []).map(f => f.split("/").pop()).filter(Boolean);
                    if (files.length > 0) {
                        this.#hasStationTokens = true;
                        this.#stationTokenFiles = new Set(files);
                        this.#stationTokenBasePath = probePath;
                        console.log(`${MODULE_ID} | ImageResolver: found station tokens in secondary path: ${probePath}`);
                        break;
                    }
                } catch { /* skip */ }
            }
        }

        // Persist detection to world setting so players can read it
        try {
            await game.settings.set(MODULE_ID, "artPackCache", {
                active: this.#artPackActive,
                path: this.#importedArtPath,
                terrains: this.#artTerrains,
                hasStationTokens: this.#hasStationTokens,
                stationTokenFiles: [...this.#stationTokenFiles],
                stationTokenBasePath: this.#stationTokenBasePath
            });
        } catch (e) {
            console.warn(`${MODULE_ID} | ImageResolver: failed to persist art pack cache:`, e);
        }

        console.log(`${MODULE_ID} | ImageResolver: artPack=${this.#artPackActive}${this.#artPackActive ? ` (${this.#importedArtPath}, tokens=${this.#hasStationTokens}${this.#stationTokenBasePath && this.#stationTokenBasePath !== this.#importedArtPath ? ` via ${this.#stationTokenBasePath}` : ""})` : ""}`);
        if (this.#hasStationTokens) {
            console.log(`${MODULE_ID} | ImageResolver: station tokens: [${[...this.#stationTokenFiles].join(", ")}]`);
        }
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
     * Resolve a camp station token path.
     *
     * Art pack active + token file exists: returns the premium token path.
     * Otherwise: returns the Foundry core SVG fallback.
     *
     * For the cooking station, pass `hasCookingUtensils` to select the
     * correct variant (full utensils vs basic cooking area).
     *
     * @param {string} stationKey - FURNITURE/PLAYER_GEAR key (e.g. "table", "weaponRack")
     * @param {{ hasCookingUtensils?: boolean }} [options]
     * @returns {string} Resolved image path
     */
    static resolveStationToken(stationKey, options = {}) {
        // Resolve the cooking variant key
        let resolvedKey = stationKey;
        if (stationKey === "cookingArea") {
            resolvedKey = options.hasCookingUtensils ? "cookingArea" : "cookingBasic";
        }

        const filename = STATION_TOKEN_FILES[resolvedKey];
        if (!filename) {
            return STATION_CORE_FALLBACKS[resolvedKey] ?? STATION_CORE_FALLBACKS[stationKey] ?? "icons/svg/circle.svg";
        }

        // Art pack present and this token exists in the pack
        if (this.#hasStationTokens && this.#stationTokenFiles.has(filename)) {
            const tokenBase = this.#stationTokenBasePath ?? this.#basePath;
            return `${tokenBase}/assets/tokens/${filename}`;
        }

        return STATION_CORE_FALLBACKS[resolvedKey] ?? STATION_CORE_FALLBACKS[stationKey] ?? "icons/svg/circle.svg";
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

    /** Whether station tokens were found in the art pack. */
    static get hasStationTokens() {
        return this.#hasStationTokens;
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
