/**
 * GET  /auth/v1/user — 지금 누구인가 (앱 전체에서 가장 많이 부르는 경로)
 * PUT  /auth/v1/user — 내 비밀번호·이메일 변경
 *
 * 레이아웃마다 서버에서 getUser() 로 권한을 확인하므로, 이 경로가 곧 인증의
 * 관문이다. 토큰 검증에서 조금이라도 느슨해지면 전체가 뚫린다.
 */
import { NextResponse } from 'next/server'
import {
  authError, callerFromAccessToken, pool, userById, userJson, type UserRow,
} from '@/lib/native-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const caller = callerFromAccessToken(req)
  if (!caller) return authError(401, '로그인이 필요합니다', 'no_authorization')

  const user = await userById(caller.sub)
  if (!user) return authError(401, '계정을 찾을 수 없습니다', 'user_not_found')

  return NextResponse.json(userJson(user))
}

export async function PUT(req: Request) {
  const caller = callerFromAccessToken(req)
  if (!caller) return authError(401, '로그인이 필요합니다', 'no_authorization')

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return authError(400, '요청 형식이 올바르지 않습니다', 'bad_json')
  }

  try {
    let user = await userById(caller.sub)
    if (!user) return authError(401, '계정을 찾을 수 없습니다', 'user_not_found')

    if (typeof body.password === 'string' && body.password) {
      if (body.password.length < 6) {
        return authError(422, '비밀번호는 6자 이상이어야 합니다', 'weak_password')
      }
      // 이 함수는 기존 갱신 토큰을 모두 버린다. 다른 기기의 세션이 끊긴다.
      const { rows } = await pool().query<UserRow>('select * from auth.set_password($1, $2)', [
        caller.sub, body.password,
      ])
      user = rows[0] ?? user
    }

    if (typeof body.email === 'string' && body.email.trim()) {
      const { rows } = await pool().query<UserRow>('select * from auth.set_email($1, $2)', [
        caller.sub, body.email.trim(),
      ])
      user = rows[0] ?? user
    }

    return NextResponse.json(userJson(user))
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (/duplicate key|unique/i.test(message)) {
      return authError(422, '이미 등록된 이메일입니다', 'email_exists')
    }
    console.error('[auth] PUT /user 실패:', err)
    return authError(400, '변경 중 오류가 발생했습니다', 'internal')
  }
}
