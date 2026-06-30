/**
 * Blocks inventory merges when perishable stacks differ in calendar days
 * remaining (matches SpoilageClock / badge math).
 */

import { SpoilageClock } from "./SpoilageClock.js";

const MODULE_ID = "ionrift-respite";
const GUARD_FLAG = "__ionriftRespiteSpoilageGuard";

const MERGE_BLOCKED_MESSAGE =
    "Cannot merge items with different spoilage freshness. Keep separate stacks.";

/**
 * Mirrors daggerheart `itemIsIdentical` so merge targets match core behavior.
 * @param {foundry.documents.Item} a
 * @param {foundry.documents.Item} b
 */
function daggerheartItemIsIdentical(a, b) {
    const compendiumSource = a._stats.compendiumSource === b._stats.compendiumSource;
    const name = a.name === b.name;
    const description = a.system.description === b.system.description;
    return compendiumSource && name && description;
}

function getDHBaseActorSheet() {
    return game.system?.api?.applications?.sheets?.api?.DHBaseActorSheet ?? null;
}

function getDnD5eBaseActorSheet() {
    return game.dnd5e?.applications?.actor?.BaseActorSheet ?? null;
}

/**
 * Resolves the dnd5e consumable stack target for a drop, mirroring
 * BaseActorSheet._onDropStackConsumables lookup.
 * @param {object} sheet - dnd5e BaseActorSheet instance
 * @param {object} itemData
 * @param {string|null} [container=null]
 * @returns {foundry.documents.Item|null}
 */
export function findDnD5eSimilarConsumable(sheet, itemData, container = null) {
    const droppedSourceId = itemData._stats?.compendiumSource ?? itemData.flags?.core?.sourceId;
    if (itemData.type !== "consumable" || !droppedSourceId) return null;

    const inventorySource = sheet.inventorySource ?? sheet.actor;
    const sourcedItems = inventorySource?.sourcedItems;
    if (!sourcedItems?.get) return null;

    return sourcedItems.get(droppedSourceId, { legacy: false })
        ?.filter(i => (i.system.container === container) && (i.name === itemData.name))
        ?.first()
        ?? null;
}

/**
 * Whether two item-like rows may merge without blending spoilage cohorts.
 * @param {foundry.documents.Item|object} existingItem
 * @param {foundry.documents.Item|object} incomingLike
 * @param {object} [clock]
 */
export function canMergePerishableStacks(existingItem, incomingLike, clock = {}) {
    return SpoilageClock.areStacksCompatible(existingItem, incomingLike, clock);
}

function registerDaggerheartSpoilageMergeGuard() {
    const Base = getDHBaseActorSheet();
    if (!Base?.prototype?._onDropItem) return;
    if (Base.prototype._onDropItem[GUARD_FLAG]) return;

    const original = Base.prototype._onDropItem;

    Base.prototype._onDropItem = async function ionriftRespiteGuardedOnDropItem(event, item) {
        const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
        const originActor = item.actor;

        if (
            item.actor?.uuid === this.document.uuid
            || !originActor
            || !["character", "party"].includes(this.document.type)
        ) {
            return original.call(this, event, item);
        }

        if (!item.system.metadata.isInventoryItem) {
            return original.call(this, event, item);
        }

        if (!this.document.testUserPermission(game.user, "OWNER", { exact: true })) {
            return ui.notifications.error(
                game.i18n.format("DAGGERHEART.UI.Notifications.lackingItemTransferPermission", {
                    user: game.user.name,
                    target: this.document.name
                })
            );
        }

        if (item.system.metadata.isQuantifiable) {
            const actorItem = originActor.items.get(data.originId);
            const quantityTransfered = await game.system.api.applications.dialogs.ItemTransferDialog.configure({
                item,
                targetActor: this.document
            });

            if (quantityTransfered) {
                const existingItem = this.document.items.find(x => daggerheartItemIsIdentical(x, item));
                if (
                    existingItem
                    && !canMergePerishableStacks(existingItem, item)
                ) {
                    ui.notifications.warn(MERGE_BLOCKED_MESSAGE);
                    return;
                }

                if (existingItem) {
                    await existingItem.update({
                        "system.quantity": existingItem.system.quantity + quantityTransfered
                    });
                } else {
                    const createData = item.toObject();
                    await this.document.createEmbeddedDocuments("Item", [
                        {
                            ...createData,
                            system: {
                                ...createData.system,
                                quantity: quantityTransfered
                            }
                        }
                    ]);
                }

                if (quantityTransfered === actorItem.system.quantity) {
                    await originActor.deleteEmbeddedDocuments("Item", [data.originId]);
                } else {
                    await actorItem.update({
                        "system.quantity": actorItem.system.quantity - quantityTransfered
                    });
                }
            }
            return;
        }

        await this.document.createEmbeddedDocuments("Item", [item.toObject()]);
        await originActor.deleteEmbeddedDocuments("Item", [data.originId]);
    };

    Base.prototype._onDropItem[GUARD_FLAG] = true;
}

function registerDnD5eSpoilageMergeGuard() {
    const Base = getDnD5eBaseActorSheet();
    if (!Base?.prototype?._onDropStackConsumables) return;
    if (Base.prototype._onDropStackConsumables[GUARD_FLAG]) return;

    const original = Base.prototype._onDropStackConsumables;

    Base.prototype._onDropStackConsumables = function ionriftRespiteGuardedDropStackConsumables(
        event,
        itemData,
        options = {}
    ) {
        const container = options.container ?? null;
        const similarItem = findDnD5eSimilarConsumable(this, itemData, container);

        if (similarItem && !canMergePerishableStacks(similarItem, itemData)) {
            ui.notifications.warn(MERGE_BLOCKED_MESSAGE);
            return null;
        }

        return original.call(this, event, itemData, options);
    };

    Base.prototype._onDropStackConsumables[GUARD_FLAG] = true;
}

export function registerSpoilageMergeGuard() {
    Hooks.once("ready", () => {
        if (game.system?.id === "daggerheart") {
            registerDaggerheartSpoilageMergeGuard();
        }
        if (game.system?.id === "dnd5e") {
            registerDnD5eSpoilageMergeGuard();
        }
    });
}
