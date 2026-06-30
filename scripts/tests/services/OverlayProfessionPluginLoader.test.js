import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";

let hasOverlayProfessionPlugin;

beforeAll(async () => {
    globalThis.game = {
        ionrift: {
            library: {
                createLogger: () => ({
                    log() {},
                    info() {},
                    warn() {},
                    error() {}
                })
            }
        }
    };
    globalThis.Hooks = {
        on: vi.fn(),
        callAll: vi.fn()
    };

    ({ hasOverlayProfessionPlugin } = await import("../../services/OverlayProfessionPluginLoader.js"));
});

afterAll(() => {
    delete globalThis.game;
    delete globalThis.Hooks;
});

describe("hasOverlayProfessionPlugin", () => {
    it("returns true when readFileIndex includes plugins/profession.mjs", async () => {
        const overlay = {
            readFileIndex: vi.fn().mockResolvedValue(["plugins/profession.mjs"])
        };

        await expect(hasOverlayProfessionPlugin(overlay, "homebrew")).resolves.toBe(true);
        expect(overlay.readFileIndex).toHaveBeenCalledWith("ionrift-respite", "homebrew");
    });

    it("returns false when readFileIndex has no profession plugin path", async () => {
        const overlay = {
            readFileIndex: vi.fn().mockResolvedValue(["plugins/other.mjs"]),
            listOverlayDir: vi.fn()
        };

        await expect(hasOverlayProfessionPlugin(overlay, "homebrew")).resolves.toBe(false);
        expect(overlay.readFileIndex).toHaveBeenCalledWith("ionrift-respite", "homebrew");
        expect(overlay.listOverlayDir).not.toHaveBeenCalled();
    });

    it("falls back to listOverlayDir when readFileIndex is unavailable", async () => {
        const overlay = {
            listOverlayDir: vi.fn().mockResolvedValue({ files: ["profession.mjs", "other.mjs"] })
        };

        await expect(hasOverlayProfessionPlugin(overlay, "overlay-a")).resolves.toBe(true);
        expect(overlay.listOverlayDir).toHaveBeenCalledWith("ionrift-respite", "overlay-a", "plugins");
    });

    it("returns false when listOverlayDir fallback throws", async () => {
        const overlay = {
            listOverlayDir: vi.fn().mockRejectedValue(new Error("missing directory"))
        };

        await expect(hasOverlayProfessionPlugin(overlay, "overlay-b")).resolves.toBe(false);
        expect(overlay.listOverlayDir).toHaveBeenCalledWith("ionrift-respite", "overlay-b", "plugins");
    });
});
