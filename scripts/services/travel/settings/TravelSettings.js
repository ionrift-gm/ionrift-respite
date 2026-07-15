
/**
 * Whether crafting professions are enabled.
 * @returns {boolean}
 */
import { MODULE_ID } from "../../../data/moduleId.js";
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
 * Whether foraging is offered during the travel phase.
 * @returns {boolean}
 */
export function isForagingEnabled() {
    try {
        const value = game.settings.get(MODULE_ID, "enableForaging");
        return value === undefined || value === null ? true : !!value;
    } catch {
        return true;
    }
}

/**
 * Whether hunting (prey) is offered during the travel phase.
 * @returns {boolean}
 */
export function isHuntingEnabled() {
    try {
        const value = game.settings.get(MODULE_ID, "enableHunting");
        return value === undefined || value === null ? true : !!value;
    } catch {
        return true;
    }
}

/**
 * Terrain travel activities filtered by world toggles (forage / hunt only).
 * @param {string[]|undefined} terrainActivities
 * @returns {{ canForage: boolean, canHunt: boolean }}
 */
export function getTravelGatherAvailability(terrainActivities) {
    const allowed = terrainActivities ?? ["forage", "hunt", "scout"];
    return {
        canForage: allowed.includes("forage") && isForagingEnabled(),
        canHunt: allowed.includes("hunt") && isHuntingEnabled()
    };
}

/**
 * Whether the travel resolution phase should run this long rest.
 * Gated by Use Travel only (independent of crafting professions).
 * @returns {boolean}
 */
export function shouldRunTravelPhase() {
    return isTravelPhaseUsed();
}

/**
 * When true, only GM-authored custom recipes and Respite Custom compendium
 * provisions are used. Shipped respite-items, built-in stubs, and imported
 * pack recipes, forage pools, and hunt tables are skipped.
 * @returns {boolean}
 */
export function isHomebrewProvisionOnly() {
    try {
        return !!game.settings.get(MODULE_ID, "homebrewProvisionOnly");
    } catch {
        return false;
    }
}

/**
 * When true, only Bolstering Treats remain from profession crafting. Tailoring,
 * brewing, tinkering craft, and camp meal recipes are hidden. The Cook
 * activity stays available for characters with the Chef feat.
 * @returns {boolean}
 */
export function isChefTreatCookingOnly() {
    try {
        return !!game.settings.get(MODULE_ID, "chefTreatCookingOnly");
    } catch {
        return false;
    }
}

/**
 * Whether a profession-category rest activity is enabled for this world.
 * Chef Treats Only keeps Cook (Bolstering Treats) and drops the rest.
 * @param {Object} activity
 * @returns {boolean}
 */
export function isProfessionActivityEnabled(activity) {
    if (!activity || activity.category !== "profession") return true;
    if (isChefTreatCookingOnly()) return activity.id === "act_cook";
    return isProfessionsEnabled();
}

/** Default camp fuel find rate (% of successful forages that grant kindling). */
export const CAMP_FUEL_FIND_DEFAULT_PERCENT = 5;
export const CAMP_FUEL_FIND_MIN_PERCENT = 0;
export const CAMP_FUEL_FIND_MAX_PERCENT = 25;

/**
 * World setting: percent chance a successful forage consults the camp fuel table.
 * @returns {number} Integer 0–25
 */
export function getCampFuelFindPercent() {
    try {
        const raw = game.settings.get(MODULE_ID, "campFuelFindChance");
        if (typeof raw === "number" && !Number.isNaN(raw)) {
            return Math.max(
                CAMP_FUEL_FIND_MIN_PERCENT,
                Math.min(CAMP_FUEL_FIND_MAX_PERCENT, Math.round(raw))
            );
        }
    } catch {
        /* settings not ready */
    }
    return CAMP_FUEL_FIND_DEFAULT_PERCENT;
}

/**
 * Decimal chance (0–1) for {@link TravelResolver} camp fuel rolls.
 * @returns {number}
 */
export function getCampFuelFindChance() {
    return getCampFuelFindPercent() / 100;
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
