'use client'

/**
 * 배지·평가를 다른 교사에게 공유하는 창.
 *
 * 공유는 «보여 준다» 까지다. 받은 교사는 [공유 자료] 화면에서 자기 것으로
 * 복사해 쓴다. 원본을 함께 쓰게 하지 않는 이유는 DB 쪽 제약이다 —
 * student_badges 와 assessment_items 가 on delete cascade 라서, 원본을
 * 공유해 쓰다가 만든 교사가 그것을 지우면 다른 반 학생들의 수여 기록과
 * 채점 결과까지 함께 사라진다.
 *
 * 실제 차단은 DB 정책이 한다(badge_shares_owner / assessments_shared_select).
 * 이 화면은 그 정책을 «쓰기 좋게» 감싼 것일 뿐이다.
 */

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { toast } from 'sonner'
import { Users, Search, Check, Globe, X } from 'lucide-react'

type Kind = 'badge' | 'assessment'

interface Teacher {
  id: string
  name: string
  email: string | null
}

/** 종류별로 다른 것은 표 이름과 열 이름뿐이다. */
const TABLE: Record<Kind, { shares: string; fk: string; label: string }> = {
  badge: { shares: 'badge_shares', fk: 'badge_id', label: '배지' },
  assessment: { shares: 'assessment_shares', fk: 'assessment_id', label: '평가' },
}

interface ShareDialogProps {
  kind: Kind
  /** 공유할 배지·평가 id */
  resourceId: string
  /** 창 제목에 보여줄 이름 */
  resourceName: string
  open: boolean
  onOpenChange: (v: boolean) => void
  /** 공유 상태가 바뀌면 목록을 다시 읽게 한다 */
  onChanged?: () => void
}

export default function ShareDialog({
  kind, resourceId, resourceName, open, onOpenChange, onChanged,
}: ShareDialogProps) {
  const supabase = createClient()
  const { shares: table, fk, label } = TABLE[kind]

  const [teachers, setTeachers] = useState<Teacher[]>([])
  /** 이 자료를 공유받은 교사 id 들 */
  const [sharedWith, setSharedWith] = useState<Set<string>>(new Set())
  /** 교사 전체 공유가 걸려 있는가 (shared_with = null 인 행) */
  const [shareAll, setShareAll] = useState(false)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  /** 지금 처리 중인 교사 id (또는 전체 공유는 'all') — 두 번 누르는 것을 막는다 */
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const [{ data: profs }, { data: rows }] = await Promise.all([
      // 나 자신은 뺀다. 자기에게 공유하는 것은 뜻이 없다.
      supabase.from('profiles').select('id, name, email')
        .eq('role', 'teacher').neq('id', user.id).order('name'),
      supabase.from(table).select('id, shared_with').eq(fk, resourceId),
    ])

    setTeachers(profs ?? [])
    setShareAll((rows ?? []).some(r => r.shared_with === null))
    setSharedWith(new Set((rows ?? []).filter(r => r.shared_with).map(r => r.shared_with as string)))
    setLoading(false)
  }, [supabase, table, fk, resourceId])

  useEffect(() => { if (open) load() }, [open, load])

  async function toggleAll() {
    setBusy('all')
    try {
      if (shareAll) {
        const { error } = await supabase.from(table).delete().eq(fk, resourceId).is('shared_with', null)
        if (error) throw error
        setShareAll(false)
        toast.success('전체 공유를 해제했습니다.')
      } else {
        const { error } = await supabase.from(table).insert({ [fk]: resourceId, shared_with: null })
        if (error) throw error
        setShareAll(true)
        toast.success(`모든 교사에게 ${label}를 공유했습니다.`)
      }
      onChanged?.()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : '공유 변경 실패')
    } finally {
      setBusy(null)
    }
  }

  async function toggleTeacher(t: Teacher) {
    setBusy(t.id)
    try {
      if (sharedWith.has(t.id)) {
        const { error } = await supabase.from(table).delete().eq(fk, resourceId).eq('shared_with', t.id)
        if (error) throw error
        setSharedWith(prev => { const n = new Set(prev); n.delete(t.id); return n })
        toast.success(`${t.name} 선생님 공유를 해제했습니다.`)
      } else {
        const { error } = await supabase.from(table).insert({ [fk]: resourceId, shared_with: t.id })
        if (error) throw error
        setSharedWith(prev => new Set(prev).add(t.id))
        toast.success(`${t.name} 선생님에게 공유했습니다.`)
      }
      onChanged?.()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : '공유 변경 실패')
    } finally {
      setBusy(null)
    }
  }

  const filtered = teachers.filter(t =>
    t.name.includes(search) || (t.email ?? '').toLowerCase().includes(search.toLowerCase()))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">
            <span className="text-gray-500 font-normal">{label} 공유 — </span>{resourceName}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 pt-1">
          {/* 받은 교사가 «무엇을 할 수 있는지» 를 미리 알려 준다.
              공유해 놓고 상대가 고칠 줄 알았다가 어긋나는 일을 막는다. */}
          <p className="text-xs text-gray-500 bg-gray-50 rounded-lg p-2.5 leading-relaxed">
            공유받은 교사는 이 {label}를 <b>볼 수 있고</b>, [공유 자료] 화면에서
            <b> 자기 것으로 가져가</b> 씁니다. 원본을 고치거나 지우지는 못합니다.
          </p>

          {/* 전체 공유 */}
          <button type="button" onClick={toggleAll} disabled={busy !== null}
            className={`w-full flex items-center gap-3 p-3 rounded-lg border transition-colors text-left
              ${shareAll ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'}
              disabled:opacity-50`}>
            <Globe className={`w-4 h-4 shrink-0 ${shareAll ? 'text-blue-600' : 'text-gray-400'}`} />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-gray-900">모든 교사에게 공유</div>
              <div className="text-xs text-gray-500">
                {shareAll ? '지금 전교 교사가 볼 수 있습니다' : '학생에게는 공개되지 않습니다'}
              </div>
            </div>
            {shareAll && <Check className="w-4 h-4 text-blue-600 shrink-0" />}
          </button>

          <div className="flex items-center gap-2">
            <div className="h-px bg-gray-200 flex-1" />
            <span className="text-xs text-gray-400">또는 특정 교사에게</span>
            <div className="h-px bg-gray-200 flex-1" />
          </div>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input placeholder="교사 이름 검색" className="pl-9 h-9"
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>

          <div className="max-h-64 overflow-y-auto -mx-1 px-1 space-y-1">
            {loading ? (
              <p className="text-sm text-gray-400 text-center py-6">불러오는 중...</p>
            ) : filtered.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-6">
                {teachers.length === 0 ? '다른 교사 계정이 없습니다' : '검색 결과가 없습니다'}
              </p>
            ) : filtered.map(t => {
              const on = sharedWith.has(t.id)
              return (
                <button key={t.id} type="button" onClick={() => toggleTeacher(t)} disabled={busy !== null}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg border transition-colors text-left
                    ${on ? 'border-green-500 bg-green-50' : 'border-transparent hover:bg-gray-50'}
                    disabled:opacity-50`}>
                  <Users className={`w-4 h-4 shrink-0 ${on ? 'text-green-600' : 'text-gray-300'}`} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-gray-900 truncate">{t.name}</div>
                    {t.email && <div className="text-xs text-gray-400 truncate">{t.email}</div>}
                  </div>
                  {on
                    ? <Check className="w-4 h-4 text-green-600 shrink-0" />
                    : <span className="text-xs text-gray-400 shrink-0">공유</span>}
                </button>
              )
            })}
          </div>

          {/* 전체 공유가 걸려 있으면 개별 지정은 뜻이 없다. 헷갈리지 않게 알려 준다. */}
          {shareAll && (
            <p className="text-xs text-amber-700 bg-amber-50 rounded-lg p-2.5 flex items-start gap-2">
              <Globe className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              전체 공유 중이라 개별 지정과 상관없이 모든 교사가 볼 수 있습니다.
            </p>
          )}

          <Button variant="outline" className="w-full gap-2" onClick={() => onOpenChange(false)}>
            <X className="w-4 h-4" />닫기
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
