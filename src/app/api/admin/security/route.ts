/**
 * 로그인 보안 — 관리자만
 *
 * GET               → 잠긴 계정 · 최근 24시간 실패가 많은 계정 · 임시 비밀번호 계정 수
 * POST { userId }   → 잠금 풀기
 *
 * 로그인 기록에는 비밀번호가 없다 (auth.login_events).
 */
import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/require-admin'
import { audit, pool } from '@/lib/native-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const a = await requireAdmin()
  if (!a.ok) return NextResponse.json({ error: a.error }, { status: a.status })

  const [locked, failures, temp] = await Promise.all([
    pool().query(
      `select u.id, u.email, p.name, p.role, p.student_number, u.locked_until
         from auth.users u left join public.profiles p on p.id = u.id
        where u.locked_until > now() order by u.locked_until desc`
    ),
    pool().query(
      `select e.email, p.name, count(*)::int as fails, max(e.at) as last_at,
              bool_or(e.result = 'no_user') as unknown_email
         from auth.login_events e left join public.profiles p on p.id = e.user_id
        where e.at > now() - interval '24 hours' and e.result in ('bad_password', 'no_user', 'locked')
        group by e.email, p.name order by fails desc limit 20`
    ),
    pool().query(`select count(*)::int as n from auth.users where password_temp`),
  ])
  return NextResponse.json({
    locked: locked.rows, failures: failures.rows, tempCount: temp.rows[0]?.n ?? 0,
  }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(req: Request) {
  const a = await requireAdmin()
  if (!a.ok) return NextResponse.json({ error: a.error }, { status: a.status })
  let userId = ''
  try { userId = String((await req.json()).userId ?? '') } catch { /* 아래에서 거절 */ }
  if (!/^[0-9a-f-]{36}$/i.test(userId)) return NextResponse.json({ error: '사용자 id 가 올바르지 않습니다' }, { status: 400 })
  await pool().query('select auth.unlock_user($1)', [userId])
  await audit(a.userId, 'security.unlock', { user_id: userId })
  return NextResponse.json({ ok: true })
}
