/**
 * 비밀번호 규칙 — docs/accounts-design.md «3. 비밀번호 보안» ⑤
 *
 * 두 가지 규칙이 있다 (2026-11-15 사용자 결정 «첫 로그인 변경만»).
 *
 *   임시 비밀번호 — 관리자·교사가 정해 주는 것 (일괄 등록·비밀번호 초기화).
 *                  지금처럼 6자 이상이면 된다. 대신 «임시» 로 표시되어, 그 사람이
 *                  첫 로그인 때 자기 비밀번호로 바꿔야 화면에 들어간다.
 *   내 비밀번호   — 본인이 정하는 것 (첫 로그인 변경 · 내 정보 · 초대코드 가입).
 *                  아래 checkOwnPassword 규칙을 모두 지켜야 한다.
 *
 * 화면(클라이언트)에서도 같은 함수를 불러 미리 알려 주지만, 실제로 막는 것은
 * 서버(/auth/v1/user · /auth/v1/signup)다.
 */

export const TEMP_MIN_LENGTH = 6
export const OWN_MIN_LENGTH = 8
/** bcrypt 는 72바이트 뒤를 버린다. 한글은 한 글자가 3바이트라 24자 남짓이다. */
export const MAX_BYTES = 72

/** 너무 흔해서 맞히기 쉬운 것. 소문자로 비교한다. */
const COMMON = new Set([
  'edu1234', 'edu12345', 'edu123456', 'change-me', 'password', 'password1', 'passw0rd',
  'qwerty', 'qwerty12', 'qwerty123', 'qwer1234', 'asdf1234', 'zxcv1234', 'abcd1234',
  'abc12345', 'a1234567', 'a12345678', '1q2w3e4r', '1q2w3e4r5t', 'q1w2e3r4', 'iloveyou',
  'student', 'student1', 'school', 'school1', 'teacher', 'teacher1', 'eduform', 'eduform2',
  'admin123', 'welcome1', 'test1234', 'korea123', 'dkssud12', 'gkrtod12',
])

export interface PolicyContext {
  /** 이메일 — 앞부분(@ 앞)이 비밀번호에 들어가면 안 된다 */
  email?: string | null
  /** 학번 — 비밀번호에 들어가면 안 된다 (같은 반 친구가 안다) */
  studentNumber?: string | null
  /** 이름 */
  name?: string | null
}

function bytes(s: string): number {
  return new TextEncoder().encode(s).length
}

/** 임시 비밀번호 검사. 문제가 없으면 null, 있으면 사람이 읽을 이유. */
export function checkTempPassword(pw: string): string | null {
  if (pw.length < TEMP_MIN_LENGTH) return `비밀번호는 ${TEMP_MIN_LENGTH}자 이상이어야 합니다`
  if (bytes(pw) > MAX_BYTES) return '비밀번호가 너무 깁니다 (영문 72자 · 한글 24자 이하)'
  return null
}

/** 본인이 정하는 비밀번호 검사. 문제가 없으면 null, 있으면 사람이 읽을 이유. */
export function checkOwnPassword(pw: string, ctx: PolicyContext = {}): string | null {
  if (pw.length < OWN_MIN_LENGTH) return `비밀번호는 ${OWN_MIN_LENGTH}자 이상이어야 합니다`
  if (bytes(pw) > MAX_BYTES) return '비밀번호가 너무 깁니다 (영문 72자 · 한글 24자 이하)'
  if (/\s/.test(pw)) return '비밀번호에 띄어쓰기를 넣을 수 없습니다'

  const lower = pw.toLowerCase()
  if (!/[a-z가-힣]/i.test(pw) || !/[0-9]/.test(pw)) {
    return '글자(영문 또는 한글)와 숫자를 함께 넣으세요'
  }
  if (/^(.)\1+$/.test(pw)) return '같은 글자만 반복할 수 없습니다'
  if (COMMON.has(lower)) return '너무 흔한 비밀번호입니다. 다른 것을 쓰세요'
  if (isSequence(lower)) return '연속된 글자·숫자(12345678, abcdefgh)는 쓸 수 없습니다'

  const sn = (ctx.studentNumber ?? '').trim()
  if (sn.length >= 3 && lower.includes(sn.toLowerCase())) return '비밀번호에 학번을 넣을 수 없습니다'

  const local = (ctx.email ?? '').split('@')[0]?.trim().toLowerCase() ?? ''
  if (local.length >= 3 && lower.includes(local)) return '비밀번호에 이메일 앞부분을 넣을 수 없습니다'

  const name = (ctx.name ?? '').replace(/\s/g, '')
  if (name.length >= 2 && pw.includes(name)) return '비밀번호에 이름을 넣을 수 없습니다'

  return null
}

/** 한 칸씩 오르거나 내리는 글자로만 되어 있는가 (12345678 · abcdefgh · 87654321). */
function isSequence(s: string): boolean {
  if (s.length < 4) return false
  let up = true
  let down = true
  for (let i = 1; i < s.length; i++) {
    const d = s.charCodeAt(i) - s.charCodeAt(i - 1)
    if (d !== 1) up = false
    if (d !== -1) down = false
  }
  return up || down
}
