/**
 * Cross-system container/inventory helpers for the Meal phase.
 * Handles DnD5e and PF2e container shapes and waterskin-style roll-up.
 */

import { ItemClassifier } from "../../party/ItemClassifier.js";
import { MODULE_ID, CONTAINER_ITEM_TYPES } from "./MealConstants.js";

/**
 * Get the ID of the container an item lives inside, if any.
 * DnD5e 5.x: item.system.container (string)
 * PF2e 8.x:  item.system.containerId (string or { value: string })
 * @param {Item} item
 * @returns {string|null}
 */
export function getContainerParentId(item) {
    if (!item) return null;

    const dnd = item.system?.container;
    if (typeof dnd === "string" && dnd) return dnd;
    if (dnd && typeof dnd === "object") {
        const id = dnd.id ?? dnd._id ?? dnd.value;
        if (typeof id === "string" && id) return id;
    }

    const pf2 = item.system?.containerId;
    if (typeof pf2 === "string" && pf2) return pf2;
    if (pf2 && typeof pf2 === "object") {
        const id = pf2.value ?? pf2.id ?? pf2._id;
        if (typeof id === "string" && id) return id;
    }

    try {
        const container = item.container;
        if (container?.id) return container.id;
    } catch { /* Item5e getter unavailable in tests */ }

    return null;
}

/**
 * Flatten embedded inventory items. All contained items remain on actor.items;
 * this avoids relying on collection-specific iterators.
 * @param {Actor} actor
 * @returns {Item[]}
 */
export function iterInventoryItems(actor) {
    return actor?.items ? [...actor.items] : [];
}

export function isContainerType(item) {
    return CONTAINER_ITEM_TYPES.has(item.type);
}

/**
 * Build a Set of item IDs that are container-type items in this actor's
 * inventory. Used to identify children via getContainerParentId.
 * @param {Iterable<Item>} items
 * @returns {Set<string>}
 */
export function collectContainerIds(items) {
    const ids = new Set();
    for (const item of items) {
        if (isContainerType(item)) ids.add(item.id);
    }
    return ids;
}

/**
 * Container IDs whose contents are rolled up on the parent water entry
 * (waterskin-style containers, not mundane backpacks).
 * @param {Iterable<Item>} items
 * @param {Actor} actor
 * @returns {Set<string>}
 */
export function collectWaterSourceContainerIds(items, actor) {
    const containerIds = collectContainerIds(items);
    const waterContainerIds = new Set();
    for (const item of items) {
        if (!isContainerType(item)) continue;
        if (!containerIds.has(item.id)) continue;
        const flaggedWater = item.flags?.[MODULE_ID]?.resourceType === "water";
        if (flaggedWater || ItemClassifier.isWater(item, actor)) {
            waterContainerIds.add(item.id);
        }
    }
    return waterContainerIds;
}
