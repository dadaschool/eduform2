'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from 'sonner'
import { Plus, Search, Trash2, ClipboardList, Users } from 'lucide-react'
import { formatDate } from '@/lib/utils'
import type { Assessment, Class } from '@/lib/types'

interface AssessmentWithStats extends Assessment {
  itemCount: number
  classNames: string[]
  hasChecks: boolean
}

export default function AssessmentsPage() {
  const supabase = createClient()
  const [assessments, setAssessments] = useState<AssessmentWithStats[]>([])
  const [classes, setClasses] = useState<Class[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterClass, setFilterClass] = useState('all')
  const [filterSubject, setFilterSubject] = useState('all')

  const fetchData = useCallback(async () => {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const [{ data: asmts }, { data: cls }] = await Promise.all([
      supabase.from('assessments').select('*').eq('teacher_id', user.id).order('created_at', { ascending: false }),
      supabase.from('classes').select('*').eq('teacher_id', user.id),
    ])
    setClasses(cls ?? [])

    if (asmts) {
      const enriched = await Promise.all(asmts.map(async a => {
        const [{ count }, { data: ac }, { count: checkCount }] = await Promise.all([
          supabase.from('assessment_items').select('*', { count: 'exact', head: true }).eq('assessment_id', a.id),
          supabase.from('assessment_classes').select('class_id').eq('assessment_id', a.id),
          supabase.from('student_assessment_checks')
            .select('id', { count: 'exact', head: true })
            .in('assessment_item_id',
              await supabase.from('assessment_items').select('id').eq('assessment_id', a.id)
                .then(r => (r.data ?? []).map(i => i.id))
            ),
        ])
        const classNames = (ac ?? []).map(r => cls?.find(c => c.id === r.class_id)?.name ?? '').filter(Boolean)
        return { ...a, itemCount: count ?? 0, classNames, hasChecks: (checkCount ?? 0) > 0 }
      }))
      setAssessments(enriched)
    }
    setLoading(false)
  }, [supabase])

  useEffect(() => { fetchData() }, [fetchData])

  async function deleteAssessment(id: string, title: string) {
    if (!confirm(`"${title}" 평가를 삭제합니다. 학생 체크 데이터도 모두 삭제됩니다.`)) return
    const { error } = await supabase.from('assessments').delete().eq('id', id)
    if (error) { toast.error('삭제 실패'); return }
    toast.success('평가가 삭제되었습니다.')
    fetchData()
  }

  const subjects = Array.from(new Set(assessments.map(a => a.subject).filter(Boolean))) as string[]

  const filtered = assessments.filter(a => {
    const matchSearch = a.title.includes(search) || (a.subject ?? '').includes(search)
    const matchClass = filterClass === 'all' || a.classNames.some(cn => classes.find(c => c.id === filterClass)?.name === cn)
    const matchSubject = filterSubject === 'all' || a.subject === filterSubject
    return matchSearch && matchClass && matchSubject
  })

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">평가 관리</h1>
          <p className="text-gray-500 text-sm mt-1">루브릭 기반 평가를 설계하고 학생별 체크를 기록하세요</p>
        </div>
        <Link href="/teacher/assessments/new">
          <Button className="gap-2"><Plus className="w-4 h-4" />새 평가 만들기</Button>
        </Link>
      </div>

      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input placeholder="평가명, 교과 검색" className="pl-9" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <Select value={filterSubject} onValueChange={v => setFilterSubject(v || 'all')}>
          <SelectTrigger className="w-36">
            <SelectValue>{filterSubject === 'all' ? '전체 교과' : filterSubject}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">전체 교과</SelectItem>
            {subjects.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterClass} onValueChange={(v) => setFilterClass(v || 'all')}>
          <SelectTrigger className="w-36">
            <SelectValue>{classes.find(c => c.id === filterClass)?.name ?? '전체 반'}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">전체 반</SelectItem>
            {classes.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400">불러오는 중...</div>
      ) : filtered.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center">
            <ClipboardList className="w-12 h-12 mx-auto mb-3 text-gray-300" />
            <p className="text-gray-500 font-medium">등록된 평가가 없습니다</p>
            <Link href="/teacher/assessments/new">
              <Button variant="link" className="mt-2">새 평가 만들기</Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {filtered.map(a => (
            <Card key={a.id} className="hover:shadow-md transition-shadow">
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-lg">{a.title}</CardTitle>
                    <div className="flex items-center gap-2 mt-1">
                      {a.subject && <Badge variant="secondary">{a.subject}</Badge>}
                      <span className="text-xs text-gray-400">{formatDate(a.created_at)}</span>
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <Link href={`/teacher/assessments/${a.id}/check`}>
                      <Button variant="outline" size="sm" className="gap-1">
                        <ClipboardList className="w-3.5 h-3.5" />
                        체크 입력
                      </Button>
                    </Link>
                    {a.hasChecks ? (
                      <Button variant="ghost" size="sm" disabled title="학생 평가 데이터가 있어 수정할 수 없습니다">수정 불가</Button>
                    ) : (
                      <Link href={`/teacher/assessments/${a.id}/edit`}>
                        <Button variant="ghost" size="sm">수정</Button>
                      </Link>
                    )}
                    <Button variant="ghost" size="icon" className="text-red-400 hover:text-red-600"
                      onClick={() => deleteAssessment(a.id, a.title)}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-4 text-sm text-gray-600">
                  <span className="flex items-center gap-1">
                    <ClipboardList className="w-3.5 h-3.5" />
                    평가항목 {a.itemCount}개
                  </span>
                  {a.classNames.length > 0 && (
                    <span className="flex items-center gap-1">
                      <Users className="w-3.5 h-3.5" />
                      {a.classNames.join(', ')}
                    </span>
                  )}
                </div>
                {a.description && (
                  <p className="text-sm text-gray-500 mt-2 line-clamp-2">{a.description}</p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
