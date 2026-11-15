'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { toast } from 'sonner'
import { Download, Globe, AlertTriangle } from 'lucide-react'
import type { ExternalStudent } from '@/lib/types'

/**
 * 외부용 명단 — 학교 밖 연습 프로그램(pycoding · pyclub)에 올릴 학생을 고르고 CSV 로 받는다.
 * docs/accounts-design.md «2. 외부용 명단»
 */
export default function ExternalRosterPage() {
  const [students, setStudents] = useState<ExternalStudent[]>([])
  const [loading, setLoading] = useState(true)
  const [classId, setClassId] = useState<string>('all')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [paste, setPaste] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/external', { cache: 'no-store' })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) { toast.error(body.error ?? '불러오지 못했습니다'); return }
    setStudents(body.students ?? [])
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  const classes = useMemo(() => {
    const m = new Map<string, string>()
    for (const s of students) if (s.class_id) m.set(s.class_id, `${s.class_name ?? ''}${s.school_year ? ` (${s.school_year})` : ''}`)
    return [...m.entries()]
  }, [students])

  const shown = students.filter(s => classId === 'all' || (classId === 'none' ? !s.class_id : s.class_id === classId))
  const enabledCount = students.filter(s => s.external_practice).length
  const allShownPicked = shown.length > 0 && shown.every(s => picked.has(s.id))

  function toggle(id: string) {
    setPicked(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })
  }
  function toggleAllShown() {
    setPicked(prev => {
      const n = new Set(prev)
      if (allShownPicked) shown.forEach(s => n.delete(s.id)); else shown.forEach(s => n.add(s.id))
      return n
    })
  }

  async function apply(enabled: boolean, by: 'picked' | 'paste') {
    const payload = by === 'picked'
      ? { ids: [...picked], enabled }
      : { studentNumbers: paste.split(/[\s,;]+/).map(s => s.trim()).filter(Boolean), enabled }
    if ((payload.ids?.length ?? 0) + (payload.studentNumbers?.length ?? 0) === 0) {
      toast.error(by === 'picked' ? '학생을 고르세요' : '학번을 붙여 넣으세요'); return
    }
    setBusy(true)
    try {
      const res = await fetch('/api/admin/external', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? '바꾸지 못했습니다')
      toast.success(`${body.changed}명을 ${enabled ? '외부용에 넣었습니다' : '외부용에서 뺐습니다'}`, {
        description: body.notFound?.length ? `없는 학번: ${body.notFound.slice(0, 10).join(', ')}` : undefined,
      })
      setPicked(new Set()); if (by === 'paste') setPaste('')
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '바꾸지 못했습니다')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6" style={{ wordBreak: 'keep-all' }}>
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><Globe className="w-6 h-6" />외부용 명단</h1>
        <p className="text-sm text-gray-500 mt-1">
          학교 밖에서 연습하는 프로그램(pycoding · pyclub)에 올릴 학생을 고릅니다. 지금 <b>{enabledCount}명</b>.
        </p>
      </div>

      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 flex gap-2">
        <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
        <div>
          외부용은 <b>학번과 이름만 맞으면</b> 들어갑니다. 같은 반 친구라면 아는 정보이므로
          <b> 연습 전용</b>으로만 쓰세요 — 평가·성적은 학교 안에서 에듀폼2 계정으로 합니다.
          CSV 에는 <b>학번 · 이름 · 반</b>만 들어가고 비밀번호와 이메일은 들어가지 않습니다.
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between gap-2 space-y-0">
          <CardTitle className="text-base">명단 내려받기</CardTitle>
          <a href="/api/admin/external/csv"
            className="inline-flex items-center gap-1.5 rounded-md bg-slate-800 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600">
            <Download className="w-4 h-4" />CSV 내려받기 ({enabledCount}명)
          </a>
        </CardHeader>
        <CardContent className="text-xs text-gray-500">
          받은 파일을 외부 프로그램 교사 화면에서 올리세요. 내려받을 때마다 누가·언제·몇 명을 받았는지 기록됩니다.
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">학번으로 한꺼번에</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <Label htmlFor="paste" className="text-xs text-gray-500">엑셀에서 학번 열을 복사해 붙여 넣으세요 (줄바꿈·쉼표·띄어쓰기로 구분)</Label>
          <Textarea id="paste" rows={3} value={paste} onChange={e => setPaste(e.target.value)} placeholder={'30101\n30102\n30103'} />
          <div className="flex gap-2">
            <Button onClick={() => apply(true, 'paste')} disabled={busy}>외부용에 넣기</Button>
            <Button variant="outline" onClick={() => apply(false, 'paste')} disabled={busy}>외부용에서 빼기</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3 flex flex-row flex-wrap items-center gap-2 space-y-0">
          <CardTitle className="text-base mr-auto">반에서 고르기</CardTitle>
          <select aria-label="반 고르기" value={classId} onChange={e => setClassId(e.target.value)}
            className="h-9 rounded-md border px-2 text-sm">
            <option value="all">전체 반</option>
            {classes.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            <option value="none">반 없음</option>
          </select>
          <Button size="sm" onClick={() => apply(true, 'picked')} disabled={busy || picked.size === 0}>
            고른 {picked.size}명 넣기
          </Button>
          <Button size="sm" variant="outline" onClick={() => apply(false, 'picked')} disabled={busy || picked.size === 0}>
            고른 {picked.size}명 빼기
          </Button>
        </CardHeader>
        <CardContent>
          {loading ? <p className="text-sm text-gray-400">불러오는 중...</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 border-b">
                    <th className="py-2 w-10">
                      <input type="checkbox" aria-label="보이는 학생 모두 고르기" checked={allShownPicked} onChange={toggleAllShown} />
                    </th>
                    <th className="py-2">반</th><th className="py-2">학번</th><th className="py-2">이름</th><th className="py-2">외부용</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map(s => (
                    <tr key={s.id} className="border-b last:border-0">
                      <td className="py-1.5">
                        <input type="checkbox" aria-label={`${s.name} 고르기`} checked={picked.has(s.id)} onChange={() => toggle(s.id)} />
                      </td>
                      <td className="py-1.5 text-gray-600">{s.class_name ?? '-'}</td>
                      <td className="py-1.5 tabular-nums">{s.student_number || <span className="text-red-600">없음</span>}</td>
                      <td className="py-1.5">{s.name}</td>
                      <td className="py-1.5">{s.external_practice
                        ? <span className="text-emerald-700 font-medium">들어 있음</span>
                        : <span className="text-gray-400">-</span>}</td>
                    </tr>
                  ))}
                  {shown.length === 0 && <tr><td colSpan={5} className="py-6 text-center text-gray-400">학생이 없습니다</td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
