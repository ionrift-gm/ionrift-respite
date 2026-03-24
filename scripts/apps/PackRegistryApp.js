import { TerrainRegistry } from "../services/TerrainRegistry.js";

/**
 * PackRegistryApp
 * GM-only settings panel showing installed content packs (events + professions),
 * with counts, terrain/recipe breakdowns, and enable/disable toggles.
 * Uses Ionrift Glass theme.
 */
export class PackRegistryApp extends foundry.applications.api.ApplicationV2 {

    static DEFAULT_OPTIONS = {
        id: "respite-pack-registry",
        window: {
            title: "Content Packs",
            icon: "fas fa-box-open",
            resizable: true
        },
        position: { width: 480, height: 420 },
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
                    for (const tag of (event.terrainTags ?? [])) {
                        pack.terrains[tag] = (pack.terrains[tag] ?? 0) + 1;
                    }
                    if (event.tier) pack.tiers[event.tier] = (pack.tiers[event.tier] ?? 0) + 1;
                    pack.totalItems++;
                }
            } catch (e) {
                console.warn(`[Respite:PackRegistry] Failed to load core/${file}:`, e);
            }
        }

        // ── Scan Wanderer's Pack ──
        try {
            const resp = await fetch(`modules/ionrift-respite/data/wanderers_pack/events.json`);
            if (resp.ok) {
                const data = await resp.json();
                for (const event of (data.events ?? [])) {
                    const pack = _ensurePack(event.pack ?? "wanderers_pack");
                    for (const tag of (event.terrainTags ?? [])) {
                        pack.terrains[tag] = (pack.terrains[tag] ?? 0) + 1;
                    }
                    if (event.tier) pack.tiers[event.tier] = (pack.tiers[event.tier] ?? 0) + 1;
                    pack.totalItems++;
                }
            }
        } catch (e) {
            console.warn(`[Respite:PackRegistry] Failed to load wanderers_pack:`, e);
        }

        // ── Scan terrain pack events via manifest ──
        try {
            await TerrainRegistry.init();
            const manifestResp = await fetch(`modules/ionrift-respite/data/terrains/manifest.json`);
            if (manifestResp.ok) {
                const manifest = await manifestResp.json();
                // Core terrains have events in data/core/events/, skip them here
                const coreTerrains = new Set(["forest", "swamp", "desert", "urban", "dungeon"]);
                for (const terrain of (manifest.released ?? [])) {
                    if (coreTerrains.has(terrain)) continue;
                    try {
                        const resp = await fetch(`modules/ionrift-respite/data/terrains/${terrain}/events.json`);
                        if (!resp.ok) continue;
                        const data = await resp.json();
                        for (const event of (data.events ?? [])) {
                            const pack = _ensurePack(event.pack ?? `terrain_${terrain}`);
                            for (const tag of (event.terrainTags ?? [])) {
                                pack.terrains[tag] = (pack.terrains[tag] ?? 0) + 1;
                            }
                            if (event.tier) pack.tiers[event.tier] = (pack.tiers[event.tier] ?? 0) + 1;
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



        // Sort: base first, wanderers_pack second, then alphabetical
        const packList = [...packs.values()].sort((a, b) => {
            if (a.id === "base") return -1;
            if (b.id === "base") return 1;
            if (a.id === "wanderers_pack") return -1;
            if (b.id === "wanderers_pack") return 1;
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

        // Summary bar
        let html = `
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

        // Section headers and pack cards
        let lastType = null;
        for (const pack of context.packs) {
            // Section divider when switching from events to professions
            if (pack.type !== lastType) {
                if (lastType !== null) {
                    html += `<div class="pack-section-divider"></div>`;
                }
                const sectionLabel = pack.type === "profession" ? "Professions" : "Events";
                const sectionIcon = pack.type === "profession" ? "fas fa-hammer" : "fas fa-bolt";
                html += `<div class="pack-section-header"><i class="${sectionIcon}"></i> ${sectionLabel}</div>`;
                lastType = pack.type;
            }

            // Build card body content
            let bodyContent = "";
            if (pack.type === "profession") {
                // Show recipe names as badges
                const recipeBadges = pack.recipes
                    .map(name => `<span class="pack-recipe-badge"><i class="fas fa-scroll"></i> ${name}</span>`)
                    .join("");
                bodyContent = `<div class="pack-recipe-list">${recipeBadges}</div>`;
            } else {
                // Show terrain badges
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

        // Actions
        html += `
        <div class="pack-actions">
            <button type="button" class="pack-save-btn">
                <i class="fas fa-save"></i> Save Changes
            </button>
        </div>`;

        el.innerHTML = html;

        // Wire toggle visual feedback
        el.querySelectorAll(".pack-toggle-input").forEach(cb => {
            cb.addEventListener("change", () => {
                const card = cb.closest(".pack-card");
                card.classList.toggle("enabled", cb.checked);
                card.classList.toggle("disabled", !cb.checked);
                this._updateSummary(el);
            });
        });

        // Save
        el.querySelector(".pack-save-btn").addEventListener("click", async () => {
            const updated = {};
            el.querySelectorAll(".pack-toggle-input").forEach(cb => {
                updated[cb.dataset.packId] = cb.checked;
            });
            await game.settings.set("ionrift-respite", "enabledPacks", updated);
            ui.notifications.info("Content packs updated. Changes take effect on next rest.");
            this.close();
        });

        return el;
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
        const labels = {
            "base": "Base Pack",
            "wanderers_pack": "Wanderer's Pack"
        };
        return labels[packId] ?? packId.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
    }

    _getPackIcon(packId) {
        const icons = {
            "base": "fas fa-campground",
            "wanderers_pack": "fas fa-hiking"
        };
        return icons[packId] ?? "fas fa-box";
    }

    _getPackDescription(packId) {
        const descs = {
            "base": "Core events for common terrains",
            "wanderers_pack": "Starter events across all core terrains"
        };
        return descs[packId] ?? "Additional content";
    }

    _getTerrainIcon(tag) {
        // Pull icon from terrain manifest if available, fallback to generic
        const terrain = TerrainRegistry.get(tag);
        return terrain?.icon ?? "fas fa-map-marker-alt";
    }
}
