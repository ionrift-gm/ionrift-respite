import { isComfortEnabled } from "./ComfortCalculator.js";

/**
 * PF2e comfort mechanics: level-scaled Fortitude save DCs, overnight HP
 * recovery multipliers, degree-of-success save evaluation, and Fatigued /
 * Drained / Well-Rested resolution.
 */

/** Official PF2e Level-Based DCs (Player Core / GM Core Table 10-5). */
export const PF2E_DC_BY_LEVEL = Object.freeze([
    14, // 0
    15, // 1
    16, // 2
    18, // 3
    19, // 4
    20, // 5
    22, // 6
    23, // 7
    24, // 8
    26, // 9
    27, // 10
    28, // 11
    30, // 12
    31, // 13
    32, // 14
    34, // 15
    35, // 16
    36, // 17
    38, // 18
    39, // 19
    40  // 20
]);

/** Overnight HP multiplier by effective comfort tier (Safe matches Long-Term Rest). */
export const PF2E_COMFORT_HP_MULTIPLIER = Object.freeze({
    hostile: 0.5,
    rough: 1,
    sheltered: 1,
    safe: 2
});

/** Circumstance bonus to the dawn Fortitude save from a Mess Kit or Cook's Utensils. */
export const PF2E_MESS_KIT_SAVE_BONUS = 2;

/**
 * True when the active rest system or adapter is Pathfinder 2e.
 * @param {object|null} [adapter]
 * @returns {boolean}
 */
export function isPf2eSystem(adapter = null) {
    const id = adapter?.id
        ?? globalThis.game?.ionrift?.respite?.adapter?.id
        ?? globalThis.game?.system?.id
        ?? "";
    return id === "pf2e";
}

/**
 * Standard PF2e level-based DC for a given character or party level.
 * @param {number} level
 * @returns {number}
 */
export function getPf2eLevelBasedDC(level) {
    const n = Math.floor(Number(level) || 0);
    if (n <= 0) return PF2E_DC_BY_LEVEL[0];
    if (n <= 20) return PF2E_DC_BY_LEVEL[n];
    return PF2E_DC_BY_LEVEL[20] + ((n - 20) * 2);
}

/**
 * Dawn Fortitude save DC for PF2e comfort tiers.
 * Rough uses Easy (-2); Hostile uses Standard (+0).
 * @param {string} tier
 * @param {number} [level=1]
 * @returns {number|null}
 */
export function getPf2eFortitudeSaveDC(tier, level = 1) {
    if (!isComfortEnabled()) return null;
    const base = getPf2eLevelBasedDC(Math.max(1, Number(level) || 1));
    if (tier === "rough") return base - 2;
    if (tier === "hostile") return base;
    return null;
}

/**
 * Computes PF2e overnight HP restoration:
 * floor(max(conMod, 1) * level * multiplier) + sheetAddend + bedrollBonusHp.
 * @param {object} params
 * @returns {{ hpRestored: number, multiplier: number, bedrollBonusHp: number }}
 */
export function calculatePf2eOvernightHp({
    level = 1,
    conMod = 0,
    comfortTier = "sheltered",
    restedFully = false,
    hasBedroll = false,
    comfortEnabled = true,
    sheetMultiplier = 1,
    sheetAddend = 0
} = {}) {
    const safeLevel = Math.max(1, Math.floor(Number(level) || 1));
    const conFactor = Math.max(1, Math.floor(Number(conMod) || 0));
    const baseSheetMult = Math.max(1, Number(sheetMultiplier) || 1);
    const baseSheetAddend = Math.floor(Number(sheetAddend) || 0);

    if (!comfortEnabled) {
        const hpRestored = Math.max(1, Math.floor(conFactor * safeLevel * baseSheetMult) + baseSheetAddend);
        return { hpRestored, multiplier: baseSheetMult, bedrollBonusHp: 0 };
    }

    let tierMult = PF2E_COMFORT_HP_MULTIPLIER[comfortTier] ?? 1;
    if (restedFully) {
        tierMult = tierMult < 1 ? 1 : 2;
    }

    const scaledSheetMult = (comfortTier === "hostile" && !restedFully)
        ? baseSheetMult * 0.5
        : baseSheetMult;
    const effectiveMult = Math.max(tierMult, scaledSheetMult);
    const bedrollBonusHp = hasBedroll ? safeLevel : 0;
    const hpRestored = Math.max(1, Math.floor(conFactor * safeLevel * effectiveMult) + baseSheetAddend + bedrollBonusHp);

    return {
        hpRestored,
        multiplier: effectiveMult,
        bedrollBonusHp
    };
}

/**
 * Evaluates a PF2e saving throw degree of success with natural 1 / 20 steps.
 * @param {number|null} d20Value
 * @param {number} total
 * @param {number} dc
 * @returns {"critFailure"|"failure"|"success"|"critSuccess"}
 */
export function evaluatePf2eSaveDegree(d20Value, total, dc) {
    let degree;
    if (total >= dc + 10) degree = 3;
    else if (total >= dc) degree = 2;
    else if (total <= dc - 10) degree = 0;
    else degree = 1;

    if (d20Value === 20) degree = Math.min(3, degree + 1);
    else if (d20Value === 1) degree = Math.max(0, degree - 1);

    return ["critFailure", "failure", "success", "critSuccess"][degree];
}

/**
 * Resolves post-rest Fatigued, Drained (0..4), and Well-Rested eligibility for PF2e.
 * @param {object} params
 * @returns {object}
 */
export function resolvePf2eRestConditions({
    comfortLevel = "sheltered",
    restedFully = false,
    armorSleepPenalty = false,
    noFoodOrWater = false,
    saveResult = null,
    saveDegree = null,
    wasFatigued = false,
    initialDrained = 0,
    exhaustionGain = 0
} = {}) {
    const startFatigued = Boolean(wasFatigued);
    const startDrained = Math.max(0, Math.min(4, Math.floor(Number(initialDrained) || 0)));
    const blockedByHostileOrHunger = comfortLevel === "hostile" || Boolean(noFoodOrWater);

    const isCritFail = saveDegree === "critFailure";
    const isFail = isCritFail || saveResult === "failed" || saveDegree === "failure";

    let clearsFatigued = !blockedByHostileOrHunger && !armorSleepPenalty;
    let drainedReduction = 0;
    if (!blockedByHostileOrHunger && !isCritFail) {
        drainedReduction = (restedFully && !armorSleepPenalty) ? 2 : 1;
    }

    let nextFatigued = clearsFatigued ? false : startFatigued;
    if (armorSleepPenalty) {
        nextFatigued = true;
    }

    let drainedGain = 0;
    if (isCritFail) {
        nextFatigued = true;
        drainedGain += 1;
    } else if (isFail) {
        if (comfortLevel === "hostile" && startFatigued) {
            nextFatigued = true;
            drainedGain += 1;
        } else {
            nextFatigued = true;
        }
    }

    const extraGain = Math.max(0, Math.floor(Number(exhaustionGain) || 0));
    for (let i = 0; i < extraGain; i++) {
        if (!nextFatigued) nextFatigued = true;
        else drainedGain += 1;
    }

    const afterReduction = Math.max(0, startDrained - drainedReduction);
    const targetDrained = Math.max(0, Math.min(4, afterReduction + drainedGain));
    const fatiguedDelta = (nextFatigued ? 1 : 0) - (startFatigued ? 1 : 0);
    const drainedDelta = targetDrained - startDrained;
    const shouldGrantWellRested = Boolean(
        restedFully
        && !armorSleepPenalty
        && !noFoodOrWater
        && !nextFatigued
        && (comfortLevel === "sheltered" || comfortLevel === "safe")
    );

    return {
        targetFatigued: nextFatigued,
        targetDrained,
        fatiguedDelta,
        drainedDelta,
        drainedReduced: Math.max(0, startDrained - targetDrained),
        drainedGained: Math.max(0, targetDrained - startDrained),
        shouldGrantWellRested
    };
}

/**
 * Formats the compact PF2e comfort benefit string for badges and dock cards.
 * @param {object} params
 * @returns {string}
 */
export function formatPf2eBenefitSummary({
    personalComfort = "sheltered",
    multiplier = null,
    exhaustionDC = null,
    includeSave = true
} = {}) {
    const mult = multiplier ?? (PF2E_COMFORT_HP_MULTIPLIER[personalComfort] ?? 1);
    const hpPart = `${mult}x HP`;
    let condPart;
    if (personalComfort === "hostile") condPart = "Drained Held";
    else if (personalComfort === "safe") condPart = "Clear Conditions";
    else condPart = "−1 Drained";

    if (!includeSave || !exhaustionDC) {
        return `${hpPart} · ${condPart}`;
    }
    return `${hpPart} · ${condPart} · Fort DC ${exhaustionDC}`;
}
