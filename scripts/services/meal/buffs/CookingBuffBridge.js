/**
 * Shared cooking abstraction bridge (ionrift-library). All of these degrade to
 * Respite's standalone behavior when the kernel predates the cooking namespace
 * (feature-detected, never required).
 */

import { MODULE_ID } from "../inventory/MealConstants.js";

/**
 * Active Effect changes from the shared cooking buff model, when present.
 * Returns null to signal "use Respite's local path". Only delegates on
 * dnd5e: the kernel returns an empty list off-system, where Respite's own
 * adapter may still produce changes. temp_hp is intentionally never
 * delegated because the kernel applies the formula verbatim (no roll) and
 * uses a different change mode than Respite's adapter.
 * @param {object} buff - Canonical buff descriptor.
 * @param {Actor|null} actor
 * @returns {object[]|null}
 */
export function cookingAeChanges(buff, actor) {
    const buffs = game.ionrift?.library?.cooking?.buffs;
    if (!buffs?.toActiveEffectChanges) return null;
    if (buff?.type === "temp_hp") return null;
    const systemId = game.ionrift?.respite?.adapter?.id ?? game.system?.id;
    if (systemId !== "dnd5e") return null;
    try {
        const out = buffs.toActiveEffectChanges(actor, buff);
        return Array.isArray(out) ? out : null;
    } catch {
        return null;
    }
}

/**
 * Respite's own Active Effect change generation (adapter, then literal
 * fallback). Used when the shared cooking model is unavailable.
 * @param {string} buffType
 * @param {object} params
 * @returns {object[]}
 */
export function localAeChanges(buffType, params) {
    const aeAdapter = game.ionrift?.respite?.adapter;
    if (aeAdapter) return aeAdapter.getActiveEffectChanges(buffType, params);
    if (buffType === "advantage") {
        const ab = (params.ability ?? "con").toLowerCase();
        return [{ key: `system.abilities.${ab}.save.roll.mode`, mode: CONST.ACTIVE_EFFECT_MODES.ADD, value: "1", priority: 20 }];
    }
    if (buffType === "resistance") {
        const dtype = String(params.damageType ?? "poison").toLowerCase();
        return [{ key: "system.traits.dr.value", mode: CONST.ACTIVE_EFFECT_MODES.ADD, value: dtype, priority: 20 }];
    }
    if (buffType === "temp_hp") {
        return [{ key: "system.attributes.hp.temp", mode: CONST.ACTIVE_EFFECT_MODES.OVERRIDE, value: String(params.value ?? 0), priority: 20 }];
    }
    return [];
}

/**
 * Whether an effect occupies the shared cooking buff slot. Matches EITHER
 * the kernel flag (`flags["ionrift-library"].cookingBuff`) OR Respite's
 * legacy `wellFed` flag, so Monstrous Feast and Respite share one
 * mutual-exclusion slot without breaking existing Well Fed cleanup.
 * @param {ActiveEffect|object} effect
 * @returns {boolean}
 */
export function isCookingSlotEffect(effect) {
    if (!effect) return false;
    if (effect.flags?.[MODULE_ID]?.wellFed === true) return true;
    const buffs = game.ionrift?.library?.cooking?.buffs;
    const ns = buffs?.COOKING_BUFF_FLAG_NAMESPACE ?? "ionrift-library";
    const flag = buffs?.COOKING_BUFF_FLAG ?? "cookingBuff";
    return effect.flags?.[ns]?.[flag] === true;
}

/**
 * Whether an Effect item occupies the shared cooking buff slot.
 * @param {Item|object} item
 * @returns {boolean}
 */
export function isCookingSlotItem(item) {
    if (!item) return false;
    // dnd5e represents cooking buffs exclusively as ActiveEffects, never Items.
    // isCookingSlotEffect handles AE cleanup. Returning false here prevents
    // inventory consumables (which carry wellFed metadata) from being
    // misidentified as active buff slots.
    const systemId = game.ionrift?.respite?.adapter?.id ?? game.system?.id;
    if (systemId === "dnd5e") return false;
    if (item.type === "consumable") return false;
    if (item.flags?.[MODULE_ID]?.wellFed === true) return true;
    const buffs = game.ionrift?.library?.cooking?.buffs;
    const ns = buffs?.COOKING_BUFF_FLAG_NAMESPACE ?? "ionrift-library";
    const flag = buffs?.COOKING_BUFF_FLAG ?? "cookingBuff";
    return item.flags?.[ns]?.[flag] === true;
}

/**
 * Whether an actor already occupies the shared cooking buff slot (AE or Effect item).
 * @param {Actor|object} actor
 * @returns {boolean}
 */
export function actorHasCookingSlot(actor) {
    return Boolean(
        actor?.effects?.some(e => isCookingSlotEffect(e))
        || actor?.items?.some(i => isCookingSlotItem(i))
    );
}

/**
 * Add the shared cooking slot flag onto an effect's flags object (in place)
 * alongside Respite's existing `wellFed` flag. No-op without the kernel.
 * @param {object} flags
 * @param {string} [slot]
 * @returns {object} the same flags object
 */
export function stampCookingSlotFlag(flags, slot) {
    const buffs = game.ionrift?.library?.cooking?.buffs;
    if (!buffs) return flags;
    const ns = buffs.COOKING_BUFF_FLAG_NAMESPACE;
    flags[ns] = {
        ...(flags[ns] ?? {}),
        [buffs.COOKING_BUFF_FLAG]: true,
        [buffs.COOKING_SLOT_FLAG]: slot ?? buffs.DEFAULT_COOKING_SLOT
    };
    return flags;
}
