/**
 * ActivityConfigApp
 * GM-only submenu for toggling rest activities on/off.
 * Opens from the Foundry module settings panel via registerMenu.
 *
 * Uses Ionrift Glass theme (ionrift-window). Settings are saved
 * immediately to game.settings when the Save button is clicked.
 */

const MODULE_ID = "ionrift-respite";

/** Activity toggle definitions. Order = display order in the dialog. */
const ACTIVITY_TOGGLES = [
    {
        key: "enableProfessions",
        label: "Crafting Professions",
        icon: "fas fa-hammer",
        hint: "Cooking, brewing, tailoring, and crafting activities. Also controls the travel phase: disabling this auto-skips travel."
    },
    {
        key: "enableFletching",
        label: "Fletching",
        icon: "fas fa-bullseye",
        hint: "Fletch Arrows activity during long rests. Available to all characters."
    },
    {
        key: "enableTraining",
        label: "Training",
        icon: "fas fa-dumbbell",
        hint: "Training activity for characters level 5 and below to earn XP."
    },
    {
        key: "enableEncounters",
        label: "Night Encounters & Watch",
        icon: "fas fa-shield-alt",
        hint: "Keep Watch, Set Up Defenses, scouting, and the night encounter roll. Off keeps the night closer to RAW; the GM can still improvise an event by hand."
    }
];

export class ActivityConfigApp extends foundry.applications.api.ApplicationV2 {

    static DEFAULT_OPTIONS = {
        id: "respite-activity-config",
        window: {
            title: "Rest Activities",
            icon: "fas fa-campground",
            resizable: false
        },
        position: { width: 420, height: "auto" },
        classes: ["ionrift-window"]
    };

    /** @override */
    async _prepareContext() {
        return {
            toggles: ACTIVITY_TOGGLES.map(t => ({
                ...t,
                value: game.settings.get(MODULE_ID, t.key)
            }))
        };
    }

    /** @override */
    async _renderHTML(context) {
        const el = document.createElement("div");
        el.classList.add("respite-activity-config");

        let html = `
        <p class="activity-config-lead">Turn rest activities on or off for this world.</p>
        <div class="activity-config-list">`;

        for (const toggle of context.toggles) {
            html += `
            <div class="activity-config-row" data-key="${toggle.key}">
                <div class="activity-config-info">
                    <div class="activity-config-label">
                        <i class="${toggle.icon} activity-config-icon"></i>
                        ${toggle.label}
                    </div>
                    <div class="activity-config-hint">${toggle.hint}</div>
                </div>
                <label class="activity-config-toggle">
                    <input type="checkbox" class="activity-config-cb"
                           data-key="${toggle.key}"
                           ${toggle.value ? "checked" : ""} />
                    <span class="activity-config-slider"></span>
                </label>
            </div>`;
        }

        html += `</div>
        <div class="activity-config-actions">
            <button type="button" class="activity-config-save-btn">
                <i class="fas fa-save"></i> Save
            </button>
        </div>`;

        el.innerHTML = html;
        this._wireEvents(el);
        return el;
    }

    /** @override */
    _replaceHTML(result, content, _options) {
        content.replaceChildren(result);
    }

    _wireEvents(el) {
        el.querySelector(".activity-config-save-btn")?.addEventListener("click", () => this._onSave(el));
    }

    async _onSave(el) {
        const checkboxes = el.querySelectorAll(".activity-config-cb");
        for (const cb of checkboxes) {
            const key = cb.dataset.key;
            const val = cb.checked;
            await game.settings.set(MODULE_ID, key, val);
        }
        ui.notifications.info("Rest activity settings saved.");
        this.close();
    }
}
