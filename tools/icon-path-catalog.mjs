/**
 * Shared catalog of Foundry core icon paths for pack validation.
 * Sources: dnd5e icon-migration.json, SIGNOFF assetSourceNote, stub-content,
 * and optional verified-core-icons.json overrides.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODULE_ROOT = path.resolve(__dirname, "..");
const DATA_ROOT = path.resolve(MODULE_ROOT, "..", "..");

const SIGNOFF_PATH = path.join(MODULE_ROOT, "packs", "src", "SIGNOFF.json");
const MIGRATION_PATH = path.join(DATA_ROOT, "systems", "dnd5e", "json", "icon-migration.json");
const VERIFIED_PATH = path.join(__dirname, "verified-core-icons.json");
const STUB_CONTENT_PATH = path.join(MODULE_ROOT, "scripts", "data", "stub-content.js");
const OVERLAY_COOKING_ROOT = path.join(
    DATA_ROOT, "ionrift-data", "overlays", "ionrift-respite", "cooking"
);

const IMG_FIELD_RE = /^img$/i;
const ALWAYS_VALID_PREFIXES = ["icons/svg/", "icons/magic/", "modules/"];

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function isLikelyIconPath(value) {
    return typeof value === "string"
        && value.length > 0
        && !value.startsWith("http")
        && !value.startsWith("data:");
}

/**
 * Recursively collect values from `img` keys.
 * @param {unknown} node
 * @param {Set<string>} out
 */
export function collectImgPaths(node, out = new Set()) {
    if (!node || typeof node !== "object") return out;
    if (Array.isArray(node)) {
        for (const item of node) collectImgPaths(item, out);
        return out;
    }
    for (const [key, value] of Object.entries(node)) {
        if (IMG_FIELD_RE.test(key) && isLikelyIconPath(value)) {
            out.add(value);
        } else if (value && typeof value === "object") {
            collectImgPaths(value, out);
        }
    }
    return out;
}

/**
 * @param {string} filePath
 * @returns {Set<string>}
 */
function collectFromJsonFile(filePath) {
    const paths = new Set();
    try {
        const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
        collectImgPaths(data, paths);
    } catch {
        // skip unreadable files
    }
    return paths;
}

/**
 * @param {string} dirPath
 * @returns {{ file: string, img: string }[]}
 */
function listJsonImgRefsInDir(dirPath) {
    const refs = [];
    if (!fs.existsSync(dirPath)) return refs;
    const stack = [dirPath];
    while (stack.length) {
        const current = stack.pop();
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            const full = path.join(current, entry.name);
            if (entry.isDirectory()) {
                stack.push(full);
            } else if (entry.isFile() && entry.name.endsWith(".json") && !entry.name.startsWith("_")) {
                for (const img of collectFromJsonFile(full)) {
                    refs.push({ file: full, img });
                }
            }
        }
    }
    return refs;
}

/**
 * Scan respite pack sources and cooking overlay for icon paths.
 * @returns {{ path: string, img: string }[]}
 */
export function listContentIconRefs() {
    const refs = [];
    const packDirs = [
        path.join(MODULE_ROOT, "packs", "src", "respite-items"),
        path.join(MODULE_ROOT, "packs", "src", "respite-actors"),
        path.join(MODULE_ROOT, "packs", "src", "respite-guide"),
        path.join(MODULE_ROOT, "packs", "src", "respite-guide-gm")
    ];
    for (const dir of packDirs) {
        if (!fs.existsSync(dir)) continue;
        for (const name of fs.readdirSync(dir)) {
            if (!name.endsWith(".json") || name.startsWith("_")) continue;
            const full = path.join(dir, name);
            for (const img of collectFromJsonFile(full)) {
                refs.push({ path: full, img });
            }
        }
    }
    if (fs.existsSync(OVERLAY_COOKING_ROOT)) {
        const overlayDirs = [
            path.join(OVERLAY_COOKING_ROOT, "items"),
            path.join(OVERLAY_COOKING_ROOT, "professions")
        ];
        for (const dir of overlayDirs) {
            for (const { file, img } of listJsonImgRefsInDir(dir)) {
                refs.push({ path: file, img });
            }
        }
    }
    return refs;
}

/**
 * Pull img fields from stub-content.js without importing Foundry-dependent module graph.
 * @returns {Set<string>}
 */
function collectFromStubContentSource() {
    const paths = new Set();
    if (!fs.existsSync(STUB_CONTENT_PATH)) return paths;
    const source = fs.readFileSync(STUB_CONTENT_PATH, "utf8");
    const re = /img:\s*"([^"]+)"/g;
    let match;
    while ((match = re.exec(source)) !== null) {
        if (isLikelyIconPath(match[1])) paths.add(match[1]);
    }
    return paths;
}

/**
 * @returns {Set<string>}
 */
export function buildIconCatalog() {
    const catalog = new Set();

    for (const prefix of ALWAYS_VALID_PREFIXES) {
        catalog.add(prefix);
    }

    if (fs.existsSync(MIGRATION_PATH)) {
        const migration = JSON.parse(fs.readFileSync(MIGRATION_PATH, "utf8"));
        for (const dest of Object.values(migration)) {
            if (isLikelyIconPath(dest)) catalog.add(dest);
        }
    }

    if (fs.existsSync(SIGNOFF_PATH)) {
        const signoff = JSON.parse(fs.readFileSync(SIGNOFF_PATH, "utf8"));
        for (const section of Object.values(signoff)) {
            if (!section || typeof section !== "object") continue;
            for (const entry of Object.values(section)) {
                const note = entry?.assetSourceNote;
                if (isLikelyIconPath(note)) catalog.add(note);
            }
        }
    }

    if (fs.existsSync(VERIFIED_PATH)) {
        const verified = JSON.parse(fs.readFileSync(VERIFIED_PATH, "utf8"));
        for (const p of verified.paths ?? []) {
            if (isLikelyIconPath(p)) catalog.add(p);
        }
    }

    for (const p of collectFromStubContentSource()) catalog.add(p);
    return catalog;
}

/**
 * @param {string} resourcesRoot - Foundry install resources/ directory
 * @returns {string | null}
 */
export function resolveFoundryResourcesRoot(resourcesRoot = process.env.FOUNDRY_RESOURCES) {
    if (resourcesRoot && fs.existsSync(resourcesRoot)) return resourcesRoot;
    const candidates = [
        "C:\\Program Files\\Foundry Virtual Tabletop\\resources",
        "C:\\Program Files (x86)\\Foundry Virtual Tabletop\\resources",
        path.join(process.env.LOCALAPPDATA ?? "", "Programs", "Foundry Virtual Tabletop", "resources")
    ].filter(Boolean);
    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) return candidate;
    }
    return null;
}

/**
 * @param {string} imgPath
 * @param {Set<string>} catalog
 * @param {string | null} resourcesRoot
 * @returns {{ ok: boolean, reason?: string }}
 */
export function validateIconPath(imgPath, catalog, resourcesRoot = null) {
    if (!isLikelyIconPath(imgPath)) {
        return { ok: false, reason: "empty or external URL" };
    }
    for (const prefix of ALWAYS_VALID_PREFIXES) {
        if (imgPath.startsWith(prefix)) return { ok: true };
    }
    if (catalog.has(imgPath)) return { ok: true };
    const root = resourcesRoot ?? resolveFoundryResourcesRoot();
    if (root) {
        const diskPath = path.join(root, imgPath.replace(/\//g, path.sep));
        if (fs.existsSync(diskPath)) return { ok: true };
    }
    return { ok: false, reason: "not in catalog and not on disk" };
}

/**
 * @param {{ resourcesRoot?: string | null }} [options]
 * @returns {{ failures: { path: string, img: string, reason: string }[], catalogSize: number }}
 */
export function validateAllContentIcons(options = {}) {
    const catalog = buildIconCatalog();
    const resourcesRoot = options.resourcesRoot ?? resolveFoundryResourcesRoot();
    const failures = [];
    for (const { path: refPath, img } of listContentIconRefs()) {
        const result = validateIconPath(img, catalog, resourcesRoot);
        if (!result.ok) {
            failures.push({ path: refPath, img, reason: result.reason ?? "invalid" });
        }
    }
    return { failures, catalogSize: catalog.size };
}
