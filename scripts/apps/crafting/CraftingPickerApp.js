import { CraftingEngine } from "../../services/crafting/engine/CraftingEngine.js";
import { GrantLedger } from "../../services/crafting/outcomes/GrantLedger.js";
import { buildCraftRecipeListContext } from "../../services/crafting/engine/CraftRecipeListBuilder.js";
import { MonstrousFeastBridge } from "../../services/meal/provisions/MonstrousFeastBridge.js";
import { getPartyActors } from "../../services/party/partyActors.js";
import { resolveDefaultCraftRecipeId } from "../../services/crafting/engine/CraftCommitSummary.js";
import { CraftingDelegate } from "../delegates/crafting/CraftingDelegate.js";
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
            title: "Respite: Crafting & Cooking",
            resizable: true
        },
        position: {
            width: 660,
            height: 640
        },
        actions: {
            selectRecipe: CraftingPickerApp.#onSelectRecipe,
            craftSelectRecipe: CraftingPickerApp.#onSelectRecipe,
            selectRisk: CraftingPickerApp.#onSelectRisk,
            craftSelectRisk: CraftingPickerApp.#onSelectRisk,
            craftRecipe: CraftingPickerApp.#onCraftRecipe,
            craftCommit: CraftingPickerApp.#onCraftRecipe,
            toggleMissing: CraftingPickerApp.#onToggleMissing,
            craftToggleMissing: CraftingPickerApp.#onToggleMissing,
            openMonsterCookbook: CraftingPickerApp.#onOpenMonsterCookbook,
            serveFeastNow: CraftingPickerApp.#onServeFeastNow,
            feastServeNow: CraftingPickerApp.#onServeFeastNow,
            closePicker: CraftingPickerApp.#onClose,
            craftClose: CraftingPickerApp.#onClose
        }
    };

    static PARTS = {
        form: { template: `modules/${MODULE_ID}/templates/crafting-picker.hbs` }
    };

    constructor(actor, professionId, engine, onComplete, terrainTag = null, ledger = null, { restApp = null } = {}) {
        super();
        this._actor = actor;
        this._professionId = professionId;
        this._engine = engine;
        this._onComplete = onComplete;
        this._terrainTag = terrainTag;
        this._ledger = ledger;
        this._restApp = restApp;
        this._selectedRisk = "standard";
        this._selectedRecipeId = null;
        this._craftingResult = null;
        this._hasCrafted = ledger?.hasCraftingForActor(actor.id, professionId) ?? false;
        this._showMissing = false;
        this._mfCookCommitted = false;
        this._craftCommitted = false;
        this._feastServed = false;
        this._feastInFlight = false;
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
        if (!this._selectedRecipeId && !this._hasCrafted) {
            let partySize = 1;
            try {
                partySize = getPartyActors?.()?.length ?? 1;
            } catch {
                partySize = 1;
            }
            this._selectedRecipeId = resolveDefaultCraftRecipeId({
                engine: this._engine,
                actor: this._actor,
                profession: this._professionId,
                terrainTag: this._terrainTag,
                partySize,
                currentId: this._selectedRecipeId,
                hasCrafted: false
            });
        }

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

        let craftingResult = this._craftingResult;
        if (craftingResult) {
            const recipe = this._engine?.recipes?.get(this._professionId)?.find(r => r.id === (craftingResult.recipeId ?? this._selectedRecipeId));
            craftingResult = {
                ...craftingResult,
                isPartyMeal: !!(recipe?.isPartyMeal ?? craftingResult.isPartyMeal),
                partyMealDispositionDone: !!this._feastServed || !!craftingResult.partyMealDispositionDone,
                partyRoster: getPartyActors().map(a => ({
                    id: a.id,
                    name: a.name,
                    img: a.img || "icons/svg/mystery-man.svg",
                    alreadyWellFed: a.effects?.some(e => e.flags?.[MODULE_ID]?.wellFed === true) ?? false
                }))
            };
        }

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
            selectedRecipe: list.selectedRecipe,
            noAvailableRecipes: list.noAvailableRecipes,
            commitSummary: list.commitSummary,
            hideRiskTiers: !!list.selectedRecipe?.noSkillCheck,
            craftingResult
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

    _preRender(context, options) {
        const detail = this.element?.querySelector(".crafting-detail-panel");
        this._savedDetailScroll = detail?.scrollTop ?? null;
        const list = this.element?.querySelector(".crafting-list-panel");
        this._savedListScroll = list?.scrollTop ?? null;
    }

    _onRender(context, options) {
        super._onRender(context, options);
        if (this._savedDetailScroll != null) {
            const detail = this.element?.querySelector(".crafting-detail-panel");
            if (detail) detail.scrollTop = this._savedDetailScroll;
        }
        if (this._savedListScroll != null) {
            const list = this.element?.querySelector(".crafting-list-panel");
            if (list) list.scrollTop = this._savedListScroll;
        }
    }

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

        if (this._restApp) {
            if (this._restApp.hasCompletedCrafting?.(this._actor.id) || this._restApp._lockedCharacters?.has(this._actor.id)) {
                ui.notifications.warn("This character has already completed an activity this rest.");
                return;
            }
        }

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
        if (this._craftingResult) {
            const recipe = this._engine.recipes.get(this._professionId)?.find(r => r.id === this._selectedRecipeId);
            this._craftingResult.isPartyMeal = !!recipe?.isPartyMeal;
            this._craftingResult.partyMealDispositionDone = false;
        }
        this._hasCrafted = true;
        this._commitCraftResult();
        this.render();
    }

    static async #onServeFeastNow(event, target) {
        if (this._feastServed || this._feastInFlight) return;
        this._feastInFlight = true;
        try {
            const { ok } = await CraftingDelegate.serveFeastNow({
                restApp: this._restApp,
                actor: this._actor,
                craftResult: this._craftingResult
            });
            if (ok) {
                this._feastServed = true;
                if (this._craftingResult) {
                    this._craftingResult.partyMealDispositionDone = true;
                }
                this.render();
            }
        } finally {
            this._feastInFlight = false;
        }
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
    /**
     * Helper to invoke the completion callback exactly once.
     * @param {object|null} result
     */
    _notifyCompletion(result) {
        if (this._completionReported) return;
        this._completionReported = true;
        if (this._onComplete) {
            this._onComplete(result);
        }
    }

    /**
     * Commits the completed crafting result to the caller (e.g. rest activity flow).
     * Idempotent: fires at most once per picker session.
     */
    _commitCraftResult() {
        if (this._craftCommitted) return;
        if (!this._hasCrafted || !this._craftingResult) return;
        this._craftCommitted = true;
        this._notifyCompletion(this._craftingResult);
    }

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
        this._commitCraftResult();
        await this.close();
    }

    static #onClose(event, target) {
        this._commitCraftResult();
        this.close();
    }

    async close(options = {}) {
        // Safety net: commit crafting result if crafted, or report cancellation if not.
        this._commitCraftResult();
        if (!this._hasCrafted) {
            this._notifyCompletion(null);
        }
        return super.close(options);
    }
}
