import { getPartyActors } from "./partyActors.js";
import { countActorFirewood } from "./CampGearScanner.js";

/**
 * GM-authoritative camp ceremony fields for player embed sync.
 * @param {import("../apps/RestSetupApp.js").RestSetupApp} app
 * @param {Record<string, unknown>} [extra]
 */
export function buildCampCeremonyPhasePayload(app, extra = {}) {
    const coldCamp = typeof app._isCampColdCampPreview === "function"
        ? app._isCampColdCampPreview()
        : false;
    return {
        makeCampStagedWood: [...(app._makeCampStagedWood ?? [])],
        campFirePreviewLevel: coldCamp ? "cold_camp" : (app._campFirePreviewLevel ?? "embers"),
        campPartyFirewood: typeof app._partyFirewoodTotal === "function"
            ? app._partyFirewoodTotal()
            : 0,
        campActorFirewood: Object.fromEntries(
            getPartyActors().map((actor) => [actor.id, countActorFirewood(actor)])
        ),
        selectedTerrain: app._selectedTerrain ?? null,
        ...extra
    };
}

/**
 * In-camp ceremony inventory updates should not tear down the TotM embed.
 * @param {string} prevPhase
 * @param {string} phase
 * @param {Record<string, unknown>} phaseData
 */
export function shouldPreserveCampfireEmbedOnPhaseChange(prevPhase, phase, phaseData) {
    if (prevPhase !== "camp" || phase !== "camp") return false;
    return phaseData.makeCampStagedWood !== undefined
        || phaseData.campPartyFirewood !== undefined
        || phaseData.campActorFirewood !== undefined
        || phaseData.campFirePreviewLevel !== undefined
        || phaseData.coldCampPreview !== undefined;
}
