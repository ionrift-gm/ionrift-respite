/**
 * SafeRestForageGate — Forage excluded from non-travel / safe-rest terrains
 *
 * Validates that act_forage is excluded from the activity list when the GM
 * marks a rest as a safe rest spot. Taverns, dungeons, catacombs, and ruins
 * are all environments where foraging makes no narrative sense and should
 * be suppressed by the safe-rest exclusion set.
 *
 * Bug reference: foraging options appeared during a tavern safe rest.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { ActivityResolver, SAFE_REST_SPOT_EXCLUDED_ACTIVITY_IDS } from "../scripts/services/ActivityResolver.js";
import { SAFE_REST_SPOT_EXCLUDED_ACTIVITY_IDS as SAFE_REST_SPOT_EXCLUDED_CONSTANTS } from "../scripts/apps/RestConstants.js";
import { makeActor, resetActorIds } from "./mocks/actors.js";

// ── Helpers ─────────────────────────────────────────────────────────

/** Load the default activities into a fresh resolver. */
async function loadDefaultResolver() {
    const resolver = new ActivityResolver();
    const fs = await import("fs");
    const path = await import("path");
    const filePath = path.resolve(
        import.meta.dirname, "..",
        "data", "activities", "default_activities.json"
    );
    const raw = fs.readFileSync(filePath, "utf-8");
    resolver.load(JSON.parse(raw));
    return resolver;
}

/** A survival-proficient character who would normally qualify for forage. */
function makeForager(name = "Ranger") {
    return makeActor({
        name,
        skills: {
            ath: { total: 6, proficient: 1 },
            ste: { total: 2, proficient: 0 },
            sur: { total: 6, proficient: 1 },
            prc: { total: 3, proficient: 0 },
            med: { total: 4, proficient: 1 }
        }
    });
}

// ── Setup ───────────────────────────────────────────────────────────

let resolver;

beforeEach(async () => {
    resetActorIds();
    resolver = await loadDefaultResolver();
});

// ════════════════════════════════════════════════════════════════════
// Exclusion Set Membership
// ════════════════════════════════════════════════════════════════════

describe("act_forage in SAFE_REST_SPOT_EXCLUDED_ACTIVITY_IDS", () => {

    it("ActivityResolver exclusion set includes act_forage", () => {
        expect(SAFE_REST_SPOT_EXCLUDED_ACTIVITY_IDS.has("act_forage")).toBe(true);
    });

    it("RestConstants exclusion set includes act_forage", () => {
        expect(SAFE_REST_SPOT_EXCLUDED_CONSTANTS.has("act_forage")).toBe(true);
    });
});

// ════════════════════════════════════════════════════════════════════
// Safe Rest Spot: Forage Excluded (getAvailableActivities)
// ════════════════════════════════════════════════════════════════════

describe("Safe rest spot excludes forage (getAvailableActivities)", () => {

    it("forage is available on a normal (non-safe) long rest", () => {
        const actor = makeForager();
        const available = resolver.getAvailableActivities(actor, "long", {
            safeRestSpot: false
        });
        const ids = available.map(a => a.id);
        expect(ids).toContain("act_forage");
    });

    it("forage is excluded when safeRestSpot is true", () => {
        const actor = makeForager();
        const available = resolver.getAvailableActivities(actor, "long", {
            safeRestSpot: true
        });
        const ids = available.map(a => a.id);
        expect(ids).not.toContain("act_forage");
    });

    it("forage is excluded for a tavern safe rest", () => {
        const actor = makeForager();
        const available = resolver.getAvailableActivities(actor, "long", {
            safeRestSpot: true,
            terrainTag: "tavern"
        });
        const ids = available.map(a => a.id);
        expect(ids).not.toContain("act_forage");
    });

    it("forage is excluded for a dungeon safe rest", () => {
        const actor = makeForager();
        const available = resolver.getAvailableActivities(actor, "long", {
            safeRestSpot: true,
            terrainTag: "dungeon"
        });
        const ids = available.map(a => a.id);
        expect(ids).not.toContain("act_forage");
    });

    it("forage is excluded for a catacombs safe rest", () => {
        const actor = makeForager();
        const available = resolver.getAvailableActivities(actor, "long", {
            safeRestSpot: true,
            terrainTag: "catacombs"
        });
        const ids = available.map(a => a.id);
        expect(ids).not.toContain("act_forage");
    });

    it("forage is excluded for a ruins safe rest", () => {
        const actor = makeForager();
        const available = resolver.getAvailableActivities(actor, "long", {
            safeRestSpot: true,
            terrainTag: "ruins"
        });
        const ids = available.map(a => a.id);
        expect(ids).not.toContain("act_forage");
    });
});

// ════════════════════════════════════════════════════════════════════
// Safe Rest Spot: Forage Excluded (getAvailableActivitiesWithFaded)
// ════════════════════════════════════════════════════════════════════

describe("Safe rest spot excludes forage (getAvailableActivitiesWithFaded)", () => {

    it("forage appears in available or faded list on a normal rest (not excluded by safe gate)", () => {
        const actor = makeForager();
        const { available, faded } = resolver.getAvailableActivitiesWithFaded(actor, "long", {
            isFireLit: true,
            fireLevel: "campfire",
            safeRestSpot: false
        });
        // Forage may land in faded due to pool gate (no content pack in test env)
        // but it must NOT be excluded entirely — that would mean the safe-rest gate fired
        const allIds = [...available, ...faded].map(a => a.id);
        expect(allIds).toContain("act_forage");
    });

    it("forage is absent from both available and faded on a safe rest", () => {
        const actor = makeForager();
        const { available, faded } = resolver.getAvailableActivitiesWithFaded(actor, "long", {
            isFireLit: true,
            fireLevel: "campfire",
            safeRestSpot: true
        });
        const availIds = available.map(a => a.id);
        const fadedIds = faded.map(a => a.id);
        expect(availIds).not.toContain("act_forage");
        expect(fadedIds).not.toContain("act_forage");
    });

    it("forage absent from faded list for tavern safe rest", () => {
        const actor = makeForager();
        const { available, faded } = resolver.getAvailableActivitiesWithFaded(actor, "long", {
            isFireLit: true,
            fireLevel: "campfire",
            safeRestSpot: true,
            terrainTag: "tavern"
        });
        const allIds = [...available, ...faded].map(a => a.id);
        expect(allIds).not.toContain("act_forage");
    });
});
