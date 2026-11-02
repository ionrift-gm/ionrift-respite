import { MODULE_ID } from "../../data/moduleId.js";
import { getPartyActors } from "../../services/party/partyActors.js";
import { ItemClassifier } from "../../services/party/ItemClassifier.js";
import { describeItemMealBuff } from "../../services/meal/buffs/MealBuffPresets.js";
import { SpoilageClock } from "../../services/meal/spoilage/SpoilageClock.js";
import { FRESH_FORAGE_NOTE, GatherYieldService } from "../../services/rest/forage/GatherYieldService.js";
import { TerrainRegistry } from "../../services/events/resolve/TerrainRegistry.js";
import { CampGearScanner } from "../../services/camp/gear/CampGearScanner.js";
import { getActorMealNeeds } from "../../services/meal/phase/MealContextBuilder.js";
import { MEAL_DEFAULTS } from "../../services/meal/inventory/MealConstants.js";
import { buildWaterOptions } from "../../services/meal/phase/MealOptionBuilder.js";
import { SustenanceAlertBuilder } from "../../services/meal/phase/SustenanceAlertBuilder.js";
import { bulletTip } from "./DowntimeSustenanceBuilder.js";

export function buildCharacterSustenanceData(app, actor, {
    isGM,
    haven,
    safeRestSpot,
    terrain,
    scanResult,
    workbenchIdentifyUiEnabled
}) {
    let totalNominatedRationsDelta = 0;
            const isOwner = isGM || actor.isOwner;
            const budget = app._budgetDelegate.getActorViewModel(actor);
            const isDrilledDown = app._drilledDownActorIds.has(actor.id);
            const identifyDays = app._budgetDelegate?.getActivityDays?.(actor.id, "identify") ?? 0;
            const focusBudget = app.getFocusBudget(actor.id);
            const focusCount = app._workbench ? app._workbench.getFocusCount(actor.id) : 0;
            const focusRemaining = Math.max(0, focusBudget - focusCount);
            const isIdentifyOpen = app._selectedWorkflowStep === "examine"
                || (app._expandedTiers.get(actor.id)?.has("identify") ?? false);
            const workbenchEmbed = (workbenchIdentifyUiEnabled && isIdentifyOpen)
                ? app._workbench.buildEmbedContext(actor.id, getPartyActors)
                : null;
            const fallbackComfort = safeRestSpot ? "safe" : (terrain?.comfort ?? "rough");
            const fallbackTotalHd = actor?.system?.attributes?.hd?.max ?? actor?.system?.details?.level ?? 0;
            const fallbackCurrentHd = actor?.system?.attributes?.hd?.value ?? fallbackTotalHd;
            const fallbackIsAlreadyFull = fallbackCurrentHd >= fallbackTotalHd;
            const personalCard = scanResult.personalCards?.find(c => c.actorId === actor.id) ?? {
                personalComfort: fallbackComfort,
                personalComfortLabel: safeRestSpot ? game.i18n.localize("ionrift-respite.downtimeLedger.comfortSafe") : game.i18n.localize("ionrift-respite.downtimeLedger.comfortRough"),
                hasBedroll: !app._campLogistics._enforceBedroll,
                hasTent: !app._campLogistics._enforceTent,
                hasMessKit: !app._campLogistics._enforceMessKit,
                bedrollWaived: !app._campLogistics._enforceBedroll,
                tentWaived: !app._campLogistics._enforceTent,
                messKitWaived: !app._campLogistics._enforceMessKit,
                recovery: {
                    hpFull: true,
                    hdLabel: fallbackIsAlreadyFull ? game.i18n.format("ionrift-respite.downtimeLedger.alreadyMaxHitDice", { total: fallbackTotalHd }) : game.i18n.localize("ionrift-respite.downtimeLedger.normalHdRecovery"),
                    exhaustionDC: fallbackComfort === "rough" ? 10 : (fallbackComfort === "hostile" ? 15 : null),
                    isAlreadyFull: fallbackIsAlreadyFull,
                    currentHd: fallbackCurrentHd,
                    totalHd: fallbackTotalHd,
                    benefitSummary: CampGearScanner.formatBenefitSummary({
                        personalComfort: fallbackComfort,
                        isAlreadyFull: fallbackIsAlreadyFull,
                        hpFraction: 1.0
                    })
                }
            };

            // Day 7 Departure Meal ID for this actor
            const selectedDepartureMealId = app._departureMeals.get(actor.id) ?? null;
            const selectedDepItem = selectedDepartureMealId ? (actor.items?.get ? actor.items.get(selectedDepartureMealId) : actor.items?.find?.(i => i.id === selectedDepartureMealId)) : null;
            const selectedDepFlags = selectedDepItem?.flags?.[MODULE_ID] ?? {};
            const selectedDepSatiates = Array.isArray(selectedDepFlags.satiates) ? selectedDepFlags.satiates : [];
            const selectedDepIsDual = selectedDepSatiates.includes("water") || selectedDepFlags.satiatesWater === true;

            // Sustenance needs & climate rules (Unified Centralized Terrain & Actor flags)
            const terrainDefaults = TerrainRegistry.getDefaults(app._terrainTag);
            const terrainMealRules = terrainDefaults?.mealRules ?? { waterPerDay: MEAL_DEFAULTS.waterPerDay, foodPerDay: MEAL_DEFAULTS.foodPerDay };
            const effectiveRules = { ...MEAL_DEFAULTS, ...terrainMealRules };
            const mealNeeds = getActorMealNeeds(actor, terrainMealRules);
            const fpd = Math.max(0, mealNeeds?.foodPerDay ?? effectiveRules.foodPerDay);
            const wpd = Math.max(0, mealNeeds?.waterPerDay ?? effectiveRules.waterPerDay);

            const terrainLabel = terrainDefaults?.label ?? (app._terrainTag ? (app._terrainTag.charAt(0).toUpperCase() + app._terrainTag.slice(1)) : "Standard");
            const alertData = SustenanceAlertBuilder.build({
                terrainLabel,
                terrainMealRules,
                effectiveRules,
                mealNeeds
            });
            const climateLabel = alertData.label;
            const climateTooltip = alertData.tooltip;
            const isTraitPill = alertData.isTraitPill;

            // Plain food items (auto-consumed for routine sustenance)
            const plainFoodItems = (actor.items ?? []).filter(i => {
                if (!ItemClassifier.isFood(i, actor)) return false;
                if (ItemClassifier.isSpoiled?.(i)) return false;
                const flags = i.flags?.[MODULE_ID] ?? {};
                // Exclude buff/magic food from routine auto-consumption
                if (flags.chefTreat || flags.buff || flags.wellFedBuff || flags.magicFood || flags.wellFed) return false;
                return (i.system?.quantity ?? 1) > 0;
            }).map(i => {
                const flags = i.flags?.[MODULE_ID] ?? {};
                const satiates = Array.isArray(flags.satiates) ? flags.satiates : [];
                const isDual = satiates.includes("water") || flags.satiatesWater === true;
                return {
                    id: i.id,
                    name: i.name,
                    img: i.img,
                    quantity: i.system?.quantity ?? 1,
                    isDual
                };
            });

            // Pre-calculate gathering yield from rolled days so wild harvest directly offsets sustenance
            const rawSchedule = app._getOrCreateGatheringSchedule(actor.id);
            let charHarvestedRolled = 0;
            let rolledCount = 0;
            let forageCount = 0;
            let huntCount = 0;
            let skipCount = 0;

            for (const entry of rawSchedule) {
                const mode = entry.mode ?? "forage";
                if (mode === "skip") skipCount++;
                else if (mode === "hunt") huntCount++;
                else forageCount++;

                if (entry.rolled && mode !== "skip") {
                    rolledCount++;
                    if (entry.success) {
                        charHarvestedRolled += (entry.yield ?? 0);
                    }
                }
            }

            // Days 1-6 routine sustenance (neededDays1to6 per character)
            const days1to6Needed = (haven === "civilized") ? 0 : Math.max(0, app._campLogistics._foodDaysNeeded - 1);
            const isSelectedDepartureMeal = Boolean(selectedDepartureMealId);
            const day7RoutineFoodNeeded = (haven === "civilized" || isSelectedDepartureMeal) ? 0 : 1;
            const totalFoodUnitsNeeded1to6 = days1to6Needed * fpd;
            const totalRoutineFoodUnitsNeeded = (days1to6Needed + day7RoutineFoodNeeded) * fpd;

            let autoFoodRemaining = totalRoutineFoodUnitsNeeded;
            let waterFromDualFood = 0;
            const autoConsumed1to6 = [];
            const consumedByItem = new Map();
            let day7RoutineFoodCovered = (haven === "civilized" || isSelectedDepartureMeal);

            // Harvest is a list of finds, not a second pantry. Food only comes
            // off items the character is actually carrying.
            const foragedFoodUsed = 0;

            for (const food of plainFoodItems) {
                if (autoFoodRemaining <= 0) break;
                // If this item is currently selected for Day 7 departure meal, reserve 1 unit
                const isSelectedForDay7 = (food.id === selectedDepartureMealId);
                const maxAvailable = isSelectedForDay7
                    ? Math.max(0, food.quantity - 1)
                    : food.quantity;

                if (maxAvailable <= 0) continue;

                // First satisfy Days 1-6
                const days1to6RemainingUnits = Math.max(0, totalFoodUnitsNeeded1to6 - foragedFoodUsed - autoConsumed1to6.reduce((sum, f) => sum + f.quantity, 0));
                const takeFor1to6 = Math.min(maxAvailable, days1to6RemainingUnits);
                if (takeFor1to6 > 0) {
                    autoConsumed1to6.push({
                        id: food.id,
                        name: food.name,
                        quantity: takeFor1to6,
                        totalInPack: food.quantity,
                        isDual: food.isDual
                    });
                    consumedByItem.set(food.id, (consumedByItem.get(food.id) ?? 0) + takeFor1to6);
                    autoFoodRemaining -= takeFor1to6;
                    if (food.isDual) {
                        waterFromDualFood += takeFor1to6;
                    }
                }

                // If Day 7 still needs a routine ration and this item has stock left
                const remainingOnThisItem = maxAvailable - takeFor1to6;
                if (!day7RoutineFoodCovered && remainingOnThisItem > 0 && autoFoodRemaining > 0) {
                    const neededForDay7 = fpd;
                    const takeForDay7 = Math.min(remainingOnThisItem, neededForDay7);
                    if (takeForDay7 > 0) {
                        consumedByItem.set(food.id, (consumedByItem.get(food.id) ?? 0) + takeForDay7);
                        day7RoutineFoodCovered = true;
                        autoFoodRemaining -= takeForDay7;
                        if (food.isDual) {
                            waterFromDualFood += takeForDay7;
                        }
                    }
                }
            }

            // If selected departure meal is dual-satiating, credit 1 water unit toward Day 7
            if (isSelectedDepartureMeal && selectedDepIsDual) {
                waterFromDualFood += 1;
            }

            const totalAutoConsumed = totalRoutineFoodUnitsNeeded - autoFoodRemaining;
            const foodShortfallUnits = autoFoodRemaining;
            let foodShortfallDays = (haven === "wilderness" && fpd > 0)
                ? Math.ceil(foodShortfallUnits / fpd)
                : 0;
            let hasStarvationRisk = (haven === "wilderness") && (foodShortfallDays > 0);

            const fedDaysCount = (haven === "civilized")
                ? 7
                : Math.max(0, 7 - foodShortfallDays);

            // Water calculations
            const totalDaysWaterNeeded = (haven === "civilized") ? 0 : app._campLogistics._foodDaysNeeded;
            const totalWaterUnitsNeeded = totalDaysWaterNeeded * wpd;
            const waterOptions = (haven === "civilized") ? [] : buildWaterOptions(actor, terrainMealRules);
            const totalPackWaterPints = waterOptions.reduce((sum, opt) => sum + (opt.totalPints ?? 0), 0);

            // Water from dual-satiating food directly offsets water needed from water sources
            const waterNeededFromSources = Math.max(0, totalWaterUnitsNeeded - waterFromDualFood);
            const waterUnitsTakenFromSources = Math.min(waterNeededFromSources, totalPackWaterPints);
            const totalWaterFulfilled = (haven === "civilized")
                ? totalWaterUnitsNeeded
                : Math.min(totalWaterUnitsNeeded, waterFromDualFood + waterUnitsTakenFromSources);

            const waterShortfallUnits = (haven === "civilized")
                ? 0
                : Math.max(0, totalWaterUnitsNeeded - totalWaterFulfilled);
            let waterShortfallDays = (haven === "civilized" || wpd <= 0)
                ? 0
                : Math.ceil(waterShortfallUnits / wpd);
            let hasDehydrationRisk = (haven === "wilderness") && (waterShortfallDays > 0);
            const hydratedDaysCount = (haven === "civilized")
                ? 7
                : Math.max(0, 7 - waterShortfallDays);
            const waterPintsRemainingInPack = Math.max(0, totalPackWaterPints - waterUnitsTakenFromSources);

            // Format Days 1-6 food summary with remaining pack stock
            let autoFoodSummary = null;
            let autoFoodTooltip = null;
            if (autoConsumed1to6.length > 0) {
                autoFoodSummary = autoConsumed1to6.map(f => {
                    const totalConsumedOfItem = consumedByItem.get(f.id) ?? f.quantity;
                    const reservedForDay7 = (f.id === selectedDepartureMealId) ? 1 : 0;
                    const leftInPack = Math.max(0, f.totalInPack - totalConsumedOfItem - reservedForDay7);
                    const dualTag = f.isDual ? " [dual]" : "";
                    return `${f.quantity}× ${f.name}${dualTag} (${leftInPack} in pack)`;
                }).join(", ");
                autoFoodTooltip = bulletTip("From the pack", autoConsumed1to6.map(f => {
                    const totalConsumedOfItem = consumedByItem.get(f.id) ?? f.quantity;
                    const reservedForDay7 = (f.id === selectedDepartureMealId) ? 1 : 0;
                    const leftInPack = Math.max(0, f.totalInPack - totalConsumedOfItem - reservedForDay7);
                    return `${f.quantity}× ${f.name} (${leftInPack} left)`;
                }));
            }

            // Format Days 1-6 water summary
            let autoWaterSummary = null;
            let autoWaterTooltip = null;
            if (haven === "wilderness") {
                const dualNote = waterFromDualFood > 0 ? ` (${waterFromDualFood}u from food)` : "";
                if (hasDehydrationRisk) {
                    autoWaterSummary = `${totalWaterFulfilled}/${totalWaterUnitsNeeded}u (${waterShortfallUnits}u short)`;
                    autoWaterTooltip = bulletTip("Water short", [
                        `${totalWaterFulfilled} of ${totalWaterUnitsNeeded} units${dualNote}`,
                        `${waterShortfallDays} days short`,
                        "DC 15 Constitution save, or exhaustion"
                    ]);
                } else {
                    autoWaterSummary = `${totalWaterFulfilled}/${totalWaterUnitsNeeded}u (${waterPintsRemainingInPack} in pack)`;
                    autoWaterTooltip = bulletTip("Water", [
                        `${totalWaterFulfilled} of ${totalWaterUnitsNeeded} units drunk${dualNote}`,
                        `${waterPintsRemainingInPack} left in the pack`
                    ]);
                }
            }

            const daysToFeed = days1to6Needed;
            totalNominatedRationsDelta += totalAutoConsumed;

            const surMod = Number(actor.system?.skills?.sur?.total ?? actor.system?.skills?.sur?.mod ?? 0);
            const survivalModFormatted = surMod >= 0 ? `+${surMod}` : `${surMod}`;

            const hasAnyRolled = rawSchedule.some(entry => entry.rolled && entry.mode !== "skip");

            const gatheringSchedule = rawSchedule.map(entry => {
                const mode = entry.mode ?? "forage";
                const isSkip = mode === "skip";
                const isHunt = mode === "hunt";
                const isForage = mode === "forage";
                const dc = isSkip ? null : (isHunt ? (app._campLogistics._huntDC ?? 14) : (app._campLogistics._forageDC ?? 12));

                const canToggle = !entry.rolled && isOwner && (!hasAnyRolled || isGM);
                let tooltip;
                const huntOrForage = isHunt ? game.i18n.localize("ionrift-respite.downtimeBatch.hunt") : game.i18n.localize("ionrift-respite.downtimeBatch.forage");
                if (isSkip) {
                    const editHint = canToggle ? (isGM ? ` ${game.i18n.localize("ionrift-respite.downtimeLedger.clickToggleChoice")}` : ` ${game.i18n.localize("ionrift-respite.downtimeLedger.clickToggle")}`) : "";
                    tooltip = game.i18n.format("ionrift-respite.downtimeLedger.skippedDayTooltip", { day: entry.day, hint: editHint });
                } else if (entry.rolled) {
                    const outcomeText = entry.detail
                        ? entry.detail
                        : (entry.success ? game.i18n.localize("ionrift-respite.downtimeLedger.findRecorded") : game.i18n.localize("ionrift-respite.downtimeLedger.nothingFound"));
                    tooltip = bulletTip(game.i18n.format("ionrift-respite.downtimeLedger.dayActivityTitle", { day: entry.day, activity: huntOrForage }), [
                        game.i18n.format("ionrift-respite.downtimeLedger.checkVsDc", { roll: entry.rollTotal, dc }),
                        outcomeText
                    ]);
                } else {
                    const toggleHint = isOwner ? ` ${game.i18n.localize("ionrift-respite.downtimeLedger.clickToggle")}` : "";
                    tooltip = game.i18n.format("ionrift-respite.downtimeLedger.dayUnrolledTooltip", { day: entry.day, activity: huntOrForage, dc, hint: toggleHint });
                }

                return {
                    ...entry,
                    dc,
                    isForage,
                    isHunt,
                    isSkip,
                    icon: isSkip ? "fas fa-minus" : (isHunt ? "fas fa-crosshairs" : "fas fa-leaf"),
                    label: isSkip ? game.i18n.localize("ionrift-respite.downtimeBatch.skip") : (isHunt ? game.i18n.localize("ionrift-respite.downtimeBatch.hunt") : game.i18n.localize("ionrift-respite.downtimeBatch.forage")),
                    modeLabel: isSkip ? game.i18n.localize("ionrift-respite.downtimeLedger.camp") : (isHunt ? game.i18n.localize("ionrift-respite.downtimeBatch.hunt") : game.i18n.localize("ionrift-respite.downtimeBatch.forage")),
                    canToggle,
                    tooltip,
                    finds: GatherYieldService.presentItems(entry.items, {
                        rations: entry.fromTable ? 0 : (entry.yield ?? 0)
                    })
                };
            });

            const activeCount = forageCount + huntCount;
            const unrolledCount = activeCount - rolledCount;
            const isAllRolled = rawSchedule.every(entry => entry.mode === "skip" || entry.rolled);
            const hasRolled = rolledCount > 0;

            let roleClass = "role-mixed";
            if (activeCount === 0) {
                roleClass = "role-skip";
            } else if (huntCount === 0) {
                roleClass = "role-forage";
            } else if (forageCount === 0) {
                roleClass = "role-hunt";
            }

            const labelParts = [];
            if (forageCount > 0) labelParts.push(`${forageCount}🌿`);
            if (huntCount > 0) labelParts.push(`${huntCount}🎯`);
            if (skipCount > 0) labelParts.push(`${skipCount}➖`);
            const configLabel = labelParts.length > 0 ? labelParts.join(" ") : game.i18n.localize("ionrift-respite.downtimeLedger.allSkipped");

            const dayBreakdownLines = rawSchedule.map(d => {
                if (d.mode === "skip") return game.i18n.format("ionrift-respite.downtimeLedger.daySkippedInCamp", { day: d.day });
                const type = d.mode === "hunt" ? game.i18n.localize("ionrift-respite.downtimeBatch.hunt") : game.i18n.localize("ionrift-respite.downtimeBatch.forage");
                if (d.rolled) {
                    const dc = d.mode === "hunt" ? (app._campLogistics._huntDC ?? 14) : (app._campLogistics._forageDC ?? 12);
                    const found = d.detail || (d.success ? game.i18n.localize("ionrift-respite.downtimeLedger.findRecorded") : game.i18n.localize("ionrift-respite.downtimeLedger.nothingFound"));
                    return game.i18n.format("ionrift-respite.downtimeLedger.dayCheckResult", { day: d.day, type, roll: d.rollTotal, dc, found });
                }
                return game.i18n.format("ionrift-respite.downtimeLedger.dayUnrolled", { day: d.day, type });
            });

            const rolledHauls = rawSchedule.filter(entry => entry.rolled && entry.mode !== "skip");
            const haulLines = rolledHauls.map(entry => {
                const kind = entry.mode === "hunt" ? game.i18n.localize("ionrift-respite.downtimeBatch.hunt") : game.i18n.localize("ionrift-respite.downtimeBatch.forage");
                const found = entry.detail || (entry.success ? game.i18n.localize("ionrift-respite.downtimeLedger.findRecorded") : game.i18n.localize("ionrift-respite.downtimeLedger.nothingFound"));
                return game.i18n.format("ionrift-respite.downtimeLedger.haulLine", { day: entry.day, kind, found });
            });
            const findCount = rolledHauls.filter(entry => {
                if (Array.isArray(entry.items) && entry.items.length > 0) return true;
                return Boolean(entry.detail) && entry.success;
            }).length;
            const gatheringSummary = {
                forageCount,
                huntCount,
                skipCount,
                activeCount,
                unrolledCount,
                rolledCount,
                totalYield: charHarvestedRolled,
                isAllRolled,
                hasRolled,
                findCount,
                hasFinds: findCount > 0,
                freshForageNote: rawSchedule.some(entry => GatherYieldService.includesPerishable(entry.items))
                    ? FRESH_FORAGE_NOTE
                    : "",
                label: hasRolled ? (findCount > 0 ? `${findCount} found` : "none found") : configLabel,
                roleClass,
                breakdownTooltip: dayBreakdownLines.join("\n"),
                harvestLines: rawSchedule
                    .filter(entry => entry.rolled && entry.mode !== "skip" && entry.detail)
                    .map(entry => `Day ${entry.day}: ${entry.detail}`),
                reportLine: [
                    forageCount > 0 ? `${forageCount} foraging` : "",
                    huntCount > 0 ? `${huntCount} hunting` : "",
                    skipCount > 0 ? `${skipCount} in camp` : ""
                ].filter(Boolean).join(", "),
                tooltip: bulletTip("Gathering, days 1-6", [
                    `${forageCount} forage (DC ${app._campLogistics._forageDC})`,
                    `${huntCount} hunt (DC ${app._campLogistics._huntDC})`,
                    skipCount > 0 ? `${skipCount} skipped` : "",
                    `Survival ${survivalModFormatted}`,
                    ...haulLines
                ])
            };

            const sustenanceRole = {
                role: rawSchedule.find(d => d.mode !== "skip")?.mode ?? "skip",
                rolled: isAllRolled,
                yield: charHarvestedRolled,
                success: charHarvestedRolled > 0
            };

            // Day 7 Departure Meals (buff food or available plain food)
            const departureFoodOptions = (actor.items ?? []).filter(i => {
                if (ItemClassifier.isSpoiled?.(i)) return false;
                const qty = i.system?.quantity ?? 1;
                if (qty <= 0) return false;
                const flags = i.flags?.[MODULE_ID] ?? {};
                return ItemClassifier.isFood(i, actor) || flags.wellFed || flags.buff || flags.chefTreat;
            }).map(i => {
                const flags = i.flags?.[MODULE_ID] ?? {};
                const satiates = Array.isArray(flags.satiates) ? flags.satiates : [];
                const isDual = satiates.includes("water") || flags.satiatesWater === true;
                const { buffSummary, hasBuff } = describeItemMealBuff(flags);

                const totalQty = i.system?.quantity ?? 1;
                const usedForSustenance = consumedByItem.get(i.id) ?? 0;
                const isSelected = i.id === selectedDepartureMealId;
                const availableQty = isSelected
                    ? Math.max(1, totalQty - usedForSustenance)
                    : Math.max(0, totalQty - usedForSustenance);

                return {
                    id: i.id,
                    name: i.name,
                    img: i.img,
                    quantity: availableQty,
                    buffSummary,
                    hasBuff,
                    isDual,
                    isSelected,
                    ...SpoilageClock.chipFields(i)
                };
            });

            const selectedDepartureMeal = departureFoodOptions.find(f => f.id === selectedDepartureMealId) ?? null;

            // Day 7 Departure Drinks (special beverages or water)
            const selectedDepartureDrinkId = app._departureDrinks.get(actor.id) ?? null;
            const departureDrinkOptions = (actor.items ?? []).filter(i => {
                if (ItemClassifier.isSpoiled?.(i)) return false;
                const qty = i.system?.quantity ?? 1;
                if (qty <= 0) return false;
                return ItemClassifier.isWater(i, actor);
            }).map(i => {
                const flags = i.flags?.[MODULE_ID] ?? {};
                const { buffSummary, hasBuff } = describeItemMealBuff(flags);

                const isSelected = i.id === selectedDepartureDrinkId;
                return {
                    id: i.id,
                    name: i.name,
                    img: i.img,
                    quantity: i.system?.quantity ?? 1,
                    buffSummary,
                    hasBuff,
                    isSelected,
                    ...SpoilageClock.chipFields(i)
                };
            });
            const selectedDepartureDrink = departureDrinkOptions.find(d => d.id === selectedDepartureDrinkId) ?? null;

            // Symmetrical Food & Water Inventory Flows
            const totalPackFoodRations = plainFoodItems.reduce((sum, f) => sum + f.quantity, 0);
            const totalFoodAvailable = totalPackFoodRations + (isSelectedDepartureMeal ? 1 : 0);
            const foodConsumedTotal = totalAutoConsumed + (isSelectedDepartureMeal ? 1 : 0);
            const foodRemainingInPack = Math.max(0, totalFoodAvailable - foodConsumedTotal);

            const foodFlow = {
                consumed: foodConsumedTotal,
                inPack: totalFoodAvailable,
                remaining: foodRemainingInPack,
                shortfallDays: foodShortfallDays,
                isShort: hasStarvationRisk,
                fedDaysCount
            };

            const waterFlow = {
                consumed: totalWaterFulfilled,
                needed: totalWaterUnitsNeeded,
                inPack: totalPackWaterPints,
                remaining: waterPintsRemainingInPack,
                shortfallDays: waterShortfallDays,
                shortfallUnits: waterShortfallUnits,
                isShort: hasDehydrationRisk,
                hydratedDaysCount
            };

            // 7-Day Day-Pip Timeline Breakdown (Illustrated Asset Consumption)
            const esc = s => String(s ?? "").replace(/&/g, "&amp;").replace(/'/g, "&#39;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
            const sanitizeImg = (img, fallback) => {
                if (!img || typeof img !== "string" || img.includes("mystery-man")) return fallback;
                return img;
            };

            const buildSustenanceTooltip = ({ day, type, name, img, icon, detail, buff, isShortfall }) => {
                const iconHtml = img
                    ? `<img class='tooltip-img' src='${esc(img)}' alt='${esc(name)}'>`
                    : `<div class='tooltip-icon-fallback'><i class='${esc(icon || "fas fa-utensils")}'></i></div>`;
                const buffHtml = buff
                    ? `<div class='tooltip-buff'><i class='fas fa-wand-magic-sparkles'></i> ${esc(buff)}</div>`
                    : "";
                const detailClass = isShortfall ? "tooltip-body shortfall" : "tooltip-body";
                return `<div class='sustenance-tooltip'>` +
                    `<div class='tooltip-header'>` +
                    iconHtml +
                    `<div class='tooltip-titles'>` +
                    `<span class='tooltip-day-label'>${game.i18n.format("ionrift-respite.downtimeLedger.tooltipDayType", { day, type: esc(type) })}</span>` +
                    `<strong class='tooltip-item-name'>${esc(name)}</strong>` +
                    `</div></div>` +
                    `<div class='${detailClass}'>${esc(detail)}</div>` +
                    buffHtml +
                    `</div>`;
            };

            // Setup pools for daily food allocation
            const harvestFoodRemaining = 0;
            const harvestImg = (huntCount > 0 && forageCount === 0)
                ? "icons/consumables/meat/meat-chunk-red.webp"
                : "icons/consumables/fruit/berries-cluster-purple.webp";
            const harvestName = (huntCount > 0 && forageCount === 0)
                ? game.i18n.localize("ionrift-respite.downtimeLedger.gatheredGame")
                : ((forageCount > 0 && huntCount === 0) ? game.i18n.localize("ionrift-respite.downtimeLedger.foragedProvisions") : game.i18n.localize("ionrift-respite.downtimeLedger.campHarvest"));

            const packFoodPool = plainFoodItems.map(f => ({
                id: f.id,
                name: f.name,
                img: sanitizeImg(f.img, "icons/consumables/food/bread-loaf-round-white.webp"),
                available: (f.id === selectedDepartureMealId) ? Math.max(0, f.quantity - 1) : f.quantity,
                totalInPack: f.quantity,
                isDual: f.isDual
            }));

            const dailyFoodRecord = [];
            const foodDailyPips = [];

            for (let d = 1; d <= 7; d++) {
                const isDeparture = (d === 7);
                if (isDeparture) {
                    if (haven === "civilized") {
                        const mealName = selectedDepartureMeal ? selectedDepartureMeal.name : game.i18n.localize("ionrift-respite.downtimeLedger.settlementFeast");
                        const mealImg = sanitizeImg(selectedDepartureMeal?.img, "icons/consumables/food/bowl-stew-brown.webp");
                        const buffNote = selectedDepartureMeal?.buffSummary || game.i18n.localize("ionrift-respite.downtimeLedger.lodgingsMealsCoveredDefault");
                        const tooltip = buildSustenanceTooltip({
                            day: d,
                            type: game.i18n.localize("ionrift-respite.downtimeLedger.departureMeal"),
                            name: mealName,
                            img: mealImg,
                            detail: game.i18n.localize("ionrift-respite.downtimeLedger.coveredSettlementLodgings"),
                            buff: selectedDepartureMeal?.buffSummary
                        });
                        foodDailyPips.push({
                            day: d,
                            isFed: true,
                            img: mealImg,
                            name: mealName,
                            icon: "fas fa-utensils",
                            isDeparture: true,
                            tooltip
                        });
                        dailyFoodRecord.push({ isDual: selectedDepartureMeal?.isDual ?? false, name: mealName, img: mealImg });
                    } else if (selectedDepartureMeal) {
                        const mealName = selectedDepartureMeal.name;
                        const mealImg = sanitizeImg(selectedDepartureMeal.img, "icons/consumables/food/bread-loaf-round-white.webp");
                        const tooltip = buildSustenanceTooltip({
                            day: d,
                            type: game.i18n.localize("ionrift-respite.downtimeLedger.departureMeal"),
                            name: mealName,
                            img: mealImg,
                            detail: `Send-off meal before departure${selectedDepartureMeal.isDual ? " (satiates food & water)" : ""}.`,
                            buff: selectedDepartureMeal.buffSummary
                        });
                        foodDailyPips.push({
                            day: d,
                            isFed: true,
                            img: mealImg,
                            name: mealName,
                            icon: selectedDepartureMeal.hasBuff ? "fas fa-wand-magic-sparkles" : "fas fa-bread-slice",
                            isDeparture: true,
                            tooltip
                        });
                        dailyFoodRecord.push({ isDual: selectedDepartureMeal.isDual, name: mealName, img: mealImg });
                    } else {
                        // Day 7 routine food needed
                        let dayUnitsNeeded = fpd;
                        const consumedItems = [];
                        if (harvestFoodRemaining > 0) {
                            const take = Math.min(harvestFoodRemaining, dayUnitsNeeded);
                            harvestFoodRemaining -= take;
                            dayUnitsNeeded -= take;
                            consumedItems.push({ name: harvestName, img: harvestImg, take, isHarvest: true, isDual: false });
                        }
                        for (const item of packFoodPool) {
                            if (dayUnitsNeeded <= 0) break;
                            if (item.available <= 0) continue;
                            const take = Math.min(item.available, dayUnitsNeeded);
                            item.available -= take;
                            dayUnitsNeeded -= take;
                            consumedItems.push({
                                id: item.id,
                                name: item.name,
                                img: item.img,
                                take,
                                isHarvest: false,
                                isDual: item.isDual,
                                remaining: item.available
                            });
                        }
                        const isFed = (dayUnitsNeeded === 0);
                        if (isFed) {
                            const primary = consumedItems[0];
                            const itemImg = primary.img;
                            const itemName = consumedItems.length === 1 ? primary.name : consumedItems.map(c => `${c.take}× ${c.name}`).join(", ");
                            const detail = primary.isHarvest
                                ? `Consumed from camp harvest (+${charHarvestedRolled} rolled).`
                                : `Routine departure ration (${primary.take} used, ${primary.remaining ?? 0} left in pack).`;
                            const tooltip = buildSustenanceTooltip({
                                day: d,
                                type: game.i18n.localize("ionrift-respite.downtimeLedger.departureRation"),
                                name: itemName,
                                img: itemImg,
                                detail
                            });
                            foodDailyPips.push({
                                day: d,
                                isFed: true,
                                img: itemImg,
                                name: itemName,
                                itemId: primary.id ?? null,
                                units: primary.take ?? fpd,
                                editable: !primary.isHarvest && !!primary.id,
                                icon: "fas fa-bread-slice",
                                isDeparture: true,
                                tooltip
                            });
                            dailyFoodRecord.push({ isDual: consumedItems.some(c => c.isDual), name: itemName, img: itemImg });
                        } else {
                            const tooltip = buildSustenanceTooltip({
                                day: d,
                                type: game.i18n.localize("ionrift-respite.downtimeLedger.departure"),
                                name: game.i18n.localize("ionrift-respite.downtimeLedger.starvation"),
                                icon: "fas fa-triangle-exclamation text-rose",
                                detail: game.i18n.localize("ionrift-respite.downtimeLedger.noFoodDepartureSendoff"),
                                isShortfall: true
                            });
                            foodDailyPips.push({
                                day: d,
                                isFed: false,
                                img: null,
                                name: game.i18n.localize("ionrift-respite.downtimeLedger.starvation"),
                                editable: true,
                                icon: "fas fa-times",
                                isDeparture: true,
                                tooltip
                            });
                            dailyFoodRecord.push({ isDual: false, name: "Starvation", img: null });
                        }
                    }
                } else {
                    // Days 1-6
                    if (haven === "civilized") {
                        const mealName = game.i18n.localize("ionrift-respite.downtimeLedger.settlementMeal");
                        const mealImg = "icons/consumables/food/bowl-stew-brown.webp";
                        const tooltip = buildSustenanceTooltip({
                            day: d,
                            type: game.i18n.localize("ionrift-respite.downtimeLedger.sustenance"),
                            name: mealName,
                            img: mealImg,
                            detail: game.i18n.localize("ionrift-respite.downtimeLedger.providedTownLodgings")
                        });
                        foodDailyPips.push({
                            day: d,
                            isFed: true,
                            img: mealImg,
                            name: mealName,
                            icon: "fas fa-bread-slice",
                            isDeparture: false,
                            tooltip
                        });
                        dailyFoodRecord.push({ isDual: false, name: mealName, img: mealImg });
                    } else if (d > days1to6Needed) {
                        // Supplies exempt by GM logistics setting
                        const mealName = game.i18n.localize("ionrift-respite.downtimeLedger.suppliesExempt");
                        const mealImg = "icons/consumables/food/bread-loaf-round-white.webp";
                        const tooltip = buildSustenanceTooltip({
                            day: d,
                            type: game.i18n.localize("ionrift-respite.downtimeLedger.sustenance"),
                            name: mealName,
                            img: mealImg,
                            detail: game.i18n.localize("ionrift-respite.downtimeLedger.noCampProvisionsRequired")
                        });
                        foodDailyPips.push({
                            day: d,
                            isFed: true,
                            img: mealImg,
                            name: mealName,
                            icon: "fas fa-check",
                            isDeparture: false,
                            tooltip
                        });
                        dailyFoodRecord.push({ isDual: false, name: mealName, img: mealImg });
                    } else {
                        let dayUnitsNeeded = fpd;
                        const consumedItems = [];
                        if (harvestFoodRemaining > 0) {
                            const take = Math.min(harvestFoodRemaining, dayUnitsNeeded);
                            harvestFoodRemaining -= take;
                            dayUnitsNeeded -= take;
                            consumedItems.push({ name: harvestName, img: harvestImg, take, isHarvest: true, isDual: false });
                        }
                        for (const item of packFoodPool) {
                            if (dayUnitsNeeded <= 0) break;
                            if (item.available <= 0) continue;
                            const take = Math.min(item.available, dayUnitsNeeded);
                            item.available -= take;
                            dayUnitsNeeded -= take;
                            consumedItems.push({
                                id: item.id,
                                name: item.name,
                                img: item.img,
                                take,
                                isHarvest: false,
                                isDual: item.isDual,
                                remaining: item.available
                            });
                        }
                        const isFed = (dayUnitsNeeded === 0);
                        if (isFed) {
                            const primary = consumedItems[0];
                            const itemImg = primary.img;
                            const itemName = consumedItems.length === 1 ? primary.name : consumedItems.map(c => `${c.take}× ${c.name}`).join(", ");
                            const dualTag = primary.isDual ? " (satiates food & water)" : "";
                            const detail = (primary.isHarvest
                                ? `Harvested camp provisions (${primary.take} used).`
                                : `Pack provisions (${primary.take} used, ${primary.remaining ?? 0} left in pack).`) + dualTag;
                            const tooltip = buildSustenanceTooltip({
                                day: d,
                                type: game.i18n.localize("ionrift-respite.downtimeLedger.sustenance"),
                                name: itemName,
                                img: itemImg,
                                detail
                            });
                            foodDailyPips.push({
                                day: d,
                                isFed: true,
                                img: itemImg,
                                name: itemName,
                                itemId: primary.id ?? null,
                                units: primary.take ?? fpd,
                                editable: !primary.isHarvest && !!primary.id,
                                icon: "fas fa-bread-slice",
                                isDeparture: false,
                                tooltip
                            });
                            dailyFoodRecord.push({ isDual: consumedItems.some(c => c.isDual), name: itemName, img: itemImg });
                        } else {
                            const tooltip = buildSustenanceTooltip({
                                day: d,
                                type: game.i18n.localize("ionrift-respite.downtimeLedger.sustenance"),
                                name: game.i18n.localize("ionrift-respite.downtimeLedger.starvation"),
                                icon: "fas fa-triangle-exclamation text-rose",
                                detail: game.i18n.localize("ionrift-respite.downtimeLedger.noFoodInPackOrHarvest"),
                                isShortfall: true
                            });
                            foodDailyPips.push({
                                day: d,
                                isFed: false,
                                img: null,
                                name: game.i18n.localize("ionrift-respite.downtimeLedger.starvation"),
                                editable: true,
                                icon: "fas fa-times",
                                isDeparture: false,
                                tooltip
                            });
                            dailyFoodRecord.push({ isDual: false, name: "Starvation", img: null });
                        }
                    }
                }
            }
    return {
        isOwner,
        budget,
        isDrilledDown,
        identifyDays,
        focusBudget,
        focusCount,
        focusRemaining,
        isIdentifyOpen,
        workbenchEmbed,
        personalCard,
        selectedDepartureMealId,
        terrainMealRules,
        fpd,
        wpd,
        climateLabel,
        climateTooltip,
        isTraitPill,
        rawSchedule,
        charHarvestedRolled,
        totalAutoConsumed,
        totalNominatedRationsDelta,
        foodShortfallDays,
        hasStarvationRisk,
        fedDaysCount,
        totalDaysWaterNeeded,
        totalWaterUnitsNeeded,
        waterOptions,
        totalWaterFulfilled,
        waterShortfallUnits,
        waterShortfallDays,
        hasDehydrationRisk,
        hydratedDaysCount,
        waterPintsRemainingInPack,
        autoFoodSummary,
        autoFoodTooltip,
        autoWaterSummary,
        autoWaterTooltip,
        daysToFeed,
        survivalModFormatted,
        gatheringSchedule,
        gatheringSummary,
        sustenanceRole,
        departureFoodOptions,
        selectedDepartureMeal,
        selectedDepartureDrinkId,
        departureDrinkOptions,
        selectedDepartureDrink,
        totalFoodAvailable,
        foodConsumedTotal,
        foodRemainingInPack,
        foodFlow,
        waterFlow,
        sanitizeImg,
        buildSustenanceTooltip,
        dailyFoodRecord,
        foodDailyPips,
        day7RoutineFoodNeeded
    };
}
