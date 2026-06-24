/**
 * Curated meal buff presets for recipe authoring and craft UI previews.
 * Base presets ship in the module; overlay packs register additional presets
 * at runtime (see OverlayMealBuffPresetLoader). Registered meal buff handlers
 * may expose authoringPreset for the homebrew editor.
 * Runtime application lives in MealPhaseHandler via MealBuffHandlerRegistry.
 */

import { listMealBuffHandlers } from "./MealBuffHandlerRegistry.js";
import { PROFESSION_TOOL_REQUIRED } from "./RecipeCatalog.js";

/** Crafting professions that may attach output buffs. */
export const MEAL_BUFF_PROFESSION_IDS = new Set(Object.keys(PROFESSION_TOOL_REQUIRED));

/** Default profession when an overlay does not encode one in preset ids. */
const OVERLAY_DEFAULT_PROFESSION = {
    "respite-cooking-overlay": "cooking"
};

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

/** Display order for buff-type groups in the homebrew picker. */
export const MEAL_BUFF_CATEGORY_ORDER = [
    "temp_hp",
    "exhaustion_save",
    "advantage",
    "resistance",
    "heal",
    "hit_die",
    "combo",
    "none"
];

const MEAL_BUFF_CATEGORY_LABELS = {
    temp_hp: "Temp HP",
    exhaustion_save: "Exhaustion save",
    advantage: "Advantage",
    resistance: "Resistance",
    heal: "Healing",
    hit_die: "Hit die",
    combo: "Combined buffs",
    none: "No buff"
};

/**
 * @typedef {Object} MealBuffPreset
 * @property {string} id
 * @property {string} label
 * @property {string} description
 * @property {boolean} wellFed
 * @property {Object|Object[]|null} [buff]
 * @property {boolean} [partyMeal]
 * @property {string[]} [satiates]
 * @property {string} [foodTag]
 * @property {number|null} [spoilsAfter]
 * @property {string} [linkedRecipeId]
 * @property {string} [tier]
 * @property {string} [_overlayId]
 * @property {string} [_packLabel]
 * @property {"base"|"overlay"} [_source]
 */

/** @type {MealBuffPreset[]} */
const BASE_MEAL_BUFF_PRESETS = [
    {
        id: "none",
        label: "No buff",
        description: "Satiates only. No Well Fed slot interaction.",
        wellFed: false,
        buff: null,
        _source: "base"
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
        },
        _source: "base"
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
        },
        _source: "base"
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
        },
        _source: "base"
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
        },
        _source: "base"
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
        },
        _source: "base"
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
        },
        _source: "base"
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
        },
        _source: "base"
    }
];

/** @type {Map<string, MealBuffPreset>} */
const overlayPresetsById = new Map();

/** @type {Map<string, Set<string>>} */
const overlayPresetIdsByOverlay = new Map();

/** Base presets only (backward compatible export). */
export const MEAL_BUFF_PRESETS = BASE_MEAL_BUFF_PRESETS;

/**
 * @returns {MealBuffPreset[]}
 */
export function getBaseMealBuffPresets() {
    return BASE_MEAL_BUFF_PRESETS;
}

/**
 * @returns {MealBuffPreset[]}
 */
export function getOverlayMealBuffPresets() {
    return [...overlayPresetsById.values()];
}

/**
 * Compare Well Fed + buff payload only (ignore satiates, food tag, etc.).
 * @param {MealBuffPreset|null|undefined} a
 * @param {MealBuffPreset|null|undefined} b
 * @returns {boolean}
 */
export function mealBuffEffectEqual(a, b) {
    if (!a || !b) return false;
    return a.wellFed === b.wellFed && mealBuffsEqual(a.buff ?? null, b.buff ?? null);
}

/**
 * True when a pack preset repeats a generic base homebrew buff.
 * @param {MealBuffPreset} preset
 * @returns {boolean}
 */
export function isDuplicateOfBaseMealBuffPreset(preset) {
    if (preset?._source !== "overlay") return false;
    return BASE_MEAL_BUFF_PRESETS.some(base =>
        base.id !== "none" && mealBuffEffectEqual(base, preset)
    );
}

/**
 * Pack presets whose buff effect is not already offered in base presets.
 * @returns {MealBuffPreset[]}
 */
export function getUniqueOverlayMealBuffPresets() {
    return getOverlayMealBuffPresets().filter(preset => !isDuplicateOfBaseMealBuffPreset(preset));
}

/**
 * Infer the crafting profession a preset belongs to.
 * @param {MealBuffPreset|null|undefined} preset
 * @returns {string|null}
 */
export function inferMealBuffPresetProfession(preset) {
    if (typeof preset?.professionId === "string" && preset.professionId) {
        return preset.professionId;
    }

    const handlerId = preset?._handlerId ?? "";
    const handlerPrefix = handlerId.split(":")[0];
    if (MEAL_BUFF_PROFESSION_IDS.has(handlerPrefix)) return handlerPrefix;

    const idPrefix = String(preset?.id ?? "").split(/[.:]/)[0];
    if (MEAL_BUFF_PROFESSION_IDS.has(idPrefix)) return idPrefix;

    const overlayDefault = OVERLAY_DEFAULT_PROFESSION[preset?._overlayId ?? ""];
    if (overlayDefault) return overlayDefault;

    return null;
}

/**
 * @param {MealBuffPreset|null|undefined} preset
 * @param {string} professionId
 * @returns {boolean}
 */
export function mealBuffPresetAppliesToProfession(preset, professionId) {
    const inferred = inferMealBuffPresetProfession(preset);
    if (inferred == null) {
        return professionId === "cooking" || professionId === "brewing";
    }
    return inferred === professionId;
}

/**
 * @param {MealBuffPreset|null|undefined} preset
 * @param {"standard"|"ambitious"} tier
 * @returns {boolean}
 */
export function mealBuffPresetAppliesToTier(preset, tier) {
    const presetTier = preset?.tier;
    if (!presetTier) return true;
    if (tier === "ambitious") return presetTier !== "standard";
    return presetTier !== "ambitious";
}

/**
 * True when a handler preset repeats a generic base homebrew buff.
 * @param {MealBuffPreset} preset
 * @returns {boolean}
 */
export function isDuplicateHandlerMealBuffPreset(preset) {
    if (preset?._source !== "handler") return false;
    return BASE_MEAL_BUFF_PRESETS.some(base =>
        base.id !== "none" && mealBuffEffectEqual(base, preset)
    );
}

/**
 * Buff presets available for a profession and output tier in the homebrew editor.
 * @param {string} professionId
 * @param {{ tier?: "standard"|"ambitious" }} [options]
 * @returns {{ base: MealBuffPreset[], handlers: MealBuffPreset[], overlay: MealBuffPreset[] }}
 */
export function getMealBuffPresetsForProfession(professionId, { tier = "standard" } = {}) {
    const matches = preset =>
        mealBuffPresetAppliesToProfession(preset, professionId)
        && mealBuffPresetAppliesToTier(preset, tier);

    const base = BASE_MEAL_BUFF_PRESETS.filter(matches);
    const handlers = getHandlerAuthoredMealBuffPresets()
        .filter(preset => matches(preset) && !isDuplicateHandlerMealBuffPreset(preset));
    const overlay = getOverlayMealBuffPresets()
        .filter(preset => matches(preset) && !isDuplicateOfBaseMealBuffPreset(preset));

    return { base, handlers, overlay };
}

/**
 * Presets derived from registered meal buff handler plugins.
 * @returns {MealBuffPreset[]}
 */
export function getHandlerAuthoredMealBuffPresets() {
    return listMealBuffHandlers()
        .filter(handler => handler.authoringPreset)
        .map(handler => {
            const preset = handler.authoringPreset;
            const entry = {
                id: preset.id ?? `handler:${handler.id}`,
                label: preset.label ?? handler.label,
                description: preset.description ?? "",
                wellFed: preset.wellFed ?? true,
                buff: preset.buff,
                partyMeal: preset.partyMeal,
                satiates: preset.satiates,
                foodTag: preset.foodTag,
                spoilsAfter: preset.spoilsAfter,
                professionId: preset.professionId,
                tier: preset.tier,
                _source: "handler",
                _handlerId: handler.id,
                _overlayId: handler._overlayId,
                _packLabel: handler._overlayId
            };
            if (!entry.professionId) {
                entry.professionId = inferMealBuffPresetProfession(entry);
            }
            return entry;
        });
}

/**
 * @returns {MealBuffPreset[]}
 */
export function getAllMealBuffPresets() {
    return [
        ...BASE_MEAL_BUFF_PRESETS,
        ...getHandlerAuthoredMealBuffPresets(),
        ...overlayPresetsById.values()
    ];
}

/**
 * @param {MealBuffPreset} preset
 * @param {{ overlayId: string, packLabel?: string }} meta
 */
export function registerOverlayMealBuffPreset(preset, meta) {
    if (!preset?.id) return;

    const existing = overlayPresetsById.get(preset.id);
    if (existing && existing._overlayId !== meta.overlayId) return;

    const entry = foundry.utils.deepClone(preset);
    entry._overlayId = meta.overlayId;
    entry._packLabel = meta.packLabel ?? meta.overlayId;
    entry._source = "overlay";
    if (!entry.professionId) {
        entry.professionId = inferMealBuffPresetProfession(entry);
    }

    overlayPresetsById.set(entry.id, entry);
    if (!overlayPresetIdsByOverlay.has(meta.overlayId)) {
        overlayPresetIdsByOverlay.set(meta.overlayId, new Set());
    }
    overlayPresetIdsByOverlay.get(meta.overlayId).add(entry.id);
}

/**
 * @param {string} overlayId
 */
export function unregisterOverlayMealBuffPresetsForOverlay(overlayId) {
    const ids = overlayPresetIdsByOverlay.get(overlayId);
    if (!ids) return;
    for (const id of ids) overlayPresetsById.delete(id);
    overlayPresetIdsByOverlay.delete(overlayId);
}

/**
 * @param {string} overlayId
 * @returns {number}
 */
export function unregisterOverlayMealBuffPresetsForOverlayAndCount(overlayId) {
    const count = overlayPresetIdsByOverlay.get(overlayId)?.size ?? 0;
    unregisterOverlayMealBuffPresetsForOverlay(overlayId);
    return count;
}

/**
 * @param {Object} buff
 * @param {{ partyMeal?: boolean }} [ctx]
 * @returns {string}
 */
export function formatSingleBuffSummary(buff, ctx = {}) {
    if (!buff?.type) return "";
    const parts = [MEAL_BUFF_TYPE_LABELS[buff.type] ?? buff.type];

    if (buff.type === "temp_hp" || buff.type === "heal" || buff.type === "hit_die") {
        if (buff.formula) parts.push(buff.formula);
    }
    if (buff.type === "exhaustion_save" && buff.formula) {
        parts.push(`DC ${buff.formula}`);
    }
    if (buff.type === "advantage") {
        parts.push(String(buff.save?.ability ?? buff.formula ?? "con").toUpperCase());
    }
    if (buff.type === "resistance") {
        parts.push(buff.damageType ?? buff.formula ?? "damage");
    }

    const target = buff.target === "party" || ctx.partyMeal ? "party" : "self";
    if (target === "party") parts.push("party");

    const duration = MEAL_BUFF_DURATION_LABELS[buff.duration] ?? buff.duration;
    if (duration) parts.push(duration);

    return parts.join(" · ");
}

/**
 * Primary picker label: buff type and parameters, not meal name.
 * @param {MealBuffPreset|null|undefined} preset
 * @returns {string}
 */
export function formatMealBuffPresetTitle(preset) {
    if (!preset || preset.id === "none") return "No buff";
    if (!preset.buff) return preset.wellFed ? "Well Fed only" : "No buff";

    const buffs = Array.isArray(preset.buff) ? preset.buff : [preset.buff];
    if (buffs.length > 1) {
        return buffs.map(buff => formatSingleBuffSummary(buff, { partyMeal: preset.partyMeal }))
            .filter(Boolean)
            .join(" + ");
    }
    const primary = buffs[0];
    const summary = formatSingleBuffSummary(primary, { partyMeal: preset.partyMeal });
    if (primary?.type && !MEAL_BUFF_TYPE_LABELS[primary.type] && preset.label) {
        return preset.label;
    }
    return summary;
}

/**
 * Secondary line: pack reference meal or preset description for base rows.
 * @param {MealBuffPreset|null|undefined} preset
 * @returns {string}
 */
export function formatMealBuffPresetSubtitle(preset) {
    if (!preset) return "";
    if (preset._source === "handler") {
        return preset.description ?? "";
    }
    if (preset._source === "overlay" && preset.label) {
        const tier = preset.tier === "ambitious" ? " · ambitious craft" : "";
        return `Pack reference: ${preset.label}${tier}`;
    }
    return preset.description ?? "";
}

/**
 * @param {MealBuffPreset} preset
 * @returns {string}
 */
export function getMealBuffPresetCategoryKey(preset) {
    if (!preset?.buff) return "none";
    const buffs = Array.isArray(preset.buff) ? preset.buff : [preset.buff];
    if (buffs.length > 1) return "combo";
    return buffs[0]?.type ?? "none";
}

/**
 * @param {MealBuffPreset[]} presets
 * @returns {{ key: string, label: string, presets: MealBuffPreset[] }[]}
 */
export function groupMealBuffPresetsByCategory(presets) {
    const buckets = new Map();
    for (const preset of presets) {
        const key = getMealBuffPresetCategoryKey(preset);
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(preset);
    }

    const groups = [];
    for (const key of MEAL_BUFF_CATEGORY_ORDER) {
        const items = buckets.get(key);
        if (!items?.length) continue;
        items.sort((a, b) => formatMealBuffPresetTitle(a).localeCompare(formatMealBuffPresetTitle(b)));
        groups.push({
            key,
            label: MEAL_BUFF_CATEGORY_LABELS[key] ?? key,
            presets: items
        });
        buckets.delete(key);
    }
    for (const [key, items] of buckets) {
        items.sort((a, b) => formatMealBuffPresetTitle(a).localeCompare(formatMealBuffPresetTitle(b)));
        groups.push({
            key,
            label: MEAL_BUFF_CATEGORY_LABELS[key] ?? key,
            presets: items
        });
    }
    return groups;
}

/**
 * @param {Object|null|undefined} buff
 * @returns {Object|null}
 */
export function formatMealBuffPreview(buff) {
    if (!buff) return null;
    const primary = Array.isArray(buff) ? buff[0] : buff;
    if (!primary?.type) return null;

    const label = MEAL_BUFF_TYPE_LABELS[primary.type] ?? primary.type;
    const duration = MEAL_BUFF_DURATION_LABELS[primary.duration] ?? primary.duration ?? "";
    let detail = primary.formula ?? "";
    if (primary.type === "advantage") {
        const ab = primary.save?.ability ?? primary.formula ?? "con";
        detail = String(ab).toUpperCase();
    }
    if (primary.type === "resistance") {
        detail = primary.damageType ?? primary.formula ?? "";
    }
    if (Array.isArray(buff) && buff.length > 1) {
        detail = detail ? `${detail} +${buff.length - 1}` : `+${buff.length - 1} more`;
    }
    return {
        label,
        formula: detail,
        duration,
        target: primary.target ?? "self"
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
 * @param {MealBuffPreset} preset
 * @returns {Object}
 */
function presetMealSnapshot(preset) {
    const snap = {
        wellFed: preset.wellFed === true,
        buff: preset.buff ?? null
    };
    if (preset.partyMeal === true) snap.partyMeal = true;
    if (Array.isArray(preset.satiates) && preset.satiates.length) {
        snap.satiates = [...preset.satiates].sort();
    }
    if (preset.foodTag) snap.foodTag = preset.foodTag;
    if (preset.spoilsAfter != null) snap.spoilsAfter = preset.spoilsAfter;
    return snap;
}

/**
 * @param {Object|null|undefined} rf
 * @returns {Object}
 */
function flagsMealSnapshot(rf) {
    const snap = {
        wellFed: rf?.wellFed === true,
        buff: rf?.buff ?? null
    };
    if (rf?.partyMeal === true) snap.partyMeal = true;
    if (Array.isArray(rf?.satiates) && rf.satiates.length) {
        snap.satiates = [...rf.satiates].sort();
    }
    if (rf?.foodTag) snap.foodTag = rf.foodTag;
    if (rf?.spoilsAfter != null) snap.spoilsAfter = rf.spoilsAfter;
    return snap;
}

/**
 * @param {MealBuffPreset} preset
 * @param {Object|null|undefined} rf
 * @returns {boolean}
 */
export function mealBuffPresetMatchesFlags(preset, rf) {
    try {
        return JSON.stringify(presetMealSnapshot(preset)) === JSON.stringify(flagsMealSnapshot(rf));
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
    if (!rf.wellFed && (rf.buff == null || rf.buff === undefined)) return "none";

    for (const preset of getAllMealBuffPresets()) {
        if (mealBuffPresetMatchesFlags(preset, rf)) return preset.id;
    }
    if (!rf.wellFed && rf.buff == null) return "none";
    return "custom";
}

/**
 * @param {string} presetId
 * @returns {MealBuffPreset|undefined}
 */
export function getMealBuffPreset(presetId) {
    return BASE_MEAL_BUFF_PRESETS.find(p => p.id === presetId)
        ?? overlayPresetsById.get(presetId)
        ?? getHandlerAuthoredMealBuffPresets().find(p => p.id === presetId);
}

/**
 * @param {string} presetId
 * @returns {{ packLabel: string, overlayId: string }|null}
 */
export function getMealBuffPresetAttribution(presetId) {
    const preset = getMealBuffPreset(presetId);
    if (!preset?._packLabel || !preset._overlayId) return null;
    return {
        packLabel: preset._packLabel,
        overlayId: preset._overlayId
    };
}

/**
 * Apply a preset onto ionrift-respite flags (meal effect fields).
 * @param {Object} rf - Existing flags object to mutate
 * @param {string} presetId
 */
export function applyMealBuffPresetToFlags(rf, presetId) {
    const preset = getMealBuffPreset(presetId);
    if (!preset) return;

    rf.wellFed = preset.wellFed;
    if (preset.buff != null) rf.buff = foundry.utils.deepClone(preset.buff);
    else delete rf.buff;

    if (preset.partyMeal === true) rf.partyMeal = true;
    else delete rf.partyMeal;

    if (Array.isArray(preset.satiates)) rf.satiates = [...preset.satiates];
    else delete rf.satiates;

    if (preset.foodTag) rf.foodTag = preset.foodTag;
    else delete rf.foodTag;

    if (preset.spoilsAfter != null) rf.spoilsAfter = preset.spoilsAfter;
    else delete rf.spoilsAfter;
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

/** @private test helper */
export function _resetOverlayMealBuffPresetsForTests() {
    overlayPresetsById.clear();
    overlayPresetIdsByOverlay.clear();
}
