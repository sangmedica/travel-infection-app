import { rankDifferentials, INCUBATION_BUCKETS } from "./dx.js";

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

  // ?d=slug / ?mode=dx ディープリンク
  const params = new URLSearchParams(location.search);
  const q = params.get("d");
  if (q) {
    input.value = q;
    resolveAndShow(q);
  }
  if (params.get("mode") === "dx") setMode("dx");
}

// ---- モード管理 -----------------------------------------------------------

let dxBuilt = false;

function setMode(m) {
  const dx = m === "dx";
  $("#mode-region").hidden = dx;
  $("#mode-dx").hidden = !dx;
  $("#tab-region").classList.toggle("is-active", !dx);
  $("#tab-dx").classList.toggle("is-active", dx);
  const u = new URL(location.href);
  if (dx) u.searchParams.set("mode", "dx");
  else u.searchParams.delete("mode");
  history.replaceState(null, "", u);
  if (dx && !dxBuilt) buildDxView();
  window.scrollTo({ top: 0, behavior: "smooth" });
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

init();
