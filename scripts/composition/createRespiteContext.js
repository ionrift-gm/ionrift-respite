/**
 * Composition root stub (Phase 1).
 * Full bag wiring still lives in module.js until Phase 2 extracts it.
 */
export function createRespiteContext() {
    game.ionrift = game.ionrift || {};
    game.ionrift.respite = game.ionrift.respite || {};
    return game.ionrift.respite;
}

export function getRespiteApi() {
    return game.ionrift?.respite ?? null;
}
