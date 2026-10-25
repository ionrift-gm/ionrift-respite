/**
 * ItemProvisionsApp
 * GM-only interface for inspecting and configuring Respite sustenance,
 * spoilage, and diet flags on any Foundry Item.
 * Supports drag-and-drop from actor sheets, item directory, or compendiums,
 * as well as a centralized campaign-wide audit view of all item overrides.
 */

import { ItemClassifier, STORAGE_TYPES } from "../../services/party/ItemClassifier.js";
import { ProvisionsAuditScanner } from "../../services/meal/provisions/ProvisionsAuditScanner.js";
import { CalendarHandler } from "../../services/rest/session/CalendarHandler.js";
import { refreshSpoilageBadgesOnOpenSheets } from "../../services/ui/sheet/UiInjections.js";
import { MODULE_ID } from "../../data/moduleId.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class ItemProvisionsApp extends HandlebarsApplicationMixin(ApplicationV2) {

    /** @type {Item|null} Currently loaded item document. */
    _item = null;

    /** @type {"editor"|"auditor"} Active window tab. */
    _activeTab = "editor";

    /** @type {string} Search query for the auditor list. */
    _searchQuery = "";

    /** @type {string} Active filter category. */
    _filterCategory = "all";

    static DEFAULT_OPTIONS = {
        id: "respite-item-provisions",
        tag: "form",
        window: {
            title: "ionrift-respite.itemProvisions.windowTitle",
            icon: "fas fa-carrot",
            resizable: true
        },
        position: {
            width: 740,
            height: "auto"
        },
        classes: ["ionrift-window", "glass-ui", "ionrift-respite-app", "respite-item-provisions-window"],
        actions: {
            saveProvisions: ItemProvisionsApp._onSaveAction,
            clearProvisions: ItemProvisionsApp._onClearAction,
            togglePerishable: ItemProvisionsApp._onTogglePerishable,
            switchTab: ItemProvisionsApp._onSwitchTab,
            auditorEdit: ItemProvisionsApp._onAuditorEdit,
            auditorClear: ItemProvisionsApp._onAuditorClear,
            auditorRefresh: ItemProvisionsApp._onAuditorRefresh,
            auditorFilter: ItemProvisionsApp._onAuditorFilter
        }
    };

    static PARTS = {
        body: {
            template: `modules/${MODULE_ID}/templates/item-provisions.hbs`
        }
    };

    /**
     * Open or focus the provisions configurator for a specific item.
     * @param {Item} [item]
     * @returns {ItemProvisionsApp|null}
     */
    static openForItem(item = null) {
        if (!game?.user?.isGM) {
            ui.notifications?.warn(game.i18n.localize("ionrift-respite.itemProvisions.gmOnly"));
            return null;
        }

        if (item && !ItemClassifier.isConfigurableItem(item)) {
            ui.notifications?.warn(game.i18n.format("ionrift-respite.itemProvisions.cannotConfigure", { name: item.name, type: item.type }));
            return null;
        }

        const existing = Object.values(ui.windows).find(
            w => w instanceof ItemProvisionsApp
        );

        if (existing) {
            if (item) {
                existing.setItem(item);
                existing.setTab("editor");
            }
            existing.render({ force: true });
            existing.bringToFront?.();
            return existing;
        }

        const app = new ItemProvisionsApp({
            item,
            initialTab: item ? "editor" : "auditor"
        });
        app.render({ force: true });
        return app;
    }

    /**
     * Open or focus the provisions configurator directly on the World Overrides audit tab.
     * @returns {ItemProvisionsApp|null}
     */
    static openAuditor() {
        if (!game?.user?.isGM) {
            ui.notifications?.warn(game.i18n.localize("ionrift-respite.itemProvisions.gmOnly"));
            return null;
        }

        const existing = Object.values(ui.windows).find(
            w => w instanceof ItemProvisionsApp
        );

        if (existing) {
            existing.setTab("auditor");
            existing.render({ force: true });
            existing.bringToFront?.();
            return existing;
        }

        const app = new ItemProvisionsApp({ initialTab: "auditor" });
        app.render({ force: true });
        return app;
    }

    constructor(options = {}) {
        super(options);
        if (options.item && ItemClassifier.isConfigurableItem(options.item)) {
            this._item = options.item;
        }
        if (options.initialTab) {
            this._activeTab = options.initialTab;
        }
    }

    /**
     * Switch active tab between "editor" and "auditor".
     * @param {"editor"|"auditor"} tab
     */
    setTab(tab) {
        this._activeTab = tab === "auditor" ? "auditor" : "editor";
        this.render({ force: true });
    }

    /**
     * Switch the active item being edited.
     * @param {Item} item
     */
    setItem(item) {
        if (!item) return;
        if (!ItemClassifier.isConfigurableItem(item)) {
            ui.notifications?.warn(game.i18n.format("ionrift-respite.itemProvisions.cannotConfigure", { name: item.name, type: item.type }));
            return;
        }
        this._item = item;
        this.render({ force: true });
    }

    /** @override */
    async _prepareContext(options = {}) {
        const auditorItems = ProvisionsAuditScanner.scanWorldOverrides();
        const auditorCount = auditorItems.length;

        const baseContext = {
            activeTab: this._activeTab,
            isEditorTab: this._activeTab === "editor",
            isAuditorTab: this._activeTab === "auditor",
            auditorCount,
            auditorItems,
            searchQuery: this._searchQuery,
            filterCategory: this._filterCategory
        };

        const item = this._item;
        if (!item || !ItemClassifier.isConfigurableItem(item)) {
            return {
                ...baseContext,
                hasItem: false
            };
        }

        const flags = item.flags?.[MODULE_ID] ?? {};
        const isLocked = item.compendium?.locked ?? false;

        // Context location label
        let sourceLocation = game.i18n.localize("ionrift-respite.itemProvisions.locationWorldItem");
        if (item.parent?.documentName === "Actor") {
            sourceLocation = game.i18n.format("ionrift-respite.itemProvisions.locationCarriedBy", { name: item.parent.name });
        } else if (item.compendium) {
            sourceLocation = game.i18n.format("ionrift-respite.itemProvisions.locationCompendium", { name: item.compendium.metadata?.label ?? item.compendium.collection });
        }

        const isContainer = ItemClassifier.isContainer(item);
        if (isContainer) {
            const coldStorage = flags.coldStorage ?? false;
            const preservationMultiplier = flags.preservationMultiplier !== undefined
                ? Number(flags.preservationMultiplier)
                : 2;
            const matchedPreset = ItemClassifier.getStorageTypePreset(preservationMultiplier);
            const selectedStoragePreset = matchedPreset ? matchedPreset.id : "custom";
            const isCustomMultiplier = selectedStoragePreset === "custom";

            const storagePresets = STORAGE_TYPES.map(preset => ({
                id: preset.id,
                label: preset.multiplier !== null ? game.i18n.format("ionrift-respite.itemProvisions.storagePresetLabel", { label: preset.label, badge: preset.badge }) : preset.label,
                multiplier: preset.multiplier,
                description: preset.description
            }));

            return {
                ...baseContext,
                hasItem: true,
                isContainer: true,
                isLocked,
                itemName: item.name,
                itemImg: item.img ?? "icons/svg/item-bag.svg",
                itemType: item.type,
                sourceLocation,
                coldStorage,
                preservationMultiplier,
                selectedStoragePreset,
                isCustomMultiplier,
                storagePresets
            };
        }

        // Current explicit or inferred values
        const currentType = flags.resourceType ?? "";
        const inferredType = ItemClassifier.classify(item) ?? "";

        const currentTag = flags.foodTag ?? "";
        const inferredTag = ItemClassifier.getFoodTag(item) ?? "";

        const currentDrink = flags.drinkType ?? "";
        const inferredDrink = ItemClassifier.getDrinkType(item) ?? "";

        // Spoilage
        const explicitSpoils = flags.spoilsAfter;
        const explicitSpoilsHours = flags.spoilsAfterHours;
        const inferredSpoils = ItemClassifier.getSpoilsAfter(item);

        let isPerishable = false;
        let spoilageUnit = "days";
        let spoilsValue = "";

        if (explicitSpoilsHours !== null && explicitSpoilsHours !== undefined && Number(explicitSpoilsHours) > 0) {
            isPerishable = true;
            spoilageUnit = "hours";
            spoilsValue = String(explicitSpoilsHours);
        } else if (explicitSpoils !== null && explicitSpoils !== undefined) {
            if (Number(explicitSpoils) > 0) {
                isPerishable = true;
                spoilageUnit = "days";
                spoilsValue = String(explicitSpoils);
            } else {
                // explicit 0 = shelf-stable
                isPerishable = false;
                spoilageUnit = "days";
                spoilsValue = "";
            }
        } else if (inferredSpoils !== null && inferredSpoils !== undefined && inferredSpoils > 0) {
            isPerishable = true;
            spoilageUnit = "days";
            spoilsValue = String(inferredSpoils);
        }

        // Satiates (hunger vs thirst)
        const rawSatiates = flags.satiates;
        let satiatesFood = false;
        let satiatesWater = false;

        if (Array.isArray(rawSatiates)) {
            satiatesFood = rawSatiates.includes("food");
            satiatesWater = rawSatiates.includes("water");
        } else {
            const effType = currentType || inferredType;
            if (effType === "water") satiatesWater = true;
            else satiatesFood = true;
        }

        return {
            ...baseContext,
            hasItem: true,
            isLocked,
            itemName: item.name,
            itemImg: item.img ?? "icons/svg/item-bag.svg",
            itemType: item.type,
            sourceLocation,
            resourceType: currentType,
            foodTag: currentTag,
            drinkType: currentDrink,
            isPerishable,
            spoilageUnit,
            spoilsValue: spoilsValue || "1",
            satiatesFood,
            satiatesWater,
            resourceTypeOptions: [
                { value: "", label: inferredType ? game.i18n.format("ionrift-respite.itemProvisions.autoDetectInferred", { type: inferredType }) : game.i18n.localize("ionrift-respite.itemProvisions.autoDetectNameSubtype") },
                { value: "food", label: game.i18n.localize("ionrift-respite.itemProvisions.typeRationFood") },
                { value: "water", label: game.i18n.localize("ionrift-respite.itemProvisions.typeDrinkingWater") },
                { value: "ingredient", label: game.i18n.localize("ionrift-respite.itemProvisions.typeCraftingIngredient") },
                { value: "fuel", label: game.i18n.localize("ionrift-respite.itemProvisions.typeCampFuel") },
                { value: "none", label: game.i18n.localize("ionrift-respite.itemProvisions.typeInedible") }
            ],
            foodTagOptions: [
                { value: "", label: inferredTag ? game.i18n.format("ionrift-respite.itemProvisions.foodTagInferred", { tag: inferredTag }) : game.i18n.localize("ionrift-respite.itemProvisions.foodTagUniversal") },
                { value: "meat", label: game.i18n.localize("ionrift-respite.itemProvisions.foodTagMeat") },
                { value: "plant", label: game.i18n.localize("ionrift-respite.itemProvisions.foodTagPlant") },
                { value: "prepared", label: game.i18n.localize("ionrift-respite.itemProvisions.foodTagPrepared") }
            ],
            drinkTypeOptions: [
                { value: "", label: inferredDrink ? game.i18n.format("ionrift-respite.itemProvisions.drinkTypeInferred", { drink: inferredDrink }) : game.i18n.localize("ionrift-respite.itemProvisions.drinkTypeDefault") },
                { value: "water", label: game.i18n.localize("ionrift-respite.itemProvisions.drinkTypeFreshWater") },
                { value: "alcohol", label: game.i18n.localize("ionrift-respite.itemProvisions.drinkTypeAlcohol") },
                { value: "oil", label: game.i18n.localize("ionrift-respite.itemProvisions.drinkTypeOil") }
            ]
        };
    }

    /** @override */
    _onRender(context, options) {
        super._onRender?.(context, options);

        const el = this.element;

        // Dropzones in editor
        const dropZones = el.querySelectorAll(".respite-item-dropzone");
        for (const zone of dropZones) {
            zone.addEventListener("dragover", this._onDragOver.bind(this));
            zone.addEventListener("dragleave", this._onDragLeave.bind(this));
            zone.addEventListener("drop", this._onDrop.bind(this));
        }

        if (!context.hasItem && this._activeTab === "editor") {
            el.addEventListener("dragover", this._onDragOver.bind(this));
            el.addEventListener("dragleave", this._onDragLeave.bind(this));
            el.addEventListener("drop", this._onDrop.bind(this));
        }

        // Auditor search filtering
        const searchInput = el.querySelector(".respite-auditor-search-input");
        if (searchInput) {
            searchInput.value = this._searchQuery;
            searchInput.addEventListener("input", (e) => {
                this._searchQuery = e.target.value;
                this._applyAuditorClientFilter(el);
            });
        }

        if (this._activeTab === "auditor") {
            this._applyAuditorClientFilter(el);
        }

        // Storage preset dropdown change
        const storagePresetSelect = el.querySelector('[name="storagePreset"]');
        const customMultiplierRow = el.querySelector(".respite-custom-multiplier-row");
        const customInput = el.querySelector('[name="customPreservationMultiplier"]');

        if (storagePresetSelect && customMultiplierRow) {
            storagePresetSelect.addEventListener("change", (e) => {
                const val = e.target.value;
                const isCustom = val === "custom";
                customMultiplierRow.style.display = isCustom ? "flex" : "none";
                if (!isCustom) {
                    const preset = STORAGE_TYPES.find(p => p.id === val);
                    if (preset && customInput && preset.multiplier !== null) {
                        customInput.value = preset.multiplier;
                    }
                }
            });
        }
    }

    _onDragOver(event) {
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        const zone = this.element.querySelector(".respite-item-dropzone");
        zone?.classList.add("drag-hover");
    }

    _onDragLeave(event) {
        const zone = this.element.querySelector(".respite-item-dropzone");
        zone?.classList.remove("drag-hover");
    }

    async _onDrop(event) {
        event.preventDefault();
        const zone = this.element.querySelector(".respite-item-dropzone");
        zone?.classList.remove("drag-hover");

        let data;
        try {
            data = JSON.parse(event.dataTransfer.getData("text/plain"));
        } catch {
            return;
        }

        if (data?.type !== "Item" || !data.uuid) {
            ui.notifications?.warn(game.i18n.localize("ionrift-respite.itemProvisions.warnOnlyItemDocs"));
            return;
        }

        const item = await fromUuid(data.uuid);
        if (!item || item.documentName !== "Item") {
            ui.notifications?.warn(game.i18n.localize("ionrift-respite.itemProvisions.warnCouldNotLoadItem"));
            return;
        }

        if (!ItemClassifier.isConfigurableItem(item)) {
            ui.notifications?.warn(game.i18n.format("ionrift-respite.itemProvisions.warnItemNotConfigurable", { name: item.name, type: item.type }));
            return;
        }

        this.setItem(item);
        this.setTab("editor");
    }

    static _onSwitchTab(event, target) {
        const tab = target.dataset.tab;
        if (tab) this.setTab(tab);
    }

    static async _onAuditorEdit(event, target) {
        const uuid = target.dataset.uuid;
        if (!uuid) return;
        const item = await fromUuid(uuid);
        if (!item) {
            ui.notifications?.warn(game.i18n.localize("ionrift-respite.itemProvisions.warnItemNotFound"));
            return;
        }
        this.setItem(item);
        this.setTab("editor");
    }

    static async _onAuditorClear(event, target) {
        const uuid = target.dataset.uuid;
        const name = target.dataset.name ?? "Item";
        if (!uuid) return;
        const item = await fromUuid(uuid);
        if (!item) return;

        await ProvisionsAuditScanner.clearItemOverrides(item);
        ui.notifications?.info(game.i18n.format("ionrift-respite.itemProvisions.infoClearedOverrides", { name }));
        this.render({ force: true });
    }

    static _onAuditorRefresh(event, target) {
        this.render({ force: true });
    }

    static _onAuditorFilter(event, target) {
        const category = target.dataset.category ?? "all";
        this._filterCategory = category;

        const pills = this.element.querySelectorAll(".respite-filter-pill");
        for (const pill of pills) {
            pill.classList.toggle("active", pill.dataset.category === category);
        }

        this._applyAuditorClientFilter(this.element);
    }

    _applyAuditorClientFilter(el) {
        const searchInput = el.querySelector(".respite-auditor-search-input");
        const query = (searchInput ? searchInput.value : (this._searchQuery ?? "")).toLowerCase().trim();
        const cat = this._filterCategory ?? "all";
        const rows = el.querySelectorAll(".respite-auditor-row");
        let visibleCount = 0;

        for (const row of rows) {
            const name = (row.dataset.name ?? "").toLowerCase();
            const loc = (row.dataset.location ?? "").toLowerCase();
            const type = (row.dataset.type ?? "").toLowerCase();
            const isShelf = row.dataset.shelf === "true";

            let matchesCat = true;
            if (cat === "food") matchesCat = type === "food";
            else if (cat === "water") matchesCat = type === "water";
            else if (cat === "ingredient") matchesCat = type === "ingredient";
            else if (cat === "fuel") matchesCat = type === "fuel";
            else if (cat === "container") matchesCat = type === "container";
            else if (cat === "shelf") matchesCat = isShelf;

            const matchesSearch = !query || name.includes(query) || loc.includes(query);

            const visible = matchesCat && matchesSearch;
            row.style.display = visible ? "" : "none";
            if (visible) visibleCount++;
        }

        const countEl = el.querySelector(".respite-auditor-visible-count");
        if (countEl) countEl.textContent = String(visibleCount);

        const noMatchesRow = el.querySelector(".respite-auditor-no-matches");
        if (noMatchesRow) {
            noMatchesRow.style.display = (visibleCount === 0 && rows.length > 0) ? "" : "none";
        }
    }

    static _onTogglePerishable(event, target) {
        const form = this.element;
        const perishableFields = form.querySelector(".respite-provisions-spoilage-fields");
        if (!perishableFields) return;
        const checked = target.checked;
        perishableFields.style.display = checked ? "flex" : "none";
    }

    static async _onSaveAction(event, target) {
        event.preventDefault();
        if (!this._item) return;

        if (this._item.compendium?.locked) {
            ui.notifications?.warn(game.i18n.localize("ionrift-respite.itemProvisions.warnCompendiumLocked"));
            return;
        }

        const form = this.element;

        if (ItemClassifier.isContainer(this._item)) {
            const coldStorage = form.querySelector('[name="coldStorage"]')?.checked ?? false;
            const presetId = form.querySelector('[name="storagePreset"]')?.value ?? "coolbox";
            let preservationMultiplier = 2;

            if (presetId === "custom") {
                const rawCustom = form.querySelector('[name="customPreservationMultiplier"]')?.value;
                const parsed = parseFloat(rawCustom);
                preservationMultiplier = !Number.isNaN(parsed) && parsed >= 0 ? parsed : 2;
            } else {
                const preset = STORAGE_TYPES.find(p => p.id === presetId);
                preservationMultiplier = preset && preset.multiplier !== null ? preset.multiplier : 2;
            }

            const updates = {
                [`flags.${MODULE_ID}.coldStorage`]: coldStorage,
                [`flags.${MODULE_ID}.preservationMultiplier`]: preservationMultiplier
            };
            try {
                await this._item.update(updates);
                refreshSpoilageBadgesOnOpenSheets();
                const multLabel = preservationMultiplier === 0
                    ? game.i18n.localize("ionrift-respite.itemProvisions.stasisNoSpoilage")
                    : game.i18n.format("ionrift-respite.itemProvisions.multiplierShelfLife", { mult: preservationMultiplier });
                const statusLabel = coldStorage
                    ? game.i18n.format("ionrift-respite.itemProvisions.coldStorageActive", { multLabel })
                    : game.i18n.localize("ionrift-respite.itemProvisions.coldStorageDisabled");
                ui.notifications?.info(game.i18n.format("ionrift-respite.itemProvisions.updatedStorageSettings", {
                    name: this._item.name,
                    status: statusLabel
                }));
                this.render({ force: true });
            } catch (err) {
                console.error(`${MODULE_ID} | Failed to update container storage settings:`, err);
                ui.notifications?.error(game.i18n.format("ionrift-respite.itemProvisions.errorUpdateFailed", { message: err.message }));
            }
            return;
        }
        const resourceType = form.querySelector('[name="resourceType"]')?.value || null;
        const foodTag = form.querySelector('[name="foodTag"]')?.value || null;
        const drinkType = form.querySelector('[name="drinkType"]')?.value || null;
        const isPerishable = form.querySelector('[name="isPerishable"]')?.checked ?? false;
        const spoilageUnit = form.querySelector('[name="spoilageUnit"]')?.value ?? "days";
        const spoilsValue = form.querySelector('[name="spoilsValue"]')?.value;
        const satiatesFood = form.querySelector('[name="satiatesFood"]')?.checked ?? false;
        const satiatesWater = form.querySelector('[name="satiatesWater"]')?.checked ?? false;

        let spoilsAfter = null;
        let spoilsAfterHours = null;

        if (isPerishable) {
            const parsed = parseInt(spoilsValue, 10);
            const num = !Number.isNaN(parsed) && parsed > 0 ? parsed : 1;
            if (spoilageUnit === "hours") {
                spoilsAfterHours = num;
                spoilsAfter = null;
            } else {
                spoilsAfter = num;
                spoilsAfterHours = null;
            }
        } else {
            // Explicit 0 signals shelf-stable, bypassing any foodTag defaults
            spoilsAfter = 0;
            spoilsAfterHours = null;
        }

        const satiates = [];
        if (satiatesFood) satiates.push("food");
        if (satiatesWater) satiates.push("water");

        const updates = {
            [`flags.${MODULE_ID}.resourceType`]: resourceType,
            [`flags.${MODULE_ID}.foodTag`]: foodTag,
            [`flags.${MODULE_ID}.drinkType`]: drinkType,
            [`flags.${MODULE_ID}.spoilsAfter`]: spoilsAfter,
            [`flags.${MODULE_ID}.spoilsAfterHours`]: spoilsAfterHours,
            [`flags.${MODULE_ID}.satiates`]: satiates.length ? satiates : null
        };

        // If the item is in an actor's inventory and perishable, stamp initial harvest date if missing
        if (isPerishable && this._item.parent?.documentName === "Actor") {
            const existingHarvest = this._item.flags?.[MODULE_ID]?.harvestedDate;
            if (!existingHarvest) {
                const harvestDate = spoilageUnit === "hours"
                    ? String(game.time.worldTime)
                    : (CalendarHandler.getCurrentDate() ?? String(game.time.worldTime));
                updates[`flags.${MODULE_ID}.harvestedDate`] = harvestDate;
            }
        }

        try {
            await this._item.update(updates);
            refreshSpoilageBadgesOnOpenSheets();
            ui.notifications?.info(game.i18n.format("ionrift-respite.itemProvisions.infoUpdatedProvisions", { name: this._item.name }));
            this.render({ force: true });
        } catch (err) {
            console.error(`${MODULE_ID} | Failed to update item provisions:`, err);
            ui.notifications?.error(game.i18n.format("ionrift-respite.itemProvisions.errorUpdateFailed", { message: err.message }));
        }
    }

    static async _onClearAction(event, target) {
        event.preventDefault();
        if (!this._item) return;

        if (this._item.compendium?.locked) {
            ui.notifications?.warn(game.i18n.localize("ionrift-respite.itemProvisions.warnCompendiumLocked"));
            return;
        }

        try {
            await ProvisionsAuditScanner.clearItemOverrides(this._item);
            ui.notifications?.info(game.i18n.format("ionrift-respite.itemProvisions.infoClearedProvisions", { name: this._item.name }));
            this.render({ force: true });
        } catch (err) {
            console.error(`${MODULE_ID} | Failed to clear item provisions:`, err);
            ui.notifications?.error(game.i18n.format("ionrift-respite.itemProvisions.errorClearFailed", { message: err.message }));
        }
    }
}
