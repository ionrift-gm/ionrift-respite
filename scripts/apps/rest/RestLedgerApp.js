/**
 * RestLedgerApp: GM-only popout showing the structured audit trail
 * for the current rest session. Renders chronological entries grouped
 * by phase, with filter chips and copy-to-clipboard.
 */

import { MODULE_ID } from "../../data/moduleId.js";
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

function getPhaseLabel(phase) {
    switch (phase) {
        case "setup": return game.i18n.localize("ionrift-respite.restLedger.phase.setup");
        case "travel": return game.i18n.localize("ionrift-respite.restLedger.phase.travel");
        case "camp": return game.i18n.localize("ionrift-respite.restLedger.phase.camp");
        case "activity": return game.i18n.localize("ionrift-respite.restLedger.phase.activity");
        case "meal": return game.i18n.localize("ionrift-respite.restLedger.phase.meal");
        case "events": return game.i18n.localize("ionrift-respite.restLedger.phase.events");
        case "resolve": return game.i18n.localize("ionrift-respite.restLedger.phase.recovery");
        default: return phase;
    }
}

const FILTER_CHIPS = [
    { key: "all", get label() { return game.i18n.localize("ionrift-respite.restLedger.filter.all"); } },
    { key: "setup", get label() { return getPhaseLabel("setup"); } },
    { key: "camp", get label() { return getPhaseLabel("camp"); } },
    { key: "activity", get label() { return getPhaseLabel("activity"); } },
    { key: "meal", get label() { return getPhaseLabel("meal"); } },
    { key: "events", get label() { return getPhaseLabel("events"); } },
    { key: "resolve", get label() { return getPhaseLabel("resolve"); } }
];

export class RestLedgerApp extends HandlebarsApplicationMixin(ApplicationV2) {

    static DEFAULT_OPTIONS = {
        id: "ionrift-respite-ledger",
        classes: ["ionrift-window", "glass-ui", "ionrift-respite-app"],
        tag: "div",
        window: {
            title: "ionrift-respite.restLedger.windowTitle",
            icon: "fas fa-book",
            resizable: true
        },
        position: {
            width: 340,
            height: 520
        },
        actions: {
            ledgerFilter: RestLedgerApp.#onFilter,
            ledgerFreezeScroll: RestLedgerApp.#onFreezeScroll,
            ledgerCopy: RestLedgerApp.#onCopy,
            ledgerTogglePhase: RestLedgerApp.#onTogglePhase
        }
    };

    static PARTS = {
        body: {
            template: `modules/${MODULE_ID}/templates/rest-ledger.hbs`
        }
    };

    /** @type {import("../../services/rest/flow/RestLedger.js").RestLedger|null} */
    #ledger = null;
    #activeFilter = "all";
    #freezeScroll = false;
    /** @type {Set<string>} Collapsed phase keys. */
    #collapsedPhases = new Set();

    
    constructor(options = {}, ledger = null) {
        super(options);
        this.#ledger = ledger;
    }

    /** Replace the backing ledger instance (e.g. after state restore). */
    setLedger(ledger) {
        this.#ledger = ledger;
    }

    async _prepareContext(_options) {
        if (!game.user.isGM || !this.#ledger) {
            return { hasEntries: false, filters: FILTER_CHIPS.map(f => ({ ...f, active: f.key === this.#activeFilter })), phaseGroups: [], freezeScroll: this.#freezeScroll };
        }

        const all = this.#ledger.getAll();
        const filtered = this.#activeFilter === "all"
            ? all
            : all.filter(e => e.phase === this.#activeFilter);

        const grouped = new Map();
        for (const entry of filtered) {
            if (!grouped.has(entry.phase)) grouped.set(entry.phase, []);
            grouped.get(entry.phase).push(entry);
        }

        const phaseOrder = ["setup", "travel", "camp", "activity", "meal", "events", "resolve"];
        const phaseGroups = [];
        for (const phase of phaseOrder) {
            const entries = grouped.get(phase);
            if (!entries?.length) continue;
            phaseGroups.push({
                phase,
                label: getPhaseLabel(phase),
                count: entries.length,
                collapsed: this.#collapsedPhases.has(phase),
                entries: entries.map(e => ({
                    ...e,
                    time: RestLedgerApp.#formatTime(e.timestamp)
                }))
            });
        }

        return {
            hasEntries: filtered.length > 0,
            filters: FILTER_CHIPS.map(f => ({ ...f, active: f.key === this.#activeFilter })),
            phaseGroups,
            freezeScroll: this.#freezeScroll
        };
    }

    _onRender(context, options) {
        super._onRender?.(context, options);
        if (!this.#freezeScroll) {
            const list = this.element?.querySelector(".rest-ledger-list");
            if (list) list.scrollTop = list.scrollHeight;
        }
    }

    static #onFilter(event, target) {
        const key = target.dataset.filter ?? "all";
        this.#activeFilter = key;
        this.render();
    }

    static #onFreezeScroll(event, target) {
        this.#freezeScroll = !this.#freezeScroll;
        this.render();
    }

    static async #onCopy(event, target) {
        if (!this.#ledger) return;
        const all = this.#ledger.getAll();
        if (!all.length) {
            ui.notifications.info(game.i18n.localize("ionrift-respite.restLedger.emptyNotice"));
            return;
        }
        const lines = all.map(e => {
            const actor = e.actorName ? `[${e.actorName}] ` : "";
            const detail = e.detail ? ` (${e.detail})` : "";
            return `[${getPhaseLabel(e.phase)}] ${actor}${e.summary}${detail}`;
        });
        try {
            await navigator.clipboard.writeText(lines.join("\n"));
            ui.notifications.info(game.i18n.localize("ionrift-respite.restLedger.copiedNotice"));
        } catch {
            ui.notifications.warn(game.i18n.localize("ionrift-respite.restLedger.copyFailedNotice"));
        }
    }

    static #onTogglePhase(event, target) {
        const phase = target.dataset.phase;
        if (!phase) return;
        if (this.#collapsedPhases.has(phase)) {
            this.#collapsedPhases.delete(phase);
        } else {
            this.#collapsedPhases.add(phase);
        }
        this.render();
    }

    /**
     * Format a timestamp as a short relative or clock string.
     * @param {number} ts
     * @returns {string}
     */
    static #formatTime(ts) {
        if (!ts) return "";
        const d = new Date(ts);
        const h = d.getHours().toString().padStart(2, "0");
        const m = d.getMinutes().toString().padStart(2, "0");
        const s = d.getSeconds().toString().padStart(2, "0");
        return `${h}:${m}:${s}`;
    }

    /**
     * Position this window to the right of a reference app element.
     * @param {HTMLElement} [refEl]
     */
    positionBeside(refEl) {
        if (!refEl || !this.element) return;
        const rect = refEl.getBoundingClientRect();
        const left = Math.round(rect.right + 12);
        const top = Math.round(rect.top);
        this.setPosition({ left, top });
    }
}
