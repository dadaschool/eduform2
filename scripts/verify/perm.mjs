// 담임 / 교과 담당 / 관리자 권한 구분 검증.
//
//   담당과목 교사 : 담당반 학생 «조회» + 비밀번호 초기화(API)
//   담임 교사     : 담임반 학생 조회 · 반배정 수정 · 비밀번호 초기화 · 삭제
//   관리자        : 모든 학생 위 전부
//
// 비밀번호 초기화는 서버 라우트가 하므로 여기서는 DB 권한만 본다.
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
function ok(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  PASS  ${name}`) }
  else { fail++; failures.push(name); console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`) }
}
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected)
  if (a === e) { pass++; console.log(`  PASS  ${name}`) }
  else { fail++; failures.push(name); console.log(`  FAIL  ${name}\n          기대 ${e} / 실제 ${a}`) }
}

await client.connect()

console.log('\n[준비] 스키마 적용')
await client.query(`drop schema if exists public cascade; drop schema if exists auth cascade;
  create schema public; grant all on schema public to postgres;`)
try { await client.query('drop publication if exists supabase_realtime') } catch {}
await client.query(readFileSync(`${REPO}/supabase/native/auth-schema.sql`, 'utf8'))
await client.query(readFileSync(`${REPO}/supabase/schema.sql`, 'utf8'))

const ADMIN = '00000000-0000-4000-8000-0000000000a1'   // 관리자 겸 교사
const HOME  = '00000000-0000-4000-8000-0000000000a2'   // 1-1 담임
const SUBJ  = '00000000-0000-4000-8000-0000000000a3'   // 1-1 교과 담당
const OUT   = '00000000-0000-4000-8000-0000000000a4'   // 무관한 교사
const STU   = '00000000-0000-4000-8000-0000000000b1'   // 1-1 학생
const CLS1  = '00000000-0000-4000-8000-0000000000c1'   // 1-1
const CLS2  = '00000000-0000-4000-8000-0000000000c2'   // 1-2

for (const [id, em] of [[ADMIN,'admin@s.kr'],[HOME,'home@s.kr'],[SUBJ,'subj@s.kr'],[OUT,'out@s.kr'],[STU,'stu@s.kr']]) {
  await client.query('insert into auth.users (id, email) values ($1,$2)', [id, em])
}
await client.query(`insert into profiles (id, email, name, role, is_admin) values
  ($1,'admin@s.kr','관리자','teacher',true),
  ($2,'home@s.kr','담임','teacher',false),
  ($3,'subj@s.kr','교과','teacher',false),
  ($4,'out@s.kr','무관','teacher',false)`, [ADMIN, HOME, SUBJ, OUT])
await client.query(`insert into classes (id,name,year,teacher_id) values ($1,'1-1',2026,$2),($3,'1-2',2026,$2)`,
  [CLS1, HOME, CLS2])
await client.query(`insert into class_teachers (class_id,teacher_id,role) values
  ($1,$2,'homeroom'), ($1,$3,'subject')`, [CLS1, HOME, SUBJ])
await client.query(`insert into profiles (id,email,name,role,class_id,teacher_id) values
  ($1,'stu@s.kr','학생','student',$2,$3)`, [STU, CLS1, HOME])

const claims = (uid) => `set local request.jwt.claims = '${JSON.stringify({ sub: uid, role: 'authenticated' })}'`

async function asUser(uid, sql, params = []) {
  await client.query('begin')
  try {
    await client.query('set local role authenticated')
    await client.query(claims(uid))
    const r = await client.query(sql, params)
    await client.query('commit')
    return { rows: r.rows, count: r.rowCount, error: null }
  } catch (e) { await client.query('rollback'); return { rows: [], count: 0, error: e.message } }
}
/** 쓰기가 막혔는가. RLS 는 예외 대신 행을 걸러내므로 바뀐 행 수까지 본다. */
const blocked = (r) => r.error !== null || r.count === 0
const reset = () => client.query(
  `update profiles set class_id=$2, name='학생' where id=$1`, [STU, CLS1])

// ─────────────────────────────────────────────
console.log('\n[1] 헬퍼 함수')
check('담임 → is_my_homeroom_student true',
  (await asUser(HOME, 'select is_my_homeroom_student($1) v', [STU])).rows[0].v, true)
check('교과 담당 → is_my_homeroom_student false',
  (await asUser(SUBJ, 'select is_my_homeroom_student($1) v', [STU])).rows[0].v, false)
check('교과 담당도 is_my_student 는 true (조회는 된다)',
  (await asUser(SUBJ, 'select is_my_student($1) v', [STU])).rows[0].v, true)
check('무관한 교사 → 둘 다 false',
  (await asUser(OUT, 'select is_my_student($1) a, is_my_homeroom_student($1) b', [STU])).rows[0], { a: false, b: false })

console.log('\n[2] 조회 — 담당반 학생이 보이는가')
check('담임에게 보인다', (await asUser(HOME, `select count(*)::int n from profiles where role='student'`)).rows[0].n, 1)
check('교과 담당에게도 보인다', (await asUser(SUBJ, `select count(*)::int n from profiles where role='student'`)).rows[0].n, 1)
check('무관한 교사에게는 안 보인다', (await asUser(OUT, `select count(*)::int n from profiles where role='student'`)).rows[0].n, 0)
check('관리자에게 보인다', (await asUser(ADMIN, `select count(*)::int n from profiles where role='student'`)).rows[0].n, 1)

console.log('\n[3] 이름 수정')
ok('담임은 고칠 수 있다',
  !blocked(await asUser(HOME, `update profiles set name='고침' where id=$1`, [STU])))
await reset()
ok('🔴 교과 담당은 못 고친다',
  blocked(await asUser(SUBJ, `update profiles set name='교과가고침' where id=$1`, [STU])))
check('값이 그대로다', (await client.query('select name from profiles where id=$1', [STU])).rows[0].name, '학생')
ok('무관한 교사는 못 고친다',
  blocked(await asUser(OUT, `update profiles set name='남이고침' where id=$1`, [STU])))
ok('관리자는 고칠 수 있다',
  !blocked(await asUser(ADMIN, `update profiles set name='관리자고침' where id=$1`, [STU])))
await reset()

console.log('\n[4] 반배정 수정 — 담임과 관리자만')
const moved = await asUser(HOME, `update profiles set class_id=$2 where id=$1`, [STU, CLS2])
ok('담임은 다른 반으로 옮길 수 있다', !blocked(moved), moved.error ?? `${moved.count}행`)
check('실제로 옮겨졌다',
  (await client.query('select class_id from profiles where id=$1', [STU])).rows[0].class_id, CLS2)
await reset()
ok('🔴 교과 담당은 반을 못 옮긴다',
  blocked(await asUser(SUBJ, `update profiles set class_id=$2 where id=$1`, [STU, CLS2])))
check('반이 그대로다',
  (await client.query('select class_id from profiles where id=$1', [STU])).rows[0].class_id, CLS1)
ok('관리자는 옮길 수 있다',
  !blocked(await asUser(ADMIN, `update profiles set class_id=$2 where id=$1`, [STU, CLS2])))
await reset()

console.log('\n[5] 삭제 — 담임과 관리자만')
ok('🔴 교과 담당은 못 지운다', blocked(await asUser(SUBJ, `delete from profiles where id=$1`, [STU])))
ok('무관한 교사는 못 지운다', blocked(await asUser(OUT, `delete from profiles where id=$1`, [STU])))
check('학생이 남아 있다', (await client.query('select count(*)::int n from profiles where id=$1', [STU])).rows[0].n, 1)
ok('담임은 지울 수 있다', !blocked(await asUser(HOME, `delete from profiles where id=$1`, [STU])))
// 되살려서 관리자도 확인
await client.query(`insert into profiles (id,email,name,role,class_id,teacher_id) values
  ($1,'stu@s.kr','학생','student',$2,$3)`, [STU, CLS1, HOME])
ok('관리자는 지울 수 있다', !blocked(await asUser(ADMIN, `delete from profiles where id=$1`, [STU])))
await client.query(`insert into profiles (id,email,name,role,class_id,teacher_id) values
  ($1,'stu@s.kr','학생','student',$2,$3)`, [STU, CLS1, HOME])

console.log('\n[6] 교사끼리 — 남의 계정을 건드릴 수 있는가')
ok('교사는 다른 교사 프로필을 못 고친다',
  blocked(await asUser(SUBJ, `update profiles set name='탈취' where id=$1`, [HOME])))
ok('교사는 관리자 프로필을 못 고친다',
  blocked(await asUser(HOME, `update profiles set name='탈취' where id=$1`, [ADMIN])))
ok('교사는 다른 교사를 못 지운다',
  blocked(await asUser(SUBJ, `delete from profiles where id=$1`, [HOME])))
ok('교사는 관리자를 못 지운다',
  blocked(await asUser(HOME, `delete from profiles where id=$1`, [ADMIN])))
check('관리자 이름이 그대로다',
  (await client.query('select name from profiles where id=$1', [ADMIN])).rows[0].name, '관리자')
ok('본인 이름은 고칠 수 있다',
  !blocked(await asUser(SUBJ, `update profiles set name='교과2' where id=$1`, [SUBJ])))

console.log('\n[7] 반 배정 전 학생 (class_id 없음)')
const ORPHAN = '00000000-0000-4000-8000-0000000000b2'
await client.query('insert into auth.users (id,email) values ($1,$2)', [ORPHAN, 'orph@s.kr'])
await client.query(`insert into profiles (id,email,name,role,teacher_id) values ($1,'orph@s.kr','미배정','student',$2)`,
  [ORPHAN, HOME])
ok('만든 교사는 고칠 수 있다',
  !blocked(await asUser(HOME, `update profiles set name='미배정2' where id=$1`, [ORPHAN])))
ok('다른 교사는 못 고친다',
  blocked(await asUser(SUBJ, `update profiles set name='남이고침' where id=$1`, [ORPHAN])))

console.log(`\n${pass} 통과, ${fail} 실패`)
if (failures.length) console.log('실패 목록:\n  - ' + failures.join('\n  - '))
await client.end()
process.exit(fail === 0 ? 0 : 1)
