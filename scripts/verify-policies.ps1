<#
=============================================================
  보안정책 자동 검증
=============================================================
  powershell -ExecutionPolicy Bypass -File scripts\verify-policies.ps1

  «누가 무엇을 할 수 있는가» 를 실제 PostgreSQL 에 올려서 확인한다.
  화면에서 단추를 숨기는 것만으로는 부족하다 — 브라우저 개발자 도구로
  직접 요청을 보내면 그대로 통과할 수 있기 때문이다. 그 문턱이 DB 정책이고,
  이 스크립트가 그 정책을 하나하나 두들겨 본다.

  시험용 데이터베이스를 새로 만들어 쓰고, 끝나면 지운다.
  운영 자료는 건드리지 않는다.

  옵션
    -PgBin      psql 위치 (기본 C:\Program Files\PostgreSQL\17\bin)
    -TestDb     시험용 DB 이름 (기본 eduform_verify)
    -Keep       끝나고 시험용 DB 를 남긴다 (원인을 들여다볼 때)
=============================================================
#>

[CmdletBinding()]
param(
  [string]$PgBin  = 'C:\Program Files\PostgreSQL\17\bin',
  [string]$TestDb = 'eduform_verify',
  [switch]$Keep
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
$psql = Join-Path $PgBin 'psql.exe'

if (-not (Test-Path $psql)) {
  Write-Host "psql 을 찾을 수 없습니다: $psql" -ForegroundColor Red
  Write-Host "-PgBin 으로 경로를 알려주세요." -ForegroundColor Yellow
  exit 1
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "node 를 찾을 수 없습니다." -ForegroundColor Red; exit 1
}
if (-not (Test-Path (Join-Path $repo 'node_modules\pg'))) {
  Write-Host "먼저 npm ci 를 실행하세요 (pg 패키지가 필요합니다)." -ForegroundColor Red; exit 1
}

Write-Host ""
Write-Host "  postgres 비밀번호를 입력하세요 (화면에 보이지 않습니다)" -ForegroundColor Cyan
$sec = Read-Host -AsSecureString "  비밀번호"
$env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
  [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
$env:PGCLIENTENCODING = 'UTF8'

try {
  & $psql -U postgres -h 127.0.0.1 -d postgres -c "select 1" *> $null
  if ($LASTEXITCODE -ne 0) { Write-Host "  접속 실패 — 비밀번호를 확인하세요" -ForegroundColor Red; exit 1 }

  Write-Host ""
  Write-Host "  시험용 데이터베이스 $TestDb 준비" -ForegroundColor Cyan
  & $psql -U postgres -h 127.0.0.1 -d postgres -q -c "drop database if exists $TestDb" 2>&1 | Out-Null
  & $psql -U postgres -h 127.0.0.1 -d postgres -q -c "create database $TestDb" 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) { Write-Host "  만들지 못했습니다" -ForegroundColor Red; exit 1 }

  # 시험용 DB 에서는 realtime publication 이 없으므로 미리 만들어 둔다
  & $psql -U postgres -h 127.0.0.1 -d $TestDb -q -c `
    "do `$`$ begin create publication supabase_realtime; exception when duplicate_object then null; end `$`$;" 2>&1 | Out-Null

  $env:PGURL = "postgresql://postgres:$($env:PGPASSWORD)@127.0.0.1:5432/$TestDb"

  $tests = Get-ChildItem (Join-Path $repo 'scripts\verify\*.mjs') | Sort-Object Name
  $failed = @()
  foreach ($t in $tests) {
    Write-Host ""
    Write-Host ("─" * 60) -ForegroundColor DarkGray
    Write-Host "  $($t.Name)" -ForegroundColor White
    & node $t.FullName
    if ($LASTEXITCODE -ne 0) { $failed += $t.Name }
  }

  Write-Host ""
  Write-Host ("─" * 60) -ForegroundColor DarkGray
  if ($failed.Count -eq 0) {
    Write-Host "  모든 검증 통과" -ForegroundColor Green
  } else {
    Write-Host "  실패한 검증: $($failed -join ', ')" -ForegroundColor Red
    Write-Host "  위 FAIL 줄을 그대로 알려주세요." -ForegroundColor Yellow
  }
}
finally {
  if (-not $Keep -and $env:PGPASSWORD) {
    & $psql -U postgres -h 127.0.0.1 -d postgres -q -c "drop database if exists $TestDb" 2>&1 | Out-Null
    Write-Host "  시험용 데이터베이스를 지웠습니다." -ForegroundColor DarkGray
  }
  # 비밀번호를 환경변수에 남겨두지 않는다
  $env:PGPASSWORD = $null
  $env:PGURL = $null
}

if ($failed.Count -gt 0) { exit 1 }
