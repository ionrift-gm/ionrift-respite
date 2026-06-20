import { shouldRunTravelPhase } from "./TravelSettings.js";

const MODULE_ID = "ionrift-respite";

/**
 * Whether travel scouting is active for this rest.
 * Requires the travel phase to run (Use Travel) and the scouting toggle.
 * @returns {boolean}
 */
export function isScoutingEnabled() {
    if (!shouldRunTravelPhase()) return false;
    try {
        const value = game.settings.get(MODULE_ID, "enableScouting");
        return value === undefined || value === null ? false : !!value;
    } catch {
        return false;
    }
}

/**
 * Whether the Travel Scouting toggle is stored on for this world.
 * Ignores travel gates; for config UI display only.
 * @returns {boolean}
 */
export function isScoutingToggleOn() {
    try {
        const value = game.settings.get(MODULE_ID, "enableScouting");
        return value === undefined || value === null ? false : !!value;
    } catch {
        return false;
    }
}
