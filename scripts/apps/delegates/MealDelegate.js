/**
 * MealDelegate.js
 * Handles the meal phase UI within RestSetupApp: food/water selection,
 * consumption, dehydration saves, submission flow, and socket receive methods.
 * Extracted from RestSetupApp to reduce God Class complexity.
 */

import { MealPhaseHandler } from "../../services/MealPhaseHandler.js";
import { TerrainRegistry } from "../../services/TerrainRegistry.js";
import { getPartyActors } from "../../module.js";

const MODULE_ID = "ionrift-respite";

export class MealDelegate {

    /** @param {RestSetupApp} app */
    constructor(app) {
        this._app = app;
    }

    // ── Action Handlers ──────────────────────────────────────────────────

    /**
     * GM selects a food option for a character.
     */
    onSelectFood(event, target) {
        const app = this._app;
        const charId = target.dataset.characterId;
        const value = target.value ?? target.getAttribute("value") ?? "skip";
        if (!charId) return;

        if (!app._mealChoices) app._mealChoices = new Map();
        const existing = app._mealChoices.get(charId) ?? {};
        app._mealChoices.set(charId, { ...existing, food: value });
        app.render();
    }

    /**
     * GM selects a water option for a character.
     */
    onSelectWater(event, target) {
        const app = this._app;
        const charId = target.dataset.characterId;
        const value = target.value ?? target.getAttribute("value") ?? "skip";
        if (!charId) return;

        if (!app._mealChoices) app._mealChoices = new Map();
        const existing = app._mealChoices.get(charId) ?? {};
        app._mealChoices.set(charId, { ...existing, water: value });
        app.render();
    }

    /**
     * Consume the current day's food/water for all owned characters.
     * Deducts items from inventory immediately, saves state, advances to next day.
     */
    async onConsumeMealDay(event, target) {
        const app = this._app;
        if (!app._mealChoices) app._mealChoices = new Map();
        const characterIds = app._isGM
            ? [app._selectedCharacterId].filter(Boolean)
            : (app._myCharacterIds ? Array.from(app._myCharacterIds) : []);

        for (const charId of characterIds) {
            const choice = app._mealChoices.get(charId) ?? { food: [], water: [], consumedDays: [], currentDay: 0 };
            const consumedDays = choice.consumedDays ?? [];
            const currentDay = choice.currentDay ?? consumedDays.length;
            const food = Array.isArray(choice.food) ? [...choice.food] : [];
            const water = Array.isArray(choice.water) ? [...choice.water] : [];

            const actor = game.actors.get(charId);
            if (actor) {
                for (const itemId of food) {
                    if (itemId && itemId !== "skip") {
                        await MealPhaseHandler._consumeItem(actor, itemId, 1);
                    }
                }
                for (const itemId of water) {
                    if (itemId && itemId !== "skip") {
                        const item = actor.items.get(itemId);
                        const drainAmount = item?.system?.uses?.value || 1;
                        await MealPhaseHandler._consumeItem(actor, itemId, drainAmount);
                    }
                }
            }

            consumedDays.push({ food, water });
            app._mealChoices.set(charId, {
                food: [],
                water: [],
                consumedDays,
                currentDay: currentDay + 1
            });
        }

        await app._saveRestState();

        game.socket.emit(`module.${MODULE_ID}`, {
            type: "mealDayConsumed",
            userId: game.user.id,
            mealChoices: Object.fromEntries(app._mealChoices)
        });

        app.render();
    }

    /**
     * Player submits their meal choices via socket to the GM.
     */
    async onSubmitMealChoices(event, target) {
        const app = this._app;
        if (app._isGM) return;

        const choices = {};
        const skippedSlots = [];
        if (app._mealChoices) {
            const totalDays = app._engine?.durationDays ?? 1;
            for (const [charId, choice] of app._mealChoices) {
                if (app._myCharacterIds?.has(charId)) {
                    if ((choice.consumedDays?.length ?? 0) >= totalDays) {
                        choices[charId] = choice;
                        continue;
                    }

                    choices[charId] = choice;
                    const actor = game.actors.get(charId);
                    const name = actor?.name ?? charId;
                    const foodArr = Array.isArray(choice.food) ? choice.food : [];
                    const foodEmpty = foodArr.filter(v => !v || v === "skip").length;
                    if (foodArr.length === 0 || foodEmpty > 0) skippedSlots.push(`${name}: ${foodArr.length === 0 ? "no food" : `${foodEmpty} food slot${foodEmpty > 1 ? "s" : ""} empty`}`);
                    const waterArr = Array.isArray(choice.water) ? choice.water : [];
                    const waterEmpty = waterArr.filter(v => !v || v === "skip").length;
                    if (waterArr.length === 0 || waterEmpty > 0) skippedSlots.push(`${name}: ${waterArr.length === 0 ? "no water" : `${waterEmpty} water slot${waterEmpty > 1 ? "s" : ""} empty`}`);
                }
            }
        }

        if (app._myCharacterIds) {
            for (const charId of app._myCharacterIds) {
                if (!choices[charId]) {
                    const actor = game.actors.get(charId);
                    const name = actor?.name ?? charId;
                    skippedSlots.push(`${name}: no food`);
                    skippedSlots.push(`${name}: no water`);
                    choices[charId] = { food: [], water: [] };
                }
            }
        }

        if (skippedSlots.length > 0) {
            const confirmed = await new Promise(resolve => {
                const overlay = document.createElement("div");
                overlay.classList.add("ionrift-armor-modal-overlay");
                overlay.innerHTML = `
                    <div class="ionrift-armor-modal">
                        <h3><i class="fas fa-exclamation-triangle"></i> Skip Meals?</h3>
                        <p>The following meals are empty:</p>
                        <ul>${skippedSlots.map(s => `<li>${s}</li>`).join("")}</ul>
                        <p>Skipping meals has consequences.</p>
                        <div class="ionrift-armor-modal-buttons">
                            <button class="btn-armor-confirm"><i class="fas fa-check"></i> Continue</button>
                            <button class="btn-armor-cancel"><i class="fas fa-arrow-left"></i> Go Back</button>
                        </div>
                    </div>`;
                document.body.appendChild(overlay);
                overlay.querySelector(".btn-armor-confirm").addEventListener("click", () => {
                    overlay.remove();
                    resolve(true);
                });
                overlay.querySelector(".btn-armor-cancel").addEventListener("click", () => {
                    overlay.remove();
                    resolve(false);
                });
            });
            if (!confirmed) return;
        }

        game.socket.emit(`module.${MODULE_ID}`, {
            type: "mealChoice",
            userId: game.user.id,
            choices
        });

        app._mealSubmitted = true;
        app.render();
        ui.notifications.info("Meal choices submitted.");
    }

    /**
     * GM proceeds from meal phase.
     * Applies consumption and computes dehydration/starvation consequences.
     */
    async onProceedFromMeal(event, target) {
        const app = this._app;

        // Re-entry guard
        if (app._pendingDehydrationSaves?.length > 0) {
            const unresolved = app._pendingDehydrationSaves.filter(s => !s.resolved);
            if (unresolved.length > 0) {
                ui.notifications.warn(`Still waiting for ${unresolved.length} dehydration save(s).`);
                return;
            }
        }
        console.log(`[Respite:Meal] #onProceedFromMeal — starting`);

        const rosterIds = new Set(getPartyActors().map(a => a.id));
        const characterIds = app._engine?.characterChoices
            ? Array.from(app._engine.characterChoices.keys()).filter(id => rosterIds.has(id))
            : [];
        if (!app._mealChoices) app._mealChoices = new Map();

        // Check for unsubmitted player characters
        const unsubmitted = [];
        for (const charId of characterIds) {
            const actor = game.actors.get(charId);
            if (!actor) continue;
            const isPlayerOwned = game.users.some(u => !u.isGM && actor.testUserPermission(u, "OWNER"));
            if (!isPlayerOwned) continue;

            const choice = app._mealChoices.get(charId);
            const hasConsumed = choice?.consumedDays?.length > 0;
            const hasSelections = (choice?.food?.some(id => id && id !== "skip")) || (choice?.water?.some(id => id && id !== "skip"));
            const ownerUser = game.users.find(u => !u.isGM && actor.testUserPermission(u, "OWNER"));
            const ownerSubmitted = ownerUser && app._mealSubmissions?.has(ownerUser.id);

            if (!hasConsumed && !hasSelections && !ownerSubmitted) {
                unsubmitted.push(actor.name);
            }
        }

        if (unsubmitted.length > 0) {
            const confirmed = await new Promise(resolve => {
                const overlay = document.createElement("div");
                overlay.classList.add("ionrift-armor-modal-overlay");
                overlay.innerHTML = `
                    <div class="ionrift-armor-modal">
                        <h3><i class="fas fa-exclamation-triangle"></i> Not All Players Ready</h3>
                        <p>These characters haven't submitted their meal choices:</p>
                        <ul>${unsubmitted.map(n => `<li>${n}</li>`).join("")}</ul>
                        <p>Proceeding now treats them as having skipped all meals.</p>
                        <div class="ionrift-armor-modal-buttons">
                            <button class="btn-armor-confirm"><i class="fas fa-forward"></i> Proceed Anyway</button>
                            <button class="btn-armor-cancel"><i class="fas fa-clock"></i> Wait</button>
                        </div>
                    </div>`;
                document.body.appendChild(overlay);
                overlay.querySelector(".btn-armor-confirm").addEventListener("click", () => { overlay.remove(); resolve(true); });
                overlay.querySelector(".btn-armor-cancel").addEventListener("click", () => { overlay.remove(); resolve(false); });
            });
            if (!confirmed) return;
        }

        // Auto-fill missing choices
        for (const charId of characterIds) {
            if (!app._mealChoices.has(charId)) {
                const terrainTag = app._engine?.terrainTag ?? "forest";
                const terrainMealRules = TerrainRegistry.getDefaults(terrainTag)?.mealRules ?? {};
                const cards = MealPhaseHandler.buildMealContext(
                    [charId], terrainTag, terrainMealRules,
                    app._daysSinceLastRest ?? 1, app._mealChoices
                );
                if (cards.length > 0) {
                    app._mealChoices.set(charId, {
                        food: cards[0].selectedFood,
                        water: cards[0].selectedWater
                    });
                }
            }
        }

        // Resolve spoilage before consumption so rotten food is removed first
        if (!app._spoilageProcessed) {
            app._spoilageProcessed = true;
            try {
                const daysSince = app._daysSinceLastRest ?? 1;
                await MealPhaseHandler.resolveSpoilage(characterIds, daysSince);
            } catch (err) {
                console.error(`[Respite:Meal] Error resolving spoilage:`, err);
            }
        }

        // Apply consumption and compute consequences
        let mealResults = [];
        if (!app._mealProcessed) {
            app._mealProcessed = true;
            try {
                const terrainTag = app._engine?.terrainTag ?? "forest";
                const terrainMealRules = TerrainRegistry.getDefaults(terrainTag)?.mealRules ?? {};
                const totalDays = app._daysSinceLastRest ?? 1;
                const outcome = await MealPhaseHandler.processAndApply(app._mealChoices, totalDays, terrainMealRules);
                mealResults = outcome.results;
                console.log(`[Respite:Meal] Consumption results:`, mealResults);
            } catch (err) {
                console.error(`[Respite:Meal] Error applying meal choices:`, err);
            }

            // Apply starvation exhaustion (auto, no save)
            app._pendingDehydrationSaves = [];
            for (const r of mealResults) {
                if (r.starvationExhaustion > 0) {
                    const actor = game.actors.get(r.characterId);
                    if (actor) {
                        const adapter = game.ionrift?.respite?.adapter;
                        if (adapter) {
                            await adapter.applyExhaustionDelta(actor, r.starvationExhaustion);
                        } else {
                            const current = actor.system?.attributes?.exhaustion ?? 0;
                            const newLevel = Math.min(6, current + r.starvationExhaustion);
                            if (newLevel > current) {
                                await actor.update({ "system.attributes.exhaustion": newLevel });
                            }
                        }
                        await ChatMessage.create({
                                content: `<div class="respite-recovery-chat"><strong>${r.actorName}</strong> gains <strong>${r.starvationExhaustion}</strong> level${r.starvationExhaustion > 1 ? "s" : ""} of exhaustion from starvation.</div>`,
                                speaker: ChatMessage.getSpeaker({ actor })
                            });
                        app._pendingDehydrationSaves.push({
                            characterId: r.characterId,
                            actorName: r.actorName,
                            dc: 0,
                            resolved: true,
                            passed: false,
                            total: 0,
                            reason: `starvation (${r.starvationExhaustion} exhaustion)`
                        });
                    }
                }
            }

            // Apply essence depletion exhaustion (same model as starvation)
            for (const r of mealResults) {
                if ((r.essenceExhaustion ?? 0) > 0) {
                    const actor = game.actors.get(r.characterId);
                    if (actor) {
                        const adapter = game.ionrift?.respite?.adapter;
                        if (adapter) {
                            await adapter.applyExhaustionDelta(actor, r.essenceExhaustion);
                        } else {
                            const current = actor.system?.attributes?.exhaustion ?? 0;
                            const newLevel = Math.min(6, current + r.essenceExhaustion);
                            if (newLevel > current) {
                                await actor.update({ "system.attributes.exhaustion": newLevel });
                            }
                        }
                        await ChatMessage.create({
                            content: `<div class="respite-recovery-chat"><strong>${r.actorName}</strong> gains <strong>${r.essenceExhaustion}</strong> level${r.essenceExhaustion > 1 ? "s" : ""} of exhaustion from essence depletion.</div>`,
                            speaker: ChatMessage.getSpeaker({ actor })
                        });
                        app._pendingDehydrationSaves.push({
                            characterId: r.characterId,
                            actorName: r.actorName,
                            dc: 0,
                            resolved: true,
                            passed: false,
                            total: 0,
                            reason: `essence depletion (${r.essenceExhaustion} exhaustion)`
                        });
                    }
                }
            }

            // Apply dehydration consequences
            for (const r of mealResults) {
                if (r.dehydrationAutoFail) {
                    const actor = game.actors.get(r.characterId);
                    if (actor) {
                        const adapter = game.ionrift?.respite?.adapter;
                        if (adapter) {
                            await adapter.applyExhaustionDelta(actor, 1);
                        } else {
                            const current = actor.system?.attributes?.exhaustion ?? 0;
                            const newLevel = Math.min(6, current + 1);
                            if (newLevel > current) {
                                await actor.update({ "system.attributes.exhaustion": newLevel });
                            }
                        }
                        const restsSinceWater = actor.getFlag("ionrift-respite", "restsSinceWater") ?? 0;
                        await ChatMessage.create({
                            content: `<div class="respite-recovery-chat"><strong>${r.actorName}</strong> gains 1 level of exhaustion from severe dehydration (auto-fail, ${restsSinceWater} rests without water).</div>`,
                            speaker: ChatMessage.getSpeaker({ actor })
                        });
                        app._pendingDehydrationSaves.push({
                            characterId: r.characterId,
                            actorName: r.actorName,
                            dc: 0,
                            resolved: true,
                            passed: false,
                            total: 0,
                            reason: `dehydration auto-fail (${restsSinceWater} rests without water)`
                        });
                    }
                } else if (r.dehydrationSaveDC > 0) {
                    const actor = game.actors.get(r.characterId);
                    if (!actor) continue;

                    const ownerUser = game.users.find(u =>
                        !u.isGM && actor.testUserPermission(u, "OWNER")
                    );

                    if (ownerUser) {
                        app._pendingDehydrationSaves.push({
                            characterId: r.characterId,
                            actorName: r.actorName,
                            dc: r.dehydrationSaveDC,
                            userId: ownerUser.id,
                            resolved: false
                        });
                        game.socket.emit(`module.${MODULE_ID}`, {
                            type: "dehydrationSaveRequest",
                            characterId: r.characterId,
                            actorName: r.actorName,
                            dc: r.dehydrationSaveDC,
                            targetUserId: ownerUser.id
                        });
                        console.log(`[Respite:Meal] Sent dehydration save request for ${r.actorName} to user ${ownerUser.name}`);
                    } else {
                        // GM-owned character: roll directly
                        const conMod = actor.system?.abilities?.con?.mod ?? 0;
                        const profBonus = actor.system?.abilities?.con?.save
                            ? (actor.system?.attributes?.prof ?? 0) : 0;
                        const roll = await new Roll(`1d20 + ${conMod} + ${profBonus}`).evaluate();
                        const total = roll.total;
                        const passed = total >= r.dehydrationSaveDC;

                        if (game.dice3d) {
                            await game.dice3d.showForRoll(roll, game.user, true);
                        }
                        if (!passed) {
                            const adapter = game.ionrift?.respite?.adapter;
                            if (adapter) {
                                await adapter.applyExhaustionDelta(actor, 1);
                            } else {
                                const current = actor.system?.attributes?.exhaustion ?? 0;
                                const newLevel = Math.min(6, current + 1);
                                if (newLevel > current) {
                                    await actor.update({ "system.attributes.exhaustion": newLevel });
                                }
                            }
                            await ChatMessage.create({
                                content: `<div class="respite-recovery-chat"><strong>${r.actorName}</strong> fails the CON save (${total} vs DC ${r.dehydrationSaveDC}) and gains 1 level of exhaustion from dehydration.</div>`,
                                speaker: ChatMessage.getSpeaker({ actor })
                            });
                        } else {
                            await ChatMessage.create({
                                content: `<div class="respite-recovery-chat"><strong>${r.actorName}</strong> passes the CON save (${total} vs DC ${r.dehydrationSaveDC}) and fights off dehydration.</div>`,
                                speaker: ChatMessage.getSpeaker({ actor })
                            });
                        }
                        app._pendingDehydrationSaves.push({
                            characterId: r.characterId,
                            actorName: r.actorName,
                            dc: r.dehydrationSaveDC,
                            userId: game.user.id,
                            resolved: true
                        });
                    }
                }
            }
        }

        // Broadcast dehydration results
        if (app._pendingDehydrationSaves?.length > 0) {
            const allResults = app._pendingDehydrationSaves
                .map(s => ({
                    actorName: s.actorName,
                    total: s.total ?? 0,
                    passed: s.passed ?? false,
                    dc: s.dc ?? 0,
                    reason: s.reason ?? null,
                    pending: !s.resolved
                }));
            game.socket.emit(`module.${MODULE_ID}`, {
                type: "dehydrationResultsBroadcast",
                results: allResults
            });
        }

        // If dehydration saves pending
        if (app._pendingDehydrationSaves?.length > 0) {
            const allResolved = app._pendingDehydrationSaves.every(s => s.resolved);
            if (!allResolved) {
                console.log(`[Respite:Meal] Waiting for dehydration save(s) to resolve...`);
                ui.notifications.info(`Waiting for dehydration save(s) to resolve before proceeding.`);
                await app._saveRestState();
                app.render();
                return;
            } else {
                if (!app._mealResultsReviewed) {
                    app._mealResultsReviewed = true;
                    await app._saveRestState();
                    app.render();
                    return;
                }
                app._pendingDehydrationSaves = [];
            }
        }

        // Transition to reflection
        app._phase = "reflection";
        console.log(`[Respite:Meal] Transitioning to reflection, emitting phaseChanged`);

        game.socket.emit(`module.${MODULE_ID}`, {
            type: "phaseChanged",
            phase: app._phase,
            phaseData: { campStatus: app._campStatus }
        });

        await app._saveRestState();
        app.render();
    }

    /**
     * GM skips all unresolved dehydration saves, auto-failing them.
     */
    async onSkipPendingSaves(event, target) {
        const app = this._app;
        if (!app._pendingDehydrationSaves?.length) return;

        const unresolved = app._pendingDehydrationSaves.filter(s => !s.resolved);
        if (!unresolved.length) return;

        for (const save of unresolved) {
            const actor = game.actors.get(save.characterId);
            if (actor) {
                const adapter = game.ionrift?.respite?.adapter;
                if (adapter) {
                    await adapter.applyExhaustionDelta(actor, 1);
                } else {
                    const current = actor.system?.attributes?.exhaustion ?? 0;
                    const newLevel = Math.min(6, current + 1);
                    if (newLevel > current) {
                        await actor.update({ "system.attributes.exhaustion": newLevel });
                    }
                }
                await ChatMessage.create({
                    content: `<div class="respite-recovery-chat"><strong>${save.actorName}</strong> fails the CON save (skipped by GM) and gains 1 level of exhaustion from dehydration.</div>`,
                    speaker: ChatMessage.getSpeaker({ actor })
                });
            }

            save.resolved = true;
            save.passed = false;
            save.total = 0;
            save.reason = "dehydration (GM skipped)";
        }

        const allResults = app._pendingDehydrationSaves.map(s => ({
            actorName: s.actorName,
            total: s.total ?? 0,
            passed: s.passed ?? false,
            dc: s.dc ?? 0,
            reason: s.reason ?? null,
            pending: !s.resolved
        }));
        game.socket.emit(`module.${MODULE_ID}`, {
            type: "dehydrationResultsBroadcast",
            results: allResults
        });

        await app._saveRestState();
        app.render();
        ui.notifications.info(`Skipped ${unresolved.length} pending save(s). Exhaustion applied.`);
    }

    // ── Socket Receive Methods ───────────────────────────────────────────

    /**
     * GM receives meal choices from a player via socket.
     */
    async receiveMealChoices(userId, choices) {
        const app = this._app;
        if (!app._mealChoices) app._mealChoices = new Map();
        if (!app._mealSubmissions) app._mealSubmissions = new Map();

        for (const [charId, choice] of Object.entries(choices)) {
            app._mealChoices.set(charId, choice);
        }

        app._mealSubmissions.set(userId, {
            timestamp: Date.now(),
            characterIds: Object.keys(choices)
        });

        if (!app._activityMealRationsSubmitted) app._activityMealRationsSubmitted = new Set();
        for (const charId of Object.keys(choices)) {
            app._activityMealRationsSubmitted.add(charId);
        }

        console.log(`[Respite:Meal] Received meal choices from user ${userId}:`, choices);
        await app._saveRestState();
        const snapshot = app.getRestSnapshot?.();
        if (snapshot) {
            game.socket.emit(`module.${MODULE_ID}`, { type: "restSnapshot", snapshot });
        }
        app.render();
        if (typeof app._refreshStationOverlayMeals === "function") app._refreshStationOverlayMeals();
    }

    /**
     * GM receives a client's consumed meal day progress via socket.
     */
    async receiveMealDayConsumed(userId, clientChoices) {
        const app = this._app;
        if (!app._mealChoices) app._mealChoices = new Map();

        for (const [charId, choice] of Object.entries(clientChoices)) {
            const existing = app._mealChoices.get(charId) ?? {};
            app._mealChoices.set(charId, {
                ...existing,
                consumedDays: choice.consumedDays ?? existing.consumedDays ?? [],
                currentDay: choice.currentDay ?? existing.currentDay ?? 0,
                food: choice.food ?? [],
                water: choice.water ?? []
            });
        }

        console.log(`[Respite:Meal] Received meal day consumed from user ${userId}:`, clientChoices);
        await app._saveRestState();
        app.render();
    }

    /**
     * Player receives a dehydration save request from the GM.
     */
    async receiveDehydrationPrompt(characterId, actorName, dc) {
        const actor = game.actors.get(characterId);
        if (!actor) return;

        const confirmed = await game.ionrift.library.confirm({
            title: "Dehydration Check",
            content: `<p><strong>${actorName}</strong> has gone without water.</p><p>Constitution save DC ${dc} or gain 1 level of exhaustion.</p>`,
            yesLabel: "Roll CON Save",
            noLabel: "Cancel",
            yesIcon: "fas fa-dice-d20",
            noIcon: "fas fa-times",
            defaultYes: true
        });

        if (confirmed) {
            let total = 0;
            let passed = false;
            try {
                const conMod = actor.system?.abilities?.con?.mod ?? 0;
                const profBonus = actor.system?.abilities?.con?.save
                    ? (actor.system?.attributes?.prof ?? 0) : 0;
                const roll = await new Roll(`1d20 + ${conMod} + ${profBonus}`).evaluate();
                total = roll.total;
                passed = total >= dc;

                if (game.dice3d) {
                    await game.dice3d.showForRoll(roll, game.user, true);
                }
            } catch (e) {
                console.error(`[Respite] Dehydration save roll failed for ${actorName}:`, e);
                ui.notifications.error(`Could not roll CON save for ${actorName}. Treating as failed.`);
            }

            setTimeout(() => {
                game.socket.emit(`module.${MODULE_ID}`, {
                    type: "dehydrationSaveResult",
                    characterId,
                    actorName,
                    dc,
                    total,
                    passed,
                    userId: game.user.id
                });
            }, 3500);
        }
    }

    /**
     * GM receives a dehydration save result from a player.
     */
    async receiveDehydrationResult(data) {
        const app = this._app;
        const { characterId, actorName, dc, total, passed } = data;
        const actor = game.actors.get(characterId);

        if (!passed && actor) {
            const adapter = game.ionrift?.respite?.adapter;
            if (adapter) {
                await adapter.applyExhaustionDelta(actor, 1);
            } else {
                const current = actor.system?.attributes?.exhaustion ?? 0;
                const newLevel = Math.min(6, current + 1);
                if (newLevel > current) {
                    await actor.update({ "system.attributes.exhaustion": newLevel });
                }
            }
            await ChatMessage.create({
                content: `<div class="respite-recovery-chat"><strong>${actorName}</strong> fails the CON save (${total} vs DC ${dc}) and gains 1 level of exhaustion from dehydration.</div>`,
                speaker: ChatMessage.getSpeaker({ actor })
            });
        } else if (passed) {
            await ChatMessage.create({
                content: `<div class="respite-recovery-chat"><strong>${actorName}</strong> passes the CON save (${total} vs DC ${dc}) and fights off dehydration.</div>`,
                speaker: actor ? ChatMessage.getSpeaker({ actor }) : undefined
            });
        }

        if (app._pendingDehydrationSaves) {
            const pending = app._pendingDehydrationSaves.find(s => s.characterId === characterId);
            if (pending) {
                pending.resolved = true;
                pending.total = total;
                pending.passed = passed;
            }

            app._saveRestState();
            app.render();

            const resolvedResults = app._pendingDehydrationSaves
                .filter(s => s.resolved)
                .map(s => ({ actorName: s.actorName, total: s.total, passed: s.passed, dc: s.dc, reason: s.reason ?? null, pending: !s.resolved }));
            game.socket.emit(`module.${MODULE_ID}`, {
                type: "dehydrationResultsBroadcast",
                results: resolvedResults
            });
        }
    }
}
