import { Logger } from "../lib/Logger.js";

/**
 * ShortRestApp
 * Single-screen short rest flow. HD spending, shelter toggle, complete.
 * Self-service: players spend their own HD, GM oversees and completes.
 *
 * Uses actor.rollHitDie() (Foundry native) to stay in sync with character sheets.
 * Calls actor.shortRest() on completion for class feature recovery.
 */

import { registerActiveShortRestApp, clearActiveShortRestApp, getPartyActors } from "../module.js";

const MODULE_ID = "ionrift-respite";
import { ImageResolver } from "../util/ImageResolver.js";
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** RP prompts -- one picked at random per rest. */
const RP_PROMPTS = [
    "The party catches their breath. Who tends whose wounds?",
    "A brief pause. What does each character do with the quiet?",
    "Weapons are sheathed. Bandages are unwound. What does the hour look like?",
    "The adrenaline fades. Who sits, who paces, who stares at nothing?",
    "An hour to rest. Who heals, who watches, who is lost in thought?",
    "The fighting is done, for now. What do you do with the silence?",
];

/** All shelter options for short rest. "none" is always shown. */
const SHORT_REST_SHELTERS = [
    { id: "none",      name: "Open Air",   icon: "fas fa-wind",       hint: "No shelter. Standard short rest." },
    { id: "rope_trick", name: "Rope Trick", icon: "fas fa-hat-wizard", hint: "Hidden extradimensional space. Safe short rest.",
      altNames: ["rope trick"] },
    { id: "tiny_hut",  name: "Tiny Hut",   icon: "fas fa-igloo",      hint: "Impenetrable force dome. Safe rest.",
      altNames: ["leomund's tiny hut", "tiny hut"] },
];

export class ShortRestApp extends HandlebarsApplicationMixin(ApplicationV2) {

    static DEFAULT_OPTIONS = {
        id: "ionrift-short-rest",
        classes: ["ionrift-window", "short-rest-app"],
        tag: "div",
        window: {
            title: "Short Rest",
            icon: "fas fa-mug-hot",
            resizable: true,
        },
        position: {
            width: 720,
            height: "auto",
        },
        actions: {
            spendHitDie:       ShortRestApp.#onSpendHitDie,
            completeShortRest: ShortRestApp.#onCompleteShortRest,
        },
    };

    static PARTS = {
        body: {
            template: `modules/${MODULE_ID}/templates/short-rest.hbs`,
        },
    };

    constructor(options = {}) {
        super(options);
        this._isGM = game.user.isGM;

        /** @type {Map<string, Object[]>} actorId -> array of roll results */
        this._rolls = new Map();

        /** Active shelter -- set from setup wizard, or 'none' by default */
        this._activeShelter = options.initialShelter ?? "none";

        /** RP prompt (fixed for this rest) */
        this._rpPrompt = RP_PROMPTS[Math.floor(Math.random() * RP_PROMPTS.length)];
    }

    // ── Lifecycle ──────────────────────────────────────────────

    async render(options = {}) {
        if (this._isGM) {
            registerActiveShortRestApp(this);
            // Broadcast state to players so anyone already connected gets it
            game.socket.emit(`module.${MODULE_ID}`, {
                type: "shortRestStarted",
                rolls: this._serializeRolls(),
                activeShelter: this._activeShelter,
                rpPrompt: this._rpPrompt,
            });
        }
        // Live HP/HD sync -- re-render whenever any party actor changes
        if (!this._actorHookId) {
            this._actorHookId = Hooks.on("updateActor", (actor) => {
                if (actor.hasPlayerOwner) this.render();
            });
        }
        return super.render(options);
    }

    async close(options = {}) {
        if (this._isGM) {
            clearActiveShortRestApp();
        }
        if (this._actorHookId) {
            Hooks.off("updateActor", this._actorHookId);
            this._actorHookId = null;
        }
        return super.close(options);
    }

    // ── Context ────────────────────────────────────────────────

    async _prepareContext(options) {
        const partyActors = getPartyActors();

        // Detect which shelter spells anyone in the party has prepared
        const preparedShelterIds = new Set(["none"]);
        for (const spell of SHORT_REST_SHELTERS) {
            if (!spell.altNames) continue;
            const hasCaster = partyActors.some(a =>
                a.items?.some(i => {
                    if (i.type !== "spell") return false;
                    const name = i.name?.toLowerCase() ?? "";
                    return spell.altNames.some(alt => name.includes(alt));
                })
            );
            if (hasCaster) preparedShelterIds.add(spell.id);
        }

        // Build shelter radio options (always show "Open Air", plus any detected spells)
        const shelterOptions = SHORT_REST_SHELTERS
            .filter(s => preparedShelterIds.has(s.id))
            .map(s => ({
                ...s,
                active: this._activeShelter === s.id,
            }));
        // Always have at least Open Air
        if (!shelterOptions.length) {
            shelterOptions.push({ ...SHORT_REST_SHELTERS[0], active: true });
        }

        // Build character cards
        const characters = partyActors.map(a => {
            const hp = a.system?.attributes?.hp ?? {};
            const currentHp = Number(hp.value) || 0;
            const maxHp = hp.max ?? 0;

            const hdData = this._getHitDiceInfo(a);
            const rolls = this._rolls.get(a.id) ?? [];
            const totalHealed = rolls.reduce((sum, r) => sum + (Number(r.total) || 0), 0);

            // Build pip array
            const hdPips = [];
            for (let i = 0; i < hdData.max; i++) {
                hdPips.push({ filled: i < hdData.remaining });
            }

            // Use actor's live HP (already updated by dnd5e.rollHitDie)
            // rather than manually adding totalHealed on top (double-count)
            return {
                id: a.id,
                name: a.name,
                img: a.img || "icons/svg/mystery-man.svg",
                currentHp,
                maxHp,
                isFullHp: currentHp >= maxHp,
                hdRemaining: hdData.remaining,
                hdMax: hdData.max,
                hdDie: hdData.die,
                hdPips,
                rolls,
                totalHealed,
                noHdLeft: hdData.remaining <= 0,
                isOwner: this._isGM || a.isOwner,
                conMod: a.system?.abilities?.con?.mod ?? 0,
            };
        });

        const isRopeTrick = this._activeShelter === "rope_trick";

        // Shelter badge for display (selection happened in setup wizard)
        const shelterDef = SHORT_REST_SHELTERS.find(s => s.id === this._activeShelter)
            ?? SHORT_REST_SHELTERS.find(s => s.id === "none");
        const shelterBadge = {
            id: this._activeShelter,
            name: shelterDef?.name ?? "Open Air",
            icon: shelterDef?.icon ?? "fas fa-wind",
        };

        return {
            isGM: this._isGM,
            characters,
            shelterBadge,
            rpPrompt: this._rpPrompt,
            allSpent: characters.every(c => c.isFullHp || c.noHdLeft || !c.isOwner),
            banner: isRopeTrick
                ? ImageResolver.terrainBanner("short-rest", "rope_trick.png")
                : ImageResolver.terrainBanner("short-rest", "banner.png"),
            bannerFallback: ImageResolver.fallbackBanner,
        };
    }

    /**
     * Extracts Hit Dice info from a DnD5e actor.
     * Derives all data from class items (the source of truth in DnD5e v4/v5).
     * Falls back to system.attributes.hd for older versions.
     */
    _getHitDiceInfo(actor) {
        const classItems = actor.items?.filter(i => i.type === "class") ?? [];

        if (classItems.length) {
            let totalMax = 0;
            let totalUsed = 0;

            for (const cls of classItems) {
                totalMax += cls.system?.levels ?? 0;
                totalUsed += cls.system?.hitDiceUsed ?? cls.system?.hd?.spent ?? 0;
            }

            // Primary die = highest-level class (first if tied)
            const sorted = [...classItems].sort((a, b) =>
                (b.system?.levels ?? 0) - (a.system?.levels ?? 0)
            );
            const rawDie = sorted[0]?.system?.hitDice
                ?? sorted[0]?.system?.hd?.denomination
                ?? "d8";
            const primaryDie = typeof rawDie === "string"
                ? parseInt(rawDie.replace("d", "")) || 8
                : rawDie;

            return {
                remaining: Math.max(0, totalMax - totalUsed),
                max: totalMax,
                die: primaryDie,
            };
        }

        // Fallback: no class items (legacy or unusual actor)
        const hd = actor.system?.attributes?.hd;
        if (hd && typeof hd.value === "number") {
            return { remaining: hd.value, max: hd.max ?? 0, die: 8 };
        }
        const level = actor.system?.details?.level ?? 0;
        const spent = hd?.spent ?? 0;
        return { remaining: Math.max(0, level - spent), max: level, die: 8 };
    }

    /**
     * Get the denomination string (e.g. "d8") for the actor's primary HD class.
     * DnD5e v4 rollHitDie() needs either a class item or denomination.
     */
    _getHdDenomination(actor) {
        // v4.x: iterate classes via actor.items
        const classItems = actor.items?.filter(i => i.type === "class") ?? [];
        if (classItems.length) {
            const cls = classItems[0];
            const hd = cls.system?.hitDice ?? cls.system?.hd?.denomination ?? cls.hitDice;
            if (typeof hd === "string") return hd;           // already "d8"
            if (typeof hd === "number") return `d${hd}`;
        }
        // Fallback from system data
        const hd = actor.system?.attributes?.hd;
        if (typeof hd === "string") return hd;
        return "d8";
    }

    // ── Actions ────────────────────────────────────────────────

    /**
     * Player spends 1 Hit Die. Uses Foundry's native rollHitDie().
     */
    static async #onSpendHitDie(event, target) {
        const actorId = target.dataset.actorId;
        const actor = game.actors.get(actorId);
        if (!actor) return;

        if (!this._isGM && !actor.isOwner) return;

        const hdData = this._getHitDiceInfo(actor);
        if (hdData.remaining <= 0) {
            ui.notifications.warn(`${actor.name} has no Hit Dice remaining.`);
            return;
        }

        // DnD5e v4 signature: rollHitDie(denomination, options)
        // v3 signature: rollHitDie(options)
        // We try v4 first, fall back to no-arg if that fails.
        let roll;
        try {
            const denom = this._getHdDenomination(actor);
            roll = await actor.rollHitDie(denom, { dialog: false });
        } catch (e) {
            Logger.warn(`rollHitDie v4-style failed, trying legacy:`, e);
            try {
                roll = await actor.rollHitDie({ dialog: false });
            } catch (e2) {
                console.error(`${MODULE_ID} | rollHitDie failed entirely:`, e2);
                ui.notifications.error("Could not roll Hit Die. See console for details.");
                return;
            }
        }

        if (!roll) return; // Cancelled

        // DnD5e v5.x returns an array of Roll objects; unwrap if needed
        const singleRoll = Array.isArray(roll) ? roll[0] : roll;
        const rollTotal = Number(singleRoll?.total) || 0;

        const conMod = actor.system?.abilities?.con?.mod ?? 0;

        // Record the roll locally
        if (!this._rolls.has(actorId)) this._rolls.set(actorId, []);
        this._rolls.get(actorId).push({
            total: rollTotal,
            die: hdData.die,
            conMod,
        });

        // Broadcast to other clients
        game.socket.emit(`module.${MODULE_ID}`, {
            type: "shortRestHdSpent",
            actorId,
            rollTotal,
            die: hdData.die,
            conMod,
        });

        this.render();
    }


    /**
     * GM completes the short rest. Calls actor.shortRest() for class feature recovery.
     */
    static async #onCompleteShortRest(event, target) {
        if (!this._isGM) return;

        const partyActors = getPartyActors();
        for (const actor of partyActors) {
            try {
                await actor.shortRest({ dialog: false, chat: true });
            } catch (e) {
                Logger.warn(`Failed shortRest for ${actor.name}:`, e);
            }
        }

        game.socket.emit(`module.${MODULE_ID}`, { type: "shortRestComplete" });
        ui.notifications.info("Short rest complete. Class features recovered.");
        this.close();
    }

    // ── Socket receivers ───────────────────────────────────────

    /**
     * Called on GM side when a player spends a hit die.
     */
    receiveHdSpent(data) {
        const { actorId, rollTotal, die, conMod } = data;
        if (!this._rolls.has(actorId)) this._rolls.set(actorId, []);
        this._rolls.get(actorId).push({ total: rollTotal, die, conMod });
        this.render();
    }

    /**
     * Called on player side when GM starts (or re-broadcasts) a short rest.
     */
    receiveStarted(data) {
        if (data.rolls) this._rolls = this._deserializeRolls(data.rolls);
        if (data.activeShelter) this._activeShelter = data.activeShelter;
        if (data.rpPrompt) this._rpPrompt = data.rpPrompt;
        this.render({ force: true });
    }

    // ── Serialization ──────────────────────────────────────────

    _serializeRolls() {
        const obj = {};
        for (const [key, val] of this._rolls) obj[key] = val;
        return obj;
    }

    _deserializeRolls(obj) {
        const map = new Map();
        for (const [key, val] of Object.entries(obj)) map.set(key, val);
        return map;
    }
}
