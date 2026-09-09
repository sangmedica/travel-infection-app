---
name: travel-infection-app
description: 渡航者感染症アプリ (travel-infection-app) の目的・構成・更新モデル
metadata: 
  node_type: memory
  type: project
  originSessionId: 8f8e20a4-6865-47c5-8bdf-3d14c0fb4b99
  modified: 2026-09-09T01:50:57.022Z
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

- 技術: フレームワーク無し。`index.html`/`app.js`/`styles.css` + 事前生成 `data/*.json`。スクレイパは Node ESM + cheerio (`scripts/scrape.mjs`)。
- 更新モデル: `.github/workflows/update.yml` が毎月1日にスクレイプ→`data/` 差分を main へコミット→`deploy.yml` が GitHub Pages へデプロイ。
- CDC 制約: robots.txt の Crawl-delay 20 秒厳守（`SCRAPE_DELAY_MS`）。目的地ページは API 無しで HTML パース。ワクチン推奨度は推奨文からの自動分類（`classifyRecommendation`）。
- `config/destinations.json` は `scripts/build-config.mjs` の `ROWS` から生成（`--check` で CI 検証可）。`data/translations.json`（日本語対訳）は手管理、未対訳語は `data/untranslated.txt` に毎月出力。
- ユーザーは渡航医学に携わる医師。関連: [[user-profile]]
