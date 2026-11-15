import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { needsPasswordChange } from '@/lib/native-auth'
import { getClient, identityOf, redirectAllowed, validOpaque, callbackUrl } from '@/lib/sso'
import SsoConsent from './SsoConsent'

export const dynamic = 'force-dynamic'
export const metadata = { title: '에듀폼2 로 로그인', robots: { index: false, follow: false } }

/**
 * GET /sso/authorize?client_id&redirect_uri&state&nonce — «에듀폼2 로 로그인» 화면
 *
 * 잘못된 요청(등록 안 된 프로그램 · 등록 안 된 돌아갈 주소)은 «돌려보내지 않고»
 * 이 화면에서 멈춘다. 확인 안 된 주소로 보내면 가짜 사이트로 증명을 넘기게 된다.
 *
 * 로그인돼 있어도 바로 넘기지 않고 «○○○ 으로 계속» 을 한 번 누르게 한다.
 * 컴퓨터실처럼 여러 학생이 같은 컴퓨터를 쓰면, 앞 학생의 로그인이 남아 있다가
 * 다음 학생이 그 계정으로 들어가게 되기 때문이다.
 */
export default async function SsoAuthorizePage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>
}) {
  const one = (k: string) => (typeof searchParams[k] === 'string' ? (searchParams[k] as string) : '')
  const clientId = one('client_id')
  const redirectUri = one('redirect_uri')
  const state = one('state')
  const nonce = one('nonce')

  const client = clientId ? await getClient(clientId) : null
  if (!client || !client.enabled) return <Problem text="등록되지 않았거나 꺼 둔 프로그램입니다. 관리자에게 알려 주세요." />
  if (!redirectAllowed(client, redirectUri)) {
    return <Problem text="이 프로그램이 알려 준 돌아갈 주소가 등록되어 있지 않습니다. 관리자에게 알려 주세요." />
  }
  if (!validOpaque(state) || !validOpaque(nonce)) {
    return <Problem text="요청이 올바르지 않습니다 (state · nonce). 프로그램에서 다시 시작해 주세요." />
  }

  const self = `/sso/authorize?${new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, state, nonce })}`
  const loginPath = client.roles.includes('student') ? '/student-login' : '/login'

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect(`${loginPath}?next=${encodeURIComponent(self)}`)
  if (await needsPasswordChange(user.id)) redirect(`/change-password?next=${encodeURIComponent(self)}`)

  const who = await identityOf(user.id)
  if (!who) return <Problem text="이 계정에는 프로필이 없습니다. 선생님께 알려 주세요." />
  if (!client.roles.includes(who.role)) {
    return <Problem text={`«${client.name}» 은(는) ${client.roles.includes('student') ? '학생' : '교사'} 계정으로만 들어갈 수 있습니다.`} />
  }

  return (
    <SsoConsent
      clientId={client.client_id}
      clientName={client.name}
      redirectUri={redirectUri}
      state={state}
      nonce={nonce}
      who={{ name: who.name, role: who.role, studentNumber: who.student_number, className: who.class_name }}
      cancelUrl={callbackUrl(redirectUri, { error: 'access_denied', state })}
      switchUrl={`${loginPath}?next=${encodeURIComponent(self)}`}
    />
  )
}

function Problem({ text }: { text: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="max-w-md w-full bg-white border border-red-200 rounded-xl p-6 shadow-sm" role="alert">
        <h1 className="text-lg font-bold text-red-700 mb-2">에듀폼2 로 로그인할 수 없습니다</h1>
        <p className="text-sm text-gray-700 leading-relaxed" style={{ wordBreak: 'keep-all' }}>{text}</p>
      </div>
    </div>
  )
}
