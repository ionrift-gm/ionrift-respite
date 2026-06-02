import { describe, it, expect, beforeEach } from "vitest";
import { ItemClassifier } from "../scripts/services/ItemClassifier.js";

/**
 * ItemClassifier regression tests.
 *
 * Covers the classification cascade, diet-aware food/water filtering,
 * drink sub-types, food tag inference, spoilage windows, essence diets,
 * and the container-aware water exclusion fix (5ab2b1d).
 */

const MODULE_ID = "ionrift-respite";

function makeItem(overrides = {}) {
    return {
        name: overrides.name ?? "Generic Item",
        type: overrides.type ?? "loot",
        system: { quantity: 1, type: {}, ...(overrides.system ?? {}) },
        flags: overrides.flags ?? {},
        img: overrides.img ?? null,
        id: overrides.id ?? "item-001",
        ...overrides
    };
}

function makeActor(overrides = {}) {
    return {
        id: overrides.id ?? "actor-001",
        name: overrides.name ?? "Test Actor",
        items: overrides.items ?? [],
        flags: overrides.flags ?? {},
        system: { abilities: { con: { mod: 2 } }, ...(overrides.system ?? {}) },
        getFlag: function(mod, key) {
            return this.flags?.[mod]?.[key] ?? undefined;
        },
        ...overrides
    };
}

beforeEach(() => {
    globalThis.game = {
        system: { id: "dnd5e" },
        settings: { get: () => "" },
        modules: { get: () => null },
        actors: { get: () => null },
        users: []
    };
});

describe("ItemClassifier", () => {

    // ── classify cascade ────────────────────────────────────────

    describe("classify", () => {
        it("returns null for null/undefined item", () => {
            expect(ItemClassifier.classify(null)).toBeNull();
            expect(ItemClassifier.classify(undefined)).toBeNull();
        });

        it("honors explicit resourceType flag (highest priority)", () => {
            const item = makeItem({
                name: "Mystery Drink",
                flags: { [MODULE_ID]: { resourceType: "water" } }
            });
            expect(ItemClassifier.classify(item)).toBe("water");
        });

        it("ignores invalid resourceType flag values", () => {
            const item = makeItem({
                name: "Rations",
                flags: { [MODULE_ID]: { resourceType: "BOGUS" } }
            });
            expect(ItemClassifier.classify(item)).toBe("food");
        });

        it("migrates legacy foodType 'food' flag", () => {
            const item = makeItem({
                name: "Old Bread",
                flags: { [MODULE_ID]: { foodType: "food" } }
            });
            expect(ItemClassifier.classify(item)).toBe("food");
        });

        it("migrates legacy foodType 'water' flag", () => {
            const item = makeItem({
                name: "Old Canteen",
                flags: { [MODULE_ID]: { foodType: "water" } }
            });
            expect(ItemClassifier.classify(item)).toBe("water");
        });

        it("classifies built-in water names", () => {
            expect(ItemClassifier.classify(makeItem({ name: "Waterskin" }))).toBe("water");
            expect(ItemClassifier.classify(makeItem({ name: "Water Flask" }))).toBe("water");
            expect(ItemClassifier.classify(makeItem({ name: "Water (Pint)" }))).toBe("water");
        });

        it("classifies ingredient names before DnD5e food subtype", () => {
            const herbs = makeItem({
                name: "Wild Herbs",
                type: "consumable",
                system: { type: { value: "food" } }
            });
            expect(ItemClassifier.classify(herbs)).toBe("ingredient");
        });

        it("classifies items with foodTag flag as food", () => {
            const meal = makeItem({
                name: "Custom Stew",
                flags: { [MODULE_ID]: { foodTag: "prepared" } }
            });
            expect(ItemClassifier.classify(meal)).toBe("food");
        });

        it("classifies cooked_meal foodTag as food", () => {
            const meal = makeItem({
                name: "Chef's Special",
                flags: { [MODULE_ID]: { foodTag: "cooked_meal" } }
            });
            expect(ItemClassifier.classify(meal)).toBe("food");
        });

        it("classifies DnD5e consumable food subtype", () => {
            const ration = makeItem({
                name: "Explorer's Pack Food",
                type: "consumable",
                system: { type: { value: "food" } }
            });
            expect(ItemClassifier.classify(ration)).toBe("food");
        });

        it("classifies built-in food names", () => {
            expect(ItemClassifier.classify(makeItem({ name: "Rations" }))).toBe("food");
            expect(ItemClassifier.classify(makeItem({ name: "Trail Rations" }))).toBe("food");
        });

        it("classifies built-in fuel names", () => {
            expect(ItemClassifier.classify(makeItem({ name: "Torch" }))).toBe("fuel");
            expect(ItemClassifier.classify(makeItem({ name: "Firewood" }))).toBe("fuel");
        });

        it("returns null for unclassified items", () => {
            expect(ItemClassifier.classify(makeItem({ name: "Sword" }))).toBeNull();
        });
    });

    // ── getDrinkType ────────────────────────────────────────────

    describe("getDrinkType", () => {
        it("returns null for null item", () => {
            expect(ItemClassifier.getDrinkType(null)).toBeNull();
        });

        it("honors explicit drinkType flag", () => {
            const item = makeItem({
                name: "Potion",
                flags: { [MODULE_ID]: { drinkType: "alcohol" } }
            });
            expect(ItemClassifier.getDrinkType(item)).toBe("alcohol");
        });

        it("infers oil from name", () => {
            expect(ItemClassifier.getDrinkType(makeItem({ name: "Oil Flask" }))).toBe("oil");
            expect(ItemClassifier.getDrinkType(makeItem({ name: "Lamp Oil" }))).toBe("oil");
        });

        it("infers alcohol from name", () => {
            expect(ItemClassifier.getDrinkType(makeItem({ name: "Dwarven Ale" }))).toBe("alcohol");
            expect(ItemClassifier.getDrinkType(makeItem({ name: "Elven Wine" }))).toBe("alcohol");
            expect(ItemClassifier.getDrinkType(makeItem({ name: "Fire Whiskey" }))).toBe("alcohol");
        });

        it("returns 'water' for water-classified items", () => {
            expect(ItemClassifier.getDrinkType(makeItem({ name: "Waterskin" }))).toBe("water");
        });

        it("returns null for non-drink items", () => {
            expect(ItemClassifier.getDrinkType(makeItem({ name: "Sword" }))).toBeNull();
        });
    });

    // ── getFoodTag ──────────────────────────────────────────────

    describe("getFoodTag", () => {
        it("returns null for null item", () => {
            expect(ItemClassifier.getFoodTag(null)).toBeNull();
        });

        it("honors explicit foodTag flag", () => {
            const item = makeItem({
                name: "Custom Food",
                flags: { [MODULE_ID]: { foodTag: "meat" } }
            });
            expect(ItemClassifier.getFoodTag(item)).toBe("meat");
        });

        it("infers meat tag from name", () => {
            expect(ItemClassifier.getFoodTag(makeItem({ name: "Fresh Meat" }))).toBe("meat");
            expect(ItemClassifier.getFoodTag(makeItem({ name: "Venison" }))).toBe("meat");
        });

        it("infers plant tag from name", () => {
            expect(ItemClassifier.getFoodTag(makeItem({ name: "Edible Berries" }))).toBe("plant");
            expect(ItemClassifier.getFoodTag(makeItem({ name: "Wild Berries" }))).toBe("plant");
        });

        it("infers prepared tag from name", () => {
            expect(ItemClassifier.getFoodTag(makeItem({ name: "Rations" }))).toBe("prepared");
            expect(ItemClassifier.getFoodTag(makeItem({ name: "Smoked Fish" }))).toBe("prepared");
        });

        it("returns 'prepared' for generic food items", () => {
            const food = makeItem({
                name: "Mystery Food",
                type: "consumable",
                system: { type: { value: "food" } }
            });
            expect(ItemClassifier.getFoodTag(food)).toBe("prepared");
        });

        it("returns null for non-food items", () => {
            expect(ItemClassifier.getFoodTag(makeItem({ name: "Sword" }))).toBeNull();
        });
    });

    // ── getSpoilsAfter ─────────────────────────────────────────

    describe("getSpoilsAfter", () => {
        it("returns null for non-food items", () => {
            expect(ItemClassifier.getSpoilsAfter(makeItem({ name: "Sword" }))).toBeNull();
        });

        it("honors explicit spoilsAfter flag", () => {
            const item = makeItem({
                name: "Custom Food",
                type: "consumable",
                system: { type: { value: "food" } },
                flags: { [MODULE_ID]: { spoilsAfter: 5 } }
            });
            expect(ItemClassifier.getSpoilsAfter(item)).toBe(5);
        });

        it("returns null when spoilsAfter is 0 or negative", () => {
            const item = makeItem({
                name: "Preserved",
                flags: { [MODULE_ID]: { spoilsAfter: 0 } }
            });
            expect(ItemClassifier.getSpoilsAfter(item)).toBeNull();
        });

        it("infers spoilage from food tag: meat = 1 day", () => {
            expect(ItemClassifier.getSpoilsAfter(makeItem({ name: "Fresh Meat" }))).toBe(1);
        });

        it("infers spoilage from food tag: plant = 3 days", () => {
            expect(ItemClassifier.getSpoilsAfter(makeItem({ name: "Edible Berries" }))).toBe(3);
        });

        it("infers spoilage from food tag: prepared = null (shelf-stable)", () => {
            expect(ItemClassifier.getSpoilsAfter(makeItem({ name: "Rations" }))).toBeNull();
        });
    });

    // ── isFood (diet-aware) ─────────────────────────────────────

    describe("isFood", () => {
        it("returns true for standard food with default diet", () => {
            const actor = makeActor();
            const item = makeItem({ name: "Rations" });
            expect(ItemClassifier.isFood(item, actor)).toBe(true);
        });

        it("herbivore rejects meat", () => {
            const actor = makeActor({
                flags: { [MODULE_ID]: { diet: { canEatTags: ["plant", "prepared"] } } }
            });
            const meat = makeItem({ name: "Fresh Meat" });
            expect(ItemClassifier.isFood(meat, actor)).toBe(false);
        });

        it("carnivore rejects plant", () => {
            const actor = makeActor({
                flags: { [MODULE_ID]: { diet: { canEatTags: ["meat", "prepared"] } } }
            });
            const plant = makeItem({ name: "Edible Berries" });
            expect(ItemClassifier.isFood(plant, actor)).toBe(false);
        });

        it("excludeNames blocks specific items", () => {
            const actor = makeActor({
                flags: { [MODULE_ID]: { diet: { excludeNames: ["rations"] } } }
            });
            expect(ItemClassifier.isFood(makeItem({ name: "Rations" }), actor)).toBe(false);
        });

        it("essence diet delegates to isEssence", () => {
            const actor = makeActor({
                flags: { [MODULE_ID]: { diet: { sustenanceType: "essence", customFoodNames: ["soul fragment"] } } }
            });
            const essence = makeItem({ name: "Soul Fragment" });
            expect(ItemClassifier.isFood(essence, actor)).toBe(true);
        });

        it("returns false without actor for non-food item", () => {
            expect(ItemClassifier.isFood(makeItem({ name: "Sword" }))).toBe(false);
        });
    });

    // ── isWater (diet-aware) ────────────────────────────────────

    describe("isWater", () => {
        it("returns true for waterskin with default diet", () => {
            expect(ItemClassifier.isWater(makeItem({ name: "Waterskin" }))).toBe(true);
        });

        it("construct diet accepts oil as water", () => {
            const actor = makeActor({
                flags: {
                    [MODULE_ID]: {
                        diet: {
                            canDrink: ["oil"],
                            canEat: ["fuel"],
                            customFoodNames: [],
                            customWaterNames: ["oil flask"],
                            sustenanceType: "essence"
                        }
                    }
                }
            });
            expect(ItemClassifier.isWater(makeItem({ name: "Oil Flask" }), actor)).toBe(true);
        });

        it("customWaterNames add items to the water tray", () => {
            const actor = makeActor({
                flags: { [MODULE_ID]: { diet: { customWaterNames: ["moon juice"] } } }
            });
            expect(ItemClassifier.isWater(makeItem({ name: "Moon Juice" }), actor)).toBe(true);
        });

        it("returns false for non-water items with default diet", () => {
            expect(ItemClassifier.isWater(makeItem({ name: "Sword" }))).toBe(false);
        });
    });

    // ── isEssence ───────────────────────────────────────────────

    describe("isEssence", () => {
        it("returns true for explicit essence resourceType", () => {
            const item = makeItem({ flags: { [MODULE_ID]: { resourceType: "essence" } } });
            expect(ItemClassifier.isEssence(item)).toBe(true);
        });

        it("returns true for built-in essence names without actor", () => {
            expect(ItemClassifier.isEssence(makeItem({ name: "Arcane Crystal" }))).toBe(true);
        });

        it("returns true for oil-type drinks without actor", () => {
            expect(ItemClassifier.isEssence(makeItem({ name: "Oil Flask" }))).toBe(true);
        });

        it("returns true for fuel items without actor", () => {
            expect(ItemClassifier.isEssence(makeItem({ name: "Torch" }))).toBe(true);
        });

        it("returns false for essence item when actor diet is not essence", () => {
            const actor = makeActor();
            expect(ItemClassifier.isEssence(makeItem({ name: "Oil Flask" }), actor)).toBe(false);
        });

        it("construct diet accepts customFoodNames as essence", () => {
            const actor = makeActor({
                flags: {
                    [MODULE_ID]: {
                        diet: {
                            sustenanceType: "essence",
                            canEat: ["fuel"],
                            canDrink: ["oil"],
                            customFoodNames: ["scrap metal"]
                        }
                    }
                }
            });
            expect(ItemClassifier.isEssence(makeItem({ name: "Scrap Metal" }), actor)).toBe(true);
        });
    });

    // ── isEssenceMealFoodOption ──────────────────────────────────

    describe("isEssenceMealFoodOption", () => {
        it("returns true for essence items that are NOT water for the actor", () => {
            const actor = makeActor({
                flags: {
                    [MODULE_ID]: {
                        diet: {
                            sustenanceType: "essence",
                            canEat: ["fuel"],
                            canDrink: [],
                            customFoodNames: ["soul fragment"],
                            customWaterNames: []
                        }
                    }
                }
            });
            expect(ItemClassifier.isEssenceMealFoodOption(
                makeItem({ name: "Soul Fragment" }), actor
            )).toBe(true);
        });

        it("excludes items that also qualify as water for the actor", () => {
            const actor = makeActor({
                flags: {
                    [MODULE_ID]: {
                        diet: {
                            sustenanceType: "essence",
                            canEat: ["fuel"],
                            canDrink: ["oil"],
                            customFoodNames: ["oil flask"],
                            customWaterNames: ["oil flask"]
                        }
                    }
                }
            });
            expect(ItemClassifier.isEssenceMealFoodOption(
                makeItem({ name: "Oil Flask" }), actor
            )).toBe(false);
        });
    });

    // ── Diet management ─────────────────────────────────────────

    describe("getDiet", () => {
        it("returns DEFAULT_DIET when actor is null", () => {
            const diet = ItemClassifier.getDiet(null);
            expect(diet.canEat).toEqual(["food"]);
            expect(diet.canDrink).toEqual(["water"]);
            expect(diet.sustenanceType).toBe("food");
        });

        it("returns DEFAULT_DIET when actor has no diet flag", () => {
            const diet = ItemClassifier.getDiet(makeActor());
            expect(diet.label).toBe("Standard");
        });

        it("merges stored diet over defaults", () => {
            const actor = makeActor({
                flags: { [MODULE_ID]: { diet: { canEatTags: ["meat"] } } }
            });
            const diet = ItemClassifier.getDiet(actor);
            expect(diet.canEatTags).toEqual(["meat"]);
            expect(diet.canEat).toEqual(["food"]);
        });

        it("normalizes comma-separated customFoodNames string to array", () => {
            const actor = makeActor({
                flags: { [MODULE_ID]: { diet: { customFoodNames: "soul fragment, bone dust" } } }
            });
            const diet = ItemClassifier.getDiet(actor);
            expect(diet.customFoodNames).toEqual(["soul fragment", "bone dust"]);
        });
    });

    // ── getSustenanceType ───────────────────────────────────────

    describe("getSustenanceType", () => {
        it("returns 'food' by default", () => {
            expect(ItemClassifier.getSustenanceType(makeActor())).toBe("food");
        });

        it("returns 'essence' for construct diet", () => {
            const actor = makeActor({
                flags: { [MODULE_ID]: { diet: { sustenanceType: "essence" } } }
            });
            expect(ItemClassifier.getSustenanceType(actor)).toBe("essence");
        });

        it("returns 'none' for no-sustenance actors", () => {
            const actor = makeActor({
                flags: { [MODULE_ID]: { diet: { sustenanceType: "none" } } }
            });
            expect(ItemClassifier.getSustenanceType(actor)).toBe("none");
        });

        it("falls back from legacy requiresEssence flag when sustenanceType is absent", () => {
            const actor = makeActor({
                flags: { [MODULE_ID]: { diet: { requiresEssence: true, sustenanceType: null } } }
            });
            expect(ItemClassifier.getSustenanceType(actor)).toBe("essence");
        });

        it("sustenanceType takes precedence over legacy requiresEssence", () => {
            const actor = makeActor({
                flags: { [MODULE_ID]: { diet: { requiresEssence: true, sustenanceType: "food" } } }
            });
            expect(ItemClassifier.getSustenanceType(actor)).toBe("food");
        });
    });

    // ── getPresets ──────────────────────────────────────────────

    describe("getPresets", () => {
        it("returns all preset entries with id and label", () => {
            const presets = ItemClassifier.getPresets();
            expect(presets.length).toBeGreaterThan(0);
            const ids = presets.map(p => p.id);
            expect(ids).toContain("standard");
            expect(ids).toContain("construct");
            expect(ids).toContain("undead");
            expect(ids).toContain("celestial");
            for (const p of presets) {
                expect(p.label).toBeTruthy();
            }
        });
    });
});
