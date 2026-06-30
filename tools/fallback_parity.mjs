/**
 * fallback_parity.mjs
 *
 * Static analysis guard against GM/player fallback mismatches.
 *
 * Scans source files for nullish-coalescing fallbacks on terrain fields
 * that must stay identical across GM (TravelResolutionDelegate) and
 * player (RestSetupApp) code paths.
 *
 * Usage: node tools/fallback_parity.mjs
 * CI:    exits 1 on mismatch, 0 on pass.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS = path.resolve(__dirname, '../scripts');

/**
 * Each entry defines a field that must have the same fallback default
 * in every file that references it via nullish coalescing.
 */
const PARITY_RULES = [
    {
        field: 'travelActivities',
        pattern: /\.travelActivities\s*\?\?\s*(\[.*?\])/g,
        description: 'GM and player travel activity fallbacks must match'
    }
];

function extractFallbacks(rule) {
    const results = [];
    const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (entry.isDirectory()) {
                if (['node_modules', '.git'].includes(entry.name)) continue;
                walk(path.join(dir, entry.name));
            } else if (entry.name.endsWith('.js')) {
                const filePath = path.join(dir, entry.name);
                const content = fs.readFileSync(filePath, 'utf8');
                const lines = content.split('\n');
                for (let i = 0; i < lines.length; i++) {
                    let m;
                    const regex = new RegExp(rule.pattern.source, rule.pattern.flags);
                    while ((m = regex.exec(lines[i])) !== null) {
                        results.push({
                            file: path.relative(SCRIPTS, filePath),
                            line: i + 1,
                            fallback: m[1].replace(/\s+/g, ''),
                            raw: lines[i].trim()
                        });
                    }
                }
            }
        }
    };
    walk(SCRIPTS);
    return results;
}

console.log('\n--- Fallback Parity Check ---\n');

let failures = 0;

for (const rule of PARITY_RULES) {
    const hits = extractFallbacks(rule);

    if (hits.length === 0) {
        console.log(`⚠  No occurrences of ${rule.field} fallback found. Rule may be stale.`);
        continue;
    }

    const unique = new Set(hits.map(h => h.fallback));

    if (unique.size === 1) {
        console.log(`✅ ${rule.field}: ${hits.length} occurrences, all use ${[...unique][0]}`);
    } else {
        console.log(`❌ ${rule.field}: MISMATCH DETECTED`);
        console.log(`   ${rule.description}`);
        console.log(`   Found ${unique.size} distinct fallbacks:`);
        for (const hit of hits) {
            console.log(`     ${hit.file}:${hit.line}  →  ${hit.fallback}`);
        }
        failures++;
    }
}

// Also verify every terrain manifest has travelActivities defined
const TERRAINS_DIR = path.resolve(__dirname, '../data/terrains');
const manifest = JSON.parse(fs.readFileSync(path.join(TERRAINS_DIR, 'manifest.json'), 'utf8'));
const missingField = [];

for (const terrainId of (manifest.released ?? [])) {
    const terrainPath = path.join(TERRAINS_DIR, terrainId, 'terrain.json');
    if (!fs.existsSync(terrainPath)) continue;
    const terrain = JSON.parse(fs.readFileSync(terrainPath, 'utf8'));
    if (!('travelActivities' in terrain)) {
        missingField.push(terrainId);
    }
}

if (missingField.length > 0) {
    console.log(`\n⚠  ${missingField.length} terrain(s) missing explicit travelActivities (relying on fallback):`);
    console.log(`   ${missingField.join(', ')}`);
    console.log(`   Consider adding the field to prevent future GM/player divergence.`);
}

console.log('');

if (failures > 0) {
    console.log(`❌ ${failures} parity failure(s). Fix before release.\n`);
    process.exit(1);
} else {
    console.log(`✅ All parity checks passed.\n`);
}
