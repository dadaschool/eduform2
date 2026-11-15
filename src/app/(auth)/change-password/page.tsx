'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { KeyRound } from 'lucide-react'
import PasswordChangeForm from '@/components/PasswordChangeForm'
import { routeForRole } from '@/lib/route-for-role'
import { nextFromLocation } from '@/lib/safe-next'
import type { Role } from '@/lib/types'

/**
 * 첫 로그인 비밀번호 바꾸기.
 *
 * 관리자·선생님이 정해 준 비밀번호는 «임시» 다 (엑셀 명단에 적혀 있어 다른 사람도 안다).
 * 레이아웃이 임시 비밀번호 계정을 이리로 보내고, 바꾸기 전에는 화면에 들어가지 못한다.
 */
export default function ChangePasswordPage() {
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [studentNumber, setStudentNumber] = useState('')
  const [role, setRole] = useState<Role | null>(null)

  useEffect(() => {
    (async () => {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { window.location.replace('/login'); return }
      setEmail(user.email ?? '')
      const { data: p } = await supabase.from('profiles')
        .select('name, student_number, role').eq('id', user.id).maybeSingle()
      setName(p?.name ?? '')
      setStudentNumber(p?.student_number ?? '')
      setRole((p?.role as Role) ?? null)
    })()
  }, [])

  function done() {
    window.location.replace(nextFromLocation() ?? (role ? routeForRole(role) : '/'))
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
      <Card className="w-full max-w-md shadow-lg">
        <CardHeader>
          <CardTitle className="text-xl flex items-center gap-2">
            <KeyRound className="w-5 h-5" />내 비밀번호 정하기
          </CardTitle>
          <CardDescription className="leading-relaxed" style={{ wordBreak: 'keep-all' }}>
            {name ? `${name} 님, ` : ''}지금 비밀번호는 선생님이 정해 준 <b>임시 비밀번호</b>입니다.
            다른 사람이 알 수 있으니 나만 아는 비밀번호로 바꿔 주세요.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {email ? (
            <PasswordChangeForm
              email={email}
              context={{ name, studentNumber }}
              currentLabel="받은 임시 비밀번호"
              submitLabel="바꾸고 시작하기"
              onDone={done}
            />
          ) : (
            <p className="text-sm text-gray-400">불러오는 중...</p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
