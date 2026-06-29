/**
 * Keeps spoilage cohort name suffixes aligned with live countdown when the setting is on.
 */

import { CalendarHandler } from "./CalendarHandler.js";
import { ItemClassifier } from "./ItemClassifier.js";
import { SpoilageClock } from "./SpoilageClock.js";

const MODULE_ID = "ionrift-respite";

/** Passed to item updates so hooks can skip re-entrant sync. */
export const COHORT_SUFFIX_SYNC_OPTION = { ionriftCohortSuffixSync: true };

let _syncInProgress = false;

export function isSpoilageNameSuffixEnabled() {
    try {
        return game.settings.get(MODULE_ID, "spoilageNameSuffix") === true;
    } catch {
        return false;
    }
}

function grantClock(clock = {}) {
    return {
        calendarDate: clock.calendarDate !== undefined
            ? clock.calendarDate
            : CalendarHandler.getCurrentDate(),
        worldTimeEpoch: clock.worldTimeEpoch !== undefined
            ? clock.worldTimeEpoch
            : (game.time?.worldTime ?? 0)
    };
}

function isPerishableLike(itemLike) {
    return ItemClassifier.getSpoilsAfter(itemLike) !== null
        || ItemClassifier.getSpoilsAfterHours(itemLike);
}

/**
 * @param {Actor} actor
 * @param {object} [clock]
 * @returns {Promise<boolean>} Whether any item names were updated
 */
export async function syncActorCohortSuffixes(actor, clock = {}) {
    if (!actor || _syncInProgress || !isSpoilageNameSuffixEnabled()) return false;

    const resolvedClock = grantClock(clock);
    const updates = [];

    for (const item of actor.items) {
        if (!isPerishableLike(item)) continue;

        const flags = item.flags?.[MODULE_ID] ?? {};
        if (flags.spoiled) continue;

        const syncUpdate = SpoilageClock.buildCohortSuffixSyncUpdate(item, resolvedClock);
        if (syncUpdate) {
            updates.push({ _id: item.id, ...syncUpdate });
        }
    }

    if (!updates.length) return false;

    _syncInProgress = true;
    try {
        await actor.updateEmbeddedDocuments("Item", updates, COHORT_SUFFIX_SYNC_OPTION);
        return true;
    } finally {
        _syncInProgress = false;
    }
}

/**
 * @param {Actor[]} actors
 * @param {object} [clock]
 * @returns {Promise<boolean>}
 */
export async function syncPartyCohortSuffixes(actors, clock = {}) {
    if (!actors?.length || !isSpoilageNameSuffixEnabled()) return false;

    let anyUpdated = false;
    for (const actor of actors) {
        if (await syncActorCohortSuffixes(actor, clock)) anyUpdated = true;
    }
    return anyUpdated;
}

/**
 * GM-only: sync suffixes when a character sheet opens so names match badges.
 * @param {Actor} actor
 */
export async function syncCohortSuffixesOnSheetRender(actor) {
    if (!game.user.isGM || !actor) return;
    await syncActorCohortSuffixes(actor);
}
