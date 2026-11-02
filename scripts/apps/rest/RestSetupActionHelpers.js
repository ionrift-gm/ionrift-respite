import { Logger } from "../../utils/Logger.js";
import { openEventPoolApp } from "../../services/events/catalog/EventPoolMigration.js";
import { MonstrousFeastBridge } from "../../services/meal/provisions/MonstrousFeastBridge.js";
import { sustenanceActorId } from "../delegates/meal/SustenanceMeterBinding.js";
import {
    clearGatherDraft,
    gatherAlreadyResolved,
    publishCampProgress
} from "../../services/rest/session/campProgressState.js";
import { defaultFoodDaysNeeded } from "../delegates/camp/CampLogisticsDelegate.js";
import { spawnDetectMagicCastRipple } from "../delegates/crafting/DetectMagicDelegate.js";
import { getPartyActors } from "../../services/party/partyActors.js";
import {
    emitCampFirewoodPledge,
    emitCampFirewoodReclaim
} from "../../services/socket/SocketController.js";
import { MODULE_ID } from "../../data/moduleId.js";

export class RestSetupActionHandlers {
static onToggleShelter(event, target) {
        const shelterId = target.dataset.shelterId;
        if (!shelterId) return;
        if (!this._shelterOverrides) this._shelterOverrides = {};

        const wasActive = !!this._shelterOverrides[shelterId];
        for (const key of Object.keys(this._shelterOverrides)) {
            this._shelterOverrides[key] = false;
        }
        this._shelterOverrides[shelterId] = !wasActive;

        this.render();
    }
static onSetupBack(event, target) {
        const step = parseInt(target.dataset.step, 10);
        this._setupStep = step;
        this.render();
    }

    /**
     * Short-term dev toggle to switch between Normal and Gritty Realism rest variants.
     */
    static async onToggleDevRestVariant(event, target) {
        if (!game.user.isGM) return;

        const form = this.element?.querySelector("form");
        if (form) {
            const formData = Object.fromEntries(new FormData(form));
            if (formData.terrain) this._selectedTerrain = formData.terrain;
            if (formData.weather) this._selectedWeather = formData.weather;
            if (formData.restType) this._selectedRestType = formData.restType;
        }

        const current = this._restVariant ?? "normal";
        const next = current === "gritty" ? "normal" : "gritty";
        this._restVariant = next;
        if (this._isGrittyLong) {
            this._campLogistics._foodDaysNeeded = defaultFoodDaysNeeded(true);
        } else {
            this._daysSinceLastRest = 1;
            this._campLogistics._foodDaysNeeded = defaultFoodDaysNeeded(false);
        }

        const adapter = game.ionrift?.respite?.adapter;
        if (adapter) {
            if (typeof adapter.setDevRestVariant === "function") {
                adapter.setDevRestVariant(next);
            } else {
                adapter._devVariantOverride = next;
            }
        }

        if (game.system?.id === "dnd5e" && game.settings.settings.has("dnd5e.restVariant")) {
            try {
                await game.settings.set("dnd5e", "restVariant", next);
            } catch (err) {
                Logger.warn("[Respite] Could not sync dnd5e.restVariant setting:", err);
            }
        }

        const variantMsg = next === "gritty"
            ? game.i18n.localize("ionrift-respite.restSetup.notify.variantGritty")
            : game.i18n.localize("ionrift-respite.restSetup.notify.variantNormal");
        ui.notifications.info(variantMsg);
        this.render();
    }
static onSetupDefaults(event, target) {
        const form = this.element.querySelector("form");
        const formData = form ? Object.fromEntries(new FormData(form)) : {};
        this._selectedTerrain = formData.terrain ?? this._selectedTerrain ?? "forest";
        this._selectedRestType = formData.restType ?? "long";

        const terrainOpt = this.element.querySelector('[name="terrain"] option:checked');
        this._terrainLabel = terrainOpt?.textContent?.trim() ?? this._selectedTerrain;
        this._selectedWeather = "clear";
        this._selectedComfort = "sheltered";
        this._setupStep = 3;
        this.render();
    }

    static onEncounterAdjUp(event, target) {
        if (!game.user.isGM || !this._engine) return;
        this._engine.gmEncounterAdj = (this._engine.gmEncounterAdj ?? 0) + 1;
        this.render({ force: true });
    }

    static onEncounterAdjDown(event, target) {
        if (!game.user.isGM || !this._engine) return;
        this._engine.gmEncounterAdj = (this._engine.gmEncounterAdj ?? 0) - 1;
        this.render({ force: true });
    }

    static onAdjustEncounterDc(event, target) {
        if (!game.user.isGM || !this._engine) return;
        const delta = Number(target.dataset.delta) || 0;
        if (!delta) return;
        this._engine.gmEncounterAdj = (this._engine.gmEncounterAdj ?? 0) + delta;
        this.render({ force: true });
    }
static onAdjustCampDC(event, target) {
        event.preventDefault?.();
        if (!game.user.isGM) return;

        const characterId = target.dataset.characterId;
        const delta = parseInt(target.dataset.delta) || 0;
        if (!characterId || !delta) return;

        const entry = this._pendingCampRolls?.find(p => p.characterId === characterId);
        if (!entry || entry.status !== "pending") return;

        entry.dc = Math.max(1, entry.dc + delta);

        // GM-local only: re-render to show updated DC. Player sees final DC only when GM sends request.
        this.render();
    }
    static onAdjustEventDc(event, target) {
        event.preventDefault?.();
        if (!game.user.isGM) return;

        const eventIndex = parseInt(target.dataset.eventIndex ?? target.closest("[data-event-index]")?.dataset.eventIndex);
        const delta = parseInt(target.dataset.delta) || 0;
        const triggeredEvent = this._triggeredEvents?.[eventIndex];
        if (!triggeredEvent?.mechanical || !delta || triggeredEvent.awaitingRolls || triggeredEvent.resolvedOutcome) return;

        triggeredEvent.mechanical.dc = Math.max(1, (triggeredEvent.mechanical.dc ?? 10) + delta);
        this.render();
    }
static async evaluateLockCount(countSpec, poolSize) {
        if (poolSize === 0) return 0;
        if (countSpec == null) return Math.min(1, poolSize);
        if (typeof countSpec === "number") return Math.max(0, Math.min(Math.floor(countSpec), poolSize));
        const s = String(countSpec).trim();
        if (/^\d+$/.test(s)) return Math.max(0, Math.min(parseInt(s, 10), poolSize));
        try {
            const roll = await new Roll(s).evaluate();
            return Math.max(0, Math.min(Math.floor(roll.total), poolSize));
        } catch (e) {
            return Math.min(1, poolSize);
        }
    }

static pickRandomN(pool, n) {
        if (n <= 0 || pool.length === 0) return [];
        if (n >= pool.length) return [...pool];
        const shuffled = [...pool];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        return shuffled.slice(0, n);
    }
static formatGmGuidance(text) {
        return text.split(/\n\n+/).map((raw, i) => {
            const p = raw.trim();
            // Non-first paragraphs: auto-chip a leading "Label:" or "Label text:" prefix
            if (i > 0) {
                const labelMatch = p.match(/^([A-Z][^:]{2,30}):\s*/);
                if (labelMatch) {
                    const label = labelMatch[1];
                    const rest  = p.slice(labelMatch[0].length);
                    return `<p><strong>${label}</strong>${rest}</p>`;
                }
            }
            return `<p>${p}</p>`;
        }).join("");
    }
    static onCancelGather() {
        const actorId = this._selectedCharacterId;
        if (!actorId) return;
        if (this._gatherResults?.has(actorId)) return;
        const wasFinished = this._finishedActorIds?.has(actorId);
        clearGatherDraft(this, actorId);
        if (wasFinished) this._finishedActorIds.delete(actorId);
        publishCampProgress(this, {
            characterId: actorId,
            gatherChoice: null,
            gatherPending: null,
            ...(wasFinished ? { finishedActorId: actorId, finished: false } : {})
        });
        this.render();
    }
static _buildTrainingProgressBar(training) {
        const rolls = training.rolls ?? [];
        const segments = rolls.map(r => {
            const fill = r.passed ? "#1c6ea4" : "rgba(0,0,0,0.14)";
            const title = game.i18n.format("ionrift-respite.restSetup.training.setTitle", { set: r.set, total: r.total, dc: training.dc });
            return `<span title="${title}" style="flex:1;height:10px;border-radius:3px;background:${fill};"></span>`;
        }).join("");

        const xpLabel = training.awardedXP > 0
            ? game.i18n.format("ionrift-respite.restSetup.training.xpAwarded", { xp: training.awardedXP, successes: training.successes, total: training.numRolls })
            : game.i18n.localize("ionrift-respite.restSetup.training.noXp");
        const reductionNote = training.xpReduction > 0
            ? game.i18n.format("ionrift-respite.restSetup.training.xpReduction", { xp: training.xpReduction })
            : "";

        return `<div style="margin:4px 0;">`
            + `<div style="display:flex;gap:4px;margin-bottom:3px;">${segments}</div>`
            + `<p style="margin:0;">${xpLabel}${reductionNote}</p>`
            + `</div>`;
    }
    static onSelectRosterCharacter(event, target) {
        const chip = target?.closest?.(".roster-chip, .rest-dock-mini") || target;
        if (chip?.classList?.contains("not-owned") || chip?.classList?.contains("is-locked")) return;
        const charId = chip?.dataset?.actorId || chip?.dataset?.rosterId;
        if (!charId || charId === this._selectedCharacterId) return;
        if (!this._isGM) {
            const actor = game.actors.get(charId);
            if (!actor?.isOwner) return;
        }
        this._selectedCharacterId = charId;
        this._activityDetailId = null;
        this._craftingDrawerOpen = false;
        this.render();
    }

    static async onRollExhaustionSave(event, target) {
        event?.preventDefault?.();
        event?.stopPropagation?.();
        const actorId = target?.dataset?.actorId || this._selectedCharacterId;
        const actor = game.actors.get(actorId);
        if (!actor) return;
        if (typeof actor.rollSavingThrow === "function") {
            return actor.rollSavingThrow({ ability: "con" });
        } else if (typeof actor.rollAbilitySave === "function") {
            return actor.rollAbilitySave("con");
        } else if (typeof actor.saves?.fortitude?.roll === "function") {
            return actor.saves.fortitude.roll(event);
        }
    }
    static onOpenMonsterCookbook(event, target) {
        const charId = target?.dataset?.characterId || this._selectedCharacterId;
        const actor = charId ? game.actors.get(charId) : null;
        if (!actor) return;
        const opened = MonstrousFeastBridge.openCooking(actor, {
            onCooked: () => {
                const craftResult = {
                    success: true,
                    narrative: "Cooked from the Monster Cookbook.",
                    recipeId: null,
                    monstrousFeast: true,
                    ingredientsConsumed: true
                };
                this._craftingResults.set(charId, craftResult);
                this.finalizeActivityChoiceFromStation(charId, "act_cook", null, { craftResult });
                this.render();
            }
        });
        if (!opened) {
            ui.notifications.warn(game.i18n.localize("ionrift-respite.restSetup.notify.monsterCookingUnavailable"));
        }
    }
static onActivityDetailBack(event, target) {
        this._activityDetailId = null;
        this.render();
    }
static async onSubmitMealChoices(event, target) {
        const targetActorId = target?.dataset?.actorId
            ?? target?.closest?.("[data-actor-id]")?.dataset?.actorId
            ?? target?.closest?.("[data-character-id]")?.dataset?.characterId;
        if (this._isGM) {
            const charId = targetActorId ?? this._selectedCharacterId;
            if (charId) await this.submitActivityMealRationsFromStation(charId);
            return;
        }
        if (targetActorId && this._myCharacterIds?.has(targetActorId)) {
            await this.submitActivityMealRationsFromStation(targetActorId);
            return;
        }
        const submitted = this._activityMealRationsSubmitted ?? new Set();
        for (const charId of (this._myCharacterIds ?? [])) {
            if (!submitted.has(charId)) {
                await this.submitActivityMealRationsFromStation(charId);
            }
        }
    }
static onHideWindow(event, target) {
        this.close();
    }

static async onExitStationChoiceReview(event, target) {
        event?.preventDefault?.();
        if (!this._postStationChoiceReview) return;
        const charId = this._stationReviewCharacterId;
        this._postStationChoiceReview = false;
        this._stationReviewCharacterId = null;
        if (charId) this._revertStationActivityChoice(charId);
        await this.close({ retainPlayerApp: true, skipRejoin: true });
    }

static async onDetectMagicScan(event, target) {
        const btn = event?.currentTarget ?? null;
        btn?.classList.add("is-casting");
        spawnDetectMagicCastRipple(btn);
        if (this._magicScanComplete) {
            this._clearDetectMagicScanSession();
            this.render();
        } else {
            await this.runDetectMagicScan();
        }
    }

static async onIdentifyScannedItem(event, target) {
        const actorId = target.dataset.actorId;
        const itemId = target.dataset.itemId;
        if (!actorId || !itemId) return;
        await this.identifyScannedMagicItem(actorId, itemId);
    }
static onOpenLedger(event, target) {
        if (!game.user.isGM) return;
        this.openLedgerPanel();
    }

    static onToggleLogisticsDrawer(event, target) {
        if (!this._isGM) return;
        this._campLogistics.toggleDrawer();
    }

    static onAdjustSustenanceDC(event, target) {
        if (!this._isGM) return;
        this._campLogistics.adjustSustenanceDC(target.dataset.activity, target.dataset.delta);
    }

    static onStepFoodDays(event, target) {
        if (!this._isGM) return;
        if (!this._isGrittyLong) {
            const delta = Number(target.dataset.delta) || 0;
            const next = Math.max(1, Math.min(30, this._campLogistics._foodDaysNeeded + delta));
            this._daysSinceLastRest = next;
        }
        this._campLogistics.stepFoodDays(target.dataset.delta);
    }

    static async onGiftWood(event, target) {
        if (!this._isGM) return;
        const qty = Number(target?.dataset?.qty) || 2;
        await this._campLogistics.giftWood(qty);
    }

    static onToggleGearFactor(event, target) {
        if (!this._isGM) return;
        this._campLogistics.toggleGearFactor(target?.dataset?.factor);
    }
static async onCampPledgeFirewood(event, target) {
        const root = target?.closest?.("[data-action=\"campPledgeFirewood\"]") ?? target;
        const actorId = root?.dataset?.actorId;
        if (!actorId) return;
        if (!game.user.isGM) {
            emitCampFirewoodPledge(game.user.id, actorId);
            return;
        }
        if (actorId === "__gm__") {
            await this._campCeremony.addGmFirewoodPledge();
        } else {
            await this._campCeremony.addFirewoodPledge(game.user.id, actorId);
        }
    }

static async onCampReclaimFirewood(event, target) {
        if (!game.user.isGM) {
            emitCampFirewoodReclaim(game.user.id);
            return;
        }
        await this._campCeremony.removeFirewoodPledge(game.user.id);
    }
    static async onDismissCampfireCanvasPanel() {
        this.render({ force: true });
    }
    static async onDismissEventPoolNudge(event, target) {
        const snoozeUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
        await game.settings.set(MODULE_ID, "eventPoolNudgeSnoozedUntil", snoozeUntil);
        await this._saveRestState();
        this.render();
    }

    static onOpenEventPoolCurator(event, target) {
        const terrainTag = this._engine?.terrainTag ?? this._selectedTerrain ?? "forest";
        openEventPoolApp(terrainTag);
    }
    static async onUnlockSustenance(event, target) {
        const actorId = target?.dataset?.actorId
            ?? target?.closest?.("[data-actor-id]")?.dataset?.actorId
            ?? this._selectedCharacterId
            ?? (this._isGM ? null : this._myCharacterIds?.values().next().value);
        if (!actorId) return;
        await this._stations.unlockSustenance(actorId);
    }
static async onSubmitWorkbenchIdentifyTotm(event, target) {
        const actorId = target.dataset.workbenchActorId
            ?? this.element?.querySelector(".station-workbench-identify-embed")?.dataset?.workbenchActorId;
        if (!actorId) return;
        await this._workbench.submitFromStation(actorId);
    }

static onDismissWorkbenchIdentifyAckTotm(event, target) {
        const actorId = target.dataset.workbenchActorId
            ?? this.element?.querySelector(".station-workbench-identify-embed")?.dataset?.workbenchActorId;
        if (!actorId) return;
        this._workbench.dismissAcknowledgement(actorId);
    }

static async onDetectMagicScanTotm(event, target) {
        const btn = event?.currentTarget ?? null;
        btn?.classList.add("is-casting");
        spawnDetectMagicCastRipple(btn);
        if (this._magicScanComplete) {
            this._clearDetectMagicScanSession();
            this.render();
        } else {
            await this._detectMagic.runScan(getPartyActors);
        }
    }
static onTotmCraftSelectRecipe(event, target) {
        if (this._totmCraftRollPending || this._totmCraftHasCrafted) return;
        this._totmCraftRecipeId = target.dataset.recipeId;
        this.render();
    }

static onTotmCraftSelectRisk(event, target) {
        if (this._totmCraftRollPending || this._totmCraftHasCrafted) return;
        this._totmCraftRisk = target.dataset.risk;
        this.render();
    }
    static onTotmCraftToggleMissing(event, target) {
        if (this._totmCraftRollPending) return;
        this._totmCraftShowMissing = !this._totmCraftShowMissing;
        this.render();
    }
static async onPreviewCampFireLevel(event, target) {
        const root = target?.closest?.("[data-action=\"previewCampFireLevel\"]") ?? target;
        const level = root?.dataset?.fireLevel;
        if (!level || !["cold_camp", "embers", "campfire", "bonfire"].includes(level)) return;
        if (this._coldCampDecided) return;
        if (this._campFirePreviewLevel === level) return;
        this._campFirePreviewLevel = level;
        this.render();
    }

static async onContinueToCampLayout(event, target) {
        if (!game.user.isGM) return;
        ui.notifications?.info(game.i18n.localize("ionrift-respite.restSetup.notify.useCampfireOnMap"));
    }
    static onSwitchWorkflow(event, target) {
        const step = target.dataset.step;
        if (!step || !["gather", "activities", "sustenance"].includes(step)) return;
        if (step === "sustenance") {
            let trackFood = false;
            try { trackFood = !!game.settings.get(MODULE_ID, "trackFood"); } catch { /* ignore */ }
            if (!trackFood) return;
        }
        if (step === this._selectedWorkflowStep) return;
        this._holdWindowHeight();
        this._selectedWorkflowStep = step;
        // Leave the activity screen so the chosen tab shows its own view.
        // Training stays open and comes back when Activities is selected again.
        if (this._totmFollowUpExpanded?.activityId !== "act_train") {
            this._totmFollowUpExpanded = null;
        }
        // Stepper is visual sub-navigation only. Never mutate _phase.
        // Phase transitions are owned by RestFlowActions.
        this.render({ force: true });
    }
    static onSkipGather(event, target) {
        const actorId = this._selectedCharacterId ?? game.user.character?.id ?? getPartyActors()[0]?.id;
        if (!actorId) return;
        if (gatherAlreadyResolved(this, actorId)) {
            ui.notifications.info(game.i18n.localize("ionrift-respite.restSetup.notify.alreadyGathered"));
            return;
        }
        if (this._gatherPending?.characterId === actorId && this._gatherPending.phase === "findings") {
            ui.notifications.info(game.i18n.localize("ionrift-respite.restSetup.notify.rollFindingsBeforeSkip"));
            return;
        }
        if (this._gatherSkipIds?.has(actorId)) return;
        this._gatherPending = {
            characterId: actorId,
            activityId: "gather_skip",
            phase: "confirm"
        };
        this.render({ force: true });
    }

    static onConfirmGatherSkip() {
        const actorId = this._selectedCharacterId ?? game.user.character?.id ?? getPartyActors()[0]?.id;
        const pending = this._gatherPending;
        if (!actorId || pending?.characterId !== actorId || pending.activityId !== "gather_skip") return;
        if (!this._gatherSkipIds) this._gatherSkipIds = new Set();
        this._gatherSkipIds.add(actorId);
        this._gatherPending = null;
        this._gatherChoices?.delete(actorId);
        publishCampProgress(this, {
            characterId: actorId,
            gatherSkip: true,
            gatherPending: null
        });
        const current = this._characterChoices?.get(actorId);
        if (current === "act_forage" || current === "act_hunt") {
            this._characterChoices.delete(actorId);
        }
        this.checkAndAutoMarkCharacterReady(actorId);
        this.render({ force: true });
    }

    static onClearSustenanceFood(event, target) {
        const actorId = sustenanceActorId(target, this);
        const slot = Number(target.dataset.slot);
        if (!actorId || Number.isNaN(slot)) return;
        this._meals.clearDiegeticSlot(actorId, "food", slot);
    }

    static onAssignSustenanceFood(event, target) {
        this.applySustenanceChip("food", target.dataset.item, sustenanceActorId(target, this), {
            name: target.dataset.name
        });
    }

    static onClearSustenanceWater(event, target) {
        const actorId = sustenanceActorId(target, this);
        if (!actorId) return;
        this._meals.clearDiegeticWater(actorId, target.dataset.undo === "all" ? "all" : "pour");
    }

    static onAssignSustenanceWater(event, target) {
        this.applySustenanceChip("water", target.dataset.item, sustenanceActorId(target, this), {
            name: target.dataset.name
        });
    }
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
}
