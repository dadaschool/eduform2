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
    crypt(p_password, gen_salt('bf', 10)),
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
     set encrypted_password = crypt(p_password, gen_salt('bf', 10)), updated_at = now()
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
  auth.revoke_user_tokens(uuid)
  from public, anon, authenticated, service_role;

-- 학생 이메일을 교사 화면에서 보여줄 때가 있어 select 만 허용한다.
grant select on auth.users to authenticated, service_role;
revoke all on auth.refresh_tokens from anon, authenticated, service_role;

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
