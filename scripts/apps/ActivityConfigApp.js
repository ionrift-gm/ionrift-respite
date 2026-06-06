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
import { isProfessionsEnabled } from "../services/TravelSettings.js";

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
        type: "group",
        id: "travel",
        label: "Travel",
        icon: "fas fa-route",
        hint: "Pre-camp travel when crafting professions are on: forage, hunt, and optional final-day scouting.",
        requiresProfessions: true,
        children: [
            {
                key: "useTravel",
                label: "Use Travel Phase",
                hint: "Include the travel phase during long rests. Off skips travel entirely and goes straight to camp."
            },
            {
                key: "enableScouting",
                label: "Travel Scouting",
                hint: "Scout option on the final travel day. Perception or Survival sets camp comfort and the night check.",
                requiresUseTravel: true
            }
        ]
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
        const useTravel = !!game.settings.get(MODULE_ID, "useTravel");
        const professionsOn = isProfessionsEnabled();

        const resolveBooleanRow = (row, { groupDisabled = false } = {}) => {
            const disabled = groupDisabled
                || (row.requiresUseTravel && (!professionsOn || !useTravel));
            return {
                ...row,
                type: "boolean",
                value: game.settings.get(MODULE_ID, row.key),
                disabled
            };
        };

        const rows = ACTIVITY_TOGGLES.map(entry => {
            if (entry.type === "group") {
                const groupDisabled = entry.requiresProfessions && !professionsOn;
                return {
                    ...entry,
                    disabled: groupDisabled,
                    children: entry.children.map(child => resolveBooleanRow(child, { groupDisabled }))
                };
            }
            if (entry.type === "tierSlider") {
                const meta = TIER_SLIDER_META[entry.key];
                return { ...entry, ...meta, value: meta.getValue() };
            }
            return {
                ...entry,
                value: game.settings.get(MODULE_ID, entry.key)
            };
        });

        return { rows, professionsOn, useTravel };
    }

    /** @override */
    async _renderHTML(context) {
        const el = document.createElement("div");
        el.classList.add("respite-activity-config");

        let html = `
        <p class="activity-config-lead">Turn rest activities on or off for this world. Training and fletching use tier sliders (Off plus five rates).</p>
        <div class="activity-config-list">`;

        for (const row of context.rows) {
            if (row.type === "group") {
                const disabledClass = row.disabled ? " activity-config-group--disabled" : "";
                html += `
            <div class="activity-config-group${disabledClass}" data-group="${row.id}">
                <div class="activity-config-group-header">
                    <i class="${row.icon} activity-config-icon"></i>
                    <div class="activity-config-group-heading">
                        <div class="activity-config-label">${row.label}</div>
                        <div class="activity-config-hint">${row.hint}</div>
                    </div>
                </div>
                <div class="activity-config-group-body">`;
                for (const child of row.children) {
                    html += this._renderGroupChildRow(child);
                }
                html += `
                </div>
            </div>`;
                continue;
            }

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

    _renderGroupChildRow(row) {
        const disabledClass = row.disabled ? " activity-config-row--disabled" : "";
        return `
                <div class="activity-config-row activity-config-row--sub${disabledClass}" data-key="${row.key}">
                    <div class="activity-config-info">
                        <div class="activity-config-label activity-config-label--sub">${row.label}</div>
                        <div class="activity-config-hint">${row.hint}</div>
                    </div>
                    ${this._renderControl(row)}
                </div>`;
    }

    _renderControl(row) {
        if (row.type === "boolean") {
            const disabled = row.disabled ? " disabled" : "";
            return `
            <label class="activity-config-toggle">
                <input type="checkbox" class="activity-config-cb"
                       data-key="${row.key}"
                       ${row.value ? "checked" : ""}${disabled} />
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

        const syncTravelGroup = () => {
            const professionsCb = el.querySelector('.activity-config-cb[data-key="enableProfessions"]');
            const useTravelCb = el.querySelector('.activity-config-cb[data-key="useTravel"]');
            const professionsOn = !!professionsCb?.checked;
            const useTravelOn = !!useTravelCb?.checked;
            const group = el.querySelector('.activity-config-group[data-group="travel"]');
            if (group) {
                group.classList.toggle("activity-config-group--disabled", !professionsOn);
            }
            const useTravelRow = el.querySelector('.activity-config-row[data-key="useTravel"]');
            const useTravelInput = useTravelRow?.querySelector(".activity-config-cb");
            if (useTravelRow && useTravelInput) {
                useTravelRow.classList.toggle("activity-config-row--disabled", !professionsOn);
                useTravelInput.disabled = !professionsOn;
            }
            const scoutingRow = el.querySelector('.activity-config-row[data-key="enableScouting"]');
            const scoutingInput = scoutingRow?.querySelector(".activity-config-cb");
            if (scoutingRow && scoutingInput) {
                const scoutingDisabled = !professionsOn || !useTravelOn;
                scoutingRow.classList.toggle("activity-config-row--disabled", scoutingDisabled);
                scoutingInput.disabled = scoutingDisabled;
            }
        };

        el.querySelector('.activity-config-cb[data-key="enableProfessions"]')
            ?.addEventListener("change", syncTravelGroup);
        el.querySelector('.activity-config-cb[data-key="useTravel"]')
            ?.addEventListener("change", syncTravelGroup);
        syncTravelGroup();

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
            if (row.type === "group") {
                for (const child of row.children) {
                    const cb = el.querySelector(`.activity-config-cb[data-key="${child.key}"]`);
                    if (cb && !cb.disabled) {
                        await game.settings.set(MODULE_ID, child.key, cb.checked);
                    }
                }
            } else if (row.type === "boolean") {
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
