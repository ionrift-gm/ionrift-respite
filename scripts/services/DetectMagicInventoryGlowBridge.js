/**
 * Pluggable bridge for post-Detect-Magic inventory highlights (school-colored glows).
 *
 * By default, applies CSS classes to dnd5e character sheet item rows (`[data-item-id]`).
 * A VFX module can replace this by calling `setDetectMagicInventoryGlowAdapter(adapter)`.
 *
 * Adapter contract (duck-typed):
 * @typedef {object} DetectMagicInventoryGlowAdapter
 * @property {(payload: DetectMagicGlowPayload) => void} [onScanApplied]
 * @property {() => void} [onScanCleared]
 *
 * @typedef {object} DetectMagicGlowPayload
 * @property {object[]|null} results   Same shape as RestSetupApp._magicScanResults
 * @property {boolean} magicScanComplete
 * @property {string[]} partyActorIds  Party roster actor ids at scan time
 */

import { DetectMagicScanner } from "./DetectMagicScanner.js";

const R = "ionrift-respite";

/** Per-row merge segment for inventory lists where siblings are not always adjacent DOM nodes. */
const DM_RUN_CLASSES = ["only", "start", "mid", "end"];

/** After Detect Magic, row glow follows live inventory while the session is active. */
let _dmGlowSessionActive = false;
/** @type {Set<string>} */
const _dmGlowPartyActorIds = new Set();

/** @type {Map<string, ReturnType<typeof setTimeout>>} */
const _dmGlowRefreshTimers = new Map();

const INV_TAB_GLOW_CLASS = "ionrift-dm-inventory-tab-glow";
const INV_TAB_SCHOOL_ATTR = "data-ionrift-dm-tab-school";

/** Remove legacy body halos from older builds (tab highlight is CSS-only now). */
function stripLegacyInvTabHalos() {
    for (const el of document.querySelectorAll("[data-ionrift-dm-inv-halo]")) {
        el.remove();
    }
    for (const el of document.querySelectorAll("a[data-ionrift-dm-inv-halo-anchor]")) {
        el.removeAttribute("data-ionrift-dm-inv-halo-anchor");
        delete el.dataset.ionriftDmInvHaloAnchor;
    }
}

function stripAllDetectMagicInventoryTabGlows() {
    stripLegacyInvTabHalos();
    for (const el of document.querySelectorAll(`a.${INV_TAB_GLOW_CLASS}`)) {
        el.classList.remove(INV_TAB_GLOW_CLASS);
        el.removeAttribute(INV_TAB_SCHOOL_ATTR);
    }
}

/** @type {DetectMagicInventoryGlowAdapter|null} */
let _adapter = null;

/** @type {Map<string, Map<string, string>>} actorId -> itemId -> school slug (abj, evo, unknown, …) */
const _glowByActor = new Map();

let _hooksRegistered = false;

/** @type {DetectMagicInventoryGlowAdapter} */
const builtinAdapter = {
    onScanApplied(payload) {
        registerGlowHooksOnce();
        const beforeActors = new Set(_glowByActor.keys());
        ingestScanResults(payload?.results ?? null);
        const afterActors = new Set(_glowByActor.keys());
        const touched = new Set([
            ...beforeActors,
            ...afterActors,
            ...(Array.isArray(payload?.partyActorIds) ? payload.partyActorIds : [])
        ]);
        refreshOpenActorSheets(touched);
    },
    onScanCleared() {
        const touched = new Set([..._glowByActor.keys(), ..._dmGlowPartyActorIds]);
        _glowByActor.clear();
        stripAllDetectMagicInventoryTabGlows();
        refreshOpenActorSheets(touched);
    }
};

/**
 * @param {string} actorId
 * @returns {Map<string, string>|undefined}
 */
function getEffectiveGlowItemMap(actorId) {
    if (_dmGlowSessionActive && _dmGlowPartyActorIds.has(actorId)) {
        return DetectMagicScanner.getLiveGlowItemSchoolMap(actorId);
    }
    return _glowByActor.get(actorId);
}

/**
 * @param {string|null|undefined} school
 * @returns {string}
 */
function normalizeSchoolSlug(school) {
    if (school === null || school === "") return "unknown";
    if (typeof school !== "string") return "unknown";
    const k = school.trim().toLowerCase();
    const map = {
        abj: "abj", abjuration: "abj",
        con: "con", conjuration: "con",
        div: "div", divination: "div",
        enc: "enc", enchantment: "enc",
        evo: "evo", evocation: "evo",
        ill: "ill", illusion: "ill",
        nec: "nec", necromancy: "nec",
        trs: "trs", transmutation: "trs"
    };
    return map[k] ?? "unknown";
}

/**
 * @param {object[]|null} results
 */
function ingestScanResults(results) {
    _glowByActor.clear();
    if (!Array.isArray(results)) return;
    for (const block of results) {
        const aid = block?.actorId;
        if (!aid) continue;
        const inner = new Map();
        for (const it of block.items ?? []) {
            const iid = it.itemId;
            if (!iid) continue;
            inner.set(iid, normalizeSchoolSlug(it.school));
        }
        if (inner.size) _glowByActor.set(aid, inner);
    }
}

/**
 * @param {HTMLElement} row
 */
function stripGlowClasses(row) {
    row.classList.remove("ionrift-detect-magic-glow");
    for (const c of [...row.classList]) {
        if (c.startsWith("ionrift-dm-school-")) row.classList.remove(c);
    }
    for (const id of DM_RUN_CLASSES) row.classList.remove(`ionrift-dm-run-${id}`);
}

/**
 * Walk all inventory rows in document order; contiguous glowing rows get run-* classes
 * so CSS can draw a single merged outline (dnd5e often wraps rows so CSS + combinator fails).
 * @param {HTMLElement} root
 */
function applyDetectMagicRunMergeClasses(root) {
    const allRows = [...root.querySelectorAll("[data-item-id]")];
    for (const row of allRows) {
        for (const id of DM_RUN_CLASSES) row.classList.remove(`ionrift-dm-run-${id}`);
    }

    let runStart = -1;
    const closeRun = (endIdx) => {
        if (runStart < 0) return;
        const a = runStart;
        const b = endIdx;
        runStart = -1;
        const len = b - a + 1;
        if (len === 1) {
            allRows[a].classList.add("ionrift-dm-run-only");
        } else {
            allRows[a].classList.add("ionrift-dm-run-start");
            for (let i = a + 1; i < b; i++) allRows[i].classList.add("ionrift-dm-run-mid");
            allRows[b].classList.add("ionrift-dm-run-end");
        }
    };

    for (let i = 0; i < allRows.length; i++) {
        const glow = allRows[i].classList.contains("ionrift-detect-magic-glow");
        if (glow) {
            if (runStart < 0) runStart = i;
        } else {
            closeRun(i - 1);
        }
    }
    closeRun(allRows.length - 1);
}

/**
 * dnd5e v4: `systems/dnd5e/templates/shared/sidebar-tabs.hbs` uses
 * `<nav class="tabs"><a data-tab="inventory">…</a></nav>`.
 * @param {unknown} html
 * @param {object} app
 * @param {string} actorId
 */
function updateInventoryTabDetectMagicGlow(html, app, actorId) {
    const main = resolveSheetRoot(html, app);
    const el = app?.element;
    const appRoot = el instanceof HTMLElement ? el : el?.[0];
    const roots = [];
    if (main) roots.push(main);
    if (appRoot && appRoot !== main) roots.push(appRoot);

    const seen = new Set();
    const tabs = [];
    for (const root of roots) {
        if (!root?.querySelectorAll) continue;
        for (const tab of root.querySelectorAll(
            "nav.tabs a.item[data-tab=\"inventory\"], nav.tabs a[data-tab=\"inventory\"], a.item.control[data-tab=\"inventory\"]"
        )) {
            if (seen.has(tab)) continue;
            seen.add(tab);
            tabs.push(tab);
        }
    }

    const m = getEffectiveGlowItemMap(actorId);
    const active = !!m?.size;
    const school = active ? ([...m.values()][0] ?? "unknown") : null;

    for (const tab of tabs) {
        tab.classList.remove(INV_TAB_GLOW_CLASS);
        tab.removeAttribute(INV_TAB_SCHOOL_ATTR);
        if (active && school) {
            tab.classList.add(INV_TAB_GLOW_CLASS);
            tab.setAttribute(INV_TAB_SCHOOL_ATTR, school);
        }
    }
}

/**
 * @param {unknown} html
 * @param {object} app
 * @returns {HTMLElement|null}
 */
function resolveSheetRoot(html, app) {
    if (html instanceof HTMLElement) return html;
    if (html?.[0] instanceof HTMLElement) return html[0];
    if (typeof html?.get === "function") {
        const j0 = html.get(0);
        if (j0 instanceof HTMLElement) return j0;
    }
    const el = app?.element;
    if (el instanceof HTMLElement) return el;
    if (el?.[0] instanceof HTMLElement) return el[0];
    return null;
}

/**
 * @param {object} app
 * @param {unknown} html
 */
function applyGlowToSheetDom(app, html) {
    const actor = app?.actor ?? app?.document;
    if (!actor?.id) return;
    const root = resolveSheetRoot(html, app);
    const byItem = getEffectiveGlowItemMap(actor.id);

    if (root) {
        for (const row of root.querySelectorAll("[data-item-id]")) {
            stripGlowClasses(row);
            if (!byItem?.size) continue;
            const slug = byItem.get(row.dataset.itemId);
            if (!slug) continue;
            row.classList.add("ionrift-detect-magic-glow", `ionrift-dm-school-${slug}`);
        }
        applyDetectMagicRunMergeClasses(root);
    }
    updateInventoryTabDetectMagicGlow(html, app, actor.id);
}

/**
 * @param {(app: object, html: unknown) => void} fn
 */
function onActorSheetRenderGlow(app, html) {
    try {
        applyGlowToSheetDom(app, html);
    } catch (err) {
        console.warn(`${R} | Detect magic glow hook`, err);
    }
}

const GLOW_SHEET_HOOKS = [
    "renderActorSheet",
    "renderActorSheetV2",
    "renderActorSheet5eCharacter2",
    "renderActorSheet5eCharacter",
    "renderActorSheet5eNPC2",
    "renderActorSheet5eNPC"
];

/**
 * @param {Item} item
 */
function onItemMutatedForDetectMagicGlow(item) {
    const parent = item.parent;
    if (parent?.documentName !== "Actor") return;
    const aid = parent.id;
    if (!_dmGlowSessionActive || !_dmGlowPartyActorIds.has(aid)) return;
    const prev = _dmGlowRefreshTimers.get(aid);
    if (prev) window.clearTimeout(prev);
    const tid = window.setTimeout(() => {
        _dmGlowRefreshTimers.delete(aid);
        refreshDetectMagicGlowForActor(aid);
    }, 60);
    _dmGlowRefreshTimers.set(aid, tid);
}

/**
 * @param {string} actorId
 */
function refreshDetectMagicGlowForActor(actorId) {
    for (const win of collectActorSheetApps()) {
        const doc = win.document ?? win.actor;
        if (doc?.id !== actorId) continue;
        const raw = win.element;
        const html = raw?.jquery && typeof raw.find === "function" ? raw : raw;
        try {
            applyGlowToSheetDom(win, html);
        } catch (err) {
            console.warn(`${R} | detect magic glow refresh`, err);
        }
    }
}

function registerGlowHooksOnce() {
    if (_hooksRegistered) return;
    _hooksRegistered = true;
    stripLegacyInvTabHalos();
    for (const name of GLOW_SHEET_HOOKS) {
        Hooks.on(name, onActorSheetRenderGlow);
    }
    Hooks.on("createItem", onItemMutatedForDetectMagicGlow);
    Hooks.on("updateItem", onItemMutatedForDetectMagicGlow);
    Hooks.on("deleteItem", onItemMutatedForDetectMagicGlow);
}

/**
 * @returns {object[]}
 */
function collectActorSheetApps() {
    const out = [];
    const seen = new Set();
    const push = (w) => {
        if (!w || typeof w.render !== "function") return;
        const d = w.document ?? w.actor;
        if (!d || d.documentName !== "Actor") return;
        if (seen.has(w)) return;
        seen.add(w);
        out.push(w);
    };
    if (globalThis.ui?.windows) {
        for (const w of Object.values(ui.windows)) push(w);
    }
    if (globalThis.foundry?.applications?.instances) {
        for (const w of foundry.applications.instances.values()) push(w);
    }
    return out;
}

/**
 * @param {Set<string>} actorIds
 */
function refreshOpenActorSheets(actorIds) {
    const want = actorIds instanceof Set ? actorIds : new Set(actorIds);
    for (const win of collectActorSheetApps()) {
        const doc = win.document ?? win.actor;
        const id = doc?.id;
        if (!id) continue;
        if (want.size > 0 && !want.has(id)) continue;
        try {
            void win.render?.(false);
        } catch { /* ignore */ }
    }
}

/**
 * Install or remove a custom glow provider. Pass null to restore the built-in sheet glow.
 * @param {DetectMagicInventoryGlowAdapter|null} adapter
 */
export function setDetectMagicInventoryGlowAdapter(adapter) {
    _adapter = adapter ?? null;
}

/** @returns {DetectMagicInventoryGlowAdapter} */
export function getDetectMagicInventoryGlowAdapter() {
    return _adapter ?? builtinAdapter;
}

/**
 * Called after a successful party Detect Magic scan (local client).
 * @param {{ _magicScanResults?: object[]|null, _magicScanComplete?: boolean }} restApp
 * @param {string[]} partyActorIds
 */
export function notifyDetectMagicScanApplied(restApp, partyActorIds) {
    _dmGlowSessionActive = !!restApp?._magicScanComplete;
    _dmGlowPartyActorIds.clear();
    for (const id of partyActorIds ?? []) {
        if (id) _dmGlowPartyActorIds.add(id);
    }
    getDetectMagicInventoryGlowAdapter().onScanApplied?.({
        results: restApp?._magicScanResults ?? null,
        magicScanComplete: !!restApp?._magicScanComplete,
        partyActorIds: partyActorIds ?? []
    });
}

/** Called when the rest session clears Detect Magic state (new rest, close, or reset). */
export function notifyDetectMagicScanCleared() {
    _dmGlowSessionActive = false;
    for (const tid of _dmGlowRefreshTimers.values()) window.clearTimeout(tid);
    _dmGlowRefreshTimers.clear();
    getDetectMagicInventoryGlowAdapter().onScanCleared?.();
    _dmGlowPartyActorIds.clear();
}
