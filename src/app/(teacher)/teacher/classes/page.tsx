'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { Plus, School, Copy, Trash2, Users, RefreshCw } from 'lucide-react'
import { generateInviteCode, formatDate } from '@/lib/utils'
import type { Class, InviteCode } from '@/lib/types'

interface ClassWithStats extends Class {
  studentCount: number
  inviteCodes: InviteCode[]
  mine: boolean                                  // 내가 담당하는 반인가
  myRole: 'homeroom' | 'subject' | null          // 담임 / 교과
  teachers: { id: string; name: string; role: string }[]
}

export default function ClassesPage() {
  const supabase = createClient()
  const [classes, setClasses] = useState<ClassWithStats[]>([])
  const [loading, setLoading] = useState(true)
  const [openCreate, setOpenCreate] = useState(false)
  const [newClassName, setNewClassName] = useState('')
  const [newClassDesc, setNewClassDesc] = useState('')
  const [saving, setSaving] = useState(false)
  const [me, setMe] = useState('')

  const fetchClasses = useCallback(async () => {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setLoading(false); return }
    setMe(user.id)

    // 학교의 모든 반을 보여준다. 예전에는 내가 만든 반(teacher_id)만 보여서
    // 같은 반을 교사마다 따로 만들어 이름이 겹치는 반이 생겼다.
    const [{ data: cls }, { data: assigns }] = await Promise.all([
      supabase.from('classes').select('*').order('year', { ascending: false }).order('name'),
      supabase.from('class_teachers').select('class_id, teacher_id, role'),
    ])
    if (!cls) { setLoading(false); return }

    // 배정된 교사 이름을 한 번에 받아 반별로 나눈다
    const teacherIds = [...new Set((assigns ?? []).map(a => a.teacher_id))]
    const { data: profs } = teacherIds.length
      ? await supabase.from('profiles').select('id, name').in('id', teacherIds)
      : { data: [] as { id: string; name: string }[] }
    const nameOf = (id: string) => profs?.find(p => p.id === id)?.name ?? '(이름 없음)'

    const enriched = await Promise.all(cls.map(async (c) => {
      const rows = (assigns ?? []).filter(a => a.class_id === c.id)
      const mineRow = rows.find(a => a.teacher_id === user.id)
      // 담당하지 않는 반의 학생 수·초대코드는 정책상 보이지 않는다. 굳이 묻지 않는다.
      const [{ count }, { data: codes }] = mineRow
        ? await Promise.all([
            supabase.from('profiles').select('*', { count: 'exact', head: true }).eq('class_id', c.id).eq('role', 'student'),
            supabase.from('invite_codes').select('*').eq('class_id', c.id).eq('role', 'student').order('created_at', { ascending: false }),
          ])
        : [{ count: 0 }, { data: [] as InviteCode[] }]
      return {
        ...c,
        studentCount: count ?? 0,
        inviteCodes: codes ?? [],
        mine: Boolean(mineRow),
        myRole: (mineRow?.role as 'homeroom' | 'subject') ?? null,
        teachers: rows.map(a => ({ id: a.teacher_id, name: nameOf(a.teacher_id), role: a.role })),
      }
    }))
    setClasses(enriched)
    setLoading(false)
  }, [supabase])

  /** 이 반을 담당하겠다고 등록한다 (요구사항: 관리자가 넣은 목록에서 교사가 고른다) */
  async function joinClass(classId: string, role: 'homeroom' | 'subject') {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { error } = await supabase.from('class_teachers').insert({
      class_id: classId, teacher_id: user.id, role,
    })
    if (error) { toast.error(error.message); return }
    toast.success(role === 'homeroom' ? '담임으로 등록되었습니다.' : '교과 담당으로 등록되었습니다.')
    fetchClasses()
  }

  async function leaveClass(classId: string, name: string) {
    if (!confirm(`'${name}' 담당을 해제하시겠습니까?
담당을 해제하면 그 반 학생이 보이지 않습니다. 기록은 지워지지 않습니다.`)) return
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { error } = await supabase.from('class_teachers').delete()
      .eq('class_id', classId).eq('teacher_id', user.id)
    if (error) { toast.error(error.message); return }
    toast.success('담당이 해제되었습니다.')
    fetchClasses()
  }

  useEffect(() => { fetchClasses() }, [fetchClasses])

  async function createClass(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('인증 필요')
      const { error } = await supabase.from('classes').insert({
        name: newClassName,
        description: newClassDesc || null,
        teacher_id: user.id,
        year: new Date().getFullYear(),
      })
      if (error) throw error
      toast.success('반이 생성되었습니다.')
      setOpenCreate(false)
      setNewClassName('')
      setNewClassDesc('')
      fetchClasses()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : '생성 실패')
    } finally {
      setSaving(false)
    }
  }

  async function deleteClass(id: string, name: string) {
    if (!confirm(`"${name}" 반을 삭제하면 관련된 모든 학생·평가·과제 데이터가 삭제됩니다.\n정말 삭제하시겠습니까?`)) return
    const { error } = await supabase.from('classes').delete().eq('id', id)
    if (error) { toast.error('삭제 실패: ' + error.message); return }
    toast.success('반이 삭제되었습니다.')
    fetchClasses()
  }

  async function generateCode(classId: string) {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('인증 필요')
      const code = generateInviteCode()
      const expiresAt = new Date()
      expiresAt.setDate(expiresAt.getDate() + 30)
      const { error } = await supabase.from('invite_codes').insert({
        code, class_id: classId, teacher_id: user.id,
        expires_at: expiresAt.toISOString(), max_uses: 100,
      })
      if (error) throw error
      toast.success(`초대코드가 생성되었습니다: ${code}`)
      fetchClasses()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : '생성 실패')
    }
  }

  async function deactivateCode(codeId: string) {
    await supabase.from('invite_codes').update({ is_active: false }).eq('id', codeId)
    toast.success('초대코드가 비활성화되었습니다.')
    fetchClasses()
  }

  function copyCode(code: string) {
    navigator.clipboard.writeText(code)
    toast.success(`코드 복사됨: ${code}`)
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">반 관리</h1>
          <p className="text-gray-500 text-sm mt-1">반을 생성하고 초대코드를 발급하세요</p>
        </div>
        <Dialog open={openCreate} onOpenChange={setOpenCreate}>
          <DialogTrigger>
            <Button className="gap-2" type="button">
              <Plus className="w-4 h-4" />
              반 추가
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>새 반 생성</DialogTitle>
            </DialogHeader>
            <form onSubmit={createClass} className="space-y-4 pt-2">
              <div className="space-y-2">
                <Label htmlFor="className">반 이름 *</Label>
                <Input id="className" placeholder="예: 2학년 1반" value={newClassName} onChange={e => setNewClassName(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="classDesc">설명 (선택)</Label>
                <Input id="classDesc" placeholder="반에 대한 설명" value={newClassDesc} onChange={e => setNewClassDesc(e.target.value)} />
              </div>
              <div className="flex gap-2 pt-2">
                <Button type="button" variant="outline" className="flex-1" onClick={() => setOpenCreate(false)}>취소</Button>
                <Button type="submit" className="flex-1" disabled={saving}>{saving ? '생성 중...' : '생성'}</Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400">불러오는 중...</div>
      ) : classes.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center">
            <School className="w-12 h-12 mx-auto mb-3 text-gray-300" />
            <p className="text-gray-500 font-medium">등록된 반이 없습니다</p>
            <p className="text-gray-400 text-sm mt-1">위에서 반을 추가해 보세요</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {classes.map(cls => (
            <Card key={cls.id}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
                      <School className="w-5 h-5 text-blue-600" />
                    </div>
                    <div>
                      <CardTitle className="text-lg">{cls.name}</CardTitle>
                      {cls.description && <p className="text-sm text-gray-500 mt-0.5">{cls.description}</p>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {cls.mine ? (
                      <>
                        <Badge className="gap-1 bg-blue-600">
                          {cls.myRole === 'homeroom' ? '담임' : '교과 담당'}
                        </Badge>
                        <Badge variant="secondary" className="gap-1">
                          <Users className="w-3 h-3" />
                          {cls.studentCount}명
                        </Badge>
                        <Button variant="ghost" size="sm" className="text-xs text-gray-500 hover:text-red-600"
                          onClick={() => leaveClass(cls.id, cls.name)}>
                          담당 해제
                        </Button>
                        {cls.teacher_id === me && (
                          <Button variant="ghost" size="icon" className="text-red-400 hover:text-red-600 hover:bg-red-50"
                            title="반 삭제" onClick={() => deleteClass(cls.id, cls.name)}>
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        )}
                      </>
                    ) : (
                      <div className="flex gap-1">
                        <Button size="sm" variant="outline" className="gap-1"
                          onClick={() => joinClass(cls.id, 'homeroom')}>
                          담임으로 담당
                        </Button>
                        <Button size="sm" className="gap-1"
                          onClick={() => joinClass(cls.id, 'subject')}>
                          교과로 담당
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="mb-3 text-xs text-gray-500">
                  담당 교사{' '}
                  {cls.teachers.length === 0 ? (
                    <span className="text-amber-600">없음 — 담당하면 이 반 학생이 보입니다</span>
                  ) : (
                    cls.teachers.map(t => (
                      <span key={t.id} className="mr-2">
                        {t.name}
                        <span className="text-gray-400">{t.role === 'homeroom' ? '(담임)' : '(교과)'}</span>
                      </span>
                    ))
                  )}
                </div>

                {!cls.mine ? (
                  <p className="text-sm text-gray-400">
                    담당하지 않는 반입니다. 학생 명단과 초대코드는 담당한 뒤에 보입니다.
                  </p>
                ) : (
                <>
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm font-semibold text-gray-700">초대코드</h4>
                  <Button variant="outline" size="sm" className="gap-1" onClick={() => generateCode(cls.id)}>
                    <RefreshCw className="w-3 h-3" />
                    새 코드 발급
                  </Button>
                </div>
                {cls.inviteCodes.length === 0 ? (
                  <p className="text-sm text-gray-400">발급된 초대코드가 없습니다</p>
                ) : (
                  <div className="space-y-2">
                    {cls.inviteCodes.map(ic => (
                      <div key={ic.id} className={`flex items-center justify-between p-3 rounded-lg border ${ic.is_active ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-200 opacity-60'}`}>
                        <div className="flex items-center gap-3">
                          <code className="font-mono text-sm font-bold tracking-widest text-gray-800">{ic.code}</code>
                          <div className="text-xs text-gray-500">
                            {ic.used_count}/{ic.max_uses}명 사용
                            {ic.expires_at && ` · ${formatDate(ic.expires_at)} 만료`}
                          </div>
                        </div>
                        <div className="flex gap-1">
                          {ic.is_active && (
                            <>
                              <Button variant="ghost" size="icon" onClick={() => copyCode(ic.code)}>
                                <Copy className="w-3.5 h-3.5" />
                              </Button>
                              <Button variant="ghost" size="sm" className="text-xs text-red-400 hover:text-red-600"
                                onClick={() => deactivateCode(ic.id)}>
                                비활성화
                              </Button>
                            </>
                          )}
                          {!ic.is_active && <Badge variant="secondary" className="text-xs">비활성</Badge>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                </>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

