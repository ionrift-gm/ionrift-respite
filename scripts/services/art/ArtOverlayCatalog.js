import { MODULE_ID } from "../../data/moduleId.js";
import { Logger } from "../../utils/Logger.js";

/* global ForgeVTT, FilePicker */

/**
 * ArtOverlayCatalog
 *
 * Discovers optional art installed under `ionrift-data/overlays/ionrift-respite/`
 * and merges it into one lookup. Respite does not know which packs exist.
 * Each installed sublayer either describes itself with `art-manifest.json`
 * or is probed by folder convention.
 *
 * art-manifest.json (schema 1):
 * {
 *   "schema": 1,
 *   "priority": 0,
 *   "terrainBanners": "art/terrains",
 *   "stationTokens": "art/tokens",
 *   "itemIcons": { "recipe:<id>": "art/icons/...webp", "name:<Item Name>": "..." }
 * }
 *
 * Paths inside the manifest are relative to the sublayer root.
 * Item icon keys: `recipe:<recipeId>`, `item:<itemRef>`, `name:<item name>`.
 *
 * GM: probes the filesystem and persists the merged result to the
 * `artPackCache` world setting. Players read the cache (FilePicker.browse
 * is GM-only).
 */

const OVERLAY_DATA_ROOT = "ionrift-data/overlays";
const ART_MANIFEST_FILE = "art-manifest.json";
const ART_MANIFEST_SCHEMA = 1;
const CACHE_SCHEMA = 2;

/** Folder-convention probes for sublayers without an art manifest. */
const CONVENTION_TERRAIN_DIRS = ["art/terrains", "data/terrains"];
const CONVENTION_TOKEN_DIRS = ["art/tokens", "assets/tokens"];

/** Convention sources rank below manifest-declared sources. */
const CONVENTION_PRIORITY = -1;
/** Loose user folders rank last. */
const LOOSE_FOLDER_PRIORITY = -2;

const IMAGE_FILE = /\.(png|webp|jpe?g|avif)$/i;

/** User art folder dropped directly into Data (legacy raw zip layout). */
const LOOSE_ART_FOLDER = "ionrift-respite-art";

const FP = (typeof ForgeVTT !== "undefined" && ForgeVTT.usingTheForge)
    ? FilePicker
    : (foundry.applications?.apps?.FilePicker ?? FilePicker);

function fileSource() {
    return (typeof ForgeVTT !== "undefined" && ForgeVTT.usingTheForge)
        ? "forgevtt" : "data";
}

async function browse(path) {
    try {
        const result = await FP.browse(fileSource(), path);
        return {
            dirs: (result.dirs ?? []).map(d => d.split("/").pop()).filter(Boolean),
            files: (result.files ?? []).map(f => f.split("/").pop()).filter(Boolean)
        };
    } catch {
        return null;
    }
}

async function readJson(path) {
    const platform = game.ionrift?.library?.platform;
    if (typeof platform?.readDataJson === "function") {
        try {
            return await platform.readDataJson(path);
        } catch {
            return null;
        }
    }
    try {
        const response = await fetch(path, { cache: "no-store" });
        if (!response.ok) return null;
        return await response.json();
    } catch {
        return null;
    }
}

function joinPath(root, relative) {
    const rel = String(relative ?? "").replace(/^\/+|\/+$/g, "");
    return rel ? `${root}/${rel}` : root;
}

/** @returns {ArtCatalog} */
function emptyCatalog() {
    return {
        schema: CACHE_SCHEMA,
        active: false,
        sources: [],
        terrainRootsByTag: {},
        tokenPaths: {},
        itemIcons: {}
    };
}

/**
 * @typedef {object} ArtSource
 * @property {string} id         Sublayer or folder name (for logs and ordering)
 * @property {string} root       Data-relative root path
 * @property {number} priority
 * @property {Record<string,string>} terrainRootsByTag
 * @property {Record<string,string>} tokenPaths  filename → full path
 * @property {Record<string,string>} itemIcons   identity key → full path
 */

/**
 * @typedef {object} ArtCatalog
 * @property {number} schema
 * @property {boolean} active
 * @property {string[]} sources
 * @property {Record<string,string>} terrainRootsByTag
 * @property {Record<string,string>} tokenPaths
 * @property {Record<string,string>} itemIcons
 */

/** @type {ArtCatalog} */
let current = emptyCatalog();
let loaded = false;
/** @type {Promise<ArtCatalog>|null} */
let inflight = null;

export class ArtOverlayCatalog {

    /** @returns {ArtCatalog} */
    static get current() {
        return current;
    }

    static get loaded() {
        return loaded;
    }

    /** Load once if nothing has populated the catalog yet. */
    static async ensureLoaded() {
        if (loaded) return current;
        return this.refresh();
    }

    /**
     * Re-scan (GM) or re-read the cache (player). Concurrent callers share
     * one in-flight scan.
     * @returns {Promise<ArtCatalog>}
     */
    static async refresh() {
        if (inflight) return inflight;
        inflight = (async () => {
            try {
                current = game.user?.isGM
                    ? await this.#scanAndPersist()
                    : this.fromCache(game.settings.get(MODULE_ID, "artPackCache"));
            } catch (err) {
                console.warn(`${MODULE_ID} | ArtOverlayCatalog: refresh failed:`, err);
                current = emptyCatalog();
            }
            loaded = true;
            return current;
        })();
        try {
            return await inflight;
        } finally {
            inflight = null;
        }
    }

    /**
     * Normalise a persisted cache. Older caches (pre-catalog) stored a
     * single tokens root plus a filename list.
     * @param {object} cache
     * @returns {ArtCatalog}
     */
    static fromCache(cache) {
        if (!cache || !cache.active) return emptyCatalog();
        if (cache.schema === CACHE_SCHEMA) {
            return {
                ...emptyCatalog(),
                active: true,
                sources: cache.sources ?? [],
                terrainRootsByTag: cache.terrainRootsByTag ?? {},
                tokenPaths: cache.tokenPaths ?? {},
                itemIcons: cache.itemIcons ?? {}
            };
        }
        const tokenPaths = {};
        if (cache.tokensRoot) {
            for (const file of cache.stationTokenFiles ?? []) {
                tokenPaths[file] = `${cache.tokensRoot}/${file}`;
            }
        }
        const terrainRootsByTag = { ...(cache.terrainRootsByTag ?? {}) };
        const legacyRoot = cache.terrainsRoot ?? (cache.path ? `${cache.path}/data/terrains` : null);
        if (legacyRoot) {
            for (const tag of cache.terrains ?? []) {
                terrainRootsByTag[tag] ??= legacyRoot;
            }
        }
        return {
            ...emptyCatalog(),
            active: true,
            sources: cache.path ? [cache.path] : [],
            terrainRootsByTag,
            tokenPaths
        };
    }

    /**
     * Merge sources. Higher priority wins per key; ties break on id.
     * @param {ArtSource[]} sources
     * @returns {ArtCatalog}
     */
    static merge(sources) {
        const ordered = [...sources].sort((a, b) =>
            (b.priority - a.priority) || a.id.localeCompare(b.id)
        );
        const catalog = emptyCatalog();
        for (const source of ordered) {
            let contributed = false;
            for (const [tag, root] of Object.entries(source.terrainRootsByTag)) {
                if (catalog.terrainRootsByTag[tag]) continue;
                catalog.terrainRootsByTag[tag] = root;
                contributed = true;
            }
            for (const [file, path] of Object.entries(source.tokenPaths)) {
                if (catalog.tokenPaths[file]) continue;
                catalog.tokenPaths[file] = path;
                contributed = true;
            }
            for (const [key, path] of Object.entries(source.itemIcons)) {
                if (catalog.itemIcons[key]) continue;
                catalog.itemIcons[key] = path;
                contributed = true;
            }
            if (contributed) catalog.sources.push(source.id);
        }
        catalog.active = catalog.sources.length > 0;
        return catalog;
    }

    static async #scanAndPersist() {
        const sources = [
            ...await this.#scanOverlaySublayers(),
            ...await this.#scanLooseFolders()
        ];
        const catalog = this.merge(sources);

        try {
            await game.settings.set(MODULE_ID, "artPackCache", catalog);
        } catch (e) {
            console.warn(`${MODULE_ID} | ArtOverlayCatalog: failed to persist cache:`, e);
        }

        Logger.log(
            `${MODULE_ID} | ArtOverlayCatalog: ${catalog.active ? `sources=[${catalog.sources.join(", ")}]` : "no art installed"}`
            + ` terrains=${Object.keys(catalog.terrainRootsByTag).length}`
            + ` tokens=${Object.keys(catalog.tokenPaths).length}`
            + ` icons=${Object.keys(catalog.itemIcons).length}`
        );
        return catalog;
    }

    /** @returns {Promise<ArtSource[]>} */
    static async #scanOverlaySublayers() {
        const overlay = game.ionrift?.library?.overlay;
        const moduleRoot = `${OVERLAY_DATA_ROOT}/${MODULE_ID}`;

        let sublayers = [];
        if (overlay?.listInstalledSublayers) {
            sublayers = await overlay.listInstalledSublayers(MODULE_ID);
        } else {
            sublayers = (await browse(moduleRoot))?.dirs ?? [];
        }

        const results = await Promise.all(sublayers.map(async (sublayer) => {
            if (!await this.#isSublayerActive(overlay, sublayer)) return null;
            const root = `${moduleRoot}/${sublayer}`;
            const listing = await browse(root);
            if (!listing) return null;

            if (listing.files.includes(ART_MANIFEST_FILE)) {
                const manifest = await readJson(`${root}/${ART_MANIFEST_FILE}`);
                if (manifest && (manifest.schema ?? 1) <= ART_MANIFEST_SCHEMA) {
                    return this.#sourceFromManifest(sublayer, root, manifest);
                }
            }
            return this.#sourceFromConvention(sublayer, root, CONVENTION_PRIORITY);
        }));
        return results.filter(Boolean);
    }

    static async #isSublayerActive(overlay, sublayer) {
        if (!overlay?.getLocalManifest || !overlay?.isOverlayActive) return true;
        try {
            const manifest = await overlay.getLocalManifest(MODULE_ID, sublayer);
            if (!manifest?.overlayId) return true;
            return await overlay.isOverlayActive(manifest.overlayId, MODULE_ID, sublayer);
        } catch {
            return true;
        }
    }

    /** @returns {Promise<ArtSource[]>} */
    static async #scanLooseFolders() {
        const roots = [
            game.ionrift?.library?.getZipTargetDir?.("respite", "art"),
            LOOSE_ART_FOLDER
        ].filter(Boolean);
        const sources = await Promise.all(
            roots.map(root => this.#sourceFromConvention(root, root, LOOSE_FOLDER_PRIORITY))
        );
        return sources.filter(Boolean);
    }

    /** @returns {Promise<ArtSource>} */
    static async #sourceFromManifest(id, root, manifest) {
        const source = {
            id,
            root,
            priority: Number.isFinite(manifest.priority) ? manifest.priority : 0,
            terrainRootsByTag: {},
            tokenPaths: {},
            itemIcons: {}
        };
        if (manifest.terrainBanners) {
            await this.#collectTerrains(source, joinPath(root, manifest.terrainBanners));
        }
        if (manifest.stationTokens) {
            await this.#collectTokens(source, joinPath(root, manifest.stationTokens));
        }
        for (const [key, rel] of Object.entries(manifest.itemIcons ?? {})) {
            if (typeof rel === "string" && rel) source.itemIcons[key] = joinPath(root, rel);
        }
        return source;
    }

    /** @returns {Promise<ArtSource|null>} */
    static async #sourceFromConvention(id, root, priority) {
        const source = { id, root, priority, terrainRootsByTag: {}, tokenPaths: {}, itemIcons: {} };
        for (const rel of CONVENTION_TERRAIN_DIRS) {
            if (await this.#collectTerrains(source, joinPath(root, rel))) break;
        }
        for (const rel of CONVENTION_TOKEN_DIRS) {
            if (await this.#collectTokens(source, joinPath(root, rel))) break;
        }
        const empty = !Object.keys(source.terrainRootsByTag).length
            && !Object.keys(source.tokenPaths).length;
        return empty ? null : source;
    }

    /**
     * Data packs also ship `data/terrains/<tag>/terrain.json`, so a tag
     * only counts when its folder holds image files.
     */
    static async #collectTerrains(source, terrainsDir) {
        const listing = await browse(terrainsDir);
        if (!listing?.dirs.length) return false;
        const checks = await Promise.all(listing.dirs.map(async (tag) => {
            const files = (await browse(`${terrainsDir}/${tag}`))?.files ?? [];
            return files.some(f => IMAGE_FILE.test(f)) ? tag : null;
        }));
        const tags = checks.filter(Boolean);
        for (const tag of tags) {
            source.terrainRootsByTag[tag] ??= terrainsDir;
        }
        return tags.length > 0;
    }

    static async #collectTokens(source, tokensDir) {
        const listing = await browse(tokensDir);
        const files = (listing?.files ?? []).filter(f => IMAGE_FILE.test(f));
        if (!files.length) return false;
        for (const file of files) {
            source.tokenPaths[file] ??= `${tokensDir}/${file}`;
        }
        return true;
    }
}

/** Test helper: inject a catalog without disk I/O. */
export function __setArtCatalogForTests(catalog) {
    current = catalog ? { ...emptyCatalog(), ...catalog } : emptyCatalog();
    loaded = true;
}
