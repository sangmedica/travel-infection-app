// 月次更新の差分を計算し、トップページ「新規更新」用の changelog エントリを組み立てる。
// 誤訳防止のため、すべての変更項目に英語原文（*_en）を必ず含める。

const CAT_JA = {
  routine: "定期接種（渡航前に最新化）",
  all: "全渡航者に推奨",
  most: "ほとんどの渡航者に推奨",
  some: "一部の渡航者に推奨（条件付き）",
  consider: "検討",
  not_recommended: "推奨しない",
  other: "その他",
};

// 比較用の正規化（表示テキストはそのまま保持）。
// CDC が本文中に差し込む "Updated April 23, 2025" 等の日付スタンプだけの変化は無視する。
const normText = (s) =>
  String(s || "")
    .replace(/updated\s+[a-z]+\s+\d{1,2},\s+\d{4}/gi, "")
    .replace(/see footnotes/gi, "")
    .replace(/\s+/g, " ")
    .trim();

const pickNotice = (n) => ({
  id: n.id,
  level: n.level || 0,
  title_en: n.title_en || "",
  topic_en: n.topic_en || "",
  topic_ja: n.topic_ja || null,
  place_en: n.place_en || "",
  summary_en: n.summary_en || "",
  url: n.url || "",
});

/** Travel Notices の差分（id 基準） */
export function diffNotices(oldArr = [], newArr = []) {
  const oldById = new Map((oldArr || []).map((n) => [n.id, n]));
  const newById = new Map((newArr || []).map((n) => [n.id, n]));
  const added = [];
  const removed = [];
  const level_changed = [];

  for (const n of newArr || []) {
    const o = oldById.get(n.id);
    if (!o) added.push(pickNotice(n));
    else if ((o.level || 0) !== (n.level || 0))
      level_changed.push({ ...pickNotice(n), level_from: o.level || 0, level_to: n.level || 0 });
  }
  for (const o of oldArr || []) {
    if (!newById.has(o.id)) removed.push(pickNotice(o));
  }
  return { added, removed, level_changed };
}

/**
 * 渡航先1件の差分。old / new はいずれも parse_ok のデータ前提。
 * どちらか欠ける（新規対応・解析失敗）場合は差分なし扱い（[]）。
 */
export function diffDestination(oldObj, newObj) {
  if (!oldObj || !newObj) return [];
  const changes = [];

  if ((oldObj.page_notice_level || 0) !== (newObj.page_notice_level || 0)) {
    changes.push({
      type: "page_notice_level",
      from: oldObj.page_notice_level || 0,
      to: newObj.page_notice_level || 0,
    });
  }

  // --- ワクチン（name_en 基準） ---
  const ov = new Map((oldObj.vaccines || []).map((v) => [v.name_en, v]));
  const nv = new Map((newObj.vaccines || []).map((v) => [v.name_en, v]));
  for (const [name, v] of nv) {
    const o = ov.get(name);
    if (!o) {
      changes.push({
        type: "vaccine_added",
        name_en: name,
        name_ja: v.name_ja || null,
        category: v.category,
        category_ja: CAT_JA[v.category] || v.category,
        recommendation_en: v.recommendation_en || "",
      });
    } else if (o.category !== v.category) {
      changes.push({
        type: "vaccine_category",
        name_en: name,
        name_ja: v.name_ja || null,
        from: o.category,
        from_ja: CAT_JA[o.category] || o.category,
        to: v.category,
        to_ja: CAT_JA[v.category] || v.category,
        recommendation_en: v.recommendation_en || "",
      });
    } else if (normText(o.recommendation_en) !== normText(v.recommendation_en)) {
      changes.push({
        type: "vaccine_text",
        name_en: name,
        name_ja: v.name_ja || null,
        category_ja: CAT_JA[v.category] || v.category,
        recommendation_en: v.recommendation_en || "",
        recommendation_en_old: o.recommendation_en || "",
      });
    }
  }
  for (const [name, v] of ov) {
    if (!nv.has(name))
      changes.push({ type: "vaccine_removed", name_en: name, name_ja: v.name_ja || null });
  }

  // --- 非ワクチン疾患（name_en 基準） ---
  const od = new Map((oldObj.diseases || []).map((d) => [d.name_en, d]));
  const nd = new Map((newObj.diseases || []).map((d) => [d.name_en, d]));
  for (const [name, d] of nd) {
    if (!od.has(name)) {
      changes.push({
        type: "disease_added",
        name_en: name,
        name_ja: d.name_ja || null,
        transmission_en: d.transmission_en || "",
        spread_en: d.spread_en || "",
      });
    }
  }
  for (const [name, d] of od) {
    if (!nd.has(name))
      changes.push({ type: "disease_removed", name_en: name, name_ja: d.name_ja || null });
  }

  return changes;
}

/** changelog の1エントリを組み立てる（date は "YYYY-MM-DD"） */
export function buildChangelogEntry(date, noticeDiff, destDiffs) {
  const nd = noticeDiff || { added: [], removed: [], level_changed: [] };
  const dd = (destDiffs || []).filter((x) => x.changes && x.changes.length);

  const counts = {
    vaccine_category: 0,
    vaccine_added: 0,
    vaccine_removed: 0,
    vaccine_text: 0,
    disease_added: 0,
    disease_removed: 0,
    page_notice_level: 0,
  };
  for (const d of dd) for (const c of d.changes) counts[c.type] = (counts[c.type] || 0) + 1;

  const parts = [];
  if (nd.added.length) parts.push(`Travel Notice 新規 ${nd.added.length} 件`);
  if (nd.level_changed.length) parts.push(`Travel Notice レベル変更 ${nd.level_changed.length} 件`);
  if (nd.removed.length) parts.push(`Travel Notice 掲載終了 ${nd.removed.length} 件`);
  if (counts.vaccine_category) parts.push(`ワクチン推奨度の変更 ${counts.vaccine_category} 件`);
  if (counts.vaccine_added) parts.push(`ワクチン追加 ${counts.vaccine_added} 件`);
  if (counts.vaccine_removed) parts.push(`ワクチン削除 ${counts.vaccine_removed} 件`);
  if (counts.vaccine_text) parts.push(`推奨文の更新 ${counts.vaccine_text} 件`);
  if (counts.disease_added) parts.push(`疾患追加 ${counts.disease_added} 件`);
  if (counts.disease_removed) parts.push(`疾患削除 ${counts.disease_removed} 件`);
  if (counts.page_notice_level) parts.push(`地域の注意レベル変更 ${counts.page_notice_level} 件`);

  const hasChanges =
    !!(nd.added.length || nd.removed.length || nd.level_changed.length || dd.length);

  return {
    date,
    has_changes: hasChanges,
    summary_ja: hasChanges
      ? parts.join("、") + (dd.length ? `（対象 ${dd.length} 地域）` : "")
      : "CDC Travelers' Health を確認しました。表示に影響する変更はありませんでした。",
    notices: nd,
    destinations: dd.sort((a, b) => b.changes.length - a.changes.length),
  };
}
