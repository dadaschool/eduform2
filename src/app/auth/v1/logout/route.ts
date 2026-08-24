/**
 * POST /auth/v1/logout — 로그아웃.
 *
 * 클라이언트는 쿠키를 지우고 이 경로를 부른다. 서버에서도 갱신 토큰을 버려야
 * 한다. 그러지 않으면 남아 있는 갱신 토큰으로 세션을 되살릴 수 있다.
 *
 * 토큰이 이미 만료됐거나 이상해도 «성공» 으로 답한다. 로그아웃이 실패해서
 * 화면에 머무는 것이 더 나쁘다.
 */
import { NextResponse } from 'next/server'
import { pool, verifyJwt, bearer } from '@/lib/native-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const claims = verifyJwt(bearer(req))
  if (claims?.sub && claims.role === 'authenticated') {
    try {
      await pool().query('select auth.revoke_user_tokens($1)', [claims.sub])
    } catch (err) {
      console.error('[auth] /logout 토큰 폐기 실패:', err)
    }
  }
  return new NextResponse(null, { status: 204 })
}
