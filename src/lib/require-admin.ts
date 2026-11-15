// 서버 전용 — API 라우트에서 «관리자인가» 를 확인한다.
import { createClient } from '@/lib/supabase/server'
import { pool } from '@/lib/native-auth'

export type AdminCheck =
  | { ok: true; userId: string }
  | { ok: false; status: 401 | 403; error: string }

/**
 * 로그인한 관리자만 통과시킨다.
 *
 * 누구인지는 세션(쿠키 → /auth/v1/user)으로, 관리자인지는 DB 를 직접 본다.
 * 이 함수를 쓰는 기능(외부용 명단 · 연동 프로그램 · 로그인 보안)은 모두
 * 교내 서버(Postgres 직접 연결) 전용이라 같은 연결을 쓴다.
 */
export async function requireAdmin(): Promise<AdminCheck> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, status: 401, error: '로그인이 필요합니다' }
  try {
    const { rows } = await pool().query<{ is_admin: boolean }>(
      'select is_admin from public.profiles where id = $1', [user.id]
    )
    if (rows[0]?.is_admin !== true) return { ok: false, status: 403, error: '관리자만 할 수 있습니다' }
  } catch {
    return { ok: false, status: 403, error: '관리자만 할 수 있습니다' }
  }
  return { ok: true, userId: user.id }
}
