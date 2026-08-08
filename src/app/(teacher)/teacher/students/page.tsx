'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from 'sonner'
import { Plus, Upload, Download, Search, Trash2, Key, Users, ExternalLink } from 'lucide-react'
import Link from 'next/link'
import type { Profile, Class, Badge as BadgeType } from '@/lib/types'
import * as XLSX from 'xlsx'

interface StudentRow extends Profile {
  class?: Class
  // badgeId → [rowId, ...] (중복 수여된 개별 row id 목록)
  badgeMap: Record<string, string[]>
}

export default function StudentsPage() {
  const supabase = createClient()
  const [students, setStudents] = useState<StudentRow[]>([])
  const [classes, setClasses] = useState<Class[]>([])
  const [badges, setBadges] = useState<BadgeType[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterClass, setFilterClass] = useState('all')

  // 인라인 편집 상태
  const [editingCell, setEditingCell] = useState<{ studentId: string; field: string } | null>(null)
  const [editValues, setEditValues] = useState<Record<string, string>>({})

  // 학생 추가
  const [openAdd, setOpenAdd] = useState(false)
  const [addName, setAddName] = useState('')
  const [addEmail, setAddEmail] = useState('')
  const [addNumber, setAddNumber] = useState('')
  const [addClassId, setAddClassId] = useState('')
  const [addPassword, setAddPassword] = useState('edu1234')
  const [saving, setSaving] = useState(false)

  // 엑셀 업로드
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploadClassId, setUploadClassId] = useState('')
  const [openUpload, setOpenUpload] = useState(false)
  const [uploading, setUploading] = useState(false)

  const fetchData = useCallback(async () => {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const [{ data: cls }, { data: studs }, { data: bdgs }, { data: allSb }] = await Promise.all([
      supabase.from('classes').select('*').eq('teacher_id', user.id).order('name'),
      supabase.from('profiles').select('*').eq('teacher_id', user.id).eq('role', 'student').order('student_number').order('name'),
      supabase.from('badges').select('*').eq('teacher_id', user.id).order('created_at'),
      supabase.from('student_badges').select('id, student_id, badge_id').eq('awarded_by', user.id),
    ])
    setClasses(cls ?? [])
    setBadges(bdgs ?? [])

    const rows: StudentRow[] = (studs ?? []).map(s => {
      const badgeMap: Record<string, string[]> = {}
      ;(allSb ?? []).filter(r => r.student_id === s.id).forEach(r => {
        if (!badgeMap[r.badge_id]) badgeMap[r.badge_id] = []
        badgeMap[r.badge_id].push(r.id)
      })
      const classObj = (cls ?? []).find(c => c.id === s.class_id)
      return { ...s, class: classObj, badgeMap }
    })
    setStudents(rows)
    setLoading(false)
  }, [supabase])

  useEffect(() => { fetchData() }, [fetchData])

  // 배지 셀 클릭: 미수여 → 수여, 수여됨 → 1개 회수
  async function toggleBadge(student: StudentRow, badgeId: string) {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const existing = student.badgeMap[badgeId] ?? []
    if (existing.length === 0) {
      // 수여
      const { error } = await supabase.from('student_badges').insert({
        student_id: student.id, badge_id: badgeId, awarded_by: user.id
      })
      if (error) { toast.error('수여 실패: ' + error.message); return }
    } else {
      // 가장 최근 1개 회수
      const { error } = await supabase.from('student_badges').delete().eq('id', existing[0])
      if (error) { toast.error('회수 실패'); return }
    }
    fetchData()
  }

  // 추가 수여 (이미 있는 배지 하나 더)
  async function addBadge(student: StudentRow, badgeId: string) {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { error } = await supabase.from('student_badges').insert({
      student_id: student.id, badge_id: badgeId, awarded_by: user.id
    })
    if (error) toast.error('수여 실패: ' + error.message)
    else fetchData()
  }

  // 인라인 편집 저장
  async function saveInlineEdit(student: StudentRow, field: string, value: string) {
    setEditingCell(null)
    if (field === 'email') {
      if (!value.trim() || value === student.email) return
      const res = await fetch('/api/teacher/reset-password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: student.id, email: value.trim() }),
      })
      const result = await res.json()
      if (!res.ok) toast.error('이메일 변경 실패: ' + result.error)
      else { toast.success('이메일이 변경되었습니다.'); fetchData() }
      return
    }
    const updateData: Record<string, string | null> = {}
    if (field === 'name') {
      if (!value.trim()) return
      updateData.name = value.trim()
    } else if (field === 'student_number') {
      updateData.student_number = value.trim() || null
    } else if (field === 'class_id') {
      updateData.class_id = value || null
    }
    const { error } = await supabase.from('profiles').update(updateData).eq('id', student.id)
    if (error) toast.error('저장 실패: ' + error.message)
    else fetchData()
  }

  async function deleteStudent(id: string, name: string) {
    if (!confirm(`"${name}" 학생을 삭제하면 과제·평가·관찰기록이 모두 삭제됩니다.\n정말 삭제하시겠습니까?`)) return
    const { error } = await supabase.from('profiles').delete().eq('id', id)
    if (error) { toast.error('삭제 실패: ' + error.message); return }
    toast.success(`${name} 학생이 삭제되었습니다.`)
    fetchData()
  }

  async function resetPassword(id: string, name: string) {
    const newPw = prompt(`${name} 학생의 새 비밀번호를 입력하세요:`, 'edu1234')
    if (!newPw || newPw.length < 6) { toast.error('비밀번호는 6자 이상이어야 합니다.'); return }
    const res = await fetch('/api/teacher/reset-password', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: id, password: newPw }),
    })
    if (res.ok) toast.success('비밀번호가 변경되었습니다.')
    else toast.error('비밀번호 변경 실패')
  }

  async function addStudentManual(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      const res = await fetch('/api/teacher/create-student', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: addName, email: addEmail, studentNumber: addNumber, classId: addClassId, password: addPassword }),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error)
      toast.success(`${addName} 학생이 추가되었습니다.`)
      setOpenAdd(false)
      setAddName(''); setAddEmail(''); setAddNumber(''); setAddClassId(''); setAddPassword('edu1234')
      fetchData()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : '추가 실패')
    } finally { setSaving(false) }
  }

  function downloadSample() {
    const ws = XLSX.utils.aoa_to_sheet([
      ['이름', '이메일', '학번', '초기비밀번호'],
      ['홍길동', 'hong@student.edu', '20101', 'edu1234'],
      ['김철수', 'kim@student.edu', '20102', 'edu1234'],
    ])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, '학생목록')
    XLSX.writeFile(wb, '학생_일괄등록_샘플.xlsx')
  }

  async function handleExcelUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!uploadClassId) { toast.error('먼저 반을 선택하세요'); return }
    setUploading(true)
    const buffer = await file.arrayBuffer()
    const wb = XLSX.read(buffer)
    const ws = wb.Sheets[wb.SheetNames[0]]
    const rows = XLSX.utils.sheet_to_json<{ 이름: string; 이메일: string; 학번?: string; 초기비밀번호?: string }>(ws)
    if (rows.length === 0) { toast.error('데이터가 없습니다'); setUploading(false); return }
    let success = 0, updated = 0, fail = 0
    for (const row of rows) {
      if (!row['이름'] || !row['이메일']) { fail++; continue }
      try {
        const res = await fetch('/api/teacher/create-student', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: row['이름'], email: row['이메일'], studentNumber: row['학번'] ?? '', classId: uploadClassId, password: row['초기비밀번호'] ?? 'edu1234' }),
        })
        const result = await res.json()
        if (res.ok) { if (result.updated) updated++; else success++ } else fail++
      } catch { fail++ }
    }
    const msg = [success > 0 && `${success}명 추가`, updated > 0 && `${updated}명 비밀번호 변경`, fail > 0 && `${fail}명 실패`].filter(Boolean).join(', ')
    toast.success(msg)
    if (fileInputRef.current) fileInputRef.current.value = ''
    setUploading(false); setOpenUpload(false); fetchData()
  }

  const filtered = students.filter(s => {
    const matchSearch = s.name.includes(search) || (s.student_number ?? '').includes(search) || (s.email ?? '').includes(search)
    const matchClass = filterClass === 'all' || (filterClass === 'unassigned' ? !s.class_id : s.class_id === filterClass)
    return matchSearch && matchClass
  })

  return (
    <div className="flex flex-col h-screen">
      {/* 헤더 */}
      <div className="p-4 border-b bg-white space-y-3 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">학생 관리</h1>
            <p className="text-gray-500 text-sm mt-0.5">총 {students.length}명 · 배지 셀 클릭으로 즉시 수여/회수, 이름·학번·반 클릭으로 인라인 수정</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="gap-1.5" onClick={downloadSample}>
              <Download className="w-3.5 h-3.5" />샘플
            </Button>
            {/* 엑셀 업로드 */}
            <Dialog open={openUpload} onOpenChange={setOpenUpload}>
              <DialogTrigger>
                <Button variant="outline" size="sm" className="gap-1.5" type="button">
                  <Upload className="w-3.5 h-3.5" />엑셀 업로드
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-md">
                <DialogHeader><DialogTitle>엑셀로 학생 일괄 추가</DialogTitle></DialogHeader>
                <div className="space-y-4 pt-2">
                  <div className="space-y-2">
                    <Label>반 선택 *</Label>
                    <Select value={uploadClassId} onValueChange={v => setUploadClassId(v ?? '')}>
                      <SelectTrigger><SelectValue placeholder="반 선택" /></SelectTrigger>
                      <SelectContent>{classes.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="border rounded-lg p-4 bg-blue-50 border-blue-200">
                    <input type="file" accept=".xlsx,.xls" ref={fileInputRef} onChange={handleExcelUpload}
                      className="text-sm text-blue-700 file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:bg-blue-600 file:text-white file:text-sm cursor-pointer" />
                    <p className="text-xs text-blue-600 mt-2">컬럼: 이름, 이메일, 학번(선택), 초기비밀번호(선택)</p>
                  </div>
                  {uploading && <p className="text-sm text-center text-blue-600">업로드 중...</p>}
                  <Button type="button" variant="outline" className="w-full" onClick={() => setOpenUpload(false)}>닫기</Button>
                </div>
              </DialogContent>
            </Dialog>
            {/* 학생 추가 */}
            <Dialog open={openAdd} onOpenChange={setOpenAdd}>
              <DialogTrigger>
                <Button size="sm" className="gap-1.5" type="button"><Plus className="w-3.5 h-3.5" />학생 추가</Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg">
                <DialogHeader><DialogTitle>학생 직접 추가</DialogTitle></DialogHeader>
                <form onSubmit={addStudentManual} className="space-y-3 pt-2">
                  <div className="space-y-2">
                    <Label>반 선택 *</Label>
                    <Select value={addClassId} onValueChange={v => setAddClassId(v ?? '')}>
                      <SelectTrigger><SelectValue placeholder="반 선택" /></SelectTrigger>
                      <SelectContent>{classes.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1"><Label>이름 *</Label><Input placeholder="홍길동" value={addName} onChange={e => setAddName(e.target.value)} required /></div>
                    <div className="space-y-1"><Label>학번</Label><Input placeholder="20101" value={addNumber} onChange={e => setAddNumber(e.target.value)} /></div>
                  </div>
                  <div className="space-y-1"><Label>이메일 *</Label><Input type="email" placeholder="student@email.com" value={addEmail} onChange={e => setAddEmail(e.target.value)} required /></div>
                  <div className="space-y-1"><Label>초기 비밀번호</Label><Input value={addPassword} onChange={e => setAddPassword(e.target.value)} minLength={6} /></div>
                  <div className="flex gap-2 pt-2">
                    <Button type="button" variant="outline" className="flex-1" onClick={() => setOpenAdd(false)}>취소</Button>
                    <Button type="submit" className="flex-1" disabled={saving || !addClassId}>{saving ? '추가 중...' : '추가'}</Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>
          </div>
        </div>
        {/* 검색 + 필터 */}
        <div className="flex gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input placeholder="이름, 학번, 이메일 검색" className="pl-9 h-9" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <Select value={filterClass} onValueChange={v => setFilterClass(v || 'all')}>
            <SelectTrigger className="w-40 h-9">
              <SelectValue>{classes.find(c => c.id === filterClass)?.name ?? (filterClass === 'unassigned' ? '미배정' : '전체 반')}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">전체 반</SelectItem>
              <SelectItem value="unassigned">미배정</SelectItem>
              {classes.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* 표 */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="text-center py-12 text-gray-400">불러오는 중...</div>
        ) : filtered.length === 0 ? (
          <Card className="border-dashed m-6">
            <CardContent className="py-12 text-center">
              <Users className="w-12 h-12 mx-auto mb-3 text-gray-300" />
              <p className="text-gray-500">학생이 없습니다</p>
            </CardContent>
          </Card>
        ) : (
          <table className="w-full text-sm border-collapse" style={{ minWidth: 'max-content' }}>
            <thead className="sticky top-0 z-10 bg-gray-100">
              <tr>
                <th className="border-b border-r px-3 py-2.5 text-center font-medium text-gray-600 w-10 sticky left-0 bg-gray-100 z-20">번호</th>
                <th className="border-b border-r px-3 py-2.5 text-left font-medium text-gray-600 w-20 sticky left-10 bg-gray-100 z-20">반</th>
                <th className="border-b border-r px-3 py-2.5 text-left font-medium text-gray-600 w-24">이름</th>
                <th className="border-b border-r px-3 py-2.5 text-left font-medium text-gray-600 w-20">학번</th>
                <th className="border-b border-r px-3 py-2.5 text-left font-medium text-gray-600 w-44">이메일</th>
                {badges.map(b => (
                  <th key={b.id} className="border-b border-r px-2 py-2 text-center font-medium text-gray-600 w-20">
                    <div className="flex flex-col items-center gap-0.5">
                      <span className="text-base">{b.icon}</span>
                      <span className="text-[10px] leading-tight text-gray-500">{b.name}</span>
                    </div>
                  </th>
                ))}
                <th className="border-b px-3 py-2.5 text-center font-medium text-gray-600 w-20">관리</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s, idx) => (
                <tr key={s.id} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                  {/* 번호 */}
                  <td className={`border-b border-r px-3 py-1.5 text-center text-gray-400 text-xs sticky left-0 z-10 ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}>
                    {s.student_number ?? idx + 1}
                  </td>

                  {/* 반 (인라인 편집) */}
                  <td className={`border-b border-r px-2 py-1 sticky left-10 z-10 ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}>
                    {editingCell?.studentId === s.id && editingCell.field === 'class_id' ? (
                      <Select
                        value={editValues[`${s.id}_class_id`] ?? s.class_id ?? 'none'}
                        onValueChange={v => {
                          const val = v === 'none' ? '' : (v ?? '')
                          setEditValues(prev => ({ ...prev, [`${s.id}_class_id`]: val }))
                          saveInlineEdit(s, 'class_id', val)
                        }}
                      >
                        <SelectTrigger className="h-7 text-xs w-28">
                          <SelectValue>
                            {classes.find(c => c.id === (editValues[`${s.id}_class_id`] ?? s.class_id))?.name ?? '미배정'}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">미배정</SelectItem>
                          {classes.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    ) : (
                      <button
                        onClick={() => { setEditingCell({ studentId: s.id, field: 'class_id' }); setEditValues(prev => ({ ...prev, [`${s.id}_class_id`]: s.class_id ?? '' })) }}
                        className="text-xs text-gray-600 hover:bg-blue-50 hover:text-blue-700 px-1.5 py-0.5 rounded w-full text-left"
                      >
                        {s.class?.name ?? <span className="text-gray-300">미배정</span>}
                      </button>
                    )}
                  </td>

                  {/* 이름 (인라인 편집 + 상세 링크) */}
                  <td className="border-b border-r px-2 py-1">
                    {editingCell?.studentId === s.id && editingCell.field === 'name' ? (
                      <input
                        autoFocus
                        className="w-full text-sm border rounded px-2 py-0.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
                        defaultValue={s.name}
                        onBlur={e => saveInlineEdit(s, 'name', e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEditingCell(null) }}
                      />
                    ) : (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => setEditingCell({ studentId: s.id, field: 'name' })}
                          className="text-sm font-medium text-gray-900 hover:bg-blue-50 hover:text-blue-700 px-1.5 py-0.5 rounded text-left"
                        >
                          {s.name}
                        </button>
                        <Link href={`/teacher/students/${s.id}`} title="상세 보기">
                          <ExternalLink className="w-3 h-3 text-gray-300 hover:text-blue-500" />
                        </Link>
                      </div>
                    )}
                  </td>

                  {/* 학번 (인라인 편집) */}
                  <td className="border-b border-r px-2 py-1">
                    {editingCell?.studentId === s.id && editingCell.field === 'student_number' ? (
                      <input
                        autoFocus
                        className="w-full text-xs border rounded px-2 py-0.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
                        defaultValue={s.student_number ?? ''}
                        onBlur={e => saveInlineEdit(s, 'student_number', e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEditingCell(null) }}
                      />
                    ) : (
                      <button
                        onClick={() => setEditingCell({ studentId: s.id, field: 'student_number' })}
                        className="text-xs text-gray-500 hover:bg-blue-50 hover:text-blue-700 px-1.5 py-0.5 rounded w-full text-left"
                      >
                        {s.student_number ?? <span className="text-gray-300">-</span>}
                      </button>
                    )}
                  </td>

                  {/* 이메일 (인라인 편집) */}
                  <td className="border-b border-r px-2 py-1">
                    {editingCell?.studentId === s.id && editingCell.field === 'email' ? (
                      <input
                        autoFocus
                        type="email"
                        className="w-full text-xs border rounded px-2 py-0.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
                        defaultValue={s.email ?? ''}
                        onBlur={e => saveInlineEdit(s, 'email', e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEditingCell(null) }}
                      />
                    ) : (
                      <button
                        onClick={() => setEditingCell({ studentId: s.id, field: 'email' })}
                        className="text-xs text-gray-400 hover:bg-blue-50 hover:text-blue-700 px-1.5 py-0.5 rounded w-full text-left truncate max-w-[160px]"
                      >
                        {s.email ?? <span className="text-gray-300">-</span>}
                      </button>
                    )}
                  </td>

                  {/* 배지 열 */}
                  {badges.map(b => {
                    const records = s.badgeMap[b.id] ?? []
                    const count = records.length
                    const awarded = count > 0
                    return (
                      <td key={b.id} className="border-b border-r px-2 py-1.5 text-center">
                        <div className="flex items-center justify-center gap-0.5">
                          {/* 클릭: 미수여 → 수여 / 수여됨 → 1개 회수 */}
                          <button
                            onClick={() => toggleBadge(s, b.id)}
                            title={awarded ? `${b.name} 회수 (클릭)` : `${b.name} 수여`}
                            className={`w-8 h-7 rounded flex items-center justify-center transition-colors text-sm
                              ${awarded
                                ? 'bg-yellow-100 hover:bg-red-100 text-yellow-600 hover:text-red-500'
                                : 'bg-gray-100 hover:bg-yellow-100 text-gray-300 hover:text-yellow-500'
                              }`}
                          >
                            {awarded ? b.icon : '○'}
                          </button>
                          {/* 중복 수여: +버튼 / 개수 표시 */}
                          {awarded && (
                            <div className="flex flex-col items-center">
                              <button
                                onClick={() => addBadge(s, b.id)}
                                title="한 번 더 수여"
                                className="text-[10px] text-yellow-400 hover:text-yellow-600 leading-none"
                              >+</button>
                              {count > 1 && <span className="text-[10px] font-bold text-yellow-600 leading-none">×{count}</span>}
                            </div>
                          )}
                        </div>
                      </td>
                    )
                  })}

                  {/* 관리 */}
                  <td className="border-b px-2 py-1.5">
                    <div className="flex items-center justify-center gap-0.5">
                      <button
                        onClick={() => resetPassword(s.id, s.name)}
                        title="비밀번호 초기화"
                        className="p-1 rounded text-blue-400 hover:text-blue-600 hover:bg-blue-50"
                      >
                        <Key className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => deleteStudent(s.id, s.name)}
                        title="학생 삭제"
                        className="p-1 rounded text-red-300 hover:text-red-600 hover:bg-red-50"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
