import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import Sidebar from '@/components/teacher/Sidebar'
import NoProfileNotice from '@/components/NoProfileNotice'
import { routeForRole } from '@/lib/route-for-role'

export default async function TeacherLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles').select('role, name, is_admin').eq('id', user.id).single()
  // 프로필이 없으면 저쪽으로 보내지 않는다. 상대 레이아웃이 다시 이쪽으로
  // 보내 무한 리다이렉트가 된다.
  if (!profile) return <NoProfileNotice email={user.email} />
  if (profile.role !== 'teacher') redirect(routeForRole(profile.role))

  return (
    <div className="flex h-screen bg-gray-50">
      <Sidebar teacherName={profile.name} isAdmin={profile.is_admin} />
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  )
}
