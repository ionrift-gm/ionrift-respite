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
 */
export async function grantMealItem(actor, itemData, slotRef) {
    const ledger = activeGrantLedger();
    const slotKey = GrantLedger.mealSlotKey(actor.id, slotRef);
    const qty = itemData.system?.quantity ?? 1;
    const grant = [{
        name: itemData.name,
        type: itemData.type ?? "loot",
        img: itemData.img ?? "icons/svg/item-bag.svg",
        quantity: qty,
        system: { ...(itemData.system ?? {}), quantity: qty },
        flags: itemData.flags ?? {}
    }];
    guardEmbedItems(grant);
    const perform = () => ItemOutcomeHandler.grantItemsToActor(actor, grant);
    if (ledger) {
        await ledger.grantOnce(slotKey, perform);
    } else {
        await perform();
    }
}
