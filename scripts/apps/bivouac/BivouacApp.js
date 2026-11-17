import { BivouacActionMethods } from "./BivouacActions.js";
import { MODULE_ID } from "../../data/moduleId.js";
import { Logger } from "../../utils/Logger.js";
import { getPartyActors } from "../../services/party/partyActors.js";
import { HitDiceService } from "../../services/rest/recovery/HitDiceService.js";
import { HitDieModifiers } from "../../services/rest/recovery/HitDieModifiers.js";
import { SustenanceEngine } from "../../services/rest/gritty/SustenanceEngine.js";
import { CampStanceManager } from "./CampStanceManager.js";
import {
    registerRestSessionApp,
    unregisterRestSessionApp,
    drainPendingRestSessionDeltas,
    emitRestSessionDelta,
    emitRestSessionSync,
    userControlsActor
} from "../../services/rest/session/RestSessionSync.js";
import { BIVOUAC_STATE_SCHEMA } from "../../services/rest/session/restSessionSchemas.js";
import { setRespiteFlowActive } from "../../module.js";
import { countActorFirewood } from "../../services/camp/gear/CampGearScanner.js";
import { getShortRestRechargeLabels } from "../../services/rest/recovery/ShortRestRecharge.js";
import { RestPresentationHelper } from "../../utils/RestPresentationHelper.js";
import { ImageResolver } from "../../utils/ImageResolver.js";
import { WorkbenchDelegate } from "../delegates/crafting/WorkbenchDelegate.js";
import {
    DetectMagicDelegate
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
            title: "ionrift-respite.bivouac.windowTitle",
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
    getFocusBudget(_actorId) {
        return 1;
    }

    _onRender(context, options) {
        super._onRender(context, options);
        this.element?.classList.toggle("hide-terrain-banners", !!context?.hideTerrainBanner);
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
    _isActorChefFed(actorId, _party = getPartyActors()) {
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

    async _prepareContext(_options) {
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
                    label: game.i18n.localize("ionrift-respite.bivouac.water.springLabel"),
                    tooltip: game.i18n.format("ionrift-respite.bivouac.water.springTooltip", { source: outlanderStatus.label })
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
                        tooltip: game.i18n.format("ionrift-respite.bivouac.water.personalTooltip", { item: waterItem.name }),
                        canInteract: isOwner
                    };
                } else {
                    waterPlate = {
                        isDehydrated: true,
                        label: game.i18n.localize("ionrift-respite.bivouac.water.dehydratedLabel"),
                        tooltip: game.i18n.localize("ionrift-respite.bivouac.water.dehydratedTooltip"),
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

    static async #onAbandonBivouac(event, target) { return BivouacActionMethods.onAbandonBivouac.call(this, event, target); }
    static #onToggleStance(event, target) { return BivouacActionMethods.onToggleStance.call(this, event, target); }
    static #onVolunteerChef(event, target) { return BivouacActionMethods.onVolunteerChef.call(this, event, target); }
    static #onOptOutChef(event, target) { return BivouacActionMethods.onOptOutChef.call(this, event, target); }
    static async #onVolunteerSong(event, target) { return BivouacActionMethods.onVolunteerSong.call(this, event, target); }
    static async #onClaimChefTreat(event, target) { return BivouacActionMethods.onClaimChefTreat.call(this, event, target); }
    static async #onClaimChefMealFromBadge(event, target) { return BivouacActionMethods.onClaimChefMealFromBadge.call(this, event, target); }
    static async #onSpendHitDie(event, target) { return BivouacActionMethods.onSpendHitDie.call(this, event, target); }
    static async #onSwapPlateFood(event, target) { return BivouacActionMethods.onSwapPlateFood.call(this, event, target); }
    static async #onSwapPlateWater(event, target) { return BivouacActionMethods.onSwapPlateWater.call(this, event, target); }
    static #onAdjustBivouacDC(event, target) { return BivouacActionMethods.onAdjustBivouacDC.call(this, event, target); }
    static async #onPassTheNight(event, target) { return BivouacActionMethods.onPassTheNight.call(this, event, target); }
    static #onToggleBivouacFinished(event, target) { return BivouacActionMethods.onToggleBivouacFinished.call(this, event, target); }
    static #onSwitchTab(event, target) { return BivouacActionMethods.onSwitchTab.call(this, event, target); }
    static #onSelectRosterCharacter(event, target) { return BivouacActionMethods.onSelectRosterCharacter.call(this, event, target); }
    static #onSelectWorkbenchRosterActor(event, target) { return BivouacActionMethods.onSelectWorkbenchRosterActor.call(this, event, target); }
    static async #onStationDetectMagicScan(event, target) { return BivouacActionMethods.onStationDetectMagicScan.call(this, event, target); }
    static async #onStationIdentifyScannedItem(event, target) { return BivouacActionMethods.onStationIdentifyScannedItem.call(this, event, target); }
    static async #onSubmitWorkbenchIdentify(event, target) { return BivouacActionMethods.onSubmitWorkbenchIdentify.call(this, event, target); }
    static #onWorkbenchIdentifyRemovePotion(event, target) { return BivouacActionMethods.onWorkbenchIdentifyRemovePotion.call(this, event, target); }
    static async #onDismissWorkbenchIdentifyAck(event, target) { return BivouacActionMethods.onDismissWorkbenchIdentifyAck.call(this, event, target); }
}