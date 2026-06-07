import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    getTravelGatherAvailability,
    isForagingEnabled,
    isHuntingEnabled,
    isTravelPhaseUsed,
    migrateUseTravel,
    shouldRunTravelPhase
} from "../services/TravelSettings.js";

const MODULE_ID = "ionrift-respite";

function makeGameHarness(initialSettings = {}, { isGM = true } = {}) {
    const store = new Map(Object.entries(initialSettings));
    const get = vi.fn((moduleId, key) => {
        expect(moduleId).toBe(MODULE_ID);
        return store.get(key);
    });
    const set = vi.fn((moduleId, key, value) => {
        expect(moduleId).toBe(MODULE_ID);
        store.set(key, value);
        return value;
    });
    globalThis.game = {
        user: { isGM },
        settings: { get, set }
    };
    return { store, get, set };
}

describe("TravelSettings", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        delete globalThis.game;
    });

    describe("isTravelPhaseUsed", () => {
        it("defaults to true when setting is undefined", () => {
            makeGameHarness({});
            expect(isTravelPhaseUsed()).toBe(true);
        });

        it("returns false when setting is explicitly false", () => {
            makeGameHarness({ useTravel: false });
            expect(isTravelPhaseUsed()).toBe(false);
        });

        it("returns true when game settings throw", () => {
            const get = vi.fn(() => {
                throw new Error("settings unavailable");
            });
            globalThis.game = { user: { isGM: true }, settings: { get, set: vi.fn() } };
            expect(isTravelPhaseUsed()).toBe(true);
        });
    });

    describe("gather toggles", () => {
        it("respects world settings for forage and hunt", () => {
            makeGameHarness({ enableForaging: true, enableHunting: false });
            expect(isForagingEnabled()).toBe(true);
            expect(isHuntingEnabled()).toBe(false);
        });

        it("limits activities by terrain and toggles", () => {
            makeGameHarness({ enableForaging: true, enableHunting: true });
            expect(getTravelGatherAvailability(["forage"])).toEqual({ canForage: true, canHunt: false });
        });

        it("uses default terrain activities when list is missing", () => {
            makeGameHarness({ enableForaging: false, enableHunting: true });
            expect(getTravelGatherAvailability(undefined)).toEqual({ canForage: false, canHunt: true });
        });
    });

    describe("shouldRunTravelPhase", () => {
        it("requires professions enabled even if useTravel is true", () => {
            makeGameHarness({ enableProfessions: false, useTravel: true });
            expect(shouldRunTravelPhase()).toBe(false);
        });

        it("runs when professions and travel toggles are both enabled", () => {
            makeGameHarness({ enableProfessions: true, useTravel: true });
            expect(shouldRunTravelPhase()).toBe(true);
        });
    });

    describe("migrateUseTravel", () => {
        it("does nothing for non-GM users", () => {
            const harness = makeGameHarness({ useTravelPhaseSemanticsMigrated: false }, { isGM: false });
            migrateUseTravel();
            expect(harness.set).not.toHaveBeenCalled();
        });

        it("marks migration and keeps existing useTravel value", () => {
            const harness = makeGameHarness({
                useTravel: false,
                useTravelPhaseSemanticsMigrated: false
            });

            migrateUseTravel();

            expect(harness.set).toHaveBeenCalledWith(MODULE_ID, "useTravel", false);
            expect(harness.set).toHaveBeenCalledWith(MODULE_ID, "useTravelPhaseSemanticsMigrated", true);
        });

        it("corrects legacy inverted migration when allowSkipTravel is true", () => {
            const harness = makeGameHarness({
                useTravel: false,
                useTravelMigrated: true,
                allowSkipTravel: true,
                useTravelPhaseSemanticsMigrated: false
            });

            migrateUseTravel();

            expect(harness.set).toHaveBeenCalledWith(MODULE_ID, "useTravel", true);
            expect(harness.store.get("useTravel")).toBe(true);
        });
    });
});
