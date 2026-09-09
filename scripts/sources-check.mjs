#!/usr/bin/env node
// config/source-map.json と data/thp/ · data/forth/ の整合性チェック。
//   node scripts/sources-check.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const read = (p, f = null) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8"));
  } catch {
    return f;
  }
};

const errors = [];
const warn = [];
const E = (m) => errors.push(m);
const W = (m) => warn.push(m);

const cfg = read("config/destinations.json");
const cfgSlugs = new Set(cfg.destinations.map((d) => d.slug));
const sm = read("config/source-map.json", { map: {} });

// --- source-map ---
if (!sm.map || !Object.keys(sm.map).length) E("source-map.json が空");
for (const slug of Object.keys(sm.map || {})) {
  if (!cfgSlugs.has(slug)) E(`source-map: config にない slug "${slug}"`);
  const m = sm.map[slug];
  if (typeof m !== "object" || !("thp" in m) || !("forth" in m))
    E(`source-map: "${slug}" は {thp,forth} を持つべき`);
}
for (const slug of cfgSlugs) if (!(slug in sm.map)) E(`source-map: "${slug}" のエントリがない`);

// --- data/sources.json ---
const src = read("data/sources.json", { sources: {} });
for (const k of ["cdc", "thp", "forth"]) {
  const s = src.sources?.[k];
  if (!s) E(`sources.json: "${k}" がない`);
  else for (const f of ["name_ja", "home_url", "attribution_ja"]) if (!s[f]) E(`sources.json: ${k}.${f} が空`);
}

// --- data/thp/ ---
const thpDir = path.join(ROOT, "data", "thp");
if (fs.existsSync(thpDir)) {
  const ob = read("data/thp/outbreaks.json", []);
  if (!Array.isArray(ob)) E("thp/outbreaks.json が配列でない");
  for (const o of ob || []) {
    if (!o.id || !o.title_en || o.source !== "thp") E(`thp/outbreaks: 不正な項目 ${JSON.stringify(o).slice(0, 80)}`);
    for (const s of o.matched_slugs || []) if (!cfgSlugs.has(s)) E(`thp/outbreaks "${o.id}": 未知 slug ${s}`);
  }
  for (const f of fs.readdirSync(thpDir)) {
    if (f === "outbreaks.json" || !f.endsWith(".json")) continue;
    const slug = f.replace(/\.json$/, "");
    if (!cfgSlugs.has(slug)) E(`thp/${f}: config にない slug`);
    const d = read(`data/thp/${f}`);
    if (!d || !d.tiers || typeof d.parse_ok !== "boolean") E(`thp/${f}: スキーマ不正`);
    if (d && !d.source_url?.startsWith("https://travelhealthpro.org.uk/")) E(`thp/${f}: source_url 不正`);
  }
}

// --- data/forth/ ---
const forthDir = path.join(ROOT, "data", "forth");
if (fs.existsSync(forthDir)) {
  const tp = read("data/forth/topics.json", []);
  if (!Array.isArray(tp)) E("forth/topics.json が配列でない");
  for (const t of tp || []) {
    if (!t.id || !t.title_ja || t.source !== "forth") E(`forth/topics: 不正な項目 ${JSON.stringify(t).slice(0, 80)}`);
    if (typeof t.is_outbreak !== "boolean") E(`forth/topics "${t.id}": is_outbreak が boolean でない`);
    for (const s of t.matched_slugs || []) if (!cfgSlugs.has(s)) E(`forth/topics "${t.id}": 未知 slug ${s}`);
  }
  for (const f of fs.readdirSync(forthDir)) {
    if (f === "topics.json" || !f.endsWith(".json")) continue;
    const slug = f.replace(/\.json$/, "");
    if (!cfgSlugs.has(slug)) E(`forth/${f}: config にない slug`);
    const d = read(`data/forth/${f}`);
    if (!d || !Array.isArray(d.watch_diseases_ja) || !Array.isArray(d.vaccines_ja) || typeof d.parse_ok !== "boolean")
      E(`forth/${f}: スキーマ不正`);
    if (d && !d.source_url?.startsWith("https://www.forth.go.jp/")) E(`forth/${f}: source_url 不正`);
  }
}

console.log(
  `source-map ${Object.keys(sm.map || {}).length} / thp ${
    fs.existsSync(thpDir) ? fs.readdirSync(thpDir).length : 0
  } files / forth ${fs.existsSync(forthDir) ? fs.readdirSync(forthDir).length : 0} files`
);
if (warn.length) for (const w of warn) console.log("  ⚠ " + w);
if (errors.length) {
  console.error(`\n✗ エラー ${errors.length}`);
  for (const e of errors) console.error("  - " + e);
  process.exit(1);
}
console.log("✓ sources 整合性チェック OK");
