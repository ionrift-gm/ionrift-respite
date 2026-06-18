/**
 * Resolves compendium folder paths to travel pool keys (forage/hunt + terrain).
 */

const TERRAIN_ALIASES = {
    forest: "forest",
    swamp: "swamp",
    desert: "desert",
    mountain: "mountain",
    arctic: "arctic",
    wilderness: "wilderness"
};

/**
 * Build folder id → slash path map from a compendium collection.
 * @param {CompendiumCollection} collection
 * @returns {{ pathFor: (folderId: string) => string }}
 */
export function buildFolderPathMap(collection) {
    const folders = collection?.folders?.contents ?? [];
    const byId = new Map(folders.map(f => [f.id, f]));

    function pathFor(folderId) {
        if (!folderId) return "";
        const parts = [];
        let cur = byId.get(folderId);
        while (cur) {
            parts.unshift(cur.name);
            cur = cur.folder ? byId.get(cur.folder) : null;
        }
        return parts.join("/");
    }

    return { pathFor };
}

/**
 * Map a folder path to pool category and optional terrain list.
 * @param {string} folderPath - e.g. "Forage/Forest", "Hunting", "Reagents"
 * @returns {{ category: "forage"|"hunt", terrains: string[] } | null}
 */
export function resolvePoolFromFolderPath(folderPath) {
    if (!folderPath) return null;
    const parts = folderPath.split("/").map(s => s.trim()).filter(Boolean);
    if (!parts.length) return null;

    const head = parts[0].toLowerCase();
    let category = null;
    if (head === "forage") category = "forage";
    else if (head === "hunting" || head === "hunt") category = "hunt";
    else return null;

    if (parts.length > 1) {
        const terrainKey = parts[1].toLowerCase();
        const terrain = TERRAIN_ALIASES[terrainKey];
        if (terrain) return { category, terrains: [terrain] };
    }

    return { category, terrains: null };
}
