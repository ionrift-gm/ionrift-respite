/**
 * CalendarHandler
 * Centralizes all calendar interactions behind a stable adapter interface.
 * Supports Simple Calendar, Calendaria (by 3 Death Saves),
 * and Simple Timekeeping (by TheRipper93).
 * Additional providers can be added by extending detection and API mapping.
 */

import { MODULE_ID } from "../../../data/moduleId.js";

/** Check if either Simple Calendar variant is active */
function _isSimpleCalendarActive() {
    return (game.modules.get("foundryvtt-simple-calendar")?.active
         || game.modules.get("foundryvtt-simple-calendar-reborn")?.active)
        && typeof SimpleCalendar !== "undefined";
}

/** Check if Calendaria is active */
function _isCalendariaActive() {
    return game.modules.get("calendaria")?.active
        && typeof CALENDARIA !== "undefined";
}

export class CalendarHandler {

    /**
     * Returns true if a supported calendar module or core Foundry game.time is active.
     * @returns {boolean}
     */
    static isAvailable() {
        if (_isSimpleCalendarActive()) {
            return true;
        }
        if (_isCalendariaActive()) {
            return true;
        }
        if (game.modules.get("simple-timekeeping")?.active) {
            return true;
        }
        if (typeof game !== "undefined" && game.time) {
            return true;
        }
        return false;
    }

    /**
     * Advances in-game world time based on rest type (long = 8h, short = 1h).
     * @param {string} [restType="long"]
     * @returns {Promise<void>}
     */
    static async advanceRestTime(restType = "long") {
        if (!game.user?.isGM) return;
        const hours = restType === "short" ? 1 : 8;
        try {
            if (_isCalendariaActive() && typeof CALENDARIA.api.advanceTime === "function") {
                await CALENDARIA.api.advanceTime({ hour: hours });
                return;
            }
            const seconds = hours * 3600;
            if (typeof game.time?.advance === "function") {
                await game.time.advance(seconds);
            }
        } catch (e) {
            console.warn(`${MODULE_ID} | CalendarHandler.advanceRestTime failed:`, e);
        }
    }

    /**
     * Returns a string date key for the current in-game date, or null if unavailable.
     * @returns {string|null} e.g. "1-3-15" (year-month-day)
     */
    static getCurrentDate() {
        try {
            if (_isSimpleCalendarActive()) {
                const dt = SimpleCalendar.api.currentDateTime();
                return `${dt.year}-${dt.month}-${dt.day}`;
            }
            if (_isCalendariaActive()) {
                const dt = CALENDARIA.api.getCurrentDateTime();
                return `${dt.year}-${dt.month}-${dt.day}`;
            }
            if (game.modules.get("simple-timekeeping")?.active && game.time?.components) {
                const tc = game.time.components;
                return `${tc.year}-${tc.month}-${tc.day}`;
            }
            if (game.time?.components) {
                const tc = game.time.components;
                return `${tc.year}-${tc.month}-${tc.day}`;
            }
        } catch (e) {
            console.warn(`${MODULE_ID} | CalendarHandler.getCurrentDate failed:`, e);
        }
        return null;
    }

    /**
     * Returns an end-user-readable formatted date string, or null if unavailable.
     * Used for chat messages and UI display.
     * @returns {string|null}
     */
    static getFormattedDate() {
        try {
            if (_isSimpleCalendarActive()) {
                const dt = SimpleCalendar.api.currentDateTime();
                const monthName = SimpleCalendar.api.getCurrentMonth?.()?.name;
                if (monthName) {
                    return `Day ${dt.day + 1} of ${monthName}, Year ${dt.year}`;
                }
                return `Day ${dt.day + 1}, Month ${dt.month + 1}, Year ${dt.year}`;
            }
            if (_isCalendariaActive()) {
                if (typeof CALENDARIA.api.formatDate === "function") {
                    return CALENDARIA.api.formatDate(null, "dateLong");
                }
                // Calendaria uses 1-indexed month/day — no +1 needed
                const dt = CALENDARIA.api.getCurrentDateTime();
                return `Day ${dt.day}, Month ${dt.month}, Year ${dt.year}`;
            }
            if (game.modules.get("simple-timekeeping")?.active && game.time?.components) {
                const tc = game.time.components;
                return `Day ${tc.day + 1}, Month ${tc.month + 1}, Year ${tc.year}`;
            }
            if (game.time?.components) {
                const tc = game.time.components;
                return `Day ${tc.day + 1}, Month ${tc.month + 1}, Year ${tc.year}`;
            }
        } catch (e) {
            console.warn(`${MODULE_ID} | CalendarHandler.getFormattedDate failed:`, e);
        }
        return null;
    }

    /**
     * Checks if the party has already rested on the current in-game day.
     * @returns {boolean} true if a rest has already been recorded today.
     */
    static hasRestedToday() {
        if (!this.isAvailable()) return false;
        try {
            const today = this.getCurrentDate();
            if (!today) return false;
            const lastRest = game.settings.get(MODULE_ID, "lastRestDate");
            return lastRest === today;
        } catch (e) {
            console.warn(`${MODULE_ID} | CalendarHandler.hasRestedToday failed:`, e);
            return false;
        }
    }

    /**
     * Records the current date as the last rest date and posts a chat announcement.
     * @returns {Promise<void>}
     */
    static async recordRestDate() {
        if (!this.isAvailable()) return;
        try {
            const dateKey = this.getCurrentDate();
            if (!dateKey) return;

            await game.settings.set(MODULE_ID, "lastRestDate", dateKey);

            const formatted = this.getFormattedDate();
            const dateDisplay = formatted ?? dateKey;
            await ChatMessage.create({
                content: `<p><i class="fas fa-campground"></i> <strong>Rest Complete</strong></p>
                          <p>The party rests. (${dateDisplay})</p>`,
                speaker: { alias: "Respite" },
                flags: { [MODULE_ID]: { type: "calendarRest" } }
            });
        } catch (e) {
            console.warn(`${MODULE_ID} | CalendarHandler.recordRestDate failed:`, e);
        }
    }
}
