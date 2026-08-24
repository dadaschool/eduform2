import type { Role } from './types'

/**
 * 역할에 맞는 첫 화면.
 *
 * 레이아웃마다 "내 역할이 아니면 저쪽으로" 라고 적으면, 어느 쪽에도 속하지
 * 않는 계정(프로필이 없거나 관리자)이 두 레이아웃 사이를 오가며 무한
 * 리다이렉트에 빠진다. 실제로 겪었다. 보낼 곳을 한 곳에서 정한다.
 */
export function routeForRole(role: Role): string {
  switch (role) {
    case 'teacher': return '/teacher/dashboard'
    case 'student': return '/student/dashboard'
  }
}
