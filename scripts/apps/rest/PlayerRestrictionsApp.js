/**
 * PlayerRestrictionsApp
 * GM-only submenu for player restriction settings.
 * Opens from the Foundry module settings panel via registerMenu.
 *
 * All settings are boolean toggles. Uses Ionrift Glass theme (ionrift-window).
 */

/** Player restriction definitions. Order = display order. */
import { MODULE_ID } from "../../data/moduleId.js";
const RESTRICTION_TOGGLES = [
    {
        key: "interceptRests",
        get label() { return game.i18n.localize("ionrift-respite.playerRestrictions.interceptRests.label"); },
        icon: "fas fa-hand-paper",
        get hint() { return game.i18n.localize("ionrift-respite.playerRestrictions.interceptRests.hint"); }
    },
    {
        key: "lockPlayerQuantity",
        get label() { return game.i18n.localize("ionrift-respite.playerRestrictions.lockPlayerQuantity.label"); },
        icon: "fas fa-lock",
        get hint() { return game.i18n.localize("ionrift-respite.playerRestrictions.lockPlayerQuantity.hint"); }
    },
    {
        key: "lockAttuneOutsideRest",
        get label() { return game.i18n.localize("ionrift-respite.playerRestrictions.lockAttuneOutsideRest.label"); },
        icon: "fas fa-gem",
        get hint() { return game.i18n.localize("ionrift-respite.playerRestrictions.lockAttuneOutsideRest.hint"); }
    }
];

export class PlayerRestrictionsApp extends foundry.applications.api.ApplicationV2 {

    static DEFAULT_OPTIONS = {
        id: "respite-player-restrictions",
        window: {
            title: "ionrift-respite.playerRestrictions.windowTitle",
            icon: "fas fa-user-lock",
            resizable: false
        },
        position: { width: 420, height: "auto" },
        classes: ["ionrift-window"]
    };

    /** @override */
    async _prepareContext() {
        return {
            toggles: RESTRICTION_TOGGLES.map(t => ({
                ...t,
                value: game.settings.get(MODULE_ID, t.key)
            }))
        };
    }

    /** @override */
    async _renderHTML(context) {
        const el = document.createElement("div");
        el.classList.add("respite-settings-config");

        let html = `
        <p class="settings-config-lead">${game.i18n.localize("ionrift-respite.playerRestrictions.lead")}</p>
        <div class="settings-config-list">`;

        for (const toggle of context.toggles) {
            html += `
            <div class="settings-config-row" data-key="${toggle.key}">
                <div class="settings-config-info">
                    <div class="settings-config-label">
                        <i class="${toggle.icon} settings-config-icon"></i>
                        ${toggle.label}
                    </div>
                    <div class="settings-config-hint">${toggle.hint}</div>
                </div>
                <label class="settings-config-toggle">
                    <input type="checkbox" class="settings-config-cb"
                           data-key="${toggle.key}"
                           ${toggle.value ? "checked" : ""} />
                    <span class="settings-config-slider"></span>
                </label>
            </div>`;
        }

        html += `</div>
        <div class="settings-config-actions">
            <button type="button" class="settings-config-save-btn">
                <i class="fas fa-save"></i> ${game.i18n.localize("ionrift-respite.playerRestrictions.save")}
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
        el.querySelector(".settings-config-save-btn")?.addEventListener("click", () => this._onSave(el));
    }

    async _onSave(el) {
        const checkboxes = el.querySelectorAll(".settings-config-cb");
        for (const cb of checkboxes) {
            await game.settings.set(MODULE_ID, cb.dataset.key, cb.checked);
        }
        ui.notifications.info(game.i18n.localize("ionrift-respite.playerRestrictions.savedNotice"));
        this.close();
    }
}
