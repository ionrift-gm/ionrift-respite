import { resolveUserIdForCharacter } from "../afkCharacterIds.js";

const AFK_KEY = "afk";

/** @type {number[]} */
let _hookIds = [];

function getApi() {
    return game.playerListStatus ?? null;
}

export function isPlayerListStatusAvailable() {
    const api = getApi();
    return typeof api?.status === "function" && typeof api?.on === "function";
}

/** @returns {boolean|null} */
export function readPlayerListStatusAfk(characterId) {
    if (!isPlayerListStatusAvailable()) return null;
    const userId = resolveUserIdForCharacter(characterId);
    if (!userId) return false;
    const user = game.users?.get(userId);
    if (!user) return false;
    try {
        return !!getApi().status(AFK_KEY, user);
    } catch {
        return false;
    }
}

/**
 * @param {string} characterId
 * @param {boolean} isAfk
 */
export async function writePlayerListStatusAfk(characterId, isAfk) {
    const api = getApi();
    if (!api) return;
    const userId = resolveUserIdForCharacter(characterId);
    if (!userId) return;
    const user = game.users?.get(userId);
    if (!user) return;
    const current = !!api.status(AFK_KEY, user);
    if (current === isAfk) return;
    if (isAfk) api.on(AFK_KEY, user);
    else api.off(AFK_KEY, user);
}

/**
 * @param {(characterId: string, adapterId: string) => void} onExternalChange
 */
export function installPlayerListStatusHooks(onExternalChange) {
    removePlayerListStatusHooks();
    _hookIds.push(Hooks.on("updateUser", (user, changes) => {
        if (!changes?.flags?.playerListStatus) return;
        for (const actor of game.actors ?? []) {
            if (actor.type !== "character" || !actor.hasPlayerOwner) continue;
            const uid = resolveUserIdForCharacter(actor.id);
            if (uid !== user.id) continue;
            onExternalChange(actor.id, "player-list-status");
        }
        const gmUser = game.users?.find(u => u.isGM && u.id === user.id);
        if (gmUser) onExternalChange("gm", "player-list-status");
    }));
}

export function removePlayerListStatusHooks() {
    for (const id of _hookIds) Hooks.off(id);
    _hookIds = [];
}

export const playerListStatusAdapterMeta = {
    id: "player-list-status",
    label: "Player Status (player list)"
};
