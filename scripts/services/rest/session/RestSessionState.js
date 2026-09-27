/**
 * Schema-driven state codec for rest sessions.
 *
 * A rest session has to express its state three times: persisted to the
 * world setting for GM reload, exported as a reconnect snapshot, and pushed
 * as a live sync after every authoritative mutation. Writing those by hand
 * let fields drift apart, so each session type declares its fields once here
 * and all three payloads are derived from that single list.
 *
 * Fields marked `gmOnly` are persisted and kept in GM memory but stripped
 * from anything sent to players.
 */

import { MODULE_ID } from "../../../data/moduleId.js";

/** Field kinds the codec knows how to read and write. */
const KINDS = {
    /** Plain JSON value held directly on the app. */
    value: {
        read: (app, field) => app[field.prop],
        write: (app, field, raw) => { app[field.prop] = raw; },
        accepts: (raw, field) => matchesType(raw, field.type)
    },
    /** Map serialised as an array of entry pairs. */
    map: {
        read: (app, field) => [...(app[field.prop]?.entries?.() ?? [])],
        write: (app, field, raw) => { app[field.prop] = new Map(raw); },
        accepts: (raw) => Array.isArray(raw)
    },
    /** Set serialised as an array of members. */
    set: {
        read: (app, field) => [...(app[field.prop] ?? [])],
        write: (app, field, raw) => { app[field.prop] = new Set(raw); },
        accepts: (raw) => Array.isArray(raw)
    },
    /** Delegate object exposing toJSON/fromJSON. */
    codec: {
        read: (app, field) => app[field.prop]?.toJSON?.() ?? null,
        write: (app, field, raw) => { app[field.prop]?.fromJSON?.(raw); },
        accepts: (raw) => raw !== null && typeof raw === "object" && !Array.isArray(raw)
    }
};

/**
 * @param {*} value
 * @param {string} [type] One of string, number, boolean, array, object.
 * @returns {boolean}
 */
function matchesType(value, type) {
    if (value === undefined || value === null) return false;
    if (!type) return true;
    if (type === "array") return Array.isArray(value);
    if (type === "object") return typeof value === "object" && !Array.isArray(value);
    return typeof value === type;
}

/**
 * Declares one field of a rest session state schema.
 *
 * @param {object} spec
 * @param {string} spec.key Wire and setting key.
 * @param {"value"|"map"|"set"|"codec"} [spec.kind]
 * @param {string} [spec.prop] App property name. Defaults to `_{key}`.
 * @param {string} [spec.type] Runtime type guard for `value` fields.
 * @param {boolean} [spec.nullable] Accept an explicit null as a real value.
 * @param {boolean} [spec.gmOnly] Withhold from player payloads.
 * @param {boolean} [spec.derived] Serialise only; another field restores it.
 * @param {((value: *, app: object) => *)|null} [spec.transformForPlayers] Custom transform for player payloads.
 * @returns {object}
 */
export function field({ key, kind = "value", prop, type, nullable = false, gmOnly = false, derived = false, transformForPlayers = null }) {
    if (!KINDS[kind]) throw new Error(`Unknown rest session state field kind: ${kind}`);
    return Object.freeze({ key, kind, prop: prop ?? `_${key}`, type, nullable, gmOnly, derived, transformForPlayers });
}

export class RestSessionSchema {

    /** @type {string} */
    #type;

    /** @type {"short"|"long"} */
    #systemRestType;

    /** @type {boolean} */
    #gritty;

    /** @type {string} */
    #settingKey;

    /** @type {ReadonlyArray<object>} */
    #fields;

    /** @type {((state: object) => object)|null} */
    #migrate;

    /**
     * @param {object} spec
     * @param {string} spec.type Session type key, e.g. "bivouac".
     * @param {"short"|"long"} spec.systemRestType The game system rest this session stands in for.
     * @param {string} spec.settingKey World setting holding the interrupted session.
     * @param {boolean} [spec.gritty] Whether this session belongs to the gritty variant.
     * @param {Array<object>} spec.fields
     * @param {(state: object) => object} [spec.migrate] Upgrades legacy payloads before apply.
     */
    constructor({ type, systemRestType, settingKey, gritty = false, fields, migrate = null }) {
        this.#type = type;
        this.#systemRestType = systemRestType;
        this.#settingKey = settingKey;
        this.#gritty = gritty;
        this.#fields = Object.freeze([...fields]);
        this.#migrate = migrate;
    }

    get type() {
        return this.#type;
    }

    /**
     * Keeps `ionrift.respite.sleepStarted` on one value domain across every
     * session type, whatever bespoke flow produced it.
     */
    get systemRestType() {
        return this.#systemRestType;
    }

    get gritty() {
        return this.#gritty;
    }

    get settingKey() {
        return this.#settingKey;
    }

    get fields() {
        return this.#fields;
    }

    /**
     * Full state including GM-only fields. Use for the world setting.
     *
     * @param {object} app
     * @returns {object}
     */
    serialize(app) {
        const state = { type: this.#type };
        for (const f of this.#fields) {
            state[f.key] = KINDS[f.kind].read(app, f);
        }
        return state;
    }

    /**
     * State safe to transmit to player clients. Drives both the reconnect
     * snapshot and the live sync so the two cannot disagree.
     *
     * @param {object} app
     * @returns {object}
     */
    serializeForPlayers(app) {
        const state = { type: this.#type };
        for (const f of this.#fields) {
            if (f.gmOnly) continue;
            let value = KINDS[f.kind].read(app, f);
            if (typeof f.transformForPlayers === "function") {
                value = f.transformForPlayers(value, app);
            }
            state[f.key] = value;
        }
        return state;
    }

    /**
     * Wraps the full state for the session's world setting.
     *
     * @param {object} app
     * @returns {object}
     */
    toSetting(app) {
        return { ...this.serialize(app), timestamp: Date.now() };
    }

    /**
     * Writes the session to its world setting. GM only; players never own
     * the authoritative copy.
     *
     * @param {object} app
     * @returns {Promise<void>}
     */
    async save(app) {
        if (!game.user?.isGM) return;
        try {
            await game.settings.set(MODULE_ID, this.#settingKey, this.toSetting(app));
        } catch (e) {
            console.warn(`${MODULE_ID} | Failed to save ${this.#type} state:`, e);
        }
    }

    /**
     * Reads the raw persisted state without applying it.
     *
     * @returns {object|null}
     */
    read() {
        try {
            return game.settings.get(MODULE_ID, this.#settingKey) ?? null;
        } catch {
            // Setting may not be registered yet on first load.
            return null;
        }
    }

    /**
     * Restores a persisted session onto the app.
     *
     * Session types that share a setting key discriminate on `type`. Legacy
     * payloads written before the schema carry no type and are accepted.
     *
     * @param {object} app
     * @returns {boolean} True if a session was found and applied.
     */
    load(app) {
        const state = this.read();
        if (!state?.timestamp) return false;
        if (state.type && state.type !== this.#type) return false;
        this.apply(app, state);
        return true;
    }

    /**
     * Empties the session's world setting.
     *
     * @returns {Promise<void>}
     */
    async clear() {
        if (!game.user?.isGM) return;
        try {
            await game.settings.set(MODULE_ID, this.#settingKey, {});
        } catch {
            // Setting may not be registered yet.
        }
    }

    /**
     * Applies a state payload from any source. Absent or wrongly typed keys
     * are left alone so a partial payload never blanks live state.
     *
     * @param {object} app
     * @param {object} state
     */
    apply(app, state) {
        if (!state || typeof state !== "object") return;
        const source = this.#migrate ? this.#migrate(state) : state;
        for (const f of this.#fields) {
            if (f.derived) continue;
            if (!(f.key in source)) continue;
            const raw = source[f.key];
            if (raw === null) {
                if (!f.nullable) continue;
            } else if (!KINDS[f.kind].accepts(raw, f)) {
                continue;
            }
            KINDS[f.kind].write(app, f, raw);
        }
    }
}
