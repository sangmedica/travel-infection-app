// 月次更新の差分を計算し、トップページ「新規更新」用の changelog エントリを組み立てる。
// 誤訳防止のため、すべての変更項目に原文（CDC/THP=英語、FORTH=日本語）を必ず含める。
// 3 ソース（CDC / TravelHealthPro / FORTH）共通で使える。

const CAT_JA = {
  routine: "定期接種（渡航前に最新化）",
  all: "全渡航者に推奨",
  most: "ほとんどの渡航者に推奨",
  some: "一部の渡航者に推奨（条件付き）",
  consider: "検討",
  not_recommended: "推奨しない",
  other: "その他",
};
const TIER_JA = { all: "全渡航者", most: "ほとんどの渡航者", some: "一部の渡航者" };
const SOURCE_JA = { cdc: "CDC", thp: "TravelHealthPro", forth: "FORTH" };

const normText = (s) =>
  String(s || "")
    .replace(/updated\s+[a-z]+\s+\d{1,2},\s+\d{4}/gi, "")
    .replace(/see footnotes/gi, "")
    .replace(/\s+/g, " ")
    .trim();

const pickFeedItem = (n) => ({
  id: n.id,
  source: n.source || "cdc",
  level: n.level ?? null,
  title_en: n.title_en || "",
  title_ja: n.title_ja || null,
  topic_en: n.topic_en || "",
  topic_ja: n.topic_ja || null,
  place_en: n.place_en || "",
  place_ja: n.place_ja || null,
  summary_en: n.summary_en || "",
  summary_ja: n.summary_ja || null,
  url: n.url || "",
});

/** 流行フィード（CDC notices / THP outbreaks / FORTH topics）の差分（id 基準） */
export function diffFeed(oldArr = [], newArr = []) {
  const oldById = new Map((oldArr || []).map((n) => [n.id, n]));
  const newById = new Map((newArr || []).map((n) => [n.id, n]));
  const added = [];
  const removed = [];
  const level_changed = [];
  for (const n of newArr || []) {
    const o = oldById.get(n.id);
    if (!o) added.push(pickFeedItem(n));
    else if ((o.level ?? null) !== (n.level ?? null) && n.level != null)
      level_changed.push({ ...pickFeedItem(n), level_from: o.level ?? 0, level_to: n.level ?? 0 });
  }
  for (const o of oldArr || []) if (!newById.has(o.id)) removed.push(pickFeedItem(o));
  return { added, removed, level_changed };
}
export const diffNotices = diffFeed; // 後方互換

/** CDC 渡航先1件の差分（old/new とも parse_ok 前提） */
export function diffDestination(oldObj, newObj) {
  if (!oldObj || !newObj) return [];
  const changes = [];
  if ((oldObj.page_notice_level || 0) !== (newObj.page_notice_level || 0))
    changes.push({
      type: "page_notice_level",
      source: "cdc",
      from: oldObj.page_notice_level || 0,
      to: newObj.page_notice_level || 0,
    });

  const ov = new Map((oldObj.vaccines || []).map((v) => [v.name_en, v]));
  const nv = new Map((newObj.vaccines || []).map((v) => [v.name_en, v]));
  for (const [name, v] of nv) {
    const o = ov.get(name);
    if (!o)
      changes.push({
        type: "vaccine_added",
        source: "cdc",
        name_en: name,
        name_ja: v.name_ja || null,
        category_ja: CAT_JA[v.category] || v.category,
        recommendation_en: v.recommendation_en || "",
      });
    else if (o.category !== v.category)
      changes.push({
        type: "vaccine_category",
        source: "cdc",
        name_en: name,
        name_ja: v.name_ja || null,
        from_ja: CAT_JA[o.category] || o.category,
        to_ja: CAT_JA[v.category] || v.category,
        recommendation_en: v.recommendation_en || "",
      });
    else if (normText(o.recommendation_en) !== normText(v.recommendation_en))
      changes.push({
        type: "vaccine_text",
        source: "cdc",
        name_en: name,
        name_ja: v.name_ja || null,
        category_ja: CAT_JA[v.category] || v.category,
        recommendation_en: v.recommendation_en || "",
        recommendation_en_old: o.recommendation_en || "",
      });
  }
  for (const [name, v] of ov)
    if (!nv.has(name))
      changes.push({ type: "vaccine_removed", source: "cdc", name_en: name, name_ja: v.name_ja || null });

  const od = new Map((oldObj.diseases || []).map((d) => [d.name_en, d]));
  const nd = new Map((newObj.diseases || []).map((d) => [d.name_en, d]));
  for (const [name, d] of nd)
    if (!od.has(name))
      changes.push({
        type: "disease_added",
        source: "cdc",
        name_en: name,
        name_ja: d.name_ja || null,
        transmission_en: d.transmission_en || "",
        spread_en: d.spread_en || "",
      });
  for (const [name, d] of od)
    if (!nd.has(name))
      changes.push({ type: "disease_removed", source: "cdc", name_en: name, name_ja: d.name_ja || null });
  return changes;
}

/** TravelHealthPro 国別ページの差分（ティア別ワクチン） */
export function diffThpCountry(oldObj, newObj) {
  if (!oldObj || !newObj) return [];
  const tierOf = (obj) => {
    const m = new Map();
    for (const t of ["all", "most", "some"])
      for (const d of obj.tiers?.[t]?.diseases || []) m.set(d.name_en, { tier: t, desc_en: d.desc_en });
    return m;
  };
  const o = tierOf(oldObj);
  const n = tierOf(newObj);
  const changes = [];
  for (const [name, cur] of n) {
    const prev = o.get(name);
    if (!prev)
      changes.push({
        type: "thp_vaccine_added",
        source: "thp",
        name_en: name,
        tier_ja: TIER_JA[cur.tier],
        desc_en: cur.desc_en || "",
      });
    else if (prev.tier !== cur.tier)
      changes.push({
        type: "thp_vaccine_tier",
        source: "thp",
        name_en: name,
        from_ja: TIER_JA[prev.tier],
        to_ja: TIER_JA[cur.tier],
        desc_en: cur.desc_en || "",
      });
  }
  for (const [name, prev] of o)
    if (!n.has(name))
      changes.push({ type: "thp_vaccine_removed", source: "thp", name_en: name, from_ja: TIER_JA[prev.tier] });
  if (normText(oldObj.malaria_en) !== normText(newObj.malaria_en) && (newObj.malaria_en || ""))
    changes.push({ type: "thp_malaria_text", source: "thp", text_en: newObj.malaria_en });
  return changes;
}

/** FORTH 国別ページの差分（気をつけたい病気・予防接種リスト） */
export function diffForthCountry(oldObj, newObj) {
  if (!oldObj || !newObj) return [];
  const changes = [];
  const setDiff = (oldList, newList) => {
    const os = new Set(oldList || []);
    const ns = new Set(newList || []);
    return {
      added: [...ns].filter((x) => !os.has(x)),
      removed: [...os].filter((x) => !ns.has(x)),
    };
  };
  const w = setDiff(oldObj.watch_diseases_ja, newObj.watch_diseases_ja);
  for (const d of w.added)
    changes.push({ type: "forth_watch_added", source: "forth", name_ja: d });
  for (const d of w.removed)
    changes.push({ type: "forth_watch_removed", source: "forth", name_ja: d });
  const oV = (oldObj.vaccines_ja || []).map((v) => v.name_ja);
  const nV = (newObj.vaccines_ja || []).map((v) => v.name_ja);
  const v = setDiff(oV, nV);
  for (const d of v.added)
    changes.push({ type: "forth_vaccine_added", source: "forth", name_ja: d });
  for (const d of v.removed)
    changes.push({ type: "forth_vaccine_removed", source: "forth", name_ja: d });
  return changes;
}

/**
 * changelog の1エントリを組み立てる。
 * @param {string} date
 * @param {{ cdc?, thp?, forth? }} bySource
 *   各 { feed:{added,removed,level_changed}, countries:[{slug,name_ja,name_en,changes}] }
 */
export function buildChangelogEntry(date, bySource = {}) {
  const sources = {};
  const summaryBits = [];
  let hasChanges = false;

  for (const key of ["cdc", "thp", "forth"]) {
    const s = bySource[key] || {};
    const feed = s.feed || { added: [], removed: [], level_changed: [] };
    const countries = (s.countries || []).filter((c) => c.changes && c.changes.length);
    const feedCount = feed.added.length + feed.removed.length + feed.level_changed.length;
    const chgCount = countries.reduce((a, c) => a + c.changes.length, 0);
    if (feedCount === 0 && chgCount === 0) {
      sources[key] = { has_changes: false, feed, countries: [] };
      continue;
    }
    hasChanges = true;
    sources[key] = {
      has_changes: true,
      feed,
      countries: countries.sort((a, b) => b.changes.length - a.changes.length),
    };
    const bits = [];
    if (feed.added.length) bits.push(`流行情報 新規 ${feed.added.length}`);
    if (feed.level_changed.length) bits.push(`レベル変更 ${feed.level_changed.length}`);
    if (feed.removed.length) bits.push(`掲載終了 ${feed.removed.length}`);
    if (chgCount) bits.push(`国別の変更 ${chgCount} 件（${countries.length} 地域）`);
    summaryBits.push(`${SOURCE_JA[key]}: ${bits.join("、")}`);
  }

  return {
    date,
    has_changes: hasChanges,
    summary_ja: hasChanges
      ? summaryBits.join(" ／ ")
      : "CDC・TravelHealthPro・FORTH を確認しました。表示に影響する変更はありませんでした。",
    sources,
  };
}
