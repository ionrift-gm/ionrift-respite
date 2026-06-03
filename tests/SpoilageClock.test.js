import { describe, it, expect, beforeEach, vi } from "vitest";

const MODULE_ID = "ionrift-respite";
let SpoilageClock;

beforeEach(async () => {
    globalThis.game = {
        system: { id: "dnd5e" },
        settings: { get: () => "" },
        modules: { get: () => null },
        actors: { get: () => null },
        users: [],
        user: { isGM: true },
        time: { worldTime: 0 }
    };

    vi.resetModules();
    const mod = await import("../scripts/services/SpoilageClock.js");
    SpoilageClock = mod.SpoilageClock;
});

describe("SpoilageClock", () => {

    // ── dateDiffDays ────────────────────────────────────────────

    describe("dateDiffDays", () => {
        it("returns 0 for same date", () => {
            expect(SpoilageClock.dateDiffDays("1-3-10", "1-3-10")).toBe(0);
        });

        it("returns positive diff for later dateB", () => {
            const diff = SpoilageClock.dateDiffDays("1-3-10", "1-3-13");
            expect(diff).toBe(3);
        });

        it("returns negative diff when dateA is after dateB", () => {
            const diff = SpoilageClock.dateDiffDays("1-3-15", "1-3-10");
            expect(diff).toBe(-5);
        });

        it("handles month boundaries", () => {
            const diff = SpoilageClock.dateDiffDays("1-0-28", "1-1-2");
            expect(diff).toBeGreaterThan(0);
        });

        it("returns NaN on malformed input (no valid date segments)", () => {
            expect(SpoilageClock.dateDiffDays("bad", "input")).toBeNaN();
        });
    });

    // ── getCalendarDaysRemaining ─────────────────────────────────

    describe("getCalendarDaysRemaining", () => {
        it("returns null for shelf-stable items (no spoilsAfter)", () => {
            const item = { name: "Iron Rations", flags: {} };
            expect(SpoilageClock.getCalendarDaysRemaining(item, { calendarDate: "1-3-10" })).toBeNull();
        });

        it("returns 0 when item is already spoiled", () => {
            const item = {
                name: "Berries",
                flags: {
                    [MODULE_ID]: {
                        spoiled: true,
                        spoilsAfter: 3,
                        harvestedDate: "1-3-5"
                    }
                }
            };
            expect(SpoilageClock.getCalendarDaysRemaining(item, { calendarDate: "1-3-6" })).toBe(0);
        });

        it("calculates remaining days from calendar date harvest key", () => {
            const item = {
                name: "Fresh Fish",
                flags: {
                    [MODULE_ID]: {
                        spoilsAfter: 5,
                        harvestedDate: "1-3-10"
                    }
                }
            };
            const remaining = SpoilageClock.getCalendarDaysRemaining(item, { calendarDate: "1-3-12" });
            expect(remaining).toBe(3); // 5 - 2 days passed
        });

        it("clamps to 0 when past spoilage window", () => {
            const item = {
                name: "Old Fish",
                flags: {
                    [MODULE_ID]: {
                        spoilsAfter: 2,
                        harvestedDate: "1-3-10"
                    }
                }
            };
            expect(SpoilageClock.getCalendarDaysRemaining(item, { calendarDate: "1-3-20" })).toBe(0);
        });

        it("uses epoch-based harvest key when harvestedDate is numeric", () => {
            const baseEpoch = 86400 * 10;
            const item = {
                name: "Meat",
                flags: {
                    [MODULE_ID]: {
                        spoilsAfter: 4,
                        harvestedDate: String(baseEpoch)
                    }
                }
            };
            const currentEpoch = baseEpoch + 86400 * 2;
            const remaining = SpoilageClock.getCalendarDaysRemaining(item, {
                calendarDate: null,
                worldTimeEpoch: currentEpoch
            });
            expect(remaining).toBe(2); // 4 - 2
        });

        it("returns full spoilsAfter when no harvestedDate exists", () => {
            const item = {
                name: "Rations",
                flags: {
                    [MODULE_ID]: { spoilsAfter: 7 }
                }
            };
            expect(SpoilageClock.getCalendarDaysRemaining(item, { calendarDate: "1-3-10" })).toBe(7);
        });
    });

    // ── areStacksCompatible ─────────────────────────────────────

    describe("areStacksCompatible", () => {
        it("returns true when both are shelf-stable", () => {
            const a = { name: "Iron Rations", flags: {} };
            const b = { name: "Hardtack", flags: {} };
            expect(SpoilageClock.areStacksCompatible(a, b, { calendarDate: "1-3-10" })).toBe(true);
        });

        it("returns false when one is perishable and one is shelf-stable", () => {
            const perishable = {
                name: "Fish",
                flags: { [MODULE_ID]: { spoilsAfter: 3, harvestedDate: "1-3-10" } }
            };
            const stable = { name: "Hardtack", flags: {} };
            expect(SpoilageClock.areStacksCompatible(perishable, stable, { calendarDate: "1-3-11" })).toBe(false);
        });

        it("returns true when both perishable with same days remaining", () => {
            const a = {
                name: "Fish A",
                flags: { [MODULE_ID]: { spoilsAfter: 5, harvestedDate: "1-3-10" } }
            };
            const b = {
                name: "Fish B",
                flags: { [MODULE_ID]: { spoilsAfter: 5, harvestedDate: "1-3-10" } }
            };
            expect(SpoilageClock.areStacksCompatible(a, b, { calendarDate: "1-3-12" })).toBe(true);
        });

        it("returns false when perishable with different days remaining", () => {
            const a = {
                name: "Fish A",
                flags: { [MODULE_ID]: { spoilsAfter: 5, harvestedDate: "1-3-10" } }
            };
            const b = {
                name: "Fish B",
                flags: { [MODULE_ID]: { spoilsAfter: 3, harvestedDate: "1-3-10" } }
            };
            expect(SpoilageClock.areStacksCompatible(a, b, { calendarDate: "1-3-12" })).toBe(false);
        });
    });

    // ── getConsumeSortKey ────────────────────────────────────────

    describe("getConsumeSortKey", () => {
        it("returns large number for shelf-stable items (consumed last)", () => {
            const item = { name: "Hardtack", flags: {} };
            expect(SpoilageClock.getConsumeSortKey(item, { calendarDate: "1-3-10" })).toBe(1_000_000);
        });

        it("returns days remaining for perishable items", () => {
            const item = {
                name: "Fish",
                flags: { [MODULE_ID]: { spoilsAfter: 4, harvestedDate: "1-3-10" } }
            };
            const key = SpoilageClock.getConsumeSortKey(item, { calendarDate: "1-3-12" });
            expect(key).toBe(2);
        });

        it("items closer to spoilage sort before those with more time", () => {
            const soon = {
                name: "Soon",
                flags: { [MODULE_ID]: { spoilsAfter: 2, harvestedDate: "1-3-10" } }
            };
            const later = {
                name: "Later",
                flags: { [MODULE_ID]: { spoilsAfter: 6, harvestedDate: "1-3-10" } }
            };
            const clock = { calendarDate: "1-3-11" };
            expect(SpoilageClock.getConsumeSortKey(soon, clock))
                .toBeLessThan(SpoilageClock.getConsumeSortKey(later, clock));
        });
    });
});
