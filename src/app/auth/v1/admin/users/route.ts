/**
 * POST /auth/v1/admin/users — 계정 만들기 (관리자 엑셀 업로드·직접 입력)
 * GET  /auth/v1/admin/users — 계정 목록
 *
 * service_role 키로만 들어올 수 있다. 그 키는 서버에만 두고 브라우저로 절대
 * 내보내지 않는다 — 이 경로가 열리면 RLS 를 통째로 우회하게 된다.
 */
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { authError, isServiceRole, pool, userJson, type UserRow } from '@/lib/native-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * 목록 기본 개수.
 *
 * GoTrue 기본값은 50 인데, 앱은 «이 이메일이 이미 있나» 를 목록에서 찾는 데
 * 쓴다. 학교 인원은 50명을 쉽게 넘으므로 기본값이 작으면 51번째 사람부터
 * 명단을 다시 올릴 때 «이미 등록된 이메일» 로 실패한다. 넉넉하게 둔다.
 */
const DEFAULT_PER_PAGE = 1000

export async function POST(req: NextRequest) {
  if (!isServiceRole(req)) return authError(401, '관리자 권한이 필요합니다', 'not_admin')

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return authError(400, '요청 형식이 올바르지 않습니다', 'bad_json')
  }

  const email = typeof body.email === 'string' ? body.email.trim() : ''
  const password = typeof body.password === 'string' ? body.password : ''
  if (!email || !password) return authError(400, '이메일과 비밀번호가 필요합니다', 'validation_failed')
  if (password.length < 6) {
    return authError(422, '비밀번호는 6자 이상이어야 합니다', 'weak_password')
  }

  // email_confirm 이 false 로 와도 확인 처리한다. 교내망에는 메일 서버가 없어
  // 확인 메일을 기다리면 아무도 로그인하지 못한다.
  try {
    const { rows } = await pool().query<UserRow>(
      'select * from auth.create_user($1, $2, true, $3)',
      [email, password, JSON.stringify(body.user_metadata ?? {})]
    )
    return NextResponse.json(userJson(rows[0]))
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (/duplicate key|unique/i.test(message)) {
      return authError(422, '이미 등록된 이메일입니다', 'email_exists')
    }
    console.error('[auth] POST /admin/users 실패:', err)
    return authError(400, '계정 생성 중 오류가 발생했습니다', 'internal')
  }
}

export async function GET(req: NextRequest) {
  if (!isServiceRole(req)) return authError(401, '관리자 권한이 필요합니다', 'not_admin')

  const q = req.nextUrl.searchParams
  const page = Math.max(1, Number(q.get('page')) || 1)
  const perPage = Math.min(10000, Math.max(1, Number(q.get('per_page')) || DEFAULT_PER_PAGE))

  try {
    const { rows: totalRows } = await pool().query<{ n: string }>('select count(*) n from auth.users')
    const total = Number(totalRows[0].n)

    const { rows } = await pool().query<UserRow>(
      'select * from auth.users order by created_at, id limit $1 offset $2',
      [perPage, (page - 1) * perPage]
    )

    return NextResponse.json(
      { users: rows.map(userJson), aud: 'authenticated' },
      { headers: { 'x-total-count': String(total) } }
    )
  } catch (err) {
    console.error('[auth] GET /admin/users 실패:', err)
    return authError(400, '목록을 불러오지 못했습니다', 'internal')
  }
}
