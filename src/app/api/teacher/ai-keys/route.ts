import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { encryptKey, keyHint } from '@/lib/ai-crypto'
import { verifyKey } from '@/lib/ai'
import type { AIProvider } from '@/lib/ai'

/**
 * 교사가 «자기» AI API 키를 관리한다.
 *
 *   GET    내 키 목록 — provider · priority · hint(끝 4자리) · updated_at 만.
 *          암호문도 원본도 절대 내려보내지 않는다.
 *   PUT    { provider, apiKey } — 실제 호출로 검증한 뒤 암호화해 저장(upsert).
 *   DELETE { provider }         — 그 키 삭제.
 *   PATCH  { order: [...] }      — 폴백 순서(priority) 재정렬.
 *
 * 쓰기는 service_role 로 한다. RLS 도 켜져 있지만(이중 방어), 여기서 신원은
 * 쿠키 세션(auth.getUser)으로 확인하고 teacher_id 를 서버가 박는다 — 본문으로
 * 받지 않는다.
 */

const PROVIDERS: AIProvider[] = ['upstage', 'gemini', 'openai']

function admin() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

async function requireTeacher() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: '인증 필요' }, { status: 401 }) }
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle()
  if (profile?.role !== 'teacher') return { error: NextResponse.json({ error: '권한 없음' }, { status: 403 }) }
  return { userId: user.id }
}

export async function GET() {
  const auth = await requireTeacher()
  if (auth.error) return auth.error

  const { data, error } = await admin()
    .from('teacher_ai_keys')
    .select('provider, hint, priority, updated_at')
    .eq('teacher_id', auth.userId)
    .order('priority', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ keys: data ?? [] })
}

export async function PUT(req: Request) {
  const auth = await requireTeacher()
  if (auth.error) return auth.error

  const { provider, apiKey } = await req.json().catch(() => ({}))
  if (!PROVIDERS.includes(provider)) {
    return NextResponse.json({ error: '알 수 없는 provider' }, { status: 400 })
  }
  const key = typeof apiKey === 'string' ? apiKey.trim() : ''
  if (!key) return NextResponse.json({ error: 'API 키를 입력하세요' }, { status: 400 })

  // 저장 전에 실제로 불러 본다. 잘못된 키를 미리 걸러낸다.
  try {
    await verifyKey(provider, key)
  } catch (err) {
    return NextResponse.json(
      { error: `키 확인 실패 — ${err instanceof Error ? err.message : String(err)}` },
      { status: 400 }
    )
  }

  const db = admin()

  // priority — 이미 있던 키면 순서 유지, 새 키면 맨 뒤로.
  const { data: existing } = await db
    .from('teacher_ai_keys')
    .select('provider, priority')
    .eq('teacher_id', auth.userId)
  const mine = existing ?? []
  const prev = mine.find(r => r.provider === provider)
  const priority = prev
    ? prev.priority
    : mine.reduce((max, r) => Math.max(max, r.priority), -1) + 1

  const { error } = await db.from('teacher_ai_keys').upsert({
    teacher_id: auth.userId,
    provider,
    api_key_enc: encryptKey(key),
    hint: keyHint(key),
    priority,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, provider, hint: keyHint(key), priority })
}

export async function DELETE(req: Request) {
  const auth = await requireTeacher()
  if (auth.error) return auth.error

  const { provider } = await req.json().catch(() => ({}))
  if (!PROVIDERS.includes(provider)) {
    return NextResponse.json({ error: '알 수 없는 provider' }, { status: 400 })
  }

  const { error } = await admin()
    .from('teacher_ai_keys')
    .delete()
    .eq('teacher_id', auth.userId)
    .eq('provider', provider)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}

export async function PATCH(req: Request) {
  const auth = await requireTeacher()
  if (auth.error) return auth.error

  const { order } = await req.json().catch(() => ({}))
  if (!Array.isArray(order) || order.some(p => !PROVIDERS.includes(p))) {
    return NextResponse.json({ error: 'order 형식 오류' }, { status: 400 })
  }

  const db = admin()
  // 등록된 키만 대상으로, 넘어온 순서대로 0,1,2… 를 매긴다.
  for (let i = 0; i < order.length; i++) {
    const { error } = await db
      .from('teacher_ai_keys')
      .update({ priority: i })
      .eq('teacher_id', auth.userId)
      .eq('provider', order[i])
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
