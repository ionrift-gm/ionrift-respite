import { Logger } from "../../utils/Logger.js";
import { MODULE_ID } from "../../data/moduleId.js";

import {
    ACTIVITY_ICONS,
    applyActivityPortraitAssignments,
    buildActivityAssignments,
    buildPartyState,
    foldOrphanedAssignmentsOntoOther,
    getActivityAdvisory,
    DETECT_MAGIC_BTN_LABEL_GM,
    DETECT_MAGIC_BTN_LABEL_PLAYER,
    DETECT_MAGIC_BTN_LABEL_DISMISS,
    DETECT_MAGIC_BTN_TITLE_GM,
    isWorkbenchExamineUiEnabled,
    isWorkbenchIdentifyUiEnabled
} from "../../data/RestConstants.js";
import { cardHintTakenBy } from "../../data/activityCardHint.js";
import { buildActivityListItem, buildActivityDetailContext, promptArmorSleepIfNeeded } from "../crafting/ActivityDetailBuilder.js";
import {
    computeCanShowDetectMagicScanButton,
    computeCanTriggerDetectMagicScan,
    getDetectMagicPlayerAccessReason,
    spawnDetectMagicCastRipple
} from "../delegates/crafting/DetectMagicDelegate.js";
import { canPlaceStation, actorHasBrewingTools } from "../../services/camp/props/CompoundCampPlacer.js";
import { getPartyActors, getFoodBuffPartyActors } from "../../services/party/partyActors.js";
import { MonstrousFeastBridge } from "../../services/meal/provisions/MonstrousFeastBridge.js";
import { formatMealBuffPreview } from "../../services/meal/buffs/MealBuffPresets.js";
import { buildCraftCommitSummary, resolveDefaultCraftRecipeId } from "../../services/crafting/engine/CraftCommitSummary.js";
import { buildCraftRecipeListContext } from "../../services/crafting/engine/CraftRecipeListBuilder.js";
import { patchCraftingRiskUi } from "../../services/crafting/engine/CraftingRiskUiPatch.js";
import { emitFeastServeRequest, emitActivityColdCampRequest, emitSocketMessage } from "../../services/socket/SocketController.js";
import { CampGearScanner, isTinderboxItem, isActorFirewoodItem } from "../../services/camp/gear/CampGearScanner.js";
import { isStationLayerActive } from "../../services/camp/props/StationInteractionLayer.js";
import { guardEmbedItems } from "../../services/crafting/outcomes/MintGuard.js";
import { GrantLedger } from "../../services/crafting/outcomes/GrantLedger.js";
import { ItemOutcomeHandler } from "../../services/crafting/outcomes/ItemOutcomeHandler.js";
import { CraftingDelegate } from "../delegates/crafting/CraftingDelegate.js";

import { COOK_ACTIVITY_IDS, StationActivityDialog } from "./StationActivityDialog.js";
export const StationDialogContextMethods = {
    async _prepareContext(options) {
        Logger.log(`ionrift-respite | _prepareContext`, { state: this._dialogState, width: this.position?.width, actor: this._actor?.name });
        const base = {
            station:    this._station,
            actorName:  this._actor?.name ?? "Unknown",
            dialogState: this._dialogState
        };

        if (this._dialogState === "detail") return { ...base, ...this._buildDetailContext() };
        if (this._dialogState === "result") return { ...base, ...this._buildResultContext() };
        if (this._dialogState === "crafting") return { ...base, ...this._buildCraftingContext() };
        return { ...base, ...this._buildListContext() };
    },

    _buildListContext() {
        const ps = this._partyState ?? buildPartyState([], new Map(), 14);
        const mapAct = (act, isAvail) => {
            const item = buildActivityListItem(act.id, act, isAvail ? this._actor : null, ps, isAvail);
            return item;
        };

        const activityItems = this._available.map(act => mapAct(act, true));
        const fadedItems    = this._faded.map(act => mapAct(act, false));

        const cookActItems = this._cookingAvailable.map(act => mapAct(act, true));
        const cookFaded    = this._cookingFaded.map(act => mapAct(act, false));

        // UX-9: Inject portrait assignments into each activity item
        const assignments = this._buildActivityAssignments();
        const _injectAssignments = (items) => {
            for (const item of items) {
                applyActivityPortraitAssignments(item, assignments[item.id] ?? []);
            }
        };
        _injectAssignments(activityItems);
        _injectAssignments(fadedItems);
        _injectAssignments(cookActItems);
        _injectAssignments(cookFaded);

        const hubEligible = this._showStationTabs;
        const mealCard = (hubEligible && this._station.id !== "workbench" && this._restApp?.getStationMealCardForActor && this._actor?.id)
            ? this._restApp.getStationMealCardForActor(this._actor.id)
            : null;
        const hasAnyGeneral = activityItems.length > 0;
        const hasCookingAvail = cookActItems.length > 0;

        // GM and actors with the Identify spell prepared can see it.
        const _identifyGateData = (hubEligible && isWorkbenchIdentifyUiEnabled() && this._station?.id === "workbench" && this._restApp?.getStationIdentifyEmbedContext)
            ? this._restApp.getStationIdentifyEmbedContext({})
            : { identifyCasters: [], unidentifiedItems: [] };
        const isIdentifyCaster = _identifyGateData.identifyCasters?.some(c => c.id === this._actor?.id);
        this._canSeeSharedPool = !!game.user?.isGM || !!isIdentifyCaster;
        const _byOwner = new Map();
        for (const item of (_identifyGateData.unidentifiedItems ?? []).filter(it => !it.isPotion)) {
            if (!_byOwner.has(item.actorId)) {
                _byOwner.set(item.actorId, {
                    ownerName: item.actorName,
                    ownerId: item.actorId,
                    items: []
                });
            }
            _byOwner.get(item.actorId).items.push(item);
        }
        const unidentifiedItemsByOwner = [..._byOwner.values()];

        const stationTabs = [];
        if (hubEligible && this._station.id === "cooking_station") {
            if (mealCard) {
                stationTabs.push({ id: "meal", label: game.i18n.localize("ionrift-respite.stationActivity.tabRations") });
            }
            if (this._stationHasCooking) {
                stationTabs.push({
                    id: "cooking",
                    label: game.i18n.localize("ionrift-respite.stationActivity.tabCooking"),
                    hintClass: this._actorHasCookingUtensils ? "" : "station-sub-tab-hint",
                    title: this._actorHasCookingUtensils
                        ? ""
                        : game.i18n.localize("ionrift-respite.stationActivity.requiresCooksUtensils")
                });
            }
        } else if (hubEligible && this._station.id === "workbench") {
            if (hasAnyGeneral && !this._actorChoiceLocked) {
                stationTabs.push({ id: "activity", label: game.i18n.localize("ionrift-respite.stationActivity.tabActivities") });
            }
            if (isWorkbenchExamineUiEnabled()) {
                stationTabs.push({ id: "examine", label: game.i18n.localize("ionrift-respite.stationActivity.tabExamine") });
            }
            if (isWorkbenchIdentifyUiEnabled() && this._canSeeSharedPool) {
                stationTabs.push({ id: "identify", label: game.i18n.localize("ionrift-respite.stationActivity.tabIdentify") });
            }
        } else if (hubEligible && this._station.id === "campfire") {
            const campfireTabs = this._restApp?.getCampfireStationDialogTabs?.() ?? [];
            stationTabs.push(...campfireTabs);
        }

        const tabIds = new Set(stationTabs.map(t => t.id));
        if (!tabIds.has(this._stationPanelTab)) {
            this._stationPanelTab = stationTabs[0]?.id ?? "activity";
        }
        if (this._station.id === "campfire" && stationTabs.length > 0 && this._stationPanelTab === "activity") {
            this._stationPanelTab = "camp";
        }

        const showStationTabs = stationTabs.length > 0;
        const showTabBar = stationTabs.length > 1;

        const campfireFlavorOnly = !!(this._station?.id === "campfire"
            && this._restApp?.isCampfireStationFlavorOnly?.());
        const campGearAtFire = (this._station?.id === "campfire" && this._restApp?.getCampGearContextForActor)
            ? this._restApp.getCampGearContextForActor(this._actor?.id)
            : null;
        const campComfortAtFire = (this._station?.id === "campfire" && this._restApp?.getCampComfortAdvisoryForStationDialog)
            ? this._restApp.getCampComfortAdvisoryForStationDialog()
            : null;
        const campGearFlavorPanel = (campfireFlavorOnly && this._actor?.id
            && this._restApp?.getCampGearFlavorPanelForActor)
            ? this._restApp.getCampGearFlavorPanelForActor(this._actor.id)
            : null;
        const campPersonalCard = (!campfireFlavorOnly && this._station?.id === "campfire"
            && this._restApp?.getCampPersonalCardForActor && this._actor?.id)
            ? this._restApp.getCampPersonalCardForActor(this._actor.id)
            : null;
        const fireTabContext = (this._station?.id === "campfire" && this._restApp?.getFireTabContextForStationDialog)
            ? this._restApp.getFireTabContextForStationDialog()
            : null;

        // Identify embed context: Examine tab uses own-only; Identify tab uses party-wide.
        // canSeeSharedPool was pre-computed at construction in _buildListContext preamble.
        const identifyEmbedOwn = (isWorkbenchExamineUiEnabled()
            && this._station?.id === "workbench"
            && this._restApp?.getStationIdentifyEmbedContext)
            ? this._restApp.getStationIdentifyEmbedContext({
                restrictUnidentifiedToActorId: this._actor?.id ?? null
            })
            : { unidentifiedItems: [], identifyCasters: [], detectMagicCasters: [] };
        const identifyEmbed = identifyEmbedOwn;

        const wbWorkbenchDefaults = {
            workbenchIdentifyActorId: null,
            workbenchGearChip: null,
            workbenchPotionChip: null,
            workbenchSpellChip: null,
            workbenchSubmitLocked: true,
            workbenchSubmitPending: false,
            workbenchIdentifyAcknowledgement: null,
            workbenchAckRevealReady: true,
            workbenchFocusExhausted: false,
            identifyAvailable: false,
            detectMagicAvailable: false,
            identifyAccess: { state: "unavailable", badge: "Spell", tooltip: game.i18n.localize("ionrift-respite.stationActivity.requiresIdentifySpell"), caption: game.i18n.localize("ionrift-respite.stationActivity.requiresIdentifySpell") },
            detectMagicAccess: { state: "unavailable", badge: "Spell", tooltip: game.i18n.localize("ionrift-respite.stationActivity.requiresDetectMagicSpell"), caption: game.i18n.localize("ionrift-respite.stationActivity.requiresDetectMagicSpell") },
            identifyPill: "Spell",
            detectMagicPill: "Spell",
            arcaneBadge: "Spell",
            arcaneStatus: game.i18n.localize("ionrift-respite.stationActivity.requiresIdentifyOrDetectMagic"),
            detectMagicDisabledTooltip: game.i18n.localize("ionrift-respite.stationActivity.requiresDetectMagicSpell")
        };
        const wbCtx = (isWorkbenchExamineUiEnabled()
            && this._station?.id === "workbench"
            && this._restApp?._workbench?.buildEmbedContext)
            ? this._restApp._workbench.buildEmbedContext(this._actor?.id ?? null, getPartyActors)
            : (isWorkbenchExamineUiEnabled()
                && this._station?.id === "workbench"
                && this._restApp?.getWorkbenchIdentifyDragContext)
                ? {
                    ...wbWorkbenchDefaults,
                    ...this._restApp.getWorkbenchIdentifyDragContext(this._actor?.id ?? null)
                }
                : wbWorkbenchDefaults;

        return {
            activities:       [...activityItems, ...fadedItems],
            hasAny:           activityItems.length > 0 || fadedItems.length > 0,
            cookingActivities: [...cookActItems, ...cookFaded],
            hasCookingAny:    cookActItems.length > 0 || cookFaded.length > 0,
            actorHasCookingUtensils: this._actorHasCookingUtensils,
            actorChoiceLocked: this._actorChoiceLocked,
            showStationTabs,
            showTabBar,
            stationTabs,
            stationPanelTab:  this._stationPanelTab,
            mealCard,
            mealCardNeedsEssence: !!(mealCard?.needsEssence),
            workbenchExamineEnabled: this._station?.id === "workbench" && isWorkbenchExamineUiEnabled(),
            workbenchIdentifyUiEnabled: isWorkbenchIdentifyUiEnabled(),
            unidentifiedItems: identifyEmbed.unidentifiedItems ?? [],
            unidentifiedItemsByOwner,
            canSeeSharedPool: this._canSeeSharedPool,
            identifyCasters: _identifyGateData.identifyCasters ?? [],
            campGearAtFire,
            campComfortAtFire,
            campComfortLine: campComfortAtFire?.mapComfortLine ?? null,
            campfireFlavorOnly,
            campGearFlavorPanel,
            campPersonalCard,
            fireTabContext,
            hideNoActivitiesMessage: this._station?.id === "campfire",
            isGmUser:           !!game.user?.isGM,
            canShowDetectMagicScanButton: wbCtx.canShowDetectMagicScanButton
                ?? computeCanShowDetectMagicScanButton(getPartyActors()),
            canTriggerDetectMagicScan: wbCtx.canTriggerDetectMagicScan
                ?? computeCanTriggerDetectMagicScan(getPartyActors()),
            detectMagicScanButtonLabel: wbCtx.detectMagicScanButtonLabel
                ?? (this._restApp?._magicScanComplete
                    ? DETECT_MAGIC_BTN_LABEL_DISMISS
                    : (game.user?.isGM ? DETECT_MAGIC_BTN_LABEL_GM : DETECT_MAGIC_BTN_LABEL_PLAYER)),
            detectMagicScanButtonTitle: wbCtx.detectMagicScanButtonTitle
                ?? (game.user?.isGM
                    ? DETECT_MAGIC_BTN_TITLE_GM
                    : (getDetectMagicPlayerAccessReason(getPartyActors()) ?? "")),
            magicScanResults: wbCtx.magicScanResults ?? this._restApp?._magicScanResults ?? [],
            magicScanComplete: wbCtx.magicScanComplete ?? !!this._restApp?._magicScanComplete,
            magicScanActive: wbCtx.magicScanActive ?? !!this._restApp?._magicScanComplete,
            ...wbCtx,
            workbenchFocusExhausted: wbCtx.workbenchFocusExhausted ?? false
        };
    },

    _buildDetailContext() {
        const activityId = this._selectedActivityId;
        const resolver = this._restApp?._activityResolver;
        const activity = resolver?.activities?.get(activityId);
        if (!activity) return { activityDetail: null };

        const actor = this._actor;
        const comfort = this._restApp?._engine?.comfort ?? "sheltered";
        const followUpValue =
            this._followUpValue
            ?? this._restApp?._gmFollowUps?.get(actor?.id)
            ?? this._restApp?._getFollowUpForCharacter?.(actor?.id)
            ?? null;
        let armorRuleEnabled = false;
        try { armorRuleEnabled = !!game.settings.get(MODULE_ID, "armorDoffRule"); } catch { /* ok */ }
        const safeSpot = !!(this._restApp?._engine?.safeRestSpot ?? this._restApp?._restData?.safeRestSpot);
        let fromSetting = false;
        try { fromSetting = !!game.settings.get(MODULE_ID, "safeRestSpot"); } catch { /* ok */ }
        const effectiveSafe = safeSpot || fromSetting;
        const armorForDetail = !effectiveSafe && armorRuleEnabled;

        const ps = this._partyState ?? buildPartyState([], new Map(), 14);

        const detail = buildActivityDetailContext(activityId, activity, actor, ps, {
            comfort,
            followUpValue,
            armorRuleEnabled: armorForDetail,
            getArmorWarning: armorForDetail
                ? (this._restApp?.getArmorWarningForActivityDetail?.bind(this._restApp) ?? null)
                : null
        });

        return { activityDetail: { ...detail, characterId: actor?.id } };
    },

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
    },

    /**
     * Format a recipe buff definition into a display-ready preview object.
     * @param {object|null} buff - The buff definition from outputFlags
     * @returns {object|null}
     */
    _formatBuffPreview(buff) {
        return formatMealBuffPreview(buff);
    },

    /** Compute station tab definitions. Shared by list and crafting contexts. */
    _buildStationTabs() {
        if (!this._showStationTabs) return [];
        const stationTabs = [];
        if (this._station.id === "cooking_station") {
            const mealCard = this._restApp?.getStationMealCardForActor?.(this._actor?.id) ?? null;
            if (mealCard) {
                stationTabs.push({ id: "meal", label: game.i18n.localize("ionrift-respite.stationActivity.tabRations") });
            }
            if (this._stationHasCooking) {
                stationTabs.push({
                    id: "cooking",
                    label: game.i18n.localize("ionrift-respite.stationActivity.tabCooking"),
                    hintClass: this._actorHasCookingUtensils ? "" : "station-sub-tab-hint",
                    title: this._actorHasCookingUtensils ? "" : game.i18n.localize("ionrift-respite.stationActivity.requiresCooksUtensils")
                });
            }
        } else if (this._station.id === "workbench") {
            const hasGeneral = this._available.length > 0;
            if (hasGeneral && !this._actorChoiceLocked) {
                stationTabs.push({ id: "activity", label: game.i18n.localize("ionrift-respite.stationActivity.tabActivities") });
            }
            if (isWorkbenchExamineUiEnabled()) {
                stationTabs.push({ id: "examine", label: game.i18n.localize("ionrift-respite.stationActivity.tabExamine") });
            }
            if (isWorkbenchIdentifyUiEnabled() && this._canSeeSharedPool) {
                stationTabs.push({ id: "identify", label: game.i18n.localize("ionrift-respite.stationActivity.tabIdentify") });
            }
        } else if (this._station.id === "campfire") {
            const campfireTabs = this._restApp?.getCampfireStationDialogTabs?.() ?? [];
            stationTabs.push(...campfireTabs);
        }
        return stationTabs;
    },

    /**
     * UX-9: Build per-activity portrait assignments for the current station.
     * Iterates _characterChoices, filters to activities visible at this station,
     * and annotates with resolution status from _earlyResults.
     *
     * @returns {Object<string, Object[]>} Map of activityId ,  array of
     *   { actorId, actorName, portraitImg, status: 'pending'|'success'|'fail' }
     */
    _buildActivityAssignments() {
        const restApp = this._restApp;
        if (!restApp?._characterChoices?.size) return {};

        const stationActIds = new Set([
            ...this._available.map(a => a.id),
            ...this._faded.map(a => a.id),
            ...this._cookingAvailable.map(a => a.id),
            ...this._cookingFaded.map(a => a.id)
        ]);

        const assignments = buildActivityAssignments(
            restApp._characterChoices,
            restApp._earlyResults
        );
        foldOrphanedAssignmentsOntoOther(assignments, stationActIds);
        return assignments;
    },

    _buildCraftingContext() {
        const actor = this._actor;
        const engine = this._restApp?._craftingEngine;
        Logger.log(`ionrift-respite | _buildCraftingContext`, { hasActor: !!actor, hasEngine: !!engine, profession: this._craftProfession });
        if (!actor || !engine) return { crafting: null };

        const professionId = this._craftProfession;
        const terrainTag = this._restApp?._engine?.terrainTag ?? this._restApp?._restData?.terrainTag ?? null;
        const partySize = getPartyActors().length;

        if (!this._craftHasCrafted) {
            this._craftRecipeId = resolveDefaultCraftRecipeId({
                engine,
                actor,
                profession: professionId,
                terrainTag,
                partySize,
                currentId: this._craftRecipeId,
                hasCrafted: false
            });
        }

        const list = buildCraftRecipeListContext({
            engine,
            actor,
            professionId,
            risk: this._craftRisk,
            terrainTag,
            partySize,
            selectedRecipeId: this._craftRecipeId,
            hasCrafted: this._craftHasCrafted,
            formatBuffPreview: (buff) => this._formatBuffPreview(buff)
        });
        const { available, missing, partial, selectedRecipe, commitSummary, noAvailableRecipes } = list;

        const stationTabs = this._buildStationTabs();
        const showTabBar = stationTabs.length > 1;
        const craftAct = this._restApp?._activityResolver?.activities?.get(this._selectedActivityId)
            ?? { armorSleepWaiver: false };
        const armorWarning = this._restApp?.getArmorWarningForActivityDetail?.(actor, craftAct) ?? null;

        return {
            showTabBar,
            stationTabs,
            stationPanelTab: this._stationPanelTab,
            craftRollPending: this._craftRollPending,
            mfCookbookAvailable: professionId === "cooking"
                && !this._craftHasCrafted
                && MonstrousFeastBridge.ownsCooking(),
            crafting: {
                profession: list.profession,
                professionId,
                actorName: actor.name,
                actorImg: actor.img,
                selectedRisk: this._craftRisk,
                selectedRecipeId: this._craftRecipeId,
                hasCrafted: this._craftHasCrafted,
                rollPending: this._craftRollPending,
                showMissing: this._craftShowMissing,
                hideRiskTiers: !!selectedRecipe?.noSkillCheck,
                riskTiers: selectedRecipe?.noSkillCheck ? [] : [
                    { id: "standard", label: game.i18n.localize("ionrift-respite.stationActivity.riskStandard"), hint: game.i18n.localize("ionrift-respite.stationActivity.riskStandardHint"), selected: this._craftRisk === "standard" },
                    { id: "ambitious", label: game.i18n.localize("ionrift-respite.stationActivity.riskAmbitious"), hint: game.i18n.localize("ionrift-respite.stationActivity.riskAmbitiousHint"), selected: this._craftRisk === "ambitious" }
                ],
                available,
                missing,
                partial,
                selectedRecipe: selectedRecipe ?? null,
                noAvailableRecipes,
                commitSummary,
                armorWarning,
                craftingResult: this._craftResult ? {
                    ...this._craftResult,
                    isPartyMeal: !!(selectedRecipe?.isPartyMeal ?? false),
                    partyMealDispositionDone: this._partyMealOutcomeResolved,
                    partyRoster: getFoodBuffPartyActors().map(a => ({
                        id: a.id,
                        name: a.name,
                        img: a.img || "icons/svg/mystery-man.svg",
                        alreadyWellFed: a.effects?.some(e => e.flags?.[MODULE_ID]?.wellFed === true) ?? false
                    }))
                } : null
            }
        };
    },

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
    },

    /**
     * Open the Monstrous Feast cookbook as an optional alternative to Respite's
     * native cooking. The station dialog stays open and every normal activity
     * stays reachable, so the player can cancel the cookbook and pick something
     * else without spending anything. A completed cook calls back into
     * {@link _onMonstrousFeastCookCompleted}, which consumes the cook's rest
     * activity. Surfaced only when Monstrous Feast is installed.
     */
};
