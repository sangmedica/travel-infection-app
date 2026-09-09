// FORTH（厚生労働省検疫所）のスクレイプ。
// - 新着/発生情報: https://www.forth.go.jp/topics/fragment1.html （RSS なし）
// - 国別ページ: https://www.forth.go.jp/destinations/country/<page>.html
// ライセンス: 公共データ利用規約1.0（出典明記＋編集・加工の明示）。日本語。

import * as cheerio from "cheerio";
import { fetchText } from "./http.mjs";

export const FORTH_TOPICS_URL = "https://www.forth.go.jp/topics/fragment1.html";
export const forthCountryUrl = (page) =>
  `https://www.forth.go.jp/destinations/country/${page}.html`;
const FORTH_DELAY_MS = 6000;
const BASE = "https://www.forth.go.jp";

const clean = (s) =>
  String(s || "")
    .replace(/　/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// 一般案内（発生情報ではない）と判定するためのキーワード
const NON_OUTBREAK_RE =
  /ワールドカップ|オリンピック|注意ください|過ごし方|検疫について|見直し|お知らせ|とは|募集|調査|アンケート|リニューアル|メンテナンス|一覧|ください！$/;
// 発生情報らしさ（疾患名を含む／「－」で場所を伴う）
const OUTBREAK_HINT_RE =
  /熱|症|インフルエンザ|ウイルス|マラリア|コレラ|ペスト|エボラ|結核|狂犬病|はしか|麻疹|ポリオ|ジフテリア|髄膜炎|チフス|肝炎|ムポックス|エムポックス|痘/;

/**
 * @param {string} html topics/fragment1.html
 * @param {{destinations:Array<{slug,name_ja,name_en,aliases?:string[]}>, diseaseJaToEn?:Map}} ctx
 */
export function parseForthTopics(html, ctx = { destinations: [] }) {
  const $ = cheerio.load(html);
  const jaToSlug = new Map();
  for (const d of ctx.destinations || []) {
    const names = [d.name_ja, ...(d.aliases || [])].filter(Boolean);
    for (const n of names) jaToSlug.set(String(n).replace(/（.*?）/g, "").trim(), d.slug);
  }
  const d2e = ctx.diseaseJaToEn || new Map();

  const rows = [];
  $("a").each((_, el) => {
    const href = $(el).attr("href") || "";
    if (!/\/topics\/(20\d\d\/)?[a-z0-9_.]+\.html/i.test(href)) return;
    if (/fragment1\.html/.test(href)) return;
    const raw = clean($(el).text());
    // "2026年09月02日 タイトル NEW"
    const m = raw.match(/^(20\d\d)年(\d{1,2})月(\d{1,2})日\s*(.+?)(?:\s*NEW)?$/);
    if (!m) return;
    const published = `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
    const title = m[4].trim();
    if (rows.some((r) => r.title === title && r.published === published)) return;

    // 「疾患名－場所（日付）」を分解（区切りは全角ハイフン/マイナス/ダッシュのみ。長音「ー」は除外）
    let disease_ja = "";
    let place_ja = "";
    const dm = title.match(/^(.+?)\s*[－−—–]\s*(.+)$/);
    if (dm) {
      const lhs = dm[1].trim();
      const rhs = dm[2].replace(/（.*?）|\(.*?\)/g, "").trim();
      // 右辺が略語コード（PHEIC 等）の場合は左右を入れ替えない（disease は左のまま）
      if (/^[A-Z]{3,8}$/.test(rhs)) {
        disease_ja = lhs;
        place_ja = "";
      } else {
        disease_ja = lhs;
        place_ja = rhs;
      }
    }
    const is_outbreak =
      !NON_OUTBREAK_RE.test(title) &&
      (!!disease_ja || OUTBREAK_HINT_RE.test(title));

    const is_global = /世界|グローバル|各国|複数の国|地域/.test(place_ja || title);
    const hay = title;
    const matched = new Set();
    for (const [ja, slug] of jaToSlug) {
      if (ja && ja.length >= 2 && hay.includes(ja)) matched.add(slug);
    }
    const topic_en = disease_ja ? d2e.get(disease_ja) || null : null;
    const url = href.startsWith("http") ? href : BASE + (href.startsWith("/") ? href : "/topics/" + href);

    rows.push({
      id: url.replace(/^https?:\/\/[^/]+\//, "").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, ""),
      source: "forth",
      level: null,
      title_ja: title,
      title_en: null,
      topic_ja: disease_ja || null,
      topic_en,
      place_ja: place_ja || null,
      place_en: null,
      is_outbreak,
      is_global,
      matched_slugs: [...matched],
      summary_ja: "",
      summary_en: null,
      url,
      published,
    });
  });
  rows.sort((a, b) => (b.published || "").localeCompare(a.published || ""));
  return rows;
}

export async function fetchForthTopics(ctx) {
  const html = await fetchText(FORTH_TOPICS_URL, { delayMs: FORTH_DELAY_MS });
  return parseForthTopics(html, ctx);
}

// --- 国別ページ ---

function forthSection($, headingText) {
  const h2 = $("h2")
    .filter((_, el) => clean($(el).text()).replace(/\s/g, "") === headingText.replace(/\s/g, ""))
    .first();
  if (!h2.length) return null;
  // h2 は div.m-hdgLv2 の中。その次の div.m-grid が本文。
  let wrap = h2.closest("div.m-hdgLv2");
  if (!wrap.length) wrap = h2.parent();
  let body = wrap.next();
  // 次が m-grid でなければさらに探す
  for (let i = 0; i < 3 && body.length && !body.is("div.m-grid"); i++) body = body.next();
  if (!body.length) body = wrap.nextUntil("div.m-hdgLv2");
  return body;
}

/**
 * @param {string} html
 * @param {{slug,name_en,name_ja,forth}} meta
 */
export function parseForthCountry(html, meta) {
  const $ = cheerio.load(html);
  const page_title_ja = clean($("h1").first().text());

  const watch = forthSection($, "気候と気をつけたい病気");
  const watch_text_ja = watch ? clean(watch.text()).slice(0, 1600) : "";
  const watch_diseases_ja = [];
  if (watch) {
    watch.find("a").each((_, el) => {
      const t = clean($(el).text());
      if (t && t.length <= 24 && !/https?:|詳しく|こちら|ページ|FORTH/.test(t) && !watch_diseases_ja.includes(t))
        watch_diseases_ja.push(t);
    });
  }

  const vax = forthSection($, "受けておきたい予防接種、持っていきたい薬");
  let vaccine_line_ja = "";
  const vaccines_ja = [];
  if (vax) {
    const full = clean(vax.text());
    // 脚注定義: 「*1：犬や野生動物との…」
    const notes = {};
    for (const nm of full.matchAll(/[\*＊](\d)\s*[：:]\s*([^\*＊。]+)/g)) {
      // 「農村部に長期滞在する場合は推奨」等。次文（黄熱…／なお…／また…）が続く場合は切る
      notes[nm[1]] = nm[2].split(/\s(?=黄熱|なお|また|その他|渡航)/)[0].trim().slice(0, 80);
    }
    // ワクチン列は「予防接種：」の直後〜（最初の脚注定義 / 「。」/「薬：」）まで
    const vm = full.match(/予防接種[：:]\s*([\s\S]*?)(?:[\*＊]\d\s*[：:]|。|\s*薬[：:]|$)/);
    vaccine_line_ja = vm ? vm[1].trim() : "";
    for (const part of vaccine_line_ja.split(/[、,]/)) {
      const fn = part.match(/[\*＊](\d)/);
      const name_ja = part.replace(/[（）()]/g, "").replace(/[\*＊]\d/g, "").trim();
      if (
        !name_ja ||
        name_ja.length > 12 ||
        /予防接種|です|ます|必要|含め|場合|証明書|入国|渡航/.test(name_ja)
      )
        continue;
      vaccines_ja.push({
        name_ja,
        conditional: /[（(]/.test(part) || !!fn,
        note_ja: fn ? notes[fn[1]] || null : null,
      });
    }
    // 脚注定義も含めた原文行（UI で全文表示できるように）
    vaccine_line_ja = (vm ? "予防接種：" + vm[1].trim() : "") +
      Object.entries(notes).map(([k, v]) => ` *${k}：${v}`).join("");
  }

  const parse_ok = !!page_title_ja && (watch_diseases_ja.length > 0 || vaccines_ja.length > 0 || !!watch_text_ja);
  return {
    slug: meta.slug,
    name_en: meta.name_en,
    name_ja: meta.name_ja,
    source: "forth",
    source_url: forthCountryUrl(meta.forth),
    forth_page: meta.forth,
    page_title_ja,
    is_regional_page: /部$|諸国$|地域$|中東$|中米$|ヨーロッパ|アジア諸国/.test(page_title_ja) || meta.forth.includes("_") === false && /africa|europe|_area|melanesia|polynesia|micronesia|^ca$|^cs$|ocac/.test(meta.forth),
    retrieved_at: new Date().toISOString().slice(0, 10),
    watch_diseases_ja,
    watch_text_ja,
    vaccine_line_ja,
    vaccines_ja,
    parse_ok,
  };
}

export async function fetchForthCountry(meta) {
  const html = await fetchText(forthCountryUrl(meta.forth), { delayMs: FORTH_DELAY_MS });
  return parseForthCountry(html, meta);
}
