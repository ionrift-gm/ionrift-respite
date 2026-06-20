/**
 * Shared commit-panel data for crafting UIs.
 */

import { buildCommitOutputPreviewBundle } from "./CraftOutputPreview.js";
import { getChefTreatOutputQuantity } from "./ChefFeat.js";

/**
 * Pick the first craftable recipe when none is selected, or keep a still-valid selection.
 * @param {Object} params
 * @param {import("./CraftingEngine.js").CraftingEngine} params.engine
 * @param {Actor} params.actor
 * @param {string} params.profession
 * @param {string|null} [params.terrainTag]
 * @param {number} [params.partySize]
 * @param {string|null} [params.currentId]
 * @param {boolean} [params.hasCrafted]
 * @returns {string|null}
 */
export function resolveDefaultCraftRecipeId({
    engine,
    actor,
    profession,
    terrainTag = null,
    partySize,
    currentId = null,
    hasCrafted = false
}) {
    if (hasCrafted || !engine || !actor || !profession) return currentId;
    const status = engine.getRecipeStatus(actor, profession, terrainTag, partySize);
    if (currentId && status.available.some(recipe => recipe.id === currentId)) return currentId;
    return status.available[0]?.id ?? null;
}

/**
 * @param {Object} params
 * @param {Object} params.recipe
 * @param {string} params.risk
 * @param {Actor} params.actor
 * @param {import("./CraftingEngine.js").CraftingEngine} params.engine
 * @param {string|null} [params.terrainTag]
 * @returns {Object|null}
 */
export function buildCraftCommitSummary({ recipe, risk, actor, engine, terrainTag = null }) {
    if (!recipe || !actor || !engine) return null;

    const effectiveRisk = recipe.noSkillCheck ? "standard" : risk;
    const dcBreakdown = recipe.noSkillCheck
        ? { total: 0, base: 0, factors: [], hasModifiers: false }
        : engine.getDcBreakdown(actor, recipe, effectiveRisk, terrainTag);
    const outputForRisk = effectiveRisk === "ambitious" && recipe.ambitiousOutput
        ? recipe.ambitiousOutput
        : recipe.output;
    const outputPreviewBundle = buildCommitOutputPreviewBundle(recipe, effectiveRisk);

    const ingredients = (recipe.ingredients ?? []).map(ing => {
        const invKey = ing.name.toLowerCase().trim();
        const invEntry = actor.items?.find(i => i.name.toLowerCase().trim() === invKey);
        const fallbackIcon = ing.resourceType === "water"
            ? "icons/magic/water/water-drop-swirl-blue.webp"
            : "icons/consumables/food/bread-loaf-round-white.webp";
        const rawImg = invEntry?.img;
        return {
            name: ing.name,
            quantity: ing.quantity ?? 1,
            img: (rawImg && !rawImg.includes("mystery-man")) ? rawImg : fallbackIcon
        };
    });

    const outputQuantity = recipe.outputQuantityProficiency
        ? getChefTreatOutputQuantity(actor)
        : (outputForRisk?.quantity ?? 1);

    if (recipe.noSkillCheck) {
        return {
            recipeName: recipe.name,
            noSkillCheck: true,
            outputName: outputForRisk?.name ?? recipe.output?.name ?? "Unknown",
            outputImg: outputForRisk?.img ?? recipe.output?.img ?? "icons/svg/mystery-man.svg",
            outputQuantity,
            ingredients,
            ingredientCost: "",
            actionLabel: "Prepare",
            outputPreview: outputPreviewBundle.active,
            alternateOutputPreview: null
        };
    }

    return {
        recipeName: recipe.name,
        dc: dcBreakdown.total,
        dcBreakdown,
        risk: effectiveRisk,
        riskLabel: { standard: "Standard", ambitious: "Ambitious" }[effectiveRisk] ?? effectiveRisk,
        outputName: outputForRisk?.name ?? recipe.output?.name ?? "Unknown",
        outputImg: outputForRisk?.img ?? recipe.output?.img ?? "icons/svg/mystery-man.svg",
        outputQuantity,
        ingredients,
        ingredientCost: (recipe.ingredients ?? []).map(i => `${i.quantity ?? 1}x ${i.name}`).join(", "),
        failConsequence: "Ingredients consumed on failure",
        skill: (recipe.skill ?? "sur").toUpperCase(),
        outputPreview: outputPreviewBundle.active,
        alternateOutputPreview: outputPreviewBundle.alternate
    };
}
