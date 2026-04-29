import { getPartyActors } from "../module.js";

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
     */
    constructor(config) {
        this.restType = config.restType ?? "long";
        this.terrainTag = config.terrainTag ?? "wilderness";
        this.secondaryTags = config.secondaryTags ?? [];
        this.comfort = config.comfort ?? "sheltered";
        this.restModifiers = config.restModifiers ?? {};

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

        // Build watch roster from "alert" activities (perimeter-facing characters)
        const ALERT_ACTIVITIES = ["act_keep_watch", "act_scout", "act_defenses"];
        if (ALERT_ACTIVITIES.includes(activityId)) {
            this.watchRoster.push({
                characterId,
                slot: options.watchSlot ?? "any"
            });
        }
    }

    /**
     * Phase 3: Resolve events. Rolls against the terrain event table.
     * @param {EventResolver} eventResolver
     * @param {string} [scoutTier] - Scouting result tier (nat1, poor, average, good, nat20, none)
     * @returns {Object[]} Array of triggered events.
     */
    async resolveEvents(eventResolver, scoutTier = "none") {
        if (this.restType === "short") {
            this._phase = "resolve";
            return [];
        }

        this._phase = "events";

        // All modifiers adjust the THRESHOLD (DC), not the roll.
        // Positive shelter+weather (shelterEncounterMod), scouting, fire, and defenses each
        // increase campMods so effectiveDC drops (easier quiet night). Positive gmEncounterAdj
        // raises effectiveDC (harder quiet night). Must match RestSetupApp encounter bar total.
        const campMods = (this.fireRollModifier ?? 0)
            + (this.shelterEncounterMod ?? 0)
            + (this._encounterBreakdown?.scouting ?? 0)
            + (this._encounterBreakdown?.defenses ?? 0)
            + (this._encounterBreakdown?.travelMishap ?? 0);
        const baseDC = this._baseDC ?? 15; // Set during setup from terrain table
        const effectiveDC = Math.max(1, baseDC - campMods + (this.gmEncounterAdj ?? 0));
        console.log(`[Respite:Engine] resolveEvents — baseDC=${baseDC}, shelterEncounterMod=${this.shelterEncounterMod ?? 0}, fireRollModifier=${this.fireRollModifier ?? 0}, breakdownDefenses=${this._encounterBreakdown?.defenses ?? 0}, campMods=${campMods}, gmAdj=${this.gmEncounterAdj ?? 0} → effectiveDC=${effectiveDC}, scoutTier=${scoutTier}`);
        const events = await eventResolver.roll(this.terrainTag, this.watchRoster, effectiveDC, scoutTier);
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

        for (const [characterId, choice] of this.characterChoices) {
            if (!rosterIds.has(characterId)) continue;
            const actor = game.actors.get(characterId);
            if (!actor) continue;

            // Use early result if available (rolled during activity phase), otherwise roll now
            const activityResult = earlyResults.get(characterId)
                ?? await activityResolver.resolve(
                    choice.activityId,
                    actor,
                    this.terrainTag,
                    this.comfort,
                    choice.options
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

                return {
                    source: "event",
                    eventId: e.id,
                    eventName: e.name,
                    category: e.category,
                    result: e.result,
                    resolvedOutcome: e.resolvedOutcome ?? null,
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
        const maxHp = actor.system?.attributes?.hp?.max ?? 0;
        const currentHp = actor.system?.attributes?.hp?.value ?? 0;
        const totalHd = actor.system?.attributes?.hd?.max ?? actor.system?.details?.level ?? 0;
        const rawHdRecovery = Math.max(1, Math.floor(totalHd / 2));

        // Effective comfort: start with camp comfort, boost if activity has comfort_boost
        const COMFORT_TIERS = ["hostile", "rough", "sheltered", "safe"];
        let effectiveComfort = this.comfort;
        const hasComfortBoost = activitySchema?.outcomes?.success?.effects?.some(e => e.type === "comfort_boost");
        if (hasComfortBoost) {
            const idx = COMFORT_TIERS.indexOf(this.comfort);
            if (idx >= 0 && idx < COMFORT_TIERS.length - 1) {
                effectiveComfort = COMFORT_TIERS[idx + 1];
            }
        }

        // Tend Wounds: if someone successfully tended this character, boost their comfort too
        const hasTendBoost = this._isTendWoundsTarget(actor.id);
        if (hasTendBoost) {
            const idx = COMFORT_TIERS.indexOf(effectiveComfort);
            if (idx >= 0 && idx < COMFORT_TIERS.length - 1) {
                effectiveComfort = COMFORT_TIERS[idx + 1];
            }
        }

        // Comfort tier penalties (using effective comfort)
        const HD_PENALTY = { safe: 0, sheltered: 0, rough: 1, hostile: 2 };
        const hdPenalty = HD_PENALTY[effectiveComfort] ?? 0;
        let baseHdRecovered = Math.max(0, rawHdRecovery - hdPenalty);

        const isHostile = effectiveComfort === "hostile";
        const maxHpRestorable = isHostile ? Math.floor(maxHp * 0.75) : maxHp;
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
        let exhaustionDC = effectiveComfort === "hostile" ? 15
            : effectiveComfort === "rough" ? 10
            : null;

        // ── Xanathar's Armor Sleep Penalty (gated by setting) ──
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

        // Gear bonuses
        const gearBonusHd = hasBedroll ? 1 : 0;
        // Mess Kit / Cook's Utensils: advantage on exhaustion save when fire is lit
        const fireIsLit = this.fireLevel && this.fireLevel !== "unlit";
        const exhaustionAdvantage = !!(hasDiningGear && fireIsLit && exhaustionDC);

        const gearDescriptors = [];
        if (exhaustionAdvantage) {
            const gearLabel = hasCooksUtensils ? "Cook's Utensils" : "Mess Kit";
            gearDescriptors.push(`${gearLabel}: advantage on exhaustion save`);
        } else if (hasDiningGear && !fireIsLit && exhaustionDC) {
            const gearLabel = hasCooksUtensils ? "Cook's Utensils" : "Mess Kit";
            gearDescriptors.push(`${gearLabel}: no fire (advantage inactive)`);
        }
        if (gearBonusHd > 0) gearDescriptors.push("Bedroll: +1 HD");
        if (bonusHdFromActivity > 0) gearDescriptors.push("Deep sleep: +1 HD");
        if (hasTendBoost) gearDescriptors.push("Tended: comfort +1 tier");
        if (armorSleepPenalty) gearDescriptors.push(`Sleeping in ${equippedArmor.name}: 1/4 HD, exhaustion not reduced`);

        if (travelRec?.hpMultiplier && typeof actor.unsetFlag === "function") {
            void actor.unsetFlag("ionrift-respite", "travelMishapRecovery");
        }

        return {
            hpRestored: baseHpRestored,
            hdRestored: baseHdRecovered + gearBonusHd + bonusHdFromActivity,
            spellSlotsRestored: this.restType === "long",
            comfortLevel: effectiveComfort,
            campComfort: this.comfort,
            restType: this.restType,
            restedFully: activitySchema?.id === "act_rest_fully",
            exhaustionDC,
            exhaustionAdvantage,
            armorSleepPenalty,
            gearBonuses: { hd: gearBonusHd, exhaustionAdvantage },
            gearDescriptors
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
            if (mods.surpriseImmune) lines.push("Cannot be surprised");
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

    // ── Persistence ──────────────────────────────────────────────

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
            scoutingResult: this.scoutingResult ?? null,
            scoutingComplication: this.scoutingComplication ?? false,
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
            restModifiers: data.restModifiers
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
        engine.scoutingResult = data.scoutingResult ?? null;
        engine.scoutingComplication = data.scoutingComplication ?? false;
        engine.fireRollModifier = data.fireRollModifier ?? 0;
        engine.fireLevel = data.fireLevel ?? "unlit";
        engine._baseDC = data._baseDC ?? 15;
        engine.awaitingCombat = data.awaitingCombat ?? false;
        return engine;
    }
}
