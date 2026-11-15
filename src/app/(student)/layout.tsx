import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { needsPasswordChange } from '@/lib/native-auth'
import StudentNav from '@/components/student/StudentNav'
import MessageNotifier from '@/components/student/MessageNotifier'
import NoProfileNotice from '@/components/NoProfileNotice'
import { routeForRole } from '@/lib/route-for-role'

export default async function StudentLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/student-login')
  // 임시 비밀번호(관리자·선생님이 정해 준 것)면 바꾸기 전에는 들어오지 못한다.
  if (await needsPasswordChange(user.id)) redirect('/change-password')

  const { data: profile } = await supabase.from('profiles').select('role, name').eq('id', user.id).single()
  if (!profile) return <NoProfileNotice email={user.email} />
  if (profile.role !== 'student') redirect(routeForRole(profile.role))

  return (
    <div className="flex h-screen bg-gray-50">
      <StudentNav studentName={profile.name} />
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>
      <MessageNotifier userId={user.id} />
    </div>
  )
}
