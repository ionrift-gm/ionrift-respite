import { Logger } from "../utils/Logger.js";
import { DaggerheartAdapter } from "./DaggerheartAdapter.js";
import { DnD35eAdapter } from "./DnD35eAdapter.js";
import { DnD5eAdapter } from "./DnD5eAdapter.js";
import { OSEAdapter } from "./OSEAdapter.js";
import { PF1eAdapter } from "./PF1eAdapter.js";
import { PF2eAdapter } from "./PF2eAdapter.js";
import { SFRPGAdapter } from "./SFRPGAdapter.js";

const MODULE_ID = "ionrift-respite";

let pf1RestHookRegistered = false;

/**
 * Suppress PF1-family default HP/HD recovery when Respite manages recovery.
 * Registered once when a pf1 or D35E adapter is active.
 */
function registerPf1RestHook() {
    if (pf1RestHookRegistered) return;
    pf1RestHookRegistered = true;

    Hooks.on("pf1PreActorRest", (_actor, _restOptions, updateData, itemUpdates) => {
        if (!game.ionrift?.respite?.isRestActive) return;
        const adapter = game.ionrift?.respite?.adapter;
        if (!adapter?.suppressDefaultRecovery) return;
        adapter.suppressDefaultRecovery({ updateData, updateItems: itemUpdates, itemUpdates });
    });
}

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
            Logger.log(`${MODULE_ID} | System adapter: DnD5e`);
            return new DnD5eAdapter();

        case "pf2e":
            Logger.log(`${MODULE_ID} | System adapter: PF2e (early support)`);
            return new PF2eAdapter();

        case "daggerheart":
            console.warn(`${MODULE_ID} | System adapter: Daggerheart (stub, limited support)`);
            return new DaggerheartAdapter();

        case "sfrpg":
            Logger.log(`${MODULE_ID} | System adapter: SFRPG`);
            return new SFRPGAdapter();

        case "pf1":
            Logger.log(`${MODULE_ID} | System adapter: PF1e`);
            registerPf1RestHook();
            return new PF1eAdapter();

        case "D35E":
            Logger.log(`${MODULE_ID} | System adapter: D35E`);
            registerPf1RestHook();
            return new DnD35eAdapter();

        case "ose":
            Logger.log(`${MODULE_ID} | System adapter: OSE`);
            return new OSEAdapter();

        default:
            console.warn(`${MODULE_ID} | Unknown system "${systemId}", falling back to DnD5e adapter`);
            return new DnD5eAdapter();
    }
}
