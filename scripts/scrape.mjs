#!/usr/bin/env node
// 3 ソース（CDC / TravelHealthPro / FORTH）からデータを取得し data/ 配下を更新する。
//
// 使い方:
//   node scripts/scrape.mjs                        全ソース・全渡航先
//   node scripts/scrape.mjs --source=thp           TravelHealthPro のみ
//   node scripts/scrape.mjs --source=cdc --only=thailand
//   node scripts/scrape.mjs --notices-only         各ソースの流行フィードのみ（国別ページは取得しない）
//   node scripts/scrape.mjs --retranslate          ネットワーク取得なし。CDC 既存 JSON に対訳辞書を再適用
//   node scripts/scrape.mjs --dry-run
//
// 環境変数: SCRAPE_DELAY_MS（CDC の Crawl-delay 20000ms 既定）, SCRAPE_CONTACT

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { fetchNotices } from "./lib/notices.mjs";
import { fetchDestination } from "./lib/destination.mjs";
import { fetchThpOutbreaks, fetchThpCountry } from "./lib/thp.mjs";
import { fetchForthTopics, fetchForthCountry } from "./lib/forth.mjs";
import { loadDict, makeTranslator, writeUntranslated } from "./lib/translate.mjs";
import {
  diffFeed,
  diffDestination,
  diffThpCountry,
  diffForthCountry,
  buildChangelogEntry,
} from "./lib/diff.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const DEST_DIR = path.join(DATA_DIR, "destinations");
const THP_DIR = path.join(DATA_DIR, "thp");
const FORTH_DIR = path.join(DATA_DIR, "forth");
const CONFIG_PATH = path.join(ROOT, "config", "destinations.json");
const SOURCEMAP_PATH = path.join(ROOT, "config", "source-map.json");

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (name) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=").slice(1).join("=") : null;
};
const DRY = has("--dry-run");
const ONLY = val("only");
const NOTICES_ONLY = has("--notices-only");
const DEST_ONLY = has("--dest-only");
const RETRANSLATE = has("--retranslate");
const SOURCE = (val("source") || "all").toLowerCase();
const doCdc = SOURCE === "all" || SOURCE === "cdc";
const doThp = (SOURCE === "all" || SOURCE === "thp") && !RETRANSLATE;
const doForth = (SOURCE === "all" || SOURCE === "forth") && !RETRANSLATE;
const TODAY = new Date().toISOString().slice(0, 10);

const readJSON = (p, fallback = null) => {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return fallback;
  }
};
const writeJSON = (p, obj) => {
  if (DRY) {
    console.log(`  [dry-run] would write ${path.relative(ROOT, p)}`);
    return;
  }
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + "\n");
};
const stripVolatile = (obj) => JSON.stringify(obj, (k, v) => (k === "retrieved_at" ? undefined : v));
const changedVsDisk = (p, obj) => stripVolatile(readJSON(p, {})) !== stripVolatile(obj);

let anyChange = false;
const errors = [];

async function main() {
  const cfg = readJSON(CONFIG_PATH);
  if (!cfg?.destinations?.length) throw new Error(`config が読めません: ${CONFIG_PATH}`);
  const sourceMap = readJSON(SOURCEMAP_PATH, { map: {} }).map;
  let destList = cfg.destinations;
  if (ONLY) {
    destList = destList.filter((d) => d.slug === ONLY);
    if (destList.length === 0) throw new Error(`--only=${ONLY} は config に存在しません`);
  }

  const dict = loadDict();
  const tr = makeTranslator(dict);
  const partial = !!(ONLY || NOTICES_ONLY || DEST_ONLY || SOURCE !== "all");
  const buildChangelog = !RETRANSLATE && !partial;

  // 日本語疾患名 -> 英語（FORTH topics の topic_en 補完用）
  const kb = readJSON(path.join(DATA_DIR, "kb", "diseases.json"), { diseases: [] });
  const diseaseJaToEn = new Map();
  for (const [enKey, ja] of Object.entries(dict.diseases || {}))
    if (ja) diseaseJaToEn.set(ja, enKey.replace(/\b\w/g, (c) => c.toUpperCase()));
  for (const d of kb.diseases || []) if (d.name_ja && d.name_en) diseaseJaToEn.set(d.name_ja, d.name_en);

  const cdcNoticeDiff = { added: [], removed: [], level_changed: [] };
  const cdcDestDiffs = [];
  const thpFeedDiff = { added: [], removed: [], level_changed: [] };
  const thpCountryDiffs = [];
  const forthFeedDiff = { added: [], removed: [], level_changed: [] };
  const forthCountryDiffs = [];

  const applyDict = (data) => {
    for (const v of data.vaccines || []) {
      v.name_ja = tr.lookup("vaccines", v.name_en);
      v.category_ja = dict.categories?.[v.category] ?? null;
    }
    for (const d of data.diseases || []) {
      d.name_ja = tr.lookup("diseases", d.name_en);
      d.transmission_ja = tr.lookup("transmission", d.transmission_en);
    }
    return data;
  };

  // ============ CDC ============
  if (doCdc && !DEST_ONLY) {
    const outPath = path.join(DATA_DIR, "notices.json");
    const old = readJSON(outPath, []);
    try {
      let notices;
      if (RETRANSLATE) {
        console.log("● CDC Travel Notices に対訳を再適用 …");
        notices = readJSON(outPath, []);
      } else {
        console.log("● CDC Travel Notices を取得中 …");
        notices = (await fetchNotices({ destinations: cfg.destinations })).notices;
      }
      for (const n of notices) {
        n.source = "cdc";
        n.title_ja = null;
        n.topic_ja = tr.lookup("notice_topics", n.topic_en);
      }
      notices.sort((a, b) => (b.published || "").localeCompare(a.published || "") || (b.level || 0) - (a.level || 0));
      if (buildChangelog) Object.assign(cdcNoticeDiff, diffFeed(old, notices));
      if (changedVsDisk(outPath, notices)) anyChange = true;
      writeJSON(outPath, notices);
      console.log(`  ✓ ${notices.length} 件`);
    } catch (err) {
      console.error(`  ✗ CDC Notices: ${err.message}`);
      errors.push({ source: "cdc", scope: "notices", reason: err.message });
    }
  }
  if (doCdc && !NOTICES_ONLY) {
    for (const meta of destList) {
      const outPath = path.join(DEST_DIR, `${meta.slug}.json`);
      const old = readJSON(outPath);
      try {
        let data;
        if (RETRANSLATE) {
          data = readJSON(outPath);
          if (!data) {
            console.log(`● ${meta.slug}: 既存データなし、スキップ`);
            continue;
          }
          console.log(`● CDC ${meta.name_en} (${meta.slug}) に対訳を再適用 …`);
        } else {
          console.log(`● CDC ${meta.name_en} (${meta.slug}) …`);
          data = await fetchDestination(meta);
          if (!data.parse_ok)
            throw new Error(`必須セクション解析不可（vaccines=${data.vaccines.length}）`);
        }
        applyDict(data);
        if (buildChangelog && old?.parse_ok && data.parse_ok) {
          const ch = diffDestination(old, data);
          if (ch.length)
            cdcDestDiffs.push({ slug: meta.slug, name_ja: meta.name_ja, name_en: meta.name_en, changes: ch });
        }
        if (changedVsDisk(outPath, data)) anyChange = true;
        writeJSON(outPath, data);
        console.log(`  ✓ ワクチン ${data.vaccines.length} / 疾患 ${data.diseases.length}`);
      } catch (err) {
        console.error(`  ✗ CDC ${meta.slug}: ${err.message}`);
        errors.push({ source: "cdc", scope: meta.slug, reason: err.message });
      }
    }
  }

  // ============ TravelHealthPro ============
  if (doThp) {
    if (!DEST_ONLY) {
      const outPath = path.join(THP_DIR, "outbreaks.json");
      const old = readJSON(outPath, []);
      try {
        console.log("● TravelHealthPro 流行フィードを取得中 …");
        const ob = await fetchThpOutbreaks({ destinations: cfg.destinations });
        if (buildChangelog) Object.assign(thpFeedDiff, diffFeed(old, ob));
        if (changedVsDisk(outPath, ob)) anyChange = true;
        writeJSON(outPath, ob);
        console.log(`  ✓ ${ob.length} 件`);
      } catch (err) {
        console.error(`  ✗ THP outbreaks: ${err.message}`);
        errors.push({ source: "thp", scope: "outbreaks", reason: err.message });
      }
    }
    if (!NOTICES_ONLY) {
      for (const meta of destList) {
        const thp = sourceMap[meta.slug]?.thp;
        if (!thp) continue;
        const outPath = path.join(THP_DIR, `${meta.slug}.json`);
        const old = readJSON(outPath);
        try {
          console.log(`● THP ${meta.name_en} (${meta.slug}) …`);
          const data = await fetchThpCountry({ ...meta, thp });
          if (!data.parse_ok) throw new Error("必須セクション解析不可");
          if (buildChangelog && old?.parse_ok) {
            const ch = diffThpCountry(old, data);
            if (ch.length)
              thpCountryDiffs.push({ slug: meta.slug, name_ja: meta.name_ja, name_en: meta.name_en, changes: ch });
          }
          if (changedVsDisk(outPath, data)) anyChange = true;
          writeJSON(outPath, data);
          const nd = data.tiers.most.diseases.length + data.tiers.some.diseases.length;
          console.log(`  ✓ ワクチン ${nd} / malaria ${data.malaria_en ? "有" : "無"}`);
        } catch (err) {
          console.error(`  ✗ THP ${meta.slug}: ${err.message}`);
          errors.push({ source: "thp", scope: meta.slug, reason: err.message });
        }
      }
    }
  }

  // ============ FORTH ============
  if (doForth) {
    if (!DEST_ONLY) {
      const outPath = path.join(FORTH_DIR, "topics.json");
      const old = readJSON(outPath, []);
      try {
        console.log("● FORTH 新着・発生情報を取得中 …");
        const tp = await fetchForthTopics({ destinations: cfg.destinations, diseaseJaToEn });
        const feedNew = tp.filter((t) => t.is_outbreak);
        if (buildChangelog) Object.assign(forthFeedDiff, diffFeed(old.filter((t) => t.is_outbreak), feedNew));
        if (changedVsDisk(outPath, tp)) anyChange = true;
        writeJSON(outPath, tp);
        console.log(`  ✓ ${tp.length} 件（発生情報 ${feedNew.length}）`);
      } catch (err) {
        console.error(`  ✗ FORTH topics: ${err.message}`);
        errors.push({ source: "forth", scope: "topics", reason: err.message });
      }
    }
    if (!NOTICES_ONLY) {
      const seenForthPage = new Set();
      for (const meta of destList) {
        const forth = sourceMap[meta.slug]?.forth;
        if (!forth) continue;
        const outPath = path.join(FORTH_DIR, `${meta.slug}.json`);
        const old = readJSON(outPath);
        try {
          console.log(`● FORTH ${meta.name_en} (${meta.slug}) -> ${forth} …`);
          const data = await fetchForthCountry({ ...meta, forth });
          if (!data.parse_ok) throw new Error("必須セクション解析不可");
          if (buildChangelog && old?.parse_ok) {
            const ch = diffForthCountry(old, data);
            if (ch.length)
              forthCountryDiffs.push({ slug: meta.slug, name_ja: meta.name_ja, name_en: meta.name_en, changes: ch });
          }
          if (changedVsDisk(outPath, data)) anyChange = true;
          writeJSON(outPath, data);
          console.log(`  ✓ 病気 ${data.watch_diseases_ja.length} / ワクチン ${data.vaccines_ja.length}`);
        } catch (err) {
          console.error(`  ✗ FORTH ${meta.slug}: ${err.message}`);
          errors.push({ source: "forth", scope: meta.slug, reason: err.message });
        }
      }
    }
  }

  // ============ 検索インデックス ============
  const index = cfg.destinations
    .map((d) => {
      const f = readJSON(path.join(DEST_DIR, `${d.slug}.json`));
      return {
        slug: d.slug,
        name_en: d.name_en,
        name_ja: d.name_ja,
        kind: d.kind || "country",
        aliases: d.aliases || [],
        has_data: !!f,
        retrieved_at: f?.retrieved_at ?? null,
        page_notice_level: f?.page_notice_level ?? 0,
        thp: !!sourceMap[d.slug]?.thp && fs.existsSync(path.join(THP_DIR, `${d.slug}.json`)),
        forth: !!sourceMap[d.slug]?.forth && fs.existsSync(path.join(FORTH_DIR, `${d.slug}.json`)),
      };
    })
    .sort((a, b) => a.name_ja.localeCompare(b.name_ja, "ja"));
  const indexPath = path.join(DATA_DIR, "destinations-index.json");
  if (changedVsDisk(indexPath, index)) anyChange = true;
  writeJSON(indexPath, index);

  // ============ 未対訳ログ ============
  const missingCount = writeUntranslated(tr.dumpMissing(), { dryRun: DRY, partial });
  if (missingCount) console.log(`● 未対訳の語: ${missingCount} 件`);

  // ============ changelog.json ============
  if (buildChangelog) {
    const clPath = path.join(DATA_DIR, "changelog.json");
    const log = readJSON(clPath, []) || [];
    const entry = buildChangelogEntry(TODAY, {
      cdc: { feed: cdcNoticeDiff, countries: cdcDestDiffs },
      thp: { feed: thpFeedDiff, countries: thpCountryDiffs },
      forth: { feed: forthFeedDiff, countries: forthCountryDiffs },
    });
    const next = [entry, ...log.filter((e) => e.date !== TODAY)].slice(0, 36);
    if (changedVsDisk(clPath, next)) anyChange = true;
    writeJSON(clPath, next);
    console.log(`● changelog: ${entry.has_changes ? entry.summary_ja : "変更なし"}`);
  }

  // ============ meta.json ============
  const prevMeta = readJSON(path.join(DATA_DIR, "meta.json"), {});
  const bySource = prevMeta.sources || {};
  const upd = (key, ran, counts) => {
    const prev = bySource[key] || {};
    // 旧スキーマ（トップレベル last_run のみ）からの移行フォールバック
    const prevRun = prev.last_run ?? (key === "cdc" ? prevMeta.last_run ?? null : null);
    bySource[key] = {
      last_run: ran ? TODAY : prevRun,
      errors: errors.filter((e) => e.source === key),
      counts: counts || prev.counts || {},
    };
  };
  upd("cdc", doCdc && !RETRANSLATE, {
    destinations_with_data: index.filter((d) => d.has_data).length,
    notices: (readJSON(path.join(DATA_DIR, "notices.json"), []) || []).length,
  });
  upd("thp", doThp, {
    countries: index.filter((d) => d.thp).length,
    outbreaks: (readJSON(path.join(THP_DIR, "outbreaks.json"), []) || []).length,
  });
  upd("forth", doForth, {
    countries: index.filter((d) => d.forth).length,
    topics: (readJSON(path.join(FORTH_DIR, "topics.json"), []) || []).length,
  });
  const meta = {
    sources_note: "CDC Travelers' Health / TravelHealthPro (NaTHNaC) / FORTH（厚生労働省検疫所）",
    last_run: RETRANSLATE ? prevMeta.last_run ?? TODAY : TODAY,
    last_change: anyChange ? TODAY : prevMeta.last_change ?? null,
    counts: {
      destinations_configured: cfg.destinations.length,
      destinations_with_data: index.filter((d) => d.has_data).length,
      notices: (readJSON(path.join(DATA_DIR, "notices.json"), []) || []).length,
      untranslated: missingCount,
    },
    sources: bySource,
    errors,
    scope:
      (RETRANSLATE ? "retranslate" : SOURCE) +
      (ONLY ? `:only:${ONLY}` : NOTICES_ONLY ? ":feeds" : DEST_ONLY ? ":dest" : ""),
  };
  writeJSON(path.join(DATA_DIR, "meta.json"), meta);

  console.log("\n=== 完了 ===");
  console.log(`変更あり: ${anyChange ? "はい" : "いいえ"} / エラー: ${errors.length} 件`);
  if (errors.length) {
    for (const e of errors) console.log(`  - [${e.source}] ${e.scope}: ${e.reason}`);
    process.exitCode = DRY ? 0 : 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
