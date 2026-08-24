'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import * as XLSX from 'xlsx'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from 'sonner'
import { Upload, Download, UserPlus, Search, AlertTriangle, Save, KeyRound, Copy, Ban } from 'lucide-react'
import { formatDate, generateInviteCode } from '@/lib/utils'
import type { Profile, Class, Role, InviteCode } from '@/lib/types'

/** 엑셀 한 행. 컬럼 이름은 한글로 받는다 (학생 등록 화면과 같은 방식) */
interface Row {
  이름?: string
  이메일?: string
  아이디?: string
  비밀번호?: string
  초기비밀번호?: string
  역할?: string
  반?: string
  학번?: string
}

interface Result {
  email: string
  name: string
  status: 'added' | 'updated' | 'repaired' | 'failed'
  message?: string
}

const ROLE_LABEL: Record<string, string> = { admin: '관리자', teacher: '교사', student: '학생' }

export default function AdminUsersPage() {
  const supabase = createClient()
  const [users, setUsers] = useState<Profile[]>([])
  const [classes, setClasses] = useState<Class[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterRole, setFilterRole] = useState<'all' | Role>('all')
  const [uploading, setUploading] = useState(false)
  const [results, setResults] = useState<Result[]>([])
  const fileRef = useRef<HTMLInputElement>(null)

  // 수동 입력
  const [openOne, setOpenOne] = useState(false)
  const [oneRole, setOneRole] = useState<'teacher' | 'student'>('teacher')
  const [oneName, setOneName] = useState('')
  const [oneEmail, setOneEmail] = useState('')
  const [onePw, setOnePw] = useState('')
  const [oneClass, setOneClass] = useState('')
  const [oneNumber, setOneNumber] = useState('')
  const [savingOne, setSavingOne] = useState(false)

  // 교사 초대코드 (10분만 유효 — DB 트리거가 강제한다)
  const [teacherCodes, setTeacherCodes] = useState<InviteCode[]>([])
  const [issuing, setIssuing] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  const fetchAll = useCallback(async () => {
    const [{ data: profs }, { data: cls }, { data: codes }] = await Promise.all([
      supabase.from('profiles').select('*').order('role').order('name'),
      supabase.from('classes').select('*').order('year', { ascending: false }).order('name'),
      supabase.from('invite_codes').select('*').eq('role', 'teacher').eq('is_active', true)
        .order('created_at', { ascending: false }),
    ])
    setUsers(profs ?? [])
    setClasses(cls ?? [])
    setTeacherCodes(codes ?? [])
    setLoading(false)
  }, [supabase])

  useEffect(() => { fetchAll() }, [fetchAll])

  // 남은 시간을 초 단위로 보여주려면 화면을 주기적으로 다시 그려야 한다
  useEffect(() => {
    if (teacherCodes.length === 0) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [teacherCodes.length])

  async function issueTeacherCode() {
    setIssuing(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('인증 필요')
      // expires_at 은 보내지 않는다. DB 트리거가 10분으로 정한다.
      const { error } = await supabase.from('invite_codes').insert({
        code: generateInviteCode(), role: 'teacher', teacher_id: user.id, max_uses: 5,
      })
      if (error) throw error
      toast.success('교사 초대코드를 발급했습니다.', { description: '10분 안에 사용해야 합니다' })
      fetchAll()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : '발급 실패')
    } finally {
      setIssuing(false)
    }
  }

  async function deactivateCode(id: string) {
    const { error } = await supabase.from('invite_codes').update({ is_active: false }).eq('id', id)
    if (error) toast.error('처리 실패')
    else { toast.success('코드를 비활성화했습니다.'); fetchAll() }
  }

  function remainingText(expiresAt: string | null) {
    if (!expiresAt) return '만료 정보 없음'
    const left = Math.floor((new Date(expiresAt).getTime() - now) / 1000)
    if (left <= 0) return '만료됨'
    return `${Math.floor(left / 60)}분 ${String(left % 60).padStart(2, '0')}초 남음`
  }

  const className = (id: string | null) => classes.find(c => c.id === id)?.name ?? ''

  async function createUser(body: Record<string, unknown>) {
    const res = await fetch('/api/admin/create-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return { ok: res.ok, data: await res.json() }
  }

  function downloadTemplate() {
    const ws = XLSX.utils.json_to_sheet([
      { 이름: '김민지', 이메일: 'teacher1@school.kr', 비밀번호: 'change-me-1', 역할: '교사', 반: '', 학번: '' },
      { 이름: '강도윤', 이메일: 's01@school.kr', 비밀번호: 'change-me-2', 역할: '학생', 반: '3학년 1반', 학번: '1' },
    ])
    ws['!cols'] = [{ wch: 12 }, { wch: 26 }, { wch: 14 }, { wch: 8 }, { wch: 14 }, { wch: 8 }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, '사용자명단')
    XLSX.writeFile(wb, '사용자등록_양식.xlsx')
  }

  /** 현재 사용자 명단을 파일로 내려받는다. 비밀번호는 해시로만 저장되어 내보낼 수 없다. */
  function downloadBackup() {
    if (users.length === 0) { toast.error('내려받을 사용자가 없습니다'); return }
    const rows = users.map(u => ({
      이름: u.name,
      이메일: u.email ?? '',
      역할: ROLE_LABEL[u.role] ?? u.role,
      반: className(u.class_id),
      학번: u.student_number ?? '',
      등록일: u.created_at ? formatDate(u.created_at) : '',
      비밀번호: '',   // 다시 등록할 때 채워 넣도록 빈 칸으로 둔다
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    ws['!cols'] = [{ wch: 12 }, { wch: 26 }, { wch: 8 }, { wch: 14 }, { wch: 8 }, { wch: 12 }, { wch: 14 }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, '사용자명단')
    const stamp = new Date().toISOString().slice(0, 10)
    XLSX.writeFile(wb, `에듀폼_사용자백업_${stamp}.xlsx`)
    toast.success(`${users.length}명을 내려받았습니다.`, { description: '비밀번호는 포함되지 않습니다' })
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setResults([])
    try {
      const wb = XLSX.read(await file.arrayBuffer())
      const rows = XLSX.utils.sheet_to_json<Row>(wb.Sheets[wb.SheetNames[0]])
      if (rows.length === 0) { toast.error('데이터가 없습니다'); return }

      const out: Result[] = []
      for (const row of rows) {
        const name = (row['이름'] ?? '').toString().trim()
        const email = (row['이메일'] ?? row['아이디'] ?? '').toString().trim()
        const password = (row['비밀번호'] ?? row['초기비밀번호'] ?? '').toString().trim()
        const roleText = (row['역할'] ?? '교사').toString().trim()
        const role = roleText.includes('학생') || roleText.toLowerCase() === 'student' ? 'student' : 'teacher'
        const classText = (row['반'] ?? '').toString().trim()
        const studentNumber = (row['학번'] ?? '').toString().trim()

        if (!name || !email) {
          out.push({ email: email || '(빈칸)', name: name || '(빈칸)', status: 'failed', message: '이름과 이메일이 필요합니다' })
          continue
        }
        if (password.length < 6) {
          out.push({ email, name, status: 'failed', message: '비밀번호가 6자 미만입니다' })
          continue
        }
        let classId: string | null = null
        if (role === 'student') {
          const found = classes.find(c => c.name === classText)
          if (!found) {
            out.push({ email, name, status: 'failed', message: classText ? `'${classText}' 반을 찾을 수 없습니다` : '학생은 반이 필요합니다' })
            continue
          }
          classId = found.id
        }
        try {
          const { ok, data } = await createUser({ name, email, password, role, classId, studentNumber })
          if (!ok) out.push({ email, name, status: 'failed', message: data.error })
          else if (data.updated) out.push({ email, name, status: 'updated' })
          else if (data.repaired) out.push({ email, name, status: 'repaired' })
          else out.push({ email, name, status: 'added' })
        } catch {
          out.push({ email, name, status: 'failed', message: '요청 실패' })
        }
      }
      setResults(out)
      const added = out.filter(r => r.status === 'added').length
      const changed = out.filter(r => r.status === 'updated' || r.status === 'repaired').length
      const failed = out.filter(r => r.status === 'failed').length
      const msg = [added && `${added}명 등록`, changed && `${changed}명 갱신`, failed && `${failed}명 실패`]
        .filter(Boolean).join(', ')
      if (failed > 0) toast.error(msg)
      else toast.success(msg)
      fetchAll()
    } finally {
      if (fileRef.current) fileRef.current.value = ''
      setUploading(false)
    }
  }

  async function submitOne(e: React.FormEvent) {
    e.preventDefault()
    if (oneRole === 'student' && !oneClass) { toast.error('반을 선택하세요'); return }
    setSavingOne(true)
    try {
      const { ok, data } = await createUser({
        name: oneName.trim(), email: oneEmail.trim(), password: onePw, role: oneRole,
        classId: oneRole === 'student' ? oneClass : null,
        studentNumber: oneRole === 'student' ? oneNumber.trim() : null,
      })
      if (!ok) throw new Error(data.error)
      toast.success(data.updated ? '비밀번호가 변경되었습니다.' : `${ROLE_LABEL[oneRole]}가 등록되었습니다.`)
      setOpenOne(false)
      setOneName(''); setOneEmail(''); setOnePw(''); setOneNumber('')
      fetchAll()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : '등록 실패')
    } finally {
      setSavingOne(false)
    }
  }

  const filtered = users.filter(u => {
    const matchSearch = u.name.includes(search) || (u.email ?? '').includes(search)
    const matchRole = filterRole === 'all' || u.role === filterRole
    return matchSearch && matchRole
  })
  const counts = {
    admin: users.filter(u => u.role === 'admin').length,
    teacher: users.filter(u => u.role === 'teacher').length,
    student: users.filter(u => u.role === 'student').length,
  }

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">사용자 관리</h1>
        <p className="text-gray-500 text-sm mt-1">
          관리자 {counts.admin}명 · 교사 {counts.teacher}명 · 학생 {counts.student}명
        </p>
      </div>

      <Card className="border-amber-200 bg-amber-50">
        <CardContent className="pt-4">
          <div className="flex gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-amber-800 space-y-1">
              <p className="font-medium">비밀번호가 담긴 엑셀 파일을 조심하세요</p>
              <p>
                그 파일 하나로 모든 계정에 로그인할 수 있고, 교사 계정은 학생 개인정보를 봅니다.
                <b className="ml-1">등록이 끝나면 파일을 지우세요.</b> 메일·공유드라이브·USB 에 남기지 마세요.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">등록 · 백업</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="text-sm text-gray-600">
            엑셀 컬럼: <code className="px-1 bg-gray-100 rounded">이름</code>{' '}
            <code className="px-1 bg-gray-100 rounded">이메일</code>{' '}
            <code className="px-1 bg-gray-100 rounded">비밀번호</code>{' '}
            <code className="px-1 bg-gray-100 rounded">역할</code>{' '}
            <code className="px-1 bg-gray-100 rounded">반</code>{' '}
            <code className="px-1 bg-gray-100 rounded">학번</code>
            <span className="text-gray-400"> — 역할은 <code>교사</code> 또는 <code>학생</code>. 학생은 반 이름이 정확히 일치해야 합니다.</span>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" className="gap-2" onClick={downloadTemplate}>
              <Download className="w-4 h-4" />양식 내려받기
            </Button>
            <Button className="gap-2" disabled={uploading} onClick={() => fileRef.current?.click()}>
              <Upload className="w-4 h-4" />{uploading ? '등록 중...' : '엑셀 올리기'}
            </Button>
            <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleUpload} />

            <Dialog open={openOne} onOpenChange={setOpenOne}>
              <DialogTrigger>
                <Button variant="outline" type="button" className="gap-2">
                  <UserPlus className="w-4 h-4" />직접 입력
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>사용자 직접 등록</DialogTitle></DialogHeader>
                <form onSubmit={submitOne} className="space-y-4">
                  <div className="space-y-1.5">
                    <Label>역할 *</Label>
                    <div className="flex gap-2">
                      {(['teacher', 'student'] as const).map(r => (
                        <button key={r} type="button" onClick={() => setOneRole(r)}
                          className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${
                            oneRole === r ? 'bg-slate-800 text-white border-slate-800'
                                          : 'bg-white text-gray-600 border-gray-300 hover:border-slate-400'
                          }`}>
                          {ROLE_LABEL[r]}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label>이름 *</Label>
                    <Input value={oneName} onChange={e => setOneName(e.target.value)} required />
                  </div>
                  <div className="space-y-1.5">
                    <Label>이메일 (로그인 아이디) *</Label>
                    <Input type="email" value={oneEmail} onChange={e => setOneEmail(e.target.value)} required />
                  </div>
                  <div className="space-y-1.5">
                    <Label>초기 비밀번호 * (6자 이상)</Label>
                    <Input value={onePw} onChange={e => setOnePw(e.target.value)} minLength={6} required />
                  </div>
                  {oneRole === 'student' && (
                    <>
                      <div className="space-y-1.5">
                        <Label>반 *</Label>
                        <Select value={oneClass} onValueChange={v => setOneClass(v || '')}>
                          <SelectTrigger>
                            <SelectValue>{classes.find(c => c.id === oneClass)?.name ?? '반 선택'}</SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            {classes.map(c => (
                              <SelectItem key={c.id} value={c.id}>{c.name} ({c.year})</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {classes.length === 0 && (
                          <p className="text-xs text-amber-600">등록된 반이 없습니다. 교사가 반을 먼저 만들어야 합니다.</p>
                        )}
                      </div>
                      <div className="space-y-1.5">
                        <Label>학번 (선택)</Label>
                        <Input value={oneNumber} onChange={e => setOneNumber(e.target.value)} placeholder="예: 20101" />
                      </div>
                    </>
                  )}
                  <Button type="submit" className="w-full" disabled={savingOne}>
                    {savingOne ? '등록 중...' : '등록'}
                  </Button>
                </form>
              </DialogContent>
            </Dialog>

            <Button variant="outline" className="gap-2 ml-auto" onClick={downloadBackup}>
              <Save className="w-4 h-4" />사용자 백업 내려받기
            </Button>
          </div>

          <p className="text-xs text-gray-400">
            백업 파일에는 이름·이메일·역할·반·학번이 들어갑니다.
            <b className="text-gray-500"> 비밀번호는 해시로만 저장되어 내보낼 수 없습니다</b> — 되살릴 때는 비밀번호를 새로 정해야 합니다.
            데이터 전체 백업은 Supabase 의 <code className="px-1 bg-gray-100 rounded">pg_dump</code> 를 쓰세요.
          </p>

          {results.length > 0 && (
            <div className="border rounded-lg divide-y max-h-64 overflow-y-auto">
              {results.map((r, i) => (
                <div key={i} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                    r.status === 'failed' ? 'bg-red-100 text-red-700'
                    : r.status === 'added' ? 'bg-green-100 text-green-700'
                    : 'bg-blue-100 text-blue-700'
                  }`}>
                    {r.status === 'added' ? '등록' : r.status === 'updated' ? '비밀번호 변경'
                      : r.status === 'repaired' ? '프로필 복구' : '실패'}
                  </span>
                  <span className="font-medium text-gray-800">{r.name}</span>
                  <span className="text-gray-500">{r.email}</span>
                  {r.message && <span className="text-red-500 ml-auto text-right">{r.message}</span>}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <KeyRound className="w-4 h-4" />교사 초대코드
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-gray-600">
            교사가 스스로 가입할 때 쓰는 코드입니다.
            <b className="text-gray-800"> 발급 후 10분만 작동합니다.</b>
            <span className="text-gray-400"> 코드가 유출되면 외부인이 교사가 되어 학생 명단에 접근하므로 창을 좁혀 둡니다.</span>
          </p>
          <Button className="gap-2" onClick={issueTeacherCode} disabled={issuing}>
            <KeyRound className="w-4 h-4" />{issuing ? '발급 중...' : '코드 발급'}
          </Button>

          {teacherCodes.length > 0 && (
            <div className="border rounded-lg divide-y">
              {teacherCodes.map(c => {
                const expired = c.expires_at ? new Date(c.expires_at).getTime() <= now : false
                return (
                  <div key={c.id} className="flex items-center gap-3 px-3 py-2">
                    <code className={`text-lg font-mono tracking-widest ${expired ? 'text-gray-300 line-through' : 'text-gray-900'}`}>
                      {c.code}
                    </code>
                    <span className={`text-xs ${expired ? 'text-gray-400' : 'text-amber-600 font-medium'}`}>
                      {remainingText(c.expires_at)}
                    </span>
                    <span className="text-xs text-gray-400">사용 {c.used_count}/{c.max_uses}</span>
                    <div className="ml-auto flex gap-1">
                      {!expired && (
                        <Button variant="ghost" size="icon" title="복사"
                          onClick={() => { navigator.clipboard.writeText(c.code); toast.success(`복사됨: ${c.code}`) }}>
                          <Copy className="w-4 h-4" />
                        </Button>
                      )}
                      <Button variant="ghost" size="icon" title="비활성화"
                        className="text-red-400 hover:text-red-600" onClick={() => deactivateCode(c.id)}>
                        <Ban className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <CardTitle className="text-base">사용자 {filtered.length}명</CardTitle>
            <div className="flex gap-2">
              <div className="flex gap-1">
                {(['all', 'admin', 'teacher', 'student'] as const).map(r => (
                  <button key={r} type="button" onClick={() => setFilterRole(r)}
                    className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                      filterRole === r ? 'bg-slate-800 text-white border-slate-800'
                                       : 'bg-white text-gray-600 border-gray-300 hover:border-slate-400'
                    }`}>
                    {r === 'all' ? '전체' : ROLE_LABEL[r]}
                  </button>
                ))}
              </div>
              <div className="relative w-48">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                <Input placeholder="이름·이메일" className="pl-7 h-8 text-sm"
                  value={search} onChange={e => setSearch(e.target.value)} />
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-gray-400 py-6 text-center">불러오는 중...</p>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-gray-400 py-6 text-center">해당하는 사용자가 없습니다</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>이름</TableHead>
                  <TableHead>이메일</TableHead>
                  <TableHead>역할</TableHead>
                  <TableHead>반</TableHead>
                  <TableHead>학번</TableHead>
                  <TableHead>등록일</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(u => (
                  <TableRow key={u.id}>
                    <TableCell className="font-medium">{u.name}</TableCell>
                    <TableCell className="text-gray-600">{u.email}</TableCell>
                    <TableCell>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        u.role === 'admin' ? 'bg-slate-800 text-white'
                        : u.role === 'teacher' ? 'bg-blue-100 text-blue-700'
                        : 'bg-gray-100 text-gray-700'
                      }`}>
                        {ROLE_LABEL[u.role]}
                      </span>
                    </TableCell>
                    <TableCell className="text-gray-600">{className(u.class_id)}</TableCell>
                    <TableCell className="text-gray-600">{u.student_number}</TableCell>
                    <TableCell className="text-gray-400 text-sm">{u.created_at ? formatDate(u.created_at) : ''}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
