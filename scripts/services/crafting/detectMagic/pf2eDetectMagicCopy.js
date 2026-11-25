/**
 * Player-facing wording for PF2e Detect Magic. Every line must stay within what the
 * cast rank reveals (Player Core): presence below Rank 3, strongest level at Rank 3,
 * the carrying character at Rank 4+. Never an item, never "unfamiliar" magic.
 */

/**
 * @param {"presence"|"rank"|"pinpoint"} capability
 * @returns {string}
 */
export function pf2eDetectMagicTierHint(capability) {
    if (capability === "pinpoint") return "reveals magic in camp, the strongest level, and which character carries it";
    if (capability === "rank") return "reveals magic in camp and the strongest level, but not where it is";
    return "reveals whether magic is in camp, but not where it is";
}

/**
 * @param {{ present: boolean, castRank: number, capability: string, casterName: string|null, strongestLevel: number|null, sourceActorName: string|null }} camp
 * @returns {string}
 */
export function buildPf2eDetectMagicBannerText(camp) {
    const casterPrefix = camp.casterName ? `${camp.casterName} · ` : "";
    const head = `${casterPrefix}Detect Magic (Rank ${camp.castRank}):`;
    if (!camp.present) {
        return `${head} No magic detected in camp. Identified items are ignored.`;
    }
    if (camp.capability === "pinpoint") {
        return `${head} Magic is present in camp. The strongest (level ${camp.strongestLevel}) is on ${camp.sourceActorName}. Other sources are not located.`;
    }
    if (camp.capability === "rank") {
        return `${head} Magic is present in camp. The strongest is level ${camp.strongestLevel}. Its location is not revealed.`;
    }
    return `${head} Magic is present somewhere in camp. Rank ${camp.castRank} reveals presence only.`;
}
