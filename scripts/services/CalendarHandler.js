/**
 * CalendarHandler
 * Centralizes all calendar interactions behind a stable adapter interface.
 * Supports Simple Calendar and Simple Timekeeping (by TheRipper93).
 * Additional providers can be added by extending detection and API mapping.
 */

const MODULE_ID = "ionrift-respite";

export class CalendarHandler {

    /**
     * Returns true if a supported calendar module is active.
     * @returns {boolean}
     */
    static isAvailable() {
        // Simple Calendar
        if (game.modules.get("foundryvtt-simple-calendar")?.active && typeof SimpleCalendar !== "undefined") {
            return true;
        }
        // Simple Timekeeping (TheRipper93) - uses core Foundry time API
        if (game.modules.get("simple-timekeeping")?.active) {
            return true;
        }
        return false;
    }

    /**
     * Returns a string date key for the current in-game date, or null if unavailable.
     * @returns {string|null} e.g. "1-3-15" (year-month-day)
     */
    static getCurrentDate() {
        try {
            if (game.modules.get("foundryvtt-simple-calendar")?.active && typeof SimpleCalendar !== "undefined") {
                const dt = SimpleCalendar.api.currentDateTime();
                return `${dt.year}-${dt.month}-${dt.day}`;
            }
            // Simple Timekeeping: uses game.time.components
            if (game.modules.get("simple-timekeeping")?.active && game.time?.components) {
                const tc = game.time.components;
                return `${tc.year}-${tc.month}-${tc.day}`;
            }
        } catch (e) {
            console.warn(`${MODULE_ID} | CalendarHandler.getCurrentDate failed:`, e);
        }
        return null;
    }

    /**
     * Returns a human-readable formatted date string, or null if unavailable.
     * Used for chat messages and UI display.
     * @returns {string|null}
     */
    static getFormattedDate() {
        try {
            if (game.modules.get("foundryvtt-simple-calendar")?.active && typeof SimpleCalendar !== "undefined") {
                const dt = SimpleCalendar.api.currentDateTime();
                const monthName = SimpleCalendar.api.getCurrentMonth?.()?.name;
                if (monthName) {
                    return `Day ${dt.day + 1} of ${monthName}, Year ${dt.year}`;
                }
                return `Day ${dt.day + 1}, Month ${dt.month + 1}, Year ${dt.year}`;
            }
            // Simple Timekeeping: uses game.time.components
            if (game.modules.get("simple-timekeeping")?.active && game.time?.components) {
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

            // Post a chat message about the rest
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
