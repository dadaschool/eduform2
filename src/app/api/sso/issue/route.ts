/**
 * POST /api/sso/issue — «계속» 을 누르면 증명을 만들어 돌아갈 주소를 준다.
 *
 *   { client_id, redirect_uri, state, nonce }  →  { url }
 *
 * /sso/authorize 화면에서 본 것을 여기서 «전부 다시» 검사한다. 화면 검사는
 * 안내일 뿐이고, 이 요청은 누구나 직접 보낼 수 있다.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { needsPasswordChange } from '@/lib/native-auth'
import { callbackUrl, getClient, issueIdToken, issuerFor, redirectAllowed, requestOrigin, validOpaque } from '@/lib/sso'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  // 다른 사이트가 이 주소로 몰래 요청을 보내지 못하게 — 같은 사이트에서 온 JSON 만 받는다.
  const origin = req.headers.get('origin')
  const self = requestOrigin(req)
  if (origin && origin !== self) {
    return NextResponse.json({ error: '허용되지 않은 요청입니다' }, { status: 403 })
  }
  if (!(req.headers.get('content-type') ?? '').includes('application/json')) {
    return NextResponse.json({ error: '요청 형식이 올바르지 않습니다' }, { status: 415 })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다' }, { status: 401 })
  if (await needsPasswordChange(user.id)) {
    return NextResponse.json({ error: '먼저 비밀번호를 바꿔야 합니다' }, { status: 403 })
  }

  let b: Record<string, unknown>
  try { b = await req.json() } catch { return NextResponse.json({ error: '요청 형식이 올바르지 않습니다' }, { status: 400 }) }

  const clientId = typeof b.client_id === 'string' ? b.client_id : ''
  const redirectUri = typeof b.redirect_uri === 'string' ? b.redirect_uri : ''
  if (!validOpaque(b.state) || !validOpaque(b.nonce)) {
    return NextResponse.json({ error: 'state · nonce 가 올바르지 않습니다' }, { status: 400 })
  }

  try {
    const client = await getClient(clientId)
    if (!client || !client.enabled) return NextResponse.json({ error: '등록되지 않은 프로그램입니다' }, { status: 400 })
    if (!redirectAllowed(client, redirectUri)) {
      return NextResponse.json({ error: '등록되지 않은 돌아갈 주소입니다' }, { status: 400 })
    }
    const idToken = await issueIdToken({
      client, userId: user.id, nonce: b.nonce, issuer: issuerFor(self),
    })
    return NextResponse.json(
      { url: callbackUrl(redirectUri, { id_token: idToken, state: b.state }) },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : '증명을 만들지 못했습니다'
    console.error('[sso] issue 실패:', err)
    return NextResponse.json({ error: msg }, { status: 400 })
  }
}
