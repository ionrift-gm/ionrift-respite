import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mealBuffHandlerUrl = new URL("../fixtures/meal-buff-handler.mjs", import.meta.url).href;

let OverlayMealBuffHandlerLoader;
let getMealBuffHandler;
let _resetMealBuffHandlersForTests;

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

    ({ OverlayMealBuffHandlerLoader } = await import("../../services/OverlayMealBuffHandlerLoader.js"));
    ({ getMealBuffHandler, _resetMealBuffHandlersForTests } = await import("../../services/MealBuffHandlerRegistry.js"));
    _resetMealBuffHandlersForTests();
});

afterEach(() => {
    _resetMealBuffHandlersForTests();
    delete globalThis.game;
    delete globalThis.Hooks;
});

describe("OverlayMealBuffHandlerLoader", () => {
    it("resolves handler import paths through platform API", async () => {
        const overlay = {
            getLocalManifest: vi.fn().mockResolvedValue({ overlayId: "overlay-2" }),
            isOverlayActive: vi.fn().mockResolvedValue(true),
            readFileIndex: vi.fn().mockResolvedValue([
                "plugins/meal-buffs/handlers/fixture-meal-buff-handler.mjs",
                "plugins/meal-buffs/handlers/_private.mjs"
            ])
        };
        const resolveAssetUrl = vi.fn().mockResolvedValue(mealBuffHandlerUrl);
        game.ionrift.library.overlay = overlay;
        game.ionrift.library.platform = { resolveAssetUrl };

        await OverlayMealBuffHandlerLoader._loadSublayer("core");

        expect(resolveAssetUrl).toHaveBeenCalledWith(
            "ionrift-data/overlays/ionrift-respite/core/plugins/meal-buffs/handlers/fixture-meal-buff-handler.mjs"
        );
        expect(getMealBuffHandler("fixture-meal-buff-handler")).toBeTruthy();
        expect(Hooks.callAll).toHaveBeenCalledWith("ionrift.mealBuffHandlersChanged");
    });

    it("discovers unique handler names and skips private files", async () => {
        const overlay = {
            readFileIndex: vi.fn().mockResolvedValue([
                "plugins/meal-buffs/handlers/alpha.mjs",
                "plugins/meal-buffs/handlers/_internal.mjs",
                "plugins/meal-buffs/handlers/alpha.js",
                "plugins/meal-buffs/handlers/beta.js"
            ])
        };

        const names = await OverlayMealBuffHandlerLoader._discoverHandlerNames(overlay, "core");
        expect(names.sort()).toEqual(["alpha", "beta"]);
    });
});
