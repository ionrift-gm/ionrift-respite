const CRAFT_PROFESSION = {
    cook: "cooking",
    brew: "brewing",
    craft: "crafting"
};

/**
 * Professions for cook, brew, or craft days that have not been resolved.
 * @param {Array<{activityId?: string, rolled?: boolean}>} rolls
 * @returns {string[]}
 */
export function unresolvedCraftProfessions(rolls) {
    const professions = new Set();
    for (const roll of rolls ?? []) {
        const profession = CRAFT_PROFESSION[roll?.activityId];
        if (profession && !roll.rolled) professions.add(profession);
    }
    return [...professions];
}

/**
 * True when a locked plan still has a cook, brew, or craft day and that
 * profession has no recipe the character can make.
 * @param {Array<{activityId?: string, rolled?: boolean}>} rolls
 * @param {Record<string, number>} availableCounts profession id to recipe count
 * @returns {boolean}
 */
export function craftPlanNeedsEscape(rolls, availableCounts) {
    const pending = unresolvedCraftProfessions(rolls);
    if (!pending.length) return false;
    return pending.some(profession => (availableCounts?.[profession] ?? 0) === 0);
}

/**
 * True when reducing an activity to `nextCount` would drop a day that already rolled.
 * @param {Array<{activityId?: string, rolled?: boolean}>} rolls
 * @param {string} activityId
 * @param {number} nextCount
 * @returns {boolean}
 */
export function keepsRolledActivityDays(rolls, activityId, nextCount) {
    const rolledCount = (rolls ?? []).filter(roll => roll?.activityId === activityId && roll.rolled).length;
    return nextCount >= rolledCount;
}

/**
 * Move resolved checks onto the new week when a plan changes.
 * Results stay with their activity, in the order they were rolled.
 * Unresolved days stay unresolved.
 * @param {object[]} previousRolls
 * @param {Array<{filled?: boolean, activityId?: string|null}>} segments
 * @returns {object[]}
 */
export function rebindActivityRolls(previousRolls, segments) {
    const buckets = new Map();
    for (const prev of previousRolls ?? []) {
        if (!prev?.rolled || !prev.activityId) continue;
        const queue = buckets.get(prev.activityId) ?? [];
        queue.push(prev);
        buckets.set(prev.activityId, queue);
    }

    const count = Math.max(segments?.length ?? 0, previousRolls?.length ?? 0, 7);
    const next = [];
    for (let i = 0; i < count; i++) {
        const seg = segments?.[i];
        const activityId = seg?.filled ? (seg.activityId ?? null) : null;
        const blank = {
            day: i + 1,
            activityId,
            rolled: false,
            rollTotal: null,
            dc: null,
            success: null,
            skillUsed: null
        };
        if (!activityId) {
            next.push(blank);
            continue;
        }
        const kept = buckets.get(activityId)?.shift();
        if (!kept) {
            next.push(blank);
            continue;
        }
        const rebound = {
            ...blank,
            rolled: true,
            rollTotal: kept.rollTotal ?? null,
            dc: kept.dc ?? null,
            success: kept.success ?? null,
            skillUsed: kept.skillUsed ?? null
        };
        if (kept.yieldQty != null) rebound.yieldQty = kept.yieldQty;
        next.push(rebound);
    }
    return next;
}
