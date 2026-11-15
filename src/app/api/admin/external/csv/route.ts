/**
 * GET /api/admin/external/csv — 외부용 명단 CSV (관리자만)
 *
 *   학번,이름,반
 *
 * 들어가는 칸은 이 셋뿐이다. 이메일 · 비밀번호 · 내부 id 는 넣지 않는다.
 * 내려받을 때마다 «누가 · 언제 · 몇 명» 을 auth.admin_audit 에 남긴다.
 */
import { requireAdmin } from '@/lib/require-admin'
import { audit, pool } from '@/lib/native-auth'
import { csvCell } from '@/lib/csv'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const a = await requireAdmin()
  if (!a.ok) return new Response(a.error, { status: a.status })

  const { rows } = await pool().query<{ student_number: string; name: string; class_name: string | null }>(
    `select btrim(p.student_number) as student_number, btrim(p.name) as name, c.name as class_name
       from public.profiles p left join public.classes c on c.id = p.class_id
      where p.role = 'student' and p.external_practice and coalesce(btrim(p.student_number), '') <> ''
      order by c.name nulls last, p.student_number`
  )

  const lines = ['학번,이름,반', ...rows.map(r => [r.student_number, r.name, r.class_name].map(csvCell).join(','))]
  await audit(a.userId, 'external.csv', { count: rows.length })

  const d = new Date()
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
  // UTF-8 BOM — 엑셀에서 한글이 깨지지 않게
  return new Response('﻿' + lines.join('\r\n') + '\r\n', {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="external-roster-${stamp}.csv"`,
      'Cache-Control': 'no-store',
    },
  })
}
