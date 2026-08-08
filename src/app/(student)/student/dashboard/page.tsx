import { createClient } from '@/lib/supabase/server'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { BookOpen, Award, MessageSquare, Clock } from 'lucide-react'
import Link from 'next/link'
import { formatDateTime, getSubmissionStatus, SUBMISSION_STATUS_LABELS, SUBMISSION_STATUS_COLORS } from '@/lib/utils'
import type { Assignment } from '@/lib/types'

export default async function StudentDashboard() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: profile } = await supabase.from('profiles').select('*, classes(name)').eq('id', user.id).single()
  const cls = profile?.classes as unknown as { name: string } | null

  // 배포된 과제 (내 반에 배포된 것)
  const { data: assignmentClasses } = await supabase
    .from('assignment_classes')
    .select('assignment_id')
    .eq('class_id', profile?.class_id ?? '')

  const assignmentIds = (assignmentClasses ?? []).map(r => r.assignment_id)

  const { data: assignments } = assignmentIds.length > 0
    ? await supabase.from('assignments').select('*').in('id', assignmentIds).order('deadline', { ascending: true })
    : { data: [] as Assignment[] }

  const { data: mySubmissions } = await supabase
    .from('assignment_submissions')
    .select('*')
    .eq('student_id', user.id)

  const submittedIds = new Set((mySubmissions ?? []).map(s => s.assignment_id))

  // 미제출 과제
  const pendingAssignments = (assignments ?? []).filter(a => !submittedIds.has(a.id))

  // 피드백 있는 제출
  const withFeedback = (mySubmissions ?? []).filter(s => s.feedback)

  // 배지
  const { data: myBadges } = await supabase
    .from('student_badges')
    .select('*, badges(*)')
    .eq('student_id', user.id)

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">안녕하세요, {profile?.name}님! 👋</h1>
        <p className="text-gray-500 text-sm mt-1">{cls?.name ?? ''}</p>
      </div>

      {/* 통계 */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-3xl font-bold text-orange-500">{pendingAssignments.length}</p>
            <p className="text-sm text-gray-500 mt-1">미제출 과제</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-3xl font-bold text-blue-500">{withFeedback.length}</p>
            <p className="text-sm text-gray-500 mt-1">받은 피드백</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-3xl font-bold text-yellow-500">{myBadges?.length ?? 0}</p>
            <p className="text-sm text-gray-500 mt-1">획득 배지</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 미제출 과제 */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-orange-500" />
              미제출 과제
            </CardTitle>
          </CardHeader>
          <CardContent>
            {pendingAssignments.length === 0 ? (
              <div className="text-center py-6 text-gray-400">
                <p className="text-sm">모든 과제를 제출했습니다! 🎉</p>
              </div>
            ) : (
              <div className="space-y-2">
                {pendingAssignments.slice(0, 5).map(a => (
                  <Link key={a.id} href={`/student/assignments/${a.id}`}>
                    <div className="flex items-center justify-between p-3 bg-orange-50 border border-orange-100 rounded-lg hover:bg-orange-100 transition-colors">
                      <span className="font-medium text-gray-800 text-sm">{a.title}</span>
                      {a.deadline && (
                        <span className="text-xs text-orange-600 flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {formatDateTime(a.deadline)}
                        </span>
                      )}
                    </div>
                  </Link>
                ))}
                {pendingAssignments.length > 5 && (
                  <Link href="/student/assignments" className="block text-center text-sm text-blue-500 hover:underline">
                    {pendingAssignments.length - 5}개 더 보기
                  </Link>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* 최근 피드백 */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-blue-500" />
              최근 피드백
            </CardTitle>
          </CardHeader>
          <CardContent>
            {withFeedback.length === 0 ? (
              <div className="text-center py-6 text-gray-400">
                <p className="text-sm">아직 받은 피드백이 없습니다</p>
              </div>
            ) : (
              <div className="space-y-2">
                {withFeedback.slice(0, 3).map(sub => {
                  const status = getSubmissionStatus(null, sub.submitted_at)
                  return (
                    <div key={sub.id} className="p-3 bg-blue-50 border border-blue-100 rounded-lg">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${SUBMISSION_STATUS_COLORS[status]}`}>
                          {SUBMISSION_STATUS_LABELS[status]}
                        </span>
                        <span className="text-xs text-gray-400">{sub.feedback_at ? formatDateTime(sub.feedback_at) : ''}</span>
                      </div>
                      <p className="text-sm text-gray-700 line-clamp-2">{sub.feedback}</p>
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* 내 배지 */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Award className="w-4 h-4 text-yellow-500" />
              내 배지
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!myBadges || myBadges.length === 0 ? (
              <div className="text-center py-6 text-gray-400">
                <Award className="w-8 h-8 mx-auto mb-2 opacity-30" />
                <p className="text-sm">아직 받은 배지가 없습니다</p>
              </div>
            ) : (
              <div className="flex flex-wrap gap-3">
                {myBadges.map(sb => {
                  const badge = sb.badges as unknown as { icon: string; name: string; description: string }
                  return (
                    <div key={sb.id} className="flex items-center gap-2 bg-yellow-50 border border-yellow-200 rounded-xl px-4 py-2.5">
                      <span className="text-2xl">{badge?.icon}</span>
                      <div>
                        <p className="text-sm font-semibold text-yellow-800">{badge?.name}</p>
                        {badge?.description && <p className="text-xs text-yellow-600">{badge.description}</p>}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
