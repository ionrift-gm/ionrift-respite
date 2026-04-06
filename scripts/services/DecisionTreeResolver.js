/**
 * DecisionTreeResolver
 * Handles interactive decision tree events during the Events phase.
 *
 * Decision trees present the GM with a prompt and 2+ options.
 * Each option has a group DC check. Success/failure leads to
 * narrative + effects, or branches into a deeper sub-tree.
 *
 * Max depth: 2 (primary choice + secondary choice on failure).
 *
 * This resolver does NOT roll dice. It produces structured states
 * that the UI renders, and the roll results come in from players
 * (or GM fallback) via the socket system.
 */

import { pickBestSkill, getSkillMod } from "./RollRequestManager.js";

const MODULE_ID = "ionrift-respite";

export class DecisionTreeResolver {

    /**
     * Evaluates whether an event is a decision tree type.
     * @param {Object} event - Event from the event data.
     * @returns {boolean}
     */
    static isDecisionTree(event) {
        return event.mechanical?.type === "decision_tree";
    }

    /**
     * Creates the initial tree state for a decision tree event.
     * This is the starting point that the GM UI will render.
     * @param {Object} event - The full event object.
     * @param {string[]} targetIds - Character IDs involved.
     * @returns {Object} Tree state object.
     */
    static createTreeState(event, targetIds) {
        const tree = event.mechanical;
        return {
            eventId: event.id,
            eventName: event.name,
            description: event.description,
            prompt: tree.prompt,
            options: tree.options,
            stallPenalty: tree.stallPenalty ?? null,
            hasStallPenalty: !!tree.stallPenalty,
            stalled: false,
            gmGuidance: event.gmGuidance ?? "",
            targetIds,
            depth: 0,
            maxDepth: tree.maxDepth ?? 2,
            history: [],
            resolved: false,
            finalEffects: [],
            finalNarrative: "",
            // Roll tracking (new)
            awaitingRolls: false,
            pendingChoice: null,
            pendingRolls: [],
            resolvedRolls: []
        };
    }

    /**
     * Phase 1: Prepares a choice for rolling without resolving it.
     * Returns the check parameters so the caller can request player rolls.
     *
     * @param {Object} treeState - Current tree state.
     * @param {string} choiceId - The option.id the GM selected.
     * @returns {{ option: Object, check: Object, targetIds: string[], skills: string[] } | null}
     */
    static prepareChoice(treeState, choiceId) {
        const option = treeState.options.find(o => o.id === choiceId);
        if (!option) {
            console.warn(`${MODULE_ID} | Decision tree: option "${choiceId}" not found.`);
            return null;
        }

        const check = option.check ?? {};
        const skills = check.skills ?? [];

        return {
            option,
            check,
            targetIds: treeState.targetIds,
            skills,
            dc: check.dc ?? 12,
            choiceId,
            choiceLabel: option.label
        };
    }

    /**
     * Phase 2: Resolves a choice using collected roll results.
     * Called after all player rolls are in (or GM used "Roll for them").
     *
     * @param {Object} treeState - Current tree state.
     * @param {string} choiceId - The option.id that was chosen.
     * @param {{ success: boolean, rolls: Object[], passCount: number, failCount: number, groupAverage: number }} checkResult
     * @returns {Object} Updated tree state.
     */
    static resolveWithResults(treeState, choiceId, checkResult) {
        const option = treeState.options.find(o => o.id === choiceId);
        if (!option) return treeState;

        // Clear roll tracking
        const state = {
            ...treeState,
            awaitingRolls: false,
            pendingChoice: null,
            pendingRolls: [],
            resolvedRolls: checkResult.rolls ?? []
        };

        // Record in history
        state.history = [...(treeState.history ?? []), {
            depth: treeState.depth,
            choiceId: option.id,
            choiceLabel: option.label,
            check: option.check,
            result: checkResult
        }];

        if (checkResult.success) {
            return this._resolveOutcome(state, option.onSuccess);
        } else {
            const failure = option.onFailure;
            if (failure.options && treeState.depth < treeState.maxDepth) {
                // Branch deeper
                return {
                    ...state,
                    depth: treeState.depth + 1,
                    prompt: failure.prompt ?? failure.narrative,
                    options: failure.options,
                    description: failure.narrative
                };
            } else {
                return this._resolveOutcome(state, failure);
            }
        }
    }

    /**
     * Legacy: Resolves a choice with immediate GM rolls.
     * Kept for backwards compatibility with Force Pass/Fail overrides.
     *
     * @param {Object} treeState - Current tree state.
     * @param {string} choiceId - The option.id the GM selected.
     * @param {string} [forceOutcome] - "success" or "failure" to skip rolling.
     * @returns {Object} Updated tree state.
     */
    static async resolveChoice(treeState, choiceId, forceOutcome) {
        const option = treeState.options.find(o => o.id === choiceId);
        if (!option) {
            console.warn(`${MODULE_ID} | Decision tree: option "${choiceId}" not found.`);
            return treeState;
        }

        let checkResult;
        if (forceOutcome === "success") {
            checkResult = { success: true, rolls: [], passCount: 0, failCount: 0, groupAverage: 0 };
        } else if (forceOutcome === "failure") {
            checkResult = { success: false, rolls: [], passCount: 0, failCount: 0, groupAverage: 0 };
        } else {
            // Legacy: auto-roll (used only as fallback, not the normal flow)
            checkResult = await this._rollGroupCheck(option.check, treeState.targetIds);
        }

        return this.resolveWithResults(treeState, choiceId, checkResult);
    }

    /**
     * Finalizes the tree with an outcome.
     * @param {Object} treeState
     * @param {Object} outcome - { narrative, effects }
     * @returns {Object} Resolved tree state.
     */
    static _resolveOutcome(treeState, outcome) {
        return {
            ...treeState,
            resolved: true,
            finalNarrative: outcome.narrative,
            finalEffects: outcome.effects ?? []
        };
    }

    /**
     * Computes the group check result from collected rolls.
     * Average rule: group succeeds if average roll >= DC.
     *
     * @param {Object[]} rolls - Array of { actorId, total, passed, ... }
     * @param {number} dc - Difficulty class.
     * @returns {{ success: boolean, rolls: Object[], passCount: number, failCount: number, groupAverage: number }}
     */
    static computeGroupResult(rolls, dc) {
        let passCount = 0;
        let failCount = 0;
        for (const r of rolls) {
            if (r.passed) passCount++;
            else failCount++;
        }
        const avg = rolls.length > 0
            ? rolls.reduce((sum, r) => sum + r.total, 0) / rolls.length
            : 0;
        const success = Math.round(avg) >= dc;
        return { success, rolls, passCount, failCount, groupAverage: Math.round(avg) };
    }

    /**
     * Legacy: Rolls a group DC check for all targets.
     * Kept as internal fallback. Normal flow uses player-driven rolls.
     * @private
     */
    static async _rollGroupCheck(check, targetIds) {
        if (!check || !targetIds.length) {
            return { success: true, rolls: [], passCount: 0, failCount: 0 };
        }

        const dc = check.dc ?? 12;
        const skills = check.skills ?? [];
        const rolls = [];
        let passCount = 0;
        let failCount = 0;

        for (const actorId of targetIds) {
            const actor = game.actors.get(actorId);
            if (!actor) continue;

            const skill = pickBestSkill(actor, skills);
            const mod = getSkillMod(actor, skill);
            const roll = await new Roll(`1d20 + ${mod}`).evaluate();
            const passed = roll.total >= dc;

            if (passed) passCount++;
            else failCount++;

            rolls.push({
                actorId, actorName: actor.name, skill, mod,
                total: roll.total, dc, passed
            });

            await roll.toMessage({
                speaker: ChatMessage.getSpeaker({ actor }),
                flavor: `${skill.toUpperCase()} check (DC ${dc}) -- ${passed ? "Success" : "Failure"}`
            });
        }

        const avg = rolls.length > 0
            ? rolls.reduce((sum, r) => sum + r.total, 0) / rolls.length
            : 0;
        const success = Math.round(avg) >= dc;
        return { success, rolls, passCount, failCount, groupAverage: Math.round(avg) };
    }
}
