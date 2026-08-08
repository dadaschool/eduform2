'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { toast } from 'sonner'
import { ChevronLeft, Send, Clock, MessageSquare, CheckCircle } from 'lucide-react'
import Link from 'next/link'
import { formatDateTime, getSubmissionStatus, SUBMISSION_STATUS_LABELS, SUBMISSION_STATUS_COLORS } from '@/lib/utils'
import type { Assignment, AssignmentSubmission } from '@/lib/types'
import { useParams } from 'next/navigation'

export default function StudentAssignmentDetailPage() {
  const params = useParams()
  const id = params.id as string
  const supabase = createClient()
  const [assignment, setAssignment] = useState<Assignment | null>(null)
  const [submission, setSubmission] = useState<AssignmentSubmission | null>(null)
  const [content, setContent] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const [{ data: asng }, { data: sub }] = await Promise.all([
      supabase.from('assignments').select('*').eq('id', id).single(),
      supabase.from('assignment_submissions').select('*').eq('assignment_id', id).eq('student_id', user.id).single(),
    ])
    setAssignment(asng)
    if (sub) { setSubmission(sub); setContent(sub.content) }
    setLoading(false)
  }, [id, supabase])

  useEffect(() => { fetchData() }, [fetchData])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!content.trim()) { toast.error('내용을 입력해 주세요'); return }
    setSubmitting(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('인증 필요')
      const { error } = await supabase.from('assignment_submissions').upsert({
        assignment_id: id,
        student_id: user.id,
        content: content.trim(),
        submitted_at: new Date().toISOString(),
      }, { onConflict: 'assignment_id,student_id' })
      if (error) throw error
      toast.success('과제가 제출되었습니다!')
      fetchData()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : '제출 실패')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return <div className="p-6 text-center text-gray-400">불러오는 중...</div>
  if (!assignment) return <div className="p-6 text-center text-gray-400">과제를 찾을 수 없습니다.</div>

  const status = getSubmissionStatus(assignment.deadline, submission?.submitted_at ?? null)

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/student/assignments">
          <Button variant="ghost" size="icon"><ChevronLeft className="w-5 h-5" /></Button>
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-gray-900">{assignment.title}</h1>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${SUBMISSION_STATUS_COLORS[status]}`}>
              {SUBMISSION_STATUS_LABELS[status]}
            </span>
          </div>
          {assignment.deadline && (
            <p className="text-sm text-gray-500 flex items-center gap-1 mt-0.5">
              <Clock className="w-3.5 h-3.5" />
              마감: {formatDateTime(assignment.deadline)}
            </p>
          )}
        </div>
      </div>

      {/* 과제 내용 */}
      <Card className="bg-blue-50 border-blue-200">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-blue-700">과제 안내</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-blue-800 whitespace-pre-wrap">{assignment.description}</p>
        </CardContent>
      </Card>

      {/* 피드백 표시 */}
      {submission?.feedback && (
        <Card className="border-green-200 bg-green-50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-green-700 flex items-center gap-2">
              <MessageSquare className="w-4 h-4" />
              선생님 피드백
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-green-800 whitespace-pre-wrap">{submission.feedback}</p>
            {submission.feedback_at && (
              <p className="text-xs text-green-600 mt-2">{formatDateTime(submission.feedback_at)}</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* 제출 폼 */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            {submission ? <CheckCircle className="w-4 h-4 text-green-500" /> : <Send className="w-4 h-4 text-blue-500" />}
            {submission ? '제출 내용 (수정 가능)' : '과제 제출'}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <Textarea
              placeholder="과제 내용을 작성하세요..."
              value={content}
              onChange={e => setContent(e.target.value)}
              rows={12}
              className="text-sm leading-relaxed resize-y"
            />
            <div className="flex items-center justify-between">
              <p className="text-xs text-gray-400">{content.length}자</p>
              <Button type="submit" className="gap-2 bg-green-600 hover:bg-green-700" disabled={submitting}>
                <Send className="w-4 h-4" />
                {submitting ? '제출 중...' : submission ? '수정 제출' : '과제 제출'}
              </Button>
            </div>
          </form>
          {submission?.submitted_at && (
            <p className="text-xs text-gray-400 mt-2">
              마지막 제출: {formatDateTime(submission.submitted_at)}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
