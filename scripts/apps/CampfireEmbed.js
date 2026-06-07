/**
 * CampfireEmbed
 * Lightweight version of CampfireApp that renders into an arbitrary DOM container
 * instead of an ApplicationV2 window. Used for the slide-out drawer in RestSetupApp.
 *
 * Reuses the same campfire.hbs template and CampfirePhysics engine.
 * All socket events route through the same module.js handlers.
 */
const MODULE_ID = "ionrift-respite";
import { CampfirePhysics } from "../services/CampfirePhysics.js";
import { CampfireTokenLinker } from "../services/CampfireTokenLinker.js";
import {
    CampGearScanner,
    actorHasTinderbox,
    countActorFirewood,
    findConsumableFirewoodItem
} from "../services/CampGearScanner.js";
import { logCampfireReconnect } from "../services/CampfireReconnectLog.js";

/** Default kindling art (matches respite-cache-utility/kindling.json). */
const DEFAULT_KINDLING_IMG = "icons/commodities/wood/kindling-sticks-brown.webp";

/** After this many strike attempts, the next try always lights the fire. */
const FLINT_STRIKE_GUARANTEE_AFTER = 10;

const TRINKETS = [
    { id: "pinecone", icon: "fas fa-tree", label: "Pinecone", color: "#4ade80" },
    { id: "letter", icon: "fas fa-envelope", label: "Old Letter", color: "#fbbf24" },
    { id: "flower", icon: "fas fa-seedling", label: "Dried Flower", color: "#c084fc" },
    { id: "vial", icon: "fas fa-flask", label: "Empty Vial", color: "#60a5fa" },
    { id: "arrow", icon: "fas fa-long-arrow-alt-right", label: "Broken Arrow", color: "#f87171" }
];

const EMOTES = [
    { id: "mug", icon: "fas fa-mug-hot", label: "sips from a mug" },
    { id: "laugh", icon: "fas fa-laugh", label: "chuckles" },
    { id: "think", icon: "fas fa-brain", label: "ponders" },
    { id: "nod", icon: "fas fa-thumbs-up", label: "nods" }
];

const WHITTLE_FIGURES = [
    { id: "wolf", icon: "fas fa-dog", label: "Wolf" },
    { id: "bird", icon: "fas fa-dove", label: "Bird" },
    { id: "star", icon: "fas fa-star", label: "Star" },
    { id: "shield", icon: "fas fa-shield-alt", label: "Shield" },
    { id: "bear", icon: "fas fa-paw", label: "Bear" },
    { id: "dragon", icon: "fas fa-dragon", label: "Dragon" },
    { id: "tree", icon: "fas fa-tree", label: "Tree" },
    { id: "fish", icon: "fas fa-fish", label: "Fish" }
];

const PILE_IGNITE_THRESHOLD = 6;

export class CampfireEmbed {

    constructor(container, options = {}) {
        /** @type {HTMLElement} */
        this._container = container;
        this._heat = 0;
        this._lit = false;
        this._litBy = null;
        this._strikeCount = 0;
        this._decayInterval = null;
        this._litNotifyTimer = null;
        this._showLitBanner = false;
        this._onFireLevelChange = options.onFireLevelChange ?? null;
        this._partyCharacterIds = options.partyCharacterIds ?? [];
        this._terrainTag = options.terrainTag ?? null;
        /** @type {string|null} Roster-selected actor (TotM context character). */
        this._contextActorId = options.contextActorId ?? null;
        /** When true, heat does not decay over time; tier changes come from rest sync, fuel, or douse. */
        this._disableDecay = options.disableDecay ?? false;
        this._showDouseBtn = options.showDouseBtn ?? this._disableDecay;
        this._whittleProgress = 0;
        this._whittleTarget = 12;
        this._lastWhittledFigure = null;
        this._peakHeat = 0;
        this._kindlingPlaced = false;
        this._autoLitApplied = false;
        /** @type {CampfirePhysics|null} */
        this._physics = null;
        this._emberInterval = null;
        this._lastFireLevel = "unlit";
        /** Last rest ceremony fire key applied in syncFromRestFireLevel. */
        this._lastSyncedRestCeremonyKey = null;
        /** Activity phase: cold camp after a full douse (comfort −1, stealth bonus). */
        this._coldCampActive = false;
        /** TotM Make Camp: pit visuals follow segment preview, not live heat. */
        this._makeCampCeremony = options.makeCampCeremony ?? false;
        this._makeCampPreviewLevel = "embers";
        this._makeCampPartyFirewood = 0;
        this._makeCampRequirementSlots = [];
        this._ceremonyReadyToLight = false;
        this._onStageCeremonyWood = options.onStageCeremonyWood ?? null;
        this._onUnstageCeremonyWood = options.onUnstageCeremonyWood ?? null;
        this._onGiftCeremonyWood = options.onGiftCeremonyWood ?? null;
        /** TotM Make Camp: first successful strike commits preview tier and advances rest phase. */
        this._onCeremonyIgnited = options.onCeremonyIgnited ?? null;
        this._canCommitCeremonyIgnite = options.canCommitCeremonyIgnite ?? (() => true);
        this._ceremonyIgniteBlockReasonFn = options.ceremonyIgniteBlockReason ?? null;
        this._pendingKindlingBanner = null;
        this._templatePath = `modules/${MODULE_ID}/templates/campfire.hbs`;
        /** @type {ReturnType<typeof setTimeout>|null} */
        this._campfireStickEmitTimer = null;
    }

    /** Debounced emit so rapid drops do not flood the socket. */
    _emitCampfireStickDebounced(payload) {
        if (this._campfireStickEmitTimer) clearTimeout(this._campfireStickEmitTimer);
        this._campfireStickEmitTimer = setTimeout(() => {
            this._campfireStickEmitTimer = null;
            game.socket.emit(`module.${MODULE_ID}`, payload);
        }, 200);
    }

    // ──────── Element accessor (mirrors CampfireApp.element) ────────

    get element() { return this._container; }

    get fireLevel() {
        if (!this._lit) return "unlit";
        return CampfireEmbed._fireLevelFromHeat(this._heat);
    }

    get peakFireLevel() {
        if (this._peakHeat <= 0) return "unlit";
        return CampfireEmbed._fireLevelFromHeat(this._peakHeat);
    }

    /**
     * Canonical heat anchors: embers 25, campfire 50, bonfire 75.
     * Thresholds sit between tiers so synced values land on the correct label.
     * @param {number} heat
     * @returns {"embers"|"campfire"|"bonfire"}
     */
    static _fireLevelFromHeat(heat) {
        if (heat >= 60) return "bonfire";
        if (heat >= 35) return "campfire";
        return "embers";
    }

    // ──────── Render into container ────────

    async render() {
        if (!this._container) return;

        // Taverns have a hearth: auto-light the fire on first render
        if (!this._autoLitApplied && this._isHearthTerrain()) {
            this._autoLitApplied = true;
            this._kindlingPlaced = true;
            this._lit = true;
            this._litBy = "The Hearth";
            this._heat = 45;
            this._peakHeat = 45;
            // Sync the on-scene campfire token so it matches the hearth state
            CampfireTokenLinker.setLightState(true, this.fireLevel);
        }

        const ctx = this._prepareContext();
        const html = await foundry.applications.handlebars.renderTemplate(this._templatePath, ctx);
        this._container.innerHTML = html;
        this._onRender();
    }

    /**
     * Returns true for terrain types where fire is provided (e.g. tavern hearth).
     */
    _isHearthTerrain() {
        const tag = this._terrainTag?.toLowerCase();
        return tag === "tavern" || tag?.startsWith("tavern_");
    }

    /**
     * Align Make Camp pit art with the segment preview (tier icons or cold moon).
     * @param {string} previewLevel - cold_camp | embers | campfire | bonfire
     * @param {number} partyFirewood - party-wide firewood count for shortfall marks
     */
    syncMakeCampPreview(previewLevel, partyFirewood = 0, requirementSlots = [], ceremonyReady = false) {
        if (!this._makeCampCeremony) return;
        const level = ["cold_camp", "embers", "campfire", "bonfire"].includes(previewLevel)
            ? previewLevel
            : "embers";
        const fw = Math.max(0, Number(partyFirewood) || 0);
        const slotsJson = JSON.stringify(requirementSlots ?? []);
        const prevJson = JSON.stringify(this._makeCampRequirementSlots ?? []);
        const changed = level !== this._makeCampPreviewLevel
            || fw !== this._makeCampPartyFirewood
            || slotsJson !== prevJson
            || ceremonyReady !== this._ceremonyReadyToLight;
        if (!changed) return;
        this._makeCampPreviewLevel = level;
        this._makeCampPartyFirewood = fw;
        this._makeCampRequirementSlots = requirementSlots ?? [];
        this._ceremonyReadyToLight = !!ceremonyReady;
        if (level === "cold_camp") {
            this._kindlingPlaced = false;
        } else {
            this._kindlingPlaced = this._ceremonyReadyToLight;
        }
        if (this._container) void this.render();
    }

    _buildMakeCampPreviewVisual() {
        const level = this._makeCampPreviewLevel ?? "embers";
        if (level === "cold_camp") {
            return {
                previewColdCamp: true,
                previewRequirementSlots: []
            };
        }
        return {
            previewColdCamp: false,
            previewRequirementSlots: this._makeCampRequirementSlots ?? []
        };
    }

    _prepareContext() {
        const fireCantrip = this._findFireCantrip();
        const previewVisual = this._makeCampCeremony ? this._buildMakeCampPreviewVisual() : null;
        const hasOwnTinderbox = this._hasTinderbox();
        const ceremonyIgniteBlocked = this._makeCampCeremony && !this._canCommitCeremonyIgnite();
        const activityFirePanel = !this._makeCampCeremony && this._showDouseBtn;
        const meterLevel = this._getMeterLevel();
        return {
            lit: this._lit,
            litBy: this._litBy,
            litByColor: this._litBy ? this._getPlayerColor(this._litBy) : "#ffdc82",
            showLitBanner: this._showLitBanner,
            heat: this._heat,
            fireLevel: this.fireLevel,
            firewoodCount: this._getFirewoodCount(),
            hasTinderbox: hasOwnTinderbox,
            hasFireCantrip: !!fireCantrip,
            fireCantrip: fireCantrip?.name ?? null,
            kindlingPlaced: this._kindlingPlaced,
            fireLevelAdvisory: this._getFireLevelAdvisory(),
            strikeCount: this._strikeCount,
            trinkets: TRINKETS,
            emotes: EMOTES,
            whittleProgress: this._whittleProgress,
            whittleTarget: this._whittleTarget,
            whittlePct: Math.round((this._whittleProgress / this._whittleTarget) * 100),
            lastWhittledFigure: this._lastWhittledFigure,
            showDouseBtn: this._showDouseBtn && this._lit,
            kindlingDragImg: this._getKindlingDragImg(),
            makeCampCeremony: this._makeCampCeremony,
            previewColdCamp: previewVisual?.previewColdCamp ?? false,
            previewRequirementSlots: previewVisual?.previewRequirementSlots ?? [],
            previewFirewoodShortfall: (previewVisual?.previewRequirementSlots ?? [])
                .some(s => !s.filled && s.insufficient),
            ceremonyWoodStaged: (previewVisual?.previewRequirementSlots ?? []).filter(s => s.filled).length,
            ceremonyWoodRequired: (previewVisual?.previewRequirementSlots ?? []).length,
            ceremonyCanStageMore: (() => {
                const req = previewVisual?.previewRequirementSlots ?? [];
                const filled = req.filter(s => s.filled).length;
                return filled < req.length && this._getFirewoodCount() > 0;
            })(),
            showGiftKindlingBtn: this._makeCampCeremony && !!game.user?.isGM,
            giftKindlingTargetName: this._getPlayerActor()?.name ?? "player",
            ceremonyIgniteBlocked,
            ceremonyIgniteBlockReason: this._ceremonyIgniteBlockReasonFn?.()
                || "Place the campfire on the map before lighting.",
            activityFirePanel,
            coldCampActive: this._coldCampActive,
            showFireMeter: this._makeCampCeremony ? this._lit : activityFirePanel,
            meterLevel,
            showGiftWoodBtn: activityFirePanel && !this._lit && !!game.user?.isGM && !!this._onGiftCeremonyWood
        };
    }

    /** Tier shown on the activity fire meter (includes cold camp at 0%). */
    _getMeterLevel() {
        if (!this._lit && this._coldCampActive) return "cold_camp";
        return this.fireLevel;
    }

    /** @returns {string} */
    _getKindlingDragImg() {
        const item = findConsumableFirewoodItem(this._getPlayerActor());
        return item?.img || DEFAULT_KINDLING_IMG;
    }

    /**
     * Aim drops into the fire zone so kindling gets the same catch-fire animation as whittled figures.
     * @param {number} x - normalized 0-1
     * @param {number} y - normalized 0-1
     * @returns {{ x: number, y: number }}
     */
    _normalizeKindlingDrop(x, y) {
        return {
            x: Math.max(0.32, Math.min(0.68, x)),
            y: Math.max(0.45, Math.min(0.72, y ?? 0.55))
        };
    }

    /**
     * @param {number} x - normalized 0-1
     * @param {number} y - normalized 0-1
     * @param {object} [opts]
     */
    _dropKindlingOnFire(x, y, opts = {}) {
        const drop = this._normalizeKindlingDrop(x, y);
        this._physics?.addFallingItem(drop.x, drop.y, null, "#b48240", {
            img: this._getKindlingDragImg(),
            catchFire: true,
            ...opts
        });
    }

    setContextActorId(actorId) {
        this._contextActorId = actorId ?? null;
    }

    /**
     * Switch between Make Camp ceremony host and Activities side panel host.
     * @param {{ makeCampCeremony?: boolean, showDouseBtn?: boolean }} mode
     */
    setPanelMode({ makeCampCeremony = false, showDouseBtn = false } = {}) {
        this._makeCampCeremony = !!makeCampCeremony;
        this._showDouseBtn = !!showDouseBtn;
    }

    /**
     * Point at a new host element after RestSetupApp re-rendered the template.
     * @param {HTMLElement} container
     */
    rebindContainer(container) {
        if (!container || container === this._container) return;
        if (this._decayInterval) {
            clearInterval(this._decayInterval);
            this._decayInterval = null;
        }
        if (this._emberInterval) {
            clearInterval(this._emberInterval);
            this._emberInterval = null;
        }
        if (this._physics) {
            this._physics.destroy();
            this._physics = null;
        }
        this._container = container;
    }

    /**
     * Align local heat and lit state with rest ceremony fire level (no decay drift).
     * @param {string} level - unlit | embers | campfire | bonfire
     * @param {boolean} [coldCamp]
     * @param {{ force?: boolean }} [options]
     */
    syncFromRestFireLevel(level, coldCamp = false, options = {}) {
        const force = !!options.force;
        const ceremonyKey = coldCamp ? "cold_camp" : level;
        if (!force && ceremonyKey === this._lastSyncedRestCeremonyKey) {
            logCampfireReconnect("embed:syncFromRestFireLevel:skip", {
                level,
                coldCamp,
                ceremonyKey,
                reason: "already synced"
            });
            return;
        }

        logCampfireReconnect("embed:syncFromRestFireLevel", {
            level,
            coldCamp,
            force,
            priorLit: this._lit,
            priorHeat: this._heat,
            priorKey: this._lastSyncedRestCeremonyKey ?? null,
            hasContainer: !!this._container
        });

        const wasLitBefore = ["embers", "campfire", "bonfire"].includes(
            this._lastSyncedRestCeremonyKey ?? ""
        );

        if (coldCamp || level === "unlit") {
            this._lit = false;
            this._litBy = null;
            this._heat = 0;
            this._peakHeat = 0;
            this._coldCampActive = !!coldCamp;
            if (wasLitBefore) this._kindlingPlaced = false;
            this._lastFireLevel = "unlit";
        } else {
            this._lit = true;
            this._coldCampActive = false;
            this._heat = level === "bonfire" ? 75 : level === "campfire" ? 50 : 25;
            this._peakHeat = this._heat;
            this._kindlingPlaced = true;
            this._lastFireLevel = level;
        }
        this._lastSyncedRestCeremonyKey = ceremonyKey;
        this._applyFireAreaVisualState(this._container);
        logCampfireReconnect("embed:syncFromRestFireLevel:done", {
            lit: this._lit,
            heat: this._heat,
            fireLevel: this.fireLevel,
            ceremonyKey
        });
    }

    /** Apply fire tier CSS classes and meter after render or rest sync. */
    _applyFireAreaVisualState(el) {
        if (!el) {
            logCampfireReconnect("embed:applyFireAreaVisualState:skip", { reason: "no container" });
            return;
        }
        const area = el.querySelector(".campfire-fire-area");
        if (area) {
            area.classList.remove(
                "fire-level-unlit",
                "fire-level-embers",
                "fire-level-campfire",
                "fire-level-bonfire"
            );
            if (this._lit) {
                area.classList.add(`fire-level-${this.fireLevel}`);
            } else if (this._coldCampActive) {
                area.classList.add("fire-level-cold-camp");
            }
        }
        this._updateMeter(el);
        logCampfireReconnect("embed:applyFireAreaVisualState", {
            lit: this._lit,
            fireLevel: this.fireLevel,
            areaFound: !!area,
            areaClasses: area?.className ?? null
        });
    }

    _onRender() {
        const el = this._container;
        if (!el) return;

        // Initialize canvas physics engine
        const canvas = el.querySelector(".campfire-physics-canvas");
        if (canvas) {
            if (this._physics) this._physics.destroy();
            this._physics = new CampfirePhysics(canvas);
            this._physics.preloadImage(this._getKindlingDragImg());
            this._physics.onItemBurned = (item) => {
                if (item?.label === "Firewood" && this._lit) {
                    this._heat = Math.min(100, this._heat + 18);
                    this._updateMeter(el);
                    this._notifyFireLevel();
                    return;
                }
                if (!this._disableDecay) {
                    this._heat = Math.min(100, this._heat + 1);
                    this._updateMeter(el);
                    this._notifyFireLevel();
                }
            };
            if (this._lit) this._startEmbers();
        }

        // Bind firewood drag-drop
        this._bindFirewoodDragDrop(el);

        // Bind interactions
        if (this._lit) {
            this._bindTrinketDragDrop(el);
            this._bindWhittlePileDrop(el);
            if (!this._disableDecay) this._startDecay();
        }

        // Bind action buttons
        this._bindActions(el);

        this._applyFireAreaVisualState(el);

        logCampfireReconnect("embed:onRender", {
            lit: this._lit,
            fireLevel: this.fireLevel,
            heat: this._heat,
            hasCanvas: !!canvas,
            containerConnected: el.isConnected
        });

        // Deferred kindling banner
        if (this._pendingKindlingBanner) {
            const name = this._pendingKindlingBanner;
            this._pendingKindlingBanner = null;
            this._showKindlingBanner(name);
        }
    }

    // ──────── Action binding (replaces ApplicationV2 actions) ────────

    _bindActions(el) {
        // Strike Flint
        const strikeBtn = el.querySelector('[data-action="strikeFlint"]');
        if (strikeBtn && !strikeBtn._bound) {
            strikeBtn._bound = true;
            strikeBtn.addEventListener("click", () => this._onStrikeFlint());
        }

        // Cantrip Ignite
        const cantripBtn = el.querySelector('[data-action="cantripIgnite"]');
        if (cantripBtn && !cantripBtn._bound) {
            cantripBtn._bound = true;
            cantripBtn.addEventListener("click", () => this._onCantripIgnite());
        }

        const giftBtn = el.querySelector('[data-action="giftCeremonyWood"]');
        if (giftBtn && !giftBtn._bound) {
            giftBtn._bound = true;
            giftBtn.addEventListener("click", (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (this._onGiftCeremonyWood) void this._onGiftCeremonyWood();
            });
        }

        // Reclaim staged ceremony kindling
        for (const btn of el.querySelectorAll('[data-action="unstageCeremonyWood"]')) {
            if (btn._bound) continue;
            btn._bound = true;
            btn.addEventListener("click", (e) => {
                e.preventDefault();
                e.stopPropagation();
                const slotId = btn.dataset.slotId;
                if (slotId && this._onUnstageCeremonyWood) void this._onUnstageCeremonyWood(slotId);
            });
        }

        // Poke Fire
        const fireArea = el.querySelector('[data-action="pokeFire"]');
        if (fireArea && !fireArea._pokeBound) {
            fireArea._pokeBound = true;
            fireArea.addEventListener("click", (e) => this._onPokeFire(e, fireArea));
        }

        // Emotes
        const emoteButtons = el.querySelectorAll('[data-action="emote"]');
        for (const btn of emoteButtons) {
            if (btn._bound) continue;
            btn._bound = true;
            btn.addEventListener("click", () => {
                const emoteId = btn.dataset.emoteId;
                const emote = EMOTES.find(e => e.id === emoteId);
                if (!emote) return;
                const displayName = this._resolveDisplayName(game.user.name);
                const color = this._getPlayerColor(game.user.name);
                this._playEmote(emote, displayName, color);
                game.socket.emit(`module.${MODULE_ID}`, {
                    type: "campfireEmote", emoteId, userName: displayName, color
                });
            });
        }

        // Whittle
        const whittleBtn = el.querySelector('[data-action="whittle"]');
        if (whittleBtn && !whittleBtn._bound) {
            whittleBtn._bound = true;
            whittleBtn.addEventListener("click", () => this._onWhittle());
        }

        const douseBtn = el.querySelector('[data-action="douseFire"]');
        if (douseBtn && !douseBtn._bound) {
            douseBtn._bound = true;
            douseBtn.addEventListener("click", () => this._onDouseFire());
        }
    }

    _onDouseFire() {
        if (!this._lit) return;
        const level = this.fireLevel;
        let targetLevel;
        if (level === "bonfire") targetLevel = "campfire";
        else if (level === "campfire") targetLevel = "embers";
        else if (level === "embers") {
            if (!game.user.isGM) {
                ui.notifications.warn("Only the GM can douse the fire to cold camp.");
                return;
            }
            targetLevel = "unlit";
        } else {
            return;
        }

        // Request the tier change through rest sync; do not mutate heat locally.
        // Players emit to the GM; the embed updates when PHASE_CHANGED or
        // syncFromRestFireLevel runs after the commit.
        if (this._onFireLevelChange) {
            void this._onFireLevelChange(targetLevel);
        }
    }

    // ──────── Ambient Embers ────────

    _startEmbers() {
        if (this._emberInterval) return;
        this._emberInterval = setInterval(() => {
            if (!this._lit || !this._physics) return;
            this._physics.emitEmbers(1 + Math.floor(Math.random() * 2));
        }, 800);
    }

    // ──────── Poke Fire ────────

    _onPokeFire(event, target) {
        if (!this._lit) return;
        const rect = target.getBoundingClientRect();
        const x = (event.clientX - rect.left) / rect.width;
        const y = (event.clientY - rect.top) / rect.height;
        const color = this._getPlayerColor(game.user.name);
        this._physics?.emitSparks(x, y, color, 10);
        if (!this._disableDecay) {
            this._heat = Math.min(100, this._heat + 1);
            this._updateMeter(this._container);
        }
        game.socket.emit(`module.${MODULE_ID}`, {
            type: "campfirePoke", userName: game.user.name, x, y, color
        });
    }

    receivePoke(data) {
        this._physics?.emitSparks(data.x ?? 0.5, data.y ?? 0.6, data.color ?? "#ffcc33", 10);
        if (!this._disableDecay) {
            this._heat = Math.min(100, this._heat + 1);
            this._updateMeter(this._container);
        }
    }

    // ──────── Trinkets ────────

    _bindTrinketDragDrop(el) {
        const trinkets = el.querySelectorAll(".trinket-item");
        const dropZone = el.querySelector(".campfire-fire-area");
        for (const trinket of trinkets) {
            if (trinket._bound) continue;
            trinket._bound = true;
            trinket.addEventListener("dragstart", (e) => {
                e.dataTransfer.setData("text/plain", trinket.dataset.trinketId);
                trinket.classList.add("dragging");
            });
            trinket.addEventListener("dragend", () => trinket.classList.remove("dragging"));
        }
        if (dropZone && !dropZone._trinketBound) {
            dropZone._trinketBound = true;
            dropZone.addEventListener("drop", (e) => {
                const data = e.dataTransfer.getData("text/plain");
                const trinket = TRINKETS.find(t => t.id === data);
                if (trinket) {
                    e.preventDefault();
                    dropZone.classList.remove("drop-hover");
                    const rect = dropZone.getBoundingClientRect();
                    const x = (e.clientX - rect.left) / rect.width;
                    const y = (e.clientY - rect.top) / rect.height;
                    this._tossTrinket(trinket, x, y);
                }
            });
        }
    }

    _tossTrinket(trinket, x, y) {
        this._physics?.addFlash(x, y, trinket.color);
        const item = this._container?.querySelector(`.trinket-item[data-trinket-id="${trinket.id}"]`);
        if (item) item.remove();
        this._heat = Math.min(100, this._heat + 3);
        this._updateMeter(this._container);
        game.socket.emit(`module.${MODULE_ID}`, {
            type: "campfireTrinket", trinketId: trinket.id, color: trinket.color,
            userName: game.user.name, x, y
        });
    }

    receiveTrinket(data) {
        this._physics?.addFlash(data.x ?? 0.5, data.y ?? 0.7, data.color);
        const item = this._container?.querySelector(`.trinket-item[data-trinket-id="${data.trinketId}"]`);
        if (item) item.remove();
        this._heat = Math.min(100, this._heat + 3);
        this._updateMeter(this._container);
    }

    // ──────── Emotes ────────

    receiveEmote(data) {
        const emote = EMOTES.find(e => e.id === data.emoteId);
        if (emote) this._playEmote(emote, data.userName, data.color ?? "#ffdc82");
    }

    _playEmote(emote, userName, color = "#ffdc82") {
        const fireArea = this._container?.querySelector(".campfire-fire-area");
        if (!fireArea) return;
        const wisp = document.createElement("div");
        wisp.classList.add("emote-wisp");
        wisp.innerHTML = `<i class="${emote.icon}" style="color:${color}; text-shadow: 0 0 8px ${color}66"></i><span style="color:${color}">${userName}</span>`;
        wisp.style.left = `${20 + Math.random() * 60}%`;
        fireArea.appendChild(wisp);
        setTimeout(() => wisp.remove(), 3000);
    }

    // ──────── Whittle ────────

    _onWhittle() {
        this._whittleProgress++;
        this._playWhittleShaving();
        if (this._whittleProgress >= this._whittleTarget) {
            const figure = WHITTLE_FIGURES[Math.floor(Math.random() * WHITTLE_FIGURES.length)];
            this._lastWhittledFigure = figure;
            this._whittleProgress = 0;
            this._whittleTarget = 10 + Math.floor(Math.random() * 6);
            const displayName = this._resolveDisplayName(game.user.name);
            this._showWhittleComplete(figure, displayName);
            this._updateWhittleProgressBar(0);
            game.socket.emit(`module.${MODULE_ID}`, {
                type: "campfireWhittle", complete: true,
                figure: { id: figure.id, icon: figure.icon, label: figure.label },
                userName: displayName
            });
        } else {
            this._updateWhittleProgressBar(
                Math.round((this._whittleProgress / this._whittleTarget) * 100)
            );
        }
    }

    _updateWhittleProgressBar(pct) {
        const fill = this._container?.querySelector(".whittle-progress-fill");
        if (fill) fill.style.width = `${pct}%`;
    }

    receiveWhittle(data) {
        if (data.complete) {
            const figure = WHITTLE_FIGURES.find(f => f.id === data.figure?.id) ?? data.figure;
            this._showWhittleComplete(figure, data.userName);
        }
    }

    _playWhittleShaving() {
        const whittleArea = this._container?.querySelector(".whittle-area");
        if (!whittleArea) return;
        for (let i = 0; i < 3; i++) {
            const shaving = document.createElement("div");
            shaving.classList.add("whittle-shaving");
            shaving.style.left = `${35 + Math.random() * 30}%`;
            shaving.style.animationDelay = `${i * 0.1}s`;
            whittleArea.appendChild(shaving);
            setTimeout(() => shaving.remove(), 800);
        }
    }

    _showWhittleComplete(figure, userName) {
        const fireArea = this._container?.querySelector(".campfire-fire-area");
        if (!fireArea) return;
        const banner = document.createElement("div");
        const color = this._getPlayerColor(userName);
        banner.classList.add("campfire-lit-banner");
        const existingBanners = fireArea.querySelectorAll(".campfire-lit-banner").length;
        banner.style.top = `${15 + existingBanners * 10}%`;
        banner.innerHTML = `<i class="${figure.icon}" style="color:${color}"></i> <span style="color:${color}">${userName}</span> whittled a ${figure.label}`;
        fireArea.appendChild(banner);
        setTimeout(() => banner.remove(), 4000);
        this._addWhittledItem(figure, userName);
    }

    _addWhittledItem(figure, owner) {
        const tray = this._container?.querySelector(".whittle-tray");
        if (!tray) return;
        const item = document.createElement("div");
        item.classList.add("whittled-item");
        item.draggable = true;
        item.dataset.figureId = figure.id;
        item.dataset.owner = owner;
        const color = this._getPlayerColor(owner);
        item.innerHTML = `<i class="${figure.icon}" style="color:${color}"></i>`;
        item.title = `${owner}'s ${figure.label}`;
        item.addEventListener("dragstart", (e) => {
            e.dataTransfer.setData("text/plain", `whittle:${figure.id}:${owner}:${figure.icon}`);
            item.classList.add("dragging");
        });
        item.addEventListener("dragend", () => item.classList.remove("dragging"));
        tray.appendChild(item);
    }

    _bindWhittlePileDrop(el) {
        const dropZone = el.querySelector(".campfire-fire-area");
        if (!dropZone || dropZone._whittleBound) return;
        dropZone._whittleBound = true;
        dropZone.addEventListener("drop", (e) => {
            const raw = e.dataTransfer.getData("text/plain");
            if (!raw?.startsWith("whittle:")) return;
            e.preventDefault();
            dropZone.classList.remove("drop-hover");
            const [, figureId, owner, icon] = raw.split(":");
            const figure = WHITTLE_FIGURES.find(f => f.id === figureId);
            if (!figure) return;
            const rect = dropZone.getBoundingClientRect();
            const x = (e.clientX - rect.left) / rect.width;
            const y = (e.clientY - rect.top) / rect.height;
            this._dropWhittleItem(figure, owner, x, y, true);
            game.socket.emit(`module.${MODULE_ID}`, {
                type: "campfireWhittleDrop", figureId: figure.id, icon: figure.icon,
                owner, x, y, userName: game.user.name
            });
        });
    }

    _dropWhittleItem(figure, owner, x, y, isLocal = false) {
        const color = this._getPlayerColor(owner);
        const trayItems = this._container?.querySelectorAll(`.whittled-item[data-figure-id="${figure.id}"][data-owner="${owner}"]`);
        if (trayItems?.length) trayItems[0].remove();
        if (isLocal) {
            this._physics?.addFallingItem(x, y, figure.icon, color, {
                label: figure.label, owner,
                onSettle: (settledObj) => {
                    const nx = settledObj.x / this._physics._displayWidth;
                    const ny = settledObj.y / this._physics._displayHeight;
                    game.socket.emit(`module.${MODULE_ID}`, {
                        type: "campfireWhittleSettle", figureId: figure.id, icon: figure.icon,
                        owner, x: nx, y: ny, rotation: settledObj.rotation
                    });
                }
            });
        } else {
            this._physics?.placeSettledItem(x, y, figure.icon, color, {
                label: figure.label, owner
            });
        }
    }

    receiveWhittleDrop(data) {
        const figure = WHITTLE_FIGURES.find(f => f.id === data.figureId);
        if (!figure) return;
        const trayItems = this._container?.querySelectorAll(`.whittled-item[data-figure-id="${figure.id}"][data-owner="${data.owner}"]`);
        if (trayItems?.length) trayItems[0].remove();
    }

    receiveWhittleSettle(data) {
        const figure = WHITTLE_FIGURES.find(f => f.id === data.figureId);
        if (!figure) return;
        const color = this._getPlayerColor(data.owner);
        this._physics?.placeSettledItem(data.x, data.y, figure.icon, color, {
            label: figure.label, owner: data.owner, rotation: data.rotation ?? 0
        });
    }

    _ignitePile() {
        if (!this._physics) return;
        const count = this._physics.ignitePile();
        if (count === 0) return;
        this._heat = Math.min(100, this._heat + 25);
        this._updateMeter(this._container);
        this._notifyFireLevel();
        const fireArea = this._container?.querySelector(".campfire-fire-area");
        if (fireArea) {
            const banner = document.createElement("div");
            banner.classList.add("whittle-complete-banner");
            banner.style.color = "#ff8844";
            banner.innerHTML = `<i class="fas fa-fire-alt"></i> The pile catches fire!`;
            fireArea.appendChild(banner);
            setTimeout(() => banner.remove(), 3000);
        }
        game.socket.emit(`module.${MODULE_ID}`, {
            type: "campfirePileIgnite", userName: game.user.name
        });
    }

    receivePileIgnite() {
        if (!this._physics) return;
        this._physics.ignitePile();
        this._heat = Math.min(100, this._heat + 25);
        this._updateMeter(this._container);
        this._notifyFireLevel();
    }

    // ──────── Flint Strike ────────

    _onStrikeFlint() {
        if (this._makeCampCeremony && !this._canCommitCeremonyIgnite()) {
            ui.notifications.warn("Place the campfire on the map before lighting.");
            return;
        }
        const lighter = this._getStrikeFireLighter();
        if (!lighter) {
            ui.notifications.warn("This character needs a tinderbox or flint and steel.");
            return;
        }
        if (!this._kindlingPlaced && !this._ceremonyReadyToLight) {
            ui.notifications.warn("Place enough kindling for this tier first.");
            return;
        }
        this._strikeCount++;
        this._playSpark();

        const hint = this._container?.querySelector(".ceremony-pit-strike-attempt")
            ?? this._container?.querySelector(".strike-hint");
        if (hint) {
            hint.textContent = this._strikeCount > FLINT_STRIKE_GUARANTEE_AFTER
                ? `Attempt ${this._strikeCount} · It catches!`
                : this._strikeCount === FLINT_STRIKE_GUARANTEE_AFTER
                    ? `Attempt ${this._strikeCount} · Sure spark`
                    : `Attempt ${this._strikeCount} · Keep trying!`;
        }

        const chance = Math.min(this._strikeCount * 3, 20);
        const roll = Math.floor(Math.random() * 100);
        const success = this._strikeCount > FLINT_STRIKE_GUARANTEE_AFTER || roll < chance;

        game.socket.emit(`module.${MODULE_ID}`, {
            type: "campfireStrike",
            userId: game.user.id,
            userName: game.user.name,
            actorName: lighter.actorName,
            actorId: lighter.actorId,
            method: lighter.method ?? "Tinderbox",
            strikeCount: this._strikeCount,
            success
        });

        if (success) {
            this._ignite(lighter.actorName, {
                actorId: lighter.actorId,
                method: lighter.method ?? "Tinderbox"
            });
        }
    }

    receiveStrike(data) {
        if (data.userId === game.user.id) return;
        this._strikeCount = data.strikeCount;
        if (this._lit) return;
        if (!this._lit) this._playSpark();
        if (data.success) {
            this._ignite(data.actorName ?? data.userName, {
                actorId: data.actorId,
                method: data.cantrip ?? data.method ?? "Tinderbox"
            });
        }
    }

    _ignite(playerName, igniteMeta = {}) {
        if (this._lit) return;
        if (this._makeCampCeremony && !this._canCommitCeremonyIgnite()) {
            ui.notifications.warn("Place the campfire on the map before lighting.");
            return;
        }
        this._lit = true;
        this._coldCampActive = false;
        this._litBy = playerName;
        this._heat = 25;
        this._showLitBanner = true;
        this.render();

        // Make Camp ceremony: panel can show a lit minigame before the table commits;
        // map token stays off until RestSetupApp commits via onCeremonyIgnited.
        if (!this._makeCampCeremony) {
            CampfireTokenLinker.setLightState(true, this.fireLevel);
        }

        if (this._litNotifyTimer) clearTimeout(this._litNotifyTimer);
        this._litNotifyTimer = setTimeout(() => {
            this._showLitBanner = false;
            this.render();
        }, 3000);

        if (this._makeCampCeremony && this._onCeremonyIgnited) {
            const strikeLighter = this._getStrikeFireLighter();
            void this._onCeremonyIgnited({
                actorName: playerName,
                actorId: igniteMeta.actorId ?? strikeLighter?.actorId ?? this._getPlayerActor()?.id,
                method: igniteMeta.method ?? strikeLighter?.method ?? "Tinderbox",
                readyToLight: !!(this._ceremonyReadyToLight || this._kindlingPlaced)
            });
            return;
        }
        this._notifyFireLevel();
    }

    // ──────── Firewood & Tinderbox ────────

    _getPlayerColor(nameOrUserName) {
        const user = game.users?.find(u => u.name === nameOrUserName)
            ?? game.users?.find(u => u.character?.name === nameOrUserName);
        return user?.color?.toString() ?? "#ffdc82";
    }

    _resolveDisplayName(userName) {
        const user = game.users?.find(u => u.name === userName);
        return user?.character?.name ?? userName;
    }

    _getPlayerActor() {
        if (this._contextActorId) {
            const ctx = game.actors.get(this._contextActorId);
            if (ctx) return ctx;
        }
        return game.user?.character
            ?? canvas?.tokens?.controlled?.[0]?.actor
            ?? this._partyCharacterIds
                .map(id => game.actors.get(id))
                .find(a => a?.testUserPermission(game.user, "OWNER"))
            ?? (game.user?.isGM ? game.actors?.find(a => a.type === "character" && a.hasPlayerOwner) : null)
            ?? null;
    }

    /** Selected roster character's fire gear; players may only use characters they own. */
    _viewerCanUseActorFireGear(actor) {
        if (!actor) return false;
        if (game.user?.isGM) return true;
        return actor.isOwner;
    }

    _hasTinderbox() {
        const ctx = this._getPlayerActor();
        if (!this._viewerCanUseActorFireGear(ctx)) return false;
        return actorHasTinderbox(ctx);
    }

    /** @returns {{ actorId: string, actorName: string, method: string }|null} */
    _getStrikeFireLighter() {
        const ctx = this._getPlayerActor();
        if (!this._viewerCanUseActorFireGear(ctx) || !actorHasTinderbox(ctx)) return null;
        return { actorId: ctx.id, actorName: ctx.name, method: "Tinderbox" };
    }

    _findFireCantrip() {
        const fireCantrips = game.ionrift?.respite?.adapter?.getFireCantrips() ?? [];
        if (fireCantrips.length === 0) return null;
        const ctx = this._getPlayerActor();
        if (!this._viewerCanUseActorFireGear(ctx)) return null;
        return ctx.items?.find(i =>
            i.type === "spell"
            && (i.system?.level === 0)
            && fireCantrips.includes(i.name)
        ) ?? null;
    }

    _onCantripIgnite() {
        if (this._makeCampCeremony && !this._canCommitCeremonyIgnite()) {
            ui.notifications.warn("Place the campfire on the map before lighting.");
            return;
        }
        const cantrip = this._findFireCantrip();
        if (!cantrip) {
            ui.notifications.warn("This character has no fire cantrip.");
            return;
        }
        if (!this._kindlingPlaced && !this._ceremonyReadyToLight) {
            ui.notifications.warn("Place enough kindling for this tier first.");
            return;
        }
        const actorName = this._getPlayerActor()?.name ?? game.user.name;
        game.socket.emit(`module.${MODULE_ID}`, {
            type: "campfireStrike",
            userId: game.user.id,
            userName: game.user.name,
            actorName,
            actorId: this._getPlayerActor()?.id,
            strikeCount: 0,
            success: true,
            cantrip: cantrip.name,
            method: cantrip.name
        });
        this._ignite(actorName, {
            actorId: this._getPlayerActor()?.id,
            method: cantrip.name
        });
        // Create Bonfire goes straight to bonfire heat
        if (cantrip.name === "Create Bonfire") {
            this._heat = 70;
            this._updateMeter(this._container);
            this._notifyFireLevel();
        }
    }

    _getFirewoodCount() {
        const actor = this._getPlayerActor();
        return countActorFirewood(actor);
    }

    async _consumeFirewood() {
        const actor = this._getPlayerActor();
        if (!actor) return false;
        const firewood = findConsumableFirewoodItem(actor);
        if (!firewood) return false;

        // Check if current user can modify this actor's items
        const canModify = actor.isOwner;
        if (!canModify) {
            // Route through GM: emit socket, GM performs the mutation
            game.socket.emit(`module.${MODULE_ID}`, {
                type: "consumeFirewood",
                actorId: actor.id,
                itemId: firewood.id
            });
            return true; // Optimistic: assume GM will handle it
        }

        const qty = firewood.system?.quantity ?? 1;
        if (qty <= 1) { await firewood.delete(); }
        else { await firewood.update({ "system.quantity": qty - 1 }); }
        return true;
    }

    _bindFirewoodDragDrop(el) {
        const logs = el.querySelectorAll(".firewood-log");
        const dropZone = el.querySelector(".campfire-fire-area");

        for (const log of logs) {
            if (log._bound) continue;
            log._bound = true;
            log.addEventListener("dragstart", (e) => {
                e.dataTransfer.setData("text/plain", "firewood");
                log.classList.add("dragging");
            });
            log.addEventListener("dragend", () => log.classList.remove("dragging"));
        }

        if (dropZone && !dropZone._firewoodBound) {
            dropZone._firewoodBound = true;
            dropZone.addEventListener("dragover", (e) => {
                e.preventDefault();
                dropZone.classList.add("drop-hover");
            });
            dropZone.addEventListener("dragleave", () => dropZone.classList.remove("drop-hover"));
            dropZone.addEventListener("drop", async (e) => {
                const data = e.dataTransfer.getData("text/plain");
                if (data !== "firewood") return;
                e.preventDefault();
                dropZone.classList.remove("drop-hover");

                const rect = dropZone.getBoundingClientRect();
                const x = (e.clientX - rect.left) / rect.width;
                const y = (e.clientY - rect.top) / rect.height;

                if (this._makeCampCeremony && !this._lit) {
                    if (!this._onStageCeremonyWood) return;
                    const staged = await this._onStageCeremonyWood();
                    if (!staged) return;
                    this._dropKindlingOnFire(x, y, { label: "Kindling" });
                    const actorName = this._getPlayerActor()?.name ?? game.user.name;
                    this._pendingKindlingBanner = actorName;
                    return;
                }

                const consumed = await this._consumeFirewood();
                if (!consumed) return;

                if (this._lit) {
                    this._dropKindlingOnFire(x, y, { label: "Firewood" });
                    const countEl = this._container?.querySelector(".firewood-count");
                    const newCount = this._getFirewoodCount();
                    if (countEl) countEl.textContent = `\u00d7${newCount}`;
                    if (newCount <= 0) {
                        const logEl = this._container?.querySelector(".firewood-log");
                        if (logEl) logEl.remove();
                        if (countEl) countEl.textContent = "";
                    }
                } else {
                    if (this._kindlingPlaced) return;
                    this._kindlingPlaced = true;
                    this._dropKindlingOnFire(x, y, {
                        label: "Kindling"
                    });
                    const actorName = this._getPlayerActor()?.name ?? game.user.name;
                    this._pendingKindlingBanner = actorName;
                    this.render();
                }

                this._emitCampfireStickDebounced({
                    type: "campfireStick", userName: game.user.name,
                    actorName: this._getPlayerActor()?.name ?? game.user.name,
                    x, y, preLit: !this._lit
                });
            });
        }
    }

    _showKindlingBanner(actorName) {
        const fireArea = this._container?.querySelector(".campfire-fire-area");
        if (!fireArea) return;
        const color = this._getPlayerColor(actorName);
        const banner = document.createElement("div");
        banner.classList.add("campfire-lit-banner");
        banner.innerHTML = `<i class="fas fa-fire" style="color:${color}"></i> <span style="color:${color}">${actorName}</span> has placed kindling`;
        fireArea.appendChild(banner);
        setTimeout(() => banner.remove(), 4000);
    }

    receiveStick(data) {
        if (data.preLit) {
            this._kindlingPlaced = true;
            this._pendingKindlingBanner = data.actorName ?? data.userName;
            this.render();
            return;
        }
        this._dropKindlingOnFire(data.x ?? 0.5, data.y ?? 0.55, { label: "Firewood" });
    }

    _playSpark() {
        this._physics?.emitSparks(0.5, 0.7, "#ffcc33", 4);
    }

    // ──────── Fire Decay ────────

    _getFireLevelAdvisory() {
        if (!this._lit) return "";
        const level = this.fireLevel;
        if (level === "bonfire") return "Warm and bright. Comfort is high, but the light may attract unwanted attention.";
        if (level === "campfire") return "Steady warmth. A fair balance between comfort and caution.";
        return "Dim embers. Harder to spot, but offers little warmth.";
    }

    _startDecay() {
        if (this._decayInterval) return;
        this._decayInterval = setInterval(() => {
            if (!this._lit || this._heat <= 0) return;
            this._heat = Math.max(0, this._heat - 0.5);
            this._updateMeter(this._container);
            this._notifyFireLevel();
        }, 3000);
    }

    /** @param {HTMLElement|null} el */
    _meterZoneOrder(el) {
        const hasCold = !!el?.querySelector(".zone-cold-camp");
        return hasCold
            ? ["cold_camp", "embers", "campfire", "bonfire"]
            : ["embers", "campfire", "bonfire"];
    }

    /**
     * Center of the tier segment on the meter track (0–100%).
     * @param {string} level
     * @param {HTMLElement|null} el
     */
    _meterZoneCenterPercent(level, el) {
        const zones = this._meterZoneOrder(el);
        const idx = zones.indexOf(level);
        if (idx < 0) return 0;
        const segment = 100 / zones.length;
        return (idx + 0.5) * segment;
    }

    _updateMeter(el) {
        if (!el) return;
        if (this._heat > this._peakHeat) this._peakHeat = this._heat;
        const meterLevel = this._getMeterLevel();
        const needlePct = this._meterZoneCenterPercent(meterLevel, el);
        const peakLevel = this._lit
            ? CampfireEmbed._fireLevelFromHeat(this._peakHeat)
            : (this._coldCampActive ? "cold_camp" : "unlit");
        const peakPct = peakLevel === "unlit"
            ? 0
            : this._meterZoneCenterPercent(peakLevel, el);
        const fill = el.querySelector(".fire-meter-fill");
        if (fill) {
            fill.style.width = `${meterLevel === "cold_camp" || !this._lit ? 0 : needlePct}%`;
        }
        const needle = el.querySelector(".fire-meter-needle");
        if (needle) needle.style.left = `${needlePct}%`;
        let peak = el.querySelector(".fire-meter-peak");
        if (!peak && this._peakHeat > 0 && this._lit) {
            peak = document.createElement("div");
            peak.classList.add("fire-meter-peak");
            const track = el.querySelector(".fire-meter-track");
            if (track) track.appendChild(peak);
        }
        if (peak) {
            peak.style.left = `${peakPct}%`;
            peak.style.display = this._lit && peakPct > 0 ? "" : "none";
        }
        for (const zone of el.querySelectorAll(".fire-meter-zone")) {
            const zoneId = zone.dataset?.zone;
            zone.classList.toggle("is-active", zoneId === meterLevel);
        }
    }

    _notifyFireLevel() {
        const current = this.fireLevel;
        if (current !== this._lastFireLevel) {
            this._lastFireLevel = current;
            if (this._onFireLevelChange) this._onFireLevelChange(current);
            if (!this._makeCampCeremony && current === "unlit" && this._coldCampActive && game.user.isGM) {
                void CampfireTokenLinker.setLightState(false);
            } else if (!this._makeCampCeremony && this._lit && current !== "unlit" && game.user.isGM) {
                void CampfireTokenLinker.setLightState(true, current);
            }
        }
    }

    // ──────── Snapshot ────────

    getSnapshot() {
        return {
            lit: this._lit, litBy: this._litBy, heat: this._heat,
            strikeCount: this._strikeCount,
            pile: this._physics?.getSettledItems() ?? []
        };
    }

    applySnapshot(snap) {
        if (!snap) return;
        this._lit = snap.lit ?? false;
        this._litBy = snap.litBy ?? null;
        this._heat = snap.heat ?? 0;
        this._strikeCount = snap.strikeCount ?? 0;
        if (snap.pile && this._physics) {
            this._physics.restoreSettledItems(snap.pile);
        }
        this.render();
    }

    // ──────── Cleanup ────────

    destroy() {
        if (this._decayInterval) { clearInterval(this._decayInterval); this._decayInterval = null; }
        if (this._litNotifyTimer) { clearTimeout(this._litNotifyTimer); this._litNotifyTimer = null; }
        if (this._emberInterval) { clearInterval(this._emberInterval); this._emberInterval = null; }
        if (this._physics) { this._physics.destroy(); this._physics = null; }
        if (this._container) { this._container.innerHTML = ""; }
    }
}
