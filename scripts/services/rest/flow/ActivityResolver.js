import { MODULE_ID } from "../../../data/moduleId.js";
import { getComfortDcMod } from "../../camp/gear/ComfortCalculator.js";
import {
    isPf2eSystem,
    resolvePf2eActivityDC,
    resolvePf2eActivitySkills,
    evaluatePf2eSaveDegree
} from "../../camp/gear/Pf2eComfortRules.js";
import {
    getFletchingYieldFormula
} from "../../crafting/settings/FletchingSettings.js";
import { fletchAmmoKind } from "../../crafting/outcomes/FletchAmmoStack.js";
import { getTrainingXpReduction } from "../../crafting/settings/TrainingSettings.js";
import { GatherYieldService } from "../forage/GatherYieldService.js";
import { postRollAndSettle } from "/modules/ionrift-library/scripts/services/rolls/DiceSettle.js";
import { CARD_FADED_HINTS, cardHintNotPrepared } from "../../../data/activityCardHint.js";
import { isHealersKitItem } from "../../../data/RestConstants.js";
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
import { rollFletchYield, buildTrainingContext, evaluateTrainingSet, finalizeTrainingOutcome } from "./ActivityTrainingHelper.js";

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
        const rollAdapter = game.ionrift?.respite?.adapter;
        const pf2e = isPf2eSystem(rollAdapter);
        const isAbility = Boolean(activity.check.ability);

        let baseDc = activity.check.dc ?? 12;
        if (pf2e && !isAbility && !activity.check.dynamicDc) {
            const actorLevel = rollAdapter?.getLevel
                ? rollAdapter.getLevel(actor)
                : (actor?.system?.details?.level?.value ?? actor?.system?.details?.level ?? 1);
            baseDc = resolvePf2eActivityDC(baseDc, actorLevel);
        }
        const comfortForDc = safeRestSpot ? "safe" : comfort;
        const adjustedDc = baseDc + getComfortDcMod(comfortForDc);

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

        const pf2eSkillSpec = pf2e && !isAbility
            ? resolvePf2eActivitySkills(activityId, activity.check)
            : null;
        let chosenKey = pf2eSkillSpec?.skill ?? activity.check.skill;
        const altSkillKey = pf2eSkillSpec ? pf2eSkillSpec.altSkill : activity.check.altSkill;
        let modifier;
        let rollLabel;

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
            } else if (altSkillKey) {
                const primary = getSkillTotal(chosenKey);
                const alt = getSkillTotal(altSkillKey);
                if (alt > primary) chosenKey = altSkillKey;
            }
            modifier = getSkillTotal(chosenKey);
            rollLabel = (pf2e && rollAdapter?.getSkillLabel)
                ? rollAdapter.getSkillLabel(chosenKey)
                : chosenKey.toUpperCase();
        }

        let rollAdvantage = false;
        if (!pf2e && activity.check.advantageIf?.length) {
            for (const cond of activity.check.advantageIf) {
                if (cond === "healer_kit") {
                    const kit = actor.items?.find(i => isHealersKitItem(i));
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
                narrative: game.i18n.localize("ionrift-respite.activityResolver.noValidActivity")
            };
        }

        // Reset diminishing returns streaks when choosing a non-training activity
        if (!activity.diminishingReturns) {
            for (const act of this.activities.values()) {
                if (act.diminishingReturns?.actorFlag) {
                    const currentStreak = actor.getFlag(MODULE_ID, act.diminishingReturns.actorFlag);
                    if (currentStreak > 0) {
                        await actor.setFlag(MODULE_ID, act.diminishingReturns.actorFlag, 0);
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
                narrative: game.i18n.localize("ionrift-respite.activityResolver.couldNotEvaluate")
            };
        }

        const adjustedDc = details.adjustedDc;
        const rollLabel = details.rollLabel;
        const rollAdvantage = details.rollAdvantage;

        const travelPenalty = typeof actor.getFlag === "function"
            ? (actor.getFlag(MODULE_ID, "travelMishapPenalty") ?? null)
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
            await actor.unsetFlag(MODULE_ID, "travelMishapPenalty");
        }

        const rollModNote = hadTravelDis
            ? ` (${game.i18n.localize("ionrift-respite.activityResolver.disadvantage")})`
            : (rollAdvantage ? ` (${game.i18n.localize("ionrift-respite.activityResolver.advantage")})` : "");

        // Determine outcome tier
        const pf2e = isPf2eSystem();
        let resultTier;
        if (pf2e) {
            const d20Value = Number.isFinite(options.d20Value)
                ? options.d20Value
                : (roll?.dice?.[0]?.total ?? null);
            const degree = evaluatePf2eSaveDegree(d20Value, total, adjustedDc);
            if (degree === "critSuccess" && (activity.outcomes.exceptional || activityId === "act_tend_wounds")) {
                resultTier = "exceptional";
            } else if (degree === "critSuccess" || degree === "success") {
                resultTier = "success";
            } else {
                resultTier = "failure";
            }
        } else if (activity.outcomes.exceptional && total >= activity.outcomes.exceptional.threshold) {
            resultTier = "exceptional";
        } else if (total >= adjustedDc) {
            resultTier = "success";
        } else {
            resultTier = "failure";
        }

        if (resultTier === "failure") {
            // Hostile comfort: failure triggers complication (not in safe rest spot)
            if (!safeRestSpot && (comfort === "hostile" || comfort === "rough")) {
                const ownerIds = game.users.filter(u => actor.testUserPermission(u, "OWNER") || u.isGM).map(u => u.id);
                const failedNarrative = activity.outcomes.failure?.narrative ?? game.i18n.localize("ionrift-respite.activityResolver.attemptFails");
                const failedFlavor = `<strong>${activity.name}</strong> (${rollLabel}${rollModNote}) · DC ${adjustedDc}<br><em style="color:#e88;">${game.i18n.localize("ionrift-respite.activityResolver.failed")}</em> ${failedNarrative}`;
                if (!preEvaluated && roll) {
                    await roll.toMessage({
                        speaker: ChatMessage.getSpeaker({ actor }),
                        flavor: failedFlavor,
                        whisper: ownerIds
                    });
                } else if (preEvaluated) {
                    await ChatMessage.create({
                        speaker: ChatMessage.getSpeaker({ actor }),
                        content: failedFlavor,
                        whisper: ownerIds
                    });
                }

                return {
                    source: "activity",
                    activityId,
                    result: "failure_complication",
                    items: [],
                    effects: activity.outcomes.failure?.effects ?? [
                        { type: "complication", description: game.i18n.localize("ionrift-respite.activityResolver.complicationAttention") }
                    ],
                    narrative: failedNarrative,
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
                : (gathered.rations > 0 ? game.i18n.format("ionrift-respite.activityResolver.rationsCount", { count: gathered.rations }) : "");
            if (haulDesc) narrativeParts.push(game.i18n.format("ionrift-respite.activityResolver.yieldPrefix", { yield: haulDesc }));

            const tierLabel = resultTier === "exceptional"
                ? game.i18n.localize("ionrift-respite.activityResolver.tierExceptional")
                : resultTier === "success"
                    ? game.i18n.localize("ionrift-respite.activityResolver.tierSuccess")
                    : game.i18n.localize("ionrift-respite.activityResolver.tierFailed");
            const tierColor = resultTier === "exceptional" ? "#ffd700" : resultTier === "success" ? "#7eb8da" : "#e88";
            const yieldSuffix = haulDesc ? `<br>${game.i18n.format("ionrift-respite.activityResolver.yieldBoldPrefix", { yield: haulDesc })}` : "";
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
        const tierLabel = resultTier === "exceptional"
            ? game.i18n.localize("ionrift-respite.activityResolver.tierExceptional")
            : resultTier === "success"
                ? game.i18n.localize("ionrift-respite.activityResolver.tierSuccess")
                : game.i18n.localize("ionrift-respite.activityResolver.tierFailed");
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
                const healAdapter = game.ionrift?.respite?.adapter;
                const hp = healAdapter ? healAdapter.getHP(target) : (target.system?.attributes?.hp ?? {});
                const maxHp = hp?.max ?? 0;
                const currentHp = hp?.value ?? 0;
                const missing = Math.max(0, maxHp - currentHp);

                // Detect Healer's Kit / Healer's Toolkit and Healer feat on the tender
                const healerKit = actor.items?.find(i => isHealersKitItem(i));
                const kitCharges = healerKit
                    ? (healerKit.system?.uses?.value ?? healerKit.system?.quantity ?? (pf2e ? 1 : 0))
                    : 0;
                const hasKit = !!healerKit && kitCharges > 0;
                const hasHealerFeat = !pf2e && actor.items?.some(i =>
                    i.type === "feat" && i.name?.toLowerCase() === "healer"
                );

                if (pf2e) {
                    const woundedBefore = healAdapter?.getConditionValue
                        ? healAdapter.getConditionValue(target, "wounded")
                        : 0;
                    if ((resultTier === "success" || resultTier === "exceptional") && (missing > 0 || woundedBefore > 0)) {
                        let healed = 0;
                        let healLabel = "0";
                        let healRoll = null;
                        const chatParts = [];
                        if (missing > 0) {
                            const formula = resultTier === "exceptional" ? "4d8" : "2d8";
                            healRoll = await new Roll(formula).evaluate();
                            healed = Math.min(Math.max(healRoll.total, 1), missing);
                            healLabel = `${formula} = ${healRoll.total}`;
                        }
                        if (woundedBefore > 0 && healAdapter?._setValuedCondition) {
                            await healAdapter._setValuedCondition(target, "wounded", 0, 4);
                            chatParts.push("Wounded cleared");
                        }
                        const chatWhisper = game.users.filter(u => u.isGM || target.testUserPermission(u, "OWNER")).map(u => u.id);
                        if (healRoll) {
                            await postRollAndSettle(healRoll, {
                                speaker: ChatMessage.getSpeaker({ actor }),
                                flavor: game.i18n.format("ionrift-respite.activityResolver.tendsFlavor", { actor: actor.name, target: target.name }),
                                whisper: chatWhisper
                            });
                        }
                        if (healed > 0) {
                            if (healAdapter) {
                                await healAdapter.applyHPRestore(target, healed);
                            } else {
                                await target.update({ "system.attributes.hp.value": currentHp + healed });
                            }
                        }
                        const suffix = chatParts.length ? ` (${chatParts.join(", ")})` : "";
                        await ChatMessage.create({
                            speaker: ChatMessage.getSpeaker({ actor }),
                            content: game.i18n.format("ionrift-respite.activityResolver.tendsContent", {
                                actor: actor.name,
                                target: target.name,
                                healed,
                                healLabel,
                                suffix
                            }),
                            whisper: chatWhisper
                        });
                    }
                } else if (missing > 0) {
                    let healed = 0;
                    let healLabel = "";
                    let healRoll = null;
                    const chatParts = [];

                    if (resultTier === "success" || resultTier === "exceptional") {
                        if (hasHealerFeat && hasKit) {
                            // Healer feat formula: 1d6 + 4 + target's total HD
                            const targetLevel = healAdapter
                                ? healAdapter.getLevel(target)
                                : (target.system?.details?.level?.value ?? target.system?.details?.level ?? target.system?.attributes?.hd?.max ?? 1);
                            healRoll = await new Roll(`1d6 + 4 + ${targetLevel}`).evaluate();
                            healed = Math.min(Math.max(healRoll.total, 1), missing);
                            healLabel = `1d6+4+${targetLevel} = ${healRoll.total}`;
                            chatParts.push(game.i18n.localize("ionrift-respite.activityResolver.healerFeat"));
                        } else {
                            // Standard: target's largest HD + target's CON mod
                            const classes = (target.items ?? []).filter(i => i.type === "class");
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
                                chatParts.push(game.i18n.localize("ionrift-respite.activityResolver.healersKit"));
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
                        healLabel = hasKit
                            ? game.i18n.format("ionrift-respite.activityResolver.healWisKit", { wis: wisMod })
                            : game.i18n.format("ionrift-respite.activityResolver.healWisMod", { wis: wisMod });
                        if (hasKit) chatParts.push(game.i18n.localize("ionrift-respite.activityResolver.healersKit"));
                    }

                    // Spend one kit charge on any outcome (success or failure)
                    if (hasKit && healerKit) {
                        if (healerKit.system?.uses?.value != null) {
                            await healerKit.update({ "system.uses.value": Math.max(0, kitCharges - 1) });
                        } else if (healerKit.system?.quantity != null) {
                            const newQty = Math.max(0, (healerKit.system.quantity ?? 1) - 1);
                            if (newQty <= 0) await healerKit.delete();
                            else await healerKit.update({ "system.quantity": newQty });
                        }
                        chatParts.push(game.i18n.format("ionrift-respite.activityResolver.chargesRemaining", { count: kitCharges - 1 }));
                    }

                    if (healed > 0) {
                        const chatWhisper = game.users.filter(u => u.isGM || target.testUserPermission(u, "OWNER")).map(u => u.id);
                        if (healRoll) {
                            await postRollAndSettle(healRoll, {
                                speaker: ChatMessage.getSpeaker({ actor }),
                                flavor: game.i18n.format("ionrift-respite.activityResolver.tendsFlavor", { actor: actor.name, target: target.name }),
                                whisper: chatWhisper
                            });
                        }
                        if (healAdapter) {
                            await healAdapter.applyHPRestore(target, healed);
                        } else {
                            await target.update({ "system.attributes.hp.value": currentHp + healed });
                        }
                        const suffix = chatParts.length ? ` (${chatParts.join(", ")})` : "";
                        await ChatMessage.create({
                            speaker: ChatMessage.getSpeaker({ actor }),
                            content: game.i18n.format("ionrift-respite.activityResolver.tendsContent", {
                                actor: actor.name,
                                target: target.name,
                                healed,
                                healLabel,
                                suffix
                            }),
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
            const followUpValue = options.followUpValue ?? activity.followUp?.default ?? null;
            let resolvedItemRef = itemRef.itemRef;
            let resolvedItemData = itemRef.itemData ?? null;
            if (itemRef.itemRef === "followUp" && itemRef.itemMap && followUpValue) {
                resolvedItemRef = itemRef.itemMap[followUpValue] ?? itemRef.itemRef;
                // Inline fallback data from itemDataMap (used when compendium lookup fails)
                if (itemRef.itemDataMap?.[followUpValue]) {
                    resolvedItemData = itemRef.itemDataMap[followUpValue];
                }
            }

            items.push({
                ...itemRef,
                itemRef: resolvedItemRef,
                itemData: resolvedItemData,
                pool: itemRef.pool?.replace?.("${terrain}", terrainTag) ?? itemRef.pool,
                quantity: qty,
                ...(activity.id === "act_fletch" ? { ammoKind: fletchAmmoKind(followUpValue) } : {})
            });
        }

        // Handle training diminishing returns
        let xpReduction = 0;
        if (activity.diminishingReturns) {
            const flagKey = activity.diminishingReturns.actorFlag ?? "trainingStreak";
            const streak = actor.getFlag(MODULE_ID, flagKey) ?? 0;
            xpReduction = getTrainingXpReduction(streak);

            // Update streak for next rest
            await actor.setFlag(MODULE_ID, flagKey, streak + 1);
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

        let resolvedEffects = outcome.effects ?? [];
        if (activityId === "act_pray" && (resultTier === "success" || resultTier === "exceptional")) {
            const prayAdapter = game.ionrift?.respite?.adapter;
            const prof = prayAdapter
                ? prayAdapter.getProficiencyBonus(actor)
                : (actor.system?.attributes?.prof ?? 2);
            if (prayAdapter?.applyTempHP) {
                await prayAdapter.applyTempHP(actor, prof);
            } else if (typeof actor.update === "function") {
                const currentTemp = Number(actor.system?.attributes?.hp?.temp ?? 0) || 0;
                if (prof > currentTemp) {
                    await actor.update({ "system.attributes.hp.temp": prof });
                }
            }
            resolvedEffects = resolvedEffects.map(eff =>
                eff?.type === "temp_hp" ? { ...eff, value: prof, amount: prof } : eff
            );
        }

        return {
            source: "activity",
            activityId,
            result: resultTier,
            items,
            effects: resolvedEffects,
            narrative,
            xpReduction
        };
    }

    async #rollFletchYield(actor, formula, prof, followUpValue) {
        return rollFletchYield(actor, formula, prof, followUpValue);
    }

    async _resolveMultiRoll(activity, activityId, actor, comfort, safeRestSpot) {
        const context = this.getTrainingContext(activity, actor, comfort, safeRestSpot);
        const rolls = [];
        for (let i = 0; i < context.numRolls; i++) {
            rolls.push(await this.rollTrainingSet(i + 1, context));
        }
        return await this.finalizeTraining(activity, activityId, actor, rolls, context);
    }

    getTrainingContext(activity, actor, comfort, safeRestSpot) {
        return buildTrainingContext(activity, actor, comfort, safeRestSpot);
    }

    async rollTrainingSet(setNumber, context) {
        return evaluateTrainingSet(setNumber, context);
    }

    async finalizeTraining(activity, activityId, actor, rolls, context, opts = {}) {
        return finalizeTrainingOutcome(activity, activityId, actor, rolls, context, opts);
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
