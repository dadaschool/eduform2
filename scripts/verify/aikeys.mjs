// 교사별 AI API 키 권한 검증.
//
//   teacher_ai_keys 는 개인 자격증명이다. 규칙은 한 줄로 —
//   «교사는 자기 행만, 학생과 다른 교사는 아무것도».
//   관리자 예외조차 두지 않는다 (학생 기록과 다르다).
//
//   실제 키 복호화는 service_role 로 도는 라우트만 하므로 여기서는 RLS 만 본다.
import { readFileSync } from 'node:fs'
import pg from 'pg'

const REPO = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
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

console.log('\n[준비] 스키마 적용')
await client.query(`drop schema if exists public cascade; drop schema if exists auth cascade;
  create schema public; grant all on schema public to postgres;`)
try { await client.query('drop publication if exists supabase_realtime') } catch {}
await client.query(readFileSync(`${REPO}/supabase/native/auth-schema.sql`, 'utf8'))
await client.query(readFileSync(`${REPO}/supabase/schema.sql`, 'utf8'))

const MINE  = '00000000-0000-4000-8000-0000000a1001'   // 키를 등록하는 교사
const OTHER = '00000000-0000-4000-8000-0000000a1002'   // 다른 교사
const ADMIN = '00000000-0000-4000-8000-0000000a1003'   // 관리자(겸 교사)
const STU   = '00000000-0000-4000-8000-0000000a1009'   // 학생
const CLS   = '00000000-0000-4000-8000-0000000a10e1'

for (const [id, em] of [[MINE, 'mine@s.kr'], [OTHER, 'other@s.kr'], [ADMIN, 'admin@s.kr'], [STU, 'stu@s.kr']]) {
  await client.query('insert into auth.users (id,email) values ($1,$2)', [id, em])
}
await client.query(`insert into profiles (id,email,name,role) values
  ($1,'mine@s.kr','나','teacher'),
  ($2,'other@s.kr','다른교사','teacher')`, [MINE, OTHER])
await client.query(`insert into profiles (id,email,name,role,is_admin) values ($1,'admin@s.kr','관리자','teacher',true)`, [ADMIN])
await client.query(`insert into classes (id,name,year,teacher_id) values ($1,'1-1',2026,$2)`, [CLS, MINE])
await client.query(`insert into class_teachers (class_id,teacher_id,role) values ($1,$2,'homeroom')`, [CLS, MINE])
await client.query(`insert into profiles (id,email,name,role,class_id,teacher_id) values ($1,'stu@s.kr','학생','student',$2,$3)`, [STU, CLS, MINE])

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
const INS = 'insert into teacher_ai_keys (teacher_id,provider,api_key_enc,hint,priority) values ($1,$2,$3,$4,$5)'

// ─────────────────────────────────────────────
console.log('\n[1] 교사는 자기 키를 등록한다')
ok('내 키 등록 (gemini)', !blocked(await attempt(MINE, INS, [MINE, 'gemini', 'ENC1', 'aaaa', 0])))
ok('내 키 등록 (openai)', !blocked(await attempt(MINE, INS, [MINE, 'openai', 'ENC2', 'bbbb', 1])))
ok('teacher_id 를 남으로 박아 넣기 불가',
  blocked(await attempt(MINE, INS, [OTHER, 'upstage', 'ENC3', 'cccc', 0])))

// 남은 검사를 위해 OTHER 의 키도 심어 둔다 (서비스 권한)
await client.query(INS, [OTHER, 'upstage', 'ENCX', 'xxxx', 0])

// ─────────────────────────────────────────────
console.log('\n[2] 다른 교사의 키는 보이지도 만져지지도 않는다')
check('내 키만 보인다', (await attempt(MINE, 'select provider from teacher_ai_keys order by priority')).data.map(r => r.provider), ['gemini', 'openai'])
check('남의 키는 0행', (await attempt(MINE, 'select * from teacher_ai_keys where teacher_id=$1', [OTHER])).rows, 0)
ok('남의 키 수정 불가', blocked(await attempt(MINE, `update teacher_ai_keys set hint='hack' where teacher_id=$1`, [OTHER])))
ok('남의 키 삭제 불가', blocked(await attempt(MINE, 'delete from teacher_ai_keys where teacher_id=$1', [OTHER])))
check('남의 키는 그대로', (await client.query('select hint from teacher_ai_keys where teacher_id=$1', [OTHER])).rows[0].hint, 'xxxx')

// ─────────────────────────────────────────────
console.log('\n[3] 관리자도 남의 키는 못 본다')
check('관리자 → 남의 키 0행', (await attempt(ADMIN, 'select * from teacher_ai_keys where teacher_id=$1', [MINE])).rows, 0)
check('관리자 → 전체 조회해도 자기 것만', (await attempt(ADMIN, 'select count(*)::int n from teacher_ai_keys')).data[0].n, 0)

// ─────────────────────────────────────────────
console.log('\n[4] 학생은 아무것도')
check('학생 → 조회 0행', (await attempt(STU, 'select * from teacher_ai_keys')).rows, 0)
ok('학생 → 등록 불가', blocked(await attempt(STU, INS, [STU, 'gemini', 'ENCS', 'ssss', 0])))

// ─────────────────────────────────────────────
console.log('\n[5] 폴백 순서(priority)는 저장·조회에서 유지된다')
await attempt(MINE, 'update teacher_ai_keys set priority=0 where provider=$1', ['openai'])
await attempt(MINE, 'update teacher_ai_keys set priority=1 where provider=$1', ['gemini'])
check('바뀐 순서대로 읽힌다',
  (await attempt(MINE, 'select provider from teacher_ai_keys order by priority')).data.map(r => r.provider),
  ['openai', 'gemini'])

// ─────────────────────────────────────────────
console.log('\n[6] updated_at 트리거')
const t1 = (await client.query('select updated_at from teacher_ai_keys where teacher_id=$1 and provider=$2', [MINE, 'gemini'])).rows[0].updated_at
await new Promise(r => setTimeout(r, 10))
await client.query(`update teacher_ai_keys set hint='new4' where teacher_id=$1 and provider=$2`, [MINE, 'gemini'])
const t2 = (await client.query('select updated_at from teacher_ai_keys where teacher_id=$1 and provider=$2', [MINE, 'gemini'])).rows[0].updated_at
ok('update 시 updated_at 갱신', t2 > t1)

// ─────────────────────────────────────────────
console.log(`\n  ${pass} 통과 / ${fail} 실패`)
if (failures.length) console.log(`  실패: ${failures.join(', ')}`)
await client.end()
process.exit(fail === 0 ? 0 : 1)
