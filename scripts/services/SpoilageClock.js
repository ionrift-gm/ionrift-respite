/**
 * SpoilageClock
 * Single source for calendar/Epoch days-until-spoil (matches inventory badges)
 * and stack/consume ordering for perishable ionrift-respite items.
 */

import { CalendarHandler } from "./CalendarHandler.js";
import { ItemClassifier } from "./ItemClassifier.js";

const MODULE_ID = "ionrift-respite";

export class SpoilageClock {

    /**
     * Difference in whole days between date strings (Y-M-D segments).
     * Same convention as legacy MealPhaseHandler._dateDiffDays.
     * @param {string} dateA - Earlier harvest key
     * @param {string} dateB - Current calendar key
     */
    static dateDiffDays(dateA, dateB) {
        try {
            const partsA = dateA.split("-").map(Number);
            const partsB = dateB.split("-").map(Number);
            const a = new Date(partsA[0], partsA[1], partsA[2]);
            const b = new Date(partsB[0], partsB[1], partsB[2]);
            return Math.floor((b - a) / 86400000);
        } catch {
            return 0;
        }
    }

    /**
     * @param {object} [clock]
     * @param {string|null} [clock.calendarDate]
     * @param {number} [clock.worldTimeEpoch]
     */
    static _resolveClock(clock = {}) {
        const calendarDate = clock.calendarDate !== undefined
            ? clock.calendarDate
            : CalendarHandler.getCurrentDate();
        const worldTimeEpoch = clock.worldTimeEpoch !== undefined
            ? clock.worldTimeEpoch
            : (typeof game !== "undefined" ? game.time.worldTime : 0);
        return { calendarDate, worldTimeEpoch };
    }

    /**
     * Days remaining before spoilage (badge math). Shelf-stable items return null.
     * @param {foundry.documents.Item|object} itemLike - Item or plain { name?, flags? }
     * @param {object} [clock] - Optional overrides for tests / headless contexts
     * @returns {number|null}
     */
    static getCalendarDaysRemaining(itemLike, clock = {}) {
        const spoilsAfter = ItemClassifier.getSpoilsAfter(itemLike);
        if (spoilsAfter === null || spoilsAfter <= 0) return null;

        const flags = itemLike.flags?.[MODULE_ID] ?? {};
        if (flags.spoiled) return 0;

        const { calendarDate, worldTimeEpoch } = this._resolveClock(clock);

        let daysLeft = spoilsAfter;
        const harvested = flags.harvestedDate;
        if (harvested) {
            if (calendarDate && String(harvested).includes("-")) {
                const daysPassed = this.dateDiffDays(harvested, calendarDate);
                daysLeft = Math.max(0, spoilsAfter - daysPassed);
            } else {
                const harvestedEpoch = parseInt(harvested, 10);
                if (!Number.isNaN(harvestedEpoch)) {
                    const daysPassed = Math.floor((worldTimeEpoch - harvestedEpoch) / 86400);
                    daysLeft = Math.max(0, spoilsAfter - daysPassed);
                }
            }
        }

        return daysLeft;
    }

    /**
     * Two rows may stack only if both are shelf-stable or both perishable with the same days remaining.
     * @param {foundry.documents.Item|object} itemA
     * @param {foundry.documents.Item|object} itemB
     * @param {object} [clock]
     */
    static areStacksCompatible(itemA, itemB, clock = {}) {
        const da = this.getCalendarDaysRemaining(itemA, clock);
        const db = this.getCalendarDaysRemaining(itemB, clock);
        if (da === null && db === null) return true;
        if (da === null || db === null) return false;
        return da === db;
    }

    /**
     * Lower key is consumed first (soonest spoilage). Shelf-stable sorts last.
     * @param {foundry.documents.Item|object} itemLike
     * @param {object} [clock]
     */
    static getConsumeSortKey(itemLike, clock = {}) {
        const rem = this.getCalendarDaysRemaining(itemLike, clock);
        if (rem === null) return 1_000_000;
        return rem;
    }
}
