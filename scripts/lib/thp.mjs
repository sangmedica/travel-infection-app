// TravelHealthPro（NaTHNaC・英国）のスクレイプ。
// - 流行フィード: https://travelhealthpro.org.uk/rss-outbreaks.php （robots 許可）
// - 国別ページ: https://travelhealthpro.org.uk/countries/<slug> （robots 許可）
//   ※ 個別ニュース記事 /news/<slug> は robots で不可 → 辿らない
// ライセンス: © Crown Copyright / Open Government Licence v3.0（出典明記で再利用可）

import * as cheerio from "cheerio";
import { fetchText } from "./http.mjs";

export const THP_OUTBREAKS_RSS = "https://travelhealthpro.org.uk/rss-outbreaks.php";
export const thpCountryUrl = (thpSlug) =>
  `https://travelhealthpro.org.uk/countries/${thpSlug}`;
const THP_DELAY_MS = 6000;

function decode(s) {
  return String(s || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/\s+/g, " ")
    .trim();
}
const pick = (block, tag) => {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  return m ? decode(m[1]) : "";
};

const GLOBAL_RE =
  /\b(global|worldwide|multiple countries|multiple|africa|asia|europe|americas|caribbean|south[- ]east asia|middle east|pacific|sub-saharan)\b/i;

/**
 * @param {string} xml
 * @param {{destinations: Array<{slug,name_en,aliases?:string[]}>}} ctx
 */
export function parseThpOutbreaks(xml, ctx = { destinations: [] }) {
  const items = xml.match(/<item>[\s\S]*?<\/item>/gi) || [];
  const aliasToSlug = new Map();
  for (const d of ctx.destinations || []) {
    for (const a of [d.name_en, d.slug, ...(d.aliases || [])])
      aliasToSlug.set(String(a).toLowerCase(), d.slug);
  }
  return items.map((block) => {
    const title = pick(block, "title");
    const summary = pick(block, "description");
    const pubDate = pick(block, "pubDate");
    // "Disease in Place" — 最後の " in " で分割
    let topic = title;
    let place = "";
    const m = title.match(/^(.*)\s+in\s+(.+)$/i);
    if (m) {
      topic = m[1].trim();
      place = m[2].trim();
    }
    const haystack = `${title} ${summary}`.toLowerCase();
    const matched = new Set();
    for (const [alias, slug] of aliasToSlug) {
      const re = new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
      if (re.test(haystack)) matched.add(slug);
    }
    const is_global = GLOBAL_RE.test(place) || matched.size > 8;
    const id = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    return {
      id,
      source: "thp",
      level: null,
      title_en: title,
      topic_en: topic,
      place_en: place,
      countries: [],
      is_global,
      matched_slugs: [...matched],
      summary_en: summary,
      url: "https://travelhealthpro.org.uk/news",
      published: pubDate ? new Date(pubDate).toISOString().slice(0, 10) : null,
    };
  });
}

export async function fetchThpOutbreaks(ctx) {
  const xml = await fetchText(THP_OUTBREAKS_RSS, { delayMs: THP_DELAY_MS });
  return parseThpOutbreaks(xml, ctx);
}

// --- 国別ページ ---

const tidy = (s) =>
  String(s || "")
    .replace(/\s+/g, " ")
    .replace(/\bSHARE PAGE\b/gi, "")
    .trim();

// パネル内の見出し h2 から次の h2 までのテキスト（兄弟走査）。
const headingToNext = ($, panelId, headingText) => {
  const panel = $(`#${panelId}`);
  const h2 = (panel.length ? panel.find("h2") : $("h2"))
    .filter((_, el) => $(el).text().trim().toLowerCase() === headingText.toLowerCase())
    .first();
  if (!h2.length) return "";
  return tidy(h2.nextUntil("h2").text());
};

function tierDiseases($, tierName) {
  const scope = $("#Vaccine_Recommendations");
  const h2 = (scope.length ? scope.find("h2") : $("h2"))
    .filter((_, el) => $(el).text().trim() === tierName)
    .first();
  if (!h2.length) return { intro_en: "", diseases: [] };
  let intro = "";
  const diseases = [];
  let n = h2.next();
  while (n.length && n[0].tagName !== "h2") {
    if (n[0].tagName === "p" && !intro) intro = $(n).text().replace(/\s+/g, " ").trim();
    $(n)
      .find("h4")
      .each((_, el) => {
        const name = $(el).text().trim();
        if (/vaccination$|^Prevention$|schedule$|immunisation|programmes?$/i.test(name)) return;
        const desc = $(el)
          .nextUntil("h4,h3,h2")
          .text()
          .replace(/\s+/g, " ")
          .split(/\s*\bPrevention\b/)[0]
          .split(new RegExp(`\\s*${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} vaccination`, "i"))[0]
          .trim()
          .slice(0, 600);
        if (name && !diseases.some((d) => d.name_en === name))
          diseases.push({ name_en: name, name_ja: null, desc_en: desc, risk_en: "" });
      });
    // 「<disease> in <country>」= 当該国でのリスク記述（h2/h3）
    $(n)
      .find("h2, h3")
      .each((_, el) => {
        const m = $(el).text().trim().match(/^(.+?)\s+in\s+.+$/i);
        if (!m) return;
        const dis = diseases.find((d) => d.name_en.toLowerCase() === m[1].toLowerCase());
        if (dis && !dis.risk_en)
          dis.risk_en = $(el)
            .nextUntil("h2,h3")
            .text()
            .replace(/\s+/g, " ")
            .split(/\s*\bPrevention\b/)[0]
            .replace(/Information on current outbreaks[\s\S]*$/i, "")
            .replace(/([a-z])\.([A-Z])/g, "$1. $2")
            .trim()
            .slice(0, 500);
      });
    n = n.next();
  }
  return { intro_en: intro, diseases };
}

/**
 * @param {string} html
 * @param {{slug,name_en,name_ja,thp}} meta
 */
export function parseThpCountry(html, meta) {
  const $ = cheerio.load(html);
  const tiers = {
    all: tierDiseases($, "All travellers"),
    most: tierDiseases($, "Most travellers"),
    some: tierDiseases($, "Some travellers"),
  };
  const certificate_en = headingToNext($, "Vaccine_Recommendations", "Certificate requirements");
  // Malaria / Other Risks はそれぞれタブパネル（本文は h1 見出し＋段落）
  const panelBody = (id, dropHeading) => {
    const p = $(`#${id}`);
    if (!p.length) return "";
    return tidy(p.text())
      .replace(new RegExp(`^${dropHeading}\\s*`, "i"), "")
      .replace(/Antimalarial recommendations map.*$/i, "")
      .trim();
  };
  const malaria_en = panelBody("Malaria", "Malaria");
  const other_risks_en = panelBody("Other_Risks", "Other Risks");
  const general_info_en = panelBody("General_Information", "General Information");

  const totalDiseases =
    tiers.all.diseases.length + tiers.most.diseases.length + tiers.some.diseases.length;
  const parse_ok = totalDiseases > 0 || !!certificate_en;
  return {
    slug: meta.slug,
    name_en: meta.name_en,
    name_ja: meta.name_ja,
    source: "thp",
    source_url: thpCountryUrl(meta.thp),
    retrieved_at: new Date().toISOString().slice(0, 10),
    tiers,
    certificate_en: certificate_en.slice(0, 1400),
    malaria_en: malaria_en.slice(0, 2000),
    other_risks_en: other_risks_en.slice(0, 2000),
    general_info_en: general_info_en.slice(0, 1400),
    parse_ok,
  };
}

export async function fetchThpCountry(meta) {
  const html = await fetchText(thpCountryUrl(meta.thp), { delayMs: THP_DELAY_MS });
  return parseThpCountry(html, meta);
}
