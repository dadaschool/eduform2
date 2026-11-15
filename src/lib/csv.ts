/**
 * 칸 하나를 CSV 로. 쉼표·따옴표·줄바꿈은 따옴표로 감싼다.
 * 엑셀이 수식으로 실행하지 않게 = + - @ (와 탭·CR) 로 시작하면 앞에 ' 를 붙인다.
 */
export function csvCell(v: string | null | undefined): string {
  let s = (v ?? '').replace(/\r?\n/g, ' ')
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
