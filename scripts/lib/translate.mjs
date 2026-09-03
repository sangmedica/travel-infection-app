// 日本語対訳の適用。data/translations.json を参照し、未収載語を集める。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "..", "data");
const DICT_PATH = path.join(DATA_DIR, "translations.json");

export function loadDict() {
  return JSON.parse(fs.readFileSync(DICT_PATH, "utf8"));
}

const norm = (s) =>
  String(s || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

/**
 * 対訳器を生成する。未収載語は collectMissing に蓄積される。
 * @param {object} dict translations.json の中身
 */
export function makeTranslator(dict) {
  const missing = new Map(); // section -> Set(term)

  function lookup(section, term) {
    const table = dict[section] || {};
    const key = norm(term);
    if (key && Object.prototype.hasOwnProperty.call(table, key)) {
      return table[key];
    }
    if (key) {
      if (!missing.has(section)) missing.set(section, new Set());
      missing.get(section).add(term.replace(/\s+/g, " ").trim());
    }
    return null;
  }

  function dumpMissing() {
    const lines = [];
    for (const [section, set] of missing) {
      for (const term of [...set].sort()) {
        lines.push(`${section}\t${term}`);
      }
    }
    return lines;
  }

  return { lookup, dumpMissing, missing };
}

/**
 * 未対訳ログを data/untranslated.txt に書き出す。
 * その回の実行で実際に不足していた語だけを残す（マージしない）。
 * 月次 CI は必ず全件実行なので、コミットされる内容は常に最新の不足一覧になる。
 * 部分実行（--only 等）では書き換えない。
 */
export function writeUntranslated(lines, { dryRun = false, partial = false } = {}) {
  const outPath = path.join(DATA_DIR, "untranslated.txt");
  const uniq = [...new Set(lines)].sort();
  const header =
    "# 未対訳の語（section<TAB>term）。data/translations.json の該当セクションに日本語を追記してください。\n" +
    `# 最終更新: ${new Date().toISOString().slice(0, 10)}\n`;
  const body = header + uniq.join("\n") + (uniq.length ? "\n" : "");
  if (dryRun) {
    console.log(`\n--- untranslated.txt (${uniq.length} 件, ${partial ? "partial→未書込" : "書込"}) ---\n${body}`);
  } else if (partial) {
    console.log(`  （部分実行のため untranslated.txt は更新しません: ${uniq.length} 件検出）`);
  } else {
    fs.writeFileSync(outPath, body);
  }
  return uniq.length;
}
