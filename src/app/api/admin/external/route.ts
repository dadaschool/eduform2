/**
 * 외부용 명단 — docs/accounts-design.md «2. 외부용 명단»
 *
 * GET  → 학생 전체(반·학번·외부용 여부)
 * POST { ids?: string[], studentNumbers?: string[], enabled: boolean } → 일괄 등록·해제
 *
 * 관리자만. 외부용으로 내보내는 것은 학번·이름·반뿐이다 (CSV 는 ./csv).
 * 학번이 «외부 로그인 열쇠» 라, 학번이 없거나 겹치는 학생은 등록하지 않는다.
 */
import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/require-admin'
import { audit, pool } from '@/lib/native-auth'
import type { ExternalStudent } from '@/lib/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const a = await requireAdmin()
  if (!a.ok) return NextResponse.json({ error: a.error }, { status: a.status })
  const { rows } = await pool().query<ExternalStudent>(
    `select p.id, p.name, p.student_number, p.external_practice,
            c.id as class_id, c.name as class_name, c.year as school_year
       from public.profiles p left join public.classes c on c.id = p.class_id
      where p.role = 'student'
      order by c.year desc nulls last, c.name nulls last, p.student_number nulls last, p.name`
  )
  return NextResponse.json({ students: rows }, { headers: { 'Cache-Control': 'no-store' } })
}

const norm = (s: string | null | undefined) => (s ?? '').trim()

export async function POST(req: Request) {
  const a = await requireAdmin()
  if (!a.ok) return NextResponse.json({ error: a.error }, { status: a.status })

  let b: Record<string, unknown>
  try { b = await req.json() } catch { return NextResponse.json({ error: '요청 형식이 올바르지 않습니다' }, { status: 400 }) }
  const enabled = b.enabled === true
  const ids = Array.isArray(b.ids) ? b.ids.filter((x): x is string => typeof x === 'string') : []
  const numbers = Array.isArray(b.studentNumbers)
    ? [...new Set(b.studentNumbers.filter((x): x is string => typeof x === 'string').map(norm).filter(Boolean))]
    : []
  if (ids.length === 0 && numbers.length === 0) {
    return NextResponse.json({ error: '고른 학생이 없습니다' }, { status: 400 })
  }

  const { rows: all } = await pool().query<ExternalStudent>(
    `select p.id, p.name, p.student_number, p.external_practice, p.class_id,
            null::text as class_name, null::int as school_year
       from public.profiles p where p.role = 'student'`
  )

  const idSet = new Set(ids)
  const targets = all.filter(s => idSet.has(s.id) || (numbers.length > 0 && numbers.includes(norm(s.student_number))))
  const notFound = numbers.filter(n => !all.some(s => norm(s.student_number) === n))

  if (enabled) {
    const noNumber = targets.filter(s => !norm(s.student_number))
    if (noNumber.length) {
      return NextResponse.json({
        error: `학번이 없는 학생은 외부용에 넣을 수 없습니다: ${noNumber.slice(0, 10).map(s => s.name).join(', ')}`,
      }, { status: 409 })
    }
    // 등록 뒤의 외부용 명단 안에서 학번이 겹치면 외부 프로그램이 학생을 구분하지 못한다.
    const after = all.filter(s => s.external_practice || targets.some(t => t.id === s.id))
    const byNum = new Map<string, string[]>()
    for (const s of after) {
      const k = norm(s.student_number)
      byNum.set(k, [...(byNum.get(k) ?? []), s.name])
    }
    const dups = [...byNum.entries()].filter(([, v]) => v.length > 1)
    if (dups.length) {
      return NextResponse.json({
        error: '외부용 명단 안에서 학번이 겹칩니다. 학번을 30101 처럼 학년·반·번호 전체로 고친 뒤 다시 하세요: '
          + dups.slice(0, 5).map(([k, v]) => `${k}(${v.join('·')})`).join(', '),
      }, { status: 409 })
    }
  }

  const targetIds = targets.map(s => s.id)
  if (targetIds.length) {
    await pool().query(
      `update public.profiles set external_practice = $2 where role = 'student' and id = any($1::uuid[])`,
      [targetIds, enabled]
    )
  }
  await audit(a.userId, enabled ? 'external.enable' : 'external.disable', { count: targetIds.length })
  return NextResponse.json({ changed: targetIds.length, notFound })
}
