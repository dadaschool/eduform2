'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from 'sonner'
import { Plus, Search, Trash2, BookOpen, Clock, Pencil } from 'lucide-react'
import { formatDate, formatDateTime, getSubmissionStatus, SUBMISSION_STATUS_LABELS, SUBMISSION_STATUS_COLORS } from '@/lib/utils'
import type { Assignment, Class, Profile, AssignmentSubmission } from '@/lib/types'
import { parseISO, isPast } from 'date-fns'
import { fetchMyClasses } from '@/lib/my-classes'

interface AssignmentCol extends Assignment {
  isOverdue: boolean
}

export default function AssignmentsPage() {
  const supabase = createClient()
  const [assignments, setAssignments] = useState<AssignmentCol[]>([])
  const [classes, setClasses] = useState<Class[]>([])
  const [students, setStudents] = useState<Profile[]>([])
  // subMap[studentId][assignmentId] = submission
  const [subMap, setSubMap] = useState<Record<string, Record<string, AssignmentSubmission>>>({})
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [selectedClass, setSelectedClass] = useState('all')

  const fetchData = useCallback(async () => {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    // 반·학생은 «담당» 기준(class_teachers)으로 읽는다. 자세한 이유는 lib/my-classes.ts
    const [{ data: asgns }, cls] = await Promise.all([
      supabase.from('assignments').select('*').eq('teacher_id', user.id).order('created_at', { ascending: false }),
      fetchMyClasses(supabase, user.id),
    ])
    setClasses(cls)

    const cols: AssignmentCol[] = (asgns ?? []).map(a => ({
      ...a,
      isOverdue: !!a.deadline && isPast(parseISO(a.deadline)),
    }))
    setAssignments(cols)
    setLoading(false)
  }, [supabase])

  // 반 선택 시 학생 + 제출현황 로드
  useEffect(() => {
    async function loadClassData() {
      if (selectedClass === 'all') {
        setStudents([])
        setSubMap({})
        return
      }
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      // 학생 목록
      const { data: studs } = await supabase
        .from('profiles')
        .select('*')
        .eq('role', 'student')
        .eq('class_id', selectedClass)
        .order('student_number')
        .order('name')

      setStudents(studs ?? [])

      // 이 반 학생들의 모든 제출 가져오기
      const studentIds = (studs ?? []).map(s => s.id)
      if (studentIds.length === 0) { setSubMap({}); return }

      const { data: subs } = await supabase
        .from('assignment_submissions')
        .select('*')
        .in('student_id', studentIds)

      const map: Record<string, Record<string, AssignmentSubmission>> = {}
      ;(subs ?? []).forEach(s => {
        if (!map[s.student_id]) map[s.student_id] = {}
        map[s.student_id][s.assignment_id] = s
      })
      setSubMap(map)
    }
    loadClassData()
  }, [selectedClass, supabase])

  useEffect(() => { fetchData() }, [fetchData])

  async function deleteAssignment(id: string, title: string) {
    if (!confirm(`"${title}" 과제를 삭제합니다. 제출 데이터도 모두 삭제됩니다.`)) return
    const { error } = await supabase.from('assignments').delete().eq('id', id)
    if (error) { toast.error('삭제 실패'); return }
    toast.success('과제가 삭제되었습니다.')
    fetchData()
  }

  const filteredAssignments = assignments.filter(a =>
    a.title.includes(search) || ((a as unknown as { subject?: string }).subject ?? '').includes(search)
  )

  return (
    <div className="flex flex-col h-screen">
      {/* 헤더 */}
      <div className="p-4 border-b bg-white space-y-3 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">과제 관리</h1>
            <p className="text-gray-500 text-sm mt-0.5">반을 선택하면 학생별 제출 현황을 표로 확인할 수 있습니다</p>
          </div>
          <Link href="/teacher/assignments/new">
            <Button className="gap-2"><Plus className="w-4 h-4" />새 과제 만들기</Button>
          </Link>
        </div>
        <div className="flex gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input placeholder="과제명 검색" className="pl-9 h-9" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <Select value={selectedClass} onValueChange={v => setSelectedClass(v || 'all')}>
            <SelectTrigger className="w-40 h-9">
              <SelectValue>{classes.find(c => c.id === selectedClass)?.name ?? '반 선택'}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">전체 (반 미선택)</SelectItem>
              {classes.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* 본문 */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="text-center py-12 text-gray-400">불러오는 중...</div>
        ) : filteredAssignments.length === 0 ? (
          <Card className="border-dashed m-6">
            <CardContent className="py-12 text-center">
              <BookOpen className="w-12 h-12 mx-auto mb-3 text-gray-300" />
              <p className="text-gray-500 font-medium">등록된 과제가 없습니다</p>
              <Link href="/teacher/assignments/new"><Button variant="link" className="mt-2">새 과제 만들기</Button></Link>
            </CardContent>
          </Card>
        ) : selectedClass === 'all' ? (
          /* 반 미선택: 과제 목록만 표시 */
          <table className="w-full text-sm border-collapse">
            <thead className="sticky top-0 z-10 bg-gray-100">
              <tr>
                <th className="border-b border-r px-4 py-2.5 text-left font-medium text-gray-600">과제명</th>
                <th className="border-b border-r px-4 py-2.5 text-left font-medium text-gray-600 w-24">교과</th>
                <th className="border-b border-r px-4 py-2.5 text-left font-medium text-gray-600 w-36">마감일시</th>
                <th className="border-b px-4 py-2.5 text-center font-medium text-gray-600 w-28">관리</th>
              </tr>
            </thead>
            <tbody>
              {filteredAssignments.map((a, idx) => (
                <tr key={a.id} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                  <td className="border-b border-r px-4 py-2">
                    <Link href={`/teacher/assignments/${a.id}`} className="font-medium text-blue-600 hover:underline">
                      {a.title}
                    </Link>
                  </td>
                  <td className="border-b border-r px-4 py-2 text-gray-500 text-xs">
                    {(a as unknown as { subject?: string }).subject ?? '-'}
                  </td>
                  <td className="border-b border-r px-4 py-2">
                    {a.deadline ? (
                      <span className={`flex items-center gap-1 text-xs ${a.isOverdue ? 'text-red-500' : 'text-gray-500'}`}>
                        <Clock className="w-3 h-3" />
                        {formatDateTime(a.deadline)}
                        {a.isOverdue && <span className="ml-1 bg-red-100 text-red-600 px-1.5 py-0.5 rounded text-[10px] font-medium">마감</span>}
                      </span>
                    ) : <span className="text-xs text-gray-300">기한 없음</span>}
                  </td>
                  <td className="border-b px-4 py-2 text-center">
                    <div className="flex items-center justify-center gap-1">
                      <Link href={`/teacher/assignments/${a.id}`}>
                        <Button variant="outline" size="sm" className="h-7 text-xs">현황</Button>
                      </Link>
                      <Link href={`/teacher/assignments/${a.id}/edit`}>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-gray-400 hover:text-blue-600">
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                      </Link>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-red-400 hover:text-red-600"
                        onClick={() => deleteAssignment(a.id, a.title)}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          /* 반 선택: 학생 × 과제 매트릭스 표 */
          <table className="text-sm border-collapse" style={{ minWidth: 'max-content' }}>
            <thead className="sticky top-0 z-10 bg-gray-100">
              <tr>
                <th className="border-b border-r px-3 py-2 text-center font-medium text-gray-600 w-10 sticky left-0 bg-gray-100 z-20">번호</th>
                <th className="border-b border-r px-3 py-2 text-left font-medium text-gray-600 w-24 sticky left-10 bg-gray-100 z-20">이름</th>
                {filteredAssignments.map(a => (
                  <th key={a.id} className="border-b border-r px-2 py-1.5 font-medium text-gray-600 w-32">
                    <div className="flex flex-col items-center gap-0.5">
                      <Link href={`/teacher/assignments/${a.id}`}
                        className="text-blue-600 hover:underline truncate max-w-[120px] block text-center text-xs leading-tight">
                        {a.title}
                      </Link>
                      {a.deadline && (
                        <span className={`text-[10px] ${a.isOverdue ? 'text-red-400' : 'text-gray-400'}`}>
                          {formatDate(a.deadline, 'MM.dd')} 마감
                        </span>
                      )}
                      <div className="flex items-center gap-1 mt-0.5">
                        <Link href={`/teacher/assignments/${a.id}/edit`}>
                          <Pencil className="w-3 h-3 text-gray-300 hover:text-blue-500" />
                        </Link>
                        <button
                          onClick={() => deleteAssignment(a.id, a.title)}
                          className="text-red-300 hover:text-red-500"
                          title="과제 삭제"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {students.length === 0 ? (
                <tr>
                  <td colSpan={filteredAssignments.length + 2} className="py-16 text-center text-gray-400">
                    이 반에 배정된 학생이 없습니다.
                  </td>
                </tr>
              ) : students.map((s, idx) => (
                <tr key={s.id} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                  <td className={`border-b border-r px-3 py-2 text-center text-gray-500 text-xs sticky left-0 z-10 ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}>
                    {s.student_number ?? idx + 1}
                  </td>
                  <td className={`border-b border-r px-3 py-2 font-medium text-gray-900 sticky left-10 z-10 ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}>
                    {s.name}
                  </td>
                  {filteredAssignments.map(a => {
                    const sub = subMap[s.id]?.[a.id] ?? null
                    const status = getSubmissionStatus(a.deadline ?? null, sub?.submitted_at ?? null)
                    const label = SUBMISSION_STATUS_LABELS[status]
                    const color = SUBMISSION_STATUS_COLORS[status]
                    return (
                      <td key={a.id} className="border-b border-r px-2 py-2 text-center">
                        <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${color}`}>
                          {label}
                        </span>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
