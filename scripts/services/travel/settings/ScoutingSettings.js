import { shouldRunTravelPhase } from "./TravelSettings.js";
import { MODULE_ID } from "../../../data/moduleId.js";

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

