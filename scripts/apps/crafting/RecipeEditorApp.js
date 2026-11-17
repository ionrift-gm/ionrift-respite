import { RecipeEditorMarkupMethods } from "./RecipeEditorMarkup.js";
/**
 * RecipeEditorApp
 * GM-only editor for custom profession recipes (world setting JSON).
 */

import {
    CUSTOM_RECIPE_MAX_PER_PROFESSION,
    applyCustomRecipesToLiveEngines,
    applyProfessionToolToRecipe,
    describeRecipeSaveOverwrite,
    getHomebrewProfessionOptions,
    HOMEBREW_PROFESSION_DISPLAY,
    sanitizeCustomRecipes,
    validateCustomRecipe
} from "../../services/crafting/recipes/RecipeCatalog.js";
import {
    applyMealBuffPresetToFlags,
    buildSatiatesList,
    commitMealEffectFieldsFromForm,
    defaultFoodTagForProfession,
    defaultSatiatesForProfession,
    formatMealBuffPreview,
    formatMealBuffPresetTitle,
    getMealBuffPreset,
    getMealBuffPresetAttribution,
    getMealBuffPresetsForProfession,
    syncResourceTypeFromMealFlags
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

const getProfessionLabel = (id) => HOMEBREW_PROFESSION_DISPLAY[id]?.label ?? id;

const PROFESSION_ICONS = Object.fromEntries(
    Object.entries(HOMEBREW_PROFESSION_DISPLAY).map(([id, meta]) => [id, meta.icon])
);

export class RecipeEditorApp extends foundry.applications.api.ApplicationV2 {

    #professionId = "cooking";
    #selectedIndex = 0;
    #draft = null;
    #flashSavedIndex = null;
    /** @type {Set<number>} Ingredient row indices with Alternates open. */
    #ingredientAdvancedOpen = new Set();

    static DEFAULT_OPTIONS = {
        id: "respite-recipe-editor",
        window: {
            title: "ionrift-respite.recipeEditor.windowTitle",
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
            return rf?.wellFed ? game.i18n.localize("ionrift-respite.recipeEditor.customWellFed") : game.i18n.localize("ionrift-respite.recipeEditor.noBuff");
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
        return RecipeEditorMarkupMethods._buildMealEffectsMarkup.call(this, tier, rf, professionId);
    }

    _buildMarkup(context) {
        return RecipeEditorMarkupMethods._buildMarkup.call(this, context, {
            flashSavedIndex: this.#flashSavedIndex,
            ingredientAdvancedOpen: this.#ingredientAdvancedOpen
        });
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
            this.#ingredientAdvancedOpen = new Set();
            this.render();
        });

        el.querySelectorAll("[data-action=\"selectRecipe\"]").forEach(btn => {
            btn.addEventListener("click", () => {
                this.#selectedIndex = Number(btn.dataset.index);
                this.#draft = null;
                this.#ingredientAdvancedOpen = new Set();
                this.render();
            });
        });

        el.querySelector("[data-action=\"newRecipe\"]")?.addEventListener("click", () => {
            this.#draft = this._blankRecipe();
            this.#selectedIndex = -1;
            this.#ingredientAdvancedOpen = new Set();
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
                this.#ingredientAdvancedOpen = new Set(
                    [...this.#ingredientAdvancedOpen]
                        .filter(i => i !== idx)
                        .map(i => (i > idx ? i - 1 : i))
                );
                this.#draft = draft;
                this.render();
            });
        });

        el.querySelectorAll(".recipe-editor-ingredient-advanced").forEach(details => {
            details.addEventListener("toggle", () => {
                const idx = Number(details.dataset.ingIndex);
                if (Number.isNaN(idx)) return;
                if (details.open) this.#ingredientAdvancedOpen.add(idx);
                else this.#ingredientAdvancedOpen.delete(idx);
            });
        });

        el.querySelectorAll("[data-action=\"addAlternate\"]").forEach(btn => {
            btn.addEventListener("click", () => {
                const draft = this._readFormDraft(el);
                const idx = Number(btn.dataset.ingIndex);
                const ing = draft.ingredients[idx];
                if (!ing) return;
                if (!Array.isArray(ing.alternates)) ing.alternates = [];
                ing.alternates.push("");
                this.#ingredientAdvancedOpen.add(idx);
                this.#draft = draft;
                this.render();
            });
        });

        el.querySelectorAll("[data-action=\"removeAlternate\"]").forEach(btn => {
            btn.addEventListener("click", () => {
                const draft = this._readFormDraft(el);
                const idx = Number(btn.dataset.ingIndex);
                const altIdx = Number(btn.dataset.altIndex);
                const ing = draft.ingredients[idx];
                if (!ing || !Array.isArray(ing.alternates)) return;
                if (altIdx >= 0 && altIdx < ing.alternates.length) {
                    ing.alternates.splice(altIdx, 1);
                }
                if (!ing.alternates.length) delete ing.alternates;
                this.#ingredientAdvancedOpen.add(idx);
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
                description: `<p>${game.i18n.localize("ionrift-respite.recipeEditor.defaultOutputDescription")}</p>`,
                rarity: "common",
                system: { type: { value: systemSubtype, subtype: "" } }
            },
            outputFlags: this._defaultOutputFlags()
        }, this.#professionId);
    }

    _defaultOutputFlags() {
        const rf = {
            foodTag: defaultFoodTagForProfession(this.#professionId),
            spoilsAfter: 3,
            partyMeal: false,
            wellFed: false,
            satiates: defaultSatiatesForProfession(this.#professionId)
        };
        syncResourceTypeFromMealFlags(rf);
        return { [MODULE_ID]: rf };
    }

    _applyMealFlagsFromForm(root, draft, tier) {
        const prefix = this._mealFieldPrefix(tier);
        const flagsKey = tier === "ambitious" ? "ambitiousOutputFlags" : "outputFlags";
        if (!draft[flagsKey]) draft[flagsKey] = foundry.utils.deepClone(this._defaultOutputFlags());
        const rf = draft[flagsKey][MODULE_ID] ?? {};
        draft[flagsKey][MODULE_ID] = rf;

        if (this._isMealProfession(this.#professionId)) {
            const satFood = root.querySelector(`[name="${prefix}SatiatesFood"]`)?.checked ?? false;
            const satWater = root.querySelector(`[name="${prefix}SatiatesWater"]`)?.checked ?? false;
            let satiates = buildSatiatesList(satFood, satWater);
            if (!satiates.length) {
                satiates = defaultSatiatesForProfession(this.#professionId);
            }
            const spoilsRaw = root.querySelector(`[name="${prefix}SpoilsAfter"]`)?.value?.trim() ?? "";
            commitMealEffectFieldsFromForm(rf, {
                presetId: root.querySelector(`[name="${prefix}BuffPresetId"]`)?.value ?? "none",
                partyMeal: root.querySelector(`[name="${prefix}PartyMeal"]`)?.checked ?? false,
                satiates,
                foodTag: root.querySelector(`[name="${prefix}FoodTag"]`)?.value
                    ?? defaultFoodTagForProfession(this.#professionId),
                spoilsAfter: spoilsRaw ? (Number(spoilsRaw) || null) : null
            });
        } else {
            delete rf.partyMeal;
            delete rf.satiates;
            delete rf.foodTag;
            delete rf.spoilsAfter;
            delete rf.resourceType;
            const presetId = root.querySelector(`[name="${prefix}BuffPresetId"]`)?.value ?? "none";
            if (presetId !== "custom") {
                applyMealBuffPresetToFlags(rf, presetId);
            }
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
        for (const block of root.querySelectorAll(".recipe-editor-ingredient-block")) {
            const name = block.querySelector("[name=\"ingName\"]")?.value?.trim();
            const qty = Number(block.querySelector("[name=\"ingQty\"]")?.value) || 1;
            if (!name) continue;
            const alternates = [...block.querySelectorAll("[name=\"ingAlt\"]")]
                .map(input => input.value?.trim())
                .filter(Boolean);
            const entry = { name, quantity: qty };
            if (alternates.length) entry.alternates = alternates;
            draft.ingredients.push(entry);
        }
        if (!draft.ingredients.length) draft.ingredients = [{ name: "Rations", quantity: 1 }];

        return draft;
    }

    async _confirmRecipeOverwrite(messages) {
        const body = messages.map(line => `<p>${this._esc(line)}</p>`).join("");
        const confirmFn = game.ionrift?.library?.confirm ?? Dialog.confirm.bind(Dialog);
        return await confirmFn({
            title: game.i18n.localize("ionrift-respite.recipeEditor.replaceTitle"),
            content: body,
            yesLabel: game.i18n.localize("ionrift-respite.recipeEditor.replaceYes"),
            noLabel: game.i18n.localize("ionrift-respite.recipeEditor.replaceNo"),
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
            ui.notifications.error(game.i18n.format("ionrift-respite.recipeEditor.syncOutputError", { detail }));
            return;
        }

        let savedIndex;
        if (isUpdate) {
            list[this.#selectedIndex] = draft;
            savedIndex = this.#selectedIndex;
        } else {
            if (list.length >= CUSTOM_RECIPE_MAX_PER_PROFESSION) {
                ui.notifications.warn(game.i18n.format("ionrift-respite.recipeEditor.maxRecipesWarn", { max: CUSTOM_RECIPE_MAX_PER_PROFESSION }));
                return;
            }
            list.push(draft);
            savedIndex = list.length - 1;
        }

        stored[this.#professionId] = list;
        await game.settings.set(MODULE_ID, "customRecipes", sanitizeCustomRecipes(stored));
        applyCustomRecipesToLiveEngines({ render: true });

        this.#flashSavedIndex = savedIndex;
        this.#selectedIndex = savedIndex;
        this.#draft = null;
        ui.notifications.info(game.i18n.format("ionrift-respite.recipeEditor.savedNotification", { name: draft.name, output: draft.output?.name ?? draft.name }));
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
        applyCustomRecipesToLiveEngines({ render: true });
        this.#selectedIndex = Math.max(0, this.#selectedIndex - 1);
        this.#draft = null;
        const compendiumNote = outputName
            ? (" " + game.i18n.format("ionrift-respite.recipeEditor.deleteCompendiumNote", { name: outputName, folder: folderLabel }))
            : "";
        ui.notifications.info(game.i18n.format("ionrift-respite.recipeEditor.deletedNotification", { note: compendiumNote }));
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
                applyCustomRecipesToLiveEngines({ render: true });
                ui.notifications.info(game.i18n.localize("ionrift-respite.recipeEditor.importedNotification"));
                this.#selectedIndex = 0;
                this.#draft = null;
                this.render();
            } catch (err) {
                console.error(err);
                ui.notifications.error(game.i18n.localize("ionrift-respite.recipeEditor.importParseError"));
            }
        });
        input.click();
    }
}
