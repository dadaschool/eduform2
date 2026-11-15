'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { toast } from 'sonner'
import { LogIn } from 'lucide-react'

export default function SsoConsent(props: {
  clientId: string
  clientName: string
  redirectUri: string
  state: string
  nonce: string
  who: { name: string; role: string; studentNumber: string | null; className: string | null }
  cancelUrl: string
  switchUrl: string
}) {
  const [busy, setBusy] = useState(false)

  async function proceed() {
    setBusy(true)
    try {
      const res = await fetch('/api/sso/issue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: props.clientId, redirect_uri: props.redirectUri, state: props.state, nonce: props.nonce,
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok || !body.url) throw new Error(body.error ?? '로그인하지 못했습니다')
      window.location.replace(body.url)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '로그인하지 못했습니다')
      setBusy(false)
    }
  }

  async function switchAccount() {
    setBusy(true)
    await createClient().auth.signOut()
    window.location.replace(props.switchUrl)
  }

  const { who } = props
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
      <Card className="w-full max-w-md shadow-lg">
        <CardHeader>
          <CardTitle className="text-xl flex items-center gap-2"><LogIn className="w-5 h-5" />에듀폼2 로 로그인</CardTitle>
          <CardDescription style={{ wordBreak: 'keep-all' }}>
            <b className="text-gray-900">{props.clientName}</b> 에 아래 계정으로 들어갑니다.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border bg-gray-50 px-4 py-3">
            <p className="text-lg font-bold text-gray-900">{who.name}</p>
            <p className="text-sm text-gray-600">
              {who.role === 'student'
                ? [who.className, who.studentNumber && `학번 ${who.studentNumber}`].filter(Boolean).join(' · ') || '학생'
                : '교사'}
            </p>
          </div>
          <p className="text-xs text-gray-500 leading-relaxed" style={{ wordBreak: 'keep-all' }}>
            {props.clientName} 에는 <b>이름 · 학번 · 반</b>만 전달됩니다. 비밀번호와 이메일은 전달되지 않습니다.
          </p>
          <Button className="w-full" onClick={proceed} disabled={busy} autoFocus>
            {busy ? '넘어가는 중...' : `${who.name}(으)로 계속`}
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={switchAccount} disabled={busy}>
              내가 아니에요 (다른 계정)
            </Button>
            <Button variant="ghost" className="flex-1" onClick={() => window.location.replace(props.cancelUrl)} disabled={busy}>
              취소
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
