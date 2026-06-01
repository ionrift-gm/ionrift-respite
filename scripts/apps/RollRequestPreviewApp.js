/**
 * RollRequestPreviewApp — GM-side harness for iterating on the shared roll-request UI.
 * Renders the rollRequest partial with mock payloads (player POV from the host client).
 */

import { executePlayerRoll } from "../services/RollRequestManager.js";
import { getPartyActors } from "../services/partyActors.js";
import { findPreviewPlayerActor, centerRollRequestRoster } from "../services/RollRequestView.js";
import { ensureDcPulseAnimation } from "../services/RollRequestDcPulse.js";

const MODULE_ID = "ionrift-respite";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

let activePreview = null;

export class RollRequestPreviewApp extends HandlebarsApplicationMixin(ApplicationV2) {

    static DEFAULT_OPTIONS = {
        id: "ionrift-roll-request-preview",
        classes: ["ionrift-window", "glass-ui", "ionrift-roll-request-preview"],
        tag: "div",
        window: {
            title: "Roll Request Preview",
            icon: "fas fa-dice-d20",
            resizable: true
        },
        position: {
            width: 540,
            height: 580
        },
        actions: {
            previewSelectVariant: RollRequestPreviewApp.#onSelectVariant,
            previewToggleGmView: RollRequestPreviewApp.#onToggleGmView,
            ionriftRoll: RollRequestPreviewApp.#onStubRoll
        }
    };

    static PARTS = {
        body: {
            template: `modules/${MODULE_ID}/templates/roll-request-preview.hbs`
        }
    };

    constructor(options = {}) {
        super(options);
        this._variant = options.variant ?? "pending-single";
        this._gmViewForced = options.gmViewForced ?? false;
        this._stubRolled = new Set();
    }

    static open(options = {}) {
        if (!game.user.isGM) {
            ui.notifications.warn("Roll request preview is GM-only.");
            return null;
        }
        if (!Handlebars.partials.rollRequest) {
            ui.notifications.warn("Roll request partial not loaded yet. Reload the world.");
            return null;
        }
        if (activePreview && !activePreview.rendered) activePreview = null;
        if (!activePreview) {
            activePreview = new RollRequestPreviewApp(options);
        }
        activePreview.render(true);
        return activePreview;
    }

    async _prepareContext() {
        const api = game.ionrift?.respite?.rollRequest;
        const base = api?.buildMockContext?.(this._variant)
            ?? { title: "Preview unavailable", skillName: "Survival", dc: 10, targets: [], flow: "preview", meta: {} };

        const rollRequest = foundry.utils.deepClone(base);
        if (this._gmViewForced) {
            rollRequest.gmView = false;
        }

        const party = getPartyActors();
        const focusActor = !rollRequest.gmView ? findPreviewPlayerActor(party) : null;

        if (rollRequest.participants?.length && party.length) {
            rollRequest.participants = rollRequest.participants.map((participant, index) => {
                const actor = party[index] ?? party.find((entry) => entry.id === participant.id);
                const isYours = rollRequest.gmView
                    ? false
                    : (focusActor ? actor?.id === focusActor.id : actor?.isOwner ?? participant.isOwner ?? false);
                const rolled = participant.rolled || this._stubRolled.has(actor?.id ?? participant.id);

                return {
                    ...participant,
                    id: actor?.id ?? participant.id,
                    name: actor?.name ?? participant.name,
                    img: actor?.img ?? participant.img ?? "",
                    isOwner: isYours,
                    rolled,
                    canRoll: isYours && !rolled
                };
            });
            rollRequest.participants = api?.layoutParticipants?.(rollRequest.participants, {
                centerFocus: true,
                gmView: !!rollRequest.gmView
            }) ?? rollRequest.participants;
            rollRequest.actionTargets = rollRequest.participants.filter((entry) => entry.canRoll);
            const rolledCount = rollRequest.participants.filter((entry) => entry.rolled).length;
            rollRequest.rolledCount = rolledCount;
            rollRequest.progressLabel = rollRequest.participants.length > 1
                ? `${rolledCount} / ${rollRequest.participants.length} rolled`
                : "";
            rollRequest.allRolled = rollRequest.participants.length > 0
                && rolledCount === rollRequest.participants.length;
            rollRequest.rosterFocusCenter = rollRequest.participants.some((entry) => entry.isOwner) && !rollRequest.gmView;
        }

        if (this._stubRolled.size && rollRequest.participants?.length) {
            for (const participant of rollRequest.participants) {
                if (this._stubRolled.has(participant.id)) {
                    participant.rolled = true;
                    participant.canRoll = false;
                }
            }
            rollRequest.actionTargets = rollRequest.participants.filter((entry) => entry.canRoll);
            const rolledCount = rollRequest.participants.filter((entry) => entry.rolled).length;
            rollRequest.rolledCount = rolledCount;
            rollRequest.progressLabel = rollRequest.participants.length > 1
                ? `${rolledCount} / ${rollRequest.participants.length} rolled`
                : "";
            rollRequest.allRolled = rolledCount === rollRequest.participants.length;
            rollRequest.state = rollRequest.allRolled ? "submitted" : (rolledCount > 0 ? "partial" : "pending");
        }

        return {
            rollRequest,
            variants: api?.variants ?? [],
            currentVariant: this._variant,
            gmViewForced: this._gmViewForced
        };
    }

    _onRender(context, options) {
        super._onRender(context, options);

        const select = this.element.querySelector(".roll-request-preview__select");
        if (select && !select.dataset.bound) {
            select.dataset.bound = "1";
            select.addEventListener("change", (ev) => {
                RollRequestPreviewApp.#onSelectVariant.call(this, ev, ev.target);
            });
        }

        const toggle = this.element.querySelector(".roll-request-preview__toggle input");
        if (toggle && !toggle.dataset.bound) {
            toggle.dataset.bound = "1";
            toggle.addEventListener("change", (ev) => {
                RollRequestPreviewApp.#onToggleGmView.call(this, ev, ev.target);
            });
        }

        centerRollRequestRoster(this.element);
        ensureDcPulseAnimation(this.element);
    }

    static #onSelectVariant(event, target) {
        this._variant = target.value;
        this._stubRolled.clear();
        this.render();
    }

    static #onToggleGmView(event, target) {
        this._gmViewForced = target.checked;
        this.render();
    }

    static async #onStubRoll(event, target) {
        event.preventDefault?.();
        const characterId = target.dataset.characterId;
        if (!characterId) return;

        const actor = RollRequestPreviewApp.#resolvePreviewActor(characterId);
        if (!actor) {
            ui.notifications.warn("No party actor available for preview roll.");
            return;
        }

        const api = game.ionrift?.respite?.rollRequest;
        const mock = api?.buildMockContext?.(this._variant)
            ?? { skillKey: "sur", skillName: "Survival", dc: 10, targets: [] };
        const targetEntry = mock.participants?.find((entry) => entry.id === characterId)
            ?? mock.actionTargets?.find((entry) => entry.id === characterId);
        const rollMode = targetEntry?.rollMode ?? "normal";
        const modeLabel = rollMode === "advantage" ? " [Advantage]" : rollMode === "disadvantage" ? " [Disadvantage]" : "";
        const flavor = `<strong>${actor.name}</strong> attempts ${mock.skillName} check (DC ${mock.dc}) [preview]${modeLabel}`;

        await executePlayerRoll(actor, mock.skillKey, mock.dc, flavor, target, rollMode);

        this._stubRolled.add(characterId);
        ui.notifications.info(`${actor.name} rolled for preview.`);
        this.render();
    }

    static #resolvePreviewActor(characterId) {
        const party = getPartyActors();
        if (characterId === "a1") return party[0] ?? null;
        if (characterId === "a2") return party[1] ?? null;
        return party.find((actor) => actor.id === characterId) ?? party[0] ?? null;
    }
}
