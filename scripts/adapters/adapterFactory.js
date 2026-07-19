import { Logger } from "../utils/Logger.js";
import { DaggerheartAdapter } from "./concrete/narrative/DaggerheartAdapter.js";
import { DnD35eAdapter } from "./concrete/dnd/DnD35eAdapter.js";
import { DnD5eAdapter } from "./concrete/dnd/DnD5eAdapter.js";
import { OSEAdapter } from "./concrete/dnd/OSEAdapter.js";
import { PF1eAdapter } from "./concrete/pathfinder/PF1eAdapter.js";
import { PF2eAdapter } from "./concrete/pathfinder/PF2eAdapter.js";
import { SFRPGAdapter } from "./concrete/pathfinder/SFRPGAdapter.js";
import { MODULE_ID } from "../data/moduleId.js";

let pf1RestHookRegistered = false;

const ADAPTER_BY_SYSTEM = {
    dnd5e: DnD5eAdapter,
    pf2e: PF2eAdapter,
    daggerheart: DaggerheartAdapter,
    sfrpg: SFRPGAdapter,
    pf1: PF1eAdapter,
    D35E: DnD35eAdapter,
    ose: OSEAdapter
};

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
 * Called once during module init. Stored on game.ionrift.respite.adapter.
 * @returns {SystemAdapter}
 */
export function createAdapter() {
    const systemId = game.system?.id ?? "unknown";
    const AdapterClass = ADAPTER_BY_SYSTEM[systemId] ?? DnD5eAdapter;

    if (systemId === "pf1" || systemId === "D35E") {
        registerPf1RestHook();
    }

    if (!ADAPTER_BY_SYSTEM[systemId]) {
        console.warn(`${MODULE_ID} | Unknown system "${systemId}", falling back to DnD5e adapter`);
    } else if (systemId === "daggerheart") {
        console.warn(`${MODULE_ID} | System adapter: Daggerheart (stub, limited support)`);
    } else if (systemId === "pf2e") {
        Logger.log(`${MODULE_ID} | System adapter: PF2e (early support)`);
    } else {
        Logger.log(`${MODULE_ID} | System adapter: ${AdapterClass.name.replace(/Adapter$/, "")}`);
    }

    return new AdapterClass();
}
