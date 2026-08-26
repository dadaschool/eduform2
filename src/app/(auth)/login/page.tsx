'use client'

import { useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { toast } from 'sonner'
import { BookOpen, GraduationCap } from 'lucide-react'
import { routeForRole } from '@/lib/route-for-role'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      // 렌더 시점이 아니라 실제 로그인 시점에 클라이언트를 만든다.
      // 이 페이지는 빌드 때 정적 생성되므로, 본문에서 만들면 환경변수 없이 빌드가 깨진다.
      const supabase = createClient()
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) throw error
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('로그인 실패')
      const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
      // 보낼 곳은 routeForRole 한 곳에서 정한다. 역할을 빼먹으면 레이아웃끼리
      // 서로 밀어내 무한 리다이렉트가 된다.
      // location.replace 로 «새로» 불러온다. router.push 는 브라우저에 남아 있는
      // 이전 사용자의 서버 화면을 그대로 보여줄 수 있다.
      window.location.replace(profile ? routeForRole(profile.role) : '/student/dashboard')
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : '로그인에 실패했습니다.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
      <div className="w-full max-w-md space-y-6">
        {/* 로고 */}
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-600 rounded-2xl mb-4">
            <BookOpen className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-gray-900">에듀폼</h1>
          <p className="text-gray-500 mt-1">교사 로그인</p>
        </div>

        <Card className="shadow-lg">
          <CardHeader>
            <CardTitle className="text-xl">교사 로그인</CardTitle>
            <CardDescription>교사 계정으로 로그인하세요</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">이메일</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="teacher@school.edu"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">비밀번호</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="비밀번호를 입력하세요"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? '로그인 중...' : '로그인'}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* 학생 로그인 링크 */}
        <Card className="border-green-200 bg-green-50">
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-green-500 rounded-xl flex items-center justify-center flex-shrink-0">
                <GraduationCap className="w-5 h-5 text-white" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-green-800">학생이신가요?</p>
                <p className="text-xs text-green-600">학생 전용 로그인 페이지를 이용하세요</p>
              </div>
              <Link href="/student-login">
                <Button variant="outline" size="sm" className="border-green-400 text-green-700 hover:bg-green-100">
                  학생 로그인
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
