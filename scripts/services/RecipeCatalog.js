/**
 * Recipe merge, validation, and custom recipe loading for CraftingEngine.
 */

import { STUB_RECIPES } from "../data/stub-content.js";

const MODULE_ID = "ionrift-respite";

export const CUSTOM_RECIPE_MAX_PER_PROFESSION = 20;

/** Phase 2 homebrew: professions with recipe authoring and CraftingEngine integration. */
export const HOMEBREW_PROFESSION_IDS = ["cooking", "brewing"];

/** Canonical tool proficiency key per crafting profession (matches activity prerequisites). */
export const PROFESSION_TOOL_REQUIRED = {
    cooking: "cook",
    brewing: "brewer",
    alchemy: "alchemist",
    tailoring: "weaver",
    fletching: "woodcarver",
    tinkering: "tinker"
};

/** Display labels for locked tool proficiency in the recipe editor. */
export const TOOL_PROFICIENCY_LABELS = {
    cook: "Cook's utensils",
    brewer: "Brewer's supplies",
    alchemist: "Alchemist's supplies",
    weaver: "Weaver's tools",
    woodcarver: "Woodcarver's tools",
    tinker: "Tinker's tools"
};

/**
 * Tool proficiency key for a profession, or undefined when no tool gate applies.
 * @param {string} professionId
 * @returns {string|undefined}
 */
export function getProfessionToolRequired(professionId) {
    return PROFESSION_TOOL_REQUIRED[professionId] ?? undefined;
}

/**
 * Apply profession-locked tool proficiency onto a recipe draft.
 * @param {Object} recipe
 * @param {string} professionId
 * @returns {Object}
 */
export function applyProfessionToolToRecipe(recipe, professionId) {
    const out = { ...recipe, profession: professionId };
    const toolRequired = getProfessionToolRequired(professionId);
    if (toolRequired) out.toolRequired = toolRequired;
    else delete out.toolRequired;
    return out;
}

/**
 * Merge pack/stub recipes with GM custom recipes. Custom entries override by id.
 * @param {Object[]} baseRecipes
 * @param {Object[]} customRecipes
 * @returns {Object[]}
 */
export function mergeRecipeLists(baseRecipes, customRecipes) {
    const base = Array.isArray(baseRecipes) ? baseRecipes : [];
    const custom = Array.isArray(customRecipes) ? customRecipes : [];
    const byId = new Map();

    for (const recipe of base) {
        if (recipe?.id) byId.set(recipe.id, recipe);
    }
    for (const recipe of custom) {
        if (recipe?.id) byId.set(recipe.id, recipe);
    }

    return [...byId.values()];
}

/**
 * Pack and stub recipe ids currently loaded for a profession (excludes custom list entries).
 * @param {string} professionId
 * @param {Object[]} [customList]
 * @returns {Map<string, string>} id to display name
 */
export function getPackRecipeIdMap(professionId, customList = []) {
    const ids = new Map();
    for (const recipe of STUB_RECIPES[professionId] ?? []) {
        if (recipe?.id) ids.set(recipe.id, recipe.name ?? recipe.id);
    }

    const customIds = new Set(
        (customList ?? []).map(recipe => recipe?.id).filter(Boolean)
    );
    const engine = game.ionrift?.respite?.craftingEngine;
    const loaded = engine?.recipes?.get(professionId) ?? [];
    for (const recipe of loaded) {
        if (!recipe?.id || customIds.has(recipe.id) || ids.has(recipe.id)) continue;
        ids.set(recipe.id, recipe.name ?? recipe.id);
    }

    return ids;
}

/**
 * Human-readable overwrite warnings before saving a custom recipe.
 * @param {string} professionId
 * @param {Object} draft
 * @param {Object[]} list
 * @param {{ isUpdate: boolean, selectedIndex: number }} options
 * @returns {string[]}
 */
export function describeRecipeSaveOverwrite(professionId, draft, list, { isUpdate, selectedIndex }) {
    const messages = [];
    if (!draft?.id) return messages;

    const duplicateIndex = list.findIndex(
        (recipe, index) => recipe?.id === draft.id && (!isUpdate || index !== selectedIndex)
    );
    if (duplicateIndex >= 0) {
        const name = list[duplicateIndex]?.name ?? draft.id;
        messages.push(`Recipe id "${draft.id}" replaces custom recipe "${name}".`);
    }

    const packMap = getPackRecipeIdMap(professionId, list);
    if (packMap.has(draft.id)) {
        const sameSavedOverride = isUpdate && list[selectedIndex]?.id === draft.id;
        if (!sameSavedOverride) {
            messages.push(`Recipe id "${draft.id}" replaces pack recipe "${packMap.get(draft.id)}".`);
        }
    }

    return messages;
}

/**
 * Validate a single custom recipe object.
 * @param {Object} recipe
 * @param {string} professionId
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateCustomRecipe(recipe, professionId) {
    const errors = [];
    if (!recipe || typeof recipe !== "object") {
        return { valid: false, errors: ["Recipe must be an object."] };
    }
    if (!recipe.id || typeof recipe.id !== "string" || !recipe.id.trim()) {
        errors.push("Missing recipe id.");
    }
    if (!recipe.name || typeof recipe.name !== "string" || !recipe.name.trim()) {
        errors.push("Missing recipe name.");
    }
    if (recipe.profession && recipe.profession !== professionId) {
        errors.push(`Profession mismatch (expected ${professionId}).`);
    }
    if (typeof recipe.dc !== "number" || recipe.dc <= 0) {
        errors.push("DC must be a positive number.");
    }
    if (!Array.isArray(recipe.ingredients) || recipe.ingredients.length === 0) {
        errors.push("At least one ingredient is required.");
    } else {
        for (const ing of recipe.ingredients) {
            if (!ing?.name || typeof ing.name !== "string") {
                errors.push("Each ingredient needs a name.");
                break;
            }
            if (typeof ing.quantity !== "number" || ing.quantity <= 0) {
                errors.push("Ingredient quantities must be positive numbers.");
                break;
            }
        }
    }
    const out = recipe.output;
    if (!out?.name || typeof out.name !== "string") {
        errors.push("Output must include a name.");
    }
    if (out && (typeof out.quantity !== "number" || out.quantity <= 0)) {
        errors.push("Output quantity must be a positive number.");
    }

    const amb = recipe.ambitiousOutput;
    if (amb) {
        if (!amb.name || typeof amb.name !== "string") {
            errors.push("Ambitious output must include a name.");
        }
        if (typeof amb.quantity !== "number" || amb.quantity <= 0) {
            errors.push("Ambitious output quantity must be a positive number.");
        }
    }

    return { valid: errors.length === 0, errors };
}

/**
 * Sanitize custom recipe storage from world settings.
 * @param {Record<string, Object[]>} raw
 * @returns {Record<string, Object[]>}
 */
export function sanitizeCustomRecipes(raw) {
    if (!raw || typeof raw !== "object") return {};
    const out = {};

    for (const profId of HOMEBREW_PROFESSION_IDS) {
        const list = raw[profId];
        if (!Array.isArray(list)) continue;

        const kept = [];
        for (const recipe of list.slice(0, CUSTOM_RECIPE_MAX_PER_PROFESSION)) {
            const { valid } = validateCustomRecipe(recipe, profId);
            if (valid) {
                kept.push(applyProfessionToolToRecipe(recipe, profId));
            }
        }
        if (kept.length) out[profId] = kept;
    }

    return out;
}

/**
 * Apply merged custom recipes onto a CraftingEngine instance.
 * @param {import("./CraftingEngine.js").CraftingEngine} engine
 */
export function applyCustomRecipesToEngine(engine) {
    if (!engine) return;
    const raw = game.settings.get(MODULE_ID, "customRecipes") ?? {};
    const customByProf = sanitizeCustomRecipes(raw);

    for (const [profId, customList] of Object.entries(customByProf)) {
        const base = engine.recipes.get(profId) ?? [];
        engine.load(profId, mergeRecipeLists(base, customList));
    }
}
