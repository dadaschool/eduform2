// 배지·평가 공유 권한 검증.
//
//   공유 = «보여 준다» 뿐이다. 받은 교사는 읽고, 자기 것으로 복사해서 쓴다.
//   원본을 고치거나 지우는 것은 만든 교사뿐이다.
//
//   왜 복사인가 — student_badges.badge_id 가 on delete cascade 라서,
//   원본을 같이 썼다면 만든 교사가 배지를 지우는 순간 다른 교사가 준
//   수여 기록까지 사라진다. 그 시나리오를 [6] 에서 실제로 확인한다.
import { readFileSync } from 'node:fs'
import pg from 'pg'

const REPO = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
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

const OWNER = '00000000-0000-4000-8000-00000000f001'   // 배지·평가를 «만든» 교사
const MATE  = '00000000-0000-4000-8000-00000000f002'   // 공유를 «받는» 교사
const THIRD = '00000000-0000-4000-8000-00000000f003'   // 공유받지 않은 교사
const STU   = '00000000-0000-4000-8000-00000000f009'   // MATE 반의 학생 (OWNER 와 무관)
const CLS   = '00000000-0000-4000-8000-00000000f0e1'

const BADGE = '00000000-0000-4000-8000-00000000fb01'
const ASMT  = '00000000-0000-4000-8000-00000000fa01'
const ITEM  = '00000000-0000-4000-8000-00000000f101'

for (const [id, em] of [[OWNER, 'own@s.kr'], [MATE, 'mate@s.kr'], [THIRD, 'third@s.kr'], [STU, 'stu@s.kr']]) {
  await client.query('insert into auth.users (id,email) values ($1,$2)', [id, em])
}
await client.query(`insert into profiles (id,email,name,role) values
  ($1,'own@s.kr','원본교사','teacher'),
  ($2,'mate@s.kr','동료교사','teacher'),
  ($3,'third@s.kr','제삼교사','teacher')`, [OWNER, MATE, THIRD])
// 학생은 MATE 의 반에 둔다. OWNER 의 배지가 badges_student_select 로 새는지
// 보려면 학생이 OWNER 와 아무 관계가 없어야 한다.
await client.query(`insert into classes (id,name,year,teacher_id) values ($1,'2-5',2026,$2)`, [CLS, MATE])
await client.query(`insert into class_teachers (class_id,teacher_id,role) values ($1,$2,'homeroom')`, [CLS, MATE])
await client.query(`insert into profiles (id,email,name,role,class_id,teacher_id) values
  ($1,'stu@s.kr','학생','student',$2,$3)`, [STU, CLS, MATE])

await client.query(`insert into badges (id,teacher_id,name,icon,criteria) values
  ($1,$2,'독서왕','📚','책 10권')`, [BADGE, OWNER])
await client.query(`insert into assessments (id,teacher_id,title,subject) values
  ($1,$2,'1학기 수행평가','국어')`, [ASMT, OWNER])
await client.query(`insert into assessment_items (id,assessment_id,name,check_type) values
  ($1,$2,'발표 태도','level3')`, [ITEM, ASMT])
await client.query(`insert into assessment_classes (assessment_id,class_id) values ($1,$2)`, [ASMT, CLS])
await client.query(`insert into student_assessment_checks (student_id,assessment_item_id,check_value) values
  ($1,$2,'상')`, [STU, ITEM])

const claims = (uid) => `set local request.jwt.claims = '${JSON.stringify({ sub: uid, role: 'authenticated' })}'`
async function attempt(uid, sql, params = []) {
  await client.query('begin')
  try {
    await client.query('set local role authenticated')
    await client.query(claims(uid))
    const r = await client.query(sql, params)
    await client.query('commit')
    return { rows: r.rowCount, error: null, data: r.rows }
  } catch (e) { await client.query('rollback'); return { rows: 0, error: e.message, data: [] } }
}
const blocked = (r) => r.error !== null || r.rows === 0
const val = async (uid, sql, params) => (await attempt(uid, sql, params)).data[0]
const clearShares = () => client.query('delete from badge_shares; delete from assessment_shares')

// ─────────────────────────────────────────────
console.log('\n[1] 공유하기 전 — 남의 것은 보이지 않는다')
check('동료교사 → 배지 안 보임', (await attempt(MATE, 'select id from badges where id=$1', [BADGE])).rows, 0)
check('동료교사 → 평가 안 보임', (await attempt(MATE, 'select id from assessments where id=$1', [ASMT])).rows, 0)
check('만든 교사 → 자기 배지 보임', (await attempt(OWNER, 'select id from badges where id=$1', [BADGE])).rows, 1)
check('is_shared_badge false', (await val(MATE, 'select is_shared_badge($1) v', [BADGE])).v, false)

// ─────────────────────────────────────────────
console.log('\n[2] 특정 교사에게 공유')
await clearShares()
ok('만든 교사가 공유를 건다',
  !blocked(await attempt(OWNER, 'insert into badge_shares (badge_id,shared_with) values ($1,$2)', [BADGE, MATE])))
check('받은 교사 → 배지 보임', (await attempt(MATE, 'select id from badges where id=$1', [BADGE])).rows, 1)
check('제삼교사 → 여전히 안 보임', (await attempt(THIRD, 'select id from badges where id=$1', [BADGE])).rows, 0)
check('받은 교사 → is_shared_badge true', (await val(MATE, 'select is_shared_badge($1) v', [BADGE])).v, true)
check('제삼교사 → is_shared_badge false', (await val(THIRD, 'select is_shared_badge($1) v', [BADGE])).v, false)
// 수여 기준까지 읽혀야 «가져오기» 가 그대로 복사할 수 있다
check('받은 교사 → 배지 내용까지 읽힌다',
  (await val(MATE, 'select criteria from badges where id=$1', [BADGE]))?.criteria, '책 10권')

// ─────────────────────────────────────────────
console.log('\n[3] 교사 전체 공유')
await clearShares()
ok('전체 공유를 건다',
  !blocked(await attempt(OWNER, 'insert into badge_shares (badge_id,shared_with) values ($1,null)', [BADGE])))
check('동료교사 → 보임', (await attempt(MATE, 'select id from badges where id=$1', [BADGE])).rows, 1)
check('제삼교사 → 보임', (await attempt(THIRD, 'select id from badges where id=$1', [BADGE])).rows, 1)
// «교사 전체 공유» 가 «학생 전체» 가 되면 안 된다. is_teacher() 로 막았는지 본다.
check('학생 → 안 보임', (await attempt(STU, 'select id from badges where id=$1', [BADGE])).rows, 0)
check('학생 → is_shared_badge false', (await val(STU, 'select is_shared_badge($1) v', [BADGE])).v, false)
check('학생 → 공유 목록 자체가 안 보임', (await attempt(STU, 'select id from badge_shares')).rows, 0)
// null 은 SQL 에서 서로 다른 값이라 unique(badge_id, shared_with) 로는 안 막힌다
ok('전체 공유 중복은 막힌다',
  blocked(await attempt(OWNER, 'insert into badge_shares (badge_id,shared_with) values ($1,null)', [BADGE])))

// ─────────────────────────────────────────────
console.log('\n[4] 공유받은 것은 «읽기만»')
await clearShares()
await client.query('insert into badge_shares (badge_id,shared_with) values ($1,$2)', [BADGE, MATE])
await client.query('insert into assessment_shares (assessment_id,shared_with) values ($1,$2)', [ASMT, MATE])
ok('배지 이름 수정 불가',
  blocked(await attempt(MATE, `update badges set name='내가 바꿈' where id=$1`, [BADGE])))
ok('배지 삭제 불가', blocked(await attempt(MATE, 'delete from badges where id=$1', [BADGE])))
ok('평가 수정 불가', blocked(await attempt(MATE, `update assessments set title='x' where id=$1`, [ASMT])))
ok('평가 삭제 불가', blocked(await attempt(MATE, 'delete from assessments where id=$1', [ASMT])))
ok('평가 항목 수정 불가', blocked(await attempt(MATE, `update assessment_items set name='x' where id=$1`, [ITEM])))
ok('남의 평가에 항목 끼워넣기 불가',
  blocked(await attempt(MATE, `insert into assessment_items (assessment_id,name) values ($1,'몰래')`, [ASMT])))
// 0행이 «막혔다» 인지 확실히 하려고 값을 직접 확인한다
check('배지 이름 그대로', (await val(OWNER, 'select name from badges where id=$1', [BADGE])).name, '독서왕')

// ─────────────────────────────────────────────
console.log('\n[5] 평가는 «항목» 까지만 열린다')
check('받은 교사 → 평가 항목 보임',
  (await attempt(MATE, 'select id from assessment_items where assessment_id=$1', [ASMT])).rows, 1)
// 어느 반에 냈고 어느 학생이 몇 점인지는 공유 대상이 아니다.
// MATE 는 CLS 의 담임이라 반 쪽으로는 볼 수 있는 상태다 — 그래도 새면 안 된다.
check('반 배포 내역은 안 보임',
  (await attempt(MATE, 'select class_id from assessment_classes where assessment_id=$1', [ASMT])).rows, 0)
check('학생 채점 결과는 안 보임',
  (await attempt(MATE, 'select id from student_assessment_checks where assessment_item_id=$1', [ITEM])).rows, 0)
check('제삼교사 → 평가 항목 안 보임',
  (await attempt(THIRD, 'select id from assessment_items where assessment_id=$1', [ASMT])).rows, 0)

// ─────────────────────────────────────────────
console.log('\n[6] 가져오기 = 내 소유의 사본')
const COPY = '00000000-0000-4000-8000-00000000fb02'
ok('받은 교사가 자기 배지로 복사',
  !blocked(await attempt(MATE,
    `insert into badges (id,teacher_id,name,icon,criteria,copied_from)
     select $1,$2,name,icon,criteria,id from badges where id=$3`, [COPY, MATE, BADGE])))
check('사본은 내 것', (await val(MATE, 'select teacher_id from badges where id=$1', [COPY])).teacher_id, MATE)
// 사본으로 학생에게 수여해 둔다. 원본이 지워질 때 이 기록이 살아남아야 한다.
await client.query('insert into student_badges (student_id,badge_id,awarded_by) values ($1,$2,$3)', [STU, COPY, MATE])
await client.query('delete from badges where id=$1', [BADGE])   // 만든 교사가 원본을 지운다
check('원본이 지워져도 사본은 남는다',
  (await client.query('select count(*)::int n from badges where id=$1', [COPY])).rows[0].n, 1)
check('사본으로 준 수여 기록도 남는다',
  (await client.query('select count(*)::int n from student_badges where badge_id=$1', [COPY])).rows[0].n, 1)
check('copied_from 은 null 로 풀린다',
  (await client.query('select copied_from from badges where id=$1', [COPY])).rows[0].copied_from, null)

// ─────────────────────────────────────────────
console.log('\n[7] 남의 것을 공유할 수는 없다')
const B2 = '00000000-0000-4000-8000-00000000fb03'
await client.query(`insert into badges (id,teacher_id,name) values ($1,$2,'성실상')`, [B2, OWNER])
ok('동료교사가 남의 배지를 공유 불가',
  blocked(await attempt(MATE, 'insert into badge_shares (badge_id,shared_with) values ($1,$2)', [B2, THIRD])))
ok('동료교사가 남의 배지를 전체공유 불가',
  blocked(await attempt(MATE, 'insert into badge_shares (badge_id,shared_with) values ($1,null)', [B2])))
await client.query('insert into badge_shares (badge_id,shared_with) values ($1,$2)', [B2, MATE])
ok('받은 교사가 공유를 풀 수 없다',
  blocked(await attempt(MATE, 'delete from badge_shares where badge_id=$1', [B2])))
ok('만든 교사는 공유를 풀 수 있다',
  !blocked(await attempt(OWNER, 'delete from badge_shares where badge_id=$1', [B2])))
ok('중복 공유는 막힌다', await (async () => {
  await attempt(OWNER, 'insert into badge_shares (badge_id,shared_with) values ($1,$2)', [B2, MATE])
  return blocked(await attempt(OWNER, 'insert into badge_shares (badge_id,shared_with) values ($1,$2)', [B2, MATE]))
})())

// ─────────────────────────────────────────────
console.log('\n[8] 교사끼리는 서로 보인다 (공유 대상 고르기)')
check('동료교사 → 다른 교사 이름 보임',
  (await val(MATE, 'select name from profiles where id=$1', [OWNER]))?.name, '원본교사')
check('학생 → 다른 교사는 못 봄',
  (await attempt(STU, `select id from profiles where role='teacher' and id=$1`, [THIRD])).rows, 0)
// 교사가 서로 보인다고 해서 남의 학생까지 보이면 안 된다
check('교사 → 남의 반 학생은 여전히 안 보임',
  (await attempt(THIRD, 'select id from profiles where id=$1', [STU])).rows, 0)

// ─────────────────────────────────────────────
console.log(`\n  ${pass} 통과 / ${fail} 실패`)
if (failures.length) console.log(`  실패: ${failures.join(', ')}`)
await client.end()
process.exit(fail === 0 ? 0 : 1)
