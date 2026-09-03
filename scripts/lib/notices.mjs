// CDC Travel Notices RSS のパースと正規化。
// フィード: https://wwwnc.cdc.gov/travel/rss/notices.xml

import { fetchText } from "./http.mjs";

export const NOTICES_RSS_URL = "https://wwwnc.cdc.gov/travel/rss/notices.xml";

function decodeEntities(s) {
  return String(s || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/\s+/g, " ")
    .trim();
}

const pick = (block, tag) => {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  return m ? decodeEntities(m[1]) : "";
};

/** タイトル "Level 2 - Zika in Indonesia" / URL "/notices/level2/..." から Level を抽出 */
function extractLevel(title, link) {
  const t = title.match(/level\s*([1-4])/i);
  if (t) return Number(t[1]);
  const l = link.match(/\/level([1-4])\//i);
  if (l) return Number(l[1]);
  return 0;
}

/** "Level 2 - Zika in Indonesia" -> { topic: "Zika", place: "Indonesia" } */
function splitTitle(title) {
  const stripped = title.replace(/^\s*level\s*[1-4]\s*[-–:]\s*/i, "").trim();
  const inMatch = stripped.match(/^(.*?)\s+in\s+(.+)$/i);
  if (inMatch) return { topic: inMatch[1].trim(), place: inMatch[2].trim() };
  return { topic: stripped, place: "" };
}

/** description 内の "Country List :  A, B, C" を配列化（重複除去） */
function extractCountryList(description) {
  const names = new Set();
  const re = /Country List\s*:\s*([\s\S]*?)(?=Country List\s*:|$)/gi;
  let m;
  while ((m = re.exec(description))) {
    for (const part of m[1].split(/,|、/)) {
      const name = part.replace(/\s+/g, " ").replace(/[.;]+$/, "").trim();
      if (name && name.length >= 2 && name.length <= 40 && !/\d/.test(name)) names.add(name);
    }
  }
  return [...names];
}

/**
 * 生 RSS 文字列 → 正規化済み notice 配列
 * @param {string} xml
 * @param {{destinations: Array<{slug,name_en,name_ja,aliases:string[]}>}} ctx
 */
export function parseNotices(xml, ctx = { destinations: [] }) {
  const items = xml.match(/<item>[\s\S]*?<\/item>/gi) || [];
  const aliasToSlug = new Map();
  for (const d of ctx.destinations || []) {
    for (const a of [d.name_en, d.slug, ...(d.aliases || [])]) {
      aliasToSlug.set(String(a).toLowerCase(), d.slug);
    }
  }

  return items.map((block) => {
    const title = pick(block, "title");
    const description = pick(block, "description");
    const link = pick(block, "link") || pick(block, "guid");
    const pubDate = pick(block, "pubDate");
    const level = extractLevel(title, link);
    const { topic, place } = splitTitle(title);
    const countryNames = extractCountryList(description);
    // 表示用サマリーからは繰り返しがちな "Country List : ..." 以降を落とす
    const summary = description.replace(/\s*Country List\s*:[\s\S]*$/i, "").trim() || description;
    const haystack = `${title} ${place} ${countryNames.join(" ")} ${description}`.toLowerCase();

    // 既知の渡航先 slug との突き合わせ
    const matchedSlugs = new Set();
    for (const [alias, slug] of aliasToSlug) {
      const re = new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
      if (re.test(haystack)) matchedSlugs.add(slug);
    }

    // 特定国ではなく地域・世界規模の注意喚起か
    const is_global =
      /\b(global|worldwide|multiple countries)\b/i.test(`${title} ${place}`) ||
      /\b(sub-saharan africa|africa|asia|europe|caribbean|south america|central america|middle east|pacific)\b/i.test(
        place
      ) ||
      countryNames.length > 8;

    const id =
      (link.match(/\/notices\/(?:level[1-4]\/)?([^/?#]+)/i)?.[1] || "")
        .toLowerCase() || title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

    return {
      id,
      level, // 0 = 不明
      title_en: title,
      topic_en: topic,
      place_en: place,
      countries: countryNames,
      is_global,
      matched_slugs: [...matchedSlugs],
      summary_en: summary,
      url: link,
      published: pubDate ? new Date(pubDate).toISOString().slice(0, 10) : null,
    };
  });
}

export async function fetchNotices(ctx) {
  const xml = await fetchText(NOTICES_RSS_URL);
  const notices = parseNotices(xml, ctx);
  return { notices, raw_length: xml.length };
}

export const LEVEL_LABELS = {
  1: { en: "Practice Usual Precautions", ja: "通常の予防（レベル1）" },
  2: { en: "Practice Enhanced Precautions", ja: "強化された予防（レベル2）" },
  3: { en: "Reconsider Nonessential Travel", ja: "不要不急の渡航は再検討（レベル3）" },
  4: { en: "Avoid All Travel", ja: "渡航中止勧告（レベル4）" },
  0: { en: "Unknown", ja: "不明" },
};
