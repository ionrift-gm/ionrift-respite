const MODULE_ID = "ionrift-respite";

/**
 * @param {object[]} docs
 */
export function guardEmbedItems(docs) {
    const minting = game.ionrift?.library?.minting;
    if (!minting?.guardAll || !docs?.length) return;
    minting.guardAll(docs, { moduleId: MODULE_ID, mode: "create" });
}
