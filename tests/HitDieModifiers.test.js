import { describe, it, expect, beforeEach } from "vitest";
import { HitDieModifiers } from "../scripts/services/HitDieModifiers.js";

describe("HitDieModifiers", () => {

    // ── scan ────────────────────────────────────────────────────

    describe("scan", () => {
        it("detects Durable feat by exact name", () => {
            const actor = {
                items: [
                    { type: "feat", name: "Durable" }
                ],
                system: { abilities: { con: { mod: 3 } } }
            };
            const result = HitDieModifiers.scan(actor);
            expect(result.hasDurable).toBe(true);
            expect(result.conMod).toBe(3);
        });

        it("matches Durable case-insensitively with whitespace", () => {
            const actor = {
                items: [{ type: "feat", name: "  durable  " }],
                system: { abilities: { con: { mod: 0 } } }
            };
            expect(HitDieModifiers.scan(actor).hasDurable).toBe(true);
        });

        it("rejects compound names like 'Durable Summons'", () => {
            const actor = {
                items: [{ type: "feat", name: "Durable Summons" }],
                system: { abilities: { con: { mod: 0 } } }
            };
            expect(HitDieModifiers.scan(actor).hasDurable).toBe(false);
        });

        it("requires type === 'feat' for Durable", () => {
            const actor = {
                items: [{ type: "feature", name: "Durable" }],
                system: { abilities: { con: { mod: 0 } } }
            };
            expect(HitDieModifiers.scan(actor).hasDurable).toBe(false);
        });

        it("detects attuned Periapt of Wound Closure (v4 boolean)", () => {
            const actor = {
                items: [{
                    type: "equipment",
                    name: "Periapt of Wound Closure",
                    system: { attuned: true }
                }],
                system: { abilities: { con: { mod: 1 } } }
            };
            expect(HitDieModifiers.scan(actor).hasPeriapt).toBe(true);
        });

        it("detects attuned Periapt via legacy string attunement", () => {
            const actor = {
                items: [{
                    type: "equipment",
                    name: "Periapt of Wound Closure",
                    system: { attunement: "attuned" }
                }],
                system: { abilities: { con: { mod: 0 } } }
            };
            expect(HitDieModifiers.scan(actor).hasPeriapt).toBe(true);
        });

        it("detects attuned Periapt via legacy numeric attunement (2)", () => {
            const actor = {
                items: [{
                    type: "equipment",
                    name: "Periapt of Wound Closure",
                    system: { attunement: 2 }
                }],
                system: { abilities: { con: { mod: 0 } } }
            };
            expect(HitDieModifiers.scan(actor).hasPeriapt).toBe(true);
        });

        it("rejects unattuned Periapt", () => {
            const actor = {
                items: [{
                    type: "equipment",
                    name: "Periapt of Wound Closure",
                    system: { attuned: false, attunement: "required" }
                }],
                system: { abilities: { con: { mod: 0 } } }
            };
            expect(HitDieModifiers.scan(actor).hasPeriapt).toBe(false);
        });

        it("matches Periapt name fragments case-insensitively", () => {
            const actor = {
                items: [{
                    type: "equipment",
                    name: "periapt of wound closure (rare)",
                    system: { attuned: true }
                }],
                system: { abilities: { con: { mod: 0 } } }
            };
            expect(HitDieModifiers.scan(actor).hasPeriapt).toBe(true);
        });

        it("defaults conMod to 0 when abilities are missing", () => {
            const actor = { items: [], system: {} };
            expect(HitDieModifiers.scan(actor).conMod).toBe(0);
        });

        it("handles null items gracefully", () => {
            const actor = { items: null, system: { abilities: { con: { mod: 2 } } } };
            const result = HitDieModifiers.scan(actor);
            expect(result.hasDurable).toBe(false);
            expect(result.hasPeriapt).toBe(false);
        });
    });

    // ── modifyRoll ──────────────────────────────────────────────

    describe("modifyRoll", () => {
        it("returns unmodified total when no modifiers active", () => {
            const { adjustedTotal, annotations } = HitDieModifiers.modifyRoll(4, 2, {
                hasDurable: false, hasPeriapt: false
            });
            expect(adjustedTotal).toBe(6);
            expect(annotations).toHaveLength(0);
        });

        it("doubles die with Periapt before adding CON", () => {
            const { adjustedTotal, annotations } = HitDieModifiers.modifyRoll(4, 2, {
                hasDurable: false, hasPeriapt: true
            });
            expect(adjustedTotal).toBe(10); // (4 * 2) + 2
            expect(annotations).toContain("Periapt ×2");
        });

        it("applies Durable floor of 2×CON", () => {
            const { adjustedTotal, annotations } = HitDieModifiers.modifyRoll(1, 3, {
                hasDurable: true, hasPeriapt: false
            });
            expect(adjustedTotal).toBe(6); // min(1+3, 2*3) = 6
            expect(annotations).toContain("Durable (min 6)");
        });

        it("does not apply Durable when roll already exceeds floor", () => {
            const { adjustedTotal, annotations } = HitDieModifiers.modifyRoll(5, 2, {
                hasDurable: true, hasPeriapt: false
            });
            expect(adjustedTotal).toBe(7); // 5+2 >= 2*2
            expect(annotations).toHaveLength(0);
        });

        it("applies both Periapt and Durable together", () => {
            const { adjustedTotal, annotations } = HitDieModifiers.modifyRoll(1, 4, {
                hasDurable: true, hasPeriapt: true
            });
            // Periapt: 1*2 = 2, total = 2+4 = 6; Durable floor = 2*4 = 8 → 8
            expect(adjustedTotal).toBe(8);
            expect(annotations).toContain("Periapt ×2");
            expect(annotations).toContain("Durable (min 8)");
        });
    });

    // ── applyMaxValueOverride ───────────────────────────────────

    describe("applyMaxValueOverride", () => {
        it("returns original die when disabled", () => {
            const result = HitDieModifiers.applyMaxValueOverride(false, 3, 10);
            expect(result.rawDie).toBe(3);
            expect(result.annotations).toHaveLength(0);
        });

        it("overrides die to max face when enabled", () => {
            const result = HitDieModifiers.applyMaxValueOverride(true, 3, 10);
            expect(result.rawDie).toBe(10);
            expect(result.annotations).toEqual(["Max HD (homebrew)"]);
        });

        it("returns original die for invalid dieMaxFace", () => {
            expect(HitDieModifiers.applyMaxValueOverride(true, 3, NaN).rawDie).toBe(3);
            expect(HitDieModifiers.applyMaxValueOverride(true, 3, 0).rawDie).toBe(3);
            expect(HitDieModifiers.applyMaxValueOverride(true, 3, -5).rawDie).toBe(3);
        });
    });

    // ── getSongDie ──────────────────────────────────────────────

    describe("getSongDie", () => {
        it("returns null for bard level < 2", () => {
            expect(HitDieModifiers.getSongDie(0)).toBeNull();
            expect(HitDieModifiers.getSongDie(1)).toBeNull();
        });

        it("returns 1d6 for levels 2–8", () => {
            expect(HitDieModifiers.getSongDie(2)).toBe("1d6");
            expect(HitDieModifiers.getSongDie(8)).toBe("1d6");
        });

        it("returns 1d8 for levels 9–12", () => {
            expect(HitDieModifiers.getSongDie(9)).toBe("1d8");
            expect(HitDieModifiers.getSongDie(12)).toBe("1d8");
        });

        it("returns 1d10 for levels 13–16", () => {
            expect(HitDieModifiers.getSongDie(13)).toBe("1d10");
            expect(HitDieModifiers.getSongDie(16)).toBe("1d10");
        });

        it("returns 1d12 for levels 17+", () => {
            expect(HitDieModifiers.getSongDie(17)).toBe("1d12");
            expect(HitDieModifiers.getSongDie(20)).toBe("1d12");
        });
    });

    // ── scanPartyForSongOfRest ──────────────────────────────────

    describe("scanPartyForSongOfRest", () => {
        function makeBard(name, level) {
            return {
                name,
                items: [{ type: "class", name: "Bard", system: { levels: level } }]
            };
        }

        it("returns hasBard:false when no bards exist", () => {
            const actors = [
                { name: "Fighter", items: [{ type: "class", name: "Fighter", system: { levels: 5 } }] }
            ];
            const result = HitDieModifiers.scanPartyForSongOfRest(actors);
            expect(result.hasBard).toBe(false);
            expect(result.songDie).toBeNull();
        });

        it("returns hasBard:false when bard is level 1", () => {
            const result = HitDieModifiers.scanPartyForSongOfRest([makeBard("Low Bard", 1)]);
            expect(result.hasBard).toBe(false);
        });

        it("picks the highest-level bard", () => {
            const actors = [makeBard("Junior", 3), makeBard("Senior", 10)];
            const result = HitDieModifiers.scanPartyForSongOfRest(actors);
            expect(result.hasBard).toBe(true);
            expect(result.bardName).toBe("Senior");
            expect(result.bardLevel).toBe(10);
            expect(result.songDie).toBe("1d8");
        });

        it("handles null actors array", () => {
            const result = HitDieModifiers.scanPartyForSongOfRest(null);
            expect(result.hasBard).toBe(false);
        });
    });

    // ── scanAllEligibleBards ────────────────────────────────────

    describe("scanAllEligibleBards", () => {
        it("returns all bards with level >= 2", () => {
            const actors = [
                { id: "a1", name: "Bard A", items: [{ type: "class", name: "Bard", system: { levels: 5 } }] },
                { id: "a2", name: "Bard B", items: [{ type: "class", name: "Bard", system: { levels: 2 } }] },
                { id: "a3", name: "Not Bard", items: [{ type: "class", name: "Ranger", system: { levels: 10 } }] },
                { id: "a4", name: "Baby Bard", items: [{ type: "class", name: "Bard", system: { levels: 1 } }] }
            ];
            const bards = HitDieModifiers.scanAllEligibleBards(actors);
            expect(bards).toHaveLength(2);
            expect(bards[0].actorId).toBe("a1");
            expect(bards[1].actorId).toBe("a2");
        });

        it("returns empty array for null input", () => {
            expect(HitDieModifiers.scanAllEligibleBards(null)).toEqual([]);
        });
    });

    // ── rollSongBonus ───────────────────────────────────────────

    describe("rollSongBonus", () => {
        it("returns a total and formula", async () => {
            const result = await HitDieModifiers.rollSongBonus("1d6", "TestBard");
            expect(result).toHaveProperty("total");
            expect(result).toHaveProperty("formula", "1d6");
            expect(typeof result.total).toBe("number");
        });
    });
});
