'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { Plus, Trash2, GripVertical } from 'lucide-react'
import { CHECK_TYPE_OPTIONS, type CheckType } from '@/lib/types'
import type { Class } from '@/lib/types'
import { fetchMyClasses } from '@/lib/my-classes'

interface ItemDraft {
  id: string
  dbId?: string
  name: string
  description: string
  check_type: CheckType
  number_min: number
  number_max: number
}

export default function EditAssessmentPage() {
  const router = useRouter()
  const params = useParams()
  const id = params.id as string
  const supabase = createClient()

  const [classes, setClasses] = useState<Class[]>([])
  const [title, setTitle] = useState('')
  const [subject, setSubject] = useState('')
  const [description, setDescription] = useState('')
  const [selectedClasses, setSelectedClasses] = useState<string[]>([])
  const [items, setItems] = useState<ItemDraft[]>([])
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const [{ data: asmt }, cls, { data: asmtItems }, { data: asmtClasses }] = await Promise.all([
      supabase.from('assessments').select('*').eq('id', id).single(),
      fetchMyClasses(supabase, user.id),
      supabase.from('assessment_items').select('*').eq('assessment_id', id).order('display_order'),
      supabase.from('assessment_classes').select('class_id').eq('assessment_id', id),
    ])

    if (!asmt) { toast.error('평가를 찾을 수 없습니다.'); router.push('/teacher/assessments'); return }

    // 학생 체크 데이터 존재 여부 확인
    const { data: itemIds } = await supabase.from('assessment_items').select('id').eq('assessment_id', id)
    if (itemIds && itemIds.length > 0) {
      const { count: checkCount } = await supabase
        .from('student_assessment_checks')
        .select('id', { count: 'exact', head: true })
        .in('assessment_item_id', itemIds.map(i => i.id))
      if ((checkCount ?? 0) > 0) {
        toast.error('학생 평가 데이터가 있어 수정할 수 없습니다.')
        router.push('/teacher/assessments')
        return
      }
    }

    setTitle(asmt.title)
    setSubject(asmt.subject ?? '')
    setDescription(asmt.description ?? '')
    setClasses(cls)
    setSelectedClasses((asmtClasses ?? []).map(r => r.class_id))
    setItems((asmtItems ?? []).map(it => ({
      id: crypto.randomUUID(),
      dbId: it.id,
      name: it.name,
      description: it.description ?? '',
      check_type: it.check_type as CheckType,
      number_min: it.number_min ?? 0,
      number_max: it.number_max ?? 100,
    })))
    setLoading(false)
  }, [id, supabase, router])

  useEffect(() => { fetchData() }, [fetchData])

  function addItem() {
    setItems(prev => [...prev, {
      id: crypto.randomUUID(),
      name: '',
      description: '',
      check_type: 'ox',
      number_min: 0,
      number_max: 100,
    }])
  }

  function updateItem(id: string, field: keyof ItemDraft, value: string | number) {
    setItems(prev => prev.map(it => it.id === id ? { ...it, [field]: value } : it))
  }

  function removeItem(id: string) {
    setItems(prev => prev.filter(it => it.id !== id))
  }

  function toggleClass(classId: string) {
    setSelectedClasses(prev =>
      prev.includes(classId) ? prev.filter(c => c !== classId) : [...prev, classId]
    )
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) { toast.error('평가 제목을 입력해 주세요'); return }
    if (items.length === 0) { toast.error('평가 항목을 1개 이상 추가해 주세요'); return }
    if (items.some(it => !it.name.trim())) { toast.error('모든 평가 항목에 이름을 입력해 주세요'); return }

    setSaving(true)
    try {
      // 기본 정보 업데이트
      const { error: asmtErr } = await supabase.from('assessments').update({
        title: title.trim(),
        subject: subject.trim() || null,
        description: description.trim() || null,
      }).eq('id', id)
      if (asmtErr) throw asmtErr

      // 기존 항목 삭제 후 재삽입
      await supabase.from('assessment_items').delete().eq('assessment_id', id)
      const { error: itemsErr } = await supabase.from('assessment_items').insert(
        items.map((it, idx) => ({
          assessment_id: id,
          name: it.name,
          description: it.description || null,
          check_type: it.check_type,
          number_min: it.number_min,
          number_max: it.number_max,
          display_order: idx,
        }))
      )
      if (itemsErr) throw itemsErr

      // 반 배포 업데이트
      await supabase.from('assessment_classes').delete().eq('assessment_id', id)
      if (selectedClasses.length > 0) {
        await supabase.from('assessment_classes').insert(
          selectedClasses.map(cid => ({ assessment_id: id, class_id: cid }))
        )
      }

      toast.success('평가가 수정되었습니다.')
      router.push('/teacher/assessments')
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : '저장 실패')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="p-6 text-center text-gray-400">불러오는 중...</div>

  return (
    <div className="p-6 space-y-6 max-w-3xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">평가 수정</h1>
        <p className="text-gray-500 text-sm mt-1">평가 정보와 항목을 수정하세요</p>
      </div>

      <form onSubmit={handleSave} className="space-y-6">
        <Card>
          <CardHeader><CardTitle className="text-base">기본 정보</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>평가 제목 *</Label>
                <Input placeholder="예: 1학기 수행평가" value={title} onChange={e => setTitle(e.target.value)} required />
              </div>
              <div className="space-y-1.5">
                <Label>교과 (선택)</Label>
                <Input placeholder="예: 국어, 수학, 과학" value={subject} onChange={e => setSubject(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>설명 (선택)</Label>
              <Textarea placeholder="평가에 대한 설명을 입력하세요" value={description} onChange={e => setDescription(e.target.value)} rows={2} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">반 배포</CardTitle></CardHeader>
          <CardContent>
            {classes.length === 0 ? (
              <p className="text-sm text-gray-400">등록된 반이 없습니다.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {classes.map(c => (
                  <button key={c.id} type="button" onClick={() => toggleClass(c.id)}
                    className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                      selectedClasses.includes(c.id)
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-white text-gray-600 border-gray-300 hover:border-blue-400'
                    }`}>
                    {c.name}
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">평가 항목 ({items.length}개)</CardTitle>
              <Button type="button" variant="outline" size="sm" className="gap-1" onClick={addItem}>
                <Plus className="w-3.5 h-3.5" />
                항목 추가
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {items.length === 0 ? (
              <div className="border-2 border-dashed rounded-lg p-8 text-center">
                <p className="text-gray-400 text-sm">평가 항목을 추가하세요</p>
                <Button type="button" variant="outline" size="sm" className="mt-3 gap-1" onClick={addItem}>
                  <Plus className="w-3.5 h-3.5" />
                  첫 항목 추가
                </Button>
              </div>
            ) : (
              items.map((item, idx) => (
                <div key={item.id} className="border rounded-lg p-4 bg-white space-y-3">
                  <div className="flex items-start gap-2">
                    <GripVertical className="w-4 h-4 text-gray-300 mt-2.5 flex-shrink-0" />
                    <div className="flex-1 space-y-3">
                      <div className="flex gap-3">
                        <div className="flex-1 space-y-1">
                          <Label className="text-xs">항목 이름 *</Label>
                          <Input
                            placeholder={`평가항목 ${idx + 1}`}
                            value={item.name}
                            onChange={e => updateItem(item.id, 'name', e.target.value)}
                            required
                          />
                        </div>
                        <div className="w-48 space-y-1">
                          <Label className="text-xs">체크 방식</Label>
                          <Select value={item.check_type} onValueChange={v => v && updateItem(item.id, 'check_type', v)}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {CHECK_TYPE_OPTIONS.map(opt => (
                                <SelectItem key={opt.value} value={opt.value}>
                                  <div>
                                    <div className="font-medium">{opt.label}</div>
                                    <div className="text-xs text-gray-400">{opt.example}</div>
                                  </div>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      {item.check_type === 'number' && (
                        <div className="flex gap-3">
                          <div className="space-y-1">
                            <Label className="text-xs">최솟값</Label>
                            <Input type="number" value={item.number_min}
                              onChange={e => updateItem(item.id, 'number_min', parseInt(e.target.value))}
                              className="w-24" />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">최댓값</Label>
                            <Input type="number" value={item.number_max}
                              onChange={e => updateItem(item.id, 'number_max', parseInt(e.target.value))}
                              className="w-24" />
                          </div>
                        </div>
                      )}

                      <div className="space-y-1">
                        <Label className="text-xs">설명 (선택)</Label>
                        <Input
                          placeholder="항목에 대한 설명이나 루브릭 기준"
                          value={item.description}
                          onChange={e => updateItem(item.id, 'description', e.target.value)}
                        />
                      </div>

                      <div className="flex items-center gap-1">
                        <span className="text-xs text-gray-400">입력 형태:</span>
                        {item.check_type === 'ox' && (
                          <div className="flex gap-1">
                            <Badge variant="outline" className="text-green-600">O</Badge>
                            <Badge variant="outline" className="text-red-500">X</Badge>
                          </div>
                        )}
                        {item.check_type === 'level3' && (
                          <div className="flex gap-1">
                            {['상', '중', '하'].map(v => <Badge key={v} variant="outline">{v}</Badge>)}
                          </div>
                        )}
                        {item.check_type === 'status3' && (
                          <div className="flex gap-1">
                            {['완료', '보류', '미제출'].map(v => <Badge key={v} variant="outline">{v}</Badge>)}
                          </div>
                        )}
                        {item.check_type === 'number' && (
                          <span className="text-xs text-gray-500">{item.number_min} ~ {item.number_max}</span>
                        )}
                        {item.check_type === 'score5' && (
                          <span className="text-xs text-gray-500">★ 1~5점</span>
                        )}
                        {item.check_type === 'text' && (
                          <span className="text-xs text-gray-500">텍스트 자유 입력</span>
                        )}
                      </div>
                    </div>
                    <Button type="button" variant="ghost" size="icon" className="text-red-400 hover:text-red-600 flex-shrink-0"
                      onClick={() => removeItem(item.id)}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <div className="flex gap-3 pb-8">
          <Button type="button" variant="outline" className="flex-1" onClick={() => router.back()}>취소</Button>
          <Button type="submit" className="flex-1" disabled={saving}>
            {saving ? '저장 중...' : '수정 완료'}
          </Button>
        </div>
      </form>
    </div>
  )
}
