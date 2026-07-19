import { ImageResolver } from "../../../utils/ImageResolver.js";

/**
 * Shared camp-art readiness check.
 * Acquisition instructions live on the pack post.
 */
export function hasFullArtPack() {
    return !!(ImageResolver.hasArtPack && ImageResolver.hasStationTokens);
}
