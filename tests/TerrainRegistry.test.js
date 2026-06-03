import { describe, it, expect, beforeEach } from "vitest";
import { TerrainRegistry } from "../scripts/services/TerrainRegistry.js";

/**
 * TerrainRegistry regression tests.
 *
 * Covers the data-driven category system introduced in 4016f2d,
 * overlay graduation in 8cb9df7, comfort validation, option grouping,
 * and the reset/init lifecycle.
 */

function injectTerrains(terrains) {
    TerrainRegistry._terrains.clear();
    for (const t of terrains) {
        TerrainRegistry._terrains.set(t.id, t);
    }
    TerrainRegistry._ready = true;
}

const FOREST = {
    id: "forest",
    label: "Forest",
    category: "wilderness",
    comfort: "rough",
    scoutingAvailable: true,
    scoutGuidance: "Survival check.",
    scoutFlavor: { nat1: ["A clearing."] },
    mealRules: { waterPerDay: 2, foodPerDay: 1 },
    weather: ["clear", "rain"],
    eventsFile: "core/events/forest_events.json"
};

const TAVERN = {
    id: "tavern",
    label: "Tavern",
    category: "safe-haven",
    comfort: "safe",
    scoutingAvailable: false,
    mealRules: { waterPerDay: 0, foodPerDay: 0 },
    weather: ["clear", "tavern_rain"],
    eventsFile: "core/events/tavern_events.json"
};

const DUNGEON = {
    id: "dungeon",
    label: "Dungeon",
    category: "dungeon",
    comfort: "hostile",
    scoutingAvailable: false,
    mealRules: { waterPerDay: 2, foodPerDay: 1 },
    weather: ["dungeon_normal"],
    eventsFile: "core/events/dungeon_events.json"
};

const SWAMP = {
    id: "swamp",
    label: "Swamp",
    category: "wilderness",
    comfort: "rough",
    scoutingAvailable: true,
    weather: ["rain", "fog"],
    eventsFile: "core/events/swamp_events.json"
};

describe("TerrainRegistry", () => {

    beforeEach(() => {
        TerrainRegistry.reset();
    });

    // ── getCategory ─────────────────────────────────────────────

    describe("getCategory", () => {
        it("returns explicit category from terrain.json", () => {
            injectTerrains([FOREST, TAVERN, DUNGEON]);
            expect(TerrainRegistry.getCategory("forest")).toBe("wilderness");
            expect(TerrainRegistry.getCategory("tavern")).toBe("safe-haven");
            expect(TerrainRegistry.getCategory("dungeon")).toBe("dungeon");
        });

        it("falls back to 'wilderness' for unknown terrain id", () => {
            injectTerrains([FOREST]);
            expect(TerrainRegistry.getCategory("nonexistent")).toBe("wilderness");
        });

        it("falls back to comfort-based heuristic when category is missing", () => {
            const legacy = { id: "old-tavern", label: "Old Tavern", comfort: "safe" };
            injectTerrains([legacy]);
            expect(TerrainRegistry.getCategory("old-tavern")).toBe("safe-haven");
        });

        it("falls back to 'wilderness' when comfort is not 'safe' and category is missing", () => {
            const noCat = { id: "plains", label: "Plains", comfort: "rough" };
            injectTerrains([noCat]);
            expect(TerrainRegistry.getCategory("plains")).toBe("wilderness");
        });

        it("ignores invalid category values", () => {
            const bad = { id: "bad", label: "Bad", category: "INVALID", comfort: "safe" };
            injectTerrains([bad]);
            expect(TerrainRegistry.getCategory("bad")).toBe("safe-haven");
        });
    });

    // ── getDefaults ─────────────────────────────────────────────

    describe("getDefaults", () => {
        it("returns terrain-specific defaults", () => {
            injectTerrains([FOREST]);
            const d = TerrainRegistry.getDefaults("forest");
            expect(d.comfort).toBe("rough");
            expect(d.scoutingAvailable).toBe(true);
            expect(d.mealRules).toEqual({ waterPerDay: 2, foodPerDay: 1 });
        });

        it("returns safe defaults for unknown terrain", () => {
            injectTerrains([]);
            const d = TerrainRegistry.getDefaults("nope");
            expect(d.comfort).toBe("sheltered");
            expect(d.scoutingAvailable).toBe(false);
            expect(d.mealRules).toEqual({ waterPerDay: 2, foodPerDay: 1 });
        });

        it("rejects invalid comfort values, falls back to 'rough'", () => {
            const bad = { id: "weird", label: "Weird", comfort: "INVALID" };
            injectTerrains([bad]);
            const d = TerrainRegistry.getDefaults("weird");
            expect(d.comfort).toBe("rough");
        });

        it("accepts all valid comfort values", () => {
            for (const comfort of ["safe", "sheltered", "rough", "hostile"]) {
                const t = { id: `c-${comfort}`, label: comfort, comfort };
                injectTerrains([t]);
                expect(TerrainRegistry.getDefaults(`c-${comfort}`).comfort).toBe(comfort);
            }
        });

        it("returns scoutGuidance and scoutFlavor when present", () => {
            injectTerrains([FOREST]);
            const d = TerrainRegistry.getDefaults("forest");
            expect(d.scoutGuidance).toBe("Survival check.");
            expect(d.scoutFlavor).toEqual({ nat1: ["A clearing."] });
        });

        it("returns null for scoutGuidance/scoutFlavor when absent", () => {
            injectTerrains([DUNGEON]);
            const d = TerrainRegistry.getDefaults("dungeon");
            expect(d.scoutGuidance).toBeNull();
            expect(d.scoutFlavor).toBeNull();
        });
    });

    // ── getOptionGroups ─────────────────────────────────────────

    describe("getOptionGroups", () => {
        it("groups terrains by category", () => {
            injectTerrains([FOREST, TAVERN, DUNGEON, SWAMP]);
            const groups = TerrainRegistry.getOptionGroups();
            expect(groups).toHaveLength(3);

            const dungeonGroup = groups.find(g => g.group === "Dungeon");
            const safeGroup = groups.find(g => g.group === "Safe Haven");
            const wildGroup = groups.find(g => g.group === "Wilderness");

            expect(dungeonGroup.options).toHaveLength(1);
            expect(dungeonGroup.options[0].value).toBe("dungeon");

            expect(safeGroup.options).toHaveLength(1);
            expect(safeGroup.options[0].value).toBe("tavern");

            expect(wildGroup.options).toHaveLength(2);
            const wildIds = wildGroup.options.map(o => o.value);
            expect(wildIds).toContain("forest");
            expect(wildIds).toContain("swamp");
        });

        it("omits empty groups", () => {
            injectTerrains([FOREST, SWAMP]);
            const groups = TerrainRegistry.getOptionGroups();
            expect(groups).toHaveLength(1);
            expect(groups[0].group).toBe("Wilderness");
        });

        it("appends '(last used)' to the last terrain", () => {
            injectTerrains([FOREST, TAVERN]);
            const groups = TerrainRegistry.getOptionGroups({ lastTerrain: "forest" });
            const wildGroup = groups.find(g => g.group === "Wilderness");
            expect(wildGroup.options[0].label).toContain("(last used)");
        });

        it("sorts options alphabetically by label within each group", () => {
            const aaa = { id: "aaa", label: "AAA Plains", category: "wilderness", comfort: "rough" };
            const zzz = { id: "zzz", label: "ZZZ Peaks", category: "wilderness", comfort: "rough" };
            injectTerrains([zzz, aaa]);
            const groups = TerrainRegistry.getOptionGroups();
            const labels = groups[0].options.map(o => o.label);
            expect(labels[0]).toBe("AAA Plains");
            expect(labels[1]).toBe("ZZZ Peaks");
        });
    });

    // ── getWeather ──────────────────────────────────────────────

    describe("getWeather", () => {
        it("returns weather array for known terrain", () => {
            injectTerrains([FOREST]);
            expect(TerrainRegistry.getWeather("forest")).toEqual(["clear", "rain"]);
        });

        it("falls back to ['clear'] for unknown terrain", () => {
            injectTerrains([]);
            expect(TerrainRegistry.getWeather("unknown")).toEqual(["clear"]);
        });
    });

    // ── getEventsPath ───────────────────────────────────────────

    describe("getEventsPath", () => {
        it("returns fully-qualified path for terrain with eventsFile", () => {
            injectTerrains([FOREST]);
            expect(TerrainRegistry.getEventsPath("forest")).toBe(
                "modules/ionrift-respite/data/core/events/forest_events.json"
            );
        });

        it("returns null for terrain without eventsFile", () => {
            const noEvents = { id: "bare", label: "Bare" };
            injectTerrains([noEvents]);
            expect(TerrainRegistry.getEventsPath("bare")).toBeNull();
        });

        it("returns null for unknown terrain id", () => {
            injectTerrains([]);
            expect(TerrainRegistry.getEventsPath("nope")).toBeNull();
        });
    });

    // ── getAvailableIds ─────────────────────────────────────────

    describe("getAvailableIds", () => {
        it("returns Set of terrain ids", () => {
            injectTerrains([FOREST, TAVERN]);
            const ids = TerrainRegistry.getAvailableIds();
            expect(ids).toBeInstanceOf(Set);
            expect(ids.has("forest")).toBe(true);
            expect(ids.has("tavern")).toBe(true);
            expect(ids.size).toBe(2);
        });
    });

    // ── reset / isReady lifecycle ───────────────────────────────

    describe("reset / isReady", () => {
        it("starts not ready after reset", () => {
            expect(TerrainRegistry.isReady).toBe(false);
        });

        it("is ready after injection", () => {
            injectTerrains([FOREST]);
            expect(TerrainRegistry.isReady).toBe(true);
        });

        it("clears all terrains on reset", () => {
            injectTerrains([FOREST, TAVERN]);
            expect(TerrainRegistry.getAll()).toHaveLength(2);
            TerrainRegistry.reset();
            expect(TerrainRegistry.getAll()).toHaveLength(0);
            expect(TerrainRegistry.isReady).toBe(false);
        });
    });

    // ── get / getAll ────────────────────────────────────────────

    describe("get / getAll", () => {
        it("get returns exact terrain object", () => {
            injectTerrains([FOREST]);
            expect(TerrainRegistry.get("forest")).toBe(FOREST);
        });

        it("get returns undefined for missing id", () => {
            injectTerrains([FOREST]);
            expect(TerrainRegistry.get("nope")).toBeUndefined();
        });

        it("getAll returns terrains sorted by label", () => {
            injectTerrains([SWAMP, DUNGEON, FOREST]);
            const labels = TerrainRegistry.getAll().map(t => t.label);
            expect(labels).toEqual(["Dungeon", "Forest", "Swamp"]);
        });

        it("getAll falls back to id when label is missing", () => {
            const noLabel = { id: "zzz-test" };
            injectTerrains([FOREST, noLabel]);
            const labels = TerrainRegistry.getAll().map(t => t.label ?? t.id);
            expect(labels[0]).toBe("Forest");
            expect(labels[1]).toBe("zzz-test");
        });
    });
});
