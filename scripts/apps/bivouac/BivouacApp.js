import { MODULE_ID } from "../../data/moduleId.js";
import { Logger } from "../../utils/Logger.js";
import { getPartyActors } from "../../services/party/partyActors.js";
import { HitDiceService } from "../../services/rest/recovery/HitDiceService.js";
import { HitDieModifiers } from "../../services/rest/recovery/HitDieModifiers.js";
import { SustenanceEngine } from "../../services/rest/gritty/SustenanceEngine.js";
import { ItemClassifier } from "../../services/party/ItemClassifier.js";
import { CampStanceManager } from "./CampStanceManager.js";
import { EncounterDraftService } from "../../services/rest/gritty/EncounterDraftService.js";
import { CalendarHandler } from "../../services/rest/session/CalendarHandler.js";
import { setNativeShortRestUnsuppressed } from "../../services/rest/flow/NativeRestPass.js";
import {
    registerRestSessionApp,
    unregisterRestSessionApp,
    drainPendingRestSessionDeltas,
    emitRestSessionDelta,
    emitRestSessionSync,
    emitRestSessionResolved,
    emitRestSessionAbandoned,
    userControlsActor
} from "../../services/rest/session/RestSessionSync.js";
import { BIVOUAC_STATE_SCHEMA } from "../../services/rest/session/restSessionSchemas.js";
import { setRespiteFlowActive } from "../../module.js";
import { countActorFirewood, findConsumableFirewoodItem } from "../../services/camp/gear/CampGearScanner.js";
import { consumeItem } from "../../services/meal/inventory/MealItemConsumer.js";
import { confirmAbandonRest } from "../rest/confirmAbandonRest.js";
import { getShortRestRechargeLabels } from "../../services/rest/recovery/ShortRestRecharge.js";
import { RestPresentationHelper } from "../../utils/RestPresentationHelper.js";
import { ImageResolver } from "../../utils/ImageResolver.js";
import { WorkbenchDelegate } from "../delegates/crafting/WorkbenchDelegate.js";
import {
    DetectMagicDelegate,
    collectPartyIdentifyEmbedData,
    spawnDetectMagicCastRipple,
    purgeDetectMagicRestArtifacts
} from "../delegates/crafting/DetectMagicDelegate.js";
import { isWorkbenchIdentifyUiEnabled } from "../../data/RestConstants.js";
import { BaseShortRestApp } from "../rest/BaseShortRestApp.js";

/**
 * Bivouac HUD Application.
 * Single-screen overnight management for Gritty Realism 8-hour short rests.
 */
export class BivouacApp extends BaseShortRestApp {

    static DEFAULT_OPTIONS = {
        id: "ionrift-bivouac-hud",
        classes: ["ionrift-window", "glass-ui", "bivouac-hud-window"],
        tag: "div",
        window: {
            title: "Overnight Rest",
            resizable: true,
        },
        position: {
            width: 720,
            height: "auto"
        },
        actions: {
            abandonBivouac: BivouacApp.#onAbandonBivouac,
            toggleStance: BivouacApp.#onToggleStance,
            volunteerSong: BivouacApp.#onVolunteerSong,
            volunteerChef: BivouacApp.#onVolunteerChef,
            volunteerChefMeal: BivouacApp.#onVolunteerChef,
            optOutChef: BivouacApp.#onOptOutChef,
            claimChefFromBadge: BivouacApp.#onClaimChefMealFromBadge,
            claimChefTreatFromBadge: BivouacApp.#onClaimChefMealFromBadge,
            claimChefTreat: BivouacApp.#onClaimChefTreat,
            spendHitDie: BivouacApp.#onSpendHitDie,
            swapPlateFood: BivouacApp.#onSwapPlateFood,
            swapPlateWater: BivouacApp.#onSwapPlateWater,
            passTheNight: BivouacApp.#onPassTheNight,
            adjustBivouacDC: BivouacApp.#onAdjustBivouacDC,
            switchBivouacTab: BivouacApp.#onSwitchTab,
            selectRosterCharacter: BivouacApp.#onSelectRosterCharacter,
            selectWorkbenchRosterActor: BivouacApp.#onSelectWorkbenchRosterActor,
            stationDetectMagicScan: BivouacApp.#onStationDetectMagicScan,
            stationIdentifyScannedItem: BivouacApp.#onStationIdentifyScannedItem,
            submitWorkbenchIdentify: BivouacApp.#onSubmitWorkbenchIdentify,
            workbenchIdentifyRemovePotion: BivouacApp.#onWorkbenchIdentifyRemovePotion,
            dismissWorkbenchIdentifyAck: BivouacApp.#onDismissWorkbenchIdentifyAck,
            toggleBivouacFinished: BivouacApp.#onToggleBivouacFinished,
            toggleUiTheme: BaseShortRestApp.onToggleUiTheme
        }
    };

    static PARTS = {
        main: {
            template: "modules/ionrift-respite/templates/bivouac/bivouac-hud.hbs"
        }
    };

    /** @type {CampStanceManager} */
    _campStanceManager;

    /** @type {boolean} */
    _chefVolunteered = false;

    /** @type {object|null} */
    _chefVolunteer = null;

    /** @type {object|null} */
    _songVolunteer = null;

    /** @type {Map<string, object>} actorId -> song bonus record */
    _songBonusByActor = new Map();

    /** @type {Map<string, object>} actorId -> chef meal record */
    _chefMealBonusByActor = new Map();

    /** @type {Map<string, string>} actorId -> selected itemId */
    _plateChoices = new Map();

    /** @type {Map<string, string>} actorId -> selected water itemId */
    _waterChoices = new Map();

    /** @type {boolean} GM Safe Passage toggle */
    _safePassage = false;

    /** @type {number} */
    _dangerDC = 15;

    /** @type {Map<string, Array<object>>} actorId -> roll history */
    _rolls = new Map();

    /** @type {string} */
    _terrainTag = "forest";

    /** @type {string} "camp" | "workbench" */
    _activeTab = "camp";

    /** @type {WorkbenchDelegate} */
    _workbench;

    /** @type {DetectMagicDelegate} */
    _detectMagic;

    /** @type {string|null} */
    _workbenchFocusActorId = null;

    /** @type {Map<string, object>} actorId -> staging */
    _workbenchIdentifyStaging = new Map();

    /** @type {Map<string, object>} actorId -> ack */
    _workbenchIdentifyAcknowledge = new Map();

    /** @type {Set<string>} actorIds whose submit is processing */
    _workbenchIdentifySubmitPending = new Set();

    /** @type {Set<string>} actorIds who used focus */
    _workbenchFocusUsed = new Set();

    /** @type {Map<string, number>} actorId -> count of items focused */
    _workbenchFocusCounts = new Map();

    /** @type {object|null} */
    _magicScanResults = null;

    /** @type {boolean} */
    _magicScanComplete = false;

    /** @type {number|null} */
    _workbenchHookId = null;

    constructor(options = {}) {
        super(options);
        this._isGM = game.user?.isGM ?? false;
        this._terrainTag = options.terrainTag ?? "forest";
        this._safePassage = options.safePassage ?? false;
        this._dangerDC = options.dangerDC ?? options.baseDC ?? 15;
        this._activeTab = options.activeTab ?? "camp";

        const party = getPartyActors();
        const shelterDetected = CampStanceManager.autoDetectShelter(party);
        this._campStanceManager = new CampStanceManager({
            stance: options.stance ?? "warm",
            shelterActive: shelterDetected
        });

        // Chef status
        const chefStatus = SustenanceEngine.getChefStatus(party, this._campStanceManager.stance);
        if (chefStatus.eligible && chefStatus.leadChef) {
            this._chefVolunteer = { ...chefStatus.leadChef };
        }

        this._workbench = new WorkbenchDelegate(this);
        this._detectMagic = new DetectMagicDelegate(this);

        /** User IDs who signalled they are done with bivouac actions (synced). */
        this._finishedUsers = new Set();

        registerRestSessionApp("bivouac", this);
        setRespiteFlowActive(true);
    }

    /**
     * Focus budget: 1 item per character for an 8-hour bivouac rest (DMG p.136).
     * @param {string} actorId
     * @returns {number}
     */
    getFocusBudget(actorId) {
        return 1;
    }

    _onRender(context, options) {
        super._onRender(context, options);
        registerRestSessionApp("bivouac", this);
        setRespiteFlowActive(true);
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
    }

    async close(options = {}) {
        unregisterRestSessionApp("bivouac");
        if (this._workbenchHookId) {
            Hooks.off(`${MODULE_ID}.workbenchIdentifyStagingTouched`, this._workbenchHookId);
            this._workbenchHookId = null;
        }
        // Every client sets this on open, so every client has to clear it.
        if (options.resolved || options.abandoned) setRespiteFlowActive(false);
        if (this._isGM) {
            if (options.resolved || options.abandoned) {
                BIVOUAC_STATE_SCHEMA.clear().catch(() => {});
            } else {
                // Closing the window is not ending the rest. Keep world state
                // so the GM can reopen or reload back into the session.
                await this._saveSessionState();
            }
        }
        return super.close(options);
    }

    /**
     * Persists current state to world settings so GM F5 can recover.
     */
    async _saveSessionState() {
        await BIVOUAC_STATE_SCHEMA.save(this);
    }

    /**
     * Determines whether an actor is eating the Chef's Replenishing Meal during this Bivouac.
     * @param {string} actorId
     * @param {Actor[]} [party]
     * @returns {boolean}
     */
    _isActorChefFed(actorId, party = getPartyActors()) {
        if (!this._chefVolunteered || !this._chefVolunteer) return false;
        const settingVal = game.settings?.get?.(MODULE_ID, "chefTreatsProvideSustenance");
        const treatsProvideSustenance = typeof settingVal === "boolean" ? settingVal : true;
        if (!treatsProvideSustenance) return false;
        return this._plateChoices.get(actorId) === "chef";
    }

    /**
     * Exports a snapshot for socket transmission to players.
     * @returns {object}
     */
    _exportSnapshot() {
        return BIVOUAC_STATE_SCHEMA.serializeForPlayers(this);
    }

    /**
     * Rehydrates state from a saved settings object or socket snapshot.
     * @param {object} saved
     */
    _rehydrate(saved) {
        BIVOUAC_STATE_SCHEMA.apply(this, saved);
        drainPendingRestSessionDeltas("bivouac");
    }

    async _prepareContext(options) {
        drainPendingRestSessionDeltas("bivouac");
        const isGM = this._isGM;
        const party = getPartyActors();

        const workbenchIdentifyUiEnabled = isWorkbenchIdentifyUiEnabled();
        if (!workbenchIdentifyUiEnabled && this._activeTab === "workbench") {
            this._activeTab = "camp";
        }
        const gmWorkbenchRosterPick = isGM && this._activeTab === "workbench";
        if (isGM && party.length) {
            const valid = this._workbenchFocusActorId
                && party.some((a) => a.id === this._workbenchFocusActorId);
            if (!valid) {
                this._workbenchFocusActorId = party[0].id;
            }
        }

        const outlanderStatus = SustenanceEngine.scanOutlander(party, this._terrainTag);
        const foragerName = outlanderStatus.outlanderActor?.name ?? "";
        const fireWarmthSetting = game.settings.get(MODULE_ID, "shortRestFireWarmth") ?? "none";
        const showCampfireRibbon = fireWarmthSetting !== "none";
        const fireWarmthLabel = fireWarmthSetting === "1" ? "+1" : (fireWarmthSetting === "1d4" ? "+1d4" : "");
        const effectiveStance = showCampfireRibbon ? this._campStanceManager.stance : "warm";
        const chefStatus = SustenanceEngine.getChefStatus(party, effectiveStance);

        const { allowed, remainingMs } = this._campStanceManager.canToggle(game.user.id, isGM);
        const stanceCooldownSeconds = Math.ceil(remainingMs / 1000);

        const canManageChef = isGM || (this._chefVolunteer ? game.actors.get(this._chefVolunteer.actorId)?.isOwner : false);

        // Build readiness set: an actor is "ready" when its owner player has
        // toggled their finished flag. Map _finishedUsers (user IDs) → actor IDs.
        const finishedActorIds = new Set();
        for (const actor of party) {
            const ownerUser = game.users.find(u => !u.isGM && u.active && actor.testUserPermission(u, "OWNER"));
            if (ownerUser && this._finishedUsers.has(ownerUser.id)) {
                finishedActorIds.add(actor.id);
            }
        }

        const selectedId = this._selectedCharacterId || (!isGM ? (party.find(a => a.isOwner)?.id ?? party[0]?.id) : null);
        this._selectedCharacterId = this._selectedCharacterId ?? null;

        const partyRoster = RestPresentationHelper.getPartyRosterPills(party, { finishedActorIds });
        const roster = RestPresentationHelper.getPartyRoster(party, {
            selectedCharacterId: selectedId,
            finishedActorIds,
            isGM
        });

        const eligibleBards = HitDieModifiers.scanAllEligibleBards(party);
        const songAlreadyClaimed = !!this._songVolunteer;

        const claimedChefActorIds = new Set([
            ...this._chefMealBonusByActor.keys(),
            ...Array.from(this._plateChoices.entries()).filter(([_, choice]) => choice === "chef").map(([id]) => id)
        ]);
        const chefMealCapacity = this._chefVolunteer?.mealCapacity ?? 4;
        const mealsRemaining = this._chefVolunteer
            ? Math.max(0, chefMealCapacity - claimedChefActorIds.size)
            : 0;

        const characters = party.map(actor => {
            const isOwner = isGM || actor.isOwner;
            const pres = RestPresentationHelper.getActorPresentation(actor);
            const hp = actor.system?.attributes?.hp ?? { value: 0, max: 0 };
            const hpValue = hp.value ?? 0;
            const hpMax = hp.max ?? 1;
            const hpPercent = Math.clamp(Math.round((hpValue / hpMax) * 100), 0, 100);

            const hdData = HitDiceService.getHitDiceInfo(actor);
            const rolls = this._rolls.get(actor.id) ?? [];
            const hdSpentThisRest = rolls.length;
            const hdHealedTotal = rolls.reduce((sum, r) => sum + (r.total ?? 0), 0);

            // Sustenance display
            const isChefFed = this._isActorChefFed(actor.id, party);
            const isOutlanderShielded = !isChefFed && outlanderStatus.isEligible;
            let platedItem = null;

            const choice = this._plateChoices.get(actor.id);
            if (choice === "starve") {
                // Fasting explicitly selected
            } else if (choice === "forage") {
                // Outlander wild forage explicitly selected
            } else if (choice && choice !== "chef") {
                platedItem = actor.items?.get(choice) ?? null;
            } else if (!isChefFed && !isOutlanderShielded) {
                platedItem = SustenanceEngine.getProtectedShelfCandidate(actor).item;
            }

            const isStarving = !isChefFed && !isOutlanderShielded && !platedItem;

            // Water display - personal inventory only
            let waterPlate = null;
            if (isOutlanderShielded) {
                waterPlate = {
                    isShielded: true,
                    label: "Spring Water",
                    tooltip: `${outlanderStatus.label} provides fresh drinking water for camp.`
                };
            } else {
                const wChoice = this._waterChoices.get(actor.id);
                let waterItem = null;

                if (wChoice === "thirsty") {
                    // Thirsty explicitly selected
                } else if (wChoice) {
                    waterItem = actor.items?.get(wChoice) ?? null;
                } else {
                    waterItem = SustenanceEngine.getCandidateWater(actor);
                }

                if (waterItem) {
                    waterPlate = {
                        isWater: true,
                        label: waterItem.name,
                        tooltip: `Personal water: ${waterItem.name}. Click to cycle drink options.`,
                        canInteract: isOwner
                    };
                } else {
                    waterPlate = {
                        isDehydrated: true,
                        label: "Dehydrated (+1 Rest)",
                        tooltip: "No water selected! Resting without water will advance dehydration. Click to check or select available drink.",
                        canInteract: isOwner
                    };
                }
            }

            // Bard Song of Rest feature trigger & bonuses
            const bardInfo = eligibleBards.find(b => b.actorId === actor.id);
            const isEligibleBard = !!bardInfo;
            const canInteractSong = isEligibleBard && isOwner;
            const hasVolunteeredSong = this._songVolunteer?.actorId === actor.id;
            const songVolunteerLocked = songAlreadyClaimed && !hasVolunteeredSong;
            const bardSongDie = bardInfo?.songDie ?? null;

            const songBonusRecord = this._songBonusByActor.get(actor.id);
            const songBonusTotal = songBonusRecord?.total ?? 0;
            const chefMealRecord = this._chefMealBonusByActor.get(actor.id);
            const chefMealTotal = chefMealRecord?.total ?? 0;

            let songCard = null;
            if (this._songVolunteer) {
                if (songBonusRecord) {
                    songCard = {
                        isAppliedImmediate: true,
                        total: songBonusRecord.total,
                        formula: songBonusRecord.formula,
                        kind: "applied",
                    };
                } else {
                    songCard = {
                        isPendingEnd: true,
                        die: this._songVolunteer.songDie,
                        kind: "pending",
                    };
                }
            }

            // Chef cooking & treat claiming
            const chefInfo = chefStatus.chefs?.find(c => c.actorId === actor.id);
            const isEligibleChef = !!chefInfo;
            const cookingDisabled = showCampfireRibbon && !this._campStanceManager.cookingAllowed;
            const canInteractChef = isEligibleChef && isOwner && !cookingDisabled;
            const hasVolunteeredChef = this._chefVolunteered && (this._chefVolunteer?.actorId === actor.id);
            const chefVolunteerLocked = this._chefVolunteered && (this._chefVolunteer?.actorId !== actor.id);
            const actorChefCapacity = chefInfo?.mealCapacity ?? 4;

            const hasClaimedChefTreat = claimedChefActorIds.has(actor.id);
            const canClaimChefTreat = !hasClaimedChefTreat && !!this._chefVolunteered && !!this._chefVolunteer && mealsRemaining > 0 && isOwner && !cookingDisabled;

            // Class recharge badges: quiet passive badges (no exclusion of Second Wind!)
            const srRechargeBadges = getShortRestRechargeLabels(actor);

            const isHighHd = hdData.max > 10;
            const hdPips = [];
            const pipCount = Math.min(hdData.max, 20);
            for (let i = 1; i <= pipCount; i++) {
                hdPips.push({
                    index: i,
                    filled: i <= hdData.remaining,
                    spent: i > hdData.remaining
                });
            }

            const allUsers = game.users?.contents ?? Array.from(game.users ?? []);
            const ownerUser = allUsers.find(u => !u.isGM && actor.testUserPermission(u, "OWNER"));
            const isReady = ownerUser ? this._finishedUsers.has(ownerUser.id) : (this._finishedUsers.has(actor.id) || false);

            return {
                id: actor.id,
                name: actor.name,
                img: actor.img,
                initial: pres.initial,
                subtext: pres.subtext,
                themeGradient: pres.themeGradient,
                themeBorder: pres.themeBorder,
                isSelfCard: actor.isOwner,
                isOwner,
                isReady,
                canInteract: isOwner,
                hpValue,
                hpMax,
                hpPercent,
                isFullHp: hpValue >= hpMax,
                hdRemaining: hdData.remaining,
                hdMax: hdData.max,
                hdDie: hdData.die,
                hdPips,
                isHighHd,
                hdSpentThisRest,
                hdHealedTotal,
                rolls,
                rollsCompressed: rolls.length > 3,
                rollsToShow: rolls.slice(-3),
                rollsHidden: Math.max(0, rolls.length - 3),
                totalHealed: hdHealedTotal,
                songBonusTotal,
                chefMealTotal,
                chefMealRecord,
                hasClaimedChefTreat,
                canClaimChefTreat,
                chefMealsRemaining: mealsRemaining,
                songCard,
                isOutlanderShielded,
                foragerName,
                isChefFed,
                platedItem,
                isStarving,
                waterPlate,
                isEligibleBard,
                canInteractSong,
                canVolunteerSong: canInteractSong && !songAlreadyClaimed,
                hasVolunteeredSong,
                songVolunteerLocked,
                bardSongDie,
                isEligibleChef,
                canInteractChef,
                hasVolunteeredChef,
                canVolunteerChef: canInteractChef && !this._chefVolunteered,
                chefVolunteerLocked,
                chefMealCapacity: actorChefCapacity,
                cookingDisabled,
                srRechargeBadges,
                hasFeatures: Boolean(isEligibleBard || isEligibleChef || (srRechargeBadges && srRechargeBadges.length)),
                canTriggerFeatures: Boolean(canInteractSong || canInteractChef),
                isWorkbenchFocus: gmWorkbenchRosterPick && this._workbenchFocusActorId === actor.id
            };
        });

        // Firewood inventory scan across party
        const totalFirewood = party.reduce((sum, a) => sum + countActorFirewood(a), 0);
        const firewoodCost = (showCampfireRibbon && this._campStanceManager.isWarm) ? 1 : 0;

        const isGmNeutralView = isGM && !this._selectedCharacterId;
        const heroCharacter = selectedId ? (characters.find(c => c.id === selectedId) || null) : null;
        if (heroCharacter) heroCharacter.hasSustenanceSlot = true;
        characters.forEach(c => { c.hasSustenanceSlot = true; });
        const companionCharacters = heroCharacter ? characters.filter(c => c.id !== heroCharacter.id) : [];

        const readyCount = characters.filter(c => c.isReady).length;
        const totalPartyCount = characters.length;
        const allCharactersReady = totalPartyCount > 0 && readyCount === totalPartyCount;

        return {
            isGM,
            isGmNeutralView,
            readyCount,
            totalPartyCount,
            allCharactersReady,
            isGritty: true,
            activeTab: this._activeTab,
            workbenchIdentifyUiEnabled,
            gmWorkbenchRosterPick,
            workbenchEmbed: workbenchIdentifyUiEnabled ? this._getWorkbenchEmbedContext() : null,
            terrainLabel: this._terrainTag.charAt(0).toUpperCase() + this._terrainTag.slice(1),
            showCampfireRibbon,
            fireWarmthSetting,
            fireWarmthLabel,
            isWarm: this._campStanceManager.isWarm,
            isColdDark: this._campStanceManager.isColdDark,
            totalFirewood,
            firewoodCost,
            shelterActive: this._campStanceManager.shelterActive,
            stanceCooldownSeconds,
            outlanderStatus: {
                ...outlanderStatus,
                foragerName
            },
            chefStatus,
            chefVolunteered: this._chefVolunteered,
            chefVolunteer: this._chefVolunteer,
            chefMealsRemaining: mealsRemaining,
            mealsRemaining,
            songOfRest: this._songVolunteer ? {
                bardName: this._songVolunteer.bardName,
                songDie: this._songVolunteer.songDie
            } : null,
            canManageChef,
            safePassage: this._safePassage,
            dangerDC: this._dangerDC,
            partyRoster,
            roster,
            characters,
            heroCharacter,
            companionCharacters,
            ...ImageResolver.resolveRestBannerContext(this._terrainTag, "night"),
            ...RestPresentationHelper.resolveRestHeaderContext({
                type: "bivouac",
                terrainTag: this._terrainTag,
                terrainLabel: this._terrainTag.charAt(0).toUpperCase() + this._terrainTag.slice(1),
                abandonAction: "abandonBivouac",
                isGM
            }),
            bivouacFooter: {
                myFinished: this._finishedUsers.has(game.user.id),
            }
        };
    }

    // ─── Socket Delta Handlers ──────────────────────────────────────────

    /**
     * GM receives delta from a player client and updates state authoritatively.
     * @param {string} action
     * @param {object} payload
     * @param {string} userId
     */
    onReceiveDelta(action, payload, userId) {
        if (!this._isGM) return;

        // Deltas naming an actor are only honoured from a user who owns it.
        const actorId = payload?.actorId;
        if (actorId && !userControlsActor(userId, actorId)) {
            Logger.warn(`${MODULE_ID} | Rejected Bivouac ${action} for unowned actor ${actorId}`);
            return;
        }

        switch (action) {
            case "CAMP_STANCE": {
                this._campStanceManager.setStance(payload.stance, userId, false);
                break;
            }
            case "VOLUNTEER_CHEF": {
                if (this._campStanceManager.cookingAllowed) {
                    if (payload?.actorId) {
                        const party = getPartyActors();
                        const chefStatus = SustenanceEngine.getChefStatus(party, this._campStanceManager.stance);
                        const chef = chefStatus.chefs?.find(c => c.actorId === payload.actorId);
                        if (chef) this._chefVolunteer = { ...chef };
                    }
                    this._chefVolunteered = true;
                }
                break;
            }
            case "VOLUNTEER_SONG": {
                if (payload?.actorId) {
                    const party = getPartyActors();
                    const bards = HitDieModifiers.scanAllEligibleBards(party);
                    const bard = bards.find(b => b.actorId === payload.actorId);
                    this._songVolunteer = bard ? { ...bard } : null;
                } else {
                    this._songVolunteer = null;
                }
                break;
            }
            case "OPTOUT_CHEF": {
                this._chefVolunteered = false;
                this._chefMealBonusByActor.clear();
                break;
            }
            case "CLAIM_CHEF_TREAT": {
                if (payload?.actorId) {
                    if (payload.plateChoice) {
                        this._plateChoices.set(payload.actorId, payload.plateChoice);
                    }
                    if (payload.chefBonus) {
                        this._chefMealBonusByActor.set(payload.actorId, payload.chefBonus);
                    }
                }
                break;
            }
            case "SWAP_PLATE": {
                if (payload.actorId && payload.itemId) {
                    this._plateChoices.set(payload.actorId, payload.itemId);
                }
                break;
            }
            case "SWAP_WATER": {
                if (payload.actorId && payload.itemId) {
                    this._waterChoices.set(payload.actorId, payload.itemId);
                }
                break;
            }
            case "SPEND_HIT_DIE": {
                const { roll, chefBonus, songBonus } = payload;
                if (actorId && roll) {
                    if (!this._rolls.has(actorId)) this._rolls.set(actorId, []);
                    this._rolls.get(actorId).push(roll);
                }
                if (actorId && chefBonus) {
                    this._chefMealBonusByActor.set(actorId, chefBonus);
                }
                if (actorId && songBonus) {
                    this._songBonusByActor.set(actorId, songBonus);
                }
                break;
            }
            case "WORKBENCH_STAGING": {
                this.applyWorkbenchStagingFromPlayer(payload);
                return;
            }
            case "WORKBENCH_ACK_DISMISS": {
                if (payload.actorId) {
                    this._workbench.dismissAcknowledgement(payload.actorId);
                    this._saveSessionState();
                    this._broadcastSync();
                }
                return;
            }
            case "PLAYER_FINISHED": {
                if (payload.userId !== userId) return;
                if (payload.finished) this._finishedUsers.add(userId);
                else this._finishedUsers.delete(userId);
                break;
            }
            default:
                Logger.warn(`${MODULE_ID} | Unrecognised Bivouac delta:`, action);
        }

        this._broadcastSync();
        this.render();
        this._saveSessionState();
    }

    /**
     * Player client receives authoritative sync state from GM.
     * @param {object} state
     */
    onReceiveSync(state) {
        if (this._isGM) return;
        BIVOUAC_STATE_SCHEMA.apply(this, state);
        if (state.workbenchStaging || state.workbenchAck) {
            this.applyWorkbenchStateFromHost(state);
        } else {
            this.render();
        }
    }

    _broadcastSync() {
        if (!this._isGM) return;
        emitRestSessionSync("bivouac", BIVOUAC_STATE_SCHEMA.serializeForPlayers(this));
    }

    _onWorkbenchStagingTouchedFromHook() {
        if (!this._isGM) return;
        emitRestSessionDelta("bivouac", "WORKBENCH_STAGING", {
            workbenchFocusActorId: this._workbenchFocusActorId,
            staging: Array.from(this._workbenchIdentifyStaging?.entries() ?? [])
        });
    }

    applyWorkbenchStagingFromPlayer(data) {
        if (!data?.staging) return;
        for (const [actorId, st] of data.staging) {
            this._workbench.setStaging(actorId, {
                gearItemId: st.gearItemId,
                gearActorId: st.gearActorId,
                potionItemId: st.potionItemId,
                spellItemId: st.spellItemId,
                spellActorId: st.spellActorId
            });
        }
        if (data.workbenchFocusActorId) {
            this._workbenchFocusActorId = data.workbenchFocusActorId;
        }
        this.render();
        this._saveSessionState();
    }

    applyWorkbenchStateFromHost(data) {
        this._workbenchIdentifyStaging = new Map(data.workbenchStaging ?? []);
        this._workbenchIdentifyAcknowledge = new Map(data.workbenchAck ?? []);
        this._magicScanResults = data.magicScanResults ?? null;
        this._magicScanComplete = !!data.magicScanComplete;
        if (data.workbenchFocusActorId !== undefined) {
            this._workbenchFocusActorId = data.workbenchFocusActorId;
        }
        if (data.activeTab !== undefined) {
            this._activeTab = data.activeTab;
        }
        this.render();
    }

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

    // ─── User Event Handlers ─────────────────────────────────────────────

    static async #onAbandonBivouac(event, target) {
        if (!this._isGM) return;

        const confirmed = await confirmAbandonRest({
            title: "Abandon Rest?",
            message: "This will cancel the rest for all players. Any unsaved progress will be lost."
        });
        if (!confirmed) return;

        emitRestSessionAbandoned("bivouac");
        ui.notifications?.info?.("Rest abandoned.");
        this.close({ abandoned: true });
    }

    static #onToggleStance(event, target) {
        const stance = target.dataset.stance;
        const userId = game.user.id;
        const isGM = this._isGM;

        if (isGM) {
            this._campStanceManager.setStance(stance, userId, true);
            this._broadcastSync();
            this.render();
        } else {
            const { allowed } = this._campStanceManager.canToggle(userId, false);
            if (!allowed) {
                ui.notifications.warn("Camp stance toggle is on cooldown.");
                return;
            }
            // Start the local cooldown too. Without this the player can spam
            // toggles that the GM then rejects, and the UI flips and reverts.
            this._campStanceManager.noteToggle(userId);
            emitRestSessionDelta("bivouac", "CAMP_STANCE", { stance });
        }
        this._saveSessionState();
    }

    static #onVolunteerChef(event, target) {
        if (!this._campStanceManager.cookingAllowed) {
            ui.notifications.warn("Cooking is disabled in a Cold & Dark camp.");
            return;
        }

        const actorId = target?.dataset?.actorId;
        const party = getPartyActors();
        const chefStatus = SustenanceEngine.getChefStatus(party, this._campStanceManager.stance);
        const chef = (actorId ? chefStatus.chefs?.find(c => c.actorId === actorId) : null) ?? chefStatus.leadChef;
        if (chef) {
            this._chefVolunteer = { ...chef };
        }

        if (this._isGM) {
            this._chefVolunteered = true;
            this._broadcastSync();
            this.render();
        } else {
            emitRestSessionDelta("bivouac", "VOLUNTEER_CHEF", {
                actorId: this._chefVolunteer?.actorId ?? actorId
            });
        }
        this._saveSessionState();
    }

    static #onOptOutChef(event, target) {
        if (this._isGM) {
            this._chefVolunteered = false;
            this._chefMealBonusByActor.clear();
            this._broadcastSync();
            this.render();
        } else {
            emitRestSessionDelta("bivouac", "OPTOUT_CHEF", {});
        }
        this._saveSessionState();
    }

    static async #onVolunteerSong(event, target) {
        const actorId = target?.dataset?.actorId;
        if (!actorId) return;
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

        if (this._isGM) {
            this._broadcastSync();
            this.render();
        } else {
            emitRestSessionDelta("bivouac", "VOLUNTEER_SONG", {
                actorId: this._songVolunteer?.actorId ?? null
            });
        }
        this._saveSessionState();
    }

    static async #onClaimChefTreat(event, target) {
        const actorId = target?.dataset?.actorId;
        if (!actorId) return;
        const actor = game.actors.get(actorId);
        if (!actor) return;
        if (!this._isGM && !actor.isOwner) return;

        if (!this._chefVolunteered || !this._chefVolunteer) return;
        if (!this._campStanceManager.cookingAllowed) {
            ui.notifications?.warn?.("Cooking is not permitted in a cold camp.");
            return;
        }

        const claimedActorIds = new Set([
            ...this._chefMealBonusByActor.keys(),
            ...Array.from(this._plateChoices.entries()).filter(([_, choice]) => choice === "chef").map(([id]) => id)
        ]);

        if (claimedActorIds.has(actorId)) return;

        const capacity = this._chefVolunteer.mealCapacity ?? 4;
        if (claimedActorIds.size >= capacity) {
            ui.notifications?.warn?.("No servings of the Chef's meal remaining.");
            return;
        }

        const settingVal = game.settings?.get?.(MODULE_ID, "chefTreatsProvideSustenance");
        const treatsProvideSustenance = typeof settingVal === "boolean" ? settingVal : true;
        if (treatsProvideSustenance) {
            this._plateChoices.set(actorId, "chef");
        }

        const rolls = this._rolls.get(actorId) ?? [];
        const hasSpentHd = rolls.length > 0;

        const chefBonusRecord = {
            claimed: true,
            applied: false,
            chefName: this._chefVolunteer.chefName,
            total: 0,
            formula: "1d8",
        };

        if (hasSpentHd) {
            const appliedChefBonus = await HitDiceService.applyChefBonus(actor, this._chefVolunteer);
            if (appliedChefBonus) {
                chefBonusRecord.applied = true;
                chefBonusRecord.total = appliedChefBonus.total;
                chefBonusRecord.formula = appliedChefBonus.formula;
            }
        }

        this._chefMealBonusByActor.set(actorId, chefBonusRecord);

        if (this._isGM) {
            this._broadcastSync();
            this.render();
        } else {
            emitRestSessionDelta("bivouac", "CLAIM_CHEF_TREAT", {
                actorId,
                plateChoice: treatsProvideSustenance ? "chef" : null,
                chefBonus: chefBonusRecord
            });
        }
        this._saveSessionState();
    }

    static async #onClaimChefMealFromBadge(event, target) {
        if (event?.target?.closest?.(".btn-chef-optout")) return;
        if (!this._chefVolunteered || !this._chefVolunteer) return;

        const party = getPartyActors();
        const candidate = party.find(a => (this._isGM ? true : a.isOwner) && !this._chefMealBonusByActor.has(a.id) && this._plateChoices.get(a.id) !== "chef");
        if (!candidate) {
            ui.notifications?.info?.("All your party members already have a Chef treat.");
            return;
        }

        return BivouacApp.#onClaimChefTreat.call(this, event, { dataset: { actorId: candidate.id } });
    }

    static async #onSpendHitDie(event, target) {
        const actorId = target.dataset.actorId;
        const actor = game.actors.get(actorId);
        if (!actor) return;
        if (!this._isGM && !actor.isOwner) return;

        const spendResult = await HitDiceService.spendHitDie(actor);
        if (!spendResult) return;

        // Record roll locally
        if (!this._rolls.has(actorId)) this._rolls.set(actorId, []);
        this._rolls.get(actorId).push({
            total: spendResult.adjustedTotal,
            die: spendResult.die,
            conMod: spendResult.conMod,
            annotations: spendResult.annotations
        });

        // Apply Song of Rest bonus if volunteered and not yet applied to this actor
        let appliedSongBonus = null;
        if (this._songVolunteer?.songDie && !this._songBonusByActor.has(actorId)) {
            appliedSongBonus = await HitDiceService.applySongBonus(actor, this._songVolunteer);
            if (appliedSongBonus) {
                this._songBonusByActor.set(actorId, appliedSongBonus);
            }
        }

        // Apply Chef bonus if volunteered and treat claimed (or chef fed), and not yet applied
        const existingChef = this._chefMealBonusByActor.get(actorId);
        const party = getPartyActors();
        const hasClaimedChef = (existingChef && !existingChef.applied) || (!existingChef && this._isActorChefFed(actorId, party));
        let appliedChefBonus = null;
        if (this._chefVolunteered && this._chefVolunteer && hasClaimedChef) {
            appliedChefBonus = await HitDiceService.applyChefBonus(actor, this._chefVolunteer);
            if (appliedChefBonus) {
                const record = {
                    claimed: true,
                    applied: true,
                    chefName: this._chefVolunteer.chefName,
                    total: appliedChefBonus.total,
                    formula: appliedChefBonus.formula
                };
                this._chefMealBonusByActor.set(actorId, record);
            }
        }

        // Apply Warm Camp bonus if enabled and stance is warm
        const fireWarmthSetting = game.settings.get(MODULE_ID, "shortRestFireWarmth") ?? "none";
        let appliedWarmthBonus = null;
        if (fireWarmthSetting !== "none" && this._campStanceManager?.isWarm) {
            appliedWarmthBonus = await HitDiceService.applyWarmthBonus(actor, fireWarmthSetting);
            if (appliedWarmthBonus) {
                spendResult.adjustedTotal += appliedWarmthBonus.total;
                spendResult.annotations = spendResult.annotations || [];
                spendResult.annotations.push(`+${appliedWarmthBonus.total} Warmth`);
            }
        }

        // Sync roll to GM if player-side
        if (!this._isGM) {
            emitRestSessionDelta("bivouac", "SPEND_HIT_DIE", {
                actorId,
                roll: {
                    total: spendResult.adjustedTotal,
                    die: spendResult.die,
                    conMod: spendResult.conMod,
                    annotations: spendResult.annotations
                },
                chefBonus: appliedChefBonus,
                songBonus: appliedSongBonus
            });
        }

        this._broadcastSync();
        this.render();
        this._saveSessionState();
    }

    static async #onSwapPlateFood(event, target) {
        const actorId = target.dataset.actorId;
        const actor = game.actors.get(actorId);
        if (!actor) return;
        if (!this._isGM && !actor.isOwner) return;

        const party = getPartyActors();
        const outlanderStatus = SustenanceEngine.scanOutlander(party, this._terrainTag);
        const options = [];

        // 1. Chef meal option (if Chef volunteered and treats provide sustenance)
        const settingVal = game.settings?.get?.(MODULE_ID, "chefTreatsProvideSustenance");
        const treatsProvideSustenance = typeof settingVal === "boolean" ? settingVal : true;
        if (this._chefVolunteered && this._chefVolunteer && treatsProvideSustenance) {
            options.push({
                id: "chef",
                label: `Chef's Replenishing Meal (${this._chefVolunteer.chefName})`
            });
        }

        // 2. Outlander Wild Forage option (if Outlander eligible)
        if (outlanderStatus.isEligible) {
            options.push({
                id: "forage",
                label: `Wild Forage (${outlanderStatus.outlanderActor?.name ?? "Outlander"})`
            });
        }

        // 3. Personal edible food items
        const personalEdible = (actor.items ?? []).filter(i => {
            if (!ItemClassifier.isFood(i, actor)) return false;
            if (ItemClassifier.isSpoiled(i)) return false;
            const flags = i.flags?.[MODULE_ID] ?? {};
            if (flags.chefTreat || flags.buff || flags.wellFedBuff || flags.magicFood) return false;
            return (i.system?.quantity ?? 1) > 0;
        });
        for (const item of personalEdible) {
            const qty = item.system?.quantity ?? 1;
            options.push({
                id: item.id,
                label: `${item.name}${qty > 1 ? ` (x${qty})` : ""}`
            });
        }

        // 4. Fasting / Starve option
        options.push({
            id: "starve",
            label: "Fast / Go Hungry (No Food)"
        });

        if (!options.length) return;

        // Current selection
        const currentChoice = this._plateChoices.get(actorId) ?? (
            this._isActorChefFed(actorId, party) ? "chef" :
            (outlanderStatus.isEligible ? "forage" :
            (personalEdible[0]?.id ?? "starve"))
        );

        let currentIndex = options.findIndex(o => o.id === currentChoice);
        if (currentIndex === -1) currentIndex = 0;

        const nextOption = options[(currentIndex + 1) % options.length];

        if (this._isGM) {
            this._plateChoices.set(actorId, nextOption.id);
            this._broadcastSync();
            this.render();
            ui.notifications.info(`${actor.name}: ${nextOption.label}`);
        } else {
            emitRestSessionDelta("bivouac", "SWAP_PLATE", { actorId, itemId: nextOption.id });
            ui.notifications.info(`${actor.name}: ${nextOption.label}`);
        }
        this._saveSessionState();
    }

    static async #onSwapPlateWater(event, target) {
        const actorId = target.dataset.actorId;
        const actor = game.actors.get(actorId);
        if (!actor) return;
        if (!this._isGM && !actor.isOwner) return;

        const options = [];

        // 1. Personal water items
        const personalWaters = (actor.items ?? []).filter(i => {
            if (!ItemClassifier.isWater(i, actor)) return false;
            if (ItemClassifier.isSpoiled(i)) return false;
            const qty = i.system?.quantity ?? 1;
            const uses = i.system?.uses?.value ?? (i.system?.uses?.max ? i.system?.uses.max - (i.system?.uses.spent ?? 0) : 1);
            return qty > 0 && uses > 0;
        });
        for (const item of personalWaters) {
            const qty = item.system?.quantity ?? 1;
            options.push({
                id: item.id,
                label: `${item.name}${qty > 1 ? ` (x${qty})` : ""}`
            });
        }

        // 2. Dehydrated / Go Thirsty option
        options.push({
            id: "thirsty",
            label: "Go Thirsty (No Water)"
        });

        if (!options.length) return;

        // Current selection
        const currentChoice = this._waterChoices.get(actorId) ?? (
            personalWaters[0]?.id ?? "thirsty"
        );

        let currentIndex = options.findIndex(o => o.id === currentChoice);
        if (currentIndex === -1) currentIndex = 0;

        const nextOption = options[(currentIndex + 1) % options.length];

        if (this._isGM) {
            this._waterChoices.set(actorId, nextOption.id);
            this._broadcastSync();
            this.render();
            ui.notifications.info(`${actor.name}: ${nextOption.label}`);
        } else {
            emitRestSessionDelta("bivouac", "SWAP_WATER", { actorId, itemId: nextOption.id });
            ui.notifications.info(`${actor.name}: ${nextOption.label}`);
        }
        this._saveSessionState();
    }

    static #onAdjustBivouacDC(event, target) {
        if (!this._isGM) return;
        const delta = Number(target.dataset.delta) || 0;
        this._dangerDC = Math.max(1, Math.min(30, (this._dangerDC ?? 15) + delta));
        this._broadcastSync();
        this.render();
        this._saveSessionState();
    }

    static async #onPassTheNight(event, target) {
        if (!this._isGM) return;

        const party = getPartyActors();

        // Guard: warn GM if any players haven't marked themselves finished
        const unfinishedPlayers = game.users
            .filter(u => !u.isGM && u.active && !this._finishedUsers.has(u.id))
            .filter(u => party.some(a => a.testUserPermission(u, "OWNER")));
        if (unfinishedPlayers.length > 0) {
            const names = unfinishedPlayers.map(u => u.name);
            const confirmFn = game.ionrift?.library?.confirm ?? Dialog.confirm.bind(Dialog);
            const proceed = await confirmFn({
                title: "Players Still Resting",
                content: `<p>The following players haven't finished resting:</p><ul>${names.map(n => `<li><strong>${n}</strong></li>`).join("")}</ul><p>Complete the overnight rest anyway?</p>`,
                yesLabel: "Complete Overnight Rest",
                noLabel: "Wait",
                yesIcon: "fas fa-moon",
                noIcon: "fas fa-hourglass-half",
                defaultYes: false,
            });
            if (!proceed) return;
        }

        // 1. Run Encounter check
        const encounterCheck = await EncounterDraftService.checkBivouacEncounter({
            terrainTag: this._terrainTag,
            partyActors: party,
            campStanceManager: this._campStanceManager,
            safePassage: this._safePassage,
            baseDC: this._dangerDC ?? 15
        });

        if (encounterCheck.triggered) {
            ui.notifications.warn("Overnight rest interrupted by an ambush.");
            return;
        }

        if (encounterCheck.state === "amber") {
            ui.notifications.info("The night was restless, but the camp completes their rest safely.");
        }

        // 2. Safe night: resolve Sustenance for all party members
        const outlanderStatus = SustenanceEngine.scanOutlander(party, this._terrainTag);
        const sustenanceLines = [];

        for (const actor of party) {
            const choice = this._plateChoices.get(actor.id);
            const isActorChefFed = this._isActorChefFed(actor.id, party);

            let selectedItemId = null;
            if (choice && choice !== "chef" && choice !== "forage" && choice !== "starve") {
                selectedItemId = choice;
            }

            const result = await SustenanceEngine.resolveBivouacActorMeal(actor, {
                isChefFed: isActorChefFed,
                isOutlanderShielded: !isActorChefFed && outlanderStatus.isEligible,
                selectedItemId: (choice === "starve") ? null : selectedItemId
            });

            if (result.ate) {
                sustenanceLines.push(`<li><strong>${actor.name}</strong> ate <em>${result.itemName}</em> (${result.source})</li>`);
            } else {
                sustenanceLines.push(`<li><strong style="color:#ef4444;">${actor.name}</strong> starved! (Missed food: ${result.restsSinceFood} rests)</li>`);
            }

            // Resolve Water
            const wChoice = this._waterChoices.get(actor.id);
            let selectedWaterItemId = null;
            if (wChoice && wChoice !== "thirsty") {
                selectedWaterItemId = wChoice;
            }

            const waterResult = await SustenanceEngine.resolveBivouacActorWater(actor, {
                isOutlanderShielded: outlanderStatus.isEligible,
                selectedItemId: (wChoice === "thirsty") ? null : selectedWaterItemId
            });

            if (waterResult.drank) {
                sustenanceLines.push(`<li><strong>${actor.name}</strong> drank <em>${waterResult.itemName}</em> (${waterResult.source})</li>`);
            } else {
                sustenanceLines.push(`<li><strong style="color:#ef4444;">${actor.name}</strong> is dehydrated! (Missed water: ${waterResult.restsSinceWater} rests)</li>`);
            }
        }

        // 2B. Fuel consumption for Warm Camp (only if campfire setting is active)
        let firewoodLine = "";
        const fireWarmthSetting = game.settings.get(MODULE_ID, "shortRestFireWarmth") ?? "none";
        if (fireWarmthSetting !== "none") {
            if (this._campStanceManager.isWarm) {
                const woodHolders = party.filter(a => countActorFirewood(a) > 0);
                if (woodHolders.length > 0) {
                    const contributor = woodHolders[Math.floor(Math.random() * woodHolders.length)];
                    const woodItem = findConsumableFirewoodItem(contributor);
                    if (woodItem) {
                        await consumeItem(contributor, woodItem.id, 1);
                        firewoodLine = `<li><i class="fas fa-fire" style="color:#f59e0b;"></i> <strong>Campfire Fuel:</strong> ${contributor.name} provided 1 fuel (${woodItem.name}).</li>`;
                    }
                } else {
                    firewoodLine = `<li><i class="fas fa-triangle-exclamation" style="color:#f87171;"></i> <strong>Campfire Fuel:</strong> No fuel in stock; campfire burned down to cold ash.</li>`;
                }
            } else {
                firewoodLine = `<li><i class="fas fa-moon" style="color:#94a3b8;"></i> <strong>Camp Stance:</strong> Cold & dark camp (0 fuel burned).</li>`;
            }
        }

        // 3. Advance world time (8 hours = 480 minutes)
        await CalendarHandler.advanceRestTime("short");

        // 4. Trigger native short rest feature recharge on actors
        setNativeShortRestUnsuppressed(true);
        try {
            const shortAdapter = game.ionrift?.respite?.adapter;
            for (const actor of party) {
                try {
                    if (shortAdapter) {
                        await shortAdapter.triggerNativeRest(actor, "short");
                    } else if (game.system.id === "dnd5e") {
                        await actor.shortRest({ dialog: false, chat: false });
                    }
                } catch (e) {
                    Logger.warn(`Failed short rest for ${actor.name}:`, e);
                }
            }
        } finally {
            setNativeShortRestUnsuppressed(false);
        }

        if (this._detectMagic) {
            await purgeDetectMagicRestArtifacts(party);
            this._detectMagic.clearScanSession({ skipSave: true });
        }

        // 5. Post dawn summary chat card
        const stanceLabel = this._campStanceManager.isWarm ? "Warm Camp" : "Cold & Dark";
        await ChatMessage.create({
            content: `<div class="respite-chat-parchment ionrift-window">` +
                `<h3><i class="fas fa-sun" style="color:#f59e0b;"></i> Dawn Breaks: Overnight Rest Complete</h3>` +
                `<p>The party completed an 8-hour overnight rest (${stanceLabel}). Class features recovered.</p>` +
                `<ul>${firewoodLine}${sustenanceLines.join("")}</ul>` +
                `</div>`,
            speaker: { alias: "Overnight Rest" }
        });

        ui.notifications.info("Overnight rest complete. 8 hours elapsed.");
        emitRestSessionResolved("bivouac", {});
        this.close({ resolved: true });
    }

    static #onToggleBivouacFinished(event, target) {
        event.preventDefault?.();
        const uid = game.user.id;
        const next = !this._finishedUsers.has(uid);
        if (next) this._finishedUsers.add(uid);
        else this._finishedUsers.delete(uid);

        if (this._isGM) {
            this._broadcastSync();
            this.render();
            this._saveSessionState();
        } else {
            emitRestSessionDelta("bivouac", "PLAYER_FINISHED", { userId: uid, finished: next });
        }
        this.render();
    }

    static #onSwitchTab(event, target) {
        const tab = target?.dataset?.tab;
        if (tab !== "camp" && tab !== "workbench") return;
        if (tab === "workbench" && !isWorkbenchIdentifyUiEnabled()) return;
        this._activeTab = tab;
        if (this._isGM) {
            void this._saveSessionState();
            this._broadcastSync();
        } else {
            emitRestSessionDelta("bivouac", "WORKBENCH_STAGING", {
                userId: game.user.id,
                staging: Array.from(this._workbenchIdentifyStaging?.entries() ?? [])
            });
        }
        this.render();
    }

    static #onSelectRosterCharacter(event, target) {
        const chip = target?.closest?.(".roster-chip, .rest-companion-card, [data-actor-id]");
        if (!chip) return;
        const id = chip.dataset.actorId || chip.dataset.rosterId;
        if (!id || id === this._selectedCharacterId) return;
        const party = getPartyActors();
        const targetActor = party.find((a) => a.id === id);
        if (!targetActor) return;
        if (!this._isGM && !targetActor.isOwner) return;
        this._selectedCharacterId = id;
        if (this._isGM && this._activeTab === "workbench") {
            this._workbenchFocusActorId = id;
            void this._saveSessionState();
            this._broadcastSync();
        }
        this.render();
    }

    static #onSelectWorkbenchRosterActor(event, target) {
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

    static async #onStationDetectMagicScan(event) {
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
        const el = this.element?.querySelector?.(".station-workbench-identify-embed[data-workbench-actor-id]");
        const actorId = el?.dataset?.workbenchActorId;
        if (!actorId) return;
        const ack = this._workbenchIdentifyAcknowledge?.get(actorId);
        if (!ack || Date.now() < ack.revealAt) return;
        this._workbench.dismissAcknowledgement(actorId);
        if (this._isGM) {
            void this._saveSessionState();
            this._broadcastSync();
        } else {
            emitRestSessionDelta("bivouac", "WORKBENCH_ACK_DISMISS", { actorId });
        }
    }
}

