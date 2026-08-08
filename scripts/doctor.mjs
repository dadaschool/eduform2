/**
 * 설치 상태 점검 — 무엇이 빠졌는지 한 번에 알려준다.
 *
 *   npm run doctor
 *
 * 환경변수, Supabase 연결, 테이블·함수·보안정책, AI 키를 차례로 확인한다.
 * 비밀값은 출력하지 않는다.
 */
import { loadEnv, c, ok, bad, warn, head } from './_env.mjs'

const env = { ...loadEnv(), ...process.env }
let problems = 0
const todo = []

function fail(msg, fix) {
  problems++
  console.log(bad(msg))
  if (fix) todo.push(fix)
}

// ─────────────────────────────────────────────
console.log(head('1. 환경변수'))

const REQUIRED = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY']
for (const k of REQUIRED) {
  if (env[k]) console.log(ok(`${k} 설정됨`))
  else fail(`${k} 없음`, `.env.local 에 ${k} 를 넣으세요 (.env.example 참고)`)
}

const hasGemini = Boolean(env.GEMINI_API_KEY)
const hasUpstage = Boolean(env.UPSTAGE_API_KEY)
if (hasGemini || hasUpstage) {
  console.log(ok(`AI 키: ${[hasGemini && 'Gemini', hasUpstage && '업스테이지'].filter(Boolean).join(' + ')}`))
} else {
  console.log(warn('AI 키가 없습니다 — 평가 항목 추천, 생활기록부 초안 두 기능만 못 씁니다'))
}
if (env.SUPABASE_DB_URL) console.log(ok('SUPABASE_DB_URL 설정됨 (npm run db:setup 사용 가능)'))

if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  console.log(head('필수 환경변수가 없어 여기서 중단합니다.'))
  todo.forEach((t) => console.log(`  → ${t}`))
  process.exit(1)
}

const U = env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/+$/, '')
const svc = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` }
const anon = { apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY, Authorization: `Bearer ${env.NEXT_PUBLIC_SUPABASE_ANON_KEY}` }

async function count(headers, table, select = '*') {
  const res = await fetch(`${U}/rest/v1/${table}?select=${select}`, {
    headers: { ...headers, Prefer: 'count=exact', Range: '0-0' },
  })
  if (!res.ok) return { error: `HTTP ${res.status}` }
  return { n: Number((res.headers.get('content-range') ?? '/0').split('/')[1]) }
}

// ─────────────────────────────────────────────
console.log(head('2. Supabase 연결'))
try {
  const res = await fetch(`${U}/rest/v1/profiles?select=id&limit=1`, { headers: anon })
  if (res.ok) console.log(ok(`${U} 응답 정상`))
  else fail(`REST 응답 HTTP ${res.status}`, 'NEXT_PUBLIC_SUPABASE_ANON_KEY 가 이 프로젝트의 키인지 확인하세요')
} catch (e) {
  fail(`연결 실패: ${e.message}`, '프로젝트가 일시정지 상태인지 확인하세요 (대시보드에서 Resume project)')
  console.log(head('연결이 안 되어 여기서 중단합니다.'))
  todo.forEach((t) => console.log(`  → ${t}`))
  process.exit(1)
}

// ─────────────────────────────────────────────
console.log(head('3. 테이블'))
const TABLES = {
  classes: 'id', invite_codes: 'id', profiles: 'id', badges: 'id', student_badges: 'id',
  assessments: 'id', assessment_classes: 'assessment_id', assessment_items: 'id',
  student_assessment_checks: 'id', assignments: 'id', assignment_classes: 'assignment_id',
  assignment_submissions: 'id', observations: 'id', student_record_drafts: 'id', messages: 'id',
}
const missing = []
const counts = {}
for (const [t, sel] of Object.entries(TABLES)) {
  const r = await count(svc, t, sel)
  if (r.error) missing.push(t)
  else counts[t] = r.n
}
if (missing.length === 0) {
  console.log(ok(`15개 전부 있음 — ${Object.entries(counts).map(([t, n]) => `${t} ${n}`).join(', ')}`))
} else {
  fail(`없는 테이블: ${missing.join(', ')}`, 'supabase/schema.sql 을 실행하세요 (npm run db:setup 또는 SQL Editor 에 붙여넣기)')
}

// ─────────────────────────────────────────────
console.log(head('4. 함수'))
// 인자가 있는 함수는 인자를 넣어야 한다. 빈 본문으로 호출하면
// 시그니처가 안 맞아 404 가 나와 "없음" 으로 오판한다.
const NIL = '00000000-0000-0000-0000-000000000000'
const FNS = [
  ['current_user_teacher_id', {}],
  ['current_user_class_id', {}],
  ['is_my_assignment', { p_assignment_id: NIL }],
  ['is_my_assessment_item', { p_item_id: NIL }],
  ['is_assignment_for_my_class', { p_assignment_id: NIL }],
  ['increment_invite_code', { code: '__doctor_probe__' }],
]
const noFn = []
for (const [fn, args] of FNS) {
  const res = await fetch(`${U}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { ...svc, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  })
  if (res.status === 404) noFn.push(fn)
}
if (noFn.length === 0) console.log(ok('6개 전부 있음'))
else fail(`없는 함수: ${noFn.join(', ')}`, 'supabase/schema.sql 을 (다시) 실행하세요')

// ─────────────────────────────────────────────
console.log(head('5. 보안정책 (로그인 없이 읽히면 안 되는 것)'))
const MUST_BE_BLOCKED = [
  ['profiles', 'id'], ['messages', 'id'], ['observations', 'id'],
  ['student_assessment_checks', 'id'], ['student_record_drafts', 'id'],
  ['assignments', 'id'], ['assignment_classes', 'assignment_id'],
]
let leaks = 0
for (const [t, sel] of MUST_BE_BLOCKED) {
  if (missing.includes(t)) continue
  const r = await count(anon, t, sel)
  if (r.error) continue
  if (r.n > 0) { leaks++; console.log(bad(`${t} — 비로그인에 ${r.n}행 노출`)) }
}
if (leaks === 0) console.log(ok('민감 테이블 전부 차단됨'))
else fail(`${leaks}개 테이블이 로그인 없이 읽힙니다`, 'supabase/schema.sql 을 실행해 보안정책을 교체하세요')

// ─────────────────────────────────────────────
console.log(head('6. 계정'))
if (!missing.includes('profiles')) {
  const res = await fetch(`${U}/rest/v1/profiles?select=id,role,teacher_id`, { headers: svc })
  const rows = await res.json()
  const teachers = rows.filter((r) => r.role === 'teacher').length
  const students = rows.filter((r) => r.role === 'student')
  const orphan = students.filter((s) => !s.teacher_id).length
  console.log(`  교사 ${teachers}명 · 학생 ${students.length}명`)
  if (teachers === 0) {
    fail('교사 계정이 없습니다 — 로그인할 수 있는 계정이 없습니다',
      'README 의 교사 계정 만들기를 따르거나, npm run db:seed 로 시범 계정을 넣으세요')
  }
  if (orphan > 0) {
    console.log(warn(`teacher_id 가 빈 학생 ${orphan}명 — 교사 화면에 보이지 않습니다`))
    todo.push('해당 학생의 profiles.teacher_id 를 담당 교사 UID 로 채우세요')
  }
}

// ─────────────────────────────────────────────
console.log(head('7. AI 키'))
if (!hasGemini && !hasUpstage) {
  console.log(warn('건너뜀 (키 없음)'))
} else {
  if (hasUpstage) {
    const res = await fetch('https://api.upstage.ai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.UPSTAGE_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'solar-pro3', messages: [{ role: 'user', content: 'ok' }] }),
    })
    if (res.ok) console.log(ok('업스테이지 정상'))
    else console.log(bad(`업스테이지 HTTP ${res.status} — ${(await res.text()).slice(0, 120)}`))
  }
  if (hasGemini) {
    const res = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent',
      {
        method: 'POST',
        headers: { 'x-goog-api-key': env.GEMINI_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: 'ok' }] }] }),
      }
    )
    if (res.ok) console.log(ok('Gemini 정상'))
    else {
      const body = await res.text()
      console.log(warn(`Gemini HTTP ${res.status} — ${body.includes('limit: 0') ? '무료등급 할당량 0' : body.slice(0, 90)}`))
      if (hasUpstage) console.log(`  ${c.dim}업스테이지가 있으니 자동으로 그쪽을 씁니다. AI_PRIMARY=upstage 로 두면 더 빠릅니다.${c.reset}`)
      else todo.push('Gemini 가 막혀 있습니다. UPSTAGE_API_KEY 를 넣거나 개인 Google 계정으로 키를 재발급하세요')
    }
  }
}

// ─────────────────────────────────────────────
console.log(head(problems === 0 ? `${c.green}점검 통과 — 바로 쓸 수 있습니다.${c.reset}` : `${c.red}문제 ${problems}건${c.reset}`))
if (todo.length) {
  console.log('할 일:')
  ;[...new Set(todo)].forEach((t) => console.log(`  → ${t}`))
}
console.log(`\n${c.dim}쪽지 실시간 알림 등록 여부는 REST 로 확인할 수 없습니다. SQL Editor 에서:
  select count(*) from pg_publication_tables
  where pubname='supabase_realtime' and schemaname='public' and tablename='messages';${c.reset}\n`)

process.exit(problems === 0 ? 0 : 1)
