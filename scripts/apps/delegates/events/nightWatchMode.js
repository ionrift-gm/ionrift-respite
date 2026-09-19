/**
 * Night Watch mode for the events phase.
 * Random and Pick both draw from the curated pool. An empty pool falls
 * back to Improvise so the night check still has a table-side path.
 *
 * @param {string} [eventsMode="random"]
 * @param {number} [poolCount=0]
 * @returns {{
 *   effectiveMode: "random"|"improvise"|"pick",
 *   poolAvailable: boolean,
 *   eventsModePickAvailable: boolean,
 *   eventsModeRandomAvailable: boolean,
 *   eventsModeIsRandom: boolean,
 *   eventsModeIsImprovise: boolean,
 *   eventsModeIsPick: boolean
 * }}
 */
export function resolveNightWatchMode(eventsMode = "random", poolCount = 0) {
    const poolAvailable = Number(poolCount) > 0;
    let effectiveMode = eventsMode;
    if (effectiveMode !== "random" && effectiveMode !== "improvise" && effectiveMode !== "pick") {
        effectiveMode = "random";
    }
    if (!poolAvailable && effectiveMode !== "improvise") {
        effectiveMode = "improvise";
    }
    return {
        effectiveMode,
        poolAvailable,
        eventsModePickAvailable: poolAvailable,
        eventsModeRandomAvailable: poolAvailable,
        eventsModeIsRandom: effectiveMode === "random",
        eventsModeIsImprovise: effectiveMode === "improvise",
        eventsModeIsPick: effectiveMode === "pick"
    };
}
