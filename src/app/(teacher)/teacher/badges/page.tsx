'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { toast } from 'sonner'
import { Plus, Trash2, Award } from 'lucide-react'
import type { Badge } from '@/lib/types'

const BADGE_ICONS = ['🏅', '⭐', '🌟', '🎖️', '🏆', '🎗️', '💎', '🌈', '🔥', '💡', '📚', '✏️', '🎨', '🎭', '🎵', '🌱', '🦋', '🚀', '🏃', '🤝', '❤️', '🧡', '💛', '💚', '💙', '💜', '🩷', '🤍']

export default function BadgesPage() {
  const supabase = createClient()
  const [badges, setBadges] = useState<Badge[]>([])
  const [loading, setLoading] = useState(true)
  const [openCreate, setOpenCreate] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [criteria, setCriteria] = useState('')
  const [icon, setIcon] = useState('🏅')
  const [saving, setSaving] = useState(false)

  const fetchBadges = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data } = await supabase.from('badges').select('*').eq('teacher_id', user.id).order('created_at')
    setBadges(data ?? [])
    setLoading(false)
  }, [supabase])

  useEffect(() => { fetchBadges() }, [fetchBadges])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('인증 필요')
      const { error } = await supabase.from('badges').insert({
        teacher_id: user.id, name, description: description || null, criteria: criteria || null, icon
      })
      if (error) throw error
      toast.success('배지가 생성되었습니다.')
      setOpenCreate(false)
      setName(''); setDescription(''); setCriteria(''); setIcon('🏅')
      fetchBadges()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : '생성 실패')
    } finally {
      setSaving(false)
    }
  }

  async function deleteBadge(id: string, badgeName: string) {
    if (!confirm(`"${badgeName}" 배지를 삭제하면 학생에게 수여된 기록도 삭제됩니다.`)) return
    await supabase.from('badges').delete().eq('id', id)
    toast.success('삭제되었습니다.')
    fetchBadges()
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">디지털 배지</h1>
          <p className="text-gray-500 text-sm mt-1">배지를 만들고 학생 관리에서 수여하세요</p>
        </div>
        <Dialog open={openCreate} onOpenChange={setOpenCreate}>
          <DialogTrigger><Button className="gap-2" type="button"><Plus className="w-4 h-4" />배지 만들기</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>새 배지 만들기</DialogTitle></DialogHeader>
            <form onSubmit={handleCreate} className="space-y-4 pt-2">
              <div className="space-y-1.5">
                <Label>아이콘 선택</Label>
                <div className="flex flex-wrap gap-2">
                  {BADGE_ICONS.map(ic => (
                    <button key={ic} type="button" onClick={() => setIcon(ic)}
                      className={`w-10 h-10 rounded-lg text-xl transition-all ${icon === ic ? 'bg-blue-100 ring-2 ring-blue-500' : 'bg-gray-100 hover:bg-gray-200'}`}>
                      {ic}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>배지 이름 *</Label>
                <Input placeholder="예: 독서왕, 발표 우수상" value={name} onChange={e => setName(e.target.value)} required />
              </div>
              <div className="space-y-1.5">
                <Label>설명 (선택)</Label>
                <Input placeholder="배지 설명" value={description} onChange={e => setDescription(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>수여 기준 (선택)</Label>
                <Textarea placeholder="어떤 기준으로 수여하나요?" value={criteria} onChange={e => setCriteria(e.target.value)} rows={2} />
              </div>
              <div className="p-3 bg-gray-50 rounded-lg text-center">
                <span className="text-4xl">{icon}</span>
                <p className="text-sm font-medium mt-1">{name || '배지 이름'}</p>
              </div>
              <div className="flex gap-2">
                <Button type="button" variant="outline" className="flex-1" onClick={() => setOpenCreate(false)}>취소</Button>
                <Button type="submit" className="flex-1" disabled={saving}>{saving ? '생성 중...' : '배지 생성'}</Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400">불러오는 중...</div>
      ) : badges.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center">
            <Award className="w-12 h-12 mx-auto mb-3 text-gray-300" />
            <p className="text-gray-500 font-medium">등록된 배지가 없습니다</p>
            <p className="text-gray-400 text-sm mt-1">배지를 만들고 학생에게 수여하세요</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {badges.map(b => (
            <Card key={b.id} className="hover:shadow-md transition-shadow">
              <CardContent className="p-4 text-center relative">
                <button
                  className="absolute top-2 right-2 text-gray-300 hover:text-red-400 transition-colors"
                  onClick={() => deleteBadge(b.id, b.name)}>
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
                <div className="text-4xl mb-2">{b.icon}</div>
                <h3 className="font-semibold text-gray-900 text-sm">{b.name}</h3>
                {b.description && <p className="text-xs text-gray-500 mt-1">{b.description}</p>}
                {b.criteria && (
                  <div className="mt-2 p-2 bg-yellow-50 rounded text-xs text-yellow-700">
                    {b.criteria}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

