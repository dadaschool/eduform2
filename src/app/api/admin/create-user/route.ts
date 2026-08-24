import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

/**
 * 관리자가 교사·학생 계정을 만든다. 엑셀 일괄 등록과 수동 입력이 함께 쓴다.
 *
 * 교사용과 학생용을 따로 두면 거의 같은 코드가 두 벌이 된다. 역할만 다르고
 * 학생일 때 반과 학번이 더 붙는다.
 *
 * auth 사용자와 profiles 행을 반드시 함께 만든다. profiles 를 빼먹으면
 * 로그인은 되는데 화면에 못 들어간다(예전에는 무한 리다이렉트였다).
 * 그래서 profiles 삽입이 실패하면 만든 auth 사용자를 되돌린다.
 */
export async function POST(req: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 })

    const { data: me } = await supabase.from('profiles').select('is_admin').eq('id', user.id).single()
    if (!me?.is_admin) return NextResponse.json({ error: '관리자만 등록할 수 있습니다' }, { status: 403 })

    const { name, email, password, role, classId, studentNumber } = await req.json()

    if (!name || !email) return NextResponse.json({ error: '이름과 이메일은 필수입니다' }, { status: 400 })
    if (role !== 'teacher' && role !== 'student') {
      return NextResponse.json({ error: '역할은 teacher 또는 student 여야 합니다' }, { status: 400 })
    }
    if (!password || String(password).length < 6) {
      return NextResponse.json({ error: '비밀번호는 6자 이상이어야 합니다' }, { status: 400 })
    }

    const adminClient = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )

    // 학생이면 반의 담임을 담당 교사로 기록한다. 담임이 없으면 비워 둔다.
    // 접근 판단은 class_teachers 를 거치므로 이 값은 담임 표시용이다.
    let homeroomTeacherId: string | null = null
    if (role === 'student') {
      if (!classId) return NextResponse.json({ error: '학생은 반을 지정해야 합니다' }, { status: 400 })
      const { data: hr } = await adminClient
        .from('class_teachers')
        .select('teacher_id')
        .eq('class_id', classId)
        .eq('role', 'homeroom')
        .maybeSingle()
      homeroomTeacherId = hr?.teacher_id ?? null
    }

    const profileRow = role === 'student'
      ? { email, name, role, class_id: classId, teacher_id: homeroomTeacherId, student_number: studentNumber || null }
      : { email, name, role }

    // 같은 이메일이 이미 있으면 비밀번호만 바꾼다 (명단을 다시 올릴 때를 위해)
    //
    // ⚠ listUsers() 는 기본값이 «1쪽 50명» 이다. 학교 인원은 50명을 쉽게 넘으므로
    //   목록만 뒤지면 51번째 사람부터 «없는 사람» 으로 보이고, 이어서 계정 생성이
    //   «이미 등록된 이메일» 로 실패한다. 그래서 profiles 를 먼저 본다 —
    //   여기엔 이메일이 그대로 있고 인원 수와 무관하게 정확하다.
    const { data: byProfile } = await adminClient
      .from('profiles')
      .select('id')
      .eq('email', email)
      .maybeSingle()

    let existing: { id: string } | null = byProfile ?? null

    // profiles 에 없더라도 auth 쪽에만 남아 있을 수 있다 (계정은 만들어졌는데
    // 프로필 생성이 실패한 경우). 그때만 목록을 뒤진다. 넉넉한 쪽수로 부른다.
    if (!existing) {
      const { data: existingUsers } = await adminClient.auth.admin.listUsers({ page: 1, perPage: 1000 })
      const found = existingUsers?.users?.find(u => u.email === email)
      existing = found ? { id: found.id } : null
    }

    if (existing) {
      await adminClient.auth.admin.updateUserById(existing.id, { password })

      const { data: prof } = await adminClient.from('profiles').select('role').eq('id', existing.id).single()
      if (!prof) {
        const { error } = await adminClient.from('profiles').insert({ id: existing.id, ...profileRow })
        if (error) return NextResponse.json({ error: error.message }, { status: 400 })
        return NextResponse.json({ success: true, userId: existing.id, repaired: true })
      }
      if (prof.role !== role) {
        const label = { teacher: '교사', student: '학생' }[prof.role as 'teacher' | 'student']
        return NextResponse.json({ error: `이미 ${label} 계정입니다` }, { status: 409 })
      }
      return NextResponse.json({ success: true, userId: existing.id, updated: true })
    }

    const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
      email, password, email_confirm: true,
    })
    if (authError) return NextResponse.json({ error: authError.message }, { status: 400 })

    const { error: profileError } = await adminClient
      .from('profiles')
      .insert({ id: authData.user.id, ...profileRow })
    if (profileError) {
      await adminClient.auth.admin.deleteUser(authData.user.id)
      return NextResponse.json({ error: profileError.message }, { status: 400 })
    }

    return NextResponse.json({ success: true, userId: authData.user.id })
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : '서버 오류' }, { status: 500 })
  }
}
