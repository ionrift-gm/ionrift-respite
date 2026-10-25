/**
 * Builds hover preview data for crafting output tokens (commit panel).
 */

import { formatMealBuffPreview } from "../../meal/buffs/MealBuffPresets.js";
import { normalizeRecipeOutputImg } from "../recipes/RecipeIcons.js";
import { MODULE_ID } from "../../../data/moduleId.js";

const RARITY_LABELS = {
    get common() { return game.i18n?.localize ? game.i18n.localize("ionrift-respite.craftOutputPreview.rarity.common") : "Common"; },
    get uncommon() { return game.i18n?.localize ? game.i18n.localize("ionrift-respite.craftOutputPreview.rarity.uncommon") : "Uncommon"; },
    get rare() { return game.i18n?.localize ? game.i18n.localize("ionrift-respite.craftOutputPreview.rarity.rare") : "Rare"; },
    get veryrare() { return game.i18n?.localize ? game.i18n.localize("ionrift-respite.craftOutputPreview.rarity.veryRare") : "Very Rare"; },
    get legendary() { return game.i18n?.localize ? game.i18n.localize("ionrift-respite.craftOutputPreview.rarity.legendary") : "Legendary"; }
};

/**
 * @param {string} html
 * @returns {string}
 */
export function stripHtmlPreview(html) {
    if (typeof html !== "string") return "";
    return html
        .replace(/<style[\s>][\s\S]*?<\/style>/gi, " ")
        .replace(/<script[\s>][\s\S]*?<\/script>/gi, " ")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/p>/gi, "\n")
        .replace(/<[^>]*>/g, " ")
        .replace(/&nbsp;/gi, " ")
        .replace(/&[a-z#0-9]+;/gi, " ")
        .replace(/\s+/g, " ")
        .trim();
}

/**
 * @param {Object|null|undefined} output
 * @param {Object|null|undefined} outputFlags
 * @returns {Object|null}
 */
export function buildCraftOutputPreview(output, outputFlags) {
    if (!output) return null;
    const rf = outputFlags?.[MODULE_ID] ?? {};
    const buffPreview = formatMealBuffPreview(rf.buff);
    const rarityKey = (output.rarity ?? "common").toLowerCase().replace(/\s+/g, "");
    return {
        name: output.name ?? game.i18n.localize("ionrift-respite.craftOutputPreview.unknown"),
        img: normalizeRecipeOutputImg(output.img, "icons/svg/mystery-man.svg"),
        quantity: output.quantity ?? 1,
        rarity: RARITY_LABELS[rarityKey] ?? output.rarity ?? "",
        descriptionPlain: stripHtmlPreview(output.description ?? ""),
        buffPreview,
        isPartyMeal: !!rf.partyMeal,
        isWellFed: !!rf.wellFed,
        satiates: Array.isArray(rf.satiates) ? rf.satiates : [],
        spoilsAfter: rf.spoilsAfter ?? null
    };
}

/**
 * Preview for the Ready to Craft output hover card.
 * @param {Object} selectedRecipe
 * @param {string} risk - "standard" | "ambitious"
 * @returns {{ active: Object, alternate: Object|null }}
 */
export function buildCommitOutputPreviewBundle(selectedRecipe, risk) {
    const standard = buildCraftOutputPreview(
        selectedRecipe.output,
        selectedRecipe.outputFlags
    );
    const ambitious = selectedRecipe.ambitiousOutput
        ? buildCraftOutputPreview(
            selectedRecipe.ambitiousOutput,
            selectedRecipe.ambitiousOutputFlags ?? selectedRecipe.outputFlags
        )
        : null;

    const useAmbitious = risk === "ambitious" && ambitious;
    const active = useAmbitious ? ambitious : standard;
    let alternate = null;

    if (ambitious && standard && standard.name !== ambitious.name) {
        if (useAmbitious) {
            alternate = {
                label: game.i18n.localize("ionrift-respite.craftOutputPreview.standardSuccess"),
                ...standard
            };
        } else {
            alternate = {
                label: game.i18n.localize("ionrift-respite.craftOutputPreview.ambitiousSuccess"),
                ...ambitious
            };
        }
    }

    return { active, alternate };
}
