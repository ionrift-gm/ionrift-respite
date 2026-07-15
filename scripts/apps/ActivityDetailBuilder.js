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
} from "../data/RestConstants.js";

// ─── Internal helper ─────────────────────────────────────────────────────────

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

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Build a single card-list item for an activity.
 *
 * This is the canonical source for card hints in both TotM and Spatial modes.
 * - Available card: advisory text if present, else activity.description
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
        const hintText = hasAdvisory ? advRaw : (activity?.description ?? "").trim();
        const nv = !!advisory.nonViable;

        return {
            id:         activityId,
            name:       activity?.name ?? activityId,
            icon,
            hint:       hintText,
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
    const fadedText = activity?.fadedHint ?? "Not available.";
    return {
        id:         activityId,
        name:       activity?.name ?? activityId,
        icon,
        hint:       fadedText,
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
 *   - TotM: RestSetupApp._prepareContext() → totmDetailPanel
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

    // ── Outcome hints (success/exceptional/failure effect descriptions) ──────
    const outcomeHints = [];
    for (const tier of ["success", "exceptional", "failure"]) {
        for (const eff of (activity.outcomes?.[tier]?.effects ?? [])) {
            if (eff.description) outcomeHints.push({ text: eff.description, type: tier });
        }
    }

    // ── Check label ──────────────────────────────────────────────────────────
    const checkLabel = buildCheckLabelForActivity(activity, actor, comfort, followUpValue);

    // ── Follow-up inputs ─────────────────────────────────────────────────────
    const followUpData = buildFollowUpDataForActivity(activityId, activity, actor, followUpValue);

    // ── Armour hint ──────────────────────────────────────────────────────────
    const armorHint = _resolveArmorHint(actor, activity, armorRuleEnabled);

    // ── External armour warning (from restApp) ───────────────────────────────
    const armorWarning = getArmorWarning ? getArmorWarning(actor, activity) : null;

    // ── Advisory ─────────────────────────────────────────────────────────────
    // The advisory drives both the at-a-glance card hint and the blue pill in
    // the detail panel. When the advisory is flagged cardOnly, it is a static
    // mechanical summary that simply restates the success-outcome chevron
    // already shown below; skip it here so the two do not visually compete.
    const advisory = actor && partyState
        ? getActivityAdvisory(activityId, actor, partyState)
        : null;
    const advText = (advisory?.text !== null && advisory?.text !== undefined && !advisory?.cardOnly)
        ? String(advisory.text).trim()
        : "";

    return {
        id:               activityId,
        name:             activity.name,
        icon,
        description:      activity.description || null,
        checkLabel,
        hasNoCheck:       !activity.check,
        advisory:         advText || null,
        advisoryUrgent:   !!advisory?.urgent,
        outcomeHints,
        followUpData,
        armorHint,
        armorWarning,
        combatModifiers:  activity.combatModifiers ?? null,
        isCrafting:       !!activity.crafting?.enabled,
        characterId:      actor?.id ?? null
    };
}
