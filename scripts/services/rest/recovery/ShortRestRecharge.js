/**
 * Labels for dnd5e class features and items that typically recover on a short rest.
 * Uses item system uses recovery period "sr" (dnd5e v4+).
 * @param {Actor} actor
 * @returns {string[]}
 */
export function getShortRestRechargeLabels(actor) {
    if (!actor?.items || game.system?.id !== "dnd5e") return [];
    const labels = [];
    for (const item of actor.items) {
        const rec = item.system?.uses?.recovery;
        if (!Array.isArray(rec) || !rec.length) continue;
        if (rec.some((r) => r.period === "sr")) {
            if (item.name) labels.push(item.name);
        }
    }
    return labels;
}
