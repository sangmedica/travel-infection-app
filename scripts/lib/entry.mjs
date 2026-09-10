// data/entry-requirements.json（機能⑤『予防接種証明書・入国要件の横断表』）を
// ローカルの既存データから組み立てる。ネットワーク取得はしない。
// 入力: CDC 渡航先 JSON の Yellow Fever ワクチン行 / THP 国別 JSON の certificate_en /
//       data/kb/entry-supplement.json（ポリオ出国接種・ハッジ髄膜炎菌の補足）。

import fs from "node:fs";
import path from "node:path";

/** CDC の Yellow Fever recommendation_en から「Country entry requirements:」以降を抜き出す */
export function extractYfCertEn(recEn) {
  if (!recEn) return null;
  const m = recEn.match(/Country entry requirements:?\s*([\s\S]*)$/i);
  if (!m) return null;
  const body = m[1]
    .replace(/\n?\s*See footnotes\s*$/i, "")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
  return body || null;
}

/** CDC の Yellow Fever recommendation_en から証明書が「必要」と読めるか大まかに判定 */
export function yfCertRequired(certEn) {
  if (!certEn) return "unknown";
  const t = certEn.toLowerCase();
  const req = /vaccine is required|is required for travelers|proof of (yellow fever )?vaccination is required/.test(t);
  const notReq = /vaccine is not required|no (yellow fever )?vaccination (certificate )?required|not required/.test(t);
  if (req && !/not required/.test(t.replace(/is not required/g, ""))) return "required_from_risk";
  if (req) return "required_from_risk";
  if (notReq) return "not_required";
  return "unknown";
}

/**
 * @param {{destinations:Array}} cfg  config/destinations.json
 * @param {string} dataDir            .../data
 * @param {{supplements:object}} supplement  data/kb/entry-supplement.json
 */
export function buildEntryRequirements({ cfg, dataDir, supplement = { supplements: {} } }) {
  const destDir = path.join(dataDir, "destinations");
  const thpDir = path.join(dataDir, "thp");
  const rd = (p) => {
    try {
      return JSON.parse(fs.readFileSync(p, "utf8"));
    } catch {
      return null;
    }
  };
  const sup = supplement.supplements || {};

  const destinations = cfg.destinations.map((d) => {
    const dest = rd(path.join(destDir, `${d.slug}.json`));
    const thp = rd(path.join(thpDir, `${d.slug}.json`));
    const yf = (dest?.vaccines || []).find((v) => /yellow\s*fever/i.test(v.name_en));
    const s = sup[d.slug] || {};
    const cdcCertEn = extractYfCertEn(yf?.recommendation_en);
    const row = {
      slug: d.slug,
      name_ja: d.name_ja,
      name_en: d.name_en,
      kind: d.kind || "country",
      yellow_fever: {
        cdc_category: yf?.category || null,
        cdc_recommendation_en: yf?.recommendation_en || null,
        cdc_certificate_en: cdcCertEn,
        cdc_cert_status: yfCertRequired(cdcCertEn),
        thp_certificate_en: thp?.certificate_en || null,
      },
      polio_exit_note_ja: s.polio_exit_note_ja || null,
      polio_exit_en: s.polio_exit_en || null,
      meningococcal_note_ja: s.meningococcal_note_ja || null,
      other_note_ja: s.other_note_ja || null,
      supplement_source_ja: s.source_ja || null,
      sources: {
        cdc: dest?.source_url || `https://wwwnc.cdc.gov/travel/destinations/traveler/none/${d.slug}`,
        thp: thp?.source_url || null,
      },
    };
    row.has_content = !!(
      row.yellow_fever.cdc_certificate_en ||
      row.yellow_fever.thp_certificate_en ||
      row.polio_exit_note_ja ||
      row.meningococcal_note_ja
    );
    return row;
  });

  return {
    _comment:
      "入国・出国時の予防接種要件。CDC 渡航先ページの黄熱ワクチン行と TravelHealthPro の Certificate requirements から機械抽出し、data/kb/entry-supplement.json（ポリオ出国接種・ハッジ髄膜炎菌）をマージ。黄熱の要否・年齢下限・免除条件は国と出発地により異なるため、必ず CDC / THP 原文と渡航先国大使館の最新情報を確認すること。",
    retrieved_at: new Date().toISOString().slice(0, 10),
    counts: {
      total: destinations.length,
      with_content: destinations.filter((r) => r.has_content).length,
    },
    destinations,
  };
}
