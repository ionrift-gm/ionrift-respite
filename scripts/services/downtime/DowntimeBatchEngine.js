import { MODULE_ID } from "../../data/moduleId.js";
import { Logger } from "../../utils/Logger.js";
import { ItemClassifier } from "../party/ItemClassifier.js";
import { consumeItem } from "../meal/inventory/MealItemConsumer.js";
import { dispatchWellFedMealServing, stampWellFedDuration } from "../meal/buffs/WellFedService.js";
import { SustenanceEngine } from "../rest/gritty/SustenanceEngine.js";
import {
    boostComfort,
    getHdPenalty,
    isComfortEnabled,
    HP_FRACTION
} from "../camp/gear/ComfortCalculator.js";
import { CampGearScanner, findConsumableFirewoodItem } from "../camp/gear/CampGearScanner.js";
import { TerrainRegistry } from "../events/resolve/TerrainRegistry.js";
import { getActorMealNeeds } from "../meal/phase/MealContextBuilder.js";
import { buildWaterOptions } from "../meal/phase/MealOptionBuilder.js";
import { FRESH_FORAGE_NOTE, GatherYieldService } from "../rest/forage/GatherYieldService.js";

/**
 * 2-Phase Batch Engine for Gritty Realism 7-day Long Rest resolution.
 * Phase 1: Daily Camp Sustenance Routine (Wilderness)
 * Phase 2: Kitchen & Crafts (Cook, Craft, Train, Research, Carouse, Rest)
 * Followed by Supply Commissary deduction and Comfort-Mapped Long Rest Recovery.
 */
export class DowntimeBatchEngine {

    /**
     * Resolves the entire 7-day Downtime rest.
     *
     * @param {object} params
     * @param {Actor[]} params.partyActors
     * @param {ActivityBudgetDelegate} params.budgetDelegate
     * @param {"civilized"|"wilderness"} [params.haven="wilderness"]
     * @param {string} [params.fireLevel="campfire"]
     * @param {number} [params.patronSuppliedDays=0]
     * @param {Array<object>} [params.encounterResults=[]]
     * @param {string} [params.campComfort="rough"]
     * @param {string} [params.terrainTag="forest"]
     * @returns {Promise<object>} Structured result for MasterCardRenderer
     */
    static async resolveDowntime({
        partyActors = [],
        budgetDelegate,
        haven = "wilderness",
        fireLevel = "campfire",
        foodDaysNeeded = null,
        patronSuppliedDays = 0,
        foodNominations = null,
        departureMeals = null,
        sendoffApplied = null,
        encounterResults = [],
        campComfort = "rough",
        terrainTag = "forest",
        gatheringSchedule = null,
        sustenanceRoles = null,
        activityRolls = null,
        forageDC = 12,
        huntDC = 14,
        enforceBedroll = true,
        enforceTent = true,
        enforceMessKit = true,
        exhaustionResults = []
    } = {}) {
        const partySize = partyActors.length;
        const downtimeLarder = { rations: 0, meatLbs: 0, herbs: 0 };
        let freshForageSpoils = false;
        const characterOutcomes = new Map();

        for (const actor of partyActors) {
            characterOutcomes.set(actor.id, {
                actor,
                name: actor.name,
                img: actor.img,
                rolls: [],
                harvestedRations: 0,
                mealsCooked: 0,
                activitiesSummary: [],
                notes: []
            });
        }

        // ─── PHASE 1: DAILY CAMP SUSTENANCE ROUTINE (Wilderness) ─────────────
        if (haven === "wilderness") {
            const outlanderStatus = SustenanceEngine.scanOutlander(partyActors, terrainTag);

            if (outlanderStatus.isEligible && outlanderStatus.outlanderActor) {
                // Outlander / Wanderer trait feeds party (up to 6) without burning vocation days
                const shielded = Math.min(partySize, outlanderStatus.shieldedCount);
                const outlanderRations = shielded * 7;
                downtimeLarder.rations += outlanderRations;

                const outlanderOutcome = characterOutcomes.get(outlanderStatus.outlanderActor.id);
                if (outlanderOutcome) {
                    outlanderOutcome.harvestedRations += outlanderRations;
                    outlanderOutcome.activitiesSummary.push(`Sustenance: Outlander Wanderer secured camp provisions (+${outlanderRations} rations)`);
                }
            }
        }

        // ─── PHASE 1: GATHERING ROUTINE (FORAGING & HUNTING) ─────────────────
        const scheduleSource = gatheringSchedule ?? sustenanceRoles;
        const scheduleMap = scheduleSource instanceof Map
            ? scheduleSource
            : new Map(Object.entries(scheduleSource ?? {}));

        if (haven === "wilderness") {
            for (const actor of partyActors) {
                const outcome = characterOutcomes.get(actor.id);
                const raw = scheduleMap.get(actor.id);
                let days = [];

                if (Array.isArray(raw)) {
                    days = raw;
                } else if (raw && (raw.role === "hunt" || raw.role === "forage")) {
                    days = [{
                        day: 1,
                        mode: raw.role,
                        rolled: raw.rolled,
                        rollTotal: raw.rollTotal,
                        dc: raw.dc,
                        success: raw.success,
                        yield: raw.yield
                    }];
                }

                if (!days.length) continue;

                const startHarvested = outcome.harvestedRations;
                const surMod = Number(actor.system?.skills?.sur?.total ?? actor.system?.skills?.sur?.mod ?? 0);

                for (const dayEntry of days) {
                    if (dayEntry.mode === "skip") {
                        continue;
                    }
                    const isHunt = dayEntry.mode === "hunt";
                    const mode = isHunt ? "hunt" : "forage";
                    // Honour the DC the ledger actually rolled against, so a
                    // mid-session DC change cannot rewrite a resolved day.
                    const dc = (dayEntry.rolled && typeof dayEntry.dc === "number")
                        ? dayEntry.dc
                        : (isHunt ? huntDC : forageDC);
                    let checkTotal = dayEntry.rollTotal;

                    if (!dayEntry.rolled || typeof checkTotal !== "number") {
                        const formula = surMod >= 0 ? `1d20 + ${surMod}` : `1d20 - ${Math.abs(surMod)}`;
                        try {
                            const roll = await new Roll(formula).evaluate();
                            checkTotal = roll.total;
                        } catch {
                            checkTotal = 10 + surMod;
                        }
                    }

                    const alreadyDrawn = dayEntry.rolled && (dayEntry.detail || dayEntry.fromTable);
                    const gathered = alreadyDrawn
                        ? {
                            fromTable: !!dayEntry.fromTable,
                            rations: dayEntry.yield ?? 0,
                            items: dayEntry.items ?? [],
                            success: !!dayEntry.success
                        }
                        : await GatherYieldService.resolveGatherDay({
                            actor,
                            mode,
                            terrainTag,
                            total: checkTotal,
                            dc
                        });

                    let harvested = 0;
                    let detail = "";

                    if (gathered.fromTable) {
                        // Real provisions go into the pack. The commissary pass
                        // below eats from inventory, so crediting the abstract
                        // larder too would count this food twice.
                        if (GatherYieldService.includesPerishable(gathered.items)) {
                            freshForageSpoils = true;
                        }
                        await GatherYieldService.grantGatheredItems(actor, gathered.items);
                        harvested = GatherYieldService.countUnits(gathered.items);
                        detail = alreadyDrawn && dayEntry.detail
                            ? dayEntry.detail
                            : GatherYieldService.describeItems(gathered.items);
                    } else if (gathered.rations > 0) {
                        // No terrain content for this draw. Keep the day worth
                        // something with the ration equivalent.
                        harvested = gathered.rations;
                        detail = alreadyDrawn && dayEntry.detail ? dayEntry.detail : `${harvested} rations`;
                        downtimeLarder.rations += harvested;
                    } else if (alreadyDrawn && dayEntry.detail) {
                        detail = dayEntry.detail;
                    }

                    outcome.harvestedRations += harvested;

                    outcome.rolls.push({
                        activity: isHunt ? "Hunt" : "Forage",
                        day: dayEntry.day ?? 1,
                        checks: [{ total: checkTotal, yield: harvested, detail }]
                    });
                }

                const charHarvested = outcome.harvestedRations - startHarvested;
                const huntDays = days.filter(d => d.mode === "hunt").length;
                const forageDays = days.filter(d => d.mode === "forage").length;
                const skipDays = days.filter(d => d.mode === "skip").length;

                if (days.length === 1) {
                    const actName = days[0].mode === "hunt" ? "Hunt" : (days[0].mode === "skip" ? "Skip" : "Forage");
                    outcome.activitiesSummary.push(`${actName}: +${charHarvested} provisions`);
                } else {
                    const parts = [];
                    if (forageDays > 0) parts.push(`${forageDays} forage`);
                    if (huntDays > 0) parts.push(`${huntDays} hunt`);
                    if (skipDays > 0) parts.push(`${skipDays} skipped`);
                    const breakdown = parts.length ? ` (${parts.join(", ")})` : "";
                    outcome.activitiesSummary.push(`Gathering: +${charHarvested} provisions${breakdown}`);
                }
            }
        }

        // ─── PHASE 2: CULINARY, CRAFTING, DOWNTIME ────────────────────────
        let totalMealsCooked = 0;

        for (const actor of partyActors) {
            const outcome = characterOutcomes.get(actor.id);
            const viewModel = budgetDelegate.getActorViewModel(actor);

            const cookActivity = viewModel.activities.find(a => a.id === "cook");
            const cookDays = cookActivity?.assignedDays ?? 0;

            if (cookDays > 0) {
                // Interleaving: pulls ingredients from inventory or Downtime Larder
                let cookedCount = 0;
                let downgradedCount = 0;

                for (let d = 0; d < cookDays; d++) {
                    if (downtimeLarder.rations > 0) {
                        downtimeLarder.rations--;
                        cookedCount++;
                    } else {
                        // Check if actor has stored raw food/ingredients
                        const candidate = actor.items.find(i => ItemClassifier.isFood(i, actor) && (i.system?.quantity ?? 1) > 0);
                        if (candidate) {
                            await consumeItem(actor, candidate.id, 1);
                            cookedCount++;
                        } else {
                            downgradedCount++;
                        }
                    }
                }

                outcome.mealsCooked = cookedCount;
                totalMealsCooked += cookedCount;

                if (cookedCount > 0) {
                    outcome.activitiesSummary.push(`Cook (${cookedCount}d): ${cookedCount} meals prepared`);
                }
                if (downgradedCount > 0) {
                    outcome.notes.push(`${downgradedCount} cook days downgraded to Camp Maintenance (no ingredients).`);
                }
            }

            // Tend Wounds — targeted per-patient resolution
            const tendActivity = viewModel.activities.find(a => a.id === "tend");
            const tendDays = tendActivity?.assignedDays ?? 0;
            if (tendDays > 0) {
                const tendTargets = budgetDelegate.getTendTargets(actor.id);
                if (tendTargets.length > 0) {
                    for (const { patientId, days } of tendTargets) {
                        const patient = partyActors.find(a => a.id === patientId);
                        if (!patient || days <= 0) continue;

                        let daysSucceeded = 0;
                        const medMod = Number(actor.system?.skills?.med?.total ?? actor.system?.skills?.med?.mod ?? 0);
                        const formula = medMod >= 0 ? `1d20 + ${medMod}` : `1d20 - ${Math.abs(medMod)}`;

                        // Detect Healer's Kit on the tender
                        const healerKit = actor.items?.find(i =>
                            i.name?.toLowerCase().includes("healer") && i.name?.toLowerCase().includes("kit")
                        );
                        let kitCharges = healerKit
                            ? (healerKit.system?.uses?.value ?? healerKit.system?.quantity ?? 0)
                            : 0;
                        const hasKit = !!healerKit && kitCharges > 0;

                        for (let d = 0; d < days; d++) {
                            let total = 10 + medMod;
                            try {
                                const roll = await new Roll(formula).evaluate();
                                total = roll.total;
                            } catch { /* fallback */ }

                            // Advantage from kit (take better of two rolls)
                            if (hasKit && kitCharges > 0) {
                                try {
                                    const roll2 = await new Roll(formula).evaluate();
                                    total = Math.max(total, roll2.total);
                                } catch { /* fallback */ }
                            }

                            const passed = total >= 12;
                            if (passed) daysSucceeded++;

                            // Consume 1 kit charge per day
                            if (hasKit && kitCharges > 0) {
                                kitCharges--;
                            }
                        }

                        // Track patient-specific comfort boost for recovery phase
                        if (!outcome.tendedPatients) outcome.tendedPatients = [];
                        outcome.tendedPatients.push({
                            patientId,
                            patientName: patient.name,
                            daysOfCare: days,
                            daysSucceeded
                        });

                        outcome.activitiesSummary.push(
                            `Tend Wounds → ${patient.name} (${days}d): ${daysSucceeded}/${days} successful`
                        );
                    }
                } else {
                    // Fallback: no patient selected, blanket text summary
                    outcome.activitiesSummary.push(`Tend Wounds (${tendDays}d): Assisted ally recovery`);
                }
            }

            // Brew — mirrors cook, consumes ingredients from larder/inventory
            const brewActivity = viewModel.activities.find(a => a.id === "brew");
            const brewDays = brewActivity?.assignedDays ?? 0;
            if (brewDays > 0) {
                let brewedCount = 0;
                let downgradedCount = 0;

                for (let d = 0; d < brewDays; d++) {
                    if (downtimeLarder.rations > 0) {
                        downtimeLarder.rations--;
                        brewedCount++;
                    } else {
                        const candidate = actor.items.find(i => ItemClassifier.isFood(i, actor) && (i.system?.quantity ?? 1) > 0);
                        if (candidate) {
                            await consumeItem(actor, candidate.id, 1);
                            brewedCount++;
                        } else {
                            downgradedCount++;
                        }
                    }
                }

                if (!outcome.drinksProduced) outcome.drinksProduced = 0;
                outcome.drinksProduced += brewedCount;

                if (brewedCount > 0) {
                    outcome.activitiesSummary.push(`Brew (${brewedCount}d): ${brewedCount} drinks prepared`);
                }
                if (downgradedCount > 0) {
                    outcome.notes.push(`${downgradedCount} brew days downgraded to Camp Maintenance (no ingredients).`);
                }
            }

            // Fortify: defense checks resolution
            const fortifyActivity = viewModel.activities.find(a => a.id === "fortify");
            const fortifyDays = fortifyActivity?.assignedDays ?? 0;
            if (fortifyDays > 0) {
                const rollsMap = activityRolls instanceof Map ? activityRolls : new Map(Object.entries(activityRolls ?? {}));
                let actorRolls = rollsMap.get(actor.id);
                if (!Array.isArray(actorRolls)) actorRolls = [];

                let successCount = 0;
                let failCount = 0;

                for (let dayIdx = 0; dayIdx < 7; dayIdx++) {
                    const seg = viewModel.segments?.[dayIdx];
                    if (seg && seg.filled && seg.activityId === "fortify") {
                        let rollEntry = actorRolls.find(r => r.day === (dayIdx + 1));
                        if (!rollEntry || !rollEntry.rolled) {
                            const surMod = Number(actor.system?.skills?.sur?.total ?? actor.system?.skills?.sur?.mod ?? 0);
                            const steMod = Number(actor.system?.skills?.ste?.total ?? actor.system?.skills?.ste?.mod ?? 0);
                            const athMod = Number(actor.system?.skills?.ath?.total ?? actor.system?.skills?.ath?.mod ?? 0);
                            const bestMod = Math.max(surMod, steMod, athMod);
                            let total = 10 + bestMod;
                            try {
                                const r = await new Roll(bestMod >= 0 ? `1d20 + ${bestMod}` : `1d20 - ${Math.abs(bestMod)}`).evaluate();
                                total = r.total;
                            } catch {}
                            const passed = total >= 12;
                            rollEntry = { day: dayIdx + 1, activityId: "fortify", rolled: true, rollTotal: total, dc: 12, success: passed };
                        }
                        if (rollEntry.success) successCount++;
                        else failCount++;

                        outcome.rolls.push({
                            activity: "Fortify",
                            day: dayIdx + 1,
                            checks: [{ total: rollEntry.rollTotal, success: rollEntry.success, dc: rollEntry.dc }]
                        });
                    }
                }

                outcome.activitiesSummary.push(
                    `Fortify (${fortifyDays}d): ${successCount}/${fortifyDays} days held (-${successCount * 2} DC)`
                );
            }

            const fletchActivity = viewModel.activities.find(a => a.id === "fletch");
            const fletchDays = fletchActivity?.assignedDays ?? 0;
            if (fletchDays > 0) {
                const rollsMap = activityRolls instanceof Map
                    ? activityRolls
                    : new Map(Object.entries(activityRolls ?? {}));
                let actorFletchRolls = rollsMap.get(actor.id);
                if (!Array.isArray(actorFletchRolls)) actorFletchRolls = [];
                let successCount = 0;
                let yieldQty = 0;
                let kind = "arrows";
                for (let dayIdx = 0; dayIdx < 7; dayIdx++) {
                    const seg = viewModel.segments?.[dayIdx];
                    if (!seg?.filled || seg.activityId !== "fletch") continue;
                    const rollEntry = actorFletchRolls.find(r => r.day === (dayIdx + 1));
                    if (rollEntry?.success) successCount++;
                    if (rollEntry?.yieldQty) yieldQty += Number(rollEntry.yieldQty) || 0;
                    if (rollEntry?.fletchKind) kind = rollEntry.fletchKind;
                }
                const noun = kind === "bolts" ? "bolts" : "arrows";
                const yieldBit = yieldQty > 0 ? `, ${yieldQty} ${noun}` : "";
                outcome.activitiesSummary.push(
                    `Fletch Arrows (${fletchDays}d): ${successCount}/${fletchDays}${yieldBit}`
                );
            }

            // Train / Research / Carouse / Work / Rest
            for (const act of viewModel.activities) {
                if (["gather", "cook", "tend", "brew", "fortify", "fletch"].includes(act.id)) continue;
                if (act.assignedDays > 0) {
                    outcome.activitiesSummary.push(`${act.label} (${act.assignedDays}d)`);
                }
            }

            // Save allocations for "Repeat Last Week"
            const compact = budgetDelegate.exportCompact(actor.id);
            await actor.setFlag(MODULE_ID, "lastDowntimeAllocations", compact);
        }

        // ─── DAY 7 DEPARTURE MEAL RESOLUTION ────────────────────────────────
        let totalRationsConsumed = 0;
        let rationsNet = 0;
        const departureMealMap = departureMeals instanceof Map
            ? departureMeals
            : new Map(Object.entries(departureMeals ?? {}));
        const fedDay7ActorIds = new Set();
        const dualWaterCredits = new Map();
        const alreadyServed = new Map(
            (sendoffApplied ?? [])
                .filter(row => row?.kind === "food" && row.fed && row.actorId)
                .map(row => [row.actorId, row])
        );

        for (const actor of partyActors) {
            const served = alreadyServed.get(actor.id);
            if (served) {
                fedDay7ActorIds.add(actor.id);
                totalRationsConsumed++;
                if (served.satiatesWater) {
                    dualWaterCredits.set(actor.id, (dualWaterCredits.get(actor.id) ?? 0) + 1);
                }
                characterOutcomes.get(actor.id)?.activitiesSummary.push(
                    `Departure Meal: ${served.itemName || "Meal"} (send-off)`
                );
                continue;
            }
            const depItemId = departureMealMap.get(actor.id);
            if (!depItemId) continue;
            const item = actor.items?.get ? actor.items.get(depItemId) : actor.items?.find?.(i => i.id === depItemId);
            if (!item || (item.system?.quantity ?? 1) <= 0) continue;

            const taken = await consumeItem(actor, item.id, 1);
            if (taken > 0) {
                fedDay7ActorIds.add(actor.id);
                totalRationsConsumed++;

                const rf = item.flags?.[MODULE_ID] ?? {};
                const satiates = Array.isArray(rf.satiates) ? rf.satiates : [];
                if (satiates.includes("water") || rf.satiatesWater === true) {
                    dualWaterCredits.set(actor.id, (dualWaterCredits.get(actor.id) ?? 0) + 1);
                }

                const itemSnapshot = item.toObject ? item.toObject() : item;
                const outcome = characterOutcomes.get(actor.id);

                if (rf.chefTreat) {
                    const pb = Number(rf.chefTreatProfBonus) || 0;
                    const treatHp = pb > 0 ? pb : 1;
                    const currentTemp = actor.system?.attributes?.hp?.temp ?? 0;
                    if (treatHp > currentTemp) {
                        await actor.update?.({ "system.attributes.hp.temp": treatHp });
                    }
                    outcome?.activitiesSummary.push(`Departure Meal: ${item.name} (+${treatHp} temp HP)`);
                } else if (rf.wellFed || rf.buff) {
                    if (!itemSnapshot.flags) itemSnapshot.flags = {};
                    if (!itemSnapshot.flags[MODULE_ID]) itemSnapshot.flags[MODULE_ID] = {};
                    itemSnapshot.flags[MODULE_ID].wellFed = true;
                    try {
                        await dispatchWellFedMealServing({
                            consumerActor: actor,
                            itemSnapshot,
                            partyIds: partyActors.map(a => a.id)
                        });
                    } catch (err) {
                        Logger.error?.(`${MODULE_ID} | Failed to dispatch departure meal buff:`, err);
                    }
                    outcome?.activitiesSummary.push(`Departure Meal: ${item.name} (Well Fed Active Effect)`);
                } else {
                    outcome?.activitiesSummary.push(`Departure Meal: ${item.name}`);
                }
            }
        }

        // ─── SUPPLY COMMISSARY RESOLUTION (Days 1–6 Sustenance & Water) ─────────
        const terrainDefaults = TerrainRegistry.getDefaults(terrainTag);
        const terrainMealRules = terrainDefaults?.mealRules ?? { waterPerDay: 2, foodPerDay: 1 };
        const characterFoodShortfalls = new Map();
        const characterWaterShortfalls = new Map();

        if (haven === "civilized") {
            // Town Haven: lifestyle covered or gold paid; 0 inventory rations consumed
            rationsNet = downtimeLarder.rations;
        } else {
            const effectiveDaysNeeded = typeof foodDaysNeeded === "number"
                ? Math.max(0, Math.min(foodDaysNeeded, 7))
                : Math.max(0, 7 - (patronSuppliedDays ?? 0));

            for (const actor of partyActors) {
                const outcome = characterOutcomes.get(actor.id);
                const mealNeeds = getActorMealNeeds(actor, terrainMealRules);
                const fpd = Math.max(1, mealNeeds?.foodPerDay ?? 1);
                const wpd = Math.max(0, mealNeeds?.waterPerDay ?? 2);

                const alreadyFedDay7 = fedDay7ActorIds.has(actor.id);
                const actorDays = alreadyFedDay7 ? Math.max(0, effectiveDaysNeeded - 1) : effectiveDaysNeeded;
                let actorFoodUnitsNeeded = actorDays * fpd;

                // 1. First offset by fresh harvested provisions if available
                if (downtimeLarder.rations > 0 && actorFoodUnitsNeeded > 0) {
                    const fromHarvest = Math.min(downtimeLarder.rations, actorFoodUnitsNeeded);
                    downtimeLarder.rations -= fromHarvest;
                    actorFoodUnitsNeeded -= fromHarvest;
                    totalRationsConsumed += fromHarvest;
                }

                // 2. Consume explicitly nominated food first (player backpack pick)
                const nominations = foodNominations instanceof Map
                    ? foodNominations
                    : new Map(Object.entries(foodNominations ?? {}));
                const nominated = nominations.get(actor.id);
                if (nominated?.itemId && actorFoodUnitsNeeded > 0) {
                    const nominatedTake = Math.min(
                        actorFoodUnitsNeeded,
                        Number(nominated.quantity) || actorFoodUnitsNeeded
                    );
                    const taken = await consumeItem(actor, nominated.itemId, nominatedTake);
                    if (taken > 0) {
                        actorFoodUnitsNeeded -= taken;
                        totalRationsConsumed += taken;
                    }
                }

                // 3. Consume remaining routine plain food from actor's inventory
                if (actorFoodUnitsNeeded > 0) {
                    const candidates = (actor.items ?? []).filter(i => {
                        if (!ItemClassifier.isFood(i, actor)) return false;
                        if (ItemClassifier.isSpoiled?.(i)) return false;
                        const rf = i.flags?.[MODULE_ID] ?? {};
                        if (rf.chefTreat || rf.buff || rf.wellFed || rf.magicFood || rf.wellFedBuff) return false;
                        return (i.system?.quantity ?? 1) > 0;
                    });

                    for (const candidate of candidates) {
                        if (actorFoodUnitsNeeded <= 0) break;
                        const avail = candidate.system?.quantity ?? 1;
                        if (avail <= 0) continue;
                        const take = Math.min(actorFoodUnitsNeeded, avail);
                        const taken = await consumeItem(actor, candidate.id, take);
                        if (taken > 0) {
                            actorFoodUnitsNeeded -= taken;
                            totalRationsConsumed += taken;
                            const rf = candidate.flags?.[MODULE_ID] ?? {};
                            const satiates = Array.isArray(rf.satiates) ? rf.satiates : [];
                            if (satiates.includes("water") || rf.satiatesWater === true) {
                                dualWaterCredits.set(actor.id, (dualWaterCredits.get(actor.id) ?? 0) + taken);
                            }
                        }
                    }
                }

                // Record food shortfall
                const foodShortfallDays = (fpd > 0) ? Math.ceil(actorFoodUnitsNeeded / fpd) : 0;
                characterFoodShortfalls.set(actor.id, foodShortfallDays);
                if (foodShortfallDays > 0) {
                    outcome?.notes.push(`Starvation Risk: ${foodShortfallDays} days without food in the wilderness.`);
                }

                // 3. Water Consumption
                const totalWaterUnitsNeeded = effectiveDaysNeeded * wpd;
                const waterFromDualFood = dualWaterCredits.get(actor.id) ?? 0;
                let waterNeededFromSources = Math.max(0, totalWaterUnitsNeeded - waterFromDualFood);
                let waterConsumedFromSources = 0;

                if (waterNeededFromSources > 0) {
                    const waterOptions = buildWaterOptions(actor, terrainMealRules);
                    for (const opt of waterOptions) {
                        if (waterNeededFromSources <= 0) break;
                        const take = Math.min(waterNeededFromSources, opt.totalPints);
                        const consumed = await consumeItem(actor, opt.itemId, take);
                        if (consumed > 0) {
                            waterConsumedFromSources += consumed;
                            waterNeededFromSources -= consumed;
                        }
                    }
                }

                const totalWaterFulfilled = Math.min(totalWaterUnitsNeeded, waterFromDualFood + waterConsumedFromSources);
                const waterShortfallUnits = Math.max(0, totalWaterUnitsNeeded - totalWaterFulfilled);
                const waterShortfallDays = (wpd > 0) ? Math.ceil(waterShortfallUnits / wpd) : 0;
                characterWaterShortfalls.set(actor.id, waterShortfallDays);

                if (totalWaterUnitsNeeded > 0) {
                    outcome?.activitiesSummary.push(`Hydration: ${totalWaterFulfilled}/${totalWaterUnitsNeeded} units fulfilled`);
                }
                if (waterShortfallDays > 0) {
                    outcome?.notes.push(`Dehydration Risk: ${waterShortfallDays} days without adequate water.`);
                }
            }

            rationsNet = downtimeLarder.rations;
        }

        // ─── CAMP HEARTH & FIREWOOD RESOLUTION (Wilderness) ──────────────────
        let fuelBurnDetail = "";
        let fireLevelLabel = "";
        let firewoodBurned = 0;

        if (haven === "wilderness") {
            const FIRE_LABELS = {
                cold_camp: "Cold Camp",
                embers: "Embers",
                campfire: "Campfire",
                bonfire: "Bonfire"
            };
            fireLevelLabel = FIRE_LABELS[fireLevel] ?? "Campfire";

            if (fireLevel === "cold_camp") {
                fuelBurnDetail = "No fire (Cold camp)";
            } else {
                const cost = CampGearScanner.FIREWOOD_COST_BY_LEVEL[fireLevel] ?? (fireLevel === "embers" ? 1 : fireLevel === "bonfire" ? 3 : 2);
                let remainingCost = cost;
                const fuelContributors = [];

                for (const actor of partyActors) {
                    if (remainingCost <= 0) break;
                    let woodItem = findConsumableFirewoodItem(actor);
                    while (woodItem && remainingCost > 0) {
                        const available = woodItem.system?.quantity ?? 1;
                        const take = Math.min(remainingCost, available);
                        if (take > 0) {
                            const taken = await consumeItem(actor, woodItem.id, take);
                            if (taken > 0) {
                                remainingCost -= taken;
                                firewoodBurned += taken;
                                fuelContributors.push(`${actor.name} (${taken})`);
                            }
                        }
                        woodItem = (remainingCost > 0) ? findConsumableFirewoodItem(actor) : null;
                    }
                }

                if (fuelContributors.length > 0) {
                    fuelBurnDetail = `${firewoodBurned} firewood burned (${fuelContributors.join(", ")})`;
                } else if (cost > 0) {
                    fuelBurnDetail = `${cost} firewood required (none in stock)`;
                } else {
                    fuelBurnDetail = "0 firewood burned";
                }
            }
        }

        // ─── PHASE 4: LONG REST RECOVERY (Comfort & Rest Mapped) ────────────
        // Build set of patient actor IDs who received successful tend care
        const tendedPatientIds = new Set();
        for (const outcome of characterOutcomes.values()) {
            if (outcome.tendedPatients) {
                for (const tp of outcome.tendedPatients) {
                    if (tp.daysSucceeded > 0) tendedPatientIds.add(tp.patientId);
                }
            }
        }

        for (const actor of partyActors) {
            try {
                const outcome = characterOutcomes.get(actor.id);
                const viewModel = budgetDelegate.getActorViewModel(actor);
                const restAct = viewModel.activities.find(a => a.id === "rest");
                const restDays = (restAct?.assignedDays ?? 0) + (viewModel.unallocatedDays ?? 0);

                // Update starvation / dehydration flags based on weekly shortfall
                const foodShortfallDays = characterFoodShortfalls.get(actor.id) ?? 0;
                const waterShortfallDays = characterWaterShortfalls.get(actor.id) ?? 0;

                if (foodShortfallDays > 0) {
                    const prevFood = actor.getFlag(MODULE_ID, "restsSinceFood") ?? 0;
                    await actor.setFlag(MODULE_ID, "restsSinceFood", prevFood + foodShortfallDays);
                } else {
                    await actor.setFlag(MODULE_ID, "restsSinceFood", 0);
                }

                if (waterShortfallDays > 0) {
                    const prevWater = actor.getFlag(MODULE_ID, "restsSinceWater") ?? 0;
                    await actor.setFlag(MODULE_ID, "restsSinceWater", prevWater + waterShortfallDays);
                } else {
                    await actor.setFlag(MODULE_ID, "restsSinceWater", 0);
                }

                const actorUpdates = {};

                // 1. Spell Slots Always 100% Full Recovery (Preserves Class Balance)
                const spells = actor.system?.spells;
                if (spells) {
                    for (const [slotKey, slotData] of Object.entries(spells)) {
                        if (slotData && typeof slotData.max === "number" && slotData.max > 0) {
                            actorUpdates[`system.spells.${slotKey}.value`] = slotData.max;
                        }
                    }
                }

                // 2. Determine Effective Comfort Tier
                let effectiveComfort = haven === "civilized" ? "safe" : (campComfort ?? "rough");

                if (effectiveComfort !== "safe" && isComfortEnabled()) {
                    // Bedroll: +1 tier boost
                    const items = actor.items?.map(i => i.name?.toLowerCase() ?? "") ?? [];
                    const hasBedroll = !enforceBedroll || items.some(n => n.includes("bedroll"));
                    if (hasBedroll) {
                        effectiveComfort = boostComfort(effectiveComfort, 1);
                    }

                    // Tended wounds: +1 tier boost (only for patients who received successful care)
                    if (tendedPatientIds.has(actor.id)) {
                        effectiveComfort = boostComfort(effectiveComfort, 1);
                    }

                    // Convalescence Threshold: 3+ rest days grants an extra comfort boost (+1 tier)
                    if (restDays >= 3) {
                        effectiveComfort = boostComfort(effectiveComfort, 1);
                    }
                }

                // 3. HP Recovery: Severely Damaged in Uncomfortable Haven
                const hp = actor.system?.attributes?.hp ?? { value: 0, max: 0 };
                const hpMax = hp.max ?? 0;
                const currentHp = hp.value ?? 0;

                let targetHp = hpMax;
                // In Wilderness without the 3-day Convalescence threshold:
                if (haven !== "civilized" && restDays < 3 && isComfortEnabled()) {
                    if (effectiveComfort === "hostile") {
                        // Hostile comfort cap: 75% max HP (ComfortCalculator.HP_FRACTION.hostile)
                        const cap = Math.floor(hpMax * (HP_FRACTION.hostile ?? 0.75));
                        targetHp = Math.min(cap, Math.max(currentHp, cap));
                    } else if (effectiveComfort === "rough") {
                        // Rough comfort cap: severely injured PCs working full-time in the dirt cap at 75% max HP
                        const cap = Math.floor(hpMax * 0.75);
                        targetHp = Math.min(cap, Math.max(currentHp, cap));
                    }
                }
                actorUpdates["system.attributes.hp.value"] = targetHp;

                // 4. Exhaustion Processing (Adjudicated Saves & Natural Recovery)
                const exhaustionEntry = exhaustionResults?.find(e => e.actorId === actor.id);
                const currentExhaustion = actor.system?.attributes?.exhaustion ?? 0;
                let newExhaustion = currentExhaustion;

                if (exhaustionEntry?.gainLevel > 0) {
                    newExhaustion += exhaustionEntry.gainLevel;
                    outcome?.notes?.push(`Constitution save failed: gained 1 level of exhaustion (now ${newExhaustion})`);
                } else if (exhaustionEntry?.mustRoll && exhaustionEntry?.passed) {
                    outcome?.notes?.push("Constitution save passed: resisted exhaustion");
                } else if (exhaustionEntry?.waived) {
                    outcome?.notes?.push("Exhaustion check waived by GM");
                } else if (currentExhaustion > 0) {
                    let reduction = 1; // standard long rest: -1 exhaustion
                    if (restDays >= 5) {
                        reduction = 2; // "Resting Fully" across the week: -2 exhaustion
                    } else if (effectiveComfort === "hostile") {
                        reduction = 0; // Hostile comfort blocks natural exhaustion reduction
                    }
                    newExhaustion = Math.max(0, currentExhaustion - reduction);
                    if (newExhaustion < currentExhaustion) {
                        outcome?.notes?.push(`Exhaustion recovered: -${currentExhaustion - newExhaustion} (now ${newExhaustion})`);
                    }
                }
                if (newExhaustion !== currentExhaustion) {
                    actorUpdates["system.attributes.exhaustion"] = newExhaustion;
                }

                // Apply combined actor updates
                if (Object.keys(actorUpdates).length > 0) {
                    await actor.update(actorUpdates);
                }

                // 5. Hit Dice Recovery (Recovered, Never Spent)
                // Comfort HD penalty applies only if < 3 rest days and comfort is enabled
                const hdPenalty = (restDays >= 3 || !isComfortEnabled()) ? 0 : getHdPenalty(effectiveComfort);
                const classItems = actor.items?.filter(i => i.type === "class") ?? [];

                if (hdPenalty > 0) {
                    let penaltyRemaining = hdPenalty;
                    for (const cls of classItems) {
                        const totalClsHd = cls.system?.levels ?? 1;
                        const canLeaveSpent = Math.min(penaltyRemaining, totalClsHd);
                        if (cls.system?.hitDiceUsed !== undefined) {
                            await cls.update({ "system.hitDiceUsed": canLeaveSpent });
                        } else if (cls.system?.hd?.spent !== undefined) {
                            await cls.update({ "system.hd.spent": canLeaveSpent });
                        }
                        penaltyRemaining -= canLeaveSpent;
                    }
                } else {
                    for (const cls of classItems) {
                        if (cls.system?.hitDiceUsed !== undefined) {
                            await cls.update({ "system.hitDiceUsed": 0 });
                        } else if (cls.system?.hd?.spent !== undefined) {
                            await cls.update({ "system.hd.spent": 0 });
                        }
                    }
                }
            } catch (err) {
                Logger.warn(`${MODULE_ID} | Recovery application error for ${actor.name}:`, err);
            }
        }

        await stampWellFedDuration(partyActors);

        const approvedEncounters = encounterResults.filter(e => e.triggered || e.state === "red" || e.state === "amber" || e.isDisaster);

        return {
            summary: {
                haven,
                fireLevel,
                fireLevelLabel,
                firewoodBurned,
                fuelBurnDetail,
                rationsHarvested: Array.from(characterOutcomes.values()).reduce((sum, o) => sum + o.harvestedRations, 0),
                rationsConsumed: totalRationsConsumed,
                rationsNet: Math.max(0, rationsNet),
                mealsCooked: totalMealsCooked,
                nightsQuiet: Math.max(0, 7 - approvedEncounters.length),
                encountersCount: approvedEncounters.length,
                freshForageNote: freshForageSpoils ? FRESH_FORAGE_NOTE : ""
            },
            characters: Array.from(characterOutcomes.values()),
            encounters: approvedEncounters
        };
    }
}
