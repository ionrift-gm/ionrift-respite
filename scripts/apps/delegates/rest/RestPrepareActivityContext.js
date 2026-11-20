import { MODULE_ID } from "../../../data/moduleId.js";
import {
    SKILL_NAMES, ACTIVITY_ICONS, getStationsForTerrain, getActivityAdvisory,
    buildActivityAssignments, applyActivityPortraitAssignments, foldOrphanedAssignmentsOntoOther
} from "../../../data/RestConstants.js";
import { isBedrollItem, isTentItem, isMessKitItem } from "../../../services/camp/gear/CampGearScanner.js";
import { isPf2eSystem } from "../../../services/camp/gear/Pf2eComfortRules.js";
import { isSimpleStationsMode } from "../../../services/rest/flow/RestProfileSettings.js";
import { canGatherInTerrain } from "../../../services/travel/settings/TravelSettings.js";
import { buildActivityListItem } from "../../crafting/ActivityDetailBuilder.js";
import * as RestAfkState from "../../../services/rest/session/RestAfkState.js";
import { releaseGatherFromActivity } from "../../../services/rest/session/campProgressState.js";

export function buildCharacterStatuses(app, partyActors, partyState, safeRestSpot) {
        const characterStatuses = partyActors.map(a => {
            const gmOverride = app._gmOverrides.get(a.id);
            const playerChoice = app._getPlayerChoiceForCharacter(a.id);
            const effectiveChoice = gmOverride ?? playerChoice?.activityId ?? app._characterChoices?.get(a.id) ?? null;
            let source = gmOverride ? "gm" : playerChoice ? "player" : "pending";

            // Fallback: choices restored via receiveSubmissionUpdate land in
            // _characterChoices (keyed by charId) but not in _playerSubmissions
            // (keyed by userId). Count them as "player" sourced.
            if (source === "pending" && app._characterChoices?.has(a.id)) {
                source = "player";
            }

            let activityName = null;
            if (effectiveChoice) {
                const act = app._activities?.find(act => act.id === effectiveChoice);
                activityName = act?.name ?? effectiveChoice;
            }

            // Fallback: use submission status from socket for non-owned characters (player side)
            if (!app._isGM && source === "pending" && app._submissionStatus?.[a.id]) {
                const sub = app._submissionStatus[a.id];
                source = sub.source ?? "player";
                activityName = sub.activityName ?? activityName;
            }

            const professionBadges = [];
            const professionIcons = {
                cooking: "fas fa-utensils", alchemy: "fas fa-flask",
                smithing: "fas fa-hammer", leatherworking: "fas fa-shield-alt",
                brewing: "fas fa-flask", tailoring: "fas fa-cut"
            };
            const fireLevel = app._fireLevel ?? "unlit";
            const isFireLit = !!(app._fireLevel && app._fireLevel !== "unlit");
            const { available: avail, faded: fadedActivities, minor: minorActivities, fadedMinor: fadedMinorActivities } = app._activityResolver.getAvailableActivitiesWithFaded(
                a, app._engine?.restType ?? "long", app._activityResolverOpts({ isFireLit, fireLevel })
            );
            for (const act of avail) {
                if (act.crafting?.enabled) {
                    professionBadges.push({
                        label: act.name,
                        icon: professionIcons[act.crafting.profession] ?? "fas fa-tools"
                    });
                }
            }

            // Armor don/doff advisory (Xanathar's optional rule; full UI on activity detail)
            const armorWarning = app._buildArmorWarningForActor(a);

            const pendingId = app._pendingSelections.get(a.id);
            const tileActivities = avail.map(act => {
                const lines = [act.description];
                if (act.check) {
                    if (act.check.ability) {
                        const abilityLabel = act.check.ability.toUpperCase();
                        lines.push(`Check: ${abilityLabel}, DC ${act.check.dc ?? 12}`);
                    } else {
                        const primary = SKILL_NAMES[act.check.skill] ?? act.check.skill;
                        const alt = act.check.altSkill ? ` or ${SKILL_NAMES[act.check.altSkill] ?? act.check.altSkill}` : "";
                        lines.push(`Check: ${primary}${alt}, DC ${act.check.dc ?? 12}`);
                    }
                }
                if (act.outcomes?.success?.effects?.length) {
                    lines.push(act.outcomes.success.effects.map(e => e.description).join(". "));
                }
                if (act.outcomes?.success?.items?.length) {
                    lines.push(act.outcomes.success.items.map(i => {
                        const qty = i.quantity ?? 1;
                        return `Creates: ${typeof qty === "string" ? qty : qty + "x"} ${i.itemRef ?? i.pool ?? "items"}`;
                    }).join(", "));
                }
                if (!act.check && act.outcomes?.success?.narrative) {
                    lines.push(act.outcomes.success.narrative);
                }

                let typeTag = "Passive";
                if (act.crafting?.enabled) typeTag = "Craft";
                else if (act.check) typeTag = "Skill";
                if (act.group) typeTag = "Group";

                const advisory = getActivityAdvisory(act.id, a, partyState);

                return {
                    id: act.id,
                    name: act.name,
                    description: act.description ?? "",
                    icon: ACTIVITY_ICONS[act.id] ?? "fas fa-circle",
                    typeTag,
                    category: act.category ?? "active",
                    tooltip: lines.join("\n"),
                    isCrafting: !!act.crafting?.enabled,
                    profession: act.crafting?.profession ?? null,
                    isSelected: pendingId === act.id,
                    isDisabled: false,
                    check: act.check ?? null,
                    outcomes: act.outcomes ?? null,
                    combatModifiers: act.combatModifiers,
                    followUp: act.followUp ?? null,
                    armorSleepWaiver: act.armorSleepWaiver ?? false,

                    hint: advisory.text,
                    hintUrgent: advisory.urgent
                };
            });

            const fadedTiles = fadedActivities.map(act => {
                let typeTag = "Spell";
                if (act.crafting?.enabled) typeTag = "Craft";
                else if (act.check) typeTag = "Skill";
                return {
                    id: act.id,
                    name: act.name,
                    icon: ACTIVITY_ICONS[act.id] ?? "fas fa-circle",
                    typeTag,
                    category: act.category ?? "arcane",
                    tooltip: act.fadedHint,
                    isCrafting: !!act.crafting?.enabled,
                    profession: act.crafting?.profession ?? null,
                    isSelected: false,
                    isDisabled: true,
                    isFaded: true,
                    fadedHint: act.fadedHint,
                    combatModifiers: act.combatModifiers,
                    followUp: act.followUp ?? null,
                    armorSleepWaiver: act.armorSleepWaiver ?? false
                };
            });

            const allTiles = [...tileActivities.filter(t => !t.isCrafting), ...fadedTiles];
            const CATEGORY_ORDER = [
                { keys: ["camp", "recovery"], label: game.i18n.localize("ionrift-respite.restPrepare.category.campDuties") },
                { keys: ["active", "arcane"], label: game.i18n.localize("ionrift-respite.restPrepare.category.personal") }
            ];
            // Arcane tiles (Attune, Copy Spell) sort last within Personal
            const SORT_LAST_CATS = new Set(["arcane"]);
            const tileCategories = CATEGORY_ORDER
                .map(cat => ({
                    label: cat.label,
                    tiles: allTiles
                        .filter(t => cat.keys.includes(t.category))
                        .sort((a, b) => (SORT_LAST_CATS.has(a.category) ? 1 : 0) - (SORT_LAST_CATS.has(b.category) ? 1 : 0))
                }))
                .filter(cat => cat.tiles.length > 0);

            const professionTiles = [
                ...tileActivities.filter(t => t.isCrafting),
                ...fadedTiles.filter(t => t.isCrafting)
            ];

            // Station-grouped activity cards (terrain-filtered)
            const allAvailableIds = new Set(allTiles.map(t => t.id));
            const terrainStations = getStationsForTerrain(app._selectedTerrain ?? app._engine?.terrainTag ?? "forest", safeRestSpot);
            const stationCards = terrainStations
                .map(station => {
                    const stationTiles = station.activities
                        .filter(id => allAvailableIds.has(id))
                        .map(id => allTiles.find(t => t.id === id))
                        .filter(Boolean);
                    if (!stationTiles.length) return null;
                    return {
                        id: station.id,
                        label: station.label,
                        icon: station.icon,
                        furnitureKey: station.furnitureKey,
                        tiles: stationTiles
                    };
                })
                .filter(Boolean);

            /** Two flex columns so short stations (e.g. Workbench) do not leave a tall row gap above the next left card. */
            const stationCardColumns = [[], []];
            for (let i = 0; i < stationCards.length; i++) {
                stationCardColumns[i % 2].push(stationCards[i]);
            }

            const actorItems = a.items ? Array.from(a.items) : [];
            const gearBadges = [
                { id: "bedroll", icon: "fas fa-bed", name: game.i18n.localize("ionrift-respite.restPrepare.gear.bedroll"), present: actorItems.some(i => isBedrollItem(i)), tooltip: game.i18n.localize("ionrift-respite.restPrepare.gear.bedrollTooltip") },
                { id: "messkit", icon: "fas fa-utensils", name: game.i18n.localize("ionrift-respite.restPrepare.gear.messKit"), present: actorItems.some(i => isMessKitItem(i)), tooltip: game.i18n.localize("ionrift-respite.restPrepare.gear.messKitTooltip") },
                { id: "tent", icon: "fas fa-campground", name: game.i18n.localize("ionrift-respite.restPrepare.gear.tent"), present: actorItems.some(i => isTentItem(i)), tooltip: game.i18n.localize("ionrift-respite.restPrepare.gear.tentTooltip") }
            ];

            return {
                id: a.id,
                name: a.name,
                img: a.img || "icons/svg/mystery-man.svg",
                choice: effectiveChoice,
                activityName,
                source,
                professionBadges,
                tileCategories,
                stationCards,
                stationCardColumns,
                professionTiles,
                armorWarning,
                gearBadges,
                minorActivities: minorActivities.map(m => ({
                    id: m.id,
                    name: m.name,
                    description: m.description,
                    icon: ACTIVITY_ICONS[m.id] ?? "fas fa-circle"
                })),
                fadedMinorActivities: (fadedMinorActivities ?? []).map(m => ({
                    id: m.id,
                    name: m.name,
                    fadedHint: m.fadedHint,
                    icon: ACTIVITY_ICONS[m.id] ?? "fas fa-circle"
                })),
                hasProfessionTiles: professionTiles.length > 0,
                hasPending: !!pendingId,
                isOwner: app._isGM || app._myCharacterIds?.has(a.id),
                isAfk: RestAfkState.isAfk(a.id),
                isLocked: source !== "pending" || app._lockedCharacters.has(a.id),
                earlyResult: (() => {
                    if (app._copySpellResult?.actorId === a.id) return null;
                    const er = app._earlyResults?.get(a.id);
                    if (!er) return null;
                    const tier = er.result === "exceptional" ? "Exceptional"
                        : er.result === "success" ? "Success"
                        : er.result === "failure_complication" ? "Failed"
                        : er.result === "failure" ? "Failed"
                        : er.result === "pending_approval" ? "Pending"
                        : er.result;
                    const isPending = er.result === "pending_approval";
                    return { tier, narrative: er.narrative ?? "", isSuccess: er.result === "success" || er.result === "exceptional", isFailure: er.result === "failure" || er.result === "failure_complication", isPending };
                })(),
                isExpanded: app._isGM ? (app._expandedCards?.has(a.id) ?? false) : true,
                isCraftingInProgress: app._craftingInProgress?.has(a.id) ?? false,
                exhaustion: a.system?.attributes?.exhaustion ?? 0,
                copySpellProposal: app._copySpellProposal?.actorId === a.id ? app._copySpellProposal : null,
                copySpellResult: app._copySpellResult?.actorId === a.id ? app._copySpellResult : null
            };
        });
        return characterStatuses;
}

export function buildTotmStationCards(app, partyActors, partyState, safeRestSpot, setupSafeHaven) {
            if (!app._isTotM) return [];
            if (app._phase !== "activity") return [];

            const fireLevel = app._fireLevel ?? "unlit";
            const isFireLit = !!(app._fireLevel && app._fireLevel !== "unlit");
            const resolverOpts = app._activityResolverOpts({ isFireLit, fireLevel });
            const restType = app._engine?.restType ?? "long";
            const seenIds = new Set();
            const unionTiles = [];

            // Advisory and availability are computed for the selected actor only.
            // This ensures "No one is injured" etc. reflect the chosen character's perspective.
            const selectedActor = game.actors.get(app._selectedCharacterId);
            const actorsToScan = selectedActor ? [selectedActor] : partyActors;

            for (const a of actorsToScan) {
                const { available: avail, faded, minor = [] } = app._activityResolver.getAvailableActivitiesWithFaded(a, restType, resolverOpts);
                for (const act of [...avail, ...faded, ...minor]) {
                    if (seenIds.has(act.id)) continue;
                    seenIds.add(act.id);
                    const isAvail = avail.some(x => x.id === act.id) || minor.some(x => x.id === act.id);
                    unionTiles.push(buildActivityListItem(act.id, act, a, partyState, isAvail));
                }
            }

            const assignments = buildActivityAssignments(app._characterChoices, app._earlyResults);
            foldOrphanedAssignmentsOntoOther(assignments, unionTiles.map(t => t.id));
            for (const tile of unionTiles) {
                applyActivityPortraitAssignments(tile, assignments[tile.id] ?? []);
            }

            // A finished activity or craft closes the activity list. Gather is a
            // separate choice, so forage and hunt stay available on that step.
            const terrain = app._selectedTerrain ?? app._engine?.terrainTag ?? "forest";
            const showGather = canGatherInTerrain(terrain, { safeRestSpot: setupSafeHaven });
            const rawStep = app._selectedWorkflowStep ?? (showGather ? "gather" : "activities");
            const currentWorkflowStep = (rawStep === "gather" && !showGather) ? "activities" : rawStep;
            const onGatherStep = currentWorkflowStep === "gather" && showGather;
            const charLocked = !onGatherStep && (
                app._lockedCharacters?.has(app._selectedCharacterId)
                || (app._isGM && app._gmOverrides?.has(app._selectedCharacterId))
                || app._craftingInProgress?.has(app._selectedCharacterId)
                || app.hasCompletedCrafting?.(app._selectedCharacterId)
            );
            if (charLocked) {
                for (const tile of unionTiles) {
                    tile.available = false;
                    tile.nonViable = false;
                }
            }

            // Detail panel data is built in the totmDetailPanel variable below.
            // Tiles do not carry expanded state ,  the grid is hidden entirely when detail is open.

            const tileMap = new Map(unionTiles.map(t => [t.id, t]));
            const terrainStations = getStationsForTerrain(terrain, safeRestSpot);

            if (onGatherStep) {
                releaseGatherFromActivity(app, app._selectedCharacterId);
                const gatherChoice = app._gatherChoices?.get(app._selectedCharacterId) ?? null;
                const gatherResult = app._gatherResults?.get(app._selectedCharacterId);
                const gatherSkipped = app._gatherSkipIds?.has(app._selectedCharacterId);
                const gatherTiles = ["act_forage", "act_hunt"]
                    .map(id => tileMap.get(id))
                    .filter(Boolean)
                    .map(tile => ({
                        ...tile,
                        selected: !gatherSkipped && tile.id === gatherChoice,
                        hint: gatherResult && tile.id === gatherChoice ? gatherResult.haul : tile.hint
                    }));
                gatherTiles.push({
                    id: "gather_skip",
                    name: game.i18n.localize("ionrift-respite.restPrepare.skip"),
                    hint: game.i18n.localize("ionrift-respite.restPrepare.skipHint"),
                    available: true,
                    selected: !!gatherSkipped,
                    fadedHint: "",
                    nonViable: false
                });
                return [{
                    id: "gather_provisions",
                    label: game.i18n.localize("ionrift-respite.restPrepare.gatherProvisions"),
                    icon: "fas fa-seedling",
                    tiles: gatherTiles
                }];
            }

            // Exclude gathering activities (which live in Gather step) and identify (which lives in stepper Examine chip)
            const EXCLUDE_FROM_ACTIVITIES = new Set(["act_forage", "act_hunt", "act_identify"]);

            // Deduplicate activities across stations.
            const SKIP_STATIONS = new Set(["campfire"]);
            const TOTM_LABELS = { medical_bed: "First Aid", cooking_station: "Cooking", bedroll: "Your Bedroll" };
            const TOTM_ORDER = { weapon_rack: 0, cooking_station: 1, medical_bed: 2, bedroll: 3, workbench: 4 };
            const BEDROLL_OWNED = new Set(["act_rest_fully", "act_other", "act_train", "act_pray", "act_tell_tales"]);
            const usedIds = new Set();

            const cards = [];
            for (const station of terrainStations) {
                if (SKIP_STATIONS.has(station.id)) continue;

                const tiles = station.activities
                    .filter(id => !usedIds.has(id) && !EXCLUDE_FROM_ACTIVITIES.has(id))
                    .filter(id => station.id === "bedroll" || !BEDROLL_OWNED.has(id))
                    .map(id => tileMap.get(id))
                    .filter(Boolean);

                for (const t of tiles) usedIds.add(t.id);

                if (!tiles.length) continue;
                const chosenId = app._characterChoices?.get(app._selectedCharacterId);
                cards.push({
                    id: station.id,
                    label: TOTM_LABELS[station.id] ?? station.label,
                    icon: station.icon,
                    tiles: tiles.map(tile => ({ ...tile, selected: tile.id === chosenId }))
                });
            }
            cards.sort((a, b) => (TOTM_ORDER[a.id] ?? 99) - (TOTM_ORDER[b.id] ?? 99));
            return cards;
}

export function buildRosterAndOverview(app, partyActors, characterStatuses, heroCharacters) {
        const roster = characterStatuses.map(c => {
            // shared status surface: when an event or decision-tree roll is in flight the
            // roll-request component suppresses its own avatar list and delegates the
            // pending/rolled/forced state here so every client sees the same picture.
            let pendingRoll = false;
            let rolledResult = null;
            let rollMode = null;

            if (app._isGM) {
                // GM: check triggeredEvents for awaiting rolls
                const awaitingEvent = (app._triggeredEvents ?? []).find(e => e.awaitingRolls);
                if (awaitingEvent) {
                    if (awaitingEvent.pendingRolls?.includes(c.id)) pendingRoll = true;
                    const resolved = awaitingEvent.resolvedRolls?.find(r => r.characterId === c.id);
                    if (resolved) rolledResult = resolved.total;
                    rollMode = awaitingEvent.rollModes?.[c.id] ?? rollMode;
                }
                // Decision-tree rolls dispatched from the active tree state
                if (!pendingRoll && !rolledResult) {
                    const ts = app._activeTreeState;
                    if (ts?.awaitingRolls) {
                        const resolved = (ts.resolvedRolls ?? []).find(r => (r.characterId ?? r.actorId) === c.id);
                        if (resolved) rolledResult = resolved.total ?? "done";
                        else if (ts.pendingRolls?.includes(c.id)) pendingRoll = true;
                        if (pendingRoll || rolledResult) rollMode = ts.pendingRollModes?.[c.id] ?? rollMode;
                    }
                }
                // Also check camp activity rolls
                if (!pendingRoll && !rolledResult && app._pendingCampRolls?.length) {
                    const campEntry = app._pendingCampRolls.find(p => p.characterId === c.id);
                    if (campEntry) {
                        if (campEntry.status === "pending") pendingRoll = true;
                        else rolledResult = campEntry.total ?? "done";
                    }
                }
            } else {
                // Player: check pendingEventRoll
                if (app._pendingEventRoll) {
                    const targets = app._pendingEventRoll.targets ?? [];
                    if (targets.includes(c.id)) {
                        if (app._pendingEventRoll.rolledCharacters?.has(c.id)) {
                            rolledResult = "done";
                        } else {
                            pendingRoll = true;
                        }
                        rollMode = app._pendingEventRoll.rollModes?.[c.id] ?? rollMode;
                    }
                }
                // Decision-tree rolls dispatched to the player
                if (!pendingRoll && !rolledResult && app._pendingTreeRoll) {
                    const targets = app._pendingTreeRoll.targets ?? [];
                    if (targets.includes(c.id)) {
                        if (app._pendingTreeRoll.rolledCharacters?.has(c.id)) {
                            const res = app._pendingTreeRoll.rolledResults?.get?.(c.id);
                            rolledResult = res?.total ?? "done";
                        } else {
                            pendingRoll = true;
                        }
                        rollMode = app._pendingTreeRoll.rollModes?.[c.id] ?? rollMode;
                    }
                }
                // Also check camp activity rolls
                if (!pendingRoll && !rolledResult && app._pendingCampRoll) {
                    const campAct = app._pendingCampRoll.activities?.find(a => a.characterId === c.id);
                    if (campAct) {
                        if (app._pendingCampRoll.rolledCharacters?.has(c.id)) {
                            rolledResult = "done";
                        } else {
                            pendingRoll = true;
                        }
                    }
                }
            }

            // Training: activity locked but the three sets are not finished yet.
            if (!pendingRoll && !rolledResult
                && app._trainingStates?.has(c.id)
                && !app._earlyResults?.has(c.id)) {
                pendingRoll = true;
            }

            // Forced outcomes resolve without a roll; surface them as settled, not pending.
            if (pendingRoll && (rollMode === "force-pass" || rollMode === "force-fail")) {
                pendingRoll = false;
            }

            // Look up assigned activity for roster label (all phases once chosen)
            let activityLabel = null;
            const actId = app._gmOverrides?.get(c.id) ?? app._characterChoices?.get(c.id);
            if (actId) {
                const act = app._activities?.find(a => a.id === actId);
                activityLabel = act?.name ?? null;
            }

            const isBeddedDown = (app._phase === "events" || app._phase === "reflection")
                && !app._nightWatchActorIds().has(c.id);

            // Meal phase: surface each character's ration fill status on the chip so
            // the GM can see at a glance who still has no food/water assigned before
            // running the group-wide Process Rations step.
            let mealStatus = null;
            if (app._phase === "meal" && (app._isGM || c.isOwner) && game.settings.get(MODULE_ID, "trackFood")) {
                const card = app.getStationMealCardForActor(c.id);
                if (card) {
                    const submitted = card.playerSubmitted === true;
                    const consumed = card.allDaysConsumed === true || (card.consumedDaysCount ?? 0) > 0;
                    const foodOk = !!card.foodSufficient;
                    const waterOk = !!card.waterSufficient;
                    const anyFilled = (card.foodFilledCount ?? 0) > 0 || (card.waterFilledCount ?? 0) > 0;
                    let state;
                    if (submitted || consumed || (foodOk && waterOk)) state = "ready";
                    else if (anyFilled) state = "partial";
                    else state = "empty";
                    const tooltip = submitted ? "Rations submitted"
                        : consumed ? "Meals consumed"
                        : state === "ready" ? "Food and water assigned"
                        : state === "partial" ? `Incomplete: ${foodOk ? "food set" : "food missing"}, ${waterOk ? "water set" : "water missing"}`
                        : "No rations assigned";
                    mealStatus = { state, foodOk, waterOk, submitted, consumed, tooltip };
                }
            }

            return {
                id: c.id,
                name: c.name.split(" ")[0],  // First name only
                fullName: c.name,
                img: c.img,
                source: c.source,
                isAfk: RestAfkState.isAfk(c.id),
                isOwner: c.isOwner,
                isSelected: c.id === app._selectedCharacterId,
                exhaustion: c.exhaustion,
                pendingRoll,
                rolledResult,
                rollMode,
                activityLabel,
                isBeddedDown,
                mealStatus
            };
        });

        const selectedCharacter = heroCharacters.find(c => c.id === app._selectedCharacterId) ?? heroCharacters[0] ?? null;

        const totalCharacters = partyActors.length;
        const resolvedCount = characterStatuses.filter(c => c.source !== "pending").length;
        const trackFoodSetting = game.settings.get(MODULE_ID, "trackFood");
        const allRationsSubmitted = !trackFoodSetting
            || app._isTotM  // TotM: rations are collected in the dedicated Meal phase, not activity-phase station tabs
            || (app._activityMealRationsSubmitted?.size ?? 0) >= totalCharacters;
        const hasPendingTraining = (app._trainingStates?.size > 0)
            || [...(app._characterChoices?.entries() ?? [])].some(
                ([charId, actId]) => actId === "act_train" && !app._earlyResults?.has(charId)
            );
        const allResolved = resolvedCount === totalCharacters
            && !app._gmCopySpellProposal
            && allRationsSubmitted
            && !hasPendingTraining;
        const viewerHasSubmitted = !app._isGM && characterStatuses
            .filter(c => c.isOwner)
            .every(c => c.source !== "pending");
        const activityPhasePlayerOverview =
            app._phase === "activity"
                ? {
                      resolvedCount,
                      totalCharacters,
                      allResolved,
                      viewerHasSubmitted,
                      trackFood: !!trackFoodSetting,
                      simpleStations: isSimpleStationsMode(),
                      mealRationsSubmitted: app._activityMealRationsSubmitted?.size ?? 0,
                      activityProgressPercent:
                          totalCharacters > 0
                              ? Math.round((resolvedCount / totalCharacters) * 100)
                              : 0,
                      mealRationsProgressPercent:
                          totalCharacters > 0
                              ? Math.round(
                                    ((app._activityMealRationsSubmitted?.size ?? 0) / totalCharacters) * 100
                                )
                              : 0
                  }
                : null;

    return { roster, selectedCharacter, totalCharacters, resolvedCount, trackFoodSetting, allRationsSubmitted, hasPendingTraining, allResolved, viewerHasSubmitted, activityPhasePlayerOverview };
}

export function buildResolvePhaseSummaries(app) {
        let recoverySummary = [];
        let activitySummary = [];
        let partyDiscoveries = [];
        if (app._phase === "resolve" && app._outcomes?.length) {
            const scopedOutcomes = app._isGM
                ? app._outcomes
                : app._outcomes.filter(o => app._myCharacterIds?.has(o.characterId));
            recoverySummary = scopedOutcomes.map(o => {
                const actor = game.actors?.get(o.characterId);
                let hpAtMax = false;
                let hdAtMax = false;
                if (actor) {
                    const hp = actor.system?.attributes?.hp;
                    if (hp) hpAtMax = (hp.value ?? 0) >= (hp.max ?? 1);
                    const classes = actor.items?.filter(i => i.type === "class") ?? [];
                    const totalHdSpent = classes.reduce((sum, cls) => {
                        return sum + (cls.system?.hd?.spent ?? cls.system?.hitDiceUsed ?? 0);
                    }, 0);
                    hdAtMax = totalHdSpent <= 0;
                }
                return {
                    name: o.characterName,
                    hp: o.recovery?.hpRestored ?? 0,
                    hd: o.recovery?.hdRestored ?? 0,
                    hpAtMax,
                    hdAtMax,
                    eventDamage: o.recovery?.eventDamage ?? 0,
                    exhaustionDelta: o.recovery?.exhaustionDelta ?? 0,
                    exhaustionDC: o.recovery?.exhaustionDC ?? 0,
                    exhaustionSaveResult: o.recovery?.exhaustionSaveResult ?? null,
                    gearBonuses: o.recovery?.gearBonuses ?? {},
                    gearDescriptors: o.recovery?.gearDescriptors ?? []
                };
            });
            // Extract activity outcomes for badges
            for (const o of scopedOutcomes) {
                for (const sub of (o.outcomes ?? [])) {
                    if (sub.source === "activity" && sub.activityId) {
                        const actId = sub.activityId === "act_set_defenses" ? "act_defenses" : sub.activityId;
                        const act = app._activityResolver?.activities?.get(actId);
                        const humanName = act?.name ?? actId.replace(/^act_/, "").replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
                        activitySummary.push({
                            name: o.characterName,
                            activityName: humanName,
                            result: sub.result ?? "success"
                        });
                    }
                }
            }
            const isFailureChip = (r) => r === "failure" || r === "failure_complication";
            activitySummary.sort((a, b) => Number(isFailureChip(a.result)) - Number(isFailureChip(b.result)));

            // Aggregate event item rewards into party discoveries (shown once, not per-character)
            const seenEvents = new Set();
            for (const o of app._outcomes ?? []) {
                for (const sub of (o.outcomes ?? [])) {
                    if (sub.source === "event" && sub.items?.length && !seenEvents.has(sub.eventId)) {
                        seenEvents.add(sub.eventId);
                        for (const item of sub.items) {
                            const grantKey = `${sub.eventId}:${item.itemRef ?? item.name}`;
                            const grantInfo = app._getDiscoveryGrant(grantKey);
                            partyDiscoveries.push({
                                eventName: sub.eventName ?? "Event",
                                itemRef: item.itemRef ?? item.name ?? "Unknown",
                                name: item.name ?? null,
                                quantity: item.quantity ?? 1,
                                grantKey,
                                granted: !!grantInfo,
                                grantedTo: grantInfo?.actorName ?? null,
                                grantedQty: grantInfo?.rolled ?? null,
                                grantedItemName: grantInfo?.itemName ?? null
                            });
                        }
                    }
                }
            }
        }

        // Player: filter outcomes to owned characters
        const personalOutcomes = app._isGM
            ? app._outcomes
            : (app._outcomes ?? []).filter(o => app._myCharacterIds?.has(o.characterId));

        // Resolution Phase: Build streamlined Dawn Cards
        const dawnCards = app._phase === "resolve" ? (personalOutcomes ?? []).map(o => {
            const actor = game.actors?.get(o.characterId);
            const recovery = o.recovery ?? {};

            let hpAtMax = false;
            let hdAtMax = false;
            if (actor) {
                const hp = actor.system?.attributes?.hp;
                if (hp) hpAtMax = (hp.value ?? 0) >= (hp.max ?? 1);
                const classes = actor.items?.filter(i => i.type === "class") ?? [];
                const totalHdSpent = classes.reduce((sum, cls) => {
                    return sum + (cls.system?.hd?.spent ?? cls.system?.hitDiceUsed ?? 0);
                }, 0);
                hdAtMax = totalHdSpent <= 0;
            }

            const hpRestored = recovery.hpRestored ?? 0;
            const hdRestored = recovery.hdRestored ?? 0;
            const pf2e = isPf2eSystem();
            const hpLabel = hpAtMax ? game.i18n.localize("ionrift-respite.restPrepare.recovery.maxHp") : (hpRestored > 0 ? `+${hpRestored} HP` : "0 HP");
            const hdLabel = pf2e
                ? (recovery.wellRestedGranted
                    ? "+1 Initiative"
                    : (recovery.drainedDelta < 0 ? `${recovery.drainedDelta} Drained` : "Rested"))
                : (hdAtMax ? game.i18n.localize("ionrift-respite.restPrepare.recovery.maxHd") : (hdRestored > 0 ? `+${hdRestored} HD` : "0 HD"));
            const hasBedroll = !pf2e && !!recovery.gearBonuses?.hd;

            // Activity
            const actSub = (o.outcomes ?? []).find(s => s.source === "activity");
            let activityLabel = game.i18n.localize("ionrift-respite.restPrepare.recovery.rested");
            let activityIcon = "fas fa-bed";
            let activitySuccess = true;
            if (actSub?.activityId) {
                const actId = actSub.activityId === "act_set_defenses" ? "act_defenses" : actSub.activityId;
                const act = app._activityResolver?.activities?.get(actId);
                activityLabel = act?.name ?? actId.replace(/^act_/, "").replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
                activitySuccess = actSub.result !== "failure" && actSub.result !== "failure_complication";
                if (actId.includes("watch")) activityIcon = "fas fa-eye";
                else if (actId.includes("cook")) activityIcon = "fas fa-utensils";
                else if (actId.includes("defenses")) activityIcon = "fas fa-shield-alt";
                else if (actId.includes("forage") || actId.includes("gather")) activityIcon = "fas fa-seedling";
                else if (actId.includes("craft") || actId.includes("fletch")) activityIcon = "fas fa-hammer";
            }

            const exhaustionDelta = recovery.exhaustionDelta ?? 0;
            const exhaustionDC = recovery.exhaustionDC ?? null;
            const savePassed = !!exhaustionDC && recovery.exhaustionSaveResult === "passed";
            const saveFailed = !!exhaustionDC && recovery.exhaustionSaveResult === "failed";
            const eventDamage = recovery.eventDamage ?? 0;
            const eventDisrupted = !!o.eventDisrupted;
            const hasSetback = exhaustionDelta > 0 || saveFailed || eventDamage > 0 || eventDisrupted;

            return {
                characterId: o.characterId,
                name: actor?.name ?? o.characterName,
                img: actor?.img ?? "icons/svg/mystery-man.svg",
                hpLabel,
                hdLabel,
                hpAtMax,
                hdAtMax,
                hasBedroll,
                activityLabel,
                activityIcon,
                activitySuccess,
                exhaustionDelta,
                exhaustionDC,
                savePassed,
                saveFailed,
                eventDamage,
                hasSetback
            };
        }) : [];

        const resolutionCards = app._phase === "resolve"
            ? app._buildResolutionCards(personalOutcomes ?? [])
            : [];

    return { recoverySummary, activitySummary, partyDiscoveries, personalOutcomes, dawnCards, resolutionCards };
}
