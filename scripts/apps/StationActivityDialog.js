/**
 * StationActivityDialog
 *
 * Lightweight popup that opens when a player clicks a campsite station overlay.
 * Shows the activities offered by that station, filtered for the actor,
 * and submits the choice via the same socket path as the panel Confirm button.
 */

import {
    ACTIVITY_ICONS,
    buildPartyState,
    getActivityAdvisory,
    DETECT_MAGIC_BTN_LABEL_PLAYER,
    DETECT_MAGIC_BTN_LABEL_GM,
    DETECT_MAGIC_BTN_TITLE_GM
} from "./RestConstants.js";
import { canPlaceStation } from "../services/CompoundCampPlacer.js";
import { getPartyActors } from "../module.js";

const MODULE_ID = "ionrift-respite";
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Lets RestSetupApp refresh this dialog after meal drag without a full rest window render. */
export function notifyStationMealChoicesUpdated() {
    Hooks.callAll(`${MODULE_ID}.stationMealChoicesTouched`);
}

/** Workbench identify staging changed; refresh open station dialog. */
export function notifyWorkbenchIdentifyStagingTouched() {
    Hooks.callAll(`${MODULE_ID}.workbenchIdentifyStagingTouched`);
}

/**
 * Closes the open station dialog when it was built for a different actor than the
 * current roster or token focus (GM switches character while a picker is open).
 * @param {string|null|undefined} contextActorId
 */
export function closeStationDialogIfDifferentActor(contextActorId) {
    if (!_openDialog || !contextActorId) return;
    if (_openDialog._actor?.id === contextActorId) return;
    void _openDialog.close();
}

export const COOK_ACTIVITY_IDS = new Set(["act_cook", "act_brew"]);

const DIALOG_WIDTH = 320;
/** Campfire dialog: comfort + 3-column gear grid; wider than default. */
const CAMPFIRE_DIALOG_WIDTH = 400;
const ANCHOR_ABOVE_PX = 40;
const EST_HEIGHT = 260;
const VIS_CLOSE_RATIO = 0.12;
const PAN_TRIGGER_RATIO = 0.55;

let _openDialog = null;

export class StationActivityDialog extends HandlebarsApplicationMixin(ApplicationV2) {

    static DEFAULT_OPTIONS = {
        id: "ionrift-station-activity-dialog",
        classes: ["ionrift-window", "glass-ui", "ionrift", "ionrift-station-dialog"],
        window: {
            title: "Choose Activity",
            resizable: false,
            minimizable: false
        },
        position: {
            width: DIALOG_WIDTH,
            height: "auto"
        },
        actions: {
            selectActivity: StationActivityDialog.#onSelectActivity,
            confirmActivity: StationActivityDialog.#onConfirm,
            backToList: StationActivityDialog.#onBackToList,
            dismissResult: StationActivityDialog.#onDismissResult,
            switchStationPanelTab: StationActivityDialog.#onSwitchStationPanelTab,
            submitStationRations: StationActivityDialog.#onSubmitStationRations,
            stationDetectMagicScan: StationActivityDialog.#onStationDetectMagicScan,
            stationIdentifyScannedItem: StationActivityDialog.#onStationIdentifyScannedItem,
            submitWorkbenchIdentify: StationActivityDialog.#onSubmitWorkbenchIdentify,
            workbenchIdentifyRemovePotion: StationActivityDialog.#onWorkbenchIdentifyRemovePotion,
            dismissWorkbenchIdentifyAck: StationActivityDialog.#onDismissWorkbenchIdentifyAck
        }
    };

    static PARTS = {
        "station-activity": {
            template: `modules/${MODULE_ID}/templates/station-activity-dialog.hbs`
        }
    };

    /**
     * @param {Object} options
     * @param {Object}   options.station        - CAMP_STATIONS entry
     * @param {Actor}    options.actor          - The choosing actor
     * @param {Object[]} options.available      - Available activity schemas for this station
     * @param {Object[]} options.faded          - Faded (prereq-blocked) activity schemas
     * @param {Object}   options.restSession    - Current rest session context (fireLevel, etc.)
     * @param {object|null} options.restApp - parent RestSetupApp instance (canvas flow)
     * @param {string|null} options.canvasStationId - station id for overlay dimming
     * @param {object|null} options.partyState       - buildPartyState(...) for advisories (from RestSetupApp)
     * @param {Token|null} options.stationToken     - token to anchor position and track while open
     * @param {boolean} [options.showStationTabs]    - campfire / cooking / workbench hub (multi-tab)
     * @param {string} [options.initialStationTab]   - activity | meal | cooking | identify
     * @param {Object[]} [options.cookingAvailable]  - act_cook / act_brew only (cooking station)
     * @param {Object[]} [options.cookingFaded]
     */
    constructor({
        station,
        actor,
        available,
        faded,
        restSession,
        restApp = null,
        canvasStationId = null,
        partyState = null,
        stationToken = null,
        showStationTabs = false,
        initialStationTab = "activity",
        cookingAvailable = [],
        cookingFaded = [],
        actorHasCookingUtensils = false
    } = {}, appOptions = {}) {
        super(appOptions);
        this._station          = station;
        this._actor            = actor;
        this._available        = available ?? [];
        this._faded            = faded ?? [];
        this._cookingAvailable = cookingAvailable ?? [];
        this._cookingFaded     = cookingFaded ?? [];
        /** Per-actor: cook's utensils unlock the Cooking tab at the cooking station. */
        this._actorHasCookingUtensils = !!actorHasCookingUtensils;
        this._showStationTabs  = !!showStationTabs;
        this._stationPanelTab  = initialStationTab || "activity";
        this._restSession      = restSession ?? {};
        this._restApp          = restApp;
        this._canvasStationId  = canvasStationId;
        this._partyState       = partyState;
        this._stationToken     = stationToken;
        /** @type {(() => void) | null} */
        this._tickerFn         = null;
        /** @type {(() => void) | null} */
        this._canvasPanFn      = null;
        /** @type {((...args: unknown[]) => void) | null} */
        this._mealHookBound    = null;
        this._trackStarted     = false;

        /** @type {"list"|"detail"|"result"} */
        this._dialogState      = "list";
        this._selectedActivityId = null;
        this._activityResult   = null;
        this._followUpValue    = null;
    }

    async _prepareContext(options) {
        const base = {
            station:    this._station,
            actorName:  this._actor?.name ?? "Unknown",
            dialogState: this._dialogState
        };

        if (this._dialogState === "detail") return { ...base, ...this._buildDetailContext() };
        if (this._dialogState === "result") return { ...base, ...this._buildResultContext() };
        return { ...base, ...this._buildListContext() };
    }

    _buildListContext() {
        const ps = this._partyState ?? buildPartyState([], new Map(), 14);
        const mapAct = (act, isAvail) => {
            if (isAvail) {
                const advisory = this._actor
                    ? getActivityAdvisory(act.id, this._actor, ps)
                    : { text: "", urgent: false };
                const advRaw = advisory.text != null ? String(advisory.text).trim() : "";
                const hasAdvisory = advRaw.length > 0;
                const hintText = hasAdvisory ? advRaw : (act.description ?? "").trim() || "";
                return {
                    id:          act.id,
                    name:        act.name,
                    hint:        hintText,
                    hintUrgent:  hasAdvisory && !!advisory.urgent,
                    icon:        ACTIVITY_ICONS[act.id] ?? act.icon ?? "fas fa-circle",
                    available:   true,
                    fadedHint:   null
                };
            }
            return {
                id:          act.id,
                name:        act.name,
                hint:        act.fadedHint ?? "Not available.",
                hintUrgent:  false,
                icon:        ACTIVITY_ICONS[act.id] ?? act.icon ?? "fas fa-circle",
                available:   false,
                fadedHint:   act.fadedHint ?? "Not available."
            };
        };

        const activityItems = this._available.map(act => mapAct(act, true));
        const fadedItems    = this._faded.map(act => mapAct(act, false));

        const cookActItems = this._cookingAvailable.map(act => mapAct(act, true));
        const cookFaded    = this._cookingFaded.map(act => mapAct(act, false));

        const hubEligible = this._showStationTabs;
        const mealCard = (hubEligible && this._station.id !== "workbench" && this._restApp?.getStationMealCardForActor && this._actor?.id)
            ? this._restApp.getStationMealCardForActor(this._actor.id)
            : null;
        const rationDone = !!(mealCard?.allDaysConsumed || mealCard?.playerSubmitted);

        const hasAnyGeneral = activityItems.length > 0;
        const hasCookingAvail = cookActItems.length > 0;

        const stationTabs = [];
        if (hubEligible && this._station.id === "cooking_station") {
            if (!rationDone && mealCard) {
                stationTabs.push({ id: "meal", label: "Rations" });
            }
            stationTabs.push({
                id: "cooking",
                label: "Cooking",
                disabled: !this._actorHasCookingUtensils,
                title: this._actorHasCookingUtensils
                    ? ""
                    : "Requires cook's utensils in this character's inventory"
            });
        } else if (hubEligible && this._station.id === "workbench") {
            if (hasAnyGeneral) stationTabs.push({ id: "activity", label: "Activities" });
            if (game.user?.isGM) stationTabs.push({ id: "identify", label: "Identify" });
        }

        const tabIds = new Set(stationTabs.map(t => t.id));
        if (!tabIds.has(this._stationPanelTab)
            || (this._stationPanelTab === "cooking" && !this._actorHasCookingUtensils)) {
            this._stationPanelTab = stationTabs.find(t => !t.disabled)?.id
                ?? stationTabs[0]?.id
                ?? "activity";
        }

        const showStationTabs = stationTabs.length > 0;
        const showTabBar = stationTabs.length > 1;

        const campGearAtFire = (this._station?.id === "campfire" && this._restApp?.getCampGearContextForActor)
            ? this._restApp.getCampGearContextForActor(this._actor?.id)
            : null;
        const campComfortAtFire = (this._station?.id === "campfire" && this._restApp?.getCampComfortAdvisoryForStationDialog)
            ? this._restApp.getCampComfortAdvisoryForStationDialog()
            : null;
        const campPersonalCard = (this._station?.id === "campfire" && this._restApp?.getCampPersonalCardForActor && this._actor?.id)
            ? this._restApp.getCampPersonalCardForActor(this._actor.id)
            : null;

        const identifyEmbed = (this._station?.id === "workbench" && this._restApp?.getStationIdentifyEmbedContext)
            ? this._restApp.getStationIdentifyEmbedContext({
                restrictUnidentifiedToActorId: this._actor?.id ?? null
            })
            : { unidentifiedItems: [], identifyCasters: [], detectMagicCasters: [] };

        const wbWorkbenchDefaults = {
            workbenchIdentifyActorId: null,
            workbenchGearChip: null,
            workbenchPotionChips: [],
            workbenchNoUnidentifiedOnSheet: true,
            workbenchSubmitLocked: true,
            workbenchIdentifyAcknowledgement: null,
            workbenchAckRevealReady: true
        };
        const wbCtx = (this._station?.id === "workbench" && this._restApp?.getWorkbenchIdentifyDragContext)
            ? this._restApp.getWorkbenchIdentifyDragContext(this._actor?.id ?? null)
            : wbWorkbenchDefaults;

        return {
            activities:       [...activityItems, ...fadedItems],
            hasAny:           activityItems.length > 0,
            cookingActivities: [...cookActItems, ...cookFaded],
            hasCookingAny:    cookActItems.length > 0,
            showStationTabs,
            showTabBar,
            stationTabs,
            stationPanelTab:  this._stationPanelTab,
            mealCard,
            mealCardNeedsEssence: !!(mealCard?.needsEssence),
            stationIdentifyHub: this._station?.id === "workbench",
            identifyCasters:    identifyEmbed.identifyCasters ?? [],
            detectMagicCasters: identifyEmbed.detectMagicCasters ?? [],
            unidentifiedItems: identifyEmbed.unidentifiedItems ?? [],
            campGearAtFire,
            campComfortAtFire,
            campPersonalCard,
            hideNoActivitiesMessage: this._station?.id === "campfire",
            isGmUser:           !!game.user?.isGM,
            canShowDetectMagicScanButton: !!this._restApp?.canShowDetectMagicScanButtonFromParty?.(),
            detectMagicScanButtonLabel: game.user?.isGM ? DETECT_MAGIC_BTN_LABEL_GM : DETECT_MAGIC_BTN_LABEL_PLAYER,
            detectMagicScanButtonTitle: game.user?.isGM ? DETECT_MAGIC_BTN_TITLE_GM : "",
            magicScanComplete:  !!this._restApp?._magicScanComplete,
            magicScanResults:   this._restApp?._magicScanResults ?? [],
            ...wbCtx
        };
    }

    _buildDetailContext() {
        const activityId = this._selectedActivityId;
        const resolver = this._restApp?._activityResolver;
        const activity = resolver?.activities?.get(activityId);
        if (!activity) return { activityDetail: null };

        const icon = ACTIVITY_ICONS[activityId] ?? activity.icon ?? "fas fa-circle";
        const actor = this._actor;
        const comfort = this._restApp?._engine?.comfort ?? "sheltered";

        const outcomeHints = [];
        for (const tier of ["success", "exceptional", "failure"]) {
            const effects = activity.outcomes?.[tier]?.effects ?? [];
            for (const eff of effects) {
                if (eff.description) outcomeHints.push({ text: eff.description, type: tier });
            }
        }

        let checkLabel = null;
        if (activity.check) {
            const comfortDcMod = { safe: 0, sheltered: 0, rough: 2, hostile: 5 };
            const baseDc = activity.check.dc ?? 12;
            const adjustedDc = baseDc + (comfortDcMod[comfort] ?? 0);

            let skillPart = "";
            if (activity.check.skill) {
                let chosenSkill = activity.check.skill;
                if (activity.check.altSkill && actor) {
                    const primary = actor.system?.skills?.[activity.check.skill]?.total ?? 0;
                    const alt = actor.system?.skills?.[activity.check.altSkill]?.total ?? 0;
                    if (alt > primary) chosenSkill = activity.check.altSkill;
                }
                const skillData = actor?.system?.skills?.[chosenSkill];
                const mod = skillData?.total ?? skillData?.mod ?? 0;
                const sign = mod >= 0 ? "+" : "";
                skillPart = `${chosenSkill.charAt(0).toUpperCase() + chosenSkill.slice(1)} (${sign}${mod})`;
            } else if (activity.check.ability) {
                let abilityKey = activity.check.ability;
                if (abilityKey === "best" && actor?.system?.abilities) {
                    let bestKey = "str"; let bestMod = -99;
                    for (const [key, data] of Object.entries(actor.system.abilities)) {
                        if ((data.mod ?? 0) > bestMod) { bestMod = data.mod; bestKey = key; }
                    }
                    abilityKey = bestKey;
                }
                const mod = actor?.system?.abilities?.[abilityKey]?.mod ?? 0;
                const sign = mod >= 0 ? "+" : "";
                skillPart = `${abilityKey.toUpperCase()} (${sign}${mod})`;
            }
            checkLabel = `${skillPart} DC ${adjustedDc}`;
        }

        let followUpData = null;
        if (activity.followUp) {
            const currentValue = this._followUpValue
                ?? this._restApp?._gmFollowUps?.get(actor?.id)
                ?? this._restApp?._getFollowUpForCharacter?.(actor?.id)
                ?? null;

            followUpData = {
                type: activity.followUp.type,
                label: activity.followUp.label,
                currentValue
            };

            if (activity.followUp.type === "partyMember") {
                const partyActors = getPartyActors().filter(a => a.id !== actor?.id);
                followUpData.options = partyActors.sort((a, b) => {
                    const aRatio = (a.system.attributes?.hp?.value ?? 0) / (a.system.attributes?.hp?.max ?? 1);
                    const bRatio = (b.system.attributes?.hp?.value ?? 0) / (b.system.attributes?.hp?.max ?? 1);
                    return aRatio - bRatio;
                }).map(a => {
                    const hp = a.system.attributes?.hp;
                    const hpText = hp ? ` (${hp.value}/${hp.max} HP)` : "";
                    return { value: a.id, label: `${a.name}${hpText}`, isSelected: a.id === currentValue };
                });
            } else if (activity.followUp.type === "radio" || activity.followUp.type === "select") {
                const selectedVal = currentValue || activity.followUp.default || activity.followUp.options?.[0]?.value;

                if (activityId === "act_scribe") {
                    const currentGold = actor?.system?.currency?.gp ?? 0;
                    followUpData.goldInfo = `${actor?.name ?? "Character"} has ${currentGold}gp`;
                    followUpData.options = activity.followUp.options.map(opt => {
                        const cost = parseInt(opt.value, 10) * 50;
                        return {
                            ...opt,
                            label: currentGold >= cost ? opt.label : `${opt.label} (can't afford)`,
                            isSelected: opt.value === selectedVal,
                            isDisabled: currentGold < cost
                        };
                    });
                } else {
                    followUpData.options = activity.followUp.options.map(opt => ({
                        ...opt,
                        isSelected: opt.value === selectedVal
                    }));
                }

                if (followUpData.options?.length && !followUpData.options.some(o => o.isSelected)) {
                    followUpData.options[0].isSelected = true;
                }
            } else if (activity.followUp.type === "actorItem" && activity.followUp.filter === "attuneable") {
                const attuneItems = (actor?.items ?? []).filter(i => {
                    const att = i.system?.attunement;
                    return (att === "required" || att === 1) && !i.system?.attuned;
                });
                followUpData.options = attuneItems.map(i => ({
                    value: i.id,
                    label: i.name,
                    isSelected: i.id === currentValue
                }));
                const attunement = actor?.system?.attributes?.attunement;
                if (attunement) {
                    const current = attunement.value ?? 0;
                    const max = attunement.max ?? 3;
                    followUpData.slotInfo = `${current}/${max}${current >= max ? " (at capacity)" : ""}`;
                }
            }
        }

        let armorHint = null;
        try {
            const armorRuleEnabled = game.settings.get("ionrift-respite", "armorDoffRule");
            if (armorRuleEnabled) {
                const equippedArmor = actor?.items?.find(i =>
                    i.type === "equipment" && i.system?.equipped
                    && ["medium", "heavy"].includes(i.system?.type?.value ?? i.system?.armor?.type)
                );
                if (equippedArmor && activity.armorSleepWaiver) {
                    armorHint = { text: "Sleeping light between rotations. Armor stays on, weapon close. No HP or HD recovery penalty.", type: "positive" };
                } else if (equippedArmor && !activity.armorSleepWaiver) {
                    armorHint = { text: "Sleeping in armor. Recover only 1/4 Hit Dice, exhaustion not reduced (Xanathar's). Consider doffing first.", type: "warning" };
                }
            }
        } catch (e) { /* setting may not exist */ }

        const isCrafting = !!activity.crafting?.enabled;

        return {
            activityDetail: {
                id: activityId,
                name: activity.name,
                description: activity.description || "No additional details available.",
                icon,
                check: checkLabel,
                outcomeHints,
                followUpData,
                armorHint,
                combatModifiers: activity.combatModifiers ?? null,
                isCrafting,
                characterId: actor?.id
            }
        };
    }

    _buildResultContext() {
        const r = this._activityResult;
        if (!r) return { activityResult: null };

        const resolver = this._restApp?._activityResolver;
        const activity = resolver?.activities?.get(r.activityId);
        const icon = ACTIVITY_ICONS[r.activityId] ?? activity?.icon ?? "fas fa-circle";
        const hasCheck = !!activity?.check;

        let tierLabel, tierClass;
        if (!hasCheck && r.result === "success") {
            tierLabel = "Confirmed";
            tierClass = "confirmed";
        } else {
            switch (r.result) {
                case "exceptional":
                    tierLabel = "Exceptional!"; tierClass = "exceptional"; break;
                case "success":
                    tierLabel = "Success"; tierClass = "success"; break;
                case "failure_complication":
                    tierLabel = "Failed (complication)"; tierClass = "failure"; break;
                case "failure":
                    tierLabel = "Failed"; tierClass = "failure"; break;
                case "pending_approval":
                    tierLabel = "Pending Approval"; tierClass = "pending"; break;
                default:
                    tierLabel = r.result ?? "Complete"; tierClass = "confirmed";
            }
        }

        return {
            activityResult: {
                name: activity?.name ?? r.activityId,
                icon,
                tierLabel,
                tierClass,
                narrative: r.narrative ?? "",
                isPending: r.result === "pending_approval"
            }
        };
    }

    /**
     * After rations submit or meal UI refresh: close when this hub has no station tabs left
     * and no general activities (only the empty placeholder would remain).
     */
    async _closeIfEmptyHubAfterRender() {
        if (!this.rendered) return;
        if (!this._showStationTabs) return;
        if (this._dialogState !== "list") return;
        const sid = this._station?.id;
        if (sid !== "cooking_station") return;

        const ctx = this._buildListContext();
        if (ctx.showStationTabs) return;
        if (ctx.hasAny) return;
        await this.close();
    }

    static #onSelectActivity(event, target) {
        const activityId = target.dataset.activityId;
        if (!activityId) return;
        this._selectedActivityId = activityId;
        this._followUpValue = null;
        this._dialogState = "detail";
        this.render();
    }

    static async #onConfirm() {
        const activityId = this._selectedActivityId;
        if (!activityId || !this._restApp?.finalizeActivityChoiceFromStation) return;

        const resolver = this._restApp._activityResolver;
        const activity = resolver?.activities?.get(activityId);

        if (activity?.crafting?.enabled) {
            await this._restApp.finalizeActivityChoiceFromStation(
                this._actor?.id, activityId, this._canvasStationId
            );
            this.close();
            return;
        }

        const result = await this._restApp.finalizeActivityChoiceFromStation(
            this._actor?.id,
            activityId,
            this._canvasStationId,
            { followUpValue: this._followUpValue }
        );

        if (result) {
            this._activityResult = result;
            this._dialogState = "result";
            this.render();
        } else {
            this.close();
        }
    }

    static #onBackToList() {
        this._dialogState = "list";
        this._selectedActivityId = null;
        this._followUpValue = null;
        this.render();
    }

    static #onDismissResult() {
        this.close();
    }

    static #onSwitchStationPanelTab(event, target) {
        const tab = target?.dataset?.tab;
        if (!tab) return;
        if (target.disabled || target.getAttribute("aria-disabled") === "true") return;
        this._stationPanelTab = tab;
        this.render();
    }

    static async #onSubmitStationRations() {
        const actorId = this._actor?.id;
        if (!actorId || !this._restApp?.submitActivityMealRationsFromStation) return;
        await this._restApp.submitActivityMealRationsFromStation(actorId);
        await this.render(true);
        await this._closeIfEmptyHubAfterRender();
    }

    static async #onSubmitWorkbenchIdentify() {
        const actorId = this._actor?.id;
        if (!actorId || !this._restApp?.submitWorkbenchIdentifyFromStation) return;
        await this._restApp.submitWorkbenchIdentifyFromStation(actorId);
        await this.render(true);
    }

    static async #onWorkbenchIdentifyRemovePotion(event, target) {
        const itemId = target?.closest?.("[data-item-id]")?.dataset?.itemId ?? target?.dataset?.itemId;
        const actorId = this._actor?.id;
        if (!itemId || !actorId || !this._restApp?.removeWorkbenchIdentifyPotionFromStation) return;
        this._restApp.removeWorkbenchIdentifyPotionFromStation(actorId, itemId);
        await this.render(true);
    }

    static async #onDismissWorkbenchIdentifyAck() {
        const actorId = this._actor?.id;
        if (!actorId || !this._restApp?.dismissWorkbenchIdentifyAcknowledgement) return;
        const ack = this._restApp._workbenchIdentifyAcknowledge?.get(actorId);
        if (!ack || Date.now() < ack.revealAt) return;
        this._restApp.dismissWorkbenchIdentifyAcknowledgement(actorId);
        await this.render(true);
    }

    static async #onStationDetectMagicScan() {
        if (!this._restApp?.runDetectMagicScan) return;
        await this._restApp.runDetectMagicScan();
        await this.render(true);
    }

    static async #onStationIdentifyScannedItem(event, target) {
        const actorId = target?.dataset?.actorId;
        const itemId = target?.dataset?.itemId;
        if (!actorId || !itemId || !this._restApp?.identifyScannedMagicItem) return;
        await this._restApp.identifyScannedMagicItem(actorId, itemId);
        await this.render(true);
    }

    _onRender(context, options) {
        super._onRender?.(context, options);
        this._attachTrackers();
        queueMicrotask(() => this._bindStationMealIfNeeded());
        queueMicrotask(() => this._bindStationWorkbenchIdentifyIfNeeded());
        queueMicrotask(() => this._scheduleWorkbenchAckRevealIfNeeded());
        queueMicrotask(() => this._bindFollowUpSelect());
        queueMicrotask(() => this._bindCampGearIfNeeded());
    }

    _bindCampGearIfNeeded() {
        if (!this.rendered || !this.element) return;
        if (this._station?.id !== "campfire" || !this._restApp?._bindCampDragHandlers) return;
        if (!this.element.querySelector("[data-camp-gear-row]")) return;
        this._restApp._bindCampDragHandlers(this.element);
    }

    _bindFollowUpSelect() {
        if (!this.rendered || !this.element || this._dialogState !== "detail") return;
        const sel = this.element.querySelector(".station-followup-input");
        if (!sel) return;
        sel.addEventListener("change", (e) => {
            this._followUpValue = e.target.value || null;
        });
        const radios = this.element.querySelectorAll("input.station-followup-radio");
        for (const r of radios) {
            r.addEventListener("change", (e) => {
                if (e.target.checked) this._followUpValue = e.target.value || null;
            });
        }
    }

    _bindStationMealIfNeeded() {
        if (!this.rendered || !this.element) return;
        if (!this._showStationTabs || this._stationPanelTab !== "meal") return;
        if (!this._restApp?._bindMealDragDrop) return;
        this._restApp._bindMealDragDrop(this.element);
    }

    _bindStationWorkbenchIdentifyIfNeeded() {
        if (!this.rendered || !this.element) return;
        if (this._station?.id !== "workbench" || this._stationPanelTab !== "identify") return;
        if (!this._restApp?._bindWorkbenchIdentifyDragDrop) return;
        this._restApp._bindWorkbenchIdentifyDragDrop(this.element);
    }

    _clearWorkbenchAckRevealTimer() {
        if (this._wbAckRevealTimer) {
            clearTimeout(this._wbAckRevealTimer);
            this._wbAckRevealTimer = null;
        }
    }

    /** Re-render when the post-identify Continue button should unlock. */
    _scheduleWorkbenchAckRevealIfNeeded() {
        if (!this.rendered || !this.element) return;
        if (this._station?.id !== "workbench" || this._stationPanelTab !== "identify") return;
        const actorId = this._actor?.id;
        if (!actorId || !this._restApp?._workbenchIdentifyAcknowledge) return;
        const ack = this._restApp._workbenchIdentifyAcknowledge.get(actorId);
        if (!ack) return;
        if (Date.now() >= ack.revealAt) return;
        this._clearWorkbenchAckRevealTimer();
        const delay = Math.max(40, ack.revealAt - Date.now());
        this._wbAckRevealTimer = setTimeout(() => {
            this._wbAckRevealTimer = null;
            if (!this.rendered) return;
            void this.render(true);
        }, delay);
    }

    /** Idempotent: starts canvasPan + ticker follow for the station token anchor. */
    _attachTrackers() {
        if (!this._stationToken || !canvas?.ready || this._trackStarted) return;
        this._trackStarted = true;
        this._canvasPanFn = () => this._syncTrackPosition();
        this._tickerFn     = () => this._syncTrackPosition();
        Hooks.on("canvasPan", this._canvasPanFn);
        canvas.app.ticker.add(this._tickerFn);

        if (!this._mealHookBound) {
            this._mealHookBound = () => {
                if (!this.rendered) return;
                void this.render(true).then(() => {
                    void this._closeIfEmptyHubAfterRender();
                });
            };
            Hooks.on(`${MODULE_ID}.stationMealChoicesTouched`, this._mealHookBound);
            Hooks.on(`${MODULE_ID}.workbenchIdentifyStagingTouched`, this._mealHookBound);
        }
    }

    _stopTokenTracking() {
        this._clearWorkbenchAckRevealTimer();
        if (this._tickerFn && canvas?.app?.ticker) {
            canvas.app.ticker.remove(this._tickerFn);
        }
        this._tickerFn = null;
        if (this._canvasPanFn) {
            Hooks.off("canvasPan", this._canvasPanFn);
        }
        this._canvasPanFn = null;
        this._trackStarted = false;
        if (this._mealHookBound) {
            Hooks.off(`${MODULE_ID}.stationMealChoicesTouched`, this._mealHookBound);
            Hooks.off(`${MODULE_ID}.workbenchIdentifyStagingTouched`, this._mealHookBound);
            this._mealHookBound = null;
        }
    }

    /**
     * Client (viewport CSS) pixel position for the token anchor used to place the dialog.
     * Uses Canvas#clientCoordinatesFromCanvas when present. Do not multiply PIXI global
     * positions by stage scale; getGlobalPosition already includes pan and zoom.
     *
     * @param {Token} stationToken
     * @returns {{ x: number, y: number } | null}
     */
    static _anchorClientPoint(stationToken) {
        if (!stationToken || !canvas?.ready) return null;
        const view = canvas.app?.view;
        if (!view) return null;
        const rect = view.getBoundingClientRect();

        if (typeof canvas.clientCoordinatesFromCanvas === "function") {
            const c = canvas.clientCoordinatesFromCanvas(stationToken.center);
            return { x: c.x, y: c.y };
        }

        const tp = stationToken.getGlobalPosition();
        const scaleX = rect.width / view.width;
        const scaleY = rect.height / view.height;
        return {
            x: rect.left + tp.x * scaleX,
            y: rect.top + tp.y * scaleY
        };
    }

    /**
     * @param {Token} stationToken
     * @param {number} width
     * @param {number} height
     * @returns {{ left: number, top: number, rawLeft: number, rawTop: number, clamped: boolean } | null}
     */
    static _dialogScreenRect(stationToken, width, height) {
        const anchor = StationActivityDialog._anchorClientPoint(stationToken);
        if (!anchor) return null;

        const rawLeft = anchor.x - width / 2;
        const rawTop  = anchor.y - height - ANCHOR_ABOVE_PX;
        const pad = 8;
        const left = Math.max(pad, Math.min(window.innerWidth - width - pad, rawLeft));
        const top  = Math.max(pad, Math.min(window.innerHeight - height - pad, rawTop));
        return {
            left,
            top,
            rawLeft,
            rawTop,
            clamped: left !== rawLeft || top !== rawTop
        };
    }

    /**
     * @param {number} left
     * @param {number} top
     * @param {number} w
     * @param {number} h
     * @returns {number} visible area ratio 0..1
     */
    static _visibleRatio(left, top, w, h) {
        const ix = Math.max(0, Math.min(window.innerWidth, left + w) - Math.max(0, left));
        const iy = Math.max(0, Math.min(window.innerHeight, top + h) - Math.max(0, top));
        if (w <= 0 || h <= 0) return 0;
        return (ix * iy) / (w * h);
    }

    _readDialogSize() {
        const el = this.element;
        const w = el?.offsetWidth > 0 ? el.offsetWidth : DIALOG_WIDTH;
        const h = el?.offsetHeight > 0 ? el.offsetHeight : EST_HEIGHT;
        return { w, h };
    }

    _syncTrackPosition() {
        if (!this.rendered) return;
        if (!this._stationToken || !canvas?.ready) return;
        if (!this._stationToken.document?.parent) {
            this.close();
            return;
        }

        const { w, h } = this._readDialogSize();
        const pos = StationActivityDialog._dialogScreenRect(this._stationToken, w, h);
        if (!pos) return;

        const rawVis = StationActivityDialog._visibleRatio(pos.rawLeft, pos.rawTop, w, h);
        if (rawVis < VIS_CLOSE_RATIO) {
            this.close();
            return;
        }

        this.setPosition({ left: pos.left, top: pos.top });
    }

    async close(options = {}) {
        this._stopTokenTracking();
        _openDialog = null;
        return super.close(options);
    }

    /**
     * Open the dialog for a station click.
     * Closes any previously open dialog first.
     *
     * @param {Object} station         - CAMP_STATIONS entry
     * @param {Actor}  actor           - The choosing actor
     * @param {Object} activityResolver - ActivityResolver instance (for filtering)
     * @param {Object} restSession     - { fireLevel, restType, ... }
     * @param {Token}  stationToken    - The canvas token that was clicked (for positioning)
     * @param {object|null} restApp - parent RestSetupApp instance
     * @param {string|null} canvasStationId - station id (canvas hint; list comes from station.activities)
     */
    static async openForStation(station, actor, activityResolver, restSession, stationToken, restApp, canvasStationId = null) {
        if (_openDialog) {
            _openDialog.close();
            _openDialog = null;
        }

        const restType  = restSession?.restType ?? "long";
        const isFireLit = !!(restSession?.fireLevel && restSession.fireLevel !== "unlit");

        const { available: allAvail, faded: allFaded } = activityResolver
            .getAvailableActivitiesWithFaded(actor, restType, { isFireLit });

        const stationIds = new Set(station.activities ?? []);

        let available = allAvail.filter(a => stationIds.has(a.id));
        let faded     = allFaded.filter(a => stationIds.has(a.id));

        // One rest activity per character. Resolver lists are non-minor only; once a choice
        // exists, do not offer another major pick from this station (e.g. Other after Tales).
        if (actor?.id && restApp?._characterChoices?.has(actor.id)) {
            available = [];
            faded = [];
        }

        const order       = station.activities ?? [];
        const stationRank = (id) => {
            const i = order.indexOf(id);
            return i === -1 ? 999 : i;
        };
        available.sort((a, b) => stationRank(a.id) - stationRank(b.id));
        faded.sort((a, b) => stationRank(a.id) - stationRank(b.id));

        const trackFood = game.settings.get(MODULE_ID, "trackFood");
        const workbenchHub = station.id === "workbench";
        const showStationTabs = ((station.id === "cooking_station" && trackFood) || workbenchHub);
        const actorHasCookingUtensils = station.id === "cooking_station" && actor
            ? canPlaceStation(actor, "cookingArea")
            : false;
        const cookingAvailable = available.filter(a => COOK_ACTIVITY_IDS.has(a.id));
        const cookingFaded     = faded.filter(a => COOK_ACTIVITY_IDS.has(a.id));
        const generalAvailable = available.filter(a => !COOK_ACTIVITY_IDS.has(a.id));
        const generalFaded     = faded.filter(a => !COOK_ACTIVITY_IDS.has(a.id));

        let initialStationTab = "activity";
        if (showStationTabs && station.id === "cooking_station") initialStationTab = "meal";
        if (workbenchHub && generalAvailable.length === 0) {
            initialStationTab = game.user?.isGM ? "identify" : "activity";
        }

        let dialogWidth = DIALOG_WIDTH;
        if (showStationTabs && station.id === "cooking_station") {
            dialogWidth = 380;
        } else if (workbenchHub) {
            dialogWidth = game.user?.isGM ? 350 : 300;
        } else if (station.id === "campfire") {
            dialogWidth = CAMPFIRE_DIALOG_WIDTH;
        }

        const partyState = restApp?.getPartyStateForAdvisory?.()
            ?? buildPartyState([], new Map(), 14);

        if (stationToken && canvas?.ready) {
            const pre = StationActivityDialog._dialogScreenRect(stationToken, dialogWidth, EST_HEIGHT);
            if (pre) {
                const rawVis = StationActivityDialog._visibleRatio(pre.rawLeft, pre.rawTop, dialogWidth, EST_HEIGHT);
                if (rawVis < PAN_TRIGGER_RATIO || pre.clamped) {
                    try {
                        await canvas.animatePan({
                            x: stationToken.center.x,
                            y: stationToken.center.y,
                            duration: 200
                        });
                    } catch (e) {
                        console.warn(`${MODULE_ID} | Station dialog pan`, e);
                    }
                }
            }
        }

        const pos = StationActivityDialog._dialogScreenRect(stationToken, dialogWidth, EST_HEIGHT);
        const left = pos?.left ?? (window.innerWidth / 2 - dialogWidth / 2);
        const top  = pos?.top ?? (window.innerHeight / 2 - EST_HEIGHT / 2);

        const sid = canvasStationId ?? station.id;
        const dialog = new StationActivityDialog(
            {
                station,
                actor,
                available: generalAvailable,
                faded: generalFaded,
                cookingAvailable,
                cookingFaded,
                showStationTabs,
                initialStationTab,
                actorHasCookingUtensils,
                restSession,
                restApp,
                canvasStationId: sid,
                partyState,
                stationToken
            },
            {
                position: { left, top, width: dialogWidth },
                window:   { title: station?.label ?? "Choose Activity" }
            }
        );
        _openDialog = dialog;
        await dialog.render(true);
        dialog._attachTrackers();
        dialog._syncTrackPosition();
        return dialog;
    }
}
