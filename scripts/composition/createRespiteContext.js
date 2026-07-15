import { createAdapter } from "../adapters/adapterFactory.js";
import { RestFlowEngine } from "../services/rest/flow/RestFlowEngine.js";
import { ActivityResolver } from "../services/rest/flow/ActivityResolver.js";
import { EventResolver } from "../services/events/resolve/EventResolver.js";
import { ResourcePoolRoller } from "../services/rest/recovery/ResourcePoolRoller.js";
import { TerrainRegistry } from "../services/events/resolve/TerrainRegistry.js";
import { RestSetupApp } from "../apps/rest/RestSetupApp.js";
import { TorchTokenLinker } from "../services/camp/props/TorchTokenLinker.js";
import {
    placeTorch,
    placePerimeter,
    clearTorches,
    toggleTorches,
    placeCampfire,
    placeCamp
} from "../services/camp/props/CampPropPlacer.js";
import { clearCampTokens, resetCampSession } from "../services/camp/props/CompoundCampPlacer.js";
import { PackRegistryApp } from "../apps/packs/PackRegistryApp.js";
import { ItemClassifier } from "../services/party/ItemClassifier.js";
import { DietConfigApp } from "../apps/meal/DietConfigApp.js";
import {
    setDetectMagicInventoryGlowAdapter,
    getDetectMagicInventoryGlowAdapter
} from "../services/crafting/detectMagic/DetectMagicInventoryGlowBridge.js";
import { emitForceReload } from "../services/socket/SocketController.js";
import {
    buildRollRequestContext,
    buildEventPlayerRollContext,
    buildEventGmRollContext,
    buildTreePlayerRollContext,
    buildCampActivityRollContext,
    buildTravelActivityRollContext,
    buildCopySpellRollContext,
    buildMockRollRequestContext,
    buildRollParticipants,
    buildRollTargetLabel,
    sortRollParticipants,
    layoutRollParticipants,
    findPreviewPlayerActor,
    centerRollRequestRoster,
    ROLL_REQUEST_PREVIEW_VARIANTS
} from "../services/ui/rollRequest/RollRequestView.js";
import {
    ensureDcPulseAnimation,
    inspectDcAnimation,
    watchDcAnimation,
    forceDcPulseTest
} from "../services/ui/rollRequest/RollRequestDcPulse.js";
import { RollRequestPreviewApp } from "../apps/events/RollRequestPreviewApp.js";
import { Logger as RespiteLog } from "../utils/Logger.js";
import { MODULE_ID } from "../data/moduleId.js";

/**
 * Wire the public Respite bag. `runtime` is mutable boot state owned by module.js.
 */
export function createRespiteContext(runtime) {
    const adapter = createAdapter();
    const api = {
        adapter,
        rollRequest: {
            buildContext: buildRollRequestContext,
            buildEventPlayerContext: buildEventPlayerRollContext,
            buildEventGmContext: buildEventGmRollContext,
            buildTreePlayerContext: buildTreePlayerRollContext,
            buildCampActivityContext: buildCampActivityRollContext,
            buildTravelActivityContext: buildTravelActivityRollContext,
            buildCopySpellContext: buildCopySpellRollContext,
            buildParticipants: buildRollParticipants,
            sortParticipants: sortRollParticipants,
            layoutParticipants: layoutRollParticipants,
            centerRoster: centerRollRequestRoster,
            findPreviewPlayerActor,
            buildTargetLabel: buildRollTargetLabel,
            buildMockContext: buildMockRollRequestContext,
            variants: ROLL_REQUEST_PREVIEW_VARIANTS,
            partial: "rollRequest",
            openPreview: (options) => RollRequestPreviewApp.open(options),
            ensureDcPulse: ensureDcPulseAnimation,
            debugAnimation: inspectDcAnimation,
            watchAnimation: watchDcAnimation,
            forceDcPulseTest,
            request: (opts) => game.ionrift?.library?.rollRequest?.request?.(opts),
            requestDetached: (opts, callback) => game.ionrift?.library?.rollRequest?.requestDetached?.(opts, callback)
        },
        RestFlowEngine,
        ActivityResolver,
        EventResolver,
        ResourcePoolRoller,
        openRestSetup: () => {
            if (!game.user.isGM) return;
            new RestSetupApp().render({ force: true });
        },
        openPlayerGuide: async (pageId) => {
            const GUIDE_PAGES = {
                player: "aQc3PtQPrYDi9Mlx",
                gm: "dvr4TYdYmX88MCCf",
                cooking: "cK8pRQdW2nFb4Xvj",
                training: "mN8kTrXpGmRef001",
            };
            const GUIDE_JOURNALS = {
                player: "1Zh2gDQ1xOLFUrhW",
                gm: "hG4mR3fRespGuide01",
            };

            const isGM = game.user?.isGM;
            let packName;
            let journalId;
            let focusPageId;

            if (!isGM) {
                packName = `${MODULE_ID}.respite-guide`;
                journalId = GUIDE_JOURNALS.player;
                focusPageId = pageId === GUIDE_PAGES.cooking
                    ? GUIDE_PAGES.cooking
                    : GUIDE_PAGES.player;
            } else if (!pageId || pageId === GUIDE_PAGES.gm || pageId === GUIDE_PAGES.training) {
                packName = `${MODULE_ID}.respite-guide-gm`;
                journalId = GUIDE_JOURNALS.gm;
                focusPageId = pageId === GUIDE_PAGES.training ? GUIDE_PAGES.training : GUIDE_PAGES.gm;
            } else {
                packName = `${MODULE_ID}.respite-guide`;
                journalId = GUIDE_JOURNALS.player;
                focusPageId = pageId;
            }

            const pack = game.packs.get(packName);
            if (!pack) {
                ui.notifications?.warn("Respite: guide compendium not available.");
                return;
            }
            try {
                const journal = await pack.getDocument(journalId);
                if (!journal) {
                    ui.notifications?.warn("Respite: guide journal not found in compendium.");
                    return;
                }
                const opts = focusPageId ? { pageId: focusPageId } : {};
                journal.sheet.render(true, opts);
            } catch (e) {
                console.warn(`${MODULE_ID} | Failed to open player guide:`, e);
                ui.notifications?.error("Respite: failed to open the player guide. See console.");
            }
        },
        forceEncounter: () => {
            if (!game.user.isGM) return;
            if (!runtime.activeRestSetupApp) {
                console.warn(`${MODULE_ID} | No active rest. Start a rest first.`);
                return;
            }
            runtime.activeRestSetupApp._forceEncounter = true;
            ui.notifications.info("Next event roll will force an encounter.");
        },
        getActiveApp: () => runtime.activeRestSetupApp,
        runTests: async () => {
            if (!game.user.isGM) { console.warn(`${MODULE_ID} | Tests are GM-only.`); return; }
            try {
                const probe = await fetch(`modules/${MODULE_ID}/scripts/tests/RespiteTestRunner.js`, { method: "HEAD" });
                if (!probe.ok) { console.warn(`${MODULE_ID} | Test suite not found. Tests are dev-only and not included in release builds.`); return; }
                const { RespiteTestRunner } = await import("../tests/RespiteTestRunner.js");
                const runner = new RespiteTestRunner();
                return await runner.runAll();
            } catch (e) {
                console.warn(`${MODULE_ID} | Failed to load test suite:`, e.message);
            }
        },
        runShortRestE2E: async () => {
            if (!game.user.isGM) { console.warn(`${MODULE_ID} | Tests are GM-only.`); return; }
            try {
                const probe = await fetch(`modules/${MODULE_ID}/scripts/tests/RespiteTestRunner.js`, { method: "HEAD" });
                if (!probe.ok) { console.warn(`${MODULE_ID} | Test suite not found (dev-only, not in releases).`); return; }
                const { RespiteTestRunner } = await import("../tests/RespiteTestRunner.js");
                const runner = new RespiteTestRunner();
                return await runner.runShortRestE2E();
            } catch (e) {
                console.warn(`${MODULE_ID} | Failed to load test suite:`, e.message);
            }
        },
        runShortRestPersistenceTests: async () => {
            if (!game.user.isGM) { console.warn(`${MODULE_ID} | Tests are GM-only.`); return; }
            try {
                const probe = await fetch(`modules/${MODULE_ID}/scripts/tests/RespiteTestRunner.js`, { method: "HEAD" });
                if (!probe.ok) { console.warn(`${MODULE_ID} | Test suite not found (dev-only, not in releases).`); return; }
                const { RespiteTestRunner } = await import("../tests/RespiteTestRunner.js");
                const runner = new RespiteTestRunner();
                return await runner.runShortRestPersistence();
            } catch (e) {
                console.warn(`${MODULE_ID} | Failed to load test suite:`, e.message);
            }
        },
        reloadAll: () => {
            if (!game.user.isGM) return;
            emitForceReload();
            RespiteLog.log(`${MODULE_ID} | Sent forceReload to all clients. GM reloading in 500ms...`);
            setTimeout(() => window.location.reload(), 500);
        },
        addSupplies: (qty = 50) => RestSetupApp._debugAddSupplies(qty),
        setDetectMagicInventoryGlowAdapter,
        getDetectMagicInventoryGlowAdapter,
        packStatus: async () => {
            if (!game.user.isGM) return;
            await TerrainRegistry.init();
            const coreTerrains = new Set(["forest", "swamp", "desert", "urban", "dungeon", "tavern"]);
            const results = {};
            for (const t of TerrainRegistry.getAvailableIds()) {
                if (coreTerrains.has(t)) continue;
                try {
                    const resp = await fetch(`modules/${MODULE_ID}/data/terrains/${t}/events.json?t=${Date.now()}`);
                    results[t] = resp.ok ? "LINKED" : "MISSING";
                } catch { results[t] = "MISSING"; }
            }
            RespiteLog.log(results);
            return results;
        },
        linkPacks: async () => {
            if (!game.user.isGM) return;
            const file = new File(["LINK_PACKS"], "cmd.txt", { type: "text/plain" });
            const FP = game.ionrift?.library?.platform?.FP ?? FilePicker;
            await FP.upload("data", "ionrift_debug", file, { notify: false });
            ui.notifications.info("LINK_PACKS command sent. Waiting for DevTools to execute...");
        },
        unlinkPacks: async () => {
            if (!game.user.isGM) return;
            const file = new File(["UNLINK_PACKS"], "cmd.txt", { type: "text/plain" });
            const FP = game.ionrift?.library?.platform?.FP ?? FilePicker;
            await FP.upload("data", "ionrift_debug", file, { notify: false });
            ui.notifications.info("UNLINK_PACKS command sent. Waiting for DevTools to execute...");
        },
        resetFlowState: async () => {
            if (!game.user.isGM) { console.warn(`${MODULE_ID} | resetFlowState is GM-only.`); return; }
            runtime.respiteFlowActive = false;
            runtime.activeRestSetupApp = null;
            runtime.activeRestData = null;
            runtime.activeShortRestApp = null;
            runtime.hideAfkPanel();
            try {
                const removed = await clearCampTokens();
                if (removed > 0) {
                    RespiteLog.log(`${MODULE_ID} | resetFlowState removed ${removed} camp or torch token(s) from the active scene.`);
                }
            } catch (e) {
                console.warn(`${MODULE_ID} | resetFlowState camp cleanup failed:`, e);
            } finally {
                resetCampSession();
            }
            await game.settings.set(MODULE_ID, "activeRest", {});
            await game.settings.set(MODULE_ID, "activeShortRest", {});
            await game.settings.set(MODULE_ID, "lastRestDate", "");
            emitForceReload();
            ui.notifications.info("Rest state cleared. Reloading...");
            setTimeout(() => window.location.reload(), 500);
        },
        getItemEnrichment: (itemName) => game.ionrift?.library?.enrichment?.get(itemName) ?? null,
        getEnrichmentNames: () => game.ionrift?.library?.enrichment?.getRegisteredNames() ?? [],
        ItemClassifier,
        DietConfigApp,
        openDietConfig: (actorId) => {
            if (!game.user.isGM) return;
            new DietConfigApp(actorId ? { actorId } : {}).render({ force: true });
        },
        classifyItem: (item) => ItemClassifier.classify(item),
        getDiet: (actor) => ItemClassifier.getDiet(actor),
        setDiet: (actor, diet) => ItemClassifier.setDiet(actor, diet),
        applyDietPreset: (actor, presetId) => ItemClassifier.applyPreset(actor, presetId),
        getDietPresets: () => ItemClassifier.getPresets(),
        openLedger: () => {
            if (!game.user.isGM) return;
            if (!runtime.activeRestSetupApp) {
                console.warn(`${MODULE_ID} | No active rest. Start a rest first.`);
                return;
            }
            runtime.activeRestSetupApp.openLedgerPanel?.();
        },
        placeCampfire,
        placeTorch,
        placePerimeter,
        placeCamp,
        clearTorches,
        toggleTorches,
        TorchTokenLinker,
        syncForageTables: async () => {
            if (!game.user.isGM) {
                console.warn(`${MODULE_ID} | syncForageTables is GM-only.`);
                return null;
            }
            const { ForageTableSync } = await import("../services/travel/forage/ForageTableSync.js");
            return await ForageTableSync.syncAll({ notify: true });
        },
        lockRollTables: async () => {
            if (!game.user.isGM) {
                console.warn(`${MODULE_ID} | lockRollTables is GM-only.`);
                return null;
            }
            const { ForageTableSync } = await import("../services/travel/forage/ForageTableSync.js");
            const result = await ForageTableSync.lockDownRollTableVisibility();
            ui.notifications.info(
                `Respite: Locked ${result.tables} roll table(s) and ${result.folders} folder(s) to GM-only.`
            );
            return result;
        },
        get isRestActive() { return runtime.respiteFlowActive; },
        PackRegistryApp
    };

    exposeRespiteApi(api);
    return api;
}

export function exposeRespiteApi(api) {
    game.ionrift = game.ionrift || {};
    game.ionrift.respite = api;
}

export function getRespiteApi() {
    return game.ionrift?.respite ?? null;
}
