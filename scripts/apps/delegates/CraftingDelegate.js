/**
 * CraftingDelegate.js
 * Handles the inline crafting drawer UI within RestSetupApp.
 * Extracted from RestSetupApp to reduce God Class complexity.
 */

const MODULE_ID = "ionrift-respite";

export class CraftingDelegate {

    /** @param {RestSetupApp} app */
    constructor(app) {
        this._app = app;
    }

    /**
     * Builds the context object for the inline crafting drawer template.
     * Called from _prepareContext() when the drawer is open.
     */
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

        const riskMods = { safe: -3, standard: 0, ambitious: 5 };
        const enrichRecipe = (recipe) => {
            const adjustedDc = (recipe.dc ?? 12) + (riskMods[app._craftingDrawerRisk] ?? 0);
            return {
                ...recipe,
                dcDisplay: adjustedDc,
                outputName: recipe.output?.name ?? "Unknown",
                outputImg: recipe.output?.img ?? "icons/svg/mystery-man.svg",
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
            const adjustedDc = (selectedRecipe.dc ?? 12) + (riskMods[app._craftingDrawerRisk] ?? 0);
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

    // ── Action Handlers ──────────────────────────────────────────────────

    /**
     * Select a recipe in the crafting drawer.
     * Bound as a static action handler in RestSetupApp.PARTS.
     */
    onSelectRecipe(event, target) {
        if (this._app._craftingDrawerHasCrafted) return;
        this._app._craftingDrawerRecipeId = target.dataset.recipeId;
        this._app.render();
    }

    /**
     * Select a risk level in the crafting drawer.
     */
    onSelectRisk(event, target) {
        if (this._app._craftingDrawerHasCrafted) return;
        this._app._craftingDrawerRisk = target.dataset.risk;
        this._app.render();
    }

    /**
     * Execute the craft roll.
     */
    async onCraft(event, target) {
        const app = this._app;
        if (app._craftingDrawerHasCrafted || !app._craftingDrawerRecipeId) return;

        const charId = app._selectedCharacterId;
        const actor = charId ? game.actors.get(charId) : null;
        if (!actor) return;

        const terrainTag = app._engine?.terrainTag ?? app._restData?.terrainTag ?? null;
        app._craftingDrawerResult = await app._craftingEngine.resolve(
            actor, app._craftingDrawerRecipeId, app._craftingDrawerProfession, app._craftingDrawerRisk, terrainTag
        );
        app._craftingDrawerHasCrafted = true;
        app.render();
    }

    /**
     * Toggle visibility of missing-ingredient recipes.
     */
    onToggleMissing(event, target) {
        this._app._craftingDrawerShowMissing = !this._app._craftingDrawerShowMissing;
        this._app.render();
    }

    /**
     * Close the crafting drawer and commit the result.
     */
    onClose(event, target) {
        const app = this._app;
        const characterId = app._selectedCharacterId;
        const profession = app._craftingDrawerProfession;
        const result = app._craftingDrawerResult;

        // Clear crafting-in-progress
        app._craftingInProgress?.delete(characterId);
        app._craftingDrawerOpen = false;

        // If crafting was completed, commit the result
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
                }
            }
        }

        app.render();
    }
}
