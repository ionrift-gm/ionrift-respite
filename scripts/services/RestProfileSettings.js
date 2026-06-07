/**
 * @module RestProfileSettings
 * @description Detects Quick Setup profile alignment and derived rest modes.
 */

import { isFletchingEnabled } from "./FletchingSettings.js";

const MODULE_ID = "ionrift-respite";

/**
 * True when world settings match the Simple Quick Setup profile (complexity keys).
 * @returns {boolean}
 */
export function isSimpleRestProfile() {
    try {
        return !game.settings.get(MODULE_ID, "enableComfort")
            && !game.settings.get(MODULE_ID, "enableProfessions")
            && !game.settings.get(MODULE_ID, "enableEncounters")
            && !isFletchingEnabled()
            && (game.settings.get(MODULE_ID, "trainingXpTier") ?? 0) === 0
            && !game.settings.get(MODULE_ID, "enableCopySpell")
            && !game.settings.get(MODULE_ID, "enablePrayMeditate");
    } catch {
        return false;
    }
}

/**
 * @returns {boolean}
 */
export function isStationsInterfaceMode() {
    try {
        return game.settings.get(MODULE_ID, "restInterfaceMode") === "stations";
    } catch {
        return false;
    }
}

/**
 * Simple profile with camp stations on the canvas (not the single-panel flow).
 * @returns {boolean}
 */
export function isSimpleStationsMode() {
    return isSimpleRestProfile() && isStationsInterfaceMode();
}

/**
 * Make Camp fire ceremony still runs on the map when comfort rules are off.
 * @returns {boolean}
 */
export function requiresMapCampFire() {
    return isSimpleStationsMode();
}

/**
 * Campfire minigame for Make Camp ceremony and activity-phase fire management.
 * @returns {boolean}
 */
export function isCampfireMinigameEnabled() {
    try {
        return !!game.settings.get(MODULE_ID, "enableCampfireMinigame");
    } catch {
        return false;
    }
}
