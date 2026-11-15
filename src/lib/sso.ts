// 서버 전용 — 학교 계정 서버. 클라이언트 컴포넌트에서 import 금지.
/**
 * 학교 계정 서버 — docs/accounts-design.md «1. 학교 계정 서버»
 *
 * 다른 프로그램(pycoding 등)이 «에듀폼2 로 로그인» 을 쓰게 한다.
 *
 *   1. 프로그램이 학생을 /sso/authorize 로 보낸다 (client_id · redirect_uri · state · nonce)
 *   2. 학생이 에듀폼2 에서 로그인하고 «계속» 을 누른다
 *   3. 에듀폼2 가 «이 학생 맞음» 증명(id_token, 2분)을 서명해
 *      redirect_uri#id_token=…&state=… 로 돌려보낸다
 *   4. 프로그램 서버가 에듀폼2 의 «공개» 열쇠(/sso/jwks)로 서명을 확인한다
 *
 * 왜 이 모양인가
 *   · 프로그램은 학생 비밀번호를 보지 않는다 — 받는 것은 이름·학번·반뿐
 *   · 서명이 Ed25519(비대칭)라 프로그램에는 «공개» 열쇠만 준다. 그 열쇠로는
 *     증명을 만들 수 없다. (SUPABASE_JWT_SECRET 은 관리자 토큰까지 만드는 열쇠라
 *     절대 나눠 주지 않는다)
 *   · 학교 서버는 사설 IP 라 클라우드 프로그램이 직접 물어볼 수 없다. 그래서
 *     «학생 브라우저가 증명을 들고 간다» — 프로그램 서버는 학교에 연결하지 않고
 *     공개 열쇠만으로 확인한다
 *   · 증명은 # 뒤(fragment)에 붙인다 — 서버 접속 기록과 Referer 에 남지 않는다
 */
import { createHash, createHmac, generateKeyPairSync, createPrivateKey, sign, randomBytes } from 'node:crypto'
import { pool } from '@/lib/native-auth'
import { encryptKey, decryptKey } from '@/lib/ai-crypto'

/** 증명 유효 시간(초). 받자마자 쓰는 것이라 짧게 둔다. */
export const ID_TOKEN_TTL = 120

export interface SsoClient {
  client_id: string
  name: string
  redirect_uris: string[]
  roles: string[]
  sub_salt: string
  enabled: boolean
}

export interface Ed25519Jwk {
  kty: 'OKP'
  crv: 'Ed25519'
  x: string
  kid: string
  alg: 'EdDSA'
  use: 'sig'
}

const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64url')

export async function getClient(clientId: string): Promise<SsoClient | null> {
  if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(clientId)) return null
  const { rows } = await pool().query<SsoClient>(
    'select client_id, name, redirect_uris, roles, sub_salt, enabled from auth.sso_clients where client_id = $1',
    [clientId]
  )
  return rows[0] ?? null
}

/** 돌아갈 주소는 등록한 것과 «정확히» 같아야 한다. 앞부분만 맞는 것은 받지 않는다. */
export function redirectAllowed(c: SsoClient, uri: string): boolean {
  return c.redirect_uris.includes(uri)
}

/** state · nonce — 프로그램이 만든 임의값. 길이와 글자만 본다. */
export function validOpaque(v: unknown): v is string {
  return typeof v === 'string' && /^[A-Za-z0-9._~-]{16,200}$/.test(v)
}

/** 등록할 돌아갈 주소 검사 — http(s) 절대 주소, # 없음. */
export function validRedirectUri(uri: string): boolean {
  try {
    const u = new URL(uri)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false
    if (u.hash || u.username || u.password) return false
    return u.toString() === uri || `${u.toString()}` === `${uri}/`
  } catch {
    return false
  }
}

// ────────────────────────────────────────────
//  서명 열쇠
// ────────────────────────────────────────────

interface KeyRow { kid: string; public_jwk: Ed25519Jwk; private_enc: string; active: boolean }

function newKey(): { kid: string; jwk: Ed25519Jwk; privatePem: string } {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const pub = publicKey.export({ format: 'jwk' }) as { x: string }
  const kid = createHash('sha256').update(pub.x).digest('hex').slice(0, 16)
  return {
    kid,
    jwk: { kty: 'OKP', crv: 'Ed25519', x: pub.x, kid, alg: 'EdDSA', use: 'sig' },
    privatePem: privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
  }
}

/** 쓰고 있는 열쇠. 없으면 처음 한 번 만든다. */
async function activeKey(): Promise<KeyRow> {
  const pick = async () => (await pool().query<KeyRow>(
    'select kid, public_jwk, private_enc, active from auth.sso_keys where active order by created_at desc limit 1'
  )).rows[0]
  const found = await pick()
  if (found) return found
  const k = newKey()
  await pool().query(
    'insert into auth.sso_keys (kid, public_jwk, private_enc) values ($1, $2, $3) on conflict do nothing',
    [k.kid, JSON.stringify(k.jwk), encryptKey(k.privatePem)]
  )
  return (await pick())!
}

/**
 * 열쇠 바꾸기. 바로 전 열쇠 하나는 공개 목록에 남겨 둔다 — 그 사이 발급된
 * 증명(2분)이 확인되도록. 그보다 오래된 것은 지운다.
 * 프로그램이 공개 열쇠를 «손으로» 넣어 두었다면 새 열쇠로 바꿔 넣어야 한다.
 */
export async function rotateKey(): Promise<Ed25519Jwk> {
  const k = newKey()
  const c = await pool().connect()
  try {
    await c.query('begin')
    await c.query(`delete from auth.sso_keys where not active`)
    await c.query('update auth.sso_keys set active = false')
    await c.query('insert into auth.sso_keys (kid, public_jwk, private_enc) values ($1, $2, $3)',
      [k.kid, JSON.stringify(k.jwk), encryptKey(k.privatePem)])
    await c.query('commit')
  } catch (err) {
    await c.query('rollback')
    throw err
  } finally {
    c.release()
  }
  return k.jwk
}

/** 공개 열쇠 목록 (JWKS). 지금 열쇠가 맨 앞. */
export async function publicJwks(): Promise<{ keys: Ed25519Jwk[] }> {
  await activeKey()
  const { rows } = await pool().query<{ public_jwk: Ed25519Jwk }>(
    'select public_jwk from auth.sso_keys order by active desc, created_at desc'
  )
  return { keys: rows.map(r => r.public_jwk) }
}

// ────────────────────────────────────────────
//  증명(id_token) 발급
// ────────────────────────────────────────────

export interface IdentityRow {
  name: string
  role: 'student' | 'teacher'
  is_admin: boolean
  student_number: string | null
  class_name: string | null
  school_year: number | null
}

export async function identityOf(userId: string): Promise<IdentityRow | null> {
  const { rows } = await pool().query<IdentityRow>(
    `select p.name, p.role, coalesce(p.is_admin, false) as is_admin,
            p.student_number, c.name as class_name, c.year as school_year
       from public.profiles p left join public.classes c on c.id = p.class_id
      where p.id = $1`,
    [userId]
  )
  return rows[0] ?? null
}

/** 프로그램마다 다른 sub — 에듀폼2 내부 id 를 그대로 주지 않는다. */
export function subjectFor(c: SsoClient, userId: string): string {
  return createHmac('sha256', c.sub_salt).update(userId).digest('hex').slice(0, 32)
}

export async function issueIdToken(opts: {
  client: SsoClient
  userId: string
  nonce: string
  issuer: string
}): Promise<string> {
  const who = await identityOf(opts.userId)
  if (!who) throw new Error('프로필이 없습니다')
  if (!opts.client.roles.includes(who.role)) throw new Error('이 프로그램에 들어갈 수 없는 계정입니다')

  const key = await activeKey()
  const iat = Math.floor(Date.now() / 1000)
  const jti = randomBytes(16).toString('base64url')
  const payload = {
    iss: opts.issuer,
    aud: opts.client.client_id,
    sub: subjectFor(opts.client, opts.userId),
    iat,
    exp: iat + ID_TOKEN_TTL,
    jti,
    nonce: opts.nonce,
    name: who.name,
    role: who.role,
    // 관리자 표시 — 연동 프로그램이 교사 화면에서 관리 기능을 열지 정할 때 쓴다
    is_admin: who.is_admin === true,
    student_number: who.student_number,
    class_name: who.class_name,
    school_year: who.school_year,
  }
  const head = b64url(JSON.stringify({ alg: 'EdDSA', typ: 'JWT', kid: key.kid }))
  const body = b64url(JSON.stringify(payload))
  const privateKey = createPrivateKey(decryptKey(key.private_enc))
  const sig = b64url(sign(null, Buffer.from(`${head}.${body}`), privateKey))

  await pool().query('insert into auth.sso_events (client_id, user_id, jti) values ($1, $2, $3)', [
    opts.client.client_id, opts.userId, jti,
  ])
  return `${head}.${body}.${sig}`
}

/** 증명을 붙여 돌려보낼 주소. # 뒤에 붙인다 (서버 기록·Referer 에 안 남게). */
export function callbackUrl(redirectUri: string, params: Record<string, string>): string {
  return `${redirectUri}#${new URLSearchParams(params).toString()}`
}

/**
 * 브라우저가 실제로 연 주소 (예: http://10.90.10.80:3000).
 *
 * ⚠ req.nextUrl.origin 을 쓰면 안 된다 — `next start` 에서는 브라우저 주소가 아니라
 *   http://localhost:3000 이 나온다. 그러면 «같은 사이트에서 온 요청» 검사가 모든
 *   학생을 막고, 증명의 iss 도 localhost 로 찍힌다. 실제로 시험에서 겪었다.
 */
export function requestOrigin(req: Request): string {
  const h = req.headers
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost'
  const proto = h.get('x-forwarded-proto') ?? 'http'
  return `${proto}://${host}`
}

/** 발급자(iss) — 환경변수 SSO_ISSUER 가 있으면 그것, 없으면 브라우저가 연 주소. */
export function issuerFor(origin: string): string {
  return (process.env.SSO_ISSUER || origin).replace(/\/+$/, '')
}
