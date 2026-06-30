/**
 * @module SheetInjectionUtils
 * @description Shared helpers for actor-sheet DOM injection.
 * Branch on App V1 vs App V2 sheet APIs, not on game.system.id.
 */

/**
 * True when the sheet uses Foundry's Application V2 / DocumentSheetV2 header contract.
 * App V1 sheets (PF2e, legacy actors) return false.
 * @param {Application|object|null|undefined} app
 * @returns {boolean}
 */
export function isAppV2Sheet(app) {
    if (!app) return false;

    const v1Sheet = globalThis.foundry?.appv1?.sheets?.DocumentSheet;
    if (v1Sheet && app instanceof v1Sheet) return false;

    const v2App = globalThis.foundry?.applications?.api?.ApplicationV2;
    if (v2App && app instanceof v2App) return true;

    return false;
}

/**
 * CSS classes for the diet config header button on the given sheet generation.
 * @param {Application|object|null|undefined} app
 * @returns {string}
 */
export function resolveDietButtonClassName(app) {
    return isAppV2Sheet(app)
        ? "header-control-button respite-diet-btn"
        : "respite-diet-btn respite-diet-btn--appv1";
}

/**
 * Node the diet button should sit immediately before in a sheet window header.
 * Prefers the leading edge of native header controls (Token, Configure, etc.)
 * rather than the close control, so the button stays left of system actions.
 * @param {HTMLElement|null|undefined} header
 * @returns {Element|null}
 */
export function resolveDietButtonInsertBefore(header) {
    if (!header) return null;

    const v2Controls = header.querySelector(".header-controls");
    if (v2Controls) {
        for (const child of v2Controls.children) {
            if (!child.classList.contains("respite-diet-btn")) return child;
        }
        return null;
    }

    const firstHeaderButton = header.querySelector("a.header-button, button.header-button");
    if (firstHeaderButton && !firstHeaderButton.classList.contains("respite-diet-btn")) {
        return firstHeaderButton;
    }

    const closeControl = header.querySelector(
        "a.header-button.close, button.header-button.close, a.close, button.close, [data-action='close']"
    );
    if (closeControl && !closeControl.classList.contains("respite-diet-btn")) {
        return closeControl;
    }

    return null;
}

/**
 * Mounts or repositions the diet button within a sheet header.
 * @param {HTMLElement} header
 * @param {HTMLButtonElement} btn
 */
export function mountDietButtonInHeader(header, btn) {
    const insertBefore = resolveDietButtonInsertBefore(header);
    if (insertBefore) {
        insertBefore.before(btn);
        return;
    }
    if (btn.parentElement !== header) {
        header.appendChild(btn);
    }
}
