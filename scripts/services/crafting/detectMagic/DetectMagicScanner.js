import { MODULE_ID } from "../../../data/moduleId.js";
import {
    Pf2eWorkbenchExamineService,
    classifyPf2eItemKind,
    isPf2eItemUnidentified
} from "./Pf2eWorkbenchExamineService.js";

const PF2E_SCHOOL_SLUGS = Object.freeze({
    abjuration: "abj",
    conjuration: "con",
    divination: "div",
    enchantment: "enc",
    evocation: "evo",
    illusion: "ill",
    necromancy: "nec",
    transmutation: "trs"
});

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
        if (school === null || school === "") return "unknown";
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
        const validTypes = new Set(["weapon", "equipment", "consumable", "tool", "loot", "container", "armor", "shield", "treasure", "backpack"]);
        const summarise = game.ionrift?.workshop?.getLatentSummary ?? null;
        const isPf2e = Pf2eWorkbenchExamineService.isPf2e();

        for (const item of actor.items ?? []) {
            if (!validTypes.has(item.type)) continue;

            if (isPf2e) {
                const pf2eKind = classifyPf2eItemKind(item);
                if (pf2eKind !== "magic") continue;
                const isUnid = isPf2eItemUnidentified(item);
                const unidName = item.system?.identification?.unidentified?.name ?? item.system?.unidentified?.name;
                const quartermasterLatent = summarise?.(item);
                const qmLatentRaw = item.getFlag?.("ionrift-quartermaster", "latentMagic")
                    ?? item.flags?.["ionrift-quartermaster"]?.latentMagic;
                const trueName = quartermasterLatent?.originalName ?? quartermasterLatent?.trueName ?? item.name;
                const displayName = isUnid ? (unidName || item.name) : item.name;
                const rawTraits = item.system?.traits?.value ?? item.traits ?? [];
                const traitList = [
                    ...(rawTraits instanceof Set ? [...rawTraits] : (Array.isArray(rawTraits) ? rawTraits : [])),
                    ...(Array.isArray(qmLatentRaw?.originalTraits) ? qmLatentRaw.originalTraits : [])
                ].map(t => String(typeof t === "string" ? t : t?.value ?? "").toLowerCase().trim()).filter(Boolean);
                const traitSchool = traitList.find(t => t in PF2E_SCHOOL_SLUGS) ?? null;
                const level = Math.max(1, Number(item.system?.level?.value ?? item.level ?? qmLatentRaw?.level ?? 1) || 1);
                const originCastRank = Number(item.flags?.pf2e?.origin?.castRank ?? 0);
                const rank = originCastRank > 0 ? originCastRank : Math.max(1, Math.ceil(level / 2));
                const isDeceptiveIllusion = traitList.includes("illusion") && Boolean(
                    item.flags?.[MODULE_ID]?.deceptiveIllusion
                    || item.flags?.["ionrift-tripwire"]?.deceptiveIllusion
                );
                items.push({
                    itemId: item.id,
                    displayName,
                    trueName,
                    school: item.system?.school ?? traitSchool ?? null,
                    rarity: quartermasterLatent?.originalRarity ?? item.system?.traits?.rarity ?? item.rarity ?? null,
                    img: item.img ?? "icons/svg/mystery-man.svg",
                    requiresAttunement: false,
                    identified: !isUnid,
                    level,
                    rank,
                    isDeceptiveIllusion
                });
                continue;
            }

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
     * @param {Object|null} [scanMeta] - Optional caster/rank metadata (e.g. PF2e castRank & pf2eCapability)
     * @returns {Object[]} Array of { actorId, actorName, items: [...], ...scanMeta }
     */
    static scanParty(actorIds, scanMeta = null) {
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
                    items: magic,
                    ...(scanMeta ? {
                        systemId: scanMeta.systemId ?? null,
                        casterId: scanMeta.casterId ?? null,
                        casterName: scanMeta.casterName ?? null,
                        castRank: scanMeta.castRank ?? null,
                        pf2eCapability: scanMeta.pf2eCapability ?? null
                    } : {})
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
        const attunement = (item.system?.attunement === "required" || item.system?.attunement === 1)
            ? (" " + game.i18n.localize("ionrift-respite.detectMagicScanner.requiresAttunement"))
            : "";

        await ChatMessage.create({
            content: `<div class="ionrift-identify-reveal">
                ${game.i18n.format("ionrift-respite.detectMagicScanner.chatIdentified", { actor: actor.name, item: item.name })}${schoolLabel}${attunement}
            </div>`,
            speaker: ChatMessage.getSpeaker({ alias: "Respite" }),
            whisper: game.users.filter(u => u.isGM).map(u => u.id)
        });

        return {
            trueName: item.name,
            school: school ?? "unknown",
            requiresAttunement: (att => att === "required" || att === 1)(item.system?.attunement)
        };
    }

    /**
     * Map school abbreviations to readable names.
     */
    static SCHOOL_LABELS = {
        get abj() { return game.i18n?.localize ? game.i18n.localize("ionrift-respite.detectMagicScanner.schools.abj") : "Abjuration"; },
        get con() { return game.i18n?.localize ? game.i18n.localize("ionrift-respite.detectMagicScanner.schools.con") : "Conjuration"; },
        get div() { return game.i18n?.localize ? game.i18n.localize("ionrift-respite.detectMagicScanner.schools.div") : "Divination"; },
        get enc() { return game.i18n?.localize ? game.i18n.localize("ionrift-respite.detectMagicScanner.schools.enc") : "Enchantment"; },
        get evo() { return game.i18n?.localize ? game.i18n.localize("ionrift-respite.detectMagicScanner.schools.evo") : "Evocation"; },
        get ill() { return game.i18n?.localize ? game.i18n.localize("ionrift-respite.detectMagicScanner.schools.ill") : "Illusion"; },
        get nec() { return game.i18n?.localize ? game.i18n.localize("ionrift-respite.detectMagicScanner.schools.nec") : "Necromancy"; },
        get trs() { return game.i18n?.localize ? game.i18n.localize("ionrift-respite.detectMagicScanner.schools.trs") : "Transmutation"; }
    };

    /**
     * Get a readable school label.
     * @param {string} school
     * @returns {string}
     */
    static schoolLabel(school) {
        if (!school) return game.i18n?.localize ? game.i18n.localize("ionrift-respite.detectMagicScanner.unknownSchool") : "unknown school";
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
