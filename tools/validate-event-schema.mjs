/**
 * validate-event-schema.mjs
 *
 * Static checks on data/core/events/*.json:
 *   - Known effect types and scope values
 *   - randomTarget damage effects carry a valid pool/count object
 *   - stung conditions follow a random-target damage effect in the same block
 *   - condition + duration entries exist in condition_registry.json
 *   - watchTarget matches mechanical.targets on skill_check events
 *
 * Exit 0 = pass (errors only), 1 = validation errors.
 * Warnings print but do not fail unless --strict is passed.
 *
 * Usage:
 *   node tools/validate-event-schema.mjs
 *   node tools/validate-event-schema.mjs --strict
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MODULE_ROOT = path.resolve(__dirname, "..");
const EVENTS_DIR = path.join(MODULE_ROOT, "data", "core", "events");
const REGISTRY_PATH = path.join(MODULE_ROOT, "data", "core", "condition_registry.json");

const EFFECT_TYPES = new Set([
    "condition",
    "consume_gold",
    "consume_resource",
    "damage",
    "encounter",
    "item_at_risk",
    "loot",
    "recovery_penalty",
    "supply_loss",
    "temp_hp"
]);

const DAMAGE_SCOPES = new Set(["all", "random", "randomTarget", "failed"]);
const CONDITION_SCOPES = new Set(["all", "failed", "stung"]);
const RANDOM_POOLS = new Set(["all", "awake", "sleeping"]);

const CE_STANDARD_CONDITIONS = new Set([
    "poisoned",
    "frightened",
    "blinded",
    "deafened",
    "paralyzed",
    "petrified",
    "stunned",
    "unconscious",
    "invisible",
    "charmed",
    "restrained",
    "grappled",
    "incapacitated"
]);

const OUTCOME_KEYS = new Set([
    "onTriumph",
    "onSuccess",
    "onMixed",
    "onFailure"
]);

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function buildRegistryIndex(registry) {
    const keys = new Set();
    const durations = new Set(Object.keys(registry.durationMap ?? {}));

    for (const entry of registry.conditions ?? []) {
        if (entry.condition === "disadvantage" && Array.isArray(entry.checks) && entry.checks.length > 0) {
            keys.add(`disadvantage:${[...entry.checks].sort().join(",")}`);
        } else if (entry.condition === "exhaustion" && entry.level != null) {
            keys.add(`exhaustion:${entry.level}`);
        } else if (entry.condition) {
            keys.add(entry.condition);
        }
    }

    return { keys, durations };
}

/**
 * @param {string} condition
 * @param {string[]|undefined} checks
 * @param {number|undefined} level
 */
function conditionRegistryKey(condition, checks, level) {
    if (condition === "disadvantage" && Array.isArray(checks) && checks.length > 0) {
        return `disadvantage:${[...checks].sort().join(",")}`;
    }
    if (condition === "exhaustion" && level != null) {
        return `exhaustion:${level}`;
    }
    return condition ?? "";
}

function isResolvableCondition(condition, checks, level, registryIndex) {
    if (!condition) return false;
    const key = conditionRegistryKey(condition, checks, level);
    if (registryIndex.keys.has(key)) return true;
    if (CE_STANDARD_CONDITIONS.has(condition)) return true;
    return false;
}

/**
 * Walk an event subtree and invoke visitor for each effects[] block.
 * @param {unknown} node
 * @param {string} pathLabel
 * @param {(effects: object[], pathLabel: string) => void} visitEffects
 */
function walkEffectBlocks(node, pathLabel, visitEffects) {
    if (!node || typeof node !== "object") return;

    if (Array.isArray(node.effects)) {
        visitEffects(node.effects, pathLabel);
    }

    if (Array.isArray(node.options)) {
        for (const [i, opt] of node.options.entries()) {
            walkEffectBlocks(opt, `${pathLabel}.options[${i}]`, visitEffects);
        }
    }

    for (const key of OUTCOME_KEYS) {
        if (node[key] && typeof node[key] === "object") {
            walkEffectBlocks(node[key], `${pathLabel}.${key}`, visitEffects);
        }
    }

    if (node.noResourceFallback && typeof node.noResourceFallback === "object") {
        visitEffects([node.noResourceFallback], `${pathLabel}.noResourceFallback`);
    }

    if (node.stallPenalty?.upfrontLoss && typeof node.stallPenalty.upfrontLoss === "object") {
        visitEffects([node.stallPenalty.upfrontLoss], `${pathLabel}.stallPenalty.upfrontLoss`);
    }
}

/**
 * @param {object} fileData
 * @param {string} relPath
 * @param {{ keys: Set<string>, durations: Set<string> }} registryIndex
 * @returns {{ errors: string[], warnings: string[] }}
 */
export function validateEventFile(fileData, relPath, registryIndex) {
    const errors = [];
    const warnings = [];
    const pushError = (msg) => errors.push(`${relPath}: ${msg}`);
    const pushWarn = (msg) => warnings.push(`${relPath}: ${msg}`);

    const events = fileData?.events;
    if (!Array.isArray(events)) {
        pushError("missing or invalid top-level events array");
        return { errors, warnings };
    }

    for (const evt of events) {
        const evtId = evt?.id ?? "(unknown)";
        const evtPrefix = `event ${evtId}`;

        if (evt.mechanical?.type === "skill_check") {
            const watch = evt.watchTarget;
            const targets = evt.mechanical.targets;
            if (watch && targets && watch !== targets) {
                pushWarn(
                    `${evtPrefix}: watchTarget "${watch}" does not match mechanical.targets "${targets}" (empty participant list risk when no watch is set)`
                );
            }
            if (
                evt.mechanical.volunteerPolicy !== "each"
                && hasScopeInEvent(evt, "failed")
            ) {
                pushWarn(
                    `${evtPrefix}: scope "failed" is used but volunteerPolicy is not "each"; failedCharacterIds may be empty at runtime`
                );
            }
        }

        walkEffectBlocks(evt.mechanical ?? null, `${evtPrefix}.mechanical`, (effects, blockPath) => {
            validateEffectBlock(effects, blockPath, pushError, pushWarn, registryIndex);
        });

        walkEffectBlocks(evt, evtPrefix, (effects, blockPath) => {
            validateEffectBlock(effects, blockPath, pushError, pushWarn, registryIndex);
        });
    }

    return { errors, warnings };
}

/**
 * @param {object[]} effects
 * @param {string} blockPath
 * @param {(msg: string) => void} pushError
 * @param {(msg: string) => void} pushWarn
 * @param {{ keys: Set<string>, durations: Set<string> }} registryIndex
 */
function validateEffectBlock(effects, blockPath, pushError, pushWarn, registryIndex) {
    let sawRandomDamage = false;

    for (const [index, effect] of effects.entries()) {
                if (!effect || typeof effect !== "object") continue;
                const effPath = `${blockPath}.effects[${index}]`;

                if (!effect.type) {
                    pushError(`${effPath}: effect missing "type"`);
                    continue;
                }

                if (!EFFECT_TYPES.has(effect.type)) {
                    pushError(`${effPath}: unknown effect type "${effect.type}"`);
                    continue;
                }

                const scope = effect.scope ?? "all";

                if (effect.type === "damage") {
                    if (!effect.formula) {
                        pushWarn(`${effPath}: damage effect missing formula`);
                    }
                    if (!DAMAGE_SCOPES.has(scope)) {
                        pushError(`${effPath}: damage scope "${scope}" is not supported by RecoveryHandler`);
                    }
                    if (scope === "random" || scope === "randomTarget") {
                        if (!effect.randomTarget || typeof effect.randomTarget !== "object") {
                            pushError(
                                `${effPath}: scope "${scope}" requires a randomTarget { pool, count } object`
                            );
                        } else {
                            const pool = effect.randomTarget.pool ?? "all";
                            if (!RANDOM_POOLS.has(pool)) {
                                pushError(
                                    `${effPath}: randomTarget.pool "${pool}" must be sleeping, awake, or all`
                                );
                            }
                        }
                        sawRandomDamage = true;
                    }
                    if (scope === "stung") {
                        pushError(`${effPath}: damage cannot use scope "stung" (reserved for conditions)`);
                    }
                }

                if (effect.type === "condition") {
                    if (!CONDITION_SCOPES.has(scope)) {
                        pushError(`${effPath}: condition scope "${scope}" is not supported by ConditionAdvisory`);
                    }
                    if (scope === "stung" && !sawRandomDamage) {
                        pushError(
                            `${effPath}: scope "stung" must follow a damage effect with scope random or randomTarget in the same effects array`
                        );
                    }
                    if (effect.condition === "disadvantage") {
                        if (!Array.isArray(effect.checks) || effect.checks.length === 0) {
                            pushError(`${effPath}: disadvantage condition requires a checks array`);
                        }
                    }
                    if (
                        effect.condition
                        && !isResolvableCondition(
                            effect.condition,
                            effect.checks,
                            effect.level,
                            registryIndex
                        )
                    ) {
                        pushWarn(
                            `${effPath}: condition "${conditionRegistryKey(effect.condition, effect.checks, effect.level)}" is not in condition_registry.json and is not a known CE standard condition`
                        );
                    }
                    if (effect.duration && !registryIndex.durations.has(effect.duration)) {
                        pushWarn(`${effPath}: duration "${effect.duration}" is not in condition_registry durationMap`);
                    }
                }

        if (
            effect.type !== "damage"
            && effect.type !== "condition"
            && scope !== "all"
            && scope !== "failed"
        ) {
            pushWarn(`${effPath}: scope "${scope}" on type "${effect.type}" is unusual; verify resolver support`);
        }
    }
}

/**
 * @param {object} evt
 * @param {string} scopeName
 */
function hasScopeInEvent(evt, scopeName) {
    let found = false;
    const scan = (node) => {
        walkEffectBlocks(node, "", (effects) => {
            for (const effect of effects) {
                if ((effect?.scope ?? "all") === scopeName) found = true;
            }
        });
    };
    scan(evt.mechanical ?? null);
    scan(evt);
    return found;
}

/**
 * @param {string} [moduleRoot]
 * @returns {{ errors: string[], warnings: string[], filesChecked: number }}
 */
export function validateAllEventFiles(moduleRoot = MODULE_ROOT) {
    const eventsDir = path.join(moduleRoot, "data", "core", "events");
    const registryPath = path.join(moduleRoot, "data", "core", "condition_registry.json");

    const registry = readJson(registryPath);
    const registryIndex = buildRegistryIndex(registry);

    const files = fs.readdirSync(eventsDir)
        .filter((f) => f.endsWith(".json"))
        .sort();

    const errors = [];
    const warnings = [];

    for (const file of files) {
        const fullPath = path.join(eventsDir, file);
        const relPath = path.relative(moduleRoot, fullPath).replace(/\\/g, "/");
        let data;
        try {
            data = readJson(fullPath);
        } catch (err) {
            errors.push(`${relPath}: invalid JSON (${err.message})`);
            continue;
        }
        const result = validateEventFile(data, relPath, registryIndex);
        errors.push(...result.errors);
        warnings.push(...result.warnings);
    }

    return { errors, warnings, filesChecked: files.length };
}

function main() {
    const strict = process.argv.includes("--strict");
    const { errors, warnings, filesChecked } = validateAllEventFiles();

    for (const w of warnings) {
        console.warn(`WARN  ${w}`);
    }
    for (const e of errors) {
        console.error(`ERROR ${e}`);
    }

    console.log(
        `validate-event-schema: ${filesChecked} file(s), ${errors.length} error(s), ${warnings.length} warning(s)`
    );

    const failed = errors.length > 0 || (strict && warnings.length > 0);
    process.exit(failed ? 1 : 0);
}

const isMain = process.argv[1]
    && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
    main();
}
