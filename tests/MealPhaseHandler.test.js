import { describe, it, expect, beforeEach } from "vitest";

/**
 * MealPhaseHandler regression tests.
 *
 * Covers:
 *  - Container-aware water tray fix (5ab2b1d): _getContainerParentId,
 *    _isContainerType, _collectContainerIds, and _buildWaterOptions
 *  - _actorMealSlots: essence actors always get ≥1 food slot
 *  - _buildAdvisories: starvation/dehydration warning cascade
 *  - _accumulateMealSatiation: wet-meal and party-meal cross-credit
 *  - _buffSummaryLabel: readable buff descriptions
 *
 * The container helpers and _actorMealSlots are module-scope functions,
 * so we re-import the module and test via the public API surface that
 * exercises them (_buildFoodOptions, _buildWaterOptions, buildMealContext).
 */

const MODULE_ID = "ionrift-respite";

let MealPhaseHandler;

function makeItem(overrides = {}) {
    return {
        id: overrides.id ?? `item-${Math.random().toString(36).slice(2, 8)}`,
        name: overrides.name ?? "Generic Item",
        type: overrides.type ?? "loot",
        system: {
            quantity: 1,
            type: {},
            uses: null,
            container: null,
            containerId: null,
            ...overrides.system
        },
        flags: overrides.flags ?? {},
        img: overrides.img ?? "icons/default.webp",
        ...overrides
    };
}

function makeActor(overrides = {}) {
    const items = overrides.items ?? [];
    const actorItems = {
        [Symbol.iterator]: () => items[Symbol.iterator](),
        get: (id) => items.find(i => i.id === id),
        find: (fn) => items.find(fn),
        filter: (fn) => items.filter(fn)
    };
    return {
        id: overrides.id ?? "actor-001",
        name: overrides.name ?? "Test Actor",
        items: actorItems,
        flags: overrides.flags ?? {},
        system: {
            abilities: { con: { mod: 2, proficient: 0, save: 4 } },
            attributes: { prof: 2, hp: { value: 20, max: 20, temp: 0 } },
            ...overrides.system
        },
        img: "icons/actor.webp",
        effects: overrides.effects ?? [],
        getFlag(mod, key) {
            return this.flags?.[mod]?.[key] ?? undefined;
        },
        async setFlag(mod, key, val) {
            if (!this.flags[mod]) this.flags[mod] = {};
            this.flags[mod][key] = val;
        },
        testUserPermission: () => true,
        ...overrides
    };
}

beforeEach(async () => {
    globalThis.game = {
        system: { id: "dnd5e" },
        settings: { get: () => "" },
        modules: { get: () => null },
        actors: {
            get: () => null,
            _store: new Map()
        },
        users: [],
        user: { isGM: true },
        time: { worldTime: 0 }
    };

    const mod = await import("../scripts/services/MealPhaseHandler.js");
    MealPhaseHandler = mod.MealPhaseHandler;
});

describe("MealPhaseHandler", () => {

    // ── _buildFoodOptions: container-aware filtering ────────────

    describe("_buildFoodOptions (container-aware)", () => {
        it("excludes items inside a container", () => {
            const bag = makeItem({ id: "bag-1", name: "Backpack", type: "container", system: { quantity: 1 } });
            const food = makeItem({
                id: "food-1",
                name: "Rations",
                type: "consumable",
                system: { quantity: 3, type: { value: "food" }, container: "bag-1" }
            });
            const looseFood = makeItem({
                id: "food-2",
                name: "Trail Rations",
                type: "consumable",
                system: { quantity: 2, type: { value: "food" } }
            });

            const actor = makeActor({ items: [bag, food, looseFood] });
            const options = MealPhaseHandler._buildFoodOptions(actor);
            const ids = options.map(o => o.itemId);
            expect(ids).not.toContain("food-1");
            expect(ids).toContain("food-2");
        });

        it("includes food not in any container", () => {
            const food = makeItem({
                id: "food-1",
                name: "Rations",
                type: "consumable",
                system: { quantity: 5, type: { value: "food" } }
            });
            const actor = makeActor({ items: [food] });
            const options = MealPhaseHandler._buildFoodOptions(actor);
            expect(options).toHaveLength(1);
            expect(options[0].available).toBe(5);
        });

        it("skips items with 0 quantity", () => {
            const food = makeItem({
                id: "food-1",
                name: "Rations",
                type: "consumable",
                system: { quantity: 0, type: { value: "food" } }
            });
            const actor = makeActor({ items: [food] });
            expect(MealPhaseHandler._buildFoodOptions(actor)).toHaveLength(0);
        });
    });

    // ── _buildWaterOptions: container-aware filtering ────────────

    describe("_buildWaterOptions (container-aware)", () => {
        it("excludes water items inside a container from top-level listing", () => {
            const waterskin = makeItem({
                id: "ws-1",
                name: "Waterskin",
                type: "container",
                system: { quantity: 1 }
            });
            const water = makeItem({
                id: "water-1",
                name: "Water (Pint)",
                system: { quantity: 2, container: "ws-1" }
            });

            const actor = makeActor({ items: [waterskin, water] });
            const options = MealPhaseHandler._buildWaterOptions(actor, { waterPerDay: 2 });
            const ids = options.map(o => o.itemId);
            expect(ids).not.toContain("water-1");
        });

        it("counts contained water pints for container-type items", () => {
            const waterskin = makeItem({
                id: "ws-1",
                name: "Waterskin",
                type: "container",
                system: { quantity: 1 },
                flags: { [MODULE_ID]: { resourceType: "water" } }
            });
            const pint1 = makeItem({
                id: "p1",
                name: "Water (Pint)",
                system: { quantity: 3, container: "ws-1" }
            });

            const actor = makeActor({ items: [waterskin, pint1] });
            const options = MealPhaseHandler._buildWaterOptions(actor, { waterPerDay: 2 });
            const ws = options.find(o => o.itemId === "ws-1");
            expect(ws).toBeDefined();
            expect(ws.totalPints).toBe(3);
        });

        it("handles PF2e containerId as object { value: string }", () => {
            const bag = makeItem({ id: "bag-pf2", name: "Belt Pouch", type: "backpack", system: { quantity: 1 } });
            const water = makeItem({
                id: "water-pf2",
                name: "Waterskin",
                system: { quantity: 1, containerId: { value: "bag-pf2" } }
            });
            const actor = makeActor({ items: [bag, water] });
            const options = MealPhaseHandler._buildWaterOptions(actor, { waterPerDay: 2 });
            expect(options.map(o => o.itemId)).not.toContain("water-pf2");
        });

        it("skips container-type water items with 0 contained pints", () => {
            const waterskin = makeItem({
                id: "ws-empty",
                name: "Waterskin",
                type: "container",
                system: { quantity: 1 },
                flags: { [MODULE_ID]: { resourceType: "water" } }
            });
            const actor = makeActor({ items: [waterskin] });
            const options = MealPhaseHandler._buildWaterOptions(actor, { waterPerDay: 2 });
            expect(options.find(o => o.itemId === "ws-empty")).toBeUndefined();
        });
    });

    // ── _buildAdvisories ────────────────────────────────────────

    describe("_buildAdvisories", () => {
        it("warns about approaching food grace limit", () => {
            const advisories = MealPhaseHandler._buildAdvisories(
                2, 0, 5, { foodPerDay: 1, waterPerDay: 2, dehydrationDC: 15 },
                "forest", false, 0, true, 2, true
            );
            const food = advisories.find(a => a.message.includes("without food"));
            expect(food).toBeDefined();
            expect(food.level).toBe("warning");
            expect(food.message).toContain("3 more rest");
        });

        it("danger level when past food grace", () => {
            const advisories = MealPhaseHandler._buildAdvisories(
                6, 0, 5, { foodPerDay: 1, waterPerDay: 2, dehydrationDC: 15 },
                "forest", false, 0, true, 2, true
            );
            const food = advisories.find(a => a.message.includes("Starving"));
            expect(food).toBeDefined();
            expect(food.level).toBe("danger");
        });

        it("ok level when eating this rest with food sufficient", () => {
            const advisories = MealPhaseHandler._buildAdvisories(
                1, 0, 5, { foodPerDay: 1, waterPerDay: 2, dehydrationDC: 15 },
                "forest", true, 1, true, 2, true
            );
            const food = advisories.find(a => a.message.includes("Eating this rest"));
            expect(food).toBeDefined();
            expect(food.level).toBe("ok");
        });

        it("warns about dehydration", () => {
            const advisories = MealPhaseHandler._buildAdvisories(
                0, 1, 5, { foodPerDay: 1, waterPerDay: 2, dehydrationDC: 15 },
                "forest", true, 1, false, 0, true
            );
            const water = advisories.find(a => a.message.includes("water"));
            expect(water).toBeDefined();
            expect(water.level).toBe("danger");
            expect(water.message).toContain("DC 15");
        });

        it("shows ok for drinking this rest", () => {
            const advisories = MealPhaseHandler._buildAdvisories(
                0, 1, 5, { foodPerDay: 1, waterPerDay: 2, dehydrationDC: 15 },
                "forest", true, 1, true, 2, true
            );
            const water = advisories.find(a => a.message.includes("Drinking this rest"));
            expect(water).toBeDefined();
            expect(water.level).toBe("ok");
        });

        it("partial sustenance shows warning with bonus info for partial food", () => {
            const advisories = MealPhaseHandler._buildAdvisories(
                1, 0, 5, { foodPerDay: 3, waterPerDay: 2, dehydrationDC: 15 },
                "desert", false, 1, true, 2, true
            );
            const food = advisories.find(a => a.message.includes("1 of 3"));
            expect(food).toBeDefined();
            expect(food.message).toContain("half a day");
        });

        it("partial sustenance disabled shows no half-day bonus", () => {
            const advisories = MealPhaseHandler._buildAdvisories(
                1, 0, 5, { foodPerDay: 3, waterPerDay: 2, dehydrationDC: 15 },
                "desert", false, 1, true, 2, false
            );
            const food = advisories.find(a => a.message.includes("1 of 3"));
            expect(food).toBeDefined();
            expect(food.message).not.toContain("half a day");
        });

        it("partial water shows reduced DC with partialSustenance", () => {
            const advisories = MealPhaseHandler._buildAdvisories(
                0, 1, 5, { foodPerDay: 1, waterPerDay: 4, dehydrationDC: 15 },
                "desert", true, 1, false, 2, true
            );
            const water = advisories.find(a => a.message.includes("DC 13"));
            expect(water).toBeDefined();
            expect(water.level).toBe("warning");
        });

        it("adds terrain note when waterPerDay > 1 and note is present", () => {
            const advisories = MealPhaseHandler._buildAdvisories(
                0, 0, 5, { foodPerDay: 1, waterPerDay: 4, dehydrationDC: 15, note: "Scorching heat!" },
                "desert", true, 1, true, 4, true
            );
            const note = advisories.find(a => a.message === "Scorching heat!");
            expect(note).toBeDefined();
            expect(note.level).toBe("info");
        });
    });

    // ── _accumulateMealSatiation ────────────────────────────────

    describe("_accumulateMealSatiation", () => {
        it("wet meal credits water to consumer", () => {
            const snapshot = {
                flags: { [MODULE_ID]: { satiates: ["water"] } }
            };
            const extraWater = new Map();
            const extraFood = new Map();
            MealPhaseHandler._accumulateMealSatiation(
                snapshot, 1, "char-1", ["char-1", "char-2"],
                extraWater, extraFood
            );
            expect(extraWater.get("char-1")).toBe(1);
            expect(extraWater.has("char-2")).toBe(false);
        });

        it("party meal credits water to all members", () => {
            const snapshot = {
                flags: { [MODULE_ID]: { partyMeal: true, satiates: ["water"] } }
            };
            const extraWater = new Map();
            const extraFood = new Map();
            MealPhaseHandler._accumulateMealSatiation(
                snapshot, 1, "char-1", ["char-1", "char-2", "char-3"],
                extraWater, extraFood
            );
            expect(extraWater.get("char-1")).toBe(1);
            expect(extraWater.get("char-2")).toBe(1);
            expect(extraWater.get("char-3")).toBe(1);
        });

        it("party meal credits food to allies but not the cook", () => {
            const snapshot = {
                flags: { [MODULE_ID]: { partyMeal: true, satiates: ["food"] } }
            };
            const extraWater = new Map();
            const extraFood = new Map();
            MealPhaseHandler._accumulateMealSatiation(
                snapshot, 1, "cook", ["cook", "ally-1", "ally-2"],
                extraWater, extraFood
            );
            expect(extraFood.has("cook")).toBe(false);
            expect(extraFood.get("ally-1")).toBe(1);
            expect(extraFood.get("ally-2")).toBe(1);
        });

        it("accumulates across multiple servings", () => {
            const snapshot = {
                flags: { [MODULE_ID]: { satiates: ["water"] } }
            };
            const extraWater = new Map();
            const extraFood = new Map();
            MealPhaseHandler._accumulateMealSatiation(
                snapshot, 3, "char-1", ["char-1"],
                extraWater, extraFood
            );
            expect(extraWater.get("char-1")).toBe(3);
        });

        it("no-op when satiates is empty", () => {
            const snapshot = { flags: { [MODULE_ID]: {} } };
            const extraWater = new Map();
            const extraFood = new Map();
            MealPhaseHandler._accumulateMealSatiation(
                snapshot, 1, "char-1", ["char-1"],
                extraWater, extraFood
            );
            expect(extraWater.size).toBe(0);
            expect(extraFood.size).toBe(0);
        });
    });

    // ── _buffSummaryLabel ───────────────────────────────────────

    describe("_buffSummaryLabel", () => {
        it("formats temp_hp", () => {
            expect(MealPhaseHandler._buffSummaryLabel({ type: "temp_hp", formula: "1d8+2" }))
                .toBe("temp HP (1d8+2)");
        });

        it("formats heal", () => {
            expect(MealPhaseHandler._buffSummaryLabel({ type: "heal", formula: "2d6" }))
                .toBe("healing (2d6)");
        });

        it("formats advantage", () => {
            expect(MealPhaseHandler._buffSummaryLabel({ type: "advantage", save: { ability: "con" }, duration: "nextSave" }))
                .toBe("advantage on CON saves (nextSave)");
        });

        it("formats resistance", () => {
            expect(MealPhaseHandler._buffSummaryLabel({ type: "resistance", damageType: "poison", duration: "untilLongRest" }))
                .toBe("resistance (poison, untilLongRest)");
        });

        it("returns empty string for null buff", () => {
            expect(MealPhaseHandler._buffSummaryLabel(null)).toBe("");
            expect(MealPhaseHandler._buffSummaryLabel({})).toBe("");
        });

        it("returns type name for unknown type", () => {
            expect(MealPhaseHandler._buffSummaryLabel({ type: "custom_thing" }))
                .toBe("custom_thing");
        });
    });

    // ── _buffToActiveEffectPartsAsync (Well Fed regression) ─────

    describe("_buffToActiveEffectPartsAsync", () => {
        const stubActor = makeActor();

        it("returns summaryLine for advantage buff", async () => {
            const buff = { type: "advantage", save: { ability: "con" }, duration: "nextSave" };
            const result = await MealPhaseHandler._buffToActiveEffectPartsAsync(stubActor, buff);
            expect(result.summaryLine).toBe("advantage on CON saves (nextSave)");
            expect(result.changes).toHaveLength(1);
            expect(result.daeSpecialDuration).toContain("isSave.con");
        });

        it("returns summaryLine for resistance buff", async () => {
            const buff = { type: "resistance", damageType: "poison" };
            const result = await MealPhaseHandler._buffToActiveEffectPartsAsync(stubActor, buff);
            expect(result.summaryLine).toBe("resistance (poison)");
            expect(result.changes).toHaveLength(1);
            expect(result.daeSpecialDuration).toEqual([]);
        });

        it("returns summaryLine for temp_hp buff with positive roll", async () => {
            globalThis.Roll = class Roll {
                constructor(formula) { this.formula = formula; this.total = 5; this.dice = []; }
                async evaluate() { return this; }
            };
            const buff = { type: "temp_hp", formula: "1d8" };
            const result = await MealPhaseHandler._buffToActiveEffectPartsAsync(stubActor, buff);
            expect(result.summaryLine).toBe("temp HP +5");
            expect(result.changes.length).toBeGreaterThanOrEqual(1);
        });

        it("returns empty for temp_hp with zero total", async () => {
            globalThis.Roll = class Roll {
                constructor(formula) { this.formula = formula; this.total = 0; this.dice = []; }
                async evaluate() { return this; }
            };
            const buff = { type: "temp_hp", formula: "0" };
            const result = await MealPhaseHandler._buffToActiveEffectPartsAsync(stubActor, buff);
            expect(result.summaryLine).toBeUndefined();
            expect(result.changes).toHaveLength(0);
        });

        it("returns empty for null buff", async () => {
            const result = await MealPhaseHandler._buffToActiveEffectPartsAsync(stubActor, null);
            expect(result.changes).toHaveLength(0);
            expect(result.description).toBe("");
        });

        it("returns empty for unknown buff type", async () => {
            const buff = { type: "exotic_thing" };
            const result = await MealPhaseHandler._buffToActiveEffectPartsAsync(stubActor, buff);
            expect(result.changes).toHaveLength(0);
            expect(result.daeSpecialDuration).toEqual([]);
        });

        it("defaults advantage ability to con when save.ability is missing", async () => {
            const buff = { type: "advantage", duration: "nextSave" };
            const result = await MealPhaseHandler._buffToActiveEffectPartsAsync(stubActor, buff);
            expect(result.summaryLine).toContain("CON");
        });

        it("uses formula as ability fallback for advantage", async () => {
            const buff = { type: "advantage", formula: "wis", duration: "untilLongRest" };
            const result = await MealPhaseHandler._buffToActiveEffectPartsAsync(stubActor, buff);
            expect(result.summaryLine).toBe("advantage on WIS saves (untilLongRest)");
        });

        it("uses formula as damageType fallback for resistance", async () => {
            const buff = { type: "resistance", formula: "fire" };
            const result = await MealPhaseHandler._buffToActiveEffectPartsAsync(stubActor, buff);
            expect(result.summaryLine).toBe("resistance (fire)");
        });
    });

    // ── _mealSnapshotAsSingleLeftover ───────────────────────────

    describe("_mealSnapshotAsSingleLeftover", () => {
        it("clones item, sets qty to 1, clears partyMeal flag", () => {
            const snapshot = {
                _id: "orig-id",
                name: "Hearty Stew",
                system: { quantity: 5 },
                flags: { [MODULE_ID]: { partyMeal: true, wellFed: true } }
            };
            const leftover = MealPhaseHandler._mealSnapshotAsSingleLeftover(snapshot);
            expect(leftover._id).toBeUndefined();
            expect(leftover.system.quantity).toBe(1);
            expect(leftover.flags[MODULE_ID].partyMeal).toBe(false);
            expect(leftover.flags[MODULE_ID].wellFed).toBe(true);
            expect(snapshot.system.quantity).toBe(5);
        });
    });
});
