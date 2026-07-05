import { beforeEach, describe, expect, it, vi } from "vitest";

let mockedPartyActors = [];
vi.mock("../../services/partyActors.js", () => ({
    getPartyActors: () => mockedPartyActors
}));

import {
    clearDeprivationExhaustionFloors,
    clearMealExhaustionFloors,
    mealExhaustionFloorFor,
    mergeMealExhaustionFloors,
    reassertMealExhaustionFloor,
    setMealExhaustionFloors,
    stampDeprivationExhaustionFloor
} from "../../services/MealExhaustionGuard.js";

function makeActor({ id, exhaustion = 0, floorFlag = null }) {
    let flag = floorFlag;
    const actor = {
        id,
        system: {
            attributes: {
                exhaustion
            }
        },
        getFlag: vi.fn(() => flag),
        setFlag: vi.fn(async (_moduleId, _key, value) => {
            flag = value;
        }),
        unsetFlag: vi.fn(async () => {
            flag = null;
        }),
        update: vi.fn(async (payload) => {
            const updated = payload?.["system.attributes.exhaustion"];
            if (typeof updated === "number") {
                actor.system.attributes.exhaustion = updated;
                return;
            }
        })
    };
    return actor;
}

describe("MealExhaustionGuard", () => {
    beforeEach(() => {
        globalThis.game = {
            actors: new Map(),
            ionrift: {
                respite: {},
                library: {}
            }
        };
        mockedPartyActors = [];
        clearMealExhaustionFloors();
    });

    it("merges meal-applied, current, and persisted floor exhaustion levels", () => {
        const actorA = makeActor({ id: "a", exhaustion: 1, floorFlag: 3 });
        const actorB = makeActor({ id: "b", exhaustion: 0, floorFlag: 2 });
        game.actors.set("a", actorA);
        game.actors.set("b", actorB);
        mockedPartyActors = [actorA, actorB];

        const floors = mergeMealExhaustionFloors([
            { characterId: "a", mealExhaustionApplied: 2 }
        ]);

        expect(floors.get("a")).toBe(3);
        expect(floors.get("b")).toBe(2);
        expect(mealExhaustionFloorFor(actorA)).toBe(3);
        expect(mealExhaustionFloorFor(actorB)).toBe(2);
    });

    it("stamps deprivation floor to actor flags and preserves the maximum in-memory floor", async () => {
        const actor = makeActor({ id: "a", exhaustion: 2, floorFlag: null });
        setMealExhaustionFloors(new Map([["a", 4]]));

        await stampDeprivationExhaustionFloor(actor);

        expect(actor.setFlag).toHaveBeenCalledWith("ionrift-respite", "deprivationExhaustionFloor", 2);
        expect(mealExhaustionFloorFor(actor)).toBe(4);
    });

    it("reasserts missing exhaustion with adapter deltas when below floor", async () => {
        const actor = makeActor({ id: "a", exhaustion: 1, floorFlag: 2 });
        const applyExhaustionDelta = vi.fn(async () => {});
        game.ionrift.respite.adapter = {
            getExhaustion: (target) => target.system.attributes.exhaustion,
            applyExhaustionDelta
        };
        setMealExhaustionFloors(new Map([["a", 4]]));

        await expect(reassertMealExhaustionFloor(actor)).resolves.toBe(true);
        expect(applyExhaustionDelta).toHaveBeenCalledWith(actor, 3);
    });

    it("falls back to direct actor updates when adapter is unavailable", async () => {
        const actor = makeActor({ id: "a", exhaustion: 1, floorFlag: 3 });
        game.ionrift.respite.adapter = null;

        await expect(reassertMealExhaustionFloor(actor)).resolves.toBe(true);
        expect(actor.update).toHaveBeenCalledWith({ "system.attributes.exhaustion": 3 });
    });

    it("clears persisted deprivation floors and in-memory floor cache", async () => {
        const actor = makeActor({ id: "a", exhaustion: 2, floorFlag: 2 });
        setMealExhaustionFloors(new Map([["a", 5]]));

        await clearDeprivationExhaustionFloors([actor]);

        expect(actor.unsetFlag).toHaveBeenCalledWith("ionrift-respite", "deprivationExhaustionFloor");
        expect(mealExhaustionFloorFor(actor)).toBe(0);
    });
});
