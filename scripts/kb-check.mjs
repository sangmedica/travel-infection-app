#!/usr/bin/env node
// data/kb/ の知識ベースの整合性チェック。CI と手元の両方で実行する。
//   node scripts/kb-check.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KB = path.join(__dirname, "..", "data", "kb");
const read = (f) => JSON.parse(fs.readFileSync(path.join(KB, f), "utf8"));

const findings = read("findings.json");
const diseases = read("diseases.json").diseases;
const regionMap = read("region-map.json").regions;

const symptomIds = new Set(findings.symptoms.map((s) => s.id));
const labIds = new Set(findings.labs.map((l) => l.id));
const WEIGHTS = new Set(["hallmark", "common", "occasional", "against"]);
const BASE_RATES = new Set(["very_common", "common", "uncommon", "rare"]);

// region-map に現れるタグ + 疾患側だけで使う wildcard
const regionTags = new Set();
for (const tags of Object.values(regionMap)) for (const t of tags) regionTags.add(t);
regionTags.add("worldwide");

const errors = [];
const warnings = [];
const E = (m) => errors.push(m);
const W = (m) => warnings.push(m);

// --- findings 内の id 重複 ---
const seen = new Set();
for (const s of [...findings.symptoms, ...findings.labs]) {
  if (seen.has(s.id)) E(`findings: id 重複 "${s.id}"`);
  seen.add(s.id);
  if (!s.label_ja || !s.label_en || !s.group) E(`findings: "${s.id}" に label_ja/label_en/group が不足`);
}

// --- diseases ---
const dIds = new Set();
for (const d of diseases) {
  const tag = `diseases:${d.id}`;
  if (dIds.has(d.id)) E(`${tag}: id 重複`);
  dIds.add(d.id);
  for (const f of ["name_en", "name_ja", "cdc_url", "category", "discriminators_ja", "discriminators_en", "workup_ja"])
    if (!d[f]) E(`${tag}: "${f}" が空`);
  if (typeof d.must_not_miss !== "boolean") E(`${tag}: must_not_miss が boolean でない`);
  if (!BASE_RATES.has(d.base_rate)) E(`${tag}: base_rate 不正 "${d.base_rate}"`);

  const inc = d.incubation_days || {};
  const { min, typical_low, typical_high, max } = inc;
  if (![min, typical_low, typical_high, max].every((n) => Number.isFinite(n)))
    E(`${tag}: incubation_days に数値でない項目`);
  else if (!(min <= typical_low && typical_low <= typical_high && typical_high <= max))
    E(`${tag}: incubation_days の順序が不正 (${min} ≤ ${typical_low} ≤ ${typical_high} ≤ ${max})`);
  if (inc.relapse_max != null && !(inc.relapse_max >= max))
    E(`${tag}: relapse_max (${inc.relapse_max}) は max (${max}) 以上であるべき`);

  const sym = d.symptoms || {};
  const lab = d.labs || {};
  const symKeys = Object.keys(sym);
  if (symKeys.length < 3) E(`${tag}: symptoms が 3 未満 (${symKeys.length})`);
  for (const [k, v] of Object.entries(sym)) {
    if (!symptomIds.has(k)) E(`${tag}: 未知の symptom id "${k}"`);
    if (!WEIGHTS.has(v)) E(`${tag}: symptom "${k}" の重み不正 "${v}"`);
  }
  for (const [k, v] of Object.entries(lab)) {
    if (!labIds.has(k)) E(`${tag}: 未知の lab id "${k}"`);
    if (!WEIGHTS.has(v)) E(`${tag}: lab "${k}" の重み不正 "${v}"`);
  }
  const hallmarkCommon = [...Object.values(sym), ...Object.values(lab)].filter((v) => v === "hallmark" || v === "common");
  if (hallmarkCommon.length === 0) W(`${tag}: hallmark/common の所見が 1 つもない`);

  if (!Array.isArray(d.regions) || d.regions.length === 0) E(`${tag}: regions が空`);
  for (const r of d.regions || []) if (!regionTags.has(r)) E(`${tag}: 未知の region タグ "${r}"`);
  if (typeof d.cosmopolitan_tropical !== "boolean") E(`${tag}: cosmopolitan_tropical が boolean でない`);
}

// --- region-map: 全 slug が config に一致し、タグを持つ ---
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "config", "destinations.json"), "utf8"));
const cfgSlugs = new Set(cfg.destinations.map((d) => d.slug));
for (const slug of cfgSlugs) if (!regionMap[slug] || regionMap[slug].length === 0) E(`region-map: "${slug}" のタグがない`);
for (const slug of Object.keys(regionMap)) if (!cfgSlugs.has(slug)) E(`region-map: config にない slug "${slug}"`);

// --- 参照されない finding（情報）---
const usedS = new Set(), usedL = new Set();
for (const d of diseases) {
  for (const k of Object.keys(d.symptoms || {})) usedS.add(k);
  for (const k of Object.keys(d.labs || {})) usedL.add(k);
}
const unusedS = [...symptomIds].filter((id) => !usedS.has(id));
const unusedL = [...labIds].filter((id) => !usedL.has(id));
if (unusedS.length) W(`どの疾患からも参照されない symptom: ${unusedS.join(", ")}`);
if (unusedL.length) W(`どの疾患からも参照されない lab: ${unusedL.join(", ")}`);

console.log(`疾患 ${diseases.length} / 症状 ${symptomIds.size} / 検査 ${labIds.size} / region-map ${Object.keys(regionMap).length} slug`);
console.log(`must_not_miss: ${diseases.filter((d) => d.must_not_miss).length} 疾患`);
if (warnings.length) {
  console.log(`\n⚠ 警告 ${warnings.length}`);
  for (const w of warnings) console.log("  - " + w);
}
if (errors.length) {
  console.error(`\n✗ エラー ${errors.length}`);
  for (const e of errors) console.error("  - " + e);
  process.exit(1);
}
console.log("\n✓ KB 整合性チェック OK");
