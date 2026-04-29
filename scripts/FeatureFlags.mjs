const MODULE_ID = "ionrift-respite";

/**
 * When false, Monster Cooking has no config UI, no butchering hooks, and the world
 * "enable Monster Cooking" value is ignored. Set true when the feature is ready to ship.
 * @type {boolean}
 */
export const MONSTER_COOKING_FEATURE_LIVE = false;

/**
 * @returns {boolean}
 */
export function isMonsterCookingUnlocked() {
    if (!MONSTER_COOKING_FEATURE_LIVE) return false;
    try {
        return game.settings.get(MODULE_ID, "enableMonsterCooking") === true;
    } catch {
        return false;
    }
}
