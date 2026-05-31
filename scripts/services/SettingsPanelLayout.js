/**
 * @module SettingsPanelLayout
 * @description Respite-local enhancements to the Foundry settings panel.
 *
 * The shared kernel (ionrift-library SettingsLayout) already moves the footer
 * (Discord / Wiki) to the bottom and draws a divider. This module adds the
 * Respite-specific touches on top of that, scoped to the Respite section only:
 *   - a one-line lead explaining defaults are sensible and everything is optional
 *   - a Quick Setup card that applies a play-style profile in one click
 *   - subtle group headers so the section reads as a few short lists
 *   - a frequency/danger ordering (mode and event pool first, reset last)
 *
 * Registered as its own renderSettingsConfig hook. Respite loads after the
 * library, so this hook fires after the kernel layout pass and finalises the
 * section without touching kernel internals.
 */

const MODULE_ID = "ionrift-respite";

/**
 * Gameplay-complexity toggles a Quick Setup profile writes. Player
 * restrictions and the interface mode are intentionally left alone: those are
 * separate policy/UX choices, not part of the complexity dial.
 */
const PROFILE_KEYS = [
    "enableComfort",
    "enableProfessions",
    "trackFood",
    "partialSustenance",
    "enableTraining",
    "enableFletching",
    "armorDoffRule"
];

const KEY_LABELS = {
    enableComfort: "Comfort rules",
    enableProfessions: "Crafting professions (and travel phase)",
    trackFood: "Meal tracking",
    partialSustenance: "Partial sustenance",
    enableTraining: "Training activity",
    enableFletching: "Fletching activity",
    armorDoffRule: "Armor sleep penalties"
};

/**
 * Quick Setup profiles. Each sets every PROFILE_KEYS value so the result is
 * deterministic regardless of the previous state.
 */
const PROFILES = [
    {
        id: "simple",
        label: "Simple",
        icon: "fas fa-feather",
        desc: "Pared back. No comfort, professions, meals, or extra activities.",
        values: {
            enableComfort: false,
            enableProfessions: false,
            trackFood: false,
            partialSustenance: false,
            enableTraining: false,
            enableFletching: false,
            armorDoffRule: false
        }
    },
    {
        id: "standard",
        label: "Standard",
        icon: "fas fa-campground",
        desc: "The default mix. Comfort, professions, meals, training, and fletching.",
        values: {
            enableComfort: true,
            enableProfessions: true,
            trackFood: true,
            partialSustenance: true,
            enableTraining: true,
            enableFletching: true,
            armorDoffRule: true
        }
    },
    {
        id: "survival",
        label: "Survival",
        icon: "fas fa-mountain-sun",
        desc: "Everything on, strict rations. Partial sustenance off.",
        values: {
            enableComfort: true,
            enableProfessions: true,
            trackFood: true,
            partialSustenance: false,
            enableTraining: true,
            enableFletching: true,
            armorDoffRule: true
        }
    }
];

/**
 * Ordered grouping of the visible Respite settings/menus. Keys resolve to
 * either a registerMenu button or a register() control; missing keys are
 * skipped so an empty group does not draw a header.
 */
const GROUPS = [
    { title: "Start here", icon: "fas fa-flag", keys: ["restInterfaceMode", "eventBrowser"] },
    { title: "Rules & activities", icon: "fas fa-scroll", keys: ["recoveryConfig", "activityConfig", "dietConfigMenu"] },
    { title: "Players", icon: "fas fa-users", keys: ["playerRestrictions"] },
    { title: "Display", icon: "fas fa-eye", keys: ["ambientAfkHud"] },
    { title: "Tools", icon: "fas fa-wrench", keys: ["clearRestState"] }
];

/**
 * Resolves the `.form-group` wrapper for a Respite menu button or setting.
 * @param {HTMLElement} root
 * @param {string} key
 * @returns {HTMLElement|null}
 */
function getGroup(root, key) {
    const byMenu = root.querySelector(`button[data-key="${MODULE_ID}.${key}"]`);
    if (byMenu) return byMenu.closest(".form-group");
    const bySetting = root.querySelector(`[name="${MODULE_ID}.${key}"]`);
    return bySetting ? bySetting.closest(".form-group") : null;
}

/**
 * Confirms and applies a Quick Setup profile to world settings.
 * @param {string} id
 */
async function applyProfile(id) {
    const profile = PROFILES.find(p => p.id === id);
    if (!profile) return;

    const rows = PROFILE_KEYS.map(k => {
        const on = profile.values[k];
        return `<tr><td>${KEY_LABELS[k]}</td><td class="${on ? "on" : "off"}">${on ? "On" : "Off"}</td></tr>`;
    }).join("");

    const content = `
        <div class="respite-profile-confirm">
            <p>Apply the <strong>${profile.label}</strong> setup for the whole world?</p>
            <table>${rows}</table>
            <p class="respite-profile-note">Player restrictions and the interface mode are left as they are. Fine-tune anything afterward in the panels below.</p>
        </div>`;

    // lint-ignore: DialogV2 — this module is a settings-panel UI enhancer, not a
    // headless service; the branded confirm needs the DialogV2 form-footer theme.
    const proceed = await foundry.applications.api.DialogV2.confirm({
        window: { title: `Apply ${profile.label} setup`, icon: profile.icon },
        classes: ["ionrift-window", "dialog"],
        modal: true,
        content,
        yes: { label: "Apply", default: false },
        no: { label: "Cancel", default: true }
    });
    if (!proceed) return;

    for (const k of PROFILE_KEYS) {
        await game.settings.set(MODULE_ID, k, profile.values[k]);
    }
    ui.notifications?.info(`Respite: ${profile.label} setup applied.`);
}

/**
 * Enhances the Respite section of an open Settings config window.
 * Idempotent within a render: bails if the lead is already present.
 * @param {HTMLElement|JQuery} root
 */
export function enhanceRespiteSettings(root) {
    if (!root) return;
    if (root.jquery) root = root[0];
    if (!(root instanceof HTMLElement)) return;

    const anchor = getGroup(root, "eventBrowser") ?? getGroup(root, "restInterfaceMode");
    if (!anchor) return;
    const container = anchor.parentElement;
    if (!container) return;
    if (container.querySelector(".respite-settings-lead")) return;

    // Insertion boundary: keep everything above the footer (Discord/Wiki).
    // Prefer the kernel divider if present, else the first footer group.
    const supportGroup = getGroup(root, "supportLink");
    let boundary = null;
    if (supportGroup) {
        const prev = supportGroup.previousElementSibling;
        boundary = (prev && prev.classList.contains("ionrift-settings-divider")) ? prev : supportGroup;
    }
    const place = (node) => boundary ? container.insertBefore(node, boundary) : container.appendChild(node);

    for (const group of GROUPS) {
        const present = group.keys.map(k => getGroup(root, k)).filter(Boolean);
        if (!present.length) continue;

        const header = document.createElement("div");
        header.className = "respite-settings-group-header";
        header.innerHTML = `<i class="${group.icon}"></i><span>${group.title}</span>`;
        place(header);

        for (const el of present) place(el);
    }

    const lead = document.createElement("div");
    lead.className = "respite-settings-lead";
    lead.innerHTML = `<i class="fas fa-campground"></i><span>Respite runs with sensible defaults. Everything here is optional; set it up only as far as the table wants.</span>`;
    container.insertBefore(lead, container.firstChild);

    const quick = document.createElement("div");
    quick.className = "respite-quick-setup";
    quick.innerHTML = `
        <div class="respite-quick-setup-head">
            <span class="respite-quick-setup-title"><i class="fas fa-sliders"></i> Quick setup</span>
            <span class="respite-quick-setup-sub">Pick a starting point. Everything stays adjustable below.</span>
        </div>
        <div class="respite-quick-setup-options">
            ${PROFILES.map(p => `
                <button type="button" class="respite-profile-btn" data-profile="${p.id}">
                    <span class="rp-name"><i class="${p.icon}"></i> ${p.label}</span>
                    <span class="rp-desc">${p.desc}</span>
                </button>`).join("")}
        </div>`;
    quick.querySelectorAll(".respite-profile-btn").forEach(btn => {
        btn.addEventListener("click", () => applyProfile(btn.dataset.profile));
    });
    lead.after(quick);
}

Hooks.on("renderSettingsConfig", (app, html) => {
    enhanceRespiteSettings(html);
});
