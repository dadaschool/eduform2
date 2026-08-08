/**
 * DB 스키마(+선택적으로 샘플 데이터)를 Supabase 에 올린다.
 *
 *   npm run db:setup        스키마만
 *   npm run db:seed         스키마 + 샘플 데이터
 *
 * .env.local 의 SUPABASE_DB_URL 을 쓴다. 이 값이 없으면 실행 대신
 * 대시보드에 붙여넣는 방법을 안내한다. Supabase REST API 로는 테이블 생성이
 * 불가능해서, 자동화에는 Postgres 직접 연결이 필요하다.
 */
import { readFileSync } from 'node:fs'
import { loadEnv, repoPath, c, ok, bad, warn, head } from './_env.mjs'

const withSeed = process.argv.includes('--seed')
const env = loadEnv()
const dbUrl = env.SUPABASE_DB_URL ?? process.env.SUPABASE_DB_URL

function manualInstructions() {
  console.log(head('SUPABASE_DB_URL 이 없어 자동 실행을 건너뜁니다.'))
  console.log(`
${c.bold}방법 A — 대시보드에 붙여넣기 (추가 설정 없이 바로 가능)${c.reset}

  1. Supabase 대시보드 → 왼쪽 ${c.cyan}SQL Editor${c.reset} → ${c.cyan}New query${c.reset}
  2. ${c.cyan}supabase/schema.sql${c.reset} 전체를 복사해 붙여넣고 ${c.cyan}Run${c.reset}
  3. 샘플 데이터도 원하면 ${c.cyan}supabase/seed.sql${c.reset} 로 한 번 더

  두 파일 모두 여러 번 실행해도 안전합니다.

${c.bold}방법 B — 이 명령으로 자동 실행${c.reset}

  1. Supabase 대시보드 → ${c.cyan}Project Settings → Database${c.reset}
  2. ${c.cyan}Connection string${c.reset} 의 ${c.cyan}URI${c.reset} 를 복사
     (비밀번호 자리가 [YOUR-PASSWORD] 로 되어 있으면 실제 값으로 바꾸세요.
      모르면 같은 화면의 Reset database password 로 새로 정할 수 있습니다)
  3. ${c.cyan}.env.local${c.reset} 에 아래 한 줄 추가

     SUPABASE_DB_URL=postgresql://postgres.xxxx:비밀번호@aws-0-....pooler.supabase.com:5432/postgres

  4. 다시 ${c.cyan}npm run db:setup${c.reset}

  ${c.dim}주의: 이 값에는 DB 비밀번호가 들어 있습니다. .gitignore 에 걸려 있어
  깃에 올라가지 않지만, 채팅이나 문서에 붙여넣지 마세요.${c.reset}
`)
}

async function main() {
  if (!dbUrl) {
    manualInstructions()
    process.exit(1)
  }

  let pg
  try {
    pg = (await import('pg')).default
  } catch {
    console.log(bad('pg 패키지가 없습니다. npm install 을 먼저 실행하세요.'))
    process.exit(1)
  }

  const files = [['supabase/schema.sql', '스키마 (테이블·보안정책·함수)']]
  if (withSeed) files.push(['supabase/seed.sql', '샘플 데이터'])

  // Supabase 는 TLS 를 요구하지만 pooler 인증서 체인 검증은 끈다.
  // 자체 서명 체인이라 rejectUnauthorized: true 로는 연결이 실패한다.
  // 로컬(supabase start 등)은 TLS 를 쓰지 않으므로 끈다.
  const isLocal = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(dbUrl)
  const client = new pg.Client({
    connectionString: dbUrl,
    ssl: isLocal ? false : { rejectUnauthorized: false },
  })

  console.log(head('Supabase 에 연결'))
  try {
    await client.connect()
    const { rows } = await client.query('select current_database() db, version() v')
    console.log(ok(`연결됨 — ${rows[0].db} / ${rows[0].v.split(',')[0]}`))
  } catch (e) {
    console.log(bad(`연결 실패: ${e.message}`))
    console.log(`
  ${c.dim}SUPABASE_DB_URL 을 다시 확인하세요. 비밀번호에 @ : / 같은 문자가 있으면
  URL 인코딩이 필요합니다 (@ 는 %40). Project Settings → Database 에서
  Reset database password 로 특수문자 없는 값으로 바꾸는 게 가장 간단합니다.${c.reset}
`)
    process.exit(1)
  }

  let failed = false
  for (const [rel, label] of files) {
    console.log(head(`${label} 적용 — ${rel}`))
    const sql = readFileSync(repoPath(rel), 'utf8')
    try {
      await client.query(sql)
      console.log(ok('적용 완료'))
    } catch (e) {
      failed = true
      console.log(bad(`실패: ${e.message}`))
      if (e.position) console.log(`  ${c.dim}SQL 위치: ${e.position}${c.reset}`)
    }
  }

  // 결과 확인
  console.log(head('결과 확인'))
  const { rows: t } = await client.query(
    `select count(*)::int n from information_schema.tables
     where table_schema = 'public' and table_type = 'BASE TABLE'`
  )
  const { rows: p } = await client.query(
    `select count(*)::int n from pg_policies where schemaname = 'public'`
  )
  // 확장(uuid-ossp, pgcrypto)이 만든 함수는 제외하고 이 앱의 함수만 센다.
  const EXPECTED_FNS = [
    'current_user_teacher_id', 'current_user_class_id', 'is_my_assignment',
    'is_my_assessment_item', 'is_assignment_for_my_class', 'increment_invite_code',
    'update_updated_at',
  ]
  const { rows: f } = await client.query(
    `select count(*)::int n from pg_proc pr
     join pg_namespace ns on ns.oid = pr.pronamespace
     where ns.nspname = 'public' and pr.proname = any($1)`,
    [EXPECTED_FNS]
  )
  console.log(`  테이블 ${t[0].n}개 · 보안정책 ${p[0].n}개 · 함수 ${f[0].n}/${EXPECTED_FNS.length}개`)
  if (t[0].n < 15) console.log(warn('테이블이 15개보다 적습니다. 위 오류를 확인하세요.'))
  if (f[0].n < EXPECTED_FNS.length) console.log(warn('함수가 일부 없습니다. 위 오류를 확인하세요.'))

  await client.end()

  if (failed) process.exit(1)
  console.log(`\n${ok('DB 준비 완료.')} 다음: ${c.cyan}npm run doctor${c.reset} 로 전체 점검\n`)
}

main().catch((e) => {
  console.error(bad(e.message))
  process.exit(1)
})
