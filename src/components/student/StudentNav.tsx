'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { LayoutDashboard, BookOpen, Award, User, LogOut, GraduationCap, MessageCircle } from 'lucide-react'

const navItems = [
  { href: '/student/dashboard', label: '대시보드', icon: LayoutDashboard },
  { href: '/student/assignments', label: '과제 제출', icon: BookOpen },
  { href: '/student/badges', label: '내 배지', icon: Award },
  { href: '/student/messages', label: '쪽지함', icon: MessageCircle },
  { href: '/student/profile', label: '내 정보', icon: User },
]

interface StudentNavProps { studentName: string }

export default function StudentNav({ studentName }: StudentNavProps) {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()

  async function handleLogout() {
    await supabase.auth.signOut()
    toast.success('로그아웃되었습니다.')
    router.push('/student-login')
  }

  return (
    <aside className="w-60 bg-white border-r border-gray-200 flex flex-col h-screen sticky top-0">
      <div className="p-5 border-b border-gray-100">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-green-500 rounded-xl flex items-center justify-center">
            <GraduationCap className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="font-bold text-gray-900 text-sm">에듀폼</div>
            <div className="text-xs text-gray-500">학생 포털</div>
          </div>
        </div>
      </div>

      <nav className="flex-1 p-3 space-y-0.5">
        {navItems.map(({ href, label, icon: Icon }) => {
          const isActive = pathname === href || pathname.startsWith(href + '/')
          return (
            <Link key={href} href={href}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                isActive ? 'bg-green-50 text-green-700' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
              )}>
              <Icon className={cn('w-4 h-4', isActive ? 'text-green-600' : 'text-gray-400')} />
              {label}
            </Link>
          )
        })}
      </nav>

      <div className="p-3 border-t border-gray-100">
        <div className="px-3 py-2 mb-1">
          <p className="text-xs text-gray-500">로그인 학생</p>
          <p className="text-sm font-semibold text-gray-800 truncate">{studentName}</p>
        </div>
        <button onClick={handleLogout}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-gray-600 hover:bg-red-50 hover:text-red-600 transition-colors">
          <LogOut className="w-4 h-4" />
          로그아웃
        </button>
      </div>
    </aside>
  )
}
