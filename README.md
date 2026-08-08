# 에듀폼2 (EduForm 2)

초·중등 교사용 학생 평가·기록 관리 웹앱. 평가 루브릭, 과제, 관찰기록, 디지털 배지, 쪽지를
한곳에서 관리하고, 쌓인 자료로 **생활기록부 세특 초안을 AI가 작성**합니다.

> **에듀폼2 는 학교 내부 서버 운영을 기준으로 갈라져 나온 판입니다.**
> 학생 정보를 학교 밖에 두지 않으려는 경우를 위해 Supabase 를 직접 띄웁니다.
> 구축 절차는 [SELFHOST.md](SELFHOST.md) 를 보세요.
> 클라우드(Supabase 호스팅)로 쓰는 1 판은 별도 저장소에서 그대로 운영됩니다.

`Next.js 14` · `Supabase` · `Tailwind 4 / shadcn` · `Gemini / 업스테이지 Solar`

---

## 기능

**교사**

| 기능 | 내용 |
|---|---|
| 반 관리 | 반 생성, 초대코드 발급 (사용횟수·만료일 제한) |
| 학생 관리 | 계정 직접 생성, 비밀번호 초기화, **엑셀 명단 업로드** |
| 평가 | 평가지 설계, 항목별 6종 체크방식, 반별 배포, 학생별 일괄 체크 |
| 과제 | 출제(마감일), 제출물 확인, 개별 피드백 |
| 배지 | 디지털 배지 정의 및 수여 |
| 관찰기록 | 학생별 수시 관찰 누적 |
| 생활기록부 | **평가·과제·관찰을 종합해 AI가 세특 초안 생성** |
| 쪽지 | 학생과 1:1 대화 |

체크방식 6종: `O/X` · `상/중/하` · `완료/보류/미제출` · `숫자` · `1~5점` · `텍스트`

**학생** — 대시보드, 과제 제출, 내 배지, 쪽지(실시간 알림), 프로필

---

## 내 계정에 설치하기

두 가지 길이 있습니다. **터미널을 안 쓰셔도 됩니다.**

| | 경로 A — 클릭만 | 경로 B — 로컬 개발까지 |
|---|---|---|
| 필요한 것 | 웹브라우저 | 브라우저 + Node.js 20+ |
| 걸리는 시간 | 약 10분 | 약 20분 |
| 코드 수정 | 못 함 | 가능 |

---

## 경로 A — 클릭만으로 설치

### A-1. 내 저장소로 복사

이 저장소 오른쪽 위 **`Use this template`** → **`Create a new repository`**
(버튼이 없으면 **Fork**)

### A-2. Supabase 프로젝트 만들기

1. https://supabase.com/dashboard → **New project**
2. **Region** 은 `Northeast Asia (Seoul)` (한국에서 가장 빠릅니다)
3. 생성까지 2~3분

> ⚠️ 무료 등급은 **약 1주간 요청이 없으면 자동 일시정지**됩니다. 그러면 접속이 안 되고,
> 대시보드에서 `Resume project` 를 눌러야 살아납니다. 데이터는 보존됩니다.

### A-3. 데이터베이스 만들기 ← 배포보다 먼저 해야 합니다

1. Supabase → 왼쪽 **SQL Editor** → **New query**
2. [`supabase/schema.sql`](supabase/schema.sql) **전체**를 붙여넣고 **Run**
   → `Success. No rows returned` 이면 성공
3. 눌러볼 시범 데이터를 원하면 [`supabase/seed.sql`](supabase/seed.sql) 로 한 번 더

두 파일 모두 **여러 번 실행해도 안전합니다.** 정책·트리거만 교체하고 데이터는 지우지 않습니다.

### A-4. 이메일 확인 끄기

학생이 초대코드로 가입할 때 이메일 인증을 요구하면 학교 환경에서 막힙니다.

**Authentication → Sign In / Providers → Email** → **Confirm email** 끄기

### A-5. 키 3개 복사

**Project Settings → API**

| 화면의 이름 | 환경변수 |
|---|---|
| Project URL | `NEXT_PUBLIC_SUPABASE_URL` |
| `anon` / `publishable` | `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| `service_role` / `secret` | `SUPABASE_SERVICE_ROLE_KEY` |

> `service_role` 은 보안 규칙(RLS)을 무시하는 관리자 키입니다. 서버에서만 쓰이고
> 브라우저로 나가지 않습니다. **깃·채팅·문서에 붙여넣지 마세요.**

### A-6. 배포

> **배포 버튼은 아직 없습니다.** 에듀폼2 저장소를 GitHub 에 만든 뒤,
> 아래 URL 의 `사용자명/저장소명` 을 바꿔 넣으면 버튼이 동작합니다.
>
> ```
> https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2F사용자명%2F저장소명&env=NEXT_PUBLIC_SUPABASE_URL%2CNEXT_PUBLIC_SUPABASE_ANON_KEY%2CSUPABASE_SERVICE_ROLE_KEY
> ```
>
> 내부 서버로 운영할 계획이면 이 경로 대신 [SELFHOST.md](SELFHOST.md) 를 따르세요.

https://vercel.com/new 에서 내 저장소를 선택하고 **A-5 의 키 3개**를 입력해도 됩니다.

배포가 끝나면 확인할 것 두 가지:

- **Framework Preset 이 `Next.js` 인지** — `Other` 면 빌드는 성공하는데 **모든 주소가 404** 가 됩니다.
  Settings → Build and Deployment 에서 확인하고, 고쳤으면 **꼭 Redeploy** 하세요.
- **접속했을 때 `Login – Vercel` 이 나오면** — Settings → Deployment Protection →
  **Vercel Authentication** 을 끄세요. 켜져 있으면 교사·학생이 로그인 화면에조차 못 갑니다.

### A-7. AI 기능 켜기 (선택)

AI 초안 생성을 쓰려면 키를 하나 더 넣습니다. **둘 중 하나만 있어도 됩니다.**

| 변수 | 발급처 |
|---|---|
| `UPSTAGE_API_KEY` | https://console.upstage.ai |
| `GEMINI_API_KEY` | https://aistudio.google.com/app/apikey |

Vercel → **Settings → Environment Variables** 에 추가한 뒤
**Deployments → `⋯` → Redeploy** 하세요. 환경변수는 새 배포에만 반영됩니다.

Gemini 를 먼저 쓰고 실패하면 업스테이지로 자동 전환됩니다. Gemini 가 막혀 있다면
`AI_PRIMARY` 를 `upstage` 로 넣어 헛된 호출을 건너뛰게 하세요.

**여기까지 하면 끝입니다.** 아래 [교사 계정 만들기](#교사-계정-만들기)로 넘어가세요.

---

## 경로 B — 로컬에서 개발까지

경로 A 의 **A-1 ~ A-5** 를 먼저 하고 (A-3 은 아래 방법으로 대신할 수 있습니다), 이어서:

### B-1. 키 채우기

```bash
cp .env.example .env.local
npm install
```

`.env.local` 을 열어 값을 넣습니다.

| 변수 | 필수 |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ |
| `UPSTAGE_API_KEY` 또는 `GEMINI_API_KEY` | AI 기능용 |
| `SUPABASE_DB_URL` | 아래 B-2 자동설치용 |

### B-2. 데이터베이스 자동 구축

`.env.local` 에 `SUPABASE_DB_URL` 을 넣으면 명령 하나로 끝납니다.

```bash
npm run db:seed      # 스키마 + 시범 데이터
npm run db:setup     # 스키마만 (빈 상태로 시작)
```

연결 문자열은 Supabase → **Project Settings → Database → Connection string → URI**
에서 복사하고, `[YOUR-PASSWORD]` 를 실제 DB 비밀번호로 바꿉니다.
모르면 같은 화면의 **Reset database password** 로 새로 정할 수 있습니다.

이 값이 없으면 명령이 실행 대신 **대시보드에 붙여넣는 방법을 안내**합니다.
즉 A-3 을 이미 했다면 이 단계는 건너뛰어도 됩니다.

### B-3. 점검

```bash
npm run doctor
```

환경변수 · Supabase 연결 · 테이블 15개 · 함수 6개 · 보안정책 · 계정 · AI 키를
차례로 확인하고, 빠진 것과 해야 할 일을 알려줍니다. 비밀값은 출력하지 않습니다.

### B-4. 실행

```bash
npm run dev
```

http://localhost:3000 → 교사 로그인 화면

시범 데이터를 넣었다면 `teacher@eduform.test` / `edu1234` 로 바로 들어갈 수 있습니다.
학생은 `s01@eduform.test` ~ `s08@eduform.test`, 비밀번호는 같습니다.

> ⚠️ 시범 계정은 비밀번호가 전부 같습니다. **실제 학생을 받기 전에 지우세요.**
> `supabase/seed.sql` 맨 아래 주석 처리된 `delete` 블록을 실행하면 샘플만 삭제됩니다.

### B-5. 배포

https://vercel.com/new → 내 저장소 선택 → 환경변수 입력 → Deploy.
`SUPABASE_DB_URL` 은 넣지 않아도 됩니다 (로컬 설치용).
배포 후 확인할 것은 **A-6 의 두 가지**와 같습니다.
## 교사 계정 만들기

앱에 교사 회원가입 화면은 없습니다 (`/register` 는 학생 전용). 직접 만듭니다.

1. Supabase → **Authentication → Users → Add user → Create new user**
   - Email / Password 입력, **Auto Confirm User 체크**
   - 생성된 **UID 복사**
2. **SQL Editor** 에서 실행 (3곳을 본인 값으로 교체)

```sql
insert into profiles (id, email, name, role)
values ('복사한-UID', '이메일@example.com', '홍길동', 'teacher');
```

3. `/login` 에서 로그인 → `/teacher/dashboard`

학생은 교사가 **학생 관리**에서 만들거나, 학생이 **초대코드로 가입**하면 됩니다.

---

## 명령어

| 명령 | 하는 일 |
|---|---|
| `npm run dev` | 개발 서버 |
| `npm run build` | 프로덕션 빌드 |
| `npm run doctor` | 설치 상태 전체 점검 |
| `npm run db:setup` | DB 스키마 적용 |
| `npm run db:seed` | DB 스키마 + 시범 데이터 |
| `npm run lint` | 코드 검사 |

---

## 구조

```
src/
  app/
    (auth)/       로그인 · 학생로그인 · 초대코드 가입
    (teacher)/    교사 화면 16개
    (student)/    학생 화면 6개
    api/
      gemini/     AI 평가항목 추천 · 세특 초안 생성
      teacher/    학생 계정 생성 · 비밀번호 초기화 (service_role 사용)
  lib/
    ai.ts         Gemini → 업스테이지 폴백
    supabase/     브라우저 · 서버 · 미들웨어 클라이언트
supabase/
  schema.sql      테이블 15개 + RLS + 트리거 + 함수 + Realtime
  seed.sql        시범 데이터
scripts/
  db-setup.mjs    DB 자동 구축
  doctor.mjs      설치 점검
```

**보안 구조**: 모든 테이블에 RLS 가 걸려 있습니다. 교사는 자기가 담당한 학생과 자기가 만든
자료만, 학생은 자기 것과 자기 반 것만 접근합니다. 화면 접근은 `(teacher)` / `(student)`
레이아웃이 서버에서 검사해 되돌립니다.

---

## 학교 내부 서버에 직접 구축하려면

학생 정보를 학교 밖에 두지 않으려면 Supabase 를 직접 띄울 수 있습니다.
**앱 코드는 고치지 않습니다** — 주소와 키만 바꿉니다.
절차는 [SELFHOST.md](SELFHOST.md) 를 보세요.

주의: PostgreSQL 만 설치해서는 동작하지 않습니다. 앱은 Postgres 가 아니라
Supabase 의 HTTP API(PostgREST · GoTrue · Realtime)에 붙습니다.

---

## 막혔을 때

증상별 해결책은 [SETUP.md](SETUP.md) 의 **막혔을 때** 항목에 정리해 두었습니다.
자주 걸리는 것:

- **모든 주소가 404** → Vercel Framework Preset 이 `Other`
- **Vercel 로그인 페이지가 나온다** → Deployment Protection 켜져 있음
- **접속이 아예 안 된다** → Supabase 프로젝트 일시정지 (`Resume project`)
- **화면이 비어 있다** → `npm run doctor` 로 확인
