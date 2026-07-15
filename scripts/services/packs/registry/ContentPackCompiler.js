/**
 * ContentPackCompiler
 *
 * Provides sidebar folder lookup for Ionrift / Respite compendium structure.
 */

export class ContentPackCompiler {

    /** @returns {string|null} Compendium sidebar folder id for Ionrift > Respite. */
    static findRespiteCompendiumFolderId() {
        return this._findRespiteFolderId();
    }

    static _findRespiteFolderId() {
        const cfg = game.settings.get("core", "compendiumConfiguration") ?? {};

        // Try reference from a known Respite pack
        const refPackId = "ionrift-respite.respite-items";
        const fromRef = cfg[refPackId]?.folder;
        if (fromRef) {
            const f = game.folders.get(fromRef);
            if (f?.type === "Compendium" && f.name === "Respite") return fromRef;
        }

        // Walk folder tree: Ionrift > Respite
        const ionriftRoots = game.folders.filter(f =>
            f.type === "Compendium" && f.name === "Ionrift" && !f.folder
        );
        for (const ion of ionriftRoots) {
            const respite = game.folders.find(f =>
                f.type === "Compendium" && f.name === "Respite" && f.folder === ion.id
            );
            if (respite) return respite.id;
        }
        return null;
    }
}
