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

import { waitForDiceSoNice } from "./RollRequestManager.js";
import { SpoilageClock } from "./SpoilageClock.js";
import { ItemClassifier } from "./ItemClassifier.js";

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
     * @param {Actor} actor
     * @returns {boolean}
     */
    static _hasChefFeat(actor) {
        return actor?.items?.some(i =>
            i.type === "feat" && i.name?.toLowerCase() === "chef"
        ) ?? false;
    }

    /**
     * DC used for the crafting check and UI (risk tier, terrain, Chef feat -2).
     * @param {Actor} actor
     * @param {Object} recipe
     * @param {string} [riskTier]
     * @param {string|null} [terrainTag]
     * @returns {number}
     */
    getAdjustedCraftingDc(actor, recipe, riskTier = "standard", terrainTag = null) {
        return this.getDcBreakdown(actor, recipe, riskTier, terrainTag).total;
    }

    /**
     * Returns the contributing factors that make up the crafting DC.
     * @param {Actor} actor
     * @param {Object} recipe
     * @param {string} [riskTier]
     * @param {string|null} [terrainTag]
     * @returns {{ base: number, total: number, hasModifiers: boolean, factors: { label: string, value: number, sign: "pos"|"neg" }[] }}
     */
    getDcBreakdown(actor, recipe, riskTier = "standard", terrainTag = null) {
        const riskMods = { safe: -3, standard: 0, ambitious: 5 };
        const base = recipe.dc ?? 12;
        const riskMod = riskMods[riskTier] ?? 0;
        const terrainMod = (terrainTag && recipe.terrainDcModifier?.[terrainTag]) ?? 0;
        const chefMod = CraftingEngine._hasChefFeat(actor) ? -2 : 0;

        const factors = [];
        if (riskMod !== 0) {
            const label = riskTier.charAt(0).toUpperCase() + riskTier.slice(1);
            factors.push({ label: `${riskMod > 0 ? "+" : ""}${riskMod} ${label}`, value: riskMod, sign: riskMod > 0 ? "pos" : "neg" });
        }
        if (terrainMod !== 0) {
            const tLabel = terrainTag ? terrainTag.charAt(0).toUpperCase() + terrainTag.slice(1) : "Terrain";
            factors.push({ label: `${terrainMod > 0 ? "+" : ""}${terrainMod} ${tLabel}`, value: terrainMod, sign: terrainMod > 0 ? "pos" : "neg" });
        }
        if (chefMod !== 0) {
            factors.push({ label: `${chefMod} Chef`, value: chefMod, sign: "neg" });
        }

        return {
            base,
            total: base + riskMod + terrainMod + chefMod,
            hasModifiers: factors.length > 0,
            factors
        };
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
    getRecipeStatus(actor, professionId, terrainTag = null, partySize = 1) {
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
            const ingredientStatus = this._checkIngredients(recipe.ingredients, inventory, partySize, actor);

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
    async resolve(actor, recipeId, professionId, riskTier = "standard", terrainTag = null, partySize = 1) {
        const allRecipes = this.recipes.get(professionId) ?? [];
        const recipe = allRecipes.find(r => r.id === recipeId);
        if (!recipe) {
            return { success: false, error: "Recipe not found." };
        }

        const inventory = this._buildInventoryMap(actor);
        const ingredientStatus = this._checkIngredients(recipe.ingredients, inventory, partySize, actor);
        if (!ingredientStatus.canCraft) {
            return { success: false, error: "Missing ingredients.", ingredientStatus };
        }

        const adjustedDc = this.getAdjustedCraftingDc(actor, recipe, riskTier, terrainTag);

        // Roll the skill check
        const skill = recipe.skill ?? "sur";
        const skillData = actor.system?.skills?.[skill];
        const modifier = skillData?.total ?? skillData?.mod ?? 0;
        const roll = await new Roll(`1d20 + ${modifier}`).evaluate();

        const naturalRoll = roll.dice[0]?.results?.[0]?.result;
        const useAmbitiousOutput = Boolean(
            recipe.ambitiousOutput
            && (riskTier === "ambitious"
                || (CraftingEngine._hasChefFeat(actor) && naturalRoll === 20))
        );

        await roll.toMessage({
            speaker: ChatMessage.getSpeaker({ actor }),
            flavor: `${recipe.name} (${skill.toUpperCase()}) - DC ${adjustedDc} [${riskTier}]`
        });

        await waitForDiceSoNice();

        const success = roll.total >= adjustedDc;

        // Consume ingredients (always consumed on standard/ambitious, not on safe failure)
        const consumeIngredients = success || riskTier !== "safe";
        if (consumeIngredients) {
            await this._consumeIngredients(actor, recipe.ingredients, partySize);
        }

        if (success) {
            // Output tier: chosen ambitious, or Chef feat natural 20 upgrade
            let output = useAmbitiousOutput
                ? recipe.ambitiousOutput
                : recipe.output;

            // Apply terrain variant if one exists for this terrain + tier
            if (terrainTag && recipe.terrainVariants?.[terrainTag]) {
                const variant = recipe.terrainVariants[terrainTag];
                const variantOutput = useAmbitiousOutput && variant.ambitiousOutput
                    ? variant.ambitiousOutput
                    : variant.output;
                if (variantOutput) output = variantOutput;
            }

            const outputFlags = useAmbitiousOutput
                ? (recipe.ambitiousOutputFlags ?? recipe.outputFlags)
                : recipe.outputFlags;

            // Create the output item on the actor
            const createdItems = await this._createOutputItems(actor, output, outputFlags);

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
     * @param {Object[]} ingredients - [{ name, quantity, perPartyMember?, resourceType? }]
     * @param {Map} inventory - Name-keyed inventory map from _buildInventoryMap
     * @param {number} [partySize]
     * @param {Actor} [actor] - Required when any ingredient uses resourceType
     * @returns {Object} { canCraft, hasAny, details: [{ name, required, available, met }] }
     */
    _checkIngredients(ingredients, inventory, partySize = 1, actor = null) {
        if (!ingredients?.length) return { canCraft: true, hasAny: true, details: [] };

        let canCraft = true;
        let hasAny = false;
        const details = [];

        for (const ing of ingredients) {
            const effectiveQty = (ing.quantity ?? 1) * (ing.perPartyMember ? Math.max(1, partySize - 2) : 1);
            let available;

            if (ing.resourceType === "water" && actor) {
                available = this._countWaterPints(actor);
            } else {
                const key = ing.name.toLowerCase().trim();
                const entry = inventory.get(key);
                available = entry?.quantity ?? 0;
            }

            const met = available >= effectiveQty;
            if (!met) canCraft = false;
            if (available > 0) hasAny = true;

            details.push({
                name: ing.name,
                required: effectiveQty,
                available,
                met
            });
        }

        return { canCraft, hasAny, details };
    }

    /**
     * Count total available water pints across all water items in inventory.
     * Items with use-charges (waterskins): remaining charges per unit, summed.
     * Items without charges: quantity treated as 1 pint each.
     * @param {Actor} actor
     * @returns {number}
     */
    _countWaterPints(actor) {
        let total = 0;
        for (const item of actor.items) {
            if (!ItemClassifier.isWater(item, actor)) continue;
            const qty = item.system?.quantity ?? 1;
            if (qty <= 0) continue;
            const uses = item.system?.uses;
            if (uses && uses.max > 0) {
                const isV5 = ("spent" in uses);
                const chargesPerUnit = isV5 ? (uses.max - (uses.spent ?? 0)) : (uses.value ?? 0);
                total += chargesPerUnit + ((qty - 1) * uses.max);
            } else {
                total += qty;
            }
        }
        return total;
    }

    /**
     * Consumes ingredients from the actor's inventory.
     * @param {Actor} actor
     * @param {Object[]} ingredients - [{ name, quantity, perPartyMember?, resourceType? }]
     * @param {number} [partySize] - Current party size for perPartyMember scaling
     */
    async _consumeIngredients(actor, ingredients, partySize = 1) {
        for (const ing of ingredients) {
            const required = (ing.quantity ?? 1) * (ing.perPartyMember ? Math.max(1, partySize - 2) : 1);

            if (ing.resourceType === "water") {
                await this._consumeWaterPints(actor, required);
                continue;
            }

            const key = ing.name.toLowerCase().trim();
            let remaining = required;

            const matches = actor.items.filter(i => i.name.toLowerCase().trim() === key);
            matches.sort((a, b) => {
                const ka = SpoilageClock.getConsumeSortKey(a);
                const kb = SpoilageClock.getConsumeSortKey(b);
                if (ka !== kb) return ka - kb;
                return String(a.id).localeCompare(String(b.id));
            });
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
     * Consume water pints from any water items.
     * Prefers depleting charges on multi-use items first, then qty-only items.
     * @param {Actor} actor
     * @param {number} pints - Number of pints to consume
     */
    async _consumeWaterPints(actor, pints) {
        let remaining = pints;
        const waterItems = actor.items.filter(i => ItemClassifier.isWater(i, actor) && (i.system?.quantity ?? 0) > 0);

        waterItems.sort((a, b) => {
            const ka = SpoilageClock.getConsumeSortKey(a);
            const kb = SpoilageClock.getConsumeSortKey(b);
            if (ka !== kb) return ka - kb;
            return String(a.id).localeCompare(String(b.id));
        });

        const chargeItems = waterItems.filter(i => i.system?.uses?.max > 0);
        const qtyOnlyItems = waterItems.filter(i => !(i.system?.uses?.max > 0));

        const updates = [];
        const deletes = [];

        for (const item of chargeItems) {
            if (remaining <= 0) break;
            const qty = item.system?.quantity ?? 1;
            const uses = item.system.uses;
            const isV5 = ("spent" in uses);
            const chargesRemaining = isV5 ? (uses.max - (uses.spent ?? 0)) : (uses.value ?? 0);
            const totalPints = chargesRemaining + ((qty - 1) * uses.max);

            if (totalPints <= remaining) {
                deletes.push(item.id);
                remaining -= totalPints;
            } else {
                let pintsToConsume = remaining;
                let currentCharges = chargesRemaining;
                let currentQty = qty;

                while (pintsToConsume > 0 && currentQty > 0) {
                    if (currentCharges > 0) {
                        const take = Math.min(pintsToConsume, currentCharges);
                        currentCharges -= take;
                        pintsToConsume -= take;
                    }
                    if (currentCharges <= 0 && pintsToConsume > 0) {
                        currentQty--;
                        currentCharges = currentQty > 0 ? uses.max : 0;
                    } else if (currentCharges <= 0 && currentQty > 1) {
                        currentQty--;
                        currentCharges = uses.max;
                    } else {
                        break;
                    }
                }

                if (currentQty <= 0) {
                    deletes.push(item.id);
                } else {
                    const update = { _id: item.id, "system.quantity": currentQty };
                    if (isV5) {
                        update["system.uses.spent"] = uses.max - currentCharges;
                    } else {
                        update["system.uses.value"] = currentCharges;
                    }
                    updates.push(update);
                }
                remaining = pintsToConsume;
            }
        }

        for (const item of qtyOnlyItems) {
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

    /**
     * Creates output items on the actor.
     * @param {Actor} actor
     * @param {Object} output - { name, type, img, quantity, system }
     * @param {Object} [outputFlags] - Optional Foundry flags object (e.g. recipe.outputFlags)
     * @returns {Item[]} Created items.
     */
    async _createOutputItems(actor, output, outputFlags) {
        if (!output) return [];

        const { ItemOutcomeHandler } = await import("./ItemOutcomeHandler.js");

        const itemRef = output.itemRef ?? outputFlags?.[MODULE_ID]?.itemRef;

        const grantFromResolved = async (ref) => {
            const resolved = await ItemOutcomeHandler._resolveItemRef({ itemRef: ref });
            if (!resolved) return null;
            const qty = output.quantity ?? 1;
            const grant = {
                name: output.name ?? resolved.name,
                type: output.type ?? resolved.type,
                img: output.img ?? resolved.img,
                quantity: qty,
                system: foundry.utils.mergeObject(
                    foundry.utils.duplicate(resolved.system ?? {}),
                    foundry.utils.mergeObject(
                        output.system ?? {},
                        { quantity: qty },
                        { inplace: false }
                    ),
                    { inplace: false }
                ),
                flags: foundry.utils.mergeObject(
                    foundry.utils.duplicate(resolved.flags ?? {}),
                    outputFlags ?? {},
                    { inplace: false }
                )
            };
            return ItemOutcomeHandler.grantItemsToActor(actor, [grant]);
        };

        try {
            if (itemRef) {
                const fromRef = await grantFromResolved(itemRef);
                if (fromRef?.length) return fromRef;
            }

            return await ItemOutcomeHandler.grantItemsToActor(actor, [{
                name: output.name,
                type: output.type ?? "consumable",
                img: output.img ?? "icons/consumables/food/bowl-stew-brown.webp",
                quantity: output.quantity ?? 1,
                system: {
                    description: { value: output.description ?? "" },
                    rarity: output.rarity ?? "common",
                    ...(output.system ?? {})
                },
                flags: outputFlags ?? {}
            }]);
        } catch (err) {
            console.error(`${MODULE_ID} | CraftingEngine._createOutputItems`, err);
            ui.notifications.error(
                `Could not add ${output.name ?? "crafted item"} to inventory. Open the dev console (F12) for details.`
            );
            return [];
        }
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
