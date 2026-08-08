'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { BookOpen, Clock, MessageSquare } from 'lucide-react'
import { formatDateTime, getSubmissionStatus, SUBMISSION_STATUS_LABELS, SUBMISSION_STATUS_COLORS } from '@/lib/utils'
import type { Assignment, AssignmentSubmission } from '@/lib/types'

interface AssignmentWithStatus extends Assignment {
  submission: AssignmentSubmission | null
  statusLabel: string
  statusColor: string
}

export default function StudentAssignmentsPage() {
  const supabase = createClient()
  const [assignments, setAssignments] = useState<AssignmentWithStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [filterStatus, setFilterStatus] = useState('all')

  const fetchData = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data: profile } = await supabase.from('profiles').select('class_id').eq('id', user.id).single()
    if (!profile?.class_id) { setLoading(false); return }

    const { data: ac } = await supabase.from('assignment_classes').select('assignment_id').eq('class_id', profile.class_id)
    const ids = (ac ?? []).map(r => r.assignment_id)
    if (ids.length === 0) { setLoading(false); return }

    const [{ data: asgns }, { data: subs }] = await Promise.all([
      supabase.from('assignments').select('*').in('id', ids).order('deadline', { ascending: true }),
      supabase.from('assignment_submissions').select('*').eq('student_id', user.id).in('assignment_id', ids),
    ])

    const subMap = new Map((subs ?? []).map(s => [s.assignment_id, s]))
    const enriched = (asgns ?? []).map(a => {
      const sub = subMap.get(a.id) ?? null
      const status = getSubmissionStatus(a.deadline, sub?.submitted_at ?? null)
      return { ...a, submission: sub, statusLabel: SUBMISSION_STATUS_LABELS[status], statusColor: SUBMISSION_STATUS_COLORS[status] }
    })
    setAssignments(enriched)
    setLoading(false)
  }, [supabase])

  useEffect(() => { fetchData() }, [fetchData])

  const filtered = assignments.filter(a => {
    if (filterStatus === 'all') return true
    const status = getSubmissionStatus(a.deadline, a.submission?.submitted_at ?? null)
    return status === filterStatus
  })

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">과제 제출</h1>
          <p className="text-gray-500 text-sm mt-1">총 {assignments.length}개 과제</p>
        </div>
        <Select value={filterStatus} onValueChange={(v) => setFilterStatus(v ?? 'all')}>
          <SelectTrigger className="w-40"><SelectValue placeholder="전체" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">전체</SelectItem>
            <SelectItem value="pre">제출 전</SelectItem>
            <SelectItem value="submitted">제출 완료</SelectItem>
            <SelectItem value="late">사후 제출</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400">불러오는 중...</div>
      ) : filtered.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center">
            <BookOpen className="w-12 h-12 mx-auto mb-3 text-gray-300" />
            <p className="text-gray-500">과제가 없습니다</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map(a => (
            <Link key={a.id} href={`/student/assignments/${a.id}`}>
              <Card className="hover:shadow-md transition-shadow cursor-pointer">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-semibold text-gray-900">{a.title}</h3>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${a.statusColor}`}>{a.statusLabel}</span>
                      </div>
                      {a.deadline && (
                        <p className="text-xs text-gray-500 flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          마감: {formatDateTime(a.deadline)}
                        </p>
                      )}
                      {a.submission?.feedback && (
                        <div className="mt-2 flex items-start gap-1.5 p-2 bg-blue-50 rounded text-xs text-blue-700">
                          <MessageSquare className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                          <span className="line-clamp-1">{a.submission.feedback}</span>
                        </div>
                      )}
                    </div>
                    {a.submission?.submitted_at && (
                      <p className="text-xs text-gray-400 ml-4 flex-shrink-0">
                        {formatDateTime(a.submission.submitted_at)} 제출
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
