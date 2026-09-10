---
name: travel-infection-app
description: 渡航者感染症アプリ (travel-infection-app) の目的・構成・更新モデル
metadata: 
  node_type: memory
  type: project
  originSessionId: 8f8e20a4-6865-47c5-8bdf-3d14c0fb4b99
  modified: 2026-09-10T02:18:21.945Z
---

`C:\Users\406\Claude\travel-infection-app` — 渡航先を入力すると CDC Travelers' Health
(https://wwwnc.cdc.gov/travel/) 由来の推奨ワクチン（推奨度別）・非ワクチン疾患・Travel Notices を
表示する静的 Web アプリ。2026-09-03 に構築・公開完了。
- リポジトリ: https://github.com/sangmedica/travel-infection-app （Public）
- 公開URL: https://sangmedica.github.io/travel-infection-app/ （GitHub Pages / Actions ソース）
- **GitHubバックアップ（2026-09-09）**：全コミット push 済み。他アプリと同方式で `docs/README.md`（復元手順）＋`docs/claude-memory.md`（このメモのコピー）を同梱。ただし本アプリは Pages 配信のため **PUBLIC**（他アプリは private）。更新時は `git -C C:\Users\406\Claude\travel-infection-app add -A && commit && push`、メモ更新時は `docs/claude-memory.md` も差し替える。ローカル git identity は sangmedica <sangmedica@gmail.com>（リポジトリ限定設定）。
- 対象は CDC 全 244 目的地（`config/destinations.json`、国195 / 属領・地域49、各項目に `kind`）。
  実データは 242/244（`united-states` と `antarctica` は CDC にワクチン表が無く解析対象外）。
- 月次自動更新: `.github/workflows/update.yml`（毎月1日 03:00 UTC）→ `data/` を main へ commit →
  `deploy.yml` が `workflow_run` で Pages 再デプロイ。Actions は write 権限、Pages は build_type=workflow。
- フロントに 国/属領・地域 の絞り込みあり。gh CLI はポータブル版を `%LOCALAPPDATA%\Programs\gh` に導入・PATH 追加済み（`sangmedica` で認証、scope: repo, workflow）。
- 初期セットアップ用に `setup-github.ps1`（リポジトリ作成＋Actions/Pages設定＋デプロイを冪等実行）。
- アプリアイコン `assets/app-icon.ico`（favicon 兼デスクトップショートカット `C:\Users\406\Desktop\渡航先感染症・推奨ワクチン検索.url`）。
- トップに「新規更新（日付つき）」: `scripts/lib/diff.mjs` が全件フェッチ時に前回との差分を `data/changelog.json` に記録し、`app.js` が英語原文つきで表示（誤訳防止）。
- モード②「症状から鑑別」(2026-09-04追加): 症状/曝露/検査/潜伏期/渡航先 → 鑑別 No.1〜5。手キュレートの `data/kb/`（diseases.json 66疾患・findings.json・region-map.json）＋決定論スコアリング `dx.js`（ブラウザ/Node 共用）。意思決定支援であり確定診断ではない旨と「見逃してはいけない疾患」枠あり。`scripts/kb-check.mjs` と `scripts/dx.test.mjs`（ビネット8件）で検証、deploy.yml が公開前に実行。`app.js` は module 化済み、`?mode=dx` でディープリンク。
- 各疾患に `treatment_ja`/`treatment_en`（治療の要点、日英）を追加済み。UI では折りたたみ詳細内に「治療（要参照確認）」枠で表示、免責に用量・相互作用・妊娠等の確認を明記。KB 拡張は `diseases.json` に追記（自動更新の対象外・作り切り）。
- 情報源3ソース化(2026-09-09): CDC に加え **TravelHealthPro**（英国NaTHNaC, OGL v3.0, `scripts/lib/thp.mjs`, RSS `rss-outbreaks.php`＋`/countries/<slug>` の All/Most/Some ティア。robots で `/news/` 不可）と **FORTH**（厚労省検疫所, 公共データ利用規約1.0＝出典＋編集加工明示, `scripts/lib/forth.mjs`, `/topics/fragment1.html`＋`/destinations/country/<page>.html`。RSS無し・日本語散文・地域まとめページ多い）。`config/source-map.json`（`scripts/build-source-map.mjs`、CDC slug→{thp,forth}、THP 240/FORTH 195）。`scrape.mjs --source=cdc|thp|forth|all`。データは `data/thp/` `data/forth/`（outbreaks.json/topics.json＋<slug>.json）。UI は渡航先ビューにソース別折りたたみ、流行情報ブロックと dx.js に3ソース統合（`ALL_FEED`）、changelog は `entry.sources.{cdc,thp,forth}` 構造でソース別・原文つき（CDC/THP=英語, FORTH=日本語）。`scripts/sources-check.mjs`、`update.yml` timeout 240、THP/FORTH は 6 秒間隔（`http.mjs` の `delayMs`）。
- モード③「診療リファレンス」6機能追加(2026-09-10): トップタブが3つに（① 流行疾患・推奨ワクチンの検索 ／ ② 症状から鑑別 ／ ③ 診療リファレンス）。③ はサブタブ6枚 `?mode=ref&ref=schedule|malaria|entry|postreturn|special|packing`。**すべて手キュレート KB（作り切り・自動更新の対象外）**: `data/kb/vaccine-schedules.json`（③・約17ワクチン）/`malaria-drugs.json`（④・6剤）/`post-return.json`（⑥・症候6＋VHF隔離＋感染症法届出。`differentials_ja[].dx_id` は `diseases.json` の id を参照＝kb-check で検証）/`special-populations.json`（⑦・7集団）/`packing.json`（⑧・共通キット＋`conditional_rules[].when` フラグ）/`altitude.json`（⑧補助・34 slug）/`entry-supplement.json`（⑤補足＝ポリオ出国接種・ハッジ髄膜炎菌のみ。黄熱は含めない）。③ の逆算エンジンは **`schedule.js`**（ブラウザ／Node 共用 ESM、`buildSchedule()`/`matchSchedule()`、テスト `scripts/schedule.test.mjs`）。入力は渡航先＋渡航予定日＋**初回に接種を受けられる日 `firstVisitDate`**（起点。未入力＝今日、過去日は今日扱い）。出力に `start`/`firstVisit`/`visitDates`（出発前の受診日の目安）。UI（app.js `renderRefSchedule`/`scheduleView`/`scheduleTimeline`）は表に加え**横型カレンダー**（今日→出発の横軸に接種日マーカー、同日はまとめ、レーン割当で吹き出しの重なり回避、月目盛り、生/tight 色分け、firstVisit 前は斜線の「受診前」帯＋「初回受診」マイルストーン、出発後の回は軸外に注記）。⑤ の `data/entry-requirements.json` は **スクレイプ時に `scripts/lib/entry.mjs` が既存 CDC 黄熱行＋THP `certificate_en`＋entry-supplement から再生成**（ネット取得なし。`scripts/build-entry-requirements.mjs` で単独生成／`--check`）。deploy.yml の検証に `build-entry-requirements --check` と `schedule.test` を追加、_site に `schedule.js` を同梱。`npm run validate` が CI 一式。kb-check.mjs に③〜⑧の全スキーマ検証を追加。**計画では③④⑧を渡航先ビュー内に置く案だったが、実装は6機能すべてモード③のサブタブに集約**（mode① を無改変にして回帰リスクを下げるため）。**`packing_en` の CDC スクレイプは見送り**（別ページ `/traveler/packing-list` 参照でCDC取得が倍増・内容はほぼ定型のため。⑧は手キュレート＋条件ルールで代替）。各パネルに免責固定表示（用量は代表例・確定診断/処方ではない）。

- 技術: フレームワーク無し。`index.html`/`app.js`/`styles.css` + 事前生成 `data/*.json`。スクレイパは Node ESM + cheerio (`scripts/scrape.mjs`)。
- 更新モデル: `.github/workflows/update.yml` が毎月1日にスクレイプ→`data/` 差分を main へコミット→`deploy.yml` が GitHub Pages へデプロイ。
- CDC 制約: robots.txt の Crawl-delay 20 秒厳守（`SCRAPE_DELAY_MS`）。目的地ページは API 無しで HTML パース。ワクチン推奨度は推奨文からの自動分類（`classifyRecommendation`）。
- `config/destinations.json` は `scripts/build-config.mjs` の `ROWS` から生成（`--check` で CI 検証可）。`data/translations.json`（日本語対訳）は手管理、未対訳語は `data/untranslated.txt` に毎月出力。
- ユーザーは渡航医学に携わる医師。関連: [[user-profile]]
