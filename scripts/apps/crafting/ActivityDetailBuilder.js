/**
 * ActivityDetailBuilder.js
 *
 * Single source of truth for activity card and detail panel data.
 *
 * Both the TotM mode and the spatial StationActivityDialog call these
 * functions; nothing is computed in two places any more.
 *
 * Exports:
 *   buildActivityListItem(activityId, activity, actor, partyState, isAvailable)
 *   buildActivityDetailContext(activityId, activity, actor, opts)
 */

import {
    ACTIVITY_ICONS,
    getActivityAdvisory,
    buildFollowUpDataForActivity,
    buildCheckLabelForActivity
} from "../../data/RestConstants.js";
import { CARD_FADED_HINTS, clipToCardHint } from "../../data/activityCardHint.js";
import { MODULE_ID } from "../../data/moduleId.js";
import { applyWatchAlertPhrase, presentCombatModifiers } from "../../services/rest/flow/WatchAlertBenefit.js";
import { getFletchingTierLabel } from "../../services/crafting/settings/FletchingSettings.js";

/**
 * Resolve the armour sleep hint for an actor doing a given activity.
 * Returns { text, type: "warning"|"positive" } or null.
 * Pure. No Foundry globals needed (actor.items is passed in).
 *
 * @param {object} actor
 * @param {object} activity
 * @param {boolean} armorRuleEnabled
 * @returns {{ text: string, type: string }|null}
 */
function _resolveArmorHint(actor, activity, armorRuleEnabled) {
    if (!armorRuleEnabled) return null;
    const equippedArmor = (actor?.items ?? []).find(i => {
        if (i.type !== "equipment" || !i.system?.equipped) return false;
        const t = i.system?.type?.value ?? i.system?.armor?.type ?? "";
        return t === "medium" || t === "heavy";
    });
    if (!equippedArmor) return null;
    if (activity.armorSleepWaiver) {
        return { text: "Sleeping light between rotations. Armor stays on, weapon close. No HP or HD recovery penalty.", type: "positive" };
    }
    return { text: "Sleeping in armor. Recover only 1/4 Hit Dice, exhaustion not reduced (Xanathar's). Consider doffing first.", type: "warning" };
}

function equippedRestArmor(actor) {
    return (actor?.items ?? []).find(item => {
        if (item.type !== "equipment" || !item.system?.equipped) return false;
        const armorType = item.system?.type?.value ?? item.system?.armor?.type ?? "";
        return armorType === "medium" || armorType === "heavy";
    }) ?? null;
}

/**
 * Cooking and crafting skip the activity detail, so they never reached the
 * doff prompt. Same gate as a normal confirm: proceed, or stop and doff.
 * @param {object} actor
 * @param {object} activity
 * @returns {Promise<boolean>}
 */
export async function promptArmorSleepIfNeeded(actor, activity) {
    if (!actor || activity?.armorSleepWaiver) return true;
    let armorRuleEnabled = false;
    try {
        armorRuleEnabled = !!game.settings.get(MODULE_ID, "armorDoffRule");
    } catch {
        return true;
    }
    if (!armorRuleEnabled) return true;
    const equippedArmor = equippedRestArmor(actor);
    if (!equippedArmor) return true;
    const confirmFn = game.ionrift?.library?.confirm ?? Dialog.confirm.bind(Dialog);
    const proceed = await confirmFn({
        title: "Sleeping in Armor",
        content: `<p><strong>${equippedArmor.name}</strong> is equipped. Sleeping in medium or heavy armor limits recovery to 1/4 Hit Dice and prevents exhaustion reduction (Xanathar's rules).</p><p>Doff the armor before confirming, or proceed and accept the penalty.</p>`,
        yesLabel: "Confirm Anyway",
        noLabel: "Cancel",
        yesIcon: "fas fa-check",
        noIcon: "fas fa-times",
        defaultYes: false
    });
    return !!proceed;
}

/**
 * Build a single card-list item for an activity.
 *
 * This is the canonical source for card hints in both TotM and Spatial modes.
 * - Available card: advisory text if present. Description stays on the detail view.
 * - Faded card: act.fadedHint from the activity schema
 * - nonViable: advisory.nonViable (e.g. no injured party members for Tend Wounds)
 *
 * @param {string}  activityId
 * @param {object}  activity    - Activity schema from ActivityResolver
 * @param {object}  actor       - Actor viewing the card (used for advisory)
 * @param {object}  partyState  - From buildPartyState()
 * @param {boolean} isAvailable - Whether the activity is in the available (not faded) list
 * @returns {object}
 */
export function buildActivityListItem(activityId, activity, actor, partyState, isAvailable) {
    const icon = ACTIVITY_ICONS[activityId] ?? activity?.icon ?? "fas fa-circle";

    if (isAvailable) {
        const advisory = actor
            ? getActivityAdvisory(activityId, actor, partyState)
            : { text: "", urgent: false, nonViable: false };
        const advRaw = (advisory.text !== null && advisory.text !== undefined)
            ? String(advisory.text).trim()
            : "";
        const hasAdvisory = advRaw.length > 0;
        const hintText = hasAdvisory ? advRaw : "";
        const nv = !!advisory.nonViable;

        return {
            id:         activityId,
            name:       activity?.name ?? activityId,
            icon,
            hint:       clipToCardHint(hintText),
            hintUrgent: hasAdvisory && !!advisory.urgent,
            available:  !nv,
            nonViable:  nv,
            fadedHint:  nv ? hintText : null,
            isCrafting: !!activity?.crafting?.enabled,
            profession: activity?.crafting?.profession ?? null,
            hasFollowUp: !!activity?.followUp
        };
    }

    // Faded: always show the schema's fadedHint, not an advisory
    const fadedText = activity?.fadedHint ?? CARD_FADED_HINTS.unavailable;
    return {
        id:         activityId,
        name:       activity?.name ?? activityId,
        icon,
        hint:       clipToCardHint(fadedText),
        hintUrgent: false,
        available:  false,
        nonViable:  false,
        fadedHint:  fadedText,
        isCrafting: !!activity?.crafting?.enabled,
        profession: activity?.crafting?.profession ?? null,
        hasFollowUp: !!activity?.followUp
    };
}

/**
 * Build the full detail panel descriptor for an activity.
 *
 * Consumed by both:
 *   - TotM: RestSetupApp._prepareContext() ,  totmDetailPanel
 *   - Spatial: StationActivityDialog._buildDetailContext()
 *
 * @param {string} activityId
 * @param {object} activity        - Activity schema from ActivityResolver
 * @param {object} actor           - The actor doing the activity
 * @param {object} partyState      - From buildPartyState()
 * @param {object} [opts]
 * @param {string} [opts.comfort]        - Comfort tier key (default "sheltered")
 * @param {string|null} [opts.followUpValue] - Pre-selected follow-up value
 * @param {boolean} [opts.armorRuleEnabled]  - Whether the armour-doff rule is on
 * @param {Function|null} [opts.getArmorWarning] - restApp.getArmorWarningForActivityDetail(actor, activity)
 * @returns {object} Detail descriptor
 */
export function buildActivityDetailContext(activityId, activity, actor, partyState, opts = {}) {
    const {
        comfort = "sheltered",
        followUpValue = null,
        armorRuleEnabled = false,
        getArmorWarning = null
    } = opts;

    if (!activity) {
        return {
            id: activityId, name: activityId,
            icon: ACTIVITY_ICONS[activityId] ?? "fas fa-circle",
            description: null, checkLabel: null, hasNoCheck: true,
            advisory: null, advisoryUrgent: false,
            outcomeHints: [], followUpData: null,
            armorHint: null, armorWarning: null,
            combatModifiers: null, isCrafting: false,
            characterId: actor?.id ?? null
        };
    }

    const icon = ACTIVITY_ICONS[activityId] ?? activity.icon ?? "fas fa-circle";

    const outcomeHints = [];
    for (const tier of ["success", "exceptional", "failure"]) {
        for (const eff of (activity.outcomes?.[tier]?.effects ?? [])) {
            if (eff.description) outcomeHints.push({ text: applyWatchAlertPhrase(eff.description), type: tier });
        }
    }
    if (activityId === "act_fletch" && !outcomeHints.length) {
        const yieldLabel = getFletchingTierLabel();
        const kind = followUpValue === "bolts" ? "bolts" : "arrows";
        const text = yieldLabel && yieldLabel !== "Off"
            ? `Pass the check, then roll ${yieldLabel} ${kind}.`
            : "Replenishes ammunition on a successful check.";
        outcomeHints.push({ text, type: "success" });
    }

    const checkLabel = buildCheckLabelForActivity(activity, actor, comfort, followUpValue);

    const followUpData = buildFollowUpDataForActivity(activityId, activity, actor, followUpValue);

    const armorHint = _resolveArmorHint(actor, activity, armorRuleEnabled);

    const armorWarning = getArmorWarning ? getArmorWarning(actor, activity) : null;

    // The advisory drives both the at-a-glance card hint and the blue pill in
    // the detail panel. When the advisory is flagged cardOnly, it is a static
    // mechanical summary that simply restates the success-outcome chevron
    // already shown below; skip it here so the two do not visually compete.
    const advisory = actor && partyState
        ? getActivityAdvisory(activityId, actor, partyState)
        : null;
    let advText = (advisory?.text !== null && advisory?.text !== undefined && !advisory?.cardOnly)
        ? String(advisory.text).trim()
        : "";
    let advUrgent = !!advisory?.urgent;
    if (activityId === "act_watch" && advText.toLowerCase().includes("no one on watch")) {
        advUrgent = false;
        advText = "Party currently has no guard assigned to watch.";
    }

    return {
        id:               activityId,
        name:             activity.name,
        icon,
        description:      activity.description || null,
        checkLabel,
        hasNoCheck:       !activity.check,
        advisory:         advText || null,
        advisoryUrgent:   advUrgent,
        outcomeHints,
        followUpData,
        armorHint,
        armorWarning,
        combatModifiers:  presentCombatModifiers(activity.combatModifiers),
        isCrafting:       !!activity.crafting?.enabled,
        characterId:      actor?.id ?? null
    };
}
