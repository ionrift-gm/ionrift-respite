/**
 * DetectMagicScanner
 * Scans party inventories for unidentified magical items and handles
 * ritual Identify to reveal item properties.
 */
export class DetectMagicScanner {

    /**
     * Scan all party actors for unidentified magical items.
     * @param {string[]} actorIds - Actor IDs to scan
     * @returns {Object[]} Array of { actorId, actorName, items: [...] }
     */
    static scanParty(actorIds) {
        const results = [];

        for (const actorId of actorIds) {
            const actor = game.actors.get(actorId);
            if (!actor) continue;

            const unidentified = [];
            const validTypes = new Set(["weapon", "equipment", "consumable", "tool", "loot", "container"]);

            for (const item of actor.items) {
                if (!validTypes.has(item.type)) continue;

                // Diagnostic: log all equipment items and their identified state
                const raw = item.toObject?.()?.system ?? {};
                const identifiedLive = item.system?.identified;
                const identifiedRaw = raw.identified;

                // Only items explicitly marked unidentified via DnD5e's system
                if (identifiedLive !== false && identifiedRaw !== false) continue;

                const unidDesc = item.system?.unidentified?.description ?? raw.unidentified?.description;
                const unidName = item.system?.unidentified?.name ?? raw.unidentified?.name;

                unidentified.push({
                    itemId: item.id,
                    displayName: unidName || item.name,
                    trueName: item.name,
                    school: item.system?.school ?? null,
                    rarity: item.system?.rarity ?? null,
                    img: item.img ?? "icons/svg/mystery-man.svg",
                    requiresAttunement: !!item.system?.attunement,
                    identified: false
                });
            }

            if (unidentified.length > 0) {
                results.push({
                    actorId,
                    actorName: actor.name,
                    actorImg: actor.img,
                    items: unidentified
                });
            }
        }

        console.log(`[Respite:Scan] Final results:`, results);
        return results;
    }

    /**
     * Identify a specific item on an actor, revealing its true properties.
     * @param {string} actorId
     * @param {string} itemId
     * @returns {{ trueName: string, school: string, requiresAttunement: boolean }}
     */
    static async identifyItem(actorId, itemId) {
        const actor = game.actors.get(actorId);
        if (!actor) throw new Error(`Actor ${actorId} not found`);

        const item = actor.items.get(itemId);
        if (!item) throw new Error(`Item ${itemId} not found on ${actor.name}`);

        // Flip the identified flag
        await item.update({ "system.identified": true });

        // Announce in chat
        const school = item.system?.school;
        const schoolLabel = school ? ` (${school})` : "";
        const attunement = item.system?.attunement ? " Requires attunement." : "";

        await ChatMessage.create({
            content: `<div class="ionrift-identify-reveal">
                <strong>${actor.name}</strong> identifies: <strong>${item.name}</strong>${schoolLabel}${attunement}
            </div>`,
            speaker: ChatMessage.getSpeaker({ alias: "Respite" }),
            whisper: game.users.filter(u => u.isGM).map(u => u.id)
        });

        return {
            trueName: item.name,
            school: school ?? "unknown",
            requiresAttunement: !!item.system?.attunement
        };
    }

    /**
     * Map school abbreviations to readable names.
     */
    static SCHOOL_LABELS = {
        abj: "Abjuration", con: "Conjuration", div: "Divination",
        enc: "Enchantment", evo: "Evocation", ill: "Illusion",
        nec: "Necromancy", trs: "Transmutation"
    };

    /**
     * Get a readable school label.
     * @param {string} school
     * @returns {string}
     */
    static schoolLabel(school) {
        if (!school) return "unknown school";
        return this.SCHOOL_LABELS[school] ?? school;
    }

    /**
     * Map school to a FontAwesome icon.
     * @param {string} school
     * @returns {string}
     */
    static schoolIcon(school) {
        const icons = {
            abj: "fas fa-shield-alt", con: "fas fa-portal-enter",
            div: "fas fa-eye", enc: "fas fa-heart",
            evo: "fas fa-fire", ill: "fas fa-mask",
            nec: "fas fa-skull", trs: "fas fa-exchange-alt"
        };
        return icons[school] ?? "fas fa-magic";
    }
}
