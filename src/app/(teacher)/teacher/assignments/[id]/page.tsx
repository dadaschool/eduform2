'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { toast } from 'sonner'
import { ChevronLeft, Clock, Save } from 'lucide-react'
import Link from 'next/link'
import { formatDateTime, getSubmissionStatus, SUBMISSION_STATUS_LABELS, SUBMISSION_STATUS_COLORS } from '@/lib/utils'
import type { Assignment, Class, Profile, AssignmentSubmission } from '@/lib/types'
import { useParams } from 'next/navigation'

interface StudentRow {
  student: Profile
  submission: AssignmentSubmission | null
  status: 'submitted' | 'late' | 'pre'
}

export default function AssignmentDetailPage() {
  const params = useParams()
  const id = params.id as string
  const supabase = createClient()
  const [assignment, setAssignment] = useState<Assignment | null>(null)
  const [classes, setClasses] = useState<Class[]>([])
  const [rows, setRows] = useState<StudentRow[]>([])
  const [selectedClass, setSelectedClass] = useState('all')
  const [feedbackMap, setFeedbackMap] = useState<Record<string, string>>({})
  const [savingFeedback, setSavingFeedback] = useState<string | null>(null)
  const [viewSub, setViewSub] = useState<StudentRow | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const [{ data: asng }, { data: ac }] = await Promise.all([
      supabase.from('assignments').select('*').eq('id', id).single(),
      supabase.from('assignment_classes').select('class_id').eq('assignment_id', id),
    ])
    setAssignment(asng)

    const classIds = (ac ?? []).map(r => r.class_id)
    const { data: cls } = await supabase.from('classes').select('*').in('id', classIds.length > 0 ? classIds : ['none'])
    setClasses(cls ?? [])
    if (cls && cls.length > 0) setSelectedClass(cls[0].id)

    // 범위는 «과제가 배포된 반» 이 정한다. 담임 관계로 좁히면 교과 담당
    // 교사에게 학생이 한 명도 안 나온다. 그 밖은 RLS 가 막는다.
    const { data: studs } = await supabase.from('profiles').select('*')
      .eq('role', 'student')
      .in('class_id', classIds.length > 0 ? classIds : ['none'])
      .order('student_number').order('name')

    const { data: subs } = await supabase.from('assignment_submissions').select('*').eq('assignment_id', id)

    const subMap: Record<string, AssignmentSubmission> = {}
    ;(subs ?? []).forEach(s => { subMap[s.student_id] = s })

    const built: StudentRow[] = (studs ?? []).map(s => {
      const sub = subMap[s.id] ?? null
      const status = getSubmissionStatus(asng?.deadline ?? null, sub?.submitted_at ?? null)
      return { student: s, submission: sub, status }
    })
    setRows(built)

    const fm: Record<string, string> = {}
    ;(subs ?? []).forEach(s => { if (s.feedback) fm[s.student_id] = s.feedback })
    setFeedbackMap(fm)
    setLoading(false)
  }, [id, supabase])

  useEffect(() => { fetchData() }, [fetchData])

  async function saveFeedback(row: StudentRow) {
    if (!row.submission) return
    setSavingFeedback(row.student.id)
    const { data: { user } } = await supabase.auth.getUser()
    const { error } = await supabase.from('assignment_submissions').update({
      feedback: feedbackMap[row.student.id] ?? '',
      feedback_at: new Date().toISOString(),
      feedback_by: user?.id,
    }).eq('id', row.submission.id)
    if (error) toast.error('피드백 저장 실패')
    else toast.success('피드백 저장 완료')
    setSavingFeedback(null)
  }

  const filteredRows = selectedClass === 'all'
    ? rows
    : rows.filter(r => r.student.class_id === selectedClass)

  const submittedCount = filteredRows.filter(r => r.status !== 'pre').length
  const totalCount = filteredRows.length

  if (loading) return <div className="p-6 text-center text-gray-400">불러오는 중...</div>
  if (!assignment) return <div className="p-6 text-center text-gray-400">과제를 찾을 수 없습니다.</div>

  return (
    <div className="flex flex-col h-screen">
      {/* 상단 헤더 */}
      <div className="p-4 border-b bg-white space-y-3 flex-shrink-0">
        <div className="flex items-center gap-3">
          <Link href="/teacher/assignments">
            <Button variant="ghost" size="icon"><ChevronLeft className="w-5 h-5" /></Button>
          </Link>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold text-gray-900 truncate">{assignment.title}</h1>
            {assignment.deadline && (
              <p className="text-sm text-gray-500 flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" />
                마감: {formatDateTime(assignment.deadline)}
              </p>
            )}
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
            <span className="text-sm text-gray-500">
              제출 <span className="font-bold text-green-600">{submittedCount}</span> / {totalCount}명
            </span>
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
        </div>
        {/* 과제 내용 */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-2">
          <p className="text-sm text-blue-800 line-clamp-2 whitespace-pre-wrap">{assignment.description}</p>
        </div>
      </div>

      {/* 테이블 */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm border-collapse">
          <thead className="sticky top-0 z-10 bg-gray-100">
            <tr>
              <th className="border-b border-r px-3 py-2 text-left font-medium text-gray-600 w-8">번호</th>
              <th className="border-b border-r px-3 py-2 text-left font-medium text-gray-600 w-24">이름</th>
              <th className="border-b border-r px-3 py-2 text-center font-medium text-gray-600 w-20">상태</th>
              <th className="border-b border-r px-3 py-2 text-center font-medium text-gray-600 w-20">제출일시</th>
              <th className="border-b border-r px-3 py-2 text-center font-medium text-gray-600 w-24">내용 확인</th>
              <th className="border-b px-3 py-2 text-left font-medium text-gray-600">피드백</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((row, idx) => {
              const statusLabel = SUBMISSION_STATUS_LABELS[row.status]
              const statusColor = SUBMISSION_STATUS_COLORS[row.status]
              const hasFeedback = !!row.submission?.feedback
              return (
                <tr key={row.student.id} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                  <td className="border-b border-r px-3 py-2 text-center text-gray-500 text-xs">
                    {row.student.student_number ?? idx + 1}
                  </td>
                  <td className="border-b border-r px-3 py-2 font-medium text-gray-900">
                    {row.student.name}
                  </td>
                  <td className="border-b border-r px-2 py-2 text-center">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColor}`}>
                      {statusLabel}
                    </span>
                  </td>
                  <td className="border-b border-r px-2 py-2 text-center text-xs text-gray-400">
                    {row.submission ? formatDateTime(row.submission.submitted_at).slice(5) : '-'}
                  </td>
                  <td className="border-b border-r px-2 py-2 text-center">
                    {row.submission ? (
                      <button
                        onClick={() => setViewSub(row)}
                        className="text-xs text-blue-600 hover:underline"
                      >
                        보기
                      </button>
                    ) : (
                      <span className="text-xs text-gray-300">-</span>
                    )}
                  </td>
                  <td className="border-b px-2 py-1.5">
                    {row.submission ? (
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          placeholder="피드백 입력..."
                          value={feedbackMap[row.student.id] ?? ''}
                          onChange={e => setFeedbackMap(prev => ({ ...prev, [row.student.id]: e.target.value }))}
                          className="flex-1 text-xs border rounded px-2 py-1 min-w-0 focus:outline-none focus:ring-1 focus:ring-blue-400"
                        />
                        <button
                          onClick={() => saveFeedback(row)}
                          disabled={savingFeedback === row.student.id}
                          className={`flex-shrink-0 p-1 rounded ${hasFeedback ? 'text-green-500' : 'text-gray-400'} hover:text-blue-500`}
                          title="피드백 저장"
                        >
                          <Save className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <span className="text-xs text-gray-300 px-2">미제출</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>

        {filteredRows.length === 0 && (
          <div className="py-16 text-center text-gray-400 text-sm">이 반에 배정된 학생이 없습니다.</div>
        )}
      </div>

      {/* 제출 내용 확인 다이얼로그 */}
      <Dialog open={!!viewSub} onOpenChange={open => !open && setViewSub(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{viewSub?.student.name} — 제출 내용</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="bg-gray-50 rounded-lg p-4 max-h-60 overflow-y-auto">
              <p className="text-sm text-gray-700 whitespace-pre-wrap">{viewSub?.submission?.content}</p>
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium text-gray-700">피드백</p>
              <Textarea
                placeholder="피드백을 입력하세요..."
                value={viewSub ? (feedbackMap[viewSub.student.id] ?? '') : ''}
                onChange={e => viewSub && setFeedbackMap(prev => ({ ...prev, [viewSub.student.id]: e.target.value }))}
                rows={3}
              />
              <Button size="sm" onClick={() => { if (viewSub) { saveFeedback(viewSub); setViewSub(null) } }}>
                피드백 저장
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
