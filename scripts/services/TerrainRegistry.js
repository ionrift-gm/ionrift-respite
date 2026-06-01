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

/** Camp comfort keys used by RestSetupApp and RestFlowEngine */
const VALID_COMFORT = new Set(["safe", "sheltered", "rough", "hostile"]);

/** Valid terrain category values. Declared in each terrain.json as "category". */
const VALID_CATEGORIES = new Set(["dungeon", "safe-haven", "wilderness"]);

/**
 * Comfort → category fallback for terrain.json files that predate the category field.
 * "safe" comfort → safe-haven (taverns, inns).
 * Not used when terrain.category is present.
 */
const COMFORT_CATEGORY_FALLBACK = { safe: "safe-haven" };

export class TerrainRegistry {

    /** @type {Map<string, object>} Cached terrain manifests keyed by terrain id */
    static _terrains = new Map();

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

        this._ready = true;

        const sorted = [...this._terrains.keys()].sort().join(", ");
        console.log(`${MODULE_ID} | TerrainRegistry: Loaded ${this._terrains.size} terrains: ${sorted}`);
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

        for (const sublayer of sublayers) {
            try {
                const manifest = await overlay.getLocalManifest(MODULE_ID, sublayer);
                if (!manifest?.overlayId) continue;

                const active = await overlay.isOverlayActive(
                    manifest.overlayId, MODULE_ID, sublayer
                );
                if (!active) continue;

                const listing = await overlay.listOverlayDir(
                    MODULE_ID, sublayer, "data/terrains"
                );
                const terrainDirs = listing?.dirs ?? [];

                for (const terrainId of terrainDirs) {
                    try {
                        const data = await overlay.readOverlayFile(
                            MODULE_ID, sublayer, `data/terrains/${terrainId}/terrain.json`
                        );
                        if (!data) continue;
                        data.id = data.id ?? terrainId;
                        this._terrains.set(data.id, data);
                    } catch (e) {
                        console.warn(`${MODULE_ID} | TerrainRegistry: Failed to read overlay terrain "${terrainId}" from ${sublayer}:`, e);
                    }
                }
            } catch (e) {
                console.warn(`${MODULE_ID} | TerrainRegistry: Failed to scan overlay sublayer "${sublayer}":`, e);
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
        this._ready = false;
    }

    /**
     * Get a single terrain manifest by id.
     * @param {string} tag - Terrain id (e.g. "forest", "tavern")
     * @returns {object|undefined}
     */
    static get(tag) {
        return this._terrains.get(tag);
    }

    /**
     * Get all loaded terrain manifests, sorted alphabetically by label.
     * @returns {object[]}
     */
    static getAll() {
        return [...this._terrains.values()].sort((a, b) =>
            (a.label ?? a.id).localeCompare(b.label ?? b.id)
        );
    }

    /**
     * Terrain category for UI grouping and cross-module spine flags.
     * Reads "category" from the terrain's own terrain.json. Falls back to
     * a comfort-based heuristic for terrain.json files without a category field.
     * Never uses hardcoded terrain ID lists. Callers must not either.
     * @param {string} id
     * @returns {"dungeon"|"safe-haven"|"wilderness"}
     */
    static getCategory(id) {
        const t = this._terrains.get(id);
        if (!t) return "wilderness";
        if (t.category && VALID_CATEGORIES.has(t.category)) return t.category;
        // Fallback: derive from comfort field for legacy terrain.json files
        return COMFORT_CATEGORY_FALLBACK[t.comfort] ?? "wilderness";
    }

    /**
     * Environment dropdown groups (Dungeon, Safe Haven, Wilderness).
     * @param {{ lastTerrain?: string }} [options]
     * @returns {{ group: string, options: { value: string, label: string }[] }[]}
     */
    static getOptionGroups(options = {}) {
        const { lastTerrain } = options;
        const dungeon = [];
        const safeHaven = [];
        const wilderness = [];
        for (const t of this.getAll()) {
            const opt = {
                value: t.id,
                label: (t.label ?? t.id) + (lastTerrain && t.id === lastTerrain ? " (last used)" : "")
            };
            const category = this.getCategory(t.id);
            if (category === "dungeon") dungeon.push(opt);
            else if (category === "safe-haven") safeHaven.push(opt);
            else wilderness.push(opt);
        }
        const groups = [];
        if (dungeon.length) groups.push({ group: "Dungeon", options: dungeon });
        if (safeHaven.length) groups.push({ group: "Safe Haven", options: safeHaven });
        if (wilderness.length) groups.push({ group: "Wilderness", options: wilderness });
        return groups;
    }

    /**
     * Get all loaded terrain ids as a Set.
     * @returns {Set<string>}
     */
    static getAvailableIds() {
        return new Set(this._terrains.keys());
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
     * Get terrain defaults (comfort, scouting, mealRules, etc).
     * @param {string} tag
     * @returns {object}
     */
    static getDefaults(tag) {
        const t = this.get(tag);
        if (!t) return { comfort: "sheltered", scoutingAvailable: false, mealRules: { waterPerDay: 2, foodPerDay: 1 } };
        const rawComfort = t.comfort ?? "sheltered";
        const comfort = VALID_COMFORT.has(rawComfort) ? rawComfort : "rough";
        if (!VALID_COMFORT.has(rawComfort)) {
            console.warn(`${MODULE_ID} | TerrainRegistry: Invalid comfort "${rawComfort}" for "${tag}", using rough`);
        }
        return {
            comfort,
            scoutingAvailable: t.scoutingAvailable ?? false,
            scoutGuidance: t.scoutGuidance ?? null,
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
