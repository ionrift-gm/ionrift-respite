/**
 * Regression test: MealPhaseHandler.applyMealChoices must NOT re-consume
 * items from days that were already consumed via the day-by-day flow
 * (MealDelegate.onConsumeMealDay / receiveMealDayConsumeRequest).
 *
 * Bug: onConsumeMealDay consumed items per-day but did not mark consumed
 * days with `itemsConsumed: true`. When applyMealChoices ran at resolution,
 * it rebuilt usage maps from ALL consumedDays and called _consumeItem again,
 * causing double-consumption (data loss).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { MealPhaseHandler } from "../scripts/services/MealPhaseHandler.js";

function makeActor(id, name, items = [], flags = {}) {
    const itemsMap = new Map(items.map(i => [i.id, i]));
    return {
        id,
        name,
        img: "icons/actor.png",
        items: {
            ...itemsMap,
            [Symbol.iterator]: () => itemsMap.values()[Symbol.iterator](),
            get: (key) => itemsMap.get(key),
            find: (fn) => [...itemsMap.values()].find(fn),
            filter: (fn) => [...itemsMap.values()].filter(fn)
        },
        system: { abilities: { con: { mod: 2 } }, attributes: { prof: 2, exhaustion: 0 } },
        flags: { "ionrift-respite": flags },
        getFlag: (mod, key) => flags[key] ?? null,
        setFlag: vi.fn(async (mod, key, val) => { flags[key] = val; }),
        effects: [],
        deleteEmbeddedDocuments: vi.fn(async () => {}),
        createEmbeddedDocuments: vi.fn(async () => []),
        update: vi.fn(async () => {})
    };
}

function makeItem(id, name, qty = 1, opts = {}) {
    return {
        id,
        name,
        type: opts.type ?? "consumable",
        img: "icons/item.png",
        system: {
            quantity: qty,
            uses: opts.uses ?? null,
            type: opts.systemType ?? null,
            container: opts.container ?? undefined,
            containerId: opts.containerId ?? undefined
        },
        flags: opts.flags ?? {},
        toObject: () => ({ id, name, type: opts.type ?? "consumable", img: "icons/item.png", system: { quantity: qty }, flags: opts.flags ?? {} })
    };
}

describe("MealPhaseHandler – double-consumption prevention", () => {
    let actor;
    let consumeSpy;

    beforeEach(() => {
        const rations = makeItem("rations1", "Rations", 10, {
            systemType: { value: "food" }
        });
        const waterskin = makeItem("water1", "Waterskin", 8);
        actor = makeActor("char1", "TestHero", [rations, waterskin], {
            restsSinceFood: 0,
            restsSinceWater: 0
        });

        globalThis.game = {
            ...globalThis.game,
            system: { id: "dnd5e" },
            settings: { get: () => true },
            actors: { get: (id) => id === "char1" ? actor : null }
        };

        consumeSpy = vi.spyOn(MealPhaseHandler, "_consumeItem").mockResolvedValue(1);
    });

    it("skips consumption for days already marked as itemsConsumed", async () => {
        const mealChoices = new Map([
            ["char1", {
                food: [],
                water: [],
                consumedDays: [
                    { food: ["rations1"], water: ["water1", "water1"], itemsConsumed: true },
                    { food: ["rations1"], water: ["water1", "water1"], itemsConsumed: true },
                    { food: ["rations1"], water: ["water1", "water1"], itemsConsumed: true }
                ],
                currentDay: 3
            }]
        ]);

        await MealPhaseHandler.applyMealChoices(mealChoices, 3, { waterPerDay: 2, foodPerDay: 1 });

        expect(consumeSpy).not.toHaveBeenCalled();
    });

    it("consumes only un-marked days when some days are pre-consumed", async () => {
        const mealChoices = new Map([
            ["char1", {
                food: [],
                water: [],
                consumedDays: [
                    { food: ["rations1"], water: ["water1", "water1"], itemsConsumed: true },
                    { food: ["rations1"], water: ["water1", "water1"], itemsConsumed: true },
                    { food: ["rations1"], water: ["water1", "water1"] }
                ],
                currentDay: 3
            }]
        ]);

        await MealPhaseHandler.applyMealChoices(mealChoices, 3, { waterPerDay: 2, foodPerDay: 1 });

        const foodCalls = consumeSpy.mock.calls.filter(c => c[1] === "rations1");
        const waterCalls = consumeSpy.mock.calls.filter(c => c[1] === "water1");

        expect(foodCalls.length).toBe(1);
        expect(foodCalls[0][2]).toBe(1);

        expect(waterCalls.length).toBe(1);
        expect(waterCalls[0][2]).toBe(2);
    });

    it("consumes all days when none are marked (legacy/station path with choice.itemsConsumed)", async () => {
        const mealChoices = new Map([
            ["char1", {
                food: [],
                water: [],
                consumedDays: [
                    { food: ["rations1"], water: ["water1", "water1"] },
                    { food: ["rations1"], water: ["water1", "water1"] }
                ],
                currentDay: 2
            }]
        ]);

        await MealPhaseHandler.applyMealChoices(mealChoices, 2, { waterPerDay: 2, foodPerDay: 1 });

        const foodCalls = consumeSpy.mock.calls.filter(c => c[1] === "rations1");
        const waterCalls = consumeSpy.mock.calls.filter(c => c[1] === "water1");

        expect(foodCalls.length).toBe(1);
        expect(foodCalls[0][2]).toBe(2);

        expect(waterCalls.length).toBe(1);
        expect(waterCalls[0][2]).toBe(4);
    });

    it("choice.itemsConsumed=true skips all consumption entirely", async () => {
        const mealChoices = new Map([
            ["char1", {
                food: [],
                water: [],
                consumedDays: [
                    { food: ["rations1"], water: ["water1", "water1"] },
                    { food: ["rations1"], water: ["water1", "water1"] }
                ],
                currentDay: 2,
                itemsConsumed: true
            }]
        ]);

        await MealPhaseHandler.applyMealChoices(mealChoices, 2, { waterPerDay: 2, foodPerDay: 1 });

        expect(consumeSpy).not.toHaveBeenCalled();
    });
});
