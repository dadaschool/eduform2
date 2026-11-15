/**
 * 로그인 뒤 돌아갈 주소(?next=)를 검사한다.
 *
 * 같은 사이트 안의 경로만 받는다. `//다른사이트` 나 `/\\다른사이트` 는 브라우저가
 * 바깥 주소로 해석해, 로그인 화면을 거쳐 가짜 사이트로 보내는 데 쓰일 수 있다.
 */
export function safeNext(next: string | null | undefined): string | null {
  if (!next) return null
  if (!next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return null
  if (/[\r\n]/.test(next)) return null
  return next
}

/** 지금 주소의 ?next= 를 읽는다 (클라이언트 전용). */
export function nextFromLocation(): string | null {
  if (typeof window === 'undefined') return null
  return safeNext(new URLSearchParams(window.location.search).get('next'))
}
