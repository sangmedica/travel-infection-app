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
  Write-Host "`n[1/3] リポジトリは既に存在します。origin を確認して push します。"
  if (-not (git remote | Select-String '^origin$')) {
    git remote add origin "https://github.com/$repo.git"
  }
  git push -u origin main
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
& $gh api --method POST "repos/$repo/pages" -f build_type=workflow *> $null
if ($LASTEXITCODE -ne 0) {
  Write-Host "  POST 失敗（既に有効の可能性）。PUT で再試行..."
  & $gh api --method PUT "repos/$repo/pages" -f build_type=workflow
}

Write-Host "`n=== 初期設定 完了 ===" -ForegroundColor Green
Write-Host "リポジトリ: https://github.com/$repo"

# --- (任意) ワークフロー実行 -----------------------------------------
if ($Test) {
  Write-Host "`n[Test] タイ1カ国だけ試験実行..."
  & $gh workflow run update.yml --repo $repo --ref main -f only=thailand
  Start-Sleep 5
  & $gh run list --repo $repo --workflow update.yml --limit 3
  Write-Host "進捗確認: gh run watch --repo $repo"
}
if ($Full) {
  Write-Host "`n[Full] 全244目的地を実行（GitHub側で約80分。すぐ戻ります）..."
  & $gh workflow run update.yml --repo $repo --ref main
  Start-Sleep 5
  & $gh run list --repo $repo --workflow update.yml --limit 3
}

if (-not $Test -and -not $Full) {
  Write-Host "`n次のいずれかを実行:" -ForegroundColor Cyan
  Write-Host "  .\setup-github.ps1 -Test     # タイ1カ国で動作確認"
  Write-Host "  .\setup-github.ps1 -Full     # 全244目的地（約80分）"
  Write-Host "`n完了後、公開URL:"
  Write-Host "  gh api repos/$repo/pages --jq .html_url"
  Write-Host "  → https://sangmedica.github.io/travel-infection-app/"
}
