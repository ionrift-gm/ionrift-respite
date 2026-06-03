import { describe, it, expect, beforeEach, vi } from "vitest";

let DecisionTreeResolver;

beforeEach(async () => {
    globalThis.game = {
        system: { id: "dnd5e" },
        settings: { get: () => "" },
        modules: { get: () => null },
        actors: { get: () => null },
        users: [],
        user: { isGM: true }
    };

    vi.resetModules();
    const mod = await import("../scripts/services/DecisionTreeResolver.js");
    DecisionTreeResolver = mod.DecisionTreeResolver;
});

function makeEvent(overrides = {}) {
    return {
        id: "evt-1",
        name: "River Crossing",
        description: "A swollen river blocks the path.",
        gmPrompt: "The party reaches a flooded river.",
        checkContext: null,
        gmGuidance: "",
        mechanical: {
            type: "decision_tree",
            prompt: "How do you cross?",
            maxDepth: 2,
            stallPenalty: null,
            options: [
                {
                    id: "swim",
                    label: "Swim across",
                    check: { dc: 14, skills: ["ath", "str"] },
                    onSuccess: { narrative: "You swim across safely.", effects: [{ type: "none" }] },
                    onFailure: { narrative: "You are swept downstream.", effects: [{ type: "damage", value: 5 }] }
                },
                {
                    id: "bridge",
                    label: "Build a bridge",
                    check: { dc: 12, skills: ["sur", "nat"] },
                    onSuccess: { narrative: "A sturdy bridge is built.", effects: [] },
                    onFailure: {
                        narrative: "The bridge collapses.",
                        prompt: "The bridge collapsed! What now?",
                        options: [
                            {
                                id: "swim-b",
                                label: "Swim the wreckage",
                                check: { dc: 10, skills: ["ath"] },
                                onSuccess: { narrative: "Made it across on debris.", effects: [] },
                                onFailure: { narrative: "Battered by debris.", effects: [{ type: "damage", value: 3 }] }
                            }
                        ]
                    }
                }
            ],
            ...overrides.mechanical
        },
        ...overrides
    };
}

describe("DecisionTreeResolver", () => {

    // ── isDecisionTree ──────────────────────────────────────────

    describe("isDecisionTree", () => {
        it("returns true for decision_tree type", () => {
            expect(DecisionTreeResolver.isDecisionTree({ mechanical: { type: "decision_tree" } })).toBe(true);
        });

        it("returns false for other types", () => {
            expect(DecisionTreeResolver.isDecisionTree({ mechanical: { type: "simple" } })).toBe(false);
        });

        it("returns false when mechanical is missing", () => {
            expect(DecisionTreeResolver.isDecisionTree({})).toBe(false);
        });
    });

    // ── computeNarrationFields ──────────────────────────────────

    describe("computeNarrationFields", () => {
        it("uses gmPrompt as readAloud at depth 0 when both exist", () => {
            const result = DecisionTreeResolver.computeNarrationFields(
                { gmPrompt: "GM scene", description: "desc" },
                { prompt: "Player question" },
                0
            );
            expect(result.readAloud).toBe("GM scene");
            expect(result.showDecisionPrompt).toBe(true);
        });

        it("sets showDecisionPrompt false when gmPrompt equals prompt", () => {
            const result = DecisionTreeResolver.computeNarrationFields(
                { gmPrompt: "Same text" },
                { prompt: "Same text" },
                0
            );
            expect(result.showDecisionPrompt).toBe(false);
        });

        it("falls back to prompt when gmPrompt is empty", () => {
            const result = DecisionTreeResolver.computeNarrationFields(
                { gmPrompt: "" },
                { prompt: "Fallback prompt" },
                0
            );
            expect(result.readAloud).toBe("Fallback prompt");
            expect(result.showDecisionPrompt).toBe(false);
        });

        it("falls back to description when both prompts are empty", () => {
            const result = DecisionTreeResolver.computeNarrationFields(
                { gmPrompt: "", description: "Scene desc" },
                { prompt: "" },
                0
            );
            expect(result.readAloud).toBe("Scene desc");
        });

        it("uses branch prompt at depth > 0", () => {
            const result = DecisionTreeResolver.computeNarrationFields(
                { gmPrompt: "GM text" },
                { prompt: "Branch prompt" },
                1
            );
            expect(result.readAloud).toBe("Branch prompt");
            expect(result.showDecisionPrompt).toBe(false);
        });

        it("falls back to tree description at depth > 0 when prompt is empty", () => {
            const result = DecisionTreeResolver.computeNarrationFields(
                { gmPrompt: "GM" },
                { prompt: "", description: "Branch desc" },
                2
            );
            expect(result.readAloud).toBe("Branch desc");
        });
    });

    // ── createTreeState ─────────────────────────────────────────

    describe("createTreeState", () => {
        it("initializes tree state with correct defaults", () => {
            const event = makeEvent();
            const state = DecisionTreeResolver.createTreeState(event, ["actor-1", "actor-2"]);

            expect(state.eventId).toBe("evt-1");
            expect(state.depth).toBe(0);
            expect(state.maxDepth).toBe(2);
            expect(state.resolved).toBe(false);
            expect(state.history).toEqual([]);
            expect(state.targetIds).toEqual(["actor-1", "actor-2"]);
            expect(state.options).toHaveLength(2);
            expect(state.awaitingRolls).toBe(false);
        });
    });

    // ── prepareChoice ───────────────────────────────────────────

    describe("prepareChoice", () => {
        it("returns check params for a valid choice", () => {
            const event = makeEvent();
            const state = DecisionTreeResolver.createTreeState(event, ["a1"]);
            const prep = DecisionTreeResolver.prepareChoice(state, "swim");

            expect(prep).not.toBeNull();
            expect(prep.dc).toBe(14);
            expect(prep.skills).toEqual(["ath", "str"]);
            expect(prep.choiceId).toBe("swim");
            expect(prep.choiceLabel).toBe("Swim across");
        });

        it("returns null for unknown choiceId", () => {
            const event = makeEvent();
            const state = DecisionTreeResolver.createTreeState(event, ["a1"]);
            expect(DecisionTreeResolver.prepareChoice(state, "fly")).toBeNull();
        });

        it("defaults dc to 12 when check.dc is missing", () => {
            const event = makeEvent();
            event.mechanical.options[0].check = { skills: ["ath"] };
            const state = DecisionTreeResolver.createTreeState(event, ["a1"]);
            const prep = DecisionTreeResolver.prepareChoice(state, "swim");
            expect(prep.dc).toBe(12);
        });
    });

    // ── computeGroupResult ──────────────────────────────────────

    describe("computeGroupResult", () => {
        it("succeeds when average >= DC", () => {
            const rolls = [
                { actorId: "a1", total: 15, passed: true },
                { actorId: "a2", total: 9, passed: false }
            ];
            const result = DecisionTreeResolver.computeGroupResult(rolls, 12);
            expect(result.success).toBe(true);
            expect(result.groupAverage).toBe(12); // Math.round(12) >= 12
            expect(result.passCount).toBe(1);
            expect(result.failCount).toBe(1);
        });

        it("fails when average < DC", () => {
            const rolls = [
                { actorId: "a1", total: 8, passed: false },
                { actorId: "a2", total: 10, passed: false }
            ];
            const result = DecisionTreeResolver.computeGroupResult(rolls, 10);
            expect(result.success).toBe(false);
            expect(result.groupAverage).toBe(9);
        });

        it("returns success false with average 0 for empty rolls", () => {
            const result = DecisionTreeResolver.computeGroupResult([], 10);
            expect(result.success).toBe(false);
            expect(result.groupAverage).toBe(0);
        });

        it("rounds average before comparing to DC", () => {
            const rolls = [
                { actorId: "a1", total: 12, passed: true },
                { actorId: "a2", total: 11, passed: false },
                { actorId: "a3", total: 12, passed: true }
            ];
            // avg = 35/3 = 11.667, rounds to 12
            const result = DecisionTreeResolver.computeGroupResult(rolls, 12);
            expect(result.success).toBe(true);
            expect(result.groupAverage).toBe(12);
        });
    });

    // ── resolveWithResults ──────────────────────────────────────

    describe("resolveWithResults", () => {
        it("resolves with success outcome on successful check", () => {
            const event = makeEvent();
            const state = DecisionTreeResolver.createTreeState(event, ["a1"]);
            const checkResult = { success: true, rolls: [], passCount: 1, failCount: 0, groupAverage: 15 };

            const resolved = DecisionTreeResolver.resolveWithResults(state, "swim", checkResult);
            expect(resolved.resolved).toBe(true);
            expect(resolved.finalNarrative).toBe("You swim across safely.");
            expect(resolved.finalEffects).toHaveLength(1);
            expect(resolved.history).toHaveLength(1);
            expect(resolved.history[0].choiceId).toBe("swim");
        });

        it("resolves with failure outcome when no sub-options", () => {
            const event = makeEvent();
            const state = DecisionTreeResolver.createTreeState(event, ["a1"]);
            const checkResult = { success: false, rolls: [], passCount: 0, failCount: 1, groupAverage: 5 };

            const resolved = DecisionTreeResolver.resolveWithResults(state, "swim", checkResult);
            expect(resolved.resolved).toBe(true);
            expect(resolved.finalNarrative).toBe("You are swept downstream.");
        });

        it("branches deeper on failure with sub-options", () => {
            const event = makeEvent();
            const state = DecisionTreeResolver.createTreeState(event, ["a1"]);
            const checkResult = { success: false, rolls: [], passCount: 0, failCount: 1, groupAverage: 5 };

            const branched = DecisionTreeResolver.resolveWithResults(state, "bridge", checkResult);
            expect(branched.resolved).toBe(false);
            expect(branched.depth).toBe(1);
            expect(branched.options).toHaveLength(1);
            expect(branched.options[0].id).toBe("swim-b");
        });

        it("resolves terminal failure at max depth", () => {
            const event = makeEvent();
            let state = DecisionTreeResolver.createTreeState(event, ["a1"]);
            state = { ...state, maxDepth: 0 };
            const checkResult = { success: false, rolls: [], passCount: 0, failCount: 1, groupAverage: 5 };

            const resolved = DecisionTreeResolver.resolveWithResults(state, "bridge", checkResult);
            expect(resolved.resolved).toBe(true);
            expect(resolved.finalNarrative).toBe("The bridge collapses.");
        });

        it("returns unchanged state for unknown choiceId", () => {
            const event = makeEvent();
            const state = DecisionTreeResolver.createTreeState(event, ["a1"]);
            const result = DecisionTreeResolver.resolveWithResults(state, "nonexistent", {
                success: true, rolls: [], passCount: 0, failCount: 0, groupAverage: 0
            });
            expect(result).toBe(state);
        });

        it("clears roll tracking fields on resolution", () => {
            const event = makeEvent();
            let state = DecisionTreeResolver.createTreeState(event, ["a1"]);
            state = { ...state, awaitingRolls: true, pendingChoice: "swim", pendingRolls: [{}] };
            const checkResult = { success: true, rolls: [{ total: 15 }], passCount: 1, failCount: 0, groupAverage: 15 };

            const resolved = DecisionTreeResolver.resolveWithResults(state, "swim", checkResult);
            expect(resolved.awaitingRolls).toBe(false);
            expect(resolved.pendingChoice).toBeNull();
            expect(resolved.pendingRolls).toEqual([]);
            expect(resolved.resolvedRolls).toEqual([{ total: 15 }]);
        });
    });
});
