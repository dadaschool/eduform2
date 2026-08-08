'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { Plus, Trash2, GripVertical, Sparkles, ChevronDown, ChevronUp } from 'lucide-react'
import { CHECK_TYPE_OPTIONS, type CheckType } from '@/lib/types'
import type { Class } from '@/lib/types'

interface ItemDraft {
  id: string
  name: string
  description: string
  check_type: CheckType
  number_min: number
  number_max: number
}

export default function NewAssessmentPage() {
  const router = useRouter()
  const supabase = createClient()
  const [classes, setClasses] = useState<Class[]>([])
  const [title, setTitle] = useState('')
  const [subject, setSubject] = useState('')
  const [description, setDescription] = useState('')
  const [selectedClasses, setSelectedClasses] = useState<string[]>([])
  const [items, setItems] = useState<ItemDraft[]>([])
  const [saving, setSaving] = useState(false)
  const [aiLoading, setAiLoading] = useState(false)
  const [aiPrompt, setAiPrompt] = useState('')
  const [showAI, setShowAI] = useState(false)

  const fetchClasses = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data } = await supabase.from('classes').select('*').eq('teacher_id', user.id)
    setClasses(data ?? [])
  }, [supabase])

  useEffect(() => { fetchClasses() }, [fetchClasses])

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

  async function generateWithAI() {
    if (!aiPrompt.trim()) { toast.error('AI 요청 내용을 입력해 주세요'); return }
    setAiLoading(true)
    try {
      const res = await fetch('/api/gemini/assessment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: aiPrompt, subject, title }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      if (data.items && Array.isArray(data.items)) {
        const newItems: ItemDraft[] = data.items.map((it: { name: string; description: string; check_type: CheckType; number_min?: number; number_max?: number }) => ({
          id: crypto.randomUUID(),
          name: it.name ?? '',
          description: it.description ?? '',
          check_type: it.check_type ?? 'level3',
          number_min: it.number_min ?? 0,
          number_max: it.number_max ?? 100,
        }))
        setItems(prev => [...prev, ...newItems])
        toast.success(`AI가 ${newItems.length}개의 평가 항목을 생성했습니다.`, {
          description: data.provider === 'upstage' ? '업스테이지 Solar' : 'Google Gemini',
        })
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'AI 생성 실패')
    } finally {
      setAiLoading(false)
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) { toast.error('평가 제목을 입력해 주세요'); return }
    if (items.length === 0) { toast.error('평가 항목을 1개 이상 추가해 주세요'); return }
    if (items.some(it => !it.name.trim())) { toast.error('모든 평가 항목에 이름을 입력해 주세요'); return }

    setSaving(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('인증 필요')

      const { data: asmt, error: asmtErr } = await supabase.from('assessments').insert({
        teacher_id: user.id,
        title: title.trim(),
        subject: subject.trim() || null,
        description: description.trim() || null,
      }).select().single()
      if (asmtErr) throw asmtErr

      // 평가 항목 삽입
      const { error: itemsErr } = await supabase.from('assessment_items').insert(
        items.map((it, idx) => ({
          assessment_id: asmt.id,
          name: it.name,
          description: it.description || null,
          check_type: it.check_type,
          number_min: it.number_min,
          number_max: it.number_max,
          display_order: idx,
        }))
      )
      if (itemsErr) throw itemsErr

      // 반 배포
      if (selectedClasses.length > 0) {
        await supabase.from('assessment_classes').insert(
          selectedClasses.map(cid => ({ assessment_id: asmt.id, class_id: cid }))
        )
      }

      toast.success('평가가 생성되었습니다.')
      router.push('/teacher/assessments')
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : '저장 실패')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-6 space-y-6 max-w-3xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">새 평가 만들기</h1>
        <p className="text-gray-500 text-sm mt-1">루브릭 기반 평가를 설계하세요</p>
      </div>

      <form onSubmit={handleSave} className="space-y-6">
        {/* 기본 정보 */}
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

        {/* 반 배포 */}
        <Card>
          <CardHeader><CardTitle className="text-base">반 배포</CardTitle></CardHeader>
          <CardContent>
            {classes.length === 0 ? (
              <p className="text-sm text-gray-400">등록된 반이 없습니다. 먼저 반을 추가하세요.</p>
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

        {/* AI 평가 항목 생성 */}
        <Card className="border-purple-200 bg-purple-50/50">
          <CardHeader className="pb-3">
            <button type="button" className="flex items-center justify-between w-full"
              onClick={() => setShowAI(!showAI)}>
              <CardTitle className="text-base flex items-center gap-2 text-purple-700">
                <Sparkles className="w-4 h-4" />
                AI로 평가 항목 초안 생성
              </CardTitle>
              {showAI ? <ChevronUp className="w-4 h-4 text-purple-500" /> : <ChevronDown className="w-4 h-4 text-purple-500" />}
            </button>
          </CardHeader>
          {showAI && (
            <CardContent className="space-y-3">
              <Textarea
                placeholder={`예: "중학교 2학년 국어 토론 수행평가의 평가 항목을 만들어주세요. 상/중/하로 평가하고 싶고, 논리성, 근거, 표현력 등을 평가하고 싶습니다."`}
                value={aiPrompt}
                onChange={e => setAiPrompt(e.target.value)}
                rows={3}
              />
              <Button type="button" className="gap-2 bg-purple-600 hover:bg-purple-700" onClick={generateWithAI} disabled={aiLoading}>
                <Sparkles className="w-4 h-4" />
                {aiLoading ? 'AI 생성 중...' : 'AI로 항목 생성'}
              </Button>
              <p className="text-xs text-purple-600">생성된 항목은 아래에 추가되며, 직접 수정할 수 있습니다.</p>
            </CardContent>
          )}
        </Card>

        {/* 평가 항목 */}
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
                <p className="text-gray-400 text-sm">평가 항목을 추가하거나 AI로 생성하세요</p>
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
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
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

                      {/* 숫자 타입 min/max */}
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

                      {/* 미리보기 */}
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
                          <span className="text-xs text-gray-500">{item.number_min} ~ {item.number_max} (숫자 입력)</span>
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
            {saving ? '저장 중...' : '평가 저장'}
          </Button>
        </div>
      </form>
    </div>
  )
}
