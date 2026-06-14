import { describe, expect, it, vi } from "vitest";
import { applyPlayerTravelDeclarationToGm } from "../../services/travelDeclarationSync.js";

function makeTravelStub(activeDay = 2) {
    return {
        activeDay,
        setDeclaration: vi.fn(),
        setConfirmed: vi.fn()
    };
}

describe("applyPlayerTravelDeclarationToGm", () => {
    it("applies declarations only for owned actors", () => {
        const travel = makeTravelStub(3);
        const actors = new Map([
            ["owned", { ownership: { default: 0, playerA: 3 } }],
            ["notOwned", { ownership: { default: 0, playerB: 3 } }]
        ]);
        const actorLookup = (actorId) => actors.get(actorId) ?? null;

        const result = applyPlayerTravelDeclarationToGm({
            travel,
            actorLookup,
            data: {
                declarations: {
                    owned: "forage",
                    notOwned: "scout",
                    missing: "guard"
                },
                userId: "playerA",
                confirmed: true
            }
        });

        expect(travel.setDeclaration).toHaveBeenCalledTimes(1);
        expect(travel.setDeclaration).toHaveBeenCalledWith("owned", "forage", 3);
        expect(travel.setConfirmed).toHaveBeenCalledTimes(1);
        expect(travel.setConfirmed).toHaveBeenCalledWith("owned", 3, true);

        expect(result.applied).toEqual([{ activity: "forage", day: 3, confirmed: true }]);
        expect(result.rejected).toEqual([
            { actorId: "notOwned", reason: "not-owner" },
            { actorId: "missing", reason: "actor-missing" }
        ]);
    });

    it("honors explicit day and does not set confirmed when omitted", () => {
        const travel = makeTravelStub(1);
        const actorLookup = () => ({ ownership: { default: 0, user123: 3 } });

        const result = applyPlayerTravelDeclarationToGm({
            travel,
            actorLookup,
            data: {
                declarations: { actor1: "hunt" },
                day: 5,
                userId: "user123"
            }
        });

        expect(travel.setDeclaration).toHaveBeenCalledWith("actor1", "hunt", 5);
        expect(travel.setConfirmed).not.toHaveBeenCalled();
        expect(result.applied).toEqual([{ activity: "hunt", day: 5, confirmed: null }]);
    });

    it("returns empty result for missing declaration payload", () => {
        const travel = makeTravelStub();
        const actorLookup = () => null;

        expect(applyPlayerTravelDeclarationToGm({ travel, actorLookup, data: null })).toEqual({
            applied: [],
            rejected: []
        });
        expect(travel.setDeclaration).not.toHaveBeenCalled();
    });
});
