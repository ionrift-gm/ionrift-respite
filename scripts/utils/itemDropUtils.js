/**
 * Whether an item is a dnd5e potion-type consumable.
 * @param {Item} item
 * @returns {boolean}
 */
export function itemIsDnD5ePotionType(item) {
    return item?.type === "consumable" && item.system?.type?.value === "potion";
}

/**
 * Resolve an Item from a browser drop event (character sheet, sidebar, etc.).
 * Handles Foundry v12/v14 TextEditor API variants and legacy drop data formats.
 * @param {DragEvent} event
 * @returns {Promise<Item|null>}
 */
export async function resolveItemFromDropEvent(event) {
    const TE = globalThis.foundry?.applications?.ux?.TextEditor ?? globalThis.TextEditor;
    let data = null;
    if (typeof TE?.getDragEventData === "function") {
        data = TE.getDragEventData(event);
    } else if (TE?.implementation && typeof TE.implementation.getDragEventData === "function") {
        data = TE.implementation.getDragEventData(event);
    }
    if (!data?.type) {
        try {
            data = JSON.parse(event.dataTransfer?.getData("text/plain") || "{}");
        } catch {
            data = null;
        }
    }
    if (!data?.type || data.type !== "Item") return null;
    if (data.uuid) {
        const doc = fromUuidSync(data.uuid);
        return doc instanceof Item ? doc : null;
    }
    if (typeof Item.implementation?.fromDropData === "function") {
        try {
            const doc = await Item.implementation.fromDropData(data);
            return doc instanceof Item ? doc : null;
        } catch {
            return null;
        }
    }
    return null;
}
