/**
 * ItemOutcomeHandler
 * Processes ItemOutcome payloads. Resolves item references and
 * delegates creation to Workshop (if active) or falls back to raw Item.create().
 *
 * All item grants go through grantItemsToActor() which stacks onto existing
 * inventory entries by name match rather than creating duplicates.
 */
export class ItemOutcomeHandler {

    // ── Centralized Grant ────────────────────────────────────────

    /**
     * Grants items to an actor, stacking onto existing inventory entries by name.
     * This is the SINGLE entry point for all item grants in the module.
     *
     * @param {Actor} actor - Target actor
     * @param {Object[]} grants - Array of { name, type, img, quantity, system }
     * @returns {Object[]} Summary: [{ name, quantity, stacked }]
     */
    static async grantItemsToActor(actor, grants) {
        if (!actor || !grants?.length) return [];

        const summary = [];
        const toCreate = [];
        const toUpdate = [];

        for (const grant of grants) {
            const qty = grant.quantity ?? 1;
            if (qty <= 0) continue;

            // Search for existing item by name (case-insensitive)
            const existing = actor.items.find(
                i => i.name?.toLowerCase().trim() === grant.name?.toLowerCase().trim()
                    && i.type === (grant.type ?? "loot")
            );

            if (existing) {
                // Stack onto existing: increment quantity
                const currentQty = existing.system?.quantity ?? 1;
                toUpdate.push({ _id: existing.id, "system.quantity": currentQty + qty });
                summary.push({ name: grant.name, quantity: qty, stacked: true });
            } else {
                // Create new item with correct quantity
                const itemData = this._normalize([{
                    name: grant.name,
                    type: grant.type ?? "loot",
                    img: grant.img ?? "icons/svg/item-bag.svg",
                    system: {
                        quantity: qty,
                        ...(grant.system ?? {})
                    }
                }]);
                toCreate.push(...itemData);
                summary.push({ name: grant.name, quantity: qty, stacked: false });
            }
        }

        // Batch update existing items
        if (toUpdate.length) {
            await actor.updateEmbeddedDocuments("Item", toUpdate);
        }

        // Batch create new items
        if (toCreate.length) {
            await actor.createEmbeddedDocuments("Item", toCreate);
        }

        return summary;
    }

    // ── Activity Outcome Processing ──────────────────────────────

    /**
     * Processes all outcomes for a rest and grants items to character sheets.
     * @param {Object[]} outcomes - Array of per-character outcome payloads.
     * @returns {Object[]} Summary of items created per character.
     */
    static async processAll(outcomes) {
        const summary = [];

        for (const characterOutcome of outcomes) {
            const actor = game.actors.get(characterOutcome.characterId);
            if (!actor) continue;

            // Collect all item grants for this character
            const grants = [];

            for (const outcome of characterOutcome.outcomes) {
                // Skip event-sourced items: these are granted via Party Discoveries UI
                if (outcome.source === "event") continue;
                for (const itemEntry of (outcome.items ?? [])) {
                    const resolved = await this._resolveItemRef(itemEntry);
                    if (!resolved) continue;

                    grants.push({
                        name: resolved.name,
                        type: resolved.type,
                        img: resolved.img,
                        quantity: itemEntry.quantity ?? 1,
                        system: resolved.system ?? {}
                    });
                }
            }

            if (grants.length === 0) {
                summary.push({ characterId: characterOutcome.characterId, items: [] });
                continue;
            }

            // Aggregate grants by name+type (e.g. 2x forage rolls for same herb)
            const aggregated = this._aggregateGrants(grants);

            // Grant through centralized method (stacks onto existing)
            const grantSummary = await this.grantItemsToActor(actor, aggregated);
            summary.push({
                characterId: characterOutcome.characterId,
                items: grantSummary
            });
        }

        return summary;
    }

    /**
     * Grants a discovered item to a specific actor.
     * Rolls quantity dice if needed, resolves the item from compendium, and grants it.
     * @param {string} actorId - Target actor ID
     * @param {string} itemRef - Item reference key (e.g. "jungle_herbs")
     * @param {string|number} quantity - Fixed number or dice expression (e.g. "1d4")
     * @returns {{ rolled: number, itemName: string, actorName: string }}
     */
    static async grantToActor(actorId, itemRef, quantity = 1) {
        const actor = game.actors.get(actorId);
        if (!actor) throw new Error(`Actor ${actorId} not found`);

        // Roll quantity dice if it's a string expression
        let rolledQty = typeof quantity === "number" ? quantity : 1;
        if (typeof quantity === "string" && /d/i.test(quantity)) {
            const roll = await new Roll(quantity).evaluate();
            rolledQty = roll.total;
            // Show the roll in chat
            roll.toMessage({
                speaker: ChatMessage.getSpeaker({ alias: "Respite" }),
                flavor: `Rolling ${quantity} for ${itemRef.replace(/_/g, " ")}`
            });
        } else if (typeof quantity === "string") {
            rolledQty = parseInt(quantity) || 1;
        }
        rolledQty = Math.max(1, rolledQty);

        // Resolve the item data
        const resolved = await this._resolveItemRef({ itemRef });
        if (!resolved) throw new Error(`Could not resolve item: ${itemRef}`);

        // Grant through centralized method (stacks onto existing)
        const grantSummary = await this.grantItemsToActor(actor, [{
            name: resolved.name,
            type: resolved.type,
            img: resolved.img,
            quantity: rolledQty,
            system: resolved.system ?? {}
        }]);

        return {
            rolled: rolledQty,
            itemName: resolved.name ?? itemRef.replace(/_/g, " "),
            actorName: actor.name
        };
    }

    // ── Internal Helpers ─────────────────────────────────────────

    /**
     * Aggregates grants by name+type, summing quantities.
     * @param {Object[]} grants - [{ name, type, img, quantity, system }]
     * @returns {Object[]} Aggregated grants
     */
    static _aggregateGrants(grants) {
        const map = new Map();
        for (const g of grants) {
            const key = `${g.name?.toLowerCase().trim()}::${g.type ?? "loot"}`;
            if (map.has(key)) {
                map.get(key).quantity += (g.quantity ?? 1);
            } else {
                map.set(key, { ...g });
            }
        }
        return [...map.values()];
    }

    /**
     * Resolves an itemRef to full item data.
     * Resolution order: Module compendium > Workshop > world items > inline itemData.
     * @param {Object} itemEntry - { itemRef, quantity, itemData }
     * @returns {Object|null} Resolved item data ready for creation.
     */
    static async _resolveItemRef(itemEntry) {
        const ref = itemEntry.itemRef;

        // No ref - skip lookups, fall through to inline data
        if (!ref) {
            if (itemEntry.itemData) return itemEntry.itemData;
            if (itemEntry.name) return { name: itemEntry.name, type: "loot", img: itemEntry.img ?? "icons/svg/item-bag.svg" };
            return null;
        }

        // 1. Module compendium lookup (by itemRef flag)
        const compendiumItem = await this._fromCompendium(ref);
        if (compendiumItem) return compendiumItem;

        // 2. Workshop compendium lookup
        const workshop = game.modules.get("ionrift-workshop");
        if (workshop?.active) {
            const worldItem = game.items.find(
                i => i.getFlag("ionrift-workshop", "sourceId") === ref ||
                    i.name?.toLowerCase() === ref.replace(/_/g, " ")
            );
            if (worldItem) return worldItem.toObject();
        }

        // 3. World item lookup by name
        const byName = game.items.find(
            i => i.name?.toLowerCase() === ref.replace(/_/g, " ")
        );
        if (byName) return byName.toObject();

        // 4. Inline fallback
        if (itemEntry.itemData) return itemEntry.itemData;

        return null;
    }

    /**
     * Looks up an item from the module's own compendium by itemRef flag.
     * Caches the pack reference on first call.
     * @param {string} itemRef
     * @returns {Object|null} Item data object, or null if not found.
     */
    static async _fromCompendium(itemRef) {
        if (!this._pack) {
            // Try module-level pack first, then search by label
            this._pack = game.packs.get("ionrift-respite.respite-items")
                ?? game.packs.find(p => p.metadata.label === "Respite: Rest Items");
        }
        if (!this._pack) return null;

        // Load index if needed (lightweight, metadata only)
        const index = await this._pack.getIndex({ fields: ["flags"] });
        const entry = index.find(
            e => e.flags?.["ionrift-respite"]?.itemRef === itemRef
        );
        if (!entry) return null;

        const doc = await this._pack.getDocument(entry._id);
        return doc?.toObject() ?? null;
    }

    /**
     * Normalizes item data, using Workshop if available.
     * @param {Object[]} items
     * @returns {Object[]}
     */
    static _normalize(items) {
        const workshop = game.modules.get("ionrift-workshop");
        if (workshop?.active && workshop.api?.items?.normalize) {
            return items.map(i => workshop.api.items.normalize(i));
        }
        return items;
    }
}
