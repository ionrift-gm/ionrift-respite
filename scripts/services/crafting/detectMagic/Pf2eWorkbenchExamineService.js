import { MODULE_ID } from "../../../data/moduleId.js";

const TRIPWIRE_MODULE_ID = "ionrift-tripwire";
const IDENTIFY_LOCKOUT_FLAG = "identifyLockouts";
const IDENTIFY_RETRY_LOCKOUT_SECONDS = 24 * 60 * 60;

const LEVEL_DC_TABLE = [
    14, 15, 16, 18, 19, 20, 22, 23, 24, 26,
    27, 28, 30, 31, 32, 34, 35, 36, 38, 39,
    40, 42, 44, 46, 48, 50
];

const RARITY_ADJUSTMENTS = {
    common: 0,
    uncommon: 2,
    rare: 5,
    unique: 10
};

export const PF2E_IDENTIFY_SKILLS = [
    { slug: "arcana", label: "Arcana", tradition: "arcane", kind: "magic", requiresToolkit: false },
    { slug: "nature", label: "Nature", tradition: "primal", kind: "magic", requiresToolkit: false },
    { slug: "occultism", label: "Occultism", tradition: "occult", kind: "magic", requiresToolkit: false },
    { slug: "religion", label: "Religion", tradition: "divine", kind: "magic", requiresToolkit: false },
    { slug: "crafting", label: "Crafting", tradition: null, kind: "alchemical", requiresToolkit: true }
];

const ALCHEMIST_TOOLKIT_SLUGS = new Set([
    "alchemists-toolkit",
    "alchemists-toolkit-sterling",
    "alchemists-tools",
    "alchemist-toolkit",
    "alchemists-lab",
    "alchemists-lab-expanded"
]);

const ASSURED_IDENTIFICATION_SLUGS = new Set([
    "assured-identification"
]);

function slugifyName(name) {
    return String(name ?? "")
        .toLowerCase()
        .replace(/['’]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
}

function getActorItems(actor) {
    if (!actor?.items) return [];
    if (Array.isArray(actor.items)) return actor.items;
    if (Array.isArray(actor.items.contents)) return actor.items.contents;
    if (typeof actor.items.values === "function") return Array.from(actor.items.values());
    return [];
}

function getTraitSet(item) {
    const raw = item?.system?.traits?.value ?? item?.traits ?? [];
    const list = Array.isArray(raw)
        ? raw
        : (raw instanceof Set ? Array.from(raw) : []);
    return new Set(list.map((t) => String(t).toLowerCase()));
}

function getSkillRank(actor, skillSlug) {
    const skill = actor?.skills?.[skillSlug] ?? actor?.system?.skills?.[skillSlug];
    return Number(skill?.rank ?? skill?.proficient ?? 0);
}

function getSkillModifier(actor, skillSlug) {
    const skill = actor?.skills?.[skillSlug] ?? actor?.system?.skills?.[skillSlug];
    const mod = skill?.mod ?? skill?.totalModifier ?? skill?.value ?? 0;
    return Number.isFinite(Number(mod)) ? Number(mod) : 0;
}

export function hasAlchemistsToolkit(actor) {
    return getActorItems(actor).some((item) => {
        if (!item) return false;
        const qty = Number(item.system?.quantity ?? 1);
        if (qty <= 0) return false;
        const slug = slugifyName(item.slug || item.system?.slug || item.name);
        if (ALCHEMIST_TOOLKIT_SLUGS.has(slug)) return true;
        return slug.includes("alchemist") && (slug.includes("toolkit") || slug.includes("tools") || slug.includes("lab"));
    });
}

export function hasAssuredIdentification(actor) {
    return getActorItems(actor).some((item) => {
        if (!item) return false;
        const slug = slugifyName(item.slug || item.system?.slug || item.name);
        return ASSURED_IDENTIFICATION_SLUGS.has(slug);
    });
}

export function hasCraftersAppraisal(actor) {
    return getActorItems(actor).some((item) => {
        if (!item) return false;
        const slug = slugifyName(item.slug || item.system?.slug || item.name);
        return slug === "crafters-appraisal";
    });
}

export function hasMagicalLatentFlags(qmLatent) {
    if (!qmLatent || typeof qmLatent !== "object") return false;
    if (Array.isArray(qmLatent.originalTraits)) {
        const hasMagicTrait = qmLatent.originalTraits.some((t) =>
            ["magical", "arcane", "divine", "occult", "primal", "invested"].includes(String(t).toLowerCase())
        );
        if (hasMagicTrait) return true;
    }
    const runes = qmLatent.originalRunes;
    if (
        runes
        && (Number(runes.potency) > 0
            || Number(runes.striking) > 0
            || Number(runes.resilient) > 0
            || Number(runes.reinforcing) > 0
            || (Array.isArray(runes.property) && runes.property.length > 0))
    ) {
        return true;
    }
    if (Number(qmLatent.magicalBonus) > 0) return true;
    if (Array.isArray(qmLatent.properties) && qmLatent.properties.includes("mgc")) return true;
    return false;
}

export function classifyPf2eItemKind(item) {
    const traits = getTraitSet(item);
    const qmLatent = item?.getFlag?.("ionrift-quartermaster", "latentMagic")
        ?? item?.flags?.["ionrift-quartermaster"]?.latentMagic;
    const qmCursed = item?.getFlag?.("ionrift-quartermaster", "cursedMeta")
        ?? item?.flags?.["ionrift-quartermaster"]?.cursedMeta;
    const qmInfected = Number(
        item?.getFlag?.("ionrift-quartermaster", "infectedCount")
        ?? item?.flags?.["ionrift-quartermaster"]?.infectedCount
        ?? 0
    ) > 0;

    const itemType = String(item?.type ?? "").toLowerCase();
    const consumableCategory = String(
        item?.system?.category ?? item?.system?.consumableType?.value ?? ""
    ).toLowerCase();
    const isMagicalConsumable = (
        ["wand", "scroll", "staff"].includes(itemType)
        || (itemType === "consumable" && ["scroll", "wand", "potion", "oil", "talisman"].includes(consumableCategory))
        || traits.has("scroll")
        || traits.has("wand")
        || traits.has("potion")
        || traits.has("oil")
        || traits.has("talisman")
        || traits.has("staff")
    );

    const hasMagicTradition = traits.has("arcane") || traits.has("divine") || traits.has("occult") || traits.has("primal");
    const hasActiveRunes = Boolean(
        Number(item?.system?.runes?.potency ?? 0) > 0
        || Number(item?.system?.runes?.striking ?? 0) > 0
        || Number(item?.system?.runes?.resilient ?? 0) > 0
        || Number(item?.system?.runes?.reinforcing ?? 0) > 0
        || (Array.isArray(item?.system?.runes?.property) && item.system.runes.property.length > 0)
    );

    const isExplicitlyMagical = Boolean(
        item?.isMagical === true
        || traits.has("magical")
        || traits.has("invested")
        || hasMagicTradition
        || hasActiveRunes
        || isMagicalConsumable
        || hasMagicalLatentFlags(qmLatent)
    );

    if (isExplicitlyMagical) return "magic";
    if (
        traits.has("alchemical")
        || item?.isAlchemical === true
        || ["elixir", "mutagen", "poison", "bomb"].includes(consumableCategory)
    ) {
        return "alchemical";
    }
    if (qmCursed || qmInfected) return "magic";
    return "mundane";
}

export function isPf2eItemUnidentified(item) {
    if (!item) return false;
    if (item.isIdentified === false) return true;
    const pf2eStatus = item.system?.identification?.status;
    if (typeof pf2eStatus === "string") {
        if (pf2eStatus === "unidentified") return true;
    }
    if (item.system?.identified === false) return true;
    const qmSummary = globalThis.game?.ionrift?.workshop?.getLatentSummary?.(item);
    if (qmSummary && !qmSummary.identified) return true;
    const qmLatent = item.getFlag?.("ionrift-quartermaster", "latentMagic")
        ?? item.flags?.["ionrift-quartermaster"]?.latentMagic;
    const qmCursed = item.getFlag?.("ionrift-quartermaster", "cursedMeta")
        ?? item.flags?.["ionrift-quartermaster"]?.cursedMeta;
    const qmInfected = Number(
        item.getFlag?.("ionrift-quartermaster", "infectedCount")
        ?? item.flags?.["ionrift-quartermaster"]?.infectedCount
        ?? 0
    ) > 0;
    return Boolean(qmLatent || qmCursed || qmInfected);
}

export function computePf2eIdentificationDcs(item, options = {}) {
    const level = Math.max(0, Number(item?.level ?? item?.system?.level?.value ?? item?.system?.details?.level?.value ?? 0));
    const pwol = Boolean(options.pwol ?? globalThis.game?.pf2e?.settings?.variants?.pwol?.enabled);
    const clamped = Math.max(0, Math.min(25, Math.floor(level)));
    const baseDc = (LEVEL_DC_TABLE[clamped] ?? 14) - (pwol ? Math.max(clamped, 0) : 0);

    const traits = getTraitSet(item);
    const qmCursed = Boolean(
        item?.getFlag?.("ionrift-quartermaster", "cursedMeta")
        ?? item?.flags?.["ionrift-quartermaster"]?.cursedMeta
    );
    const isCursed = traits.has("cursed") || qmCursed;

    const rawRarity = String(item?.rarity ?? item?.system?.traits?.rarity ?? "common").toLowerCase();
    const effectiveRarity = isCursed ? "unique" : (RARITY_ADJUSTMENTS[rawRarity] !== undefined ? rawRarity : "common");
    const rarityAdjustment = RARITY_ADJUSTMENTS[effectiveRarity] ?? 0;
    const adjustedDc = baseDc + rarityAdjustment;

    let offTraditionPenalty = Number(options.notMatchingTraditionModifier);
    if (!Number.isFinite(offTraditionPenalty)) {
        try {
            offTraditionPenalty = Number(globalThis.game?.settings?.get?.("pf2e", "identifyMagicNotMatchingTraditionModifier") ?? 2);
        } catch {
            offTraditionPenalty = 2;
        }
        if (!Number.isFinite(offTraditionPenalty)) offTraditionPenalty = 2;
    }

    const traditions = [];
    for (const entry of PF2E_IDENTIFY_SKILLS) {
        if (entry.tradition && traits.has(entry.tradition)) {
            traditions.push(entry.tradition);
        }
    }

    const dcs = {
        arcana: adjustedDc,
        nature: adjustedDc,
        occultism: adjustedDc,
        religion: adjustedDc,
        crafting: adjustedDc
    };

    if (traditions.length > 0) {
        for (const entry of PF2E_IDENTIFY_SKILLS) {
            if (!entry.tradition) continue;
            if (!traditions.includes(entry.tradition)) {
                dcs[entry.slug] = adjustedDc + offTraditionPenalty;
            }
        }
    }

    return {
        level,
        baseDc,
        rarity: rawRarity,
        effectiveRarity,
        isCursed,
        adjustedDc,
        traditions,
        dcs
    };
}

function resolvePublicName(item) {
    const unidName = item?.system?.identification?.unidentified?.name ?? item?.system?.unidentified?.name;
    if (isPf2eItemUnidentified(item) && unidName) return String(unidName);
    return String(item?.name || "Unknown Item");
}

function resolveTrueName(item) {
    const identifiedName = item?.system?.identification?.identified?.name;
    const sourceName = item?._source?.name;
    const qmSummary = globalThis.game?.ionrift?.workshop?.getLatentSummary?.(item);
    if (qmSummary?.trueName) return String(qmSummary.trueName);
    if (qmSummary?.originalName) return String(qmSummary.originalName);
    const qmLatent = item?.getFlag?.("ionrift-quartermaster", "latentMagic")
        ?? item?.flags?.["ionrift-quartermaster"]?.latentMagic;
    if (qmLatent?.trueName) return String(qmLatent.trueName);
    if (qmLatent?.originalName) return String(qmLatent.originalName);
    if (identifiedName && identifiedName !== item?.name) return String(identifiedName);
    if (sourceName && sourceName !== item?.name) return String(sourceName);
    return String(item?.name || "Item");
}

function makeLockoutKey(itemActorId, itemId) {
    return `${itemActorId || "actor"}:${itemId || "item"}`;
}

function formatRemainingDuration(seconds) {
    const totalMinutes = Math.max(1, Math.ceil(seconds / 60));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`;
    if (hours > 0) return `${hours}h`;
    return `${minutes}m`;
}

export const Pf2eWorkbenchExamineService = {
    isPf2e() {
        const sysId = globalThis.game?.system?.id ?? "";
        const adapterId = globalThis.game?.ionrift?.respite?.adapter?.id ?? "";
        return sysId === "pf2e" || adapterId === "pf2e";
    },

    evaluateActor(actor, selectedSkillSlug = null) {
        const toolkit = hasAlchemistsToolkit(actor);
        const craftersAppraisal = hasCraftersAppraisal(actor);
        const assured = hasAssuredIdentification(actor);

        const availableSkills = PF2E_IDENTIFY_SKILLS.map((def) => {
            const rank = getSkillRank(actor, def.slug);
            const modifier = getSkillModifier(actor, def.slug);
            const ready = rank >= 1 && (!def.requiresToolkit || toolkit || craftersAppraisal);
            const modStr = `${modifier >= 0 ? "+" : ""}${modifier}`;
            const disciplineLabel = def.kind === "alchemical"
                ? (craftersAppraisal ? "Alchemy / Magic" : "Alchemy")
                : "Magic";
            let statusReason = "";
            if (!ready) {
                statusReason = (def.slug === "crafting" && rank >= 1 && !toolkit)
                    ? "Needs Alchemist's Toolkit"
                    : "Untrained";
            }
            return {
                ...def,
                rank,
                modifier,
                modStr,
                disciplineLabel,
                hasToolkit: def.requiresToolkit ? toolkit : true,
                ready,
                disabled: !ready,
                statusReason,
                tooltip: ready
                    ? `${def.label} (${modStr}) · Identify ${disciplineLabel}`
                    : `${def.label} (${modStr}) · ${statusReason}`
            };
        });

        const readySkills = availableSkills.filter((s) => s.ready);
        const defaultSkill = [...readySkills].sort((a, b) => b.modifier - a.modifier)[0]?.slug
            ?? availableSkills[0]?.slug
            ?? "arcana";
        const activeSkillSlug = (selectedSkillSlug && readySkills.some((s) => s.slug === selectedSkillSlug))
            ? selectedSkillSlug
            : defaultSkill;

        const skillChips = availableSkills.map((s) => ({
            ...s,
            selected: s.ready && s.slug === activeSkillSlug
        }));

        return {
            canIdentify: readySkills.length > 0,
            activeSkillSlug,
            activeSkill: skillChips.find((s) => s.slug === activeSkillSlug) ?? skillChips[0] ?? null,
            skillChips,
            availableSkills: skillChips,
            hasAssuredIdentification: assured,
            hasCraftersAppraisal: craftersAppraisal
        };
    },

    inspectItem(item) {
        if (!item) return null;
        const kind = classifyPf2eItemKind(item);
        const isUnidentified = isPf2eItemUnidentified(item);
        const dcInfo = computePf2eIdentificationDcs(item);
        return {
            itemId: item.id,
            itemActorId: item.parent?.id ?? null,
            publicName: resolvePublicName(item),
            trueName: resolveTrueName(item),
            img: item.img || "icons/svg/item-bag.svg",
            kind,
            isUnidentified,
            ...dcInfo
        };
    },

    getRetryLockout(actor, itemRef, nowWorldTime = Number(globalThis.game?.time?.worldTime ?? 0)) {
        if (!actor || !itemRef) return { locked: false, remainingSeconds: 0, remainingLabel: null };
        const itemActorId = itemRef.itemActorId ?? itemRef.parent?.id ?? actor.id;
        const itemId = itemRef.itemId ?? itemRef.id;
        if (!itemId) return { locked: false, remainingSeconds: 0, remainingLabel: null };

        const key = makeLockoutKey(itemActorId, itemId);
        const twLockouts = actor.getFlag?.(TRIPWIRE_MODULE_ID, IDENTIFY_LOCKOUT_FLAG)
            ?? actor.flags?.[TRIPWIRE_MODULE_ID]?.[IDENTIFY_LOCKOUT_FLAG]
            ?? {};
        const rsLockouts = actor.getFlag?.(MODULE_ID, IDENTIFY_LOCKOUT_FLAG)
            ?? actor.flags?.[MODULE_ID]?.[IDENTIFY_LOCKOUT_FLAG]
            ?? {};
        const entry = twLockouts[key] ?? rsLockouts[key];
        if (!entry || !Number.isFinite(Number(entry.untilWorldTime))) {
            return { locked: false, remainingSeconds: 0, remainingLabel: null };
        }
        const remainingSeconds = Number(entry.untilWorldTime) - Number(nowWorldTime);
        if (remainingSeconds <= 0) {
            return { locked: false, remainingSeconds: 0, remainingLabel: null };
        }
        return {
            locked: true,
            untilWorldTime: Number(entry.untilWorldTime),
            remainingSeconds,
            remainingLabel: formatRemainingDuration(remainingSeconds)
        };
    },

    async applyRetryLockout(actor, itemRef, startWorldTime = Number(globalThis.game?.time?.worldTime ?? 0)) {
        if (!actor || !itemRef) return null;
        const itemActorId = itemRef.itemActorId ?? itemRef.parent?.id ?? actor.id;
        const itemId = itemRef.itemId ?? itemRef.id;
        if (!itemId) return null;

        const key = makeLockoutKey(itemActorId, itemId);
        const untilWorldTime = Number(startWorldTime) + IDENTIFY_RETRY_LOCKOUT_SECONDS;
        const record = {
            itemActorId,
            itemId,
            itemLabel: itemRef.publicName || itemRef.itemLabel || itemRef.name || "Item",
            failedAtWorldTime: Number(startWorldTime),
            untilWorldTime
        };

        const currentRs = {
            ...(actor.getFlag?.(MODULE_ID, IDENTIFY_LOCKOUT_FLAG)
                ?? actor.flags?.[MODULE_ID]?.[IDENTIFY_LOCKOUT_FLAG]
                ?? {})
        };
        currentRs[key] = record;

        const currentTw = {
            ...(actor.getFlag?.(TRIPWIRE_MODULE_ID, IDENTIFY_LOCKOUT_FLAG)
                ?? actor.flags?.[TRIPWIRE_MODULE_ID]?.[IDENTIFY_LOCKOUT_FLAG]
                ?? {})
        };
        currentTw[key] = record;

        if (typeof actor.setFlag === "function") {
            await actor.setFlag(MODULE_ID, IDENTIFY_LOCKOUT_FLAG, currentRs);
            try {
                await actor.setFlag(TRIPWIRE_MODULE_ID, IDENTIFY_LOCKOUT_FLAG, currentTw);
            } catch {
                // Tripwire may not be active in this world
            }
        } else {
            actor.flags = actor.flags || {};
            actor.flags[MODULE_ID] = actor.flags[MODULE_ID] || {};
            actor.flags[MODULE_ID][IDENTIFY_LOCKOUT_FLAG] = currentRs;
            actor.flags[TRIPWIRE_MODULE_ID] = actor.flags[TRIPWIRE_MODULE_ID] || {};
            actor.flags[TRIPWIRE_MODULE_ID][IDENTIFY_LOCKOUT_FLAG] = currentTw;
        }
        return record;
    },

    /**
     * Resolve a PF2e camp item examination on the GM client.
     */
    async resolveExamination({
        casterActor,
        ownerActor = null,
        item,
        skillSlug = null,
        rollFn = null,
        nowWorldTime = Number(globalThis.game?.time?.worldTime ?? 0)
    }) {
        if (!casterActor || !item) {
            return { ok: false, message: "Select a character and nominate an item to examine." };
        }
        const effectiveOwner = ownerActor ?? item.parent ?? casterActor;
        const evalRes = this.evaluateActor(casterActor, skillSlug);
        if (!evalRes.canIdentify) {
            return {
                ok: false,
                message: "Requires Trained proficiency in Arcana, Nature, Occultism, Religion, or Crafting (with an Alchemist's Toolkit)."
            };
        }

        const requested = skillSlug
            ? evalRes.skillChips.find((s) => s.slug === String(skillSlug).toLowerCase())
            : evalRes.activeSkill;
        if (!requested || !requested.ready) {
            return {
                ok: false,
                message: requested?.statusReason
                    ? `${requested.label}: ${requested.statusReason}.`
                    : "Select a trained identification skill."
            };
        }

        const inspection = this.inspectItem(item);
        const lockout = this.getRetryLockout(casterActor, {
            itemActorId: effectiveOwner.id,
            itemId: item.id
        }, nowWorldTime);
        if (lockout.locked) {
            return {
                ok: false,
                locked: true,
                message: `${casterActor.name} must wait ${lockout.remainingLabel} before trying to identify ${inspection.publicName} again.`
            };
        }

        const defaultRow = [{
            itemId: item.id,
            ownerActorId: effectiveOwner.id,
            name: inspection.publicName,
            img: inspection.img,
            requiresAttunement: false
        }];

        // 1. Discipline mismatch check (no secret peeking before commitment)
        if (inspection.kind === "alchemical" && requested.slug !== "crafting") {
            return {
                ok: true,
                identified: false,
                outcome: "wrong-discipline",
                title: "No Magical Properties",
                lead: `${casterActor.name} examines ${inspection.publicName} using ${requested.label} (Identify Magic) and detects no magical properties of that discipline.`,
                items: defaultRow
            };
        }
        if (inspection.kind === "magic" && requested.slug === "crafting" && !evalRes.hasCraftersAppraisal) {
            return {
                ok: true,
                identified: false,
                outcome: "wrong-discipline",
                title: "No Alchemical Formula",
                lead: `${casterActor.name} examines ${inspection.publicName} using Crafting (Identify Alchemy) and finds no alchemical construction.`,
                items: defaultRow
            };
        }

        // 2. Mundane item
        if (inspection.kind === "mundane") {
            return {
                ok: true,
                identified: false,
                outcome: "mundane",
                title: "Mundane Item",
                lead: `${casterActor.name} studies ${inspection.publicName} with ${requested.label} and confirms it carries no hidden magical or alchemical properties.`,
                items: defaultRow
            };
        }

        // 3. Already identified item
        if (!inspection.isUnidentified) {
            return {
                ok: true,
                identified: false,
                outcome: "already-known",
                title: "Already Known",
                lead: `${casterActor.name} examines ${inspection.publicName} and confirms its properties are already known.`,
                items: defaultRow
            };
        }

        // 4. Roll Secret GM check vs PF2e Level + Rarity + Off-Tradition DC
        const dc = inspection.dcs?.[requested.slug] ?? inspection.adjustedDc ?? 15;
        let rollTotal = 0;
        let natD20 = 10;
        let degree = 1;

        if (typeof rollFn === "function") {
            const customRoll = await rollFn({ casterActor, skill: requested, dc, item, inspection });
            rollTotal = Number(customRoll?.total ?? 0);
            natD20 = Number(customRoll?.natD20 ?? 10);
            degree = Number.isFinite(customRoll?.degree)
                ? customRoll.degree
                : computePf2eDegree(rollTotal, natD20, dc);
        } else if (typeof globalThis.Roll === "function") {
            const formula = `1d20 + ${requested.modifier}`;
            const roll = new globalThis.Roll(formula);
            await roll.evaluate();
            rollTotal = Number(roll.total ?? 0);
            natD20 = Number(roll.dice?.[0]?.total ?? 10);
            degree = computePf2eDegree(rollTotal, natD20, dc);
            try {
                const gmIds = (globalThis.game?.users ?? []).filter((u) => u.isGM).map((u) => u.id);
                if (typeof roll.toMessage === "function") {
                    await roll.toMessage({
                        speaker: globalThis.ChatMessage?.getSpeaker?.({ actor: casterActor }) ?? { alias: casterActor.name },
                        flavor: `<strong>Camp Examination (${requested.label})</strong> vs DC ${dc} · ${inspection.publicName}`,
                        whisper: gmIds,
                        blind: true
                    });
                }
            } catch {
                // Non-fatal in headless test environments
            }
        } else {
            rollTotal = 10 + requested.modifier;
            degree = computePf2eDegree(rollTotal, 10, dc);
        }

        if (degree === 0 && evalRes.hasAssuredIdentification) {
            degree = 1;
        }

        if (degree >= 2) {
            const revealCurse = degree >= 3;
            const revealedItems = await this.revealItem(effectiveOwner, item, { revealCurse });
            return {
                ok: true,
                identified: true,
                degree,
                revealCurse,
                outcome: degree >= 3 ? "crit-success" : "success",
                title: "Revelation",
                lead: degree >= 3
                    ? "Critical Success: True identity and all properties revealed."
                    : "True identity and properties revealed:",
                items: revealedItems
            };
        }

        // Failure or Critical Failure -> stamp 24-hour retry lockout
        await this.applyRetryLockout(casterActor, {
            itemActorId: effectiveOwner.id,
            itemId: item.id,
            publicName: inspection.publicName
        }, nowWorldTime);

        if (degree === 0) {
            try {
                const gmIds = (globalThis.game?.users ?? []).filter((u) => u.isGM).map((u) => u.id);
                if (gmIds.length && typeof globalThis.ChatMessage?.create === "function") {
                    await globalThis.ChatMessage.create({
                        content: `<div class="ionrift-identify-reveal"><strong>Critical Failure (Misidentified):</strong> ${casterActor.name} rolled ${rollTotal} vs DC ${dc} (${requested.label}) on <strong>${inspection.trueName}</strong> (${inspection.publicName}). Narrate a plausible false property if appropriate.</div>`,
                        speaker: globalThis.ChatMessage.getSpeaker?.({ alias: "Respite" }) ?? { alias: "Respite" },
                        whisper: gmIds
                    });
                }
            } catch {
                // Ignore chat errors in headless tests
            }
        }

        return {
            ok: true,
            identified: false,
            degree,
            outcome: degree === 0 ? "crit-failed" : "failed",
            title: "Properties Remain Elusive",
            lead: `${casterActor.name} studies ${inspection.publicName} with ${requested.label}, but its nature remains elusive. Wait 24 hours before trying to identify this item again.`,
            items: defaultRow
        };
    },

    async revealItem(ownerActor, item, { revealCurse = false } = {}) {
        let resultItems = null;
        const qmActive = Boolean(globalThis.game?.modules?.get?.("ionrift-quartermaster")?.active);
        const intent = revealCurse ? "identify" : "focus";

        if (qmActive) {
            try {
                const { IdentificationService } = await import(
                    "/modules/ionrift-quartermaster/scripts/services/identify/IdentificationService.js"
                );
                const res = await IdentificationService.identify(item, {
                    silent: true,
                    intent,
                    revealCurse
                });
                if (res?.identified && Array.isArray(res.items) && res.items.length) {
                    resultItems = res.items.map((r) => ({
                        itemId: r.itemId ?? item.id,
                        ownerActorId: r.ownerActorId ?? ownerActor.id,
                        name: r.name,
                        img: r.img ?? item.img ?? "icons/svg/item-bag.svg",
                        requiresAttunement: false
                    }));
                }
            } catch {
                // Fall through to native PF2e identification
            }
        }

        if (typeof item.setIdentificationStatus === "function") {
            await item.setIdentificationStatus("identified");
        } else if (typeof item.update === "function") {
            const updateData = {};
            if (item.system?.identification?.status !== undefined) {
                updateData["system.identification.status"] = "identified";
            } else {
                updateData["system.identified"] = true;
            }
            await item.update(updateData, { curseBypass: true });
        } else if (item.system?.identification) {
            item.system.identification.status = "identified";
        }

        if (!resultItems) {
            const fresh = ownerActor?.items?.get?.(item.id) ?? item;
            const trueName = resolveTrueName(fresh);
            resultItems = [{
                itemId: item.id,
                ownerActorId: ownerActor?.id ?? null,
                name: trueName,
                img: fresh?.img ?? item.img ?? "icons/svg/item-bag.svg",
                requiresAttunement: false
            }];
        }
        return resultItems;
    }
};

function computePf2eDegree(total, natD20, dc) {
    let degree = 1;
    if (total >= dc + 10) degree = 3;
    else if (total >= dc) degree = 2;
    else if (total <= dc - 10) degree = 0;
    else degree = 1;

    if (natD20 === 20) degree = Math.min(3, degree + 1);
    else if (natD20 === 1) degree = Math.max(0, degree - 1);
    return degree;
}
