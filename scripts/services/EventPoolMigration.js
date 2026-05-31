import { EventBrowserApp } from "../apps/EventBrowserApp.js";
import { filterByEnabledPacks, loadAllCatalogEvents } from "./EventCatalogLoader.js";

const MODULE_ID = "ionrift-respite";

/**
 * Returns true when enabledPacks has been customized beyond the default { base: true }.
 *
 * @returns {boolean}
 */
function hasCustomizedPacks() {
    const enabledPacks = game.settings.get(MODULE_ID, "enabledPacks") ?? {};
    const keys = Object.keys(enabledPacks);
    if (keys.length === 0) return false;
    if (keys.length === 1 && keys[0] === "base" && enabledPacks.base === true) return false;
    return true;
}

/**
 * Returns true when this world has prior rest activity (upgrade heuristic).
 *
 * @returns {boolean}
 */
function isExistingWorld() {
    const lastRestDate = game.settings.get(MODULE_ID, "lastRestDate") ?? "";
    return !!lastRestDate || hasCustomizedPacks();
}

/**
 * One-time migration for the opt-in event pool.
 * Existing worlds seed all eligible events; fresh worlds stay empty until the GM curates.
 */
export async function initializeEventPoolIfNeeded() {
    if (!game.user.isGM) return;

    let initialized = false;
    try {
        initialized = game.settings.get(MODULE_ID, "eventPoolInitialized");
    } catch (e) { /* setting may not exist yet */ }
    if (initialized) return;

    if (isExistingWorld()) {
        const catalog = filterByEnabledPacks(await loadAllCatalogEvents());
        const selection = {};
        for (const evt of catalog) {
            if (evt.id) selection[evt.id] = true;
        }
        await game.settings.set(MODULE_ID, "eventPoolSelection", selection);
        console.log(`${MODULE_ID} | Seeded event pool with ${Object.keys(selection).length} events (existing world migration).`);
    }

    await game.settings.set(MODULE_ID, "eventPoolInitialized", true);
}

/**
 * Opens the event pool curation app, optionally pre-filtered to a terrain.
 *
 * @param {string|null} [terrainFilter]
 */
export function openEventPoolApp(terrainFilter = null) {
    const app = new EventBrowserApp({ terrainFilter });
    app.render(true);
}
