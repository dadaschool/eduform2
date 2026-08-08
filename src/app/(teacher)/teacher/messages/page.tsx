'use client'

import { useState, useEffect, useCallback, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from 'sonner'
import { Plus, Trash2, Reply, Search, Inbox, Send, X } from 'lucide-react'
import { formatDateTime } from '@/lib/utils'
import type { Profile, Class } from '@/lib/types'

interface Message {
  id: string
  sender_id: string
  receiver_id: string
  subject: string | null
  content: string
  is_read: boolean
  reply_to_id: string | null
  deleted_by_sender: boolean
  deleted_by_receiver: boolean
  created_at: string
  sender?: { name: string }
  receiver?: { name: string }
}

type Tab = 'inbox' | 'sent'

function TeacherMessagesInner() {
  const supabase = createClient()
  const searchParams = useSearchParams()
  const [me, setMe] = useState('')
  const [tab, setTab] = useState<Tab>('inbox')
  const [messages, setMessages] = useState<Message[]>([])
  const [students, setStudents] = useState<Profile[]>([])
  const [classes, setClasses] = useState<Class[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  // 상세 보기
  const [detail, setDetail] = useState<Message | null>(null)
  // 쓰기/답글 다이얼로그
  const [composeOpen, setComposeOpen] = useState(false)
  const [replyTo, setReplyTo] = useState<Message | null>(null)

  // 작성 폼
  const [sendMode, setSendMode] = useState<'individual' | 'class' | 'multiclass'>('individual')
  const [targetStudent, setTargetStudent] = useState('')
  const [targetClass, setTargetClass] = useState('')
  const [targetClasses, setTargetClasses] = useState<string[]>([])
  const [subject, setSubject] = useState('')
  const [content, setContent] = useState('')
  const [sending, setSending] = useState(false)

  const fetchData = useCallback(async (userId: string) => {
    const { data } = await supabase
      .from('messages')
      .select('*, sender:profiles!sender_id(name), receiver:profiles!receiver_id(name)')
      .or(`sender_id.eq.${userId},receiver_id.eq.${userId}`)
      .order('created_at', { ascending: false })

    const filtered = (data ?? []).filter((m: Message) =>
      m.sender_id === userId ? !m.deleted_by_sender : !m.deleted_by_receiver
    )
    setMessages(filtered)
  }, [supabase])

  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      setMe(user.id)

      const [{ data: studs }, { data: cls }] = await Promise.all([
        supabase.from('profiles').select('*').eq('teacher_id', user.id).eq('role', 'student').order('name'),
        supabase.from('classes').select('*').eq('teacher_id', user.id).order('name'),
      ])
      setStudents(studs ?? [])
      setClasses(cls ?? [])
      await fetchData(user.id)
      setLoading(false)

      // ?to=studentId 로 진입 시 해당 학생 선택하여 작성 다이얼로그 열기
      const toId = searchParams.get('to')
      if (toId) {
        setSendMode('individual')
        setTargetStudent(toId)
        setReplyTo(null)
        setSubject(''); setContent('')
        setComposeOpen(true)
      }
    }
    init()
  }, [supabase, fetchData, searchParams])

  const inbox = messages.filter(m => m.receiver_id === me)
  const sent = messages.filter(m => m.sender_id === me)
  const unreadCount = inbox.filter(m => !m.is_read).length
  const current = tab === 'inbox' ? inbox : sent
  const filtered = current.filter(m => {
    const other = tab === 'inbox'
      ? (m.sender as unknown as { name: string })?.name ?? ''
      : (m.receiver as unknown as { name: string })?.name ?? ''
    return other.includes(search) || (m.subject ?? '').includes(search) || m.content.includes(search)
  })

  async function markRead(msg: Message) {
    if (msg.receiver_id === me && !msg.is_read) {
      await supabase.from('messages').update({ is_read: true }).eq('id', msg.id)
      setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, is_read: true } : m))
    }
    setDetail(msg)
  }

  async function deleteMsg(msg: Message) {
    if (!confirm('이 쪽지를 삭제하시겠습니까?')) return
    const field = msg.sender_id === me ? 'deleted_by_sender' : 'deleted_by_receiver'
    await supabase.from('messages').update({ [field]: true }).eq('id', msg.id)
    setMessages(prev => prev.filter(m => m.id !== msg.id))
    if (detail?.id === msg.id) setDetail(null)
    toast.success('삭제되었습니다.')
  }

  function openReply(msg: Message) {
    setReplyTo(msg)
    setSubject(msg.subject ? `Re: ${msg.subject}` : '')
    setContent('')
    setSendMode('individual')
    setTargetStudent(msg.sender_id)
    setComposeOpen(true)
  }

  function openCompose() {
    setReplyTo(null)
    setSubject(''); setContent('')
    setTargetStudent(''); setTargetClass(''); setTargetClasses([])
    setSendMode('individual')
    setComposeOpen(true)
  }

  async function handleSend() {
    if (!content.trim()) { toast.error('내용을 입력하세요'); return }
    setSending(true)
    try {
      // 수신자 목록 결정
      let receiverIds: string[] = []
      if (sendMode === 'individual') {
        if (!targetStudent) { toast.error('학생을 선택하세요'); setSending(false); return }
        receiverIds = [targetStudent]
      } else if (sendMode === 'class') {
        if (!targetClass) { toast.error('반을 선택하세요'); setSending(false); return }
        receiverIds = students.filter(s => s.class_id === targetClass).map(s => s.id)
      } else {
        if (targetClasses.length === 0) { toast.error('반을 선택하세요'); setSending(false); return }
        receiverIds = students.filter(s => s.class_id && targetClasses.includes(s.class_id)).map(s => s.id)
      }
      if (receiverIds.length === 0) { toast.error('수신자가 없습니다'); setSending(false); return }

      const rows = receiverIds.map(rid => ({
        sender_id: me, receiver_id: rid,
        subject: subject.trim() || null,
        content: content.trim(),
        reply_to_id: replyTo?.id ?? null,
      }))
      const { error } = await supabase.from('messages').insert(rows)
      if (error) throw error
      toast.success(`${receiverIds.length}명에게 쪽지를 보냈습니다.`)
      setComposeOpen(false)
      fetchData(me)
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : '전송 실패')
    } finally { setSending(false) }
  }

  return (
    <div className="flex h-screen">
      {/* 목록 패널 */}
      <div className="w-80 border-r bg-white flex flex-col flex-shrink-0">
        <div className="p-4 border-b space-y-3">
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-bold text-gray-900">쪽지함</h1>
            <Button size="sm" className="gap-1.5 h-8" onClick={openCompose}>
              <Plus className="w-3.5 h-3.5" />새 쪽지
            </Button>
          </div>
          <div className="flex gap-1">
            <button onClick={() => setTab('inbox')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-sm font-medium transition-colors ${tab === 'inbox' ? 'bg-blue-50 text-blue-700' : 'text-gray-500 hover:bg-gray-100'}`}>
              <Inbox className="w-3.5 h-3.5" />받은 쪽지
              {unreadCount > 0 && <span className="bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">{unreadCount}</span>}
            </button>
            <button onClick={() => setTab('sent')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-sm font-medium transition-colors ${tab === 'sent' ? 'bg-blue-50 text-blue-700' : 'text-gray-500 hover:bg-gray-100'}`}>
              <Send className="w-3.5 h-3.5" />보낸 쪽지
            </button>
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
            <Input placeholder="검색" className="pl-8 h-8 text-sm" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? <p className="text-center py-8 text-gray-400 text-sm">불러오는 중...</p>
            : filtered.length === 0 ? <p className="text-center py-8 text-gray-400 text-sm">쪽지가 없습니다</p>
            : filtered.map(m => {
              const isUnread = m.receiver_id === me && !m.is_read
              const otherName = tab === 'inbox'
                ? (m.sender as unknown as { name: string })?.name ?? '-'
                : (m.receiver as unknown as { name: string })?.name ?? '-'
              return (
                <button key={m.id} onClick={() => markRead(m)}
                  className={`w-full text-left px-4 py-3 border-b hover:bg-gray-50 transition-colors ${detail?.id === m.id ? 'bg-blue-50' : ''}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      {isUnread && <span className="w-1.5 h-1.5 bg-blue-500 rounded-full flex-shrink-0 mt-1" />}
                      <span className={`text-sm truncate ${isUnread ? 'font-semibold text-gray-900' : 'text-gray-700'}`}>{otherName}</span>
                    </div>
                    <span className="text-[10px] text-gray-400 flex-shrink-0">{formatDateTime(m.created_at).slice(5)}</span>
                  </div>
                  {m.subject && <p className="text-xs text-gray-600 font-medium mt-0.5 truncate">{m.subject}</p>}
                  <p className="text-xs text-gray-400 truncate mt-0.5">{m.content}</p>
                </button>
              )
            })}
        </div>
      </div>

      {/* 상세 패널 */}
      <div className="flex-1 flex flex-col bg-gray-50">
        {detail ? (
          <>
            <div className="p-5 bg-white border-b">
              <div className="flex items-start justify-between">
                <div>
                  {detail.subject && <h2 className="text-lg font-bold text-gray-900">{detail.subject}</h2>}
                  <div className="flex items-center gap-3 mt-1 text-sm text-gray-500">
                    <span>보낸이: {detail.sender_id === me ? '나' : (detail.sender as unknown as { name: string })?.name ?? '-'}</span>
                    <span>받는이: {detail.receiver_id === me ? '나' : (detail.receiver as unknown as { name: string })?.name ?? '-'}</span>
                    <span>{formatDateTime(detail.created_at)}</span>
                  </div>
                </div>
                <div className="flex gap-1">
                  {detail.sender_id !== me && (
                    <Button variant="outline" size="sm" className="gap-1.5 h-8" onClick={() => openReply(detail)}>
                      <Reply className="w-3.5 h-3.5" />답글
                    </Button>
                  )}
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-red-400 hover:text-red-600" onClick={() => deleteMsg(detail)}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              <div className="bg-white rounded-xl border p-5 max-w-2xl">
                <p className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">{detail.content}</p>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-400">
            <div className="text-center">
              <Inbox className="w-12 h-12 mx-auto mb-3 text-gray-300" />
              <p className="text-sm">쪽지를 선택하세요</p>
            </div>
          </div>
        )}
      </div>

      {/* 쓰기/답글 다이얼로그 */}
      <Dialog open={composeOpen} onOpenChange={setComposeOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{replyTo ? '답글 쓰기' : '새 쪽지 쓰기'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-1">
            {!replyTo && (
              <div className="space-y-2">
                <Label>보낼 대상</Label>
                <div className="flex gap-1.5">
                  {(['individual', 'class', 'multiclass'] as const).map(m => (
                    <button key={m} onClick={() => setSendMode(m)}
                      className={`flex-1 py-1.5 rounded-lg text-xs font-medium border transition-colors ${sendMode === m ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-300 hover:border-blue-400'}`}>
                      {m === 'individual' ? '개별 학생' : m === 'class' ? '반 전체' : '여러 반'}
                    </button>
                  ))}
                </div>
                {sendMode === 'individual' && (
                  <Select value={targetStudent} onValueChange={v => setTargetStudent(v ?? '')}>
                    <SelectTrigger><SelectValue placeholder="학생 선택" /></SelectTrigger>
                    <SelectContent>
                      {students.map(s => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name} {s.student_number ? `(${s.student_number})` : ''} — {classes.find(c => c.id === s.class_id)?.name ?? '미배정'}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                {sendMode === 'class' && (
                  <Select value={targetClass} onValueChange={v => setTargetClass(v ?? '')}>
                    <SelectTrigger>
                      <SelectValue placeholder="반 선택">
                        {classes.find(c => c.id === targetClass)
                          ? `${classes.find(c => c.id === targetClass)!.name} (${students.filter(s => s.class_id === targetClass).length}명)`
                          : '반 선택'}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {classes.map(c => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name} ({students.filter(s => s.class_id === c.id).length}명)
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                {sendMode === 'multiclass' && (
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap gap-1.5">
                      {classes.map(c => (
                        <button key={c.id} onClick={() => setTargetClasses(prev => prev.includes(c.id) ? prev.filter(x => x !== c.id) : [...prev, c.id])}
                          className={`px-2.5 py-1 rounded-full text-xs font-medium border-2 transition-colors ${targetClasses.includes(c.id) ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-300 hover:border-blue-400'}`}>
                          {c.name}
                        </button>
                      ))}
                    </div>
                    {targetClasses.length > 0 && (
                      <p className="text-xs text-blue-600">
                        선택: {targetClasses.map(id => classes.find(c => c.id === id)?.name).join(', ')} —
                        총 {students.filter(s => s.class_id && targetClasses.includes(s.class_id)).length}명
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
            {replyTo && (
              <div className="bg-gray-50 rounded-lg px-3 py-2 text-xs text-gray-500 flex items-start gap-2">
                <Reply className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                <div className="min-w-0">
                  <span className="font-medium">{(replyTo.sender as unknown as { name: string })?.name ?? '-'}에게 답글</span>
                  <p className="truncate mt-0.5">{replyTo.content}</p>
                </div>
                <button onClick={() => { setReplyTo(null); setSendMode('individual'); setTargetStudent('') }}>
                  <X className="w-3.5 h-3.5 text-gray-400 hover:text-gray-600" />
                </button>
              </div>
            )}
            <div className="space-y-1.5">
              <Label>제목 (선택)</Label>
              <Input placeholder="제목 입력" value={subject} onChange={e => setSubject(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>내용 *</Label>
              <Textarea placeholder="쪽지 내용을 입력하세요" value={content} onChange={e => setContent(e.target.value)} rows={5} />
            </div>
            <div className="flex gap-2 pt-1">
              <Button variant="outline" className="flex-1" onClick={() => setComposeOpen(false)}>취소</Button>
              <Button className="flex-1 gap-2" onClick={handleSend} disabled={sending}>
                <Send className="w-3.5 h-3.5" />{sending ? '전송 중...' : '보내기'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default function TeacherMessagesPage() {
  return (
    <Suspense fallback={<div className="p-6 text-center text-gray-400">불러오는 중...</div>}>
      <TeacherMessagesInner />
    </Suspense>
  )
}
