/**
 * POST /auth/v1/token?grant_type=password        로그인
 * POST /auth/v1/token?grant_type=refresh_token   세션 갱신
 *
 * 클라이언트 라이브러리가 부르는 주소와 응답 모양을 그대로 맞춘 것이다.
 * 자세한 배경은 src/lib/native-auth.ts 주석 참고.
 */
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import {
  pool, authError, sessionJson, startSession, userById, refreshHash,
  newRefreshToken, REFRESH_TTL_DAYS, type UserRow,
} from '@/lib/native-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const grant = req.nextUrl.searchParams.get('grant_type') ?? 'password'

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return authError(400, '요청 형식이 올바르지 않습니다', 'bad_json')
  }

  try {
    if (grant === 'password') return await signIn(body)
    if (grant === 'refresh_token') return await refresh(body)
    return authError(400, `지원하지 않는 방식입니다: ${grant}`, 'unsupported_grant_type')
  } catch (err) {
    console.error('[auth] /token 실패:', err)
    return authError(400, err instanceof Error ? err.message : '로그인 처리 중 오류', 'internal')
  }
}

async function signIn(body: Record<string, unknown>) {
  const email = typeof body.email === 'string' ? body.email : ''
  const password = typeof body.password === 'string' ? body.password : ''

  if (!email || !password) {
    return authError(400, '이메일과 비밀번호를 입력하세요', 'validation_failed')
  }

  const { rows } = await pool().query<UserRow>(
    'select * from auth.verify_password($1, $2)', [email, password]
  )

  // 이메일이 없는 경우와 비밀번호가 틀린 경우를 구분해 알려주지 않는다.
  // 어느 이메일이 등록되어 있는지 확인하는 수단이 되기 때문이다.
  if (rows.length === 0) {
    return authError(400, '이메일 또는 비밀번호가 올바르지 않습니다', 'invalid_credentials')
  }

  return NextResponse.json(await startSession(rows[0]))
}

async function refresh(body: Record<string, unknown>) {
  const token = typeof body.refresh_token === 'string' ? body.refresh_token : ''
  if (!token) return authError(400, '갱신 토큰이 없습니다', 'validation_failed')

  const { rows } = await pool().query<{ status: string; user_id: string | null }>(
    'select * from auth.use_refresh_token($1)', [refreshHash(token)]
  )
  const status = rows[0]?.status

  if (status !== 'ok') {
    // reused 는 이미 쓴 토큰이 다시 온 경우다. DB 함수가 그 계정의 토큰을
    // 전부 버렸으므로 모든 기기에서 다시 로그인해야 한다.
    const msg = status === 'reused'
      ? '보안을 위해 세션을 종료했습니다. 다시 로그인하세요'
      : '세션이 만료되었습니다. 다시 로그인하세요'
    return authError(401, msg, 'refresh_token_not_found')
  }

  const user = await userById(rows[0].user_id!)
  if (!user) return authError(401, '계정을 찾을 수 없습니다', 'user_not_found')
  if (user.banned_until && new Date(user.banned_until) > new Date()) {
    return authError(403, '정지된 계정입니다', 'user_banned')
  }

  // 회전: 쓴 토큰은 버려졌으니 새 토큰을 발급한다.
  const next = newRefreshToken()
  await pool().query('select auth.store_refresh_token($1, $2, $3, $4)', [
    user.id, next.hash, REFRESH_TTL_DAYS, refreshHash(token),
  ])

  return NextResponse.json(sessionJson(user, next.token))
}
