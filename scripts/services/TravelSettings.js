const MODULE_ID = "ionrift-respite";

/**
 * Whether crafting professions are enabled.
 * @returns {boolean}
 */
export function isProfessionsEnabled() {
    try {
        return !!game.settings.get(MODULE_ID, "enableProfessions");
    } catch {
        return false;
    }
}

/**
 * Whether the travel concept is enabled in module config (Use Travel).
 * When off, long rests skip the travel phase entirely. Scouting config
 * and runtime scouting both depend on this.
 * @returns {boolean}
 */
export function isTravelPhaseUsed() {
    try {
        const value = game.settings.get(MODULE_ID, "useTravel");
        return value === undefined || value === null ? true : !!value;
    } catch {
        return true;
    }
}

/**
 * Whether the travel resolution phase should run this long rest.
 * Requires professions (forage/hunt activities) and Use Travel.
 * @returns {boolean}
 */
export function shouldRunTravelPhase() {
    if (!isProfessionsEnabled()) return false;
    return isTravelPhaseUsed();
}

/**
 * One-time migration for useTravel semantics and legacy allowSkipTravel.
 */
export function migrateUseTravel() {
    if (!game.user?.isGM) return;
    try {
        if (game.settings.get(MODULE_ID, "useTravelPhaseSemanticsMigrated")) return;

        let useTravel = true;
        const hasUseTravel = (() => {
            try {
                const v = game.settings.get(MODULE_ID, "useTravel");
                return v !== undefined && v !== null;
            } catch {
                return false;
            }
        })();

        if (hasUseTravel) {
            useTravel = !!game.settings.get(MODULE_ID, "useTravel");
            // Prior inverted migration set useTravel false when allowSkipTravel was true.
            // That legacy flag only gated the in-phase skip button, not the phase itself.
            try {
                if (game.settings.get(MODULE_ID, "useTravelMigrated") && game.settings.get(MODULE_ID, "allowSkipTravel") === true) {
                    useTravel = true;
                }
            } catch { /* allowSkipTravel absent */ }
        }

        game.settings.set(MODULE_ID, "useTravel", useTravel);
        game.settings.set(MODULE_ID, "useTravelPhaseSemanticsMigrated", true);
    } catch (err) {
        console.warn(`${MODULE_ID} | useTravel migration skipped:`, err);
    }
}
