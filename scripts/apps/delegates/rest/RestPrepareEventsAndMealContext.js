import { TerrainRegistry } from "../../../services/events/resolve/TerrainRegistry.js";
import { DecisionTreeResolver } from "../../../services/events/resolve/DecisionTreeResolver.js";
import { countPoolEventsForTerrain } from "../../../services/events/catalog/EventCatalogLoader.js";
import { resolveNightWatchMode } from "../events/nightWatchMode.js";
import { CampfireTokenLinker } from "../../../services/camp/fire/CampfireTokenLinker.js";
import { SKILL_NAMES } from "../../../data/RestConstants.js";
import {
    buildEventPlayerRollContext, buildEventGmRollContext,
    buildTreePlayerRollContext, buildCampActivityRollContext
} from "../../../services/ui/rollRequest/RollRequestView.js";
import { getPartyActors } from "../../../services/party/partyActors.js";
import { SpoilageClock } from "../../../services/meal/spoilage/SpoilageClock.js";
import { normalizeBeverageClass, sendoffFromPlaced } from "../../../services/meal/phase/MealOptionBuilder.js";
import { waterGlassFromPints } from "../../../services/meal/phase/SustenanceEditPlan.js";
import { sustenanceTrayRows } from "../../../services/meal/phase/SustenanceTray.js";

export function buildEventsPhaseContext(app, encountersEnabled) {
    return {
            incidentsCount: (app._triggeredEvents ?? []).length,
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
                // Enrich resolved rolls with ownership and token avatar for display
                const resolvedRolls = (e.resolvedRolls ?? []).map(r => ({
                    ...r,
                    img: game.actors.get(r.characterId)?.img || "icons/svg/mystery-man.svg",
                    isOwner: game.actors.get(r.characterId)?.isOwner ?? false
                }));
                const isGroupAveraged = (e.mechanical?.checkPolicy ?? "group") === "group";
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
                return { ...e, targetNames, targetActors, skillName, gmPrompt, gmGuidance, description, checkContext, readAloud, resolvedRolls, playerConsequences, isGroupAveraged,
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
            resolvingRest: !!app._resolveInFlight,
            ...(app._phase === "dawn" ? (app._dawn?.templateContext() ?? {}) : {}),
            ...(app._phase === "supper" ? {
                mealBuffRoster: app._mealBuffQueue ?? [],
                mealBuffPending: (app._mealBuffQueue ?? []).filter(row => row && !row.applied).length
            } : {}),
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
                    ? game.i18n.localize("ionrift-respite.restPrepare.disaster.twoComplications") : game.i18n.localize("ionrift-respite.restPrepare.disaster.oneComplication");
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
                const gmPrompt = ts.gmPrompt || treeEvent?.gmPrompt || "";
                const checkContext = ts.checkContext ?? treeEvent?.checkContext ?? null;
                const gmGuidance = ts.gmGuidance || treeEvent?.gmGuidance || "";
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
                    const tier = treeDcAdj > 0 ? game.i18n.localize("ionrift-respite.restPrepare.tree.higher") : game.i18n.localize("ionrift-respite.restPrepare.tree.lower");
                    const who = (ts.options?.length === 2) ? game.i18n.localize("ionrift-respite.restPrepare.tree.bothChoices") : game.i18n.localize("ionrift-respite.restPrepare.tree.everyChoice");
                    treeDcAdjNote = game.i18n.format("ionrift-respite.restPrepare.tree.dcAdjNote", { who, mag, tier });
                }
                const hasLockedLosses = (finalEffects ?? []).some(eff => {
                    if (!eff._locked) return false;
                    if (eff.type === "supply_loss" && eff._lockedSupply?.breakdown?.length) return true;
                    if (eff.type === "item_at_risk" && eff._lockedItems?.length) return true;
                    if (eff.type === "consume_gold" && eff._lockedGold?.breakdown?.length) return true;
                    if (eff.type === "damage" && eff._lockedTargets?.length) return true;
                    if (eff.type === "consume_resource" && (eff._lockedLoss?.breakdown?.length || eff._lockedLoss?.gear?.length)) return true;
                    return false;
                });
                return {
                    ...ts,
                    gmPrompt,
                    checkContext,
                    gmGuidance,
                    readAloud,
                    showDecisionPrompt: !!showDecisionPrompt,
                    treeDcAdjNote,
                    options,
                    pendingRollsEnriched,
                    finalEffects,
                    hasLockedLosses,
                    eventIndex
                };
            })(),
            engine: app._engine,
            ...(app._phase === "events" && !app._eventsRolled ? (() => {
                const terrainTag = app._engine?.terrainTag ?? app._selectedTerrain ?? "forest";
                const poolCount = countPoolEventsForTerrain(app._eventResolver, terrainTag);
                const terrain = TerrainRegistry.get(terrainTag);
                const nightWatch = resolveNightWatchMode(app._eventsMode ?? "random", poolCount);
                const noEventsInstalled = poolCount === 0 && app._installedEventCounts?.[terrainTag] === 0;
                return {
                    eventPoolCount: poolCount,
                    noEventsInstalled,
                    showEventPoolNudge: encountersEnabled && !noEventsInstalled && app._shouldShowEventPoolNudge(terrainTag),
                    eventPoolTerrainLabel: terrain?.label ?? terrainTag,
                    eventsMode: nightWatch.effectiveMode,
                    eventsModePickAvailable: nightWatch.eventsModePickAvailable,
                    eventsModeRandomAvailable: nightWatch.eventsModeRandomAvailable,
                    eventsModeIsRandom: nightWatch.eventsModeIsRandom,
                    eventsModeIsImprovise: nightWatch.eventsModeIsImprovise,
                    eventsModeIsPick: nightWatch.eventsModeIsPick
                };
            })() : {
                eventPoolCount: null,
                noEventsInstalled: false,
                showEventPoolNudge: false,
                eventPoolTerrainLabel: "",
                eventsMode: "random",
                eventsModePickAvailable: false,
                eventsModeRandomAvailable: false,
                eventsModeIsRandom: true,
                eventsModeIsImprovise: false,
                eventsModeIsPick: false
            }),
            campPitPlacementCancelled: !!app._campPitPlacementCancelled,
    };
}

export function buildMealPhaseContext(app, showMealContent) {
    return {
            mealCards: (() => {
                if (!showMealContent) return null;

                // GM: roster characters only. Player: only owned + rostered characters.
                const rosterIds = new Set(getPartyActors().map(a => a.id));
                let characterIds;
                if (app._isGM) {
                    const choices = app._engine?.characterChoices;
                    characterIds = (choices && choices.size > 0)
                        ? Array.from(choices.keys()).filter(id => rosterIds.has(id))
                        : Array.from(rosterIds);
                } else {
                    const myIds = app._myCharacterIds;
                    characterIds = (myIds && myIds.size > 0)
                        ? Array.from(myIds).filter(id => rosterIds.has(id))
                        : Array.from(rosterIds);
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
            sustenanceDiegetic: (() => {
                if (!showMealContent) return null;
                const mealActorId = app._isGM
                    ? (app._selectedCharacterId ?? getPartyActors()[0]?.id)
                    : (app._myCharacterIds?.values().next().value ?? getPartyActors()[0]?.id);
                const card = app.getStationMealCardForActor(mealActorId);
                if (!card) return null;
                const rawFoodSlots = card.foodSlots ?? [];
                const placedFood = [];
                const foodSlots = rawFoodSlots.map((slot, i) => {
                    const opt = slot.filled
                        ? (card.foodOptions ?? []).find(o => o.value === slot.selected)
                        : null;
                    if (opt) placedFood.push(opt);
                    return {
                        day: i + 1,
                        isEmpty: !slot.filled,
                        name: opt?.name ?? "",
                        img: opt?.icon ?? "",
                        isSend: false,
                        isBuff: Boolean(opt?.hasBuff),
                        ...SpoilageClock.viewFromOption(opt)
                    };
                });
                const waterNeed = card.waterRequired ?? 0;
                const foodNeed = card.foodRequired ?? foodSlots.length;
                const foodFilled = card.foodFilledCount ?? foodSlots.filter(slot => !slot.isEmpty).length;
                const foodBudgetText = foodNeed <= 0
                    ? game.i18n.localize("ionrift-respite.restPrepare.sustenance.notNeeded")
                    : (card.foodSufficient ? game.i18n.localize("ionrift-respite.restPrepare.sustenance.fed") : (foodNeed > 1 ? `${foodFilled}/${foodNeed}` : game.i18n.localize("ionrift-respite.restPrepare.sustenance.hungry")));
                const waterFilled = card.waterFilledCount ?? 0;
                // Compact water slots so filled slots always pack from the bottom up (no holes in the stack)
                const filledSlots = (card.waterSlots ?? []).filter(s => s && s.filled && s.selected && s.selected !== "skip");
                const filledCount = filledSlots.length;
                const activeCount = filledCount > 0 ? filledCount : waterFilled;
                const pints = [];
                const placedWater = [];
                for (let p = 0; p < waterNeed; p++) {
                    const slot = p < filledSlots.length ? filledSlots[p] : null;
                    const filled = slot ? Boolean(slot.filled) : p < waterFilled;
                    const opt = filled
                        ? (card.waterOptions ?? []).find(o => o.value === slot?.selected)
                        : null;
                    if (opt) placedWater.push(opt);
                    const isSurface = filled && (p === activeCount - 1);
                    pints.push({
                        filled,
                        isSurface,
                        isBuff: Boolean(opt?.hasBuff),
                        sourceId: opt?.value ?? "waterskin",
                        sourceClass: normalizeBeverageClass(opt?.name),
                        name: opt?.name ?? "",
                        img: opt?.icon ?? "",
                        ...SpoilageClock.viewFromOption(filled ? opt : null)
                    });
                }
                const foodInv = sustenanceTrayRows(card.foodOptions, rawFoodSlots).map(row => ({
                    ...row,
                    isSelected: false,
                    ...SpoilageClock.viewFromOption((card.foodOptions ?? []).find(o => o.value === row.id))
                }));
                const waterInv = sustenanceTrayRows(card.waterOptions, card.waterSlots).map(row => ({
                    ...row,
                    isSelected: false,
                    ...SpoilageClock.viewFromOption((card.waterOptions ?? []).find(o => o.value === row.id))
                }));
                const mealsSubmitted = Boolean(app._activityMealRationsSubmitted?.has(mealActorId))
                    || Boolean(card?.playerSubmitted);
                return {
                    actorId: mealActorId,
                    isMultiDay: false,
                    mealsSubmitted,
                    mealsLocked: mealsSubmitted,
                    trait: null,
                    terrainNote: card.terrainNote ?? null,
                    terrainAlertClass: card.terrainAlertClass ?? "",
                    terrainAlertIcon: card.terrainAlertIcon ?? "fas fa-info-circle",
                    food: {
                        budget: {
                            text: foodBudgetText,
                            isDone: foodNeed <= 0 || Boolean(card.foodSufficient)
                        },
                        slots: foodSlots,
                        sendoff: sendoffFromPlaced(placedFood),
                        inventory: foodInv
                    },
                    water: {
                        budget: {
                            text: waterNeed <= 0
                                ? game.i18n.localize("ionrift-respite.restPrepare.sustenance.notNeeded")
                                : (card.waterSufficient ? game.i18n.localize("ionrift-respite.restPrepare.sustenance.hydrated") : game.i18n.format("ionrift-respite.restPrepare.sustenance.shortPints", { count: Math.max(0, waterNeed - waterFilled) })),
                            isDone: waterNeed <= 0 || Boolean(card.waterSufficient)
                        },
                        days: [{
                            day: 1,
                            isSend: false,
                            hasBuff: placedWater.some(opt => opt.hasBuff),
                            dayIndex: 0,
                            pints,
                            ...waterGlassFromPints(pints)
                        }],
                        sendoff: sendoffFromPlaced(placedWater),
                        inventory: waterInv,
                        need: waterNeed
                    }
                };
            })(),
            mealSubmitted: app._mealSubmitted ?? false,
            mealSubmissions: app._mealSubmissions ? Object.fromEntries(app._mealSubmissions) : {},
            daysSinceLastRest: app._daysSinceLastRest ?? 1,
            // Global multi-day flags (computed from ALL characters, not roster-filtered)
            allMealsConsumed: (() => {
                if (!showMealContent) return false;
                const partyList = getPartyActors();
                const characterIds = app._engine?.characterChoices?.size
                    ? Array.from(app._engine.characterChoices.keys())
                    : partyList.map(a => a.id);
                if (!characterIds.length) return true;
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
                if (!showMealContent) return 1;
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
    };
}
