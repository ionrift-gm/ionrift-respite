import { Logger } from "../../../utils/Logger.js";
import { getPartyActors } from "../../party/partyActors.js";
import { boostComfort, getHdPenalty, getExhaustionDC, HP_FRACTION, isComfortEnabled } from "../../camp/gear/ComfortCalculator.js";
import { watchAlertCombatLine } from "./WatchAlertBenefit.js";

/**
 * RestFlowEngine
 * Orchestrates the four-phase rest sequence: Setup, Activity, Events, Resolution.
 * Coordinates between ActivityResolver, EventResolver, and ItemOutcomeHandler.
 */
export class RestFlowEngine {

    /**
     * @param {Object} config
     * @param {string} config.restType - "long" or "short"
     * @param {string} config.terrainTag - Primary terrain tag
     * @param {string[]} config.secondaryTags - Optional secondary tags
     * @param {string} config.comfort - Comfort level key
     * @param {Object} config.restModifiers - Recovery/event modifiers
     * @param {boolean} [config.safeRestSpot] - No encounter risk; safe recovery and simplified camp
     */
    constructor(config) {
        this.restType = config.restType ?? "long";
        this.terrainTag = config.terrainTag ?? "wilderness";
        this.secondaryTags = config.secondaryTags ?? [];
        this.comfort = config.comfort ?? "sheltered";
        this.restModifiers = config.restModifiers ?? {};
        this.safeRestSpot = !!config.safeRestSpot;

        // Character choices: populated during Activity phase
        this.characterChoices = new Map();
        // Watch roster: populated from characters who chose "Keep Watch"
        this.watchRoster = [];
        // Outcomes: populated during Resolution
        this.outcomes = [];

        this._phase = "setup";
    }

    /** Returns current phase. */
    get phase() {
        return this._phase;
    }

    /**
     * Phase 1: Setup. Validates config and prepares the flow.
     * @returns {Object} Setup summary for UI rendering.
     */
    setup() {
        this._phase = "setup";
        return {
            restType: this.restType,
            terrainTag: this.terrainTag,
            secondaryTags: this.secondaryTags,
            comfort: this.comfort,
            restModifiers: this.restModifiers
        };
    }

    /**
     * Phase 2: Register a character's activity choice.
     * @param {string} characterId - Actor ID
     * @param {string} activityId - Activity schema ID
     * @param {Object} [options] - Watch slot, target character, etc.
     */
    registerChoice(characterId, activityId, options = {}) {
        this.characterChoices.set(characterId, { activityId, options });

        // Awake at night is Keep Watch only. Set Up Defenses lowers the DC
        // and does not keep that character up for event targets.
        this.watchRoster = (this.watchRoster ?? []).filter(w => w.characterId !== characterId);
        if (activityId === "act_keep_watch") {
            this.watchRoster.push({
                characterId,
                slot: options.watchSlot ?? "any"
            });
        }
    }

    /**
     * Defense term for the night check. Committed Set Up Defenses wins.
     * Until that lands, each successful defense already in early results
     * counts as 2 (encounter_reduction on act_defenses).
     * @param {Iterable} [earlyResults]
     * @returns {number}
     */
    defenseContribution(earlyResults) {
        const committed = this._encounterBreakdown?.defenses ?? 0;
        if (committed !== 0) return committed;
        if (!earlyResults || typeof earlyResults === "string" || typeof earlyResults[Symbol.iterator] !== "function") {
            return 0;
        }
        let bonus = 0;
        for (const entry of earlyResults) {
            const er = Array.isArray(entry) ? entry[1] : entry;
            if (er?.activityId === "act_defenses" && (er.result === "success" || er.result === "exceptional")) {
                bonus += 2;
            }
        }
        return bonus;
    }

    /**
     * Effective encounter threshold for this rest. The encounter bar and the
     * night roll both call this. Shelter, a positive fire modifier, defenses,
     * and a positive travel mishap lower the DC. Weather raises it: the
     * weather table's encounterDC is a danger bonus, not a shelter bonus.
     * Pass fireModifier to preview an uncommitted fire on the camp screen.
     * Pass earlyResults so a defense success counts before it is committed.
     * @param {{ fireModifier?: number, earlyResults?: Iterable }} [options]
     * @returns {number}
     */
    getEffectiveEncounterDC({ fireModifier, earlyResults } = {}) {
        const bd = this._encounterBreakdown ?? {};
        const fire = typeof fireModifier === "number" ? fireModifier : (this.fireRollModifier ?? 0);
        const shelter = bd.shelter ?? this.shelterEncounterMod ?? 0;
        const weather = bd.weather ?? 0;
        const campMods = fire
            + shelter
            + this.defenseContribution(earlyResults)
            + (bd.travelMishap ?? 0);
        const baseDC = this._baseDC ?? 15;
        return Math.max(1, baseDC - campMods + weather + (this.gmEncounterAdj ?? 0));
    }

    /**
     * Phase 3: Resolve events. Rolls against the terrain event table.
     * @param {EventResolver} eventResolver
     * @param {Iterable} [earlyResults] - Activity results not yet written onto the breakdown.
     * @returns {Object[]} Array of triggered events.
     */
    async resolveEvents(eventResolver, earlyResults) {
        const variant = game.ionrift?.respite?.adapter?.getRestVariant?.() ?? "normal";
        const isGrittyShort = this.restType === "short" && variant === "gritty";
        if ((this.restType === "short" && !isGrittyShort) || this.safeRestSpot) {
            this._phase = "resolve";
            return [];
        }

        this._phase = "events";

        const effectiveDC = this.getEffectiveEncounterDC({ earlyResults });
        Logger.log(`[Respite:Engine] resolveEvents: effectiveDC=${effectiveDC}`);
        const events = await eventResolver.roll(this.terrainTag, this.watchRoster, effectiveDC);
        return events;
    }

    /**
     * Phase 4: Resolution. Compiles all outcomes and returns the handoff payload.
     * @param {ActivityResolver} activityResolver
     * @param {Object[]} triggeredEvents - Events from phase 3
     * @returns {Object[]} Array of ItemOutcome payloads per character.
     */
    async resolve(activityResolver, triggeredEvents = [], earlyResults = new Map()) {
        this._phase = "resolve";
        this._earlyResults = earlyResults;
        const outcomes = [];

        // Filter through current roster to exclude characters removed mid-rest
        const rosterIds = new Set(getPartyActors().map(a => a.id));

        // Set of character IDs currently on watch. Used downstream by
        // RecoveryHandler / ConditionAdvisory to honor `randomTarget.pool`
        // (sleeping vs awake) and route `scope: "stung"` consequences.
        const watchIds = new Set((this.watchRoster ?? []).map(w => w.characterId));

        for (const [characterId, choice] of this.characterChoices) {
            if (!rosterIds.has(characterId)) continue;
            const actor = game.actors.get(characterId);
            if (!actor) continue;

            // Use early result if available (rolled during activity phase), otherwise roll now
            const resolveOpts = { ...(choice.options ?? {}), safeRestSpot: this.safeRestSpot };
            const activityResult = earlyResults.get(characterId)
                ?? await activityResolver.resolve(
                    choice.activityId,
                    actor,
                    this.terrainTag,
                    this.comfort,
                    resolveOpts
                );

            // Check if any events targeted this character
            const characterEvents = triggeredEvents.filter(
                e => e.targets?.includes(characterId)
            );

            // Map events to outcome entries with resolved effects
            const eventOutcomes = characterEvents.map(e => {
                // Resolve the correct outcome block from the 4-tier schema
                // Fallback chain: triumph > success, mixed > failure
                const TIER_MAP = {
                    triumph: "onTriumph",
                    success: "onSuccess",
                    mixed: "onMixed",
                    failure: "onFailure"
                };
                const FALLBACK = { triumph: "onSuccess", mixed: "onFailure" };

                const tierKey = TIER_MAP[e.resolvedOutcome] ?? "onFailure";
                const fallbackKey = FALLBACK[e.resolvedOutcome];
                const block = e.mechanical?.[tierKey]
                    ?? (fallbackKey ? e.mechanical?.[fallbackKey] : null)
                    ?? {};

                const isPositive = ["triumph", "success"].includes(e.resolvedOutcome);

                // Per-character roll results from the events phase. Threaded
                // through so downstream scope routing (`scope: "failed"`)
                // can target the characters who personally rolled below DC.
                const failedCharacterIds = (e.resolvedRolls ?? [])
                    .filter(r => r && r.passed === false)
                    .map(r => r.characterId)
                    .filter(Boolean);

                return {
                    source: "event",
                    eventId: e.id,
                    eventName: e.name,
                    category: e.category,
                    result: e.result,
                    resolvedOutcome: e.resolvedOutcome ?? null,
                    failedCharacterIds,
                    items: block.items ?? [],
                    effects: isPositive ? [] : (block.effects ?? []),
                    narrative: block.narrative ?? e.narrative ?? ""
                };
            });

            // Flag if any event disrupted the rest (failure/mixed complication, or unresolved encounter)
            const eventDisrupted = eventOutcomes.some(
                e => ["failure", "mixed"].includes(e.resolvedOutcome)
                    || (e.category === "encounter" && !["success", "triumph"].includes(e.resolvedOutcome))
            );

            outcomes.push({
                characterId,
                characterName: actor.name,
                onWatch: watchIds.has(characterId),
                eventDisrupted,
                outcomes: [
                    activityResult,
                    ...eventOutcomes
                ],
                recovery: this._calculateRecovery(actor, activityResolver.activities.get(choice.activityId), eventOutcomes)
            });
        }

        this.outcomes = outcomes;
        return outcomes;
    }

    /**
     * Calculates HP/HD recovery based on comfort level and carried gear.
     * Uses flat HD penalties (RAW-aligned) instead of multipliers.
     *
     * Recovery model:
     *   Safe/Sheltered: full HP, half HD (RAW)
     *   Rough:          full HP, half HD - 1 (min 0), CON DC 10 exhaustion
     *   Hostile:        3/4 HP,  half HD - 2 (min 0), CON DC 15 exhaustion
     *
     * Personal gear:
     *   Bedroll: +1 HD recovered
     *   Mess Kit / Cook's Utensils: advantage on exhaustion save (requires lit fire)
     *
     * @param {Actor} actor
     * @param {Object} [activitySchema] - The activity schema for the character's chosen activity.
     * @returns {Object}
     */
    _calculateRecovery(actor, activitySchema = null, eventOutcomes = []) {
        const adapter = game.ionrift?.respite?.adapter;
        const hp = adapter ? adapter.getHP(actor) : { value: actor.system?.attributes?.hp?.value ?? 0, max: actor.system?.attributes?.hp?.max ?? 0 };
        const maxHp = hp.max;
        const currentHp = hp.value;
        const hd = adapter ? adapter.getHitDice(actor) : { current: 0, max: 0 };
        const totalHd = hd.max || (adapter ? adapter.getLevel(actor) : (actor.system?.details?.level ?? 0));
        const rawHdRecovery = Math.max(1, Math.floor(totalHd / 2));

        // Safe rest spot: full HP cap, no comfort tier penalties, no exhaustion risk.
        // Armor sleep penalty is waived. Characters in a safe haven are assumed to
        // manage their own armor (doff at the inn, etc.) without mechanical penalty.
        if (this.safeRestSpot) {
            const effectiveComfort = "safe";
            const hdPenalty = 0;
            const baseHdRecovered = Math.max(0, rawHdRecovery - hdPenalty);
            const maxHpRestorable = maxHp;
            let baseHpRestored = maxHpRestorable;

            let overallHpMultiplier = 1.0;
            for (const outcome of eventOutcomes) {
                for (const effect of (outcome.effects || [])) {
                    if (["recovery_penalty", "recovery_bonus"].includes(effect.type) && typeof effect.hpMultiplier === "number") {
                        overallHpMultiplier *= effect.hpMultiplier;
                    }
                }
            }
            const travelRec = typeof actor.getFlag === "function"
                ? (actor.getFlag("ionrift-respite", "travelMishapRecovery") ?? null)
                : null;
            if (travelRec?.hpMultiplier && typeof travelRec.hpMultiplier === "number") {
                overallHpMultiplier *= travelRec.hpMultiplier;
            }
            if (overallHpMultiplier !== 1.0) {
                const recoveryGap = maxHp - currentHp;
                const naturalHealing = Math.min(maxHpRestorable, recoveryGap);
                baseHpRestored = Math.max(0, Math.floor(naturalHealing * overallHpMultiplier));
            }

            const items = actor.items?.map(i => i.name?.toLowerCase()) ?? [];
            const hasBedroll = items.some(n => n?.includes("bedroll"));
            const bonusHdFromActivity = activitySchema?.outcomes?.success?.effects
                ?.filter(e => e.type === "bonus_hd")
                ?.reduce((sum, e) => sum + (e.value ?? 0), 0) ?? 0;
            const gearBonusHd = hasBedroll ? 1 : 0;
            const exhaustionDC = null;
            const exhaustionAdvantage = false;

            const gearDescriptors = [];
            if (gearBonusHd > 0) gearDescriptors.push("Bedroll: +1 HD");
            if (bonusHdFromActivity > 0) gearDescriptors.push("Deep sleep: +1 HD");

            if (travelRec?.hpMultiplier && typeof actor.unsetFlag === "function") {
                void actor.unsetFlag("ionrift-respite", "travelMishapRecovery");
            }

            const isShortSafe = this.restType === "short";
            return {
                hpRestored: isShortSafe ? 0 : baseHpRestored,
                hdRestored: isShortSafe ? 0 : (baseHdRecovered + gearBonusHd + bonusHdFromActivity),
                spellSlotsRestored: this.restType === "long",
                comfortLevel: effectiveComfort,
                campComfort: this.comfort,
                restType: this.restType,
                restedFully: activitySchema?.id === "act_rest_fully",
                exhaustionDC,
                exhaustionAdvantage,
                armorSleepPenalty: false,
                gearBonuses: { hd: gearBonusHd, exhaustionAdvantage },
                gearDescriptors: isShortSafe ? [] : gearDescriptors
            };
        }

        // Effective comfort: start with camp comfort, boost if activity has comfort_boost
        let effectiveComfort = this.comfort;

        // When comfort is disabled, force safe; skip all comfort tier logic
        const comfortEnabled = isComfortEnabled();
        if (!comfortEnabled) {
            effectiveComfort = "safe";
        } else {
            const hasComfortBoost = activitySchema?.outcomes?.success?.effects?.some(e => e.type === "comfort_boost");
            if (hasComfortBoost) {
                effectiveComfort = boostComfort(effectiveComfort, 1);
            }

            // Tend Wounds: if someone successfully tended this character, boost their comfort too
            const hasTendBoost = this._isTendWoundsTarget(actor.id);
            if (hasTendBoost) {
                effectiveComfort = boostComfort(effectiveComfort, 1);
            }
        }

        // Comfort tier penalties (using effective comfort)
        const hdPenalty = getHdPenalty(effectiveComfort);
        let baseHdRecovered = Math.max(0, rawHdRecovery - hdPenalty);

        const isHostile = effectiveComfort === "hostile";
        const maxHpRestorable = isHostile ? Math.floor(maxHp * (HP_FRACTION.hostile)) : maxHp;
        let baseHpRestored = maxHpRestorable;

        // hpMultiplier automation (from event effects)
        let overallHpMultiplier = 1.0;
        for (const outcome of eventOutcomes) {
            for (const effect of (outcome.effects || [])) {
                if (["recovery_penalty", "recovery_bonus"].includes(effect.type) && typeof effect.hpMultiplier === "number") {
                    overallHpMultiplier *= effect.hpMultiplier;
                }
            }
        }

        const travelRec = typeof actor.getFlag === "function"
            ? (actor.getFlag("ionrift-respite", "travelMishapRecovery") ?? null)
            : null;
        if (travelRec?.hpMultiplier && typeof travelRec.hpMultiplier === "number") {
            overallHpMultiplier *= travelRec.hpMultiplier;
        }

        if (overallHpMultiplier !== 1.0) {
            const recoveryGap = maxHp - currentHp;
            const naturalHealing = Math.min(maxHpRestorable, recoveryGap);
            baseHpRestored = Math.max(0, Math.floor(naturalHealing * overallHpMultiplier));
        }

        // Exhaustion risk at Rough/Hostile (using effective comfort)
        let exhaustionDC = getExhaustionDC(effectiveComfort);

        // Sleeping in medium/heavy armor: recover only 1/4 HD, exhaustion not reduced
        let armorSleepPenalty = false;
        let equippedArmor = null;
        try {
            const armorRuleEnabled = game.settings.get("ionrift-respite", "armorDoffRule");
            if (armorRuleEnabled) {
                equippedArmor = actor.items?.find(i =>
                    i.type === "equipment" && i.system?.equipped &&
                    ["medium", "heavy"].includes(i.system?.type?.value ?? i.system?.armor?.type)
                );
                if (equippedArmor && !activitySchema?.armorSleepWaiver) {
                    armorSleepPenalty = true;
                    // Override HD recovery to 1/4 total HD (Xanathar's rule)
                    baseHdRecovered = Math.max(0, Math.floor(totalHd / 4) - hdPenalty);
                }
            }
        } catch (e) { /* setting may not exist yet */ }

        // Personal gear detection (separate axis from camp comfort)
        const items = actor.items?.map(i => i.name?.toLowerCase()) ?? [];
        const hasBedroll = items.some(n => n?.includes("bedroll"));
        const hasMessKit = items.some(n => n?.includes("mess kit"));
        const hasCooksUtensils = items.some(n => n?.includes("cook") && n?.includes("utensil"));
        const hasDiningGear = hasMessKit || hasCooksUtensils;

        // Activity bonus HD (Rest Fully: +1 HD from deep sleep)
        const bonusHdFromActivity = activitySchema?.outcomes?.success?.effects
            ?.filter(e => e.type === "bonus_hd")
            ?.reduce((sum, e) => sum + (e.value ?? 0), 0) ?? 0;

        // Gear bonuses: bedroll and mess kit effects are part of comfort rules
        const gearBonusHd = (comfortEnabled && hasBedroll) ? 1 : 0;
        // Mess Kit / Cook's Utensils: advantage on exhaustion save
        const exhaustionAdvantage = !!(comfortEnabled && hasDiningGear && exhaustionDC);

        const gearDescriptors = [];
        if (comfortEnabled) {
            if (exhaustionAdvantage) {
                const gearLabel = hasCooksUtensils ? "Cook's Utensils" : "Mess Kit";
                gearDescriptors.push(`${gearLabel}: advantage on exhaustion save`);
            }
            if (gearBonusHd > 0) gearDescriptors.push("Bedroll: +1 HD");
            if (bonusHdFromActivity > 0) gearDescriptors.push("Deep sleep: +1 HD");
            const hasTendBoost = this._isTendWoundsTarget(actor.id);
            if (hasTendBoost) gearDescriptors.push("Tended: comfort +1 tier");
        } else {
            if (bonusHdFromActivity > 0) gearDescriptors.push("Deep sleep: +1 HD");
        }
        if (armorSleepPenalty) gearDescriptors.push(`Sleeping in ${equippedArmor.name}: 1/4 HD, exhaustion not reduced`);

        if (travelRec?.hpMultiplier && typeof actor.unsetFlag === "function") {
            void actor.unsetFlag("ionrift-respite", "travelMishapRecovery");
        }

        // Short rests do not restore HP or HD naturally (players spend HD manually).
        // The full camp flow only runs for short rests under Gritty Realism.
        const isShort = this.restType === "short";
        return {
            hpRestored: isShort ? 0 : baseHpRestored,
            hdRestored: isShort ? 0 : (baseHdRecovered + gearBonusHd + bonusHdFromActivity),
            spellSlotsRestored: this.restType === "long",
            comfortLevel: effectiveComfort,
            campComfort: this.comfort,
            restType: this.restType,
            restedFully: activitySchema?.id === "act_rest_fully",
            exhaustionDC: isShort ? null : exhaustionDC,
            exhaustionAdvantage: isShort ? false : exhaustionAdvantage,
            armorSleepPenalty: isShort ? false : armorSleepPenalty,
            gearBonuses: { hd: gearBonusHd, exhaustionAdvantage },
            gearDescriptors: isShort ? [] : gearDescriptors
        };
    }

    /**
     * Exhaustion save preview for the dawn stage. Does not clear travel flags
     * or apply recovery. Camp comfort, activity and tend-wounds boosts, then
     * bedroll, matching the rest shown on the character dock.
     * @param {Actor} actor
     * @param {object|null} activitySchema
     * @returns {{ exhaustionDC: number|null, exhaustionAdvantage: boolean, comfortLevel: string }}
     */
    previewExhaustion(actor, activitySchema = null) {
        if (this.safeRestSpot || this.restType === "short") {
            return { exhaustionDC: null, exhaustionAdvantage: false, comfortLevel: "safe" };
        }
        let effectiveComfort = this.comfort;
        const comfortEnabled = isComfortEnabled();
        if (!comfortEnabled) {
            effectiveComfort = "safe";
        } else {
            const hasComfortBoost = activitySchema?.outcomes?.success?.effects?.some(effect => effect.type === "comfort_boost");
            if (hasComfortBoost) effectiveComfort = boostComfort(effectiveComfort, 1);
            if (actor?.id && this._isTendWoundsTarget(actor.id)) {
                effectiveComfort = boostComfort(effectiveComfort, 1);
            }
        }
        const items = actor?.items?.map(item => item.name?.toLowerCase()) ?? [];
        const hasBedroll = items.some(name => name?.includes("bedroll"));
        if (comfortEnabled && hasBedroll) {
            effectiveComfort = boostComfort(effectiveComfort, 1);
        }
        const exhaustionDC = getExhaustionDC(effectiveComfort);
        const hasDiningGear = items.some(name => name?.includes("mess kit") || (name?.includes("cook") && name?.includes("utensil")));
        return {
            exhaustionDC,
            exhaustionAdvantage: !!(comfortEnabled && hasDiningGear && exhaustionDC),
            comfortLevel: effectiveComfort
        };
    }

    /**
     * Checks if the given actor is the successful target of a Tend Wounds activity.
     * Scans all character choices for act_tend_wounds with a followUpValue matching actorId,
     * then checks the tender's early result for success/exceptional.
     * @param {string} actorId
     * @returns {boolean}
     */
    _isTendWoundsTarget(actorId) {
        for (const [tenderId, choice] of this.characterChoices) {
            if (choice.activityId !== "act_tend_wounds") continue;
            if (choice.options?.followUpValue !== actorId) continue;
            if (!this._earlyResults) return true;
            const tenderResult = this._earlyResults.get(tenderId);
            if (!tenderResult) return true;
            return ["success", "exceptional"].includes(tenderResult.result);
        }
        return false;
    }

    /**
     * Aggregates combat modifiers from all registered character activity choices.
     * Used to present a summary when an encounter triggers.
     * @param {ActivityResolver} activityResolver - Loaded resolver to look up activity schemas.
     * @returns {{ perCharacter: Object[], partyWide: Object }}
     */
    aggregateCombatBuffs(activityResolver) {
        const perCharacter = [];
        let partyInitiativeTotal = 0;
        const partyEffects = [];

        for (const [characterId, choice] of this.characterChoices) {
            const actor = game.actors.get(characterId);
            if (!actor) continue;

            const activity = activityResolver.activities.get(choice.activityId);
            if (!activity?.combatModifiers) continue;

            const mods = activity.combatModifiers;
            const lines = [];

            if (mods.initiative) {
                const sign = mods.initiative > 0 ? "+" : "";
                lines.push(`${sign}${mods.initiative} initiative`);
            }
            if (mods.initiativeDisadvantage) lines.push("Disadvantage on initiative");
            if (mods.surpriseImmune) lines.push(watchAlertCombatLine());
            if (mods.surpriseDisadvantage) lines.push("Disadvantage on surprise saves");
            if (mods.partyInitiative) {
                partyInitiativeTotal += mods.partyInitiative;
                partyEffects.push(`${actor.name}: +${mods.partyInitiative} party initiative`);
            }

            if (lines.length > 0) {
                perCharacter.push({
                    characterId,
                    characterName: actor.name,
                    activityName: activity.name,
                    modifiers: mods,
                    summary: lines.join(", ")
                });
            }
        }

        return {
            perCharacter,
            partyWide: {
                initiativeBonus: partyInitiativeTotal,
                effects: partyEffects,
                summary: partyInitiativeTotal > 0
                    ? `Party: +${partyInitiativeTotal} initiative from camp setup`
                    : null
            }
        };
    }

    /**
     * Serializes the engine state to a plain object for persistence via world flags.
     * @returns {Object} Serializable snapshot.
     */
    serialize() {
        return {
            restType: this.restType,
            terrainTag: this.terrainTag,
            secondaryTags: this.secondaryTags,
            comfort: this.comfort,
            restModifiers: this.restModifiers,
            safeRestSpot: this.safeRestSpot ?? false,
            phase: this._phase,
            characterChoices: Array.from(this.characterChoices.entries()),
            watchRoster: this.watchRoster,
            outcomes: this.outcomes,
            // Dynamic props set during setup
            shelterEncounterMod: this.shelterEncounterMod ?? 0,
            _encounterBreakdown: this._encounterBreakdown ?? {},
            gmEncounterAdj: this.gmEncounterAdj ?? 0,
            activeShelters: this.activeShelters ?? [],
            weather: this.weather ?? "clear",
            fireRollModifier: this.fireRollModifier ?? 0,
            fireLevel: this.fireLevel ?? "unlit",
            _baseDC: this._baseDC ?? 15,
            awaitingCombat: this.awaitingCombat ?? false
        };
    }

    /**
     * Reconstructs a RestFlowEngine from a serialized snapshot.
     * @param {Object} data - Output of serialize().
     * @returns {RestFlowEngine}
     */
    static deserialize(data) {
        const engine = new RestFlowEngine({
            restType: data.restType,
            terrainTag: data.terrainTag,
            secondaryTags: data.secondaryTags,
            comfort: data.comfort,
            restModifiers: data.restModifiers,
            safeRestSpot: data.safeRestSpot ?? false
        });
        engine._phase = data.phase ?? "setup";
        engine.characterChoices = new Map(data.characterChoices ?? []);
        engine.watchRoster = data.watchRoster ?? [];
        engine.outcomes = data.outcomes ?? [];
        // Restore dynamic props
        engine.shelterEncounterMod = data.shelterEncounterMod ?? 0;
        engine._encounterBreakdown = data._encounterBreakdown ?? {};
        engine.gmEncounterAdj = data.gmEncounterAdj ?? 0;
        engine.activeShelters = data.activeShelters ?? [];
        engine.weather = data.weather ?? "clear";
        engine.fireRollModifier = data.fireRollModifier ?? 0;
        engine.fireLevel = data.fireLevel ?? "unlit";
        engine._baseDC = data._baseDC ?? 15;
        engine.awaitingCombat = data.awaitingCombat ?? false;
        return engine;
    }
}

/**
 * Terrain night-check base from the loaded event table.
 * Falls back to 15 only when that table has no threshold.
 * @param {{ tables?: { get: (tag: string) => { noEventThreshold?: number }|undefined } }} eventResolver
 * @param {string} terrainTag
 * @returns {number}
 */
export function readTerrainBaseDc(eventResolver, terrainTag) {
    const threshold = eventResolver?.tables?.get(terrainTag)?.noEventThreshold;
    return typeof threshold === "number" ? threshold : 15;
}
