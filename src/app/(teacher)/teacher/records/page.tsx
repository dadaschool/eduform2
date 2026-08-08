'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { Sparkles, Search, Save, CheckCircle, FileText } from 'lucide-react'
import { formatDateTime } from '@/lib/utils'
import type { Profile, Class, StudentRecordDraft } from '@/lib/types'

export default function RecordsPage() {
  const supabase = createClient()
  const [students, setStudents] = useState<Profile[]>([])
  const [classes, setClasses] = useState<Class[]>([])
  const [drafts, setDrafts] = useState<StudentRecordDraft[]>([])
  const [selectedStudent, setSelectedStudent] = useState<Profile | null>(null)
  const [filterClass, setFilterClass] = useState('all')
  const [search, setSearch] = useState('')
  const [subject, setSubject] = useState('')
  const [editedDraft, setEditedDraft] = useState('')
  const [generating, setGenerating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const [{ data: studs }, { data: cls }, { data: drf }] = await Promise.all([
      supabase.from('profiles').select('*').eq('teacher_id', user.id).eq('role', 'student').order('name'),
      supabase.from('classes').select('*').eq('teacher_id', user.id),
      supabase.from('student_record_drafts').select('*').eq('teacher_id', user.id).order('generated_at', { ascending: false }),
    ])
    setStudents(studs ?? [])
    setClasses(cls ?? [])
    setDrafts(drf ?? [])
    setLoading(false)
  }, [supabase])

  useEffect(() => { fetchData() }, [fetchData])

  async function generateDraft() {
    if (!selectedStudent) { toast.error('학생을 선택하세요'); return }
    setGenerating(true)
    try {
      const res = await fetch('/api/gemini/record', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId: selectedStudent.id, subject }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setEditedDraft(data.draft)
      toast.success('학생부 초안이 생성되었습니다.', {
        description: data.provider === 'upstage' ? '업스테이지 Solar' : 'Google Gemini',
      })
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : '생성 실패')
    } finally {
      setGenerating(false)
    }
  }

  async function saveDraft() {
    if (!selectedStudent || !editedDraft.trim()) return
    setSaving(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('인증 필요')
      const { error } = await supabase.from('student_record_drafts').insert({
        teacher_id: user.id,
        student_id: selectedStudent.id,
        subject: subject || null,
        content: editedDraft.trim(),
      })
      if (error) throw error
      toast.success('초안이 저장되었습니다.')
      fetchData()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : '저장 실패')
    } finally {
      setSaving(false)
    }
  }

  async function markFinal(draftId: string) {
    const { error } = await supabase.from('student_record_drafts').update({ is_final: true }).eq('id', draftId)
    if (error) toast.error('오류 발생')
    else { toast.success('최종본으로 표시되었습니다.'); fetchData() }
  }

  const filteredStudents = students.filter(s => {
    const matchClass = filterClass === 'all' || (filterClass === 'unassigned' ? !s.class_id : s.class_id === filterClass)
    const matchSearch = s.name.includes(search)
    return matchClass && matchSearch
  })

  const studentDrafts = drafts.filter(d => d.student_id === selectedStudent?.id)

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">학생부 초안 생성</h1>
        <p className="text-gray-500 text-sm mt-1">평가·과제·관찰 기록을 종합해 세특 초안을 생성합니다</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 학생 선택 */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">학생 선택</CardTitle>
            <div className="space-y-2 mt-2">
              <Select value={filterClass} onValueChange={(v) => setFilterClass(v || 'all')}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue>{classes.find(c => c.id === filterClass)?.name ?? '전체 반'}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">전체 반</SelectItem>
                  <SelectItem value="unassigned">미배정</SelectItem>
                  {classes.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                <Input placeholder="학생 이름 검색" className="pl-7 h-8 text-sm" value={search} onChange={e => setSearch(e.target.value)} />
              </div>
            </div>
          </CardHeader>
          <CardContent className="max-h-80 overflow-y-auto space-y-1">
            {loading ? <p className="text-sm text-gray-400">불러오는 중...</p> :
              filteredStudents.length === 0 ? <p className="text-sm text-gray-400">학생이 없습니다</p> :
              filteredStudents.map(s => (
                <button key={s.id} type="button"
                  onClick={() => { setSelectedStudent(s); setEditedDraft('') }}
                  className={`w-full flex items-center gap-2 p-2.5 rounded-lg text-left transition-colors ${
                    selectedStudent?.id === s.id ? 'bg-blue-50 text-blue-700 font-medium' : 'hover:bg-gray-50 text-gray-700'
                  }`}>
                  <div className="w-7 h-7 rounded-full bg-gray-200 flex items-center justify-center text-xs font-bold">
                    {s.name[0]}
                  </div>
                  <div>
                    <div className="text-sm">{s.name}</div>
                    <div className="text-xs text-gray-400">{classes.find(c => c.id === s.class_id)?.name}</div>
                  </div>
                  {drafts.some(d => d.student_id === s.id && d.is_final) && (
                    <CheckCircle className="w-3.5 h-3.5 text-green-500 ml-auto" />
                  )}
                </button>
              ))
            }
          </CardContent>
        </Card>

        {/* 초안 생성 영역 */}
        <div className="lg:col-span-2 space-y-4">
          {!selectedStudent ? (
            <Card className="h-full flex items-center justify-center border-dashed">
              <CardContent className="text-center py-12">
                <FileText className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                <p className="text-gray-500">왼쪽에서 학생을 선택하세요</p>
              </CardContent>
            </Card>
          ) : (
            <>
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center text-sm font-bold text-blue-600">
                      {selectedStudent.name[0]}
                    </div>
                    {selectedStudent.name}
                    <span className="text-sm text-gray-400 font-normal">
                      — {classes.find(c => c.id === selectedStudent.class_id)?.name}
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="space-y-1.5">
                    <Label>교과 (선택)</Label>
                    <Input placeholder="예: 국어" value={subject} onChange={e => setSubject(e.target.value)} />
                  </div>
                  <Button
                    className="w-full gap-2 bg-purple-600 hover:bg-purple-700"
                    onClick={generateDraft}
                    disabled={generating}
                  >
                    <Sparkles className="w-4 h-4" />
                    {generating ? 'AI 생성 중...' : 'AI로 세특 초안 생성'}
                  </Button>
                  <p className="text-xs text-gray-400 text-center">
                    평가 체크, 과제 제출 현황, 관찰일지를 종합해 생성합니다
                  </p>
                </CardContent>
              </Card>

              {editedDraft && (
                <Card>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base">생성된 초안</CardTitle>
                      <Badge variant="secondary" className="text-xs">수정 가능</Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <Textarea
                      value={editedDraft}
                      onChange={e => setEditedDraft(e.target.value)}
                      rows={10}
                      className="text-sm leading-relaxed"
                    />
                    <div className="flex gap-2">
                      <Button variant="outline" className="flex-1 gap-2" onClick={generateDraft} disabled={generating}>
                        <Sparkles className="w-4 h-4" />
                        재생성
                      </Button>
                      <Button className="flex-1 gap-2" onClick={saveDraft} disabled={saving}>
                        <Save className="w-4 h-4" />
                        {saving ? '저장 중...' : '초안 저장'}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* 이전 초안 */}
              {studentDrafts.length > 0 && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">저장된 초안 ({studentDrafts.length}개)</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 max-h-64 overflow-y-auto">
                    {studentDrafts.map(d => (
                      <div key={d.id} className={`border rounded-lg p-3 ${d.is_final ? 'border-green-300 bg-green-50' : 'bg-gray-50'}`}>
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            {d.is_final && <Badge className="bg-green-500 text-xs">최종본</Badge>}
                            {d.subject && <span className="text-xs text-gray-500">{d.subject}</span>}
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-400">{formatDateTime(d.generated_at)}</span>
                            {!d.is_final && (
                              <Button size="sm" variant="outline" className="h-6 px-2 text-xs" onClick={() => markFinal(d.id)}>
                                최종 표시
                              </Button>
                            )}
                          </div>
                        </div>
                        <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed line-clamp-3">{d.content}</p>
                        <Button variant="link" size="sm" className="p-0 h-auto text-xs mt-1"
                          onClick={() => setEditedDraft(d.content)}>
                          편집창에 불러오기
                        </Button>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
