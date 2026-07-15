/** @type {Set<string>} Actor ids plus "gm" when GM is AFK. */
const afkCharacters = new Set();

/**
 * @returns {string[]}
 */
export function getAfkCharacterIds() {
    return [...afkCharacters];
}

/**
 * @param {string} id
 * @returns {boolean}
 */
export function isAfk(id) {
    return afkCharacters.has(id);
}

/**
 * @param {string} characterId
 * @param {boolean} isAfkState
 */
export function applyUpdate(characterId, isAfkState) {
    if (!characterId) return;
    if (isAfkState) afkCharacters.add(characterId);
    else afkCharacters.delete(characterId);
}

/**
 * Replace entire AFK set (e.g. snapshot restore).
 * @param {Iterable<string>} ids
 */
export function replaceAll(ids) {
    afkCharacters.clear();
    for (const id of ids) {
        if (id) afkCharacters.add(id);
    }
}

export function clear() {
    afkCharacters.clear();
}
