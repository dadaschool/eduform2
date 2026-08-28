'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { Sparkles, Trash2, ArrowUp, ArrowDown, ExternalLink } from 'lucide-react'

/**
 * 내 AI API 키 — 교사가 자기 키를 등록·수정·삭제하고 폴백 순서를 정한다.
 *
 * AI 기능(평가 항목 추천 · 생활기록부 초안)은 등록된 키를 «순서대로» 시도하고,
 * 할당량 초과나 오류가 나면 다음 키로 넘어간다. 최소 1개는 있어야 한다.
 *
 * 원본 키는 저장하는 순간 서버에서 암호화되고, 화면으로는 다시 내려오지 않는다.
 * 여기 보이는 건 끝 4자리뿐이다.
 */

type Provider = 'upstage' | 'gemini' | 'openai'

interface KeyRow {
  provider: Provider
  hint: string
  priority: number
  updated_at: string | null
}

const META: Record<Provider, { name: string; getUrl: string; help: string }> = {
  upstage: {
    name: '업스테이지 (Solar)',
    getUrl: 'https://console.upstage.ai',
    help: 'console.upstage.ai → API Keys',
  },
  gemini: {
    name: 'Google Gemini',
    getUrl: 'https://aistudio.google.com/app/apikey',
    help: 'aistudio.google.com/app/apikey — 무료 등급 있음',
  },
  openai: {
    name: 'OpenAI (ChatGPT)',
    getUrl: 'https://platform.openai.com/api-keys',
    help: 'platform.openai.com/api-keys',
  },
}

const ALL: Provider[] = ['upstage', 'gemini', 'openai']

export default function AiKeysCard() {
  const [rows, setRows] = useState<KeyRow[]>([])
  const [loading, setLoading] = useState(true)
  const [drafts, setDrafts] = useState<Record<Provider, string>>({ upstage: '', gemini: '', openai: '' })
  const [busy, setBusy] = useState<Provider | 'order' | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/teacher/ai-keys')
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? '불러오기 실패')
      setRows(body.keys ?? [])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '불러오기 실패')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const registered = [...rows].sort((a, b) => a.priority - b.priority)
  const rowOf = (p: Provider) => rows.find(r => r.provider === p)

  async function save(provider: Provider) {
    const apiKey = drafts[provider].trim()
    if (!apiKey) { toast.error('API 키를 입력하세요'); return }
    setBusy(provider)
    const t = toast.loading('키 확인 중...')
    try {
      const res = await fetch('/api/teacher/ai-keys', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, apiKey }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? '저장 실패')
      toast.success(`${META[provider].name} 키를 저장했습니다`, { id: t })
      setDrafts(d => ({ ...d, [provider]: '' }))
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '저장 실패', { id: t })
    } finally {
      setBusy(null)
    }
  }

  async function remove(provider: Provider) {
    if (!confirm(`${META[provider].name} 키를 삭제할까요?`)) return
    setBusy(provider)
    try {
      const res = await fetch('/api/teacher/ai-keys', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? '삭제 실패')
      toast.success('삭제했습니다')
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '삭제 실패')
    } finally {
      setBusy(null)
    }
  }

  async function reorder(from: number, to: number) {
    if (to < 0 || to >= registered.length) return
    const next = [...registered]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    setRows(next.map((r, i) => ({ ...r, priority: i })))
    setBusy('order')
    try {
      const res = await fetch('/api/teacher/ai-keys', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order: next.map(r => r.provider) }),
      })
      if (!res.ok) {
        const body = await res.json()
        throw new Error(body.error ?? '순서 저장 실패')
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '순서 저장 실패')
      await load()
    } finally {
      setBusy(null)
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Sparkles className="w-4 h-4" />AI API 키
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <p className="text-xs text-gray-500 leading-relaxed">
          평가 항목 추천·생활기록부 초안은 <b>내 API 키</b>로 동작합니다. 아래에서 1개 이상 등록하세요.
          여러 개를 넣으면 <b>순서대로</b> 시도하고, 한 곳에서 할당량이 바닥나거나 오류가 나면 다음 키로 넘어갑니다.
          키는 저장 시 암호화되며 다시 표시되지 않습니다(끝 4자리만).
        </p>

        {loading ? (
          <p className="text-sm text-gray-400">불러오는 중...</p>
        ) : (
          <>
            {registered.length === 0 && (
              <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                등록된 키가 없습니다. AI 기능을 쓰려면 아래에서 최소 1개 등록하세요.
              </p>
            )}

            {registered.length > 1 && (
              <div className="space-y-1.5">
                <Label className="text-xs text-gray-500">시도 순서</Label>
                <div className="space-y-1">
                  {registered.map((r, i) => (
                    <div key={r.provider} className="flex items-center gap-2 text-sm bg-gray-50 rounded px-2 py-1.5">
                      <span className="w-4 text-gray-400 tabular-nums">{i + 1}</span>
                      <span className="flex-1">{META[r.provider].name}</span>
                      <button
                        type="button" disabled={busy !== null || i === 0}
                        onClick={() => reorder(i, i - 1)}
                        className="p-1 text-gray-400 hover:text-gray-700 disabled:opacity-30"
                        aria-label="위로"
                      ><ArrowUp className="w-3.5 h-3.5" /></button>
                      <button
                        type="button" disabled={busy !== null || i === registered.length - 1}
                        onClick={() => reorder(i, i + 1)}
                        className="p-1 text-gray-400 hover:text-gray-700 disabled:opacity-30"
                        aria-label="아래로"
                      ><ArrowDown className="w-3.5 h-3.5" /></button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-4">
              {ALL.map(provider => {
                const row = rowOf(provider)
                const meta = META[provider]
                return (
                  <div key={provider} className="space-y-1.5 border-t pt-3 first:border-t-0 first:pt-0">
                    <div className="flex items-center gap-2">
                      <Label className="flex-1">{meta.name}</Label>
                      {row ? (
                        <Badge variant="secondary" className="font-mono text-xs">••••{row.hint}</Badge>
                      ) : (
                        <span className="text-xs text-gray-400">미등록</span>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <Input
                        type="password"
                        placeholder={row ? '새 키로 교체하려면 입력' : 'API 키 붙여넣기'}
                        value={drafts[provider]}
                        autoComplete="off"
                        onChange={e => setDrafts(d => ({ ...d, [provider]: e.target.value }))}
                      />
                      <Button
                        type="button" variant="outline"
                        disabled={busy !== null || !drafts[provider].trim()}
                        onClick={() => save(provider)}
                      >
                        {busy === provider ? '확인 중...' : row ? '교체' : '저장'}
                      </Button>
                      {row && (
                        <Button
                          type="button" variant="ghost" size="icon"
                          disabled={busy !== null}
                          onClick={() => remove(provider)}
                          aria-label="삭제"
                        >
                          <Trash2 className="w-4 h-4 text-gray-400" />
                        </Button>
                      )}
                    </div>
                    <a
                      href={meta.getUrl} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"
                    >
                      키 발급: {meta.help} <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
