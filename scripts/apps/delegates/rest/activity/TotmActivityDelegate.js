import { MODULE_ID } from "../../../../data/moduleId.js";
import {
    emitSubmissionUpdate,
    emitActivityChoice
} from "../../../../services/socket/SocketController.js";
import {
    gatherAlreadyResolved,
    gatherPendingPatch,
    gatherSelectionBlocked,
    publishCampProgress,
    releaseGatherFromActivity
} from "../../../../services/rest/session/campProgressState.js";
import { GatherYieldService } from "../../../../services/rest/forage/GatherYieldService.js";
import { executePlayerRoll } from "../../../../services/ui/rollRequest/RollRequestManager.js";
import { promptArmorSleepIfNeeded } from "../../../crafting/ActivityDetailBuilder.js";

export class TotmActivityDelegate {
    constructor(app) {
        this._app = app;
    }

    async onConfirmTotmFollowUp(event, target) {
        const app = this._app;

        const expanded = app._totmFollowUpExpanded;
        if (!expanded) return;
        const { activityId, characterId } = expanded;

        if (activityId === "act_forage" || activityId === "act_hunt") {
            app._totmFollowUpExpanded = null;
            await this.selectGatherChoice(characterId, activityId);
            return;
        }

        if (app._craftingInProgress?.has(characterId)) {
            ui.notifications.warn("Crafting is currently in progress for this character.");
            return;
        }

        if (app._lockedCharacters?.has(characterId) || app.hasCompletedCrafting?.(characterId)) {
            ui.notifications.warn("This character has already submitted their activity.");
            app._totmFollowUpExpanded = null;
            app.render();
            return;
        }

        // Read follow-up value from the inline detail view.
        // The container class is .totm-detail-followup (not .totm-followup-panel).
        const detailView = app.element?.querySelector(".totm-detail-view");
        let followUpValue = null;
        if (detailView) {
            const select = detailView.querySelector(".totm-followup-select");
            const radio = detailView.querySelector(".totm-followup-radio:checked");
            if (select) followUpValue = select.value || null;
            else if (radio) followUpValue = radio.value || null;
        }

        // Armor penalty gate (parity with StationActivityDialog.#onConfirm). Skipped for safe rest spot.
        const actor = game.actors.get(characterId);
        const resolver = app._activityResolver;
        const activity = resolver?.activities?.get(activityId);
        if (!app._effectiveSafeRestSpot() && actor && activity && !activity.armorSleepWaiver) {
            try {
                const armorRuleEnabled = game.settings.get("ionrift-respite", "armorDoffRule");
                if (armorRuleEnabled) {
                    const equippedArmor = actor.items?.find(i =>
                        i.type === "equipment"
                        && i.system?.equipped
                        && ["medium", "heavy"].includes(i.system?.type?.value ?? i.system?.armor?.type)
                    );
                    if (equippedArmor) {
                        const confirmFn = game.ionrift?.library?.confirm ?? Dialog.confirm.bind(Dialog);
                        const proceed = await confirmFn({
                            title: "Sleeping in Armor",
                            content: `<p><strong>${equippedArmor.name}</strong> is equipped. Sleeping in medium or heavy armor limits recovery to 1/4 Hit Dice and prevents exhaustion reduction (Xanathar's rules).</p><p>Doff the armor before confirming, or proceed and accept the penalty.</p>`,
                            yesLabel: "Confirm Anyway",
                            noLabel: "Cancel",
                            yesIcon: "fas fa-check",
                            noIcon: "fas fa-times",
                            defaultYes: false,
                        });
                        if (!proceed) return;
                    }
                }
            } catch (e) { /* setting may not be registered */ }
        }

        if (followUpValue) {
            if (!app._gmFollowUps) app._gmFollowUps = new Map();
            app._gmFollowUps.set(characterId, followUpValue);
        }

        app._totmFollowUpExpanded = null;
        await app.finalizeActivityChoiceFromStation(characterId, activityId, null, { followUpValue });

        // Training stays in the detail panel until all three sets are rolled.
        if (activityId === "act_train") {
            app._totmFollowUpExpanded = { activityId, characterId, trainingActive: true };
        }
        app.render();
    
    }

    async onSelectTotmActivity(event, target) {
        const app = this._app;

        const activityId = target.closest("[data-activity-id]")?.dataset?.activityId;
        if (!activityId) return;
        const characterId = app._selectedCharacterId;
        if (!characterId) {
            ui.notifications.warn("Select a character from the roster first.");
            return;
        }
        if (app._craftingInProgress?.has(characterId)) {
            ui.notifications.warn("Crafting is currently in progress for this character.");
            return;
        }

        const actor = game.actors.get(characterId);
        if (!actor) return;

        if (activityId === "act_forage" || activityId === "act_hunt") {
            if (gatherSelectionBlocked(app, characterId)) {
                if (gatherAlreadyResolved(app, characterId)) {
                    ui.notifications.info("Already gathered this rest.");
                }
                return;
            }
            app._totmFollowUpExpanded = null;
            await this.selectGatherChoice(characterId, activityId);
            return;
        }

        const activity = app._activityResolver?.activities?.get(activityId);
        const isCrafting = !!activity?.crafting?.enabled;
        const hasCrafted = app.hasCompletedCrafting?.(characterId);
        const isLocked = app._lockedCharacters?.has(characterId) || (app._isGM && app._gmOverrides?.has(characterId));

        if (isLocked || hasCrafted) {
            if (isCrafting && hasCrafted) {
                // Allow reviewing completed craft result
            } else {
                ui.notifications.warn("This character has already submitted their activity.");
                return;
            }
        }

        if (activityId === "act_identify" || activityId === "identify") {
            if (app._totmFollowUpExpanded?.isIdentify
                    && app._totmFollowUpExpanded?.characterId === characterId) {
                app._totmFollowUpExpanded = null;
            } else {
                app._totmFollowUpExpanded = { activityId, characterId, isIdentify: true };
            }
            app.render();
            return;
        }

        if (isCrafting) {
            // Crafting: expand inline crafting panel (TotM only; station mode still uses CraftingPickerApp).
            const craftingProfession = activity.crafting.profession ?? "cooking";
            if (app._totmFollowUpExpanded?.isCrafting
                    && app._totmFollowUpExpanded?.profession === craftingProfession
                    && app._totmFollowUpExpanded?.characterId === characterId) {
                // Toggle off
                app._totmFollowUpExpanded = null;
                app._resetTotmCraftState();
            } else {
                // mid-rest shows the finished result instead of a fresh roll.
                // A default recipe is preselected in the crafting context builder.
                app._resetTotmCraftState();
                app._hydrateTotmCraftStateFromRest(characterId, craftingProfession);
                app._totmFollowUpExpanded = { activityId, characterId, isCrafting: true, profession: craftingProfession };
            }
            app.render();
            return;
        }

        // All other activities: expand the inline detail panel.
        // Clicking the same card again while expanded collapses it (toggle).
        if (app._totmFollowUpExpanded?.activityId === activityId
                && app._totmFollowUpExpanded?.characterId === characterId) {
            app._totmFollowUpExpanded = null;
        } else {
            app._totmFollowUpExpanded = { activityId, characterId };
        }
        app.render();
    
    }

    /**
     * Select Forage or Hunt. The Survival check and the findings roll
     * stay on the roll request, the same as other rest checks.
     * @param {string} characterId
     * @param {"act_forage"|"act_hunt"} activityId
     */
    async selectGatherChoice(characterId, activityId) {
        const app = this._app;
        if (!app._gatherChoices) app._gatherChoices = new Map();
        if (!app._gatherResults) app._gatherResults = new Map();

        const actor = game.actors.get(characterId);
        if (!actor) return;
        if (!actor.isOwner && !game.user.isGM) {
            ui.notifications.warn("You do not own this character.");
            return;
        }

        if (gatherSelectionBlocked(app, characterId)) {
            if (app._craftingInProgress?.has(characterId)) {
                ui.notifications.warn("Crafting is currently in progress for this character.");
                return;
            }
        }

        if (gatherAlreadyResolved(app, characterId)) {
            const prior = app._gatherResults.get(characterId);
            const note = prior?.haul ? `${actor.name} already gathered this rest. ${prior.haul}` : "Already gathered this rest.";
            ui.notifications.info(note);
            if (prior?.activityId) app._gatherChoices.set(characterId, prior.activityId);
            app.render();
            return;
        }

        const pending = app._gatherPending;
        if (pending?.characterId === characterId && pending.phase === "findings") {
            ui.notifications.info("Roll for findings before switching.");
            return;
        }

        const isHunt = activityId === "act_hunt";
        releaseGatherFromActivity(app, characterId);
        app._gatherChoices.set(characterId, activityId);
        app._gatherPending = {
            characterId,
            activityId,
            phase: "check",
            dc: isHunt ? (app._campLogistics?._huntDC ?? 14) : (app._campLogistics?._forageDC ?? 12),
            total: null,
            findingsNeeded: 0,
            findings: []
        };
        publishCampProgress(app, {
            characterId,
            gatherChoice: activityId,
            gatherPending: gatherPendingPatch(app._gatherPending)
        });
        app.render();
    }

    /**
     * Player or GM roll for the open gather prompt.
     * Check phase is Survival. Findings phase is the table d100.
     * @param {Event} event
     * @param {HTMLElement} target
     */
    async onRollGather(event, target) {
        const app = this._app;
        const pending = app._gatherPending;
        if (!pending) return;
        const characterId = target?.dataset?.characterId || pending.characterId;
        if (characterId !== pending.characterId) return;

        const actor = game.actors.get(characterId);
        if (!actor) return;
        if (!actor.isOwner && !game.user.isGM) {
            ui.notifications.warn("You do not own this character.");
            return;
        }

        if (pending.phase === "findings") {
            await this.#requestFindings(actor, pending);
            return;
        }
        await this.#rollGatherCheck(actor, pending, target);
    }

    async #rollGatherCheck(actor, pending, target) {
        const app = this._app;
        const isHunt = pending.activityId === "act_hunt";
        const label = isHunt ? "Hunt" : "Forage";
        const flavor = `<strong>${actor.name}</strong> ${label} (Survival) DC ${pending.dc}`;
        const { total } = await executePlayerRoll(actor, "sur", pending.dc, flavor, target);

        const resolver = GatherYieldService.getResolver();
        const skillEval = isHunt
            ? resolver.evaluateHuntSkill(actor, total, pending.dc)
            : resolver.evaluateForageSkill(actor, total, pending.dc);
        pending.total = total;
        pending.skillEval = skillEval;

        if (!skillEval.success) {
            await this.#finishGather(actor, pending, { success: false, items: [], fromTable: false, rations: 0, mishap: "" });
            return;
        }

        pending.phase = "findings";
        pending.findingsNeeded = (skillEval.exceptional || skillEval.nat20) ? 2 : 1;
        pending.findings = [];
        publishCampProgress(app, {
            characterId: actor.id,
            gatherChoice: pending.activityId,
            gatherPending: gatherPendingPatch(pending)
        });
        app.render();
        await this.#requestFindings(actor, pending);
    }

    /**
     * One findings prompt per table roll. Each prompt is the shared roll
     * request and closes itself when that roll is done.
     * @param {Actor} actor
     * @param {object} pending
     */
    async #requestFindings(actor, pending) {
        const app = this._app;
        if (pending._findingsBusy) return;
        const request = game.ionrift?.library?.rollRequest?.request;
        if (typeof request !== "function") {
            ui.notifications.warn("Findings roll is unavailable.");
            return;
        }

        pending._findingsBusy = true;
        const of = pending.findingsNeeded;
        const rolls = [...(pending.findings ?? [])];
        const isHunt = pending.activityId === "act_hunt";
        const mode = isHunt ? "hunt" : "forage";
        const terrainTag = app._engine?.terrainTag ?? app._restData?.terrainTag ?? "forest";
        const exceptional = !!pending.skillEval?.exceptional;
        const nat20 = !!pending.skillEval?.nat20;
        try {
            for (let index = rolls.length; index < of; index++) {
                const which = index + 1;
                const tableLabel = GatherYieldService.findingsTableLabel({
                    mode,
                    terrainTag,
                    drawIndex: index,
                    nat20
                }) || "Findings table";
                const flavor = of > 1 ? `Draw ${which} of ${of}` : "";
                const result = await request({
                    actorId: actor.id,
                    type: "formula",
                    formula: "1d100",
                    title: tableLabel,
                    flavor,
                    tableLabel,
                    describeOutcome: async ({ total }) => {
                        const drawn = await GatherYieldService.describeFindingsDraw({
                            mode,
                            terrainTag,
                            roll: total,
                            drawIndex: index,
                            exceptional,
                            nat20
                        });
                        return drawn.outcome;
                    }
                });
                if (app._gatherResults?.has(actor.id)) return;
                const live = app._gatherPending;
                if (!live || live.characterId !== actor.id || live.phase !== "findings") return;
                live._findingsBusy = true;
                rolls.push(result.total);
                live.findings = [...rolls];
            }

            const live = app._gatherPending ?? pending;
            live.findings = rolls;
            const gathered = await GatherYieldService.resolveGatherDay({
                actor,
                mode: isHunt ? "hunt" : "forage",
                terrainTag,
                total: pending.total,
                dc: pending.dc,
                lootRolls: rolls
            });
            await this.#finishGather(actor, live, gathered);
        } finally {
            pending._findingsBusy = false;
            if (app._gatherPending?._findingsBusy) app._gatherPending._findingsBusy = false;
        }
    }

    async #finishGather(actor, pending, gathered) {
        const app = this._app;
        if (gathered.fromTable) {
            try {
                await GatherYieldService.grantGatheredItems(actor, gathered.items);
            } catch (err) {
                console.warn(`${MODULE_ID} | Gather grant failed`, err);
            }
        }
        const haul = gathered.fromTable
            ? GatherYieldService.describeItems(gathered.items)
            : (gathered.rations > 0 ? `${gathered.rations} rations` : "");
        const summary = [haul, gathered.mishap].filter(Boolean).join(". ") || (gathered.success ? "Found provisions" : "Nothing found");
        const isHunt = pending.activityId === "act_hunt";
        app._gatherChoices.set(actor.id, pending.activityId);
        app._gatherResults.set(actor.id, {
            activityId: pending.activityId,
            haul: summary,
            success: !!gathered.success && !gathered.mishap,
            items: gathered.items ?? [],
            rations: gathered.rations ?? 0,
            fromTable: !!gathered.fromTable
        });
        app._gatherPending = null;
        publishCampProgress(app, {
            characterId: actor.id,
            gatherChoice: pending.activityId,
            gatherResult: app._gatherResults.get(actor.id),
            gatherPending: null
        });
        ui.notifications.info(`${actor.name}: ${isHunt ? "Hunt" : "Forage"}. ${summary}`);
        app.checkAndAutoMarkCharacterReady?.(actor.id);
        app.render();
    }

    async onTotmCraftClose(event, target) {
        const app = this._app;

        if (app._totmCraftRollPending) return;
        const expanded = app._totmFollowUpExpanded;
        if (!expanded?.isCrafting) {
            app._totmFollowUpExpanded = null;
            app.render();
            return;
        }

        const characterId = expanded.characterId;
        const profession = expanded.profession;
        const result = app._totmCraftResult;

        if (app._totmCraftHasCrafted && result) {
            const resolver = app._activityResolver;
            const craftAct = resolver?.activities ? [...resolver.activities.values()].find(
                a => a.crafting?.profession === profession
            ) : null;
            const actor = game.actors.get(characterId);
            const proceed = await promptArmorSleepIfNeeded(actor, craftAct ?? { armorSleepWaiver: false });
            if (!proceed) {
                app.render();
                return;
            }
        }

        app._totmFollowUpExpanded = null;

        if (app._totmCraftHasCrafted && result) {
            app._craftingResults.set(characterId, result);

            const resolver = app._activityResolver;
            const craftAct = resolver?.activities ? [...resolver.activities.values()].find(
                a => a.crafting?.profession === profession
            ) : null;
            const activityId = craftAct?.id ?? "act_cook";

            app._lockedCharacters = app._lockedCharacters ?? new Set();
            app._lockedCharacters.add(characterId);

            if (app._isGM) {
                app._gmOverrides.set(characterId, activityId);
                app._rebuildCharacterChoices?.();
                const submissions = {};
                for (const [charId, actId] of app._characterChoices) {
                    const act = resolver?.activities?.get(actId);
                    submissions[charId] = {
                        activityId: actId,
                        activityName: act?.name ?? actId,
                        source: app._gmOverrides.has(charId) ? "gm" : "player"
                    };
                }
                emitSubmissionUpdate(submissions);
            } else {
                app._characterChoices.set(characterId, activityId);
                emitActivityChoice(
                    game.user.id,
                    Object.fromEntries(app._characterChoices),
                    { [characterId]: result },
                    null,
                    app._earlyResults?.size ? Object.fromEntries(app._earlyResults) : null
                );
                const actor = game.actors.get(characterId);
                if (actor) ui.notifications.info(`${actor.name}'s activity submitted.`);
            }
            app._saveRestState?.();
        }

        app._resetTotmCraftState();
        app.checkAndAutoMarkCharacterReady?.(characterId);
        app.render();
    
    }

    onSwitchTotmTab(event, target) {
        const app = this._app;

        const tab = target.dataset.totmTab;
        if (!tab) return;
        let safeFromSetting = false;
        try {
            safeFromSetting = !!game.settings.get(MODULE_ID, "safeRestSpot");
        } catch { /* noop */ }
        const effectiveSafe = !!(app._engine?.safeRestSpot ?? app._restData?.safeRestSpot ?? safeFromSetting);
        // Remember the manual choice so the encounters-off default does not
        // override a GM who deliberately opened the Activities tab.
        app._totmTabUserSet = true;
        if (tab === "fire" && (effectiveSafe || isCampfireMinigameEnabled())) {
            app._totmActiveTab = "activities";
        } else {
            app._totmActiveTab = tab;
        }
        app._totmFollowUpExpanded = null;
        app._resetTotmCraftState();
        app.render();
    
    }

    onCancelTotmFollowUp() {
        const app = this._app;

        const expanded = app._totmFollowUpExpanded;
        const cid = expanded?.characterId ?? app._selectedCharacterId;
        if (cid && app._trainingStates?.has(cid) && !app._earlyResults?.has(cid)) {
            ui.notifications.warn("Finish your training sets before going back.");
            return;
        }
        app._totmFollowUpExpanded = null;
        app.render();
    
    }

    async onUnlockTotmActivity(event, target) {
        const app = this._app;
        const cid = app._selectedCharacterId;
        if (!cid) return;
        if (app._earlyResults?.has(cid) || app.hasCompletedCrafting?.(cid) || app._craftingResults?.has(cid)) {
            ui.notifications.warn("Cannot change an activity that has already been resolved.");
            return;
        }
        app._lockedCharacters?.delete(cid);
        app._characterChoices?.delete(cid);
        app._gmFollowUps?.delete(cid);
        app._totmFollowUpExpanded = null;
        if (app._finishedActorIds?.has(cid)) {
            app._finishedActorIds.delete(cid);
            publishCampProgress(app, {
                finishedActorId: cid,
                finished: false
            });
        }
        app.render();
    }
}
