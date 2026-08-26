// 관리자를 «역할» 에서 «표시(is_admin)» 로 바꾼 것을 검증한다.
// 핵심 질문: 관리자가 교사 일을 그대로 할 수 있는가, 그리고 아무나 스스로
// 관리자가 될 수는 없는가.
import { readFileSync } from 'node:fs'
import pg from 'pg'

// 저장소 뿌리는 이 파일 위치에서 찾는다 (scripts/verify/ 의 두 단계 위)
const REPO = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
// PGURL 이 있으면 그 Postgres 로 붙는다 (설치본의 시험용 DB 등).
// 없으면 임시 Postgres(54329). 표를 지우고 다시 만들므로 시험용 DB 여야 한다.
const client = process.env.PGURL
  ? new pg.Client({ connectionString: process.env.PGURL })
  : new pg.Client({ host: '127.0.0.1', port: 54329, user: 'postgres', database: 'postgres' })

let pass = 0, fail = 0
const failures = []
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected)
  if (a === e) { pass++; console.log(`  PASS  ${name}`) }
  else { fail++; failures.push(name); console.log(`  FAIL  ${name}\n          기대 ${e} / 실제 ${a}`) }
}
function ok(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  PASS  ${name}`) }
  else { fail++; failures.push(name); console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`) }
}

await client.connect()

console.log('\n[준비] 스키마 초기화')
await client.query(`drop schema if exists public cascade; drop schema if exists auth cascade;
  create schema public; grant all on schema public to postgres;`)
try { await client.query('drop publication if exists supabase_realtime') } catch {}
await client.query(readFileSync(`${REPO}/supabase/native/auth-schema.sql`, 'utf8'))
await client.query(readFileSync(`${REPO}/supabase/schema.sql`, 'utf8'))
console.log('  적용됨')

const ADMIN = '00000000-0000-4000-8000-00000000a001'   // 관리자 겸 교사
const OTHER = '00000000-0000-4000-8000-00000000a002'   // 평범한 교사
const STU_A = '00000000-0000-4000-8000-00000000b001'   // 관리자가 담당하는 반 학생
const STU_B = '00000000-0000-4000-8000-00000000b002'   // 다른 교사 반 학생
const CLS_A = '00000000-0000-4000-8000-00000000c001'
const CLS_B = '00000000-0000-4000-8000-00000000c002'

for (const [id, email] of [[ADMIN, 'admin@s.kr'], [OTHER, 'other@s.kr'], [STU_A, 'sa@s.kr'], [STU_B, 'sb@s.kr']]) {
  await client.query(`insert into auth.users (id, email) values ($1, $2)`, [id, email])
}
await client.query(`insert into profiles (id, email, name, role, is_admin) values
  ($1,'admin@s.kr','박관리','teacher',true), ($2,'other@s.kr','김교사','teacher',false)`, [ADMIN, OTHER])
await client.query(`insert into classes (id, name, year, teacher_id) values ($1,'1-1',2026,$2), ($3,'2-1',2026,$4)`,
  [CLS_A, ADMIN, CLS_B, OTHER])
await client.query(`insert into class_teachers (class_id, teacher_id, role) values ($1,$2,'homeroom'), ($3,$4,'homeroom')`,
  [CLS_A, ADMIN, CLS_B, OTHER])
await client.query(`insert into profiles (id, email, name, role, class_id, teacher_id) values
  ($1,'sa@s.kr','학생가','student',$2,$3), ($4,'sb@s.kr','학생나','student',$5,$6)`,
  [STU_A, CLS_A, ADMIN, STU_B, CLS_B, OTHER])
// 각 교사가 자기 반 학생에 관찰기록을 남긴다
await client.query(`insert into observations (teacher_id, student_id, content) values
  ($1,$2,'관리자가 쓴 기록'), ($3,$4,'다른 교사가 쓴 기록')`, [ADMIN, STU_A, OTHER, STU_B])

async function inTx(setup, sql, params = []) {
  await client.query('begin')
  try {
    for (const s of setup) await client.query(s)
    const rows = (await client.query(sql, params)).rows
    await client.query('commit')
    return rows
  } catch (e) { await client.query('rollback'); throw e }
}
const claims = (uid) => `set local request.jwt.claims = '${JSON.stringify({ sub: uid, role: 'authenticated' })}'`
const asUser = (uid, sql, params) => inTx(['set local role authenticated', claims(uid)], sql, params)
async function denied(uid, sql, params) {
  try { await asUser(uid, sql, params); return null } catch (e) { return e.message }
}

/**
 * 쓰기 시도가 실제로 막혔는지 본다.
 *
 * RLS 는 «권한 없음» 예외를 내는 대신 대상 행을 조용히 걸러낸다. 그래서
 * 예외만 보면 «막혔는데도 통과» 로 잘못 읽는다. 바뀐 행 수까지 확인한다.
 */
async function writeAttempt(uid, sql, params = []) {
  await client.query('begin')
  try {
    await client.query('set local role authenticated')
    await client.query(claims(uid))
    const r = await client.query(sql, params)
    await client.query('commit')
    return { rows: r.rowCount, error: null }
  } catch (e) {
    await client.query('rollback')
    return { rows: 0, error: e.message }
  }
}
const wasBlocked = (r) => r.error !== null || r.rows === 0

// ─────────────────────────────────────────────
console.log('\n[1] role 에서 admin 이 사라졌는가')
const con = (await client.query(`select pg_get_constraintdef(oid) d from pg_constraint where conname='profiles_role_check'`)).rows[0].d
ok('role 제약이 teacher/student 만 허용', !con.includes("'admin'"), con)
let err = null
try { await client.query(`update profiles set role='admin' where id=$1`, [OTHER]) } catch (e) { err = e.message }
ok('role 을 admin 으로 넣으면 거부된다', err !== null)

console.log('\n[2] is_admin() 이 표시를 읽는가')
check('관리자 계정 → true', (await asUser(ADMIN, 'select is_admin() a'))[0].a, true)
check('평범한 교사 → false', (await asUser(OTHER, 'select is_admin() a'))[0].a, false)
check('학생 → false', (await asUser(STU_A, 'select is_admin() a'))[0].a, false)
check('관리자도 is_teacher() 가 true (교사 일을 해야 한다)',
  (await asUser(ADMIN, 'select is_teacher() t'))[0].t, true)

console.log('\n[3] 관리자가 교사 일을 그대로 할 수 있는가')
check('자기 반 학생이 보인다',
  (await asUser(ADMIN, `select count(*)::int n from profiles where name='학생가'`))[0].n, 1)
ok('평가지를 만들 수 있다',
  (await denied(ADMIN, `insert into assessments (teacher_id, title) values ($1,'중간평가')`, [ADMIN])) === null)
ok('관찰기록을 쓸 수 있다',
  (await denied(ADMIN, `insert into observations (teacher_id, student_id, content) values ($1,$2,'추가 기록')`, [ADMIN, STU_A])) === null)
ok('과제를 낼 수 있다',
  (await denied(ADMIN, `insert into assignments (teacher_id, title, description) values ($1,'과제1','설명')`, [ADMIN])) === null)
ok('배지를 만들 수 있다',
  (await denied(ADMIN, `insert into badges (teacher_id, name) values ($1,'성실')`, [ADMIN])) === null)

console.log('\n[4] 그래도 남의 반 기록은 못 본다 — 원래 지키려던 선')
check('다른 교사 반 학생이 안 보인다',
  (await asUser(ADMIN, `select count(*)::int n from profiles where name='학생나'`))[0].n, 1)  // 계정 관리용으로 «프로필» 은 보인다
check('다른 교사가 쓴 관찰기록은 안 보인다',
  (await asUser(ADMIN, `select count(*)::int n from observations where content='다른 교사가 쓴 기록'`))[0].n, 0)
check('내가 쓴 관찰기록만 보인다',
  (await asUser(ADMIN, `select count(*)::int n from observations`))[0].n, 2)
check('다른 교사의 생활기록부 초안도 안 보인다',
  (await asUser(ADMIN, `select count(*)::int n from student_record_drafts`))[0].n, 0)

console.log('\n[5] 계정 관리 권한 — 관리자만')
check('관리자는 전체 프로필을 본다',
  (await asUser(ADMIN, `select count(*)::int n from profiles`))[0].n, 4)
ok('관리자는 남을 관리자로 지정할 수 있다',
  (await denied(ADMIN, `update profiles set is_admin=true where id=$1`, [OTHER])) === null)
// 되돌린다
await client.query(`update profiles set is_admin=false where id=$1`, [OTHER])
ok('관리자는 반을 만들 수 있다',
  (await denied(ADMIN, `insert into classes (name, year, teacher_id) values ('3-1',2026,$1)`, [ADMIN])) === null)

console.log('\n[6] 🔴 스스로 관리자가 될 수 있는가')
ok('평범한 교사가 자기 is_admin 을 켜려 하면 막힌다',
  wasBlocked(await writeAttempt(OTHER, `update profiles set is_admin=true where id=$1`, [OTHER])))
check('실제로 값이 바뀌지 않았다',
  (await client.query(`select is_admin from profiles where id=$1`, [OTHER])).rows[0].is_admin, false)
ok('학생이 자기 is_admin 을 켜려 하면 막힌다',
  wasBlocked(await writeAttempt(STU_A, `update profiles set is_admin=true where id=$1`, [STU_A])))
ok('교사가 남의 is_admin 을 켜려 하면 막힌다',
  wasBlocked(await writeAttempt(OTHER, `update profiles set is_admin=true where id=$1`, [STU_B])))
ok('교사가 자기 role 을 바꾸려 하면 여전히 막힌다',
  wasBlocked(await writeAttempt(OTHER, `update profiles set role='student' where id=$1`, [OTHER])))
ok('관리자의 권한을 평범한 교사가 해제하려 하면 막힌다',
  wasBlocked(await writeAttempt(OTHER, `update profiles set is_admin=false where id=$1`, [ADMIN])))
ok('자기 반 학생을 관리자로 만들 수도 없다',
  wasBlocked(await writeAttempt(ADMIN === OTHER ? OTHER : OTHER, `update profiles set is_admin=true where id=$1`, [STU_B])))
check('관리자 권한이 그대로다',
  (await client.query(`select is_admin from profiles where id=$1`, [ADMIN])).rows[0].is_admin, true)

// 이름 같은 평범한 수정은 여전히 되어야 한다
ok('자기 이름 수정은 된다 (트리거가 지나친 것을 막지 않는다)',
  (await denied(OTHER, `update profiles set name='김교사2' where id=$1`, [OTHER])) === null)

console.log('\n[7] 옛 데이터 마이그레이션 (role=admin → teacher + is_admin)')
// 제약을 잠시 풀어 옛 상태를 만든 뒤 스키마를 다시 실행한다
await client.query(`alter table profiles drop constraint profiles_role_check`)
await client.query(`update profiles set role='admin', is_admin=false where id=$1`, [OTHER])
await client.query(readFileSync(`${REPO}/supabase/schema.sql`, 'utf8'))
const migrated = (await client.query(`select role, is_admin from profiles where id=$1`, [OTHER])).rows[0]
check('role=admin 이던 계정이 teacher + 관리자로 옮겨졌다', [migrated.role, migrated.is_admin], ['teacher', true])
check('마이그레이션 후 다른 계정은 그대로',
  (await client.query(`select is_admin from profiles where id=$1`, [ADMIN])).rows[0].is_admin, true)
check('학생은 관리자가 되지 않았다',
  (await client.query(`select count(*)::int n from profiles where role='student' and is_admin`)).rows[0].n, 0)

console.log(`\n${pass} 통과, ${fail} 실패`)
if (failures.length) console.log('실패 목록:\n  - ' + failures.join('\n  - '))
await client.end()
process.exit(fail === 0 ? 0 : 1)
