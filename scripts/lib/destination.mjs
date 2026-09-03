// CDC 渡航先ページ (/travel/destinations/traveler/none/<slug>) のパース。
// 対象: 「Vaccines and Medicines」表 (#dest-vm-a) と
//       「Non-Vaccine-Preventable Diseases」表 (#dest-od-a)。

import * as cheerio from "cheerio";
import { fetchText } from "./http.mjs";

export const destUrl = (slug) =>
  `https://wwwnc.cdc.gov/travel/destinations/traveler/none/${slug}`;

/** cheerio 要素 → 箇条書き/段落を「出現順のまま」保った素のテキスト */
function blockText($, el) {
  const $el = $(el);
  if ($el.length === 0) return "";
  const parts = [];
  const seen = new Set();
  const push = (prefix, node) => {
    const t = $(node).text().replace(/\s+/g, " ").trim();
    if (t && !seen.has(prefix + t)) {
      seen.add(prefix + t);
      parts.push(prefix + t);
    }
  };
  // p と li を文書順で拾う。li が親 ul 経由で p の中にあるケースにも対応。
  $el.find("p, li").each((_, node) => {
    if (node.tagName === "li") push("• ", node);
    else {
      // p 直下テキスト（子 ul は別途 li で拾うので p からは除外）
      const $p = $(node).clone();
      $p.find("ul, ol").remove();
      push("", $p);
    }
  });
  if (parts.length === 0) {
    const t = $el.text().replace(/\s+/g, " ").trim();
    if (t) parts.push(t);
  }
  return parts.join("\n");
}

/**
 * ワクチン推奨文 → 正規化カテゴリ。CDC はマークアップ上でカテゴリ分けしていないため
 * 推奨文の言い回しから推定する。原文は必ず recommendation_en に保持する。
 * @returns {"routine"|"all"|"most"|"some"|"consider"|"not_recommended"|"other"}
 */
export function classifyRecommendation(vaccineName, recText) {
  const name = String(vaccineName || "").trim().toLowerCase();
  const t = String(recText || "").toLowerCase().replace(/\s+/g, " ");

  if (name === "routine vaccines") return "routine";

  const saysNotRecommended =
    /vaccine is\s*\**\s*not\s*\**\s*recommended/.test(t) ||
    /cdc does not recommend/.test(t) ||
    /^not recommended/.test(t) ||
    (/\bnot recommended\b/.test(t) && !/\brecommended for\b/.test(t));
  if (saysNotRecommended) return "not_recommended";

  if (/recommended for all travelers/.test(t)) return "all";
  if (/recommended for most travelers/.test(t)) return "most";
  if (/recommended for some travelers/.test(t)) return "some";

  // 麻疹・COVID などの「全員が最新化を」型
  if (
    /all international travelers should be/.test(t) ||
    /all eligible travelers should be up to date/.test(t) ||
    /all travelers should be (fully )?vaccinated/.test(t)
  )
    return "all";

  // 条件付きで推奨
  if (
    /^recommended for\b/.test(t) ||
    /\brecommended for (unvaccinated|travelers who|people|adults|children|those)\b/.test(t) ||
    /\bis recommended for\b/.test(t) ||
    /\bvaccination is recommended\b/.test(t)
  )
    return "some";

  // 検討レベル
  if (
    /may be considered/.test(t) ||
    /consider vaccination/.test(t) ||
    /^consider\b/.test(t) ||
    /should be considered/.test(t)
  )
    return "consider";

  // マラリア（地域限定の予防内服）
  if (name === "malaria") {
    if (/no (chemoprophylaxis|malaria transmission)/.test(t) && !/recommend/.test(t))
      return "consider";
    return "some";
  }

  // 狂犬病は「曝露前接種を個別に検討」型の記述が多い
  if (name === "rabies" && /(pre-exposure|preexposure|consult|consider)/.test(t)) return "consider";

  return "other";
}

/**
 * @param {string} html 渡航先ページの生 HTML
 * @param {{slug:string, name_en:string, name_ja:string}} meta
 */
export function parseDestination(html, meta) {
  const $ = cheerio.load(html);

  // --- ページ全体の Travel Notice レベル（危険度のベースライン） ---
  let pageNoticeLevel = 0;
  const noticeClass = $('[class*="notice-typename-level"]').first().attr("class") || "";
  const nm = noticeClass.match(/notice-typename-level([1-4])/);
  if (nm) pageNoticeLevel = Number(nm[1]);

  // --- ワクチンと医薬品 ---
  const vaccines = [];
  $("#dest-vm-a tbody tr").each((_, tr) => {
    const $tr = $(tr);
    const $name = $tr.find("td.clinician-disease").first();
    if ($name.length === 0) return; // グループ見出し等はスキップ
    const name_en = $name.text().replace(/\s+/g, " ").trim();
    if (!name_en) return;
    const recCell = $tr.find("td.clinician-recomendations").first();
    const guideCell = $tr.find("td.clinician-guidance").first();
    const recommendation_en = blockText($, recCell);
    const category = classifyRecommendation(name_en, recommendation_en);
    vaccines.push({
      name_en,
      name_ja: null,
      category,
      category_ja: null,
      recommendation_en,
      clinical_guidance_en: blockText($, guideCell),
    });
  });

  // --- ワクチンで予防できない疾患 ---
  const diseases = [];
  let currentGroup = "";
  $("#dest-od-a tbody tr").each((_, tr) => {
    const $tr = $(tr);
    const header = $tr.find('th[colspan] h4, th[scope="row"] h4').first();
    if (header.length) {
      currentGroup = header.text().replace(/\s+/g, " ").trim();
      return;
    }
    const $name = $tr.find("td.other-clinician-disease").first();
    if ($name.length === 0) return;
    const name_en = $name.text().replace(/\s+/g, " ").trim();
    if (!name_en) return;
    diseases.push({
      name_en,
      name_ja: null,
      transmission_en: currentGroup,
      transmission_ja: null,
      spread_en: blockText($, $tr.find("td.other-clinician-notes").first()),
      advice_en: blockText($, $tr.find("td.other-clinician-patienteduction").first()),
      clinical_guidance_en: blockText($, $tr.find("td.other-clinician-guidance").first()),
    });
  });

  const parse_ok = vaccines.length > 0; // 必須セクションが取れたか

  return {
    slug: meta.slug,
    name_en: meta.name_en,
    name_ja: meta.name_ja,
    kind: meta.kind || "country",
    source_url: destUrl(meta.slug),
    retrieved_at: new Date().toISOString().slice(0, 10),
    page_notice_level: pageNoticeLevel,
    vaccines,
    diseases,
    parse_ok,
  };
}

export async function fetchDestination(meta) {
  const html = await fetchText(destUrl(meta.slug));
  return parseDestination(html, meta);
}
