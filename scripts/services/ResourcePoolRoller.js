/**
 * ResourcePoolRoller
 * Rolls against terrain-bound resource pools to produce item references.
 * Handles weighted selection and quantity rolling.
 */
export class ResourcePoolRoller {

    constructor() {
        /** @type {Map<string, Object>} Resource pools keyed by ID. */
        this.pools = new Map();
    }

    /**
     * Loads resource pool definitions from JSON data.
     * @param {Object[]} poolData - Array of resource pool schemas.
     */
    load(poolData) {
        for (const pool of poolData) {
            this.pools.set(pool.id, pool);
        }
    }

    /**
     * Rolls against a named pool a given number of times.
     * @param {string} poolId - Resource pool ID.
     * @param {number} rolls - Number of rolls to make.
     * @returns {Object[]} Array of { itemRef, quantity, itemData }.
     */
    async roll(poolId, rolls = 1) {
        let pool = this.pools.get(poolId);

        // Fallback to generic wilderness pool if terrain-specific pool missing
        if (!pool) {
            pool = this.pools.get("resource_pool_wilderness");
        }
        if (!pool) return [];

        const results = [];
        const totalWeight = pool.entries.reduce((sum, e) => sum + (e.weight ?? 1), 0);

        for (let i = 0; i < rolls; i++) {
            // Weighted random selection
            let rand = Math.random() * totalWeight;
            let selected = pool.entries[0];
            for (const entry of pool.entries) {
                rand -= (entry.weight ?? 1);
                if (rand <= 0) {
                    selected = entry;
                    break;
                }
            }

            // Roll quantity
            let quantity = 1;
            if (typeof selected.quantity === "string") {
                const qRoll = await new Roll(selected.quantity).evaluate();
                quantity = qRoll.total;
            } else if (typeof selected.quantity === "number") {
                quantity = selected.quantity;
            }

            // Merge with existing result or add new
            const existing = results.find(r => r.itemRef === selected.itemRef);
            if (existing) {
                existing.quantity += quantity;
            } else {
                results.push({
                    itemRef: selected.itemRef,
                    quantity,
                    itemData: selected.itemData ?? null
                });
            }
        }

        return results;
    }
}
