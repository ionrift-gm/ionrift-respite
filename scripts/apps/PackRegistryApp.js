const { AbstractPackRegistryApp } = await import("../../../ionrift-library/scripts/apps/AbstractPackRegistryApp.js");
import { TerrainRegistry } from "../services/TerrainRegistry.js";
import { ImageResolver } from "../util/ImageResolver.js";
import { EventBrowserApp } from "./EventBrowserApp.js";
import { ContentPackCompiler } from "../services/ContentPackCompiler.js";

/**
 * PackRegistryApp
 * GM-only settings panel with three tabs:
 *   - Event Packs: camp event packs with enable/disable toggles
 *   - Content Packs: profession content (recipes, pools, hunt yields, butcher registry)
 *   - Art Packs: terrain art import via ZIP
 * Extends AbstractPackRegistryApp from ionrift-library for shared pack UI infrastructure.
 */

export class PackRegistryApp extends AbstractPackRegistryApp {

    static DEFAULT_OPTIONS = {
        id: "respite-pack-registry",
        window: {
            title: "Content Packs",
            icon: "fas fa-box-open",
            resizable: true
        },
        position: { width: 500, height: 560 },
        classes: ["ionrift-window"]
    };

    // ═══════════════════════════════════════════════════════════════
    //  BASE CLASS OVERRIDES
    // ═══════════════════════════════════════════════════════════════

    _getModuleId() {
        return "ionrift-respite";
    }

    _getTabDefinitions() {
        return [
            { id: "events", label: "Event Packs", icon: "fas fa-bolt" },
            { id: "content", label: "Content Packs", icon: "fas fa-utensils" },
            { id: "art", label: "Art Packs", icon: "fas fa-image" }
        ];
    }

    async _preparePackData() {
        const enabledPacks = game.settings.get("ionrift-respite", "enabledPacks") ?? {};
        const installedPacks = game.settings.get("ionrift-library", "installedPacks") ?? {};
        const packs = new Map();

        const _ensurePack = (packId) => {
            if (!packs.has(packId)) {
                packs.set(packId, {
                    id: packId,
                    type: packId.startsWith("profession_") ? "profession" : "event",
                    label: this._formatPackLabel(packId),
                    icon: this._getPackIcon(packId),
                    description: this._getPackDescription(packId),
                    enabled: enabledPacks[packId] !== false,
                    terrains: {},
                    recipes: [],
                    tiers: { normal: 0, disaster: 0 },
                    totalItems: 0,
                    version: null,
                    contentCounts: { recipes: 0, pools: 0, yieldTerrains: 0, butcherEntries: 0, events: 0 }
                });
            }
            return packs.get(packId);
        };

        // ── Scan core event files ──
        const coreEventFiles = [
            "forest_events.json", "dungeon_events.json", "desert_events.json",
            "swamp_events.json", "urban_events.json", "camp_disasters.json"
        ];

        for (const file of coreEventFiles) {
            try {
                const resp = await fetch(`modules/ionrift-respite/data/core/events/${file}`);
                if (!resp.ok) continue;
                const data = await resp.json();
                for (const event of (data.events ?? [])) {
                    const pack = _ensurePack(event.pack ?? "base");
                    if (event.tier) pack.tiers[event.tier] = (pack.tiers[event.tier] ?? 0) + 1;
                    for (const tag of (event.terrainTags ?? [])) {
                        pack.terrains[tag] = (pack.terrains[tag] ?? 0) + 1;
                    }
                    pack.totalItems++;
                }
            } catch (e) {
                console.warn(`[Respite:PackRegistry] Failed to load core/${file}:`, e);
            }
        }

        // ── Scan terrain pack events via manifest ──
        try {
            await TerrainRegistry.init();
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
                        for (const event of (data.events ?? [])) {
                            const pack = _ensurePack(event.pack ?? `terrain_${terrain}`);
                            if (event.tier) pack.tiers[event.tier] = (pack.tiers[event.tier] ?? 0) + 1;
                            if (event.tier === "disaster") continue;
                            for (const tag of (event.terrainTags ?? [])) {
                                pack.terrains[tag] = (pack.terrains[tag] ?? 0) + 1;
                            }
                            pack.totalItems++;
                        }
                    } catch (e) {
                        console.warn(`[Respite:PackRegistry] Failed to load terrain ${terrain}:`, e);
                    }
                }
            }
        } catch (e) {
            console.warn(`[Respite:PackRegistry] Failed to load terrain manifest:`, e);
        }

        // ── Scan imported content packs (from world storage) ──
        const importedPacks = game.settings.get("ionrift-respite", "importedPacks") ?? {};
        for (const [packId, packData] of Object.entries(importedPacks)) {
            const pack = _ensurePack(packId);
            pack.label = packData.name ?? packId.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
            pack.icon = packData.icon ?? "fas fa-hiking";
            pack.description = packData.description ?? "Imported content pack";
            pack.version = packData.version ?? installedPacks[packId]?.version ?? null;

            const events = packData.events ?? [];
            for (const event of events) {
                if (event.tier) pack.tiers[event.tier] = (pack.tiers[event.tier] ?? 0) + 1;
                if (event.tier === "disaster") continue;
                for (const tag of (event.terrainTags ?? [])) {
                    pack.terrains[tag] = (pack.terrains[tag] ?? 0) + 1;
                }
                pack.totalItems++;
            }
            pack.contentCounts.events = events.length;

            if (packData.recipes) {
                const recipeCount = Object.values(packData.recipes).flat().length;
                pack.contentCounts.recipes = recipeCount;
                pack.totalItems += recipeCount;
            }
            if (packData.resourcePools) {
                pack.contentCounts.pools = packData.resourcePools.length;
                pack.totalItems += packData.resourcePools.length;
            }
            if (packData.huntYields) {
                pack.contentCounts.yieldTerrains = Object.keys(packData.huntYields).length;
                pack.totalItems += Object.keys(packData.huntYields).length;
            }
            if (packData.butcherRegistry) {
                const entryCount = Object.keys(packData.butcherRegistry).filter(k => k !== "_meta").length;
                pack.contentCounts.butcherEntries = entryCount;
                pack.totalItems += entryCount;
            }

            // Classify: packs with recipes/pools/yields but no events are "content" packs
            const hasContentData = pack.contentCounts.recipes > 0 || pack.contentCounts.pools > 0
                || pack.contentCounts.yieldTerrains > 0 || pack.contentCounts.butcherEntries > 0;
            if (hasContentData && pack.contentCounts.events === 0) {
                pack.type = "content";
            } else if (hasContentData && pack.contentCounts.events > 0) {
                pack.type = "mixed";
            }

            // Store raw pack data ref for browse view
            pack._rawData = packData;
        }

        // Set base pack version from module manifest
        const basePack = packs.get("base");
        if (basePack) basePack.version = game.modules.get("ionrift-respite")?.version ?? null;

        // Sort: base first, then alphabetical
        const packList = [...packs.values()].sort((a, b) => {
            if (a.id === "base") return -1;
            if (b.id === "base") return 1;
            if (a.type !== b.type) return a.type === "event" ? -1 : 1;
            return a.label.localeCompare(b.label);
        });

        return { packs: packList, extra: {} };
    }

    async _renderTabPanel(tabId, context, panel) {
        if (tabId === "events") {
            await this._renderEventsTab(context, panel);
        } else if (tabId === "content") {
            await this._renderContentTab(context, panel);
        } else if (tabId === "art") {
            await this._renderArtTab(context, panel);
        }
    }

    // ═══════════════════════════════════════════════════════════════
    //  EVENTS TAB
    // ═══════════════════════════════════════════════════════════════

    async _renderEventsTab(context, panel) {
        const eventPacks = context.packs.filter(p => p.type === "event" || p.type === "profession");
        const totalEnabled = eventPacks.filter(p => p.enabled).reduce((s, p) => s + p.totalItems, 0);
        const totalAll = eventPacks.reduce((s, p) => s + p.totalItems, 0);

        let html = `<div class="pack-tab-content">`;

        // Summary bar
        html += this._renderSummaryBar([
            { label: "active items", value: totalEnabled },
            { label: "packs enabled", value: eventPacks.filter(p => p.enabled).length },
            { label: "total available", value: totalAll }
        ]);

        // Updates banner
        html += this._renderUpdateBanner(context.pendingUpdates);

        // Pack cards
        let lastType = null;
        for (const pack of eventPacks) {
            if (pack.type !== lastType) {
                if (lastType !== null) html += `<div class="pack-section-divider"></div>`;
                const sectionLabel = pack.type === "profession" ? "Professions" : "Events";
                const sectionIcon = pack.type === "profession" ? "fas fa-hammer" : "fas fa-bolt";
                html += `<div class="pack-section-header"><i class="${sectionIcon}"></i> ${sectionLabel}</div>`;
                lastType = pack.type;
            }

            const bodyHtml = this._renderEventCardBody(pack);
            html += this._renderPackCard(pack, bodyHtml, { deletable: !!pack._rawData });
        }

        html += `</div>`;

        // Footer links
        html += this._renderFooterLinks([
            { href: "https://www.patreon.com/collection/2079931", icon: "fas fa-download", label: "Get more packs" },
            { href: "https://www.patreon.com/collection/2096842", icon: "fas fa-pencil-alt", label: "Create your own" }
        ]);

        // Action buttons
        html += this._renderActionButtons([
            { cls: "pack-browse-btn", icon: "fas fa-book-open", label: "Browse Events" },
            { cls: "pack-import-btn", icon: "fas fa-file-import", label: "Import Events" },
            { cls: "pack-save-btn", icon: "fas fa-save", label: "Save Changes" }
        ]);

        panel.innerHTML = html;

        // Wire toggles
        this._wireToggles(panel);

        // Wire action buttons
        panel.querySelector(".pack-save-btn").addEventListener("click", () => this._onSaveEventPacks(panel));
        panel.querySelector(".pack-browse-btn").addEventListener("click", () => {
            new EventBrowserApp().render(true);
        });
        panel.querySelector(".pack-import-btn").addEventListener("click", () => this._importPack());

        // Wire delete buttons for imported event packs
        panel.querySelectorAll(".pack-delete-btn").forEach(btn => {
            btn.addEventListener("click", () => this._deleteImportedPack(btn.dataset.packId));
        });
    }

    _renderEventCardBody(pack) {
        if (pack.type === "profession") {
            const recipeBadges = pack.recipes
                .map(name => `<span class="pack-recipe-badge"><i class="fas fa-scroll"></i> ${name}</span>`)
                .join("");
            return `<div class="pack-recipe-list">${recipeBadges}</div>`;
        }

        const terrainBadges = Object.entries(pack.terrains)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([tag, count]) =>
                `<span class="pack-terrain-badge"><i class="${this._getTerrainIcon(tag)}"></i> ${tag} <em>${count}</em></span>`
            ).join("");
        const disasterBadge = pack.tiers.disaster > 0
            ? `<span class="pack-tier-badge disaster"><i class="fas fa-skull-crossbones"></i> ${pack.tiers.disaster} disasters</span>`
            : "";
        return `<div class="pack-terrain-list">${terrainBadges}</div>${disasterBadge}`;
    }

    async _onSaveEventPacks(el) {
        const updated = {};
        el.querySelectorAll(".pack-toggle-input").forEach(cb => {
            updated[cb.dataset.packId] = cb.checked;
        });

        // Check for terrains with zero enabled events before saving
        const enabledTerrains = new Map();
        const cards = el.querySelectorAll(".pack-card");
        cards.forEach(card => {
            const checked = card.querySelector(".pack-toggle-input")?.checked;
            if (!checked) return;
            card.querySelectorAll(".pack-terrain-badge").forEach(badge => {
                const text = badge.textContent.trim();
                const tag = text.replace(/\s*\d+$/, "").trim();
                if (tag) enabledTerrains.set(tag, (enabledTerrains.get(tag) ?? 0) + 1);
            });
        });

        const allTerrains = new Set();
        const knownTerrains = TerrainRegistry.getAvailableIds();
        el.querySelectorAll(".pack-terrain-badge").forEach(badge => {
            const text = badge.textContent.trim();
            const tag = text.replace(/\s*\d+$/, "").trim();
            if (tag && (knownTerrains.size === 0 || knownTerrains.has(tag))) allTerrains.add(tag);
        });
        const emptyTerrains = [...allTerrains].filter(t => !enabledTerrains.has(t));

        if (emptyTerrains.length > 0) {
            const proceed = await Dialog.confirm({
                title: "No Events for Some Terrains",
                content: `<p>The following terrains have no enabled events:</p>
                          <p><strong>${emptyTerrains.join(", ")}</strong></p>
                          <p>Rests in these terrains will be uneventful. Save anyway?</p>`,
                yes: () => true,
                no: () => false,
                defaultYes: false
            });
            if (!proceed) return;
        }

        await game.settings.set("ionrift-respite", "enabledPacks", updated);
        ui.notifications.info("Content packs updated. Changes take effect on next rest.");
        this.close();
    }

    // ═══════════════════════════════════════════════════════════════
    //  CONTENT TAB
    // ═══════════════════════════════════════════════════════════════

    async _renderContentTab(context, panel) {
        const contentPacks = context.packs.filter(p => p.type === "content" || p.type === "mixed");

        let html = `<div class="pack-tab-content">`;

        if (contentPacks.length === 0) {
            html += `
            <div class="art-empty-state">
                <i class="fas fa-utensils"></i>
                <p>No content packs installed.</p>
                <span>Import a content pack to enable cooking recipes, foraging pools, and hunt yields.</span>
            </div>`;
        } else {
            const totalItems = contentPacks.reduce((s, p) => s + p.totalItems, 0);
            const totalRecipes = contentPacks.reduce((s, p) => s + p.contentCounts.recipes, 0);
            const totalPools = contentPacks.reduce((s, p) => s + p.contentCounts.pools, 0);

            html += this._renderSummaryBar([
                { label: "recipes", value: totalRecipes },
                { label: "forage pools", value: totalPools },
                { label: "total items", value: totalItems }
            ]);

            html += `<div class="pack-section-header"><i class="fas fa-utensils"></i> Profession Content</div>`;

            for (const pack of contentPacks) {
                const bodyHtml = this._renderContentCardBody(pack);
                html += this._renderPackCard(pack, bodyHtml, { deletable: !!pack._rawData });
            }
        }

        html += `</div>`;

        // Footer links
        html += this._renderFooterLinks([
            { href: "https://www.patreon.com/collection/2079931", icon: "fas fa-download", label: "Get more packs" }
        ]);

        // Action buttons
        html += this._renderActionButtons([
            { cls: "pack-browse-content-btn", icon: "fas fa-book-open", label: "Browse Content" },
            { cls: "pack-import-content-btn", icon: "fas fa-file-import", label: "Import Content Pack" },
            { cls: "pack-save-content-btn", icon: "fas fa-save", label: "Save Changes" }
        ]);

        panel.innerHTML = html;

        // Wire toggles
        this._wireToggles(panel);

        // Wire action buttons
        panel.querySelector(".pack-import-content-btn")?.addEventListener("click", () => this._importPack());
        panel.querySelector(".pack-save-content-btn")?.addEventListener("click", () => this._onSaveEventPacks(panel));
        panel.querySelector(".pack-browse-content-btn")?.addEventListener("click", () => {
            const firstPack = contentPacks.find(p => p._rawData);
            if (!firstPack) {
                ui.notifications.warn("No content packs loaded to browse.");
                return;
            }
            this._openContentBrowser(firstPack);
        });

        // Wire delete buttons
        panel.querySelectorAll(".pack-delete-btn").forEach(btn => {
            btn.addEventListener("click", () => this._deleteImportedPack(btn.dataset.packId));
        });
    }

    _renderContentCardBody(pack) {
        const cc = pack.contentCounts;
        const badges = [];

        if (cc.recipes > 0) {
            badges.push(`<span class="pack-terrain-badge"><i class="fas fa-scroll"></i> ${cc.recipes} recipes</span>`);
        }
        if (cc.pools > 0) {
            badges.push(`<span class="pack-terrain-badge"><i class="fas fa-seedling"></i> ${cc.pools} forage pools</span>`);
        }
        if (cc.yieldTerrains > 0) {
            badges.push(`<span class="pack-terrain-badge"><i class="fas fa-drumstick-bite"></i> ${cc.yieldTerrains} hunt terrains</span>`);
        }
        if (cc.butcherEntries > 0) {
            badges.push(`<span class="pack-terrain-badge"><i class="fas fa-skull"></i> ${cc.butcherEntries} butcher entries</span>`);
        }
        if (cc.events > 0) {
            badges.push(`<span class="pack-terrain-badge"><i class="fas fa-bolt"></i> ${cc.events} events</span>`);
        }

        return `<div class="pack-terrain-list">${badges.join("")}</div>`;
    }

    /**
     * Opens an inline content browser dialog for a content pack.
     * Shows a categorised breakdown of recipes, pools, and yields.
     */
    _openContentBrowser(pack) {
        const raw = pack._rawData;
        if (!raw) return;

        let body = "";

        // Recipes
        if (raw.recipes) {
            for (const [profId, recipes] of Object.entries(raw.recipes)) {
                const profLabel = profId.charAt(0).toUpperCase() + profId.slice(1);
                body += `<h3 style="margin: 0.8em 0 0.4em; color: var(--ionrift-purple-light, #b48ead);"><i class="fas fa-scroll"></i> ${profLabel} Recipes (${recipes.length})</h3>`;
                body += `<div style="display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 0.6em;">`;
                for (const recipe of recipes) {
                    const dcLabel = recipe.dc ? ` DC ${recipe.dc}` : "";
                    const monsterTag = recipe.monsterRecipe ? ` <i class="fas fa-dragon" title="Monster Recipe" style="color: var(--color-level-error);"></i>` : "";
                    const ingredientCount = recipe.ingredients?.length ?? 0;
                    body += `<span class="pack-terrain-badge" title="${recipe.description ?? ""}\n${ingredientCount} ingredient(s)${dcLabel}" style="cursor: help;">
                        <img src="${recipe.output?.img ?? "icons/svg/mystery-man.svg"}" style="width: 16px; height: 16px; vertical-align: middle; margin-right: 3px; border: none;" />
                        ${recipe.name}${monsterTag}
                    </span>`;
                }
                body += `</div>`;
            }
        }

        // Resource Pools
        if (raw.resourcePools?.length) {
            body += `<h3 style="margin: 0.8em 0 0.4em; color: var(--ionrift-purple-light, #b48ead);"><i class="fas fa-seedling"></i> Forage Pools (${raw.resourcePools.length})</h3>`;
            body += `<div style="display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 0.6em;">`;
            for (const pool of raw.resourcePools) {
                const entryCount = pool.entries?.length ?? 0;
                body += `<span class="pack-terrain-badge" title="${entryCount} items in pool">
                    <i class="${this._getTerrainIcon(pool.terrainTag ?? "wilderness")}"></i> ${pool.name ?? pool.id}
                    <em>${entryCount}</em>
                </span>`;
            }
            body += `</div>`;

            // Item listing per pool
            for (const pool of raw.resourcePools) {
                if (!pool.entries?.length) continue;
                body += `<details style="margin: 0.3em 0 0.6em; padding-left: 0.5em;"><summary style="cursor: pointer; color: var(--ionrift-purple-light, #b48ead); font-size: 0.85em;"><i class="${this._getTerrainIcon(pool.terrainTag ?? "wilderness")}"></i> ${pool.name ?? pool.id}</summary>`;
                body += `<div style="display: flex; flex-wrap: wrap; gap: 3px; margin-top: 4px;">`;
                for (const entry of pool.entries) {
                    const itemName = entry.itemData?.name ?? entry.itemRef ?? "Unknown";
                    const img = entry.itemData?.img ?? "icons/svg/mystery-man.svg";
                    const weight = entry.weight ?? 1;
                    body += `<span class="pack-terrain-badge" title="Weight: ${weight}, Qty: ${entry.quantity ?? 1}" style="cursor: help;">
                        <img src="${img}" style="width: 14px; height: 14px; vertical-align: middle; margin-right: 2px; border: none;" />
                        ${itemName}
                    </span>`;
                }
                body += `</div></details>`;
            }
        }

        // Hunt Yields
        if (raw.huntYields) {
            const terrains = Object.keys(raw.huntYields);
            body += `<h3 style="margin: 0.8em 0 0.4em; color: var(--ionrift-purple-light, #b48ead);"><i class="fas fa-drumstick-bite"></i> Hunt Yields (${terrains.length} terrains)</h3>`;
            body += `<div style="display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 0.6em;">`;
            for (const terrain of terrains) {
                const yields = raw.huntYields[terrain];
                const stdCount = yields.standard?.length ?? 0;
                const excCount = yields.exceptional?.length ?? 0;
                body += `<span class="pack-terrain-badge" title="Standard: ${stdCount} items, Exceptional: ${excCount} items">
                    <i class="${this._getTerrainIcon(terrain)}"></i> ${terrain}
                    <em>${stdCount + excCount}</em>
                </span>`;
            }
            body += `</div>`;
        }

        // Butcher Registry
        if (raw.butcherRegistry) {
            const entries = Object.entries(raw.butcherRegistry).filter(([k]) => k !== "_meta");
            body += `<h3 style="margin: 0.8em 0 0.4em; color: var(--ionrift-purple-light, #b48ead);"><i class="fas fa-skull"></i> Butcher Registry (${entries.length} creatures)</h3>`;
            body += `<div style="display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 0.6em;">`;
            for (const [id, entry] of entries) {
                const tierColor = { common: "#aaa", uncommon: "#6abf6a", rare: "#4a8fd4", legendary: "#d4a44a" }[entry.tier] ?? "#aaa";
                body += `<span class="pack-terrain-badge" title="${entry.flavour ?? ""}\nMin CR: ${entry.minCR ?? "?"}, Tier: ${entry.tier ?? "?"}" style="cursor: help; border-color: ${tierColor};">
                    ${entry.label ?? id}
                    <em style="color: ${tierColor};">${entry.tier ?? ""}</em>
                </span>`;
            }
            body += `</div>`;
        }

        new Dialog({
            title: `${pack.label} — Content Browser`,
            content: `<div style="max-height: 500px; overflow-y: auto; padding: 0.5em;">${body}</div>`,
            buttons: { close: { label: "Close", icon: "fas fa-times" } },
            default: "close"
        }, { width: 520, classes: ["ionrift-window"] }).render(true);
    }

    /**
     * Delete an imported pack from world storage and remove its compiled compendium.
     * Works for both event packs and content packs.
     * @param {string} packId
     */
    async _deleteImportedPack(packId) {
        if (PackRegistryApp._deletePending) return;
        PackRegistryApp._deletePending = true;

        try {
            const importedPacks = game.settings.get("ionrift-respite", "importedPacks") ?? {};
            const packData = importedPacks[packId];
            if (!packData) return;

            const packName = packData.name ?? packId;
            const confirmed = await foundry.applications.api.DialogV2.confirm({
                window: { title: "Remove Pack", icon: "fas fa-trash-alt" },
                classes: ["ionrift-window"],
                content: `<p>Remove <strong>${packName}</strong>?</p>
                          <p>All content from this pack will no longer be available. You can re-import at any time.</p>`,
                yes: { label: "Remove", icon: "fas fa-trash-alt" },
                no: { label: "Cancel", icon: "fas fa-times" }
            });
            if (!confirmed) return;

            // Remove compiled compendium (if one was created)
            const compName = `respite-${packId}`;
            const existing = game.packs.get(`world.${compName}`);
            if (existing) {
                try { await existing.deleteCompendium(); }
                catch (err) { console.warn(`ionrift-respite | Failed to delete compendium "${compName}":`, err); }
            }

            // Remove from importedPacks
            delete importedPacks[packId];
            await game.settings.set("ionrift-respite", "importedPacks", importedPacks);

            // Remove from enabledPacks
            const enabledPacks = game.settings.get("ionrift-respite", "enabledPacks") ?? {};
            delete enabledPacks[packId];
            await game.settings.set("ionrift-respite", "enabledPacks", enabledPacks);

            ui.notifications.info(`Removed "${packName}".`);
            this.render({ force: true });
        } finally {
            PackRegistryApp._deletePending = false;
        }
    }

    // ═══════════════════════════════════════════════════════════════
    //  ART TAB
    // ═══════════════════════════════════════════════════════════════

    async _renderArtTab(context, panel) {
        const hasArt = ImageResolver.hasArtPack;
        const artPath = ImageResolver.artPackPath ?? "Not imported";

        let html = `<div class="pack-tab-content">`;

        // Summary bar
        html += this._renderSummaryBar([
            { label: "terrains", value: hasArt ? ImageResolver.artTerrains.length : 0 },
            { label: "per terrain", value: hasArt ? Math.floor(ImageResolver.artFileCount / ImageResolver.artTerrains.length) : 0 },
            { label: "total files", value: hasArt ? ImageResolver.artFileCount : 0 }
        ]);

        html += `<div class="pack-section-header"><i class="fas fa-image"></i> TERRAIN ART</div>`;

        if (hasArt) {
            const fileCount = ImageResolver.artFileCount;
            const terrains = ImageResolver.artTerrains;
            const terrainBadges = terrains
                .map(t => `<span class="pack-terrain-badge"><i class="${this._getTerrainIcon(t)}"></i> ${t}</span>`)
                .join("");
            const artVersion = context.installedPacks?.["respite-art-core"]?.version ?? null;

            const artPack = {
                id: "respite-art-core",
                label: "Terrain Art",
                icon: "fas fa-palette",
                description: artPath,
                version: artVersion,
                enabled: true,
                totalItems: fileCount,
                countLabel: "files"
            };
            const artBody = `<div class="pack-terrain-list">${terrainBadges}</div>
                <span class="art-pack-badge installed"><i class="fas fa-check"></i> Installed</span>`;
            html += this._renderPackCard(artPack, artBody, { showToggle: false, deletable: true });
        } else {
            html += `
            <div class="art-empty-state">
                <i class="fas fa-image"></i>
                <p>No art packs installed.</p>
                <span>Import a ZIP with terrain images to replace placeholder banners.</span>
                <span class="art-format-hint">Accepted formats: .webp, .png, .jpg</span>
            </div>`;
        }

        html += `</div>`;

        // Footer links
        html += this._renderFooterLinks([
            { href: "https://www.patreon.com/collection/2079931", icon: "fas fa-download", label: "Get art packs" },
            { href: "https://github.com/ionrift-gm/ionrift-library/wiki/Art-Packs", icon: "fas fa-book", label: "Documentation" }
        ]);

        // Action button
        html += this._renderActionButtons([
            { cls: "pack-import-art-btn", icon: "fas fa-file-archive", label: hasArt ? "Re-import Art Pack" : "Import Art Pack" }
        ]);

        panel.innerHTML = html;

        // Wire art buttons
        panel.querySelector(".pack-import-art-btn").addEventListener("click", () => this._importArtPack());
        panel.querySelector(".pack-delete-btn")?.addEventListener("click", () => this._uninstallArtPack());
    }

    // ═══════════════════════════════════════════════════════════════
    //  IMPORT FLOWS
    // ═══════════════════════════════════════════════════════════════

    /**
     * Opens a file picker and imports a content pack JSON file into world storage.
     * Delegates to the library's JsonPackService for file picking, manifest
     * validation, and unified installedPacks metadata tracking.
     */
    async _importPack() {
        if (!game.ionrift?.library?.importJsonPack) {
            ui.notifications.error("Ionrift Library v1.6.0+ is required for content pack imports.");
            return;
        }

        let _importedPackId = null;
        let _importedPackName = null;
        let _importedSummary = null;

        const result = await game.ionrift.library.importJsonPack({
            moduleId: "respite",
            schemaValidator: (data) => {
                if (!data.id) return { valid: false, errors: ["Pack JSON is missing 'id' field."] };

                const hasEvents = Array.isArray(data.events) && data.events.length > 0;
                const hasRecipes = data.recipes && typeof data.recipes === "object" && Object.keys(data.recipes).length > 0;
                const hasPools = Array.isArray(data.resourcePools) && data.resourcePools.length > 0;
                const hasYields = data.huntYields && typeof data.huntYields === "object" && Object.keys(data.huntYields).length > 0;
                const hasRegistry = data.butcherRegistry && typeof data.butcherRegistry === "object";

                if (!hasEvents && !hasRecipes && !hasPools && !hasYields && !hasRegistry) {
                    return { valid: false, errors: ["Pack JSON contains no recognised content (events, recipes, resourcePools, huntYields, or butcherRegistry)."] };
                }

                if (hasEvents) {
                    for (const evt of data.events) {
                        if (!evt.id) return { valid: false, errors: ["Event missing 'id' field."] };
                        if (!evt.terrainTags?.length) return { valid: false, errors: [`Event ${evt.id} missing 'terrainTags'.`] };
                    }
                }
                return { valid: true, errors: [] };
            },
            onImport: async (data) => {
                const importedPacks = game.settings.get("ionrift-respite", "importedPacks") ?? {};
                const packEntry = {
                    name: data.name ?? data.id,
                    description: data.description ?? "",
                    icon: data.icon ?? "fas fa-hiking",
                    terrains: data.terrains ?? [],
                    version: data.version ?? "1.0.0",
                    importedAt: new Date().toISOString()
                };

                if (data.events?.length)                      packEntry.events = data.events;
                if (data.tables)                               packEntry.tables = data.tables;
                if (data.recipes)                              packEntry.recipes = data.recipes;
                if (data.resourcePools?.length)                packEntry.resourcePools = data.resourcePools;
                if (data.huntYields)                           packEntry.huntYields = data.huntYields;
                if (data.butcherRegistry)                      packEntry.butcherRegistry = data.butcherRegistry;

                importedPacks[data.id] = packEntry;
                await game.settings.set("ionrift-respite", "importedPacks", importedPacks);

                const enabledPacks = game.settings.get("ionrift-respite", "enabledPacks") ?? {};
                enabledPacks[data.id] = true;
                await game.settings.set("ionrift-respite", "enabledPacks", enabledPacks);

                const counts = [];
                if (packEntry.events?.length)                  counts.push(`${packEntry.events.length} events`);
                if (packEntry.recipes)                         counts.push(`${Object.values(packEntry.recipes).flat().length} recipes`);
                if (packEntry.resourcePools?.length)           counts.push(`${packEntry.resourcePools.length} pools`);
                if (packEntry.huntYields)                      counts.push(`${Object.keys(packEntry.huntYields).length} hunt terrains`);
                if (packEntry.butcherRegistry)                 counts.push("butcher registry");

                _importedPackId = data.id;
                _importedPackName = data.name ?? data.id;
                _importedSummary = counts.join(", ");

                return { packId: data.id, name: _importedPackName, eventCount: data.events?.length ?? 0, summary: _importedSummary };
            }
        });

        if (result?.success && _importedPackId) {
            const summary = _importedSummary ? ` (${_importedSummary})` : "";
            ui.notifications.info(`Imported "${_importedPackName}" successfully${summary}. Active on next rest.`);

            // Compile content pack items into a browsable world compendium
            const importedPacks = game.settings.get("ionrift-respite", "importedPacks") ?? {};
            const packData = importedPacks[_importedPackId];
            if (packData) {
                try {
                    const itemCount = await ContentPackCompiler.compile(_importedPackId, packData);
                    if (itemCount) {
                        ui.notifications.info(`Compiled ${itemCount} items into "${_importedPackName}" compendium.`);
                    }
                } catch (err) {
                    console.error(`ionrift-respite | Failed to compile pack compendium:`, err);
                }
            }

            this.render({ force: true });
        }
    }

    /**
     * Opens the Zip Pack Importer for terrain art assets.
     */
    async _importArtPack() {
        if (!game.ionrift?.library?.importZipPack) {
            ui.notifications.error("Ionrift Library v1.5.0+ is required for art pack imports.");
            return;
        }

        await game.settings.set("ionrift-respite", "artPackDisabled", false);

        const result = await game.ionrift.library.importZipPack({
            moduleId: "respite",
            assetType: "art",
            allowedExtensions: [".webp", ".png", ".jpg", ".jpeg"],
            schemaValidator: (entries) => {
                const hasTerrain = entries.some(e => e.dir.length > 0);
                if (!hasTerrain) {
                    return { valid: false, errors: ["Art pack should contain terrain subfolders (e.g. forest/, desert/)."] };
                }
                return { valid: true, errors: [] };
            }
        });

        if (result && result.imported > 0) {
            await ImageResolver.init();
            ui.notifications.info(`Art pack ready. ${result.imported} terrain images loaded.`);
            this.render({ force: true });
            this._refreshOpenRestApp();
        }
    }

    /**
     * Disables the art pack by setting a world flag.
     */
    async _uninstallArtPack() {
        if (PackRegistryApp._uninstallPending) return;
        PackRegistryApp._uninstallPending = true;

        try {
            const confirmed = await foundry.applications.api.DialogV2.confirm({
                window: { title: "Uninstall Art Pack", icon: "fas fa-trash-alt" },
                classes: ["ionrift-window"],
                content: "<p>Remove all terrain art and revert to placeholder banners?</p><p>You can re-import the pack at any time.</p>",
                yes: { label: "Uninstall", icon: "fas fa-trash-alt" },
                no: { label: "Cancel", icon: "fas fa-times" }
            });
            if (!confirmed) return;

            await game.settings.set("ionrift-respite", "artPackDisabled", true);
            await ImageResolver.init();
            ui.notifications.info("Art pack disabled. Placeholder banners will be used.");
            this.render({ force: true });
            this._refreshOpenRestApp();
        } finally {
            PackRegistryApp._uninstallPending = false;
        }
    }

    // ═══════════════════════════════════════════════════════════════
    //  HELPERS
    // ═══════════════════════════════════════════════════════════════

    _formatPackLabel(packId) {
        if (packId === "base") return "Base Pack";
        return packId.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
    }

    _getPackIcon(packId) {
        if (packId === "base") return "fas fa-campground";
        return "fas fa-box";
    }

    _getPackDescription(packId) {
        if (packId === "base") return "Core events for common terrains";
        return "Additional content";
    }

    _getTerrainIcon(tag) {
        const terrain = TerrainRegistry.get(tag);
        return terrain?.icon ?? "fas fa-map-marker-alt";
    }

    /**
     * Re-render the rest setup UI if it's currently open.
     */
    _refreshOpenRestApp() {
        const instances = foundry.applications?.instances;
        if (instances) {
            for (const app of instances.values()) {
                if (app.options?.id === "ionrift-respite-setup" && app.rendered) {
                    app.render({ force: true });
                    break;
                }
            }
        }
    }
}
