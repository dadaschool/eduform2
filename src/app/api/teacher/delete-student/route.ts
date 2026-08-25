import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { checkStudentAccess } from '@/lib/student-permission'

/**
 * 학생 계정을 지운다. 담임 교사와 관리자만.
 *
 * profiles 만 지우면 로그인 계정(auth.users)이 남는다. 그 학생은 계속
 * 로그인되면서 «계정 등록이 완료되지 않았습니다» 화면만 보게 된다.
 * 그래서 auth 쪽을 지운다 — profiles 와 그 아래 기록은 on delete cascade 로
 * 함께 사라진다.
 *
 * 🔴 되돌릴 수 없다. 평가·과제·관찰기록이 모두 지워진다.
 */
export async function POST(req: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 })

    const { userId } = await req.json()
    if (!userId) return NextResponse.json({ error: 'userId 필요' }, { status: 400 })
    if (userId === user.id) {
      return NextResponse.json({ error: '자기 계정은 지울 수 없습니다' }, { status: 400 })
    }

    const access = await checkStudentAccess(supabase, user.id, userId)
    if (!access.allowed) {
      return NextResponse.json({ error: access.reason ?? '권한 없음' }, { status: 403 })
    }
    if (!access.canManage) {
      return NextResponse.json(
        { error: '삭제는 담임 교사와 관리자만 할 수 있습니다' }, { status: 403 })
    }

    const adminClient = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )

    const { error } = await adminClient.auth.admin.deleteUser(userId)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    return NextResponse.json({ success: true })
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : '서버 오류' }, { status: 500 })
  }
}
