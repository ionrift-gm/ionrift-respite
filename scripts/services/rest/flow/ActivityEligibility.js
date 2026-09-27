import { MODULE_ID } from "../../../data/moduleId.js";
import { isComfortEnabled } from "../../camp/gear/ComfortCalculator.js";
import { isFletchingEnabled } from "../../crafting/settings/FletchingSettings.js";
import { isTrainingEnabled } from "../../crafting/settings/TrainingSettings.js";
import {
    isProfessionActivityEnabled,
    isChefTreatCookingOnly,
    isForagingEnabled,
    isHuntingEnabled
} from "../../travel/settings/TravelSettings.js";
import { hasChefFeat } from "../../meal/buffs/ChefFeat.js";

/** Activities hidden when the GM marks a safe rest spot (no encounter risk; no redundant camp duties). */
export const SAFE_REST_SPOT_EXCLUDED_ACTIVITY_IDS = new Set([
    "act_keep_watch",
    "act_defenses",
    "act_tend_wounds"
]);

/** Extra exclusions for tavern terrain (full recovery is automatic; no profession crafting or wilderness gathering). */
export const TAVERN_REST_EXCLUDED_ACTIVITY_IDS = new Set([
    "act_rest_fully",
    "act_forage",
    "act_hunt"
]);

/** Activities hidden when the comfort subsystem is disabled. */
export const COMFORT_EXCLUDED_ACTIVITY_IDS = new Set([
    "act_rest_fully",
    "act_tend_wounds",
    "act_tell_tales"
]);

/** Activities that only exist to feed the night encounter layer; hidden when encounters are off. */
export const ENCOUNTER_ACTIVITY_IDS = new Set([
    "act_keep_watch",
    "act_defenses"
]);

/**
 * Checks whether encounters are enabled in module settings.
 * @returns {boolean}
 */
export function areEncountersEnabled() {
    try {
        const value = game.settings.get(MODULE_ID, "enableEncounters");
        return value === undefined || value === null ? true : !!value;
    } catch {
        return true;
    }
}

/**
 * Whether Pray / Meditate is offered during rests. Off unless a world opts in,
 * matching the registered setting default.
 * @returns {boolean}
 */
export function isPrayMeditateEnabled() {
    try {
        const value = game.settings.get(MODULE_ID, "enablePrayMeditate");
        return value === undefined || value === null ? false : !!value;
    } catch {
        return false;
    }
}

/**
 * Checks if an activity is excluded based on rest options (safe rest spot, tavern).
 * @param {object} activity
 * @param {{ safeRestSpot?: boolean, tavernRest?: boolean }} [options]
 * @returns {boolean}
 */
export function isActivityExcludedForRestOptions(activity, options = {}) {
    if (options.tavernRest) {
        if (SAFE_REST_SPOT_EXCLUDED_ACTIVITY_IDS.has(activity.id)) return true;
        if (TAVERN_REST_EXCLUDED_ACTIVITY_IDS.has(activity.id)) return true;
        if (activity.category === "profession") return true;
        return false;
    }
    if (options.safeRestSpot && SAFE_REST_SPOT_EXCLUDED_ACTIVITY_IDS.has(activity.id)) return true;
    return false;
}

/**
 * Single source of truth for rest and downtime activity eligibility.
 */
export class ActivityEligibility {

    /**
     * Checks whether an activity is blocked by world settings, options, or runtime toggles.
     *
     * @param {Actor} actor
     * @param {object} activity
     * @param {object} [options]
     * @returns {boolean} True if the activity is gated (blocked)
     */
    static isGatedBySettings(actor, activity, options = {}) {
        if (!activity || activity.disabled) return true;

        const id = activity.catalogId || activity.id;

        // Context / rest exclusions (safe rest spot, tavern)
        if (isActivityExcludedForRestOptions({ ...activity, id }, options)) return true;

        // Subsystem toggles
        if (!isComfortEnabled() && COMFORT_EXCLUDED_ACTIVITY_IDS.has(id)) return true;
        if (!areEncountersEnabled() && ENCOUNTER_ACTIVITY_IDS.has(id)) return true;

        // Training toggle (XP training in standard rest)
        if (id === "act_train" && !isTrainingEnabled()) return true;

        // Profession activities (cooking, brewing, crafting, tailoring)
        if (activity.category === "profession") {
            if (!isProfessionActivityEnabled(activity)) return true;
            if (isChefTreatCookingOnly() && (activity.id === "act_cook" || activity.id === "cook")) {
                if (!hasChefFeat(actor)) return true;
            }
        }

        // Fletching toggle
        if (id === "act_fletch" && !isFletchingEnabled()) return true;

        // Foraging toggle
        if (activity.id === "act_forage" && !isForagingEnabled()) return true;

        // Hunting toggle
        if (activity.id === "act_hunt" && !isHuntingEnabled()) return true;

        // Copy Spell toggle
        if (id === "act_scribe") {
            try {
                if (!game.settings.get(MODULE_ID, "enableCopySpell")) return true;
            } catch {
                /* setting may not exist yet */
            }
        }

        // Pray / Meditate toggle
        if (id === "act_pray" && !isPrayMeditateEnabled()) return true;

        // Attunement items check
        if (activity.id === "act_attune" && !this.hasAttuneableItems(actor)) {
            return true;
        }

        return false;
    }

    /**
     * Checks whether an activity is available for an actor given world settings and actor prerequisites.
     * Works for both standard rest activities and 7-day downtime activities.
     *
     * @param {Actor} actor
     * @param {object} activity
     * @param {object} [options]
     * @returns {boolean}
     */
    static isEligible(actor, activity, options = {}) {
        if (this.isGatedBySettings(actor, activity, options)) return false;
        if (!this.meetsPrerequisites(actor, activity.prerequisites)) return false;
        return true;
    }

    /**
     * Evaluates an activity's prerequisites against an actor.
     *
     * @param {Actor} actor
     * @param {object|null} prereqs
     * @returns {boolean}
     */
    static meetsPrerequisites(actor, prereqs) {
        if (!actor || !prereqs) return true;

        // Check tool proficiencies / physical inventory tools
        if (prereqs.tools?.length > 0) {
            const actorTools = this.getActorToolProficiencies(actor);
            if (!prereqs.tools.some(t => actorTools.includes(t))) return false;
        }

        // Check skill proficiencies
        if (prereqs.proficiencies?.length > 0) {
            const prereqAdapter = game.ionrift?.respite?.adapter;
            const actorSkills = prereqAdapter
                ? prereqAdapter.getProficientSkillKeys(actor)
                : Object.keys(actor.system?.skills ?? {}).filter(s => (actor.system.skills[s]?.proficient ?? 0) > 0);

            const normalizedPrereqs = prereqAdapter
                ? prereqs.proficiencies.map(p => prereqAdapter.normalizeSkillKey(p))
                : prereqs.proficiencies;

            if (!normalizedPrereqs.some(p => actorSkills.includes(p)) &&
                !prereqs.proficiencies.some(p => actorSkills.includes(p))) {
                return false;
            }
        }

        // Check minimum level
        if (prereqs.minimumLevel) {
            const prereqAdapter = game.ionrift?.respite?.adapter;
            const level = prereqAdapter ? prereqAdapter.getLevel(actor) : (actor.system?.details?.level ?? 0);
            if (level < prereqs.minimumLevel) return false;
        }

        // Check maximum level
        if (prereqs.maximumLevel) {
            const prereqAdapter = game.ionrift?.respite?.adapter;
            const level = prereqAdapter ? prereqAdapter.getLevel(actor) : (actor.system?.details?.level ?? 0);
            if (level > prereqs.maximumLevel) return false;
        }

        // Check spell prerequisites (actor must have at least one PREPARED)
        if (prereqs.spells?.length > 0) {
            const { prepared } = this.getActorSpells(actor);
            if (!prereqs.spells.some(s => prepared.has(s.toLowerCase()))) return false;
        }

        // Check isSpellcaster (actor must have spell slots)
        if (prereqs.isSpellcaster) {
            const prereqAdapter = game.ionrift?.respite?.adapter;
            const hasSlots = prereqAdapter ? prereqAdapter.isSpellcaster(actor) : (() => {
                const spells = actor.system?.spells ?? {};
                return Object.keys(spells).some(k => (spells[k]?.max ?? 0) > 0);
            })();
            if (!hasSlots) return false;
        }

        // Check requiresSpellbook
        if (prereqs.requiresSpellbook) {
            const prereqAdapter = game.ionrift?.respite?.adapter;
            if (prereqAdapter) {
                if (!prereqAdapter.hasSpellbook(actor)) return false;
            } else {
                const classEntries = actor.classes ?? {};
                const classNames = new Set(
                    Object.values(classEntries).map(c => c.name?.toLowerCase().trim())
                );
                const isWizard = !!classEntries.wizard || classNames.has("wizard");
                if (!isWizard) {
                    const isWarlock = !!classEntries.warlock || classNames.has("warlock");
                    const hasSpellbook = isWarlock && (actor.items ?? []).some(i =>
                        i.name?.toLowerCase().includes("spellbook") || i.name?.toLowerCase().includes("book of shadows")
                    );
                    if (!hasSpellbook) return false;
                }
            }
        }

        // Attunement items runtime check
        if (prereqs._requiresAttuneableItems) {
            if (!this.hasAttuneableItems(actor)) return false;
        }

        return true;
    }

    /**
     * Extracts tool proficiency keys and inventory tools from an actor.
     * Routes through adapter where available, with deep inventory scanning fallback.
     *
     * @param {Actor} actor
     * @returns {string[]}
     */
    static getActorToolProficiencies(actor) {
        if (!actor) return [];

        const toolAdapter = game.ionrift?.respite?.adapter;
        if (toolAdapter?.getToolProficiencies) {
            const adapted = toolAdapter.getToolProficiencies(actor);
            if (Array.isArray(adapted) && adapted.length > 0) return adapted;
        }

        const profKeys = new Set();

        const tools = actor.system?.tools ?? {};
        for (const [key, data] of Object.entries(tools)) {
            if ((data?.value ?? 0) > 0 || (data?.effectValue ?? 0) > 0) {
                profKeys.add(key);
            }
        }

        for (const item of actor.items ?? []) {
            const baseItem = item.system?.type?.baseItem;
            if (baseItem) profKeys.add(baseItem);

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

    /**
     * Returns prepared and known spell name Sets for an actor.
     *
     * @param {Actor} actor
     * @returns {{ prepared: Set<string>, known: Set<string> }}
     */
    static getActorSpells(actor) {
        const prepared = new Set();
        const known = new Set();

        if (!actor) return { prepared, known };

        for (const item of actor.items ?? []) {
            if (item.type !== "spell") continue;
            const name = item.name?.toLowerCase();
            if (!name) continue;

            known.add(name);

            const raw = item.toObject?.()?.system ?? {};
            const mode = raw.method ?? raw.preparation?.mode ?? "";
            const isPrepared = raw.prepared ?? raw.preparation?.prepared ?? false;

            if (mode === "always" || mode === "innate" || mode === "pact" || mode === "atwill") {
                prepared.add(name);
                continue;
            }

            if (isPrepared) {
                prepared.add(name);
            }
        }

        return { prepared, known };
    }

    /**
     * Checks if actor has any items requiring attunement that aren't attuned.
     *
     * @param {Actor} actor
     * @returns {boolean}
     */
    static hasAttuneableItems(actor) {
        if (!actor) return false;
        for (const item of actor.items ?? []) {
            const attunement = item.system?.attunement;
            if ((attunement === "required" || attunement === 1) && !item.system?.attuned) {
                return true;
            }
        }
        return false;
    }
}
