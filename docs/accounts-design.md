# 학교 계정 서버 · 외부용 명단 · 비밀번호 보안

에듀폼2 의 학생 계정을 다른 프로그램과 함께 쓰기 위한 설계와 구현이다.
작업을 이어받는 사람은 이 문서부터 읽으면 된다.

**진행 상태** (2026-11-15)

- 1단계 에듀폼2 — **구현 완료** (아래 전부). 시험: 로컬 Postgres + 브라우저로 25개 항목 통과
- 2단계 pycoding · pyclub (geoje 저장소) — **남음**. 학교 안 «에듀폼2 로 로그인», 학교 밖
  «학번+이름 연습», 학번+PIN 없애기. 아래 «2단계에서 프로그램이 할 일»

---

## 요구사항과 결정 (사용자, 2026-11-15)

| 요구 | 결정 |
|---|---|
| 에듀폼2 를 학교 계정 서버로 (A 방법) | 첫 연동 대상은 pycoding(중학생 파이썬 채점) |
| 외부용은 관리자가 일괄 등록 | 관리자 화면 «외부용 명단» |
| 서버에서 CSV 로 내려받기 | 학번 · 이름 · 반 세 칸만 |
| 외부용은 학번+이름만 맞으면 연습 | pycoding · pyclub. **학교 안 = 에듀폼2 로그인(평가 가능) / 학교 밖 = 학번+이름(연습만)**. 학번+PIN 은 없앤다 |
| 비밀번호 보안을 최대한 | 초기 비밀번호는 지금처럼 6자 허용, **첫 로그인 때 본인이 바꾼다**(8자 이상 규칙) |
| 순서 | 에듀폼2 먼저 → pycoding · pyclub |

## 한 줄 원칙

> **비밀번호와 그 해시는 학교 서버 Postgres 밖으로 한 글자도 나가지 않는다.**
> 연동 프로그램에도, CSV 에도, 외부 프로그램에도.

---

## 전체 그림

```
 ┌────────────── 학교 서버 10.90.10.80:3000 (에듀폼2) ──────────────┐
 │ /sso/authorize   로그인 · «○○○(으)로 계속» 화면                   │
 │ /api/sso/issue   증명(id_token) 서명 — Ed25519 비밀 열쇠 (DB, 암호화) │
 │ /sso/jwks        공개 열쇠                                        │
 │ /admin/external  외부용 명단 · CSV       /admin/sso  연동 프로그램   │
 │ /admin/security  잠긴 계정 풀기                                    │
 │ Postgres auth.users ← 비밀번호 해시는 여기에만                      │
 └───────────────────────────────────────────────────────────────────┘
       ▲  ① 학생 브라우저(학교망)가 에듀폼2 에서 로그인
       │  ② 서명된 증명을 들고 #id_token=… 으로 돌아간다
       ▼
 pycoding (클라우드) — 공개 열쇠로 서명만 확인. 학교 서버에 연결하지 않는다.

 학교 밖: 관리자가 CSV(학번·이름·반)를 pycoding 교사 화면에 올림 → 학번+이름으로 연습
```

---

## 1. 학교 계정 서버 (A)

### 왜 «서명된 증명» 인가

- **비밀번호를 받는 API 로 하면** 모든 연동 프로그램이 학생 비밀번호를 보게 된다.
  한 프로그램만 허술해도(로그, 평문 저장) 에듀폼2 비밀번호가 샌다.
- **`SUPABASE_JWT_SECRET` 을 나눠 주면** 그 값으로 PostgREST 관리자(service_role) 토큰까지
  만들 수 있다. 절대 나눠 주지 않는다.
- **OAuth «코드 교환»(프로그램 서버 → 에듀폼2) 은** pycoding 이 Cloudflare(클라우드)라
  안 된다. 10.90.10.80 은 사설 IP 라 클라우드에서 닿지 않는다.

그래서 **학생 브라우저가 증명을 들고 간다**. 에듀폼2 가 Ed25519 비밀 열쇠로 서명하고,
프로그램은 **공개** 열쇠만 가지고 확인한다. 공개 열쇠로는 증명을 만들 수 없다.

### 흐름

```
1. 프로그램 화면 → 학생을 보낸다 (state · nonce 는 프로그램이 만든 임의값, 16~200자)
   GET http://10.90.10.80:3000/sso/authorize
       ?client_id=pycoding
       &redirect_uri=https://dadaschool.github.io/pycoding/     ← 등록한 것과 정확히 같아야
       &state=<임의값>&nonce=<임의값>

2. 에듀폼2 — 로그인 안 돼 있으면 학생 로그인 화면(?next=) → 임시 비밀번호면 바꾸기 화면
   → «강도윤(으)로 계속 / 내가 아니에요 / 취소»
   (로그인돼 있어도 한 번 누르게 한다 — 컴퓨터실에서 앞 학생 계정으로 들어가는 것 막기)

3. [계속] → 302 아님. 화면이 /api/sso/issue 를 부르고 받은 주소로 이동
   https://dadaschool.github.io/pycoding/#id_token=<증명>&state=<그 임의값>
   (취소 → #error=access_denied&state=…)

4. 프로그램 화면 → 자기 서버에 id_token 을 보낸다 → 서버가 확인하고 자기 세션을 만든다
```

잘못된 요청(등록 안 된 프로그램 · 등록 안 된 돌아갈 주소)은 **돌려보내지 않고** 에듀폼2
화면에서 멈춘다.

### 증명(id_token) 내용

```json
{ "alg": "EdDSA", "typ": "JWT", "kid": "<열쇠 id>" }
{
  "iss": "http://10.90.10.80:3000",   // 환경변수 SSO_ISSUER 로 고정할 수 있다
  "aud": "pycoding",                   // client_id
  "sub": "3a2ee4b7…(32자)",            // 프로그램마다 다른 가명 — 내부 id 아님
  "iat": 1794744259, "exp": 1794744379, // 2분
  "jti": "…",                          // 한 번만 쓰게 프로그램이 기억
  "nonce": "<프로그램이 보낸 값>",
  "name": "강도윤", "role": "student",
  "student_number": "30101", "class_name": "3학년 1반", "school_year": 2026
}
```

이메일 · 비밀번호는 넣지 않는다.

### 저장 (`supabase/native/auth-schema.sql`)

| 표 | 내용 |
|---|---|
| `auth.sso_clients` | client_id · 이름 · 돌아갈 주소(정확히 일치) · 허용 역할 · 가명용 소금 · 켜기 |
| `auth.sso_keys` | 서명 열쇠. 비밀 열쇠는 `AI_KEY_SECRET` 으로 암호화(`src/lib/ai-crypto.ts`). 처음 쓸 때 자동 생성 |
| `auth.sso_events` | 언제 누구에게 증명을 줬는지 (증명 원문은 안 남김) |

모두 `auth` 스키마 — PostgREST 가 내보내지 않고, 웹 역할에는 권한이 없다.

### 관리자 화면 «연동 프로그램» (`/admin/sso`)

- 등록: 프로그램 ID · 이름 · 돌아갈 주소(여러 개) · 학생/교사
- 학교 밖 주소는 **https 만** (사설 IP · localhost 만 http 허용)
- 공개 열쇠(JWKS) 보기·복사, «열쇠 바꾸기» (바로 전 열쇠 하나는 목록에 남긴다)

### 2단계에서 프로그램이 할 일 (pycoding Worker 예)

```js
// 공개 열쇠는 Worker 환경변수에 넣는다 (학교 서버에 연결할 수 없으므로)
//   EDUFORM_JWKS = /admin/sso 에서 복사한 JSON
//   EDUFORM_ISS  = http://10.90.10.80:3000
async function verifyEduform(idToken, env, expectedNonce) {
  const [h, p, s] = idToken.split('.')
  const dec = x => JSON.parse(new TextDecoder().decode(b64urlToBytes(x)))
  const head = dec(h), c = dec(p)
  if (head.alg !== 'EdDSA') throw new Error('alg')                 // ← 꼭 확인
  const jwk = JSON.parse(env.EDUFORM_JWKS).keys.find(k => k.kid === head.kid)
  if (!jwk) throw new Error('kid')
  const key = await crypto.subtle.importKey('jwk', { kty: 'OKP', crv: 'Ed25519', x: jwk.x },
    { name: 'Ed25519' }, false, ['verify'])
  const ok = await crypto.subtle.verify({ name: 'Ed25519' }, key, b64urlToBytes(s),
    new TextEncoder().encode(`${h}.${p}`))
  const now = Math.floor(Date.now() / 1000)
  if (!ok || c.iss !== env.EDUFORM_ISS || c.aud !== 'pycoding' || c.exp < now
      || c.nonce !== expectedNonce) throw new Error('invalid')
  // c.jti 를 D1 에 넣어 두 번째 사용을 거절한다 (2분만 보관하면 된다)
  return c   // { name, student_number, class_name, role, sub }
}
```

- `nonce` 는 로그인을 시작할 때 만들어 브라우저 `sessionStorage` 와 함께 보관했다가 대조한다
  (남이 만든 증명을 끼워 넣는 것 막기). `state` 도 같은 방식.
- 증명은 `location.hash` 에서 읽은 즉시 `history.replaceState` 로 주소창에서 지운다.
- 에듀폼2 증명으로 들어온 세션만 **평가**를 열고, 학번+이름 세션은 **연습만**.

---

## 2. 외부용 명단 — 일괄 등록과 CSV

- `profiles.external_practice` (기본 false). **관리자만** 바꿀 수 있다 (DB 트리거).
- 관리자 화면 «외부용 명단» (`/admin/external`): 반별 체크 상자로 넣기·빼기, 학번 붙여넣기로 한꺼번에.
- 학번이 없는 학생은 넣지 않는다. **외부용 명단 안에서 학번이 겹치면 막는다** — 학번이
  «1» 처럼 반 번호만 있으면 반마다 겹치므로 30101 처럼 학년·반·번호 전체로 고쳐야 한다.
- CSV (`/api/admin/external/csv`, 관리자만):

  ```
  학번,이름,반
  30101,강도윤,3학년 1반
  ```

  UTF-8 BOM(엑셀 한글) · 수식 주입 막기(`= + - @` 로 시작하면 앞에 `'`) · `Cache-Control: no-store`.
  내려받을 때마다 `auth.admin_audit` 에 누가·언제·몇 명.

⚠ 학번과 이름은 **같은 반 친구라면 아는 정보**다. 외부용은 **연습 전용** — 평가 · 성적처럼
남이 보면 안 되는 것은 외부용(학번+이름 로그인)에 두지 않는다. 관리자 화면에도 적어 두었다.

---

## 3. 비밀번호 보안

예전부터 있던 것 — bcrypt 해시는 Postgres 안에서만 · 갱신 토큰은 해시만 저장 · 재사용 토큰이
오면 그 계정 세션 전부 끊음 · 비밀번호를 바꾸면 세션 전부 끊음 · 틀린 이메일과 틀린 비밀번호를
같은 문장으로 답함 · JWT `alg` 검사.

이번에 더한 것:

| | 무엇 | 어디 |
|---|---|---|
| ① | **로그인 잠금** — 한 계정 15분 안에 5번 틀리면 15분 잠금. 관리자 «로그인 보안» 에서 풀기. 관리자·교사가 비밀번호를 초기화해도 풀린다 | `auth.sign_in` · `/admin/security` |
| ② | **없는 이메일에도 bcrypt 를 한 번** — 응답 시간으로 «등록된 이메일» 을 알아내지 못하게 | `auth.sign_in` |
| ③ | **bcrypt 비용 10 → 12**. 옛 해시는 다음 로그인 때 자동으로 12 로 | `auth.sign_in` · `create_user` · `set_password` |
| ④ | **임시 비밀번호 → 첫 로그인 때 바꾸기**. 관리자·교사가 정한 비밀번호(일괄 등록 · 초기화)는 `password_temp`. 바꾸기 전에는 교사·학생·관리자 화면과 «에듀폼2 로 로그인» 모두 막힌다 | `/change-password` · 레이아웃 |
| ⑤ | **본인 비밀번호 규칙** — 8자 이상 · 글자+숫자 · 학번/이름/이메일 앞부분 안 됨 · 흔한 것·연속·반복 안 됨 · 72바이트 이하(bcrypt 한계) | `src/lib/password-policy.ts` |
| ⑥ | **비밀번호를 바꿀 때 지금 비밀번호 확인** (잠금도 똑같이 걸림) | `/api/account/password` |
| ⑦ | **로그인 기록** (비밀번호 없음, 90일 보관) | `auth.login_events` |
| ⑧ | **해시 열을 웹 역할이 못 읽게** — `auth.users` select 를 열 단위로 | `auth-schema.sql` 권한 |
| ⑨ | **학생은 자기 이름·학번·반을 못 바꾼다** — 예전엔 `profiles_update` 의 `auth.uid() = id` 로 바꿀 수 있었다. 계정 서버가 넘기는 값이라 바꿀 수 있으면 남 행세가 된다 | `prevent_role_escalation` |

임시 비밀번호는 지금처럼 6자 이상이면 된다(⑤는 본인이 정할 때만). 업그레이드 전부터 있던
계정은 임시로 표시되지 않는다 — 다음에 초기화될 때부터 적용된다.

### 한계 (알고 있는 것)

- 접속 IP 는 `next start` 앞에 프록시가 없어 대개 비어 있다. 그래서 잠금은 **계정 단위**만 한다.
- 잠금을 이용해 남의 계정을 15분 막을 수는 있다 (관리자가 바로 풀 수 있다).
- 임시 비밀번호 차단은 화면(레이아웃) 단위다. 임시 비밀번호로도 로그인 토큰 자체는 나온다.
- 학교망이 HTTP 라 같은 망에서 엿보면 비밀번호가 보인다 (SELFHOST.md «알아둘 것»). 인증서를 넣으면 해결.

---

## 업그레이드

`update.ps1` 이 표·정책을 다시 적용하므로 새 표와 칸이 자동으로 생긴다. 서버 설정(.env.local)은
바꿀 것이 없다. 서명 열쇠는 처음 «연동 프로그램» 을 열거나 로그인 증명을 낼 때 만들어진다.
