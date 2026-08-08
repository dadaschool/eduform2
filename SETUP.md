# 에듀폼 배포 안내서

이 문서 순서대로 따라가면 배포가 완료됩니다. 예상 소요 20~30분.

> **Vercel 프로젝트를 새로 만들 때 반드시 확인할 것**
> **Framework Preset 을 `Next.js` 로** 설정하세요. `Other` 로 두면 빌드는 성공하는데
> 모든 주소가 404 가 됩니다. 처음 배포 때 이 문제로 오래 헤맸습니다.
> 자세한 내용은 맨 아래 [막혔을 때](#막혔을-때) 참고.

---

## 왜 지금 배포가 안 됐는가

두 가지 원인이 겹쳐 있었습니다.

1. **Vercel에 환경변수를 등록하지 않았습니다.**
   `.env.local` 은 `.gitignore` 에 있어 깃에 올라가지 않습니다. Vercel은 그 파일을 볼 수 없습니다.
   로그인 페이지 3개가 빌드 시점에 미리 생성되는데, 그때 Supabase 주소가 없어서 빌드가 통째로 실패했습니다.
   → **코드를 수정해 이제 환경변수가 없어도 빌드는 성공합니다.** 다만 실제로 쓰려면 등록은 해야 합니다.

2. **Supabase 프로젝트가 일시정지되어 있었습니다.**
   무료 등급은 약 1주간 요청이 없으면 자동으로 멈추고, 그때 프로젝트 주소가
   DNS에서도 내려갑니다. 데이터는 그대로 보존됩니다.

---

## 1단계 — Supabase 프로젝트 깨우기

대시보드에 `Project "eduform" is paused` 가 보이면 **`Resume project`** 를 누릅니다. 재개까지 몇 분 걸립니다.

- 프로젝트 주소와 API 키가 **그대로 유지**됩니다 → `.env.local` 을 고칠 필요가 없습니다.
- **DB 비밀번호는 필요 없습니다.** 이 앱은 Postgres 에 직접 붙지 않고 REST API 를 씁니다.
  (잊었더라도 무관합니다. 굳이 바꾸려면 Project Settings → Database → Reset database password)

> ⚠️ **또 멈춥니다.** 무료 등급은 미사용 1주 후 자동 일시정지됩니다.
> 학교에서 실제로 쓰실 거면 Pro 로 올리시거나, 방학처럼 안 쓰는 기간이 지나면
> 다시 `Resume project` 를 눌러야 한다는 점을 기억해 두세요.

**프로젝트를 새로 만드는 경우에만** 해당하는 절차:

1. https://supabase.com/dashboard → **New project**
2. **Name** `eduform` / **Region** `Northeast Asia (Seoul)` / **Database Password** 는 아무 값이나 (앱은 쓰지 않음)
3. 생성 후 Project Settings → API 에서 키 3개를 새로 받아 `.env.local` 과 Vercel 에 반영

## 2단계 — DB 테이블 만들기

1. 왼쪽 메뉴 **SQL Editor** → **New query**
2. 이 저장소의 [`supabase/schema.sql`](supabase/schema.sql) **전체 내용을 복사해 붙여넣기**
3. **Run** (또는 `Ctrl+Enter`)
4. `Success. No rows returned` 가 나오면 성공입니다.

> 파일 하나에 테이블 15개 + 보안정책(RLS) + 트리거 + 초대코드 함수 + 실시간 쪽지 설정이 모두 들어 있습니다. 이것만 실행하면 됩니다.
> **여러 번 실행해도 안전합니다** — 기존 정책·트리거를 먼저 지우고 다시 만들며, 테이블의 데이터는 지우지 않습니다.

<details>
<summary><b>이미 쓰고 있던 프로젝트에 적용하면 무엇이 바뀌는지</b> (펼쳐보기)</summary>

테이블과 데이터는 **손대지 않습니다** (`create table if not exists`).
바뀌는 건 보안정책과 함수뿐입니다.

**고쳐지는 것**

- `increment_invite_code` 함수가 없으면 새로 만듭니다.
  이 함수가 없으면 초대코드로 가입해도 사용횟수가 올라가지 않아 **한도 제한이 무력화**됩니다.
- `assignments` / `assignment_classes` 의 학생 조회 정책이 `true`(무조건 허용)였다면
  자기 반 것만 보이도록 좁힙니다. `true` 였다는 건 **DB 안의 모든 학생이 모든 교사의
  과제를 읽을 수 있었다**는 뜻입니다.
- 학생이 담당 교사의 이름을 읽을 수 있게 합니다. 이게 없으면 쪽지 발신자가 빈칸으로 나옵니다.
- 교사 권한을 "역할이 teacher 인가"에서 "내가 담당한 학생인가 / 내가 만든 자료인가"로
  좁힙니다. 전자는 **아무 교사나 남의 학생 평가·제출물·관찰기록을 볼 수 있는** 조건입니다.

**주의**

- `public` 스키마의 **기존 정책을 전부 지우고** 이 파일의 정책으로 교체합니다.
  직접 추가해 두신 정책이 있다면 사라집니다.
- `teacher_id` 가 비어 있는 학생은 담당 교사가 조회·수정할 수 없게 됩니다.
  아래 쿼리로 미리 확인하세요.

```sql
select id, name from profiles where role = 'student' and teacher_id is null;
```

</details>

**확인**: 왼쪽 **Table Editor** 에서 테이블 15개가 보이는지 봅니다.
`classes, invite_codes, profiles, badges, student_badges, assessments, assessment_classes,
assessment_items, student_assessment_checks, assignments, assignment_classes,
assignment_submissions, observations, student_record_drafts, messages`

## 3단계 — 샘플 데이터 넣기 (권장)

바로 눌러보며 확인할 수 있게 시범 데이터를 준비해 뒀습니다.
**SQL Editor → New query** 에 [`supabase/seed.sql`](supabase/seed.sql) 전체를 붙여넣고 **Run**.

들어가는 것: 교사 1명 · 학생 8명(두 반) · 반 2개 · 초대코드 2개 · 배지 4종 ·
평가 2개(6가지 체크방식 전부) · 과제 3개(제출·피드백·마감초과 포함) ·
관찰기록 9건 · 생활기록부 초안 2건 · 쪽지 6통(읽음/안읽음 섞임)

**로그인 정보** (전원 비밀번호 `edu1234`)

| 역할 | 이메일 |
|---|---|
| 교사 김민지 | `teacher@eduform.test` |
| 학생 8명 | `s01@eduform.test` ~ `s08@eduform.test` |

> ⚠️ 비밀번호가 전부 같은 시범용 계정입니다. **실제 학생을 받기 전에 지우세요.**
> `seed.sql` 맨 아래 주석 처리된 `delete` 블록의 `--` 를 풀고 실행하면 샘플만 삭제됩니다.
> 이 파일도 여러 번 실행해도 안전합니다 (매번 지우고 새로 넣습니다).

**샘플 데이터를 쓰면 7단계(교사 계정 수동 생성)는 건너뛰어도 됩니다.**

## 4단계 — 이메일 확인 끄기 (권장)

학생이 초대코드로 가입할 때 이메일 인증을 요구하면 학교 환경에서 막힙니다.

**Authentication → Sign In / Providers → Email** 에서 **Confirm email** 을 **끕니다**.

## 5단계 — API 키 확보

**Project Settings → API** 에서 세 개를 복사합니다.

| 화면에 있는 이름 | 넣을 환경변수 이름 |
|---|---|
| Project URL | `NEXT_PUBLIC_SUPABASE_URL` |
| Project API keys → `anon` `public` | `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| Project API keys → `service_role` | `SUPABASE_SERVICE_ROLE_KEY` |

AI 기능용 키는 아래에서 받습니다. **둘 다 없어도 나머지 기능은 전부 동작합니다.**

| 발급처 | 넣을 환경변수 이름 |
|---|---|
| https://aistudio.google.com/app/apikey → Create API key | `GEMINI_API_KEY` |
| https://console.upstage.ai → API Keys | `UPSTAGE_API_KEY` |

AI 기능은 **Gemini 를 먼저 쓰고 실패하면 업스테이지(Solar)로 자동 전환**됩니다.
둘 중 하나만 있어도 동작합니다. Gemini 가 막혀 있다면 `AI_PRIMARY=upstage` 를 함께
등록해 Gemini 호출을 건너뛰게 하세요.

> `service_role` 키는 보안 규칙(RLS)을 무시하는 관리자 키입니다. **깃, 채팅, 문서에 절대 붙여넣지 마세요.** 서버에서만 쓰이고 브라우저로는 나가지 않습니다.

## 6단계 — 로컬에서 먼저 확인

프로젝트 폴더의 `.env.local` 을 열어 값을 새 것으로 바꿉니다.
(`.env.example` 이 어떤 형식인지 보여주는 템플릿입니다)

```bash
npm run dev
```

http://localhost:3000 → 교사 로그인 화면이 뜨면 정상입니다.
**회원가입은 다음 단계에서** 합니다.

## 7단계 — 교사 계정 만들기 (샘플 데이터를 안 쓸 경우)

앱에는 교사 회원가입 화면이 없습니다(`/register` 는 학생 전용). 교사는 대시보드에서 직접 만듭니다.

1. Supabase **Authentication → Users → Add user → Create new user**
   - Email / Password 입력, **Auto Confirm User 체크**
   - 생성된 사용자의 **UID를 복사**
2. **SQL Editor** 에서 아래를 실행 (3곳을 본인 값으로 교체)

```sql
insert into profiles (id, email, name, role)
values (
  '여기에-복사한-UID',
  '교사이메일@example.com',
  '홍길동',
  'teacher'
);
```

3. `/login` 에서 그 이메일·비밀번호로 로그인 → `/teacher/dashboard` 로 들어가면 성공입니다.

## 8단계 — Vercel 환경변수 등록 (배포 성공의 핵심)

1. https://vercel.com/dashboard → **eduform** 프로젝트
2. **Settings → Environment Variables**
3. 아래 값들을 하나씩 추가합니다. **Environment는 Production, Preview, Development 모두 체크**하세요.
   Supabase 3개는 필수입니다. AI 키는 쓰는 쪽만 넣으면 됩니다.

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
GEMINI_API_KEY
UPSTAGE_API_KEY
AI_PRIMARY
```

4. **Deployments** 탭 → 맨 위 배포의 `⋯` → **Redeploy**
   - **"Use existing Build Cache" 는 체크 해제**하세요. 환경변수가 새로 반영돼야 합니다.

## 9단계 — 최종 확인

배포된 URL에서 차례로 확인합니다. (3단계 샘플 데이터를 넣었다면 그대로 따라가면 됩니다)

**교사로 로그인** — `/login` → `teacher@eduform.test` / `edu1234`

- [ ] 대시보드에 학생 8명, 반 2개, 평가 2개가 집계된다
- [ ] **학생 관리**에 강도윤~오세영 8명이 보인다
- [ ] **평가 → 1학기 국어 수행평가 → 체크**에서 상/중/하, 1~5점, 완료/보류/미제출, 텍스트가 모두 정상 표시된다
- [ ] **과제 → 독서록 쓰기**에서 강도윤의 제출물과 내가 남긴 피드백이 보인다
- [ ] **관찰기록**에 9건이 보인다
- [ ] **생활기록부**에서 강도윤 초안을 새로 생성해 본다 ← AI 키가 여기서 검증됩니다
      (토스트 설명줄에 `업스테이지 Solar` 또는 `Google Gemini` 중 어느 쪽이 응답했는지 표시됩니다)
- [ ] **쪽지함**에 6통이 있고, 정우진의 "결석 보충 질문"이 안읽음으로 표시된다

**학생으로 로그인** (시크릿 창) — `/student-login` → `s02@eduform.test` / `edu1234`

- [ ] 로그인 직후 안읽은 쪽지 알림이 뜬다 (김서연에게 안읽은 쪽지 1통이 있음)
- [ ] **과제**에 "독서록 쓰기", "수학 익힘책" 2개만 보인다 → **"가족 인터뷰하기"가 보이면 반 격리가 깨진 것**
- [ ] **내 배지**에 나눔천사 🤝 가 보인다

**초대코드 가입 확인** (시크릿 창) — `/register` → 코드 `3A2026`

- [ ] 가입이 되고, 교사 화면 **학생 관리**에 새 학생이 즉시 보인다
  (여기서 안 보이면 `teacher_id` 가 안 채워진 것입니다)

---

## 막혔을 때

**배포는 `Ready` 인데 모든 주소가 404 (`X-Vercel-Error: NOT_FOUND`)**
Vercel **Settings → Build and Deployment → Framework Preset** 이 `Other` 로 되어 있는지 확인하세요.
**`Next.js` 여야 합니다.**

`Other` 로 두면 Vercel 이 `npm run build` 는 실행하지만, 그 뒤 정적 파일 폴더(`public` 또는 `.`)만
찾아서 올립니다. Next.js 의 `.next` 산출물·서버 함수·라우팅·미들웨어를 전혀 모릅니다.
그래서 빌드는 성공하는데 서빙할 경로가 하나도 없어 `/`, `/login`, `/favicon.ico`,
`/_next/static/` 까지 전부 404 가 됩니다.

고친 뒤 **반드시 Redeploy** 하세요. 설정만 바꿔도 기존 배포는 다시 빌드되지 않습니다.
제대로 인식되면 빌드 로그에 라우트 목록(`○ /login`, `ƒ /teacher/dashboard` 같은 표)이 출력됩니다.

**로그인 화면이 아니라 Vercel 로그인 페이지가 나온다** (`title: Login – Vercel`)
**Settings → Deployment Protection → Vercel Authentication → Require Log In** 을 끄세요.
확인 문구로 `disable vercel authentication` 을 입력해야 합니다.
아래 **Password Protection** 도 꺼져 있어야 합니다.

이건 Vercel 이 사이트 전체 앞에 세우는 별도 관문이라, 켜져 있으면 교사·학생이 로그인 화면에조차
접근할 수 없습니다. 끄더라도 앱 자체 인증은 그대로입니다 —
`/teacher/*`, `/student/*` 는 각 레이아웃이 서버에서 로그인 화면으로 되돌립니다.

**배포가 또 실패한다**
Vercel → Deployments → 실패한 배포 클릭 → **Building** 로그를 펼쳐 빨간 줄을 확인하세요.
로컬에서 똑같은 조건으로 재현하려면:

```bash
npm run build
```

**로그인은 되는데 화면이 비어 있다**
브라우저 개발자도구(F12) → Console 에 빨간 오류를 확인하세요.
`permission denied for table ...` 이면 2단계 SQL의 RLS 정책이 안 올라간 것입니다. schema.sql을 다시 실행하세요.

**"환경변수가 설정되지 않았습니다" 오류가 뜬다**
8단계를 안 했거나, 등록 후 Redeploy를 안 한 것입니다. 변수 이름의 오타(특히 `NEXT_PUBLIC_` 접두사)도 확인하세요.

**학생이 교사 화면에 안 보인다**
교사 화면은 `profiles.teacher_id` 기준으로 학생을 찾습니다. 초대코드로 가입하면 이 값이 자동으로 채워집니다.
Supabase에서 직접 학생 행을 만들었다면 `teacher_id` 를 교사 UID로 채워주세요.

**AI 초안 생성이 실패한다**

AI 기능은 **Gemini → 업스테이지(Solar) 순으로 자동 전환**됩니다([`src/lib/ai.ts`](src/lib/ai.ts)).
둘 중 하나만 설정되어 있어도 동작하고, 생성 성공 시 어느 쪽이 응답했는지 토스트에 표시됩니다.

둘 다 실패하면 오류 메시지에 양쪽 이유가 함께 담깁니다. 서버 로그에는 `[ai]` 접두사로 남습니다.

`PERMISSION_DENIED` 또는 `limit: 0` 이 Gemini 쪽에 보이면, 그 키가 속한 Google 프로젝트가
차단된 상태입니다. **모델을 바꿔도 해결되지 않습니다.** 2026년 7월 확인 결과:

```
gemini-2.0-flash-lite  429  limit: 0            (무료등급 할당량 0)
gemini-2.5-flash       403  PERMISSION_DENIED: Your project has been denied access.
```

교육청·회사 등 조직 Google 계정으로 발급한 키는 관리자 정책에 막히는 경우가 많습니다.
해결 방법은 둘 중 하나입니다.

1. **업스테이지만 쓴다** — `UPSTAGE_API_KEY` 를 등록하고 `AI_PRIMARY=upstage` 로 둡니다.
   Gemini 호출을 건너뛰어 응답이 약 0.7초 빨라집니다. (현재 이 설정을 쓰고 있습니다)
2. **개인 Google 계정으로 Gemini 키 재발급** — https://aistudio.google.com/app/apikey

어느 쪽도 없으면 영향 범위는 **버튼 2개뿐**입니다 — 평가 만들기의 AI 항목 추천,
생활기록부의 초안 생성. 화면은 정상 동작하고 나머지 기능은 전부 됩니다.

**쪽지 실시간 알림이 안 온다**
Supabase **Database → Replication** 에서 `messages` 테이블이 켜져 있는지 확인하세요.
(2단계 SQL이 자동으로 켜지만, 실패하면 수동으로 켤 수 있습니다)
