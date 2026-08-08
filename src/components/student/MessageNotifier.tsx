'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { MessageCircle, X, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatDateTime } from '@/lib/utils'

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
  const [unreadMessages, setUnreadMessages] = useState<UnreadMessage[]>([])
  const [modalOpen, setModalOpen] = useState(false)

  useEffect(() => {
    async function checkUnread() {
      if (initializedRef.current) return
      initializedRef.current = true

      const { data } = await supabase
        .from('messages')
        .select('id, sender_id, subject, content, created_at, sender:profiles!sender_id(name)')
        .eq('receiver_id', userId)
        .eq('is_read', false)
        .eq('deleted_by_receiver', false)
        .order('created_at', { ascending: false })

      if (data && data.length > 0) {
        setUnreadMessages(data as unknown as UnreadMessage[])
        setModalOpen(true)
      }
    }
    checkUnread()

    // Realtime: 새 쪽지 수신 (로그인 이후 실시간)
    const channel = supabase
      .channel(`msg-notifier-${userId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `receiver_id=eq.${userId}`,
      }, async (payload) => {
        const { data: sender } = await supabase
          .from('profiles')
          .select('name')
          .eq('id', payload.new.sender_id)
          .single()

        const senderName = sender?.name ?? '선생님'
        const subject = payload.new.subject ? ` [${payload.new.subject}]` : ''

        toast(`${senderName}${subject}`, {
          description: (payload.new.content as string).slice(0, 60) + ((payload.new.content as string).length > 60 ? '…' : ''),
          icon: <MessageCircle className="w-4 h-4 text-green-500" />,
          action: { label: '확인', onClick: () => router.push('/student/messages') },
          duration: 8000,
        })
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [userId, supabase, router])

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
