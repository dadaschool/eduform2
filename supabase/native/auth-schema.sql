-- ============================================================
--  auth 스키마 — GoTrue 를 대신한다 (윈도우 네이티브 설치용)
-- ============================================================
--
--  왜 이 파일이 있는가
--    Supabase 의 로그인 서버(GoTrue)는 윈도우 빌드를 배포하지 않는다
--    (v2.196.0 기준 리눅스·macOS 뿐). 그래서 로그인에 필요한 최소한을
--    Postgres 안에 직접 만들고, HTTP 껍데기는 Next.js 의 /auth/v1/* 이
--    담당한다. 데이터 API 는 PostgREST 윈도우 바이너리를 그대로 쓴다.
--
--  실행 순서
--    1) 이 파일          ← schema.sql 이 auth.users 를 참조하므로 먼저
--    2) supabase/schema.sql
--    3) (선택) supabase/seed.sql
--
--  여러 번 실행해도 안전하다.
-- ============================================================

create extension if not exists pgcrypto;

create schema if not exists auth;
create schema if not exists extensions;

-- ------------------------------------------------------------
--  역할
-- ------------------------------------------------------------
--  PostgREST 는 authenticator 로 접속한 뒤, JWT 의 role 클레임을 보고
--  anon / authenticated / service_role 로 갈아탄다. 그래서 authenticator
--  자체에는 아무 권한도 주지 않는다.
do $$ begin create role anon nologin noinherit; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin noinherit; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin noinherit bypassrls; exception when duplicate_object then null; end $$;
do $$ begin create role authenticator noinherit login; exception when duplicate_object then null; end $$;

grant anon, authenticated, service_role to authenticator;

-- ------------------------------------------------------------
--  사용자
-- ------------------------------------------------------------
--  컬럼 이름은 Supabase 와 맞춘다. /auth/v1/* 가 이 행을 그대로 JSON 으로
--  바꿔 내보내고, 클라이언트 라이브러리가 그 모양을 기대한다.
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  aud varchar(255) default 'authenticated',
  role varchar(255) default 'authenticated',
  email varchar(255) unique,
  encrypted_password varchar(255),
  email_confirmed_at timestamptz,
  last_sign_in_at timestamptz,
  raw_app_meta_data jsonb default '{"provider":"email","providers":["email"]}'::jsonb,
  raw_user_meta_data jsonb default '{}'::jsonb,
  banned_until timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ------------------------------------------------------------
--  갱신 토큰
-- ------------------------------------------------------------
--  토큰 원문을 저장하지 않는다. DB 를 열어 본 사람이 남의 세션을 그대로
--  쓸 수 있으면 안 된다. sha256 해시만 두고 대조한다.
--
--  parent 는 회전 이력이다. 이미 쓴 토큰이 다시 들어오면(탈취 정황)
--  그 계정의 토큰을 전부 버리기 위해 남긴다.
create table if not exists auth.refresh_tokens (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  token_hash text not null unique,
  parent text,
  revoked boolean not null default false,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists refresh_tokens_user_idx on auth.refresh_tokens(user_id);

-- ------------------------------------------------------------
--  RLS 정책이 쓰는 함수
-- ------------------------------------------------------------
--  PostgREST 9 이상은 JWT 클레임을 request.jwt.claims 한 덩이(JSON)로 넣는다.
--  옛 형식(request.jwt.claim.sub)도 함께 본다 — 테스트 하네스가 그쪽을 쓴다.
create or replace function auth.uid() returns uuid
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  )::uuid
$$;

create or replace function auth.role() returns text
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
  )
$$;

create or replace function auth.email() returns text
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.email', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email'
  )
$$;

-- ------------------------------------------------------------
--  로그인 처리 함수
-- ------------------------------------------------------------
--  비밀번호는 Postgres 안에서만 다룬다(pgcrypto bcrypt). 해시가 앱 쪽으로
--  나가지 않고, 대조도 DB 안에서 끝난다.

/** 이메일을 저장 형식으로 맞춘다. 대소문자·공백 때문에 로그인이 안 되는 일을 막는다. */
create or replace function auth.norm_email(p_email text) returns text
language sql immutable as $$ select lower(btrim(p_email)) $$;

/** 비밀번호가 맞으면 그 사용자 행을, 틀리면 0행을 준다. */
create or replace function auth.verify_password(p_email text, p_password text)
returns setof auth.users
language sql security definer set search_path = auth, public, extensions as $$
  select * from auth.users
  where email = auth.norm_email(p_email)
    and encrypted_password is not null
    and encrypted_password = crypt(p_password, encrypted_password)
    and (banned_until is null or banned_until < now())
$$;

/** 사용자 생성. 이미 있으면 예외를 던진다 (부르는 쪽이 409 로 바꾼다). */
create or replace function auth.create_user(
  p_email text, p_password text, p_confirm boolean default true, p_meta jsonb default '{}'::jsonb
) returns auth.users
language plpgsql security definer set search_path = auth, public, extensions as $$
declare v auth.users;
begin
  insert into auth.users (email, encrypted_password, email_confirmed_at, raw_user_meta_data)
  values (
    auth.norm_email(p_email),
    crypt(p_password, gen_salt('bf', 12)),
    case when p_confirm then now() else null end,
    coalesce(p_meta, '{}'::jsonb)
  )
  returning * into v;
  return v;
end $$;

create or replace function auth.set_password(p_id uuid, p_password text) returns auth.users
language plpgsql security definer set search_path = auth, public, extensions as $$
declare v auth.users;
begin
  update auth.users
     set encrypted_password = crypt(p_password, gen_salt('bf', 12)), updated_at = now()
   where id = p_id
  returning * into v;
  -- 비밀번호가 바뀌면 기존 세션을 모두 끊는다. 유출된 뒤 바꾸는 경우가 있다.
  update auth.refresh_tokens set revoked = true where user_id = p_id and not revoked;
  return v;
end $$;

create or replace function auth.set_email(p_id uuid, p_email text) returns auth.users
language plpgsql security definer set search_path = auth, public, extensions as $$
declare v auth.users;
begin
  update auth.users set email = auth.norm_email(p_email), updated_at = now()
   where id = p_id returning * into v;
  return v;
end $$;

create or replace function auth.touch_sign_in(p_id uuid) returns void
language sql security definer set search_path = auth, public as $$
  update auth.users set last_sign_in_at = now() where id = p_id
$$;

-- ------------------------------------------------------------
--  갱신 토큰 처리
-- ------------------------------------------------------------
--  토큰 원문은 부르는 쪽(Next.js)이 만든다. 여기서는 해시만 받는다.
--  DB 에 원문이 한 번도 들어오지 않게 하려는 것이다.

create or replace function auth.store_refresh_token(
  p_user uuid, p_hash text, p_days int default 30, p_parent text default null
) returns void
language sql security definer set search_path = auth, public as $$
  insert into auth.refresh_tokens (user_id, token_hash, parent, expires_at)
  values (p_user, p_hash, p_parent, now() + make_interval(days => p_days))
$$;

/**
 * 갱신 토큰을 한 번 쓴다.
 *
 * 반환하는 status 로 부르는 쪽이 판단한다.
 *   ok      정상 — user_id 로 새 토큰을 발급한다
 *   reused  이미 쓴 토큰이 또 왔다 → 탈취 정황이라 그 계정 토큰을 전부 버렸다
 *   expired 기한이 지났다
 *   none    없는 토큰이다
 */
create or replace function auth.use_refresh_token(p_hash text)
returns table (status text, user_id uuid)
language plpgsql security definer set search_path = auth, public as $$
declare r auth.refresh_tokens;
begin
  select * into r from auth.refresh_tokens where token_hash = p_hash;

  if r.id is null then
    return query select 'none'::text, null::uuid; return;
  end if;

  if r.revoked then
    update auth.refresh_tokens set revoked = true where auth.refresh_tokens.user_id = r.user_id;
    return query select 'reused'::text, r.user_id; return;
  end if;

  if r.expires_at < now() then
    return query select 'expired'::text, r.user_id; return;
  end if;

  update auth.refresh_tokens set revoked = true where id = r.id;
  return query select 'ok'::text, r.user_id;
end $$;

create or replace function auth.revoke_user_tokens(p_user uuid) returns void
language sql security definer set search_path = auth, public as $$
  update auth.refresh_tokens set revoked = true where user_id = p_user and not revoked
$$;

/** 만료된 토큰 청소. 작업 스케줄러에서 하루 한 번 부르면 된다. */
create or replace function auth.prune_refresh_tokens() returns bigint
language plpgsql security definer set search_path = auth, public as $$
declare n bigint;
begin
  delete from auth.refresh_tokens
   where expires_at < now() - interval '7 days' or (revoked and created_at < now() - interval '7 days');
  get diagnostics n = row_count;
  return n;
end $$;

-- ------------------------------------------------------------
--  비밀번호 보안 강화 (2026-11) — docs/accounts-design.md «3. 비밀번호 보안»
-- ------------------------------------------------------------
--  bcrypt 비용 12. 위 create_user · set_password 도 12 로 만든다.
--  예전(10) 해시는 그 사람이 다음에 로그인할 때 sign_in 이 12 로 다시 만든다.

-- 관리자·교사가 정해 준 비밀번호는 «임시». 학생이 첫 로그인 때 바꾼다.
alter table auth.users add column if not exists password_temp boolean not null default false;
-- 비밀번호 맞히기 막기 — 15분 안에 5번 틀리면 15분 잠근다.
alter table auth.users add column if not exists failed_logins int not null default 0;
alter table auth.users add column if not exists last_failed_at timestamptz;
alter table auth.users add column if not exists locked_until timestamptz;

-- 로그인 기록. 비밀번호는 남기지 않는다. 90일 지나면 sign_in 이 지운다.
create table if not exists auth.login_events (
  id bigserial primary key,
  at timestamptz not null default now(),
  user_id uuid references auth.users(id) on delete cascade,
  email text,
  ip text,
  -- ok · bad_password · no_user · locked · banned
  result text not null
);
create index if not exists login_events_at_idx on auth.login_events(at desc);
create index if not exists login_events_user_idx on auth.login_events(user_id, at desc);

/**
 * 로그인 한 번. verify_password 를 대신한다.
 *
 *   status  ok      — user_id 로 세션을 만든다
 *           invalid — 이메일이 없거나 비밀번호가 틀렸다 (둘을 구분해 알리지 않는다)
 *           locked  — 잠겨 있다. retry_after 초 뒤에 다시
 *
 * 없는 이메일에도 bcrypt 를 한 번 돈다. 그러지 않으면 응답 시간 차이로
 * «이 이메일은 등록돼 있다» 를 알아낼 수 있다.
 */
create or replace function auth.sign_in(p_email text, p_password text, p_ip text default null)
returns table (status text, user_id uuid, retry_after int)
language plpgsql security definer set search_path = auth, public, extensions as $$
declare
  u auth.users;
  v_email text := auth.norm_email(p_email);
  v_fails int;
begin
  delete from auth.login_events where at < now() - interval '90 days';

  select * into u from auth.users where email = v_email;

  if u.id is null then
    perform crypt(p_password, gen_salt('bf', 12));
    insert into auth.login_events (email, ip, result) values (v_email, p_ip, 'no_user');
    return query select 'invalid'::text, null::uuid, 0; return;
  end if;

  if u.locked_until is not null and u.locked_until > now() then
    insert into auth.login_events (user_id, email, ip, result) values (u.id, v_email, p_ip, 'locked');
    return query select 'locked'::text, null::uuid,
      greatest(1, ceil(extract(epoch from (u.locked_until - now())))::int); return;
  end if;

  if u.encrypted_password is null
     or u.encrypted_password <> crypt(p_password, u.encrypted_password) then
    v_fails := case when u.last_failed_at is null or u.last_failed_at < now() - interval '15 minutes'
                    then 1 else u.failed_logins + 1 end;
    if v_fails >= 5 then
      update auth.users set failed_logins = 0, last_failed_at = now(),
             locked_until = now() + interval '15 minutes' where id = u.id;
      insert into auth.login_events (user_id, email, ip, result) values (u.id, v_email, p_ip, 'locked');
      return query select 'locked'::text, null::uuid, 900; return;
    end if;
    update auth.users set failed_logins = v_fails, last_failed_at = now() where id = u.id;
    insert into auth.login_events (user_id, email, ip, result) values (u.id, v_email, p_ip, 'bad_password');
    return query select 'invalid'::text, null::uuid, 0; return;
  end if;

  -- 비밀번호는 맞다. 정지 계정은 «틀림» 과 같은 답을 준다 (예전 verify_password 와 같다).
  if u.banned_until is not null and u.banned_until > now() then
    insert into auth.login_events (user_id, email, ip, result) values (u.id, v_email, p_ip, 'banned');
    return query select 'invalid'::text, null::uuid, 0; return;
  end if;

  update auth.users
     set failed_logins = 0, last_failed_at = null, locked_until = null, last_sign_in_at = now(),
         encrypted_password = case when encrypted_password like '$2a$12$%' then encrypted_password
                                   else crypt(p_password, gen_salt('bf', 12)) end
   where id = u.id;
  insert into auth.login_events (user_id, email, ip, result) values (u.id, v_email, p_ip, 'ok');
  return query select 'ok'::text, u.id, 0;
end $$;

create or replace function auth.set_password_temp(p_id uuid, p_temp boolean) returns void
language sql security definer set search_path = auth, public as $$
  update auth.users set password_temp = p_temp where id = p_id
$$;

create or replace function auth.unlock_user(p_id uuid) returns void
language sql security definer set search_path = auth, public as $$
  update auth.users set failed_logins = 0, last_failed_at = null, locked_until = null where id = p_id
$$;

-- ------------------------------------------------------------
--  학교 계정 서버 (2026-11) — docs/accounts-design.md «1. 학교 계정 서버»
-- ------------------------------------------------------------
--  다른 프로그램이 에듀폼2 계정으로 로그인한다. 비밀번호는 넘기지 않고,
--  에듀폼2 가 Ed25519 로 서명한 «이 학생 맞음» 증명(id_token)만 넘긴다.

create table if not exists auth.sso_clients (
  client_id     text primary key check (client_id ~ '^[a-z0-9][a-z0-9-]{1,39}$'),
  name          text not null,
  -- 정확히 같은 주소로만 돌려보낸다. 앞부분만 맞는 주소는 받지 않는다.
  redirect_uris text[] not null default '{}',
  roles         text[] not null default '{student,teacher}',
  -- 프로그램마다 다른 소금으로 sub 을 만든다 — 프로그램끼리 학생을 맞대어 추적하지 못하게
  sub_salt      text not null default encode(gen_random_bytes(32), 'hex'),
  enabled       boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- 서명 열쇠. 비밀 열쇠는 AI_KEY_SECRET 으로 암호화해 둔다 (src/lib/ai-crypto.ts).
create table if not exists auth.sso_keys (
  kid         text primary key,
  public_jwk  jsonb not null,
  private_enc text not null,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- 증명을 언제 누구에게 내줬는지. 증명 원문은 남기지 않는다.
create table if not exists auth.sso_events (
  id         bigserial primary key,
  at         timestamptz not null default now(),
  client_id  text,
  user_id    uuid references auth.users(id) on delete cascade,
  jti        text
);
create index if not exists sso_events_at_idx on auth.sso_events(at desc);

-- 관리자 작업 기록 — 외부용 명단 내려받기 같은 개인정보 반출을 남긴다.
create table if not exists auth.admin_audit (
  id        bigserial primary key,
  at        timestamptz not null default now(),
  admin_id  uuid references auth.users(id) on delete set null,
  action    text not null,
  detail    jsonb not null default '{}'::jsonb
);
create index if not exists admin_audit_at_idx on auth.admin_audit(at desc);

-- ------------------------------------------------------------
--  권한
-- ------------------------------------------------------------
grant usage on schema auth, extensions, public to anon, authenticated, service_role;

-- RLS 정책이 auth.uid() 를 부른다. 이건 모두에게 열어야 한다.
grant execute on function auth.uid(), auth.role(), auth.email() to anon, authenticated, service_role;

-- 로그인 처리 함수는 앱 서버(postgres 접속)만 부른다. 웹에서 오는 역할에는 주지 않는다.
revoke all on function
  auth.verify_password(text, text), auth.create_user(text, text, boolean, jsonb),
  auth.set_password(uuid, text), auth.set_email(uuid, text),
  auth.store_refresh_token(uuid, text, int, text), auth.use_refresh_token(text),
  auth.revoke_user_tokens(uuid),
  auth.sign_in(text, text, text), auth.set_password_temp(uuid, boolean), auth.unlock_user(uuid)
  from public, anon, authenticated, service_role;

-- 학생 이메일을 교사 화면에서 보여줄 때가 있어 select 만 허용한다.
-- 단 «열 단위» 로 — 비밀번호 해시와 잠금 상태는 웹에서 오는 역할이 읽지 못한다.
-- (예전에는 표 전체 select 였다. PostgREST 가 auth 스키마를 내보내지 않아 직접
--  닿지는 않지만, public 의 함수·뷰가 실수로 해시를 넘기는 길을 미리 막는다.)
revoke select on auth.users from authenticated, service_role;
grant select (id, aud, role, email, email_confirmed_at, last_sign_in_at,
              raw_app_meta_data, raw_user_meta_data, banned_until, created_at, updated_at)
  on auth.users to authenticated, service_role;
revoke all on auth.refresh_tokens from anon, authenticated, service_role;
revoke all on auth.login_events, auth.sso_clients, auth.sso_keys, auth.sso_events, auth.admin_audit
  from public, anon, authenticated, service_role;

-- PostgREST 가 public 스키마를 다룰 수 있게 한다. 실제 접근 제한은 RLS 가 한다.
grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
grant execute on all functions in schema public to anon, authenticated, service_role;

alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public
  grant execute on functions to anon, authenticated, service_role;
