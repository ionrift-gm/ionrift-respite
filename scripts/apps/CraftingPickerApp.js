import { CraftingEngine } from "../services/CraftingEngine.js";

const MODULE_ID = "ionrift-respite";
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * CraftingPickerApp
 * Player-facing recipe browser shown when a crafting activity is selected during rest.
 *
 * Flow: Select Recipe → Select Risk → Review Summary → Commit (Craft)
 * One craft attempt per rest, enforced via _hasCrafted flag.
 */
export class CraftingPickerApp extends HandlebarsApplicationMixin(ApplicationV2) {

    static DEFAULT_OPTIONS = {
        id: "ionrift-respite-crafting",
        classes: ["ionrift-window", "glass-ui", "ionrift-crafting-app"],
        window: {
            title: "Respite: Crafting",
            resizable: true
        },
        position: {
            width: 520,
            height: 620
        },
        actions: {
            selectRecipe: CraftingPickerApp.#onSelectRecipe,
            selectRisk: CraftingPickerApp.#onSelectRisk,
            craftRecipe: CraftingPickerApp.#onCraftRecipe,
            toggleMissing: CraftingPickerApp.#onToggleMissing,
            closePicker: CraftingPickerApp.#onClose
        }
    };

    static PARTS = {
        form: { template: `modules/${MODULE_ID}/templates/crafting-picker.hbs` }
    };

    constructor(actor, professionId, engine, onComplete, terrainTag = null) {
        super();
        this._actor = actor;
        this._professionId = professionId;
        this._engine = engine;
        this._onComplete = onComplete;
        this._terrainTag = terrainTag;
        this._selectedRisk = "standard";
        this._selectedRecipeId = null;
        this._craftingResult = null;
        this._hasCrafted = false;
        this._showMissing = false;
    }

    async _prepareContext(options) {
        const status = this._engine.getRecipeStatus(this._actor, this._professionId, this._terrainTag);
        const relevantIngredients = this._getRelevantIngredients(status);

        const professionLabels = {
            cooking: "Cooking", alchemy: "Alchemy",
            smithing: "Smithing", leatherworking: "Leatherworking",
            brewing: "Brewing", tailoring: "Tailoring"
        };

        const available = status.available.map(r => this._enrichRecipe(r));
        const partial = status.partial.map(r => this._enrichRecipe(r));

        // Build the commitment summary if a recipe is selected
        const selectedRecipe = available.find(r => r.id === this._selectedRecipeId);
        let commitSummary = null;
        if (selectedRecipe && !this._hasCrafted) {
            const adjustedDc = this._engine.getAdjustedCraftingDc(
                this._actor, selectedRecipe, this._selectedRisk, this._terrainTag
            );

            // Determine which output to show based on risk
            const outputForRisk = this._selectedRisk === "ambitious" && selectedRecipe.ambitiousOutput
                ? selectedRecipe.ambitiousOutput
                : selectedRecipe.output;

            commitSummary = {
                recipeName: selectedRecipe.name,
                dc: adjustedDc,
                risk: this._selectedRisk,
                riskLabel: { safe: "Safe", standard: "Standard", ambitious: "Ambitious" }[this._selectedRisk],
                outputName: outputForRisk?.name ?? selectedRecipe.outputName,
                outputQuantity: outputForRisk?.quantity ?? 1,
                ingredientCost: (selectedRecipe.ingredients ?? []).map(i => `${i.quantity ?? 1}x ${i.name}`).join(", "),
                failConsequence: this._selectedRisk === "safe"
                    ? "Ingredients preserved on failure"
                    : "Ingredients consumed on failure",
                skill: (selectedRecipe.skill ?? "sur").toUpperCase()
            };
        }

        return {
            actorName: this._actor.name,
            actorImg: this._actor.img,
            profession: professionLabels[this._professionId] ?? this._professionId,
            professionId: this._professionId,
            selectedRisk: this._selectedRisk,
            selectedRecipeId: this._selectedRecipeId,
            hasCrafted: this._hasCrafted,
            showMissing: this._showMissing,
            riskTiers: [
                { id: "safe", label: "Safe", hint: "DC -3, ingredients preserved on failure", selected: this._selectedRisk === "safe" },
                { id: "standard", label: "Standard", hint: "Base DC, ingredients consumed", selected: this._selectedRisk === "standard" },
                { id: "ambitious", label: "Ambitious", hint: "DC +5, enhanced output on success", selected: this._selectedRisk === "ambitious" }
            ],
            available,
            partial,
            ingredients: relevantIngredients,
            commitSummary,
            craftingResult: this._craftingResult
        };
    }

    _enrichRecipe(recipe) {
        const adjustedDc = this._engine.getAdjustedCraftingDc(
            this._actor, recipe, this._selectedRisk, this._terrainTag
        );
        return {
            ...recipe,
            dcDisplay: adjustedDc,
            outputName: recipe.output?.name ?? "Unknown",
            outputImg: recipe.output?.img ?? "icons/svg/mystery-man.svg",
            ambitiousOutput: recipe.ambitiousOutput,
            isSelected: recipe.id === this._selectedRecipeId,
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
    }

    _getRelevantIngredients(status) {
        const allRecipes = [...status.available, ...status.partial, ...status.locked];
        const ingredientNames = new Set();
        for (const recipe of allRecipes) {
            for (const ing of (recipe.ingredients ?? [])) {
                ingredientNames.add(ing.name.toLowerCase().trim());
            }
        }
        const results = [];
        for (const item of this._actor.items) {
            const key = item.name.toLowerCase().trim();
            if (ingredientNames.has(key)) {
                results.push({ name: item.name, img: item.img, quantity: item.system?.quantity ?? 1 });
            }
        }
        return results;
    }

    _onRender(context, options) { }

    // ──────── Actions ────────

    static #onSelectRecipe(event, target) {
        if (this._hasCrafted) return;
        this._selectedRecipeId = target.dataset.recipeId;
        this.render();
    }

    static #onSelectRisk(event, target) {
        if (this._hasCrafted) return;
        this._selectedRisk = target.dataset.risk;
        this.render();
    }

    static async #onCraftRecipe(event, target) {
        if (this._hasCrafted || !this._selectedRecipeId) return;

        this._craftingResult = await this._engine.resolve(
            this._actor, this._selectedRecipeId, this._professionId, this._selectedRisk, this._terrainTag
        );
        this._hasCrafted = true;
        this.render();
    }

    static #onToggleMissing(event, target) {
        this._showMissing = !this._showMissing;
        this.render();
    }

    static #onClose(event, target) {
        // Only fire the completion callback if crafting actually happened
        if (this._hasCrafted && this._onComplete) {
            this._onComplete(this._craftingResult);
        }
        this.close();
    }
}
