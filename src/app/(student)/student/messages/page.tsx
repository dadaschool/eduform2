'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { toast } from 'sonner'
import { Plus, Trash2, Reply, Search, Inbox, Send, MessageCircle, X } from 'lucide-react'
import { formatDateTime } from '@/lib/utils'
import { usePoll, MESSAGE_POLL_MS } from '@/lib/use-poll'

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

export default function StudentMessagesPage() {
  const supabase = createClient()
  const [me, setMe] = useState('')
  // 담임 한 명이 아니라 내 반을 담당하는 교사 전원을 상대로 삼는다.
  const [teachers, setTeachers] = useState<{ id: string; name: string; kind: string }[]>([])
  const [teacherId, setTeacherId] = useState('')   // 지금 보고 있는 대화 상대
  const [tab, setTab] = useState<Tab>('inbox')
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [detail, setDetail] = useState<Message | null>(null)

  const [composeOpen, setComposeOpen] = useState(false)
  const [replyTo, setReplyTo] = useState<Message | null>(null)
  const [subject, setSubject] = useState('')
  const [content, setContent] = useState('')
  const [sending, setSending] = useState(false)

  const fetchData = useCallback(async (myId: string, tId: string) => {
    const { data } = await supabase
      .from('messages')
      .select('*, sender:profiles!sender_id(name), receiver:profiles!receiver_id(name)')
      .or(`sender_id.eq.${myId},receiver_id.eq.${myId}`)
      .order('created_at', { ascending: false })

    const filtered = (data ?? []).filter((m: Message) =>
      m.sender_id === myId ? !m.deleted_by_sender : !m.deleted_by_receiver
    ).filter((m: Message) =>
      m.sender_id === myId || m.sender_id === tId
    )
    setMessages(filtered)
  }, [supabase])

  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      setMe(user.id)

      // 내 반에 배정된 교사만 나온다 (class_teachers 기준, 담임이 먼저)
      const { data: list } = await supabase.rpc('my_teachers')
      const rows = (list ?? []) as { id: string; name: string; kind: string }[]
      setTeachers(rows)
      if (rows.length === 0) { setLoading(false); return }

      const tId = rows[0].id
      setTeacherId(tId)
      await fetchData(user.id, tId)
      setLoading(false)
    }
    init()
  }, [supabase, fetchData])

  // 대화 상대를 바꾸면 그 교사와의 쪽지만 다시 읽는다
  useEffect(() => {
    if (!me || !teacherId) return
    fetchData(me, teacherId)
  }, [me, teacherId, fetchData])

  // 새 쪽지 확인 — 실시간 구독 대신 주기적으로 다시 읽는다.
  // (Realtime 서버는 윈도우 빌드가 없어 교내 서버에 띄울 수 없다)
  usePoll(() => {
    if (me && teacherId) fetchData(me, teacherId)
  }, MESSAGE_POLL_MS, Boolean(me && teacherId))

  const teacherName = teachers.find(t => t.id === teacherId)?.name ?? '선생님'
  const inbox = messages.filter(m => m.receiver_id === me)
  const sent = messages.filter(m => m.sender_id === me)
  const unreadCount = inbox.filter(m => !m.is_read).length
  const current = tab === 'inbox' ? inbox : sent

  const filtered = current.filter(m =>
    (m.subject ?? '').includes(search) || m.content.includes(search)
  )

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
    setComposeOpen(true)
  }

  function openCompose() {
    setReplyTo(null)
    setSubject(''); setContent('')
    setComposeOpen(true)
  }

  async function handleSend() {
    if (!teacherId) { toast.error('담당 선생님 정보가 없습니다'); return }
    if (!content.trim()) { toast.error('내용을 입력하세요'); return }
    setSending(true)
    try {
      const { error } = await supabase.from('messages').insert({
        sender_id: me, receiver_id: teacherId,
        subject: subject.trim() || null,
        content: content.trim(),
        reply_to_id: replyTo?.id ?? null,
      })
      if (error) throw error
      toast.success('쪽지를 보냈습니다.')
      setComposeOpen(false)
      fetchData(me, teacherId)
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : '전송 실패')
    } finally { setSending(false) }
  }

  if (loading) return <div className="p-6 text-center text-gray-400">불러오는 중...</div>

  if (!teacherId) return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center">
        <MessageCircle className="w-12 h-12 mx-auto mb-3 text-gray-300" />
        <p className="text-gray-500 text-sm">아직 우리 반을 담당하는 선생님이 없습니다.</p>
        <p className="text-gray-400 text-xs mt-1">선생님이 반을 담당하면 쪽지를 주고받을 수 있습니다.</p>
      </div>
    </div>
  )

  return (
    <div className="flex h-screen">
      {/* 목록 패널 */}
      <div className="w-80 border-r bg-white flex flex-col flex-shrink-0">
        <div className="p-4 border-b space-y-3">
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-bold text-gray-900">쪽지함</h1>
            <Button size="sm" className="gap-1.5 h-8 bg-green-600 hover:bg-green-700" onClick={openCompose}>
              <Plus className="w-3.5 h-3.5" />새 쪽지
            </Button>
          </div>
          {teachers.length > 1 && (
            <div className="space-y-1">
              <p className="text-xs text-gray-400">선생님 선택</p>
              <div className="flex flex-wrap gap-1">
                {teachers.map(t => (
                  <button key={t.id} type="button" onClick={() => setTeacherId(t.id)}
                    className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                      teacherId === t.id
                        ? 'bg-green-600 text-white border-green-600'
                        : 'bg-white text-gray-600 border-gray-300 hover:border-green-400'
                    }`}>
                    {t.name}
                    {t.kind === 'homeroom' && <span className="ml-1 opacity-70">담임</span>}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="flex gap-1">
            <button onClick={() => setTab('inbox')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-sm font-medium transition-colors ${tab === 'inbox' ? 'bg-green-50 text-green-700' : 'text-gray-500 hover:bg-gray-100'}`}>
              <Inbox className="w-3.5 h-3.5" />받은 쪽지
              {unreadCount > 0 && <span className="bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">{unreadCount}</span>}
            </button>
            <button onClick={() => setTab('sent')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-sm font-medium transition-colors ${tab === 'sent' ? 'bg-green-50 text-green-700' : 'text-gray-500 hover:bg-gray-100'}`}>
              <Send className="w-3.5 h-3.5" />보낸 쪽지
            </button>
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
            <Input placeholder="검색" className="pl-8 h-8 text-sm" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 ? <p className="text-center py-8 text-gray-400 text-sm">쪽지가 없습니다</p>
            : filtered.map(m => {
              const isUnread = m.receiver_id === me && !m.is_read
              return (
                <button key={m.id} onClick={() => markRead(m)}
                  className={`w-full text-left px-4 py-3 border-b hover:bg-gray-50 transition-colors ${detail?.id === m.id ? 'bg-green-50' : ''}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      {isUnread && <span className="w-1.5 h-1.5 bg-green-500 rounded-full flex-shrink-0 mt-1" />}
                      <span className={`text-sm truncate ${isUnread ? 'font-semibold text-gray-900' : 'text-gray-700'}`}>
                        {tab === 'inbox' ? `${teacherName} 선생님` : `${teacherName} 선생님에게`}
                      </span>
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
                    <span>보낸이: {detail.sender_id === me ? '나' : `${teacherName} 선생님`}</span>
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
            <DialogTitle>{replyTo ? '답글 쓰기' : `${teacherName} 선생님께 쪽지`}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-1">
            {replyTo && (
              <div className="bg-gray-50 rounded-lg px-3 py-2 text-xs text-gray-500 flex items-start gap-2">
                <Reply className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                <div className="min-w-0">
                  <span className="font-medium">답글</span>
                  <p className="truncate mt-0.5">{replyTo.content}</p>
                </div>
                <button onClick={() => { setReplyTo(null); setSubject('') }}>
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
              <Button className="flex-1 gap-2 bg-green-600 hover:bg-green-700" onClick={handleSend} disabled={sending}>
                <Send className="w-3.5 h-3.5" />{sending ? '전송 중...' : '보내기'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
