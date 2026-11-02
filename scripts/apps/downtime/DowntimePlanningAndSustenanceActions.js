import { MODULE_ID } from "../../data/moduleId.js";
import { presentRoll } from "/modules/ionrift-library/scripts/services/rolls/DiceSettle.js";
import { fireEncounterDcNudge } from "../delegates/camp/CampLogisticsDelegate.js";
import { getPartyActors } from "../../services/party/partyActors.js";
import { EncounterDraftService, combineNightDc } from "../../services/rest/gritty/EncounterDraftService.js";
import {
    emitRestSessionDelta,
    emitRestSessionAbandoned
} from "../../services/rest/session/RestSessionSync.js";
import { GatherYieldService } from "../../services/rest/forage/GatherYieldService.js";
import { confirmAbandonRest } from "../rest/confirmAbandonRest.js";
import {
    addPints,
    ensureSustenancePlan,
    pourCount,
    removeLastPour
} from "../../services/meal/phase/SustenanceEditPlan.js";
import { sustenanceActorId } from "../delegates/meal/SustenanceMeterBinding.js";

class DowntimePlanningMixin {
    _holdWindowHeight() {
        const height = this.element?.offsetHeight;
        if (height > 0) this.position.height = height;
    }

    applySustenanceChip(kind, itemId, actorId, target = {}) {
        const id = actorId || this._selectedCharacterId;
        if (!id || !itemId || this._mealsAreLocked(id)) return;
        const actor = game.actors.get(id);
        const item = actor?.items?.get?.(itemId);
        const name = target.name || item?.name || "";
        const img = target.img || item?.img || "";
        if (kind === "water") this._pourSustenanceChip(id, itemId, name, target.waterDay, img, target.available);
        else this._placeSustenanceChip(id, itemId, name, target.foodSlot, img);
    }

    _placeSustenanceChip(actorId, itemId, name, slotIndex, img) {
        const snap = this._sustenanceSnapshot.get(actorId);
        if (!snap?.food?.length) return;
        const preferred = Number.isInteger(slotIndex) ? slotIndex : -1;
        const preferredOpen = preferred >= 0 && snap.food[preferred]?.editable && snap.food[preferred]?.empty;
        const hole = preferredOpen
            ? preferred
            : snap.food.findIndex(day => day.editable && day.empty);
        if (hole < 0) return;
        const plan = ensureSustenancePlan(this._sustenanceEdits, actorId);
        plan.food[hole] = { itemId, name: name || "Ration", img: img || "" };
        this._commitSustenanceEdit(actorId);
    }

    _pourSustenanceChip(actorId, itemId, name, dayIndex, img, available) {
        const snap = this._sustenanceSnapshot.get(actorId);
        if (!snap?.water?.length) return;
        const open = (index) => {
            const day = snap.water[index];
            if (!day?.editable) return false;
            const need = day.need || 0;
            return need > 0 && pourCount(day.pours) < need;
        };
        const preferred = Number.isInteger(dayIndex) && !Number.isNaN(dayIndex) ? dayIndex : -1;
        const hole = preferred >= 0 && open(preferred)
            ? preferred
            : snap.water.findIndex((_, index) => open(index));
        if (hole < 0) return;
        const day = snap.water[hole];
        const room = (day.need || 0) - pourCount(day.pours);
        const already = (day.pours ?? [])
            .filter(pour => pour.itemId === itemId)
            .reduce((sum, pour) => sum + (pour.pints || 0), 0);
        const stock = Number(available);
        const left = Number.isFinite(stock) ? Math.max(0, stock - already) : room;
        const take = Math.min(room, left);
        if (take <= 0) return;
        const plan = ensureSustenancePlan(this._sustenanceEdits, actorId);
        plan.water[hole] = addPints(day.pours, itemId, name || "Waterskin", img, take);
        this._commitSustenanceEdit(actorId);
    }

    _mealsAreLocked(actorId) {
        return this._mealsLockedActorIds.has(actorId);
    }

    _canEditMeals(actorId) {
        if (!actorId) return false;
        if (this._isGM) return true;
        const actor = typeof game.actors?.get === "function"
            ? game.actors.get(actorId)
            : (Array.isArray(game.actors) ? game.actors.find(a => a.id === actorId) : null);
        return Boolean(actor?.isOwner);
    }

    _setMealsLocked(actorId, locked) {
        if (!this._canEditMeals(actorId)) return;
        if (locked) {
            this._mealsLockedActorIds.add(actorId);
            const actor = typeof game.actors?.get === "function"
                ? game.actors.get(actorId)
                : (Array.isArray(game.actors) ? game.actors.find(a => a.id === actorId) : null);
            if (actor) {
                const budget = this._budgetDelegate?.getActorViewModel?.(actor);
                if (budget?.isComplete && !this._committedActorIds.has(actorId)) {
                    this._committedActorIds.add(actorId);
                    if (!this._isGM) {
                        emitRestSessionDelta("downtime", "COMMIT_ACTIVITIES", { actorId, committed: true });
                    }
                }
            }
        } else {
            this._mealsLockedActorIds.delete(actorId);
        }
        if (this._isGM) {
            this._saveSessionState();
            this._broadcastSync();
            this.render();
        } else {
            emitRestSessionDelta("downtime", "LOCK_MEALS", { actorId, locked });
            this.render();
        }
    }

    _commitSustenanceEdit(actorId) {
        if (this._isGM) {
            this._saveSessionState();
            this._broadcastSync();
        } else {
            const plan = this._sustenanceEdits.get(actorId) ?? { food: {}, water: {} };
            emitRestSessionDelta("downtime", "SET_SUSTENANCE_PLAN", { actorId, plan });
        }
        this.render();
    }


    _unreadyParty() {
        const unready = [];
        for (const actor of getPartyActors()) {
            const budget = this._budgetDelegate.getActorViewModel(actor);
            if (!budget.isComplete) {
                unready.push(`${actor.name} (${budget.unallocatedDays}d left)`);
                continue;
            }
            if (!this._committedActorIds.has(actor.id)) {
                unready.push(`${actor.name} (activities still a draft)`);
                continue;
            }
            const craftDaysCount = budget.segments.filter(s => s.filled && (s.activityId === "craft" || s.activityId === "cook" || s.activityId === "brew")).length;
            const craftResolvedCount = (this._activityRolls.get(actor.id) ?? []).filter(r => r.activityId === "craft" || r.activityId === "cook" || r.activityId === "brew").length;
            if (craftDaysCount > craftResolvedCount) {
                unready.push(`${actor.name} (${craftDaysCount - craftResolvedCount}d craft pending)`);
                continue;
            }
            const fortifyDaysCount = budget.segments.filter(s => s.filled && s.activityId === "fortify").length;
            const fortifyResolvedCount = (this._activityRolls.get(actor.id) ?? []).filter(r => r.activityId === "fortify").length;
            if (fortifyDaysCount > fortifyResolvedCount) {
                unready.push(`${actor.name} (${fortifyDaysCount - fortifyResolvedCount}d defenses pending)`);
                continue;
            }
            if (this._budgetDelegate.haven === "wilderness") {
                const sched = this._gatheringSchedule.get(actor.id) ?? [];
                // Camp days are a skip. They have no roll, same as the Gather check.
                if (sched.some(d => d.mode !== "skip" && !d.rolled)) {
                    unready.push(`${actor.name} (gathering rolls pending)`);
                    continue;
                }
            }
            if (!this._mealsLockedActorIds.has(actor.id)) {
                unready.push(`${actor.name} (meals still a draft)`);
            }
        }
        return unready;
    }
}

export class DowntimePlanningActions {
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

    static async onAbandonDowntime(event, target) {
        if (!this._isGM) return;

        const confirmed = await confirmAbandonRest({
            title: game.i18n.localize("ionrift-respite.downtimeLedger.abandonRestTitle"),
            message: "This will cancel the rest for all players. Any unsaved progress will be lost."
        });
        if (!confirmed) return;

        emitRestSessionAbandoned("downtime");
        ui.notifications?.info?.("Rest abandoned.");
        this.close({ abandoned: true });
    }

    static onSetHaven(event, target) {
        if (!this._isGM) return;
        const haven = target.dataset.haven;
        this._budgetDelegate.setHaven(haven);
        this._syncDraftDCs();
        this._broadcastSync();
        this.render();
        this._saveSessionState();
    }

    static onSelectRosterCharacter(event, target) {
        const actorId = target.dataset.actorId || target.dataset.rosterId;
        if (!actorId) return;
        if (!this._isGM) {
            const actor = typeof game.actors?.get === "function" ? game.actors.get(actorId) : (Array.isArray(game.actors) ? game.actors.find(a => a?.id === actorId) : null);
            if (actor && !actor.isOwner) return;
        }
        this._selectedCharacterId = actorId;
        this.render();
    }

    static onSwitchTab(event, target) {
        return DowntimePlanningActions.onSelectRosterCharacter.call(this, event, target);
    }
    static onSwitchWorkflow(event, target) {
        const step = target.dataset.step;
        if (!step || !["gather", "activities", "sustenance"].includes(step)) return;
        if (step === this._selectedWorkflowStep) return;
        this._holdWindowHeight();
        this._selectedWorkflowStep = step;
        const actorId = this._selectedCharacterId;
        if (actorId && this._expandedTiers?.has(actorId)) {
            this._expandedTiers.get(actorId).delete("identify");
        }
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
    static onStepFoodDays(event, target) {
        if (!this._isGM) return;
        this._campLogistics.stepFoodDays(target.dataset.delta);
        this._broadcastSync();
        this._saveSessionState();
    }

    static onStepPatronDays(event, target) {
        return DowntimePlanningActions.onStepFoodDays.call(this, event, target);
    }

    static onClearActivity(event, target) {
        const actorId = target.dataset.actorId;
        const activityId = target.dataset.activityId;
        if (!actorId || !activityId) return;

        if (!this._isGM && !this._keepsRolledActivityDays(actorId, activityId, 0)) {
            ui.notifications?.warn("Those days are already rolled.");
            return;
        }

        if (this._isGM) {
            this._budgetDelegate.clearDays(actorId, activityId);
            this._syncDraftDCs();
            this._broadcastSync();
            this.render();
            this._saveSessionState();
        } else {
            emitRestSessionDelta("downtime", "CLEAR_ACTIVITY", { actorId, activityId });
        }
    }

    static onDumpActivity(event, target) {
        const actorId = target.dataset.actorId;
        const activityId = target.dataset.activityId;
        if (!actorId || !activityId) return;

        if (this._isGM) {
            this._budgetDelegate.dumpDays(actorId, activityId);
            this._syncDraftDCs();
            this._broadcastSync();
            this.render();
            this._saveSessionState();
        } else {
            emitRestSessionDelta("downtime", "DUMP_ACTIVITY", { actorId, activityId });
        }
    }

    static onStepActivity(event, target) {
        const actorId = target.dataset.actorId;
        const activityId = target.dataset.activityId;
        const delta = Number(target.dataset.delta) || 0;
        if (!actorId || !activityId || !delta) return;

        if (!this._isGM && delta < 0) {
            const current = this._budgetDelegate.getActivityDays(actorId, activityId);
            if (!this._keepsRolledActivityDays(actorId, activityId, current + delta)) {
                ui.notifications?.warn("Those days are already rolled.");
                return;
            }
        }

        if (this._isGM) {
            this._budgetDelegate.stepDays(actorId, activityId, delta);
            this._syncDraftDCs();
            this._broadcastSync();
            this.render();
            this._saveSessionState();
        } else {
            emitRestSessionDelta("downtime", "STEP_ACTIVITY", { actorId, activityId, delta });
        }
    }

    static onToggleDrillDown(event, target) {
        if (!this._isGM) return;
        const actorId = target.dataset.actorId;
        if (!actorId) return;

        if (this._drilledDownActorIds.has(actorId)) {
            this._drilledDownActorIds.delete(actorId);
        } else {
            this._drilledDownActorIds.add(actorId);
        }
        this.render();
    }

    static onToggleLogisticsDrawer(event, target) {
        if (!this._isGM) return;
        this._campLogistics.toggleDrawer();
    }

    static onAdjustDraftDC(event, target) {
        if (!this._isGM) return;
        const delta = Number(target.dataset.delta) || 0;
        const newDC = Math.max(1, Math.min(30, (this._dangerDC ?? 15) + delta));
        if (newDC === this._dangerDC) return;
        this._dangerDC = newDC;

        this._syncDraftDCs();
        this._broadcastSync();
        this.render();
        this._saveSessionState();
    }

    static onAdjustNightDC(event, target) {
        if (!this._isGM) return;
        const nightIndex = Number(target.dataset.night);
        const delta = Number(target.dataset.delta) || 0;
        const entry = this._encounterDraft.find(e => e.nightIndex === nightIndex);
        if (!entry) return;

        entry.manualOffset = (entry.manualOffset ?? 0) + delta;
        this._syncDraftDCs();
        this.render();
        this._saveSessionState();
    }

    static async onRerollNight(event, target) {
        if (!this._isGM) return;
        const nightIndex = Number(target.dataset.night);
        const entry = this._encounterDraft.find(e => e.nightIndex === nightIndex);
        if (!entry) return;

        const mods = this._getNightActivityModifiers(nightIndex);
        const fireNudge = fireEncounterDcNudge(this._fireLevel);
        const manualOffset = entry.manualOffset ?? 0;
        const targetDC = combineNightDc(this._dangerDC, mods.activityNudge, fireNudge, manualOffset);
        const totalNights = this._totalNights || 7;
        const isTerminalNight = (nightIndex === totalNights);

        const roll = await new Roll("1d20").evaluate();
        await presentRoll(roll);

        const party = getPartyActors();
        const sentryActor = mods.sentryActor ?? party[0] ?? null;
        const pp = sentryActor?.system?.skills?.prc?.passive ?? sentryActor?.system?.attributes?.passive?.perception ?? 10;
        const sentrySurprised = mods.hasActiveGuard ? false : pp < 12;

        const rollTotal = roll.total;
        const triggered = rollTotal < targetDC;
        let state = "green";
        let category = "ambient";
        let isDisaster = false;
        let eventObj = null;

        if (triggered) {
            if (rollTotal === 1) {
                state = isTerminalNight ? "disaster" : "red";
                category = isTerminalNight ? "disaster" : "combat";
                isDisaster = isTerminalNight;
                eventObj = {
                    title: isTerminalNight ? game.i18n.localize("ionrift-respite.downtimeLedger.campDisaster") : game.i18n.localize("ionrift-respite.downtimeLedger.severeAmbush"),
                    description: isTerminalNight
                        ? game.i18n.format("ionrift-respite.downtimeLedger.campWipingDisaster", { terrain: this._terrainTag })
                        : game.i18n.format("ionrift-respite.downtimeLedger.ferociousAssault", { terrain: this._terrainTag }),
                    category: isTerminalNight ? "disaster" : "encounter",
                    isDisaster: isTerminalNight,
                    terrainTag: this._terrainTag,
                    sentryName: sentryActor?.name ?? "Camp Watch",
                    sentrySurprised
                };
            } else if (rollTotal <= 6) {
                state = "red";
                category = "combat";
                eventObj = {
                    title: game.i18n.localize("ionrift-respite.downtimeLedger.hostileAmbush"),
                    description: game.i18n.format("ionrift-respite.downtimeLedger.predatorsHostileAssault", { terrain: this._terrainTag }),
                    category: "encounter",
                    isDisaster: false,
                    terrainTag: this._terrainTag,
                    sentryName: sentryActor?.name ?? "Camp Watch",
                    sentrySurprised
                };
            } else {
                state = "amber";
                category = "discovery";
                eventObj = {
                    title: game.i18n.localize("ionrift-respite.downtimeLedger.nocturnalEncounter"),
                    description: game.i18n.format("ionrift-respite.downtimeLedger.strangeSoundsApproach", { terrain: this._terrainTag }),
                    category: "discovery",
                    isDisaster: false,
                    terrainTag: this._terrainTag,
                    sentryName: sentryActor?.name ?? "Camp Watch",
                    sentrySurprised: false
                };
            }
        }

        entry.state = state;
        entry.category = category;
        entry.isDisaster = isDisaster;
        entry.triggered = triggered;
        entry.forcedSafe = false;
        entry.rollTotal = rollTotal;
        entry.effectiveDC = targetDC;
        entry.activityNudge = mods.activityNudge;
        entry.fortifyCount = mods.fortifyCount;
        entry.guardCount = mods.guardCount;
        entry.fortifyActors = mods.fortifyActors;
        entry.guardActors = mods.guardActors;
        entry.hasActiveGuard = mods.hasActiveGuard;
        entry.event = eventObj;
        entry.sentryName = sentryActor?.name ?? "Camp Watch";
        entry.sentrySurprised = sentrySurprised;
        entry.isRolled = true;

        this.render();
        this._saveSessionState();
    }

    static onDropNight(event, target) {
        if (!this._isGM) return;
        const nightIndex = Number(target.dataset.night);
        const entry = this._encounterDraft.find(e => e.nightIndex === nightIndex);
        if (entry) {
            entry.state = "green";
            entry.category = "ambient";
            entry.isDisaster = false;
            entry.triggered = false;
            entry.forcedSafe = true;
            entry.event = null;
        }
        this.render();
        this._saveSessionState();
    }

    static onCycleNightState(event, target) {
        if (!this._isGM) return;
        const nightIndex = Number(target.dataset.night);
        const entry = this._encounterDraft.find(e => e.nightIndex === nightIndex);
        if (entry) {
            const isTerminalNight = (nightIndex === this._encounterDraft.length);
            EncounterDraftService.cycleNight(entry, isTerminalNight, this._terrainTag);
            this.render();
            this._saveSessionState();
        }
    }

    static onSelectNominatedFood(event, target) {
        const actorId = target.dataset.actorId;
        const itemId = target.value;
        if (!actorId) return;

        if (this._isGM) {
            if (itemId) {
                const actor = game.actors.get(actorId);
                const item = actor?.items.get(itemId);
                const maxQty = item?.system?.quantity ?? 1;
                const defaultQty = Math.min(this._campLogistics._foodDaysNeeded, maxQty);
                this._foodNominations.set(actorId, { itemId, quantity: defaultQty });
            } else {
                this._foodNominations.delete(actorId);
            }
            this._broadcastSync();
            this.render();
            this._saveSessionState();
        } else {
            emitRestSessionDelta("downtime", "SET_FOOD_NOMINATION", {
                actorId,
                itemId: itemId || null,
                quantity: this._campLogistics._foodDaysNeeded
            });
        }
    }

    static onStepNominatedFood(event, target) {
        const actorId = target.dataset.actorId;
        const delta = Number(target.dataset.delta) || 0;
        if (!actorId) return;

        const current = this._foodNominations.get(actorId);
        if (!current?.itemId) return;

        const actor = game.actors.get(actorId);
        const item = actor?.items.get(current.itemId);
        const maxQty = item?.system?.quantity ?? 1;
        const newQty = Math.max(1, Math.min(maxQty, (current.quantity || 1) + delta));

        if (this._isGM) {
            this._foodNominations.set(actorId, { itemId: current.itemId, quantity: newQty });
            this._broadcastSync();
            this.render();
            this._saveSessionState();
        } else {
            emitRestSessionDelta("downtime", "SET_FOOD_NOMINATION", {
                actorId,
                itemId: current.itemId,
                quantity: newQty
            });
        }
    }

    static onClearSustenanceFood(event, target) {
        const actorId = sustenanceActorId(target, this);
        const slot = Number(target.dataset.slot);
        if (!actorId || Number.isNaN(slot) || this._mealsAreLocked(actorId)) return;
        const snap = this._sustenanceSnapshot.get(actorId);
        const day = snap?.food?.[slot];
        if (!day?.editable || day.empty) return;
        const plan = ensureSustenancePlan(this._sustenanceEdits, actorId);
        plan.food[slot] = "";
        this._commitSustenanceEdit(actorId);
    }

    static onAssignSustenanceFood(event, target) {
        this.applySustenanceChip("food", target.dataset.item, sustenanceActorId(target, this), {
            name: target.dataset.name
        });
    }

    static onClearSustenanceWater(event, target) {
        const actorId = sustenanceActorId(target, this);
        const dayIndex = Number(target.dataset.wday);
        if (!actorId || Number.isNaN(dayIndex)) return;
        const snap = this._sustenanceSnapshot.get(actorId);
        const day = snap?.water?.[dayIndex];
        if (!day?.editable || this._mealsAreLocked(actorId)) return;
        const plan = ensureSustenancePlan(this._sustenanceEdits, actorId);
        plan.water[dayIndex] = target.dataset.undo === "all" ? [] : removeLastPour(day.pours);
        this._commitSustenanceEdit(actorId);
    }

    static onAssignSustenanceWater(event, target) {
        this.applySustenanceChip("water", target.dataset.item, sustenanceActorId(target, this), {
            name: target.dataset.name,
            waterDay: Number(target.dataset.wday)
        });
    }
    static onLockMeals(event, target) {
        const actorId = target?.dataset?.actorId || sustenanceActorId(target, this);
        if (!actorId) return;
        this._setMealsLocked(actorId, true);
    }

    static onUnlockMeals(event, target) {
        const actorId = target?.dataset?.actorId || sustenanceActorId(target, this);
        if (!actorId) return;
        this._setMealsLocked(actorId, false);
    }
    static onSelectDepartureMeal(event, target) {
        const actorId = target.dataset.actorId;
        const itemId = target.value;
        if (!actorId) return;

        if (this._isGM) {
            if (itemId) {
                this._departureMeals.set(actorId, itemId);
            } else {
                this._departureMeals.delete(actorId);
            }
            this._broadcastSync();
            this.render();
            this._saveSessionState();
        } else {
            emitRestSessionDelta("downtime", "SET_DEPARTURE_MEAL", {
                actorId,
                itemId: itemId || null
            });
        }
    }

    static onSelectDepartureDrink(event, target) {
        const actorId = target.dataset.actorId;
        const itemId = target.value;
        if (!actorId) return;

        if (this._isGM) {
            if (itemId) {
                this._departureDrinks.set(actorId, itemId);
            } else {
                this._departureDrinks.delete(actorId);
            }
            this._broadcastSync();
            this.render();
            this._saveSessionState();
        } else {
            emitRestSessionDelta("downtime", "SET_DEPARTURE_DRINK", {
                actorId,
                itemId: itemId || null
            });
        }
    }

    /**
     * Unified toggle for revealing/hiding day-by-day breakdowns in any tier.
     * Reads data-tier ('activities' | 'gathering' | 'sustenance') and data-actor-id from the target.
     */
    static onToggleTierReveal(event, target) {
        const actorId = target.dataset.actorId;
        const tier = target.dataset.tier;
        if (!actorId || !tier) return;

        if (!this._expandedTiers.has(actorId)) {
            this._expandedTiers.set(actorId, new Set());
        }
        const expanded = this._expandedTiers.get(actorId);
        if (expanded.has(tier)) {
            expanded.delete(tier);
        } else {
            expanded.add(tier);
        }
        this.render();
    }

    static async onRerollAllDraft(event, target) {
        if (!this._isGM) return;
        await this._initEncounterDraft();
        this.render();
        this._saveSessionState();
    }

    static onAdjustSustenanceDC(event, target) {
        if (!this._isGM) return;
        this._campLogistics.adjustSustenanceDC(target.dataset.activity, target.dataset.delta);
        this._broadcastSync();
        this._saveSessionState();
    }

    static async onGiftWood(event, target) {
        if (!this._isGM) return;
        const qty = Number(target?.dataset?.qty) || 2;
        await this._campLogistics.giftWood(qty);
        this._broadcastSync();
        this._saveSessionState();
    }

    static onToggleGearFactor(event, target) {
        if (!this._isGM) return;
        this._campLogistics.toggleGearFactor(target?.dataset?.factor);
        this._broadcastSync();
        this._saveSessionState();
    }

    static onToggleGatheringDay(event, target) {
        const actorId = target.dataset.actorId;
        const day = Number(target.dataset.day);
        if (!actorId || !day) return;
        if (!this._isGM) {
            const actor = typeof game.actors?.get === "function" ? game.actors.get(actorId) : (Array.isArray(game.actors) ? game.actors.find(a => a?.id === actorId) : null);
            if (actor && !actor.isOwner) return;
        }

        const schedule = this._getOrCreateGatheringSchedule(actorId);
        const dayEntry = schedule.find(d => d.day === day);
        if (!dayEntry) return;

        if (dayEntry.rolled) {
            ui.notifications?.warn("This day's haul is already set.");
            return;
        }
        const hasRolled = schedule.some(d => d.rolled && d.mode !== "skip");
        if (hasRolled && !this._isGM) {
            ui.notifications?.warn("Only the GM can modify gathering assignments after rolls are made.");
            return;
        }

        let newMode;
        if (dayEntry.mode === "forage") newMode = "hunt";
        else if (dayEntry.mode === "hunt") newMode = "skip";
        else newMode = "forage";

        dayEntry.mode = newMode;
        dayEntry.rolled = false;
        dayEntry.rollTotal = null;
        dayEntry.dc = null;
        dayEntry.success = null;
        dayEntry.yield = 0;
        dayEntry.detail = "";
        dayEntry.items = [];
        dayEntry.fromTable = false;

        if (this._isGM) {
            this._gatheringSchedule.set(actorId, schedule);
            this._broadcastSync();
            this.render();
            this._saveSessionState();
        } else {
            emitRestSessionDelta("downtime", "TOGGLE_GATHERING_DAY", { actorId, day, mode: newMode, schedule });
        }
    }

    static onToggleGatheringDetail(event, target) {
        // Legacy compat: delegate to unified tier reveal with tier='gathering'
        target.dataset.tier = "gathering";
        DowntimePlanningActions.onToggleTierReveal.call(this, event, target);
    }

    static async onRollGatheringDay(event, target) {
        // Individual day rolling is superseded by parallel Roll All
        return DowntimePlanningActions.onRollAllGathering.call(this, event, target);
    }

    static async onRollAllGathering(event, target) {
        const actorId = target.dataset.actorId;
        if (!actorId) return;
        if (!this._isGM) {
            const actor = typeof game.actors?.get === "function" ? game.actors.get(actorId) : (Array.isArray(game.actors) ? game.actors.find(a => a?.id === actorId) : null);
            if (actor && !actor.isOwner) {
                ui.notifications?.warn("You do not have permission to roll gathering for this character.");
                return;
            }
        }
        const actor = typeof game.actors?.get === "function" ? game.actors.get(actorId) : (Array.isArray(game.actors) ? game.actors.find(a => a?.id === actorId) : null);
        if (!actor) return;

        const schedule = this._getOrCreateGatheringSchedule(actorId);
        const surMod = Number(actor.system?.skills?.sur?.total ?? actor.system?.skills?.sur?.mod ?? 0);
        const formula = surMod >= 0 ? `1d20 + ${surMod}` : `1d20 - ${Math.abs(surMod)}`;

        const activeDays = schedule.filter(d => d.mode !== "skip");
        if (activeDays.length === 0) {
            ui.notifications?.info("No active gathering days to roll (all days are skipped).");
            return;
        }

        const targetDays = activeDays.filter(d => !d.rolled);
        if (targetDays.length === 0) {
            ui.notifications?.info("Gathering is already rolled. Those finds stay.");
            return;
        }

        // Roll all target days in parallel
        await Promise.all(targetDays.map(async (dayEntry) => {
            const isHunt = dayEntry.mode === "hunt";
            const dc = isHunt ? (this._campLogistics._huntDC ?? 14) : (this._campLogistics._forageDC ?? 12);

            let rollTotal = 10 + surMod;
            try {
                const r = new Roll(formula);
                await r.evaluate();
                rollTotal = r.total;
                await presentRoll(r);
            } catch {
                rollTotal = 10 + surMod;
            }

            const gathered = await GatherYieldService.resolveGatherDay({
                actor,
                mode: isHunt ? "hunt" : "forage",
                terrainTag: this._terrainTag ?? "forest",
                total: rollTotal,
                dc
            });
            const haul = gathered.fromTable
                ? GatherYieldService.describeItems(gathered.items)
                : (gathered.rations > 0 ? `${gathered.rations} rations` : "");
            const detail = [haul, gathered.mishap].filter(Boolean).join(". ");

            dayEntry.rolled = true;
            dayEntry.rollTotal = rollTotal;
            dayEntry.dc = dc;
            dayEntry.success = gathered.success && !gathered.mishap;
            dayEntry.yield = gathered.fromTable
                ? GatherYieldService.countUnits(gathered.items)
                : gathered.rations;
            dayEntry.detail = detail;
            dayEntry.items = gathered.items ?? [];
            dayEntry.fromTable = gathered.fromTable;
        }));

        this._gatheringSchedule.set(actorId, schedule);
        if (this._isGM) {
            this._broadcastSync();
            this.render();
            this._saveSessionState();
        } else {
            emitRestSessionDelta("downtime", "ROLL_ALL_GATHERING", { actorId, schedule });
            this.render();
        }
    }
}

export function applyDowntimePlanningHelpers(TargetClass) {
    for (const key of Object.getOwnPropertyNames(DowntimePlanningMixin.prototype)) {
        if (key === "constructor") continue;
        Object.defineProperty(
            TargetClass.prototype,
            key,
            Object.getOwnPropertyDescriptor(DowntimePlanningMixin.prototype, key)
        );
    }
}
