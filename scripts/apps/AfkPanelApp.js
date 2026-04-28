/**
 * Persistent HUD for AFK during long or short rest.
 * Locked: pinned at saved coordinates (no drag). Unlocked: draggable; layout persists (client setting).
 */
import { getPartyActors } from "../services/partyActors.js";
import * as RestAfkState from "../services/RestAfkState.js";
import {
    emitRestSessionAfk,
    refreshAfterAfkChange
} from "../services/restSessionAfkEmit.js";

const MODULE_ID = "ionrift-respite";
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** @typedef {{ locked: boolean, left: number, top: number }} AfkPanelLayout */

export class AfkPanelApp extends HandlebarsApplicationMixin(ApplicationV2) {

    /** @returns {number} */
    static #defaultDockTop() {
        if (typeof window === "undefined" || typeof window.innerHeight !== "number") return 120;
        return Math.max(48, Math.round(window.innerHeight - 300));
    }

    static DEFAULT_OPTIONS = {
        id: "ionrift-respite-afk-panel",
        classes: ["ionrift-afk-panel-app"],
        tag: "div",
        window: {
            frame: false,
            positioned: false,
            minimizable: false,
            resizable: false
        },
        position: {
            width: "auto",
            height: "auto"
        },
        actions: {
            afkSelfToggle: AfkPanelApp.#onSelfToggle,
            afkGmToggleRow: AfkPanelApp.#onGmToggleRow,
            afkPanelToggleLock: AfkPanelApp.#onAfkPanelToggleLock
        }
    };

    static PARTS = {
        body: {
            template: `modules/${MODULE_ID}/templates/afk-panel.hbs`
        }
    };

    constructor(options = {}) {
        super(options);
        /** @type {{ pointerId: number, startX: number, startY: number, origL: number, origT: number, moved: boolean }|null} */
        this._afkDragState = null;
        this._onAfkPanelPointerDown = this._onAfkPanelPointerDown.bind(this);
        this._onAfkPanelPointerMove = this._onAfkPanelPointerMove.bind(this);
        this._onAfkPanelPointerUp = this._onAfkPanelPointerUp.bind(this);
    }

    /**
     * @returns {AfkPanelLayout}
     */
    static #readLayout() {
        const raw = game.settings?.get?.(MODULE_ID, "afkPanelLayout");
        const base = { locked: true, left: 12, top: AfkPanelApp.#defaultDockTop() };
        if (!raw || typeof raw !== "object") {
            return foundry.utils.duplicate(base);
        }
        return {
            locked: raw.locked !== false,
            left: typeof raw.left === "number" && !Number.isNaN(raw.left) ? raw.left : base.left,
            top: typeof raw.top === "number" && !Number.isNaN(raw.top) ? raw.top : base.top
        };
    }

    /** @param {string[]} ids */
    static #emitBulk(ids, newState) {
        for (const id of ids) {
            RestAfkState.applyUpdate(id, newState);
            emitRestSessionAfk(id, newState);
        }
        refreshAfterAfkChange();
    }

    static #onSelfToggle(event, target) {
        event.preventDefault?.();

        let ids;
        if (game.user.isGM) {
            ids = ["gm"];
        } else {
            ids = game.actors
                .filter(a => a.hasPlayerOwner && a.isOwner && a.type === "character")
                .map(a => a.id);
        }
        if (!ids?.length) return;

        const allAfk = ids.every(id => RestAfkState.isAfk(id));
        const newState = !allAfk;
        AfkPanelApp.#emitBulk(ids, newState);
    }

    static #onGmToggleRow(event, target) {
        event.preventDefault?.();
        if (!game.user.isGM) return;
        const row = target.closest("[data-character-id]");
        const id = row?.dataset?.characterId;
        if (!id) return;

        const newState = !RestAfkState.isAfk(id);
        RestAfkState.applyUpdate(id, newState);
        emitRestSessionAfk(id, newState);
        refreshAfterAfkChange();
    }

    static async #onAfkPanelToggleLock(event, target) {
        event.preventDefault?.();
        event.stopPropagation?.();
        const lay = AfkPanelApp.#readLayout();
        const nextLocked = !lay.locked;
        const el = this.element;
        if (el) {
            const r = el.getBoundingClientRect();
            lay.left = Math.round(r.left);
            lay.top = Math.round(r.top);
        }
        lay.locked = nextLocked;
        try {
            await game.settings.set(MODULE_ID, "afkPanelLayout", lay);
        } catch (e) {
            console.warn(`${MODULE_ID} | Could not save afkPanelLayout`, e);
        }
        await this.render({ force: true });
    }

    _applyPanelPosition() {
        const el = this.element;
        if (!el) return;
        const layout = AfkPanelApp.#readLayout();
        el.classList.toggle("ionrift-afk-panel--locked", layout.locked);
        el.classList.toggle("ionrift-afk-panel--unlocked", !layout.locked);
        el.style.setProperty("position", "fixed");
        el.style.setProperty("z-index", "1001");
        el.style.setProperty("margin", "0");
        el.style.setProperty("transform", "none");
        el.style.setProperty("width", "auto");
        el.style.setProperty("height", "auto");
        const w = el.offsetWidth || 200;
        const h = el.offsetHeight || 200;
        const margin = 4;
        let left = layout.left;
        let top = layout.top;
        const maxL = Math.max(margin, window.innerWidth - w - margin);
        const maxT = Math.max(margin, window.innerHeight - h - margin);
        left = Math.max(margin, Math.min(left, maxL));
        top = Math.max(margin, Math.min(top, maxT));
        el.style.setProperty("left", `${Math.round(left)}px`);
        el.style.setProperty("top", `${Math.round(top)}px`);
        el.style.setProperty("bottom", "auto");
        el.style.setProperty("right", "auto");
    }

    _installAfkPanelDrag() {
        const el = this.element;
        if (!el || el.dataset.ionriftAfkDrag === "1") return;
        el.dataset.ionriftAfkDrag = "1";
        el.addEventListener("pointerdown", this._onAfkPanelPointerDown);
    }

    _teardownAfkPanelDrag() {
        const el = this.element;
        if (el) {
            el.removeEventListener("pointerdown", this._onAfkPanelPointerDown);
            delete el.dataset.ionriftAfkDrag;
        }
        document.removeEventListener("pointermove", this._onAfkPanelPointerMove);
        document.removeEventListener("pointerup", this._onAfkPanelPointerUp);
        this._afkDragState = null;
    }

    _onAfkPanelPointerDown(ev) {
        const header = ev.target.closest(".ionrift-afk-panel-header");
        if (!header || !this.element?.contains(header)) return;
        if (ev.target.closest("button[data-action]")) return;
        if (AfkPanelApp.#readLayout().locked) return;
        if (ev.button !== 0) return;
        ev.preventDefault();
        const r = this.element.getBoundingClientRect();
        this._afkDragState = {
            pointerId: ev.pointerId,
            startX: ev.clientX,
            startY: ev.clientY,
            origL: r.left,
            origT: r.top,
            moved: false
        };
        document.addEventListener("pointermove", this._onAfkPanelPointerMove);
        document.addEventListener("pointerup", this._onAfkPanelPointerUp);
    }

    _onAfkPanelPointerMove(ev) {
        if (!this._afkDragState || ev.pointerId !== this._afkDragState.pointerId) return;
        const dx = ev.clientX - this._afkDragState.startX;
        const dy = ev.clientY - this._afkDragState.startY;
        if (Math.abs(dx) + Math.abs(dy) > 2) this._afkDragState.moved = true;
        const el = this.element;
        if (!el) return;
        const w = el.offsetWidth || 180;
        const h = el.offsetHeight || 200;
        let nl = this._afkDragState.origL + dx;
        let nt = this._afkDragState.origT + dy;
        const margin = 4;
        const maxL = Math.max(margin, window.innerWidth - w - margin);
        const maxT = Math.max(margin, window.innerHeight - h - margin);
        nl = Math.max(margin, Math.min(nl, maxL));
        nt = Math.max(margin, Math.min(nt, maxT));
        el.classList.remove("ionrift-afk-panel--locked");
        el.classList.add("ionrift-afk-panel--unlocked");
        el.style.setProperty("left", `${Math.round(nl)}px`);
        el.style.setProperty("top", `${Math.round(nt)}px`);
        el.style.setProperty("bottom", "auto");
        el.style.setProperty("right", "auto");
    }

    async _onAfkPanelPointerUp(ev) {
        if (!this._afkDragState || ev.pointerId !== this._afkDragState.pointerId) return;
        document.removeEventListener("pointermove", this._onAfkPanelPointerMove);
        document.removeEventListener("pointerup", this._onAfkPanelPointerUp);
        const state = this._afkDragState;
        this._afkDragState = null;
        if (!state.moved) return;
        const el = this.element;
        if (!el) return;
        const r = el.getBoundingClientRect();
        const lay = AfkPanelApp.#readLayout();
        lay.locked = false;
        lay.left = Math.round(Math.max(0, Math.min(r.left, window.innerWidth - 48)));
        lay.top = Math.round(Math.max(0, Math.min(r.top, window.innerHeight - 48)));
        try {
            await game.settings.set(MODULE_ID, "afkPanelLayout", lay);
        } catch (e) {
            console.warn(`${MODULE_ID} | Could not save afkPanelLayout after drag`, e);
        }
        this._applyPanelPosition();
    }

    async render(options = {}) {
        const out = await super.render(options);
        this._applyPanelPosition();
        this._installAfkPanelDrag();
        return out;
    }

    async close(options = {}) {
        this._teardownAfkPanelDrag();
        return super.close(options);
    }

    async _prepareContext(_options) {
        const party = getPartyActors();
        const gmUser = game.users?.find(u => u.isGM);
        const gmName = gmUser?.name ?? "GM";
        const layout = AfkPanelApp.#readLayout();

        const rows = party.map(a => ({
            id: a.id,
            name: a.name ?? "Character",
            img: a.img || "icons/svg/mystery-man.svg",
            isAfk: RestAfkState.isAfk(a.id),
            gmClickable: game.user.isGM
        }));

        rows.push({
            id: "gm",
            name: gmName,
            img: "icons/svg/mystery-man.svg",
            isAfk: RestAfkState.isAfk("gm"),
            gmClickable: game.user.isGM
        });

        const selfAfk = game.user.isGM
            ? RestAfkState.isAfk("gm")
            : party.some(a => a.isOwner && RestAfkState.isAfk(a.id));

        const hasAnyoneAfk = RestAfkState.getAfkCharacterIds().length > 0;

        return { rows, selfAfk, panelLocked: layout.locked, hasAnyoneAfk };
    }
}
