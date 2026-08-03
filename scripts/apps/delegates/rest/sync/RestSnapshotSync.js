import { Logger } from "../../../../utils/Logger.js";
import { CampGearScanner } from "../../../../services/camp/gear/CampGearScanner.js";
import { CampfireTokenLinker } from "../../../../services/camp/fire/CampfireTokenLinker.js";
import {
    notifyDetectMagicScanApplied,
    notifyDetectMagicScanCleared
} from "../../../../services/crafting/detectMagic/DetectMagicInventoryGlowBridge.js";
import { CampCeremonyDelegate } from "../../camp/CampCeremonyDelegate.js";
import { isTrailerFilmingMode } from "../layout/RestWindowLayout.js";
import {
    isStationLayerActive,
    refreshStationEmptyNoticeFade,
    refreshStationPortraitsFromChoices
} from "../../../../services/camp/props/StationInteractionLayer.js";
import { closeOpenStationDialog, refreshOpenStationDialog } from "../../../camp/StationActivityDialog.js";
import { CampfireMakeCampDialog } from "../../../camp/CampfireMakeCampDialog.js";
import { SKILL_NAMES } from "../../../../data/RestConstants.js";
import { shouldPreserveCampfireEmbedOnPhaseChange } from "../../../../services/camp/gear/campCeremonySync.js";
import { logCampfireReconnect } from "../../../../services/camp/fire/CampfireReconnectLog.js";
import { getPartyActors } from "../../../../services/party/partyActors.js";
import * as RestAfkState from "../../../../services/rest/session/RestAfkState.js";
import { pushAllStateToAdapters } from "../../../../services/afk/AfkBridgeService.js";
import { buildRollTargetLabel } from "../../../../services/ui/rollRequest/RollRequestView.js";
import {
    _refreshRejoinBar, _removeGmRestIndicator, _ensureRejoinBar,
    _removeRejoinBar, _showGmRestIndicator
} from "../../../../module.js";
import { RestSetupApp, _logGmRestSheet } from "../../../rest/RestSetupApp.js";
import { MODULE_ID } from "../../../../data/moduleId.js";

export class RestSnapshotSync {
    constructor(app) {
        this._app = app;
    }

    getRestSnapshot() {
        const app = this._app;

        const submissions = {};
        for (const [charId, actId] of app._characterChoices) {
            const act = app._activities?.find(a => a.id === actId);
            submissions[charId] = { activityId: actId, activityName: act?.name ?? actId, source: "snapshot" };
        }

        return {
            phase: app._phase,
            restId: app._restId ?? null,
            submissions,
            triggeredEvents: (app._triggeredEvents ?? []).map(e => ({
                ...e,
                name: undefined,
                narrative: undefined
            })),
            activeTreeState: app._activeTreeState ?? null,
            outcomes: (app._outcomes ?? []).map(o => ({
                characterId: o.characterId,
                characterName: o.characterName,
                outcomes: o.outcomes,
                recovery: o.recovery
            })),
            afkCharacters: RestAfkState.getAfkCharacterIds(),
            doffedArmor: app._doffedArmor ? [...app._doffedArmor] : [],
            eventsRolled: app._eventsRolled ?? false,
            fireLevel: app._fireLevel ?? "unlit",
            fireLitBy: app._fireLitBy ?? null,
            firewoodPledges: Array.from(app._firewoodPledges?.entries() ?? []),
            makeCampStagedWood: [...(app._makeCampStagedWood ?? [])],
            campfireSnapshot: RestSetupApp._campfireSnapshotFromFireLevel(app._fireLevel),
            campStatus: app._campStatus ?? null,
            daysSinceLastRest: app._daysSinceLastRest ?? 1,
            selectedTerrain: app._selectedTerrain ?? "forest",
            campRollRequest: app._pendingCampRolls?.some(p => p.requested) ? {
                activities: app._pendingCampRolls.filter(p => p.requested).map(p => ({
                    characterId: p.characterId,
                    activityId: p.activityId,
                    activityName: p.activityName,
                    skill: p.skill,
                    skillName: p.skillName,
                    dc: p.dc,
                    status: p.status,
                    total: p.total
                }))
            } : null,
            mealChoices: app._mealChoices ? Object.fromEntries(app._mealChoices) : null,
            mealSubmitted: app._mealSubmitted ?? false,
            activityMealRationsSubmitted: [...(app._activityMealRationsSubmitted ?? [])],
            totmFeastServed: app._totmFeastServed ?? false,
            dehydrationResults: (app._pendingDehydrationSaves ?? []).filter(s => s.resolved).map(s => ({
                actorName: s.actorName,
                total: s.total,
                passed: s.passed,
                dc: s.dc,
                reason: s.reason ?? null
            })),
            magicScanComplete: !!app._magicScanComplete,
            magicScanResults: app._magicScanComplete ? (app._magicScanResults ?? []) : null,
            coldCampDecided: app._coldCampDecided ?? false,
            campFirePreviewLevel: app._coldCampDecided ? null : (app._campFirePreviewLevel ?? null),
            coldCampPreview: app._coldCampDecided ? false : !!app._coldCampPreview,
            campStep2Entered: app._campStep2Entered ?? false,
            safeRestSpot: !!app._engine?.safeRestSpot,
            comfort: app._engine?.comfort ?? "rough",
            activeShelters: app._engine?.activeShelters ?? [],
            activities: app._activities ?? [],
            lockedCharacters: Array.from(app._lockedCharacters ?? []),
            craftingResults: Object.fromEntries(app._craftingResults ?? []),
            earlyResults: Object.fromEntries(app._earlyResults ?? []),
            trainingStates: Object.fromEntries(
                [...(app._trainingStates ?? [])].map(([id, s]) => [id, { ...s, rolling: false }])
            )
        };
    
    }

    getRestSnapshotForUser(userId) {
        const app = this._app;

        const snapshot = this.getRestSnapshot();
        if (!userId || app._phase !== "travel") return snapshot;
        const playerTravel = app._buildPlayerTravelRestore(userId);
        if (playerTravel) snapshot.playerTravel = playerTravel;
        return snapshot;
    
    }

    async receivePhaseChange(phase, phaseData = {}) {
        const app = this._app;

        const prevPhase = app._phase;
        if (prevPhase === "activity" && phase !== "activity") {
            void app._detectMagic?.cleanupCastArtifactsOnPhaseExit(getPartyActors());
        }
        const enteringTotmCamp = app._isTotM && phase === "camp" && prevPhase !== "camp";
        const enteringCamp = phase === "camp" && prevPhase !== "camp";
        app._phase = phase;
        if (phaseData.triggeredEvents) {
            app._triggeredEvents = app._isGM ? phaseData.triggeredEvents
                : phaseData.triggeredEvents.map(e => ({ ...e, name: undefined, narrative: undefined, description: undefined, gmPrompt: undefined, checkContext: undefined, gmGuidance: undefined, readAloud: undefined }));

            if (app._pendingEventRoll) {
                const evt = phaseData.triggeredEvents[app._pendingEventRoll.eventIndex];
                if (evt?.resolvedRolls?.length) {
                    if (!app._pendingEventRoll.rolledCharacters) {
                        app._pendingEventRoll.rolledCharacters = new Set();
                    }
                    for (const entry of evt.resolvedRolls) {
                        app._pendingEventRoll.rolledCharacters.add(entry.characterId);
                    }
                }
            }
        }
        if (phaseData.activeTreeState) app._activeTreeState = phaseData.activeTreeState;
        if (phaseData.eventsRolled !== undefined) app._eventsRolled = phaseData.eventsRolled;
        if (phaseData.fireLevel !== undefined && phaseData.fireLevel !== null) {
            app._fireLevel = phaseData.fireLevel;
            app._campFirePreviewLevel = null;
            if (app._engine) {
                app._engine.fireLevel = phaseData.fireLevel;
                const enc = CampGearScanner.FIRE_ENCOUNTER_MOD_BY_LEVEL[phaseData.fireLevel] ?? 0;
                app._engine.fireRollModifier = enc;
            }
            if (phase === "camp") {
                const fl = phaseData.fireLevel;
                if (!game.user.isGM) {
                    void CampfireTokenLinker.setLightState(
                        fl !== "unlit",
                        fl && fl !== "unlit" ? fl : undefined
                    );
                }
                CampfireMakeCampDialog.refreshIfOpen(app);
            }
        }
        if (phaseData.comfort && app._engine) {
            app._engine.comfort = phaseData.comfort;
        }
        if (phaseData.activeShelters && app._engine) {
            app._engine.activeShelters = phaseData.activeShelters;
            if (!game.user.isGM) {
                const fl = phaseData.fireLevel;
                void CampfireTokenLinker.setLightState(
                    fl !== "unlit",
                    fl && fl !== "unlit" ? fl : null
                );
            }
            void refreshOpenStationDialog();
        }
        if (phaseData.fireLitBy !== undefined) app._fireLitBy = phaseData.fireLitBy ?? null;
        if (phaseData.fireLitNotice && phaseData.fireLitBy && !game.user.isGM) {
            const litLevel = phaseData.fireLevel ?? app._fireLevel ?? "unlit";
            const noticeKey = `${phaseData.fireLitBy.actorId ?? ""}:${litLevel}`;
            if (app._lastFireLitToastKey !== noticeKey) {
                app._lastFireLitToastKey = noticeKey;
                CampCeremonyDelegate.showFireLitToast(phaseData.fireLitBy, litLevel);
            }
        }
        if (phaseData.firewoodPledges !== undefined) app._firewoodPledges = new Map(phaseData.firewoodPledges ?? []);
        if (phaseData.makeCampStagedWood !== undefined) {
            app._makeCampStagedWood = [...(phaseData.makeCampStagedWood ?? [])];
            app._makeCampStagedWoodTier = app._campPreviewFirewoodCost();
        }
        if (phaseData.coldCampDecided !== undefined) {
            app._coldCampDecided = !!phaseData.coldCampDecided;
            if (phaseData.coldCampDecided) {
                app._campFirePreviewLevel = null;
                if (phase === "camp" && !game.user.isGM) {
                    void CampfireTokenLinker.setLightState(false);
                }
                CampfireMakeCampDialog.refreshIfOpen(app);
            }
        }
        if (phaseData.campFirePreviewLevel !== undefined) {
            app._campFirePreviewLevel = phaseData.campFirePreviewLevel;
        }
        if (phaseData.coldCampPreview !== undefined) {
            app._coldCampPreview = !!phaseData.coldCampPreview;
            if (app._coldCampPreview) {
                app._campFirePreviewLevel = "cold_camp";
            }
        }
        if (phaseData.campFirePreviewLevel !== undefined) {
            app._maybeClearStagedWoodOnTierChange(phaseData.campFirePreviewLevel);
        }
        if (phaseData.coldCampPreview) {
            app._makeCampStagedWood = [];
            app._makeCampStagedWoodTier = 0;
        }
        if (
            phase === "camp"
            && (phaseData.campFirePreviewLevel !== undefined
                || phaseData.coldCampPreview !== undefined
                || phaseData.makeCampStagedWood !== undefined
                || phaseData.campPartyFirewood !== undefined
                || phaseData.campActorFirewood !== undefined)
        ) {
            app._syncCampCeremonyPreviewToEmbed({
                partyFirewood: phaseData.campPartyFirewood,
                actorFirewood: phaseData.campActorFirewood,
                force: phaseData.campPartyFirewood !== undefined
                    || phaseData.campActorFirewood !== undefined
            });
        }
        if (phaseData.campStep2Entered) app._campStep2Entered = true;
        if (phaseData.campStatus) app._campStatus = phaseData.campStatus;
        if (phaseData.outcomes) app._outcomes = phaseData.outcomes;
        if (phaseData.awaitingCombat !== undefined) {
            app._awaitingCombat = phaseData.awaitingCombat;
            app._mealProcessed = false;
        }

        if (phaseData.daysSinceLastRest !== null && phaseData.daysSinceLastRest !== undefined) {
            app._daysSinceLastRest = phaseData.daysSinceLastRest;
        }
        if (phaseData.selectedTerrain) app._selectedTerrain = phaseData.selectedTerrain;
        if (phase === "meal") {
            // Only reset submission if app is a genuinely new meal phase,
            // not a reconnect/resume where the player already submitted
            if (!app._mealSubmitted) {
                app._mealSubmitted = false;
            }
            app._mealChoices = app._mealChoices ?? new Map();
            // Restore meal choices (including consumedDays) from world setting on reconnect
            try {
                const saved = game.settings.get(MODULE_ID, "activeRest");
                if (saved?.mealChoices) {
                    const savedChoices = new Map(saved.mealChoices);
                    for (const [charId, choice] of savedChoices) {
                        const existing = app._mealChoices.get(charId);
                        // Only restore if client has no data yet (fresh reconnect)
                        if (!existing || !existing.consumedDays?.length) {
                            app._mealChoices.set(charId, choice);
                        }
                    }
                }
                if (saved?.daysSinceLastRest) app._daysSinceLastRest = saved.daysSinceLastRest;
            } catch (e) { /* setting may not exist */ }
        }

        if (phaseData.campRollRequest) {
            if (!app._pendingCampRoll) {
                app._pendingCampRoll = { activities: [], rolledCharacters: new Set() };
            }
            for (const act of phaseData.campRollRequest.activities ?? []) {
                if (!app._pendingCampRoll.activities.some(a => a.characterId === act.characterId)) {
                    app._pendingCampRoll.activities.push(act);
                }
            }
        }

        if (phaseData.campRollsUpdate && app._pendingCampRoll) {
            for (const update of phaseData.campRollsUpdate) {
                const act = app._pendingCampRoll.activities?.find(a => a.characterId === update.characterId);
                if (act) {
                    act.status = update.status;
                    act.total = update.total;
                    act.narrative = update.narrative ?? "";
                    act.effectDescriptions = update.effectDescriptions ?? [];
                    if (update.status !== "pending") {
                        app._pendingCampRoll.rolledCharacters.add(update.characterId);
                    }
                }
            }
        }

        // Campfire panel lifecycle for players (legacy drawer only).
        if (!shouldPreserveCampfireEmbedOnPhaseChange(prevPhase, phase, phaseData)) {
            app._closeCampfire();
        }

        if (phase === "activity") {
            const isTheater = app._isTotM;
            if (!app._isGM) {
                _removeGmRestIndicator();
            }
            if (!isTheater) {
                app._attachActivityPhaseCanvasChrome();
                if (!app._isGM) {

                    Logger.log(`${MODULE_ID} | Activity phase (player): minimise rest window, retain app for station sockets`);
                    await app.close({ retainPlayerApp: true });
                    return;
                }
            }
        } else if (prevPhase === "activity" && phase !== "activity") {
            await closeOpenStationDialog();
            app._tearDownStationLayerCanvas();
            // Player was minimised during activity phase ,  auto-open the RSA so they
            // see the current rest phase (events, meal, reflection, etc.)
            if (!app._isGM) {
                _removeRejoinBar();
        Logger.log(`${MODULE_ID} | Phase ${prevPhase}â†’${phase} (player): removing rejoin bar, auto-opening RSA`);
            }
        }

        if (phaseData.campPitCursorDone && phase === "camp") {
            requestAnimationFrame(() => {
                if (app.rendered) app.render({ force: true });
            });
        }

        if (app._isGM && phase === "activity") {
            if (app._gmMinimizedToFooter) {
                _logGmRestSheet("receivePhaseChange", "GM early return (already minimized)", { phase, prevPhase });
                return;
            }
            app._gmMinimizedToFooter = true;
            _showGmRestIndicator(app);
            if (app.rendered) {
                _logGmRestSheet("receivePhaseChange", "GM close (socket not used for GM in module; local call only)", { phase, prevPhase });
                await app.close({ retainGmRestApp: true });
            }
            return;
        }
        // so the window appears centered at its natural width, not thin/off-right.
        if (!app._isGM && prevPhase === "activity" && !isTrailerFilmingMode() && app.element) {
            const defaultWidth = 720;
            app.setPosition({
                width: defaultWidth,
                left: Math.max(0, (window.innerWidth - defaultWidth) / 2),
                top: Math.max(0, (window.innerHeight - 600) / 2)
            });
        }
        if (enteringCamp && !isTrailerFilmingMode() && !app._restWindowUserPositioned) {
            app._beginRestWindowRecenterSuppression();
            app._presetRestWindowForCampEntry();
        }
        const phaseRenderPromise = Promise.resolve(app.render({ force: true }));
        if (enteringCamp) {
            phaseRenderPromise.then(() => app._finalizeCampPhaseWindowLayout());
        } else if (enteringTotmCamp) {
            phaseRenderPromise.then(() => app._scheduleRestWindowRecenter());
        }
        if (phase === "activity" || phase === "camp") {
            phaseRenderPromise.then(() => app._restoreCampfireUiAfterReconnect());
        }

        // If the player RSA render fails outright, fall back to the rejoin bar
        // so the player can still see the current phase and resume manually.
        // The previous 300ms setTimeout was a guess; on a slow refresh it
        // could fire before render finished and leave both the bar and the
        // RSA visible.
        if (!app._isGM) {
            phaseRenderPromise.catch((err) => {

                Logger.log(`${MODULE_ID} | Phase ${phase}: player RSA render failed, falling back to rejoin bar`, err);
                _ensureRejoinBar(app);
            });
        }
    
    }

    receiveSubmissionUpdate(submissions) {
        const app = this._app;

        if (!submissions || typeof submissions !== "object") {

            Logger.warn("[receiveSubmissionUpdate] received null/undefined submissions ,  ignored.");
            return;
        }

        app._submissionStatus = submissions;

        // Apply the GM's canonical choices directly to _characterChoices.
        // Do NOT write into _playerSubmissions ,  that map is keyed by userId,
        // and writing charId-keyed entries here corrupts the schema and crashes
        // _getPlayerChoiceForCharacter when it accesses submission.choices.
        for (const [charId, info] of Object.entries(submissions)) {
            if (info?.activityId) {
                app._characterChoices.set(charId, info.activityId);
                app._lockedCharacters.add(charId);
            }
        }
        app._updateRestBarProgress();
        _refreshRejoinBar(app);
        if (app._phase === "activity" && isStationLayerActive()) {
            refreshStationPortraitsFromChoices(app._characterChoices, app._stationCanvasIdByCharacter);
            refreshStationEmptyNoticeFade(app);
            app._refreshStationOverlayMeals();
        }
        app.render();
    
    }

    receiveRestSnapshot(snapshot) {
        const app = this._app;

        logCampfireReconnect("receiveRestSnapshot:enter", {
            phase: snapshot?.phase ?? null,
            fireLevel: snapshot?.fireLevel ?? null,
            restId: snapshot?.restId ?? null,
            coldCampDecided: !!snapshot?.coldCampDecided,
            rendered: app.rendered,
            hasCampfireApp: !!app._campfireApp,
            priorPhase: app._phase,
            priorFireLevel: app._fireLevel ?? "unlit"
        });
        if (!app._isGM) {
            _removeGmRestIndicator();
        }
        if (snapshot.submissions) {
            // Apply canonical choices directly to _characterChoices.
            // Do NOT write into _playerSubmissions ,  that map is keyed by userId.
            // Writing charId-keyed entries here corrupts the schema and crashes render.
            for (const [charId, info] of Object.entries(snapshot.submissions)) {
                const actId = info?.activityId ?? info?.activityName;
                if (actId) app._characterChoices.set(charId, actId);
            }
        }

        if (snapshot.afkCharacters !== undefined) {
            RestAfkState.replaceAll(snapshot.afkCharacters ?? []);
            pushAllStateToAdapters();
        }

        if (snapshot.phase) {
            app._phase = snapshot.phase;
        }
        if (snapshot.restId) {
            app._restId = snapshot.restId;
        }
        if (app._restData && snapshot.safeRestSpot !== undefined) {
            app._restData = { ...app._restData, safeRestSpot: !!snapshot.safeRestSpot };
        }
        if (snapshot.triggeredEvents) {
            app._triggeredEvents = app._isGM ? snapshot.triggeredEvents
                : snapshot.triggeredEvents.map(e => ({ ...e, name: undefined, narrative: undefined, description: undefined, gmPrompt: undefined, checkContext: undefined, gmGuidance: undefined, readAloud: undefined }));
        }
        if (snapshot.activeTreeState) {
            app._activeTreeState = snapshot.activeTreeState;
            // Reconstruct player-side tree roll request from tree state, but only
            // once the GM has explicitly dispatched it. Between picking an option
            // and pressing Send the GM is still configuring modifiers, so players
            // must not see a roll prompt yet.
            if (!app._isGM && snapshot.activeTreeState.awaitingRolls && snapshot.activeTreeState.rollRequestSent) {
                const alreadyRolled = new Set(
                    (snapshot.activeTreeState.resolvedRolls ?? []).map(r => r.characterId ?? r.actorId)
                );
                app._pendingTreeRoll = {
                    choiceId: snapshot.activeTreeState.pendingChoice,
                    skills: snapshot.activeTreeState.pendingCheck?.skills ?? [],
                    skillName: snapshot.activeTreeState.pendingSkillName ?? "Skill",
                    dc: snapshot.activeTreeState.pendingDC ?? 12,
                    targets: [
                        ...(snapshot.activeTreeState.pendingRolls ?? []),
                        ...(snapshot.activeTreeState.resolvedRolls ?? []).map(r => r.characterId ?? r.actorId)
                    ],
                    eventName: snapshot.activeTreeState.eventName,
                    rollModes: snapshot.activeTreeState.pendingRollModes ?? {},
                    rolledCharacters: alreadyRolled,
                    rolledResults: new Map(
                        (snapshot.activeTreeState.resolvedRolls ?? []).map(r => [
                            r.characterId ?? r.actorId,
                            { total: r.total, passed: r.passed }
                        ])
                    )
                };
            } else if (!app._isGM) {
                // Not yet dispatched (GM still configuring) or already resolved:
                // drop any stale prompt so the player UI stays in step.
                app._pendingTreeRoll = null;
            }
        }
        // Reconstruct player-side event roll request from triggered events.
        // The event roll request lives only in _pendingEventRoll (set via socket) and
        // is not otherwise in the snapshot, so an alt-tab resync would drop it and the
        // player would fall back to "The GM is adjudicating...". Rebuild it here.
        if (!app._isGM) {
            const awaitingIndex = (app._triggeredEvents ?? []).findIndex(e => e?.awaitingRolls);
            if (awaitingIndex >= 0) {
                const evt = app._triggeredEvents[awaitingIndex];
                const resolved = evt.resolvedRolls ?? [];
                const skillKey = evt.mechanical?.skill ?? "sur";
                const targetIds = evt.targets?.length
                    ? evt.targets
                    : [...(evt.pendingRolls ?? []), ...resolved.map(r => r.characterId)];
                const priorRolled = (app._pendingEventRoll?.eventIndex === awaitingIndex)
                    ? app._pendingEventRoll.rolledCharacters
                    : null;
                const rolledCharacters = priorRolled ?? new Set();
                for (const r of resolved) rolledCharacters.add(r.characterId ?? r.id);
                app._pendingEventRoll = {
                    eventIndex: awaitingIndex,
                    skill: skillKey,
                    skillName: SKILL_NAMES[skillKey] ?? skillKey,
                    dc: evt.mechanical?.dc ?? 10,
                    targets: [...new Set(targetIds.filter(Boolean))],
                    rollModes: evt.rollModes ?? {},
                    eventTitle: evt.title ?? "Event",
                    targetLabel: buildRollTargetLabel(evt.mechanical),
                    rolledCharacters
                };
            } else if (app._pendingEventRoll) {
                app._pendingEventRoll = null;
            }
        }
        if (snapshot.outcomes?.length) app._outcomes = snapshot.outcomes;
        if (snapshot.eventsRolled !== undefined) app._eventsRolled = snapshot.eventsRolled;
        if (snapshot.fireLevel !== undefined && snapshot.fireLevel !== null) {
            app._fireLevel = snapshot.fireLevel;
            if (app._engine) {
                app._engine.fireLevel = snapshot.fireLevel;
                const enc = CampGearScanner.FIRE_ENCOUNTER_MOD_BY_LEVEL[snapshot.fireLevel] ?? 0;
                app._engine.fireRollModifier = enc;
            }
        }
        if (snapshot.comfort && app._engine) {
            app._engine.comfort = snapshot.comfort;
        }
        if (snapshot.activeShelters && app._engine) {
            app._engine.activeShelters = snapshot.activeShelters;
        }
        if (snapshot.safeRestSpot !== undefined && app._engine) {
            app._engine.safeRestSpot = !!snapshot.safeRestSpot;
        }
        if (snapshot.fireLitBy !== undefined) app._fireLitBy = snapshot.fireLitBy ?? null;
        if (snapshot.firewoodPledges !== undefined) {
            app._firewoodPledges = new Map(snapshot.firewoodPledges ?? []);
        }
        if (snapshot.makeCampStagedWood !== undefined) {
            app._makeCampStagedWood = [...(snapshot.makeCampStagedWood ?? [])];
            app._makeCampStagedWoodTier = app._campPreviewFirewoodCost();
        }
        if (snapshot.coldCampDecided !== undefined) {
            app._coldCampDecided = !!snapshot.coldCampDecided;
            if (snapshot.coldCampDecided) {
                app._campFirePreviewLevel = null;
            }
        }
        if (snapshot.campFirePreviewLevel !== undefined) {
            app._campFirePreviewLevel = snapshot.campFirePreviewLevel;
        }
        if (snapshot.coldCampPreview !== undefined) {
            app._coldCampPreview = !!snapshot.coldCampPreview;
            if (app._coldCampPreview) {
                app._campFirePreviewLevel = "cold_camp";
            }
        }
        if (snapshot.campFirePreviewLevel !== undefined) {
            app._maybeClearStagedWoodOnTierChange(snapshot.campFirePreviewLevel);
        }
        if (snapshot.coldCampPreview) {
            app._makeCampStagedWood = [];
            app._makeCampStagedWoodTier = 0;
        }
        if (snapshot.campStep2Entered !== undefined) {
            app._campStep2Entered = !!snapshot.campStep2Entered;
        }
        if (
            app._phase === "camp"
            && (snapshot.campFirePreviewLevel !== undefined
                || snapshot.coldCampPreview !== undefined
                || snapshot.makeCampStagedWood !== undefined)
        ) {
            app._syncCampCeremonyPreviewToEmbed?.();
        }
        if (snapshot.campStatus) app._campStatus = snapshot.campStatus;

        // Restore camp roll data for pending camp activity checks
        if (snapshot.campRollRequest) {
            app._pendingCampRoll = {
                activities: snapshot.campRollRequest.activities ?? [],
                rolledCharacters: new Set(
                    (snapshot.campRollRequest.activities ?? [])
                        .filter(a => a.status && a.status !== "pending")
                        .map(a => a.characterId)
                )
            };
        }

        if (snapshot.doffedArmor?.length) {
            if (!app._doffedArmor) app._doffedArmor = new Map();
            for (const [actorId, itemId] of snapshot.doffedArmor) {
                app._doffedArmor.set(actorId, itemId);
            }
        }

        // Restore meal state from snapshot
        if (snapshot.mealChoices) {
            app._mealChoices = new Map(Object.entries(snapshot.mealChoices));
        }
        // Only set mealSubmitted to true, never clear it (player's local state takes precedence)
        if (snapshot.mealSubmitted) {
            app._mealSubmitted = true;
        }
        if (Array.isArray(snapshot.activityMealRationsSubmitted)) {
            app._activityMealRationsSubmitted = new Set(snapshot.activityMealRationsSubmitted);
        }
        if (snapshot.totmFeastServed != null) {
            app._totmFeastServed = !!snapshot.totmFeastServed;
        }
        if (snapshot.daysSinceLastRest) {
            app._daysSinceLastRest = snapshot.daysSinceLastRest;
        }
        if (snapshot.selectedTerrain) {
            app._selectedTerrain = snapshot.selectedTerrain;
        }
        if (snapshot.dehydrationResults?.length) {
            app._dehydrationResults = snapshot.dehydrationResults;
        }

        if ("magicScanComplete" in snapshot) {
            if (snapshot.magicScanComplete) {
                app._magicScanResults = snapshot.magicScanResults ?? [];
                app._magicScanComplete = true;
                notifyDetectMagicScanApplied(app, getPartyActors().map(a => a.id));
            } else {
                const hadComplete = app._magicScanComplete;
                app._magicScanResults = null;
                app._magicScanComplete = false;
                if (hadComplete) notifyDetectMagicScanCleared();
            }
        }

        // Reload activity resolver from snapshot if it arrives without one.
        // This covers late-joining players who missed the initial emitRestStarted.
        if (snapshot.lockedCharacters?.length) {
            app._lockedCharacters = new Set(snapshot.lockedCharacters);
        }
        if (snapshot.craftingResults && typeof snapshot.craftingResults === "object") {
            app._craftingResults = new Map(Object.entries(snapshot.craftingResults));
            for (const charId of app._craftingResults.keys()) {
                app._lockedCharacters.add(charId);
            }
        }
        if (snapshot.earlyResults && typeof snapshot.earlyResults === "object") {
            app._earlyResults = app._earlyResults ?? new Map();
            for (const [charId, result] of Object.entries(snapshot.earlyResults)) {
                if (result && !app._earlyResults.has(charId)) {
                    app._earlyResults.set(charId, result);
                }
            }
        }
        if (snapshot.trainingStates && typeof snapshot.trainingStates === "object") {
            app._trainingStates = new Map(Object.entries(snapshot.trainingStates));
            app._clearStaleTrainingRollingFlags();
        }

        if (app._phase === "activity") {
            app._ensureTrainingStateForLockedChoices();
            app._syncIncompleteTrainingView();
        }

        if (snapshot.playerTravel) {
            app._applyPlayerTravelRestore(snapshot.playerTravel);
        } else if (!app._isGM && app._phase === "travel") {
            try {
                const saved = game.settings.get(MODULE_ID, "activeRest");
                if (saved?.travelState) {
                    const pt = RestSetupApp.buildPlayerTravelRestoreFromSerialized(
                        saved.travelState,
                        game.user.id
                    );
                    if (pt) app._applyPlayerTravelRestore(pt);
                }
            } catch { /* setting may be unavailable */ }
        }

        if (Array.isArray(snapshot.activities) && snapshot.activities.length > 0
            && !(app._activityResolver?.activities?.size)) {
            app._activities = snapshot.activities;
            app._activityResolver.load(app._activities);
        }

        if (app._phase === "activity" && isStationLayerActive()) {
            refreshStationPortraitsFromChoices(app._characterChoices, app._stationCanvasIdByCharacter);
            refreshStationEmptyNoticeFade(app);
            app._refreshStationOverlayMeals();
        }

        // Make Camp F5: drop any stale rejoin chrome and keep ceremony embed mounted when possible.
        if (app._phase === "camp" && !app._isGM) {
            _removeRejoinBar();
        }

        // Campfire panel lifecycle on snapshot restore (legacy drawer only).
        const preserveCampCeremonyEmbed = app._phase === "camp" && app._campCeremonyMinigameEnabled();
        logCampfireReconnect("receiveRestSnapshot:beforeCloseCampfire", {
            phase: app._phase,
            fireLevel: app._fireLevel ?? "unlit",
            shouldShowPanel: app._shouldShowTotmCampfirePanel(),
            preserveCampCeremonyEmbed,
            hasCampfireApp: !!app._campfireApp,
            ...app._campfireReconnectGateDetail()
        });
        app._closeCampfire({
            preserveActivityEmbed: app._shouldShowTotmCampfirePanel() || preserveCampCeremonyEmbed
        });

        // Activity phase: same as receivePhaseChange (F5 rejoin after GM already advanced)
        const _isTheaterRestore = app._isTotM;
        if (app._phase === "activity" && !app._isGM) {
            if (!_isTheaterRestore) {
                app._attachActivityPhaseCanvasChrome();
                if (app.rendered) {
                    // Mirror the GM guard above: only close when there's a
                    // rendered window to dismiss. Closing an unrendered app
                    // races with any pending force-render and leaves both
                    // the RSA and the rejoin bar visible.
                    void app.close({ retainPlayerApp: true });
                } else {
                    // Stations + activity wants the canvas-only surface;
                    // skip the render and put up the rejoin bar directly.
                    _ensureRejoinBar(app);
                }
                return;
            }
        }
        if (app._phase === "activity" && app._isGM) {
            if (!_isTheaterRestore) {
                app._attachActivityPhaseCanvasChrome();
                app._gmMinimizedToFooter = true;
                _showGmRestIndicator(app);
                if (app.rendered) {
                    void app.close({});
                }
                return;
            }
        }

        // Single render with all state applied. Force-render so the first
        // pass works on a fresh app (handleRestStarted now defers to us when
        // a snapshot is included; without force, ApplicationV2 may no-op on
        // a state-NONE or state-CLOSED app).
        const snapshotRenderPromise = Promise.resolve(app.render({ force: true }));
        void snapshotRenderPromise
            .then(async () => {
                if (app._phase === "camp") {
                    if (app._restWindowRecenterSuppressed) {
                        await app._finalizeCampPhaseWindowLayout();
                    } else if (!isTrailerFilmingMode() && !app._restWindowUserPositioned) {
                        app._scheduleRestWindowRecenter({ smooth: true });
                    }
                    app._syncCampCeremonyPreviewToEmbed?.();
                }
                logCampfireReconnect("receiveRestSnapshot:renderDone", {
                    phase: app._phase,
                    fireLevel: app._fireLevel ?? "unlit",
                    shouldShowPanel: app._shouldShowTotmCampfirePanel(),
                    hasCampfireApp: !!app._campfireApp,
                    hostInDom: !!app.element?.querySelector(".totm-campfire-minigame-host")
                });
                return app._restoreCampfireUiAfterReconnect();
            })
            .catch((err) => {
                logCampfireReconnect("receiveRestSnapshot:failed", { error: String(err?.message ?? err) });
                Logger.log(`${MODULE_ID} | receiveRestSnapshot: render/restore failed`, err);
                if (!app._isGM) _ensureRejoinBar(app);
            });
    
    }

    receiveArmorToggle(actorId, itemId, isDoffed) {
        const app = this._app;

        if (!app._doffedArmor) app._doffedArmor = new Map();
        if (isDoffed) {
            app._doffedArmor.set(actorId, itemId);
        } else {
            app._doffedArmor.delete(actorId);
        }
        app.render();
    
    }
}
