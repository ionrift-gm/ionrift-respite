import { isStationLayerActive, refreshStationEmptyNoticeFade } from "../../../services/camp/props/StationInteractionLayer.js";
import { normalizeRecipeOutputImg } from "../../../services/crafting/recipes/RecipeIcons.js";
import { GrantLedger } from "../../../services/crafting/outcomes/GrantLedger.js";
import { MealPhaseHandler } from "../../../services/meal/phase/MealPhaseHandler.js";
import { getFoodBuffPartyActors, getMealEligiblePartyActors } from "../../../services/party/partyActors.js";
import { ItemClassifier } from "../../../services/party/ItemClassifier.js";
import { emitFeastServeRequest } from "../../../services/socket/SocketController.js";
import { TerrainRegistry } from "../../../services/events/resolve/TerrainRegistry.js";
import { refreshGmRestIndicator } from "../../../services/ui/sheet/RejoinManager.js";
import { Logger } from "../../../utils/Logger.js";
import { MODULE_ID } from "../../../data/moduleId.js";

export class CraftingDelegate {

    constructor(app) {
        this._app = app;
    }

        buildContext() {
        const app = this._app;
        if (!app._craftingDrawerOpen || !app._craftingDrawerProfession) return null;

        const charId = app._selectedCharacterId;
        const actor = charId ? game.actors.get(charId) : null;
        if (!actor) return null;

        const professionId = app._craftingDrawerProfession;
        const professionLabels = {
            cooking: "Cooking", alchemy: "Alchemy",
            smithing: "Smithing", leatherworking: "Leatherworking",
            brewing: "Brewing", tailoring: "Tailoring"
        };

        const terrainTag = app._engine?.terrainTag ?? app._restData?.terrainTag ?? null;
        const status = app._craftingEngine.getRecipeStatus(actor, professionId, terrainTag);

        const enrichRecipe = (recipe) => {
            const adjustedDc = app._craftingEngine.getAdjustedCraftingDc(
                actor, recipe, app._craftingDrawerRisk, terrainTag
            );
            return {
                ...recipe,
                dcDisplay: adjustedDc,
                outputName: recipe.output?.name ?? "Unknown",
                outputImg: normalizeRecipeOutputImg(recipe.output?.img, "icons/svg/mystery-man.svg"),
                ambitiousOutput: recipe.ambitiousOutput,
                isSelected: recipe.id === app._craftingDrawerRecipeId,
                ingredientList: (recipe.ingredients ?? []).map(ing => {
                    const detail = recipe.ingredientStatus?.details?.find(d => d.name === ing.name);
                    return {
                        name: ing.name,
                        required: ing.quantity ?? 1,
                        available: detail?.available ?? 0,
                        met: detail?.met ?? false
                    };
                })
            };
        };

        const available = status.available.map(r => enrichRecipe(r));
        const partial = status.partial.map(r => enrichRecipe(r));
        const selectedRecipe = available.find(r => r.id === app._craftingDrawerRecipeId);

        let commitSummary = null;
        if (selectedRecipe && !app._craftingDrawerHasCrafted) {
            const adjustedDc = app._craftingEngine.getAdjustedCraftingDc(
                actor, selectedRecipe, app._craftingDrawerRisk, terrainTag
            );
            const outputForRisk = app._craftingDrawerRisk === "ambitious" && selectedRecipe.ambitiousOutput
                ? selectedRecipe.ambitiousOutput
                : selectedRecipe.output;

            commitSummary = {
                recipeName: selectedRecipe.name,
                dc: adjustedDc,
                risk: app._craftingDrawerRisk,
                riskLabel: { safe: "Safe", standard: "Standard", ambitious: "Ambitious" }[app._craftingDrawerRisk],
                outputName: outputForRisk?.name ?? selectedRecipe.outputName,
                outputQuantity: outputForRisk?.quantity ?? 1,
                ingredientCost: (selectedRecipe.ingredients ?? []).map(i => `${i.quantity ?? 1}x ${i.name}`).join(", "),
                failConsequence: app._craftingDrawerRisk === "safe"
                    ? "Ingredients preserved on failure"
                    : "Ingredients consumed on failure",
                skill: (selectedRecipe.skill ?? "sur").toUpperCase()
            };
        }

        return {
            isOpen: true,
            profession: professionLabels[professionId] ?? professionId,
            professionId,
            actorName: actor.name,
            selectedRisk: app._craftingDrawerRisk,
            selectedRecipeId: app._craftingDrawerRecipeId,
            hasCrafted: app._craftingDrawerHasCrafted,
            showMissing: app._craftingDrawerShowMissing,
            riskTiers: [
                { id: "safe", label: "Safe", hint: "DC -3, ingredients preserved on failure", selected: app._craftingDrawerRisk === "safe" },
                { id: "standard", label: "Standard", hint: "Base DC, ingredients consumed", selected: app._craftingDrawerRisk === "standard" },
                { id: "ambitious", label: "Ambitious", hint: "DC +5, enhanced output on success", selected: app._craftingDrawerRisk === "ambitious" }
            ],
            available,
            partial,
            commitSummary,
            craftingResult: app._craftingDrawerResult
        };
    }

    onSelectRecipe(event, target) {
        if (this._app._craftingDrawerHasCrafted) return;
        this._app._craftingDrawerRecipeId = target.dataset.recipeId;
        this._app.render();
    }

    onSelectRisk(event, target) {
        if (this._app._craftingDrawerHasCrafted) return;
        this._app._craftingDrawerRisk = target.dataset.risk;
        this._app.render();
    }

    async onCraft(event, target) {
        const app = this._app;
        if (app._craftingDrawerHasCrafted || !app._craftingDrawerRecipeId) return;

        const charId = app._selectedCharacterId;
        const actor = charId ? game.actors.get(charId) : null;
        if (!actor) return;

        const terrainTag = app._engine?.terrainTag ?? app._restData?.terrainTag ?? null;
        const partySize = app._craftingEngine.getRecipePartySize(app._craftingDrawerRecipeId, app._craftingDrawerProfession);
        app._craftingDrawerResult = await app._craftingEngine.resolve(
            actor, app._craftingDrawerRecipeId, app._craftingDrawerProfession, app._craftingDrawerRisk, terrainTag,
            partySize, { ledger: app._grantLedger }
        );
        app._craftingDrawerHasCrafted = true;
        app.render();
    }

    onToggleMissing(event, target) {
        this._app._craftingDrawerShowMissing = !this._app._craftingDrawerShowMissing;
        this._app.render();
    }

    onClose(event, target) {
        const app = this._app;
        const characterId = app._selectedCharacterId;
        const profession = app._craftingDrawerProfession;
        const result = app._craftingDrawerResult;

        app._craftingInProgress?.delete(characterId);
        app._craftingDrawerOpen = false;

        if (app._craftingDrawerHasCrafted && result) {
            app._craftingResults.set(characterId, result);

            const craftingActivity = (app._activities ?? []).find(a => a.crafting?.profession === profession);
            if (craftingActivity) {
                if (app._isGM) {
                    app._gmOverrides.set(characterId, craftingActivity.id);
                    app._rebuildCharacterChoices();

                    const submissions = {};
                    for (const [charId, actId] of app._characterChoices) {
                        const act = app._activities?.find(a => a.id === actId);
                        submissions[charId] = { activityId: actId, activityName: act?.name ?? actId, source: app._gmOverrides.has(charId) ? "gm" : "player" };
                    }
                    game.socket.emit(`module.${MODULE_ID}`, { type: "submissionUpdate", submissions });
                } else {
                    app._characterChoices.set(characterId, craftingActivity.id);
                    app._lockedCharacters = app._lockedCharacters ?? new Set();
                    app._lockedCharacters.add(characterId);

                    game.socket.emit(`module.${MODULE_ID}`, {
                        type: "activityChoice",
                        userId: game.user.id,
                        choices: Object.fromEntries(app._characterChoices),
                        craftingResults: { [characterId]: result }
                    });
                    const actor = game.actors.get(characterId);
                    if (actor) ui.notifications.info(`${actor.name}'s activity submitted.`);
                    if (app._phase === "activity" && isStationLayerActive()) {
                        app._refreshStationOverlayForFocusChange?.();
                    }
                }
            }
        }

        app.render();
    }

    async commitCraftRoll({ actor, profession, recipeId, risk, restApp = this._app } = {}) {
        return CraftingDelegate.commitCraftRoll({ restApp, actor, profession, recipeId, risk });
    }

    async serveFeastNow({ actor, craftResult, restApp = this._app } = {}) {
        return CraftingDelegate.serveFeastNow({ restApp, actor, craftResult });
    }

    async onTotmCraftCommit() {
        const app = this._app;
        if (app._totmCraftRollPending || app._totmCraftHasCrafted || !app._totmCraftRecipeId) return;
        const expanded = app._totmFollowUpExpanded;
        if (!expanded?.isCrafting) return;

        const actor = game.actors.get(expanded.characterId);
        if (!actor) return;

        app._totmCraftRollPending = true;
        app.render();
        try {
            const { ok, result } = await this.commitCraftRoll({
                actor,
                profession: expanded.profession,
                recipeId: app._totmCraftRecipeId,
                risk: app._totmCraftRisk
            });
            if (ok) {
                app._totmCraftResult = result;
                app._totmCraftHasCrafted = true;
            }
        } finally {
            app._totmCraftRollPending = false;
            app.render();
        }
    }

    async onTotmFeastServeNow() {
        const app = this._app;
        if (app._totmFeastServed || app._totmFeastInFlight) return;
        const craftResult = app._totmCraftResult;
        if (!craftResult?.output) return;

        const expanded = app._totmFollowUpExpanded;
        if (!expanded?.isCrafting) return;
        const actor = game.actors.get(expanded.characterId);
        if (!actor) return;

        app._totmFeastInFlight = true;
        try {
            const { ok } = await this.serveFeastNow({ actor, craftResult });
            if (ok) {
                app._totmFeastServed = true;
                app.render();
            }
        } finally {
            app._totmFeastInFlight = false;
        }
    }

    static async commitCraftRoll({ restApp, actor, profession, recipeId, risk }) {
        if (!restApp || !actor || !profession || !recipeId) {
            return { ok: false, reason: "missing" };
        }

        if (restApp.hasCompletedCrafting?.(actor.id, profession)) {
            ui.notifications.warn(`${actor.name} has already crafted during this rest.`);
            return { ok: false, reason: "already-crafted" };
        }

        const ledger = restApp._grantLedger;
        const slotKey = GrantLedger.craftingSlotKey(actor.id, profession, recipeId);
        if (ledger?.has(slotKey)) {
            ui.notifications.warn("That recipe was already crafted this rest.");
            return { ok: false, reason: "slot-taken" };
        }

        const engine = restApp._craftingEngine;
        if (!engine) return { ok: false, reason: "no-engine" };

        const terrainTag = restApp._engine?.terrainTag ?? restApp._restData?.terrainTag ?? null;
        const partySize = engine.getRecipePartySize(recipeId, profession);
        const result = await engine.resolve(
            actor, recipeId, profession, risk, terrainTag, partySize,
            { ledger }
        );
        return { ok: true, result };
    }

    static async serveFeastNow({ restApp, actor, craftResult }) {
        if (!craftResult?.output || !actor) {
            return { ok: false, reason: "missing" };
        }

        const item = actor.items?.find(i =>
            i.name === craftResult.output?.name
            && i.flags?.[MODULE_ID]?.partyMeal === true
        );
        if (!item) {
            ui.notifications.warn("Could not find the feast item in inventory.");
            return { ok: false, reason: "no-item" };
        }

        const buffPartyIds = getFoodBuffPartyActors().map(a => a.id);
        const satiationPartyIds = getMealEligiblePartyActors()
            .filter(a => ItemClassifier.requiresSustenance(a))
            .map(a => a.id);
        const snapshot = item.toObject(false);

        if (game.user.isGM) {
            await MealPhaseHandler._dispatchWellFedMealServing({
                consumerActor: actor,
                itemSnapshot: snapshot,
                partyIds: buffPartyIds
            });
        } else {
            emitFeastServeRequest({
                cookActorId: actor.id,
                itemSnapshot: snapshot,
                partyIds: buffPartyIds,
                feastMode: "feast"
            });
        }

        const consumed = await MealPhaseHandler._consumeItem(actor, item.id, 1);
        if (consumed < 1) {
            ui.notifications.error("Serving finished but the feast item could not be removed from inventory.");
            return { ok: false, reason: "consume-failed" };
        }
        ui.notifications.info(`${actor.name} serves ${craftResult.output.name} to the party!`);

        if (restApp) {
            const feastFlags = snapshot.flags?.[MODULE_ID] ?? {};
            const satiates = Array.isArray(feastFlags.satiates) ? feastFlags.satiates : [];
            if (satiates.length) {
                CraftingDelegate.creditFeastMealState(restApp, satiationPartyIds, satiates);
            }
        }

        return { ok: true };
    }

    static creditFeastMealState(restApp, partyIds, satiates) {
        if (!restApp) return;
        if (!restApp._mealChoices) restApp._mealChoices = new Map();
        if (!restApp._activityMealRationsSubmitted) restApp._activityMealRationsSubmitted = new Set();

        const terrainTag = restApp._engine?.terrainTag ?? restApp._selectedTerrain ?? "forest";
        const terrainMealRules = TerrainRegistry.getDefaults(terrainTag)?.mealRules ?? {};
        const fpd = terrainMealRules.foodPerDay ?? 1;
        const wpd = terrainMealRules.waterPerDay ?? 2;

        for (const pid of partyIds) {
            const actor = game.actors.get(pid);
            if (!actor || !ItemClassifier.requiresSustenance(actor)) continue;
            if (restApp._activityMealRationsSubmitted.has(pid)) continue;

            const existing = restApp._mealChoices.get(pid) ?? {};

            if (satiates.includes("food")) {
                const foodArr = Array.isArray(existing.food) ? [...existing.food] : [];
                const foodLocked = Array.isArray(existing.foodLockedSlots) ? [...existing.foodLockedSlots] : [];
                for (let i = 0; i < fpd; i++) {
                    if (!foodArr[i] || foodArr[i] === "skip") {
                        foodArr[i] = "__feast_food";
                        if (!foodLocked.includes(i)) foodLocked.push(i);
                    }
                }
                existing.food = foodArr;
                existing.foodLockedSlots = foodLocked;
            }

            if (satiates.includes("water")) {
                const waterArr = Array.isArray(existing.water) ? [...existing.water] : [];
                const waterLocked = Array.isArray(existing.waterLockedSlots) ? [...existing.waterLockedSlots] : [];
                for (let i = 0; i < wpd; i++) {
                    if (!waterArr[i] || waterArr[i] === "skip") {
                        waterArr[i] = "__feast_water";
                        if (!waterLocked.includes(i)) waterLocked.push(i);
                    }
                }
                existing.water = waterArr;
                existing.waterLockedSlots = waterLocked;
            }

            const consumedDays = Array.isArray(existing.consumedDays) ? [...existing.consumedDays] : [];
            consumedDays.push({
                food: [...(existing.food ?? [])],
                water: [...(existing.water ?? [])],
                essence: [...(existing.essence ?? [])]
            });

            restApp._mealChoices.set(pid, {
                ...existing,
                consumedDays,
                currentDay: consumedDays.length,
                food: [],
                water: [],
                essence: existing.essence ?? [],
                itemsConsumed: true,
                foodLockedSlots: existing.foodLockedSlots ?? [],
                waterLockedSlots: existing.waterLockedSlots ?? []
            });

            restApp._activityMealRationsSubmitted.add(pid);
        }

        try {
            if (typeof restApp._saveRestState === "function") restApp._saveRestState();
        } catch (e) { console.warn(`${MODULE_ID} | creditFeastMealState: save failed`, e); }

        restApp._mealSubmitted = true;

        try {
            const snap = typeof restApp.getRestSnapshot === "function" ? restApp.getRestSnapshot() : null;
            if (snap) game.socket.emit(`module.${MODULE_ID}`, { type: "restSnapshot", snapshot: snap });
        } catch (e) { console.warn(`${MODULE_ID} | creditFeastMealState: broadcast failed`, e); }

        Hooks.callAll(`${MODULE_ID}.stationMealChoicesTouched`);
        if (restApp.rendered) restApp.render();
        refreshGmRestIndicator(restApp);
        if (typeof restApp._refreshStationOverlayMeals === "function") restApp._refreshStationOverlayMeals();
        if (isStationLayerActive()) refreshStationEmptyNoticeFade(restApp);
        Logger.log(`${MODULE_ID} | creditFeastMealState: credited ${partyIds.length} party members`, { satiates });
    }
}
