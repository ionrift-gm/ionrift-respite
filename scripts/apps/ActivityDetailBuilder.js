/**
 * ActivityDetailBuilder.js
 *
 * Single source of truth for activity card and detail panel data.
 *
 * Both the TotM mode and the spatial StationActivityDialog call these
 * functions - nothing is computed in two places any more.
 *
 * Exports:
 *   buildActivityListItem(activityId, activity, actor, partyState, isAvailable)
 *   buildActivityDetailContext(activityId, activity, actor, opts)
 */

import {
    ACTIVITY_ICONS,
    getActivityAdvisory
} from "./RestConstants.js";

// ─── Inlined helpers ─────────────────────────────────────────────────────────
// These functions were extracted from RestSetupApp during TotM unification.
// Inlined here for v2.1.x compatibility (RestConstants.js does not export them
// until the next minor release).

/**
 * Build the follow-up input descriptor for a given activity and actor.
 * @param {string} activityId
 * @param {object} activity
 * @param {object} actor
 * @param {string|null} [currentValue]
 * @returns {object|null}
 */
function buildFollowUpDataForActivity(activityId, activity, actor, currentValue = null) {
    if (!activity?.followUp) return null;

    const fu = activity.followUp;
    const result = {
        type: fu.type,
        label: fu.label,
        currentValue
    };

    if (fu.type === "partyMember") {
        const partyActors = (() => {
            try { return game.actors.filter(a => a.hasPlayerOwner && a.type === "character" && a.id !== actor?.id); }
            catch { return []; }
        })();
        result.options = partyActors.sort((a, b) => {
            const aRatio = (a.system?.attributes?.hp?.value ?? 0) / (a.system?.attributes?.hp?.max ?? 1);
            const bRatio = (b.system?.attributes?.hp?.value ?? 0) / (b.system?.attributes?.hp?.max ?? 1);
            return aRatio - bRatio;
        }).map(a => {
            const hp = a.system?.attributes?.hp;
            const hpText = hp ? ` (${hp.value}/${hp.max} HP)` : "";
            return { value: a.id, label: `${a.name}${hpText}`, isSelected: a.id === currentValue };
        });

    } else if (fu.type === "radio" || fu.type === "select") {
        const selectedVal = currentValue || fu.default || fu.options?.[0]?.value;

        if (activityId === "act_scribe") {
            const currentGold = actor?.system?.currency?.gp ?? 0;
            result.goldInfo = `${actor?.name ?? "Character"} has ${currentGold}gp`;
            result.options = (fu.options ?? []).map(opt => {
                const cost = parseInt(opt.value, 10) * 50;
                return {
                    ...opt,
                    label: currentGold >= cost ? opt.label : `${opt.label} (can't afford)`,
                    isSelected: opt.value === selectedVal,
                    isDisabled: currentGold < cost
                };
            });
        } else {
            result.options = (fu.options ?? []).map(opt => ({ ...opt, isSelected: opt.value === selectedVal }));
        }

        if (result.options?.length && !result.options.some(o => o.isSelected)) {
            result.options[0].isSelected = true;
        }

    } else if (fu.type === "actorItem" && fu.filter === "attuneable") {
        const attuneItems = (actor?.items ?? []).filter(i => {
            const att = i.system?.attunement;
            return (att === "required" || att === 1) && !i.system?.attuned;
        });
        result.options = attuneItems.map(i => ({
            value: i.id,
            label: i.name,
            isSelected: i.id === currentValue
        }));
        const attunement = actor?.system?.attributes?.attunement;
        if (attunement) {
            const current = attunement.value ?? 0;
            const max = attunement.max ?? 3;
            result.slotInfo = `${current}/${max}${current >= max ? " (at capacity)" : ""}`;
        }
    }

    return result;
}

/**
 * Build a short check label string for a given activity.
 * @param {object} activity
 * @param {object} actor
 * @param {string} [comfort]
 * @param {string|null} [followUpValue]
 * @returns {string|null}
 */
function buildCheckLabelForActivity(activity, actor, comfort = "sheltered", followUpValue = null) {
    if (!activity?.check) return null;

    const comfortDcMod = { safe: 0, sheltered: 0, rough: 2, hostile: 5 };
    const comfortMod = comfortDcMod[comfort] ?? 0;

    let baseDc = activity.check.dc ?? 12;
    if (activity.check.dynamicDc === "copySpell") {
        const spellLevel = Math.min(9, Math.max(1, parseInt(followUpValue || activity.followUp?.default || "1", 10) || 1));
        baseDc = 10 + spellLevel;
    }

    let checkKind = "";
    if (activity.check.skill) {
        let chosenSkill = activity.check.skill;
        if (activity.check.altSkill && actor) {
            const primary = actor.system?.skills?.[activity.check.skill]?.total ?? 0;
            const alt = actor.system?.skills?.[activity.check.altSkill]?.total ?? 0;
            if (alt > primary) chosenSkill = activity.check.altSkill;
        }
        checkKind = chosenSkill.charAt(0).toUpperCase() + chosenSkill.slice(1);
    } else if (activity.check.ability) {
        let abilityKey = activity.check.ability;
        if (abilityKey === "best" && actor?.system?.abilities) {
            let bestKey = "str"; let bestMod = -99;
            for (const [key, data] of Object.entries(actor.system.abilities)) {
                if ((data.mod ?? 0) > bestMod) { bestMod = data.mod; bestKey = key; }
            }
            abilityKey = bestKey;
        }
        checkKind = abilityKey.toUpperCase();
    }

    if (activity.check.dynamicDc === "copySpell") {
        return `${checkKind} check, DC ${baseDc}`;
    }
    if (comfortMod > 0) {
        return `${checkKind} check, DC ${baseDc + comfortMod} (${baseDc} base +${comfortMod} terrain)`;
    }
    return `${checkKind} check, DC ${baseDc}`;
}

// ─── Internal helper ─────────────────────────────────────────────────────────

/**
 * Resolve the armour sleep hint for an actor doing a given activity.
 * Returns { text, type: "warning"|"positive" } or null.
 * Pure — no Foundry globals needed (actor.items is passed in).
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
    const advisory = actor && partyState
        ? getActivityAdvisory(activityId, actor, partyState)
        : null;
    const advText = (advisory?.text !== null && advisory?.text !== undefined)
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
