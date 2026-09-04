// 旅行者感染症の鑑別スコアリング（決定論的・透明）。
// ブラウザ（<script type="module">）と Node の両方から import される。
// medical decision-support 目的のみ。確定診断ではない。

export const WEIGHT = { hallmark: 3, common: 2, occasional: 1, against: -2 };
export const BASE_RATE_FACTOR = { very_common: 1.0, common: 0.75, uncommon: 0.45, rare: 0.25 };

// 潜伏期プリセット（曝露終了＝帰国から発症までの日数）の代表値
export const INCUBATION_BUCKETS = {
  lt7: { label: "7日未満", day: 4 },
  d7_13: { label: "7〜13日", day: 10 },
  d14_28: { label: "14〜28日", day: 21 },
  d29_90: { label: "1〜3か月", day: 55 },
  gt90: { label: "3か月以上", day: 150 },
};

const STOPWORDS = new Set([
  "disease", "fever", "virus", "infection", "syndrome", "acute", "the", "and", "of",
  "haemorrhagic", "hemorrhagic", "chronic", "s", "p",
]);

function normTokens(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/haemorrh/g, "hemorrh")
    .replace(/oe/g, "e")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((t) => t && !STOPWORDS.has(t));
}

function tokenMatch(aTokens, bTokens) {
  if (!aTokens.length || !bTokens.length) return false;
  const a = new Set(aTokens);
  const b = new Set(bTokens);
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  if (inter === 0) return false;
  const subset = [...a].every((t) => b.has(t)) || [...b].every((t) => a.has(t));
  return subset || inter >= 2;
}

// CDC は Yellow Fever / Cholera 等を「非推奨」でも全目的地ページに載せるため、
// ワクチン行は「実際に推奨/検討されている」カテゴリのときだけ地理シグナルに使う。
const GEO_VACCINE_CATEGORIES = new Set(["all", "most", "some", "consider"]);

/** KB 疾患が、渡航先ページの diseases[]（＝その地域固有）または推奨ワクチンに載っているか */
function inDestinationList(disease, destData) {
  if (!destData) return false;
  const kbSets = [disease.name_en, ...(disease.aliases_en || [])].map(normTokens);
  const names = [
    ...(destData.diseases || []).map((d) => d.name_en),
    ...(destData.vaccines || [])
      .filter((v) => GEO_VACCINE_CATEGORIES.has(v.category))
      .map((v) => v.name_en),
  ];
  for (const n of names) {
    const nt = normTokens(n);
    if (kbSets.some((kt) => tokenMatch(kt, nt))) return true;
  }
  return false;
}

/** KB 疾患を対象にした現行 Travel Notice が、その渡航先を含むか */
function inNotice(disease, notices, destSlug) {
  if (!notices || !notices.length) return false;
  const kbSets = [disease.name_en, ...(disease.aliases_en || [])].map(normTokens);
  for (const n of notices) {
    const applies = n.is_global || (n.matched_slugs || []).includes(destSlug);
    if (!applies) continue;
    const nt = normTokens(`${n.topic_en || ""} ${n.title_en || ""}`);
    if (kbSets.some((kt) => tokenMatch(kt, nt))) return true;
  }
  return false;
}

function regionOverlap(diseaseRegions, destTags) {
  if (!destTags) return false;
  const set = new Set(destTags);
  return (diseaseRegions || []).some((r) => set.has(r));
}

/** 症状/検査の特異度（hallmark として何疾患に出るか）を事前計算 */
export function computeSpecificity(diseases) {
  const symHallmark = {};
  const labHallmark = {};
  for (const d of diseases) {
    for (const [k, v] of Object.entries(d.symptoms || {})) if (v === "hallmark") symHallmark[k] = (symHallmark[k] || 0) + 1;
    for (const [k, v] of Object.entries(d.labs || {})) if (v === "hallmark") labHallmark[k] = (labHallmark[k] || 0) + 1;
  }
  return { symHallmark, labHallmark };
}

function scoreAxis(selectedIds, diseaseMap, hallmarkCounts) {
  let matched = 0;
  let against = 0;
  let redflag = 0;
  const matchedList = [];
  const againstList = [];
  let denom = 0;
  for (const v of Object.values(diseaseMap)) if (v === "hallmark") denom += 3;
  else if (v === "common") denom += 2;
  denom = Math.max(denom, 3);

  for (const id of selectedIds) {
    const w = diseaseMap[id];
    if (!w) continue;
    if (w === "against") {
      against += 2;
      againstList.push(id);
    } else {
      matched += WEIGHT[w];
      matchedList.push({ id, w });
      if (w === "hallmark" && (hallmarkCounts[id] || 99) <= 3) redflag += 0.3;
    }
  }
  const raw = (matched - against) / denom + redflag;
  return { score: Math.max(0, Math.min(raw, 1.7)), matchedList, againstList };
}

function incubationFactor(disease, days) {
  if (days == null) return { factor: null, fit: "unknown" };
  const inc = disease.incubation_days || {};
  const lo = inc.min;
  const hi = inc.relapse_max != null ? inc.relapse_max : inc.max;
  if (days >= inc.typical_low && days <= inc.typical_high) return { factor: 1.15, fit: "typical" };
  if (days >= lo && days <= hi) return { factor: 1.0, fit: "plausible" };
  if (days < lo) {
    const ratio = days / lo;
    return ratio >= 0.6 ? { factor: 0.55, fit: "early" } : { factor: 0.2, fit: "early" };
  }
  const over = days / hi;
  return over <= 1.5 ? { factor: 0.5, fit: "late" } : { factor: 0.15, fit: "late" };
}

/**
 * @param {object} opts
 * @param {string[]} opts.symptoms  選択された symptom id
 * @param {string[]} opts.labs      選択された lab id
 * @param {string|null} opts.destSlug
 * @param {object|null} opts.destData  渡航先 JSON（diseases[], vaccines[]）
 * @param {object[]}   opts.notices
 * @param {object}     opts.regionMap  slug -> tags[]
 * @param {number|null} opts.incubationDays  曝露終了から発症までの日数（代表値）
 * @param {object[]}   opts.diseases   KB
 * @returns {{ ranked: object[], mustNotMiss: object[] }}
 */
export function rankDifferentials(opts) {
  const {
    symptoms = [],
    labs = [],
    destSlug = null,
    destData = null,
    notices = [],
    regionMap = {},
    incubationDays = null,
    diseases = [],
  } = opts;

  const spec = computeSpecificity(diseases);
  const destTags = destSlug ? regionMap[destSlug] : null;
  const noInput = symptoms.length === 0 && labs.length === 0;

  const results = diseases.map((d) => {
    // --- geo ---
    let geo, geoReason;
    if (!destSlug) {
      geo = 0.85;
      geoReason = "no_dest";
    } else if (inDestinationList(d, destData)) {
      geo = 1.0;
      geoReason = "dest_list";
    } else if (inNotice(d, notices, destSlug)) {
      geo = 0.92;
      geoReason = "notice";
    } else if (regionOverlap(d.regions, destTags)) {
      geo = 0.6;
      geoReason = "region";
    } else if ((d.regions || []).includes("worldwide")) {
      geo = 0.6;
      geoReason = "worldwide";
    } else if (d.cosmopolitan_tropical && destTags && destTags.includes("tropics")) {
      geo = 0.55;
      geoReason = "cosmo_tropical";
    } else {
      geo = 0.15;
      geoReason = "none";
    }

    const sym = scoreAxis(symptoms, d.symptoms || {}, spec.symHallmark);
    const lab = scoreAxis(labs, d.labs || {}, spec.labHallmark);
    const { factor: incFactor, fit: incFit } = incubationFactor(d, incubationDays);

    let clinical = 0.62 * sym.score + 0.38 * lab.score;
    const brf = BASE_RATE_FACTOR[d.base_rate] ?? 0.4;
    clinical *= 0.55 + 0.45 * brf;
    if (incFactor != null) clinical *= incFactor;

    const total = geo * clinical;

    return {
      id: d.id,
      disease: d,
      total,
      factors: {
        geo,
        geoReason,
        symptom: sym.score,
        lab: lab.score,
        incFactor,
        incFit,
        baseRate: d.base_rate,
      },
      matchedSymptoms: sym.matchedList,
      againstSymptoms: sym.againstList,
      matchedLabs: lab.matchedList,
      againstLabs: lab.againstList,
    };
  });

  results.sort((a, b) => b.total - a.total);

  let ranked = [];
  if (!noInput) {
    ranked = results.slice(0, 5);
    const cutoff = ranked.length ? ranked[ranked.length - 1].total * 0.9 : 0;
    for (let i = 5; i < results.length && ranked.length < 8; i++) {
      if (results[i].total >= cutoff && results[i].total > 0) ranked.push(results[i]);
      else break;
    }
    ranked = ranked.filter((r) => r.total > 0);
  }

  const rankedIds = new Set(ranked.map((r) => r.id));
  const floor = ranked.length ? ranked[ranked.length - 1].total * 0.22 : 0;
  const mustNotMiss = results
    .filter(
      (r) =>
        r.disease.must_not_miss &&
        !rankedIds.has(r.id) &&
        r.factors.geo >= 0.5 &&
        r.total >= floor &&
        r.total > 0 &&
        r.matchedSymptoms.length + r.matchedLabs.length >= 2
    )
    .sort((a, b) => b.total - a.total)
    .slice(0, 4);

  return { ranked, mustNotMiss, noInput };
}
