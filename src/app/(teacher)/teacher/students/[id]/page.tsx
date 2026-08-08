'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ChevronLeft, BookOpen, ClipboardList, Eye, Award, MessageCircle } from 'lucide-react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { formatDate, formatDateTime, getSubmissionStatus, SUBMISSION_STATUS_LABELS, SUBMISSION_STATUS_COLORS } from '@/lib/utils'
import type { Profile, Class, Badge as BadgeType, StudentBadge, Assignment, AssignmentSubmission, Assessment, AssessmentItem, StudentAssessmentCheck, Observation } from '@/lib/types'

interface AssignmentRow {
  assignment: Assignment
  submission: AssignmentSubmission | null
  status: 'pre' | 'submitted' | 'late'
}

interface AssessmentRow {
  assessment: Assessment
  items: AssessmentItem[]
  checks: StudentAssessmentCheck[]
}

export default function StudentDetailPage() {
  const params = useParams()
  const id = params.id as string
  const supabase = createClient()

  const [student, setStudent] = useState<Profile | null>(null)
  const [classObj, setClassObj] = useState<Class | null>(null)
  const [badgeRecords, setBadgeRecords] = useState<StudentBadge[]>([])
  const [assignmentRows, setAssignmentRows] = useState<AssignmentRow[]>([])
  const [assessmentRows, setAssessmentRows] = useState<AssessmentRow[]>([])
  const [observations, setObservations] = useState<Observation[]>([])
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    // 학생 기본 정보
    const { data: s } = await supabase.from('profiles').select('*').eq('id', id).single()
    setStudent(s)

    if (s?.class_id) {
      const { data: cls } = await supabase.from('classes').select('*').eq('id', s.class_id).single()
      setClassObj(cls)
    }

    // 배지
    const { data: sb } = await supabase
      .from('student_badges')
      .select('*, badges(*)')
      .eq('student_id', id)
      .order('awarded_at', { ascending: false })
    setBadgeRecords((sb ?? []).map(r => ({ ...r, badge: r.badges as unknown as BadgeType })))

    // 과제 제출 현황
    const { data: ac } = await supabase.from('assignment_classes').select('assignment_id')
      .in('class_id', s?.class_id ? [s.class_id] : ['none'])
    const asgIds = (ac ?? []).map(r => r.assignment_id)
    if (asgIds.length > 0) {
      const [{ data: asgns }, { data: subs }] = await Promise.all([
        supabase.from('assignments').select('*').in('id', asgIds).order('created_at', { ascending: false }),
        supabase.from('assignment_submissions').select('*').eq('student_id', id),
      ])
      const subMap: Record<string, AssignmentSubmission> = {}
      ;(subs ?? []).forEach(s => { subMap[s.assignment_id] = s })
      setAssignmentRows((asgns ?? []).map(a => {
        const sub = subMap[a.id] ?? null
        return { assignment: a, submission: sub, status: getSubmissionStatus(a.deadline, sub?.submitted_at ?? null) }
      }))
    }

    // 평가 체크 현황
    const { data: asmtCls } = await supabase.from('assessment_classes').select('assessment_id')
      .in('class_id', s?.class_id ? [s.class_id] : ['none'])
    const asmtIds = (asmtCls ?? []).map(r => r.assessment_id)
    if (asmtIds.length > 0) {
      const [{ data: asmts }, { data: items }, { data: checks }] = await Promise.all([
        supabase.from('assessments').select('*').in('id', asmtIds).order('created_at', { ascending: false }),
        supabase.from('assessment_items').select('*').in('assessment_id', asmtIds).order('display_order'),
        supabase.from('student_assessment_checks').select('*').eq('student_id', id),
      ])
      const itemsByAsmt: Record<string, AssessmentItem[]> = {}
      ;(items ?? []).forEach(i => { if (!itemsByAsmt[i.assessment_id]) itemsByAsmt[i.assessment_id] = []; itemsByAsmt[i.assessment_id].push(i) })
      const checksByItemId: Record<string, StudentAssessmentCheck> = {}
      ;(checks ?? []).forEach(c => { checksByItemId[c.assessment_item_id] = c })
      setAssessmentRows((asmts ?? []).map(a => ({
        assessment: a,
        items: itemsByAsmt[a.id] ?? [],
        checks: (itemsByAsmt[a.id] ?? []).map(i => checksByItemId[i.id]).filter(Boolean) as StudentAssessmentCheck[],
      })))
    }

    // 관찰 기록
    const { data: obs } = await supabase.from('observations').select('*')
      .eq('student_id', id).order('observed_at', { ascending: false })
    setObservations(obs ?? [])

    setLoading(false)
  }, [id, supabase])

  useEffect(() => { fetchData() }, [fetchData])

  if (loading) return <div className="p-6 text-center text-gray-400">불러오는 중...</div>
  if (!student) return <div className="p-6 text-center text-gray-400">학생을 찾을 수 없습니다.</div>

  const submittedCount = assignmentRows.filter(r => r.status !== 'pre').length
  const badgeGroups = Object.values(
    badgeRecords.reduce((acc, r) => {
      if (!acc[r.badge_id]) acc[r.badge_id] = { badge: r.badge!, count: 0 }
      acc[r.badge_id].count++
      return acc
    }, {} as Record<string, { badge: BadgeType; count: number }>)
  )

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* 헤더 */}
      <div className="flex items-center gap-3">
        <Link href="/teacher/students">
          <Button variant="ghost" size="icon"><ChevronLeft className="w-5 h-5" /></Button>
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-900">{student.name}</h1>
          <p className="text-sm text-gray-500">{classObj?.name ?? '미배정'} · 학번 {student.student_number ?? '-'} · {student.email}</p>
        </div>
        <Link href={`/teacher/messages?to=${id}`}>
          <Button variant="outline" className="gap-2">
            <MessageCircle className="w-4 h-4" />쪽지 보내기
          </Button>
        </Link>
      </div>

      {/* 배지 */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Award className="w-4 h-4 text-yellow-500" />
            배지 <span className="text-sm font-normal text-gray-400">{badgeRecords.length}회 수여</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {badgeGroups.length === 0 ? (
            <p className="text-sm text-gray-400">수여된 배지 없음</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {badgeGroups.map(({ badge, count }) => (
                <div key={badge.id} className="flex items-center gap-1.5 bg-yellow-50 border border-yellow-200 rounded-full px-3 py-1.5">
                  <span className="text-xl">{badge.icon}</span>
                  <div>
                    <span className="text-sm font-medium text-yellow-800">{badge.name}</span>
                    {count > 1 && <span className="ml-1 text-xs font-bold text-yellow-600">×{count}</span>}
                    {badge.description && <p className="text-xs text-yellow-600">{badge.description}</p>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 과제 제출 현황 */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-blue-500" />
            과제 제출 현황
            <span className="text-sm font-normal text-gray-400">
              {submittedCount}/{assignmentRows.length}개 제출
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {assignmentRows.length === 0 ? (
            <p className="text-sm text-gray-400 px-6 pb-4">배정된 과제 없음</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left font-medium text-gray-600">과제명</th>
                  <th className="px-4 py-2 text-center font-medium text-gray-600 w-24">상태</th>
                  <th className="px-4 py-2 text-center font-medium text-gray-600 w-32">제출일시</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-600">피드백</th>
                </tr>
              </thead>
              <tbody>
                {assignmentRows.map((row, idx) => (
                  <tr key={row.assignment.id} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="px-4 py-2">
                      <Link href={`/teacher/assignments/${row.assignment.id}`} className="text-blue-600 hover:underline">
                        {row.assignment.title}
                      </Link>
                      {row.assignment.deadline && (
                        <span className="ml-2 text-xs text-gray-400">~{formatDate(row.assignment.deadline, 'MM.dd')}</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-center">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${SUBMISSION_STATUS_COLORS[row.status]}`}>
                        {SUBMISSION_STATUS_LABELS[row.status]}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-center text-xs text-gray-400">
                      {row.submission ? formatDateTime(row.submission.submitted_at).slice(5) : '-'}
                    </td>
                    <td className="px-4 py-2 text-xs text-gray-500">
                      {row.submission?.feedback ?? <span className="text-gray-300">-</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {/* 평가 체크 현황 */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <ClipboardList className="w-4 h-4 text-green-500" />
            평가 체크 현황
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {assessmentRows.length === 0 ? (
            <p className="text-sm text-gray-400">배정된 평가 없음</p>
          ) : assessmentRows.map(row => {
            const checkedCount = row.checks.filter(c => c.check_value && c.check_value !== 'X' && c.check_value !== '').length
            return (
              <div key={row.assessment.id} className="border rounded-lg overflow-hidden">
                <div className="flex items-center justify-between px-4 py-2 bg-gray-50 border-b">
                  <div>
                    <span className="font-medium text-sm text-gray-800">{row.assessment.title}</span>
                    {row.assessment.subject && <span className="ml-2 text-xs text-purple-600 bg-purple-50 px-1.5 py-0.5 rounded">{row.assessment.subject}</span>}
                  </div>
                  <span className="text-xs text-gray-400">{checkedCount}/{row.items.length}개 체크</span>
                </div>
                {row.items.length > 0 && (
                  <table className="w-full text-sm">
                    <tbody>
                      {row.items.map((item, idx) => {
                        const check = row.checks.find(c => c.assessment_item_id === item.id)
                        return (
                          <tr key={item.id} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                            <td className="px-4 py-1.5 text-gray-700">{item.name}</td>
                            <td className="px-4 py-1.5 text-center w-20">
                              {check?.check_value
                                ? <span className="text-xs font-medium text-green-700 bg-green-50 px-2 py-0.5 rounded">{check.check_value}</span>
                                : <span className="text-xs text-gray-300">-</span>}
                            </td>
                            <td className="px-4 py-1.5 text-xs text-gray-400">{check?.teacher_memo ?? ''}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            )
          })}
        </CardContent>
      </Card>

      {/* 관찰 기록 */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Eye className="w-4 h-4 text-orange-500" />
            관찰 기록 <span className="text-sm font-normal text-gray-400">{observations.length}건</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {observations.length === 0 ? (
            <p className="text-sm text-gray-400">관찰 기록 없음</p>
          ) : observations.map(obs => (
            <div key={obs.id} className="border rounded-lg px-4 py-3">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs text-gray-400">{formatDate(obs.observed_at)}</span>
                {obs.subject && <span className="text-xs bg-orange-50 text-orange-600 px-1.5 py-0.5 rounded">{obs.subject}</span>}
              </div>
              <p className="text-sm text-gray-700 whitespace-pre-wrap">{obs.content}</p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
