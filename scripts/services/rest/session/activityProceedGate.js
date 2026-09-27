/**
 * Whether the GM footer may leave the activity phase.
 *
 * The ready count is what the GM is looking at. A Next card on the
 * character currently open must not keep Proceed locked once every
 * party member is already marked ready. A rolled-back character
 * leaves that count short, and Proceed stays locked until they
 * are ready again, even if every activity was already assigned.
 *
 * @param {object} [params]
 * @param {boolean} [params.allResolved]
 * @param {boolean} [params.cardHoldsProceed]
 * @param {string[]} [params.partyIds]
 * @param {Iterable<string>} [params.finishedIds]
 * @returns {boolean}
 */
export function canGmProceedFromActivity({
    allResolved = false,
    cardHoldsProceed = false,
    partyIds = [],
    finishedIds = []
} = {}) {
    if (partyFullyReady(partyIds, finishedIds)) return true;
    const ids = [...(partyIds ?? [])].filter(Boolean);
    if (ids.length > 0) return false;
    return !!allResolved && !cardHoldsProceed;
}

/**
 * Every party member is in the ready set. Extra ids that are not in
 * the party do not count.
 * @param {string[]} partyIds
 * @param {Iterable<string>} finishedIds
 * @returns {boolean}
 */
export function partyFullyReady(partyIds, finishedIds) {
    const finished = finishedIds instanceof Set ? finishedIds : new Set(finishedIds ?? []);
    const ids = [...(partyIds ?? [])].filter(Boolean);
    return ids.length > 0 && ids.every((id) => finished.has(id));
}
