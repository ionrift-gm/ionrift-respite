import { getComfortDcMod, isComfortEnabled } from "../../camp/gear/ComfortCalculator.js";
import {
    applyFletchingYieldFloor,
    getFletchingTier,
    getFletchingYieldFormula,
    isFletchingEnabled
} from "../../crafting/settings/FletchingSettings.js";
import { getTrainingXpValues, getTrainingXpReduction, isTrainingEnabled } from "../../crafting/settings/TrainingSettings.js";
import { isProfessionActivityEnabled, isChefTreatCookingOnly } from "../../travel/settings/TravelSettings.js";
import { hasChefFeat } from "../../meal/buffs/ChefFeat.js";
import { GatherYieldService } from "../forage/GatherYieldService.js";
import { postRollAndSettle } from "/modules/ionrift-library/scripts/services/rolls/DiceSettle.js";
import { CARD_FADED_HINTS, cardHintNotPrepared } from "../../../data/activityCardHint.js";
import {
    ActivityEligibility,
    isActivityExcludedForRestOptions,
    isPrayMeditateEnabled,
    areEncountersEnabled,
    SAFE_REST_SPOT_EXCLUDED_ACTIVITY_IDS,
    TAVERN_REST_EXCLUDED_ACTIVITY_IDS,
    COMFORT_EXCLUDED_ACTIVITY_IDS,
    ENCOUNTER_ACTIVITY_IDS
} from "./ActivityEligibility.js";

export {
    isActivityExcludedForRestOptions,
    isPrayMeditateEnabled,
    areEncountersEnabled,
    SAFE_REST_SPOT_EXCLUDED_ACTIVITY_IDS,
    TAVERN_REST_EXCLUDED_ACTIVITY_IDS,
    COMFORT_EXCLUDED_ACTIVITY_IDS,
    ENCOUNTER_ACTIVITY_IDS
};

/**
 * ActivityResolver
 * Resolves a character's chosen rest activity against their proficiencies,
 * terrain, and comfort level. Produces ItemOutcome fragments.
 */
export class ActivityResolver {

    constructor() {
        /** @type {Map<string, Object>} Loaded activity schemas keyed by ID. */
        this.activities = new Map();
    }

    /**
     * Loads activity definitions from JSON data.
     * @param {Object[]} activityData - Array of activity schema objects.
     */
    load(activityData) {
        for (const activity of activityData) {
            this.activities.set(activity.id, activity);
        }
    }

    /**
     * Returns activities available to a given actor based on proficiencies and rest type.
     * @param {Actor} actor
     * @param {string} restType - "long" or "short"
     * @param {Object} [options] - safeRestSpot gate.
     * @returns {Object[]} Filtered activity schemas.
     */
    getAvailableActivities(actor, restType, options = {}) {
        const available = [];
        for (const activity of this.activities.values()) {
            if (!activity.restTypes.includes(restType)) continue;
            if (!ActivityEligibility.isEligible(actor, activity, options)) continue;
            available.push(activity);
        }
        return available;
    }

    /**
     * Inspects an activity's check definition and computes the actor's modifier,
     * skill/ability key, comfort-adjusted DC, and display labels without rolling.
     * @param {string} activityId
     * @param {Actor} actor
     * @param {string} comfort
     * @param {Object} [options]
     * @returns {Object|null}
     */
    getCheckDetails(activityId, actor, comfort, options = {}) {
        const activity = this.activities.get(activityId);
        if (!activity?.check || (activity.check.rolls ?? 1) > 1) return null;

        const safeRestSpot = !!options.safeRestSpot;
        const baseDc = activity.check.dc ?? 12;
        const comfortForDc = safeRestSpot ? "safe" : comfort;
        const adjustedDc = baseDc + getComfortDcMod(comfortForDc);

        const rollAdapter = game.ionrift?.respite?.adapter;
        const getAbilityMod = (abilityKey) => rollAdapter
            ? rollAdapter.getAbilityMod(actor, abilityKey)
            : (actor.system?.abilities?.[abilityKey]?.mod ?? 0);
        const getSkillTotal = (skillKey) => {
            if (rollAdapter) {
                const nativeKey = rollAdapter.normalizeSkillKey(skillKey);
                return rollAdapter.getSkillTotal(actor, nativeKey);
            }
            const skill = actor.system?.skills?.[skillKey];
            return skill?.total ?? skill?.mod ?? 0;
        };
        const hasSkillKey = (skillKey) => {
            if (rollAdapter) {
                const nativeKey = rollAdapter.normalizeSkillKey(skillKey);
                const skillKeys = rollAdapter.getSkillKeys(actor);
                return skillKeys.includes(nativeKey);
            }
            return !!actor.system?.skills?.[skillKey];
        };

        let chosenKey = activity.check.skill;
        let modifier;
        let rollLabel;
        const isAbility = Boolean(activity.check.ability);

        if (isAbility) {
            let abilityKey = activity.check.ability;
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
            const ABILITY_MAP = { str: "str", dex: "dex", con: "con", int: "int", wis: "wis", cha: "cha" };
            chosenKey = ABILITY_MAP[abilityKey] ?? abilityKey;
            modifier = getAbilityMod(chosenKey);
            rollLabel = chosenKey.toUpperCase();
        } else {
            if (chosenKey === "best") {
                const followUpSkill = options.followUpValue;
                if (followUpSkill && hasSkillKey(followUpSkill)) {
                    chosenKey = followUpSkill;
                } else {
                    const skills = rollAdapter
                        ? rollAdapter.getSkillKeys(actor)
                        : Object.keys(actor.system?.skills ?? {});
                    let bestKey = null;
                    let bestTotal = -99;
                    for (const key of skills) {
                        const total = getSkillTotal(key);
                        if (total > bestTotal) { bestTotal = total; bestKey = key; }
                    }
                    if (bestKey) chosenKey = bestKey;
                }
            } else if (activity.check.altSkill) {
                const primary = getSkillTotal(activity.check.skill);
                const alt = getSkillTotal(activity.check.altSkill);
                if (alt > primary) chosenKey = activity.check.altSkill;
            }
            modifier = getSkillTotal(chosenKey);
            rollLabel = chosenKey.toUpperCase();
        }

        let rollAdvantage = false;
        if (activity.check.advantageIf?.length) {
            for (const cond of activity.check.advantageIf) {
                if (cond === "healer_kit") {
                    const kit = actor.items?.find(i => i.name?.toLowerCase().includes("healer") && i.name?.toLowerCase().includes("kit"));
                    if (kit && (kit.system?.quantity ?? kit.system?.uses?.value ?? 1) > 0) rollAdvantage = true;
                }
            }
        }

        return {
            activity,
            baseDc,
            adjustedDc,
            type: isAbility ? "ability" : "skill",
            key: chosenKey,
            modifier,
            rollLabel,
            rollAdvantage
        };
    }

    /**
     * Resolves an activity for a character. Rolls skill checks and produces outcomes.
     * @param {string} activityId
     * @param {Actor} actor
     * @param {string} terrainTag
     * @param {string} comfort
     * @param {Object} options
     * @param {Object} options - { followUpValue, comfort overrides, rollTotal, preEvaluated, etc. }
     * @returns {Object} Activity outcome fragment.
     */
    async resolve(activityId, actor, terrainTag, comfort, options = {}) {
        const safeRestSpot = !!options.safeRestSpot;
        const activity = this.activities.get(activityId);
        if (!activity) {
            return {
                source: "activity",
                activityId,
                result: "invalid",
                items: [],
                effects: [],
                narrative: "No valid activity found."
            };
        }

        // Reset diminishing returns streaks when choosing a non-training activity
        if (!activity.diminishingReturns) {
            for (const act of this.activities.values()) {
                if (act.diminishingReturns?.actorFlag) {
                    const currentStreak = actor.getFlag("ionrift-respite", act.diminishingReturns.actorFlag);
                    if (currentStreak > 0) {
                        await actor.setFlag("ionrift-respite", act.diminishingReturns.actorFlag, 0);
                    }
                }
            }
        }

        // Activities without checks (Rest Fully, Keep Watch) resolve immediately
        if (!activity.check) {
            return {
                source: "activity",
                activityId,
                result: "success",
                items: activity.outcomes?.success?.items ?? [],
                effects: activity.outcomes?.success?.effects ?? [],
                narrative: activity.outcomes?.success?.narrative ?? activity.description
            };
        }

        // Multi-roll activities (Training) run several independent checks and
        // aggregate the reward. Handled in a dedicated path so the single-roll
        // flow below stays untouched.
        if ((activity.check.rolls ?? 1) > 1) {
            return await this._resolveMultiRoll(activity, activityId, actor, comfort, safeRestSpot);
        }

        const details = this.getCheckDetails(activityId, actor, comfort, options);
        if (!details) {
            return {
                source: "activity",
                activityId,
                result: "invalid",
                items: [],
                effects: [],
                narrative: "Could not evaluate activity check."
            };
        }

        const adjustedDc = details.adjustedDc;
        const rollLabel = details.rollLabel;
        const rollAdvantage = details.rollAdvantage;

        const travelPenalty = typeof actor.getFlag === "function"
            ? (actor.getFlag("ionrift-respite", "travelMishapPenalty") ?? null)
            : null;
        const hadTravelDis = travelPenalty === "activity_disadvantage";

        const preEvaluated = Number.isFinite(options.rollTotal);
        let roll = options.roll ?? null;
        let total;

        if (preEvaluated) {
            total = options.rollTotal;
        } else {
            let rollFormula;
            if (rollAdvantage && hadTravelDis) {
                rollFormula = `1d20 + ${details.modifier}`;
            } else if (hadTravelDis) {
                rollFormula = `2d20kl + ${details.modifier}`;
            } else if (rollAdvantage) {
                rollFormula = `2d20kh + ${details.modifier}`;
            } else {
                rollFormula = `1d20 + ${details.modifier}`;
            }

            roll = await new Roll(rollFormula).evaluate();
            total = roll.total;
        }

        if (hadTravelDis && activity.check) {
            await actor.unsetFlag("ionrift-respite", "travelMishapPenalty");
        }

        const rollModNote = hadTravelDis
            ? " (disadvantage)"
            : (rollAdvantage ? " (advantage)" : "");

        // Determine outcome tier
        let resultTier;
        if (activity.outcomes.exceptional && total >= activity.outcomes.exceptional.threshold) {
            resultTier = "exceptional";
        } else if (total >= adjustedDc) {
            resultTier = "success";
        } else {
            resultTier = "failure";

            // Hostile comfort: failure triggers complication (not in safe rest spot)
            if (!safeRestSpot && (comfort === "hostile" || comfort === "rough")) {
                const ownerIds = game.users.filter(u => actor.testUserPermission(u, "OWNER") || u.isGM).map(u => u.id);
                if (!preEvaluated && roll) {
                    await roll.toMessage({
                        speaker: ChatMessage.getSpeaker({ actor }),
                        flavor: `<strong>${activity.name}</strong> (${rollLabel}${rollModNote}) · DC ${adjustedDc}<br><em style="color:#e88;">Failed.</em> ${activity.outcomes.failure?.narrative ?? "The attempt fails."}`,
                        whisper: ownerIds
                    });
                } else if (preEvaluated) {
                    await ChatMessage.create({
                        speaker: ChatMessage.getSpeaker({ actor }),
                        content: `<strong>${activity.name}</strong> (${rollLabel}${rollModNote}) · DC ${adjustedDc}<br><em style="color:#e88;">Failed.</em> ${activity.outcomes.failure?.narrative ?? "The attempt fails."}`,
                        whisper: ownerIds
                    });
                }

                return {
                    source: "activity",
                    activityId,
                    result: "failure_complication",
                    items: [],
                    effects: activity.outcomes.failure?.effects ?? [
                        { type: "complication", description: "Your activity draws unwanted attention." }
                    ],
                    narrative: activity.outcomes.failure?.narrative ?? "The attempt fails.",
                    complication: comfort === "hostile"
                };
            }
        }

        const outcome = activity.outcomes[resultTier] ?? activity.outcomes.success;

        // Foraging and Hunting: resolve gathered provisions via GatherYieldService
        if (activityId === "act_forage" || activityId === "act_hunt") {
            const mode = activityId === "act_hunt" ? "hunt" : "forage";
            const gathered = await GatherYieldService.resolveGatherDay({
                actor,
                mode,
                terrainTag: terrainTag ?? "forest",
                total,
                dc: adjustedDc
            });
            let gatherItems = [];
            if (gathered.items?.length) {
                gatherItems = gathered.items.map(e => ({
                    itemRef: e.itemRef ?? null,
                    itemData: e.itemData ?? null,
                    name: e.itemData?.name ?? e.name ?? (mode === "hunt" ? "Fresh Game" : "Foraged Provisions"),
                    quantity: e.quantity ?? 1
                }));
            } else if (gathered.rations > 0) {
                gatherItems = [{
                    itemRef: "rations",
                    name: "Rations",
                    quantity: gathered.rations
                }];
            }
            const narrativeParts = [outcome.narrative];
            if (gathered.mishap) narrativeParts.push(gathered.mishap);
            const haulDesc = gathered.fromTable
                ? GatherYieldService.describeItems(gathered.items)
                : (gathered.rations > 0 ? `${gathered.rations} rations` : "");
            if (haulDesc) narrativeParts.push(`Yield: ${haulDesc}`);

            const tierLabel = resultTier === "exceptional" ? "Exceptional!" : resultTier === "success" ? "Success" : "Failed";
            const tierColor = resultTier === "exceptional" ? "#ffd700" : resultTier === "success" ? "#7eb8da" : "#e88";
            const yieldSuffix = haulDesc ? `<br><strong>Yield:</strong> ${haulDesc}` : "";
            const mishapSuffix = gathered.mishap ? `<br><em style="color:#e88;">${gathered.mishap}</em>` : "";

            const ownerIds = game.users.filter(u => actor.testUserPermission(u, "OWNER") || u.isGM).map(u => u.id);
            if (!preEvaluated && roll) {
                await roll.toMessage({
                    speaker: ChatMessage.getSpeaker({ actor }),
                    flavor: `<strong>${activity.name}</strong> (${rollLabel}${rollModNote}) · DC ${adjustedDc}<br><em style="color:${tierColor};">${tierLabel}.</em> ${outcome.narrative ?? ""}${yieldSuffix}${mishapSuffix}`,
                    whisper: ownerIds
                });
            } else if (preEvaluated) {
                await ChatMessage.create({
                    speaker: ChatMessage.getSpeaker({ actor }),
                    content: `<strong>${activity.name}</strong> (${rollLabel}${rollModNote}) · DC ${adjustedDc}<br><em style="color:${tierColor};">${tierLabel}.</em> ${outcome.narrative ?? ""}${yieldSuffix}${mishapSuffix}`,
                    whisper: ownerIds
                });
            }

            return {
                source: "activity",
                activityId,
                result: resultTier,
                items: gatherItems,
                effects: outcome.effects ?? [],
                narrative: narrativeParts.filter(Boolean).join(". ")
            };
        }

        // Whisper roll + outcome to actor owner and GM
        const tierLabel = resultTier === "exceptional" ? "Exceptional!" : resultTier === "success" ? "Success" : "Failed";
        const tierColor = resultTier === "exceptional" ? "#ffd700" : resultTier === "success" ? "#7eb8da" : "#e88";
        const ownerIds = game.users.filter(u => actor.testUserPermission(u, "OWNER") || u.isGM).map(u => u.id);
        const fletchYieldPending = activityId === "act_fletch"
            && (resultTier === "success" || resultTier === "exceptional");
        if (!fletchYieldPending && !preEvaluated && roll) {
            await roll.toMessage({
                speaker: ChatMessage.getSpeaker({ actor }),
                flavor: `<strong>${activity.name}</strong> (${rollLabel}${rollModNote}) · DC ${adjustedDc}<br><em style="color:${tierColor};">${tierLabel}.</em> ${outcome.narrative ?? ""}`,
                whisper: ownerIds
            });
        } else if (!fletchYieldPending && preEvaluated) {
            await ChatMessage.create({
                speaker: ChatMessage.getSpeaker({ actor }),
                content: `<strong>${activity.name}</strong> (${rollLabel}${rollModNote}) · DC ${adjustedDc}<br><em style="color:${tierColor};">${tierLabel}.</em> ${outcome.narrative ?? ""}`,
                whisper: ownerIds
            });
        }

        // Tend Wounds: apply immediate HP to the target before encounters (not safe rest spot)
        if (!safeRestSpot && activityId === "act_tend_wounds" && options.followUpValue) {
            const target = game.actors.get(options.followUpValue);
            if (target) {
                const hp = target.system?.attributes?.hp;
                const maxHp = hp?.max ?? 0;
                const currentHp = hp?.value ?? 0;
                const missing = maxHp - currentHp;

                // Detect Healer's Kit and Healer feat on the tender
                const healerKit = actor.items?.find(i =>
                    i.name?.toLowerCase().includes("healer") && i.name?.toLowerCase().includes("kit")
                );
                const kitCharges = healerKit
                    ? (healerKit.system?.uses?.value ?? healerKit.system?.quantity ?? 0)
                    : 0;
                const hasKit = !!healerKit && kitCharges > 0;
                const hasHealerFeat = actor.items?.some(i =>
                    i.type === "feat" && i.name?.toLowerCase() === "healer"
                );

                if (missing > 0) {
                    let healed = 0;
                    let healLabel = "";
                    let healRoll = null;
                    const chatParts = [];

                    if (resultTier === "success" || resultTier === "exceptional") {
                        if (hasHealerFeat && hasKit) {
                            // Healer feat formula: 1d6 + 4 + target's total HD
                            const targetLevel = target.system?.details?.level ?? target.system?.attributes?.hd?.max ?? 1;
                            healRoll = await new Roll(`1d6 + 4 + ${targetLevel}`).evaluate();
                            healed = Math.min(Math.max(healRoll.total, 1), missing);
                            healLabel = `1d6+4+${targetLevel} = ${healRoll.total}`;
                            chatParts.push("Healer feat");
                        } else {
                            // Standard: target's largest HD + target's CON mod
                            const classes = target.items.filter(i => i.type === "class");
                            const bestClass = classes.sort((a, b) => {
                                const aSize = parseInt((b.system?.hd?.denomination ?? b.system?.hitDice ?? "d8").replace("d", "")) || 8;
                                const bSize = parseInt((a.system?.hd?.denomination ?? a.system?.hitDice ?? "d8").replace("d", "")) || 8;
                                return aSize - bSize;
                            })[0];
                            const die = bestClass
                                ? (bestClass.system?.hd?.denomination ?? bestClass.system?.hitDice ?? "d8")
                                : "d8";
                            const conMod = target.system?.abilities?.con?.mod ?? 0;

                            if (hasKit) {
                                // Kit bonus: roll an extra d4 on top
                                healRoll = await new Roll(`${die} + ${conMod} + 1d4`).evaluate();
                                healed = Math.min(Math.max(healRoll.total, 1), missing);
                                healLabel = `${die}+${conMod}+1d4 = ${healRoll.total}`;
                                chatParts.push("Healer's Kit");
                            } else {
                                healRoll = await new Roll(`${die} + ${conMod}`).evaluate();
                                healed = Math.min(Math.max(healRoll.total, 1), missing);
                                healLabel = `${die}+${conMod} = ${healRoll.total}`;
                            }
                        }
                    } else {
                        // Failure: tender's WIS mod (min 1), kit adds +2. No die.
                        const wisMod = Math.max(1, actor.system?.abilities?.wis?.mod ?? 1);
                        const kitBonus = hasKit ? 2 : 0;
                        healed = Math.min(wisMod + kitBonus, missing);
                        healLabel = hasKit ? `WIS ${wisMod} + kit 2` : `WIS mod (${wisMod})`;
                        if (hasKit) chatParts.push("Healer's Kit");
                    }

                    // Spend one kit charge on any outcome (success or failure)
                    if (hasKit && healerKit) {
                        if (healerKit.system?.uses?.value !== null) {
                            await healerKit.update({ "system.uses.value": Math.max(0, kitCharges - 1) });
                        } else if (healerKit.system?.quantity !== null) {
                            const newQty = Math.max(0, (healerKit.system.quantity ?? 1) - 1);
                            if (newQty <= 0) await healerKit.delete();
                            else await healerKit.update({ "system.quantity": newQty });
                        }
                        chatParts.push(`${kitCharges - 1} charges remaining`);
                    }

                    if (healed > 0) {
                        const chatWhisper = game.users.filter(u => u.isGM || target.testUserPermission(u, "OWNER")).map(u => u.id);
                        if (healRoll) {
                            await postRollAndSettle(healRoll, {
                                speaker: ChatMessage.getSpeaker({ actor }),
                                flavor: `<strong>${actor.name}</strong> tends <strong>${target.name}</strong>`,
                                whisper: chatWhisper
                            });
                        }
                        const healAdapter = game.ionrift?.respite?.adapter;
                        if (healAdapter) {
                            await healAdapter.applyHPRestore(target, healed);
                        } else {
                            await target.update({ "system.attributes.hp.value": currentHp + healed });
                        }
                        const suffix = chatParts.length ? ` (${chatParts.join(", ")})` : "";
                        await ChatMessage.create({
                            speaker: ChatMessage.getSpeaker({ actor }),
                            content: `<div class="respite-recovery-chat"><strong>${actor.name}</strong> tends to <strong>${target.name}</strong>.<br>Immediate healing: <strong>${healed} HP</strong> (${healLabel})${suffix}.</div>`,
                            whisper: chatWhisper
                        });
                    }
                }
            }
        }

        // Resolve terrain-templated pool references and evaluate quantities
        const items = [];
        for (const itemRef of (outcome.items ?? [])) {
            let qty = itemRef.quantity ?? 1;
            if (typeof qty === "string") {
                const profAdapter = game.ionrift?.respite?.adapter;
                const prof = profAdapter
                    ? profAdapter.getProficiencyBonus(actor)
                    : (actor.system?.attributes?.prof ?? 2);
                let expr = qty;
                if (activity.id === "act_fletch") {
                    const tierFormula = getFletchingYieldFormula();
                    if (tierFormula) expr = tierFormula;
                }
                const formula = expr.replace(/prof/gi, String(prof));
                try {
                    if (activity.id === "act_fletch") {
                        qty = await this.#rollFletchYield(actor, formula, prof, options.followUpValue);
                    } else {
                        const rolled = await new Roll(formula).evaluate();
                        qty = rolled.total;
                    }
                } catch (e) {
                    console.error("Respite | Failed to roll item quantity:", expr, e);
                    qty = 1;
                }
            }

            // Resolve followUp-based item references (e.g. arrows vs bolts)
            let resolvedItemRef = itemRef.itemRef;
            let resolvedItemData = itemRef.itemData ?? null;
            if (itemRef.itemRef === "followUp" && itemRef.itemMap && options.followUpValue) {
                resolvedItemRef = itemRef.itemMap[options.followUpValue] ?? itemRef.itemRef;
                // Inline fallback data from itemDataMap (used when compendium lookup fails)
                if (itemRef.itemDataMap?.[options.followUpValue]) {
                    resolvedItemData = itemRef.itemDataMap[options.followUpValue];
                }
            }

            items.push({
                ...itemRef,
                itemRef: resolvedItemRef,
                itemData: resolvedItemData,
                pool: itemRef.pool?.replace?.("${terrain}", terrainTag) ?? itemRef.pool,
                quantity: qty
            });
        }

        // Handle training diminishing returns
        let xpReduction = 0;
        if (activity.diminishingReturns) {
            const flagKey = activity.diminishingReturns.actorFlag ?? "trainingStreak";
            const streak = actor.getFlag("ionrift-respite", flagKey) ?? 0;
            xpReduction = getTrainingXpReduction(streak);

            // Update streak for next rest
            await actor.setFlag("ionrift-respite", flagKey, streak + 1);
        }

        let narrative = outcome.narrative ?? "";
        if (fletchYieldPending) {
            const made = items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
            const bolts = options.followUpValue === "bolts";
            const noun = made === 1 ? (bolts ? "bolt" : "arrow") : (bolts ? "bolts" : "arrows");
            if (made > 0) narrative = `${narrative} ${made} ${noun}.`;
            await ChatMessage.create({
                speaker: ChatMessage.getSpeaker({ actor }),
                content: `<strong>${activity.name}</strong> (${rollLabel}${rollModNote}) · DC ${adjustedDc}<br><em style="color:${tierColor};">${tierLabel}.</em> ${narrative}`,
                whisper: ownerIds
            });
        }

        return {
            source: "activity",
            activityId,
            result: resultTier,
            items,
            effects: outcome.effects ?? [],
            narrative,
            xpReduction
        };
    }

    /**
     * Player rolls the fletch yield. The dialog names the dice and the count.
     * A missing roll service falls back to a quiet evaluate so the grant still lands.
     * @param {Actor} actor
     * @param {string} formula Proficiency already substituted.
     * @param {number} prof
     * @param {string} [followUpValue]
     * @returns {Promise<number>}
     */
    async #rollFletchYield(actor, formula, prof, followUpValue) {
        const tier = getFletchingTier();
        const bolts = followUpValue === "bolts";
        const noun = bolts ? "bolts" : "arrows";
        const one = bolts ? "bolt" : "arrow";
        const grant = (total) => applyFletchingYieldFloor(total, tier, prof);
        const request = game.ionrift?.library?.rollRequest?.request;
        if (typeof request === "function") {
            const result = await request({
                actorId: actor.id,
                actorUuid: actor.uuid,
                type: "formula",
                formula,
                title: `How many ${noun}`,
                tableLabel: formula,
                describeOutcome: async ({ total }) => {
                    const made = grant(total);
                    return `${made} ${made === 1 ? one : noun}`;
                }
            });
            return grant(result?.total);
        }
        const rolled = await new Roll(formula).evaluate();
        return grant(rolled.total);
    }

    /**
     * Resolves a multi-roll activity (Training): N independent ability checks
     * against the same DC. Each landed set awards the success XP value, each
     * missed set the failure value. The rest's total is then reduced by the
     * diminishing-returns streak and floored at zero. Returns a single outcome
     * carrying the per-set breakdown so the UI can draw a progress bar and the
     * resolution step can write the XP to the sheet.
     *
     * @param {Object} activity
     * @param {string} activityId
     * @param {Actor} actor
     * @param {string} comfort
     * @param {boolean} safeRestSpot
     * @returns {Object} Activity outcome fragment.
     */
    async _resolveMultiRoll(activity, activityId, actor, comfort, safeRestSpot) {
        const context = this.getTrainingContext(activity, actor, comfort, safeRestSpot);
        const rolls = [];
        for (let i = 0; i < context.numRolls; i++) {
            rolls.push(await this.rollTrainingSet(i + 1, context));
        }
        return await this.finalizeTraining(activity, activityId, actor, rolls, context);
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
    getTrainingContext(activity, actor, comfort, safeRestSpot) {
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
        const streak = activity.diminishingReturns ? (actor.getFlag("ionrift-respite", flagKey) ?? 0) : 0;
        const xpReduction = activity.diminishingReturns
            ? getTrainingXpReduction(streak)
            : 0;

        return { adjustedDc, numRolls, abilityKey, modifier, rollLabel, successXP, failXP, flagKey, streak, xpReduction };
    }

    /**
     * Rolls one training set against the context DC.
     *
     * @param {number} setNumber 1-based set index.
     * @param {Object} context Output of {@link getTrainingContext}.
     * @returns {Promise<{set:number,total:number,passed:boolean,roll:Roll}>}
     */
    async rollTrainingSet(setNumber, context) {
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
     * @param {Object} context Output of {@link getTrainingContext}.
     * @param {Object} [opts]
     * @param {boolean} [opts.whisper=true] Post the chat whisper.
     * @returns {Promise<Object>}
     */
    async finalizeTraining(activity, activityId, actor, rolls, context, opts = {}) {
        const { whisper = true } = opts;
        const cleanRolls = rolls.map(r => ({ set: r.set, total: r.total, passed: r.passed }));
        const successes = cleanRolls.filter(r => r.passed).length;
        const baseXP = cleanRolls.reduce(
            (sum, r) => sum + (r.passed ? context.successXP : context.failXP), 0
        );

        if (activity.diminishingReturns) {
            await actor.setFlag("ionrift-respite", context.flagKey, context.streak + 1);
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
                const segments = cleanRolls
                    .map(r => `<strong style="color:${r.passed ? "#1c6ea4" : "#a83232"};">${r.total}${r.passed ? "" : " (miss)"}</strong>`)
                    .join(" &bull; ");
                const reductionNote = xpReduction > 0
                    ? `<br><span style="opacity:0.8;font-size:0.9em;">Diminishing returns reduced the haul by ${xpReduction} XP.</span>`
                    : "";
                await ChatMessage.create({
                    speaker: ChatMessage.getSpeaker({ actor }),
                    whisper: ownerIds,
                    flavor: `<strong>${activity.name}</strong> (${context.rollLabel}) - DC ${context.adjustedDc}<br>Sets: ${segments}<br><strong style="color:#6b4f00;">${successes}/${numRolls} landed. +${awardedXP} XP.</strong>${reductionNote}`,
                    flags: { "ionrift-respite": { type: "trainingResult" } }
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
                        ? `Gained ${awardedXP} XP from training (${successes}/${numRolls} sets landed).`
                        : `No XP this rest. Diminishing returns have caught up; try a different activity.`
                }
            ],
            narrative,
            xpReduction,
            training: { rolls: cleanRolls, successes, numRolls, baseXP, xpReduction, awardedXP, dc: context.adjustedDc, rollLabel: context.rollLabel }
        };
    }

    /**
     * Checks if actor meets activity prerequisites.
     * @param {Actor} actor
     * @param {Object} prereqs
     * @returns {boolean}
     */
    _meetsPrerequisites(actor, prereqs) {
        return ActivityEligibility.meetsPrerequisites(actor, prereqs);
    }

    /**
     * Returns available, faded, and minor activities for an actor.
     * Faded includes unprepared spells, missing fire, and fire below cooking tier (embers).
     * Minor = quick utility actions that don't consume the rest activity slot (e.g. Identify).
     * @param {Actor} actor
     * @param {string} restType
     * @param {Object} [options]
     * @param {boolean} [options.isFireLit] - Used only when fireLevel is omitted: false means unlit.
     * @param {string} [options.fireLevel] - unlit | embers | campfire | bonfire. Drives requiresFire (cooking needs campfire+).
     * @returns {{ available: Object[], faded: Object[], minor: Object[], fadedMinor: Object[] }}
     */
    getAvailableActivitiesWithFaded(actor, restType, options = {}) {
        const available = [];
        const faded = [];
        const minor = [];
        const fadedMinor = [];
        const rawLevel = options.fireLevel;
        const hasExplicitLevel = rawLevel !== undefined && rawLevel !== null && rawLevel !== "";
        const resolvedFireLevel = hasExplicitLevel
            ? String(rawLevel).trim().toLowerCase()
            : ((options.isFireLit ?? true) ? "campfire" : "unlit");
        const fireIsBurning = resolvedFireLevel !== "unlit";
        const fireAllowsCooking = resolvedFireLevel === "campfire" || resolvedFireLevel === "bonfire";

        for (const activity of this.activities.values()) {
            if (!activity.restTypes.includes(restType)) continue;
            if (ActivityEligibility.isGatedBySettings(actor, activity, options)) continue;

            if (ActivityEligibility.meetsPrerequisites(actor, activity.prerequisites)) {
                // requiresFire: cooking needs campfire or bonfire (embers counts as lit but not hot enough)
                if (activity.requiresFire) {
                    if (!fireIsBurning) {
                        faded.push({
                            ...activity,
                            fadedHint: CARD_FADED_HINTS.needsFire
                        });
                        continue;
                    }
                    if (!fireAllowsCooking) {
                        faded.push({
                            ...activity,
                            fadedHint: CARD_FADED_HINTS.needsHotFire
                        });
                        continue;
                    }
                }
                if (activity.id === "act_forage" && options.forageActivityGate?.disabled) {
                    faded.push({
                        ...activity,
                        fadedHint: CARD_FADED_HINTS.noForage
                    });
                    continue;
                }
                if (activity.minor) {
                    minor.push(activity);
                } else {
                    available.push(activity);
                }
            } else if (activity.prerequisites?.spells?.length > 0) {
                // Check if the spell is KNOWN but just not prepared (faded tile)
                const { known, prepared } = ActivityEligibility.getActorSpells(actor);
                const knownSpells = activity.prerequisites.spells.filter(s => known.has(s.toLowerCase()));
                const preparedSpells = activity.prerequisites.spells.filter(s => prepared.has(s.toLowerCase()));
                if (knownSpells.length > 0 && preparedSpells.length === 0) {
                    const hint = cardHintNotPrepared(knownSpells);
                    if (activity.minor) {
                        fadedMinor.push({ ...activity, fadedHint: hint });
                    } else {
                        faded.push({ ...activity, fadedHint: hint });
                    }
                }
            }
        }

        return { available, faded, minor, fadedMinor };
    }

    /**
     * Returns prepared and known spell name Sets for an actor.
     * @param {Actor} actor
     * @returns {{ prepared: Set<string>, known: Set<string> }}
     */
    _getActorSpells(actor) {
        return ActivityEligibility.getActorSpells(actor);
    }

    /**
     * Checks if actor has any items requiring attunement that aren't attuned.
     * @param {Actor} actor
     * @returns {boolean}
     */
    _hasAttuneableItems(actor) {
        return ActivityEligibility.hasAttuneableItems(actor);
    }

    /**
     * Extracts tool proficiency keys from an actor.
     * @param {Actor} actor
     * @returns {string[]}
     */
    _getActorToolProficiencies(actor) {
        return ActivityEligibility.getActorToolProficiencies(actor);
    }
}
