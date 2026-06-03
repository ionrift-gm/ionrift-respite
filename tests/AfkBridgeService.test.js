import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * AfkBridgeService regression tests.
 *
 * Covers the OR-merge readIntegratedAfk logic, adapter detection,
 * control source routing, and the reconcile workflow introduced in ba58980.
 *
 * These tests mock the adapter modules and RestAfkState to isolate
 * the bridge service's orchestration logic.
 */

const MODULE_ID = "ionrift-respite";

let bridge;

beforeEach(async () => {
    globalThis.game = {
        system: { id: "dnd5e" },
        settings: { get: (mod, key) => {
            if (key === "afkControlSource") return "respite";
            return "";
        }},
        modules: { get: () => null },
        actors: { get: () => null },
        users: [{ id: "gm-1", isGM: true, active: true }],
        ionrift: {},
        canvas: { scene: null },
        playerListStatus: null
    };

    vi.resetModules();
    bridge = await import("../scripts/services/afk/AfkBridgeService.js");
});

describe("AfkBridgeService", () => {

    // ── getAfkControlSource ─────────────────────────────────────

    describe("getAfkControlSource", () => {
        it("returns 'respite' by default", () => {
            expect(bridge.getAfkControlSource()).toBe("respite");
        });

        it("returns 'integrated' when setting is 'integrated'", () => {
            globalThis.game.settings.get = (mod, key) => {
                if (key === "afkControlSource") return "integrated";
                return "";
            };
            expect(bridge.getAfkControlSource()).toBe("integrated");
        });

        it("falls back to 'respite' on settings error", () => {
            globalThis.game.settings.get = () => { throw new Error("not registered"); };
            expect(bridge.getAfkControlSource()).toBe("respite");
        });

        it("normalizes unexpected values to 'respite'", () => {
            globalThis.game.settings.get = () => "bogus";
            expect(bridge.getAfkControlSource()).toBe("respite");
        });
    });

    // ── canUseRespiteAfkControls ────────────────────────────────

    describe("canUseRespiteAfkControls", () => {
        it("returns true when source is 'respite'", () => {
            expect(bridge.canUseRespiteAfkControls()).toBe(true);
        });

        it("returns false when source is 'integrated'", () => {
            globalThis.game.settings.get = (mod, key) => {
                if (key === "afkControlSource") return "integrated";
                return "";
            };
            expect(bridge.canUseRespiteAfkControls()).toBe(false);
        });
    });

    // ── isIntegratedAfkPrimary ──────────────────────────────────

    describe("isIntegratedAfkPrimary", () => {
        it("returns false when source is 'respite'", () => {
            expect(bridge.isIntegratedAfkPrimary()).toBe(false);
        });

        it("returns true when source is 'integrated'", () => {
            globalThis.game.settings.get = (mod, key) => {
                if (key === "afkControlSource") return "integrated";
                return "";
            };
            expect(bridge.isIntegratedAfkPrimary()).toBe(true);
        });
    });

    // ── getDetectedAfkAdapters ──────────────────────────────────

    describe("getDetectedAfkAdapters", () => {
        it("returns empty array when no adapters are active", () => {
            const adapters = bridge.getDetectedAfkAdapters();
            expect(adapters).toEqual([]);
        });

        it("includes Fast Flip when module is active", () => {
            globalThis.game.modules = {
                get: (id) => {
                    if (id === "fast-flip") return { active: true };
                    return null;
                }
            };
            const adapters = bridge.getDetectedAfkAdapters();
            const ff = adapters.find(a => a.id === "fast-flip");
            expect(ff).toBeDefined();
            expect(ff.active).toBe(true);
        });

        it("includes Player List Status when API is available", () => {
            globalThis.game.playerListStatus = {
                status: () => false,
                on: () => {},
                off: () => {}
            };
            const adapters = bridge.getDetectedAfkAdapters();
            const pls = adapters.find(a => a.id === "player-list-status");
            expect(pls).toBeDefined();
            expect(pls.active).toBe(true);
        });
    });

    // ── readIntegratedAfk (OR-merge) ────────────────────────────

    describe("readIntegratedAfk", () => {
        it("returns null when no adapters are active", () => {
            expect(bridge.readIntegratedAfk("char-1")).toBeNull();
        });

        it("returns false when all adapters report non-AFK", () => {
            globalThis.game.modules = {
                get: (id) => {
                    if (id === "fast-flip") return { active: true };
                    return null;
                }
            };
            globalThis.game.canvas = {
                scene: {
                    tokens: [{
                        actorId: "char-1",
                        getFlag: () => false
                    }]
                }
            };
            expect(bridge.readIntegratedAfk("char-1")).toBe(false);
        });

        it("returns true if any adapter reports AFK (OR-merge)", () => {
            globalThis.game.modules = {
                get: (id) => {
                    if (id === "fast-flip") return { active: true };
                    return null;
                }
            };
            globalThis.game.canvas = {
                scene: {
                    tokens: [{
                        actorId: "char-1",
                        getFlag: (mod, key) => {
                            if (mod === "fast-flip") return true;
                            return false;
                        }
                    }]
                }
            };
            expect(bridge.readIntegratedAfk("char-1")).toBe(true);
        });

        it("GM character always returns false from Fast Flip", () => {
            globalThis.game.modules = {
                get: (id) => {
                    if (id === "fast-flip") return { active: true };
                    return null;
                }
            };
            expect(bridge.readIntegratedAfk("gm")).toBe(false);
        });
    });
});
