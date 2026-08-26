'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import * as XLSX from 'xlsx'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { toast } from 'sonner'
import { Plus, School, Trash2, Users, Upload, Download, X } from 'lucide-react'
import type { Class } from '@/lib/types'

interface ClassRow extends Class {
  studentCount: number
  teachers: { id: string; name: string; role: string }[]
}

export default function AdminClassesPage() {
  const supabase = createClient()
  const [classes, setClasses] = useState<ClassRow[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const [teachers, setTeachers] = useState<{ id: string; name: string }[]>([])
  const [assigning, setAssigning] = useState('')
  const [openCreate, setOpenCreate] = useState(false)
  const [name, setName] = useState('')
  const [year, setYear] = useState(String(new Date().getFullYear()))
  const [desc, setDesc] = useState('')
  const [saving, setSaving] = useState(false)

  const fetchAll = useCallback(async () => {
    const [{ data: cls }, { data: assigns }, { data: studs }, { data: tchs }] = await Promise.all([
      supabase.from('classes').select('*').order('year', { ascending: false }).order('name'),
      supabase.from('class_teachers').select('class_id, teacher_id, role'),
      supabase.from('profiles').select('id, class_id').eq('role', 'student'),
      supabase.from('profiles').select('id, name').eq('role', 'teacher').order('name'),
    ])
    setTeachers(tchs ?? [])
    const teacherIds = [...new Set((assigns ?? []).map(a => a.teacher_id))]
    const { data: profs } = teacherIds.length
      ? await supabase.from('profiles').select('id, name').in('id', teacherIds)
      : { data: [] as { id: string; name: string }[] }

    setClasses((cls ?? []).map(c => ({
      ...c,
      studentCount: (studs ?? []).filter(s => s.class_id === c.id).length,
      teachers: (assigns ?? []).filter(a => a.class_id === c.id).map(a => ({
        id: a.teacher_id,
        name: profs?.find(p => p.id === a.teacher_id)?.name ?? '(이름 없음)',
        role: a.role,
      })),
    })))
    setLoading(false)
  }, [supabase])

  useEffect(() => { fetchAll() }, [fetchAll])

  async function createClass(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('인증 필요')
      // teacher_id 는 만든 사람 기록용이다. 담당은 class_teachers 로 정한다.
      const { error } = await supabase.from('classes').insert({
        name: name.trim(), year: Number(year), description: desc.trim() || null, teacher_id: user.id,
      })
      if (error) throw error
      toast.success('반이 추가되었습니다.', { description: '교사가 반 관리에서 담당을 선택합니다' })
      setOpenCreate(false); setName(''); setDesc('')
      fetchAll()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : '추가 실패')
    } finally {
      setSaving(false)
    }
  }

  async function removeClass(id: string, label: string, students: number) {
    if (students > 0) {
      toast.error(`'${label}' 에 학생 ${students}명이 있습니다`, { description: '학생을 다른 반으로 옮긴 뒤 삭제하세요' })
      return
    }
    if (!confirm(`'${label}' 반을 삭제하시겠습니까?`)) return
    const { error } = await supabase.from('classes').delete().eq('id', id)
    if (error) toast.error(error.message)
    else { toast.success('삭제되었습니다.'); fetchAll() }
  }

  /**
   * 담임·교과 담당을 «지정» 한다.
   *
   * 교사 화면에서는 담임을 스스로 고를 수 없다 (그 반을 만든 교사만 예외).
   * 담임은 학생의 이름·반배정·삭제 권한까지 갖는 자리라서다. 그래서 관리자가
   * 정해 주는 수단이 여기 있어야 한다.
   */
  async function assignTeacher(classId: string, teacherId: string, role: 'homeroom' | 'subject') {
    if (!teacherId) return
    setAssigning(classId)
    try {
      const { error } = await supabase.from('class_teachers')
        .upsert({ class_id: classId, teacher_id: teacherId, role }, { onConflict: 'class_id,teacher_id' })
      if (error) throw error
      toast.success(role === 'homeroom' ? '담임으로 지정했습니다.' : '교과 담당으로 지정했습니다.')
      fetchAll()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : '지정 실패')
    } finally {
      setAssigning('')
    }
  }

  /** 관리자가 배정을 정리한다 (교사가 잘못 담당한 경우) */
  async function removeAssignment(classId: string, teacherId: string, teacherName: string) {
    if (!confirm(`${teacherName} 선생님의 담당을 해제하시겠습니까?\n그 반 학생이 더 이상 보이지 않습니다. 기록은 지워지지 않습니다.`)) return
    const { error } = await supabase.from('class_teachers').delete()
      .eq('class_id', classId).eq('teacher_id', teacherId)
    if (error) toast.error(error.message)
    else { toast.success('배정을 해제했습니다.'); fetchAll() }
  }

  function downloadTemplate() {
    const y = new Date().getFullYear()
    const ws = XLSX.utils.json_to_sheet([
      { 반이름: '1학년 1반', 학년도: y, 설명: '' },
      { 반이름: '1학년 2반', 학년도: y, 설명: '' },
    ])
    ws['!cols'] = [{ wch: 14 }, { wch: 8 }, { wch: 20 }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, '반목록')
    XLSX.writeFile(wb, '반등록_양식.xlsx')
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('인증 필요')
      const wb = XLSX.read(await file.arrayBuffer())
      const rows = XLSX.utils.sheet_to_json<{ 반이름?: string; 학년도?: number | string; 설명?: string }>(
        wb.Sheets[wb.SheetNames[0]]
      )
      let added = 0, skipped = 0, failed = 0
      for (const r of rows) {
        const nm = (r['반이름'] ?? '').toString().trim()
        if (!nm) { failed++; continue }
        const yr = Number(r['학년도']) || new Date().getFullYear()
        // 같은 학년도에 같은 이름이 있으면 건너뛴다. 이름이 겹치는 반이 생기면
        // 교사가 어느 쪽을 담당해야 할지 알 수 없다.
        if (classes.some(c => c.name === nm && c.year === yr)) { skipped++; continue }
        const { error } = await supabase.from('classes').insert({
          name: nm, year: yr, description: (r['설명'] ?? '').toString().trim() || null, teacher_id: user.id,
        })
        if (error) failed++
        else added++
      }
      const msg = [added && `${added}개 추가`, skipped && `${skipped}개 중복 건너뜀`, failed && `${failed}개 실패`]
        .filter(Boolean).join(', ')
      if (failed > 0) toast.error(msg)
      else toast.success(msg || '변경 없음')
      fetchAll()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : '업로드 실패')
    } finally {
      if (fileRef.current) fileRef.current.value = ''
      setUploading(false)
    }
  }

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">반 관리</h1>
        <p className="text-gray-500 text-sm mt-1">
          반 목록을 만들면 교사가 <b>반 관리</b> 화면에서 담당할 반을 고릅니다
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">반 추가</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="text-sm text-gray-600">
            엑셀 컬럼: <code className="px-1 bg-gray-100 rounded">반이름</code>{' '}
            <code className="px-1 bg-gray-100 rounded">학년도</code>{' '}
            <code className="px-1 bg-gray-100 rounded">설명</code>
            <span className="text-gray-400"> — 같은 학년도에 이름이 겹치면 건너뜁니다</span>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" className="gap-2" onClick={downloadTemplate}>
              <Download className="w-4 h-4" />양식 내려받기
            </Button>
            <Button variant="outline" className="gap-2" disabled={uploading} onClick={() => fileRef.current?.click()}>
              <Upload className="w-4 h-4" />{uploading ? '추가 중...' : '엑셀로 일괄 추가'}
            </Button>
            <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleUpload} />

            <Dialog open={openCreate} onOpenChange={setOpenCreate}>
              <DialogTrigger>
                <Button type="button" className="gap-2"><Plus className="w-4 h-4" />반 하나 추가</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>반 추가</DialogTitle></DialogHeader>
                <form onSubmit={createClass} className="space-y-4">
                  <div className="space-y-1.5">
                    <Label>반 이름 *</Label>
                    <Input value={name} onChange={e => setName(e.target.value)} placeholder="예: 1학년 1반" required />
                  </div>
                  <div className="space-y-1.5">
                    <Label>학년도 *</Label>
                    <Input type="number" value={year} onChange={e => setYear(e.target.value)} required />
                  </div>
                  <div className="space-y-1.5">
                    <Label>설명 (선택)</Label>
                    <Input value={desc} onChange={e => setDesc(e.target.value)} />
                  </div>
                  <Button type="submit" className="w-full" disabled={saving}>
                    {saving ? '추가 중...' : '추가'}
                  </Button>
                </form>
              </DialogContent>
            </Dialog>
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <p className="text-sm text-gray-400 py-6 text-center">불러오는 중...</p>
      ) : classes.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center">
            <School className="w-12 h-12 mx-auto mb-3 text-gray-300" />
            <p className="text-gray-500 font-medium">등록된 반이 없습니다</p>
            <p className="text-gray-400 text-sm mt-1">반을 만들어야 학생을 넣고 교사가 담당을 고를 수 있습니다</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {classes.map(c => (
            <Card key={c.id}>
              <CardContent className="pt-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center flex-shrink-0">
                      <School className="w-5 h-5 text-blue-600" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-gray-900">
                        {c.name} <span className="text-sm font-normal text-gray-400">{c.year}</span>
                      </p>
                      {c.description && <p className="text-sm text-gray-500">{c.description}</p>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="flex items-center gap-1 text-sm text-gray-600">
                      <Users className="w-3.5 h-3.5" />{c.studentCount}명
                    </span>
                    <Button variant="ghost" size="icon" className="text-red-400 hover:text-red-600"
                      onClick={() => removeClass(c.id, `${c.name} (${c.year})`, c.studentCount)}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>

                <div className="mt-3 pt-3 border-t space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-gray-400">담당 교사</span>
                  {c.teachers.length === 0 ? (
                    <span className="text-xs text-amber-600">아직 없음 — 교사가 직접 고릅니다</span>
                  ) : (
                    c.teachers.map(t => (
                      <span key={t.id}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-700">
                        {t.name}
                        <span className="text-gray-400">{t.role === 'homeroom' ? '담임' : '교과'}</span>
                        <button type="button" title="배정 해제"
                          className="text-gray-400 hover:text-red-600"
                          onClick={() => removeAssignment(c.id, t.id, t.name)}>
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))
                  )}
                </div>

                {/* 담임 지정 — 교사는 스스로 담임이 될 수 없으므로 여기서 정한다 */}
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-gray-400">지정</span>
                  <select
                    className="h-7 rounded-md border border-gray-300 bg-white px-2 text-xs text-gray-700"
                    disabled={assigning === c.id}
                    defaultValue=""
                    onChange={e => {
                      const [tid, role] = e.target.value.split('|')
                      e.currentTarget.value = ''
                      if (tid) assignTeacher(c.id, tid, role as 'homeroom' | 'subject')
                    }}>
                    <option value="">교사를 고르세요</option>
                    <optgroup label="담임으로">
                      {teachers.map(t => (
                        <option key={`h-${t.id}`} value={`${t.id}|homeroom`}>{t.name}</option>
                      ))}
                    </optgroup>
                    <optgroup label="교과 담당으로">
                      {teachers.map(t => (
                        <option key={`s-${t.id}`} value={`${t.id}|subject`}>{t.name}</option>
                      ))}
                    </optgroup>
                  </select>
                  {c.teachers.some(t => t.role === 'homeroom') || (
                    <span className="text-xs text-amber-600">담임이 없습니다</span>
                  )}
                </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
