import { TerrainRegistry } from "../services/TerrainRegistry.js";
import { ImageResolver } from "../util/ImageResolver.js";

/**
 * PackRegistryApp
 * GM-only settings panel with two tabs:
 *   - Event Packs: content packs (events + professions) with enable/disable toggles
 *   - Art Packs: terrain art import via ZIP
 * Uses Ionrift Glass theme.
 */
export class PackRegistryApp extends foundry.applications.api.ApplicationV2 {

    /** Tracks which tab is active across re-renders. */
    #activeTab = "events";

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

    /** @override */
    async _prepareContext() {
        const enabledPacks = game.settings.get("ionrift-respite", "enabledPacks") ?? {};
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
                    totalItems: 0
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
                    if (event.tier === "disaster") continue;
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
            for (const event of events) {
                if (event.tier) pack.tiers[event.tier] = (pack.tiers[event.tier] ?? 0) + 1;
                if (event.tier === "disaster") continue;
                for (const tag of (event.terrainTags ?? [])) {
                    pack.terrains[tag] = (pack.terrains[tag] ?? 0) + 1;
                }
                pack.totalItems++;
            }
        }

        // Sort: base first, then alphabetical
        const packList = [...packs.values()].sort((a, b) => {
            if (a.id === "base") return -1;
            if (b.id === "base") return 1;
            if (a.type !== b.type) return a.type === "event" ? -1 : 1;
            return a.label.localeCompare(b.label);
        });

        const totalEnabled = packList.filter(p => p.enabled).reduce((s, p) => s + p.totalItems, 0);
        const totalAll = packList.reduce((s, p) => s + p.totalItems, 0);

        return { packs: packList, totalEnabled, totalAll };
    }

    /** @override */
    async _renderHTML(context) {
        const el = document.createElement("div");
        el.classList.add("respite-pack-registry");

        const hasArt = ImageResolver.hasArtPack;
        const artPath = ImageResolver.artPackPath ?? "Not imported";

        const isArt = this.#activeTab === "art";

        // ── Tab bar ──
        let html = `
        <div class="pack-tab-bar">
            <button type="button" class="pack-tab ${isArt ? "" : "active"}" data-tab="events">
                <i class="fas fa-bolt"></i> Event Packs
            </button>
            <button type="button" class="pack-tab ${isArt ? "active" : ""}" data-tab="art">
                <i class="fas fa-image"></i> Art Packs
            </button>
        </div>

        <!-- ═══ Events Tab ═══ -->
        <div class="pack-tab-panel ${isArt ? "" : "active"}" data-panel="events">
          <div class="pack-tab-content">
            <div class="pack-summary-bar">
                <div class="pack-summary-stat">
                    <span class="stat-value">${context.totalEnabled}</span>
                    <span class="stat-label">active items</span>
                </div>
                <div class="pack-summary-stat">
                    <span class="stat-value">${context.packs.filter(p => p.enabled).length}</span>
                    <span class="stat-label">packs enabled</span>
                </div>
                <div class="pack-summary-stat">
                    <span class="stat-value">${context.totalAll}</span>
                    <span class="stat-label">total available</span>
                </div>
            </div>`;

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

            let bodyContent = "";
            if (pack.type === "profession") {
                const recipeBadges = pack.recipes
                    .map(name => `<span class="pack-recipe-badge"><i class="fas fa-scroll"></i> ${name}</span>`)
                    .join("");
                bodyContent = `<div class="pack-recipe-list">${recipeBadges}</div>`;
            } else {
                const terrainBadges = Object.entries(pack.terrains)
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([tag, count]) =>
                        `<span class="pack-terrain-badge"><i class="${this._getTerrainIcon(tag)}"></i> ${tag} <em>${count}</em></span>`
                    ).join("");
                const disasterBadge = pack.tiers.disaster > 0
                    ? `<span class="pack-tier-badge disaster"><i class="fas fa-skull-crossbones"></i> ${pack.tiers.disaster} disasters</span>`
                    : "";
                bodyContent = `<div class="pack-terrain-list">${terrainBadges}</div>${disasterBadge}`;
            }

            const isBase = pack.id === "base";
            const lockedClass = isBase ? "locked" : "";
            const disabledAttr = isBase ? 'disabled title="Core pack cannot be disabled"' : "";
            const enabledClass = pack.enabled ? "enabled" : "disabled";
            const countLabel = pack.type === "profession" ? "recipes" : "events";

            html += `
            <div class="pack-card ${enabledClass} ${lockedClass}" data-pack-id="${pack.id}">
                <div class="pack-card-header">
                    <label class="pack-toggle-label">
                        <input type="checkbox" class="pack-toggle-input"
                               ${pack.enabled ? "checked" : ""} ${disabledAttr}
                               data-pack-id="${pack.id}" />
                        <span class="pack-toggle-switch"></span>
                    </label>
                    <div class="pack-title-block">
                        <span class="pack-title"><i class="${pack.icon}"></i> ${pack.label}</span>
                        <span class="pack-desc">${pack.description}</span>
                    </div>
                    <span class="pack-event-count" title="${pack.totalItems} ${countLabel}">${pack.totalItems}</span>
                </div>
                <div class="pack-card-body">
                    ${bodyContent}
                    ${isBase ? '<span class="pack-lock-label"><i class="fas fa-lock"></i> Core</span>' : ''}
                </div>
            </div>`;
        }

        html += `
          </div>
            <div class="pack-links">
                <a href="https://patreon.com/ionrift" target="_blank"><i class="fas fa-download"></i> Get more packs</a>
                <a href="https://github.com/ionrift-gm/ionrift-respite/wiki/Authoring-Kit" target="_blank"><i class="fas fa-pencil-alt"></i> Create your own</a>
            </div>
            <div class="pack-actions">
                <button type="button" class="pack-import-btn">
                    <i class="fas fa-file-import"></i> Import Events
                </button>
                <button type="button" class="pack-save-btn">
                    <i class="fas fa-save"></i> Save Changes
                </button>
            </div>
        </div>

        <!-- ═══ Art Tab ═══ -->
        <!-- ═══ Art Tab ═══ -->
        <div class="pack-tab-panel ${isArt ? "active" : ""}" data-panel="art">
          <div class="pack-tab-content">
            <h4 class="pack-section-header"><i class="fas fa-image"></i> TERRAIN ART</h4>
            <div class="pack-summary-bar">
                <div class="pack-summary-stat">
                    <span class="pack-summary-number">${hasArt ? ImageResolver.artFileCount : 0}</span>
                    <span class="pack-summary-label">TOTAL FILES</span>
                </div>
                <div class="pack-summary-stat">
                    <span class="pack-summary-number">${hasArt ? ImageResolver.artTerrains.length : 0}</span>
                    <span class="pack-summary-label">TERRAINS</span>
                </div>
                <div class="pack-summary-stat">
                    <span class="pack-summary-number">${hasArt ? Math.floor(ImageResolver.artFileCount / ImageResolver.artTerrains.length) : 0}</span>
                    <span class="pack-summary-label">PER TERRAIN</span>
                </div>
            </div>
            ${hasArt ? (() => {
                const fileCount = ImageResolver.artFileCount;
                const terrains = ImageResolver.artTerrains;
                const terrainBadges = terrains
                    .map(t => `<span class="pack-terrain-badge"><i class="${this._getTerrainIcon(t)}"></i> ${t}</span>`)
                    .join("");
                return `
            <div class="pack-card enabled" data-art-type="terrain">
                <div class="pack-card-header">
                    <div class="pack-title-block">
                        <span class="pack-title"><i class="fas fa-palette"></i> Terrain Art</span>
                        <span class="pack-desc">${artPath}</span>
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
            })() : `
            <div class="art-empty-state">
                <i class="fas fa-image"></i>
                <p>No art packs installed.</p>
                <span>Import a ZIP with terrain images to replace placeholder banners.</span>
                <span class="art-format-hint">Accepted formats: .webp, .png, .jpg</span>
            </div>
            `}
          </div>
            <div class="pack-links">
                <a href="https://patreon.com/ionrift" target="_blank"><i class="fas fa-download"></i> Get art packs</a>
                <a href="https://github.com/ionrift-gm/ionrift-respite/wiki/Art-Packs" target="_blank"><i class="fas fa-book"></i> Documentation</a>
            </div>
            <div class="pack-actions">
                <button type="button" class="pack-import-art-btn">
                    <i class="fas fa-file-archive"></i> ${hasArt ? "Re-import Art Pack" : "Import Art Pack"}
                </button>
            </div>
        </div>`;

        el.innerHTML = html;

        // ── Tab switching ──
        el.querySelectorAll(".pack-tab").forEach(tab => {
            tab.addEventListener("click", () => {
                el.querySelectorAll(".pack-tab").forEach(t => t.classList.remove("active"));
                el.querySelectorAll(".pack-tab-panel").forEach(p => p.classList.remove("active"));
                tab.classList.add("active");
                el.querySelector(`.pack-tab-panel[data-panel="${tab.dataset.tab}"]`)?.classList.add("active");
                this.#activeTab = tab.dataset.tab;
            });
        });

        // ── Event tab wiring ──
        el.querySelectorAll(".pack-toggle-input").forEach(cb => {
            cb.addEventListener("change", () => {
                const card = cb.closest(".pack-card");
                card.classList.toggle("enabled", cb.checked);
                card.classList.toggle("disabled", !cb.checked);
                this._updateSummary(el);
            });
        });

        el.querySelector(".pack-save-btn").addEventListener("click", async () => {
            const updated = {};
            el.querySelectorAll(".pack-toggle-input").forEach(cb => {
                updated[cb.dataset.packId] = cb.checked;
            });
            await game.settings.set("ionrift-respite", "enabledPacks", updated);
            ui.notifications.info("Content packs updated. Changes take effect on next rest.");
            this.close();
        });

        el.querySelector(".pack-import-btn").addEventListener("click", () => this._importPack());

        // ── Art tab wiring ──
        el.querySelector(".pack-import-art-btn").addEventListener("click", () => this._importArtPack());
        el.querySelector(".art-uninstall-btn")?.addEventListener("click", () => this._uninstallArtPack());

        return el;
    }

    /**
     * Opens a file picker and imports a content pack JSON file into world storage.
     * Expected file structure: { id, name, description, icon, terrains, events[] }
     */
    async _importPack() {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".json";
        input.addEventListener("change", async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            try {
                const text = await file.text();
                const data = JSON.parse(text);

                // Validate required fields
                if (!data.id) throw new Error("Pack JSON is missing 'id' field.");
                if (!Array.isArray(data.events) || data.events.length === 0) {
                    throw new Error("Pack JSON has no events.");
                }

                // Validate each event has minimum required fields
                for (const evt of data.events) {
                    if (!evt.id) throw new Error(`Event missing 'id' field.`);
                    if (!evt.terrainTags?.length) throw new Error(`Event ${evt.id} missing 'terrainTags'.`);
                }

                // Store in world settings
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

                // Enable by default
                const enabledPacks = game.settings.get("ionrift-respite", "enabledPacks") ?? {};
                enabledPacks[data.id] = true;
                await game.settings.set("ionrift-respite", "enabledPacks", enabledPacks);

                ui.notifications.info(`Imported "${data.name ?? data.id}" (${data.events.length} events). Active on next rest.`);
                this.render({ force: true });
            } catch (err) {
                ui.notifications.error(`Import failed: ${err.message}`);
                console.error("[Respite:PackRegistry] Import error:", err);
            }
        });
        input.click();
    }

    /**
     * Opens the Zip Pack Importer for terrain art assets.
     * Art lands in ionrift-data/respite/art/ and ImageResolver
     * will detect it on next init.
     */
    async _importArtPack() {
        if (!game.ionrift?.library?.importZipPack) {
            ui.notifications.error("Ionrift Library v1.5.0+ is required for art pack imports.");
            return;
        }

        // Clear disabled flag if re-importing
        await game.settings.set("ionrift-respite", "artPackDisabled", false);

        const result = await game.ionrift.library.importZipPack({
            moduleId: "respite",
            assetType: "art",
            allowedExtensions: [".webp", ".png", ".jpg", ".jpeg"],
            schemaValidator: (entries) => {
                // Require at least one file in a subfolder (terrain directory structure)
                const hasTerrain = entries.some(e => e.dir.length > 0);
                if (!hasTerrain) {
                    return { valid: false, errors: ["Art pack should contain terrain subfolders (e.g. forest/, desert/)."] };
                }
                return { valid: true, errors: [] };
            }
        });

        if (result && result.imported > 0) {
            // Re-initialize ImageResolver to pick up the new art
            await ImageResolver.init();
            ui.notifications.info(`Art pack ready. ${result.imported} terrain images loaded.`);
            this.render({ force: true });
            // Re-render the rest UI if it's open so banners update immediately
            this._refreshOpenRestApp();
        }
    }

    /**
     * Disables the art pack by setting a world flag.
     * Files remain on disk but ImageResolver will ignore them.
     */
    async _uninstallArtPack() {
        await game.settings.set("ionrift-respite", "artPackDisabled", true);
        await ImageResolver.init();
        ui.notifications.info("Art pack disabled. Placeholder banners will be used.");
        this.render({ force: true });
        this._refreshOpenRestApp();
    }

    /** @override */
    _replaceHTML(result, content, options) {
        content.replaceChildren(result);
    }

    /**
     * Live-update the summary bar when toggles change.
     */
    _updateSummary(el) {
        const cards = el.querySelectorAll(".pack-card");
        let enabledItems = 0;
        let enabledPacks = 0;
        let totalItems = 0;

        cards.forEach(card => {
            const count = parseInt(card.querySelector(".pack-event-count")?.textContent ?? "0");
            const checked = card.querySelector(".pack-toggle-input")?.checked;
            totalItems += count;
            if (checked) {
                enabledItems += count;
                enabledPacks++;
            }
        });

        const stats = el.querySelectorAll(".pack-summary-stat .stat-value");
        if (stats[0]) stats[0].textContent = enabledItems;
        if (stats[1]) stats[1].textContent = enabledPacks;
        if (stats[2]) stats[2].textContent = totalItems;
    }

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
        // Pull icon from terrain manifest if available, fallback to generic
        const terrain = TerrainRegistry.get(tag);
        return terrain?.icon ?? "fas fa-map-marker-alt";
    }

    /**
     * Re-render the rest setup UI if it's currently open,
     * so art pack changes take effect immediately.
     */
    _refreshOpenRestApp() {
        // Foundry v13 ApplicationV2 instances registry
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
