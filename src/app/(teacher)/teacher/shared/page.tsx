'use client'

/**
 * 공유 자료 — 다른 교사가 나에게 공유한 배지·평가를 «가져온다».
 *
 * 가져오기는 복사다. 원본을 그대로 쓰지 않는 이유:
 *  · student_badges.badge_id 와 assessment_items.assessment_id 가 on delete cascade 다.
 *    원본을 함께 썼다면 만든 교사가 지우는 순간 내가 준 수여 기록과 채점 결과까지 사라진다.
 *  · 평가 항목은 반마다 손을 봐야 한다. 원본을 고치면 남의 것까지 바뀐다.
 *
 * 여기 보이는 목록 자체가 DB 정책(badges_shared_select / assessments_shared_select)의
 * 결과다. 화면이 걸러내는 것이 아니라, 공유받지 않은 것은 애초에 조회되지 않는다.
 */

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge as UIBadge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { toast } from 'sonner'
import { Search, Download, Award, ClipboardList, Globe, Check, Inbox } from 'lucide-react'
import { formatDate } from '@/lib/utils'

interface SharedBadge {
  id: string
  teacher_id: string
  name: string
  description: string | null
  criteria: string | null
  icon: string
  created_at: string
}

interface SharedAssessment {
  id: string
  teacher_id: string
  title: string
  subject: string | null
  description: string | null
  gemini_prompt: string | null
  created_at: string
  itemCount: number
}

export default function SharedPage() {
  const supabase = createClient()
  const [me, setMe] = useState<string | null>(null)
  const [badges, setBadges] = useState<SharedBadge[]>([])
  const [assessments, setAssessments] = useState<SharedAssessment[]>([])
  /** 교사 id → 이름. «누가 공유했는지» 를 보여준다 */
  const [names, setNames] = useState<Record<string, string>>({})
  /** 전체 공유로 온 자료의 id 들 (나에게만 온 것과 구분해 보여준다) */
  const [viaAll, setViaAll] = useState<Set<string>>(new Set())
  /** 이미 가져온 원본 id 들 — copied_from 으로 판단해 두 번 가져오지 않게 한다 */
  const [imported, setImported] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    setMe(user.id)

    // 내가 만든 것은 «공유받은 것» 이 아니다. neq 로 뺀다.
    // (전체 공유를 걸면 내 것도 조회 범위에 들어온다)
    const [{ data: bs }, { data: as }, { data: bShares }, { data: aShares }, { data: myB }, { data: myA }] =
      await Promise.all([
        supabase.from('badges').select('*').neq('teacher_id', user.id).order('created_at', { ascending: false }),
        supabase.from('assessments').select('*').neq('teacher_id', user.id).order('created_at', { ascending: false }),
        supabase.from('badge_shares').select('badge_id, shared_with'),
        supabase.from('assessment_shares').select('assessment_id, shared_with'),
        supabase.from('badges').select('copied_from').eq('teacher_id', user.id).not('copied_from', 'is', null),
        supabase.from('assessments').select('copied_from').eq('teacher_id', user.id).not('copied_from', 'is', null),
      ])

    const all = new Set<string>()
    for (const r of bShares ?? []) if (r.shared_with === null) all.add(r.badge_id)
    for (const r of aShares ?? []) if (r.shared_with === null) all.add(r.assessment_id)
    setViaAll(all)

    setImported(new Set([
      ...(myB ?? []).map(r => r.copied_from as string),
      ...(myA ?? []).map(r => r.copied_from as string),
    ]))

    // 평가는 항목 수를 함께 보여준다. 몇 항목인지 모르고 가져오게 하지 않는다.
    const enriched = await Promise.all((as ?? []).map(async a => {
      const { count } = await supabase.from('assessment_items')
        .select('*', { count: 'exact', head: true }).eq('assessment_id', a.id)
      return { ...a, itemCount: count ?? 0 }
    }))

    setBadges(bs ?? [])
    setAssessments(enriched)

    // 만든 교사 이름. profiles 정책이 교사끼리는 열어 두므로 한 번에 읽는다.
    const ids = Array.from(new Set([...(bs ?? []), ...(as ?? [])].map(r => r.teacher_id)))
    if (ids.length) {
      const { data: profs } = await supabase.from('profiles').select('id, name').in('id', ids)
      setNames(Object.fromEntries((profs ?? []).map(p => [p.id, p.name])))
    }
    setLoading(false)
  }, [supabase])

  useEffect(() => { load() }, [load])

  async function importBadge(b: SharedBadge) {
    if (!me) return
    setBusy(b.id)
    try {
      const { error } = await supabase.from('badges').insert({
        teacher_id: me,
        name: b.name,
        description: b.description,
        criteria: b.criteria,
        icon: b.icon,
        copied_from: b.id,
      })
      if (error) throw error
      toast.success(`"${b.name}" 배지를 내 배지로 가져왔습니다.`)
      setImported(prev => new Set(prev).add(b.id))
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : '가져오기 실패')
    } finally {
      setBusy(null)
    }
  }

  async function importAssessment(a: SharedAssessment) {
    if (!me) return
    setBusy(a.id)
    try {
      const { data: created, error } = await supabase.from('assessments').insert({
        teacher_id: me,
        title: a.title,
        subject: a.subject,
        description: a.description,
        gemini_prompt: a.gemini_prompt,
        copied_from: a.id,
      }).select('id').single()
      if (error) throw error

      // 항목까지 옮겨야 «쓸 수 있는» 평가가 된다. 반 배포와 채점 결과는
      // 가져오지 않는다 — 어느 반에 냈고 누가 몇 점인지는 남의 기록이다.
      const { data: items } = await supabase.from('assessment_items')
        .select('name, description, check_type, number_min, number_max, display_order')
        .eq('assessment_id', a.id).order('display_order')

      if (items?.length) {
        const { error: itemErr } = await supabase.from('assessment_items')
          .insert(items.map(it => ({ ...it, assessment_id: created.id })))
        // 항목이 없는 평가는 쓸 수 없다. 반쪽만 남기지 않고 되돌린다.
        if (itemErr) {
          await supabase.from('assessments').delete().eq('id', created.id)
          throw itemErr
        }
      }
      toast.success(`"${a.title}" 평가를 항목 ${items?.length ?? 0}개와 함께 가져왔습니다.`)
      setImported(prev => new Set(prev).add(a.id))
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : '가져오기 실패')
    } finally {
      setBusy(null)
    }
  }

  const fb = badges.filter(b => b.name.includes(search) || (names[b.teacher_id] ?? '').includes(search))
  const fa = assessments.filter(a =>
    a.title.includes(search) || (a.subject ?? '').includes(search) || (names[a.teacher_id] ?? '').includes(search))

  /** 누가·어떻게 공유했는지 한 줄 */
  const from = (teacherId: string, resourceId: string) => (
    <span className="flex items-center gap-1.5 text-xs text-gray-500">
      {names[teacherId] ?? '다른 교사'} 선생님
      {viaAll.has(resourceId)
        ? <UIBadge variant="secondary" className="gap-1 font-normal"><Globe className="w-3 h-3" />전체 공유</UIBadge>
        : <UIBadge variant="secondary" className="font-normal">나에게 공유</UIBadge>}
    </span>
  )

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">공유 자료</h1>
        <p className="text-gray-500 text-sm mt-1">
          다른 교사가 공유한 배지와 평가입니다. 가져오면 <b>내 사본</b>이 되어 자유롭게 고칠 수 있고,
          원본이 지워져도 내 기록은 남습니다.
        </p>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <Input placeholder="이름, 교과, 공유한 교사 검색" className="pl-9"
          value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400">불러오는 중...</div>
      ) : (
        <Tabs defaultValue="assessments">
          <TabsList>
            <TabsTrigger value="assessments">평가 {fa.length}</TabsTrigger>
            <TabsTrigger value="badges">배지 {fb.length}</TabsTrigger>
          </TabsList>

          <TabsContent value="assessments" className="pt-4">
            {fa.length === 0 ? (
              <Card className="border-dashed">
                <CardContent className="py-12 text-center">
                  <Inbox className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                  <p className="text-gray-500 font-medium">공유받은 평가가 없습니다</p>
                  <p className="text-gray-400 text-sm mt-1">다른 교사가 공유하면 여기에 나타납니다</p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4">
                {fa.map(a => (
                  <Card key={a.id}>
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <CardTitle className="text-lg">{a.title}</CardTitle>
                          <div className="flex items-center gap-2 mt-1 flex-wrap">
                            {a.subject && <UIBadge variant="secondary">{a.subject}</UIBadge>}
                            {from(a.teacher_id, a.id)}
                            <span className="text-xs text-gray-400">{formatDate(a.created_at)}</span>
                          </div>
                        </div>
                        {imported.has(a.id) ? (
                          <Button variant="ghost" size="sm" disabled className="gap-1.5 shrink-0">
                            <Check className="w-4 h-4" />가져왔습니다
                          </Button>
                        ) : (
                          <Button size="sm" className="gap-1.5 shrink-0"
                            disabled={busy !== null} onClick={() => importAssessment(a)}>
                            <Download className="w-4 h-4" />
                            {busy === a.id ? '가져오는 중...' : '내 평가로 가져오기'}
                          </Button>
                        )}
                      </div>
                    </CardHeader>
                    <CardContent>
                      <span className="flex items-center gap-1 text-sm text-gray-600">
                        <ClipboardList className="w-3.5 h-3.5" />평가항목 {a.itemCount}개
                      </span>
                      {a.description && <p className="text-sm text-gray-500 mt-2 line-clamp-2">{a.description}</p>}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="badges" className="pt-4">
            {fb.length === 0 ? (
              <Card className="border-dashed">
                <CardContent className="py-12 text-center">
                  <Award className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                  <p className="text-gray-500 font-medium">공유받은 배지가 없습니다</p>
                  <p className="text-gray-400 text-sm mt-1">다른 교사가 공유하면 여기에 나타납니다</p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {fb.map(b => (
                  <Card key={b.id}>
                    <CardContent className="p-4 text-center space-y-2">
                      <div className="text-4xl">{b.icon}</div>
                      <h3 className="font-semibold text-gray-900 text-sm">{b.name}</h3>
                      {b.description && <p className="text-xs text-gray-500">{b.description}</p>}
                      {b.criteria && (
                        <div className="p-2 bg-yellow-50 rounded text-xs text-yellow-700">{b.criteria}</div>
                      )}
                      <div className="flex justify-center">{from(b.teacher_id, b.id)}</div>
                      {imported.has(b.id) ? (
                        <Button variant="ghost" size="sm" disabled className="w-full gap-1.5">
                          <Check className="w-4 h-4" />가져왔습니다
                        </Button>
                      ) : (
                        <Button size="sm" variant="outline" className="w-full gap-1.5"
                          disabled={busy !== null} onClick={() => importBadge(b)}>
                          <Download className="w-4 h-4" />
                          {busy === b.id ? '가져오는 중...' : '가져오기'}
                        </Button>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      )}
    </div>
  )
}
