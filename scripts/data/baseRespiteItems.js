/**
 * Canonical fallback definitions for the base provisions shipped in
 * `packs/src/respite-items/`. On non-dnd5e worlds Foundry does not mount the
 * dnd5e-typed `ionrift-respite.respite-items` LevelDB pack, and `packs/src/`
 * is omitted from release zips, so `ItemOutcomeHandler` falls back to this
 * catalog whenever `!isHomebrewProvisionOnly()` and the compendium pack is
 * unavailable.
 */
export const BASE_RESPITE_ITEMS = Object.freeze({
    kindling: {
        name: "Kindling",
        type: "loot",
        img: "icons/commodities/wood/kindling-sticks-brown.webp",
        system: {
            description: { value: "<p>A bundle of dry twigs</p>" },
            rarity: "common",
            weight: 0.5,
            price: { value: 1, denomination: "cp" }
        },
        flags: {
            "ionrift-respite": {
                itemRef: "kindling",
                category: "camp_fuel",
                firewoodType: "kindling",
                cacheEligible: true
            }
        }
    },
    wild_herbs: {
        name: "Wild Herbs",
        type: "consumable",
        img: "icons/consumables/plants/leaf-herb-green.webp",
        system: {
            description: { value: "<p>A collection of wild herbs, chives, dill weed and the likes</p>" },
            rarity: "common",
            weight: 0.1,
            price: { value: 2, denomination: "cp" },
            type: { value: "food", subtype: "" }
        },
        flags: {
            "ionrift-respite": {
                itemRef: "wild_herbs",
                terrain: "wilderness,forest,desert",
                category: "forage"
            }
        }
    },
    wild_berries: {
        name: "Wild Berries",
        type: "consumable",
        img: "icons/consumables/food/berries-ration-round-red.webp",
        system: {
            description: { value: "<p>Wild berries, make sure you wash the bugs off</p>" },
            rarity: "common",
            weight: 0.1,
            price: { value: 1, denomination: "cp" },
            type: { value: "food", subtype: "" }
        },
        flags: {
            "ionrift-respite": {
                itemRef: "wild_berries",
                terrain: "forest,swamp,wilderness",
                category: "forage",
                spoilsAfter: 3
            }
        }
    },
    edible_mushrooms: {
        name: "Edible Mushrooms",
        type: "consumable",
        img: "icons/consumables/mushrooms/bell-shiitake-brown.webp",
        system: {
            description: { value: "<p>Collection of small edible mushrooms</p>" },
            rarity: "common",
            weight: 0.1,
            price: { value: 1, denomination: "cp" },
            type: { value: "food", subtype: "" }
        },
        flags: {
            "ionrift-respite": {
                itemRef: "edible_mushrooms",
                terrain: "forest,swamp,mountain",
                category: "forage",
                spoilsAfter: 3
            }
        }
    },
    fresh_meat: {
        name: "Fresh Meat",
        type: "consumable",
        img: "icons/consumables/meat/steak-raw-red-pink.webp",
        system: {
            description: { value: "<p>Freshly butchered game meat</p>" },
            rarity: "common",
            weight: 1,
            price: { value: 5, denomination: "cp" },
            type: { value: "food", subtype: "" }
        },
        flags: {
            "ionrift-respite": {
                itemRef: "fresh_meat",
                terrain: "any",
                category: "hunt",
                foodTag: "raw_meat",
                spoilsAfter: 2
            }
        }
    },
    fresh_fish: {
        name: "Fresh Fish",
        type: "consumable",
        img: "icons/consumables/meat/fish-whole-blue.webp",
        system: {
            description: { value: "<p>A fresh fish, eyes are clean. Needs preparing and cooking.</p>" },
            rarity: "common",
            weight: 0.5,
            price: { value: 3, denomination: "cp" },
            type: { value: "food", subtype: "" }
        },
        flags: {
            "ionrift-respite": {
                itemRef: "fresh_fish",
                terrain: "swamp,coast",
                category: "hunt",
                foodTag: "raw_fish",
                spoilsAfter: 2
            }
        }
    },
    camp_porridge: {
        name: "Camp Porridge",
        type: "consumable",
        img: "icons/consumables/food/bowl-stew-tofu-potato-brown.webp",
        system: {
            description: { value: "<p>As you like it: hot, cold, or just right</p>" },
            rarity: "common",
            weight: 0.5,
            price: { value: 2, denomination: "cp" },
            type: { value: "food", subtype: "" },
            uses: { max: 1, per: "charges", autoDestroy: true }
        },
        flags: {
            "ionrift-respite": {
                itemRef: "camp_porridge",
                category: "prepared",
                foodTag: "cooked_meal"
            }
        }
    },
    seasoned_rations: {
        name: "Seasoned Rations",
        type: "consumable",
        img: "icons/consumables/food/dried-meat-jerky-fish-red.webp",
        system: {
            description: { value: "<p>Rations with a little extra seasoning</p>" },
            rarity: "common",
            weight: 0.5,
            price: { value: 3, denomination: "cp" },
            type: { value: "food", subtype: "" },
            uses: { max: 1, per: "charges", autoDestroy: true }
        },
        flags: {
            "ionrift-respite": {
                itemRef: "seasoned_rations",
                category: "prepared",
                foodTag: "cooked_meal"
            }
        }
    },
    hearty_stew: {
        name: "Hearty Stew",
        type: "consumable",
        img: "icons/consumables/food/bowl-stew-brown.webp",
        system: {
            description: { value: "<p>A thick stew made with anything you can rustle up</p>" },
            rarity: "common",
            weight: 1,
            price: { value: 8, denomination: "cp" },
            type: { value: "food", subtype: "" },
            uses: { max: 1, per: "charges", autoDestroy: true }
        },
        flags: {
            "ionrift-respite": {
                itemRef: "hearty_stew",
                category: "prepared",
                foodTag: "cooked_meal"
            }
        }
    },
    smoked_fish: {
        name: "Smoked Fish",
        type: "consumable",
        img: "icons/consumables/food/fish-fillet-steak-brown.webp",
        system: {
            description: { value: "<p>Smoked fish with a deep color, smells good, ready to eat</p>" },
            rarity: "common",
            weight: 0.5,
            price: { value: 5, denomination: "cp" },
            type: { value: "food", subtype: "" },
            uses: { max: 1, per: "charges", autoDestroy: true }
        },
        flags: {
            "ionrift-respite": {
                itemRef: "smoked_fish",
                category: "prepared",
                foodTag: "preserved"
            }
        }
    },
    berry_preserves: {
        name: "Berry Preserves",
        type: "consumable",
        img: "icons/consumables/food/preserves-jam-jelly-jar-brown-red.webp",
        system: {
            description: { value: "<p>Berries and fruits made into jam</p>" },
            rarity: "common",
            weight: 0.5,
            price: { value: 4, denomination: "cp" },
            type: { value: "food", subtype: "" },
            uses: { max: 1, per: "charges", autoDestroy: true }
        },
        flags: {
            "ionrift-respite": {
                itemRef: "berry_preserves",
                category: "prepared",
                foodTag: "preserved"
            }
        }
    },
    roasted_mushrooms: {
        name: "Roasted Mushrooms",
        type: "consumable",
        img: "icons/consumables/mushrooms/bell-shiitake-brown.webp",
        system: {
            description: { value: "<p>Roasted mushrooms sizzling and ready to eat</p>" },
            rarity: "common",
            weight: 0.3,
            price: { value: 3, denomination: "cp" },
            type: { value: "food", subtype: "" },
            uses: { max: 1, per: "charges", autoDestroy: true }
        },
        flags: {
            "ionrift-respite": {
                itemRef: "roasted_mushrooms",
                category: "prepared",
                foodTag: "cooked_meal"
            }
        }
    },
    stub_chef_bolstering_treats__out: {
        name: "Bolstering Treat",
        type: "consumable",
        img: "icons/consumables/food/berries-ration-round-red.webp",
        system: {
            description: { value: "<p>Small chef treat, grants temporary hit points</p>" },
            rarity: "common",
            weight: 0.1,
            price: { value: 2, denomination: "cp" },
            type: { value: "food", subtype: "" },
            uses: { max: 1, per: "charges", autoDestroy: true }
        },
        flags: {
            "ionrift-respite": {
                itemRef: "stub_chef_bolstering_treats__out",
                category: "prepared",
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
    }
});
