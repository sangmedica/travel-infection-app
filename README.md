# 渡航先 感染症・推奨ワクチン検索

渡航先の国・地域を入力すると、[CDC Travelers' Health](https://wwwnc.cdc.gov/travel/) のデータをもとに

- **推奨ワクチン・医薬品**（推奨度別グルーピング）
- **ワクチンで予防できない疾患**（感染経路別）
- **現在の流行情報**（CDC Travel Notices / Level 1–4）＋世界的な注意喚起

を表示する、フレームワーク不使用の静的 Web アプリです。データは月1回 GitHub Actions が自動更新します。

> ⚠️ 情報提供のみを目的とし、医学的助言ではありません。渡航前に必ずトラベルクリニック／医師にご相談ください。

---

## 構成

| パス | 役割 |
|---|---|
| `index.html` / `app.js` / `styles.css` | フロントエンド（実行時は同梱 JSON を読むだけ・外部通信なし） |
| `config/destinations.json` | 取得対象リスト（CDC 全 244 目的地）。`kind`: `country`=国 / `territory`=属領・地域。`scripts/build-config.mjs` で生成（直接編集も可） |
| `data/translations.json` | ★手管理: 日本語対訳辞書 |
| `data/notices.json` | 自動生成: Travel Notices 全件 |
| `data/destinations/<slug>.json` | 自動生成: 渡航先ごとのワクチン＋疾患 |
| `data/destinations-index.json` | 自動生成: 検索インデックス |
| `data/untranslated.txt` | 自動生成: 未対訳語の一覧（毎月ここを見て辞書に追記） |
| `data/meta.json` | 自動生成: 最終取得日・エラー・件数 |
| `scripts/scrape.mjs` | スクレイパ本体 |
| `scripts/build-config.mjs` | `config/destinations.json`（244件・日本語名・kind）の生成／`--check` |
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
