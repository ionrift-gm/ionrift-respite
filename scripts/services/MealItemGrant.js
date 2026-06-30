/**
 * Idempotent item grant for meal-phase inventory changes. Routes through the
 * active rest's GrantLedger when present so retries do not double-grant.
 */

import { guardEmbedItems } from "./MintGuard.js";
import { GrantLedger } from "./GrantLedger.js";
import { ItemOutcomeHandler } from "./ItemOutcomeHandler.js";

function activeGrantLedger() {
    return game.ionrift?.respite?.getActiveApp?.()?._grantLedger ?? null;
}

/**
 * Idempotent item grant for meal-phase inventory changes.
 * @param {Actor} actor
 * @param {object} itemData
 * @param {string} slotRef
 * @param {{ separateItem?: boolean }} [opts]
 *   When separateItem is true, always creates a new inventory row (packed
 *   leftovers) instead of stacking onto an existing row with the same name.
 */
export async function grantMealItem(actor, itemData, slotRef, opts = {}) {
    const ledger = activeGrantLedger();
    const separateItem = opts.separateItem === true;
    const qty = itemData.system?.quantity ?? 1;
    const itemDoc = {
        name: itemData.name,
        type: itemData.type ?? "loot",
        img: itemData.img ?? "icons/svg/item-bag.svg",
        system: { ...(itemData.system ?? {}), quantity: qty },
        flags: itemData.flags ?? {}
    };
    const grant = [{ ...itemDoc, quantity: qty }];
    guardEmbedItems(grant);
    const perform = () => {
        if (separateItem) {
            return actor.createEmbeddedDocuments("Item", [itemDoc]);
        }
        return ItemOutcomeHandler.grantItemsToActor(actor, grant);
    };
    if (ledger) {
        const slotKey = separateItem
            ? GrantLedger.mealSlotKey(actor.id, `${slotRef}:leftover:${foundry.utils.randomID()}`)
            : GrantLedger.mealSlotKey(actor.id, slotRef);
        await ledger.grantOnce(slotKey, perform);
    } else {
        await perform();
    }
}
