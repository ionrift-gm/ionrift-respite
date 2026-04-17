/**
 * CampfireApp
 * Interactive side panel for the campfire mini-game.
 * Fire area uses a canvas-based physics engine (CampfirePhysics) for
 * sparks, falling items, and pile mechanics.
 * UI controls (buttons, tray, meter) remain DOM-based.
 */
const MODULE_ID = "ionrift-respite";
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
import { CampfirePhysics } from "./CampfirePhysics.js";
import { CampfireTokenLinker } from "../services/CampfireTokenLinker.js";
import { SoundDelegate } from "./delegates/SoundDelegate.js";

/** Trinkets that can be tossed into the fire with colored flash effects. */
const TRINKETS = [
    { id: "pinecone", icon: "fas fa-tree", label: "Pinecone", color: "#4ade80" },
    { id: "letter", icon: "fas fa-envelope", label: "Old Letter", color: "#fbbf24" },
    { id: "flower", icon: "fas fa-seedling", label: "Dried Flower", color: "#c084fc" },
    { id: "vial", icon: "fas fa-flask", label: "Empty Vial", color: "#60a5fa" },
    { id: "arrow", icon: "fas fa-long-arrow-alt-right", label: "Broken Arrow", color: "#f87171" }
];

/** Emote reactions that float up as wisps (DOM-based, needs text rendering). */
const EMOTES = [
    { id: "mug", icon: "fas fa-mug-hot", label: "sips from a mug" },
    { id: "laugh", icon: "fas fa-laugh", label: "chuckles" },
    { id: "think", icon: "fas fa-brain", label: "ponders" },
    { id: "nod", icon: "fas fa-thumbs-up", label: "nods" }
];

/** Possible whittled figures. */
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

export class CampfireApp extends HandlebarsApplicationMixin(ApplicationV2) {

    static DEFAULT_OPTIONS = {
        id: "campfire-panel",
        classes: ["ionrift-window", "campfire-panel"],
        tag: "div",
        window: {
            title: "Campfire",
            resizable: false,
            minimizable: false
        },
        position: {
            width: 360,
            height: 640
        },
        actions: {
            strikeFlint: CampfireApp.#onStrikeFlint,
            pokeFire: CampfireApp.#onPokeFire,
            emote: CampfireApp.#onEmote,
            whittle: CampfireApp.#onWhittle
        }
    };

    static PARTS = {
        campfire: {
            template: `modules/${MODULE_ID}/templates/campfire.hbs`
        }
    };

    constructor(options = {}) {
        super(options);
        this._heat = 0;
        this._lit = false;
        this._litBy = null;
        this._strikeCount = 0;
        this._decayInterval = null;
        this._litNotifyTimer = null;
        this._showLitBanner = false;
        this._onFireLevelChange = options.onFireLevelChange ?? null;
        this._whittleProgress = 0;
        this._whittleTarget = 12;
        this._lastWhittledFigure = null;
        this._peakHeat = 0;
        this._kindlingPlaced = false;
        /** @type {CampfirePhysics|null} */
        this._physics = null;
        this._emberInterval = null;
    }

    get fireLevel() {
        if (!this._lit) return "unlit";
        if (this._heat >= 65) return "bonfire";
        if (this._heat >= 30) return "campfire";
        return "embers";
    }

    /** Fire level based on peak heat reached (used for comfort/event modifiers). */
    get peakFireLevel() {
        if (this._peakHeat >= 65) return "bonfire";
        if (this._peakHeat >= 30) return "campfire";
        if (this._peakHeat > 0) return "embers";
        return "unlit";
    }

    _lastFireLevel = "unlit";

    _getPlayerColor(nameOrUserName) {
        // Try matching by user name first, then by character name
        const user = game.users?.find(u => u.name === nameOrUserName)
            ?? game.users?.find(u => u.character?.name === nameOrUserName);
        return user?.color?.toString() ?? "#ffdc82";
    }

    /** Resolve a user name to their character name for display. */
    _resolveDisplayName(userName) {
        const user = game.users?.find(u => u.name === userName);
        return user?.character?.name ?? userName;
    }

    _prepareContext(options) {
        return {
            lit: this._lit,
            litBy: this._litBy,
            litByColor: this._litBy ? this._getPlayerColor(this._litBy) : "#ffdc82",
            showLitBanner: this._showLitBanner,
            heat: this._heat,
            fireLevel: this.fireLevel,
            firewoodCount: this._getFirewoodCount(),
            hasTinderbox: this._hasTinderbox(),
            kindlingPlaced: this._kindlingPlaced,
            fireLevelAdvisory: this._getFireLevelAdvisory(),
            strikeCount: this._strikeCount,
            trinkets: TRINKETS,
            emotes: EMOTES,
            whittleProgress: this._whittleProgress,
            whittleTarget: this._whittleTarget,
            whittlePct: Math.round((this._whittleProgress / this._whittleTarget) * 100),
            lastWhittledFigure: this._lastWhittledFigure
        };
    }

    _onRender(context, options) {
        const el = this.element;

        // Initialize canvas physics engine
        const canvas = el.querySelector(".campfire-physics-canvas");
        if (canvas) {
            // Destroy previous engine if re-rendering
            if (this._physics) this._physics.destroy();
            this._physics = new CampfirePhysics(canvas);

            // When items burn to ash, boost heat
            this._physics.onItemBurned = (item) => {
                this._heat = Math.min(100, this._heat + 1);
                this._updateMeter(this.element);
                this._notifyFireLevel();
            };

            // Start ambient ember emission when lit
            if (this._lit) this._startEmbers();
        }

        // Bind firewood drag-drop (both pre-lit and post-lit)
        this._bindFirewoodDragDrop(el);

        // Bind interactions
        if (this._lit) {
            this._bindTrinketDragDrop(el);
            this._bindWhittlePileDrop(el);
            this._startDecay();
        }

        // Update meter
        this._updateMeter(el);

        // Show deferred kindling banner after render
        if (this._pendingKindlingBanner) {
            const name = this._pendingKindlingBanner;
            this._pendingKindlingBanner = null;
            this._showKindlingBanner(name);
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

    // ──────── 1. Poke Fire (canvas sparks) ────────

    static async #onPokeFire(event, target) {
        if (!this._lit) return;
        const rect = target.getBoundingClientRect();
        const x = (event.clientX - rect.left) / rect.width;
        const y = (event.clientY - rect.top) / rect.height;
        const color = this._getPlayerColor(game.user.name);

        this._physics?.emitSparks(x, y, color, 10);
        this._heat = Math.min(100, this._heat + 1);
        this._updateMeter(this.element);

        game.socket.emit(`module.${MODULE_ID}`, {
            type: "campfirePoke",
            userName: game.user.name,
            x, y, color
        });
    }

    receivePoke(data) {
        this._physics?.emitSparks(data.x ?? 0.5, data.y ?? 0.6, data.color ?? "#ffcc33", 10);
        this._heat = Math.min(100, this._heat + 1);
        this._updateMeter(this.element);
    }

    // ──────── 2. Toss Trinkets (canvas flash + sparks) ────────

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
        const el = this.element;
        const item = el?.querySelector(`.trinket-item[data-trinket-id="${trinket.id}"]`);
        if (item) item.remove();

        this._heat = Math.min(100, this._heat + 3);
        this._updateMeter(el);

        game.socket.emit(`module.${MODULE_ID}`, {
            type: "campfireTrinket",
            trinketId: trinket.id,
            color: trinket.color,
            userName: game.user.name,
            x, y
        });
    }

    receiveTrinket(data) {
        this._physics?.addFlash(data.x ?? 0.5, data.y ?? 0.7, data.color);
        const el = this.element;
        const item = el?.querySelector(`.trinket-item[data-trinket-id="${data.trinketId}"]`);
        if (item) item.remove();
        this._heat = Math.min(100, this._heat + 3);
        this._updateMeter(el);
    }

    // ──────── 3. Emotes (DOM-based, player color) ────────

    static async #onEmote(event, target) {
        const emoteId = target.dataset.emoteId;
        const emote = EMOTES.find(e => e.id === emoteId);
        if (!emote) return;

        const displayName = this._resolveDisplayName(game.user.name);
        const color = this._getPlayerColor(game.user.name);
        this._playEmote(emote, displayName, color);

        game.socket.emit(`module.${MODULE_ID}`, {
            type: "campfireEmote",
            emoteId,
            userName: displayName,
            color
        });
    }

    receiveEmote(data) {
        const emote = EMOTES.find(e => e.id === data.emoteId);
        if (emote) this._playEmote(emote, data.userName, data.color ?? "#ffdc82");
    }

    _playEmote(emote, userName, color = "#ffdc82") {
        const el = this.element;
        if (!el) return;
        const fireArea = el.querySelector(".campfire-fire-area");
        if (!fireArea) return;

        const wisp = document.createElement("div");
        wisp.classList.add("emote-wisp");
        wisp.innerHTML = `<i class="${emote.icon}" style="color:${color}; text-shadow: 0 0 8px ${color}66"></i><span style="color:${color}">${userName}</span>`;
        wisp.style.left = `${20 + Math.random() * 60}%`;
        fireArea.appendChild(wisp);
        setTimeout(() => wisp.remove(), 3000);
    }

    // ---- 4. Whittle > Canvas Pile > Burn ----

    static async #onWhittle(event, target) {
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
                type: "campfireWhittle",
                complete: true,
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
        const el = this.element;
        if (!el) return;
        const fill = el.querySelector(".whittle-progress-fill");
        if (fill) fill.style.width = `${pct}%`;
    }

    receiveWhittle(data) {
        if (data.complete) {
            const figure = WHITTLE_FIGURES.find(f => f.id === data.figure?.id) ?? data.figure;
            this._showWhittleComplete(figure, data.userName);
        }
    }

    _playWhittleShaving() {
        const el = this.element;
        if (!el) return;
        const whittleArea = el.querySelector(".whittle-area");
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
        const el = this.element;
        if (!el) return;
        const fireArea = el.querySelector(".campfire-fire-area");
        if (!fireArea) return;

        // Banner - reuse the working lit-banner style, stack multiples
        const banner = document.createElement("div");
        const color = this._getPlayerColor(userName);
        banner.classList.add("campfire-lit-banner");
        const existingBanners = fireArea.querySelectorAll(".campfire-lit-banner").length;
        banner.style.top = `${15 + existingBanners * 10}%`;
        banner.innerHTML = `<i class="${figure.icon}" style="color:${color}"></i> <span style="color:${color}">${userName}</span> whittled a ${figure.label}`;
        fireArea.appendChild(banner);
        setTimeout(() => banner.remove(), 4000);

        // Add to tray
        this._addWhittledItem(figure, userName);
    }

    _addWhittledItem(figure, owner) {
        const el = this.element;
        if (!el) return;
        const tray = el.querySelector(".whittle-tray");
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

    /** Bind fire area to accept whittled item drops → canvas physics. */
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
                type: "campfireWhittleDrop",
                figureId: figure.id,
                icon: figure.icon,
                owner,
                x, y,
                userName: game.user.name
            });
        });
    }

    _dropWhittleItem(figure, owner, x, y, isLocal = false) {
        const color = this._getPlayerColor(owner);

        // Remove from tray
        const el = this.element;
        const trayItems = el?.querySelectorAll(`.whittled-item[data-figure-id="${figure.id}"][data-owner="${owner}"]`);
        if (trayItems?.length) trayItems[0].remove();

        if (isLocal) {
            // Local drop: run physics, broadcast settled position when done
            this._physics?.addFallingItem(x, y, figure.icon, color, {
                label: figure.label,
                owner,
                onSettle: (settledObj) => {
                    // Broadcast authoritative settled position to all clients
                    const nx = settledObj.x / this._physics._displayWidth;
                    const ny = settledObj.y / this._physics._displayHeight;
                    game.socket.emit(`module.${MODULE_ID}`, {
                        type: "campfireWhittleSettle",
                        figureId: figure.id,
                        icon: figure.icon,
                        owner,
                        x: nx, y: ny,
                        rotation: settledObj.rotation
                    });
                }
            });
        } else {
            // Remote drop: skip physics, place directly at synced position
            this._physics?.placeSettledItem(x, y, figure.icon, color, {
                label: figure.label,
                owner
            });
        }
    }

    receiveWhittleDrop(data) {
        // Remote clients don't run physics for dropped items - they wait for the settle sync
        // Just remove from tray if present
        const el = this.element;
        const figure = WHITTLE_FIGURES.find(f => f.id === data.figureId);
        if (!figure) return;
        const trayItems = el?.querySelectorAll(`.whittled-item[data-figure-id="${figure.id}"][data-owner="${data.owner}"]`);
        if (trayItems?.length) trayItems[0].remove();
    }

    receiveWhittleSettle(data) {
        // Place item at the authoritative settled position
        const figure = WHITTLE_FIGURES.find(f => f.id === data.figureId);
        if (!figure) return;
        const color = this._getPlayerColor(data.owner);
        this._physics?.placeSettledItem(data.x, data.y, figure.icon, color, {
            label: figure.label,
            owner: data.owner,
            rotation: data.rotation ?? 0
        });
    }

    _ignitePile() {
        if (!this._physics) return;
        const count = this._physics.ignitePile();
        if (count === 0) return;

        this._heat = Math.min(100, this._heat + 25);
        this._updateMeter(this.element);
        this._notifyFireLevel();

        // Banner
        const el = this.element;
        const fireArea = el?.querySelector(".campfire-fire-area");
        if (fireArea) {
            const banner = document.createElement("div");
            banner.classList.add("whittle-complete-banner");
            banner.style.color = "#ff8844";
            banner.innerHTML = `<i class="fas fa-fire-alt"></i> The pile catches fire!`;
            fireArea.appendChild(banner);
            setTimeout(() => banner.remove(), 3000);
        }

        game.socket.emit(`module.${MODULE_ID}`, {
            type: "campfirePileIgnite",
            userName: game.user.name
        });
    }

    receivePileIgnite() {
        if (!this._physics) return;
        this._physics.ignitePile();
        this._heat = Math.min(100, this._heat + 25);
        this._updateMeter(this.element);
        this._notifyFireLevel();
    }

    // ──────── Flint Strike ────────

    static async #onStrikeFlint(event, target) {
        if (!this._hasTinderbox()) {
            ui.notifications.warn("You need a Tinderbox to light the fire.");
            return;
        }
        if (!this._kindlingPlaced) {
            ui.notifications.warn("Place some kindling first.");
            return;
        }
        this._strikeCount++;
        this._playSpark();

        // Update attempt counter in DOM
        const hint = this.element?.querySelector(".strike-hint");
        if (hint) hint.textContent = `Attempt ${this._strikeCount} \u00b7 Keep trying!`;

        const chance = Math.min(this._strikeCount * 3, 20);
        const roll = Math.floor(Math.random() * 100);
        const success = roll < chance;

        game.socket.emit(`module.${MODULE_ID}`, {
            type: "campfireStrike",
            userName: game.user.name,
            actorName: this._getPlayerActor()?.name ?? game.user.name,
            strikeCount: this._strikeCount,
            success
        });

        if (success) this._ignite(this._getPlayerActor()?.name ?? game.user.name);
    }

    receiveStrike(data) {
        this._strikeCount = data.strikeCount;
        if (!this._lit) this._playSpark();
        if (data.success && !this._lit) this._ignite(data.actorName ?? data.userName);
    }

    _ignite(playerName) {
        this._lit = true;
        this._litBy = playerName;
        this._heat = 25;
        this._showLitBanner = true;
        this.render();

        // Sync campfire token light on the canvas
        CampfireTokenLinker.setLightState(true);
        SoundDelegate.startCampfire("embers");

        if (this._litNotifyTimer) clearTimeout(this._litNotifyTimer);
        this._litNotifyTimer = setTimeout(() => {
            this._showLitBanner = false;
            this.render();
        }, 3000);
        this._notifyFireLevel();
    }

    // ──────── Firewood & Tinderbox (inventory-linked) ────────

    _getPlayerActor() {
        return game.user?.character
            ?? canvas?.tokens?.controlled?.[0]?.actor
            ?? null;
    }

    _hasTinderbox() {
        const actor = this._getPlayerActor();
        if (!actor) return false;
        return !!actor.items.find(i => i.name === "Tinderbox");
    }

    _getFirewoodCount() {
        const actor = this._getPlayerActor();
        if (!actor) return 0;
        return actor.items
            .filter(i => i.name === "Kindling")
            .reduce((sum, i) => sum + (i.system?.quantity ?? 1), 0);
    }

    async _consumeFirewood() {
        const actor = this._getPlayerActor();
        if (!actor) return false;
        const firewood = actor.items.find(i => i.name === "Kindling" && (i.system?.quantity ?? 1) > 0);
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

        if (qty <= 1) {
            await firewood.delete();
        } else {
            await firewood.update({ "system.quantity": qty - 1 });
        }
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

                const consumed = await this._consumeFirewood();
                if (!consumed) return;

                const rect = dropZone.getBoundingClientRect();
                const x = (e.clientX - rect.left) / rect.width;
                const y = Math.min((e.clientY - rect.top) / rect.height, 0.3);

                if (this._lit) {
                    // Post-lit: feed fire (DO NOT re-render, it destroys physics)
                    this._physics?.addFallingItem(x, y, "fas fa-grip-lines-vertical", "#b48240", {
                        label: "Firewood",
                        burstOnSettle: true,
                        onSettle: () => {
                            this._heat = Math.min(100, this._heat + 18);
                            this._updateMeter(this.element);
                            this._notifyFireLevel();
                        }
                    });

                    // Update counter in DOM without re-rendering
                    const countEl = this.element?.querySelector(".firewood-count");
                    const newCount = this._getFirewoodCount();
                    if (countEl) countEl.textContent = `×${newCount}`;
                    if (newCount <= 0) {
                        const logEl = this.element?.querySelector(".firewood-log");
                        if (logEl) logEl.remove();
                        if (countEl) countEl.textContent = "";
                    }
                } else {
                    // Pre-lit: place kindling (one-time)
                    if (this._kindlingPlaced) return;
                    this._kindlingPlaced = true;
                    this._physics?.addFallingItem(x, y, "fas fa-grip-lines-vertical", "#b48240", {
                        label: "Kindling"
                    });

                    // Defer banner to show after re-render
                    const actorName = this._getPlayerActor()?.name ?? game.user.name;
                    this._pendingKindlingBanner = actorName;
                    this.render();
                }

                game.socket.emit(`module.${MODULE_ID}`, {
                    type: "campfireStick",
                    userName: game.user.name,
                    actorName: this._getPlayerActor()?.name ?? game.user.name,
                    x, y,
                    preLit: !this._lit
                });
            });
        }
    }

    _showKindlingBanner(actorName) {
        const el = this.element;
        const fireArea = el?.querySelector(".campfire-fire-area");
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
            // Remote kindling placement
            this._kindlingPlaced = true;
            this._pendingKindlingBanner = data.actorName ?? data.userName;
            this.render();
            return;
        }
        // Post-lit: just show physics, don't re-render
        this._physics?.addFallingItem(data.x ?? 0.5, data.y ?? 0.1, "fas fa-grip-lines-vertical", "#b48240", {
            burstOnSettle: true,
            onSettle: () => {
                this._heat = Math.min(100, this._heat + 18);
                this._updateMeter(this.element);
                this._notifyFireLevel();
            }
        });
    }

    _playSpark() {
        // Use canvas sparks at center of fire area
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
            this._updateMeter(this.element);
            this._notifyFireLevel();
        }, 3000);
    }

    _updateMeter(el) {
        if (!el) return;

        // Track peak
        if (this._heat > this._peakHeat) this._peakHeat = this._heat;

        const fill = el.querySelector(".fire-meter-fill");
        if (fill) fill.style.width = `${this._heat}%`;
        const needle = el.querySelector(".fire-meter-needle");
        if (needle) needle.style.left = `${this._heat}%`;

        // Peak marker
        let peak = el.querySelector(".fire-meter-peak");
        if (!peak && this._peakHeat > 0) {
            peak = document.createElement("div");
            peak.classList.add("fire-meter-peak");
            const track = el.querySelector(".fire-meter-track");
            if (track) track.appendChild(peak);
        }
        if (peak) peak.style.left = `${this._peakHeat}%`;
    }

    _notifyFireLevel() {
        const current = this.fireLevel;
        if (current !== this._lastFireLevel) {
            this._lastFireLevel = current;
            if (this._onFireLevelChange) this._onFireLevelChange(current);
            SoundDelegate.updateCampfireLevel(current);
        }
    }

    // ──────── Snapshot ────────

    getSnapshot() {
        return {
            lit: this._lit, litBy: this._litBy, heat: this._heat,
            strikeCount: this._strikeCount, sticksRemaining: this._sticksRemaining,
            pile: this._physics?.getSettledItems() ?? []
        };
    }

    applySnapshot(snap) {
        if (!snap) return;
        this._lit = snap.lit ?? false;
        this._litBy = snap.litBy ?? null;
        this._heat = snap.heat ?? 0;
        this._strikeCount = snap.strikeCount ?? 0;
        this._sticksRemaining = snap.sticksRemaining ?? 6;
        if (snap.pile && this._physics) {
            this._physics.restoreSettledItems(snap.pile);
        }
        this.render();
    }

    // ──────── Cleanup ────────

    async close(...args) {
        SoundDelegate.stopAll();
        if (this._decayInterval) { clearInterval(this._decayInterval); this._decayInterval = null; }
        if (this._litNotifyTimer) { clearTimeout(this._litNotifyTimer); this._litNotifyTimer = null; }
        if (this._emberInterval) { clearInterval(this._emberInterval); this._emberInterval = null; }
        if (this._physics) { this._physics.destroy(); this._physics = null; }
        return super.close(...args);
    }
}
