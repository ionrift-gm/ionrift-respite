import { getItemIdentifier, getRespiteFlag } from "../../services/camp/gear/CampGearScanner.js";

const SHELTER_EFFECT_IDS = new Set([
    "leomunds-tiny-hut",
    "tiny-hut",
    "rope-trick",
    "galders-tower",
    "cozy-cabin",
    "mordenkainens-magnificent-mansion",
    "magnificent-mansion",
    "shelter"
]);

/**
 * Manages Camp Stance (Warm Camp vs Cold & Dark), shelter detection,
 * and player toggle cooldowns for Bivouac rests.
 */
export class CampStanceManager {

    /** @type {"warm"|"cold_dark"} */
    #stance = "warm";

    /** @type {boolean} */
    #shelterActive = false;

    /** @type {Map<string, number>} userId -> lastToggleTimestamp */
    #cooldowns = new Map();

    /** Cooldown duration in milliseconds for non-GM players */
    static COOLDOWN_MS = 6000;

    constructor({ stance = "warm", shelterActive = false } = {}) {
        this.#stance = stance === "cold_dark" ? "cold_dark" : "warm";
        this.#shelterActive = Boolean(shelterActive);
    }

    get stance() {
        return this.#stance;
    }

    get isWarm() {
        return this.#stance === "warm";
    }

    get isColdDark() {
        return this.#stance === "cold_dark";
    }

    get shelterActive() {
        return this.#shelterActive;
    }

    /**
     * Encounter DC modifier based on camp stance and magical/concealed shelter.
     * Warm Camp: normal detection (+0)
     * Cold & Dark: stealth camp (-3 to DC)
     * Shelter: cancels detection signature
     *
     * @returns {number}
     */
    get encounterDcModifier() {
        if (this.#shelterActive) {
            return this.isColdDark ? -3 : 0;
        }
        return this.isColdDark ? -3 : 0;
    }

    /**
     * Whether cooking is permitted under current stance.
     * @returns {boolean}
     */
    get cookingAllowed() {
        return this.isWarm;
    }

    /**
     * Checks if a user is permitted to toggle stance, respecting non-GM cooldown.
     *
     * @param {string} userId
     * @param {boolean} isGM
     * @returns {{ allowed: boolean, remainingMs: number }}
     */
    canToggle(userId, isGM = false) {
        if (isGM) return { allowed: true, remainingMs: 0 };
        const last = this.#cooldowns.get(userId) ?? 0;
        const elapsed = Date.now() - last;
        if (elapsed < CampStanceManager.COOLDOWN_MS) {
            return { allowed: false, remainingMs: CampStanceManager.COOLDOWN_MS - elapsed };
        }
        return { allowed: true, remainingMs: 0 };
    }

    /**
     * Sets the camp stance if allowed.
     *
     * @param {"warm"|"cold_dark"} newStance
     * @param {string} userId
     * @param {boolean} isGM
     * @returns {boolean} True if successfully toggled
     */
    setStance(newStance, userId, isGM = false) {
        const { allowed } = this.canToggle(userId, isGM);
        if (!allowed) return false;

        this.#stance = newStance === "cold_dark" ? "cold_dark" : "warm";
        if (!isGM && userId) {
            this.#cooldowns.set(userId, Date.now());
        }
        return true;
    }

    /**
     * Starts a user's toggle cooldown without changing stance. Player clients
     * call this when they hand a toggle off to the GM, so their local gate
     * matches the one the GM will apply.
     *
     * @param {string} userId
     */
    noteToggle(userId) {
        if (userId) this.#cooldowns.set(userId, Date.now());
    }

    /**
     * Sets shelter state (GM only).
     * @param {boolean} active
     */
    setShelter(active) {
        this.#shelterActive = Boolean(active);
    }

    /**
     * Scans party actors or active scene for magical shelter spells (Tiny Hut, Rope Trick, etc.)
     *
     * @param {Actor[]} partyActors
     * @returns {boolean}
     */
    static autoDetectShelter(partyActors = []) {
        for (const actor of partyActors) {
            if (!actor?.effects) continue;
            const hasShelterEffect = actor.effects.some(e => {
                if (getRespiteFlag(e, "shelterEffect") === true || Boolean(getRespiteFlag(e, "shelterSpellId"))) {
                    return true;
                }
                const ident = getItemIdentifier(e);
                if (ident && SHELTER_EFFECT_IDS.has(ident)) return true;
                const origin = typeof e.origin === "string" ? e.origin.toLowerCase() : "";
                if (origin) {
                    for (const id of SHELTER_EFFECT_IDS) {
                        if (origin.endsWith(`.${id}`) || origin.endsWith(`/${id}`) || origin.includes(`.${id}.`) || origin === id) {
                            return true;
                        }
                    }
                    const originItem = actor.items?.find?.(i =>
                        (i.uuid && i.uuid.toLowerCase() === origin)
                        || (i.id && origin.endsWith(`.${String(i.id).toLowerCase()}`))
                    );
                    if (originItem) {
                        const originIdent = getItemIdentifier(originItem);
                        if (originIdent && SHELTER_EFFECT_IDS.has(originIdent)) return true;
                        if (getRespiteFlag(originItem, "shelterEffect") === true || Boolean(getRespiteFlag(originItem, "shelterSpellId"))) {
                            return true;
                        }
                    }
                }
                const name = (e.name ?? e.label ?? "").toLowerCase();
                return name.includes("tiny hut") || name.includes("rope trick") || name.includes("shelter");
            });
            if (hasShelterEffect) return true;
        }
        return false;
    }

    toJSON() {
        return {
            stance: this.#stance,
            shelterActive: this.#shelterActive
        };
    }

    fromJSON(data) {
        if (data?.stance) this.#stance = data.stance;
        if (typeof data?.shelterActive === "boolean") this.#shelterActive = data.shelterActive;
    }
}
