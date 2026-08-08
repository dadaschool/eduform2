# 내부 서버에 직접 구축하기

학생 정보를 학교 밖에 두지 않으려는 경우의 안내입니다.
클라우드 Supabase 대신 **Supabase를 직접 띄우고**, 앱은 그대로 씁니다.

> **앱 코드는 한 줄도 고치지 않습니다.** `.env.local` 의 주소와 키만 내부 서버 것으로 바꾸면 됩니다.

---

## 무엇을 띄우는 것인가

에듀폼은 Postgres 에 직접 붙지 않습니다. Supabase 가 제공하는 HTTP API 에 붙습니다.

| 앱이 쓰는 것 | 담당 |
|---|---|
| `/rest/v1/…` 모든 데이터 조회·저장 | PostgREST |
| `/auth/v1/…` 로그인·세션·학생 계정 생성 | GoTrue (Auth) |
| 쪽지 실시간 알림 | Realtime |
| 접근 제어(RLS) | PostgreSQL |

**PostgreSQL 만 설치하면 테이블은 생기지만 앱은 한 화면도 뜨지 않습니다.** 로그인부터 막힙니다.
그래서 Supabase 스택 전체가 필요하고, 공식 Docker 번들을 씁니다.

## 최소 사양

| 항목 | 시험용 | 운영용 |
|---|---|---|
| RAM | 8 GB | 16 GB |
| CPU | 2코어 | 4코어 |
| 디스크 | 20 GB | 50 GB + 백업 공간 |
| OS | Windows + WSL2 / Linux | **Ubuntu 22.04+ 권장** |

네트워크: **바깥으로 나가는 연결만** 있으면 됩니다 (도커 이미지 내려받기, AI 호출).
바깥에서 들어오는 연결은 열지 않습니다.

---

## 1. Docker 설치

### Windows (시험용)

Docker Desktop 대신 **WSL2 + Ubuntu + Docker Engine** 을 권합니다.
Docker Desktop 은 일정 규모 이상의 기관에서 유료이고, 나중에 학교 Linux 서버로 옮길 때
명령이 달라집니다. 아래 방식은 **최종 서버와 똑같은 명령**을 씁니다.

**관리자 권한 PowerShell** 에서:

```powershell
wsl --install -d Ubuntu
```

재부팅 후 Ubuntu 창이 뜨면 사용자 이름과 비밀번호를 정합니다. 이어서 **Ubuntu 터미널**에서:

```bash
sudo apt update && sudo apt install -y docker.io docker-compose-v2
sudo usermod -aG docker $USER
```

Ubuntu 창을 닫았다 다시 열고 확인:

```bash
docker run --rm hello-world
```

### Linux 서버 (운영용)

```bash
sudo apt update && sudo apt install -y docker.io docker-compose-v2
sudo usermod -aG docker $USER
```

---

## 2. Supabase 번들 받기

공식 저장소의 `docker` 폴더를 씁니다. 직접 만든 설정보다 안전합니다.

```bash
git clone --depth 1 https://github.com/supabase/supabase
cd supabase/docker
cp .env.example .env
```

## 3. 비밀값 생성

자체호스팅은 API 키를 **직접 만들어야** 합니다. `ANON_KEY` 와 `SERVICE_ROLE_KEY` 는
`JWT_SECRET` 으로 서명한 JWT 라서, 셋이 아귀가 맞지 않으면 모든 요청이 401 로 거절됩니다.

에듀폼 저장소에서:

```bash
node scripts/selfhost-keys.mjs
```

출력된 값을 `supabase/docker/.env` 의 해당 항목에 붙여넣습니다.

```
POSTGRES_PASSWORD=  JWT_SECRET=  ANON_KEY=  SERVICE_ROLE_KEY=
SECRET_KEY_BASE=  VAULT_ENC_KEY=  DASHBOARD_PASSWORD=
```

같은 화면에 앱용 값도 함께 나옵니다. 나중에 5단계에서 씁니다.

> ⚠️ 출력은 화면에만 나오고 저장되지 않습니다. 바로 옮겨 담으세요.
> ⚠️ 운영을 시작한 뒤 `JWT_SECRET` 을 바꾸면 기존 키가 전부 무효가 됩니다.

`.env` 에서 함께 확인할 것:

```
SITE_URL=http://내부서버IP:3000          # 앱 주소
API_EXTERNAL_URL=http://내부서버IP:8000   # 앱이 부를 Supabase 주소
ENABLE_EMAIL_AUTOCONFIRM=true           # 학생 가입 시 이메일 인증 생략
ENABLE_EMAIL_SIGNUP=true
DISABLE_SIGNUP=false
```

`ENABLE_EMAIL_AUTOCONFIRM=true` 가 중요합니다. 내부망에는 메일 서버가 없어서,
이걸 켜지 않으면 학생이 초대코드로 가입해도 인증 메일을 받지 못해 로그인할 수 없습니다.

## 4. 외부 접속 차단

기본 설정은 모든 네트워크 인터페이스에 포트를 엽니다. 학생 정보를 다루므로 좁힙니다.

`supabase/docker/` 에 **`docker-compose.override.yml`** 을 만듭니다.
(에듀폼 저장소의 [`selfhost/docker-compose.override.yml`](selfhost/docker-compose.override.yml) 을 복사해 쓰세요)

- **Studio(관리 화면)** 는 서버 안에서만 열리게 합니다. 여기서 모든 학생 데이터를 볼 수 있습니다.
- **Kong(API 게이트웨이)** 은 교내망에서만 접근하게 합니다.

방화벽에서도 한 번 더 막습니다.

```bash
# Linux — 교내망 대역만 허용 (대역은 학교 환경에 맞게 바꾸세요)
sudo ufw allow from 10.0.0.0/8 to any port 8000
sudo ufw allow from 10.0.0.0/8 to any port 3000
sudo ufw enable
```

Windows 방화벽은 **인바운드 규칙**에서 8000·3000 포트를 로컬 서브넷으로만 제한합니다.

> **공유기·방화벽에서 이 포트를 외부로 포워딩하지 마세요.** 인터넷에 열리는 순간
> 학생 개인정보가 외부에 노출됩니다. 밖에서 써야 한다면 VPN 을 통해서만 접근하게 하세요.

## 5. 실행

```bash
cd supabase/docker
docker compose up -d
docker compose ps      # 전부 running / healthy 인지 확인
```

처음에는 이미지를 받느라 5~10분 걸립니다.

확인:

```bash
curl http://localhost:8000/rest/v1/ -H "apikey: 붙여넣은_ANON_KEY"
```

## 6. 앱 연결

에듀폼 폴더의 `.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=http://내부서버IP:8000
NEXT_PUBLIC_SUPABASE_ANON_KEY=(3단계의 ANON_KEY)
SUPABASE_SERVICE_ROLE_KEY=(3단계의 SERVICE_ROLE_KEY)
SUPABASE_DB_URL=postgresql://postgres:비밀번호@내부서버IP:5432/postgres

# AI 는 바깥으로 나갑니다. 쓰지 않으려면 비워 두세요.
UPSTAGE_API_KEY=
```

DB 구축과 점검은 클라우드와 동일합니다.

```bash
npm install
npm run db:seed     # 테이블·정책·함수 + 시범 데이터
npm run doctor      # 전체 점검
```

앱 실행:

```bash
npm run build
npm start           # http://내부서버IP:3000
```

서버가 껐다 켜져도 살아 있게 하려면 `pm2` 나 systemd 서비스로 등록하세요.

## 7. 백업 — 선택이 아닙니다

학생 개인정보입니다. 매일 자동 백업을 거세요.

```bash
# 백업
docker compose exec -T db pg_dump -U postgres postgres | gzip > eduform-$(date +%F).sql.gz

# 복구
gunzip -c eduform-2026-08-08.sql.gz | docker compose exec -T db psql -U postgres postgres
```

crontab 예 (매일 새벽 2시, 30일 보관):

```
0 2 * * * cd /경로/supabase/docker && docker compose exec -T db pg_dump -U postgres postgres | gzip > /backup/eduform-$(date +\%F).sql.gz && find /backup -name 'eduform-*.sql.gz' -mtime +30 -delete
```

백업 파일에는 학생 정보가 그대로 들어 있습니다. **저장 위치의 접근 권한도 함께 관리하세요.**

## 8. 시험 PC → 학교 서버로 옮기기

WSL2 에서 연습한 그대로 Linux 서버에서 통합니다.

1. 서버에 1~5단계를 동일하게 수행 (비밀값은 **새로 생성**)
2. 시험 환경 데이터를 옮기려면 7단계의 백업·복구를 사용
3. 앱의 `.env.local` 주소를 새 서버로 변경
4. `npm run doctor` 로 점검

---

## 클라우드와 비교

| | 클라우드 Supabase | 내부 서버 |
|---|---|---|
| 학생 정보 위치 | 해외 리전 또는 서울 리전 | **학교 안** |
| 비용 | 무료~ (미사용 1주 후 자동 정지) | 서버·전기·관리 시간 |
| 정지 걱정 | 있음 | 없음 |
| 백업 | 자동 | **직접 해야 함** |
| 업데이트·장애 대응 | 자동 | **직접 해야 함** |
| 외부 접속 | 기본 가능 | 차단 (원하는 바) |

내부 서버는 데이터 통제를 얻는 대신 **운영 책임**을 가져옵니다.
백업과 보안 업데이트를 담당할 사람이 정해져 있는지 먼저 확인하세요.

---

## 검증 상태

이 문서에서 **실제로 검증한 것**:

- `node scripts/selfhost-keys.mjs` — 생성된 JWT 의 서명 유효성, 위조 거부,
  role/iss 클레임, `JWT_SECRET` 40자 이상 요구사항까지 16개 항목 확인
- `npm run db:setup` / `npm run doctor` — 실제 PostgreSQL 18.4 에서 동작 확인

**검증하지 못한 것**: Docker 가 설치된 환경이 없어 Supabase 스택 구동과
앱 연동은 실행해 보지 못했습니다. 1~2단계를 마치고 알려주시면 함께 확인하겠습니다.
