/**
 * validate-packs-local.mjs
 *
 * Two modes:
 *
 *   Default (no flags): simulates a clean CI build by compiling JSON sources
 *   into a temporary staging directory, then verifying every expected entry.
 *   Use this locally to validate source data without a full release run.
 *
 *   --verify-only: skips compilation and reads from the already-compiled
 *   packs/ directories directly. Use this in CI immediately after
 *   compile-packs.mjs to confirm that the output going into the release zip
 *   is correct. This closes the gap where the default mode would recompile
 *   into staging but never verify the actual shipped output.
 *
 * Usage:
 *   node tools/validate-packs-local.mjs            # full compile + verify (local)
 *   node tools/validate-packs-local.mjs --verify-only  # verify compiled output (CI)
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { compilePack } from "@foundryvtt/foundryvtt-cli";
import { ClassicLevel } from "classic-level";
import { stageJournalPackSrc } from "./journal-pack-staging.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODULE_ROOT = path.resolve(__dirname, "..");
const SHIPPING_PATH = path.join(MODULE_ROOT, "packs", "SHIPPING.json");
const SRC_ROOT = path.join(MODULE_ROOT, "packs", "src");
const OUT_ROOT = path.join(MODULE_ROOT, "packs");
const STAGING = path.join(MODULE_ROOT, "packs", ".validation-staging");

const VERIFY_ONLY = process.argv.includes("--verify-only");
const MIN_GUIDE_BODY_CHARS = 80;

function stripHtml(html) {
    return (html ?? "")
        .replace(/<style[\s>][\s\S]*?<\/style>/gi, " ")
        .replace(/<script[\s>][\s\S]*?<\/script>/gi, " ")
        .replace(/<[^>]*>/g, " ")
        .replace(/&nbsp;/gi, " ")
        .replace(/&[a-z#0-9]+;/gi, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function pageBodyChars(value) {
    if (!value) return 0;
    if (value.type === "text") return stripHtml(value.text?.content ?? "").length;
    if (value.type === "image") {
        return stripHtml(value.image?.caption ?? value.text?.content ?? "").length;
    }
    return stripHtml(value.text?.content ?? "").length;
}

function verifyGuideJournalBodies(packName, allEntries) {
    if (!packName.includes("guide")) return;

    const byKey = new Map(allEntries);
    const journals = allEntries.filter(([key]) => key.startsWith("!journal!"));

    for (const [journalKey, journal] of journals) {
        const journalId = journal._id ?? journalKey.replace(/^!journal!/, "");
        const pageIds = Array.isArray(journal.pages)
            ? journal.pages.filter((id) => typeof id === "string")
            : [];

        if (!pageIds.length) {
            const legacyChars = stripHtml(journal.text?.content ?? "").length;
            if (legacyChars < MIN_GUIDE_BODY_CHARS) {
                fail(
                    `${packName}: journal "${journal.name}" has no page refs and legacy body is ${legacyChars} chars (need ≥${MIN_GUIDE_BODY_CHARS})`,
                );
            } else {
                pass(`${packName}: journal "${journal.name}" legacy body ${legacyChars} chars`);
            }
            continue;
        }

        pass(`${packName}: journal "${journal.name}" lists ${pageIds.length} page ref(s)`);

        let substantivePages = 0;
        for (const pageId of pageIds) {
            const pageKey = `!journal.pages!${journalId}.${pageId}`;
            const page = byKey.get(pageKey);
            if (!page) {
                fail(`${packName}: missing page ldb key ${pageKey}`);
                continue;
            }
            const chars = pageBodyChars(page);
            if (chars >= MIN_GUIDE_BODY_CHARS) {
                substantivePages++;
                pass(`${packName}: page "${page.name}" ${chars} chars`);
            } else {
                fail(
                    `${packName}: page "${page.name}" only ${chars} chars (need ≥${MIN_GUIDE_BODY_CHARS})`,
                );
            }
        }

        if (substantivePages === 0) {
            fail(`${packName}: journal "${journal.name}" has no substantive page bodies`);
        }
    }
}

// ── Expected pack contents ──────────────────────────────────────────────
const EXPECTED = {
    "respite-items": {
        minEntries: 17,
        requiredKeys: [
            "!items!a1b2c3d4e5f60001",   // Wild Herbs
            "!items!a1b2c3d4e5f60002",   // Wild Berries
            "!folders!f0ra6e0000000001",  // Forage folder
            "!folders!c00ked0000000001",  // Cooking Outputs folder
        ],
        requiredFlags: {
            // At least one item must have forage category for base pool gating
            forage: (entries) => entries.some(
                ([, v]) => v?.flags?.["ionrift-respite"]?.category === "forage"
            ),
        },
    },
    "respite-actors": {
        minEntries: 9,  // 1 campfire + 7 equipment + 1 folder
        requiredKeys: [
            "!actors!CampfireToken001",
            "!actors!CampWorkbench1",
            "!actors!CampCooking01",
            "!actors!CampBedroll01",
            "!actors!CampTent0001",
            "!actors!CampMessKit1",
            "!actors!CampMedBed001",
            "!actors!CampWeapRack1",
            "!folders!CampEquipFolder0",
        ],
        requiredFlags: {
            campfire: (entries) => entries.some(
                ([, v]) => v?.flags?.["ionrift-respite"]?.isCampfireToken === true
            ),
        },
    },
    "respite-guide": {
        minEntries: 3,
        requiredKeys: [
            "!journal!1Zh2gDQ1xOLFUrhW",
            "!journal.pages!1Zh2gDQ1xOLFUrhW.aQc3PtQPrYDi9Mlx",
            "!journal.pages!1Zh2gDQ1xOLFUrhW.cK8pRQdW2nFb4Xvj",
        ],
        requiredFlags: {},
    },
    "respite-guide-gm": {
        minEntries: 3,
        requiredKeys: [
            "!journal!hG4mR3fRespGuide01",
            "!journal.pages!hG4mR3fRespGuide01.dvr4TYdYmX88MCCf",
            "!journal.pages!hG4mR3fRespGuide01.mN8kTrXpGmRef001",
        ],
        requiredFlags: {},
    },
};

// ── Bootstrap file checks ───────────────────────────────────────────────
const REQUIRED_BOOTSTRAP_FILES = ["CURRENT"];
const REQUIRED_BOOTSTRAP_PATTERNS = [/^MANIFEST-\d+$/];

let failures = 0;
let passes = 0;

function pass(msg) {
    passes++;
    console.log(`  ✅ ${msg}`);
}

function fail(msg) {
    failures++;
    console.error(`  ❌ ${msg}`);
}

async function main() {
    const modeLabel = VERIFY_ONLY ? "verify compiled output (--verify-only)" : "simulated clean CI build";
    console.log("\n══════════════════════════════════════════════════════");
    console.log(`  Pack Validation (${modeLabel})`);
    console.log("══════════════════════════════════════════════════════\n");

    // In default mode, prepare a clean staging area for fresh compilation.
    // In --verify-only mode, read from the actual packs/ output directories.
    if (!VERIFY_ONLY) {
        if (fs.existsSync(STAGING)) {
            fs.rmSync(STAGING, { recursive: true, force: true });
        }
        fs.mkdirSync(STAGING, { recursive: true });
    }

    // Load shipping manifest
    const shipping = JSON.parse(fs.readFileSync(SHIPPING_PATH, "utf8"));
    const approvedPacks = Object.entries(shipping.packs || {})
        .filter(([, entry]) => entry?.status === "approved")
        .map(([name]) => name)
        .sort();

    console.log(`Shipping manifest: ${approvedPacks.length} approved pack(s)\n`);

    for (const name of approvedPacks) {
        console.log(`── ${name} ${"─".repeat(50 - name.length)}`);

        const srcDir = path.join(SRC_ROOT, name);
        // In --verify-only mode use the already-compiled packs/ dir (what the zip contains).
        // In default mode compile fresh into staging.
        const outDir = VERIFY_ONLY
            ? path.join(OUT_ROOT, name)
            : path.join(STAGING, name);

        if (VERIFY_ONLY) {
            // Skip compilation; verify that the compiled output directory exists.
            if (!fs.existsSync(outDir)) {
                fail(`Compiled pack directory missing: packs/${name} (was compile-packs.mjs run first?)`);
                continue;
            }
            pass(`Using compiled output: packs/${name}`);
        } else {
            // 1. Source directory exists?
            if (!fs.existsSync(srcDir)) {
                fail(`Source directory missing: packs/src/${name}`);
                continue;
            }

            const sourceFiles = fs.readdirSync(srcDir).filter(f => f.endsWith(".json"));
            pass(`Source directory: ${sourceFiles.length} JSON file(s)`);

            // 2. Compile
            try {
                const staged = stageJournalPackSrc(MODULE_ROOT, srcDir);
                try {
                    await compilePack(staged.srcDir, outDir, { log: false });
                } finally {
                    if (staged.cleanup) staged.cleanup();
                }
                pass("Compiled successfully");
            } catch (e) {
                fail(`Compilation failed: ${e.message}`);
                continue;
            }
        }

        // 3. Bootstrap files present?
        const outputFiles = fs.readdirSync(outDir);

        for (const required of REQUIRED_BOOTSTRAP_FILES) {
            if (outputFiles.includes(required)) {
                pass(`Bootstrap file: ${required}`);
            } else {
                fail(`Missing bootstrap file: ${required}`);
            }
        }

        for (const pattern of REQUIRED_BOOTSTRAP_PATTERNS) {
            const match = outputFiles.find(f => pattern.test(f));
            if (match) {
                pass(`Bootstrap file: ${match}`);
            } else {
                fail(`Missing bootstrap file matching: ${pattern}`);
            }
        }

        // 4. LDB data file present?
        const ldbFiles = outputFiles.filter(f => f.endsWith(".ldb"));
        if (ldbFiles.length > 0) {
            pass(`Data files: ${ldbFiles.length} .ldb file(s)`);
        } else {
            fail("No .ldb data files produced");
        }

        // 5. Open the DB and verify contents
        const expect = EXPECTED[name];
        if (!expect) {
            console.log("  ⏭️  No entry expectations defined, skipping content check");
            continue;
        }

        let db;
        try {
            db = new ClassicLevel(outDir, {
                keyEncoding: "utf8",
                valueEncoding: "json",
                createIfMissing: false,
            });

            const allEntries = [];
            for await (const [key, value] of db.iterator()) {
                allEntries.push([key, value]);
            }

            // Entry count
            if (allEntries.length >= expect.minEntries) {
                pass(`Entry count: ${allEntries.length} (expected ≥${expect.minEntries})`);
            } else {
                fail(`Entry count: ${allEntries.length} (expected ≥${expect.minEntries})`);
            }

            // Required keys
            const keySet = new Set(allEntries.map(([k]) => k));
            for (const reqKey of expect.requiredKeys) {
                if (keySet.has(reqKey)) {
                    pass(`Key present: ${reqKey}`);
                } else {
                    fail(`Key missing: ${reqKey}`);
                }
            }

            // Required flag checks
            for (const [label, checkFn] of Object.entries(expect.requiredFlags)) {
                if (checkFn(allEntries)) {
                    pass(`Flag check: ${label}`);
                } else {
                    fail(`Flag check failed: ${label}`);
                }
            }

            verifyGuideJournalBodies(name, allEntries);

            await db.close();
        } catch (e) {
            fail(`DB read failed: ${e.message}`);
            try { await db?.close(); } catch { /* ignore */ }
        }

        console.log();
    }

    // Cleanup staging area (only used in default mode)
    if (!VERIFY_ONLY && fs.existsSync(STAGING)) {
        fs.rmSync(STAGING, { recursive: true, force: true });
    }

    // Summary
    console.log("══════════════════════════════════════════════════════");
    if (failures === 0) {
        console.log(`  🟢 ALL PASSED (${passes} checks)`);
        console.log("  Release ZIP will produce working compendiums.");
    } else {
        console.log(`  🔴 ${failures} FAILURE(S), ${passes} passed`);
        console.log("  DO NOT release until all checks pass.");
    }
    console.log("══════════════════════════════════════════════════════\n");

    process.exit(failures > 0 ? 1 : 0);
}

main().catch((err) => {
    console.error("Validation script crashed:", err);
    process.exit(1);
});
