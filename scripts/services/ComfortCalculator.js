/**
 * ComfortCalculator
 *
 * Single source of truth for comfort-tier arithmetic used by RestFlowEngine,
 * CampGearScanner, RestSetupApp, and RestConstants. Consolidates the
 * previously duplicated tier arrays, HD penalties, HP caps, exhaustion DCs,
 * and tier-stepping logic into one testable service.
 *
 * Design notes:
 *   - The canonical tier list uses four tiers: hostile → rough → sheltered → safe.
 *   - CampGearScanner's five-tier list (which includes "comfortable") is an
 *     aliased display concern — "comfortable" maps to "sheltered" mechanically.
 *   - Tier-stepping clamps to array bounds (hostile floor, safe ceiling).
 */

// ── Canonical Data ──────────────────────────────────────────────────────────

/** Comfort tiers in ascending order (worst → best). */
export const COMFORT_TIERS = Object.freeze(["hostile", "rough", "sheltered", "safe"]);

/** Numeric rank for each tier (used for comparison and clamping). */
export const COMFORT_RANK = Object.freeze({ hostile: 0, rough: 1, sheltered: 2, safe: 3 });

/** Inverse of COMFORT_RANK: rank index → tier key. */
export const RANK_TO_KEY = Object.freeze(["hostile", "rough", "sheltered", "safe"]);

/** HD penalty applied at each comfort tier. */
export const HD_PENALTY = Object.freeze({ safe: 0, sheltered: 0, rough: 1, hostile: 2 });

/** HP fraction restored at each comfort tier (1.0 = full, 0.75 = hostile cap). */
export const HP_FRACTION = Object.freeze({ safe: 1.0, sheltered: 1.0, rough: 1.0, hostile: 0.75 });

/** Exhaustion CON save DC at each tier (null = no risk). */
export const EXHAUSTION_DC = Object.freeze({ safe: null, sheltered: null, rough: 10, hostile: 15 });

// ── Tier Arithmetic ─────────────────────────────────────────────────────────

/**
 * Boost a comfort tier by `steps` levels (clamped to safe).
 * Negative steps lower the tier (clamped to hostile).
 *
 * @param {string} tier - Current comfort tier key.
 * @param {number} [steps=1] - Number of tiers to boost (positive) or lower (negative).
 * @returns {string} The resulting tier key.
 */
export function boostComfort(tier, steps = 1) {
    const idx = COMFORT_TIERS.indexOf(tier);
    if (idx < 0) return tier; // unknown tier — pass through
    const clamped = Math.max(0, Math.min(COMFORT_TIERS.length - 1, idx + steps));
    return COMFORT_TIERS[clamped];
}

/**
 * Returns the exhaustion DC for a given comfort tier, or null if none.
 * @param {string} tier
 * @returns {number|null}
 */
export function getExhaustionDC(tier) {
    return EXHAUSTION_DC[tier] ?? null;
}

/**
 * Returns the HD penalty for a given comfort tier.
 * @param {string} tier
 * @returns {number}
 */
export function getHdPenalty(tier) {
    return HD_PENALTY[tier] ?? 0;
}

/**
 * Returns the HP fraction cap for a given comfort tier.
 * @param {string} tier
 * @returns {number}
 */
export function getHpFraction(tier) {
    return HP_FRACTION[tier] ?? 1.0;
}
