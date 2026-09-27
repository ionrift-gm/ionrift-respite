import { presentRoll } from "/modules/ionrift-library/scripts/services/rolls/DiceSettle.js";
import { getPartyActors } from "../../../../services/party/partyActors.js";
import { emitPhaseChanged } from "../../../../services/socket/SocketController.js";
import {
    conSaveBonus,
    createExhaustionEntry,
    exhaustionSummary
} from "../../../../services/rest/recovery/ExhaustionStage.js";

/**
 * Normal-rest close. After the night event, the party rolls Constitution
 * against exhaustion before recovery is applied. Matches the gritty dawn step.
 */
export class DawnExhaustionDelegate {
    constructor(app) {
        this._app = app;
    }

    serialize() {
        return [...(this._app._exhaustionDraft?.values() ?? [])];
    }

    restore(list) {
        if (!Array.isArray(list)) return;
        const draft = new Map();
        for (const entry of list) {
            if (entry?.actorId) draft.set(entry.actorId, entry);
        }
        this._app._exhaustionDraft = draft;
    }

    ensureDraft() {
        const app = this._app;
        if (!app._exhaustionDraft) app._exhaustionDraft = new Map();
        for (const actor of getPartyActors()) {
            if (!actor || app._exhaustionDraft.has(actor.id)) continue;
            const choice = app._engine?.characterChoices?.get(actor.id);
            const activityId = choice?.activityId
                ?? (typeof app._characterChoices?.get?.(actor.id) === "string"
                    ? app._characterChoices.get(actor.id)
                    : null);
            const activity = activityId
                ? app._activityResolver?.activities?.get(activityId)
                : null;
            const preview = app._engine?.previewExhaustion?.(actor, activity) ?? {
                exhaustionDC: null,
                exhaustionAdvantage: false,
                comfortLevel: "safe"
            };
            app._exhaustionDraft.set(actor.id, createExhaustionEntry(actor, preview));
        }
    }

    templateContext() {
        const app = this._app;
        if (app._isGM) this.ensureDraft();
        const partyActors = getPartyActors();
        const roster = partyActors.map(actor => this._row(actor)).filter(Boolean);
        const summary = exhaustionSummary(roster);

        const isGM = Boolean(app._isGM || game.user?.isGM);
        const isGmNeutralView = isGM;

        // Resolve hero character for player view
        const selectedId = !isGM ? (partyActors.find(a => a.isOwner)?.id ?? partyActors[0]?.id) : null;
        const heroCharacter = selectedId ? roster.find(r => r.actorId === selectedId) || null : null;
        const companionCharacters = heroCharacter ? roster.filter(r => r.actorId !== heroCharacter.actorId) : [];

        // Compute common DC and roll mode for GM batch controls
        const pendingEntries = roster.filter(r => r.mustRoll && !r.rolled);
        let commonDc = 10;
        let commonAdvMode = "norm";

        if (pendingEntries.length > 0) {
            const firstDc = pendingEntries[0].dc ?? 10;
            const allSameDc = pendingEntries.every(e => (e.dc ?? 10) === firstDc);
            commonDc = allSameDc ? firstDc : "—";
            const firstMode = pendingEntries[0].advMode ?? "norm";
            const allSameMode = pendingEntries.every(e => (e.advMode ?? "norm") === firstMode);
            commonAdvMode = allSameMode ? firstMode : "mixed";
        } else if (roster.length > 0) {
            commonDc = roster[0].dc ?? 10;
            commonAdvMode = roster[0].advMode ?? "norm";
        }

        return {
            isGM,
            isGmNeutralView,
            heroCharacter,
            companionCharacters,
            exhaustionRoster: roster,
            exhaustionSummary: summary,
            commonDc,
            commonAdvMode
        };
    }

    _row(actor) {
        const app = this._app;
        const entry = app._exhaustionDraft?.get(actor.id);
        if (!entry) return null;
        const conMod = conSaveBonus(actor);
        const isOwner = Boolean(app._isGM || actor.isOwner);
        const isSelf = Boolean(
            (game.user.character && game.user.character.id === actor.id)
            || actor.testUserPermission(game.user, "OWNER")
        );
        return {
            ...entry,
            actorId: actor.id,
            actorName: actor.name,
            actorImg: actor.img || "icons/svg/mystery-man.svg",
            currentExhaustion: actor.system?.attributes?.exhaustion ?? 0,
            conMod,
            conModString: conMod >= 0 ? `+${conMod}` : `${conMod}`,
            isOwner,
            isSelf,
            isOverrideOpen: Boolean(app._expandedExhaustionOverrides?.has(actor.id))
        };
    }

    _entry(actorId) {
        const actor = game.actors.get(actorId);
        if (!actor) return null;
        this.ensureDraft();
        return this._app._exhaustionDraft.get(actorId) ?? null;
    }

    async publish() {
        const app = this._app;
        await app._saveRestState();
        emitPhaseChanged(app._phase, {
            eventsRolled: !!app._eventsRolled,
            triggeredEvents: app._triggeredEvents,
            activeTreeState: app._activeTreeState,
            exhaustionDraft: this.serialize()
        });
        app.render();
    }

    canLeaveNight() {
        const app = this._app;
        if (!app._eventsRolled || app._awaitingCombat) return false;
        if (app._activeTreeState && !app._activeTreeState.resolved) return false;
        if (app._disasterChoice) return false;
        const events = app._triggeredEvents ?? [];
        if (events.some(event => event.mechanical?.type === "skill_check" && !event.resolvedOutcome)) return false;
        return !events.some(event => {
            const isTree = event.treeOutcome === true;
            if (!isTree && (!event.resolvedOutcome || ["success", "triumph"].includes(event.resolvedOutcome))) return false;
            const tierKey = { mixed: "onMixed", failure: "onFailure" }[event.resolvedOutcome] ?? "onFailure";
            const effects = event.mechanical?.[tierKey]?.effects ?? event.mechanical?.onFailure?.effects ?? [];
            return effects.some(effect =>
                ["damage", "consume_resource", "item_at_risk", "consume_gold", "supply_loss"].includes(effect.type)
                && !effect._locked
            );
        });
    }

    async enterDawn() {
        const app = this._app;
        if (!game.user.isGM) return;
        if (app._phase !== "events" || !this.canLeaveNight()) return;
        this.ensureDraft();
        app._phase = "dawn";
        if (app._engine) app._engine._phase = "dawn";
        await this.publish();
    }

    async returnToNight() {
        const app = this._app;
        if (!game.user.isGM) return;
        if (app._phase !== "dawn") return;
        app._phase = "events";
        if (app._engine) app._engine._phase = "events";
        await this.publish();
    }

    pendingSaves() {
        return exhaustionSummary([...(this._app._exhaustionDraft?.values() ?? [])]).pending;
    }

    async completeDawn(event, target) {
        const app = this._app;
        if (!game.user.isGM) return;
        if (app._phase !== "dawn") return;
        if (this.pendingSaves() > 0) {
            ui.notifications.warn("Roll or waive each exhaustion save before the rest ends.");
            return;
        }
        return app._resolve.onResolveEvents(event, target);
    }

    async rollActor(actorId) {
        const app = this._app;
        if (!actorId) return;
        const actor = game.actors.get(actorId);
        if (!actor) return;

        const isGM = Boolean(app._isGM || game.user?.isGM);
        if (!isGM && !actor.isOwner) return;

        const entry = this._entry(actorId) ?? app._exhaustionDraft?.get(actorId);
        if (!entry || !entry.mustRoll || entry.rolled) return;

        const conMod = conSaveBonus(actor);
        const formula = entry.advMode === "adv" ? "2d20kh" : (entry.advMode === "dis" ? "2d20kl" : "1d20");
        const rollString = conMod >= 0 ? `${formula} + ${conMod}` : `${formula} - ${Math.abs(conMod)}`;
        const roll = await new Roll(rollString).evaluate();
        await presentRoll(roll);

        const passed = roll.total >= entry.dc;
        entry.rolled = true;
        entry.rollTotal = roll.total;
        entry.passed = passed;

        const advText = entry.advMode === "adv" ? " (advantage)" : (entry.advMode === "dis" ? " (disadvantage)" : "");
        const resultText = passed
            ? "Passed. No exhaustion gained."
            : "Failed. +1 exhaustion.";
        await roll.toMessage({
            speaker: ChatMessage.getSpeaker({ actor }),
            flavor: `<strong>${actor.name}</strong>: Constitution save vs exhaustion DC ${entry.dc}${advText}<br>${resultText}`
        });

        if (isGM) {
            await this.publish();
        } else {
            const { emitDawnSaveResult } = await import("../../../../services/socket/SocketController.js");
            emitDawnSaveResult({
                actorId,
                rollTotal: roll.total,
                passed
            });
            app.render();
        }
    }

    async receivePlayerRoll(data) {
        if (!game.user.isGM) return;
        const { actorId, rollTotal, passed } = data;
        this.ensureDraft();
        const entry = this._app._exhaustionDraft?.get(actorId);
        if (!entry) return;
        entry.rolled = true;
        entry.rollTotal = rollTotal;
        entry.passed = passed;
        await this.publish();
    }

    async rollAll() {
        if (!game.user.isGM) return;
        this.ensureDraft();
        for (const actor of getPartyActors()) {
            const entry = this._app._exhaustionDraft.get(actor.id);
            if (entry?.mustRoll && !entry.rolled) {
                await this.rollActor(actor.id);
            }
        }
    }

    waiveAll() {
        if (!game.user.isGM) return;
        this.ensureDraft();
        for (const entry of this._app._exhaustionDraft.values()) {
            entry.mustRoll = false;
            entry.waived = true;
        }
        return this.publish();
    }

    toggleMustRoll(actorId, required) {
        const entry = this._entry(actorId);
        if (!entry || !game.user.isGM) return;
        entry.mustRoll = Boolean(required);
        entry.waived = !entry.mustRoll;
        if (!entry.mustRoll) {
            entry.rolled = false;
            entry.rollTotal = null;
            entry.passed = null;
        }
        return this.publish();
    }

    setAdvMode(actorId, mode) {
        const entry = this._entry(actorId);
        if (!entry || !["adv", "norm", "dis"].includes(mode)) return;
        entry.advMode = mode;
        return this.publish();
    }

    adjustDc(actorId, delta) {
        const entry = this._entry(actorId);
        if (!entry || Number.isNaN(delta)) return;
        entry.dc = Math.max(5, Math.min(30, (entry.dc ?? 10) + delta));
        return this.publish();
    }

    adjustAllDc(delta) {
        if (!game.user.isGM || Number.isNaN(delta)) return;
        this.ensureDraft();
        for (const entry of this._app._exhaustionDraft.values()) {
            if (entry.mustRoll && !entry.rolled) {
                entry.dc = Math.max(5, Math.min(30, (entry.dc ?? 10) + delta));
            }
        }
        return this.publish();
    }

    setAllAdvMode(mode) {
        if (!game.user.isGM || !["adv", "norm", "dis"].includes(mode)) return;
        this.ensureDraft();
        for (const entry of this._app._exhaustionDraft.values()) {
            if (entry.mustRoll && !entry.rolled) {
                entry.advMode = mode;
            }
        }
        return this.publish();
    }

    cycleAdvMode(actorId) {
        if (!game.user.isGM) return;
        const entry = this._entry(actorId);
        if (!entry || entry.rolled) return;
        const cycle = { norm: "adv", adv: "dis", dis: "norm" };
        entry.advMode = cycle[entry.advMode] ?? "adv";
        return this.publish();
    }

    toggleOverride(actorId) {
        const app = this._app;
        if (!game.user.isGM || !actorId) return;
        if (!app._expandedExhaustionOverrides) app._expandedExhaustionOverrides = new Set();
        if (app._expandedExhaustionOverrides.has(actorId)) {
            app._expandedExhaustionOverrides.delete(actorId);
        } else {
            app._expandedExhaustionOverrides.add(actorId);
        }
        app.render();
    }
}
