/**
 * GET /sso/jwks — 학교 계정 서버의 «공개» 열쇠 (JWKS)
 *
 * 다른 프로그램이 에듀폼2 증명(id_token)의 서명을 확인할 때 쓴다.
 * 공개 열쇠라 누구에게 보여도 된다 (이것으로는 증명을 만들 수 없다).
 */
import { NextResponse } from 'next/server'
import { publicJwks } from '@/lib/sso'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    return NextResponse.json(await publicJwks(), {
      headers: { 'Cache-Control': 'public, max-age=300', 'Access-Control-Allow-Origin': '*' },
    })
  } catch (err) {
    console.error('[sso] jwks 실패:', err)
    return NextResponse.json({ error: '열쇠를 읽지 못했습니다' }, { status: 500 })
  }
}
