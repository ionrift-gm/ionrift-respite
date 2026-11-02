import { MODULE_ID } from "../../data/moduleId.js";
import { ActivityRegistry } from "../../data/downtime/ActivityRegistry.js";
import { buildSkillCheckSummary } from "../../services/downtime/DowntimeSkillCheck.js";
import { craftPlanNeedsEscape } from "../../services/downtime/craftPlanEscape.js";
import { applySustenancePlan, clonePours } from "../../services/meal/phase/SustenanceEditPlan.js";
import { bulletTip, buildSustenanceDiegetic } from "./DowntimeSustenanceBuilder.js";

export function buildCharacterRollAndStatusContext(app, actor, { haven, isCivilized, scanResult, workbenchIdentifyUiEnabled }, sus) {
    let {
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
        fpd,
        wpd,
        climateLabel,
        climateTooltip,
        isTraitPill,
        totalAutoConsumed,
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
        foodConsumedTotal,
        foodRemainingInPack,
        foodFlow,
        waterFlow,
        sanitizeImg,
        buildSustenanceTooltip,
        dailyFoodRecord,
        foodDailyPips,
        day7RoutineFoodNeeded
    } = sus;
            // Setup pools for daily water allocation
            const packWaterPool = waterOptions.map(opt => ({
                id: opt.itemId,
                name: opt.name,
                img: sanitizeImg(opt.icon, "icons/tools/instruments/waterskin.webp"),
                availablePints: (opt.itemId === selectedDepartureDrinkId) ? Math.max(0, opt.totalPints - 1) : opt.totalPints,
                totalInPack: opt.totalPints
            }));

            const waterDailyPips = [];

            for (let d = 1; d <= 7; d++) {
                const isDeparture = (d === 7);
                if (haven === "civilized") {
                    const drinkName = isDeparture && selectedDepartureDrink ? selectedDepartureDrink.name : game.i18n.localize("ionrift-respite.downtimeLedger.tavernAleWater");
                    const drinkImg = isDeparture && selectedDepartureDrink ? sanitizeImg(selectedDepartureDrink.img, "icons/consumables/drinks/pitcher-stoneware-white.webp") : "icons/consumables/drinks/pitcher-stoneware-white.webp";
                    const buffNote = isDeparture && selectedDepartureDrink?.buffSummary ? selectedDepartureDrink.buffSummary : game.i18n.localize("ionrift-respite.downtimeLedger.cleanWaterBeverages");
                    const tooltip = buildSustenanceTooltip({
                        day: d,
                        type: isDeparture ? game.i18n.localize("ionrift-respite.downtimeLedger.departureDrink") : game.i18n.localize("ionrift-respite.downtimeLedger.hydration"),
                        name: drinkName,
                        img: drinkImg,
                        detail: `${buffNote}.`
                    });
                    waterDailyPips.push({
                        day: d,
                        isHydrated: true,
                        img: drinkImg,
                        name: drinkName,
                        icon: "fas fa-droplet",
                        isDeparture,
                        tooltip
                    });
                } else if (d > totalDaysWaterNeeded && !isDeparture) {
                    const drinkName = game.i18n.localize("ionrift-respite.downtimeLedger.hydrationExempt");
                    const drinkImg = "icons/magic/water/water-drop-swirl-blue.webp";
                    const tooltip = buildSustenanceTooltip({
                        day: d,
                        type: game.i18n.localize("ionrift-respite.downtimeLedger.hydration"),
                        name: drinkName,
                        img: drinkImg,
                        detail: game.i18n.localize("ionrift-respite.downtimeLedger.noWaterRequired")
                    });
                    waterDailyPips.push({
                        day: d,
                        isHydrated: true,
                        img: drinkImg,
                        name: drinkName,
                        icon: "fas fa-check",
                        isDeparture,
                        tooltip
                    });
                } else {
                    const foodOfThisDay = dailyFoodRecord[d - 1];
                    let unitsNeeded = wpd;
                    const waterSourcesUsed = [];

                    // 1. Dual-satiating food credit
                    if (foodOfThisDay?.isDual && unitsNeeded > 0) {
                        unitsNeeded -= 1;
                        waterSourcesUsed.push({
                            name: game.i18n.format("ionrift-respite.downtimeLedger.foodMoisture", { name: foodOfThisDay.name }),
                            img: foodOfThisDay.img || "icons/consumables/fruit/berries-cluster-purple.webp",
                            pints: 1,
                            isDualFood: true
                        });
                    }

                    // 2. Day 7 departure drink credit
                    if (isDeparture && selectedDepartureDrink && unitsNeeded > 0) {
                        unitsNeeded -= 1;
                        waterSourcesUsed.push({
                            name: selectedDepartureDrink.name,
                            img: sanitizeImg(selectedDepartureDrink.img, "icons/magic/water/water-drop-swirl-blue.webp"),
                            pints: 1,
                            isDepartureDrink: true,
                            buff: selectedDepartureDrink.buffSummary
                        });
                    }

                    // 3. Pack water sources
                    for (const source of packWaterPool) {
                        if (unitsNeeded <= 0) break;
                        if (source.availablePints <= 0) continue;
                        const take = Math.min(source.availablePints, unitsNeeded);
                        source.availablePints -= take;
                        unitsNeeded -= take;
                        waterSourcesUsed.push({
                            itemId: source.id,
                            name: source.name,
                            img: source.img,
                            pints: take,
                            remaining: source.availablePints
                        });
                    }

                    const isHydrated = (unitsNeeded === 0);
                    if (isHydrated) {
                        const primary = waterSourcesUsed[0];
                        const itemImg = primary ? primary.img : "icons/tools/instruments/waterskin.webp";
                        const itemName = waterSourcesUsed.length === 1 ? primary.name : waterSourcesUsed.map(s => `${s.pints}u ${s.name}`).join(" + ");
                        let detail = "";
                        if (primary?.isDepartureDrink) {
                            detail = `Departure beverage${primary.buff ? ` (${primary.buff})` : ""}.`;
                        } else if (primary?.isDualFood) {
                            detail = `Hydrated by moisture from ${primary.name}.`;
                        } else if (primary) {
                            detail = `${primary.pints} units consumed (${primary.remaining ?? 0} left in pack).`;
                        } else {
                            detail = "Hydrated.";
                        }
                        const tooltip = buildSustenanceTooltip({
                            day: d,
                            type: isDeparture ? game.i18n.localize("ionrift-respite.downtimeLedger.departureDrink") : game.i18n.localize("ionrift-respite.downtimeLedger.hydration"),
                            name: itemName,
                            img: itemImg,
                            detail,
                            buff: isDeparture ? selectedDepartureDrink?.buffSummary : null
                        });
                        waterDailyPips.push({
                            day: d,
                            isHydrated: true,
                            img: itemImg,
                            name: itemName,
                            icon: isDeparture ? (selectedDepartureDrink?.hasBuff ? "fas fa-wine-glass" : "fas fa-droplet") : "fas fa-droplet",
                            isDeparture,
                            tooltip,
                            pours: waterSourcesUsed.map(source => ({
                                itemId: source.itemId ?? null,
                                name: source.name,
                                img: source.img ?? null,
                                pints: source.pints
                            })),
                            need: wpd,
                            editable: waterSourcesUsed.some(source => source.itemId)
                        });
                    } else {
                        const tooltip = buildSustenanceTooltip({
                            day: d,
                            type: isDeparture ? game.i18n.localize("ionrift-respite.downtimeLedger.departureDrink") : game.i18n.localize("ionrift-respite.downtimeLedger.hydration"),
                            name: game.i18n.localize("ionrift-respite.downtimeLedger.dehydration"),
                            icon: "fas fa-droplet-slash text-rose",
                            detail: game.i18n.localize("ionrift-respite.downtimeLedger.noWaterAvailable"),
                            isShortfall: true
                        });
                        waterDailyPips.push({
                            day: d,
                            isHydrated: false,
                            img: null,
                            name: game.i18n.localize("ionrift-respite.downtimeLedger.dehydration"),
                            icon: "fas fa-times",
                            isDeparture,
                            tooltip,
                            pours: waterSourcesUsed.map(source => ({
                                itemId: source.itemId ?? null,
                                name: source.name,
                                img: source.img ?? null,
                                pints: source.pints
                            })),
                            need: wpd,
                            editable: true
                        });
                    }
                }
            }

            const sustenancePlan = app._sustenanceEdits.get(actor.id) ?? null;
            const edited = applySustenancePlan(sustenancePlan, foodDailyPips, waterDailyPips, departureFoodOptions);
            foodShortfallDays = edited.foodShort;
            waterShortfallDays = edited.waterShort;
            hasStarvationRisk = haven === "wilderness" && foodShortfallDays > 0;
            hasDehydrationRisk = haven === "wilderness" && waterShortfallDays > 0;
            foodFlow.shortfallDays = foodShortfallDays;
            foodFlow.isShort = hasStarvationRisk;
            foodFlow.fedDaysCount = haven === "civilized" ? 7 : Math.max(0, 7 - foodShortfallDays);
            waterFlow.shortfallDays = waterShortfallDays;
            waterFlow.isShort = hasDehydrationRisk;
            waterFlow.hydratedDaysCount = haven === "civilized" ? 7 : Math.max(0, 7 - waterShortfallDays);
            app._sustenanceSnapshot.set(actor.id, {
                food: foodDailyPips.map(pip => ({
                    empty: !pip.isFed || !!pip.isCleared,
                    editable: !!pip.editable,
                    itemId: pip.itemId ?? null,
                    units: pip.units || fpd || 1
                })),
                water: waterDailyPips.map(pip => ({
                    editable: !!pip.editable,
                    need: pip.need ?? wpd,
                    pours: clonePours(pip.pours)
                }))
            });

            // Sustenance breakdown drawer auto-opens on the Sustenance
            // workflow step so the mock's diegetic 7-day pile / vessel is
            // visible by default (mock: rest-dock-gritty sustenance).
            const isSustenanceDrawerOpen = (app._selectedWorkflowStep === "sustenance")
                || (app._expandedTiers.get(actor.id)?.has("sustenance") ?? false);
            const foodTooltip = hasStarvationRisk
                ? bulletTip("Food short", [
                    `${foodShortfallDays} days with nothing to eat`,
                    "Risks exhaustion"
                ])
                : bulletTip("Food", [
                    `${foodConsumedTotal} used`,
                    `${foodRemainingInPack} left in the pack`
                ]);

            let day7Subtext = isCivilized ? game.i18n.localize("ionrift-respite.downtimeLedger.coveredByLodgings") : game.i18n.localize("ionrift-respite.downtimeLedger.standardCampSustenance");
            let day7SubtextClass = "neutral";
            if (selectedDepartureMeal?.hasBuff) {
                day7Subtext = selectedDepartureMeal.buffSummary;
                day7SubtextClass = "meal-buff";
            } else if (hasDehydrationRisk) {
                day7Subtext = game.i18n.format("ionrift-respite.downtimeLedger.dehydrationShortDays", { days: waterShortfallDays });
                day7SubtextClass = "fail";
            } else if (hasStarvationRisk && day7RoutineFoodNeeded > 0) {
                day7Subtext = game.i18n.format("ionrift-respite.downtimeLedger.starvationShortDays", { days: foodShortfallDays });
                day7SubtextClass = "fail";
            }

            // Station activity roll states & fortify summary
            const activityRolls = app._getOrCreateActivityRolls(actor.id);
            const isCommitted = app._committedActorIds.has(actor.id);
            let rollableDaysCount = 0;
            let rolledDaysCount = 0;
            let skillCheckDaysCount = 0;
            let skillCheckRolledCount = 0;
            let skillCheckSuccessCount = 0;
            let fletchYieldTotal = 0;
            const skillLabels = [];
            let skillActDef = null;
            let fortifyAssignedDays = 0;
            let fortifyRolledCount = 0;
            let fortifySuccessCount = 0;
            let fortifyFailCount = 0;
            let craftDaysCount = 0;
            let craftResolvedCount = 0;

            const augmentedSegments = budget.segments.map(seg => {
                const dayNum = seg.dayNumber;
                const actDef = seg.filled ? ActivityRegistry.getActivity(seg.activityId) : null;
                const checkDef = actDef?.check ?? null;
                const isCraft = seg.filled && ["cook", "brew", "craft"].includes(seg.activityId);
                const isRollable = !!checkDef || isCraft;
                const roll = activityRolls.find(r => r.day === dayNum);

                let rollStatus = "none";
                if (isCraft) {
                    craftDaysCount++;
                    if (roll && roll.rolled) {
                        craftResolvedCount++;
                        rollStatus = roll.success ? "pass" : "fail";
                    } else {
                        rollStatus = "pending";
                    }
                } else if (isRollable) {
                    rollableDaysCount++;
                    if (roll && roll.rolled) {
                        rolledDaysCount++;
                        rollStatus = roll.success ? "pass" : "fail";
                    } else {
                        rollStatus = "pending";
                    }

                    if (seg.activityId === "fortify") {
                        fortifyAssignedDays++;
                        if (roll && roll.rolled) {
                            fortifyRolledCount++;
                            if (roll.success) fortifySuccessCount++;
                            else fortifyFailCount++;
                        }
                    } else {
                        skillCheckDaysCount++;
                        if (actDef?.label && !skillLabels.includes(actDef.label)) skillLabels.push(actDef.label);
                        if (!skillActDef) skillActDef = actDef;
                        if (roll?.rolled) {
                            skillCheckRolledCount++;
                            if (roll.success) skillCheckSuccessCount++;
                        }
                        if (seg.activityId === "fletch" && roll?.yieldQty) {
                            fletchYieldTotal += Number(roll.yieldQty) || 0;
                        }
                    }
                }

                let pipTooltip = `Day ${dayNum}: ${seg.label}`;
                if (isCraft) {
                    if (roll && roll.rolled) {
                        pipTooltip += ` · ${roll.success ? game.i18n.localize("ionrift-respite.downtimeLedger.resolvedSuccess") : game.i18n.localize("ionrift-respite.downtimeLedger.resolvedFailed")}`;
                        if (app._isGM) pipTooltip += ` · ${game.i18n.localize("ionrift-respite.downtimeLedger.clickToReroll")}`;
                    } else if (isCommitted || app._isGM) {
                        pipTooltip += ` · ${game.i18n.localize("ionrift-respite.downtimeLedger.unresolvedCraftClick")}`;
                    } else {
                        pipTooltip += ` · ${game.i18n.localize("ionrift-respite.downtimeLedger.unresolvedCraftLockIn")}`;
                    }
                } else if (isRollable) {
                    if (roll && roll.rolled) {
                        pipTooltip += ` · ${roll.success ? game.i18n.format("ionrift-respite.downtimeLedger.checkResultHeld", { total: roll.rollTotal, dc: roll.dc ?? checkDef.dc }) : game.i18n.format("ionrift-respite.downtimeLedger.checkResultFailed", { total: roll.rollTotal, dc: roll.dc ?? checkDef.dc })}`;
                        if (app._isGM) pipTooltip += ` · ${game.i18n.localize("ionrift-respite.downtimeLedger.clickToReroll")}`;
                    } else if (isCommitted || app._isGM) {
                        pipTooltip += ` · ${game.i18n.format("ionrift-respite.downtimeLedger.unrolledClickToRoll", { dc: checkDef.dc })}`;
                    } else {
                        pipTooltip += ` · ${game.i18n.format("ionrift-respite.downtimeLedger.unrolledLockInToRoll", { dc: checkDef.dc })}`;
                    }
                }

                const canRollPip = isRollable && (isCommitted || app._isGM);

                return {
                    ...seg,
                    isRollable,
                    canRollPip,
                    rollStatus,
                    rollTotal: roll?.rollTotal ?? null,
                    dc: roll?.dc ?? checkDef?.dc ?? (isCraft ? 12 : null),
                    rollSuccess: roll?.success ?? null,
                    pipTooltip
                };
            });
            budget.segments = augmentedSegments;
            budget.activeActivities = budget.activities.filter(a => a.isActive);

            // Build flat 7-day slot array for the activities day strip
            const activityDaySlots = [];
            for (const act of budget.activeActivities) {
                for (let i = 0; i < act.assignedDays; i++) {
                    activityDaySlots.push({ day: activityDaySlots.length + 1, label: act.label, icon: act.icon, hint: act.hint ?? "" });
                }
            }
            while (activityDaySlots.length < 7) {
                const d = activityDaySlots.length + 1;
                activityDaySlots.push({ day: d, label: game.i18n.localize("ionrift-respite.downtimeLedger.openDay"), icon: "fas fa-question", hint: game.i18n.localize("ionrift-respite.downtimeLedger.unallocatedDay"), isEmpty: true });
            }

            const hasFortify = fortifyAssignedDays > 0;
            const fortifySummary = hasFortify ? {
                assignedDays: fortifyAssignedDays,
                rolledCount: fortifyRolledCount,
                unrolledCount: fortifyAssignedDays - fortifyRolledCount,
                successCount: fortifySuccessCount,
                failCount: fortifyFailCount,
                isAllRolled: fortifyRolledCount === fortifyAssignedDays,
                hasUnrolled: fortifyRolledCount < fortifyAssignedDays,
                allSuccess: fortifyRolledCount > 0 && fortifyFailCount === 0,
                hasSuccess: fortifySuccessCount > 0,
                resultLabel: fortifySuccessCount > 0
                    ? `${fortifySuccessCount}/${fortifyAssignedDays} Fortified`
                    : `0/${fortifyAssignedDays} Fortified`,
                resultClass: fortifySuccessCount > 0 ? "pass" : "neutral",
                resultIcon: "fas fa-shield-alt",
                statusText: fortifyRolledCount === 0
                    ? `${fortifyAssignedDays}d Unrolled`
                    : `${fortifySuccessCount}/${fortifyAssignedDays} Fortified`,
                tooltip: game.i18n.format("ionrift-respite.downtimeLedger.fortifyDefensesTooltip", { succeeded: fortifySuccessCount, assigned: fortifyAssignedDays, dcReduction: fortifySuccessCount * 2 })
            } : null;

            const hasCraftingActivities = craftDaysCount > 0;
            const craftDaysRemaining = Math.max(0, craftDaysCount - craftResolvedCount);
            const isAllCraftsResolved = hasCraftingActivities ? (craftResolvedCount === craftDaysCount) : true;

            const hasDefenseRolls = fortifyAssignedDays > 0;
            const skillCheckSummary = buildSkillCheckSummary({
                dayCount: skillCheckDaysCount,
                rolledCount: skillCheckRolledCount,
                successCount: skillCheckSuccessCount,
                labels: skillLabels,
                actDef: skillActDef,
                fletchYield: fletchYieldTotal
            });
            const hasSkillChecks = !!skillCheckSummary;
            const hasRollableActivities = rollableDaysCount > 0;
            const isAllActivitiesRolled = hasRollableActivities ? (rolledDaysCount === rollableDaysCount) : true;

            if (!app._isGM) {
                for (const act of budget.activities ?? []) {
                    const rolled = activityRolls.filter(r => r.activityId === act.id && r.rolled).length;
                    act.canStepDown = act.assignedDays > rolled;
                    act.canClear = rolled === 0;
                }
            } else {
                for (const act of budget.activities ?? []) {
                    act.canClear = true;
                }
            }

            const canChangeCraftPlan = !app._isGM
                && !!actor.isOwner
                && isCommitted
                && craftPlanNeedsEscape(activityRolls, app._craftAvailableCounts(actor, activityRolls));

            let trackFoodSetting = true;
            try { trackFoodSetting = !!game.settings.get(MODULE_ID, "trackFood"); } catch { /* ignore */ }
            const sustenanceRequired = (haven === "wilderness") && trackFoodSetting;
            const isAllocated = budget.isComplete;
            const isStarving = sustenanceRequired && (foodShortfallDays > 0);
            const isDehydrated = sustenanceRequired && (waterShortfallDays > 0);
            const isSustenanceRisk = isStarving || isDehydrated;
            const isDefensePending = hasDefenseRolls && !!fortifySummary && !fortifySummary.isAllRolled;
            const isSkillCheckPending = hasSkillChecks && !skillCheckSummary.isAllRolled;
            const isCraftPending = hasCraftingActivities && !isAllCraftsResolved;
            const isGatheringPending = (haven === "wilderness") && gatheringSummary && !gatheringSummary.isAllRolled;

            const isPendingRolls = isDefensePending || isSkillCheckPending || isCraftPending || isGatheringPending;
            const mealsLocked = !sustenanceRequired || app._mealsLockedActorIds.has(actor.id);
            const planSettled = isAllocated && isCommitted && mealsLocked && !isPendingRolls;
            const isReady = planSettled && !isSustenanceRisk;
            const isAtRisk = planSettled && isSustenanceRisk;
            const isPending = !isReady && !isAtRisk;

            let statusState = "pending";
            let statusLabel = `${budget.unallocatedDays}d left`;
            let statusIcon = "fas fa-clock";
            let statusTooltip = `${budget.unallocatedDays} days left to plan`;

            if (!isAllocated) {
                statusState = "pending";
                statusLabel = `${budget.unallocatedDays}d left`;
                statusIcon = "fas fa-clock";
                statusTooltip = `${budget.unallocatedDays} days left to plan`;
            } else if (!isCommitted) {
                statusState = "pending";
                statusLabel = "Drafting";
                statusIcon = "fas fa-pencil";
                statusTooltip = "All days planned: waiting to lock in";
            } else if (isCraftPending) {
                statusState = "pending";
                const hasCook = budget.segments.some(s => s.filled && s.activityId === "cook");
                const hasBrew = budget.segments.some(s => s.filled && s.activityId === "brew");
                let craftPrefix = "Craft";
                if (hasCook && !hasBrew) craftPrefix = "Cook";
                else if (hasBrew && !hasCook) craftPrefix = "Brew";
                statusLabel = `${craftPrefix} (${craftDaysRemaining}d)`;
                statusIcon = hasCook ? "fas fa-utensils" : (hasBrew ? "fas fa-flask-vial" : "fas fa-tools");
                statusTooltip = `Crafting rolls pending (${craftDaysRemaining}d remaining)`;
            } else if (isSkillCheckPending) {
                statusState = "pending";
                statusLabel = `${skillCheckSummary.statusName} (${skillCheckSummary.unrolledCount}d)`;
                statusIcon = "fas fa-dice-d20";
                statusTooltip = skillCheckSummary.tooltip;
            } else if (isDefensePending) {
                statusState = "pending";
                const unrolledDef = fortifySummary?.unrolledCount ?? (rollableDaysCount - rolledDaysCount);
                statusLabel = `Defenses (${unrolledDef}d)`;
                statusIcon = "fas fa-shield-halved";
                statusTooltip = `Camp defense rolls pending (${unrolledDef} remaining)`;
            } else if (isGatheringPending) {
                statusState = "pending";
                statusLabel = "Roll Gathering";
                statusIcon = "fas fa-seedling";
                statusTooltip = `Gathering rolls pending (${gatheringSummary.rolledCount}/6 rolled)`;
            } else if (!mealsLocked) {
                statusState = "pending";
                statusLabel = "Meals open";
                statusIcon = "fas fa-utensils";
                statusTooltip = "Food and water are still a draft";
            } else if (isDehydrated && isStarving) {
                statusState = "at-risk";
                statusLabel = `Short (${Math.max(waterShortfallDays, foodShortfallDays)}d)`;
                statusIcon = "fas fa-triangle-exclamation";
                statusTooltip = bulletTip("Short", [
                    `${waterShortfallDays} days of water`,
                    `${foodShortfallDays} days of food`,
                    "Risks exhaustion"
                ]);
            } else if (isDehydrated) {
                statusState = "at-risk";
                statusLabel = `Dehydrated (${waterShortfallDays}d)`;
                statusIcon = "fas fa-droplet-slash";
                statusTooltip = `Short ${waterShortfallDays} days of water (risks exhaustion)`;
            } else if (isStarving) {
                statusState = "at-risk";
                statusLabel = `Starving (${foodShortfallDays}d)`;
                statusIcon = "fas fa-triangle-exclamation";
                statusTooltip = `Short ${foodShortfallDays} days of food (risks exhaustion)`;
            } else if (isReady) {
                statusState = "ready";
                statusLabel = "Ready";
                statusIcon = "fas fa-check-circle";
                statusTooltip = "Locked in and ready";
            }

            return {
                id: actor.id,
                name: actor.name,
                img: actor.img,
                isGM: app._isGM,
                canInteract: isOwner,
                isDrilledDown,
                isCommitted,
                canChangeCraftPlan,
                budget,
                survivalModFormatted,
                forageDC: app._campLogistics._forageDC ?? 12,
                huntDC: app._campLogistics._huntDC ?? 14,
                gatheringSchedule,
                gatheringSummary,
                showGatheringSchedule: app._expandedTiers.get(actor.id)?.has("gathering") ?? false,
                isActivitiesExpanded: app._expandedTiers.get(actor.id)?.has("activities") ?? false,
                activeActivities: budget.activeActivities,
                activityDaySlots,
                sustenanceRole,
                hasRollableActivities,
                hasDefenseRolls,
                hasSkillChecks,
                skillCheckSummary,
                isAllActivitiesRolled,
                hasCraftingActivities,
                craftDaysCount,
                craftResolvedCount,
                craftDaysRemaining,
                isAllCraftsResolved,
                fortifySummary,
                climateLabel,
                climateTooltip,
                isTraitPill,
                sustenanceDiegetic: buildSustenanceDiegetic({
                    actorId: actor.id,
                    foodFlow,
                    waterFlow,
                    foodDailyPips,
                    waterDailyPips,
                    selectedDepartureMeal,
                    selectedDepartureDrink,
                    departureFoodOptions,
                    departureDrinkOptions,
                    climateLabel,
                    climateTooltip,
                    isTraitPill,
                    waterNeedPerDay: wpd ?? 2,
                    mealsLocked,
                    canUnlock: isOwner || app._isGM
                }),
                foodFlow,
                waterFlow,
                foodDailyPips,
                waterDailyPips,
                foodTooltip,
                isSustenanceDrawerOpen,
                autoFoodSummary,
                autoFoodTooltip,
                autoWaterSummary,
                autoWaterTooltip,
                totalAutoConsumed,
                foodShortfall: foodShortfallDays,
                foodShortfallDays,
                hasStarvationRisk,
                totalWaterFulfilled,
                totalWaterUnitsNeeded,
                waterShortfallUnits,
                waterShortfallDays,
                hasDehydrationRisk,
                hydratedDaysCount,
                waterPintsRemainingInPack,
                tier1Done: isCommitted && isAllActivitiesRolled && isAllCraftsResolved,
                tier2Done: (haven === "civilized") || (gatheringSummary ? gatheringSummary.isAllRolled : true),
                tier3Done: mealsLocked,
                mealsLocked,
                isFullySubmitted: isReady,
                isAllocated,
                isReady,
                isAtRisk,
                isPending,
                statusState,
                statusLabel,
                statusIcon,
                statusTooltip,
                daysToFeed,
                fedDaysCount,
                isWilderness: haven === "wilderness",
                isCivilized: haven === "civilized",
                day7Subtext,
                day7SubtextClass,
                departureFoodOptions,
                selectedDepartureMeal,
                selectedDepartureMealId,
                departureDrinkOptions,
                selectedDepartureDrink,
                selectedDepartureDrinkId,
                forageDC: app._campLogistics._forageDC,
                huntDC: app._campLogistics._huntDC,
                personalComfort: personalCard.personalComfort,
                personalComfortLabel: personalCard.personalComfortLabel,
                hasBedroll: personalCard.hasBedroll,
                hasTent: personalCard.hasTent,
                hasMessKit: personalCard.hasMessKit,
                bedrollWaived: !!personalCard.bedrollWaived,
                tentWaived: !!personalCard.tentWaived,
                messKitWaived: !!personalCard.messKitWaived,
                recovery: personalCard.recovery,
                personalMatchesCamp: personalCard.personalComfort === scanResult.campComfort,
                headerTooltip: bulletTip(actor.name, [
                    `${personalCard.personalComfortLabel} rest`,
                    personalCard.hasBedroll ? (personalCard.bedrollWaived ? game.i18n.localize("ionrift-respite.downtimeLedger.bedrollWaivedPill") : game.i18n.localize("ionrift-respite.downtimeLedger.bedrollNormalPill")) : game.i18n.localize("ionrift-respite.downtimeLedger.noBedroll"),
                    personalCard.hasMessKit ? (personalCard.messKitWaived ? game.i18n.localize("ionrift-respite.downtimeLedger.messKitWaivedPill") : game.i18n.localize("ionrift-respite.downtimeLedger.messKitNormalPill")) : "",
                    personalCard.recovery?.hdLabel
                ]),
                bedrollTooltip: personalCard.hasBedroll
                    ? bulletTip(personalCard.bedrollWaived ? game.i18n.localize("ionrift-respite.downtimeLedger.bedrollWaivedTitle") : game.i18n.localize("ionrift-respite.downtimeLedger.bedrollNormalTitle"), [game.i18n.localize("ionrift-respite.downtimeLedger.plusOnePersonalComfort"), game.i18n.localize("ionrift-respite.downtimeLedger.protectsHitDice"), personalCard.bedrollWaived ? game.i18n.localize("ionrift-respite.downtimeLedger.factorWaivedByGM") : game.i18n.localize("ionrift-respite.downtimeLedger.clearsExhaustionSave")])
                    : bulletTip(game.i18n.localize("ionrift-respite.downtimeLedger.noBedroll"), [game.i18n.localize("ionrift-respite.downtimeLedger.restingAtCampComfort")]),
                tentTooltip: personalCard.hasTent
                    ? bulletTip(personalCard.tentWaived ? game.i18n.localize("ionrift-respite.downtimeLedger.tentWaivedTitle") : game.i18n.localize("ionrift-respite.downtimeLedger.tentNormalTitle"), [game.i18n.localize("ionrift-respite.downtimeLedger.shieldsWeatherPenalties"), game.i18n.localize("ionrift-respite.downtimeLedger.lowersEncounterRisk"), ...(personalCard.tentWaived ? [game.i18n.localize("ionrift-respite.downtimeLedger.factorWaivedByGM")] : [])])
                    : bulletTip(game.i18n.localize("ionrift-respite.downtimeLedger.noTent"), [game.i18n.localize("ionrift-respite.downtimeLedger.exposedToWeather")]),
                messKitTooltip: personalCard.hasMessKit
                    ? bulletTip(personalCard.messKitWaived ? game.i18n.localize("ionrift-respite.downtimeLedger.messKitWaivedTitle") : game.i18n.localize("ionrift-respite.downtimeLedger.messKitNormalTitle"), [game.i18n.localize("ionrift-respite.downtimeLedger.advantageOnExhaustionSaves"), ...(personalCard.messKitWaived ? [game.i18n.localize("ionrift-respite.downtimeLedger.factorWaivedByGM")] : [])])
                    : game.i18n.localize("ionrift-respite.downtimeLedger.noMessKitExhaustionNormal"),
                recoveryTooltip: bulletTip(game.i18n.localize("ionrift-respite.downtimeLedger.recoveryTitle"), [
                    personalCard.recovery?.hdLabel,
                    personalCard.recovery?.exhaustionDC
                        ? game.i18n.format("ionrift-respite.downtimeLedger.conSaveDcOrExhaustion", { dc: personalCard.recovery.exhaustionDC })
                        : game.i18n.localize("ionrift-respite.downtimeLedger.noExhaustionRisk")
                ]),
                identifyDays,
                focusBudget,
                focusCount,
                focusRemaining,
                isIdentifyOpen,
                workbenchEmbed,
                workbenchIdentifyUiEnabled
            };
}
