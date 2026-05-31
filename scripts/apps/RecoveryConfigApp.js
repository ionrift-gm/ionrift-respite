/**
 * RecoveryConfigApp
 * GM-only submenu for rest recovery mechanics.
 * Opens from the Foundry module settings panel via registerMenu.
 *
 * Handles a mix of input types: boolean toggles, dropdowns, and range sliders.
 * Uses Ionrift Glass theme (ionrift-window).
 */

const MODULE_ID = "ionrift-respite";

/** Recovery setting definitions — order = display order. */
const RECOVERY_SETTINGS = [
    {
        key: "enableComfort",
        label: "Comfort Rules",
        icon: "fas fa-thermometer-half",
        hint: "Terrain comfort tiers, fire mechanics, and gear-driven recovery modifiers. Disable for simplified rests with no comfort penalties, no fire phase, and no exhaustion saves.",
        type: "boolean"
    },
    {
        key: "armorDoffRule",
        label: "Armor Sleep Penalties",
        icon: "fas fa-shield-alt",
        hint: "Characters sleeping in medium or heavy armor recover fewer Hit Dice and cannot reduce exhaustion (Xanathar's). Characters on watch are exempt.",
        type: "boolean"
    },
    {
        key: "spellRecoveryMaxLevel",
        label: "Spell Recovery Max Level",
        icon: "fas fa-hat-wizard",
        hint: "Maximum spell slot level recoverable via Arcane Recovery and Natural Recovery. Default 5 matches 2014 rules. Increase for homebrew.",
        type: "range",
        min: 1,
        max: 9,
        step: 1
    },
    {
        key: "songOfRestTiming",
        label: "Song of Rest Timing",
        icon: "fas fa-music",
        hint: "When the Bard's Song of Rest bonus die is rolled and applied.",
        type: "select",
        choices: {
            endOfRest: "End of short rest (strict timing)",
            withFirstHitDie: "With first Hit Die (per character, immediate)"
        }
    },
    {
        key: "maxValueHitDice",
        label: "Max Value Hit Dice (Homebrew)",
        icon: "fas fa-dice-d20",
        hint: "During short rests, each Hit Die heals for the die's maximum roll plus CON modifier instead of a random roll. Optional, not RAW.",
        type: "boolean"
    }
];

export class RecoveryConfigApp extends foundry.applications.api.ApplicationV2 {

    static DEFAULT_OPTIONS = {
        id: "respite-recovery-config",
        window: {
            title: "Recovery Rules",
            icon: "fas fa-heart-pulse",
            resizable: false
        },
        position: { width: 440, height: "auto" },
        classes: ["ionrift-window"]
    };

    /** @override */
    async _prepareContext() {
        return {
            settings: RECOVERY_SETTINGS.map(s => ({
                ...s,
                value: game.settings.get(MODULE_ID, s.key)
            }))
        };
    }

    /** @override */
    async _renderHTML(context) {
        const el = document.createElement("div");
        el.classList.add("respite-settings-config");

        let html = `
        <div class="settings-config-header">
            <span class="settings-config-title">
                <i class="fas fa-heart-pulse"></i>
                Recovery Rules
            </span>
            <span class="settings-config-subtitle">
                Control how rest mechanically resolves for this world.
            </span>
        </div>
        <div class="settings-config-list">`;

        for (const setting of context.settings) {
            html += `
            <div class="settings-config-row" data-key="${setting.key}">
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

        html += `</div>
        <div class="settings-config-actions">
            <button type="button" class="settings-config-save-btn">
                <i class="fas fa-save"></i> Save
            </button>
        </div>`;

        el.innerHTML = html;
        this._wireEvents(el);
        return el;
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

        // Live range value display
        el.querySelectorAll(".settings-config-range").forEach(range => {
            range.addEventListener("input", () => {
                const display = el.querySelector(`.settings-config-range-val[data-key="${range.dataset.key}"]`);
                if (display) display.textContent = range.value;
            });
        });
    }

    async _onSave(el) {
        for (const setting of RECOVERY_SETTINGS) {
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
        ui.notifications.info("Recovery rules saved.");
        this.close();
    }
}
