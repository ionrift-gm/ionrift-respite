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
 * This resolver does NOT auto-resolve. It produces a structured
 * "tree state" that the GM UI renders, and the GM drives each
 * step by choosing options and rolling checks.
 */

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
            targetIds,
            depth: 0,
            maxDepth: tree.maxDepth ?? 2,
            history: [],
            resolved: false,
            finalEffects: [],
            finalNarrative: ""
        };
    }

    /**
     * Processes a GM's choice: rolls the group DC check and
     * returns the next state (resolved outcome or deeper branch).
     * @param {Object} treeState - Current tree state.
     * @param {string} choiceId - The option.id the GM selected.
     * @returns {Object} Updated tree state.
     */
    static async resolveChoice(treeState, choiceId) {
        const option = treeState.options.find(o => o.id === choiceId);
        if (!option) {
            console.warn(`${MODULE_ID} | Decision tree: option "${choiceId}" not found.`);
            return treeState;
        }

        // Roll group DC check for all targets
        const checkResult = await this._rollGroupCheck(option.check, treeState.targetIds);

        // Record in history
        treeState.history.push({
            depth: treeState.depth,
            choiceId: option.id,
            choiceLabel: option.label,
            check: option.check,
            result: checkResult
        });

        if (checkResult.success) {
            // Success: apply success effects, resolve tree
            return this._resolveOutcome(treeState, option.onSuccess);
        } else {
            // Failure: check for sub-tree or apply failure effects
            const failure = option.onFailure;
            if (failure.options && treeState.depth < treeState.maxDepth) {
                // Branch deeper
                return {
                    ...treeState,
                    depth: treeState.depth + 1,
                    prompt: failure.prompt ?? failure.narrative,
                    options: failure.options,
                    description: failure.narrative
                };
            } else {
                // No further branching: apply failure effects
                return this._resolveOutcome(treeState, failure);
            }
        }
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
     * Rolls a group DC check for all targets.
     * Each target rolls the specified skill/ability check.
     * The overall result is based on the average of all rolls vs DC.
     * @param {Object} check - { type: "group_dc", skills: ["dex","str"], dc: 15 }
     * @param {string[]} targetIds - Actor IDs.
     * @returns {Object} { success, rolls: [{ actorName, total, passed }], passCount, failCount, groupAverage }
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

            // Pick the best skill for this actor from the allowed list
            const skill = this._pickBestSkill(actor, skills);
            const mod = this._getSkillMod(actor, skill);

            // Roll 1d20 + mod
            const roll = await new Roll(`1d20 + ${mod}`).evaluate();
            const passed = roll.total >= dc;

            if (passed) passCount++;
            else failCount++;

            rolls.push({
                actorId,
                actorName: actor.name,
                skill,
                mod,
                total: roll.total,
                dc,
                passed
            });

            // Post individual roll to chat
            await roll.toMessage({
                speaker: ChatMessage.getSpeaker({ actor }),
                flavor: `${skill.toUpperCase()} check (DC ${dc}) -- ${passed ? "Success" : "Failure"}`
            });
        }

        // Average rule: group succeeds if average roll >= DC
        const avg = rolls.length > 0
            ? rolls.reduce((sum, r) => sum + r.total, 0) / rolls.length
            : 0;
        const success = Math.round(avg) >= dc;
        return { success, rolls, passCount, failCount, groupAverage: Math.round(avg) };
    }

    /**
     * Picks the best skill for an actor from a list of options.
     * Uses the actor's modifiers to choose the highest.
     * @param {Actor} actor
     * @param {string[]} skills - Skill abbreviations (e.g. ["dex", "str"])
     * @returns {string} Best skill abbreviation.
     */
    static _pickBestSkill(actor, skills) {
        if (!skills.length) return "dex"; // fallback

        // Check if these are abilities or skills
        let best = skills[0];
        let bestMod = -99;

        for (const s of skills) {
            const mod = this._getSkillMod(actor, s);
            if (mod > bestMod) {
                bestMod = mod;
                best = s;
            }
        }

        return best;
    }

    /**
     * Gets the modifier for a skill or ability on an actor.
     * Handles both dnd5e skill abbreviations and ability abbreviations.
     * @param {Actor} actor
     * @param {string} key - Skill/ability abbreviation.
     * @returns {number}
     */
    static _getSkillMod(actor, key) {
        // Try as a skill first (e.g., "prc", "sur", "ath")
        const skill = actor.system?.skills?.[key];
        if (skill) return skill.total ?? skill.mod ?? 0;

        // Try as an ability (e.g., "dex", "str", "con")
        const ability = actor.system?.abilities?.[key];
        if (ability) return ability.mod ?? 0;

        return 0;
    }
}
