import { createClient } from '@/lib/supabase/server'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Users, BookOpen, ClipboardList, Eye, School } from 'lucide-react'
import Link from 'next/link'
import { formatDate } from '@/lib/utils'
import { fetchMyClassIds } from '@/lib/my-classes'

export default async function TeacherDashboard() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  // 반·학생은 «담당» 기준(class_teachers)으로 센다. classes.teacher_id 로 세면
  // 반을 만들지 않은 교사에게는 반 0개 · 학생 0명으로 나온다.
  const { ids: myClassIds } = await fetchMyClassIds(supabase, user.id)

  const [
    { data: classes },
    { count: studentCount },
    { count: assessmentCount },
    { data: assignments },
    { data: recentObs },
    { data: pendingSubs },
  ] = await Promise.all([
    myClassIds.length
      ? supabase.from('classes').select('id, name').in('id', myClassIds).order('name')
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    myClassIds.length
      ? supabase.from('profiles').select('*', { count: 'exact', head: true })
          .eq('role', 'student').in('class_id', myClassIds)
      : Promise.resolve({ count: 0 }),
    supabase.from('assessments').select('*', { count: 'exact', head: true }).eq('teacher_id', user.id),
    supabase.from('assignments').select('id, title, deadline').eq('teacher_id', user.id).order('deadline', { ascending: true }).limit(5),
    supabase.from('observations').select('id, content, observed_at, profiles(name)').eq('teacher_id', user.id).order('observed_at', { ascending: false }).limit(5),
    supabase.from('assignment_submissions').select('id, assignment_id, submitted_at, profiles(name), assignments(title, deadline)').order('submitted_at', { ascending: false }).limit(5),
  ])

  const stats = [
    { label: '담당 반', value: classes?.length ?? 0, icon: School, color: 'bg-blue-500', href: '/teacher/classes' },
    { label: '전체 학생', value: studentCount ?? 0, icon: Users, color: 'bg-green-500', href: '/teacher/students' },
    { label: '평가', value: assessmentCount ?? 0, icon: ClipboardList, color: 'bg-purple-500', href: '/teacher/assessments' },
    { label: '최근 관찰', value: recentObs?.length ?? 0, icon: Eye, color: 'bg-orange-500', href: '/teacher/observations' },
  ]

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">대시보드</h1>
        <p className="text-gray-500 text-sm mt-1">오늘도 좋은 수업 되세요 👋</p>
      </div>

      {/* 통계 카드 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map(({ label, value, icon: Icon, color, href }) => (
          <Link key={label} href={href}>
            <Card className="hover:shadow-md transition-shadow cursor-pointer">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-500">{label}</p>
                    <p className="text-3xl font-bold text-gray-900 mt-1">{value}</p>
                  </div>
                  <div className={`w-12 h-12 ${color} rounded-xl flex items-center justify-center`}>
                    <Icon className="w-6 h-6 text-white" />
                  </div>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 담당 반 목록 */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <School className="w-4 h-4 text-blue-500" />
              담당 반
            </CardTitle>
          </CardHeader>
          <CardContent>
            {classes && classes.length > 0 ? (
              <div className="space-y-2">
                {classes.map(cls => (
                  <Link key={cls.id} href={`/teacher/classes`}>
                    <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-blue-50 transition-colors">
                      <span className="font-medium text-gray-800">{cls.name}</span>
                      <span className="text-xs text-blue-600">→</span>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="text-center py-6 text-gray-400">
                <School className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">등록된 반이 없습니다</p>
                <Link href="/teacher/classes" className="text-blue-500 text-sm hover:underline mt-1 inline-block">
                  반 추가하기
                </Link>
              </div>
            )}
          </CardContent>
        </Card>

        {/* 과제 마감 현황 */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-green-500" />
              과제 마감 현황
            </CardTitle>
          </CardHeader>
          <CardContent>
            {assignments && assignments.length > 0 ? (
              <div className="space-y-2">
                {assignments.map(a => (
                  <Link key={a.id} href={`/teacher/assignments/${a.id}`}>
                    <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-green-50 transition-colors">
                      <span className="font-medium text-gray-800 text-sm truncate flex-1">{a.title}</span>
                      {a.deadline && (
                        <span className="text-xs text-gray-500 ml-2 flex-shrink-0">
                          {formatDate(a.deadline)}
                        </span>
                      )}
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="text-center py-6 text-gray-400">
                <BookOpen className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">등록된 과제가 없습니다</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* 최근 제출 */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <ClipboardList className="w-4 h-4 text-purple-500" />
              최근 과제 제출
            </CardTitle>
          </CardHeader>
          <CardContent>
            {pendingSubs && pendingSubs.length > 0 ? (
              <div className="space-y-2">
                {pendingSubs.map(sub => {
                  const s = sub as unknown as {
                    id: string; submitted_at: string;
                    profiles: { name: string };
                    assignments: { title: string }
                  }
                  return (
                    <div key={s.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                      <div>
                        <p className="text-sm font-medium text-gray-800">{s.profiles?.name}</p>
                        <p className="text-xs text-gray-500">{s.assignments?.title}</p>
                      </div>
                      <span className="text-xs text-gray-400">{formatDate(s.submitted_at)}</span>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="text-center py-6 text-gray-400">
                <p className="text-sm">최근 제출이 없습니다</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* 최근 관찰일지 */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Eye className="w-4 h-4 text-orange-500" />
              최근 관찰일지
            </CardTitle>
          </CardHeader>
          <CardContent>
            {recentObs && recentObs.length > 0 ? (
              <div className="space-y-2">
                {recentObs.map(obs => {
                  const o = obs as unknown as {
                    id: string; content: string; observed_at: string;
                    profiles: { name: string }
                  }
                  return (
                    <div key={o.id} className="p-3 bg-gray-50 rounded-lg">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium text-gray-800">{o.profiles?.name}</span>
                        <span className="text-xs text-gray-400">{formatDate(o.observed_at)}</span>
                      </div>
                      <p className="text-xs text-gray-600 line-clamp-2">{o.content}</p>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="text-center py-6 text-gray-400">
                <Eye className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">관찰 기록이 없습니다</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
