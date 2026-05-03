/**
 * ContentPackCompiler
 *
 * Compiles content pack item data into a world compendium at import time.
 * Extracts all unique items from resource pools, recipe outputs, and hunt
 * yield templates, then creates a browsable Foundry compendium under the
 * Ionrift / Respite sidebar folder.
 */

const MODULE_ID = "ionrift-respite";

export class ContentPackCompiler {

    /**
     * Build a world compendium from an imported content pack.
     * @param {string} packId - The pack's unique ID (e.g. "cooking_provisions")
     * @param {Object} packData - The raw pack data stored in importedPacks
     */
    static async compile(packId, packData) {
        if (!game.user.isGM) return;

        const items = this._extractItems(packData);
        if (!items.length) {
            console.log(`${MODULE_ID} | ContentPackCompiler: No items to compile for "${packId}".`);
            return;
        }

        const compName = `respite-${packId}`;
        const compLabel = packData.name ?? packId.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());

        // Remove existing compendium if rebuilding
        const existingId = `world.${compName}`;
        const existing = game.packs.get(existingId);
        if (existing) {
            try { await existing.deleteCompendium(); }
            catch (err) { console.warn(`${MODULE_ID} | ContentPackCompiler: Failed to delete "${existingId}":`, err); }
        }

        // Create new world compendium
        const pack = await this._createWorldCompendium(compName, compLabel);
        if (!pack) return;

        const freshPack = game.packs.get(`world.${compName}`) ?? pack;

        // Build folder structure inside the compendium
        const folderMap = await this._createCompendiumFolders(freshPack, items);

        // Prepare item documents
        const ItemClass = CONFIG.Item.documentClass;
        const preparedItems = items.map(entry => {
            const prepared = foundry.utils.duplicate(entry.data);
            delete prepared._id;
            if (entry.folder && folderMap.has(entry.folder)) {
                prepared.folder = folderMap.get(entry.folder);
            }
            return prepared;
        });

        // Batch insert
        const chunkSize = 50;
        for (let i = 0; i < preparedItems.length; i += chunkSize) {
            await ItemClass.createDocuments(preparedItems.slice(i, i + chunkSize), { pack: freshPack.collection });
        }

        // Place under Ionrift/Respite sidebar folder
        await this._assignSidebarFolder(freshPack);

        console.log(`${MODULE_ID} | ContentPackCompiler: Compiled "${packId}" — ${preparedItems.length} items.`);
        return preparedItems.length;
    }

    /**
     * Extract all unique items from a pack's data into compendium-ready entries.
     * @param {Object} packData
     * @returns {Array<{data: Object, folder: string}>}
     */
    static _extractItems(packData) {
        const seen = new Set();
        const items = [];

        const _add = (itemData, folder) => {
            if (!itemData?.name) return;
            const key = itemData.name.toLowerCase();
            if (seen.has(key)) return;
            seen.add(key);
            items.push({
                data: {
                    name: itemData.name,
                    type: itemData.type ?? "consumable",
                    img: itemData.img ?? "icons/svg/mystery-man.svg",
                    system: itemData.system ?? {},
                    flags: itemData.flags ?? {}
                },
                folder
            });
        };

        // Pool items
        if (Array.isArray(packData.resourcePools)) {
            for (const pool of packData.resourcePools) {
                for (const entry of (pool.entries ?? [])) {
                    if (entry.itemData) _add(entry.itemData, "Forage Items");
                }
            }
        }

        // Recipe outputs (standard + ambitious)
        if (packData.recipes && typeof packData.recipes === "object") {
            for (const [, recipeList] of Object.entries(packData.recipes)) {
                if (!Array.isArray(recipeList)) continue;
                for (const recipe of recipeList) {
                    if (recipe.output) {
                        _add({
                            name: recipe.output.name,
                            type: recipe.output.type ?? "consumable",
                            img: recipe.output.img,
                            system: {
                                description: { value: recipe.output.description ?? "" },
                                rarity: recipe.output.rarity ?? "common",
                                ...(recipe.output.system ?? {})
                            },
                            flags: recipe.outputFlags ?? {}
                        }, recipe.monsterRecipe ? "Monster Recipes" : "Cooking Outputs");
                    }
                    if (recipe.ambitiousOutput) {
                        _add({
                            name: recipe.ambitiousOutput.name,
                            type: recipe.ambitiousOutput.type ?? "consumable",
                            img: recipe.ambitiousOutput.img,
                            system: {
                                description: { value: recipe.ambitiousOutput.description ?? "" },
                                rarity: recipe.ambitiousOutput.rarity ?? "uncommon",
                                ...(recipe.ambitiousOutput.system ?? {})
                            },
                            flags: recipe.ambitiousOutputFlags ?? recipe.outputFlags ?? {}
                        }, recipe.monsterRecipe ? "Monster Recipes" : "Cooking Outputs");
                    }
                }
            }
        }

        // Hunt yield item templates
        if (packData.huntYields && typeof packData.huntYields === "object") {
            for (const [, yields] of Object.entries(packData.huntYields)) {
                for (const tier of ["standard", "exceptional"]) {
                    for (const entry of (yields[tier] ?? [])) {
                        const template = this._huntYieldToItem(entry);
                        if (template) _add(template, "Hunt Yields");
                    }
                }
            }
        }

        return items;
    }

    /**
     * Convert a hunt yield descriptor to an item data object.
     * Mirrors TravelResolver._makeMeat / _makeFish / etc.
     */
    static _huntYieldToItem(entry) {
        const templates = {
            meat: { name: "Fresh Meat", type: "consumable", img: "icons/consumables/meat/steak-raw-red-pink.webp", system: { description: { value: entry.desc ?? "<p>Game meat. Needs cooking.</p>" }, rarity: "common", type: { value: "food", subtype: "" } }, flags: { [MODULE_ID]: { foodTag: "meat", spoilsAfter: 1 } } },
            fish: { name: "Fresh Fish", type: "consumable", img: "icons/consumables/meat/fish-whole-blue.webp", system: { description: { value: entry.desc ?? "<p>Freshwater catch. Needs cooking.</p>" }, rarity: "common", type: { value: "food", subtype: "" } }, flags: { [MODULE_ID]: { foodTag: "meat", spoilsAfter: 1 } } },
            choice_cut: { name: "Choice Cut", type: "consumable", img: "icons/consumables/meat/steak-marbled.webp", system: { description: { value: "<p>A premium cut of game meat.</p>" }, rarity: "uncommon", type: { value: "food", subtype: "" } }, flags: { [MODULE_ID]: { foodTag: "meat", spoilsAfter: 1 } } },
            animal_fat: { name: "Animal Fat", type: "loot", img: "icons/commodities/biological/shell-tan.webp", system: { description: { value: "<p>Rendered fat. Burns long and hot.</p>" }, rarity: "common" } },
            venom_sac: { name: "Venom Sac", type: "loot", img: "icons/consumables/potions/bottle-round-corked-red.webp", system: { description: { value: "<p>A gland from a venomous predator.</p>" }, rarity: "uncommon" } }
        };
        return templates[entry.type] ?? null;
    }

    // ── World Compendium Management ──

    static async _createWorldCompendium(name, label) {
        const base = { label, name, type: "Item", system: game.system.id };

        const attempts = [];
        if (CONST.COMPENDIUM_PACKAGE_TYPES?.WORLD !== undefined) {
            attempts.push({ ...base, packageType: CONST.COMPENDIUM_PACKAGE_TYPES.WORLD });
        }
        attempts.push({ ...base, packageType: "World" });

        let lastErr = null;
        for (const meta of attempts) {
            try {
                return await CompendiumCollection.createCompendium(meta);
            } catch (err) {
                lastErr = err;
            }
        }
        console.error(`${MODULE_ID} | ContentPackCompiler: Failed to create compendium "${name}":`, lastErr);
        return null;
    }

    static async _createCompendiumFolders(pack, items) {
        const folderNames = [...new Set(items.map(i => i.folder).filter(Boolean))];
        const folderMap = new Map();

        for (const name of folderNames) {
            try {
                const folder = await Folder.create(
                    { name, type: "Item", sorting: "a" },
                    { pack: pack.collection }
                );
                const created = Array.isArray(folder) ? folder[0] : folder;
                folderMap.set(name, created.id);
            } catch (err) {
                console.warn(`${MODULE_ID} | ContentPackCompiler: Failed to create folder "${name}":`, err.message);
            }
        }

        return folderMap;
    }

    static async _assignSidebarFolder(pack) {
        if (!game.user.isGM) return;

        const cfg = foundry.utils.duplicate(
            game.settings.get("core", "compendiumConfiguration") ?? {}
        );

        // Find the Respite folder under Ionrift
        const respiteFolderId = this._findRespiteFolderId();
        if (!respiteFolderId) return;

        cfg[pack.collection] = foundry.utils.mergeObject(cfg[pack.collection] ?? {}, { folder: respiteFolderId });
        await game.settings.set("core", "compendiumConfiguration", cfg);
    }

    static _findRespiteFolderId() {
        const cfg = game.settings.get("core", "compendiumConfiguration") ?? {};

        // Try reference from a known Respite pack
        const refPackId = "ionrift-respite.respite-items";
        const fromRef = cfg[refPackId]?.folder;
        if (fromRef) {
            const f = game.folders.get(fromRef);
            if (f?.type === "Compendium" && f.name === "Respite") return fromRef;
        }

        // Walk folder tree: Ionrift > Respite
        const ionriftRoots = game.folders.filter(f =>
            f.type === "Compendium" && f.name === "Ionrift" && !f.folder
        );
        for (const ion of ionriftRoots) {
            const respite = game.folders.find(f =>
                f.type === "Compendium" && f.name === "Respite" && f.folder === ion.id
            );
            if (respite) return respite.id;
        }
        return null;
    }
}
