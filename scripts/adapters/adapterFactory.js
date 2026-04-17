import { DnD5eAdapter } from "./DnD5eAdapter.js";
import { PF2eAdapter } from "./PF2eAdapter.js";
import { DaggerheartAdapter } from "./DaggerheartAdapter.js";

const MODULE_ID = "ionrift-respite";

/**
 * Auto-detect the active game system and return the appropriate adapter.
 *
 * Called once during module init. The adapter is stored globally on
 * game.ionrift.respite.adapter for all services to reference.
 *
 * @returns {SystemAdapter}
 */
export function createAdapter() {
    const systemId = game.system?.id ?? "unknown";

    switch (systemId) {
        case "dnd5e":
            console.log(`${MODULE_ID} | System adapter: DnD5e`);
            return new DnD5eAdapter();

        case "pf2e":
            console.log(`${MODULE_ID} | System adapter: PF2e (early support)`);
            return new PF2eAdapter();

        case "daggerheart":
            console.warn(`${MODULE_ID} | System adapter: Daggerheart (stub – limited support)`);
            return new DaggerheartAdapter();

        default:
            console.warn(`${MODULE_ID} | Unknown system "${systemId}", falling back to DnD5e adapter`);
            return new DnD5eAdapter();
    }
}
