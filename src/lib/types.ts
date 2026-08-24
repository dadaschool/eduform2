/**
 * 관리자는 role 이 아니라 profiles.is_admin 표시다.
 * role='admin' 으로 두면 관리자가 교사 화면을 쓸 수 없어졌다 — 같은 사람이
 * 관리자이면서 담임이므로 둘을 겹칠 수 있어야 한다.
 */
export type Role = 'teacher' | 'student'

export type CheckType = 'ox' | 'level3' | 'status3' | 'number' | 'score5' | 'text'

export const CHECK_TYPE_LABELS: Record<CheckType, string> = {
  ox: 'O / X',
  level3: '상 / 중 / 하',
  status3: '완료 / 보류 / 미제출',
  number: '숫자 입력',
  score5: '점수 (1~5)',
  text: '텍스트 메모',
}

export const CHECK_TYPE_OPTIONS: { value: CheckType; label: string; example: string }[] = [
  { value: 'ox', label: 'O / X', example: 'O 또는 X' },
  { value: 'level3', label: '상 / 중 / 하', example: '성취 수준' },
  { value: 'status3', label: '완료 / 보류 / 미제출', example: '과제 제출 상태' },
  { value: 'number', label: '숫자 입력', example: '점수, 횟수 등' },
  { value: 'score5', label: '점수 (1~5)', example: '별점형 평가' },
  { value: 'text', label: '텍스트 메모', example: '자유 기록' },
]

export interface Profile {
  id: string
  email: string | null
  name: string
  role: Role
  /** 계정·반 관리 권한. 교사 역할과 겹칠 수 있다. */
  is_admin: boolean
  class_id: string | null
  student_number: string | null
  teacher_id: string | null
  created_at: string
}

export interface Class {
  id: string
  name: string
  year: number
  teacher_id: string
  description: string | null
  created_at: string
}

export interface InviteCode {
  id: string
  code: string
  class_id: string
  teacher_id: string
  expires_at: string | null
  max_uses: number
  used_count: number
  is_active: boolean
  created_at: string
}

export interface Badge {
  id: string
  teacher_id: string
  name: string
  description: string | null
  icon: string
  criteria: string | null
  created_at: string
}

export interface StudentBadge {
  id: string
  student_id: string
  badge_id: string
  awarded_by: string
  note: string | null
  awarded_at: string
  badge?: Badge
}

export interface Assessment {
  id: string
  teacher_id: string
  title: string
  subject: string | null
  description: string | null
  created_at: string
  updated_at: string
  classes?: Class[]
  items?: AssessmentItem[]
}

export interface AssessmentItem {
  id: string
  assessment_id: string
  name: string
  description: string | null
  check_type: CheckType
  number_min: number
  number_max: number
  display_order: number
}

export interface StudentAssessmentCheck {
  id: string
  student_id: string
  assessment_item_id: string
  check_value: string | null
  teacher_memo: string | null
  updated_at: string
}

export interface Assignment {
  id: string
  teacher_id: string
  title: string
  description: string
  deadline: string | null
  created_at: string
  updated_at: string
  classes?: Class[]
}

export type SubmissionStatus = 'pre' | 'submitted' | 'late'

export interface AssignmentSubmission {
  id: string
  assignment_id: string
  student_id: string
  content: string
  submitted_at: string
  feedback: string | null
  feedback_at: string | null
  feedback_by: string | null
  status?: SubmissionStatus
  student?: Profile
  assignment?: Assignment
}

export interface Observation {
  id: string
  teacher_id: string
  student_id: string
  content: string
  subject: string | null
  observed_at: string
  created_at: string
  updated_at: string
  student?: Profile
}

export interface StudentRecordDraft {
  id: string
  teacher_id: string
  student_id: string
  subject: string | null
  content: string
  is_final: boolean
  generated_at: string
  updated_at: string
  student?: Profile
}
