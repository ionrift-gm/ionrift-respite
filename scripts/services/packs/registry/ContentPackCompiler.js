import { MODULE_ID } from "../../../data/moduleId.js";
/**
 * ContentPackCompiler
 *
 * Provides sidebar folder lookup and Released vs Incubating subfolder
 * creation for Ionrift / Respite compendium structure.
 */

export class ContentPackCompiler {

    /** @returns {string|null} Compendium sidebar folder id for Ionrift > Respite. */
    static findRespiteCompendiumFolderId() {
        return this._findRespiteFolderId();
    }

    /**
     * Ensure Ionrift > Respite > Released Packs or Incubating (Unreleased)
     * exists and return its folder id.
     * @param {{ incubating?: boolean }} [options]
     * @returns {Promise<string|null>}
     */
    static async ensureRespiteOverlayFolderId({ incubating = false } = {}) {
        const respiteFolderId = await this._ensureRespiteRootFolderId();
        if (!respiteFolderId) return null;

        const folderKey = incubating ? "incubating" : "released";
        const folderName = incubating ? "Incubating (Unreleased)" : "Released Packs";
        const color = incubating ? "#b45309" : "#15803d";

        const parentId = (f) => {
            const p = f?.folder;
            if (!p) return null;
            return typeof p === "string" ? p : (p?.id ?? null);
        };

        const seen = new Set();
        const allFolders = [
            ...game.folders.filter(f => f.type === "Compendium"),
            ...(game.packs?.folders?.filter(f => f.type === "Compendium") ?? [])
        ].filter(f => seen.has(f.id) ? false : seen.add(f.id));

        const existing = allFolders.find(f => {
            if (parentId(f) !== respiteFolderId) return false;
            const flagKey = f.getFlag ? f.getFlag(MODULE_ID, "folderKey") : f.flags?.[MODULE_ID]?.folderKey;
            return flagKey === folderKey || f.name === folderName;
        });
        if (existing) return existing.id;

        try {
            const created = await Folder.create({
                name: folderName,
                type: "Compendium",
                folder: respiteFolderId,
                color,
                sorting: "a",
                flags: { [MODULE_ID]: { folderKey } }
            });
            return created.id;
        } catch {
            return respiteFolderId;
        }
    }

    static async _ensureRespiteRootFolderId() {
        const existingId = this._findRespiteFolderId();
        if (existingId) return existingId;

        const parentId = (f) => {
            const p = f?.folder;
            if (!p) return null;
            return typeof p === "string" ? p : (p?.id ?? null);
        };

        try {
            let ionrift = game.folders.find(f => f.type === "Compendium" && f.name === "Ionrift" && !parentId(f));
            if (!ionrift) {
                ionrift = await Folder.create({
                    name: "Ionrift",
                    type: "Compendium",
                    color: "#8b5cf6",
                    sorting: "a"
                });
            }
            const respite = await Folder.create({
                name: "Respite",
                type: "Compendium",
                folder: ionrift.id,
                sorting: "a"
            });
            return respite.id;
        } catch {
            return null;
        }
    }

    static _findRespiteFolderId() {
        const cfg = game.settings.get("core", "compendiumConfiguration") ?? {};

        const parentId = (f) => {
            const p = f?.folder;
            if (!p) return null;
            return typeof p === "string" ? p : (p?.id ?? null);
        };

        // Try reference from a known Respite pack
        const refPackId = "ionrift-respite.respite-items";
        const fromRef = cfg[refPackId]?.folder;
        if (fromRef) {
            const f = game.folders.get(fromRef) ?? game.packs?.folders?.get?.(fromRef);
            if (f?.type === "Compendium" && f.name === "Respite") return fromRef;
        }

        // Walk folder tree: Ionrift > Respite
        const seen = new Set();
        const allFolders = [
            ...game.folders.filter(f => f.type === "Compendium"),
            ...(game.packs?.folders?.filter(f => f.type === "Compendium") ?? [])
        ].filter(f => seen.has(f.id) ? false : seen.add(f.id));

        const ionriftRoots = allFolders.filter(f => f.name === "Ionrift" && !parentId(f));
        for (const ion of ionriftRoots) {
            const respite = allFolders.find(f => f.name === "Respite" && parentId(f) === ion.id);
            if (respite) return respite.id;
        }
        return null;
    }
}
