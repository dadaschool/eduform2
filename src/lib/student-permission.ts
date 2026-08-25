import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * «이 사람이 저 학생에게 무엇을 할 수 있는가» 를 한 곳에서 판단한다.
 *
 * 정해진 권한
 *   교과 담당 교사 : 담당반 학생 조회 · 비밀번호 초기화
 *   담임 교사      : 담임반 학생 조회 · 비밀번호 초기화 · 반배정 수정 · 삭제
 *   관리자         : 모든 학생에 위 전부 + «다른 교사» 비밀번호 초기화
 *
 * 관리자가 교사도 다룰 수 있어야 하는 이유 : 교내망에는 메일 서버가 없어
 * «비밀번호 찾기» 메일을 보낼 수 없다. 선생님이 비밀번호를 잊으면 관리자가
 * 새로 정해 주는 것이 유일한 길이다.
 *
 * ⚠ 왜 서버에서 다시 판단하는가
 *   DB 정책(RLS)이 이미 막고 있지만, 비밀번호 초기화와 계정 삭제는
 *   service_role 로 실행된다 — 그 키는 RLS 를 «무시한다». 즉 이 판단이
 *   유일한 문턱이다. 예전에는 «교사인지» 만 보고 통과시켜서, 아무 교사나
 *   다른 교사나 관리자의 비밀번호까지 바꿀 수 있었다.
 */
export interface StudentAccess {
  /** 조회·비밀번호 초기화가 가능한가 (담임 · 교과 담당 · 관리자) */
  allowed: boolean
  /** 반배정 수정·삭제가 가능한가 (담임 · 관리자만) */
  canManage: boolean
  isAdmin: boolean
  /** 거절 이유. allowed 가 false 일 때만 채워진다. */
  reason?: string
}

const DENY = (reason: string): StudentAccess =>
  ({ allowed: false, canManage: false, isAdmin: false, reason })

/**
 * 조회는 «호출자 자신의 클라이언트» 로 한다. 그러면 RLS 가 먼저 걸러 주므로,
 * 볼 수 없는 학생이면 여기서 아예 찾지 못한다.
 */
export async function checkStudentAccess(
  supabase: SupabaseClient,
  callerId: string,
  studentId: string
): Promise<StudentAccess> {
  if (!studentId) return DENY('학생을 지정하지 않았습니다')

  // select('*') — is_admin 컬럼이 없는 DB 에서도 조회가 실패하지 않아야 한다
  const { data: me } = await supabase.from('profiles').select('*').eq('id', callerId).maybeSingle()
  if (!me) return DENY('계정 정보를 찾을 수 없습니다')

  const isAdmin = me.is_admin === true
  if (me.role !== 'teacher' && !isAdmin) return DENY('교사만 할 수 있습니다')

  const { data: stu } = await supabase
    .from('profiles').select('*').eq('id', studentId).maybeSingle()

  // RLS 가 걸러 냈다면 여기서 null 이다 = 볼 권한이 없다
  if (!stu) return DENY('그 계정에 대한 권한이 없습니다')

  // 자기 계정은 여기서 다루지 않는다. «내 계정» 화면에서 현재 비밀번호를
  // 확인한 뒤 바꾼다 — 로그인된 브라우저를 남의 손에 두고 자리를 비웠을 때
  // 그 사람이 비밀번호를 갈아버리는 것을 막는다.
  if (studentId === callerId) return DENY('내 비밀번호는 «내 계정» 화면에서 바꿉니다')

  // 관리자는 교사도 다룰 수 있다 (비밀번호 초기화). 학생은 관리까지.
  if (isAdmin) {
    if (stu.role !== 'student' && stu.role !== 'teacher') {
      return DENY('처리할 수 없는 계정입니다')
    }
    return { allowed: true, canManage: stu.role === 'student', isAdmin: true }
  }

  if (stu.role !== 'student') return DENY('학생 계정만 처리할 수 있습니다')

  // 담임인가 — class_teachers 의 role 로 판단한다
  let isHomeroom = false
  if (stu.class_id) {
    const { data: ct } = await supabase
      .from('class_teachers').select('role')
      .eq('class_id', stu.class_id).eq('teacher_id', callerId).maybeSingle()
    isHomeroom = ct?.role === 'homeroom'
  }
  // 반 배정 전 학생은 만든 교사가 담임처럼 다룬다 (아무도 못 고치면 갇힌다)
  if (!isHomeroom && stu.teacher_id === callerId) isHomeroom = true

  return { allowed: true, canManage: isHomeroom, isAdmin: false }
}
