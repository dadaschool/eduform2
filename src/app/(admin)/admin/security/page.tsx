'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { toast } from 'sonner'
import { Lock } from 'lucide-react'

interface Locked { id: string; email: string; name: string | null; role: string | null; student_number: string | null; locked_until: string }
interface Failure { email: string; name: string | null; fails: number; last_at: string; unknown_email: boolean }

/** 로그인 보안 — 잠긴 계정 풀기, 최근 실패가 많은 계정 보기. */
export default function SecurityPage() {
  const [locked, setLocked] = useState<Locked[]>([])
  const [failures, setFailures] = useState<Failure[]>([])
  const [tempCount, setTempCount] = useState(0)

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/security', { cache: 'no-store' })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) { toast.error(body.error ?? '불러오지 못했습니다'); return }
    setLocked(body.locked ?? []); setFailures(body.failures ?? []); setTempCount(body.tempCount ?? 0)
  }, [])
  useEffect(() => { load() }, [load])

  async function unlock(u: Locked) {
    const res = await fetch('/api/admin/security', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: u.id }),
    })
    if (res.ok) { toast.success(`${u.name ?? u.email} 잠금을 풀었습니다`); load() } else toast.error('풀지 못했습니다')
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6" style={{ wordBreak: 'keep-all' }}>
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><Lock className="w-6 h-6" />로그인 보안</h1>
        <p className="text-sm text-gray-500 mt-1">
          비밀번호를 15분 안에 5번 틀리면 그 계정은 15분 동안 잠깁니다. 임시 비밀번호인 계정 <b>{tempCount}개</b>
          (첫 로그인 때 바꿉니다).
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">지금 잠긴 계정</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {locked.length === 0 && <p className="text-sm text-gray-400">없습니다.</p>}
          {locked.map(u => (
            <div key={u.id} className="flex items-center gap-3 rounded-lg border px-3 py-2">
              <div className="flex-1 min-w-0 text-sm">
                <p className="font-medium">{u.name ?? '(이름 없음)'} {u.student_number && <span className="text-gray-500">· {u.student_number}</span>}</p>
                <p className="text-xs text-gray-500">{u.email} · {new Date(u.locked_until).toLocaleTimeString('ko-KR')}까지</p>
              </div>
              <Button size="sm" onClick={() => unlock(u)}>잠금 풀기</Button>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">최근 24시간 로그인 실패</CardTitle></CardHeader>
        <CardContent>
          {failures.length === 0 ? <p className="text-sm text-gray-400">없습니다.</p> : (
            <table className="w-full text-sm">
              <thead><tr className="text-left text-gray-500 border-b"><th className="py-2">이메일</th><th className="py-2">이름</th><th className="py-2">실패</th><th className="py-2">마지막</th></tr></thead>
              <tbody>
                {failures.map(f => (
                  <tr key={f.email} className="border-b last:border-0">
                    <td className="py-1.5 break-all">{f.email}{f.unknown_email && <span className="ml-1 text-xs text-amber-700">(없는 이메일)</span>}</td>
                    <td className="py-1.5">{f.name ?? '-'}</td>
                    <td className="py-1.5 tabular-nums">{f.fails}</td>
                    <td className="py-1.5 text-gray-500">{new Date(f.last_at).toLocaleTimeString('ko-KR')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="text-xs text-gray-400 mt-3">기록에는 비밀번호가 남지 않습니다. 90일이 지나면 지워집니다.</p>
        </CardContent>
      </Card>
    </div>
  )
}
