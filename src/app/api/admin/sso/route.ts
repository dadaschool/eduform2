/**
 * 연동 프로그램 관리 (학교 계정 서버) — 관리자만
 *
 * GET                                   → 프로그램 목록 + 공개 열쇠
 * POST { action: 'save', client_id, name, redirect_uris, roles, enabled }
 * POST { action: 'rotate' }             → 서명 열쇠 바꾸기
 * DELETE ?client_id=
 */
import { NextResponse, type NextRequest } from 'next/server'
import { requireAdmin } from '@/lib/require-admin'
import { audit, pool } from '@/lib/native-auth'
import { publicJwks, rotateKey, validRedirectUri } from '@/lib/sso'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const a = await requireAdmin()
  if (!a.ok) return NextResponse.json({ error: a.error }, { status: a.status })
  const { rows } = await pool().query(
    `select c.client_id, c.name, c.redirect_uris, c.roles, c.enabled, c.created_at,
            (select max(at) from auth.sso_events e where e.client_id = c.client_id) as last_used,
            (select count(*)::int from auth.sso_events e
              where e.client_id = c.client_id and e.at > now() - interval '30 days') as uses_30d
       from auth.sso_clients c order by c.created_at`
  )
  return NextResponse.json({ clients: rows, jwks: await publicJwks() }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(req: NextRequest) {
  const a = await requireAdmin()
  if (!a.ok) return NextResponse.json({ error: a.error }, { status: a.status })
  let b: Record<string, unknown>
  try { b = await req.json() } catch { return NextResponse.json({ error: '요청 형식이 올바르지 않습니다' }, { status: 400 }) }

  if (b.action === 'rotate') {
    const jwk = await rotateKey()
    await audit(a.userId, 'sso.rotate_key', { kid: jwk.kid })
    return NextResponse.json({ ok: true, kid: jwk.kid })
  }

  if (b.action !== 'save') return NextResponse.json({ error: '알 수 없는 작업입니다' }, { status: 400 })

  const clientId = typeof b.client_id === 'string' ? b.client_id.trim() : ''
  const name = typeof b.name === 'string' ? b.name.trim() : ''
  const uris = Array.isArray(b.redirect_uris)
    ? [...new Set(b.redirect_uris.filter((x): x is string => typeof x === 'string').map(s => s.trim()).filter(Boolean))]
    : []
  const roles = Array.isArray(b.roles) ? b.roles.filter((r): r is string => r === 'student' || r === 'teacher') : []
  const enabled = b.enabled !== false

  if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(clientId)) {
    return NextResponse.json({ error: '프로그램 ID 는 영문 소문자·숫자·- 로 2~40자입니다 (예: pycoding)' }, { status: 400 })
  }
  if (!name) return NextResponse.json({ error: '이름을 입력하세요' }, { status: 400 })
  if (uris.length === 0) return NextResponse.json({ error: '돌아갈 주소를 하나 이상 입력하세요' }, { status: 400 })
  const bad = uris.filter(u => !validRedirectUri(u))
  if (bad.length) return NextResponse.json({ error: `주소 형식이 아닙니다 (http(s)://… , # 없이): ${bad.join(', ')}` }, { status: 400 })
  // 학교 밖으로 증명을 보내는 주소는 https 만 — 길에서 엿볼 수 없게
  const insecure = uris.filter(u => u.startsWith('http://') && !/^http:\/\/(localhost|127\.0\.0\.1|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(u))
  if (insecure.length) return NextResponse.json({ error: `학교 밖 주소는 https 여야 합니다: ${insecure.join(', ')}` }, { status: 400 })
  if (roles.length === 0) return NextResponse.json({ error: '들어올 수 있는 역할을 하나 이상 고르세요' }, { status: 400 })

  await pool().query(
    `insert into auth.sso_clients (client_id, name, redirect_uris, roles, enabled)
     values ($1, $2, $3, $4, $5)
     on conflict (client_id) do update
       set name = excluded.name, redirect_uris = excluded.redirect_uris, roles = excluded.roles,
           enabled = excluded.enabled, updated_at = now()`,
    [clientId, name, uris, roles, enabled]
  )
  await audit(a.userId, 'sso.save_client', { client_id: clientId, redirect_uris: uris, roles, enabled })
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const a = await requireAdmin()
  if (!a.ok) return NextResponse.json({ error: a.error }, { status: a.status })
  const clientId = req.nextUrl.searchParams.get('client_id') ?? ''
  await pool().query('delete from auth.sso_clients where client_id = $1', [clientId])
  await audit(a.userId, 'sso.delete_client', { client_id: clientId })
  return NextResponse.json({ ok: true })
}
