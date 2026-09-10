#!/usr/bin/env node
// schedule.js（機能③ 出発前スケジュール逆算エンジン）のビネットテスト。
//   node scripts/schedule.test.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildSchedule, addDays, matchSchedule } from "../schedule.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const schedules = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "kb", "vaccine-schedules.json"), "utf8"));

const TODAY = "2026-09-10";
let pass = 0;
let fail = 0;
const ok = (cond, name) => {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`);
  }
};

const rec = (...names) => names.map((name_en) => ({ name_en, source: "cdc" }));

// --- 1. マッチング ---
console.log("マッチング");
ok(matchSchedule("Japanese encephalitis", schedules)?.id === "japanese_encephalitis", "「Japanese encephalitis」→ japanese_encephalitis");
ok(matchSchedule("Flu (influenza)", schedules)?.id === "influenza", "「Flu (influenza)」→ influenza");
ok(matchSchedule("Yellow Fever", schedules)?.id === "yellow_fever", "「Yellow Fever」→ yellow_fever");
ok(matchSchedule("Routine vaccines", schedules) == null, "「Routine vaccines」は対応なし");
ok(matchSchedule("Hepatitis A", schedules)?.id === "hepatitis_a", "「Hepatitis A」→ hepatitis_a（B と誤マッチしない）");

// --- 2. 余裕のある日程: JE 2回法が標準スケジュールで間に合う ---
console.log("60日後出発・日本脳炎（標準）");
{
  const r = buildSchedule({
    today: TODAY,
    departureDate: addDays(TODAY, 60),
    recommended: rec("Japanese encephalitis"),
    schedules,
  });
  const je = r.items.filter((i) => i.vaccineId === "japanese_encephalitis");
  ok(je.length === 2, "2回分の予定が出る");
  ok(je.every((i) => i.status === "ok"), "両方とも status=ok");
  ok(!r.warnings.some((w) => w.includes("日本脳炎")), "日本脳炎に関する警告なし");
}

// --- 3. 20日後出発: 標準では完了不可 → 迅速化スケジュールの案内 ---
console.log("20日後出発・日本脳炎（標準では不可）");
{
  const r = buildSchedule({
    today: TODAY,
    departureDate: addDays(TODAY, 20),
    recommended: rec("Japanese encephalitis"),
    schedules,
  });
  ok(r.warnings.some((w) => w.includes("日本脳炎") && w.includes("迅速化")), "迅速化スケジュールを促す警告が出る");
}
console.log("20日後出発・日本脳炎（迅速化 0・7日）");
{
  const r = buildSchedule({
    today: TODAY,
    departureDate: addDays(TODAY, 20),
    recommended: rec("Japanese encephalitis"),
    accelerated: true,
    schedules,
  });
  const je = r.items.filter((i) => i.vaccineId === "japanese_encephalitis");
  ok(je.length === 2 && je[1].dayFromToday === 7, "迅速化で 0・7 日の2回");
  ok(je.every((i) => i.status === "ok" || i.status === "tight"), "出発前に収まる");
  ok(!r.warnings.some((w) => w.includes("日本脳炎")), "迅速化なら日本脳炎の警告なし");
}

// --- 4. 黄熱: 出発まで8日 → 証明書10日ルールの警告 ---
console.log("8日後出発・黄熱");
{
  const r = buildSchedule({
    today: TODAY,
    departureDate: addDays(TODAY, 8),
    recommended: rec("Yellow Fever"),
    schedules,
  });
  const yf = r.items.find((i) => i.vaccineId === "yellow_fever");
  ok(yf && yf.status === "tight", "黄熱の接種予定が tight 判定");
  ok(r.warnings.some((w) => w.includes("黄熱") && w.includes("10日")), "証明書10日ルールの警告");
  ok(r.leadItems.some((l) => l.vaccineId === "yellow_fever"), "黄熱の補足（検疫所・10日後有効）が出る");
}

// --- 5. A型肝炎: 2回目が出発後 → 警告ではなく leadItem で案内 ---
console.log("30日後出発・A型肝炎（2回目は帰国後）");
{
  const r = buildSchedule({
    today: TODAY,
    departureDate: addDays(TODAY, 30),
    recommended: rec("Hepatitis A"),
    schedules,
  });
  const ha = r.items.filter((i) => i.vaccineId === "hepatitis_a");
  ok(ha[0].status === "ok" && ha[1].status === "after", "1回目は間に合い、2回目は出発後");
  ok(r.leadItems.some((l) => l.vaccineId === "hepatitis_a"), "帰国後完了の案内が leadItem に出る");
  ok(!r.warnings.some((w) => w.includes("A型肝炎")), "A型肝炎の警告は出ない（1回で部分防御）");
}

// --- 6. マラリア・生ワクチン複数の leadItem ---
console.log("マラリア + 複数の生ワクチン");
{
  const r = buildSchedule({
    today: TODAY,
    departureDate: addDays(TODAY, 90),
    recommended: rec("Yellow Fever", "Measles", "Varicella"),
    malaria: true,
    schedules,
  });
  ok(r.leadItems.some((l) => l.vaccineId === "_malaria"), "マラリア予防内服の案内");
  ok(r.leadItems.some((l) => l.vaccineId === "_live"), "生ワクチンの間隔ルールの案内");
}

// --- 7. 日付未入力 ---
console.log("渡航予定日なし");
{
  const r = buildSchedule({ today: TODAY, departureDate: "", recommended: rec("Typhoid"), schedules });
  ok(r.daysToDeparture == null && r.warnings.length === 1, "警告のみ返す");
}

// --- 8. 初回に接種を受けられる日（起点）---
console.log("初回受診日 = 14日後・日本脳炎（標準）・出発60日後 → 間に合う");
{
  const r = buildSchedule({
    today: TODAY,
    departureDate: addDays(TODAY, 60),
    firstVisitDate: addDays(TODAY, 14),
    recommended: rec("Japanese encephalitis"),
    schedules,
  });
  const je = r.items.filter((i) => i.vaccineId === "japanese_encephalitis");
  ok(r.start === addDays(TODAY, 14) && r.firstVisit === addDays(TODAY, 14), "起点が初回受診日になる");
  ok(je[0].date === addDays(TODAY, 14) && je[1].date === addDays(TODAY, 42), "1回目=受診日、2回目=+28日");
  ok(je.every((i) => i.status === "ok"), "両方 status=ok（+7日リードも確保）");
  ok(r.visitDates.length === 2, "受診の目安は2回");
}
console.log("初回受診日 = 14日後・日本脳炎（標準）・出発40日後 → 完了不可（今日起点なら間に合う）");
{
  const fromToday = buildSchedule({
    today: TODAY,
    departureDate: addDays(TODAY, 40),
    recommended: rec("Japanese encephalitis"),
    schedules,
  });
  ok(!fromToday.warnings.some((w) => w.includes("日本脳炎")), "今日起点なら日本脳炎の警告なし");
  const delayed = buildSchedule({
    today: TODAY,
    departureDate: addDays(TODAY, 40),
    firstVisitDate: addDays(TODAY, 14),
    recommended: rec("Japanese encephalitis"),
    schedules,
  });
  ok(
    delayed.warnings.some((w) => w.includes("日本脳炎") && w.includes("迅速化")),
    "受診が14日遅れると標準では完了不可 → 迅速化を促す"
  );
}
console.log("初回受診日 = 過去 → 今日として扱う");
{
  const r = buildSchedule({
    today: TODAY,
    departureDate: addDays(TODAY, 60),
    firstVisitDate: addDays(TODAY, -5),
    recommended: rec("Typhoid"),
    schedules,
  });
  ok(r.firstVisit === null && r.start === TODAY, "過去日は無視して今日を起点");
}
console.log("初回受診日 > 渡航予定日 → 警告");
{
  const r = buildSchedule({
    today: TODAY,
    departureDate: addDays(TODAY, 20),
    firstVisitDate: addDays(TODAY, 30),
    recommended: rec("Typhoid"),
    schedules,
  });
  ok(r.warnings.some((w) => w.includes("初回") && w.includes("渡航予定日より後")), "受診日が出発後なら警告");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
