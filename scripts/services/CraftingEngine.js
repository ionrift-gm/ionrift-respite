/**
 * CraftingEngine
 * Handles recipe-based crafting during rest activities.
 *
 * Responsibilities:
 * - Load recipe definitions per profession
 * - Scan actor inventory for matching ingredients
 * - Calculate available recipes (what can be made now)
 * - Apply risk tier modifiers to DCs
 * - Resolve crafting attempts (roll, consume ingredients, produce output)
 *
 * Risk Tiers:
 *   safe:      DC -3, produces standard output, no failure consequence
 *   standard:  Base DC, standard output
 *   ambitious:  DC +5, upgraded output on success, ingredient loss on failure
 */

const MODULE_ID = "ionrift-respite";

export class CraftingEngine {

    constructor() {
        /** @type {Map<string, Object[]>} Recipes keyed by profession ID. */
        this.recipes = new Map();
    }

    /**
     * Loads recipe definitions from JSON data.
     * @param {string} professionId - e.g. "cooking", "alchemy"
     * @param {Object[]} recipeData - Array of recipe objects.
     */
    load(professionId, recipeData) {
        this.recipes.set(professionId, recipeData);
    }

    /**
     * Returns all loaded profession IDs.
     * @returns {string[]}
     */
    getProfessions() {
        return [...this.recipes.keys()];
    }

    /**
     * Scans an actor's inventory and returns available recipes for a profession,
     * categorized by what can be crafted now vs what's missing ingredients.
     * @param {Actor} actor
     * @param {string} professionId
     * @param {string} [terrainTag] - Current terrain. Recipes with a `terrains` array
     *        are filtered to only appear in matching terrains. Recipes without the
     *        field are always available.
     * @returns {Object} { available: Recipe[], partial: Recipe[], locked: Recipe[] }
     */
    getRecipeStatus(actor, professionId, terrainTag = null) {
        const allRecipes = this.recipes.get(professionId) ?? [];
        const inventory = this._buildInventoryMap(actor);

        const available = [];
        const partial = [];
        const locked = [];

        for (const recipe of allRecipes) {
            // Terrain filter: if recipe specifies terrains array, current terrain must match
            if (terrainTag && recipe.terrains?.length && !recipe.terrains.includes(terrainTag)) {
                continue; // Silently omit - not available in this terrain
            }

            // Check tool prerequisite
            if (recipe.toolRequired && !this._hasToolProficiency(actor, recipe.toolRequired)) {
                locked.push({ ...recipe, reason: `Requires ${recipe.toolRequired} proficiency` });
                continue;
            }

            // Check ingredients
            const ingredientStatus = this._checkIngredients(recipe.ingredients, inventory);

            if (ingredientStatus.canCraft) {
                available.push({ ...recipe, ingredientStatus });
            } else if (ingredientStatus.hasAny) {
                partial.push({ ...recipe, ingredientStatus });
            } else {
                locked.push({ ...recipe, ingredientStatus, reason: "Missing all ingredients" });
            }
        }

        return { available, partial, locked };
    }

    /**
     * Resolves a crafting attempt.
     * @param {Actor} actor
     * @param {string} recipeId
     * @param {string} professionId
     * @param {string} riskTier - "safe", "standard", "ambitious"
     * @param {string} [terrainTag] - Current terrain for DC modifier and variant output
     * @returns {Object} Crafting result.
     */
    async resolve(actor, recipeId, professionId, riskTier = "standard", terrainTag = null) {
        const allRecipes = this.recipes.get(professionId) ?? [];
        const recipe = allRecipes.find(r => r.id === recipeId);
        if (!recipe) {
            return { success: false, error: "Recipe not found." };
        }

        const inventory = this._buildInventoryMap(actor);
        const ingredientStatus = this._checkIngredients(recipe.ingredients, inventory);
        if (!ingredientStatus.canCraft) {
            return { success: false, error: "Missing ingredients.", ingredientStatus };
        }

        // Calculate DC with risk modifier and terrain modifier
        const riskMods = { safe: -3, standard: 0, ambitious: 5 };
        const baseDc = recipe.dc ?? 12;
        const terrainDcMod = (terrainTag && recipe.terrainDcModifier?.[terrainTag]) ?? 0;
        const adjustedDc = baseDc + (riskMods[riskTier] ?? 0) + terrainDcMod;

        // Roll the skill check
        const skill = recipe.skill ?? "sur";
        const skillData = actor.system?.skills?.[skill];
        const modifier = skillData?.total ?? skillData?.mod ?? 0;
        const roll = await new Roll(`1d20 + ${modifier}`).evaluate();

        await roll.toMessage({
            speaker: ChatMessage.getSpeaker({ actor }),
            flavor: `${recipe.name} (${skill.toUpperCase()}) - DC ${adjustedDc} [${riskTier}]`
        });

        const success = roll.total >= adjustedDc;

        // Consume ingredients (always consumed on standard/ambitious, not on safe failure)
        const consumeIngredients = success || riskTier !== "safe";
        if (consumeIngredients) {
            await this._consumeIngredients(actor, recipe.ingredients);
        }

        if (success) {
            // Determine output based on risk tier, then check terrain variants
            let output = riskTier === "ambitious" && recipe.ambitiousOutput
                ? recipe.ambitiousOutput
                : recipe.output;

            // Apply terrain variant if one exists for this terrain + tier
            if (terrainTag && recipe.terrainVariants?.[terrainTag]) {
                const variant = recipe.terrainVariants[terrainTag];
                const variantOutput = riskTier === "ambitious" && variant.ambitiousOutput
                    ? variant.ambitiousOutput
                    : variant.output;
                if (variantOutput) output = variantOutput;
            }

            // Create the output item on the actor
            const createdItems = await this._createOutputItems(actor, output);

            return {
                success: true,
                recipeId,
                recipeName: recipe.name,
                riskTier,
                roll: roll.total,
                dc: adjustedDc,
                output,
                createdItems,
                ingredientsConsumed: true,
                narrative: recipe.successNarrative ?? `You successfully prepare ${recipe.name}.`
            };
        } else {
            return {
                success: false,
                recipeId,
                recipeName: recipe.name,
                riskTier,
                roll: roll.total,
                dc: adjustedDc,
                ingredientsConsumed: consumeIngredients,
                narrative: riskTier === "safe"
                    ? (recipe.safeFailNarrative ?? "The attempt doesn't quite work, but your ingredients are intact.")
                    : (recipe.failNarrative ?? "The attempt fails. Your ingredients are spent.")
            };
        }
    }

    // ──────── Internal Methods ────────

    /**
     * Builds a name-keyed inventory map with quantities.
     * @param {Actor} actor
     * @returns {Map<string, {item: Item, quantity: number}>}
     */
    _buildInventoryMap(actor) {
        const map = new Map();
        for (const item of actor.items) {
            const key = item.name.toLowerCase().trim();
            if (map.has(key)) {
                map.get(key).quantity += (item.system?.quantity ?? 1);
            } else {
                map.set(key, {
                    item,
                    quantity: item.system?.quantity ?? 1
                });
            }
        }
        return map;
    }

    /**
     * Checks if ingredients are available in the inventory.
     * @param {Object[]} ingredients - [{ name, quantity }]
     * @param {Map} inventory
     * @returns {Object} { canCraft, hasAny, details: [{ name, required, available, met }] }
     */
    _checkIngredients(ingredients, inventory) {
        if (!ingredients?.length) return { canCraft: true, hasAny: true, details: [] };

        let canCraft = true;
        let hasAny = false;
        const details = [];

        for (const ing of ingredients) {
            const key = ing.name.toLowerCase().trim();
            const entry = inventory.get(key);
            const available = entry?.quantity ?? 0;
            const met = available >= (ing.quantity ?? 1);

            if (!met) canCraft = false;
            if (available > 0) hasAny = true;

            details.push({
                name: ing.name,
                required: ing.quantity ?? 1,
                available,
                met
            });
        }

        return { canCraft, hasAny, details };
    }

    /**
     * Consumes ingredients from the actor's inventory.
     * @param {Actor} actor
     * @param {Object[]} ingredients - [{ name, quantity }]
     */
    async _consumeIngredients(actor, ingredients) {
        for (const ing of ingredients) {
            const key = ing.name.toLowerCase().trim();
            const required = ing.quantity ?? 1;
            let remaining = required;

            // Find matching items and reduce quantities
            const matches = actor.items.filter(i => i.name.toLowerCase().trim() === key);
            const updates = [];
            const deletes = [];

            for (const item of matches) {
                if (remaining <= 0) break;
                const qty = item.system?.quantity ?? 1;

                if (qty <= remaining) {
                    deletes.push(item.id);
                    remaining -= qty;
                } else {
                    updates.push({ _id: item.id, "system.quantity": qty - remaining });
                    remaining = 0;
                }
            }

            if (updates.length) await actor.updateEmbeddedDocuments("Item", updates);
            if (deletes.length) await actor.deleteEmbeddedDocuments("Item", deletes);
        }
    }

    /**
     * Creates output items on the actor.
     * @param {Actor} actor
     * @param {Object} output - { name, type, img, quantity, system }
     * @returns {Item[]} Created items.
     */
    async _createOutputItems(actor, output) {
        if (!output) return [];

        const { ItemOutcomeHandler } = await import("./ItemOutcomeHandler.js");
        const grantSummary = await ItemOutcomeHandler.grantItemsToActor(actor, [{
            name: output.name,
            type: output.type ?? "consumable",
            img: output.img ?? "icons/consumables/food/bowl-stew-brown.webp",
            quantity: output.quantity ?? 1,
            system: {
                description: { value: output.description ?? "" },
                rarity: output.rarity ?? "common",
                ...(output.system ?? {})
            }
        }]);

        return grantSummary;
    }

    /**
     * Checks if an actor has access to a specific tool (proficiency or ownership).
     * Checks system.tools entries (value/effectValue) and physical tool items in inventory.
     * @param {Actor} actor
     * @param {string} toolKey - e.g. "cook", "herb", "alchemist"
     * @returns {boolean}
     */
    _hasToolProficiency(actor, toolKey) {
        // Check system.tools proficiency
        const toolData = actor.system?.tools?.[toolKey];
        if ((toolData?.value ?? 0) > 0 || (toolData?.effectValue ?? 0) > 0) return true;

        // Check for physical tool item in inventory
        for (const item of actor.items ?? []) {
            if (item.type !== "tool") continue;
            // Check baseItem key (e.g. "cook" for Cook's Utensils)
            if (item.system?.type?.baseItem === toolKey) return true;
            // Fallback: name match
            const nameLower = item.name.toLowerCase();
            if (nameLower.includes(toolKey)) return true;
        }

        return false;
    }
}
