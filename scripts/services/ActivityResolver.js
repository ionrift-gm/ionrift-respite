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
     * @returns {Object[]} Filtered activity schemas.
     */
    getAvailableActivities(actor, restType) {
        const available = [];
        for (const activity of this.activities.values()) {
            if (!activity.restTypes.includes(restType)) continue;
            if (activity.disabled) continue;

            // Gate Study behind module setting
            if (activity.id === "act_study") {
                try {
                    if (!game.settings.get("ionrift-respite", "enableStudy")) continue;
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

        // Calculate DC with comfort friction
        const comfortDcMod = { safe: 0, sheltered: 0, rough: 2, hostile: 5 };
        const baseDc = activity.check.dc ?? 12;
        const adjustedDc = baseDc + (comfortDcMod[comfort] ?? 0);

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
            if (activity.check.altSkill) {
                const primary = actor.system?.skills?.[activity.check.skill]?.total ?? 0;
                const alt = actor.system?.skills?.[activity.check.altSkill]?.total ?? 0;
                if (alt > primary) chosenSkillKey = activity.check.altSkill;
            }
            const skillData = actor.system?.skills?.[chosenSkillKey];
            modifier = skillData?.total ?? skillData?.mod ?? 0;
            rollLabel = chosenSkillKey.toUpperCase();
        }
        const roll = await new Roll(`1d20 + ${modifier}`).evaluate();

        const total = roll.total;

        // Determine outcome tier
        let resultTier;
        if (activity.outcomes.exceptional && total >= activity.outcomes.exceptional.threshold) {
            resultTier = "exceptional";
        } else if (total >= adjustedDc) {
            resultTier = "success";
        } else {
            resultTier = "failure";

            // Hostile comfort: failure triggers complication
            if (comfort === "hostile" || comfort === "rough") {
                // Whisper failure to player
                const ownerIds = game.users.filter(u => actor.testUserPermission(u, "OWNER")).map(u => u.id);
                await roll.toMessage({
                    speaker: ChatMessage.getSpeaker({ actor }),
                    flavor: `<strong>${activity.name}</strong> (${rollLabel}) - DC ${adjustedDc}<br><em style="color:#e88;">Failed.</em> ${activity.outcomes.failure?.narrative ?? "The attempt fails."}`,
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
            flavor: `<strong>${activity.name}</strong> (${rollLabel}) - DC ${adjustedDc}<br><em style="color:${tierColor};">${tierLabel}.</em> ${outcome.narrative ?? ""}`,
            whisper: ownerIds
        });

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

        // Check requiresSpellbook (Wizard or has a spellbook item)
        if (prereqs.requiresSpellbook) {
            const className = (actor.system?.details?.class ?? actor.classes?.wizard?.name ?? "").toLowerCase();
            const isWizard = className.includes("wizard");
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
     * Faded = prereqs fail only because a spell is known but not prepared.
     * Minor = quick utility actions that don't consume the rest activity slot (e.g. Identify).
     * @param {Actor} actor
     * @param {string} restType
     * @returns {{ available: Object[], faded: Object[], minor: Object[] }}
     */
    getAvailableActivitiesWithFaded(actor, restType, options = {}) {
        const available = [];
        const faded = [];
        const minor = [];
        const fadedMinor = [];
        const isFireLit = options.isFireLit ?? true;

        for (const activity of this.activities.values()) {
            if (activity.disabled) continue;
            if (!activity.restTypes.includes(restType)) continue;

            // Runtime attunement check
            if (activity.id === "act_attune" && !this._hasAttuneableItems(actor)) {
                continue;
            }

            if (this._meetsPrerequisites(actor, activity.prerequisites)) {
                // Fire-gated activities show as faded when fire is unlit
                if (activity.requiresFire && !isFireLit) {
                    faded.push({
                        ...activity,
                        fadedHint: "Requires a lit fire."
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
