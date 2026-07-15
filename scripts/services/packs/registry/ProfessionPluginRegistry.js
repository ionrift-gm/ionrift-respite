/**
 * Runtime registry for profession root plugins loaded from overlays.
 */

const REQUIRED_KEYS = ["id", "label"];

/** @type {Map<string, object>} */
const _plugins = new Map();

/**
 * @param {object} plugin
 * @param {{ overlayId: string, sublayer?: string }} meta
 */
export function registerProfessionPlugin(plugin, meta) {
    if (!plugin?.id) {
        throw new Error("registerProfessionPlugin: plugin must have an `id` property.");
    }

    const missing = REQUIRED_KEYS.filter(key => typeof plugin[key] !== "string" || !plugin[key].trim());
    if (missing.length) {
        throw new Error(`registerProfessionPlugin: plugin "${plugin.id}" missing required keys: ${missing.join(", ")}.`);
    }

    plugin._overlayId = meta.overlayId;
    plugin._sublayer = meta.sublayer ?? "";
    _plugins.set(plugin.id, plugin);
}

/**
 * Unregister all profession plugins for an overlay and call onUnregister.
 * @param {string} overlayId
 */
export function unregisterProfessionPluginsForOverlay(overlayId) {
    for (const [id, plugin] of _plugins) {
        if (plugin._overlayId !== overlayId) continue;
        try {
            plugin.onUnregister?.({ overlayId, sublayer: plugin._sublayer });
        } catch (err) {
            console.warn(`ionrift-respite | Profession plugin "${id}" onUnregister failed.`, err);
        }
        _plugins.delete(id);
    }
}

/**
 * @param {string} id
 * @returns {object|undefined}
 */
export function getProfessionPlugin(id) {
    return _plugins.get(id);
}

/**
 * @returns {object[]}
 */
export function listProfessionPlugins() {
    return [..._plugins.values()];
}

/** @private test helper */
export function _resetProfessionPluginsForTests() {
    _plugins.clear();
}
