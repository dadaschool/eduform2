// 담임 배정 권한 검증.
//
//   담임 배정·해제 : 관리자 + «그 반을 만든 교사» 만
//   교과 담당      : 교사가 스스로 (조회 권한만 늘어난다)
//   반을 만든 교사 : 그 반 학생 수정·삭제도 가능
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

const ADMIN = '00000000-0000-4000-8000-0000000000d1'   // 관리자 겸 교사
const OWNER = '00000000-0000-4000-8000-0000000000d2'   // 반을 «만든» 교사
const OTHER = '00000000-0000-4000-8000-0000000000d3'   // 그냥 교사
const STU   = '00000000-0000-4000-8000-0000000000d9'
const CLS   = '00000000-0000-4000-8000-0000000000e1'   // OWNER 가 만든 반
const CLS2  = '00000000-0000-4000-8000-0000000000e2'   // 관리자가 만든 반

for (const [id, em] of [[ADMIN,'ad@s.kr'],[OWNER,'ow@s.kr'],[OTHER,'ot@s.kr'],[STU,'st@s.kr']]) {
  await client.query('insert into auth.users (id,email) values ($1,$2)', [id, em])
}
await client.query(`insert into profiles (id,email,name,role,is_admin) values
  ($1,'ad@s.kr','관리자','teacher',true),
  ($2,'ow@s.kr','반주인','teacher',false),
  ($3,'ot@s.kr','다른교사','teacher',false)`, [ADMIN, OWNER, OTHER])
await client.query(`insert into classes (id,name,year,teacher_id) values ($1,'3-1',2026,$2)`, [CLS, OWNER])
await client.query(`insert into classes (id,name,year,teacher_id) values ($1,'3-2',2026,$2)`, [CLS2, ADMIN])
await client.query(`insert into profiles (id,email,name,role,class_id) values ($1,'st@s.kr','학생','student',$2)`,
  [STU, CLS])

const claims = (uid) => `set local request.jwt.claims = '${JSON.stringify({ sub: uid, role: 'authenticated' })}'`
async function attempt(uid, sql, params = []) {
  await client.query('begin')
  try {
    await client.query('set local role authenticated')
    await client.query(claims(uid))
    const r = await client.query(sql, params)
    await client.query('commit')
    return { rows: r.rowCount, error: null }
  } catch (e) { await client.query('rollback'); return { rows: 0, error: e.message } }
}
const blocked = (r) => r.error !== null || r.rows === 0
const clearAssigns = () => client.query('delete from class_teachers')

// ─────────────────────────────────────────────
console.log('\n[1] 새 헬퍼')
async function val(uid, sql, params) {
  await client.query('begin')
  try {
    await client.query('set local role authenticated'); await client.query(claims(uid))
    const r = await client.query(sql, params); await client.query('commit'); return r.rows[0]
  } catch (e) { await client.query('rollback'); throw e }
}
check('반 주인 → is_class_owner true',  (await val(OWNER, 'select is_class_owner($1) v', [CLS])).v, true)
check('다른 교사 → false',              (await val(OTHER, 'select is_class_owner($1) v', [CLS])).v, false)
check('관리자도 남의 반은 owner 아님',   (await val(ADMIN, 'select is_class_owner($1) v', [CLS])).v, false)
check('반 주인 → is_my_owned_student true', (await val(OWNER, 'select is_my_owned_student($1) v', [STU])).v, true)
check('다른 교사 → false',              (await val(OTHER, 'select is_my_owned_student($1) v', [STU])).v, false)

console.log('\n[2] 🔴 교사가 스스로 담임이 될 수 있는가')
ok('다른 교사는 남의 반 담임이 못 된다', blocked(await attempt(OTHER,
  `insert into class_teachers (class_id,teacher_id,role) values ($1,$2,'homeroom')`, [CLS, OTHER])))
ok('관리자가 만든 반도 마찬가지', blocked(await attempt(OTHER,
  `insert into class_teachers (class_id,teacher_id,role) values ($1,$2,'homeroom')`, [CLS2, OTHER])))
check('배정이 하나도 안 생겼다',
  (await client.query('select count(*)::int n from class_teachers')).rows[0].n, 0)

console.log('\n[3] 교과 담당은 스스로 고른다')
ok('다른 교사가 교과 담당으로 등록', !blocked(await attempt(OTHER,
  `insert into class_teachers (class_id,teacher_id,role) values ($1,$2,'subject')`, [CLS, OTHER])))
ok('자기 교과 담당은 스스로 해제', !blocked(await attempt(OTHER,
  `delete from class_teachers where class_id=$1 and teacher_id=$2`, [CLS, OTHER])))

console.log('\n[4] 담임을 정할 수 있는 사람')
ok('반을 만든 교사는 자기 반 담임이 된다', !blocked(await attempt(OWNER,
  `insert into class_teachers (class_id,teacher_id,role) values ($1,$2,'homeroom')`, [CLS, OWNER])))
ok('반을 만든 교사는 «남» 을 담임으로 지정할 수도 있다', !blocked(await attempt(OWNER,
  `insert into class_teachers (class_id,teacher_id,role) values ($1,$2,'homeroom')`, [CLS, OTHER])))
await clearAssigns()
ok('관리자는 아무 반의 담임을 지정한다', !blocked(await attempt(ADMIN,
  `insert into class_teachers (class_id,teacher_id,role) values ($1,$2,'homeroom')`, [CLS, OTHER])))

console.log('\n[5] 🔴 남이 맡은 담임을 뗄 수 있는가')
ok('무관한 교사는 못 뗀다', blocked(await attempt(OWNER === OTHER ? ADMIN : OTHER,
  `delete from class_teachers where class_id=$1 and teacher_id=$2`, [CLS, OTHER])) === false
  ? false : true)   // OTHER 는 «자기 배정» 이지만 role 이 homeroom 이라 못 뗀다
check('담임 배정이 남아 있다',
  (await client.query(`select count(*)::int n from class_teachers where role='homeroom'`)).rows[0].n, 1)
ok('반을 만든 교사는 뗄 수 있다', !blocked(await attempt(OWNER,
  `delete from class_teachers where class_id=$1 and teacher_id=$2`, [CLS, OTHER])))
await client.query(`insert into class_teachers (class_id,teacher_id,role) values ($1,$2,'homeroom')`, [CLS, OTHER])
ok('관리자는 뗄 수 있다', !blocked(await attempt(ADMIN,
  `delete from class_teachers where class_id=$1 and teacher_id=$2`, [CLS, OTHER])))

console.log('\n[6] 반 주인은 그 반 학생을 다룬다')
await clearAssigns()

// 막히면 «왜» 막혔는지 남긴다. 0행(정책이 걸러냄)과 오류(권한·트리거)는
// 원인이 전혀 다른데, 이유를 안 적어두면 구분할 수 없다.
async function show(label, uid, sql, params) {
  const r = await attempt(uid, sql, params)
  const why = r.error ? `오류: ${r.error}` : `바뀐 행 ${r.rows}`
  ok(label, !blocked(r), why)
  return r
}

// 상태를 먼저 찍어 둔다 — 뭘 잘못 짚고 있는지 바로 보인다
{
  const d = (await client.query(
    `select p.class_id as 학생반, c.teacher_id as 반주인, p.teacher_id as 담당교사
     from profiles p left join classes c on c.id = p.class_id where p.id = $1`, [STU])).rows[0]
  console.log(`  · 학생의 반 = ${d?.학생반}`)
  console.log(`  · 그 반을 만든 사람 = ${d?.반주인}   (OWNER = ${OWNER})`)
  console.log(`  · 학생의 담당 교사 = ${d?.담당교사}`)
  const f = await val(OWNER, 'select is_my_owned_student($1) owned, is_class_owner($2) owner, auth.uid() uid',
                      [STU, CLS])
  console.log(`  · OWNER 로서 is_my_owned_student = ${f.owned}, is_class_owner = ${f.owner}, auth.uid() = ${f.uid}`)
  const pol = (await client.query(
    `select cmd, qual, with_check from pg_policies where tablename='profiles' and policyname in ('profiles_update','profiles_delete') order by cmd`)).rows
  for (const q of pol) console.log(`  · 정책 ${q.cmd}: ${String(q.qual).replace(/\s+/g,' ').slice(0,150)}`)
}

// ⚠ 수정·삭제 전에 «조회» 가 되는지 먼저 본다.
//    PostgreSQL 은 where 절이 있는 update/delete 에 select 정책도 함께 적용한다.
//    조회에서 걸리면 수정 정책이 통과해도 결과가 «0행» 이 되어, 원인을 엉뚱한
//    곳에서 찾게 된다. 실제로 이 함정에 빠졌다.
check('반 주인에게 그 반 학생이 «보인다» (조회 정책)',
  (await val(OWNER, `select count(*)::int n from profiles where id=$1`, [STU])).n, 1)

await show('반 주인은 학생 이름을 고친다', OWNER, `update profiles set name='고침' where id=$1`, [STU])
await show('반 주인은 학생을 지운다', OWNER, `delete from profiles where id=$1`, [STU])

// 지워졌는지 확인한 뒤 되살린다. 안 지워졌으면 중복 키로 터진다.
const left = (await client.query('select count(*)::int n from profiles where id=$1', [STU])).rows[0].n
if (left === 0) {
  await client.query(`insert into profiles (id,email,name,role,class_id) values ($1,'st@s.kr','학생','student',$2)`,
    [STU, CLS])
} else {
  await client.query(`update profiles set name='학생' where id=$1`, [STU])
}

// 교과 담당으로 붙은 다른 교사는 여전히 못 고친다
await client.query(`insert into class_teachers (class_id,teacher_id,role) values ($1,$2,'subject')
  on conflict (class_id,teacher_id) do update set role='subject'`, [CLS, OTHER])
ok('🔴 교과 담당은 여전히 못 고친다', blocked(await attempt(OTHER,
  `update profiles set name='교과가고침' where id=$1`, [STU])))
ok('🔴 교과 담당은 여전히 못 지운다', blocked(await attempt(OTHER,
  `delete from profiles where id=$1`, [STU])))
check('학생 이름이 그대로다',
  (await client.query('select name from profiles where id=$1', [STU])).rows[0].name, '학생')

console.log(`\n${pass} 통과, ${fail} 실패`)
if (failures.length) console.log('실패 목록:\n  - ' + failures.join('\n  - '))
await client.end()
process.exit(fail === 0 ? 0 : 1)
