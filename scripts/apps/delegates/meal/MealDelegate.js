import { MealDragAndAutoMethods } from "./MealDragAndAutoHelper.js";
import { Logger } from "../../../utils/Logger.js";
import { MODULE_ID } from "../../../data/moduleId.js";
import { MealPhaseHandler } from "../../../services/meal/phase/MealPhaseHandler.js";
import { enqueueProvision } from "../../../services/meal/buffs/MealBuffBeat.js";
import { TerrainRegistry } from "../../../services/events/resolve/TerrainRegistry.js";
import { actorMealSlots } from "../../../services/meal/phase/MealContextBuilder.js";
import { rationSkipLines, restTerrainMealRules } from "../../../services/meal/phase/RationNeed.js";
import { parseStackSources, pickStackMember } from "../../../services/meal/phase/SustenanceTray.js";
import { undoWaterAssignment } from "../../../services/meal/phase/SustenanceEditPlan.js";
import { ItemClassifier } from "../../../services/party/ItemClassifier.js";
import { getPartyActors } from "../../../services/party/partyActors.js";
import { isStationLayerActive, refreshStationEmptyNoticeFade } from "../../../services/camp/props/StationInteractionLayer.js";
import { stampDeprivationExhaustionFloor } from "../../../services/meal/phase/MealExhaustionGuard.js";
import { isTrailerFilmingMode as _isTrailerFilmingMode } from "../rest/layout/RestWindowLayout.js";
import { emitSocketMessage } from "../../../services/socket/SocketController.js";
import { presentRoll } from "/modules/ionrift-library/scripts/services/rolls/DiceSettle.js";
import { isPf2eSystem, evaluatePf2eSaveDegree } from "../../../services/camp/gear/Pf2eComfortRules.js";
import { getNatD20FromRoll } from "../../../services/events/resolve/Pf2eEventRules.js";

export class MealDelegate {

    constructor(app) {
        this._app = app;
    }

    static buildMissingCharactersList(characterIds, mealChoices, mealSubmissions, resolvers) {
        const missing = [];
        for (const charId of characterIds) {
            const actor = resolvers.getActor(charId);
            if (!actor) continue;
            if (resolvers.participates && !resolvers.participates(actor)) continue;

            const choice = mealChoices.get(charId);
            if (choice?.consumedDays?.length > 0) continue;

            const foodArr = Array.isArray(choice?.food) ? choice.food : [];
            const waterArr = Array.isArray(choice?.water) ? choice.water : [];
            const hasFood = foodArr.some(id => id && id !== "skip");
            const hasWater = waterArr.some(id => id && id !== "skip");
            if (hasFood && hasWater) continue;

            const ownerUser = resolvers.findOwnerUser(actor);
            const ownerSubmitted = ownerUser && mealSubmissions?.has(ownerUser.id);

            missing.push({
                name: actor.name,
                playerOwned: !!ownerUser,
                awaitingPlayer: !!ownerUser && !ownerSubmitted,
                missingFood: !hasFood,
                missingWater: !hasWater
            });
        }
        return missing;
    }

    onSelectFood(event, target) {
        const app = this._app;
        const charId = target.dataset.characterId;
        const value = target.value ?? target.getAttribute("value") ?? "skip";
        if (!charId) return;

        if (!app._mealChoices) app._mealChoices = new Map();
        const existing = app._mealChoices.get(charId) ?? {};
        const arr = Array.isArray(existing.food) ? [...existing.food] : [];
        if (arr.length === 0) arr.push(value);
        else arr[0] = value;
        app._mealChoices.set(charId, { ...existing, food: arr });
        app.render();
    }

    onSelectWater(event, target) {
        const app = this._app;
        const charId = target.dataset.characterId;
        const value = target.value ?? target.getAttribute("value") ?? "skip";
        if (!charId) return;

        if (!app._mealChoices) app._mealChoices = new Map();
        const existing = app._mealChoices.get(charId) ?? {};
        const arr = Array.isArray(existing.water) ? [...existing.water] : [];
        if (arr.length === 0) arr.push(value);
        else arr[0] = value;
        app._mealChoices.set(charId, { ...existing, water: arr });
        app.render();
    }

    clearDiegeticSlot(actorId, kind, index) {
        const app = this._app;
        if (!actorId || !Number.isInteger(index) || index < 0) return;
        if (!app._mealChoices) app._mealChoices = new Map();
        const existing = app._mealChoices.get(actorId) ?? {};
        const arr = Array.isArray(existing[kind]) ? [...existing[kind]] : [];

        if (kind === "water") {
            this.clearDiegeticWater(actorId, "pour");
            return;
        }

        while (arr.length <= index) arr.push("skip");
        arr[index] = "skip";
        app._mealChoices.set(actorId, { ...existing, [kind]: arr });
        if (app._refreshStationOverlayMeals) app._refreshStationOverlayMeals();
        app.render();
    }

    clearDiegeticWater(actorId, mode) {
        const app = this._app;
        if (!actorId) return;
        if (!app._mealChoices) app._mealChoices = new Map();
        const existing = app._mealChoices.get(actorId) ?? {};
        const next = undoWaterAssignment(existing.water, existing.waterPours, mode === "all" ? "all" : "pour");
        app._mealChoices.set(actorId, { ...existing, water: next.water, waterPours: next.waterPours });
        if (app._refreshStationOverlayMeals) app._refreshStationOverlayMeals();
        app.render();
    }

    assignDiegeticItem(actorId, kind, itemId, slotIndex, available, sources) {
        const app = this._app;
        if (!actorId || !itemId) return;
        if (!app._mealChoices) app._mealChoices = new Map();
        const existing = app._mealChoices.get(actorId) ?? {};
        const arr = Array.isArray(existing[kind]) ? [...existing[kind]] : [];
        const rules = restTerrainMealRules(app);
        const actor = game.actors?.get?.(actorId) ?? null;
        const slots = actorMealSlots(actor, rules);
        const need = kind === "water" ? slots.waterPerDay : slots.foodPerDay;
        if (!need) return;
        const members = parseStackSources(sources, itemId, available);

        if (kind === "water") {
            const filled = arr.filter(value => value && value !== "skip");
            const room = need - filled.length;
            if (room <= 0) return;
            const added = [];
            for (let i = 0; i < room; i++) {
                const nextId = pickStackMember(members, filled.concat(added));
                if (!nextId) break;
                added.push(nextId);
            }
            if (!added.length) return;
            let pours = Array.isArray(existing.waterPours) ? [...existing.waterPours] : [];
            const recorded = pours.reduce((total, count) => total + count, 0);
            if (recorded !== filled.length) pours = filled.length ? [filled.length] : [];
            pours.push(added.length);
            app._mealChoices.set(actorId, { ...existing, water: filled.concat(added), waterPours: pours });
            if (app._refreshStationOverlayMeals) app._refreshStationOverlayMeals();
            app.render();
            return;
        }

        while (arr.length < need) arr.push("skip");
        const nextId = pickStackMember(members, arr);
        if (!nextId) return;
        const preferred = Number.isInteger(slotIndex) ? slotIndex : -1;
        const preferredOpen = preferred >= 0 && preferred < need && (!arr[preferred] || arr[preferred] === "skip");
        const hole = preferredOpen ? preferred : arr.findIndex(value => !value || value === "skip");
        if (hole < 0 || hole >= need) return;
        arr[hole] = nextId;
        app._mealChoices.set(actorId, { ...existing, [kind]: arr });
        if (app._refreshStationOverlayMeals) app._refreshStationOverlayMeals();
        app.render();
    }

    async onConsumeMealDay(_event, _target) {
        const app = this._app;
        if (!app._mealChoices) app._mealChoices = new Map();
        const characterIds = app._isGM
            ? [app._selectedCharacterId].filter(Boolean)
            : (app._myCharacterIds ? Array.from(app._myCharacterIds) : []);

        const consumeByCharacter = {};

        for (const charId of characterIds) {
            const choice = app._mealChoices.get(charId) ?? { food: [], water: [], consumedDays: [], currentDay: 0 };
            const consumedDays = choice.consumedDays ?? [];
            const currentDay = choice.currentDay ?? consumedDays.length;
            const food = Array.isArray(choice.food) ? [...choice.food] : [];
            const water = Array.isArray(choice.water) ? [...choice.water] : [];

            if (!app._isGM) {
                consumeByCharacter[charId] = { food, water, consumedDays, currentDay };
                continue;
            }

            const actor = game.actors.get(charId);
            // Compute bonusWater BEFORE consuming items (items still in inventory)
            let dayBonusWater = 0;
            if (actor) {
                const satiatesLookup = app._buildSatiatesLookup?.() ?? null;
                for (const itemId of food) {
                    if (!itemId || itemId === "skip" || itemId.startsWith?.("__")) continue;
                    const item = actor.items.get(itemId);
                    if (!item) continue;
                    let sats = item.flags?.[MODULE_ID]?.satiates;
                    if (!Array.isArray(sats) && satiatesLookup) {
                        sats = satiatesLookup.get(item.name.toLowerCase().trim()) ?? null;
                    }
                    if (Array.isArray(sats) && sats.includes("water")) dayBonusWater++;
                }
            }
            if (actor) {
                // Snapshot food items before consumption for Well Fed resolution
                const foodSnapshots = new Map();
                for (const itemId of food) {
                    if (itemId && itemId !== "skip") {
                        const item = actor.items.get(itemId);
                        if (item) foodSnapshots.set(itemId, item.toObject(false));
                    }
                }

                const partyIds = (app._myCharacterIds
                    ? Array.from(app._myCharacterIds)
                    : characterIds);
                const drinkSnapshots = new Map();
                for (const itemId of water) {
                    if (itemId && itemId !== "skip") {
                        const item = actor.items.get(itemId);
                        if (item) drinkSnapshots.set(itemId, item.toObject(false));
                    }
                }
                for (const itemId of food) {
                    if (itemId && itemId !== "skip") {
                        const consumed = await MealPhaseHandler._consumeItem(actor, itemId, 1);
                        const snapshot = foodSnapshots.get(itemId);
                        if (snapshot && consumed > 0) {
                            app._mealBuffQueue = enqueueProvision(app._mealBuffQueue, snapshot, {
                                actorId: charId, actorName: actor.name, kind: "food", partyIds
                            });
                        }
                    }
                }
                for (const itemId of water) {
                    if (itemId && itemId !== "skip") {
                        const consumed = await MealPhaseHandler._consumeItem(actor, itemId, 1);
                        const snapshot = drinkSnapshots.get(itemId);
                        if (snapshot && consumed > 0) {
                            app._mealBuffQueue = enqueueProvision(app._mealBuffQueue, snapshot, {
                                actorId: charId, actorName: actor.name, kind: "drink", partyIds
                            });
                        }
                    }
                }
            }

            consumedDays.push({ food, water, bonusWater: dayBonusWater, itemsConsumed: true });
            app._mealChoices.set(charId, {
                food: [],
                water: [],
                consumedDays,
                currentDay: currentDay + 1
            });
        }

        if (!app._isGM) {
            if (!Object.keys(consumeByCharacter).length) {
                app.render();
                return;
            }
            emitSocketMessage({
                type: "mealDayConsumeRequest",
                userId: game.user.id,
                consumeByCharacter
            });
            for (const [charId, pack] of Object.entries(consumeByCharacter)) {
                const consumedDays = [...(pack.consumedDays ?? [])];
                consumedDays.push({ food: pack.food, water: pack.water, bonusWater: pack.bonusWater ?? 0, itemsConsumed: true });
                const priorDay = pack.currentDay ?? (pack.consumedDays?.length ?? 0);
                app._mealChoices.set(charId, {
                    food: [],
                    water: [],
                    consumedDays,
                    currentDay: priorDay + 1
                });
            }
            await app._saveRestState();
            app.render();
            return;
        }

        await app._saveRestState();

        emitSocketMessage({
            type: "mealDayConsumed",
            userId: game.user.id,
            mealChoices: Object.fromEntries(app._mealChoices)
        });

        app.render();
    }

    /**
     * Omits auxiliary sheets (loot, shared chests) that were inflating Skip Meals.
     * @returns {Set<string>}
     */
    _mealObligatedOwnedCharacterIds(app) {
        const owned = app._myCharacterIds;
        if (!owned?.size) return new Set();

        const rosterIds = new Set(getPartyActors().map(a => a.id));
        let participantIds;
        if (app._engine?.characterChoices?.size) {
            participantIds = [...app._engine.characterChoices.keys()].filter(id => rosterIds.has(id));
        } else {
            participantIds = [...rosterIds].filter(id => owned.has(id));
        }

        const out = new Set();
        for (const id of participantIds) {
            if (!owned.has(id)) continue;
            const actor = game.actors.get(id);
            if (!actor || actor.type !== "character") continue;
            if (!ItemClassifier.participatesInSustenance(actor)) continue;
            out.add(id);
        }
        return out;
    }

    
    _pushMealSlotWarnings(skippedSlots, charId, choice) {
        const app = this._app;
        const actor = game.actors.get(charId);
        const lines = rationSkipLines(
            actor,
            choice,
            restTerrainMealRules(app),
            app._buildSatiatesLookup?.() ?? null
        );
        skippedSlots.push(...lines);
    }

    
    async _confirmSkipMeals(skippedSlots) {
        if (skippedSlots.length === 0) return true;
        return await new Promise(resolve => {
            const overlay = document.createElement("div");
            overlay.classList.add("ionrift-armor-modal-overlay");
            overlay.innerHTML = `
                    <div class="ionrift-armor-modal">
                        <h3><i class="fas fa-exclamation-triangle"></i> ${game.i18n.localize("ionrift-respite.mealDelegate.skipMealsTitle")}</h3>
                        <p>${game.i18n.localize("ionrift-respite.mealDelegate.followingMealsEmpty")}</p>
                        <ul>${skippedSlots.map(s => `<li>${s}</li>`).join("")}</ul>
                        <p>${game.i18n.localize("ionrift-respite.mealDelegate.skippingConsequences")}</p>
                        <div class="ionrift-armor-modal-buttons">
                            <button class="btn-armor-confirm"><i class="fas fa-check"></i> ${game.i18n.localize("ionrift-respite.mealDelegate.btnSkipMeals")}</button>
                            <button class="btn-armor-cancel"><i class="fas fa-arrow-left"></i> ${game.i18n.localize("ionrift-respite.mealDelegate.btnGoBack")}</button>
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
    }

    /** Cooking station: one character only (avoids party-chest sheets on submit). */
    async onSubmitStationMealChoices(actorId) {
        const app = this._app;
        if (app._isGM || !actorId) return;

        const obligated = this._mealObligatedOwnedCharacterIds(app);
        if (!obligated.has(actorId)) return;

        if (!app._activityMealRationsSubmitted) app._activityMealRationsSubmitted = new Set();
        if (app._activityMealRationsSubmitted.has(actorId)) return;

        const choice = app._mealChoices?.get(actorId) ?? {};
        const totalDays = app._engine?.durationDays ?? 1;
        if ((choice.consumedDays?.length ?? 0) >= totalDays) {
            app._activityMealRationsSubmitted.add(actorId);
            const allRecorded = [...obligated].every(id => app._activityMealRationsSubmitted.has(id));
            if (allRecorded) app._mealSubmitted = true;
            app.render();
            return;
        }

        const skippedSlots = [];
        this._pushMealSlotWarnings(skippedSlots, actorId, choice);
        if (!(await this._confirmSkipMeals(skippedSlots))) return;

        emitSocketMessage({
            type: "mealChoice",
            userId: game.user.id,
            choices: { [actorId]: choice }
        });

        app._activityMealRationsSubmitted.add(actorId);
        app.checkAndAutoMarkCharacterReady?.(actorId);
        const allRecorded = [...obligated].every(id => app._activityMealRationsSubmitted.has(id));
        if (allRecorded) app._mealSubmitted = true;

        if (isStationLayerActive()) {
            refreshStationEmptyNoticeFade(app);
        }
        app.render();
        ui.notifications.info(game.i18n.localize("ionrift-respite.mealDelegate.choicesSubmitted"));
    }

        async onSubmitMealChoices(_event, _target) {
        const app = this._app;
        if (app._isGM) return;

        const obligated = this._mealObligatedOwnedCharacterIds(app);
        const submitted = app._activityMealRationsSubmitted ?? new Set();
        const pending = new Set([...obligated].filter(id => !submitted.has(id)));

        const choices = {};
        const skippedSlots = [];
        const totalDays = app._engine?.durationDays ?? 1;

        for (const charId of obligated) {
            const choice = app._mealChoices?.get(charId) ?? {};

            if ((choice.consumedDays?.length ?? 0) >= totalDays) {
                choices[charId] = choice;
                continue;
            }

            if (!pending.has(charId)) {
                choices[charId] = choice;
                continue;
            }

            choices[charId] = choice;
            this._pushMealSlotWarnings(skippedSlots, charId, choice);
        }

        if (!(await this._confirmSkipMeals(skippedSlots))) return;

        emitSocketMessage({
            type: "mealChoice",
            userId: game.user.id,
            choices
        });

        if (!app._activityMealRationsSubmitted) app._activityMealRationsSubmitted = new Set();
        for (const charId of obligated) {
            app._activityMealRationsSubmitted.add(charId);
        }

        app._mealSubmitted = true;
        if (isStationLayerActive()) {
            refreshStationEmptyNoticeFade(app);
        }
        app.render();
        ui.notifications.info(game.i18n.localize("ionrift-respite.mealDelegate.choicesSubmitted"));
    }

        async onProceedFromMeal(event, target) {
        const app = this._app;

    // Re-entry guard
        if (app._pendingDehydrationSaves?.length > 0) {
            const unresolved = app._pendingDehydrationSaves.filter(s => !s.resolved);
            if (unresolved.length > 0) {
                ui.notifications.warn(game.i18n.format("ionrift-respite.mealDelegate.waitingForDehydrationSaves", { count: unresolved.length }));
                return;
            }
        }
        Logger.log(`[Respite:Meal] #onProceedFromMeal: starting`);

        const rosterIds = new Set(getPartyActors().map(a => a.id));
        const characterIds = app._engine?.characterChoices
            ? Array.from(app._engine.characterChoices.keys()).filter(id => rosterIds.has(id))
            : [];
        if (!app._mealChoices) app._mealChoices = new Map();

        // Skip missing-characters modal once meals are processed (e.g. after dehydration saves).
        const missing = app._mealProcessed ? [] : MealDelegate.buildMissingCharactersList(
            characterIds,
            app._mealChoices,
            app._mealSubmissions ?? null,
            {
                getActor: id => game.actors.get(id),
                findOwnerUser: actor => game.users.find(u => !u.isGM && actor.testUserPermission(u, "OWNER")),
                participates: actor => actor.type === "character" && ItemClassifier.participatesInSustenance(actor)
            }
        );

        if (missing.length > 0) {
            const anyPlayer = missing.some(m => m.playerOwned);
            const confirmed = await new Promise(resolve => {
                const overlay = document.createElement("div");
                overlay.classList.add("ionrift-armor-modal-overlay");
                const consequencesText = anyPlayer
                    ? game.i18n.localize("ionrift-respite.mealDelegate.processingConsequencesPlayer")
                    : game.i18n.localize("ionrift-respite.mealDelegate.processingConsequencesStandard");
                overlay.innerHTML = `
                    <div class="ionrift-armor-modal">
                        <h3><i class="fas fa-exclamation-triangle"></i> ${game.i18n.localize("ionrift-respite.mealDelegate.missingCharactersTitle")}</h3>
                        <p>${game.i18n.localize("ionrift-respite.mealDelegate.charactersMissingRations")}</p>
                        <ul>${missing.map(m => {
                            let detail = "";
                            if (m.missingFood && m.missingWater) detail = ` ${game.i18n.localize("ionrift-respite.mealDelegate.noFoodOrWater")}`;
                            else if (m.missingFood) detail = ` ${game.i18n.localize("ionrift-respite.mealDelegate.noFood")}`;
                            else if (m.missingWater) detail = ` ${game.i18n.localize("ionrift-respite.mealDelegate.noWater")}`;
                            const awaiting = m.awaitingPlayer ? ` <span style="opacity:0.6">${game.i18n.localize("ionrift-respite.mealDelegate.awaitingPlayer")}</span>` : "";
                            return `<li>${m.name}${detail}${awaiting}</li>`;
                        }).join("")}</ul>
                        <p>${consequencesText}</p>
                        <div class="ionrift-armor-modal-buttons">
                            <button class="btn-armor-confirm"><i class="fas fa-forward"></i> ${game.i18n.localize("ionrift-respite.mealDelegate.btnProcessAnyway")}</button>
                            <button class="btn-armor-cancel"><i class="fas fa-clock"></i> ${game.i18n.localize("ionrift-respite.mealDelegate.btnGoBack")}</button>
                        </div>
                    </div>`;
                document.body.appendChild(overlay);
                overlay.querySelector(".btn-armor-confirm").addEventListener("click", () => { overlay.remove(); resolve(true); });
                overlay.querySelector(".btn-armor-cancel").addEventListener("click", () => { overlay.remove(); resolve(false); });
            });
            if (!confirmed) return;
        }

        // Spinner while party-wide processing runs (avoids looking hung).
        const procBtn = target?.closest?.("button") ?? null;
        if (procBtn) {
            procBtn.disabled = true;
            procBtn.classList.add("is-processing");
            procBtn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${game.i18n.localize("ionrift-respite.mealDelegate.processingSpinner")}`;
        }

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

        let mealResults = [];
        if (!app._mealProcessed) {
            app._mealProcessed = true;
            try {
                const terrainTag = app._engine?.terrainTag ?? "forest";
                const terrainMealRules = TerrainRegistry.getDefaults(terrainTag)?.mealRules ?? {};
                const totalDays = app._daysSinceLastRest ?? 1;
                const outcome = await MealPhaseHandler.processAndApply(app._mealChoices, totalDays, terrainMealRules);
                mealResults = outcome.results;
                app._mealResults = mealResults;
                app._mealBuffs?.absorb(mealResults);
                Logger.log(`[Respite:Meal] Consumption results:`, mealResults);
            } catch (err) {
                console.error(`[Respite:Meal] Error applying meal choices:`, err);
            }

            app._pendingDehydrationSaves = [];
            for (const r of mealResults) {
                r.mealExhaustionApplied = 0;

                if (r.starvationExhaustion > 0) {
                    const actor = game.actors.get(r.characterId);
                    if (actor) {
                        const adapter = game.ionrift?.respite?.adapter;
                        const current = adapter ? adapter.getExhaustion(actor) : (actor.system?.attributes?.exhaustion ?? 0);
                        const newLevel = Math.min(6, current + r.starvationExhaustion);
                        if (adapter) {
                            await adapter.applyExhaustionDelta(actor, r.starvationExhaustion);
                        } else {
                            if (newLevel > current) {
                                await actor.update({ "system.attributes.exhaustion": newLevel });
                            }
                        }
                        r.mealExhaustionApplied += r.starvationExhaustion;
                        await stampDeprivationExhaustionFloor(actor, newLevel);
                        const starvationMsg = r.starvationExhaustion === 1
                            ? game.i18n.format("ionrift-respite.mealDelegate.starvationExhaustionSingle", { actor: `<strong>${r.actorName}</strong>`, count: `<strong>${r.starvationExhaustion}</strong>` })
                            : game.i18n.format("ionrift-respite.mealDelegate.starvationExhaustionPlural", { actor: `<strong>${r.actorName}</strong>`, count: `<strong>${r.starvationExhaustion}</strong>` });
                        await ChatMessage.create({
                                content: `<div class="respite-recovery-chat">${starvationMsg}</div>`,
                                speaker: ChatMessage.getSpeaker({ actor })
                            });
                        app._pendingDehydrationSaves.push({
                            characterId: r.characterId,
                            actorName: r.actorName,
                            dc: 0,
                            resolved: true,
                            passed: false,
                            total: 0,
                            reason: game.i18n.format("ionrift-respite.mealDelegate.reasonStarvation", { count: r.starvationExhaustion })
                        });
                    }
                }
            }

            for (const r of mealResults) {
                if (r.dehydrationAutoFail) {
                    const actor = game.actors.get(r.characterId);
                    if (actor) {
                        const adapter = game.ionrift?.respite?.adapter;
                        const current = adapter ? adapter.getExhaustion(actor) : (actor.system?.attributes?.exhaustion ?? 0);
                        const newLevel = Math.min(6, current + 1);
                        if (adapter) {
                            await adapter.applyExhaustionDelta(actor, 1);
                        } else {
                            if (newLevel > current) {
                                await actor.update({ "system.attributes.exhaustion": newLevel });
                            }
                        }
                        r.mealExhaustionApplied = (r.mealExhaustionApplied ?? 0) + 1;
                        await stampDeprivationExhaustionFloor(actor, newLevel);
                        await ChatMessage.create({
                            content: `<div class="respite-recovery-chat">${game.i18n.format("ionrift-respite.mealDelegate.dehydrationAutoFailExhaustion", { actor: `<strong>${r.actorName}</strong>` })}</div>`,
                            speaker: ChatMessage.getSpeaker({ actor })
                        });
                        app._pendingDehydrationSaves.push({
                            characterId: r.characterId,
                            actorName: r.actorName,
                            dc: 0,
                            resolved: true,
                            passed: false,
                            total: 0,
                            reason: game.i18n.localize("ionrift-respite.mealDelegate.reasonDehydrationLessHalf")
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
                        emitSocketMessage({
                            type: "dehydrationSaveRequest",
                            characterId: r.characterId,
                            actorName: r.actorName,
                            dc: r.dehydrationSaveDC,
                            targetUserId: ownerUser.id
                        });
                        Logger.log(`[Respite:Meal] Sent dehydration save request for ${r.actorName} to user ${ownerUser.name}`);
                    } else {
                        const saveAdapter = game.ionrift?.respite?.adapter;
                        const conSave = saveAdapter ? saveAdapter.getSaveBonus(actor, "con") : (() => {
                            const conMod = actor.system?.abilities?.con?.mod ?? 0;
                            const profBonus = actor.system?.abilities?.con?.save ? (actor.system?.attributes?.prof ?? 0) : 0;
                            return conMod + profBonus;
                        })();
                        const rollExpr = conSave >= 0 ? `1d20 + ${conSave}` : `1d20 - ${Math.abs(conSave)}`;
                        const roll = await new Roll(rollExpr).evaluate();
                        const total = roll.total;
                        const passed = isPf2eSystem(saveAdapter)
                            ? ["success", "critSuccess"].includes(evaluatePf2eSaveDegree(getNatD20FromRoll(roll), total, r.dehydrationSaveDC))
                            : (total >= r.dehydrationSaveDC);

                        await presentRoll(roll);
                        if (!passed) {
                            const current = saveAdapter ? saveAdapter.getExhaustion(actor) : (actor.system?.attributes?.exhaustion ?? 0);
                            const newLevel = Math.min(6, current + 1);
                            if (saveAdapter) {
                                await saveAdapter.applyExhaustionDelta(actor, 1);
                            } else {
                                if (newLevel > current) {
                                    await actor.update({ "system.attributes.exhaustion": newLevel });
                                }
                            }
                            r.mealExhaustionApplied = (r.mealExhaustionApplied ?? 0) + 1;
                            await stampDeprivationExhaustionFloor(actor, newLevel);
                            await ChatMessage.create({
                                content: `<div class="respite-recovery-chat">${game.i18n.format("ionrift-respite.mealDelegate.dehydrationConSaveFailed", { actor: `<strong>${r.actorName}</strong>`, total, dc: r.dehydrationSaveDC })}</div>`,
                                speaker: ChatMessage.getSpeaker({ actor })
                            });
                            if (app._restLedger) {
                                app._restLedger.add({
                                    phase: "meal",
                                    category: "exhaustion",
                                    icon: "fas fa-tired",
                                    actor: r.characterId,
                                    actorName: r.actorName ?? "",
                                    summary: game.i18n.localize("ionrift-respite.mealDelegate.plusOneExhaustion"),
                                    detail: game.i18n.format("ionrift-respite.mealDelegate.detailFailedConSave", { total, dc: r.dehydrationSaveDC })
                                });
                            }
                        } else {
                            await ChatMessage.create({
                                content: `<div class="respite-recovery-chat">${game.i18n.format("ionrift-respite.mealDelegate.dehydrationConSavePassed", { actor: `<strong>${r.actorName}</strong>`, total, dc: r.dehydrationSaveDC })}</div>`,
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
            emitSocketMessage({
                type: "dehydrationResultsBroadcast",
                results: allResults
            });
        }

        if (app._pendingDehydrationSaves?.length > 0) {
            const allResolved = app._pendingDehydrationSaves.every(s => s.resolved);
            if (!allResolved) {
                Logger.log(`[Respite:Meal] Waiting for dehydration save(s) to resolve...`);
                ui.notifications.info(game.i18n.localize("ionrift-respite.mealDelegate.waitingForDehydrationSavesBeforeProceeding"));
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

    // Reflection phase skipped (v2.1); advance straight to events.
        await app._applyBeddingDown();
        Logger.log(`[Respite:Meal] Reflection skipped, advancing to events`);
        await app._mealBuffs.continueAfterMeals();
    }

        async onSkipPendingSaves(_event, _target) {
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
                const mr = app._mealResults?.find(r => r.characterId === save.characterId);
                if (mr) mr.mealExhaustionApplied = (mr.mealExhaustionApplied ?? 0) + 1;
                await ChatMessage.create({
                    content: `<div class="respite-recovery-chat">${game.i18n.format("ionrift-respite.mealDelegate.dehydrationConSaveSkipped", { actor: `<strong>${save.actorName}</strong>` })}</div>`,
                    speaker: ChatMessage.getSpeaker({ actor })
                });
                if (app._restLedger) {
                    app._restLedger.add({
                        phase: "meal",
                        category: "exhaustion",
                        icon: "fas fa-tired",
                        actor: save.characterId,
                        actorName: save.actorName ?? "",
                        summary: game.i18n.localize("ionrift-respite.mealDelegate.plusOneExhaustion"),
                        detail: game.i18n.localize("ionrift-respite.mealDelegate.detailGmSkippedSave")
                    });
                }
            }

            save.resolved = true;
            save.passed = false;
            save.total = 0;
            save.reason = game.i18n.localize("ionrift-respite.mealDelegate.reasonGmSkipped");
        }

        const allResults = app._pendingDehydrationSaves.map(s => ({
            actorName: s.actorName,
            total: s.total ?? 0,
            passed: s.passed ?? false,
            dc: s.dc ?? 0,
            reason: s.reason ?? null,
            pending: !s.resolved
        }));
        emitSocketMessage({
            type: "dehydrationResultsBroadcast",
            results: allResults
        });

        await app._saveRestState();
        app.render();
        ui.notifications.info(game.i18n.format("ionrift-respite.mealDelegate.skippedPendingSaves", { count: unresolved.length }));
    }

        async receiveMealChoices(userId, choices) {
        if (!game.user.isGM) return;
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

        Logger.log(`[Respite:Meal] Received meal choices from user ${userId}:`, choices);
        await app._saveRestState();
        const snapshot = app.getRestSnapshot?.();
        if (snapshot) {
            emitSocketMessage({ type: "restSnapshot", snapshot });
        }
        app.render();
        if (typeof app._updateRestBarProgress === "function") app._updateRestBarProgress();
        if (typeof app._refreshStationOverlayMeals === "function") app._refreshStationOverlayMeals();
    }

        async receiveMealDayConsumeRequest(userId, consumeByCharacter) {
        if (!game.user.isGM) return;
        const app = this._app;
        if (!consumeByCharacter || typeof consumeByCharacter !== "object") return;
        if (!app._mealChoices) app._mealChoices = new Map();

        const requestingUser = game.users.get(userId);
        for (const [charId, pack] of Object.entries(consumeByCharacter)) {
            const actor = game.actors.get(charId);
            if (!actor) continue;
            if (requestingUser && !requestingUser.isGM) {
                if (!actor.testUserPermission(requestingUser, CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER)) {
                    console.warn(`[Respite:Meal] mealDayConsumeRequest rejected: ${charId} not owned by user ${userId}`);
                    continue;
                }
            }

            const food = Array.isArray(pack.food) ? [...pack.food] : [];
            const water = Array.isArray(pack.water) ? [...pack.water] : [];

            // Snapshot food items before consumption for Well Fed resolution
            const foodSnapshots = new Map();
            for (const itemId of food) {
                if (itemId && itemId !== "skip") {
                    const item = actor.items.get(itemId);
                    if (item) foodSnapshots.set(itemId, item.toObject(false));
                }
            }

            const partyIds = [...(app._mealChoices?.keys() ?? [])];
            const drinkSnapshots = new Map();
            for (const itemId of water) {
                if (itemId && itemId !== "skip") {
                    const item = actor.items.get(itemId);
                    if (item) drinkSnapshots.set(itemId, item.toObject(false));
                }
            }
            for (const itemId of food) {
                if (itemId && itemId !== "skip") {
                    const consumed = await MealPhaseHandler._consumeItem(actor, itemId, 1);
                    const snapshot = foodSnapshots.get(itemId);
                    if (snapshot && consumed > 0) {
                        app._mealBuffQueue = enqueueProvision(app._mealBuffQueue, snapshot, {
                            actorId: charId, actorName: actor.name, kind: "food", partyIds
                        });
                    }
                }
            }
            for (const itemId of water) {
                if (itemId && itemId !== "skip") {
                    const consumed = await MealPhaseHandler._consumeItem(actor, itemId, 1);
                    const snapshot = drinkSnapshots.get(itemId);
                    if (snapshot && consumed > 0) {
                        app._mealBuffQueue = enqueueProvision(app._mealBuffQueue, snapshot, {
                            actorId: charId, actorName: actor.name, kind: "drink", partyIds
                        });
                    }
                }
            }

            const consumedDays = [...(pack.consumedDays ?? [])];
            consumedDays.push({ food, water, itemsConsumed: true });
            const priorDay = pack.currentDay ?? (pack.consumedDays?.length ?? 0);
            app._mealChoices.set(charId, {
                food: [],
                water: [],
                consumedDays,
                currentDay: priorDay + 1
            });
        }

        await app._saveRestState();

        emitSocketMessage({
            type: "mealDayConsumed",
            userId,
            mealChoices: Object.fromEntries(app._mealChoices)
        });

        const snapshot = app.getRestSnapshot?.();
        if (snapshot) {
            emitSocketMessage({ type: "restSnapshot", snapshot });
        }

        app.render();
        if (typeof app._updateRestBarProgress === "function") app._updateRestBarProgress();
        if (typeof app._refreshStationOverlayMeals === "function") app._refreshStationOverlayMeals();
    }

    async receiveMealDayConsumed(...args) { return MealDragAndAutoMethods.receiveMealDayConsumed.apply(this, args); }
    _bindMealDragDrop(...args) { return MealDragAndAutoMethods._bindMealDragDrop.apply(this, args); }
    async _autoProcessRations(...args) { return MealDragAndAutoMethods._autoProcessRations.apply(this, args); }
    async _advanceToEvents(...args) { return MealDragAndAutoMethods._advanceToEvents.apply(this, args); }
}