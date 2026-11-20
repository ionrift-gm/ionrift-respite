import { MODULE_ID } from "../../data/moduleId.js";
import { CampLogisticsDelegate, fireEncounterDcNudge } from "../delegates/camp/CampLogisticsDelegate.js";
import { ImageResolver } from "../../utils/ImageResolver.js";
import { RestPresentationHelper } from "../../utils/RestPresentationHelper.js";
import { RestDockContext } from "../../utils/RestDockContext.js";
import { combineNightDc } from "../../services/rest/gritty/EncounterDraftService.js";
import { holdsForSendoff } from "../../services/rest/gritty/SendoffBuffBeat.js";
import { CampGearScanner } from "../../services/camp/gear/CampGearScanner.js";
import { isComfortEnabled } from "../../services/camp/gear/ComfortCalculator.js";
import { areEncountersEnabled } from "../../services/rest/flow/ActivityEligibility.js";
import { canGatherInTerrain } from "../../services/travel/settings/TravelSettings.js";
import { bulletTip } from "./DowntimeSustenanceBuilder.js";

export function buildDowntimePartyAndNightContext(app, {
    isGM,
    party,
    haven,
    workbenchIdentifyUiEnabled,
    fuelStockTotal,
    hasTinderbox,
    currentFire,
    terrainLabel,
    scanResult,
    characters,
    totalNominatedRations
}) {
        // Scoped for player view: owned characters only; GM sees all
        const playerCharacters = isGM
            ? characters
            : characters.filter(c => c.canInteract);

        const rosterSummary = characters.map(c => ({
            id: c.id,
            name: c.name,
            img: c.img,
            isComplete: c.isAllocated,
            isAllocated: c.isAllocated,
            isReady: c.isReady,
            isAtRisk: c.isAtRisk,
            isPending: c.isPending,
            unallocatedDays: c.budget.unallocatedDays,
            statusState: c.statusState,
            statusLabel: c.statusLabel,
            statusIcon: c.statusIcon,
            statusTooltip: c.statusTooltip
        }));

        const roster = characters.map(c => ({
            id: c.id,
            name: c.name.split(" ")[0] || c.name,
            fullName: c.name,
            img: c.img,
            isOwner: isGM || c.canInteract,
            isSelected: c.id === app._selectedCharacterId,
            isReady: c.isReady,
            source: c.isReady ? "player" : "pending",
            activityLabel: c.statusLabel,
            hasStarvationRisk: c.hasStarvationRisk,
            exhaustion: c.exhaustion ?? 0,
            isAfk: false
        }));

        const totalCount = characters.length;
        const allocatedCount = characters.filter(c => c.isAllocated).length;
        const committedCount = characters.filter(c => c.isCommitted).length;
        const readyCount = characters.filter(c => c.isReady).length;
        const atRiskCount = characters.filter(c => c.isAtRisk).length;
        const settledCount = readyCount + atRiskCount;
        const isAllAllocated = totalCount > 0 && allocatedCount === totalCount;
        const isAllCommitted = totalCount > 0 && committedCount === totalCount;
        const isAllReady = totalCount > 0 && readyCount === totalCount;
        const isAllComplete = totalCount > 0 && settledCount === totalCount;

        const unreadyCharacters = characters.filter(c => !c.isReady && !c.isAtRisk);
        const atRiskCharacters = characters.filter(c => c.isAtRisk);
        const unallocatedNames = characters.filter(c => !c.isAllocated).map(c => `${c.name} (${c.budget?.unallocatedDays ?? 0}d left)`).join(", ");

        let badgeClass = "pending";
        let badgeText = `${readyCount}/${totalCount} Ready`;
        let tooltip = "";

        if (isAllReady) {
            badgeClass = "complete";
            badgeText = `${totalCount}/${totalCount} Ready`;
            tooltip = `All ${totalCount} characters are locked in and ready to rest.`;
        } else if (isAllComplete && atRiskCount > 0) {
            badgeClass = "at-risk";
            badgeText = `${readyCount}/${totalCount} Ready (${atRiskCount} at risk)`;
            tooltip = bulletTip("Party", [
                `${readyCount} of ${totalCount} ready`,
                ...atRiskCharacters.map(c => {
                    if (c.hasDehydrationRisk && c.hasStarvationRisk) return `${c.name}: ${c.waterShortfallDays}d water, ${c.foodShortfallDays}d food`;
                    if (c.hasDehydrationRisk) return `${c.name}: ${c.waterShortfallDays}d water`;
                    return `${c.name}: ${c.foodShortfallDays}d food`;
                })
            ]);
        } else {
            badgeClass = "pending";
            badgeText = `${readyCount}/${totalCount} Ready${atRiskCount > 0 ? ` (${atRiskCount} at risk)` : ""}`;
            tooltip = bulletTip("Waiting on", [
                ...unreadyCharacters.map(c => {
                    if (c.budget.unallocatedDays > 0) return `${c.name}: ${c.budget.unallocatedDays}d left`;
                    if (!c.isCommitted) return `${c.name}: activities still a draft`;
                    if (!c.mealsLocked) return `${c.name}: meals still a draft`;
                    return `${c.name}: ${c.statusLabel}`;
                }),
                ...atRiskCharacters.map(c => `${c.name} at risk`)
            ]);
        }

        const partyReadiness = {
            readyCount,
            allocatedCount,
            committedCount,
            atRiskCount,
            totalCount,
            isAllComplete,
            isAllAllocated,
            isAllCommitted,
            isAllReady,
            badgeClass,
            badgeText,
            tooltip,
            unreadyNames: unallocatedNames,
            unreadyTooltip: tooltip
        };

        const totalRationsNeeded = app._campLogistics._foodDaysNeeded * party.length;

        const totalNights = Math.max(1, app._totalNights || (app._isGrittyLongRest ? 7 : 1));
        const isSingleNight = totalNights === 1;

        if (isGM && haven === "wilderness" && app._encounterDraft?.length) {
            app._syncDraftDCs();
        }

        let draftEntries = app._encounterDraft;
        if (!isGM && (!draftEntries || draftEntries.length === 0)) {
            draftEntries = Array.from({ length: totalNights }, (_, idx) => {
                const nightIndex = idx + 1;
                const mods = app._getNightActivityModifiers(nightIndex);
                const fireNudge = fireEncounterDcNudge(app._fireLevel);
                const effectiveDC = combineNightDc(app._dangerDC ?? 15, mods.activityNudge, fireNudge, 0);
                return {
                    nightIndex,
                    effectiveDC,
                    isRolled: false,
                    state: null,
                    category: null,
                    isDisaster: false,
                    triggered: false,
                    forcedSafe: false,
                    rollTotal: null,
                    event: null,
                    sentryName: mods.sentryActor?.name ?? null,
                    sentrySurprised: false,
                    hasActiveGuard: mods.hasActiveGuard,
                    fortifyCount: mods.fortifyCount,
                    guardCount: mods.guardCount,
                    fortifyActors: mods.fortifyActors,
                    guardActors: mods.guardActors,
                    manualOffset: 0,
                    activityNudge: mods.activityNudge,
                    fireNudge
                };
            });
        }

        const decoratedDraft = (draftEntries ?? []).map(entry => {
            const isRed = entry.state === "red" || (entry.triggered && !entry.state);
            const isAmber = entry.state === "amber";
            const isGreen = !isRed && !isAmber;
            const isDisaster = Boolean(entry.isDisaster || entry.category === "disaster");

            let statusLabel = "Quiet Night";
            let statusIcon = "fas fa-moon";

            if (isRed) {
                statusLabel = entry.event?.title ?? "Hostile Ambush";
                statusIcon = "fas fa-skull";
            } else if (isAmber) {
                statusLabel = entry.event?.title ?? "Encounter";
                statusIcon = "fas fa-compass";
            } else if (entry.event?.title) {
                statusLabel = entry.event.title;
            }

            const mods = app._getNightActivityModifiers(entry.nightIndex);
            const fortifyCount = mods.fortifyCount;
            const failedFortifyCount = mods.failedFortifyCount ?? 0;
            const pendingFortifyCount = mods.pendingFortifyCount ?? 0;
            const guardCount = mods.guardCount;
            const hasFortify = (fortifyCount + failedFortifyCount + pendingFortifyCount) > 0;
            const hasGuard = guardCount > 0;
            let fortifyTooltip = "";
            if (hasFortify) {
                const parts = [];
                if (fortifyCount > 0) parts.push(`${mods.fortifyActors.join(", ")} holding (-${fortifyCount * 2} DC)`);
                if (failedFortifyCount > 0) parts.push(`${mods.failedFortifyActors.join(", ")} failed`);
                if (pendingFortifyCount > 0) parts.push(`${mods.pendingFortifyActors.join(", ")} unrolled`);
                fortifyTooltip = `Defenses: ${parts.join(" · ")}`;
            }
            const guardTooltip = hasGuard
                ? (guardCount > 1
                    ? `Watch: ${mods.guardActors.join(", ")} guarding (-${guardCount} DC, Sentry: ${mods.sentryActor?.name})`
                    : `Watch: ${mods.guardActors[0]} guarding (-1 DC)`)
                : "";

            const effectiveDC = entry.effectiveDC ?? app._dangerDC ?? 15;
            const isReducedDC = effectiveDC < app._dangerDC;
            const isIncreasedDC = effectiveDC > app._dangerDC;

            const fn = fireEncounterDcNudge(app._fireLevel);
            const hearthDeltaLabel = fn > 0 ? `+${fn}` : (fn < 0 ? `${fn}` : "0");
            const fortifyDelta = fortifyCount * 2;
            const fortifyDeltaLabel = fortifyDelta > 0 ? `-${fortifyDelta}` : "0";

            const parts = [`Base DC: ${app._dangerDC}`];
            if (fn !== 0) {
                parts.push(`Hearth: ${fn > 0 ? "+" + fn : fn}`);
            }
            if (hasFortify && fortifyCount > 0) parts.push(`Fortify: -${fortifyCount * 2}`);
            if (hasGuard) parts.push(`Guard: -${guardCount}`);
            if (entry.manualOffset) {
                parts.push(`GM: ${entry.manualOffset > 0 ? "+" + entry.manualOffset : entry.manualOffset}`);
            }
            const dcTooltip = `Night ${entry.nightIndex} DC ${effectiveDC} (${parts.join(" | ")})`;

            const sentryActor = mods.sentryActor ?? party[0] ?? null;
            const sentryPP = sentryActor?.system?.skills?.prc?.passive ?? sentryActor?.system?.attributes?.passive?.perception ?? 10;
            const sentryImg = (sentryActor?.img && sentryActor.img.trim() !== "") ? sentryActor.img : "icons/svg/mystery-man.svg";
            const sentryName = mods.sentryActor?.name ?? sentryActor?.name ?? "Camp Watch";
            const isRolled = Boolean(entry.isRolled);

            return {
                ...entry,
                effectiveDC,
                isDisaster,
                isRed,
                isAmber,
                isGreen,
                statusLabel,
                statusIcon,
                hasFortify,
                hasGuard,
                fortifyTooltip,
                guardTooltip,
                isReducedDC,
                isIncreasedDC,
                dcTooltip,
                hearthDelta: fn,
                hearthDeltaLabel,
                fortifyDelta,
                fortifyDeltaLabel,
                sentryActor,
                sentryPP,
                sentryImg,
                sentryName,
                isRolled
            };
        });

        const partyNightDefenses = [1, 2, 3, 4, 5, 6, 7].map(nightIndex => {
            const mods = app._getNightActivityModifiers(nightIndex);
            const fortifyHeld = mods.fortifyCount;
            const fortifyFailed = mods.failedFortifyCount ?? 0;
            const fortifyPending = mods.pendingFortifyCount ?? 0;
            const guardCount = mods.guardCount;
            const hasFortify = (fortifyHeld + fortifyFailed + fortifyPending) > 0;
            const hasGuard = guardCount > 0;
            const sentryName = hasGuard ? (mods.sentryActor?.name ?? null) : null;
            const activityNudge = mods.activityNudge;

            let defenseClass = "default";
            let statusLabel = "Standard Camp";
            let statusIcon = "fas fa-campground";

            if (fortifyHeld > 0 && hasGuard) {
                defenseClass = "active";
                statusLabel = "Defended & Guarded";
                statusIcon = "fas fa-shield-alt";
            } else if (fortifyHeld > 0) {
                defenseClass = "active";
                statusLabel = "Defenses Holding";
                statusIcon = "fas fa-shield-alt";
            } else if (hasGuard) {
                defenseClass = "active";
                statusLabel = "Sentry on Watch";
                statusIcon = "fas fa-eye";
            } else if (fortifyPending > 0) {
                defenseClass = "default";
                statusLabel = "Defenses Unrolled";
                statusIcon = "fas fa-hourglass-half";
            } else {
                defenseClass = "default";
                statusLabel = "Standard Camp";
                statusIcon = "fas fa-campground";
            }

            const impactLabel = activityNudge < 0 ? `${activityNudge} DC` : "0 DC";

            const tooltipParts = [];
            const fn = fireEncounterDcNudge(app._fireLevel);
            if (fn !== 0) {
                tooltipParts.push(`Hearth: ${fn > 0 ? "+" + fn : fn} DC`);
            }
            if (fortifyHeld > 0) tooltipParts.push(`Defenses: ${mods.fortifyActors.join(", ")} holding (-${fortifyHeld * 2} DC)`);
            if (fortifyPending > 0) tooltipParts.push(`Defenses: ${mods.pendingFortifyActors.join(", ")} unrolled`);
            if (hasGuard) tooltipParts.push(`Watch: ${mods.guardActors.join(", ")} (-${guardCount} DC)`);
            if (hasGuard && sentryName && guardCount > 1) tooltipParts.push(`Sentry: ${sentryName}`);
            const tooltip = `Night ${nightIndex}: ${tooltipParts.length ? tooltipParts.join(" · ") : "Standard camp (no DC modifiers)"}`;

            return {
                nightIndex,
                activityNudge,
                impactLabel,
                hasFortify,
                fortifyHeld: fortifyHeld > 0,
                fortifyFailed: fortifyFailed > 0,
                fortifyPending: fortifyPending > 0,
                hasGuard,
                sentryName,
                defenseClass,
                statusLabel,
                statusIcon,
                tooltip
            };
        });

        const coveredDays = Math.max(0, 7 - app._campLogistics._foodDaysNeeded);
        const coveredDaysLabel = coveredDays === 0
            ? null
            : (coveredDays === 1 ? game.i18n.localize("ionrift-respite.downtimeLedger.day1") : game.i18n.format("ionrift-respite.downtimeLedger.daysRange", { start: 1, end: coveredDays }));
        const neededDays1to6 = Math.max(0, 6 - coveredDays);
        const neededDaysLabel = neededDays1to6 === 0
            ? game.i18n.localize("ionrift-respite.downtimeLedger.fullyCovered")
            : (coveredDays === 0 ? game.i18n.localize("ionrift-respite.downtimeLedger.days1to6") : (coveredDays === 5 ? game.i18n.localize("ionrift-respite.downtimeLedger.day6") : game.i18n.format("ionrift-respite.downtimeLedger.daysRange", { start: coveredDays + 1, end: 6 })));

        const pacingActive = Boolean(app._pacingActive);
        const maxPacingNight = totalNights + 1;
        const activePacingNight = Math.max(1, Math.min(maxPacingNight, app._activePacingNight || 1));
        const isDawnCheck = pacingActive && activePacingNight > totalNights;
        const nextPacingNight = Math.min(maxPacingNight, activePacingNight + 1);
        const prevPacingNight = activePacingNight > 1 ? activePacingNight - 1 : null;
        const isFirstPacingNight = activePacingNight === 1;
        const isFinalPacingNight = activePacingNight === totalNights;

        const includeNight = haven !== "civilized";
        const headerStepDefs = [
            { key: "camp", label: game.i18n.localize("ionrift-respite.downtimeLedger.titleCampPlanning") },
            ...(includeNight ? [{ key: "night", label: isSingleNight ? game.i18n.localize("ionrift-respite.downtimeLedger.titleOvernightVigil") : game.i18n.localize("ionrift-respite.downtimeLedger.titleNightVigil") }] : []),
            { key: "resolve", label: game.i18n.localize("ionrift-respite.downtimeLedger.titleResolution") }
        ];
        const headerPhase = pacingActive ? (isDawnCheck ? "resolve" : (includeNight ? "night" : "resolve")) : "camp";
        const headerIndex = headerStepDefs.findIndex(step => step.key === headerPhase);
        const phaseSteps = headerStepDefs.map((step, index) => ({
            label: step.label,
            active: index === headerIndex,
            complete: index < headerIndex
        }));
        const phaseLabel = pacingActive
            ? (isDawnCheck ? game.i18n.localize("ionrift-respite.downtimeLedger.titleDawnFinalization") : (isSingleNight ? game.i18n.localize("ionrift-respite.downtimeLedger.titleOvernightVigil") : game.i18n.localize("ionrift-respite.downtimeLedger.titleNightVigil")))
            : (haven === "civilized" ? game.i18n.localize("ionrift-respite.downtimeLedger.titleSafeRest") : game.i18n.localize("ionrift-respite.downtimeLedger.titleCampPlanning"));

        const partyActors = party;
        const fuelBurnCost = (haven === "wilderness" && currentFire !== "cold_camp")
            ? (CampGearScanner.FIREWOOD_COST_BY_LEVEL[currentFire] ?? 2)
            : 0;
        const hasEnoughFuel = fuelStockTotal >= fuelBurnCost;
        const fireLabel = String(currentFire ?? "").replace("_", " ");
        const fuelStockTooltip = hasTinderbox
            ? bulletTip("Fuel", hasEnoughFuel
                ? [`${fuelStockTotal} firewood in the party`, `${fuelBurnCost} used for ${fireLabel}`]
                : [`${fuelStockTotal} firewood in the party`, `${fuelBurnCost} needed for ${fireLabel}`])
            : "No tinderbox or flint and steel in the party. Fires cannot be lit.";

        const fireTierOptions = [
            {
                id: "cold_camp",
                label: game.i18n.localize("ionrift-respite.downtimeLedger.fireTierColdCamp"),
                costLabel: "0 Fuel",
                comfortDelta: "−1 Comf",
                dcDelta: "−2 DC",
                selected: currentFire === "cold_camp",
                disabled: false,
                disabledReason: null
            },
            {
                id: "embers",
                label: game.i18n.localize("ionrift-respite.downtimeLedger.fireTierEmbers"),
                costLabel: "1 Fuel",
                comfortDelta: null,
                dcDelta: "±0 DC",
                selected: currentFire === "embers",
                disabled: !hasTinderbox || fuelStockTotal < 1,
                disabledReason: !hasTinderbox ? game.i18n.localize("ionrift-respite.downtimeLedger.needsTinderbox") : (fuelStockTotal < 1 ? game.i18n.format("ionrift-respite.downtimeLedger.needsFuel", { count: 1 }) : null)
            },
            {
                id: "campfire",
                label: game.i18n.localize("ionrift-respite.downtimeLedger.fireTierCampfire"),
                costLabel: "2 Fuel",
                comfortDelta: null,
                dcDelta: "+1 DC",
                selected: currentFire === "campfire",
                disabled: !hasTinderbox || fuelStockTotal < 2,
                disabledReason: !hasTinderbox ? game.i18n.localize("ionrift-respite.downtimeLedger.needsTinderbox") : (fuelStockTotal < 2 ? game.i18n.format("ionrift-respite.downtimeLedger.needsFuel", { count: 2 }) : null)
            },
            {
                id: "bonfire",
                label: game.i18n.localize("ionrift-respite.downtimeLedger.fireTierBonfire"),
                costLabel: "3 Fuel",
                comfortDelta: "+1 Comf",
                dcDelta: "+2 DC",
                selected: currentFire === "bonfire",
                disabled: !hasTinderbox || fuelStockTotal < 3,
                disabledReason: !hasTinderbox ? game.i18n.localize("ionrift-respite.downtimeLedger.needsTinderbox") : (fuelStockTotal < 3 ? game.i18n.format("ionrift-respite.downtimeLedger.needsFuel", { count: 3 }) : null)
            }
        ];

        const pacingDraft = decoratedDraft.map(entry => {
            const isResolvedCombat = app._completedCombatNights.has(entry.nightIndex);
            const isCurrentNight = entry.nightIndex === activePacingNight;
            const isVeiled = !isSingleNight && entry.nightIndex > activePacingNight && !entry.isRolled;
            const isRolled = Boolean(entry.isRolled);
            return {
                ...entry,
                isCurrentNight,
                isResolvedCombat,
                isVeiled,
                isRolled,
                isDawnStep: false
            };
        });

        if (!isSingleNight) {
            const allNightsRolled = decoratedDraft.every(e => e.isRolled);
            const isCurrentDawn = activePacingNight > totalNights;
            pacingDraft.push({
                nightIndex: totalNights + 1,
                label: game.i18n.localize("ionrift-respite.downtimeLedger.dawn"),
                isDawnStep: true,
                isCurrentNight: isCurrentDawn,
                isVeiled: !allNightsRolled && !isCurrentDawn,
                isRolled: false,
                effectiveDC: null,
                statusIcon: "fa-sun",
                statusLabel: game.i18n.localize("ionrift-respite.downtimeLedger.titleDawnFinalization"),
                tooltip: game.i18n.localize("ionrift-respite.downtimeLedger.dawnStepTooltip")
            });
        }

        const currentNightEntry = isDawnCheck
            ? {
                nightIndex: totalNights + 1,
                isDawnStep: true,
                isRolled: false,
                effectiveDC: 10,
                sentryName: "Party",
                sentryImg: "icons/svg/sun.svg",
                sentryPP: 10,
                statusLabel: game.i18n.localize("ionrift-respite.downtimeLedger.titleDawnFinalization"),
                statusIcon: "fa-sun"
            }
            : (pacingDraft.find(e => e.nightIndex === activePacingNight) ?? pacingDraft[0] ?? null);

        if (currentNightEntry) {
            if (!currentNightEntry.sentryImg || typeof currentNightEntry.sentryImg !== "string" || !currentNightEntry.sentryImg.trim()) {
                currentNightEntry.sentryImg = party[0]?.img || "icons/svg/mystery-man.svg";
            }
            if (!currentNightEntry.sentryName) {
                currentNightEntry.sentryName = party[0]?.name || "Camp Watch";
            }
            if (currentNightEntry.sentryPP === undefined || currentNightEntry.sentryPP === null) {
                const firstActor = party[0];
                currentNightEntry.sentryPP = firstActor?.system?.skills?.prc?.passive ?? firstActor?.system?.attributes?.passive?.perception ?? 10;
            }
            if (currentNightEntry.effectiveDC === undefined || currentNightEntry.effectiveDC === null) {
                currentNightEntry.effectiveDC = app._dangerDC ?? 15;
            }
        }

        const isCombatDoneForCurrentNight = app._completedCombatNights.has(activePacingNight);

        let watchRotation = [];
        if (isSingleNight) {
            const watchDefs = [
                { key: "dusk", label: game.i18n.localize("ionrift-respite.downtimeLedger.watchDusk"), hours: "0-2h", icon: "fa-cloud-sun", isPeakHazard: false },
                { key: "midnight", label: game.i18n.localize("ionrift-respite.downtimeLedger.watchMidnight"), hours: "2-4h", icon: "fa-moon", isPeakHazard: false },
                { key: "deep", label: game.i18n.localize("ionrift-respite.downtimeLedger.watchDeepNight"), hours: "4-6h", icon: "fa-shield-moon", isPeakHazard: true },
                { key: "dawn", label: game.i18n.localize("ionrift-respite.downtimeLedger.watchPreDawn"), hours: "6-8h", icon: "fa-sun", isPeakHazard: false }
            ];
            watchRotation = watchDefs.map((w, idx) => {
                const actor = party[idx % party.length] ?? null;
                const pp = actor?.system?.skills?.prc?.passive ?? actor?.system?.attributes?.passive?.perception ?? 10;
                return {
                    ...w,
                    watchIndex: idx + 1,
                    actor,
                    actorName: actor?.name ?? "Party Sentry",
                    actorImg: (actor?.img && actor.img.trim() !== "") ? actor.img : "icons/svg/mystery-man.svg",
                    passivePerception: pp,
                    isSurprised: currentNightEntry?.isRolled && currentNightEntry?.sentrySurprised && w.isPeakHazard,
                    isVigilant: !currentNightEntry?.sentrySurprised || !w.isPeakHazard
                };
            });
        }

        const campConditionsBar = app._buildCampConditionsBar(scanResult, {
            isGM,
            viewerActorId: isGM ? null : (playerCharacters[0]?.id ?? party[0]?.id)
        });
        const currentCampComfort = campConditionsBar?.campComfort ?? null;
        const campComfortFlashing = app._lastTrackedCampComfort !== undefined && app._lastTrackedCampComfort !== currentCampComfort;
        app._lastTrackedCampComfort = currentCampComfort;
        if (campConditionsBar) campConditionsBar.flashing = campComfortFlashing;

        const focusedComfort = characters.find(c => c.id === app._selectedCharacterId) ?? characters[0] ?? null;
        if (!(app._personalComfortMemory instanceof Map)) app._personalComfortMemory = new Map();
        const personalComfortFlashing = RestDockContext.noteComfortFlash(
            app._personalComfortMemory,
            focusedComfort?.id ?? null,
            focusedComfort?.personalComfort ?? null
        );

        const exhaustionRoster = party.map(actor => {
            const personalCard = characters.find(c => c.id === actor.id) ?? null;
            const hasStarvation = Boolean(personalCard?.hasStarvationRisk);
            const entry = app._getOrCreateExhaustionEntry(actor, personalCard, hasStarvation, currentFire);

            let conMod = 0;
            try {
                const rollData = actor.getRollData?.() ?? {};
                const fromRollData = rollData?.abilities?.con?.save;
                if (typeof fromRollData === "number") {
                    conMod = fromRollData;
                } else {
                    const mod = actor.system?.abilities?.con?.mod ?? 0;
                    const prof = actor.system?.attributes?.prof ?? 0;
                    const proficient = actor.system?.abilities?.con?.proficient ?? 0;
                    conMod = mod + (proficient > 0 ? prof : 0);
                }
            } catch {
                conMod = actor.system?.abilities?.con?.mod ?? 0;
            }
            const conModString = conMod >= 0 ? `+${conMod}` : `${conMod}`;
            const currentExhaustion = actor.system?.attributes?.exhaustion ?? 0;

            return {
                actorId: actor.id,
                actorName: actor.name,
                actorImg: actor.img || "icons/svg/mystery-man.svg",
                currentExhaustion,
                conModString,
                mustRoll: entry.mustRoll,
                waived: entry.waived,
                advMode: entry.advMode || "norm",
                dc: entry.dc,
                reason: entry.reason,
                rolled: entry.rolled,
                rollTotal: entry.rollTotal,
                passed: entry.passed,
                isOverrideOpen: Boolean(app._expandedExhaustionOverrides?.has(actor.id))
            };
        });

        const pendingRollsCount = exhaustionRoster.filter(e => e.mustRoll && !e.rolled).length;
        const failedRollsCount = exhaustionRoster.filter(e => e.rolled && !e.passed).length;
        const passedRollsCount = exhaustionRoster.filter(e => e.rolled && e.passed).length;
        const waivedCount = exhaustionRoster.filter(e => e.waived || !e.mustRoll).length;
        const exhaustionSummary = {
            total: exhaustionRoster.length,
            pending: pendingRollsCount,
            failed: failedRollsCount,
            passed: passedRollsCount,
            waived: waivedCount,
            allSettled: pendingRollsCount === 0
        };

        return {
            isGM,
            isGrittyLongRest: true,
            isCivilized: haven === "civilized",
            isWilderness: haven === "wilderness",
            campConditionsBar,
            campComfortFlashing,
            phaseSteps,
            phaseLabel,
            dangerDC: app._dangerDC,
            forageDC: app._campLogistics._forageDC,
            huntDC: app._campLogistics._huntDC,
            foodDaysNeeded: app._campLogistics._foodDaysNeeded,
            logisticsTooltip: bulletTip("Camp logistics", [
                `${app._campLogistics._foodDaysNeeded} days of food needed`,
                `Forage DC ${app._campLogistics._forageDC}`,
                `Hunt DC ${app._campLogistics._huntDC}`,
                !app._campLogistics._enforceTent ? game.i18n.localize("ionrift-respite.downtimeLedger.tentFactorWaived") : null,
                !app._campLogistics._enforceBedroll ? game.i18n.localize("ionrift-respite.downtimeLedger.bedrollFactorWaived") : null,
                !app._campLogistics._enforceMessKit ? game.i18n.localize("ionrift-respite.downtimeLedger.messKitFactorWaived") : null
            ].filter(Boolean)),
            patronSuppliedDays: app._patronSuppliedDays,
            coveredDays,
            coveredDaysLabel,
            neededDays1to6,
            neededDaysLabel,
            isDay7Covered: app._campLogistics._foodDaysNeeded === 0,
            totalRationsNeeded,
            totalNominatedRations,
            fuelStockTotal,
            hasTinderbox,
            fuelBurnCost,
            hasEnoughFuel,
            fuelStockTooltip,
            fireTierOptions,
            fireTiers: fireTierOptions,
            fireLevel: currentFire,
            bannerFireClass: "is-fire-lit",
            rosterSummary,
            partyReadiness,
            characterReady: Boolean(characters.find(c => c.id === app._selectedCharacterId)?.isReady),
            characters,
            roster,
            ...ImageResolver.resolveRestBannerContext(app._terrainTag, headerPhase),
            ...RestPresentationHelper.resolveRestHeaderContext({
                type: "downtime",
                terrainTag: app._terrainTag,
                terrainLabel,
                pacingActive,
                activePacingNight,
                totalNights,
                isDawnCheck,
                phaseSteps,
                abandonAction: "abandonDowntime",
                canReturnToPlanning: !Boolean(app._encounterDraft?.some(e => e.isRolled)),
                isGM
            }),
            canReturnToPlanning: !Boolean(app._encounterDraft?.some(e => e.isRolled)),
            hasAnyRolls: Boolean(app._encounterDraft?.some(e => e.isRolled)),
            playerCharacters,
            partyNightDefenses,
            encounterDraft: decoratedDraft,
            pacingDraft,
            pacingActive,
            isSingleNight,
            totalNights,
            watchRotation,
            activePacingNight,
            nextPacingNight,
            prevPacingNight,
            isFirstPacingNight,
            isFinalPacingNight,
            isDawnCheck,
            sendoffOpen: Boolean(app._sendoffOpen),
            sendoffReady: holdsForSendoff({
                totalNights,
                activeNight: activePacingNight,
                pending: app._sendoffPending()
            }) && !app._sendoffOpen,
            mealBuffRoster: app._sendoffRoster(),
            mealBuffPending: app._sendoffPending(),
            mealBuffTitle: "The send-off takes hold",
            mealBuffHint: "Apply each meal and drink before the last watch. It carries into the next day.",
            maxPacingNight,
            finalPacingStep: maxPacingNight,
            exhaustionRoster,
            exhaustionSummary,
            currentNightEntry,
            awaitingCombat: app._awaitingCombat,
            isCombatDoneForCurrentNight,
            enforceBedroll: app._campLogistics._enforceBedroll,
            enforceTent: app._campLogistics._enforceTent,
            enforceMessKit: app._campLogistics._enforceMessKit,
            logisticsDrawerOpen: app._campLogistics._drawerOpen,
            selectedCharacterId: app._selectedCharacterId,
            workflowMark: (() => {
                const focused = characters.find(c => c.id === app._selectedCharacterId) ?? characters[0] ?? null;
                if (!focused) return { gather: "draft", activities: "draft", sustenance: "draft" };
                return {
                    gather: focused.tier2Done ? "complete" : "draft",
                    activities: focused.tier1Done ? "complete" : (focused.isCommitted ? "locked" : "draft"),
                    sustenance: focused.mealsLocked ? "complete" : "draft"
                };
            })(),
            workflowComplete: (() => {
                const focused = characters.find(c => c.id === app._selectedCharacterId) ?? characters[0] ?? null;
                return {
                    gather: Boolean(focused?.tier2Done),
                    activities: Boolean(focused?.tier1Done),
                    sustenance: Boolean(focused?.mealsLocked)
                };
            })(),
            restDock: RestDockContext.buildDockContext({
                party,
                selectedId: app._selectedCharacterId,
                personalScan: characters.find(c => c.id === app._selectedCharacterId) ?? null,
                comfortFlashing: personalComfortFlashing,
                comfortEnabled: isComfortEnabled() && haven === "wilderness",
                finishedActorIds: new Set(characters.filter(c => c.isReady).map(c => c.id)),
                characterState: new Map(characters.map(c => [c.id, {
                    hasStarvationRisk: c.hasStarvationRisk,
                    hasDehydrationRisk: c.hasDehydrationRisk,
                    hasExhaustionRisk: Boolean(c.recovery?.exhaustionDC),
                    exhaustionDC: c.recovery?.exhaustionDC ?? null,
                    statusLabel: c.statusLabel
                }])),
                isGM
            }),
            ...(() => {
                let trackFood = true;
                try { trackFood = !!game.settings.get(MODULE_ID, "trackFood"); } catch { /* ignore */ }
                const logisticsFlags = CampLogisticsDelegate.computeVisibilityFlags({
                    trackFood,
                    terrainTag: app._terrainTag ?? null
                });
                if (logisticsFlags.hideLogisticsButton && app._campLogistics._drawerOpen) {
                    app._campLogistics._drawerOpen = false;
                }
                const showGatherStep = (haven === "wilderness") && canGatherInTerrain(app._terrainTag);
                const showSustenanceStep = (haven === "wilderness") && trackFood;
                let selectedWorkflowStep = app._selectedWorkflowStep;
                if (selectedWorkflowStep === "gather" && !showGatherStep) {
                    selectedWorkflowStep = "activities";
                }
                if (selectedWorkflowStep === "sustenance" && !showSustenanceStep) {
                    selectedWorkflowStep = "activities";
                }
                return {
                    ...logisticsFlags,
                    logisticsDrawerOpen: app._campLogistics._drawerOpen,
                    encountersEnabled: areEncountersEnabled(),
                    hideEncounterDcStepper: !areEncountersEnabled(),
                    selectedWorkflowStep,
                    showGatherStep,
                    showSustenanceStep
                };
            })(),
            workbenchIdentifyUiEnabled,
            isIdentifyActive: app._selectedWorkflowStep === "examine"
                || Boolean(app._selectedCharacterId && app._expandedTiers?.get(app._selectedCharacterId)?.has("identify"))
        };
}
