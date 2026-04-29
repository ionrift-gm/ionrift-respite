/**
 * @module UiInjections
 * @description DOM injection functions extracted from module.js (Phase 2.3).
 * Handles: diet button on actor sheets, spoilage badges on inventory items,
 * and the Zzz PIXI overlay on sleeping tokens.
 */

import { CalendarHandler } from "./CalendarHandler.js";
import { ItemClassifier } from "./ItemClassifier.js";
import { MealPhaseHandler } from "./MealPhaseHandler.js";
import { DietConfigApp } from "../apps/DietConfigApp.js";

const MODULE_ID = "ionrift-respite";
const ZZZ_CHILD_NAME = "ionrift-respite-zzz";

/**
 * Injects a small "Diet" icon button into character sheet headers so GMs can
 * open DietConfigApp scoped to that actor without hunting through module settings.
 * @param {Application} app - The actor sheet application.
 * @param {HTMLElement|jQuery} html - The rendered HTML.
 */
export function injectDietButton(app, html) {
    if (!game.user.isGM) return;
    const actor = app.actor ?? app.document;
    if (!actor || actor.type !== "character") return;

    const el = html instanceof HTMLElement ? html
        : html?.[0] instanceof HTMLElement ? html[0]
        : html?.get?.(0)
        ?? app.element;
    if (!el) return;

    if (el.querySelector(".respite-diet-btn")) return;

    const header = el.querySelector("header.window-header")
        ?? el.closest?.(".app")?.querySelector("header.window-header")
        ?? el.querySelector(".window-header");
    if (!header) return;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "header-control-button respite-diet-btn";
    btn.dataset.tooltip = "Diet Configuration";
    btn.setAttribute("aria-label", "Diet Configuration");
    btn.innerHTML = `<i class="fas fa-utensils"></i>`;
    btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        new DietConfigApp({ actorId: actor.id }).render({ force: true });
    });

    const closeBtn = header.querySelector("button.close, button[data-action='close']");
    if (closeBtn) {
        closeBtn.before(btn);
    } else {
        header.appendChild(btn);
    }
}

/**
 * Scans visible inventory item rows on character sheets and injects a small
 * badge showing days remaining before spoilage.
 * @param {Application} app - The actor sheet application.
 * @param {HTMLElement|jQuery} html - The rendered HTML.
 */
export function injectSpoilageBadges(app, html) {
    const actor = app.actor ?? app.document;
    if (!actor || actor.type !== "character") return;

    try {
        const roster = game.settings.get(MODULE_ID, "partyRoster") ?? [];
        if (roster.length && !roster.includes(actor.id)) return;
    } catch { /* setting not yet registered */ }

    const el = html instanceof HTMLElement ? html
        : html?.[0] instanceof HTMLElement ? html[0]
        : html?.get?.(0)
        ?? app.element;
    if (!el) return;

    const now = CalendarHandler.getCurrentDate();
    const nowEpoch = game.time.worldTime;

    const itemRows = el.querySelectorAll("[data-item-id]");
    for (const row of itemRows) {
        const itemId = row.dataset.itemId;
        if (!itemId) continue;

        const item = actor.items.get(itemId);
        if (!item) continue;

        const flags = item.flags?.[MODULE_ID] ?? {};
        if (flags.spoiled) continue;

        const spoilsAfter = ItemClassifier.getSpoilsAfter(item);
        if (spoilsAfter == null || spoilsAfter <= 0) continue;

        if (row.querySelector(".respite-spoil-badge")) continue;

        let daysLeft = spoilsAfter;
        const harvested = flags.harvestedDate;
        if (harvested) {
            if (now && harvested.includes("-")) {
                const daysPassed = MealPhaseHandler._dateDiffDays(harvested, now);
                daysLeft = Math.max(0, spoilsAfter - daysPassed);
            } else {
                const harvestedEpoch = parseInt(harvested, 10);
                if (!isNaN(harvestedEpoch)) {
                    const daysPassed = Math.floor((nowEpoch - harvestedEpoch) / 86400);
                    daysLeft = Math.max(0, spoilsAfter - daysPassed);
                }
            }
        }

        const badge = document.createElement("span");
        badge.className = "respite-spoil-badge";
        if (daysLeft <= 0) {
            badge.classList.add("spoil-expired");
            badge.textContent = "SPOILED";
            badge.dataset.tooltip = "This food has gone off.";
        } else if (daysLeft === 1) {
            badge.classList.add("spoil-urgent");
            badge.textContent = "1d";
            badge.dataset.tooltip = "Spoils within a day. Eat or cook it.";
        } else {
            badge.classList.add("spoil-fresh");
            badge.textContent = `${daysLeft}d`;
            badge.dataset.tooltip = `${daysLeft} days until spoilage.`;
        }

        const nameEl = row.querySelector(".item-name, .entry-name, h4, .name");
        if (nameEl) {
            nameEl.appendChild(badge);
        } else {
            row.appendChild(badge);
        }
    }
}

/**
 * Add or remove the Zzz PIXI text overlay on a token based on its beddingDown flag.
 * Called from the refreshToken hook.
 * @param {Token} token
 */
export function refreshZzzOverlay(token) {
    const isSleeping = !!(token.document?.getFlag?.(MODULE_ID, "beddingDown"));
    let child = token.getChildByName?.(ZZZ_CHILD_NAME) ?? null;

    if (isSleeping) {
        if (!child) {
            child = new PIXI.Text("Zzz", {
                fontFamily: "Signika, Arial, sans-serif",
                fontSize: Math.max(12, (token.w ?? 50) * 0.28),
                fontStyle: "italic",
                fill: 0xadd8ff,
                dropShadow: true,
                dropShadowColor: 0x000033,
                dropShadowDistance: 2,
                dropShadowBlur: 4,
                dropShadowAlpha: 0.8
            });
            child.name = ZZZ_CHILD_NAME;
            child.alpha = 0.9;
            token.addChild(child);
        }
        const tw = token.w ?? 50;
        const th = token.h ?? 50;
        child.position.set(tw * 0.55, th * 0.04);
    } else if (child) {
        token.removeChild(child);
        child.destroy();
    }
}

/**
 * Registers all UI injection hooks on actor sheet render events.
 * Call once from the module init or ready block.
 */
export function registerUiHooks() {
    const sheetHooks = [
        "renderActorSheet",
        "renderActorSheetV2",
        "renderActorSheet5eCharacter2",
        "renderActorSheet5eCharacter"
    ];

    for (const hookName of sheetHooks) {
        Hooks.on(hookName, (app, html, context) => {
            injectDietButton(app, html);
            injectSpoilageBadges(app, html);
        });
    }
}
