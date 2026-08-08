/**
 * 자체호스팅 Supabase 용 비밀값 생성기.
 *
 *   node scripts/selfhost-keys.mjs
 *
 * 클라우드 Supabase 는 키를 발급해 주지만, 직접 띄울 때는 만들어야 한다.
 * ANON_KEY 와 SERVICE_ROLE_KEY 는 JWT_SECRET 으로 서명한 JWT 이고,
 * 셋의 아귀가 맞지 않으면 PostgREST 가 모든 요청을 401 로 거절한다.
 *
 * 출력값은 화면에만 표시한다. 파일로 저장하지 않으니 직접 옮겨 담아야 한다.
 */
import { createHmac, randomBytes } from 'node:crypto'

const b64url = (buf) =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

function signJwt(payload, secret) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = b64url(JSON.stringify(payload))
  const data = `${header}.${body}`
  const sig = b64url(createHmac('sha256', secret).update(data).digest())
  return `${data}.${sig}`
}

/** 검증용 — 서명이 실제로 맞는지 다시 계산해 본다. */
export function verifyJwt(token, secret) {
  const [h, b, s] = token.split('.')
  if (!h || !b || !s) return null
  const expected = b64url(createHmac('sha256', secret).update(`${h}.${b}`).digest())
  if (expected !== s) return null
  return JSON.parse(Buffer.from(b.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString())
}

export function generate({ years = 10, now = Math.floor(Date.now() / 1000) } = {}) {
  // JWT_SECRET 은 40자 이상이어야 한다 (GoTrue 요구사항).
  const jwtSecret = randomBytes(32).toString('hex') // 64자
  const exp = now + years * 365 * 24 * 60 * 60

  const anonKey = signJwt({ role: 'anon', iss: 'supabase', iat: now, exp }, jwtSecret)
  const serviceKey = signJwt({ role: 'service_role', iss: 'supabase', iat: now, exp }, jwtSecret)

  return {
    jwtSecret,
    anonKey,
    serviceKey,
    // 특수문자를 뺀다. DB URL 에 그대로 들어가는데 @ : / 가 있으면 URL 인코딩이 필요해진다.
    postgresPassword: randomBytes(24).toString('base64url').replace(/[^A-Za-z0-9]/g, '').slice(0, 28),
    dashboardPassword: randomBytes(12).toString('base64url').replace(/[^A-Za-z0-9]/g, '').slice(0, 16),
    secretKeyBase: randomBytes(32).toString('hex'),
    vaultEncKey: randomBytes(16).toString('hex'), // 정확히 32자여야 한다
    expiresAt: new Date(exp * 1000).toISOString().slice(0, 10),
  }
}

// 직접 실행했을 때만 출력한다 (import 시에는 조용히)
if (process.argv[1] && process.argv[1].endsWith('selfhost-keys.mjs')) {
  const k = generate()
  console.log(`
자체호스팅 Supabase 비밀값이 생성되었습니다. (키 만료: ${k.expiresAt})

selfhost/.env 에 넣으세요
─────────────────────────────────────────────────────────
POSTGRES_PASSWORD=${k.postgresPassword}
JWT_SECRET=${k.jwtSecret}
ANON_KEY=${k.anonKey}
SERVICE_ROLE_KEY=${k.serviceKey}
SECRET_KEY_BASE=${k.secretKeyBase}
VAULT_ENC_KEY=${k.vaultEncKey}
DASHBOARD_PASSWORD=${k.dashboardPassword}

앱의 .env.local 에 넣으세요
─────────────────────────────────────────────────────────
NEXT_PUBLIC_SUPABASE_URL=http://내부서버주소:8000
NEXT_PUBLIC_SUPABASE_ANON_KEY=${k.anonKey}
SUPABASE_SERVICE_ROLE_KEY=${k.serviceKey}

⚠ 이 값들은 다시 볼 수 없습니다. 지금 옮겨 담으세요.
⚠ SERVICE_ROLE_KEY 는 보안규칙(RLS)을 무시하는 관리자 키입니다.
   서버에만 두고 브라우저·깃·채팅에 절대 넣지 마세요.
⚠ 이미 운영 중인 DB 가 있다면 JWT_SECRET 을 바꾸는 순간 기존 키가 전부 무효가 됩니다.
`)
}
