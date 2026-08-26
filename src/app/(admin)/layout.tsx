import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { ShieldCheck, Users, School, GraduationCap } from 'lucide-react'
import LogoutButton from '@/components/LogoutButton'
import NoProfileNotice from '@/components/NoProfileNotice'
import { routeForRole } from '@/lib/route-for-role'

/**
 * 관리자 영역.
 *
 * 관리자는 계정과 반만 관리한다. 다른 교사의 학생 기록(관찰기록·생활기록부·
 * 평가결과)에는 접근할 수 없다. 화면에서 막는 것이 아니라 DB 정책으로 막혀 있다.
 *
 * 관리자는 role 이 아니라 profiles.is_admin 표시다. 같은 사람이 관리자이면서
 * 담임이므로, 이 계정으로 교사 화면도 그대로 쓸 수 있다.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // select('*') 로 읽는다. 컬럼을 골라 쓰면 DB 에 is_admin 이 아직 없는 동안
  // (스키마를 적용하기 전) 조회 자체가 실패해 «프로필이 없다» 로 보인다.
  // 코드가 스키마보다 먼저 배포되는 일은 늘 생긴다.
  const { data: profile } = await supabase
    .from('profiles').select('*').eq('id', user.id).single()

  // 프로필이 없으면 교사·학생 레이아웃끼리 서로 밀어내 무한 리다이렉트가 된다.
  // 여기서 끊고 무엇이 잘못됐는지 알려준다.
  if (!profile) return <NoProfileNotice email={user.email} />
  // 관리자는 role 이 아니라 is_admin 표시다. 같은 계정이 교사이기도 하다.
  if (profile.is_admin !== true) redirect(routeForRole(profile.role))

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
              <p className="text-xs text-gray-500">관리자 · 교사</p>
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
        {/* 같은 계정이 교사이기도 하다. 수업 화면으로 바로 넘어갈 수 있어야 한다. */}
        <div className="p-2 border-t">
          <Link href="/teacher/dashboard"
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-blue-700 bg-blue-50 hover:bg-blue-100">
            <GraduationCap className="w-4 h-4" />교사 화면으로
          </Link>
        </div>
        <div className="p-2 border-t">
          <LogoutButton />
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  )
}
