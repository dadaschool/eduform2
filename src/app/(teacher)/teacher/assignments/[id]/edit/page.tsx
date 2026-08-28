'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { toast } from 'sonner'
import { ChevronLeft } from 'lucide-react'
import Link from 'next/link'
import type { Class } from '@/lib/types'
import { fetchMyClasses } from '@/lib/my-classes'

export default function EditAssignmentPage() {
  const params = useParams()
  const id = params.id as string
  const router = useRouter()
  const supabase = createClient()
  const [classes, setClasses] = useState<Class[]>([])
  const [title, setTitle] = useState('')
  const [subject, setSubject] = useState('')
  const [description, setDescription] = useState('')
  const [deadline, setDeadline] = useState('')
  const [selectedClasses, setSelectedClasses] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const [{ data: asng }, cls, { data: ac }] = await Promise.all([
      supabase.from('assignments').select('*').eq('id', id).single(),
      fetchMyClasses(supabase, user.id),
      supabase.from('assignment_classes').select('class_id').eq('assignment_id', id),
    ])

    setClasses(cls)
    if (asng) {
      setTitle(asng.title ?? '')
      setSubject((asng as unknown as { subject?: string }).subject ?? '')
      setDescription(asng.description ?? '')
      if (asng.deadline) {
        // datetime-local input 형식: YYYY-MM-DDTHH:mm
        setDeadline(asng.deadline.slice(0, 16))
      }
    }
    setSelectedClasses((ac ?? []).map(r => r.class_id))
    setLoading(false)
  }, [id, supabase])

  useEffect(() => { fetchData() }, [fetchData])

  function toggleClass(cid: string) {
    setSelectedClasses(prev => prev.includes(cid) ? prev.filter(c => c !== cid) : [...prev, cid])
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) { toast.error('과제 제목을 입력하세요'); return }
    if (!description.trim()) { toast.error('과제 내용을 입력하세요'); return }
    setSaving(true)
    try {
      const { error } = await supabase.from('assignments').update({
        title: title.trim(),
        subject: subject.trim() || null,
        description: description.trim(),
        deadline: deadline ? new Date(deadline).toISOString() : null,
      }).eq('id', id)
      if (error) throw error

      // 반 배포 갱신: 기존 삭제 후 재삽입
      await supabase.from('assignment_classes').delete().eq('assignment_id', id)
      if (selectedClasses.length > 0) {
        await supabase.from('assignment_classes').insert(
          selectedClasses.map(cid => ({ assignment_id: id, class_id: cid }))
        )
      }

      toast.success('과제가 수정되었습니다.')
      router.push('/teacher/assignments')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : (err as { message?: string })?.message ?? JSON.stringify(err)
      toast.error('저장 실패: ' + msg)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="p-6 text-center text-gray-400">불러오는 중...</div>

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/teacher/assignments">
          <Button variant="ghost" size="icon"><ChevronLeft className="w-5 h-5" /></Button>
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">과제 수정</h1>
      </div>

      <form onSubmit={handleSave} className="space-y-6">
        <Card>
          <CardHeader><CardTitle className="text-base">과제 정보</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>과제 제목 *</Label>
                <Input placeholder="예: 1단원 독후감 쓰기" value={title} onChange={e => setTitle(e.target.value)} required />
              </div>
              <div className="space-y-1.5">
                <Label>교과 (선택)</Label>
                <Input placeholder="예: 국어, 정보" value={subject} onChange={e => setSubject(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>과제 내용 *</Label>
              <Textarea
                placeholder="학생들이 수행해야 할 과제 내용을 자세히 설명하세요"
                value={description}
                onChange={e => setDescription(e.target.value)}
                rows={5}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label>제출 마감일 (선택)</Label>
              <Input
                type="datetime-local"
                value={deadline}
                onChange={e => setDeadline(e.target.value)}
              />
              <p className="text-xs text-gray-500">마감일 이후 제출 시 &apos;사후 제출&apos;로 자동 분류됩니다.</p>
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
                    className={`px-3 py-1.5 rounded-full text-sm font-medium border-2 transition-colors ${
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

        <div className="flex gap-3 pb-8">
          <Button type="button" variant="outline" className="flex-1" onClick={() => router.back()}>취소</Button>
          <Button type="submit" className="flex-1" disabled={saving}>{saving ? '저장 중...' : '수정 저장'}</Button>
        </div>
      </form>
    </div>
  )
}
