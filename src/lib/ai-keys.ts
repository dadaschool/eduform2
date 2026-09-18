// 서버 전용 — service_role 키와 복호화를 다룬다. 클라이언트 컴포넌트에서 import 금지.
import { createClient } from '@supabase/supabase-js'
import { decryptKey } from '@/lib/ai-crypto'
import { generateText, type GenerateOptions, type GenerateResult, type ProviderKey, type AIProvider } from '@/lib/ai'

/**
 * 한 교사의 AI 호출에 쓸 키를 순서대로 모은다.
 *
 *   1. 교사가 등록한 키 — teacher_ai_keys, priority 오름차순
 *   2. 학교 로컬 모델(LM Studio) — 서버에 LMSTUDIO_MODEL 이 설정돼 있으면 교사
 *      전원에게 자동으로 붙는다 (관리자 제한 없음. 이유는 바로 아래).
 *   3. (관리자일 때만) 학교 공용 키 — 환경변수. 위 목록에 없는 provider 만 뒤에 붙인다.
 *
 * 공용 env 키를 관리자에게만 여는 이유 — 무료 등급 할당량은 계정당이라 교사
 * 수만큼 나누면 금방 바닥나고, 유료 키라면 한 교사의 사용량이 학교 전체 요금이
 * 된다. 그래서 일반 교사는 «자기 키» 를 등록해야 하고, 관리자는 점검·시연용으로
 * 공용 키를 그대로 쓸 수 있게 둔다.
 *
 * 로컬 모델은 이 제약이 없다 — 학교 서버 컴퓨터에서 직접 도는 것이라 계정별
 * 할당량도, 청구서도 없다. 그래서 관리자로 제한하지 않고 교사 전원에게 연다.
 */

const ENV_KEYS: Record<'upstage' | 'gemini' | 'openai', string | undefined> = {
  upstage: process.env.UPSTAGE_API_KEY,
  gemini: process.env.GEMINI_API_KEY,
  openai: process.env.OPENAI_API_KEY,
}

function service() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

export async function resolveKeys(opts: { userId: string; isAdmin: boolean }): Promise<ProviderKey[]> {
  const { data } = await service()
    .from('teacher_ai_keys')
    .select('provider, api_key_enc, priority')
    .eq('teacher_id', opts.userId)
    .order('priority', { ascending: true })

  const keys: ProviderKey[] = []
  const seen = new Set<AIProvider>()

  for (const row of data ?? []) {
    try {
      keys.push({ provider: row.provider as AIProvider, key: decryptKey(row.api_key_enc), source: '내 키' })
      seen.add(row.provider as AIProvider)
    } catch (err) {
      // 복호화 실패(대개 AI_KEY_SECRET 이 바뀐 경우) — 이 키만 건너뛴다.
      console.error(`[ai-keys] ${opts.userId} 의 ${row.provider} 키 복호화 실패:`, err)
    }
  }

  // 학교 로컬 모델 — 교사 전원. seen 에 없어도 상관없다(교사가 개인적으로
  // «lmstudio» 를 등록할 방법 자체가 없다 — /api/teacher/ai-keys 가 막는다).
  const lmstudioModel = process.env.LMSTUDIO_MODEL
  if (lmstudioModel) {
    keys.push({ provider: 'lmstudio', key: lmstudioModel, source: '학교 로컬' })
  }

  if (opts.isAdmin) {
    for (const provider of ['upstage', 'gemini', 'openai'] as const) {
      if (!seen.has(provider) && ENV_KEYS[provider]) {
        keys.push({ provider, key: ENV_KEYS[provider]!, source: '학교 공용' })
      }
    }
  }

  return keys
}

/** 교사 한 명 기준으로 텍스트를 생성한다. 키가 없으면 ai.ts 가 NO_AI_KEYS 를 던진다. */
export async function generateForUser(
  opts: { userId: string; isAdmin: boolean },
  gen: GenerateOptions
): Promise<GenerateResult> {
  const keys = await resolveKeys(opts)
  return generateText(gen, keys)
}
