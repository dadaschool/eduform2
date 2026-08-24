'use client'

import { useEffect, useRef } from 'react'

/**
 * 주기적으로 다시 읽는다. 실시간 구독(Supabase Realtime) 대신 쓴다.
 *
 * 왜 폴링인가
 *   Realtime 서버는 Elixir 로 만들어져 윈도우 빌드가 없다. 교내 서버(윈도우)
 *   설치에서는 띄울 수가 없어서, 쪽지 알림을 짧은 주기로 다시 읽는 방식으로
 *   바꿨다. 즉시 → 몇 초 지연이 되는 대신 부품 하나가 줄어든다.
 *
 * 화면이 가려져 있으면(다른 탭·최소화) 쉰다. 학생들이 화면을 열어 둔 채
 * 두는 일이 많아서, 이게 없으면 쓸데없는 질의가 계속 쌓인다.
 */
export function usePoll(fn: () => void | Promise<void>, intervalMs: number, enabled = true) {
  // 최신 함수를 참조로 들고 있어야 한다. 그러지 않으면 fn 이 바뀔 때마다
  // 타이머가 초기화되어 주기가 어긋난다.
  const fnRef = useRef(fn)
  fnRef.current = fn

  useEffect(() => {
    if (!enabled) return

    let stopped = false
    const tick = () => {
      if (stopped || document.hidden) return
      void fnRef.current()
    }

    const timer = setInterval(tick, intervalMs)

    // 다시 보이게 되면 기다리지 않고 바로 한 번 읽는다.
    const onVisible = () => { if (!document.hidden) tick() }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      stopped = true
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [intervalMs, enabled])
}

/** 쪽지 확인 주기(ms). 교내망이라 짧게 둬도 부담이 적다. */
export const MESSAGE_POLL_MS = 15_000
