'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { LogOut } from 'lucide-react'

/**
 * 로그아웃.
 *
 * ⚠ 두 가지를 반드시 함께 해야 한다.
 *
 *  ① 세션을 «지운다». 예전에 관리자 화면의 로그아웃은 그냥
 *     <Link href="/login"> 이었다. 화면만 로그인 페이지로 갔고 쿠키는 그대로
 *     남아, 공용 컴퓨터에서 다음 사람이 그대로 들어갈 수 있었다.
 *
 *  ② «페이지를 새로 불러온다» (router.push 가 아니라 location.replace).
 *     App Router 는 서버 컴포넌트 결과를 브라우저에 캐시한다. 그래서 로그아웃 후
 *     다른 계정으로 로그인해도 앞사람 이름과 반이 그대로 보였다. 실제로 겪었다.
 *     replace 를 쓰면 뒤로 가기로 로그인된 화면에 되돌아가지도 않는다.
 */
export default function LogoutButton({ className }: { className?: string }) {
  const [busy, setBusy] = useState(false)

  async function logout() {
    setBusy(true)
    try {
      await createClient().auth.signOut()
    } catch {
      // 세션이 이미 끊겼어도 로그인 화면으로는 보내야 한다
    }
    window.location.replace('/login')
  }

  return (
    <button type="button" onClick={logout} disabled={busy}
      className={className ?? 'w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-gray-500 hover:bg-gray-100'}>
      <LogOut className="w-4 h-4" />{busy ? '로그아웃 중...' : '로그아웃'}
    </button>
  )
}
