import { DecisionTreeResolver } from "../../../services/events/resolve/DecisionTreeResolver.js";
import { TerrainRegistry } from "../../../services/events/resolve/TerrainRegistry.js";
import { countPoolEventsForTerrain, listPoolEventsForTerrain } from "../../../services/events/catalog/EventCatalogLoader.js";
import { resolveNightWatchMode } from "./nightWatchMode.js";
import { pickPoolEvent } from "../../events/AdHocEventDialogs.js";
import {
    emitPhaseChanged,
    emitTreeRollRequest,
    emitEventRollResult,
    emitCampRollResult,
    emitSubmissionUpdate,
    emitActivityChoice,
    emitRestSnapshot
} from "../../../services/socket/SocketController.js";
import {
    executePlayerRoll,
    rollForPlayer,
    pickBestSkill,
    SKILL_DISPLAY_NAMES,
    waitForDiceSoNice,
    disableRollButton
} from "../../../services/ui/rollRequest/RollRequestManager.js";
import { GrantLedger } from "../../../services/crafting/outcomes/GrantLedger.js";
import { ItemOutcomeHandler } from "../../../services/crafting/outcomes/ItemOutcomeHandler.js";
import {
    isStationLayerActive,
    refreshStationEmptyNoticeFade,
    refreshStationPortraitsFromChoices,
    resetStationOverlaysLocal
} from "../../../services/camp/props/StationInteractionLayer.js";
import { getPartyActors } from "../../../services/party/partyActors.js";
import { MODULE_ID } from "../../../data/moduleId.js";
import { lockSubmittedActivities } from "../../../services/rest/session/campProgressState.js";
import { _refreshGmRestIndicator } from "../../../module.js";

export const eventsTreeAndPoolActions = {
    beginEventsCommit() {
        const app = this._app;

        if (app._eventsCommitPending || app._eventsRolled) return false;
        if (!app._engine || app._phase !== "events") return false;
        app._eventsCommitPending = true;
        app.render();
        return true;
    
    },

    endEventsCommit() {
        const app = this._app;

        if (!app._eventsCommitPending) return;
        app._eventsCommitPending = false;
        if (!app._eventsRolled) app.render();
    
    },

    _currentTerrainPoolCount() {
        const app = this._app;
        const terrainTag = app._engine?.terrainTag ?? app._selectedTerrain ?? "forest";
        return countPoolEventsForTerrain(app._eventResolver, terrainTag);
    },

    async onRollEvents(event, target) {
        const app = this._app;

        if (!app._forceEncounter && this._currentTerrainPoolCount() === 0) {
            ui.notifications.warn(game.i18n.localize("ionrift-respite.eventsPhase.warnCuratePoolFirst"));
            return;
        }

        if (app._forceEncounter) {
            app._forceEncounter = false;
            const terrainTag = app._engine?.terrainTag ?? "forest";
            const table = app._eventResolver.tables.get(terrainTag);
            if (table) {
                const encounterEntry = table.entries.find(e => {
                    const ev = app._eventResolver.events.get(e.eventId);
                    return ev?.category === "encounter";
                });
                if (encounterEntry) {
                    const ev = app._eventResolver.events.get(encounterEntry.eventId);
                    const targets = getPartyActors().map(a => a.id);
                    app._triggeredEvents = [{
                        id: ev.id, name: ev.name, category: ev.category,
                        description: ev.description, mechanical: ev.mechanical,
                        isDecisionTree: ev.mechanical?.type === "decision_tree",
                        targets, rollTotal: 1, result: "triggered",
                        narrative: ev.description,
                        items: ev.mechanical?.onSuccess?.items ?? [],
                        effects: ev.mechanical?.onFailure?.effects ?? []
                    }];
                    ui.notifications.info(game.i18n.format("ionrift-respite.eventsPhase.infoForcedEncounter", { name: ev.name }));
                } else {
                    app._triggeredEvents = await app._engine.resolveEvents(app._eventResolver, app._earlyResults);
                }
            } else {
                app._triggeredEvents = await app._engine.resolveEvents(app._eventResolver, app._earlyResults);
            }
        } else {
            app._triggeredEvents = await app._engine.resolveEvents(app._eventResolver, app._earlyResults);
        }

        if (app._triggeredEvents.disasterChoice) {
            app._disasterChoice = app._triggeredEvents.disasterChoice;
            app._triggeredEvents = []; // Clear until GM picks
            app._eventsRolled = true;
            await app._saveRestState();
            app.render();
            return; // Wait for GM to pick via #onDisasterChoice
        }

        app._eventsRolled = true;

        await this.finalizeEventsRoll();
    
    },

    async finalizeEventsRoll() {
        const app = this._app;

        const hasEncounter = app._triggeredEvents?.some(e => e.category === "encounter" || e.category === "combat");
        if (hasEncounter && app._engine && app._activityResolver) {
            const buffs = app._engine.aggregateCombatBuffs(app._activityResolver);
            app._combatBuffs = buffs;
            if (buffs.perCharacter.length > 0) {
                const lines = buffs.perCharacter.map(b => `<strong>${b.characterName}</strong> (${b.activityName}): ${b.summary}`);
                if (buffs.partyWide.summary) lines.push(`<em>${buffs.partyWide.summary}</em>`);
                await ChatMessage.create({
                    content: `<div style="border-left:3px solid #7eb8da;padding-left:8px;"><strong>${game.i18n.localize("ionrift-respite.eventsPhase.combatReadiness")}</strong><br>${lines.join("<br>")}</div>`,
                    speaker: { alias: "Respite" }
                });
            }
        }

        const treeEvent = app._triggeredEvents.find(e => e.isDecisionTree);
        if (treeEvent) {
            app._activeTreeState = DecisionTreeResolver.createTreeState(
                { id: treeEvent.id, name: treeEvent.name, description: treeEvent.description, gmPrompt: treeEvent.gmPrompt, checkContext: treeEvent.checkContext, gmGuidance: treeEvent.gmGuidance, mechanical: treeEvent.mechanical },
                treeEvent.targets
            );
            if (treeEvent.mechanical?.stallPenalty) {
                app._activeTreeState.stallPenalty = treeEvent.mechanical.stallPenalty;
                app._activeTreeState.hasStallPenalty = true;
                app._activeTreeState.stalled = false;
            }
        }

        if (app._triggeredEvents?.length > 0) {
            for (const evt of app._triggeredEvents) {
                app._restLedger.add({
                    phase: "events",
                    category: evt.category === "encounter" ? "encounter" : "event",
                    icon: evt.category === "encounter" ? "fas fa-swords" : "fas fa-scroll",
                    summary: evt.name ?? "Event triggered",
                    detail: evt.rollTotal != null ? `Roll: ${evt.rollTotal}` : ""
                });
            }
        } else {
            app._restLedger.add({
                phase: "events", category: "night_pass", icon: "fas fa-moon",
                summary: "The night passes without incident."
            });
        }
        app._refreshLedgerApp();

        emitPhaseChanged("events", {
                triggeredEvents: app._triggeredEvents,
                activeTreeState: app._activeTreeState,
                eventsRolled: true
            });

        await app._saveRestState();
        app.render();
    
    },

    async onImproviseEvent(event, target) {
        const app = this._app;

        if (!game.user.isGM) return;
        if (!app._engine || app._phase !== "events" || app._eventsRolled) return;

        const effectiveDC = app._engine.getEffectiveEncounterDC({ earlyResults: app._earlyResults });
        const roll = await new Roll("1d20").evaluate();
        const rawDie = roll.total;
        const triggered = rawDie === 1 || rawDie < effectiveDC;
        const terrainTag = app._engine.terrainTag ?? "forest";
        const terrainLabel = TerrainRegistry.get(terrainTag)?.label ?? terrainTag;

        if (triggered) {
            await roll.toMessage({
                speaker: { alias: "Night Watch" },
                flavor: game.i18n.format("ionrift-respite.nightWatch.improvise.triggered", {
                    terrain: terrainLabel,
                    dc: effectiveDC,
                    roll: rawDie
                }),
                whisper: game.users.filter(u => u.isGM).map(u => u.id)
            });
            app._triggeredEvents = [{
                id: `adhoc_${Date.now()}`,
                name: game.i18n.localize("ionrift-respite.eventsPhase.improvisedEncounter"),
                category: "encounter",
                description: "",
                mechanical: null,
                isDecisionTree: false,
                targets: [],
                rollTotal: rawDie,
                result: "triggered",
                narrative: "",
                adHoc: true
            }];
        } else {
            await roll.toMessage({
                speaker: { alias: "Night Watch" },
                flavor: game.i18n.format("ionrift-respite.nightWatch.improvise.quiet", {
                    terrain: terrainLabel,
                    dc: effectiveDC,
                    roll: rawDie
                }),
                whisper: game.users.filter(u => u.isGM).map(u => u.id)
            });
            app._triggeredEvents = [];
        }

        app._eventsRolled = true;
        await this.finalizeEventsRoll();
    
    },

    async onNightPasses(event, target) {
        const app = this._app;

        if (!game.user.isGM) return;
        if (!this.beginEventsCommit()) return;
        try {
            await ChatMessage.create({
                speaker: { alias: "Night Watch" },
                content: `<div style="border-left:3px solid #7eb8da;padding-left:8px;"><strong>${game.i18n.localize("ionrift-respite.eventsPhase.nightWatchHeading")}</strong><br>${game.i18n.localize("ionrift-respite.eventsPhase.nightWatchQuiet")}</div>`,
                whisper: game.users.filter(u => u.isGM).map(u => u.id)
            });
            app._triggeredEvents = [];
            app._eventsRolled = true;
            await this.finalizeEventsRoll();
        } finally {
            this.endEventsCommit();
        }
    
    },

    async onImproviseNight(event, target) {
        const app = this._app;

        if (!game.user.isGM) return;
        if (!app._engine || app._phase !== "events" || app._eventsRolled) return;
        try {
            if (!game.settings.get(MODULE_ID, "enableEncounters")) return;
        } catch { /* settings not ready */ }
        app._triggeredEvents = [{
            id: `adhoc_${Date.now()}`,
            name: game.i18n.localize("ionrift-respite.eventsPhase.improvisedEncounter"),
            category: "encounter",
            description: "",
            mechanical: null,
            isDecisionTree: false,
            targets: [],
            rollTotal: null,
            result: "triggered",
            narrative: "",
            adHoc: true
        }];
        app._eventsRolled = true;
        await this.finalizeEventsRoll();
    
    },

    async onPickPoolEvent(event, target) {
        const app = this._app;

        if (!game.user.isGM) return;
        if (!app._engine || app._phase !== "events" || app._eventsRolled) return;

        const terrainTag = app._engine.terrainTag ?? app._selectedTerrain ?? "forest";
        const poolEvents = listPoolEventsForTerrain(app._eventResolver, terrainTag);
        if (!poolEvents.length) {
            ui.notifications.warn(game.i18n.localize("ionrift-respite.eventsPhase.warnCuratePoolFirstApp"));
            return;
        }

        const terrain = TerrainRegistry.get(terrainTag);
        const terrainLabel = terrain?.label ?? terrainTag;
        const eventId = await pickPoolEvent(poolEvents, terrainLabel, terrainTag);
        if (!eventId) return;

        const catalogEvent = app._eventResolver.events.get(eventId);
        if (!catalogEvent) {
            ui.notifications.error(game.i18n.localize("ionrift-respite.eventsPhase.errorEventNotInPool"));
            return;
        }

        const watchRoster = app._engine.watchRoster ?? [];
        app._triggeredEvents = [
            app._eventResolver.buildManualResult(catalogEvent, watchRoster, { result: "manual_pick" })
        ];
        app._eventsRolled = true;
        await this.finalizeEventsRoll();
    
    },

    async onSetEventsMode(event, target) {
        const app = this._app;

        if (!game.user.isGM) return;
        if (app._eventsCommitPending) return;
        if (app._phase !== "events" || app._eventsRolled) return;
        const mode = target?.dataset?.mode;
        if (!["random", "improvise", "pick"].includes(mode)) return;
        if ((mode === "random" || mode === "pick") && this._currentTerrainPoolCount() === 0) return;
        if (app._eventsMode === mode) return;
        app._eventsMode = mode;
        app.render();
    
    },

    async onCommitEventsMode(event, target) {
        const app = this._app;

        if (!game.user.isGM) return;
        const { effectiveMode } = resolveNightWatchMode(app._eventsMode, this._currentTerrainPoolCount());
        // Pick-from-pool opens a dialog; do not lock the parent UI until an event is chosen.
        const lockParentUi = effectiveMode !== "pick";
        if (lockParentUi && !this.beginEventsCommit()) return;
        try {
            switch (effectiveMode) {
                case "improvise":
                    await this.onImproviseEvent(event, target);
                    break;
                case "pick":
                    await this.onPickPoolEvent(event, target);
                    break;
                case "random":
                default:
                    await this.onRollEvents(event, target);
                    break;
            }
        } finally {
            if (lockParentUi) this.endEventsCommit();
        }
    
    },

    async onAcknowledgeEncounter(event, target) {
        const app = this._app;

        await app._removeBeddingDown();
        app._awaitingCombat = true;
        app._combatAcknowledged = false;
        app._combatBuffs = app._combatBuffs ?? null;
        await app._saveRestState();

        emitPhaseChanged("events", {
                triggeredEvents: app._triggeredEvents,
                activeTreeState: app._activeTreeState,
                eventsRolled: true,
                awaitingCombat: true
            });

        ui.notifications.info(game.i18n.localize("ionrift-respite.eventsPhase.infoSetupEncounter"));

        app.close();
    
    },

    async onCompleteEncounter(event, target) {
        const app = this._app;

        app._awaitingCombat = false;
        app._combatAcknowledged = true;
        await app._saveRestState();

        emitPhaseChanged("events", {
                triggeredEvents: app._triggeredEvents,
                activeTreeState: app._activeTreeState,
                eventsRolled: true,
                awaitingCombat: false
            });

        app.render();
    
    },

    async onDisasterChoice(event, target) {
        const app = this._app;

        const pick = target.dataset.pick; // "tree", "encounter", "normals", or "dismiss"
        if (!app._disasterChoice || !pick) return;

        if (pick === "dismiss") {
            // GM discretion: skip disaster events entirely
            app._disasterChoice = null;
        } else if (pick === "tree" && app._disasterChoice.tree) {
            app._triggeredEvents = [app._disasterChoice.tree];
        } else if (pick === "encounter" && app._disasterChoice.encounter) {
            app._triggeredEvents = [app._disasterChoice.encounter];
        } else if (pick === "normals" && app._disasterChoice.normals?.length) {
            app._triggeredEvents = [...app._disasterChoice.normals];
        } else {
            app._triggeredEvents = app._disasterChoice.tree
                ? [app._disasterChoice.tree]
                : app._disasterChoice.encounter
                    ? [app._disasterChoice.encounter]
                    : [...(app._disasterChoice.normals ?? [])];
        }

        app._disasterChoice = null;

        const hasEncounter = app._triggeredEvents?.some(e => e.category === "encounter" || e.category === "combat");
        if (hasEncounter && app._engine && app._activityResolver) {
            const buffs = app._engine.aggregateCombatBuffs(app._activityResolver);
            app._combatBuffs = buffs;
            if (buffs.perCharacter.length > 0) {
                const lines = buffs.perCharacter.map(b => `<strong>${b.characterName}</strong> (${b.activityName}): ${b.summary}`);
                if (buffs.partyWide.summary) lines.push(`<em>${buffs.partyWide.summary}</em>`);
                await ChatMessage.create({
                    content: `<div style="border-left:3px solid #7eb8da;padding-left:8px;"><strong>${game.i18n.localize("ionrift-respite.eventsPhase.combatReadiness")}</strong><br>${lines.join("<br>")}</div>`,
                    speaker: { alias: "Respite" }
                });
            }
        }

        const treeEvent = app._triggeredEvents.find(e => e.isDecisionTree);
        if (treeEvent) {
            app._activeTreeState = DecisionTreeResolver.createTreeState(
                { id: treeEvent.id, name: treeEvent.name, description: treeEvent.description, gmPrompt: treeEvent.gmPrompt, checkContext: treeEvent.checkContext, gmGuidance: treeEvent.gmGuidance, mechanical: treeEvent.mechanical },
                treeEvent.targets
            );
        }

        emitPhaseChanged("events", {
                triggeredEvents: app._triggeredEvents,
                activeTreeState: app._activeTreeState,
                eventsRolled: true
            });

        await app._saveRestState();
        app.render();
    
    },

    async onResolveTreeChoice(event, target) {
        const app = this._app;

        const choiceId = target.dataset.choiceId;
        if (!choiceId || !app._activeTreeState) return;

        const prepared = DecisionTreeResolver.prepareChoice(app._activeTreeState, choiceId);
        if (!prepared) return;

        // Enter pending-roll state ,  but do NOT dispatch to players yet
        app._activeTreeState.awaitingRolls = true;
        app._activeTreeState.rollRequestSent = false;
        app._activeTreeState.pendingChoice = choiceId;
        app._activeTreeState.pendingRolls = [...prepared.targetIds];
        app._activeTreeState.resolvedRolls = [];
        app._activeTreeState.pendingCheck = prepared.check;
        // Roll modes: per-character override map (normal/advantage/disadvantage/force-pass/force-fail)
        app._activeTreeState.pendingRollModes = {};
        // Spell rulings advisory for the awaiting panel
        app._activeTreeState.pendingChoiceSpellRulings = prepared.option.spellRulings ?? null;
        app._activeTreeState.pendingCheckContext = prepared.check?.checkContext ?? null;

        const skillKey = pickBestSkill(
            game.actors.get(prepared.targetIds[0]),
            prepared.skills
        );
        const skillName = SKILL_DISPLAY_NAMES[skillKey] ?? skillKey;
        app._activeTreeState.pendingSkillName = skillName;
        app._activeTreeState.pendingSkillKey = skillKey;
        app._activeTreeState.pendingDC = prepared.dc;

        await app._saveRestState();
        app.render();
    
    },

    async onSendTreeRollRequest(event, target) {
        const app = this._app;

        if (!game.user.isGM) return;
        if (!app._activeTreeState?.awaitingRolls) return;

        app._activeTreeState.rollRequestSent = true;

        // A force override is the GM's decision, not the player's. Resolve those
        // characters here so the player is never asked to confirm an outcome the
        // GM already set. Snapshot the ids first since receiveTreeRollResult
        // mutates pendingRolls as each result lands.
        const modes = app._activeTreeState.pendingRollModes ?? {};
        const dc = app._activeTreeState.pendingDC ?? 12;
        const forcedIds = (app._activeTreeState.pendingRolls ?? []).filter(
            id => modes[id] === "force-pass" || modes[id] === "force-fail"
        );
        for (const characterId of forcedIds) {
            const actor = game.actors.get(characterId);
            const total = modes[characterId] === "force-pass" ? dc : 0;
            await app.receiveTreeRollResult({ characterId, characterName: actor?.name ?? "Unknown", total });
        }

        // If forcing resolved every participant, the tree is done; nothing to dispatch.
        if (!app._activeTreeState?.awaitingRolls) return;

        const resolvedRolls = app._activeTreeState.resolvedRolls ?? [];
        emitTreeRollRequest({
                    choiceId: app._activeTreeState.pendingChoice,
                    skills: app._activeTreeState.pendingCheck?.skills ?? [],
                    skillName: app._activeTreeState.pendingSkillName ?? "Skill",
                    dc: app._activeTreeState.pendingDC ?? 12,
                    targets: [
                        ...(app._activeTreeState.pendingRolls ?? []),
                        ...resolvedRolls.map(r => r.characterId ?? r.actorId)
                    ],
                    eventName: app._activeTreeState.eventName,
                    rollModes: app._activeTreeState.pendingRollModes ?? {},
                    resolvedRolls
                });

        emitPhaseChanged("events", {
                triggeredEvents: app._triggeredEvents,
                activeTreeState: app._activeTreeState,
                eventsRolled: true,
                campStatus: app._campStatus
            });

        await app._saveRestState();
        app.render();
    
    },

    async onRollTreeForPlayer(event, target) {
        const app = this._app;

        if (!game.user.isGM) return;
        const characterId = target.dataset.characterId;
        if (!characterId || !app._activeTreeState?.awaitingRolls) return;

        const actor = game.actors.get(characterId);
        if (!actor) return;

        const rollMode = app._activeTreeState.pendingRollModes?.[characterId] ?? "normal";
        const dc = app._activeTreeState.pendingDC ?? 12;

        // Force outcomes inject a synthetic total
        if (rollMode === "force-pass" || rollMode === "force-fail") {
            const total = rollMode === "force-pass" ? dc : 0;
            await app.receiveTreeRollResult({ characterId, characterName: actor.name, total });
            return;
        }

        const skills = app._activeTreeState.pendingCheck?.skills ?? [];
        const context = `${app._activeTreeState.eventName} - Decision`;

        const result = await rollForPlayer(actor, skills, dc, context, rollMode);

        // Feed the result back through the normal collection path
        await app.receiveTreeRollResult({
            characterId,
            characterName: actor.name,
            total: result.total
        });
    
    },

    onResendTreeRollRequest(event, target) {
        const app = this._app;

        if (!game.user.isGM) return;
        if (!app._activeTreeState?.awaitingRolls) return;

        const resolvedRolls = app._activeTreeState.resolvedRolls ?? [];
        emitTreeRollRequest({
                    choiceId: app._activeTreeState.pendingChoice,
                    skills: app._activeTreeState.pendingCheck?.skills ?? [],
                    skillName: app._activeTreeState.pendingSkillName ?? "Skill",
                    dc: app._activeTreeState.pendingDC ?? 12,
                    targets: [
                        ...(app._activeTreeState.pendingRolls ?? []),
                        ...resolvedRolls.map(r => r.characterId ?? r.actorId)
                    ],
                    eventName: app._activeTreeState.eventName,
                    rollModes: app._activeTreeState.pendingRollModes ?? {},
                    resolvedRolls
                });

        ui.notifications.info(game.i18n.localize("ionrift-respite.eventsPhase.infoTreeRollResent"));
    
    },

    onCycleTreeRollMode(event, target) {
        const app = this._app;

        event.preventDefault?.();
        if (!game.user.isGM) return;
        const characterId = target.dataset.characterId;
        if (!characterId || !app._activeTreeState?.awaitingRolls) return;

        if (!app._activeTreeState.pendingRollModes) app._activeTreeState.pendingRollModes = {};
        const CYCLE = {
            normal: "advantage",
            advantage: "disadvantage",
            disadvantage: "force-pass",
            "force-pass": "force-fail",
            "force-fail": "normal"
        };
        const current = app._activeTreeState.pendingRollModes[characterId] ?? "normal";
        app._activeTreeState.pendingRollModes[characterId] = CYCLE[current] ?? "normal";

        this.broadcastTreeRollModes();
        app.render();
    
    },

    broadcastTreeRollModes() {
        const app = this._app;

        emitPhaseChanged("events", {
                triggeredEvents: app._triggeredEvents,
                activeTreeState: app._activeTreeState,
                eventsRolled: true,
                campStatus: app._campStatus
            });
    
    },

    async onRollEventForPlayer(event, target) {
        const app = this._app;

        if (!game.user.isGM) return;
        const button = target.closest(".btn-roll-for-player") ?? target;
        const characterId = button.dataset.characterId;
        const eventIndex = Number.parseInt(button.dataset.eventIndex, 10);
        if (!Number.isFinite(eventIndex)) {
            ui.notifications.warn(game.i18n.localize("ionrift-respite.eventsPhase.warnCouldNotResolveCheck"));
            return;
        }
        const pendingKey = `${eventIndex}:${characterId}`;
        if (!app._eventGmRollPending) app._eventGmRollPending = new Set();
        if (app._eventGmRollPending.has(pendingKey)) return;

        const triggeredEvent = app._triggeredEvents?.[eventIndex];
        if (!triggeredEvent?.awaitingRolls || !characterId) {
            ui.notifications.warn(game.i18n.localize("ionrift-respite.eventsPhase.warnNotWaitingForRoll"));
            return;
        }
        if (triggeredEvent.resolvedRolls?.some(r => r.characterId === characterId)) {
            const rolledCharName = triggeredEvent.resolvedRolls.find(r => r.characterId === characterId)?.name ?? game.i18n.localize("ionrift-respite.eventsPhase.defaultThatCharacter");
            ui.notifications.info(game.i18n.format("ionrift-respite.eventsPhase.infoAlreadyRolled", { character: rolledCharName }));
            return;
        }

        const actor = game.actors.get(characterId);
        if (!actor) return;

        app._eventGmRollPending.add(pendingKey);
        disableRollButton(button);

        try {
            const skill = triggeredEvent.mechanical?.skill ?? "sur";
            const dc = triggeredEvent.mechanical?.dc ?? 10;
            const skillName = SKILL_DISPLAY_NAMES[skill] ?? skill;
            const context = `${triggeredEvent.name ?? "Event"} (${skillName})`;
            const rollMode = triggeredEvent.rollModes?.[characterId] ?? "normal";

            const result = await rollForPlayer(actor, [skill], dc, context, rollMode);

            await app.receiveRollResult({
                eventIndex,
                characterId,
                characterName: actor.name,
                total: result.total
            });
        } catch (err) {

            console.error("[Respite] GM event roll for player failed:", err);
            ui.notifications.error(game.i18n.format("ionrift-respite.eventsPhase.errorFailedToRoll", { name: actor.name }));
            app.render();
        } finally {
            app._eventGmRollPending.delete(pendingKey);
        }
    
    },

    async onApplyStallPenalty(event, target) {
        const app = this._app;

        if (!app._activeTreeState?.stallPenalty) return;

        const penalty = app._activeTreeState.stallPenalty;
        const bump = penalty.dcBump ?? 2;
        const stallCount = (app._activeTreeState.stallCount ?? 0) + 1;

        // Bump DC on all current options
        for (const opt of app._activeTreeState.options) {
            if (opt.check) opt.check.dc += bump;
        }

        app._activeTreeState.stalled = true;
        app._activeTreeState.stallCount = stallCount;
        app._activeTreeState.totalStallBump = (app._activeTreeState.totalStallBump ?? 0) + bump;

        // If rolls are in progress, bump the pending DC for remaining rolls
        if (app._activeTreeState.awaitingRolls && app._activeTreeState.pendingDC) {
            app._activeTreeState.pendingDC += bump;
        }

        // Post stall narrative to chat
        const suffix = stallCount > 1 ? ` (x${stallCount})` : "";
        ChatMessage.create({
            content: `<div class="respite-stall-message"><strong>The party stalled${suffix}.</strong><br>${penalty.narrative}</div>`,
            speaker: { alias: "Respite" }
        });

        // Track upfront loss as an effect to apply at resolution
        if (penalty.upfrontLoss) {
            if (!app._activeTreeState.stallEffects) app._activeTreeState.stallEffects = [];
            app._activeTreeState.stallEffects.push(penalty.upfrontLoss);
        }

        const stallConsequence = (penalty.consequence ?? penalty.upfrontLoss?.description ?? penalty.narrative ?? "Supplies lost to the delay.").trim();
        const stallTags = Array.isArray(penalty.consequenceTags) && penalty.consequenceTags.length
            ? [...penalty.consequenceTags]
            : ["Supplies Lost", `DC +${bump}`];
        app._activeTreeState.stallConsequence = stallConsequence;
        app._activeTreeState.stallConsequenceTags = stallTags;
        app._activeTreeState.lastStepOutcome = {
            type: "stall",
            choiceLabel: stallCount > 1 ? `Party Stalled (x${stallCount})` : "Party Stalled",
            success: false,
            narrative: penalty.narrative ?? "",
            consequence: stallConsequence,
            consequenceTags: stallTags
        };

        this._broadcastEventsState();
        await app._saveRestState();
        app.render();
    
    },

    onTreeDcAdjUp(event, target) {
        const app = this._app;

        if (!app._activeTreeState?.options) return;
        for (const opt of app._activeTreeState.options) {
            if (opt.check) opt.check.dc += 1;
        }
        app._activeTreeState.treeDcAdj = (app._activeTreeState.treeDcAdj ?? 0) + 1;
        app._saveRestState();
        app.render();
    
    },

    onTreeDcAdjDown(event, target) {
        const app = this._app;

        if (!app._activeTreeState?.options) return;
        for (const opt of app._activeTreeState.options) {
            if (opt.check) opt.check.dc = Math.max(1, opt.check.dc - 1);
        }
        app._activeTreeState.treeDcAdj = (app._activeTreeState.treeDcAdj ?? 0) - 1;
        app._saveRestState();
        app.render();
    
    }

};
