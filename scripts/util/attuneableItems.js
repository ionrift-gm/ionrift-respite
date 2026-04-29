/**
 * dnd5e: items in inventory that can still be attuned to (requires it, not yet attuned).
 * @param {Actor} actor
 * @returns {{ id: string, name: string }[]}
 */
export function getAttuneableItemOptions(actor) {
    if (!actor?.items) return [];
    return (actor.items?.filter((i) => {
        const att = i.system?.attunement;
        return (att === "required" || att === 1) && !i.system?.attuned;
    }) ?? []).map((i) => ({ id: i.id, name: i.name }));
}
