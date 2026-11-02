import { ShortRestContextAndSyncMethods } from "./ShortRestContextAndSync.js";
import { ShortRestActionMethods } from "./ShortRestActions.js";
import { Logger } from "../../utils/Logger.js";
import { HitDieModifiers } from "../../services/rest/recovery/HitDieModifiers.js";
import { HitDiceService } from "../../services/rest/recovery/HitDiceService.js";
import { SpellSlotRecovery } from "../../services/rest/recovery/SpellSlotRecovery.js";
import { confirmAbandonRest } from "./confirmAbandonRest.js";
import { MODULE_ID } from "../../data/moduleId.js";
import { isWorkbenchIdentifyUiEnabled, matchesShelterSpell } from "../../data/RestConstants.js";
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
    { id: "none",      get name() { return game.i18n.localize("ionrift-respite.shortRest.shelter.openAir.name"); },   icon: "fas fa-wind",       get hint() { return game.i18n.localize("ionrift-respite.shortRest.shelter.openAir.hint"); } },
    { id: "rope_trick", get name() { return game.i18n.localize("ionrift-respite.shortRest.shelter.ropeTrick.name"); }, icon: "fas fa-hat-wizard", get hint() { return game.i18n.localize("ionrift-respite.shortRest.shelter.ropeTrick.hint"); },
      identifiers: ["rope-trick"], altNames: ["rope trick"] },
    { id: "tiny_hut",  get name() { return game.i18n.localize("ionrift-respite.shortRest.shelter.tinyHut.name"); },   icon: "fas fa-igloo",      get hint() { return game.i18n.localize("ionrift-respite.shortRest.shelter.tinyHut.hint"); },
      identifiers: ["leomunds-tiny-hut", "tiny-hut", "cozy-cabin", "galders-tower"], altNames: ["leomund's tiny hut", "tiny hut"] },
];

export class ShortRestApp extends BaseShortRestApp {

    static DEFAULT_OPTIONS = {
        id: "ionrift-short-rest",
        classes: ["ionrift-window", "glass-ui", "short-rest-app"],
        tag: "div",
        window: {
            title: "ionrift-respite.shortRest.windowTitle",
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
            toggleActorReady:          ShortRestApp.#onToggleActorReady,
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

        /** actorId -> Array<[level, count]> spell recovery selections synced across sessions. */
        this._spellRecoverySelections = new Map();

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
                ui.notifications.info(game.i18n.localize("ionrift-respite.shortRest.notify.gmAbandoned"));
            }
            if (!this._isGM && options.resolved) {
                ui.notifications.info(game.i18n.localize("ionrift-respite.shortRest.notify.completeClassFeatures"));
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

    async _prepareContext(...args) { return ShortRestContextAndSyncMethods._prepareContext.apply(this, args); }
    _getHitDiceInfo(...args) { return ShortRestContextAndSyncMethods._getHitDiceInfo.apply(this, args); }
    _getHdDenomination(...args) { return ShortRestContextAndSyncMethods._getHdDenomination.apply(this, args); }

    static async #persistSpellRecoveryFlag(...args) { return ShortRestActionMethods.persistSpellRecoveryFlag.apply(this, args); }
    static async #onAddSpellSlot(event, target) { return ShortRestActionMethods.onAddSpellSlot.call(this, event, target); }
    static async #onRemoveSpellSlot(event, target) { return ShortRestActionMethods.onRemoveSpellSlot.call(this, event, target); }
    static async #onConfirmRecovery(event, target) { return ShortRestActionMethods.onConfirmRecovery.call(this, event, target); }
    static async #onEditRecovery(event, target) { return ShortRestActionMethods.onEditRecovery.call(this, event, target); }
    static #isCharacterReady(...args) { return ShortRestActionMethods.isCharacterReady.apply(this, args); }
    static #onToggleShortRestFinished(event, target) { return ShortRestActionMethods.onToggleShortRestFinished.call(this, event, target); }
    static async #onToggleActorReady(event, target) { return ShortRestActionMethods.onToggleActorReady.call(this, event, target); }
    static #onTogglePatrolCheck(event, target) { return ShortRestActionMethods.onTogglePatrolCheck.call(this, event, target); }
    static #onAdjustShortRestDc(event, target) { return ShortRestActionMethods.onAdjustShortRestDc.call(this, event, target); }
    static async #onVolunteerSong(event, target) { return ShortRestActionMethods.onVolunteerSong.call(this, event, target); }
    static async #onVolunteerChefMeal(event, target) { return ShortRestActionMethods.onVolunteerChefMeal.call(this, event, target); }
    static async #onOptOutChef(event, target) { return ShortRestActionMethods.onOptOutChef.call(this, event, target); }
    static async #onClaimChefTreat(event, target) { return ShortRestActionMethods.onClaimChefTreat.call(this, event, target); }
    static async #onClaimChefTreatFromBadge(event, target) { return ShortRestActionMethods.onClaimChefTreatFromBadge.call(this, event, target); }
    static #escapeChat(...args) { return ShortRestActionMethods.escapeChat(...args); }
    static #buildChefMealChat(...args) { return ShortRestActionMethods.buildChefMealChat(...args); }
    static #completionRowsForUser(...args) { return ShortRestActionMethods.completionRowsForUser(...args); }
    static #buildSongImmediateChat(...args) { return ShortRestActionMethods.buildSongImmediateChat(...args); }
    static #buildHitDieCorrectionChat(...args) { return ShortRestActionMethods.buildHitDieCorrectionChat(...args); }
    static #buildSongEndRestSummaryChat(...args) { return ShortRestActionMethods.buildSongEndRestSummaryChat(...args); }
    static #onSwitchTab(event, target) { return ShortRestActionMethods.onSwitchTab.call(this, event, target); }
    static #onSelectWorkbenchRosterActor(event, target) { return ShortRestActionMethods.onSelectWorkbenchRosterActor.call(this, event, target); }
    static #onSelectRosterCharacter(event, target) { return ShortRestActionMethods.onSelectRosterCharacter.call(this, event, target); }
    static #onClearSelectedCharacter(event, target) { return ShortRestActionMethods.onClearSelectedCharacter.call(this, event, target); }
    static async #onStationDetectMagicScan(event, target) { return ShortRestActionMethods.onStationDetectMagicScan.call(this, event, target); }
    static async #onStationIdentifyScannedItem(event, target) { return ShortRestActionMethods.onStationIdentifyScannedItem.call(this, event, target); }
    static async #onSubmitWorkbenchIdentify(event, target) { return ShortRestActionMethods.onSubmitWorkbenchIdentify.call(this, event, target); }
    static #onWorkbenchIdentifyRemovePotion(event, target) { return ShortRestActionMethods.onWorkbenchIdentifyRemovePotion.call(this, event, target); }
    static async #onDismissWorkbenchIdentifyAck(event, target) { return ShortRestActionMethods.onDismissWorkbenchIdentifyAck.call(this, event, target); }

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
            .filter(actor => !ShortRestApp.#isCharacterReady.call(this, actor))
            .map(actor => actor.name);
        if (waitingNames.length > 0) {
            const confirmFn = game.ionrift?.library?.confirm ?? Dialog.confirm.bind(Dialog);
            const proceed = await confirmFn({
                title: game.i18n.localize("ionrift-respite.shortRest.confirmResting.title"),
                content: `<p>${game.i18n.localize("ionrift-respite.shortRest.confirmResting.lead")}</p><ul>${waitingNames.map(n => `<li><strong>${n}</strong></li>`).join("")}</ul><p>${game.i18n.localize("ionrift-respite.shortRest.confirmResting.prompt")}</p>`,
                yesLabel: game.i18n.localize("ionrift-respite.shortRest.confirmResting.completeAnyway"),
                noLabel: game.i18n.localize("ionrift-respite.shortRest.confirmResting.cancel"),
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
                title: game.i18n.localize("ionrift-respite.shortRest.confirmSpellRecovery.title"),
                content: `<p>${game.i18n.localize("ionrift-respite.shortRest.confirmSpellRecovery.lead")}</p><ul>${unconfirmed.map(n => `<li><strong>${n}</strong></li>`).join("")}</ul><p>${game.i18n.localize("ionrift-respite.shortRest.confirmSpellRecovery.note")}</p>`,
                yesLabel: game.i18n.localize("ionrift-respite.shortRest.confirmSpellRecovery.applyAnyway"),
                noLabel: game.i18n.localize("ionrift-respite.shortRest.confirmSpellRecovery.cancel"),
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
                ui.notifications.warn(game.i18n.format("ionrift-respite.shortRest.notify.encounterInterrupted", { dc, roll: rollTotal }));
                return;
            }
            if (isAmber) {
                ui.notifications.info(game.i18n.format("ionrift-respite.shortRest.notify.encounterBelowDc", { dc, roll: rollTotal }));
            } else {
                ui.notifications.info(game.i18n.format("ionrift-respite.shortRest.notify.encounterClear", { dc, roll: rollTotal }));
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
            let pending = actor.getFlag(MODULE_ID, SPELL_RECOVERY_FLAG);
            if (!pending?.selections?.length && this._spellRecoverySelections?.has(actor.id)) {
                const selections = this._spellRecoverySelections.get(actor.id);
                if (selections?.length) {
                    const state = this._spellRecovery.get(actor.id);
                    const recoveryInfo = SpellSlotRecovery.detect(actor);
                    const featureItem = state?.featureItem ?? recoveryInfo.featureItem;
                    if (featureItem) {
                        pending = {
                            featureItemId: featureItem.id,
                            selections: selections.map(([lvl, cnt]) => ({ level: Number(lvl), count: Number(cnt) }))
                        };
                    }
                }
            }
            if (!pending?.selections?.length) continue;

            const featureItem = actor.items.get(pending.featureItemId);
            if (!featureItem) {
                await actor.unsetFlag(MODULE_ID, SPELL_RECOVERY_FLAG);
                this._spellRecovery.delete(actor.id);
                this._spellRecoverySelections?.delete(actor.id);
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
                        content: `<div class="respite-spell-recovery respite-chat-parchment"><i class="fas fa-hat-wizard"></i> ${game.i18n.format("ionrift-respite.shortRest.chat.spellRecovery", { actor: actor.name, feature: featureLabel, slots: slotDesc, used: result.totalLevels, budget: maxBudget })}</div>`,
                        speaker: ChatMessage.getSpeaker({ actor }),
                        whisper: game.users.filter(u => u.isGM).map(u => u.id),
                    });
                } catch (err) {
                    Logger.warn(`${MODULE_ID} | Spell recovery chat message failed:`, err);
                }
            }

            await actor.unsetFlag(MODULE_ID, SPELL_RECOVERY_FLAG);
            this._spellRecovery.delete(actor.id);
            this._spellRecoverySelections?.delete(actor.id);
            this._confirmedRecovery.delete(actor.id);
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
            ui.notifications.info(game.i18n.localize("ionrift-respite.shortRest.notify.completeClassFeatures"));
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
            title: game.i18n.localize("ionrift-respite.shortRest.abandon.title"),
            message: game.i18n.localize("ionrift-respite.shortRest.abandon.message"),
            confirmLabel: game.i18n.localize("ionrift-respite.shortRest.abandon.confirm"),
            cancelLabel: game.i18n.localize("ionrift-respite.shortRest.abandon.cancel")
        });
        if (!proceed) return;

        this._completionPhase = false;
        this._completionSummaryLines = null;

        await this._clearShortRestState();
        emitRestSessionAbandoned("shortrest");
        ui.notifications.info(game.i18n.localize("ionrift-respite.shortRest.notify.abandoned"));
        this._isTerminating = true;
        // Clear Detect Magic glow state before closing so it doesn't persist
        // after an abandoned short rest.
        this._detectMagic?.clearScanSession({ skipSave: true });
        this.close();
    }

    /**
     * Called on GM side when a player spends a hit die.
     */
    receiveCompletionSummary(...args) { return ShortRestContextAndSyncMethods.receiveCompletionSummary.apply(this, args); }
    receiveHdSpent(...args) { return ShortRestContextAndSyncMethods.receiveHdSpent.apply(this, args); }
    receiveStarted(...args) { return ShortRestContextAndSyncMethods.receiveStarted.apply(this, args); }
    receiveSongVolunteer(...args) { return ShortRestContextAndSyncMethods.receiveSongVolunteer.apply(this, args); }
    receiveChefVolunteer(...args) { return ShortRestContextAndSyncMethods.receiveChefVolunteer.apply(this, args); }
    receivePlayerFinished(...args) { return ShortRestContextAndSyncMethods.receivePlayerFinished.apply(this, args); }
    _publishSession(...args) { return ShortRestContextAndSyncMethods._publishSession.apply(this, args); }
    _broadcastSync(...args) { return ShortRestContextAndSyncMethods._broadcastSync.apply(this, args); }
    onReceiveDelta(...args) { return ShortRestContextAndSyncMethods.onReceiveDelta.apply(this, args); }
    onReceiveSync(...args) { return ShortRestContextAndSyncMethods.onReceiveSync.apply(this, args); }
    _exportSnapshot(...args) { return ShortRestContextAndSyncMethods._exportSnapshot.apply(this, args); }
    _rehydrate(...args) { return ShortRestContextAndSyncMethods._rehydrate.apply(this, args); }
    async _saveSessionState(...args) { return ShortRestContextAndSyncMethods._saveSessionState.apply(this, args); }
    _loadShortRestState(...args) { return ShortRestContextAndSyncMethods._loadShortRestState.apply(this, args); }
    async _clearShortRestState(...args) { return ShortRestContextAndSyncMethods._clearShortRestState.apply(this, args); }

    _onRender(context, options) {
        super._onRender?.(context, options);
        registerRestSessionApp("shortrest", this);
        setRespiteFlowActive(true);
        this.element?.classList.toggle("hide-terrain-banners", !!context?.hideTerrainBanner);
    }
}

