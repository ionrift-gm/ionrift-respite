import { RestFlowEngine } from "../../../../services/rest/flow/RestFlowEngine.js";
import { TerrainRegistry } from "../../../../services/events/resolve/TerrainRegistry.js";
import { ResourceSink } from "../../../../services/rest/recovery/ResourceSink.js";
import { ConditionAdvisory } from "../../../../services/rest/recovery/ConditionAdvisory.js";
import { MealPhaseHandler } from "../../../../services/meal/phase/MealPhaseHandler.js";
import { clearDeprivationExhaustionFloors } from "../../../../services/meal/phase/MealExhaustionGuard.js";
import { CampfireTokenLinker } from "../../../../services/camp/fire/CampfireTokenLinker.js";
import {
    isStationLayerActive,
    refreshStationEmptyNoticeFade,
    refreshStationPortraitsFromChoices
} from "../../../../services/camp/props/StationInteractionLayer.js";
import { closeOpenStationDialog } from "../../../camp/StationActivityDialog.js";
import { WEATHER_TABLE, SKILL_NAMES, COMFORT_RANK, RANK_TO_KEY } from "../../../../data/RestConstants.js";
import { isScoutingEnabled } from "../../../../services/travel/settings/ScoutingSettings.js";
import { shouldRunTravelPhase } from "../../../../services/travel/settings/TravelSettings.js";
import {
    executePlayerRoll,
    pickBestSkill
} from "../../../../services/ui/rollRequest/RollRequestManager.js";
import { buildRollTargetLabel } from "../../../../services/ui/rollRequest/RollRequestView.js";
import { SoundDelegate } from "../SoundDelegate.js";
import { isTrailerFilmingMode as _isTrailerFilmingMode } from "../layout/RestWindowLayout.js";
import {
    setActiveRestData
} from "../../../../module.js";
import {
    emitRestStarted,
    emitPhaseChanged,
    emitSubmissionUpdate,
    emitCopySpellProposal,
    emitActivityChoice,
    emitEventRollRequest,
    emitTreeRollResult
} from "../../../../services/socket/SocketController.js";
import { getPartyActors } from "../../../../services/party/partyActors.js";
import { MODULE_ID } from "../../../../data/moduleId.js";

export class RestFlowActions {
    constructor(app) {
        this._app = app;
    }

    async evaluateLockCount(countSpec, poolSize) {
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

    pickRandomN(pool, n) {
        if (n <= 0 || pool.length === 0) return [];
        if (n >= pool.length) return [...pool];
        const shuffled = [...pool];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        return shuffled.slice(0, n);
    }

    async onBeginRest(event, target) {
        const app = this._app;

        const form = app.element.querySelector("form");
        const formData = Object.fromEntries(new FormData(form));

        if ((formData.restType ?? "long") === "short") {
            this._app._launchShortRestFromSetup();
            return;
        }

        const terrainTag = formData.terrain ?? app._selectedTerrain ?? "forest";
        app._selectedTerrain = terrainTag;
        game.settings.set(MODULE_ID, "lastTerrain", terrainTag);
        await app._loadTerrainEvents(terrainTag);

        const activeShelters = Object.entries(app._shelterOverrides ?? {})
            .filter(([, v]) => v)
            .map(([id]) => id);
        let shelterComfortFloor = null;
        let shelterEncounterMod = 0;
        const SHELTER_EFFECTS = {
            tent: { comfortFloor: null, encounterMod: 2 },
            tiny_hut: { comfortFloor: "sheltered", encounterMod: 5 },
            rope_trick: { comfortFloor: null, encounterMod: 5 },
            magnificent_mansion: { comfortFloor: "safe", encounterMod: 99 }
        };
        const comfortRank = COMFORT_RANK;
        for (const id of activeShelters) {
            const effect = SHELTER_EFFECTS[id];
            if (!effect) continue;
            shelterEncounterMod = Math.max(shelterEncounterMod, effect.encounterMod);
            if (effect.comfortFloor && (COMFORT_RANK[effect.comfortFloor] ?? 0) > (COMFORT_RANK[shelterComfortFloor] ?? -1)) {
                shelterComfortFloor = effect.comfortFloor;
            }
        }

        const terrainDefaults = TerrainRegistry.getDefaults(terrainTag);

        let effectiveComfort = app._selectedComfort ?? formData.comfort ?? terrainDefaults.comfort ?? "sheltered";
        if (shelterComfortFloor && (COMFORT_RANK[shelterComfortFloor] ?? 0) > (COMFORT_RANK[effectiveComfort] ?? 0)) {
            effectiveComfort = shelterComfortFloor;
        }

        app._selectedWeather = app._resolveSetupWeather(terrainTag, formData.weather);
        game.settings.set(MODULE_ID, "lastWeather", app._selectedWeather);
        const weather = app._selectedWeather;
        const wx = WEATHER_TABLE[weather] ?? WEATHER_TABLE.clear;
        const hasTentActive = activeShelters.includes("tent");
        const hasHutActive = activeShelters.some(s => ["tiny_hut", "magnificent_mansion"].includes(s));

        let weatherPenalty = wx.comfortPenalty;
        let weatherCancelled = false;
        if (hasHutActive) {
            weatherPenalty = 0;
            weatherCancelled = true;
        } else if (hasTentActive) {
            if (wx.tentCancels) {
                weatherPenalty = 0;
                weatherCancelled = true;
            } else if (wx.tentReduces) {
                weatherPenalty = Math.max(0, weatherPenalty - 1);
            }
        }

        if (weatherPenalty > 0) {
            let rank = COMFORT_RANK[effectiveComfort] ?? 2;
            rank = Math.max(0, rank - weatherPenalty);
            effectiveComfort = RANK_TO_KEY[rank];
        }

        const weatherEncounterMod = weatherCancelled ? 0 : (wx.encounterDC ?? 0);

        const safeRestSpot = !!(formData.safeRestSpot === "on" || formData.safeRestSpot === true || formData.safeRestSpot === "1")
            || terrainTag === "tavern";
        try {
            await game.settings.set(MODULE_ID, "safeRestSpot", safeRestSpot);
        } catch (e) {

            console.warn(`${MODULE_ID} | Could not persist safeRestSpot`, e);
        }

        app._applyTavernTotmOverrideForRestStart(terrainTag);

        app._engine = new RestFlowEngine({
            restType: formData.restType ?? "long",
            terrainTag,
            comfort: effectiveComfort,
            safeRestSpot
        });
        app._engine.shelterEncounterMod = shelterEncounterMod + weatherEncounterMod;
        app._engine._encounterBreakdown = {
            shelter: shelterEncounterMod,
            weather: weatherEncounterMod,
            scouting: 0,
            weatherName: weather,
            scoutingResult: "none"
        };
        app._engine.gmEncounterAdj = app._engine.gmEncounterAdj ?? 0;
        app._engine.activeShelters = activeShelters;
        app._engine.weather = weather;
        app._engine.scoutingResult = "none";
        app._engine.scoutingComplication = false;
        const terrainTable = app._eventResolver?.tables?.get(terrainTag);
        app._engine._baseDC = terrainTable?.noEventThreshold ?? 15;
        app._engine.setup();

        if (safeRestSpot) {
            app._engine.comfort = "safe";
            app._engine.shelterEncounterMod = 0;
            app._engine._encounterBreakdown = {
                shelter: 0,
                weather: 0,
                scouting: 0,
                defenses: 0,
                travelMishap: 0,
                weatherName: weather,
                scoutingResult: "none"
            };
            app._engine.scoutingComplication = false;
            app._engine.fireRollModifier = 0;
            app._engine.fireLevel = "campfire";
            app._engine.gmEncounterAdj = 0;
            app._fireLevel = "campfire";
        }

        const restPayload = {
            restId: `rest_${Date.now()}`,
            terrainTag: app._engine.terrainTag,
            comfort: app._engine.comfort,
            restType: app._engine.restType,
            safeRestSpot: app._engine.safeRestSpot,
            tavernTotmOverride: !!app._tavernTotmOverride,
            activities: app._activities ?? [],
            recipes: Object.fromEntries(app._craftingEngine.recipes)
        };

        app._restId = restPayload.restId;

        // are both on (forage/hunt need professions; Use Travel skips the phase entirely).
        if (app._engine.restType === "long") {
            if (!shouldRunTravelPhase()) {
                app._phase = "camp";
            } else {
                app._phase = "travel";
                app._travel.setTotalDays(app._daysSinceLastRest ?? 1);
                app._travel.scoutingAllowed = isScoutingEnabled() && (app._scoutingAllowed ?? true);
            }
        } else {
            app._phase = "camp";
        }

        restPayload.phase = app._phase;
        if (app._phase === "travel") {
            restPayload.travelGather = app._buildTravelGatherPayload();
        }
        app._campStep2Entered = false;

        setActiveRestData(restPayload);

        emitRestStarted(restPayload);

        app._restLedger.clear();
        app._restLedger.add({
            phase: "setup", category: "terrain", icon: "fas fa-mountain",
            summary: `Terrain: ${app._terrainLabel ?? terrainTag}`
        });
        app._restLedger.add({
            phase: "setup", category: "weather", icon: "fas fa-cloud-sun",
            summary: `Weather: ${weather}`,
            detail: weatherPenalty > 0 ? `Comfort penalty: ${weatherPenalty}` : ""
        });
        if (activeShelters.length > 0) {
            app._restLedger.add({
                phase: "setup", category: "shelter", icon: "fas fa-campground",
                summary: `Shelter: ${activeShelters.join(", ")}`,
                detail: shelterEncounterMod > 0 ? `Encounter DC +${shelterEncounterMod}` : ""
            });
        }
        app._restLedger.add({
            phase: "setup", category: "comfort", icon: "fas fa-bed",
            summary: `Comfort: ${effectiveComfort}`,
            detail: safeRestSpot ? "Safe rest spot" : ""
        });
        app._refreshLedgerApp();

        ui.notifications.info("Rest phase started. Activity pickers sent to all players.");

        if (app._phase === "travel") {
            setTimeout(() => {
                emitPhaseChanged("travel", {
                    selectedTerrain: app._selectedTerrain ?? "forest",
                    travelDays: app._travel.totalDays,
                    scoutingAllowed: app._travel.scoutingAllowed
                });
                app._broadcastTravelDeclarations();
            }, 200);
        }

        // Campfire token: ensure hidden at rest start (fire not lit yet).
        // Trailer filming keeps a pre-placed canvas token; hiding it here made the pit vanish on resume.
        if (!_isTrailerFilmingMode() || !CampfireTokenLinker.hasCampfireToken()) {
            CampfireTokenLinker.setLightState(false);
        }
        app._eventsRolled = false;
        app._triggeredEvents = [];
        app._earlyResults = new Map();
        app._disasterChoice = null;
        app._activeTreeState = null;
        app._clearDetectMagicScanSession();

        // between sessions but expires when a new long rest begins.
        await MealPhaseHandler.cleanupWellFedEffects(getPartyActors());
        // Mirror Well Fed timing for rest-event conditions: anything tagged
        // "until next rest" clears at the start of the next rest. This is the
        // DAE-independent reaper; DAE special durations are a redundant backup.
        await ConditionAdvisory.cleanupRestConditions(getPartyActors());
        await clearDeprivationExhaustionFloors(getPartyActors());
        await app._saveRestState();

        if (app._phase === "camp" && await app._skipCampForTheater()) return;
        if (app._phase === "camp" && await app._skipCampForSafeRest()) return;
        // Comfort off: the fire ceremony has no mechanical effect, so waive it.
        if (app._phase === "camp" && await app._skipCampForComfortOff()) return;

        const enteringCampFromSetup = app._phase === "camp";
        if (enteringCampFromSetup && !_isTrailerFilmingMode() && !app._restWindowUserPositioned) {
            app._beginRestWindowRecenterSuppression();
            app._presetRestWindowForCampEntry();
        }

        app.render();

        if (enteringCampFromSetup) {
            void app._finalizeCampPhaseWindowLayout();
        }

        if (app._phase === "camp") {
            app._broadcastMakeCampPhaseSync();
        }
    
    }

    async onSubmitActivities(event, target) {
        const app = this._app;

        await closeOpenStationDialog();
        app._tearDownStationLayerCanvas();
        if (app._phase === "activity") {
            void app._detectMagic?.cleanupCastArtifactsOnPhaseExit(getPartyActors());
        }
        for (const [characterId, activityId] of app._characterChoices) {
            const followUpValue = app._gmFollowUps?.get(characterId) ?? app._getFollowUpForCharacter(characterId);
            app._engine.registerChoice(characterId, activityId, { followUpValue });
            const actor = game.actors.get(characterId);
            if (actor) {
                try {
                    const pen = actor.getFlag(MODULE_ID, "travelMishapPenalty");
                    if (pen === "lose_activity") {
                        await actor.unsetFlag(MODULE_ID, "travelMishapPenalty");
                    } else if (pen === "activity_disadvantage" && activityId === "act_other") {
                        await actor.unsetFlag(MODULE_ID, "travelMishapPenalty");
                    }
                } catch { /* noop */ }
            }
        }

        for (const [characterId, activityId] of app._characterChoices) {
            const actor = game.actors.get(characterId);
            const act = app._activities?.find(a => a.id === activityId);
            app._restLedger.add({
                phase: "activity", category: "activity",
                icon: "fas fa-hammer",
                actor: characterId,
                actorName: actor?.name ?? characterId,
                summary: act?.name ?? activityId
            });
        }
        app._refreshLedgerApp();

        if (app._engine.restType === "short") {
            app._triggeredEvents = [];
            app._eventsRolled = true;
            SoundDelegate.stopAll();
            app._phase = "resolve";
        } else {
            const trackFood = game.settings.get(MODULE_ID, "trackFood");
            const terrainTag = app._engine?.terrainTag ?? "forest";
            const terrainMealRules = TerrainRegistry.getDefaults(terrainTag)?.mealRules ?? {};
            const hasMealRules = terrainMealRules.waterPerDay > 0 || terrainMealRules.foodPerDay > 0;

            if (trackFood && hasMealRules && app._isTotM) {
                // _activityMealRationsSubmitted may already have feast-covered characters
                // from #onTotmFeastServeNow; those cards show the feast advisory banner.
                app._mealChoices = app._mealChoices ?? new Map();
                app._daysSinceLastRest = app._daysSinceLastRest ?? 1;
                app._phase = "meal";
            } else if (trackFood && hasMealRules) {
                app._mealChoices = app._mealChoices ?? new Map();
                app._daysSinceLastRest = app._daysSinceLastRest ?? 1;
                await app._autoProcessRations();
                await app._applyBeddingDown();
                // Reflection phase skipped (v2.1); advance straight to events.
                await app._advanceToEvents();
                return;
            } else {
                await app._applyBeddingDown();
                // Reflection phase skipped (v2.1); advance straight to events.
                await app._advanceToEvents();
                return;
            }
        }

        emitPhaseChanged(app._phase, {
                campStatus: app._campStatus,
                daysSinceLastRest: app._daysSinceLastRest ?? 1,
                selectedTerrain: app._selectedTerrain ?? "forest"
            });

        await app._saveRestState();
        app.render();
    
    }

    onActivityDetailConfirm(event, target) {
        const app = this._app;

        const characterId = app._selectedCharacterId;
        const activityId = app._activityDetailId;
        if (!characterId || !activityId) return;

        // Armor sleep penalty confirmation (gated by Xanathar's setting; skipped at a safe rest spot)
        if (!app._armorConfirmed && !app._effectiveSafeRestSpot()) {
            try {
                const armorRuleEnabled = game.settings.get(MODULE_ID, "armorDoffRule");
                if (armorRuleEnabled) {
                    const actor = game.actors.get(characterId);
                    const equippedArmor = actor?.items?.find(i =>
                        i.type === "equipment" && i.system?.equipped &&
                        ["medium", "heavy"].includes(i.system?.type?.value ?? i.system?.armor?.type)
                    );
                    const activity = app._activities?.find(a => a.id === activityId);
                    if (equippedArmor && !activity?.armorSleepWaiver) {
                        const armorType = equippedArmor.system?.type?.value ?? "heavy";
                        const overlay = document.createElement("div");
                        overlay.classList.add("ionrift-armor-modal-overlay");
                        overlay.innerHTML = `
                            <div class="ionrift-armor-modal">
                                <h3><i class="fas fa-shield-alt"></i> Sleeping in Armor</h3>
                                <p><strong>${actor.name}</strong> is wearing <strong>${equippedArmor.name}</strong> (${armorType}).</p>
                                <p>Sleeping in medium or heavy armor reduces Hit Dice recovery to 1/4 and prevents exhaustion reduction (Xanathar's).</p>
                                <p>Confirm this activity, or go back and doff armor first?</p>
                                <div class="ionrift-armor-modal-buttons">
                                    <button class="btn-armor-confirm"><i class="fas fa-check"></i> Confirm</button>
                                    <button class="btn-armor-cancel"><i class="fas fa-times"></i> Go Back</button>
                                </div>
                            </div>`;
                        document.body.appendChild(overlay);
                        overlay.querySelector(".btn-armor-confirm").addEventListener("click", () => {
                            overlay.remove();
                            app._armorConfirmed = true;
                            this.onActivityDetailConfirm(event, target);
                        });
                        overlay.querySelector(".btn-armor-cancel").addEventListener("click", () => {
                            overlay.remove();
                        });
                        return;
                    }
                }
            } catch (e) { /* setting may not exist */ }
        }
        app._armorConfirmed = false;

        if (app._isGM) {
            const actor = game.actors.get(characterId);
            const ownerUser = actor ? game.users.find(u => !u.isGM && actor.testUserPermission(u, "OWNER")) : null;
            const playerAlreadySubmitted = ownerUser && app._playerSubmissions?.has(ownerUser.id);
            if (playerAlreadySubmitted && !app._gmOverrides.has(characterId)) {
                ui.notifications.warn(`${actor.name}'s player already submitted. Overriding their choice.`);
            }
            // GM: override + broadcast
            app._gmOverrides.set(characterId, activityId);
            app._characterChoices.set(characterId, activityId);
            app._rebuildCharacterChoices();

            const submissions = {};
            for (const [charId, actId] of app._characterChoices) {
                const act = app._activities?.find(a => a.id === actId);
                submissions[charId] = {
                    activityId: actId,
                    activityName: act?.name ?? actId,
                    source: app._gmOverrides.has(charId) ? "gm" : "player"
                };
            }
            emitSubmissionUpdate(submissions);
        } else {
            // Player: submit + lock
            app._characterChoices.set(characterId, activityId);
            app._lockedCharacters = app._lockedCharacters ?? new Set();
            app._lockedCharacters.add(characterId);

            // Copy Spell: send proposal to GM instead of normal submission
            if (activityId === "act_scribe") {
                const actor = game.actors.get(characterId);
                // Read followUp value from the dropdown in the detail panel
                const followUpEl = app.element?.querySelector(".gm-followup-input");
                const followUpValue = followUpEl?.value ?? "1";
                const spellLevel = parseInt(followUpValue, 10) || 1;
                const cost = spellLevel * 50;
                const dc = 10 + spellLevel;

                emitCopySpellProposal({
                    actorId: characterId,
                    actorName: actor?.name ?? "Unknown",
                    spellLevel,
                    cost,
                    dc,
                    initiatedBy: game.user.name
                });

                // Show pending state
                app._earlyResults = app._earlyResults ?? new Map();
                app._earlyResults.set(characterId, {
                    source: "activity",
                    activityId,
                    result: "pending_approval",
                    narrative: `Level ${spellLevel} spell (${cost}gp, DC ${dc}). Awaiting transaction.`
                });

                if (actor) ui.notifications.info(`${actor.name}: Copy Spell Level ${spellLevel} submitted.`);
            } else {
                const actor = game.actors.get(characterId);
                if (actor) ui.notifications.info(`${actor.name}'s activity submitted.`);
            }

            emitActivityChoice(
                    game.user.id,
                    Object.fromEntries(app._characterChoices),
                    null,
                    null,
                    app._earlyResults?.size ? Object.fromEntries(app._earlyResults) : null
                );
            app._saveRestState();
        }

        app._activityDetailId = null;
        if (app._phase === "activity" && isStationLayerActive()) {
            refreshStationEmptyNoticeFade(this);
            refreshStationPortraitsFromChoices(app._characterChoices, app._stationCanvasIdByCharacter);
            app._refreshStationOverlayMeals();
        }
        app.render();
    
    }

    async onLockEventConsequence(event, target) {
        const app = this._app;

        if (!game.user.isGM) return;
        event.preventDefault?.();

        const eventIndex = parseInt(target.dataset.eventIndex);
        const effectIndex = parseInt(target.dataset.effectIndex);
        const te = app._triggeredEvents?.[eventIndex];
        if (!te || !te.mechanical) return;

        const TIER_MAP = { triumph: "onTriumph", success: "onSuccess", mixed: "onMixed", failure: "onFailure" };
        const tierKey = TIER_MAP[te.resolvedOutcome] ?? "onFailure";
        const block = te.mechanical[tierKey] ?? te.mechanical.onFailure ?? {};
        const effect = block.effects?.[effectIndex];
        if (!effect) return;

        if (effect.type === "damage") {
            // RecoveryHandler._resolveEventScopes, using the live watch roster.
            const party = getPartyActors();
            const allIds = party.map(a => a.id);
            const watchIds = new Set((app._engine?.watchRoster ?? []).map(w => w.characterId));
            const awakeIds = allIds.filter(id => watchIds.has(id));
            const sleepingIds = allIds.filter(id => !watchIds.has(id));
            const poolFor = (pool) => pool === "awake" ? (awakeIds.length ? awakeIds : allIds)
                : pool === "sleeping" ? (sleepingIds.length ? sleepingIds : allIds)
                    : allIds;

            const scope = effect.scope ?? "all";
            let targetIds = [];
            if (scope === "random" || scope === "randomTarget") {
                const spec = effect.randomTarget ?? {};
                const pool = poolFor(spec.pool ?? "all");
                const count = await this.evaluateLockCount(spec.count, pool.length);
                targetIds = this.pickRandomN(pool, count);
            } else if (scope === "failed") {
                targetIds = (te.resolvedRolls ?? [])
                    .filter(r => r && r.passed === false)
                    .map(r => r.characterId)
                    .filter(Boolean);
            } else {
                targetIds = allIds;
            }

            const lockedTargets = [];
            for (const id of targetIds) {
                const actor = game.actors.get(id);
                if (!actor) continue;
                let amount = 0;
                try {
                    const roll = await new Roll(effect.formula ?? effect.roll ?? "0").evaluate();
                    amount = roll.total;
                    await roll.toMessage({
                        speaker: { alias: te.name ?? "Rest Event" },
                        flavor: `<strong>${actor.name}</strong>: ${effect.formula ?? effect.roll ?? "?"} ${effect.damageType ?? ""} damage (applied after the rest)`,
                        whisper: game.users.filter(u => u.isGM).map(u => u.id)
                    });
                } catch (e) {

                    console.warn(`${MODULE_ID} | Failed to roll locked consequence damage:`, e);
                }
                lockedTargets.push({ id, name: actor.name, amount });
            }

            effect._resolvedTargetIds = targetIds;
            effect._lockedDamage = Object.fromEntries(lockedTargets.map(t => [t.id, t.amount]));
            effect._lockedTargets = lockedTargets;
            effect._locked = true;
        } else if (effect.type === "consume_resource") {
            // Roll and freeze the exact loss now so the locked breakdown is what
            // actually lands after the rest (no re-roll at resolution). The
            // abstract "supplies" resource expands into a composite proposal
            // (provisions + gear at risk); concrete keys (rations/water) stay
            // a simple bulk loss.
            const proposal = effect.resource === "supplies"
                ? await ResourceSink.proposeSuppliesLoss(effect, { characters: getPartyActors() })
                : await ResourceSink.proposeConsumeResource(effect, { characters: getPartyActors() });
            effect._lockedLoss = proposal;
            effect._locked = true;

            const parts = [];
            for (const grp of (proposal.provisionGroups ?? [])) {
                const lines = grp.entries
                    .map(e => `${e.actorName} &times;${e.lossQty}`)
                    .join(", ");
                parts.push(`<p><strong>${grp.total}</strong> ${grp.kind} lost: ${lines}</p>`);
            }
            if (proposal.gear?.length) {
                const gearLines = proposal.gear
                    .map(g => `${g.actorName}: ${g.itemName}${g.lossQty > 1 ? ` &times;${g.lossQty}` : ""}`)
                    .join("<br>");
                parts.push(`<p><strong>Gear lost from the pack:</strong></p><p>${gearLines}</p>`);
            }
            if (parts.length) {
                await ChatMessage.create({
                    speaker: { alias: te.name ?? "Rest Event" },
                    whisper: game.users.filter(u => u.isGM).map(u => u.id),
                    content: `${parts.join("")}<p><em>Applied after the rest.</em></p>`
                });
            }
        } else if (effect.type === "item_at_risk") {
            // Roll which specific items go missing now and freeze them to ids, so
            // the same items leave the packs at resolution regardless of inventory
            // churn. Re-invoking re-rolls the selection.
            const proposal = await ResourceSink._resolveItemAtRisk(effect, { characters: getPartyActors() });
            const lockedItems = (proposal.candidates ?? []).map(c => ({
                actorId: c.actor.id,
                actorName: c.actor.name,
                itemId: c.item.id,
                itemName: c.item.name,
                itemImg: c.item.img ?? "icons/svg/mystery-man.svg",
                currentQty: c.currentQty,
                lossQty: c.lossQty
            }));
            effect._lockedItems = lockedItems;
            effect._locked = true;

            if (lockedItems.length) {
                const lines = lockedItems
                    .map(i => `${i.actorName}: ${i.itemName}${i.lossQty > 1 ? ` &times;${i.lossQty}` : ""}`)
                    .join("<br>");
                await ChatMessage.create({
                    speaker: { alias: te.name ?? "Rest Event" },
                    whisper: game.users.filter(u => u.isGM).map(u => u.id),
                    content: `<p><strong>Taken from the packs:</strong></p><p>${lines}</p><p><em>Applied after the rest.</em></p>`
                });
            } else {
                await ChatMessage.create({
                    speaker: { alias: te.name ?? "Rest Event" },
                    whisper: game.users.filter(u => u.isGM).map(u => u.id),
                    content: `<p><em>Nothing worth taking was within reach.</em></p>`
                });
            }
        } else if (effect.type === "consume_gold") {
            // Roll and freeze the coin taken now so the locked amount is what
            // leaves the purses at resolution. Re-invoking re-rolls it.
            const proposal = await ResourceSink.proposeGoldLoss(effect, { characters: getPartyActors() });
            effect._lockedGold = proposal;
            effect._locked = true;

            if (proposal.totalLoss > 0) {
                const lines = (proposal.breakdown ?? [])
                    .map(b => `${b.actorName}: &minus;${b.lossGp} gp`)
                    .join("<br>");
                await ChatMessage.create({
                    speaker: { alias: te.name ?? "Rest Event" },
                    whisper: game.users.filter(u => u.isGM).map(u => u.id),
                    content: `<p><strong>Coin lifted:</strong> ${proposal.totalLoss} gp</p><p>${lines}</p><p><em>Applied after the rest.</em></p>`
                });
            } else {
                await ChatMessage.create({
                    speaker: { alias: te.name ?? "Rest Event" },
                    whisper: game.users.filter(u => u.isGM).map(u => u.id),
                    content: `<p><em>No coin in the purses to lift.</em></p>`
                });
            }
        } else if (effect.type === "supply_loss") {
            // Roll and freeze how much of the supply pool is swept away now, so
            // the locked breakdown is what actually leaves the packs at
            // resolution. Re-invoking re-rolls it. Used by disaster outcomes.
            const proposal = await ResourceSink.proposeSupplyLoss(effect, { characters: getPartyActors() });
            effect._lockedSupply = proposal;
            effect._locked = true;

            if (proposal.totalLoss > 0) {
                const lines = (proposal.breakdown ?? [])
                    .map(b => `${b.actorName}: ${b.itemName ?? "supplies"}${b.lossQty > 1 ? ` &times;${b.lossQty}` : ""}`)
                    .join("<br>");
                await ChatMessage.create({
                    speaker: { alias: te.name ?? "Rest Event" },
                    whisper: game.users.filter(u => u.isGM).map(u => u.id),
                    content: `<p><strong>Lost to the disaster:</strong></p><p>${lines}</p><p><em>Applied after the rest.</em></p>`
                });
            } else {
                await ChatMessage.create({
                    speaker: { alias: te.name ?? "Rest Event" },
                    whisper: game.users.filter(u => u.isGM).map(u => u.id),
                    content: `<p><em>No supplies on hand to lose.</em></p>`
                });
            }
        } else {
            return;
        }

        await app._saveRestState();
        emitPhaseChanged("events", {
            triggeredEvents: app._triggeredEvents,
            activeTreeState: app._activeTreeState,
            eventsRolled: true,
            campStatus: app._campStatus
        });
        app.render();
    
    }

    async onResolveSkillCheck(event, target) {
        const app = this._app;

        if (!game.user.isGM) return;
        event.preventDefault?.();

        const eventIndex = parseInt(target.dataset.eventIndex ?? target.closest("[data-event-index]")?.dataset.eventIndex);
        const outcomeMode = target.dataset.outcome ?? target.closest("[data-outcome]")?.dataset.outcome ?? "auto";
        const triggeredEvent = app._triggeredEvents?.[eventIndex];
        if (!triggeredEvent || !triggeredEvent.mechanical) return;

        // Block if another event is currently awaiting rolls (prevent multi-event collision)
        const anotherAwaiting = (app._triggeredEvents ?? []).some(
            (e, i) => i !== eventIndex && e.awaitingRolls
        );
        if (anotherAwaiting) {
            ui.notifications.warn("Resolve the current event check before starting another.");
            return;
        }

        const dc = triggeredEvent.mechanical.dc ?? 10;
        const skill = triggeredEvent.mechanical.skill ?? "sur";

        const skillKey = skill;

         let outcome = outcomeMode;

        if (outcomeMode === "auto") {
            // Instead of rolling here, broadcast a roll request to players
            const watchIds = triggeredEvent.targets ?? [];
            const actors = watchIds.length > 0
                ? watchIds.map(id => game.actors.get(id)).filter(Boolean)
                : getPartyActors();

            const pendingRolls = actors.map(a => a.id);
            triggeredEvent.awaitingRolls = true;
            triggeredEvent.pendingRolls = [...pendingRolls];
            triggeredEvent.resolvedRolls = [];

            const skillName = SKILL_NAMES[skill] ?? skill;

            emitEventRollRequest({
                    eventIndex,
                    skill: skillKey,
                    skillName,
                    dc,
                    targets: pendingRolls,
                    rollModes: triggeredEvent.rollModes ?? {},
                    eventTitle: triggeredEvent.title ?? "Event",
                    targetLabel: buildRollTargetLabel(triggeredEvent.mechanical)
                });

            // Also broadcast the updated event state so players see the pending UI
            emitPhaseChanged("events", {
                    triggeredEvents: app._triggeredEvents,
                    activeTreeState: app._activeTreeState,
                    eventsRolled: true,
                    campStatus: app._campStatus
                });

            await app._saveRestState();
            app.render();
            return; // Wait for player results via receiveRollResult
        }

        // Force Pass/Fail: resolve immediately. Clear any awaiting-roll state so
        // allEventChecksResolved flips true (Proceed unblocks) and players stop
        // showing roll buttons on the next broadcast.
        triggeredEvent.resolvedOutcome = outcome;
        triggeredEvent.awaitingRolls = false;
        triggeredEvent.pendingRolls = [];

        emitPhaseChanged("events", {
                triggeredEvents: app._triggeredEvents,
                activeTreeState: app._activeTreeState,
                eventsRolled: true,
                campStatus: app._campStatus
            });

        await app._saveRestState();
        app.render();
    
    }

    async onRollTreeCheck(event, target) {
        const app = this._app;

        event.preventDefault?.();
        const characterId = target.dataset.characterId;
        const pending = app._pendingTreeRoll;
        if (!pending || !characterId) return;

        const actor = game.actors.get(characterId);
        if (!actor) return;

        if (!actor.isOwner) {
            ui.notifications.warn("You do not own this character.");
            return;
        }

        // Already rolled?
        if (pending.rolledCharacters?.has(characterId)) return;

        const rollMode = pending.rollModes?.[characterId] ?? "normal";
        const dc = pending.dc;

        // Force outcomes: send a synthetic total without rolling dice
        if (rollMode === "force-pass" || rollMode === "force-fail") {
            const total = rollMode === "force-pass" ? dc : 0;
            if (!pending.rolledCharacters) pending.rolledCharacters = new Set();
            pending.rolledCharacters.add(characterId);
            if (!pending.rolledResults) pending.rolledResults = new Map();
            pending.rolledResults.set(characterId, { total, passed: rollMode === "force-pass" });
            emitTreeRollResult({
                    characterId,
                    characterName: actor.name,
                    total
                });
            ui.notifications.info(`${actor.name}: ${rollMode === "force-pass" ? "Auto-success" : "Auto-fail"} applied.`);
            app.render();
            return;
        }

        const skill = pickBestSkill(actor, pending.skills);
        const modeLabel = rollMode === "advantage" ? " [Advantage]" : rollMode === "disadvantage" ? " [Disadvantage]" : "";
        const flavor = `<strong>${actor.name}</strong> - ${pending.eventName} (${pending.skillName}) DC ${dc}${modeLabel}`;
        const { total } = await executePlayerRoll(actor, skill, dc, flavor, target, rollMode);

        if (!pending.rolledCharacters) pending.rolledCharacters = new Set();
        pending.rolledCharacters.add(characterId);
        if (!pending.rolledResults) pending.rolledResults = new Map();
        pending.rolledResults.set(characterId, { total, passed: total >= dc });

        // Send result to GM
        emitTreeRollResult({
                    characterId,
                    characterName: actor.name,
                    total
                });

        ui.notifications.info(`${actor.name} rolled ${total} for ${pending.skillName}.`);
        app.render();
    
    }
}
