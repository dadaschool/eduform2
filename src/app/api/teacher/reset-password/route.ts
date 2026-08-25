import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { checkStudentAccess } from '@/lib/student-permission'

/**
 * 학생의 비밀번호·이메일을 고친다.
 *
 * 🔴 이 라우트는 service_role 을 쓴다 — RLS 를 «무시한다». 그래서 여기서
 *    관계를 직접 확인해야 한다. 예전에는 «교사인지» 만 보고 통과시켰고,
 *    그래서 아무 교사나 userId 만 바꿔 보내면 다른 교사나 관리자의
 *    비밀번호까지 바꿀 수 있었다.
 *
 * 담임 · 교과 담당 · 관리자 모두 «비밀번호 초기화» 는 할 수 있다.
 * 이메일 변경은 되돌리기 번거로워 담임과 관리자만 한다.
 */
export async function POST(req: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 })

    const { userId, password, email } = await req.json()
    if (!userId) return NextResponse.json({ error: 'userId 필요' }, { status: 400 })

    const access = await checkStudentAccess(supabase, user.id, userId)
    if (!access.allowed) {
      return NextResponse.json({ error: access.reason ?? '권한 없음' }, { status: 403 })
    }

    const adminClient = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )

    if (email) {
      if (!access.canManage) {
        return NextResponse.json(
          { error: '이메일 변경은 담임 교사와 관리자만 할 수 있습니다' }, { status: 403 })
      }
      const { error } = await adminClient.auth.admin.updateUserById(userId, { email })
      if (error) return NextResponse.json({ error: error.message }, { status: 400 })
      // profiles 쪽도 맞춰 둔다. 어긋나면 명단에 옛 이메일이 계속 보인다.
      await adminClient.from('profiles').update({ email }).eq('id', userId)
      return NextResponse.json({ success: true })
    }

    if (password) {
      if (String(password).length < 6) {
        return NextResponse.json({ error: '비밀번호는 6자 이상이어야 합니다.' }, { status: 400 })
      }
      const { error } = await adminClient.auth.admin.updateUserById(userId, { password })
      if (error) return NextResponse.json({ error: error.message }, { status: 400 })
      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ error: 'password 또는 email 필요' }, { status: 400 })
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : '서버 오류' }, { status: 500 })
  }
}
