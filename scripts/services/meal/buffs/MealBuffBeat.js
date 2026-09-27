/**
 * Servings that should pause before the night watch.
 * Plain rations and water do not. A meal or a drink with a buff does.
 */

import { describeItemMealBuff } from "./MealBuffPresets.js";
import { MODULE_ID } from "../inventory/MealConstants.js";

/**
 * @param {object|null|undefined} flags ionrift-respite item flags
 * @returns {boolean}
 */
export function provisionNeedsBeat(flags) {
    if (!flags || flags.buff === null) return false;
    if (flags.chefTreat) return true;
    const buff = flags.buff;
    if (Array.isArray(buff)) return buff.some(entry => entry?.type);
    return Boolean(buff?.type);
}

/**
 * One row per consumed unit that carries a buff.
 * @param {object[]} snapshots
 * @param {{ actorId: string, actorName: string, kind: "food"|"drink", partyIds?: string[], seq?: number }} meta
 * @returns {object[]}
 */
export function servingsFromSnapshots(snapshots, meta) {
    const rows = [];
    const base = meta?.seq ?? 0;
    for (let index = 0; index < (snapshots ?? []).length; index++) {
        const snapshot = snapshots[index];
        const flags = snapshot?.flags?.[MODULE_ID];
        if (!provisionNeedsBeat(flags)) continue;
        const described = describeItemMealBuff(flags);
        const itemId = snapshot._id ?? snapshot.name ?? "item";
        rows.push({
            id: `${meta.actorId}:${itemId}:${meta.kind}:${base + index}`,
            actorId: meta.actorId,
            actorName: meta.actorName ?? "",
            kind: meta.kind === "drink" ? "drink" : "food",
            itemName: snapshot.name ?? (meta.kind === "drink" ? "Drink" : "Meal"),
            buffSummary: described.buffSummary,
            itemSnapshot: snapshot,
            partyIds: meta.partyIds ?? [meta.actorId],
            applied: false,
            resultLine: ""
        });
    }
    return rows;
}

/**
 * @param {object[]|null|undefined} queue
 * @param {object|null|undefined} snapshot
 * @param {{ actorId: string, actorName: string, kind: "food"|"drink", partyIds?: string[] }} meta
 * @returns {object[]}
 */
export function enqueueProvision(queue, snapshot, meta) {
    const next = [...(queue ?? [])];
    const rows = servingsFromSnapshots(snapshot ? [snapshot] : [], { ...meta, seq: next.length });
    const seen = new Set(next.map(row => row.id));
    for (const row of rows) {
        if (seen.has(row.id)) continue;
        seen.add(row.id);
        next.push(row);
    }
    return next;
}

/**
 * Fold buff rows produced while rations were consumed into the beat queue.
 * @param {object[]|null|undefined} queue
 * @param {object[]|null|undefined} results
 * @returns {object[]}
 */
export function mergeBuffServings(queue, results) {
    const next = [...(queue ?? [])];
    const seen = new Set(next.map(row => row.id));
    for (const result of results ?? []) {
        for (const row of result?.buffServings ?? []) {
            if (!row?.id || seen.has(row.id)) continue;
            seen.add(row.id);
            next.push(row);
        }
    }
    return next;
}

/**
 * @param {object[]|null|undefined} queue
 * @returns {number}
 */
export function pendingBuffCount(queue) {
    return (queue ?? []).filter(row => row && !row.applied).length;
}
