import { ImageResolver } from "../../../utils/ImageResolver.js";
import { MODULE_ID } from "../../../data/moduleId.js";

const CORE_ART_PATREON_URL = "https://www.patreon.com/posts/154985310";

/**
 * Returns true when the camp art pack is fully resolved (terrain + station tokens).
 * Mirrors the gating in RestSetupApp._shouldShowArtNudge.
 */
export function hasFullArtPack() {
    return !!(ImageResolver.hasArtPack && ImageResolver.hasStationTokens);
}

/**
 * Open the Respite content pack manager focused on the art tab.
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
 * Registers the Respite Core Art Pack nudge with the shared library service.
 * Idempotent. Re-uses the existing artNudge* settings so the dismiss state is
 * shared with the in-app camp-phase art nudge in RestSetupApp.
 */
export function registerArtPackNudge() {
    const packNudge = game.ionrift?.library?.packNudge;
    if (!packNudge) return;
    if (packNudge.isRegistered(MODULE_ID)) return;

    packNudge.register({
        moduleId: MODULE_ID,
        packUrl: CORE_ART_PATREON_URL,
        isContentInstalled: () => hasFullArtPack(),
        openInstaller: () => openArtPackInstaller(),
        title: "Camp art pack not installed.",
        subtitle: "Download the Core Art Pack, then install the zip from Patreon Library (Respite).",
        icon: "fas fa-palette",
        primaryLabel: "Install .zip",
        primaryIcon: "fas fa-file-import",
        secondaryLabel: "Get Pack",
        secondaryIcon: "fas fa-download",
        settings: {
            suppressed: "artNudgeSuppressed",
            snoozedUntil: "artNudgeSnoozedUntil"
        }
    });
}
