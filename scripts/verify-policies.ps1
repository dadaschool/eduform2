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
  [switch]$Keep,
  # 하나만 골라 돌린다 (예: -Only homeroom). 원인을 좁힐 때 쓴다.
  [string]$Only = ''
)

$ErrorActionPreference = 'Stop'

# node 출력을 변수에 담으면 PowerShell 이 «콘솔 코드페이지» 로 해독한다.
# 한국어 윈도우는 CP949 라서 UTF-8 로 나온 한글이 깨진다. 미리 UTF-8 로 맞춘다.
try {
  [Console]::OutputEncoding = [Text.Encoding]::UTF8
  $OutputEncoding = [Text.Encoding]::UTF8
} catch { }

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

# PostgreSQL 이 꺼져 있으면 psql 원문 오류(Connection refused)만 잔뜩 나온다.
# 먼저 확인하고 켜는 방법을 알려 준다. 연습용 컴퓨터에서는 «수동 시작» 으로
# 두는 경우가 있어 자주 겪는다.
$pgReady = Join-Path $PgBin 'pg_isready.exe'
if (Test-Path $pgReady) {
  & $pgReady -h 127.0.0.1 -p 5432 *> $null
  if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "  PostgreSQL 이 응답하지 않습니다 (127.0.0.1:5432)" -ForegroundColor Red
    $svc = Get-Service -Name 'postgresql*' -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($svc) {
      Write-Host "  서비스 '$($svc.Name)' 상태: $($svc.Status)" -ForegroundColor Yellow
      Write-Host ""
      Write-Host "  이 명령으로 켜고 다시 실행하세요:" -ForegroundColor White
      Write-Host "    Start-Service $($svc.Name)" -ForegroundColor Cyan
    } else {
      Write-Host "  PostgreSQL 서비스를 찾을 수 없습니다. 설치되어 있는지 확인하세요." -ForegroundColor Yellow
    }
    exit 1
  }
  Write-Host "  PostgreSQL 응답 확인" -ForegroundColor Green
}

Write-Host ""
Write-Host "  postgres 비밀번호를 입력하세요 (화면에 보이지 않습니다)" -ForegroundColor Cyan
$sec = Read-Host -AsSecureString "  비밀번호"
$env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
  [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
$env:PGCLIENTENCODING = 'UTF8'

try {
  # 네이티브 명령의 stderr 가 PowerShell 예외로 번지지 않게 잠시 내려 둔다
  $ErrorActionPreference = 'Continue'
  & $psql -U postgres -h 127.0.0.1 -d postgres -c "select 1" 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) {
    Write-Host "  접속 실패 — postgres 비밀번호가 맞는지 확인하세요" -ForegroundColor Red
    exit 1
  }
  Write-Host "  접속 확인" -ForegroundColor Green

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
  if ($Only) {
    $tests = $tests | Where-Object { $_.Name -like "*$Only*" }
    if (-not $tests) { Write-Host "  '$Only' 에 맞는 검사가 없습니다" -ForegroundColor Red; exit 1 }
    Write-Host "  $($tests.Name -join ', ') 만 돌립니다" -ForegroundColor DarkGray
  }
  $failed = @()
  # 실패한 줄은 화면 위로 넘어가 안 보이기 쉽다. 파일에 남기고 끝에 다시 모아 준다.
  $log = Join-Path $env:TEMP 'eduform-verify.log'
  '' | Set-Content -Encoding UTF8 $log

  foreach ($t in $tests) {
    Write-Host ""
    Write-Host ("─" * 60) -ForegroundColor DarkGray
    Write-Host "  $($t.Name)" -ForegroundColor White
    $out = & node $t.FullName 2>&1
    $rc = $LASTEXITCODE
    $out | ForEach-Object { Write-Host $_ }
    ("=== " + $t.Name + " ===") | Add-Content -Encoding UTF8 $log
    $out | Add-Content -Encoding UTF8 $log
    if ($rc -ne 0) { $failed += $t.Name }
  }

  Write-Host ""
  Write-Host ("─" * 60) -ForegroundColor DarkGray
  if ($failed.Count -eq 0) {
    Write-Host "  모든 검증 통과" -ForegroundColor Green
  } else {
    Write-Host "  실패한 검증: $($failed -join ', ')" -ForegroundColor Red
    Write-Host ""
    Write-Host "  실패한 줄만 모았습니다 ────────────────" -ForegroundColor Yellow
    Select-String -Path $log -Encoding UTF8 -Pattern 'FAIL|기대 ' |
      ForEach-Object { Write-Host ("    " + $_.Line.Trim()) -ForegroundColor Red }
    Write-Host ""
    Write-Host "  전체 기록: $log" -ForegroundColor DarkGray
  }
}
finally {
  if ($Keep) {
    Write-Host "  시험용 데이터베이스 $TestDb 를 남겨 두었습니다 (-Keep)." -ForegroundColor DarkGray
  }
  if (-not $Keep -and $env:PGPASSWORD) {
    & $psql -U postgres -h 127.0.0.1 -d postgres -q -c "drop database if exists $TestDb" 2>&1 | Out-Null
    Write-Host "  시험용 데이터베이스를 지웠습니다." -ForegroundColor DarkGray
  }
  # 비밀번호를 환경변수에 남겨두지 않는다
  $env:PGPASSWORD = $null
  $env:PGURL = $null
}

if ($failed.Count -gt 0) { exit 1 }
