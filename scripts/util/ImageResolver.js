/**
 * ImageResolver
 *
 * Centralizes image path resolution for Respite. Probes the filesystem
 * for an art source in priority order:
 *
 *   1. Overlay install (Patreon Library / cloud distribution) at
 *      `ionrift-data/overlays/ionrift-respite/<sublayer>/`. Sublayer is
 *      `core/` post-rename or `free/` for legacy / sticky-back-compat
 *      installs.
 *   2. Zip-imported art pack at `ionrift-data/respite/art/` (legacy).
 *   3. Raw drop folder `ionrift-respite-art/` (legacy).
 *
 * The terrain and token directory shapes differ between sources. The
 * overlay layout is `art/terrains/` and `art/tokens/`; the legacy
 * layout is `data/terrains/` and `assets/tokens/`. Rather than
 * hard-coding either, the init walk records the absolute path where
 * it finds each and the resolvers build URLs from those captured roots.
 *
 * When per-terrain art ships in the base module, add the filenames to
 * KNOWN_BASE_IMAGES so they resolve without probing.
 */

/* global ForgeVTT, FilePicker */

const MODULE_ID = "ionrift-respite";
const FALLBACK_BANNER = `modules/${MODULE_ID}/assets/placeholder-banner.webp`;

/** Overlay install root managed by ionrift-library OverlayService. */
const OVERLAY_DATA_ROOT = "ionrift-data/overlays";

/**
 * Sublayer probe order under the overlay root. `core/` is the
 * post-rename default; `free/` is the legacy / sticky-back-compat
 * sublayer that existing GM installs continue to upgrade in place.
 */
const OVERLAY_SUBLAYERS = ["core", "free"];

/** Named overlays that add terrain art outside the core/free install root. */
const OVERLAY_TERRAIN_SUPPLEMENTS = ["frost-stone", "bone-dust"];

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
    // No bundled art yet. All terrain art ships via the Ionrift art pack.
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

    /**
     * Absolute path of the discovered `terrains/` directory. The overlay
     * layout puts it at `<base>/art/terrains/` and the legacy zip
     * layout at `<base>/data/terrains/`. Captured during the walk so
     * resolvers don't need to know which.
     */
    static #terrainsRoot = null;

    /**
     * Absolute path of the discovered `tokens/` directory. Overlay
     * layout: `<base>/art/tokens/`. Legacy layout: `<base>/assets/tokens/`.
     */
    static #tokensRoot = null;

    /** Terrain directory names found in the art pack. */
    static #artTerrains = [];

    /**
     * Per-terrain absolute `terrains/` roots when art is split across
     * overlays (e.g. mountain/arctic in `frost-stone/`, rest in `core/`).
     */
    static #terrainRootsByTag = new Map();

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
        this.#terrainsRoot = null;
        this.#tokensRoot = null;
        this.#terrainRootsByTag = new Map();
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
                // Newer caches store the absolute discovered roots. Older
                // caches predate overlay support, so derive legacy defaults
                // when the fields are missing.
                this.#terrainsRoot = cache.terrainsRoot ?? `${cache.path}/data/terrains`;
                this.#tokensRoot = cache.tokensRoot
                    ?? (this.#stationTokenBasePath ? `${this.#stationTokenBasePath}/assets/tokens` : null);
                this.#terrainRootsByTag = new Map(
                    Object.entries(cache.terrainRootsByTag ?? {})
                );
            }
            console.log(`${MODULE_ID} | ImageResolver (player): artPack=${this.#artPackActive}${this.#artPackActive ? ` (${this.#importedArtPath}, ${this.#artTerrains.length} terrains, tokens=${this.#hasStationTokens})` : ""}`);
            return;
        }

        // GM: probe the filesystem in priority order.
        // 1. Overlay installs (cloud-distributed via Patreon Library).
        //    `core/` is the post-rename default; `free/` covers existing
        //    sticky-back-compat installs from before the May 2026 rename.
        // 2. Legacy zip-imported pack at ionrift-data/respite/art/.
        // 3. Legacy raw drop folder ionrift-respite-art/.
        const overlayCandidates = OVERLAY_SUBLAYERS.map(
            (sublayer) => `${OVERLAY_DATA_ROOT}/${MODULE_ID}/${sublayer}`
        );
        const importedPath = game.ionrift?.library?.getZipTargetDir?.("respite", "art");
        const candidatePaths = [
            ...overlayCandidates,
            importedPath,
            RAW_ART_FOLDER
        ].filter(Boolean);

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
                    let terrainsRoot = null;
                    let tokensRoot = null;

                    const walk = async (currentPath, depth = 0) => {
                        try {
                            const result = await FP.browse(source, currentPath);
                            fileCount += result.files?.length ?? 0;
                            const dirName = currentPath.split("/").pop();

                            // Capture the absolute path of the terrains/ and
                            // tokens/ directories so the resolvers can build
                            // URLs without assuming a particular layout shape.
                            if (dirName === "terrains" && !terrainsRoot) {
                                terrainsRoot = currentPath;
                            }
                            if (dirName === "tokens" && !tokensRoot) {
                                tokensRoot = currentPath;
                                for (const f of (result.files ?? [])) {
                                    const basename = f.split("/").pop();
                                    if (basename) tokenFiles.push(basename);
                                }
                            }

                            for (const subDir of (result.dirs ?? [])) {
                                const childDirName = subDir.split("/").pop();
                                if (dirName === "terrains" && childDirName) {
                                    terrains.push(childDirName);
                                }
                                await walk(subDir, depth + 1);
                            }
                        } catch { /* skip inaccessible dirs */ }
                    };
                    await walk(candidatePath);
                    this.#artFileCount = fileCount;
                    this.#artTerrains = terrains.sort();
                    this.#terrainsRoot = terrainsRoot;
                    if (terrainsRoot) {
                        for (const tag of terrains) {
                            this.#terrainRootsByTag.set(tag, terrainsRoot);
                        }
                    }
                    if (tokenFiles.length > 0) {
                        this.#hasStationTokens = true;
                        this.#stationTokenFiles = new Set(tokenFiles);
                        this.#stationTokenBasePath = candidatePath;
                        this.#tokensRoot = tokensRoot;
                    }
                }
            } catch {
                // Directory doesn't exist, try next candidate
            }
        }

        // Supplement probe: named overlays (Frost & Stone) may ship terrain
        // art outside core/. Merge mountain/arctic (and any future split
        // terrains) into the resolver without requiring a second full install
        // root for tokens.
        const source = _fileSource();
        for (const sublayer of OVERLAY_TERRAIN_SUPPLEMENTS) {
            const supplementRoot = `${OVERLAY_DATA_ROOT}/${MODULE_ID}/${sublayer}`;
            const terrainDirCandidates = [
                `${supplementRoot}/art/terrains`,
                `${supplementRoot}/data/terrains`
            ];
            for (const terrainDir of terrainDirCandidates) {
                try {
                    const result = await FP.browse(source, terrainDir);
                    const tags = (result.dirs ?? [])
                        .map((d) => d.split("/").pop())
                        .filter(Boolean);
                    if (tags.length === 0) continue;
                    if (!this.#artPackActive) {
                        this.#artPackActive = true;
                        this.#importedArtPath = supplementRoot;
                        this.#basePath = supplementRoot;
                    }
                    for (const tag of tags) {
                        if (!this.#artTerrains.includes(tag)) {
                            this.#artTerrains.push(tag);
                        }
                        this.#terrainRootsByTag.set(tag, terrainDir);
                    }
                    this.#artTerrains.sort();
                    if (!this.#terrainsRoot) {
                        this.#terrainsRoot = terrainDir;
                    }
                    break;
                } catch { /* try next layout */ }
            }
        }

        // Secondary probe: if the primary art source has no tokens, check
        // remaining candidate paths specifically for a tokens/ dir. This
        // handles split installs where terrains and tokens live under
        // different roots (e.g. terrains via overlay, tokens via legacy zip).
        if (this.#artPackActive && !this.#hasStationTokens) {
            const source = _fileSource();
            const remaining = candidatePaths.filter(p => p !== this.#importedArtPath);
            for (const probePath of remaining) {
                // Try overlay shape first, then legacy shape.
                const tokenDirCandidates = [
                    `${probePath}/art/tokens`,
                    `${probePath}/assets/tokens`
                ];
                let found = false;
                for (const tokenDir of tokenDirCandidates) {
                    try {
                        const result = await FP.browse(source, tokenDir);
                        const files = (result.files ?? []).map(f => f.split("/").pop()).filter(Boolean);
                        if (files.length > 0) {
                            this.#hasStationTokens = true;
                            this.#stationTokenFiles = new Set(files);
                            this.#stationTokenBasePath = probePath;
                            this.#tokensRoot = tokenDir;
                            console.log(`${MODULE_ID} | ImageResolver: found station tokens in secondary path: ${tokenDir}`);
                            found = true;
                            break;
                        }
                    } catch { /* try next shape */ }
                }
                if (found) break;
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
                stationTokenBasePath: this.#stationTokenBasePath,
                terrainsRoot: this.#terrainsRoot,
                tokensRoot: this.#tokensRoot,
                terrainRootsByTag: Object.fromEntries(this.#terrainRootsByTag)
            });
        } catch (e) {
            console.warn(`${MODULE_ID} | ImageResolver: failed to persist art pack cache:`, e);
        }

        console.log(`${MODULE_ID} | ImageResolver: artPack=${this.#artPackActive}${this.#artPackActive ? ` (${this.#importedArtPath}, terrains via ${this.#terrainsRoot ?? "(none)"}, tokens=${this.#hasStationTokens}${this.#tokensRoot ? ` via ${this.#tokensRoot}` : ""})` : ""}`);
        if (this.#hasStationTokens) {
            console.log(`${MODULE_ID} | ImageResolver: station tokens: [${[...this.#stationTokenFiles].join(", ")}]`);
        }
    }

    /**
     * Resolve a terrain banner path.
     *
     * Art source active: returns the discovered terrains-root path for
     * the requested terrain. Works for both overlay (`art/terrains/`)
     * and legacy zip (`data/terrains/`) layouts because the root was
     * captured during the init walk.
     *
     * Art source absent: returns a known base-module image if one
     * exists for that terrain, otherwise the universal fallback.
     */
    static terrainBanner(terrain, filename) {
        const terrainRoot = this.#terrainRootsByTag.get(terrain) ?? this.#terrainsRoot;
        if (this.#artPackActive && terrainRoot && this.#artTerrains.includes(terrain)) {
            return `${terrainRoot}/${terrain}/${filename}`;
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

        // Art source present and this token exists in it. Use the
        // discovered tokens root so we resolve correctly regardless of
        // whether art lives under an overlay (`art/tokens/`) or a
        // legacy zip-imported pack (`assets/tokens/`).
        if (this.#hasStationTokens && this.#stationTokenFiles.has(filename) && this.#tokensRoot) {
            return `${this.#tokensRoot}/${filename}`;
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
