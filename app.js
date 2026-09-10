import { rankDifferentials, INCUBATION_BUCKETS } from "./dx.js";
import { buildSchedule, matchSchedule, addDays } from "./schedule.js";

// ---- 表示メタ情報 -------------------------------------------------------------

const CATEGORY_META = {
  all: { ja: "全渡航者に推奨", order: 1 },
  most: { ja: "ほとんどの渡航者に推奨", order: 2 },
  some: { ja: "一部の渡航者に推奨（条件付き）", order: 3 },
  consider: { ja: "検討", order: 4 },
  routine: { ja: "定期接種（渡航前に最新化）", order: 5 },
  not_recommended: { ja: "推奨しない", order: 6 },
  other: { ja: "その他（CDC原文を参照）", order: 7 },
};

const LEVEL_JA = {
  1: "レベル1：通常の予防",
  2: "レベル2：予防強化",
  3: "レベル3：不要不急の渡航は再検討",
  4: "レベル4：渡航中止勧告",
  0: "レベル不明",
};

const KIND_JA = { country: "国", territory: "属領・地域" };

// ---- ユーティリティ ---------------------------------------------------------

const $ = (sel, root = document) => root.querySelector(sel);
const el = (tag, props = {}, ...kids) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") node.className = v;
    else if (k === "html") node.innerHTML = v;
    else if (k === "text") node.textContent = v;
    else if (v != null) node.setAttribute(k, v);
  }
  const add = (kid) => {
    if (kid == null || kid === false) return;
    if (Array.isArray(kid)) {
      kid.forEach(add);
      return;
    }
    node.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  };
  kids.forEach(add);
  return node;
};
const bulletized = (text) => {
  if (!text) return null;
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const bullets = lines.filter((l) => l.startsWith("•"));
  if (bullets.length >= 1 && bullets.length === lines.length) {
    return el(
      "ul",
      { class: "cell-list" },
      ...lines.map((l) => el("li", { text: l.replace(/^•\s*/, "") }))
    );
  }
  return el("span", { text: text.replace(/\n/g, " / ") });
};
const fmtDate = (s) => (s ? s : "日付不明");

async function getJSON(path) {
  const res = await fetch(path, { cache: "no-cache" });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

// ---- 状態 -----------------------------------------------------------------

let INDEX = [];
let NOTICES = [];
let META = null;
let CHANGELOG = [];
let FINDINGS = null;
let DISEASES = [];
let REGIONMAP = {};
let SOURCES = {};
let THP_OUTBREAKS = [];
let FORTH_TOPICS = [];
let ALL_FEED = []; // CDC + THP + FORTH の流行情報を統合した配列
// 機能③〜⑧（診療リファレンス）用の手キュレート KB
let VSCHED = { vaccines: [] };
let MDRUGS = { drugs: [] };
let POSTRETURN = null;
let SPECIALPOP = { populations: [] };
let PACKING = { categories: [], conditional_rules: [] };
let ALTITUDE = { destinations: {} };
let ENTRYREQ = { destinations: [] };

async function init() {
  try {
    [INDEX, NOTICES, META, CHANGELOG, FINDINGS, DISEASES, REGIONMAP, SOURCES, THP_OUTBREAKS, FORTH_TOPICS] =
      await Promise.all([
        getJSON("data/destinations-index.json"),
        getJSON("data/notices.json").catch(() => []),
        getJSON("data/meta.json").catch(() => null),
        getJSON("data/changelog.json").catch(() => []),
        getJSON("data/kb/findings.json").catch(() => null),
        getJSON("data/kb/diseases.json").then((d) => d.diseases).catch(() => []),
        getJSON("data/kb/region-map.json").then((d) => d.regions).catch(() => ({})),
        getJSON("data/sources.json").then((d) => d.sources).catch(() => ({})),
        getJSON("data/thp/outbreaks.json").catch(() => []),
        getJSON("data/forth/topics.json").catch(() => []),
      ]);
    [VSCHED, MDRUGS, POSTRETURN, SPECIALPOP, PACKING, ALTITUDE, ENTRYREQ] = await Promise.all([
      getJSON("data/kb/vaccine-schedules.json").catch(() => ({ vaccines: [] })),
      getJSON("data/kb/malaria-drugs.json").catch(() => ({ drugs: [] })),
      getJSON("data/kb/post-return.json").catch(() => null),
      getJSON("data/kb/special-populations.json").catch(() => ({ populations: [] })),
      getJSON("data/kb/packing.json").catch(() => ({ categories: [], conditional_rules: [] })),
      getJSON("data/kb/altitude.json").catch(() => ({ destinations: {} })),
      getJSON("data/entry-requirements.json").catch(() => ({ destinations: [] })),
    ]);
  } catch (err) {
    $("#search-hint").textContent = "データの読み込みに失敗しました: " + err.message;
    return;
  }

  // FORTH topics は発生情報のみ流行フィードに載せる（日本語→topic_en 補完は KB から）
  const kbJaToEn = new Map(DISEASES.map((d) => [d.name_ja, d.name_en]));
  const forthFeed = (FORTH_TOPICS || [])
    .filter((t) => t.is_outbreak)
    .map((t) => ({
      ...t,
      topic_en: t.topic_en || (t.topic_ja ? kbJaToEn.get(t.topic_ja) || null : null),
    }));
  ALL_FEED = [
    ...(NOTICES || []).map((n) => ({ ...n, source: n.source || "cdc" })),
    ...(THP_OUTBREAKS || []),
    ...forthFeed,
  ];

  // 種別フィルタ
  const counts = {
    all: INDEX.length,
    country: INDEX.filter((d) => d.kind === "country").length,
    territory: INDEX.filter((d) => d.kind === "territory").length,
  };
  $("#cnt-all").textContent = `（${counts.all}）`;
  $("#cnt-country").textContent = `（${counts.country}）`;
  $("#cnt-territory").textContent = `（${counts.territory}）`;

  const currentKind = () =>
    document.querySelector('input[name="kind"]:checked')?.value || "all";

  function buildDatalist() {
    const kind = currentKind();
    const dl = $("#dest-list");
    dl.replaceChildren();
    for (const d of INDEX) {
      if (kind !== "all" && d.kind !== kind) continue;
      dl.append(
        el("option", {
          value: d.name_ja,
          label: `${d.name_en}${d.has_data ? "" : "（データ未取得）"} · ${KIND_JA[d.kind] || d.kind}`,
        })
      );
    }
  }
  buildDatalist();
  for (const r of document.querySelectorAll('input[name="kind"]')) {
    r.addEventListener("change", buildDatalist);
  }

  // last updated / meta
  if (META) {
    $("#last-updated").textContent = `｜データ取得: ${META.last_run || "―"}`;
    const parts = [
      `対象 ${META.counts?.destinations_with_data ?? "?"}/${META.counts?.destinations_configured ?? "?"} 地域`,
      `Travel Notices ${META.counts?.notices ?? "?"} 件`,
      `最終更新 ${META.last_change || "―"}`,
    ];
    $("#meta-line").textContent = parts.join("｜");
    if (META.errors && META.errors.length) {
      $("#meta-line").append(
        el("span", {
          class: "warn",
          text: `（${META.errors.length} 地域は取得に失敗し、前回データを表示中）`,
        })
      );
    }
  }

  renderChangelog();
  renderGlobalNotices();

  const input = $("#dest-input");
  const names = new Set(
    INDEX.flatMap((d) => [d.slug, d.name_ja, d.name_en, ...(d.aliases || [])].map((s) => s.toLowerCase()))
  );
  input.addEventListener("change", () => resolveAndShow(input.value));
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") resolveAndShow(input.value);
  });
  // datalist の候補を選ぶと input イベントが飛ぶ。完全一致したら即表示。
  input.addEventListener("input", () => {
    if (names.has(input.value.trim().toLowerCase())) resolveAndShow(input.value);
  });

  // モード切替
  $("#tab-region").addEventListener("click", () => setMode("region"));
  $("#tab-dx").addEventListener("click", () => setMode("dx"));
  $("#tab-ref").addEventListener("click", () => setMode("ref"));
  for (const b of document.querySelectorAll(".ref-subtab"))
    b.addEventListener("click", () => setRefTab(b.id.replace("reftab-", "")));

  // ?d=slug / ?mode=dx|ref / ?ref=<panel> ディープリンク
  const params = new URLSearchParams(location.search);
  const q = params.get("d");
  if (q) {
    input.value = q;
    resolveAndShow(q);
  }
  const mode = params.get("mode");
  if (mode === "dx") setMode("dx");
  else if (mode === "ref") {
    setMode("ref");
    const rp = params.get("ref");
    if (rp && $(`#reftab-${rp}`)) setRefTab(rp);
  }
}

// ---- モード管理 -----------------------------------------------------------

let dxBuilt = false;
let currentMode = "region";
let refTab = "schedule";
const refBuilt = new Set();

function setMode(m) {
  currentMode = m;
  $("#mode-region").hidden = m !== "region";
  $("#mode-dx").hidden = m !== "dx";
  $("#mode-ref").hidden = m !== "ref";
  $("#tab-region").classList.toggle("is-active", m === "region");
  $("#tab-dx").classList.toggle("is-active", m === "dx");
  $("#tab-ref").classList.toggle("is-active", m === "ref");
  const u = new URL(location.href);
  if (m === "region") {
    u.searchParams.delete("mode");
    u.searchParams.delete("ref");
  } else {
    u.searchParams.set("mode", m);
    if (m === "ref") u.searchParams.set("ref", refTab);
    else u.searchParams.delete("ref");
  }
  history.replaceState(null, "", u);
  if (m === "dx" && !dxBuilt) buildDxView();
  if (m === "ref") renderRefTab();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function setRefTab(name) {
  refTab = name;
  for (const b of document.querySelectorAll(".ref-subtab"))
    b.classList.toggle("is-active", b.id === `reftab-${name}`);
  for (const p of document.querySelectorAll(".ref-panel")) p.hidden = p.id !== `ref-${name}`;
  const u = new URL(location.href);
  u.searchParams.set("mode", "ref");
  u.searchParams.set("ref", name);
  history.replaceState(null, "", u);
  renderRefTab();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

const REF_RENDERERS = {
  schedule: renderRefSchedule,
  malaria: renderRefMalaria,
  entry: renderRefEntry,
  postreturn: renderRefPostReturn,
  special: renderRefSpecial,
  packing: renderRefPacking,
};

function renderRefTab() {
  if (refBuilt.has(refTab)) return;
  const fn = REF_RENDERERS[refTab];
  if (fn) {
    fn();
    refBuilt.add(refTab);
  }
}

// ---- モード②: 症状から鑑別 ----------------------------------------------

const dxState = { destSlug: null, symptoms: new Set(), labs: new Set(), incubation: "" };
let dxDestData = null;
let findingLabelMap = null;

function findingLabel(id) {
  if (!findingLabelMap) {
    findingLabelMap = new Map();
    for (const f of [...(FINDINGS?.symptoms || []), ...(FINDINGS?.labs || [])]) findingLabelMap.set(f.id, f);
  }
  return findingLabelMap.get(id) || { label_ja: id, label_en: "" };
}

function buildDxView() {
  dxBuilt = true;
  if (!FINDINGS || DISEASES.length === 0) {
    $("#dx-result").textContent = "鑑別データの読み込みに失敗しました。";
    return;
  }
  renderCheckGrid($("#dx-symptoms"), FINDINGS.symptoms, dxState.symptoms);
  renderCheckGrid($("#dx-labs"), FINDINGS.labs, dxState.labs);

  for (const r of document.querySelectorAll('input[name="incu"]')) {
    r.addEventListener("change", () => {
      dxState.incubation = r.value;
      runDx();
    });
  }
  const di = $("#dx-dest");
  const dxNames = new Set(
    INDEX.flatMap((d) => [d.slug, d.name_ja, d.name_en, ...(d.aliases || [])].map((s) => s.toLowerCase()))
  );
  di.addEventListener("change", () => setDxDest(di.value));
  di.addEventListener("input", () => {
    if (dxNames.has(di.value.trim().toLowerCase())) setDxDest(di.value);
  });
  $("#dx-dest-clear").addEventListener("click", () => {
    di.value = "";
    setDxDest("");
  });
  $("#dx-sym-filter").addEventListener("input", (e) => {
    const q = e.target.value.trim().toLowerCase();
    for (const lab of $("#dx-symptoms").querySelectorAll(".dx-chk")) {
      lab.hidden = q && !lab.dataset.search.includes(q);
    }
  });
  $("#dx-clear").addEventListener("click", () => {
    dxState.symptoms.clear();
    dxState.labs.clear();
    for (const c of document.querySelectorAll("#dx-symptoms input, #dx-labs input")) c.checked = false;
    runDx();
  });
  runDx();
}

function renderCheckGrid(container, items, stateSet) {
  const groups = new Map();
  for (const it of items) {
    if (!groups.has(it.group)) groups.set(it.group, []);
    groups.get(it.group).push(it);
  }
  container.replaceChildren();
  for (const [g, list] of groups) {
    const box = el("div", { class: "dx-group" }, el("h5", { text: g }));
    for (const it of list) {
      const cb = el("input", {
        type: "checkbox",
        "data-fid": it.id,
      });
      cb.checked = stateSet.has(it.id);
      cb.addEventListener("change", () => {
        cb.checked ? stateSet.add(it.id) : stateSet.delete(it.id);
        runDx();
      });
      const lab = el(
        "label",
        { class: "dx-chk" },
        cb,
        el("span", {}, it.label_ja, el("span", { class: "en", text: " " + it.label_en }))
      );
      lab.dataset.search = (it.label_ja + " " + it.label_en).toLowerCase();
      box.append(lab);
    }
    container.append(box);
  }
}

async function setDxDest(raw) {
  const status = $("#dx-dest-status");
  if (!raw.trim()) {
    dxState.destSlug = null;
    dxDestData = null;
    status.textContent = "渡航先を指定すると、その地域で報告のある疾患を重みづけします。";
    runDx();
    return;
  }
  const m = matchDestination(raw);
  if (!m) {
    status.textContent = `「${raw}」に一致する渡航先がありません。`;
    return;
  }
  dxState.destSlug = m.slug;
  dxDestData = m.has_data
    ? await getJSON(`data/destinations/${m.slug}.json`).catch(() => null)
    : null;
  status.textContent =
    `${m.name_ja}（${KIND_JA[m.kind] || m.kind}）で地理的重みづけを適用` +
    (m.has_data ? "" : "（CDC疾患データ未取得のため地域タグのみ使用）");
  runDx();
}

function runDx() {
  if (!dxBuilt) return;
  const incDay = dxState.incubation ? INCUBATION_BUCKETS[dxState.incubation].day : null;
  const out = rankDifferentials({
    symptoms: [...dxState.symptoms],
    labs: [...dxState.labs],
    destSlug: dxState.destSlug,
    destData: dxDestData,
    notices: ALL_FEED,
    regionMap: REGIONMAP,
    incubationDays: incDay,
    diseases: DISEASES,
  });
  renderDxResult(out);
}

const GEO_REASON_JA = {
  dest_list: (n) => `${n} で CDC が挙げている疾患`,
  notice: (n) => `${n} に関する現行の Travel Notice あり`,
  region: (n) => `${n} の地域で分布・流行`,
  worldwide: () => "世界的に分布",
  cosmo_tropical: () => "熱帯地域に広く分布",
  none: (n) => `${n} との既知の地理的関連なし`,
  no_dest: () => "渡航先未指定（地理的重みづけなし）",
};
const INC_FIT_JA = {
  typical: "入力された日数は潜伏期の典型範囲内",
  plausible: "潜伏期の範囲内",
  early: "入力された日数は潜伏期より短め（曝露が旅行の早い時期なら可）",
  late: "入力された日数は潜伏期より長い（再燃・再発性を除き考えにくい）",
  unknown: "潜伏期は未評価（日数未入力）",
};
const BASE_RATE_JA = {
  very_common: "帰国後発熱で高頻度",
  common: "しばしばみられる",
  uncommon: "比較的まれ",
  rare: "まれ",
};

function chip(text, cls) {
  return el("span", { class: `dx-chip ${cls}`, text });
}

function renderDxResult(out) {
  const root = $("#dx-result");
  root.replaceChildren();
  const destName = dxState.destSlug
    ? INDEX.find((d) => d.slug === dxState.destSlug)?.name_ja || dxState.destSlug
    : "渡航先";

  if (out.noInput) {
    root.append(
      el("p", { class: "empty", text: "症状・曝露歴または検査所見を1つ以上選択してください。" })
    );
    return;
  }
  if (out.ranked.length === 0) {
    root.append(el("p", { class: "empty", text: "該当する候補がありません。所見を見直してください。" }));
  }

  const top = out.ranked[0]?.total || 1;
  out.ranked.forEach((r, i) => {
    const d = r.disease;
    const pct = Math.max(6, Math.round((r.total / top) * 100));
    const card = el("article", { class: "dx-card" });
    card.append(
      el(
        "div",
        { class: "dx-card-head" },
        el("span", { class: "dx-rank", text: `No.${i + 1}` }),
        el("h3", {}, d.name_ja, " ", el("span", { class: "en", text: d.name_en })),
        d.must_not_miss ? el("span", { class: "badge cl-badge-yes", text: "見逃し注意" }) : null
      )
    );
    card.append(el("div", { class: "dx-scorebar" }, el("span", { style: `width:${pct}%` })));

    const why = el("div", { class: "dx-why" });
    const symChips = r.matchedSymptoms.map((m) => chip(findingLabel(m.id).label_ja, "dx-chip-sym"));
    const labChips = r.matchedLabs.map((m) => chip(findingLabel(m.id).label_ja, "dx-chip-lab"));
    const againstChips = [...r.againstSymptoms, ...r.againstLabs].map((id) =>
      chip(findingLabel(id).label_ja, "dx-chip-against")
    );
    why.append(
      el("div", {}, el("b", { text: "一致した症状: " }), symChips.length ? symChips : el("span", { class: "en", text: "なし" }))
    );
    if (labChips.length || dxState.labs.size)
      why.append(el("div", {}, el("b", { text: "一致した検査: " }), labChips.length ? labChips : el("span", { class: "en", text: "なし" })));
    if (againstChips.length)
      why.append(el("div", {}, el("b", { text: "打ち消す所見: " }), againstChips));
    why.append(el("div", {}, el("b", { text: "地理: " }), (GEO_REASON_JA[r.factors.geoReason] || (() => ""))(destName)));
    const inc = d.incubation_days;
    why.append(
      el(
        "div",
        {},
        el("b", { text: "潜伏期: " }),
        `${inc.min}–${inc.max}日` + (inc.relapse_max ? `（再発は最長 ${inc.relapse_max}日）` : "") + " ／ " + INC_FIT_JA[r.factors.incFit]
      )
    );
    why.append(el("div", {}, el("b", { text: "頻度の目安: " }), BASE_RATE_JA[d.base_rate] || d.base_rate));
    card.append(why);

    card.append(
      el(
        "details",
        {},
        el("summary", { text: "鑑別ポイント・検査・治療（CDC 英語原文つき）" }),
        el("p", { class: "cl-change-ja", text: d.discriminators_ja }),
        el("blockquote", { class: "cl-en", text: d.discriminators_en }),
        el("p", {}, el("b", { text: "推奨検査: " }), d.workup_ja),
        d.treatment_ja
          ? el(
              "div",
              { class: "dx-tx" },
              el("p", {}, el("b", { text: "治療（要参照確認）: " }), d.treatment_ja),
              el("blockquote", { class: "cl-en", text: d.treatment_en })
            )
          : null,
        d.red_flags_ja ? el("p", { class: "warn" }, el("b", { text: "Red flags: " }), d.red_flags_ja) : null,
        el("a", { class: "cl-link", href: d.cdc_url, target: "_blank", rel: "noopener", text: "CDC Yellow Book →" })
      )
    );
    root.append(card);
  });

  // 見逃してはいけない疾患
  const mnmBox = el("section", { class: "dx-mnm" }, el("h3", { text: "🚩 見逃してはいけない疾患（除外を検討）" }));
  if (out.mustNotMiss.length) {
    for (const r of out.mustNotMiss) {
      const d = r.disease;
      mnmBox.append(
        el(
          "div",
          { class: "dx-mnm-item" },
          el("div", {}, el("b", {}, d.name_ja), el("span", { class: "en", text: " " + d.name_en })),
          el("p", { class: "cl-change-ja", text: d.discriminators_ja }),
          el(
            "p",
            { class: "notice-meta" },
            `理由: ${(GEO_REASON_JA[r.factors.geoReason] || (() => ""))(destName)}／${INC_FIT_JA[r.factors.incFit]}`
          ),
          el("a", { class: "cl-link", href: d.cdc_url, target: "_blank", rel: "noopener", text: "CDC Yellow Book →" })
        )
      );
    }
  } else {
    mnmBox.append(
      el("p", {
        class: "hint",
        text: "上位の候補に含まれています。ただしマラリア・VHF・髄膜炎菌感染症・腸チフスは、所見が乏しくても常に鑑別に。",
      })
    );
  }
  root.append(mnmBox);
}

function matchDestination(raw) {
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  return (
    INDEX.find((d) => d.slug === s) ||
    INDEX.find((d) => d.name_ja === raw.trim()) ||
    INDEX.find((d) => d.name_en.toLowerCase() === s) ||
    INDEX.find(
      (d) =>
        d.name_ja.includes(raw.trim()) ||
        d.name_en.toLowerCase().includes(s) ||
        (d.aliases || []).some((a) => a.toLowerCase().includes(s) || s.includes(a.toLowerCase()))
    ) ||
    null
  );
}

async function resolveAndShow(raw) {
  const hint = $("#search-hint");
  const match = matchDestination(raw);
  if (!match) {
    const sample = INDEX.slice(0, 8).map((d) => d.name_ja).join("、");
    hint.textContent = `「${raw}」に一致する渡航先が見つかりません。日本語名・英語名・slug で入力してください（例: ${sample} …）。`;
    return;
  }
  if (!match.has_data) {
    hint.textContent = `${match.name_ja}（${KIND_JA[match.kind] || match.kind}）のデータはまだ取得されていません。月次のデータ更新後に表示されます。`;
    return;
  }
  hint.textContent = "";
  history.replaceState(null, "", `?d=${match.slug}`);
  try {
    const data = await getJSON(`data/destinations/${match.slug}.json`);
    renderDestination(data);
  } catch (err) {
    hint.textContent = "読み込み失敗: " + err.message;
  }
}

// ---- 描画: 渡航先 -----------------------------------------------------------

function levelBadge(level) {
  return el("span", {
    class: `badge lvl${level || 0}`,
    text: LEVEL_JA[level || 0] || LEVEL_JA[0],
    title: "CDC Travel Notice レベル",
  });
}

function renderDestination(data) {
  const root = $("#result");
  root.hidden = false;
  root.replaceChildren();

  // 見出し
  root.append(
    el(
      "div",
      { class: "dest-head" },
      el("h2", {}, data.name_ja, " ", el("span", { class: "en", text: data.name_en })),
      el("span", { class: "kind-tag", text: KIND_JA[data.kind] || data.kind || "" }),
      data.page_notice_level ? levelBadge(data.page_notice_level) : null,
      el("span", { class: "retrieved", text: `CDC取得日: ${data.retrieved_at || "―"}` })
    )
  );

  root.append(
    el("p", {
      class: "risk-note",
      html:
        "<strong>「危険度」について:</strong> CDC は渡航先ページで疾患ごとの数値危険度を公表していません。" +
        "本アプリでは (1) ページ全体の Travel Notice レベル（上部バッジ、1〜4）と (2) ワクチン推奨度、" +
        "(3) 下部の流行情報 を危険度の目安として表示しています。推奨度の区分は推奨文からの自動分類であり、" +
        "最終判断は必ず CDC 原文と診察に基づいてください。",
    })
  );

  // 1) 推奨ワクチン
  const vaxSection = el("section", { class: "card-section" }, el("h3", {}, "推奨ワクチン・医薬品（推奨度別）"));
  const groups = new Map();
  for (const v of data.vaccines) {
    const key = v.category in CATEGORY_META ? v.category : "other";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(v);
  }
  const orderedKeys = [...groups.keys()].sort(
    (a, b) => (CATEGORY_META[a]?.order ?? 99) - (CATEGORY_META[b]?.order ?? 99)
  );
  for (const key of orderedKeys) {
    const g = el(
      "div",
      { class: "vax-group" },
      el(
        "h4",
        {},
        el("span", { class: `badge cat-${key}`, text: CATEGORY_META[key].ja }),
        ` （${groups.get(key).length}）`
      )
    );
    for (const v of groups.get(key)) {
      const item = el(
        "div",
        { class: "vax-item" },
        el(
          "div",
          { class: "vax-name" },
          v.name_ja || v.name_en,
          v.name_ja ? el("span", { class: "en", text: ` ${v.name_en}` }) : null
        )
      );
      if (v.recommendation_en) {
        item.append(
          el(
            "details",
            {},
            el("summary", { text: "CDC の推奨内容（英語原文）" }),
            el("div", { class: "rec-text", text: v.recommendation_en }),
            v.clinical_guidance_en
              ? el("div", { class: "guide-text", text: "医療者向け: " + v.clinical_guidance_en })
              : null
          )
        );
      }
      g.append(item);
    }
    vaxSection.append(g);
  }
  if (data.vaccines.length === 0) vaxSection.append(el("p", { class: "empty", text: "データなし" }));
  root.append(vaxSection);

  // 2) ワクチンで予防できない疾患
  const disSection = el(
    "section",
    { class: "card-section" },
    el("h3", {}, "ワクチンで予防できない疾患")
  );
  const dgroups = new Map();
  for (const d of data.diseases) {
    const key = d.transmission_ja || d.transmission_en || "その他";
    if (!dgroups.has(key)) dgroups.set(key, []);
    dgroups.get(key).push(d);
  }
  for (const [gname, list] of dgroups) {
    const wrap = el("div", { class: "disease-group" }, el("h4", { text: gname }));
    const table = el(
      "table",
      { class: "diseases" },
      el(
        "thead",
        {},
        el(
          "tr",
          {},
          el("th", { text: "疾患" }),
          el("th", { text: "主な感染経路" }),
          el("th", { text: "対策" })
        )
      )
    );
    const tbody = el("tbody");
    for (const d of list) {
      tbody.append(
        el(
          "tr",
          {},
          el(
            "td",
            { class: "name" },
            d.name_ja || d.name_en,
            d.name_ja ? el("span", { class: "en", text: d.name_en }) : null
          ),
          el("td", {}, bulletized(d.spread_en) || "―"),
          el("td", {}, bulletized(d.advice_en) || "―")
        )
      );
    }
    table.append(tbody);
    wrap.append(table);
    disSection.append(wrap);
  }
  if (data.diseases.length === 0)
    disSection.append(el("p", { class: "empty", text: "このページに掲載なし" }));
  root.append(disSection);

  // 3) TravelHealthPro / FORTH の国別セクション（折りたたみ・遅延読み込み）
  const dIdx = INDEX.find((d) => d.slug === data.slug) || {};
  if (dIdx.thp) root.append(sourceCollapsible("thp", data.slug, data.name_ja));
  if (dIdx.forth) root.append(sourceCollapsible("forth", data.slug, data.name_ja));

  // 4) この地域の流行情報（CDC + THP + FORTH を統合）
  const local = ALL_FEED.filter(
    (n) => !n.is_global && (n.matched_slugs || []).includes(data.slug)
  ).sort((a, b) => (b.published || "").localeCompare(a.published || ""));
  const noticeSection = el(
    "section",
    { class: "card-section" },
    el("h3", {}, `${data.name_ja} の流行情報（CDC / TravelHealthPro / FORTH）`)
  );
  if (local.length === 0) {
    noticeSection.append(
      el("p", {
        class: "empty",
        text: "この地域を名指しする現行の情報はありません（世界的な注意喚起は下部を参照）。",
      })
    );
  } else {
    for (const n of local) noticeSection.append(noticeItem(n, data.slug));
  }
  root.append(noticeSection);

  renderGlobalNotices(data.slug);
  root.scrollIntoView({ behavior: "smooth", block: "start" });
}

// ---- ソース別セクション（TravelHealthPro / FORTH） ----------------------

const SRC_LABEL = { thp: "TravelHealthPro（NaTHNaC・英国）", forth: "FORTH（厚生労働省検疫所・日本）" };

function sourceCollapsible(src, slug, nameJa) {
  const det = el("details", { class: `src-section src-${src}` });
  det.append(el("summary", {}, el("b", { text: SRC_LABEL[src] }), " ", el("span", { class: "en", text: "— クリックで表示" })));
  const body = el("div", { class: "src-body", text: "読み込み中…" });
  det.append(body);
  let loaded = false;
  det.addEventListener("toggle", async () => {
    if (!det.open || loaded) return;
    loaded = true;
    try {
      const d = await getJSON(`data/${src}/${slug}.json`);
      body.replaceChildren(src === "thp" ? renderThp(d) : renderForth(d));
    } catch (e) {
      body.textContent = "読み込みに失敗しました。";
    }
  });
  return det;
}

function srcAttribution(src, url) {
  const s = SOURCES[src] || {};
  return el(
    "p",
    { class: "src-attr" },
    `出典: `,
    el("a", { href: url, target: "_blank", rel: "noopener", text: url }),
    s.license_ja ? ` ／ ${s.license_ja}` : "",
    s.edited_note_ja ? ` ／ ${s.edited_note_ja}` : ""
  );
}

const THP_TIER_JA = { all: "全渡航者", most: "ほとんどの渡航者に推奨", some: "一部の渡航者に推奨（条件付き）" };

function renderThp(d) {
  const wrap = el("div", {});
  wrap.append(el("p", { class: "src-meta", text: `取得日 ${d.retrieved_at}` }));
  for (const t of ["all", "most", "some"]) {
    const tier = d.tiers?.[t] || { diseases: [] };
    if (!tier.diseases.length && !tier.intro_en) continue;
    const g = el("div", { class: "thp-tier" }, el("h4", { text: THP_TIER_JA[t] }));
    if (tier.intro_en) g.append(el("p", { class: "cl-en cl-en-line", text: tier.intro_en }));
    for (const dis of tier.diseases)
      g.append(
        el(
          "div",
          { class: "thp-dis" },
          el("b", { text: dis.name_en }),
          dis.risk_en ? el("p", { class: "cl-en cl-en-line", text: `［この国でのリスク］ ${dis.risk_en}` }) : null,
          dis.desc_en ? el("p", { class: "cl-en", text: dis.desc_en }) : null
        )
      );
    wrap.append(g);
  }
  if (d.malaria_en)
    wrap.append(el("div", { class: "thp-tier" }, el("h4", { text: "マラリア（Malaria）" }), el("p", { class: "cl-en", text: d.malaria_en })));
  if (d.certificate_en)
    wrap.append(el("div", { class: "thp-tier" }, el("h4", { text: "証明書要件（Certificate requirements）" }), el("p", { class: "cl-en", text: d.certificate_en })));
  if (d.other_risks_en)
    wrap.append(el("details", {}, el("summary", { text: "その他のリスク（Other risks）" }), el("p", { class: "cl-en", text: d.other_risks_en })));
  if (d.general_info_en)
    wrap.append(el("details", {}, el("summary", { text: "一般情報（General information）" }), el("p", { class: "cl-en", text: d.general_info_en })));
  wrap.append(srcAttribution("thp", d.source_url));
  return wrap;
}

function renderForth(d) {
  const wrap = el("div", {});
  wrap.append(
    el("p", { class: "src-meta", text: `取得日 ${d.retrieved_at}｜FORTH ページ: ${d.page_title_ja}${d.is_regional_page ? "（地域情報）" : ""}` })
  );
  if (d.watch_diseases_ja.length) {
    wrap.append(el("h4", { text: "気をつけたい病気（FORTH 日本語原文）" }));
    wrap.append(
      el(
        "p",
        {},
        d.watch_diseases_ja.map((x) => el("span", { class: "dx-chip dx-chip-sym", text: x }))
      )
    );
  }
  if (d.watch_text_ja) wrap.append(el("blockquote", { class: "cl-en", text: d.watch_text_ja }));
  if (d.vaccines_ja.length) {
    wrap.append(el("h4", { text: "受けておきたい予防接種（FORTH 日本語原文）" }));
    const ul = el("ul", { class: "cl-changes" });
    for (const v of d.vaccines_ja)
      ul.append(
        el("li", {}, v.name_ja + (v.conditional ? "（条件付き）" : ""), v.note_ja ? el("span", { class: "en", text: " " + v.note_ja }) : null)
      );
    wrap.append(ul);
  }
  if (d.vaccine_line_ja) wrap.append(el("blockquote", { class: "cl-en", text: d.vaccine_line_ja }));
  if (d.medical_info_ja) {
    wrap.append(el("h4", { text: "医療情報（FORTH 日本語原文）" }));
    wrap.append(el("blockquote", { class: "cl-en", text: d.medical_info_ja }));
  }
  if (d.post_return_ja) {
    wrap.append(el("h4", { text: "帰国後の過ごし方・注意点（FORTH 日本語原文）" }));
    wrap.append(el("blockquote", { class: "cl-en", text: d.post_return_ja }));
  }
  wrap.append(srcAttribution("forth", d.source_url));
  return wrap;
}

const SRC_SHORT = { cdc: "CDC", thp: "THP", forth: "FORTH" };
const SRC_LINK_JA = { cdc: "CDC の原文", thp: "TravelHealthPro のニュース", forth: "FORTH の原文" };

function noticeItem(n, currentSlug) {
  const src = n.source || "cdc";
  const onList = currentSlug && (n.matched_slugs || []).includes(currentSlug);
  const titleJa =
    src === "forth"
      ? n.topic_ja || n.title_ja || n.title_en
      : n.topic_ja
      ? `${n.topic_ja}（${n.topic_en || n.topic_ja}）`
      : n.topic_en || n.title_en;
  const place = src === "forth" ? n.place_ja : n.place_en;
  const summary = src === "forth" ? n.summary_ja || n.title_ja : n.summary_en;
  const meta =
    src === "cdc"
      ? `${LEVEL_JA[n.level || 0]}｜掲載 ${fmtDate(n.published)}`
      : `${SOURCES[src]?.name_short || SRC_SHORT[src]}｜掲載 ${fmtDate(n.published)}`;
  return el(
    "div",
    { class: "notice-item" },
    el(
      "div",
      { class: "notice-title" },
      el("span", { class: `badge src-badge src-badge-${src}`, text: SRC_SHORT[src] }),
      src === "cdc" && n.level
        ? el("span", { class: `badge lvl${n.level}`, text: `L${n.level}` })
        : null,
      " ",
      titleJa,
      place && !String(titleJa).includes(place) ? ` — ${place}` : ""
    ),
    el("div", { class: "notice-meta", text: meta }),
    onList
      ? el("p", { class: "notice-summary warn", text: "▶ この渡航先も対象国リストに含まれています。" })
      : null,
    summary ? el("p", { class: "notice-summary", text: summary }) : null,
    el(
      "div",
      { class: "notice-meta" },
      el("a", { href: n.url, target: "_blank", rel: "noopener", text: `${SRC_LINK_JA[src]}を開く →` })
    )
  );
}

// ---- 描画: 新規更新（changelog） -----------------------------------------

const noticeLabelJa = (n) =>
  n.topic_ja ? `${n.topic_ja}（${n.topic_en}）` : n.topic_en || n.title_en;

function renderChangelog() {
  const sec = $("#changelog");
  if (!Array.isArray(CHANGELOG) || CHANGELOG.length === 0) return;
  sec.hidden = false;
  $("#changelog-latest").textContent = `（最終更新 ${CHANGELOG[0].date}）`;

  const body = $("#changelog-body");
  const INITIAL = 1;
  const render = (count) => {
    body.replaceChildren();
    CHANGELOG.slice(0, count).forEach((entry, i) => body.append(changelogEntry(entry, i === 0)));
  };
  render(INITIAL);

  const moreBtn = $("#changelog-more");
  if (CHANGELOG.length > INITIAL) {
    let expanded = false;
    moreBtn.hidden = false;
    moreBtn.textContent = `過去の更新履歴を表示（全 ${CHANGELOG.length} 件）`;
    moreBtn.addEventListener("click", () => {
      expanded = !expanded;
      render(expanded ? CHANGELOG.length : INITIAL);
      moreBtn.textContent = expanded
        ? "更新履歴を折りたたむ"
        : `過去の更新履歴を表示（全 ${CHANGELOG.length} 件）`;
    });
  }
}

const CL_SRC_JA = { cdc: "CDC Travelers' Health", thp: "TravelHealthPro（NaTHNaC）", forth: "FORTH（厚生労働省検疫所）" };

function changelogEntry(entry, open) {
  const wrap = el("article", { class: "cl-entry" });
  wrap.append(
    el(
      "h3",
      { class: "cl-entry-head" },
      entry.date,
      " ",
      el("span", {
        class: `badge ${entry.has_changes ? "cl-badge-yes" : "cl-badge-no"}`,
        text: entry.has_changes ? "更新あり" : "変更なし",
      })
    )
  );
  wrap.append(el("p", { class: "cl-summary", text: entry.summary_ja }));

  const sources = entry.sources || {};
  const anyDetail = ["cdc", "thp", "forth"].some((k) => {
    const s = sources[k];
    if (!s) return false;
    const f = s.feed || {};
    return (
      (f.added && f.added.length) ||
      (f.removed && f.removed.length) ||
      (f.level_changed && f.level_changed.length) ||
      (s.countries && s.countries.length)
    );
  });
  if (!anyDetail) return wrap;

  const det = el("details", open ? { open: "" } : {});
  det.append(el("summary", { text: "詳細（CDC/THP は英語原文、FORTH は日本語原文つき）" }));

  for (const key of ["cdc", "thp", "forth"]) {
    const s = sources[key];
    if (!s) continue;
    const f = s.feed || { added: [], removed: [], level_changed: [] };
    const countries = s.countries || [];
    const feedN = f.added.length + f.removed.length + f.level_changed.length;
    if (feedN === 0 && countries.length === 0) continue;

    const srcBox = el("div", { class: "cl-src-block" }, el("h4", { class: "cl-src-head", text: CL_SRC_JA[key] }));

    if (feedN) {
      const fb = el("div", { class: "cl-block" }, el("h5", { text: "流行情報" }));
      for (const n of f.added) fb.append(clItem(`新規: ${feedLabel(n)}`, feedOrig(n), feedBody(n), n.url, key));
      for (const n of f.level_changed)
        fb.append(clItem(`レベル変更: ${feedLabel(n)} L${n.level_from}→${n.level_to}`, feedOrig(n), feedBody(n), n.url, key));
      for (const n of f.removed) fb.append(clItem(`掲載終了: ${feedLabel(n)}`, feedOrig(n), "", n.url, key));
      srcBox.append(fb);
    }

    const SHOW = 25;
    for (const dd of countries.slice(0, SHOW)) {
      const box = el("div", { class: "cl-block" }, el("h5", {}, `${dd.name_ja}（${dd.name_en}）`));
      const ul = el("ul", { class: "cl-changes" });
      for (const c of dd.changes) ul.append(el("li", {}, ...changeLine(c)));
      box.append(ul);
      srcBox.append(box);
    }
    if (countries.length > SHOW)
      srcBox.append(el("p", { class: "hint", text: `ほか ${countries.length - SHOW} 地域で変更があります。` }));
    det.append(srcBox);
  }

  wrap.append(det);
  return wrap;
}

const feedLabel = (n) =>
  n.source === "forth"
    ? n.topic_ja || n.title_ja || ""
    : n.topic_ja
    ? `${n.topic_ja}（${n.topic_en || ""}）`
    : n.topic_en || n.title_en;
const feedOrig = (n) => (n.source === "forth" ? n.title_ja || "" : n.title_en || "");
const feedBody = (n) => (n.source === "forth" ? n.summary_ja || "" : n.summary_en || "");

function clItem(titleJa, enLine, enBody, url, src = "cdc") {
  const linkText = { cdc: "CDC 原文 →", thp: "TravelHealthPro →", forth: "FORTH 原文 →" }[src] || "原文 →";
  const item = el("div", { class: "cl-item" }, el("div", { class: "cl-item-ja", text: titleJa }));
  if (enLine) item.append(el("div", { class: "cl-en cl-en-line", text: enLine }));
  if (enBody) item.append(el("blockquote", { class: "cl-en", text: enBody }));
  if (url)
    item.append(
      el("a", { class: "cl-link", href: url, target: "_blank", rel: "noopener", text: linkText })
    );
  return item;
}

function changeLine(c) {
  const nm = c.name_ja ? `${c.name_ja}（${c.name_en}）` : c.name_en;
  const out = [];
  const ja = (t) => el("span", { class: "cl-change-ja", text: t });
  const en = (t, cls) => el("blockquote", { class: `cl-en${cls ? " " + cls : ""}`, text: t });
  const lbl = (t) => el("div", { class: "cl-en-label", text: t });

  switch (c.type) {
    case "vaccine_category":
      out.push(ja(`ワクチン「${nm}」の推奨度: ${c.from_ja} → ${c.to_ja}`));
      if (c.recommendation_en) out.push(en(c.recommendation_en));
      break;
    case "vaccine_added":
      out.push(ja(`ワクチン追加「${nm}」— ${c.category_ja}`));
      if (c.recommendation_en) out.push(en(c.recommendation_en));
      break;
    case "vaccine_removed":
      out.push(ja(`ワクチン削除「${nm}」`));
      break;
    case "vaccine_text":
      out.push(ja(`「${nm}」（${c.category_ja}）の推奨文が更新されました`));
      out.push(lbl("新（CDC 原文）:"));
      out.push(en(c.recommendation_en));
      if (c.recommendation_en_old) {
        out.push(lbl("旧:"));
        out.push(en(c.recommendation_en_old, "cl-en-old"));
      }
      break;
    case "disease_added":
      out.push(ja(`疾患追加「${nm}」— 感染経路: ${c.transmission_en || "―"}`));
      if (c.spread_en) out.push(en(c.spread_en));
      break;
    case "disease_removed":
      out.push(ja(`疾患削除「${nm}」`));
      break;
    case "page_notice_level":
      out.push(ja(`地域の Travel Notice レベル: ${c.from} → ${c.to}`));
      break;
    case "thp_vaccine_added":
      out.push(ja(`ワクチン追加「${c.name_en}」— ${c.tier_ja}`));
      if (c.desc_en) out.push(en(c.desc_en));
      break;
    case "thp_vaccine_tier":
      out.push(ja(`ワクチン「${c.name_en}」の対象: ${c.from_ja} → ${c.to_ja}`));
      if (c.desc_en) out.push(en(c.desc_en));
      break;
    case "thp_vaccine_removed":
      out.push(ja(`ワクチン削除「${c.name_en}」（${c.from_ja}）`));
      break;
    case "thp_malaria_text":
      out.push(ja("マラリアの記載が更新されました"));
      out.push(en(c.text_en));
      break;
    case "forth_watch_added":
      out.push(ja(`気をつけたい病気に追加「${c.name_ja}」`));
      break;
    case "forth_watch_removed":
      out.push(ja(`気をつけたい病気から削除「${c.name_ja}」`));
      break;
    case "forth_vaccine_added":
      out.push(ja(`予防接種リストに追加「${c.name_ja}」`));
      break;
    case "forth_vaccine_removed":
      out.push(ja(`予防接種リストから削除「${c.name_ja}」`));
      break;
    default:
      out.push(ja(JSON.stringify(c)));
  }
  return out;
}

function renderGlobalNotices(currentSlug) {
  const globals = ALL_FEED.filter((n) => n.is_global).sort(
    (a, b) => (b.published || "").localeCompare(a.published || "")
  );
  if (globals.length === 0) return;
  $("#global-notices").hidden = false;
  $("#global-count").textContent = `（${globals.length}）`;
  const body = $("#global-notices-body");
  body.replaceChildren();
  for (const n of globals) body.append(noticeItem(n, currentSlug));
}

// ======================================================================
//  モード③: 診療リファレンス（機能③〜⑧）
// ======================================================================

const today = () => new Date().toISOString().slice(0, 10);
const disclaimerNote = (text) => el("p", { class: "ref-disc" }, el("b", {}, "⚠ "), text);
const fetchDest = (slug) => getJSON(`data/destinations/${slug}.json`).catch(() => null);

// 渡航先ページの推奨ワクチンのうち、スケジュール逆算・携行判定に使うカテゴリ
const SCHED_CATS = new Set(["all", "most", "some", "consider"]);
function mergedRecs(destData) {
  if (!destData) return [];
  return (destData.vaccines || [])
    .filter((v) => SCHED_CATS.has(v.category))
    .map((v) => ({ name_en: v.name_en, name_ja: v.name_ja, category: v.category, source: "cdc" }));
}
function destMalariaInfo(destData) {
  const mv = (destData?.vaccines || []).find((v) => /^\s*malaria/i.test(v.name_en));
  const txt = mv?.recommendation_en || "";
  const risk =
    !!mv && /take prescription medicine to prevent malaria|recommended chemoprophylaxis/i.test(txt);
  return { risk, cdcText: txt || null, category: mv?.category || null };
}

/** 渡航先入力フィールド（ref パネル共用）。onPick(match|null, statusEl) を呼ぶ。 */
function refDestField(id, labelJa, onPick) {
  const inp = el("input", {
    id,
    type: "text",
    list: "dest-list",
    autocomplete: "off",
    class: "ref-dest-input",
    placeholder: "例: タイ / Thailand（未選択でも可）",
  });
  const clear = el("button", { class: "dx-mini-btn", type: "button" }, "クリア");
  const status = el("p", { class: "hint" });
  const trigger = () => {
    if (!inp.value.trim()) {
      onPick(null, status);
      return;
    }
    const m = matchDestination(inp.value);
    if (!m) {
      status.textContent = `「${inp.value}」に一致する渡航先がありません。`;
      return;
    }
    onPick(m, status);
  };
  inp.addEventListener("change", trigger);
  inp.addEventListener("input", () => {
    const s = inp.value.trim().toLowerCase();
    if (INDEX.some((d) => [d.slug, d.name_ja, d.name_en].some((x) => x.toLowerCase() === s))) trigger();
  });
  clear.addEventListener("click", () => {
    inp.value = "";
    onPick(null, status);
  });
  return {
    wrap: el(
      "div",
      { class: "dx-field" },
      el("label", { class: "dx-label", for: id }, labelJa),
      el("div", { class: "ref-dest-row" }, inp, clear),
      status
    ),
    input: inp,
  };
}

// ---- ③ 出発前スケジュール ------------------------------------------------

function renderRefSchedule() {
  const root = $("#ref-schedule");
  root.replaceChildren();
  root.append(el("h2", { class: "ref-h2" }, "③ 出発前スケジュール（接種タイミング逆算）"));
  root.append(
    el("p", {
      class: "ref-lead",
      text:
        "渡航先と渡航予定日を入れると、その国で推奨されるワクチンをいつ接種すればよいかを日付で逆算します。回数・接種間隔・迅速化の可否・出発前リードタイムは代表例です。",
    })
  );

  let dest = null;
  const dateInput = el("input", { id: "sched-date", type: "date", class: "ref-date" });
  const accel = el("input", { id: "sched-accel", type: "checkbox" });
  const doneWrap = el("div", { class: "sched-done" });
  const out = el("div", { class: "sched-out" });

  const df = refDestField("sched-dest", "渡航先の国・地域", (m, status) => {
    if (!m) {
      dest = null;
      status.textContent = "渡航先を選ぶと、その国の推奨ワクチンでスケジュールを作ります。";
      doneWrap.replaceChildren();
      recompute();
      return;
    }
    if (!m.has_data) {
      dest = null;
      status.textContent = `${m.name_ja} は CDC データ未取得です。`;
      doneWrap.replaceChildren();
      recompute();
      return;
    }
    fetchDest(m.slug).then((d) => {
      dest = d;
      status.textContent = `${m.name_ja} の推奨ワクチン（CDC）で計算します。`;
      buildDone();
      recompute();
    });
  });

  function matchedScheds() {
    if (!dest) return [];
    const seen = new Set();
    const list = [];
    for (const r of mergedRecs(dest)) {
      const s = matchSchedule(r.name_en, VSCHED);
      if (s && !seen.has(s.id)) {
        seen.add(s.id);
        list.push(s);
      }
    }
    return list;
  }
  function buildDone() {
    doneWrap.replaceChildren();
    const ms = matchedScheds();
    if (!ms.length) return;
    doneWrap.append(el("div", { class: "dx-label" }, "すでに接種済み（スケジュールから除外）"));
    const grid = el("div", { class: "sched-done-grid" });
    for (const s of ms) {
      const cb = el("input", { type: "checkbox", "data-sid": s.id });
      cb.addEventListener("change", recompute);
      grid.append(
        el("label", { class: "dx-chk" }, cb, el("span", {}, s.name_ja, el("span", { class: "en", text: " " + s.name_en })))
      );
    }
    doneWrap.append(grid);
  }
  function recompute() {
    out.replaceChildren();
    if (!dest) {
      out.append(el("p", { class: "empty" }, "渡航先を選択してください。"));
      return;
    }
    if (!dateInput.value) {
      out.append(el("p", { class: "empty" }, "渡航予定日を入力してください。"));
      return;
    }
    const done = [...doneWrap.querySelectorAll("input:checked")].map((c) => c.dataset.sid);
    const res = buildSchedule({
      today: today(),
      departureDate: dateInput.value,
      recommended: mergedRecs(dest),
      doneIds: done,
      accelerated: accel.checked,
      schedules: VSCHED,
      malaria: destMalariaInfo(dest).risk,
    });
    out.append(scheduleView(res));
  }
  dateInput.addEventListener("change", recompute);
  accel.addEventListener("change", recompute);

  root.append(df.wrap);
  root.append(
    el(
      "div",
      { class: "dx-field" },
      el("label", { class: "dx-label", for: "sched-date" }, "渡航予定日"),
      dateInput,
      el(
        "label",
        { class: "dx-chk sched-accel-row" },
        accel,
        el("span", {}, "迅速化スケジュールを優先する（対応ワクチンのみ）")
      )
    )
  );
  root.append(doneWrap);
  root.append(out);
  root.append(
    disclaimerNote(
      "用量・回数・接種間隔・迅速化の可否・禁忌・小児量は代表例です。実施前に必ず添付文書と渡航医学ガイドラインで確認してください。定期接種（麻疹・破傷風など）の最新化は別途ご確認ください。"
    )
  );
  recompute();
}

const fmtMD = (iso) => {
  const [, m, d] = iso.split("-");
  return `${+m}/${+d}`;
};

/** 今日→出発日の横型カレンダー（接種日をビジュアルに表示） */
function scheduleTimeline(res) {
  const wrap = el("div", { class: "sched-tl-wrap" });
  const dtd = res.daysToDeparture;
  if (!dtd || dtd <= 0) return wrap; // 逆算タイムラインは出発が未来のときだけ
  const t0 = today();
  const depIso = addDays(t0, dtd);
  const onAxis = res.items.filter((it) => it.status !== "after");
  if (!onAxis.length) return wrap;
  const afterN = res.items.length - onAxis.length;
  const pct = (days) => Math.max(0, Math.min(100, (days / dtd) * 100));

  // 同一日をまとめる
  const groups = [];
  const gmap = new Map();
  for (const it of onAxis) {
    if (!gmap.has(it.date)) {
      const g = { date: it.date, days: it.dayFromToday, items: [] };
      gmap.set(it.date, g);
      groups.push(g);
    }
    gmap.get(it.date).items.push(it);
  }
  groups.sort((a, b) => a.days - b.days);

  // 吹き出しの横方向の重なりを避けるレーン割当（先に置いた吹き出しと GAP%% 未満なら次の段へ）
  const GAP = 20;
  const laneEnd = [];
  for (const g of groups) {
    g.p = pct(g.days);
    let lane = 0;
    while (lane < 4 && laneEnd[lane] != null && g.p - laneEnd[lane] < GAP) lane++;
    if (lane === 4) lane = 0;
    laneEnd[lane] = g.p;
    g.lane = lane;
  }
  const maxLane = groups.reduce((m, g) => Math.max(m, g.lane), 0);

  const track = el("div", { class: "sched-tl-track", style: `height:${86 + (maxLane + 1) * 40}px` });

  // 月の目盛り
  const d0 = new Date(t0 + "T00:00:00");
  const dEnd = new Date(depIso + "T00:00:00");
  const mk = new Date(d0.getFullYear(), d0.getMonth() + 1, 1);
  while (mk <= dEnd) {
    const days = Math.round((mk - d0) / 86400000);
    track.append(
      el("div", { class: "sched-tl-month", style: `left:${pct(days)}%` }, el("span", {}, `${mk.getMonth() + 1}月`))
    );
    mk.setMonth(mk.getMonth() + 1);
  }

  track.append(el("div", { class: "sched-tl-axis" }));

  // 端点
  track.append(
    el("div", { class: "sched-tl-end sched-tl-today", style: "left:0%" }, el("span", {}, "今日"), el("small", {}, fmtMD(t0)))
  );
  track.append(
    el(
      "div",
      { class: "sched-tl-end sched-tl-dep", style: "left:100%" },
      el("span", {}, "✈ 出発"),
      el("small", {}, fmtMD(depIso))
    )
  );

  // 接種マーカー
  for (const g of groups) {
    const st = g.items.some((i) => i.status === "tight") ? "tight" : "ok";
    const names = g.items.map((i) => i.name_ja.replace(/（.*?）/g, "").trim());
    const label = names.length > 2 ? `${names.slice(0, 2).join(" / ")} ほか${names.length - 2}` : names.join(" / ");
    const edge = g.p < 8 ? " edge-l" : g.p > 92 ? " edge-r" : "";
    const m = el("div", {
      class: `sched-tl-marker st-${st}${edge}`,
      style: `left:${g.p}%; --lane:${g.lane}`,
    });
    m.append(el("div", { class: "sched-tl-stem" }));
    m.append(el("div", { class: "sched-tl-dot" }));
    m.append(
      el(
        "div",
        { class: "sched-tl-callout" },
        el("b", {}, fmtMD(g.date)),
        el("span", {}, label),
        g.items.some((i) => i.live) ? el("span", { class: "badge cl-badge-yes sched-badge", text: "生" }) : null
      )
    );
    track.append(m);
  }

  wrap.append(el("div", { class: "sched-tl" }, track));
  if (afterN)
    wrap.append(
      el("p", { class: "sched-tl-after" }, `＋ 出発後の接種予定 ${afterN} 回（帰国後に接種。下の表を参照）`)
    );
  wrap.append(
    el(
      "div",
      { class: "sched-tl-legend" },
      el("span", { class: "lg lg-ok" }, "余裕あり"),
      el("span", { class: "lg lg-tight" }, "ぎりぎり"),
      el("span", { class: "lg lg-live" }, "生ワクチン")
    )
  );
  return wrap;
}

function scheduleView(res) {
  const box = el("div", {});
  if (res.warnings.length)
    box.append(
      el(
        "div",
        { class: "sched-warn" },
        el("b", {}, "⚠ 注意"),
        el("ul", {}, ...res.warnings.map((w) => el("li", { text: w })))
      )
    );
  if (res.items.length) box.append(scheduleTimeline(res));
  if (res.items.length) {
    const tbl = el(
      "table",
      { class: "sched-table" },
      el(
        "thead",
        {},
        el("tr", {}, el("th", {}, "接種日"), el("th", {}, "内容"), el("th", {}, "出発まで"), el("th", {}, "状態"))
      )
    );
    const tb = el("tbody");
    const stJa = { ok: "余裕あり", tight: "ぎりぎり", after: "出発後", past: "過去日" };
    for (const it of res.items) {
      tb.append(
        el(
          "tr",
          { class: `sched-row st-${it.status}` },
          el("td", { class: "sched-date-c" }, it.date),
          el(
            "td",
            {},
            `${it.name_ja}（第${it.doseNo}/${it.doseTotal}回）`,
            it.live ? el("span", { class: "badge cl-badge-yes sched-badge", text: "生" }) : null,
            it.accelerated ? el("span", { class: "sched-tag", text: "迅速化" }) : null
          ),
          el(
            "td",
            {},
            it.dayFromDeparture >= 0 ? `${it.dayFromDeparture}日前` : `${-it.dayFromDeparture}日後`
          ),
          el("td", {}, stJa[it.status] || it.status)
        )
      );
    }
    tbl.append(tb);
    box.append(tbl);
  } else {
    box.append(el("p", { class: "empty" }, "スケジュール表に対応する渡航ワクチンの推奨が見つかりませんでした。"));
  }
  if (res.leadItems.length)
    box.append(
      el(
        "ul",
        { class: "sched-lead" },
        ...res.leadItems.map((l) => el("li", {}, el("b", {}, l.name_ja + "："), l.text_ja))
      )
    );
  return box;
}

// ---- ④ マラリア予防薬 --------------------------------------------------

function renderRefMalaria() {
  const root = $("#ref-malaria");
  root.replaceChildren();
  root.append(el("h2", { class: "ref-h2" }, "④ マラリア予防薬"));
  root.append(
    el("p", {
      class: "ref-lead",
      text:
        "渡航先を選ぶと、その地域のマラリアに関する CDC の記載（地域別リスク・薬剤耐性・原虫種・推奨薬）と TravelHealthPro の記載を表示します。下部の予防内服レジメン表は共通の参考情報です。",
    })
  );
  const info = el("div", { class: "ref-country-box" });
  const df = refDestField("mal-dest", "渡航先の国・地域", (m, status) => {
    info.replaceChildren();
    if (!m) {
      status.textContent = "";
      return;
    }
    if (!m.has_data) {
      status.textContent = `${m.name_ja} は CDC データ未取得です。`;
      return;
    }
    fetchDest(m.slug).then((d) => {
      status.textContent = "";
      const mi = destMalariaInfo(d);
      info.append(el("h3", { class: "ref-h3" }, `${d.name_ja} のマラリア（CDC）`));
      if (mi.cdcText) info.append(el("div", { class: "rec-text", text: mi.cdcText }));
      else
        info.append(
          el("p", { class: "empty" }, "この渡航先ページにマラリアの記載はありません（リスクの記載なし、または対象外）。")
        );
      info.append(
        el("a", { class: "cl-link", href: d.source_url, target: "_blank", rel: "noopener", text: "CDC 原文 →" })
      );
      if (INDEX.find((x) => x.slug === d.slug)?.thp)
        getJSON(`data/thp/${d.slug}.json`)
          .then((t) => {
            if (t?.malaria_en)
              info.append(
                el(
                  "div",
                  { class: "ref-thp-mal" },
                  el("h4", {}, "マラリア（TravelHealthPro・英国）"),
                  el("p", { class: "cl-en", text: t.malaria_en }),
                  el("a", {
                    class: "cl-link",
                    href: t.source_url,
                    target: "_blank",
                    rel: "noopener",
                    text: "TravelHealthPro →",
                  })
                )
              );
          })
          .catch(() => {});
    });
  });
  root.append(df.wrap, info, malariaDrugTable());
  root.append(
    disclaimerNote(
      "用量は成人の代表例です。小児量・妊娠／授乳・G6PD・腎肝機能・併用薬・地域の薬剤耐性は必ず添付文書・CDC Yellow Book・マラリアホットラインで確認してください。予防内服は防蚊対策と必ず併用します。"
    )
  );
}

const costKey = (s) => (String(s).includes("高") ? "high" : String(s).includes("中") ? "mid" : "low");

function malariaDrugTable() {
  const box = el("div", { class: "ref-drugs" }, el("h3", { class: "ref-h3" }, "予防内服レジメン（共通の参考情報）"));
  if (MDRUGS.general_note_ja) box.append(el("p", { class: "ref-lead", text: MDRUGS.general_note_ja }));
  for (const d of MDRUGS.drugs || []) {
    const c = el("details", { class: "drug-card" });
    c.append(
      el(
        "summary",
        {},
        el("b", {}, d.name_ja),
        el("span", { class: "en", text: " " + d.name_en }),
        d.brand_ja && d.brand_ja !== "—" ? el("span", { class: "drug-brand", text: " / " + d.brand_ja }) : null,
        el("span", { class: `drug-cost cost-${costKey(d.cost_tier_ja)}`, text: d.cost_tier_ja })
      )
    );
    const dl = el("dl", { class: "drug-dl" });
    const row = (k, v) => {
      if (v) dl.append(el("dt", { text: k }), el("dd", { text: v }));
    };
    row("スケジュール", d.schedule_ja);
    row("開始", d.start_ja);
    row("滞在中", d.during_ja);
    row("帰国後", d.after_ja);
    row("成人用量", d.adult_dose_ja);
    row("小児", d.pediatric_ja);
    row("G6PD 事前検査", d.g6pd_required ? "必要（定量的 G6PD 活性の測定）" : "不要");
    row("妊娠・授乳", d.pregnancy_ja);
    row("禁忌・慎重投与", d.contraindications_ja);
    row("主な副作用", d.adverse_ja);
    row("特徴", d.advantages_ja);
    row("出典", d.source_ja);
    c.append(dl);
    box.append(c);
  }
  return box;
}

// ---- ⑤ 証明書・入国要件 ----------------------------------------------

const YF_STATUS_JA = {
  required_from_risk: "要（危険国からの入国時）",
  not_required: "不要",
  unknown: "要確認",
};

function renderRefEntry() {
  const root = $("#ref-entry");
  root.replaceChildren();
  root.append(el("h2", { class: "ref-h2" }, "⑤ 予防接種証明書・入国要件"));
  root.append(
    el("p", {
      class: "ref-lead",
      text:
        "黄熱の証明書要件（CDC・TravelHealthPro 原文）と、ポリオの出国接種・ハッジの髄膜炎菌など補足要件の横断表です。要否・年齢下限・免除条件は出発地と最新情報で変わります。必ず各国大使館と原文で確認してください。",
    })
  );

  const rows = (ENTRYREQ.destinations || []).slice().sort((a, b) => a.name_ja.localeCompare(b.name_ja, "ja"));
  const q = el("input", { type: "text", placeholder: "国・地域名で絞り込み…", class: "ref-filter-input" });
  const only = el("input", { type: "checkbox" });
  const onlyReq = el("input", { type: "checkbox" });
  const list = el("div", { class: "entry-list" });
  const draw = () => {
    list.replaceChildren();
    const s = q.value.trim().toLowerCase();
    let shown = 0;
    for (const r of rows) {
      if (s && !`${r.name_ja} ${r.name_en} ${r.slug}`.toLowerCase().includes(s)) continue;
      if (only.checked && !r.has_content) continue;
      if (onlyReq.checked && r.yellow_fever.cdc_cert_status !== "required_from_risk") continue;
      list.append(entryCard(r));
      shown++;
    }
    if (!shown) list.append(el("p", { class: "empty" }, "該当する地域がありません。"));
  };
  q.addEventListener("input", draw);
  only.addEventListener("change", draw);
  onlyReq.addEventListener("change", draw);
  root.append(
    el(
      "div",
      { class: "ref-filter" },
      q,
      el("label", { class: "dx-chk" }, only, el("span", {}, "何らかの要件がある地域のみ")),
      el("label", { class: "dx-chk" }, onlyReq, el("span", {}, "黄熱証明書『要』の地域のみ"))
    ),
    list
  );
  root.append(
    disclaimerNote(
      "黄熱の要否・年齢下限・免除規定は出発国・経由国により異なります。渡航先国大使館と CDC / TravelHealthPro 原文で必ず確認してください。ポリオ出国接種は WHO の一時的勧告により四半期ごとに見直されます。"
    )
  );
  draw();
}

function entryCard(r) {
  const yf = r.yellow_fever;
  const d = el("details", { class: "entry-card" });
  d.append(
    el(
      "summary",
      {},
      el("b", {}, r.name_ja),
      el("span", { class: "en", text: " " + r.name_en }),
      el("span", { class: `badge yf-${yf.cdc_cert_status}`, text: "黄熱証明書: " + (YF_STATUS_JA[yf.cdc_cert_status] || "?") }),
      r.polio_exit_note_ja ? el("span", { class: "badge entry-extra", text: "ポリオ出国接種" }) : null,
      r.meningococcal_note_ja ? el("span", { class: "badge entry-extra", text: "髄膜炎菌" }) : null
    )
  );
  const body = el("div", { class: "entry-body" });
  if (yf.cdc_certificate_en)
    body.append(
      el("div", {}, el("h4", {}, "黄熱 — 入国要件（CDC 原文）"), el("div", { class: "cl-en", text: yf.cdc_certificate_en }))
    );
  if (yf.cdc_recommendation_en)
    body.append(
      el(
        "details",
        {},
        el("summary", { text: "CDC の黄熱ワクチン推奨（全文）" }),
        el("div", { class: "cl-en", text: yf.cdc_recommendation_en })
      )
    );
  if (yf.thp_certificate_en)
    body.append(
      el(
        "div",
        {},
        el("h4", {}, "黄熱 — Certificate requirements（TravelHealthPro 原文）"),
        el("div", { class: "cl-en", text: yf.thp_certificate_en })
      )
    );
  if (r.polio_exit_note_ja)
    body.append(
      el(
        "div",
        {},
        el("h4", {}, "ポリオ 出国時接種"),
        el("p", { class: "cl-change-ja", text: r.polio_exit_note_ja }),
        r.supplement_source_ja ? el("p", { class: "src-attr", text: "出典: " + r.supplement_source_ja }) : null
      )
    );
  if (r.meningococcal_note_ja)
    body.append(
      el(
        "div",
        {},
        el("h4", {}, "髄膜炎菌（巡礼要件など）"),
        el("p", { class: "cl-change-ja", text: r.meningococcal_note_ja }),
        r.supplement_source_ja ? el("p", { class: "src-attr", text: "出典: " + r.supplement_source_ja }) : null
      )
    );
  const links = el("div", { class: "notice-meta" });
  if (r.sources?.cdc)
    links.append(
      el("a", { class: "cl-link", href: r.sources.cdc, target: "_blank", rel: "noopener", text: "CDC 原文 →" }),
      " "
    );
  if (r.sources?.thp)
    links.append(
      el("a", { class: "cl-link", href: r.sources.thp, target: "_blank", rel: "noopener", text: "TravelHealthPro →" })
    );
  body.append(links);
  d.append(body);
  return d;
}

// ---- ⑥ 帰国後の初期対応フロー --------------------------------------

function renderRefPostReturn() {
  const root = $("#ref-postreturn");
  root.replaceChildren();
  if (!POSTRETURN) {
    root.append(el("p", { class: "empty" }, "データを読み込めませんでした。"));
    return;
  }
  root.append(el("h2", { class: "ref-h2" }, "⑥ 帰国後の発熱・下痢・皮疹 初期対応フロー"));
  root.append(
    el("p", {
      class: "ref-lead",
      text:
        "症候別の初期 workup の順序・red flags・鑑別の入口、ウイルス性出血熱（VHF）の隔離判断、感染症法の届出対象をまとめています。初期対応の目安であり、個別の病歴・診察・検査に代わるものではありません。",
    })
  );

  root.append(
    el(
      "div",
      { class: "pr-common" },
      el("h3", { class: "ref-h3" }, "帰国後の発熱：全例で行うこと"),
      el("ol", { class: "pr-ol" }, ...POSTRETURN.common_first_line_ja.map((t) => el("li", { text: t })))
    )
  );

  const nav = el("div", { class: "pr-nav" });
  const content = el("div", { class: "pr-content" });
  const drawSyn = (syn) => {
    content.replaceChildren();
    content.append(el("h3", { class: "ref-h3" }, syn.label_ja));
    content.append(el("h4", {}, "初期 workup（順序の目安）"));
    content.append(el("ol", { class: "pr-ol" }, ...syn.initial_workup_ja.map((t) => el("li", { text: t }))));
    content.append(el("h4", { class: "pr-red" }, "🚩 Red flags"));
    content.append(el("ul", { class: "pr-red-list" }, ...syn.red_flags_ja.map((t) => el("li", { text: t }))));
    content.append(el("h4", {}, "鑑別の入口"));
    const dl = el("div", { class: "pr-dx" });
    for (const df of syn.differentials_ja) {
      const dis = df.dx_id ? DISEASES.find((x) => x.id === df.dx_id) : null;
      const item = el("div", { class: "pr-dx-item" }, el("b", {}, df.name_ja), " ", el("span", { class: "en", text: df.note_ja }));
      if (dis?.cdc_url)
        item.append(
          " ",
          el("a", { class: "cl-link", href: dis.cdc_url, target: "_blank", rel: "noopener", text: "CDC Yellow Book →" })
        );
      dl.append(item);
    }
    content.append(dl);
    content.append(el("h4", {}, "紹介・専門科の目安"));
    content.append(el("p", { text: syn.when_to_refer_ja }));
  };
  POSTRETURN.syndromes.forEach((syn, i) => {
    const b = el("button", { class: "pr-nav-btn" + (i === 0 ? " is-active" : ""), type: "button", text: syn.label_ja });
    b.addEventListener("click", () => {
      for (const x of nav.children) x.classList.remove("is-active");
      b.classList.add("is-active");
      drawSyn(syn);
    });
    nav.append(b);
  });
  root.append(nav, content);
  drawSyn(POSTRETURN.syndromes[0]);

  const vhf = POSTRETURN.vhf_isolation_ja;
  root.append(
    el(
      "div",
      { class: "pr-vhf" },
      el("h3", { class: "ref-h3" }, "🧫 " + vhf.title_ja),
      el("h4", {}, "疑う基準（両方を満たす）"),
      el("ul", {}, ...vhf.criteria_ja.map((t) => el("li", { text: t }))),
      el("h4", {}, "直ちに行うこと"),
      el("ol", { class: "pr-ol" }, ...vhf.immediate_actions_ja.map((t) => el("li", { text: t }))),
      vhf.endemic_hint_ja ? el("p", { class: "hint", text: vhf.endemic_hint_ja }) : null
    )
  );

  const nt = POSTRETURN.notifiable_ja;
  const ntBox = el(
    "div",
    { class: "pr-notify" },
    el("h3", { class: "ref-h3" }, "📋 " + nt.title_ja),
    el("p", { class: "hint", text: nt.note_ja })
  );
  for (const c of nt.categories)
    ntBox.append(
      el("div", { class: "pr-notify-row" }, el("b", { text: c.class_ja }), el("span", { text: "：" + c.diseases_ja.join("、") }))
    );
  root.append(ntBox);
  root.append(
    disclaimerNote(
      "初期対応の目安です。用量・抗菌薬選択・隔離手順・届出の要否は、最新のガイドライン・厚生労働省 感染症法 届出基準・地域の感染症専門医／検疫所／保健所に確認してください。"
    )
  );
}

// ---- ⑦ 特殊集団の渡航 ------------------------------------------------

function renderRefSpecial() {
  const root = $("#ref-special");
  root.replaceChildren();
  root.append(el("h2", { class: "ref-h2" }, "⑦ 特殊集団の渡航"));
  root.append(
    el("p", {
      class: "ref-lead",
      text:
        "集団を選ぶと、生ワクチンの可否・黄熱の扱い・マラリア予防薬の選択・高山病・その他の注意を表示します。可否・用量の最終判断は主治医／専門科と個別に行ってください。",
    })
  );
  const nav = el("div", { class: "pr-nav" });
  const content = el("div", { class: "pr-content" });
  const draw = (p) => {
    content.replaceChildren();
    content.append(el("h3", { class: "ref-h3" }, p.label_ja));
    content.append(el("p", { class: "sp-summary", text: p.summary_ja }));
    const sect = (title, node) => content.append(el("div", { class: "sp-sect" }, el("h4", {}, title), node));
    sect(
      "生ワクチン",
      el(
        "div",
        {},
        el("p", {}, el("span", { class: "badge sp-live", text: p.live_vaccines_ja.status }), " ", p.live_vaccines_ja.detail_ja),
        p.live_vaccines_ja.examples_ja && p.live_vaccines_ja.examples_ja.length
          ? el("p", { class: "hint" }, "対象例: " + p.live_vaccines_ja.examples_ja.join("、"))
          : null
      )
    );
    sect("黄熱ワクチン", el("p", { text: p.yellow_fever_ja }));
    sect(
      "マラリア予防薬",
      el(
        "div",
        {},
        el("p", {}, el("b", {}, "推奨: "), p.malaria_ja.preferred_ja),
        el("p", {}, el("b", {}, "避ける: "), p.malaria_ja.avoid_ja),
        p.malaria_ja.notes_ja ? el("p", { class: "hint", text: p.malaria_ja.notes_ja }) : null
      )
    );
    sect("高山病・高地", el("p", { text: p.altitude_ja }));
    sect("その他の注意", el("ul", {}, ...p.other_ja.map((t) => el("li", { text: t }))));
    content.append(el("p", { class: "src-attr", text: "出典: " + p.source_ja }));
  };
  SPECIALPOP.populations.forEach((p, i) => {
    const b = el("button", { class: "pr-nav-btn" + (i === 0 ? " is-active" : ""), type: "button", text: p.label_ja });
    b.addEventListener("click", () => {
      for (const x of nav.children) x.classList.remove("is-active");
      b.classList.add("is-active");
      draw(p);
    });
    nav.append(b);
  });
  root.append(nav, content);
  draw(SPECIALPOP.populations[0]);
  root.append(
    disclaimerNote(
      "生ワクチンの可否・マラリア薬選択・高地の可否・用量は、免疫抑制の程度・妊娠週数・月齢・腎肝機能で変わります。主治医・専門科と個別に判断してください。"
    )
  );
}

// ---- ⑧ 携行医薬品・トラベルキット ---------------------------------

function packingFlags(destData, slug) {
  const vax = destData.vaccines || [];
  const dis = destData.diseases || [];
  const hasVax = (re) => vax.some((v) => re.test(v.name_en) && SCHED_CATS.has(v.category));
  const hasDis = (re) => dis.some((d) => re.test(d.name_en));
  const altPts = (ALTITUDE.destinations || {})[slug] || [];
  const maxAlt = altPts.reduce((m, p) => Math.max(m, p.m || 0), 0);
  return {
    malaria: destMalariaInfo(destData).risk,
    yellow_fever: hasVax(/yellow fever/i) || hasDis(/yellow fever/i),
    freshwater: hasDis(/schistosomiasis|leptospirosis/i),
    dengue: hasDis(/dengue/i) || hasVax(/dengue/i),
    je: hasVax(/japanese encephalitis/i),
    cholera: hasVax(/cholera/i),
    rabies: hasVax(/rabies/i) || hasDis(/rabies/i),
    typhoid: hasVax(/typhoid/i),
    altitude_m: maxAlt,
    altitude_points: altPts,
  };
}
function ruleMatches(when, flags) {
  for (const [k, v] of Object.entries(when || {})) {
    if (k === "altitude_m_gte") {
      if (!(flags.altitude_m >= v)) return false;
    } else if (!flags[k]) return false;
  }
  return true;
}

function renderRefPacking() {
  const root = $("#ref-packing");
  root.replaceChildren();
  root.append(el("h2", { class: "ref-h2" }, "⑧ 携行医薬品・トラベルキット"));
  root.append(
    el("p", {
      class: "ref-lead",
      text:
        "全渡航共通のベースキットに加え、渡航先を選ぶと、その地域の流行疾患・標高から追加すべき項目を表示します。自己治療薬の処方・用量は渡航者個々のリスク・基礎疾患・アレルギー・併用薬に応じて医師が判断してください。",
    })
  );
  const addBox = el("div", { class: "pack-add" });
  const df = refDestField("pack-dest", "渡航先の国・地域（任意）", (m, status) => {
    addBox.replaceChildren();
    if (!m) {
      status.textContent = "";
      return;
    }
    if (!m.has_data) {
      status.textContent = `${m.name_ja} は CDC データ未取得です（共通キットのみ表示）。`;
      return;
    }
    fetchDest(m.slug).then((d) => {
      status.textContent = "";
      const flags = packingFlags(d, m.slug);
      const rules = (PACKING.conditional_rules || []).filter((r) => ruleMatches(r.when, flags));
      addBox.append(el("h3", { class: "ref-h3" }, `${d.name_ja} で追加すべき項目`));
      if (!rules.length) {
        addBox.append(
          el("p", { class: "empty" }, "この渡航先で自動追加される項目はありません（共通ベースキットをご確認ください）。")
        );
      } else {
        for (const r of rules)
          addBox.append(
            el(
              "div",
              { class: "pack-rule" },
              el("h4", {}, r.title_ja),
              el("ul", {}, ...r.add_ja.map((t) => el("li", { text: t }))),
              r.note_ja ? el("p", { class: "hint", text: r.note_ja }) : null
            )
          );
      }
      if (flags.altitude_points.length)
        addBox.append(
          el("p", { class: "hint" }, "高地の例: " + flags.altitude_points.map((p) => `${p.place_ja} ${p.m}m`).join(" / "))
        );
    });
  });
  root.append(df.wrap, addBox);
  root.append(el("h3", { class: "ref-h3" }, "共通ベースキット"));
  for (const c of PACKING.categories || [])
    root.append(
      el("div", { class: "pack-cat" }, el("h4", {}, c.title_ja), el("ul", {}, ...c.items_ja.map((t) => el("li", { text: t }))))
    );
  root.append(
    disclaimerNote(
      "自己治療用抗菌薬・アセタゾラミド・ステロイドなどの処方は、渡航者個々のリスク評価に基づき医師が行ってください。数量・用量は代表例です。"
    )
  );
}

init();
