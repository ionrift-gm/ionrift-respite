/**
 * Last-watch send-off for a gritty week.
 *
 * Buff meals and drinks are not applied when the rest completes. They use
 * the same beat as a normal rest: each serving is applied on its own, with
 * its roll, before the last night opens.
 */

import { MODULE_ID } from "../../../data/moduleId.js";
import { consumeItem } from "../../meal/inventory/MealItemConsumer.js";
import { describeItemMealBuff } from "../../meal/buffs/MealBuffPresets.js";
import { provisionNeedsBeat } from "../../meal/buffs/MealBuffBeat.js";
import { applyProvisionBuff } from "../../meal/buffs/WellFedService.js";

/**
 * @param {string} actorId
 * @param {"food"|"drink"} kind
 * @param {string} itemId
 * @returns {string}
 */
export function sendoffRowId(actorId, kind, itemId) {
    return `${actorId}:${kind}:${itemId}`;
}

/**
 * Night 6 of a 7-night week is the gate. A single overnight has no last watch
 * to hold for.
 * @param {{ totalNights: number, activeNight: number, pending: number }} args
 * @returns {boolean}
 */
export function holdsForSendoff({ totalNights, activeNight, pending }) {
    return totalNights > 1 && activeNight === totalNights - 1 && pending > 0;
}

function itemOn(actor, itemId) {
    if (!actor || !itemId) return null;
    if (typeof actor.items?.get === "function") return actor.items.get(itemId) ?? null;
    return actor.items?.find?.(entry => entry.id === itemId) ?? null;
}

function satiatesWater(flags) {
    const satiates = Array.isArray(flags?.satiates) ? flags.satiates : [];
    return satiates.includes("water") || flags?.satiatesWater === true;
}

/**
 * Rows for the send-off beat. Plain rations are omitted. An already applied
 * serving stays on the card so the result is still visible.
 *
 * @param {object} args
 * @param {Actor[]} args.actors
 * @param {Map<string, string>} [args.meals]
 * @param {Map<string, string>} [args.drinks]
 * @param {object[]} [args.applied]
 * @returns {object[]}
 */
export function collectSendoffRows({ actors = [], meals, drinks, applied = [] } = {}) {
    const appliedById = new Map(applied.map(row => [
        sendoffRowId(row.actorId, row.kind, row.itemId),
        row
    ]));
    const rows = [];

    for (const actor of actors) {
        const picks = [
            ["food", meals?.get?.(actor.id)],
            ["drink", drinks?.get?.(actor.id)]
        ];
        for (const [kind, itemId] of picks) {
            if (!itemId) continue;
            const id = sendoffRowId(actor.id, kind, itemId);
            const prior = appliedById.get(id);
            const item = itemOn(actor, itemId);
            const flags = item?.flags?.[MODULE_ID] ?? {};
            if (!prior && !provisionNeedsBeat(flags)) continue;
            const described = describeItemMealBuff(flags);
            rows.push({
                id,
                actorId: actor.id,
                actorName: actor.name ?? "",
                kind,
                itemId,
                itemName: prior?.itemName || item?.name || (kind === "drink" ? "Drink" : "Meal"),
                buffSummary: described.buffSummary || prior?.buffSummary || "",
                applied: Boolean(prior),
                resultLine: prior?.resultLine ?? ""
            });
        }
    }

    return rows;
}

/**
 * Serve one chosen send-off. Consumes a unit and applies the buff, including
 * any roll on that buff.
 *
 * @param {object} args
 * @param {Actor} args.actor
 * @param {string} args.itemId
 * @param {"food"|"drink"} args.kind
 * @param {string[]} [args.partyIds]
 * @returns {Promise<{ ok: boolean, record?: object, resultLine?: string }>}
 */
export async function applySendoffServing({ actor, itemId, kind, partyIds = [] }) {
    const item = itemOn(actor, itemId);
    if (!actor || !item) {
        return { ok: false, resultLine: "No longer in the pack" };
    }
    const flags = item.flags?.[MODULE_ID] ?? {};
    const snapshot = item.toObject ? item.toObject() : item;
    const taken = await consumeItem(actor, item.id, 1);
    if (taken <= 0) {
        return { ok: false, resultLine: "Could not serve" };
    }

    let resultLine = "";
    try {
        const outcome = await applyProvisionBuff({
            consumerActor: actor,
            itemSnapshot: snapshot,
            partyIds,
            kind
        });
        const described = describeItemMealBuff(flags);
        resultLine = (outcome?.lines ?? []).filter(Boolean).join("; ")
            || described.buffSummary
            || "Applied";
    } catch {
        resultLine = "Served";
    }

    return {
        ok: true,
        resultLine,
        record: {
            actorId: actor.id,
            kind,
            itemId,
            itemName: item.name ?? "",
            buffSummary: describeItemMealBuff(flags).buffSummary,
            fed: true,
            satiatesWater: satiatesWater(flags),
            resultLine
        }
    };
}
