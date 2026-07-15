import { Logger } from "../utils/Logger.js";
/**
 * TerrainRegistry
 * Centralized, data-driven terrain configuration for Respite.
 *
 * The module ships only its base terrains under
 * `data/terrains/{name}/terrain.json`. Every other terrain is delivered
 * plug-and-play by an active overlay: at init the registry scans each
 * installed overlay for `data/terrains/<id>/terrain.json` and merges those
 * in. Toggling an overlay re-evaluates the picker via `reset()` + `init()`
 * from `ionrift.overlayContentChanged`, so packs come and go without a
 * world reload and without a module patch.
 *
 * Consumers (RestSetupApp, PackRegistryApp, module.js) use this registry
 * instead of hardcoded arrays and objects.
 */

const MODULE_ID = "ionrift-respite";

import { normalizeTerrainCategory } from "../../../ionrift-library/scripts/services/TerrainRegistry.js";

/** Camp comfort keys used by RestSetupApp and RestFlowEngine */
const VALID_COMFORT = new Set(["safe", "sheltered", "rough", "hostile"]);

/** Valid terrain category values. Declared in each terrain.json as "category". */
const VALID_CATEGORIES = new Set(["built", "safe-haven", "wilderness"]);

/**
 * Comfort → category fallback for terrain.json files that predate the category field.
 * "safe" comfort → safe-haven (taverns, inns).
 * Not used when terrain.category is present.
 */
const COMFORT_CATEGORY_FALLBACK = { safe: "safe-haven" };

export class TerrainRegistry {

    /** @type {Map<string, object>} Cached terrain manifests keyed by terrain id */
    static _terrains = new Map();

    /**
     * Synthetic terrain stubs for tags referenced by imported event packs
     * but not backed by a terrain.json. Events-only; travel and forage off.
     * @type {Map<string, object>}
     */
    static _customTerrains = new Map();

    /** @type {boolean} True once init() has completed */
    static _ready = false;

    /**
     * Initialize the registry. Loads the module-shipped base terrains, then
     * scans every installed and active overlay for additional terrain folders
     * and merges them in. The module ships data only for its base set; every
     * other terrain is delivered plug-and-play by an active overlay.
     */
    static async init() {
        if (this._ready) return;

        await this._loadModuleBase();
        await this._loadFromOverlays();
        this.syncCustomTerrainsFromPacks();

        this._ready = true;

        const sorted = [...this._terrains.keys()].sort().join(", ");
        Logger.log(`${MODULE_ID} | TerrainRegistry: Loaded ${this._terrains.size} terrains: ${sorted}`);
    }

    /**
     * Load the module-shipped terrains listed in data/terrains/manifest.json.
     * @private
     */
    static async _loadModuleBase() {
        let released = [];
        try {
            const resp = await fetch(`modules/${MODULE_ID}/data/terrains/manifest.json`);
            if (resp.ok) {
                const manifest = await resp.json();
                released = manifest.released ?? [];
            }
        } catch (e) {
            console.warn(`${MODULE_ID} | TerrainRegistry: Failed to load manifest.json:`, e);
        }

        const loadPromises = released.map(async (terrainId) => {
            try {
                const resp = await fetch(`modules/${MODULE_ID}/data/terrains/${terrainId}/terrain.json`);
                if (!resp.ok) {
                    console.warn(`${MODULE_ID} | TerrainRegistry: No terrain.json for "${terrainId}"`);
                    return;
                }
                const data = await resp.json();
                data.id = data.id ?? terrainId;
                this._terrains.set(terrainId, data);
            } catch (e) {
                console.warn(`${MODULE_ID} | TerrainRegistry: Failed to load ${terrainId}/terrain.json:`, e);
            }
        });

        await Promise.all(loadPromises);
    }

    /**
     * Scan every installed overlay for `data/terrains/<id>/terrain.json` files
     * and merge them into the local registry. Only active overlays are loaded;
     * an inactive or absent overlay surfaces no terrain.
     * @private
     */
    static async _loadFromOverlays() {
        const overlay = game.ionrift?.library?.overlay;
        if (!overlay) return;

        let sublayers = [];
        try {
            sublayers = await overlay.listInstalledSublayers(MODULE_ID);
        } catch (e) {
            console.warn(`${MODULE_ID} | TerrainRegistry: overlay sublayer scan failed:`, e);
            return;
        }

        // Process all sublayers concurrently — each is independent.
        const sublayerResults = await Promise.allSettled(
            sublayers.map(async (sublayer) => {
                const manifest = await overlay.getLocalManifest(MODULE_ID, sublayer);
                if (!manifest?.overlayId) return [];

                const active = await overlay.isOverlayActive(
                    manifest.overlayId, MODULE_ID, sublayer
                );
                if (!active) return [];

                const fileIndex = typeof overlay.readFileIndex === "function"
                    ? await overlay.readFileIndex(MODULE_ID, sublayer)
                    : null;
                let terrainDirs;
                if (fileIndex) {
                    const found = new Set();
                    for (const path of fileIndex) {
                        const match = /^data\/terrains\/([^/]+)\/terrain\.json$/.exec(path);
                        if (match) found.add(match[1]);
                    }
                    terrainDirs = [...found];
                } else {
                    const listing = await overlay.listOverlayDir(
                        MODULE_ID, sublayer, "data/terrains"
                    );
                    terrainDirs = listing?.dirs ?? [];
                }

                // Read all terrain files within this sublayer concurrently.
                const terrainResults = await Promise.allSettled(
                    terrainDirs.map(async (terrainId) => {
                        const data = await overlay.readOverlayFile(
                            MODULE_ID, sublayer, `data/terrains/${terrainId}/terrain.json`
                        );
                        if (!data) return null;
                        data.id = data.id ?? terrainId;
                        return data;
                    })
                );

                return terrainResults
                    .filter(r => r.status === "fulfilled" && r.value)
                    .map(r => r.value);
            })
        );

        // Merge results into the registry (order-stable: first sublayer wins).
        for (const result of sublayerResults) {
            if (result.status !== "fulfilled" || !result.value) continue;
            for (const data of result.value) {
                this._terrains.set(data.id, data);
            }
        }
    }

    /**
     * Clear the registry so init() will re-run from scratch.
     * Called when a pack overlay's active state changes so the picker can pick
     * up the new visibility set without a world reload.
     */
    static reset() {
        this._terrains.clear();
        this._customTerrains.clear();
        this._ready = false;
    }

    /**
     * True when the tag is a synthetic stub from an imported event pack,
     * not a shipped or overlay terrain.json.
     *
     * @param {string} tag
     * @returns {boolean}
     */
    static isCustomTerrain(tag) {
        return this._customTerrains.has(tag);
    }

    /**
     * Register synthetic terrain stubs for pack tags that lack terrain.json.
     * Skips ids already present in the shipped or overlay registry.
     *
     * @param {string[]} tags
     */
    static syncCustomTerrains(tags) {
        for (const tag of tags) {
            if (!tag || typeof tag !== "string") continue;
            if (this._terrains.has(tag)) continue;
            if (!this._customTerrains.has(tag)) {
                this._customTerrains.set(tag, this._buildCustomStub(tag));
            }
        }
    }

    /**
     * Seeds custom terrain stubs from imported pack metadata and event tags.
     * Lightweight pass used during init before the full event catalog loads.
     */
    static syncCustomTerrainsFromPacks() {
        const tags = new Set();
        try {
            const importedPacks = game.settings.get(MODULE_ID, "importedPacks") ?? {};
            for (const pack of Object.values(importedPacks)) {
                for (const tag of (pack.terrains ?? [])) {
                    if (tag) tags.add(tag);
                }
                for (const evt of (pack.events ?? [])) {
                    for (const tag of (evt.terrainTags ?? [])) {
                        if (tag) tags.add(tag);
                    }
                }
            }
        } catch (e) {
            console.warn(`${MODULE_ID} | TerrainRegistry: custom terrain pack scan failed:`, e);
        }
        this.syncCustomTerrains([...tags]);
    }

    /**
     * @param {string} tag
     * @returns {object}
     */
    static _buildCustomStub(tag) {
        const label = tag.replace(/_/g, " ").replace(/\b\w/g, char => char.toUpperCase());
        return {
            id: tag,
            label: `${label} (custom)`,
            category: "custom",
            icon: "fas fa-puzzle-piece",
            comfort: "rough",
            travelActivities: [],
            mealRules: { waterPerDay: 1, foodPerDay: 1 },
            custom: true,
            customNote: "Imported event pack terrain. Travel and forage are off until a terrain pack is installed."
        };
    }

    /**
     * Get a single terrain manifest by id.
     * @param {string} tag - Terrain id (e.g. "forest", "tavern")
     * @returns {object|undefined}
     */
    static get(tag) {
        return this._terrains.get(tag) ?? this._customTerrains.get(tag);
    }

    /**
     * Get all loaded terrain manifests, sorted alphabetically by label.
     * @returns {object[]}
     */
    static getAll() {
        const merged = [...this._terrains.values(), ...this._customTerrains.values()];
        return merged.sort((a, b) =>
            (a.label ?? a.id).localeCompare(b.label ?? b.id)
        );
    }

    /**
     * Terrain category for UI grouping and cross-module spine flags.
     * Reads "category" from the terrain's own terrain.json. Falls back to
     * a comfort-based heuristic for terrain.json files without a category field.
     * Never uses hardcoded terrain ID lists. Callers must not either.
     * @param {string} id
     * @returns {"built"|"safe-haven"|"wilderness"}
     */
    static getCategory(id) {
        const t = this.get(id);
        if (!t) return "wilderness";
        if (t.custom || t.category === "custom") return "custom";
        const normalized = normalizeTerrainCategory(t.category);
        if (normalized && VALID_CATEGORIES.has(normalized)) return normalized;
        // Fallback: derive from comfort field for legacy terrain.json files
        return COMFORT_CATEGORY_FALLBACK[t.comfort] ?? "wilderness";
    }

    /**
     * Environment dropdown groups (Built, Safe Haven, Wilderness).
     * @param {{ lastTerrain?: string }} [options]
     * @returns {{ group: string, options: { value: string, label: string }[] }[]}
     */
    static getOptionGroups(options = {}) {
        const { lastTerrain } = options;
        const built = [];
        const safeHaven = [];
        const wilderness = [];
        const custom = [];
        for (const t of this.getAll()) {
            const opt = {
                value: t.id,
                label: (t.label ?? t.id) + (lastTerrain && t.id === lastTerrain ? " (last used)" : "")
            };
            const category = this.getCategory(t.id);
            if (category === "built") built.push(opt);
            else if (category === "safe-haven") safeHaven.push(opt);
            else if (category === "custom") custom.push(opt);
            else wilderness.push(opt);
        }
        const groups = [];
        if (built.length) groups.push({ group: "Built", options: built });
        if (safeHaven.length) groups.push({ group: "Safe Haven", options: safeHaven });
        if (wilderness.length) groups.push({ group: "Wilderness", options: wilderness });
        if (custom.length) groups.push({ group: "Custom", options: custom });
        return groups;
    }

    /**
     * Get all loaded terrain ids as a Set.
     * @returns {Set<string>}
     */
    static getAvailableIds() {
        return new Set([...this._terrains.keys(), ...this._customTerrains.keys()]);
    }

    /**
     * Get the weather key array for a terrain.
     * @param {string} tag
     * @returns {string[]}
     */
    static getWeather(tag) {
        return this.get(tag)?.weather ?? ["clear"];
    }

    /**
     * Whether this terrain supports travel resolution (forage, hunt, scout on the road).
     * Prefer explicit {@link travelActivities}; legacy {@link scoutingAvailable} is honoured for older packs.
     * @param {string} tag
     * @returns {boolean}
     */
    static isTravelAvailable(tag) {
        const t = this.get(tag);
        if (!t) return false;
        if (Array.isArray(t.travelActivities)) return t.travelActivities.length > 0;
        if (t.travelAvailable !== undefined) return !!t.travelAvailable;
        if (t.scoutingAvailable !== undefined) return !!t.scoutingAvailable;
        return true;
    }

    /**
     * Get terrain defaults (comfort, mealRules, scout flavor, etc).
     * @param {string} tag
     * @returns {object}
     */
    static getDefaults(tag) {
        const t = this.get(tag);
        if (!t) return { comfort: "sheltered", travelAvailable: false, mealRules: { waterPerDay: 2, foodPerDay: 1 } };
        const rawComfort = t.comfort ?? "sheltered";
        const comfort = VALID_COMFORT.has(rawComfort) ? rawComfort : "rough";
        if (!VALID_COMFORT.has(rawComfort)) {
            console.warn(`${MODULE_ID} | TerrainRegistry: Invalid comfort "${rawComfort}" for "${tag}", using rough`);
        }
        return {
            comfort,
            travelAvailable: TerrainRegistry.isTravelAvailable(tag),
            scoutFlavor: t.scoutFlavor ?? null,
            mealRules: t.mealRules ?? { waterPerDay: 2, foodPerDay: 1 }
        };
    }

    /**
     * Get the events file path for a terrain, relative to the module data directory.
     * @param {string} tag
     * @returns {string|null}
     */
    static getEventsPath(tag) {
        const t = this.get(tag);
        if (!t?.eventsFile) return null;
        return `modules/${MODULE_ID}/data/${t.eventsFile}`;
    }

    /**
     * Load event objects from camp disasters and each released terrain's eventsFile.
     * Shared by Event Browser and Pack Registry so scans stay aligned with manifest.released.
     *
     * @param {{ includeCampDisasters?: boolean }} [options]
     * @returns {Promise<object[]>}
     */
    static async loadReleasedEvents(options = {}) {
        const { includeCampDisasters = true } = options;
        await this.init();
        const events = [];
        const seenPaths = new Set();

        const appendFromPath = async (path) => {
            if (!path || seenPaths.has(path)) return;
            seenPaths.add(path);
            try {
                const resp = await fetch(path);
                if (!resp.ok) return;
                const data = await resp.json();
                for (const evt of (data.events ?? [])) {
                    events.push(evt);
                }
            } catch (e) {
                console.warn(`${MODULE_ID} | TerrainRegistry: Failed to load events from ${path}:`, e);
            }
        };

        if (includeCampDisasters) {
            await appendFromPath(`modules/${MODULE_ID}/data/core/events/camp_disasters.json`);
        }

        for (const terrain of this.getAll()) {
            await appendFromPath(this.getEventsPath(terrain.id));
        }

        return events;
    }

    /**
     * Whether the registry has completed loading.
     * @returns {boolean}
     */
    static get isReady() {
        return this._ready;
    }
}
