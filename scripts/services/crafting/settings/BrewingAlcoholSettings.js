import { MODULE_ID } from "../../../data/moduleId.js";

/**
 * World toggle for alcoholic ferment recipes (Craft Professions brewing).
 * Default on. Steeps (teas, Desert Cooler) ignore this gate.
 */
export function isBrewingAlcoholEnabled() {
    try {
        return game.settings.get(MODULE_ID, "enableBrewingAlcohol") !== false;
    } catch {
        return true;
    }
}

/**
 * True when a recipe is an alcoholic ferment (lane or drinkType).
 * @param {object|null|undefined} recipe
 */
export function recipeIsAlcoholicBrew(recipe) {
    if (!recipe) return false;
    if (recipe.lane === "ferment") return true;
    const flags = recipe.outputFlags?.[MODULE_ID]
        ?? recipe.output?.flags?.[MODULE_ID]
        ?? {};
    return flags.drinkType === "alcohol";
}

/**
 * Whether a recipe should appear / resolve under the current alcohol setting.
 * @param {object|null|undefined} recipe
 */
export function isAlcoholBrewRecipeVisible(recipe) {
    if (!recipeIsAlcoholicBrew(recipe)) return true;
    return isBrewingAlcoholEnabled();
}
