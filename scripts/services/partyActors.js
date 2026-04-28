const MODULE_ID = "ionrift-respite";

/**
 * GM-approved party actors from world setting.
 * Same logic as the former inline helper in module.js.
 * @returns {Actor[]}
 */
export function getPartyActors() {
    const roster = game.settings.get(MODULE_ID, "partyRoster");
    if (!roster?.length) {
        return game.actors.filter(a => a.hasPlayerOwner && a.type === "character");
    }
    return roster.map(id => game.actors.get(id)).filter(Boolean);
}
