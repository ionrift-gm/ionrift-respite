import { Logger } from "../lib/Logger.js";
import { CalendarHandler } from "./CalendarHandler.js";
import { ItemClassifier } from "./ItemClassifier.js";
import { SpoilageClock } from "./SpoilageClock.js";
import { isHomebrewProvisionOnly } from "./TravelSettings.js";
import { PROVISIONS_CUSTOM_PACK_ID } from "./ProvisionsCustomPack.js";
import { getRegisteredProvisionPackIds } from "./TravelProvisionIndex.js";

const MODULE_PACK_ID = "ionrift-respite.respite-items";

const MODULE_ID = "ionrift-respite";

/**
 * ItemOutcomeHandler
 * Processes ItemOutcome payloads. Resolves item references and
 * delegates creation to Workshop (if active) or falls back to raw Item.create().
 *
 * All item grants go through grantItemsToActor() which stacks onto existing
 * inventory rows when type and stack rules match (cohort suffix names when enabled,
 * or harvest metadata compatibility when suffixes are off).
 */

/**
 * Fallback item definitions for itemRefs that lack compendium entries.
 * These are superseded by any compendium, Workshop, or world item match.
 * Backlog: create proper compendium items for each of these.
 */
const FALLBACK_ITEMS = {
    rusty_pitons: {
        name: "Rusty Pitons",
        type: "loot",
        img: "icons/tools/fasteners/spike-square-brown.webp",
        system: { quantity: 1, description: { value: "Iron spikes salvaged from a previous expedition. Bent but serviceable." } }
    },
    crate_wood: {
        name: "Crate Wood",
        type: "loot",
        img: "icons/commodities/wood/wood-pile-brown.webp",
        system: { quantity: 1, description: { value: "Splintered crate planks. Dry enough to burn as fuel." } }
    },
    cached_gold: {
        name: "Cached Gold",
        type: "loot",
        img: "icons/commodities/currency/coins-assorted-mix-copper-gold-silver.webp",
        system: { quantity: 1, description: { value: "A small purse of coins buried by a previous traveller." } }
    },
    potion_of_healing: {
        name: "Potion of Healing",
        type: "consumable",
        img: "icons/consumables/potions/potion-bottle-corked-red.webp",
        system: { quantity: 1, type: { value: "potion" } }
    },
    antitoxin: {
        name: "Antitoxin",
        type: "consumable",
        img: "icons/consumables/potions/potion-tube-corked-glowing-green.webp",
        system: { quantity: 1, type: { value: "potion" } }
    }
};

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

            const grantType = grant.type ?? "loot";

            ItemOutcomeHandler._stampPerishableHarvestDate(grant);

            const useCohortSuffix = ItemOutcomeHandler._isSpoilageNameSuffixEnabled();
            if (useCohortSuffix) {
                const nameBefore = grant.name;
                SpoilageClock.applyGrantCohortName(grant, ItemOutcomeHandler._grantClock());
                if (grant.name === nameBefore && ItemOutcomeHandler._isPerishableLike(grant)) {
                    Logger.warn(
                        `spoilageNameSuffix enabled but no cohort label applied to "${nameBefore}"`
                        + " (check spoilsAfter, foodTag, or harvest metadata on the grant)."
                    );
                }
            }

            const existing = useCohortSuffix
                ? ItemOutcomeHandler._findCohortSuffixMergeTarget(actor, grant, grantType)
                : ItemOutcomeHandler._findMetadataMergeTarget(actor, grant, grantType);

            if (existing) {
                // Stack onto existing: increment quantity + merge flags
                const currentQty = existing.system?.quantity ?? 1;
                const updateData = { _id: existing.id, "system.quantity": currentQty + qty };

                // Merge module flags so crafting metadata (wellFed, buff, spoilage)
                // is carried onto the existing stack rather than silently dropped.
                const grantModFlags = grant.flags?.[MODULE_ID];
                if (grantModFlags && Object.keys(grantModFlags).length) {
                    const merged = foundry.utils.mergeObject(
                        existing.flags?.[MODULE_ID] ?? {},
                        grantModFlags,
                        { inplace: false }
                    );
                    const existingHarvest = existing.flags?.[MODULE_ID]?.harvestedDate;
                    if (existingHarvest !== null && ItemClassifier.getSpoilsAfter(existing) !== null) {
                        merged.harvestedDate = existingHarvest;
                    }
                    updateData[`flags.${MODULE_ID}`] = merged;
                }

                toUpdate.push(updateData);
                summary.push({ name: grant.name, quantity: qty, stacked: true });
            } else {
                // Create new item with correct quantity.
                // Spread system first, then override quantity so the rolled
                // count always wins over any quantity baked into itemData.
                const itemData = this._normalize([{
                    name: grant.name,
                    type: grant.type ?? "loot",
                    img: grant.img ?? "icons/svg/item-bag.svg",
                    system: {
                        ...(grant.system ?? {}),
                        quantity: qty,
                    },
                    flags: grant.flags ?? {}
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
            const minting = game.ionrift?.library?.minting;
            if (minting?.guardAll) {
                minting.guardAll(toCreate, { moduleId: MODULE_ID, mode: "create" });
            }
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
                        system: resolved.system ?? {},
                        flags: resolved.flags ?? {}
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
    static async grantToActor(actorId, itemRef, quantity = 1, { ledger, slotKey } = {}) {
        const actor = game.actors.get(actorId);
        if (!actor) throw new Error(`Actor ${actorId} not found`);

        const performGrant = async () => {
            let rolledQty = typeof quantity === "number" ? quantity : 1;
            if (typeof quantity === "string" && /d/i.test(quantity)) {
                const roll = await new Roll(quantity).evaluate();
                rolledQty = roll.total;
                roll.toMessage({
                    speaker: ChatMessage.getSpeaker({ alias: "Respite" }),
                    flavor: `Rolling ${quantity} for ${itemRef.replace(/_/g, " ")}`
                });
            } else if (typeof quantity === "string") {
                rolledQty = parseInt(quantity) || 1;
            }
            rolledQty = Math.max(1, rolledQty);

            const resolved = await this._resolveItemRef({ itemRef });
            if (!resolved) throw new Error(`Could not resolve item: ${itemRef}`);

            await this.grantItemsToActor(actor, [{
                name: resolved.name,
                type: resolved.type,
                img: resolved.img,
                quantity: rolledQty,
                system: resolved.system ?? {},
                flags: resolved.flags ?? {}
            }]);

            return {
                rolled: rolledQty,
                itemName: resolved.name ?? itemRef.replace(/_/g, " "),
                actorName: actor.name
            };
        };

        if (ledger && slotKey) {
            const { duplicate, summary } = await ledger.grantOnce(slotKey, performGrant);
            return { ...(summary ?? {}), duplicate };
        }

        return performGrant();
    }

    // ── Internal Helpers ─────────────────────────────────────────

    static _isSpoilageNameSuffixEnabled() {
        try {
            return game.settings.get(MODULE_ID, "spoilageNameSuffix") === true;
        } catch {
            return false;
        }
    }

    static _grantClock() {
        return {
            calendarDate: CalendarHandler.getCurrentDate(),
            worldTimeEpoch: game.time?.worldTime ?? 0
        };
    }

    static _stampPerishableHarvestDate(grant) {
        if (!ItemOutcomeHandler._isPerishableLike(grant)) return;

        const grantFlags = grant.flags?.[MODULE_ID] ?? {};
        if (grantFlags.harvestedDate) return;

        grant.flags = grant.flags ?? {};
        grant.flags[MODULE_ID] = grant.flags[MODULE_ID] ?? {};
        grant.flags[MODULE_ID].harvestedDate = grantFlags.spoilsAfterHours
            ? String(game.time.worldTime)
            : (CalendarHandler.getCurrentDate() ?? String(game.time.worldTime));
    }

    static _isPerishableLike(itemLike) {
        return ItemClassifier.getSpoilsAfter(itemLike) !== null
            || ItemClassifier.getSpoilsAfterHours(itemLike);
    }

    /** Merge target when spoilage name suffixes are enabled (exact name match). */
    static _findCohortSuffixMergeTarget(actor, grant, grantType) {
        const grantName = grant.name?.toLowerCase().trim();
        return actor.items.find(
            i => i.name?.toLowerCase().trim() === grantName && i.type === grantType
        );
    }

    /**
     * Merge target when suffixes are off: base name match, with spoilage compatibility
     * for perishable rows (matches SpoilageMergeGuard / SpoilageClock).
     */
    static _findMetadataMergeTarget(actor, grant, grantType) {
        const baseName = ItemClassifier.baseItemName(grant);
        return actor.items.find(i => {
            if (i.type !== grantType) return false;
            if (ItemClassifier.baseItemName(i) !== baseName) return false;
            if (ItemOutcomeHandler._isPerishableLike(i) || ItemOutcomeHandler._isPerishableLike(grant)) {
                return SpoilageClock.areStacksCompatible(i, grant);
            }
            return true;
        });
    }

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
                const cur = map.get(key);
                cur.quantity += (g.quantity ?? 1);
                cur.flags = foundry.utils.mergeObject(
                    cur.flags ?? {},
                    g.flags ?? {},
                    { inplace: false }
                );
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
        const workshop = game.modules.get("ionrift-quartermaster");
        if (workshop?.active) {
            const worldItem = game.items.find(
                i => i.getFlag("ionrift-quartermaster", "sourceId") === ref ||
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

        // 5. Built-in fallback for refs without compendium entries yet
        const fallback = FALLBACK_ITEMS[ref];
        if (fallback) {
            Logger.log(`ItemOutcomeHandler | Resolved "${ref}" via built-in fallback`);
            return { ...fallback };
        }

        // 6. Last resort: synthesize a generic loot item from the ref name
        console.warn(`ItemOutcomeHandler | Unresolved itemRef "${ref}", creating generic loot`);
        return {
            name: ref.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
            type: "loot",
            img: "icons/svg/item-bag.svg",
            system: { quantity: 1 }
        };
    }

    /**
     * Compendium pack ids searched for provision item resolution (custom, base,
     * and runtime-registered overlay materialisations).
     * @returns {string[]}
     */
    static _provisionPackIds() {
        const base = isHomebrewProvisionOnly()
            ? [PROVISIONS_CUSTOM_PACK_ID]
            : [PROVISIONS_CUSTOM_PACK_ID, MODULE_PACK_ID];
        return [...new Set([...base, ...getRegisteredProvisionPackIds()])];
    }

    /**
     * Resolve a canonical provision item from compendium packs. Prefer explicit
     * `itemRef`; fall back to display name. Returns null when no compendium match.
     * @param {{ itemRef?: string, name?: string }} query
     * @returns {Promise<object|null>}
     */
    static async resolveProvisionItem({ itemRef, name } = {}) {
        if (itemRef) {
            const fromRef = await this._fromCompendium(itemRef);
            if (fromRef) return fromRef;
        }
        if (name) {
            const fromName = await this._fromCompendiumByName(name);
            if (fromName) return fromName;
        }
        return null;
    }

    /**
     * Looks up an item from module compendiums by itemRef flag.
     * @param {string} itemRef
     * @returns {Object|null} Item data object, or null if not found.
     */
    static async _fromCompendium(itemRef) {
        for (const packId of this._provisionPackIds()) {
            const pack = game.packs.get(packId);
            if (!pack) continue;

            const index = await pack.getIndex({ fields: ["flags"] });
            const entry = index.find(
                e => e.flags?.[MODULE_ID]?.itemRef === itemRef
            );
            if (!entry) continue;

            const doc = await pack.getDocument(entry._id);
            return doc?.toObject() ?? null;
        }

        return null;
    }

    /**
     * Looks up an item from provision compendiums by display name.
     * @param {string} name
     * @returns {Promise<object|null>}
     */
    static async _fromCompendiumByName(name) {
        const target = name?.toLowerCase().trim();
        if (!target) return null;

        for (const packId of this._provisionPackIds()) {
            const pack = game.packs.get(packId);
            if (!pack) continue;

            const index = await pack.getIndex({ fields: ["name"] });
            const entry = index.find(e => e.name?.toLowerCase().trim() === target);
            if (!entry) continue;

            const doc = await pack.getDocument(entry._id);
            return doc?.toObject() ?? null;
        }

        return null;
    }

    /**
     * Normalizes item data, using Workshop if available.
     * @param {Object[]} items
     * @returns {Object[]}
     */
    static _normalize(items) {
        const workshop = game.modules.get("ionrift-quartermaster");
        if (workshop?.active && workshop.api?.items?.normalize) {
            return items.map(i => workshop.api.items.normalize(i));
        }
        return items;
    }
}
