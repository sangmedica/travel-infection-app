<#
  GitHub リポジトリ作成 + Actions/Pages 設定 を一括で行う。
  前提: gh (GitHub CLI) が認証済み（sangmedica / スコープ repo, workflow）。

  使い方（このファイルがあるフォルダで PowerShell を開いて）:
    .\setup-github.ps1            # (1)リポジトリ作成+push  (2)Actions書込権限  (3)Pages有効化
    .\setup-github.ps1 -Test      # 上記 + タイ1カ国だけ試験実行（約30秒）
    .\setup-github.ps1 -Full      # 上記 + 全244目的地を実行（GitHub側で約80分）
#>
param(
  [switch]$Test,
  [switch]$Full
)

$ErrorActionPreference = 'Stop'
$repo = 'sangmedica/travel-infection-app'
$root = $PSScriptRoot

# --- gh の場所を解決 -------------------------------------------------------
$gh = 'gh'
try { & $gh --version *> $null } catch { $gh = Join-Path $env:LOCALAPPDATA 'Programs\gh\gh.exe' }
if (-not (Test-Path $gh) -and $gh -ne 'gh') { throw "gh が見つかりません。" }
Write-Host "gh: $gh"

# --- 認証確認 ------------------------------------------------------------
& $gh auth status
if ($LASTEXITCODE -ne 0) { throw "gh が未認証です。'gh auth login' を先に実行してください。" }

Set-Location $root

# --- (1) リポジトリ作成 + push -----------------------------------------
& $gh repo view $repo *> $null
if ($LASTEXITCODE -eq 0) {
  Write-Host "`n[1/3] リポジトリは既に存在します。remote を取り込んでから push します。"
  if (-not (git remote | Select-String '^origin$')) {
    git remote add origin "https://github.com/$repo.git"
  }
  git fetch origin 2>&1 | Out-Null
  # 月次ワークフローが remote/main に commit している場合があるので rebase で取り込む
  git pull --rebase origin main 2>&1
  git push -u origin main 2>&1
} else {
  Write-Host "`n[1/3] 公開リポジトリを作成して push します..."
  & $gh repo create $repo --public --source . --remote origin --push `
      --description "渡航先の流行感染症・推奨ワクチンをCDC Travelers' Healthから表示する静的Webアプリ"
  if ($LASTEXITCODE -ne 0) { throw "リポジトリ作成に失敗しました。" }
}

# --- (2) Actions に書き込み権限（月次のデータ自動コミット用） -----------
Write-Host "`n[2/3] Actions の Workflow permissions を write に設定..."
& $gh api --method PUT "repos/$repo/actions/permissions/workflow" `
    -f default_workflow_permissions=write -F can_approve_pull_request_reviews=false
if ($LASTEXITCODE -ne 0) { throw "Actions 権限設定に失敗しました。" }

# --- (3) GitHub Pages を Actions ソースで有効化 -----------------------
Write-Host "`n[3/3] GitHub Pages を 'GitHub Actions' ソースで有効化..."
$pagesInfo = & $gh api "repos/$repo/pages" 2>$null | ConvertFrom-Json
if ($pagesInfo -and $pagesInfo.build_type -eq 'workflow') {
  Write-Host "  既に有効です (build_type=workflow)。"
} else {
  try   { & $gh api --method POST "repos/$repo/pages" -f build_type=workflow 2>$null }
  catch { }
  if ($LASTEXITCODE -ne 0) {
    & $gh api --method PUT "repos/$repo/pages" -f build_type=workflow 2>$null
  }
  Write-Host "  設定しました。"
}

Write-Host "`n=== 初期設定 完了 ===" -ForegroundColor Green
Write-Host "リポジトリ: https://github.com/$repo"

# --- 現時点のデータで Pages を一度デプロイ（サイトを公開状態にする） ---
Write-Host "`n[Deploy] 現在のデータで GitHub Pages をデプロイ..."
& $gh workflow run deploy.yml --repo $repo --ref main
Start-Sleep 5

# --- (任意) ワークフロー実行 -----------------------------------------
if ($Test) {
  Write-Host "`n[Test] タイ1カ国だけ試験実行..."
  & $gh workflow run update.yml --repo $repo --ref main -f only=thailand
  Start-Sleep 5
}
if ($Full) {
  Write-Host "`n[Full] 全244目的地を実行（GitHub側で約80分。すぐ戻ります）..."
  & $gh workflow run update.yml --repo $repo --ref main
  Start-Sleep 5
}

& $gh run list --repo $repo --limit 6
Write-Host "`n公開URL: https://sangmedica.github.io/travel-infection-app/  (デプロイ完了後1〜2分)" -ForegroundColor Cyan
Write-Host "進捗:  gh run list --repo $repo"
if (-not $Test -and -not $Full) {
  Write-Host "`n全データ取得はこの後:  .\setup-github.ps1 -Full    # 全244目的地（約80分）" -ForegroundColor Cyan
}
