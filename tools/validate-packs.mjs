/**
 * Validates compendium source JSON against packs/src/SIGNOFF.json.
 * Node built-ins only. Exits 0 on pass, 1 on failure.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MODULE_ROOT = path.resolve(__dirname, "..");

const PACK_SRC = path.join(MODULE_ROOT, "packs", "src");
const SIGNOFF_PATH = path.join(PACK_SRC, "SIGNOFF.json");

const ITEMS_DIR = path.join(PACK_SRC, "respite-items");
const ACTORS_DIR = path.join(PACK_SRC, "respite-actors");
const GUIDE_DIR = path.join(PACK_SRC, "respite-guide");

const BLOCKING_STATUSES = new Set(["draft", "test", "pending-review"]);

function listPackJsonFiles(dirPath) {
  if (!fs.existsSync(dirPath)) {
    return [];
  }
  return fs
    .readdirSync(dirPath)
    .filter(
      (name) => name.endsWith(".json") && !name.startsWith("_")
    )
    .sort();
}

function stripHtml(html) {
  if (typeof html !== "string") {
    return "";
  }
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isPlaceholderName(name) {
  if (typeof name !== "string") {
    return true;
  }
  const n = name.trim();
  const lower = n.toLowerCase();
  if (lower.startsWith("test")) {
    return true;
  }
  if (lower.startsWith("placeholder")) {
    return true;
  }
  if (lower.startsWith("todo")) {
    return true;
  }
  if (n.startsWith("[")) {
    return true;
  }
  if (/^item \d+$/i.test(n)) {
    return true;
  }
  if (lower === "new item") {
    return true;
  }
  return false;
}

function isStubDescription(rawValue) {
  if (typeof rawValue !== "string") {
    return true;
  }
  const text = stripHtml(rawValue);
  if (text.length === 0) {
    return true;
  }
  const norm = text.toLowerCase();
  if (norm === "tbd" || norm === "placeholder") {
    return true;
  }
  if (text.length < 20) {
    return true;
  }
  return false;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function main() {
  let signoff;
  try {
    signoff = readJson(SIGNOFF_PATH);
  } catch (err) {
    console.error(`Failed to read ${SIGNOFF_PATH}:`, err.message);
    process.exit(1);
  }

  const sections = [
    { key: "items", label: "respite-items", dir: ITEMS_DIR },
    { key: "actors", label: "respite-actors", dir: ACTORS_DIR },
    { key: "guide", label: "respite-guide", dir: GUIDE_DIR }
  ];

  const allFiles = [];
  for (const { key, label, dir } of sections) {
    const names = listPackJsonFiles(dir);
    if (fs.existsSync(dir)) {
      console.log(`Checking packs/src/${label}/ ... ${names.length} file${names.length === 1 ? "" : "s"}`);
    }
    for (const name of names) {
      allFiles.push({ sectionKey: key, label, dir, name, fullPath: path.join(dir, name) });
    }
  }

  const coverageErrors = [];
  const statusErrors = [];
  const aiErrors = [];
  const placeholderNameErrors = [];
  const stubErrors = [];
  const orphanWarnings = [];

  const signoffItems = signoff.items && typeof signoff.items === "object" ? signoff.items : {};
  const signoffActors = signoff.actors && typeof signoff.actors === "object" ? signoff.actors : {};
  const signoffGuide = signoff.guide && typeof signoff.guide === "object" ? signoff.guide : {};

  const signoffMap = { items: signoffItems, actors: signoffActors, guide: signoffGuide };

  for (const file of allFiles) {
    const entry = signoffMap[file.sectionKey][file.name];
    if (!entry) {
      coverageErrors.push(`${file.label}/${file.name} (missing from SIGNOFF.json → ${file.sectionKey})`);
      continue;
    }

    const status = entry.status;
    if (BLOCKING_STATUSES.has(status)) {
      statusErrors.push(`${file.name} (${status})`);
    } else if (status !== "approved") {
      statusErrors.push(`${file.name} (${status ?? "missing"})`);
    }

    if (entry.assetSource === "ai-generated") {
      aiErrors.push(file.name);
    }

    let doc;
    try {
      doc = readJson(file.fullPath);
    } catch (err) {
      coverageErrors.push(`${file.name} (unreadable: ${err.message})`);
      continue;
    }

    if (isPlaceholderName(doc.name)) {
      placeholderNameErrors.push(`${file.name} (name: ${JSON.stringify(doc.name)})`);
    }

    const descVal = doc.system?.description?.value;
    if (typeof descVal === "string") {
      if (isStubDescription(descVal)) {
        stubErrors.push(`${file.name}`);
      }
    }
  }

  const coverageFailCount = coverageErrors.length;
  const fileTotal = allFiles.length;

  for (const { key, label, dir } of sections) {
    const table = signoffMap[key];
    if (!fs.existsSync(dir)) {
      for (const orphanName of Object.keys(table)) {
        orphanWarnings.push(`${key}/${orphanName} (no packs/src/${label}/ directory)`);
      }
      continue;
    }
    for (const orphanName of Object.keys(table)) {
      const fp = path.join(dir, orphanName);
      if (!fs.existsSync(fp)) {
        orphanWarnings.push(`${key}/${orphanName}`);
      }
    }
  }

  const coverageOk = coverageFailCount === 0;
  console.log("");
  console.log(
    coverageOk
      ? `✅ Coverage: ${fileTotal}/${fileTotal} files signed off`
      : `❌ Coverage: ${coverageFailCount} problem(s) — ${coverageErrors.join(", ")}`
  );

  if (statusErrors.length > 0) {
    console.log(`❌ Status blocked (${statusErrors.length}): ${statusErrors.join(", ")}`);
  } else {
    console.log("✅ Status: all entries approved");
  }

  if (aiErrors.length > 0) {
    console.log(`❌ AI assets: ${aiErrors.join(", ")}`);
  } else {
    console.log("✅ AI assets: none");
  }

  if (placeholderNameErrors.length > 0) {
    console.log(`❌ Placeholder names: ${placeholderNameErrors.join(", ")}`);
  } else {
    console.log("✅ Placeholder names: none");
  }

  if (stubErrors.length > 0) {
    console.log(`❌ Stub descriptions: ${stubErrors.join(", ")}`);
  } else {
    console.log("✅ Stub descriptions: none");
  }

  console.log(`⚠️  Orphans: ${orphanWarnings.length}`);
  if (orphanWarnings.length > 0) {
    for (const w of orphanWarnings) {
      console.log(`   (orphan) ${w}`);
    }
  }
  console.log("");

  const failed =
    coverageFailCount > 0 ||
    statusErrors.length > 0 ||
    aiErrors.length > 0 ||
    placeholderNameErrors.length > 0 ||
    stubErrors.length > 0;

  if (failed) {
    const parts = [];
    if (coverageFailCount > 0) {
      parts.push(`${coverageFailCount} coverage error(s)`);
    }
    if (statusErrors.length > 0) {
      parts.push(`${statusErrors.length} status error(s)`);
    }
    if (aiErrors.length > 0) {
      parts.push(`${aiErrors.length} AI asset error(s)`);
    }
    if (placeholderNameErrors.length > 0) {
      parts.push(`${placeholderNameErrors.length} placeholder name error(s)`);
    }
    if (stubErrors.length > 0) {
      parts.push(`${stubErrors.length} stub description error(s)`);
    }
    console.log(
      `Pack validation FAILED — ${parts.join(", ")}. Promote items to "approved" in packs/src/SIGNOFF.json to release.`
    );
    process.exit(1);
  }

  console.log("Pack validation passed.");
  process.exit(0);
}

main();
