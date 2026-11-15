<#
=============================================================
  에듀폼 2 — 교내 서버 업그레이드 (윈도우 전용)
=============================================================

  install.ps1 로 설치한 서버를 깃허브의 새 판으로 올린다.
  관리자 PowerShell 에서 (서버 컴퓨터에서 바로 받아 실행):

    irm https://raw.githubusercontent.com/dadaschool/eduform2/main/update.ps1 -OutFile "$env:TEMP\update.ps1"
    powershell -ExecutionPolicy Bypass -File "$env:TEMP\update.ps1"

  옵션
    -Root          설치 위치 (기본 C:\srv — install.ps1 과 같게)
    -AppDir        에듀폼 소스 폴더. 비우면 C:\srv\eduform2 (설치 스크립트) →
                   C:\srv\eduform (SELFHOST.md 대로 손으로 설치) 순서로 찾는다
    -CheckOnly     새 판이 있는지만 본다. 아무것도 바꾸지 않는다
    -LmStudioModel 학교 로컬 모델(큐웬) 이름을 .env.local 에 넣는다/바꾼다
                   예: -LmStudioModel qwen/qwen3-4b-2507   (lms ls 로 확인)
    -Force         새 판이 없어도 다시 빌드·재시작한다 (설정만 바꿨을 때)
    -Yes           «수업 중이면 멈추세요» 확인을 묻지 않는다

  하는 일 — 순서대로
    ① 새 판 확인 (git fetch)          — 없으면 여기서 끝
    ② DB 백업 (pg_dump)               — 실패하면 아무것도 바꾸지 않고 멈춘다
    ③ 앱 멈춤                          — 이때부터 접속이 끊긴다 (보통 3~5분)
    ④ 소스 받기 (git pull --ff-only)
    ⑤ 패키지 (package-lock 이 바뀐 경우만 npm ci)
    ⑥ 표·정책 다시 적용 (여러 번 해도 안전한 SQL)
    ⑦ 빌드 → 실패하면 «이전 판으로 되돌려» 다시 빌드한다
    ⑧ 다시 시작 → 응답 점검

  손대지 않는 것
    · .env.local 의 키·비밀번호, postgrest.conf, authenticator 비밀번호
      (-LmStudioModel 을 줬을 때 그 한 줄만 바꾼다)
    · 데이터 — 표를 지우는 SQL 은 없다
=============================================================
#>

[CmdletBinding()]
param(
  [string]$Root = 'C:\srv',
  [string]$AppDir = '',
  [string]$PgVersion = '17',
  [int]$AppPort = 3000,
  [int]$ApiPort = 3001,
  [string]$Branch = 'main',
  [string]$LmStudioModel = '',
  [switch]$CheckOnly,
  [switch]$Force,
  [switch]$Yes
)

# 'Stop' 으로 두지 않는다 — Windows PowerShell 5.1 에서는 git·npm·schtasks 가 stderr 로
# 경고 한 줄만 내도 (2>&1 일 때) 그 자리에서 스크립트가 끊긴다. 외부 프로그램은
# 모두 $LASTEXITCODE 로 성공을 판단하고, 꼭 멈춰야 하는 명령에만 -ErrorAction Stop 을 단다.
$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'

# install.ps1 과 같은 이유 — 한국어 콘솔(CP949)에서 psql·git 의 UTF-8 글자가 깨진다
$oldCodePage = $null
try {
  [Console]::OutputEncoding = [Text.Encoding]::UTF8
  $OutputEncoding = [Text.Encoding]::UTF8
  $oldCodePage = (chcp) -replace '[^0-9]', ''
  chcp 65001 > $null
} catch { }

# 설치 스크립트는 eduform2, SELFHOST.md 의 손 설치는 eduform 폴더를 쓴다
if (-not $AppDir) {
  $AppDir = Join-Path $Root 'eduform2'
  $manual = Join-Path $Root 'eduform'
  if (-not (Test-Path (Join-Path $AppDir '.git')) -and (Test-Path (Join-Path $manual '.git'))) { $AppDir = $manual }
}
$PgBin    = "C:\Program Files\PostgreSQL\$PgVersion\bin"
$Psql     = Join-Path $PgBin 'psql.exe'
$PgDump   = Join-Path $PgBin 'pg_dump.exe'
$EnvLocal = Join-Path $AppDir '.env.local'
$BackupDir = Join-Path $Root 'backup'
$step     = 0

function Head($t) { $script:step++; Write-Host ""; Write-Host "[$script:step] $t" -ForegroundColor Cyan }
function Ok($t)   { Write-Host "    $t" -ForegroundColor Green }
function Info($t) { Write-Host "    $t" -ForegroundColor Gray }
function Warn($t) { Write-Host "    $t" -ForegroundColor Yellow }
function Restore-Console { if ($oldCodePage) { chcp $oldCodePage > $null } }
function Die($t)  {
  $env:PGPASSWORD = $null
  Write-Host ""; Write-Host "  중단: $t" -ForegroundColor Red
  Restore-Console
  exit 1
}
function Git {
  $out = & git -C $AppDir @args 2>&1
  if ($LASTEXITCODE -ne 0) { throw "git $($args -join ' ') 실패: $out" }
  $out | ForEach-Object { "$_" }
}

# ─────────────────────────────────────────────
Head "설치 확인"

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
  ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin -and -not $CheckOnly) { Die "관리자 PowerShell 에서 실행하세요 (작업 스케줄러로 앱을 멈추고 켭니다)" }

if (-not (Test-Path (Join-Path $AppDir '.git'))) { Die "설치된 에듀폼이 없습니다: $AppDir  (처음이면 install.ps1)" }
if (-not (Test-Path $EnvLocal))                 { Die ".env.local 이 없습니다: $EnvLocal  (install.ps1 을 먼저)" }
if (-not (Get-Command git  -ErrorAction SilentlyContinue)) { Die "git 을 찾을 수 없습니다" }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Die "node 를 찾을 수 없습니다" }
if (-not (Test-Path $Psql)) { Die "psql 을 찾을 수 없습니다: $Psql  (-PgVersion 으로 버전을 알려주세요)" }
Ok "설치 위치: $AppDir"

# 서버에서 손으로 고친 파일이 있으면 pull 이 섞이거나 멈춘다. 지우지 않고 알려만 준다.
$dirty = (Git status --porcelain --untracked-files=no) | Where-Object { $_ }
if ($dirty) {
  Warn "이 서버에서 직접 고친 소스 파일이 있습니다:"
  $dirty | ForEach-Object { Warn "  $_" }
  Die "고친 내용을 따로 보관한 뒤 (git -C $AppDir stash) 다시 실행하세요"
}

# ─────────────────────────────────────────────
Head "새 판 확인"

try { Git fetch --quiet origin $Branch | Out-Null } catch { Die "깃허브에 연결하지 못했습니다 — 이 컴퓨터의 인터넷을 확인하세요" }
$oldRev = (Git rev-parse HEAD).Trim()
$newRev = (Git rev-parse "origin/$Branch").Trim()
$oldShort = $oldRev.Substring(0, 7)
$newShort = $newRev.Substring(0, 7)

$hasNew = $oldRev -ne $newRev
if ($hasNew) {
  $ahead = (Git rev-list --count "HEAD..origin/$Branch").Trim()
  Ok "새 판이 있습니다: $oldShort → $newShort ($ahead 개 변경)"
  Git log --oneline --no-decorate "HEAD..origin/$Branch" | Select-Object -First 15 | ForEach-Object { Info "  $_" }
  $lockChanged = [bool](Git diff --name-only $oldRev $newRev -- package-lock.json package.json)
  $sqlChanged  = [bool](Git diff --name-only $oldRev $newRev -- supabase)
  if ($lockChanged) { Info "패키지 목록이 바뀌었습니다 → npm ci 를 다시 합니다" }
  if ($sqlChanged)  { Info "DB 표·정책이 바뀌었습니다 → 다시 적용합니다" }
} else {
  Ok "이미 최신입니다 ($oldShort)"
  $lockChanged = $false
  $sqlChanged = $false
}

if ($CheckOnly) {
  Write-Host ""
  Write-Host "  확인만 했습니다. 아무것도 바꾸지 않았습니다." -ForegroundColor White
  Restore-Console; exit 0
}
if (-not $hasNew -and -not $Force -and -not $LmStudioModel) {
  Write-Host ""
  Write-Host "  할 일이 없습니다. (설정만 바꿨다면 -Force 로 다시 시작)" -ForegroundColor White
  Restore-Console; exit 0
}

if (-not $Yes) {
  Write-Host ""
  Warn "앱을 멈췄다가 다시 켭니다. 그동안(보통 3~5분) 교사·학생 화면이 열리지 않습니다."
  Warn "수업 중이면 지금 하지 마세요."
  if ((Read-Host "    지금 진행할까요? (y/N)") -ne 'y') { Die "중지했습니다. 아무것도 바꾸지 않았습니다" }
}

# ─────────────────────────────────────────────
Head "DB 백업"

# 업그레이드가 표·정책을 다시 적용하므로, 그 전에 반드시 한 벌 떠 둔다.
Write-Host "    postgres 비밀번호를 입력하세요 (백업과 표 적용에 씁니다. 저장하지 않습니다)" -ForegroundColor Cyan
$pgSecure = Read-Host -AsSecureString "    비밀번호"
$env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
  [Runtime.InteropServices.Marshal]::SecureStringToBSTR($pgSecure))
$env:PGCLIENTENCODING = 'UTF8'
# «이미 있으므로 건너뜁니다» 알림이 수십 줄 쏟아져 오류처럼 보이는 것을 막는다
$env:PGOPTIONS = '-c client_min_messages=warning'

& $Psql -U postgres -h 127.0.0.1 -d postgres -c "select 1" *> $null
if ($LASTEXITCODE -ne 0) { Die "접속하지 못했습니다. postgres 비밀번호를 확인하세요" }

New-Item -ItemType Directory -Force $BackupDir -ErrorAction Stop | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
$dump = Join-Path $BackupDir "eduform_before-update_${stamp}_$oldShort.dump"
& $PgDump -U postgres -h 127.0.0.1 -d postgres -Fc -f $dump
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $dump) -or (Get-Item $dump).Length -eq 0) {
  Die "백업이 실패했습니다. 아무것도 바꾸지 않았습니다"
}
Ok "백업: $dump ($([math]::Round((Get-Item $dump).Length / 1KB)) KB)"
Info "되살리기: pg_restore -U postgres -h 127.0.0.1 -d postgres --clean `"$dump`""

# ─────────────────────────────────────────────
Head "앱 멈춤"

function Stop-App {
  schtasks /end /tn "에듀폼" 2>&1 | Out-Null
  # 작업을 끝내도 cmd 가 띄운 node 는 남을 수 있다 — 포트를 잡은 프로세스를 직접 끈다.
  # 켜져 있으면 윈도우가 .next 폴더 파일을 잠가 빌드가 실패한다.
  $conns = Get-NetTCPConnection -LocalPort $AppPort -State Listen -ErrorAction SilentlyContinue
  foreach ($c in $conns) {
    $p = Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue
    if ($p -and $p.ProcessName -like 'node*') { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }
  }
  Start-Sleep -Seconds 2
}
Stop-App
if (Get-NetTCPConnection -LocalPort $AppPort -State Listen -ErrorAction SilentlyContinue) {
  Warn "$AppPort 번을 아직 무언가 쓰고 있습니다. 빌드가 실패하면 그 프로그램을 닫고 다시 실행하세요"
} else { Ok "멈췄습니다" }

# ─────────────────────────────────────────────
function Install-Packages {
  Push-Location $AppDir
  try { npm ci --no-audit --no-fund 2>&1 | Out-Null; $rc = $LASTEXITCODE } finally { Pop-Location }
  return ($rc -eq 0 -and (Test-Path (Join-Path $AppDir 'node_modules\next')))
}
function Build-App {
  Push-Location $AppDir
  try {
    if (Test-Path '.next') { Remove-Item '.next' -Recurse -Force -ErrorAction SilentlyContinue }
    $out = npm run build 2>&1
    $rc = $LASTEXITCODE
  } finally { Pop-Location }
  $out | Select-String -Pattern 'Compiled successfully|Failed to compile|Type error|Error:' |
    Select-Object -First 8 | ForEach-Object { Info $_.Line.Trim() }
  return ($rc -eq 0 -and (Test-Path (Join-Path $AppDir '.next\BUILD_ID')))
}
function Start-App {
  schtasks /run /tn "에듀폼 API" 2>&1 | Out-Null   # 이미 돌고 있으면 그대로 둔다
  Start-Sleep -Seconds 2
  schtasks /run /tn "에듀폼" 2>&1 | Out-Null
  Start-Sleep -Seconds 8
}

if ($hasNew) {
  Head "소스 받기"
  try { Git merge --ff-only "origin/$Branch" | Out-Null } catch { Start-App; Die "새 판으로 맞추지 못했습니다 — 이전 판으로 다시 켰습니다" }
  Ok "$oldShort → $newShort"
}

# ─────────────────────────────────────────────
if ($LmStudioModel) {
  Head "학교 로컬 모델(큐웬) 설정"
  $lines = @()
  $found = $false
  $base = 'http://127.0.0.1:1234/v1'
  foreach ($l in (Get-Content $EnvLocal -Encoding UTF8 -ErrorAction Stop)) {
    if ($l -match '^\s*LMSTUDIO_MODEL\s*=') { $found = $true; $lines += "LMSTUDIO_MODEL=$LmStudioModel" }
    else {
      if ($l -match '^\s*LMSTUDIO_URL\s*=\s*(\S+)') { $base = $Matches[1].TrimEnd('/') }
      $lines += $l
    }
  }
  if (-not $found) {
    $lines += ''
    $lines += '# 학교 로컬 모델(LM Studio · 큐웬) — 교사 전원이 «맨 먼저» 씁니다. 학생 자료가 밖으로 나가지 않습니다.'
    $lines += "LMSTUDIO_MODEL=$LmStudioModel"
  }
  $lines | Set-Content -Encoding UTF8 $EnvLocal -ErrorAction Stop
  Ok "LMSTUDIO_MODEL=$LmStudioModel"

  try {
    $ids = (Invoke-RestMethod "$base/models" -TimeoutSec 5 -ErrorAction Stop).data.id
    if ($ids -contains $LmStudioModel) { Ok "LM Studio 에 모델이 로드돼 있습니다" }
    else { Warn "LM Studio 는 켜져 있지만 이 모델이 목록에 없습니다: $($ids -join ', ')" }
  } catch {
    Warn "LM Studio 에 연결하지 못했습니다 — 'lms server start' 와 'lms load <모델>' 을 확인하세요"
    Warn "꺼져 있어도 에듀폼은 동작합니다. AI 만 교사 개인 키로 넘어갑니다"
  }
}

# ─────────────────────────────────────────────
if ($lockChanged -or -not (Test-Path (Join-Path $AppDir 'node_modules\next'))) {
  Head "패키지 설치 (몇 분 걸립니다)"
  if (-not (Install-Packages)) {
    Warn "npm ci 가 실패했습니다 — 이전 판으로 되돌립니다"
    if ($hasNew) { Git reset --hard $oldRev | Out-Null; Install-Packages | Out-Null }
    Start-App
    Die "패키지를 받지 못했습니다. 이전 판($oldShort)으로 다시 켰습니다"
  }
  Ok "패키지 준비됨"
}

# ─────────────────────────────────────────────
Head "표·정책 다시 적용"

# 두 파일 모두 «여러 번 실행해도 안전» 하게 쓰여 있다 (if not exists · create or replace).
# authenticator 비밀번호는 다시 정하지 않는다 — postgrest.conf 와 어긋나면 자료가 안 나온다.
$sqlSteps = @(
  @{ n = '로그인용 auth 스키마'; f = Join-Path $AppDir 'supabase\native\auth-schema.sql' }
  @{ n = '표와 보안정책';        f = Join-Path $AppDir 'supabase\schema.sql' }
)
foreach ($s in $sqlSteps) {
  if (-not (Test-Path $s.f)) { Die "파일이 없습니다: $($s.f)" }
  & $Psql -U postgres -h 127.0.0.1 -d postgres -v ON_ERROR_STOP=1 -q -f $s.f
  if ($LASTEXITCODE -ne 0) {
    Start-App
    Die "$($s.n) 에서 멈췄습니다 (위의 ERROR 줄). 앱은 다시 켰습니다. 필요하면 백업으로 되살리세요: $dump"
  }
  Ok $s.n
}
$env:PGPASSWORD = $null

# PostgREST 는 표 구조를 기억해 둔다. 새 열·표가 생겼으면 다시 읽혀야 한다.
if ($sqlChanged) {
  schtasks /end /tn "에듀폼 API" 2>&1 | Out-Null
  Get-Process postgrest -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 1
  Info "데이터 API 를 다시 켭니다 (바뀐 표 구조를 읽도록)"
}

# ─────────────────────────────────────────────
Head "빌드 (몇 분 걸립니다)"

if (Build-App) {
  Ok "빌드 완료"
} else {
  if (-not $hasNew) { Start-App; Die "빌드가 실패했습니다. 위 메시지를 확인하세요" }
  Warn "새 판 빌드가 실패했습니다 — 이전 판($oldShort)으로 되돌려 다시 빌드합니다"
  Git reset --hard $oldRev | Out-Null
  if ($lockChanged) { Install-Packages | Out-Null }
  if (Build-App) {
    Start-App
    Die "새 판($newShort)을 빌드하지 못해 이전 판($oldShort)으로 되돌려 켰습니다. 이 화면을 캡처해 알려 주세요"
  }
  Die "이전 판도 빌드하지 못했습니다. 로그를 확인하세요: $Root\eduform-log.txt"
}

# ─────────────────────────────────────────────
Head "다시 시작과 점검"

Start-App

$fail = 0
function Probe($label, $url, $expect) {
  $code = 0
  try {
    $r = Invoke-WebRequest $url -UseBasicParsing -TimeoutSec 10 -ErrorAction Stop
    $code = [int]$r.StatusCode
  } catch {
    if ($_.Exception.Response) { $code = [int]$_.Exception.Response.StatusCode }
  }
  if ($code -eq $expect) { Ok "$label  HTTP $code" }
  else { Write-Host "    $label  HTTP $code (기대 $expect)" -ForegroundColor Red; $script:fail++ }
}
Probe "데이터 API " "http://127.0.0.1:$ApiPort/profiles" 200
Probe "화면       " "http://127.0.0.1:$AppPort/login"     200
Probe "로그인 서버" "http://127.0.0.1:$AppPort/auth/v1/user" 401

Write-Host ""
$nowRev = (Git rev-parse --short HEAD).Trim()
if ($fail -eq 0) {
  Write-Host "  업그레이드가 끝났습니다. 지금 판: $nowRev" -ForegroundColor Green
  Write-Host "    백업      $dump" -ForegroundColor DarkGray
  Write-Host "    점검      npm run doctor   ($AppDir 에서)" -ForegroundColor DarkGray
  Restore-Console
} else {
  Write-Host "  $fail 곳이 응답하지 않습니다. 잠시 뒤 다시 확인하거나 로그를 보세요:" -ForegroundColor Red
  Write-Host "    $Root\eduform-log.txt , $Root\postgrest-log.txt" -ForegroundColor Gray
  Restore-Console
  exit 1
}
