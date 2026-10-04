import { MODULE_ID } from "../../data/moduleId.js";
import { ArtOverlayCatalog } from "./ArtOverlayCatalog.js";

/**
 * ItemArtSync
 *
 * Swaps Respite item images to installed art when an art overlay declares
 * an icon for them, and restores the original image when it does not.
 * Icon lookups come from ArtOverlayCatalog (`itemIcons`), keyed by:
 *   `recipe:<recipeId>`, `item:<itemRef>`, `name:<item name>`.
 *
 * The original image is kept in `flags.ionrift-respite.defaultImg` the first
 * time an image is swapped, so removing the art restores it.
 */

/** Materialised Respite overlay compendiums share this prefix. */
const RESPITE_WORLD_PACK_PREFIX = "world.respite-";

/** Overlay art lives under this root; never treat it as a default image. */
const OVERLAY_ROOT_PREFIX = "ionrift-data/overlays/";

/**
 * Foundry core icons baked into craft pack recipes.json. Used to recover a
 * default for items swapped by older builds before `defaultImg` was stored.
 */
const LEGACY_DEFAULT_IMG = Object.freeze({
    brew_calming_herb_tea: "icons/consumables/drinks/tea-jug-gourd-brown.webp",
    brew_alpine_focus_tea: "icons/consumables/potions/potion-flask-corked-blue.webp",
    brew_moonpetal_tea: "icons/commodities/flowers/lotus-violet.webp",
    brew_desert_cooler: "icons/consumables/fruit/pickly-pear-cactus-red-yellow.webp",
    brew_sweetberry_cordial: "icons/consumables/food/preserves-jam-jelly-jar-brown-red.webp",
    brew_trail_mead: "icons/consumables/drinks/alcohol-beer-stein-wooden-brown.webp",
    brew_firebrand_draught: "icons/consumables/potions/potion-flask-corked-orange.webp",
    brew_frostbite_cordial: "icons/consumables/potions/bottle-round-corked-blue.webp"
});

function itemFlags(item) {
    return item?.flags?.[MODULE_ID] ?? {};
}

/** @returns {string[]} lookup keys, most specific first */
function identityKeys(item) {
    const flags = itemFlags(item);
    const keys = [];
    if (flags.recipeId) keys.push(`recipe:${flags.recipeId}`);
    if (flags.itemRef) keys.push(`item:${flags.itemRef}`);
    if (item?.name) keys.push(`name:${item.name}`);
    return keys;
}

export class ItemArtSync {

    /**
     * Installed icon for an item, or null.
     * @param {object} item
     * @returns {string|null}
     */
    static iconFor(item) {
        const icons = ArtOverlayCatalog.current.itemIcons;
        for (const key of identityKeys(item)) {
            if (icons[key]) return icons[key];
        }
        return null;
    }

    /**
     * Rewrite recipe output images in a recipes.json payload.
     * @param {{ recipes?: Record<string, object[]> }} data
     */
    static applyToRecipeData(data) {
        const icons = ArtOverlayCatalog.current.itemIcons;
        if (!data?.recipes || !Object.keys(icons).length) return data;
        for (const recipes of Object.values(data.recipes)) {
            if (!Array.isArray(recipes)) continue;
            for (const recipe of recipes) {
                const image = icons[`recipe:${recipe?.id}`];
                if (!image) continue;
                if (recipe.output) recipe.output.img = image;
                if (recipe.ambitiousOutput) recipe.ambitiousOutput.img = image;
            }
        }
        return data;
    }

    /**
     * Compute the image update for one item, or null when nothing changes.
     * @param {object} item
     * @returns {{ _id: string, img: string, [k: string]: unknown }|null}
     */
    static planUpdate(item) {
        const flags = itemFlags(item);
        const icon = this.iconFor(item);
        if (!icon && !flags.defaultImg) return null;

        const currentImg = item.img;
        const defaultImg = flags.defaultImg
            ?? LEGACY_DEFAULT_IMG[flags.recipeId]
            ?? (String(currentImg ?? "").startsWith(OVERLAY_ROOT_PREFIX) ? null : currentImg);
        const target = icon ?? defaultImg;
        if (!target || target === currentImg) return null;

        const update = { _id: item.id, img: target };
        if (!flags.defaultImg && defaultImg) {
            update[`flags.${MODULE_ID}.defaultImg`] = defaultImg;
        }
        return update;
    }

    /** Refresh the catalog first, then sync compendiums and actors. */
    static async apply() {
        await ArtOverlayCatalog.ensureLoaded();
        await this.synchronizeCompendiums();
        await this.synchronizeActorItems();
    }

    static async synchronizeCompendiums() {
        if (!game.user?.isGM) return;
        const packs = [...(game.packs ?? [])].filter(pack =>
            pack.documentName === "Item"
            && String(pack.collection ?? "").startsWith(RESPITE_WORLD_PACK_PREFIX)
        );
        for (const pack of packs) {
            if (pack.locked) continue;
            let documents;
            try {
                documents = await pack.getDocuments();
            } catch {
                continue;
            }
            const updates = documents.map(item => this.planUpdate(item)).filter(Boolean);
            if (updates.length) {
                await CONFIG.Item.documentClass.updateDocuments(updates, { pack: pack.collection });
            }
        }
    }

    static async synchronizeActorItems() {
        if (!game.user?.isGM) return;
        for (const actor of game.actors ?? []) {
            const updates = [];
            for (const item of actor.items ?? []) {
                const update = this.planUpdate(item);
                if (update) updates.push(update);
            }
            if (updates.length) {
                await actor.updateEmbeddedDocuments("Item", updates);
            }
        }
    }
}
