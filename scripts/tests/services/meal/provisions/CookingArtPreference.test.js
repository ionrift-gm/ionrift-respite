import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
    __setPackArtPresentForTests,
    COOKING_ART_DEFAULT,
    COOKING_ART_OVERLAY_ID,
    COOKING_ART_PACK,
    CookingArtPreference
} from "../../../../services/meal/provisions/CookingArtPreference.js";

const COOKING_ROOT = "ionrift-data/overlays/ionrift-respite/cooking-art/assets/icons/cooking";
const FORAGE_ROOT = "ionrift-data/overlays/ionrift-respite/cooking-art/assets/icons/forage";

describe("CookingArtPreference", () => {
    beforeEach(() => {
        __setPackArtPresentForTests(false);
        delete globalThis.game;
        delete globalThis.foundry;
        delete globalThis.FilePicker;
    });

    afterEach(() => {
        __setPackArtPresentForTests(false);
        delete globalThis.game;
        delete globalThis.foundry;
        delete globalThis.FilePicker;
    });

    it("returns default value until pack art is detected", () => {
        expect(CookingArtPreference.value).toBe(COOKING_ART_DEFAULT);
        __setPackArtPresentForTests(true);
        expect(CookingArtPreference.value).toBe(COOKING_ART_PACK);
    });

    it("resolves pack art paths for recipe and forage items", () => {
        const recipeItem = { flags: { "ionrift-respite": { recipeId: "cook_fortified_rations" } } };
        const forageItem = { name: "Bird Eggs" };
        const unknownItem = { name: "Unknown Root" };

        expect(CookingArtPreference.packArtPath(recipeItem))
            .toBe(`${COOKING_ROOT}/fortified-rations.webp`);
        expect(CookingArtPreference.packArtPath(forageItem))
            .toBe(`${FORAGE_ROOT}/bird-eggs.webp`);
        expect(CookingArtPreference.packArtPath(unknownItem)).toBeNull();
    });

    it("applies cooking pack art to recipe outputs when pack art is present", () => {
        __setPackArtPresentForTests(true);
        const data = {
            recipes: {
                basic: [
                    {
                        id: "cook_fortified_rations",
                        output: { img: "default-output.webp" },
                        ambitiousOutput: { img: "default-ambitious.webp" }
                    },
                    {
                        id: "non_mapped_recipe",
                        output: { img: "keep-me.webp" }
                    }
                ]
            }
        };

        const result = CookingArtPreference.applyToRecipeData(data);

        expect(result).toBe(data);
        expect(data.recipes.basic[0].output.img)
            .toBe(`${COOKING_ROOT}/fortified-rations.webp`);
        expect(data.recipes.basic[0].ambitiousOutput.img)
            .toBe(`${COOKING_ROOT}/fortified-rations.webp`);
        expect(data.recipes.basic[1].output.img).toBe("keep-me.webp");
    });

    it("does not rewrite recipe outputs when pack art is not present", () => {
        __setPackArtPresentForTests(false);
        const data = {
            recipes: {
                basic: [
                    {
                        id: "cook_fortified_rations",
                        output: { img: "default-output.webp" }
                    }
                ]
            }
        };

        CookingArtPreference.applyToRecipeData(data);

        expect(data.recipes.basic[0].output.img).toBe("default-output.webp");
    });

    it("detects pack art when annex manifest reports cooking art overlay", async () => {
        const getLocalManifest = vi.fn().mockResolvedValue({ overlayId: COOKING_ART_OVERLAY_ID });
        globalThis.game = {
            ionrift: {
                annex: { overlay: { getLocalManifest } }
            }
        };

        await expect(CookingArtPreference.detectPackArtPresent()).resolves.toBe(true);
        expect(getLocalManifest).toHaveBeenCalledWith("ionrift-respite", "cooking-art");
    });

    it("falls back to browse probe when annex manifest is missing", async () => {
        const browse = vi.fn().mockResolvedValue({
            files: ["ionrift-data/overlays/ionrift-respite/cooking-art/overlay-manifest.json"]
        });
        globalThis.game = {
            ionrift: {
                annex: { overlay: { getLocalManifest: vi.fn().mockResolvedValue(null) } },
                library: { PlatformHelper: { FP: { browse } } }
            }
        };

        await expect(CookingArtPreference.detectPackArtPresent()).resolves.toBe(true);
        expect(browse).toHaveBeenCalledWith(
            "data",
            "ionrift-data/overlays/ionrift-respite/cooking-art"
        );
    });

    it("returns false when neither annex manifest nor browse probe is available", async () => {
        globalThis.game = {
            ionrift: {
                annex: { overlay: { getLocalManifest: vi.fn().mockResolvedValue(null) } },
                library: { PlatformHelper: { FP: {} } }
            }
        };

        await expect(CookingArtPreference.detectPackArtPresent()).resolves.toBe(false);
    });
});
