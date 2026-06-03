import { describe, it, expect, beforeEach, vi } from "vitest";
import { GrantLedger } from "../scripts/services/GrantLedger.js";

describe("GrantLedger", () => {

    let ledger;

    beforeEach(() => {
        ledger = new GrantLedger();
    });

    // ── has / get / record ──────────────────────────────────────

    describe("has / get / record", () => {
        it("returns false for unknown keys", () => {
            expect(ledger.has("missing")).toBe(false);
        });

        it("returns null from get for unknown keys", () => {
            expect(ledger.get("missing")).toBeNull();
        });

        it("records a slot and reflects it in has/get", () => {
            ledger.record("key-1", { item: "sword" });
            expect(ledger.has("key-1")).toBe(true);
            expect(ledger.get("key-1")).toEqual({ item: "sword" });
        });

        it("ignores record with empty slotKey", () => {
            ledger.record("", { item: "nope" });
            expect(ledger.has("")).toBe(false);
        });

        it("overwrites summary on repeated record", () => {
            ledger.record("key-1", "first");
            ledger.record("key-1", "second");
            expect(ledger.get("key-1")).toBe("second");
        });
    });

    // ── grantOnce ───────────────────────────────────────────────

    describe("grantOnce", () => {
        it("runs grantFn on first call and returns duplicate: false", async () => {
            const fn = vi.fn().mockResolvedValue("loot-summary");
            const result = await ledger.grantOnce("slot-a", fn);

            expect(fn).toHaveBeenCalledOnce();
            expect(result).toEqual({ duplicate: false, summary: "loot-summary" });
        });

        it("returns cached summary on second call without running grantFn again", async () => {
            const fn = vi.fn().mockResolvedValue("loot-summary");
            await ledger.grantOnce("slot-a", fn);
            const second = await ledger.grantOnce("slot-a", fn);

            expect(fn).toHaveBeenCalledOnce();
            expect(second).toEqual({ duplicate: true, summary: "loot-summary" });
        });

        it("always runs grantFn when slotKey is empty", async () => {
            const fn = vi.fn().mockResolvedValue("ephemeral");
            await ledger.grantOnce("", fn);
            await ledger.grantOnce("", fn);

            expect(fn).toHaveBeenCalledTimes(2);
        });

        it("returns duplicate: false for empty slotKey even on repeat", async () => {
            const fn = vi.fn().mockResolvedValue("x");
            const r1 = await ledger.grantOnce("", fn);
            const r2 = await ledger.grantOnce("", fn);

            expect(r1.duplicate).toBe(false);
            expect(r2.duplicate).toBe(false);
        });
    });

    // ── reset ───────────────────────────────────────────────────

    describe("reset", () => {
        it("clears all entries", () => {
            ledger.record("a", 1);
            ledger.record("b", 2);
            ledger.reset();
            expect(ledger.has("a")).toBe(false);
            expect(ledger.has("b")).toBe(false);
        });
    });

    // ── serialize / deserialize ─────────────────────────────────

    describe("serialize / deserialize", () => {
        it("round-trips entries through serialize → deserialize", () => {
            ledger.record("slot-x", { reward: "gold" });
            const json = ledger.serialize();

            const restored = new GrantLedger();
            restored.deserialize(json);

            expect(restored.has("slot-x")).toBe(true);
            expect(restored.get("slot-x")).toEqual({ reward: "gold" });
        });

        it("deserialize handles null gracefully", () => {
            ledger.record("key", "val");
            ledger.deserialize(null);
            expect(ledger.has("key")).toBe(false);
        });

        it("deserialize handles undefined gracefully", () => {
            ledger.deserialize(undefined);
            expect(ledger.has("anything")).toBe(false);
        });

        it("deserialize handles non-object gracefully", () => {
            ledger.deserialize("not-an-object");
            expect(ledger.has("anything")).toBe(false);
        });

        it("deserialize skips null entries in the data object", () => {
            ledger.deserialize({ "key-a": null, "key-b": { summary: "ok" } });
            expect(ledger.has("key-a")).toBe(false);
            expect(ledger.has("key-b")).toBe(true);
            expect(ledger.get("key-b")).toBe("ok");
        });

        it("deserialize provides default grantedAt and summary when missing", () => {
            ledger.deserialize({ "key-c": {} });
            expect(ledger.has("key-c")).toBe(true);
            expect(ledger.get("key-c")).toBeNull();
        });
    });

    // ── static slot key builders ────────────────────────────────

    describe("static slot key builders", () => {
        it("travelSlotKey produces stable format", () => {
            expect(GrantLedger.travelSlotKey("3", "actor-1", "forage"))
                .toBe("travel:day3:actor-1:forage");
        });

        it("craftingSlotKey produces stable format", () => {
            expect(GrantLedger.craftingSlotKey("actor-1", "prof-alchemy", "recipe-heal"))
                .toBe("crafting:actor-1:prof-alchemy:recipe-heal");
        });

        it("discoverySlotKey produces stable format", () => {
            expect(GrantLedger.discoverySlotKey("evt-42", "item-ref-99"))
                .toBe("discovery:evt-42:item-ref-99");
        });

        it("mealSlotKey produces stable format", () => {
            expect(GrantLedger.mealSlotKey("actor-1", "rations"))
                .toBe("meal:actor-1:rations");
        });

        it("slot keys are collision-free across namespaces", () => {
            const travel = GrantLedger.travelSlotKey("1", "a", "forage");
            const crafting = GrantLedger.craftingSlotKey("a", "1", "forage");
            const discovery = GrantLedger.discoverySlotKey("a", "1");
            const meal = GrantLedger.mealSlotKey("a", "1");
            const keys = new Set([travel, crafting, discovery, meal]);
            expect(keys.size).toBe(4);
        });
    });

    // ── hasCraftingForActor ─────────────────────────────────────

    describe("hasCraftingForActor", () => {
        it("returns false when no crafting grants exist", () => {
            expect(ledger.hasCraftingForActor("actor-1")).toBe(false);
        });

        it("returns true after a crafting grant for the actor", () => {
            ledger.record(GrantLedger.craftingSlotKey("actor-1", "alchemy", "recipe-a"), "done");
            expect(ledger.hasCraftingForActor("actor-1")).toBe(true);
        });

        it("does not match a different actor", () => {
            ledger.record(GrantLedger.craftingSlotKey("actor-2", "alchemy", "recipe-a"), "done");
            expect(ledger.hasCraftingForActor("actor-1")).toBe(false);
        });

        it("scopes to professionId when provided", () => {
            ledger.record(GrantLedger.craftingSlotKey("actor-1", "alchemy", "recipe-a"), "done");
            expect(ledger.hasCraftingForActor("actor-1", "alchemy")).toBe(true);
            expect(ledger.hasCraftingForActor("actor-1", "smithing")).toBe(false);
        });

        it("matches any profession when professionId is null", () => {
            ledger.record(GrantLedger.craftingSlotKey("actor-1", "smithing", "recipe-b"), "done");
            expect(ledger.hasCraftingForActor("actor-1")).toBe(true);
        });

        it("handles multiple professions for the same actor", () => {
            ledger.record(GrantLedger.craftingSlotKey("actor-1", "alchemy", "r1"), "a");
            ledger.record(GrantLedger.craftingSlotKey("actor-1", "smithing", "r2"), "b");
            expect(ledger.hasCraftingForActor("actor-1", "alchemy")).toBe(true);
            expect(ledger.hasCraftingForActor("actor-1", "smithing")).toBe(true);
            expect(ledger.hasCraftingForActor("actor-1", "cooking")).toBe(false);
        });
    });
});
