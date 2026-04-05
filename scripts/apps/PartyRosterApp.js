const MODULE_ID = "ionrift-respite";

/**
 * PartyRosterApp
 * GM-only settings panel for curating which characters participate in Respite rests.
 * Persists to the `partyRoster` world setting. Uses Ionrift Glass theme.
 */
export class PartyRosterApp extends foundry.applications.api.ApplicationV2 {

    static DEFAULT_OPTIONS = {
        id: "respite-party-roster",
        window: {
            title: "Party Roster",
            icon: "fas fa-users",
            resizable: true
        },
        position: { width: 440, height: "auto" },
        classes: ["ionrift-window"]
    };

    /** @override */
    async _prepareContext() {
        const roster = game.settings.get(MODULE_ID, "partyRoster") ?? [];
        const rosterSet = new Set(roster);

        // All player-owned characters in the world
        const allCandidates = game.actors.filter(a => a.hasPlayerOwner && a.type === "character");

        // If roster is empty (first use), treat all as selected
        const isFirstUse = roster.length === 0;

        const actors = allCandidates.map(actor => {
            // Class summary: "Wizard 5" or "Fighter 3 / Rogue 2"
            const classes = actor.itemTypes?.class ?? [];
            const classLabel = classes.length > 0
                ? classes.map(c => `${c.name} ${c.system?.levels ?? ""}`).join(" / ")
                : "No class";

            // Owner names
            const owners = Object.entries(actor.ownership ?? {})
                .filter(([id, level]) => level >= 3 && id !== "default")
                .map(([id]) => game.users.get(id)?.name)
                .filter(Boolean);

            return {
                id: actor.id,
                name: actor.name,
                img: actor.img ?? "icons/svg/mystery-man.svg",
                classLabel,
                ownerLabel: owners.length > 0 ? owners.join(", ") : "No owner",
                checked: isFirstUse || rosterSet.has(actor.id),
                isNew: !isFirstUse && !rosterSet.has(actor.id)
            };
        });

        // Sort: checked first, then alphabetical
        actors.sort((a, b) => {
            if (a.checked !== b.checked) return a.checked ? -1 : 1;
            return a.name.localeCompare(b.name);
        });

        const selectedCount = actors.filter(a => a.checked).length;
        return { actors, selectedCount, totalCount: actors.length, isFirstUse };
    }

    /** @override */
    async _renderHTML(context) {
        const el = document.createElement("div");
        el.classList.add("respite-party-roster");

        // Summary bar
        let html = `
        <div class="roster-summary-bar">
            <span class="roster-summary-count">
                <strong>${context.selectedCount}</strong> of ${context.totalCount} characters in roster
            </span>
            <div class="roster-select-actions">
                <button type="button" class="roster-select-all">Select All</button>
                <button type="button" class="roster-select-none">Select None</button>
            </div>
        </div>`;

        if (context.isFirstUse) {
            html += `
            <div class="roster-first-use-hint">
                <i class="fas fa-info-circle"></i>
                First time setup. All player-owned characters are selected. Uncheck any summons, familiars, or companions that should not participate in rests.
            </div>`;
        }

        // Actor list
        html += `<div class="roster-actor-list">`;
        for (const actor of context.actors) {
            const newBadge = actor.isNew
                ? `<span class="roster-new-badge" title="New character, not yet in roster">NEW</span>`
                : "";
            html += `
            <label class="roster-actor-row ${actor.checked ? "checked" : ""}" data-actor-id="${actor.id}">
                <input type="checkbox" class="roster-actor-checkbox"
                       data-actor-id="${actor.id}"
                       ${actor.checked ? "checked" : ""} />
                <img class="roster-actor-portrait" src="${actor.img}" alt="${actor.name}" />
                <div class="roster-actor-info">
                    <span class="roster-actor-name">${actor.name} ${newBadge}</span>
                    <span class="roster-actor-detail">${actor.classLabel} &middot; ${actor.ownerLabel}</span>
                </div>
            </label>`;
        }
        html += `</div>`;

        // Save button
        html += `
        <div class="roster-actions">
            <button type="button" class="roster-save-btn">
                <i class="fas fa-save"></i> Save Roster
            </button>
        </div>`;

        el.innerHTML = html;

        // Wire checkbox visual feedback
        el.querySelectorAll(".roster-actor-checkbox").forEach(cb => {
            cb.addEventListener("change", () => {
                const row = cb.closest(".roster-actor-row");
                row.classList.toggle("checked", cb.checked);
                this._updateSummary(el);
            });
        });

        // Select all / none
        el.querySelector(".roster-select-all")?.addEventListener("click", () => {
            el.querySelectorAll(".roster-actor-checkbox").forEach(cb => {
                cb.checked = true;
                cb.closest(".roster-actor-row")?.classList.add("checked");
            });
            this._updateSummary(el);
        });
        el.querySelector(".roster-select-none")?.addEventListener("click", () => {
            el.querySelectorAll(".roster-actor-checkbox").forEach(cb => {
                cb.checked = false;
                cb.closest(".roster-actor-row")?.classList.remove("checked");
            });
            this._updateSummary(el);
        });

        // Save
        el.querySelector(".roster-save-btn")?.addEventListener("click", async () => {
            const selected = [];
            el.querySelectorAll(".roster-actor-checkbox").forEach(cb => {
                if (cb.checked) selected.push(cb.dataset.actorId);
            });

            if (selected.length === 0) {
                ui.notifications.warn("Select at least one character for the party roster.");
                return;
            }

            await game.settings.set(MODULE_ID, "partyRoster", selected);
            ui.notifications.info(`Party roster updated (${selected.length} characters).`);

            // Re-render any open RestSetupApp so the roster indicator updates
            for (const app of foundry.applications.instances.values()) {
                if (app.constructor.name === "RestSetupApp") { app.render(); break; }
            }

            this.close();
        });

        return el;
    }

    /** @override */
    _replaceHTML(result, content, options) {
        content.replaceChildren(result);
    }

    /**
     * Live-update the summary bar when checkboxes change.
     */
    _updateSummary(el) {
        const checkboxes = el.querySelectorAll(".roster-actor-checkbox");
        const checked = [...checkboxes].filter(cb => cb.checked).length;
        const total = checkboxes.length;
        const countEl = el.querySelector(".roster-summary-count");
        if (countEl) {
            countEl.innerHTML = `<strong>${checked}</strong> of ${total} characters in roster`;
        }
    }
}
