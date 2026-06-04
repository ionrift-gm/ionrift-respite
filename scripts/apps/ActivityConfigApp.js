/**
 * ActivityConfigApp
 * GM-only submenu for toggling rest activities on/off.
 * Opens from the Foundry module settings panel via registerMenu.
 *
 * Uses Ionrift Glass theme (ionrift-window). Settings are saved
 * immediately to game.settings when the Save button is clicked.
 */

import {
    FLETCHING_YIELD_TIER_MAX,
    getFletchingTier,
    getFletchingTierLabel
} from "../services/FletchingSettings.js";
import {
    TRAINING_GUIDE_PAGE_ID,
    TRAINING_XP_TIER_MAX,
    getTrainingTier,
    getTrainingTierLabel
} from "../services/TrainingSettings.js";

const MODULE_ID = "ionrift-respite";

const TIER_SLIDER_META = {
    trainingXpTier: {
        min: 0,
        max: TRAINING_XP_TIER_MAX,
        getValue: getTrainingTier,
        getLabel: getTrainingTierLabel,
        rowClass: "activity-config-row--training",
        guideAction: "openTrainingGuide"
    },
    fletchingYieldTier: {
        min: 0,
        max: FLETCHING_YIELD_TIER_MAX,
        getValue: getFletchingTier,
        getLabel: getFletchingTierLabel,
        rowClass: "activity-config-row--fletching"
    }
};

/** Boolean activity toggles and tier sliders. Order = display order in the dialog. */
const ACTIVITY_TOGGLES = [
    {
        key: "enableProfessions",
        label: "Crafting Professions",
        icon: "fas fa-hammer",
        hint: "Cooking, brewing, tailoring, and crafting activities. Also controls the travel phase: disabling this auto-skips travel.",
        type: "boolean"
    },
    {
        key: "fletchingYieldTier",
        label: "Fletching",
        icon: "fas fa-bullseye",
        hint: "Fletch Arrows during long rests. Slide to Off, or snap to a yield tier: 2d4+prof through 2d20+prof on a successful check.",
        type: "tierSlider"
    },
    {
        key: "trainingXpTier",
        label: "Training",
        icon: "fas fa-dumbbell",
        hint: "Characters level 5 and below can train during long rests. Slide to Off, or snap to a tier: fail XP / pass XP per set, from 3/10 up to 10/50.",
        type: "tierSlider"
    },
    {
        key: "enableEncounters",
        label: "Night Encounters & Watch",
        icon: "fas fa-shield-alt",
        hint: "Keep Watch, Set Up Defenses, scouting, and the night encounter roll. Off skips the encounter layer; the night passes without a check.",
        type: "boolean"
    },
    {
        key: "enableCopySpell",
        label: "Copy Spell",
        icon: "fas fa-scroll",
        hint: "Copy Spell activity during long rests for wizards with a spellbook.",
        type: "boolean"
    },
    {
        key: "enableScouting",
        label: "Travel Scouting",
        icon: "fas fa-binoculars",
        hint: "Scout option on the final travel day. Perception or Survival roll sets camp comfort and the night check. Off by default; Survival Quick Setup turns this on.",
        type: "boolean"
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
        position: { width: 440, height: "auto" },
        classes: ["ionrift-window"]
    };

    /** @override */
    async _prepareContext() {
        return {
            rows: ACTIVITY_TOGGLES.map(row => {
                if (row.type === "tierSlider") {
                    const meta = TIER_SLIDER_META[row.key];
                    return {
                        ...row,
                        ...meta,
                        value: meta.getValue()
                    };
                }
                return {
                    ...row,
                    value: game.settings.get(MODULE_ID, row.key)
                };
            })
        };
    }

    /** @override */
    async _renderHTML(context) {
        const el = document.createElement("div");
        el.classList.add("respite-activity-config");

        let html = `
        <p class="activity-config-lead">Turn rest activities on or off for this world. Training and fletching use tier sliders (Off plus five rates).</p>
        <div class="activity-config-list">`;

        for (const row of context.rows) {
            const tierRowClass = row.rowClass ? ` ${row.rowClass}` : "";
            html += `
            <div class="activity-config-row${row.type === "tierSlider" ? ` activity-config-row--tier${tierRowClass}` : ""}" data-key="${row.key}">
                <div class="activity-config-info">
                    <div class="activity-config-label">
                        <i class="${row.icon} activity-config-icon"></i>
                        ${row.label}
                        ${row.guideAction === "openTrainingGuide" ? `
                        <a href="#" class="activity-config-guide-link" data-action="openTrainingGuide" title="Open Training guide">
                            <i class="fas fa-book-open"></i> Guide
                        </a>` : ""}
                    </div>
                    <div class="activity-config-hint">${row.hint}</div>
                </div>
                ${this._renderControl(row)}
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

    _renderControl(row) {
        if (row.type === "boolean") {
            return `
            <label class="activity-config-toggle">
                <input type="checkbox" class="activity-config-cb"
                       data-key="${row.key}"
                       ${row.value ? "checked" : ""} />
                <span class="activity-config-slider"></span>
            </label>`;
        }
        if (row.type === "tierSlider") {
            const label = row.getLabel(row.value);
            return `
            <div class="activity-config-range-wrap">
                <input type="range" class="activity-config-range" data-key="${row.key}"
                       min="${row.min}" max="${row.max}" step="1"
                       value="${row.value}" />
                <span class="activity-config-range-val" data-key="${row.key}">${label}</span>
            </div>`;
        }
        return "";
    }

    /** @override */
    _replaceHTML(result, content, _options) {
        content.replaceChildren(result);
    }

    _wireEvents(el) {
        el.querySelector(".activity-config-save-btn")?.addEventListener("click", () => this._onSave(el));

        el.querySelector('[data-action="openTrainingGuide"]')?.addEventListener("click", (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            game.ionrift?.respite?.openPlayerGuide?.(TRAINING_GUIDE_PAGE_ID);
        });

        el.querySelectorAll(".activity-config-range").forEach(range => {
            range.addEventListener("input", () => {
                const meta = TIER_SLIDER_META[range.dataset.key];
                const display = el.querySelector(`.activity-config-range-val[data-key="${range.dataset.key}"]`);
                if (display && meta) display.textContent = meta.getLabel(Number(range.value));
            });
        });
    }

    async _onSave(el) {
        for (const row of ACTIVITY_TOGGLES) {
            if (row.type === "boolean") {
                const cb = el.querySelector(`.activity-config-cb[data-key="${row.key}"]`);
                if (cb) await game.settings.set(MODULE_ID, row.key, cb.checked);
            } else if (row.type === "tierSlider") {
                const range = el.querySelector(`.activity-config-range[data-key="${row.key}"]`);
                if (range) await game.settings.set(MODULE_ID, row.key, Number(range.value));
            }
        }
        ui.notifications.info("Rest activity settings saved.");
        this.close();
    }
}
