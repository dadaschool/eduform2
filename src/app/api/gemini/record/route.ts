import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { generateText } from '@/lib/ai'

export async function POST(req: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 })

    const { studentId, subject } = await req.json()

    // 학생 정보
    const { data: student } = await supabase.from('profiles').select('*').eq('id', studentId).single()
    if (!student) return NextResponse.json({ error: '학생 정보 없음' }, { status: 404 })

    // 평가 체크 데이터
    const { data: checks } = await supabase
      .from('student_assessment_checks')
      .select('check_value, teacher_memo, assessment_items(name, description, check_type, assessments(title, subject))')
      .eq('student_id', studentId)

    // 과제 제출 데이터
    const { data: submissions } = await supabase
      .from('assignment_submissions')
      .select('content, submitted_at, feedback, assignments(title, deadline)')
      .eq('student_id', studentId)

    // 관찰일지
    const { data: observations } = await supabase
      .from('observations')
      .select('content, subject, observed_at')
      .eq('student_id', studentId)
      .order('observed_at', { ascending: false })
      .limit(10)

    // 데이터 조합
    const checksText = (checks ?? []).map(c => {
      const item = c.assessment_items as unknown as { name: string; description: string; assessments: { title: string } }
      return `• [${item?.assessments?.title}] ${item?.name}: ${c.check_value}${c.teacher_memo ? ` (${c.teacher_memo})` : ''}`
    }).join('\n')

    const submissionsText = (submissions ?? []).map(s => {
      const asng = s.assignments as unknown as { title: string }
      return `• 과제 "${asng?.title}": ${s.content.slice(0, 200)}${s.content.length > 200 ? '...' : ''}`
    }).join('\n')

    const observationsText = (observations ?? []).map(o =>
      `• [${o.observed_at}${o.subject ? ` ${o.subject}` : ''}] ${o.content}`
    ).join('\n')

    const prompt = `당신은 중학교 교사의 학교생활기록부(학생부) 세부능력 및 특기사항(세특) 작성을 돕는 전문가입니다.

다음 원칙을 반드시 지켜주세요:
1. 학생의 실제 활동과 성취를 구체적으로 서술 (추측·과장 금지)
2. 교사가 직접 관찰한 사실에 근거
3. 성취기준과 연계된 역량 중심 서술
4. 학생부 기재 금지 사항 미포함 (부정적 표현, 개인정보, 예언적 서술 금지)
5. 문장은 자연스럽고 교육적인 한국어로 작성
6. 분량: 500자 내외 (학생부 세특 기준)
7. 추상적 미사여구 없이 구체적 사실과 역량 중심

학생명: ${student.name}
${subject ? `교과: ${subject}` : ''}

=== 평가 체크 데이터 ===
${checksText || '(데이터 없음)'}

=== 과제 제출 내용 ===
${submissionsText || '(데이터 없음)'}

=== 교사 관찰 기록 ===
${observationsText || '(데이터 없음)'}

위 자료를 바탕으로 학생부 세특 초안을 작성해 주세요. 교사가 검토·수정할 수 있는 초안 형태로 작성하고, 세특 문장만 출력하세요.`

    const { text: draft, provider } = await generateText({ user: prompt })

    return NextResponse.json({ draft, provider })
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'AI 생성 실패' }, { status: 500 })
  }
}
