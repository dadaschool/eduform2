/**
 * POST /api/account/password — 내 비밀번호 바꾸기 (첫 로그인 변경 · 내 정보 · 내 계정)
 *
 *   { current, next }
 *
 * 지금 비밀번호를 다시 확인한다. 자리를 비운 사이 다른 사람이 열린 화면에서
 * 비밀번호를 바꿔 계정을 빼앗지 못하게 하려는 것이다. 확인은 로그인과 같은
 * auth.sign_in 을 써서 «틀린 횟수 → 잠금» 도 똑같이 걸린다.
 *
 * 바꾸면 그 계정의 다른 세션은 모두 끊긴다 (auth.set_password). 이 화면은 이어서
 * 새 비밀번호로 다시 로그인해 세션을 새로 받는다.
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { pool, policyContext } from '@/lib/native-auth'
import { checkOwnPassword } from '@/lib/password-policy'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) return NextResponse.json({ error: '로그인이 필요합니다' }, { status: 401 })

  let current = ''
  let next = ''
  try {
    const body = await req.json()
    current = typeof body.current === 'string' ? body.current : ''
    next = typeof body.next === 'string' ? body.next : ''
  } catch {
    return NextResponse.json({ error: '요청 형식이 올바르지 않습니다' }, { status: 400 })
  }
  if (!current || !next) return NextResponse.json({ error: '지금 비밀번호와 새 비밀번호를 입력하세요' }, { status: 400 })
  if (current === next) return NextResponse.json({ error: '지금과 다른 비밀번호를 정하세요' }, { status: 400 })

  const ctx = await policyContext(user.id, user.email)
  const why = checkOwnPassword(next, ctx)
  if (why) return NextResponse.json({ error: why }, { status: 422 })

  try {
    const { rows } = await pool().query<{ status: string; user_id: string | null; retry_after: number }>(
      'select * from auth.sign_in($1, $2, $3)', [user.email, current, null]
    )
    const r = rows[0]
    if (r?.status === 'locked') {
      return NextResponse.json({
        error: `여러 번 틀려 잠시 잠겼습니다. ${Math.max(1, Math.ceil(r.retry_after / 60))}분 뒤에 다시 하세요`,
      }, { status: 429 })
    }
    if (r?.status !== 'ok' || r.user_id !== user.id) {
      return NextResponse.json({ error: '지금 비밀번호가 맞지 않습니다' }, { status: 400 })
    }

    await pool().query('select auth.set_password($1, $2)', [user.id, next])
    await pool().query('select auth.set_password_temp($1, false)', [user.id])
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[account/password] 실패:', err)
    return NextResponse.json({ error: '비밀번호를 바꾸지 못했습니다' }, { status: 500 })
  }
}
