#!/usr/bin/env node
// data/entry-requirements.json をローカルの既存データから生成／検証する。
//   node scripts/build-entry-requirements.mjs           生成
//   node scripts/build-entry-requirements.mjs --check   CI 検証（生成物と config の整合）

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildEntryRequirements } from "./lib/entry.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const DATA = path.join(ROOT, "data");
const OUT = path.join(DATA, "entry-requirements.json");
const CHECK = process.argv.includes("--check");

const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "config", "destinations.json"), "utf8"));
const supPath = path.join(DATA, "kb", "entry-supplement.json");
const supplement = fs.existsSync(supPath)
  ? JSON.parse(fs.readFileSync(supPath, "utf8"))
  : { supplements: {} };

if (CHECK) {
  const cfgSlugs = new Set(cfg.destinations.map((d) => d.slug));
  const errs = [];
  for (const k of Object.keys(supplement.supplements || {}))
    if (!cfgSlugs.has(k)) errs.push(`entry-supplement: config にない slug "${k}"`);

  if (!fs.existsSync(OUT)) {
    errs.push("data/entry-requirements.json がありません（`node scripts/build-entry-requirements.mjs` で生成してください）");
  } else {
    const cur = JSON.parse(fs.readFileSync(OUT, "utf8"));
    if (!Array.isArray(cur.destinations)) errs.push("destinations が配列でない");
    else {
      if (cur.destinations.length !== cfg.destinations.length)
        errs.push(`件数不一致: ${cur.destinations.length} != config ${cfg.destinations.length}`);
      for (const r of cur.destinations) {
        if (!cfgSlugs.has(r.slug)) errs.push(`config にない slug: ${r.slug}`);
        if (!r.yellow_fever || typeof r.yellow_fever !== "object") errs.push(`${r.slug}: yellow_fever 欠落`);
        if (!r.sources || !r.sources.cdc) errs.push(`${r.slug}: sources.cdc 欠落`);
        if (typeof r.has_content !== "boolean") errs.push(`${r.slug}: has_content が boolean でない`);
      }
    }
  }
  if (errs.length) {
    console.error(`✗ entry-requirements チェック失敗 (${errs.length})`);
    for (const e of errs) console.error("  - " + e);
    process.exit(1);
  }
  const cur = JSON.parse(fs.readFileSync(OUT, "utf8"));
  console.log(`✓ entry-requirements OK（${cur.counts.with_content}/${cur.counts.total} 地域に内容あり）`);
  process.exit(0);
}

const built = buildEntryRequirements({ cfg, dataDir: DATA, supplement });
fs.writeFileSync(OUT, JSON.stringify(built, null, 2) + "\n");
console.log(`✓ data/entry-requirements.json を生成（${built.counts.with_content}/${built.counts.total} 地域に内容あり）`);
