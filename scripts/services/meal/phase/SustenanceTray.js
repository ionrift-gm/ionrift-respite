/**
 * Crumb tray after portions already sitting in slots.
 * `available` is what is left to place. `stock` is the inventory total,
 * which the assignment cap compares against.
 */

function countFilledSelections(slots) {
    const counts = new Map();
    for (const slot of slots ?? []) {
        const id = slot?.selected;
        if (!slot?.filled || !id || id === "skip") continue;
        counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return counts;
}

/**
 * @param {object[]} options
 * @param {object[]} slots
 * @returns {object[]}
 */
function stackKey(option) {
    const name = String(option?.name ?? "").trim().toLowerCase();
    const spoil = option?.perishable ? `${option.spoilClass ?? ""}|${option.spoilText ?? ""}` : "";
    return `${name}|${spoil}`;
}

/**
 * Identical rations and pints share one chip. `sources` keeps each item
 * document so a pour still comes out of a stack that has some left.
 * @param {object[]} rows
 * @returns {object[]}
 */
function stackIdenticalRows(rows) {
    const groups = new Map();
    for (const row of rows) {
        const key = stackKey(row);
        const source = { id: row.id, stock: row.stock };
        const existing = groups.get(key);
        if (!existing) {
            groups.set(key, { ...row, sources: [source] });
            continue;
        }
        existing.available += row.available;
        existing.stock += row.stock;
        existing.sources.push(source);
        if (!existing.img && row.img) existing.img = row.img;
    }
    for (const group of groups.values()) {
        group.sourcesAttr = group.sources.map(source => `${source.id}:${source.stock}`).join(",");
    }
    return [...groups.values()];
}

/**
 * @param {string} encoded
 * @param {string} fallbackId
 * @param {number|string} fallbackStock
 * @returns {{ id: string, stock: number }[]}
 */
export function parseStackSources(encoded, fallbackId, fallbackStock) {
    const members = [];
    for (const part of String(encoded ?? "").split(",")) {
        if (!part) continue;
        const splitAt = part.lastIndexOf(":");
        if (splitAt <= 0) continue;
        const id = part.slice(0, splitAt);
        const stock = Number(part.slice(splitAt + 1));
        if (!id) continue;
        members.push({ id, stock: Number.isFinite(stock) ? stock : 0 });
    }
    if (!members.length && fallbackId) {
        const stock = Number(fallbackStock);
        members.push({
            id: fallbackId,
            stock: Number.isFinite(stock) ? stock : Number.POSITIVE_INFINITY
        });
    }
    return members;
}

/**
 * Next item document in a stacked chip that still has an unassigned unit.
 * @param {{ id: string, stock: number }[]} members
 * @param {string[]} assignedIds
 * @returns {string|null}
 */
export function pickStackMember(members, assignedIds) {
    const counts = new Map();
    for (const id of assignedIds ?? []) {
        if (!id || id === "skip") continue;
        counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    for (const member of members ?? []) {
        if ((counts.get(member.id) ?? 0) < member.stock) return member.id;
    }
    return null;
}

/**
 * @param {object[]} options
 * @param {object[]} slots
 * @returns {object[]}
 */
export function sustenanceTrayRows(options, slots) {
    const counts = countFilledSelections(slots);
    const rows = [];
    for (const option of options ?? []) {
        const stock = Number(option?.available);
        const total = Number.isFinite(stock) ? stock : 0;
        const id = option?.value ?? option?.id;
        if (!id) continue;
        const remaining = Math.max(0, total - (counts.get(id) ?? 0));
        if (remaining <= 0) continue;
        rows.push({
            id,
            name: option.name ?? "",
            img: option.icon ?? option.img ?? "",
            available: remaining,
            stock: total,
            hasBuff: Boolean(option.hasBuff),
            isDry: false,
            isSelected: Boolean(option.isSelected),
            perishable: Boolean(option.perishable),
            spoilClass: option.spoilClass ?? "",
            spoilText: option.spoilText ?? ""
        });
    }
    return stackIdenticalRows(rows);
}
