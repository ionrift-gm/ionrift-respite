/**
 * @module SettingsPanelLayout
 * @description Respite-local enhancements to the Foundry settings panel.
 *
 * The shared kernel (ionrift-library SettingsLayout) already moves the footer
 * (Discord / Wiki) to the bottom and draws a divider. This module adds the
 * Respite-specific touches on top of that, scoped to the Respite section only:
 *   - a Quick Setup card that applies a play-style profile in one click
 *   - subtle group headers so the section reads as a few short lists
 *   - a frequency/danger ordering (mode and event pool first, reset last)
 *
 * Registered as its own renderSettingsConfig hook. Respite loads after the
 * library, so this hook fires after the kernel layout pass and finalises the
 * section without touching kernel internals.
 */

import { getTrainingTierLabel } from "./TrainingSettings.js";

const MODULE_ID = "ionrift-respite";

/**
 * Settings a Quick Setup profile writes, in two tiers. Complexity keys set the
 * rules weight of a rest; player keys set what players may do on their own
 * sheets. World data (scene token names, custom food lists, per-character
 * diets, recovery timing) is deliberately excluded: a profile must never
 * overwrite world-specific text a GM has tuned.
 */
const COMPLEXITY_KEYS = [
    "enableComfort",
    "enableProfessions",
    "trainingXpTier",
    "enableFletching",
    "enableEncounters",
    "enableCopySpell",
    "enableScouting",
    "trackFood",
    "partialSustenance",
    "armorDoffRule"
];

const PLAYER_KEYS = [
    "interceptRests",
    "lockAttuneOutsideRest",
    "lockPlayerQuantity"
];

const PROFILE_KEYS = [...COMPLEXITY_KEYS, ...PLAYER_KEYS];

const KEY_LABELS = {
    enableComfort: "Comfort rules",
    enableProfessions: "Crafting professions (and travel phase)",
    trainingXpTier: "Training activity",
    enableFletching: "Fletching activity",
    enableEncounters: "Night encounters & watch",
    enableCopySpell: "Copy Spell activity",
    enableScouting: "Travel scouting",
    trackFood: "Meal tracking",
    partialSustenance: "Partial sustenance",
    armorDoffRule: "Armor sleep penalties",
    interceptRests: "Intercept player rests",
    lockAttuneOutsideRest: "Lock attunement to rest",
    lockPlayerQuantity: "Lock player quantities"
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
        desc: "Bare-bones rest. No comfort, professions, food, encounters, or extra activities.",
        values: {
            enableComfort: false,
            enableProfessions: false,
            trainingXpTier: 0,
            enableFletching: false,
            enableEncounters: false,
            enableCopySpell: false,
            enableScouting: false,
            trackFood: false,
            partialSustenance: false,
            armorDoffRule: false,
            interceptRests: true,
            lockAttuneOutsideRest: false,
            lockPlayerQuantity: false
        }
    },
    {
        id: "standard",
        label: "Standard",
        icon: "fas fa-campground",
        desc: "Full camp: professions, training, fletching, and night encounters. No comfort tiers, food, or scouting.",
        values: {
            enableComfort: false,
            enableProfessions: true,
            trainingXpTier: 1,
            enableFletching: true,
            enableEncounters: true,
            enableCopySpell: true,
            enableScouting: false,
            trackFood: false,
            partialSustenance: false,
            armorDoffRule: true,
            interceptRests: true,
            lockAttuneOutsideRest: true,
            lockPlayerQuantity: false
        }
    },
    {
        id: "survival",
        label: "Survival",
        icon: "fas fa-mountain-sun",
        desc: "Standard plus comfort tiers, food, water, and travel scouting. Strict rations, locked quantities.",
        values: {
            enableComfort: true,
            enableProfessions: true,
            trainingXpTier: 1,
            enableFletching: true,
            enableEncounters: true,
            enableCopySpell: true,
            enableScouting: true,
            trackFood: true,
            partialSustenance: true,
            armorDoffRule: true,
            interceptRests: true,
            lockAttuneOutsideRest: true,
            lockPlayerQuantity: true
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
 * Returns the id of the profile whose values match the current settings
 * exactly, or null if the live configuration matches none of them (i.e. the
 * GM has deviated from every preset).
 * @returns {string|null}
 */
function getActiveProfileId() {
    const current = {};
    for (const k of PROFILE_KEYS) current[k] = game.settings.get(MODULE_ID, k);
    const match = PROFILES.find(p => PROFILE_KEYS.every(k => current[k] === p.values[k]));
    return match ? match.id : null;
}

/**
 * Toggles the active highlight on the profile buttons within a scope.
 * @param {ParentNode} [scope=document]
 */
function markActiveProfile(scope = document) {
    const activeId = getActiveProfileId();
    scope.querySelectorAll(".respite-profile-btn").forEach(btn => {
        const id = btn.dataset.profile;
        const active = id === "custom" ? activeId === null : id === activeId;
        btn.classList.toggle("is-active", active);
    });
}

/**
 * Formats a profile value for the Quick Setup confirm table.
 * @param {string} key
 * @param {*} value
 * @returns {{ text: string, cssClass: string }}
 */
function formatProfileCell(key, value) {
    if (key === "trainingXpTier") {
        const tier = Number(value) || 0;
        const text = getTrainingTierLabel(tier);
        return { text, cssClass: tier > 0 ? "on" : "off" };
    }
    return { text: value ? "On" : "Off", cssClass: value ? "on" : "off" };
}

/**
 * Confirms and applies a Quick Setup profile to world settings.
 * @param {string} id
 */
async function applyProfile(id) {
    const profile = PROFILES.find(p => p.id === id);
    if (!profile) return;

    const rows = PROFILE_KEYS.map(k => {
        const cell = formatProfileCell(k, profile.values[k]);
        const groupLabel = k === PLAYER_KEYS[0]
            ? `<tr class="rp-group"><td colspan="2">Player rules</td></tr>`
            : "";
        return `${groupLabel}<tr><td>${KEY_LABELS[k]}</td><td class="${cell.cssClass}">${cell.text}</td></tr>`;
    }).join("");

    const content = `
        <div class="respite-profile-confirm">
            <p>Apply the <strong>${profile.label}</strong> setup for the whole world?</p>
            <table>${rows}</table>
            <p class="respite-profile-note">The interface mode, scene token names, and per-character diets are left as they are. Fine-tune anything afterward in the panels below.</p>
        </div>`;

    // lint-ignore: DialogV2. This module is a settings-panel UI enhancer, not a
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
    markActiveProfile();
    ui.notifications?.info(`Respite: ${profile.label} setup applied.`);
}

/**
 * Renders one Quick Setup profile button.
 * @param {Object} p
 * @returns {string}
 */
function renderProfileButton(p) {
    return `
                <button type="button" class="respite-profile-btn" data-profile="${p.id}">
                    <span class="rp-name"><i class="${p.icon}"></i> ${p.label}</span>
                    <span class="rp-desc">${p.desc}</span>
                    <span class="rp-active"><i class="fas fa-circle-check"></i> Active</span>
                </button>`;
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
    if (container.querySelector(".respite-quick-setup")) return;

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

    const quick = document.createElement("div");
    quick.className = "respite-quick-setup";
    quick.innerHTML = `
        <div class="respite-quick-setup-head">
            <div class="respite-quick-setup-head-top">
                <span class="respite-quick-setup-title"><i class="fas fa-sliders"></i> Quick setup</span>
                <button type="button" class="respite-quick-setup-guide-link" data-action="openGuide"
                    data-tooltip="Opens the in-Foundry player guide: rest phases, comfort tiers, and what your nightly camp activity does."
                    aria-label="Open player guide">
                    <i class="fas fa-book-open" aria-hidden="true"></i> Open guide
                </button>
            </div>
            <span class="respite-quick-setup-sub">Pick a starting point for the table. Every option stays adjustable in the panels below.</span>
        </div>
        <div class="respite-quick-setup-options">
            <div class="respite-quick-setup-row">
            ${PROFILES.map(renderProfileButton).join("")}
            </div>
            <div class="respite-quick-setup-row respite-quick-setup-row-secondary">
            <div class="respite-profile-btn respite-profile-custom" data-profile="custom">
                <span class="rp-name"><i class="fas fa-pen-to-square"></i> Custom</span>
                <span class="rp-desc">Your own mix of the options below.</span>
                <span class="rp-active"><i class="fas fa-circle-check"></i> Active</span>
            </div>
            </div>
        </div>`;
    quick.querySelectorAll(".respite-profile-btn:not(.respite-profile-custom)").forEach(btn => {
        btn.addEventListener("click", () => applyProfile(btn.dataset.profile));
    });
    quick.querySelector('[data-action="openGuide"]')?.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        game.ionrift?.respite?.openPlayerGuide?.();
    });
    container.insertBefore(quick, container.firstChild);
    markActiveProfile(quick);
}

Hooks.on("renderSettingsConfig", (app, html) => {
    enhanceRespiteSettings(html);
});
