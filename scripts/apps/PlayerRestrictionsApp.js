/**
 * PlayerRestrictionsApp
 * GM-only submenu for player restriction settings.
 * Opens from the Foundry module settings panel via registerMenu.
 *
 * All settings are boolean toggles. Uses Ionrift Glass theme (ionrift-window).
 */

const MODULE_ID = "ionrift-respite";

/** Player restriction definitions — order = display order. */
const RESTRICTION_TOGGLES = [
    {
        key: "interceptRests",
        label: "Intercept Player Rests",
        icon: "fas fa-hand-paper",
        hint: "Block the default Short/Long Rest buttons for players. Rests must go through the GM-managed Respite flow."
    },
    {
        key: "lockPlayerQuantity",
        label: "Lock Player Quantity Controls",
        icon: "fas fa-lock",
        hint: "Prevents players from adjusting item quantities on their character sheet. The GM can still modify quantities."
    },
    {
        key: "lockAttuneOutsideRest",
        label: "Lock Attunement to Rest",
        icon: "fas fa-gem",
        hint: "Players can only attune or de-attune items during an active rest. Outside of rest, the attunement toggle is disabled. RAW: attunement requires a short rest."
    }
];

export class PlayerRestrictionsApp extends foundry.applications.api.ApplicationV2 {

    static DEFAULT_OPTIONS = {
        id: "respite-player-restrictions",
        window: {
            title: "Player Restrictions",
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
        <div class="settings-config-header">
            <span class="settings-config-title">
                <i class="fas fa-user-lock"></i>
                Player Restrictions
            </span>
            <span class="settings-config-subtitle">
                Control what players can do outside the GM rest flow.
            </span>
        </div>
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
        el.querySelector(".settings-config-save-btn")?.addEventListener("click", () => this._onSave(el));
    }

    async _onSave(el) {
        const checkboxes = el.querySelectorAll(".settings-config-cb");
        for (const cb of checkboxes) {
            await game.settings.set(MODULE_ID, cb.dataset.key, cb.checked);
        }
        ui.notifications.info("Player restriction settings saved.");
        this.close();
    }
}
