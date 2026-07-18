import { ImageResolver } from "../../../utils/ImageResolver.js";
import { MODULE_ID } from "../../../data/moduleId.js";

/**
 * Returns true when the camp art pack is fully resolved (terrain + station tokens).
 * Mirrors the gating in RestSetupApp._shouldShowArtNudge.
 */
export function hasFullArtPack() {
    return !!(ImageResolver.hasArtPack && ImageResolver.hasStationTokens);
}

/**
 * Open the Respite content pack manager focused on the art tab (local status only).
 */
async function openArtPackInstaller() {
    const lib = game.ionrift?.library;
    if (lib?.isOverlayDistributionActive?.()) {
        await lib.openPatreonLibrary?.({ moduleId: MODULE_ID });
        return;
    }
    const { PackRegistryApp } = await import("../../../apps/packs/PackRegistryApp.js");
    const app = new PackRegistryApp();
    app.render(true);
    setTimeout(() => {
        app.element?.querySelector?.('.pack-tab[data-tab="art"]')?.click();
    }, 200);
}

/**
 * Registers the Respite camp art readiness nudge with the shared library service.
 * Idempotent. Re-uses the existing artNudge* settings so the dismiss state is
 * shared with the in-app camp-phase art nudge in RestSetupApp.
 * No packUrl: listed Respite must not funnel prepared-media downloads.
 */
export function registerArtPackNudge() {
    const packNudge = game.ionrift?.library?.packNudge;
    if (!packNudge) return;
    if (packNudge.isRegistered(MODULE_ID)) return;

    packNudge.register({
        moduleId: MODULE_ID,
        isContentInstalled: () => hasFullArtPack(),
        openInstaller: () => openArtPackInstaller(),
        title: "Camp art pack not installed.",
        subtitle: "Respite uses placeholder icons until a local art pack is present. Pack downloads are outside the listed module.",
        icon: "fas fa-palette",
        primaryLabel: "Manage Packs",
        primaryIcon: "fas fa-sliders",
        settings: {
            suppressed: "artNudgeSuppressed",
            snoozedUntil: "artNudgeSnoozedUntil"
        }
    });
}
