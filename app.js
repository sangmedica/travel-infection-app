"use strict";

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
  for (const kid of kids) {
    if (kid == null) continue;
    node.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
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

// ---- 初期化 -------------------------------------------------------------------

async function init() {
  try {
    [INDEX, NOTICES, META, CHANGELOG] = await Promise.all([
      getJSON("data/destinations-index.json"),
      getJSON("data/notices.json").catch(() => []),
      getJSON("data/meta.json").catch(() => null),
      getJSON("data/changelog.json").catch(() => []),
    ]);
  } catch (err) {
    $("#search-hint").textContent = "データの読み込みに失敗しました: " + err.message;
    return;
  }

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

  // ?d=slug ディープリンク
  const q = new URLSearchParams(location.search).get("d");
  if (q) {
    input.value = q;
    resolveAndShow(q);
  }
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

  // 3) この地域の流行情報
  const local = NOTICES.filter(
    (n) => !n.is_global && (n.matched_slugs || []).includes(data.slug)
  ).sort((a, b) => (b.level || 0) - (a.level || 0));
  const noticeSection = el(
    "section",
    { class: "card-section" },
    el("h3", {}, `${data.name_ja} の流行情報（CDC Travel Notices）`)
  );
  if (local.length === 0) {
    noticeSection.append(
      el("p", {
        class: "empty",
        text: "この地域を名指しする現行の Travel Notice はありません（世界的な注意喚起は下部を参照）。",
      })
    );
  } else {
    for (const n of local) noticeSection.append(noticeItem(n, data.slug));
  }
  root.append(noticeSection);

  renderGlobalNotices(data.slug);
  root.scrollIntoView({ behavior: "smooth", block: "start" });
}

function noticeItem(n, currentSlug) {
  const onList = currentSlug && (n.matched_slugs || []).includes(currentSlug);
  return el(
    "div",
    { class: "notice-item" },
    el(
      "div",
      { class: "notice-title" },
      el("span", { class: `badge lvl${n.level || 0}`, text: `L${n.level || "?"}` }),
      " ",
      n.topic_ja ? `${n.topic_ja}（${n.topic_en}）` : n.topic_en || n.title_en,
      n.place_en ? ` — ${n.place_en}` : ""
    ),
    el("div", {
      class: "notice-meta",
      text: `${LEVEL_JA[n.level || 0]}｜掲載 ${fmtDate(n.published)}`,
    }),
    onList
      ? el("p", { class: "notice-summary warn", text: "▶ この渡航先も対象国リストに含まれています。" })
      : null,
    n.summary_en ? el("p", { class: "notice-summary", text: n.summary_en }) : null,
    el(
      "div",
      { class: "notice-meta" },
      el("a", { href: n.url, target: "_blank", rel: "noopener", text: "CDC の原文を開く →" })
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

  const nd = entry.notices || {};
  const dests = entry.destinations || [];
  const hasDetail =
    (nd.added && nd.added.length) ||
    (nd.removed && nd.removed.length) ||
    (nd.level_changed && nd.level_changed.length) ||
    dests.length;
  if (!hasDetail) return wrap;

  const det = el("details", open ? { open: "" } : {});
  det.append(el("summary", { text: "詳細（CDC 英語原文つき）" }));

  if ((nd.added && nd.added.length) || (nd.level_changed && nd.level_changed.length) || (nd.removed && nd.removed.length)) {
    const box = el("div", { class: "cl-block" }, el("h4", { text: "Travel Notices" }));
    for (const n of nd.added || [])
      box.append(clItem(`新規: ${noticeLabelJa(n)}`, n.title_en, n.summary_en, n.url));
    for (const n of nd.level_changed || [])
      box.append(
        clItem(
          `レベル変更: ${noticeLabelJa(n)}  Level ${n.level_from} → ${n.level_to}`,
          n.title_en,
          n.summary_en,
          n.url
        )
      );
    for (const n of nd.removed || [])
      box.append(clItem(`掲載終了: ${noticeLabelJa(n)}`, n.title_en, "", n.url));
    det.append(box);
  }

  const SHOW = 30;
  for (const dd of dests.slice(0, SHOW)) {
    const box = el("div", { class: "cl-block" }, el("h4", {}, `${dd.name_ja}（${dd.name_en}）`));
    const ul = el("ul", { class: "cl-changes" });
    for (const c of dd.changes) ul.append(el("li", {}, ...changeLine(c)));
    box.append(ul);
    det.append(box);
  }
  if (dests.length > SHOW)
    det.append(el("p", { class: "hint", text: `ほか ${dests.length - SHOW} 地域で変更があります。` }));

  wrap.append(det);
  return wrap;
}

function clItem(titleJa, enLine, enBody, url) {
  const item = el("div", { class: "cl-item" }, el("div", { class: "cl-item-ja", text: titleJa }));
  if (enLine) item.append(el("div", { class: "cl-en cl-en-line", text: enLine }));
  if (enBody) item.append(el("blockquote", { class: "cl-en", text: enBody }));
  if (url)
    item.append(
      el("a", { class: "cl-link", href: url, target: "_blank", rel: "noopener", text: "CDC 原文 →" })
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
    default:
      out.push(ja(JSON.stringify(c)));
  }
  return out;
}

function renderGlobalNotices(currentSlug) {
  const globals = NOTICES.filter((n) => n.is_global).sort((a, b) => (b.level || 0) - (a.level || 0));
  if (globals.length === 0) return;
  $("#global-notices").hidden = false;
  $("#global-count").textContent = `（${globals.length}）`;
  const body = $("#global-notices-body");
  body.replaceChildren();
  for (const n of globals) body.append(noticeItem(n, currentSlug));
}

init();
