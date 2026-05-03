import { ActivityResolver } from "../services/ActivityResolver.js";
import { CraftingEngine } from "../services/CraftingEngine.js";
import { CraftingPickerApp } from "./CraftingPickerApp.js";

const MODULE_ID = "ionrift-respite";
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * ActivityPickerApp (v2)
 * Player-facing application that opens via socket when the GM initiates a rest.
 * Shows available activities for the player's character(s) and submits choices back to the GM.
 */
export class ActivityPickerApp extends HandlebarsApplicationMixin(ApplicationV2) {

    static DEFAULT_OPTIONS = {
        id: "ionrift-respite-picker",
        classes: ["ionrift-window", "glass-ui", "ionrift-respite-app"],
        window: {
            title: "Rest: Choose Activity",
            resizable: false
        },
        position: {
            width: 420,
            height: "auto"
        },
        actions: {
            submitChoice: ActivityPickerApp.#onSubmit,
            openCrafting: ActivityPickerApp.#onOpenCrafting
        }
    };

    static PARTS = {
        "activity-picker": {
            template: `modules/${MODULE_ID}/templates/activity-picker.hbs`
        }
    };

    /**
     * @param {Object} restData - Payload from GM socket broadcast.
     * @param {Object} options
     */
    constructor(restData, options = {}) {
        super(options);
        this._restData = restData;
        this._choices = new Map();
        this._followUps = new Map();  // characterId -> followUp answer
        this._hasSubmitted = false;

        // Initialize crafting engine if recipe data is provided
        this._craftingEngine = new CraftingEngine();
        if (restData.recipes) {
            for (const [profId, recipeList] of Object.entries(restData.recipes)) {
                this._craftingEngine.load(profId, recipeList);
            }
        }
    }

    async _prepareContext(options) {
        const myCharacters = game.actors.filter(
            a => a.hasPlayerOwner && a.isOwner && a.type === "character"
        );

        const resolver = new ActivityResolver();
        resolver.load(this._restData.activities);

        const comfortLabels = {
            safe: "Safe", sheltered: "Sheltered", rough: "Rough", hostile: "Hostile"
        };

        const comfortWarnings = {
            rough: "Rough conditions. Activity DCs increased by 2.",
            hostile: "Hostile conditions. Activity DCs increased by 5. Failure may cause complications."
        };

        const rawTag = this._restData.terrainTag ?? "unknown";
        const terrainLabel = rawTag.split("_").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" / ");
        const terrainTag = this._restData.terrainTag ?? "forest";
        const forageOpts = {
            forageActivityGate: this._restData.forageActivityGate,
            terrainTag,
            resourcePoolsFromPack: false,
            resourcePoolRoller: null
        };
        return {
            terrain: terrainLabel,
            comfort: this._restData.comfort,
            comfortLabel: comfortLabels[this._restData.comfort] ?? this._restData.comfort,
            comfortWarning: comfortWarnings[this._restData.comfort] ?? null,
            restType: this._restData.restType === "long" ? "Long Rest" : "Short Rest",
            characters: myCharacters.map(a => ({
                id: a.id,
                name: a.name,
                img: a.img || "icons/svg/mystery-man.svg",
                activities: resolver.getAvailableActivities(a, this._restData.restType, forageOpts).map(act => ({
                    ...act,
                    isCrafting: act.crafting?.enabled ?? false,
                    craftingProfession: act.crafting?.profession ?? null
                })),
                currentChoice: this._choices.get(a.id) ?? ""
            })),
            hasSubmitted: this._hasSubmitted
        };
    }

    _onRender(context, options) {
        // Bind change events on activity selects
        const selects = this.element.querySelectorAll(".activity-select");
        for (const sel of selects) {
            const hintEl = sel.parentElement.querySelector(".combat-readiness-hint");
            const followUpEl = sel.parentElement.querySelector(".activity-followup-panel");
            const characterId = sel.dataset.characterId;

            const updateHint = () => {
                if (!hintEl) return;
                const selected = sel.options[sel.selectedIndex];
                const hint = selected?.dataset?.combatHint;
                if (hint) {
                    hintEl.innerHTML = `<i class="fas fa-shield-alt"></i> <em>If combat occurs:</em> ${hint}`;
                    hintEl.style.display = "";
                } else {
                    hintEl.textContent = "";
                    hintEl.style.display = "none";
                }
            };

            const updateFollowUp = () => {
                if (!followUpEl) return;
                const activityId = sel.value;
                const activity = this._restData.activities?.find(a => a.id === activityId);
                const followUp = activity?.followUp;

                if (!followUp) {
                    followUpEl.style.display = "none";
                    followUpEl.innerHTML = "";
                    this._followUps.delete(characterId);
                    return;
                }

                followUpEl.style.display = "";
                followUpEl.innerHTML = this._buildFollowUpHTML(followUp, characterId, activityId);

                // Bind follow-up input events
                const inputs = followUpEl.querySelectorAll("select, input[type=radio]");
                for (const input of inputs) {
                    input.addEventListener("change", () => {
                        if (input.type === "radio") {
                            if (input.checked) this._followUps.set(characterId, input.value);
                        } else {
                            this._followUps.set(characterId, input.value);
                        }
                    });
                }

                // Set default value
                if (followUp.type === "radio" && followUp.default) {
                    this._followUps.set(characterId, followUp.default);
                } else if (followUp.type === "partyMember") {
                    // Default to first injured party member
                    const firstOption = followUpEl.querySelector("select option[value]:not([value=''])");
                    if (firstOption) this._followUps.set(characterId, firstOption.value);
                }
            };

            sel.addEventListener("change", (ev) => {
                this._choices.set(characterId, sel.value);
                updateHint();
                updateFollowUp();
            });

            // Initialize for pre-selected activity
            updateHint();
            updateFollowUp();
        }
    }

    /**
     * Builds inline HTML for a Tier 2 follow-up panel.
     */
    _buildFollowUpHTML(followUp, characterId, activityId) {
        const label = `<label class="followup-label">${followUp.label}</label>`;

        if (followUp.type === "partyMember") {
            const partyActors = game.actors.filter(a => a.hasPlayerOwner && a.type === "character" && a.id !== characterId);
            const sorted = partyActors.sort((a, b) => {
                const aRatio = a.system.attributes?.hp?.value / a.system.attributes?.hp?.max;
                const bRatio = b.system.attributes?.hp?.value / b.system.attributes?.hp?.max;
                return aRatio - bRatio;
            });
            const opts = sorted.map(a => {
                const hp = a.system.attributes?.hp;
                const hpText = hp ? ` (${hp.value}/${hp.max} HP)` : "";
                return `<option value="${a.id}">${a.name}${hpText}</option>`;
            }).join("");
            return `${label}<select class="followup-select">${opts}</select>`;
        }

        if (followUp.type === "radio") {
            const radios = followUp.options.map((opt, i) => {
                const checked = opt.value === followUp.default ? "checked" : "";
                return `<label class="followup-radio-label">
                    <input type="radio" name="followup-${characterId}" value="${opt.value}" ${checked}>
                    ${opt.label}
                </label>`;
            }).join("");
            return `${label}<div class="followup-radios">${radios}</div>`;
        }

        return "";
    }

    /**
     * Submits choices back to the GM via socket.
     */
    static async #onSubmit(event, target) {
        const myCharacters = game.actors.filter(
            a => a.hasPlayerOwner && a.isOwner && a.type === "character"
        );

        for (const actor of myCharacters) {
            if (!this._choices.get(actor.id)) {
                ui.notifications.warn(`Choose an activity for ${actor.name}.`);
                return;
            }
            // Validate follow-up is set for Tier 2 activities
            const activityId = this._choices.get(actor.id);
            if (activityId === "act_forage" && this._restData.forageActivityGate?.disabled) {
                ui.notifications.warn(game.i18n.localize(
                    this._restData.forageActivityGate.disabledReasonKey
                        ?? "ionrift-respite.travel.forage.requires_pack"
                ));
                return;
            }
            const activity = this._restData.activities?.find(a => a.id === activityId);
            if (activity?.followUp && !this._followUps.get(actor.id)) {
                ui.notifications.warn(`${actor.name}: ${activity.followUp.label}`);
                return;
            }
        }

        const payload = {
            type: "activityChoice",
            userId: game.user.id,
            choices: Object.fromEntries(this._choices),
            followUps: Object.fromEntries(this._followUps)
        };

        game.socket.emit(`module.${MODULE_ID}`, payload);

        this._hasSubmitted = true;
        this.render();

        ui.notifications.info("Choices submitted. Waiting for the GM to resolve the rest.");
    }

    /**
     * Opens the CraftingPickerApp for a crafting activity.
     */
    static #onOpenCrafting(event, target) {
        const characterId = target.dataset.characterId;
        const profession = target.dataset.profession;
        if (!characterId || !profession) return;

        const actor = game.actors.get(characterId);
        if (!actor) return;

        const picker = new CraftingPickerApp(actor, profession, this._craftingEngine, (result) => {
            // When crafting completes, set the activity choice
            if (result) {
                this._choices.set(characterId, `act_cook`);
                this.render();
            }
        });
        picker.render({ force: true });
    }
}
