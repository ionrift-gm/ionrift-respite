const MODULE_ID = "ionrift-respite";

/**
 * Per-rest idempotent grant ledger. Prevents duplicate item rewards on refresh,
 * reconnect, or duplicate socket traffic. Scoped to the active rest session.
 */
export class GrantLedger {

    /** @type {Map<string, { grantedAt: number, summary: unknown }>} */
    #entries = new Map();

    /**
     * @param {string} slotKey
     * @returns {boolean}
     */
    has(slotKey) {
        return this.#entries.has(slotKey);
    }

    /**
     * @param {string} slotKey
     * @returns {unknown|null}
     */
    get(slotKey) {
        return this.#entries.get(slotKey)?.summary ?? null;
    }

    /**
     * @param {string} slotKey
     * @param {unknown} summary
     */
    record(slotKey, summary) {
        if (!slotKey) return;
        this.#entries.set(slotKey, {
            grantedAt: Date.now(),
            summary
        });
    }

    /**
     * Runs grantFn once per slotKey for this rest. Returns cached summary on repeat.
     *
     * @param {string} slotKey
     * @param {() => Promise<unknown>} grantFn
     * @returns {Promise<{ duplicate: boolean, summary: unknown }>}
     */
    async grantOnce(slotKey, grantFn) {
        if (!slotKey) {
            const summary = await grantFn();
            return { duplicate: false, summary };
        }

        const existing = this.#entries.get(slotKey);
        if (existing) {
            return { duplicate: true, summary: existing.summary };
        }

        const summary = await grantFn();
        this.record(slotKey, summary);
        return { duplicate: false, summary };
    }

    reset() {
        this.#entries.clear();
    }

    /**
     * @returns {Record<string, { grantedAt: number, summary: unknown }>}
     */
    serialize() {
        return Object.fromEntries(this.#entries);
    }

    /**
     * @param {Record<string, { grantedAt?: number, summary?: unknown }>|null|undefined} data
     */
    deserialize(data) {
        this.#entries.clear();
        if (!data || typeof data !== "object") return;
        for (const [key, entry] of Object.entries(data)) {
            if (!entry) continue;
            this.#entries.set(key, {
                grantedAt: entry.grantedAt ?? Date.now(),
                summary: entry.summary ?? null
            });
        }
    }

    /**
     * @param {string} day
     * @param {string} actorId
     * @param {string} activity
     * @returns {string}
     */
    static travelSlotKey(day, actorId, activity) {
        return `travel:day${day}:${actorId}:${activity}`;
    }

    /**
     * @param {string} actorId
     * @param {string} professionId
     * @param {string} recipeId
     * @returns {string}
     */
    static craftingSlotKey(actorId, professionId, recipeId) {
        return `crafting:${actorId}:${professionId}:${recipeId}`;
    }

    /**
     * True when this actor already received a crafting grant this rest.
     * @param {string} actorId
     * @param {string} [professionId] - When set, only that profession is checked.
     * @returns {boolean}
     */
    hasCraftingForActor(actorId, professionId = null) {
        const prefix = professionId
            ? `crafting:${actorId}:${professionId}:`
            : `crafting:${actorId}:`;
        for (const key of this.#entries.keys()) {
            if (key.startsWith(prefix)) return true;
        }
        return false;
    }

    /**
     * @param {string} eventId
     * @param {string} itemRef
     * @returns {string}
     */
    static discoverySlotKey(eventId, itemRef) {
        return `discovery:${eventId}:${itemRef}`;
    }

    /**
     * @param {string} actorId
     * @param {string} itemRef
     * @returns {string}
     */
    static mealSlotKey(actorId, itemRef) {
        return `meal:${actorId}:${itemRef}`;
    }
}

export { MODULE_ID as GRANT_LEDGER_MODULE_ID };
