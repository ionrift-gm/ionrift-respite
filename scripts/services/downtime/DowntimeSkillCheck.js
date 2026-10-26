import { ActivityRegistry } from "../../data/downtime/ActivityRegistry.js";
import { presentRoll } from "/modules/ionrift-library/scripts/services/rolls/DiceSettle.js";
import { ItemOutcomeHandler } from "../crafting/outcomes/ItemOutcomeHandler.js";
import { findFletchAmmoStack, fletchAmmoSubtype } from "../crafting/outcomes/FletchAmmoStack.js";
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
        const subtype = item.system?.type?.subtype;
        const qty = Number(item.system?.quantity ?? 0);
        if (subtype === "crossbowBolt" || (!subtype && /bolt/i.test(name))) bolts += qty;
        else if (subtype === "arrow" || (!subtype && /arrow/i.test(name))) arrows += qty;
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
    const defaultChecks = game.i18n.localize("ionrift-respite.downtimeSkillCheck.checks");
    const label = names.length === 1 ? names[0] : defaultChecks;
    const statusName = names.length === 1 ? String(names[0]).split(" ")[0] : defaultChecks;
    const rolled = Number(rolledCount) || 0;
    const success = Number(successCount) || 0;
    let tooltip = game.i18n.localize("ionrift-respite.downtimeSkillCheck.tooltipDefault");
    if (names.length === 1 && actDef?.check) {
        const skillNames = (actDef.check.skills ?? [])
            .map(key => SKILL_DISPLAY_NAMES[key] ?? key);
        const dc = actDef.check.dc ?? 12;
        const orWord = game.i18n.localize("ionrift-respite.downtimeSkillCheck.or");
        tooltip = skillNames.length ? game.i18n.format("ionrift-respite.downtimeSkillCheck.tooltipWithSkills", { skills: skillNames.join(` ${orWord} `), dc }) : game.i18n.format("ionrift-respite.downtimeSkillCheck.tooltipDcOnly", { dc });
        if (actDef.id === "fletch") {
            tooltip += ` ${game.i18n.localize("ionrift-respite.downtimeSkillCheck.fletchSuccessAdds")}`;
            const made = Number(fletchYield) || 0;
            if (made > 0) tooltip += ` ${game.i18n.format("ionrift-respite.downtimeSkillCheck.fletchMadeSoFar", { count: made })}`;
        }
    } else if (names.length > 1) {
        tooltip = game.i18n.format("ionrift-respite.downtimeSkillCheck.tooltipRollNames", { names: names.join(", ") });
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
    if (arrows) bits.push(game.i18n.format(arrows === 1 ? "ionrift-respite.downtimeSkillCheck.arrowSingular" : "ionrift-respite.downtimeSkillCheck.arrowPlural", { count: arrows }));
    if (bolts) bits.push(game.i18n.format(bolts === 1 ? "ionrift-respite.downtimeSkillCheck.boltSingular" : "ionrift-respite.downtimeSkillCheck.boltPlural", { count: bolts }));
    return bits.length ? game.i18n.format("ionrift-respite.downtimeSkillCheck.fletchAdded", { bits: bits.join(", ") }) : "";
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
    const stack = findFletchAmmoStack(actor, spec.kind);
    await ItemOutcomeHandler.grantItemsToActor(actor, [{
        name: stack?.name ?? spec.name,
        type: "consumable",
        img: spec.img,
        quantity: qty,
        system: { type: { value: "ammo", subtype: fletchAmmoSubtype(spec.kind) } },
        ...(stack ? { stackOntoId: stack.id } : {})
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
    const flavor = game.i18n.format("ionrift-respite.downtimeSkillCheck.rollFlavor", { name: actor.name, activity: actDef.label, skill: skillName, dc });
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
