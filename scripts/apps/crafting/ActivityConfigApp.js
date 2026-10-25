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
    TRAINING_XP_TIER_MAX,
    getTrainingTier,
    getTrainingTierLabel
} from "../../services/crafting/settings/TrainingSettings.js";
import {
    CAMP_FUEL_FIND_DEFAULT_PERCENT,
    CAMP_FUEL_FIND_MAX_PERCENT,
    CAMP_FUEL_FIND_MIN_PERCENT,
    isForagingEnabled,
    isHuntingEnabled
} from "../../services/travel/settings/TravelSettings.js";
import { shouldShowBrewingAlcoholSetting } from "../../services/crafting/settings/BrewingAlcoholSettings.js";
import { MODULE_ID } from "../../data/moduleId.js";

const TIER_SLIDER_META = {
    trainingXpTier: {
        min: 0,
        max: TRAINING_XP_TIER_MAX,
        getValue: getTrainingTier,
        getLabel: getTrainingTierLabel,
        rowClass: "activity-config-row--training"
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
    get label() { return game.i18n?.localize ? game.i18n.localize("ionrift-respite.activityConfig.groupActivities.label") : "Activities"; },
    icon: "fas fa-campground",
    get hint() { return game.i18n?.localize ? game.i18n.localize("ionrift-respite.activityConfig.groupActivities.hint") : "Evening camp: professions, training, pray, fletching, encounters, copy spell."; }
};

/** Boolean activity toggles and tier sliders. Order = display order in the dialog. */
const ACTIVITY_TOGGLES = [
    {
        key: "chefTreatCookingOnly",
        get label() { return game.i18n?.localize ? game.i18n.localize("ionrift-respite.activityConfig.chefTreatCookingOnly.label") : "Chef Treats Only"; },
        icon: "fas fa-cookie-bite",
        get hint() { return game.i18n?.localize ? game.i18n.localize("ionrift-respite.activityConfig.chefTreatCookingOnly.hint") : "No camp meals; Chef Bolstering Treats only."; },
        type: "boolean"
    },
    {
        key: "enableProfessions",
        get label() { return game.i18n?.localize ? game.i18n.localize("ionrift-respite.activityConfig.enableProfessions.label") : "Crafting Professions"; },
        icon: "fas fa-hammer",
        get hint() { return game.i18n?.localize ? game.i18n.localize("ionrift-respite.activityConfig.enableProfessions.hint") : "Cook, brew, tailor, and craft activities during rest."; },
        type: "boolean"
    },
    {
        key: "enableBrewingAlcohol",
        get label() { return game.i18n?.localize ? game.i18n.localize("ionrift-respite.activityConfig.enableBrewingAlcohol.label") : "Alcoholic drinks"; },
        icon: "fas fa-wine-bottle",
        get hint() { return game.i18n?.localize ? game.i18n.localize("ionrift-respite.activityConfig.enableBrewingAlcohol.hint") : "Wine, mead, and draught recipes."; },
        type: "boolean",
        requiresAlcoholBrewContent: true
    },
    {
        key: "enableEncounters",
        get label() { return game.i18n?.localize ? game.i18n.localize("ionrift-respite.activityConfig.enableEncounters.label") : "Night Encounters & Watch"; },
        icon: "fas fa-shield-alt",
        get hint() { return game.i18n?.localize ? game.i18n.localize("ionrift-respite.activityConfig.enableEncounters.hint") : "Watch, defenses, and the night encounter roll."; },
        type: "boolean"
    },
    {
        key: "fletchingYieldTier",
        get label() { return game.i18n?.localize ? game.i18n.localize("ionrift-respite.activityConfig.fletchingYieldTier.label") : "Fletching"; },
        icon: "fas fa-bullseye",
        get hint() { return game.i18n?.localize ? game.i18n.localize("ionrift-respite.activityConfig.fletchingYieldTier.hint") : "Fletch arrows on long rests. Off, or yield tiers from 2d4+prof to 2d20+prof."; },
        type: "tierSlider"
    },
    {
        key: "trainingXpTier",
        get label() { return game.i18n?.localize ? game.i18n.localize("ionrift-respite.activityConfig.trainingXpTier.label") : "Training"; },
        icon: "fas fa-dumbbell",
        get hint() { return game.i18n?.localize ? game.i18n.localize("ionrift-respite.activityConfig.trainingXpTier.hint") : "Level 5 and below train on long rests. Off, or XP tiers from 3/10 to 10/50 per set."; },
        type: "tierSlider"
    },
    {
        key: "enablePrayMeditate",
        get label() { return game.i18n?.localize ? game.i18n.localize("ionrift-respite.activityConfig.enablePrayMeditate.label") : "Pray / Meditate"; },
        icon: "fas fa-pray",
        get hint() { return game.i18n?.localize ? game.i18n.localize("ionrift-respite.activityConfig.enablePrayMeditate.hint") : "Religion or Insight for temp HP"; },
        type: "boolean"
    },
    {
        key: "enableCopySpell",
        get label() { return game.i18n?.localize ? game.i18n.localize("ionrift-respite.activityConfig.enableCopySpell.label") : "Copy Spell"; },
        icon: "fas fa-scroll",
        get hint() { return game.i18n?.localize ? game.i18n.localize("ionrift-respite.activityConfig.enableCopySpell.hint") : "Wizards with a spellbook copy spells on long rests."; },
        type: "boolean"
    },
    {
        type: "group",
        id: "travel",
        get label() { return game.i18n?.localize ? game.i18n.localize("ionrift-respite.activityConfig.groupTravel.label") : "Gathering & Provisions"; },
        icon: "fas fa-seedling",
        get hint() { return game.i18n?.localize ? game.i18n.localize("ionrift-respite.activityConfig.groupTravel.hint") : "Foraging, hunting, and provision rules during rest."; },
        children: [
            {
                key: "enableForaging",
                get label() { return game.i18n?.localize ? game.i18n.localize("ionrift-respite.activityConfig.enableForaging.label") : "Foraging"; },
                get hint() { return game.i18n?.localize ? game.i18n.localize("ionrift-respite.activityConfig.enableForaging.hint") : "Gather wild provisions during rest. Off removes the activity."; }
            },
            {
                key: "campFuelFindChance",
                get label() { return game.i18n?.localize ? game.i18n.localize("ionrift-respite.activityConfig.campFuelFindChance.label") : "Camp Fuel Find Chance"; },
                get hint() { return game.i18n?.localize ? game.i18n.localize("ionrift-respite.activityConfig.campFuelFindChance.hint") : "Chance each forage also grants kindling. 0 turns off the roll."; },
                type: "percentSlider",
                min: CAMP_FUEL_FIND_MIN_PERCENT,
                max: CAMP_FUEL_FIND_MAX_PERCENT,
                step: 1,
                requiresForaging: true
            },
            {
                key: "enableHunting",
                get label() { return game.i18n?.localize ? game.i18n.localize("ionrift-respite.activityConfig.enableHunting.label") : "Hunting"; },
                get hint() { return game.i18n?.localize ? game.i18n.localize("ionrift-respite.activityConfig.enableHunting.hint") : "Hunt game during rest. Off removes the activity."; }
            },
            {
                key: "homebrewProvisionOnly",
                get label() { return game.i18n?.localize ? game.i18n.localize("ionrift-respite.activityConfig.homebrewProvisionOnly.label") : "Homebrew Provisions Only"; },
                get hint() { return game.i18n?.localize ? game.i18n.localize("ionrift-respite.activityConfig.homebrewProvisionOnly.hint") : "Custom recipes and Respite Custom compendium only. Ignores shipped items, stubs, and imported packs."; }
            }
        ]
    }
];

export class ActivityConfigApp extends foundry.applications.api.ApplicationV2 {

    static DEFAULT_OPTIONS = {
        id: "respite-activity-config",
        window: {
            title: "ionrift-respite.activityConfig.windowTitle",
            icon: "fas fa-campground",
            resizable: false
        },
        position: { width: 720, height: "auto" },
        classes: ["ionrift-window"]
    };

    /** @override */
    async _prepareContext() {
        const foragingOn = isForagingEnabled();
        const showBrewingAlcohol = await shouldShowBrewingAlcoholSetting();

        const resolveBooleanRow = (row) => {
            const disabled = (row.requiresForaging && !foragingOn);
            const value = row.key === "enableForaging"
                ? foragingOn
                : row.key === "enableHunting"
                    ? isHuntingEnabled()
                    : game.settings.get(MODULE_ID, row.key);
            return {
                ...row,
                type: "boolean",
                value,
                disabled
            };
        };

        const resolveTravelChild = (child) => {
            if (child.type === "percentSlider") {
                const disabled = (child.requiresForaging && !foragingOn);
                const raw = game.settings.get(MODULE_ID, child.key);
                const value = typeof raw === "number" && !Number.isNaN(raw)
                    ? raw
                    : CAMP_FUEL_FIND_DEFAULT_PERCENT;
                return { ...child, value, disabled };
            }
            return resolveBooleanRow(child);
        };

        const rows = ACTIVITY_TOGGLES
            .filter(entry => !entry.requiresAlcoholBrewContent || showBrewingAlcohol)
            .map(entry => {
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

        return { rows };
    }

    /** @override */
    async _renderHTML(context) {
        const el = document.createElement("div");
        el.classList.add("respite-activity-config");

        const mainRows = context.rows.filter(row => row.type !== "group");
        const travelGroup = context.rows.find(row => row.type === "group" && row.id === "travel");

        let html = `
        <p class="activity-config-lead">${game.i18n.localize("ionrift-respite.activityConfig.lead")}</p>
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
                <i class="fas fa-save"></i> ${game.i18n.localize("ionrift-respite.activityConfig.save")}
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

        const syncTravelGroup = () => {
            const foragingCb = el.querySelector('.activity-config-cb[data-key="enableForaging"]');
            const foragingOn = !!foragingCb?.checked;
            const fuelRow = el.querySelector('.activity-config-row[data-key="campFuelFindChance"]');
            const fuelInput = fuelRow?.querySelector(".activity-config-range");
            if (fuelRow && fuelInput) {
                const childDisabled = !foragingOn;
                fuelRow.classList.toggle("activity-config-row--disabled", childDisabled);
                fuelInput.disabled = childDisabled;
            }
        };

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
                            if ((child.key === "enableForaging" || child.key === "enableHunting") && cb.checked) {
                                await game.settings.set(MODULE_ID, "useTravel", true);
                            }
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
        ui.notifications.info(game.i18n.localize("ionrift-respite.activityConfig.savedNotification"));
        this.close();
    }
}
