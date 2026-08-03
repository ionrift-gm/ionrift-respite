import { MODULE_ID } from "../../../../data/moduleId.js";
export class TotmActivityDelegate {
    constructor(app) {
        this._app = app;
    }

    async onConfirmTotmFollowUp(event, target) {
        const app = this._app;

        const expanded = app._totmFollowUpExpanded;
        if (!expanded) return;
        const { activityId, characterId } = expanded;

        if (app._lockedCharacters?.has(characterId)) {
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
        if (app._lockedCharacters?.has(characterId)) {
            ui.notifications.warn("This character has already submitted their activity.");
            return;
        }
        const actor = game.actors.get(characterId);
        if (!actor) return;

        const activity = app._activityResolver?.activities?.get(activityId);
        const isCrafting = !!activity?.crafting?.enabled;

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

    onTotmCraftClose(event, target) {
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

        app._totmFollowUpExpanded = null;

        if (app._totmCraftHasCrafted && result) {
            app._craftingResults.set(characterId, result);

            const resolver = app._activityResolver;
            const craftAct = resolver?.activities ? [...resolver.activities.values()].find(
                a => a.crafting?.profession === profession
            ) : null;
            const activityId = craftAct?.id ?? "act_cook";

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
                app._lockedCharacters = app._lockedCharacters ?? new Set();
                app._lockedCharacters.add(characterId);
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
        }

        app._resetTotmCraftState();
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
}
