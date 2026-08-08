import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { generateText } from '@/lib/ai'

export async function POST(req: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 })

    const { prompt, subject, title } = await req.json()

    const systemPrompt = `당신은 중학교 교사를 돕는 평가 설계 전문가입니다. 2022 개정 교육과정 기반으로 수행평가 루브릭을 설계합니다.

교사 요청에 따라 평가 항목을 JSON 배열로 생성하세요.
각 항목은 반드시 다음 필드를 포함해야 합니다:
- name: 항목 이름 (string)
- description: 루브릭 기준 설명 (string)
- check_type: 체크 방식 (다음 중 하나: "ox", "level3", "status3", "number", "score5", "text")
  - ox: O/X 이진 평가
  - level3: 상/중/하 3단계 성취수준
  - status3: 완료/보류/미제출 제출 상태
  - number: 숫자 점수 (number_min, number_max 포함)
  - score5: 1~5점 별점
  - text: 자유 텍스트 메모
- number_min: 숫자 타입일 때 최솟값 (기본 0)
- number_max: 숫자 타입일 때 최댓값 (기본 100)

반드시 JSON만 응답하세요. 코드블록 없이 순수 JSON 배열만:
[{"name":"...","description":"...","check_type":"...","number_min":0,"number_max":100}]`

    const { text, provider } = await generateText({
      system: systemPrompt,
      user: `교과: ${subject || '미지정'}\n평가명: ${title || '미지정'}\n\n교사 요청: ${prompt}`,
    })

    // JSON 파싱
    let items
    try {
      const jsonStr = text.replace(/^```json?\n?/, '').replace(/\n?```$/, '').trim()
      items = JSON.parse(jsonStr)
    } catch {
      const match = text.match(/\[[\s\S]*\]/)
      if (match) items = JSON.parse(match[0])
      else throw new Error('JSON 파싱 실패')
    }

    return NextResponse.json({ items, provider })
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'AI 생성 실패' }, { status: 500 })
  }
}
