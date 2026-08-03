import { MODULE_ID } from "../../../data/moduleId.js";

export const CRAFT_ART_DEFAULT = "default";
export const CRAFT_ART_PACK = "pack";
export const CRAFT_PROFESSIONS_OVERLAY_ID = "respite-craft-professions-overlay";
export const CRAFT_PROFESSIONS_ART_OVERLAY_ID = "respite-craft-professions-art-overlay";
export const CRAFT_PROFESSIONS_ART_SUBLAYER = "craft-professions-art";
export const CRAFT_PROFESSIONS_WORLD_PACK = "world.respite-craft-professions";

const CRAFT_ART_ROOT =
    `ionrift-data/overlays/${MODULE_ID}/${CRAFT_PROFESSIONS_ART_SUBLAYER}/assets/icons`;

/** Recipe id → stem under assets/icons/brewing/ */
const BREWING_ART_STEMS = Object.freeze({
    brew_calming_herb_tea: "calming-herb-tea",
    brew_alpine_focus_tea: "alpine-focus-tea",
    brew_moonpetal_tea: "moonpetal-tea",
    brew_desert_cooler: "desert-cooler",
    brew_sweetberry_cordial: "sweetberry-cordial",
    brew_trail_mead: "trail-mead",
    brew_firebrand_draught: "firebrand-draught",
    brew_frostbite_cordial: "frostbite-cordial"
});

/**
 * Foundry core icons baked into craft pack recipes.json.
 * Used when craft-professions-art is absent. Keep in sync with recipes.
 * Paths verified against a local Foundry static root (HTTP 200).
 */
export const BREWING_CORE_ICON_FALLBACKS = Object.freeze({
    brew_calming_herb_tea: "icons/consumables/drinks/tea-jug-gourd-brown.webp",
    brew_alpine_focus_tea: "icons/consumables/potions/potion-flask-corked-blue.webp",
    brew_moonpetal_tea: "icons/commodities/flowers/lotus-violet.webp",
    brew_desert_cooler: "icons/consumables/fruit/pickly-pear-cactus-red-yellow.webp",
    brew_sweetberry_cordial: "icons/consumables/food/preserves-jam-jelly-jar-brown-red.webp",
    brew_trail_mead: "icons/consumables/drinks/alcohol-beer-stein-wooden-brown.webp",
    brew_firebrand_draught: "icons/consumables/potions/potion-flask-corked-orange.webp",
    brew_frostbite_cordial: "icons/consumables/potions/bottle-round-corked-blue.webp"
});

/** Cached presence of optional craft-professions icon overlay files. */
let packArtPresent = false;

function itemFlags(item) {
    return item?.flags?.[MODULE_ID] ?? {};
}

function itemIdentity(item) {
    const flags = itemFlags(item);
    if (flags.recipeId) return `recipe:${flags.recipeId}`;
    if (flags.itemRef) return `item:${flags.itemRef}`;
    return null;
}

/**
 * Optional craft profession icons when files are present under
 * craft-professions-art. Presence-based; no world preference.
 */
export class CraftProfessionsArtPreference {

    static get value() {
        return packArtPresent ? CRAFT_ART_PACK : CRAFT_ART_DEFAULT;
    }

    static packArtPathForRecipeId(recipeId) {
        const brewStem = BREWING_ART_STEMS[recipeId];
        if (brewStem) return `${CRAFT_ART_ROOT}/brewing/${brewStem}.webp`;
        return null;
    }

    static packArtPath(item) {
        const flags = itemFlags(item);
        return this.packArtPathForRecipeId(flags.recipeId) ?? null;
    }

    static applyToRecipeData(data) {
        if (this.value !== CRAFT_ART_PACK || !data?.recipes) return data;
        for (const recipes of Object.values(data.recipes)) {
            if (!Array.isArray(recipes)) continue;
            for (const recipe of recipes) {
                const image = this.packArtPathForRecipeId(recipe.id);
                if (!image) continue;
                if (recipe.output) recipe.output.img = image;
                if (recipe.ambitiousOutput) recipe.ambitiousOutput.img = image;
            }
        }
        return data;
    }

    /**
     * True when the optional craft-professions-art overlay has a known icon.
     */
    static async detectPackArtPresent() {
        try {
            const browse = game.ionrift?.library?.PlatformHelper?.FP?.browse
                ?? globalThis.foundry?.applications?.apps?.FilePicker?.implementation?.browse
                ?? FilePicker?.browse;
            if (typeof browse !== "function") return false;
            const listing = await browse(
                "data",
                `${CRAFT_ART_ROOT}/brewing`
            );
            const files = listing?.files ?? [];
            return files.some(path => String(path).endsWith("/calming-herb-tea.webp"));
        } catch {
            return false;
        }
    }

    static async refreshPresence() {
        packArtPresent = await this.detectPackArtPresent();
        return packArtPresent;
    }

    /**
     * Refresh presence and sync materialised craft pack icons.
     */
    static async apply(_preference, { notify: _notify = true } = {}) {
        await this.refreshPresence();
        try {
            const { OverlayProfessionLoader } = await import(
                "../../packs/overlays/OverlayProfessionLoader.js"
            );
            OverlayProfessionLoader.invalidate();
        } catch { /* loader optional during early boot */ }
        const images = await this.synchronizeCompendium();
        await this.synchronizeActorItems(images);
        Hooks.callAll("ionrift.craftProfessionsArtChanged", { preference: this.value });
        return true;
    }

    static async ensureAvailable() {
        return this.apply(null, { notify: false });
    }

    static async synchronizeCompendium() {
        if (!game.user?.isGM) return;
        const pack = game.packs.get(CRAFT_PROFESSIONS_WORLD_PACK);
        if (!pack?.getDocuments) return new Map();

        const sourceItems = await pack.getDocuments();
        const images = new Map();
        const updates = [];
        for (const item of sourceItems) {
            const identity = itemIdentity(item);
            if (!identity) continue;
            const flags = itemFlags(item);
            const defaultImg = flags.defaultImg
                ?? BREWING_CORE_ICON_FALLBACKS[flags.recipeId]
                ?? item.img;
            const selectedImg = this.value === CRAFT_ART_PACK
                ? (this.packArtPath(item) ?? defaultImg)
                : defaultImg;
            images.set(identity, { defaultImg, selectedImg });
            if (selectedImg !== item.img || !flags.defaultImg) {
                updates.push({
                    _id: item.id,
                    img: selectedImg,
                    [`flags.${MODULE_ID}.defaultImg`]: defaultImg
                });
            }
        }
        if (updates.length) {
            await CONFIG.Item.documentClass.updateDocuments(
                updates,
                { pack: pack.collection }
            );
        }
        return images;
    }

    static async synchronizeActorItems(images = null) {
        if (!game.user?.isGM) return;
        const imageMap = images ?? await this.synchronizeCompendium();
        if (!imageMap?.size) return;

        for (const actor of game.actors ?? []) {
            const updates = [];
            for (const item of actor.items ?? []) {
                const image = imageMap.get(itemIdentity(item));
                if (!image) continue;
                const defaultImg = itemFlags(item).defaultImg ?? image.defaultImg;
                const selectedImg = this.value === CRAFT_ART_PACK
                    ? image.selectedImg
                    : defaultImg;
                if (selectedImg !== item.img || !itemFlags(item).defaultImg) {
                    updates.push({
                        _id: item.id,
                        img: selectedImg,
                        [`flags.${MODULE_ID}.defaultImg`]: defaultImg
                    });
                }
            }
            if (updates.length) {
                await actor.updateEmbeddedDocuments("Item", updates);
            }
        }
    }
}

/** Test helper: force the presence cache without disk I/O. */
export function __setCraftPackArtPresentForTests(present) {
    packArtPresent = !!present;
}
