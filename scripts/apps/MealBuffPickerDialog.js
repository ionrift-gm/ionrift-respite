/**
 * MealBuffPickerDialog
 * Scrollable buff preset picker for the homebrew recipe editor.
 */

import {
    formatMealBuffPresetSubtitle,
    formatMealBuffPresetTitle,
    getMealBuffPresetsForProfession,
    groupMealBuffPresetsByCategory
} from "../services/MealBuffPresets.js";

export class MealBuffPickerDialog extends foundry.applications.api.ApplicationV2 {

    #professionId = "cooking";
    #tier = "standard";
    #selectedPresetId = "none";
    /** @type {(presetId: string) => void|null} */
    #onSelect = null;

    static DEFAULT_OPTIONS = {
        id: "respite-meal-buff-picker",
        window: {
            title: "Choose buff",
            icon: "fas fa-star",
            resizable: true
        },
        position: { width: 540, height: 580 },
        classes: ["ionrift-window", "glass-ui", "ionrift-respite-app", "respite-meal-buff-picker"]
    };

    /**
     * @param {{ professionId: string, tier?: string, selectedPresetId?: string, onSelect?: (id: string) => void }} config
     * @param {Object} [options]
     */
    constructor(config = {}, options = {}) {
        super(options);
        this.#professionId = config.professionId ?? "cooking";
        this.#tier = config.tier ?? "standard";
        this.#selectedPresetId = config.selectedPresetId ?? "none";
        this.#onSelect = config.onSelect ?? null;
    }

    /** @override */
    async _prepareContext() {
        const sections = getMealBuffPresetsForProfession(this.#professionId, { tier: this.#tier });
        return {
            professionId: this.#professionId,
            tier: this.#tier,
            selectedPresetId: this.#selectedPresetId,
            baseGroups: groupMealBuffPresetsByCategory(sections.base),
            handlerGroups: groupMealBuffPresetsByCategory(sections.handlers),
            overlayGroups: groupMealBuffPresetsByCategory(sections.overlay),
            overlayPackLabel: sections.overlay[0]?._packLabel ?? null
        };
    }

    /** @override */
    async _renderHTML(context) {
        const el = document.createElement("div");
        el.classList.add("meal-buff-picker-body");
        el.innerHTML = this._buildMarkup(context);
        this._wireEvents(el);
        return el;
    }

    /** @override */
    _replaceHTML(result, content, _options) {
        content.replaceChildren(result);
    }

    _esc(value) {
        return foundry.utils.escapeHTML(String(value ?? ""));
    }

    _buildPresetButton(preset) {
        const title = formatMealBuffPresetTitle(preset);
        const subtitle = formatMealBuffPresetSubtitle(preset);
        const selected = preset.id === this.#selectedPresetId ? " meal-buff-picker-option--selected" : "";
        const sourceClass = preset._source === "overlay" ? " meal-buff-picker-option--pack" : "";
        const packBadge = preset._packLabel && preset._source !== "base"
            ? `<span class="meal-buff-picker-pack-badge">${this._esc(preset._packLabel)}</span>`
            : "";

        return `
            <button type="button" class="meal-buff-picker-option${selected}${sourceClass}"
                data-action="selectPreset" data-preset-id="${this._esc(preset.id)}"
                title="${this._esc(subtitle || title)}">
                <span class="meal-buff-picker-option-head">
                    <span class="meal-buff-picker-option-label">${this._esc(title)}</span>
                    ${packBadge}
                </span>
                ${subtitle ? `<span class="meal-buff-picker-option-desc">${this._esc(subtitle)}</span>` : ""}
            </button>`;
    }

    _buildGroupSection(heading, groups) {
        if (!groups.length) return "";
        return `
            <section class="meal-buff-picker-section">
                <div class="meal-buff-picker-section-title">${this._esc(heading)}</div>
                ${groups.map(group => `
                    <div class="meal-buff-picker-type-group">
                        <div class="meal-buff-picker-type-heading">${this._esc(group.label)}</div>
                        <div class="meal-buff-picker-options">
                            ${group.presets.map(preset => this._buildPresetButton(preset)).join("")}
                        </div>
                    </div>`).join("")}
            </section>`;
    }

    _buildMarkup(context) {
        const baseSection = this._buildGroupSection("Base presets", context.baseGroups);
        const handlerSection = context.handlerGroups.length
            ? this._buildGroupSection("Pack handlers", context.handlerGroups)
            : "";
        const overlayHeader = context.overlayGroups.length
            ? `<div class="meal-buff-picker-pack-header">
                    <span class="meal-buff-picker-pack-badge">${this._esc(context.overlayPackLabel ?? "Content pack")}</span>
                    <span class="meal-buff-picker-pack-note">Pack-only buffs not in base presets</span>
               </div>`
            : "";
        const overlaySection = context.overlayGroups.length
            ? `<section class="meal-buff-picker-section">
                    <div class="meal-buff-picker-section-title">Pack presets</div>
                    ${overlayHeader}
                    ${context.overlayGroups.map(group => `
                        <div class="meal-buff-picker-type-group">
                            <div class="meal-buff-picker-type-heading">${this._esc(group.label)}</div>
                            <div class="meal-buff-picker-options meal-buff-picker-options--pack">
                                ${group.presets.map(preset => this._buildPresetButton(preset)).join("")}
                            </div>
                        </div>`).join("")}
               </section>`
            : "";

        const empty = !baseSection && !handlerSection && !overlaySection;

        return `
            <p class="meal-buff-picker-lead">
                Buffs for <strong>${this._esc(context.professionId)}</strong>
                (${context.tier === "ambitious" ? "ambitious output" : "standard output"}).
                Only presets for this profession are listed.
            </p>
            <div class="meal-buff-picker-scroll">
                ${empty ? `<p class="meal-buff-picker-empty">No buff presets available for this profession.</p>` : ""}
                ${baseSection}
                ${handlerSection}
                ${overlaySection}
            </div>
            <p class="meal-buff-picker-hint">Custom buffs can still be set via JSON import.</p>`;
    }

    _wireEvents(el) {
        el.querySelectorAll("[data-action=\"selectPreset\"]").forEach(btn => {
            btn.addEventListener("click", () => {
                const presetId = btn.dataset.presetId;
                this.#onSelect?.(presetId);
                this.close();
            });
        });
    }
}
