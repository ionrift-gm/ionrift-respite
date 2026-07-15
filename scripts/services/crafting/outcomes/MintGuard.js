
/**
 * @param {object[]} docs
 */
import { MODULE_ID } from "../../../data/moduleId.js";
export function guardEmbedItems(docs) {
    const minting = game.ionrift?.library?.minting;
    if (!minting?.guardAll || !docs?.length) return;
    minting.guardAll(docs, { moduleId: MODULE_ID, mode: "create" });
}
