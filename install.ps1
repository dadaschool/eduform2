<#
=============================================================
  에듀폼 2 — 교내 서버 설치 (윈도우 전용)
=============================================================

  관리자 PowerShell 에서:

    powershell -ExecutionPolicy Bypass -File install.ps1 -ServerIp 10.91.10.127

  옵션
    -ServerIp     (필수) 교사·학생이 접속할 이 컴퓨터의 IP
    -Root         설치 위치 (기본 C:\srv)
    -CheckOnly    아무것도 바꾸지 않고 사양·프로그램만 점검
    -SkipPrereqs  Git · Node · PostgreSQL 설치를 건너뛴다 (이미 있을 때)
    -NoService    작업 스케줄러 등록과 방화벽 규칙을 건너뛴다

  리눅스도 Docker 도 쓰지 않는다. Postgres + PostgREST + Node.js 뿐이고
  전부 무료다. 자세한 배경은 SELFHOST.md.

  ─────────────────────────────────────────────
  이 스크립트가 이미 알고 있는 함정 다섯
  ─────────────────────────────────────────────
   ① winget 이 msstore 인증서 오류로 멈춘다  → --source winget 고정
   ② PostgREST 가 «오류 없이» 종료된다        → PATH 에 PostgreSQL\bin
      (libpq.dll 을 못 찾아 종료코드 -1073741515. 메시지가 없어 찾기 어렵다)
   ③ authenticator 역할이 아직 없다           → auth-schema.sql 을 먼저
   ④ 설정 파일 두 곳의 비밀번호가 어긋난다     → 한 값으로 쓰고 되읽어 대조
   ⑤ 긴 명령이 붙여넣기 중 줄이 끊긴다        → 스크립트로 실행
=============================================================
#>

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$ServerIp,
  [string]$Root = 'C:\srv',
  [string]$PgVersion = '17',
  [string]$RepoUrl = 'https://github.com/dadaschool/eduform2.git',
  [int]$AppPort = 3000,
  [int]$ApiPort = 3001,
  [switch]$CheckOnly,
  [switch]$SkipPrereqs,
  [switch]$NoService
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

# Windows PowerShell 5.1 은 .NET 4.x 기본값을 따라 TLS 1.0/1.1 로 붙으려 한다.
# GitHub 은 TLS 1.2 이상만 받으므로 PostgREST 다운로드가 «연결 실패» 로 끝난다.
try {
  [Net.ServicePointManager]::SecurityProtocol =
    [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
} catch { }

$AppDir     = Join-Path $Root 'eduform2'
$RestDir    = Join-Path $Root 'postgrest'
$PgBin      = "C:\Program Files\PostgreSQL\$PgVersion\bin"
$Psql       = Join-Path $PgBin 'psql.exe'
$step       = 0

function Head($t) { $script:step++; Write-Host ""; Write-Host "[$script:step] $t" -ForegroundColor Cyan }
function Ok($t)   { Write-Host "    $t" -ForegroundColor Green }
function Info($t) { Write-Host "    $t" -ForegroundColor Gray }
function Warn($t) { Write-Host "    $t" -ForegroundColor Yellow }
function Die($t)  { Write-Host ""; Write-Host "  중단: $t" -ForegroundColor Red; exit 1 }

Write-Host ""
Write-Host "  에듀폼 2 — 교내 서버 설치" -ForegroundColor White
Write-Host "  서버 주소 http://$ServerIp`:$AppPort" -ForegroundColor DarkGray

# ─────────────────────────────────────────────
Head "관리자 권한과 사양 확인"

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
  ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { Die "관리자 PowerShell 에서 실행하세요 (시작 단추 오른쪽 클릭 → 터미널(관리자))" }
Ok "관리자 권한 있음"

$os = Get-CimInstance Win32_OperatingSystem
$memGB  = [math]::Round($os.TotalVisibleMemorySize / 1MB, 1)
$diskGB = [math]::Round((Get-PSDrive ($Root[0])).Free / 1GB, 1)
Info "$($os.Caption)   메모리 ${memGB}GB   $($Root[0]) 드라이브 여유 ${diskGB}GB"
if ($memGB -lt 3.5)  { Warn "메모리가 4GB 미만입니다. 느릴 수 있습니다" }
if ($diskGB -lt 5)   { Die  "디스크 여유가 5GB 미만입니다" }

$myIps = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' }).IPAddress
if ($myIps -notcontains $ServerIp) {
  Warn "이 컴퓨터의 IP 목록에 $ServerIp 이 없습니다: $($myIps -join ', ')"
  Warn "주소가 틀리면 다른 기기에서 로그인이 안 됩니다 (브라우저가 이 주소로 직접 붙습니다)"
  if (-not $CheckOnly -and (Read-Host "    그래도 계속할까요? (y/N)") -ne 'y') { Die "중지했습니다" }
} else { Ok "IP 확인: $ServerIp" }

foreach ($p in @($AppPort, $ApiPort, 5432)) {
  $used = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue
  if ($used) {
    $pname = (Get-Process -Id $used[0].OwningProcess -ErrorAction SilentlyContinue).ProcessName
    if ($p -eq 5432 -and $pname -like 'postgres*') { Ok "5432 : PostgreSQL 이 이미 돌고 있습니다" }
    else { Warn "$p 번을 이미 $pname 이 쓰고 있습니다" }
  } else { Info "$p 번 비어 있음" }
}

# ─────────────────────────────────────────────
Head "필수 프로그램"

function Has($cmd) { [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }

$need = @()
if (-not (Has 'git'))  { $need += 'Git.Git' }
if (-not (Has 'node')) { $need += 'OpenJS.NodeJS.LTS' }
$pgHere = Test-Path $Psql
Info "Git $(if (Has 'git') {'있음'} else {'없음'})   Node $(if (Has 'node') {(node -v)} else {'없음'})   PostgreSQL $(if ($pgHere) {'있음'} else {'없음'})   PostgREST $(if (Test-Path (Join-Path $RestDir 'postgrest.exe')) {'있음'} else {'없음'})"

if ($CheckOnly) {
  Write-Host ""
  Write-Host "  점검만 했습니다. 아무것도 바꾸지 않았습니다." -ForegroundColor White
  exit 0
}

if (-not $SkipPrereqs) {
  if (-not (Has 'winget') -and ($need.Count -gt 0 -or -not $pgHere)) {
    Die "winget 이 없습니다. SELFHOST.md 의 «winget 없음» 표를 보고 직접 설치하세요"
  }
  foreach ($id in $need) {
    Info "$id 설치 중..."
    # ① --source winget : msstore 원본은 학교망에서 인증서 오류가 난다
    winget install -e --id $id --source winget --accept-package-agreements --accept-source-agreements | Out-Null
  }
  if (-not $pgHere) {
    Warn "PostgreSQL 설치 창이 뜹니다. 화면에서 정할 것 세 가지:"
    Warn "  · Select Components 에서 Stack Builder 체크 해제"
    Warn "  · Password — 비밀번호를 정하고 «적어 두세요» (곧 다시 물어봅니다)"
    Warn "  · 마지막 화면에서도 Stack Builder 체크 해제"
    winget install -e --id "PostgreSQL.PostgreSQL.$PgVersion" --source winget --interactive `
      --accept-package-agreements --accept-source-agreements | Out-Null
  }
  # 새로 깐 프로그램을 이 창에서도 쓸 수 있게 PATH 를 다시 읽는다
  $env:PATH = [Environment]::GetEnvironmentVariable('PATH','Machine') + ';' +
              [Environment]::GetEnvironmentVariable('PATH','User')
}

if (-not (Test-Path $Psql)) { Die "psql 을 찾을 수 없습니다: $Psql  (-PgVersion 으로 버전을 알려주세요)" }
if (-not (Has 'node'))      { Die "node 를 찾을 수 없습니다. PowerShell 을 새로 열고 다시 실행하세요" }
if (-not (Has 'git'))       { Die "git 을 찾을 수 없습니다. PowerShell 을 새로 열고 다시 실행하세요" }
Ok "필수 프로그램 준비됨"

# ─────────────────────────────────────────────
Head "PostgREST 내려받기"

New-Item -ItemType Directory -Force $RestDir | Out-Null
$restExe = Join-Path $RestDir 'postgrest.exe'
if (Test-Path $restExe) {
  Ok "이미 있습니다: $restExe"
} else {
  $rel = Invoke-RestMethod 'https://api.github.com/repos/PostgREST/postgrest/releases/latest' `
    -Headers @{ 'User-Agent' = 'eduform-install' }
  $asset = $rel.assets | Where-Object { $_.name -like '*windows*' } | Select-Object -First 1
  if (-not $asset) { Die "PostgREST 의 윈도우 파일을 찾지 못했습니다" }
  $zip = Join-Path $RestDir $asset.name
  Info "$($rel.tag_name) — $($asset.name) ($([math]::Round($asset.size/1MB,1)) MB)"
  Invoke-WebRequest $asset.browser_download_url -OutFile $zip -UseBasicParsing
  Expand-Archive -Path $zip -DestinationPath $RestDir -Force
  if (-not (Test-Path $restExe)) { Die "압축을 풀었는데 postgrest.exe 가 없습니다" }
  Ok "받았습니다"
}

# ② PostgREST 는 libpq.dll 을 PostgreSQL\bin 에서 찾는다. 못 찾으면 «아무 메시지도
#    없이» 종료된다 (종료코드 -1073741515). 여기서 미리 확인해 둔다.
$env:PATH = "$PgBin;$env:PATH"
$ver = & $restExe --version 2>&1
if ($LASTEXITCODE -ne 0 -or -not "$ver") {
  Die "postgrest.exe 가 실행되지 않습니다 (종료코드 $LASTEXITCODE). PostgreSQL\bin 경로를 확인하세요: $PgBin"
}
Ok "$ver"

# ─────────────────────────────────────────────
Head "에듀폼 소스 받기"

if (Test-Path (Join-Path $AppDir '.git')) {
  Info "이미 있습니다. 최신으로 맞춥니다"
  git -C $AppDir pull --ff-only 2>&1 | Out-Null
} else {
  New-Item -ItemType Directory -Force $Root | Out-Null
  git clone $RepoUrl $AppDir 2>&1 | Out-Null
}
if (-not (Test-Path (Join-Path $AppDir 'package.json'))) { Die "소스를 받지 못했습니다: $AppDir" }
Ok "소스 준비됨: $AppDir"

Info "패키지 설치 중 (몇 분 걸립니다)..."
Push-Location $AppDir
try { npm ci --no-audit --no-fund 2>&1 | Out-Null } finally { Pop-Location }
if (-not (Test-Path (Join-Path $AppDir 'node_modules'))) { Die "npm ci 가 실패했습니다" }
Ok "패키지 준비됨"

# ─────────────────────────────────────────────
Head "키와 설정 파일 만들기"

# ④ 값을 «한 곳» 에서 만들어 두 파일에 쓰고, 쓴 뒤 되읽어 대조한다.
#    예전에는 생성기가 화면에 찍은 글을 다시 읽어 값을 뽑았고, 그 과정에서
#    postgrest.conf 와 SQL 파일의 비밀번호가 서로 달라졌다. 화면상 문제가
#    없어 보이다가 나중에 자료가 안 나올 때에야 드러난다.

function New-Secret([int]$n) {
  $cs = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  $bytes = New-Object byte[] $n
  (New-Object Security.Cryptography.RNGCryptoServiceProvider).GetBytes($bytes)
  -join ($bytes | ForEach-Object { $cs[$_ % $cs.Length] })
}
function ConvertTo-B64Url([byte[]]$b) {
  [Convert]::ToBase64String($b).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}
function New-Jwt([hashtable]$claims, [string]$secret) {
  $head = ConvertTo-B64Url ([Text.Encoding]::UTF8.GetBytes('{"alg":"HS256","typ":"JWT"}'))
  $body = ConvertTo-B64Url ([Text.Encoding]::UTF8.GetBytes(($claims | ConvertTo-Json -Compress)))
  $mac  = New-Object Security.Cryptography.HMACSHA256 (, [Text.Encoding]::UTF8.GetBytes($secret))
  $sig  = ConvertTo-B64Url ($mac.ComputeHash([Text.Encoding]::UTF8.GetBytes("$head.$body")))
  "$head.$body.$sig"
}

$envLocal = Join-Path $AppDir '.env.local'
$restConf = Join-Path $RestDir 'postgrest.conf'
$authSql  = Join-Path $RestDir 'set-authenticator-password.sql'

if (Test-Path $envLocal) {
  Warn "설정 파일이 이미 있습니다: $envLocal"
  Warn "키를 새로 만들면 «기존 자료에 접속할 수 없습니다»."
  if ((Read-Host "    그래도 새로 만들까요? (y/N)") -ne 'y') {
    Info "기존 설정을 그대로 씁니다"
    $keepExisting = $true
  }
}

if (-not $keepExisting) {
  # Get-Date -UFormat %s 는 지역 설정에 따라 소수점이 «,» 로 나와 Parse 가 깨진다
  $iat = [int]([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())
  $exp = $iat + (10 * 365 * 24 * 60 * 60)
  $jwtSecret = New-Secret 48
  $authPw    = New-Secret 32
  $aiKeySecret = New-Secret 48
  $anonKey    = New-Jwt @{ role = 'anon';         iss = 'supabase'; iat = $iat; exp = $exp } $jwtSecret
  $serviceKey = New-Jwt @{ role = 'service_role'; iss = 'supabase'; iat = $iat; exp = $exp } $jwtSecret

  Write-Host ""
  Write-Host "    PostgreSQL 을 설치할 때 정한 postgres 비밀번호를 입력하세요" -ForegroundColor Cyan
  Write-Host "    (화면에 보이지 않습니다)" -ForegroundColor DarkGray
  $pgSecure = Read-Host -AsSecureString "    비밀번호"
  $pgPw = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($pgSecure))

  @"
NEXT_PUBLIC_SUPABASE_URL=http://${ServerIp}:${AppPort}
NEXT_PUBLIC_SUPABASE_ANON_KEY=$anonKey
SUPABASE_SERVICE_ROLE_KEY=$serviceKey
SUPABASE_JWT_SECRET=$jwtSecret
AUTH_DB_URL=postgresql://postgres:$pgPw@127.0.0.1:5432/postgres
POSTGREST_URL=http://127.0.0.1:$ApiPort

# 교사별 AI API 키를 암호화해 DB 에 넣을 때 쓰는 열쇠입니다. 자동 생성했습니다.
# 이 값을 잃어버리거나 바꾸면 교사들이 이미 등록한 키를 다시 넣어야 합니다.
AI_KEY_SECRET=$aiKeySecret

# AI 기능(평가 항목 추천 · 생활기록부 초안)은 교사가 «내 계정» 화면에서
# 자기 API 키(업스테이지 / Gemini / OpenAI)를 직접 등록해 씁니다.
# 아래 세 칸은 «관리자 계정 전용» 학교 공용 폴백입니다. 비워 두어도 됩니다 —
# 그러면 관리자도 자기 키를 등록해야 합니다. AI 만 바깥 인터넷을 씁니다.
GEMINI_API_KEY=
UPSTAGE_API_KEY=
OPENAI_API_KEY=
"@ | Set-Content -Encoding UTF8 $envLocal

  @"
db-uri = "postgres://authenticator:$authPw@127.0.0.1:5432/postgres"
db-schemas = "public"
db-anon-role = "anon"
db-pool = 10
jwt-secret = "$jwtSecret"
server-host = "127.0.0.1"
server-port = $ApiPort
"@ | Set-Content -Encoding UTF8 $restConf

  "alter role authenticator with password '$authPw';" | Set-Content -Encoding UTF8 $authSql

  # 되읽어 대조 — 이 확인이 없어서 값이 어긋난 적이 있다
  $back1 = (Get-Content $restConf -Raw)
  $back2 = (Get-Content $authSql  -Raw)
  $m1 = [regex]::Match($back1, 'authenticator:([^@]+)@').Groups[1].Value
  $m2 = [regex]::Match($back2, "password '([^']+)'").Groups[1].Value
  if ($m1 -ne $authPw -or $m2 -ne $authPw) { Die "설정 파일에 쓴 비밀번호가 어긋났습니다. 다시 실행하세요" }
  if (-not $back1.Contains($jwtSecret))    { Die "postgrest.conf 의 jwt-secret 이 어긋났습니다" }
  Ok "설정 파일 2개 작성 + 되읽어 대조 통과"
  Info "$envLocal"
  Info "$restConf"
}

# ─────────────────────────────────────────────
Head "데이터베이스 표 만들기"

if (-not $pgPw) {
  Write-Host "    postgres 비밀번호를 입력하세요 (표를 만드는 데 씁니다)" -ForegroundColor Cyan
  $pgSecure = Read-Host -AsSecureString "    비밀번호"
  $pgPw = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($pgSecure))
}
$env:PGPASSWORD = $pgPw
$env:PGCLIENTENCODING = 'UTF8'

& $Psql -U postgres -h 127.0.0.1 -d postgres -c "select 1" *> $null
if ($LASTEXITCODE -ne 0) { $env:PGPASSWORD = $null; Die "접속하지 못했습니다. postgres 비밀번호를 확인하세요" }
Ok "접속 확인"

# ③ 순서가 중요하다. auth-schema.sql 이 authenticator 역할을 «만든다».
#    비밀번호를 거는 것은 그 뒤여야 한다. schema.sql 은 auth.users 를 참조하므로 마지막.
$sqlSteps = @(
  @{ n = '로그인용 auth 스키마';   f = Join-Path $AppDir 'supabase\native\auth-schema.sql' }
  @{ n = 'authenticator 비밀번호'; f = $authSql }
  @{ n = '표와 보안정책';          f = Join-Path $AppDir 'supabase\schema.sql' }
)
foreach ($s in $sqlSteps) {
  if (-not (Test-Path $s.f)) { $env:PGPASSWORD = $null; Die "파일이 없습니다: $($s.f)" }
  # ON_ERROR_STOP=1 — 없으면 오류를 지나쳐 끝까지 실행하고 «성공» 처럼 보인다
  & $Psql -U postgres -h 127.0.0.1 -d postgres -v ON_ERROR_STOP=1 -q -f $s.f
  if ($LASTEXITCODE -ne 0) { $env:PGPASSWORD = $null; Die "$($s.n) 에서 멈췄습니다. 위의 ERROR 줄을 확인하세요" }
  Ok $s.n
}

$tables = (& $Psql -U postgres -h 127.0.0.1 -d postgres -t -A -c `
  "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'")
Info "public 표 $tables 개"

# ─────────────────────────────────────────────
Head "첫 관리자 계정"

$adminEmail = (& $Psql -U postgres -h 127.0.0.1 -d postgres -t -A -c `
  "select email from profiles where is_admin limit 1")
if ($adminEmail) {
  Ok "이미 있습니다: $adminEmail"
} else {
  Write-Host "    관리자로 쓸 이메일과 비밀번호를 정하세요." -ForegroundColor Cyan
  Write-Host "    이 계정은 교사 화면과 관리 화면을 모두 씁니다." -ForegroundColor DarkGray
  $aEmail = Read-Host "    이메일"
  $aName  = Read-Host "    이름"
  $aSec   = Read-Host -AsSecureString "    비밀번호 (6자 이상)"
  $aPw = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($aSec))
  if ($aPw.Length -lt 6) { $env:PGPASSWORD = $null; Die "비밀번호는 6자 이상이어야 합니다" }

  # 비밀번호가 명령 기록에 남지 않도록 임시 파일로 넘긴다
  $tmp = Join-Path $env:TEMP "eduform-admin-$([guid]::NewGuid().ToString('N')).sql"
  @"
select auth.create_user('$($aEmail.Replace("'","''"))', '$($aPw.Replace("'","''"))', true);
insert into profiles (id, email, name, role, is_admin)
select id, email, '$($aName.Replace("'","''"))', 'teacher', true from auth.users
where email = lower(btrim('$($aEmail.Replace("'","''"))'))
on conflict (id) do update set is_admin = true, name = excluded.name;
"@ | Set-Content -Encoding UTF8 $tmp
  & $Psql -U postgres -h 127.0.0.1 -d postgres -v ON_ERROR_STOP=1 -q -f $tmp
  $rc = $LASTEXITCODE
  Remove-Item $tmp -Force -ErrorAction SilentlyContinue
  if ($rc -ne 0) { $env:PGPASSWORD = $null; Die "관리자 계정을 만들지 못했습니다" }
  Ok "관리자 계정을 만들었습니다: $aEmail"
}
$env:PGPASSWORD = $null

# ─────────────────────────────────────────────
Head "빌드"

# NEXT_PUBLIC_ 값은 «빌드할 때» 코드에 박힌다. 설정을 바꾸면 다시 빌드해야 한다.
Push-Location $AppDir
try {
  npm run build 2>&1 | Select-String -Pattern 'Compiled successfully|Failed to compile|error' | ForEach-Object { Info $_.Line.Trim() }
  if (-not (Test-Path (Join-Path $AppDir '.next'))) { throw "빌드 산출물이 없습니다" }
} catch {
  Pop-Location; Die "빌드가 실패했습니다: $_"
}
Pop-Location
Ok "빌드 완료"

# ─────────────────────────────────────────────
Head "실행 스크립트"

$startApi = Join-Path $Root 'postgrest-start.cmd'
$startApp = Join-Path $Root 'eduform-start.cmd'
$backup   = Join-Path $Root 'eduform-backup.cmd'
New-Item -ItemType Directory -Force (Join-Path $Root 'backup') | Out-Null

@"
@echo off
REM PostgreSQL 의 bin 을 PATH 에 넣는 것이 핵심이다. 없으면 PostgREST 가
REM 오류 메시지 하나 없이 그냥 종료된다 (libpq.dll 을 못 찾는다).
set PATH=$PgBin;%PATH%
"$restExe" "$restConf" >> "$Root\postgrest-log.txt" 2>&1
"@ | Set-Content -Encoding OEM $startApi

$nodeExe = (Get-Command node).Source
@"
@echo off
cd /d "$AppDir"
"$nodeExe" node_modules\next\dist\bin\next start -p $AppPort >> "$Root\eduform-log.txt" 2>&1
"@ | Set-Content -Encoding OEM $startApp

@"
@echo off
set D=%date:~0,4%%date:~5,2%%date:~8,2%
set PGPASSWORD=여기에postgres비밀번호
"$PgBin\pg_dump.exe" -U postgres -h 127.0.0.1 -d postgres -Fc -f "$Root\backup\eduform_%D%.dump"
forfiles /p "$Root\backup" /m eduform_*.dump /d -30 /c "cmd /c del @path" 2>nul
"@ | Set-Content -Encoding OEM $backup
Ok "실행·백업 스크립트 작성됨"
Warn "백업 스크립트의 «여기에postgres비밀번호» 를 실제 값으로 바꿔 주세요: $backup"

if (-not $NoService) {
  Head "서비스 등록과 방화벽"

  schtasks /create /tn "에듀폼 API" /tr "`"$startApi`"" /sc onstart /ru SYSTEM /rl HIGHEST /f | Out-Null
  schtasks /create /tn "에듀폼"     /tr "`"$startApp`"" /sc onstart /ru SYSTEM /rl HIGHEST /f | Out-Null
  schtasks /create /tn "에듀폼 백업" /tr "`"$backup`"" /sc daily /st 03:00 /ru SYSTEM /rl HIGHEST /f | Out-Null
  Ok "작업 스케줄러 등록 (부팅 시 자동 시작, 매일 03시 백업)"

  # 교내망만 허용한다. $ApiPort 와 5432 는 열지 않는다 — 127.0.0.1 전용이다.
  $lan = ($ServerIp -split '\.')[0] + '.0.0.0/8'
  Remove-NetFirewallRule -DisplayName "에듀폼 $AppPort" -ErrorAction SilentlyContinue
  New-NetFirewallRule -DisplayName "에듀폼 $AppPort" -Direction Inbound -Protocol TCP `
    -LocalPort $AppPort -Action Allow -RemoteAddress $lan | Out-Null
  Ok "방화벽: $AppPort 번을 $lan 에만 개방"

  schtasks /run /tn "에듀폼 API" | Out-Null
  Start-Sleep -Seconds 3
  schtasks /run /tn "에듀폼"     | Out-Null
  Start-Sleep -Seconds 6
}

# ─────────────────────────────────────────────
Head "점검"

$fail = 0
function Probe($label, $url, $expect) {
  # -SkipHttpErrorCheck 는 PowerShell 7 전용이다. 5.1 에서는 401 이 예외로 튀므로
  # 예외에서 상태 코드를 꺼낸다. 이 방식은 두 버전 모두에서 동작한다.
  $code = 0
  try {
    $r = Invoke-WebRequest $url -UseBasicParsing -TimeoutSec 10
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
if ($fail -eq 0) {
  Write-Host "  설치가 끝났습니다." -ForegroundColor Green
  Write-Host ""
  Write-Host "    접속 주소   http://${ServerIp}:${AppPort}" -ForegroundColor White
  Write-Host "    로그 파일   $Root\eduform-log.txt , $Root\postgrest-log.txt" -ForegroundColor DarkGray
  Write-Host ""
  Write-Host "  다음에 할 일" -ForegroundColor White
  Write-Host "    · 다른 컴퓨터에서 위 주소로 접속해 로그인해 보세요" -ForegroundColor Gray
  Write-Host "    · 백업 스크립트에 postgres 비밀번호를 채우세요" -ForegroundColor Gray
  Write-Host "    · 백업 폴더($Root\backup)를 주 1회 다른 디스크로 복사하세요" -ForegroundColor Gray
} else {
  Write-Host "  $fail 곳이 응답하지 않습니다. 로그를 확인하세요:" -ForegroundColor Red
  Write-Host "    $Root\postgrest-log.txt" -ForegroundColor Gray
  Write-Host "    $Root\eduform-log.txt" -ForegroundColor Gray
  exit 1
}
