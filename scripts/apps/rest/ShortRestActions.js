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

/** All shelter options for short rest. "none" is always shown. */
const SHORT_REST_SHELTERS = [
    { id: "none",      get name() { return game.i18n.localize("ionrift-respite.shortRest.shelter.openAir.name"); },   icon: "fas fa-wind",       get hint() { return game.i18n.localize("ionrift-respite.shortRest.shelter.openAir.hint"); } },
    { id: "rope_trick", get name() { return game.i18n.localize("ionrift-respite.shortRest.shelter.ropeTrick.name"); }, icon: "fas fa-hat-wizard", get hint() { return game.i18n.localize("ionrift-respite.shortRest.shelter.ropeTrick.hint"); },
      identifiers: ["rope-trick"], altNames: ["rope trick"] },
    { id: "tiny_hut",  get name() { return game.i18n.localize("ionrift-respite.shortRest.shelter.tinyHut.name"); },   icon: "fas fa-igloo",      get hint() { return game.i18n.localize("ionrift-respite.shortRest.shelter.tinyHut.hint"); },
      identifiers: ["leomunds-tiny-hut", "tiny-hut", "cozy-cabin", "galders-tower"], altNames: ["leomund's tiny hut", "tiny hut"] },
];

export const ShortRestActionMethods = {
    async persistSpellRecoveryFlag(actor, state) {
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
    },

    async onAddSpellSlot(event, target) {
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
        await ShortRestActionMethods.persistSpellRecoveryFlag(actor, state);
        const selections = [...state.selections.entries()];
        if (!this._spellRecoverySelections) this._spellRecoverySelections = new Map();
        this._spellRecoverySelections.set(actorId, selections);
        this._publishSession("UPDATE_SPELL_RECOVERY", { actorId, selections });
        this.render();
    },

    async onRemoveSpellSlot(event, target) {
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
        await ShortRestActionMethods.persistSpellRecoveryFlag(actor, state);
        this._confirmedRecovery.delete(actorId);
        const selections = [...state.selections.entries()];
        if (!this._spellRecoverySelections) this._spellRecoverySelections = new Map();
        this._spellRecoverySelections.set(actorId, selections);
        this._publishSession("UPDATE_SPELL_RECOVERY", { actorId, selections, unconfirm: true });
        this.render();
    },

    async onConfirmRecovery(event, target) {
        if (this._completionPhase) return;
        const actorId = target.dataset.actorId;
        const actor = game.actors.get(actorId);
        if (!actor) return;
        if (!this._isGM && !actor.isOwner) return;

        this._confirmedRecovery.add(actorId);
        this._publishSession("CONFIRM_SPELL_RECOVERY", { actorId, confirmed: true });
        this.render();
    },

    async onEditRecovery(event, target) {
        if (this._completionPhase) return;
        const actorId = target.dataset.actorId;
        const actor = game.actors.get(actorId);
        if (!actor) return;
        if (!this._isGM && !actor.isOwner) return;

        this._confirmedRecovery.delete(actorId);
        this._publishSession("CONFIRM_SPELL_RECOVERY", { actorId, confirmed: false });
        this.render();
    },

    /**
     * A character is ready once their player has marked the rest finished.
     * Actors with no player owner or whose player controls multiple characters
     * match on the actor id.
     * @param {Actor} actor
     * @returns {boolean}
     */
    isCharacterReady(actor) {
        if (!actor) return false;
        if (this._finishedUsers.has(actor.id)) return true;
        const allUsers = game.users?.contents ?? Array.from(game.users ?? []);
        const ownerUser = allUsers.find(u => !u.isGM && actor.testUserPermission(u, "OWNER"));
        if (!ownerUser) return this._finishedUsers.has(actor.id);
        const party = getPartyActors();
        const ownedInParty = party.filter(a => a.testUserPermission(ownerUser, "OWNER"));
        if (ownedInParty.length <= 1) {
            return this._finishedUsers.has(ownerUser.id);
        }
        return this._finishedUsers.has(actor.id) || this._finishedUsers.has(ownerUser.id);
    },

    onToggleShortRestFinished(event, target) {
        if (this._completionPhase) return;
        event.preventDefault?.();
        const party = getPartyActors();
        const myPartyActors = party.filter(a => a.isOwner);
        const heroId = this._selectedCharacterId || myPartyActors[0]?.id;

        if (myPartyActors.length > 1 && heroId) {
            const heroActor = party.find(a => a.id === heroId);
            const current = ShortRestActionMethods.isCharacterReady.call(this, heroActor);
            const next = !current;
            if (next) this._finishedUsers.add(heroId);
            else this._finishedUsers.delete(heroId);

            const allMineDone = myPartyActors.every(a => (a.id === heroId ? next : ShortRestActionMethods.isCharacterReady.call(this, a)));
            if (allMineDone) this._finishedUsers.add(game.user.id);
            else this._finishedUsers.delete(game.user.id);

            this._publishSession("TOGGLE_ACTOR_READY", { actorId: heroId, ready: next, userId: game.user.id, allReady: allMineDone });
        } else {
            const uid = game.user.id;
            const next = !this._finishedUsers.has(uid);
            if (next) {
                this._finishedUsers.add(uid);
                if (heroId) this._finishedUsers.add(heroId);
            } else {
                this._finishedUsers.delete(uid);
                if (heroId) this._finishedUsers.delete(heroId);
            }
            this._publishSession("PLAYER_FINISHED", { userId: uid, actorId: heroId, finished: next });
        }
        this.render();
    },

    async onToggleActorReady(event, target) {
        if (!this._isGM || this._completionPhase) return;
        event.stopPropagation?.();
        const actorId = target.dataset.actorId || target.closest("[data-actor-id]")?.dataset.actorId;
        if (!actorId) return;
        const party = getPartyActors();
        const actor = party.find(a => a.id === actorId);
        if (!actor) return;
        const current = ShortRestActionMethods.isCharacterReady.call(this, actor);
        const next = !current;
        if (next) this._finishedUsers.add(actorId);
        else this._finishedUsers.delete(actorId);
        this._broadcastSync();
        void this._saveSessionState();
        this.render();
    },

    onTogglePatrolCheck(event, target) {
        if (!this._isGM || this._completionPhase) return;
        this._patrolCheckEnabled = target.type === "checkbox" ? target.checked : !this._patrolCheckEnabled;
        void this._saveSessionState();
        this.render();
    },

    onAdjustShortRestDc(event, target) {
        if (!this._isGM || this._completionPhase) return;
        const delta = Number(target.dataset.delta) || 0;
        const next = Math.max(1, Math.min(30, (this._encounterDc ?? 6) + delta));
        if (next === this._encounterDc) return;
        this._encounterDc = next;
        void this._saveSessionState();
        this.render();
    },

    async onVolunteerSong(event, target) {
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
    },

    async onVolunteerChefMeal(event, target) {
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
    },

    async onOptOutChef(event, target) {
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
    },

    async onClaimChefTreat(event, target) {
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
                        content: ShortRestActionMethods.buildChefMealChat(
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
    },

    async onClaimChefTreatFromBadge(event, target) {
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
        return ShortRestActionMethods.onClaimChefTreat.call(this, event, mockTarget);
    },

    escapeChat(str) {
        const fn = globalThis.foundry?.utils?.escapeHTML;
        return fn ? fn(String(str ?? "")) : String(str ?? "");
    },

    buildChefMealChat(chefName, recipientName, formula, total) {
        const c = ShortRestActionMethods.escapeChat(chefName);
        const r = ShortRestActionMethods.escapeChat(recipientName);
        const f = ShortRestActionMethods.escapeChat(formula);
        return `<div class="respite-chef-meal respite-chat-parchment"><div class="respite-song-title"><i class="fas fa-utensils"></i> ${game.i18n.localize("ionrift-respite.shortRest.chat.replenishingMeal")}</div><p>${game.i18n.format("ionrift-respite.shortRest.chat.chefMealGain", { recipient: r, total, formula: f, chef: c })}</p></div>`;
    },

    /**
     * @param {boolean} isGm
     * @param {Array<{ actorId: string, name: string, line: string }>} lines
     */
    completionRowsForUser(isGm, lines) {
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
    },

    
    buildSongImmediateChat(bardName, recipientName, formula, total) {
        const b = ShortRestActionMethods.escapeChat(bardName);
        const r = ShortRestActionMethods.escapeChat(recipientName);
        const f = ShortRestActionMethods.escapeChat(formula);
        return `<div class="respite-song-of-rest respite-song-of-rest-card respite-chat-parchment"><div class="respite-song-title"><i class="fas fa-music"></i> ${game.i18n.localize("ionrift-respite.shortRest.chat.songOfRest")}</div><p>${game.i18n.format("ionrift-respite.shortRest.chat.songGain", { recipient: r, total, formula: f, bard: b })}</p></div>`;
    },

    /**
     * Chat card when Respite realigns Hit Die HP after the native roll (max die, Durable, Periapt, etc.).
     * @param {string} actorName
     * @param {number} rollTotal Total from the system roll card (before Respite rules)
     * @param {number} adjustedTotal Final Hit Die healing for this spend
     * @param {string[]} annotationLines Modifier labels (e.g. Max HD homebrew)
     * @returns {string}
     */
    buildHitDieCorrectionChat(actorName, rollTotal, adjustedTotal, annotationLines) {
        const n = ShortRestActionMethods.escapeChat(actorName);
        const ann = (annotationLines ?? [])
            .map((line) => ShortRestActionMethods.escapeChat(line))
            .filter(Boolean)
            .join(", ");
        const meta = ann
            ? `<p class="respite-song-meta">${ann}</p>`
            : "";
        return `<div class="respite-hit-die-correction respite-chat-parchment">` +
            `<div class="respite-song-title"><i class="fas fa-heart-pulse"></i> ${game.i18n.localize("ionrift-respite.shortRest.chat.healingSurge")}</div>` +
            `<p>${game.i18n.format("ionrift-respite.shortRest.chat.hitDieCorrection", { name: n, rollTotal, adjustedTotal })}</p>${meta}</div>`;
    },

    
    buildSongEndRestSummaryChat(bardName, entries) {
        const b = ShortRestActionMethods.escapeChat(bardName);
        const rows = entries.map(e =>
            `<li><strong>${ShortRestActionMethods.escapeChat(e.name)}</strong>: ${ShortRestActionMethods.escapeChat(e.formula)}, <strong>+${e.total} HP</strong></li>`
        ).join("");
        return `<div class="respite-song-of-rest respite-song-of-rest-summary respite-chat-parchment"><div class="respite-song-title"><i class="fas fa-music"></i> ${game.i18n.format("ionrift-respite.shortRest.chat.songEndTitle", { bard: b })}</div><p class="respite-song-lead">${game.i18n.localize("ionrift-respite.shortRest.chat.songEndLead")}</p><ul class="respite-song-list">${rows}</ul></div>`;
    },

    onSwitchTab(event, target) {
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
    },

    onSelectWorkbenchRosterActor(event, target) {
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
    },

    onSelectRosterCharacter(event, target) {
        if (this._completionPhase) return;
        const chip = target?.closest?.(".roster-chip, .rest-companion-card, .gm-party-card, [data-actor-id]");
        if (!chip) return;
        const id = chip.dataset.actorId || chip.dataset.rosterId;
        if (!id) return;
        const party = getPartyActors();
        const targetActor = party.find((a) => a.id === id);
        if (!targetActor) return;
        if (!this._isGM && !targetActor.isOwner) return;
        if (id === this._selectedCharacterId) {
            this._selectedCharacterId = this._isGM ? null : id;
        } else {
            this._selectedCharacterId = id;
        }
        if (this._isGM && this._activeTab === "workbench") {
            this._workbenchFocusActorId = this._selectedCharacterId;
            void this._saveSessionState();
            this._broadcastSync();
        }
        this.render();
    },

    onClearSelectedCharacter(event, target) {
        if (!this._isGM) return;
        this._selectedCharacterId = null;
        if (this._activeTab === "workbench") {
            this._workbenchFocusActorId = null;
            void this._saveSessionState();
            this._broadcastSync();
        }
        this.render();
    },

    async onStationDetectMagicScan(event) {
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
    },

    async onStationIdentifyScannedItem(event, target) {
        if (this._completionPhase) return;
        const actorId = target?.dataset?.actorId;
        const itemId = target?.dataset?.itemId;
        if (!actorId || !itemId) return;
        await this._detectMagic.identifyScannedItem(actorId, itemId, getPartyActors);
        if (this._isGM) {
            void this._saveSessionState();
            this._broadcastSync();
        }
    },

    async onSubmitWorkbenchIdentify() {
        if (this._completionPhase) return;
        const el = this.element?.querySelector?.(".station-workbench-identify-embed[data-workbench-actor-id]");
        const actorId = el?.dataset?.workbenchActorId;
        if (!actorId) return;
        await this._workbench.submitFromStation(actorId);
        if (this._isGM) {
            void this._saveSessionState();
            this._broadcastSync();
        }
    },

    onWorkbenchIdentifyRemovePotion(event, target) {
        if (this._completionPhase) return;
        const el = this.element?.querySelector?.(".station-workbench-identify-embed[data-workbench-actor-id]");
        const actorId = el?.dataset?.workbenchActorId;
        if (!actorId) return;
        this._workbench.removePotionFromStation(actorId);
        if (this._isGM) {
            void this._saveSessionState();
            this._broadcastSync();
        }
    },

    async onDismissWorkbenchIdentifyAck() {
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
    },

    
};
