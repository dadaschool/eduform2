import { toast } from 'sonner'

/** src/lib/ai.ts 의 NO_AI_KEYS 와 같은 값이어야 한다. 서버 모듈을 클라이언트로
 *  끌어오지 않으려고 문자열만 여기 따로 둔다. */
const NO_AI_KEYS = 'NO_AI_KEYS'

/**
 * AI 라우트 오류를 토스트로 띄운다.
 * 키가 없어서 난 오류면 «내 계정» 으로 가는 버튼을 함께 보여 준다.
 */
export function notifyAiError(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err)
  if (msg === NO_AI_KEYS) {
    toast.error('등록된 AI API 키가 없습니다', {
      description: '내 계정에서 업스테이지·Gemini·ChatGPT 키를 1개 이상 등록하세요.',
      action: { label: '내 계정', onClick: () => { window.location.href = '/teacher/account' } },
    })
    return
  }
  toast.error(msg || 'AI 생성 실패')
}
