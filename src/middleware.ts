import { NextResponse, type NextRequest } from 'next/server'
import { hasSupabaseEnv } from '@/lib/supabase/env'
import { updateSession } from '@/lib/supabase/middleware'

export async function middleware(request: NextRequest) {
  // 환경변수가 없는 환경(빌드 검증 등)에서 500을 내지 않도록 조용히 통과시킨다.
  if (!hasSupabaseEnv()) return NextResponse.next()

  try {
    return await updateSession(request)
  } catch {
    // 세션 갱신 실패가 사이트 전체를 500으로 만들지 않게 한다.
    // 인증 검사는 각 레이아웃이 서버에서 하므로 여기서 통과시켜도 안전하다.
    return NextResponse.next()
  }
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
