#!/usr/bin/env node
/**
 * lint-hbs.mjs — Offline Handlebars template validator
 *
 * Catches parse errors (unclosed blocks, bad helpers, typos) before
 * Foundry discovers them at runtime. Runs Handlebars.precompile()
 * on every .hbs file and reports failures with line numbers.
 *
 * Usage:
 *   node tools/lint-hbs.mjs                # lint all templates
 *   node tools/lint-hbs.mjs --watch        # re-lint on file changes
 *   node tools/lint-hbs.mjs path/to/file   # lint a single file
 *
 * Exit code:
 *   0 — all templates parse successfully
 *   1 — one or more parse errors found
 */

import { readFileSync, readdirSync, statSync, watch } from "node:fs";
import { join, relative, resolve, extname } from "node:path";
import Handlebars from "handlebars";

const ROOT = resolve(import.meta.dirname, "..");
const TEMPLATE_DIR = join(ROOT, "templates");

// ── Helpers that Foundry registers at runtime ────────────────────────
// We register no-op stubs so the parser doesn't choke on custom helpers
// like {{#if (eq a b)}} or {{> partialName}}.
// Handlebars.precompile only needs them declared, not implemented.
const KNOWN_HELPERS = [
    "eq", "ne", "lt", "gt", "lte", "gte",
    "and", "or", "not",
    "times", "add", "subtract",
    "includes", "concat", "json",
    "localize", "numberFormat",
    "filePath", "editor",
    "selectOptions", "checked", "disabled",
];

for (const name of KNOWN_HELPERS) {
    if (!Handlebars.helpers[name]) {
        Handlebars.registerHelper(name, () => {});
    }
}

// ── Collect .hbs files ───────────────────────────────────────────────

function collectHbs(dir) {
    const results = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
            results.push(...collectHbs(full));
        } else if (extname(entry.name) === ".hbs") {
            results.push(full);
        }
    }
    return results;
}

// ── Block-balance check ──────────────────────────────────────────────
// Handlebars.precompile catches most errors, but unclosed blocks at
// the very end sometimes produce cryptic messages. This lightweight
// pass gives a clearer diagnosis.

function checkBlockBalance(source, filePath) {
    const issues = [];
    const stack = [];

    // Single regex that matches both opening and closing block tags in order.
    // Group 1 = opening block type, Group 2 = closing block type.
    const blockTag = /\{\{#(if|each|unless|with|let)\b|\{\{\/(if|each|unless|with|let)\}\}/g;

    const lines = source.split("\n");
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        let m;
        blockTag.lastIndex = 0;

        while ((m = blockTag.exec(line)) !== null) {
            if (m[1]) {
                // Opening block
                stack.push({ type: m[1], line: i + 1 });
            } else if (m[2]) {
                // Closing block
                if (stack.length === 0) {
                    issues.push(`  L${i + 1}: Unexpected {{/${m[2]}}} — no matching opening block`);
                } else {
                    const top = stack.pop();
                    if (top.type !== m[2]) {
                        issues.push(`  L${i + 1}: {{/${m[2]}}} closes {{#${top.type}}} opened at L${top.line}`);
                    }
                }
            }
        }
    }

    for (const unclosed of stack) {
        issues.push(`  L${unclosed.line}: {{#${unclosed.type}}} is never closed`);
    }

    return issues;
}

// ── Lint one file ────────────────────────────────────────────────────

function lintFile(filePath) {
    const rel = relative(ROOT, filePath);
    const source = readFileSync(filePath, "utf-8");

    // 1. Block balance check (clearer errors for unclosed blocks)
    const balanceIssues = checkBlockBalance(source, filePath);
    if (balanceIssues.length > 0) {
        console.error(`\x1b[31m✗\x1b[0m ${rel}`);
        console.error(`  Block balance errors:`);
        for (const issue of balanceIssues) {
            console.error(`\x1b[33m${issue}\x1b[0m`);
        }
        return false;
    }

    // 2. Handlebars precompile (catches syntax errors, bad expressions)
    try {
        Handlebars.precompile(source, {
            knownHelpersOnly: false,
            strict: false,
        });
        return true;
    } catch (err) {
        console.error(`\x1b[31m✗\x1b[0m ${rel}`);

        // Extract line number from Handlebars error
        const lineMatch = err.message?.match(/Parse error on line (\d+)/);
        if (lineMatch) {
            const lineNum = parseInt(lineMatch[1], 10);
            const lines = source.split("\n");
            const start = Math.max(0, lineNum - 3);
            const end = Math.min(lines.length, lineNum + 2);
            console.error(`  Parse error at line ${lineNum}:`);
            for (let i = start; i < end; i++) {
                const marker = i === lineNum - 1 ? "\x1b[31m→\x1b[0m" : " ";
                const num = String(i + 1).padStart(5);
                console.error(`  ${marker}${num} │ ${lines[i]}`);
            }
        }

        // Show the core message (strip the massive stack)
        const coreMsg = err.message?.split("\n").slice(0, 4).join("\n") ?? err.message;
        console.error(`  \x1b[33m${coreMsg}\x1b[0m`);
        return false;
    }
}

// ── Main ─────────────────────────────────────────────────────────────

function run(files) {
    let passed = 0;
    let failed = 0;

    for (const f of files) {
        if (lintFile(f)) {
            passed++;
        } else {
            failed++;
            console.error(""); // blank line between failures
        }
    }

    if (failed > 0) {
        console.error(`\x1b[31m${failed} template(s) failed\x1b[0m, ${passed} passed`);
        return false;
    }
    console.log(`\x1b[32m✓\x1b[0m All ${passed} templates parsed successfully`);
    return true;
}

// ── CLI ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const watchMode = args.includes("--watch");
const explicitFiles = args.filter(a => a !== "--watch" && !a.startsWith("-"));

if (explicitFiles.length > 0) {
    // Lint specific files
    const files = explicitFiles.map(f => resolve(f));
    const ok = run(files);
    if (!watchMode) process.exit(ok ? 0 : 1);
} else {
    // Lint all templates
    const files = collectHbs(TEMPLATE_DIR);
    const ok = run(files);
    if (!watchMode) process.exit(ok ? 0 : 1);
}

if (watchMode) {
    console.log(`\n\x1b[36mWatching ${relative(ROOT, TEMPLATE_DIR)} for changes…\x1b[0m\n`);
    const debounce = new Map();
    watch(TEMPLATE_DIR, { recursive: true }, (event, filename) => {
        if (!filename?.endsWith(".hbs")) return;
        const full = join(TEMPLATE_DIR, filename);
        // Debounce: ignore rapid-fire events from the same file
        if (debounce.has(full)) clearTimeout(debounce.get(full));
        debounce.set(full, setTimeout(() => {
            debounce.delete(full);
            console.log(`\x1b[36m⟳\x1b[0m ${filename}`);
            lintFile(full);
        }, 200));
    });
}
