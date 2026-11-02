import { ResourceSinkItemGoldHelper } from "./ResourceSinkItemGoldHelper.js";
import { MODULE_ID } from "../../../data/moduleId.js";
import { Logger } from "../../../utils/Logger.js";
import { ItemClassifier } from "../../party/ItemClassifier.js";
import { MealPhaseHandler } from "../../meal/phase/MealPhaseHandler.js";

/**
 * ResourceSink
 * Centralised resolver for consume_resource, supply_loss, and consume_gold
 * event effects. All event-driven resource loss flows through this service.
 *
 * Operates at party level: scans all party actors' inventories for the
 * named resource and deducts from whoever has stock.
 */
export class ResourceSink {

    // Map filter names to item matching functions.
    // Each filter returns true if the item is eligible for loss.

    static ITEM_FILTERS = {
        camp_gear: (item) => {
            const type = item.type;
            if (["weapon", "armor"].includes(type)) return false;
            if (ResourceSink._isFoodOrWater(item)) return false;
            if (ResourceSink._isProtectedItem(item)) return false;
            if (["loot", "tool", "equipment"].includes(type)) return true;
            // Camp gear is often typed as a consumable (tinderbox, torch, mess
            // kit, lamp oil). Admit fuel-classified or explicitly camp-named
            // consumables so they sit in the firing line alongside bedrolls,
            // while leaving potions and scrolls out.
            if (type === "consumable") {
                if (ItemClassifier.classify(item) === "fuel") return true;
                if (item.flags?.[MODULE_ID]?.campGearRole) return true;
                const ref = String(item.flags?.[MODULE_ID]?.itemRef ?? item.system?.identifier ?? "").toLowerCase().replace(/[-_]/g, " ").trim();
                if (ref && ResourceSink.CAMP_GEAR_NAMES.has(ref)) return true;
                const name = item.name?.toLowerCase().trim() ?? "";
                if (ResourceSink.CAMP_GEAR_NAMES.has(name)) return true;
            }
            return false;
        },
        consumable: (item) => {
            if (item.type !== "consumable") return false;
            if (ResourceSink._isFoodOrWater(item)) return false;
            if (ResourceSink._isAmmunition(item)) return false;
            if (ResourceSink._isProtectedItem(item)) return false;
            return true;
        },
        minor_consumable: (item) => {
            if (item.type !== "consumable") return false;
            if (ResourceSink._isFoodOrWater(item)) return false;
            if (ResourceSink._isAmmunition(item)) return false;
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
            // Food and water are provisions, resolved by the provisions half of a
            // supplies loss, never as gear at risk.
            if (ResourceSink._isFoodOrWater(item)) return false;
            // Only protect profession kits and foci, NOT rations/water
            if (item.flags?.[MODULE_ID]?.protected) return false;
            const ref = String(item.flags?.[MODULE_ID]?.itemRef ?? item.system?.identifier ?? "").toLowerCase().replace(/[-_]/g, " ").trim();
            if (ref && (ResourceSink.PROFESSION_NAMES.has(ref) || ref.includes("instrument") || ref.includes("artisan") || ResourceSink.RESOURCE_NAMES.supplies.includes(ref))) return false;
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

    // Camp gear that ships as a DnD5e "consumable" type rather than loot, so
    // the camp_gear filter would otherwise skip it. These are durable-enough
    // camping items that belong in the firing line for a supplies loss.
    static CAMP_GEAR_NAMES = new Set([
        "tinderbox", "mess kit", "bedroll", "tent", "torch", "candle",
        "lamp", "hooded lantern", "bullseye lantern", "lantern",
        "oil flask", "flask of oil", "lamp oil", "firewood", "kindling",
        "rope", "hempen rope", "silk rope", "grappling hook", "piton",
        "crowbar", "hammer", "whetstone", "blanket", "cooking pot",
        "fishing tackle", "sewing kit", "soap"
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

    // The abstract "supplies" resource models a lost pack: a mix of
    // provisions (food/water) and durable camp gear. A single authored
    // effect expands here into both halves, with the gear half scaling by
    // the effect's magnitude so a minor loss stays provisions-only and a
    // disaster threatens real equipment. Keyed by the upper bound of the
    // effect's maxPercent (percent_roll) or amount*10 (flat).
    static SUPPLIES_GEAR_CURVE = [
        { maxMagnitude: 15,       gearSeverity: 0, filter: null },
        { maxMagnitude: 25,       gearSeverity: 1, filter: ["camp_gear"] },
        { maxMagnitude: 40,       gearSeverity: 2, filter: ["camp_gear"] },
        { maxMagnitude: Infinity, gearSeverity: 3, filter: ["disaster"] }
    ];

    // Quantity selection per severity level.
    static SEVERITY_QTY = {
        1: { items: 1, maxQtyPer: 1 },
        2: { items: 2, maxQtyPer: 1 },
        3: { items: 3, maxQtyPer: 2 },
        4: { items: 5, maxQtyPer: 3 },
        5: { items: 8, maxQtyPer: 5 }
    };

    // Maps abstract resource keys to candidate inventory item names.
    // Items with flags.ionrift-respite.resourceType override name matching.

    static RESOURCE_NAMES = {
        rations:  ["rations", "trail rations", "iron rations"],
        supplies: ["supplies", "adventuring supplies", "camp supplies"],
        water:    ["waterskin", "water", "canteen"]
    };

    // Percent-based gold loss keyed by severity (1-3).
    // roll * multiplier = raw percent, capped at maxPercent.
    // minGp ensures the loss is never irrelevant at low wealth.

    static GOLD_SEVERITY = {
        1: { roll: "1d4",    multiplier: 3, maxPercent: 15, minGp: 1 },
        2: { roll: "1d6+1",  multiplier: 3, maxPercent: 25, minGp: 5 },
        3: { roll: "2d4+2",  multiplier: 3, maxPercent: 40, minGp: 10 }
    };

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

    /**
     * Propose a consume_resource loss without mutating inventory.
     * Rolls the amount NOW and plans the exact per-actor breakdown so the GM
     * can lock a concrete result that survives the night's rest. The returned
     * proposal is serialisable and applied verbatim later via
     * applyResourceLossBreakdown(), so what the GM locks is exactly what lands.
     *
     * @param {Object} effect - consume_resource effect
     * @param {Object} context - { characters: Actor[] }
     * @returns {Object} { resource, resourceLabel, totalAvailable, totalLoss, breakdown, method }
     */
    static async proposeConsumeResource(effect, context) {
        const resource = effect.resource ?? "supplies";
        const actors = context.characters ?? [];
        const holdings = this._findResourceItems(actors, resource);
        const totalQty = holdings.reduce((sum, h) => sum + h.qty, 0);

        const result = {
            resource,
            resourceLabel: resource,
            totalAvailable: totalQty,
            totalLoss: 0,
            breakdown: [],
            method: effect.method ?? "flat"
        };

        if (totalQty === 0) return result;

        let lossQty;
        if (effect.method === "percent_roll") {
            lossQty = await this._calcPercentRoll(effect, totalQty);
        } else {
            lossQty = effect.amount ?? 1;
        }
        lossQty = Math.min(lossQty, totalQty);

        const breakdown = this._planResourceDistribution(holdings, lossQty);
        for (const b of breakdown) b.kind = resource;
        result.breakdown = breakdown;
        result.totalLoss = breakdown.reduce((s, b) => s + b.lossQty, 0);
        result.provisionGroups = this._groupProvisions(breakdown);
        return result;
    }

    /**
     * Group a provisions breakdown by resource kind (rations / water) for a
     * specific, readable summary. Each group lists its per-actor losses.
     *
     * @param {Object[]} breakdown - entries carrying a `kind` field
     * @returns {Object[]} [{ kind, total, entries: [{ actorName, lossQty }] }]
     */
    static _groupProvisions(breakdown) {
        const order = [];
        const byKind = new Map();
        for (const b of (breakdown ?? [])) {
            const kind = b.kind ?? "provisions";
            if (!byKind.has(kind)) { byKind.set(kind, []); order.push(kind); }
            byKind.get(kind).push({ actorName: b.actorName, lossQty: b.lossQty });
        }
        return order.map(kind => ({
            kind,
            total: byKind.get(kind).reduce((s, e) => s + e.lossQty, 0),
            entries: byKind.get(kind)
        }));
    }

    /**
     * Apply a frozen resource-loss breakdown (from proposeConsumeResource or
     * proposeSupplyLoss). Deducts the exact planned quantities; deletes the
     * stack when it hits zero. Idempotency is the caller's responsibility.
     *
     * @param {Object[]} breakdown - [{ actorId, itemId, lossQty }]
     */
    static async applyResourceLossBreakdown(breakdown) {
        for (const entry of (breakdown ?? [])) {
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
            Logger.log(`consume_resource: removed ${entry.lossQty}x ${entry.itemName ?? "resource"} from ${actor.name} (${Math.max(0, newQty)} remaining)`);
        }
    }

    /**
     * Resolve the gear tier for a "supplies" effect from its magnitude.
     * @param {Object} effect
     * @returns {{ maxMagnitude:number, gearSeverity:number, filter:string[]|null }}
     */
    static _suppliesGearTier(effect) {
        const magnitude = effect.method === "percent_roll"
            ? (effect.maxPercent ?? (effect.multiplier ?? 10) * 2)
            : (effect.amount ?? 1) * 10;
        return this.SUPPLIES_GEAR_CURVE.find(t => t.maxMagnitude >= magnitude)
            ?? this.SUPPLIES_GEAR_CURVE[this.SUPPLIES_GEAR_CURVE.length - 1];
    }

    /**
     * Propose a composite "supplies" loss without mutating anything.
     *
     * "supplies" is the abstract lost-pack resource. It expands into:
     *   - a provisions dent: food + water pooled and depleted by the effect's
     *     percent/flat magnitude (frozen per-actor breakdown), and
     *   - gear at risk: an item_at_risk selection whose severity/filter scale
     *     with the magnitude via SUPPLIES_GEAR_CURVE.
     *
     * Both halves are returned as serialisable breakdowns so the GM can lock a
     * concrete result that survives the rest and applies verbatim afterwards.
     *
     * @param {Object} effect - consume_resource effect with resource "supplies"
     * @param {Object} context - { characters: Actor[] }
     * @returns {Object} { resource, resourceLabel, totalAvailable, totalLoss, breakdown, gear, gearSeverity, method }
     */
    static async proposeSuppliesLoss(effect, context) {
        const actors = context.characters ?? [];

        // Provisions: collect each character's food and drink (diet-aware), then
        // deplete by the authored magnitude. The per-holding `kind` is carried
        // into the breakdown so the loss reports specifically (rations / water /
        // oil) instead of as an opaque "provisions" lump.
        const provisionHoldings = this._collectProvisions(actors);
        const kindByItemId = new Map(provisionHoldings.map(h => [h.item.id, h.kind]));
        const provisionItemIds = new Set(provisionHoldings.map(h => h.item.id));
        const provisionsTotal = provisionHoldings.reduce((s, h) => s + h.qty, 0);

        let breakdown = [];
        if (provisionsTotal > 0) {
            let lossQty = effect.method === "percent_roll"
                ? await this._calcPercentRoll(effect, provisionsTotal)
                : (effect.amount ?? 1);
            lossQty = Math.min(lossQty, provisionsTotal);
            breakdown = this._planResourceDistribution(provisionHoldings, lossQty);
            for (const b of breakdown) b.kind = kindByItemId.get(b.itemId) ?? "rations";
        }
        const totalLoss = breakdown.reduce((s, b) => s + b.lossQty, 0);

        // Gear: item_at_risk selection scaled by magnitude. Frozen to ids so it
        // applies the same items later regardless of inventory churn. Anything
        // already claimed as a provision is dropped so it is never double-listed.
        const tier = this._suppliesGearTier(effect);
        let gear = [];
        if (tier.gearSeverity > 0 && tier.filter) {
            const proposal = await this._resolveItemAtRisk(
                { filter: tier.filter, severity: tier.gearSeverity, narrative: effect.description },
                context
            );
            gear = (proposal.candidates ?? [])
                .filter(c => !provisionItemIds.has(c.item.id))
                .map(c => ({
                    actorId: c.actor.id,
                    actorName: c.actor.name,
                    itemId: c.item.id,
                    itemName: c.item.name,
                    currentQty: c.currentQty,
                    lossQty: c.lossQty
                }));
        }

        return {
            resource: "supplies",
            resourceLabel: "provisions",
            totalAvailable: provisionsTotal,
            totalLoss,
            breakdown,
            provisionGroups: this._groupProvisions(breakdown),
            gear,
            gearSeverity: tier.gearSeverity,
            method: effect.method ?? "flat"
        };
    }

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
        // Disasters drain the party's actual pack, not a phantom "supplies" item
        // that no dnd5e PC carries. Source the same diet-aware provisions pool the
        // composite supplies resolver uses so the loss lands on real rations, water,
        // and camp food. The breakdown carries the true item name per entry.
        const holdings = this._collectProvisions(actors);
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

        // Floor the loss at roughly one item per provision-holder so even a "minor"
        // roll spreads as ~1 each across the party instead of a token single item.
        // Larger rolls already exceed this, so only the minor band is nudged up.
        const holderCount = new Set(holdings.map(h => h.actor.id)).size;
        const lossQty = Math.min(Math.max(Math.ceil(totalQty * percent / 100), holderCount), totalQty);

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

        const available = holdings.reduce((sum, h) => sum + h.qty, 0);
        let remainingLoss = Math.min(totalLoss, available);

        // Per-holding running state, grouped by actor, so the loss spreads across
        // people instead of stacking on whoever happens to carry the most. Each
        // unit goes to the actor who has given up the fewest so far, so a loss
        // equal to the party size lands as roughly one item each.
        const state = holdings.map(h => ({ holding: h, remaining: h.qty, taken: 0 }));
        const byActor = new Map();
        for (const slot of state) {
            const id = slot.holding.actor.id;
            if (!byActor.has(id)) byActor.set(id, []);
            byActor.get(id).push(slot);
        }
        const actorRemaining = (id) => byActor.get(id).reduce((sum, s) => sum + s.remaining, 0);
        const actorTaken = (id) => byActor.get(id).reduce((sum, s) => sum + s.taken, 0);

        while (remainingLoss > 0) {
            const candidates = [...byActor.keys()].filter(id => actorRemaining(id) > 0);
            if (!candidates.length) break;
            // Fewest items lost first; ties broken randomly so it is not always the
            // same person at the front of the queue.
            candidates.sort((a, b) => (actorTaken(a) - actorTaken(b)) || (Math.random() - 0.5));
            const actorId = candidates[0];
            // Within that actor, draw from their largest remaining stack.
            const slot = byActor.get(actorId)
                .filter(s => s.remaining > 0)
                .sort((a, b) => b.remaining - a.remaining)[0];
            slot.remaining -= 1;
            slot.taken += 1;
            remainingLoss -= 1;
        }

        return state.filter(s => s.taken > 0).map(s => ({
            actorId: s.holding.actor.id,
            actorName: s.holding.actor.name,
            itemId: s.holding.item.id,
            itemName: s.holding.item.name,
            currentQty: s.holding.qty,
            lossQty: s.taken
        }));
    }

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

    /**
     * Finds all inventory items matching a resource key across party actors.
     * Checks both name matching and flags.ionrift-respite.resourceType.
     *
     * @param {Actor[]} actors - Party actors.
     * @param {string} resourceKey - e.g. "rations", "supplies", "water"
     * @returns {Object[]} Array of { actor, item, qty }
     */
    static _findResourceItems(actors, resourceKey) {
        const holdings = [];
        const classifyAsFood = resourceKey === "rations";
        const classifyAsWater = resourceKey === "water";

        for (const actor of actors) {
            if (!actor?.items) continue;
            const items = MealPhaseHandler.iterInventoryItems(actor);
            const waterContainerIds = classifyAsWater
                ? MealPhaseHandler.collectWaterSourceContainerIds(items, actor)
                : new Set();

            for (const item of items) {
                const parentId = MealPhaseHandler.getContainerParentId(item);
                if (classifyAsWater && parentId && waterContainerIds.has(parentId)) continue;

                const flagMatch = item.flags?.[MODULE_ID]?.resourceType === resourceKey;
                const candidateNames = this.RESOURCE_NAMES[resourceKey] ?? [resourceKey];
                const ref = String(item.flags?.[MODULE_ID]?.itemRef ?? item.system?.identifier ?? "").toLowerCase().replace(/[-_]/g, " ").trim();
                const nameMatch = (ref && candidateNames.includes(ref)) || candidateNames.includes(item.name?.toLowerCase().trim());

                let match = flagMatch || nameMatch;
                if (classifyAsFood) {
                    match = ItemClassifier.isFood(item, actor) && !ItemClassifier.isWater(item, actor);
                } else if (classifyAsWater) {
                    match = ItemClassifier.isWater(item, actor);
                }

                if (!match) continue;

                const qty = item.system?.quantity ?? 1;
                if (qty > 0) {
                    holdings.push({ actor, item, qty });
                }
            }
        }

        return holdings;
    }

    static async _consumeGold(effect, context) { return ResourceSinkItemGoldHelper._consumeGold.call(this, effect, context); }
    static async proposeGoldLoss(effect, context) { return ResourceSinkItemGoldHelper.proposeGoldLoss.call(this, effect, context); }
    static async applyGoldLossProposal(proposal) { return ResourceSinkItemGoldHelper.applyGoldLossProposal.call(this, proposal); }
    static _distributeGoldLoss(holdings, totalLoss) { return ResourceSinkItemGoldHelper._distributeGoldLoss.call(this, holdings, totalLoss); }
    static extractResourceEffects(outcomes) { return ResourceSinkItemGoldHelper.extractResourceEffects.call(this, outcomes); }
    static _isFoodOrWater(item) { return ResourceSinkItemGoldHelper._isFoodOrWater.call(this, item); }
    static _collectProvisions(actors) { return ResourceSinkItemGoldHelper._collectProvisions.call(this, actors); }
    static _isAmmunition(item) { return ResourceSinkItemGoldHelper._isAmmunition.call(this, item); }
    static _isProtectedItem(item) { return ResourceSinkItemGoldHelper._isProtectedItem.call(this, item); }
    static async _resolveItemAtRisk(effect, context) { return ResourceSinkItemGoldHelper._resolveItemAtRisk.call(this, effect, context); }
    static async applyItemLoss(approved) { return ResourceSinkItemGoldHelper.applyItemLoss.call(this, approved); }
    static _weightedPick(pool, count) { return ResourceSinkItemGoldHelper._weightedPick.call(this, pool, count); }
}