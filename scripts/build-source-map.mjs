#!/usr/bin/env node
// config/source-map.json を生成する。CDC の 244 slug それぞれに、
// TravelHealthPro (/countries/<thp>) と FORTH (/destinations/country/<forth>.html) の
// 対応ページ slug（無ければ null）を割り当てる。
//
//   node scripts/build-source-map.mjs           生成
//   node scripts/build-source-map.mjs --check    既存と一致するか（CI 用）

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const CONFIG = path.join(ROOT, "config", "destinations.json");
const OUT = path.join(ROOT, "config", "source-map.json");

// --- TravelHealthPro: 実在する /countries/<slug> 一覧（2026-09 取得, 262件） ---
const THP_SLUGS = new Set(
  "afghanistan albania algeria american-samoa-guam-northern-mariana-islands andaman-and-nicobar-islands-india andorra angola anguilla antarctica antigua-and-barbuda argentina armenia aruba--caribbean-islands-netherlands ascension-st-helena-tristan-da-cunha australia austria azerbaijan azores-portugal bahamas bahrain balearic-islands-spain bangladesh barbados belarus belgium belize benin bermuda bhutan bolivia bonaire--caribbean-islands-netherlands borneo-indonesia borneo-malaysia bosnia-and-herzegovina botswana brazil british-virgin-islands brunei bulgaria burkina-faso burundi cambodia cameroon canada canary-islands-spain cape-verde caribbean-islands-france caribbean-islands-netherlands cayman-islands central-african-republic chad chile china christmas-island-australia colombia comoros congo cook-islands-niue-tokelau corsica-france costa-rica croatia cte-divoire cuba curaao-caribbean-islands-netherlands cyprus czechia democratic-republic-of-the-congo denmark djibouti dominica dominican-republic easter-island-chile ecuador egypt el-salvador equatorial-guinea eritrea estonia eswatini ethiopia falkland-islands faroe-islands-denmark fiji finland france french-guiana french-polynesia gabon galapagos-ecuador georgia germany ghana gibraltar gozo-malta greece greenland grenada guadeloupe--caribbean-islands-france guam-american-samoa-northern-mariana-islands guatemala guinea guinea-bissau guyana haiti hawaii-usa honduras hong-kong-china hungary iceland india indonesia iran iraq ireland israel italy jamaica japan java-indonesia jordan kazakhstan kenya kiribati komodo-indonesia kosovo kuwait kyrgyzstan laos latvia lebanon lesotho liberia libya liechtenstein lithuania lombok-indonesia luxembourg macao-china madagascar madeira-portugal malawi malaysia maldives mali malta marshall-islands martinique mauritania mauritius mayotte mexico micronesia moldova monaco mongolia montenegro montserrat morocco mozambique myanmar-burma namibia nauru nepal netherlands new-caledonia new-zealand nicaragua niger nigeria niue-cook-islands-tokelau north-korea north-macedonia northern-mariana-islands-american-samoa-guam norway oman pakistan palau palestine panama papua-new-guinea paraguay peru philippines pitcairn-islands poland portugal puerto-rico qatar romania runion russia rwanda saba--caribbean-islands-netherlands samoa san-marino sao-tome-and-principe sardinia-italy saudi-arabia senegal serbia seychelles sicily-italy sierra-leone singapore sint-eustatius--caribbean-islands-netherlands sint-maarten--caribbean-islands-netherlands slovakia slovenia solomon-islands somalia south-africa south-korea south-sudan spain sri-lanka st-barthlemy-caribbean-islands-france st-helena-ascension-tristan-da-cunha st-kitts-and-nevis st-lucia st-martin--caribbean-islands-france st-pierre-and-miquelon st-vincent-and-the-grenadines sudan sumatra-indonesia suriname svalbard-and-jan-mayen-norway sweden switzerland syria taiwan tajikistan tanzania thailand the-gambia tibet-china timor-leste togo tokelau-cook-islands-niue tonga trinidad-and-tobago tunisia turkey turkmenistan turks-and-caicos-islands tuvalu uganda ukraine united-arab-emirates united-kingdom uruguay us-virgin-islands usa uzbekistan vanuatu venezuela vietnam wake-island wallis-and-futuna western-sahara yemen zambia zimbabwe".split(
    " "
  )
);

// CDC slug と THP slug が一致しないケースの上書き
const THP_OVERRIDE = {
  "american-samoa": "american-samoa-guam-northern-mariana-islands",
  aruba: "aruba--caribbean-islands-netherlands",
  azores: "azores-portugal",
  bonaire: "bonaire--caribbean-islands-netherlands",
  burma: "myanmar-burma",
  "canary-islands": "canary-islands-spain",
  "christmas-island": "christmas-island-australia",
  "cook-islands": "cook-islands-niue-tokelau",
  curacao: "curaao-caribbean-islands-netherlands",
  "democratic-republic-of-congo": "democratic-republic-of-the-congo",
  "east-timor": "timor-leste",
  "easter-island": "easter-island-chile",
  "faroe-island": "faroe-islands-denmark",
  guadeloupe: "guadeloupe--caribbean-islands-france",
  guam: "guam-american-samoa-northern-mariana-islands",
  "hong-kong-sar": "hong-kong-china",
  "ivory-coast": "cte-divoire",
  "macau-sar": "macao-china",
  "madeira-islands": "madeira-portugal",
  niue: "niue-cook-islands-tokelau",
  "northern-mariana-islands": "northern-mariana-islands-american-samoa-guam",
  reunion: "runion",
  saba: "saba--caribbean-islands-netherlands",
  "saint-barthelemy": "st-barthlemy-caribbean-islands-france",
  "saint-helena": "st-helena-ascension-tristan-da-cunha",
  "saint-lucia": "st-lucia",
  "saint-martin": "st-martin--caribbean-islands-france",
  "saint-pierre-and-miquelon": "st-pierre-and-miquelon",
  "saint-vincent-and-the-grenadines": "st-vincent-and-the-grenadines",
  "sint-eustatius": "sint-eustatius--caribbean-islands-netherlands",
  "sint-maarten": "sint-maarten--caribbean-islands-netherlands",
  "the-bahamas": "bahamas",
  tokelau: "tokelau-cook-islands-niue",
  "turks-and-caicos": "turks-and-caicos-islands",
  "united-states": "usa",
  "usvirgin-islands": "us-virgin-islands",
};
// THP に対応ページが無い CDC slug
const THP_NONE = new Set([
  "british-indian-ocean-territory",
  "cocos-islands",
  "norfolk-island",
  "south-georgia-south-sandwich-islands",
]);

// --- FORTH: /destinations/country/<page>.html （個別 35 + 地域 17） ---
// 個別ページ（CDC slug -> FORTH page）
const FORTH_INDIV = {
  australia: "australia",
  bangladesh: "bangladesh",
  brazil: "brazil",
  canada: "canada",
  china: "china",
  egypt: "egypt",
  india: "india",
  indonesia: "indonesia",
  japan: null, // 自国。表示しない
  maldives: "maldives",
  mexico: "mexico",
  "new-zealand": "newzealand",
  pakistan: "pakistan",
  palau: "palau",
  "papua-new-guinea": "png",
  philippines: "philippines",
  russia: "russian",
  "south-korea": "s_korea",
  "sri-lanka": "srilanka",
  taiwan: "taiwan",
  thailand: "thailand",
  turkey: "turkey",
  "united-states": "usa",
};
// 複数国まとめページ
const FORTH_GROUP = {
  vietnam_cambodia: ["vietnam", "cambodia"],
  malaysia_singapore: ["malaysia", "singapore"],
  laos: ["laos", "burma"], // FORTH「ミャンマー・ラオス」
  nepal: ["nepal", "bhutan"],
  peru_bolivia_ecuador: ["peru", "bolivia", "ecuador"],
  colombia: ["colombia", "venezuela", "suriname"],
  argentina: ["argentina", "chile", "paraguay", "uruguay"],
  hongkong: ["hong-kong-sar", "macau-sar"],
  guam: ["guam", "northern-mariana-islands"],
  // 地域ページ
  w_africa: ["benin", "burkina-faso", "cape-verde", "ivory-coast", "the-gambia", "ghana", "guinea", "guinea-bissau", "liberia", "mali", "mauritania", "niger", "nigeria", "senegal", "sierra-leone", "togo"],
  e_africa: ["burundi", "djibouti", "eritrea", "ethiopia", "kenya", "madagascar", "malawi", "mozambique", "rwanda", "somalia", "south-sudan", "sudan", "tanzania", "uganda", "zambia", "zimbabwe"],
  m_africa: ["angola", "cameroon", "central-african-republic", "chad", "congo", "democratic-republic-of-congo", "equatorial-guinea", "gabon", "sao-tome-and-principe"],
  s_africa: ["botswana", "eswatini", "lesotho", "namibia", "south-africa"],
  sahara_n: ["algeria", "libya", "morocco", "tunisia"],
  ca: ["belize", "costa-rica", "el-salvador", "guatemala", "honduras", "nicaragua", "panama"],
  cs: ["antigua-and-barbuda", "the-bahamas", "barbados", "cuba", "dominica", "dominican-republic", "grenada", "haiti", "jamaica", "saint-lucia", "st-kitts-and-nevis", "saint-vincent-and-the-grenadines", "trinidad-and-tobago"],
  ocac: ["kazakhstan", "kyrgyzstan", "tajikistan", "turkmenistan", "uzbekistan"],
  tme_area: ["bahrain", "iran", "iraq", "israel", "jordan", "kuwait", "lebanon", "oman", "qatar", "saudi-arabia", "syria", "united-arab-emirates", "yemen"],
  melanesia: ["fiji", "new-caledonia", "solomon-islands", "vanuatu"],
  micronesia: ["kiribati", "marshall-islands", "micronesia", "nauru"],
  polynesia: ["american-samoa", "cook-islands", "niue", "samoa", "tokelau", "tonga", "tuvalu", "french-polynesia"],
  n_europe: ["andorra", "austria", "belgium", "denmark", "finland", "france", "germany", "greece", "iceland", "ireland", "italy", "liechtenstein", "luxembourg", "malta", "monaco", "netherlands", "norway", "portugal", "san-marino", "spain", "sweden", "switzerland", "united-kingdom"],
  e_europe: ["albania", "armenia", "azerbaijan", "belarus", "bosnia-and-herzegovina", "bulgaria", "croatia", "cyprus", "czechia", "estonia", "georgia", "hungary", "kosovo", "latvia", "lithuania", "moldova", "montenegro", "north-macedonia", "poland", "romania", "serbia", "slovakia", "slovenia", "ukraine"],
};

// --- 生成 ---
const cfg = JSON.parse(fs.readFileSync(CONFIG, "utf8"));
const slugs = cfg.destinations.map((d) => d.slug);

const forthOf = {};
for (const [k, v] of Object.entries(FORTH_INDIV)) forthOf[k] = v;
for (const [page, members] of Object.entries(FORTH_GROUP))
  for (const m of members) forthOf[m] = page;

const out = {};
let thpCount = 0;
let forthCount = 0;
for (const slug of slugs) {
  let thp = null;
  if (THP_NONE.has(slug)) thp = null;
  else if (THP_OVERRIDE[slug]) thp = THP_OVERRIDE[slug];
  else if (THP_SLUGS.has(slug)) thp = slug;

  const forth = forthOf[slug] ?? null;
  if (thp) thpCount++;
  if (forth) forthCount++;
  out[slug] = { thp, forth };
}

// 妥当性: 上書き先が実在するか
for (const [slug, m] of Object.entries(out)) {
  if (m.thp && !THP_SLUGS.has(m.thp)) {
    console.error(`THP 上書き先が実在しない: ${slug} -> ${m.thp}`);
    process.exit(1);
  }
}

const json =
  JSON.stringify(
    {
      _comment:
        "cdc_slug -> { thp: TravelHealthPro /countries/<slug>, forth: FORTH /destinations/country/<page>.html }。null は対応ページなし。scripts/build-source-map.mjs で生成。",
      counts: { total: slugs.length, thp: thpCount, forth: forthCount },
      map: out,
    },
    null,
    2
  ) + "\n";

if (process.argv.includes("--check")) {
  const cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8") : "";
  if (cur !== json) {
    console.error("source-map.json が build-source-map.mjs と不一致。`node scripts/build-source-map.mjs` を実行してください。");
    process.exit(1);
  }
  console.log("OK: source-map は最新です。");
} else {
  fs.writeFileSync(OUT, json);
  console.log(`書き出し: config/source-map.json（${slugs.length} slug / THP ${thpCount} / FORTH ${forthCount}）`);
}
