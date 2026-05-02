/**
 * Blocks cross-actor Daggerheart inventory merges when perishable stacks
 * differ in calendar days remaining (matches SpoilageClock / badge math).
 */

import { SpoilageClock } from "./SpoilageClock.js";

const MODULE_ID = "ionrift-respite";

/**
 * Mirrors daggerheart `itemIsIdentical` so merge targets match core behavior.
 * @param {foundry.documents.Item} a
 * @param {foundry.documents.Item} b
 */
function daggerheartItemIsIdentical(a, b) {
    const compendiumSource = a._stats.compendiumSource === b._stats.compendiumSource;
    const name = a.name === b.name;
    const description = a.system.description === b.system.description;
    return compendiumSource && name & description;
}

function getDHBaseActorSheet() {
    return game.system?.api?.applications?.sheets?.api?.DHBaseActorSheet ?? null;
}

export function registerSpoilageMergeGuard() {
    Hooks.once("ready", () => {
        if (game.system?.id !== "daggerheart") return;

        const Base = getDHBaseActorSheet();
        if (!Base?.prototype?._onDropItem) return;
        if (Base.prototype._onDropItem.__ionriftRespiteSpoilageGuard) return;

        const original = Base.prototype._onDropItem;

        Base.prototype._onDropItem = async function ionriftRespiteGuardedOnDropItem(event, item) {
            const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
            const originActor = item.actor;

            if (
                item.actor?.uuid === this.document.uuid ||
                !originActor ||
                !["character", "party"].includes(this.document.type)
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
                        && !SpoilageClock.areStacksCompatible(existingItem, item)
                    ) {
                        ui.notifications.warn(
                            "Cannot merge items with different spoilage freshness. Keep separate stacks."
                        );
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

        Base.prototype._onDropItem.__ionriftRespiteSpoilageGuard = true;
    });
}
