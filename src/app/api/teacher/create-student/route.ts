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

    const { name, email, studentNumber, classId, password } = await req.json()
    if (!name || !email || !classId) return NextResponse.json({ error: '필수 값 누락' }, { status: 400 })

    // Supabase Admin Client (Service Role Key 필요)
    const adminClient = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )

    // 동일 이메일 계정이 이미 있으면 비밀번호만 변경
    const { data: existingUsers } = await adminClient.auth.admin.listUsers()
    const existing = existingUsers?.users?.find(u => u.email === email)

    if (existing) {
      await adminClient.auth.admin.updateUserById(existing.id, {
        password: password || 'edu1234',
      })
      return NextResponse.json({ success: true, userId: existing.id, updated: true })
    }

    const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
      email,
      password: password || 'edu1234',
      email_confirm: true,
    })
    if (authError) return NextResponse.json({ error: authError.message }, { status: 400 })

    const { error: profileError } = await adminClient.from('profiles').insert({
      id: authData.user.id,
      email,
      name,
      role: 'student',
      class_id: classId,
      student_number: studentNumber || null,
      teacher_id: user.id,
    })
    if (profileError) {
      await adminClient.auth.admin.deleteUser(authData.user.id)
      return NextResponse.json({ error: profileError.message }, { status: 400 })
    }

    return NextResponse.json({ success: true, userId: authData.user.id })
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : '서버 오류' }, { status: 500 })
  }
}
