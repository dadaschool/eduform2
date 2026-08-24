'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { toast } from 'sonner'
import { GraduationCap } from 'lucide-react'

export default function RegisterPage() {
  const router = useRouter()
  const [step, setStep] = useState<'code' | 'info'>('code')
  const [inviteCode, setInviteCode] = useState('')
  const [inviteKind, setInviteKind] = useState<'student' | 'teacher'>('student')
  const [className, setClassName] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [studentNumber, setStudentNumber] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleCodeVerify(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      // 렌더 시점이 아니라 실제 조회 시점에 클라이언트를 만든다.
      // 이 페이지는 빌드 때 정적 생성되므로, 본문에서 만들면 환경변수 없이 빌드가 깨진다.
      const supabase = createClient()
      // invite_codes 를 직접 조회하지 않는다. 그러면 활성 코드 목록이 전부
      // 열거되어 모르는 사람이 아무 반에나 들어올 수 있다.
      // 유효기간·사용한도 확인과 반 이름 조회를 이 함수 하나가 처리한다.
      const { data, error } = await supabase.rpc('verify_invite_code', {
        p_code: inviteCode.toUpperCase().trim(),
      })
      if (error) throw new Error('코드 확인 중 오류가 발생했습니다.')
      const row = Array.isArray(data) ? data[0] : data
      if (!row) throw new Error('유효하지 않거나 사용할 수 없는 초대코드입니다.')
      // 교사용 코드는 반이 없다. 역할은 코드가 정하고 화면은 표시만 한다.
      setInviteKind(row.kind === 'teacher' ? 'teacher' : 'student')
      setClassName(row.class_name ?? null)
      setStep('info')
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : '코드 확인에 실패했습니다.')
    } finally {
      setLoading(false)
    }
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      const supabase = createClient()
      const { data: authData, error: authError } = await supabase.auth.signUp({ email, password })
      if (authError) throw authError
      if (!authData.user) throw new Error('회원가입 실패')

      // profiles 에 직접 넣지 않는다. 그러면 호출자가 역할을 정할 수 있어
      // 누구나 스스로 교사·관리자가 될 수 있다. 역할은 초대코드가 정한다.
      // 프로필 생성과 사용횟수 증가를 이 함수가 함께 처리한다.
      const { error: regError } = await supabase.rpc('register_with_invite', {
        p_code: inviteCode.toUpperCase().trim(),
        p_name: name,
        p_student_number: studentNumber || null,
      })
      if (regError) throw new Error(regError.message)

      toast.success('회원가입이 완료되었습니다!')
      router.push(inviteKind === 'teacher' ? '/teacher/dashboard' : '/student/dashboard')
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : '회원가입에 실패했습니다.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-green-50 to-emerald-100 p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-green-500 rounded-2xl mb-4">
            <GraduationCap className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-gray-900">에듀폼</h1>
          <p className="text-gray-500 mt-1">초대코드로 가입</p>
        </div>

        <Card className="shadow-lg">
          <CardHeader>
            <CardTitle className="text-xl">
              {step === 'code' ? '초대코드 입력' : '계정 정보 입력'}
            </CardTitle>
            <CardDescription>
              {step === 'code'
                ? '선생님으로부터 받은 초대코드를 입력하세요'
                : inviteKind === 'teacher' ? '교사로 가입합니다' : `${className} 반에 가입합니다`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {step === 'code' ? (
              <form onSubmit={handleCodeVerify} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="code">초대코드</Label>
                  <Input
                    id="code"
                    placeholder="초대코드 8자리 입력"
                    value={inviteCode}
                    onChange={e => setInviteCode(e.target.value.toUpperCase())}
                    className="text-center text-lg font-mono tracking-widest uppercase"
                    maxLength={8}
                    required
                  />
                </div>
                <Button type="submit" className="w-full bg-green-600 hover:bg-green-700" disabled={loading}>
                  {loading ? '확인 중...' : '코드 확인'}
                </Button>
              </form>
            ) : (
              <form onSubmit={handleRegister} className="space-y-4">
                <div className="p-3 bg-green-50 rounded-lg text-sm text-green-700 border border-green-200">
                  ✓ {inviteKind === 'teacher' ? <><strong>교사</strong> 가입 코드 확인 완료</> : <><strong>{className}</strong> 반 확인 완료</>}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="name">이름</Label>
                  <Input id="name" placeholder="홍길동" value={name} onChange={e => setName(e.target.value)} required />
                </div>
                {inviteKind === 'student' && (
                  <div className="space-y-2">
                    <Label htmlFor="studentNumber">학번 (선택)</Label>
                    <Input id="studentNumber" placeholder="예: 20101" value={studentNumber} onChange={e => setStudentNumber(e.target.value)} />
                  </div>
                )}
                <div className="space-y-2">
                  <Label htmlFor="email">이메일</Label>
                  <Input id="email" type="email" placeholder="student@email.com" value={email} onChange={e => setEmail(e.target.value)} required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">비밀번호 (6자 이상)</Label>
                  <Input id="password" type="password" placeholder="비밀번호 입력" value={password} onChange={e => setPassword(e.target.value)} minLength={6} required />
                </div>
                <div className="flex gap-2">
                  <Button type="button" variant="outline" className="flex-1" onClick={() => setStep('code')}>
                    이전
                  </Button>
                  <Button type="submit" className="flex-1 bg-green-600 hover:bg-green-700" disabled={loading}>
                    {loading ? '가입 중...' : '가입하기'}
                  </Button>
                </div>
              </form>
            )}
            <div className="mt-4 text-center">
              <p className="text-sm text-gray-600">
                이미 계정이 있나요?{' '}
                <Link href="/student-login" className="text-green-600 font-medium hover:underline">
                  로그인
                </Link>
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
