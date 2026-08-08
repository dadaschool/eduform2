'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { toast } from 'sonner'
import { User, Lock } from 'lucide-react'

export default function StudentProfilePage() {
  const supabase = createClient()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [className, setClassName] = useState('')
  const [studentNumber, setStudentNumber] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [changingPw, setChangingPw] = useState(false)

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data: profile } = await supabase
        .from('profiles')
        .select('*, classes(name)')
        .eq('id', user.id)
        .single()
      if (profile) {
        setName(profile.name)
        setEmail(profile.email ?? '')
        setStudentNumber(profile.student_number ?? '')
        const cls = profile.classes as unknown as { name: string } | null
        setClassName(cls?.name ?? '')
      }
    }
    load()
  }, [supabase])

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault()
    if (newPw !== confirmPw) { toast.error('새 비밀번호가 일치하지 않습니다.'); return }
    if (newPw.length < 6) { toast.error('비밀번호는 6자 이상이어야 합니다.'); return }
    setChangingPw(true)
    try {
      const { error } = await supabase.auth.updateUser({ password: newPw })
      if (error) throw error
      toast.success('비밀번호가 변경되었습니다.')
      setNewPw(''); setConfirmPw('')
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : '변경 실패')
    } finally {
      setChangingPw(false)
    }
  }

  return (
    <div className="p-6 max-w-lg mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">내 정보</h1>
      </div>

      {/* 프로필 정보 */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <User className="w-4 h-4" />
            프로필
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-center mb-4">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center text-2xl font-bold text-green-600">
              {name[0]}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-gray-500">이름</Label>
              <p className="font-medium text-gray-900">{name}</p>
            </div>
            <div>
              <Label className="text-xs text-gray-500">학번</Label>
              <p className="font-medium text-gray-900">{studentNumber || '-'}</p>
            </div>
            <div>
              <Label className="text-xs text-gray-500">이메일</Label>
              <p className="font-medium text-gray-900">{email}</p>
            </div>
            <div>
              <Label className="text-xs text-gray-500">반</Label>
              <p className="font-medium text-gray-900">{className || '-'}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 비밀번호 변경 */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Lock className="w-4 h-4" />
            비밀번호 변경
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleChangePassword} className="space-y-3">
            <div className="space-y-1.5">
              <Label>새 비밀번호 (6자 이상)</Label>
              <Input
                type="password"
                placeholder="새 비밀번호 입력"
                value={newPw}
                onChange={e => setNewPw(e.target.value)}
                minLength={6}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label>새 비밀번호 확인</Label>
              <Input
                type="password"
                placeholder="새 비밀번호 재입력"
                value={confirmPw}
                onChange={e => setConfirmPw(e.target.value)}
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={changingPw}>
              {changingPw ? '변경 중...' : '비밀번호 변경'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
