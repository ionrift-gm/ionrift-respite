import { ItemClassifier } from "../../services/party/ItemClassifier.js";
import { MODULE_ID } from "../../data/moduleId.js";

/**
 * DietConfigApp
 * GM-only roster-wide editor for per-character diet profiles.
 * Each row shows a character with a preset dropdown and expandable
 * detail fields for fine-tuning canEatTags, canDrink, exclusions, etc.
 *
 * Sustenance type is derived from the preset. Food presets need food/water,
 * essence presets (Construct, Undead, Celestial, Elemental) need essence items.
 * No separate sustenance toggle; the preset IS the declaration.
 */
export class DietConfigApp extends foundry.applications.api.ApplicationV2 {

    #focusActorId = null;
    #expanded = new Set();
    #working = new Map();
    #scrollTop = 0;

    static DEFAULT_OPTIONS = {
        id: "respite-diet-config",
        window: {
            title: "ionrift-respite.dietConfig.windowTitle",
            icon: "fas fa-utensils",
            resizable: true
        },
        position: { width: 520, height: 560 },
        classes: ["ionrift-window"]
    };

    static get FOOD_TAG_LABELS() {
        return {
            meat: game.i18n.localize("ionrift-respite.dietConfig.tagMeat"),
            plant: game.i18n.localize("ionrift-respite.dietConfig.tagPlant"),
            prepared: game.i18n.localize("ionrift-respite.dietConfig.tagPrepared")
        };
    }

    static get FOOD_TAG_TIPS() {
        return {
            meat: game.i18n.localize("ionrift-respite.dietConfig.tipMeat"),
            plant: game.i18n.localize("ionrift-respite.dietConfig.tipPlant"),
            prepared: game.i18n.localize("ionrift-respite.dietConfig.tipPrepared")
        };
    }

    static get DRINK_LABELS() {
        return {
            water: game.i18n.localize("ionrift-respite.dietConfig.drinkWater"),
            alcohol: game.i18n.localize("ionrift-respite.dietConfig.drinkAlcohol"),
            oil: game.i18n.localize("ionrift-respite.dietConfig.drinkOil")
        };
    }

    static get RESOURCE_LABELS() {
        return {
            fuel: game.i18n.localize("ionrift-respite.dietConfig.resourceFuel")
        };
    };

    constructor(options = {}) {
        super(options);
        if (options.actorId) this.#focusActorId = options.actorId;
    }

    /** @override */
    async _prepareContext() {
        const partyRoster = game.ionrift?.library?.party?.getRosterIds() ?? [];
        let actors;
        if (this.#focusActorId) {
            const a = game.actors.get(this.#focusActorId);
            actors = a ? [a] : [];
        } else if (partyRoster.length) {
            actors = partyRoster.map(id => game.actors.get(id)).filter(Boolean);
        } else {
            actors = game.actors.filter(a => a.hasPlayerOwner && a.type === "character");
        }

        const presets = ItemClassifier.getPresets();
        const foodTags = [...ItemClassifier.FOOD_TAGS];
        const drinkTypes = [...ItemClassifier.DRINK_TYPES];

        const rows = actors.map(actor => {
            const diet = this.#working.has(actor.id)
                ? this.#working.get(actor.id)
                : ItemClassifier.getDiet(actor);

            const presetMatch = this._detectPreset(diet);
            const sType = diet.sustenanceType ?? "food";
            const isNone = sType === "none";
            const isEssence = sType === "essence";
            const isFood = !isEssence && !isNone;
            const eatsFuel = diet.canEat.includes("fuel");

            return {
                id: actor.id,
                name: actor.name,
                img: actor.img ?? "icons/svg/mystery-man.svg",
                diet,
                presetId: presetMatch,
                expanded: this.#expanded.has(actor.id),
                isNone,
                isEssence,
                isFood,
                eatsFuel
            };
        });

        return {
            rows,
            presets,
            foodTags,
            drinkTypes,
            isSingleActor: !!this.#focusActorId,
            trackFood: game.settings.get(MODULE_ID, "trackFood"),
            partialSustenance: game.settings.get(MODULE_ID, "partialSustenance"),
            spoilageNameSuffix: game.settings.get(MODULE_ID, "spoilageNameSuffix")
        };
    }

    /** @override */
    async _renderHTML(context) {
        const el = document.createElement("div");
        el.classList.add("respite-diet-config");

        const ftLabel = (t) => DietConfigApp.FOOD_TAG_LABELS[t] ?? t;
        const ftTip = (t) => DietConfigApp.FOOD_TAG_TIPS[t] ?? "";
        const dkLabel = (t) => DietConfigApp.DRINK_LABELS[t] ?? t;

        let html = "";

        if (!context.isSingleActor) {
            const trackOn = context.trackFood;
            const partialDisabled = trackOn ? "" : "disabled";
            html += `
            <div class="diet-global-section">
                <div class="diet-global-title">
                    <i class="fas fa-drumstick-bite"></i> ${game.i18n.localize("ionrift-respite.dietConfig.globalMealTracking")}
                </div>
                <label class="diet-global-toggle">
                    <input type="checkbox" class="diet-track-food-cb" ${trackOn ? "checked" : ""} />
                    <span class="diet-global-switch"></span>
                    <span class="diet-global-copy">
                        <span class="diet-global-name">${game.i18n.localize("ionrift-respite.dietConfig.trackFoodWater")}</span>
                        <span class="diet-global-hint">${game.i18n.localize("ionrift-respite.dietConfig.trackFoodWaterHint")}</span>
                    </span>
                </label>
                <label class="diet-global-toggle ${trackOn ? "" : "is-disabled"}">
                    <input type="checkbox" class="diet-partial-cb" ${context.partialSustenance ? "checked" : ""} ${partialDisabled} />
                    <span class="diet-global-switch"></span>
                    <span class="diet-global-copy">
                        <span class="diet-global-name">${game.i18n.localize("ionrift-respite.dietConfig.partialSustenance")}</span>
                        <span class="diet-global-hint">${game.i18n.localize("ionrift-respite.dietConfig.partialSustenanceHint")}</span>
                    </span>
                </label>
                <label class="diet-global-toggle">
                    <input type="checkbox" class="diet-spoilage-suffix-cb" ${context.spoilageNameSuffix ? "checked" : ""} />
                    <span class="diet-global-switch"></span>
                    <span class="diet-global-copy">
                        <span class="diet-global-name">${game.i18n.localize("ionrift-respite.dietConfig.spoilageSuffix")}</span>
                        <span class="diet-global-hint">${game.i18n.localize("ionrift-respite.dietConfig.spoilageSuffixHint")}</span>
                    </span>
                </label>
            </div>`;

            html += `
            <div class="diet-summary-bar">
                <span class="diet-summary-count">
                    <i class="fas fa-utensils"></i>
                    ${game.i18n.format("ionrift-respite.dietConfig.charactersCount", { count: `<strong>${context.rows.length}</strong>` })}
                </span>
                <span class="diet-summary-hint">
                    ${game.i18n.localize("ionrift-respite.dietConfig.summaryHint")}
                </span>
            </div>`;
        }

        html += `<div class="diet-actor-list">`;

        for (const row of context.rows) {
            const presetOptions = context.presets.map(p =>
                `<option value="${p.id}" ${row.presetId === p.id ? "selected" : ""}>${p.label}</option>`
            ).join("");

            const expandIcon = row.expanded ? "fa-chevron-up" : "fa-chevron-down";

            html += `
            <div class="diet-actor-card ${row.expanded ? "expanded" : ""}" data-actor-id="${row.id}">
                <div class="diet-actor-header">
                    <img class="diet-actor-portrait" src="${row.img}" alt="${row.name}" />
                    <div class="diet-actor-info">
                        <span class="diet-actor-name">${row.name}</span>
                        <span class="diet-actor-label">${row.diet.label}${row.isEssence ? ' <i class="fas fa-bolt diet-essence-icon"></i>' : ""}${row.isNone ? ` <i class="fas fa-ban diet-none-icon" title="${game.i18n.localize("ionrift-respite.dietConfig.noSustenanceRequired")}"></i>` : ""}</span>
                    </div>
                    <select class="diet-preset-select" data-actor-id="${row.id}">
                        ${presetOptions}
                    </select>
                    <button type="button" class="diet-expand-btn" data-actor-id="${row.id}" title="${game.i18n.localize("ionrift-respite.dietConfig.customise")}">
                        <i class="fas ${expandIcon}"></i>
                    </button>
                </div>`;

            if (row.expanded) {
                html += `<div class="diet-detail-panel" data-actor-id="${row.id}">`;

                if (row.isNone) {
                    html += `
                    <div class="diet-none-hint">
                        <i class="fas fa-info-circle"></i>
                        ${game.i18n.localize("ionrift-respite.dietConfig.noneHint")}
                    </div>`;
                } else if (row.isFood) {
                    // Food tags for biological characters
                    const canEatTags = row.diet.canEatTags ?? ["meat", "plant", "prepared"];
                    html += `
                    <div class="diet-field-row">
                        <label class="diet-field-label">${game.i18n.localize("ionrift-respite.dietConfig.canEat")}</label>
                        <div class="diet-tag-group">
                            ${context.foodTags.map(t => {
                                const active = canEatTags.includes(t);
                                return `<label class="diet-tag-label ${active ? "active" : ""}" title="${ftTip(t)}">
                                    <input type="checkbox" class="diet-food-tag-cb" data-actor-id="${row.id}" data-tag="${t}" ${active ? "checked" : ""} />
                                    <span class="diet-tag-check"></span>
                                    <span class="diet-tag-text">${ftLabel(t)}</span>
                                </label>`;
                            }).join("")}
                        </div>
                    </div>`;
                }

                if (!row.isNone) {
                if (row.eatsFuel) {
                    html += `
                    <div class="diet-field-row">
                        <label class="diet-field-label">${game.i18n.localize("ionrift-respite.dietConfig.canConsume")}</label>
                        <div class="diet-tag-group">
                            <label class="diet-tag-label active">
                                <input type="checkbox" class="diet-can-eat-cb" data-actor-id="${row.id}" data-type="fuel" checked />
                                <span class="diet-tag-check"></span>
                                <span class="diet-tag-text">${game.i18n.localize("ionrift-respite.dietConfig.resourceFuel")}</span>
                            </label>
                        </div>
                    </div>`;
                }

                // Drink row (shown for everyone, relevant drinks differ by preset)
                html += `
                    <div class="diet-field-row">
                        <label class="diet-field-label">${game.i18n.localize("ionrift-respite.dietConfig.canDrink")}</label>
                        <div class="diet-tag-group">
                            ${context.drinkTypes.map(t => {
                                const active = row.diet.canDrink.includes(t);
                                return `<label class="diet-tag-label ${active ? "active" : ""}">
                                    <input type="checkbox" class="diet-can-drink-cb" data-actor-id="${row.id}" data-type="${t}" ${active ? "checked" : ""} />
                                    <span class="diet-tag-check"></span>
                                    <span class="diet-tag-text">${dkLabel(t)}</span>
                                </label>`;
                            }).join("")}
                        </div>
                    </div>`;

                if (row.isEssence) {
                    // Essence characters always show their custom items. That's the whole point.
                    const essenceItems = (row.diet.customFoodNames ?? []).join(", ");
                    html += `
                    <div class="diet-essence-section">
                        <div class="diet-field-row">
                            <label class="diet-field-label"><i class="fas fa-bolt"></i> ${game.i18n.localize("ionrift-respite.dietConfig.essenceItems")}</label>
                            <input type="text" class="diet-text-input diet-custom-food" data-actor-id="${row.id}"
                                value="${essenceItems}"
                                placeholder="${game.i18n.localize("ionrift-respite.dietConfig.placeholderEssence")}" />
                        </div>
                        <span class="diet-essence-hint">
                            ${game.i18n.localize("ionrift-respite.dietConfig.essenceHint")}
                        </span>
                    </div>`;
                } else {
                    // Food characters get the optional custom fields
                    const hasCustomFood = (row.diet.customFoodNames ?? []).length > 0;
                    const hasCustomWater = (row.diet.customWaterNames ?? []).length > 0;
                    const hasExclusions = (row.diet.excludeNames ?? []).length > 0;
                    const isCustom = row.presetId === "custom";
                    const showCustomFields = isCustom || hasCustomFood || hasCustomWater || hasExclusions
                        || this._forceCustomFields?.has(row.id);

                    html += showCustomFields ? `
                    <div class="diet-custom-section">
                        <div class="diet-field-row">
                            <label class="diet-field-label">${game.i18n.localize("ionrift-respite.dietConfig.additionalFood")}</label>
                            <input type="text" class="diet-text-input diet-custom-food" data-actor-id="${row.id}"
                                value="${(row.diet.customFoodNames ?? []).join(", ")}"
                                placeholder="${game.i18n.localize("ionrift-respite.dietConfig.placeholderFood")}" />
                        </div>
                        <div class="diet-field-row">
                            <label class="diet-field-label">${game.i18n.localize("ionrift-respite.dietConfig.additionalDrink")}</label>
                            <input type="text" class="diet-text-input diet-custom-water" data-actor-id="${row.id}"
                                value="${(row.diet.customWaterNames ?? []).join(", ")}"
                                placeholder="${game.i18n.localize("ionrift-respite.dietConfig.placeholderDrink")}" />
                        </div>
                        <div class="diet-field-row">
                            <label class="diet-field-label">${game.i18n.localize("ionrift-respite.dietConfig.excludedItems")}</label>
                            <input type="text" class="diet-text-input diet-exclude-names" data-actor-id="${row.id}"
                                value="${(row.diet.excludeNames ?? []).join(", ")}"
                                placeholder="${game.i18n.localize("ionrift-respite.dietConfig.placeholderExclusions")}" />
                        </div>
                    </div>
                    ` : `
                    <button type="button" class="diet-show-custom-btn" data-actor-id="${row.id}">
                        <i class="fas fa-plus"></i> ${game.i18n.localize("ionrift-respite.dietConfig.addCustomItems")}
                    </button>
                    `;
                }
                }

                html += `</div>`;
            }

            html += `</div>`;
        }

        html += `</div>`;

        html += `
        <div class="diet-actions">
            <button type="button" class="diet-save-btn">
                <i class="fas fa-save"></i> ${game.i18n.localize("ionrift-respite.dietConfig.saveDiets")}
            </button>
        </div>`;

        el.innerHTML = html;
        this._wireEvents(el, context);
        return el;
    }

    /** @override */
    _replaceHTML(result, content, options) {
        const list = content.querySelector(".diet-actor-list");
        if (list) this.#scrollTop = list.scrollTop;

        content.replaceChildren(result);

        const newList = content.querySelector(".diet-actor-list");
        if (newList && this.#scrollTop > 0) {
            newList.scrollTop = this.#scrollTop;
        }
    }

    _wireEvents(el, context) {
        el.querySelector(".diet-track-food-cb")?.addEventListener("change", async (ev) => {
            await game.settings.set(MODULE_ID, "trackFood", ev.target.checked);
            this.render({ force: true });
        });

        el.querySelector(".diet-partial-cb")?.addEventListener("change", async (ev) => {
            await game.settings.set(MODULE_ID, "partialSustenance", ev.target.checked);
        });

        el.querySelector(".diet-spoilage-suffix-cb")?.addEventListener("change", async (ev) => {
            await game.settings.set(MODULE_ID, "spoilageNameSuffix", ev.target.checked);
        });

        el.querySelectorAll(".diet-preset-select").forEach(sel => {
            sel.addEventListener("change", () => {
                const actorId = sel.dataset.actorId;
                const presetId = sel.value;
                const preset = ItemClassifier.DIET_PRESETS[presetId];
                if (!preset) return;

                const merged = { ...ItemClassifier.DEFAULT_DIET, ...preset };
                this.#working.set(actorId, merged);
                this.render({ force: true });
            });
        });

        el.querySelectorAll(".diet-expand-btn").forEach(btn => {
            btn.addEventListener("click", () => {
                const actorId = btn.dataset.actorId;
                if (this.#expanded.has(actorId)) {
                    this.#expanded.delete(actorId);
                } else {
                    this.#expanded.add(actorId);
                    this._ensureWorking(actorId);
                }
                this.render({ force: true });
            });
        });

        el.querySelectorAll(".diet-food-tag-cb").forEach(cb => {
            cb.addEventListener("change", () => {
                const actorId = cb.dataset.actorId;
                this._ensureWorking(actorId);
                const diet = this.#working.get(actorId);
                const tag = cb.dataset.tag;
                if (!diet.canEatTags) diet.canEatTags = [...(ItemClassifier.DEFAULT_DIET.canEatTags)];
                if (cb.checked && !diet.canEatTags.includes(tag)) {
                    diet.canEatTags = [...diet.canEatTags, tag];
                } else if (!cb.checked) {
                    diet.canEatTags = diet.canEatTags.filter(t => t !== tag);
                }
                this._markCustom(actorId);
                cb.closest(".diet-tag-label")?.classList.toggle("active", cb.checked);
            });
        });

        el.querySelectorAll(".diet-can-eat-cb").forEach(cb => {
            cb.addEventListener("change", () => {
                const actorId = cb.dataset.actorId;
                this._ensureWorking(actorId);
                const diet = this.#working.get(actorId);
                const type = cb.dataset.type;
                if (cb.checked && !diet.canEat.includes(type)) {
                    diet.canEat = [...diet.canEat, type];
                } else if (!cb.checked) {
                    diet.canEat = diet.canEat.filter(t => t !== type);
                }
                this._markCustom(actorId);
                cb.closest(".diet-tag-label")?.classList.toggle("active", cb.checked);
            });
        });

        el.querySelectorAll(".diet-can-drink-cb").forEach(cb => {
            cb.addEventListener("change", () => {
                const actorId = cb.dataset.actorId;
                this._ensureWorking(actorId);
                const diet = this.#working.get(actorId);
                const type = cb.dataset.type;
                if (cb.checked && !diet.canDrink.includes(type)) {
                    diet.canDrink = [...diet.canDrink, type];
                } else if (!cb.checked) {
                    diet.canDrink = diet.canDrink.filter(t => t !== type);
                }
                this._markCustom(actorId);
                cb.closest(".diet-tag-label")?.classList.toggle("active", cb.checked);
            });
        });

        el.querySelectorAll(".diet-custom-food").forEach(input => {
            input.addEventListener("change", () => {
                const actorId = input.dataset.actorId;
                this._ensureWorking(actorId);
                this.#working.get(actorId).customFoodNames = this._parseCommaSeparated(input.value);
                this._markCustom(actorId);
            });
        });

        el.querySelectorAll(".diet-custom-water").forEach(input => {
            input.addEventListener("change", () => {
                const actorId = input.dataset.actorId;
                this._ensureWorking(actorId);
                this.#working.get(actorId).customWaterNames = this._parseCommaSeparated(input.value);
                this._markCustom(actorId);
            });
        });

        el.querySelectorAll(".diet-exclude-names").forEach(input => {
            input.addEventListener("change", () => {
                const actorId = input.dataset.actorId;
                this._ensureWorking(actorId);
                this.#working.get(actorId).excludeNames = this._parseCommaSeparated(input.value);
                this._markCustom(actorId);
            });
        });

        el.querySelectorAll(".diet-show-custom-btn").forEach(btn => {
            btn.addEventListener("click", () => {
                const actorId = btn.dataset.actorId;
                this._ensureWorking(actorId);
                this._forceCustomFields ??= new Set();
                this._forceCustomFields.add(actorId);
                this.render({ force: true });
            });
        });

        el.querySelector(".diet-save-btn")?.addEventListener("click", () => this._onSave());
    }

    async _onSave() {
        const allDiets = this._getAllDiets();
        const getSType = (d) => d.diet.sustenanceType ?? "food";
        const hasNeedy = allDiets.some(d => getSType(d) !== "none");
        const hasNone = allDiets.some(d => getSType(d) === "none");

        // Warn about characters that require sustenance but have no way to get it.
        // canEat: ["food"] is only useful if canEatTags has at least one tag;
        // canEat: ["fuel"]/["ingredient"] are only useful alongside customFoodNames.
        const emptyDietNames = allDiets.filter(d => {
            const sType = getSType(d);
            if (sType === "none") return false;
            const diet = d.diet;
            const canEat = diet.canEat ?? [];
            const tags = diet.canEatTags ?? [];
            const customFood = diet.customFoodNames ?? [];
            const canDrink = diet.canDrink ?? [];
            const customDrink = diet.customWaterNames ?? [];

            const hasFoodByTag = canEat.includes("food") && tags.length > 0;
            const hasFoodByCustom = customFood.length > 0;
            const hasEatSources = hasFoodByTag || hasFoodByCustom;

            const hasDrinkSources = canDrink.length > 0 || customDrink.length > 0;

            return !hasEatSources && !hasDrinkSources;
        }).map(d => d.name);

        if (emptyDietNames.length > 0) {
            const proceed = await this._showEmptyDietWarning(emptyDietNames);
            if (proceed === "cancel") return;
        }

        if (hasNeedy && hasNone) {
            const noneNames = allDiets.filter(d => getSType(d) === "none").map(d => d.name);
            const proceed = await this._showBalanceWarning(noneNames);
            if (proceed === "cancel") return;
            if (proceed === "add-essence") {
                for (const d of allDiets) {
                    if (getSType(d) === "none") {
                        this._ensureWorking(d.id);
                        this.#working.get(d.id).sustenanceType = "essence";
                    }
                }
            }
        }

        let saved = 0;
        for (const [actorId, diet] of this.#working) {
            const actor = game.actors.get(actorId);
            if (!actor) continue;
            await ItemClassifier.setDiet(actor, diet);
            saved++;
        }

        if (saved > 0) {
            const msg = saved === 1
                ? game.i18n.format("ionrift-respite.dietConfig.savedSingle", { count: saved })
                : game.i18n.format("ionrift-respite.dietConfig.savedPlural", { count: saved });
            ui.notifications.info(msg);
        } else {
            ui.notifications.info(game.i18n.localize("ionrift-respite.dietConfig.noChangesToSave"));
        }

        this.close();
    }

    _getAllDiets() {
        const partyRoster = game.ionrift?.library?.party?.getRosterIds() ?? [];
        let actors;
        if (this.#focusActorId) {
            const a = game.actors.get(this.#focusActorId);
            actors = a ? [a] : [];
        } else if (partyRoster.length) {
            actors = partyRoster.map(id => game.actors.get(id)).filter(Boolean);
        } else {
            actors = game.actors.filter(a => a.hasPlayerOwner && a.type === "character");
        }
        return actors.map(a => ({
            id: a.id,
            name: a.name,
            diet: this.#working.has(a.id) ? this.#working.get(a.id) : ItemClassifier.getDiet(a)
        }));
    }

    async _showBalanceWarning(names) {
        return new Promise(resolve => {
            const verb = names.length === 1
                ? game.i18n.localize("ionrift-respite.dietConfig.has")
                : game.i18n.localize("ionrift-respite.dietConfig.have");
            const d = new Dialog({
                title: game.i18n.localize("ionrift-respite.dietConfig.imbalanceTitle"),
                content: `
                    <div class="diet-balance-warning">
                        <p><i class="fas fa-exclamation-triangle"></i>
                        ${game.i18n.format("ionrift-respite.dietConfig.imbalanceBody1", { names: `<strong>${names.join(", ")}</strong>`, verb })}</p>
                        <p>${game.i18n.localize("ionrift-respite.dietConfig.imbalanceBody2")}</p>
                    </div>`,
                buttons: {
                    essence: {
                        icon: '<i class="fas fa-bolt"></i>',
                        label: game.i18n.localize("ionrift-respite.dietConfig.btnSwitchToEssence"),
                        callback: () => resolve("add-essence")
                    },
                    save: {
                        icon: '<i class="fas fa-save"></i>',
                        label: game.i18n.localize("ionrift-respite.dietConfig.btnSaveAnyway"),
                        callback: () => resolve("save")
                    },
                    cancel: {
                        icon: '<i class="fas fa-times"></i>',
                        label: game.i18n.localize("ionrift-respite.dietConfig.btnGoBack"),
                        callback: () => resolve("cancel")
                    }
                },
                default: "essence",
                close: () => resolve("cancel")
            }, { classes: ["ionrift-window", "dialog"] });
            d.render(true);
        });
    }

    async _showEmptyDietWarning(names) {
        return new Promise(resolve => {
            const plural = names.length > 1;
            const reqVerb = plural
                ? game.i18n.localize("ionrift-respite.dietConfig.require")
                : game.i18n.localize("ionrift-respite.dietConfig.requires");
            const haveVerb = plural
                ? game.i18n.localize("ionrift-respite.dietConfig.have")
                : game.i18n.localize("ionrift-respite.dietConfig.has");
            const charSubject = plural
                ? game.i18n.localize("ionrift-respite.dietConfig.theseCharacters")
                : game.i18n.localize("ionrift-respite.dietConfig.thisCharacter");
            const d = new Dialog({
                title: game.i18n.localize("ionrift-respite.dietConfig.emptyDietTitle"),
                content: `
                    <div class="diet-balance-warning">
                        <p><i class="fas fa-exclamation-triangle"></i>
                        ${game.i18n.format("ionrift-respite.dietConfig.emptyDietBody1", { names: `<strong>${names.join(", ")}</strong>`, require: reqVerb, have: haveVerb })}</p>
                        <p>${game.i18n.format("ionrift-respite.dietConfig.emptyDietBody2", { subject: charSubject })}</p>
                    </div>`,
                buttons: {
                    save: {
                        icon: '<i class="fas fa-save"></i>',
                        label: game.i18n.localize("ionrift-respite.dietConfig.btnSaveAnyway"),
                        callback: () => resolve("save")
                    },
                    cancel: {
                        icon: '<i class="fas fa-times"></i>',
                        label: game.i18n.localize("ionrift-respite.dietConfig.btnGoBackAndFix"),
                        callback: () => resolve("cancel")
                    }
                },
                default: "cancel",
                close: () => resolve("cancel")
            }, { classes: ["ionrift-window", "dialog"] });
            d.render(true);
        });
    }

    _ensureWorking(actorId) {
        if (this.#working.has(actorId)) return;
        const actor = game.actors.get(actorId);
        this.#working.set(actorId, { ...ItemClassifier.getDiet(actor) });
    }

    _markCustom(actorId) {
        const diet = this.#working.get(actorId);
        if (!diet) return;
        const detected = this._detectPreset(diet);
        if (detected === "custom") {
            diet.label = "Custom";
        }
    }

    _detectPreset(diet) {
        const dietSType = diet.sustenanceType ?? "food";

        for (const [id, preset] of Object.entries(ItemClassifier.DIET_PRESETS)) {
            if (id === "custom") continue;
            const merged = { ...ItemClassifier.DEFAULT_DIET, ...preset };
            const mergedSType = merged.sustenanceType ?? "food";
            const labelMatch = (diet.presetId && diet.presetId === id)
                || diet.label === merged.label
                || (id === "construct" && diet.label === "Construct")
                || (id === "maintenance" && diet.label === "Construct (Maintenance)");
            if (labelMatch
                && this._arraysEqual(diet.canEat, merged.canEat)
                && this._arraysEqual(diet.canEatTags ?? [], merged.canEatTags ?? [])
                && this._arraysEqual(diet.canDrink, merged.canDrink)
                && this._arraysEqual(diet.customFoodNames, merged.customFoodNames)
                && this._arraysEqual(diet.customWaterNames, merged.customWaterNames)
                && this._arraysEqual(diet.excludeNames, merged.excludeNames)
                && dietSType === mergedSType) {
                return id;
            }
        }
        return "custom";
    }

    _arraysEqual(a, b) {
        if (!Array.isArray(a) || !Array.isArray(b)) return a === b;
        if (a.length !== b.length) return false;
        const sa = [...a].sort();
        const sb = [...b].sort();
        return sa.every((v, i) => v === sb[i]);
    }

    _parseCommaSeparated(str) {
        return (str ?? "")
            .split(",")
            .map(s => s.trim().toLowerCase())
            .filter(s => s.length > 0);
    }
}
