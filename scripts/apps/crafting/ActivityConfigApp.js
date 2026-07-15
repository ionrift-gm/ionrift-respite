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
} from "../../services/crafting/settings/FletchingSettings.js";
import {
    TRAINING_GUIDE_PAGE_ID,
    TRAINING_XP_TIER_MAX,
    getTrainingTier,
    getTrainingTierLabel
} from "../../services/crafting/settings/TrainingSettings.js";
import {
    CAMP_FUEL_FIND_DEFAULT_PERCENT,
    CAMP_FUEL_FIND_MAX_PERCENT,
    CAMP_FUEL_FIND_MIN_PERCENT
} from "../../services/travel/settings/TravelSettings.js";
import { MODULE_ID } from "../../data/moduleId.js";

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

const ACTIVITIES_GROUP = {
    id: "activities",
    label: "Activities",
    icon: "fas fa-campground",
    hint: "Evening camp: professions, training, pray, fletching, encounters, copy spell."
};

/** Boolean activity toggles and tier sliders. Order = display order in the dialog. */
const ACTIVITY_TOGGLES = [
    {
        key: "chefTreatCookingOnly",
        label: "Chef Treats Only",
        icon: "fas fa-cookie-bite",
        hint: "RAW: no camp meals. Chef feat bakes Bolstering Treats only.",
        type: "boolean"
    },
    {
        key: "enableProfessions",
        label: "Crafting Professions",
        icon: "fas fa-hammer",
        hint: "Cook, brew, tailor, and craft activities during rest.",
        type: "boolean"
    },
    {
        key: "enableEncounters",
        label: "Night Encounters & Watch",
        icon: "fas fa-shield-alt",
        hint: "Watch, defenses, scouting, and the night encounter roll.",
        type: "boolean"
    },
    {
        key: "fletchingYieldTier",
        label: "Fletching",
        icon: "fas fa-bullseye",
        hint: "Fletch arrows on long rests. Off, or yield tiers from 2d4+prof to 2d20+prof.",
        type: "tierSlider"
    },
    {
        key: "trainingXpTier",
        label: "Training",
        icon: "fas fa-dumbbell",
        hint: "Level 5 and below train on long rests. Off, or XP tiers from 3/10 to 10/50 per set.",
        type: "tierSlider"
    },
    {
        key: "enablePrayMeditate",
        label: "Pray / Meditate",
        icon: "fas fa-pray",
        hint: "Religion or Insight for temp HP. Off removes bedroll Pray / Meditate.",
        type: "boolean"
    },
    {
        key: "enableCopySpell",
        label: "Copy Spell",
        icon: "fas fa-scroll",
        hint: "Wizards with a spellbook copy spells on long rests.",
        type: "boolean"
    },
    {
        type: "group",
        id: "travel",
        label: "Travel",
        icon: "fas fa-route",
        hint: "Pre-camp march: forage, hunt, optional final-day scouting.",
        children: [
            {
                key: "useTravel",
                label: "Use Travel Phase",
                hint: "Travel phase on long rests. Off goes straight to camp."
            },
            {
                key: "enableForaging",
                label: "Travel Foraging",
                hint: "Forage on travel days. Off removes it from declarations.",
                requiresUseTravel: true
            },
            {
                key: "campFuelFindChance",
                label: "Camp Fuel Find Chance",
                hint: "Chance each forage also grants kindling. 0 turns off the roll.",
                type: "percentSlider",
                min: CAMP_FUEL_FIND_MIN_PERCENT,
                max: CAMP_FUEL_FIND_MAX_PERCENT,
                step: 1,
                requiresUseTravel: true,
                requiresForaging: true
            },
            {
                key: "enableHunting",
                label: "Travel Hunting",
                hint: "Hunt prey on travel days. Off removes it from declarations.",
                requiresUseTravel: true
            },
            {
                key: "enableScouting",
                label: "Travel Scouting",
                hint: "Scout on the last travel day. Sets comfort and the night check.",
                requiresUseTravel: true
            },
            {
                key: "homebrewProvisionOnly",
                label: "Homebrew Provisions Only",
                hint: "Custom recipes and Respite Custom compendium only. Ignores shipped items, stubs, and imported packs."
            }
        ]
    }
];

export class ActivityConfigApp extends foundry.applications.api.ApplicationV2 {

    static DEFAULT_OPTIONS = {
        id: "respite-activity-config",
        window: {
            title: "Travel & Activities",
            icon: "fas fa-campground",
            resizable: false
        },
        position: { width: 720, height: "auto" },
        classes: ["ionrift-window"]
    };

    /** @override */
    async _prepareContext() {
        const useTravel = !!game.settings.get(MODULE_ID, "useTravel");
        const foragingOn = !!game.settings.get(MODULE_ID, "enableForaging");

        const resolveBooleanRow = (row) => {
            const disabled = (row.requiresUseTravel && !useTravel)
                || (row.requiresForaging && !foragingOn);
            return {
                ...row,
                type: "boolean",
                value: game.settings.get(MODULE_ID, row.key),
                disabled
            };
        };

        const resolveTravelChild = (child) => {
            if (child.type === "percentSlider") {
                const disabled = (child.requiresUseTravel && !useTravel)
                    || (child.requiresForaging && !foragingOn);
                const raw = game.settings.get(MODULE_ID, child.key);
                const value = typeof raw === "number" && !Number.isNaN(raw)
                    ? raw
                    : CAMP_FUEL_FIND_DEFAULT_PERCENT;
                return { ...child, value, disabled };
            }
            return resolveBooleanRow(child);
        };

        const rows = ACTIVITY_TOGGLES.map(entry => {
            if (entry.type === "group") {
                return {
                    ...entry,
                    children: entry.children.map(child => resolveTravelChild(child))
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

        return { rows, useTravel };
    }

    /** @override */
    async _renderHTML(context) {
        const el = document.createElement("div");
        el.classList.add("respite-activity-config");

        const mainRows = context.rows.filter(row => row.type !== "group");
        const travelGroup = context.rows.find(row => row.type === "group" && row.id === "travel");

        let html = `
        <p class="activity-config-lead">Pre-camp travel and evening activities. Training and fletching use tier sliders.</p>
        <div class="activity-config-layout">
            <div class="activity-config-column activity-config-column--travel">`;

        if (travelGroup) {
            html += this._renderTravelGroup(travelGroup);
        }

        html += `
            </div>
            <div class="activity-config-column activity-config-column--activities">`;

        html += this._renderActivitiesGroup(mainRows);

        html += `
            </div>
        </div>
        <div class="activity-config-actions">
            <button type="button" class="activity-config-save-btn">
                <i class="fas fa-save"></i> Save
            </button>
        </div>`;

        el.innerHTML = html;
        this._wireEvents(el);
        return el;
    }

    _renderSettingRow(row, { asSub = false } = {}) {
        const tierRowClass = row.rowClass ? ` ${row.rowClass}` : "";
        const subClass = asSub ? " activity-config-row--sub" : "";
        const disabledClass = row.disabled ? " activity-config-row--disabled" : "";
        const labelClass = asSub ? " activity-config-label--sub" : "";
        return `
            <div class="activity-config-row${subClass}${disabledClass}${row.type === "tierSlider" ? ` activity-config-row--tier${tierRowClass}` : ""}" data-key="${row.key}">
                <div class="activity-config-info">
                    <div class="activity-config-label${labelClass}">
                        ${asSub ? "" : `<i class="${row.icon} activity-config-icon"></i>`}
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

    _renderActivitiesGroup(rows) {
        let html = `
            <div class="activity-config-group" data-group="${ACTIVITIES_GROUP.id}">
                <div class="activity-config-group-header">
                    <i class="${ACTIVITIES_GROUP.icon} activity-config-icon"></i>
                    <div class="activity-config-group-heading">
                        <div class="activity-config-label">${ACTIVITIES_GROUP.label}</div>
                        <div class="activity-config-hint">${ACTIVITIES_GROUP.hint}</div>
                    </div>
                </div>
                <div class="activity-config-group-body">`;
        for (const row of rows) {
            html += this._renderSettingRow(row, { asSub: true });
        }
        html += `
                </div>
            </div>`;
        return html;
    }

    _renderTravelGroup(row) {
        const disabledClass = row.disabled ? " activity-config-group--disabled" : "";
        let html = `
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
        return html;
    }

    _renderGroupChildRow(row) {
        const disabledClass = row.disabled ? " activity-config-row--disabled" : "";
        const tierClass = row.type === "percentSlider" ? " activity-config-row--tier" : "";
        return `
                <div class="activity-config-row activity-config-row--sub${disabledClass}${tierClass}" data-key="${row.key}">
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
        if (row.type === "percentSlider") {
            const disabled = row.disabled ? " disabled" : "";
            return `
            <div class="activity-config-range-wrap">
                <input type="range" class="activity-config-range" data-key="${row.key}"
                       min="${row.min}" max="${row.max}" step="${row.step ?? 1}"
                       value="${row.value}"${disabled} />
                <span class="activity-config-range-val" data-key="${row.key}">${row.value}%</span>
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
            const useTravelCb = el.querySelector('.activity-config-cb[data-key="useTravel"]');
            const foragingCb = el.querySelector('.activity-config-cb[data-key="enableForaging"]');
            const useTravelOn = !!useTravelCb?.checked;
            const foragingOn = !!foragingCb?.checked;
            for (const travelChildKey of ["enableForaging", "enableHunting", "enableScouting", "campFuelFindChance"]) {
                const childRow = el.querySelector(`.activity-config-row[data-key="${travelChildKey}"]`);
                const childInput = childRow?.querySelector(".activity-config-cb, .activity-config-range");
                if (childRow && childInput) {
                    const needsForaging = travelChildKey === "campFuelFindChance";
                    const childDisabled = !useTravelOn
                        || (needsForaging && !foragingOn);
                    childRow.classList.toggle("activity-config-row--disabled", childDisabled);
                    childInput.disabled = childDisabled;
                }
            }
        };

        el.querySelector('.activity-config-cb[data-key="useTravel"]')
            ?.addEventListener("change", syncTravelGroup);
        el.querySelector('.activity-config-cb[data-key="enableForaging"]')
            ?.addEventListener("change", syncTravelGroup);
        syncTravelGroup();

        el.querySelectorAll(".activity-config-range").forEach(range => {
            range.addEventListener("input", () => {
                const meta = TIER_SLIDER_META[range.dataset.key];
                const display = el.querySelector(`.activity-config-range-val[data-key="${range.dataset.key}"]`);
                if (display && meta) {
                    display.textContent = meta.getLabel(Number(range.value));
                } else if (display && range.dataset.key === "campFuelFindChance") {
                    display.textContent = `${range.value}%`;
                }
            });
        });
    }

    async _onSave(el) {
        for (const row of ACTIVITY_TOGGLES) {
            if (row.type === "group") {
                for (const child of row.children) {
                    if (child.type === "percentSlider") {
                        const range = el.querySelector(`.activity-config-range[data-key="${child.key}"]`);
                        if (range && !range.disabled) {
                            await game.settings.set(MODULE_ID, child.key, Number(range.value));
                        }
                    } else {
                        const cb = el.querySelector(`.activity-config-cb[data-key="${child.key}"]`);
                        if (cb && !cb.disabled) {
                            await game.settings.set(MODULE_ID, child.key, cb.checked);
                        }
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
        ui.notifications.info("Travel and activity settings saved.");
        this.close();
    }
}
