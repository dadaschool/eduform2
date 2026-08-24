/**
 * GET    /auth/v1/admin/users/{id}
 * PUT    /auth/v1/admin/users/{id}  — 비밀번호 초기화가 주 용도
 * DELETE /auth/v1/admin/users/{id}
 *
 * 교내망에는 메일 서버가 없어 «비밀번호 찾기» 메일을 보낼 수 없다. 그래서
 * 관리자가 같은 이메일로 다시 등록하면 비밀번호가 갱신되는 경로가 사실상
 * 비밀번호 초기화 수단이다. 그 흐름이 이 PUT 을 쓴다.
 */
import { NextResponse } from 'next/server'
import { authError, isServiceRole, pool, userById, userJson, type UserRow } from '@/lib/native-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(req: Request, { params }: { params: { id: string } }) {
  if (!isServiceRole(req)) return authError(401, '관리자 권한이 필요합니다', 'not_admin')
  if (!UUID.test(params.id)) return authError(400, '사용자 id 형식이 아닙니다', 'validation_failed')

  const user = await userById(params.id)
  if (!user) return authError(404, '계정을 찾을 수 없습니다', 'user_not_found')
  return NextResponse.json(userJson(user))
}

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  if (!isServiceRole(req)) return authError(401, '관리자 권한이 필요합니다', 'not_admin')
  if (!UUID.test(params.id)) return authError(400, '사용자 id 형식이 아닙니다', 'validation_failed')

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return authError(400, '요청 형식이 올바르지 않습니다', 'bad_json')
  }

  try {
    let user = await userById(params.id)
    if (!user) return authError(404, '계정을 찾을 수 없습니다', 'user_not_found')

    if (typeof body.password === 'string' && body.password) {
      if (body.password.length < 6) {
        return authError(422, '비밀번호는 6자 이상이어야 합니다', 'weak_password')
      }
      const { rows } = await pool().query<UserRow>('select * from auth.set_password($1, $2)', [
        params.id, body.password,
      ])
      user = rows[0] ?? user
    }

    if (typeof body.email === 'string' && body.email.trim()) {
      const { rows } = await pool().query<UserRow>('select * from auth.set_email($1, $2)', [
        params.id, body.email.trim(),
      ])
      user = rows[0] ?? user
    }

    if (typeof body.ban_duration === 'string') {
      // 'none' 이면 정지 해제. 그 밖에는 Postgres interval 로 넘긴다.
      if (body.ban_duration === 'none') {
        await pool().query('update auth.users set banned_until = null where id = $1', [params.id])
      } else {
        await pool().query(
          'update auth.users set banned_until = now() + $2::interval where id = $1',
          [params.id, body.ban_duration]
        )
      }
      user = (await userById(params.id)) ?? user
    }

    return NextResponse.json(userJson(user))
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (/duplicate key|unique/i.test(message)) {
      return authError(422, '이미 등록된 이메일입니다', 'email_exists')
    }
    console.error('[auth] PUT /admin/users/[id] 실패:', err)
    return authError(400, '변경 중 오류가 발생했습니다', 'internal')
  }
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  if (!isServiceRole(req)) return authError(401, '관리자 권한이 필요합니다', 'not_admin')
  if (!UUID.test(params.id)) return authError(400, '사용자 id 형식이 아닙니다', 'validation_failed')

  try {
    const user = await userById(params.id)
    if (!user) return authError(404, '계정을 찾을 수 없습니다', 'user_not_found')

    // profiles 와 그 아래 기록은 on delete cascade 로 함께 지워진다.
    await pool().query('delete from auth.users where id = $1', [params.id])
    return NextResponse.json(userJson(user))
  } catch (err) {
    console.error('[auth] DELETE /admin/users/[id] 실패:', err)
    return authError(400, '삭제 중 오류가 발생했습니다', 'internal')
  }
}
