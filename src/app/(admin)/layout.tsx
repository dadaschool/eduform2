import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { ShieldCheck, Users, School, LogOut } from 'lucide-react'
import NoProfileNotice from '@/components/NoProfileNotice'
import { routeForRole } from '@/lib/route-for-role'

/**
 * 관리자 영역.
 *
 * 관리자는 계정과 반만 관리한다. 학생 기록(관찰기록·생활기록부·평가결과)에는
 * 접근할 수 없다. 화면에서 막는 것이 아니라 DB 정책으로 막혀 있다.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('profiles').select('role, name').eq('id', user.id).single()

  // 프로필이 없으면 교사·학생 레이아웃끼리 서로 밀어내 무한 리다이렉트가 된다.
  // 여기서 끊고 무엇이 잘못됐는지 알려준다.
  if (!profile) return <NoProfileNotice email={user.email} />
  if (profile.role !== 'admin') redirect(routeForRole(profile.role))

  return (
    <div className="flex h-screen bg-gray-50">
      <aside className="w-60 bg-white border-r flex flex-col flex-shrink-0">
        <div className="p-4 border-b">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-slate-800 flex items-center justify-center">
              <ShieldCheck className="w-5 h-5 text-white" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold text-gray-900 truncate">{profile.name}</p>
              <p className="text-xs text-gray-500">전체 관리자</p>
            </div>
          </div>
        </div>
        <nav className="flex-1 p-2 space-y-1">
          <Link href="/admin/classes"
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-gray-700 hover:bg-gray-100">
            <School className="w-4 h-4" />반 관리
          </Link>
          <Link href="/admin/users"
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-gray-700 hover:bg-gray-100">
            <Users className="w-4 h-4" />사용자 관리
          </Link>
        </nav>
        <div className="p-2 border-t">
          <Link href="/login"
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-gray-500 hover:bg-gray-100">
            <LogOut className="w-4 h-4" />로그아웃
          </Link>
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  )
}
