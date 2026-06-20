/**
 * Built-in stub content for the Respite module.
 * Recipes and hunt yields load when no imported pack supplies them.
 * Resource pools are not auto-loaded; travel and camp forage require pool data from an imported pack.
 */

// ═══════════════════════════════════════════════════════════════
//  RECIPES
// ═══════════════════════════════════════════════════════════════

export const STUB_RECIPES = {
    cooking: [
        {
            id: "stub_chef_bolstering_treats",
            name: "Bolstering Treats",
            profession: "cooking",
            description: "Chef feat: bake small treats. Each grants temporary hit points equal to your proficiency bonus when eaten (bonus action). Last 8 hours.",
            toolRequired: "cook",
            skill: "sur",
            dc: 8,
            chefFeatRequired: true,
            noSkillCheck: true,
            outputQuantityProficiency: true,
            ingredients: [],
            output: {
                name: "Bolstering Treat",
                type: "consumable",
                quantity: 1,
                img: "icons/consumables/food/bread-loaf-simple-brown.webp",
                description: "<p>A small baked treat from a Chef. Eat as a bonus action to gain temporary hit points equal to the cook's proficiency bonus. Spoils after 8 hours.</p>",
                rarity: "common",
                system: { type: { value: "food", subtype: "" } }
            },
            outputFlags: {
                "ionrift-respite": {
                    foodTag: "prepared",
                    spoilsAfterHours: 8,
                    wellFed: false,
                    chefTreat: true,
                    buff: {
                        type: "temp_hp",
                        formula: "@prof",
                        target: "self"
                    }
                }
            }
        },
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
                { name: "Water", quantity: 2, resourceType: "water" }
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
                img: "icons/consumables/mushrooms/bell-shiitake-brown.webp",
                description: "<p>Mushrooms roasted over a campfire. Counts as a meal.</p>",
                rarity: "common",
                system: { type: { value: "food", subtype: "" } }
            },
            ambitiousOutput: {
                name: "Seared Mushroom Medley",
                type: "consumable",
                quantity: 1,
                img: "icons/consumables/mushrooms/bell-shiitake-brown.webp",
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
                        save: { ability: "con" },
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
                itemRef: "smoked_fish",
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
                { name: "Rations", quantity: 1, perPartyMember: true },
                { name: "Fresh Meat", quantity: 1 },
                { name: "Water", quantity: 2, resourceType: "water" }
            ],
            output: {
                name: "Hearty Stew",
                type: "consumable",
                quantity: 1,
                img: "icons/consumables/food/bowl-stew-brown.webp",
                description: "<p>A thick stew made with fresh game meat. Counts as a meal that feeds the whole party.</p>",
                rarity: "common",
                system: { type: { value: "food", subtype: "" } }
            },
            ambitiousOutput: {
                name: "Rich Hunter's Stew",
                type: "consumable",
                quantity: 1,
                img: "icons/consumables/food/bowl-stew-brown.webp",
                description: "<p>A rich, aromatic stew slow-cooked with care.</p>",
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
    ],
    brewing: [
        {
            id: "stub_herbal_tea",
            name: "Herbal Tea",
            profession: "brewing",
            description: "Steep wild herbs into a calming tea.",
            toolRequired: "brewer",
            skill: "wis",
            dc: 12,
            ingredients: [
                { name: "Wild Herbs", quantity: 2 },
                { name: "Water", quantity: 1, resourceType: "water" }
            ],
            output: {
                name: "Herbal Tea",
                type: "consumable",
                quantity: 1,
                img: "icons/consumables/drinks/tea-jasmine-green.webp",
                description: "<p>A warm herbal infusion. Slight edge on the next Wisdom save.</p>",
                rarity: "common",
                system: { type: { value: "potion", subtype: "" } }
            },
            outputFlags: {
                "ionrift-respite": {
                    foodTag: "drink",
                    spoilsAfter: 2,
                    partyMeal: false,
                    wellFed: false,
                    satiates: ["water"],
                    buff: {
                        type: "save_advantage",
                        save: "wis",
                        duration: "4_hours",
                        target: "self"
                    }
                }
            },
            ambitiousOutput: {
                name: "Restorative Herbal Tea",
                type: "consumable",
                quantity: 1,
                img: "icons/consumables/drinks/tea-jasmine-green.webp",
                description: "<p>A strong brew shared around the fire. The whole party gains the benefit.</p>",
                rarity: "uncommon",
                system: { type: { value: "potion", subtype: "" } }
            },
            ambitiousOutputFlags: {
                "ionrift-respite": {
                    foodTag: "drink",
                    spoilsAfter: 2,
                    partyMeal: false,
                    wellFed: false,
                    satiates: ["water"],
                    buff: {
                        type: "save_advantage",
                        save: "wis",
                        duration: "4_hours",
                        target: "party"
                    }
                }
            }
        },
        {
            id: "stub_berry_cordial",
            name: "Berry Cordial",
            profession: "brewing",
            description: "Mash foraged berries into a sweet cordial.",
            toolRequired: "brewer",
            skill: "wis",
            dc: 11,
            ingredients: [{ name: "Wild Berries", quantity: 3 }],
            output: {
                name: "Berry Cordial",
                type: "consumable",
                quantity: 1,
                img: "icons/consumables/drinks/wine-amphora-pink.webp",
                description: "<p>Sweet berry cordial. +1 on the next Constitution save.</p>",
                rarity: "common",
                system: { type: { value: "potion", subtype: "" } }
            },
            outputFlags: {
                "ionrift-respite": {
                    foodTag: "drink",
                    spoilsAfter: 3,
                    partyMeal: false,
                    wellFed: false,
                    satiates: ["food"],
                    buff: {
                        type: "save_bonus",
                        save: "con",
                        formula: "1",
                        duration: "4_hours",
                        target: "self"
                    }
                }
            }
        },
        {
            id: "stub_hunters_brew",
            name: "Hunter's Brew",
            profession: "brewing",
            description: "Brew herbs and game drippings into a hearty camp drink.",
            toolRequired: "brewer",
            skill: "wis",
            dc: 12,
            ingredients: [
                { name: "Wild Herbs", quantity: 1 },
                { name: "Fresh Meat", quantity: 1 }
            ],
            output: {
                name: "Hunter's Brew",
                type: "consumable",
                quantity: 1,
                img: "icons/consumables/drinks/mug-metal-brown.webp",
                description: "<p>A savory broth-drink. Steadies the nerves before a hunt.</p>",
                rarity: "common",
                system: { type: { value: "potion", subtype: "" } }
            },
            outputFlags: {
                "ionrift-respite": {
                    foodTag: "drink",
                    spoilsAfter: 2,
                    partyMeal: false,
                    wellFed: false,
                    satiates: ["food", "water"],
                    buff: {
                        type: "initiative_bonus",
                        formula: "1",
                        duration: "4_hours",
                        target: "self"
                    }
                }
            }
        }
    ]
};

// ═══════════════════════════════════════════════════════════════
//  RESOURCE POOLS (reference only; not registered automatically)
// ═══════════════════════════════════════════════════════════════

export const STUB_POOLS = [
    {
        id: "stub_pool_wilderness",
        name: "Wilderness Foraging",
        terrainTag: "wilderness",
        entries: [
            { weight: 4, itemRef: "wild_herbs", quantity: "1d2", itemData: { name: "Wild Herbs", type: "consumable", img: "icons/consumables/plants/leaf-herb-green.webp", system: { description: { value: "<p>Common wild herbs. Useful for cooking.</p>" }, rarity: "common", type: { value: "food", subtype: "" } } } },
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
            { weight: 3, itemRef: "wild_herbs", quantity: "1d2", itemData: { name: "Wild Herbs", type: "consumable", img: "icons/consumables/plants/leaf-herb-green.webp", system: { description: { value: "<p>Fragrant herbs from the forest floor.</p>" }, rarity: "common", type: { value: "food", subtype: "" } } } }
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
            { weight: 4, itemRef: "alpine_herbs", quantity: "1d2", itemData: { name: "Alpine Herbs", type: "consumable", img: "icons/consumables/plants/herb-tied-bundle-green.webp", system: { description: { value: "<p>Hardy herbs from above the treeline.</p>" }, rarity: "common", type: { value: "food", subtype: "" } } } },
            { weight: 3, itemRef: "wild_herbs", quantity: "1d2", itemData: { name: "Wild Herbs", type: "consumable", img: "icons/consumables/plants/leaf-herb-green.webp", system: { description: { value: "<p>Mountain herbs clinging to rock crevices.</p>" }, rarity: "common", type: { value: "food", subtype: "" } } } },
            { weight: 2, itemRef: "kindling", quantity: "1d3", itemData: { name: "Kindling", type: "loot", img: "icons/commodities/wood/kindling-sticks-brown.webp", system: { description: { value: "<p>Scrubby mountain wood, dry enough to burn.</p>" }, rarity: "common" } } }
        ]
    },
    {
        id: "stub_pool_arctic",
        name: "Arctic Foraging",
        terrainTag: "arctic",
        entries: [
            { weight: 4, itemRef: "alpine_herbs", quantity: "1d2", itemData: { name: "Alpine Herbs", type: "consumable", img: "icons/consumables/plants/herb-tied-bundle-green.webp", system: { description: { value: "<p>Cold-resistant herbs scraped from frozen ground.</p>" }, rarity: "common", type: { value: "food", subtype: "" } } } },
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
            { weight: 3, itemRef: "wild_herbs", quantity: "1d2", itemData: { name: "Wild Herbs", type: "consumable", img: "icons/consumables/plants/leaf-herb-green.webp", system: { description: { value: "<p>Desert sage and dry herbs.</p>" }, rarity: "common", type: { value: "food", subtype: "" } } } }
        ]
    }
];

// ═══════════════════════════════════════════════════════════════
//  HUNT YIELDS (built-in fallback when no pack tables loaded)
// ═══════════════════════════════════════════════════════════════

export const STUB_HUNT_YIELDS = {
    forest: {
        standard: [{ type: "meat", qty: 1 }],
        exceptional: [{ type: "meat", qty: 1 }, { type: "choice_cut", qty: 1 }]
    },
    swamp: {
        standard: [{ type: "fish", qty: 1 }],
        exceptional: [{ type: "fish", qty: 2 }]
    },
    mountain: {
        standard: [{ type: "meat", qty: 1 }],
        exceptional: [{ type: "choice_cut", qty: 1 }]
    },
    arctic: {
        standard: [{ type: "meat", qty: 1 }],
        exceptional: [{ type: "meat", qty: 1 }, { type: "animal_fat", qty: 1 }]
    },
    desert: {
        standard: [{ type: "meat", qty: 1 }],
        exceptional: [{ type: "meat", qty: 1 }, { type: "venom_sac", qty: 1 }]
    },
    wilderness: {
        standard: [{ type: "meat", qty: 1 }],
        exceptional: [{ type: "choice_cut", qty: 1 }, { type: "meat", qty: 1 }]
    }
};
