/**
 * Curated meal buff presets for recipe authoring and craft UI previews.
 * Runtime application lives in MealPhaseHandler.
 */

export const MEAL_BUFF_DURATION_LABELS = {
    immediate: "Immediate",
    untilLongRest: "Until long rest",
    untilShortRest: "Until short rest",
    nextSave: "Next save"
};

export const MEAL_BUFF_TYPE_LABELS = {
    temp_hp: "Temp HP",
    heal: "Healing",
    advantage: "Advantage",
    exhaustion_save: "Exhaustion save",
    resistance: "Resistance",
    hit_die: "Hit die"
};

export const FOOD_TAG_OPTIONS = [
    { id: "cooked_meal", label: "Cooked meal" },
    { id: "preserved", label: "Preserved" },
    { id: "drink", label: "Drink" },
    { id: "meat", label: "Raw meat" },
    { id: "raw_fish", label: "Raw fish" }
];

/**
 * @typedef {Object} MealBuffPreset
 * @property {string} id
 * @property {string} label
 * @property {string} description
 * @property {boolean} wellFed
 * @property {Object|null} buff
 */

/** @type {MealBuffPreset[]} */
export const MEAL_BUFF_PRESETS = [
    {
        id: "none",
        label: "No buff",
        description: "Satiates only. No Well Fed slot interaction.",
        wellFed: false,
        buff: null
    },
    {
        id: "temp_hp_prof",
        label: "Temp HP (proficiency)",
        description: "Temporary HP equal to proficiency bonus until long rest.",
        wellFed: true,
        buff: {
            type: "temp_hp",
            formula: "@prof",
            duration: "untilLongRest",
            target: "self"
        }
    },
    {
        id: "temp_hp_prof_1d4",
        label: "Temp HP (prof + 1d4)",
        description: "Proficiency bonus plus 1d4 temporary HP until long rest.",
        wellFed: true,
        buff: {
            type: "temp_hp",
            formula: "@prof + 1d4",
            duration: "untilLongRest",
            target: "self"
        }
    },
    {
        id: "temp_hp_prof_party",
        label: "Temp HP (proficiency, party)",
        description: "Party-wide temporary HP from proficiency bonus until long rest.",
        wellFed: true,
        buff: {
            type: "temp_hp",
            formula: "@prof",
            duration: "untilLongRest",
            target: "party"
        }
    },
    {
        id: "exhaustion_save_15",
        label: "Exhaustion save (DC 15)",
        description: "Immediate Constitution save to remove one exhaustion level.",
        wellFed: true,
        buff: {
            type: "exhaustion_save",
            formula: "15",
            duration: "immediate",
            target: "self"
        }
    },
    {
        id: "advantage_con",
        label: "Advantage on CON saves",
        description: "Advantage on the next Constitution saving throw.",
        wellFed: true,
        buff: {
            type: "advantage",
            save: { ability: "con" },
            duration: "nextSave",
            target: "self"
        }
    },
    {
        id: "heal_prof",
        label: "Healing (proficiency)",
        description: "Immediate healing equal to proficiency bonus.",
        wellFed: true,
        buff: {
            type: "heal",
            formula: "@prof",
            duration: "immediate",
            target: "self"
        }
    },
    {
        id: "hit_die_1",
        label: "Restore 1 hit die",
        description: "Immediately restores one spent hit die.",
        wellFed: true,
        buff: {
            type: "hit_die",
            formula: "1",
            duration: "immediate",
            target: "self"
        }
    }
];

/**
 * @param {Object|null|undefined} buff
 * @returns {Object|null}
 */
export function formatMealBuffPreview(buff) {
    if (!buff) return null;
    const label = MEAL_BUFF_TYPE_LABELS[buff.type] ?? buff.type;
    const duration = MEAL_BUFF_DURATION_LABELS[buff.duration] ?? buff.duration ?? "";
    let detail = buff.formula ?? "";
    if (buff.type === "advantage") {
        const ab = buff.save?.ability ?? buff.formula ?? "con";
        detail = String(ab).toUpperCase();
    }
    if (buff.type === "resistance") {
        detail = buff.damageType ?? buff.formula ?? "";
    }
    return {
        label,
        formula: detail,
        duration,
        target: buff.target ?? "self"
    };
}

/**
 * @param {Object|null|undefined} a
 * @param {Object|null|undefined} b
 * @returns {boolean}
 */
export function mealBuffsEqual(a, b) {
    if (a == null && b == null) return true;
    if (a == null || b == null) return false;
    try {
        return JSON.stringify(a) === JSON.stringify(b);
    } catch {
        return false;
    }
}

/**
 * @param {Object|null|undefined} rf - ionrift-respite flags object
 * @returns {string}
 */
export function matchMealBuffPresetId(rf) {
    if (!rf) return "none";
    const wellFed = rf.wellFed === true;
    const buff = rf.buff ?? null;

    for (const preset of MEAL_BUFF_PRESETS) {
        if (preset.wellFed === wellFed && mealBuffsEqual(preset.buff, buff)) {
            return preset.id;
        }
    }
    if (!wellFed && buff == null) return "none";
    return "custom";
}

/**
 * @param {string} presetId
 * @returns {MealBuffPreset|undefined}
 */
export function getMealBuffPreset(presetId) {
    return MEAL_BUFF_PRESETS.find(p => p.id === presetId);
}

/**
 * Apply a preset onto ionrift-respite flags (wellFed + buff only).
 * @param {Object} rf - Existing flags object to mutate
 * @param {string} presetId
 */
export function applyMealBuffPresetToFlags(rf, presetId) {
    const preset = getMealBuffPreset(presetId);
    if (!preset) return;
    rf.wellFed = preset.wellFed;
    if (preset.buff) rf.buff = foundry.utils.deepClone(preset.buff);
    else delete rf.buff;
}

/**
 * Build satiates array from checkbox state.
 * @param {boolean} food
 * @param {boolean} water
 * @returns {string[]}
 */
export function buildSatiatesList(food, water) {
    const out = [];
    if (food) out.push("food");
    if (water) out.push("water");
    return out;
}

/**
 * Default food tag for a crafting profession.
 * @param {string} professionId
 * @returns {string}
 */
export function defaultFoodTagForProfession(professionId) {
    return professionId === "brewing" ? "drink" : "cooked_meal";
}

/**
 * Default satiates for a crafting profession.
 * @param {string} professionId
 * @returns {string[]}
 */
export function defaultSatiatesForProfession(professionId) {
    return professionId === "brewing" ? ["water"] : ["food"];
}
