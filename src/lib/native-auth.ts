/**
 * 로그인 서버 (GoTrue 대체) 의 공용 부분.
 *
 * Supabase 의 로그인 서버는 윈도우 빌드를 배포하지 않는다. 그래서 교내 서버
 * (윈도우) 설치에서는 `/auth/v1/*` 를 이 앱이 직접 처리한다. 클라이언트
 * 라이브러리(@supabase/supabase-js)는 이 주소를 Supabase 로 알고 그대로 쓴다.
 * 따라서 **응답 모양을 라이브러리가 기대하는 그대로** 맞춰야 한다.
 *
 * 확인한 계약 (node_modules/@supabase/auth-js 를 직접 읽었다):
 *   - 세션으로 인식되는 조건: access_token, refresh_token, expires_in 세 개가 모두 있음
 *   - 사용자 응답: 사용자 객체를 그대로 (또는 { user })
 *   - 오류: { msg } / { message } / { error_description } 중 하나 + 400~4xx
 *     ⚠ 500~504 로 주면 «다시 시도할 오류» 로 보고 세션을 유지한다. 쓰지 않는다.
 *
 * 비밀번호는 이 파일에서 다루지 않는다. Postgres 안에서 pgcrypto 로만 처리한다
 * (supabase/native/auth-schema.sql).
 */
import { createHmac, randomBytes, createHash, timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { Pool } from 'pg'

/** 접근 토큰 유효 시간(초). Supabase 기본값과 같게 둔다. */
export const ACCESS_TTL = 3600
/** 갱신 토큰 유효 기간(일). */
export const REFRESH_TTL_DAYS = 30

// ────────────────────────────────────────────
//  DB
// ────────────────────────────────────────────

/**
 * 개발 중 파일을 고칠 때마다 모듈이 다시 평가되어 연결이 쌓인다.
 * globalThis 에 붙여 한 개만 유지한다.
 */
const g = globalThis as unknown as { __eduformPool?: Pool }

export function pool(): Pool {
  if (!g.__eduformPool) {
    const url = process.env.AUTH_DB_URL || process.env.SUPABASE_DB_URL
    if (!url) {
      throw new Error(
        '환경변수 AUTH_DB_URL 이 없습니다. 로그인 처리에는 Postgres 직접 연결이 필요합니다.\n' +
          '예: AUTH_DB_URL=postgresql://postgres:비밀번호@127.0.0.1:5432/postgres'
      )
    }
    // 교내 서버는 같은 컴퓨터의 Postgres 에 붙는다. TLS 를 요구하지 않는다.
    const isLocal = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url)
    g.__eduformPool = new Pool({
      connectionString: url,
      ssl: isLocal ? false : { rejectUnauthorized: false },
      max: 10,
    })
  }
  return g.__eduformPool
}

// ────────────────────────────────────────────
//  JWT
// ────────────────────────────────────────────

function jwtSecret(): string {
  const s = process.env.SUPABASE_JWT_SECRET
  if (!s) {
    throw new Error(
      '환경변수 SUPABASE_JWT_SECRET 이 없습니다. PostgREST 의 jwt-secret 과 같은 값이어야 합니다.'
    )
  }
  return s
}

const b64url = (b: Buffer | string) =>
  Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

const b64urlDecode = (s: string) =>
  Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString()

export interface Claims {
  sub: string
  email?: string
  role: string
  aud?: string
  iss?: string
  iat: number
  exp: number
}

export function signJwt(claims: Omit<Claims, 'iat' | 'exp'>, ttlSeconds: number): string {
  const iat = Math.floor(Date.now() / 1000)
  const payload = { ...claims, iat, exp: iat + ttlSeconds }
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = b64url(JSON.stringify(payload))
  const sig = b64url(createHmac('sha256', jwtSecret()).update(`${head}.${body}`).digest())
  return `${head}.${body}.${sig}`
}

/**
 * 토큰을 검증한다. 서명·만료·알고리즘을 모두 본다.
 *
 * ⚠ alg 를 확인하지 않으면 `{"alg":"none"}` 헤더로 서명 없는 토큰을 만들어
 *   아무 계정으로나 들어올 수 있다. 여기서 반드시 막는다.
 */
export function verifyJwt(token: string | null | undefined): Claims | null {
  if (!token) return null
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [head, body, sig] = parts

  try {
    const header = JSON.parse(b64urlDecode(head))
    if (header.alg !== 'HS256') return null

    const expected = b64url(createHmac('sha256', jwtSecret()).update(`${head}.${body}`).digest())
    const a = Buffer.from(sig)
    const b = Buffer.from(expected)
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null

    const claims = JSON.parse(b64urlDecode(body)) as Claims
    if (typeof claims.exp !== 'number' || claims.exp <= Math.floor(Date.now() / 1000)) return null
    return claims
  } catch {
    return null
  }
}

// ────────────────────────────────────────────
//  갱신 토큰
// ────────────────────────────────────────────

/**
 * 원문은 클라이언트에게만 주고, DB 에는 해시만 남긴다.
 * DB 를 열어 본 사람이 남의 세션을 그대로 쓰지 못하게 하기 위해서다.
 */
export function newRefreshToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url')
  return { token, hash: refreshHash(token) }
}

export const refreshHash = (token: string) => createHash('sha256').update(token).digest('hex')

// ────────────────────────────────────────────
//  응답 모양
// ────────────────────────────────────────────

export interface UserRow {
  id: string
  aud: string | null
  role: string | null
  email: string | null
  email_confirmed_at: Date | string | null
  last_sign_in_at: Date | string | null
  raw_app_meta_data: Record<string, unknown> | null
  raw_user_meta_data: Record<string, unknown> | null
  banned_until: Date | string | null
  created_at: Date | string | null
  updated_at: Date | string | null
}

const iso = (v: Date | string | null | undefined) =>
  v ? (v instanceof Date ? v.toISOString() : new Date(v).toISOString()) : null

/** GoTrue 가 내보내는 사용자 모양. 라이브러리와 화면이 이 필드들을 읽는다. */
export function userJson(u: UserRow) {
  return {
    id: u.id,
    aud: u.aud ?? 'authenticated',
    role: u.role ?? 'authenticated',
    email: u.email ?? '',
    email_confirmed_at: iso(u.email_confirmed_at),
    confirmed_at: iso(u.email_confirmed_at),
    phone: '',
    last_sign_in_at: iso(u.last_sign_in_at),
    app_metadata: u.raw_app_meta_data ?? { provider: 'email', providers: ['email'] },
    user_metadata: u.raw_user_meta_data ?? {},
    identities: [],
    created_at: iso(u.created_at),
    updated_at: iso(u.updated_at),
    is_anonymous: false,
  }
}

export function sessionJson(u: UserRow, refreshToken: string) {
  const access = signJwt(
    { sub: u.id, email: u.email ?? undefined, role: 'authenticated', aud: 'authenticated', iss: 'eduform' },
    ACCESS_TTL
  )
  return {
    access_token: access,
    token_type: 'bearer',
    expires_in: ACCESS_TTL,
    expires_at: Math.floor(Date.now() / 1000) + ACCESS_TTL,
    refresh_token: refreshToken,
    user: userJson(u),
  }
}

// ────────────────────────────────────────────
//  요청 처리 보조
// ────────────────────────────────────────────

export function bearer(req: Request): string | null {
  const h = req.headers.get('authorization') ?? ''
  const m = /^Bearer\s+(.+)$/i.exec(h.trim())
  return m ? m[1] : null
}

/**
 * 오류 응답.
 *
 * status 를 500~504 로 주면 클라이언트가 «일시적 오류» 로 보고 재시도하며
 * 세션을 유지한다. 로그인 실패는 반드시 4xx 로 준다.
 */
export function authError(status: number, msg: string, code?: string) {
  if (status >= 500 && status <= 504) status = 400
  return NextResponse.json({ msg, message: msg, error_code: code, code }, { status })
}

/** 접근 토큰으로 온 사용자. 유효하지 않으면 null. */
export function callerFromAccessToken(req: Request): Claims | null {
  const c = verifyJwt(bearer(req))
  if (!c || c.role !== 'authenticated') return null
  return c
}

/** service_role 키로 온 요청인가. 관리자용 엔드포인트를 지킨다. */
export function isServiceRole(req: Request): boolean {
  const c = verifyJwt(bearer(req) ?? req.headers.get('apikey'))
  return c?.role === 'service_role'
}

export async function userById(id: string): Promise<UserRow | null> {
  const { rows } = await pool().query<UserRow>('select * from auth.users where id = $1', [id])
  return rows[0] ?? null
}

/** 로그인시켜 세션을 만든다. 갱신 토큰 저장까지 한 번에 처리한다. */
export async function startSession(u: UserRow) {
  const { token, hash } = newRefreshToken()
  await pool().query('select auth.store_refresh_token($1, $2, $3, null)', [u.id, hash, REFRESH_TTL_DAYS])
  await pool().query('select auth.touch_sign_in($1)', [u.id])
  const fresh = (await userById(u.id)) ?? u
  return sessionJson(fresh, token)
}
