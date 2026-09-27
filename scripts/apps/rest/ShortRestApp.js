import { Logger } from "../../utils/Logger.js";
import { HitDieModifiers } from "../../services/rest/recovery/HitDieModifiers.js";
import { HitDiceService } from "../../services/rest/recovery/HitDiceService.js";
import { SpellSlotRecovery } from "../../services/rest/recovery/SpellSlotRecovery.js";
import { confirmAbandonRest } from "./confirmAbandonRest.js";
import { MODULE_ID } from "../../data/moduleId.js";
import { isWorkbenchIdentifyUiEnabled } from "../../data/RestConstants.js";
import {
    registerActiveShortRestApp,
    clearActiveShortRestApp,
    _showGmShortRestIndicator,
    _removeGmShortRestIndicator,
    notifyShortRestActive,
    showAfkPanel,
    hideAfkPanelAfterRest,
    setRespiteFlowActive
} from "../../module.js";
import { getPartyActors } from "../../services/party/partyActors.js";
import { CalendarHandler } from "../../services/rest/session/CalendarHandler.js";
import { SHORT_REST_STATE_SCHEMA } from "../../services/rest/session/restSessionSchemas.js";
import {
    registerRestSessionApp,
    unregisterRestSessionApp,
    emitRestSessionStarted,
    emitRestSessionSync,
    emitRestSessionDelta,
    emitRestSessionResolved,
    emitRestSessionAbandoned,
    emitRestSessionDismissed,
    userControlsActor
} from "../../services/rest/session/RestSessionSync.js";
import * as RestAfkState from "../../services/rest/session/RestAfkState.js";
import { pushAllStateToAdapters } from "../../services/afk/AfkBridgeService.js";

/** World setting: when Song of Rest HP is applied. */
const SONG_TIMING_KEY = "songOfRestTiming";
/** World setting: homebrew max-face Hit Dice on short rests. */
const MAX_VALUE_HD_KEY = "maxValueHitDice";
/** Actor flag: pending Arcane/Natural Recovery selections for GM apply on rest complete. */
const SPELL_RECOVERY_FLAG = "spellRecoveryPending";
import { ImageResolver } from "../../utils/ImageResolver.js";
import { WorkbenchDelegate } from "../delegates/crafting/WorkbenchDelegate.js";
import {
    collectPartyIdentifyEmbedData,
    DetectMagicDelegate,
    purgeDetectMagicRestArtifacts,
    spawnDetectMagicCastRipple
} from "../delegates/crafting/DetectMagicDelegate.js";
import { getShortRestRechargeLabels } from "../../services/rest/recovery/ShortRestRecharge.js";
import { RestPresentationHelper } from "../../utils/RestPresentationHelper.js";
import { scanEligibleChefs } from "../../services/meal/buffs/ChefFeat.js";
import { setNativeShortRestUnsuppressed } from "../../services/rest/flow/NativeRestPass.js";
import { BaseShortRestApp } from "./BaseShortRestApp.js";

/** All shelter options for short rest. "none" is always shown. */
const SHORT_REST_SHELTERS = [
    { id: "none",      name: "Open Air",   icon: "fas fa-wind",       hint: "No shelter. Standard short rest." },
    { id: "rope_trick", name: "Rope Trick", icon: "fas fa-hat-wizard", hint: "Hidden extradimensional space. Safe short rest.",
      altNames: ["rope trick"] },
    { id: "tiny_hut",  name: "Tiny Hut",   icon: "fas fa-igloo",      hint: "Impenetrable force dome. Safe rest.",
      altNames: ["leomund's tiny hut", "tiny hut"] },
];

export class ShortRestApp extends BaseShortRestApp {

    static DEFAULT_OPTIONS = {
        id: "ionrift-short-rest",
        classes: ["ionrift-window", "glass-ui", "short-rest-app"],
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
            spendHitDie:            ShortRestApp.#onSpendHitDie,
            completeShortRest:    ShortRestApp.#onCompleteShortRest,
            abandonShortRest:     ShortRestApp.#onAbandonShortRest,
            addSpellSlot:         ShortRestApp.#onAddSpellSlot,
            removeSpellSlot:      ShortRestApp.#onRemoveSpellSlot,
            confirmRecovery:      ShortRestApp.#onConfirmRecovery,
            editRecovery:         ShortRestApp.#onEditRecovery,
            volunteerSong:             ShortRestApp.#onVolunteerSong,
            volunteerChef:             ShortRestApp.#onVolunteerChefMeal,
            volunteerChefMeal:         ShortRestApp.#onVolunteerChefMeal,
            optOutChef:                ShortRestApp.#onOptOutChef,
            claimChefTreat:            ShortRestApp.#onClaimChefTreat,
            claimChefTreatFromBadge:   ShortRestApp.#onClaimChefTreatFromBadge,
            claimChefFromBadge:        ShortRestApp.#onClaimChefTreatFromBadge,
            toggleShortRestFinished:   ShortRestApp.#onToggleShortRestFinished,
            togglePatrolCheck:         ShortRestApp.#onTogglePatrolCheck,
            adjustShortRestDc:         ShortRestApp.#onAdjustShortRestDc,
            switchShortRestTab:        ShortRestApp.#onSwitchTab,
            selectRosterCharacter:     ShortRestApp.#onSelectRosterCharacter,
            clearSelectedCharacter:    ShortRestApp.#onClearSelectedCharacter,
            selectWorkbenchRosterActor: ShortRestApp.#onSelectWorkbenchRosterActor,
            stationDetectMagicScan:    ShortRestApp.#onStationDetectMagicScan,
            stationIdentifyScannedItem:  ShortRestApp.#onStationIdentifyScannedItem,
            submitWorkbenchIdentify:   ShortRestApp.#onSubmitWorkbenchIdentify,
            workbenchIdentifyRemovePotion: ShortRestApp.#onWorkbenchIdentifyRemovePotion,
            dismissWorkbenchIdentifyAck:   ShortRestApp.#onDismissWorkbenchIdentifyAck,
            finalizeShortRestRecovery: ShortRestApp.#onFinalizeShortRestRecovery,
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

        /**
         * actorId -> Song of Rest bonus already applied this rest ("with first Hit Die" mode).
         * @type {Map<string, { total: number, formula: string, bardName: string }>}
         */
        this._songBonusByActor = new Map();

        /** Bard who volunteered Song of Rest. Null until a bard player offers.
         * @type {{ actorId: string, bardName: string, bardLevel: number, songDie: string }|null} */
        this._songVolunteer = null;

        /** Chef who volunteered Replenishing Meal for this short rest. */
        this._chefVolunteer = null;
        /** How many eaters have received the Chef meal +1d8 this rest. */
        this._chefMealServedCount = 0;

        /**
         * actorId -> Chef meal +1d8 already applied with an HD spend this rest.
         * @type {Map<string, { total: number, formula: string, chefName: string }>}
         */
        this._chefMealBonusByActor = new Map();

        /** User IDs who signalled they are done with short rest actions (synced). */
        this._finishedUsers = new Set();

        /**
         * True when the rest is being completed or abandoned (cleanup path).
         * False when the window is merely being dismissed (preserves state).
         */
        this._isTerminating = false;
        RestAfkState.clear();

        /** Local mirror of RestAfkState for serialization and test inspection. */
        this._afkCharacters = new Set();

        /** @type {"recovery"|"workbench"} */
        this._activeTab = "recovery";
        /** @type {string|null} */
        this._workbenchFocusActorId = null;

        this._workbenchIdentifyStaging = new Map();
        this._workbenchIdentifyAcknowledge = new Map();
        this._workbenchFocusUsed = new Set();
        this._magicScanResults = null;
        this._magicScanComplete = false;

        this._workbench = new WorkbenchDelegate(this);
        this._detectMagic = new DetectMagicDelegate(this);

        /** @type {number|null} */
        this._workbenchHookId = null;

        /** True after song and spell recovery are applied, before native short rest finishes. */
        this._completionPhase = false;
        /** @type {Array<{ actorId: string, name: string, line: string }>|null} */
        this._completionSummaryLines = null;
        /** Prevents a second complete from running native short rest twice. */
        this._finalizeShortRestBusy = false;
        /** Covers the confirm dialogs before native short rest starts. */
        this._completeShortRestBusy = false;
        /** First GM render opens player windows; later renders only sync state. */
        this._sessionAnnounced = false;
        /** Optional short-rest encounter check. Starts at DC 6. Result stays with the GM. */
        this._patrolCheckEnabled = false;
        this._encounterDc = 6;
    }

    async render(options = {}) {
        registerRestSessionApp("shortrest", this);
        if (this._isGM) {
            registerActiveShortRestApp(this);
            if (!this._completionPhase) {
                const snapshot = this._exportSnapshot();
                if (!this._sessionAnnounced) {
                    this._sessionAnnounced = true;
                    emitRestSessionStarted("shortrest", snapshot);
                } else {
                    emitRestSessionSync("shortrest", snapshot);
                }
                void this._saveSessionState();
            }
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
        if (this._isGM && !this._workbenchHookId) {
            this._workbenchHookId = Hooks.on(
                `${MODULE_ID}.workbenchIdentifyStagingTouched`,
                () => this._onWorkbenchStagingTouchedFromHook()
            );
        }
        queueMicrotask(() => {
            if (this._activeTab === "workbench" && this._workbench && this.element) {
                this._workbench.bindDragDrop(this.element);
            }
        });
        showAfkPanel();
        return out;
    }

    async close(options = {}) {
        if (options.abandoned || options.resolved) this._isTerminating = true;
        // A GM dismiss keeps the session registered so a rejoin still gets a snapshot.
        if (this._isTerminating || !this._isGM) unregisterRestSessionApp("shortrest");
        // Unhook live-sync listeners
        if (this._actorHookId) {
            Hooks.off("updateActor", this._actorHookId);
            this._actorHookId = null;
        }
        if (this._itemHookId) {
            Hooks.off("updateItem", this._itemHookId);
            this._itemHookId = null;
        }
        if (this._workbenchHookId) {
            Hooks.off(`${MODULE_ID}.workbenchIdentifyStagingTouched`, this._workbenchHookId);
            this._workbenchHookId = null;
        }

        if (this._isTerminating) {
            // Rest is ending (complete or abandon): wipe all state
            clearActiveShortRestApp();
            _removeGmShortRestIndicator();
            this._spellRecovery.clear();
            this._songBonusByActor.clear();
            this._songVolunteer = null;
            this._chefVolunteer = null;
            this._chefMealServedCount = 0;
            this._chefMealBonusByActor.clear();
            this._finishedUsers.clear();
            this._workbenchIdentifyStaging?.clear();
            this._workbenchIdentifyAcknowledge?.clear();
            this._workbenchIdentifySubmitPending?.clear();
            this._workbenchFocusUsed?.clear();
            this._magicScanResults = null;
            this._magicScanComplete = false;
            this._activeTab = "recovery";
            this._workbenchFocusActorId = null;
            hideAfkPanelAfterRest();
            if (!this._isGM && options.abandoned) {
                ui.notifications.info("The GM has abandoned the short rest.");
            }
            if (!this._isGM && options.resolved) {
                ui.notifications.info("Short rest complete. Class features recovered.");
            }
        } else if (this._isGM) {
            // GM dismissed the window but the rest persists.
            // State already saved on last render. Show resume bar.
            clearActiveShortRestApp();
            _showGmShortRestIndicator();
            emitRestSessionDismissed("shortrest");
        } else if (!this._isGM) {
            // Player dismissed the window. Show rejoin bar.
            notifyShortRestActive();
        }

        return super.close(options);
    }

    _onWorkbenchStagingTouchedFromHook() {
        if (game.user.isGM) {
            void this._saveSessionState();
            this._broadcastSync();
            return;
        }
        emitRestSessionDelta("shortrest", "WORKBENCH_STAGING", {
            userId: game.user.id,
            staging: Array.from(this._workbenchIdentifyStaging?.entries() ?? [])
        });
    }

    applyWorkbenchStagingFromPlayer(data) {
        const uid = data.userId;
        const user = game.users.get(uid);
        if (!user) return;
        for (const [actorId, st] of (data.staging ?? [])) {
            const a = game.actors.get(actorId);
            if (!a) continue;
            if (!a.testUserPermission(user, "OWNER")) continue;
            this._workbench.setStaging(actorId, {
                gearItemId: st?.gearItemId ?? null,
                gearActorId: st?.gearActorId ?? null,
                potionItemId: st?.potionItemId ?? null,
            });
        }
        if (data.workbenchFocusActorId) {
            this._workbenchFocusActorId = data.workbenchFocusActorId;
        }
        void this._saveSessionState();
        this._broadcastSync();
        if (this.rendered) void this.render();
    }

    
    applyWorkbenchStateFromHost(data) {
        this._workbenchIdentifyStaging = new Map(data.workbenchStaging ?? []);
        this._workbenchIdentifyAcknowledge = new Map(data.workbenchAck ?? []);
        this._magicScanResults = data.magicScanResults ?? null;
        this._magicScanComplete = !!data.magicScanComplete;
        if (data.workbenchFocusActorId !== undefined) {
            this._workbenchFocusActorId = data.workbenchFocusActorId;
        }
    }

    getStationIdentifyEmbedContext(options = {}) {
        return collectPartyIdentifyEmbedData(getPartyActors(), options);
    }

    getWorkbenchIdentifyDragContext(actorId) {
        return this._workbench.getDragContext(actorId, collectPartyIdentifyEmbedData, getPartyActors);
    }

    dismissWorkbenchIdentifyAcknowledgement(actorId) {
        this._workbench.dismissAcknowledgement(actorId);
    }

    removeWorkbenchIdentifyPotionFromStation(actorId, itemId) {
        this._workbench.removePotionFromStation(actorId, itemId);
    }

    async submitWorkbenchIdentifyFromStation(actorId) {
        await this._workbench.submitFromStation(actorId);
    }

    /**
     * Actor whose workbench identify UI and staging apply for the current user.
     * GM uses roster focus; players use linked character or first owned party actor.
     * @returns {string|null}
     */
    _resolveWorkbenchActorIdForEmbed() {
        const party = getPartyActors();
        if (!party.length) return null;
        if (game.user?.isGM) {
            const id = this._workbenchFocusActorId;
            if (id && party.some((a) => a.id === id)) return id;
            return party[0].id;
        }
        const linkedId = game.user?.character?.id ?? null;
        if (linkedId) {
            const linked = party.find((a) => a.id === linkedId);
            if (linked?.isOwner) return linked.id;
        }
        const owned = party.find((a) => a.isOwner);
        if (owned) return owned.id;
        return party[0].id;
    }

    _getWorkbenchEmbedContext() {
        const actorId = this._resolveWorkbenchActorIdForEmbed();
        return this._workbench.buildEmbedContext(actorId, getPartyActors);
    }

    async _prepareContext(options) {
        const partyActors = getPartyActors();

        if (this._isGM && partyActors.length) {
            const valid = this._workbenchFocusActorId
                && partyActors.some((a) => a.id === this._workbenchFocusActorId);
            if (!valid) {
                this._workbenchFocusActorId = partyActors[0].id;
            }
        }

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
        const eligibleChefs = scanEligibleChefs(partyActors);

        const characters = partyActors.map(a => {
            const hp = a.system?.attributes?.hp ?? {};
            const currentHp = Number(hp.value) || 0;
            const maxHp = hp.max ?? 0;
            const hpPercent = maxHp > 0 ? Math.clamp(Math.round((currentHp / maxHp) * 100), 0, 100) : 100;

            const hdData = this._getHitDiceInfo(a);
            const rolls = this._rolls.get(a.id) ?? [];
            const totalHealed = rolls.reduce((sum, r) => sum + (Number(r.total) || 0), 0);
            const songBonusRecord = this._songBonusByActor.get(a.id);
            const songBonusTotal = songBonusRecord?.total ?? 0;
            const chefMealRecord = this._chefMealBonusByActor.get(a.id);
            const chefMealTotal = chefMealRecord?.total ?? 0;
            const hasClaimedChefTreat = this._chefMealBonusByActor.has(a.id);

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

            const chefInfo = eligibleChefs.find(c => c.actorId === a.id);
            const isEligibleChef = !!chefInfo;
            const canInteractChef = isEligibleChef && (this._isGM || a.isOwner);
            const hasVolunteeredChef = this._chefVolunteer?.actorId === a.id;
            const chefAlreadyClaimed = !!this._chefVolunteer && !hasVolunteeredChef;
            const chefMealsRemaining = this._chefVolunteer
                ? Math.max(0, this._chefVolunteer.mealCapacity - this._chefMealServedCount)
                : 0;
            const canClaimChefTreat = !hasClaimedChefTreat && !!this._chefVolunteer && chefMealsRemaining > 0 && (this._isGM || a.isOwner);

            // Parity with BaseShortRestApp: hero accent follows character
            // ownership, not GM state. See Rest UI Reunification F3 (short).
            const linkedId = a.prototypeToken?.actorLink ? a.id : null;
            const isSelfCard = Boolean(
                (game.user.character && (game.user.character.id === a.id
                    || (linkedId && game.user.character.id === linkedId)))
                || (!linkedId && a.testUserPermission(game.user, "OWNER"))
            );

            const pres = RestPresentationHelper.getActorPresentation(a);
            const isReady = ShortRestApp.#isCharacterReady.call(this, a);

            const baseCharacter = {
                id: a.id,
                name: a.name,
                img: a.img || "icons/svg/mystery-man.svg",
                initial: pres.initial,
                subtext: pres.subtext,
                themeGradient: pres.themeGradient,
                themeBorder: pres.themeBorder,
                currentHp,
                hpValue: currentHp,
                maxHp,
                hpMax: maxHp,
                hpPercent,
                isFullHp: currentHp >= maxHp,
                hdRemaining: hdData.remaining,
                hdMax: hdData.max,
                hdDie: hdData.die,
                hdPips,
                rolls,
                totalHealed,
                songBonusTotal,
                chefMealTotal,
                chefMealRecord,
                hasClaimedChefTreat,
                canClaimChefTreat,
                songCard,
                noHdLeft: hdData.remaining <= 0,
                isOwner: this._isGM || a.isOwner,
                isReady,
                conMod: a.system?.abilities?.con?.mod ?? 0,
                isAfk: RestAfkState.isAfk(a.id),
                isSelfCard,
                rollsCompressed,
                rollsToShow,
                rollsHidden,
                isEligibleBard,
                canInteractSong,
                canVolunteerSong: canInteractSong && !songAlreadyClaimed,
                hasVolunteeredSong,
                songVolunteerLocked: songAlreadyClaimed,
                bardSongDie: bardInfo?.songDie ?? null,
                isEligibleChef,
                canInteractChef,
                canVolunteerChef: canInteractChef && !chefAlreadyClaimed,
                hasVolunteeredChef,
                chefVolunteerLocked: chefAlreadyClaimed,
                chefMealCapacity: chefInfo?.mealCapacity ?? null,
                chefMealsRemaining,
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
                            `No expended spell slots of levels 1-${recoveryInfo.maxSlotLevel} to recover (or all are full). ${recoveryInfo.featureName} still has uses if you need it later this long rest.`,
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

            const srRechargeBadges = getShortRestRechargeLabels(a);

            const hasFeatures = Boolean(
                baseCharacter.isEligibleBard
                || baseCharacter.isEligibleChef
                || spellRecovery
                || (srRechargeBadges && srRechargeBadges.length)
            );
            const canTriggerFeatures = Boolean(
                baseCharacter.canVolunteerSong
                || baseCharacter.canVolunteerChef
                || (spellRecovery && !spellRecovery.exhausted && !spellRecovery.noRecoverableSlots)
            );

            return {
                ...baseCharacter,
                spellRecovery,
                srRechargeBadges,
                hasFeatures,
                canTriggerFeatures,
            };
        });

        const isGmNeutralView = this._isGM && !this._selectedCharacterId;
        const selectedId = this._selectedCharacterId || (!this._isGM ? (partyActors.find(a => a.isOwner)?.id ?? partyActors[0]?.id) : null);
        this._selectedCharacterId = this._selectedCharacterId ?? null;

        const heroCharacter = selectedId ? (characters.find(c => c.id === selectedId) || null) : null;
        const companionCharacters = heroCharacter ? characters.filter(c => c.id !== heroCharacter.id) : [];
        const expandedCards = heroCharacter ? [heroCharacter] : characters;
        const collapsedCards = companionCharacters;

        const readyCount = characters.filter(c => c.isReady).length;
        const totalPartyCount = characters.length;
        const allCharactersReady = totalPartyCount > 0 && readyCount === totalPartyCount;
        const waitingNames = characters.filter(c => !c.isReady && !c.isAfk).map(c => c.name);
        const canCompleteShortRest = waitingNames.length === 0;
        const completeBlockedHint = waitingNames.length
            ? `Waiting on ${waitingNames.join(", ")}.`
            : "";

        const isRopeTrick = this._activeShelter === "rope_trick";

        // Shelter badge for display (selection happened in setup wizard; open air is assumed and omitted)
        const shelterDef = SHORT_REST_SHELTERS.find(s => s.id === this._activeShelter)
            ?? SHORT_REST_SHELTERS.find(s => s.id === "none");
        const shelterBadge = (this._activeShelter && this._activeShelter !== "none") ? {
            id: this._activeShelter,
            name: shelterDef?.name ?? "Open Air",
            icon: shelterDef?.icon ?? "fas fa-wind",
        } : null;

        const workbenchIdentifyUiEnabled = isWorkbenchIdentifyUiEnabled();
        if (!workbenchIdentifyUiEnabled && this._activeTab === "workbench") {
            this._activeTab = "recovery";
        }
        const gmWorkbenchRosterPick = this._isGM && this._activeTab === "workbench";
        const roster = RestPresentationHelper.getPartyRoster(partyActors, {
            selectedCharacterId: selectedId,
            finishedUserIds: this._finishedUsers,
            isGM: this._isGM
        });

        const rawCompletionLines = this._completionSummaryLines ?? [];
        const completionPhase = !!this._completionPhase;
        const completionSummaryForUser = completionPhase
            ? ShortRestApp.#completionRowsForUser(this._isGM, rawCompletionLines)
            : [];
        const completionSummaryEmpty = completionPhase && !this._isGM && completionSummaryForUser.length === 0;

        return {
            isGM: this._isGM,
            isGmNeutralView,
            readyCount,
            totalPartyCount,
            allCharactersReady,
            canCompleteShortRest,
            completeBlockedHint,
            characters,
            heroCharacter,
            companionCharacters,
            expandedCards,
            collapsedCards,
            shelterBadge,
            roster,
            partyRoster: RestPresentationHelper.getPartyRosterPills(partyActors, { finishedActorIds: this._finishedUsers }),
            activeTab: this._activeTab,
            workbenchIdentifyUiEnabled,
            gmWorkbenchRosterPick,
            workbenchEmbed: workbenchIdentifyUiEnabled ? this._getWorkbenchEmbedContext() : null,
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
            chefReplenishing: this._chefVolunteer
                ? {
                    chefName: this._chefVolunteer.chefName,
                    mealCapacity: this._chefVolunteer.mealCapacity,
                    mealsRemaining: Math.max(0, this._chefVolunteer.mealCapacity - this._chefMealServedCount),
                    hasRemaining: (this._chefVolunteer.mealCapacity - this._chefMealServedCount) > 0,
                }
                : null,
            chefMealsRemaining: this._chefVolunteer
                ? Math.max(0, this._chefVolunteer.mealCapacity - this._chefMealServedCount)
                : 0,
            ...ImageResolver.resolveRestBannerContext("short-rest", isRopeTrick ? "rope_trick" : "camp"),
            ...RestPresentationHelper.resolveRestHeaderContext({
                type: "short",
                terrainTag: "forest",
                terrainLabel: "Forest",
                phase: completionPhase ? "completion" : "recovery",
                abandonAction: "abandonShortRest",
                isGM: this._isGM
            }),
            completionPhase,
            patrolCheckEnabled: Boolean(this._patrolCheckEnabled),
            encounterDcStepper: {
                dc: this._encounterDc ?? 6,
                adjustAction: "adjustShortRestDc",
                showArm: true,
                armed: Boolean(this._patrolCheckEnabled),
                armAction: "togglePatrolCheck",
                tooltip: "Check the box to roll 1d20 against this DC when the short rest completes. A 1, or a roll at least 5 under the DC, stops the rest. Any other roll under the DC still completes it. The result stays with the GM."
            },
            completionSummaryForUser,
            completionSummaryEmpty,
        };
    }

    /**
     * Extracts Hit Dice info from a DnD5e actor.
     * Derives all data from class items (the source of truth in DnD5e v4/v5).
     * Falls back to system.attributes.hd for older versions.
     */
    _getHitDiceInfo(actor) {
        return HitDiceService.getHitDiceInfo(actor);
    }

    
    _getHdDenomination(actor) {
        return HitDiceService.getHdDenomination(actor);
    }

    
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
        if (this._completionPhase) return;
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
        if (this._completionPhase) return;
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

    
    static async #onConfirmRecovery(event, target) {
        if (this._completionPhase) return;
        const actorId = target.dataset.actorId;
        const actor = game.actors.get(actorId);
        if (!actor) return;
        if (!this._isGM && !actor.isOwner) return;

        this._confirmedRecovery.add(actorId);
        this.render();
    }

    
    static async #onEditRecovery(event, target) {
        if (this._completionPhase) return;
        const actorId = target.dataset.actorId;
        const actor = game.actors.get(actorId);
        if (!actor) return;
        if (!this._isGM && !actor.isOwner) return;

        this._confirmedRecovery.delete(actorId);
        this.render();
    }

    /**
     * A character is ready once their player has marked the rest finished.
     * Actors with no player owner match on the actor id instead.
     * @param {Actor} actor
     * @returns {boolean}
     */
    static #isCharacterReady(actor) {
        const allUsers = game.users?.contents ?? Array.from(game.users ?? []);
        const ownerUser = allUsers.find(u => !u.isGM && actor.testUserPermission(u, "OWNER"));
        return ownerUser ? this._finishedUsers.has(ownerUser.id) : this._finishedUsers.has(actor.id);
    }

    static #onToggleShortRestFinished(event, target) {
        if (this._completionPhase) return;
        event.preventDefault?.();
        const uid = game.user.id;
        const next = !this._finishedUsers.has(uid);
        if (next) this._finishedUsers.add(uid);
        else this._finishedUsers.delete(uid);

        this._publishSession("PLAYER_FINISHED", { userId: uid, finished: next });
        this.render();
    }

    static #onTogglePatrolCheck(event, target) {
        if (!this._isGM || this._completionPhase) return;
        this._patrolCheckEnabled = target.type === "checkbox" ? target.checked : !this._patrolCheckEnabled;
        void this._saveSessionState();
        this.render();
    }

    static #onAdjustShortRestDc(event, target) {
        if (!this._isGM || this._completionPhase) return;
        const delta = Number(target.dataset.delta) || 0;
        const next = Math.max(1, Math.min(30, (this._encounterDc ?? 6) + delta));
        if (next === this._encounterDc) return;
        this._encounterDc = next;
        void this._saveSessionState();
        this.render();
    }

    static async #onVolunteerSong(event, target) {
        if (this._completionPhase) return;
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

        this._publishSession("SONG_VOLUNTEER", {
            actorId,
            songVolunteer: this._songVolunteer
        });
        this.render();
    }

    static async #onVolunteerChefMeal(event, target) {
        if (this._completionPhase) return;
        const actorId = target.dataset.actorId;
        const actor = game.actors.get(actorId);
        if (!actor) return;
        if (!this._isGM && !actor.isOwner) return;

        if (this._chefVolunteer?.actorId === actorId) {
            this._chefVolunteer = null;
            this._chefMealServedCount = 0;
            this._chefMealBonusByActor.clear();
        } else if (!this._chefVolunteer) {
            const partyActors = getPartyActors();
            const chefInfo = scanEligibleChefs(partyActors).find(c => c.actorId === actorId);
            if (!chefInfo) return;
            this._chefVolunteer = { ...chefInfo };
            this._chefMealServedCount = 0;
            this._chefMealBonusByActor.clear();
        } else {
            return;
        }

        this._publishSession("CHEF_VOLUNTEER", {
            actorId,
            chefVolunteer: this._chefVolunteer,
            chefMealServedCount: this._chefMealServedCount,
            chefMealBonuses: [...this._chefMealBonusByActor]
        });
        this.render();
    }

    static async #onOptOutChef(event, target) {
        if (this._completionPhase) return;
        const actorId = target?.dataset?.actorId ?? this._chefVolunteer?.actorId;
        if (!actorId) return;
        const actor = game.actors.get(actorId);
        if (!actor) return;
        if (!this._isGM && !actor.isOwner) return;

        if (this._chefVolunteer?.actorId === actorId || this._isGM) {
            this._chefVolunteer = null;
            this._chefMealServedCount = 0;
            this._chefMealBonusByActor.clear();
            this._publishSession("CHEF_VOLUNTEER", {
                actorId,
                chefVolunteer: null,
                chefMealServedCount: 0,
                chefMealBonuses: []
            });
            this.render();
        }
    }

    static async #onClaimChefTreat(event, target) {
        if (this._completionPhase) return;
        const actorId = target?.dataset?.actorId;
        if (!actorId) return;
        const actor = game.actors.get(actorId);
        if (!actor) return;
        if (!this._isGM && !actor.isOwner) return;

        if (!this._chefVolunteer) return;
        const remaining = this._chefVolunteer.mealCapacity - this._chefMealServedCount;
        if (remaining <= 0) return;
        if (this._chefMealBonusByActor.has(actorId)) return;

        const rolls = this._rolls.get(actorId) ?? [];
        const hasSpentHd = rolls.length > 0;

        const chefBonusRecord = {
            claimed: true,
            applied: false,
            chefName: this._chefVolunteer.chefName,
            total: 0,
            formula: "1d8",
        };

        this._chefMealServedCount += 1;

        if (hasSpentHd) {
            const chefRoll = await HitDiceService.applyChefBonus(actor, this._chefVolunteer);
            if (chefRoll) {
                chefBonusRecord.applied = true;
                chefBonusRecord.total = chefRoll.total;
                chefBonusRecord.formula = chefRoll.formula;

                try {
                    await ChatMessage.create({
                        content: ShortRestApp.#buildChefMealChat(
                            this._chefVolunteer.chefName,
                            actor.name,
                            chefRoll.formula,
                            chefRoll.total
                        ),
                        speaker: ChatMessage.getSpeaker({
                            actor: game.actors.get(this._chefVolunteer.actorId) ?? actor
                        }),
                    });
                } catch (err) {
                    Logger.warn(`${MODULE_ID} | Chef Replenishing Meal chat message failed:`, err);
                }
            }
        }

        this._chefMealBonusByActor.set(actorId, chefBonusRecord);

        this._publishSession("CHEF_CLAIM_TREAT", {
            actorId,
            chefMealBonus: chefBonusRecord,
            chefMealServedCount: this._chefMealServedCount
        });
        this.render();
    }

    static async #onClaimChefTreatFromBadge(event, target) {
        if (this._completionPhase) return;
        if (!this._chefVolunteer) return;
        const remaining = this._chefVolunteer.mealCapacity - this._chefMealServedCount;
        if (remaining <= 0) return;

        const partyActors = getPartyActors();
        const linkedId = game.user?.character?.id ?? null;
        let candidate = null;
        if (linkedId) {
            const linked = partyActors.find(a => a.id === linkedId);
            if (linked && (this._isGM || linked.isOwner) && !this._chefMealBonusByActor.has(linked.id)) {
                candidate = linked;
            }
        }
        if (!candidate) {
            candidate = partyActors.find(a => (this._isGM || a.isOwner) && !this._chefMealBonusByActor.has(a.id));
        }
        if (!candidate) return;

        const mockTarget = { dataset: { actorId: candidate.id } };
        return ShortRestApp.#onClaimChefTreat.call(this, event, mockTarget);
    }

    static #escapeChat(str) {
        const fn = globalThis.foundry?.utils?.escapeHTML;
        return fn ? fn(String(str ?? "")) : String(str ?? "");
    }

    static #buildChefMealChat(chefName, recipientName, formula, total) {
        const c = ShortRestApp.#escapeChat(chefName);
        const r = ShortRestApp.#escapeChat(recipientName);
        const f = ShortRestApp.#escapeChat(formula);
        return `<div class="respite-chef-meal respite-chat-parchment"><div class="respite-song-title"><i class="fas fa-utensils"></i> Replenishing Meal</div><p><strong>${r}</strong> gains <strong>+${total} HP</strong> <span class="respite-song-meta">(${f})</span> from <em>${c}</em>'s short-rest cooking (with Hit Dice).</p></div>`;
    }

    /**
     * @param {boolean} isGm
     * @param {Array<{ actorId: string, name: string, line: string }>} lines
     */
    static #completionRowsForUser(isGm, lines) {
        if (!lines?.length) return [];
        if (isGm) {
            return lines.map(({ actorId, name, line }) => ({ actorId, name, line }));
        }
        const linkedId = game.user?.character?.id ?? null;
        return lines
            .filter((row) => {
                if (linkedId && row.actorId === linkedId) return true;
                const actor = game.actors.get(row.actorId);
                return !!actor?.isOwner;
            })
            .map(({ actorId, name, line }) => ({ actorId, name, line }));
    }

    
    static #buildSongImmediateChat(bardName, recipientName, formula, total) {
        const b = ShortRestApp.#escapeChat(bardName);
        const r = ShortRestApp.#escapeChat(recipientName);
        const f = ShortRestApp.#escapeChat(formula);
        return `<div class="respite-song-of-rest respite-song-of-rest-card respite-chat-parchment"><div class="respite-song-title"><i class="fas fa-music"></i> Song of Rest</div><p><strong>${r}</strong> gains <strong>+${total} HP</strong> <span class="respite-song-meta">(${f})</span> from <em>${b}</em>’s performance (applied with this character’s first Hit Die this rest).</p></div>`;
    }

    /**
     * Chat card when Respite realigns Hit Die HP after the native roll (max die, Durable, Periapt, etc.).
     * @param {string} actorName
     * @param {number} rollTotal Total from the system roll card (before Respite rules)
     * @param {number} adjustedTotal Final Hit Die healing for this spend
     * @param {string[]} annotationLines Modifier labels (e.g. Max HD homebrew)
     * @returns {string}
     */
    static #buildHitDieCorrectionChat(actorName, rollTotal, adjustedTotal, annotationLines) {
        const n = ShortRestApp.#escapeChat(actorName);
        const ann = (annotationLines ?? [])
            .map((line) => ShortRestApp.#escapeChat(line))
            .filter(Boolean)
            .join(", ");
        const meta = ann
            ? `<p class="respite-song-meta">${ann}</p>`
            : "";
        return `<div class="respite-hit-die-correction respite-chat-parchment">` +
            `<div class="respite-song-title"><i class="fas fa-heart-pulse"></i> Healing surge</div>` +
            `<p><strong>${n}</strong> The system card showed <strong>+${rollTotal}</strong> HP from this Hit Die. ` +
            `Respite aligned short rest healing to <strong>+${adjustedTotal}</strong> HP.</p>${meta}</div>`;
    }

    
    static #buildSongEndRestSummaryChat(bardName, entries) {
        const b = ShortRestApp.#escapeChat(bardName);
        const rows = entries.map(e =>
            `<li><strong>${ShortRestApp.#escapeChat(e.name)}</strong>: ${ShortRestApp.#escapeChat(e.formula)}, <strong>+${e.total} HP</strong></li>`
        ).join("");
        return `<div class="respite-song-of-rest respite-song-of-rest-summary respite-chat-parchment"><div class="respite-song-title"><i class="fas fa-music"></i> Song of Rest: ${b}</div><p class="respite-song-lead">Each ally who spent at least one Hit Die during this short rest gains extra healing (one die each):</p><ul class="respite-song-list">${rows}</ul></div>`;
    }

    static #onSwitchTab(event, target) {
        if (this._completionPhase) return;
        const tab = target?.dataset?.tab;
        if (tab !== "recovery" && tab !== "workbench") return;
        if (tab === "workbench" && !isWorkbenchIdentifyUiEnabled()) return;
        this._activeTab = tab;
        if (this._isGM) {
            void this._saveSessionState();
            this._broadcastSync();
        } else {
            emitRestSessionDelta("shortrest", "WORKBENCH_STAGING", {
                userId: game.user.id,
                staging: Array.from(this._workbenchIdentifyStaging?.entries() ?? [])
            });
        }
        this.render();
    }

    static #onSelectWorkbenchRosterActor(event, target) {
        if (this._completionPhase) return;
        if (!this._isGM || this._activeTab !== "workbench") return;
        const chip = target?.closest?.("[data-roster-id]");
        const id = chip?.dataset?.rosterId;
        if (!id) return;
        const party = getPartyActors();
        if (!party.some((a) => a.id === id)) return;
        this._workbenchFocusActorId = id;
        void this._saveSessionState();
        this._broadcastSync();
        this.render();
    }

    static #onSelectRosterCharacter(event, target) {
        if (this._completionPhase) return;
        if (!this._isGM) return;
        const chip = target?.closest?.(".roster-chip, .rest-companion-card, .gm-party-card, [data-actor-id]");
        if (!chip) return;
        const id = chip.dataset.actorId || chip.dataset.rosterId;
        if (!id) return;
        const party = getPartyActors();
        if (!party.some((a) => a.id === id)) return;
        if (id === this._selectedCharacterId) {
            this._selectedCharacterId = null;
        } else {
            this._selectedCharacterId = id;
        }
        if (this._activeTab === "workbench") {
            this._workbenchFocusActorId = this._selectedCharacterId;
            void this._saveSessionState();
            this._broadcastSync();
        }
        this.render();
    }

    static #onClearSelectedCharacter(event, target) {
        if (!this._isGM) return;
        this._selectedCharacterId = null;
        if (this._activeTab === "workbench") {
            this._workbenchFocusActorId = null;
            void this._saveSessionState();
            this._broadcastSync();
        }
        this.render();
    }

    static async #onStationDetectMagicScan(event) {
        if (this._completionPhase) return;
        if (!this._detectMagic) return;
        const btn = event?.currentTarget ?? null;
        btn?.classList.add("is-casting");
        spawnDetectMagicCastRipple(btn);
        if (this._magicScanComplete) {
            this._detectMagic.clearScanSession();
        } else {
            await this._detectMagic.runScan(getPartyActors);
            if (this._isGM) {
                void this._saveSessionState();
                this._broadcastSync();
            }
        }
    }

    static async #onStationIdentifyScannedItem(event, target) {
        if (this._completionPhase) return;
        const actorId = target?.dataset?.actorId;
        const itemId = target?.dataset?.itemId;
        if (!actorId || !itemId) return;
        await this._detectMagic.identifyScannedItem(actorId, itemId, getPartyActors);
        if (this._isGM) {
            void this._saveSessionState();
            this._broadcastSync();
        }
    }

    static async #onSubmitWorkbenchIdentify() {
        if (this._completionPhase) return;
        const el = this.element?.querySelector?.(".station-workbench-identify-embed[data-workbench-actor-id]");
        const actorId = el?.dataset?.workbenchActorId;
        if (!actorId) return;
        await this._workbench.submitFromStation(actorId);
        if (this._isGM) {
            void this._saveSessionState();
            this._broadcastSync();
        }
    }

    static #onWorkbenchIdentifyRemovePotion(event, target) {
        if (this._completionPhase) return;
        const el = this.element?.querySelector?.(".station-workbench-identify-embed[data-workbench-actor-id]");
        const actorId = el?.dataset?.workbenchActorId;
        if (!actorId) return;
        this._workbench.removePotionFromStation(actorId);
        if (this._isGM) {
            void this._saveSessionState();
            this._broadcastSync();
        }
    }

    static async #onDismissWorkbenchIdentifyAck() {
        if (this._completionPhase) return;
        const el = this.element?.querySelector?.(".station-workbench-identify-embed[data-workbench-actor-id]");
        const actorId = el?.dataset?.workbenchActorId;
        if (!actorId) return;
        const ack = this._workbenchIdentifyAcknowledge?.get(actorId);
        if (!ack || Date.now() < ack.revealAt) return;
        this._workbench.dismissAcknowledgement(actorId);
        if (this._isGM) {
            void this._saveSessionState();
            this._broadcastSync();
        }
    }

    
    static async #onSpendHitDie(event, target) {
        if (this._completionPhase) return;
        const actorId = target.dataset.actorId;
        const actor = game.actors.get(actorId);
        if (!actor) return;

        if (!this._isGM && !actor.isOwner) return;

        const spendResult = await HitDiceService.spendHitDie(actor);
        if (!spendResult) return;

        const { rollTotal, adjustedTotal, die, conMod, annotations } = spendResult;

        if (adjustedTotal !== rollTotal) {
            try {
                await ChatMessage.create({
                    content: ShortRestApp.#buildHitDieCorrectionChat(
                        actor.name,
                        rollTotal,
                        adjustedTotal,
                        annotations
                    ),
                    speaker: ChatMessage.getSpeaker({ actor }),
                });
            } catch (err) {
                Logger.warn(`${MODULE_ID} | Hit Die correction chat message failed:`, err);
            }
        }

        // Record the roll locally (final healing including modifiers)
        if (!this._rolls.has(actorId)) this._rolls.set(actorId, []);
        this._rolls.get(actorId).push({
            total: adjustedTotal,
            die,
            conMod,
            annotations: [...annotations],
        });

        const songTiming = game.settings.get(MODULE_ID, SONG_TIMING_KEY) ?? "endOfRest";
        /** @type {{ actorId: string, total: number, formula: string, bardName: string }|null} */
        let songBonusUpdate = null;

        if (songTiming === "withFirstHitDie" && this._rolls.get(actorId).length === 1 && this._songVolunteer?.songDie) {
            const songRoll = await HitDiceService.applySongBonus(actor, this._songVolunteer);
            if (songRoll) {
                this._songBonusByActor.set(actorId, {
                    total: songRoll.total,
                    formula: songRoll.formula,
                    bardName: songRoll.bardName,
                });
                songBonusUpdate = {
                    actorId,
                    total: songRoll.total,
                    formula: songRoll.formula,
                    bardName: songRoll.bardName,
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
        }

        /** @type {{ actorId: string, total: number, formula: string, chefName: string }|null} */
        let chefMealBonusUpdate = null;

        const claimedChefRecord = this._chefMealBonusByActor.get(actorId);
        if (claimedChefRecord && !claimedChefRecord.applied) {
            const chefRoll = await HitDiceService.applyChefBonus(actor, {
                chefName: claimedChefRecord.chefName
            });
            if (chefRoll) {
                claimedChefRecord.applied = true;
                claimedChefRecord.total = chefRoll.total;
                claimedChefRecord.formula = chefRoll.formula;
                this._chefMealBonusByActor.set(actorId, claimedChefRecord);

                chefMealBonusUpdate = {
                    actorId,
                    total: chefRoll.total,
                    formula: chefRoll.formula,
                    chefName: claimedChefRecord.chefName,
                    applied: true,
                    claimed: true,
                };
                try {
                    await ChatMessage.create({
                        content: ShortRestApp.#buildChefMealChat(
                            claimedChefRecord.chefName,
                            actor.name,
                            chefRoll.formula,
                            chefRoll.total
                        ),
                        speaker: ChatMessage.getSpeaker({
                            actor: this._chefVolunteer ? game.actors.get(this._chefVolunteer.actorId) : actor
                        }),
                    });
                } catch (err) {
                    Logger.warn(`${MODULE_ID} | Chef meal chat message failed:`, err);
                }
            }
        }

        this._publishSession("SPEND_HIT_DIE", {
            actorId,
            roll: { total: adjustedTotal, die, conMod, annotations: [...annotations] },
            ...(songBonusUpdate ? { songBonusUpdate } : {}),
            ...(chefMealBonusUpdate ? { chefMealBonusUpdate } : {}),
            chefMealServedCount: this._chefMealServedCount
        });

        this.render();
    }

    /**
     * GM completes the short rest: song and spell recovery, then native short rest, then close.
     */
    static async #onCompleteShortRest(event, target) {
        if (!this._isGM) return;
        if (this._finalizeShortRestBusy || this._completeShortRestBusy) return;
        this._completeShortRestBusy = true;
        try {
        if (this._completionPhase) {
            await ShortRestApp.#onFinalizeShortRestRecovery.call(this);
            return;
        }

        const partyActorsPreCheck = getPartyActors();
        const waitingNames = partyActorsPreCheck
            .filter(actor => !RestAfkState.isAfk(actor.id) && !ShortRestApp.#isCharacterReady.call(this, actor))
            .map(actor => actor.name);
        if (waitingNames.length > 0) return;

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
                content: `<p>The following characters have spell recovery selections that haven't been confirmed:</p><ul>${unconfirmed.map(n => `<li><strong>${n}</strong></li>`).join("")}</ul><p>Their selections will still be applied.</p>`,
                yesLabel: "Apply Anyway",
                noLabel: "Cancel",
                yesIcon: "fas fa-check",
                noIcon: "fas fa-times",
                defaultYes: false,
            });
            if (!proceed) return;
        }

        const partyActors = getPartyActors();

        // Optional encounter check. Uses the Encounter DC stepper. A roll at least 5 under
        // the DC, or a 1, stops the rest. The roll is not posted to chat.
        if (this._isGM && this._patrolCheckEnabled) {
            const dc = this._encounterDc ?? 6;
            const roll = await new Roll("1d20").evaluate();
            const rollTotal = roll.total;
            const isRed = rollTotal === 1 || rollTotal < dc - 4;
            const isAmber = !isRed && rollTotal < dc;

            if (isRed) {
                ui.notifications.warn(`Encounter DC ${dc}. Roll ${rollTotal}. Encounter. Rest interrupted.`);
                return;
            }
            if (isAmber) {
                ui.notifications.info(`Encounter DC ${dc}. Roll ${rollTotal}. Below DC. Rest completes.`);
            } else {
                ui.notifications.info(`Encounter DC ${dc}. Roll ${rollTotal}. Clear.`);
            }
        }

        const songTiming = game.settings.get(MODULE_ID, SONG_TIMING_KEY) ?? "endOfRest";
        const anyHdSpent = [...this._rolls.values()].some(rolls => rolls.length > 0);
        if (songTiming === "endOfRest" && anyHdSpent && this._songVolunteer?.songDie) {
            const entries = [];
            for (const actor of partyActors) {
                if (!this._rolls.has(actor.id) || this._rolls.get(actor.id).length === 0) continue;
                const songRoll = await HitDiceService.applySongBonus(actor, this._songVolunteer);
                if (songRoll) {
                    entries.push({ name: actor.name, formula: songRoll.formula, total: songRoll.total });
                }
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

        this._completionPhase = true;
        await this._saveSessionState();
        this._broadcastSync();
        await ShortRestApp.#onFinalizeShortRestRecovery.call(this);
        } finally {
            this._completeShortRestBusy = false;
        }
    }

    /**
     * Run native short rest, then close the window for everyone.
     */
    static async #onFinalizeShortRestRecovery() {
        if (!this._isGM) return;
        if (!this._completionPhase) return;
        if (this._finalizeShortRestBusy) return;
        this._finalizeShortRestBusy = true;

        const partyActors = getPartyActors();

        try {
            // Variant-aware: 1 hour normal, 1 minute epic. Gritty short rests
            // run through BivouacApp, which advances its own 8 hours.
            await CalendarHandler.advanceRestTime("short");

            setNativeShortRestUnsuppressed(true);
            try {
                const shortAdapter = game.ionrift?.respite?.adapter;
                for (const actor of partyActors) {
                    try {
                        if (shortAdapter) {
                            await shortAdapter.triggerNativeRest(actor, "short");
                        } else if (game.system.id === "dnd5e") {
                            await actor.shortRest({ dialog: false, chat: true });
                        }
                    } catch (e) {
                        Logger.warn(`Failed shortRest for ${actor.name}:`, e);
                    }
                }
            } finally {
                setNativeShortRestUnsuppressed(false);
            }

            // Strip any Detect Magic active effects left on party actors from the scan.
            try {
                await purgeDetectMagicRestArtifacts(partyActors);
            } catch (e) {
                console.warn(`${MODULE_ID} | Failed to purge Detect Magic effects:`, e);
            }

            await this._clearShortRestState();
            emitRestSessionResolved("shortrest");
            ui.notifications.info("Short rest complete. Class features recovered.");
            this._completionPhase = false;
            this._completionSummaryLines = null;
            this._isTerminating = true;
            // Clear Detect Magic glow state before closing so it doesn't persist
            // past the rest conclusion on actor sheets.
            this._detectMagic?.clearScanSession({ skipSave: true });
            this.close();
        } finally {
            this._finalizeShortRestBusy = false;
        }
    }

    /**
     * GM abandons the short rest without completing it.
     */
    static async #onAbandonShortRest(event, target) {
        if (!this._isGM) return;

        const proceed = await confirmAbandonRest({
            title: "Abandon Short Rest?",
            message: "Abandon this short rest? HP gained from Hit Dice already spent will remain, but class feature recovery will not be applied.",
            confirmLabel: "Abandon",
            cancelLabel: "Continue Resting"
        });
        if (!proceed) return;

        this._completionPhase = false;
        this._completionSummaryLines = null;

        await this._clearShortRestState();
        emitRestSessionAbandoned("shortrest");
        ui.notifications.info("Short rest abandoned.");
        this._isTerminating = true;
        // Clear Detect Magic glow state before closing so it doesn't persist
        // after an abandoned short rest.
        this._detectMagic?.clearScanSession({ skipSave: true });
        this.close();
    }

    /**
     * Called on GM side when a player spends a hit die.
     */
    receiveCompletionSummary(data) {
        const lines = Array.isArray(data?.lines) ? data.lines : [];
        this._completionSummaryLines = lines;
        this._completionPhase = true;
        void this.render(true);
    }

    receiveHdSpent(data) {
        if (this._completionPhase) return;
        const { actorId, rollTotal, die, conMod, annotations, songBonusUpdate, chefMealBonusUpdate, chefMealServedCount } = data;
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
        if (chefMealBonusUpdate?.actorId) {
            this._chefMealBonusByActor.set(chefMealBonusUpdate.actorId, {
                total: Number(chefMealBonusUpdate.total) || 0,
                formula: String(chefMealBonusUpdate.formula ?? ""),
                chefName: String(chefMealBonusUpdate.chefName ?? ""),
            });
        }
        if (chefMealServedCount !== undefined) {
            this._chefMealServedCount = Number(chefMealServedCount) || 0;
        }
        this.render();
    }

    /**
     * Called on player side when GM starts (or re-broadcasts) a short rest.
     */
    receiveStarted(data) {
        this._rehydrate(data);
        if (data.workbench) this.applyWorkbenchStateFromHost(data.workbench);
        this.render({ force: true });
    }

    
    receiveSongVolunteer(data) {
        if (this._completionPhase) return;
        this._songVolunteer = data.songVolunteer ?? null;
        this.render();
    }

    
    receiveChefVolunteer(data) {
        if (this._completionPhase) return;
        SHORT_REST_STATE_SCHEMA.apply(this, data);
        if (data.chefMealBonuses === undefined && !this._chefVolunteer) {
            this._chefMealBonusByActor.clear();
            this._chefMealServedCount = 0;
        }
        this.render();
    }

    /**
     * @param {{ userId?: string, finished?: boolean }} data
     */
    receivePlayerFinished(data) {
        if (this._completionPhase) return;
        if (!data?.userId) return;
        if (data.finished) this._finishedUsers.add(data.userId);
        else this._finishedUsers.delete(data.userId);
        this.render();
    }

    /**
     * GM pushes the snapshot. A player names the change and waits for that push.
     */
    _publishSession(action, payload) {
        if (this._isGM) {
            this._broadcastSync();
            void this._saveSessionState();
            return;
        }
        emitRestSessionDelta("shortrest", action, payload);
    }

    _broadcastSync() {
        if (!this._isGM) return;
        emitRestSessionSync("shortrest", this._exportSnapshot());
    }

    /**
     * GM applies a player delta, then pushes the resulting snapshot.
     * @param {string} action
     * @param {object} payload
     * @param {string} userId
     */
    onReceiveDelta(action, payload, userId) {
        if (!this._isGM || this._completionPhase) return;
        const actorId = payload?.actorId;
        if (actorId && !userControlsActor(userId, actorId)) return;

        switch (action) {
            case "SONG_VOLUNTEER":
                this._songVolunteer = payload.songVolunteer ?? null;
                break;
            case "CHEF_VOLUNTEER":
                SHORT_REST_STATE_SCHEMA.apply(this, payload);
                if (!this._chefVolunteer) {
                    this._chefMealBonusByActor.clear();
                    this._chefMealServedCount = 0;
                }
                break;
            case "WORKBENCH_STAGING":
                this.applyWorkbenchStagingFromPlayer(payload);
                return;
            case "CHEF_CLAIM_TREAT":
                if (payload.actorId && payload.chefMealBonus) {
                    this._chefMealBonusByActor.set(payload.actorId, payload.chefMealBonus);
                    if (payload.chefMealServedCount !== undefined) {
                        this._chefMealServedCount = Number(payload.chefMealServedCount) || 0;
                    }
                }
                break;
            case "PLAYER_FINISHED":
                if (payload.userId !== userId) return;
                if (payload.finished) this._finishedUsers.add(userId);
                else this._finishedUsers.delete(userId);
                break;
            case "SPEND_HIT_DIE":
                if (actorId && payload.roll) {
                    if (!this._rolls.has(actorId)) this._rolls.set(actorId, []);
                    this._rolls.get(actorId).push(payload.roll);
                }
                if (actorId && payload.songBonusUpdate) {
                    const song = payload.songBonusUpdate;
                    this._songBonusByActor.set(actorId, {
                        total: song.total,
                        formula: song.formula,
                        bardName: song.bardName
                    });
                }
                if (payload.chefMealBonusUpdate?.actorId) {
                    const bonus = payload.chefMealBonusUpdate;
                    this._chefMealBonusByActor.set(bonus.actorId, {
                        total: bonus.total,
                        formula: bonus.formula,
                        chefName: bonus.chefName
                    });
                }
                if (payload.chefMealServedCount !== undefined) {
                    this._chefMealServedCount = Number(payload.chefMealServedCount) || 0;
                }
                break;
            default:
                return;
        }
        this._broadcastSync();
        void this._saveSessionState();
        this.render();
    }

    /** @param {object} state */
    onReceiveSync(state) {
        if (this._isGM) return;
        this._rehydrate(state);
        this.render();
    }

    /**
     * Player-safe snapshot for live start/reconnect. Drops the schema `type`
     * so it cannot overwrite the socket message type on emit.
     *
     * @returns {object}
     */
    _exportSnapshot() {
        this._afkCharacters = new Set(RestAfkState.getAfkCharacterIds());
        const { type, ...state } = SHORT_REST_STATE_SCHEMA.serializeForPlayers(this);
        return state;
    }

    /**
     * Applies a persisted blob or a live snapshot. AFK only updates when the
     * payload carried it, so a partial chef/song message cannot wipe the set.
     *
     * @param {object} saved
     */
    _rehydrate(saved) {
        SHORT_REST_STATE_SCHEMA.apply(this, saved);
        if (saved?.afkCharacterIds !== undefined) {
            RestAfkState.replaceAll([...this._afkCharacters]);
            pushAllStateToAdapters();
        }
    }

    /**
     * Persists current short rest state to a world setting.
     * GM only. Called on render and after every state-mutating action.
     */
    async _saveSessionState() {
        this._afkCharacters = new Set(RestAfkState.getAfkCharacterIds());
        await SHORT_REST_STATE_SCHEMA.save(this);
    }

    /**
     * Restores short rest state from the world setting.
     * @returns {boolean} True if state was found and restored.
     */
    _loadShortRestState() {
        if (!SHORT_REST_STATE_SCHEMA.load(this)) return false;
        RestAfkState.replaceAll([...this._afkCharacters]);
        pushAllStateToAdapters();
        return true;
    }

    async _clearShortRestState() {
        await SHORT_REST_STATE_SCHEMA.clear();
    }

    _onRender(context, options) {
        super._onRender?.(context, options);
        registerRestSessionApp("shortrest", this);
        setRespiteFlowActive(true);
        this.element?.classList.toggle("hide-terrain-banners", !!context?.hideTerrainBanner);
    }
}

