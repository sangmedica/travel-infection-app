// dx.js のスコアリングを臨床ビネットで検証する簡易テスト。
//   node scripts/dx.test.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rankDifferentials, INCUBATION_BUCKETS } from "../dx.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const read = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8"));

const diseases = read("data/kb/diseases.json").diseases;
const regionMap = read("data/kb/region-map.json").regions;
const notices = read("data/notices.json");
const destOf = (slug) => {
  try {
    return read(`data/destinations/${slug}.json`);
  } catch {
    return null;
  }
};

let pass = 0;
let fail = 0;
const bucketDay = (b) => (b ? INCUBATION_BUCKETS[b].day : null);

function run(name, opts, expect) {
  const { ranked, mustNotMiss } = rankDifferentials({
    ...opts,
    destData: opts.destSlug ? destOf(opts.destSlug) : null,
    notices,
    regionMap,
    diseases,
    incubationDays: bucketDay(opts.incubation),
  });
  const top = ranked.map((r) => r.id);
  const mnm = mustNotMiss.map((r) => r.id);
  const okTop1 = !expect.top1 || top[0] === expect.top1;
  const okInTop = (expect.inTop || []).every((id) => top.slice(0, expect.inTopN || 5).includes(id));
  const okMnm = (expect.mustNotMiss || []).every((id) => top.includes(id) || mnm.includes(id));
  const ok = okTop1 && okInTop && okMnm;
  console.log(`${ok ? "✓" : "✗"} ${name}`);
  console.log(`    top: ${top.join(", ")}`);
  if (mnm.length) console.log(`    見逃し注意: ${mnm.join(", ")}`);
  if (!ok) {
    if (!okTop1) console.log(`    ✗ #1 期待 ${expect.top1}、実際 ${top[0]}`);
    if (!okInTop) console.log(`    ✗ 上位${expect.inTopN || 5}に不足: ${(expect.inTop || []).filter((id) => !top.slice(0, expect.inTopN || 5).includes(id))}`);
    if (!okMnm) console.log(`    ✗ mustNotMiss 不足: ${(expect.mustNotMiss || []).filter((id) => !top.includes(id) && !mnm.includes(id))}`);
  }
  ok ? pass++ : fail++;
}

// 1) タイ・古典的デング
run(
  "タイ / 発熱・眼窩後部痛・発疹・白血球減少・血小板減少 / 発症まで5日",
  { destSlug: "thailand", symptoms: ["fever", "retro_orbital_pain", "rash_maculopapular", "myalgia"], labs: ["leukopenia", "thrombocytopenia"], incubation: "lt7" },
  { top1: "dengue", inTop: ["chikungunya"], inTopN: 6 }
);

// 2) サブサハラ・アフリカ / 非特異的発熱 + 血小板減少 / 12日 → マラリア
run(
  "ナイジェリア / 発熱・悪寒・頭痛 + 血小板減少 / 12日・予防内服なし",
  { destSlug: "nigeria", symptoms: ["fever", "chills_rigors", "headache", "myalgia"], labs: ["thrombocytopenia"], incubation: "d7_13" },
  { top1: "malaria_falciparum", mustNotMiss: ["malaria_falciparum"] }
);

// 3) インド / 遷延する発熱・腹痛・相対的徐脈・便秘→下痢 / 白血球減少 / 10日 → 腸チフス
run(
  "インド / 1週間超の発熱・腹痛・相対的徐脈・初期便秘 + 白血球減少 / 10日",
  { destSlug: "india", symptoms: ["fever_prolonged", "fever", "abdominal_pain", "relative_bradycardia", "constipation_early", "headache"], labs: ["leukopenia"], incubation: "d7_13" },
  { top1: "typhoid" }
);

// 4) ケニア サファリ / 発熱 + eschar + 所属リンパ節腫脹 / 8日 → アフリカダニ咬熱
run(
  "ケニア サファリ / 発熱・刺し口(eschar)・所属リンパ節腫脹・ダニ咬傷 / 8日",
  { destSlug: "kenya", symptoms: ["fever", "eschar", "regional_lymphadenopathy", "headache", "exp_tick_bite"], labs: [], incubation: "d7_13" },
  { top1: "african_tick_bite_fever" }
);

// 5) 西アフリカ / 発熱・咽頭痛・出血・AKI / 9日 → VHF を上位/見逃し注意に
run(
  "シエラレオネ / 発熱・咽頭痛・出血傾向・げっ歯類曝露 + AKI・トランスアミナーゼ上昇 / 9日",
  { destSlug: "sierra-leone", symptoms: ["fever", "sore_throat", "unexplained_hemorrhage", "malaise_fatigue", "exp_rodents"], labs: ["aki", "transaminitis"], incubation: "d7_13" },
  { inTop: ["lassa"], inTopN: 5, mustNotMiss: ["malaria_falciparum"] }
);

// 6) 淡水曝露 / 発熱・腓腹筋痛・結膜充血 + AKI・CK上昇 / 10日 → レプトスピラ
run(
  "フィリピン 洪水後 / 発熱・強い腓腹筋痛・結膜充血・淡水曝露 + AKI・CK上昇 / 10日",
  { destSlug: "philippines", symptoms: ["fever", "severe_calf_pain", "conjunctival_suffusion", "myalgia", "exp_freshwater"], labs: ["aki", "ck_elevation"], incubation: "d7_13" },
  { top1: "leptospirosis" }
);

// 7) 潜伏期の効き: 同じデング様入力でも「3か月以上」ならデングは外れる
run(
  "タイ / デング様の症状だが発症まで3か月以上 → デングは上位から外れる",
  { destSlug: "thailand", symptoms: ["fever", "retro_orbital_pain", "rash_maculopapular"], labs: ["leukopenia", "thrombocytopenia"], incubation: "gt90" },
  {}
);

// 8) アフリカ湖水浴 / 発熱・蕁麻疹・乾性咳 + 好酸球増多 / 1〜3か月 → 急性住血吸虫症
run(
  "マラウイ 湖水浴 / 発熱・蕁麻疹・乾性咳・淡水曝露 + 好酸球増多 / 1〜3か月",
  { destSlug: "malawi", symptoms: ["fever", "pruritus_urticaria", "dry_cough", "myalgia", "exp_freshwater"], labs: ["eosinophilia"], incubation: "d29_90" },
  { top1: "acute_schistosomiasis" }
);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
