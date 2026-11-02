import { MODULE_ID } from "../../../data/moduleId.js";
import { Logger } from "../../../utils/Logger.js";
import { ItemClassifier } from "../../party/ItemClassifier.js";
import { MealPhaseHandler } from "../../meal/phase/MealPhaseHandler.js";

export class ResourceSinkItemGoldHelper {
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
            const goldAdapter = game.ionrift?.respite?.adapter;
            if (goldAdapter) {
                await goldAdapter.deductCurrency(actor, entry.lossGp);
            } else {
                const currentGp = actor.system?.currency?.gp ?? 0;
                const newGp = Math.max(0, currentGp - entry.lossGp);
                await actor.update({ "system.currency.gp": newGp });
            }
            const remainingGp = goldAdapter ? goldAdapter.getCurrency(actor) : (actor.system?.currency?.gp ?? 0);
            Logger.log(`gold: deducted ${entry.lossGp}gp from ${entry.actorName} (${remainingGp}gp remaining)`);
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

    /**
     * Checks if an item is protected from item_at_risk loss.
     * Protected: profession kits, spellcasting foci, flagged items,
     * unique high-value items (qty 1, price > 100gp).
     *
     * @param {Object} item - Foundry Item object.
     * @returns {boolean}
     */
    /**
     * Whether an item is provisions (food or drinking water) by classification.
     * Such items are never selected as gear at risk; the provisions half of a
     * supplies loss handles them, so cooked meals, seasoned rations, raw food,
     * and waterskins are not double-counted as equipment.
     * @param {Object} item
     * @returns {boolean}
     */
    static _isFoodOrWater(item) {
        const cls = ItemClassifier.classify(item);
        return cls === "food" || cls === "water";
    }

    /**
     * Collect provisions across the party, diet-aware, for a supplies loss.
     *
     * Each actor contributes the items THEY treat as food or drink, so a
     * construct that drinks oil loses oil rather than water it never carried.
     * Every holding is tagged with a display `kind` (rations / water / oil /
     * alcohol / ...) derived from the item so the loss reads specifically.
     *
     * @param {Actor[]} actors
     * @returns {Object[]} [{ actor, item, qty, kind }]
     */
    static _collectProvisions(actors) {
        const holdings = [];
        for (const actor of (actors ?? [])) {
            if (!actor?.items) continue;
            const items = MealPhaseHandler.iterInventoryItems(actor);
            const waterContainerIds = MealPhaseHandler.collectWaterSourceContainerIds(items, actor);

            for (const item of items) {
                const qty = item.system?.quantity ?? 1;
                if (qty <= 0) continue;

                const parentId = MealPhaseHandler.getContainerParentId(item);
                if (parentId && waterContainerIds.has(parentId) && ItemClassifier.isWater(item, actor)) {
                    continue;
                }

                const isWater = ItemClassifier.isWater(item, actor);
                const isFood = !isWater && ItemClassifier.isFood(item, actor);
                if (!isWater && !isFood) continue;
                holdings.push({ actor, item, qty, kind: item.name, class: isWater ? "water" : "food" });
            }
        }
        return holdings;
    }

    /**
     * Ammunition (arrows, bolts, bullets, needles, slugs) is bulky, cheap, and
     * not what a pickpocket or a quick grab targets. Kept out of the theft
     * filters; the broad disaster filter still admits it.
     */
    static _isAmmunition(item) {
        if (item.type !== "consumable") return false;
        const subtype = item.system?.type?.value ?? item.system?.consumableType ?? "";
        if (subtype === "ammo" || subtype === "ammunition") return true;
        if (item.flags?.[MODULE_ID]?.fletchKind || item.flags?.[MODULE_ID]?.ammoKind) return true;
        const ref = String(item.flags?.[MODULE_ID]?.itemRef ?? item.system?.identifier ?? "").toLowerCase().replace(/[-_]/g, " ").trim();
        if (ref && /\b(arrow|arrows|bolt|bolts|bullet|bullets|sling bullet|blowgun needle|needles|cartridge|cartridges)\b/.test(ref)) return true;
        const name = item.name?.toLowerCase().trim() ?? "";
        return /\b(arrow|arrows|bolt|bolts|bullet|bullets|sling bullet|blowgun needle|needles|cartridge|cartridges)\b/.test(name);
    }

    static _isProtectedItem(item) {
        // Explicit protection flag
        if (item.flags?.[MODULE_ID]?.protected) return true;

        const ref = String(item.flags?.[MODULE_ID]?.itemRef ?? item.system?.identifier ?? "").toLowerCase().replace(/[-_]/g, " ").trim();
        if (ref && (this.PROTECTED_NAMES.has(ref) || ref.includes("instrument") || ref.includes("artisan"))) return true;

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
        // Authored filters may be a single string or an array. Coerce to an
        // array so a string never breaks the .some() match below.
        const filterNames = Array.isArray(effect.filter)
            ? effect.filter
            : (effect.filter ? [effect.filter] : ["camp_gear"]);
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

        // Weight toward cheaper, more expendable items, but dampened so a single
        // near-worthless stack does not crowd out everything else. Inverse square
        // root keeps a 1gp trinket only a few times likelier than a 50gp potion,
        // not hundreds of times. Loot is most expendable, tools least.
        const TYPE_BIAS = { loot: 3.0, consumable: 2.5, equipment: 1.5, tool: 1.0, container: 0.5 };
        const weighted = eligible.map(e => {
            const price = e.item.system?.price?.value ?? 1;
            const priceWeight = 1 / Math.sqrt(Math.max(price, 1));
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
