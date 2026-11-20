import { MODULE_ID } from "../../../data/moduleId.js";

/** Feature identifiers that let a character swap prepared spells on a short rest (2024 Wizard). */
const SHORT_REST_SPELL_SWAP_IDENTIFIERS = new Set(["memorize-spell"]);
const SHORT_REST_SPELL_SWAP_NAMES = new Set(["memorize spell"]);

const REST_STATE_SETTING_KEYS = ["activeRest", "activeShortRest", "activeGrittyRest"];

function readSetting(key) {
    try {
        return game.settings.get(MODULE_ID, key);
    } catch {
        return null;
    }
}

/**
 * Returns true if a Respite rest flow (long or short) is currently active.
 * Checks the module API, the short rest app reference (all clients), then world settings.
 * @returns {boolean}
 */
function isRestActive() {
    // Primary: module API getter (set on GM during long rest)
    if (game.ionrift?.respite?.isRestActive) return true;

    // Short rest: activeShortRestApp is set on all clients via socket
    if (game.ionrift?.respite?.activeShortRestApp) return true;

    // Fallback: check persisted rest state in world settings
    if (readSetting("activeRest")?.engine) return true;
    if (readSetting("activeShortRest")?.timestamp) return true;
    if (readSetting("activeGrittyRest")?.type) return true;

    return false;
}

/**
 * True while a long rest is in progress. Reads the persisted world state so the
 * answer matches on player clients, where the runtime flag is not set.
 * Gritty "downtime" is the long rest; gritty "bivouac" counts as a short rest.
 * @returns {boolean}
 */
export function isLongRestActive() {
    const savedLong = readSetting("activeRest");
    if (savedLong?.engine && savedLong.selectedRestType !== "short") return true;
    return readSetting("activeGrittyRest")?.type === "downtime";
}

/**
 * True while a short rest is in progress (standard, gritty bivouac, or a
 * short rest started from the rest setup flow).
 * @returns {boolean}
 */
export function isShortRestActive() {
    if (game.ionrift?.respite?.activeShortRestApp) return true;
    if (readSetting("activeShortRest")?.timestamp) return true;
    if (readSetting("activeGrittyRest")?.type === "bivouac") return true;
    const savedLong = readSetting("activeRest");
    return !!(savedLong?.engine && savedLong.selectedRestType === "short");
}

/**
 * @param {Actor} actor
 * @returns {boolean} True when the actor has a feature that allows short rest spell swaps.
 */
export function actorCanSwapSpellsOnShortRest(actor) {
    const items = actor?.items ?? [];
    for (const item of items) {
        if (item?.type !== "feat") continue;
        const identifier = String(item.system?.identifier ?? "").toLowerCase();
        if (SHORT_REST_SPELL_SWAP_IDENTIFIERS.has(identifier)) return true;
        const name = String(item.name ?? "").trim().toLowerCase();
        if (SHORT_REST_SPELL_SWAP_NAMES.has(name)) return true;
    }
    return false;
}

/**
 * Whether the actor may change prepared spells right now under the
 * spell preparation lock.
 * @param {Actor} actor
 * @returns {boolean}
 */
export function canChangeSpellPrepNow(actor) {
    if (isLongRestActive()) return true;
    return isShortRestActive() && actorCanSwapSpellsOnShortRest(actor);
}

/**
 * Reads the prepared value out of an update diff. Covers dnd5e 5.x
 * (`system.prepared`) and older versions (`system.preparation.prepared`).
 * @param {object} changes
 * @returns {{ path: string, value: * }|null}
 */
export function readPreparedChange(changes) {
    const system = changes?.system;
    if (!system || typeof system !== "object") return null;
    if (Object.hasOwn(system, "prepared")) {
        return { path: "system.prepared", value: system.prepared };
    }
    const preparation = system.preparation;
    if (preparation && typeof preparation === "object" && Object.hasOwn(preparation, "prepared")) {
        return { path: "system.preparation.prepared", value: preparation.prepared };
    }
    return null;
}

function readCurrentPrepared(item, path) {
    return path === "system.prepared"
        ? item?.system?.prepared
        : item?.system?.preparation?.prepared;
}

/**
 * Decides whether a non-GM spell update should be blocked by the spell
 * preparation lock. Pure apart from the setting and rest state reads.
 * @param {Item} item
 * @param {object} changes
 * @returns {boolean}
 */
export function shouldBlockSpellPrepChange(item, changes) {
    if (game.system?.id && game.system.id !== "dnd5e") return false;
    if (item?.type !== "spell") return false;
    const actor = item.parent;
    if (!actor || actor.type !== "character") return false;
    if (!readSetting("lockSpellPrepOutsideRest")) return false;

    const change = readPreparedChange(changes);
    if (!change) return false;
    if (Number(change.value) === Number(readCurrentPrepared(item, change.path))) return false;

    return !canChangeSpellPrepNow(actor);
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

    const isDnd5e = !game.system?.id || game.system.id === "dnd5e";
    el.classList.toggle("respite-lock-quantity", !!readSetting("lockPlayerQuantity"));
    el.classList.toggle("respite-lock-attune", !!readSetting("lockAttuneOutsideRest") && !isRestActive());
    el.classList.toggle("respite-lock-spellprep",
        isDnd5e && !!readSetting("lockSpellPrepOutsideRest") && !canChangeSpellPrepNow(actor));
}

/** Re-renders open character sheets so lock classes follow rest start and end. */
function refreshOpenCharacterSheets() {
    if (game.user.isGM) return;
    const instances = foundry.applications?.instances;
    const apps = instances ? [...instances.values()] : Object.values(ui.windows ?? {});
    for (const app of apps) {
        const actor = app?.actor ?? app?.document;
        if (actor?.documentName !== "Actor" || actor.type !== "character") continue;
        if (app.rendered) app.render();
    }
}

let lastRestLockSignature = null;

function restLockSignature() {
    return `${isRestActive()}|${isLongRestActive()}|${isShortRestActive()}`;
}

function onRestStateSettingChanged(setting) {
    const key = String(setting?.key ?? "");
    if (!REST_STATE_SETTING_KEYS.some(k => key === `${MODULE_ID}.${k}`)) return;
    // Rest state saves often mid-rest; only re-render when the lock window flips.
    const signature = restLockSignature();
    if (signature === lastRestLockSignature) return;
    lastRestLockSignature = signature;
    refreshOpenCharacterSheets();
}

/**
 * Registers the preUpdateItem hook that blocks restricted item updates
 * for non-GM users. Call once from the module ready block.
 */
export function registerLockdownHooks() {
    Hooks.on("preUpdateItem", (item, changes, options, userId) => {
        const user = game.users.get(userId);
        if (user?.isGM) return; // GMs always pass through

        if (changes?.system?.quantity !== undefined && readSetting("lockPlayerQuantity")) {
            // Allow consumable use: dnd5e decrements quantity when a player uses
            // a potion, ration, or other consumable. Blocking this prevents
            // legitimate use. Only block quantity *increases* on any item type,
            // or any quantity change on non-consumable items.
            const isConsumable = item.type === "consumable";
            const oldQty = item.system?.quantity ?? 0;
            const newQty = changes.system.quantity;
            const isDecrement = isConsumable && (newQty < oldQty);

            if (!isDecrement) {
                ui.notifications.warn(game.i18n.localize("ionrift-respite.playerLockdown.warnItemQuantitiesManagedByGM"));
                return false;
            }
        }

        if (changes?.system?.attuned !== undefined && readSetting("lockAttuneOutsideRest") && !isRestActive()) {
            ui.notifications.warn(game.i18n.localize("ionrift-respite.playerLockdown.warnAttunementRestOnly"));
            return false;
        }

        const pf2eInvested = changes?.system?.equipped?.invested ?? changes?.["system.equipped.invested"];
        if (
            pf2eInvested !== undefined
            && Boolean(pf2eInvested) !== Boolean(item.system?.equipped?.invested)
            && readSetting("lockAttuneOutsideRest")
            && !isRestActive()
        ) {
            ui.notifications.warn(game.i18n.localize("ionrift-respite.playerLockdown.warnInvestmentRestOnly"));
            return false;
        }

        if (shouldBlockSpellPrepChange(item, changes)) {
            ui.notifications.warn(game.i18n.localize("ionrift-respite.playerLockdown.warnSpellPrepRestOnly"));
            return false;
        }
    });

    lastRestLockSignature = restLockSignature();
    Hooks.on("createSetting", onRestStateSettingChanged);
    Hooks.on("updateSetting", onRestStateSettingChanged);
}
