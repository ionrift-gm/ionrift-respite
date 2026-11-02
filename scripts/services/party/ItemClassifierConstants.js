/** Built-in food item names (lowercase). */
/** Built-in food item names (lowercase). */
export const FOOD_NAMES = new Set([
    "rations", "rations (1 day)", "trail rations", "iron rations",
    "camp porridge", "honeyed porridge", "smoked fish", "spiced jerky",
    "berry preserves", "roasted mushrooms", "herb-seasoned rations",
    "hearty stew", "fortified trail rations"
]);

/** Built-in water item names (lowercase). */
export const WATER_NAMES = new Set([
    "waterskin", "water flask", "canteen",
    "water (pint)", "water, fresh (pint)",
    "holy water"
]);

/** Built-in fuel item names (lowercase). */
export const FUEL_NAMES = new Set([
    "torch", "candle", "lamp oil", "oil flask",
    "tinderbox", "firewood", "dry firewood", "kindling"
]);

/** Built-in essence item names (lowercase). Recharge items for non-biological characters. */
export const ESSENCE_NAMES = new Set([
    "oil flask", "lamp oil", "arcane crystal", "soul fragment",
    "ether shard", "residuum"
]);

/**
 * Item types eligible for provisions classification, spoilage, and diet rules.
 * Restricts food/water/spoilage to physical consumable items and materials (loot/treasure).
 * Explicitly excludes equipment, tools, weapons, containers, features, spells, classes, etc.
 * @type {Readonly<Set<string>>}
 */
export const PROVISION_ITEM_TYPES = Object.freeze(new Set(["consumable", "loot", "treasure"]));

/**
 * Storage types and preservation multipliers for containers.
 * Multiplier extends base spoilage duration. Stasis stores 0, which disables spoilage entirely.
 * @type {Readonly<Array<{ id: string, label: string, multiplier: number|null, badge: string, description: string }>>}
 */
export const STORAGE_TYPES = Object.freeze([
    {
        id: "ventilated",
        get label() { return game.i18n?.localize ? game.i18n.localize("ionrift-respite.itemClassifier.storageVentilatedLabel") : "Ventilated"; },
        multiplier: 1.3,
        badge: "1.3×",
        get description() { return game.i18n?.localize ? game.i18n.localize("ionrift-respite.itemClassifier.storageVentilatedDesc") : "Breezy or dry storage extending shelf life slightly."; }
    },
    {
        id: "cellar",
        get label() { return game.i18n?.localize ? game.i18n.localize("ionrift-respite.itemClassifier.storageCellarLabel") : "Cellar"; },
        multiplier: 1.5,
        badge: "1.5×",
        get description() { return game.i18n?.localize ? game.i18n.localize("ionrift-respite.itemClassifier.storageCellarDesc") : "Cool, shaded storage slowing spoilage."; }
    },
    {
        id: "coolbox",
        get label() { return game.i18n?.localize ? game.i18n.localize("ionrift-respite.itemClassifier.storageCoolBoxLabel") : "Cool Box"; },
        multiplier: 2.0,
        badge: "2×",
        get description() { return game.i18n?.localize ? game.i18n.localize("ionrift-respite.itemClassifier.storageCoolBoxDesc") : "Insulated ice container doubling shelf life."; }
    },
    {
        id: "deepchill",
        get label() { return game.i18n?.localize ? game.i18n.localize("ionrift-respite.itemClassifier.storageDeepChillLabel") : "Deep Chill"; },
        multiplier: 3.0,
        badge: "3×",
        get description() { return game.i18n?.localize ? game.i18n.localize("ionrift-respite.itemClassifier.storageDeepChillDesc") : "Packed in salt and ice, tripling shelf life."; }
    },
    {
        id: "stasis",
        get label() { return game.i18n?.localize ? game.i18n.localize("ionrift-respite.itemClassifier.storageStasisLabel") : "Stasis"; },
        multiplier: 0,
        badge: "STASIS",
        get description() { return game.i18n?.localize ? game.i18n.localize("ionrift-respite.itemClassifier.storageStasisDesc") : "Magical or extradimensional storage. Food inside never spoils."; }
    },
    {
        id: "custom",
        get label() { return game.i18n?.localize ? game.i18n.localize("ionrift-respite.itemClassifier.storageCustomLabel") : "Custom Multiplier"; },
        multiplier: null,
        badge: "CUSTOM",
        get description() { return game.i18n?.localize ? game.i18n.localize("ionrift-respite.itemClassifier.storageCustomDesc") : "Custom shelf life multiplier."; }
    }
]);

/**
 * Valid resourceType values.
 * @type {Set<string>}
 */
export const RESOURCE_TYPES = new Set(["food", "water", "fuel", "ingredient", "none"]);

/**
 * Valid drinkType values.
 * @type {Set<string>}
 */
export const DRINK_TYPES = new Set(["water", "alcohol", "oil"]);

/**
 * Food sub-categories. Items classified as "food" get a secondary tag
 * that determines which dietary presets accept them.
 * @type {Set<string>}
 */
export const FOOD_TAGS = new Set(["meat", "plant", "prepared"]);

/**
 * Default spoilage windows (in rests/days) by food tag.
 * Used when an item has no explicit spoilsAfter flag.
 * null = does not spoil (preserved / shelf-stable).
 */
export const DEFAULT_SPOILS_AFTER = {
    meat: 1,
    plant: 3,
    prepared: null
};

/**
 * Name-based food tag inference for items without an explicit flag.
 * First match wins.
 */
export const FOOD_TAG_NAMES = {
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
 * Items that are cooking/crafting ingredients, not edible raw rations.
 * These classify as "ingredient" even though their DnD5e subtype is "food".
 * Goodberries are intentionally excluded: they are edible as-is.
 */
export const INGREDIENT_NAMES = new Set([
    "wild herbs", "healing herbs", "alpine herbs"
]);

/**
 * Sustenance types: determines what a character needs to survive.
 *   "food":    standard biological. Needs food + water (default).
 *   "essence": magical/construct. Needs essence items (oil, crystals, etc.).
 *   "none":    truly needs nothing (GM override, rare).
 */
export const SUSTENANCE_TYPES = new Set(["food", "essence", "none"]);

/**
 * Default diet profile. Applied when an actor has no diet flag set.
 * @type {Object}
 */
export const DEFAULT_DIET = {
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
export const DIET_PRESET_LABELS = {
    standard: "ionrift-respite.itemClassifier.dietStandard",
    herbivore: "ionrift-respite.itemClassifier.dietHerbivore",
    carnivore: "ionrift-respite.itemClassifier.dietCarnivore",
    omnivore: "ionrift-respite.itemClassifier.dietOmnivore",
    construct: "ionrift-respite.itemClassifier.dietNotNeeded",
    maintenance: "ionrift-respite.itemClassifier.dietMaintenance",
    undead: "ionrift-respite.itemClassifier.dietUndead",
    celestial: "ionrift-respite.itemClassifier.dietCelestial",
    elemental: "ionrift-respite.itemClassifier.dietElemental",
    custom: "ionrift-respite.itemClassifier.dietCustom"
};

export const DIET_PRESETS = {
    standard: {
        get label() { return game.i18n?.localize ? game.i18n.localize(DIET_PRESET_LABELS.standard) : "Standard"; }
    },
    herbivore: {
        canEat: ["food"],
        canEatTags: ["plant", "prepared"],
        canDrink: ["water"],
        get label() { return game.i18n?.localize ? game.i18n.localize(DIET_PRESET_LABELS.herbivore) : "Herbivore"; }
    },
    carnivore: {
        canEat: ["food"],
        canEatTags: ["meat", "prepared"],
        canDrink: ["water"],
        get label() { return game.i18n?.localize ? game.i18n.localize(DIET_PRESET_LABELS.carnivore) : "Carnivore"; }
    },
    omnivore: {
        canEat: ["food", "ingredient"],
        canEatTags: ["meat", "plant", "prepared"],
        canDrink: ["water", "alcohol"],
        get label() { return game.i18n?.localize ? game.i18n.localize(DIET_PRESET_LABELS.omnivore) : "Omnivore"; }
    },
    construct: {
        canEat: [],
        canEatTags: [],
        canDrink: [],
        customFoodNames: [],
        customWaterNames: [],
        excludeNames: [],
        sustenanceType: "none",
        get label() { return game.i18n?.localize ? game.i18n.localize(DIET_PRESET_LABELS.construct) : "Not Needed"; }
    },
    maintenance: {
        canEat: ["fuel"],
        canEatTags: [],
        canDrink: ["oil"],
        customFoodNames: ["scrap metal", "iron filings", "crate wood"],
        customWaterNames: ["oil flask", "lamp oil"],
        excludeNames: [],
        sustenanceType: "essence",
        get label() { return game.i18n?.localize ? game.i18n.localize(DIET_PRESET_LABELS.maintenance) : "Maintenance"; }
    },
    undead: {
        canEat: [],
        canEatTags: [],
        canDrink: [],
        customFoodNames: ["soul fragment", "bone dust", "dark candle", "necrotic essence"],
        customWaterNames: [],
        excludeNames: [],
        sustenanceType: "essence",
        get label() { return game.i18n?.localize ? game.i18n.localize(DIET_PRESET_LABELS.undead) : "Undead"; }
    },
    celestial: {
        canEat: [],
        canEatTags: [],
        canDrink: ["water"],
        customFoodNames: ["incense", "blessed candle", "prayer beads", "holy water"],
        customWaterNames: [],
        excludeNames: [],
        sustenanceType: "essence",
        get label() { return game.i18n?.localize ? game.i18n.localize(DIET_PRESET_LABELS.celestial) : "Celestial"; }
    },
    elemental: {
        canEat: [],
        canEatTags: [],
        canDrink: [],
        customFoodNames: ["elemental shard", "mana crystal", "ether shard", "residuum"],
        customWaterNames: [],
        excludeNames: [],
        sustenanceType: "essence",
        get label() { return game.i18n?.localize ? game.i18n.localize(DIET_PRESET_LABELS.elemental) : "Elemental"; }
    },
    custom: {
        get label() { return game.i18n?.localize ? game.i18n.localize(DIET_PRESET_LABELS.custom) : "Custom"; }
    }
};
