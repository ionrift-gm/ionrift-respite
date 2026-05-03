/**
 * DetectMagicScanner
 * Scans party inventories for unidentified magical items and handles
 * ritual Identify to reveal item properties.
 */
export class DetectMagicScanner {

    /**
     * @param {string|null|undefined} school
     * @returns {string} slug for CSS (abj, evo, unknown, …)
     */
    static normalizeSchoolForGlow(school) {
        if (school == null || school === "") return "unknown";
        if (typeof school !== "string") return "unknown";
        const k = school.trim().toLowerCase();
        const map = {
            abj: "abj", abjuration: "abj",
            con: "con", conjuration: "con",
            div: "div", divination: "div",
            enc: "enc", enchantment: "enc",
            evo: "evo", evocation: "evo",
            ill: "ill", illusion: "ill",
            nec: "nec", necromancy: "nec",
            trs: "trs", transmutation: "trs"
        };
        return map[k] ?? "unknown";
    }

    /**
     * Collect all magic items for one actor: unidentified, QM-masked, and identified
     * items with a non-common rarity, school, or attunement requirement.
     * Used for inventory glow (highlight everything detect magic would sense).
     * @param {Actor} actor
     * @returns {object[]} items entries compatible with scanParty `items` elements
     */
    static collectAllMagicItems(actor) {
        const items = [];
        const validTypes = new Set(["weapon", "equipment", "consumable", "tool", "loot", "container"]);
        const summarise = game.ionrift?.workshop?.getLatentSummary ?? null;

        for (const item of actor.items) {
            if (!validTypes.has(item.type)) continue;

            const raw = item.toObject?.()?.system ?? {};
            const identifiedLive = item.system?.identified;
            const identifiedRaw = raw.identified;

            const quartermasterLatent = summarise?.(item);
            const isQmMasked = !!quartermasterLatent && quartermasterLatent.kind !== "mundane";
            const isNativeUnidentified = identifiedLive === false || identifiedRaw === false;

            const rarity = item.system?.rarity ?? "";
            const school = item.system?.school ?? null;
            const attunement = item.system?.attunement;
            const hasAttunement = !!attunement && attunement !== 0 && attunement !== "none" && attunement !== "";

            const isIdentifiedMagic = !isNativeUnidentified && !isQmMasked
                && ((rarity && rarity !== "common") || school || hasAttunement);

            if (!isQmMasked && !isNativeUnidentified && !isIdentifiedMagic) continue;

            const unidName = item.system?.unidentified?.name ?? raw.unidentified?.name;
            const trueName = quartermasterLatent?.originalName ?? item.name;
            const displayName = isNativeUnidentified ? (unidName || item.name) : item.name;
            const identified = !isNativeUnidentified && !isQmMasked;

            items.push({
                itemId: item.id,
                displayName,
                trueName,
                school,
                rarity: quartermasterLatent?.originalRarity ?? rarity ?? null,
                img: item.img ?? "icons/svg/mystery-man.svg",
                requiresAttunement: hasAttunement,
                identified
            });
        }

        return items;
    }

    /**
     * Collect only unidentified / QM-masked items for one actor.
     * Used by the workbench identify workflow (only items needing identification).
     * @param {Actor} actor
     * @returns {object[]}
     */
    static collectUnidentifiedMagicItems(actor) {
        return DetectMagicScanner.collectAllMagicItems(actor).filter(it => !it.identified);
    }

    /**
     * Live map for inventory row glow (item id -> school slug).
     * Covers all magic items, identified or not, so the glow matches what
     * Detect Magic would reveal.
     * @param {string} actorId
     * @returns {Map<string, string>}
     */
    static getLiveGlowItemSchoolMap(actorId) {
        const map = new Map();
        const actor = game.actors.get(actorId);
        if (!actor) return map;
        for (const it of DetectMagicScanner.collectAllMagicItems(actor)) {
            map.set(it.itemId, DetectMagicScanner.normalizeSchoolForGlow(it.school));
        }
        return map;
    }

    /**
     * Scan all party actors for magical items.
     * @param {string[]} actorIds - Actor IDs to scan
     * @returns {Object[]} Array of { actorId, actorName, items: [...] }
     */
    static scanParty(actorIds) {
        const results = [];

        for (const actorId of actorIds) {
            const actor = game.actors.get(actorId);
            if (!actor) continue;

            const magic = DetectMagicScanner.collectAllMagicItems(actor);

            if (magic.length > 0) {
                results.push({
                    actorId,
                    actorName: actor.name,
                    actorImg: actor.img,
                    items: magic
                });
            }
        }

        return results;
    }

    /**
     * Identify a specific item on an actor, revealing its true properties.
     *
     * Routes through Quartermaster's IdentificationService when available
     * so that latentMagic and cursedMeta items promote their stashed
     * properties (and pass the identification guard with curseBypass).
     * Falls back to the raw flag toggle for worlds without Quartermaster.
     *
     * @param {string} actorId
     * @param {string} itemId
     * @returns {{ trueName: string, school: string, requiresAttunement: boolean }}
     */
    static async identifyItem(actorId, itemId) {
        const actor = game.actors.get(actorId);
        if (!actor) throw new Error(`Actor ${actorId} not found`);

        const item = actor.items.get(itemId);
        if (!item) throw new Error(`Item ${itemId} not found on ${actor.name}`);

        const quartermasterIdentify = game.ionrift?.workshop?.identify;
        if (typeof quartermasterIdentify === "function") {
            await quartermasterIdentify(item, { silent: true });
        } else {
            await item.update({ "system.identified": true });
        }

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
