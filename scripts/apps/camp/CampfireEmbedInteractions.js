import { emitSocketMessage } from "../../services/socket/SocketController.js";
/**
 * CampfireEmbed
 * Lightweight version of CampfireApp that renders into an arbitrary DOM container
 * instead of an ApplicationV2 window. Used for the slide-out drawer in RestSetupApp.
 *
 * Reuses the same campfire.hbs template and CampfirePhysics engine.
 * All socket events route through the same module.js handlers.
 */
import { CampfirePhysics } from "../../services/camp/fire/CampfirePhysics.js";
import { CampfireTokenLinker } from "../../services/camp/fire/CampfireTokenLinker.js";
import {
    CampGearScanner,
    actorHasTinderbox,
    countActorFirewood,
    findConsumableFirewoodItem,
    isFireCantripItem,
    isCreateBonfireCantrip
} from "../../services/camp/gear/CampGearScanner.js";
import { logCampfireReconnect } from "../../services/camp/fire/CampfireReconnectLog.js";
import { MODULE_ID } from "../../data/moduleId.js";

/** Default kindling art (matches respite-items kindling.json). */
const DEFAULT_KINDLING_IMG = "icons/commodities/wood/kindling-sticks-brown.webp";

/** After this many strike attempts, the next try always lights the fire. */
const FLINT_STRIKE_GUARANTEE_AFTER = 10;

// Labels are getters: these arrays are built at module load, before translations are ready.
const TRINKETS = [
    { id: "pinecone", icon: "fas fa-tree", get label() { return game.i18n.localize("ionrift-respite.campfire.trinket.pinecone"); }, color: "#4ade80" },
    { id: "letter", icon: "fas fa-envelope", get label() { return game.i18n.localize("ionrift-respite.campfire.trinket.letter"); }, color: "#fbbf24" },
    { id: "flower", icon: "fas fa-seedling", get label() { return game.i18n.localize("ionrift-respite.campfire.trinket.flower"); }, color: "#c084fc" },
    { id: "vial", icon: "fas fa-flask", get label() { return game.i18n.localize("ionrift-respite.campfire.trinket.vial"); }, color: "#60a5fa" },
    { id: "arrow", icon: "fas fa-long-arrow-alt-right", get label() { return game.i18n.localize("ionrift-respite.campfire.trinket.arrow"); }, color: "#f87171" }
];

const EMOTES = [
    { id: "mug", icon: "fas fa-mug-hot", get label() { return game.i18n.localize("ionrift-respite.campfire.emote.mug"); } },
    { id: "laugh", icon: "fas fa-laugh", get label() { return game.i18n.localize("ionrift-respite.campfire.emote.laugh"); } },
    { id: "think", icon: "fas fa-brain", get label() { return game.i18n.localize("ionrift-respite.campfire.emote.think"); } },
    { id: "nod", icon: "fas fa-thumbs-up", get label() { return game.i18n.localize("ionrift-respite.campfire.emote.nod"); } }
];

const WHITTLE_FIGURES = [
    { id: "wolf", icon: "fas fa-dog", get label() { return game.i18n.localize("ionrift-respite.campfire.whittle.wolf"); } },
    { id: "bird", icon: "fas fa-dove", get label() { return game.i18n.localize("ionrift-respite.campfire.whittle.bird"); } },
    { id: "star", icon: "fas fa-star", get label() { return game.i18n.localize("ionrift-respite.campfire.whittle.star"); } },
    { id: "shield", icon: "fas fa-shield-alt", get label() { return game.i18n.localize("ionrift-respite.campfire.whittle.shield"); } },
    { id: "bear", icon: "fas fa-paw", get label() { return game.i18n.localize("ionrift-respite.campfire.whittle.bear"); } },
    { id: "dragon", icon: "fas fa-dragon", get label() { return game.i18n.localize("ionrift-respite.campfire.whittle.dragon"); } },
    { id: "tree", icon: "fas fa-tree", get label() { return game.i18n.localize("ionrift-respite.campfire.whittle.tree"); } },
    { id: "fish", icon: "fas fa-fish", get label() { return game.i18n.localize("ionrift-respite.campfire.whittle.fish"); } }
];

const PILE_IGNITE_THRESHOLD = 6;

export const CampfireEmbedInteractionMethods = {
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
        emitSocketMessage({
            type: "campfirePoke", userName: game.user.name, x, y, color
        });
    },

    receivePoke(data) {
        this._physics?.emitSparks(data.x ?? 0.5, data.y ?? 0.6, data.color ?? "#ffcc33", 10);
        if (!this._disableDecay) {
            this._heat = Math.min(100, this._heat + 1);
            this._updateMeter(this._container);
        }
    },

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
    },

    _tossTrinket(trinket, x, y) {
        this._physics?.addFlash(x, y, trinket.color);
        const item = this._container?.querySelector(`.trinket-item[data-trinket-id="${trinket.id}"]`);
        if (item) item.remove();
        this._heat = Math.min(100, this._heat + 3);
        this._updateMeter(this._container);
        emitSocketMessage({
            type: "campfireTrinket", trinketId: trinket.id, color: trinket.color,
            userName: game.user.name, x, y
        });
    },

    receiveTrinket(data) {
        this._physics?.addFlash(data.x ?? 0.5, data.y ?? 0.7, data.color);
        const item = this._container?.querySelector(`.trinket-item[data-trinket-id="${data.trinketId}"]`);
        if (item) item.remove();
        this._heat = Math.min(100, this._heat + 3);
        this._updateMeter(this._container);
    },

    receiveEmote(data) {
        const emote = EMOTES.find(e => e.id === data.emoteId);
        if (emote) this._playEmote(emote, data.userName, data.color ?? "#ffdc82");
    },

    _playEmote(emote, userName, color = "#ffdc82") {
        const fireArea = this._container?.querySelector(".campfire-fire-area");
        if (!fireArea) return;
        const wisp = document.createElement("div");
        wisp.classList.add("emote-wisp");
        wisp.innerHTML = `<i class="${emote.icon}" style="color:${color}; text-shadow: 0 0 8px ${color}66"></i><span style="color:${color}">${userName}</span>`;
        wisp.style.left = `${20 + Math.random() * 60}%`;
        fireArea.appendChild(wisp);
        setTimeout(() => wisp.remove(), 3000);
    },

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
            emitSocketMessage({
                type: "campfireWhittle", complete: true,
                figure: { id: figure.id, icon: figure.icon, label: figure.label },
                userName: displayName
            });
        } else {
            this._updateWhittleProgressBar(
                Math.round((this._whittleProgress / this._whittleTarget) * 100)
            );
        }
    },

    _updateWhittleProgressBar(pct) {
        const fill = this._container?.querySelector(".whittle-progress-fill");
        if (fill) fill.style.width = `${pct}%`;
    },

    receiveWhittle(data) {
        if (data.complete) {
            const figure = WHITTLE_FIGURES.find(f => f.id === data.figure?.id) ?? data.figure;
            this._showWhittleComplete(figure, data.userName);
        }
    },

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
    },

    _showWhittleComplete(figure, userName) {
        const fireArea = this._container?.querySelector(".campfire-fire-area");
        if (!fireArea) return;
        const banner = document.createElement("div");
        const color = this._getPlayerColor(userName);
        banner.classList.add("campfire-lit-banner");
        const existingBanners = fireArea.querySelectorAll(".campfire-lit-banner").length;
        banner.style.top = `${15 + existingBanners * 10}%`;
        banner.innerHTML = `<i class="${figure.icon}" style="color:${color}"></i> ${game.i18n.format("ionrift-respite.campfire.whittledBanner", { name: `<span style="color:${color}">${userName}</span>`, figure: figure.label })}`;
        fireArea.appendChild(banner);
        setTimeout(() => banner.remove(), 4000);
        this._addWhittledItem(figure, userName);
    },

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
        item.title = game.i18n.format("ionrift-respite.campfire.whittledItemTitle", { owner, figure: figure.label });
        item.addEventListener("dragstart", (e) => {
            e.dataTransfer.setData("text/plain", `whittle:${figure.id}:${owner}:${figure.icon}`);
            item.classList.add("dragging");
        });
        item.addEventListener("dragend", () => item.classList.remove("dragging"));
        tray.appendChild(item);
    },

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
            emitSocketMessage({
                type: "campfireWhittleDrop", figureId: figure.id, icon: figure.icon,
                owner, x, y, userName: game.user.name
            });
        });
    },

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
                    emitSocketMessage({
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
    },

    receiveWhittleDrop(data) {
        const figure = WHITTLE_FIGURES.find(f => f.id === data.figureId);
        if (!figure) return;
        const trayItems = this._container?.querySelectorAll(`.whittled-item[data-figure-id="${figure.id}"][data-owner="${data.owner}"]`);
        if (trayItems?.length) trayItems[0].remove();
    },

    receiveWhittleSettle(data) {
        const figure = WHITTLE_FIGURES.find(f => f.id === data.figureId);
        if (!figure) return;
        const color = this._getPlayerColor(data.owner);
        this._physics?.placeSettledItem(data.x, data.y, figure.icon, color, {
            label: figure.label, owner: data.owner, rotation: data.rotation ?? 0
        });
    },

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
            banner.innerHTML = `<i class="fas fa-fire-alt"></i> ${game.i18n.localize("ionrift-respite.campfire.pileCatchesFire")}`;
            fireArea.appendChild(banner);
            setTimeout(() => banner.remove(), 3000);
        }
        emitSocketMessage({
            type: "campfirePileIgnite", userName: game.user.name
        });
    },

    receivePileIgnite() {
        if (!this._physics) return;
        this._physics.ignitePile();
        this._heat = Math.min(100, this._heat + 25);
        this._updateMeter(this._container);
        this._notifyFireLevel();
    },

    _onStrikeFlint() {
        if (this._makeCampCeremony && !this._canCommitCeremonyIgnite()) {
            ui.notifications.warn(game.i18n.localize("ionrift-respite.campCeremony.placeCampfireBeforeLighting"));
            return;
        }
        const lighter = this._getStrikeFireLighter();
        if (!lighter) {
            ui.notifications.warn(game.i18n.localize("ionrift-respite.campfire.needsTinderbox"));
            return;
        }
        if (!this._kindlingPlaced && !this._ceremonyReadyToLight) {
            ui.notifications.warn(game.i18n.localize("ionrift-respite.campfire.placeKindlingFirst"));
            return;
        }
        const strikeCount = this._bumpStrikeCount(lighter.actorId);
        this._playSpark();

        const hint = this._container?.querySelector(".ceremony-pit-strike-attempt")
            ?? this._container?.querySelector(".strike-hint");
        if (hint) hint.textContent = this._strikeHint(strikeCount);

        const chance = Math.min(strikeCount * 3, 20);
        const roll = Math.floor(Math.random() * 100);
        const success = strikeCount > FLINT_STRIKE_GUARANTEE_AFTER || roll < chance;

        emitSocketMessage({
            type: "campfireStrike",
            userId: game.user.id,
            userName: game.user.name,
            actorName: lighter.actorName,
            actorId: lighter.actorId,
            method: lighter.method ?? "Tinderbox",
            strikeCount,
            success
        });

        if (success) {
            this._ignite(lighter.actorName, {
                actorId: lighter.actorId,
                method: lighter.method ?? "Tinderbox"
            });
        }
    },

    receiveStrike(data) {
        if (data.userId === game.user.id) return;
        if (data.actorId) this._strikeCounts.set(data.actorId, Number(data.strikeCount) || 0);
        if (this._lit) return;
        if (!this._lit) this._playSpark();
        if (data.success) {
            this._ignite(data.actorName ?? data.userName, {
                actorId: data.actorId,
                method: data.cantrip ?? data.method ?? "Tinderbox"
            });
        }
    },

    _ignite(playerName, igniteMeta = {}) {
        if (this._lit) return;
        if (this._makeCampCeremony && !this._canCommitCeremonyIgnite()) {
            ui.notifications.warn(game.i18n.localize("ionrift-respite.campCeremony.placeCampfireBeforeLighting"));
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
            CampfireTokenLinker.setLightState(true, this.fireLevel, { ignite: true });
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
    },

    _getPlayerColor(nameOrUserName) {
        const user = game.users?.find(u => u.name === nameOrUserName)
            ?? game.users?.find(u => u.character?.name === nameOrUserName);
        return user?.color?.toString() ?? "#ffdc82";
    },

    _resolveDisplayName(userName) {
        const user = game.users?.find(u => u.name === userName);
        return user?.character?.name ?? userName;
    },

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
    },

    /** Selected roster character's fire gear; players may only use characters they own. */
    _viewerCanUseActorFireGear(actor) {
        if (!actor) return false;
        if (game.user?.isGM) return true;
        return actor.isOwner;
    },

    _strikeCountFor(actorId) {
        if (!actorId) return 0;
        return this._strikeCounts.get(actorId) ?? 0;
    },

    _bumpStrikeCount(actorId) {
        const next = this._strikeCountFor(actorId) + 1;
        if (actorId) this._strikeCounts.set(actorId, next);
        return next;
    },

    _strikeHint(count) {
        return game.i18n.format("ionrift-respite.campfire.strikeAttempt", { count });
    },

    _hasTinderbox() {
        const ctx = this._getPlayerActor();
        if (!this._viewerCanUseActorFireGear(ctx)) return false;
        return actorHasTinderbox(ctx);
    },

    /** @returns {{ actorId: string, actorName: string, method: string }|null} */
    _getStrikeFireLighter() {
        const ctx = this._getPlayerActor();
        if (!this._viewerCanUseActorFireGear(ctx) || !actorHasTinderbox(ctx)) return null;
        return { actorId: ctx.id, actorName: ctx.name, method: "Tinderbox" };
    },

    _findFireCantrip() {
        const fireCantrips = game.ionrift?.respite?.adapter?.getFireCantrips() ?? [];
        if (fireCantrips.length === 0) return null;
        const ctx = this._getPlayerActor();
        if (!this._viewerCanUseActorFireGear(ctx)) return null;
        return ctx.items?.find(i => isFireCantripItem(i, fireCantrips)) ?? null;
    },

    _onCantripIgnite() {
        if (this._makeCampCeremony && !this._canCommitCeremonyIgnite()) {
            ui.notifications.warn(game.i18n.localize("ionrift-respite.campCeremony.placeCampfireBeforeLighting"));
            return;
        }
        const cantrip = this._findFireCantrip();
        if (!cantrip) {
            ui.notifications.warn(game.i18n.localize("ionrift-respite.campfire.noFireCantrip"));
            return;
        }
        if (!this._kindlingPlaced && !this._ceremonyReadyToLight) {
            ui.notifications.warn(game.i18n.localize("ionrift-respite.campfire.placeKindlingFirst"));
            return;
        }
        const actorName = this._getPlayerActor()?.name ?? game.user.name;
        emitSocketMessage({
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
        if (isCreateBonfireCantrip(cantrip)) {
            this._heat = 70;
            this._updateMeter(this._container);
            this._notifyFireLevel();
        }
    },

};
