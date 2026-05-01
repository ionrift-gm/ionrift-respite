/**
 * Built-in stub content for the Respite module.
 * Provides a minimal but functional set of recipes, forage pools, and hunt
 * yields so the cooking/foraging/hunting loop works out of the box without
 * any content packs installed. Content packs supersede this data entirely.
 */

// ═══════════════════════════════════════════════════════════════
//  RECIPES
// ═══════════════════════════════════════════════════════════════

export const STUB_RECIPES = {
    cooking: [
        {
            id: "stub_camp_porridge",
            name: "Camp Porridge",
            profession: "cooking",
            description: "Boil rations down into a thick porridge. Plain but filling.",
            toolRequired: "cook",
            skill: "sur",
            dc: 8,
            ingredients: [
                { name: "Rations", quantity: 1 },
                { name: "Waterskin", quantity: 1 }
            ],
            output: {
                name: "Camp Porridge",
                type: "consumable",
                quantity: 1,
                img: "icons/consumables/food/bowl-stew-tofu-potato-brown.webp",
                description: "<p>Thick, filling porridge. Counts as a meal.</p>",
                rarity: "common",
                system: { type: { value: "food", subtype: "" } }
            },
            ambitiousOutput: {
                name: "Honeyed Porridge",
                type: "consumable",
                quantity: 1,
                img: "icons/consumables/food/bowl-stew-tofu-potato-brown.webp",
                description: "<p>Sweet, thick porridge enriched with foraged honey.</p>",
                rarity: "uncommon",
                system: { type: { value: "food", subtype: "" } }
            },
            outputFlags: {
                "ionrift-respite": {
                    foodTag: "cooked_meal",
                    spoilsAfter: 3,
                    partyMeal: false,
                    wellFed: true,
                    satiates: ["food", "water"],
                    buff: {
                        type: "exhaustion_save",
                        formula: "15",
                        duration: "immediate",
                        target: "self"
                    }
                }
            }
        },
        {
            id: "stub_berry_preserves",
            name: "Berry Preserves",
            profession: "cooking",
            description: "Boil wild berries down into a sweet, shelf-stable preserve.",
            toolRequired: "cook",
            skill: "sur",
            dc: 9,
            ingredients: [{ name: "Wild Berries", quantity: 3 }],
            output: {
                name: "Berry Preserves",
                type: "consumable",
                quantity: 1,
                img: "icons/consumables/food/preserves-jam-jelly-jar-brown-red.webp",
                description: "<p>Sweet berry preserves. Counts as a meal and keeps well.</p>",
                rarity: "common",
                system: { type: { value: "food", subtype: "" } }
            },
            ambitiousOutput: {
                name: "Rich Berry Preserves",
                type: "consumable",
                quantity: 1,
                img: "icons/consumables/food/preserves-jam-jelly-jar-brown-red.webp",
                description: "<p>Thick, concentrated berry preserves with a deep flavour.</p>",
                rarity: "uncommon",
                system: { type: { value: "food", subtype: "" } }
            },
            outputFlags: {
                "ionrift-respite": {
                    foodTag: "preserved",
                    spoilsAfter: null,
                    partyMeal: false,
                    wellFed: false,
                    satiates: ["food"],
                    buff: null
                }
            },
            ambitiousOutputFlags: {
                "ionrift-respite": {
                    foodTag: "preserved",
                    spoilsAfter: null,
                    partyMeal: false,
                    wellFed: true,
                    satiates: ["food"],
                    buff: {
                        type: "temp_hp",
                        formula: "@prof",
                        duration: "untilLongRest",
                        target: "self"
                    }
                }
            }
        },
        {
            id: "stub_roasted_mushrooms",
            name: "Roasted Mushrooms",
            profession: "cooking",
            description: "Slice and roast mushrooms over coals until golden.",
            toolRequired: "cook",
            skill: "sur",
            dc: 9,
            ingredients: [{ name: "Edible Mushrooms", quantity: 2 }],
            output: {
                name: "Roasted Mushrooms",
                type: "consumable",
                quantity: 1,
                img: "icons/consumables/food/plate-chicken-grilled-mushroom-brown.webp",
                description: "<p>Mushrooms roasted over a campfire. Counts as a meal.</p>",
                rarity: "common",
                system: { type: { value: "food", subtype: "" } }
            },
            ambitiousOutput: {
                name: "Seared Mushroom Medley",
                type: "consumable",
                quantity: 1,
                img: "icons/consumables/food/plate-chicken-grilled-mushroom-brown.webp",
                description: "<p>A mix of wild mushrooms, seared with herbs.</p>",
                rarity: "uncommon",
                system: { type: { value: "food", subtype: "" } }
            },
            outputFlags: {
                "ionrift-respite": {
                    foodTag: "cooked_meal",
                    spoilsAfter: 3,
                    partyMeal: false,
                    wellFed: true,
                    satiates: ["food"],
                    buff: {
                        type: "advantage",
                        formula: "con",
                        duration: "nextSave",
                        target: "self"
                    }
                }
            }
        },
        {
            id: "stub_herb_rations",
            name: "Herb-Seasoned Rations",
            profession: "cooking",
            description: "Mix fresh wild herbs into trail rations for a better meal.",
            toolRequired: "cook",
            skill: "sur",
            dc: 10,
            ingredients: [
                { name: "Rations", quantity: 1 },
                { name: "Wild Herbs", quantity: 1 }
            ],
            output: {
                name: "Seasoned Rations",
                type: "consumable",
                quantity: 1,
                img: "icons/consumables/food/dried-meat-jerky-fish-red.webp",
                description: "<p>Rations improved with fresh herbs. Counts as a meal.</p>",
                rarity: "common",
                system: { type: { value: "food", subtype: "" } }
            },
            ambitiousOutput: {
                name: "Well-Seasoned Rations",
                type: "consumable",
                quantity: 1,
                img: "icons/consumables/food/dried-meat-jerky-fish-red.webp",
                description: "<p>Rations elevated with a generous herb blend.</p>",
                rarity: "uncommon",
                system: { type: { value: "food", subtype: "" } }
            },
            outputFlags: {
                "ionrift-respite": {
                    foodTag: "cooked_meal",
                    spoilsAfter: null,
                    partyMeal: false,
                    wellFed: true,
                    satiates: ["food"],
                    buff: {
                        type: "temp_hp",
                        formula: "@prof + 1d4",
                        duration: "untilLongRest",
                        target: "self"
                    }
                }
            }
        },
        {
            id: "stub_smoked_fish",
            name: "Smoked Fish",
            profession: "cooking",
            description: "Smoke fresh fish over a low fire to preserve and flavour it.",
            toolRequired: "cook",
            skill: "sur",
            dc: 10,
            ingredients: [{ name: "Fresh Fish", quantity: 2 }],
            output: {
                name: "Smoked Fish",
                type: "consumable",
                quantity: 1,
                img: "icons/consumables/food/fish-fillet-steak-brown.webp",
                description: "<p>Dried and smoked fish fillets. Keeps well on the road.</p>",
                rarity: "common",
                system: { type: { value: "food", subtype: "" } }
            },
            ambitiousOutput: {
                name: "Expertly Smoked Fish",
                type: "consumable",
                quantity: 1,
                img: "icons/consumables/food/fish-fillet-steak-brown.webp",
                description: "<p>Perfectly smoked fish with a rich, savoury finish.</p>",
                rarity: "uncommon",
                system: { type: { value: "food", subtype: "" } }
            },
            outputFlags: {
                "ionrift-respite": {
                    foodTag: "preserved",
                    spoilsAfter: null,
                    partyMeal: false,
                    wellFed: false,
                    satiates: ["food"],
                    buff: null
                }
            },
            ambitiousOutputFlags: {
                "ionrift-respite": {
                    foodTag: "preserved",
                    spoilsAfter: null,
                    partyMeal: false,
                    wellFed: true,
                    satiates: ["food"],
                    buff: {
                        type: "advantage",
                        save: { ability: "con" },
                        duration: "nextSave",
                        target: "self"
                    }
                }
            }
        },
        {
            id: "stub_hearty_stew",
            name: "Hearty Stew",
            profession: "cooking",
            description: "Combine game meat and rations into a thick, warming stew.",
            toolRequired: "cook",
            skill: "sur",
            dc: 12,
            ingredients: [
                { name: "Rations", quantity: 1 },
                { name: "Fresh Meat", quantity: 1 },
                { name: "Waterskin", quantity: 1 }
            ],
            output: {
                name: "Hearty Stew",
                type: "consumable",
                quantity: 1,
                img: "icons/consumables/food/bowl-stew-brown.webp",
                description: "<p>A thick stew made with fresh game meat. Counts as a meal. Restores 2 hit points when consumed during a rest.</p>",
                rarity: "common",
                system: { type: { value: "food", subtype: "" } }
            },
            ambitiousOutput: {
                name: "Rich Hunter's Stew",
                type: "consumable",
                quantity: 1,
                img: "icons/consumables/food/bowl-stew-brown.webp",
                description: "<p>A rich, aromatic stew slow-cooked with care. Restores 3 hit points when consumed during a rest.</p>",
                rarity: "uncommon",
                system: { type: { value: "food", subtype: "" } }
            },
            outputFlags: {
                "ionrift-respite": {
                    foodTag: "cooked_meal",
                    spoilsAfter: 3,
                    partyMeal: true,
                    wellFed: true,
                    satiates: ["food", "water"],
                    buff: {
                        type: "temp_hp",
                        formula: "@prof",
                        duration: "untilLongRest",
                        target: "party"
                    }
                }
            }
        }
    ]
};

// ═══════════════════════════════════════════════════════════════
//  RESOURCE POOLS
// ═══════════════════════════════════════════════════════════════

export const STUB_POOLS = [
    {
        id: "stub_pool_wilderness",
        name: "Wilderness Foraging",
        terrainTag: "wilderness",
        entries: [
            { weight: 4, itemRef: "wild_herbs", quantity: "1d2", itemData: { name: "Wild Herbs", type: "loot", img: "icons/consumables/plants/leaf-herb-green.webp", system: { description: { value: "<p>Common wild herbs. Useful for cooking.</p>" }, rarity: "common" } } },
            { weight: 3, itemRef: "wild_berries", quantity: "1d3", itemData: { name: "Wild Berries", type: "consumable", img: "icons/consumables/food/berries-ration-round-red.webp", system: { description: { value: "<p>Tart wild berries.</p>" }, rarity: "common" } } },
            { weight: 2, itemRef: "kindling", quantity: "1d4", itemData: { name: "Kindling", type: "loot", img: "icons/commodities/wood/kindling-sticks-brown.webp", system: { description: { value: "<p>Dry twigs and bark strips.</p>" }, rarity: "common" } } }
        ]
    },
    {
        id: "stub_pool_forest",
        name: "Forest Foraging",
        terrainTag: "forest",
        entries: [
            { weight: 4, itemRef: "wild_berries", quantity: "1d3", itemData: { name: "Wild Berries", type: "consumable", img: "icons/consumables/food/berries-ration-round-red.webp", system: { description: { value: "<p>Tart wild berries from the underbrush.</p>" }, rarity: "common" } } },
            { weight: 3, itemRef: "edible_mushrooms", quantity: "1d2", itemData: { name: "Edible Mushrooms", type: "consumable", img: "icons/consumables/mushrooms/bell-shiitake-brown.webp", system: { description: { value: "<p>Brown-capped mushrooms, safe to eat.</p>" }, rarity: "common" } } },
            { weight: 3, itemRef: "wild_herbs", quantity: "1d2", itemData: { name: "Wild Herbs", type: "loot", img: "icons/consumables/plants/leaf-herb-green.webp", system: { description: { value: "<p>Fragrant herbs from the forest floor.</p>" }, rarity: "common" } } }
        ]
    },
    {
        id: "stub_pool_swamp",
        name: "Swamp Foraging",
        terrainTag: "swamp",
        entries: [
            { weight: 4, itemRef: "edible_mushrooms", quantity: "1d2", itemData: { name: "Edible Mushrooms", type: "consumable", img: "icons/consumables/mushrooms/bell-shiitake-brown.webp", system: { description: { value: "<p>Damp-loving mushrooms growing on fallen logs.</p>" }, rarity: "common" } } },
            { weight: 3, itemRef: "wild_berries", quantity: "1d2", itemData: { name: "Wild Berries", type: "consumable", img: "icons/consumables/food/berries-ration-round-red.webp", system: { description: { value: "<p>Bog berries, tart and firm.</p>" }, rarity: "common" } } },
            { weight: 2, itemRef: "fresh_fish", quantity: 1, itemData: { name: "Fresh Fish", type: "consumable", img: "icons/consumables/meat/fish-whole-blue.webp", system: { description: { value: "<p>Freshwater fish from the marsh.</p>" }, rarity: "common" } } }
        ]
    },
    {
        id: "stub_pool_mountain",
        name: "Mountain Foraging",
        terrainTag: "mountain",
        entries: [
            { weight: 4, itemRef: "alpine_herbs", quantity: "1d2", itemData: { name: "Alpine Herbs", type: "loot", img: "icons/consumables/plants/herb-tied-bundle-green.webp", system: { description: { value: "<p>Hardy herbs from above the treeline.</p>" }, rarity: "common" } } },
            { weight: 3, itemRef: "wild_herbs", quantity: "1d2", itemData: { name: "Wild Herbs", type: "loot", img: "icons/consumables/plants/leaf-herb-green.webp", system: { description: { value: "<p>Mountain herbs clinging to rock crevices.</p>" }, rarity: "common" } } },
            { weight: 2, itemRef: "kindling", quantity: "1d3", itemData: { name: "Kindling", type: "loot", img: "icons/commodities/wood/kindling-sticks-brown.webp", system: { description: { value: "<p>Scrubby mountain wood, dry enough to burn.</p>" }, rarity: "common" } } }
        ]
    },
    {
        id: "stub_pool_arctic",
        name: "Arctic Foraging",
        terrainTag: "arctic",
        entries: [
            { weight: 4, itemRef: "alpine_herbs", quantity: "1d2", itemData: { name: "Alpine Herbs", type: "loot", img: "icons/consumables/plants/herb-tied-bundle-green.webp", system: { description: { value: "<p>Cold-resistant herbs scraped from frozen ground.</p>" }, rarity: "common" } } },
            { weight: 3, itemRef: "wild_berries", quantity: "1d2", itemData: { name: "Wild Berries", type: "consumable", img: "icons/consumables/food/berries-ration-round-red.webp", system: { description: { value: "<p>Frost-touched berries, bitter but edible.</p>" }, rarity: "common" } } },
            { weight: 2, itemRef: "kindling", quantity: "1d2", itemData: { name: "Kindling", type: "loot", img: "icons/commodities/wood/kindling-sticks-brown.webp", system: { description: { value: "<p>Scraps of driftwood and dried lichen.</p>" }, rarity: "common" } } }
        ]
    },
    {
        id: "stub_pool_desert",
        name: "Desert Foraging",
        terrainTag: "desert",
        entries: [
            { weight: 4, itemRef: "prickly_pear", quantity: "1d2", itemData: { name: "Prickly Pear", type: "consumable", img: "icons/consumables/fruit/pickly-pear-cactus-red-yellow.webp", system: { description: { value: "<p>Spiny desert fruit with sweet flesh.</p>" }, rarity: "common" } } },
            { weight: 2, itemRef: "kindling", quantity: "1d3", itemData: { name: "Kindling", type: "loot", img: "icons/commodities/wood/kindling-sticks-brown.webp", system: { description: { value: "<p>Sun-bleached scrub wood.</p>" }, rarity: "common" } } },
            { weight: 3, itemRef: "wild_herbs", quantity: "1d2", itemData: { name: "Wild Herbs", type: "loot", img: "icons/consumables/plants/leaf-herb-green.webp", system: { description: { value: "<p>Desert sage and dry herbs.</p>" }, rarity: "common" } } }
        ]
    }
];

// ═══════════════════════════════════════════════════════════════
//  HUNT YIELDS
// ═══════════════════════════════════════════════════════════════

export const STUB_HUNT_YIELDS = {
    wilderness: {
        standard: [{ type: "meat", qty: 1 }],
        exceptional: [{ type: "meat", qty: 2 }]
    },
    forest: {
        standard: [{ type: "meat", qty: 1 }],
        exceptional: [{ type: "meat", qty: 2 }]
    },
    swamp: {
        standard: [{ type: "fish", qty: 1 }],
        exceptional: [{ type: "fish", qty: 2 }]
    },
    mountain: {
        standard: [{ type: "meat", qty: 1 }],
        exceptional: [{ type: "meat", qty: 2 }]
    },
    arctic: {
        standard: [{ type: "meat", qty: 1 }],
        exceptional: [{ type: "meat", qty: 2 }]
    },
    desert: {
        standard: [{ type: "meat", qty: 1 }],
        exceptional: [{ type: "meat", qty: 2 }]
    }
};
