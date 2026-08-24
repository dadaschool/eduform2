# 에듀폼 교내 서버 설치 안내서 (윈도우 전용)

학교 안 컴퓨터 한 대에서만 돌립니다. **리눅스도, Docker 도, WSL 도 쓰지 않습니다.**
전부 윈도우 프로그램이고 전부 무료입니다. 학생 자료가 학교 밖으로 나가지 않습니다.

클라우드(Vercel + Supabase)로 쓰실 거면 이 문서가 아니라 [SETUP.md](SETUP.md) 를 보세요.

> 예상 소요: 처음이면 1~2시간.

---

## 무엇을 설치하는가

| 부품 | 무엇 | 윈도우 | 값 |
|---|---|---|---|
| Postgres | 데이터베이스 | 공식 설치본 | 무료 |
| PostgREST | 데이터 API | 공식 exe | 무료 (MIT) |
| Node.js + 에듀폼 | 화면 · 로그인 | 그대로 | 무료 |

**로그인 서버는 따로 설치하지 않습니다.** Supabase 의 로그인 서버(GoTrue)는 윈도우 빌드를
배포하지 않아서, 에듀폼이 `/auth/v1/*` 를 직접 처리하도록 만들어 두었습니다. 실시간 알림
서버(Realtime)도 같은 이유로 쓰지 않고, 쪽지는 15초마다 확인합니다.

```
교사·학생 브라우저
        │
        └──→ :3000  에듀폼 (Node.js, 윈도우 서비스)
                ├ 화면
                ├ /auth/v1/*  로그인 (앱이 직접)
                └ /rest/v1/*  →  127.0.0.1:3001  PostgREST
                                        └→ 127.0.0.1:5432  Postgres
```

**교내망에 여는 포트는 3000 하나입니다.** Postgres 와 PostgREST 는 `127.0.0.1` 에만 붙어서
그 컴퓨터 밖에서는 아예 보이지 않습니다. 이미 4000번을 쓰는 프로그램(AI 코디네이터)이
있어도 겹치지 않습니다.

---

## 0단계 — 서버 컴퓨터 확인

**PowerShell 은 따로 설치할 필요가 없습니다.** 윈도우 7 이후 모든 윈도우에 들어 있습니다
(Windows Server 도 포함). 여는 방법은 셋 중 아무거나:

- 시작 단추를 **오른쪽 클릭** → `Windows PowerShell` 또는 `터미널`
- `Win` + `R` → `powershell` 입력 → 엔터
- 시작 메뉴에서 `powershell` 검색

관리자로 열어야 하는 단계(1·8·9)에서는 **오른쪽 클릭 → 관리자 권한으로 실행**을 하세요.

열렸으면 확인:

```powershell
$PSVersionTable.PSVersion
if (Get-Command winget -ErrorAction SilentlyContinue) { 'winget 있음' } else { 'winget 없음 — 1단계 대비책을 보세요' }
```

`5.1` 이상이면 이 안내서의 모든 명령이 됩니다 (5.1 에서 실제로 확인했습니다).
PowerShell 7 을 따로 깔 필요는 없습니다.

그다음 사양을 봅니다. 그대로 붙여넣으세요.

```powershell
$w = Get-CimInstance Win32_OperatingSystem
[pscustomobject]@{
  OS              = $w.Caption
  메모리GB        = [math]::Round($w.TotalVisibleMemorySize/1MB, 1)
  여유메모리GB    = [math]::Round($w.FreePhysicalMemory/1MB, 1)
  C드라이브여유GB = [math]::Round((Get-PSDrive C).Free/1GB, 1)
  IP              = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' }).IPAddress -join ', '
  Node            = (node -v 2>$null)
} | Format-List
'--- 사용 중인 포트 ---'
Get-NetTCPConnection -State Listen | Select-Object -Expand LocalPort -Unique | Sort-Object
```

필요 조건이 Docker 방식보다 훨씬 가볍습니다.

| 항목 | 최소 |
|---|---|
| 메모리 | 4GB (Postgres 는 수십 MB, PostgREST 는 더 작습니다) |
| C 드라이브 여유 | 5GB + 자료 |
| OS | Windows 10/11 또는 Windows Server (**둘 다 됩니다**) |
| 권한 | 관리자 계정 (설치와 방화벽 규칙) |
| 포트 | 3000 · 3001 · 5432 가 비어 있어야 함 |

가상화나 WSL 은 필요 없습니다. **Windows Server 도 그대로 됩니다.**

---

## 1단계 — 프로그램 설치

관리자 PowerShell 에서:

```powershell
winget install -e --id Git.Git
winget install -e --id OpenJS.NodeJS.LTS
winget install -e --id PostgreSQL.PostgreSQL.17
```

> **`winget 없음` 이 나왔다면** — 윈도우 11 에는 있고, 윈도우 10 은 스토어에서 `앱 설치 관리자`
> (App Installer) 를 받으면 생깁니다. **Windows Server 에는 없는 경우가 많습니다.**
> 그럴 때는 브라우저로 직접 받아 설치하세요. 결과는 같습니다.
>
> | | 주소 | 받을 것 |
> |---|---|---|
> | Git | <https://git-scm.com/download/win> | 64-bit 설치본 |
> | Node.js | <https://nodejs.org> | **LTS** `.msi` |
> | PostgreSQL | <https://www.postgresql.org/download/windows/> | 17 버전 설치본 |

Postgres 설치 중 **슈퍼유저 비밀번호**를 묻습니다. 아무 값이나 정하고 적어 두세요 (3단계에서
바꿉니다). 포트는 5432 그대로 둡니다.

PostgREST 는 winget 에 없어서 직접 내려받습니다. 브라우저로
<https://github.com/PostgREST/postgrest/releases/latest> 를 열고
**`postgrest-vXX-windows-x86-64.zip`** (약 15MB) 을 받아 `C:\srv\postgrest\` 에 풀어
`postgrest.exe` 가 그 안에 있게 합니다.

새 창을 열고 확인합니다.

```powershell
node -v ; git --version ; & "C:\Program Files\PostgreSQL\17\bin\psql.exe" --version ; & "C:\srv\postgrest\postgrest.exe" --version
```

---

## 2단계 — 에듀폼 내려받기

```powershell
New-Item -ItemType Directory -Force C:\srv | Out-Null
cd C:\srv
git clone https://github.com/dadaschool/eduform.git
cd eduform
npm ci
```

`npm ci` 때만 인터넷이 필요합니다. 그 뒤로는 빌드도 실행도 인터넷 없이 됩니다.

---

## 3단계 — 키와 비밀번호 만들기

**서버 IP 를 넣어서** 실행합니다.

```powershell
cd C:\srv\eduform
$env:EDUFORM_HOST = "10.91.10.127"
npm run selfhost:keys
```

출력이 세 덩이로 나옵니다. **창을 닫기 전에 안전한 곳(비밀번호 관리자 등)에 옮겨 두세요.**
다시 만들면 기존 자료에 접속할 수 없습니다.

서명 로직만 확인하려면 `node scripts\selfhost-keys.mjs --selftest` (16개 검사).

---

## 4단계 — 데이터베이스 만들기

`psql` 을 엽니다. 1단계에서 정한 비밀번호를 묻습니다.

```powershell
& "C:\Program Files\PostgreSQL\17\bin\psql.exe" -U postgres
```

3단계 출력 **첫 덩이**(`alter user ...` 두 줄)를 붙여넣고, 이어서 표를 만듭니다.
`\q` 로 나온 뒤:

```powershell
$psql = "C:\Program Files\PostgreSQL\17\bin\psql.exe"
$env:PGPASSWORD = "3단계에서 정한 postgres 비밀번호"
& $psql -U postgres -h 127.0.0.1 -f C:\srv\eduform\supabase\native\auth-schema.sql
& $psql -U postgres -h 127.0.0.1 -f C:\srv\eduform\supabase\schema.sql
```

**순서가 중요합니다.** `schema.sql` 이 `auth.users` 를 참조하므로 `auth-schema.sql` 이 먼저여야
합니다. 두 파일 모두 여러 번 실행해도 안전합니다.

한글이 깨지면 `psql` 을 부르기 전에 `$env:PGCLIENTENCODING = "UTF8"` 을 한 줄 넣으세요.

---

## 5단계 — 설정 파일 두 개

```powershell
cd C:\srv\eduform
Copy-Item .env.example .env.local
notepad .env.local
```

3단계 출력 **둘째 덩이**를 반영합니다. AI 기능(평가 항목 추천·생활기록부 초안)을 쓰려면
`GEMINI_API_KEY` 도 채웁니다. **AI 만 바깥 인터넷을 씁니다** — 막혀 있으면 그 두 기능만
안 되고 나머지는 정상입니다.

이어서 PostgREST 설정. 3단계 출력 **셋째 덩이**를 그대로 넣습니다.

```powershell
notepad C:\srv\postgrest\postgrest.conf
```

> `jwt-secret` 과 `.env.local` 의 `SUPABASE_JWT_SECRET` 이 **같은 값**이어야 합니다.
> 어긋나면 화면은 뜨는데 모든 자료 요청이 401 로 떨어집니다.

---

## 6단계 — 띄워 보기

창 두 개를 엽니다.

```powershell
& "C:\srv\postgrest\postgrest.exe" C:\srv\postgrest\postgrest.conf
```

```powershell
cd C:\srv\eduform ; npm run build ; npm run start
```

`http://10.91.10.127:3000` 을 엽니다.

> `NEXT_PUBLIC_` 로 시작하는 값은 **빌드할 때 코드에 박힙니다.** 서버 IP 나 키를 바꾸면
> `npm run build` 를 다시 해야 합니다. `.env.local` 만 고치고 재시작해도 반영되지 않습니다.

점검 명령:

```powershell
npm run doctor
```

---

## 7단계 — 첫 관리자 계정

관리 화면(Studio)이 없으므로 psql 로 만듭니다. **비밀번호는 아래 `여기에비밀번호` 를 바꿔서**
넣으세요.

```powershell
& $psql -U postgres -h 127.0.0.1 -c "select auth.create_user('dadat@geoje-m.gne.go.kr', '여기에비밀번호', true);"
& $psql -U postgres -h 127.0.0.1 -c "insert into profiles (id, email, name, role) select id, email, '관리자', 'admin' from auth.users where email = 'dadat@geoje-m.gne.go.kr' on conflict (id) do update set role = 'admin';"
```

이 계정으로 로그인하면 반과 교사·학생을 등록할 수 있습니다. **나머지 계정은 전부 관리자
화면에서 엑셀로 넣습니다.** psql 을 다시 열 필요가 없습니다.

> 비밀번호가 명령 기록에 남습니다. 로그인 뒤 화면에서 바꾸시거나, PowerShell 기록
> (`(Get-PSReadlineOption).HistorySavePath` 파일)에서 그 줄을 지우세요.

---

## 8단계 — 방화벽

교내망에서만 접속되도록 대역을 제한합니다. 관리자 PowerShell:

```powershell
New-NetFirewallRule -DisplayName "에듀폼 3000" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow -RemoteAddress 10.0.0.0/8
```

학교 대역이 `10.x` 가 아니면 `-RemoteAddress` 를 실제 대역으로 바꾸세요. **3001 과 5432 는
열지 않습니다.** 그 컴퓨터 안에서만 쓰는 포트입니다.

다른 컴퓨터에서 확인:

```powershell
Test-NetConnection 10.91.10.127 -Port 3000
```

---

## 9단계 — 재부팅 후에도 켜지게

Postgres 는 설치할 때 이미 윈도우 서비스로 등록됩니다. 나머지 둘을 등록합니다.

```powershell
@"
@echo off
cd /d C:\srv\eduform
"C:\Program Files\nodejs\node.exe" node_modules\next\dist\bin\next start -p 3000 >> C:\srv\eduform-log.txt 2>&1
"@ | Set-Content -Encoding OEM C:\srv\eduform-start.cmd

@"
@echo off
"C:\srv\postgrest\postgrest.exe" "C:\srv\postgrest\postgrest.conf" >> C:\srv\postgrest-log.txt 2>&1
"@ | Set-Content -Encoding OEM C:\srv\postgrest-start.cmd

schtasks /create /tn "에듀폼 API" /tr "C:\srv\postgrest-start.cmd" /sc onstart /ru SYSTEM /rl HIGHEST /f
schtasks /create /tn "에듀폼" /tr "C:\srv\eduform-start.cmd" /sc onstart /ru SYSTEM /rl HIGHEST /f
schtasks /run /tn "에듀폼 API"
schtasks /run /tn "에듀폼"
```

**로그인 없이 시작됩니다.** 정전 뒤 컴퓨터만 켜져도 서비스가 올라옵니다 — Docker 방식에는
없는 장점입니다.

멈추거나 다시 시작할 때:

```powershell
schtasks /end /tn "에듀폼" ; schtasks /run /tn "에듀폼"
```

---

## 10단계 — 백업

**이제 학생 기록이 이 컴퓨터 한 대에만 있습니다.** 디스크가 죽으면 끝입니다.

```powershell
New-Item -ItemType Directory -Force C:\srv\backup | Out-Null

@"
@echo off
set D=%date:~0,4%%date:~5,2%%date:~8,2%
set PGPASSWORD=여기에postgres비밀번호
"C:\Program Files\PostgreSQL\17\bin\pg_dump.exe" -U postgres -h 127.0.0.1 -d postgres -Fc -f C:\srv\backup\eduform_%D%.dump
forfiles /p C:\srv\backup /m eduform_*.dump /d -30 /c "cmd /c del @path" 2>nul
"@ | Set-Content -Encoding OEM C:\srv\eduform-backup.cmd

schtasks /create /tn "에듀폼 백업" /tr "C:\srv\eduform-backup.cmd" /sc daily /st 03:00 /ru SYSTEM /rl HIGHEST /f
schtasks /run /tn "에듀폼 백업"
```

`pg_dump` 는 `auth` 스키마까지 함께 담습니다 — 계정과 비밀번호도 백업됩니다.

**손으로 한 번 돌려 파일이 생기는지 확인하고, `C:\srv\backup` 을 학교 공용 폴더나 외부
디스크로 주 1회 복사**하세요. 같은 디스크에 둔 백업은 디스크가 죽을 때 같이 죽습니다.

되돌리기:

```powershell
& "C:\Program Files\PostgreSQL\17\bin\pg_restore.exe" -U postgres -h 127.0.0.1 -d postgres --clean --if-exists C:\srv\backup\eduform_20260824.dump
```

---

## 알아둘 것

- **비밀번호 찾기 메일이 없습니다.** 교내망에 메일 서버가 없어 만들지 않았습니다. 선생님이
  비밀번호를 잊으면 **관리자가 사용자 관리에서 같은 이메일로 다시 등록**하면 됩니다.
  비밀번호만 갱신되고 계정은 그대로입니다.
- **쪽지 알림이 즉시가 아니라 15초 간격입니다.** 실시간 서버에 윈도우 빌드가 없습니다.
- **HTTP 입니다.** 같은 망에 있는 사람이 통신을 들여다보면 비밀번호가 보입니다. 신경 쓰이면
  인증서를 넣으세요. 학교 밖에서는 접속되지 않습니다 (사설 IP).
- **AI 기능만 바깥 인터넷을 씁니다.** 막혀 있으면 그 두 기능만 안 됩니다.
- **정전.** 상시 서버라면 UPS 를 두는 편이 좋습니다.

---

## 막혔을 때

**화면은 뜨는데 자료가 하나도 안 나온다 / 401 이 뜬다**
`postgrest.conf` 의 `jwt-secret` 과 `.env.local` 의 `SUPABASE_JWT_SECRET` 이 다릅니다.
같게 맞추고 PostgREST 를 다시 시작하세요.

**로그인 창에서 «이메일 또는 비밀번호가 올바르지 않습니다» 만 나온다**
계정이 없을 가능성이 큽니다. 7단계로 관리자를 만들었는지 확인하세요.

```powershell
& $psql -U postgres -h 127.0.0.1 -c "select email, role from profiles;"
```

**로그인은 되는데 화면이 비어 있다**
`POSTGREST_URL` 이 없거나 PostgREST 가 안 떠 있습니다. 확인:

```powershell
Invoke-WebRequest http://127.0.0.1:3001/profiles -UseBasicParsing | Select-Object StatusCode
```

401 이 나오면 정상입니다 (열려는 있고 권한이 없다는 뜻). 연결 자체가 안 되면 PostgREST 가
꺼져 있습니다. `C:\srv\postgrest-log.txt` 를 보세요.

**다른 컴퓨터에서 로그인이 안 된다**
`.env.local` 의 `NEXT_PUBLIC_SUPABASE_URL` 이 `localhost` 로 되어 있을 가능성이 높습니다.
서버 IP 로 고치고 `npm run build` 를 다시 하세요.

**표가 없다고 나온다**

```powershell
& $psql -U postgres -h 127.0.0.1 -c "\dt"
& $psql -U postgres -h 127.0.0.1 -c "\dt auth.*"
```

4단계를 순서대로(auth-schema.sql 먼저) 다시 실행하세요.
