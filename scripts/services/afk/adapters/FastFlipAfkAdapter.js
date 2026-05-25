import {
    getTokenDocumentsForActor,
    resolveCharacterIdFromTokenDoc
} from "../afkCharacterIds.js";

const MODULE_ID = "fast-flip";
const FLAG_KEY = "afk-state";

/** @type {number[]} */
let _hookIds = [];

/**
 * @param {() => void} onExternalChange
 */
export function installFastFlipHooks(onExternalChange) {
    removeFastFlipHooks();
    const handler = (doc) => {
        const characterId = resolveCharacterIdFromTokenDoc(doc);
        if (!characterId) return;
        onExternalChange(characterId, "fast-flip");
    };
    _hookIds.push(Hooks.on("updateToken", (doc, changes) => {
        if (!changes?.flags?.[MODULE_ID]) return;
        handler(doc);
    }));
    _hookIds.push(Hooks.on("createToken", (doc) => handler(doc)));
}

export function removeFastFlipHooks() {
    for (const id of _hookIds) Hooks.off(id);
    _hookIds = [];
}

export function isFastFlipAvailable() {
    return !!game.modules?.get?.(MODULE_ID)?.active;
}

/** @returns {boolean|null} null if unavailable */
export function readFastFlipAfk(characterId) {
    if (!isFastFlipAvailable()) return null;
    if (characterId === "gm") return false;
    const tokens = getTokenDocumentsForActor(characterId);
    if (!tokens.length) return false;
    return tokens.some(doc => !!doc.getFlag(MODULE_ID, FLAG_KEY));
}

/**
 * @param {string} characterId
 * @param {boolean} isAfk
 */
export async function writeFastFlipAfk(characterId, isAfk) {
    if (!isFastFlipAvailable()) return;
    if (characterId === "gm") return;
    const tokens = getTokenDocumentsForActor(characterId);
    for (const doc of tokens) {
        const current = !!doc.getFlag(MODULE_ID, FLAG_KEY);
        if (current === isAfk) continue;
        await doc.setFlag(MODULE_ID, FLAG_KEY, isAfk);
    }
}

export const fastFlipAdapterMeta = {
    id: "fast-flip",
    label: "Fast Flip! Token Tools"
};
