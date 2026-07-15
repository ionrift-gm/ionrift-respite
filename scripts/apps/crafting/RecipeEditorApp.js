/**
 * RecipeEditorApp
 * GM-only editor for custom profession recipes (world setting JSON).
 */

import {
    CUSTOM_RECIPE_MAX_PER_PROFESSION,
    applyCustomRecipesToEngine,
    applyProfessionToolToRecipe,
    describeRecipeSaveOverwrite,
    getHomebrewProfessionOptions,
    getProfessionToolRequired,
    HOMEBREW_PROFESSION_DISPLAY,
    sanitizeCustomRecipes,
    TOOL_PROFICIENCY_LABELS,
    validateCustomRecipe
} from "../../services/crafting/recipes/RecipeCatalog.js";
import {
    applyMealBuffPresetToFlags,
    buildSatiatesList,
    defaultFoodTagForProfession,
    defaultSatiatesForProfession,
    formatMealBuffPreview,
    formatMealBuffPresetTitle,
    FOOD_TAG_OPTIONS,
    getMealBuffPreset,
    getMealBuffPresetAttribution,
    getMealBuffPresetsForProfession,
    matchMealBuffPresetId
} from "../../services/meal/buffs/MealBuffPresets.js";
import { MealBuffPickerDialog } from "../meal/MealBuffPickerDialog.js";
import {
    buildRecipeMissingOutputIndex,
    formatSyncError,
    openCustomOutputCompendiumItem,
    outputFolderNameForProfession,
    resolveRecipeOutputNameOnSave,
    syncRecipeOutputsToCompendium
} from "../../services/crafting/recipes/RecipeOutputCompendium.js";
import { PROVISIONS_CUSTOM_PACK_ID } from "../../services/meal/provisions/ProvisionsCustomPack.js";
import { SKILL_NAMES } from "../../data/RestConstants.js";
import { MODULE_ID } from "../../data/moduleId.js";

const MEAL_EFFECT_PROFESSIONS = new Set(["cooking", "brewing"]);

/** Skills plus ability checks (brewing stubs use wis). */
const RECIPE_CHECK_KEYS = {
    ...SKILL_NAMES,
    str: "Strength",
    dex: "Dexterity",
    con: "Constitution",
    int: "Intelligence",
    wis: "Wisdom",
    cha: "Charisma"
};

const PROFESSION_LABELS = Object.fromEntries(
    Object.entries(HOMEBREW_PROFESSION_DISPLAY).map(([id, meta]) => [id, meta.label])
);

const PROFESSION_ICONS = Object.fromEntries(
    Object.entries(HOMEBREW_PROFESSION_DISPLAY).map(([id, meta]) => [id, meta.icon])
);

export class RecipeEditorApp extends foundry.applications.api.ApplicationV2 {

    #professionId = "cooking";
    #selectedIndex = 0;
    #draft = null;
    #flashSavedIndex = null;

    static DEFAULT_OPTIONS = {
        id: "respite-recipe-editor",
        window: {
            title: "Custom Recipes",
            icon: "fas fa-mortar-pestle",
            resizable: true
        },
        position: { width: 720, height: 680 },
        classes: ["ionrift-window", "glass-ui", "ionrift-respite-app"]
    };

    /** @override */
    async _prepareContext() {
        const homebrewProfessionOptions = await getHomebrewProfessionOptions();
        if (!homebrewProfessionOptions.some(option => option.id === this.#professionId)) {
            this.#professionId = homebrewProfessionOptions[0]?.id ?? "cooking";
        }
        const stored = game.settings.get(MODULE_ID, "customRecipes") ?? {};
        const recipes = stored[this.#professionId] ?? [];
        const selected = this.#selectedIndex >= 0 ? recipes[this.#selectedIndex] ?? null : null;
        const isNewDraft = this.#selectedIndex < 0 || !selected;
        const pack = game.packs.get(PROVISIONS_CUSTOM_PACK_ID);
        const missingOutputIndices = await buildRecipeMissingOutputIndex(pack, recipes);

        return {
            professionId: this.#professionId,
            professionIcon: PROFESSION_ICONS[this.#professionId] ?? "fas fa-hammer",
            professionOptions: homebrewProfessionOptions.map(option => ({
                id: option.id,
                label: option.label,
                packSource: option.packSource,
                selected: option.id === this.#professionId
            })),
            recipes,
            selectedIndex: this.#selectedIndex,
            selected,
            isNewDraft,
            draft: this.#draft ?? selected ?? this._blankRecipe(),
            maxRecipes: CUSTOM_RECIPE_MAX_PER_PROFESSION,
            missingOutputIndices,
            selectedOutputMissing: !isNewDraft && missingOutputIndices.has(this.#selectedIndex)
        };
    }

    /** @override */
    async _renderHTML(context) {
        const el = document.createElement("div");
        el.classList.add("respite-recipe-editor");
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

    _stripHtmlForTextarea(html) {
        if (!html) return "";
        return String(html)
            .replace(/<br\s*\/?>/gi, "\n")
            .replace(/<\/p>\s*<p>/gi, "\n\n")
            .replace(/<[^>]+>/g, "")
            .trim();
    }

    _wrapDescription(text) {
        const trimmed = String(text ?? "").trim();
        if (!trimmed) return "";
        if (trimmed.startsWith("<")) return trimmed;
        return `<p>${trimmed}</p>`;
    }

    _buildSkillOptions(selectedKey) {
        const keys = Object.keys(RECIPE_CHECK_KEYS).sort((a, b) =>
            RECIPE_CHECK_KEYS[a].localeCompare(RECIPE_CHECK_KEYS[b])
        );
        let html = "";
        if (selectedKey && !RECIPE_CHECK_KEYS[selectedKey]) {
            html += `<option value="${this._esc(selectedKey)}" selected>${this._esc(selectedKey)}</option>`;
        }
        for (const key of keys) {
            const selected = key === selectedKey ? " selected" : "";
            html += `<option value="${this._esc(key)}"${selected}>${this._esc(RECIPE_CHECK_KEYS[key])}</option>`;
        }
        return html;
    }

    _isMealProfession(professionId) {
        return MEAL_EFFECT_PROFESSIONS.has(professionId);
    }

    _hasOutputBuffEffects(professionId) {
        if (MEAL_EFFECT_PROFESSIONS.has(professionId)) return true;
        const presets = getMealBuffPresetsForProfession(professionId);
        return presets.handlers.length > 0 || presets.overlay.length > 0;
    }

    _mealFieldPrefix(tier) {
        return tier === "ambitious" ? "ambMeal" : "meal";
    }

    _mealBuffSummaryText(presetId, rf) {
        if (presetId === "custom") {
            const preview = formatMealBuffPreview(rf?.buff);
            if (preview) {
                const parts = [preview.label];
                if (preview.formula) parts.push(preview.formula);
                if (preview.duration) parts.push(preview.duration);
                return parts.join(" · ");
            }
            return rf?.wellFed ? "Custom Well Fed (JSON)" : "No buff";
        }
        const preset = getMealBuffPreset(presetId);
        return formatMealBuffPresetTitle(preset);
    }

    _mealBuffAttributionMarkup(presetId) {
        const attribution = getMealBuffPresetAttribution(presetId);
        if (!attribution) return "";
        return `<span class="recipe-editor-buff-pack-badge" title="Preset from ${this._esc(attribution.packLabel)}">${this._esc(attribution.packLabel)}</span>`;
    }

    _openBuffPicker(el, tier) {
        const prefix = this._mealFieldPrefix(tier);
        const presetId = el.querySelector(`[name="${prefix}BuffPresetId"]`)?.value ?? "none";
        const dialog = new MealBuffPickerDialog({
            professionId: this.#professionId,
            tier,
            selectedPresetId: presetId,
            onSelect: selectedId => {
                const draft = this._readFormDraft(el);
                const flagsKey = tier === "ambitious" ? "ambitiousOutputFlags" : "outputFlags";
                if (!draft[flagsKey]) draft[flagsKey] = foundry.utils.deepClone(this._defaultOutputFlags());
                const rf = draft[flagsKey][MODULE_ID] ?? {};
                draft[flagsKey][MODULE_ID] = rf;
                applyMealBuffPresetToFlags(rf, selectedId);

                const section = el.querySelector(`[data-meal-tier="${tier}"]`);
                this._syncMealTierDom(section, rf, selectedId);
                this.#draft = draft;
            }
        });
        dialog.render(true);
    }

    _syncMealTierDom(section, rf, presetId) {
        if (!section) return;
        const tier = section.dataset.mealTier;
        const prefix = this._mealFieldPrefix(tier);
        const satiates = Array.isArray(rf?.satiates) ? rf.satiates : defaultSatiatesForProfession(this.#professionId);
        const foodTag = rf?.foodTag ?? defaultFoodTagForProfession(this.#professionId);
        const spoilsVal = rf?.spoilsAfter ?? "";

        const partyMeal = section.querySelector(`[name="${prefix}PartyMeal"]`);
        if (partyMeal) partyMeal.checked = rf?.partyMeal === true;

        const satiatesFood = section.querySelector(`[name="${prefix}SatiatesFood"]`);
        if (satiatesFood) satiatesFood.checked = satiates.includes("food");

        const satiatesWater = section.querySelector(`[name="${prefix}SatiatesWater"]`);
        if (satiatesWater) satiatesWater.checked = satiates.includes("water");

        const foodTagSelect = section.querySelector(`[name="${prefix}FoodTag"]`);
        if (foodTagSelect) foodTagSelect.value = foodTag;

        const spoilsInput = section.querySelector(`[name="${prefix}SpoilsAfter"]`);
        if (spoilsInput) spoilsInput.value = spoilsVal === null || spoilsVal === undefined ? "" : String(spoilsVal);

        const hidden = section.querySelector(`[name="${prefix}BuffPresetId"]`);
        if (hidden) hidden.value = presetId;

        const summaryEl = section.querySelector(".recipe-editor-buff-summary-text");
        if (summaryEl) summaryEl.textContent = this._mealBuffSummaryText(presetId, rf);

        const badgeEl = section.querySelector(".recipe-editor-buff-pack-attribution");
        if (badgeEl) {
            badgeEl.innerHTML = this._mealBuffAttributionMarkup(presetId);
        }
    }

    _buildMealEffectsMarkup(tier, rf, professionId) {
        const prefix = this._mealFieldPrefix(tier);
        const presetId = matchMealBuffPresetId(rf);
        const showMealFields = this._isMealProfession(professionId);
        const satiates = Array.isArray(rf?.satiates)
            ? rf.satiates
            : defaultSatiatesForProfession(professionId);
        const foodTag = rf?.foodTag ?? defaultFoodTagForProfession(professionId);
        const spoilsVal = rf?.spoilsAfter ?? "";
        const spoilsAttr = spoilsVal === null || spoilsVal === undefined ? "" : String(spoilsVal);
        const partyMeal = rf?.partyMeal === true;
        const satiatesFood = satiates.includes("food");
        const satiatesWater = satiates.includes("water");
        const summary = this._mealBuffSummaryText(presetId, rf);
        const tierLabel = tier === "ambitious"
            ? (showMealFields ? "Ambitious meal effects" : "Ambitious output effects")
            : (showMealFields ? "Meal effects" : "Output effects");
        const tierHint = tier === "ambitious"
            ? "Applied when players craft at Ambitious risk (+5 DC)."
            : (showMealFields
                ? "Applied when the crafted item is eaten or used in the meal phase."
                : "Applied when the crafted item is consumed or used.");

        const foodTagOptions = FOOD_TAG_OPTIONS.map(opt => {
            const selected = opt.id === foodTag ? " selected" : "";
            return `<option value="${this._esc(opt.id)}"${selected}>${this._esc(opt.label)}</option>`;
        }).join("");

        const attributionMarkup = this._mealBuffAttributionMarkup(presetId);
        const mealFieldsMarkup = showMealFields ? `
            <div class="recipe-editor-meal-toggles">
                <label class="recipe-editor-check">
                    <input type="checkbox" name="${prefix}PartyMeal" ${partyMeal ? "checked" : ""} />
                    <span>Party meal</span>
                </label>
                <label class="recipe-editor-check">
                    <input type="checkbox" name="${prefix}SatiatesFood" ${satiatesFood ? "checked" : ""} />
                    <span>Satiates food</span>
                </label>
                <label class="recipe-editor-check">
                    <input type="checkbox" name="${prefix}SatiatesWater" ${satiatesWater ? "checked" : ""} />
                    <span>Satiates water</span>
                </label>
            </div>
            <div class="recipe-editor-fields recipe-editor-fields--double">
                <div class="recipe-editor-field">
                    <label class="recipe-editor-label">Food tag</label>
                    <select class="recipe-editor-select" name="${prefix}FoodTag">${foodTagOptions}</select>
                </div>
                <div class="recipe-editor-field">
                    <label class="recipe-editor-label">Spoils after (rests)</label>
                    <input type="number" class="recipe-editor-input" name="${prefix}SpoilsAfter"
                        min="1" placeholder="Never" value="${this._esc(spoilsAttr)}" />
                </div>
            </div>` : "";

        return `
        <div class="recipe-editor-section recipe-editor-section--meal" data-meal-tier="${tier}">
            <div class="recipe-editor-section-title">${this._esc(tierLabel)}</div>
            <p class="recipe-editor-hint">${this._esc(tierHint)}</p>
            ${mealFieldsMarkup}
            <div class="recipe-editor-buff-row">
                <div class="recipe-editor-buff-summary">
                    <span class="recipe-editor-label">Buff</span>
                    <div class="recipe-editor-buff-summary-line">
                        <span class="recipe-editor-buff-summary-text">${this._esc(summary)}</span>
                        <span class="recipe-editor-buff-pack-attribution">${attributionMarkup}</span>
                    </div>
                </div>
                <input type="hidden" name="${prefix}BuffPresetId" value="${this._esc(presetId)}" />
                <button type="button" class="recipe-editor-btn recipe-editor-btn--ghost"
                    data-action="openBuffPicker" data-tier="${tier}">
                    <i class="fas fa-star"></i> Choose buff
                </button>
            </div>
        </div>`;
    }

    _buildMarkup(context) {
        const draft = context.draft;
        const skillVal = draft.skill ?? "sur";
        const outputName = draft.output?.name ?? "";
        const outputQty = draft.output?.quantity ?? 1;
        const outputImg = draft.output?.img ?? "icons/consumables/food/bowl-stew-brown.webp";
        const outputDesc = draft.output?.description ?? "";
        const outputCompendiumId = draft.output?.compendiumId ?? "";
        const outputFolderLabel = outputFolderNameForProfession(context.professionId);
        const hasAmbitious = Boolean(draft.ambitiousOutput);
        const ambName = draft.ambitiousOutput?.name ?? "";
        const ambQty = draft.ambitiousOutput?.quantity ?? 1;
        const ambImg = draft.ambitiousOutput?.img ?? outputImg;
        const ambDesc = draft.ambitiousOutput?.description ?? "";
        const ambCompendiumId = draft.ambitiousOutput?.compendiumId ?? "";
        const profLabel = PROFESSION_LABELS[context.professionId] ?? context.professionId;
        const toolKey = getProfessionToolRequired(context.professionId);
        const toolLabel = toolKey
            ? (TOOL_PROFICIENCY_LABELS[toolKey] ?? toolKey)
            : null;

        let recipeListHtml = "";
        if (context.recipes.length) {
            for (let i = 0; i < context.recipes.length; i++) {
                const r = context.recipes[i];
                const active = i === context.selectedIndex && !context.isNewDraft ? " active" : "";
                const flash = i === this.#flashSavedIndex ? " recipe-editor-list-item--saved-flash" : "";
                const outputImg = r.output?.img
                    ?? "icons/consumables/food/bowl-stew-brown.webp";
                const missingOutput = context.missingOutputIndices?.has(i);
                const missingBadge = missingOutput
                    ? `<span class="recipe-editor-list-warn" title="Output missing from compendium. Save recipe to recreate."><i class="fas fa-unlink" aria-hidden="true"></i></span>`
                    : "";
                recipeListHtml += `
                <button type="button" class="recipe-editor-list-item${active}${flash}"
                    data-action="selectRecipe" data-index="${i}">
                    <img class="recipe-editor-list-icon" src="${this._esc(outputImg)}" alt="" />
                    <span class="recipe-editor-list-name">${this._esc(r.name)}</span>
                    ${missingBadge}
                    <span class="recipe-editor-list-meta">DC ${r.dc}</span>
                </button>`;
            }
        } else {
            recipeListHtml = `
                <p class="recipe-editor-empty">
                    <i class="fas fa-mortar-pestle"></i>
                    No custom recipes yet.
                </p>`;
        }

        let ingredientsHtml = "";
        const ingredients = (draft.ingredients?.length ? draft.ingredients : [{ name: "", quantity: 1 }]);
        const canRemoveIngredient = ingredients.length > 1;
        for (let i = 0; i < ingredients.length; i++) {
            const ing = ingredients[i];
            const removeBtn = canRemoveIngredient ? `
                <button type="button" class="recipe-editor-ingredient-remove" data-action="removeIngredient"
                    data-ing-index="${i}" title="Remove ingredient" aria-label="Remove ingredient">
                    <i class="fas fa-times"></i>
                </button>` : "";
            ingredientsHtml += `
            <div class="recipe-editor-ingredient-row" data-ing-index="${i}">
                <input type="text" class="recipe-editor-input" name="ingName"
                    value="${this._esc(ing.name)}" placeholder="Compendium item name" />
                <input type="number" class="recipe-editor-input recipe-editor-input--qty" name="ingQty"
                    min="1" value="${ing.quantity ?? 1}" aria-label="Quantity" />
                ${removeBtn}
            </div>`;
        }

        const professionOptions = context.professionOptions.map(o => {
            const selected = o.selected ? " selected" : "";
            return `<option value="${this._esc(o.id)}"${selected}>${this._esc(o.label)}</option>`;
        }).join("");

        const deleteDisabled = context.selected && !context.isNewDraft ? "" : " disabled";
        const newRecipeActive = context.isNewDraft ? " active" : "";
        const showOutputBuffEffects = this._hasOutputBuffEffects(context.professionId);
        const stdRf = draft.outputFlags?.[MODULE_ID] ?? {};
        const ambRf = draft.ambitiousOutputFlags?.[MODULE_ID]
            ?? foundry.utils.deepClone(stdRf);

        return `
        <p class="recipe-editor-lead">
            Homebrew recipes for this world. Match ingredient names to compendium items
            (Forage or Reagents). Saving creates or updates output items in
            <strong>Respite Custom Items ,  ${this._esc(outputFolderLabel)}</strong>.
            Deleting a recipe here does not remove its compendium item. Export or import JSON for bulk edits.
        </p>
        <div class="recipe-editor-filter">
            <label class="recipe-editor-filter-label">
                <i class="${context.professionIcon}"></i> Profession
            </label>
            <select class="recipe-editor-select" data-action="changeProfession">${professionOptions}</select>
            <span class="recipe-editor-count">${context.recipes.length}/${context.maxRecipes}</span>
        </div>
        <div class="recipe-editor-layout">
            <aside class="recipe-editor-list" aria-label="Recipe list">
                <div class="recipe-editor-list-heading">${this._esc(profLabel)} recipes</div>
                ${recipeListHtml}
                <button type="button" class="recipe-editor-list-new${newRecipeActive}" data-action="newRecipe">
                    <i class="fas fa-plus"></i> New recipe
                </button>
            </aside>
            <section class="recipe-editor-detail">
                ${context.isNewDraft ? `
                <p class="recipe-editor-draft-note">
                    <i class="fas fa-pen" aria-hidden="true"></i>
                    Unsaved draft. Nothing is added to the list until you save.
                </p>` : ""}
                <div class="recipe-editor-section">
                    <div class="recipe-editor-section-title">Recipe</div>
                    <div class="recipe-editor-fields recipe-editor-fields--triple">
                        <div class="recipe-editor-field">
                            <label class="recipe-editor-label">Name</label>
                            <input type="text" class="recipe-editor-input" name="name"
                                value="${this._esc(draft.name)}" placeholder="Camp stew" />
                        </div>
                        <div class="recipe-editor-field">
                            <label class="recipe-editor-label">DC</label>
                            <input type="number" class="recipe-editor-input" name="dc"
                                min="1" value="${draft.dc ?? 12}" />
                        </div>
                        <div class="recipe-editor-field">
                            <label class="recipe-editor-label">Skill</label>
                            <select class="recipe-editor-select" name="skill"
                                aria-label="Skill check">${this._buildSkillOptions(skillVal)}</select>
                        </div>
                    </div>
                    ${toolLabel ? `
                    <div class="recipe-editor-fields recipe-editor-fields--double">
                        <div class="recipe-editor-field">
                            <label class="recipe-editor-label">Tool proficiency</label>
                            <div class="recipe-editor-locked-value" title="Set by profession">
                                <i class="fas fa-lock" aria-hidden="true"></i>
                                <span>${this._esc(toolLabel)}</span>
                            </div>
                        </div>
                    </div>` : ""}
                </div>
                <div class="recipe-editor-section">
                    <div class="recipe-editor-section-title">Ingredients</div>
                    <p class="recipe-editor-hint">Names must match items in the party inventory or compendium.</p>
                    <div class="recipe-editor-ingredients">${ingredientsHtml}</div>
                    <button type="button" class="recipe-editor-btn recipe-editor-btn--ghost" data-action="addIngredient">
                        <i class="fas fa-plus"></i> Add ingredient
                    </button>
                </div>
                ${context.selectedOutputMissing ? `
                <p class="recipe-editor-sync-warn">
                    <i class="fas fa-unlink" aria-hidden="true"></i>
                    Compendium output missing. Save this recipe to recreate it in ${this._esc(outputFolderLabel)}.
                </p>` : ""}
                <div class="recipe-editor-section">
                    <div class="recipe-editor-section-title">Standard output</div>
                    <p class="recipe-editor-hint">Granted on a normal craft roll (Standard risk). Saved as a compendium item in ${this._esc(outputFolderLabel)}.</p>
                    <div class="recipe-editor-img-row">
                        <img class="recipe-editor-img-preview" src="${this._esc(outputImg)}" alt="" />
                        <input type="hidden" name="outputImg" value="${this._esc(outputImg)}" />
                        <button type="button" class="recipe-editor-btn recipe-editor-btn--ghost"
                            data-action="pickOutputImg">
                            <i class="fas fa-image"></i> Choose image
                        </button>
                        ${outputCompendiumId ? `
                        <button type="button" class="recipe-editor-btn recipe-editor-btn--ghost"
                            data-action="openStdOutput" data-compendium-id="${this._esc(outputCompendiumId)}">
                            <i class="fas fa-book"></i> Open compendium item
                        </button>` : ""}
                    </div>
                    <div class="recipe-editor-fields recipe-editor-fields--double">
                        <div class="recipe-editor-field">
                            <label class="recipe-editor-label">Item name</label>
                            <input type="text" class="recipe-editor-input" name="outputName"
                                value="${this._esc(outputName)}" placeholder="Matches recipe name unless changed" />
                        </div>
                        <div class="recipe-editor-field">
                            <label class="recipe-editor-label">Quantity</label>
                            <input type="number" class="recipe-editor-input" name="outputQty"
                                min="1" value="${outputQty}" />
                        </div>
                    </div>
                    <div class="recipe-editor-field recipe-editor-field--full">
                        <label class="recipe-editor-label">Item description</label>
                        <textarea class="recipe-editor-textarea" name="outputDesc" rows="2"
                            placeholder="Flavor text shown on the compendium item and crafted inventory row.">${this._esc(this._stripHtmlForTextarea(outputDesc))}</textarea>
                    </div>
                    ${showOutputBuffEffects ? this._buildMealEffectsMarkup("standard", stdRf, context.professionId) : ""}
                </div>
                <div class="recipe-editor-section">
                    <label class="recipe-editor-ambitious-toggle">
                        <input type="checkbox" name="enableAmbitious" ${hasAmbitious ? "checked" : ""} />
                        <span class="recipe-editor-ambitious-copy">
                            <span class="recipe-editor-ambitious-title">Ambitious output</span>
                            <span class="recipe-editor-hint">Players can pick Ambitious (+5 DC) at craft time for this upgraded item.</span>
                        </span>
                    </label>
                    <div class="recipe-editor-ambitious-fields${hasAmbitious ? "" : " is-hidden"}">
                        <div class="recipe-editor-img-row">
                            <img class="recipe-editor-img-preview recipe-editor-img-preview--amb" src="${this._esc(ambImg)}" alt="" />
                            <input type="hidden" name="ambOutputImg" value="${this._esc(ambImg)}" />
                            <button type="button" class="recipe-editor-btn recipe-editor-btn--ghost"
                                data-action="pickAmbOutputImg">
                                <i class="fas fa-image"></i> Choose image
                            </button>
                            ${ambCompendiumId ? `
                            <button type="button" class="recipe-editor-btn recipe-editor-btn--ghost"
                                data-action="openAmbOutput" data-compendium-id="${this._esc(ambCompendiumId)}">
                                <i class="fas fa-book"></i> Open compendium item
                            </button>` : ""}
                        </div>
                        <div class="recipe-editor-fields recipe-editor-fields--double">
                            <div class="recipe-editor-field">
                                <label class="recipe-editor-label">Upgraded item name</label>
                                <input type="text" class="recipe-editor-input" name="ambOutputName"
                                    value="${this._esc(ambName)}" placeholder="Rich hunter's stew" />
                            </div>
                            <div class="recipe-editor-field">
                                <label class="recipe-editor-label">Quantity</label>
                                <input type="number" class="recipe-editor-input" name="ambOutputQty"
                                    min="1" value="${ambQty}" />
                            </div>
                        </div>
                        <div class="recipe-editor-field recipe-editor-field--full">
                            <label class="recipe-editor-label">Item description</label>
                            <textarea class="recipe-editor-textarea" name="ambOutputDesc" rows="2"
                                placeholder="Flavor text for the upgraded compendium item.">${this._esc(this._stripHtmlForTextarea(ambDesc))}</textarea>
                        </div>
                        ${showOutputBuffEffects ? this._buildMealEffectsMarkup("ambitious", ambRf, context.professionId) : ""}
                    </div>
                </div>
            </section>
        </div>
        <footer class="recipe-editor-footer">
            <div class="recipe-editor-footer-left">
                <button type="button" class="recipe-editor-btn recipe-editor-btn--ghost"
                    data-action="exportJson"><i class="fas fa-download"></i> Export</button>
                <button type="button" class="recipe-editor-btn recipe-editor-btn--ghost"
                    data-action="importJson"><i class="fas fa-upload"></i> Import</button>
                <button type="button" class="recipe-editor-btn recipe-editor-btn--danger"
                    data-action="deleteRecipe"${deleteDisabled}>
                    <i class="fas fa-trash"></i> Delete
                </button>
            </div>
            <button type="button" class="recipe-editor-btn recipe-editor-btn--primary" data-action="saveRecipe">
                <i class="fas fa-save"></i> Save recipe
            </button>
        </footer>`;
    }

    static _recipeEditorHookRegistered = false;

    _wireEvents(el) {
        if (!RecipeEditorApp._recipeEditorHookRegistered) {
            RecipeEditorApp._recipeEditorHookRegistered = true;
            const refreshOpenEditors = () => {
                for (const app of Object.values(ui.windows ?? {})) {
                    if (app instanceof RecipeEditorApp && app.rendered) app.render(false);
                }
            };
            Hooks.on("ionrift.mealBuffPresetsChanged", refreshOpenEditors);
            Hooks.on("ionrift.overlayContentChanged", async payload => {
                if (payload?.moduleId !== MODULE_ID) return;
                const { OverlayProfessionLoader } = await import("../../services/packs/overlays/OverlayProfessionLoader.js");
                OverlayProfessionLoader.invalidate();
                refreshOpenEditors();
            });
        }

        el.querySelector("[data-action=\"changeProfession\"]")?.addEventListener("change", ev => {
            this.#professionId = ev.target.value;
            this.#selectedIndex = 0;
            this.#draft = null;
            this.render();
        });

        el.querySelectorAll("[data-action=\"selectRecipe\"]").forEach(btn => {
            btn.addEventListener("click", () => {
                this.#selectedIndex = Number(btn.dataset.index);
                this.#draft = null;
                this.render();
            });
        });

        el.querySelector("[data-action=\"newRecipe\"]")?.addEventListener("click", () => {
            this.#draft = this._blankRecipe();
            this.#selectedIndex = -1;
            this.render();
        });

        const recipeNameInput = el.querySelector("[name=\"name\"]");
        const outputNameInput = el.querySelector("[name=\"outputName\"]");
        recipeNameInput?.addEventListener("input", () => {
            if (!outputNameInput) return;
            const baseline = this.#draft
                ?? game.settings.get(MODULE_ID, "customRecipes")?.[this.#professionId]?.[this.#selectedIndex]
                ?? null;
            const nextOutput = resolveRecipeOutputNameOnSave(
                baseline?.name,
                baseline?.output?.name,
                recipeNameInput.value,
                outputNameInput.value
            );
            if (nextOutput !== outputNameInput.value) {
                outputNameInput.value = nextOutput;
            }
        });

        el.querySelector("[data-action=\"addIngredient\"]")?.addEventListener("click", () => {
            const draft = this._readFormDraft(el);
            draft.ingredients.push({ name: "", quantity: 1 });
            this.#draft = draft;
            this.render();
        });

        el.querySelectorAll("[data-action=\"removeIngredient\"]").forEach(btn => {
            btn.addEventListener("click", () => {
                const draft = this._readFormDraft(el);
                if (draft.ingredients.length <= 1) return;
                const idx = Number(btn.dataset.ingIndex);
                if (idx >= 0 && idx < draft.ingredients.length) {
                    draft.ingredients.splice(idx, 1);
                }
                this.#draft = draft;
                this.render();
            });
        });

        el.querySelectorAll("[data-action=\"openBuffPicker\"]").forEach(btn => {
            btn.addEventListener("click", () => {
                this._openBuffPicker(el, btn.dataset.tier);
            });
        });

        el.querySelector("[name=\"enableAmbitious\"]")?.addEventListener("change", ev => {
            const fields = el.querySelector(".recipe-editor-ambitious-fields");
            if (fields) fields.classList.toggle("is-hidden", !ev.target.checked);
        });

        el.querySelector("[data-action=\"pickOutputImg\"]")?.addEventListener("click", () => {
            this._pickImage(el, "outputImg", ".recipe-editor-img-preview:not(.recipe-editor-img-preview--amb)");
        });

        el.querySelector("[data-action=\"pickAmbOutputImg\"]")?.addEventListener("click", () => {
            this._pickImage(el, "ambOutputImg", ".recipe-editor-img-preview--amb");
        });

        el.querySelector("[data-action=\"openStdOutput\"]")?.addEventListener("click", ev => {
            const id = ev.currentTarget?.dataset?.compendiumId;
            if (id) openCustomOutputCompendiumItem(id);
        });

        el.querySelector("[data-action=\"openAmbOutput\"]")?.addEventListener("click", ev => {
            const id = ev.currentTarget?.dataset?.compendiumId;
            if (id) openCustomOutputCompendiumItem(id);
        });

        el.querySelector("[data-action=\"saveRecipe\"]")?.addEventListener("click", () => this._saveRecipe(el));
        el.querySelector("[data-action=\"deleteRecipe\"]")?.addEventListener("click", () => this._deleteRecipe());
        el.querySelector("[data-action=\"exportJson\"]")?.addEventListener("click", () => this._exportJson());
        el.querySelector("[data-action=\"importJson\"]")?.addEventListener("click", () => this._importJson());
    }

    _blankRecipe() {
        const recipeName = "New Recipe";
        const isTailoring = this.#professionId === "tailoring";
        const isBrewing = this.#professionId === "brewing";
        const isLeather = this.#professionId === "leatherworking";
        const defaultImg = isTailoring
            ? "icons/equipment/back/cloak-hooded-blue.webp"
            : isBrewing
                ? "icons/consumables/drinks/tea-jasmine-green.webp"
                : isLeather
                    ? "icons/equipment/shield/buckler-wooden-boss-brown.webp"
                    : "icons/consumables/food/bowl-stew-brown.webp";
        const systemSubtype = isBrewing
            ? "potion"
            : (isTailoring || isLeather ? "trinket" : "food");
        const defaultSkill = isTailoring ? "dex" : (isBrewing ? "wis" : "sur");
        return applyProfessionToolToRecipe({
            name: recipeName,
            dc: 12,
            skill: defaultSkill,
            ingredients: [{ name: "", quantity: 1 }],
            output: {
                name: recipeName,
                type: "consumable",
                quantity: 1,
                img: defaultImg,
                description: "<p>Custom crafted output.</p>",
                rarity: "common",
                system: { type: { value: systemSubtype, subtype: "" } }
            },
            outputFlags: this._defaultOutputFlags()
        }, this.#professionId);
    }

    _defaultOutputFlags() {
        return {
            [MODULE_ID]: {
                foodTag: defaultFoodTagForProfession(this.#professionId),
                spoilsAfter: 3,
                partyMeal: false,
                wellFed: false,
                satiates: defaultSatiatesForProfession(this.#professionId)
            }
        };
    }

    _applyMealFlagsFromForm(root, draft, tier) {
        const prefix = this._mealFieldPrefix(tier);
        const flagsKey = tier === "ambitious" ? "ambitiousOutputFlags" : "outputFlags";
        if (!draft[flagsKey]) draft[flagsKey] = foundry.utils.deepClone(this._defaultOutputFlags());
        const rf = draft[flagsKey][MODULE_ID] ?? {};
        draft[flagsKey][MODULE_ID] = rf;

        if (this._isMealProfession(this.#professionId)) {
            rf.partyMeal = root.querySelector(`[name="${prefix}PartyMeal"]`)?.checked ?? false;
            const satFood = root.querySelector(`[name="${prefix}SatiatesFood"]`)?.checked ?? false;
            const satWater = root.querySelector(`[name="${prefix}SatiatesWater"]`)?.checked ?? false;
            rf.satiates = buildSatiatesList(satFood, satWater);
            if (!rf.satiates.length) {
                rf.satiates = defaultSatiatesForProfession(this.#professionId);
            }

            rf.foodTag = root.querySelector(`[name="${prefix}FoodTag"]`)?.value
                ?? defaultFoodTagForProfession(this.#professionId);

            const spoilsRaw = root.querySelector(`[name="${prefix}SpoilsAfter"]`)?.value?.trim() ?? "";
            rf.spoilsAfter = spoilsRaw ? (Number(spoilsRaw) || null) : null;
        } else {
            delete rf.partyMeal;
            delete rf.satiates;
            delete rf.foodTag;
            delete rf.spoilsAfter;
        }

        const presetId = root.querySelector(`[name="${prefix}BuffPresetId"]`)?.value ?? "none";
        if (presetId !== "custom") {
            applyMealBuffPresetToFlags(rf, presetId);
        }
    }

    _pickImage(root, hiddenName, previewSelector) {
        const FP = foundry.applications?.apps?.FilePicker?.implementation ?? FilePicker;
        const hidden = root.querySelector(`[name="${hiddenName}"]`);
        const preview = root.querySelector(previewSelector);
        const fp = new FP({
            type: "image",
            current: hidden?.value ?? "",
            callback: path => {
                if (hidden) hidden.value = path;
                if (preview) preview.src = path;
            }
        });
        fp.browse();
    }

    _readFormDraft(root) {
        const baseline = this.#draft
            ?? game.settings.get(MODULE_ID, "customRecipes")?.[this.#professionId]?.[this.#selectedIndex]
            ?? null;
        const draft = foundry.utils.deepClone(
            baseline ?? this._blankRecipe()
        );

        draft.name = root.querySelector("[name=\"name\"]")?.value?.trim() ?? draft.name;
        draft.dc = Number(root.querySelector("[name=\"dc\"]")?.value) || 12;
        draft.skill = root.querySelector("[name=\"skill\"]")?.value?.trim() || "sur";
        applyProfessionToolToRecipe(draft, this.#professionId);
        draft.outputFlags = draft.outputFlags ?? this._defaultOutputFlags();
        draft.output = draft.output ?? {};
        const formOutputName = root.querySelector("[name=\"outputName\"]")?.value?.trim() ?? draft.output.name;
        draft.output.name = resolveRecipeOutputNameOnSave(
            baseline?.name,
            baseline?.output?.name,
            draft.name,
            formOutputName
        );
        draft.output.quantity = Number(root.querySelector("[name=\"outputQty\"]")?.value) || 1;
        draft.output.img = root.querySelector("[name=\"outputImg\"]")?.value?.trim()
            ?? draft.output.img ?? "icons/consumables/food/bowl-stew-brown.webp";
        const outputDescRaw = root.querySelector("[name=\"outputDesc\"]")?.value?.trim() ?? "";
        draft.output.description = this._wrapDescription(outputDescRaw)
            || draft.output.description
            || `<p>${draft.output.name}</p>`;
        draft.output.type = draft.output.type ?? "consumable";
        draft.output.rarity = draft.output.rarity ?? "common";
        draft.output.system = draft.output.system ?? {
            type: {
                value: this.#professionId === "brewing"
                    ? "potion"
                    : (["tailoring", "leatherworking", "smithing"].includes(this.#professionId) ? "trinket" : "food"),
                subtype: ""
            }
        };

        if (this._hasOutputBuffEffects(this.#professionId)) {
            this._applyMealFlagsFromForm(root, draft, "standard");
        }

        const enableAmbitious = root.querySelector("[name=\"enableAmbitious\"]")?.checked;
        if (enableAmbitious) {
            const ambName = root.querySelector("[name=\"ambOutputName\"]")?.value?.trim()
                || `${draft.output.name} (Fine)`;
            const ambQty = Number(root.querySelector("[name=\"ambOutputQty\"]")?.value) || 1;
            const ambImg = root.querySelector("[name=\"ambOutputImg\"]")?.value?.trim() || draft.output.img;
            const ambDescRaw = root.querySelector("[name=\"ambOutputDesc\"]")?.value?.trim() ?? "";
            const ambDescription = this._wrapDescription(ambDescRaw) || `<p>${ambName}</p>`;
            draft.ambitiousOutput = {
                name: ambName,
                type: "consumable",
                quantity: ambQty,
                img: ambImg,
                description: ambDescription,
                rarity: "uncommon",
                system: foundry.utils.deepClone(draft.output.system),
                compendiumId: draft.ambitiousOutput?.compendiumId
            };
            draft.ambitiousOutputFlags = foundry.utils.deepClone(
                draft.ambitiousOutputFlags ?? draft.outputFlags ?? this._defaultOutputFlags()
            );
            if (this._hasOutputBuffEffects(this.#professionId)) {
                this._applyMealFlagsFromForm(root, draft, "ambitious");
            }
        } else {
            delete draft.ambitiousOutput;
            delete draft.ambitiousOutputFlags;
        }

        draft.ingredients = [];
        for (const row of root.querySelectorAll(".recipe-editor-ingredient-row")) {
            const name = row.querySelector("[name=\"ingName\"]")?.value?.trim();
            const qty = Number(row.querySelector("[name=\"ingQty\"]")?.value) || 1;
            if (name) draft.ingredients.push({ name, quantity: qty });
        }
        if (!draft.ingredients.length) draft.ingredients = [{ name: "Rations", quantity: 1 }];

        return draft;
    }

    async _confirmRecipeOverwrite(messages) {
        const body = messages.map(line => `<p>${this._esc(line)}</p>`).join("");
        const confirmFn = game.ionrift?.library?.confirm ?? Dialog.confirm.bind(Dialog);
        return await confirmFn({
            title: "Replace existing recipe?",
            content: body,
            yesLabel: "Replace",
            noLabel: "Cancel",
            yesIcon: "fas fa-save",
            noIcon: "fas fa-times",
            defaultYes: false
        });
    }

    _flashSavedListItem(index) {
        requestAnimationFrame(() => {
            const item = this.element?.querySelector(
                `[data-action="selectRecipe"][data-index="${index}"]`
            );
            if (!item) return;
            item.classList.add("recipe-editor-list-item--saved-flash");
            setTimeout(() => item.classList.remove("recipe-editor-list-item--saved-flash"), 1400);
        });
    }

    async _saveRecipe(root) {
        let draft = this._readFormDraft(root);
        const stored = foundry.utils.deepClone(game.settings.get(MODULE_ID, "customRecipes") ?? {});
        const list = Array.isArray(stored[this.#professionId]) ? stored[this.#professionId] : [];
        const isUpdate = this.#selectedIndex >= 0 && this.#selectedIndex < list.length;

        this._ensureRecipeId(draft, list, isUpdate);

        const { valid, errors } = validateCustomRecipe(draft, this.#professionId);
        if (!valid) {
            ui.notifications.error(errors.join(" "));
            return;
        }

        const overwriteMessages = describeRecipeSaveOverwrite(
            this.#professionId,
            draft,
            list,
            { isUpdate, selectedIndex: this.#selectedIndex }
        );
        if (overwriteMessages.length) {
            const confirmed = await this._confirmRecipeOverwrite(overwriteMessages);
            if (!confirmed) return;
        }

        try {
            draft = await syncRecipeOutputsToCompendium(this.#professionId, draft);
        } catch (err) {
            const detail = formatSyncError(err);
            console.error(`${MODULE_ID} | RecipeEditorApp sync outputs`, detail, err);
            ui.notifications.error(`Could not write output items to Respite Custom compendium. ${detail}`);
            return;
        }

        let savedIndex;
        if (isUpdate) {
            list[this.#selectedIndex] = draft;
            savedIndex = this.#selectedIndex;
        } else {
            if (list.length >= CUSTOM_RECIPE_MAX_PER_PROFESSION) {
                ui.notifications.warn(`Maximum ${CUSTOM_RECIPE_MAX_PER_PROFESSION} custom recipes per profession.`);
                return;
            }
            list.push(draft);
            savedIndex = list.length - 1;
        }

        stored[this.#professionId] = list;
        await game.settings.set(MODULE_ID, "customRecipes", sanitizeCustomRecipes(stored));

        const engine = game.ionrift?.respite?.craftingEngine;
        if (engine) applyCustomRecipesToEngine(engine);

        this.#flashSavedIndex = savedIndex;
        this.#selectedIndex = savedIndex;
        this.#draft = null;
        ui.notifications.info(`Saved "${draft.name}". Output item: ${draft.output?.name ?? draft.name}.`);
        await this.render();
        this.#flashSavedIndex = null;
        this._flashSavedListItem(savedIndex);
    }

    /**
     * Assign a stable internal id. Hidden from the UI; preserved on edit, generated on create.
     * JSON import/export remains the path to set ids that override pack recipes.
     * @param {Object} draft
     * @param {Object[]} list
     * @param {boolean} isUpdate
     */
    _ensureRecipeId(draft, list, isUpdate) {
        if (isUpdate && draft.id) return;

        const taken = new Set(list.map(r => r.id).filter(Boolean));
        if (draft.id && !taken.has(draft.id)) return;

        let candidate = `custom_${this.#professionId}_${Date.now()}`;
        while (taken.has(candidate)) {
            candidate = `custom_${this.#professionId}_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
        }
        draft.id = candidate;
    }

    async _deleteRecipe() {
        const stored = foundry.utils.deepClone(game.settings.get(MODULE_ID, "customRecipes") ?? {});
        const list = stored[this.#professionId] ?? [];
        if (this.#selectedIndex < 0 || this.#selectedIndex >= list.length) return;
        const removed = list[this.#selectedIndex];
        const outputName = removed?.output?.name;
        const folderLabel = outputFolderNameForProfession(this.#professionId);
        list.splice(this.#selectedIndex, 1);
        stored[this.#professionId] = list;
        await game.settings.set(MODULE_ID, "customRecipes", sanitizeCustomRecipes(stored));
        this.#selectedIndex = Math.max(0, this.#selectedIndex - 1);
        this.#draft = null;
        const compendiumNote = outputName
            ? ` Compendium item "${outputName}" may still be in ${folderLabel}.`
            : "";
        ui.notifications.info(`Recipe removed.${compendiumNote}`);
        this.render();
    }

    _exportJson() {
        const data = game.settings.get(MODULE_ID, "customRecipes") ?? {};
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "ionrift-custom-recipes.json";
        a.click();
        URL.revokeObjectURL(url);
    }

    async _importJson() {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".json,application/json";
        input.addEventListener("change", async () => {
            const file = input.files?.[0];
            if (!file) return;
            try {
                const text = await file.text();
                const parsed = JSON.parse(text);
                await game.settings.set(MODULE_ID, "customRecipes", sanitizeCustomRecipes(parsed));
                ui.notifications.info("Custom recipes imported.");
                this.#selectedIndex = 0;
                this.#draft = null;
                this.render();
            } catch (err) {
                console.error(err);
                ui.notifications.error("Could not parse recipe JSON.");
            }
        });
        input.click();
    }
}
