/**
 * Recipe output icon normalization. Remaps known-bad core paths and supplies fallbacks.
 */

export const BOLSTERING_TREAT_ICON = "icons/consumables/food/berries-ration-round-red.webp";

export const RECIPE_OUTPUT_ICON_FALLBACK = "icons/consumables/food/bowl-stew-brown.webp";

/** Core paths that 404 on common Foundry builds (removed or never shipped). */
const REMAPPED_OUTPUT_ICONS = {
    "icons/consumables/food/cookie-biscuit-brown.webp": BOLSTERING_TREAT_ICON,
    "icons/consumables/food/bread-loaf-simple-brown.webp": BOLSTERING_TREAT_ICON,
    "icons/consumables/food/berry-bowl-red.webp": BOLSTERING_TREAT_ICON
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

/**
 * @param {Item} item
 * @returns {string}
 */
export function normalizeItemImg(item) {
    return normalizeRecipeOutputImg(item?.img);
}

/**
 * One-time GM migration for chef treats crafted before the module icon shipped.
 */
export async function migrateBolsteringTreatIcons() {
    if (!game.user.isGM) return;

    for (const actor of game.actors) {
        const updates = [];
        for (const item of actor.items) {
            if (!item.flags?.[MODULE_ID]?.chefTreat) continue;
            const normalized = normalizeItemImg(item);
            if (normalized !== item.img) {
                updates.push({ _id: item.id, img: normalized });
            }
        }
        if (updates.length) await actor.updateEmbeddedDocuments("Item", updates);
    }
}
