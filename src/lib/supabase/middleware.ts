import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { getSupabaseEnv } from './env'

/**
 * 만료된 액세스 토큰을 갱신하고 새 쿠키를 응답에 실어 보낸다.
 *
 * 서버 컴포넌트에서는 쿠키를 쓸 수 없어(server.ts 의 try/catch 참고)
 * 토큰 갱신을 여기서 해야 한다. 이게 없으면 사용 중에 세션이 만료되어
 * 갑자기 로그인 화면으로 튕긴다.
 *
 * 접근 권한 검사는 하지 않는다. 그건 (teacher)/(student) 레이아웃이
 * 서버에서 getUser() 로 처리하므로, 여기서 중복하면 실패 지점만 늘어난다.
 */
export async function updateSession(request: NextRequest) {
  const { url, anonKey } = getSupabaseEnv()

  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
        supabaseResponse = NextResponse.next({ request })
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options)
        )
      },
    },
  })

  // getUser() 호출이 토큰 갱신을 유발한다. 반환값은 쓰지 않는다.
  await supabase.auth.getUser()

  return supabaseResponse
}
