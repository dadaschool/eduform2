/**
 * Supabase 접속 정보를 읽는 단일 창구.
 *
 * 값이 없을 때 라이브러리가 뱉는 영문 메시지 대신,
 * 어느 환경변수가 비었는지 알려주는 메시지를 던진다.
 * (Vercel 배포 시 대시보드에 변수를 등록하지 않으면 이 오류가 난다)
 */
export function getSupabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  const missing = [
    !url && 'NEXT_PUBLIC_SUPABASE_URL',
    !anonKey && 'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  ].filter(Boolean)

  if (missing.length > 0) {
    throw new Error(
      `환경변수가 설정되지 않았습니다: ${missing.join(', ')}\n` +
        '로컬은 .env.local 파일에, 배포는 Vercel 프로젝트 설정 > Environment Variables 에 등록하세요.'
    )
  }

  return { url: url!, anonKey: anonKey! }
}

/** 환경변수가 갖춰졌는지만 확인한다 (예외를 던지지 않음). */
export function hasSupabaseEnv() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
}
