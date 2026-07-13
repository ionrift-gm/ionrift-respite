import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const professionPluginUrl = new URL("../fixtures/profession-plugin.mjs", import.meta.url).href;

let OverlayProfessionPluginLoader;
let hasOverlayProfessionPlugin;
let getProfessionPlugin;
let _resetProfessionPluginsForTests;

beforeEach(async () => {
    vi.resetModules();

    globalThis.game = {
        ionrift: {
            library: {
                createLogger: () => ({
                    log() {},
                    info() {},
                    warn() {},
                    error() {}
                }),
                overlay: null,
                platform: null
            }
        }
    };
    globalThis.Hooks = {
        on: vi.fn(),
        callAll: vi.fn()
    };

    ({ OverlayProfessionPluginLoader, hasOverlayProfessionPlugin } = await import("../../services/OverlayProfessionPluginLoader.js"));
    ({ getProfessionPlugin, _resetProfessionPluginsForTests } = await import("../../services/ProfessionPluginRegistry.js"));
    _resetProfessionPluginsForTests();
});

afterEach(() => {
    _resetProfessionPluginsForTests();
    delete globalThis.game;
    delete globalThis.Hooks;
});

describe("OverlayProfessionPluginLoader", () => {
    it("resolves profession plugin import path through platform API", async () => {
        const overlay = {
            getLocalManifest: vi.fn().mockResolvedValue({ overlayId: "overlay-1" }),
            isOverlayActive: vi.fn().mockResolvedValue(true),
            readFileIndex: vi.fn().mockResolvedValue(["plugins/profession.mjs"])
        };
        const resolveAssetUrl = vi.fn().mockResolvedValue(professionPluginUrl);
        game.ionrift.library.overlay = overlay;
        game.ionrift.library.platform = { resolveAssetUrl };

        await OverlayProfessionPluginLoader._loadSublayer("core");

        expect(resolveAssetUrl).toHaveBeenCalledWith(
            "ionrift-data/overlays/ionrift-respite/core/plugins/profession.mjs"
        );
        expect(getProfessionPlugin("fixture-profession-plugin")).toBeTruthy();
        expect(Hooks.callAll).toHaveBeenCalledWith("ionrift.professionPluginsChanged");
    });

    it("falls back to listOverlayDir when readFileIndex is unavailable", async () => {
        const overlay = {
            listOverlayDir: vi.fn().mockResolvedValue({ files: ["profession.mjs"] })
        };

        await expect(hasOverlayProfessionPlugin(overlay, "fallback")).resolves.toBe(true);
        expect(overlay.listOverlayDir).toHaveBeenCalledWith("ionrift-respite", "fallback", "plugins");
    });
});
