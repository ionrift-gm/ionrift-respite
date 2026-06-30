#!/usr/bin/env node
/**
 * CI gate: block residual debug logging in runtime scripts.
 * Catches tagged bisection traces and raw console.log/debug that bypass Logger.
 */
import { readdirSync, readFileSync } from "fs";
import { join, relative } from "path";

const ROOT = join(import.meta.dirname, "..", "scripts");
const SKIP_FILES = new Set(["lib/Logger.js"]);

/** Debug tag prefixes that must not ship in production code. */
const FORBIDDEN_TAG = /\[SYNC-BISECT\]|\[CLOSE-DEBUG\]|\[CAMP-DIAG\]|\[REJOIN\]|\[station-fade\]|\[DBG\]|receivePlayerChoices DEBUG|\[SYNC\]|\[Respite:State\]/;

/** Raw console.log/debug outside Logger (allow eslint-disable-next-line on same line). */
const RAW_CONSOLE = /\bconsole\.(log|debug)\s*\(/;

function walk(dir, files = []) {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, ent.name);
        if (ent.isDirectory()) walk(p, files);
        else if (ent.name.endsWith(".js")) files.push(p);
    }
    return files;
}

const violations = [];

for (const file of walk(ROOT)) {
    const rel = relative(ROOT, file).replace(/\\/g, "/");
    if (SKIP_FILES.has(rel)) continue;

    const lines = readFileSync(file, "utf8").split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lineNo = i + 1;

        if (FORBIDDEN_TAG.test(line)) {
            violations.push({ rel, lineNo, kind: "forbidden-tag", text: line.trim() });
            continue;
        }

        if (!RAW_CONSOLE.test(line)) continue;
        if (/eslint-disable.*no-console/.test(line)) continue;
        if (i > 0 && /eslint-disable-next-line no-console/.test(lines[i - 1])) continue;

        violations.push({ rel, lineNo, kind: "raw-console", text: line.trim() });
    }
}

if (violations.length) {
    console.error(`Debug logging gate failed (${violations.length} violation(s)):\n`);
    for (const v of violations) {
        console.error(`  ${v.rel}:${v.lineNo} [${v.kind}] ${v.text.slice(0, 120)}`);
    }
    console.error("\nUse Logger.log() for debug output (gated on ionrift-library debug setting).");
    console.error("Remove bisection tags like [SYNC-BISECT], [CLOSE-DEBUG], [CAMP-DIAG].");
    process.exit(1);
}

console.log("Debug logging gate passed.");
