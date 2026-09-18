import { GoogleGenerativeAI } from '@google/generative-ai'

/**
 * AI 텍스트 생성 — 넘겨받은 키 목록을 «순서대로» 시도한다.
 *
 * 키는 교사마다 다르다 (teacher_ai_keys). 어떤 키를 어떤 순서로 쓸지는 호출부
 * (src/lib/ai-keys.ts) 가 정해서 넘기고, 이 파일은 그 순서대로 한 곳씩 시도하다
 * 실패하면 다음으로 넘어가는 일만 한다.
 *
 * 넘어가는 경우 — 할당량 초과(429), 인증 실패(401/403), 타임아웃, 빈 응답 등
 * «이 제공자로는 지금 안 된다» 는 모든 상황. 마지막 하나까지 실패하면 각 실패
 * 사유를 모아 던진다.
 */

export type AIProvider = 'gemini' | 'upstage' | 'openai' | 'lmstudio'

export interface ProviderKey {
  provider: AIProvider
  key: string
  /** 어디서 온 키인지 — 오류 메시지에만 쓴다 ('교사 등록' | '학교 공용' | '학교 로컬') */
  source?: string
}

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

/** 키가 하나도 없을 때 던지는 오류. 화면이 이 코드를 보고 «내 계정» 으로 안내한다. */
export const NO_AI_KEYS = 'NO_AI_KEYS'

const GEMINI_MODEL = 'gemini-2.0-flash-lite'
const UPSTAGE_MODEL = 'solar-pro3'
const UPSTAGE_ENDPOINT = 'https://api.upstage.ai/v1/chat/completions'
const OPENAI_MODEL = 'gpt-4o-mini'
const OPENAI_ENDPOINT = 'https://api.openai.com/v1/chat/completions'

/**
 * 로컬 큐웬(LM Studio) — 학교 서버 컴퓨터에서 도는 모델.
 *
 * ⚠ 클라우드(Vercel 등) 배포에서는 이 provider 를 쓸 수 없다. LM Studio 는
 *   «이 앱이 돌고 있는 그 컴퓨터» 에서만 열리므로, 앱이 다른 컴퓨터(클라우드)에서
 *   돌면 주소가 아예 존재하지 않는다. 에듀폼2(교내 서버판)처럼 앱과 LM Studio 가
 *   같은 윈도우 컴퓨터에서 돌 때만 의미가 있다.
 *
 * 키 대신 «모델 이름» 을 받는다 — 로그인이 없는 로컬 서버라 인증할 게 없다.
 * LM Studio 가 무시하더라도 Authorization 헤더는 형식상 채워 보낸다.
 */
const LMSTUDIO_BASE_URL = (process.env.LMSTUDIO_URL || 'http://127.0.0.1:1234/v1').replace(/\/+$/, '')
const LMSTUDIO_ENDPOINT = `${LMSTUDIO_BASE_URL}/chat/completions`

/**
 * 제공자 한 곳당 제한 시간.
 *
 * 교내망처럼 바깥으로 나가는 통신이 막힌 곳에서는 방화벽이 거절 응답을 주지 않고
 * 패킷을 그냥 버린다. 그러면 fetch 가 OS 의 TCP 대기 시간(윈도우는 2분 이상)만큼
 * 멈춰 있고, 폴백까지 여러 번 기다리면 화면이 몇 분씩 돌아간다.
 * 여기서 끊어야 "AI 만 안 되고 나머지는 정상" 이 된다.
 */
const TIMEOUT_MS = 20_000

/**
 * 로컬 모델은 서버용 GPU 없이 CPU 로 도는 경우가 흔해 클라우드보다 훨씬 느리다.
 * 20 초로 끊으면 대부분 시간 초과로 실패해 버려서 따로 넉넉하게 둔다.
 */
const LMSTUDIO_TIMEOUT_MS = 90_000

async function generateWithGemini({ system, user }: GenerateOptions, key: string): Promise<string> {
  const genAI = new GoogleGenerativeAI(key)
  const model = genAI.getGenerativeModel({ model: GEMINI_MODEL }, { timeout: TIMEOUT_MS })
  const parts = system ? [{ text: system }, { text: user }] : [{ text: user }]
  const result = await model.generateContent(parts)
  const text = result.response.text().trim()
  if (!text) throw new Error('빈 응답')
  return text
}

/** Upstage · OpenAI · LM Studio(로컬) 는 요청 형식이 같다 (OpenAI 호환 chat/completions). */
async function generateWithOpenAICompatible(
  { system, user }: GenerateOptions,
  key: string,
  endpoint: string,
  model: string,
  timeoutMs: number = TIMEOUT_MS
): Promise<string> {
  const messages = system
    ? [{ role: 'system', content: system }, { role: 'user', content: user }]
    : [{ role: 'user', content: user }]

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model, messages }),
    signal: AbortSignal.timeout(timeoutMs),
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

async function runOne(provider: AIProvider, key: string, opts: GenerateOptions): Promise<string> {
  switch (provider) {
    case 'gemini':
      return generateWithGemini(opts, key)
    case 'upstage':
      return generateWithOpenAICompatible(opts, key, UPSTAGE_ENDPOINT, UPSTAGE_MODEL)
    case 'openai':
      return generateWithOpenAICompatible(opts, key, OPENAI_ENDPOINT, OPENAI_MODEL)
    case 'lmstudio':
      // key 자리에는 모델 이름이 온다(ai-keys.ts 참고). 인증은 없다.
      return generateWithOpenAICompatible(opts, 'lm-studio', LMSTUDIO_ENDPOINT, key, LMSTUDIO_TIMEOUT_MS)
  }
}

/**
 * 넘겨받은 키를 앞에서부터 시도한다.
 * @param keys 시도 순서대로 정렬된 키 목록. 비어 있으면 NO_AI_KEYS 를 던진다.
 */
export async function generateText(opts: GenerateOptions, keys: ProviderKey[]): Promise<GenerateResult> {
  if (keys.length === 0) throw new Error(NO_AI_KEYS)

  const failures: string[] = []

  for (const { provider, key, source } of keys) {
    if (!key) continue
    try {
      const text = await runOne(provider, key, opts)
      return { text, provider }
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err)
      const name = err instanceof Error ? err.name : ''
      // 시간 초과는 원문이 "The operation was aborted due to timeout" 처럼 나와
      // 원인을 짐작하기 어렵다. 교내망에서 가장 흔한 실패라 따로 적어 준다.
      const timedOut = name === 'TimeoutError' || name === 'AbortError' || /timeout|aborted/i.test(raw)
      const limitMs = provider === 'lmstudio' ? LMSTUDIO_TIMEOUT_MS : TIMEOUT_MS
      const timeoutHint = provider === 'lmstudio'
        ? '이 컴퓨터에서 LM Studio 서버가 켜져 있고 모델이 로드돼 있는지 확인하세요'
        : '바깥 인터넷이 막혀 있을 수 있습니다'
      const message = timedOut
        ? `${limitMs / 1000}초 안에 응답 없음 (${timeoutHint})`
        : raw
      const label = source ? `${provider}(${source})` : provider
      console.error(`[ai] ${label} 실패: ${message}`)
      failures.push(`${label}: ${message}`)
    }
  }

  throw new Error(`AI 생성 실패 — ${failures.join(' / ')}`)
}

/**
 * 키 1개를 실제 호출로 검증한다. «저장» 버튼이 부른다.
 * 성공하면 아무것도 안 하고, 실패하면 사람이 읽을 수 있는 사유를 던진다.
 */
export async function verifyKey(provider: AIProvider, key: string): Promise<void> {
  try {
    await runOne(provider, key, { user: 'ping. 한 단어로만 답하세요: OK' })
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err)
    const name = err instanceof Error ? err.name : ''
    if (name === 'TimeoutError' || name === 'AbortError' || /timeout|aborted/i.test(raw)) {
      throw new Error('응답이 없습니다 (바깥 인터넷이 막혀 있거나 키가 잘못됐을 수 있습니다)')
    }
    throw new Error(raw)
  }
}
