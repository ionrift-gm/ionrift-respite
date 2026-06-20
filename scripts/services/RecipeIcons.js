/**
 * Recipe output icon normalization. Remaps known-bad core paths and supplies fallbacks.
 */

export const RECIPE_OUTPUT_ICON_FALLBACK = "icons/consumables/food/bowl-stew-brown.webp";

/** Core paths that 404 on common Foundry builds (removed or never shipped). */
const REMAPPED_OUTPUT_ICONS = {
    "icons/consumables/food/cookie-biscuit-brown.webp": "icons/consumables/food/berry-bowl-red.webp",
    "icons/consumables/food/bread-loaf-simple-brown.webp": "icons/consumables/food/berry-bowl-red.webp"
};

/**
 * @param {string|null|undefined} img
 * @param {string} [fallback]
 * @returns {string}
 */
export function normalizeRecipeOutputImg(img, fallback = RECIPE_OUTPUT_ICON_FALLBACK) {
    if (!img || img.includes("mystery-man")) return fallback;
    return REMAPPED_OUTPUT_ICONS[img] ?? img;
}
