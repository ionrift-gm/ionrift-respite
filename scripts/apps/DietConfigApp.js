import { ItemClassifier } from "../services/ItemClassifier.js";

const MODULE_ID = "ionrift-respite";

/**
 * DietConfigApp
 * GM-only roster-wide editor for per-character diet profiles.
 * Each row shows a character with a preset dropdown and expandable
 * detail fields for fine-tuning canEatTags, canDrink, exclusions, etc.
 *
 * Sustenance type is derived from the preset — food presets need food/water,
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
            title: "Diet Configuration",
            icon: "fas fa-utensils",
            resizable: true
        },
        position: { width: 520, height: 560 },
        classes: ["ionrift-window"]
    };

    static FOOD_TAG_LABELS = {
        meat: "Meat", plant: "Plant", prepared: "Prepared"
    };

    static FOOD_TAG_TIPS = {
        meat: "Animal protein: Fresh Meat, Fish, Eggs, Jerky",
        plant: "Foraged vegetation: Berries, Mushrooms, Herbs, Roots",
        prepared: "Processed food: Rations, Porridge, and cooked meals"
    };

    static DRINK_LABELS = {
        water: "Water", alcohol: "Alcohol", oil: "Oil / Fuel"
    };

    static RESOURCE_LABELS = {
        fuel: "Scrap"
    };

    constructor(options = {}) {
        super(options);
        if (options.actorId) this.#focusActorId = options.actorId;
    }

    /** @override */
    async _prepareContext() {
        const partyRoster = game.settings.get(MODULE_ID, "partyRoster") ?? [];
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
            const isEssence = (diet.sustenanceType ?? "food") === "essence";
            const isFood = !isEssence;
            const eatsFuel = diet.canEat.includes("fuel");

            return {
                id: actor.id,
                name: actor.name,
                img: actor.img ?? "icons/svg/mystery-man.svg",
                diet,
                presetId: presetMatch,
                expanded: this.#expanded.has(actor.id),
                isEssence,
                isFood,
                eatsFuel
            };
        });

        return { rows, presets, foodTags, drinkTypes, isSingleActor: !!this.#focusActorId };
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
            html += `
            <div class="diet-summary-bar">
                <span class="diet-summary-count">
                    <i class="fas fa-utensils"></i>
                    <strong>${context.rows.length}</strong> characters
                </span>
                <span class="diet-summary-hint">
                    Select a preset or expand to customise.
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
                        <span class="diet-actor-label">${row.diet.label}${row.isEssence ? ' <i class="fas fa-bolt diet-essence-icon"></i>' : ""}</span>
                    </div>
                    <select class="diet-preset-select" data-actor-id="${row.id}">
                        ${presetOptions}
                    </select>
                    <button type="button" class="diet-expand-btn" data-actor-id="${row.id}" title="Customise">
                        <i class="fas ${expandIcon}"></i>
                    </button>
                </div>`;

            if (row.expanded) {
                html += `<div class="diet-detail-panel" data-actor-id="${row.id}">`;

                if (row.isFood) {
                    // Food tags for biological characters
                    const canEatTags = row.diet.canEatTags ?? ["meat", "plant", "prepared"];
                    html += `
                    <div class="diet-field-row">
                        <label class="diet-field-label">Can eat</label>
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

                if (row.eatsFuel) {
                    html += `
                    <div class="diet-field-row">
                        <label class="diet-field-label">Can consume</label>
                        <div class="diet-tag-group">
                            <label class="diet-tag-label active">
                                <input type="checkbox" class="diet-can-eat-cb" data-actor-id="${row.id}" data-type="fuel" checked />
                                <span class="diet-tag-check"></span>
                                <span class="diet-tag-text">Scrap</span>
                            </label>
                        </div>
                    </div>`;
                }

                // Drink row (shown for everyone, relevant drinks differ by preset)
                html += `
                    <div class="diet-field-row">
                        <label class="diet-field-label">Can drink</label>
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
                    // Essence characters always show their custom items — that's the whole point
                    const essenceItems = (row.diet.customFoodNames ?? []).join(", ");
                    html += `
                    <div class="diet-essence-section">
                        <div class="diet-field-row">
                            <label class="diet-field-label"><i class="fas fa-bolt"></i> Essence items</label>
                            <input type="text" class="diet-text-input diet-custom-food" data-actor-id="${row.id}"
                                value="${essenceItems}"
                                placeholder="e.g. Soul Fragment, Mana Crystal, Incense" />
                        </div>
                        <span class="diet-essence-hint">
                            Items consumed each rest for sustenance. Failing to recharge reduces hit die recovery.
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
                            <label class="diet-field-label">Additional food items</label>
                            <input type="text" class="diet-text-input diet-custom-food" data-actor-id="${row.id}"
                                value="${(row.diet.customFoodNames ?? []).join(", ")}"
                                placeholder="e.g. Goodberries, Arcane Rations" />
                        </div>
                        <div class="diet-field-row">
                            <label class="diet-field-label">Additional drink items</label>
                            <input type="text" class="diet-text-input diet-custom-water" data-actor-id="${row.id}"
                                value="${(row.diet.customWaterNames ?? []).join(", ")}"
                                placeholder="e.g. Healing Tea" />
                        </div>
                        <div class="diet-field-row">
                            <label class="diet-field-label">Excluded items</label>
                            <input type="text" class="diet-text-input diet-exclude-names" data-actor-id="${row.id}"
                                value="${(row.diet.excludeNames ?? []).join(", ")}"
                                placeholder="e.g. Fresh Meat, Smoked Fish" />
                        </div>
                    </div>
                    ` : `
                    <button type="button" class="diet-show-custom-btn" data-actor-id="${row.id}">
                        <i class="fas fa-plus"></i> Add custom items or exclusions
                    </button>
                    `;
                }

                html += `</div>`;
            }

            html += `</div>`;
        }

        html += `</div>`;

        html += `
        <div class="diet-actions">
            <button type="button" class="diet-save-btn">
                <i class="fas fa-save"></i> Save Diets
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
            ui.notifications.info(`Diet profiles saved for ${saved} character${saved !== 1 ? "s" : ""}.`);
        } else {
            ui.notifications.info("No changes to save.");
        }

        this.close();
    }

    _getAllDiets() {
        const partyRoster = game.settings.get(MODULE_ID, "partyRoster") ?? [];
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
            const d = new Dialog({
                title: "Sustenance Imbalance",
                content: `
                    <div class="diet-balance-warning">
                        <p><i class="fas fa-exclamation-triangle"></i>
                        <strong>${names.join(", ")}</strong> ${names.length === 1 ? "has" : "have"} sustenance set to <strong>None</strong>
                        , while other characters still need food, water, or essence.</p>
                        <p>This may create an imbalance. Consider switching to <strong>Essence</strong>
                        so non-biological characters still face resource pressure.</p>
                    </div>`,
                buttons: {
                    essence: {
                        icon: '<i class="fas fa-bolt"></i>',
                        label: "Switch to Essence",
                        callback: () => resolve("add-essence")
                    },
                    save: {
                        icon: '<i class="fas fa-save"></i>',
                        label: "Save anyway",
                        callback: () => resolve("save")
                    },
                    cancel: {
                        icon: '<i class="fas fa-times"></i>',
                        label: "Go back",
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
            const d = new Dialog({
                title: "Empty Diet",
                content: `
                    <div class="diet-balance-warning">
                        <p><i class="fas fa-exclamation-triangle"></i>
                        <strong>${names.join(", ")}</strong> ${plural ? "require" : "requires"} sustenance
                        but ${plural ? "have" : "has"} <strong>no food, drink, or essence items</strong> configured.</p>
                        <p>${plural ? "These characters" : "This character"} won't be able to consume anything during rest
                        and will eventually gain exhaustion.</p>
                    </div>`,
                buttons: {
                    save: {
                        icon: '<i class="fas fa-save"></i>',
                        label: "Save anyway",
                        callback: () => resolve("save")
                    },
                    cancel: {
                        icon: '<i class="fas fa-times"></i>',
                        label: "Go back and fix",
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
            if (diet.label === merged.label
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
