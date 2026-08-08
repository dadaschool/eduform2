import { redirect } from 'next/navigation'

export default function LegacyStudentMessagePage({ params }: { params: { studentId: string } }) {
  redirect(`/teacher/messages?to=${params.studentId}`)
}
