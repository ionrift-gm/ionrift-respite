import { ImageResolver } from "../../../utils/ImageResolver.js";

/**
 * Shared camp-art readiness check.
 * Pack acquisition nudges live in Annex only; listed Respite does not register them.
 */
export function hasFullArtPack() {
    return !!(ImageResolver.hasArtPack && ImageResolver.hasStationTokens);
}
