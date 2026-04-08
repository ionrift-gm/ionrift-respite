import { TerrainRegistry } from "../services/TerrainRegistry.js";

/**
 * EventBrowserApp
 * GM-only read-only event viewer with prev/next navigation.
 * Accessed from the PackRegistryApp "Browse Events" button.
 * Shows event details including name, terrain, category, tier, description, and pack.
 */
export class EventBrowserApp extends foundry.applications.api.ApplicationV2 {

    /** All loaded events (post-filter). */
    #events = [];
    /** Current event index. */
    #index = 0;
    /** Active terrain filter (null = all). */
    #terrainFilter = null;
    /** Raw event data before filtering. */
    #allEvents = [];

    static DEFAULT_OPTIONS = {
        id: "respite-event-browser",
        window: {
            title: "Event Browser",
            icon: "fas fa-book-open",
            resizable: true
        },
        position: { width: 460, height: 480 },
        classes: ["ionrift-window"]
    };

    /** @override */
    async _prepareContext() {
        if (this.#allEvents.length === 0) {
            await this.#loadEvents();
        }
        this.#applyFilter();

        const event = this.#events[this.#index] ?? null;
        const terrains = [...new Set(this.#allEvents.flatMap(e => e.terrainTags ?? []))].sort();

        return {
            event,
            index: this.#index,
            total: this.#events.length,
            terrains,
            activeFilter: this.#terrainFilter,
            hasEvents: this.#events.length > 0
        };
    }

    /** @override */
    async _renderHTML(context) {
        const el = document.createElement("div");
        el.classList.add("respite-event-browser");

        // Terrain filter
        const terrainOptions = context.terrains
            .map(t => `<option value="${t}" ${context.activeFilter === t ? "selected" : ""}>${t}</option>`)
            .join("");

        let html = `
        <div class="event-browser-filter">
            <label for="terrain-filter"><i class="fas fa-map-marker-alt"></i> Terrain</label>
            <select id="terrain-filter" class="event-terrain-select">
                <option value="">All terrains</option>
                ${terrainOptions}
            </select>
            <span class="event-counter">${context.hasEvents ? `${context.index + 1} / ${context.total}` : "No events"}</span>
        </div>`;

        if (context.hasEvents && context.event) {
            const evt = context.event;
            const sentiment = evt.sentiment ?? "neutral";
            const isDisaster = evt.tier === "disaster";
            const badgeClass = isDisaster ? "disaster" : sentiment;
            const badgeLabel = isDisaster ? "Disaster" : sentiment.replace(/^\w/, c => c.toUpperCase());
            const categoryIcon = this.#getCategoryIcon(evt.category);
            const terrainBadges = (evt.terrainTags ?? [])
                .map(t => {
                    const terrain = TerrainRegistry.get(t);
                    const icon = terrain?.icon ?? "fas fa-map-marker-alt";
                    return `<span class="event-terrain-badge"><i class="${icon}"></i> ${t}</span>`;
                }).join("");

            const packLabel = evt.pack
                ? evt.pack.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())
                : "Base Pack";

            // Build outcome narratives
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
            }

            html += `
        <div class="event-card">
            <div class="event-card-header">
                <span class="event-name"><i class="${categoryIcon}"></i> ${evt.name}</span>
                <span class="event-tier-badge ${badgeClass}">${badgeLabel}</span>
            </div>
            <div class="event-card-meta">
                <div class="event-terrain-list">${terrainBadges}</div>
                <span class="event-pack-badge"><i class="fas fa-box"></i> ${packLabel}</span>
            </div>
            <div class="event-card-body">
                <p class="event-description">${evt.description ?? ""}</p>
                ${outcomesHtml}
            </div>
            <div class="event-card-footer">
                <span class="event-category"><i class="${categoryIcon}"></i> ${evt.category ?? "general"}</span>
                ${mech.groupCheck ? `<span class="event-dc"><i class="fas fa-dice-d20"></i> DC ${mech.groupCheck.dc ?? "?"} ${mech.groupCheck.skill ?? ""}</span>` : ""}
            </div>
        </div>`;
        } else {
            html += `
        <div class="event-browser-empty">
            <i class="fas fa-ghost"></i>
            <p>No events match this filter.</p>
        </div>`;
        }

        // Navigation
        html += `
        <div class="event-browser-nav">
            <button type="button" class="event-nav-btn" data-dir="prev" ${context.index <= 0 ? "disabled" : ""}>
                <i class="fas fa-chevron-left"></i> Previous
            </button>
            <button type="button" class="event-nav-btn" data-dir="next" ${context.index >= context.total - 1 ? "disabled" : ""}>
                Next <i class="fas fa-chevron-right"></i>
            </button>
        </div>`;

        el.innerHTML = html;

        // Wire filter
        el.querySelector(".event-terrain-select").addEventListener("change", (e) => {
            this.#terrainFilter = e.target.value || null;
            this.#index = 0;
            this.render({ force: true });
        });

        // Wire navigation
        el.querySelectorAll(".event-nav-btn").forEach(btn => {
            btn.addEventListener("click", () => {
                if (btn.dataset.dir === "prev" && this.#index > 0) this.#index--;
                if (btn.dataset.dir === "next" && this.#index < this.#events.length - 1) this.#index++;
                this.render({ force: true });
            });
        });

        return el;
    }

    /** @override */
    _replaceHTML(result, content, options) {
        content.replaceChildren(result);
    }

    /**
     * Loads all event data from core + terrain + imported pack sources.
     */
    async #loadEvents() {
        const events = [];

        // Core events
        const coreFiles = [
            "forest_events.json", "dungeon_events.json", "desert_events.json",
            "swamp_events.json", "urban_events.json", "camp_disasters.json"
        ];
        for (const file of coreFiles) {
            try {
                const resp = await fetch(`modules/ionrift-respite/data/core/events/${file}`);
                if (!resp.ok) continue;
                const data = await resp.json();
                for (const evt of (data.events ?? [])) {
                    events.push(evt);
                }
            } catch (e) { /* skip */ }
        }

        // Terrain packs
        try {
            const manifestResp = await fetch(`modules/ionrift-respite/data/terrains/manifest.json`);
            if (manifestResp.ok) {
                const manifest = await manifestResp.json();
                const coreTerrains = new Set(["forest", "swamp", "desert", "urban", "dungeon", "tavern"]);
                for (const terrain of (manifest.released ?? [])) {
                    if (coreTerrains.has(terrain)) continue;
                    try {
                        const resp = await fetch(`modules/ionrift-respite/data/terrains/${terrain}/events.json`);
                        if (!resp.ok) continue;
                        const data = await resp.json();
                        for (const evt of (data.events ?? [])) {
                            events.push(evt);
                        }
                    } catch (e) { /* skip */ }
                }
            }
        } catch (e) { /* skip */ }

        // Imported packs
        const importedPacks = game.settings.get("ionrift-respite", "importedPacks") ?? {};
        for (const [packId, packData] of Object.entries(importedPacks)) {
            for (const evt of (packData.events ?? [])) {
                events.push(evt);
            }
        }

        // Sort: alphabetical by name
        events.sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
        this.#allEvents = events;
    }

    /**
     * Applies the current terrain filter to the event list.
     */
    #applyFilter() {
        if (this.#terrainFilter) {
            this.#events = this.#allEvents.filter(e =>
                e.terrainTags?.includes(this.#terrainFilter)
            );
        } else {
            this.#events = [...this.#allEvents];
        }
        // Clamp index
        if (this.#index >= this.#events.length) this.#index = Math.max(0, this.#events.length - 1);
    }

    /**
     * Returns a FontAwesome icon class for a given event category.
     */
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
