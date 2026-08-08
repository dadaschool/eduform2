import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { format, isAfter, parseISO } from "date-fns"
import { ko } from "date-fns/locale"
import type { SubmissionStatus } from "./types"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDate(date: string | Date, fmt = 'yyyy.MM.dd') {
  const d = typeof date === 'string' ? parseISO(date) : date
  return format(d, fmt, { locale: ko })
}

export function formatDateTime(date: string | Date) {
  const d = typeof date === 'string' ? parseISO(date) : date
  return format(d, 'yyyy.MM.dd HH:mm', { locale: ko })
}

export function getSubmissionStatus(
  deadline: string | null,
  submittedAt: string | null
): SubmissionStatus {
  if (!submittedAt) return 'pre'
  if (!deadline) return 'submitted'
  const dl = parseISO(deadline)
  const sub = parseISO(submittedAt)
  return isAfter(sub, dl) ? 'late' : 'submitted'
}

export const SUBMISSION_STATUS_LABELS: Record<SubmissionStatus, string> = {
  pre: '제출 전',
  submitted: '제출 완료',
  late: '사후 제출',
}

export const SUBMISSION_STATUS_COLORS: Record<SubmissionStatus, string> = {
  pre: 'bg-gray-100 text-gray-600',
  submitted: 'bg-green-100 text-green-700',
  late: 'bg-orange-100 text-orange-700',
}

export function generateInviteCode(length = 8): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
}
