import { Logger } from "../lib/Logger.js";

/**
 * ResourceSink
 * Centralised resolver for consume_resource, supply_loss, and consume_gold
 * event effects. All event-driven resource loss flows through this service.
 *
 * Operates at party level: scans all party actors' inventories for the
 * named resource and deducts from whoever has stock.
 */
export class ResourceSink {

    // ── Item At Risk: Filter Definitions ─────────────────────────
    // Map filter names to item matching functions.
    // Each filter returns true if the item is eligible for loss.

    static ITEM_FILTERS = {
        camp_gear: (item) => {
            const type = item.type;
            if (!["loot", "tool", "equipment"].includes(type)) return false;
            if (["weapon", "armor"].includes(type)) return false;
            if (ResourceSink._isProtectedItem(item)) return false;
            return true;
        },
        consumable: (item) => {
            if (item.type !== "consumable") return false;
            if (ResourceSink._isProtectedItem(item)) return false;
            return true;
        },
        minor_consumable: (item) => {
            if (item.type !== "consumable") return false;
            if (ResourceSink._isProtectedItem(item)) return false;
            const price = item.system?.price?.value ?? 0;
            return price < 50;
        },
        // Broad disaster filter: everything except weapons, armor,
        // profession kits, foci, and spellbooks. Rations and water
        // ARE eligible. High-value uniques (qty 1, >100gp) excluded.
        disaster: (item) => {
            const type = item.type;
            if (["weapon", "armor", "spell", "feat", "class", "subclass", "background"].includes(type)) return false;
            if (!(["loot", "tool", "equipment", "consumable", "container"].includes(type))) return false;
            // Only protect profession kits and foci, NOT rations/water
            if (item.flags?.["ionrift-respite"]?.protected) return false;
            const name = item.name?.toLowerCase().trim() ?? "";
            if (ResourceSink.PROFESSION_NAMES.has(name)) return false;
            if (name.includes("instrument") || name.includes("artisan")) return false;
            // Exclude supply-named items (handled by supply_loss)
            if (ResourceSink.RESOURCE_NAMES.supplies.includes(name)) return false;
            // Protect unique high-value items
            const qty = item.system?.quantity ?? 1;
            const price = item.system?.price?.value ?? 0;
            if (qty <= 1 && price > 100) return false;
            return true;
        }
    };

    // Items excluded from all item_at_risk selections.
    // Profession kits: critical to crafting system.
    // Rations/water: have their own consume_resource mechanic.
    // Foci/spellbooks: losing these is campaign-derailing.
    static PROTECTED_NAMES = new Set([
        "alchemist's supplies", "brewer's supplies", "calligrapher's supplies",
        "carpenter's tools", "cartographer's tools", "cobbler's tools",
        "cook's utensils", "glassblower's tools", "jeweler's tools",
        "leatherworker's tools", "mason's tools", "painter's supplies",
        "potter's tools", "smith's tools", "tinker's tools",
        "weaver's tools", "woodcarver's tools", "herbalism kit",
        "poisoner's kit", "forgery kit", "disguise kit",
        "thieves' tools", "navigator's tools",
        "component pouch", "arcane focus", "druidic focus",
        "holy symbol", "musical instrument", "spellbook",
        "rations", "trail rations", "iron rations",
        "waterskin", "water", "canteen"
    ]);

    // Subset: only profession kits and foci (used by disaster filter).
    // These are ALWAYS protected, even in disasters.
    static PROFESSION_NAMES = new Set([
        "alchemist's supplies", "brewer's supplies", "calligrapher's supplies",
        "carpenter's tools", "cartographer's tools", "cobbler's tools",
        "cook's utensils", "glassblower's tools", "jeweler's tools",
        "leatherworker's tools", "mason's tools", "painter's supplies",
        "potter's tools", "smith's tools", "tinker's tools",
        "weaver's tools", "woodcarver's tools", "herbalism kit",
        "poisoner's kit", "forgery kit", "disguise kit",
        "thieves' tools", "navigator's tools",
        "component pouch", "arcane focus", "druidic focus",
        "holy symbol", "spellbook"
    ]);

    // Quantity selection per severity level.
    static SEVERITY_QTY = {
        1: { items: 1, maxQtyPer: 1 },
        2: { items: 2, maxQtyPer: 1 },
        3: { items: 3, maxQtyPer: 2 },
        4: { items: 5, maxQtyPer: 3 },
        5: { items: 8, maxQtyPer: 5 }
    };

    // ── Resource Name Map ────────────────────────────────────────
    // Maps abstract resource keys to candidate inventory item names.
    // Items with flags.ionrift-respite.resourceType override name matching.

    static RESOURCE_NAMES = {
        rations:  ["rations", "trail rations", "iron rations"],
        supplies: ["supplies", "adventuring supplies", "camp supplies"],
        water:    ["waterskin", "water", "canteen"]
    };

    // ── Gold Severity Table ──────────────────────────────────────
    // Percent-based gold loss keyed by severity (1-3).
    // roll * multiplier = raw percent, capped at maxPercent.
    // minGp ensures the loss is never irrelevant at low wealth.

    static GOLD_SEVERITY = {
        1: { roll: "1d4",    multiplier: 3, maxPercent: 15, minGp: 1 },
        2: { roll: "1d6+1",  multiplier: 3, maxPercent: 25, minGp: 5 },
        3: { roll: "2d4+2",  multiplier: 3, maxPercent: 40, minGp: 10 }
    };

    // ── Public API ───────────────────────────────────────────────

    /**
     * Process all resource-loss effects from resolved event outcomes.
     * Called once per rest during the resolution phase.
     *
     * @param {Object[]} effects - Array of consume_resource / supply_loss effects.
     * @param {Object}   context - { characters: Actor[], terrainTag, restType }
     * @returns {Object[]} Summary: [{ resource, lost, remaining, method, fallback? }]
     */
    static async processAll(effects, context) {
        if (!effects?.length) return [];

        const summary = [];

        for (const effect of effects) {
            if (effect.type === "consume_resource") {
                summary.push(await this._consumeResource(effect, context));
            } else if (effect.type === "supply_loss") {
                summary.push(await this._consumeSupplyLoss(effect, context));
            } else if (effect.type === "consume_gold") {
                summary.push(await this._consumeGold(effect, context));
            } else if (effect.type === "item_at_risk") {
                summary.push(await this._resolveItemAtRisk(effect, context));
            }
        }

        return summary;
    }

    // ── Internal: consume_resource ───────────────────────────────

    /**
     * Process a single consume_resource effect.
     *
     * Two methods:
     *   - percent_roll: roll * multiplier = percent, capped at maxPercent
     *   - flat (default): deduct a fixed amount
     *
     * @param {Object} effect
     * @param {Object} context
     * @returns {Object} { resource, lost, remaining, method, fallback? }
     */
    static async _consumeResource(effect, context) {
        const resource = effect.resource ?? "supplies";
        const actors = context.characters ?? [];

        // Find all matching resource items across party
        const holdings = this._findResourceItems(actors, resource);
        const totalQty = holdings.reduce((sum, h) => sum + h.qty, 0);

        // Calculate loss amount
        let lossQty;

        if (effect.method === "percent_roll") {
            lossQty = await this._calcPercentRoll(effect, totalQty);
        } else {
            // Flat amount
            lossQty = effect.amount ?? 1;
        }

        // Handle zero stock: trigger fallback
        if (totalQty === 0) {
            const fallback = effect.noResourceFallback ?? null;
            if (fallback) {
                Logger.warn(
                    `No ${resource} available. ` +
                    `Fallback triggered: ${fallback.condition ?? fallback.type}`
                );
            }
            return {
                resource,
                lost: 0,
                remaining: 0,
                method: effect.method ?? "flat",
                fallback: fallback ?? null
            };
        }

        // Clamp loss to available stock
        lossQty = Math.min(lossQty, totalQty);

        // Distribute proportionally across actors with jitter
        const actualLost = await this._distributeResourceLoss(holdings, lossQty);
        const totalRemaining = totalQty - actualLost;

        Logger.log(
            `${resource}: lost ${actualLost} ` +
            `(${totalRemaining} remaining across party)`
        );

        return {
            resource,
            lost: actualLost,
            remaining: totalRemaining,
            method: effect.method ?? "flat",
            fallback: null
        };
    }

    // ── Internal: supply_loss (disasters) ────────────────────────

    /**
     * Process a supply_loss effect from a disaster.
     * Evaluates the formula and treats the result as a percentage of total supplies.
     *
     * @param {Object} effect - { formula, description }
     * @param {Object} context
     * @returns {Object} { resource, lost, remaining, method }
     */
    static async _consumeSupplyLoss(effect, context) {
        const proposal = await this.proposeSupplyLoss(effect, context);
        if (proposal.totalLoss === 0) return { resource: "supplies", lost: 0, remaining: proposal.totalAvailable, method: "supply_loss", fallback: null };
        await this.applySupplyLossProposal(proposal);
        return { resource: "supplies", lost: proposal.totalLoss, remaining: proposal.totalAvailable - proposal.totalLoss, method: "supply_loss", fallback: null };
    }

    /**
     * Propose a supply_loss without mutating inventory.
     * Returns a breakdown of per-actor losses for GM approval.
     *
     * @param {Object} effect - { formula, description }
     * @param {Object} context - { characters: Actor[] }
     * @returns {Object} Proposal with breakdown
     */
    static async proposeSupplyLoss(effect, context) {
        const actors = context.characters ?? [];
        const resource = effect.resource ?? "supplies";
        const holdings = this._findResourceItems(actors, resource);
        const totalQty = holdings.reduce((sum, h) => sum + h.qty, 0);

        if (totalQty === 0) {
            return { formula: effect.formula, rollResult: 0, totalAvailable: 0, totalLoss: 0, breakdown: [], description: effect.description ?? "Supply loss" };
        }

        // Evaluate formula as a Foundry Roll
        let percent = 0;
        try {
            const roll = await new Roll(effect.formula).evaluate();
            percent = Math.min(roll.total, 100);
        } catch (e) {
            Logger.warn(`Bad supply_loss formula: ${effect.formula}`, e);
            return { formula: effect.formula, rollResult: 0, totalAvailable: totalQty, totalLoss: 0, breakdown: [], description: effect.description ?? "Supply loss" };
        }

        const lossQty = Math.min(Math.ceil(totalQty * percent / 100), totalQty);

        // Calculate distribution (same jitter logic) but don't apply
        const breakdown = this._planResourceDistribution(holdings, lossQty);

        return {
            formula: effect.formula,
            rollResult: percent,
            totalAvailable: totalQty,
            totalLoss: breakdown.reduce((s, b) => s + b.lossQty, 0),
            breakdown,
            description: effect.description ?? "Supply loss"
        };
    }

    /**
     * Apply an approved supply loss proposal to inventory.
     * @param {Object} proposal - From proposeSupplyLoss()
     */
    static async applySupplyLossProposal(proposal) {
        for (const entry of proposal.breakdown) {
            if (entry.lossQty <= 0) continue;
            const actor = game.actors.get(entry.actorId);
            if (!actor) continue;
            const item = actor.items.get(entry.itemId);
            if (!item) continue;

            const newQty = (item.system?.quantity ?? 0) - entry.lossQty;
            if (newQty <= 0) {
                await actor.deleteEmbeddedDocuments("Item", [item.id]);
            } else {
                await actor.updateEmbeddedDocuments("Item", [
                    { _id: item.id, "system.quantity": newQty }
                ]);
            }

            Logger.log(`supply_loss: removed ${entry.lossQty}x supplies from ${actor.name} (${Math.max(0, newQty)} remaining)`);
        }
    }

    /**
     * Plan resource distribution across holders without applying.
     * Returns a serialisable breakdown array.
     *
     * @param {Object[]} holdings - [{ actor, item, qty }]
     * @param {number} totalLoss - Total quantity to deduct.
     * @returns {Object[]} [{ actorId, actorName, itemId, itemName, currentQty, lossQty }]
     */
    static _planResourceDistribution(holdings, totalLoss) {
        if (!holdings.length || totalLoss <= 0) return [];

        const totalQty = holdings.reduce((sum, h) => sum + h.qty, 0);

        const raw = holdings.map(h => {
            const share = h.qty / totalQty;
            const jitter = 0.7 + Math.random() * 0.6;
            return { holding: h, weight: share * jitter };
        });

        const weightSum = raw.reduce((s, r) => s + r.weight, 0);
        const planned = raw.map(r => {
            const idealLoss = (r.weight / weightSum) * totalLoss;
            const loss = Math.min(Math.round(idealLoss), r.holding.qty);
            return { holding: r.holding, loss };
        });

        // Reconcile rounding
        const distributed = planned.reduce((s, p) => s + p.loss, 0);
        const remainder = totalLoss - distributed;
        if (remainder !== 0 && planned.length > 0) {
            const last = planned[planned.length - 1];
            last.loss = Math.min(last.loss + remainder, last.holding.qty);
        }

        return planned.filter(p => p.loss > 0).map(p => ({
            actorId: p.holding.actor.id,
            actorName: p.holding.actor.name,
            itemId: p.holding.item.id,
            itemName: p.holding.item.name,
            currentQty: p.holding.qty,
            lossQty: p.loss
        }));
    }

    // ── Internal: Distribute Resource Loss ───────────────────────

    /**
     * Distribute an inventory resource loss across holders with jitter.
     * Uses the same proportional jitter as gold distribution but operates
     * on inventory items (updating quantity or deleting at zero).
     *
     * @param {Object[]} holdings - [{ actor, item, qty }] from _findResourceItems
     * @param {number} totalLoss - Total quantity to deduct.
     * @returns {number} Actual amount deducted.
     */
    static async _distributeResourceLoss(holdings, totalLoss) {
        if (!holdings.length || totalLoss <= 0) return 0;

        const totalQty = holdings.reduce((sum, h) => sum + h.qty, 0);

        // Calculate jittered shares
        const raw = holdings.map(h => {
            const share = h.qty / totalQty;
            const jitter = 0.7 + Math.random() * 0.6; // 0.7 to 1.3
            return { holding: h, weight: share * jitter };
        });

        // Normalise weights
        const weightSum = raw.reduce((s, r) => s + r.weight, 0);
        const planned = raw.map(r => {
            const idealLoss = (r.weight / weightSum) * totalLoss;
            const loss = Math.min(Math.round(idealLoss), r.holding.qty);
            return { holding: r.holding, loss };
        });

        // Reconcile rounding: adjust last entry to hit exact total
        const distributed = planned.reduce((s, p) => s + p.loss, 0);
        const remainder = totalLoss - distributed;
        if (remainder !== 0 && planned.length > 0) {
            const last = planned[planned.length - 1];
            last.loss = Math.min(last.loss + remainder, last.holding.qty);
        }

        // Apply deductions to inventory items
        let actualLost = 0;
        for (const { holding, loss } of planned) {
            if (loss <= 0) continue;
            const newQty = holding.qty - loss;
            if (newQty <= 0) {
                await holding.actor.deleteEmbeddedDocuments("Item", [holding.item.id]);
            } else {
                await holding.actor.updateEmbeddedDocuments("Item", [
                    { _id: holding.item.id, "system.quantity": newQty }
                ]);
            }
            actualLost += loss;
        }

        return actualLost;
    }

    // ── Internal: Resource Lookup ────────────────────────────────

    /**
     * Calculates loss quantity using the percent_roll method.
     *   percent = clamp(roll * multiplier, 0, maxPercent)
     *   lossQty = max(min, ceil(totalQty * percent / 100))
     *
     * @param {Object} effect - { roll, multiplier, min, maxPercent }
     * @param {number} totalQty - Total resource quantity across party.
     * @returns {number} Quantity to consume.
     */
    static async _calcPercentRoll(effect, totalQty) {
        const rollExpr = effect.roll ?? "1d4";
        const multiplier = effect.multiplier ?? 10;
        const minQty = effect.min ?? 1;
        const maxPercent = effect.maxPercent ?? 100;

        let rollResult;
        try {
            const roll = await new Roll(rollExpr).evaluate();
            rollResult = roll.total;
        } catch (e) {
            Logger.warn(`Bad roll expression: ${rollExpr}`, e);
            rollResult = 1;
        }

        const rawPercent = rollResult * multiplier;
        const clampedPercent = Math.min(rawPercent, maxPercent);
        const calcQty = Math.ceil(totalQty * clampedPercent / 100);

        return Math.max(minQty, calcQty);
    }

    // ── Internal: Resource Lookup ────────────────────────────────

    /**
     * Finds all inventory items matching a resource key across party actors.
     * Checks both name matching and flags.ionrift-respite.resourceType.
     *
     * @param {Actor[]} actors - Party actors.
     * @param {string} resourceKey - e.g. "rations", "supplies", "water"
     * @returns {Object[]} Array of { actor, item, qty }
     */
    static _findResourceItems(actors, resourceKey) {
        const candidateNames = this.RESOURCE_NAMES[resourceKey] ?? [resourceKey];
        const holdings = [];

        for (const actor of actors) {
            if (!actor?.items) continue;
            for (const item of actor.items) {
                const flagMatch = item.flags?.["ionrift-respite"]?.resourceType === resourceKey;
                const nameMatch = candidateNames.includes(item.name?.toLowerCase().trim());

                if (flagMatch || nameMatch) {
                    const qty = item.system?.quantity ?? 1;
                    if (qty > 0) {
                        holdings.push({ actor, item, qty });
                    }
                }
            }
        }

        return holdings;
    }

    // ── Internal: consume_gold ────────────────────────────────────

    /**
     * Process a consume_gold effect.
     * Percent-based gold loss distributed proportionally across actors
     * with jitter (0.7x-1.3x) so the distribution feels natural.
     *
     * @param {Object} effect - { severity: 1-3, description }
     * @param {Object} context - { characters: Actor[] }
     * @returns {Object} { resource: "gold", lost, remaining, method, breakdown }
     */
    static async _consumeGold(effect, context) {
        const proposal = await this.proposeGoldLoss(effect, context);
        if (proposal.totalLoss === 0) return { resource: "gold", lost: 0, remaining: 0, method: "consume_gold", breakdown: [] };
        await this.applyGoldLossProposal(proposal);
        return {
            resource: "gold",
            lost: proposal.totalLoss,
            remaining: proposal.totalGp - proposal.totalLoss,
            method: "consume_gold",
            breakdown: proposal.breakdown.map(b => ({ actor: b.actorName, lost: b.lossGp, had: b.currentGp }))
        };
    }

    /**
     * Propose gold loss without applying it.
     * Returns a serializable breakdown for GM approval.
     *
     * @param {Object} effect - { severity }
     * @param {Object} context - { characters }
     * @returns {Object} { totalGp, totalLoss, severity, breakdown: [{ actorId, actorName, currentGp, lossGp }] }
     */
    static async proposeGoldLoss(effect, context) {
        const actors = context.characters ?? [];
        const severity = Math.max(1, Math.min(3, effect.severity ?? 1));
        const config = this.GOLD_SEVERITY[severity];

        const holdings = [];
        for (const actor of actors) {
            const gp = actor?.system?.currency?.gp ?? 0;
            if (gp > 0) holdings.push({ actor, gp });
        }

        const totalGp = holdings.reduce((sum, h) => sum + h.gp, 0);
        if (totalGp === 0) {
            return { totalGp: 0, totalLoss: 0, severity, breakdown: [] };
        }

        let rollResult;
        try {
            const roll = await new Roll(config.roll).evaluate();
            rollResult = roll.total;
        } catch (e) {
            Logger.warn(`Bad gold roll: ${config.roll}`, e);
            rollResult = 1;
        }

        const rawPercent = rollResult * config.multiplier;
        const clampedPercent = Math.min(rawPercent, config.maxPercent);
        const calcLoss = Math.ceil(totalGp * clampedPercent / 100);
        const totalLoss = Math.min(Math.max(config.minGp, calcLoss), totalGp);

        const distributed = this._distributeGoldLoss(holdings, totalLoss);

        const breakdown = distributed.map(d => ({
            actorId: d.holding.actor.id,
            actorName: d.holding.actor.name,
            currentGp: d.holding.gp,
            lossGp: d.loss
        }));

        Logger.log(
            `gold proposal: ${totalLoss}gp from ${holdings.length} actors ` +
            `(severity ${severity}, roll ${rollResult} * ${config.multiplier} = ${rawPercent}%)`
        );

        return { totalGp, totalLoss, severity, breakdown };
    }

    /**
     * Apply a confirmed gold loss proposal.
     * @param {Object} proposal - from proposeGoldLoss
     */
    static async applyGoldLossProposal(proposal) {
        for (const entry of proposal.breakdown) {
            const actor = game.actors.get(entry.actorId);
            if (!actor) continue;
            const currentGp = actor.system?.currency?.gp ?? 0;
            const newGp = Math.max(0, currentGp - entry.lossGp);
            await actor.update({ "system.currency.gp": newGp });
            Logger.log(`gold: deducted ${entry.lossGp}gp from ${entry.actorName} (${newGp}gp remaining)`);
        }
    }

    /**
     * Distributes a gold loss across holders with jitter.
     * Each actor's share is proportional to their holdings,
     * multiplied by a random factor (0.7-1.3) so it's uneven.
     *
     * @param {Object[]} holdings - [{ actor, gp }]
     * @param {number} totalLoss - Total gp to deduct.
     * @returns {Object[]} [{ holding, loss }]
     */
    static _distributeGoldLoss(holdings, totalLoss) {
        const totalGp = holdings.reduce((sum, h) => sum + h.gp, 0);

        // Calculate jittered shares
        const raw = holdings.map(h => {
            const share = h.gp / totalGp;
            const jitter = 0.7 + Math.random() * 0.6; // 0.7 to 1.3
            return { holding: h, weight: share * jitter };
        });

        // Normalise weights
        const weightSum = raw.reduce((s, r) => s + r.weight, 0);
        const result = raw.map(r => {
            const idealLoss = (r.weight / weightSum) * totalLoss;
            // Clamp to what the actor actually has
            const loss = Math.min(Math.round(idealLoss), r.holding.gp);
            return { holding: r.holding, loss };
        });

        // Reconcile rounding: adjust last actor to hit exact total
        const distributed = result.reduce((s, r) => s + r.loss, 0);
        const remainder = totalLoss - distributed;
        if (remainder !== 0 && result.length > 0) {
            const last = result[result.length - 1];
            last.loss = Math.min(last.loss + remainder, last.holding.gp);
        }

        return result;
    }

    // ── Utility: Extract Effects ─────────────────────────────────

    /**
     * Extracts all resource-loss effects from an array of outcomes.
     * Use this to collect effects before passing to processAll().
     *
     * @param {Object[]} outcomes - Array of outcome objects containing effects arrays.
     * @returns {Object[]} Flat array of resource-loss effects.
     */
    static extractResourceEffects(outcomes) {
        const LOSS_TYPES = ["consume_resource", "supply_loss", "consume_gold", "item_at_risk"];
        const effects = [];
        for (const outcome of (outcomes ?? [])) {
            for (const effect of (outcome.effects ?? [])) {
                if (LOSS_TYPES.includes(effect.type)) {
                    effects.push(effect);
                }
            }
        }
        return effects;
    }

    // ── Internal: item_at_risk ────────────────────────────────────

    /**
     * Checks if an item is protected from item_at_risk loss.
     * Protected: profession kits, spellcasting foci, flagged items,
     * unique high-value items (qty 1, price > 100gp).
     *
     * @param {Object} item - Foundry Item object.
     * @returns {boolean}
     */
    static _isProtectedItem(item) {
        // Explicit protection flag
        if (item.flags?.["ionrift-respite"]?.protected) return true;

        // Protected by name (profession kits, foci)
        const name = item.name?.toLowerCase().trim();
        if (name && this.PROTECTED_NAMES.has(name)) return true;

        // Partial match for musical instruments and artisan tools
        if (name && (name.includes("instrument") || name.includes("artisan"))) return true;

        // Unique high-value: qty=1 and price > 100gp
        const qty = item.system?.quantity ?? 1;
        const price = item.system?.price?.value ?? 0;
        if (qty <= 1 && price > 100) return true;

        return false;
    }

    /**
     * Select candidate items for loss based on filter and severity.
     * Candidates are picked randomly, weighted toward cheaper items.
     * Does NOT remove items -- returns proposal for GM confirmation.
     *
     * @param {Object} effect - { filter: string[], severity: number, narrative }
     * @param {Object} context - { characters: Actor[] }
     * @returns {Object} { type, candidates, narrative, severity }
     */
    static async _resolveItemAtRisk(effect, context) {
        const actors = context.characters ?? [];
        const filterNames = effect.filter ?? ["camp_gear"];
        const severity = Math.max(1, Math.min(5, effect.severity ?? 1));
        const config = this.SEVERITY_QTY[severity] ?? this.SEVERITY_QTY[3];

        // Collect eligible items across all actors
        const eligible = [];
        for (const actor of actors) {
            if (!actor?.items) continue;
            for (const item of actor.items) {
                // Must pass at least one filter
                const matches = filterNames.some(f => {
                    const fn = this.ITEM_FILTERS[f];
                    return fn ? fn(item) : false;
                });
                if (!matches) continue;

                const qty = item.system?.quantity ?? 1;
                if (qty <= 0) continue;

                eligible.push({ actor, item, qty });
            }
        }

        if (eligible.length === 0) {
            Logger.log(
                `item_at_risk: no eligible items for ` +
                `filters [${filterNames.join(", ")}]`
            );
            return {
                type: "item_at_risk",
                candidates: [],
                narrative: effect.narrative ?? "Nothing was lost.",
                severity,
                skipped: true
            };
        }

        // Weight by inverse price and item type bias.
        // Loot is most expendable, consumables nearly as much, tools least.
        const TYPE_BIAS = { loot: 3.0, consumable: 2.5, equipment: 1.5, tool: 1.0, container: 0.5 };
        const weighted = eligible.map(e => {
            const price = e.item.system?.price?.value ?? 1;
            const priceWeight = 1 / Math.max(price, 0.1);
            const typeBias = TYPE_BIAS[e.item.type] ?? 1.0;
            return { ...e, weight: priceWeight * typeBias };
        });

        // Select candidates
        const selected = this._weightedPick(weighted, config.items);

        // Determine qty to lose per candidate
        const candidates = selected.map(s => ({
            actor: s.actor,
            item: s.item,
            currentQty: s.qty,
            lossQty: Math.min(config.maxQtyPer, s.qty)
        }));

        Logger.log(
            `item_at_risk: ${candidates.length} candidates ` +
            `at severity ${severity} from filters [${filterNames.join(", ")}]`,
            candidates.map(c => `${c.actor.name}: ${c.item.name} x${c.lossQty}`)
        );

        return {
            type: "item_at_risk",
            candidates,
            narrative: effect.narrative ?? "Some items were lost.",
            severity
        };
    }

    /**
     * Apply confirmed item losses from an item_at_risk resolution.
     * Called after GM approves the candidate list.
     *
     * @param {Object[]} approved - [{ actor, item, lossQty }]
     * @returns {Object[]} Summary of applied losses.
     */
    static async applyItemLoss(approved) {
        const summary = [];
        for (const { actor, item, lossQty } of approved) {
            const currentQty = item.system?.quantity ?? 1;
            const newQty = currentQty - lossQty;

            if (newQty <= 0) {
                await actor.deleteEmbeddedDocuments("Item", [item.id]);
            } else {
                await actor.updateEmbeddedDocuments("Item", [
                    { _id: item.id, "system.quantity": newQty }
                ]);
            }

            summary.push({
                actorName: actor.name,
                itemName: item.name,
                icon: item.img ?? "icons/svg/mystery-man.svg",
                lost: lossQty,
                remaining: Math.max(0, newQty)
            });

            Logger.log(
                `item_at_risk: removed ${lossQty}x ` +
                `${item.name} from ${actor.name} (${Math.max(0, newQty)} remaining)`
            );
        }
        return summary;
    }

    /**
     * Weighted random selection without replacement.
     * @param {Object[]} pool - [{ weight, ...rest }]
     * @param {number} count - Number to pick.
     * @returns {Object[]} Selected entries.
     */
    static _weightedPick(pool, count) {
        const picks = [];
        const remaining = [...pool];

        for (let i = 0; i < count && remaining.length > 0; i++) {
            const totalWeight = remaining.reduce((s, e) => s + e.weight, 0);
            let roll = Math.random() * totalWeight;
            let picked = remaining[remaining.length - 1]; // fallback

            for (let j = 0; j < remaining.length; j++) {
                roll -= remaining[j].weight;
                if (roll <= 0) {
                    picked = remaining[j];
                    remaining.splice(j, 1);
                    break;
                }
            }

            picks.push(picked);
        }

        return picks;
    }
}
