/**
 * 로그인은 됐지만 profiles 행이 없는 계정에 보여줄 화면.
 *
 * 이걸 두지 않으면 교사·학생 레이아웃이 서로 상대 화면으로 밀어내며
 * 무한 리다이렉트에 빠진다. 브라우저는 "리디렉션이 너무 많습니다" 만
 * 보여주고, 원인을 찾기가 매우 어렵다. 실제로 겪은 일이다.
 */
export default function NoProfileNotice({ email }: { email?: string | null }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
      <div className="max-w-md text-center space-y-3">
        <h1 className="text-xl font-bold text-gray-900">계정 등록이 완료되지 않았습니다</h1>
        <p className="text-sm text-gray-600">
          로그인은 되었지만 이 계정에 프로필 정보가 없습니다.
          관리자에게 계정 등록을 요청하세요.
        </p>
        {email && <p className="text-xs text-gray-400">{email}</p>}
      </div>
    </div>
  )
}
