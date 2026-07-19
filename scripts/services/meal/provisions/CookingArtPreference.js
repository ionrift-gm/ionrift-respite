import { MODULE_ID } from "../../../data/moduleId.js";

export const COOKING_ART_DEFAULT = "default";
export const COOKING_ART_PACK = "pack";
export const COOKING_OVERLAY_ID = "respite-cooking-overlay";
export const COOKING_ART_OVERLAY_ID = "respite-cooking-art-overlay";
export const COOKING_ART_SUBLAYER = "cooking-art";

const COOKING_ART_ROOT =
    `ionrift-data/overlays/${MODULE_ID}/${COOKING_ART_SUBLAYER}/assets/icons`;

const MEAL_ART_STEMS = Object.freeze({
    cook_fortified_rations: "fortified-rations",
    cook_camp_porridge: "camp-porridge",
    cook_fried_eggs: "fried-eggs",
    cook_roasted_tubers: "roasted-tubers",
    cook_roasted_cattail: "roasted-cattail",
    cook_berry_preserves: "berry-preserves",
    cook_roasted_mushrooms: "roasted-mushrooms",
    cook_herb_rations: "seasoned-rations",
    cook_hearty_stew: "hearty-stew",
    cook_smoked_fish: "smoked-fish",
    cook_spiced_jerky: "spiced-jerky",
    cook_foragers_feast: "foragers-feast",
    cook_alpine_broth: "alpine-broth",
    cook_salted_jerky: "salted-jerky",
    cook_snowberry_jam: "snowberry-jam",
    cook_honey_cakes: "honey-cakes",
    cook_glowcap_skillet: "glowcap-skillet"
});

const FORAGE_ART_STEMS = Object.freeze({
    "Bird Eggs": "bird-eggs",
    "Desert Tubers": "desert-tubers",
    "Cattail Stalks": "cattail-stalks",
    "Snow Berries": "snow-berries",
    "Alpine Herbs": "alpine-herbs",
    "Wild Honeycomb": "wild-honeycomb",
    "Owlbear Feather": "owlbear-feather",
    "Giant Scorpion Carapace": "scorpion-carapace",
    "Heartwood Amber": "heartwood-amber",
    "Glowcap Mushroom": "glowcap",
    "Cactus Water": "cactus-water"
});

/** Cached presence of optional cooking icon overlay files. */
let packArtPresent = false;

function itemFlags(item) {
    return item?.flags?.[MODULE_ID] ?? {};
}

function itemIdentity(item) {
    const flags = itemFlags(item);
    if (flags.recipeId) return `recipe:${flags.recipeId}`;
    if (flags.itemRef) return `item:${flags.itemRef}`;
    if (FORAGE_ART_STEMS[item?.name]) return `forage:${item.name}`;
    return null;
}

/**
 * Optional cooking icons when files are present under the cooking-art overlay.
 * No selector or world preference: presence drives default vs pack art.
 */
export class CookingArtPreference {

    static get value() {
        return packArtPresent ? COOKING_ART_PACK : COOKING_ART_DEFAULT;
    }

    static packArtPath(item) {
        const recipeStem = MEAL_ART_STEMS[itemFlags(item).recipeId];
        if (recipeStem) return `${COOKING_ART_ROOT}/cooking/${recipeStem}.webp`;
        const forageStem = FORAGE_ART_STEMS[item?.name];
        if (forageStem) return `${COOKING_ART_ROOT}/forage/${forageStem}.webp`;
        return null;
    }

    static applyToRecipeData(data) {
        if (this.value !== COOKING_ART_PACK || !data?.recipes) return data;
        for (const recipes of Object.values(data.recipes)) {
            if (!Array.isArray(recipes)) continue;
            for (const recipe of recipes) {
                const stem = MEAL_ART_STEMS[recipe.id];
                if (!stem) continue;
                const image = `${COOKING_ART_ROOT}/cooking/${stem}.webp`;
                if (recipe.output) recipe.output.img = image;
                if (recipe.ambitiousOutput) recipe.ambitiousOutput.img = image;
            }
        }
        return data;
    }

    /**
     * True when the optional cooking-art overlay is on disk.
     * Does not require world active state.
     */
    static async detectPackArtPresent() {
        try {
            const browse = game.ionrift?.library?.PlatformHelper?.FP?.browse
                ?? globalThis.foundry?.applications?.apps?.FilePicker?.implementation?.browse
                ?? FilePicker?.browse;
            if (typeof browse !== "function") return false;
            const listing = await browse(
                "data",
                `${COOKING_ART_ROOT}/cooking`
            );
            const files = listing?.files ?? [];
            return files.some(path => String(path).endsWith("/fortified-rations.webp"));
        } catch {
            return false;
        }
    }

    static async refreshPresence() {
        packArtPresent = await this.detectPackArtPresent();
        return packArtPresent;
    }

    /**
     * Refresh presence and sync materialised icons. Legacy `preference` arg ignored.
     */
    static async apply(_preference, { notify: _notify = true } = {}) {
        await this.refreshPresence();
        const { OverlayProfessionLoader } = await import("../../packs/overlays/OverlayProfessionLoader.js");
        OverlayProfessionLoader.invalidate();
        const images = await this.synchronizeCompendium();
        await this.synchronizeActorItems(images);
        Hooks.callAll("ionrift.cookingArtChanged", { preference: this.value });
        return true;
    }

    static async ensureAvailable() {
        return this.apply(null, { notify: false });
    }

    static async synchronizeCompendium() {
        if (!game.user?.isGM) return;
        const pack = game.packs.get("world.respite-cooking");
        if (!pack?.getDocuments) return new Map();

        const sourceItems = await pack.getDocuments();
        const images = new Map();
        const updates = [];
        for (const item of sourceItems) {
            const identity = itemIdentity(item);
            if (!identity) continue;
            const flags = itemFlags(item);
            const defaultImg = flags.defaultImg ?? item.img;
            const selectedImg = this.value === COOKING_ART_PACK
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
                const selectedImg = this.value === COOKING_ART_PACK
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
export function __setPackArtPresentForTests(present) {
    packArtPresent = !!present;
}
