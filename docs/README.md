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
`index.html` / `app.js` / `styles.css` / `dx.js` ＋ `data/**` だけで動作します（実行時の外部通信なし）。

### データを再取得（CDC スクレイプ）
```bash
node scripts/scrape.mjs --only=thailand          # 1 か国だけ（動作確認、約30秒）
node scripts/scrape.mjs                          # 全 244 目的地（Crawl-delay 20秒厳守、約80分）
node scripts/scrape.mjs --retranslate            # ネット取得なし・対訳辞書だけ再適用
```

### 知識ベース（鑑別モード）の検証
```bash
npm run kb:check       # data/kb/ の整合性（id 参照・244 slug 網羅・潜伏期の妥当性・治療欄の有無）
npm run kb:test        # dx.js の臨床ビネット 8 件
node scripts/build-region-map.mjs --check
node scripts/build-config.mjs --check
```

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
  GitHub Pages を再デプロイ。デプロイ前に config / region-map / KB / ビネットを検証。

## 更新時の運用

```bash
git -C C:\Users\406\Claude\travel-infection-app add -A
git -C C:\Users\406\Claude\travel-infection-app commit -m "..."
git -C C:\Users\406\Claude\travel-infection-app push
```
Claude の作業記憶（`~/.claude/projects/.../memory/travel-infection-app.md`）を更新したら、
その内容を本フォルダの `docs/claude-memory.md` にコピーし直して push する。
ローカル git identity は `sangmedica <sangmedica@gmail.com>`（このリポジトリ限定設定）。
