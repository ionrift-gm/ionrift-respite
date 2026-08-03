import { CraftingEngine } from "../../services/crafting/engine/CraftingEngine.js";
import { GrantLedger } from "../../services/crafting/outcomes/GrantLedger.js";
import { buildCraftRecipeListContext } from "../../services/crafting/engine/CraftRecipeListBuilder.js";
import { MonstrousFeastBridge } from "../../services/meal/provisions/MonstrousFeastBridge.js";
import { MODULE_ID } from "../../data/moduleId.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * CraftingPickerApp
 * Player-facing recipe browser shown when a crafting activity is selected during rest.
 *
 * Flow: Select Recipe ,  Select Risk ,  Review Summary ,  Commit (Craft)
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
            openMonsterCookbook: CraftingPickerApp.#onOpenMonsterCookbook,
            closePicker: CraftingPickerApp.#onClose
        }
    };

    static PARTS = {
        form: { template: `modules/${MODULE_ID}/templates/crafting-picker.hbs` }
    };

    constructor(actor, professionId, engine, onComplete, terrainTag = null, ledger = null) {
        super();
        this._actor = actor;
        this._professionId = professionId;
        this._engine = engine;
        this._onComplete = onComplete;
        this._terrainTag = terrainTag;
        this._ledger = ledger;
        this._selectedRisk = "standard";
        this._selectedRecipeId = null;
        this._craftingResult = null;
        this._hasCrafted = ledger?.hasCraftingForActor(actor.id, professionId) ?? false;
        this._showMissing = false;
        this._mfCookCommitted = false;
    }

    /**
     * Whether the optional Monstrous Feast cookbook should be offered here.
     * Surfaced only for cooking, only before a craft resolves, and only when
     * Monstrous Feast is installed and exposes its stable cooking entry. Native
     * Respite cooking stays available and remains the default either way.
     * @returns {boolean}
     */
    _isMonsterCookbookAvailable() {
        return this._professionId === "cooking"
            && !this._hasCrafted
            && MonstrousFeastBridge.ownsCooking();
    }

    async _prepareContext(options) {
        const status = this._engine.getRecipeStatus(this._actor, this._professionId, this._terrainTag);
        const relevantIngredients = this._getRelevantIngredients(status);
        const list = buildCraftRecipeListContext({
            engine: this._engine,
            actor: this._actor,
            professionId: this._professionId,
            risk: this._selectedRisk,
            terrainTag: this._terrainTag,
            selectedRecipeId: this._selectedRecipeId,
            hasCrafted: this._hasCrafted
        });

        return {
            actorName: this._actor.name,
            actorImg: this._actor.img,
            profession: list.profession,
            professionId: this._professionId,
            selectedRisk: this._selectedRisk,
            selectedRecipeId: this._selectedRecipeId,
            hasCrafted: this._hasCrafted,
            showMissing: this._showMissing,
            mfCookbookAvailable: this._isMonsterCookbookAvailable(),
            riskTiers: [
                { id: "safe", label: "Safe", hint: "DC -3 · Ingredients kept", selected: this._selectedRisk === "safe" },
                { id: "standard", label: "Standard", hint: "Base DC · Ingredients used", selected: this._selectedRisk === "standard" },
                { id: "ambitious", label: "Ambitious", hint: "DC +5 · Better yield", selected: this._selectedRisk === "ambitious" }
            ],
            available: list.available,
            missing: list.missing,
            partial: list.partial,
            ingredients: relevantIngredients,
            commitSummary: list.commitSummary,
            craftingResult: this._craftingResult
        };
    }

    _getRelevantIngredients(status) {
        const allRecipes = [...(status.available ?? []), ...(status.partial ?? []), ...(status.locked ?? [])];
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

        const slotKey = this._ledger
            ? GrantLedger.craftingSlotKey(this._actor.id, this._professionId, this._selectedRecipeId)
            : null;
        if (this._ledger && slotKey && this._ledger.has(slotKey)) {
            ui.notifications.warn("That recipe was already crafted this rest.");
            return;
        }

        const partySize = this._engine.getRecipePartySize(this._selectedRecipeId, this._professionId);
        this._craftingResult = await this._engine.resolve(
            this._actor, this._selectedRecipeId, this._professionId, this._selectedRisk, this._terrainTag,
            partySize, { ledger: this._ledger }
        );
        this._hasCrafted = true;
        this.render();
    }

    static #onToggleMissing(event, target) {
        this._showMissing = !this._showMissing;
        this.render();
    }

    static #onOpenMonsterCookbook(event, target) {
        this._openMonsterCookbook();
    }

    /**
     * Open the Monstrous Feast cookbook as an optional alternative to Respite's
     * native cooking. The picker stays open, so the player can cancel the
     * cookbook and pick a recipe instead without spending anything. A completed
     * cook calls back into {@link _onMonstrousFeastCookCompleted}, which records
     * the rest's cooking activity. Surfaced only when Monstrous Feast is present.
     * @returns {boolean} true when the cookbook opened.
     */
    _openMonsterCookbook() {
        const opened = MonstrousFeastBridge.openCooking(this._actor, {
            onCooked: () => { void this._onMonstrousFeastCookCompleted(); }
        });
        if (!opened) {
            ui.notifications.warn("The Monster Cooking book is not available right now.");
        }
        return opened;
    }

    /**
     * Record a completed Monstrous Feast cook as this character's cooking
     * activity for the rest, then close the picker. Routes through the same
     * completion callback the native craft uses, so the choice is recorded as
     * the cooking activity (act_cook). Idempotent: a cook fires once, and
     * cancelling the cookbook never reaches here, so it spends nothing.
     */
    async _onMonstrousFeastCookCompleted() {
        if (this._mfCookCommitted) return;
        this._mfCookCommitted = true;
        this._hasCrafted = true;
        this._craftingResult = {
            success: true,
            narrative: "Cooked from the Monster Cookbook.",
            recipeId: null,
            monstrousFeast: true,
            ingredientsConsumed: true
        };
        if (this._onComplete) this._onComplete(this._craftingResult);
        await this.close();
    }

    static #onClose(event, target) {
        // Only fire the completion callback if crafting actually happened
        if (this._hasCrafted && this._onComplete) {
            this._onComplete(this._craftingResult);
        }
        this.close();
    }
}
