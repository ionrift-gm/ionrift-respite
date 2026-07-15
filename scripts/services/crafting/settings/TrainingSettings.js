
/** Compendium page _id for the GM Training guide entry. */
import { MODULE_ID } from "../../../data/moduleId.js";
export const TRAINING_GUIDE_PAGE_ID = "mN8kTrXpGmRef001";

/**
 * Discrete training XP tiers. Index 0 is Off; indices 1-5 are reward rates per set.
 * @type {Array<{label: string, failXp: number, passXp: number}|null>}
 */
export const TRAINING_XP_TIERS = [
    null,
    { label: "3 / 10 XP per set", failXp: 3, passXp: 10 },
    { label: "5 / 20 XP per set", failXp: 5, passXp: 20 },
    { label: "7 / 30 XP per set", failXp: 7, passXp: 30 },
    { label: "8 / 40 XP per set", failXp: 8, passXp: 40 },
    { label: "10 / 50 XP per set", failXp: 10, passXp: 50 }
];

export const TRAINING_XP_TIER_MAX = TRAINING_XP_TIERS.length - 1;

/**
 * Base step for triangular diminishing returns. With the default Light tier
 * (30 XP best case), one prior training rest withholds 15 XP; two prior rests
 * withhold 45 XP (zero award). Spacing training across other camp activities
 * resets the streak and avoids the penalty.
 */
export const TRAINING_DR_STEP = 15;

/**
 * XP withheld from a training award based on prior consecutive training rests.
 * Escalates triangularly: step, 3×step, 6×step, … so spamming training pays
 * far less than alternating with other activities.
 *
 * @param {number} streak Prior consecutive training rests (flag value before this rest).
 * @returns {number}
 */
export function getTrainingXpReduction(streak) {
    const s = Math.max(0, Math.round(streak));
    if (s <= 0) return 0;
    return TRAINING_DR_STEP * (s * (s + 1)) / 2;
}

/**
 * @returns {number} Current tier (0 = off, 1-5 = reward rate).
 */
export function getTrainingTier() {
    try {
        let tier = game.settings.get(MODULE_ID, "trainingXpTier");
        if (typeof tier !== "number" || Number.isNaN(tier)) {
            tier = game.settings.get(MODULE_ID, "enableTraining") ? 1 : 0;
        }
        return Math.max(0, Math.min(TRAINING_XP_TIER_MAX, Math.round(tier)));
    } catch {
        return 0;
    }
}

/**
 * @returns {boolean}
 */
export function isTrainingEnabled() {
    return getTrainingTier() > 0;
}

/**
 * @param {number} tier
 * @returns {string}
 */
export function getTrainingTierLabel(tier = getTrainingTier()) {
    const clamped = Math.max(0, Math.min(TRAINING_XP_TIER_MAX, Math.round(tier)));
    if (clamped === 0) return "Off";
    return TRAINING_XP_TIERS[clamped]?.label ?? "Off";
}

/**
 * Per-set fail and pass XP for the active tier, or null when training is off.
 * @returns {{ failXp: number, passXp: number }|null}
 */
export function getTrainingXpValues() {
    const tier = getTrainingTier();
    if (tier <= 0) return null;
    const def = TRAINING_XP_TIERS[tier];
    if (!def) return null;
    return { failXp: def.failXp, passXp: def.passXp };
}

/**
 * One-time migration from legacy enableTraining boolean to trainingXpTier.
 */
export function migrateTrainingXpTier() {
    if (!game.user?.isGM) return;
    try {
        if (game.settings.get(MODULE_ID, "trainingXpTierMigrated")) return;
        const legacy = game.settings.get(MODULE_ID, "enableTraining");
        game.settings.set(MODULE_ID, "trainingXpTier", legacy ? 1 : 0);
        game.settings.set(MODULE_ID, "trainingXpTierMigrated", true);
    } catch (e) {
        console.warn(`${MODULE_ID} | Training XP tier migration skipped:`, e);
    }
}
