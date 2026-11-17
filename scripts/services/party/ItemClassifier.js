/** Classifies Respite food, water, fuel, and ingredient items. */

import { stripSpoilageCohortSuffix } from "../meal/spoilage/spoilageName.js";
import { CONTAINER_ITEM_TYPES } from "../meal/inventory/MealConstants.js";
import { MODULE_ID } from "../../data/moduleId.js";

import {
    FOOD_NAMES,
    WATER_NAMES,
    FUEL_NAMES,
    ESSENCE_NAMES,
    PROVISION_ITEM_TYPES,
    STORAGE_TYPES,
    RESOURCE_TYPES,
    DRINK_TYPES,
    FOOD_TAGS,
    DEFAULT_SPOILS_AFTER,
    FOOD_TAG_NAMES,
    INGREDIENT_NAMES,
    SUSTENANCE_TYPES,
    DEFAULT_DIET,
    DIET_PRESETS
} from "./ItemClassifierConstants.js";
export { PROVISION_ITEM_TYPES, STORAGE_TYPES };

export class ItemClassifier {

    /**
     * Whether an item is spoiled loot (inedible; cannot satiate hunger).
     * @param {Item|object} item
     * @returns {boolean}
     */
    static isSpoiled(item) {
        if (!item) return false;
        if (item.flags?.[MODULE_ID]?.spoiled === true) return true;
        if (item.flags?.[MODULE_ID]?.itemRef === "spoiled_food") return true;
        const ident = item.system?.identifier?.toLowerCase() ?? "";
        if (ident === "spoiled-food" || ident === "spoiled_food") return true;
        const name = item.name?.toLowerCase().trim() ?? "";
        return name === "spoiled food";
    }

    /**
     * Check if an item is a physical provision document type (consumable, loot, treasure).
     * Excludes equipment, tools, weapons, containers, features, classes, spells, etc.
     * @param {Item|object} item
     * @returns {boolean}
     */
    static isProvisionEligible(item) {
        if (!item) return false;
        // In unit test mocks where item.type might be omitted, allow untyped objects
        if (!item.type) return true;
        return PROVISION_ITEM_TYPES.has(item.type);
    }

    /**
     * Check if an item is a container document type (container, backpack).
     * @param {Item|object} item
     * @returns {boolean}
     */
    static isContainer(item) {
        if (!item) return false;
        return CONTAINER_ITEM_TYPES.has(item.type);
    }

    /**
     * Check if an item can be configured in ItemProvisionsApp (provisions or containers).
     * @param {Item|object} item
     * @returns {boolean}
     */
    static isConfigurableItem(item) {
        if (!item) return false;
        return this.isProvisionEligible(item) || this.isContainer(item);
    }

    /**
     * Check whether a container document carries active cold storage flags.
     * @param {Item|object} container
     * @returns {boolean}
     */
    static isColdStorageContainer(container) {
        if (!container) return false;
        const flags = container.flags?.[MODULE_ID] ?? {};
        return flags.coldStorage === true;
    }

    /**
     * Get the shelf life preservation multiplier for a cold storage container.
     * 2 = doubles shelf life (half spoilage rate). 0 = stasis/frozen (indefinite shelf life).
     * @param {Item|object} container
     * @returns {number}
     */
    static getPreservationMultiplier(container) {
        if (!container) return 1;
        const flags = container.flags?.[MODULE_ID] ?? {};
        if (!flags.coldStorage) return 1;
        const mult = Number(flags.preservationMultiplier);
        return !Number.isNaN(mult) && mult >= 0 ? mult : 2;
    }

    /**
     * Get preset matching a given preservation multiplier.
     * @param {number} mult
     * @returns {object|null}
     */
    static getStorageTypePreset(mult) {
        if (mult === undefined || mult === null) return null;
        const num = Number(mult);
        return STORAGE_TYPES.find(p => p.multiplier !== null && Math.abs(p.multiplier - num) < 0.01) ?? null;
    }

    /**
     * Resolves the parent container document for an item, if stored inside one.
     * Checks item.container, item.system.container against actor items, or item._container test mock.
     * @param {Item|object} item
     * @returns {Item|object|null}
     */
    static getParentContainer(item) {
        if (!item) return null;
        if (item.container) return item.container;
        if (item._container) return item._container;
        const containerId = item.system?.container;
        if (containerId && item.parent?.items) {
            if (typeof item.parent.items.get === "function") {
                return item.parent.items.get(containerId) ?? null;
            }
            if (Array.isArray(item.parent.items)) {
                return item.parent.items.find(i => i.id === containerId || i._id === containerId) ?? null;
            }
        }
        return null;
    }

    /**
     * Classify an item's resource type.
     *
     * @param {Item} item - Foundry Item document
     * @returns {"food"|"water"|"fuel"|"ingredient"|"none"|null}
     *   Returns the classification string, or null if unclassified.
     */
    static classify(item) {
        if (!item) return null;
        if (!this.isProvisionEligible(item)) {
            // Container items can only ever be water containers (e.g. Waterskin as container), never food or fuel
            if (CONTAINER_ITEM_TYPES.has(item.type)) {
                if (item.flags?.[MODULE_ID]?.resourceType === "water" || this._matchesWaterByName(item)) {
                    return "water";
                }
            }
            return null;
        }

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

        // 4a. Module foodTag: drink is water; other meal tags are food
        //     (covers crafted meals/drinks that may have wrong DnD5e type)
        const foodTag = item.flags?.[MODULE_ID]?.foodTag;
        if (foodTag === "drink") return "water";
        if (foodTag && FOOD_TAGS.has(foodTag)) return "food";
        if (foodTag === "cooked_meal" || foodTag === "preserved" || foodTag === "raw_fish") return "food";

        // 4b. DnD5e consumable subtypes
        if (item.type === "consumable" && item.system?.type?.value === "drink") return "water";
        // "food" covers food AND many liquids in SRD data; water names already matched above
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

        const ref = String(item.flags?.[MODULE_ID]?.itemRef ?? item.system?.identifier ?? "")
            .toLowerCase()
            .replace(/[-_]/g, " ")
            .trim();
        if (ref) {
            if (ref.includes("oil")) return "oil";
            if (ref.includes("ale") || ref.includes("wine") || ref.includes("beer")
                || ref.includes("mead") || ref.includes("whiskey") || ref.includes("rum")
                || ref.includes("brandy") || ref.includes("spirits")) return "alcohol";
        }

        const name = item.name?.toLowerCase().trim() ?? "";
        if (name.includes("oil")) return "oil";
        if (name.includes("ale") || name.includes("wine") || name.includes("beer")
            || name.includes("mead") || name.includes("whiskey") || name.includes("rum")
            || name.includes("brandy") || name.includes("spirits")) return "alcohol";

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
        if (!item || !this.isProvisionEligible(item)) return null;

        const explicit = item.flags?.[MODULE_ID]?.foodTag;
        if (explicit && FOOD_TAGS.has(explicit)) return explicit;

        const ref = this._normalizedItemRef(item);
        if (ref) {
            for (const [tag, names] of Object.entries(FOOD_TAG_NAMES)) {
                if (names.has(ref)) return tag;
            }
        }

        const name = this.baseItemName(item);
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
        if (!item || !this.isProvisionEligible(item)) return null;

        const flags = item.flags?.[MODULE_ID] ?? {};
        if (flags.spoilsAfterHours) return null;

        let baseSpoils = null;
        // Explicit flag takes priority
        const explicit = item.flags?.[MODULE_ID]?.spoilsAfter;
        if (explicit !== null && explicit !== undefined) {
            baseSpoils = explicit > 0 ? explicit : null;
        } else {
            // Infer from food tag
            const tag = this.getFoodTag(item);
            baseSpoils = tag ? (DEFAULT_SPOILS_AFTER[tag] ?? null) : null;
        }

        if (baseSpoils === null) return null;

        // Apply container cold storage preservation
        const container = this.getParentContainer(item);
        if (container && this.isColdStorageContainer(container)) {
            const mult = this.getPreservationMultiplier(container);
            if (mult === 0) return null; // Stasis / indefinite preservation
            const result = baseSpoils * mult;
            return Math.max(1, Number.isInteger(result) ? result : Number(result.toFixed(2)));
        }

        return baseSpoils;
    }

    /**
     * Hour-based spoilage (Chef treats). Returns null when not hour-gated.
     * @param {Item|object} item
     * @returns {number|null}
     */
    static getSpoilsAfterHours(item) {
        if (!item || !this.isProvisionEligible(item)) return null;
        const hours = item.flags?.[MODULE_ID]?.spoilsAfterHours;
        if (hours === null || hours === undefined) return null;
        const n = Number(hours);
        let baseHours = n > 0 ? n : null;
        if (baseHours === null) return null;

        // Apply container cold storage preservation
        const container = this.getParentContainer(item);
        if (container && this.isColdStorageContainer(container)) {
            const mult = this.getPreservationMultiplier(container);
            if (mult === 0) return null;
            const result = baseHours * mult;
            return Math.max(1, Number.isInteger(result) ? result : Number(result.toFixed(2)));
        }

        return baseHours;
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
        if (!item || !this.isProvisionEligible(item)) return false;
        if (this.isSpoiled(item)) return false;

        if (actor && !this.participatesInSustenance(actor)) return false;

        // Essence diets delegate to isEssence for their food classification
        if (actor && this.getSustenanceType(actor) === "essence") {
            return this.isEssence(item, actor);
        }

        const type = this.classify(item);
        if (!type) return false;

        const diet = this.getDiet(actor);

        if (!diet.canEat.includes(type)) return false;

        if (type === "food" && diet.canEatTags?.length) {
            const tag = this.getFoodTag(item);
            if (tag && !diet.canEatTags.includes(tag)) return false;
        }

        if (this._isExcludedByDiet(item, diet)) return false;

        return true;
    }

    /**
     * Chef Bolstering Treats: bonus-action temp HP snacks, not rest rations.
     * @param {Item|object} item
     * @returns {boolean}
     */
    static isChefTreat(item) {
        return !!item?.flags?.[MODULE_ID]?.chefTreat;
    }

    /**
     * Items that can fill a rest rations food slot (excludes Chef treats unless configured).
     * @param {Item} item
     * @param {Actor} [actor]
     * @returns {boolean}
     */
    static isMealSubstitute(item, actor = null) {
        const settingVal = game.settings?.get?.(MODULE_ID, "chefTreatsProvideSustenance");
        const treatsProvideSustenance = typeof settingVal === "boolean" ? settingVal : true;
        if (!item || (!treatsProvideSustenance && this.isChefTreat(item))) return false;
        if (actor && this.requiresEssence(actor)) {
            return this.isEssenceMealFoodOption(item, actor);
        }
        return this.isFood(item, actor);
    }

    /**
     * Whether a meal-choice food slot selection counts toward sustenance.
     * @param {Actor} actor
     * @param {string} itemId
     * @returns {boolean}
     */
    static isMealSlotSelection(actor, itemId) {
        if (!itemId || itemId === "skip") return false;
        if (String(itemId).startsWith("__")) return false;
        const item = actor?.items?.get(itemId);
        const settingVal = game.settings?.get?.(MODULE_ID, "chefTreatsProvideSustenance");
        const treatsProvideSustenance = typeof settingVal === "boolean" ? settingVal : true;
        if (item && !treatsProvideSustenance && this.isChefTreat(item)) return false;
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
        if (!this.isProvisionEligible(item) && !CONTAINER_ITEM_TYPES.has(item.type)) return false;
        if (this.isSpoiled(item)) return false;

        if (actor && !this.participatesInSustenance(actor)) return false;

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
        if (merged.label === "Construct") {
            merged.label = "Not Needed";
            if (!merged.presetId) merged.presetId = "construct";
        }
        if (merged.label === "Construct (Maintenance)") {
            merged.label = "Maintenance";
            if (!merged.presetId) merged.presetId = "maintenance";
        }
        return merged;
    }

    /**
     * Coerce diet name lists to trimmed lowercase string arrays.
     * Handles legacy comma-separated strings on the flag object.
     * @param {unknown} val
     * @returns {string[]}
     */
    static _normalizeDietNameList(val) {
        if (val === null || val === undefined) return [];
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
        await this.setDiet(actor, { ...preset, presetId });
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
     * Whether the actor participates in meal tracking at all.
     * False for constructs and other no-sustenance profiles.
     * @param {Actor} [actor]
     * @returns {boolean}
     */
    static participatesInSustenance(actor) {
        return this.getSustenanceType(actor) !== "none";
    }

    /**
     * Whether cooked meals and Well Fed buffs apply to this actor.
     * Only standard biological diets accept food buffs.
     * @param {Actor} [actor]
     * @returns {boolean}
     */
    static acceptsFoodBuffs(actor) {
        return this.getSustenanceType(actor) === "food";
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
        if (this.isSpoiled(item)) return false;

        const explicit = item.flags?.[MODULE_ID]?.resourceType;
        if (explicit === "essence") return true;

        const name = item.name?.toLowerCase().trim() ?? "";
        const ref = this._normalizedItemRef(item);

        // Without an actor, fall back to the global heuristics (oil, fuel, built-in names).
        if (!actor) {
            if ((ref && ESSENCE_NAMES.has(ref)) || ESSENCE_NAMES.has(name)) return true;
            if (this.getDrinkType(item) === "oil") return true;
            if (this.classify(item) === "fuel") return true;
            return false;
        }

        // With an actor whose diet is not essence, nothing qualifies.
        if (this.getSustenanceType(actor) !== "essence") return false;

        const diet = this.getDiet(actor);

        // Per-diet custom food names (most common path for named essence items)
        if ((ref && diet.customFoodNames?.some(n => n === ref)) || (name && diet.customFoodNames?.some(n => n === name))) return true;

        // Oil-type drinks count as essence when the diet includes oil or fuel
        if (this.getDrinkType(item) === "oil") {
            if (diet.canDrink.includes("oil") || diet.canEat.includes("fuel")) return true;
        }

        // Fuel items when the diet explicitly allows fuel
        if (this.classify(item) === "fuel" && diet.canEat.includes("fuel")) return true;

        return false;
    }

    /**
     * Essence meal "food" tray filter. Returns true when an item qualifies as
     * essence food and should appear in the food tray. Items that also pass
     * isWater for this actor are excluded so they appear only in the water tray.
     *
     * @param {Item} item
     * @param {Actor|null} actor
     * @returns {boolean}
     */
    static isEssenceMealFoodOption(item, actor) {
        if (!this.isEssence(item, actor)) return false;
        if (!actor || !this.requiresEssence(actor)) return true;
        if (this.isWater(item, actor)) return false;
        return true;
    }

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

    /** Base display name without a spoilage cohort suffix. */
    static baseItemName(item) {
        return stripSpoilageCohortSuffix(item?.name ?? "").toLowerCase().trim();
    }

    /** Normalized locale-safe itemRef or system.identifier (snake_case/kebab-case -> spaces). */
    static _normalizedItemRef(item) {
        const raw = item?.flags?.[MODULE_ID]?.itemRef ?? item?.system?.identifier ?? item?.system?.slug ?? "";
        return String(raw).toLowerCase().replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
    }

    static _matchesFoodByName(item) {
        const ref = this._normalizedItemRef(item);
        if (ref) {
            if (FOOD_NAMES.has(ref) || ref.includes("rations") || ref === "ration") return true;
            if (this.getCustomNames("customFoodNames").has(ref)) return true;
        }
        const name = this.baseItemName(item);
        if (!name) return false;
        if (FOOD_NAMES.has(name)) return true;
        // Any ration-named variant (seasoned, fortified, well-seasoned, ...) is
        // food. Keeps cooked/preserved rations in the provisions cohort even
        // when they carry no explicit flag or DnD5e food subtype.
        if (name.includes("rations")) return true;
        if (this.getCustomNames("customFoodNames").has(name)) return true;
        return false;
    }

    static _matchesWaterByName(item) {
        const ref = this._normalizedItemRef(item);
        if (ref) {
            if (WATER_NAMES.has(ref)) return true;
            if (this.getCustomNames("customWaterNames").has(ref)) return true;
        }
        const name = this.baseItemName(item);
        if (!name) return false;
        if (WATER_NAMES.has(name)) return true;
        if (this.getCustomNames("customWaterNames").has(name)) return true;
        return false;
    }

    static _matchesFuelByName(item) {
        const ref = this._normalizedItemRef(item);
        if (ref && FUEL_NAMES.has(ref)) return true;
        const name = this.baseItemName(item);
        if (!name) return false;
        if (FUEL_NAMES.has(name)) return true;
        return false;
    }

    static _matchesIngredientByName(item) {
        const ref = this._normalizedItemRef(item);
        if (ref && INGREDIENT_NAMES.has(ref)) return true;
        const name = this.baseItemName(item);
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
        const name = this.baseItemName(item);
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
ItemClassifier.STORAGE_TYPES = STORAGE_TYPES;
