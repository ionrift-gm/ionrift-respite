/**
 * TrainingActivityDialog
 *
 * Interactive roll surface for the Training activity. Once a character commits
 * to Training, whoever controls them rolls the three sets here, one click per
 * set, filling a progress bar. After the last set the dialog shows the XP haul
 * and a confirm button that banks the result. The produced outcome matches the
 * shape ActivityResolver returns, so the normal resolution path applies the XP.
 */

const MODULE_ID = "ionrift-respite";
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

let _openDialog = null;

export class TrainingActivityDialog extends HandlebarsApplicationMixin(ApplicationV2) {

    static DEFAULT_OPTIONS = {
        id: "ionrift-training-dialog",
        classes: ["ionrift-window", "glass-ui", "ionrift", "ionrift-training-dialog"],
        window: {
            title: "Training",
            resizable: false,
            minimizable: false
        },
        position: {
            width: 380,
            height: "auto"
        },
        actions: {
            rollSet: TrainingActivityDialog.#onRollSet,
            confirmTraining: TrainingActivityDialog.#onConfirm
        }
    };

    static PARTS = {
        "training": {
            template: `modules/${MODULE_ID}/templates/training-activity-dialog.hbs`
        }
    };

    /**
     * @param {Object} opts
     * @param {Actor} opts.actor
     * @param {Object} opts.activity Activity schema (act_train).
     * @param {string} opts.activityId
     * @param {ActivityResolver} opts.resolver
     * @param {Object} opts.context Output of resolver.getTrainingContext.
     * @param {(result: Object|null) => void} opts.resolve Settled with the outcome or null on cancel.
     */
    constructor({ actor, activity, activityId, resolver, context, resolve } = {}, appOptions = {}) {
        super(appOptions);
        this._actor = actor;
        this._activity = activity;
        this._activityId = activityId;
        this._resolver = resolver;
        this._context = context;
        this._resolveFn = resolve;

        /** @type {Array<{set:number,total:number,passed:boolean}>} */
        this._rolls = [];
        this._rolling = false;
        this._settled = false;
    }

    get title() {
        return `Training - ${this._actor?.name ?? "Character"}`;
    }

    async _prepareContext() {
        const ctx = this._context ?? {};
        const numRolls = ctx.numRolls ?? 3;
        const rolled = this._rolls.length;
        const allRolled = rolled >= numRolls;

        const segments = [];
        for (let i = 0; i < numRolls; i++) {
            const r = this._rolls[i];
            let state = "pending";
            if (r) state = r.passed ? "pass" : "fail";
            else if (i === rolled) state = "current";
            segments.push({ state });
        }

        const successes = this._rolls.filter(r => r.passed).length;
        const baseXP = this._rolls.reduce(
            (sum, r) => sum + (r.passed ? (ctx.successXP ?? 15) : (ctx.failXP ?? 5)), 0
        );
        const reduction = ctx.xpReduction ?? 0;
        const awardedXP = Math.max(0, baseXP - reduction);

        return {
            actorName: this._actor?.name ?? "Character",
            abilityLabel: ctx.rollLabel ?? "",
            dc: ctx.adjustedDc ?? 13,
            numRolls,
            segments,
            rolls: this._rolls,
            allRolled,
            rolling: this._rolling,
            nextSet: rolled + 1,
            rollButtonLabel: rolled === 0 ? "Roll set 1" : `Roll set ${rolled + 1}`,
            successes,
            awardedXP,
            reduction,
            noXp: awardedXP <= 0
        };
    }

    static async #onRollSet() {
        const ctx = this._context ?? {};
        const numRolls = ctx.numRolls ?? 3;
        if (this._rolling || this._rolls.length >= numRolls) return;

        this._rolling = true;
        try {
            const result = await this._resolver.rollTrainingSet(this._rolls.length + 1, ctx);
            this._rolls.push({ set: result.set, total: result.total, passed: result.passed });
        } catch (e) {
            console.warn(`${MODULE_ID} | Training set roll failed:`, e);
        } finally {
            this._rolling = false;
            this.render();
        }
    }

    static async #onConfirm() {
        const ctx = this._context ?? {};
        const numRolls = ctx.numRolls ?? 3;
        if (this._settled || this._rolls.length < numRolls) return;

        this._settled = true;
        let outcome = null;
        try {
            outcome = await this._resolver.finalizeTraining(
                this._activity, this._activityId, this._actor, this._rolls, ctx
            );
        } catch (e) {
            console.error(`${MODULE_ID} | Training finalize failed:`, e);
            this._settled = false;
            return;
        }
        const resolve = this._resolveFn;
        this._resolveFn = null;
        if (resolve) resolve(outcome);
        await this.close();
    }

    async close(options = {}) {
        // Closing before confirming counts as a cancel.
        if (!this._settled) {
            this._settled = true;
            const resolve = this._resolveFn;
            this._resolveFn = null;
            if (resolve) resolve(null);
        }
        if (_openDialog === this) _openDialog = null;
        return super.close(options);
    }

    /**
     * Opens the dialog and resolves with the training outcome, or null if the
     * player cancels. Falls back to a non-interactive auto-roll if the dialog
     * cannot be constructed.
     *
     * @param {Object} opts
     * @param {Actor} opts.actor
     * @param {Object} opts.activity
     * @param {string} opts.activityId
     * @param {ActivityResolver} opts.resolver
     * @param {string} opts.comfort
     * @param {boolean} opts.safeRestSpot
     * @returns {Promise<Object|null>}
     */
    static run({ actor, activity, activityId, resolver, comfort, safeRestSpot }) {
        if (_openDialog) {
            void _openDialog.close();
            _openDialog = null;
        }
        const context = resolver.getTrainingContext(activity, actor, comfort, safeRestSpot);
        return new Promise(resolve => {
            const dlg = new TrainingActivityDialog({ actor, activity, activityId, resolver, context, resolve });
            _openDialog = dlg;
            dlg.render(true);
        });
    }
}
