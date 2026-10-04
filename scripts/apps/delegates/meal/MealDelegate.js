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
import { CampGearScanner } from "../../../services/camp/gear/CampGearScanner.js";
import { RestLedger } from "../../../services/rest/flow/RestLedger.js";
import { SKILL_NAMES } from "../../../data/RestConstants.js";
import { boostComfort, fireComfortDelta } from "../../../services/camp/gear/ComfortCalculator.js";
import { notifyStationMealChoicesUpdated } from "../../camp/StationActivityDialog.js";
import { isTrailerFilmingMode as _isTrailerFilmingMode } from "../rest/layout/RestWindowLayout.js";
import { emitPhaseChanged } from "../../../services/socket/SocketController.js";
import { RestSetupApp } from "../../rest/RestSetupApp.js";
import { presentRoll } from "/modules/ionrift-library/scripts/services/rolls/DiceSettle.js";

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

    async onConsumeMealDay(event, target) {
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
                    let sats = item.flags?.["ionrift-respite"]?.satiates;
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
            game.socket.emit(`module.${MODULE_ID}`, {
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

        game.socket.emit(`module.${MODULE_ID}`, {
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
                        <h3><i class="fas fa-exclamation-triangle"></i> Skip Meals?</h3>
                        <p>The following meals are empty:</p>
                        <ul>${skippedSlots.map(s => `<li>${s}</li>`).join("")}</ul>
                        <p>Skipping meals has consequences.</p>
                        <div class="ionrift-armor-modal-buttons">
                            <button class="btn-armor-confirm"><i class="fas fa-check"></i> Skip Meals</button>
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

        game.socket.emit(`module.${MODULE_ID}`, {
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
        ui.notifications.info("Meal choices submitted.");
    }

        async onSubmitMealChoices(event, target) {
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

        game.socket.emit(`module.${MODULE_ID}`, {
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
        ui.notifications.info("Meal choices submitted.");
    }

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
                overlay.innerHTML = `
                    <div class="ionrift-armor-modal">
                        <h3><i class="fas fa-exclamation-triangle"></i> Characters Without Rations</h3>
                        <p>These characters are missing rations:</p>
                        <ul>${missing.map(m => {
                            let detail = "";
                            if (m.missingFood && m.missingWater) detail = " (no food or water)";
                            else if (m.missingFood) detail = " (no food)";
                            else if (m.missingWater) detail = " (no water)";
                            const awaiting = m.awaitingPlayer ? ' <span style="opacity:0.6">(awaiting player)</span>' : "";
                            return `<li>${m.name}${detail}${awaiting}</li>`;
                        }).join("")}</ul>
                        <p>Processing now treats them as skipping all meals${anyPlayer ? ", even if a player is still choosing" : ""}, applying any starvation and dehydration.</p>
                        <div class="ionrift-armor-modal-buttons">
                            <button class="btn-armor-confirm"><i class="fas fa-forward"></i> Process Anyway</button>
                            <button class="btn-armor-cancel"><i class="fas fa-clock"></i> Go Back</button>
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
            procBtn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Processing...`;
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
                            content: `<div class="respite-recovery-chat"><strong>${r.actorName}</strong> gains 1 level of exhaustion from dehydration (less than half the day's water).</div>`,
                            speaker: ChatMessage.getSpeaker({ actor })
                        });
                        app._pendingDehydrationSaves.push({
                            characterId: r.characterId,
                            actorName: r.actorName,
                            dc: 0,
                            resolved: true,
                            passed: false,
                            total: 0,
                            reason: "dehydration, less than half the day's water"
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
                        Logger.log(`[Respite:Meal] Sent dehydration save request for ${r.actorName} to user ${ownerUser.name}`);
                    } else {
                        const saveAdapter = game.ionrift?.respite?.adapter;
                        const conSave = saveAdapter ? saveAdapter.getSaveBonus(actor, "con") : (() => {
                            const conMod = actor.system?.abilities?.con?.mod ?? 0;
                            const profBonus = actor.system?.abilities?.con?.save ? (actor.system?.attributes?.prof ?? 0) : 0;
                            return conMod + profBonus;
                        })();
                        const roll = await new Roll(`1d20 + ${conSave}`).evaluate();
                        const total = roll.total;
                        const passed = total >= r.dehydrationSaveDC;

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
                                content: `<div class="respite-recovery-chat"><strong>${r.actorName}</strong> fails the CON save (${total} vs DC ${r.dehydrationSaveDC}) and gains 1 level of exhaustion from dehydration.</div>`,
                                speaker: ChatMessage.getSpeaker({ actor })
                            });
                            if (app._restLedger) {
                                app._restLedger.add({
                                    phase: "meal",
                                    category: "exhaustion",
                                    icon: "fas fa-tired",
                                    actor: r.characterId,
                                    actorName: r.actorName ?? "",
                                    summary: "+1 exhaustion",
                                    detail: `Failed CON save (${total} vs DC ${r.dehydrationSaveDC}), dehydration`
                                });
                            }
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

        if (app._pendingDehydrationSaves?.length > 0) {
            const allResolved = app._pendingDehydrationSaves.every(s => s.resolved);
            if (!allResolved) {
                Logger.log(`[Respite:Meal] Waiting for dehydration save(s) to resolve...`);
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

    // Reflection phase skipped (v2.1); advance straight to events.
        await app._applyBeddingDown();
        Logger.log(`[Respite:Meal] Reflection skipped, advancing to events`);
        await app._mealBuffs.continueAfterMeals();
    }

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
                const mr = app._mealResults?.find(r => r.characterId === save.characterId);
                if (mr) mr.mealExhaustionApplied = (mr.mealExhaustionApplied ?? 0) + 1;
                await ChatMessage.create({
                    content: `<div class="respite-recovery-chat"><strong>${save.actorName}</strong> fails the CON save (skipped by GM) and gains 1 level of exhaustion from dehydration.</div>`,
                    speaker: ChatMessage.getSpeaker({ actor })
                });
                if (app._restLedger) {
                    app._restLedger.add({
                        phase: "meal",
                        category: "exhaustion",
                        icon: "fas fa-tired",
                        actor: save.characterId,
                        actorName: save.actorName ?? "",
                        summary: "+1 exhaustion",
                        detail: "Dehydration (GM skipped save)"
                    });
                }
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
            game.socket.emit(`module.${MODULE_ID}`, { type: "restSnapshot", snapshot });
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

        game.socket.emit(`module.${MODULE_ID}`, {
            type: "mealDayConsumed",
            userId,
            mealChoices: Object.fromEntries(app._mealChoices)
        });

        const snapshot = app.getRestSnapshot?.();
        if (snapshot) {
            game.socket.emit(`module.${MODULE_ID}`, { type: "restSnapshot", snapshot });
        }

        app.render();
        if (typeof app._updateRestBarProgress === "function") app._updateRestBarProgress();
        if (typeof app._refreshStationOverlayMeals === "function") app._refreshStationOverlayMeals();
    }

    async receiveMealDayConsumed(userId, clientChoices) {
        if (!game.user.isGM) return;
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

        Logger.log(`[Respite:Meal] Received meal day consumed from user ${userId}:`, clientChoices);
        await app._saveRestState();
        app.render();
    }

        async receiveDehydrationPrompt(characterId, actorName, dc) {
        if (game.user.isGM) return;
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
                const playerSaveAdapter = game.ionrift?.respite?.adapter;
                const playerConSave = playerSaveAdapter ? playerSaveAdapter.getSaveBonus(actor, "con") : (() => {
                    const conMod = actor.system?.abilities?.con?.mod ?? 0;
                    const profBonus = actor.system?.abilities?.con?.save ? (actor.system?.attributes?.prof ?? 0) : 0;
                    return conMod + profBonus;
                })();
                const roll = await new Roll(`1d20 + ${playerConSave}`).evaluate();
                total = roll.total;
                passed = total >= dc;

                await presentRoll(roll);
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

        async receiveDehydrationResult(data) {
        if (!game.user.isGM) return;
        const app = this._app;
        const { characterId, actorName, dc, total, passed } = data;
        const actor = game.actors.get(characterId);

        if (!passed && actor) {
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
            const mr = app._mealResults?.find(r => r.characterId === characterId);
            if (mr) mr.mealExhaustionApplied = (mr.mealExhaustionApplied ?? 0) + 1;
            await stampDeprivationExhaustionFloor(actor, newLevel);
            await ChatMessage.create({
                content: `<div class="respite-recovery-chat"><strong>${actorName}</strong> fails the CON save (${total} vs DC ${dc}) and gains 1 level of exhaustion from dehydration.</div>`,
                speaker: ChatMessage.getSpeaker({ actor })
            });
            if (app._restLedger) {
                app._restLedger.add({
                    phase: "meal",
                    category: "exhaustion",
                    icon: "fas fa-tired",
                    actor: characterId,
                    actorName: actorName ?? "",
                    summary: "+1 exhaustion",
                    detail: `Failed CON save (${total} vs DC ${dc}), dehydration`
                });
                app._refreshLedgerApp?.();
            }
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
    _bindMealDragDrop(el) {
        const app = this._app;

        if (!el) return;
        if (app._mealSubmitted) return; // Lock UI after submission

        const stationEmbed = el?.closest?.(".station-meal-embed");
        if (stationEmbed) {
            const cid = stationEmbed.querySelector(".meal-drop-zone[data-character-id]")?.dataset?.characterId
                ?? stationEmbed.querySelector("[data-character-id]")?.dataset?.characterId;
            if (cid && app._activityMealRationsSubmitted?.has(cid)) return;
        }

        // Clear any stuck drag classes from previous render cycles or cancelled drags
        el.querySelectorAll(".dragging").forEach(n => n.classList.remove("dragging"));
        el.querySelectorAll(".drop-hover").forEach(n => n.classList.remove("drop-hover"));

        const items = el.querySelectorAll(".meal-inv-item[draggable], .meal-inv-card[draggable]");
        const dropZones = el.querySelectorAll(".meal-drop-zone");

        // Helper: set choice for a slot (both food and water are arrays)
        const setChoice = (charId, slot, itemId, slotIndex) => {
            if (!app._mealChoices) app._mealChoices = new Map();
            const existing = app._mealChoices.get(charId) ?? {};
            const arr = Array.isArray(existing[slot]) ? [...existing[slot]] : [];

            // Respect inventory-consumed locked slots
            const lockedKey = slot === "food" ? "foodLockedSlots" : "waterLockedSlots";
            const lockedSlots = Array.isArray(existing[lockedKey]) ? existing[lockedKey] : [];
            if (slotIndex !== undefined && lockedSlots.includes(slotIndex)) return;

            const trayItem = el.querySelector(
                `.meal-inv-item[data-item-id="${itemId}"][data-slot="${slot}"][data-character-id="${charId}"],` +
                `.meal-inv-card[data-item-id="${itemId}"][data-slot="${slot}"][data-character-id="${charId}"]`
            );
            const available = trayItem ? parseInt(trayItem.dataset.available || "1") : 1;
            const alreadyAssigned = arr.filter(v => v === itemId).length;

            // If assigning to a specific slot that already has this item, it's a re-assign (allow)
            const isReassign = slotIndex !== undefined && arr[slotIndex] === itemId;
            if (!isReassign && alreadyAssigned >= available) {
                ui.notifications.warn(`Not enough ${slot === "food" ? "rations" : "water"} to fill another slot.`);
                return;
            }

            if (slotIndex !== undefined) {
                arr[slotIndex] = itemId;
            } else {
                // Fill first empty AND unlocked slot
                const emptyIdx = arr.findIndex((v, i) => (!v || v === "skip") && !lockedSlots.includes(i));
                if (emptyIdx >= 0) {
                    arr[emptyIdx] = itemId;
                } else {
                    arr.push(itemId);
                }
            }
            app._mealChoices.set(charId, { ...existing, [slot]: arr });
            // When food with satiates:water is placed, trim excess water entries
            if (slot === "food") app._autoTrimExcessWater(charId);
            notifyStationMealChoicesUpdated();
            app._refreshStationOverlayMeals();
            if (app.rendered) app.render();
        };

        const fillWaterPool = (charId, itemId, elRoot) => {
            if (!app._mealChoices) app._mealChoices = new Map();
            const existing = app._mealChoices.get(charId) ?? {};
            const arr = Array.isArray(existing.water) ? [...existing.water] : [];
            const lockedSlots = Array.isArray(existing.waterLockedSlots) ? existing.waterLockedSlots : [];

            const poolBar = elRoot.querySelector(".water-pool-bar");
            const wpd = parseInt(poolBar?.dataset?.target ?? "2", 10) || 0;
            while (arr.length < wpd) arr.push("skip");

            // Account for meal-based water credits from food slots
            const foodArr = Array.isArray(existing.food) ? existing.food : [];
            const satiatesLookup = app._buildSatiatesLookup();
            let bonusWater = 0;
            const actor = game.actors.get(charId);
            for (const fid of foodArr) {
                if (!fid || fid === "skip" || fid.startsWith?.("__")) continue;
                const fItem = actor?.items?.get(fid);
                if (!fItem) continue;
                const fFlags = fItem.flags?.[MODULE_ID] ?? {};
                let fSat = fFlags.satiates;
                if (!Array.isArray(fSat) && satiatesLookup) {
                    fSat = satiatesLookup.get(fItem.name.toLowerCase().trim()) ?? null;
                }
                if (Array.isArray(fSat) && fSat.includes("water")) bonusWater++;
            }

            let slotsNeeded = 0;
            for (let i = 0; i < wpd; i++) {
                if (lockedSlots.includes(i)) continue;
                const v = arr[i];
                if (!v || v === "skip") slotsNeeded++;
            }
            // Subtract bonus water from meal credits
            slotsNeeded = Math.max(0, slotsNeeded - bonusWater);
            if (slotsNeeded <= 0) {
                ui.notifications.info("Water is already sufficient.");
                return;
            }

            const trayCard = elRoot.querySelector(
                `.meal-inv-card[data-item-id="${itemId}"][data-slot="water"][data-character-id="${charId}"]`
            );
            let totalPints = parseInt(trayCard?.dataset?.totalPints ?? trayCard?.dataset?.available ?? "0", 10);
            if (!Number.isFinite(totalPints) || totalPints < 0) totalPints = 0;
            if (totalPints <= 0) {
                ui.notifications.warn("This water source is empty.");
                return;
            }

            const pintsToFill = Math.min(slotsNeeded, totalPints);
            for (let i = 0; i < pintsToFill; i++) {
                const emptyIdx = arr.findIndex((v, j) =>
                    j < wpd && (!v || v === "skip") && !lockedSlots.includes(j));
                if (emptyIdx >= 0) arr[emptyIdx] = itemId;
                else break;
            }
            app._mealChoices.set(charId, { ...existing, water: arr });
            notifyStationMealChoicesUpdated();
            app._refreshStationOverlayMeals();
            if (app.rendered) app.render();
        };

        // Draggable + clickable inventory items
        for (const item of items) {
            if (item._mealBound) continue;
            item._mealBound = true;
            item.addEventListener("dragstart", (e) => {
                e.dataTransfer.setData("text/plain", `meal:${item.dataset.slot}:${item.dataset.itemId}:${item.dataset.characterId}`);
                item.classList.add("dragging");
            });
            item.addEventListener("dragend", () => item.classList.remove("dragging"));

            // Click to select
            item.addEventListener("click", () => {
                const slot = item.dataset.slot;
                const charId = item.dataset.characterId;
                const itemId = item.dataset.itemId;
                if (!slot || !charId || !itemId) return;
                if (slot === "water") {
                    fillWaterPool(charId, itemId, el);
                    return;
                }
                setChoice(charId, slot, itemId);
            });
        }

        // Drop zones (plates and goblets)
        for (const zone of dropZones) {
            if (zone._mealBound) continue;
            zone._mealBound = true;

            // Slots consumed from inventory are locked ,  no interaction allowed
            if (zone.dataset.locked === "true") continue;

            const slot = zone.dataset.slot;
            const charId = zone.dataset.characterId;
            const slotIndex = zone.dataset.slotIndex !== undefined ? parseInt(zone.dataset.slotIndex) : undefined;

            zone.addEventListener("dragover", (e) => {
                if (slot === "water" && zone.dataset.poolFull === "true") return;
                if (!e.dataTransfer.types.includes("text/plain")) return;
                e.preventDefault();
                zone.classList.add("drop-hover");
            });

            zone.addEventListener("dragleave", (e) => {
                if (zone.contains(e.relatedTarget)) return;
                zone.classList.remove("drop-hover");
            });

            zone.addEventListener("drop", (e) => {
                e.preventDefault();
                zone.classList.remove("drop-hover");
                if (slot === "water" && zone.dataset.poolFull === "true") return;
                const raw = e.dataTransfer.getData("text/plain");
                if (!raw?.startsWith("meal:")) return;

                const [, dragSlot, itemId, dragCharId] = raw.split(":");
                if (dragSlot !== slot || dragCharId !== charId) return;
                if (slot === "water") {
                    fillWaterPool(charId, itemId, el);
                    return;
                }
                setChoice(charId, slot, itemId, slotIndex);
            });

            // Click on filled zone = clear it
            zone.addEventListener("click", () => {
                if (!app._mealChoices) return;
                if (slot === "water") {
                    const existing = app._mealChoices.get(charId) ?? {};
                    const lockedSlots = Array.isArray(existing.waterLockedSlots) ? existing.waterLockedSlots : [];
                    const prev = Array.isArray(existing.water) ? existing.water : [];
                    const poolBar = el.querySelector(".water-pool-bar");
                    const wpd = parseInt(poolBar?.dataset?.target ?? "2", 10) || 0;
                    const len = Math.max(wpd, prev.length);
                    const arr = [];
                    for (let i = 0; i < len; i++) {
                        arr[i] = lockedSlots.includes(i) ? prev[i] : "skip";
                    }
                    app._mealChoices.set(charId, { ...existing, water: arr });
                    notifyStationMealChoicesUpdated();
                    app._refreshStationOverlayMeals();
                    if (app.rendered) app.render();
                    return;
                }
                const existing = app._mealChoices.get(charId) ?? {};
                const arr = Array.isArray(existing[slot]) ? [...existing[slot]] : [];
                if (slotIndex !== undefined && arr[slotIndex] && arr[slotIndex] !== "skip") {
                    arr[slotIndex] = "skip";
                    app._mealChoices.set(charId, { ...existing, [slot]: arr });
                    notifyStationMealChoicesUpdated();
                    app._refreshStationOverlayMeals();
                    if (app.rendered) app.render();
                }
            });
        }
    
    }

    async _autoProcessRations() {
        const app = this._app;

        const rosterIds = new Set(getPartyActors().map(a => a.id));
        const characterIds = app._engine?.characterChoices
            ? Array.from(app._engine.characterChoices.keys()).filter(id => rosterIds.has(id))
            : [];

        if (!app._mealChoices) app._mealChoices = new Map();

        const terrainTag = app._engine?.terrainTag ?? "forest";
        const terrainMealRules = TerrainRegistry.getDefaults(terrainTag)?.mealRules ?? {};
        const totalDays = app._daysSinceLastRest ?? 1;

        for (const charId of characterIds) {
            if (!app._mealChoices.has(charId)) {
                const cards = MealPhaseHandler.buildMealContext(
                    [charId], terrainTag, terrainMealRules,
                    totalDays, app._mealChoices
                );
                if (cards.length > 0) {
                    app._mealChoices.set(charId, {
                        food: cards[0].selectedFood,
                        water: cards[0].selectedWater
                    });
                }
            }
        }

        if (!app._spoilageProcessed) {
            app._spoilageProcessed = true;
            try {
                await MealPhaseHandler.resolveSpoilage(characterIds, totalDays);
            } catch (err) {

                console.error(`[Respite:Meal] Auto-process spoilage error:`, err);
            }
        }

        let mealResults = [];
        if (!app._mealProcessed) {
            app._mealProcessed = true;
            try {
                const outcome = await MealPhaseHandler.processAndApply(app._mealChoices, totalDays, terrainMealRules);
                mealResults = outcome.results;
                app._mealResults = mealResults;
                app._mealBuffs?.absorb(mealResults);
        Logger.log(`[Respite:Meal] Auto-process consumption results:`, mealResults);
            } catch (err) {

                console.error(`[Respite:Meal] Auto-process consumption error:`, err);
            }

            for (const r of mealResults) {
                r.mealExhaustionApplied = 0;

                if (r.starvationExhaustion > 0) {
                    const actor = game.actors.get(r.characterId);
                    if (!actor) continue;
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
                    await ChatMessage.create({
                        content: `<div class="respite-recovery-chat"><strong>${r.actorName}</strong> gains <strong>${r.starvationExhaustion}</strong> level${r.starvationExhaustion > 1 ? "s" : ""} of exhaustion from starvation.</div>`,
                        speaker: ChatMessage.getSpeaker({ actor })
                    });
                }
                if ((r.essenceExhaustion ?? 0) > 0) {
                    const actor = game.actors.get(r.characterId);
                    if (!actor) continue;
                    const adapter = game.ionrift?.respite?.adapter;
                    const current = adapter ? adapter.getExhaustion(actor) : (actor.system?.attributes?.exhaustion ?? 0);
                    const newLevel = Math.min(6, current + r.essenceExhaustion);
                    if (adapter) {
                        await adapter.applyExhaustionDelta(actor, r.essenceExhaustion);
                    } else {
                        if (newLevel > current) {
                            await actor.update({ "system.attributes.exhaustion": newLevel });
                        }
                    }
                    r.mealExhaustionApplied += r.essenceExhaustion;
                    await stampDeprivationExhaustionFloor(actor, newLevel);
                    await ChatMessage.create({
                        content: `<div class="respite-recovery-chat"><strong>${r.actorName}</strong> gains <strong>${r.essenceExhaustion}</strong> level${r.essenceExhaustion > 1 ? "s" : ""} of exhaustion from essence depletion.</div>`,
                        speaker: ChatMessage.getSpeaker({ actor })
                    });
                }

                if (r.dehydrationAutoFail) {
                    const actor = game.actors.get(r.characterId);
                    if (!actor) continue;
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
                    r.mealExhaustionApplied += 1;
                    await stampDeprivationExhaustionFloor(actor, newLevel);
                    await ChatMessage.create({
                        content: `<div class="respite-recovery-chat"><strong>${r.actorName}</strong> gains 1 level of exhaustion from dehydration (less than half the day's water).</div>`,
                        speaker: ChatMessage.getSpeaker({ actor })
                    });
                } else if (r.dehydrationSaveDC > 0) {
                    const actor = game.actors.get(r.characterId);
                    if (!actor) continue;
                    const _adapter = game.ionrift?.respite?.adapter;
                    const saveBonus = _adapter
                        ? _adapter.getSaveBonus(actor, "con")
                        : (() => {
                            const conMod = actor.system?.abilities?.con?.mod ?? 0;
                            const profBonus = actor.system?.abilities?.con?.save
                                ? (actor.system?.attributes?.prof ?? 0) : 0;
                            return conMod + profBonus;
                        })();
                    const roll = await new Roll(`1d20 + ${saveBonus}`).evaluate();
                    await presentRoll(roll);
                    if (roll.total < r.dehydrationSaveDC) {
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
                        r.mealExhaustionApplied += 1;
                        await stampDeprivationExhaustionFloor(actor, newLevel);
                        await ChatMessage.create({
                            content: `<div class="respite-recovery-chat"><strong>${r.actorName}</strong> fails the CON save (${roll.total} vs DC ${r.dehydrationSaveDC}) and gains 1 level of exhaustion from dehydration.</div>`,
                            speaker: ChatMessage.getSpeaker({ actor })
                        });
                    } else {
                        await ChatMessage.create({
                            content: `<div class="respite-recovery-chat"><strong>${r.actorName}</strong> passes the CON save (${roll.total} vs DC ${r.dehydrationSaveDC}) and fights off dehydration.</div>`,
                            speaker: ChatMessage.getSpeaker({ actor })
                        });
                    }
                }
            }
        }
    
    }

    async _advanceToEvents() {
        const app = this._app;

        if (app._phase === "activity") {
            void app._detectMagic?.cleanupCastArtifactsOnPhaseExit(getPartyActors());
        }
        // Bedding / Zzz persist through events until resolve or encounter interrupt.

        // Restore default window size and center on screen so the full events
        // header is visible regardless of how the user moved the window.
        if (!_isTrailerFilmingMode() && app.element) {
            const defaultWidth = RestSetupApp.DEFAULT_OPTIONS.position?.width ?? 720;
            app.setPosition({
                width: defaultWidth,
                left: Math.max(8, Math.round((window.innerWidth - defaultWidth) / 2))
            });
        }

        if (app._engine?.safeRestSpot) {
            if (app._engine) {
                app._engine.fireRollModifier = 0;
                app._engine.fireLevel = "campfire";
            }
            app._fireLevel = "campfire";
            app._closeCampfire();
            app._triggeredEvents = [];
            app._eventsRolled = true;
            app._pendingCampRolls = [];
            await app._saveRestState();
            await this._app._resolve.onResolveEvents(null, null);
            return;
        }

        const fireLevelForComfort = (app._coldCampDecided && (app._fireLevel ?? "unlit") === "unlit")
            ? "cold_camp"
            : (app._fireLevel ?? "unlit");
        const fireComfortMod = fireComfortDelta(fireLevelForComfort);
        if (fireComfortMod !== 0 && app._engine) {
            app._engine.comfort = boostComfort(app._engine.comfort, fireComfortMod);
        }

        if (app._engine) {
            app._engine.fireRollModifier = CampGearScanner.FIRE_ENCOUNTER_MOD_BY_LEVEL[app._fireLevel] ?? 0;
            app._engine.fireLevel = app._fireLevel;
        }

        app._closeCampfire();

        if (app._mealResults?.length) {
            for (const r of app._mealResults) {
                const entry = RestLedger.formatMealEntry(r);
                if (entry) app._restLedger.add(entry);
            }
            for (const r of app._mealResults) {
                const exhEntry = RestLedger.formatMealExhaustionEntry(r);
                if (exhEntry) app._restLedger.add(exhEntry);
            }
            app._refreshLedgerApp();
        }

        app._eventsRolled = false;
        app._phase = "events";
        app._eventPoolQuietNightBypass = false;

        app._pendingCampRolls = [];
        const allActivities = app._activities ?? [];
        const partyActors = getPartyActors();

        for (const actor of partyActors) {
            const gmOverride = app._gmOverrides.get(actor.id);
            const playerChoice = app._getPlayerChoiceForCharacter(actor.id);
            const activityId = gmOverride ?? playerChoice?.activityId ?? null;
            if (!activityId) continue;

            const activity = allActivities.find(a => a.id === activityId);
            if (!activity) continue;

            if (!activity.check) {
                // Keep Watch / Rest Fully: no check, auto-resolve immediately
                app._earlyResults.set(actor.id, {
                    source: "activity",
                    activityId,
                    result: "success",
                    effects: activity.outcomes?.success?.effects ?? [],
                    narrative: activity.outcomes?.success?.narrative ?? activity.description
                });
                continue;
            }

            const existingResult = app._earlyResults?.get(actor.id);
            if (existingResult && existingResult.activityId === activityId
                && existingResult.result !== "pending_approval") {
                continue;
            }

            // Training and multi-roll activities are tracked separately
            if ((activity.check.rolls ?? 1) > 1) continue;

            // Activity needs a player roll (Set Up Defenses, Forage, Hunt, Fletch, Tell Tales, Pray, etc.)
            const followUpValue = app._gmFollowUps?.get(actor.id) ?? app._getFollowUpForCharacter?.(actor.id);
            const safeRestSpot = !!(app._engine?.safeRestSpot ?? app._restData?.safeRestSpot);
            const comfort = app._engine?.comfort ?? app._restData?.comfort ?? "rough";
            const checkDetails = app._activityResolver?.getCheckDetails?.(activityId, actor, comfort, {
                followUpValue,
                safeRestSpot
            });

            const adjustedDc = checkDetails?.adjustedDc ?? ((activity.check.dc ?? 12) + ({ safe: 0, sheltered: 0, rough: 2, hostile: 5 }[comfort] ?? 0));
            const skillKey = checkDetails?.key ?? activity.check.skill ?? "wis";
            const skillName = SKILL_NAMES[skillKey] ?? (checkDetails?.rollLabel ?? skillKey);

            app._pendingCampRolls.push({
                characterId: actor.id,
                characterName: actor.name,
                activityId,
                activityName: activity.name,
                icon: activity.icon ?? (activity.id === "act_defenses" ? "fas fa-shield-alt" : "fas fa-dice-d20"),
                skill: skillKey,
                skillName,
                dc: adjustedDc,
                baseDC: adjustedDc,
                requested: false,
                status: "pending",
                total: null,
                result: null
            });
        }

        await app._saveRestState();

        const effectiveDC = app._engine?.getEffectiveEncounterDC?.({ earlyResults: app._earlyResults }) ?? 0;
        if (effectiveDC > 0) {
            const bd = app._engine?._encounterBreakdown ?? {};
            const modParts = [];
            if (bd.shelter) modParts.push(`Shelter +${bd.shelter}`);
            if (bd.weather) modParts.push(`Weather +${bd.weather}`);
            app._restLedger.add({
                phase: "events", category: "night_check", icon: "fas fa-dice-d20",
                summary: `Night check threshold: ${effectiveDC}`,
                detail: modParts.length ? modParts.join(", ") : ""
            });
            app._refreshLedgerApp();
        }

        emitPhaseChanged("events", {
                eventsRolled: false,
                fireLevel: app._fireLevel,
                campStatus: app._campStatus
            });

        app.render();
    
    }

}
