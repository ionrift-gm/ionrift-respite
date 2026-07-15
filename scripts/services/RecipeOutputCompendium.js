/**
 * Sync custom recipe outputs into world.ionrift-respite-custom (Cooking/Brewing Outputs).
 */

import { Logger } from "../utils/Logger.js";
import { ProvisionsCustomPack, PROVISIONS_CUSTOM_PACK_ID, folderParentId } from "./ProvisionsCustomPack.js";

const MODULE_ID = "ionrift-respite";

/** Placeholder output names replaced with the recipe title on save. */
export const GENERIC_RECIPE_OUTPUT_NAMES = new Set([
    "custom output",
    "new output",
    "new recipe",
    "custom crafted output"
]);

/**
 * @param {string} name
 * @returns {boolean}
 */
export function isGenericRecipeOutputName(name) {
    const normalized = String(name ?? "").trim().toLowerCase();
    return !normalized || GENERIC_RECIPE_OUTPUT_NAMES.has(normalized);
}

/**
 * Pick output item name on save. Keeps output aligned with recipe title when still mirrored.
 * @param {string} [baselineRecipeName]
 * @param {string} [baselineOutputName]
 * @param {string} recipeName
 * @param {string} outputName
 * @returns {string}
 */
export function resolveRecipeOutputNameOnSave(baselineRecipeName, baselineOutputName, recipeName, outputName) {
    const recipe = String(recipeName ?? "").trim();
    const out = String(outputName ?? "").trim();
    const baselineOut = String(baselineOutputName ?? "").trim();
    const baselineRecipe = String(baselineRecipeName ?? "").trim();
    const wasMirroring = !baselineOut
        || isGenericRecipeOutputName(baselineOut)
        || (baselineRecipe && baselineOut.toLowerCase() === baselineRecipe.toLowerCase());

    if (!out) return recipe;
    if (isGenericRecipeOutputName(out)) return recipe;
    if (wasMirroring && (
        out.toLowerCase() === baselineOut.toLowerCase()
        || (baselineRecipe && out.toLowerCase() === baselineRecipe.toLowerCase())
    )) {
        return recipe;
    }
    if (recipe && (out.toLowerCase() === recipe.toLowerCase() || isGenericRecipeOutputName(out))) {
        return recipe;
    }
    return out;
}

/**
 * Stable itemRef for a recipe output tier.
 * @param {string} recipeId
 * @param {"standard"|"ambitious"} tier
 * @returns {string}
 */
export function recipeOutputItemRef(recipeId, tier = "standard") {
    const suffix = tier === "ambitious" ? "__amb" : "__out";
    return `${String(recipeId).trim()}${suffix}`;
}

/**
 * @param {string} professionId
 * @returns {string}
 */
export function outputFolderNameForProfession(professionId) {
    const labels = {
        brewing: "Brewing Outputs",
        tailoring: "Tailoring Outputs",
        leatherworking: "Leatherworking Outputs",
        alchemy: "Alchemy Outputs",
        fletching: "Fletching Outputs",
        tinkering: "Tinkering Outputs",
        smithing: "Smithing Outputs"
    };
    return labels[professionId] ?? "Cooking Outputs";
}

/**
 * Build a compendium item document from recipe output fields.
 * @param {Object} output
 * @param {Object} outputFlags
 * @param {string} itemRef
 * @param {string} folderId
 * @param {string} professionId
 * @returns {Object}
 */
export function buildOutputItemDocument(output, outputFlags, itemRef, folderId, professionId) {
    const rf = { ...(outputFlags?.[MODULE_ID] ?? {}) };
    rf.itemRef = itemRef;
    rf.category = professionId === "brewing" ? "brew" : "prepared";

    const defaultSystemType = professionId === "brewing"
        ? "potion"
        : (["tailoring", "leatherworking", "smithing"].includes(professionId) ? "trinket" : "food");
    const systemType = output.system?.type?.value ?? defaultSystemType;

    const flags = { ...(outputFlags ?? {}) };
    flags[MODULE_ID] = rf;

    const baseSystem = {
        description: {
            value: output.description ?? `<p>${output.name}</p>`
        },
        rarity: output.rarity ?? "common",
        weight: 1,
        type: {
            value: systemType,
            subtype: output.system?.type?.subtype ?? ""
        },
        uses: {
            max: 1,
            per: "charges",
            autoDestroy: true
        }
    };

    return {
        name: output.name,
        type: output.type ?? "consumable",
        img: output.img ?? "icons/consumables/food/bowl-stew-brown.webp",
        folder: folderId,
        system: foundry?.utils?.mergeObject
            ? foundry.utils.mergeObject(baseSystem, output.system ?? {}, { inplace: false })
            : { ...baseSystem, ...(output.system ?? {}) },
        flags
    };
}

/**
 * @param {*} err
 * @returns {string}
 */
export function formatSyncError(err) {
    if (!err) return "unknown error";
    if (typeof err === "string") return err;
    if (typeof err.message === "string" && err.message) return err.message;
    if (Array.isArray(err.errors) && err.errors.length) {
        return err.errors.map(e => e?.message ?? String(e)).join("; ");
    }
    try {
        return JSON.stringify(err);
    } catch {
        return String(err);
    }
}

/**
 * @param {import("@league-of-foundry-developers/foundry-vtt-types").CompendiumCollection} pack
 * @param {number} [timeoutMs]
 */
async function awaitWritablePack(pack, timeoutMs = 8000) {
    const collection = pack?.collection ?? PROVISIONS_CUSTOM_PACK_ID.replace("world.", "");
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const resolved = game.packs.get(`world.${collection}`) ?? game.packs.get(collection);
        if (resolved?.documentName) {
            try {
                await resolved.getIndex();
                return resolved;
            } catch {
                /* pack still registering */
            }
        }
        await new Promise(resolve => setTimeout(resolve, 250));
    }
    return game.packs.get(`world.${collection}`) ?? pack;
}

/**
 * @param {import("@league-of-foundry-developers/foundry-vtt-types").CompendiumCollection} pack
 */
async function ensurePackWritable(pack) {
    const resolved = await awaitWritablePack(pack);
    if (!resolved) throw new Error("Respite Custom compendium is not available.");
    if (resolved.locked) {
        await resolved.configure({ locked: false });
    }
    return resolved;
}

/**
 * @param {import("@league-of-foundry-developers/foundry-vtt-types").CompendiumCollection} pack
 * @param {string} itemRef
 * @param {string} [knownId]
 * @param {string} [outputName]
 * @param {string} [folderId]
 * @returns {Promise<string|null>}
 */
async function findCompendiumEntryId(pack, itemRef, knownId, outputName, folderId) {
    if (knownId) {
        const doc = await pack.getDocument(knownId);
        if (doc) return knownId;
    }

    const index = await pack.getIndex({ fields: ["flags", "name", "folder"] });
    const byRef = index.find(entry => entry.flags?.[MODULE_ID]?.itemRef === itemRef);
    if (byRef?._id) return byRef._id;

    if (outputName && folderId && !isGenericRecipeOutputName(outputName)) {
        const normalized = outputName.toLowerCase().trim();
        const byName = index.find(entry =>
            entry.folder === folderId && String(entry.name ?? "").toLowerCase().trim() === normalized
        );
        if (byName?._id) return byName._id;
    }

    if (itemRef) {
        const docs = await pack.getDocuments();
        const byRefDoc = docs.find(doc => doc.getFlag(MODULE_ID, "itemRef") === itemRef);
        if (byRefDoc) return byRefDoc.id;
    }

    return null;
}

/**
 * @param {import("@league-of-foundry-developers/foundry-vtt-types").CompendiumCollection} pack
 */
async function refreshPackSidebar(pack) {
    try {
        if (pack?.rendered) await pack.render(false);
    } catch {
        /* sidebar refresh is optional */
    }
}

/**
 * @param {Object} source
 */
function prepareForPackWrite(source) {
    const prepared = foundry.utils.duplicate(source);
    delete prepared._id;
    delete prepared._stats;
    delete prepared.ownership;
    delete prepared.sort;

    const minting = game.ionrift?.library?.minting;
    if (minting?.guardAll) {
        minting.guardAll([prepared], { moduleId: MODULE_ID, mode: "pack" });
    }
    return prepared;
}

/**
 * @param {import("@league-of-foundry-developers/foundry-vtt-types").Item} doc
 * @param {Object} rf
 */
async function applyModuleFlags(doc, rf) {
    if (!doc || !rf) return;
    for (const [key, value] of Object.entries(rf)) {
        await doc.setFlag(MODULE_ID, key, value);
    }
}

/**
 * @param {import("@league-of-foundry-developers/foundry-vtt-types").CompendiumCollection} pack
 * @param {string} itemRef
 * @param {Object} data
 * @param {string} [knownId]
 * @param {string} [outputName]
 * @param {string} [folderId]
 * @returns {Promise<string|null>}
 */
async function upsertCompendiumItem(pack, itemRef, data, knownId, outputName, folderId) {
    const ItemClass = CONFIG.Item.documentClass;
    const prepared = prepareForPackWrite(data);
    const moduleFlags = prepared.flags?.[MODULE_ID] ?? {};
    delete prepared.flags;

    let writeErr = null;
    let skipKnownId = false;
    let lookupKnownId = knownId;

    for (let attempt = 0; attempt < 4; attempt++) {
        try {
            const entryId = await findCompendiumEntryId(
                pack,
                itemRef,
                skipKnownId ? null : lookupKnownId,
                outputName,
                folderId
            );

            if (entryId) {
                const doc = await pack.getDocument(entryId);
                if (!doc) {
                    skipKnownId = true;
                    lookupKnownId = null;
                    continue;
                }

                const mergedSystem = foundry.utils.mergeObject(
                    foundry.utils.duplicate(doc.system ?? {}),
                    prepared.system ?? {},
                    { inplace: false }
                );

                await doc.update({
                    name: prepared.name,
                    type: prepared.type,
                    img: prepared.img,
                    folder: prepared.folder,
                    system: mergedSystem
                });

                await applyModuleFlags(doc, moduleFlags);
                await refreshPackSidebar(pack);
                return doc.id;
            }

            const createPayload = { ...prepared, flags: { [MODULE_ID]: moduleFlags } };
            const created = await ItemClass.createDocuments([createPayload], { pack: pack.collection });
            const newId = created[0]?.id ?? null;
            if (newId) await refreshPackSidebar(pack);
            return newId;
        } catch (err) {
            writeErr = err;
            Logger.warn(`Recipe output compendium write attempt ${attempt + 1} failed: ${formatSyncError(err)}`);
            await new Promise(resolve => setTimeout(resolve, 400));
        }
    }

    if (writeErr) throw writeErr;
    return null;
}

/**
 * Upsert standard and ambitious output items; attach itemRef and compendiumId on the recipe.
 * @param {string} professionId
 * @param {Object} recipe
 * @returns {Promise<Object>}
 */
export async function syncRecipeOutputsToCompendium(professionId, recipe) {
    if (!game.user?.isGM || !recipe?.id) return recipe;

    let pack = await ProvisionsCustomPack.ensurePack();
    pack = await ensurePackWritable(pack);
    if (!pack) return recipe;

    const folderName = outputFolderNameForProfession(professionId);
    const folder = await ProvisionsCustomPack.ensureOutputFolder(pack, folderName);
    if (!folder) throw new Error(`Could not resolve "${folderName}" folder in Respite Custom compendium.`);

    const updated = foundry.utils.deepClone(recipe);

    if (updated.output?.name) {
        const itemRef = recipeOutputItemRef(updated.id, "standard");
        updated.output.itemRef = itemRef;
        updated.outputFlags = updated.outputFlags ?? { [MODULE_ID]: {} };
        updated.outputFlags[MODULE_ID] = updated.outputFlags[MODULE_ID] ?? {};
        updated.outputFlags[MODULE_ID].itemRef = itemRef;

        if (updated.output.compendiumId) {
            const existing = await pack.getDocument(updated.output.compendiumId);
            if (!existing) delete updated.output.compendiumId;
        }

        const docData = buildOutputItemDocument(
            updated.output,
            updated.outputFlags,
            itemRef,
            folder.id,
            professionId
        );
        const compendiumId = await upsertCompendiumItem(
            pack,
            itemRef,
            docData,
            updated.output.compendiumId,
            updated.output.name,
            folder.id
        );
        if (compendiumId) updated.output.compendiumId = compendiumId;
    }

    if (updated.ambitiousOutput?.name) {
        const itemRef = recipeOutputItemRef(updated.id, "ambitious");
        updated.ambitiousOutput.itemRef = itemRef;
        updated.ambitiousOutputFlags = updated.ambitiousOutputFlags
            ?? foundry.utils.deepClone(updated.outputFlags ?? { [MODULE_ID]: {} });
        updated.ambitiousOutputFlags[MODULE_ID] = updated.ambitiousOutputFlags[MODULE_ID] ?? {};
        updated.ambitiousOutputFlags[MODULE_ID].itemRef = itemRef;

        if (updated.ambitiousOutput.compendiumId) {
            const existing = await pack.getDocument(updated.ambitiousOutput.compendiumId);
            if (!existing) delete updated.ambitiousOutput.compendiumId;
        }

        const docData = buildOutputItemDocument(
            updated.ambitiousOutput,
            updated.ambitiousOutputFlags,
            itemRef,
            folder.id,
            professionId
        );
        const compendiumId = await upsertCompendiumItem(
            pack,
            itemRef,
            docData,
            updated.ambitiousOutput.compendiumId,
            updated.ambitiousOutput.name,
            folder.id
        );
        if (compendiumId) updated.ambitiousOutput.compendiumId = compendiumId;
    }

    return updated;
}

/**
 * Open a custom compendium output item in its sheet.
 * @param {string} compendiumId
 */
export async function openCustomOutputCompendiumItem(compendiumId) {
    const pack = game.packs.get(PROVISIONS_CUSTOM_PACK_ID);
    if (!pack || !compendiumId) return;
    const doc = await pack.getDocument(compendiumId);
    if (doc?.sheet) doc.sheet.render(true);
}

/**
 * @param {Object} recipe
 * @returns {string|null}
 */
export function standardOutputItemRefForRecipe(recipe) {
    if (!recipe) return null;
    return recipe.output?.itemRef
        ?? recipe.outputFlags?.[MODULE_ID]?.itemRef
        ?? (recipe.id ? recipeOutputItemRef(recipe.id, "standard") : null);
}

/**
 * @param {import("@league-of-foundry-developers/foundry-vtt-types").CompendiumCollection|null} pack
 * @param {Object[]} recipes
 * @returns {Promise<Set<number>>} Recipe list indices missing a compendium output row.
 */
export async function buildRecipeMissingOutputIndex(pack, recipes) {
    const missing = new Set();
    if (!pack || !Array.isArray(recipes) || !recipes.length) return missing;

    const index = await pack.getIndex({ fields: ["flags", "_id"] });
    const refsInPack = new Set(
        index.map(entry => entry.flags?.[MODULE_ID]?.itemRef).filter(Boolean)
    );
    const idsInPack = new Set(index.map(entry => entry._id));

    for (let i = 0; i < recipes.length; i++) {
        const recipe = recipes[i];
        if (!recipe?.output?.name) continue;

        const itemRef = standardOutputItemRefForRecipe(recipe);
        const hasId = recipe.output.compendiumId && idsInPack.has(recipe.output.compendiumId);
        const hasRef = itemRef && refsInPack.has(itemRef);
        if (!hasId && !hasRef) missing.add(i);
    }

    return missing;
}

/**
 * @typedef {{ professionId: string, recipe: Object, tier: "standard"|"ambitious" }} RecipeOutputLink
 */

/**
 * @param {string} itemRef
 * @returns {RecipeOutputLink[]}
 */
export function findRecipesLinkedToOutputItemRef(itemRef) {
    if (!itemRef) return [];
    const stored = game.settings.get(MODULE_ID, "customRecipes") ?? {};
    const links = [];

    for (const professionId of Object.keys(stored)) {
        const list = stored[professionId];
        if (!Array.isArray(list)) continue;

        for (const recipe of list) {
            const stdRef = standardOutputItemRefForRecipe(recipe);
            if (stdRef === itemRef) {
                links.push({ professionId, recipe, tier: "standard" });
            }
            const ambRef = recipe.ambitiousOutput?.itemRef
                ?? recipe.ambitiousOutputFlags?.[MODULE_ID]?.itemRef
                ?? (recipe.id ? recipeOutputItemRef(recipe.id, "ambitious") : null);
            if (ambRef === itemRef) {
                links.push({ professionId, recipe, tier: "ambitious" });
            }
        }
    }

    return links;
}

/**
 * @param {string} documentId
 * @param {RecipeOutputLink[]} links
 */
export async function clearCompendiumIdsForDocument(documentId, links) {
    if (!documentId || !links?.length) return;

    const stored = foundry.utils.deepClone(game.settings.get(MODULE_ID, "customRecipes") ?? {});
    let changed = false;

    for (const { professionId, recipe, tier } of links) {
        const list = stored[professionId];
        if (!Array.isArray(list)) continue;
        const row = list.find(entry => entry?.id === recipe?.id);
        if (!row) continue;

        if (tier === "ambitious" && row.ambitiousOutput?.compendiumId === documentId) {
            delete row.ambitiousOutput.compendiumId;
            changed = true;
        } else if (row.output?.compendiumId === documentId) {
            delete row.output.compendiumId;
            changed = true;
        }
    }

    if (changed) {
        const { sanitizeCustomRecipes } = await import("./RecipeCatalog.js");
        await game.settings.set(MODULE_ID, "customRecipes", sanitizeCustomRecipes(stored));
    }
}

/**
 * Block delete of compendium outputs linked to custom recipes; GM can confirm.
 * @param {Item} item
 * @param {Object} options
 * @returns {boolean|void} false to cancel the pending delete
 */
export function guardLinkedCompendiumOutputDelete(item, options) {
    if (!game.user?.isGM) return;
    if (options?.ionriftRecipeOutputBypass) return;

    const packCollection = item.pack?.collection ?? item.collection?.metadata?.id;
    if (packCollection !== PROVISIONS_CUSTOM_PACK_ID.replace("world.", "")) return;

    const category = item.getFlag(MODULE_ID, "category");
    if (category !== "prepared" && category !== "brew") return;

    const itemRef = item.getFlag(MODULE_ID, "itemRef");
    const links = findRecipesLinkedToOutputItemRef(itemRef);
    if (!links.length) return;

    confirmLinkedCompendiumOutputDelete(item, links);
    return false;
}

/**
 * @param {Item} item
 * @param {RecipeOutputLink[]} links
 */
function confirmLinkedCompendiumOutputDelete(item, links) {
    const names = links.map(link => link.recipe?.name ?? "Recipe").join(", ");
    const confirmFn = game.ionrift?.library?.confirm ?? Dialog.confirm.bind(Dialog);

    confirmFn({
        title: "Delete linked recipe output?",
        content: `<p>This compendium item is the saved output for <strong>${foundry.utils.escapeHTML(names)}</strong>.</p>
            <p>Crafting still uses recipe data. Save the recipe again to recreate the compendium row.</p>`,
        yesLabel: "Delete item",
        noLabel: "Keep item",
        yesIcon: "fas fa-trash",
        noIcon: "fas fa-times",
        defaultYes: false
    }).then(async confirmed => {
        if (!confirmed) return;
        try {
            await clearCompendiumIdsForDocument(item.id, links);
            await item.delete({ ionriftRecipeOutputBypass: true });
            ui.notifications.info(`Removed compendium item "${item.name}". Recipe data unchanged.`);
        } catch (err) {
            ui.notifications.error(`Could not delete compendium item: ${formatSyncError(err)}`);
        }
    });
}
