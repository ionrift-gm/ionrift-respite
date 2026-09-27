import { SpoilageClock } from "../../meal/spoilage/SpoilageClock.js";
import { DietConfigApp } from "../../../apps/meal/DietConfigApp.js";
import { ItemProvisionsApp } from "../../../apps/meal/ItemProvisionsApp.js";
import { injectPlayerLockdownClasses } from "./PlayerLockdownService.js";
import {
    mountDietButtonInHeader,
    mountHeaderButtonInHeader,
    resolveDietButtonClassName
} from "./SheetInjectionUtils.js";
import { ItemClassifier } from "../../party/ItemClassifier.js";
import { syncCohortSuffixesOnSheetRender } from "../../meal/spoilage/SpoilageCohortSync.js";
import { MODULE_ID } from "../../../data/moduleId.js";

const ZZZ_CHILD_NAME = "ionrift-respite-zzz";
const PRONE_CHILD_NAME = "ionrift-respite-prone";

let zzzSource = null;
let proneTexture = null;
let proneTexturePromise = null;

function statusImage(statusId) {
    const raw = globalThis.CONFIG?.statusEffects ?? [];
    const all = Array.isArray(raw) ? raw : Object.values(raw);
    const status = all.find(entry => entry?.id === statusId);
    return status?.img || status?.icon || "";
}

function sharedZzzSource() {
    if (zzzSource && !zzzSource.destroyed) return zzzSource;
    const textOpts = {
        fontFamily: "Signika, Arial, sans-serif",
        fontSize: 48,
        fontStyle: "italic",
        fill: 0xadd8ff,
        dropShadow: true,
        dropShadowColor: 0x000033,
        dropShadowDistance: 2,
        dropShadowBlur: 4,
        dropShadowAlpha: 0.8
    };
    const PreciseText = globalThis.foundry?.canvas?.containers?.PreciseText;
    if (PreciseText) {
        zzzSource = new PreciseText("Zzz", PreciseText.getTextStyle(textOpts));
        zzzSource.updateText?.(false);
    } else if (globalThis.PIXI?.Text) {
        zzzSource = new PIXI.Text("Zzz", textOpts);
    } else {
        return null;
    }
    return zzzSource;
}

let proneTextureSrc = "";

function ensurePostureTexture(statusId, onReady) {
    const img = statusImage(statusId);
    if (!img) return;
    if (proneTexture && !proneTexture.destroyed && proneTextureSrc === img) {
        onReady(proneTexture);
        return;
    }
    if (!proneTexturePromise || proneTextureSrc !== img) {
        const loader = globalThis.foundry?.canvas?.loadTexture;
        const pending = loader
            ? loader(img)
            : (globalThis.PIXI?.Texture?.from ? Promise.resolve(PIXI.Texture.from(img)) : null);
        if (!pending?.then) return;
        proneTextureSrc = img;
        proneTexture = null;
        proneTexturePromise = pending.then(texture => {
            proneTexture = texture;
            return texture;
        }).catch(() => {
            proneTexturePromise = null;
            proneTextureSrc = "";
            return null;
        });
    }
    proneTexturePromise.then(texture => {
        if (texture) onReady(texture);
    }).catch(() => {});
}

function destroyMark(token, child) {
    if (!child) return;
    token.removeChild(child);
    child.destroy({ texture: false, baseTexture: false });
}

function placeMark(token, child, x, y, targetHeight) {
    const base = child.texture?.height || child.height || 48;
    const scale = targetHeight / base;
    child.scale?.set?.(scale);
    child.position.set(x, y);
    child.alpha = 0.9;
    if ("eventMode" in child) child.eventMode = "none";
}

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

    const header = el.querySelector("header.window-header")
        ?? el.closest?.(".app")?.querySelector("header.window-header")
        ?? el.querySelector(".window-header");
    if (!header) return;

    let btn = header.querySelector(".respite-diet-btn");
    if (!btn) {
        btn = document.createElement("button");
        btn.type = "button";
        btn.dataset.tooltip = "Diet Configuration";
        btn.setAttribute("aria-label", "Diet Configuration");
        btn.innerHTML = `<i class="fas fa-utensils"></i>`;
        btn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            new DietConfigApp({ actorId: actor.id }).render({ force: true });
        });
    }

    btn.className = resolveDietButtonClassName(app);
    mountDietButtonInHeader(header, btn);
}

/**
 * Injects a small "Provisions" (carrot) or "Cold Storage" (snowflake) icon button
 * into Item sheet headers so GMs can configure or toggle properties with one click.
 * @param {Application} app - The item sheet application.
 * @param {HTMLElement|jQuery} html - The rendered HTML.
 */
export function injectItemProvisionsButton(app, html) {
    if (!game?.user?.isGM) return;
    const item = app.item ?? app.document;
    if (!item || item.documentName !== "Item") return;

    const isContainer = ItemClassifier.isContainer(item);
    const isProvision = ItemClassifier.isProvisionEligible(item);
    if (!isProvision && !isContainer) return;

    const el = html instanceof HTMLElement ? html
        : html?.[0] instanceof HTMLElement ? html[0]
        : html?.get?.(0)
        ?? app.element;
    if (!el) return;

    const header = el.querySelector("header.window-header")
        ?? el.closest?.(".app")?.querySelector("header.window-header")
        ?? el.querySelector(".window-header");
    if (!header) return;

    if (isContainer) {
        const isCold = ItemClassifier.isColdStorageContainer(item);
        const mult = ItemClassifier.getPreservationMultiplier(item);
        let btn = header.querySelector(".respite-container-btn");
        if (!btn) {
            btn = document.createElement("button");
            btn.type = "button";
            btn.setAttribute("aria-label", "Respite: Cold Storage");
            btn.innerHTML = `<i class="fas fa-snowflake"></i>`;
            btn.addEventListener("click", async (e) => {
                e.preventDefault();
                e.stopPropagation();
                const currentlyCold = ItemClassifier.isColdStorageContainer(item);
                const nextState = !currentlyCold;
                await item.setFlag(MODULE_ID, "coldStorage", nextState);
                if (nextState && item.flags?.[MODULE_ID]?.preservationMultiplier === undefined) {
                    await item.setFlag(MODULE_ID, "preservationMultiplier", 2);
                }
                const multVal = ItemClassifier.getPreservationMultiplier(item);
                const label = multVal === 0 ? "Stasis (no spoilage)" : `${multVal}× shelf life`;
                ui.notifications?.info(`${item.name}: Cold Storage ${nextState ? `Enabled (${label})` : "Disabled"}`);
                refreshSpoilageBadgesOnOpenSheets();
                app.render(false);
            });
            btn.addEventListener("contextmenu", (e) => {
                e.preventDefault();
                e.stopPropagation();
                ItemProvisionsApp.openForItem(item);
            });
        }

        const multLabel = mult === 0 ? "Stasis (no spoilage)" : `${mult}× shelf life`;
        btn.dataset.tooltip = isCold
            ? `Respite: Cold Storage Active (${multLabel}). Click to toggle, Right-click to configure.`
            : "Respite: Normal Container. Click to enable Cold Storage, Right-click to configure.";

        const baseClass = resolveDietButtonClassName(app).replace("respite-diet-btn", "respite-container-btn");
        btn.className = `${baseClass}${isCold ? " cold-active" : ""}`;
        mountHeaderButtonInHeader(header, btn, "respite-container-btn");
        return;
    }

    let btn = header.querySelector(".respite-item-btn");
    if (!btn) {
        btn = document.createElement("button");
        btn.type = "button";
        btn.dataset.tooltip = "Respite: Provisions & Spoilage";
        btn.setAttribute("aria-label", "Respite: Provisions & Spoilage");
        btn.innerHTML = `<i class="fas fa-carrot"></i>`;
        btn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            ItemProvisionsApp.openForItem(item);
        });
    }

    btn.className = resolveDietButtonClassName(app).replace("respite-diet-btn", "respite-item-btn");
    mountHeaderButtonInHeader(header, btn, "respite-item-btn");
}

/**
 * Injects a styled Ionrift enrichment note into a container sheet's description pane
 * when Cold Storage is active.
 * @param {Application} app
 * @param {HTMLElement|jQuery} html
 */
export function injectContainerEnrichment(app, html) {
    const item = app.item ?? app.document;
    if (!item || item.documentName !== "Item") return;
    if (!ItemClassifier.isContainer(item)) return;

    const el = html instanceof HTMLElement ? html
        : html?.[0] instanceof HTMLElement ? html[0]
        : html?.get?.(0)
        ?? app.element;
    if (!el?.querySelector) return;

    const existing = el.querySelector(".ionrift-enrichment--cold-storage");
    const isCold = ItemClassifier.isColdStorageContainer(item);

    if (!isCold) {
        if (existing) existing.remove();
        return;
    }

    const mult = ItemClassifier.getPreservationMultiplier(item);
    const content = mult === 0
        ? `<i class="fas fa-snowflake" style="color: #c4b5fd; margin-right: 4px;"></i><strong>Respite:</strong> <strong>Stasis Container.</strong> Perishable food and harvested monster ingredients stored inside this container are preserved indefinitely.`
        : `<i class="fas fa-snowflake" style="color: #c4b5fd; margin-right: 4px;"></i><strong>Respite:</strong> <strong>Cold Storage Container.</strong> Perishable food and harvested monster ingredients stored inside this container have their shelf life extended (<strong>${mult}× shelf life</strong>).`;

    if (existing) {
        existing.innerHTML = content;
        return;
    }

    const selectors = [
        ".card.description .collapsible-content",
        ".card.description .details",
        "section.description.tab",
        "section.tab[data-tab='description']",
        ".tab.description",
        ".tab[data-tab='description']",
        "[data-tab='description']",
        ".editor-content",
        ".editor",
        "form"
    ];

    let target = null;
    for (const sel of selectors) {
        const found = el.querySelector(sel);
        if (found) {
            target = found;
            break;
        }
    }

    if (!target) return;

    const div = document.createElement("div");
    div.className = "ionrift-enrichment ionrift-enrichment--cold-storage";
    div.innerHTML = content;
    target.insertBefore(div, target.firstChild);
}

/**
 * Updates or injects spoilage badges on inventory rows for one sheet root element.
 * Handles both perishable provisions and cold storage containers.
 * @param {Actor} actor
 * @param {HTMLElement} el
 */
export function refreshSpoilageBadgesForElement(actor, el) {
    if (!actor || !el) return;

    const itemRows = el.querySelectorAll("[data-item-id]");
    for (const row of itemRows) {
        const itemId = row.dataset.itemId;
        if (!itemId) continue;

        const item = actor.items.get(itemId);
        if (!item) continue;

        // Container row: check cold storage badge
        if (ItemClassifier.isContainer(item)) {
            const existingColdBadge = row.querySelector(".respite-spoil-badge.spoil-cold");
            const isCold = ItemClassifier.isColdStorageContainer(item);
            if (isCold) {
                const mult = ItemClassifier.getPreservationMultiplier(item);
                const badgeLabel = mult === 0 ? "STASIS" : `COLD (${mult}×)`;
                const badge = existingColdBadge ?? document.createElement("span");
                badge.className = "respite-spoil-badge spoil-cold";
                badge.innerHTML = `<i class="fas fa-snowflake"></i> ${badgeLabel}`;
                badge.dataset.tooltip = mult === 0
                    ? "Cold Storage: Indefinite preservation (items inside do not spoil)"
                    : `Cold Storage: Food and ingredients inside spoil ${mult}× slower`;

                if (!existingColdBadge) {
                    const nameEl = row.querySelector(".item-name, .entry-name, h4, .name");
                    if (nameEl) nameEl.appendChild(badge);
                    else row.appendChild(badge);
                }
            } else {
                existingColdBadge?.remove();
            }
            continue;
        }

        const flags = item.flags?.[MODULE_ID] ?? {};
        const existingBadge = row.querySelector(".respite-spoil-badge:not(.spoil-cold)");

        if (flags.spoiled) {
            existingBadge?.remove();
            continue;
        }

        const badgeState = SpoilageClock.getSpoilageBadgeState(item);
        if (!badgeState) {
            existingBadge?.remove();
            continue;
        }

        const container = ItemClassifier.getParentContainer(item);
        const inCold = container && ItemClassifier.isColdStorageContainer(container);

        const badge = existingBadge ?? document.createElement("span");
        badge.className = `respite-spoil-badge ${badgeState.stateClass}${inCold ? " in-cold-storage" : ""}`;
        badge.textContent = inCold && badgeState.stateClass !== "spoil-expired"
            ? `${badgeState.text} ❄️`
            : badgeState.text;
        badge.dataset.tooltip = inCold
            ? `${badgeState.tooltip} (Preserved in ${container.name})`
            : badgeState.tooltip;

        if (!existingBadge) {
            const nameEl = row.querySelector(".item-name, .entry-name, h4, .name");
            if (nameEl) {
                nameEl.appendChild(badge);
            } else {
                row.appendChild(badge);
            }
        }
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
        const libParty = game.ionrift?.library?.party;
        if (libParty) {
            const rosterIds = libParty.getRosterIds();
            if (rosterIds.length && !libParty.isRostered(actor.id)) return;
        } else {
            const roster = game.settings.get(MODULE_ID, "partyRoster") ?? [];
            if (roster.length && !roster.includes(actor.id)) return;
        }
    } catch { /* setting not yet registered */ }

    const el = html instanceof HTMLElement ? html
        : html?.[0] instanceof HTMLElement ? html[0]
        : html?.get?.(0)
        ?? app.element;
    if (!el) return;

    refreshSpoilageBadgesForElement(actor, el);
}

/**
 * Refreshes spoilage badges on every open character sheet (all clients).
 */
export function refreshSpoilageBadgesOnOpenSheets() {
    for (const app of Object.values(ui.windows)) {
        const actor = app?.actor ?? app?.document;
        if (!actor || actor.type !== "character" || !app.rendered) continue;

        const el = app.element;
        if (!el) continue;

        refreshSpoilageBadgesForElement(actor, el);
    }
}

/**
 * Zzz and a small prone mark while beddingDown is set.
 * One shared text texture and one shared prone texture; each token only
 * gets a sprite. Driven by refreshToken, updateToken, createToken, and
 * canvasReady (see module.js).
 * @param {Token} token
 */
export function refreshZzzOverlay(token) {
    const isSleeping = !!(token.document?.getFlag?.(MODULE_ID, "beddingDown"));
    const zzz = token.getChildByName?.(ZZZ_CHILD_NAME) ?? null;
    const prone = token.getChildByName?.(PRONE_CHILD_NAME) ?? null;

    if (!isSleeping) {
        destroyMark(token, zzz);
        destroyMark(token, prone);
        return;
    }

    const tw = token.w ?? 50;
    const th = token.h ?? 50;
    const Sprite = globalThis.PIXI?.Sprite;

    if (!zzz && Sprite) {
        const source = sharedZzzSource();
        if (source?.texture) {
            const mark = new Sprite(source.texture);
            mark.name = ZZZ_CHILD_NAME;
            token.addChild(mark);
            placeMark(token, mark, tw * 0.55, th * 0.04, Math.max(12, tw * 0.28));
        }
    } else if (zzz) {
        placeMark(token, zzz, tw * 0.55, th * 0.04, Math.max(12, tw * 0.28));
    }

    const postureId = token.document?.getFlag?.(MODULE_ID, "beddingPosture") || "";
    if (!prone && Sprite && postureId) {
        ensurePostureTexture(postureId, texture => {
            if (token.destroyed) return;
            if (!token.document?.getFlag?.(MODULE_ID, "beddingDown")) return;
            if (token.getChildByName?.(PRONE_CHILD_NAME)) return;
            const mark = new Sprite(texture);
            mark.name = PRONE_CHILD_NAME;
            token.addChild(mark);
            const size = Math.max(10, tw * 0.22);
            placeMark(token, mark, tw * 0.06, th - size - (th * 0.06), size);
        });
    } else if (prone) {
        const size = Math.max(10, tw * 0.22);
        placeMark(token, prone, tw * 0.06, th - size - (th * 0.06), size);
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
            injectPlayerLockdownClasses(app, html);
        });
    }

    for (const hookName of sheetHooks) {
        Hooks.on(hookName, (app) => {
            const actor = app?.actor ?? app?.document;
            if (actor?.type === "character") {
                syncCohortSuffixesOnSheetRender(actor).catch(() => {});
            }
        });
    }

    const itemSheetHooks = [
        "renderItemSheet",
        "renderItemSheetV2",
        "renderItemSheet5e",
        "renderItemSheet5e2",
        "renderContainerSheet",
        "renderContainerSheet5e",
        "renderContainerSheet5e2"
    ];

    for (const hookName of itemSheetHooks) {
        Hooks.on(hookName, (app, html) => {
            injectItemProvisionsButton(app, html);
            injectContainerEnrichment(app, html);
        });
    }

    Hooks.on("updateItem", (item, changes, options) => {
        const actor = item.parent;
        if (!actor || actor.documentName !== "Actor" || actor.type !== "character") return;

        const sheet = actor.sheet;
        if (!sheet?.rendered) return;

        if (options?.ionriftCohortSuffixSync && changes.name) {
            sheet.render(false);
            return;
        }

        const el = sheet.element;
        if (el) refreshSpoilageBadgesForElement(actor, el);
    });
}
