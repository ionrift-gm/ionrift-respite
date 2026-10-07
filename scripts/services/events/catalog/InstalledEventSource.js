/**
 * InstalledEventSource
 * Single entry point for night events and camp disasters.
 *
 * Respite ships no event content of its own. Every event, disaster, and
 * terrain roll table comes from installed, active overlay sublayers (via
 * OverlayEventLoader) or from event files the GM imports. With nothing
 * installed every helper resolves to empty: the events step falls back to
 * improvised nights and no disaster rolls are attempted.
 */
import { MODULE_ID } from "../../../data/moduleId.js";
import { OverlayEventLoader } from "../../packs/overlays/OverlayEventLoader.js";

/**
 * Event bundles from every active overlay sublayer.
 * @returns {Promise<{ packId: string, sublayer: string, data: { tables?: object[], events?: object[] } }[]>}
 */
export async function loadInstalledEventBundles() {
    try {
        return await OverlayEventLoader.loadAll();
    } catch (e) {
        console.warn(`${MODULE_ID} | InstalledEventSource: overlay scan failed:`, e);
        return [];
    }
}

/**
 * Flat list of installed overlay events (all terrains, including disasters).
 * @returns {Promise<object[]>}
 */
export async function loadInstalledEvents() {
    const events = [];
    for (const { data } of await loadInstalledEventBundles()) {
        for (const evt of (data?.events ?? [])) events.push(evt);
    }
    return events;
}

/**
 * Feeds installed overlay tables and events into an EventResolver.
 * When a terrain tag is given, only that terrain's events and tables load.
 *
 * @param {{ load: (tables: object[], events: object[]) => void }} resolver
 * @param {{ terrainTag?: string|null }} [options]
 * @returns {Promise<number>} Number of events offered to the resolver.
 */
export async function loadInstalledEventsInto(resolver, options = {}) {
    if (!resolver?.load) return 0;
    const terrainTag = options.terrainTag ?? null;
    let offered = 0;

    for (const { data } of await loadInstalledEventBundles()) {
        let events = data?.events ?? [];
        let tables = data?.tables ?? [];
        if (terrainTag) {
            events = events.filter(e => e.terrainTags?.includes(terrainTag));
            tables = tables.filter(t => !t.terrainTag || t.terrainTag === terrainTag);
        }
        if (!events.length && !tables.length) continue;
        resolver.load(tables, events);
        offered += events.length;
    }
    return offered;
}

/**
 * Counts events available for a terrain from installed overlays and
 * imported event files, before pool curation is applied.
 *
 * @param {string} terrainTag
 * @returns {Promise<number>}
 */
export async function countInstalledEventsForTerrain(terrainTag) {
    if (!terrainTag) return 0;
    let count = 0;
    for (const evt of await loadInstalledEvents()) {
        if (evt.terrainTags?.includes(terrainTag)) count++;
    }
    try {
        const imported = game.settings.get(MODULE_ID, "importedPacks") ?? {};
        for (const pack of Object.values(imported)) {
            for (const evt of (pack?.events ?? [])) {
                if (evt.terrainTags?.includes(terrainTag)) count++;
            }
        }
    } catch { /* setting not registered yet */ }
    return count;
}

/**
 * Finds an installed event by id, or null when no overlay provides it.
 * @param {string} eventId
 * @returns {Promise<object|null>}
 */
export async function findInstalledEvent(eventId) {
    if (!eventId) return null;
    for (const evt of await loadInstalledEvents()) {
        if (evt.id === eventId) return evt;
    }
    return null;
}

/**
 * First installed disaster-tier event, preferring a given id.
 * @param {{ preferId?: string, terrainTag?: string|null }} [options]
 * @returns {Promise<object|null>}
 */
export async function findInstalledDisaster(options = {}) {
    const { preferId = null, terrainTag = null } = options;
    const events = await loadInstalledEvents();
    const disasters = events.filter(e => e.tier === "disaster"
        && (!terrainTag || e.terrainTags?.includes(terrainTag)));
    if (preferId) {
        const preferred = disasters.find(e => e.id === preferId) ?? events.find(e => e.id === preferId);
        if (preferred) return preferred;
    }
    return disasters[0] ?? null;
}
