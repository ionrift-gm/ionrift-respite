/**
 * ItemClassifier
 * Unified item classification service for Respite's food, water, fuel,
 * and ingredient systems. Single source of truth for "what is this item?"
 *
 * Classification cascade (first match wins):
 *   1. Explicit flag: item.flags["ionrift-respite"].resourceType
 *   2. DnD5e consumable subtype: system.type.value === "food" (after water exclusion)
 *   3. Name list fallback: built-in names + GM custom names
 *   4. Unclassified: no classification signal
 *
 * Also handles:
 *   - Per-character diet profiles (actor.flags["ionrift-respite"].diet)
 *   - Drink sub-categorisation (drinkType: water/alcohol/oil/other)
 *   - Legacy flag migration (foodType -> resourceType)
 */

const MODULE_ID = "ionrift-respite";

/** Built-in food item names (lowercase). */
const FOOD_NAMES = new Set([
    "rations", "rations (1 day)", "trail rations", "iron rations"
]);

/** Built-in water item names (lowercase). */
const WATER_NAMES = new Set([
    "waterskin", "water flask", "canteen",
    "water (pint)", "water, fresh (pint)", "water, salt (pint)"
]);

/** Built-in fuel item names (lowercase). */
const FUEL_NAMES = new Set([
    "torch", "candle", "lamp oil", "oil flask",
    "tinderbox", "firewood", "dry firewood", "kindling"
]);

/** Built-in essence item names (lowercase) — recharge items for non-biological characters. */
const ESSENCE_NAMES = new Set([
    "oil flask", "lamp oil", "arcane crystal", "soul fragment",
    "ether shard", "residuum"
]);

/**
 * Valid resourceType values.
 * @type {Set<string>}
 */
const RESOURCE_TYPES = new Set(["food", "water", "fuel", "ingredient", "none"]);

/**
 * Valid drinkType values.
 * @type {Set<string>}
 */
const DRINK_TYPES = new Set(["water", "alcohol", "oil"]);

/**
 * Food sub-categories. Items classified as "food" get a secondary tag
 * that determines which dietary presets accept them.
 * @type {Set<string>}
 */
const FOOD_TAGS = new Set(["meat", "plant", "prepared"]);

/**
 * Default spoilage windows (in rests/days) by food tag.
 * Used when an item has no explicit spoilsAfter flag.
 * null = does not spoil (preserved / shelf-stable).
 */
const DEFAULT_SPOILS_AFTER = {
    meat: 1,
    plant: 3,
    prepared: null
};

/**
 * Name-based food tag inference for items without an explicit flag.
 * First match wins.
 */
const FOOD_TAG_NAMES = {
    meat: new Set([
        "fresh meat", "fresh fish", "choice cut", "bird eggs",
        "raw meat", "game meat", "venison", "mutton", "pork", "beef"
    ]),
    plant: new Set([
        "edible berries", "wild berries", "snow berries", "edible mushrooms",
        "cattail stalks", "desert tubers", "wild honeycomb",
        "wild herbs", "healing herbs", "alpine herbs", "goodberries"
    ]),
    prepared: new Set([
        "rations", "rations (1 day)", "trail rations", "iron rations",
        "camp porridge", "smoked fish", "spiced jerky", "berry preserves",
        "fortified trail rations"
    ])
};

/**
 * Items that are cooking/crafting ingredients — not edible raw rations.
 * These classify as "ingredient" even though their DnD5e subtype is "food".
 * Goodberries are intentionally excluded: they are edible as-is.
 */
const INGREDIENT_NAMES = new Set([
    "wild herbs", "healing herbs", "alpine herbs"
]);

/**
 * Sustenance types — determines what a character needs to survive.
 *   "food"    — standard biological: needs food + water (default)
 *   "essence" — magical/construct: needs essence items (oil, crystals, etc.)
 *   "none"    — truly needs nothing (GM override, rare)
 */
const SUSTENANCE_TYPES = new Set(["food", "essence", "none"]);

/**
 * Default diet profile. Applied when an actor has no diet flag set.
 * @type {Object}
 */
const DEFAULT_DIET = {
    canEat: ["food"],
    canEatTags: ["meat", "plant", "prepared"],
    canDrink: ["water"],
    customFoodNames: [],
    customWaterNames: [],
    excludeNames: [],
    sustenanceType: "food",
    label: "Standard"
};

/**
 * Preset diet profiles. GM selects one, then customises if needed.
 * Keys are the preset ID; values are partial diet objects merged over DEFAULT_DIET.
 */
const DIET_PRESETS = {
    standard: {
        label: "Standard"
    },
    herbivore: {
        canEat: ["food"],
        canEatTags: ["plant", "prepared"],
        canDrink: ["water"],
        label: "Herbivore"
    },
    carnivore: {
        canEat: ["food"],
        canEatTags: ["meat", "prepared"],
        canDrink: ["water"],
        label: "Carnivore"
    },
    omnivore: {
        canEat: ["food", "ingredient"],
        canEatTags: ["meat", "plant", "prepared"],
        canDrink: ["water", "alcohol"],
        label: "Omnivore"
    },
    construct: {
        canEat: ["fuel"],
        canEatTags: [],
        canDrink: ["oil"],
        customFoodNames: ["scrap metal", "iron filings", "crate wood"],
        customWaterNames: ["oil flask", "lamp oil"],
        excludeNames: [],
        sustenanceType: "essence",
        label: "Construct"
    },
    undead: {
        canEat: [],
        canEatTags: [],
        canDrink: [],
        customFoodNames: ["soul fragment", "bone dust", "dark candle", "necrotic essence"],
        customWaterNames: [],
        excludeNames: [],
        sustenanceType: "essence",
        label: "Undead"
    },
    celestial: {
        canEat: [],
        canEatTags: [],
        canDrink: ["water"],
        customFoodNames: ["incense", "blessed candle", "prayer beads", "holy water"],
        customWaterNames: [],
        excludeNames: [],
        sustenanceType: "essence",
        label: "Celestial"
    },
    elemental: {
        canEat: [],
        canEatTags: [],
        canDrink: [],
        customFoodNames: ["elemental shard", "mana crystal", "ether shard", "residuum"],
        customWaterNames: [],
        excludeNames: [],
        sustenanceType: "essence",
        label: "Elemental"
    },
    custom: {
        label: "Custom"
    }
};

export class ItemClassifier {

    // ── Core Classification ──────────────────────────────────────

    /**
     * Classify an item's resource type.
     *
     * @param {Item} item - Foundry Item document
     * @returns {"food"|"water"|"fuel"|"ingredient"|"none"|null}
     *   Returns the classification string, or null if unclassified.
     */
    static classify(item) {
        if (!item) return null;

        // 1. Explicit flag (highest priority)
        const explicit = item.flags?.[MODULE_ID]?.resourceType;
        if (explicit && RESOURCE_TYPES.has(explicit)) return explicit;

        // Legacy migration: check old foodType flag
        const legacyFoodType = item.flags?.[MODULE_ID]?.foodType;
        if (legacyFoodType === "food") return "food";
        if (legacyFoodType === "water") return "water";

        // 2. Check water first (DnD5e has no water subtype, so flag/name only)
        if (this._matchesWaterByName(item)) return "water";

        // 3. Ingredient check: herbs and crafting inputs are not edible rations.
        //    Must run before the DnD5e "food" subtype catch-all.
        if (this._matchesIngredientByName(item)) return "ingredient";

        // 4. DnD5e consumable subtype "food" (covers food AND drink in DnD5e)
        if (item.type === "consumable" && item.system?.type?.value === "food") return "food";

        // 5. Name list fallback: food
        if (this._matchesFoodByName(item)) return "food";

        // 6. Name list fallback: fuel
        if (this._matchesFuelByName(item)) return "fuel";

        return null;
    }

    /**
     * Get the drink sub-type for a water-classified item.
     *
     * @param {Item} item - Foundry Item document
     * @returns {"water"|"alcohol"|"oil"|"other"|null}
     */
    static getDrinkType(item) {
        if (!item) return null;

        const explicit = item.flags?.[MODULE_ID]?.drinkType;
        if (explicit && DRINK_TYPES.has(explicit)) return explicit;

        // Infer from name for common cases
        const name = item.name?.toLowerCase().trim() ?? "";
        if (name.includes("oil")) return "oil";
        if (name.includes("ale") || name.includes("wine") || name.includes("beer")
            || name.includes("mead") || name.includes("whiskey") || name.includes("rum")
            || name.includes("brandy") || name.includes("spirits")) return "alcohol";

        // Default to water for anything classified as water
        if (this.classify(item) === "water") return "water";

        return null;
    }

    /**
     * Get the food sub-tag for an item (meat/plant/prepared).
     * Uses explicit flag first, then name-based inference.
     *
     * @param {Item} item - Foundry Item document
     * @returns {"meat"|"plant"|"prepared"|null}
     */
    static getFoodTag(item) {
        if (!item) return null;

        const explicit = item.flags?.[MODULE_ID]?.foodTag;
        if (explicit && FOOD_TAGS.has(explicit)) return explicit;

        const name = item.name?.toLowerCase().trim() ?? "";
        if (!name) return null;

        for (const [tag, names] of Object.entries(FOOD_TAG_NAMES)) {
            if (names.has(name)) return tag;
        }

        // Items classified as food but with no tag are treated as prepared (generic consumables)
        const type = this.classify(item);
        if (type === "food") return "prepared";

        return null;
    }

    /**
     * Get the spoilage window for an item in days/rests.
     * Checks explicit flag first, then infers from food tag.
     * Returns null for non-perishable or non-food items.
     *
     * @param {Item} item - Foundry Item document
     * @returns {number|null} Days until spoilage, or null if shelf-stable
     */
    static getSpoilsAfter(item) {
        if (!item) return null;

        // Explicit flag takes priority
        const explicit = item.flags?.[MODULE_ID]?.spoilsAfter;
        if (explicit !== null) return explicit > 0 ? explicit : null;

        // Infer from food tag
        const tag = this.getFoodTag(item);
        if (!tag) return null;

        return DEFAULT_SPOILS_AFTER[tag] ?? null;
    }

    /**
     * Check if an item qualifies as food for a specific actor (diet-aware).
     * Now checks both resource type (canEat) and food sub-tag (canEatTags).
     *
     * @param {Item} item - Foundry Item document
     * @param {Actor} [actor] - Actor to check diet for. If omitted, uses standard rules.
     * @returns {boolean}
     */
    static isFood(item, actor = null) {
        const type = this.classify(item);
        if (!type) return false;

        const diet = this.getDiet(actor);

        // Check if the item's resource type is in the actor's canEat list
        if (!diet.canEat.includes(type)) return false;

        // For food-type items, also check food sub-tags
        if (type === "food" && diet.canEatTags?.length) {
            const tag = this.getFoodTag(item);
            if (tag && !diet.canEatTags.includes(tag)) return false;
        }

        // Check exclusions (legacy, still supported)
        if (this._isExcludedByDiet(item, diet)) return false;

        return true;
    }

    /**
     * Check if an item qualifies as water/drink for a specific actor (diet-aware).
     *
     * @param {Item} item - Foundry Item document
     * @param {Actor} [actor] - Actor to check diet for. If omitted, uses standard rules.
     * @returns {boolean}
     */
    static isWater(item, actor = null) {
        if (!item) return false;

        const diet = this.getDiet(actor);
        const drinkType = this.getDrinkType(item);

        // Name/flag drink types (oil, alcohol) before classify: plain "Oil" may not
        // match fuel/water lists yet still infer drinkType oil for construct diets.
        if (drinkType && diet.canDrink.includes(drinkType)) return true;

        const name = item.name?.toLowerCase().trim() ?? "";
        if (name && diet.customWaterNames.some(n => n.toLowerCase().trim() === name)) return true;

        const type = this.classify(item);
        if (!type) return false;

        if (diet.canDrink.includes("water") && type === "water") return true;

        return false;
    }

    // ── Diet Profile Management ──────────────────────────────────

    /**
     * Get the diet profile for an actor.
     * Returns DEFAULT_DIET if no diet is configured.
     *
     * @param {Actor} [actor] - Foundry Actor document
     * @returns {Object} Diet profile
     */
    static getDiet(actor) {
        if (!actor) return { ...DEFAULT_DIET };

        const stored = actor.flags?.[MODULE_ID]?.diet;
        if (!stored) return { ...DEFAULT_DIET };

        const merged = { ...DEFAULT_DIET, ...stored };
        merged.customFoodNames = this._normalizeDietNameList(merged.customFoodNames);
        merged.customWaterNames = this._normalizeDietNameList(merged.customWaterNames);
        return merged;
    }

    /**
     * Coerce diet name lists to trimmed lowercase string arrays.
     * Handles legacy comma-separated strings on the flag object.
     * @param {unknown} val
     * @returns {string[]}
     */
    static _normalizeDietNameList(val) {
        if (val == null) return [];
        if (Array.isArray(val)) {
            return val.map(s => String(s).trim().toLowerCase()).filter(Boolean);
        }
        if (typeof val === "string") {
            return val.split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
        }
        return [];
    }

    /**
     * Set the diet profile for an actor.
     *
     * @param {Actor} actor - Foundry Actor document
     * @param {Object} diet - Partial diet object (merged over DEFAULT_DIET)
     */
    static async setDiet(actor, diet) {
        if (!actor) return;
        const merged = { ...DEFAULT_DIET, ...diet };
        await actor.setFlag(MODULE_ID, "diet", merged);
    }

    /**
     * Apply a preset diet profile to an actor.
     *
     * @param {Actor} actor - Foundry Actor document
     * @param {string} presetId - Key from DIET_PRESETS
     */
    static async applyPreset(actor, presetId) {
        const preset = DIET_PRESETS[presetId];
        if (!preset) {
            console.warn(`[Respite:ItemClassifier] Unknown diet preset: ${presetId}`);
            return;
        }
        await this.setDiet(actor, preset);
    }

    /**
     * Get all available diet preset IDs and labels.
     * @returns {Object[]} [{ id, label }]
     */
    static getPresets() {
        return Object.entries(DIET_PRESETS).map(([id, preset]) => ({
            id,
            label: preset.label ?? id
        }));
    }

    /**
     * Get the sustenance type for an actor.
     * @param {Actor} [actor]
     * @returns {"food"|"essence"|"none"}
     */
    static getSustenanceType(actor) {
        const diet = this.getDiet(actor);
        if (diet.sustenanceType && SUSTENANCE_TYPES.has(diet.sustenanceType)) {
            return diet.sustenanceType;
        }
        // Legacy migration: map old flags to new field
        if (diet.requiresEssence) return "essence";
        if (diet.requiresSustenance === false) return "none";
        return "food";
    }

    /**
     * Check whether an actor requires sustenance (food/water).
     * @param {Actor} [actor]
     * @returns {boolean}
     */
    static requiresSustenance(actor) {
        return this.getSustenanceType(actor) === "food";
    }

    /**
     * Check whether an actor requires essence (recharge items).
     * @param {Actor} [actor]
     * @returns {boolean}
     */
    static requiresEssence(actor) {
        return this.getSustenanceType(actor) === "essence";
    }

    /**
     * Check if an item qualifies as an essence/recharge item.
     *
     * @param {Item} item - Foundry Item document
     * @param {Actor} [actor=null] - When set, diet customFoodNames are honored for essence diets
     * @returns {boolean}
     */
    static isEssence(item, actor = null) {
        if (!item) return false;

        const explicit = item.flags?.[MODULE_ID]?.resourceType;
        if (explicit === "essence") return true;

        const name = item.name?.toLowerCase().trim() ?? "";
        if (ESSENCE_NAMES.has(name)) return true;

        // Oil-type drinks also count as essence
        const drinkType = this.getDrinkType(item);
        if (drinkType === "oil") return true;

        // Fuel items can serve as essence for constructs
        const type = this.classify(item);
        if (type === "fuel") return true;

        // Check actor's customFoodNames if diet is essence-based (includes legacy requiresEssence)
        if (actor && this.getSustenanceType(actor) === "essence") {
            const diet = this.getDiet(actor);
            if (name && diet.customFoodNames?.some(n => n.toLowerCase().trim() === name)) return true;
        }

        return false;
    }

    // ── Legacy Migration ─────────────────────────────────────────

    /**
     * Migrate legacy foodType flags to resourceType on a set of items.
     * Safe to call multiple times; skips items that already have resourceType.
     *
     * @param {Item[]} items - Array of Foundry Item documents
     * @returns {number} Count of items migrated
     */
    static async migrateLegacyFlags(items) {
        let migrated = 0;

        for (const item of items) {
            const existing = item.flags?.[MODULE_ID]?.resourceType;
            if (existing) continue;

            const legacy = item.flags?.[MODULE_ID]?.foodType;
            if (!legacy) continue;

            if (legacy === "food" || legacy === "water") {
                await item.setFlag(MODULE_ID, "resourceType", legacy);
                migrated++;
            }
        }

        return migrated;
    }

    // ── GM Custom Name Lists ─────────────────────────────────────

    /**
     * Get GM-configured custom names for a given category.
     *
     * @param {"customFoodNames"|"customWaterNames"} settingKey
     * @returns {Set<string>} Lowercase trimmed names
     */
    static getCustomNames(settingKey) {
        try {
            const raw = game.settings.get(MODULE_ID, settingKey) ?? "";
            return new Set(
                raw.split(",").map(s => s.toLowerCase().trim()).filter(s => s.length > 0)
            );
        } catch {
            return new Set();
        }
    }

    // ── Internal Helpers ─────────────────────────────────────────

    static _matchesFoodByName(item) {
        const name = item.name?.toLowerCase().trim();
        if (!name) return false;
        if (FOOD_NAMES.has(name)) return true;
        if (this.getCustomNames("customFoodNames").has(name)) return true;
        return false;
    }

    static _matchesWaterByName(item) {
        const name = item.name?.toLowerCase().trim();
        if (!name) return false;
        if (WATER_NAMES.has(name)) return true;
        if (this.getCustomNames("customWaterNames").has(name)) return true;
        return false;
    }

    static _matchesFuelByName(item) {
        const name = item.name?.toLowerCase().trim();
        if (!name) return false;
        if (FUEL_NAMES.has(name)) return true;
        return false;
    }

    static _matchesIngredientByName(item) {
        const name = item.name?.toLowerCase().trim();
        if (!name) return false;
        return INGREDIENT_NAMES.has(name);
    }

    /**
     * Check if an item is excluded by the actor's diet profile.
     *
     * @param {Item} item
     * @param {Object} diet
     * @returns {boolean}
     */
    static _isExcludedByDiet(item, diet) {
        if (!diet.excludeNames?.length) return false;
        const name = item.name?.toLowerCase().trim() ?? "";
        return diet.excludeNames.some(ex => name === ex.toLowerCase().trim());
    }
}

// Re-export constants for testing and external access
ItemClassifier.RESOURCE_TYPES = RESOURCE_TYPES;
ItemClassifier.DRINK_TYPES = DRINK_TYPES;
ItemClassifier.FOOD_TAGS = FOOD_TAGS;
ItemClassifier.SUSTENANCE_TYPES = SUSTENANCE_TYPES;
ItemClassifier.DIET_PRESETS = DIET_PRESETS;
ItemClassifier.DEFAULT_DIET = DEFAULT_DIET;
ItemClassifier.FOOD_NAMES = FOOD_NAMES;
ItemClassifier.WATER_NAMES = WATER_NAMES;
ItemClassifier.FUEL_NAMES = FUEL_NAMES;
ItemClassifier.ESSENCE_NAMES = ESSENCE_NAMES;
ItemClassifier.INGREDIENT_NAMES = INGREDIENT_NAMES;
