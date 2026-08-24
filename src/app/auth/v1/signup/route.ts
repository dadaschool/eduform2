/**
 * POST /auth/v1/signup — 초대코드 가입 화면이 쓰는 경로.
 *
 * 가입만 시킨다. 역할(교사/학생)은 여기서 정하지 않는다 — 가입 직후 화면이
 * register_with_invite RPC 를 부르고, 그 함수가 초대코드에 적힌 역할을 준다.
 * 신청자가 자기 역할을 고를 수 없게 만든 구조이므로 여기서도 손대지 않는다.
 */
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { pool, authError, startSession, type UserRow } from '@/lib/native-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GoTrue 기본값과 같게 둔다. 관리자 엑셀 업로드 화면도 6자로 검사한다. */
const MIN_PASSWORD = 6

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return authError(400, '요청 형식이 올바르지 않습니다', 'bad_json')
  }

  const email = typeof body.email === 'string' ? body.email.trim() : ''
  const password = typeof body.password === 'string' ? body.password : ''

  if (!email || !password) return authError(400, '이메일과 비밀번호를 입력하세요', 'validation_failed')
  if (password.length < MIN_PASSWORD) {
    return authError(422, `비밀번호는 ${MIN_PASSWORD}자 이상이어야 합니다`, 'weak_password')
  }

  try {
    const { rows } = await pool().query<UserRow>(
      'select * from auth.create_user($1, $2, true, $3)',
      [email, password, JSON.stringify(body.data ?? {})]
    )
    return NextResponse.json(await startSession(rows[0]))
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // unique 위반 = 이미 있는 이메일
    if (/duplicate key|unique/i.test(message)) {
      return authError(422, '이미 등록된 이메일입니다', 'email_exists')
    }
    console.error('[auth] /signup 실패:', err)
    return authError(400, '가입 처리 중 오류가 발생했습니다', 'internal')
  }
}
