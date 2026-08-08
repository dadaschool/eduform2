'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { toast } from 'sonner'
import { Plus, Trash2, Edit2, Eye, Search } from 'lucide-react'
import { formatDate } from '@/lib/utils'
import type { Observation, Profile, Class } from '@/lib/types'

interface ObsWithStudent extends Observation {
  student: Profile
}

export default function ObservationsPage() {
  const supabase = createClient()
  const [observations, setObservations] = useState<ObsWithStudent[]>([])
  const [students, setStudents] = useState<Profile[]>([])
  const [classes, setClasses] = useState<Class[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedClass, setSelectedClass] = useState<string | null>(null)
  const [selectedStudent, setSelectedStudent] = useState<Profile | null>(null)
  const [search, setSearch] = useState('')
  const [filterSubject, setFilterSubject] = useState('all')
  const [openAdd, setOpenAdd] = useState(false)
  const [editing, setEditing] = useState<ObsWithStudent | null>(null)

  // 폼
  const [obsContent, setObsContent] = useState('')
  const [obsSubject, setObsSubject] = useState('')
  const [obsDate, setObsDate] = useState(new Date().toISOString().slice(0, 10))
  const [saving, setSaving] = useState(false)

  const fetchData = useCallback(async () => {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const [{ data: obs }, { data: studs }, { data: cls }] = await Promise.all([
      supabase.from('observations').select('*, profiles(*)').eq('teacher_id', user.id).order('observed_at', { ascending: false }),
      supabase.from('profiles').select('*').eq('teacher_id', user.id).eq('role', 'student').order('student_number'),
      supabase.from('classes').select('*').eq('teacher_id', user.id).order('name'),
    ])
    setStudents(studs ?? [])
    setClasses(cls ?? [])
    const mapped = (obs ?? []).map(o => ({ ...o, student: o.profiles as unknown as Profile }))
    setObservations(mapped)

    // 첫 반 자동 선택
    if (cls && cls.length > 0 && !selectedClass) setSelectedClass(cls[0].id)
    setLoading(false)
  }, [supabase]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetchData() }, [fetchData])

  function openAddFor(student: Profile) {
    setSelectedStudent(student)
    setEditing(null)
    setObsContent('')
    setObsSubject('')
    setObsDate(new Date().toISOString().slice(0, 10))
    setOpenAdd(true)
  }

  function openEdit(obs: ObsWithStudent) {
    setSelectedStudent(obs.student)
    setEditing(obs)
    setObsContent(obs.content)
    setObsSubject(obs.subject ?? '')
    setObsDate(obs.observed_at)
    setOpenAdd(true)
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedStudent) return
    if (!obsContent.trim()) { toast.error('관찰 내용을 입력해 주세요'); return }
    setSaving(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('인증 필요')

      if (editing) {
        const { error } = await supabase.from('observations').update({
          content: obsContent.trim(),
          subject: obsSubject.trim() || null,
          observed_at: obsDate,
        }).eq('id', editing.id)
        if (error) throw error
        toast.success('수정되었습니다.')
      } else {
        const { error } = await supabase.from('observations').insert({
          teacher_id: user.id,
          student_id: selectedStudent.id,
          content: obsContent.trim(),
          subject: obsSubject.trim() || null,
          observed_at: obsDate,
        })
        if (error) throw error
        toast.success('저장되었습니다.')
      }
      setOpenAdd(false)
      fetchData()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : '저장 실패')
    } finally {
      setSaving(false)
    }
  }

  async function deleteObs(id: string) {
    if (!confirm('이 관찰 기록을 삭제하시겠습니까?')) return
    const { error } = await supabase.from('observations').delete().eq('id', id)
    if (error) { toast.error('삭제 실패'); return }
    toast.success('삭제되었습니다.')
    fetchData()
  }

  const studentsInClass = students.filter(s => s.class_id === selectedClass)
  const filteredStudents = search
    ? studentsInClass.filter(s => s.name.includes(search) || (s.student_number ?? '').includes(search))
    : studentsInClass

  const allSubjects = Array.from(new Set(observations.map(o => o.subject).filter(Boolean))) as string[]

  const studentObs = selectedStudent
    ? observations.filter(o => {
        const matchSubject = filterSubject === 'all' || o.subject === filterSubject
        return o.student_id === selectedStudent.id && matchSubject
      })
    : []

  // 학생별 관찰 건수
  const obsCountMap = observations.reduce<Record<string, number>>((acc, o) => {
    acc[o.student_id] = (acc[o.student_id] ?? 0) + 1
    return acc
  }, {})

  if (loading) return <div className="p-6 text-center text-gray-400">불러오는 중...</div>

  return (
    <div className="flex h-full">
      {/* 좌측: 반 탭 + 학생 목록 */}
      <div className="w-64 border-r flex flex-col flex-shrink-0">
        {/* 반 탭 */}
        <div className="border-b p-2 flex flex-wrap gap-1">
          {classes.map(c => (
            <button key={c.id} onClick={() => { setSelectedClass(c.id); setSelectedStudent(null) }}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                selectedClass === c.id ? 'bg-orange-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}>
              {c.name}
            </button>
          ))}
        </div>

        {/* 학생 검색 */}
        <div className="p-2 border-b">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
            <Input placeholder="이름, 번호 검색" className="pl-7 h-7 text-xs" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>

        {/* 학생 리스트 — 2열 */}
        <div className="flex-1 overflow-y-auto p-1.5">
          {filteredStudents.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-8">학생이 없습니다</p>
          ) : (
            <div className="grid grid-cols-2 gap-1">
              {filteredStudents.map(s => {
                const count = obsCountMap[s.id] ?? 0
                const isSelected = selectedStudent?.id === s.id
                return (
                  <button key={s.id} onClick={() => setSelectedStudent(s)}
                    className={`flex items-center justify-between px-2 py-1.5 rounded text-left text-xs transition-colors ${
                      isSelected ? 'bg-orange-500 text-white' : 'hover:bg-orange-50 text-gray-700'
                    }`}>
                    <span className="font-medium truncate">{s.name}</span>
                    {count > 0 && (
                      <span className={`ml-1 flex-shrink-0 rounded-full px-1 py-0.5 text-[10px] font-medium ${
                        isSelected ? 'bg-white/30 text-white' : 'bg-orange-100 text-orange-600'
                      }`}>{count}</span>
                    )}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* 우측: 선택된 학생의 관찰 기록 */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {!selectedStudent ? (
          <div className="flex-1 flex items-center justify-center text-gray-400">
            <div className="text-center">
              <Eye className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="text-sm">왼쪽에서 학생을 선택하세요</p>
            </div>
          </div>
        ) : (
          <>
            {/* 교과 필터 */}
            {allSubjects.length > 0 && (
              <div className="flex gap-1.5 px-4 pt-3 flex-wrap flex-shrink-0">
                <button onClick={() => setFilterSubject('all')}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${filterSubject === 'all' ? 'bg-gray-700 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                  전체
                </button>
                {allSubjects.map(s => (
                  <button key={s} onClick={() => setFilterSubject(s)}
                    className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${filterSubject === s ? 'bg-orange-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                    {s}
                  </button>
                ))}
              </div>
            )}
            {/* 헤더 */}
            <div className="flex items-center justify-between p-4 border-b flex-shrink-0">
              <div>
                <h2 className="text-lg font-bold text-gray-900">{selectedStudent.name}</h2>
                <p className="text-xs text-gray-400">
                  {classes.find(c => c.id === selectedStudent.class_id)?.name}
                  {selectedStudent.student_number && ` · ${selectedStudent.student_number}번`}
                  {' · '}관찰 기록 {studentObs.length}건
                </p>
              </div>
              <Button className="gap-1.5" size="sm" onClick={() => openAddFor(selectedStudent)}>
                <Plus className="w-4 h-4" />관찰 추가
              </Button>
            </div>

            {/* 기록 목록 */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {studentObs.length === 0 ? (
                <div className="text-center py-16 text-gray-400">
                  <Eye className="w-10 h-10 mx-auto mb-3 opacity-30" />
                  <p className="text-sm">관찰 기록이 없습니다</p>
                  <Button variant="link" size="sm" className="mt-1 text-orange-500" onClick={() => openAddFor(selectedStudent)}>
                    첫 기록 추가하기
                  </Button>
                </div>
              ) : studentObs.map(obs => (
                <div key={obs.id} className="border rounded-lg p-4 bg-white hover:shadow-sm transition-shadow">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-xs text-gray-400">{formatDate(obs.observed_at)}</span>
                        {obs.subject && (
                          <span className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded">{obs.subject}</span>
                        )}
                      </div>
                      <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{obs.content}</p>
                    </div>
                    <div className="flex gap-1 ml-3 flex-shrink-0">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(obs)}>
                        <Edit2 className="w-3.5 h-3.5 text-blue-400" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => deleteObs(obs.id)}>
                        <Trash2 className="w-3.5 h-3.5 text-red-400" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* 추가/수정 다이얼로그 */}
      <Dialog open={openAdd} onOpenChange={open => { if (!open) setEditing(null); setOpenAdd(open) }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editing ? '관찰 기록 수정' : `관찰 기록 추가 — ${selectedStudent?.name}`}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSave} className="space-y-4 pt-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>교과 (선택)</Label>
                <Input placeholder="예: 국어" value={obsSubject} onChange={e => setObsSubject(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>관찰 날짜</Label>
                <Input type="date" value={obsDate} onChange={e => setObsDate(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>관찰 내용 *</Label>
              <Textarea
                placeholder="학생의 수업 태도, 활동 참여도, 특이사항 등을 기록하세요"
                value={obsContent}
                onChange={e => setObsContent(e.target.value)}
                rows={6}
                required
                autoFocus
              />
            </div>
            <div className="flex gap-2 pt-1">
              <Button type="button" variant="outline" className="flex-1" onClick={() => setOpenAdd(false)}>취소</Button>
              <Button type="submit" className="flex-1" disabled={saving}>{saving ? '저장 중...' : '저장'}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
