/**
 * Returns true if a Respite rest flow (long or short) is currently active.
 * Checks the module API, the short rest app reference (all clients), then world settings.
 * @returns {boolean}
 */
import { MODULE_ID } from "../../../data/moduleId.js";
function isRestActive() {
    // Primary: module API getter (set on GM during long rest)
    if (game.ionrift?.respite?.isRestActive) return true;

    // Short rest: activeShortRestApp is set on all clients via socket
    if (game.ionrift?.respite?.activeShortRestApp) return true;

    // Fallback: check persisted rest state in world settings
    try {
        const savedLong = game.settings.get(MODULE_ID, "activeRest");
        if (savedLong?.engine) return true;
        const savedShort = game.settings.get(MODULE_ID, "activeShortRest");
        if (savedShort?.timestamp) return true;
    } catch { /* settings not registered yet */ }

    return false;
}

/**
 * Injects lockdown CSS classes onto actor sheet elements for non-GM users.
 * Called from the renderActorSheet hooks in UiInjections.js.
 *
 * @param {Application} app - The actor sheet application.
 * @param {HTMLElement|jQuery} html - The rendered HTML.
 */
export function injectPlayerLockdownClasses(app, html) {
    if (game.user.isGM) return;

    const actor = app.actor ?? app.document;
    if (!actor || actor.type !== "character") return;

    const el = html instanceof HTMLElement ? html
        : html?.[0] instanceof HTMLElement ? html[0]
        : html?.get?.(0)
        ?? app.element;
    if (!el) return;

    try {
        if (game.settings.get(MODULE_ID, "lockPlayerQuantity")) {
            el.classList.add("respite-lock-quantity");
        } else {
            el.classList.remove("respite-lock-quantity");
        }
    } catch { /* setting not registered yet */ }

    try {
        if (game.settings.get(MODULE_ID, "lockAttuneOutsideRest")) {
            if (!isRestActive()) {
                el.classList.add("respite-lock-attune");
            } else {
                el.classList.remove("respite-lock-attune");
            }
        } else {
            el.classList.remove("respite-lock-attune");
        }
    } catch { /* setting not registered yet */ }
}

/**
 * Registers the preUpdateItem hook that blocks restricted item updates
 * for non-GM users. Call once from the module ready block.
 */
export function registerLockdownHooks() {
    Hooks.on("preUpdateItem", (item, changes, options, userId) => {
        const user = game.users.get(userId);
        if (user?.isGM) return; // GMs always pass through

        if (changes?.system?.quantity !== undefined) {
            try {
                if (game.settings.get(MODULE_ID, "lockPlayerQuantity")) {
                    // Allow consumable use: dnd5e decrements quantity when a player uses
                    // a potion, ration, or other consumable. Blocking this prevents
                    // legitimate use. Only block quantity *increases* on any item type,
                    // or any quantity change on non-consumable items.
                    const isConsumable = item.type === "consumable";
                    const oldQty = item.system?.quantity ?? 0;
                    const newQty = changes.system.quantity;
                    const isDecrement = isConsumable && (newQty < oldQty);

                    if (!isDecrement) {
                        ui.notifications.warn("Item quantities are managed by the GM.");
                        return false;
                    }
                }
            } catch { /* setting not registered yet */ }
        }

        if (changes?.system?.attuned !== undefined) {
            try {
                if (game.settings.get(MODULE_ID, "lockAttuneOutsideRest")) {
                    if (!isRestActive()) {
                        ui.notifications.warn("Attunement can only be changed during a rest.");
                        return false;
                    }
                }
            } catch { /* setting not registered yet */ }
        }
    });
}
