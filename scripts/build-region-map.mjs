#!/usr/bin/env node
// data/kb/region-map.json を生成する。config/destinations.json の全 slug に
// 大陸タグ＋気候タグを付ける（鑑別スコアの地理判定に使用）。粗い区分。
//
//   node scripts/build-region-map.mjs           生成
//   node scripts/build-region-map.mjs --check    既存と一致するか（CI 用）

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const CONFIG = path.join(ROOT, "config", "destinations.json");
const OUT = path.join(ROOT, "data", "kb", "region-map.json");

// 大陸区分（slug の配列）
const CONTINENT = {
  se_asia: ["brunei", "burma", "cambodia", "christmas-island", "cocos-islands", "east-timor", "indonesia", "laos", "malaysia", "philippines", "singapore", "thailand", "vietnam"],
  s_asia: ["afghanistan", "bangladesh", "bhutan", "british-indian-ocean-territory", "india", "maldives", "nepal", "pakistan", "sri-lanka"],
  e_asia: ["china", "hong-kong-sar", "japan", "macau-sar", "mongolia", "north-korea", "south-korea", "taiwan"],
  c_asia: ["kazakhstan", "kyrgyzstan", "tajikistan", "turkmenistan", "uzbekistan", "armenia", "azerbaijan"],
  mena: ["bahrain", "iran", "iraq", "israel", "jordan", "kuwait", "lebanon", "oman", "qatar", "saudi-arabia", "syria", "turkey", "united-arab-emirates", "yemen", "algeria", "egypt", "libya", "morocco", "tunisia"],
  africa_north: ["algeria", "egypt", "libya", "morocco", "tunisia", "canary-islands"],
  africa_sub: ["angola", "benin", "botswana", "burkina-faso", "burundi", "cameroon", "cape-verde", "central-african-republic", "chad", "comoros", "congo", "democratic-republic-of-congo", "djibouti", "equatorial-guinea", "eritrea", "eswatini", "ethiopia", "gabon", "ghana", "guinea", "guinea-bissau", "ivory-coast", "kenya", "lesotho", "liberia", "madagascar", "malawi", "mali", "mauritania", "mauritius", "mayotte", "mozambique", "namibia", "niger", "nigeria", "reunion", "rwanda", "sao-tome-and-principe", "senegal", "seychelles", "sierra-leone", "somalia", "south-africa", "south-sudan", "sudan", "tanzania", "the-gambia", "togo", "uganda", "zambia", "zimbabwe", "saint-helena"],
  europe: ["albania", "andorra", "austria", "azores", "belarus", "belgium", "bosnia-and-herzegovina", "bulgaria", "croatia", "cyprus", "czechia", "denmark", "estonia", "faroe-island", "finland", "france", "georgia", "germany", "gibraltar", "greece", "hungary", "iceland", "ireland", "italy", "kosovo", "latvia", "liechtenstein", "lithuania", "luxembourg", "madeira-islands", "malta", "moldova", "monaco", "montenegro", "netherlands", "north-macedonia", "norway", "poland", "portugal", "romania", "russia", "san-marino", "serbia", "slovakia", "slovenia", "spain", "sweden", "switzerland", "ukraine", "united-kingdom", "canary-islands"],
  n_america: ["canada", "united-states", "bermuda", "saint-pierre-and-miquelon", "greenland"],
  latin_america: ["argentina", "belize", "bolivia", "brazil", "chile", "colombia", "costa-rica", "easter-island", "ecuador", "el-salvador", "french-guiana", "guatemala", "guyana", "honduras", "mexico", "nicaragua", "panama", "paraguay", "peru", "suriname", "uruguay", "venezuela", "falkland-islands"],
  caribbean: ["anguilla", "antigua-and-barbuda", "aruba", "the-bahamas", "barbados", "bonaire", "british-virgin-islands", "cayman-islands", "cuba", "curacao", "dominica", "dominican-republic", "grenada", "guadeloupe", "haiti", "jamaica", "martinique", "montserrat", "puerto-rico", "saba", "saint-barthelemy", "st-kitts-and-nevis", "saint-lucia", "saint-martin", "saint-vincent-and-the-grenadines", "sint-eustatius", "sint-maarten", "trinidad-and-tobago", "turks-and-caicos", "usvirgin-islands"],
  oceania: ["american-samoa", "australia", "cook-islands", "fiji", "french-polynesia", "guam", "kiribati", "marshall-islands", "micronesia", "nauru", "new-caledonia", "new-zealand", "niue", "norfolk-island", "northern-mariana-islands", "palau", "papua-new-guinea", "pitcairn-islands", "samoa", "solomon-islands", "tokelau", "tonga", "tuvalu", "vanuatu", "wake-island"],
  polar: ["antarctica", "south-georgia-south-sandwich-islands"],
};

// 熱帯（tropics）— 概ね緯度±23.5°。ここに無い低緯度国は subtropics 扱い。
const TROPICS = new Set([
  "brunei", "burma", "cambodia", "christmas-island", "cocos-islands", "east-timor", "indonesia", "laos", "malaysia", "philippines", "singapore", "thailand", "vietnam",
  "bangladesh", "british-indian-ocean-territory", "india", "maldives", "sri-lanka",
  "hong-kong-sar", "macau-sar", "taiwan",
  "yemen", "oman",
  "angola", "benin", "botswana", "burkina-faso", "burundi", "cameroon", "cape-verde", "central-african-republic", "chad", "comoros", "congo", "democratic-republic-of-congo", "djibouti", "equatorial-guinea", "eritrea", "eswatini", "ethiopia", "gabon", "ghana", "guinea", "guinea-bissau", "ivory-coast", "kenya", "liberia", "madagascar", "malawi", "mali", "mauritania", "mauritius", "mayotte", "mozambique", "namibia", "niger", "nigeria", "reunion", "rwanda", "sao-tome-and-principe", "senegal", "seychelles", "sierra-leone", "somalia", "south-sudan", "sudan", "tanzania", "the-gambia", "togo", "uganda", "zambia", "zimbabwe",
  "belize", "bolivia", "brazil", "colombia", "costa-rica", "ecuador", "el-salvador", "french-guiana", "guatemala", "guyana", "honduras", "nicaragua", "panama", "peru", "suriname", "venezuela",
  "anguilla", "antigua-and-barbuda", "aruba", "the-bahamas", "barbados", "bonaire", "british-virgin-islands", "cayman-islands", "cuba", "curacao", "dominica", "dominican-republic", "grenada", "guadeloupe", "haiti", "jamaica", "martinique", "montserrat", "puerto-rico", "saba", "saint-barthelemy", "st-kitts-and-nevis", "saint-lucia", "saint-martin", "saint-vincent-and-the-grenadines", "sint-eustatius", "sint-maarten", "trinidad-and-tobago", "turks-and-caicos", "usvirgin-islands",
  "american-samoa", "cook-islands", "fiji", "french-polynesia", "guam", "kiribati", "marshall-islands", "micronesia", "nauru", "new-caledonia", "niue", "northern-mariana-islands", "palau", "papua-new-guinea", "samoa", "solomon-islands", "tokelau", "tonga", "tuvalu", "vanuatu", "wake-island",
]);
// 亜熱帯（subtropics）
const SUBTROPICS = new Set([
  "afghanistan", "bhutan", "nepal", "pakistan",
  "china", "japan", "north-korea", "south-korea",
  "bahrain", "iran", "iraq", "israel", "jordan", "kuwait", "lebanon", "qatar", "saudi-arabia", "syria", "turkey", "united-arab-emirates",
  "algeria", "egypt", "libya", "morocco", "tunisia", "canary-islands", "madeira-islands", "azores",
  "lesotho", "south-africa",
  "argentina", "chile", "mexico", "paraguay", "uruguay", "easter-island",
  "cyprus", "gibraltar", "malta", "greece", "portugal", "spain", "san-marino", "monaco", "andorra",
  "bermuda", "australia", "norfolk-island", "pitcairn-islands", "new-zealand",
  "armenia", "azerbaijan", "georgia", "turkmenistan", "uzbekistan", "tajikistan",
]);

const cfg = JSON.parse(fs.readFileSync(CONFIG, "utf8"));
const slugs = cfg.destinations.map((d) => d.slug);

const slugToTags = {};
for (const slug of slugs) slugToTags[slug] = new Set();
for (const [tag, list] of Object.entries(CONTINENT)) {
  for (const slug of list) {
    if (slugToTags[slug]) slugToTags[slug].add(tag);
  }
}
for (const slug of slugs) {
  const tags = slugToTags[slug];
  if (TROPICS.has(slug)) tags.add("tropics");
  else if (SUBTROPICS.has(slug)) tags.add("subtropics");
  else tags.add("temperate");
}

const missing = slugs.filter((s) => slugToTags[s].size <= 1); // 大陸タグが付かなかった
if (missing.length) {
  console.error("大陸タグ未割当:", missing.join(", "));
  process.exit(1);
}

const out = {};
for (const slug of slugs.sort()) out[slug] = [...slugToTags[slug]].sort();

const json =
  JSON.stringify(
    { _comment: "slug -> 地域タグ。scripts/build-region-map.mjs で生成。鑑別スコアの粗い地理判定用。", regions: out },
    null,
    2
  ) + "\n";

if (process.argv.includes("--check")) {
  const cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8") : "";
  if (cur !== json) {
    console.error("region-map.json が build-region-map.mjs と不一致。`node scripts/build-region-map.mjs` を実行してください。");
    process.exit(1);
  }
  console.log("OK: region-map は最新です。");
} else {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, json);
  const counts = {};
  for (const tags of Object.values(out)) for (const t of tags) counts[t] = (counts[t] || 0) + 1;
  console.log(`書き出し: data/kb/region-map.json（${slugs.length} slug）`);
  console.log(counts);
}
