import { ActivityEligibility } from "../../services/rest/flow/ActivityEligibility.js";

/**
 * Registry of downtime activities for a 7-day long rest.
 * Card hints stay within CARD_HINT_MAX_CHARS. The night list uses the
 * same budget through clipToCardHint.
 */
export const DOWNTIME_STATIONS = Object.freeze([
    { id: "weapon_rack", label: "Weapon Rack", icon: "fas fa-shield-alt" },
    { id: "cooking_station", label: "Cooking", icon: "fas fa-utensils" },
    { id: "medical_bed", label: "First Aid", icon: "fas fa-hand-holding-medical" },
    { id: "bedroll", label: "Your Bedroll", icon: "fas fa-bed" },
    { id: "workbench", label: "Workbench", icon: "fas fa-tools" },
    { id: "town", label: "Town & Quarters", icon: "fas fa-city" }
]);

export const DOWNTIME_ACTIVITIES = Object.freeze([
    // ─── Weapon Rack ───────────────────────────────────────────────────────
    {
        id: "fletch",
        catalogId: "act_fletch",
        label: "Fletch Arrows",
        icon: "fas fa-feather-alt",
        skill: "sle",
        altSkills: ["nat"],
        check: { dc: 12, skills: ["sle", "nat"] },
        maxDays: 7,
        haven: "both",
        stationId: "weapon_rack",
        hint: "Arrows or bolts"
    },
    {
        id: "fortify",
        catalogId: "act_defenses",
        label: "Fortify",
        icon: "fas fa-shield-alt",
        skill: "sur",
        altSkills: ["ste", "ath"],
        check: { dc: 12, skills: ["sur", "ste", "ath"] },
        maxDays: 7,
        haven: "wilderness",
        stationId: "weapon_rack",
        hint: "Fewer encounters each night"
    },
    {
        id: "guard",
        catalogId: "act_keep_watch",
        label: "Guard",
        icon: "fas fa-eye",
        skill: "prc",
        maxDays: 7,
        haven: "wilderness",
        stationId: "weapon_rack",
        hint: "Surprise immune on watch"
    },

    // ─── Cooking Station ───────────────────────────────────────────────────
    {
        id: "cook",
        label: "Cook",
        icon: "fas fa-utensils",
        skill: null,
        category: "profession",
        prerequisites: { tools: ["cook"] },
        maxDays: 7,
        haven: "wilderness",
        stationId: "cooking_station",
        hint: "Meals from stored food"
    },
    {
        id: "brew",
        label: "Brew",
        icon: "fas fa-flask-vial",
        skill: null,
        category: "profession",
        prerequisites: { tools: ["brewer", "alchemist", "herb"] },
        maxDays: 7,
        haven: "both",
        stationId: "cooking_station",
        hint: "A trail drink"
    },

    // ─── First Aid (Medical Bed) ───────────────────────────────────────────
    {
        id: "tend",
        catalogId: "act_tend_wounds",
        label: "Tend Wounds",
        icon: "fas fa-hand-holding-medical",
        skill: "med",
        check: { dc: 12, skills: ["med"] },
        maxDays: 7,
        haven: "both",
        stationId: "medical_bed",
        hint: "Ease injuries and disease"
    },

    // ─── Your Bedroll / Camp ───────────────────────────────────────────────
    {
        id: "train",
        catalogId: "act_train",
        label: "Train",
        icon: "fas fa-shield-halved",
        skill: null,
        maxDays: 5, // Diminishing returns cap
        haven: "both",
        stationId: "bedroll",
        hint: "Drill, fading after 5 days"
    },
    {
        id: "rest",
        catalogId: "act_rest_fully",
        label: "Rest & Recovery",
        icon: "fas fa-bed",
        skill: null,
        maxDays: 7,
        haven: "both",
        stationId: "bedroll",
        hint: "Full recovery, no risk"
    },
    {
        id: "pray",
        catalogId: "act_pray",
        label: "Pray / Meditate",
        icon: "fas fa-pray",
        skill: "rel",
        altSkills: ["ins"],
        prerequisites: { proficiencies: ["rel", "ins"] },
        maxDays: 7,
        haven: "both",
        stationId: "bedroll",
        hint: "Temp HP from prayer"
    },
    {
        id: "tales",
        catalogId: "act_tell_tales",
        label: "Tell Tales",
        icon: "fas fa-theater-masks",
        skill: "prf",
        prerequisites: { proficiencies: ["prf"] },
        maxDays: 7,
        haven: "both",
        stationId: "bedroll",
        hint: "Inspires an ally"
    },
    {
        id: "craft",
        catalogId: "act_craft",
        label: "Craft",
        icon: "fas fa-tools",
        skill: null,
        category: "profession",
        prerequisites: { tools: ["tinker", "potter", "glassblower", "mason", "smith"] },
        maxDays: 7,
        haven: "both",
        stationId: "bedroll",
        hint: "Work raw materials"
    },
    {
        id: "other",
        catalogId: "act_other",
        label: "Other",
        icon: "fas fa-comments",
        skill: null,
        maxDays: 7,
        haven: "both",
        stationId: "bedroll",
        hint: "Your own time"
    },

    // ─── Workbench ────────────────────────────────────────────────────────
    // Examine (focus, taste, spell Identify) is the dock control, not a day.
    {
        id: "scribe",
        catalogId: "act_scribe",
        label: "Copy Spell",
        icon: "fas fa-scroll",
        skill: "arc",
        prerequisites: { requiresSpellbook: true },
        maxDays: 7,
        haven: "both",
        stationId: "workbench",
        hint: "50 gp per spell level"
    },

    // ─── Civilized / Safe Rest Stations ────────────────────────────────────
    {
        id: "research",
        label: "Research",
        icon: "fas fa-book-open",
        skill: "arc",
        maxDays: 5, // Diminishing returns cap
        haven: "civilized",
        stationId: "workbench",
        hint: "Study during a safe rest"
    },
    {
        id: "carouse",
        label: "Carouse",
        icon: "fas fa-beer-mug-empty",
        skill: null,
        maxDays: 7,
        haven: "civilized",
        stationId: "town",
        hint: "Rumors and contacts"
    },
    {
        id: "work",
        label: "Work",
        icon: "fas fa-coins",
        skill: null,
        maxDays: 7,
        haven: "civilized",
        stationId: "town",
        hint: "Earn coin at a trade"
    }
]);

export class ActivityRegistry {

    /**
     * Returns activities available for the specified haven type.
     *
     * @param {"civilized"|"wilderness"} haven
     * @returns {Array<object>}
     */
    static getActivitiesForHaven(haven = "wilderness") {
        return DOWNTIME_ACTIVITIES.filter(a => a.haven === "both" || a.haven === haven);
    }

    /**
     * Returns activities available for the specified actor and haven.
     * Evaluates tool proficiencies, Chef feat, and profession settings.
     *
     * @param {Actor|null} actor
     * @param {"civilized"|"wilderness"} [haven="wilderness"]
     * @param {object} [options]
     * @returns {Array<object>}
     */
    static getActivitiesForActor(actor, haven = "wilderness", options = {}) {
        return this.getActivitiesForHaven(haven).filter(activity =>
            !actor || ActivityEligibility.isEligible(actor, activity, options)
        );
    }

    /**
     * Looks up an activity definition by its ID.
     *
     * @param {string} id
     * @returns {object|null}
     */
    static getActivity(id) {
        if (!id) return null;
        if (id === "act_other") id = "other";
        else if (id === "act_rest_fully") id = "rest";
        else if (id === "act_tend_wounds") id = "tend";
        else if (id === "act_keep_watch") id = "guard";
        else if (id === "act_defenses") id = "fortify";
        else if (id === "act_train") id = "train";
        else if (id === "act_fletch") id = "fletch";
        else if (id === "act_pray") id = "pray";
        else if (id === "act_tell_tales") id = "tales";
        else if (id === "act_craft") id = "craft";
        else if (id === "act_scribe") id = "scribe";
        return DOWNTIME_ACTIVITIES.find(a => a.id === id) ?? null;
    }
}
