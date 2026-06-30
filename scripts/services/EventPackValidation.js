import { TerrainRegistry } from "./TerrainRegistry.js";

const MODULE_ID = "ionrift-respite";

const EFFECT_TYPES = new Set([
    "condition", "consume_gold", "consume_resource", "damage", "encounter",
    "item_at_risk", "loot", "recovery_penalty", "supply_loss", "temp_hp"
]);

const OUTCOME_KEYS = ["onTriumph", "onSuccess", "onMixed", "onFailure"];

const SKILL_KEYS = new Set([
    "acr", "ani", "arc", "ath", "dec", "his", "ins", "itm", "inv", "med",
    "nat", "prc", "prf", "per", "rel", "sle", "ste", "sur",
    "str", "dex", "con", "int", "wis", "cha"
]);

const MAX_REPORT_GROUPS = 6;

/** @type {{ keys: Set<string>, durations: Set<string> }|null} */
let _registryIndex = null;

/**
 * @returns {Promise<{ keys: Set<string>, durations: Set<string> }>}
 */
async function loadConditionRegistryIndex() {
    if (_registryIndex) return _registryIndex;

    const keys = new Set();
    const durations = new Set(["next_rest", "end_of_rest", "4_hours", "8_hours", "24_hours", "permanent", "1_attack"]);

    try {
        const resp = await fetch(`modules/${MODULE_ID}/data/core/condition_registry.json`);
        if (resp.ok) {
            const registry = await resp.json();
            for (const d of Object.keys(registry.durationMap ?? {})) durations.add(d);
            for (const entry of registry.conditions ?? []) {
                if (entry.condition === "disadvantage" && entry.checks?.length) {
                    keys.add(`disadvantage:${[...entry.checks].sort().join(",")}`);
                } else if (entry.condition === "exhaustion" && entry.level != null) {
                    keys.add(`exhaustion:${entry.level}`);
                } else if (entry.condition) {
                    keys.add(entry.condition);
                }
            }
        }
    } catch (e) {
        console.warn(`${MODULE_ID} | EventPackValidation: condition registry unavailable`, e);
    }

    _registryIndex = { keys, durations };
    return _registryIndex;
}

/**
 * @param {object} data
 * @returns {{ valid: boolean, errors: string[], warnings: string[], info: string[], terrainTags: { core: object[], custom: object[] } }}
 */
export async function validateEventPackFull(data) {
    const errors = [];
    const warnings = [];
    const info = [];

    if (!data || typeof data !== "object" || Array.isArray(data)) {
        return {
            valid: false,
            errors: ["Pack JSON must be an object."],
            warnings,
            info,
            terrainTags: { core: [], custom: [] }
        };
    }

    if (!data.id || typeof data.id !== "string") {
        errors.push("Pack JSON is missing an 'id' field.");
    }

    if (!Array.isArray(data.events) || data.events.length === 0) {
        errors.push("Pack JSON has no events.");
        return { valid: false, errors, warnings, info, terrainTags: { core: [], custom: [] } };
    }

    const seenIds = new Set();
    const registryIndex = await loadConditionRegistryIndex();
    let missingPackCount = 0;
    let volunteerPolicyCount = 0;
    let watchTargetMismatchCount = 0;
    let consumeGoldScopeCount = 0;

    for (const evt of data.events) {
        if (!evt?.id) {
            errors.push("One or more events are missing an 'id' field.");
            continue;
        }
        if (seenIds.has(evt.id)) {
            errors.push(`Duplicate event id "${evt.id}".`);
        }
        seenIds.add(evt.id);

        if (!evt.terrainTags?.length) {
            errors.push(`Event "${evt.id}" is missing terrainTags.`);
        }
        if (!evt.pack) missingPackCount += 1;

        if (evt.mechanical?.type === "skill_check") {
            const skillFlags = tallySkillCheckIssues(evt);
            volunteerPolicyCount += skillFlags.volunteerPolicy;
            watchTargetMismatchCount += skillFlags.watchTargetMismatch;
            if (skillFlags.unknownSkill) {
                warnings.push(`Event "${evt.id}": skill "${skillFlags.unknownSkill}" is not a known abbreviation.`);
            }
        }

        consumeGoldScopeCount += tallyConsumeGoldScopeIssues(evt);
        validateEventEffects(evt, errors, warnings, registryIndex);
    }

    if (missingPackCount > 0) {
        warnings.push(`${missingPackCount} event${missingPackCount === 1 ? "" : "s"} missing pack field (will default to "${data.id}").`);
    }
    if (volunteerPolicyCount > 0) {
        warnings.push(`${volunteerPolicyCount} skill check${volunteerPolicyCount === 1 ? "" : "s"} use volunteerPolicy; runtime reads checkPolicy instead (defaults to group average).`);
    }
    if (watchTargetMismatchCount > 0) {
        warnings.push(`${watchTargetMismatchCount} event${watchTargetMismatchCount === 1 ? "" : "s"} have watchTarget that differs from mechanical.targets.`);
    }
    if (consumeGoldScopeCount > 0) {
        warnings.push(`${consumeGoldScopeCount} consume_gold effect${consumeGoldScopeCount === 1 ? "" : "s"} use scope "each"; gold loss is party-wide.`);
    }

    validatePackTables(data, warnings, info);

    await TerrainRegistry.init();
    const terrainTags = classifyPackTerrainTags(data);

    if (terrainTags.core.length && !terrainTags.custom.length) {
        const labels = terrainTags.core.map(t => t.label).join(", ");
        const packLabel = data.name ?? data.id ?? "pack";
        info.push(`Legacy pack: events use core terrain ${labels} but appear as "${labels} · ${packLabel}" in Event Pool, separate from default ${labels} events.`);
    }

    if (Array.isArray(data.tables) && data.tables.some(t => t.entries?.length)) {
        warnings.push("tables.entries is legacy. Night events are chosen from the curated pool by weight, not by roll range.");
    }

    return {
        valid: errors.length === 0,
        errors,
        warnings,
        info,
        terrainTags
    };
}

/**
 * Blocking validation hook for JsonPackService (errors only).
 *
 * @param {unknown} data
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateEventPackData(data) {
    if (!data || typeof data !== "object" || Array.isArray(data)) {
        return { valid: false, errors: ["Pack JSON must be an object."] };
    }

    const pack = /** @type {Record<string, unknown>} */ (data);
    if (!pack.id || typeof pack.id !== "string") {
        return { valid: false, errors: ["Pack JSON is missing an 'id' field."] };
    }

    if (!Array.isArray(pack.events) || pack.events.length === 0) {
        return { valid: false, errors: ["Pack JSON has no events."] };
    }

    const seenIds = new Set();
    for (const evt of pack.events) {
        if (!evt?.id) {
            return { valid: false, errors: ["One or more events are missing an 'id' field."] };
        }
        if (seenIds.has(evt.id)) {
            return { valid: false, errors: [`Duplicate event id "${evt.id}".`] };
        }
        seenIds.add(evt.id);
        if (!evt.terrainTags?.length) {
            return { valid: false, errors: [`Event "${evt.id}" is missing terrainTags.`] };
        }
    }

    return { valid: true, errors: [] };
}

/**
 * @param {object} data
 * @returns {{ core: { tag: string, label: string }[], custom: { tag: string, label: string }[] }}
 */
export function classifyPackTerrainTags(data) {
    const tags = new Set();
    for (const tag of (data.terrains ?? [])) {
        if (tag) tags.add(tag);
    }
    for (const evt of (data.events ?? [])) {
        for (const tag of (evt.terrainTags ?? [])) {
            if (tag) tags.add(tag);
        }
    }

    const core = [];
    const custom = [];

    for (const tag of tags) {
        const manifest = TerrainRegistry.get(tag);
        if (manifest && !manifest.custom && !TerrainRegistry.isCustomTerrain(tag)) {
            core.push({ tag, label: manifest.label ?? tag });
        } else if (manifest?.custom || TerrainRegistry.isCustomTerrain(tag)) {
            custom.push({ tag, label: manifest.label ?? `${tag} (custom)` });
        } else {
            const label = tag.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
            custom.push({ tag, label: `${label} (custom)` });
        }
    }

    core.sort((a, b) => a.label.localeCompare(b.label));
    custom.sort((a, b) => a.label.localeCompare(b.label));
    return { core, custom };
}

/**
 * @param {object} evt
 * @returns {{ volunteerPolicy: number, watchTargetMismatch: number, unknownSkill: string|null }}
 */
function tallySkillCheckIssues(evt) {
    const skill = evt.mechanical?.skill;
    return {
        volunteerPolicy: (evt.mechanical?.volunteerPolicy && !evt.mechanical?.checkPolicy) ? 1 : 0,
        watchTargetMismatch: (
            evt.watchTarget
            && evt.mechanical?.targets
            && evt.watchTarget !== evt.mechanical.targets
        ) ? 1 : 0,
        unknownSkill: (skill && !SKILL_KEYS.has(skill)) ? skill : null
    };
}

/**
 * @param {object} evt
 * @returns {number}
 */
function tallyConsumeGoldScopeIssues(evt) {
    let count = 0;
    const visit = (node) => {
        if (!node || typeof node !== "object") return;
        if (Array.isArray(node.effects)) {
            for (const effect of node.effects) {
                if (effect?.type === "consume_gold" && effect.scope === "each") count += 1;
            }
        }
        for (const key of OUTCOME_KEYS) {
            if (node[key]) visit(node[key]);
        }
    };
    visit(evt.mechanical ?? null);
    return count;
}

/**
 * @param {object} data
 * @param {string[]} warnings
 * @param {string[]} info
 */
function validatePackTables(data, warnings, info) {
    for (const table of (data.tables ?? [])) {
        if (!table?.terrainTag) continue;
        const core = TerrainRegistry.get(table.terrainTag);
        if (core && !core.custom && table.noEventThreshold != null) {
            info.push(`Table threshold for "${table.terrainTag}" may be overridden by core terrain data.`);
        }
    }
}

/**
 * @param {object} evt
 * @param {string[]} errors
 * @param {string[]} warnings
 * @param {{ keys: Set<string>, durations: Set<string> }} registryIndex
 */
function validateEventEffects(evt, errors, warnings, registryIndex) {
    const visit = (node, prefix) => {
        if (!node || typeof node !== "object") return;
        if (Array.isArray(node.effects)) {
            for (const [i, effect] of node.effects.entries()) {
                validateEffect(effect, `${prefix}.effects[${i}]`, errors, warnings, registryIndex);
            }
        }
        for (const key of OUTCOME_KEYS) {
            if (node[key]) visit(node[key], `${prefix}.${key}`);
        }
    };
    visit(evt.mechanical ?? null, `event ${evt.id}.mechanical`);
}

/**
 * @param {object} effect
 * @param {string} path
 * @param {string[]} errors
 * @param {string[]} warnings
 * @param {{ keys: Set<string>, durations: Set<string> }} registryIndex
 */
function validateEffect(effect, path, errors, warnings, registryIndex) {
    if (!effect?.type) {
        errors.push(`${path}: effect missing "type".`);
        return;
    }
    if (!EFFECT_TYPES.has(effect.type)) {
        errors.push(`${path}: unknown effect type "${effect.type}".`);
        return;
    }
    if (effect.type === "condition" && effect.duration && !registryIndex.durations.has(effect.duration)) {
        warnings.push(`${path}: duration "${effect.duration}" is not in condition_registry.`);
    }
}

/**
 * @param {object} report
 * @returns {Promise<boolean>}
 */
export async function confirmEventPackImport(report) {
    const content = buildImportReportHtml(report, { confirm: true });
    return foundry.applications.api.DialogV2.confirm({
        window: { title: "Import event pack?", icon: "fas fa-file-import" },
        content,
        position: { width: 480, height: "auto" },
        yes: { label: "Import", icon: "fas fa-file-import" },
        no: { label: "Cancel", icon: "fas fa-times" }
    });
}

/**
 * @param {object} report
 * @returns {Promise<void>}
 */
export async function showEventPackImportFailure(report) {
    const content = buildImportReportHtml(report, { confirm: false });
    await foundry.applications.api.DialogV2.wait({
        window: { title: "Import failed", icon: "fas fa-exclamation-triangle" },
        content,
        position: { width: 480, height: "auto" },
        buttons: [{ action: "close", label: "Close", icon: "fas fa-times", default: true }]
    });
}

/**
 * @param {string} line
 * @returns {string}
 */
function normalizeReportLineKey(line) {
    const eventMatch = line.match(/^Event "[^"]+":\s*(.+)$/);
    if (eventMatch) return eventMatch[1];
    const pathMatch = line.match(/^event [^:]+:\s*(.+)$/i);
    if (pathMatch) return pathMatch[1];
    return line;
}

/**
 * Collapse repeated validation lines into counted summaries.
 *
 * @param {string[]} lines
 * @param {number} [maxGroups]
 * @returns {{ items: string[], omitted: number, total: number }}
 */
function summarizeReportLines(lines, maxGroups = MAX_REPORT_GROUPS) {
    const groups = new Map();

    for (const line of lines) {
        const key = normalizeReportLineKey(line);
        const entry = groups.get(key) ?? { key, count: 0 };
        entry.count += 1;
        groups.set(key, entry);
    }

    const sorted = [...groups.values()].sort((a, b) => b.count - a.count);
    const shown = sorted.slice(0, maxGroups);
    const items = shown.map(({ key, count }) => (
        count > 1 ? `${count}× ${key}` : key
    ));

    return {
        items,
        omitted: Math.max(0, sorted.length - shown.length),
        total: lines.length
    };
}

/**
 * @param {string[]} lines
 * @param {string} heading
 * @returns {string}
 */
function renderReportSection(lines, heading) {
    if (!lines?.length) return "";

    const { items, omitted, total } = summarizeReportLines(lines);
    const omittedHtml = omitted > 0
        ? `<li class="event-pack-import-omitted">${omitted} more issue type${omitted === 1 ? "" : "s"} (${total} total). Full list in the browser console.</li>`
        : "";

    return `<p><strong>${heading}</strong></p><ul>${items.map(line => `<li>${line}</li>`).join("")}${omittedHtml}</ul>`;
}

/**
 * @param {object} report
 * @param {{ confirm?: boolean }} [opts]
 * @returns {string}
 */
function buildImportReportHtml(report, opts = {}) {
    if (report.warnings?.length) {
        console.groupCollapsed(`${MODULE_ID} | Event pack import warnings (${report.packId ?? "pack"})`);
        for (const line of report.warnings) console.warn(line);
        console.groupEnd();
    }

    const bodyParts = [];

    if (report.terrainTags?.core?.length) {
        const labels = report.terrainTags.core.map(t => t.label).join(", ");
        bodyParts.push(`<p><strong>Core terrains</strong> ${labels}</p>`);
    }
    if (report.terrainTags?.custom?.length) {
        const labels = report.terrainTags.custom.map(t => t.label).join(", ");
        bodyParts.push(`<p><strong>Custom terrains</strong> ${labels}</p>`);
    }

    bodyParts.push(renderReportSection(report.info, "Notes"));
    bodyParts.push(renderReportSection(report.warnings, "Warnings"));
    bodyParts.push(renderReportSection(report.errors, "Errors"));

    const footer = (opts.confirm && report.valid)
        ? `<p class="event-pack-import-report-footer">Import <strong>${report.eventCount ?? "?"}</strong> event${report.eventCount === 1 ? "" : "s"} from <strong>${report.packId ?? "pack"}</strong>?</p>`
        : "";

    return `<div class="event-pack-import-report">
        <div class="event-pack-import-report-body">${bodyParts.filter(Boolean).join("")}</div>
        ${footer}
    </div>`;
}
