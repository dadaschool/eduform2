'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'
import { checkOwnPassword, OWN_MIN_LENGTH, type PolicyContext } from '@/lib/password-policy'

/**
 * 내 비밀번호 바꾸기 양식 — 첫 로그인 변경 · 학생 «내 정보» · 교사 «내 계정» 이 함께 쓴다.
 *
 * 실제 확인·변경은 서버(/api/account/password)가 한다. 여기서 규칙을 먼저 보는 것은
 * 버튼을 누르기 전에 이유를 알려 주려는 것뿐이다.
 *
 * 바꾸면 서버가 다른 세션을 모두 끊는다. 이 기기는 새 비밀번호로 곧바로 다시
 * 로그인해 세션을 새로 받는다 — 학생이 바로 다시 로그인하지 않아도 되게.
 */
export default function PasswordChangeForm({
  email,
  context,
  currentLabel = '지금 비밀번호',
  submitLabel = '비밀번호 변경',
  onDone,
}: {
  email: string
  context?: PolicyContext
  currentLabel?: string
  submitLabel?: string
  onDone?: () => void
}) {
  const [currentPw, setCurrentPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [busy, setBusy] = useState(false)

  const hint = newPw ? checkOwnPassword(newPw, { email, ...context }) : null

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!currentPw) { toast.error(`${currentLabel}을 입력하세요`); return }
    const why = checkOwnPassword(newPw, { email, ...context })
    if (why) { toast.error(why); return }
    if (newPw !== confirmPw) { toast.error('새 비밀번호 두 칸이 서로 다릅니다'); return }
    if (newPw === currentPw) { toast.error('지금과 다른 비밀번호를 정하세요'); return }

    setBusy(true)
    try {
      const res = await fetch('/api/account/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current: currentPw, next: newPw }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? '바꾸지 못했습니다')

      // 서버가 세션을 끊었으니 새 비밀번호로 다시 받는다.
      const supabase = createClient()
      const { error } = await supabase.auth.signInWithPassword({ email, password: newPw })
      if (error) {
        toast.success('비밀번호를 바꿨습니다.', { description: '새 비밀번호로 다시 로그인하세요' })
        await supabase.auth.signOut()
        window.location.replace('/')
        return
      }
      toast.success('비밀번호를 바꿨습니다.', { description: '다른 기기에서는 로그아웃됩니다' })
      setCurrentPw(''); setNewPw(''); setConfirmPw('')
      onDone?.()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : '바꾸지 못했습니다')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="pw-current">{currentLabel} *</Label>
        <Input id="pw-current" type="password" value={currentPw} autoComplete="current-password"
          onChange={e => setCurrentPw(e.target.value)} required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="pw-new">새 비밀번호 *</Label>
        <Input id="pw-new" type="password" value={newPw} autoComplete="new-password"
          onChange={e => setNewPw(e.target.value)} required aria-describedby="pw-rule" />
        <p id="pw-rule" className={`text-xs ${hint ? 'text-amber-700' : 'text-gray-500'}`}>
          {hint ?? `${OWN_MIN_LENGTH}자 이상, 글자와 숫자를 함께. 학번·이름·흔한 비밀번호는 안 됩니다.`}
        </p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="pw-confirm">새 비밀번호 확인 *</Label>
        <Input id="pw-confirm" type="password" value={confirmPw} autoComplete="new-password"
          onChange={e => setConfirmPw(e.target.value)} required />
      </div>
      <Button type="submit" className="w-full" disabled={busy}>
        {busy ? '바꾸는 중...' : submitLabel}
      </Button>
    </form>
  )
}
