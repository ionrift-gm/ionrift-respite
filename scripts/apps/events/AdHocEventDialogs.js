import { openEventPoolApp } from "../../services/events/catalog/EventPoolMigration.js";

const CATEGORY_ICONS = {
    encounter: "fas fa-swords",
    complication: "fas fa-exclamation-triangle",
    disaster: "fas fa-skull-crossbones",
    discovery: "fas fa-gem",
    environment: "fas fa-cloud-sun-rain",
    social: "fas fa-users",
    creature: "fas fa-paw"
};

const CATEGORY_LABELS = {
    encounter: "Encounters",
    complication: "Complications",
    disaster: "Disasters",
    creature: "Creatures",
    discovery: "Discoveries",
    environment: "Weather",
    social: "Social",
    other: "Other"
};

const CATEGORY_ORDER = ["encounter", "complication", "disaster", "creature", "discovery", "environment", "social", "other"];

/**
 * @param {string} category
 * @returns {string}
 */
function categoryIcon(category) {
    return CATEGORY_ICONS[category] ?? "fas fa-scroll";
}

/**
 * @param {string} value
 * @returns {string}
 */
function escapeAttr(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

/**
 * Opens a branded picker listing curated pool events for the current terrain.
 * Each event row is itself the commit action: clicking picks and closes.
 *
 * @param {object[]} events - Catalog events already filtered to the resolver pool
 * @param {string} terrainLabel - Display name for the terrain
 * @param {string} [terrainTag] - Optional terrain key (used to pre-filter the curator if the GM opens it)
 * @returns {Promise<string|null>} Selected event id, or null if cancelled
 */
export async function pickPoolEvent(events, terrainLabel, terrainTag = null) {
    if (!events?.length) return null;

    /* ---- bucket events by category (disasters get their own bucket, driven by tier) ---- */
    const groups = {};
    for (const evt of events) {
        let cat;
        if (evt.tier === "disaster") {
            cat = "disaster";
        } else {
            cat = CATEGORY_LABELS[evt.category] ? evt.category : "other";
        }
        (groups[cat] ??= []).push(evt);
    }

    /* ordered list of categories that actually have events */
    const activeCats = CATEGORY_ORDER.filter(c => groups[c]?.length);
    if (!activeCats.length) return null;

    /* ---- sidebar buttons ---- */
    const sidebarHtml = activeCats.map((cat, i) => `
        <button type="button" class="adhoc-pick-cat-btn${i === 0 ? " is-active" : ""}"
                data-category="${cat}">
            <i class="${categoryIcon(cat)}"></i>
            <span class="adhoc-pick-cat-label">${CATEGORY_LABELS[cat]}</span>
            <span class="adhoc-pick-cat-count">(<span class="adhoc-pick-cat-count-num">${groups[cat].length}</span>)</span>
        </button>`).join("");

    /* ---- event cards per category (no icon next to title; the sidebar tab already shows the category) ---- */
    const renderRow = (evt) => {
        const fullDesc = String(evt.description ?? "").trim();
        const truncated = fullDesc.length > 140 ? `${fullDesc.slice(0, 140)}…` : fullDesc;
        const dataCat = evt.tier === "disaster"
            ? "disaster"
            : (CATEGORY_LABELS[evt.category] ? evt.category : "other");
        const searchText = `${evt.name ?? ""} ${fullDesc}`.toLowerCase();
        return `
            <button type="button" class="adhoc-pick-row" data-event-id="${escapeAttr(evt.id)}"
                    data-category="${dataCat}" data-search="${escapeAttr(searchText)}">
                <span class="adhoc-pick-name">${escapeAttr(evt.name ?? evt.id)}</span>
                ${truncated ? `<span class="adhoc-pick-desc">${escapeAttr(truncated)}</span>` : ""}
            </button>`;
    };

    let eventsHtml = "";
    for (const cat of activeCats) {
        eventsHtml += groups[cat].map(renderRow).join("");
    }

    const showSearch = events.length > 6;
    const content = `
        <div class="adhoc-pick-dialog">
            <div class="adhoc-pick-header">
                <p class="adhoc-pick-lead">Choose a camp event for <strong>${escapeAttr(terrainLabel)}</strong>.</p>
                <button type="button" class="adhoc-pick-edit-btn" data-action="editPool" title="Edit the camp event pool">
                    <i class="fas fa-pen-to-square"></i> Edit pool
                </button>
            </div>
            ${showSearch ? `<input type="search" class="adhoc-pick-search" placeholder="Filter events..." autocomplete="off">` : ""}
            <div class="adhoc-pick-split" data-active-cat="${activeCats[0]}">
                <div class="adhoc-pick-sidebar ionrift-list">${sidebarHtml}</div>
                <div class="adhoc-pick-events ionrift-list">${eventsHtml}</div>
            </div>
            <p class="adhoc-pick-empty" hidden>No events match.</p>
        </div>`;

    return new Promise((resolve) => {
        let settled = false;
        let selectedEventId = null;
        const finish = (id) => {
            if (settled) return;
            settled = true;
            resolve(id ?? null);
        };

        // lint-ignore: DialogV2. Branded picker for GM night-event selection.
        const dialog = new foundry.applications.api.DialogV2({
            window: { title: "Pick event from pool", icon: "fas fa-book-open" },
            classes: ["ionrift-window", "dialog", "respite-adhoc-pick"],
            position: { width: 620, height: 640 },
            modal: true,
            content,
            buttons: [
                /* DialogV2's button callback fires AFTER the dialog's auto-close lifecycle in
                   some V13 builds, which made the close handler resolve the promise with null
                   before our intended payload landed. We keep the buttons here only for
                   layout/styling and attach real click handlers in capture phase below. */
                {
                    action: "cancel",
                    label: "Cancel",
                    icon: "fas fa-times",
                    default: true,
                    callback: () => {}
                },
                {
                    action: "confirm",
                    label: "Confirm",
                    icon: "fas fa-check",
                    callback: () => {}
                }
            ],
            rejectClose: false,
            close: () => { finish(null); }
        });

        dialog.render({ force: true }).then(() => {
            const root = dialog.element;
            if (!root) { finish(null); return; }

            const splitEl = root.querySelector(".adhoc-pick-split");
            const rows = [...root.querySelectorAll(".adhoc-pick-row")];
            const catBtns = [...root.querySelectorAll(".adhoc-pick-cat-btn")];
            const empty = root.querySelector(".adhoc-pick-empty");
            const search = root.querySelector(".adhoc-pick-search");
            const editBtn = root.querySelector(".adhoc-pick-edit-btn");
            const confirmBtn = root.querySelector('[data-action="confirm"]');
            const cancelBtn = root.querySelector('[data-action="cancel"]');

            /* ---- helpers ---- */

            /** Confirm button reflects whether anything is selected. */
            const updateConfirm = () => {
                if (!confirmBtn) return;
                confirmBtn.disabled = !selectedEventId;
                confirmBtn.classList.toggle("is-armed", !!selectedEventId);
            };
            updateConfirm();

            /** Show only events matching the sidebar-selected category */
            const applyCategoryFilter = () => {
                const activeCat = splitEl.dataset.activeCat;
                for (const row of rows) row.hidden = row.dataset.category !== activeCat;
                if (empty) empty.hidden = true;
            };

            /* initial filter: show only the first category's events */
            applyCategoryFilter();

            /* ---- footer buttons: capture-phase handlers so we resolve the promise
               BEFORE DialogV2's default action dispatch closes the dialog. Without
               this, the close lifecycle's finish(null) races our payload and the
               parent flow soft-locks because it sees a cancel. ---- */
            if (cancelBtn) {
                cancelBtn.addEventListener("click", (ev) => {
                    ev.preventDefault();
                    ev.stopPropagation();
                    ev.stopImmediatePropagation();
                    finish(null);
                    dialog.close();
                }, { capture: true });
            }

            if (confirmBtn) {
                confirmBtn.addEventListener("click", (ev) => {
                    if (!selectedEventId) {
                        ev.preventDefault();
                        ev.stopPropagation();
                        ev.stopImmediatePropagation();
                        return;
                    }
                    ev.preventDefault();
                    ev.stopPropagation();
                    ev.stopImmediatePropagation();
                    finish(selectedEventId);
                    dialog.close();
                }, { capture: true });
            }

            /* ---- row selection (two-step: select then Confirm) ---- */
            for (const row of rows) {
                row.addEventListener("click", () => {
                    selectedEventId = row.dataset.eventId;
                    for (const r of rows) r.classList.toggle("is-selected", r === row);
                    updateConfirm();
                });
                /* double-click commits directly for power users */
                row.addEventListener("dblclick", () => {
                    selectedEventId = row.dataset.eventId;
                    finish(selectedEventId);
                    dialog.close();
                });
            }

            /* ---- Edit pool button: close picker, open curator pre-filtered ---- */
            if (editBtn) {
                editBtn.addEventListener("click", () => {
                    finish(null);
                    openEventPoolApp(terrainTag);
                    dialog.close();
                });
            }

            /* ---- sidebar category switching ---- */
            for (const btn of catBtns) {
                btn.addEventListener("click", () => {
                    /* clear search when switching categories manually */
                    if (search) search.value = "";

                    for (const b of catBtns) b.classList.toggle("is-active", b === btn);
                    splitEl.dataset.activeCat = btn.dataset.category;
                    applyCategoryFilter();
                });
            }

            /* ---- search: overrides sidebar, shows cross-category results ---- */
            if (search) {
                search.addEventListener("input", (e) => {
                    const term = e.target.value.trim().toLowerCase();

                    if (!term) {
                        /* restore sidebar-based filtering and reset counts */
                        for (const btn of catBtns) {
                            const cat = btn.dataset.category;
                            btn.querySelector(".adhoc-pick-cat-count-num").textContent = groups[cat].length;
                        }
                        applyCategoryFilter();
                        return;
                    }

                    /* search active: show matching rows across all categories */
                    let anyVisible = false;
                    const matchCounts = {};
                    for (const row of rows) {
                        const match = (row.dataset.search ?? "").includes(term);
                        row.hidden = !match;
                        if (match) {
                            anyVisible = true;
                            const cat = row.dataset.category;
                            matchCounts[cat] = (matchCounts[cat] ?? 0) + 1;
                        }
                    }

                    /* update sidebar counts to reflect filtered matches */
                    for (const btn of catBtns) {
                        const cat = btn.dataset.category;
                        btn.querySelector(".adhoc-pick-cat-count-num").textContent = matchCounts[cat] ?? 0;
                    }

                    if (empty) empty.hidden = anyVisible;
                });
                queueMicrotask(() => search.focus());
            }
        }).catch(() => finish(null));
    });
}
