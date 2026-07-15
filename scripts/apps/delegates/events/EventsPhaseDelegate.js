import { DecisionTreeResolver } from "../../../services/events/resolve/DecisionTreeResolver.js";
import {
    emitPhaseChanged,
    emitTreeRollRequest
} from "../../../services/socket/SocketController.js";
import {
    executePlayerRoll,
    rollForPlayer,
    pickBestSkill,
    SKILL_DISPLAY_NAMES,
    waitForDiceSoNice
} from "../../../services/ui/rollRequest/RollRequestManager.js";
import { GrantLedger } from "../../../services/crafting/outcomes/GrantLedger.js";
import { MODULE_ID } from "../../../data/moduleId.js";

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

            // Compute group result and resolve the tree
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

    /**
     * @param {string} pick - "tree", "encounter", "normals", or "dismiss"
     */
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
            // Fallback: use whatever is available (tree > encounter > normals)
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

    /** @returns {boolean} true if a nat-1 disaster choice was set */

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
}
