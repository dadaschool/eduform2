<#
=============================================================
  에듀폼 — 데이터베이스 표·정책 적용
=============================================================
  powershell -ExecutionPolicy Bypass -File scripts\apply-schema.ps1

  스키마를 바꾼 뒤 이걸 다시 실행한다. 여러 번 실행해도 안전하다.

  옵션
    -Repo   저장소 위치 (기본: 이 스크립트의 두 단계 위)
    -PgBin  psql 위치 (기본 C:\Program Files\PostgreSQL\17\bin)
    -AuthPasswordSql
            authenticator 비밀번호를 정하는 SQL 파일.
            (기본 C:\srv\postgrest\set-authenticator-password.sql)
            없으면 그 단계를 건너뛴다.

  ─────────────────────────────────────────────
  순서가 중요하다
  ─────────────────────────────────────────────
   ① auth-schema.sql — authenticator 역할을 «만든다»
   ② 그 역할의 비밀번호를 정한다 (①이 먼저여야 한다)
   ③ schema.sql — ①의 auth.users 를 참조한다

  긴 명령을 콘솔에 붙여넣으면 줄이 끊긴다. 그래서 스크립트로 둔다.
=============================================================
#>

[CmdletBinding()]
param(
  [string]$Repo = '',
  [string]$PgBin = 'C:\Program Files\PostgreSQL\17\bin',
  [string]$AuthPasswordSql = 'C:\srv\postgrest\set-authenticator-password.sql'
)

$ErrorActionPreference = 'Stop'

# psql 은 UTF-8 로 내보내는데 한국어 윈도우 콘솔은 CP949 로 읽어 글자가 깨진다.
#
#  · [Console]::OutputEncoding 은 «PowerShell 이 받아 담을 때» 만 듣는다
#  · psql 이 콘솔에 «직접» 쓰는 줄(알림·오류)은 콘솔 코드페이지가 결정한다
#
# 그래서 둘을 다 맞춘다. 코드페이지는 끝에 되돌린다.
$oldCodePage = $null
try {
  [Console]::OutputEncoding = [Text.Encoding]::UTF8
  $OutputEncoding = [Text.Encoding]::UTF8
  $oldCodePage = (chcp) -replace '[^0-9]', ''
  chcp 65001 > $null
} catch { }

# «이미 있으므로 건너뜁니다» 류의 알림을 아예 끈다.
# 여러 번 실행하는 스크립트라 알림이 수십 줄 쏟아지고, 그걸 보고 오류라고
# 놀라게 된다. 경고와 오류는 그대로 나온다.
$env:PGOPTIONS = '-c client_min_messages=warning'

if (-not $Repo) { $Repo = Split-Path -Parent (Split-Path -Parent $PSCommandPath) }
$psql = Join-Path $PgBin 'psql.exe'

if (-not (Test-Path $psql)) {
  Write-Host "psql 을 찾을 수 없습니다: $psql" -ForegroundColor Red
  Write-Host "-PgBin 으로 경로를 알려주세요." -ForegroundColor Yellow
  exit 1
}

# PostgreSQL 이 꺼져 있으면 psql 원문 오류만 잔뜩 나온다. 먼저 확인한다.
$pgReady = Join-Path $PgBin 'pg_isready.exe'
if (Test-Path $pgReady) {
  & $pgReady -h 127.0.0.1 -p 5432 *> $null
  if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "  PostgreSQL 이 응답하지 않습니다 (127.0.0.1:5432)" -ForegroundColor Red
    $svc = Get-Service -Name 'postgresql*' -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($svc) {
      Write-Host "  서비스 '$($svc.Name)' 상태: $($svc.Status)" -ForegroundColor Yellow
      Write-Host "  켜고 다시 실행하세요:  Start-Service $($svc.Name)" -ForegroundColor Cyan
    }
    exit 1
  }
}

# 실행할 파일 — 위 [순서가 중요하다] 참고
$steps = @()
$authSchema = Join-Path $Repo 'supabase\native\auth-schema.sql'
if (Test-Path $authSchema) {
  $steps += @{ name = '로그인용 auth 스키마'; file = $authSchema }
  if (Test-Path $AuthPasswordSql) {
    $steps += @{ name = 'authenticator 비밀번호'; file = $AuthPasswordSql }
  }
}
$steps += @{ name = '표와 보안정책'; file = Join-Path $Repo 'supabase\schema.sql' }

foreach ($s in $steps) {
  if (-not (Test-Path $s.file)) {
    Write-Host "파일이 없습니다: $($s.file)" -ForegroundColor Red; exit 1
  }
}

Write-Host ""
Write-Host "  적용 대상: $Repo" -ForegroundColor DarkGray
Write-Host "  postgres 비밀번호를 입력하세요 (화면에 보이지 않습니다)" -ForegroundColor Cyan
$sec = Read-Host -AsSecureString "  비밀번호"
$env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
  [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
$env:PGCLIENTENCODING = 'UTF8'

try {
  $ErrorActionPreference = 'Continue'
  & $psql -U postgres -h 127.0.0.1 -d postgres -c "select 1" 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) {
    Write-Host "  접속 실패 — postgres 비밀번호를 확인하세요" -ForegroundColor Red; exit 1
  }
  Write-Host "  접속 확인" -ForegroundColor Green
  Write-Host ""

  $i = 0
  foreach ($s in $steps) {
    $i++
    Write-Host "$i/$($steps.Count)  $($s.name)" -ForegroundColor Cyan
    # ON_ERROR_STOP=1 — 없으면 오류를 지나쳐 끝까지 실행하고 «성공» 처럼 보인다.
    # 실제로 클라우드에서 그렇게 아무것도 안 들어간 채 넘어간 적이 있다.
    & $psql -U postgres -h 127.0.0.1 -d postgres -v ON_ERROR_STOP=1 -q -f $s.file
    if ($LASTEXITCODE -ne 0) {
      Write-Host ""
      Write-Host "  여기서 멈췄습니다: $($s.name)" -ForegroundColor Red
      Write-Host "  위의 ERROR 줄을 그대로 알려주세요." -ForegroundColor Yellow
      Write-Host "  (알림/NOTICE 은 오류가 아닙니다 — «이미 있으므로 건너뜁니다» 라는 뜻입니다)" -ForegroundColor DarkGray
      exit 1
    }
    Write-Host "     완료" -ForegroundColor Green
  }

  # 확인 질의는 «영문만» 쓴다. -c 에 한글을 넣으면 PowerShell 이 콘솔
  # 코드페이지로 인코딩해 보내서 psql 이 «잘못된 UTF-8 바이트» 로 거부한다.
  Write-Host ""
  Write-Host "  들어간 것" -ForegroundColor White
  $q = @(
    @{ label = '표';        sql = "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'" }
    @{ label = '함수';      sql = "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'" }
    @{ label = '보안정책';   sql = "select count(*) from pg_policies where schemaname='public'" }
    @{ label = 'auth 표';   sql = "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='auth' and c.relkind='r'" }
    @{ label = '관리자';     sql = "select count(*) from profiles where is_admin" }
  )
  foreach ($x in $q) {
    $v = (& $psql -U postgres -h 127.0.0.1 -d postgres -t -A -c $x.sql 2>&1) -join ' '
    Write-Host ("    {0,-10} {1}" -f $x.label, $v) -ForegroundColor Gray
  }

  Write-Host ""
  Write-Host "  적용이 끝났습니다." -ForegroundColor Green
  Write-Host "  화면 쪽 설정(NEXT_PUBLIC_*)을 바꿨다면 npm run build 를 다시 하세요." -ForegroundColor DarkGray
}
finally {
  $env:PGPASSWORD = $null
  $env:PGOPTIONS = $null
  if ($oldCodePage) { chcp $oldCodePage > $null }
}
