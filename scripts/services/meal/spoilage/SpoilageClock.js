/**
 * SpoilageClock
 * Single source for calendar/Epoch days-until-spoil (matches inventory badges)
 * and stack/consume ordering for perishable ionrift-respite items.
 */

import { stripSpoilageCohortSuffix } from "../../../../../ionrift-library/scripts/services/cooking/CookingClassifier.js";
import { CalendarHandler } from "../../rest/session/CalendarHandler.js";
import { ItemClassifier } from "../../party/ItemClassifier.js";
import { MODULE_ID } from "../../../data/moduleId.js";

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
            const harvestKey = String(harvested);
            if (harvestKey.includes("-")) {
                if (calendarDate) {
                    const daysPassed = this.dateDiffDays(harvestKey, calendarDate);
                    daysLeft = Math.max(0, spoilsAfter - daysPassed);
                }
                // Calendar key without an active calendar clock: treat as freshly harvested.
            } else {
                const harvestedEpoch = parseInt(harvestKey, 10);
                if (!Number.isNaN(harvestedEpoch)) {
                    const daysPassed = Math.floor((worldTimeEpoch - harvestedEpoch) / 86400);
                    daysLeft = Math.max(0, spoilsAfter - daysPassed);
                }
            }
        }

        return daysLeft;
    }

    /**
     * Inventory badge content for spoilage indicators (days or hours).
     * @param {foundry.documents.Item|object} itemLike
     * @param {object} [clock]
     * @returns {{ text: string, tooltip: string, stateClass: string } | null}
     */
    static getSpoilageBadgeState(itemLike, clock = {}) {
        const daysLeft = this.getCalendarDaysRemaining(itemLike, clock);
        if (daysLeft !== null) {
            if (daysLeft <= 0) {
                return {
                    text: "SPOILED",
                    tooltip: "This food has gone off.",
                    stateClass: "spoil-expired"
                };
            }
            if (daysLeft === 1) {
                return {
                    text: "1d",
                    tooltip: "Spoils within a day. Eat or cook it.",
                    stateClass: "spoil-urgent"
                };
            }
            return {
                text: `${daysLeft}d`,
                tooltip: `${daysLeft} days until spoilage.`,
                stateClass: "spoil-fresh"
            };
        }

        const hoursLeft = this.getHoursRemaining(itemLike, clock);
        if (hoursLeft === null) return null;

        if (hoursLeft <= 0) {
            return {
                text: "SPOILED",
                tooltip: "This food has gone off.",
                stateClass: "spoil-expired"
            };
        }

        const displayHours = Math.ceil(hoursLeft);
        if (displayHours <= 1) {
            return {
                text: displayHours < 1 ? "<1h" : "1h",
                tooltip: "Spoils within an hour. Eat it soon.",
                stateClass: "spoil-urgent"
            };
        }

        return {
            text: `${displayHours}h`,
            tooltip: `${displayHours} hours until spoilage.`,
            stateClass: displayHours <= 2 ? "spoil-urgent" : "spoil-fresh"
        };
    }

    /**
     * @param {foundry.documents.Item|object} itemLike
     * @param {object} [clock]
     * @returns {number|null}
     */
    static getHoursRemaining(itemLike, clock = {}) {
        const spoilsHours = ItemClassifier.getSpoilsAfterHours(itemLike);
        if (!spoilsHours) return null;

        const flags = itemLike.flags?.[MODULE_ID] ?? {};
        if (flags.spoiled) return 0;

        const { worldTimeEpoch } = this._resolveClock(clock);
        const harvested = flags.harvestedDate;
        if (!harvested) return spoilsHours;

        const harvestedEpoch = parseInt(harvested, 10);
        if (Number.isNaN(harvestedEpoch)) return spoilsHours;

        const hoursPassed = (worldTimeEpoch - harvestedEpoch) / 3600;
        return Math.max(0, spoilsHours - hoursPassed);
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

    /**
     * Cohort label for perishable item names, aligned with badge text (e.g. "3d", "1h", "<1h").
     * @param {foundry.documents.Item|object} itemLike
     * @param {object} [clock]
     * @returns {string|null}
     */
    static formatCohortSuffixLabel(itemLike, clock = {}) {
        const daysLeft = this.getCalendarDaysRemaining(itemLike, clock);
        if (daysLeft !== null) {
            if (daysLeft <= 0) return null;
            return daysLeft === 1 ? "1d" : `${daysLeft}d`;
        }

        const hoursLeft = this.getHoursRemaining(itemLike, clock);
        if (hoursLeft === null || hoursLeft <= 0) return null;

        const displayHours = Math.ceil(hoursLeft);
        if (displayHours <= 1) return displayHours < 1 ? "<1h" : "1h";
        return `${displayHours}h`;
    }

    /**
     * Display name with a cohort suffix reflecting current days/hours remaining.
     * Returns the base name alone when no live suffix applies (shelf-stable, spoiled, expired).
     * @param {foundry.documents.Item|object} itemLike
     * @param {object} [clock]
     * @returns {string|null}
     */
    static buildSyncedCohortName(itemLike, clock = {}) {
        if (!itemLike?.name) return null;

        const flags = itemLike.flags?.[MODULE_ID] ?? {};
        if (flags.spoiled) return null;

        const label = this.formatCohortSuffixLabel(itemLike, clock);
        const baseName = stripSpoilageCohortSuffix(itemLike.name);
        if (!label) return baseName;
        return `${baseName} (${label})`;
    }

    /**
     * Append a cohort suffix to a perishable grant so incompatible stacks stay distinct.
     * Shelf-stable and spoiled rows are left unchanged.
     * @param {{ name?: string, flags?: object }} grant
     * @param {object} [clock]
     */
    static applyGrantCohortName(grant, clock = {}) {
        if (!grant?.name) return;

        const itemLike = {
            name: grant.name,
            type: grant.type,
            system: grant.system,
            flags: grant.flags ?? {}
        };
        const synced = this.buildSyncedCohortName(itemLike, clock);
        if (synced) grant.name = synced;
    }

    /**
     * Item update payload when the stored name should reflect current spoilage countdown.
     * @param {foundry.documents.Item|object} itemLike
     * @param {object} [clock]
     * @returns {{ name: string } | null}
     */
    static buildCohortSuffixSyncUpdate(itemLike, clock = {}) {
        if (!itemLike?.name) return null;

        const synced = this.buildSyncedCohortName(itemLike, clock);
        if (!synced || synced === itemLike.name) return null;
        return { name: synced };
    }
}
