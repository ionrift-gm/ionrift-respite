import { MODULE_ID } from "../../data/moduleId.js";
import { postRollAndSettle, presentRoll } from "/modules/ionrift-library/scripts/services/rolls/DiceSettle.js";
import { fireEncounterDcNudge } from "../delegates/camp/CampLogisticsDelegate.js";
import { getPartyActors } from "../../services/party/partyActors.js";
import { ActivityRegistry } from "../../data/downtime/ActivityRegistry.js";
import {
    formatFletchGrantNotice,
    pickFletchKind,
    rollDowntimeSkillDay
} from "../../services/downtime/DowntimeSkillCheck.js";
import { craftPlanNeedsEscape } from "../../services/downtime/craftPlanEscape.js";
import { combineNightDc } from "../../services/rest/gritty/EncounterDraftService.js";
import { emitRestSessionDelta } from "../../services/rest/session/RestSessionSync.js";
import { CraftingPickerApp } from "../crafting/CraftingPickerApp.js";
import { TerrainRegistry } from "../../services/events/resolve/TerrainRegistry.js";
import { listPoolEventsForTerrain } from "../../services/events/catalog/EventCatalogLoader.js";
import { CampGearScanner } from "../../services/camp/gear/CampGearScanner.js";
import { normalizeGatheringSchedule } from "./DowntimeSustenanceBuilder.js";
import { DowntimePlanningActions } from "./DowntimePlanningAndSustenanceActions.js";

export class DowntimeActivityAndNightActions {
    static async onRollActivityDay(event, target) {
        const actorId = target.dataset.actorId;
        const day = Number(target.dataset.day);
        if (!actorId || !day) return;
        const actor = game.actors.get(actorId);
        if (!actor) return;

        const isOwner = actor.isOwner || this._isGM;
        if (!isOwner) {
            ui.notifications?.warn("You do not have permission to roll activities for this character.");
            return;
        }

        const isCommitted = this._committedActorIds.has(actorId);
        if (!isCommitted && !this._isGM) {
            ui.notifications?.warn("Lock in choices first before rolling activities.");
            return;
        }

        const rolls = this._getOrCreateActivityRolls(actorId);
        let dayRoll = rolls.find(r => r.day === day);
        if (!dayRoll) return;

        if (!dayRoll.activityId && target.dataset.activity) {
            dayRoll.activityId = target.dataset.activity;
        }
        if (!dayRoll.activityId) return;

        if (dayRoll.rolled && !this._isGM) {
            ui.notifications?.info(`Day ${day} (${dayRoll.activityId}) has already been resolved.`);
            return;
        }

        if (["cook", "brew", "craft"].includes(dayRoll.activityId)) {
            // Craft day clicked on timeline
            if (event.shiftKey) {
                const surMod = Number(actor.system?.skills?.sur?.total ?? actor.system?.skills?.sur?.mod ?? 0);
                const wisMod = Number(actor.system?.abilities?.wis?.mod ?? 0);
                const bestMod = Math.max(surMod, wisMod);
                const dc = 12;
                const formula = bestMod >= 0 ? `1d20 + ${bestMod}` : `1d20 - ${Math.abs(bestMod)}`;
                let rollTotal = 10 + bestMod;
                try {
                    const r = new Roll(formula);
                    await r.evaluate();
                    rollTotal = r.total;
                    await presentRoll(r);
                } catch {
                    rollTotal = 10 + bestMod;
                }
                dayRoll.rolled = true;
                dayRoll.rollTotal = rollTotal;
                dayRoll.dc = dc;
                dayRoll.success = rollTotal >= dc;
                dayRoll.skillUsed = "sur";

                this._activityRolls.set(actorId, rolls);
                if (this._isGM) {
                    this._syncDraftDCs();
                    this._broadcastSync();
                    this.render();
                    this._saveSessionState();
                } else {
                    emitRestSessionDelta("downtime", "ROLL_ACTIVITY_DAY", {
                        actorId,
                        day,
                        rollData: { ...dayRoll }
                    });
                    this.render();
                }
                return;
            }

            const profId = (dayRoll.activityId === "cook") ? "cooking"
                         : (dayRoll.activityId === "brew") ? "brewing"
                         : "crafting";
            const engine = this._getCraftingEngine();
            const picker = new CraftingPickerApp(
                actor,
                profId,
                engine,
                async (result) => {
                    if (!result) return;
                    dayRoll.rolled = true;
                    dayRoll.rollTotal = result.checkTotal ?? result.rollTotal ?? (result.success ? 15 : 8);
                    dayRoll.dc = result.dc ?? 12;
                    dayRoll.success = !!result.success;
                    dayRoll.skillUsed = profId;

                    if (this._isGM) {
                        this._activityRolls.set(actorId, rolls);
                        this._syncDraftDCs();
                        this._broadcastSync();
                        this.render();
                        this._saveSessionState();
                    } else {
                        emitRestSessionDelta("downtime", "ROLL_ACTIVITY_DAY", {
                            actorId,
                            day,
                            rollData: { ...dayRoll }
                        });
                        this.render();
                    }
                },
                this._terrainTag
            );
            picker.render(true);
            return;
        }

        const actDef = ActivityRegistry.getActivity(dayRoll.activityId);
        const checkDef = actDef?.check;
        if (!checkDef) return;

        if (dayRoll.activityId !== "fortify") {
            const result = await rollDowntimeSkillDay(actor, dayRoll);
            if (this._isGM) {
                this._activityRolls.set(actorId, rolls);
                this._syncDraftDCs();
                this._broadcastSync();
                this.render();
                this._saveSessionState();
            } else {
                emitRestSessionDelta("downtime", "ROLL_ACTIVITY_DAY", {
                    actorId,
                    day,
                    rollData: { ...dayRoll }
                });
                this.render();
            }
            const notice = formatFletchGrantNotice(result.granted ? [result.granted] : []);
            if (notice) ui.notifications?.info?.(notice);
            return;
        }

        const dc = checkDef.dc ?? 12;

        let bestMod = -99;
        let bestSkill = checkDef.skills?.[0] ?? "sur";
        if (Array.isArray(checkDef.skills)) {
            for (const skillKey of checkDef.skills) {
                const mod = Number(actor.system?.skills?.[skillKey]?.total ?? actor.system?.skills?.[skillKey]?.mod ?? 0);
                if (mod > bestMod) {
                    bestMod = mod;
                    bestSkill = skillKey;
                }
            }
        } else {
            bestMod = Number(actor.system?.skills?.sur?.total ?? actor.system?.skills?.sur?.mod ?? 0);
        }
        if (bestMod === -99) bestMod = 0;

        const formula = bestMod >= 0 ? `1d20 + ${bestMod}` : `1d20 - ${Math.abs(bestMod)}`;
        let rollTotal = 10 + bestMod;
        try {
            const r = new Roll(formula);
            await r.evaluate();
            rollTotal = r.total;
            await presentRoll(r);
        } catch {
            rollTotal = 10 + bestMod;
        }

        const isSuccess = rollTotal >= dc;
        dayRoll.rolled = true;
        dayRoll.rollTotal = rollTotal;
        dayRoll.dc = dc;
        dayRoll.success = isSuccess;
        dayRoll.skillUsed = bestSkill;

        if (this._isGM) {
            this._activityRolls.set(actorId, rolls);
            this._syncDraftDCs();
            this._broadcastSync();
            this.render();
            this._saveSessionState();
        } else {
            emitRestSessionDelta("downtime", "ROLL_ACTIVITY_DAY", {
                actorId,
                day,
                rollData: { ...dayRoll }
            });
        }
    }

    static async onRollAllActivities(event, target) {
        const actorId = target.dataset.actorId;
        if (!actorId) return;
        const actor = game.actors.get(actorId);
        if (!actor) return;

        const rolls = this._getOrCreateActivityRolls(actorId);
        const rollableDays = rolls.filter(r => {
            if (!r.activityId) return false;
            const actDef = ActivityRegistry.getActivity(r.activityId);
            return !!actDef?.check;
        });

        if (!rollableDays.length) return;

        const kind = target.dataset.rollKind || "all";
        const selected = rollableDays.filter(entry => {
            if (kind === "defense") return entry.activityId === "fortify";
            if (kind === "skill") return entry.activityId !== "fortify";
            return true;
        });
        if (!selected.length) return;

        const allRolled = selected.every(entry => entry.rolled);
        if (allRolled && !this._isGM) {
            ui.notifications?.warn("Only the GM can reroll these checks.");
            return;
        }

        const targetDays = allRolled ? selected : selected.filter(entry => !entry.rolled);
        if (targetDays.length === 0) return;

        const skillDays = targetDays.filter(entry => entry.activityId !== "fortify");
        const defenseDays = targetDays.filter(entry => entry.activityId === "fortify");
        const grants = [];
        if (skillDays.length) {
            const fletchKind = pickFletchKind(actor);
            for (const dayRoll of skillDays) {
                const result = await rollDowntimeSkillDay(actor, dayRoll, { fletchKind });
                if (result.granted) grants.push(result.granted);
            }
        }

        if (defenseDays.length) await Promise.all(defenseDays.map(async (dayRoll) => {
            const actDef = ActivityRegistry.getActivity(dayRoll.activityId);
            const checkDef = actDef?.check;
            const dc = checkDef?.dc ?? 12;

            let bestMod = -99;
            let bestSkill = checkDef?.skills?.[0] ?? "sur";
            if (Array.isArray(checkDef?.skills)) {
                for (const skillKey of checkDef.skills) {
                    const mod = Number(actor.system?.skills?.[skillKey]?.total ?? actor.system?.skills?.[skillKey]?.mod ?? 0);
                    if (mod > bestMod) {
                        bestMod = mod;
                        bestSkill = skillKey;
                    }
                }
            } else {
                bestMod = Number(actor.system?.skills?.sur?.total ?? actor.system?.skills?.sur?.mod ?? 0);
            }
            if (bestMod === -99) bestMod = 0;

            const formula = bestMod >= 0 ? `1d20 + ${bestMod}` : `1d20 - ${Math.abs(bestMod)}`;
            let rollTotal = 10 + bestMod;
            try {
                const r = new Roll(formula);
                await r.evaluate();
                rollTotal = r.total;
                await presentRoll(r);
            } catch {
                rollTotal = 10 + bestMod;
            }

            dayRoll.rolled = true;
            dayRoll.rollTotal = rollTotal;
            dayRoll.dc = dc;
            dayRoll.success = rollTotal >= dc;
            dayRoll.skillUsed = bestSkill;
        }));

        this._activityRolls.set(actorId, rolls);
        if (this._isGM) {
            this._syncDraftDCs();
            this._broadcastSync();
            this.render();
            this._saveSessionState();
        } else {
            emitRestSessionDelta("downtime", "ROLL_ALL_ACTIVITIES", { actorId, rolls });
            this.render();
        }
        const notice = formatFletchGrantNotice(grants);
        if (notice) ui.notifications?.info?.(notice);
    }

    static async onCommitActivities(event, target) {
        const actorId = target.dataset.actorId;
        if (!actorId) return;

        if (this._isGM) {
            this._committedActorIds.add(actorId);
            this._broadcastSync();
            this.render();
            this._saveSessionState();
        } else {
            this._committedActorIds.add(actorId);
            emitRestSessionDelta("downtime", "COMMIT_ACTIVITIES", { actorId, committed: true });
            this.render();
        }
    }

    static async onUnlockActivities(event, target) {
        const actorId = target.dataset.actorId;
        if (!actorId) return;
        const actor = game.actors.get(actorId);
        const rolls = this._getOrCreateActivityRolls(actorId);
        const ownerEscape = !this._isGM
            && !!actor?.isOwner
            && this._committedActorIds.has(actorId)
            && craftPlanNeedsEscape(rolls, this._craftAvailableCounts(actor, rolls));
        if (!this._isGM && !ownerEscape) {
            ui.notifications.warn(game.i18n.localize("ionrift-respite.downtimeLedger.warnOnlyGmRevoke"));
            return;
        }

        this._committedActorIds.delete(actorId);
        if (this._isGM) {
            this._broadcastSync();
            this.render();
            this._saveSessionState();
            return;
        }

        emitRestSessionDelta("downtime", "COMMIT_ACTIVITIES", { actorId, committed: false });
        this.render();
        ui.notifications?.info("Plan unlocked. Assign those days to another activity.");
    }

    static async onOpenCraftQueue(event, target) {
        const actorId = target.dataset.actorId;
        if (!actorId) return;
        const actor = game.actors.get(actorId);
        if (!actor) return;

        const isOwner = actor.isOwner || this._isGM;
        if (!isOwner) {
            ui.notifications.warn(game.i18n.localize("ionrift-respite.downtimeLedger.warnNoPermissionResolveCrafts"));
            return;
        }

        const rolls = this._getOrCreateActivityRolls(actorId);
        const unresolvedCrafts = rolls.filter(r => ["cook", "brew", "craft"].includes(r.activityId) && !r.rolled);

        if (!unresolvedCrafts.length) {
            ui.notifications.info(game.i18n.format("ionrift-respite.downtimeLedger.infoAlreadyResolvedCrafts", { name: actor.name }));
            return;
        }

        // Shift+Click: Fast quick-roll for all remaining craft days (Survival/Wisdom vs DC 12)
        if (event.shiftKey) {
            const surMod = Number(actor.system?.skills?.sur?.total ?? actor.system?.skills?.sur?.mod ?? 0);
            const wisMod = Number(actor.system?.abilities?.wis?.mod ?? 0);
            const bestMod = Math.max(surMod, wisMod);
            const dc = 12;

            await Promise.all(unresolvedCrafts.map(async (craftRoll) => {
                const formula = bestMod >= 0 ? `1d20 + ${bestMod}` : `1d20 - ${Math.abs(bestMod)}`;
                let rollTotal = 10 + bestMod;
                try {
                    const r = new Roll(formula);
                    await r.evaluate();
                    rollTotal = r.total;
                    await presentRoll(r);
                } catch {
                    rollTotal = 10 + bestMod;
                }

                craftRoll.rolled = true;
                craftRoll.rollTotal = rollTotal;
                craftRoll.dc = dc;
                craftRoll.success = rollTotal >= dc;
                craftRoll.skillUsed = "sur";
            }));

            this._activityRolls.set(actorId, rolls);
            if (this._isGM) {
                this._syncDraftDCs();
                this._broadcastSync();
                this.render();
                this._saveSessionState();
            } else {
                emitRestSessionDelta("downtime", "ROLL_ALL_ACTIVITIES", {
                    actorId,
                    rolls: [...rolls]
                });
                this.render();
            }

            ui.notifications.info(game.i18n.format("ionrift-respite.downtimeLedger.infoQuickRolledCrafts", { name: actor.name, count: unresolvedCrafts.length, dc }));
            return;
        }

        // Standard Click: Open CraftingPickerApp for the first unresolved craft day
        const nextCraft = unresolvedCrafts[0];
        const profId = (nextCraft.activityId === "cook") ? "cooking"
                     : (nextCraft.activityId === "brew") ? "brewing"
                     : "crafting";

        const engine = this._getCraftingEngine();
        const picker = new CraftingPickerApp(
            actor,
            profId,
            engine,
            async (result) => {
                if (!result) return;
                nextCraft.rolled = true;
                nextCraft.rollTotal = result.checkTotal ?? result.rollTotal ?? (result.success ? 15 : 8);
                nextCraft.dc = result.dc ?? 12;
                nextCraft.success = !!result.success;
                nextCraft.skillUsed = profId;

                this._activityRolls.set(actorId, rolls);
                if (this._isGM) {
                    this._syncDraftDCs();
                    this._broadcastSync();
                    this.render();
                    this._saveSessionState();
                } else {
                    emitRestSessionDelta("downtime", "ROLL_ACTIVITY_DAY", {
                        actorId,
                        day: nextCraft.day,
                        rollData: { ...nextCraft }
                    });
                    this.render();
                }

                const remaining = unresolvedCrafts.length - 1;
                if (remaining > 0) {
                    ui.notifications.info(game.i18n.format("ionrift-respite.downtimeLedger.infoCraftDayResolved", { name: actor.name, day: nextCraft.day, activity: nextCraft.activityId, remaining }));
                } else {
                    ui.notifications.info(game.i18n.format("ionrift-respite.downtimeLedger.infoAllCraftsResolved", { name: actor.name }));
                }
            },
            this._terrainTag
        );
        picker.render(true);
    }

    static onSelectSustenanceRoleLegacy(event, target) {
        const actorId = target.dataset.actorId;
        const role = target.value || target.dataset.role || "forage";
        if (!actorId) return;
        const schedule = normalizeGatheringSchedule(null, role === "hunt" ? "hunt" : "forage");
        this._gatheringSchedule.set(actorId, schedule);
        if (this._isGM) {
            this._broadcastSync();
            this.render();
            this._saveSessionState();
        } else {
            emitRestSessionDelta("downtime", "ROLL_ALL_GATHERING", { actorId, schedule });
        }
    }

    static async onRollSustenanceLegacy(event, target) {
        return DowntimePlanningActions.onRollAllGathering.call(this, event, target);
    }

    static async onSelectFireLevel(event, target) {
        const level = target?.value || target?.dataset?.fireLevel;
        if (!level) return;
        if (target.disabled || target.classList?.contains("disabled")) return;

        const partyActors = getPartyActors();
        const fuelStockTotal = partyActors.reduce((sum, a) => sum + CampGearScanner.countActorFirewood(a), 0);
        const hasTinderbox = partyActors.some(a => CampGearScanner.actorHasTinderbox(a));
        const requiredFuel = CampGearScanner.FIREWOOD_COST_BY_LEVEL[level] ?? 0;

        if (level !== "cold_camp" && !hasTinderbox) {
            ui.notifications?.warn("Cannot light fire: No tinderbox or flint and steel in the party.");
            this.render();
            return;
        }
        if (fuelStockTotal < requiredFuel) {
            ui.notifications?.warn(`Not enough fuel: ${requiredFuel} firewood required for ${level.replace('_', ' ')}.`);
            this.render();
            return;
        }

        this._fireLevel = level;
        this._syncDraftDCs();

        if (this._isGM) {
            this._saveSessionState();
            this._broadcastSync();
            this.render();
        } else {
            emitRestSessionDelta("downtime", "SET_FIRE_LEVEL", { fireLevel: level });
            this.render();
        }
    }

    static onProceedToResolutionFlow(event, target) {
        if (!this._isGM) return;
        const unready = this._unreadyParty();
        if (unready.length > 0) {
            ui.notifications?.warn(`Still drafting: ${unready.join(", ")}.`);
            return;
        }
        this._pacingActive = true;
        this._activePacingNight = 1;
        this._saveSessionState();
        this._broadcastSync();
        this.setPosition({ height: "auto" });
        this.render();
    }

    static onReturnToPlanning(event, target) {
        if (!this._isGM) return;
        const hasAnyRolls = Boolean(this._encounterDraft?.some(e => e.isRolled));
        if (hasAnyRolls) {
            ui.notifications?.warn("Cannot return to camp planning once night checks have been rolled.");
            return;
        }
        this._pacingActive = false;
        this._saveSessionState();
        this._broadcastSync();
        this.setPosition({ height: 820 });
        this.render();
    }

    static async onRollNightCheck(event, target) {
        if (!this._isGM) return;
        const nightIndex = Number(target?.dataset?.night) || this._activePacingNight || 1;
        const entry = this._encounterDraft.find(e => e.nightIndex === nightIndex);
        if (!entry) return;

        const mods = this._getNightActivityModifiers(nightIndex);
        const fireNudge = fireEncounterDcNudge(this._fireLevel);
        const manualOffset = entry.manualOffset ?? 0;
        const targetDC = combineNightDc(this._dangerDC, mods.activityNudge, fireNudge, manualOffset);

        const roll = await new Roll("1d20").evaluate();

        const rollTotal = roll.total;
        const triggered = rollTotal < targetDC;
        let state = "green";
        let category = "ambient";
        let isDisaster = false;
        let eventObj = null;

        const party = getPartyActors();
        const sentryActor = mods.sentryActor ?? party[0] ?? null;
        const pp = sentryActor?.system?.skills?.prc?.passive ?? sentryActor?.system?.attributes?.passive?.perception ?? 10;
        const sentrySurprised = mods.hasActiveGuard ? false : pp < 12;

        if (triggered) {
            const resolver = await this._getEventResolver();
            if (rollTotal === 1) {
                isDisaster = true;
                state = "red";
                category = "disaster";
                const disaster = resolver._pickFromPool
                    ? resolver._pickFromPool(this._terrainTag, { tier: "disaster" })
                    : null;
                if (disaster) {
                    eventObj = {
                        title: disaster.name,
                        description: disaster.description,
                        category: "disaster",
                        isDisaster: true,
                        terrainTag: this._terrainTag,
                        mechanical: disaster.mechanical,
                        id: disaster.id,
                        sentryName: sentryActor?.name ?? "Camp Watch",
                        sentrySurprised
                    };
                } else {
                    eventObj = {
                        title: game.i18n.localize("ionrift-respite.downtimeLedger.wildernessDisaster"),
                        description: game.i18n.format("ionrift-respite.downtimeLedger.criticalDisasterStrikes", { terrain: this._terrainTag }),
                        category: "disaster",
                        isDisaster: true,
                        terrainTag: this._terrainTag,
                        sentryName: sentryActor?.name ?? "Camp Watch",
                        sentrySurprised
                    };
                }
                await postRollAndSettle(roll, {
                    speaker: { alias: "Night Watch" },
                    flavor: `<strong>${game.i18n.localize("ionrift-respite.downtimeLedger.nightCheck")}</strong> (${this._terrainTag}) threshold ${targetDC}<br><em style="color:#e74c3c;">Natural 1: Disaster strikes the camp! (${eventObj.title})</em>`,
                    whisper: game.users.filter(u => u.isGM).map(u => u.id)
                });
            } else {
                const poolEvents = listPoolEventsForTerrain(resolver, this._terrainTag);
                const catalogEvent = poolEvents.length > 0
                    ? (resolver._pickFromPool ? resolver._pickFromPool(this._terrainTag, { tier: "normal", hasWatch: Boolean(mods.sentryActor) }) : null) ?? poolEvents[Math.floor(Math.random() * poolEvents.length)]
                    : null;

                if (catalogEvent) {
                    const isCombat = catalogEvent.category === "encounter" || catalogEvent.category === "combat";
                    state = isCombat ? "red" : "amber";
                    category = catalogEvent.category ?? "discovery";
                    eventObj = {
                        title: catalogEvent.name,
                        description: catalogEvent.description,
                        category: catalogEvent.category,
                        isDisaster: false,
                        terrainTag: this._terrainTag,
                        mechanical: catalogEvent.mechanical,
                        id: catalogEvent.id,
                        sentryName: sentryActor?.name ?? "Camp Watch",
                        sentrySurprised
                    };
                    await postRollAndSettle(roll, {
                        speaker: { alias: "Night Watch" },
                        flavor: `<strong>${game.i18n.localize("ionrift-respite.downtimeLedger.nightCheck")}</strong> (${this._terrainTag}) threshold ${targetDC}<br><em>${catalogEvent.name}</em> triggered (roll ${rollTotal} below threshold).`,
                        whisper: game.users.filter(u => u.isGM).map(u => u.id)
                    });
                } else {
                    state = "amber";
                    category = "encounter";
                    eventObj = {
                        title: game.i18n.localize("ionrift-respite.downtimeLedger.improvisedEncounter"),
                        description: game.i18n.format("ionrift-respite.downtimeLedger.improvisedEncounterNoEvents", { targetDC, rollTotal, terrain: this._terrainTag }),
                        category: "encounter",
                        isDisaster: false,
                        terrainTag: this._terrainTag,
                        sentryName: sentryActor?.name ?? "Camp Watch",
                        sentrySurprised,
                        adHoc: true
                    };
                    await postRollAndSettle(roll, {
                        speaker: { alias: "Night Watch" },
                        flavor: `<strong>${game.i18n.localize("ionrift-respite.downtimeLedger.nightCheck")}</strong> (${this._terrainTag}) threshold ${targetDC}<br><em>Roll ${rollTotal} below threshold. Run your own scenario at the table.</em>`,
                        whisper: game.users.filter(u => u.isGM).map(u => u.id)
                    });
                }
            }
        } else {
            await postRollAndSettle(roll, {
                speaker: { alias: "Night Watch" },
                flavor: `<strong>${game.i18n.localize("ionrift-respite.downtimeLedger.nightCheck")}</strong> (${this._terrainTag}) threshold ${targetDC}<br>${rollTotal} meets or beats the threshold. The night passes without incident.`,
                whisper: game.users.filter(u => u.isGM).map(u => u.id)
            });
        }

        entry.state = state;
        entry.category = category;
        entry.isDisaster = isDisaster;
        entry.triggered = triggered;
        entry.forcedSafe = !triggered;
        entry.rollTotal = rollTotal;
        entry.effectiveDC = targetDC;
        entry.event = eventObj;
        entry.isRolled = true;
        entry.sentryName = sentryActor?.name ?? "Camp Watch";
        entry.sentrySurprised = sentrySurprised;

        this._saveSessionState();
        this._broadcastSync();
        this.render();
    }

    static async onImproviseNightCheck(event, target) {
        if (!this._isGM) return;
        const nightIndex = Number(target?.dataset?.night) || this._activePacingNight || 1;
        const entry = this._encounterDraft.find(e => e.nightIndex === nightIndex);
        if (!entry) return;

        const mods = this._getNightActivityModifiers(nightIndex);
        const fireNudge = fireEncounterDcNudge(this._fireLevel);
        const manualOffset = entry.manualOffset ?? 0;
        const targetDC = combineNightDc(this._dangerDC, mods.activityNudge, fireNudge, manualOffset);

        const roll = await new Roll("1d20").evaluate();

        const rollTotal = roll.total;
        const triggered = rollTotal < targetDC;
        const party = getPartyActors();
        const sentryActor = mods.sentryActor ?? party[0] ?? null;

        const terrainLabel = TerrainRegistry.get(this._terrainTag)?.label ?? this._terrainTag;

        if (triggered) {
            await postRollAndSettle(roll, {
                speaker: { alias: "Night Watch" },
                flavor: game.i18n.format("ionrift-respite.nightWatch.improvise.triggered", {
                    terrain: terrainLabel,
                    dc: targetDC,
                    roll: rollTotal
                }),
                whisper: game.users.filter(u => u.isGM).map(u => u.id)
            });
            entry.state = "amber";
            entry.category = "encounter";
            entry.isDisaster = false;
            entry.triggered = true;
            entry.forcedSafe = false;
            entry.event = {
                title: game.i18n.localize("ionrift-respite.downtimeLedger.improvisedEncounter"),
                description: game.i18n.format("ionrift-respite.downtimeLedger.improvisedThresholdNotMet", { targetDC, rollTotal }),
                category: "encounter",
                isDisaster: false,
                terrainTag: this._terrainTag,
                sentryName: sentryActor?.name ?? "Camp Watch",
                sentrySurprised: false,
                adHoc: true
            };
        } else {
            await postRollAndSettle(roll, {
                speaker: { alias: "Night Watch" },
                flavor: game.i18n.format("ionrift-respite.nightWatch.improvise.quiet", {
                    terrain: terrainLabel,
                    dc: targetDC,
                    roll: rollTotal
                }),
                whisper: game.users.filter(u => u.isGM).map(u => u.id)
            });
            entry.state = "green";
            entry.category = "ambient";
            entry.isDisaster = false;
            entry.triggered = false;
            entry.forcedSafe = true;
            entry.event = null;
        }

        entry.rollTotal = rollTotal;
        entry.effectiveDC = targetDC;
        entry.isRolled = true;
        entry.sentryName = sentryActor?.name ?? "Camp Watch";
        entry.sentrySurprised = false;

        this._saveSessionState();
        this._broadcastSync();
        this.render();
    }

    static onImproviseNightOverride(event, target) {
        if (!this._isGM) return;
        const nightIndex = Number(target?.dataset?.night) || this._activePacingNight || 1;
        const entry = this._encounterDraft.find(e => e.nightIndex === nightIndex);
        if (!entry) return;

        entry.isRolled = true;
        entry.triggered = true;
        entry.forcedSafe = false;
        entry.state = "amber";
        entry.isDisaster = false;
        entry.category = "encounter";
        entry.event = {
            title: game.i18n.localize("ionrift-respite.downtimeLedger.improvisedEncounter"),
            description: game.i18n.localize("ionrift-respite.downtimeLedger.tableSideScenario"),
            category: "encounter",
            isDisaster: false,
            terrainTag: this._terrainTag,
            sentryName: entry.sentryName ?? "Camp Watch",
            sentrySurprised: false,
            adHoc: true
        };

        this._saveSessionState();
        this._broadcastSync();
        this.render();
    }
}
