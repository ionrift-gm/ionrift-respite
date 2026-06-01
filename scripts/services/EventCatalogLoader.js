import { TerrainRegistry } from "./TerrainRegistry.js";

const MODULE_ID = "ionrift-respite";

/**
 * Loads the full event catalog for curation and migration.
 * Includes released terrains, imported packs, and overlay packs.
 *
 * @returns {Promise<object[]>}
 */
export async function loadAllCatalogEvents() {
    await TerrainRegistry.init();
    const events = [...await TerrainRegistry.loadReleasedEvents()];

    const importedPacks = game.settings.get(MODULE_ID, "importedPacks") ?? {};
    for (const packData of Object.values(importedPacks)) {
        for (const evt of (packData.events ?? [])) {
            events.push(evt);
        }
    }

    try {
        const { OverlayEventLoader } = await import("./OverlayEventLoader.js");
        const overlayPacks = await OverlayEventLoader.loadAll();
        for (const { data } of overlayPacks) {
            for (const evt of (data.events ?? [])) {
                events.push(evt);
            }
        }
    } catch (e) {
        console.warn(`${MODULE_ID} | EventCatalogLoader: overlay loading failed:`, e);
    }

    const deduped = dedupeById(events);
    deduped.sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
    return deduped;
}

/**
 * Collapses events that share an id, keeping the first occurrence.
 * The same pack can reach the catalog from more than one source (an active
 * overlay and an imported copy), which would otherwise list every event twice.
 *
 * @param {object[]} events
 * @returns {object[]}
 */
function dedupeById(events) {
    const byId = new Map();
    const result = [];
    for (const evt of events) {
        const id = evt?.id;
        if (id == null) {
            result.push(evt);
            continue;
        }
        if (byId.has(id)) continue;
        byId.set(id, true);
        result.push(evt);
    }
    return result;
}

/**
 * Filters catalog events by enabled content packs (same rule as EventResolver.load).
 *
 * @param {object[]} events
 * @returns {object[]}
 */
export function filterByEnabledPacks(events) {
    let enabledPacks = null;
    try {
        enabledPacks = game.settings.get(MODULE_ID, "enabledPacks");
    } catch (e) { /* setting may not exist yet */ }

    if (!enabledPacks) return events;

    return events.filter(event => {
        if (enabledPacks && event.pack && enabledPacks[event.pack] === false) {
            return false;
        }
        return true;
    });
}

/**
 * Reads the persisted per-event roll pool selection.
 *
 * @returns {Record<string, boolean>}
 */
export function getEventPoolSelection() {
    try {
        return game.settings.get(MODULE_ID, "eventPoolSelection") ?? {};
    } catch (e) {
        return {};
    }
}

/**
 * Counts events in the resolver pool for a terrain tag.
 *
 * @param {import("./EventResolver.js").EventResolver} resolver
 * @param {string} terrainTag
 * @returns {number}
 */
export function countPoolEventsForTerrain(resolver, terrainTag) {
    let count = 0;
    for (const event of resolver.events.values()) {
        if (event.terrainTags?.includes(terrainTag)) count++;
    }
    return count;
}

/**
 * Lists events in the resolver pool for a terrain tag (curated selection only).
 *
 * @param {import("./EventResolver.js").EventResolver} resolver
 * @param {string} terrainTag
 * @returns {object[]}
 */
export function listPoolEventsForTerrain(resolver, terrainTag) {
    const events = [];
    for (const event of resolver.events.values()) {
        if (event.terrainTags?.includes(terrainTag)) events.push(event);
    }
    events.sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
    return events;
}
