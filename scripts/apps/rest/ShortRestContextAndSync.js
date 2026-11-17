import { Logger } from "../../utils/Logger.js";
import { HitDieModifiers } from "../../services/rest/recovery/HitDieModifiers.js";
import { HitDiceService } from "../../services/rest/recovery/HitDiceService.js";
import { SpellSlotRecovery } from "../../services/rest/recovery/SpellSlotRecovery.js";
import { MODULE_ID } from "../../data/moduleId.js";
import { isWorkbenchIdentifyUiEnabled, matchesShelterSpell } from "../../data/RestConstants.js";
import {
    _showGmShortRestIndicator,
    _removeGmShortRestIndicator
} from "../../module.js";
import { getPartyActors } from "../../services/party/partyActors.js";
import { SHORT_REST_STATE_SCHEMA } from "../../services/rest/session/restSessionSchemas.js";
import {
    emitRestSessionSync,
    emitRestSessionDelta,
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
import { getShortRestRechargeLabels } from "../../services/rest/recovery/ShortRestRecharge.js";
import { RestPresentationHelper } from "../../utils/RestPresentationHelper.js";
import { scanEligibleChefs } from "../../services/meal/buffs/ChefFeat.js";

/** All shelter options for short rest. "none" is always shown. */
const SHORT_REST_SHELTERS = [
    { id: "none",      get name() { return game.i18n.localize("ionrift-respite.shortRest.shelter.openAir.name"); },   icon: "fas fa-wind",       get hint() { return game.i18n.localize("ionrift-respite.shortRest.shelter.openAir.hint"); } },
    { id: "rope_trick", get name() { return game.i18n.localize("ionrift-respite.shortRest.shelter.ropeTrick.name"); }, icon: "fas fa-hat-wizard", get hint() { return game.i18n.localize("ionrift-respite.shortRest.shelter.ropeTrick.hint"); },
      identifiers: ["rope-trick"], altNames: ["rope trick"] },
    { id: "tiny_hut",  get name() { return game.i18n.localize("ionrift-respite.shortRest.shelter.tinyHut.name"); },   icon: "fas fa-igloo",      get hint() { return game.i18n.localize("ionrift-respite.shortRest.shelter.tinyHut.hint"); },
      identifiers: ["leomunds-tiny-hut", "tiny-hut", "cozy-cabin", "galders-tower"], altNames: ["leomund's tiny hut", "tiny hut"] },
];

import { ShortRestActionMethods } from "./ShortRestActions.js";
export const ShortRestContextAndSyncMethods = {
    async _prepareContext(_options) {
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
            if (!spell.altNames && !spell.identifiers) continue;
            const hasCaster = partyActors.some(a =>
                a.items?.some(i => matchesShelterSpell(i, spell))
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
            const isReady = ShortRestActionMethods.isCharacterReady.call(this, a);

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
                        const sessionSelections = this._spellRecoverySelections?.get(a.id);
                        if (Array.isArray(sessionSelections)) {
                            for (const [level, count] of sessionSelections) {
                                selections.set(Number(level), Number(count));
                            }
                        } else {
                            const flag = a.getFlag(MODULE_ID, SPELL_RECOVERY_FLAG);
                            if (flag?.featureItemId === recoveryInfo.featureItem?.id && flag.selections?.length) {
                                for (const { level, count } of flag.selections) {
                                    selections.set(level, count);
                                }
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
                        const sessionSelections = this._spellRecoverySelections?.get(a.id);
                        if (Array.isArray(sessionSelections) && (!a.isOwner || this._isGM)) {
                            state.selections = new Map(sessionSelections.map(([lvl, cnt]) => [Number(lvl), Number(cnt)]));
                        }
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
        const waitingNames = characters.filter(c => !c.isReady).map(c => c.name);
        const canCompleteShortRest = waitingNames.length === 0;
        const completeBlockedHint = waitingNames.length
            ? `Waiting on ${waitingNames.join(", ")}.`
            : "";

        const isRopeTrick = this._activeShelter === "rope_trick";

        // Shelter badge for display (selection happened in setup step; open air is assumed and omitted)
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
            ? ShortRestActionMethods.completionRowsForUser(this._isGM, rawCompletionLines)
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
                myFinished: heroCharacter
                    ? ShortRestActionMethods.isCharacterReady.call(this, partyActors.find(a => a.id === heroCharacter.id) || heroCharacter)
                    : this._finishedUsers.has(game.user.id),
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
                tooltip: game.i18n.localize("ionrift-respite.shortRest.encounterDcStepper.tooltip")
            },
            completionSummaryForUser,
            completionSummaryEmpty,
        };
    },

    /**
     * Extracts Hit Dice info from a DnD5e actor.
     * Derives all data from class items (the source of truth in DnD5e v4/v5).
     * Falls back to system.attributes.hd for older versions.
     */
    _getHitDiceInfo(actor) {
        return HitDiceService.getHitDiceInfo(actor);
    },

    
    _getHdDenomination(actor) {
        return HitDiceService.getHdDenomination(actor);
    },

    
    receiveCompletionSummary(data) {
        const lines = Array.isArray(data?.lines) ? data.lines : [];
        this._completionSummaryLines = lines;
        this._completionPhase = true;
        void this.render(true);
    },

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
    },

    /**
     * Called on player side when GM starts (or re-broadcasts) a short rest.
     */
    receiveStarted(data) {
        this._rehydrate(data);
        if (data.workbench) this.applyWorkbenchStateFromHost(data.workbench);
        this.render({ force: true });
    },

    
    receiveSongVolunteer(data) {
        if (this._completionPhase) return;
        this._songVolunteer = data.songVolunteer ?? null;
        this.render();
    },

    
    receiveChefVolunteer(data) {
        if (this._completionPhase) return;
        SHORT_REST_STATE_SCHEMA.apply(this, data);
        if (data.chefMealBonuses === undefined && !this._chefVolunteer) {
            this._chefMealBonusByActor.clear();
            this._chefMealServedCount = 0;
        }
        this.render();
    },

    /**
     * @param {{ userId?: string, finished?: boolean }} data
     */
    receivePlayerFinished(data) {
        if (this._completionPhase) return;
        if (!data?.userId) return;
        if (data.finished) this._finishedUsers.add(data.userId);
        else this._finishedUsers.delete(data.userId);
        this.render();
    },

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
    },

    _broadcastSync() {
        if (!this._isGM) return;
        emitRestSessionSync("shortrest", this._exportSnapshot());
    },

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
                if (payload.finished) {
                    this._finishedUsers.add(userId);
                    if (payload.actorId) this._finishedUsers.add(payload.actorId);
                } else {
                    this._finishedUsers.delete(userId);
                    if (payload.actorId) this._finishedUsers.delete(payload.actorId);
                }
                break;
            case "TOGGLE_ACTOR_READY":
                if (actorId) {
                    if (payload.ready) this._finishedUsers.add(actorId);
                    else this._finishedUsers.delete(actorId);
                    if (payload.userId) {
                        if (payload.allReady) this._finishedUsers.add(payload.userId);
                        else this._finishedUsers.delete(payload.userId);
                    }
                }
                break;
            case "CONFIRM_SPELL_RECOVERY":
                if (actorId) {
                    if (payload.confirmed) this._confirmedRecovery.add(actorId);
                    else this._confirmedRecovery.delete(actorId);
                }
                break;
            case "UPDATE_SPELL_RECOVERY":
                if (actorId && Array.isArray(payload.selections)) {
                    if (!this._spellRecoverySelections) this._spellRecoverySelections = new Map();
                    this._spellRecoverySelections.set(actorId, payload.selections);
                    if (payload.unconfirm) this._confirmedRecovery.delete(actorId);
                    const state = this._spellRecovery.get(actorId);
                    if (state) {
                        state.selections = new Map(payload.selections.map(([lvl, cnt]) => [Number(lvl), Number(cnt)]));
                    }
                }
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
    },

    /** @param {object} state */
    onReceiveSync(state) {
        if (this._isGM) return;
        this._rehydrate(state);
        this.render();
    },

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
    },

    /**
     * Applies a persisted blob or a live snapshot. AFK only updates when the
     * payload carried it, so a partial chef/song message cannot wipe the set.
     *
     * @param {object} saved
     */
    _rehydrate(saved) {
        SHORT_REST_STATE_SCHEMA.apply(this, saved);
        if (this._spellRecoverySelections) {
            for (const [actorId, selList] of this._spellRecoverySelections.entries()) {
                const state = this._spellRecovery.get(actorId);
                if (state && Array.isArray(selList)) {
                    state.selections = new Map(selList.map(([l, c]) => [Number(l), Number(c)]));
                }
            }
        }
        if (saved?.afkCharacterIds !== undefined) {
            RestAfkState.replaceAll([...this._afkCharacters]);
            pushAllStateToAdapters();
        }
    },

    /**
     * Persists current short rest state to a world setting.
     * GM only. Called on render and after every state-mutating action.
     */
    async _saveSessionState() {
        this._afkCharacters = new Set(RestAfkState.getAfkCharacterIds());
        await SHORT_REST_STATE_SCHEMA.save(this);
    },

    /**
     * Restores short rest state from the world setting.
     * @returns {boolean} True if state was found and restored.
     */
    _loadShortRestState() {
        if (!SHORT_REST_STATE_SCHEMA.load(this)) return false;
        RestAfkState.replaceAll([...this._afkCharacters]);
        pushAllStateToAdapters();
        return true;
    },

    async _clearShortRestState() {
        await SHORT_REST_STATE_SCHEMA.clear();
    },

};
