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
import { openActorSpellbook } from "../../services/ui/sheet/SpellbookShortcut.js";
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

import { COOK_ACTIVITY_IDS, DIALOG_WIDTH, CRAFT_SPLIT_WIDTH, StationActivityDialog } from "./StationActivityDialog.js";
export const StationDialogActionMethods = {
    onOpenMonsterCookbook() {
        const dialog = this;
        const opened = MonstrousFeastBridge.openCooking(this._actor, {
            onCooked: () => { void dialog._onMonstrousFeastCookCompleted(); }
        });
        if (!opened) {
            ui.notifications.warn(game.i18n.localize("ionrift-respite.stationActivity.monsterCookbookUnavailable"));
        }
    },

    /**
     * Record a completed Monstrous Feast cook as this character's cooking
     * activity for the rest, then close the station dialog. Idempotent: a cook
     * fires once, and the commit guards against re-entry. Cancelling the
     * cookbook never reaches here, so it spends nothing.
     */
    async _onMonstrousFeastCookCompleted() {
        if (this._mfCookCommitted) return;
        this._mfCookCommitted = true;
        this._craftProfession = "cooking";
        if (!this._selectedActivityId) this._selectedActivityId = "act_cook";
        this._craftResult = {
            success: true,
            narrative: "Cooked from the Monster Cookbook.",
            recipeId: null,
            monstrousFeast: true,
            ingredientsConsumed: true
        };
        this._craftHasCrafted = true;
        this._craftCommitted = false;
        await this._autoCommitCraftResult();
        await this.close();
    },

    onSelectActivity(event, target) {
        const activityId = target.dataset.activityId;
        Logger.log(`ionrift-respite | #onSelectActivity`, { activityId, target: target?.outerHTML?.slice(0,120) });
        if (!activityId) return;
        this._selectedActivityId = activityId;
        this._followUpValue = null;

        // Cooking activities skip the detail/confirm step. Go straight to crafting.
        if (COOK_ACTIVITY_IDS.has(activityId)) {
            const resolver = this._restApp?._activityResolver;
            const activity = resolver?.activities?.get(activityId)
                ?? this._cookingAvailable?.find(a => a.id === activityId);
            const cookProfession = activity?.crafting?.profession ?? (activityId === "act_cook" ? "cooking" : activityId === "act_brew" ? "brewing" : "cooking");
            this._craftProfession  = cookProfession;
            this._craftRecipeId    = null;
            this._craftRisk        = "standard";
            this._craftResult      = null;
            this._craftHasCrafted  = false;
            this._craftCommitted   = false;
            this._craftRollPending = false;
            this._craftShowMissing = false;
            this._partyMealOutcomeResolved = false;
            this._dialogState      = "crafting";
            this._preCraftWidth    = this.position?.width ?? DIALOG_WIDTH;
            this._craftDetailScrollTop = 0;
            Logger.log(`ionrift-respite | cooking shortcut ,  crafting state`, { profession: this._craftProfession, width: this.position?.width });
            this.setPosition({ width: CRAFT_SPLIT_WIDTH });
            this.render({ resetCraftScroll: true });
            return;
        }

        this._dialogState = "detail";
        this.render();
    },

    async onConfirm() {
        try {
        const activityId = this._selectedActivityId;
        if (!activityId || !this._restApp?.finalizeActivityChoiceFromStation) return;

        Logger.log(`ionrift-respite | #onConfirm`, { activityId, hasRestApp: !!this._restApp?.finalizeActivityChoiceFromStation });
        const resolver = this._restApp._activityResolver;
        const activity = resolver?.activities?.get(activityId)
            // Cooking activities live in _cookingAvailable, not the resolver
            ?? this._cookingAvailable?.find(a => a.id === activityId)
            ?? this._available?.find(a => a.id === activityId);
        Logger.log(`ionrift-respite | #onConfirm activity`, { activity: activity?.id, isCrafting: !!activity?.crafting?.enabled, isCookId: !!COOK_ACTIVITY_IDS.has(activityId) });

        // Armor penalty gate: warn before locking an activity that penalises sleeping in armor.
        const effectiveSafe = !!(this._restApp?._engine?.safeRestSpot ?? this._restApp?._restData?.safeRestSpot)
            || (() => { try { return !!game.settings.get(MODULE_ID, "safeRestSpot"); } catch { return false; } })();
        if (!effectiveSafe && !activity?.armorSleepWaiver) {
            try {
                const armorRuleEnabled = game.settings.get(MODULE_ID, "armorDoffRule");
                if (armorRuleEnabled) {
                    const equippedArmor = this._actor?.items?.find(i =>
                        i.type === "equipment"
                        && i.system?.equipped
                        && ["medium", "heavy"].includes(i.system?.type?.value ?? i.system?.armor?.type)
                    );
                    if (equippedArmor) {
                        const confirmFn = game.ionrift?.library?.confirm ?? Dialog.confirm.bind(Dialog);
                        const proceed = await confirmFn({
                            title: game.i18n.localize("ionrift-respite.stationActivity.sleepingInArmorTitle"),
                            content: game.i18n.format("ionrift-respite.stationActivity.sleepingInArmorContent", { name: equippedArmor.name }),
                            yesLabel: game.i18n.localize("ionrift-respite.stationActivity.confirmAnyway"),
                            noLabel: game.i18n.localize("ionrift-respite.stationActivity.cancel"),
                            yesIcon: "fas fa-check",
                            noIcon: "fas fa-times",
                            defaultYes: false,
                        });
                        if (!proceed) return;
                    }
                }
            } catch (e) { /* setting may not be registered */ }
        }

        // Crafting activities: transition to inline crafting picker
        if (activity?.crafting?.enabled || COOK_ACTIVITY_IDS.has(activityId)) {
            const cookProfession = activity?.crafting?.profession ?? (activityId === "act_cook" ? "cooking" : activityId === "act_brew" ? "brewing" : "cooking");
            this._craftProfession  = cookProfession;
            this._craftRecipeId    = null;
            this._craftRisk        = "standard";
            this._craftResult      = null;
            this._craftHasCrafted  = false;
            this._craftCommitted   = false;
            this._craftRollPending = false;
            this._craftShowMissing = false;
            this._partyMealOutcomeResolved = false;
            this._dialogState      = "crafting";
            // Widen for the split-panel crafting layout
            this._preCraftWidth = this.position?.width ?? DIALOG_WIDTH;
            this._craftDetailScrollTop = 0;
            Logger.log(`ionrift-respite | entering crafting state`, { profession: this._craftProfession, preCraftWidth: this._preCraftWidth, newWidth: CRAFT_SPLIT_WIDTH });
            this.setPosition({ width: CRAFT_SPLIT_WIDTH });
            this.render({ resetCraftScroll: true });
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
        } catch (err) {
            console.error(`ionrift-respite | #onConfirm error`, err);
        }
    },

    onBackToList() {
        this._dialogState = "list";
        this._selectedActivityId = null;
        this._followUpValue = null;
        this.render();
    },

    onDismissResult() {
        this.close();
    },

    onCraftSelectRecipe(event, target) {
        if (this._craftRollPending || this._craftHasCrafted) return;
        this._craftRecipeId = target.dataset.recipeId;
        this._craftRisk = "standard";
        this.render();
    },

    async onCraftSelectRisk(event, target) {
        if (this._craftRollPending || this._craftHasCrafted) return;
        const risk = target.dataset.risk;
        if (!risk || !["standard", "ambitious"].includes(risk)) return;
        if (risk === this._craftRisk) return;
        this._craftRisk = risk;

        const root = this.element?.querySelector(".station-crafting-panel.crafting-split");
        const actor = this._actor;
        const engine = this._restApp?._craftingEngine;

        if (!root || !actor || !engine || !this._craftRecipeId) {
            this.render();
            return;
        }

        const terrainTag = this._restApp?._engine?.terrainTag ?? this._restApp?._restData?.terrainTag ?? null;
        const partySize = engine.getRecipePartySize(this._craftRecipeId, this._craftProfession);
        const status = engine.getRecipeStatus(actor, this._craftProfession, terrainTag, partySize);
        const recipe = status.available.find(r => r.id === this._craftRecipeId)
            ?? status.partial.find(r => r.id === this._craftRecipeId);

        if (!recipe) {
            this.render();
            return;
        }
        if (recipe.noSkillCheck) return;

        const commitSummary = buildCraftCommitSummary({
            recipe,
            risk,
            actor,
            engine,
            terrainTag
        });
        const dcBreakdown = engine.getDcBreakdown(actor, recipe, risk, terrainTag);

        const patched = await patchCraftingRiskUi(root, {
            risk,
            commitSummary,
            dcBreakdown,
            dcDisplay: dcBreakdown.total
        });

        if (!patched) this.render({ resetCraftScroll: false });
    },

    async onCraftCommit() {
        if (this._craftRollPending || this._craftHasCrafted || !this._craftRecipeId) return;
        const actor = this._actor;
        const restApp = this._restApp;
        if (!restApp?._craftingEngine || !actor) return;

        this._partyMealOutcomeResolved = false;

        this._craftRollPending = true;
        this.render();
        try {
            const { ok, result } = await CraftingDelegate.commitCraftRoll({
                restApp,
                actor,
                profession: this._craftProfession,
                recipeId: this._craftRecipeId,
                risk: this._craftRisk
            });
            if (ok) {
                this._craftResult = result;
                this._craftHasCrafted = true;
                if (result?.success) {
                    await this._autoCommitCraftResult();
                    this._resyncStationActivitiesFromRestApp();
                }
            }
        } finally {
            this._craftRollPending = false;
            this.render();
        }
    },

    onCraftToggleMissing() {
        if (this._craftRollPending) return;
        this._craftShowMissing = !this._craftShowMissing;
        this.render();
    },

    /**
     * Commits the in-progress crafting result to RestSetupApp exactly once.
     * Called from the explicit Close/Keep button and from close() as a safety net,
     * so that closing via the window X still locks the actor's activity.
     */
    async _autoCommitCraftResult() {
        if (this._craftCommitted) return;
        if (!this._craftHasCrafted || !this._craftResult) return;

        const characterId = this._actor?.id;
        const profession  = this._craftProfession;
        const result      = this._craftResult;
        const restApp     = this._restApp;
        if (!restApp || !characterId) return;

        const resolver = restApp._activityResolver;
        const craftAct = resolver?.activities
            ? [...resolver.activities.values()].find(a => a.crafting?.profession === profession)
            : null;
        const proceed = await promptArmorSleepIfNeeded(this._actor, craftAct ?? { armorSleepWaiver: false });
        if (!proceed) return;

        this._craftCommitted = true;

        restApp._craftingResults?.set(characterId, result);

        const activityId = craftAct?.id ?? this._selectedActivityId;
        Logger.log(`ionrift-respite | _autoCommitCraftResult DEBUG`, {
            profession,
            resolverSize: resolver?.activities?.size ?? "no-resolver",
            craftActId: craftAct?.id ?? null,
            selectedActivityId: this._selectedActivityId,
            resolvedActivityId: activityId,
            characterChoicesBefore: Object.fromEntries(restApp._characterChoices ?? [])
        });

        if (restApp._isGM) {
            restApp._gmOverrides?.set(characterId, activityId);
            restApp._rebuildCharacterChoices?.();
            const submissions = {};
            for (const [charId, actId] of restApp._characterChoices) {
                const act = resolver?.activities?.get(actId);
                submissions[charId] = {
                    activityId: actId,
                    activityName: act?.name ?? actId,
                    source: restApp._gmOverrides?.has(charId) ? "gm" : "player"
                };
            }
            emitSocketMessage({ type: "submissionUpdate", submissions });
        } else {
            restApp._characterChoices?.set(characterId, activityId);
            restApp._lockedCharacters = restApp._lockedCharacters ?? new Set();
            restApp._lockedCharacters.add(characterId);
            const choicesPayload = Object.fromEntries(restApp._characterChoices);
            Logger.log(`ionrift-respite | _autoCommitCraftResult EMIT`, {
                activityId,
                choicesPayload,
                characterId
            });
            emitSocketMessage({
                type: "activityChoice",
                userId: game.user.id,
                choices: choicesPayload,
                craftingResults: { [characterId]: result }
            });
            ui.notifications.info(game.i18n.format("ionrift-respite.stationActivity.activitySubmitted", { name: this._actor?.name ?? "" }));
        }
        if (restApp.rendered) restApp.render();
        // activityChoice socket is GM-only; refresh overlays locally so committed players see faded stations.
        if (restApp._phase === "activity" && isStationLayerActive()) {
            restApp._refreshStationOverlayForFocusChange?.();
        }
    },

    async onCraftClose() {
        if (this._craftRollPending || this._feastServeInFlight) return;
        await this._autoCommitCraftResult();

        // Restore pre-craft dialog width
        if (this._preCraftWidth) {
            this.setPosition({ width: this._preCraftWidth });
            this._preCraftWidth = null;
        }
        this.close();
    },

    onSwitchStationPanelTab(event, target) {
        const tab = target?.dataset?.tab;
        if (!tab) return;
        if (target.disabled || target.getAttribute("aria-disabled") === "true") return;
        if (this._craftRollPending) return;
        this._stationPanelTab = tab;
        if (tab !== "fire") this._restApp?.setStationFirePreviewLevel?.(null);

        // Cooking tab with utensils ,  auto-enter crafting split panel (fresh session only).
        // If a craft already resolved this session, keep result state so Rations ↔ Cooking
        // tab switches do not wipe the finished craft before Close commits the activity.
        const canEnterCookingCraft = (this._cookingAvailable?.length ?? 0) > 0;
        const craftBlocked = this._restApp?.hasCompletedCrafting?.(this._actor?.id);
        if (tab === "cooking" && this._actorHasCookingUtensils && !this._actorChoiceLocked && canEnterCookingCraft && !craftBlocked) {
            this._dialogState = "crafting";
            if (!this._craftHasCrafted) {
                const cookId = "act_cook";
                this._selectedActivityId = cookId;
                this._followUpValue = null;
                this._craftProfession  = "cooking";
                this._craftRecipeId    = null;
                this._craftRisk        = "standard";
                this._craftResult      = null;
                this._craftCommitted   = false;
                this._craftRollPending = false;
                this._craftShowMissing = false;
                this._partyMealOutcomeResolved = false;
                this._preCraftWidth    = this.position?.width ?? DIALOG_WIDTH;
            }
        } else {
            // Switching away from cooking ,  reset to list state
            this._dialogState = "list";
            this._selectedActivityId = null;
        }

        this.render();
    },

    async onSetFireLevel(event, target) {
        if (!game.user.isGM) return;
        if (!this._restApp?.changeFireLevelDuringActivity) return;
        const level = target?.dataset?.fireLevel
            ?? target?.closest?.("[data-fire-level]")?.dataset?.fireLevel;
        if (!level || !["embers", "campfire", "bonfire"].includes(level)) return;
        if (target.disabled) return;
        try {
            const result = await this._restApp.changeFireLevelDuringActivity(level);
            if (result?.ok) {
                void this.render(true);
            } else if (result?.error && !result?.cancelled) {
                console.warn(`${MODULE_ID} | setFireLevel`, result.error);
            }
        } catch (e) {
            console.warn(`${MODULE_ID} | setFireLevel`, e);
        }
    },

    async onRequestFireLevel(event, target) {
        if (game.user.isGM) return;
        const level = target?.dataset?.fireLevel
            ?? target?.closest?.("[data-fire-level]")?.dataset?.fireLevel;
        if (!level || !["embers", "campfire", "bonfire"].includes(level)) return;
        if (target.disabled) return;

        const restApp = this._restApp;
        if (!restApp) return;
        const cur = restApp._fireLevel ?? "unlit";
        if (level === cur) return;

        const F = CampGearScanner.FIREWOOD_COST_BY_LEVEL;
        const costOf = (fireKey) => (fireKey === "unlit" ? 0 : (F[fireKey] ?? 0));
        const curCost = costOf(cur);
        const newCost = costOf(level);
        const levelLabel = level.charAt(0).toUpperCase() + level.slice(1);

        if (newCost > curCost) {
            const allActors = getPartyActors();
            const hasTinderbox = cur !== "unlit" || allActors.some(a => a.items.some(i => isTinderboxItem(i)));
            if (cur === "unlit" && !hasTinderbox) {
                await game.ionrift.library.confirm({
                    title: game.i18n.localize("ionrift-respite.stationActivity.cannotLightFireTitle"),
                    content: game.i18n.localize("ionrift-respite.stationActivity.cannotLightFireContent"),
                    yesLabel: game.i18n.localize("ionrift-respite.stationActivity.close"),
                    noLabel: null,
                    yesIcon: "fas fa-times",
                    defaultYes: true
                });
                return;
            }
            const OWNER = CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
            const myActors = allActors.filter(a => a.isOwner);
            const need = newCost - curCost;
            const myFirewood = myActors.reduce((sum, a) => {
                const it = a.items.find(i => isActorFirewoodItem(i));
                return sum + (it?.system?.quantity ?? 0);
            }, 0);
            if (need > 0 && myFirewood < need) {
                await game.ionrift.library.confirm({
                    title: game.i18n.localize("ionrift-respite.stationActivity.notEnoughFirewoodTitle"),
                    content: game.i18n.format("ionrift-respite.stationActivity.notEnoughFirewoodContent", { levelLabel, need, myFirewood }),
                    yesLabel: game.i18n.localize("ionrift-respite.stationActivity.close"),
                    noLabel: null,
                    yesIcon: "fas fa-times",
                    defaultYes: true
                });
                return;
            }
            const confirmed = await game.ionrift.library.confirm({
                title: game.i18n.format("ionrift-respite.stationActivity.raiseFireTitle", { levelLabel }),
                content: game.i18n.format("ionrift-respite.stationActivity.raiseFireContent", { need }),
                yesLabel: game.i18n.localize("ionrift-respite.stationActivity.lightIt"),
                noLabel: game.i18n.localize("ionrift-respite.stationActivity.cancel"),
                yesIcon: "fas fa-fire",
                noIcon: "fas fa-times",
                defaultYes: true
            });
            if (!confirmed) return;
        } else if (newCost < curCost) {
            const confirmed = await game.ionrift.library.confirm({
                title: game.i18n.format("ionrift-respite.stationActivity.lowerFireTitle", { levelLabel }),
                content: game.i18n.localize("ionrift-respite.stationActivity.lowerFireContent"),
                yesLabel: game.i18n.localize("ionrift-respite.stationActivity.lowerFire"),
                noLabel: game.i18n.localize("ionrift-respite.stationActivity.cancel"),
                yesIcon: "fas fa-arrow-down",
                noIcon: "fas fa-times",
                defaultYes: false
            });
            if (!confirmed) return;
        }

        emitSocketMessage({
            type: "activityFireLevelRequest",
            userId: game.user.id,
            fireLevel: level
        });
        restApp.setStationFirePreviewLevel?.(null);
        ui.notifications.info(game.i18n.localize("ionrift-respite.stationActivity.fireChangeSentToGm"));
    },

    async onSetColdCamp() {
        if (!game.user.isGM) return;
        if (!this._restApp?.setColdCampDuringActivity) return;
        try {
            await this._restApp.setColdCampDuringActivity();
            void this.render(true);
        } catch (e) {
            console.warn(`${MODULE_ID} | setColdCamp`, e);
        }
    },

    onRequestColdCamp() {
        if (game.user.isGM) return;
        emitActivityColdCampRequest(game.user.id);
        this._restApp?.setStationFirePreviewLevel?.(null);
        ui.notifications.info(game.i18n.localize("ionrift-respite.stationActivity.coldCampRequestSentToGm"));
    },

    /**
     * Activity-phase campfire station: select a fire tier to preview its comfort and
     * encounter impact on the header before committing with Set or Request. Re-clicking
     * the previewed tier clears the preview. Local only; never broadcast.
     */
    onPreviewFireLevel(event, target) {
        const level = target?.dataset?.fireLevel
            ?? target?.closest?.("[data-fire-level]")?.dataset?.fireLevel;
        if (!level || !["embers", "campfire", "bonfire"].includes(level)) return;
        if (!this._restApp?.setStationFirePreviewLevel) return;
        const cur = this._restApp._stationFirePreviewLevel ?? null;
        this._restApp.setStationFirePreviewLevel(cur === level ? null : level);
        void this.render(true);
    },

    async onSubmitStationRations() {
        const actorId = this._actor?.id;
        if (!actorId || !this._restApp?.submitActivityMealRationsFromStation) return;
        await this._restApp.submitActivityMealRationsFromStation(actorId);
        await this.render(true);
        await this._closeIfEmptyHubAfterRender();
    },

    async onSubmitWorkbenchIdentify() {
        const actorId = this._actor?.id;
        if (!actorId || !this._restApp?.submitWorkbenchIdentifyFromStation) return;
        await this._restApp.submitWorkbenchIdentifyFromStation(actorId);
        await this.render(true);
    },

    async onWorkbenchIdentifyRemovePotion(event, target) {
        const actorId = this._actor?.id;
        if (!actorId || !this._restApp?.removeWorkbenchIdentifyPotionFromStation) return;
        this._restApp.removeWorkbenchIdentifyPotionFromStation(actorId);
        await this.render(true);
    },

    async onDismissWorkbenchIdentifyAck() {
        const actorId = this._actor?.id;
        if (!actorId || !this._restApp?.dismissWorkbenchIdentifyAcknowledgement) return;
        const ack = this._restApp._workbenchIdentifyAcknowledge?.get(actorId);
        if (!ack || Date.now() < ack.revealAt) return;
        this._restApp.dismissWorkbenchIdentifyAcknowledgement(actorId);
        await this.render(true);
    },

    async onReclaimCampGearFromDialog(event, target) {
        const app = this._restApp;
        if (!app) return;
        const { RestSetupApp } = await import("../rest/RestSetupApp.js");
        await RestSetupApp.reclaimCampGearFromDialog(app, event, target);
        if (app._phase === "activity" && typeof app.refreshCanvasStationOverlaysIfActivity === "function") {
            app.refreshCanvasStationOverlaysIfActivity();
        }
        await this.render(true);
    },

    async onOpenSpellbook() {
        if (!this._actor?.isOwner) return;
        await openActorSpellbook(this._actor);
    },

    async onStationDetectMagicScan(event) {
        if (!this._restApp) return;
        const btn = event?.currentTarget ?? null;
        btn?.classList.add("is-casting");
        spawnDetectMagicCastRipple(btn);
        if (this._restApp._magicScanComplete) {
            this._restApp._clearDetectMagicScanSession();
        } else {
            if (!this._restApp.runDetectMagicScan) return;
            await this._restApp.runDetectMagicScan();
        }
        await this.render(true);
    },

    async onStationIdentifyScannedItem(event, target) {
        const actorId = target?.dataset?.actorId;
        const itemId = target?.dataset?.itemId;
        if (!actorId || !itemId || !this._restApp?.identifyScannedMagicItem) return;
        await this._restApp.identifyScannedMagicItem(actorId, itemId);
        await this.render(true);
    },

    async onServeToParty(event, target) {
        const itemId = target.dataset.itemId;
        const actorId = target.dataset.actorId;
        if (!itemId || !actorId) return;

        const cookActor = game.actors.get(actorId);
        if (!cookActor) return;

        if (!game.user.isGM && !cookActor.isOwner) {
            ui.notifications.warn(game.i18n.localize("ionrift-respite.stationActivity.warnOnlyCookCanServe"));
            return;
        }

        const sourceItem = cookActor.items.get(itemId);
        if (!sourceItem) return;

        const partyActors = getPartyActors().filter(a => a.id !== actorId);
        if (!partyActors.length) {
            ui.notifications.warn(game.i18n.localize("ionrift-respite.stationActivity.warnNoOtherPartyMembers"));
            return;
        }

        const qty = sourceItem.system?.quantity ?? 1;
        const servings = Math.min(qty, partyActors.length);
        const recipients = partyActors.slice(0, servings);

        if (servings < partyActors.length) {
            console.warn(`[Respite:Serve] Only ${servings} serving${servings !== 1 ? "s" : ""} available, not enough for the full party (${partyActors.length} members).`);
            ui.notifications.warn(servings === 1 ? game.i18n.localize("ionrift-respite.stationActivity.warnOnlyOneServing") : game.i18n.format("ionrift-respite.stationActivity.warnOnlyServings", { count: servings }));
        }

        const itemData = sourceItem.toObject();
        itemData.system = { ...itemData.system, quantity: 1 };
        delete itemData._id;

        if (game.user.isGM) {
            const ledger = this._restApp?._grantLedger;
            const itemRef = itemData.flags?.[MODULE_ID]?.itemRef ?? itemData.name ?? "feast_serving";
            for (const recipient of recipients) {
                const slotKey = GrantLedger.mealSlotKey(recipient.id, itemRef);
                const grant = [{
                    name: itemData.name,
                    type: itemData.type ?? "loot",
                    img: itemData.img ?? "icons/svg/item-bag.svg",
                    quantity: 1,
                    system: { ...(itemData.system ?? {}), quantity: 1 },
                    flags: itemData.flags ?? {}
                }];
                guardEmbedItems(grant);
                const perform = () => ItemOutcomeHandler.grantItemsToActor(recipient, grant);
                if (ledger) {
                    await ledger.grantOnce(slotKey, perform);
                } else {
                    await perform();
                }
            }
        } else {
            emitFeastServeRequest({
                cookActorId: actorId,
                itemSnapshot: itemData,
                partyIds: recipients.map(a => a.id),
                feastMode: "partyServe"
            });
        }

        if (qty - servings > 0) {
            await sourceItem.update({ "system.quantity": qty - servings });
        } else {
            await cookActor.deleteEmbeddedDocuments("Item", [itemId]);
        }

        await ChatMessage.create({
            content: `<div class="respite-recovery-chat"><p><i class="fas fa-utensils"></i> ${game.i18n.format("ionrift-respite.stationActivity.servesToPartyChat", { cook: cookActor.name, item: sourceItem.name })}</p></div>`,
            speaker: ChatMessage.getSpeaker({ actor: cookActor })
        });

        notifyStationMealChoicesUpdated();
        await this.render(true);
    },

    async onFeastServeNow() {
        if (this._partyMealOutcomeResolved || this._feastServeInFlight) return;
        const craftResult = this._craftResult;
        if (!craftResult?.output) return;

        const actor = game.actors.get(this._actor?.id);
        if (!actor) return;

        this._feastServeInFlight = true;
        try {
            const { ok } = await CraftingDelegate.serveFeastNow({
                restApp: this._restApp,
                actor,
                craftResult
            });
            if (ok) {
                await this._autoCommitCraftResult();
                this._partyMealOutcomeResolved = true;
                await this.render(true);
            }
        } finally {
            this._feastServeInFlight = false;
        }
    },

    /**
     * Click-to-identify from the Identify tab's party item list.
     * Identifies the item on the owner's actor and whispers the owner.
     */
    async onIdentifyPoolItem(event, target) {
        const itemActorId = target.closest("[data-item-actor-id]")?.dataset.itemActorId;
        const itemId = target.closest("[data-item-id]")?.dataset.itemId;
        if (!itemActorId || !itemId) return;
        const caster = this._actor;
        const ownerActor = game.actors.get(itemActorId);
        if (!ownerActor) {
            ui.notifications.warn(game.i18n.localize("ionrift-respite.stationActivity.warnItemOwnerNotFound"));
            return;
        }
        const itemBefore = ownerActor.items.get(itemId);
        if (!itemBefore) {
            ui.notifications.warn(game.i18n.localize("ionrift-respite.stationActivity.warnItemNotFound"));
            return;
        }
        const wb = this._restApp?._workbench;
        if (!wb) return;
        const did = await wb.identifyItem(itemActorId, itemId, { intent: "identify" });
        if (!did?.identified) return;
        const names = (did.items ?? []).map(r => r.name).filter(Boolean);
        const itemAfter = ownerActor.items.get(itemId);
        const trueName = names.length ? names.join(", ") : (itemAfter?.name ?? itemBefore.name);
        ui.notifications.info(game.i18n.format("ionrift-respite.stationActivity.identifiedNotification", { name: trueName }));
        // Notify the item owner when a different caster identifies their item
        if (caster && itemActorId !== caster.id) {
            const ownerUsers = game.users.filter(
                u => !u.isGM && ownerActor.testUserPermission(u, "OWNER")
            );
            if (ownerUsers.length > 0) {
                ChatMessage.create({
                    content: `<div class="ionrift-identify-reveal"><i class="fas fa-hat-wizard"></i> ${game.i18n.format("ionrift-respite.stationActivity.identifiedYourItemChat", { caster: caster.name, item: trueName })}</div>`,
                    speaker: ChatMessage.getSpeaker({ alias: "Respite" }),
                    whisper: ownerUsers.map(u => u.id)
                });
            }
        }
        if (this.rendered) this.render();
    },

};
