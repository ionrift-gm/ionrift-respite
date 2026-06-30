/**
 * validate-icon-paths.mjs
 *
 * Checks pack source and cooking overlay JSON for Foundry core icon paths
 * that are not in the migration/catalog and not present on disk.
 *
 * Set FOUNDRY_RESOURCES to your Foundry install resources/ folder for
 * filesystem checks when the catalog is incomplete.
 *
 * Usage:
 *   node tools/validate-icon-paths.mjs
 */

import {
    validateAllContentIcons,
    resolveFoundryResourcesRoot
} from "./icon-path-catalog.mjs";

const { failures, catalogSize } = validateAllContentIcons();
const resourcesRoot = resolveFoundryResourcesRoot();

console.log("\n══════════════════════════════════════════════════════");
console.log("  Icon path validation");
console.log("══════════════════════════════════════════════════════\n");
console.log(`Catalog entries: ${catalogSize}`);
console.log(`Foundry resources: ${resourcesRoot ?? "not found (catalog-only mode)"}\n`);

if (failures.length === 0) {
    console.log("All icon paths passed.\n");
    process.exit(0);
}

console.error(`Found ${failures.length} suspect icon path(s):\n`);
for (const fail of failures) {
    console.error(`  ${fail.img}`);
    console.error(`    at ${fail.path} (${fail.reason})\n`);
}
console.error("Add verified paths to tools/verified-core-icons.json or fix the reference.\n");
process.exit(1);
