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
 * @param {Folder} folder
 * @returns {string|null}
 */
function folderParentId(folder) {
    if (!folder) return null;
    const parent = folder.folder ?? folder.parent;
    if (!parent) return null;
    if (typeof parent === "string") return parent;
    return parent.id ?? null;
}

/**
 * Collect folder documents from a compendium pack or embedded collection.
 * @param {CompendiumCollection|object} source
 * @returns {Folder[]}
 */
function compendiumFolders(source) {
    const folders = source?.folders;
    if (!folders) return [];
    if (Array.isArray(folders)) return folders;
    if (folders.contents) return folders.contents;
    if (typeof folders.forEach === "function") {
        const list = [];
        folders.forEach(folder => list.push(folder));
        return list;
    }
    return [];
}

/**
 * Build folder id → slash path map from a compendium pack (or collection).
 * @param {CompendiumCollection|object} packOrCollection
 * @returns {{ pathFor: (folderId: string) => string }}
 */
export function buildFolderPathMap(packOrCollection) {
    const folders = compendiumFolders(packOrCollection);
    const byId = new Map(folders.map(folder => [folder.id, folder]));

    function pathFor(folderId) {
        if (!folderId) return "";
        const parts = [];
        let cur = byId.get(folderId);
        while (cur) {
            parts.unshift(cur.name);
            const parentId = folderParentId(cur);
            cur = parentId ? byId.get(parentId) : null;
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

    if (category === "hunt") {
        return { category, terrains: Object.keys(TERRAIN_ALIASES) };
    }

    return { category, terrains: null };
}
