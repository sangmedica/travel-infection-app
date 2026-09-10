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
  for (const f of ["name_en", "name_ja", "cdc_url", "category", "discriminators_ja", "discriminators_en", "workup_ja", "treatment_ja", "treatment_en"])
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

// ============ 機能③〜⑧ の追加 KB（作り切り・自動更新の対象外）============
const readOpt = (f) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(KB, f), "utf8"));
  } catch (e) {
    E(`${f}: 読み込み失敗 (${e.message})`);
    return null;
  }
};
const isArr = (v) => Array.isArray(v) && v.length > 0;

// --- vaccine-schedules.json（機能③）---
const vsched = readOpt("vaccine-schedules.json");
const schedIds = new Set();
for (const v of vsched?.vaccines || []) {
  const tag = `vaccine-schedules:${v.id}`;
  if (!v.id || schedIds.has(v.id)) E(`${tag}: id が空または重複`);
  schedIds.add(v.id);
  for (const f of ["name_ja", "name_en", "source_ja", "standard_ja"])
    if (!v[f]) E(`${tag}: "${f}" が空`);
  if (!Number.isInteger(v.doses) || v.doses < 1) E(`${tag}: doses が不正`);
  if (!Array.isArray(v.schedule_days) || v.schedule_days.length !== v.doses)
    E(`${tag}: schedule_days の長さが doses (${v.doses}) と一致しない`);
  else {
    if (v.schedule_days[0] !== 0) E(`${tag}: schedule_days は 0 で始まるべき`);
    for (let i = 1; i < v.schedule_days.length; i++)
      if (!(v.schedule_days[i] > v.schedule_days[i - 1])) E(`${tag}: schedule_days が昇順でない`);
  }
  if (v.accelerated_days != null) {
    if (!Array.isArray(v.accelerated_days) || v.accelerated_days[0] !== 0)
      E(`${tag}: accelerated_days は null または 0 始まりの配列`);
  }
  if (!Number.isFinite(v.last_dose_lead_days) || v.last_dose_lead_days < 0)
    E(`${tag}: last_dose_lead_days が不正`);
  if (typeof v.single_dose_useful !== "boolean") E(`${tag}: single_dose_useful が boolean でない`);
  if (typeof v.live !== "boolean") E(`${tag}: live が boolean でない`);
  if (!Array.isArray(v.match_en)) E(`${tag}: match_en が配列でない`);
}

// --- malaria-drugs.json（機能④）---
const mdrugs = readOpt("malaria-drugs.json");
const mdrugIds = new Set();
for (const d of mdrugs?.drugs || []) {
  const tag = `malaria-drugs:${d.id}`;
  if (!d.id || mdrugIds.has(d.id)) E(`${tag}: id が空または重複`);
  mdrugIds.add(d.id);
  for (const f of ["name_ja", "name_en", "schedule_ja", "start_ja", "after_ja", "adult_dose_ja", "pediatric_ja", "pregnancy_ja", "contraindications_ja", "adverse_ja", "cost_tier_ja", "source_ja"])
    if (!d[f]) E(`${tag}: "${f}" が空`);
  if (typeof d.g6pd_required !== "boolean") E(`${tag}: g6pd_required が boolean でない`);
}

// --- post-return.json（機能⑥）---
const pret = readOpt("post-return.json");
if (pret) {
  if (!isArr(pret.common_first_line_ja)) E("post-return: common_first_line_ja が空");
  if (!isArr(pret.syndromes)) E("post-return: syndromes が空");
  const synIds = new Set();
  for (const s of pret.syndromes || []) {
    const tag = `post-return:${s.id}`;
    if (!s.id || synIds.has(s.id)) E(`${tag}: id が空または重複`);
    synIds.add(s.id);
    if (!s.label_ja) E(`${tag}: label_ja が空`);
    for (const f of ["initial_workup_ja", "red_flags_ja", "differentials_ja"])
      if (!isArr(s[f])) E(`${tag}: "${f}" が空`);
    if (!s.when_to_refer_ja) E(`${tag}: when_to_refer_ja が空`);
    for (const df of s.differentials_ja || []) {
      if (!df.name_ja) E(`${tag}: differential に name_ja がない`);
      if (df.dx_id && !dIds.has(df.dx_id)) E(`${tag}: 未知の dx_id "${df.dx_id}"（diseases.json に存在しない）`);
    }
  }
  const vhf = pret.vhf_isolation_ja || {};
  if (!isArr(vhf.criteria_ja) || !isArr(vhf.immediate_actions_ja))
    E("post-return: vhf_isolation_ja の criteria_ja / immediate_actions_ja が不足");
  if (!isArr(pret.notifiable_ja?.categories)) E("post-return: notifiable_ja.categories が空");
  for (const c of pret.notifiable_ja?.categories || [])
    if (!c.class_ja || !isArr(c.diseases_ja)) E(`post-return: notifiable カテゴリ "${c.class_ja || "?"}" が不正`);
}

// --- special-populations.json（機能⑦）---
const spop = readOpt("special-populations.json");
const spopIds = new Set();
for (const p of spop?.populations || []) {
  const tag = `special-populations:${p.id}`;
  if (!p.id || spopIds.has(p.id)) E(`${tag}: id が空または重複`);
  spopIds.add(p.id);
  for (const f of ["label_ja", "summary_ja", "yellow_fever_ja", "altitude_ja", "source_ja"])
    if (!p[f]) E(`${tag}: "${f}" が空`);
  if (!p.live_vaccines_ja || !p.live_vaccines_ja.status || !p.live_vaccines_ja.detail_ja)
    E(`${tag}: live_vaccines_ja の status / detail_ja が不足`);
  if (!p.malaria_ja || !p.malaria_ja.preferred_ja || !p.malaria_ja.avoid_ja)
    E(`${tag}: malaria_ja の preferred_ja / avoid_ja が不足`);
  if (!isArr(p.other_ja)) E(`${tag}: other_ja が空`);
}

// --- packing.json（機能⑧）---
const packing = readOpt("packing.json");
const PACK_WHEN_KEYS = new Set(["malaria", "altitude_m_gte", "yellow_fever", "freshwater", "dengue", "je", "cholera", "rabies", "typhoid"]);
for (const c of packing?.categories || []) {
  if (!c.id || !c.title_ja || !isArr(c.items_ja)) E(`packing: category "${c.id || "?"}" が不正`);
}
if (!isArr(packing?.categories)) E("packing: categories が空");
for (const r of packing?.conditional_rules || []) {
  const tag = `packing-rule:${r.id}`;
  if (!r.id || !r.title_ja || !isArr(r.add_ja)) E(`${tag}: id / title_ja / add_ja が不足`);
  if (!r.when || typeof r.when !== "object") E(`${tag}: when が不正`);
  else for (const k of Object.keys(r.when)) if (!PACK_WHEN_KEYS.has(k)) E(`${tag}: 未知の when キー "${k}"`);
}

// --- altitude.json（機能⑧補助）---
const alt = readOpt("altitude.json");
for (const [slug, pts] of Object.entries(alt?.destinations || {})) {
  if (!cfgSlugs.has(slug)) E(`altitude: config にない slug "${slug}"`);
  if (!isArr(pts)) E(`altitude: "${slug}" の地点リストが空`);
  for (const p of pts || []) if (!p.place_ja || !Number.isFinite(p.m)) E(`altitude: "${slug}" の地点に place_ja / m がない`);
}

// --- entry-supplement.json（機能⑤補足）---
const esup = readOpt("entry-supplement.json");
for (const slug of Object.keys(esup?.supplements || {}))
  if (!cfgSlugs.has(slug)) E(`entry-supplement: config にない slug "${slug}"`);

console.log(`疾患 ${diseases.length} / 症状 ${symptomIds.size} / 検査 ${labIds.size} / region-map ${Object.keys(regionMap).length} slug`);
console.log(`must_not_miss: ${diseases.filter((d) => d.must_not_miss).length} 疾患`);
console.log(
  `診療リファレンス KB: ワクチン ${vsched?.vaccines?.length ?? 0} / マラリア薬 ${mdrugs?.drugs?.length ?? 0} / 帰国後症候 ${pret?.syndromes?.length ?? 0} / 特殊集団 ${spop?.populations?.length ?? 0} / 携行キット規則 ${packing?.conditional_rules?.length ?? 0} / 高地 ${Object.keys(alt?.destinations ?? {}).length} slug`
);
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
