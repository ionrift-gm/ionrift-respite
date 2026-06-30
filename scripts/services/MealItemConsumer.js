/**
 * Consume units of an inventory item for the Meal phase. Handles container
 * roll-up (waterskin-style), whole-unit drinks, charge-tracked bundles
 * (DnD5e legacy uses.value and v5+ uses.spent/max), and plain quantity items.
 */

import { ItemClassifier } from "./ItemClassifier.js";
import {
    isContainerType,
    getContainerParentId,
    iterInventoryItems
} from "./MealInventoryHelpers.js";

/**
 * Consume up to `amount` units of an item (decrement quantity or uses).
 * Returns the number of units actually consumed (handles partial supply).
 *
 * Supports both DnD5e legacy (uses.value writable) and v5+
 * (uses.spent/uses.max, where value = max - spent and is read-only).
 *
 * @param {Actor} actor
 * @param {string} itemId - Item ID to consume
 * @param {number} amount - Number of units to consume
 * @param {object} [opts]
 * @param {boolean} [opts.wholeUnit=false] - Skip charge tracking and
 *   decrement quantity directly. Used for water/drink consumption where
 *   1 slot = 1 whole container regardless of internal pint charges.
 * @returns {number} Units actually consumed
 */
export async function consumeItem(actor, itemId, amount = 1, { wholeUnit = false } = {}) {
    const item = actor.items.get(itemId);
    if (!item) return 0;
    if (ItemClassifier.isSpoiled(item)) return 0;

    // Container-type items (e.g. Waterskin as DnD5e container): consume
    // from the contained water items, not the container itself.
    if (isContainerType(item)) {
        let consumed = 0;
        let remaining = amount;
        const children = iterInventoryItems(actor).filter(
            c => getContainerParentId(c) === itemId && ItemClassifier.isWater(c, actor)
        );
        for (const child of children) {
            if (remaining <= 0) break;
            const cQty = child.system?.quantity ?? 1;
            const take = Math.min(remaining, cQty);
            if (cQty - take > 0) {
                await child.update({ "system.quantity": cQty - take });
            } else {
                await actor.deleteEmbeddedDocuments("Item", [child.id]);
            }
            consumed += take;
            remaining -= take;
        }
        return consumed;
    }

    const uses = item.system?.uses;
    const qty = item.system?.quantity ?? 1;
    let consumed = 0;

    if (wholeUnit) {
        consumed = Math.min(amount, qty);
        if (qty - consumed > 0) {
            await item.update({ "system.quantity": qty - consumed });
        } else {
            await actor.deleteEmbeddedDocuments("Item", [item.id]);
        }
        return consumed;
    }

    // Items with charges (rations bundles, etc.)
    if (uses && uses.max > 0) {
        // DnD5e v5+: uses.spent exists, value = max - spent (read-only)
        // Legacy: uses.value is directly writable
        const isV5 = ("spent" in uses);
        const currentCharges = isV5 ? (uses.max - (uses.spent ?? 0)) : (uses.value ?? 0);

        if (currentCharges > 0) {
            consumed = Math.min(amount, currentCharges);
            const remaining = currentCharges - consumed;

            if (remaining <= 0 && qty > 1) {
                // Charges depleted: use next unit (decrement qty, reset charges)
                const resetUpdate = isV5
                    ? { "system.uses.spent": 0, "system.quantity": qty - 1 }
                    : { "system.uses.value": uses.max, "system.quantity": qty - 1 };
                await item.update(resetUpdate);
            } else if (remaining <= 0 && qty <= 1) {
                // Last unit, last charge: delete item
                await actor.deleteEmbeddedDocuments("Item", [item.id]);
            } else {
                const chargeUpdate = isV5
                    ? { "system.uses.spent": (uses.spent ?? 0) + consumed }
                    : { "system.uses.value": remaining };
                await item.update(chargeUpdate);
            }
            return consumed;
        }
        // No charges but qty > 0: reset charges and consume from next unit
        if (qty > 1) {
            const resetConsumeUpdate = isV5
                ? { "system.uses.spent": 1, "system.quantity": qty - 1 }
                : { "system.uses.value": uses.max - 1, "system.quantity": qty - 1 };
            await item.update(resetConsumeUpdate);
            return 1;
        }
        // qty <= 1 and no charges left: nothing to consume
        await actor.deleteEmbeddedDocuments("Item", [item.id]);
        return 0;
    }

    // Items with only quantity (no uses system)
    consumed = Math.min(amount, qty);
    if (qty - consumed > 0) {
        await item.update({ "system.quantity": qty - consumed });
    } else {
        await actor.deleteEmbeddedDocuments("Item", [item.id]);
    }
    return consumed;
}
