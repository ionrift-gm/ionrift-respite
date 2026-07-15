import { TerrainRegistry } from "../../services/events/resolve/TerrainRegistry.js";
import { getEventPoolSelection, loadAllCatalogEvents } from "../../services/events/catalog/EventCatalogLoader.js";
import {
    buildEventPoolFilterGroups,
    eventMatchesPoolFilter,
    normalizeEventPoolFilter,
    parseEventPoolFilter
} from "../../services/events/catalog/EventPackCatalog.js";
import { importEventPackFromFile } from "../../services/events/catalog/EventPackImportService.js";
import { MODULE_ID } from "../../data/moduleId.js";

/**
 * EventBrowserApp
 * GM-only event pool curation tool with per-event opt-in toggles.
 * Accessed from module settings or Content Packs.
 */
export class EventBrowserApp extends foundry.applications.api.ApplicationV2 {

    /** All loaded events (post-filter). */
    #events = [];
    /** Current event index for detail view. */
    #index = 0;
    /** Active terrain filter (null = all). */
    #terrainFilter = null;
    /** Raw event data before filtering. */
    #allEvents = [];
    /** Pending selection before Save ({ id: true }). */
    #pendingSelection = {};
    /** Whether pending selection differs from saved setting. */
    #dirty = false;
    /** Index shown on the previous render, used to decide detail scroll reset. */
    #renderedIndex = -1;
    /** When true, the next render resets scroll to the top (terrain switch). */
    #resetScroll = false;

    static DEFAULT_OPTIONS = {
        id: "respite-event-browser",
        window: {
            title: "Event Pool",
            icon: "fas fa-book-open",
            resizable: true
        },
        position: { width: 720, height: 560 },
        classes: ["ionrift-window", "glass-ui", "ionrift-respite-app"]
    };

    constructor(options = {}) {
        super(options);
        if (options.terrainFilter) {
            this.#terrainFilter = options.terrainFilter;
        }
    }

    /** @override */
    async _prepareContext() {
        await TerrainRegistry.init();
        if (this.#allEvents.length === 0) {
            await this.#loadEvents();
            this.#pendingSelection = { ...getEventPoolSelection() };
            this.#dirty = false;
        }
        this.#applyFilter();

        const event = this.#events[this.#index] ?? null;
        const poolCount = Object.keys(this.#pendingSelection).length;
        const filteredPoolCount = this.#events.filter(evt => this.#pendingSelection[evt.id]).length;
        const activeFilterParsed = parseEventPoolFilter(this.#terrainFilter);
        const terrainPoolCount = this.#terrainFilter
            ? this.#allEvents.filter(evt =>
                eventMatchesPoolFilter(evt, activeFilterParsed) && this.#pendingSelection[evt.id]
            ).length
            : null;

        return {
            event,
            index: this.#index,
            total: this.#events.length,
            terrainOptionGroups: buildEventPoolFilterGroups(this.#allEvents),
            activeFilter: this.#terrainFilter,
            hasEvents: this.#events.length > 0,
            poolCount,
            catalogCount: this.#allEvents.length,
            filteredPoolCount,
            terrainPoolCount,
            pendingSelection: this.#pendingSelection,
            dirty: this.#dirty
        };
    }

    /** @override */
    async _renderHTML(context) {
        const el = document.createElement("div");
        el.classList.add("respite-event-browser");

        const terrainGroupHtml = (context.terrainOptionGroups ?? [])
            .map(g => `
                <optgroup label="${g.group}">
                    ${g.options.map(o => `
                        <option value="${o.value}" ${context.activeFilter === o.value ? "selected" : ""}>${o.label}</option>
                    `).join("")}
                </optgroup>`)
            .join("");

        const terrainCountLabel = context.activeFilter && context.terrainPoolCount !== null
            ? ` · ${context.terrainPoolCount} in ${context.activeFilter}`
            : "";

        let html = `
        <div class="event-browser-filter">
            <label for="terrain-filter"><i class="fas fa-map-marker-alt"></i> Terrain</label>
            <select id="terrain-filter" class="event-terrain-select">
                <option value="">All terrains</option>
                ${terrainGroupHtml}
            </select>
            <span class="event-pool-summary">${context.poolCount} in pool (${context.catalogCount} available)${terrainCountLabel}</span>
        </div>`;

        if (context.poolCount === 0 && context.hasEvents) {
            html += `
        <div class="art-nudge-banner event-pool-nudge-banner event-pool-curator-intro">
            <div class="art-nudge-content">
                <i class="fas fa-book-open art-nudge-icon"></i>
                <div class="art-nudge-text">
                    <span class="art-nudge-title">Your camp event pool is empty.</span>
                    <span class="art-nudge-subtitle">Tick the events you are willing to run at camp, then Save Pool. Use Import Custom Events to add community JSON packs.</span>
                </div>
            </div>
        </div>`;
        }

        html += `
        <p class="event-pool-intro">Tick events you are willing to run at camp. Only selected events can appear on a night check roll. Import a custom JSON event pack with the button below.</p>`;

        if (context.hasEvents) {
            let disasterDividerShown = false;
            const checklistHtml = this.#events.map((evt, idx) => {
                const checked = context.pendingSelection[evt.id] ? "checked" : "";
                const active = idx === context.index ? " active" : "";
                const isDisaster = evt.tier === "disaster";
                let divider = "";
                if (isDisaster && !disasterDividerShown) {
                    disasterDividerShown = true;
                    divider = `
                <div class="event-pool-group-divider"><i class="fas fa-triangle-exclamation"></i> Disasters</div>`;
                }
                const disasterClass = isDisaster ? " disaster" : "";
                return `${divider}
                <label class="event-pool-check-item${disasterClass}${active}" data-index="${idx}">
                    <input type="checkbox" class="event-pool-check" data-event-id="${evt.id}" ${checked} />
                    <span class="event-pool-check-name">${evt.name ?? evt.id}</span>
                </label>`;
            }).join("");

            html += `
            <div class="event-pool-layout">
                <div class="event-pool-checklist">${checklistHtml}</div>
                <div class="event-pool-detail">`;

            if (context.event) {
                html += this.#renderEventCard(context.event, context.pendingSelection[context.event.id]);
            }

            html += `
                </div>
            </div>`;
        } else {
            html += `
            <div class="event-browser-empty">
                <i class="fas fa-ghost"></i>
                <p>No events match this filter.</p>
                <p class="event-browser-empty-hint">Import a custom JSON pack, or clear the terrain filter to see the full catalog.</p>
            </div>`;
        }

        html += `
        <div class="event-pool-footer">
            <button type="button" class="event-pool-import-btn" title="Import a custom JSON event pack">
                <i class="fas fa-file-import"></i> Import Custom Events
            </button>
            <button type="button" class="event-pool-save-btn" ${context.dirty ? "" : "disabled"}>
                <i class="fas fa-save"></i> Save Pool
            </button>
        </div>`;

        el.innerHTML = html;

        el.querySelector(".event-terrain-select")?.addEventListener("change", (e) => {
            this.#terrainFilter = e.target.value || null;
            this.#index = 0;
            this.#resetScroll = true;
            this.render({ force: true });
        });

        el.querySelectorAll(".event-pool-check-item").forEach(item => {
            item.addEventListener("click", (e) => {
                if (e.target.classList.contains("event-pool-check")) return;
                const idx = Number(item.dataset.index);
                if (!Number.isNaN(idx)) {
                    this.#index = idx;
                    this.render({ force: true });
                }
            });
        });

        el.querySelectorAll(".event-pool-check").forEach(cb => {
            cb.addEventListener("change", () => {
                const eventId = cb.dataset.eventId;
                if (cb.checked) {
                    this.#pendingSelection[eventId] = true;
                } else {
                    delete this.#pendingSelection[eventId];
                }
                this.#dirty = true;
                this.render({ force: true });
            });
        });

        el.querySelector(".event-pool-detail .event-pool-card-toggle")?.addEventListener("change", (e) => {
            const eventId = e.target.dataset.eventId;
            if (e.target.checked) {
                this.#pendingSelection[eventId] = true;
            } else {
                delete this.#pendingSelection[eventId];
            }
            this.#dirty = true;
            this.render({ force: true });
        });

        el.querySelector(".event-pool-import-btn")?.addEventListener("click", () => this.#importCustomEvents());
        el.querySelector(".event-pool-save-btn")?.addEventListener("click", () => this.#savePool());

        return el;
    }

    /**
     * Imports a community JSON event pack, reloads the catalog, and stages
     * the new events in the pending pool selection.
     */
    async #importCustomEvents() {
        const result = await importEventPackFromFile();
        if (!result?.success) return;

        this.#allEvents = [];
        await TerrainRegistry.init();
        await this.#loadEvents();
        this.#applyFilter();

        for (const eventId of result.eventIds) {
            this.#pendingSelection[eventId] = true;
        }
        this.#dirty = true;

        if (result.eventIds.length) {
            const firstIdx = this.#events.findIndex(evt => result.eventIds.includes(evt.id));
            if (firstIdx >= 0) this.#index = firstIdx;
        }

        const importedPacks = game.settings.get("ionrift-respite", "importedPacks") ?? {};
        const legacyBinding = importedPacks[result.packId]?.legacyTerrainBinding;
        const coreTags = (result.terrainTags?.core ?? []).map(t => t.label).join(", ");
        let terrainHint = "";
        if (legacyBinding) {
            const parentLabel = TerrainRegistry.get(legacyBinding.parentTerrain)?.label ?? legacyBinding.parentTerrain;
            terrainHint = ` Curate under ${parentLabel} · ${legacyBinding.label}.`;
        } else if (coreTags) {
            terrainHint = ` Terrain: ${coreTags}.`;
        } else if (result.terrainTags?.custom?.length) {
            terrainHint = ` Custom terrain: ${result.terrainTags.custom.map(t => t.label).join(", ")}.`;
        }

        ui.notifications.info(
            `Imported ${result.eventCount} event${result.eventCount === 1 ? "" : "s"} from "${result.packId}".${terrainHint} Save Pool to apply.`
        );
        this.render({ force: true });
    }

    /**
     * Renders the detail card for a single event.
     *
     * @param {object} evt
     * @param {boolean} inPool
     * @returns {string}
     */
    #renderEventCard(evt, inPool) {
        const sentiment = evt.sentiment ?? "neutral";
        const isDisaster = evt.tier === "disaster";
        const badgeClass = isDisaster ? "disaster" : sentiment;
        const badgeLabel = isDisaster ? "Disaster" : sentiment.replace(/^\w/, c => c.toUpperCase());
        const categoryIcon = this.#getCategoryIcon(evt.category);
        const terrainBadges = (evt.terrainTags ?? [])
            .map(t => {
                const terrain = TerrainRegistry.get(t);
                const isCustom = TerrainRegistry.isCustomTerrain(t);
                const icon = terrain?.icon ?? "fas fa-map-marker-alt";
                const label = terrain?.label ?? t;
                const customClass = isCustom ? " custom" : "";
                return `<span class="event-terrain-badge${customClass}" title="${isCustom ? (terrain?.customNote ?? "Custom imported terrain") : ""}"><i class="${icon}"></i> ${label}</span>`;
            }).join("");

        const packLabel = evt.pack
            ? evt.pack.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())
            : "Base Pack";
        const isImportedPack = evt.pack && evt.pack !== "base";
        const parentTerrain = (evt.terrainTags ?? []).find(tag => {
            const manifest = TerrainRegistry.get(tag);
            return manifest && !manifest.custom && !TerrainRegistry.isCustomTerrain(tag);
        });
        const legacyBindingNote = (isImportedPack && parentTerrain)
            ? `<p class="event-legacy-pack-note"><i class="fas fa-layer-group"></i> Curate under <strong>${TerrainRegistry.get(parentTerrain)?.label ?? parentTerrain} · ${packLabel}</strong>. Still rolls on ${parentTerrain} rests.</p>`
            : "";
        const hasCustomTerrain = (evt.terrainTags ?? []).some(t => TerrainRegistry.isCustomTerrain(t));
        const customTerrainNote = hasCustomTerrain
            ? `<p class="event-custom-terrain-note"><i class="fas fa-puzzle-piece"></i> Uses a custom terrain tag. Travel and forage stay off unless a full terrain pack is installed.</p>`
            : "";

        const mech = evt.mechanical ?? {};
        let outcomesHtml = "";
        const tiers = [
            { key: "onTriumph", label: "Triumph", cls: "triumph" },
            { key: "onSuccess", label: "Success", cls: "success" },
            { key: "onMixed", label: "Mixed", cls: "mixed" },
            { key: "onFailure", label: "Failure", cls: "failure" }
        ];
        const hasTiers = tiers.some(t => mech[t.key]);
        if (hasTiers) {
            outcomesHtml = `<div class="event-outcomes-list">`;
            for (const tier of tiers) {
                const data = mech[tier.key];
                if (!data) continue;
                const narrative = data.narrative ?? data.description ?? "";
                outcomesHtml += `
                    <div class="event-outcome-row ${tier.cls}">
                        <span class="outcome-label">${tier.label}</span>
                        <span class="outcome-text">${narrative}</span>
                    </div>`;
            }
            outcomesHtml += `</div>`;
        } else if (mech.type === "decision_tree") {
            outcomesHtml = this.#renderDecisionTree(mech);
        }

        const guidanceHtml = evt.gmGuidance
            ? `<div class="event-gm-guidance"><span class="event-gm-guidance-label"><i class="fas fa-user-secret"></i> GM notes</span><p>${evt.gmGuidance}</p></div>`
            : "";

        const checked = inPool ? "checked" : "";

        return `
        <div class="event-card">
            <div class="event-card-header">
                <span class="event-name"><i class="${categoryIcon}"></i> ${evt.name}</span>
                <span class="event-tier-badge ${badgeClass}">${badgeLabel}</span>
            </div>
            <label class="event-pool-card-toggle-row">
                <input type="checkbox" class="event-pool-card-toggle" data-event-id="${evt.id}" ${checked} />
                <span>In roll pool</span>
            </label>
            <div class="event-card-meta">
                <div class="event-terrain-list">${terrainBadges}</div>
                <span class="event-pack-badge"><i class="fas fa-box"></i> ${packLabel}</span>
            </div>
            <div class="event-card-body">
                <p class="event-description">${evt.description ?? ""}</p>
                ${legacyBindingNote}
                ${customTerrainNote}
                ${outcomesHtml}
                ${guidanceHtml}
            </div>
            <div class="event-card-footer">
                <span class="event-category"><i class="${categoryIcon}"></i> ${evt.category ?? "general"}</span>
                ${mech.groupCheck ? `<span class="event-dc"><i class="fas fa-dice-d20"></i> DC ${mech.groupCheck.dc ?? "?"} ${mech.groupCheck.skill ?? ""}</span>` : ""}
            </div>
        </div>`;
    }

    /**
     * Renders a decision-tree disaster as a prompt plus its top-level options,
     * so the curator sees what the event actually asks of the table.
     *
     * @param {object} mech
     * @returns {string}
     */
    #renderDecisionTree(mech) {
        const options = mech.options ?? [];
        if (!options.length) return "";

        const promptHtml = mech.prompt
            ? `<p class="event-decision-prompt">${mech.prompt}</p>`
            : "";

        const optionRows = options.map(opt => {
            const check = opt.check ?? {};
            const skills = Array.isArray(check.skills)
                ? check.skills.join(" / ")
                : (check.skill ?? "");
            const dcHtml = check.dc != null
                ? `<span class="event-decision-dc"><i class="fas fa-dice-d20"></i> ${skills ? skills.toUpperCase() + " " : ""}DC ${check.dc}</span>`
                : "";
            const descHtml = opt.description
                ? `<span class="event-decision-option-desc">${opt.description}</span>`
                : "";
            const branchHtml = opt.onFailure?.options?.length
                ? `<span class="event-decision-branch"><i class="fas fa-code-branch"></i> Failure leads to a follow-up choice.</span>`
                : "";
            return `
                <div class="event-decision-option">
                    <div class="event-decision-option-head">
                        <span class="event-decision-option-label">${opt.label ?? opt.id ?? "Option"}</span>
                        ${dcHtml}
                    </div>
                    ${descHtml}
                    ${branchHtml}
                </div>`;
        }).join("");

        return `
            <div class="event-decision-tree">
                <div class="event-decision-header"><i class="fas fa-code-branch"></i> Decision</div>
                ${promptHtml}
                <div class="event-decision-options">${optionRows}</div>
            </div>`;
    }

    /** Persists pending selection to world settings. */
    async #savePool() {
        await game.settings.set(MODULE_ID, "eventPoolSelection", { ...this.#pendingSelection });
        this.#dirty = false;
        ui.notifications.info("Event pool saved.");

        const instances = foundry.applications?.instances;
        if (instances) {
            for (const app of instances.values()) {
                if (app.options?.id === "ionrift-respite-setup" && app.rendered) {
                    if (typeof app._refreshEventPool === "function") {
                        await app._refreshEventPool();
                    }
                    app.render({ force: true });
                    break;
                }
            }
        }

        this.render({ force: true });
    }

    /** @override */
    _replaceHTML(result, content, options) {
        const prevChecklist = content.querySelector(".event-pool-checklist");
        const prevDetail = content.querySelector(".event-pool-detail");
        const checklistScroll = prevChecklist?.scrollTop ?? 0;
        const detailScroll = prevDetail?.scrollTop ?? 0;
        const sameEvent = this.#renderedIndex === this.#index;

        content.replaceChildren(result);

        const newChecklist = content.querySelector(".event-pool-checklist");
        if (newChecklist) {
            newChecklist.scrollTop = this.#resetScroll ? 0 : checklistScroll;
        }
        const newDetail = content.querySelector(".event-pool-detail");
        if (newDetail) {
            newDetail.scrollTop = (this.#resetScroll || !sameEvent) ? 0 : detailScroll;
        }

        this.#renderedIndex = this.#index;
        this.#resetScroll = false;
    }

    /** Loads all catalog events for browsing and curation. */
    async #loadEvents() {
        this.#allEvents = await loadAllCatalogEvents();
        this.#terrainFilter = normalizeEventPoolFilter(this.#terrainFilter, this.#allEvents);
    }

    /** Applies the current terrain filter to the event list. */
    #applyFilter() {
        if (this.#terrainFilter) {
            const filter = parseEventPoolFilter(this.#terrainFilter);
            this.#events = this.#allEvents.filter(evt => eventMatchesPoolFilter(evt, filter));
        } else {
            this.#events = [...this.#allEvents];
        }
        // Keep disasters grouped at the bottom so they read as a separate class
        // of event, then alphabetical within each group.
        this.#events.sort((a, b) => {
            const aDisaster = a.tier === "disaster" ? 1 : 0;
            const bDisaster = b.tier === "disaster" ? 1 : 0;
            if (aDisaster !== bDisaster) return aDisaster - bDisaster;
            return (a.name ?? "").localeCompare(b.name ?? "");
        });
        if (this.#index >= this.#events.length) {
            this.#index = Math.max(0, this.#events.length - 1);
        }
    }

    /** Returns a FontAwesome icon class for a given event category. */
    #getCategoryIcon(category) {
        const icons = {
            encounter: "fas fa-swords",
            complication: "fas fa-exclamation-triangle",
            discovery: "fas fa-search",
            environment: "fas fa-cloud-sun",
            social: "fas fa-comments",
            creature: "fas fa-paw"
        };
        return icons[category] ?? "fas fa-scroll";
    }
}
