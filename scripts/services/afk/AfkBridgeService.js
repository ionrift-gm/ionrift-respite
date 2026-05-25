/**
 * Bidirectional AFK sync between Respite rest state and third-party modules.
 */
import * as RestAfkState from "../RestAfkState.js";
import { emitRestSessionAfk, refreshAfterAfkChange } from "../restSessionAfkEmit.js";
import { getPartyActors } from "../partyActors.js";
import {
    fastFlipAdapterMeta,
    installFastFlipHooks,
    isFastFlipAvailable,
    readFastFlipAfk,
    removeFastFlipHooks,
    writeFastFlipAfk
} from "./adapters/FastFlipAfkAdapter.js";
import {
    installPlayerListStatusHooks,
    isPlayerListStatusAvailable,
    playerListStatusAdapterMeta,
    readPlayerListStatusAfk,
    removePlayerListStatusHooks,
    writePlayerListStatusAfk
} from "./adapters/PlayerListStatusAfkAdapter.js";

const MODULE_ID = "ionrift-respite";

/** @typedef {"respite"|"socket"|"external"|"reconcile"} AfkChangeOrigin */

/** @type {Set<string>} */
const _syncingToAdapters = new Set();

/** @type {boolean} */
let _hooksInstalled = false;

const ADAPTER_READERS = [
    { meta: fastFlipAdapterMeta, read: readFastFlipAfk, write: writeFastFlipAfk },
    { meta: playerListStatusAdapterMeta, read: readPlayerListStatusAfk, write: writePlayerListStatusAfk }
];

/**
 * @returns {"respite"|"integrated"}
 */
export function getAfkControlSource() {
    try {
        const v = game.settings.get(MODULE_ID, "afkControlSource");
        return v === "integrated" ? "integrated" : "respite";
    } catch {
        return "respite";
    }
}

/** @returns {boolean} */
export function canUseRespiteAfkControls() {
    return getAfkControlSource() === "respite";
}

/** @returns {boolean} */
export function isIntegratedAfkPrimary() {
    return getAfkControlSource() === "integrated";
}

/** @returns {{ id: string, label: string, active: boolean }[]} */
export function getDetectedAfkAdapters() {
    return [
        { ...fastFlipAdapterMeta, active: isFastFlipAvailable() },
        { ...playerListStatusAdapterMeta, active: isPlayerListStatusAvailable() }
    ].filter(a => a.active);
}

/**
 * OR merge across adapters: any adapter reporting AFK marks the character AFK.
 * @param {string} characterId
 * @returns {boolean|null} null when no adapters are active
 */
export function readIntegratedAfk(characterId) {
    let anyAdapter = false;
    let anyAfk = false;
    for (const { read } of ADAPTER_READERS) {
        const v = read(characterId);
        if (v === null) continue;
        anyAdapter = true;
        if (v) anyAfk = true;
    }
    if (!anyAdapter) return null;
    return anyAfk;
}

/**
 * @param {string} characterId
 * @param {boolean} isAfk
 * @param {string} [skipAdapterId]
 */
async function pushToAdapters(characterId, isAfk, skipAdapterId) {
    const key = `${characterId}:${isAfk}`;
    if (_syncingToAdapters.has(key)) return;
    _syncingToAdapters.add(key);
    try {
        for (const { meta, write } of ADAPTER_READERS) {
            if (meta.id === skipAdapterId) continue;
            await write(characterId, isAfk);
        }
    } finally {
        _syncingToAdapters.delete(key);
    }
}

/**
 * @param {string} characterId
 * @param {boolean} isAfk
 * @param {AfkChangeOrigin} origin
 * @param {{ adapterId?: string, emitSocket?: boolean }} [opts]
 */
export function setCharacterAfk(characterId, isAfk, origin, opts = {}) {
    if (!characterId) return;
    const prev = RestAfkState.isAfk(characterId);
    if (prev === isAfk) return;

    RestAfkState.applyUpdate(characterId, isAfk);

    const shouldEmitSocket = opts.emitSocket !== false
        && (origin === "respite" || origin === "external" || origin === "reconcile");

    if (shouldEmitSocket && origin !== "socket") {
        emitRestSessionAfk(characterId, isAfk);
    }

    if (origin === "respite" || origin === "socket" || origin === "reconcile") {
        void pushToAdapters(characterId, isAfk, opts.adapterId);
    } else if (origin === "external" && !isIntegratedAfkPrimary()) {
        void pushToAdapters(characterId, isAfk, opts.adapterId);
    }

    refreshAfterAfkChange();
}

/**
 * Apply external adapter state into Respite (integrated-primary or mirror mode).
 * @param {string} characterId
 * @param {string} adapterId
 */
function ingestExternalChange(characterId, adapterId) {
    const integrated = readIntegratedAfk(characterId);
    if (integrated === null) return;
    const next = integrated;
    setCharacterAfk(characterId, next, "external", { adapterId, emitSocket: true });
}

/**
 * Pull adapter state for all roster characters into RestAfkState.
 */
export function reconcileFromAdapters() {
    if (!getDetectedAfkAdapters().length) return;
    const ids = getPartyActors().map(a => a.id);
    ids.push("gm");
    for (const id of ids) {
        const integrated = readIntegratedAfk(id);
        if (integrated === null) continue;
        if (RestAfkState.isAfk(id) !== integrated) {
            setCharacterAfk(id, integrated, "reconcile", { emitSocket: false });
        }
    }
}

/** Push current RestAfkState to all adapters (after snapshot restore). */
export function pushAllStateToAdapters() {
    for (const id of RestAfkState.getAfkCharacterIds()) {
        void pushToAdapters(id, true);
    }
    const party = getPartyActors();
    const partyIds = new Set(party.map(a => a.id));
    partyIds.add("gm");
    for (const id of partyIds) {
        if (!RestAfkState.isAfk(id)) void pushToAdapters(id, false);
    }
}

export function installAfkBridgeHooks() {
    if (_hooksInstalled) return;
    _hooksInstalled = true;

    const onExternal = (characterId, adapterId) => {
        ingestExternalChange(characterId, adapterId);
    };

    installFastFlipHooks(onExternal);
    installPlayerListStatusHooks(onExternal);
}

export function removeAfkBridgeHooks() {
    removeFastFlipHooks();
    removePlayerListStatusHooks();
    _hooksInstalled = false;
}

export function initAfkBridge() {
    installAfkBridgeHooks();
    if (isIntegratedAfkPrimary()) reconcileFromAdapters();
}
