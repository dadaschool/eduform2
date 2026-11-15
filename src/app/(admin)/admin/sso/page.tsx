'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { toast } from 'sonner'
import { KeySquare, Plug, Trash2, Copy } from 'lucide-react'

interface Client {
  client_id: string
  name: string
  redirect_uris: string[]
  roles: string[]
  enabled: boolean
  last_used: string | null
  uses_30d: number
}

const EMPTY = { client_id: '', name: '', uris: '', student: true, teacher: false, enabled: true }

/**
 * 연동 프로그램 — 에듀폼2 계정으로 로그인하는 다른 프로그램을 등록한다.
 * docs/accounts-design.md «1. 학교 계정 서버»
 */
export default function SsoClientsPage() {
  const [clients, setClients] = useState<Client[]>([])
  const [jwks, setJwks] = useState<unknown>(null)
  const [form, setForm] = useState(EMPTY)
  const [busy, setBusy] = useState(false)
  const [origin, setOrigin] = useState('')

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/sso', { cache: 'no-store' })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) { toast.error(body.error ?? '불러오지 못했습니다'); return }
    setClients(body.clients ?? []); setJwks(body.jwks ?? null)
  }, [])
  useEffect(() => { setOrigin(window.location.origin); load() }, [load])

  async function post(payload: Record<string, unknown>, ok: string) {
    setBusy(true)
    try {
      const res = await fetch('/api/admin/sso', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? '저장하지 못했습니다')
      toast.success(ok)
      await load()
      return true
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '저장하지 못했습니다')
      return false
    } finally {
      setBusy(false)
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    const roles = [form.student && 'student', form.teacher && 'teacher'].filter(Boolean)
    const ok = await post({
      action: 'save', client_id: form.client_id.trim(), name: form.name.trim(),
      redirect_uris: form.uris.split(/\s+/).filter(Boolean), roles, enabled: form.enabled,
    }, '저장했습니다')
    if (ok) setForm(EMPTY)
  }

  async function remove(id: string) {
    if (!confirm(`«${id}» 연동을 지울까요? 그 프로그램에서 에듀폼2 로그인이 바로 안 됩니다.`)) return
    const res = await fetch(`/api/admin/sso?client_id=${encodeURIComponent(id)}`, { method: 'DELETE' })
    if (res.ok) { toast.success('지웠습니다'); load() } else toast.error('지우지 못했습니다')
  }

  async function rotate() {
    if (!confirm('서명 열쇠를 바꿀까요? 공개 열쇠를 손으로 넣어 둔 프로그램은 새 열쇠로 바꿔 넣어야 합니다.')) return
    await post({ action: 'rotate' }, '열쇠를 바꿨습니다')
  }

  function edit(c: Client) {
    setForm({
      client_id: c.client_id, name: c.name, uris: c.redirect_uris.join('\n'),
      student: c.roles.includes('student'), teacher: c.roles.includes('teacher'), enabled: c.enabled,
    })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const jwksText = jwks ? JSON.stringify(jwks, null, 2) : ''

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6" style={{ wordBreak: 'keep-all' }}>
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><Plug className="w-6 h-6" />연동 프로그램</h1>
        <p className="text-sm text-gray-500 mt-1">
          다른 프로그램이 «에듀폼2 로 로그인» 을 쓰게 합니다. 그 프로그램은 학생 비밀번호를 보지 않고,
          에듀폼2 가 서명한 <b>이름 · 학번 · 반</b>만 받습니다.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">{form.client_id && clients.some(c => c.client_id === form.client_id) ? '고치기' : '새로 등록'}</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={save} className="space-y-3">
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="cid">프로그램 ID (영문 소문자)</Label>
                <Input id="cid" value={form.client_id} placeholder="pycoding"
                  onChange={e => setForm({ ...form, client_id: e.target.value })} required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cname">화면에 보일 이름</Label>
                <Input id="cname" value={form.name} placeholder="중학생 파이썬 채점"
                  onChange={e => setForm({ ...form, name: e.target.value })} required />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="curis">돌아갈 주소 (한 줄에 하나, 정확히 같은 주소만 허용)</Label>
              <Textarea id="curis" rows={3} value={form.uris}
                placeholder="https://dadaschool.github.io/pycoding/"
                onChange={e => setForm({ ...form, uris: e.target.value })} required />
              <p className="text-xs text-gray-500">학교 밖 주소는 https 여야 합니다.</p>
            </div>
            <fieldset className="flex flex-wrap gap-4 text-sm">
              <legend className="sr-only">들어올 수 있는 역할</legend>
              <label className="flex items-center gap-1.5"><input type="checkbox" checked={form.student}
                onChange={e => setForm({ ...form, student: e.target.checked })} />학생</label>
              <label className="flex items-center gap-1.5"><input type="checkbox" checked={form.teacher}
                onChange={e => setForm({ ...form, teacher: e.target.checked })} />교사</label>
              <label className="flex items-center gap-1.5"><input type="checkbox" checked={form.enabled}
                onChange={e => setForm({ ...form, enabled: e.target.checked })} />켜기</label>
            </fieldset>
            <div className="flex gap-2">
              <Button type="submit" disabled={busy}>저장</Button>
              {form.client_id && <Button type="button" variant="ghost" onClick={() => setForm(EMPTY)}>새로 쓰기</Button>}
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">등록된 프로그램</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {clients.length === 0 && <p className="text-sm text-gray-400">아직 없습니다.</p>}
          {clients.map(c => (
            <div key={c.client_id} className="rounded-lg border px-4 py-3 flex flex-wrap items-start gap-3">
              <div className="flex-1 min-w-0">
                <p className="font-medium text-gray-900">
                  {c.name} <span className="font-mono text-xs text-gray-500">{c.client_id}</span>
                  {!c.enabled && <span className="ml-2 text-xs text-red-600">꺼짐</span>}
                </p>
                <p className="text-xs text-gray-500 break-all">{c.redirect_uris.join(' · ')}</p>
                <p className="text-xs text-gray-500">
                  {c.roles.map(r => (r === 'student' ? '학생' : '교사')).join('·')} · 최근 30일 {c.uses_30d}번
                  {c.last_used && ` · 마지막 ${new Date(c.last_used).toLocaleString('ko-KR')}`}
                </p>
              </div>
              <Button size="sm" variant="outline" onClick={() => edit(c)}>고치기</Button>
              <Button size="sm" variant="ghost" aria-label={`${c.client_id} 지우기`} onClick={() => remove(c.client_id)}>
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0 gap-2">
          <CardTitle className="text-base flex items-center gap-2"><KeySquare className="w-4 h-4" />공개 열쇠</CardTitle>
          <Button size="sm" variant="outline" onClick={rotate} disabled={busy}>열쇠 바꾸기</Button>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-gray-600">
            프로그램 서버에 아래 <b>공개</b> 열쇠를 넣어 두면 에듀폼2 증명의 서명을 확인할 수 있습니다.
            공개 열쇠로는 증명을 만들 수 없으니 보여도 괜찮습니다. 학교망 안의 프로그램은
            <code className="mx-1 px-1 bg-gray-100 rounded">{origin}/sso/jwks</code> 에서 직접 받아도 됩니다.
          </p>
          <pre className="bg-slate-900 text-slate-100 rounded-md p-3 text-xs overflow-x-auto">{jwksText}</pre>
          <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(jwksText); toast.success('복사했습니다') }}>
            <Copy className="w-4 h-4 mr-1" />복사
          </Button>
          <p className="text-xs text-gray-500">
            로그인 시작 주소: <code className="px-1 bg-gray-100 rounded">{origin}/sso/authorize?client_id=…&amp;redirect_uri=…&amp;state=…&amp;nonce=…</code>
            {' '}— 자세한 것은 저장소의 <code>docs/accounts-design.md</code>.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
