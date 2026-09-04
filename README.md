# 渡航先 感染症・推奨ワクチン検索

フレームワーク不使用の静的 Web アプリ。2つのモードがあります。

**① 流行疾患・推奨ワクチンの検索** — 渡航先の国・地域を入力すると、[CDC Travelers' Health](https://wwwnc.cdc.gov/travel/) のデータをもとに
- **推奨ワクチン・医薬品**（推奨度別グルーピング）
- **ワクチンで予防できない疾患**（感染経路別）
- **現在の流行情報**（CDC Travel Notices / Level 1–4）＋世界的な注意喚起
- **新規更新** — 月次更新の差分（英語原文つき）

**② 症状から鑑別** — 症状・曝露歴・検査所見・潜伏期・渡航先をクリックで選ぶと、想定される鑑別診断を
No.1〜No.5 の優先度順で表示（各項目に一致所見・地理・潜伏期の根拠と CDC 英語原文つき）。手キュレートの
疾患知識ベース（`data/kb/`）と決定論的スコアリング（`dx.js`）による**意思決定支援**で、確定診断ではありません。

地域データは月1回 GitHub Actions が自動更新。症状知識ベースは静的（自動更新の対象外）。

> ⚠️ 情報提供のみを目的とし、医学的助言ではありません。渡航前に必ずトラベルクリニック／医師にご相談ください。

---

## 構成

| パス | 役割 |
|---|---|
| `index.html` / `app.js` / `styles.css` | フロントエンド（実行時は同梱 JSON を読むだけ・外部通信なし） |
| `config/destinations.json` | 取得対象リスト（CDC 全 244 目的地）。`kind`: `country`=国 / `territory`=属領・地域。`scripts/build-config.mjs` で生成（直接編集も可） |
| `data/translations.json` | ★手管理: 日本語対訳辞書 |
| `data/notices.json` | 自動生成: Travel Notices 全件 |
| `data/changelog.json` | 自動生成: 月次更新ごとの差分（トップの「新規更新」）。各項目に英語原文つき |
| `data/kb/findings.json` | ★手キュレート: 鑑別モードのクリック用リスト（症状・曝露歴・検査所見） |
| `data/kb/diseases.json` | ★手キュレート: 疾患知識ベース（症状/検査の重み・潜伏期・鑑別ポイント・推奨検査・**治療の要点**・出典）。66疾患。日本語＋英語原文 |
| `data/kb/region-map.json` | 生成: slug→地域タグ（`scripts/build-region-map.mjs`）。鑑別の地理判定用 |
| `dx.js` | 鑑別スコアリング（決定論的・ESM。ブラウザと Node で共用） |
| `data/destinations/<slug>.json` | 自動生成: 渡航先ごとのワクチン＋疾患 |
| `data/destinations-index.json` | 自動生成: 検索インデックス |
| `data/untranslated.txt` | 自動生成: 未対訳語の一覧（毎月ここを見て辞書に追記） |
| `data/meta.json` | 自動生成: 最終取得日・エラー・件数 |
| `scripts/scrape.mjs` | スクレイパ本体 |
| `scripts/lib/diff.mjs` | 前回データとの差分計算＋「新規更新」エントリ生成（全件フェッチ時のみ） |
| `scripts/build-config.mjs` | `config/destinations.json`（244件・日本語名・kind）の生成／`--check` |
| `scripts/build-region-map.mjs` | `data/kb/region-map.json` の生成／`--check` |
| `scripts/kb-check.mjs` | 疾患KBの整合性チェック（`npm run kb:check`） |
| `scripts/dx.test.mjs` | 鑑別スコアリングの臨床ビネットテスト（`npm run kb:test`） |
| `.github/workflows/update.yml` | 月次データ更新（cron: 毎月1日 03:00 UTC） |
| `.github/workflows/deploy.yml` | GitHub Pages へデプロイ（main への push で発火） |

## ローカルでの実行

```bash
npm ci

# データ取得（robots.txt の Crawl-delay 20 秒を尊重。全 244 目的地で約80分。
# GitHub Actions では月次で自動実行。手元では下記のように範囲を絞るのが実用的）
npm run scrape

# 素早く試す
node scripts/scrape.mjs --only=thailand      # 1 地域だけ
node scripts/scrape.mjs --notices-only        # Travel Notices だけ
node scripts/scrape.mjs --retranslate         # ネット取得なし。辞書だけ再適用
SCRAPE_DELAY_MS=2000 node scripts/scrape.mjs --only=thailand  # 開発時は間隔短縮

# プレビュー（ポート8000。初回に Windows ファイアウォールの許可ダイアログが出ることがあります。
# 「キャンセル」でも localhost からは利用できます）
npm run serve   # → http://localhost:8000
```

## 月次メンテナンス（GitHub Actions が自動実行）

1. `update.yml` が `scrape.mjs` を実行し、`data/` に差分があれば main へコミット。
2. その push で `deploy.yml` が発火し、GitHub Pages が更新される。
3. 実行サマリに **未対訳の語** と **エラー地域** が出るので、必要に応じて
   `data/translations.json` / `config/destinations.json` を手で更新して push。

### 障害に強い設計

- 渡航先ページの必須セクションを解析できなかった場合、**空データで上書きせず前回の JSON を保持**し、
  `data/meta.json` の `errors` に記録します（CDC のサイト改装でデータが消えるのを防止）。
- フロントは `meta.json.errors` があると「一部地域は前回データを表示中」と表示します。

## 対象地域

`config/destinations.json` は CDC の全 244 目的地（国 195 / 属領・地域 49）を収録済みです。
各項目に `kind`（`country` / `territory`）があり、フロントの「種別で絞り込み」ラジオと
結果ヘッダの種別タグに使われます。

CDC 側に新しい目的地が増えた場合は `scripts/build-config.mjs` の `ROWS` に
`[slug, name_en, name_ja, kind, "別名;別名"]` を1行足して `node scripts/build-config.mjs`
を実行します（`config/destinations.json` を直接編集しても構いません）。`slug` は
`https://wwwnc.cdc.gov/travel/destinations/traveler/none/<slug>` の末尾に対応します。

## データと免責

`NOTICE` を参照してください。CDC コンテンツはパブリックドメイン、本プロジェクトは非公式です。
「危険度」は CDC が疾患ごとの数値を公表していないため、Travel Notice レベル（1–4）・
ワクチン推奨度・流行情報を目安として提示しています。ワクチン推奨度の区分は推奨文からの
自動分類であり、最終判断は CDC 原文に拠ってください。
