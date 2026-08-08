import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

export async function POST(req: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 })

    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
    if (profile?.role !== 'teacher') return NextResponse.json({ error: '권한 없음' }, { status: 403 })

    const { userId, password, email } = await req.json()
    if (!userId) return NextResponse.json({ error: 'userId 필요' }, { status: 400 })

    const adminClient = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )

    if (email) {
      // 이메일 변경
      const { error } = await adminClient.auth.admin.updateUserById(userId, { email })
      if (error) return NextResponse.json({ error: error.message }, { status: 400 })
      // profiles 테이블도 동기화
      await supabase.from('profiles').update({ email }).eq('id', userId)
      return NextResponse.json({ success: true })
    }

    if (password) {
      if (password.length < 6)
        return NextResponse.json({ error: '비밀번호는 6자 이상이어야 합니다.' }, { status: 400 })
      const { error } = await adminClient.auth.admin.updateUserById(userId, { password })
      if (error) return NextResponse.json({ error: error.message }, { status: 400 })
      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ error: 'password 또는 email 필요' }, { status: 400 })
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : '서버 오류' }, { status: 500 })
  }
}
