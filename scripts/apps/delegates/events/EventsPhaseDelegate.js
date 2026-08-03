import { DecisionTreeResolver } from "../../../services/events/resolve/DecisionTreeResolver.js";
import { TerrainRegistry } from "../../../services/events/resolve/TerrainRegistry.js";
import { listPoolEventsForTerrain } from "../../../services/events/catalog/EventCatalogLoader.js";
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
    refreshStationPortraitsFromChoices
} from "../../../services/camp/props/StationInteractionLayer.js";
import { getPartyActors } from "../../../services/party/partyActors.js";
import { MODULE_ID } from "../../../data/moduleId.js";
import { _refreshGmRestIndicator } from "../../../module.js";

export class EventsPhaseDelegate {

    constructor(app) {
        this._app = app;
    }

    get triggeredEvents() { return this._app._triggeredEvents ?? []; }
    set triggeredEvents(v) { this._app._triggeredEvents = v; }

    get eventsRolled() { return !!this._app._eventsRolled; }
    set eventsRolled(v) { this._app._eventsRolled = v; }

    get activeTreeState() { return this._app._activeTreeState ?? null; }
    set activeTreeState(v) { this._app._activeTreeState = v; }

    get disasterChoice() { return this._app._disasterChoice ?? null; }
    set disasterChoice(v) { this._app._disasterChoice = v; }

    get combatBuffs() { return this._app._combatBuffs ?? null; }
    set combatBuffs(v) { this._app._combatBuffs = v; }

    get awaitingCombat() { return !!this._app._awaitingCombat; }
    set awaitingCombat(v) { this._app._awaitingCombat = v; }

    get combatAcknowledged() { return !!this._app._combatAcknowledged; }
    set combatAcknowledged(v) { this._app._combatAcknowledged = v; }

    get pendingEventRoll() { return this._app._pendingEventRoll ?? null; }
    set pendingEventRoll(v) { this._app._pendingEventRoll = v; }

    get pendingTreeRoll() { return this._app._pendingTreeRoll ?? null; }
    set pendingTreeRoll(v) { this._app._pendingTreeRoll = v; }

    async receiveRollResult(data) {
        if (!game.user.isGM) return;
        const { eventIndex, characterId, characterName, total } = data;
        const triggeredEvent = this.triggeredEvents?.[eventIndex];
        if (!triggeredEvent || !triggeredEvent.awaitingRolls) return;

        const dc = triggeredEvent.mechanical?.dc ?? 10;
        const passed = total >= dc;

        if (!triggeredEvent.resolvedRolls) triggeredEvent.resolvedRolls = [];
        if (triggeredEvent.resolvedRolls.some(r => r.characterId === characterId)) return;
        triggeredEvent.resolvedRolls.push({ characterId, name: characterName, total, passed });

        if (triggeredEvent.pendingRolls) {
            triggeredEvent.pendingRolls = triggeredEvent.pendingRolls.filter(id => id !== characterId);
        }

        if (!triggeredEvent.pendingRolls?.length) {
            const rolls = triggeredEvent.resolvedRolls;
            const resolvedOutcome = this._computeEventOutcome(triggeredEvent, rolls, dc);
            Object.assign(triggeredEvent, resolvedOutcome);

            // Let the last dice animation settle before showing verdict
            if (game.modules.get("dice-so-nice")?.active) {
                await new Promise(resolve => {
                    const timeout = setTimeout(resolve, 4000);
                    Hooks.once("diceSoNiceRollComplete", () => { clearTimeout(timeout); resolve(); });
                });
            }
        }

        this._broadcastEventsState();

        this._app._saveRestState();
        this._app.render();
    }

        _computeEventOutcome(triggeredEvent, rolls, dc) {
        const checkPolicy = triggeredEvent.mechanical.checkPolicy ?? "group";
        const result = {};

        if (checkPolicy === "individual") {
            const passCount = rolls.filter(r => r.passed).length;
            result.resolvedOutcome = passCount > rolls.length / 2 ? "success" : "failure";
            result.checkPolicy = "individual";
        } else {
            const avg = rolls.reduce((sum, r) => sum + r.total, 0) / rolls.length;
            const roundedAvg = Math.round(avg);
            result.groupAverage = roundedAvg;

            const hasTriumph = !!triggeredEvent.mechanical?.onTriumph;
            const hasMixed = !!triggeredEvent.mechanical?.onMixed;

            if (roundedAvg >= dc + 5 && hasTriumph) {
                result.resolvedOutcome = "triumph";
            } else if (roundedAvg >= dc || rolls.every(r => r.passed)) {
                result.resolvedOutcome = "success";
            } else if (roundedAvg >= dc - 5 && hasMixed) {
                result.resolvedOutcome = "mixed";
            } else {
                result.resolvedOutcome = "failure";
            }
            result.checkPolicy = "group";
        }

        result.awaitingRolls = false;
        result.resolvedRoller = rolls.find(r => r.total === Math.max(...rolls.map(r2 => r2.total)))?.name ?? "Unknown";
        result.resolvedRollTotal = Math.max(...rolls.map(r => r.total));

        return result;
    }

    async receiveTreeRollResult(data) {
        if (!game.user.isGM) return;
        const { characterId, characterName, total } = data;

        if (!this.activeTreeState?.awaitingRolls) return;

        const dc = this.activeTreeState.pendingDC ?? 12;
        const passed = total >= dc;

        if (!this.activeTreeState.resolvedRolls) this.activeTreeState.resolvedRolls = [];
        if (this.activeTreeState.resolvedRolls.some(r => r.characterId === characterId)) return;
        this.activeTreeState.resolvedRolls.push({
            characterId, name: characterName, total, passed,
            actorName: characterName, actorId: characterId, dc
        });

        if (this.activeTreeState.pendingRolls) {
            this.activeTreeState.pendingRolls = this.activeTreeState.pendingRolls.filter(id => id !== characterId);
        }

        if (!this.activeTreeState.pendingRolls?.length) {
            // Wait for DSN
            await waitForDiceSoNice(4000);

            const choiceId = this.activeTreeState.pendingChoice;
            const checkResult = DecisionTreeResolver.computeGroupResult(
                this.activeTreeState.resolvedRolls, dc
            );

            this.activeTreeState = DecisionTreeResolver.resolveWithResults(
                this.activeTreeState, choiceId, checkResult
            );

            // If tree is resolved, merge effects into triggered events
            if (this.activeTreeState.resolved) {
                const idx = this.triggeredEvents.findIndex(e => e.id === this.activeTreeState.eventId);
                if (idx >= 0) {
                    const fx = this.activeTreeState.finalEffects ?? [];
                    const te = this.triggeredEvents[idx];
                    this.triggeredEvents[idx] = {
                        ...te,
                        narrative: this.activeTreeState.finalNarrative,
                        effects: fx,
                        isDecisionTree: false,
                        resolved: true,
                        // Mark the resolved disaster so the consequence pipeline
                        // (lock gate, resolution) treats its effects like a failed
                        // event tier. The synthetic onFailure tier lets the existing
                        // lock handler find each effect by index. Both references
                        // point at the same array so a lock lands everywhere.
                        treeOutcome: true,
                        treeOutcomeSuccess: !!checkResult.success,
                        mechanical: {
                            ...(te.mechanical ?? {}),
                            onFailure: { effects: fx, narrative: this.activeTreeState.finalNarrative }
                        },
                        treeHistory: this.activeTreeState.history
                    };
                }
            }
        }

        this._broadcastEventsState();

        await this._app._saveRestState();
        this._app.render();
    }

        receiveRollRequest(data) {
        this.pendingEventRoll = {
            eventIndex: data.eventIndex,
            skill: data.skill,
            skillName: data.skillName,
            dc: data.dc,
            targets: data.targets ?? [],
            rollModes: data.rollModes ?? {},
            eventTitle: data.eventTitle,
            targetLabel: data.targetLabel ?? "",
            rolledCharacters: new Set()
        };
        this._app.render();
    }

        receiveTreeRollRequest(data) {
        const rolledCharacters = new Set();
        for (const r of data.resolvedRolls ?? []) {
            rolledCharacters.add(r.characterId ?? r.actorId);
        }
        const rolledResults = new Map(
            (data.resolvedRolls ?? []).map(r => [
                r.characterId ?? r.actorId,
                { total: r.total, passed: r.passed }
            ])
        );
        this.pendingTreeRoll = {
            choiceId: data.choiceId,
            skills: data.skills ?? [],
            skillName: data.skillName,
            dc: data.dc,
            targets: data.targets ?? [],
            eventName: data.eventName,
            rollModes: data.rollModes ?? {},
            rolledCharacters,
            rolledResults
        };
        this._app.render();
    }

    async prepareTreeChoice(choiceId) {
        if (!choiceId || !this.activeTreeState) return;

        const prepared = DecisionTreeResolver.prepareChoice(this.activeTreeState, choiceId);
        if (!prepared) return;

    // Enter pending-roll state, but do NOT dispatch to players yet
        this.activeTreeState.awaitingRolls = true;
        this.activeTreeState.rollRequestSent = false;
        this.activeTreeState.pendingChoice = choiceId;
        this.activeTreeState.pendingRolls = [...prepared.targetIds];
        this.activeTreeState.resolvedRolls = [];
        this.activeTreeState.pendingCheck = prepared.check;
        this.activeTreeState.pendingRollModes = {};
        this.activeTreeState.pendingChoiceSpellRulings = prepared.option.spellRulings ?? null;
        this.activeTreeState.pendingCheckContext = prepared.check?.checkContext ?? null;

        const skillKey = pickBestSkill(
            game.actors.get(prepared.targetIds[0]),
            prepared.skills
        );
        const skillName = SKILL_DISPLAY_NAMES[skillKey] ?? skillKey;
        this.activeTreeState.pendingSkillName = skillName;
        this.activeTreeState.pendingSkillKey = skillKey;
        this.activeTreeState.pendingDC = prepared.dc;

        await this._app._saveRestState();
        this._app.render();
    }

    async sendTreeRollRequest() {
        if (!game.user.isGM) return;
        if (!this.activeTreeState?.awaitingRolls) return;

        this.activeTreeState.rollRequestSent = true;

    emitTreeRollRequest({
            choiceId: this.activeTreeState.pendingChoice,
            skills: this.activeTreeState.pendingCheck?.skills ?? [],
            skillName: this.activeTreeState.pendingSkillName ?? "Skill",
            dc: this.activeTreeState.pendingDC ?? 12,
            targets: this.activeTreeState.pendingRolls ?? [],
            eventName: this.activeTreeState.eventName,
            rollModes: this.activeTreeState.pendingRollModes ?? {}
        });

        this._broadcastEventsState();

        await this._app._saveRestState();
        this._app.render();
    }

        resendTreeRollRequest() {
        if (!game.user.isGM) return;
        if (!this.activeTreeState?.awaitingRolls) return;

    emitTreeRollRequest({
            choiceId: this.activeTreeState.pendingChoice,
            skills: this.activeTreeState.pendingCheck?.skills ?? [],
            skillName: this.activeTreeState.pendingSkillName ?? "Skill",
            dc: this.activeTreeState.pendingDC ?? 12,
            targets: this.activeTreeState.pendingRolls ?? [],
            eventName: this.activeTreeState.eventName,
            rollModes: this.activeTreeState.pendingRollModes ?? {}
        });

        ui.notifications.info("Tree roll request re-sent to players.");
    }

    
    async resolveDisasterChoice(pick) {
        if (!this.disasterChoice || !pick) return;

        if (pick === "dismiss") {
            this.disasterChoice = null;
        } else if (pick === "tree" && this.disasterChoice.tree) {
            this.triggeredEvents = [this.disasterChoice.tree];
        } else if (pick === "encounter" && this.disasterChoice.encounter) {
            this.triggeredEvents = [this.disasterChoice.encounter];
        } else if (pick === "normals" && this.disasterChoice.normals?.length) {
            this.triggeredEvents = [...this.disasterChoice.normals];
        } else {
            this.triggeredEvents = this.disasterChoice.tree
                ? [this.disasterChoice.tree]
                : this.disasterChoice.encounter
                    ? [this.disasterChoice.encounter]
                    : [...(this.disasterChoice.normals ?? [])];
        }

        this.disasterChoice = null;

        const treeEvent = this.triggeredEvents.find(e => e.isDecisionTree);
        if (treeEvent) {
            this.activeTreeState = DecisionTreeResolver.createTreeState(
                { id: treeEvent.id, name: treeEvent.name, description: treeEvent.description, mechanical: treeEvent.mechanical },
                treeEvent.targets
            );
        }

        this._broadcastEventsState();

        await this._app._saveRestState();
        this._app.render();
    }

    async applyStallPenalty() {
        if (!this.activeTreeState?.stallPenalty) return;

        const penalty = this.activeTreeState.stallPenalty;
        const bump = penalty.dcBump ?? 2;
        const stallCount = (this.activeTreeState.stallCount ?? 0) + 1;

        for (const opt of this.activeTreeState.options) {
            if (opt.check) opt.check.dc += bump;
        }

        this.activeTreeState.stalled = true;
        this.activeTreeState.stallCount = stallCount;
        this.activeTreeState.totalStallBump = (this.activeTreeState.totalStallBump ?? 0) + bump;

        if (this.activeTreeState.awaitingRolls && this.activeTreeState.pendingDC) {
            this.activeTreeState.pendingDC += bump;
        }

        const suffix = stallCount > 1 ? ` (x${stallCount})` : "";
        ChatMessage.create({
            content: `<div class="respite-stall-message"><strong>The party stalled${suffix}.</strong><br>${penalty.narrative}</div>`,
            speaker: { alias: "Respite" }
        });

        if (penalty.upfrontLoss) {
            if (!this.activeTreeState.stallEffects) this.activeTreeState.stallEffects = [];
            this.activeTreeState.stallEffects.push(penalty.upfrontLoss);
        }

        await this._app._saveRestState();
        this._app.render();
    }

    adjustTreeDcUp() {
        if (!this.activeTreeState?.options) return;
        for (const opt of this.activeTreeState.options) {
            if (opt.check) opt.check.dc += 1;
        }
        this.activeTreeState.treeDcAdj = (this.activeTreeState.treeDcAdj ?? 0) + 1;
        this._app._saveRestState();
        this._app.render();
    }

    adjustTreeDcDown() {
        if (!this.activeTreeState?.options) return;
        for (const opt of this.activeTreeState.options) {
            if (opt.check) opt.check.dc = Math.max(1, opt.check.dc - 1);
        }
        this.activeTreeState.treeDcAdj = (this.activeTreeState.treeDcAdj ?? 0) - 1;
        this._app._saveRestState();
        this._app.render();
    }

        async acknowledgeEncounter() {
        this.awaitingCombat = true;
        this.combatAcknowledged = false;
        this.combatBuffs = this.combatBuffs ?? null;
        await this._app._saveRestState();

    emitPhaseChanged("events", {
            triggeredEvents: this.triggeredEvents,
            activeTreeState: this.activeTreeState,
            eventsRolled: true,
            awaitingCombat: true
        });

        ui.notifications.info("Set up and run the encounter. Reopen Respite and click 'Combat Complete' when done.");
    }

        async completeEncounter() {
        this.awaitingCombat = false;
        this.combatAcknowledged = true;
        await this._app._saveRestState();

    emitPhaseChanged("events", {
            triggeredEvents: this.triggeredEvents,
            activeTreeState: this.activeTreeState,
            eventsRolled: true,
            awaitingCombat: false
        });

        this._app.render();
    }

        initTreeState(treeEvent) {
        this.activeTreeState = DecisionTreeResolver.createTreeState(
            { id: treeEvent.id, name: treeEvent.name, description: treeEvent.description, mechanical: treeEvent.mechanical },
            treeEvent.targets
        );
        if (treeEvent.mechanical?.stallPenalty) {
            this.activeTreeState.stallPenalty = treeEvent.mechanical.stallPenalty;
            this.activeTreeState.hasStallPenalty = true;
            this.activeTreeState.stalled = false;
        }
    }

    

    checkDisasterChoice() {
        if (this.triggeredEvents.disasterChoice) {
            this.disasterChoice = this.triggeredEvents.disasterChoice;
            this.triggeredEvents = [];
            this.eventsRolled = true;
            return true;
        }
        return false;
    }

        async detectAndReportEncounter() {
        const hasEncounter = this.triggeredEvents?.some(
            e => e.category === "encounter" || e.category === "combat"
        );
        if (!hasEncounter || !this._app._engine || !this._app._activityResolver) return false;

        const buffs = this._app._engine.aggregateCombatBuffs(this._app._activityResolver);
        this.combatBuffs = buffs;
        if (buffs.perCharacter.length > 0) {
            const lines = buffs.perCharacter.map(
                b => `<strong>${b.characterName}</strong> (${b.activityName}): ${b.summary}`
            );
            if (buffs.partyWide.summary) lines.push(`<em>${buffs.partyWide.summary}</em>`);
            await ChatMessage.create({
                content: `<div style="border-left:3px solid #7eb8da;padding-left:8px;"><strong>Combat Readiness</strong><br>${lines.join("<br>")}</div>`,
                speaker: { alias: "Respite" }
            });
        }
        return true;
    }

    detectAndInitTree() {
        const treeEvent = this.triggeredEvents.find(e => e.isDecisionTree);
        if (treeEvent) {
            this.initTreeState(treeEvent);
        }
    }

    encounterAdjUp() {
        if (!this._app._engine) return;
        this._app._engine.gmEncounterAdj = (this._app._engine.gmEncounterAdj ?? 0) + 1;
    }

    encounterAdjDown() {
        if (!this._app._engine) return;
        this._app._engine.gmEncounterAdj = (this._app._engine.gmEncounterAdj ?? 0) - 1;
    }

        _broadcastEventsState() {
    emitPhaseChanged("events", {
            triggeredEvents: this.triggeredEvents,
            activeTreeState: this.activeTreeState,
            eventsRolled: true,
            campStatus: this._app._campStatus
        });
    }

    serialize() {
        return {
            triggeredEvents: this.triggeredEvents,
            eventsRolled: this.eventsRolled,
            activeTreeState: this.activeTreeState,
            disasterChoice: this.disasterChoice,
            combatBuffs: this.combatBuffs,
            awaitingCombat: this.awaitingCombat,
            combatAcknowledged: this.combatAcknowledged,
        };
    }

    restore(state) {
        if (!state) return;
        this.triggeredEvents = state.triggeredEvents ?? [];
        this.eventsRolled = state.eventsRolled ?? false;
        this.activeTreeState = state.activeTreeState ?? null;
        this.disasterChoice = state.disasterChoice ?? null;
        this.combatBuffs = state.combatBuffs ?? null;
        this.awaitingCombat = state.awaitingCombat ?? false;
        this.combatAcknowledged = state.combatAcknowledged ?? false;

        if (state.grantedDiscoveries?.length && this._app._grantLedger) {
            for (const [grantKey, result] of state.grantedDiscoveries) {
                const colon = grantKey.indexOf(":");
                if (colon < 0) continue;
                const slotKey = GrantLedger.discoverySlotKey(
                    grantKey.slice(0, colon),
                    grantKey.slice(colon + 1)
                );
                if (!this._app._grantLedger.has(slotKey)) {
                    this._app._grantLedger.record(slotKey, result);
                }
            }
        }
    }
    async onRollEvents(event, target) {
        const app = this._app;

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
                    ui.notifications.info(`Forced encounter: ${ev.name}`);
                } else {
                    app._triggeredEvents = await app._engine.resolveEvents(app._eventResolver, app._engine._encounterBreakdown?.scoutingResult);
                }
            } else {
                app._triggeredEvents = await app._engine.resolveEvents(app._eventResolver, app._engine._encounterBreakdown?.scoutingResult);
            }
        } else {
            app._triggeredEvents = await app._engine.resolveEvents(app._eventResolver, app._engine._encounterBreakdown?.scoutingResult);
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
    
    }

    async onImproviseEvent(event, target) {
        const app = this._app;

        if (!game.user.isGM) return;
        if (!app._engine || app._phase !== "events" || app._eventsRolled) return;

        const effectiveDC = app._engine.getEffectiveEncounterDC();
        const roll = await new Roll("1d20").evaluate();
        const rawDie = roll.total;
        const triggered = rawDie === 1 || rawDie < effectiveDC;
        const terrainTag = app._engine.terrainTag ?? "forest";

        if (triggered) {
            await roll.toMessage({
                speaker: { alias: "Night Watch" },
                flavor: `<strong>Improvised night check</strong> (${terrainTag}) threshold ${effectiveDC}<br>${rawDie} below the threshold. Run your own scenario at the table.`,
                whisper: game.users.filter(u => u.isGM).map(u => u.id)
            });
            app._triggeredEvents = [{
                id: `adhoc_${Date.now()}`,
                name: "Improvised Encounter",
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
                flavor: `<strong>Improvised night check</strong> (${terrainTag}) threshold ${effectiveDC}<br>${rawDie} meets or beats the threshold. The night passes without incident.`,
                whisper: game.users.filter(u => u.isGM).map(u => u.id)
            });
            app._triggeredEvents = [];
        }

        app._eventsRolled = true;
        await this.finalizeEventsRoll();
    
    }

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

        ui.notifications.info("Set up and run the encounter. Reopen Respite and click 'Combat Complete' when done.");

        app.close();
    
    }

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
                    content: `<div style="border-left:3px solid #7eb8da;padding-left:8px;"><strong>Combat Readiness</strong><br>${lines.join("<br>")}</div>`,
                    speaker: { alias: "Respite" }
                });
            }
        }

        const treeEvent = app._triggeredEvents.find(e => e.isDecisionTree);
        if (treeEvent) {
            app._activeTreeState = DecisionTreeResolver.createTreeState(
                { id: treeEvent.id, name: treeEvent.name, description: treeEvent.description, mechanical: treeEvent.mechanical },
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
    
    }

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
    
    }

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

        ui.notifications.info("Tree roll request re-sent to players.");
    
    }

    beginEventsCommit() {
        const app = this._app;

        if (app._eventsCommitPending || app._eventsRolled) return false;
        if (!app._engine || app._phase !== "events") return false;
        app._eventsCommitPending = true;
        app.render();
        return true;
    
    }

    endEventsCommit() {
        const app = this._app;

        if (!app._eventsCommitPending) return;
        app._eventsCommitPending = false;
        if (!app._eventsRolled) app.render();
    
    }

    async onRollEvents(event, target) {
        const app = this._app;

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
                    ui.notifications.info(`Forced encounter: ${ev.name}`);
                } else {
                    app._triggeredEvents = await app._engine.resolveEvents(app._eventResolver, app._engine._encounterBreakdown?.scoutingResult);
                }
            } else {
                app._triggeredEvents = await app._engine.resolveEvents(app._eventResolver, app._engine._encounterBreakdown?.scoutingResult);
            }
        } else {
            app._triggeredEvents = await app._engine.resolveEvents(app._eventResolver, app._engine._encounterBreakdown?.scoutingResult);
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
    
    }

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
                    content: `<div style="border-left:3px solid #7eb8da;padding-left:8px;"><strong>Combat Readiness</strong><br>${lines.join("<br>")}</div>`,
                    speaker: { alias: "Respite" }
                });
            }
        }

        const treeEvent = app._triggeredEvents.find(e => e.isDecisionTree);
        if (treeEvent) {
            app._activeTreeState = DecisionTreeResolver.createTreeState(
                { id: treeEvent.id, name: treeEvent.name, description: treeEvent.description, mechanical: treeEvent.mechanical },
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
    
    }

    async onImproviseEvent(event, target) {
        const app = this._app;

        if (!game.user.isGM) return;
        if (!app._engine || app._phase !== "events" || app._eventsRolled) return;

        const effectiveDC = app._engine.getEffectiveEncounterDC();
        const roll = await new Roll("1d20").evaluate();
        const rawDie = roll.total;
        const triggered = rawDie === 1 || rawDie < effectiveDC;
        const terrainTag = app._engine.terrainTag ?? "forest";

        if (triggered) {
            await roll.toMessage({
                speaker: { alias: "Night Watch" },
                flavor: `<strong>Improvised night check</strong> (${terrainTag}) threshold ${effectiveDC}<br>${rawDie} below the threshold. Run your own scenario at the table.`,
                whisper: game.users.filter(u => u.isGM).map(u => u.id)
            });
            app._triggeredEvents = [{
                id: `adhoc_${Date.now()}`,
                name: "Improvised Encounter",
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
                flavor: `<strong>Improvised night check</strong> (${terrainTag}) threshold ${effectiveDC}<br>${rawDie} meets or beats the threshold. The night passes without incident.`,
                whisper: game.users.filter(u => u.isGM).map(u => u.id)
            });
            app._triggeredEvents = [];
        }

        app._eventsRolled = true;
        await this.finalizeEventsRoll();
    
    }

    async onNightPasses(event, target) {
        const app = this._app;

        if (!game.user.isGM) return;
        if (!this.beginEventsCommit()) return;
        try {
            await ChatMessage.create({
                speaker: { alias: "Night Watch" },
                content: `<div style="border-left:3px solid #7eb8da;padding-left:8px;"><strong>Night Watch</strong><br>The night passes without incident.</div>`,
                whisper: game.users.filter(u => u.isGM).map(u => u.id)
            });
            app._triggeredEvents = [];
            app._eventsRolled = true;
            await this.finalizeEventsRoll();
        } finally {
            this.endEventsCommit();
        }
    
    }

    async onImproviseNight(event, target) {
        const app = this._app;

        if (!game.user.isGM) return;
        if (!app._engine || app._phase !== "events" || app._eventsRolled) return;
        try {
            if (!game.settings.get(MODULE_ID, "enableEncounters")) return;
        } catch { /* settings not ready */ }
        app._triggeredEvents = [{
            id: `adhoc_${Date.now()}`,
            name: "Improvised Encounter",
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
    
    }

    async onPickPoolEvent(event, target) {
        const app = this._app;

        if (!game.user.isGM) return;
        if (!app._engine || app._phase !== "events" || app._eventsRolled) return;

        const terrainTag = app._engine.terrainTag ?? app._selectedTerrain ?? "forest";
        const poolEvents = listPoolEventsForTerrain(app._eventResolver, terrainTag);
        if (!poolEvents.length) {
            ui.notifications.warn("No events in the curated pool for app terrain. Curate the pool first.");
            return;
        }

        const terrain = TerrainRegistry.get(terrainTag);
        const terrainLabel = terrain?.label ?? terrainTag;
        const eventId = await pickPoolEvent(poolEvents, terrainLabel, terrainTag);
        if (!eventId) return;

        const catalogEvent = app._eventResolver.events.get(eventId);
        if (!catalogEvent) {
            ui.notifications.error("Selected event is no longer in the pool.");
            return;
        }

        const watchRoster = app._engine.watchRoster ?? [];
        app._triggeredEvents = [
            app._eventResolver.buildManualResult(catalogEvent, watchRoster, { result: "manual_pick" })
        ];
        app._eventsRolled = true;
        await this.finalizeEventsRoll();
    
    }

    async onSetEventsMode(event, target) {
        const app = this._app;

        if (!game.user.isGM) return;
        if (app._eventsCommitPending) return;
        if (app._phase !== "events" || app._eventsRolled) return;
        const mode = target?.dataset?.mode;
        if (!["random", "improvise", "pick"].includes(mode)) return;
        if (app._eventsMode === mode) return;
        app._eventsMode = mode;
        app.render();
    
    }

    async onCommitEventsMode(event, target) {
        const app = this._app;

        if (!game.user.isGM) return;
        // Pick-from-pool opens a dialog; do not lock the parent UI until an event is chosen.
        const lockParentUi = app._eventsMode !== "pick";
        if (lockParentUi && !this.beginEventsCommit()) return;
        try {
            switch (app._eventsMode) {
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
    
    }

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

        ui.notifications.info("Set up and run the encounter. Reopen Respite and click 'Combat Complete' when done.");

        app.close();
    
    }

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
    
    }

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
                    content: `<div style="border-left:3px solid #7eb8da;padding-left:8px;"><strong>Combat Readiness</strong><br>${lines.join("<br>")}</div>`,
                    speaker: { alias: "Respite" }
                });
            }
        }

        const treeEvent = app._triggeredEvents.find(e => e.isDecisionTree);
        if (treeEvent) {
            app._activeTreeState = DecisionTreeResolver.createTreeState(
                { id: treeEvent.id, name: treeEvent.name, description: treeEvent.description, mechanical: treeEvent.mechanical },
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
    
    }

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
    
    }

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
    
    }

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
    
    }

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

        ui.notifications.info("Tree roll request re-sent to players.");
    
    }

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
    
    }

    broadcastTreeRollModes() {
        const app = this._app;

        emitPhaseChanged("events", {
                triggeredEvents: app._triggeredEvents,
                activeTreeState: app._activeTreeState,
                eventsRolled: true,
                campStatus: app._campStatus
            });
    
    }

    async onRollEventForPlayer(event, target) {
        const app = this._app;

        if (!game.user.isGM) return;
        const button = target.closest(".btn-roll-for-player") ?? target;
        const characterId = button.dataset.characterId;
        const eventIndex = Number.parseInt(button.dataset.eventIndex, 10);
        if (!Number.isFinite(eventIndex)) {
            ui.notifications.warn("Could not resolve which event check to roll for.");
            return;
        }
        const pendingKey = `${eventIndex}:${characterId}`;
        if (!app._eventGmRollPending) app._eventGmRollPending = new Set();
        if (app._eventGmRollPending.has(pendingKey)) return;

        const triggeredEvent = app._triggeredEvents?.[eventIndex];
        if (!triggeredEvent?.awaitingRolls || !characterId) {
            ui.notifications.warn("This event is not waiting for that roll.");
            return;
        }
        if (triggeredEvent.resolvedRolls?.some(r => r.characterId === characterId)) {
            ui.notifications.info(`${triggeredEvent.resolvedRolls.find(r => r.characterId === characterId)?.name ?? "That character"} already rolled.`);
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
            ui.notifications.error(`Failed to roll for ${actor.name}.`);
            app.render();
        } finally {
            app._eventGmRollPending.delete(pendingKey);
        }
    
    }

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

        await app._saveRestState();
        app.render();
    
    }

    onTreeDcAdjUp(event, target) {
        const app = this._app;

        if (!app._activeTreeState?.options) return;
        for (const opt of app._activeTreeState.options) {
            if (opt.check) opt.check.dc += 1;
        }
        app._activeTreeState.treeDcAdj = (app._activeTreeState.treeDcAdj ?? 0) + 1;
        app._saveRestState();
        app.render();
    
    }

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

    receiveCampRollResult(data) {
        const app = this._app;

        if (!app._pendingCampRolls) return;

        const entry = app._pendingCampRolls.find(
            p => p.characterId === data.characterId && p.activityId === data.activityId
        );
        if (!entry) return;

        entry.total = data.total;
        entry.status = data.total >= entry.dc ? "pass" : "fail";

        // Look up the activity for narrative/effect data
        const activity = app._activities?.find(a => a.id === data.activityId);
        const outcomeKey = entry.status === "pass" ? "success" : "failure";
        const outcome = activity?.outcomes?.[outcomeKey];

        entry.narrative = outcome?.narrative ?? "";
        entry.effectDescriptions = (outcome?.effects ?? []).map(e => e.description).filter(Boolean);

        // Consume encounter_reduction effect for Set Up Defenses success
        if (entry.status === "pass" && entry.activityId === "act_defenses") {
            const defenseMod = 2; // encounter_reduction value from activity data
            if (app._engine?._encounterBreakdown) {
                app._engine._encounterBreakdown.defenses = (app._engine._encounterBreakdown.defenses ?? 0) + defenseMod;
            }
        }

        app._earlyResults.set(data.characterId, {
            source: "activity",
            activityId: data.activityId,
            result: entry.status === "pass" ? "success" : "failure",
            total: data.total,
            effects: outcome?.effects ?? [],
            narrative: entry.narrative
        });

        const allDone = app._pendingCampRolls.every(p => p.status !== "pending");

        emitPhaseChanged("events", {
                eventsRolled: app._eventsRolled ?? false,
                fireLevel: app._fireLevel,
                campStatus: app._campStatus,
                campRollsUpdate: app._pendingCampRolls.map(p => ({
                    characterId: p.characterId,
                    activityName: p.activityName,
                    status: p.status,
                    total: p.total,
                    narrative: p.narrative ?? "",
                    effectDescriptions: p.effectDescriptions ?? []
                }))
            });

        app.render();
    
    }

    formatGmGuidance(text) {
        return text.split(/\n\n+/).map((raw, i) => {
            const p = raw.trim();
            if (i > 0) {
                const labelMatch = p.match(/^([A-Z][^:]{2,30}):\s*/);
                if (labelMatch) {
                    const label = labelMatch[1];
                    const rest = p.slice(labelMatch[0].length);
                    return `<p><strong>${label}</strong>${rest}</p>`;
                }
            }
            return `<p>${p}</p>`;
        }).join("");
    }

    openGmGuidanceFlyout(triggerEl, guidanceHtml) {
        const app = this._app;

        const FLYOUT_ID = "ionrift-gm-guidance-flyout";
        let flyout = document.getElementById(FLYOUT_ID);

        if (!flyout) {
            flyout = document.createElement("div");
            flyout.id = FLYOUT_ID;
            flyout.className = "tree-gm-sidebar";
            flyout.innerHTML = `
                <div class="tree-gm-sidebar-header">
                    <span><i class="fas fa-book-reader"></i> GM Guidance</span>
                    <button type="button" class="tree-gm-sidebar-close"><i class="fas fa-times"></i></button>
                </div>
                <div class="tree-gm-sidebar-body"></div>
            `;
            document.body.appendChild(flyout);
            flyout.querySelector(".tree-gm-sidebar-close").addEventListener("click", () => {
                flyout.classList.remove("open");
                // Clear active state on whichever button opened it
                document.querySelectorAll(".tree-gm-notes-btn.active").forEach(b => b.classList.remove("active"));
            });
        }

        flyout.querySelector(".tree-gm-sidebar-body").innerHTML = guidanceHtml;

        // Anchor flyout: right of window (X), level with the button (Y)
        const windowEl = triggerEl.closest(".ionrift-window");
        const windowRect = windowEl?.getBoundingClientRect() ?? triggerEl.getBoundingClientRect();
        const btnRect = triggerEl.getBoundingClientRect();

        const applyPosition = (wRect, bTopOffset) => {
            flyout.style.left = `${wRect.right + 4}px`;
            flyout.style.top  = `${Math.max(8, Math.min(wRect.top + bTopOffset, window.innerHeight - 400))}px`;
        };

        const btnTopOffset = btnRect.top - windowRect.top;
        applyPosition(windowRect, btnTopOffset);

        // Track window drag ,  reposition flyout whenever the window moves
        if (flyout._dragObserver) flyout._dragObserver.disconnect();
        if (windowEl) {
            flyout._dragObserver = new MutationObserver(() => {
                if (!flyout.classList.contains("open")) return;
                applyPosition(windowEl.getBoundingClientRect(), btnTopOffset);
            });
            flyout._dragObserver.observe(windowEl, { attributes: true, attributeFilter: ["style"] });
        }

        // Disconnect observer when flyout is closed
        flyout.querySelector(".tree-gm-sidebar-close").addEventListener("click", () => {
            flyout._dragObserver?.disconnect();
        }, { once: true });

        flyout.classList.add("open");
    
    }

    async onRollEventCheck(event, target) {
        const app = this._app;

        event.preventDefault?.();
        const characterId = target.dataset.characterId;
        const pending = app._pendingEventRoll;
        if (!pending || !characterId) return;

        const actor = game.actors.get(characterId);
        if (!actor) return;

        // Verify this player owns this actor
        if (!actor.isOwner) {
            ui.notifications.warn("You do not own this character.");
            return;
        }

        // Already rolled?
        if (pending.rolledCharacters?.has(characterId)) return;

        const rollMode = pending.rollModes?.[characterId] ?? "normal";
        const modeLabel = rollMode === "advantage" ? " [Advantage]" : rollMode === "disadvantage" ? " [Disadvantage]" : "";
        const flavor = `<strong>${actor.name}</strong> attempts ${pending.skillName} check (DC ${pending.dc})${modeLabel}`;

        const { total } = await executePlayerRoll(
            actor,
            pending.skill,
            pending.dc,
            flavor,
            target,
            rollMode
        );

        // Mark as rolled locally and store the result so the player's own DC badge can
        // acknowledge pass/fail immediately, before the GM's resolved snapshot syncs back.
        if (!pending.rolledCharacters) pending.rolledCharacters = new Set();
        pending.rolledCharacters.add(characterId);
        if (!pending.rolledResults) pending.rolledResults = new Map();
        pending.rolledResults.set(characterId, { total, passed: total >= pending.dc });

        // Send result to GM
        emitEventRollResult({
                    eventIndex: pending.eventIndex,
                    characterId,
                    characterName: actor.name,
                    total
                });

        ui.notifications.info(`${actor.name} rolled ${total} for ${pending.skillName}.`);
        app.render();
    
    }

    onCycleEventRollMode(event, target) {
        const app = this._app;

        event.preventDefault?.();
        if (!game.user.isGM) return;

        const eventIndex = parseInt(target.dataset.eventIndex ?? target.closest("[data-event-index]")?.dataset.eventIndex);
        const characterId = target.dataset.characterId;
        const triggeredEvent = app._triggeredEvents?.[eventIndex];
        if (!triggeredEvent?.mechanical || !characterId || triggeredEvent.awaitingRolls || triggeredEvent.resolvedOutcome) return;

        if (!triggeredEvent.rollModes) triggeredEvent.rollModes = {};
        const CYCLE = { normal: "advantage", advantage: "disadvantage", disadvantage: "normal" };
        const current = triggeredEvent.rollModes[characterId] ?? "normal";
        const next = CYCLE[current] ?? "advantage";
        triggeredEvent.rollModes[characterId] = next;

        // Update the portrait in place. A full re-render would reset the scroll
        // position; this is a local toggle only consumed when rolls are requested.
        const button = target.closest(".check-avatar") ?? target;
        button.classList.toggle("adv", next === "advantage");
        button.classList.toggle("dis", next === "disadvantage");
        const name = button.getAttribute("data-tooltip")?.split(" \u00b7 ")[0] ?? "";
        const modeLabel = next === "advantage" ? "Advantage" : next === "disadvantage" ? "Disadvantage" : "Normal";
        button.setAttribute("data-tooltip", `${name} \u00b7 ${modeLabel} (click to change)`);
        button.querySelector(".check-avatar-mode")?.remove();
        if (next !== "normal") {
            const badge = document.createElement("span");
            badge.className = `check-avatar-mode ${next === "advantage" ? "adv" : "dis"}`;
            badge.innerHTML = `<i class="fas fa-angle-${next === "advantage" ? "up" : "down"}"></i>`;
            button.appendChild(badge);
        }
    
    }

    onRequestCampRoll(event, target) {
        const app = this._app;

        event.preventDefault?.();
        if (!game.user.isGM) return;

        const characterId = target.dataset.characterId;
        if (!characterId) return;

        const entry = app._pendingCampRolls?.find(p => p.characterId === characterId);
        if (!entry || entry.status !== "pending") return;

        entry.requested = true;

        emitPhaseChanged("events", {
                eventsRolled: app._eventsRolled ?? false,
                fireLevel: app._fireLevel,
                campStatus: app._campStatus,
                campRollRequest: {
                    activities: [{
                        characterId: entry.characterId,
                        activityId: entry.activityId,
                        activityName: entry.activityName,
                        skill: entry.skill,
                        skillName: entry.skillName,
                        dc: entry.dc,
                        status: entry.status,
                        total: entry.total
                    }]
                }
            });

        ui.notifications.info(`Roll request sent to ${entry.characterName} for ${entry.activityName}.`);
        app.render();
    
    }

    async onGrantDiscoveryItem(event, target) {
        const app = this._app;

        if (!game.user.isGM) return;

        const grantKey = target.dataset.grantKey;
        const itemRef = target.dataset.itemRef;
        const quantity = target.dataset.quantity;

        // Find the sibling select element for actor selection
        const row = target.closest(".party-discovery-item");
        const select = row?.querySelector(".discovery-actor-select");
        const actorId = select?.value;

        if (!actorId || !itemRef) {
            ui.notifications.warn("Select a character to receive the items.");
            return;
        }

        try {
            const colon = grantKey.indexOf(":");
            const eventId = colon >= 0 ? grantKey.slice(0, colon) : grantKey;
            const ref = colon >= 0 ? grantKey.slice(colon + 1) : itemRef;
            const result = await ItemOutcomeHandler.grantToActor(actorId, itemRef, quantity, {
                ledger: app._grantLedger,
                slotKey: GrantLedger.discoverySlotKey(eventId, ref)
            });
            ui.notifications.info(`Granted ${result.rolled}x ${result.itemName} to ${result.actorName}.`);
            app.render();
        } catch (e) {

            console.error(`[Respite] Failed to grant item:`, e);
            ui.notifications.error(`Failed to grant ${itemRef}: ${e.message}`);
        }
    
    }

    onGmOverride(event, target) {
        const app = this._app;

        const characterId = target.dataset.characterId;
        const activityId = target.value;

        if (activityId) {
            app._gmOverrides.set(characterId, activityId);
        } else {
            app._gmOverrides.delete(characterId);
        }

        app._rebuildCharacterChoices();
        app._saveRestState();
        if (app._phase === "activity" && isStationLayerActive()) {
            refreshStationEmptyNoticeFade(this);
            refreshStationPortraitsFromChoices(app._characterChoices, app._stationCanvasIdByCharacter);
            app._refreshStationOverlayMeals();
        }
        app.render();

        const submissions = {};
        for (const [charId, actId] of app._characterChoices) {
            const act = app._activities?.find(a => a.id === actId);
            submissions[charId] = { activityId: actId, activityName: act?.name ?? actId, source: app._gmOverrides.has(charId) ? "gm" : "player" };
        }
        emitSubmissionUpdate(submissions);
    
    }

    onToggleGmGuidance(event, target) {
        const app = this._app;

        event.preventDefault?.();
        const FLYOUT_ID = "ionrift-gm-guidance-flyout";
        const flyout = document.getElementById(FLYOUT_ID);

        // If already open, close it and clear button state
        if (flyout?.classList.contains("open")) {
            flyout.classList.remove("open");
            document.querySelectorAll(".tree-gm-notes-btn.active").forEach(b => b.classList.remove("active"));
            return;
        }

        // Get guidance text from the hidden data holder in the tree
        const tree = target.closest(".respite-decision-tree");
        if (!tree) return;
        const raw = tree.querySelector(".tree-gm-sidebar-body")?.textContent?.trim();
        if (!raw) return;

        target.classList.add("active");
        this.openGmGuidanceFlyout(target, this.formatGmGuidance(raw));
    
    }

    async onIonriftRoll(event, target) {
        const app = this._app;

        event.preventDefault?.();
        const flow = target.dataset.flow ?? "event";
        switch (flow) {
            case "event":
                return this.onRollEventCheck(event, target);
            case "tree":
                return this._app._flowActions.onRollTreeCheck(event, target);
            case "camp":
                return this.onRollCampCheck(event, target);
            case "travel":
                return this._app._travel.onRollTravelCheck(event, target);
            case "copySpell":
                return this._app._copySpell.onRollArcana(event, target);
            default:
                return undefined;
        }
    
    }

    rehydrateItemLossProposal(eff) {
        const app = this._app;

        const candidates = [];
        for (const li of (eff._lockedItems ?? [])) {
            const actor = game.actors.get(li.actorId);
            const item = actor?.items?.get(li.itemId);
            if (!actor || !item) continue;
            candidates.push({
                actor,
                item,
                currentQty: item.system?.quantity ?? li.currentQty ?? 1,
                lossQty: li.lossQty
            });
        }
        return {
            type: "item_at_risk",
            candidates,
            narrative: eff.narrative ?? "Some items were lost.",
            severity: eff.severity ?? 1
        };
    
    }

    async onFinalize(event, target) {
        const app = this._app;

        // Warn if there are ungranted party discoveries
        if (app._grantLedger && app._outcomes?.length) {
            const seenEvents = new Set();
            let ungrantedCount = 0;
            for (const o of app._outcomes) {
                for (const sub of (o.outcomes ?? [])) {
                    if (sub.source === "event" && sub.items?.length && !seenEvents.has(sub.eventId)) {
                        seenEvents.add(sub.eventId);
                        for (const item of sub.items) {
                            const key = `${sub.eventId}:${item.itemRef ?? item.name}`;
                            if (!app._hasDiscoveryGrant(key)) ungrantedCount++;
                        }
                    }
                }
            }
            if (ungrantedCount > 0) {
                const overlay = document.createElement("div");
                overlay.classList.add("ionrift-armor-modal-overlay");
                overlay.innerHTML = `
                    <div class="ionrift-armor-modal">
                        <h3><i class="fas fa-gem"></i> Ungranted Discoveries</h3>
                        <p>${ungrantedCount} discovered item${ungrantedCount > 1 ? "s have" : " has"} not been granted to anyone.</p>
                        <p>Close anyway and lose these items?</p>
                        <div class="ionrift-armor-modal-buttons">
                            <button class="btn-armor-confirm"><i class="fas fa-times"></i> Close Anyway</button>
                            <button class="btn-armor-cancel"><i class="fas fa-arrow-left"></i> Go Back</button>
                        </div>
                    </div>`;
                document.body.appendChild(overlay);
                overlay.querySelector(".btn-armor-confirm").addEventListener("click", () => {
                    overlay.remove();
                    app.close({ resolved: true });
                });
                overlay.querySelector(".btn-armor-cancel").addEventListener("click", () => {
                    overlay.remove();
                });
                return;
            }
        }
        app.close({ resolved: true });
    
    }

    async onRollCampForPlayer(event, target) {
        const app = this._app;

        if (!game.user.isGM) return;
        const characterId = target.dataset.characterId;
        if (!characterId) return;

        const entry = app._pendingCampRolls?.find(
            p => p.characterId === characterId && p.status === "pending" && p.requested
        );
        if (!entry) return;

        const actor = game.actors.get(characterId);
        if (!actor) return;

        const context = `${entry.activityName} (${entry.skillName})`;
        const result = await rollForPlayer(actor, [entry.skill], entry.dc, context);

        // Feed through the normal collection path
        this.receiveCampRollResult({
            characterId,
            characterName: actor.name,
            activityId: entry.activityId,
            total: result.total
        });
    
    }

    async onRollCampCheck(event, target) {
        const app = this._app;

        event.preventDefault?.();
        const characterId = target.dataset.characterId;
        const pending = app._pendingCampRoll;
        if (!pending || !characterId) return;

        const activityEntry = pending.activities?.find(a => a.characterId === characterId);
        if (!activityEntry) return;

        const actor = game.actors.get(characterId);
        if (!actor || !actor.isOwner) return;

        if (pending.rolledCharacters?.has(characterId)) return;

        const flavor = `<strong>${actor.name}</strong> - ${activityEntry.activityName} (${activityEntry.skillName}) DC ${activityEntry.dc}`;
        const { total } = await executePlayerRoll(
            actor,
            activityEntry.skill,
            activityEntry.dc,
            flavor,
            target
        );

        if (!pending.rolledCharacters) pending.rolledCharacters = new Set();
        pending.rolledCharacters.add(characterId);

        emitCampRollResult({
                    characterId,
                    characterName: actor.name,
                    activityId: activityEntry.activityId,
                    total
                });

        ui.notifications.info(`${actor.name} rolled ${total} for ${activityEntry.activityName}.`);
        app.render();
    
    }

    receivePlayerChoices(userId, choices, craftingResults = null, followUps = null, earlyResults = null) {
        const app = this._app;

        const user = game.users.get(userId);
        app._playerSubmissions.set(userId, {
            choices,
            followUps: followUps ?? {},
            userName: user?.name ?? "Unknown",
            timestamp: Date.now()
        });

        // Merge crafting results from the player
        if (craftingResults) {
            for (const [charId, result] of Object.entries(craftingResults)) {
                if (!result) continue;
                app._craftingResults.set(charId, result);
                app._lockedCharacters.add(charId);
            }
        }

        // Merge early results from the player (resolved camp rolls, crafting outcomes, etc.)
        // so the GM doesn't re-prompt rolls the player already completed.
        if (earlyResults) {
            if (!app._earlyResults) app._earlyResults = new Map();
            for (const [charId, result] of Object.entries(earlyResults)) {
                if (result && result.result !== "pending_approval") {
                    app._earlyResults.set(charId, result);
                }
            }
        }

        app._rebuildCharacterChoices();
        app._pruneEarlyResultsWithoutChoice();
        app._saveRestState();

        if (app._phase === "activity" && isStationLayerActive()) {
            refreshStationEmptyNoticeFade(app);
            refreshStationPortraitsFromChoices(app._characterChoices, app._stationCanvasIdByCharacter);
            app._refreshStationOverlayMeals();
        }
        app.render();
        // Refresh the GM footer bar in-place (it bakes the count at creation time).
        _refreshGmRestIndicator(app);

        const submissions = {};
        for (const [charId, actId] of app._characterChoices) {
            const act = app._activities?.find(a => a.id === actId);
            submissions[charId] = { activityId: actId, activityName: act?.name ?? actId, source: "player" };
        }
        for (const [charId, actId] of app._gmOverrides) {
            const act = app._activities?.find(a => a.id === actId);
            submissions[charId] = { activityId: actId, activityName: act?.name ?? actId, source: "gm" };
        }
        emitSubmissionUpdate(submissions);

        const snapshot = app.getRestSnapshot?.();
        if (snapshot) emitRestSnapshot(snapshot);
    
    }

    _revertStationActivityChoice(characterId) {
        const app = this._app;

        if (!characterId || app._isGM) return;

        app._characterChoices.delete(characterId);
        app._lockedCharacters.delete(characterId);
        app._earlyResults.delete(characterId);
        app._trainingStates?.delete(characterId);
        app._stationCanvasIdByCharacter?.delete(characterId);

        const mySub = app._playerSubmissions.get(game.user.id);
        if (mySub?.choices) {
            delete mySub.choices[characterId];
            app._playerSubmissions.set(game.user.id, mySub);
        }

        app._rebuildCharacterChoices();
        app._pruneEarlyResultsWithoutChoice();

        emitActivityChoice(
                    game.user.id,
                    Object.fromEntries(app._characterChoices),
                    null,
                    null,
                    app._earlyResults?.size ? Object.fromEntries(app._earlyResults) : null
                );

        resetStationOverlaysLocal();
        if (isStationLayerActive()) {
            if (!app._isGM) app._refreshStationOverlayForFocusChange();
            else {
                refreshStationEmptyNoticeFade(this);
                app._refreshStationOverlayMeals();
            }
        }
        app._updateRestBarProgress();
    
    }

}
