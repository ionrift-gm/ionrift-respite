/**
 * TerrainRegistry
 * Centralized, data-driven terrain configuration.
 * Scans terrain folders and loads per-terrain JSON manifests at boot.
 * All terrain metadata lives in data/terrains/{name}/terrain.json.
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
     * Initialize the registry. Loads the release manifest, then fetches
     * each terrain's terrain.json. Safe to call multiple times (no-ops after first).
     */
    static async init() {
        if (this._ready) return;

        // Load release manifest to know which terrains are shipped
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

        // Load each released terrain's manifest
        const loadPromises = released.map(async (terrainId) => {
            try {
                const resp = await fetch(`modules/${MODULE_ID}/data/terrains/${terrainId}/terrain.json`);
                if (!resp.ok) {
                    console.warn(`${MODULE_ID} | TerrainRegistry: No terrain.json for "${terrainId}"`);
                    return;
                }
                const data = await resp.json();
                // Ensure the id field matches the folder name
                data.id = data.id ?? terrainId;
                this._terrains.set(terrainId, data);
            } catch (e) {
                console.warn(`${MODULE_ID} | TerrainRegistry: Failed to load ${terrainId}/terrain.json:`, e);
            }
        });

        await Promise.all(loadPromises);
        this._ready = true;

        const sorted = [...this._terrains.keys()].sort().join(", ");
        console.log(`${MODULE_ID} | TerrainRegistry: Loaded ${this._terrains.size} terrains: ${sorted}`);
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
     * Never uses hardcoded terrain ID lists — callers must not either.
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
