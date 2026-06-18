import { Logger } from "../lib/Logger.js";
import { ForageTableSync } from "./ForageTableSync.js";

/**
 * ForageTableInstaller
 * Bootstraps and resets Respite forage RollTables (compendium-driven via ForageTableSync).
 */

const MODULE_ID = "ionrift-respite";

export class ForageTableInstaller {

    /**
     * Ensures forage RollTables exist and match compendium folders. GM-only.
     */
    static async install() {
        if (!game.user.isGM) return;
        await ForageTableSync.syncAll();
        Logger.log("Forage table install/sync complete.");
    }

    /**
     * Deletes all Respite forage tables and rebuilds from compendium. GM-only.
     */
    static async resetToDefaults() {
        if (!game.user.isGM) return;

        const existing = game.tables.filter(table =>
            table.flags?.[MODULE_ID]?.isForageTable
            || table.flags?.[MODULE_ID]?.isCampFuelTable
        );
        for (const table of existing) {
            await table.delete();
            Logger.log(`Deleted roll table: ${table.name}`);
        }

        await ForageTableSync.syncAll({ notify: true });
        ui.notifications.info("Respite: Rebuilt forage and camp fuel roll tables from compendium folders.");
        Logger.log("Forage table reset complete.");
    }
}
