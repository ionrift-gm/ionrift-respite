/**
 * Shared constants for the Meal phase: module id, the spoiled-food loot
 * template, default meal requirements, and container item type set.
 */

export const MODULE_ID = "ionrift-respite";

/** DnD5e uses "container"; PF2e uses "backpack". */
export const CONTAINER_ITEM_TYPES = new Set(["container", "backpack"]);

export const SPOILED_FOOD_TEMPLATE = {
    name: "Spoiled Food",
    type: "consumable",
    img: "icons/consumables/food/berries-ration-round-red.webp",
    system: {
        description: { value: "Rotten, inedible remains. Might have been something good once." },
        quantity: 1,
        weight: 0.5,
        rarity: "common",
        type: { value: "food" }
    },
    flags: { [MODULE_ID]: { spoiled: true } }
};

/** Default meal requirements (PHB RAW baseline). */
export const MEAL_DEFAULTS = {
    waterPerDay: 2,
    foodPerDay: 1,
    dehydrationDC: 15,
    foodGraceDays: null  // null = 3 + CON mod (calculated per character)
};
