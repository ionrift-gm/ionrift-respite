import { MODULE_ID } from "../../data/moduleId.js";
import { Logger } from "../../utils/Logger.js";
import { RestPresentationHelper } from "../../utils/RestPresentationHelper.js";
import { ImageResolver } from "../../utils/ImageResolver.js";
import { confirmAbandonRest } from "./confirmAbandonRest.js";
import { WorkbenchDelegate } from "../delegates/crafting/WorkbenchDelegate.js";
import {
    collectPartyIdentifyEmbedData,
    DetectMagicDelegate,
    purgeDetectMagicRestArtifacts,
    spawnDetectMagicCastRipple
} from "../delegates/crafting/DetectMagicDelegate.js";
import { getPartyActors } from "../../services/party/partyActors.js";
import { HitDiceService } from "../../services/rest/recovery/HitDiceService.js";
import { getShortRestRechargeLabels } from "../../services/rest/recovery/ShortRestRecharge.js";
import { isWorkbenchIdentifyUiEnabled } from "../../data/RestConstants.js";
import * as RestAfkState from "../../services/rest/session/RestAfkState.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * BaseShortRestApp
 * 
 * Abstract base class unifying state management, workbench identify delegation,
 * character selection, and shared tabletop interactions across Short Rest implementations
 * (Standard 1-hour Short Rest and Gritty Realism 8-hour Bivouac).
 */
export class BaseShortRestApp extends HandlebarsApplicationMixin(ApplicationV2) {

    static DEFAULT_OPTIONS = {
        tag: "div",
        classes: ["ionrift-window"],
        window: {
            resizable: true,
        },
        position: {
            width: 720,
            height: "auto",
        },
        actions: {
            selectRosterCharacter: BaseShortRestApp.onSelectRosterCharacter,
            clearSelectedCharacter: BaseShortRestApp.onClearSelectedCharacter,
            switchShortRestTab: BaseShortRestApp.onSwitchTab,
            switchBivouacTab: BaseShortRestApp.onSwitchTab,
            selectWorkbenchActor: BaseShortRestApp.onSelectWorkbenchActor,
            abandonRest: BaseShortRestApp.onAbandonRest,
            abandonBivouac: BaseShortRestApp.onAbandonRest,
            toggleUiTheme: BaseShortRestApp.onToggleUiTheme,
        },
    };

    /** @type {boolean} */
    _isGM = false;

    /** @type {string|null} ID of character currently rendered in full hero card */
    _selectedCharacterId = null;

    /** @type {string} Active navigation tab ("camp" | "recovery" | "workbench") */
    _activeTab = "camp";

    /** @type {Map<string, Array<object>>} actorId -> roll history */
    _rolls = new Map();

    /** @type {WorkbenchDelegate} */
    _workbench = null;

    /** @type {DetectMagicDelegate} */
    _detectMagic = null;

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

    /** @type {Set<string>} user IDs who marked themselves ready */
    _finishedUsers = new Set();

    constructor(options = {}) {
        super(options);
        this._isGM = game.user?.isGM ?? false;
        this._activeTab = options.activeTab ?? "camp";
        this._selectedCharacterId = options.selectedCharacterId ?? null;

        this._workbench = new WorkbenchDelegate(this);
        this._detectMagic = new DetectMagicDelegate(this);
    }

    /* -------------------------------------------------- */
    /*  Shared Action Handlers                            */
    /* -------------------------------------------------- */

    /**
     * GM switches the hero card from a companion card or roster chip.
     */
    static onSelectRosterCharacter(event, target) {
        if (!this._isGM) return;
        const chip = target?.closest?.(".roster-chip, .rest-companion-card, .gm-party-card, [data-actor-id]");
        if (!chip) return;
        const actorId = chip.dataset.actorId || chip.dataset.rosterId;
        if (!actorId) return;
        if (actorId === this._selectedCharacterId) {
            // Toggling the same character clears focus back to neutral overview
            this._selectedCharacterId = null;
        } else {
            this._selectedCharacterId = actorId;
        }
        if (this._activeTab === "workbench") {
            this._workbenchFocusActorId = this._selectedCharacterId;
        }
        this.render();
    }

    /**
     * GM clears character selection to return to neutral overview.
     */
    static onClearSelectedCharacter(event, target) {
        if (!this._isGM) return;
        this._selectedCharacterId = null;
        this.render();
    }



    /**
     * Switch between Camp/Recovery and Workbench/Identify tabs.
     */
    static onSwitchTab(event, target) {
        const tab = target.dataset.tab;
        if (!tab || tab === this._activeTab) return;
        this._activeTab = tab;
        this.render();
    }

    /**
     * Select actor in Workbench view.
     */
    static onSelectWorkbenchActor(event, target) {
        const actorId = target.dataset.actorId;
        if (!actorId) return;
        this._workbenchFocusActorId = actorId;
        this.render();
    }

    /**
     * Confirm and abandon the rest.
     */
    static async onAbandonRest(event, target) {
        const confirmed = await confirmAbandonRest();
        if (confirmed) {
            Hooks.callAll("ionrift.respite.restCleanup");
            this.close({ abandoned: true });
        }
    }

    /**
     * Toggle the UI theme between Ionrift Glass and Gilded Slate.
     */
    static async onToggleUiTheme(event, target) {
        let currentTheme = "glass";
        try {
            currentTheme = game.settings.get(MODULE_ID, "uiTheme") ?? "glass";
        } catch { /* ignore */ }
        const nextTheme = currentTheme === "glass" ? "cockpit" : "glass";
        try {
            await game.settings.set(MODULE_ID, "uiTheme", nextTheme);
        } catch (e) {
            console.error("Failed to update uiTheme setting:", e);
        }
    }

    _onRender(context, options) {
        super._onRender?.(context, options);
        let currentTheme = "glass";
        try {
            currentTheme = game.settings.get(MODULE_ID, "uiTheme") ?? "glass";
        } catch { /* ignore */ }
        this.element?.classList.toggle("theme-ionrift-glass", currentTheme === "glass");
        this.element?.classList.toggle("theme-respite-cockpit", currentTheme === "cockpit");
    }

    /* -------------------------------------------------- */
    /*  Shared Context Helpers                            */
    /* -------------------------------------------------- */

    /**
     * Normalizes an actor into a standard character view model with complete vitals,
     * monogram badge, hit dice well, and class feature indicators.
     * @param {Actor} a
     * @param {object} [extra={}]
     * @returns {object}
     */
    _prepareBaseCharacter(a, extra = {}) {
        const pres = RestPresentationHelper.getActorPresentation(a);
        const curHp = a.system?.attributes?.hp?.value ?? 0;
        const maxHp = a.system?.attributes?.hp?.max ?? curHp;
        const hpPercent = maxHp > 0 ? Math.min(100, Math.round((curHp / maxHp) * 100)) : 100;
        const isFullHp = curHp >= maxHp;

        const hdData = HitDiceService.getActorHitDiceData(a);
        const hdPips = [];
        for (let i = 0; i < hdData.max; i++) {
            hdPips.push({ filled: i < hdData.remaining, index: i });
        }

        const srRechargeBadges = getShortRestRechargeLabels(a);

        const actorRolls = this._rolls.get(a.id) ?? [];
        const rollsCompressed = actorRolls.length > 3;
        const rollsToShow = rollsCompressed ? actorRolls.slice(-3) : actorRolls;
        const rollsHidden = rollsCompressed ? actorRolls.length - 3 : 0;
        const totalHealed = actorRolls.reduce((sum, r) => sum + (r.total ?? 0), 0);

        const linkedId = a.prototypeToken?.actorLink ? a.id : null;
        const isSelfCard = Boolean(
            (game.user.character && (game.user.character.id === a.id || (linkedId && game.user.character.id === linkedId)))
            || (!linkedId && a.testUserPermission(game.user, "OWNER"))
        );

        return {
            id: a.id,
            name: a.name,
            img: a.img || "icons/svg/mystery-man.svg",
            initial: pres.initial,
            subtext: pres.subtext,
            themeGradient: pres.themeGradient,
            themeBorder: pres.themeBorder,
            hpValue: curHp,
            currentHp: curHp,
            hpMax: maxHp,
            maxHp: maxHp,
            hpPercent,
            isFullHp,
            hdRemaining: hdData.remaining,
            hdMax: hdData.max,
            hdDie: hdData.die,
            hdPips,
            noHdLeft: hdData.remaining <= 0,
            srRechargeBadges,
            rolls: actorRolls,
            rollsToShow,
            rollsCompressed,
            rollsHidden,
            totalHealed,
            isAfk: RestAfkState.isAfk(a.id),
            isSelfCard,
            isOwner: this._isGM || a.isOwner,
            canInteract: this._isGM || a.isOwner,
            ...extra
        };
    }
}
