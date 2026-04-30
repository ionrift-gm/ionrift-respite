/**
 * @module RejoinManager
 * @description Manages persistent notification bars for rest rejoin, prep, and GM indicators.
 * Extracted from module.js (Phase 2.4). Pure DOM helpers — no module-level state dependencies.
 *
 * Stateful handlers (_handleRequestShortRestState, _resumeGmShortRest) remain in module.js
 * because they mutate module-scoped variables (activeShortRestApp, respiteFlowActive).
 */

import { getPartyActors } from "./partyActors.js";

const MODULE_ID = "ionrift-respite";

// ── Long Rest: Player Rejoin Bar ─────────────────────────────

/**
 * Shows a persistent rejoin notification when the player closes the rest window.
 * @param {object} [app] - Active player rest app for phase/progress info.
 * @param {function} rejoinFn - Callback to rejoin the rest.
 */
export function showRejoinNotification(app, rejoinFn) {
    removeRejoinNotification();
    // eslint-disable-next-line no-console
    console.debug(`ionrift-respite | [REJOIN] showRejoinNotification: hasApp=${!!app}, phase=${app?._phase ?? "none"}, choices=${app?._characterChoices?.size ?? "none"}`);
    const el = document.createElement("div");
    el.id = "respite-rejoin-bar";
    const phaseLabel = app?._phase ? `Phase: ${app._phase}` : "active";
    const isActivity = app?._phase === "activity";
    const partySize = isActivity ? (getPartyActors().length || 0) : 0;
    const activitiesResolved = isActivity ? (app?._characterChoices?.size ?? 0) : 0;
    const trackFood = isActivity && game.settings.get(MODULE_ID, "trackFood");
    const rationsResolved = trackFood ? (app?._activityMealRationsSubmitted?.size ?? 0) : 0;
    const totalTasks = partySize + (trackFood ? partySize : 0);
    const resolvedTasks = activitiesResolved + rationsResolved;
    const allDone = isActivity && totalTasks > 0 && resolvedTasks >= totalTasks;
    const progressHtml = isActivity
        ? `<span class="respite-bar-progress">${resolvedTasks} / ${totalTasks} tasks to complete</span>`
        : "";
    el.innerHTML = `
        <i class="fas fa-campground"></i>
        <span>Rest in progress (${phaseLabel})</span>
        ${progressHtml}
        <button type="button" id="respite-rejoin-btn"${allDone ? ' class="respite-resume-ready"' : ""}>Resume</button>
    `;
    el.querySelector("#respite-rejoin-btn").addEventListener("click", () => {
        // eslint-disable-next-line no-console
        console.debug(`ionrift-respite | [REJOIN] Resume clicked: hasApp=${!!app}, rendered=${app?.rendered ?? "none"}`);
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

// ── Short Rest: Player Rejoin Bar ────────────────────────────

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
        <span>A short rest is in progress.</span>
        <button type="button" id="respite-short-rest-rejoin-btn">Rejoin</button>
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

// ── Prep Notification ────────────────────────────────────────

/**
 * Shows a "preparing rest" notification when the GM opens the setup wizard.
 */
export function showPrepNotification() {
    removePrepNotification();
    const el = document.createElement("div");
    el.id = "respite-prep-bar";
    el.innerHTML = `
        <i class="fas fa-campground"></i>
        <span>Your GM is preparing a rest...</span>
    `;
    document.body.appendChild(el);
}

/**
 * Removes the prep notification bar.
 */
export function removePrepNotification() {
    document.getElementById("respite-prep-bar")?.remove();
}

// ── GM: Long Rest Indicator Bar ──────────────────────────────

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
    const phaseLabel = awaitingCombat ? "Awaiting combat resolution" : `Phase: ${app?._phase ?? "active"}`;
    const isActivity = app?._phase === "activity";
    const partySize = isActivity ? getPartyActors().length : 0;
    const activitiesResolved = isActivity ? (app?._characterChoices?.size ?? 0) : 0;
    const trackFood = isActivity && game.settings.get(MODULE_ID, "trackFood");
    const rationsResolved = trackFood ? (app?._activityMealRationsSubmitted?.size ?? 0) : 0;
    const totalTasks = partySize + (trackFood ? partySize : 0);
    const resolvedTasks = activitiesResolved + rationsResolved;
    const allDone = isActivity && totalTasks > 0 && resolvedTasks >= totalTasks;
    const progressHtml = isActivity
        ? `<span class="respite-bar-progress">${resolvedTasks} / ${totalTasks} tasks to complete</span>`
        : "";
    el.innerHTML = `
        <i class="fas fa-campground"></i>
        <span>Rest in progress (${phaseLabel})</span>
        ${progressHtml}
        <button type="button" id="respite-gm-resume-btn"${allDone ? ' class="respite-resume-ready"' : ""}>${awaitingCombat ? "View" : "Resume"}</button>
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
 * Safe to call even if the bar isn't visible — no-ops cleanly.
 * @param {object} app - The active RestSetupApp instance.
 */
export function refreshGmRestIndicator(app) {
    const bar = document.getElementById("respite-gm-rest-bar");
    if (!bar || app?._phase !== "activity") return;
    const span = bar.querySelector(".respite-bar-progress");
    if (!span) return;
    const partySize = getPartyActors().length;
    const activitiesResolved = app._characterChoices?.size ?? 0;
    const trackFood = game.settings.get(MODULE_ID, "trackFood");
    const rationsResolved = trackFood ? (app._activityMealRationsSubmitted?.size ?? 0) : 0;
    const totalTasks = partySize + (trackFood ? partySize : 0);
    const resolvedTasks = activitiesResolved + rationsResolved;
    span.textContent = `${resolvedTasks} / ${totalTasks} tasks to complete`;
    const btn = bar.querySelector("#respite-gm-resume-btn");
    if (btn) btn.classList.toggle("respite-resume-ready", totalTasks > 0 && resolvedTasks >= totalTasks);
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
    const partySize = getPartyActors().length;
    const activitiesResolved = app._characterChoices?.size ?? 0;
    const trackFood = game.settings.get(MODULE_ID, "trackFood");
    const rationsResolved = trackFood ? (app._activityMealRationsSubmitted?.size ?? 0) : 0;
    const totalTasks = partySize + (trackFood ? partySize : 0);
    const resolvedTasks = activitiesResolved + rationsResolved;
    span.textContent = `${resolvedTasks} / ${totalTasks} tasks to complete`;
    const btn = bar.querySelector("#respite-rejoin-btn");
    if (btn) btn.classList.toggle("respite-resume-ready", totalTasks > 0 && resolvedTasks >= totalTasks);
}

// ── GM: Short Rest Indicator Bar ─────────────────────────────

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
        <span>Short rest in progress</span>
        <button type="button" id="respite-gm-short-rest-resume-btn">Resume</button>
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
