import { MODULE_ID } from "../../../../data/moduleId.js";
export class RestTrainingDelegate {
    constructor(app) {
        this._app = app;
    }

    async onTrainingRoll(event, target) {
        const app = this._app;

        const characterId = target?.dataset?.characterId;
        if (!characterId) return;

        const state = app._trainingStates?.get(characterId);
        if (!state || state.rolling) return;

        const ctx = state.context ?? {};
        const numRolls = ctx.numRolls ?? 3;
        if ((state.rolls?.length ?? 0) >= numRolls) return;

        const actor = game.actors.get(characterId);
        if (!actor) return;
        if (!actor.isOwner && !game.user.isGM) {
            ui.notifications.warn("Only the character's owner can roll training checks.");
            return;
        }

        const activity = app._activityResolver?.activities?.get(state.activityId)
            ?? app._activities?.find(a => a.id === state.activityId);
        if (!activity) return;

        state.rolling = true;
        app.render();

        const setNumber = state.rolls.length + 1;
        const abilityName = SKILL_DISPLAY_NAMES[ctx.abilityKey] ?? ctx.rollLabel ?? "Ability";

        try {
            let total;
            let passed;

            if (game.user.isGM && !actor.isOwner) {
                const roll = await new Roll(`1d20 + ${ctx.modifier ?? 0}`).evaluate();
                const flavor = `<strong>Training</strong> Set ${setNumber}/${numRolls} (${abilityName}) · DC ${ctx.adjustedDc} [GM roll]`;
                await postRollToChat(actor, roll, flavor);
                await waitForDiceSoNice();
                total = roll.total;
                passed = total >= ctx.adjustedDc;
            } else {
                const flavor = `<strong>Training</strong> Set ${setNumber}/${numRolls} (${abilityName}) · DC ${ctx.adjustedDc}`;
                const result = await executeAbilityRoll(
                    actor,
                    ctx.abilityKey ?? "str",
                    ctx.modifier ?? 0,
                    ctx.adjustedDc ?? 13,
                    flavor,
                    target
                );
                total = result.total;
                passed = result.passed;
            }

            state.rolls.push({ set: setNumber, total, passed });
            state.rolling = false;

            if (state.rolls.length >= numRolls) {
                const outcome = await app._activityResolver.finalizeTraining(
                    activity,
                    state.activityId,
                    actor,
                    state.rolls,
                    ctx,
                    { whisper: true }
                );
                app._earlyResults.set(characterId, outcome);
                app._trainingStates.delete(characterId);
                app._totmFollowUpExpanded = null;

                const award = outcome.training?.awardedXP ?? 0;
                ui.notifications.info(`${actor.name}: Training complete · +${award} XP`);

                if (!game.user.isGM) {
                    emitTrainingComplete(characterId, outcome);
                    emitActivityChoice(
                        game.user.id,
                        Object.fromEntries(app._characterChoices),
                        null,
                        null,
                        Object.fromEntries(app._earlyResults)
                    );
                } else {
                    app._saveRestState();
                }
            } else if (!game.user.isGM) {
                emitTrainingStateUpdate(characterId, state);
            } else {
                app._saveRestState();
            }
        } catch (err) {
            console.warn(`${MODULE_ID} | Training roll failed:`, err);
            ui.notifications.error("Training roll failed. Try again.");
        } finally {
            state.rolling = false;
            app.render();
            if (app._phase === "activity" && isStationLayerActive()) {
                refreshStationPortraitsFromChoices(app._characterChoices, app._stationCanvasIdByCharacter);
            }
        }
    
    }

    _buildTrainingViewContext(characterId) {
        const app = this._app;

        const ts = app._trainingStates?.get(characterId);
        if (!ts) return null;

        // rolling is transient UI state; a mid-roll save must not block the next set.
        if (ts.rolling) ts.rolling = false;

        const ctx = ts.context ?? {};
        const numRolls = ctx.numRolls ?? 3;
        const rolled = ts.rolls?.length ?? 0;
        const actor = game.actors.get(characterId);

        const segments = [];
        for (let i = 0; i < numRolls; i++) {
            const r = ts.rolls[i];
            let state = "pending";
            if (r) state = r.passed ? "pass" : "fail";
            else if (i === rolled) state = "current";
            segments.push({ state });
        }

        const xpReduction = ctx.xpReduction ?? 0;
        let diminishHint = null;
        if (xpReduction > 0) {
            diminishHint = `Streak ${ctx.streak ?? 0}: up to ${xpReduction} XP held back this rest.`;
        }

        const canRoll = !!actor
            && rolled < numRolls
            && !ts.rolling
            && (actor.isOwner || game.user.isGM);

        return {
            characterId,
            actorName: actor?.name ?? "",
            rollLabel: ctx.rollLabel ?? "",
            dc: ctx.adjustedDc ?? 13,
            numRolls,
            rolls: ts.rolls ?? [],
            segments,
            nextRollNumber: rolled + 1,
            canRoll,
            rolling: !!ts.rolling,
            diminishHint
        };
    
    }

    _syncIncompleteTrainingView() {
        const app = this._app;

        if (app._phase !== "activity" || !app._isTotM) return;

        const characterId = app._findIncompleteTrainingCharacterId();
        if (!characterId) return;

        app._selectedCharacterId = characterId;
        app._totmFollowUpExpanded = { activityId: "act_train", characterId, trainingActive: true };

        if (!app._trainingStates?.has(characterId)) {
            const actor = game.actors.get(characterId);
            if (actor) app._initTrainingState(characterId, "act_train", actor);
        }

        app._clearStaleTrainingRollingFlags();
    
    }

}
