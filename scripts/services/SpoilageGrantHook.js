/**
 * Applies spoilage cohort name suffixes and harvest stamps when perishable items
 * land on actor inventories outside ItemOutcomeHandler (compendium drag, direct create).
 */

import { CalendarHandler } from "./CalendarHandler.js";
import { ItemClassifier } from "./ItemClassifier.js";
import { SpoilageClock } from "./SpoilageClock.js";
import { isSpoilageNameSuffixEnabled } from "./SpoilageCohortSync.js";

function grantClock() {
    return {
        calendarDate: CalendarHandler.getCurrentDate(),
        worldTimeEpoch: game.time?.worldTime ?? 0
    };
}

function buildCreateItemLike(item, data) {
    return {
        name: data.name ?? item.name,
        type: data.type ?? item.type,
        system: foundry.utils.mergeObject(item.system ?? {}, data.system ?? {}, { inplace: false }),
        flags: foundry.utils.mergeObject(item.flags ?? {}, data.flags ?? {}, { inplace: false })
    };
}

function isPerishableLike(itemLike) {
    return ItemClassifier.getSpoilsAfter(itemLike) !== null
        || ItemClassifier.getSpoilsAfterHours(itemLike);
}

/**
 * Stamp harvest metadata and apply cohort suffix to pending actor item creation.
 * Safe to call when suffix setting is off (no-op).
 * @param {foundry.documents.Item} item
 * @param {object} data
 * @returns {boolean} Whether the create payload was modified
 */
export function prepareSpoilageGrantOnCreate(item, data) {
    if (!isSpoilageNameSuffixEnabled()) return false;

    const actor = item.parent;
    if (!actor || actor.documentName !== "Actor") return false;

    const itemLike = buildCreateItemLike(item, data);
    if (!isPerishableLike(itemLike)) return false;

    const respiteFlags = itemLike.flags?.[MODULE_ID] ?? {};
    if (respiteFlags.spoiled) return false;

    let modified = false;

    if (!respiteFlags.harvestedDate) {
        const harvestedDate = respiteFlags.spoilsAfterHours
            ? String(game.time.worldTime)
            : (CalendarHandler.getCurrentDate() ?? String(game.time.worldTime));
        item.updateSource({ [`flags.${MODULE_ID}.harvestedDate`]: harvestedDate });
        itemLike.flags = itemLike.flags ?? {};
        itemLike.flags[MODULE_ID] = { ...respiteFlags, harvestedDate };
        modified = true;
    }

    const grant = {
        name: itemLike.name,
        type: itemLike.type,
        system: itemLike.system,
        flags: itemLike.flags
    };
    const nameBefore = grant.name;
    SpoilageClock.applyGrantCohortName(grant, grantClock());

    if (grant.name !== nameBefore) {
        item.updateSource({ name: grant.name });
        modified = true;
    }

    return modified;
}

/**
 * preCreateItem hook: suffix perishables created on actor sheets when the setting is on.
 * @param {foundry.documents.Item} item
 * @param {object} data
 */
export function onPreCreateSpoilageGrant(item, data) {
    prepareSpoilageGrantOnCreate(item, data);
}

export function registerSpoilageGrantHook() {
    Hooks.on("preCreateItem", onPreCreateSpoilageGrant);
}
