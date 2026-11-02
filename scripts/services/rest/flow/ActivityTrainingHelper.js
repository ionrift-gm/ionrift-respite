import { MODULE_ID } from "../../../data/moduleId.js";
import { getComfortDcMod } from "../../camp/gear/ComfortCalculator.js";
import {
    applyFletchingYieldFloor,
    getFletchingTier
} from "../../crafting/settings/FletchingSettings.js";
import { getTrainingXpValues, getTrainingXpReduction } from "../../crafting/settings/TrainingSettings.js";

/**
 * Player rolls the fletch yield. The dialog names the dice and the count.
 * A missing roll service falls back to a quiet evaluate so the grant still lands.
 * @param {Actor} actor
 * @param {string} formula Proficiency already substituted.
 * @param {number} prof
 * @param {string} [followUpValue]
 * @returns {Promise<number>}
 */
export async function rollFletchYield(actor, formula, prof, followUpValue) {
    const tier = getFletchingTier();
    const bolts = followUpValue === "bolts";
    const grant = (total) => applyFletchingYieldFloor(total, tier, prof);
    const request = game.ionrift?.library?.rollRequest?.request;
    if (typeof request === "function") {
        const result = await request({
            actorId: actor.id,
            actorUuid: actor.uuid,
            type: "formula",
            formula,
            title: bolts
                ? game.i18n.localize("ionrift-respite.activityResolver.howManyBolts")
                : game.i18n.localize("ionrift-respite.activityResolver.howManyArrows"),
            tableLabel: formula,
            describeOutcome: async ({ total }) => {
                const made = grant(total);
                return bolts
                    ? (made === 1
                        ? game.i18n.format("ionrift-respite.activityResolver.yieldBoltOne", { count: made })
                        : game.i18n.format("ionrift-respite.activityResolver.yieldBoltMany", { count: made }))
                    : (made === 1
                        ? game.i18n.format("ionrift-respite.activityResolver.yieldArrowOne", { count: made })
                        : game.i18n.format("ionrift-respite.activityResolver.yieldArrowMany", { count: made }));
            }
        });
        return grant(result?.total);
    }
    const rolled = await new Roll(formula).evaluate();
    return grant(rolled.total);
}

/**
 * Builds the static roll context for a training rest: adjusted DC, the
 * actor's best ability modifier, per-set XP values, and the current
 * diminishing-returns reduction. Reads state only; does not roll or mutate.
 *
 * @param {Object} activity
 * @param {Actor} actor
 * @param {string} comfort
 * @param {boolean} safeRestSpot
 * @returns {Object}
 */
export function buildTrainingContext(activity, actor, comfort, safeRestSpot) {
    const baseDc = activity.check?.dc ?? 13;
    const comfortForDc = safeRestSpot ? "safe" : comfort;
    const adjustedDc = baseDc + getComfortDcMod(comfortForDc);
    const numRolls = Math.max(1, activity.check?.rolls ?? 1);

    const trainingAdapter = game.ionrift?.respite?.adapter;
    const getAbilityMod = (ability) => trainingAdapter
        ? trainingAdapter.getAbilityMod(actor, ability)
        : (actor.system?.abilities?.[ability]?.mod ?? 0);
    let abilityKey = activity.check?.ability ?? "best";
    if (abilityKey === "best") {
        const abilities = actor.system?.abilities ?? {};
        let bestKey = "str";
        let bestMod = -99;
        for (const [key] of Object.entries(abilities)) {
            const mod = getAbilityMod(key);
            if (mod > bestMod) { bestMod = mod; bestKey = key; }
        }
        abilityKey = bestKey;
    }
    const modifier = getAbilityMod(abilityKey);
    const rollLabel = String(abilityKey).toUpperCase();

    const tierXp = getTrainingXpValues();
    const successXP = tierXp?.passXp
        ?? activity.outcomes?.success?.effects?.find(e => e.type === "training_xp")?.value
        ?? 10;
    const failXP = tierXp?.failXp
        ?? activity.outcomes?.failure?.effects?.find(e => e.type === "training_xp")?.value
        ?? 3;

    const flagKey = activity.diminishingReturns?.actorFlag ?? "trainingStreak";
    const streak = activity.diminishingReturns ? (actor.getFlag(MODULE_ID, flagKey) ?? 0) : 0;
    const xpReduction = activity.diminishingReturns
        ? getTrainingXpReduction(streak)
        : 0;

    return { adjustedDc, numRolls, abilityKey, modifier, rollLabel, successXP, failXP, flagKey, streak, xpReduction };
}

/**
 * Rolls one training set against the context DC.
 *
 * @param {number} setNumber 1-based set index.
 * @param {Object} context Output of {@link buildTrainingContext}.
 * @returns {Promise<{set:number,total:number,passed:boolean,roll:Roll}>}
 */
export async function evaluateTrainingSet(setNumber, context) {
    const roll = await new Roll(`1d20 + ${context.modifier}`).evaluate();
    return { set: setNumber, total: roll.total, passed: roll.total >= context.adjustedDc, roll };
}

/**
 * Aggregates the rolled sets into an XP award, applies diminishing returns,
 * bumps the streak flag, posts the result whisper, and returns the activity
 * outcome fragment. Call once per training rest.
 *
 * @param {Object} activity
 * @param {string} activityId
 * @param {Actor} actor
 * @param {Array<{set:number,total:number,passed:boolean}>} rolls
 * @param {Object} context Output of {@link buildTrainingContext}.
 * @param {Object} [opts]
 * @param {boolean} [opts.whisper=true] Post the chat whisper.
 * @returns {Promise<Object>}
 */
export async function finalizeTrainingOutcome(activity, activityId, actor, rolls, context, opts = {}) {
    const { whisper = true } = opts;
    const cleanRolls = rolls.map(r => ({ set: r.set, total: r.total, passed: r.passed }));
    const successes = cleanRolls.filter(r => r.passed).length;
    const baseXP = cleanRolls.reduce(
        (sum, r) => sum + (r.passed ? context.successXP : context.failXP), 0
    );

    if (activity.diminishingReturns) {
        await actor.setFlag(MODULE_ID, context.flagKey, context.streak + 1);
    }
    const xpReduction = context.xpReduction ?? 0;
    const awardedXP = Math.max(0, baseXP - xpReduction);

    const numRolls = context.numRolls ?? cleanRolls.length;
    const tier = successes > 0 ? "success" : "failure";
    const narrative = activity.outcomes?.[tier]?.narrative ?? "";

    if (whisper) {
        try {
            const ownerIds = game.users
                .filter(u => actor.testUserPermission(u, "OWNER") || u.isGM)
                .map(u => u.id);
            const missSuffix = ` (${game.i18n.localize("ionrift-respite.activityResolver.miss")})`;
            const segments = cleanRolls
                .map(r => `<strong style="color:${r.passed ? "#1c6ea4" : "#a83232"};">${r.total}${r.passed ? "" : missSuffix}</strong>`)
                .join(" &bull; ");
            const reductionNote = xpReduction > 0
                ? `<br><span style="opacity:0.8;font-size:0.9em;">${game.i18n.format("ionrift-respite.activityResolver.diminishingReturnsNote", { xp: xpReduction })}</span>`
                : "";
            const landedNote = game.i18n.format("ionrift-respite.activityResolver.trainingLanded", {
                successes,
                total: numRolls,
                xp: awardedXP
            });
            await ChatMessage.create({
                speaker: ChatMessage.getSpeaker({ actor }),
                whisper: ownerIds,
                flavor: `<strong>${activity.name}</strong> (${context.rollLabel}) - DC ${context.adjustedDc}<br>Sets: ${segments}<br><strong style="color:#6b4f00;">${landedNote}</strong>${reductionNote}`,
                flags: { [MODULE_ID]: { type: "trainingResult" } }
            });
        } catch (e) {
            console.warn("ionrift-respite | Training whisper failed:", e);
        }
    }

    return {
        source: "activity",
        activityId,
        result: tier,
        items: [],
        effects: [
            {
                type: "training_xp",
                value: awardedXP,
                baseValue: baseXP,
                reduction: xpReduction,
                description: awardedXP > 0
                    ? game.i18n.format("ionrift-respite.activityResolver.trainingXpAwarded", {
                        xp: awardedXP,
                        successes,
                        total: numRolls
                    })
                    : game.i18n.localize("ionrift-respite.activityResolver.trainingNoXp")
            }
        ],
        narrative,
        xpReduction,
        training: { rolls: cleanRolls, successes, numRolls, baseXP, xpReduction, awardedXP, dc: context.adjustedDc, rollLabel: context.rollLabel }
    };
}
