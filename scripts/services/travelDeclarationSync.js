/**
 * GM-side application of player travel declarations (Player → GM socket).
 * Extracted from RestSetupApp.receiveTravelDeclaration so the ownership/
 * confirm contract can be unit-tested without the full ApplicationV2 surface.
 */

const OWNER_LEVEL = 3;

/**
 * @typedef {{ activity: string, day: number, confirmed: boolean|null }} TravelDeclarationApplication
 * @typedef {{
 *   applied: TravelDeclarationApplication[],
 *   rejected: Array<{ actorId: string, reason: string }>
 * }} TravelDeclarationApplyResult
 */

/**
 * Apply a player travel declaration payload to the GM's TravelResolutionDelegate.
 *
 * @param {object} params
 * @param {{
 *   activeDay: number,
 *   setDeclaration: (actorId: string, activity: string, day: number) => void,
 *   setConfirmed: (actorId: string, day: number, value: boolean) => void
 * }} params.travel
 * @param {(actorId: string) => ({ ownership?: Record<string, number> } | null)} params.actorLookup
 * @param {{
 *   declarations?: Record<string, string>,
 *   confirmed?: boolean,
 *   day?: number,
 *   userId?: string
 * }} params.data
 * @returns {TravelDeclarationApplyResult}
 */
export function applyPlayerTravelDeclarationToGm({ travel, actorLookup, data }) {
    const applied = [];
    const rejected = [];
    if (!data?.declarations || !travel) return { applied, rejected };
    const day = data.day ?? travel.activeDay;
    const confirmed = data.confirmed === true
        ? true
        : data.confirmed === false ? false : null;

    for (const [actorId, activity] of Object.entries(data.declarations)) {
        const actor = actorLookup(actorId);
        if (!actor) {
            rejected.push({ actorId, reason: "actor-missing" });
            continue;
        }
        const owners = Object.entries(actor.ownership ?? {})
            .filter(([id, level]) => level >= OWNER_LEVEL && id !== "default")
            .map(([id]) => id);
        if (!data.userId || !owners.includes(data.userId)) {
            rejected.push({ actorId, reason: "not-owner" });
            continue;
        }
        travel.setDeclaration(actorId, activity, day);
        if (confirmed !== null) {
            travel.setConfirmed(actorId, day, confirmed);
        }
        applied.push({ activity, day, confirmed });
    }

    return { applied, rejected };
}
