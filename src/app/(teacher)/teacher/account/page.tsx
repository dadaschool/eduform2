'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { toast } from 'sonner'
import { KeyRound, User, ShieldCheck } from 'lucide-react'

/**
 * 내 계정 — 이름과 비밀번호를 스스로 바꾼다.
 *
 * 왜 필요한가
 *   교내망에는 메일 서버가 없어 «비밀번호 찾기» 가 없다. 그런데 교사·관리자에게는
 *   자기 비밀번호를 바꿀 화면이 아예 없었다. 관리자가 명단을 올릴 때 자기
 *   이메일이 섞여 들어가 비밀번호가 바뀌어 버리는 방식으로만 «바뀌었고»,
 *   그건 사고였다 (지금은 본인 계정을 건너뛴다).
 *
 * ⚠ 현재 비밀번호를 먼저 확인한다.
 *   로그인된 채로 자리를 비웠을 때 지나가는 사람이 비밀번호를 갈아버리면
 *   계정을 그대로 빼앗긴다. 그래서 확인 없이 바꾸지 않는다.
 */
export default function TeacherAccountPage() {
  const supabase = createClient()
  const router = useRouter()

  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [savedName, setSavedName] = useState('')
  const [isAdmin, setIsAdmin] = useState(false)
  const [loading, setLoading] = useState(true)

  const [currentPw, setCurrentPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [changing, setChanging] = useState(false)
  const [savingName, setSavingName] = useState(false)

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    setEmail(user.email ?? '')
    // select('*') — is_admin 컬럼이 없는 DB 에서도 조회가 실패하지 않아야 한다
    const { data: p } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle()
    setName(p?.name ?? '')
    setSavedName(p?.name ?? '')
    setIsAdmin(p?.is_admin === true)
    setLoading(false)
  }, [supabase])

  useEffect(() => { load() }, [load])

  async function saveName(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) { toast.error('이름을 입력하세요'); return }
    if (trimmed === savedName) { toast.info('바뀐 내용이 없습니다'); return }
    setSavingName(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('인증 필요')
      const { error } = await supabase.from('profiles').update({ name: trimmed }).eq('id', user.id)
      if (error) throw error
      setSavedName(trimmed)
      toast.success('이름을 바꿨습니다.', { description: '화면 왼쪽 표시는 다시 접속할 때 바뀝니다' })
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : '저장 실패')
    } finally {
      setSavingName(false)
    }
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault()
    if (!currentPw) { toast.error('현재 비밀번호를 입력하세요'); return }
    if (newPw.length < 6) { toast.error('새 비밀번호는 6자 이상이어야 합니다'); return }
    if (newPw !== confirmPw) { toast.error('새 비밀번호가 일치하지 않습니다'); return }
    if (newPw === currentPw) { toast.error('지금 쓰는 비밀번호와 같습니다'); return }

    setChanging(true)
    try {
      // ① 현재 비밀번호가 맞는지 확인한다. 로그인을 다시 해 보는 것이
      //    가장 확실하다 — 서버가 실제로 대조해 준다.
      const { error: wrong } = await supabase.auth.signInWithPassword({ email, password: currentPw })
      if (wrong) {
        toast.error('현재 비밀번호가 맞지 않습니다')
        return
      }

      // ② 바꾼다
      const { error } = await supabase.auth.updateUser({ password: newPw })
      if (error) throw error

      // ③ 다른 기기의 세션은 끊긴다. 여기서도 정리하고 다시 로그인하게 한다.
      toast.success('비밀번호를 바꿨습니다.', { description: '새 비밀번호로 다시 로그인하세요' })
      await supabase.auth.signOut()
      router.push('/login')
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : '변경 실패')
    } finally {
      setChanging(false)
      setCurrentPw(''); setNewPw(''); setConfirmPw('')
    }
  }

  if (loading) return <div className="p-6 text-center text-gray-400">불러오는 중...</div>

  return (
    <div className="p-6 space-y-6 max-w-lg">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">내 계정</h1>
        <p className="text-gray-500 text-sm mt-1">이름과 비밀번호를 직접 바꿉니다</p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <User className="w-4 h-4" />내 정보
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label>이메일</Label>
            <Input value={email} disabled className="bg-gray-50 text-gray-500" />
            <p className="text-xs text-gray-400">이메일은 관리자만 바꿀 수 있습니다</p>
          </div>
          {isAdmin && (
            <p className="flex items-center gap-1.5 text-sm text-slate-700">
              <ShieldCheck className="w-4 h-4" />이 계정은 <b>관리자</b>를 겸합니다
            </p>
          )}
          <form onSubmit={saveName} className="space-y-1.5">
            <Label>이름</Label>
            <div className="flex gap-2">
              <Input value={name} onChange={e => setName(e.target.value)} />
              <Button type="submit" variant="outline" disabled={savingName}>
                {savingName ? '저장 중...' : '저장'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <KeyRound className="w-4 h-4" />비밀번호 변경
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={changePassword} className="space-y-4">
            <div className="space-y-1.5">
              <Label>현재 비밀번호 *</Label>
              <Input type="password" value={currentPw} autoComplete="current-password"
                onChange={e => setCurrentPw(e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label>새 비밀번호 (6자 이상) *</Label>
              <Input type="password" value={newPw} autoComplete="new-password"
                onChange={e => setNewPw(e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label>새 비밀번호 확인 *</Label>
              <Input type="password" value={confirmPw} autoComplete="new-password"
                onChange={e => setConfirmPw(e.target.value)} required />
            </div>
            <p className="text-xs text-gray-500">
              바꾸면 <b>모든 기기에서 로그아웃</b>됩니다. 새 비밀번호로 다시 로그인하세요.
            </p>
            <Button type="submit" className="w-full" disabled={changing}>
              {changing ? '변경 중...' : '비밀번호 변경'}
            </Button>
          </form>
        </CardContent>
      </Card>

      <p className="text-xs text-gray-400">
        비밀번호를 잊으셨다면 관리자에게 초기화를 요청하세요. 교내망에는 메일 서버가 없어
        «비밀번호 찾기» 메일을 보낼 수 없습니다.
      </p>
    </div>
  )
}
