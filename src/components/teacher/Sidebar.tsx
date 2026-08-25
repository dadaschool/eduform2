'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import {
  LayoutDashboard,
  Users,
  BookOpen,
  ClipboardList,
  FileText,
  Eye,
  Award,
  LogOut,
  UserCog,
  ShieldCheck,
  GraduationCap,
  School,
  MessageCircle,
} from 'lucide-react'

const navItems = [
  { href: '/teacher/dashboard', label: '대시보드', icon: LayoutDashboard },
  { href: '/teacher/classes', label: '반 관리', icon: School },
  { href: '/teacher/students', label: '학생 관리', icon: Users },
  { href: '/teacher/assessments', label: '평가 관리', icon: ClipboardList },
  { href: '/teacher/assignments', label: '과제 관리', icon: BookOpen },
  { href: '/teacher/observations', label: '관찰일지', icon: Eye },
  { href: '/teacher/records', label: '학생부 초안', icon: FileText },
  { href: '/teacher/badges', label: '디지털 배지', icon: Award },
  { href: '/teacher/messages', label: '쪽지함', icon: MessageCircle },
  { href: '/teacher/account', label: '내 계정', icon: UserCog },
]

interface SidebarProps {
  teacherName: string
  /** 관리자를 겸하는 계정이면 전체 관리로 넘어가는 링크를 보여준다 */
  isAdmin?: boolean
}

export default function Sidebar({ teacherName, isAdmin = false }: SidebarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()

  async function handleLogout() {
    await supabase.auth.signOut()
    toast.success('로그아웃되었습니다.')
    router.push('/login')
  }

  return (
    <aside className="w-64 bg-white border-r border-gray-200 flex flex-col h-screen sticky top-0">
      {/* 로고 */}
      <div className="p-5 border-b border-gray-100">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-blue-600 rounded-xl flex items-center justify-center">
            <GraduationCap className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="font-bold text-gray-900 text-sm">에듀폼</div>
            <div className="text-xs text-gray-500">교사 관리</div>
          </div>
        </div>
      </div>

      {/* 네비게이션 */}
      <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
        {navItems.map(({ href, label, icon: Icon }) => {
          const isActive = pathname === href || pathname.startsWith(href + '/')
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                isActive
                  ? 'bg-blue-50 text-blue-700'
                  : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
              )}
            >
              <Icon className={cn('w-4 h-4', isActive ? 'text-blue-600' : 'text-gray-400')} />
              {label}
            </Link>
          )
        })}
      </nav>

      {/* 관리자 겸임 계정 — 계정·반 관리로 넘어간다 */}
      {isAdmin && (
        <div className="p-3 border-t border-gray-100">
          <Link
            href="/admin/users"
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 transition-colors"
          >
            <ShieldCheck className="w-4 h-4" />
            전체 관리
          </Link>
        </div>
      )}

      {/* 사용자 정보 + 로그아웃 */}
      <div className="p-3 border-t border-gray-100">
        <div className="px-3 py-2 mb-1">
          <p className="text-xs text-gray-500">로그인 교사{isAdmin && ' · 관리자'}</p>
          <p className="text-sm font-semibold text-gray-800 truncate">{teacherName}</p>
        </div>
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-gray-600 hover:bg-red-50 hover:text-red-600 transition-colors"
        >
          <LogOut className="w-4 h-4" />
          로그아웃
        </button>
      </div>
    </aside>
  )
}
