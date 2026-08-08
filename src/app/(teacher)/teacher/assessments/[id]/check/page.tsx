'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from 'sonner'
import { Save, Search, ChevronLeft } from 'lucide-react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import type { Assessment, AssessmentItem, Class, Profile } from '@/lib/types'
import { useParams } from 'next/navigation'

// 셀 안에서 쓰는 compact 컨트롤
function CompactCell({ item, value, onChange }: { item: AssessmentItem; value: string | null; onChange: (v: string) => void }) {
  if (item.check_type === 'ox') {
    return (
      <div className="flex gap-1 justify-center">
        {['O', 'X'].map(v => (
          <button key={v} type="button" onClick={() => onChange(value === v ? '' : v)}
            className={cn('w-8 h-7 rounded text-xs font-bold border transition-all',
              value === v
                ? v === 'O' ? 'bg-green-500 text-white border-green-500' : 'bg-red-500 text-white border-red-500'
                : 'bg-white text-gray-400 border-gray-200 hover:border-gray-400')}>
            {v}
          </button>
        ))}
      </div>
    )
  }
  if (item.check_type === 'level3') {
    return (
      <div className="flex gap-0.5 justify-center">
        {['상', '중', '하'].map((v, i) => (
          <button key={v} type="button" onClick={() => onChange(value === v ? '' : v)}
            className={cn('w-8 h-7 rounded text-xs font-medium border transition-all',
              value === v
                ? i === 0 ? 'bg-blue-500 text-white border-blue-500'
                  : i === 1 ? 'bg-yellow-400 text-white border-yellow-400'
                  : 'bg-gray-400 text-white border-gray-400'
                : 'bg-white text-gray-400 border-gray-200 hover:border-gray-400')}>
            {v}
          </button>
        ))}
      </div>
    )
  }
  if (item.check_type === 'status3') {
    return (
      <div className="flex gap-0.5 justify-center">
        {['완료', '보류', '미'].map((v, i) => (
          <button key={v} type="button" onClick={() => onChange(value === (i === 2 ? '미제출' : v) ? '' : (i === 2 ? '미제출' : v))}
            className={cn('px-1.5 h-7 rounded text-xs font-medium border transition-all',
              value === (i === 2 ? '미제출' : v)
                ? i === 0 ? 'bg-green-500 text-white border-green-500'
                  : i === 1 ? 'bg-orange-400 text-white border-orange-400'
                  : 'bg-red-400 text-white border-red-400'
                : 'bg-white text-gray-400 border-gray-200 hover:border-gray-400')}>
            {v}
          </button>
        ))}
      </div>
    )
  }
  if (item.check_type === 'score5') {
    return (
      <div className="flex justify-center">
        {[1, 2, 3, 4, 5].map(v => (
          <button key={v} type="button" onClick={() => onChange(String(v))}
            className={cn('text-base leading-none transition-all hover:scale-110',
              Number(value) >= v ? 'text-yellow-400' : 'text-gray-200')}>
            ★
          </button>
        ))}
      </div>
    )
  }
  if (item.check_type === 'number') {
    return (
      <div className="flex items-center gap-0.5 justify-center">
        <button type="button" onClick={() => onChange(String(Math.max((item.number_min ?? 0), (Number(value) || (item.number_min ?? 0)) - 1)))}
          className="w-6 h-7 rounded border bg-gray-100 hover:bg-gray-200 text-sm font-bold">−</button>
        <input type="number" min={item.number_min} max={item.number_max}
          value={value ?? ''}
          onChange={e => onChange(e.target.value)}
          className="w-12 h-7 text-center border rounded text-xs font-medium" />
        <button type="button" onClick={() => onChange(String(Math.min((item.number_max ?? 100), (Number(value) || (item.number_min ?? 0)) + 1)))}
          className="w-6 h-7 rounded border bg-gray-100 hover:bg-gray-200 text-sm font-bold">+</button>
      </div>
    )
  }
  // text
  return (
    <input type="text" value={value ?? ''} onChange={e => onChange(e.target.value)}
      className="w-full h-7 text-xs border rounded px-1.5 text-center" />
  )
}

export default function CheckPage() {
  const params = useParams()
  const id = params.id as string
  const supabase = createClient()
  const [assessment, setAssessment] = useState<Assessment | null>(null)
  const [items, setItems] = useState<AssessmentItem[]>([])
  const [students, setStudents] = useState<Profile[]>([])
  const [classes, setClasses] = useState<Class[]>([])
  const [selectedClass, setSelectedClass] = useState('all')
  const [search, setSearch] = useState('')
  const [checks, setChecks] = useState<Record<string, Record<string, { value: string | null }>>>({})
  const [studentMemos, setStudentMemos] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const [{ data: asmt }, { data: asmtItems }, { data: ac }] = await Promise.all([
      supabase.from('assessments').select('*').eq('id', id).single(),
      supabase.from('assessment_items').select('*').eq('assessment_id', id).order('display_order'),
      supabase.from('assessment_classes').select('class_id').eq('assessment_id', id),
    ])
    setAssessment(asmt)
    setItems(asmtItems ?? [])

    const classIds = (ac ?? []).map(r => r.class_id)
    const { data: cls } = await supabase.from('classes').select('*').in('id', classIds.length > 0 ? classIds : ['none'])
    setClasses(cls ?? [])

    const { data: studs } = await supabase.from('profiles').select('*')
      .eq('teacher_id', user.id).eq('role', 'student')
      .in('class_id', classIds.length > 0 ? classIds : ['none'])
      .order('class_id').order('student_number')
    setStudents(studs ?? [])

    const studIds = (studs ?? []).map(s => s.id)
    if (studIds.length > 0 && asmtItems && asmtItems.length > 0) {
      const { data: existChecks } = await supabase.from('student_assessment_checks')
        .select('*').in('student_id', studIds).in('assessment_item_id', asmtItems.map(i => i.id))
      const checkMap: Record<string, Record<string, { value: string | null }>> = {}
      const memoMap: Record<string, string> = {}
      for (const c of (existChecks ?? [])) {
        if (!checkMap[c.student_id]) checkMap[c.student_id] = {}
        checkMap[c.student_id][c.assessment_item_id] = { value: c.check_value }
        if (c.teacher_memo && !memoMap[c.student_id]) memoMap[c.student_id] = c.teacher_memo
      }
      setChecks(checkMap)
      setStudentMemos(memoMap)
    }
    setLoading(false)
  }, [id, supabase])

  useEffect(() => { fetchData() }, [fetchData])

  function updateCheck(studentId: string, itemId: string, val: string) {
    setChecks(prev => ({
      ...prev,
      [studentId]: { ...prev[studentId], [itemId]: { value: val } }
    }))
  }

  function updateMemo(studentId: string, memo: string) {
    setStudentMemos(prev => ({ ...prev, [studentId]: memo }))
  }

  async function saveAll() {
    setSaving(true)
    const { data: { user } } = await supabase.auth.getUser()
    const rows = []
    for (const [studentId, itemMap] of Object.entries(checks)) {
      const memo = studentMemos[studentId] ?? null
      for (const [itemId, cv] of Object.entries(itemMap)) {
        rows.push({
          student_id: studentId,
          assessment_item_id: itemId,
          check_value: cv.value ?? null,
          teacher_memo: memo,
          updated_by: user?.id,
          updated_at: new Date().toISOString(),
        })
      }
    }
    if (rows.length === 0) { toast.info('저장할 내용이 없습니다.'); setSaving(false); return }
    const { error } = await supabase.from('student_assessment_checks')
      .upsert(rows, { onConflict: 'student_id,assessment_item_id' })
    if (error) toast.error('저장 실패: ' + error.message)
    else toast.success(`${rows.length}건 저장되었습니다.`)
    setSaving(false)
  }

  const filteredStudents = students.filter(s => {
    const matchClass = selectedClass === 'all' || s.class_id === selectedClass
    const matchSearch = s.name.includes(search) || (s.student_number ?? '').includes(search)
    return matchClass && matchSearch
  })

  if (loading) return <div className="p-6 text-center text-gray-400">불러오는 중...</div>
  if (!assessment) return <div className="p-6 text-center text-gray-400">평가를 찾을 수 없습니다.</div>

  return (
    <div className="p-4 space-y-4 h-screen flex flex-col">
      {/* 헤더 */}
      <div className="flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2">
          <Link href="/teacher/assessments">
            <Button variant="ghost" size="icon"><ChevronLeft className="w-5 h-5" /></Button>
          </Link>
          <div>
            <h1 className="text-xl font-bold text-gray-900">{assessment.title}</h1>
            <p className="text-xs text-gray-400">총 {filteredStudents.length}명</p>
          </div>
        </div>
        <Button onClick={saveAll} disabled={saving} className="gap-2">
          <Save className="w-4 h-4" />{saving ? '저장 중...' : '전체 저장'}
        </Button>
      </div>

      {/* 필터 */}
      <div className="flex gap-2 flex-shrink-0">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input placeholder="학생 이름, 학번 검색" className="pl-9 h-8 text-sm" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <Select value={selectedClass} onValueChange={v => setSelectedClass(v || 'all')}>
          <SelectTrigger className="w-36 h-8 text-sm">
            <SelectValue>{classes.find(c => c.id === selectedClass)?.name ?? '전체 반'}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">전체 반</SelectItem>
            {classes.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* 표 */}
      <div className="flex-1 overflow-auto border rounded-lg">
        <table className="border-collapse text-sm w-full">
          <thead className="sticky top-0 z-20 bg-gray-100">
            <tr>
              <th className="sticky left-0 z-30 bg-gray-100 border border-gray-200 px-3 py-2 text-left text-xs font-semibold text-gray-600 w-8">반</th>
              <th className="sticky left-10 z-30 bg-gray-100 border border-gray-200 px-3 py-2 text-left text-xs font-semibold text-gray-600 min-w-20">이름</th>
              {items.map(item => (
                <th key={item.id} className="border border-gray-200 px-2 py-2 text-center text-xs font-semibold text-gray-600 min-w-28">
                  <div>{item.name}</div>
                  <div className="text-gray-400 font-normal text-[10px]">
                    {item.check_type === 'ox' ? 'O/X' : item.check_type === 'level3' ? '상/중/하' : item.check_type === 'status3' ? '완료/보류/미' : item.check_type === 'number' ? `${item.number_min}~${item.number_max}` : item.check_type === 'score5' ? '별점' : '텍스트'}
                  </div>
                </th>
              ))}
              <th className="border border-gray-200 px-2 py-2 text-center text-xs font-semibold text-gray-600 min-w-32">메모</th>
            </tr>
          </thead>
          <tbody>
            {filteredStudents.length === 0 ? (
              <tr><td colSpan={items.length + 3} className="text-center py-12 text-gray-400">배포된 반의 학생이 없습니다.</td></tr>
            ) : filteredStudents.map((student, idx) => {
              const cls = classes.find(c => c.id === student.class_id)
              const memo = studentMemos[student.id] ?? ''
              return (
                <tr key={student.id} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}>
                  <td className="sticky left-0 z-10 border border-gray-200 px-2 py-1.5 text-center text-xs text-gray-500 bg-inherit w-8">{cls?.name ?? '-'}</td>
                  <td className="sticky left-10 z-10 border border-gray-200 px-3 py-1.5 bg-inherit min-w-20">
                    <div className="font-medium text-gray-900 whitespace-nowrap">{student.name}</div>
                    {student.student_number && <div className="text-[10px] text-gray-400">{student.student_number}번</div>}
                  </td>
                  {items.map(item => (
                    <td key={item.id} className="border border-gray-200 px-1 py-1.5">
                      <CompactCell
                        item={item}
                        value={checks[student.id]?.[item.id]?.value ?? null}
                        onChange={v => updateCheck(student.id, item.id, v)}
                      />
                    </td>
                  ))}
                  <td className="border border-gray-200 px-2 py-1.5 min-w-36">
                    <input
                      type="text"
                      value={memo}
                      onChange={e => updateMemo(student.id, e.target.value)}
                      placeholder="메모"
                      className={cn('w-full h-7 text-xs border rounded px-2',
                        memo ? 'border-blue-300 bg-blue-50' : 'border-gray-200')}
                    />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
