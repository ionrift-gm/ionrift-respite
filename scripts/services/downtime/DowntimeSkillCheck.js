import { ActivityRegistry } from "../../data/downtime/ActivityRegistry.js";
import { presentRoll } from "/modules/ionrift-library/scripts/services/rolls/DiceSettle.js";
import { ItemOutcomeHandler } from "../crafting/outcomes/ItemOutcomeHandler.js";
import {
    applyFletchingYieldFloor,
    getFletchingTier,
    getFletchingYieldFormula,
    isFletchingEnabled
} from "../crafting/settings/FletchingSettings.js";
import {
    executePlayerRoll,
    pickBestSkill,
    SKILL_DISPLAY_NAMES
} from "../ui/rollRequest/RollRequestManager.js";

const FLETCH_KINDS = {
    arrows: {
        kind: "arrows",
        name: "Arrow",
        img: "icons/weapons/ammunition/arrow-head-war-flight.webp"
    },
    bolts: {
        kind: "bolts",
        name: "Crossbow Bolt",
        img: "icons/weapons/ammunition/bolt-tip-engraved.webp"
    }
};

/**
 * Ammunition a fletch day should add. Bolts only when that is the sole ammo on hand.
 * @param {Actor} actor
 * @returns {"arrows"|"bolts"}
 */
export function pickFletchKind(actor) {
    let arrows = 0;
    let bolts = 0;
    for (const item of actor?.items ?? []) {
        if (item?.type !== "consumable") continue;
        if (item.system?.type?.value !== "ammo") continue;
        const name = String(item.name ?? "");
        const qty = Number(item.system?.quantity ?? 0);
        if (/bolt/i.test(name)) bolts += qty;
        else if (/arrow/i.test(name)) arrows += qty;
    }
    if (bolts > 0 && arrows === 0) return "bolts";
    return "arrows";
}

/**
 * Rail copy for locked skill-check days (fletch, tend, and the like).
 * Fortify stays on the defense rail.
 * @param {object} input
 * @returns {object|null}
 */
export function buildSkillCheckSummary({
    dayCount,
    rolledCount,
    successCount,
    labels,
    actDef,
    fletchYield = 0
}) {
    const days = Number(dayCount) || 0;
    if (days <= 0) return null;
    const names = Array.isArray(labels) ? labels.filter(Boolean) : [];
    const label = names.length === 1 ? names[0] : "Checks";
    const statusName = names.length === 1 ? String(names[0]).split(" ")[0] : "Checks";
    const rolled = Number(rolledCount) || 0;
    const success = Number(successCount) || 0;
    let tooltip = "Skill checks for the week.";
    if (names.length === 1 && actDef?.check) {
        const skillNames = (actDef.check.skills ?? [])
            .map(key => SKILL_DISPLAY_NAMES[key] ?? key);
        const dc = actDef.check.dc ?? 12;
        tooltip = skillNames.length ? `${skillNames.join(" or ")}, DC ${dc}.` : `DC ${dc}.`;
        if (actDef.id === "fletch") {
            tooltip += " Success adds arrows or bolts.";
            const made = Number(fletchYield) || 0;
            if (made > 0) tooltip += ` ${made} made so far.`;
        }
    } else if (names.length > 1) {
        tooltip = `Roll ${names.join(", ")}.`;
    }
    return {
        assignedDays: days,
        rolledCount: rolled,
        unrolledCount: Math.max(0, days - rolled),
        successCount: success,
        isAllRolled: rolled >= days,
        label,
        statusName,
        resultLabel: `${success}/${days} ${label}`,
        tooltip
    };
}

/**
 * @param {Array<{kind?: string, qty?: number}>} grants
 * @returns {string}
 */
export function formatFletchGrantNotice(grants) {
    let arrows = 0;
    let bolts = 0;
    for (const grant of grants ?? []) {
        const qty = Number(grant?.qty) || 0;
        if (qty <= 0) continue;
        if (grant.kind === "bolts") bolts += qty;
        else arrows += qty;
    }
    const bits = [];
    if (arrows) bits.push(`${arrows} ${arrows === 1 ? "arrow" : "arrows"}`);
    if (bolts) bits.push(`${bolts} ${bolts === 1 ? "bolt" : "bolts"}`);
    return bits.length ? `${bits.join(", ")} added.` : "";
}

async function rollFletchQuantity(actor) {
    if (!isFletchingEnabled()) return 0;
    const formula = getFletchingYieldFormula();
    if (!formula) return 0;
    const prof = Number(actor?.system?.attributes?.prof ?? 2);
    const expr = formula.replace(/prof/gi, String(prof));
    let total = prof;
    try {
        const roll = new Roll(expr);
        await roll.evaluate();
        total = roll.total;
        await presentRoll(roll);
    } catch {
        total = prof;
    }
    return applyFletchingYieldFloor(total, getFletchingTier(), prof);
}

async function grantFletchDay(actor, dayRoll, kind) {
    const qty = await rollFletchQuantity(actor);
    if (qty <= 0) return null;
    const spec = FLETCH_KINDS[kind] ?? FLETCH_KINDS.arrows;
    await ItemOutcomeHandler.grantItemsToActor(actor, [{
        name: spec.name,
        type: "consumable",
        img: spec.img,
        quantity: qty,
        system: { type: { value: "ammo" } }
    }]);
    dayRoll.yieldGranted = true;
    dayRoll.yieldQty = (Number(dayRoll.yieldQty) || 0) + qty;
    dayRoll.fletchKind = spec.kind;
    return { kind: spec.kind, qty, name: spec.name };
}

/**
 * One downtime skill check, posted to chat. A successful fletch day adds ammo.
 * @param {Actor} actor
 * @param {object} dayRoll
 * @param {{ fletchKind?: "arrows"|"bolts" }} [options]
 */
export async function rollDowntimeSkillDay(actor, dayRoll, options = {}) {
    const actDef = ActivityRegistry.getActivity(dayRoll?.activityId);
    const checkDef = actDef?.check;
    if (!actor || !checkDef) return { granted: null };

    const skills = checkDef.skills?.length
        ? checkDef.skills
        : [actDef.skill].filter(Boolean);
    const skill = pickBestSkill(actor, skills);
    const dc = checkDef.dc ?? 12;
    const skillName = SKILL_DISPLAY_NAMES[skill] ?? skill;
    const flavor = `<strong>${actor.name}</strong>: ${actDef.label} (${skillName}), DC ${dc}`;
    const { total, passed } = await executePlayerRoll(actor, skill, dc, flavor);

    dayRoll.rolled = true;
    dayRoll.rollTotal = total;
    dayRoll.dc = dc;
    dayRoll.success = passed;
    dayRoll.skillUsed = skill;

    let granted = null;
    if (dayRoll.activityId === "fletch" && passed && !dayRoll.yieldGranted) {
        const kind = options.fletchKind ?? dayRoll.fletchKind ?? pickFletchKind(actor);
        granted = await grantFletchDay(actor, dayRoll, kind);
    }
    return { total, passed, skill, granted };
}
