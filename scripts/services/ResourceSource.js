import { Logger } from "../lib/Logger.js";

/**
 * ResourceSource
 * Centralised quantity resolver for event item grants.
 * Handles scaled_roll (tier-aware), dice expressions, and literal numbers.
 *
 * This is NOT a grant pipeline -- ItemOutcomeHandler still handles item
 * resolution, creation, and stacking. ResourceSource only resolves
 * how many items to grant.
 */
export class ResourceSource {

    /**
     * Resolves the quantity for a single item entry.
     *
     * Resolution order:
     *   1. method === "scaled_roll": evaluate roll * tierMultiplier, clamp [min, max]
     *   2. quantity is a dice string (contains "d"): evaluate as Foundry Roll
     *   3. quantity is a numeric string: parseInt
     *   4. quantity is a number: use directly
     *   5. fallback: 1
     *
     * Always returns >= 1.
     *
     * @param {Object} itemEntry - Item entry from an event outcome.
     *   For scaled_roll: { method, roll, tierMultiplier, min, max }
     *   For simple:      { quantity } (number, string, or dice expression)
     * @param {Object} [context={}]
     * @param {number} [context.partyTier=1] - Party tier for tierMultiplier scaling.
     * @returns {Promise<number>} Resolved quantity (>= 1).
     */
    static async resolveQuantity(itemEntry, context = {}) {
        if (!itemEntry) return 1;

        if (itemEntry.method === "scaled_roll") {
            return this._resolveScaledRoll(itemEntry, context);
        }

        return this._resolveSimpleQuantity(itemEntry.quantity);
    }

    /**
     * Batch-resolves quantities for an array of item entries.
     * Returns shallow copies with `quantity` replaced by the resolved number.
     *
     * @param {Object[]} items - Array of item entries from an outcome.
     * @param {Object} [context={}]
     * @returns {Promise<Object[]>} Items with resolved numeric quantities.
     */
    static async resolveAll(items, context = {}) {
        if (!items?.length) return [];

        const resolved = [];
        for (const item of items) {
            const qty = await this.resolveQuantity(item, context);
            resolved.push({ ...item, quantity: qty });
        }
        return resolved;
    }

    // ── scaled_roll ─────────────────────────────────────────────

    /**
     * Resolves a scaled_roll quantity.
     * Formula: clamp(roll.total * tierMultiplier, min, max)
     *
     * @param {Object} entry - { roll, tierMultiplier, min, max }
     * @param {Object} context - { partyTier }
     * @returns {Promise<number>}
     */
    static async _resolveScaledRoll(entry, context = {}) {
        const {
            roll: rollExpr = "1d4",
            tierMultiplier = 1,
            min = 1,
            max = Infinity
        } = entry;

        // Evaluate the dice expression
        let rollTotal;
        try {
            const roll = await new Roll(rollExpr).evaluate();
            rollTotal = roll.total;
        } catch (err) {
            Logger.warn(`Failed to evaluate roll "${rollExpr}":`, err);
            rollTotal = 1;
        }

        // Apply tier scaling
        // partyTier is a stub for now (always 1). Future content packs
        // will pass the actual party tier from context.
        const tier = context.partyTier ?? 1;
        const scaled = Math.round(rollTotal * tierMultiplier * tier);

        // Clamp to [min, max], then ensure >= 1
        const clamped = Math.min(Math.max(scaled, min), max);
        return Math.max(1, clamped);
    }

    // ── Simple quantity ─────────────────────────────────────────

    /**
     * Resolves a simple quantity value (dice, string number, or literal).
     *
     * @param {string|number|undefined} quantity
     * @returns {Promise<number>}
     */
    static async _resolveSimpleQuantity(quantity) {
        if (quantity === null || quantity === undefined) return 1;

        // Literal number
        if (typeof quantity === "number") {
            return Math.max(1, quantity);
        }

        // String: dice expression or numeric
        if (typeof quantity === "string") {
            const trimmed = quantity.trim();

            // Dice expression (contains "d")
            if (/d/i.test(trimmed)) {
                try {
                    const roll = await new Roll(trimmed).evaluate();
                    return Math.max(1, roll.total);
                } catch (err) {
                    Logger.warn(`Failed to evaluate quantity "${trimmed}":`, err);
                    return 1;
                }
            }

            // Numeric string
            const parsed = parseInt(trimmed, 10);
            if (!isNaN(parsed)) return Math.max(1, parsed);
        }

        return 1;
    }

    // ── Extraction Utility ──────────────────────────────────────

    /**
     * Extracts all item entries from resolved event outcomes.
     * Convenience method mirroring ResourceSink.extractResourceEffects().
     *
     * @param {Object[]} outcomes - Array of outcome objects with .items arrays.
     * @returns {Object[]} Flat array of item entry objects.
     */
    static extractItemEntries(outcomes) {
        if (!outcomes?.length) return [];
        return outcomes.flatMap(o => o.items ?? []);
    }
}
