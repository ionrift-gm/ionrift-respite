/**
 * EventsPhaseDelegate.js
 * Handles event rolling, decision tree state management, encounter handling,
 * GM guidance, roll collection, and disaster choice resolution during the
 * Events phase of the rest flow.
 *
 * Extracted from RestSetupApp to reduce God Class complexity (Milestone 1.6).
 * Follows the established delegate pattern (see CampCeremonyDelegate.js).
 */

import { DecisionTreeResolver } from "../../services/DecisionTreeResolver.js";
import {
    emitPhaseChanged,
    emitEventRollRequest,
    emitEventRollResult,
    emitTreeRollRequest,
    emitTreeRollResult
} from "../../services/SocketController.js";
import {
    executePlayerRoll,
    rollForPlayer,
    pickBestSkill,
    SKILL_DISPLAY_NAMES,
    waitForDiceSoNice
} from "../../services/RollRequestManager.js";

const MODULE_ID = "ionrift-respite";

export class EventsPhaseDelegate {

    /** @param {RestSetupApp} app */
    constructor(app) {
        this._app = app;
    }

    // ── State Accessors ─────────────────────────────────────────────────

    /** @returns {Array} Triggered events for this rest. */
    get triggeredEvents() { return this._app._triggeredEvents ?? []; }
    set triggeredEvents(v) { this._app._triggeredEvents = v; }

    /** @returns {boolean} Whether events have been rolled this phase. */
    get eventsRolled() { return !!this._app._eventsRolled; }
    set eventsRolled(v) { this._app._eventsRolled = v; }

    /** @returns {object|null} Active decision tree state. */
    get activeTreeState() { return this._app._activeTreeState ?? null; }
    set activeTreeState(v) { this._app._activeTreeState = v; }

    /** @returns {object|null} Disaster choice pending GM decision. */
    get disasterChoice() { return this._app._disasterChoice ?? null; }
    set disasterChoice(v) { this._app._disasterChoice = v; }

    /** @returns {object|null} Combat buff summary for encounter display. */
    get combatBuffs() { return this._app._combatBuffs ?? null; }
    set combatBuffs(v) { this._app._combatBuffs = v; }

    /** @returns {boolean} Encounter is active — GM is running combat. */
    get awaitingCombat() { return !!this._app._awaitingCombat; }
    set awaitingCombat(v) { this._app._awaitingCombat = v; }

    /** @returns {boolean} Encounter combat is complete. */
    get combatAcknowledged() { return !!this._app._combatAcknowledged; }
    set combatAcknowledged(v) { this._app._combatAcknowledged = v; }

    /** @returns {object|null} Player-side pending event roll request. */
    get pendingEventRoll() { return this._app._pendingEventRoll ?? null; }
    set pendingEventRoll(v) { this._app._pendingEventRoll = v; }

    /** @returns {object|null} Player-side pending tree roll request. */
    get pendingTreeRoll() { return this._app._pendingTreeRoll ?? null; }
    set pendingTreeRoll(v) { this._app._pendingTreeRoll = v; }

    /** @returns {Map} Granted discovery items. */
    get grantedDiscoveries() { return this._app._grantedDiscoveries; }

    // ── Roll Collection (GM-side) ───────────────────────────────────────

    /**
     * GM receives a skill check roll result from a player.
     * Collects results and auto-resolves when all expected rolls are in.
     * @param {object} data - { eventIndex, characterId, characterName, total }
     */
    async receiveRollResult(data) {
        if (!game.user.isGM) return;
        const { eventIndex, characterId, characterName, total } = data;
        const triggeredEvent = this.triggeredEvents?.[eventIndex];
        if (!triggeredEvent || !triggeredEvent.awaitingRolls) return;

        const dc = triggeredEvent.mechanical?.dc ?? 10;
        const passed = total >= dc;

        // Add to resolved rolls (avoid duplicates)
        if (!triggeredEvent.resolvedRolls) triggeredEvent.resolvedRolls = [];
        if (triggeredEvent.resolvedRolls.some(r => r.characterId === characterId)) return;
        triggeredEvent.resolvedRolls.push({ characterId, name: characterName, total, passed });

        // Remove from pending
        if (triggeredEvent.pendingRolls) {
            triggeredEvent.pendingRolls = triggeredEvent.pendingRolls.filter(id => id !== characterId);
        }

        // Check if all rolls are in
        if (!triggeredEvent.pendingRolls?.length) {
            // All rolls received -- auto-resolve
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

        // Broadcast updated state to all players (partial or complete)
        this._broadcastEventsState();

        this._app._saveRestState();
        this._app.render();
    }

    /**
     * Compute the outcome of a resolved event from its rolls.
     * Supports individual and group check policies with 4-tier outcomes.
     * @param {object} triggeredEvent
     * @param {Array} rolls
     * @param {number} dc
     * @returns {object} Properties to assign back to the triggeredEvent.
     */
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

    /**
     * GM receives a decision tree roll result from a player.
     * Collects results and auto-resolves when all expected rolls are in.
     * @param {object} data - { characterId, characterName, total }
     */
    async receiveTreeRollResult(data) {
        if (!game.user.isGM) return;
        const { characterId, characterName, total } = data;

        if (!this.activeTreeState?.awaitingRolls) return;

        const dc = this.activeTreeState.pendingDC ?? 12;
        const passed = total >= dc;

        // Add to resolved rolls (avoid duplicates)
        if (!this.activeTreeState.resolvedRolls) this.activeTreeState.resolvedRolls = [];
        if (this.activeTreeState.resolvedRolls.some(r => r.characterId === characterId)) return;
        this.activeTreeState.resolvedRolls.push({
            characterId, name: characterName, total, passed,
            actorName: characterName, actorId: characterId, dc
        });

        // Remove from pending
        if (this.activeTreeState.pendingRolls) {
            this.activeTreeState.pendingRolls = this.activeTreeState.pendingRolls.filter(id => id !== characterId);
        }

        // Check if all rolls are in
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
                    this.triggeredEvents[idx] = {
                        ...this.triggeredEvents[idx],
                        narrative: this.activeTreeState.finalNarrative,
                        effects: this.activeTreeState.finalEffects,
                        isDecisionTree: false,
                        resolved: true,
                        treeHistory: this.activeTreeState.history
                    };
                }
            }
        }

        // Broadcast updated state to all players
        this._broadcastEventsState();

        await this._app._saveRestState();
        this._app.render();
    }

    // ── Player-side Roll Request Receivers ───────────────────────────────

    /**
     * Player receives an event roll request from the GM.
     * Stores the request so the template can show Roll buttons for owned characters.
     * @param {object} data
     */
    receiveRollRequest(data) {
        this.pendingEventRoll = {
            eventIndex: data.eventIndex,
            skill: data.skill,
            skillName: data.skillName,
            dc: data.dc,
            targets: data.targets ?? [],
            eventTitle: data.eventTitle,
            rolledCharacters: new Set()
        };
        this._app.render();
    }

    /**
     * Player receives a tree roll request from the GM.
     * Stores the request so the template can show Roll buttons for owned characters.
     * @param {object} data
     */
    receiveTreeRollRequest(data) {
        this.pendingTreeRoll = {
            choiceId: data.choiceId,
            skills: data.skills ?? [],
            skillName: data.skillName,
            dc: data.dc,
            targets: data.targets ?? [],
            eventName: data.eventName,
            rollModes: data.rollModes ?? {},
            rolledCharacters: new Set()
        };
        this._app.render();
    }

    // ── Decision Tree Logic ─────────────────────────────────────────────

    /**
     * GM selects a decision tree choice.
     * Enters configure-modifiers phase (roll not sent to players yet).
     * @param {string} choiceId
     */
    async prepareTreeChoice(choiceId) {
        if (!choiceId || !this.activeTreeState) return;

        const prepared = DecisionTreeResolver.prepareChoice(this.activeTreeState, choiceId);
        if (!prepared) return;

        // Enter pending-roll state — but do NOT dispatch to players yet
        this.activeTreeState.awaitingRolls = true;
        this.activeTreeState.rollRequestSent = false;
        this.activeTreeState.pendingChoice = choiceId;
        this.activeTreeState.pendingRolls = [...prepared.targetIds];
        this.activeTreeState.resolvedRolls = [];
        this.activeTreeState.pendingCheck = prepared.check;
        this.activeTreeState.pendingRollModes = {};
        this.activeTreeState.pendingChoiceSpellRulings = prepared.option.spellRulings ?? null;

        // Determine skill name for display
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

    /**
     * GM dispatches the tree roll request to players.
     * Called after the GM has finished configuring per-character modifiers.
     */
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

    /**
     * GM re-broadcasts the tree roll request for crash recovery.
     */
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

    // ── Disaster Choice ─────────────────────────────────────────────────

    /**
     * GM chooses between disaster tree, combat encounter, or normals after a nat 1.
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

        // Check for decision tree events
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

    // ── Stall Penalty ───────────────────────────────────────────────────

    /**
     * GM applies the stall penalty to the decision tree.
     * Bumps all option DCs, posts the stall narrative, and marks as stalled.
     */
    async applyStallPenalty() {
        if (!this.activeTreeState?.stallPenalty) return;

        const penalty = this.activeTreeState.stallPenalty;
        const bump = penalty.dcBump ?? 2;
        const stallCount = (this.activeTreeState.stallCount ?? 0) + 1;

        // Bump DC on all current options
        for (const opt of this.activeTreeState.options) {
            if (opt.check) opt.check.dc += bump;
        }

        this.activeTreeState.stalled = true;
        this.activeTreeState.stallCount = stallCount;
        this.activeTreeState.totalStallBump = (this.activeTreeState.totalStallBump ?? 0) + bump;

        // If rolls are in progress, bump the pending DC for remaining rolls
        if (this.activeTreeState.awaitingRolls && this.activeTreeState.pendingDC) {
            this.activeTreeState.pendingDC += bump;
        }

        // Post stall narrative to chat
        const suffix = stallCount > 1 ? ` (x${stallCount})` : "";
        ChatMessage.create({
            content: `<div class="respite-stall-message"><strong>The party stalled${suffix}.</strong><br>${penalty.narrative}</div>`,
            speaker: { alias: "Respite" }
        });

        // Track upfront loss as an effect to apply at resolution
        if (penalty.upfrontLoss) {
            if (!this.activeTreeState.stallEffects) this.activeTreeState.stallEffects = [];
            this.activeTreeState.stallEffects.push(penalty.upfrontLoss);
        }

        await this._app._saveRestState();
        this._app.render();
    }

    // ── Tree DC Adjustment ──────────────────────────────────────────────

    /**
     * GM adjusts the DC on all decision tree options up by 1.
     */
    adjustTreeDcUp() {
        if (!this.activeTreeState?.options) return;
        for (const opt of this.activeTreeState.options) {
            if (opt.check) opt.check.dc += 1;
        }
        this.activeTreeState.treeDcAdj = (this.activeTreeState.treeDcAdj ?? 0) + 1;
        this._app._saveRestState();
        this._app.render();
    }

    /**
     * GM adjusts the DC on all decision tree options down by 1.
     */
    adjustTreeDcDown() {
        if (!this.activeTreeState?.options) return;
        for (const opt of this.activeTreeState.options) {
            if (opt.check) opt.check.dc = Math.max(1, opt.check.dc - 1);
        }
        this.activeTreeState.treeDcAdj = (this.activeTreeState.treeDcAdj ?? 0) - 1;
        this._app._saveRestState();
        this._app.render();
    }

    // ── Encounter Handling ──────────────────────────────────────────────

    /**
     * GM acknowledges an encounter event and begins combat.
     * Sets awaitingCombat flag, saves state, and broadcasts to players.
     */
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

    /**
     * GM marks the encounter combat as complete.
     * Clears the awaiting flag so the GM can proceed to resolution.
     */
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

    // ── Event Rolling (GM-side) ─────────────────────────────────────────

    /**
     * Initialise a decision tree state from a triggered event.
     * Used after rolling events when a tree event is found, or after disaster choice.
     * @param {object} treeEvent - The triggered event with isDecisionTree set.
     */
    initTreeState(treeEvent) {
        this.activeTreeState = DecisionTreeResolver.createTreeState(
            { id: treeEvent.id, name: treeEvent.name, description: treeEvent.description, mechanical: treeEvent.mechanical },
            treeEvent.targets
        );
        // Ensure stallPenalty is present
        if (treeEvent.mechanical?.stallPenalty) {
            this.activeTreeState.stallPenalty = treeEvent.mechanical.stallPenalty;
            this.activeTreeState.hasStallPenalty = true;
            this.activeTreeState.stalled = false;
        }
    }

    /**
     * After rolling events, check if the result is a disaster choice (nat 1).
     * @returns {boolean} True if disaster choice was detected and set.
     */
    checkDisasterChoice() {
        if (this.triggeredEvents.disasterChoice) {
            this.disasterChoice = this.triggeredEvents.disasterChoice;
            this.triggeredEvents = [];
            this.eventsRolled = true;
            return true;
        }
        return false;
    }

    /**
     * After rolling events, detect encounter events and compute combat buffs.
     * Posts combat readiness to chat if encounter found.
     * @returns {boolean} True if an encounter was detected.
     */
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

    /**
     * After rolling events, detect and init decision tree events.
     */
    detectAndInitTree() {
        const treeEvent = this.triggeredEvents.find(e => e.isDecisionTree);
        if (treeEvent) {
            this.initTreeState(treeEvent);
        }
    }

    // ── Encounter Adjustment ────────────────────────────────────────────

    /**
     * GM adjusts encounter probability up.
     */
    encounterAdjUp() {
        if (!this._app._engine) return;
        this._app._engine.gmEncounterAdj = (this._app._engine.gmEncounterAdj ?? 0) + 1;
    }

    /**
     * GM adjusts encounter probability down.
     */
    encounterAdjDown() {
        if (!this._app._engine) return;
        this._app._engine.gmEncounterAdj = (this._app._engine.gmEncounterAdj ?? 0) - 1;
    }

    // ── Broadcast Helper ────────────────────────────────────────────────

    /**
     * Broadcasts the current events phase state to all players.
     */
    _broadcastEventsState() {
        emitPhaseChanged("events", {
            triggeredEvents: this.triggeredEvents,
            activeTreeState: this.activeTreeState,
            eventsRolled: true,
            campStatus: this._app._campStatus
        });
    }

    // ── Serialization ───────────────────────────────────────────────────

    /**
     * Returns events phase state for snapshot/save.
     * @returns {object}
     */
    serialize() {
        return {
            triggeredEvents: this.triggeredEvents,
            eventsRolled: this.eventsRolled,
            activeTreeState: this.activeTreeState,
            disasterChoice: this.disasterChoice,
            combatBuffs: this.combatBuffs,
            awaitingCombat: this.awaitingCombat,
            combatAcknowledged: this.combatAcknowledged,
            grantedDiscoveries: Array.from(this.grantedDiscoveries?.entries?.() ?? [])
        };
    }

    /**
     * Restores events phase state from a snapshot/save.
     * @param {object} state
     */
    restore(state) {
        if (!state) return;
        this.triggeredEvents = state.triggeredEvents ?? [];
        this.eventsRolled = state.eventsRolled ?? false;
        this.activeTreeState = state.activeTreeState ?? null;
        this.disasterChoice = state.disasterChoice ?? null;
        this.combatBuffs = state.combatBuffs ?? null;
        this.awaitingCombat = state.awaitingCombat ?? false;
        this.combatAcknowledged = state.combatAcknowledged ?? false;
        if (state.grantedDiscoveries) {
            this._app._grantedDiscoveries = new Map(state.grantedDiscoveries);
        }
    }
}
