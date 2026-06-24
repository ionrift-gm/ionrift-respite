/**
 * Runtime registry for meal buff handler plugins (overlay or built-in).
 * Kernel dispatches buff resolution here before legacy fallbacks.
 */

const REQUIRED_KEYS = ["id", "label", "resolve"];

/** @type {Map<string, object>} */
const _handlers = new Map();

/** @type {Set<string>} */
const _unknownTypeWarnings = new Set();

/**
 * @typedef {Object} MealBuffHandlerMeta
 * @property {string} overlayId
 * @property {string} [pluginId]
 */

/**
 * @param {object} handler
 * @param {MealBuffHandlerMeta} meta
 */
export function registerMealBuffHandler(handler, meta) {
    if (!handler?.id) {
        throw new Error("registerMealBuffHandler: handler must have an `id` property.");
    }

    const missing = REQUIRED_KEYS.filter(key => {
        if (key === "id" || key === "label") return typeof handler[key] !== "string" || !handler[key].trim();
        return typeof handler[key] !== "function";
    });
    if (missing.length) {
        throw new Error(`registerMealBuffHandler: handler "${handler.id}" missing required keys: ${missing.join(", ")}.`);
    }

    const entry = handler;
    entry._overlayId = meta.overlayId;
    entry._pluginId = meta.pluginId ?? handler.id;
    _handlers.set(handler.id, entry);
}

/**
 * @param {string} id
 * @returns {boolean}
 */
export function unregisterMealBuffHandler(id) {
    return _handlers.delete(id);
}

/**
 * @param {string} overlayId
 */
export function unregisterMealBuffHandlersForOverlay(overlayId) {
    for (const [id, handler] of _handlers) {
        if (handler._overlayId === overlayId) _handlers.delete(id);
    }
}

/**
 * @param {string} id
 * @returns {object|undefined}
 */
export function getMealBuffHandler(id) {
    return _handlers.get(id);
}

/**
 * @returns {object[]}
 */
export function listMealBuffHandlers() {
    return [..._handlers.values()];
}

/**
 * Resolve a meal buff through a registered handler.
 * @param {Actor} actor
 * @param {object} buff
 * @param {object} [ctx]
 * @returns {Promise<{ summary?: string, roll?: Roll|null }|null|undefined>}
 *   `undefined` when no handler is registered for buff.type.
 */
export async function dispatchMealBuffHandler(actor, buff, ctx = {}) {
    if (!buff?.type) return undefined;

    const handler = _handlers.get(buff.type);
    if (!handler) return undefined;

    try {
        return await handler.resolve(actor, buff, ctx);
    } catch (err) {
        console.warn(`ionrift-respite | Meal buff handler "${buff.type}" failed.`, err);
        return null;
    }
}

/**
 * Log once when a buff type has no handler and no legacy fallback matched.
 * @param {string} type
 */
export function warnUnknownMealBuffType(type) {
    if (!type || _unknownTypeWarnings.has(type)) return;
    _unknownTypeWarnings.add(type);
    console.warn(`ionrift-respite | No meal buff handler registered for type "${type}".`);
}

/** @private test helper */
export function _resetMealBuffHandlersForTests() {
    _handlers.clear();
    _unknownTypeWarnings.clear();
}
