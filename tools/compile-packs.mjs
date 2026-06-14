/**
 * compile-packs.mjs
 *
 * Compiles approved compendium packs from JSON source files (packs/src/<name>/)
 * into LevelDB databases (packs/<name>/) using @foundryvtt/foundryvtt-cli.
 *
 * Run during the release workflow after npm ci. Replaces the old
 * append-approved-packs-to-zip.mjs which shipped raw LevelDB files from git.
 *
 * Usage:
 *   node tools/compile-packs.mjs
 *
 * Post-compile gate: after each compilePack() call the script opens the
 * resulting LevelDB and counts entries. If the DB is empty the script fails
 * with a non-zero exit code so CI cannot zip and ship a blank compendium.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { compilePack } from "@foundryvtt/foundryvtt-cli";
import { ClassicLevel } from "classic-level";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODULE_ROOT = path.resolve(__dirname, "..");
const SHIPPING_PATH = path.join(MODULE_ROOT, "packs", "SHIPPING.json");
const SRC_ROOT = path.join(MODULE_ROOT, "packs", "src");
const OUT_ROOT = path.join(MODULE_ROOT, "packs");

/**
 * Journal guide packs export pages as separate JSON files. compilePack keeps them as
 * separate LevelDB keys; Foundry's compendium getDocument does not hydrate those pages
 * until UI fetch paths run. Merge pages into parent journals before compile so ldb
 * ships embedded pages (E2E and cold compendium reads work).
 *
 * @param {string} srcDir
 * @returns {{ srcDir: string, cleanup: (() => void) | null }}
 */
function stageJournalPackSrc(srcDir) {
    const entries = fs.readdirSync(srcDir)
        .filter((f) => f.endsWith(".json"))
        .map((f) => ({
            file: f,
            doc: JSON.parse(fs.readFileSync(path.join(srcDir, f), "utf8")),
        }));

    const pageDocs = [];
    const parents = new Map();
    const standalone = [];

    for (const entry of entries) {
        const key = entry.doc._key ?? "";
        if (key.startsWith("!journal.pages!")) {
            pageDocs.push(entry);
        } else if (key.startsWith("!journal!")) {
            parents.set(entry.doc._id, entry);
        } else {
            standalone.push(entry);
        }
    }

    if (pageDocs.length === 0) {
        return { srcDir, cleanup: null };
    }

    for (const { doc: page } of pageDocs) {
        const match = (page._key ?? "").match(/^!journal\.pages!([^.]+)\./);
        const parentId = match?.[1];
        if (!parentId) continue;
        const parent = parents.get(parentId);
        if (!parent) continue;
        if (!Array.isArray(parent.doc.pages)) {
            parent.doc.pages = [];
        }
        parent.doc.pages.push(page);
    }

    const tmpDir = fs.mkdtempSync(path.join(MODULE_ROOT, ".pack-stage-"));
    for (const entry of parents.values()) {
        fs.writeFileSync(
            path.join(tmpDir, entry.file),
            `${JSON.stringify(entry.doc, null, 4)}\n`,
        );
    }
    for (const entry of standalone) {
        fs.writeFileSync(
            path.join(tmpDir, entry.file),
            `${JSON.stringify(entry.doc, null, 4)}\n`,
        );
    }

    return {
        srcDir: tmpDir,
        cleanup: () => fs.rmSync(tmpDir, { recursive: true, force: true }),
    };
}

async function countEntries(outDir) {
    const db = new ClassicLevel(outDir, {
        keyEncoding: "utf8",
        valueEncoding: "json",
        createIfMissing: false,
    });
    let count = 0;
    try {
        for await (const _key of db.keys()) {
            count++;
        }
    } finally {
        await db.close();
    }
    return count;
}

async function main() {
    if (!fs.existsSync(SHIPPING_PATH)) {
        console.error("compile-packs: SHIPPING.json not found");
        process.exit(1);
    }

    const shipping = JSON.parse(fs.readFileSync(SHIPPING_PATH, "utf8"));
    const names = Object.entries(shipping.packs || {})
        .filter(([, entry]) => entry && entry.status === "approved")
        .map(([name]) => name)
        .sort();

    if (names.length === 0) {
        console.log("compile-packs: no approved packs to compile");
        return;
    }

    for (const name of names) {
        const srcDir = path.join(SRC_ROOT, name);
        const outDir = path.join(OUT_ROOT, name);

        if (!fs.existsSync(srcDir) || !fs.statSync(srcDir).isDirectory()) {
            console.error(`compile-packs: missing source directory: packs/src/${name}`);
            process.exit(1);
        }

        // Ensure output directory is clean before compile
        if (fs.existsSync(outDir)) {
            fs.rmSync(outDir, { recursive: true, force: true });
        }
        fs.mkdirSync(outDir, { recursive: true });

        console.log(`  compile: packs/src/${name} → packs/${name}`);
        const staged = stageJournalPackSrc(srcDir);
        try {
            await compilePack(staged.srcDir, outDir, { log: true });
        } finally {
            if (staged.cleanup) staged.cleanup();
        }

        // ── Post-compile gate ─────────────────────────────────────────────
        // compilePack() does not throw if it writes 0 entries (malformed JSON,
        // empty src dir, or internal CLI failure can all produce a structurally
        // valid but empty LevelDB). Foundry will silently show a blank compendium.
        // Verify the output here so the failure surfaces before the zip step.

        const ldbFiles = fs.readdirSync(outDir).filter(f => f.endsWith(".ldb"));
        if (ldbFiles.length === 0) {
            console.error(`compile-packs: FATAL — packs/${name} contains no .ldb files after compile`);
            console.error(`  compilePack() produced an empty database.`);
            console.error(`  Check packs/src/${name}/ for malformed or missing JSON files.`);
            process.exit(1);
        }

        const entryCount = await countEntries(outDir);
        if (entryCount === 0) {
            console.error(`compile-packs: FATAL — packs/${name} compiled to 0 entries`);
            console.error(`  .ldb files exist but the database is empty.`);
            console.error(`  Check packs/src/${name}/ for malformed or missing JSON files.`);
            process.exit(1);
        }

        console.log(`  verified: packs/${name} — ${entryCount} entr${entryCount === 1 ? "y" : "ies"} ✓`);
    }

    console.log(`compile-packs: compiled ${names.length} pack(s) successfully`);
}

main().catch((err) => {
    console.error("compile-packs: fatal error:", err);
    process.exit(1);
});
