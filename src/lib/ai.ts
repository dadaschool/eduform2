import { GoogleGenerativeAI } from '@google/generative-ai'

/**
 * AI 텍스트 생성 — Gemini 를 먼저 쓰고 실패하면 업스테이지(Solar)로 넘어간다.
 *
 * Gemini 키가 속한 Google 프로젝트가 차단되는 경우(PERMISSION_DENIED)나
 * 무료 등급 할당량이 0 인 경우가 있어, 한쪽이 죽어도 기능이 멈추지 않게 한다.
 *
 * 순서를 바꾸려면 환경변수 AI_PRIMARY=upstage 로 두면 된다.
 * Gemini 가 항상 실패하는 상황이라면 이렇게 해서 헛된 호출 한 번을 줄일 수 있다.
 */

export type AIProvider = 'gemini' | 'upstage'

export interface GenerateOptions {
  /** 역할·형식 지시 (선택) */
  system?: string
  /** 실제 요청 내용 */
  user: string
}

export interface GenerateResult {
  text: string
  /** 실제로 응답한 제공자. 폴백이 작동했는지 확인할 때 쓴다. */
  provider: AIProvider
}

const GEMINI_MODEL = 'gemini-2.0-flash-lite'
const UPSTAGE_MODEL = 'solar-pro3'
const UPSTAGE_ENDPOINT = 'https://api.upstage.ai/v1/chat/completions'

/**
 * 제공자 한 곳당 제한 시간.
 *
 * 교내망처럼 바깥으로 나가는 통신이 막힌 곳에서는 방화벽이 거절 응답을 주지 않고
 * 패킷을 그냥 버린다. 그러면 fetch 가 OS 의 TCP 대기 시간(윈도우는 2분 이상)만큼
 * 멈춰 있고, 폴백까지 두 번 기다리면 화면이 4분 넘게 돌아간다.
 * 여기서 끊어야 "AI 만 안 되고 나머지는 정상" 이 된다.
 */
const TIMEOUT_MS = 20_000

async function generateWithGemini({ system, user }: GenerateOptions): Promise<string> {
  const key = process.env.GEMINI_API_KEY
  if (!key) throw new Error('GEMINI_API_KEY 미설정')

  const genAI = new GoogleGenerativeAI(key)
  const model = genAI.getGenerativeModel({ model: GEMINI_MODEL }, { timeout: TIMEOUT_MS })

  const parts = system ? [{ text: system }, { text: user }] : [{ text: user }]
  const result = await model.generateContent(parts)
  const text = result.response.text().trim()
  if (!text) throw new Error('빈 응답')
  return text
}

async function generateWithUpstage({ system, user }: GenerateOptions): Promise<string> {
  const key = process.env.UPSTAGE_API_KEY
  if (!key) throw new Error('UPSTAGE_API_KEY 미설정')

  // OpenAI 호환 형식이다.
  const messages = system
    ? [{ role: 'system', content: system }, { role: 'user', content: user }]
    : [{ role: 'user', content: user }]

  const res = await fetch(UPSTAGE_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: UPSTAGE_MODEL, messages }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`HTTP ${res.status} ${body.replace(/\s+/g, ' ').slice(0, 200)}`)
  }

  const data = await res.json()
  const text: string | undefined = data?.choices?.[0]?.message?.content
  if (!text?.trim()) throw new Error('빈 응답')
  return text.trim()
}

export async function generateText(opts: GenerateOptions): Promise<GenerateResult> {
  const order: AIProvider[] =
    process.env.AI_PRIMARY === 'upstage' ? ['upstage', 'gemini'] : ['gemini', 'upstage']

  const failures: string[] = []

  for (const provider of order) {
    // 키가 없는 제공자는 조용히 건너뛴다. 둘 중 하나만 설정해도 동작해야 한다.
    const hasKey =
      provider === 'gemini' ? Boolean(process.env.GEMINI_API_KEY) : Boolean(process.env.UPSTAGE_API_KEY)
    if (!hasKey) continue

    try {
      const text = provider === 'gemini' ? await generateWithGemini(opts) : await generateWithUpstage(opts)
      return { text, provider }
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err)
      const name = err instanceof Error ? err.name : ''
      // 시간 초과는 원문이 "The operation was aborted due to timeout" 처럼 나와
      // 원인을 짐작하기 어렵다. 교내망에서 가장 흔한 실패라 따로 적어 준다.
      const timedOut = name === 'TimeoutError' || name === 'AbortError' || /timeout|aborted/i.test(raw)
      const message = timedOut
        ? `${TIMEOUT_MS / 1000}초 안에 응답 없음 (바깥 인터넷이 막혀 있을 수 있습니다)`
        : raw
      // 서버 로그에 남겨 어느 쪽이 왜 실패했는지 추적할 수 있게 한다.
      console.error(`[ai] ${provider} 실패: ${message}`)
      failures.push(`${provider}: ${message}`)
    }
  }

  if (failures.length === 0) {
    throw new Error('AI 키가 설정되지 않았습니다. GEMINI_API_KEY 또는 UPSTAGE_API_KEY 를 등록하세요.')
  }
  throw new Error(`AI 생성 실패 — ${failures.join(' / ')}`)
}
