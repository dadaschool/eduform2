'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { MessageCircle, X, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatDateTime } from '@/lib/utils'
import { usePoll, MESSAGE_POLL_MS } from '@/lib/use-poll'

interface UnreadMessage {
  id: string
  sender_id: string
  subject: string | null
  content: string
  created_at: string
  sender?: { name: string }
}

export default function MessageNotifier({ userId }: { userId: string }) {
  const supabase = createClient()
  const router = useRouter()
  const initializedRef = useRef(false)
  /** 이미 알린 쪽지 id. 폴링이 같은 쪽지를 반복해서 알리지 않게 한다. */
  const seenRef = useRef<Set<string>>(new Set())
  const [unreadMessages, setUnreadMessages] = useState<UnreadMessage[]>([])
  const [modalOpen, setModalOpen] = useState(false)

  /** 읽지 않은 쪽지를 가져온다. */
  const fetchUnread = useCallback(async () => {
    const { data } = await supabase
      .from('messages')
      .select('id, sender_id, subject, content, created_at, sender:profiles!sender_id(name)')
      .eq('receiver_id', userId)
      .eq('is_read', false)
      .eq('deleted_by_receiver', false)
      .order('created_at', { ascending: false })
    return (data ?? []) as unknown as UnreadMessage[]
  }, [supabase, userId])

  // 로그인 직후 한 번 — 안 읽은 쪽지가 있으면 모달로 알린다
  useEffect(() => {
    async function first() {
      if (initializedRef.current) return
      initializedRef.current = true

      const rows = await fetchUnread()
      // 모달로 이미 보여 준 쪽지는 토스트로 다시 알리지 않는다
      rows.forEach(m => seenRef.current.add(m.id))
      if (rows.length > 0) {
        setUnreadMessages(rows)
        setModalOpen(true)
      }
    }
    first()
  }, [fetchUnread])

  // 그 뒤로는 주기적으로 확인한다.
  // 실시간 구독을 쓰지 않는 이유: Realtime 서버는 윈도우 빌드가 없어
  // 교내 서버에 띄울 수 없다. 즉시 대신 몇 초 지연으로 바꿨다.
  usePoll(async () => {
    const rows = await fetchUnread()
    const fresh = rows.filter(m => !seenRef.current.has(m.id))
    if (fresh.length === 0) return

    fresh.forEach(m => seenRef.current.add(m.id))

    // 한 번에 여러 개가 와도 토스트를 쌓지 않는다. 3개까지만 띄운다.
    fresh.slice(0, 3).forEach(m => {
      const senderName = m.sender?.name ?? '선생님'
      const subject = m.subject ? ` [${m.subject}]` : ''
      toast(`${senderName}${subject}`, {
        description: m.content.slice(0, 60) + (m.content.length > 60 ? '…' : ''),
        icon: <MessageCircle className="w-4 h-4 text-green-500" />,
        action: { label: '확인', onClick: () => router.push('/student/messages') },
        duration: 8000,
      })
    })
    if (fresh.length > 3) {
      toast(`새 쪽지 ${fresh.length}개`, {
        action: { label: '쪽지함 열기', onClick: () => router.push('/student/messages') },
      })
    }
  }, MESSAGE_POLL_MS)

  function handleGoToMessages() {
    setModalOpen(false)
    router.push('/student/messages')
  }

  if (!modalOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* 배경 오버레이 */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setModalOpen(false)} />

      {/* 모달 */}
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
        {/* 헤더 */}
        <div className="flex items-center gap-3 px-5 py-4 bg-green-500 text-white">
          <div className="w-9 h-9 bg-white/20 rounded-full flex items-center justify-center flex-shrink-0">
            <MessageCircle className="w-5 h-5" />
          </div>
          <div className="flex-1">
            <p className="font-bold text-base">읽지 않은 쪽지</p>
            <p className="text-green-100 text-xs">{unreadMessages.length}개의 새 쪽지가 있습니다</p>
          </div>
          <button onClick={() => setModalOpen(false)} className="p-1 rounded-full hover:bg-white/20 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 쪽지 목록 */}
        <div className="max-h-72 overflow-y-auto divide-y">
          {unreadMessages.map(m => (
            <div key={m.id} className="px-5 py-3.5 hover:bg-gray-50 transition-colors">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-semibold text-gray-800">
                  {(m.sender as unknown as { name: string })?.name ?? '선생님'} 선생님
                </span>
                <span className="text-[11px] text-gray-400">{formatDateTime(m.created_at).slice(5)}</span>
              </div>
              {m.subject && <p className="text-xs font-medium text-green-700 mb-0.5">{m.subject}</p>}
              <p className="text-xs text-gray-500 line-clamp-2 leading-relaxed">{m.content}</p>
            </div>
          ))}
        </div>

        {/* 푸터 */}
        <div className="px-5 py-3 bg-gray-50 border-t flex gap-2">
          <Button variant="outline" className="flex-1" onClick={() => setModalOpen(false)}>
            나중에 확인
          </Button>
          <Button className="flex-1 gap-1.5 bg-green-500 hover:bg-green-600" onClick={handleGoToMessages}>
            쪽지함 열기 <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}
