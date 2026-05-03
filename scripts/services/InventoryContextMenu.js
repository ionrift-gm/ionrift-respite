/**
 * InventoryContextMenu
 * Hooks into dnd5e.getItemContextOptions to add diet-aware "Consume" entries
 * for food and water items on actor sheets. Available any time Respite is
 * installed; applies Well Fed buffs via the existing exclusive-slot pattern
 * (prior AE is removed before new one is created, preventing double-buffing).
 *
 * When a rest is active, consumption is synchronized into the RestSetupApp's
 * _mealChoices map so the rations UI stays in lockstep. The snapshot is
 * broadcast to all clients via the existing socket pattern.
 *
 * Item classification and diet filtering are delegated to ItemClassifier.
 * Consumption mechanics (charges, quantity, deletion) are delegated to
 * MealPhaseHandler._consumeItem.
 */

import { ItemClassifier } from "./ItemClassifier.js";
import { MealPhaseHandler } from "./MealPhaseHandler.js";

const MODULE_ID = "ionrift-respite";

/**
 * Register the dnd5e inventory context menu hook.
 * Call once from the module ready block.
 */
export function registerInventoryContextMenu() {
    Hooks.on("dnd5e.getItemContextOptions", (item, menuItems) => {
        const actor = item.parent;
        if (!actor || actor.type !== "character") return;

        // Check party membership — only show for rostered characters
        try {
            const libParty = game.ionrift?.library?.party;
            if (libParty) {
                const rosterIds = libParty.getRosterIds();
                if (rosterIds.length && !libParty.isRostered(actor.id)) return;
            } else {
                const roster = game.settings.get(MODULE_ID, "partyRoster") ?? [];
                if (roster.length && !roster.includes(actor.id)) return;
            }
        } catch { /* setting not yet registered */ }

        const isEdible = ItemClassifier.isFood(item, actor);
        const isDrinkable = ItemClassifier.isWater(item, actor);
        if (!isEdible && !isDrinkable) return;

        const hasStock = () => {
            const qty = item.system?.quantity ?? 0;
            const uses = item.system?.uses;
            if (qty > 0) return true;
            if (uses && (uses.value ?? (uses.max - (uses.spent ?? 0))) > 0) return true;
            return false;
        };

        if (isDrinkable) {
            menuItems.push({
                name: "Drink",
                icon: `<i class="fas fa-tint respite-context-icon"></i>`,
                group: "action",
                condition: hasStock,
                callback: async () => _consumeFromInventory(actor, item, false)
            });
        }

        if (isEdible && !isDrinkable) {
            menuItems.push({
                name: "Eat",
                icon: `<i class="fas fa-utensils respite-context-icon"></i>`,
                group: "action",
                condition: hasStock,
                callback: async () => _consumeFromInventory(actor, item, true)
            });
        }
    });
}

/**
 * Consume one unit of a food/water item from inventory.
 * If the item carries Well Fed flags, applies the buff via the existing
 * exclusive-slot pattern (removes prior Well Fed AE first).
 *
 * After consumption, syncs the change into the active rest's meal tracking
 * (if a rest is running) so the rations UI stays in lockstep.
 *
 * @param {Actor} actor - The consuming character
 * @param {Item} item - The food/water item
 * @param {boolean} isFood - true for food, false for water
 */
async function _consumeFromInventory(actor, item, isFood) {
    // Snapshot the item data before consumption (for Well Fed resolution)
    const itemSnapshot = item.toObject(false);
    const itemName = item.name;
    const itemId = item.id;

    const consumed = await MealPhaseHandler._consumeItem(actor, itemId, 1);
    if (consumed <= 0) {
        ui.notifications.warn(`${itemName} could not be consumed.`);
        return;
    }

    const verb = isFood ? "eats" : "drinks from";
    const icon = isFood ? "fa-utensils" : "fa-tint";

    // Check for Well Fed buff and apply if present
    const flags = itemSnapshot.flags?.[MODULE_ID] ?? {};
    let buffLines = [];
    if (flags.wellFed === true && flags.buff !== null) {
        buffLines = await MealPhaseHandler._applyWellFedEffect(actor, itemSnapshot);
    }

    // Build chat content
    const buffSummary = buffLines.length
        ? `<p class="respite-well-fed-summary"><i class="fas fa-star"></i> <em>Well Fed:</em> ${buffLines.join("; ")}</p>`
        : "";

    await ChatMessage.create({
        content: `<div class="respite-recovery-chat">
            <p><i class="fas ${icon}"></i> <strong>${actor.name}</strong> ${verb} <strong>${itemName}</strong>.</p>
            ${buffSummary}
        </div>`,
        speaker: ChatMessage.getSpeaker({ actor })
    });

    // ── Sync with active rest's meal tracking ──────────────────────────
    await _syncWithRestMealState(actor, itemId, isFood, itemSnapshot);

    // Re-render the actor sheet to reflect updated quantity
    actor.sheet?.render(false);
}

/**
 * Synchronize an inventory consumption event with the active rest's meal
 * tracking state. Fills the first empty food/water slot in _mealChoices,
 * saves the rest state, and broadcasts a snapshot so all clients (GM + players)
 * see the updated rations UI.
 *
 * No-ops gracefully when no rest is active.
 *
 * @param {Actor} actor - The consuming character
 * @param {string} itemId - ID of the consumed item
 * @param {boolean} isFood - true for food slot, false for water slot
 * @param {object} [itemSnapshot] - Item data snapshot for satiates cross-crediting
 */
async function _syncWithRestMealState(actor, itemId, isFood, itemSnapshot) {
    const restApp = game.ionrift?.respite?.getActiveApp?.();
    if (!restApp) return;

    const charId = actor.id;
    const slot = isFood ? "food" : "water";

    // Ensure _mealChoices map exists
    if (!restApp._mealChoices) restApp._mealChoices = new Map();

    const existing = restApp._mealChoices.get(charId) ?? {};
    const arr = Array.isArray(existing[slot]) ? [...existing[slot]] : [];

    // Fill the first empty slot with this item
    const emptyIdx = arr.findIndex(v => !v || v === "skip");
    let filledIdx;
    if (emptyIdx >= 0) {
        arr[emptyIdx] = itemId;
        filledIdx = emptyIdx;
    } else {
        filledIdx = arr.length;
        arr.push(itemId);
    }

    // Mark this slot as locked — the item has already been consumed from
    // inventory and cannot be removed or swapped in the rations UI.
    const lockedKey = slot === "food" ? "foodLockedSlots" : "waterLockedSlots";
    const lockedArr = Array.isArray(existing[lockedKey]) ? [...existing[lockedKey]] : [];
    if (!lockedArr.includes(filledIdx)) lockedArr.push(filledIdx);

    restApp._mealChoices.set(charId, { ...existing, [slot]: arr, [lockedKey]: lockedArr });

    // ── Satiates cross-credit: if the item satiates both food AND water,
    //    fill + lock the OTHER slot too so the player doesn't need a separate item. ──
    const flags = itemSnapshot?.flags?.[MODULE_ID] ?? {};
    const satiates = Array.isArray(flags.satiates) ? flags.satiates : [];
    const crossSlot = isFood ? "water" : "food";
    if (satiates.includes(crossSlot)) {
        const updated = restApp._mealChoices.get(charId) ?? {};
        const crossArr = Array.isArray(updated[crossSlot]) ? [...updated[crossSlot]] : [];
        const crossLockedKey = crossSlot === "food" ? "foodLockedSlots" : "waterLockedSlots";
        const crossLocked = Array.isArray(updated[crossLockedKey]) ? [...updated[crossLockedKey]] : [];
        const crossEmpty = crossArr.findIndex(v => !v || v === "skip");
        const crossIdx = crossEmpty >= 0 ? crossEmpty : crossArr.length;
        crossArr[crossIdx] = `__satiated_${crossSlot}`;
        if (!crossLocked.includes(crossIdx)) crossLocked.push(crossIdx);
        restApp._mealChoices.set(charId, { ...updated, [crossSlot]: crossArr, [crossLockedKey]: crossLocked });
    }

    // NOTE: Do NOT mark _activityMealRationsSubmitted here.
    // Eating from inventory fills ONE slot (food or water) but does not
    // constitute a full ration submission. The player still needs to
    // complete the other slot and explicitly submit via the station UI.

    // Persist state and broadcast
    try {
        if (typeof restApp._saveRestState === "function") {
            await restApp._saveRestState();
        }
    } catch (e) {
        console.warn(`${MODULE_ID} | InventoryContextMenu: failed to save rest state after sync:`, e);
    }

    // Broadcast updated snapshot to all clients
    try {
        const snapshot = typeof restApp.getRestSnapshot === "function"
            ? restApp.getRestSnapshot()
            : null;
        if (snapshot) {
            game.socket.emit(`module.${MODULE_ID}`, {
                type: "restSnapshot",
                snapshot
            });
        }
    } catch (e) {
        console.warn(`${MODULE_ID} | InventoryContextMenu: failed to broadcast snapshot:`, e);
    }

    // Notify station dialogs and re-render the rest app
    try {
        Hooks.callAll(`${MODULE_ID}.stationMealChoicesTouched`);
    } catch { /* noop */ }

    try {
        if (typeof restApp._refreshStationOverlayMeals === "function") {
            restApp._refreshStationOverlayMeals();
        }
    } catch { /* noop */ }

    if (restApp.rendered) {
        restApp.render();
    }
}
