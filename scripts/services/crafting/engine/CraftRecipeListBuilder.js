/**
 * Shared craft recipe list partitioning and enrichment.
 * Cooking, brewing, and other professions use the same available / missing lists.
 */

import { formatMealBuffPreview } from "../../meal/buffs/MealBuffPresets.js";
import { normalizeRecipeOutputImg } from "../recipes/RecipeIcons.js";
import { MODULE_ID } from "../../../data/moduleId.js";
import { applyCustomRecipesToEngine } from "../recipes/RecipeCatalog.js";
import { buildCraftCommitSummary } from "./CraftCommitSummary.js";

export const CRAFT_PROFESSION_LABELS = {
    cooking: "Cooking",
    alchemy: "Alchemy",
    smithing: "Smithing",
    leatherworking: "Leatherworking",
    brewing: "Brewing",
    tailoring: "Tailoring"
};

/**
 * Recipes for the Missing section: partial ingredient matches plus fully unmet
 * or prerequisite-locked rows. Terrain-filtered recipes never enter status.
 * @param {{ available?: Object[], partial?: Object[], locked?: Object[] }} status
 * @returns {Object[]}
 */
export function collectMissingCraftRecipes(status) {
    const partial = Array.isArray(status?.partial) ? status.partial : [];
    const locked = Array.isArray(status?.locked) ? status.locked : [];
    const seen = new Set();
    const missing = [];

    for (const recipe of [...partial, ...locked]) {
        if (!recipe) continue;
        const key = recipe.id ?? recipe.name;
        if (key && seen.has(key)) continue;
        if (key) seen.add(key);
        missing.push(recipe);
    }

    return missing;
}

/**
 * @param {Object} recipe
 * @param {object} opts
 * @param {Actor} opts.actor
 * @param {import("./CraftingEngine.js").CraftingEngine} opts.engine
 * @param {string} [opts.risk]
 * @param {string|null} [opts.terrainTag]
 * @param {string|null} [opts.selectedRecipeId]
 * @param {(buff: object|null) => object|null} [opts.formatBuffPreview]
 * @returns {Object}
 */
export function enrichCraftRecipe(recipe, {
    actor,
    engine,
    risk = "standard",
    terrainTag = null,
    selectedRecipeId = null,
    formatBuffPreview = formatMealBuffPreview
} = {}) {
    const dcBreakdown = recipe.noSkillCheck
        ? { total: 0, base: 0, factors: [], hasModifiers: false }
        : engine.getDcBreakdown(actor, recipe, risk, terrainTag);
    const flags = recipe.outputFlags?.[MODULE_ID];

    return {
        ...recipe,
        noSkillCheck: !!recipe.noSkillCheck,
        dcDisplay: dcBreakdown.total,
        dcBreakdown,
        outputName: recipe.output?.name ?? "Unknown",
        outputImg: normalizeRecipeOutputImg(
            recipe.output?.img,
            "icons/consumables/food/bowl-stew-brown.webp"
        ),
        ambitiousOutput: recipe.ambitiousOutput,
        isSelected: !!selectedRecipeId && recipe.id === selectedRecipeId,
        description: recipe.description ?? "",
        buffPreview: formatBuffPreview(flags?.buff),
        isPartyMeal: !!flags?.partyMeal,
        isWellFed: !!flags?.wellFed,
        satiates: flags?.satiates ?? [],
        ambitiousName: recipe.ambitiousOutput?.name ?? null,
        ambitiousBuffPreview: formatBuffPreview(
            recipe.ambitiousOutputFlags?.[MODULE_ID]?.buff ?? flags?.buff
        ),
        lockReason: recipe.reason ?? null,
        ingredientList: (recipe.ingredients ?? []).map(ing => {
            const detail = recipe.ingredientStatus?.details?.find(d => d.name === ing.name);
            const invKey = ing.name.toLowerCase().trim();
            const invEntry = actor.items?.find(i => i.name?.toLowerCase().trim() === invKey);
            const fallbackIcon = ing.resourceType === "water"
                ? "icons/magic/water/water-drop-swirl-blue.webp"
                : "icons/consumables/food/bread-loaf-round-white.webp";
            const rawImg = invEntry?.img;
            return {
                name: ing.name,
                required: ing.quantity ?? 1,
                available: detail?.available ?? 0,
                met: detail?.met ?? false,
                img: (rawImg && !rawImg.includes("mystery-man")) ? rawImg : fallbackIcon
            };
        })
    };
}

/**
 * Build the shared craft list panel context for TotM, station dialog, and pickers.
 * @param {object} params
 * @returns {{
 *   profession: string,
 *   professionId: string,
 *   available: Object[],
 *   missing: Object[],
 *   partial: Object[],
 *   locked: Object[],
 *   selectedRecipe: Object|null,
 *   noAvailableRecipes: boolean,
 *   commitSummary: Object|null,
 *   isAmbitiousSelected: boolean
 * }}
 */
export function buildCraftRecipeListContext({
    engine,
    actor,
    professionId,
    risk = "standard",
    terrainTag = null,
    partySize = 1,
    selectedRecipeId = null,
    hasCrafted = false,
    formatBuffPreview = formatMealBuffPreview,
    includeCommitSummary = true
} = {}) {
    // Homebrew lives in world settings; merge before listing so cooking/brewing
    // craft UIs stay aligned with the Custom Recipes editor during an open rest.
    applyCustomRecipesToEngine(engine);

    const status = engine.getRecipeStatus(actor, professionId, terrainTag, partySize);
    const enrich = (recipe) => enrichCraftRecipe(recipe, {
        actor,
        engine,
        risk,
        terrainTag,
        selectedRecipeId,
        formatBuffPreview
    });

    const available = (status.available ?? []).map(enrich);
    const missing = collectMissingCraftRecipes(status).map(enrich);
    const locked = (status.locked ?? []).map(enrich);

    const selectedRecipe = available.find(r => r.id === selectedRecipeId)
        ?? missing.find(r => r.id === selectedRecipeId)
        ?? null;

    let commitSummary = null;
    if (includeCommitSummary && selectedRecipe && !hasCrafted) {
        commitSummary = buildCraftCommitSummary({
            recipe: selectedRecipe,
            risk,
            actor,
            engine,
            terrainTag
        });
    }

    return {
        profession: CRAFT_PROFESSION_LABELS[professionId] ?? professionId,
        professionId,
        available,
        missing,
        /** @deprecated Alias of missing; kept for older templates / callers. */
        partial: missing,
        locked,
        selectedRecipe,
        noAvailableRecipes: !hasCrafted && available.length === 0,
        commitSummary,
        isAmbitiousSelected: risk === "ambitious"
    };
}
