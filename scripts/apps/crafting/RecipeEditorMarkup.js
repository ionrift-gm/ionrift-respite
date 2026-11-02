import {
    getProfessionToolRequired,
    HOMEBREW_PROFESSION_DISPLAY,
    TOOL_PROFICIENCY_LABELS
} from "../../services/crafting/recipes/RecipeCatalog.js";
import {
    defaultFoodTagForProfession,
    defaultSatiatesForProfession,
    FOOD_TAG_OPTIONS,
    matchMealBuffPresetId
} from "../../services/meal/buffs/MealBuffPresets.js";
import { outputFolderNameForProfession } from "../../services/crafting/recipes/RecipeOutputCompendium.js";
import { MODULE_ID } from "../../data/moduleId.js";

const getProfessionLabel = (id) => HOMEBREW_PROFESSION_DISPLAY[id]?.label ?? id;

export const RecipeEditorMarkupMethods = {
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
            ? (showMealFields ? game.i18n.localize("ionrift-respite.recipeEditor.ambitiousMealEffects") : game.i18n.localize("ionrift-respite.recipeEditor.ambitiousOutputEffects"))
            : (showMealFields ? game.i18n.localize("ionrift-respite.recipeEditor.mealEffects") : game.i18n.localize("ionrift-respite.recipeEditor.outputEffects"));
        const tierHint = tier === "ambitious"
            ? game.i18n.localize("ionrift-respite.recipeEditor.ambitiousEffectsHint")
            : (showMealFields
                ? game.i18n.localize("ionrift-respite.recipeEditor.mealEffectsHint")
                : game.i18n.localize("ionrift-respite.recipeEditor.outputEffectsHint"));

        const foodTagOptions = FOOD_TAG_OPTIONS.map(opt => {
            const selected = opt.id === foodTag ? " selected" : "";
            return `<option value="${this._esc(opt.id)}"${selected}>${this._esc(opt.label)}</option>`;
        }).join("");

        const attributionMarkup = this._mealBuffAttributionMarkup(presetId);
        const mealFieldsMarkup = showMealFields ? `
            <div class="recipe-editor-meal-toggles">
                <label class="recipe-editor-check">
                    <input type="checkbox" name="${prefix}PartyMeal" ${partyMeal ? "checked" : ""} />
                    <span>${game.i18n.localize("ionrift-respite.recipeEditor.partyMeal")}</span>
                </label>
                <label class="recipe-editor-check">
                    <input type="checkbox" name="${prefix}SatiatesFood" ${satiatesFood ? "checked" : ""} />
                    <span>${game.i18n.localize("ionrift-respite.recipeEditor.satiatesFood")}</span>
                </label>
                <label class="recipe-editor-check">
                    <input type="checkbox" name="${prefix}SatiatesWater" ${satiatesWater ? "checked" : ""} />
                    <span>${game.i18n.localize("ionrift-respite.recipeEditor.satiatesWater")}</span>
                </label>
            </div>
            <div class="recipe-editor-fields recipe-editor-fields--double">
                <div class="recipe-editor-field">
                    <label class="recipe-editor-label">${game.i18n.localize("ionrift-respite.recipeEditor.foodTag")}</label>
                    <select class="recipe-editor-select" name="${prefix}FoodTag">${foodTagOptions}</select>
                </div>
                <div class="recipe-editor-field">
                    <label class="recipe-editor-label">${game.i18n.localize("ionrift-respite.recipeEditor.spoilsAfter")}</label>
                    <input type="number" class="recipe-editor-input" name="${prefix}SpoilsAfter"
                        min="1" placeholder="${game.i18n.localize("ionrift-respite.recipeEditor.spoilsNeverPlaceholder")}" value="${this._esc(spoilsAttr)}" />
                </div>
            </div>` : "";

        return `
        <div class="recipe-editor-section recipe-editor-section--meal" data-meal-tier="${tier}">
            <div class="recipe-editor-section-title">${this._esc(tierLabel)}</div>
            <p class="recipe-editor-hint">${this._esc(tierHint)}</p>
            ${mealFieldsMarkup}
            <div class="recipe-editor-buff-row">
                <div class="recipe-editor-buff-summary">
                    <span class="recipe-editor-label">${game.i18n.localize("ionrift-respite.recipeEditor.buff")}</span>
                    <div class="recipe-editor-buff-summary-line">
                        <span class="recipe-editor-buff-summary-text">${this._esc(summary)}</span>
                        <span class="recipe-editor-buff-pack-attribution">${attributionMarkup}</span>
                    </div>
                </div>
                <input type="hidden" name="${prefix}BuffPresetId" value="${this._esc(presetId)}" />
                <button type="button" class="recipe-editor-btn recipe-editor-btn--ghost"
                    data-action="openBuffPicker" data-tier="${tier}">
                    <i class="fas fa-star"></i> ${game.i18n.localize("ionrift-respite.recipeEditor.chooseBuff")}
                </button>
            </div>
        </div>`;
    },

    _buildMarkup(context, { flashSavedIndex, ingredientAdvancedOpen }) {
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
        const profLabel = getProfessionLabel(context.professionId);
        const toolKey = getProfessionToolRequired(context.professionId);
        const toolLabel = toolKey
            ? (TOOL_PROFICIENCY_LABELS[toolKey] ?? toolKey)
            : null;

        let recipeListHtml = "";
        if (context.recipes.length) {
            for (let i = 0; i < context.recipes.length; i++) {
                const r = context.recipes[i];
                const active = i === context.selectedIndex && !context.isNewDraft ? " active" : "";
                const flash = i === flashSavedIndex ? " recipe-editor-list-item--saved-flash" : "";
                const outputImg = r.output?.img
                    ?? "icons/consumables/food/bowl-stew-brown.webp";
                const missingOutput = context.missingOutputIndices?.has(i);
                const missingBadge = missingOutput
                    ? `<span class="recipe-editor-list-warn" title="${game.i18n.localize("ionrift-respite.recipeEditor.outputMissingTooltip")}"><i class="fas fa-unlink" aria-hidden="true"></i></span>`
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
                    ${game.i18n.localize("ionrift-respite.recipeEditor.noCustomRecipes")}
                </p>`;
        }

        let ingredientsHtml = "";
        const ingredients = (draft.ingredients?.length ? draft.ingredients : [{ name: "", quantity: 1 }]);
        const canRemoveIngredient = ingredients.length > 1;
        for (let i = 0; i < ingredients.length; i++) {
            const ing = ingredients[i];
            const alts = Array.isArray(ing.alternates)
                ? ing.alternates.map(a => String(a ?? "").trim()).filter(Boolean)
                : [];
            const advancedOpen = ingredientAdvancedOpen.has(i) || alts.length > 0;
            if (advancedOpen) ingredientAdvancedOpen.add(i);
            const removeBtn = canRemoveIngredient ? `
                <button type="button" class="recipe-editor-ingredient-remove" data-action="removeIngredient"
                    data-ing-index="${i}" title="${game.i18n.localize("ionrift-respite.recipeEditor.removeIngredient")}" aria-label="${game.i18n.localize("ionrift-respite.recipeEditor.removeIngredient")}">
                    <i class="fas fa-times"></i>
                </button>` : "";
            let altRowsHtml = "";
            const altList = alts.length ? alts : (advancedOpen ? [""] : []);
            for (let altIdx = 0; altIdx < altList.length; altIdx++) {
                altRowsHtml += `
                <div class="recipe-editor-ingredient-alt-row">
                    <input type="text" class="recipe-editor-input" name="ingAlt"
                        value="${this._esc(altList[altIdx])}" placeholder="${game.i18n.localize("ionrift-respite.recipeEditor.altNamePlaceholder")}" />
                    <button type="button" class="recipe-editor-ingredient-remove" data-action="removeAlternate"
                        data-ing-index="${i}" data-alt-index="${altIdx}"
                        title="${game.i18n.localize("ionrift-respite.recipeEditor.removeAlternate")}" aria-label="${game.i18n.localize("ionrift-respite.recipeEditor.removeAlternate")}">
                        <i class="fas fa-times"></i>
                    </button>
                </div>`;
            }
            ingredientsHtml += `
            <div class="recipe-editor-ingredient-block" data-ing-index="${i}">
                <div class="recipe-editor-ingredient-row">
                    <input type="text" class="recipe-editor-input" name="ingName"
                        value="${this._esc(ing.name)}" placeholder="${game.i18n.localize("ionrift-respite.recipeEditor.ingNamePlaceholder")}" />
                    <input type="number" class="recipe-editor-input recipe-editor-input--qty" name="ingQty"
                        min="1" value="${ing.quantity ?? 1}" aria-label="${game.i18n.localize("ionrift-respite.recipeEditor.quantityAria")}" />
                    ${removeBtn}
                </div>
                <details class="recipe-editor-ingredient-advanced" data-ing-index="${i}"${advancedOpen ? " open" : ""}>
                    <summary class="recipe-editor-ingredient-advanced-toggle">
                        <i class="fas fa-exchange-alt" aria-hidden="true"></i> ${game.i18n.localize("ionrift-respite.recipeEditor.alternates")}
                        ${alts.length ? `<span class="recipe-editor-ingredient-alt-count">${alts.length}</span>` : ""}
                    </summary>
                    <div class="recipe-editor-ingredient-advanced-body">
                        <p class="recipe-editor-hint">${game.i18n.localize("ionrift-respite.recipeEditor.alternatesHint")}</p>
                        <div class="recipe-editor-ingredient-alts">${altRowsHtml}</div>
                        <button type="button" class="recipe-editor-btn recipe-editor-btn--ghost"
                            data-action="addAlternate" data-ing-index="${i}">
                            <i class="fas fa-plus"></i> ${game.i18n.localize("ionrift-respite.recipeEditor.addAlternate")}
                        </button>
                    </div>
                </details>
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
            ${game.i18n.format("ionrift-respite.recipeEditor.lead", { folder: outputFolderLabel })}
            ${context.professionId === "cooking" ? (" " + game.i18n.localize("ionrift-respite.recipeEditor.leadCookingExtra")) : ""}
        </p>
        <div class="recipe-editor-filter">
            <label class="recipe-editor-filter-label">
                <i class="${context.professionIcon}"></i> ${game.i18n.localize("ionrift-respite.recipeEditor.profession")}
            </label>
            <select class="recipe-editor-select" data-action="changeProfession">${professionOptions}</select>
            <span class="recipe-editor-count">${context.recipes.length}/${context.maxRecipes}</span>
        </div>
        <div class="recipe-editor-layout">
            <aside class="recipe-editor-list" aria-label="${game.i18n.localize("ionrift-respite.recipeEditor.recipeListAria")}">
                <div class="recipe-editor-list-heading">${game.i18n.format("ionrift-respite.recipeEditor.recipesHeading", { profession: profLabel })}</div>
                ${recipeListHtml}
                <button type="button" class="recipe-editor-list-new${newRecipeActive}" data-action="newRecipe">
                    <i class="fas fa-plus"></i> ${game.i18n.localize("ionrift-respite.recipeEditor.newRecipe")}
                </button>
            </aside>
            <section class="recipe-editor-detail">
                ${context.isNewDraft ? `
                <p class="recipe-editor-draft-note">
                    <i class="fas fa-pen" aria-hidden="true"></i>
                    ${game.i18n.localize("ionrift-respite.recipeEditor.unsavedDraft")}
                </p>` : ""}
                <div class="recipe-editor-section">
                    <div class="recipe-editor-section-title">${game.i18n.localize("ionrift-respite.recipeEditor.recipeSectionTitle")}</div>
                    <div class="recipe-editor-fields recipe-editor-fields--triple">
                        <div class="recipe-editor-field">
                            <label class="recipe-editor-label">${game.i18n.localize("ionrift-respite.recipeEditor.recipeName")}</label>
                            <input type="text" class="recipe-editor-input" name="name"
                                value="${this._esc(draft.name)}" placeholder="${game.i18n.localize("ionrift-respite.recipeEditor.recipeNamePlaceholder")}" />
                        </div>
                        <div class="recipe-editor-field">
                            <label class="recipe-editor-label">${game.i18n.localize("ionrift-respite.recipeEditor.recipeDc")}</label>
                            <input type="number" class="recipe-editor-input" name="dc"
                                min="1" value="${draft.dc ?? 12}" />
                        </div>
                        <div class="recipe-editor-field">
                            <label class="recipe-editor-label">${game.i18n.localize("ionrift-respite.recipeEditor.recipeSkill")}</label>
                            <select class="recipe-editor-select" name="skill"
                                aria-label="${game.i18n.localize("ionrift-respite.recipeEditor.skillCheckAria")}">${this._buildSkillOptions(skillVal)}</select>
                        </div>
                    </div>
                    ${toolLabel ? `
                    <div class="recipe-editor-fields recipe-editor-fields--double">
                        <div class="recipe-editor-field">
                            <label class="recipe-editor-label">${game.i18n.localize("ionrift-respite.recipeEditor.toolProficiency")}</label>
                            <div class="recipe-editor-locked-value" title="${game.i18n.localize("ionrift-respite.recipeEditor.toolProficiencyLocked")}">
                                <i class="fas fa-lock" aria-hidden="true"></i>
                                <span>${this._esc(toolLabel)}</span>
                            </div>
                        </div>
                    </div>` : ""}
                </div>
                <div class="recipe-editor-section">
                    <div class="recipe-editor-section-title">${game.i18n.localize("ionrift-respite.recipeEditor.ingredientsTitle")}</div>
                    <p class="recipe-editor-hint">${game.i18n.localize("ionrift-respite.recipeEditor.ingredientsHint")}</p>
                    <div class="recipe-editor-ingredients">${ingredientsHtml}</div>
                    <button type="button" class="recipe-editor-btn recipe-editor-btn--ghost" data-action="addIngredient">
                        <i class="fas fa-plus"></i> ${game.i18n.localize("ionrift-respite.recipeEditor.addIngredient")}
                    </button>
                </div>
                ${context.selectedOutputMissing ? `
                <p class="recipe-editor-sync-warn">
                    <i class="fas fa-unlink" aria-hidden="true"></i>
                    ${game.i18n.format("ionrift-respite.recipeEditor.compendiumOutputMissing", { folder: outputFolderLabel })}
                </p>` : ""}
                <div class="recipe-editor-section">
                    <div class="recipe-editor-section-title">${game.i18n.localize("ionrift-respite.recipeEditor.standardOutputTitle")}</div>
                    <p class="recipe-editor-hint">${game.i18n.format("ionrift-respite.recipeEditor.standardOutputHint", { folder: outputFolderLabel })}</p>
                    <div class="recipe-editor-img-row">
                        <img class="recipe-editor-img-preview" src="${this._esc(outputImg)}" alt="" />
                        <input type="hidden" name="outputImg" value="${this._esc(outputImg)}" />
                        <button type="button" class="recipe-editor-btn recipe-editor-btn--ghost"
                            data-action="pickOutputImg">
                            <i class="fas fa-image"></i> ${game.i18n.localize("ionrift-respite.recipeEditor.chooseImage")}
                        </button>
                        ${outputCompendiumId ? `
                        <button type="button" class="recipe-editor-btn recipe-editor-btn--ghost"
                            data-action="openStdOutput" data-compendium-id="${this._esc(outputCompendiumId)}">
                            <i class="fas fa-book"></i> ${game.i18n.localize("ionrift-respite.recipeEditor.openCompendiumItem")}
                        </button>` : ""}
                    </div>
                    <div class="recipe-editor-fields recipe-editor-fields--double">
                        <div class="recipe-editor-field">
                            <label class="recipe-editor-label">${game.i18n.localize("ionrift-respite.recipeEditor.itemName")}</label>
                            <input type="text" class="recipe-editor-input" name="outputName"
                                value="${this._esc(outputName)}" placeholder="${game.i18n.localize("ionrift-respite.recipeEditor.outputNamePlaceholder")}" />
                        </div>
                        <div class="recipe-editor-field">
                            <label class="recipe-editor-label">${game.i18n.localize("ionrift-respite.recipeEditor.quantity")}</label>
                            <input type="number" class="recipe-editor-input" name="outputQty"
                                min="1" value="${outputQty}" />
                        </div>
                    </div>
                    <div class="recipe-editor-field recipe-editor-field--full">
                        <label class="recipe-editor-label">${game.i18n.localize("ionrift-respite.recipeEditor.itemDescription")}</label>
                        <textarea class="recipe-editor-textarea" name="outputDesc" rows="2"
                            placeholder="${game.i18n.localize("ionrift-respite.recipeEditor.stdDescPlaceholder")}">${this._esc(this._stripHtmlForTextarea(outputDesc))}</textarea>
                    </div>
                    ${showOutputBuffEffects ? this._buildMealEffectsMarkup("standard", stdRf, context.professionId) : ""}
                </div>
                <div class="recipe-editor-section">
                    <label class="recipe-editor-ambitious-toggle">
                        <input type="checkbox" name="enableAmbitious" ${hasAmbitious ? "checked" : ""} />
                        <span class="recipe-editor-ambitious-copy">
                            <span class="recipe-editor-ambitious-title">${game.i18n.localize("ionrift-respite.recipeEditor.ambitiousOutputTitle")}</span>
                            <span class="recipe-editor-hint">${game.i18n.localize("ionrift-respite.recipeEditor.ambitiousOutputHint")}</span>
                        </span>
                    </label>
                    <div class="recipe-editor-ambitious-fields${hasAmbitious ? "" : " is-hidden"}">
                        <div class="recipe-editor-img-row">
                            <img class="recipe-editor-img-preview recipe-editor-img-preview--amb" src="${this._esc(ambImg)}" alt="" />
                            <input type="hidden" name="ambOutputImg" value="${this._esc(ambImg)}" />
                            <button type="button" class="recipe-editor-btn recipe-editor-btn--ghost"
                                data-action="pickAmbOutputImg">
                                <i class="fas fa-image"></i> ${game.i18n.localize("ionrift-respite.recipeEditor.chooseImage")}
                            </button>
                            ${ambCompendiumId ? `
                            <button type="button" class="recipe-editor-btn recipe-editor-btn--ghost"
                                data-action="openAmbOutput" data-compendium-id="${this._esc(ambCompendiumId)}">
                                <i class="fas fa-book"></i> ${game.i18n.localize("ionrift-respite.recipeEditor.openCompendiumItem")}
                            </button>` : ""}
                        </div>
                        <div class="recipe-editor-fields recipe-editor-fields--double">
                            <div class="recipe-editor-field">
                                <label class="recipe-editor-label">${game.i18n.localize("ionrift-respite.recipeEditor.upgradedItemName")}</label>
                                <input type="text" class="recipe-editor-input" name="ambOutputName"
                                    value="${this._esc(ambName)}" placeholder="${game.i18n.localize("ionrift-respite.recipeEditor.ambNamePlaceholder")}" />
                            </div>
                            <div class="recipe-editor-field">
                                <label class="recipe-editor-label">${game.i18n.localize("ionrift-respite.recipeEditor.quantity")}</label>
                                <input type="number" class="recipe-editor-input" name="ambOutputQty"
                                    min="1" value="${ambQty}" />
                            </div>
                        </div>
                        <div class="recipe-editor-field recipe-editor-field--full">
                            <label class="recipe-editor-label">${game.i18n.localize("ionrift-respite.recipeEditor.itemDescription")}</label>
                            <textarea class="recipe-editor-textarea" name="ambOutputDesc" rows="2"
                                placeholder="${game.i18n.localize("ionrift-respite.recipeEditor.ambDescPlaceholder")}">${this._esc(this._stripHtmlForTextarea(ambDesc))}</textarea>
                        </div>
                        ${showOutputBuffEffects ? this._buildMealEffectsMarkup("ambitious", ambRf, context.professionId) : ""}
                    </div>
                </div>
            </section>
        </div>
        <footer class="recipe-editor-footer">
            <div class="recipe-editor-footer-left">
                <button type="button" class="recipe-editor-btn recipe-editor-btn--ghost"
                    data-action="exportJson"><i class="fas fa-download"></i> ${game.i18n.localize("ionrift-respite.recipeEditor.export")}</button>
                <button type="button" class="recipe-editor-btn recipe-editor-btn--ghost"
                    data-action="importJson"><i class="fas fa-upload"></i> ${game.i18n.localize("ionrift-respite.recipeEditor.import")}</button>
                <button type="button" class="recipe-editor-btn recipe-editor-btn--danger"
                    data-action="deleteRecipe"${deleteDisabled}>
                    <i class="fas fa-trash"></i> ${game.i18n.localize("ionrift-respite.recipeEditor.delete")}
                </button>
            </div>
            <button type="button" class="recipe-editor-btn recipe-editor-btn--primary" data-action="saveRecipe">
                <i class="fas fa-save"></i> ${game.i18n.localize("ionrift-respite.recipeEditor.saveRecipe")}
            </button>
        </footer>`;
    }

};
