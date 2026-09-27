import { getPartyActors } from "../../../../services/party/partyActors.js";
import { emitPhaseChanged, emitRestSnapshot } from "../../../../services/socket/SocketController.js";
import { applyProvisionBuff } from "../../../../services/meal/buffs/WellFedService.js";
import { mergeBuffServings, pendingBuffCount } from "../../../../services/meal/buffs/MealBuffBeat.js";

/**
 * Pause before the night watch when someone ate or drank something
 * that carries a buff. Plain rations skip this and go straight on.
 */
export class MealBuffBeatDelegate {
    constructor(app) {
        this._app = app;
    }

    absorb(results) {
        const app = this._app;
        app._mealBuffQueue = mergeBuffServings(app._mealBuffQueue, results);
    }

    pending() {
        return pendingBuffCount(this._app._mealBuffQueue);
    }

    /**
     * Open the beat when a buff is waiting. Otherwise enter the night.
     */
    async continueAfterMeals() {
        const app = this._app;
        if (this.pending() > 0) {
            app._phase = "supper";
            if (app._engine) app._engine._phase = "supper";
            await this.publish();
            return;
        }
        await app._advanceToEvents();
    }

    async applyAll() {
        if (!game.user.isGM) return;
        const queue = this._app._mealBuffQueue ?? [];
        for (const row of queue) {
            if (!row.applied) await this._applyRow(row);
        }
        await this.publish();
    }

    async applyOne(rowId) {
        if (!game.user.isGM || !rowId) return;
        const row = (this._app._mealBuffQueue ?? []).find(entry => entry.id === rowId);
        if (!row || row.applied) return;
        await this._applyRow(row);
        await this.publish();
    }

    async continueToNight() {
        const app = this._app;
        if (!game.user.isGM) return;
        if (app._phase !== "supper") return;
        if (this.pending() > 0) {
            ui.notifications.warn("Apply each meal and drink before the watch.");
            return;
        }
        await app._advanceToEvents();
    }

    async _applyRow(row) {
        const actor = game.actors.get(row.actorId);
        if (!actor || !row.itemSnapshot) {
            row.applied = true;
            row.resultLine = "Could not apply";
            return;
        }
        const partyIds = row.partyIds?.length ? row.partyIds : getPartyActors().map(member => member.id);
        const outcome = await applyProvisionBuff({
            consumerActor: actor,
            itemSnapshot: row.itemSnapshot,
            partyIds,
            kind: row.kind
        });
        row.applied = true;
        row.resultLine = (outcome?.lines ?? []).filter(Boolean).join("; ") || row.buffSummary || "Applied";
    }

    async publish() {
        const app = this._app;
        await app._saveRestState?.();
        const snapshot = app.getRestSnapshot?.();
        if (snapshot) emitRestSnapshot(snapshot);
        emitPhaseChanged(app._phase, {
            mealBuffQueue: app._mealBuffQueue ?? []
        });
        app.render();
    }
}
