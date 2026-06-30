/**
 * World compendium for GM homebrew provisions (forage, hunt, reagents, outputs).
 * Lives under the Ionrift Custom sidebar folder; not overwritten by module updates.
 */

const MODULE_ID = "ionrift-respite";
const PACK_NAME = "ionrift-respite-custom";
const PACK_LABEL = "Respite Custom Items";
const SIDEBAR_FOLDER_NAME = "Ionrift Custom";

/** Top-level and terrain folders created on first GM setup. */
const PROVISION_FOLDER_TREE = {
    "Camp Fuel": [],
    Forage: ["Forest", "Desert", "Swamp", "Mountain", "Arctic", "Wilderness"],
    Hunting: [],
    Reagents: [],
    "Cooking Outputs": [],
    "Brewing Outputs": []
};

export const PROVISIONS_CUSTOM_PACK_ID = `world.${PACK_NAME}`;

/**
 * @param {Folder} folder
 * @returns {string|null}
 */
export function folderParentId(folder) {
    if (!folder) return null;
    const parent = folder.folder ?? folder.parent;
    if (!parent) return null;
    if (typeof parent === "string") return parent;
    return parent.id ?? null;
}

export class ProvisionsCustomPack {

    static get PACK_ID() {
        return PROVISIONS_CUSTOM_PACK_ID;
    }

    /**
     * Ensure world custom pack exists under Ionrift Custom sidebar folder.
     * @returns {Promise<CompendiumCollection|null>}
     */
    static async ensurePack() {
        if (!game.user?.isGM) {
            return game.packs.get(PROVISIONS_CUSTOM_PACK_ID) ?? null;
        }

        let pack = game.packs.get(PROVISIONS_CUSTOM_PACK_ID);
        if (!pack) {
            pack = await CompendiumCollection.createCompendium({
                type: "Item",
                label: PACK_LABEL,
                name: PACK_NAME,
                package: "world"
            });
        }

        let sidebarFolder = game.folders.find(
            folder => folder.name === SIDEBAR_FOLDER_NAME && folder.type === "Compendium"
        );
        if (!sidebarFolder) {
            sidebarFolder = await Folder.create({
                name: SIDEBAR_FOLDER_NAME,
                type: "Compendium",
                sorting: "a"
            });
        }
        if (pack.folder?.id !== sidebarFolder.id) {
            await pack.configure({ folder: sidebarFolder.id });
        }

        await ProvisionsCustomPack._ensureFolderTree(pack);
        return pack;
    }

    /**
     * @param {CompendiumCollection} pack
     */
    static async _ensureFolderTree(pack) {
        for (const [rootName, children] of Object.entries(PROVISION_FOLDER_TREE)) {
            const rootFolder = await ProvisionsCustomPack._ensureItemFolder(pack, rootName, null);
            for (const childName of children) {
                await ProvisionsCustomPack._ensureItemFolder(pack, childName, rootFolder.id);
            }
        }
    }

    /**
     * @param {CompendiumCollection} pack
     * @param {string} name
     * @param {string|null} parentId
     */
    static async _ensureItemFolder(pack, name, parentId) {
        const match = pack.folders.find(folder =>
            folder.name === name && (
                parentId
                    ? folderParentId(folder) === parentId
                    : !folderParentId(folder)
            )
        );
        if (match) return match;
        return Folder.create(
            { name, type: "Item", folder: parentId ?? null },
            { pack: pack.collection }
        );
    }

    /**
     * @param {CompendiumCollection} pack
     * @param {string} folderName - e.g. Cooking Outputs
     * @returns {Promise<Folder|null>}
     */
    static async ensureOutputFolder(pack, folderName) {
        if (!pack) return null;
        return ProvisionsCustomPack._ensureItemFolder(pack, folderName, null);
    }
}
