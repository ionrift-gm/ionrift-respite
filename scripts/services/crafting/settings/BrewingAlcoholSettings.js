import { MODULE_ID } from "../../../data/moduleId.js";
import { CRAFT_PROFESSIONS_OVERLAY_ID } from "../../meal/provisions/CraftProfessionsArtPreference.js";

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

/**
 * True when any recipe list contains an alcoholic ferment.
 * @param {Iterable<object>|null|undefined} recipes
 */
export function recipeListHasAlcoholicBrew(recipes) {
    if (!recipes) return false;
    for (const recipe of recipes) {
        if (recipeIsAlcoholicBrew(recipe)) return true;
    }
    return false;
}

/**
 * Homebrew customRecipes setting contains at least one alcoholic ferment.
 */
export function hasAlcoholicCustomBrewRecipes() {
    try {
        const raw = game.settings.get(MODULE_ID, "customRecipes") ?? {};
        if (!raw || typeof raw !== "object") return false;
        for (const list of Object.values(raw)) {
            if (recipeListHasAlcoholicBrew(list)) return true;
        }
    } catch {
        return false;
    }
    return false;
}

/**
 * Craft Professions Pack is installed on disk (active or not).
 * @returns {Promise<boolean>}
 */
export async function isCraftProfessionsPackPresent() {
    const overlay = game.ionrift?.library?.overlay;
    if (!overlay?.listInstalledSublayers) return false;
    try {
        const sublayers = await overlay.listInstalledSublayers(MODULE_ID);
        for (const sublayer of sublayers ?? []) {
            const manifest = await overlay.getLocalManifest?.(MODULE_ID, sublayer);
            if (manifest?.overlayId === CRAFT_PROFESSIONS_OVERLAY_ID) return true;
            if (sublayer === "craft-professions") return true;
        }
    } catch {
        return false;
    }
    return false;
}

/**
 * Active overlay profession catalogues include an alcoholic ferment.
 * @returns {Promise<boolean>}
 */
export async function hasAlcoholicOverlayBrewRecipes() {
    try {
        const { OverlayProfessionLoader } = await import(
            "../../packs/overlays/OverlayProfessionLoader.js"
        );
        const packs = await OverlayProfessionLoader.loadAll();
        for (const pack of packs ?? []) {
            for (const list of Object.values(pack?.recipes ?? {})) {
                if (recipeListHasAlcoholicBrew(list)) return true;
            }
        }
    } catch {
        return false;
    }
    return false;
}

/**
 * Whether Travel & Activities should show Alcoholic Ferments.
 * True when Craft Professions Pack is present, or any ferment / alcohol
 * recipe exists in overlay or homebrew catalogues.
 * @returns {Promise<boolean>}
 */
export async function shouldShowBrewingAlcoholSetting() {
    if (hasAlcoholicCustomBrewRecipes()) return true;
    if (await isCraftProfessionsPackPresent()) return true;
    if (await hasAlcoholicOverlayBrewRecipes()) return true;
    return false;
}
