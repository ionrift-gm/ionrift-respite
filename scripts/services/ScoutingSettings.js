const MODULE_ID = "ionrift-respite";

/**
 * Whether travel scouting is enabled for this world. When off, the Scout option
 * is hidden from the travel phase and scouting never affects comfort or the
 * night check. Defaults to false (Standard profile).
 * @returns {boolean}
 */
export function isScoutingEnabled() {
    try {
        const value = game.settings.get(MODULE_ID, "enableScouting");
        return value === undefined || value === null ? false : !!value;
    } catch {
        return false;
    }
}
