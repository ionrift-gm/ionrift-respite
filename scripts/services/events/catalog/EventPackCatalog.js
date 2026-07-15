import { TerrainRegistry } from "../resolve/TerrainRegistry.js";
import { MODULE_ID } from "../../../data/moduleId.js";

/** Community JSON without _manifest or explicit schemaVersion. */
export const LEGACY_SCHEMA_VERSION = "legacy-v1";

/**
 * When legacy pack splits exist, a bare terrain tag (e.g. tavern) resolves to core.
 *
 * @param {string|null} filterValue
 * @param {object[]} allEvents
 * @returns {string|null}
 */
export function normalizeEventPoolFilter(filterValue, allEvents) {
    if (!filterValue) return null;
    const { terrain, packId } = parseEventPoolFilter(filterValue);
    if (packId || !terrain) return filterValue;

    const bindings = collectTerrainPackBindings(allEvents);
    if (bindings.get(terrain)?.length) {
        return `${terrain}@base`;
    }
    return filterValue;
}

/**
 * @param {string} filterValue
 * @returns {{ terrain: string|null, packId: string|null }}
 */
export function parseEventPoolFilter(filterValue) {
    if (!filterValue) return { terrain: null, packId: null };
    const at = filterValue.indexOf("@");
    if (at < 0) return { terrain: filterValue, packId: null };
    return {
        terrain: filterValue.slice(0, at),
        packId: filterValue.slice(at + 1) || null
    };
}

/**
 * @param {object} evt
 * @param {{ terrain: string|null, packId: string|null }} filter
 * @returns {boolean}
 */
export function eventMatchesPoolFilter(evt, filter) {
    if (!filter.terrain) return true;
    if (!evt.terrainTags?.includes(filter.terrain)) return false;
    if (!filter.packId) return true;

    const pack = evt.pack ?? "base";
    if (filter.packId === "base") {
        return pack === "base" || !evt.pack;
    }
    return pack === filter.packId;
}

/**
 * Legacy community packs often tagged every event with a core terrain (e.g. tavern)
 * because custom terrains did not exist yet. Detect that pattern so the Event Pool
 * can list them under the parent terrain without merging into core events.
 *
 * @param {object} packData - Raw or persisted pack payload with events[].
 * @returns {{ parentTerrain: string, packId: string, label: string }|null}
 */
export function detectLegacyTerrainBinding(packData) {
    const packId = packData?.id;
    const events = packData?.events;
    if (!packId || packId === "base" || !Array.isArray(events) || !events.length) {
        return null;
    }

    if (packData.schemaVersion && packData.schemaVersion !== LEGACY_SCHEMA_VERSION) {
        if (packData.parentTerrain && packData.id) {
            return {
                parentTerrain: packData.parentTerrain,
                packId: packData.id,
                label: packData.displayName ?? packData.name ?? packId
            };
        }
        return null;
    }

    const terrainTags = new Set();
    for (const evt of events) {
        for (const tag of (evt.terrainTags ?? [])) {
            if (tag) terrainTags.add(tag);
        }
    }

    if (!terrainTags.size) return null;

    const coreTags = [...terrainTags].filter(tag => {
        const manifest = TerrainRegistry.get(tag);
        return manifest && !manifest.custom && !TerrainRegistry.isCustomTerrain(tag);
    });

    if (coreTags.length !== terrainTags.size || coreTags.length !== 1) {
        return null;
    }

    const parentTerrain = coreTags[0];
    const label = packData.displayName ?? packData.name ?? packId.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());

    return { parentTerrain, packId, label };
}

/**
 * @param {string} packId
 * @param {object} packData
 * @param {object[]} [allEvents]
 * @returns {{ parentTerrain: string, packId: string, label: string }|null}
 */
export function resolvePackTerrainBinding(packId, packData, allEvents = []) {
    if (packData?.legacyTerrainBinding?.parentTerrain) {
        return {
            parentTerrain: packData.legacyTerrainBinding.parentTerrain,
            packId: packData.legacyTerrainBinding.packId ?? packId,
            label: packData.legacyTerrainBinding.label ?? packData.name ?? packId
        };
    }

    const payload = {
        id: packId,
        name: packData?.name,
        displayName: packData?.displayName,
        schemaVersion: packData?.schemaVersion,
        parentTerrain: packData?.parentTerrain,
        events: packData?.events ?? allEvents.filter(evt => evt.pack === packId)
    };
    return detectLegacyTerrainBinding(payload);
}

/**
 * @param {object[]} allEvents
 * @returns {Map<string, { packId: string, label: string }[]>}
 */
export function collectTerrainPackBindings(allEvents) {
    /** @type {Map<string, { packId: string, label: string }[]>} */
    const byTerrain = new Map();

    const importedPacks = game.settings.get(MODULE_ID, "importedPacks") ?? {};
    for (const [packId, packData] of Object.entries(importedPacks)) {
        const binding = resolvePackTerrainBinding(packId, packData, allEvents);
        if (!binding) continue;

        const list = byTerrain.get(binding.parentTerrain) ?? [];
        if (!list.some(entry => entry.packId === binding.packId)) {
            list.push({ packId: binding.packId, label: binding.label });
        }
        byTerrain.set(binding.parentTerrain, list);
    }

    for (const list of byTerrain.values()) {
        list.sort((a, b) => a.label.localeCompare(b.label));
    }

    return byTerrain;
}

/**
 * Terrain dropdown groups for Event Pool, with legacy import sub-filters under
 * the parent terrain they borrow (e.g. Tavern · Vistani Encampment).
 *
 * @param {object[]} allEvents
 * @returns {{ group: string, options: { value: string, label: string }[] }[]}
 */
export function buildEventPoolFilterGroups(allEvents) {
    const bindings = collectTerrainPackBindings(allEvents);
    const baseGroups = TerrainRegistry.getOptionGroups();

    return baseGroups.map(group => {
        const options = [];

        for (const opt of group.options) {
            const terrain = opt.value;
            const legacyPacks = bindings.get(terrain);
            const terrainLabel = TerrainRegistry.get(terrain)?.label ?? terrain;

            if (legacyPacks?.length) {
                options.push({
                    value: `${terrain}@base`,
                    label: terrainLabel
                });
                for (const pack of legacyPacks) {
                    options.push({
                        value: `${terrain}@${pack.packId}`,
                        label: `${terrainLabel} · ${pack.label}`
                    });
                }
            } else {
                options.push(opt);
            }
        }

        return { group: group.group, options };
    });
}
