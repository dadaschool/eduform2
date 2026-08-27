import type { SupabaseClient } from '@supabase/supabase-js'
import type { Class, Profile } from '@/lib/types'

/**
 * 내가 «담당하는» 반과 그 반의 학생.
 *
 * ⚠ classes.teacher_id 로 반을 찾으면 안 된다. 그 값은 «반을 만든 사람» 이지
 *   담당 교사가 아니다. 반은 보통 관리자가 한 번에 만들어 두고, 교사는 거기에
 *   담임이나 교과 담당으로 «배정» 된다(class_teachers).
 *
 *   그래서 teacher_id 로 찾으면 반을 직접 만들지 않은 교사에게는 반 목록이
 *   통째로 비어 보인다. 실제로 겪었다 — 교과 담당 교사가 평가를 가져와도
 *   배정할 반이 하나도 없었고, 그래서 학생도 한 명도 안 나왔다.
 *
 * profiles.teacher_id 도 같은 함정이다. 그 값은 담임 한 명을 가리키므로,
 * 교과 담당 교사는 자기가 가르치는 학생을 한 명도 찾지 못한다.
 * 학생은 «반» 을 통해 찾는다.
 *
 * 담당 관계는 class_teachers 한 곳에서만 읽는다.
 */

export interface MyClassIds {
  ids: string[]
  /** class_id → 담임인가 교과 담당인가 */
  roleOf: Record<string, 'homeroom' | 'subject'>
}

export async function fetchMyClassIds(
  supabase: SupabaseClient,
  teacherId: string
): Promise<MyClassIds> {
  const { data } = await supabase
    .from('class_teachers').select('class_id, role').eq('teacher_id', teacherId)
  return {
    ids: (data ?? []).map(r => r.class_id as string),
    roleOf: Object.fromEntries((data ?? []).map(r => [r.class_id, r.role])),
  }
}

/** 내가 담당하는 반. 없으면 빈 배열. */
export async function fetchMyClasses(
  supabase: SupabaseClient,
  teacherId: string
): Promise<Class[]> {
  const { ids } = await fetchMyClassIds(supabase, teacherId)
  // in() 에 빈 배열을 넘기면 PostgREST 가 문법 오류를 낸다. 먼저 끊는다.
  if (ids.length === 0) return []
  const { data } = await supabase.from('classes').select('*').in('id', ids).order('name')
  return data ?? []
}

/**
 * 내가 담당하는 반의 학생 전체.
 * 반 순서 → 번호 → 이름 순으로 정렬한다.
 */
export async function fetchMyStudents(
  supabase: SupabaseClient,
  teacherId: string
): Promise<Profile[]> {
  const { ids } = await fetchMyClassIds(supabase, teacherId)
  if (ids.length === 0) return []
  const { data } = await supabase
    .from('profiles').select('*').eq('role', 'student').in('class_id', ids)
    .order('class_id').order('student_number').order('name')
  return data ?? []
}
