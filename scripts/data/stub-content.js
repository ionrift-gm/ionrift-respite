/**
 * Built-in stub content for the Respite module.
 * Recipes and hunt yields load when no imported pack supplies them.
 * Resource pools are not auto-loaded; travel and camp forage require pool data from an imported pack.
 */

//  RECIPES

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
                img: "icons/consumables/food/berries-ration-round-red.webp",
                itemRef: "stub_chef_bolstering_treats__out",
                description: "<p>A small baked treat from a Chef. Eat as a bonus action to gain temporary hit points equal to the cook's proficiency bonus. Spoils after 8 hours.</p>",
                rarity: "common",
                system: { type: { value: "food", subtype: "" } }
            },
            outputFlags: {
                "ionrift-respite": {
                    itemRef: "stub_chef_bolstering_treats__out",
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
    ]
};

//  HUNT YIELDS (built-in fallback when no pack tables loaded)

export const STUB_HUNT_YIELDS = {
    forest: {
        standard: [{ itemRef: "fresh_meat", qty: 1 }],
        exceptional: [{ itemRef: "fresh_meat", qty: 1 }, { itemRef: "choice_cut", qty: 1 }]
    },
    swamp: {
        standard: [{ itemRef: "fresh_fish", qty: 1 }],
        exceptional: [{ itemRef: "fresh_fish", qty: 2 }]
    },
    mountain: {
        standard: [{ itemRef: "fresh_meat", qty: 1 }],
        exceptional: [{ itemRef: "choice_cut", qty: 1 }]
    },
    arctic: {
        standard: [{ itemRef: "fresh_meat", qty: 1 }],
        exceptional: [{ itemRef: "fresh_meat", qty: 1 }, { itemRef: "animal_fat", qty: 1 }]
    },
    desert: {
        standard: [{ itemRef: "fresh_meat", qty: 1 }],
        exceptional: [{ itemRef: "fresh_meat", qty: 1 }, { itemRef: "venom_sac", qty: 1 }]
    },
    wilderness: {
        standard: [{ itemRef: "fresh_meat", qty: 1 }],
        exceptional: [{ itemRef: "choice_cut", qty: 1 }, { itemRef: "fresh_meat", qty: 1 }]
    }
};
