const { AbstractPackRegistryApp } = await import("../../../ionrift-library/scripts/apps/AbstractPackRegistryApp.js");
import { TerrainRegistry } from "../services/TerrainRegistry.js";
import { ImageResolver } from "../util/ImageResolver.js";
import { EventBrowserApp } from "./EventBrowserApp.js";

/**
 * PackRegistryApp
 * GM-only settings panel with two tabs:
 *   - Event Packs: content packs (events + professions) with enable/disable toggles
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
        position: { width: 480, height: 520 },
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
                    version: null
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
            const events = packData.events ?? [];
            if (!events.length) continue;

            const pack = _ensurePack(packId);
            pack.label = packData.name ?? packId.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
            pack.icon = packData.icon ?? "fas fa-hiking";
            pack.description = packData.description ?? "Imported content pack";
            pack.version = packData.version ?? installedPacks[packId]?.version ?? null;
            for (const event of events) {
                if (event.tier) pack.tiers[event.tier] = (pack.tiers[event.tier] ?? 0) + 1;
                if (event.tier === "disaster") continue;
                for (const tag of (event.terrainTags ?? [])) {
                    pack.terrains[tag] = (pack.terrains[tag] ?? 0) + 1;
                }
                pack.totalItems++;
            }
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
        } else if (tabId === "art") {
            await this._renderArtTab(context, panel);
        }
    }

    // ═══════════════════════════════════════════════════════════════
    //  EVENTS TAB
    // ═══════════════════════════════════════════════════════════════

    async _renderEventsTab(context, panel) {
        let html = `<div class="pack-tab-content">`;

        // Summary bar
        html += this._renderSummaryBar([
            { label: "active items", value: context.totalEnabled },
            { label: "packs enabled", value: context.packs.filter(p => p.enabled).length },
            { label: "total available", value: context.totalAll }
        ]);

        // Updates banner
        html += this._renderUpdateBanner(context.pendingUpdates);

        // Pack cards
        let lastType = null;
        for (const pack of context.packs) {
            if (pack.type !== lastType) {
                if (lastType !== null) html += `<div class="pack-section-divider"></div>`;
                const sectionLabel = pack.type === "profession" ? "Professions" : "Events";
                const sectionIcon = pack.type === "profession" ? "fas fa-hammer" : "fas fa-bolt";
                html += `<div class="pack-section-header"><i class="${sectionIcon}"></i> ${sectionLabel}</div>`;
                lastType = pack.type;
            }

            const bodyHtml = this._renderEventCardBody(pack);
            html += this._renderPackCard(pack, bodyHtml);
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
            const artVersionHtml = artVersion ? ` <span class="pack-version">v${artVersion}</span>` : "";

            html += `
            <div class="pack-card enabled" data-art-type="terrain">
                <div class="pack-card-header">
                    <div class="pack-title-block">
                        <span class="pack-title"><i class="fas fa-palette"></i> Terrain Art</span>
                        <span class="pack-desc">${artPath}${artVersionHtml}</span>
                    </div>
                    <span class="pack-event-count" title="${fileCount} files">${fileCount}</span>
                    <button type="button" class="art-uninstall-btn" title="Uninstall art pack">
                        <i class="fas fa-trash-alt"></i>
                    </button>
                </div>
                <div class="pack-card-body">
                    <div class="pack-terrain-list">${terrainBadges}</div>
                    <span class="art-pack-badge installed"><i class="fas fa-check"></i> Installed</span>
                </div>
            </div>`;
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
        panel.querySelector(".art-uninstall-btn")?.addEventListener("click", () => this._uninstallArtPack());
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

        const result = await game.ionrift.library.importJsonPack({
            moduleId: "respite",
            schemaValidator: (data) => {
                if (!data.id) return { valid: false, errors: ["Pack JSON is missing 'id' field."] };
                if (!Array.isArray(data.events) || data.events.length === 0) {
                    return { valid: false, errors: ["Pack JSON has no events."] };
                }
                for (const evt of data.events) {
                    if (!evt.id) return { valid: false, errors: ["Event missing 'id' field."] };
                    if (!evt.terrainTags?.length) return { valid: false, errors: [`Event ${evt.id} missing 'terrainTags'.`] };
                }
                return { valid: true, errors: [] };
            },
            onImport: async (data) => {
                const importedPacks = game.settings.get("ionrift-respite", "importedPacks") ?? {};
                importedPacks[data.id] = {
                    name: data.name ?? data.id,
                    description: data.description ?? "",
                    icon: data.icon ?? "fas fa-hiking",
                    terrains: data.terrains ?? [],
                    events: data.events,
                    tables: data.tables ?? null,
                    version: data.version ?? "1.0.0",
                    importedAt: new Date().toISOString()
                };
                await game.settings.set("ionrift-respite", "importedPacks", importedPacks);

                const enabledPacks = game.settings.get("ionrift-respite", "enabledPacks") ?? {};
                enabledPacks[data.id] = true;
                await game.settings.set("ionrift-respite", "enabledPacks", enabledPacks);

                return { packId: data.id, name: data.name ?? data.id, eventCount: data.events.length };
            }
        });

        if (result?.success) {
            ui.notifications.info(`Imported "${result.packId}" successfully. Active on next rest.`);
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
                window: { title: "Uninstall Art Pack" },
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
