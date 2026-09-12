# バックアップ・復元手順（travel-infection-app）

このリポジトリ自体が完全なバックアップです。`git clone` すればアプリ・データ・
スクレイパ・CI がすべて揃います。`docs/claude-memory.md` は開発の経緯メモ（Claude の作業記憶）。

- 公開リポジトリ: https://github.com/sangmedica/travel-infection-app （**Public**。GitHub Pages を使うため）
- 公開サイト: https://sangmedica.github.io/travel-infection-app/
- ローカル作業ディレクトリ: `C:\Users\406\Claude\travel-infection-app`

他の静的アプリ（`ninchisho-navi` 等）は private だが、本アプリは Pages 配信のため public。
それ以外のバックアップ方式（`README.md` ＋ `.gitignore` ＋ `docs/`（このファイル＋`claude-memory.md`））は同一。

## 復元（別マシン / クリーン環境）

```bash
git clone https://github.com/sangmedica/travel-infection-app.git
cd travel-infection-app
npm ci                 # 依存は cheerio のみ（スクレイパ用）。閲覧だけなら不要
```

### ローカルで閲覧
```bash
npm run serve          # → http://localhost:8000   （静的サーバー。ビルド不要）
```
`index.html` / `app.js` / `styles.css` / `dx.js` / `schedule.js` ＋ `data/**` だけで動作します（既定では外部通信なし）。
唯一の例外は「🌐 日本語訳」ボタン：利用者が押したときだけ `translate.googleapis.com`（無料・無認証の
Google 翻訳エンドポイント）に問い合わせ、失敗時は `translate.google.com` を新規タブで開きます
（`app.js` の `trAttach`/`gTranslate`/`toggleTranslate`、対象は `.rec-text`/`.guide-text`/`.cl-en` のうち
英語と判定されたものだけ）。

### データを再取得（CDC スクレイプ）
```bash
node scripts/scrape.mjs --only=thailand          # 1 か国だけ（動作確認、約30秒）
node scripts/scrape.mjs                          # 全 244 目的地（Crawl-delay 20秒厳守、約80分）
node scripts/scrape.mjs --retranslate            # ネット取得なし・対訳辞書だけ再適用
```

### 知識ベース・エンジンの検証
```bash
npm run validate       # CI と同じ一式（下記をすべて実行）
npm run kb:check       # data/kb/ の整合性（id 参照・244 slug 網羅・潜伏期・③〜⑧ の追加 KB スキーマ）
npm run kb:test        # dx.js の臨床ビネット 8 件
npm run schedule:test  # schedule.js（③ 出発前スケジュール逆算）のビネット
node scripts/build-entry-requirements.mjs         # data/entry-requirements.json を再生成（⑤用）
node scripts/build-entry-requirements.mjs --check
node scripts/build-region-map.mjs --check
node scripts/build-config.mjs --check
```

### モード③「診療リファレンス」の構成
- `schedule.js` — ③出発前スケジュールの逆算エンジン（`buildSchedule()` / `matchSchedule()`）。`app.js` と `scripts/schedule.test.mjs` が import。
- `data/kb/vaccine-schedules.json`（③）／`malaria-drugs.json`（④）／`post-return.json`（⑥）／`special-populations.json`（⑦）／`packing.json`・`altitude.json`（⑧）／`entry-supplement.json`（⑤補足）はすべて★手キュレート・自動更新の対象外（作り切り）。
- `data/entry-requirements.json`（⑤）はスクレイプ時に `scripts/lib/entry.mjs` が既存の CDC・THP データ＋`entry-supplement.json` から再生成（ネットワーク取得なし）。
- UI は `?mode=ref&ref=schedule|malaria|entry|postreturn|special|packing` で各パネルに直リンク可能。

## GitHub 側の再セットアップ（リポジトリを作り直す場合）

`setup-github.ps1` が冪等に実行します（リポジトリ作成 → Actions 書込権限 → Pages を
"GitHub Actions" ソースで有効化 → デプロイ）。
```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\setup-github.ps1
```
前提: `gh`（GitHub CLI）が `sangmedica` で認証済み（スコープ `repo`, `workflow`）。
ポータブル版が `%LOCALAPPDATA%\Programs\gh\gh.exe` に導入済み・ユーザー PATH 追加済み。

## 自動更新のしくみ

- `.github/workflows/update.yml` — 毎月1日 03:00 UTC に `scripts/scrape.mjs` を実行し、
  `data/` に差分があれば `main` へコミット（`chore: monthly CDC data refresh <日付>`）。
- `.github/workflows/deploy.yml` — `main` への push、または update.yml の完了（`workflow_run`）で
  GitHub Pages を再デプロイ。デプロイ前に config / region-map / source-map / entry-requirements の
  `--check`、kb-check、sources-check、dx.test、schedule.test を実行（`npm run validate` と同じ）。
  静的サイトには `schedule.js` も同梱。

## 更新時の運用

```bash
git -C C:\Users\406\Claude\travel-infection-app add -A
git -C C:\Users\406\Claude\travel-infection-app commit -m "..."
git -C C:\Users\406\Claude\travel-infection-app push
```
Claude の作業記憶（`~/.claude/projects/.../memory/travel-infection-app.md`）を更新したら、
その内容を本フォルダの `docs/claude-memory.md` にコピーし直して push する。
ローカル git identity は `sangmedica <sangmedica@gmail.com>`（このリポジトリ限定設定）。
