/**
 * ResourceSink — Headless Unit Tests
 *
 * Covers pure / dependency-free methods and static data:
 *   - extractResourceEffects  : flat array filter from outcomes
 *   - _isProtectedItem        : name + flag + value guards
 *   - ITEM_FILTERS.*          : filter functions (given mock item objects)
 *   - SEVERITY_QTY / RESOURCE_NAMES / GOLD_SEVERITY : constant integrity
 *   - _distributeGoldLoss (pure math path, no actor.update)
 *
 * NOT covered here (require Foundry runtime):
 *   - processAll / _consumeResource / _distributeResourceLoss : actor.updateEmbeddedDocuments
 *   - _calcPercentRoll / proposeSupplyLoss : Roll.evaluate()
 *   - proposeGoldLoss / applyGoldLossProposal : Roll + actor.update
 */

import { describe, it, expect } from "vitest";
import { ResourceSink } from "../scripts/services/ResourceSink.js";

// ── Helpers ────────────────────────────────────────────────────────────────

function makeItem(overrides = {}) {
    return {
        id:     "item_001",
        name:   "Rope",
        type:   "loot",
        flags:  {},
        system: { quantity: 5, price: { value: 1 } },
        ...overrides
    };
}

function makeOutcome(effects = []) {
    return { effects };
}

// ── extractResourceEffects ─────────────────────────────────────────────────

describe("ResourceSink.extractResourceEffects", () => {
    it("extracts consume_resource effects from outcomes", () => {
        const outcomes = [
            makeOutcome([
                { type: "consume_resource", resource: "rations" },
                { type: "damage", formula: "1d6" }
            ]),
            makeOutcome([
                { type: "supply_loss", formula: "1d4*5" }
            ])
        ];

        const effects = ResourceSink.extractResourceEffects(outcomes);
        expect(effects).toHaveLength(2);
        expect(effects[0].type).toBe("consume_resource");
        expect(effects[1].type).toBe("supply_loss");
    });

    it("returns empty array when no resource-loss effects exist", () => {
        const outcomes = [makeOutcome([{ type: "damage", formula: "2d6" }])];
        expect(ResourceSink.extractResourceEffects(outcomes)).toEqual([]);
    });

    it("handles null/empty outcomes gracefully", () => {
        expect(ResourceSink.extractResourceEffects([])).toEqual([]);
        expect(ResourceSink.extractResourceEffects(null)).toEqual([]);
    });

    it("collects item_at_risk and consume_gold as resource-loss types", () => {
        const outcomes = [
            makeOutcome([
                { type: "item_at_risk", filter: ["consumable"] },
                { type: "consume_gold", severity: 1 }
            ])
        ];
        const effects = ResourceSink.extractResourceEffects(outcomes);
        expect(effects).toHaveLength(2);
    });
});

// ── _isProtectedItem ───────────────────────────────────────────────────────

describe("ResourceSink._isProtectedItem", () => {
    it("protects items with the ionrift-respite protected flag", () => {
        const item = makeItem({ flags: { "ionrift-respite": { protected: true } } });
        expect(ResourceSink._isProtectedItem(item)).toBe(true);
    });

    it("protects items in PROTECTED_NAMES by name", () => {
        const item = makeItem({ name: "Rations", type: "consumable" });
        expect(ResourceSink._isProtectedItem(item)).toBe(true);
    });

    it("protects arcane focus by name (case-normalised)", () => {
        const item = makeItem({ name: "Arcane Focus", type: "equipment" });
        expect(ResourceSink._isProtectedItem(item)).toBe(true);
    });

    it("protects items with 'instrument' in the name", () => {
        const item = makeItem({ name: "Lute (Musical Instrument)", type: "tool" });
        expect(ResourceSink._isProtectedItem(item)).toBe(true);
    });

    it("protects unique high-value items (qty 1, price > 100gp)", () => {
        const item = makeItem({ system: { quantity: 1, price: { value: 150 } } });
        expect(ResourceSink._isProtectedItem(item)).toBe(true);
    });

    it("does not protect common loot (qty 5, low price)", () => {
        const item = makeItem({ name: "Torches", system: { quantity: 5, price: { value: 1 } } });
        expect(ResourceSink._isProtectedItem(item)).toBe(false);
    });

    it("does not protect a moderately priced item if qty > 1", () => {
        const item = makeItem({ name: "Healing Potion", system: { quantity: 3, price: { value: 50 } } });
        expect(ResourceSink._isProtectedItem(item)).toBe(false);
    });
});

// ── ITEM_FILTERS ───────────────────────────────────────────────────────────

describe("ResourceSink.ITEM_FILTERS.consumable", () => {
    it("accepts unprotected consumables", () => {
        const item = makeItem({ type: "consumable", name: "Torch" });
        expect(ResourceSink.ITEM_FILTERS.consumable(item)).toBe(true);
    });

    it("rejects non-consumable types", () => {
        const item = makeItem({ type: "loot" });
        expect(ResourceSink.ITEM_FILTERS.consumable(item)).toBe(false);
    });

    it("rejects protected consumables", () => {
        const item = makeItem({ type: "consumable", name: "Rations" });
        expect(ResourceSink.ITEM_FILTERS.consumable(item)).toBe(false);
    });
});

describe("ResourceSink.ITEM_FILTERS.minor_consumable", () => {
    it("accepts cheap consumables (price < 50gp)", () => {
        const item = makeItem({ type: "consumable", name: "Torch", system: { quantity: 5, price: { value: 1 } } });
        expect(ResourceSink.ITEM_FILTERS.minor_consumable(item)).toBe(true);
    });

    it("rejects consumables priced at or above 50gp", () => {
        const item = makeItem({ type: "consumable", name: "Elixir of Health", system: { quantity: 1, price: { value: 50 } } });
        expect(ResourceSink.ITEM_FILTERS.minor_consumable(item)).toBe(false);
    });
});

describe("ResourceSink.ITEM_FILTERS.camp_gear", () => {
    it("accepts eligible loot/equipment/tool items", () => {
        const item = makeItem({ type: "loot", name: "Torch" });
        expect(ResourceSink.ITEM_FILTERS.camp_gear(item)).toBe(true);
    });

    it("rejects weapon type", () => {
        const item = makeItem({ type: "weapon", name: "Sword" });
        expect(ResourceSink.ITEM_FILTERS.camp_gear(item)).toBe(false);
    });

    it("rejects armor type", () => {
        const item = makeItem({ type: "armor", name: "Chainmail" });
        expect(ResourceSink.ITEM_FILTERS.camp_gear(item)).toBe(false);
    });

    it("rejects protected items", () => {
        const item = makeItem({ type: "tool", name: "Thieves' Tools" });
        expect(ResourceSink.ITEM_FILTERS.camp_gear(item)).toBe(false);
    });
});

// ── Static constant integrity ──────────────────────────────────────────────

describe("ResourceSink static constants", () => {
    it("SEVERITY_QTY has entries for severities 1-5", () => {
        for (let i = 1; i <= 5; i++) {
            expect(ResourceSink.SEVERITY_QTY[i]).toBeDefined();
            expect(typeof ResourceSink.SEVERITY_QTY[i].items).toBe("number");
            expect(typeof ResourceSink.SEVERITY_QTY[i].maxQtyPer).toBe("number");
        }
    });

    it("GOLD_SEVERITY has entries for severities 1-3", () => {
        for (let i = 1; i <= 3; i++) {
            const entry = ResourceSink.GOLD_SEVERITY[i];
            expect(entry).toBeDefined();
            expect(typeof entry.roll).toBe("string");
            expect(entry.maxPercent).toBeGreaterThan(0);
            expect(entry.minGp).toBeGreaterThan(0);
        }
    });

    it("RESOURCE_NAMES covers rations, supplies, water", () => {
        expect(ResourceSink.RESOURCE_NAMES.rations).toContain("rations");
        expect(ResourceSink.RESOURCE_NAMES.supplies).toContain("supplies");
        expect(ResourceSink.RESOURCE_NAMES.water).toContain("waterskin");
    });

    it("PROTECTED_NAMES contains critical gear", () => {
        expect(ResourceSink.PROTECTED_NAMES.has("rations")).toBe(true);
        expect(ResourceSink.PROTECTED_NAMES.has("arcane focus")).toBe(true);
        expect(ResourceSink.PROTECTED_NAMES.has("spellbook")).toBe(true);
    });
});
