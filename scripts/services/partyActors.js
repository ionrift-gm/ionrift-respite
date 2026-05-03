/**
 * Party roster delegation shim.
 * Routes all roster queries through the ionrift-library kernel service
 * (`game.ionrift.library.party`). Falls back to the legacy Respite setting
 * if the library is unavailable (defensive, should not happen in production
 * since Respite requires Library ≥ 2.0.0).
 *
 * @returns {Actor[]}
 */
export function getPartyActors() {
    // Delegate to library kernel (authoritative source).
    const libParty = game.ionrift?.library?.party;
    if (libParty) return libParty.getMembers();

    // Fallback: read legacy Respite setting directly.
    try {
        const roster = game.settings.get("ionrift-respite", "partyRoster");
        if (roster?.length) {
            return roster.map(id => game.actors.get(id)).filter(Boolean);
        }
    } catch { /* setting not registered yet */ }
    return game.actors.filter(a => a.hasPlayerOwner && a.type === "character");
}
