import { getComfortDcMod, isComfortEnabled } from "./ComfortCalculator.js";

/** Activities hidden when the GM marks a safe rest spot (no encounter risk; no redundant camp duties). */
export const SAFE_REST_SPOT_EXCLUDED_ACTIVITY_IDS = new Set([
    "act_keep_watch",
    "act_defenses",
    "act_scout",
    "act_tend_wounds"
]);

/**
 * Activities hidden when the comfort subsystem is disabled. These are the soft
 * recovery and morale activities: full rest, tending wounds, prayer for temp HP,
 * and fireside tales for Inspiration. With comfort off the rest stays close to
 * RAW, leaving Other as the only open-ended evening choice.
 */
const COMFORT_EXCLUDED_ACTIVITY_IDS = new Set([
    "act_rest_fully",
    "act_tend_wounds",
    "act_pray",
    "act_tell_tales"
]);

/** Activities that only exist to feed the night encounter layer; hidden when encounters are off. */
const ENCOUNTER_ACTIVITY_IDS = new Set([
    "act_keep_watch",
    "act_defenses",
    "act_scout"
]);

/**
 * Whether the night encounter layer is on. When off, the watch/defenses/scout
 * activities and the encounter threshold roll are suppressed for a rest closer
 * to RAW. Defaults to true if the setting is not yet registered.
 * @returns {boolean}
 */
function areEncountersEnabled() {
    try {
        const value = game.settings.get("ionrift-respite", "enableEncounters");
        return value === undefined || value === null ? true : !!value;
    } catch (e) {
        return true;
    }
}

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
            if (activity.disabled) continue;
            if (options.safeRestSpot && SAFE_REST_SPOT_EXCLUDED_ACTIVITY_IDS.has(activity.id)) continue;
            if (!isComfortEnabled() && COMFORT_EXCLUDED_ACTIVITY_IDS.has(activity.id)) continue;
            if (!areEncountersEnabled() && ENCOUNTER_ACTIVITY_IDS.has(activity.id)) continue;

            // Gate Training behind module setting
            if (activity.id === "act_train") {
                try {
                    if (!game.settings.get("ionrift-respite", "enableTraining")) continue;
                } catch (e) { /* setting may not exist yet */ }
            }

            // Gate Professions (cook, brew, tailor, craft) behind module setting
            if (activity.category === "profession") {
                try {
                    if (!game.settings.get("ionrift-respite", "enableProfessions")) continue;
                } catch (e) { /* setting may not exist yet */ }
            }

            // Gate Fletching behind module setting
            if (activity.id === "act_fletch") {
                try {
                    if (!game.settings.get("ionrift-respite", "enableFletching")) continue;
                } catch (e) { /* setting may not exist yet */ }
            }

            if (this._meetsPrerequisites(actor, activity.prerequisites)) {
                available.push(activity);
            }
        }
        return available;
    }



    /**
     * Resolves an activity for a character. Rolls skill checks and produces outcomes.
     * @param {string} activityId
     * @param {Actor} actor
     * @param {string} terrainTag
     * @param {string} comfort
     * @param {Object} options
     * @param {Object} options - { followUpValue, comfort overrides, etc. }
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

        // Calculate DC with comfort friction (safe rest spot: none)
        const baseDc = activity.check.dc ?? 12;
        const comfortForDc = safeRestSpot ? "safe" : comfort;
        const adjustedDc = baseDc + getComfortDcMod(comfortForDc);

        // Roll skill check directly (avoids midi-qol / libWrapper collision)
        // If check.ability is defined, use a flat ability check instead of a skill
        let chosenSkillKey = activity.check.skill;
        let modifier;
        let rollLabel;

        if (activity.check.ability) {
            // Flat ability check (e.g. Training uses "best")
            let abilityKey = activity.check.ability;

            if (abilityKey === "best") {
                // Resolve to the actor's highest ability modifier
                const abilities = actor.system?.abilities ?? {};
                let bestKey = "str";
                let bestMod = -99;
                for (const [key, data] of Object.entries(abilities)) {
                    const mod = data.mod ?? 0;
                    if (mod > bestMod) { bestMod = mod; bestKey = key; }
                }
                abilityKey = bestKey;
            }

            const ABILITY_MAP = { str: "str", dex: "dex", con: "con", int: "int", wis: "wis", cha: "cha" };
            const aKey = ABILITY_MAP[abilityKey] ?? abilityKey;
            modifier = actor.system?.abilities?.[aKey]?.mod ?? 0;
            rollLabel = aKey.toUpperCase();
        } else {
            // Skill check: pick whichever gives the actor a higher modifier
            if (chosenSkillKey === "best") {
                // "best" means the player picks a skill via followUp. Use that
                // selection when available; otherwise fall back to the actor's
                // highest-total skill.
                const followUpSkill = options.followUpValue;
                if (followUpSkill && actor.system?.skills?.[followUpSkill]) {
                    chosenSkillKey = followUpSkill;
                } else {
                    // No followUp or invalid key, pick the actor's best skill
                    const skills = actor.system?.skills ?? {};
                    let bestKey = null;
                    let bestTotal = -99;
                    for (const [key, data] of Object.entries(skills)) {
                        const total = data.total ?? data.mod ?? 0;
                        if (total > bestTotal) { bestTotal = total; bestKey = key; }
                    }
                    if (bestKey) chosenSkillKey = bestKey;
                }
            } else if (activity.check.altSkill) {
                const primary = actor.system?.skills?.[activity.check.skill]?.total ?? 0;
                const alt = actor.system?.skills?.[activity.check.altSkill]?.total ?? 0;
                if (alt > primary) chosenSkillKey = activity.check.altSkill;
            }
            const skillData = actor.system?.skills?.[chosenSkillKey];
            modifier = skillData?.total ?? skillData?.mod ?? 0;
            rollLabel = chosenSkillKey.toUpperCase();
        }
        // Resolve advantageIf conditions from the activity check definition
        let rollAdvantage = false;
        if (activity.check.advantageIf?.length) {
            for (const cond of activity.check.advantageIf) {
                if (cond === "healer_kit") {
                    const kit = actor.items?.find(i => i.name?.toLowerCase().includes("healer") && i.name?.toLowerCase().includes("kit"));
                    if (kit && (kit.system?.quantity ?? kit.system?.uses?.value ?? 1) > 0) rollAdvantage = true;
                }
            }
        }

        const travelPenalty = typeof actor.getFlag === "function"
            ? (actor.getFlag("ionrift-respite", "travelMishapPenalty") ?? null)
            : null;

        let rollFormula;
        if (rollAdvantage && travelPenalty === "activity_disadvantage") {
            rollFormula = `1d20 + ${modifier}`;
        } else if (travelPenalty === "activity_disadvantage") {
            rollFormula = `2d20kl + ${modifier}`;
        } else if (rollAdvantage) {
            rollFormula = `2d20kh + ${modifier}`;
        } else {
            rollFormula = `1d20 + ${modifier}`;
        }

        const hadTravelDis = travelPenalty === "activity_disadvantage";
        const roll = await new Roll(rollFormula).evaluate();

        if (hadTravelDis && activity.check) {
            await actor.unsetFlag("ionrift-respite", "travelMishapPenalty");
        }

        const total = roll.total;
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
                const ownerIds = game.users.filter(u => actor.testUserPermission(u, "OWNER")).map(u => u.id);
                await roll.toMessage({
                    speaker: ChatMessage.getSpeaker({ actor }),
                    flavor: `<strong>${activity.name}</strong> (${rollLabel}${rollModNote}) - DC ${adjustedDc}<br><em style="color:#e88;">Failed.</em> ${activity.outcomes.failure?.narrative ?? "The attempt fails."}`,
                    whisper: ownerIds
                });

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

        // Whisper roll + outcome to actor owner and GM
        const tierLabel = resultTier === "exceptional" ? "Exceptional!" : resultTier === "success" ? "Success" : "Failed";
        const tierColor = resultTier === "exceptional" ? "#ffd700" : resultTier === "success" ? "#7eb8da" : "#e88";
        const ownerIds = game.users.filter(u => actor.testUserPermission(u, "OWNER") || u.isGM).map(u => u.id);
        await roll.toMessage({
            speaker: ChatMessage.getSpeaker({ actor }),
            flavor: `<strong>${activity.name}</strong> (${rollLabel}${rollModNote}) - DC ${adjustedDc}<br><em style="color:${tierColor};">${tierLabel}.</em> ${outcome.narrative ?? ""}`,
            whisper: ownerIds
        });

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
                    const chatParts = [];

                    if (resultTier === "success" || resultTier === "exceptional") {
                        if (hasHealerFeat && hasKit) {
                            // Healer feat formula: 1d6 + 4 + target's total HD
                            const targetLevel = target.system?.details?.level ?? target.system?.attributes?.hd?.max ?? 1;
                            const healRoll = await new Roll(`1d6 + 4 + ${targetLevel}`).evaluate();
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
                                const healRoll = await new Roll(`${die} + ${conMod} + 1d4`).evaluate();
                                healed = Math.min(Math.max(healRoll.total, 1), missing);
                                healLabel = `${die}+${conMod}+1d4 = ${healRoll.total}`;
                                chatParts.push("Healer's Kit");
                            } else {
                                const healRoll = await new Roll(`${die} + ${conMod}`).evaluate();
                                healed = Math.min(Math.max(healRoll.total, 1), missing);
                                healLabel = `${die}+${conMod} = ${healRoll.total}`;
                            }
                        }
                    } else {
                        // Failure: tender's WIS mod (min 1), kit adds +2
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
                        await target.update({ "system.attributes.hp.value": currentHp + healed });
                        const suffix = chatParts.length ? ` (${chatParts.join(", ")})` : "";
                        const chatWhisper = game.users.filter(u => u.isGM || target.testUserPermission(u, "OWNER")).map(u => u.id);
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
                const prof = actor.system?.attributes?.prof ?? 2;
                const formula = qty.replace(/prof/gi, prof);
                try {
                    const roll = await new Roll(formula).evaluate();
                    qty = roll.total;
                } catch (e) {
                    console.error("Respite | Failed to roll item quantity:", qty, e);
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
            xpReduction = streak * Math.abs(activity.diminishingReturns.perConsecutiveRest ?? 5);

            // Update streak for next rest
            await actor.setFlag("ionrift-respite", flagKey, streak + 1);
        }

        return {
            source: "activity",
            activityId,
            result: resultTier,
            items,
            effects: outcome.effects ?? [],
            narrative: outcome.narrative ?? "",
            xpReduction
        };
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

        let abilityKey = activity.check?.ability ?? "best";
        if (abilityKey === "best") {
            const abilities = actor.system?.abilities ?? {};
            let bestKey = "str";
            let bestMod = -99;
            for (const [key, data] of Object.entries(abilities)) {
                const mod = data.mod ?? 0;
                if (mod > bestMod) { bestMod = mod; bestKey = key; }
            }
            abilityKey = bestKey;
        }
        const modifier = actor.system?.abilities?.[abilityKey]?.mod ?? 0;
        const rollLabel = String(abilityKey).toUpperCase();

        const successXP = activity.outcomes?.success?.effects
            ?.find(e => e.type === "training_xp")?.value ?? 15;
        const failXP = activity.outcomes?.failure?.effects
            ?.find(e => e.type === "training_xp")?.value ?? 5;

        const flagKey = activity.diminishingReturns?.actorFlag ?? "trainingStreak";
        const streak = activity.diminishingReturns ? (actor.getFlag("ionrift-respite", flagKey) ?? 0) : 0;
        const xpReduction = activity.diminishingReturns
            ? streak * Math.abs(activity.diminishingReturns.perConsecutiveRest ?? 5)
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
        if (!prereqs) return true;

        // Check tool proficiencies
        if (prereqs.tools?.length > 0) {
            const actorTools = this._getActorToolProficiencies(actor);
            if (!prereqs.tools.some(t => actorTools.includes(t))) return false;
        }

        // Check skill proficiencies
        if (prereqs.proficiencies?.length > 0) {
            const actorSkills = Object.keys(actor.system?.skills ?? {}).filter(
                s => actor.system.skills[s]?.proficient > 0
            );
            if (!prereqs.proficiencies.some(p => actorSkills.includes(p))) return false;
        }

        // Check minimum level
        if (prereqs.minimumLevel) {
            const level = actor.system?.details?.level ?? 0;
            if (level < prereqs.minimumLevel) return false;
        }

        // Check maximum level (e.g. Training capped at level 5)
        if (prereqs.maximumLevel) {
            const level = actor.system?.details?.level ?? 0;
            if (level > prereqs.maximumLevel) return false;
        }

        // Check spell prerequisites (actor must have at least one PREPARED)
        if (prereqs.spells?.length > 0) {
            const { prepared } = this._getActorSpells(actor);
            if (!prereqs.spells.some(s => prepared.has(s.toLowerCase()))) return false;
        }

        // Check isSpellcaster (actor must have at least one spell slot level)
        if (prereqs.isSpellcaster) {
            const spells = actor.system?.spells ?? {};
            const hasSlots = Object.keys(spells).some(k => {
                const slot = spells[k];
                return (slot?.max ?? 0) > 0;
            });
            if (!hasSlots) return false;
        }

        // Check requiresSpellbook (Wizard class, or Warlock with Book of Shadows)
        // Artificers are explicitly excluded: they prepare spells but do not use a spellbook.
        if (prereqs.requiresSpellbook) {
            const classEntries = actor.classes ?? {};
            const classNames = new Set(
                Object.values(classEntries).map(c => c.name?.toLowerCase().trim())
            );
            const isWizard = !!classEntries.wizard || classNames.has("wizard");
            const isArtificer = !!classEntries.artificer || classNames.has("artificer");
            if (isArtificer && !isWizard) return false;
            const hasSpellbook = (actor.items ?? []).some(i =>
                i.name?.toLowerCase().includes("spellbook") || i.name?.toLowerCase().includes("book of shadows")
            );
            if (!isWizard && !hasSpellbook) return false;
        }

        // Runtime checks (checked separately, not from JSON prereqs)
        if (prereqs._requiresAttuneableItems) {
            if (!this._hasAttuneableItems(actor)) return false;
        }

        return true;
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
            if (activity.disabled) continue;
            if (!activity.restTypes.includes(restType)) continue;
            if (options.safeRestSpot && SAFE_REST_SPOT_EXCLUDED_ACTIVITY_IDS.has(activity.id)) continue;
            if (!isComfortEnabled() && COMFORT_EXCLUDED_ACTIVITY_IDS.has(activity.id)) continue;
            if (!areEncountersEnabled() && ENCOUNTER_ACTIVITY_IDS.has(activity.id)) continue;

            // Gate Training behind module setting
            if (activity.id === "act_train") {
                try {
                    if (!game.settings.get("ionrift-respite", "enableTraining")) continue;
                } catch (e) { /* setting may not exist yet */ }
            }

            // Gate Professions (cook, brew, tailor, craft) behind module setting
            if (activity.category === "profession") {
                try {
                    if (!game.settings.get("ionrift-respite", "enableProfessions")) continue;
                } catch (e) { /* setting may not exist yet */ }
            }

            // Gate Fletching behind module setting
            if (activity.id === "act_fletch") {
                try {
                    if (!game.settings.get("ionrift-respite", "enableFletching")) continue;
                } catch (e) { /* setting may not exist yet */ }
            }

            // Runtime attunement check
            if (activity.id === "act_attune" && !this._hasAttuneableItems(actor)) {
                continue;
            }

            if (this._meetsPrerequisites(actor, activity.prerequisites)) {
                // requiresFire: cooking needs campfire or bonfire (embers counts as lit but not hot enough)
                if (activity.requiresFire) {
                    if (!fireIsBurning) {
                        faded.push({
                            ...activity,
                            fadedHint: "Requires a lit fire."
                        });
                        continue;
                    }
                    if (!fireAllowsCooking) {
                        faded.push({
                            ...activity,
                            fadedHint: "Raise the fire to campfire or bonfire to cook."
                        });
                        continue;
                    }
                }
                if (activity.minor) {
                    minor.push(activity);
                } else {
                    available.push(activity);
                }
            } else if (activity.prerequisites?.spells?.length > 0) {
                // Check if the spell is KNOWN but just not prepared (faded tile)
                const { known, prepared } = this._getActorSpells(actor);
                const knownSpells = activity.prerequisites.spells.filter(s => known.has(s.toLowerCase()));
                const preparedSpells = activity.prerequisites.spells.filter(s => prepared.has(s.toLowerCase()));
                if (knownSpells.length > 0 && preparedSpells.length === 0) {
                    const unpreparedList = knownSpells.join(" / ");
                    const hint = `${unpreparedList} is in the spellbook but not prepared.`;
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
        const prepared = new Set();
        const known = new Set();

        for (const item of actor.items ?? []) {
            if (item.type !== "spell") continue;
            const name = item.name?.toLowerCase();
            if (!name) continue;

            known.add(name);

            // Use toObject() to avoid DnD5e 5.1 deprecation warnings on SpellData#preparation
            const raw = item.toObject?.()?.system ?? {};

            // DnD5e 5.1+: top-level method replaces preparation.mode
            //             top-level prepared replaces preparation.prepared
            const mode = raw.method ?? raw.preparation?.mode ?? "";
            const isPrepared = raw.prepared ?? raw.preparation?.prepared ?? false;

            // Always-prepared, innate, pact, and atwill spells
            if (mode === "always" || mode === "innate" || mode === "pact" || mode === "atwill") {
                prepared.add(name);
                continue;
            }

            // Standard prepared spell (wizard/cleric/druid/paladin)
            if (isPrepared) {
                prepared.add(name);
            }
        }

        return { prepared, known };
    }

    /**
     * Checks if actor has any items requiring attunement that aren't attuned.
     * @param {Actor} actor
     * @returns {boolean}
     */
    _hasAttuneableItems(actor) {
        for (const item of actor.items ?? []) {
            const attunement = item.system?.attunement;
            // dnd5e v3: attunement is a string "required" when not attuned
            // or a boolean/number in some versions
            if ((attunement === "required" || attunement === 1) && !item.system?.attuned) {
                return true;
            }
        }
        return false;
    }

    /**
     * Extracts tool proficiency keys from an actor.
     * Checks both system.tools proficiency entries and tool items in inventory.
     * @param {Actor} actor
     * @returns {string[]}
     */
    _getActorToolProficiencies(actor) {
        const profKeys = new Set();

        // Check system.tools (dnd5e stores proficiency here)
        const tools = actor.system?.tools ?? {};
        for (const [key, data] of Object.entries(tools)) {
            // dnd5e v3 uses effectValue, older versions use value
            if ((data?.value ?? 0) > 0 || (data?.effectValue ?? 0) > 0) {
                profKeys.add(key);
            }
        }

        // Also check for physical tool items in inventory
        // dnd5e tool items have system.type.value = "art" or "music" or tool key
        // and system.type.baseItem matching the config key (e.g. "cook", "herb")
        // NOTE: DnD5e v5+ may normalise tool items to a different type,
        // so we scan ALL items for baseItem and name-based indicators.
        for (const item of actor.items ?? []) {
            const baseItem = item.system?.type?.baseItem;
            if (baseItem) profKeys.add(baseItem);

            // Fallback: match by name for common tools
            const nameLower = (item.name ?? "").toLowerCase();
            if (nameLower.includes("cook")) profKeys.add("cook");
            if (nameLower.includes("herbalism")) profKeys.add("herb");
            if (nameLower.includes("alchemist")) profKeys.add("alchemist");
            if (nameLower.includes("brewer")) profKeys.add("brewer");
            if (nameLower.includes("tinker")) profKeys.add("tinker");
            if (nameLower.includes("smith")) profKeys.add("smith");
            if (nameLower.includes("thiev")) profKeys.add("thief");
            if (nameLower.includes("potter")) profKeys.add("potter");
            if (nameLower.includes("glassblower")) profKeys.add("glassblower");
            if (nameLower.includes("mason")) profKeys.add("mason");
            if (nameLower.includes("calligrapher")) profKeys.add("calligrapher");
            if (nameLower.includes("cartographer")) profKeys.add("cartographer");
        }

        return [...profKeys];
    }
}
