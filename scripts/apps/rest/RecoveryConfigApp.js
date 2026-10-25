/**
 * RecoveryConfigApp
 * GM-only submenu for rest recovery mechanics.
 * Opens from the Foundry module settings panel via registerMenu.
 *
 * Handles a mix of input types: boolean toggles, dropdowns, and range sliders.
 * Uses Ionrift Glass theme (ionrift-window).
 */

/** Recovery sections and settings. Order = display order. */
import { MODULE_ID } from "../../data/moduleId.js";
const RECOVERY_SECTIONS = [
    {
        id: "longRest",
        get label() { return game.i18n.localize("ionrift-respite.recoveryConfig.longRest.label"); },
        icon: "fas fa-moon",
        get hint() { return game.i18n.localize("ionrift-respite.recoveryConfig.longRest.hint"); },
        settings: [
            {
                key: "enableComfort",
                get label() { return game.i18n.localize("ionrift-respite.recoveryConfig.enableComfort.label"); },
                icon: "fas fa-thermometer-half",
                get hint() { return game.i18n.localize("ionrift-respite.recoveryConfig.enableComfort.hint"); },
                type: "boolean"
            },
            {
                key: "enableCampfireMinigame",
                get label() { return game.i18n.localize("ionrift-respite.recoveryConfig.enableCampfireMinigame.label"); },
                icon: "fas fa-fire",
                get hint() { return game.i18n.localize("ionrift-respite.recoveryConfig.enableCampfireMinigame.hint"); },
                type: "boolean"
            },
            {
                key: "enableWorkbenchIdentify",
                get label() { return game.i18n.localize("ionrift-respite.recoveryConfig.enableWorkbenchIdentify.label"); },
                icon: "fas fa-search",
                get hint() { return game.i18n.localize("ionrift-respite.recoveryConfig.enableWorkbenchIdentify.hint"); },
                type: "boolean"
            },
            {
                key: "armorDoffRule",
                get label() { return game.i18n.localize("ionrift-respite.recoveryConfig.armorDoffRule.label"); },
                icon: "fas fa-shield-alt",
                get hint() { return game.i18n.localize("ionrift-respite.recoveryConfig.armorDoffRule.hint"); },
                type: "boolean"
            }
        ]
    },
    {
        id: "shortRest",
        get label() { return game.i18n.localize("ionrift-respite.recoveryConfig.shortRest.label"); },
        icon: "fas fa-hourglass-half",
        get hint() { return game.i18n.localize("ionrift-respite.recoveryConfig.shortRest.hint"); },
        settings: [
            {
                key: "spellRecoveryMaxLevel",
                get label() { return game.i18n.localize("ionrift-respite.recoveryConfig.spellRecoveryMaxLevel.label"); },
                icon: "fas fa-hat-wizard",
                get hint() { return game.i18n.localize("ionrift-respite.recoveryConfig.spellRecoveryMaxLevel.hint"); },
                type: "range",
                min: 1,
                max: 9,
                step: 1
            },
            {
                key: "songOfRestTiming",
                get label() { return game.i18n.localize("ionrift-respite.recoveryConfig.songOfRestTiming.label"); },
                icon: "fas fa-music",
                get hint() { return game.i18n.localize("ionrift-respite.recoveryConfig.songOfRestTiming.hint"); },
                type: "select",
                get choices() {
                    return {
                        endOfRest: game.i18n.localize("ionrift-respite.recoveryConfig.songOfRestTiming.choices.endOfRest"),
                        withFirstHitDie: game.i18n.localize("ionrift-respite.recoveryConfig.songOfRestTiming.choices.withFirstHitDie")
                    };
                }
            },
            {
                key: "maxValueHitDice",
                get label() { return game.i18n.localize("ionrift-respite.recoveryConfig.maxValueHitDice.label"); },
                icon: "fas fa-dice-d20",
                get hint() { return game.i18n.localize("ionrift-respite.recoveryConfig.maxValueHitDice.hint"); },
                type: "boolean"
            },
            {
                key: "chefTreatsProvideSustenance",
                get label() { return game.i18n.localize("ionrift-respite.recoveryConfig.chefTreatsProvideSustenance.label"); },
                icon: "fas fa-cookie-bite",
                get hint() { return game.i18n.localize("ionrift-respite.recoveryConfig.chefTreatsProvideSustenance.hint"); },
                type: "boolean"
            },
            {
                key: "shortRestFireWarmth",
                get label() { return game.i18n.localize("ionrift-respite.recoveryConfig.shortRestFireWarmth.label"); },
                icon: "fas fa-fire",
                get hint() { return game.i18n.localize("ionrift-respite.recoveryConfig.shortRestFireWarmth.hint"); },
                type: "select",
                get choices() {
                    return {
                        none: game.i18n.localize("ionrift-respite.recoveryConfig.shortRestFireWarmth.choices.none"),
                        "1": game.i18n.localize("ionrift-respite.recoveryConfig.shortRestFireWarmth.choices.n1"),
                        "1d4": game.i18n.localize("ionrift-respite.recoveryConfig.shortRestFireWarmth.choices.n1d4")
                    };
                }
            }
        ]
    }
];


function _allRecoverySettings() {
    return RECOVERY_SECTIONS.flatMap(section => section.settings);
}

export class RecoveryConfigApp extends foundry.applications.api.ApplicationV2 {

    static DEFAULT_OPTIONS = {
        id: "respite-recovery-config",
        window: {
            title: "ionrift-respite.recoveryConfig.windowTitle",
            icon: "fas fa-heart-pulse",
            resizable: false
        },
        position: { width: 720, height: "auto" },
        classes: ["ionrift-window"]
    };

    /** @override */
    async _prepareContext() {
        const resolveSetting = (setting) => ({
            ...setting,
            value: game.settings.get(MODULE_ID, setting.key)
        });

        return {
            sections: RECOVERY_SECTIONS.map(section => ({
                ...section,
                settings: section.settings.map(resolveSetting)
            }))
        };
    }

    /** @override */
    async _renderHTML(context) {
        const el = document.createElement("div");
        el.classList.add("respite-settings-config");

        const longRestSection = context.sections.find(s => s.id === "longRest");
        const shortRestSection = context.sections.find(s => s.id === "shortRest");

        let html = `
        <p class="settings-config-lead">${game.i18n.localize("ionrift-respite.recoveryConfig.lead")}</p>
        <div class="settings-config-layout">
            <div class="settings-config-column settings-config-column--long">`;

        if (longRestSection) {
            html += this._renderSection(longRestSection);
        }

        html += `
            </div>
            <div class="settings-config-column settings-config-column--short">`;

        if (shortRestSection) {
            html += this._renderSection(shortRestSection);
        }

        html += `
            </div>
        </div>
        <div class="settings-config-actions">
            <button type="button" class="settings-config-save-btn">
                <i class="fas fa-save"></i> ${game.i18n.localize("ionrift-respite.recoveryConfig.save")}
            </button>
        </div>`;

        el.innerHTML = html;
        this._wireEvents(el);
        return el;
    }

    _renderSection(section) {
        let html = `
            <div class="settings-config-section" data-section="${section.id}">
                <div class="settings-config-section-header">
                    <i class="${section.icon} settings-config-icon"></i>
                    <div class="settings-config-section-heading">
                        <div class="settings-config-section-label">${section.label}</div>
                        <div class="settings-config-hint">${section.hint}</div>
                    </div>
                </div>
                <div class="settings-config-section-body">`;

        for (const setting of section.settings) {
            html += `
                <div class="settings-config-row settings-config-row--sub" data-key="${setting.key}">
                    <div class="settings-config-info">
                        <div class="settings-config-label">
                            <i class="${setting.icon} settings-config-icon"></i>
                            ${setting.label}
                        </div>
                        <div class="settings-config-hint">${setting.hint}</div>
                    </div>
                    ${this._renderControl(setting)}
                </div>`;
        }

        html += `
                </div>
            </div>`;
        return html;
    }

    _renderControl(setting) {
        if (setting.type === "boolean") {
            return `
            <label class="settings-config-toggle">
                <input type="checkbox" class="settings-config-cb"
                       data-key="${setting.key}"
                       ${setting.value ? "checked" : ""} />
                <span class="settings-config-slider"></span>
            </label>`;
        }
        if (setting.type === "select") {
            const options = Object.entries(setting.choices)
                .map(([k, v]) => `<option value="${k}" ${setting.value === k ? "selected" : ""}>${v}</option>`)
                .join("");
            return `<select class="settings-config-select" data-key="${setting.key}">${options}</select>`;
        }
        if (setting.type === "range") {
            return `
            <div class="settings-config-range-wrap">
                <input type="range" class="settings-config-range" data-key="${setting.key}"
                       min="${setting.min}" max="${setting.max}" step="${setting.step}"
                       value="${setting.value}" />
                <span class="settings-config-range-val" data-key="${setting.key}">${setting.value}</span>
            </div>`;
        }
        return "";
    }

    /** @override */
    _replaceHTML(result, content, _options) {
        content.replaceChildren(result);
    }

    _wireEvents(el) {
        el.querySelector(".settings-config-save-btn")?.addEventListener("click", () => this._onSave(el));

        el.querySelectorAll(".settings-config-range").forEach(range => {
            range.addEventListener("input", () => {
                const display = el.querySelector(`.settings-config-range-val[data-key="${range.dataset.key}"]`);
                if (display) display.textContent = range.value;
            });
        });
    }

    async _onSave(el) {
        for (const setting of _allRecoverySettings()) {
            if (setting.type === "boolean") {
                const cb = el.querySelector(`.settings-config-cb[data-key="${setting.key}"]`);
                if (cb) await game.settings.set(MODULE_ID, setting.key, cb.checked);
            } else if (setting.type === "select") {
                const sel = el.querySelector(`.settings-config-select[data-key="${setting.key}"]`);
                if (sel) await game.settings.set(MODULE_ID, setting.key, sel.value);
            } else if (setting.type === "range") {
                const range = el.querySelector(`.settings-config-range[data-key="${setting.key}"]`);
                if (range) await game.settings.set(MODULE_ID, setting.key, Number(range.value));
            }
        }
        ui.notifications.info(game.i18n.localize("ionrift-respite.recoveryConfig.savedNotice"));
        this.close();
    }
}
