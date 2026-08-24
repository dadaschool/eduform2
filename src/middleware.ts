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
    // ⚠ auth/v1 과 rest/v1 을 반드시 제외해야 한다.
    //
    // 교내 서버(윈도우) 설치에서는 이 앱이 곧 Supabase 주소다. 미들웨어가
    // updateSession → getUser() 를 부르면 그 요청이 같은 서버의 /auth/v1/user
    // 로 들어오고, 거기서 미들웨어가 또 돌아 무한히 반복된다. 실제로 서버가
    // 멈춘다. 데이터 경로(rest/v1)도 세션 갱신이 필요 없어 함께 뺀다.
    '/((?!auth/v1|rest/v1|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
