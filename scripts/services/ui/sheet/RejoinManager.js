import { Logger } from "../../../utils/Logger.js";
import { MODULE_ID } from "../../../data/moduleId.js";
import { getPartyActors } from "../../party/partyActors.js";

/**
 * Shows a persistent rejoin notification when the player closes the rest window.
 * @param {object} [app] - Active player rest app for phase/progress info.
 * @param {function} rejoinFn - Callback to rejoin the rest.
 */
export function showRejoinNotification(app, rejoinFn) {
    removeRejoinNotification();
    const el = document.createElement("div");
    el.id = "respite-rejoin-bar";
    const awaitingCombat = app?._awaitingCombat;
    const phaseLabel = awaitingCombat ? game.i18n.localize("ionrift-respite.rejoin.awaitingCombat") : (app?._phase ? game.i18n.format("ionrift-respite.rejoin.phaseLabel", { phase: app._phase }) : game.i18n.localize("ionrift-respite.rejoin.active"));
    const isActivity = app?._phase === "activity";
    const partySize = isActivity ? (getPartyActors().length || 0) : 0;
    const activitiesResolved = isActivity ? (app?._characterChoices?.size ?? 0) : 0;
    const trackFood = isActivity && game.settings.get(MODULE_ID, "trackFood");
    const membersReady = isActivity ? (() => {
        let count = 0;
        const actors = getPartyActors();
        for (const a of actors) {
            const hasActivity = app?._characterChoices?.has(a.id);
            const hasRations = !trackFood || (app?._activityMealRationsSubmitted?.has(a.id));
            if (hasActivity && hasRations) count++;
        }
        return count;
    })() : 0;
    const allDone = isActivity && partySize > 0 && membersReady >= partySize;

    // Check if the current viewer has submitted (any owned actor)
    const viewerDone = isActivity ? getPartyActors().some(a => {
        const owned = (a.ownership?.[game.user.id] ?? 0) >= CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
        if (!owned) return false;
        const hasActivity = app?._characterChoices?.has(a.id);
        const hasRations = !trackFood || (app?._activityMealRationsSubmitted?.has(a.id));
        return hasActivity && hasRations;
    }) : false;

    const progressHtml = isActivity
        ? (viewerDone
            ? `<span class="respite-bar-progress"><i class="fas fa-users"></i> ${game.i18n.format("ionrift-respite.rejoin.partyMembersReady", { ready: membersReady, total: partySize })}</span>`
            : `<span class="respite-bar-progress respite-bar-advisory"><i class="fas fa-hand-pointer"></i> ${trackFood ? game.i18n.localize("ionrift-respite.rejoin.chooseActivityAndRations") : game.i18n.localize("ionrift-respite.rejoin.chooseActivity")}</span>`)
        : "";
    el.innerHTML = `
        <i class="fas fa-campground"></i>
        <span>${game.i18n.format("ionrift-respite.rejoin.restInProgressWithPhase", { phase: phaseLabel })}</span>
        ${progressHtml}
        <button type="button" id="respite-rejoin-btn"${allDone ? ' class="respite-resume-ready"' : ""}>${awaitingCombat ? game.i18n.localize("ionrift-respite.rejoin.btnView") : game.i18n.localize("ionrift-respite.rejoin.btnResume")}</button>
    `;
    el.querySelector("#respite-rejoin-btn").addEventListener("click", () => {
        removeRejoinNotification();
        if (app && !app.rendered) {
            app.render({ force: true });
        } else {
            rejoinFn();
        }
    });
    document.body.appendChild(el);
}

/**
 * Removes the rejoin notification bar.
 */
export function removeRejoinNotification() {
    document.getElementById("respite-rejoin-bar")?.remove();
}

/**
 * Shows a persistent rejoin notification when the player's short rest window
 * is closed but the short rest is still active.
 * @param {function} rejoinFn - Callback to rejoin the short rest.
 */
export function showShortRestRejoinNotification(rejoinFn) {
    removeShortRestRejoinNotification();
    const el = document.createElement("div");
    el.id = "respite-short-rest-rejoin-bar";
    el.innerHTML = `
        <i class="fas fa-mug-hot"></i>
        <span>${game.i18n.localize("ionrift-respite.rejoin.shortRestInProgressDesc")}</span>
        <button type="button" id="respite-short-rest-rejoin-btn">${game.i18n.localize("ionrift-respite.rejoin.btnRejoin")}</button>
    `;
    el.querySelector("#respite-short-rest-rejoin-btn").addEventListener("click", () => {
        rejoinFn();
    });
    document.body.appendChild(el);
}

/**
 * Removes the short rest rejoin notification bar.
 */
export function removeShortRestRejoinNotification() {
    document.getElementById("respite-short-rest-rejoin-bar")?.remove();
}

/**
 * Shows a "preparing rest" notification when the GM opens the setup wizard.
 */
export function showPrepNotification() {
    removePrepNotification();
    const el = document.createElement("div");
    el.id = "respite-prep-bar";
    el.innerHTML = `
        <i class="fas fa-campground"></i>
        <span>${game.i18n.localize("ionrift-respite.rejoin.gmPreparingRest")}</span>
    `;
    document.body.appendChild(el);
}

/**
 * Removes the prep notification bar.
 */
export function removePrepNotification() {
    document.getElementById("respite-prep-bar")?.remove();
}

/**
 * Shows a persistent GM indicator when the rest window is closed but a rest is still active.
 * @param {object} app - The active RestSetupApp instance.
 */
export function showGmRestIndicator(app) {
    if (!game.user?.isGM) return;
    removeGmRestIndicator();
    const el = document.createElement("div");
    el.id = "respite-gm-rest-bar";
    const awaitingCombat = app?._awaitingCombat;
    const phaseLabel = awaitingCombat ? game.i18n.localize("ionrift-respite.rejoin.awaitingCombat") : game.i18n.format("ionrift-respite.rejoin.phaseLabel", { phase: app?._phase ?? game.i18n.localize("ionrift-respite.rejoin.active") });
    const isActivity = app?._phase === "activity";
    const partySize = isActivity ? getPartyActors().length : 0;
    const activitiesResolved = isActivity ? (app?._characterChoices?.size ?? 0) : 0;
    const trackFood = isActivity && game.settings.get(MODULE_ID, "trackFood");
    // TotM: rations are collected in the dedicated meal phase, not the activity phase.
    // Mirror the allRationsSubmitted bypass used in the template context builder.
    const isTotM = isActivity && app._isTotM;
    const membersReady = isActivity ? (() => {
        let count = 0;
        const actors = getPartyActors();
        for (const a of actors) {
            const hasActivity = app?._characterChoices?.has(a.id);
            const hasRations = !trackFood || isTotM || (app?._activityMealRationsSubmitted?.has(a.id));
            if (hasActivity && hasRations) count++;
        }
        return count;
    })() : 0;
    const allDone = isActivity && partySize > 0 && membersReady >= partySize;
    const progressHtml = isActivity
        ? `<span class="respite-bar-progress"><i class="fas fa-users"></i> ${game.i18n.format("ionrift-respite.rejoin.partyMembersReady", { ready: membersReady, total: partySize })}</span>`
        : "";
    el.innerHTML = `
        <i class="fas fa-campground"></i>
        <span>${game.i18n.format("ionrift-respite.rejoin.restInProgressWithPhase", { phase: phaseLabel })}</span>
        ${progressHtml}
        <button type="button" id="respite-gm-resume-btn"${allDone ? ' class="respite-resume-ready"' : ""}>${awaitingCombat ? game.i18n.localize("ionrift-respite.rejoin.btnView") : game.i18n.localize("ionrift-respite.rejoin.btnResume")}</button>
    `;
    el.querySelector("#respite-gm-resume-btn").addEventListener("click", () => {
        removeGmRestIndicator();
        if (app) {
            app._canvasFocusedStationId = null;
            if (!app.rendered) app.render({ force: true });
        }
    });
    document.body.appendChild(el);
}

/**
 * Removes the GM rest indicator bar.
 */
export function removeGmRestIndicator() {
    document.getElementById("respite-gm-rest-bar")?.remove();
}

/**
 * Updates the task-count span in the existing GM rest indicator bar.
 * Call whenever _characterChoices or _activityMealRationsSubmitted changes.
 * Safe to call even if the bar isn't visible. No-ops cleanly.
 * @param {object} app - The active RestSetupApp instance.
 */
export function refreshGmRestIndicator(app) {
    const bar = document.getElementById("respite-gm-rest-bar");
    if (!bar || app?._phase !== "activity") return;
    const span = bar.querySelector(".respite-bar-progress");
    if (!span) return;
    const trackFood = game.settings.get(MODULE_ID, "trackFood");
    const isTotM = app._isTotM;
    const actors = getPartyActors();
    let membersReady = 0;
    for (const a of actors) {
        const hasActivity = app._characterChoices?.has(a.id);
        const hasRations = !trackFood || isTotM || (app._activityMealRationsSubmitted?.has(a.id));
        if (hasActivity && hasRations) membersReady++;
    }
    const partySize = actors.length;
    span.textContent = game.i18n.format("ionrift-respite.rejoin.partyMembersReady", { ready: membersReady, total: partySize });
    const btn = bar.querySelector("#respite-gm-resume-btn");
    if (btn) btn.classList.toggle("respite-resume-ready", partySize > 0 && membersReady >= partySize);
}

/**
 * Updates the task-count span in the existing player rejoin bar.
 * Call whenever _characterChoices changes on the player RSA.
 * @param {object} app - The active player RestSetupApp instance.
 */
export function refreshRejoinBar(app) {
    const bar = document.getElementById("respite-rejoin-bar");
    if (!bar || app?._phase !== "activity") return;
    const span = bar.querySelector(".respite-bar-progress");
    if (!span) return;
    const trackFood = game.settings.get(MODULE_ID, "trackFood");
    // TotM: rations collected in meal phase, not activity phase; bypass ration requirement.
    const isTotM = app._isTotM;
    const actors = getPartyActors();
    let membersReady = 0;
    for (const a of actors) {
        const hasActivity = app._characterChoices?.has(a.id);
        const hasRations = !trackFood || isTotM || (app._activityMealRationsSubmitted?.has(a.id));
        if (hasActivity && hasRations) membersReady++;
    }
    const partySize = actors.length;

    const viewerDone = actors.some(a => {
        const owned = (a.ownership?.[game.user.id] ?? 0) >= CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
        if (!owned) return false;
        return app._characterChoices?.has(a.id) && (!trackFood || isTotM || app._activityMealRationsSubmitted?.has(a.id));
    });

    if (viewerDone) {
        span.textContent = game.i18n.format("ionrift-respite.rejoin.partyMembersReady", { ready: membersReady, total: partySize });
        span.classList.remove("respite-bar-advisory");
    } else {
        span.textContent = (trackFood && !isTotM) ? game.i18n.localize("ionrift-respite.rejoin.chooseActivityAndRations") : game.i18n.localize("ionrift-respite.rejoin.chooseActivity");
        span.classList.add("respite-bar-advisory");
    }
    const btn = bar.querySelector("#respite-rejoin-btn");
    if (btn) btn.classList.toggle("respite-resume-ready", partySize > 0 && membersReady >= partySize);
}

/**
 * Shows a persistent GM indicator when the short rest window is closed but the rest persists.
 * @param {function} resumeFn - Callback to resume the GM short rest.
 */
export function showGmShortRestIndicator(resumeFn) {
    if (!game.user?.isGM) return;
    removeGmShortRestIndicator();
    const el = document.createElement("div");
    el.id = "respite-gm-short-rest-bar";
    el.innerHTML = `
        <i class="fas fa-mug-hot"></i>
        <span>${game.i18n.localize("ionrift-respite.rejoin.shortRestInProgress")}</span>
        <button type="button" id="respite-gm-short-rest-resume-btn">${game.i18n.localize("ionrift-respite.rejoin.btnResume")}</button>
    `;
    el.querySelector("#respite-gm-short-rest-resume-btn").addEventListener("click", () => {
        removeGmShortRestIndicator();
        resumeFn();
    });
    document.body.appendChild(el);
}

/**
 * Removes the GM short rest indicator bar.
 */
export function removeGmShortRestIndicator() {
    document.getElementById("respite-gm-short-rest-bar")?.remove();
}
