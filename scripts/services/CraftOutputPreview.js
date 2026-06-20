/**
 * Builds hover preview data for crafting output tokens (commit panel).
 */

import { formatMealBuffPreview } from "./MealBuffPresets.js";

const MODULE_ID = "ionrift-respite";

const RARITY_LABELS = {
    common: "Common",
    uncommon: "Uncommon",
    rare: "Rare",
    veryrare: "Very Rare",
    legendary: "Legendary"
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
        name: output.name ?? "Unknown",
        img: output.img ?? "icons/svg/mystery-man.svg",
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
                label: "Standard success",
                ...standard
            };
        } else {
            alternate = {
                label: "Ambitious success",
                ...ambitious
            };
        }
    }

    return { active, alternate };
}
