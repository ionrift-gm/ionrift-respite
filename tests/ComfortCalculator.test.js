import { describe, it, expect, beforeEach } from "vitest";
import {
    isComfortEnabled,
    COMFORT_TIERS,
    COMFORT_RANK,
    RANK_TO_KEY,
    HD_PENALTY,
    HP_FRACTION,
    EXHAUSTION_DC,
    boostComfort,
    getExhaustionDC,
    getHdPenalty,
    getHpFraction,
    getComfortDcMod
} from "../scripts/services/ComfortCalculator.js";

const MODULE_ID = "ionrift-respite";

beforeEach(() => {
    globalThis.game = {
        system: { id: "dnd5e" },
        settings: {
            get: (mod, key) => {
                if (mod === MODULE_ID && key === "enableComfort") return true;
                return "";
            }
        }
    };
});

describe("ComfortCalculator", () => {

    // ── isComfortEnabled ────────────────────────────────────────

    describe("isComfortEnabled", () => {
        it("returns true when setting is true", () => {
            expect(isComfortEnabled()).toBe(true);
        });

        it("returns false when setting is false", () => {
            globalThis.game.settings.get = (mod, key) => {
                if (key === "enableComfort") return false;
                return "";
            };
            expect(isComfortEnabled()).toBe(false);
        });

        it("defaults to true when settings.get throws", () => {
            globalThis.game.settings.get = () => { throw new Error("not registered"); };
            expect(isComfortEnabled()).toBe(true);
        });
    });

    // ── Canonical data ──────────────────────────────────────────

    describe("canonical data", () => {
        it("COMFORT_TIERS is ordered worst to best", () => {
            expect(COMFORT_TIERS).toEqual(["hostile", "rough", "sheltered", "safe"]);
        });

        it("COMFORT_RANK maps each tier to its index", () => {
            expect(COMFORT_RANK.hostile).toBe(0);
            expect(COMFORT_RANK.rough).toBe(1);
            expect(COMFORT_RANK.sheltered).toBe(2);
            expect(COMFORT_RANK.safe).toBe(3);
        });

        it("RANK_TO_KEY is the inverse of COMFORT_RANK", () => {
            for (const [tier, rank] of Object.entries(COMFORT_RANK)) {
                expect(RANK_TO_KEY[rank]).toBe(tier);
            }
        });

        it("HD_PENALTY increases with discomfort", () => {
            expect(HD_PENALTY.safe).toBe(0);
            expect(HD_PENALTY.sheltered).toBe(0);
            expect(HD_PENALTY.rough).toBe(1);
            expect(HD_PENALTY.hostile).toBe(2);
        });

        it("HP_FRACTION caps at hostile", () => {
            expect(HP_FRACTION.safe).toBe(1.0);
            expect(HP_FRACTION.hostile).toBe(0.75);
        });

        it("EXHAUSTION_DC is null for safe/sheltered, set for rough/hostile", () => {
            expect(EXHAUSTION_DC.safe).toBeNull();
            expect(EXHAUSTION_DC.sheltered).toBeNull();
            expect(EXHAUSTION_DC.rough).toBe(10);
            expect(EXHAUSTION_DC.hostile).toBe(15);
        });
    });

    // ── boostComfort ────────────────────────────────────────────

    describe("boostComfort", () => {
        it("boosts hostile by 1 step to rough", () => {
            expect(boostComfort("hostile", 1)).toBe("rough");
        });

        it("boosts rough by 2 steps to safe", () => {
            expect(boostComfort("rough", 2)).toBe("safe");
        });

        it("clamps at safe ceiling", () => {
            expect(boostComfort("safe", 5)).toBe("safe");
        });

        it("lowers safe by negative steps", () => {
            expect(boostComfort("safe", -1)).toBe("sheltered");
            expect(boostComfort("safe", -3)).toBe("hostile");
        });

        it("clamps at hostile floor", () => {
            expect(boostComfort("hostile", -10)).toBe("hostile");
        });

        it("passes through unknown tier unchanged", () => {
            expect(boostComfort("magical", 1)).toBe("magical");
        });

        it("defaults step to 1", () => {
            expect(boostComfort("rough")).toBe("sheltered");
        });

        it("returns 'safe' when comfort is disabled", () => {
            globalThis.game.settings.get = (mod, key) => {
                if (key === "enableComfort") return false;
                return "";
            };
            expect(boostComfort("hostile", 1)).toBe("safe");
        });
    });

    // ── getExhaustionDC ─────────────────────────────────────────

    describe("getExhaustionDC", () => {
        it("returns correct DC for each tier", () => {
            expect(getExhaustionDC("hostile")).toBe(15);
            expect(getExhaustionDC("rough")).toBe(10);
            expect(getExhaustionDC("sheltered")).toBeNull();
            expect(getExhaustionDC("safe")).toBeNull();
        });

        it("returns null for unknown tier", () => {
            expect(getExhaustionDC("cozy")).toBeNull();
        });

        it("returns null when comfort is disabled", () => {
            globalThis.game.settings.get = (mod, key) => {
                if (key === "enableComfort") return false;
                return "";
            };
            expect(getExhaustionDC("hostile")).toBeNull();
        });
    });

    // ── getHdPenalty ────────────────────────────────────────────

    describe("getHdPenalty", () => {
        it("returns 2 for hostile", () => {
            expect(getHdPenalty("hostile")).toBe(2);
        });

        it("returns 0 for unknown tier", () => {
            expect(getHdPenalty("luxury")).toBe(0);
        });

        it("returns 0 when comfort is disabled", () => {
            globalThis.game.settings.get = (mod, key) => {
                if (key === "enableComfort") return false;
                return "";
            };
            expect(getHdPenalty("hostile")).toBe(0);
        });
    });

    // ── getHpFraction ───────────────────────────────────────────

    describe("getHpFraction", () => {
        it("returns 0.75 for hostile", () => {
            expect(getHpFraction("hostile")).toBe(0.75);
        });

        it("returns 1.0 for safe", () => {
            expect(getHpFraction("safe")).toBe(1.0);
        });

        it("returns 1.0 for unknown tier", () => {
            expect(getHpFraction("palace")).toBe(1.0);
        });

        it("returns 1.0 when comfort is disabled", () => {
            globalThis.game.settings.get = (mod, key) => {
                if (key === "enableComfort") return false;
                return "";
            };
            expect(getHpFraction("hostile")).toBe(1.0);
        });
    });

    // ── getComfortDcMod ─────────────────────────────────────────

    describe("getComfortDcMod", () => {
        it("returns 0 for safe", () => {
            expect(getComfortDcMod("safe")).toBe(0);
        });

        it("returns 2 for rough", () => {
            expect(getComfortDcMod("rough")).toBe(2);
        });

        it("returns 5 for hostile", () => {
            expect(getComfortDcMod("hostile")).toBe(5);
        });

        it("returns 0 for unknown tier", () => {
            expect(getComfortDcMod("penthouse")).toBe(0);
        });

        it("returns 0 when comfort is disabled", () => {
            globalThis.game.settings.get = (mod, key) => {
                if (key === "enableComfort") return false;
                return "";
            };
            expect(getComfortDcMod("hostile")).toBe(0);
        });
    });
});
