import { Logger } from "../../../utils/Logger.js";
import { TerrainRegistry } from "../../../services/events/resolve/TerrainRegistry.js";
import { DecisionTreeResolver } from "../../../services/events/resolve/DecisionTreeResolver.js";
import { countPoolEventsForTerrain } from "../../../services/events/catalog/EventCatalogLoader.js";
import { resolveDefaultCraftRecipeId } from "../../../services/crafting/engine/CraftCommitSummary.js";
import { CampGearScanner } from "../../../services/camp/gear/CampGearScanner.js";
import { CampfireTokenLinker } from "../../../services/camp/fire/CampfireTokenLinker.js";
import { hasCampPlaced, hasCampfirePlaced } from "../../../services/camp/props/CompoundCampPlacer.js";
import { ImageResolver } from "../../../utils/ImageResolver.js";
import {
    WEATHER_TABLE, SKILL_NAMES, COMFORT_RANK, RANK_TO_KEY, ACTIVITY_ICONS, SHELTER_SPELLS,
    getComfortTip, getStationsForTerrain, getActivityAdvisory, buildActivityAssignments,
    applyActivityPortraitAssignments, foldOrphanedAssignmentsOntoOther, isWorkbenchIdentifyUiEnabled
} from "../../../data/RestConstants.js";
import { isComfortEnabled, COMFORT_TIERS } from "../../../services/camp/gear/ComfortCalculator.js";
import { isSimpleStationsMode, requiresMapCampFire } from "../../../services/rest/flow/RestProfileSettings.js";
import { isScoutingEnabled } from "../../../services/travel/settings/ScoutingSettings.js";
import { getTravelGatherAvailability } from "../../../services/travel/settings/TravelSettings.js";
import { buildActivityListItem, buildActivityDetailContext } from "../../crafting/ActivityDetailBuilder.js";
import { closeStationDialogIfDifferentActor } from "../../camp/StationActivityDialog.js";
import {
    buildEventPlayerRollContext, buildEventGmRollContext, buildTreePlayerRollContext,
    buildCampActivityRollContext, buildTravelActivityRollContext, buildCopySpellRollContext
} from "../../../services/ui/rollRequest/RollRequestView.js";
import { getPartyActors } from "../../../services/party/partyActors.js";
import * as RestAfkState from "../../../services/rest/session/RestAfkState.js";
import { MODULE_ID } from "../../../data/moduleId.js";

export class RestPrepareContext {
    constructor(app) {
        this._app = app;
    }

    async build(options) {
        const app = this._app;

        if (app._dataReady) {
            const settled = await Promise.race([app._dataReady, Promise.resolve("pending")]);
            if (settled === "pending") {
                app._dataReady.then(() => app.render({ force: true }));
                return { isLoading: true };
            }
            app._dataReady = null;
        }

        // Ensure terrain registry is loaded (no-ops after first call)
        await TerrainRegistry.init();

        if (!app._pendingSelections) app._pendingSelections = new Map();
        if (!app._expandedCards) app._expandedCards = new Set();
        if (!app._craftingInProgress) app._craftingInProgress = new Set();
        if (!app._shelterOverrides) app._shelterOverrides = {};

        if (app._phase === "activity") {
            app._applyLoseActivityTravelLocks();
            app._applyAutoOtherWhenSoleActivity();
            app._ensureTrainingStateForLockedChoices();
        }

        const partyActors = getPartyActors();
        const emptyParty = partyActors.length === 0;
        const partySetup = game.ionrift?.library?.party?.getSetupState?.() ?? {
            isV14: false,
            usesNativeParty: false,
            emptyParty,
            reason: emptyParty ? "no_characters" : null,
            warning: null
        };
        const emptyPartyReason = emptyParty ? (partySetup.reason ?? "no_characters") : null;
        const partySetupWarning = !emptyParty ? (partySetup.warning ?? null) : null;
        const showPartyRosterEditor = emptyParty && !partySetup.usesNativeParty;
        if (!app._selectedTerrain) {
            const lastTerrain = game.settings.get(MODULE_ID, "lastTerrain");
            if (lastTerrain && TerrainRegistry.get(lastTerrain)) app._selectedTerrain = lastTerrain;
        }
        const terrainDefaults = TerrainRegistry.getDefaults(app._selectedTerrain ?? "forest");
        const defaultComfort = terrainDefaults.comfort;

        if (app._phase === "setup" && !emptyParty) {
            app._selectedWeather = app._resolveSetupWeather(app._selectedTerrain ?? "forest");
        }

        const currentRestType = app._selectedRestType ?? "long";

        let safeRestSpotFromSetting = false;
        try {
            safeRestSpotFromSetting = !!game.settings.get(MODULE_ID, "safeRestSpot");
        } catch { /* settings not ready */ }
        const safeRestSpot = !!(app._engine?.safeRestSpot ?? app._restData?.safeRestSpot ?? safeRestSpotFromSetting);
        const isTavernSetup = (app._selectedTerrain ?? "forest") === "tavern";
        const setupSafeHaven = safeRestSpot || isTavernSetup;
        let tavernForcesTotm = false;
        try {
            tavernForcesTotm = isTavernSetup
                && game.settings.get(MODULE_ID, "restInterfaceMode") === "stations";
        } catch { /* settings not ready */ }

        let encountersEnabled = true;
        try {
            encountersEnabled = !!game.settings.get(MODULE_ID, "enableEncounters");
        } catch { /* settings not ready */ }

        if ((safeRestSpot || !isComfortEnabled() || !app._totmFireTabVisible())
            && app._isTotM && app._phase === "activity" && app._totmActiveTab === "fire") {
            app._totmActiveTab = "activities";
        }
        if (!isWorkbenchIdentifyUiEnabled() && app._isTotM && app._phase === "activity" && app._totmActiveTab === "identify") {
            app._totmActiveTab = "activities";
        }
        if (app._isTotM && app._phase === "activity" && app._totmActiveTab === "campfire") {
            app._totmActiveTab = "activities";
        }

        const tentOwners = partyActors.filter(a =>
            a.items?.some(i => i.name?.toLowerCase().includes("tent"))
        );
        const tentAvailable = tentOwners.length > 0;
        const tentOwnerNames = tentOwners.map(a => a.name).join(", ");

        const shelterOptions = SHELTER_SPELLS
            .filter(spell => spell.restTypes.includes(currentRestType))
            .map(spell => {
                const casters = partyActors.filter(a =>
                    a.items?.some(i => {
                        if (i.type !== "spell") return false;
                        const spellName = i.name?.toLowerCase() ?? "";
                        return spell.altNames.some(alt => spellName.includes(alt));
                    })
                );
                const hasCaster = casters.length > 0;
                return {
                    ...spell,
                    available: hasCaster,
                    casterNames: casters.map(a => a.name).join(", "),
                    hint: hasCaster ? spell.hint : `Requires ${spell.name} spell. No one in the party has it prepared.`,
                    active: !!app._shelterOverrides[spell.id]
                };
            });

        if (currentRestType === "long") {
            shelterOptions.unshift({
                id: "tent",
                name: "Tent",
                icon: "fas fa-campground",
                available: tentAvailable,
                casterNames: tentOwnerNames,
                hint: tentAvailable ? `Carried by ${tentOwnerNames}. Weather shield. Encounter DC +2.` : "No tent in party inventory.",
                rpPrompt: "Who sets it up? Where do they pitch it? Is it large enough for everyone, or do some sleep outside?",
                comfortFloor: null,
                encounterMod: 2,
                active: !!app._shelterOverrides.tent
            });
        }

        shelterOptions.push({
            id: "none",
            name: "Open Air",
            icon: "fas fa-cloud-moon",
            available: true,
            casterNames: null,
            hint: "Under the open sky. No protection from weather or encounters.",
            rpPrompt: null,
            comfortFloor: null,
            encounterMod: 0,
            active: !!app._shelterOverrides.none
        });

        const activeShelterId = Object.entries(app._shelterOverrides ?? {}).find(([, v]) => v)?.[0];
        const isTavern = (app._selectedTerrain ?? "forest") === "tavern";
        const shelterChosen = isTavern || !!activeShelterId;
        const activeShelter = activeShelterId ? shelterOptions.find(s => s.id === activeShelterId) : null;

        const shelterEffect = activeShelter ? {
            name: activeShelter.name,
            comfortFloor: activeShelter.comfortFloor,
            encounterMod: activeShelter.encounterMod ?? 0,
            rpPrompt: activeShelter.rpPrompt ?? null,
            casterNames: activeShelter.casterNames ?? null
        } : null;

        const partyState = app.getPartyStateForAdvisory();
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
                    combatModifiers: act.combatModifiers ?? null,
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
                    combatModifiers: act.combatModifiers ?? null,
                    followUp: act.followUp ?? null,
                    armorSleepWaiver: act.armorSleepWaiver ?? false
                };
            });

            const allTiles = [...tileActivities.filter(t => !t.isCrafting), ...fadedTiles];
            const CATEGORY_ORDER = [
                { keys: ["camp", "recovery"], label: "Camp Duties" },
                { keys: ["active", "arcane"], label: "Personal" }
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

            const actorItems = a.items?.map(i => i.name?.toLowerCase()) ?? [];
            const gearBadges = [
                { id: "bedroll", icon: "fas fa-bed", name: "Bedroll", present: actorItems.some(n => n?.includes("bedroll")), tooltip: "Bedroll: +1 Hit Die recovered during long rest" },
                { id: "messkit", icon: "fas fa-utensils", name: "Mess Kit", present: actorItems.some(n => n?.includes("mess kit") || (n?.includes("cook") && n?.includes("utensil"))), tooltip: "Mess Kit: advantage on exhaustion saves (requires lit fire)" },
                { id: "tent", icon: "fas fa-campground", name: "Tent", present: actorItems.some(n => n?.includes("tent")), tooltip: "Tent: personal shelter, cancels or reduces weather penalties" }
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

        // Early-init: ensure _selectedCharacterId is set before card builders use it.
        // On first render _selectedCharacterId is null; pick the first owned character.
        if (!app._selectedCharacterId && partyActors.length > 0) {
            if (app._isGM) {
                app._selectedCharacterId = partyActors[0].id;
            } else {
                const owned = partyActors.find(a => a.isOwner);
                app._selectedCharacterId = owned?.id ?? partyActors[0].id;
            }
        }

        if (app._phase === "activity") {
            app._syncIncompleteTrainingView();
        }

        const totmStationCards = (() => {
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
                const { available: avail, faded } = app._activityResolver.getAvailableActivitiesWithFaded(a, restType, resolverOpts);
                for (const act of [...avail, ...faded]) {
                    if (seenIds.has(act.id)) continue;
                    seenIds.add(act.id);
                    const isAvail = avail.some(x => x.id === act.id);
                    unionTiles.push(buildActivityListItem(act.id, act, a, partyState, isAvail));
                }
            }

            const assignments = buildActivityAssignments(app._characterChoices, app._earlyResults);
            foldOrphanedAssignmentsOntoOther(assignments, unionTiles.map(t => t.id));
            for (const tile of unionTiles) {
                applyActivityPortraitAssignments(tile, assignments[tile.id] ?? []);
            }

            // If the selected character already has a locked activity, downgrade all tiles to faded
            const charLocked = app._lockedCharacters?.has(app._selectedCharacterId)
                || (app._isGM && app._gmOverrides?.has(app._selectedCharacterId));
            if (charLocked) {
                for (const tile of unionTiles) {
                    tile.available = false;
                    tile.nonViable = false;
                }
            }

            // Detail panel data is built in the totmDetailPanel variable below.
            // Tiles do not carry expanded state ,  the grid is hidden entirely when detail is open.

            const tileMap = new Map(unionTiles.map(t => [t.id, t]));
            const terrain = app._selectedTerrain ?? app._engine?.terrainTag ?? "forest";
            const terrainStations = getStationsForTerrain(terrain, safeRestSpot);

            // Identify goes to a future tab; deduplicate activities across stations.
            const SKIP_STATIONS = new Set(["campfire"]);
            const IDENTIFY_TAB_IDS = new Set(["act_identify"]);
            const TOTM_LABELS = { medical_bed: "First Aid" };
            const TOTM_ORDER = { weapon_rack: 0, workbench: 1, cooking_station: 2, medical_bed: 3, bedroll: 4 };
            const usedIds = new Set();

            const cards = [];
            for (const station of terrainStations) {
                if (SKIP_STATIONS.has(station.id)) continue;

                const tiles = station.activities
                    .filter(id => !IDENTIFY_TAB_IDS.has(id) && !usedIds.has(id))
                    .map(id => tileMap.get(id))
                    .filter(Boolean);

                for (const t of tiles) usedIds.add(t.id);

                if (!tiles.length) continue;
                cards.push({
                    id: station.id,
                    label: TOTM_LABELS[station.id] ?? station.label,
                    icon: station.icon,
                    tiles
                });
            }
            cards.sort((a, b) => (TOTM_ORDER[a.id] ?? 99) - (TOTM_ORDER[b.id] ?? 99));
            return cards;
        })();

        // Single authoritative source: buildActivityDetailContext() from ActivityDetailBuilder.
        const totmDetailPanel = (() => {
            if (app._phase !== "activity") return null;
            if (!app._isTotM) return null;

            let expanded = app._totmFollowUpExpanded;
            const selectedId = app._selectedCharacterId;

            // After Training is confirmed, keep the detail view open until all sets are rolled.
            if (!expanded && selectedId
                && app._trainingStates?.has(selectedId)
                && !app._earlyResults?.has(selectedId)
                && app._characterChoices?.get(selectedId) === "act_train") {
                expanded = { activityId: "act_train", characterId: selectedId, trainingActive: true };
            }

            if (!expanded) return null;
            const expandActor = game.actors.get(expanded.characterId);
            if (!expandActor) return null;

            // so the template can reuse the station split-panel markup verbatim (no split-brain).
            if (expanded.isCrafting) {
                const professionId = expanded.profession;
                const professionLabels = {
                    cooking: "Cooking", alchemy: "Alchemy",
                    smithing: "Smithing", leatherworking: "Leatherworking",
                    brewing: "Brewing", tailoring: "Tailoring"
                };
                const engine = app._craftingEngine;
                const terrainTag = app._engine?.terrainTag ?? app._restData?.terrainTag ?? null;
                const risk = app._totmCraftRisk ?? "standard";
                const partySize = getPartyActors().length;
                const status = engine.getRecipeStatus(expandActor, professionId, terrainTag, partySize);

                // still-valid prior selection; falls back to the first available recipe.
                if (!app._totmCraftHasCrafted) {
                    app._totmCraftRecipeId = resolveDefaultCraftRecipeId({
                        engine,
                        actor: expandActor,
                        profession: professionId,
                        terrainTag,
                        partySize,
                        currentId: app._totmCraftRecipeId,
                        hasCrafted: false
                    });
                }

                const _formatBuffPreview = (buff) => {
                    if (!buff) return null;
                    const labels = { temp_hp: "Temp HP", advantage: "Advantage", exhaustion_save: "Exhaustion Save" };
                    const dur = { immediate: "Immediate", untilLongRest: "Until long rest", nextSave: "Next save" };
                    return { label: labels[buff.type] ?? buff.type, formula: buff.formula ?? "", duration: dur[buff.duration] ?? buff.duration ?? "", target: buff.target ?? "self" };
                };

                const enrichRecipe = (recipe) => {
                    const dcBreakdown = engine.getDcBreakdown(expandActor, recipe, risk, terrainTag);
                    const flags = recipe.outputFlags?.["ionrift-respite"];
                    return {
                        ...recipe,
                        dcDisplay: dcBreakdown.total,
                        dcBreakdown,
                        outputName: recipe.output?.name ?? "Unknown",
                        outputImg: recipe.output?.img ?? "icons/consumables/food/bowl-stew-brown.webp",
                        ambitiousOutput: recipe.ambitiousOutput,
                        isSelected: recipe.id === app._totmCraftRecipeId,
                        description: recipe.description ?? "",
                        buffPreview: _formatBuffPreview(flags?.buff),
                        isPartyMeal: !!flags?.partyMeal,
                        isWellFed: !!flags?.wellFed,
                        satiates: flags?.satiates ?? [],
                        ambitiousName: recipe.ambitiousOutput?.name ?? null,
                        ambitiousBuffPreview: _formatBuffPreview(
                            recipe.ambitiousOutputFlags?.["ionrift-respite"]?.buff ?? flags?.buff
                        ),
                        ingredientList: (recipe.ingredients ?? []).map(ing => {
                            const detail = recipe.ingredientStatus?.details?.find(d => d.name === ing.name);
                            const invKey = ing.name.toLowerCase().trim();
                            const invEntry = expandActor.items?.find(i => i.name.toLowerCase().trim() === invKey);
                            const fallbackIcon = ing.resourceType === "water"
                                ? "icons/magic/water/water-drop-swirl-blue.webp"
                                : "icons/consumables/food/bread-loaf-round-white.webp";
                            const rawImg = invEntry?.img;
                            return {
                                name: ing.name,
                                required: ing.quantity ?? 1,
                                available: detail?.available ?? 0,
                                met: detail?.met ?? false,
                                img: (rawImg && !rawImg.includes("mystery-man")) ? rawImg : fallbackIcon
                            };
                        })
                    };
                };

                const available = status.available.map(r => enrichRecipe(r));
                const partial = status.partial.map(r => enrichRecipe(r));
                const selectedRecipe = available.find(r => r.id === app._totmCraftRecipeId)
                    ?? partial.find(r => r.id === app._totmCraftRecipeId);

                let commitSummary = null;
                if (selectedRecipe && !app._totmCraftHasCrafted) {
                    const outputForRisk = risk === "ambitious" && selectedRecipe.ambitiousOutput
                        ? selectedRecipe.ambitiousOutput : selectedRecipe.output;
                    commitSummary = {
                        recipeName: selectedRecipe.name,
                        dc: selectedRecipe.dcBreakdown.total,
                        dcBreakdown: selectedRecipe.dcBreakdown,
                        risk,
                        riskLabel: { standard: "Standard", ambitious: "Ambitious" }[risk],
                        outputName: outputForRisk?.name ?? selectedRecipe.outputName,
                        outputImg: outputForRisk?.img ?? selectedRecipe.outputImg ?? "icons/svg/mystery-man.svg",
                        outputQuantity: outputForRisk?.quantity ?? 1,
                        ingredients: (selectedRecipe.ingredients ?? []).map(ing => {
                            const invKey = ing.name.toLowerCase().trim();
                            const invEntry = expandActor.items?.find(i => i.name.toLowerCase().trim() === invKey);
                            const fallbackIcon = ing.resourceType === "water"
                                ? "icons/magic/water/water-drop-swirl-blue.webp"
                                : "icons/consumables/food/bread-loaf-round-white.webp";
                            const rawImg = invEntry?.img;
                            return {
                                name: ing.name,
                                quantity: ing.quantity ?? 1,
                                img: (rawImg && !rawImg.includes("mystery-man")) ? rawImg : fallbackIcon
                            };
                        }),
                        ingredientCost: (selectedRecipe.ingredients ?? []).map(i => `${i.quantity ?? 1}x ${i.name}`).join(", "),
                        failConsequence: "Ingredients consumed on failure",
                        skill: (selectedRecipe.skill ?? "sur").toUpperCase()
                    };
                }

                return {
                    isCrafting: true,
                    name: professionLabels[professionId] ?? professionId,
                    icon: "fas fa-hammer",
                    actorName: expandActor.name,
                    actorPortrait: expandActor.img ?? expandActor.prototypeToken?.texture?.src ?? "icons/svg/mystery-man.svg",
                    // Station-compatible `crafting` sub-object (same shape as StationActivityDialog)
                    crafting: {
                        profession: professionLabels[professionId] ?? professionId,
                        professionId,
                        actorName: expandActor.name,
                        actorImg: expandActor.img,
                        selectedRisk: risk,
                        selectedRecipeId: app._totmCraftRecipeId,
                        hasCrafted: !!app._totmCraftHasCrafted,
                        rollPending: !!app._totmCraftRollPending,
                        showMissing: !!app._totmCraftShowMissing,
                        riskTiers: [
                            { id: "standard", label: "Standard", hint: "Base DC · Ingredients used", selected: risk === "standard" },
                            { id: "ambitious", label: "Ambitious", hint: "DC +5 · Better yield", selected: risk === "ambitious" }
                        ],
                        available,
                        partial,
                        noAvailableRecipes: !app._totmCraftHasCrafted && available.length === 0,
                        selectedRecipe: selectedRecipe ?? null,
                        isAmbitiousSelected: risk === "ambitious",
                        commitSummary,
                        craftingResult: app._totmCraftResult ? {
                            ...app._totmCraftResult,
                            isPartyMeal: !!(selectedRecipe?.isPartyMeal ?? false),
                            partyMealDispositionDone: !!app._totmFeastServed,
                            partyRoster: getPartyActors().map(a => ({
                                id: a.id,
                                name: a.name,
                                img: a.img || "icons/svg/mystery-man.svg",
                                alreadyWellFed: a.effects?.some(e => e.flags?.[MODULE_ID]?.wellFed === true) ?? false
                            }))
                        } : null
                    }
                };
            }

            const expandActivity = app._activityResolver?.activities?.get(expanded.activityId);
            if (!expandActivity) return null;
            const comfort = app._engine?.comfort ?? "sheltered";
            const existingFollowUp = app._gmFollowUps?.get(expanded.characterId) ?? null;
            let armorDoffSetting = false;
            try { armorDoffSetting = !!game.settings.get(MODULE_ID, "armorDoffRule"); } catch { /* ok */ }
            const armorRuleEnabled = !safeRestSpot && armorDoffSetting;
            const detail = buildActivityDetailContext(
                expanded.activityId, expandActivity, expandActor, partyState,
                {
                    comfort,
                    followUpValue: existingFollowUp,
                    armorRuleEnabled,
                    getArmorWarning: armorRuleEnabled
                        ? (app.getArmorWarningForActivityDetail?.bind(this) ?? null)
                        : null
                }
            );
            const trainingPending = expanded.activityId === "act_train"
                && app._trainingStates?.has(expanded.characterId)
                && !app._earlyResults?.has(expanded.characterId);
            const trainingPanel = trainingPending
                ? app._buildTrainingViewContext(expanded.characterId)
                : null;
            return {
                ...detail,
                actorName:    expandActor.name,
                actorPortrait: expandActor.img ?? expandActor.prototypeToken?.texture?.src ?? "icons/svg/mystery-man.svg",
                trainingPanel,
                isTrainingRolling: !!trainingPanel
            };
        })();

        // GM sees all as heroes since they manage all characters
        const heroCharacters = app._isGM
            ? characterStatuses
            : characterStatuses.filter(c => c.isOwner);
        const partyCharacters = app._isGM
            ? []
            : characterStatuses.filter(c => !c.isOwner);

        if (!app._selectedCharacterId && heroCharacters.length > 0) {
            app._selectedCharacterId = heroCharacters[0].id;
            closeStationDialogIfDifferentActor(app._selectedCharacterId);
        }
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

            // Travel phase: surface the travel declaration as the activity label
            if (!activityLabel && app._phase === "travel") {
                const activeDay = app._travelActiveDay ?? 1;
                const decl = app._isGM
                    ? (app._travel?.getDayDeclarations?.(activeDay)?.[c.id] ?? "nothing")
                    : (app._playerTravelDeclarations?.[activeDay]?.[c.id]
                        ?? app._syncedTravelDeclarations?.[activeDay]?.[c.id]
                        ?? app._syncedTravelDeclarations?.[c.id]
                        ?? "nothing");
                const TRAVEL_LABELS = { forage: "Forage", hunt: "Hunt", scout: "Scout" };
                activityLabel = TRAVEL_LABELS[decl] ?? null;
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
                        const act = app._activityResolver?.activities?.get(sub.activityId);
                        activitySummary.push({
                            name: o.characterName,
                            activityName: act?.name ?? sub.activityId ?? "Activity",
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

        // (positive) cluster and a Setbacks (negative) cluster so the report card no
        // longer interlaces pass/fail badges. Verdicts carry the activity/event name
        // so a "Failed" badge reads in context.
        const resolutionCards = app._phase === "resolve"
            ? app._buildResolutionCards(personalOutcomes ?? [])
            : [];

        let campScanData = null;
        let campMakeCampStep = 1;
        let campFireEncounterHint = "";
        let campFirePickerLevels = [];
        let campFireGatePit = false;
        let campFireGateLevel = false;
        let campColdCampDecided = false;
        let campComfortIsHostile = false;
        const _needsFireData = app._phase === "camp"
            || (app._phase === "activity" && app._isTotM && app._totmFireTabVisible());
        if (_needsFireData) {
            const terrainTagCamp = app._selectedTerrain ?? app._engine?.terrainTag ?? "forest";
            const terrainCamp = TerrainRegistry.get(terrainTagCamp);
            const shelterSpellCamp = (app._engine?.activeShelters ?? []).find(s => s !== "tent" && s !== "none")
                ? SHELTER_SPELLS[(app._engine?.activeShelters ?? []).find(s => s !== "tent" && s !== "none")]?.label ?? null
                : null;
            const campfirePlacedGate = hasCampfirePlaced();
            // Gate: fire is lit, OR table decided cold camp (no fire)
            const fireCommitted = (app._fireLevel ?? "unlit") !== "unlit" || !!app._coldCampDecided;
            campColdCampDecided = !!app._coldCampDecided;
            campMakeCampStep = 1;
            campFireGatePit = app._isTotM || !!app._engine?.safeRestSpot || campfirePlacedGate;
            campFireGateLevel = fireCommitted;
            // When fire hasn't been committed, preview defaults to "embers" (the
            // default highlighted tab), NOT "unlit" which applies a no-fire penalty.
            const effectiveScanLevel = (fireCommitted && (campfirePlacedGate || app._isTotM))
                ? (app._coldCampDecided ? "cold_camp" : (app._fireLevel ?? "unlit"))
                : (app._campFirePreviewLevel ?? (app._fireLevel !== "unlit" ? app._fireLevel : "embers"));
            const encMod = CampGearScanner.FIRE_ENCOUNTER_MOD_BY_LEVEL[effectiveScanLevel] ?? 0;
            // RestFlowEngine: effectiveDC = baseDC - campMods. Negative fireRollModifier
            // subtracts a negative, RAISING effectiveDC (harder to avoid encounters).
            // "Fire is a beacon"; see CampGearScanner.FIRE_ENCOUNTER_MOD_BY_LEVEL.
            if (effectiveScanLevel === "cold_camp") {
                campFireEncounterHint = "Cold camp: harder for enemies to spot (lower encounter chance).";
            } else if (effectiveScanLevel === "unlit") {
                campFireEncounterHint = "No fire is lit yet. The tier row shows what each level would do.";
            } else if (effectiveScanLevel === "embers") {
                campFireEncounterHint = "Embers: no change to encounter chance.";
            } else if (effectiveScanLevel === "campfire") {
                campFireEncounterHint = "Campfire: light makes the camp easier for enemies to spot.";
            } else if (effectiveScanLevel === "bonfire") {
                campFireEncounterHint = "Bonfire: visible from far off; enemies spot the camp easily.";
            } else {
                campFireEncounterHint = "";
            }
            const baseTerrainComfort = app._engine?.comfort
                ?? TerrainRegistry.getDefaults(terrainTagCamp).comfort
                ?? "rough";
            campScanData = CampGearScanner.scan(
                baseTerrainComfort,
                effectiveScanLevel,
                shelterSpellCamp,
                terrainCamp?.comfortReason ?? "",
                terrainCamp?.label ?? terrainTagCamp,
                encMod,
                !!app._engine?.safeRestSpot
            );
            const fs = campScanData.fireSelection ?? {};
            const cur = app._fireLevel ?? "unlit";
            const preview = app._campFirePreviewLevel ?? "embers";
            const coldSelected = !!app._coldCampDecided || (preview === "cold_camp");
            const hasTinder = campScanData?.canLightFire ?? false;
            const tierDisabledReason = (canPick, cost) => {
                if (canPick) return "";
                if (!hasTinder) return "Someone needs a tinderbox or flint and steel.";
                return `Need at least ${cost} firewood in the party.`;
            };
            campFirePickerLevels = [
                {
                    id: "embers",
                    label: "Embers",
                    costLabel: CampGearScanner.firewoodCostLabel("embers"),
                    disabled: !fs.canPickEmbers,
                    disabledReason: tierDisabledReason(fs.canPickEmbers, fs.costEmbers ?? 1),
                    selected: !coldSelected && (cur !== "unlit" ? cur === "embers" : preview === "embers")
                },
                {
                    id: "campfire",
                    label: "Campfire",
                    costLabel: CampGearScanner.firewoodCostLabel("campfire"),
                    disabled: !fs.canPickCampfire,
                    disabledReason: tierDisabledReason(fs.canPickCampfire, fs.costCampfire ?? 2),
                    selected: !coldSelected && (cur !== "unlit" ? cur === "campfire" : preview === "campfire")
                },
                {
                    id: "bonfire",
                    label: "Bonfire",
                    costLabel: CampGearScanner.firewoodCostLabel("bonfire"),
                    disabled: !fs.canPickBonfire,
                    disabledReason: tierDisabledReason(fs.canPickBonfire, fs.costBonfire ?? 3),
                    selected: !coldSelected && (cur !== "unlit" ? cur === "bonfire" : preview === "bonfire")
                }
            ];
        }

        let campFireIsLit = false;

        const _fireBillLevel = (app._fireLevel ?? "unlit") !== "unlit"
            ? app._fireLevel
            : (app._campFirePreviewLevel ?? "embers");
        const _COST_MAP = CampGearScanner.FIREWOOD_COST_BY_LEVEL;
        const campSelectedFirewoodCost = _COST_MAP[_fireBillLevel] ?? 0;
        const campPartyFirewood = campScanData?.totalFirewood ?? 0;
        const campHasEnoughFirewood = campPartyFirewood >= campSelectedFirewoodCost;
        const campCanLight = campScanData?.canLightFire ?? false;
        let campFireLitBy = null;
        let campFireLighters = [];
        let campFirewoodPledgeList = [];
        let campMyPledge = null;
        let campCanAddFirewood = false;
        let campMyFirewoodActorId = null;
        let campFireTierCards = [];
        let campFireTotalPledged = 0;
        let campViewerCanLight = false;
        let campFireOtherLighterCount = 0;
        let campFireLighterNames = "";
        if (_needsFireData && campScanData) {
            campFireIsLit = (app._fireLevel ?? "unlit") !== "unlit";
            campFireLitBy = app._fireLitBy ?? null;
            campFireTotalPledged = Array.from(app._firewoodPledges.values()).reduce((s, p) => s + p.count, 0);

            // Enrich fireLighters with cantrip-capable actors (from adapter)
            const rawLighters = campScanData.fireLighters ?? [];
            const OWNER = CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
            const fireCantrips = game.ionrift?.respite?.adapter?.getFireCantrips?.() ?? [];
            const cantripLighters = [];
            for (const actor of getPartyActors()) {
                if (rawLighters.some(l => l.actorId === actor.id)) continue; // already in tinderbox list
                const cantrip = fireCantrips.length > 0
                    ? actor.items.find(i => i.type === "spell" && (i.system?.level === 0) && fireCantrips.includes(i.name))
                    : null;
                if (cantrip) cantripLighters.push({ actorId: actor.id, actorName: actor.name, method: cantrip.name });
            }
            const rawLightersTagged = rawLighters.map(l => ({ ...l, methodType: "item", methodIcon: "fas fa-box" }));
            const cantripLightersTagged = cantripLighters.map(l => ({ ...l, methodType: "spell", methodIcon: "fas fa-magic" }));
            const allLighters = [...rawLightersTagged, ...cantripLightersTagged];

            // Resolve which lighters the current user can act on (owns the actor)
            campFireLighters = allLighters.map(l => ({
                ...l,
                isViewerActor: (game.actors.get(l.actorId)?.ownership?.[game.user.id] ?? 0) >= OWNER
            }));
            campViewerCanLight = campFireLighters.some(l => l.isViewerActor);
            if (app._campPitBlocksFireLighting()) campViewerCanLight = false;
            campFireLighterNames = campFireLighters.map(l => l.actorName).filter((v, i, a) => a.indexOf(v) === i).join(", ");
            campFireOtherLighterCount = campFireLighters.filter(l => !l.isViewerActor).length;

            // Firewood pledge list for summary display
            campFirewoodPledgeList = Array.from(app._firewoodPledges.values())
                .filter(p => p.count > 0)
                .map(p => ({ actorName: p.actorName, count: p.count }));

            // Current viewer's pledge
            campMyPledge = app._firewoodPledges.get(game.user.id) ?? null;

            // Can this user add firewood? Fire lit + under bonfire.
            // GM has infinite firewood; players need a party actor with enough wood.
            if (campFireIsLit && campFireTotalPledged < 2) {
                if (game.user.isGM) {
                    campCanAddFirewood = true;
                    campMyFirewoodActorId = "__gm__";
                } else {
                    const firewoodHolders = campScanData.firewoodHolders ?? [];
                    const myPledgeCount = campMyPledge?.count ?? 0;
                    const ownedWithWood = firewoodHolders.find(h => {
                        const a = game.actors.get(h.actorId);
                        return a && (a.ownership?.[game.user.id] ?? 0) >= OWNER && h.count > myPledgeCount;
                    });
                    if (ownedWithWood) {
                        campCanAddFirewood = true;
                        campMyFirewoodActorId = ownedWithWood.actorId;
                    }
                }
            }

            // Tier cards for map campfire dialog and camp context
            if (app._phase === "camp") {
                const TIER_BODIES = {
                    embers: "No cooking. No comfort change.",
                    campfire: "Cooking and warmth. Easier for enemies to spot.",
                    bonfire: "+1 camp comfort. Visible from far off."
                };
                const TIER_LABELS = Object.fromEntries(
                    COMFORT_TIERS.map(k => [k, CampGearScanner.getRules(k).label])
                );
                const baseComfort = campScanData.campComfortPreFire ?? campScanData.campComfort ?? "rough";
                const baseIdx = COMFORT_TIERS.indexOf(baseComfort);
                // Bonfire shifts comfort +1 tier; embers/campfire leave it unchanged
                const COMFORT_DELTA = { embers: 0, campfire: 0, bonfire: 1 };
                // Before the fire is committed, the selected tier is the live preview so the
                // clicked card highlights; once lit, it tracks the committed level.
                const selectedTier = (app._fireLevel ?? "unlit") !== "unlit"
                    ? app._fireLevel
                    : (app._coldCampDecided ? null : app._campFirePreviewLevel);
                campFireTierCards = ["embers", "campfire", "bonfire"].map(id => {
                    const delta = COMFORT_DELTA[id] ?? 0;
                    const resultIdx = Math.min(baseIdx + delta, COMFORT_TIERS.length - 1);
                    const resultComfort = COMFORT_TIERS[resultIdx] ?? baseComfort;
                    const resultLabel = TIER_LABELS[resultComfort] ?? resultComfort;
                    const comfortHint = delta !== 0
                        ? `${TIER_LABELS[baseComfort] ?? baseComfort} to ${resultLabel}`
                        : resultLabel;
                    return {
                        id,
                        label: id.charAt(0).toUpperCase() + id.slice(1),
                        costLabel: CampGearScanner.firewoodCostLabel(id),
                        body: TIER_BODIES[id],
                        comfortHint,
                        comfortChanged: delta !== 0,
                        active: selectedTier === id
                    };
                });
            }
        }
        if (campScanData) {
            campComfortIsHostile = (campScanData.campComfort ?? "rough") === "hostile";
        }

        const campPersonalSelected = campScanData && app._selectedCharacterId
            ? (campScanData.personalCards.find(p => p.actorId === app._selectedCharacterId) ?? null)
            : null;
        const campfirePlaced = app._phase === "camp" && hasCampfirePlaced();

        const campfireDragCard = (() => {
            if (app._phase !== "camp" || safeRestSpot || !app._isGM) return { show: false };
            const placed = campfirePlaced;
            if (app._isTotM) {
                const hint = placed
                    ? "On the map for this rest. Removed when the rest ends."
                    : "Optional. Drag onto the scene for a visual campfire.";
                const shortLabel = placed
                    ? (app._isGM ? "Move fire" : "On map")
                    : "Campfire";
                const tooltip = placed && app._isGM
                    ? "Click to pick a new map spot."
                    : hint;
                return {
                    show: true,
                    placed,
                    required: false,
                    canDrag: app._isGM && !placed,
                    canReclaim: app._isGM && placed,
                    hint,
                    shortLabel,
                    tooltip
                };
            }
            if (!isComfortEnabled()) return { show: false };
            const fireIsLit = (app._fireLevel ?? "unlit") !== "unlit";
            if (fireIsLit) return { show: false };
            const hint = placed
                ? "Station markers move with the campfire."
                : "Click for crosshair placement, or drag onto the map. Workstations appear around the pit.";
            const shortLabel = placed
                ? (app._isGM ? "Move fire" : "On map")
                : "Place fire";
            const tooltip = placed && app._isGM
                ? "Click to pick a new map spot. Station markers move with the campfire."
                : hint;
            return {
                show: true,
                placed,
                required: true,
                canDrag: app._isGM && !placed,
                canReclaim: app._isGM && placed,
                placementClick: app._isGM && !placed,
                hint,
                shortLabel,
                tooltip
            };
        })();

        const campfireCanMove = app._phase === "camp"
            && app._usesStationsMinimalCampShell()
            && app._isGM
            && campfirePlaced;

        const canProceedFromMakeCamp = (() => {
            if (app._phase !== "camp") return false;
            const comfortOn = isComfortEnabled();
            const mapCampFire = requiresMapCampFire();
            const coldCampPreview = !!app._coldCampPreview;
            const pitOk = app._isTotM || safeRestSpot
                || (!(comfortOn || mapCampFire) ? true : campfirePlaced);
            const fireOk = safeRestSpot
                || !(comfortOn || mapCampFire)
                || (app._fireLevel ?? "unlit") !== "unlit"
                || !!app._coldCampDecided
                || coldCampPreview;
            return fireOk && pitOk;
        })();

        const proceedBlockedHint = (() => {
            if (app._phase !== "camp") return "Light the fire or choose cold camp";
            const comfortOn = isComfortEnabled();
            const mapCampFire = requiresMapCampFire();
            if ((comfortOn || mapCampFire) && !app._isTotM && !safeRestSpot && !campfirePlaced) {
                return "Place the campfire on the map first";
            }
            if (comfortOn || mapCampFire) {
                return "Light the fire or choose cold camp";
            }
            return "Place the campfire on the map first";
        })();

        // Whether the Meal phase runs as a distinct step this rest (drives the stepper).
        // Matches the gate in #beginEvents: tracked food, Theater of the Mind, a long
        // rest, not a safe spot, and a terrain that actually imposes meal rules.
        const _mealStepTerrain = app._engine?.terrainTag ?? app._selectedTerrain ?? "forest";
        const _mealStepRules = TerrainRegistry.getDefaults(_mealStepTerrain)?.mealRules ?? {};
        const showMealStep = !!trackFoodSetting
            && app._isTotM
            && !safeRestSpot
            && (app._selectedRestType ?? "long") !== "short"
            && ((_mealStepRules.waterPerDay > 0) || (_mealStepRules.foodPerDay > 0));

        // Stepper pips: only show phases that actually run this rest, so the dot
        // count and labels match the real flow. Travel is long-rest + professions
        // only (mirrors the skip in #beginRest). Events are skipped on short rests
        // and safe rest spots (mirrors _advanceToEvents).
        const _stepRestType = app._selectedRestType ?? "long";
        let _enableProfessions = false;
        try { _enableProfessions = !!game.settings.get(MODULE_ID, "enableProfessions"); } catch (e) { /* */ }
        let _useTravel = true;
        try { _useTravel = !!game.settings.get(MODULE_ID, "useTravel"); } catch (e) { /* */ }
        const _includeTravelStep = _stepRestType === "long" && _enableProfessions && _useTravel;
        const _includeEventsStep = _stepRestType !== "short" && !setupSafeHaven;
        const _phaseStepDefs = [
            { key: "setup", label: "Setup", include: true },
            { key: "travel", label: "Travel", include: _includeTravelStep },
            { key: "camp", label: "Make Camp", include: true },
            { key: "activity", label: "Activities", include: true },
            { key: "meal", label: "Meal", include: showMealStep },
            { key: "events", label: "Events", include: _includeEventsStep },
            { key: "resolve", label: "Resolution", include: true }
        ].filter(s => s.include);
        const _currentStepIndex = _phaseStepDefs.findIndex(s => s.key === app._phase);
        const phaseSteps = _phaseStepDefs.map((s, i) => ({
            key: s.key,
            label: s.label,
            active: i === _currentStepIndex,
            complete: _currentStepIndex >= 0 && i < _currentStepIndex
        }));
        const phaseLabel = _currentStepIndex >= 0 ? _phaseStepDefs[_currentStepIndex].label : "";

        // Activity-phase "proceed" button label tracks the actual next step, so it
        // never promises a Rations stage that this configuration skips.
        const _activityNextStep = showMealStep ? "meal" : (_includeEventsStep ? "events" : "resolve");
        const activityProceed = ({
            meal:    { label: "Proceed to Rations", icon: "fas fa-arrow-right" },
            events:  { label: "Proceed to Events", icon: "fas fa-moon" },
            resolve: { label: "Proceed to Resolution", icon: "fas fa-arrow-right" }
        })[_activityNextStep];

        // Setup-screen summary of the settings that reshape this rest, so global
        // toggles read as local context instead of silently changing the flow.
        const restConfigBadges = (app._isGM && app._phase === "setup"
            && (app._selectedRestType ?? "long") !== "short")
            ? (() => {
                const g = (k) => { try { return !!game.settings.get(MODULE_ID, k); } catch (e) { return false; } };
                const comfort = g("enableComfort");
                const professions = g("enableProfessions");
                const meals = g("trackFood");
                const comfortActive = comfort && !setupSafeHaven;
                const professionsActive = professions && !isTavernSetup;
                const mealsActive = meals && !isTavernSetup;
                const comfortBypassTooltip = isTavernSetup
                    ? "Comfort bypassed: tavern rest is fully safe with automatic recovery."
                    : "Comfort bypassed: safe rest spot negates comfort penalties, fire, and exhaustion saves.";
                return [
                    { on: comfortActive, icon: "fas fa-temperature-half", label: "Comfort", tooltip: setupSafeHaven ? comfortBypassTooltip : comfort ? "Comfort tiers, fire, and exhaustion saves are on. Change under Recovery Rules." : "Comfort off: no fire phase and no terrain exhaustion saves. Change under Recovery Rules." },
                    { on: professionsActive, icon: "fas fa-hammer", label: "Professions", tooltip: isTavernSetup ? "Professions not offered at a tavern; personal activities only." : professions ? "Crafting professions and the travel phase are on. Change under Travel & Activities." : "Professions off: the travel phase is skipped. Change under Travel & Activities." },
                    { on: mealsActive, icon: "fas fa-drumstick-bite", label: "Meals", tooltip: isTavernSetup ? "Meals provided by the establishment; no ration tracking at a tavern." : meals ? "Food and water tracking is on; the Meal phase runs." : "Meal tracking off: no rations or dehydration saves. Change in module settings." }
                ];
            })()
            : [];

        return {
            isGM: app._isGM,
            isTheaterMode: app._isTotM,
            showFullMakeCampPanel: app._phase === "camp" && app._showFullMakeCampPanel(),
            stationsMinimalCampShell: app._phase === "camp" && app._usesStationsMinimalCampShell(),
            simpleStationsMode: isSimpleStationsMode(),
            workbenchIdentifyUiEnabled: isWorkbenchIdentifyUiEnabled(),
            encountersEnabled,
            showMealStep,
            phaseSteps,
            phaseLabel,
            activityProceed,
            restConfigBadges,
            totmActiveTab: app._totmActiveTab,
            showTotmCampfirePanel: app._shouldShowTotmCampfirePanel(),
            totmFireTabVisible: app._totmFireTabVisible(),
            totmStationCards,
            totmDetailPanel,
            totmCharacterLocked: (() => {
                const cid = app._selectedCharacterId;
                if (!cid) return null;
                const isLocked = app._lockedCharacters?.has(cid)
                    || (app._isGM && app._gmOverrides?.has(cid));
                if (!isLocked) return null;
                const actId = app._characterChoices?.get(cid);
                const act = actId ? app._activityResolver?.activities?.get(actId) : null;
                return act?.name ?? actId ?? "an activity";
            })(),
            ...(app._isTotM && app._phase === "activity" && app._totmActiveTab === "identify" && isWorkbenchIdentifyUiEnabled() ? (() => {
                const rosterSelected = app._selectedCharacterId || getPartyActors()[0]?.id || null;
                return app._workbench.buildEmbedContext(rosterSelected, getPartyActors);
            })() : {}),
            emptyParty,
            emptyPartyReason,
            partySetupWarning,
            showPartyRosterEditor,
            rosterInfo: (() => {
                const roster = getPartyActors();
                return {
                    count: roster.length,
                    names: roster.map(a => a.name),
                    portraits: roster.slice(0, 6).map(a => ({
                        img: a.img ?? "icons/svg/mystery-man.svg",
                        name: a.name
                    })),
                    overflow: Math.max(0, roster.length - 6)
                };
            })(),
            trackFood: trackFoodSetting,
            setupAdvancedOpen: !!app._setupAdvancedOpen,
            gmCopySpellProposal: app._gmCopySpellProposal ?? null,
            copySpellRollPrompt: app._copySpellRollPrompt ?? null,
            copySpellRollRequest: buildCopySpellRollContext(app._copySpellRollPrompt),
            phase: app._phase,
            postStationChoiceReview: !app._isGM && app._phase === "activity" && !!app._postStationChoiceReview,
            activitySubTab: null,
            travelContext: (() => {
                if (app._phase !== "travel") return null;
                const terrainTag = app._selectedTerrain ?? app._engine?.terrainTag ?? "forest";
                if (app._isGM) {
                    return app._travel.buildContext(partyActors, terrainTag);
                }
                // Player-side context: multi-day aware
                const terrain = TerrainRegistry.get(terrainTag);
                const allowed = terrain?.travelActivities ?? ["forage", "hunt", "scout"];
                const syncedGather = app._syncedTravelGather;
                const { canForage, canHunt } = syncedGather
                    ? { canForage: !!syncedGather.canForage, canHunt: !!syncedGather.canHunt }
                    : getTravelGatherAvailability(terrain?.travelActivities);
                const scoutAllowed = isScoutingEnabled() && (app._travelScoutingAllowed ?? true);
                const canScout = syncedGather?.canScout != null
                    ? !!syncedGather.canScout
                    : (!safeRestSpot && allowed.includes("scout") && scoutAllowed);
                const hasTravelOptions = canForage || canHunt || canScout;
                let disabledReason = null;
                if (!canForage && !canHunt) {
                    const label = terrain?.label ?? terrainTag;
                    if (terrainTag === "tavern") {
                        disabledReason = `No need to forage or hunt at a ${label}. Supplies are available for purchase.`;
                    } else if (terrainTag === "dungeon") {
                        disabledReason = `Foraging and hunting are not possible in a ${label}. The party must rely on supplies.`;
                    } else if (terrainTag === "urban") {
                        disabledReason = `Foraging and hunting are not available in an ${label} environment. Markets and shops serve that need.`;
                    } else {
                        disabledReason = `Foraging and hunting are not available in ${label}.`;
                    }
                }
                const totalDays = app._travelTotalDays ?? 1;
                const activeDay = app._travelActiveDay ?? 1;
                const localDecl = app._playerTravelDeclarations ?? {};
                const syncedDecl = app._syncedTravelDeclarations ?? {};

                const buildChars = (day) => {
                    const dayLocal = localDecl[day] ?? {};
                    const daySynced = syncedDecl[day] ?? syncedDecl; // fallback flat for compat
                    const chars = partyActors.map(a => {
                        const decl = a.isOwner
                            ? (dayLocal[a.id] ?? daySynced[a.id] ?? "nothing")
                            : (daySynced[a.id] ?? "nothing");
                        const lastAct = a.getFlag?.("ionrift-respite", "lastTravelActivity") ?? null;
                        const lastLabel = lastAct === "forage" ? "Forage"
                            : lastAct === "hunt" ? "Hunt"
                            : lastAct === "scout" ? "Scout" : null;
                        const confirmed = a.isOwner
                            ? !!(app._playerTravelConfirmed?.[day]?.[a.id]
                                || daySynced._confirmed?.[a.id])
                            : !!(syncedDecl[day]?._confirmed?.[a.id] ?? daySynced._confirmed?.[a.id]);
                        const rolled = !!(app._playerTravelRolled?.[day]?.[a.id]
                            || app._syncedTravelRolled?.[day]?.[a.id]
                            || app._syncedTravelResolved?.[day]?.[a.id]);
                        const awaitingLootInfo = app._playerTravelAwaitingLoot?.[day]?.[a.id]
                            ?? app._syncedTravelAwaitingLoot?.[day]?.[a.id];
                        const awaitingLoot = !!awaitingLootInfo;
                        const lootDraws = awaitingLootInfo?.lootDraws ?? 1;
                        const forageDC = app._travelForageDC ?? 12;
                        const huntDC = app._travelHuntDC ?? 14;
                        return {
                            id: a.id,
                            name: a.name,
                            img: a.img ?? "icons/svg/mystery-man.svg",
                            isOwner: a.isOwner,
                            confirmed,
                            rolled,
                            awaitingLoot,
                            lootDraws,
                            lastActivity: lastLabel,
                            showLastHint: !!(lastLabel && lastAct !== decl),
                            survivalMod: (() => {
                                const _adapter = game.ionrift?.respite?.adapter;
                                const sur = _adapter ? _adapter.getSkillTotal(a, "sur") : (a.system?.skills?.sur?.total ?? 0);
                                const nat = _adapter ? _adapter.getSkillTotal(a, "nat") : (a.system?.skills?.nat?.total ?? 0);
                                const best = Math.max(sur, nat);
                                return (best >= 0 ? "+" : "") + best;
                            })(),
                            declaration: decl,
                            declarationIcon: decl === "forage" ? "fa-seedling"
                                : decl === "hunt" ? "fa-crosshairs"
                                : decl === "scout" ? "fa-binoculars" : null,
                            declarationLabel: decl === "forage" ? "Forage"
                                : decl === "hunt" ? "Hunt"
                                : decl === "scout" ? "Scout" : null,
                            activityFlavor: decl === "forage"
                                ? `Search for edible plants and fungi along the route. A strong roll yields exceptional finds. Survival, DC ${forageDC}.`
                                : decl === "hunt"
                                ? `Track and bring down game while travelling. Harder than foraging, but a good result means more food for the party. Survival, DC ${huntDC}.`
                                : decl === "scout"
                                ? `Survey the terrain on arrival to find a good campsite. Better scouting improves camp comfort and reduces the chance of a night encounter.`
                                : `Travel without a specific task. Tend wounds, keep watch, or handle personal business. Let the GM know what you're up to.`
                        };
                    });
                    chars.sort((a, b) => (b.isOwner ? 1 : 0) - (a.isOwner ? 1 : 0));
                    return chars;
                };

                const days = [];
                for (let d = 1; d <= totalDays; d++) {
                    const isFinalDay = d === totalDays;
                    const chars = buildChars(d);
                    const owned = chars.filter(c => c.isOwner);
                    days.push({
                        day: d,
                        label: totalDays === 1 ? null : `Day ${d}`,
                        isFinalDay,
                        canScout: isFinalDay && canScout,
                        isActive: d === activeDay,
                        characters: chars,
                        playerDone: owned.length > 0 && owned.every(c => c.confirmed || (c.rolled && !c.awaitingLoot))
                    });
                }

                const forageGate = app._travel?.getForageGate?.(terrainTag)
                    ?? { disabled: true, disabledReasonKey: "ionrift-respite.travel.forage.requires_pack" };
                const forageDisabled = canForage && forageGate.disabled;
                const forageDisabledReasonKey = forageDisabled ? forageGate.disabledReasonKey : null;

                // so the travel phase can use {{> rosterStrip}} like every other phase.
                const activeChars = (days.find(d => d.isActive)?.characters ?? []);
                const travelPeerRoster = activeChars
                    .filter(c => !c.isOwner)
                    .map(c => ({
                        id: c.id,
                        name: c.name.split(" ")[0],
                        fullName: c.name,
                        img: c.img ?? "icons/svg/mystery-man.svg",
                        source: c.confirmed ? "player" : "pending",
                        isOwner: false,
                        isSelected: false,
                        isAfk: false,
                        isBeddedDown: false,
                        exhaustion: null,
                        pendingRoll: false,
                        rolledResult: c.rolled ? "done" : null,
                        // Show declaration as the activity label (Forage, Hunt, Scout, or null for Other)
                        activityLabel: c.declarationLabel ?? null,
                        mealStatus: null
                    }));

                return {
                    days,
                    totalDays,
                    isMultiDay: totalDays > 1,
                    activeDay,
                    canForage, canHunt, canScout, hasTravelOptions,
                    travelSkipRecommended: !canForage && !canHunt,
                    disabledReason,
                    terrainTag,
                    terrainLabel: terrain?.label ?? terrainTag,
                    hasOwnedCharacters: partyActors.some(a => a.isOwner),
                    forageDC: app._travelForageDC ?? 12,
                    huntDC: app._travelHuntDC ?? 14,
                    forageDisabled,
                    forageDisabledReasonKey,
                    forageDisabledTooltip: forageDisabledReasonKey
                        ? game.i18n.localize(forageDisabledReasonKey)
                        : null,
                    travelPeerRoster
                };
            })(),
            pendingTravelRoll: app._pendingTravelRoll ? (() => {
                const activities = (app._pendingTravelRoll.activities ?? []).map(a => {
                    const actor = game.actors.get(a.actorId);
                    const isOwner = actor?.isOwner ?? false;
                    const rolled = app._pendingTravelRoll.rolledCharacters?.has(a.actorId) ?? false;
                    const enriched = { ...a, isOwner, rolled, actorName: actor?.name ?? a.actorId, activityLabel: a.activityLabel ?? a.activity };
                    return {
                        ...enriched,
                        rollRequest: buildTravelActivityRollContext(enriched, app._pendingTravelRoll.rolledCharacters)
                    };
                });
                return { activities };
            })() : null,
            travelDebrief: app._travelDebrief?.length ? app._travelDebrief : null,
            travelFullyResolved: app._travelFullyResolved ?? false,
            travelScoutingDone: app._travelScoutingDone ?? false,
            scoutingDebrief: app._isGM ? (() => {
                if (app._travel?.isEffectiveSafeRestSpot?.()) return null;
                if (app._travel?.scoutingResult) {
                    const terrainTag = app._selectedTerrain ?? app._engine?.terrainTag ?? "forest";
                    app._scoutingDebrief ??= app._travel.getScoutingDebrief(terrainTag);
                    return app._scoutingDebrief;
                }
                return null;
            })() : null,
            terrainOptionGroups: (() => {
                const lastTerrain = game.settings.get(MODULE_ID, "lastTerrain");
                return TerrainRegistry.getOptionGroups({ lastTerrain });
            })(),
            terrainPreview: (() => {
                const t = app._selectedTerrain ?? "forest";
                const d = TerrainRegistry.getDefaults(t);
                const comfort = (d.comfort ?? "sheltered").charAt(0).toUpperCase() + (d.comfort ?? "sheltered").slice(1);
                const travel = setupSafeHaven
                    ? (isTavernSetup
                        ? "Tavern rest: no travel activities."
                        : "Travel activities are skipped for a safe rest spot.")
                    : (d.travelAvailable ? "Travel available (forage, hunt, scout)." : "No travel activities.");
                return `Implied comfort: ${comfort}. ${travel}`;
            })(),
            setupStatusLine: (() => {
                const t = app._selectedTerrain ?? "forest";
                const d = TerrainRegistry.getDefaults(t);
                const comfort = (d.comfort ?? "sheltered").charAt(0).toUpperCase() + (d.comfort ?? "sheltered").slice(1);
                const parts = [`${comfort} camp`];
                const w = app._resolveSetupWeather(t);
                const wData = WEATHER_TABLE[w];
                if (wData && (wData.comfortPenalty > 0 || wData.encounterDC !== 0)) {
                    const fx = [];
                    if (wData.comfortPenalty > 0) fx.push(`comfort −${wData.comfortPenalty}`);
                    if (wData.encounterDC > 0) fx.push(`encounter DC +${wData.encounterDC}`);
                    if (wData.encounterDC < 0) fx.push(`encounter DC ${wData.encounterDC}`);
                    parts.push(fx.join(", "));
                }
                if (!setupSafeHaven && d.travelAvailable) parts.push("travel available");
                if (tavernForcesTotm) parts.push("one-window flow for tavern");
                return parts.join(" · ");
            })(),
            weatherOptions: (() => {
                const terrain = app._selectedTerrain ?? "forest";
                const defaultKey = TerrainRegistry.getWeather(terrain)[0] ?? "clear";
                let lastWeather = "";
                try {
                    lastWeather = game.settings.get(MODULE_ID, "lastWeather") ?? "";
                } catch { /* settings not ready */ }
                return TerrainRegistry.getWeather(terrain)
                    .map(key => ({ value: key, ...WEATHER_TABLE[key] }))
                    .filter(w => w.label)
                    .map(w => {
                        const isDefault = w.value === defaultKey;
                        const isLast = lastWeather && w.value === lastWeather;
                        if (isDefault && isLast) return { ...w, label: `${w.label} (Default, last used)` };
                        if (isDefault) return { ...w, label: `${w.label} (Default)` };
                        if (isLast) return { ...w, label: `${w.label} (last used)` };
                        return w;
                    });
            })(),
            defaultWeather: TerrainRegistry.getWeather(app._selectedTerrain ?? "forest")[0] ?? "clear",
            selectedWeather: app._selectedWeather ?? app._resolveSetupWeather(app._selectedTerrain ?? "forest"),
            comfortOptions: (() => {
                const opts = [
                    { value: "safe", label: "Safe", hint: "Full HP. HD: half level recovered. No exhaustion risk. Taverns, strongholds, warded sanctuaries." },
                    { value: "sheltered", label: "Sheltered", hint: "Full HP. HD: half level recovered. No exhaustion risk. Caves, solid ruins, decent cover." },
                    { value: "rough", label: "Rough", hint: "Full HP. HD: half level minus 1 recovered. CON DC 10 or +1 exhaustion. Open wilderness, exposed camps." },
                    { value: "hostile", label: "Hostile", hint: "3/4 HP. HD: half level minus 2 recovered. CON DC 15 or +1 exhaustion. Enemy territory, cursed ground." }
                ];
                const match = opts.find(o => o.value === defaultComfort);
                if (match) match.label += " (terrain default)";
                return opts;
            })(),
            comfortReason: TerrainRegistry.get(app._selectedTerrain ?? "forest")?.comfortReason ?? "",
            restModeOptions: (() => {
                const current = app._isTotM ? "theater" : "stations";
                return [
                    { value: "theater", label: "One window", selected: current === "theater" },
                    { value: "stations", label: "Camp stations", selected: current === "stations" }
                ];
            })(),
            setupStep: app._setupStep ?? 1,
            selectedTerrain: app._selectedTerrain ?? "forest",
            terrainBanner: (() => {
                const t = app._selectedTerrain ?? app._engine?.terrainTag ?? "forest";
                const p = app._phase ?? "setup";
                
                // All terrains look in their specific folder.
                const filename = (p === "activity" || p === "meal" || p === "travel" || p === "camp") ? "banner.png" : `${p}.png`;
                return ImageResolver.terrainBanner(t, filename);
            })(),
            terrainBannerFallback: ImageResolver.fallbackBanner,
            terrainBannerPos: "center", // banners are pre-cropped 640x120 strips
            selectedTerrainLabel: app._terrainLabel ?? "Forest",
            selectedRestType: app._selectedRestType ?? "long",
            selectedRestTypeLabel: app._selectedRestType === "short" ? "Short Rest" : "Long Rest",
            isShortRest: (app._selectedRestType ?? "long") === "short",
            safeRestSpot,
            safeRestSpotDisplay: setupSafeHaven,
            safeRestLocked: isTavernSetup,
            safeRestPulse: !!app._safeRestPulseAlert,
            safeRestTooltip: isTavernSetup
                ? "Tavern rests are always safe: no encounters, automatic recovery, and no comfort pressure. Safe Rest cannot be turned off here."
                : "No encounter risk. Skips night events, comfort penalties, and camp defense. Activities, cooking, and identification only.",
            setupSafeHaven,
            isTavernSetup,
            tavernForcesTotm,
            selectedWeatherLabel: WEATHER_TABLE[app._resolveSetupWeather(app._selectedTerrain ?? "forest")]?.label ?? "Clear",
            shelterNeeded: (app._selectedTerrain ?? "forest") !== "tavern",
            defaultComfort,
            shelterOptions,
            shelterEffect,
            shelterChosen,
            heroCharacters,
            roster,
            canvasFocusedStationId: app._canvasFocusedStationId ?? null,
            selectedCharacter,
            partyCharacters,
            totalCharacters,
            resolvedCount,
            allResolved,
            activityPhasePlayerOverview,
            outcomes: personalOutcomes ?? [],
            resolutionCards,
            triggeredEvents: (app._triggeredEvents ?? []).map((e, eventIndex) => {
                // Resolve target IDs to actor names for the template
                const eventRollModes = e.rollModes ?? {};
                const targetActors = (e.targets ?? [])
                    .map(id => game.actors.get(id))
                    .filter(Boolean)
                    .map(a => {
                        const rollMode = eventRollModes[a.id] ?? "normal";
                        return {
                            id: a.id,
                            name: a.name,
                            img: a.img || "icons/svg/mystery-man.svg",
                            rollMode,
                            rollModeAdvantage: rollMode === "advantage",
                            rollModeDisadvantage: rollMode === "disadvantage"
                        };
                    });
                const targetNames = targetActors.map(a => a.name);
                const skillName = e.mechanical?.skill
                    ? (SKILL_NAMES[e.mechanical.skill] ?? e.mechanical.skill)
                    : null;
                // Backfill GM narration from the live catalog by id. Events persisted
                // before these fields existed (or built by inline paths) carry only an
                // id, so rehydrate the authored copy. GM-only: players get a stripped
                // copy and must not regain this content via the catalog.
                const catalog = app._isGM ? app._eventResolver?.events?.get(e.id) : null;
                const gmPrompt = e.gmPrompt ?? catalog?.gmPrompt ?? null;
                const gmGuidance = e.gmGuidance ?? catalog?.gmGuidance ?? null;
                const description = e.description ?? catalog?.description ?? null;
                const targetScope = e.mechanical?.targets === "all" ? "the whole party" : "the watch";
                const checkContext = e.checkContext ?? catalog?.checkContext
                    ?? (skillName ? `${skillName} check for ${targetScope}.` : null);
                const readAloud = gmPrompt || description || e.narrative || null;
                // Enrich resolved rolls with ownership for player-side filtering
                const resolvedRolls = (e.resolvedRolls ?? []).map(r => ({
                    ...r,
                    isOwner: game.actors.get(r.characterId)?.isOwner ?? false
                }));
                // Player-facing forewarning of locked consequences. Once the GM
                // locks a hit or a loss, each affected player sees what is coming
                // on the far side of the rest, phrased without GM mechanics.
                const playerConsequences = [];
                if (e.resolvedOutcome && !["success", "triumph"].includes(e.resolvedOutcome)) {
                    const consTierKey = { mixed: "onMixed", failure: "onFailure" }[e.resolvedOutcome] ?? "onFailure";
                    const consEffects = e.mechanical?.[consTierKey]?.effects ?? e.mechanical?.onFailure?.effects ?? [];
                    for (const eff of consEffects) {
                        if (!eff._locked) continue;
                        if (eff.type === "damage" && Array.isArray(eff._lockedTargets)) {
                            for (const t of eff._lockedTargets) {
                                if (!(app._isGM || app._myCharacterIds?.has(t.id))) continue;
                                if (!(t.amount > 0)) continue;
                                playerConsequences.push({ icon: "fa-heart-broken", text: `${t.name} takes ${t.amount} damage after the rest.` });
                            }
                        } else if (eff.type === "consume_resource" && eff._lockedLoss) {
                            const loss = eff._lockedLoss;
                            for (const grp of (loss.provisionGroups ?? [])) {
                                playerConsequences.push({ icon: "fa-box-open", text: `The party loses ${grp.total} ${grp.kind} after the rest.` });
                            }
                            for (const g of (loss.gear ?? [])) {
                                if (!(app._isGM || app._myCharacterIds?.has(g.actorId))) continue;
                                const label = g.lossQty > 1 ? `${g.itemName} x${g.lossQty}` : g.itemName;
                                playerConsequences.push({ icon: "fa-times-circle", text: `${g.actorName} loses ${label} after the rest.` });
                            }
                        } else if (eff.type === "item_at_risk" && Array.isArray(eff._lockedItems)) {
                            // The specific haul stays hidden until it is committed at
                            // resolution. Players only learn that gear will go missing,
                            // so the GM can re-roll the selection without spoiling it.
                            const affectsMe = eff._lockedItems.some(li => app._isGM || app._myCharacterIds?.has(li.actorId));
                            if (affectsMe && eff._lockedItems.length) {
                                playerConsequences.push({ icon: "fa-mask", text: `A thief is going through the packs. Some gear will be missing after the rest.` });
                            }
                        } else if (eff.type === "consume_gold" && eff._lockedGold) {
                            const affectsMe = (eff._lockedGold.breakdown ?? []).some(b => (app._isGM || app._myCharacterIds?.has(b.actorId)) && b.lossGp > 0);
                            if (affectsMe && eff._lockedGold.totalLoss > 0) {
                                playerConsequences.push({ icon: "fa-coins", text: `Coin will be lighter after the rest.` });
                            }
                        }
                    }
                }
                return { ...e, targetNames, targetActors, skillName, gmPrompt, gmGuidance, description, checkContext, readAloud, resolvedRolls, playerConsequences,
                    gmRollRequest: e.awaitingRolls && app._isGM ? buildEventGmRollContext({ ...e, skillName, checkContext }, eventIndex) : null
                };
            }),
            // A skill-check event blocks resolution only until it has an outcome.
            // Once resolvedOutcome is set the check is done; a lingering
            // awaitingRolls flag (e.g. from a force-resolve on stale state) must
            // not re-lock Proceed.
            allEventChecksResolved: !(app._triggeredEvents ?? []).some(
                e => e.mechanical?.type === "skill_check" && !e.resolvedOutcome
            ),
            // Every failed-event damage/loss consequence must be GM-locked before
            // the rest can proceed, so each lands deliberately on the far side.
            allConsequencesResolved: !(app._triggeredEvents ?? []).some(e => {
                // Resolved disaster trees carry no resolvedOutcome but still gate
                // on their committed losses (read from the synthetic onFailure tier).
                const isTree = e.treeOutcome === true;
                if (!isTree && (!e.resolvedOutcome || ["success", "triumph"].includes(e.resolvedOutcome))) return false;
                const tierKey = { mixed: "onMixed", failure: "onFailure" }[e.resolvedOutcome] ?? "onFailure";
                const effects = e.mechanical?.[tierKey]?.effects ?? e.mechanical?.onFailure?.effects ?? [];
                return effects.some(eff => (eff.type === "damage" || eff.type === "consume_resource" || eff.type === "item_at_risk" || eff.type === "consume_gold" || eff.type === "supply_loss") && !eff._locked);
            }),
            anyEventAwaitingRolls: (app._triggeredEvents ?? []).some(e => e.awaitingRolls),
            pendingEventRoll: app._pendingEventRoll ? (() => {
                const ownedTargets = (app._pendingEventRoll.targets ?? [])
                    .map(id => game.actors.get(id))
                    .filter(a => a?.isOwner)
                    .map(a => ({
                        id: a.id,
                        name: a.name,
                        rolled: app._pendingEventRoll.rolledCharacters?.has(a.id) ?? false
                    }));
                const merged = { ...app._pendingEventRoll, ownedTargets };
                const triggeredEvent = app._triggeredEvents?.[app._pendingEventRoll.eventIndex] ?? null;
                return {
                    ...merged,
                    rollRequest: buildEventPlayerRollContext(merged, triggeredEvent)
                };
            })() : null,
            pendingTreeRoll: app._pendingTreeRoll ? {
                ...app._pendingTreeRoll,
                rollRequest: buildTreePlayerRollContext(app._pendingTreeRoll)
            } : null,
            actorLookup: (() => {
                const lookup = {};
                for (const a of getPartyActors()) {
                    lookup[a.id] = { name: a.name, img: a.img };
                }
                return lookup;
            })(),
            eventsRolled: app._eventsRolled ?? false,
            eventsCommitPending: app._eventsCommitPending ?? false,
            pendingCampRolls: app._pendingCampRolls ?? [],
            campPrepsResolved: !app._pendingCampRolls?.length || app._pendingCampRolls.every(p => p.status !== "pending"),
            pendingCampRoll: app._pendingCampRoll ? {
                activities: (app._pendingCampRoll.activities ?? []).filter(a => {
                    const actor = game.actors.get(a.characterId);
                    return actor?.isOwner;
                }).map(a => ({
                    ...a,
                    rolled: app._pendingCampRoll.rolledCharacters?.has(a.characterId) ?? false,
                    status: a.status ?? "pending",
                    total: a.total ?? null,
                    rollRequest: (a.status === "pass" || a.status === "fail")
                        ? null
                        : buildCampActivityRollContext(a, app._pendingCampRoll.rolledCharacters)
                }))
            } : null,
            disasterChoice: app._disasterChoice ? (() => {
                const dc = app._disasterChoice;
                const normalsLabel = (dc.normals?.length ?? 0) > 1
                    ? "Two Complications" : "One Complication";
                let n = 1;
                const treeNum = dc.tree ? n++ : 0;
                const encounterNum = dc.encounter ? n++ : 0;
                const normalsNum = dc.normals?.length ? n++ : 0;
                return {
                    ...dc,
                    normalsLabel,
                    treeNum, encounterNum, normalsNum,
                    optionCount: n - 1
                };
            })() : null,
            hasEncounterEvent: (app._triggeredEvents ?? []).some(e => e.category === "encounter" && !["success", "triumph"].includes(e.resolvedOutcome)) && !app._awaitingCombat && !app._combatAcknowledged,
            combatBuffs: app._combatBuffs ?? null,
            awaitingCombat: app._awaitingCombat ?? false,
            encounterAwareness: (() => {
                const enc = (app._triggeredEvents ?? []).find(e => e.category === "encounter" && !["success", "triumph"].includes(e.resolvedOutcome));
                if (!enc) return null;
                const hints = enc.mechanical?.onFailure?.effects?.find(ef => ef.type === "encounter")?.encounterHints;
                return hints?.awareness ?? null;
            })(),
            fireLevel: app._fireLevel ?? "unlit",
            campfireTokenDetected: CampfireTokenLinker.hasCampfireToken(),
            campfireTokenSettingName: CampfireTokenLinker.getTokenName(),
            activeTreeState: (() => {
                const ts = app._activeTreeState;
                if (!ts) return null;
                // Enrich pending rolls with actor name and rollMode for clean template iteration
                const rollModes = ts.pendingRollModes ?? {};
                const pendingRollsEnriched = (ts.pendingRolls ?? []).map(id => {
                    const actor = game.actors.get(id);
                    const rollMode = rollModes[id] ?? "normal";
                    return {
                        id,
                        name: actor?.name ?? id,
                        img: actor?.img || "icons/svg/mystery-man.svg",
                        rollMode,
                        rollModeAdvantage: rollMode === "advantage",
                        rollModeDisadvantage: rollMode === "disadvantage",
                        rollModeForcePass: rollMode === "force-pass",
                        rollModeForceFail: rollMode === "force-fail"
                    };
                });
                // Once resolved, bind the consequence list to the canonical copy on
                // the triggered event so Roll & lock state stays live, and expose
                // the event index the lock buttons need.
                let finalEffects = ts.finalEffects;
                let eventIndex = -1;
                if (ts.resolved) {
                    eventIndex = (app._triggeredEvents ?? []).findIndex(e => e.id === ts.eventId);
                    const te = app._triggeredEvents?.[eventIndex];
                    if (te?.mechanical?.onFailure?.effects) finalEffects = te.mechanical.onFailure.effects;
                }
                // Number the options for the choice cards (Option 1, Option 2, ...).
                const options = (ts.options ?? []).map((o, i) => ({ ...o, optionNum: i + 1 }));
                const treeEvent = (app._triggeredEvents ?? []).find(e => e.id === ts.eventId);
                const gmPrompt = ts.gmPrompt ?? treeEvent?.gmPrompt ?? "";
                const checkContext = ts.checkContext ?? treeEvent?.checkContext ?? null;
                let readAloud = ts.readAloud;
                let showDecisionPrompt = ts.showDecisionPrompt;
                if (!readAloud) {
                    const narration = DecisionTreeResolver.computeNarrationFields(
                        { gmPrompt, description: ts.description },
                        { prompt: ts.prompt },
                        ts.depth ?? 0
                    );
                    readAloud = narration.readAloud;
                    showDecisionPrompt = narration.showDecisionPrompt;
                }
                let treeDcAdjNote = null;
                const treeDcAdj = ts.treeDcAdj ?? 0;
                if (treeDcAdj !== 0) {
                    const mag = Math.abs(treeDcAdj);
                    const tier = treeDcAdj > 0 ? "higher" : "lower";
                    const who = (ts.options?.length === 2) ? "Both choices" : "Every choice";
                    treeDcAdjNote = `${who} are ${mag} DC ${tier}`;
                }
                return {
                    ...ts,
                    gmPrompt,
                    checkContext,
                    readAloud,
                    showDecisionPrompt: !!showDecisionPrompt,
                    treeDcAdjNote,
                    options,
                    pendingRollsEnriched,
                    finalEffects,
                    eventIndex
                };
            })(),
            engine: app._engine,
            recoverySummary,
            activitySummary,
            partyDiscoveries,
            grantActors: getPartyActors().map(a => ({ id: a.id, name: a.name })),
            activityDetail: app._buildActivityDetailContext(selectedCharacter),
            campStatus: app._engine ? (() => {
                const rawComfort = app._engine.comfort;
                const fireIsLit = (app._fireLevel ?? "unlit") !== "unlit";
                const activeShelters = app._engine.activeShelters ?? [];
                const shelterSpell = activeShelters.find(s => s !== "tent" && s !== "none") ? SHELTER_SPELLS[activeShelters.find(s => s !== "tent" && s !== "none")]?.label ?? null : null;
                const tiers = RANK_TO_KEY;
                let effectiveIdx = COMFORT_RANK[rawComfort] ?? COMFORT_RANK.rough;
                if (shelterSpell) {
                    effectiveIdx = Math.max(effectiveIdx, COMFORT_RANK.sheltered);
                }
                if (fireIsLit) effectiveIdx = Math.min(COMFORT_RANK.safe, effectiveIdx + 1);
                const comfort = RANK_TO_KEY[effectiveIdx];

                const weatherKey = app._engine.weather ?? "clear";
                const wx = WEATHER_TABLE[weatherKey] ?? WEATHER_TABLE.clear;
                const weatherParts = [];
                if (wx.comfortPenalty > 0) weatherParts.push(`Comfort -${wx.comfortPenalty} step`);
                if (wx.encounterDC > 0) weatherParts.push(`Night check mod +${wx.encounterDC}`);
                if (wx.tentCancels) weatherParts.push("Tent cancels");
                else if (wx.tentReduces) weatherParts.push("Tent reduces by 1");
                const SHELTER_TOOLTIPS = {
                    tent: "Tent: encounter threshold -2, cancels or reduces weather",
                    tiny_hut: "Tiny Hut: comfort floor sheltered, encounter threshold -5",
                    rope_trick: "Rope Trick: extradimensional shelter, hidden from the outside",
                    magnificent_mansion: "Mansion: comfort floor safe, no encounters"
                };
                const FIRE_TIPS = {
                    unlit: "Unlit: -1 comfort step at resolution",
                    embers: "Embers: no change to encounter chance.",
                    campfire: "Campfire: +1 encounter DC (light draws attention).",
                    bonfire: "+1 camp comfort. +2 encounter DC (beacon in the dark)."
                };
                return app._campStatus = {
                    comfort,
                    comfortTooltip: getComfortTip(comfort),
                    weather: weatherKey !== "clear" ? weatherKey : null,
                    weatherLabel: wx.label,
                    weatherTooltip: weatherParts.length ? `${wx.label}: ${weatherParts.join(", ")}` : wx.label,
                    fireLevel: app._fireLevel ?? "unlit",
                    fireTooltip: FIRE_TIPS[app._fireLevel ?? "unlit"] ?? "Fire",
                    hasTent: (app._engine.activeShelters ?? []).includes("tent"),
                    activeShelters: (app._engine.activeShelters ?? []).map(id => {
                        const SHELTER_LABELS = { tent: "Tent", tiny_hut: "Tiny Hut", rope_trick: "Rope Trick", magnificent_mansion: "Mansion", none: "Open Air" };
                        const SHELTER_ICONS = { tent: "fas fa-campground", tiny_hut: "fas fa-igloo", rope_trick: "fas fa-hat-wizard", magnificent_mansion: "fas fa-chess-rook", none: "fas fa-cloud-moon" };
                        return { id, name: SHELTER_LABELS[id] ?? id, icon: SHELTER_ICONS[id] ?? "fas fa-shield-alt", tooltip: SHELTER_TOOLTIPS[id] ?? SHELTER_LABELS[id] ?? id };
                    })
                };
            })() : app._campStatus ?? null,
            campConditionsBar: app._buildCampConditionsBar(campScanData, { safeRestSpot, encountersEnabled }),
            campScan: campScanData,
            comfortEnabled: isComfortEnabled(),
            canProceedFromCamp: canProceedFromMakeCamp,
            canProceedFromMakeCamp,
            proceedBlockedHint,
            campfireDragCard,
            campfireCanMove,
            campMinimalMode: app._phase === "camp",
            ...(app._phase === "events" && !app._eventsRolled ? (() => {
                const terrainTag = app._engine?.terrainTag ?? app._selectedTerrain ?? "forest";
                const poolCount = countPoolEventsForTerrain(app._eventResolver, terrainTag);
                const terrain = TerrainRegistry.get(terrainTag);
                const eventsMode = app._eventsMode ?? "random";
                const pickAvailable = poolCount > 0;
                const effectiveMode = (eventsMode === "pick" && !pickAvailable) ? "random" : eventsMode;
                return {
                    eventPoolCount: poolCount,
                    showEventPoolNudge: encountersEnabled && app._shouldShowEventPoolNudge(terrainTag),
                    eventPoolTerrainLabel: terrain?.label ?? terrainTag,
                    eventsMode: effectiveMode,
                    eventsModePickAvailable: pickAvailable,
                    eventsModeIsRandom: effectiveMode === "random",
                    eventsModeIsImprovise: effectiveMode === "improvise",
                    eventsModeIsPick: effectiveMode === "pick"
                };
            })() : {
                eventPoolCount: null,
                showEventPoolNudge: false,
                eventPoolTerrainLabel: "",
                eventsMode: "random",
                eventsModePickAvailable: false,
                eventsModeIsRandom: true,
                eventsModeIsImprovise: false,
                eventsModeIsPick: false
            }),
            campPitPlacementCancelled: !!app._campPitPlacementCancelled,
            campMakeCampStep,
            campFireEncounterHint,
            showCampCeremonyMinigame: app._campCeremonyMinigameEnabled(),
            campFirePreviewLabel: (() => {
                if (app._coldCampDecided || app._isCampColdCampPreview()) return "Cold camp";
                const p = app._campFirePreviewLevel ?? "embers";
                return p.charAt(0).toUpperCase() + p.slice(1);
            })(),
            campFirePickerLevels,
            campFirePreviewLevel: app._campFirePreviewLevel ?? "embers",
            campPreviewIsColdCamp: app._isCampColdCampPreview(),
            campFireGatePit,
            campFireGateLevel,
            campFireIsLit,
            campFireLabel: (() => {
                const l = app._fireLevel ?? "unlit";
                return l.charAt(0).toUpperCase() + l.slice(1);
            })(),
            campFireLitBy,
            campSelectedFirewoodCost,
            campPartyFirewood,
            campHasEnoughFirewood,
            campCanLight,
            campFireLighters,
            campFirewoodPledgeList,
            campMyPledge,
            campCanAddFirewood,
            campMyFirewoodActorId,
            campColdCampDecided,
            campComfortIsHostile,
            campFireTierCards,
            campFireTotalPledged,
            campViewerCanLight,
            campPitBlocksFireLighting: app._phase === "camp" && app._campPitBlocksFireLighting(),
            campFireOtherLighterCount,
            campFireLighterNames,
            campPersonalSelected,
            campfirePlaced,
            craftingDrawer: app._buildCraftingDrawerContext(),
            encounterBar: (app._engine && !app._eventsRolled && !app._engine.safeRestSpot && encountersEnabled) ? (() => {
                const bd = app._engine._encounterBreakdown ?? {};
                const shelter = bd.shelter ?? 0;
                const weather = bd.weather ?? 0;
                const scouting = bd.scouting ?? 0;
                const fireUncommitted = (app._fireLevel ?? "unlit") === "unlit" && !app._coldCampDecided;
                const fire = (app._phase === "camp" && fireUncommitted)
                    ? (CampGearScanner.FIRE_ENCOUNTER_MOD_BY_LEVEL[app._campFirePreviewLevel ?? "embers"] ?? 0)
                    : (app._engine.fireRollModifier ?? 0);
                const gmAdj = app._engine.gmEncounterAdj ?? 0;
                const complication = app._engine.scoutingComplication ?? false;
                const defenses = bd.defenses ?? 0;
                let earlyDefenseBonus = 0;
                if (defenses === 0) {
                    for (const [, er] of (app._earlyResults ?? [])) {
                        if (er.activityId === "act_defenses" && (er.result === "success" || er.result === "exceptional")) {
                            earlyDefenseBonus += 2;
                        }
                    }
                }
                const totalDefenses = defenses + earlyDefenseBonus;
                const total = shelter + weather + scouting + fire;
                const terrainTable = app._eventResolver?.tables?.get(app._engine.terrainTag);
                const baseDC = terrainTable?.noEventThreshold ?? 15;
                const effectiveDC = Math.max(1, baseDC - total + gmAdj - totalDefenses);
        Logger.log(`[Respite:UI] encounterBar: baseDC=${baseDC}, shelter=${shelter}, weather=${weather}, scouting=${scouting}, fire=${fire}, total=${total}, defenses=${defenses}, earlyDefenseBonus=${earlyDefenseBonus}, gmAdj=${gmAdj}, effectiveDC=${effectiveDC}`);
                const fmt = (v) => v > 0 ? `+${v}` : `${v}`;
                const terrainObj = TerrainRegistry.get(app._engine.terrainTag);
                const terrainLabel = terrainObj?.label ?? app._engine.terrainTag ?? "Terrain";
                const chips = [];
                if (weather !== 0) chips.push({ label: bd.weatherName ?? "Weather", value: fmt(-weather), icon: "fas fa-cloud-sun-rain", tooltip: "Weather shifts the night check. Rough weather makes a camp event more likely. The value is this factor's effect on the DC." });
                if (shelter !== 0) chips.push({ label: "Shelter", value: fmt(-shelter), icon: "fas fa-campground", tooltip: "A tent or shelter spell hides the camp and lowers the encounter DC, so a night event is less likely." });
                if (scouting !== 0) chips.push({ label: `Scout: ${bd.scoutingResult ?? "?"}`, value: fmt(-scouting), icon: "fas fa-binoculars", tooltip: "Scouting result during travel. A good scout lowers the encounter DC; a poor scout raises it. The value is this factor's effect on the DC." });
                if (complication) chips.push({ label: "Complication", value: "", icon: "fas fa-exclamation-triangle", warn: true, tooltip: "A failed scout left a hidden complication that will trigger during events." });
                if (fire !== 0) chips.push({ label: app._fireLevel ?? "Fire", value: fmt(-fire), icon: "fas fa-fire", tooltip: "A lit fire is a beacon. A larger fire raises the encounter DC and draws attention." });
                const defensesAttempted = app._pendingCampRolls?.some(p => p.activityId === "act_defenses");
                const defensesChosen = [...(app._characterChoices?.values() ?? [])].includes("act_defenses");
                let defensesFailed = false;
                let defensesPending = false;
                if (totalDefenses !== 0) {
                    chips.push({ label: "Defenses", value: `-${totalDefenses}`, icon: "fas fa-shield-alt", tooltip: `${totalDefenses / 2} defender(s) passed. Each lowers the threshold by 2.` });
                } else if (defensesAttempted || defensesChosen) {
                    let earlyDefenseCount = 0;
                    for (const [, er] of (app._earlyResults ?? [])) {
                        if (er.activityId === "act_defenses") earlyDefenseCount++;
                    }
                    defensesPending = true;
                    defensesFailed = earlyDefenseCount > 0 || defensesAttempted;
                    if (defensesFailed) {
                        chips.push({ label: "Defenses", value: "0", icon: "fas fa-shield-alt", warn: true, tooltip: "Defenses were attempted but failed. No reduction applied." });
                    } else {
                        chips.push({ label: "Defenses", value: "pending", icon: "fas fa-shield-alt", tooltip: "Defenders assigned. Reduction applies after a successful roll." });
                    }
                }
                if (gmAdj !== 0) chips.push({ label: "GM", value: fmt(gmAdj), icon: "fas fa-gavel", tooltip: "Manual GM adjustment to the encounter DC, set with the plus and minus buttons." });

                const playerFactors = app._buildEncounterPlayerFactors({
                    terrainLabel,
                    weather,
                    weatherName: bd.weatherName,
                    shelter,
                    scouting,
                    scoutingResult: bd.scoutingResult,
                    complication,
                    fire,
                    fireLevel: app._fireLevel ?? "unlit",
                    totalDefenses,
                    defensesPending,
                    defensesFailed
                });

                return {
                    total,
                    baseDC,
                    effectiveDC,
                    terrainLabel,
                    totalLabel: `Encounter DC ${effectiveDC}`,
                    chips,
                    playerFactors,
                    complication,
                    isGM: game.user.isGM,
                    gmAdj
                };
            })() : null,
            magicScanResults: app._magicScanResults ?? null,
            magicScanComplete: app._magicScanComplete ?? false,

            // Meal phase context
            mealCards: (() => {
                if (app._phase !== "meal") return null;

                // GM: roster characters only. Player: only owned + rostered characters.
                const rosterIds = new Set(getPartyActors().map(a => a.id));
                let characterIds;
                if (app._isGM) {
                    characterIds = app._engine?.characterChoices
                        ? Array.from(app._engine.characterChoices.keys()).filter(id => rosterIds.has(id))
                        : [];
                } else {
                    characterIds = app._myCharacterIds
                        ? Array.from(app._myCharacterIds).filter(id => rosterIds.has(id))
                        : [];
                }

                const allCards = characterIds
                    .map(id => app.getStationMealCardForActor(id))
                    .filter(Boolean);

                if (app._isGM && app._mealSubmissions) {
                    for (const card of allCards) {
                        const actor = game.actors.get(card.characterId);
                        if (!actor) continue;
                        const ownerUser = game.users.find(u => !u.isGM && actor.testUserPermission(u, "OWNER"));
                        if (ownerUser && app._mealSubmissions.has(ownerUser.id)) {
                            card.playerSubmitted = true;
                        }
                    }
                }

                // Feast advisory: mark cards pre-covered by a TotM Serve Now feast.
                // Only show when an actual party feast was served, not for individual rations
                // like porridge that happen to satiate water.
                if (app._totmFeastServed && app._activityMealRationsSubmitted?.size) {
                    for (const card of allCards) {
                        if (app._activityMealRationsSubmitted.has(card.characterId)) {
                            card.feastAdvisory = true;
                        }
                    }
                }

                // GM: filter to selected roster character
                if (app._isGM && app._selectedCharacterId) {
                    const filtered = allCards.filter(c => c.characterId === app._selectedCharacterId);
                    return filtered.length > 0 ? filtered : allCards.slice(0, 1);
                }

                return allCards;
            })(),
            mealSubmitted: app._mealSubmitted ?? false,
            mealSubmissions: app._mealSubmissions ? Object.fromEntries(app._mealSubmissions) : {},
            daysSinceLastRest: app._daysSinceLastRest ?? 1,
            // Global multi-day flags (computed from ALL characters, not roster-filtered)
            allMealsConsumed: (() => {
                if (app._phase !== "meal") return false;
                const characterIds = app._engine?.characterChoices ? Array.from(app._engine.characterChoices.keys()) : [];
                if (!characterIds.length) return false;
                const totalDays = Math.max(1, app._daysSinceLastRest ?? 1);
                if (totalDays <= 1) return true; // single-day: no consume step needed
                for (const charId of characterIds) {
                    const choice = app._mealChoices?.get(charId);
                    const consumed = choice?.consumedDays?.length ?? 0;
                    if (consumed < totalDays) return false;
                }
                return true;
            })(),
            pendingDehydrationSaves: app._pendingDehydrationSaves?.length > 0 ? app._pendingDehydrationSaves.length : 0,
            allDehydrationResolved: app._pendingDehydrationSaves?.length > 0 && app._pendingDehydrationSaves.every(s => s.resolved),
            hasUnresolvedSaves: app._pendingDehydrationSaves?.length > 0 && app._pendingDehydrationSaves.some(s => !s.resolved),
            dehydrationResults: (() => {
                // GM: use pending saves data; Player: use broadcast results
                const fromPending = (app._pendingDehydrationSaves ?? []).filter(s => s.resolved).map(s => ({
                    actorName: s.actorName,
                    total: s.total ?? 0,
                    dc: s.dc,
                    passed: s.passed ?? false,
                    reason: s.reason ?? null,
                    pending: false
                }));
                return fromPending.length > 0 ? fromPending : (app._dehydrationResults ?? []);
            })(),
            isMultiDay: (app._daysSinceLastRest ?? 1) > 1,
            mealCurrentDay: (() => {
                if (app._phase !== "meal") return 1;
                const characterIds = app._engine?.characterChoices ? Array.from(app._engine.characterChoices.keys()) : [];
                if (!characterIds.length) return 1;
                let minDay = Infinity;
                for (const charId of characterIds) {
                    const choice = app._mealChoices?.get(charId);
                    const consumed = choice?.consumedDays?.length ?? 0;
                    minDay = Math.min(minDay, consumed + 1);
                }
                return minDay === Infinity ? 1 : minDay;
            })(),
            mealProcessed: app._mealProcessed ?? false,
            campPlaced: hasCampPlaced()
        };
    
    }
}
