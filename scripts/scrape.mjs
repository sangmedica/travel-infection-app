#!/usr/bin/env node
// CDC Travelers' Health からデータを取得して data/ 配下の JSON を更新する。
//
// 使い方:
//   node scripts/scrape.mjs                 全件（notices + 全渡航先）
//   node scripts/scrape.mjs --only=thailand 1 渡航先のみ
//   node scripts/scrape.mjs --notices-only  Travel Notices のみ
//   node scripts/scrape.mjs --retranslate   ネットワーク取得なし。既存 JSON に対訳辞書を再適用
//   node scripts/scrape.mjs --dry-run       ファイルを書かず標準出力に要約
//
// 環境変数:
//   SCRAPE_DELAY_MS  リクエスト間隔（既定 20000ms。robots.txt の Crawl-delay 準拠）
//   SCRAPE_CONTACT   User-Agent に載せる連絡先

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { fetchNotices } from "./lib/notices.mjs";
import { fetchDestination } from "./lib/destination.mjs";
import { loadDict, makeTranslator, writeUntranslated } from "./lib/translate.mjs";
import { diffNotices, diffDestination, buildChangelogEntry } from "./lib/diff.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const DEST_DIR = path.join(DATA_DIR, "destinations");
const CONFIG_PATH = path.join(ROOT, "config", "destinations.json");

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

/** retrieved_at を無視して内容が変わったか判定 */
const stripVolatile = (obj) => JSON.stringify(obj, (k, v) => (k === "retrieved_at" ? undefined : v));
const changedVsDisk = (p, obj) => stripVolatile(readJSON(p, {})) !== stripVolatile(obj);

async function main() {
  const cfg = readJSON(CONFIG_PATH);
  if (!cfg?.destinations?.length) throw new Error(`config が読めません: ${CONFIG_PATH}`);
  let destList = cfg.destinations;
  if (ONLY) {
    destList = destList.filter((d) => d.slug === ONLY);
    if (destList.length === 0) throw new Error(`--only=${ONLY} は config に存在しません`);
  }

  const dict = loadDict();
  const tr = makeTranslator(dict);
  const errors = [];
  let anyChange = false;

  // changelog は「フェッチを伴う全件実行」でのみ作成する
  const buildChangelog = !RETRANSLATE && !ONLY && !NOTICES_ONLY && !DEST_ONLY;
  let noticeDiff = { added: [], removed: [], level_changed: [] };
  const destDiffs = [];

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

  // ---------- Travel Notices ----------
  if (!DEST_ONLY) {
    const outPath = path.join(DATA_DIR, "notices.json");
    const oldNotices = readJSON(outPath, []);
    try {
      let notices;
      if (RETRANSLATE) {
        console.log("● Travel Notices に対訳を再適用 …");
        notices = readJSON(outPath, []);
      } else {
        console.log("● Travel Notices を取得中 …");
        notices = (await fetchNotices({ destinations: cfg.destinations })).notices;
      }
      for (const n of notices) {
        n.title_ja = null;
        n.topic_ja = tr.lookup("notice_topics", n.topic_en);
      }
      notices.sort((a, b) => (b.published || "").localeCompare(a.published || "") || b.level - a.level);
      if (buildChangelog) noticeDiff = diffNotices(oldNotices, notices);
      if (changedVsDisk(outPath, notices)) anyChange = true;
      writeJSON(outPath, notices);
      console.log(`  ✓ ${notices.length} 件`);
    } catch (err) {
      console.error(`  ✗ Notices ${RETRANSLATE ? "再適用" : "取得"}失敗: ${err.message}`);
      errors.push({ scope: "notices", reason: err.message });
    }
  }

  // ---------- 渡航先ページ ----------
  if (!NOTICES_ONLY) {
    for (const meta of destList) {
      const outPath = path.join(DEST_DIR, `${meta.slug}.json`);
      const oldData = readJSON(outPath);
      try {
        let data;
        if (RETRANSLATE) {
          data = readJSON(outPath);
          if (!data) {
            console.log(`● ${meta.slug}: 既存データなし、スキップ`);
            continue;
          }
          console.log(`● ${meta.name_en} (${meta.slug}) に対訳を再適用 …`);
        } else {
          console.log(`● ${meta.name_en} (${meta.slug}) を取得中 …`);
          data = await fetchDestination(meta);
          if (!data.parse_ok) {
            throw new Error(
              `必須セクションを解析できませんでした（vaccines=${data.vaccines.length}, diseases=${data.diseases.length}）`
            );
          }
        }
        applyDict(data);
        if (buildChangelog && oldData?.parse_ok && data.parse_ok) {
          const ch = diffDestination(oldData, data);
          if (ch.length)
            destDiffs.push({
              slug: meta.slug,
              name_ja: meta.name_ja,
              name_en: meta.name_en,
              kind: meta.kind || "country",
              changes: ch,
            });
        }
        if (changedVsDisk(outPath, data)) anyChange = true;
        writeJSON(outPath, data);
        console.log(
          `  ✓ ワクチン ${data.vaccines.length} / 疾患 ${data.diseases.length}` +
            (data.page_notice_level ? ` / ページ通知レベル ${data.page_notice_level}` : "")
        );
      } catch (err) {
        console.error(`  ✗ ${meta.slug}: ${err.message}`);
        errors.push({ scope: meta.slug, reason: err.message });
        if (fs.existsSync(outPath)) {
          console.error(`    → 既存 ${meta.slug}.json を保持します（上書きしません）`);
        }
      }
    }
  }

  // ---------- 検索インデックス ----------
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
      };
    })
    .sort((a, b) => a.name_ja.localeCompare(b.name_ja, "ja"));
  const indexPath = path.join(DATA_DIR, "destinations-index.json");
  if (changedVsDisk(indexPath, index)) anyChange = true;
  writeJSON(indexPath, index);

  // ---------- 未対訳ログ ----------
  const partial = !!(ONLY || NOTICES_ONLY || DEST_ONLY);
  const missingCount = writeUntranslated(tr.dumpMissing(), { dryRun: DRY, partial });
  if (missingCount) console.log(`● 未対訳の語: ${missingCount} 件（data/untranslated.txt）`);

  // ---------- changelog.json（トップページ「新規更新」用） ----------
  if (buildChangelog) {
    const clPath = path.join(DATA_DIR, "changelog.json");
    const log = readJSON(clPath, []) || [];
    const entry = buildChangelogEntry(TODAY, noticeDiff, destDiffs);
    // 同日再実行なら置き換え、そうでなければ先頭に追加。直近36件を保持。
    const rest = log.filter((e) => e.date !== TODAY);
    const next = [entry, ...rest].slice(0, 36);
    if (changedVsDisk(clPath, next)) anyChange = true;
    writeJSON(clPath, next);
    console.log(
      `● changelog: ${entry.has_changes ? entry.summary_ja : "変更なし"}` +
        `（notices +${noticeDiff.added.length}/△${noticeDiff.level_changed.length}/-${noticeDiff.removed.length}, 地域 ${destDiffs.length}）`
    );
  }

  // ---------- meta.json ----------
  const prevMeta = readJSON(path.join(DATA_DIR, "meta.json"), {});
  const meta = {
    source: "CDC Travelers' Health (https://wwwnc.cdc.gov/travel/)",
    // last_run は「CDC を実際に取得した日」。対訳の再適用だけの実行では更新しない。
    last_run: RETRANSLATE ? prevMeta.last_run ?? TODAY : TODAY,
    last_change: anyChange ? TODAY : prevMeta.last_change ?? null,
    counts: {
      destinations_with_data: index.filter((d) => d.has_data).length,
      destinations_configured: cfg.destinations.length,
      notices: (readJSON(path.join(DATA_DIR, "notices.json"), []) || []).length,
      untranslated: missingCount,
    },
    errors,
    scope: ONLY ? `only:${ONLY}` : NOTICES_ONLY ? "notices-only" : DEST_ONLY ? "dest-only" : "full",
  };
  writeJSON(path.join(DATA_DIR, "meta.json"), meta);

  console.log("\n=== 完了 ===");
  console.log(`変更あり: ${anyChange ? "はい" : "いいえ"} / エラー: ${errors.length} 件`);
  if (errors.length) {
    for (const e of errors) console.log(`  - ${e.scope}: ${e.reason}`);
    process.exitCode = DRY ? 0 : 1; // CI では失敗扱い（前回データは保持済み）
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
