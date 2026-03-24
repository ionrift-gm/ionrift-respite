import { Logger } from "../lib/Logger.js";

/**
 * ForageTableInstaller
 * Seeds Foundry RollTables from resource_pools.json on startup.
 * Tables live in an "Ionrift / Respite" nested folder hierarchy.
 * Existing tables are left alone so GM edits are preserved.
 * New terrains are additive. A "Reset Forage Tables" option
 * allows GMs to reassert defaults.
 */

const MODULE_ID = "ionrift-respite";
const PARENT_FOLDER = "Ionrift";
const CHILD_FOLDER = "Respite";
const TABLE_PREFIX = "Respite: Forage";

export class ForageTableInstaller {

    /**
     * Installs forage RollTables from the shipped JSON pool data.
     * GM-only. Skips tables that already exist.
     */
    static async install() {
        if (!game.user.isGM) return;

        const pools = await this._loadPools();
        if (!pools) return;

        const folder = await this._ensureFolder();

        let installed = 0;
        for (const pool of pools) {
            const tableName = this._tableName(pool.terrainTag);

            // Skip if table already exists
            if (game.tables.find(t => t.name === tableName)) continue;

            await this._createTable(pool, tableName, folder.id);
            installed++;
            Logger.log(`Installed forage table: ${tableName}`);
        }

        if (installed > 0) {
            Logger.log(`Forage table installation complete. ${installed} tables created.`);
        }
    }

    /**
     * Reasserts all forage tables to defaults from JSON.
     * Deletes existing Respite forage tables and recreates them.
     * GM-only. Called from the settings menu.
     */
    static async resetToDefaults() {
        if (!game.user.isGM) return;

        const pools = await this._loadPools();
        if (!pools) return;

        // Delete existing forage tables
        const existing = game.tables.filter(t =>
            t.flags?.[MODULE_ID]?.isForageTable
        );
        for (const table of existing) {
            await table.delete();
            Logger.log(`Deleted forage table: ${table.name}`);
        }

        const folder = await this._ensureFolder();

        let installed = 0;
        for (const pool of pools) {
            const tableName = this._tableName(pool.terrainTag);
            await this._createTable(pool, tableName, folder.id);
            installed++;
            Logger.log(`Reinstalled forage table: ${tableName}`);
        }

        ui.notifications.info(`Respite: Reset ${installed} forage tables to defaults.`);
        Logger.log(`Forage table reset complete. ${installed} tables recreated.`);
    }

    /**
     * Builds a standardized table name from a terrain tag.
     */
    static _tableName(terrainTag) {
        const label = terrainTag.charAt(0).toUpperCase() + terrainTag.slice(1);
        return `${TABLE_PREFIX} (${label})`;
    }

    /**
     * Loads pool data from the shipped JSON.
     */
    static async _loadPools() {
        try {
            const resp = await fetch(`modules/${MODULE_ID}/data/core/forage/resource_pools.json`);
            return await resp.json();
        } catch (e) {
            console.error(`${MODULE_ID} | Failed to load resource_pools.json:`, e);
            return null;
        }
    }

    /**
     * Ensures the Ionrift / Respite nested folder hierarchy exists.
     * @returns {Folder} The child "Respite" folder.
     */
    static async _ensureFolder() {
        // Parent: "Ionrift" (root-level RollTable folder)
        let parent = game.folders.find(f =>
            f.name === PARENT_FOLDER && f.type === "RollTable" && !f.folder
        );
        if (!parent) {
            parent = await Folder.create({
                name: PARENT_FOLDER,
                type: "RollTable",
                parent: null
            });
            Logger.log(`Created RollTable folder: ${PARENT_FOLDER}`);
        }

        // Child: "Respite" under "Ionrift"
        // f.folder can be a Folder object, a string ID, or null depending on Foundry version/timing
        const parentId = parent.id ?? parent._id;
        let child = game.folders.find(f =>
            f.name === CHILD_FOLDER && f.type === "RollTable" &&
            (f.folder?.id === parentId || f.folder === parentId)
        );
        if (!child) {
            child = await Folder.create({
                name: CHILD_FOLDER,
                type: "RollTable",
                folder: parentId
            });
            Logger.log(`Created RollTable folder: ${PARENT_FOLDER}/${CHILD_FOLDER}`);
        }

        return child;
    }

    /**
     * Creates a single RollTable from a pool definition.
     */
    static async _createTable(pool, tableName, folderId) {
        const totalWeight = pool.entries.reduce((sum, e) => sum + (e.weight ?? 1), 0);
        const results = [];
        let rangeStart = 1;

        for (const entry of pool.entries) {
            const weight = entry.weight ?? 1;
            const rangeEnd = rangeStart + weight - 1;

            results.push({
                type: CONST.TABLE_RESULT_TYPES.TEXT,
                text: entry.itemRef,
                range: [rangeStart, rangeEnd],
                weight: weight,
                flags: {
                    [MODULE_ID]: {
                        itemData: entry.itemData ?? null,
                        quantity: entry.quantity ?? 1,
                        itemRef: entry.itemRef
                    }
                }
            });

            rangeStart = rangeEnd + 1;
        }

        await RollTable.create({
            name: tableName,
            description: pool.name,
            formula: `1d${totalWeight}`,
            replacement: true,
            displayRoll: false,
            folder: folderId,
            results,
            flags: {
                [MODULE_ID]: {
                    terrainTag: pool.terrainTag,
                    isForageTable: true
                }
            }
        });
    }
}
