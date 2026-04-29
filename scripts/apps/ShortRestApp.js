import { Logger } from "../lib/Logger.js";
import { HitDieModifiers } from "../services/HitDieModifiers.js";
import { SpellSlotRecovery } from "../services/SpellSlotRecovery.js";

/**
 * ShortRestApp
 * Single-screen short rest flow. HD spending, shelter toggle, complete.
 * Self-service: players spend their own HD, GM oversees and completes.
 *
 * Uses actor.rollHitDie() (Foundry native) to stay in sync with character sheets.
 * Calls actor.shortRest() on completion for class feature recovery.
 */

import {
    registerActiveShortRestApp,
    clearActiveShortRestApp,
    _showGmShortRestIndicator,
    _removeGmShortRestIndicator,
    notifyShortRestActive,
    showAfkPanel,
    hideAfkPanelAfterRest
} from "../module.js";
import { getPartyActors } from "../services/partyActors.js";
import * as RestAfkState from "../services/RestAfkState.js";

const MODULE_ID = "ionrift-respite";
/** World setting: when Song of Rest HP is applied. */
const SONG_TIMING_KEY = "songOfRestTiming";
/** Actor flag: pending Arcane/Natural Recovery selections for GM apply on rest complete. */
const SPELL_RECOVERY_FLAG = "spellRecoveryPending";
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
            height: 680,
        },
        actions: {
            spendHitDie:            ShortRestApp.#onSpendHitDie,
            completeShortRest:    ShortRestApp.#onCompleteShortRest,
            abandonShortRest:     ShortRestApp.#onAbandonShortRest,
            addSpellSlot:         ShortRestApp.#onAddSpellSlot,
            removeSpellSlot:      ShortRestApp.#onRemoveSpellSlot,
            confirmRecovery:      ShortRestApp.#onConfirmRecovery,
            editRecovery:         ShortRestApp.#onEditRecovery,
            volunteerSong:             ShortRestApp.#onVolunteerSong,
            toggleShortRestFinished:   ShortRestApp.#onToggleShortRestFinished,
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

        /**
         * actorId -> spell recovery UI state (Arcane Recovery / Natural Recovery).
         * @type {Map<string, { featureName: string, featureItem: Item, maxBudget: number, maxSlotLevel: number, classLevel: number, selections: Map<number, number>, recoverableSlots: Array<{ level: number, max: number, value: number, spent: number }> }>}
         */
        this._spellRecovery = new Map();

        /** Actors whose spell recovery selections have been confirmed/locked. */
        this._confirmedRecovery = new Set();

        /** Active shelter -- set from setup wizard, or 'none' by default */
        this._activeShelter = options.initialShelter ?? "none";

        /** RP prompt (fixed for this rest) */
        this._rpPrompt = RP_PROMPTS[Math.floor(Math.random() * RP_PROMPTS.length)];

        /**
         * actorId -> Song of Rest bonus already applied this rest ("with first Hit Die" mode).
         * @type {Map<string, { total: number, formula: string, bardName: string }>}
         */
        this._songBonusByActor = new Map();

        /** Bard who volunteered Song of Rest. Null until a bard player offers.
         * @type {{ actorId: string, bardName: string, bardLevel: number, songDie: string }|null} */
        this._songVolunteer = null;

        /** User IDs who signalled they are done with short rest actions (synced). */
        this._finishedUsers = new Set();

        /**
         * True when the rest is being completed or abandoned (cleanup path).
         * False when the window is merely being dismissed (preserves state).
         */
        this._isTerminating = false;
        RestAfkState.clear();
    }

    // ── Lifecycle ──────────────────────────────────────────────

    async render(options = {}) {
        if (this._isGM) {
            registerActiveShortRestApp(this);
            // Broadcast state to players so anyone already connected gets it
            game.socket.emit(`module.${MODULE_ID}`, {
                type: "shortRestStarted",
                rolls: this._serializeRolls(),
                songBonuses: this._serializeSongBonuses(),
                afkCharacterIds: RestAfkState.getAfkCharacterIds(),
                finishedUserIds: [...this._finishedUsers],
                activeShelter: this._activeShelter,
                rpPrompt: this._rpPrompt,
                songVolunteer: this._songVolunteer,
            });
            // Persist to world setting for session recovery
            this._saveShortRestState();
        }
        // Live sync: party roster actors (not only hasPlayerOwner) so GM-owned roster PCs
        // and spell slot changes still refresh Arcane Recovery / Natural Recovery.
        if (!this._actorHookId) {
            const partyHas = (actor) =>
                !!actor && getPartyActors().some((a) => a.id === actor.id);
            this._actorHookId = Hooks.on("updateActor", (actor) => {
                if (partyHas(actor)) this.render();
            });
            this._itemHookId = Hooks.on("updateItem", (item) => {
                if (partyHas(item.actor)) this.render();
            });
        }
        const out = await super.render(options);
        showAfkPanel();
        return out;
    }

    async close(options = {}) {
        // Unhook live-sync listeners
        if (this._actorHookId) {
            Hooks.off("updateActor", this._actorHookId);
            this._actorHookId = null;
        }
        if (this._itemHookId) {
            Hooks.off("updateItem", this._itemHookId);
            this._itemHookId = null;
        }

        if (this._isTerminating) {
            // Rest is ending (complete or abandon): wipe all state
            clearActiveShortRestApp();
            _removeGmShortRestIndicator();
            this._spellRecovery.clear();
            this._songBonusByActor.clear();
            this._songVolunteer = null;
            this._finishedUsers.clear();
            hideAfkPanelAfterRest();
        } else if (this._isGM) {
            // GM dismissed the window but the rest persists.
            // State already saved on last render. Show resume bar.
            clearActiveShortRestApp();
            _showGmShortRestIndicator();
            game.socket.emit(`module.${MODULE_ID}`, { type: "shortRestDismissed" });
        } else if (!this._isGM) {
            // Player dismissed the window. Show rejoin bar.
            notifyShortRestActive();
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

        const songTiming = game.settings.get(MODULE_ID, SONG_TIMING_KEY) ?? "endOfRest";
        const eligibleBards = HitDieModifiers.scanAllEligibleBards(partyActors);

        // Build character cards
        const characters = partyActors.map(a => {
            const hp = a.system?.attributes?.hp ?? {};
            const currentHp = Number(hp.value) || 0;
            const maxHp = hp.max ?? 0;

            const hdData = this._getHitDiceInfo(a);
            const rolls = this._rolls.get(a.id) ?? [];
            const totalHealed = rolls.reduce((sum, r) => sum + (Number(r.total) || 0), 0);
            const songBonusRecord = this._songBonusByActor.get(a.id);
            const songBonusTotal = songBonusRecord?.total ?? 0;

            // Build pip array
            const hdPips = [];
            for (let i = 0; i < hdData.max; i++) {
                hdPips.push({ filled: i < hdData.remaining });
            }

            // Song card uses the volunteered bard (if any)
            let songCard = null;
            if (this._songVolunteer?.songDie && rolls.length > 0) {
                if (songTiming === "endOfRest") {
                    songCard = {
                        kind: "pending_end",
                        isPendingEnd: true,
                        die: this._songVolunteer.songDie,
                        bardName: this._songVolunteer.bardName,
                    };
                } else if (songTiming === "withFirstHitDie" && songBonusTotal > 0 && songBonusRecord) {
                    songCard = {
                        kind: "applied_immediate",
                        isAppliedImmediate: true,
                        die: this._songVolunteer.songDie,
                        bardName: songBonusRecord.bardName || this._songVolunteer.bardName,
                        total: songBonusRecord.total,
                        formula: songBonusRecord.formula,
                    };
                }
            }

            // Roll log compression: show last 2 rolls + summary when > 3
            const rollsCompressed = rolls.length > 3;
            const rollsToShow = rollsCompressed ? rolls.slice(-2) : rolls;
            const rollsHidden = rollsCompressed ? rolls.length - 2 : 0;

            // Song of Rest volunteer eligibility
            const bardInfo = eligibleBards.find(b => b.actorId === a.id);
            const isEligibleBard = !!bardInfo;
            const canInteractSong = isEligibleBard && (this._isGM || a.isOwner);
            const hasVolunteeredSong = this._songVolunteer?.actorId === a.id;
            const songAlreadyClaimed = !!this._songVolunteer && !hasVolunteeredSong;

            const linkedId = game.user.character?.id ?? null;
            const isSelfCard = !this._isGM && (
                (linkedId ? linkedId === a.id : false)
                || (!linkedId && a.testUserPermission(game.user, "OWNER"))
            );

            const baseCharacter = {
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
                songBonusTotal,
                songCard,
                noHdLeft: hdData.remaining <= 0,
                isOwner: this._isGM || a.isOwner,
                conMod: a.system?.abilities?.con?.mod ?? 0,
                isAfk: RestAfkState.isAfk(a.id),
                isSelfCard,
                rollsCompressed,
                rollsToShow,
                rollsHidden,
                isEligibleBard,
                canVolunteerSong: canInteractSong && !songAlreadyClaimed,
                hasVolunteeredSong,
                songVolunteerLocked: songAlreadyClaimed,
                bardSongDie: bardInfo?.songDie ?? null,
            };

            const recoveryInfo = SpellSlotRecovery.detect(a);
            let spellRecovery = null;

            if (recoveryInfo.exhausted && recoveryInfo.featureName) {
                this._spellRecovery.delete(a.id);
                this._confirmedRecovery.delete(a.id);
                spellRecovery = {
                    actorId: a.id,
                    exhausted: true,
                    featureName: recoveryInfo.featureName,
                    maxBudget: recoveryInfo.maxBudget,
                    exhaustedExplain:
                        `${recoveryInfo.featureName} has no uses remaining until the next long rest. At your level the recovery cap is ${recoveryInfo.maxBudget} spell levels per use (when available).`,
                };
            } else if (!recoveryInfo.hasRecovery && !recoveryInfo.exhausted) {
                this._spellRecovery.delete(a.id);
                this._confirmedRecovery.delete(a.id);
            } else if (recoveryInfo.hasRecovery) {
                const recoverableSlots = SpellSlotRecovery.getRecoverableSlots(a, recoveryInfo.maxSlotLevel);
                if (recoverableSlots.length === 0) {
                    this._spellRecovery.delete(a.id);
                    this._confirmedRecovery.delete(a.id);
                    spellRecovery = {
                        actorId: a.id,
                        noRecoverableSlots: true,
                        featureName: recoveryInfo.featureName,
                        maxBudget: recoveryInfo.maxBudget,
                        maxSlotLevel: recoveryInfo.maxSlotLevel,
                        noSlotsExplain:
                            `No expended spell slots of levels 1–${recoveryInfo.maxSlotLevel} to recover (or all are full). ${recoveryInfo.featureName} still has uses if you need it later this long rest.`,
                    };
                } else {
                    const staleFlag = a.getFlag(MODULE_ID, SPELL_RECOVERY_FLAG);
                    if (staleFlag?.featureItemId && staleFlag.featureItemId !== recoveryInfo.featureItem?.id) {
                        void a.unsetFlag(MODULE_ID, SPELL_RECOVERY_FLAG).catch((err) => {
                            Logger.warn(`${MODULE_ID} | Failed to clear stale spell recovery flag:`, err);
                        });
                    }

                    if (!this._spellRecovery.has(a.id)) {
                        const selections = new Map();
                        const flag = a.getFlag(MODULE_ID, SPELL_RECOVERY_FLAG);
                        if (flag?.featureItemId === recoveryInfo.featureItem?.id && flag.selections?.length) {
                            for (const { level, count } of flag.selections) {
                                selections.set(level, count);
                            }
                        }
                        this._spellRecovery.set(a.id, {
                            featureName: recoveryInfo.featureName,
                            featureItem: recoveryInfo.featureItem,
                            maxBudget: recoveryInfo.maxBudget,
                            maxSlotLevel: recoveryInfo.maxSlotLevel,
                            classLevel: recoveryInfo.classLevel,
                            selections,
                            recoverableSlots,
                        });
                    } else {
                        const state = this._spellRecovery.get(a.id);
                        const slotSig = (slots) =>
                            (slots ?? []).map((s) => `${s.level}:${s.spent}`).join("|");
                        const prevSig = slotSig(state.recoverableSlots);
                        state.featureName = recoveryInfo.featureName;
                        state.featureItem = recoveryInfo.featureItem;
                        state.maxBudget = recoveryInfo.maxBudget;
                        state.maxSlotLevel = recoveryInfo.maxSlotLevel;
                        state.classLevel = recoveryInfo.classLevel;
                        state.recoverableSlots = recoverableSlots;
                        if (prevSig !== slotSig(recoverableSlots)) {
                            this._confirmedRecovery.delete(a.id);
                        }
                        for (const [lvl, cnt] of [...state.selections.entries()]) {
                            const sl = recoverableSlots.find(s => s.level === lvl);
                            if (!sl || cnt <= 0) state.selections.delete(lvl);
                            else if (cnt > sl.spent) state.selections.set(lvl, sl.spent);
                        }
                    }
                    const state = this._spellRecovery.get(a.id);
                    const currentSpend = [...state.selections.entries()]
                        .reduce((sum, [lvl, cnt]) => sum + (lvl * cnt), 0);
                    const canInteract = this._isGM || a.isOwner;

                    const confirmed = this._confirmedRecovery.has(a.id);

                    spellRecovery = {
                        actorId: a.id,
                        featureName: state.featureName,
                        maxBudget: state.maxBudget,
                        currentSpend,
                        budgetRemaining: state.maxBudget - currentSpend,
                        confirmed,
                        hasSelections: currentSpend > 0,
                        slots: recoverableSlots.map(s => ({
                            ...s,
                            selected: state.selections.get(s.level) ?? 0,
                            canAdd: canInteract && !confirmed
                                && (currentSpend + s.level) <= state.maxBudget
                                && (state.selections.get(s.level) ?? 0) < s.spent,
                            canRemove: canInteract && !confirmed && (state.selections.get(s.level) ?? 0) > 0,
                        })),
                    };
                }
            }

            return {
                ...baseCharacter,
                spellRecovery,
            };
        });

        // Split cards: GM sees all expanded; players see only self expanded, rest collapsed
        let expandedCards, collapsedCards;
        if (this._isGM) {
            expandedCards = characters;
            collapsedCards = [];
        } else {
            expandedCards = characters.filter(c => c.isSelfCard);
            collapsedCards = characters.filter(c => !c.isSelfCard);
        }

        const isRopeTrick = this._activeShelter === "rope_trick";

        // Shelter badge for display (selection happened in setup wizard)
        const shelterDef = SHORT_REST_SHELTERS.find(s => s.id === this._activeShelter)
            ?? SHORT_REST_SHELTERS.find(s => s.id === "none");
        const shelterBadge = {
            id: this._activeShelter,
            name: shelterDef?.name ?? "Open Air",
            icon: shelterDef?.icon ?? "fas fa-wind",
        };

        // Roster strip: avatar chips with AFK + readiness state
        const roster = partyActors.map(a => {
            const isAfk = RestAfkState.isAfk(a.id);
            const ownerUser = game.users.find(u => !u.isGM && u.active && a.testUserPermission(u, "OWNER"));
            const isFinished = ownerUser ? this._finishedUsers.has(ownerUser.id) : false;
            return {
                id: a.id,
                name: (a.name ?? "").split(" ")[0],
                fullName: a.name,
                img: a.img || "icons/svg/mystery-man.svg",
                isAfk,
                isFinished,
                isOwner: this._isGM || a.isOwner,
            };
        });

        return {
            isGM: this._isGM,
            characters,
            expandedCards,
            collapsedCards,
            shelterBadge,
            rpPrompt: this._rpPrompt,
            roster,
            shortRestFooter: {
                myFinished: this._finishedUsers.has(game.user.id),
            },
            allSpent: characters.every(c => c.isFullHp || c.noHdLeft || !c.isOwner),
            songOfRest: this._songVolunteer
                ? {
                    bardName: this._songVolunteer.bardName,
                    songDie: this._songVolunteer.songDie,
                    timingEnd: songTiming === "endOfRest",
                    timingImmediate: songTiming === "withFirstHitDie",
                }
                : null,
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
     * @param {Actor} actor
     * @param {object} state
     */
    static async #persistSpellRecoveryFlag(actor, state) {
        if (!state?.featureItem?.id) return;
        const selectionsArr = [...state.selections.entries()]
            .filter(([, cnt]) => cnt > 0)
            .map(([level, count]) => ({ level, count }));
        if (!selectionsArr.length) {
            await actor.unsetFlag(MODULE_ID, SPELL_RECOVERY_FLAG);
            return;
        }
        await actor.setFlag(MODULE_ID, SPELL_RECOVERY_FLAG, {
            featureItemId: state.featureItem.id,
            selections: selectionsArr,
        });
    }

    static async #onAddSpellSlot(event, target) {
        const actorId = target.dataset.actorId;
        const actor = game.actors.get(actorId);
        if (!actor) return;
        if (!this._isGM && !actor.isOwner) return;

        const state = this._spellRecovery.get(actorId);
        if (!state) return;

        const level = Number(target.dataset.level);
        const currentSpend = [...state.selections.entries()]
            .reduce((sum, [lvl, cnt]) => sum + (lvl * cnt), 0);
        const currentForLevel = state.selections.get(level) ?? 0;
        const slot = state.recoverableSlots.find(s => s.level === level);

        if ((currentSpend + level) > state.maxBudget) return;
        if (slot && currentForLevel >= slot.spent) return;

        state.selections.set(level, currentForLevel + 1);
        await ShortRestApp.#persistSpellRecoveryFlag(actor, state);
        this.render();
    }

    static async #onRemoveSpellSlot(event, target) {
        const actorId = target.dataset.actorId;
        const actor = game.actors.get(actorId);
        if (!actor) return;
        if (!this._isGM && !actor.isOwner) return;

        const state = this._spellRecovery.get(actorId);
        if (!state) return;

        const level = Number(target.dataset.level);
        const current = state.selections.get(level) ?? 0;
        if (current <= 0) return;

        state.selections.set(level, current - 1);
        if (state.selections.get(level) === 0) state.selections.delete(level);
        await ShortRestApp.#persistSpellRecoveryFlag(actor, state);
        this._confirmedRecovery.delete(actorId);
        this.render();
    }

    /**
     * Player confirms their spell recovery selections; locks the controls.
     */
    static async #onConfirmRecovery(event, target) {
        const actorId = target.dataset.actorId;
        const actor = game.actors.get(actorId);
        if (!actor) return;
        if (!this._isGM && !actor.isOwner) return;

        this._confirmedRecovery.add(actorId);
        this.render();
    }

    /**
     * Player un-confirms their spell recovery selections; unlocks the controls.
     */
    static async #onEditRecovery(event, target) {
        const actorId = target.dataset.actorId;
        const actor = game.actors.get(actorId);
        if (!actor) return;
        if (!this._isGM && !actor.isOwner) return;

        this._confirmedRecovery.delete(actorId);
        this.render();
    }

    static #onToggleShortRestFinished(event, target) {
        event.preventDefault?.();
        const uid = game.user.id;
        const next = !this._finishedUsers.has(uid);
        if (next) this._finishedUsers.add(uid);
        else this._finishedUsers.delete(uid);

        game.socket.emit(`module.${MODULE_ID}`, {
            type: "shortRestPlayerFinished",
            userId: uid,
            finished: next,
        });
        this.render();
    }

    static async #onVolunteerSong(event, target) {
        const actorId = target.dataset.actorId;
        const actor = game.actors.get(actorId);
        if (!actor) return;
        if (!this._isGM && !actor.isOwner) return;

        if (this._songVolunteer?.actorId === actorId) {
            this._songVolunteer = null;
        } else if (!this._songVolunteer) {
            const partyActors = getPartyActors();
            const bards = HitDieModifiers.scanAllEligibleBards(partyActors);
            const bardInfo = bards.find(b => b.actorId === actorId);
            if (!bardInfo) return;
            this._songVolunteer = { ...bardInfo };
        } else {
            return;
        }

        game.socket.emit(`module.${MODULE_ID}`, {
            type: "shortRestSongVolunteer",
            songVolunteer: this._songVolunteer,
        });
        if (this._isGM) this._saveShortRestState();
        this.render();
    }

    static #escapeChat(str) {
        const fn = globalThis.foundry?.utils?.escapeHTML;
        return fn ? fn(String(str ?? "")) : String(str ?? "");
    }

    /**
     * @param {string} bardName
     * @param {string} recipientName
     * @param {string} formula
     * @param {number} total
     */
    static #buildSongImmediateChat(bardName, recipientName, formula, total) {
        const b = ShortRestApp.#escapeChat(bardName);
        const r = ShortRestApp.#escapeChat(recipientName);
        const f = ShortRestApp.#escapeChat(formula);
        return `<div class="respite-song-of-rest respite-song-of-rest-card respite-chat-parchment"><div class="respite-song-title"><i class="fas fa-music"></i> Song of Rest</div><p><strong>${r}</strong> gains <strong>+${total} HP</strong> <span class="respite-song-meta">(${f})</span> from <em>${b}</em>’s performance (applied with this character’s first Hit Die this rest).</p></div>`;
    }

    /**
     * @param {string} bardName
     * @param {Array<{ name: string, formula: string, total: number }>} entries
     */
    static #buildSongEndRestSummaryChat(bardName, entries) {
        const b = ShortRestApp.#escapeChat(bardName);
        const rows = entries.map(e =>
            `<li><strong>${ShortRestApp.#escapeChat(e.name)}</strong>: ${ShortRestApp.#escapeChat(e.formula)}, <strong>+${e.total} HP</strong></li>`
        ).join("");
        return `<div class="respite-song-of-rest respite-song-of-rest-summary respite-chat-parchment"><div class="respite-song-title"><i class="fas fa-music"></i> Song of Rest: ${b}</div><p class="respite-song-lead">Each ally who spent at least one Hit Die during this short rest gains extra healing (one die each):</p><ul class="respite-song-list">${rows}</ul></div>`;
    }

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

        const modifiers = HitDieModifiers.scan(actor);
        const rawDie = rollTotal - conMod;
        const { adjustedTotal, annotations } = HitDieModifiers.modifyRoll(rawDie, conMod, modifiers);

        // Apply HP correction if modifiers changed the total
        if (adjustedTotal !== rollTotal) {
            const hpDiff = adjustedTotal - rollTotal;
            const hp = actor.system?.attributes?.hp;
            if (hp) {
                const newHp = Math.min((hp.value ?? 0) + hpDiff, hp.max ?? 0);
                await actor.update({ "system.attributes.hp.value": newHp });
            }
        }

        // Record the roll locally (final healing including modifiers)
        if (!this._rolls.has(actorId)) this._rolls.set(actorId, []);
        this._rolls.get(actorId).push({
            total: adjustedTotal,
            die: hdData.die,
            conMod,
            annotations: [...annotations],
        });

        const songTiming = game.settings.get(MODULE_ID, SONG_TIMING_KEY) ?? "endOfRest";
        /** @type {{ actorId: string, total: number, formula: string, bardName: string }|null} */
        let songBonusUpdate = null;

        if (songTiming === "withFirstHitDie" && this._rolls.get(actorId).length === 1 && this._songVolunteer?.songDie) {
            const songRoll = await HitDieModifiers.rollSongBonus(this._songVolunteer.songDie, this._songVolunteer.bardName);
            const hpNow = actor.system?.attributes?.hp;
            if (hpNow) {
                const newHp = Math.min((hpNow.value ?? 0) + songRoll.total, hpNow.max ?? 0);
                await actor.update({ "system.attributes.hp.value": newHp });
            }
            this._songBonusByActor.set(actorId, {
                total: songRoll.total,
                formula: songRoll.formula,
                bardName: this._songVolunteer.bardName,
            });
            songBonusUpdate = {
                actorId,
                total: songRoll.total,
                formula: songRoll.formula,
                bardName: this._songVolunteer.bardName,
            };
            try {
                await ChatMessage.create({
                    content: ShortRestApp.#buildSongImmediateChat(
                        this._songVolunteer.bardName,
                        actor.name,
                        songRoll.formula,
                        songRoll.total
                    ),
                    speaker: ChatMessage.getSpeaker({ actor }),
                });
            } catch (err) {
                Logger.warn(`${MODULE_ID} | Song of Rest chat message failed:`, err);
            }
        }

        // Broadcast to other clients
        game.socket.emit(`module.${MODULE_ID}`, {
            type: "shortRestHdSpent",
            actorId,
            rollTotal: adjustedTotal,
            die: hdData.die,
            conMod,
            annotations: [...annotations],
            ...(songBonusUpdate ? { songBonusUpdate } : {}),
        });

        this.render();
    }


    /**
     * GM completes the short rest. Calls actor.shortRest() for class feature recovery.
     */
    static async #onCompleteShortRest(event, target) {
        if (!this._isGM) return;

        const partyActorsPreCheck = getPartyActors();
        const afkCharNames = partyActorsPreCheck
            .filter(a => RestAfkState.isAfk(a.id))
            .map(a => a.name);
        const gmIsAfk = RestAfkState.isAfk("gm");
        if (afkCharNames.length > 0 || gmIsAfk) {
            const afkList = [...afkCharNames];
            if (gmIsAfk) afkList.unshift("GM");
            const confirmFn = game.ionrift?.library?.confirm ?? Dialog.confirm.bind(Dialog);
            const proceed = await confirmFn({
                title: "AFK Characters",
                content: `<p>The following are currently marked AFK:</p><ul>${afkList.map(n => `<li><strong>${n}</strong></li>`).join("")}</ul><p>They may miss the rest benefits. Complete anyway?</p>`,
                yesLabel: "Complete Anyway",
                noLabel: "Cancel",
                yesIcon: "fas fa-forward",
                noIcon: "fas fa-times",
                defaultYes: false,
            });
            if (!proceed) return;
        }

        // Warn GM if any players haven't marked themselves finished
        const unfinishedPlayers = game.users
            .filter(u => !u.isGM && u.active && !this._finishedUsers.has(u.id))
            .filter(u => partyActorsPreCheck.some(a => a.testUserPermission(u, "OWNER")));
        if (unfinishedPlayers.length > 0) {
            const names = unfinishedPlayers.map(u => u.name);
            const confirmFn = game.ionrift?.library?.confirm ?? Dialog.confirm.bind(Dialog);
            const proceed = await confirmFn({
                title: "Players Still Resting",
                content: `<p>The following players haven't finished resting:</p><ul>${names.map(n => `<li><strong>${n}</strong></li>`).join("")}</ul><p>Complete the short rest anyway?</p>`,
                yesLabel: "Complete Anyway",
                noLabel: "Wait",
                yesIcon: "fas fa-forward",
                noIcon: "fas fa-hourglass-half",
                defaultYes: false,
            });
            if (!proceed) return;
        }

        // Warn GM if any characters have unconfirmed spell recovery selections
        const unconfirmed = [];
        for (const [actorId, state] of this._spellRecovery) {
            const spend = [...state.selections.entries()].reduce((s, [l, c]) => s + l * c, 0);
            if (spend > 0 && !this._confirmedRecovery.has(actorId)) {
                const actor = game.actors.get(actorId);
                if (actor) unconfirmed.push(actor.name);
            }
        }
        if (unconfirmed.length > 0) {
            const confirmFn = game.ionrift?.library?.confirm ?? Dialog.confirm.bind(Dialog);
            const proceed = await confirmFn({
                title: "Unconfirmed Spell Recovery",
                content: `<p>The following characters have spell recovery selections that haven't been confirmed:</p><ul>${unconfirmed.map(n => `<li><strong>${n}</strong></li>`).join("")}</ul><p>Their selections will still be applied. Continue?</p>`,
                yesLabel: "Continue",
                noLabel: "Cancel",
                yesIcon: "fas fa-check",
                noIcon: "fas fa-times",
                defaultYes: false,
            });
            if (!proceed) return;
        }

        const partyActors = getPartyActors();

        const songTiming = game.settings.get(MODULE_ID, SONG_TIMING_KEY) ?? "endOfRest";
        const anyHdSpent = [...this._rolls.values()].some(rolls => rolls.length > 0);
        if (songTiming === "endOfRest" && anyHdSpent && this._songVolunteer?.songDie) {
            const entries = [];
            for (const actor of partyActors) {
                if (!this._rolls.has(actor.id) || this._rolls.get(actor.id).length === 0) continue;
                const songRoll = await HitDieModifiers.rollSongBonus(this._songVolunteer.songDie, this._songVolunteer.bardName);
                const hp = actor.system?.attributes?.hp;
                if (hp) {
                    const newHp = Math.min((hp.value ?? 0) + songRoll.total, hp.max ?? 0);
                    await actor.update({ "system.attributes.hp.value": newHp });
                }
                entries.push({ name: actor.name, formula: songRoll.formula, total: songRoll.total });
            }
            if (entries.length) {
                try {
                    await ChatMessage.create({
                        content: ShortRestApp.#buildSongEndRestSummaryChat(this._songVolunteer.bardName, entries),
                        speaker: { alias: this._songVolunteer.bardName },
                    });
                } catch (err) {
                    Logger.warn(`${MODULE_ID} | Song of Rest chat message failed:`, err);
                }
            }
        }

        // Spell slot recovery
        for (const actor of partyActors) {
            const pending = actor.getFlag(MODULE_ID, SPELL_RECOVERY_FLAG);
            if (!pending?.selections?.length) continue;

            const featureItem = actor.items.get(pending.featureItemId);
            if (!featureItem) {
                await actor.unsetFlag(MODULE_ID, SPELL_RECOVERY_FLAG);
                this._spellRecovery.delete(actor.id);
                continue;
            }

            const state = this._spellRecovery.get(actor.id);
            const featureLabel = state?.featureName ?? featureItem.name;
            const maxBudget = state?.maxBudget ?? SpellSlotRecovery.detect(actor).maxBudget;

            const result = await SpellSlotRecovery.apply(actor, featureItem, pending.selections);

            if (result.slotsRecovered.length > 0) {
                const slotDesc = result.slotsRecovered.map(s => `${s.count}× Level ${s.level}`).join(", ");
                try {
                    await ChatMessage.create({
                        content: `<div class="respite-spell-recovery respite-chat-parchment"><i class="fas fa-hat-wizard"></i> <strong>${actor.name}</strong> uses <em>${featureLabel}</em>: recovered ${slotDesc} (${result.totalLevels}/${maxBudget} levels used).</div>`,
                        speaker: ChatMessage.getSpeaker({ actor }),
                        whisper: game.users.filter(u => u.isGM).map(u => u.id),
                    });
                } catch (err) {
                    Logger.warn(`${MODULE_ID} | Spell recovery chat message failed:`, err);
                }
            }

            await actor.unsetFlag(MODULE_ID, SPELL_RECOVERY_FLAG);
            this._spellRecovery.delete(actor.id);
        }

        for (const actor of partyActors) {
            try {
                await actor.shortRest({ dialog: false, chat: true });
            } catch (e) {
                Logger.warn(`Failed shortRest for ${actor.name}:`, e);
            }
        }

        await this._clearShortRestState();
        game.socket.emit(`module.${MODULE_ID}`, { type: "shortRestComplete" });
        ui.notifications.info("Short rest complete. Class features recovered.");
        this._isTerminating = true;
        this.close();
    }

    /**
     * GM abandons the short rest without completing it.
     */
    static async #onAbandonShortRest(event, target) {
        if (!this._isGM) return;

        const confirmFn = game.ionrift?.library?.confirm ?? Dialog.confirm.bind(Dialog);
        const proceed = await confirmFn({
            title: "Abandon Short Rest",
            content: `<p>Abandon this short rest? HP gained from Hit Dice already spent will remain, but class feature recovery will not be applied.</p>`,
            yesLabel: "Abandon",
            noLabel: "Cancel",
            yesIcon: "fas fa-times",
            noIcon: "fas fa-undo",
            defaultYes: false,
        });
        if (!proceed) return;

        await this._clearShortRestState();
        game.socket.emit(`module.${MODULE_ID}`, { type: "shortRestAbandoned" });
        ui.notifications.info("Short rest abandoned.");
        this._isTerminating = true;
        this.close();
    }

    // ── Socket receivers ───────────────────────────────────────

    /**
     * Called on GM side when a player spends a hit die.
     */
    receiveHdSpent(data) {
        const { actorId, rollTotal, die, conMod, annotations, songBonusUpdate } = data;
        if (!this._rolls.has(actorId)) this._rolls.set(actorId, []);
        const entry = { total: rollTotal, die, conMod };
        if (annotations?.length) entry.annotations = [...annotations];
        this._rolls.get(actorId).push(entry);
        if (songBonusUpdate?.actorId) {
            this._songBonusByActor.set(songBonusUpdate.actorId, {
                total: Number(songBonusUpdate.total) || 0,
                formula: String(songBonusUpdate.formula ?? ""),
                bardName: String(songBonusUpdate.bardName ?? ""),
            });
        }
        this.render();
    }

    /**
     * Called on player side when GM starts (or re-broadcasts) a short rest.
     */
    receiveStarted(data) {
        if (data.rolls) this._rolls = this._deserializeRolls(data.rolls);
        if (data.songBonuses !== undefined) {
            this._songBonusByActor = this._deserializeSongBonuses(data.songBonuses);
        }
        if (data.afkCharacterIds !== undefined) {
            RestAfkState.replaceAll(data.afkCharacterIds);
        }
        if (data.finishedUserIds !== undefined) {
            this._finishedUsers = new Set(data.finishedUserIds);
        }
        if (data.activeShelter) this._activeShelter = data.activeShelter;
        if (data.rpPrompt) this._rpPrompt = data.rpPrompt;
        if (data.songVolunteer !== undefined) this._songVolunteer = data.songVolunteer ?? null;
        this.render({ force: true });
    }

    /**
     * @param {{ songVolunteer: object|null }} data
     */
    receiveSongVolunteer(data) {
        this._songVolunteer = data.songVolunteer ?? null;
        this.render();
    }

    /**
     * @param {{ userId?: string, finished?: boolean }} data
     */
    receivePlayerFinished(data) {
        if (!data?.userId) return;
        if (data.finished) this._finishedUsers.add(data.userId);
        else this._finishedUsers.delete(data.userId);
        this.render();
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

    _serializeSongBonuses() {
        const obj = {};
        for (const [key, val] of this._songBonusByActor) obj[key] = val;
        return obj;
    }

    /**
     * @param {Record<string, { total: number, formula: string, bardName: string }>} obj
     */
    _deserializeSongBonuses(obj) {
        const map = new Map();
        if (!obj || typeof obj !== "object") return map;
        for (const [key, val] of Object.entries(obj)) {
            if (!val || typeof val !== "object") continue;
            map.set(key, {
                total: Number(val.total) || 0,
                formula: String(val.formula ?? ""),
                bardName: String(val.bardName ?? ""),
            });
        }
        return map;
    }

    // ── State persistence ──────────────────────────────────────

    /**
     * Persists current short rest state to a world setting.
     * GM only. Called on render and after every state-mutating action.
     */
    async _saveShortRestState() {
        if (!game.user.isGM) return;
        const state = {
            rolls: this._serializeRolls(),
            songBonuses: this._serializeSongBonuses(),
            afkCharacterIds: RestAfkState.getAfkCharacterIds(),
            finishedUserIds: [...this._finishedUsers],
            activeShelter: this._activeShelter,
            rpPrompt: this._rpPrompt,
            songVolunteer: this._songVolunteer,
            confirmedRecovery: [...this._confirmedRecovery],
            timestamp: Date.now(),
        };
        try {
            await game.settings.set(MODULE_ID, "activeShortRest", state);
        } catch (e) {
            console.warn(`${MODULE_ID} | Failed to save short rest state:`, e);
        }
    }

    /**
     * Restores short rest state from the world setting.
     * @returns {boolean} True if state was found and restored.
     */
    _loadShortRestState() {
        const state = game.settings.get(MODULE_ID, "activeShortRest");
        if (!state?.timestamp) return false;

        if (state.rolls) this._rolls = this._deserializeRolls(state.rolls);
        if (state.songBonuses) this._songBonusByActor = this._deserializeSongBonuses(state.songBonuses);
        if (state.afkCharacterIds) RestAfkState.replaceAll(state.afkCharacterIds);
        if (state.finishedUserIds) this._finishedUsers = new Set(state.finishedUserIds);
        if (state.activeShelter) this._activeShelter = state.activeShelter;
        if (state.rpPrompt) this._rpPrompt = state.rpPrompt;
        if (state.songVolunteer !== undefined) this._songVolunteer = state.songVolunteer ?? null;
        if (state.confirmedRecovery) this._confirmedRecovery = new Set(state.confirmedRecovery);

        return true;
    }

    /**
     * Clears persisted short rest state. Called on completion or abandonment.
     */
    async _clearShortRestState() {
        if (!game.user.isGM) return;
        try {
            await game.settings.set(MODULE_ID, "activeShortRest", {});
        } catch (e) {
            // Setting may not be registered yet
        }
    }
}
