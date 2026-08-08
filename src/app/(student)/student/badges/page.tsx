import { createClient } from '@/lib/supabase/server'
import { Card, CardContent } from '@/components/ui/card'
import { Award } from 'lucide-react'
import { formatDate } from '@/lib/utils'

export default async function StudentBadgesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: myBadges } = await supabase
    .from('student_badges')
    .select('*, badges(*)')
    .eq('student_id', user.id)
    .order('awarded_at', { ascending: false })

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">내 배지</h1>
        <p className="text-gray-500 text-sm mt-1">총 {myBadges?.length ?? 0}개</p>
      </div>

      {!myBadges || myBadges.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-16 text-center">
            <Award className="w-12 h-12 mx-auto mb-3 text-gray-300" />
            <p className="text-gray-500 font-medium">아직 배지가 없습니다</p>
            <p className="text-gray-400 text-sm mt-1">열심히 참여하면 선생님이 배지를 수여해 줄 거예요!</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {myBadges.map(sb => {
            const badge = sb.badges as unknown as { icon: string; name: string; description: string; criteria: string }
            return (
              <Card key={sb.id} className="text-center hover:shadow-md transition-shadow">
                <CardContent className="p-6">
                  <div className="text-5xl mb-3">{badge?.icon}</div>
                  <h3 className="font-bold text-gray-900">{badge?.name}</h3>
                  {badge?.description && (
                    <p className="text-sm text-gray-500 mt-1">{badge.description}</p>
                  )}
                  {sb.note && (
                    <div className="mt-3 p-2 bg-yellow-50 rounded text-xs text-yellow-700">
                      &ldquo;{sb.note}&rdquo;
                    </div>
                  )}
                  <p className="text-xs text-gray-400 mt-3">{formatDate(sb.awarded_at)} 수여</p>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
