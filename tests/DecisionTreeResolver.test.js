/**
 * DecisionTreeResolver — Headless Unit Tests
 *
 * Covers all pure (zero-Foundry) methods:
 *   - isDecisionTree        : property check
 *   - createTreeState       : state builder
 *   - prepareChoice         : option lookup + data extraction
 *   - computeGroupResult    : group average / pass-fail math
 *   - resolveWithResults    : synchronous state machine (success + failure branches)
 *   - _resolveOutcome       : outcome finalisation
 *
 * NOT covered here (require Foundry runtime):
 *   - resolveChoice         : calls _rollGroupCheck (Roll + ChatMessage)
 *   - _rollGroupCheck       : Roll + ChatMessage + game.actors
 */

import { describe, it, expect } from "vitest";
import { DecisionTreeResolver } from "../scripts/services/DecisionTreeResolver.js";

// ── Fixture Factories ──────────────────────────────────────────────────────

function makeEvent(overrides = {}) {
    return {
        id:          "evt_test",
        name:        "Test Cave-In",
        description: "The cave rumbles ominously.",
        gmGuidance:  "Roll perception.",
        mechanical: {
            type:      "decision_tree",
            prompt:    "What do the heroes do?",
            maxDepth:  2,
            stallPenalty: { narrative: "Time runs out." },
            options: [
                {
                    id: "opt_run",
                    label: "Run",
                    check: { skills: ["athletics", "acrobatics"], dc: 12 },
                    onSuccess: { narrative: "You escape safely.", effects: [] },
                    onFailure: {
                        narrative: "You are caught by falling debris.",
                        effects:   [{ type: "damage", formula: "2d6" }]
                    }
                },
                {
                    id: "opt_brace",
                    label: "Brace",
                    check: { skills: ["athletics"], dc: 15 },
                    onSuccess: { narrative: "You hold firm.", effects: [] },
                    onFailure: {
                        narrative: "You are knocked prone.",
                        options:   [{ id: "opt_recover", label: "Recover", check: { skills: ["athletics"], dc: 10 }, onSuccess: { narrative: "You recover." }, onFailure: { narrative: "You stay down." } }],
                        prompt:    "Now what?"
                    }
                }
            ]
        },
        ...overrides
    };
}

function makeTreeState(overrides = {}) {
    const event = makeEvent();
    return {
        ...DecisionTreeResolver.createTreeState(event, ["actor1", "actor2"]),
        ...overrides
    };
}

// ── isDecisionTree ─────────────────────────────────────────────────────────

describe("DecisionTreeResolver.isDecisionTree", () => {
    it("returns true for decision_tree type", () => {
        expect(DecisionTreeResolver.isDecisionTree(makeEvent())).toBe(true);
    });

    it("returns false for other mechanical types", () => {
        const event = makeEvent();
        event.mechanical.type = "group_check";
        expect(DecisionTreeResolver.isDecisionTree(event)).toBe(false);
    });

    it("returns false when mechanical is absent", () => {
        expect(DecisionTreeResolver.isDecisionTree({ id: "x" })).toBe(false);
    });
});

// ── createTreeState ────────────────────────────────────────────────────────

describe("DecisionTreeResolver.createTreeState", () => {
    it("builds a state object with correct shape", () => {
        const event = makeEvent();
        const state = DecisionTreeResolver.createTreeState(event, ["a1", "a2"]);

        expect(state.eventId).toBe("evt_test");
        expect(state.eventName).toBe("Test Cave-In");
        expect(state.depth).toBe(0);
        expect(state.maxDepth).toBe(2);
        expect(state.resolved).toBe(false);
        expect(state.history).toEqual([]);
        expect(state.targetIds).toEqual(["a1", "a2"]);
    });

    it("picks up stallPenalty from mechanical", () => {
        const state = DecisionTreeResolver.createTreeState(makeEvent(), []);
        expect(state.hasStallPenalty).toBe(true);
        expect(state.stallPenalty).toMatchObject({ narrative: "Time runs out." });
    });

    it("sets hasStallPenalty false when absent", () => {
        const event = makeEvent();
        delete event.mechanical.stallPenalty;
        const state = DecisionTreeResolver.createTreeState(event, []);
        expect(state.hasStallPenalty).toBe(false);
        expect(state.stallPenalty).toBeNull();
    });

    it("defaults maxDepth to 2 when not specified", () => {
        const event = makeEvent();
        delete event.mechanical.maxDepth;
        const state = DecisionTreeResolver.createTreeState(event, []);
        expect(state.maxDepth).toBe(2);
    });
});

// ── prepareChoice ──────────────────────────────────────────────────────────

describe("DecisionTreeResolver.prepareChoice", () => {
    it("returns the option, check, and dc for a valid choice", () => {
        const state = makeTreeState();
        const result = DecisionTreeResolver.prepareChoice(state, "opt_run");

        expect(result).not.toBeNull();
        expect(result.choiceId).toBe("opt_run");
        expect(result.choiceLabel).toBe("Run");
        expect(result.dc).toBe(12);
        expect(result.skills).toEqual(["athletics", "acrobatics"]);
        expect(result.targetIds).toEqual(["actor1", "actor2"]);
    });

    it("returns null for an unknown choice id", () => {
        const state = makeTreeState();
        const result = DecisionTreeResolver.prepareChoice(state, "opt_nonexistent");
        expect(result).toBeNull();
    });

    it("defaults dc to 12 when check.dc is absent", () => {
        const state = makeTreeState();
        // Mutate the option to remove dc
        state.options[0].check = { skills: ["athletics"] };
        const result = DecisionTreeResolver.prepareChoice(state, "opt_run");
        expect(result.dc).toBe(12);
    });
});

// ── computeGroupResult ─────────────────────────────────────────────────────

describe("DecisionTreeResolver.computeGroupResult", () => {
    it("succeeds when rounded average meets dc", () => {
        const rolls = [
            { total: 14, passed: true },
            { total: 12, passed: true }
        ];
        const result = DecisionTreeResolver.computeGroupResult(rolls, 12);
        expect(result.success).toBe(true);
        expect(result.groupAverage).toBe(13);
        expect(result.passCount).toBe(2);
        expect(result.failCount).toBe(0);
    });

    it("fails when rounded average is below dc", () => {
        const rolls = [
            { total: 8,  passed: false },
            { total: 9,  passed: false }
        ];
        const result = DecisionTreeResolver.computeGroupResult(rolls, 12);
        expect(result.success).toBe(false);
        expect(result.passCount).toBe(0);
        expect(result.failCount).toBe(2);
    });

    it("handles an empty rolls array gracefully", () => {
        const result = DecisionTreeResolver.computeGroupResult([], 12);
        expect(result.success).toBe(false);
        expect(result.groupAverage).toBe(0);
        expect(result.passCount).toBe(0);
    });

    it("rounds the average before comparing to dc", () => {
        // Avg = (11 + 12) / 2 = 11.5 → rounds to 12 → success at DC 12
        const rolls = [{ total: 11, passed: false }, { total: 12, passed: true }];
        const result = DecisionTreeResolver.computeGroupResult(rolls, 12);
        expect(result.success).toBe(true);
        expect(result.groupAverage).toBe(12);
    });

    it("mixes pass and fail counts correctly", () => {
        const rolls = [
            { total: 14, passed: true },
            { total: 6,  passed: false },
            { total: 18, passed: true }
        ];
        const result = DecisionTreeResolver.computeGroupResult(rolls, 10);
        expect(result.passCount).toBe(2);
        expect(result.failCount).toBe(1);
    });
});

// ── resolveWithResults ─────────────────────────────────────────────────────

describe("DecisionTreeResolver.resolveWithResults", () => {
    it("resolves to success outcome on checkResult.success === true", () => {
        const state = makeTreeState();
        const checkResult = { success: true, rolls: [], passCount: 2, failCount: 0, groupAverage: 14 };

        const next = DecisionTreeResolver.resolveWithResults(state, "opt_run", checkResult);

        expect(next.resolved).toBe(true);
        expect(next.finalNarrative).toBe("You escape safely.");
        expect(next.finalEffects).toEqual([]);
    });

    it("resolves to failure outcome when no sub-options on failure", () => {
        const state = makeTreeState();
        const checkResult = { success: false, rolls: [], passCount: 0, failCount: 2, groupAverage: 8 };

        const next = DecisionTreeResolver.resolveWithResults(state, "opt_run", checkResult);

        expect(next.resolved).toBe(true);
        expect(next.finalNarrative).toBe("You are caught by falling debris.");
        expect(next.finalEffects).toEqual([{ type: "damage", formula: "2d6" }]);
    });

    it("branches deeper when failure has sub-options and depth < maxDepth", () => {
        const state = makeTreeState();
        const checkResult = { success: false, rolls: [], passCount: 0, failCount: 2, groupAverage: 5 };

        // opt_brace failure has sub-options → should branch
        const next = DecisionTreeResolver.resolveWithResults(state, "opt_brace", checkResult);

        expect(next.resolved).toBe(false);
        expect(next.depth).toBe(1);
        expect(next.options).toBeDefined();
        expect(next.options[0].id).toBe("opt_recover");
    });

    it("appends the resolved choice to history", () => {
        const state = makeTreeState();
        const checkResult = { success: true, rolls: [], passCount: 1, failCount: 0, groupAverage: 15 };

        const next = DecisionTreeResolver.resolveWithResults(state, "opt_run", checkResult);

        expect(next.history).toHaveLength(1);
        expect(next.history[0].choiceId).toBe("opt_run");
        expect(next.history[0].result.success).toBe(true);
    });

    it("returns the original state unchanged if choiceId is invalid", () => {
        const state = makeTreeState();
        const checkResult = { success: true, rolls: [] };
        const next = DecisionTreeResolver.resolveWithResults(state, "opt_unknown", checkResult);
        expect(next).toBe(state);
    });

    it("clears awaitingRolls and pendingChoice after resolution", () => {
        const state = makeTreeState({ awaitingRolls: true, pendingChoice: "opt_run" });
        const checkResult = { success: true, rolls: [], passCount: 1, failCount: 0, groupAverage: 15 };

        const next = DecisionTreeResolver.resolveWithResults(state, "opt_run", checkResult);

        expect(next.awaitingRolls).toBe(false);
        expect(next.pendingChoice).toBeNull();
    });
});

// ── _resolveOutcome ────────────────────────────────────────────────────────

describe("DecisionTreeResolver._resolveOutcome", () => {
    it("marks the state resolved with narrative and effects", () => {
        const state = makeTreeState();
        const outcome = { narrative: "All is well.", effects: [{ type: "heal", amount: 5 }] };

        const next = DecisionTreeResolver._resolveOutcome(state, outcome);

        expect(next.resolved).toBe(true);
        expect(next.finalNarrative).toBe("All is well.");
        expect(next.finalEffects).toEqual([{ type: "heal", amount: 5 }]);
    });

    it("defaults finalEffects to empty array when effects absent", () => {
        const state = makeTreeState();
        const next = DecisionTreeResolver._resolveOutcome(state, { narrative: "Done." });
        expect(next.finalEffects).toEqual([]);
    });
});
