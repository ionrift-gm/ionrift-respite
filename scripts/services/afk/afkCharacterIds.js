/**
 * Maps Respite character ids (actor id or "gm") to users and tokens.
 */

/** @returns {string|null} */
export function resolveUserIdForCharacter(characterId) {
    if (!characterId) return null;
    if (characterId === "gm") {
        const gm = game.users?.find(u => u.isGM && u.active) ?? game.users?.find(u => u.isGM);
        return gm?.id ?? null;
    }
    const actor = game.actors?.get(characterId);
    if (!actor) return null;
    const players = game.users?.filter(u => !u.isGM && actor.testUserPermission(u, "OWNER")) ?? [];
    if (players.length) return players[0].id;
    return game.users?.find(u => actor.isOwner && !u.isGM)?.id
        ?? game.users?.find(u => actor.isOwner)?.id
        ?? null;
}

/** @returns {foundry.documents.TokenDocument[]} */
export function getTokenDocumentsForActor(actorId) {
    if (!actorId || actorId === "gm") return [];
    const out = [];
    const scene = game.canvas?.scene;
    if (!scene?.tokens) return out;
    for (const doc of scene.tokens) {
        if (doc.actorId === actorId) out.push(doc);
    }
    return out;
}

/**
 * @param {foundry.documents.TokenDocument|object} tokenDoc
 * @returns {string|null}
 */
export function resolveCharacterIdFromTokenDoc(tokenDoc) {
    const actorId = tokenDoc?.actorId;
    if (actorId) return actorId;
    return null;
}
