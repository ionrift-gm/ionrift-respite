
/**
 * Discrete fletching yield tiers. Index 0 is Off; indices 1-5 use two dice plus prof.
 * @type {Array<{label: string, sides: number, formula: string}|null>}
 */
import { MODULE_ID } from "../../../data/moduleId.js";
export const FLETCHING_YIELD_TIERS = [
    null,
    { label: "2d4 + prof", sides: 4, formula: "2d4+prof" },
    { label: "2d6 + prof", sides: 6, formula: "2d6+prof" },
    { label: "2d8 + prof", sides: 8, formula: "2d8+prof" },
    { label: "2d10 + prof", sides: 10, formula: "2d10+prof" },
    { label: "2d20 + prof", sides: 20, formula: "2d20+prof" }
];

export const FLETCHING_YIELD_TIER_MAX = FLETCHING_YIELD_TIERS.length - 1;

/**
 * Soft floor after the dice roll so bare 2dX lows (e.g. 1+1) are not punishing.
 * Scales with die size and proficiency without overriding strong rolls.
 *
 * @param {number} tier
 * @param {number} prof
 * @returns {number}
 */
export function getFletchingYieldFloor(tier, prof = 2) {
    const def = FLETCHING_YIELD_TIERS[tier];
    if (!def) return 1;
    const p = Math.max(2, Math.round(prof));
    const dieFloor = Math.ceil(def.sides / 2);
    return Math.max(3, p + dieFloor + (tier === 1 ? 1 : 0));
}

/**
 * @param {number} rolled
 * @param {number} tier
 * @param {number} prof
 * @returns {number}
 */
export function applyFletchingYieldFloor(rolled, tier, prof = 2) {
    const total = Math.round(rolled);
    if (!Number.isFinite(total)) return getFletchingYieldFloor(tier, prof);
    return Math.max(total, getFletchingYieldFloor(tier, prof));
}

/**
 * @returns {number} Current tier (0 = off, 1-5 = yield rate).
 */
export function getFletchingTier() {
    try {
        let tier = game.settings.get(MODULE_ID, "fletchingYieldTier");
        if (typeof tier !== "number" || Number.isNaN(tier)) {
            tier = game.settings.get(MODULE_ID, "enableFletching") ? 1 : 0;
        }
        return Math.max(0, Math.min(FLETCHING_YIELD_TIER_MAX, Math.round(tier)));
    } catch {
        return 1;
    }
}

/**
 * @returns {boolean}
 */
export function isFletchingEnabled() {
    return getFletchingTier() > 0;
}

/**
 * @param {number} tier
 * @returns {string}
 */
export function getFletchingTierLabel(tier = getFletchingTier()) {
    const clamped = Math.max(0, Math.min(FLETCHING_YIELD_TIER_MAX, Math.round(tier)));
    if (clamped === 0) return "Off";
    return FLETCHING_YIELD_TIERS[clamped]?.label ?? "Off";
}

/**
 * Dice formula for a tier, or null when fletching is off.
 * @param {number} [tier]
 * @returns {string|null}
 */
export function getFletchingYieldFormula(tier = getFletchingTier()) {
    const clamped = Math.max(0, Math.min(FLETCHING_YIELD_TIER_MAX, Math.round(tier)));
    if (clamped <= 0) return null;
    return FLETCHING_YIELD_TIERS[clamped]?.formula ?? null;
}

/**
 * End-user-readable yield hint for activity cards (includes soft floor at prof 2).
 * @param {number} [tier]
 * @param {number} [prof]
 * @returns {string}
 */
export function getFletchingYieldHint(tier = getFletchingTier(), prof = 2) {
    const formula = getFletchingYieldFormula(tier);
    if (!formula) return "Fletching is off for this world";
    const floor = getFletchingYieldFloor(tier, prof);
    return `${formula} on success (at least ${floor} at +${prof} prof)`;
}

/**
 * One-time migration from legacy enableFletching boolean to fletchingYieldTier.
 */
export function migrateFletchingYieldTier() {
    if (!game.user?.isGM) return;
    try {
        if (game.settings.get(MODULE_ID, "fletchingYieldTierMigrated")) return;
        const legacy = game.settings.get(MODULE_ID, "enableFletching");
        game.settings.set(MODULE_ID, "fletchingYieldTier", legacy ? 1 : 0);
        game.settings.set(MODULE_ID, "fletchingYieldTierMigrated", true);
    } catch (e) {
        console.warn(`${MODULE_ID} | Fletching yield tier migration skipped:`, e);
    }
}
