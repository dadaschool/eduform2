-- =============================================
-- EduForm 전체 DB 스키마
-- =============================================

-- Extensions
create extension if not exists "uuid-ossp";

-- =============================================
-- 반 (Classes)
-- =============================================
create table if not exists classes (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  year int not null default extract(year from now())::int,
  teacher_id uuid not null references auth.users(id) on delete cascade,
  description text,
  created_at timestamptz default now()
);

-- =============================================
-- 초대코드 (Invite Codes)
-- =============================================
create table if not exists invite_codes (
  id uuid primary key default uuid_generate_v4(),
  code text unique not null,
  class_id uuid not null references classes(id) on delete cascade,
  teacher_id uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz,
  max_uses int default 100,
  used_count int default 0,
  is_active boolean default true,
  created_at timestamptz default now()
);

-- =============================================
-- 프로필 (Profiles)
-- =============================================
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  name text not null,
  role text not null check (role in ('teacher', 'student')),
  class_id uuid references classes(id) on delete set null,
  student_number text,
  teacher_id uuid references auth.users(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- =============================================
-- 디지털 배지 정의
-- =============================================
create table if not exists badges (
  id uuid primary key default uuid_generate_v4(),
  teacher_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text,
  icon text default '🏅',
  criteria text,
  created_at timestamptz default now()
);

-- 학생 배지 수여
create table if not exists student_badges (
  id uuid primary key default uuid_generate_v4(),
  student_id uuid not null references profiles(id) on delete cascade,
  badge_id uuid not null references badges(id) on delete cascade,
  awarded_by uuid not null references auth.users(id) on delete cascade,
  note text,
  awarded_at timestamptz default now(),
  unique(student_id, badge_id)
);

-- =============================================
-- 평가 (Assessments)
-- =============================================
create table if not exists assessments (
  id uuid primary key default uuid_generate_v4(),
  teacher_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  subject text,
  description text,
  gemini_prompt text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 평가 ↔ 반 배포 (다대다)
create table if not exists assessment_classes (
  assessment_id uuid not null references assessments(id) on delete cascade,
  class_id uuid not null references classes(id) on delete cascade,
  primary key (assessment_id, class_id)
);

-- 평가 항목
create table if not exists assessment_items (
  id uuid primary key default uuid_generate_v4(),
  assessment_id uuid not null references assessments(id) on delete cascade,
  name text not null,
  description text,
  check_type text not null default 'ox'
    check (check_type in ('ox', 'level3', 'status3', 'number', 'score5', 'text')),
  -- ox: O/X
  -- level3: 상/중/하
  -- status3: 완료/보류/미제출
  -- number: 숫자 입력 (+/-/직접입력), min/max 설정
  -- score5: 1~5점
  -- text: 텍스트 메모
  number_min int default 0,
  number_max int default 100,
  display_order int default 0,
  created_at timestamptz default now()
);

-- 학생별 평가 항목 체크 결과
create table if not exists student_assessment_checks (
  id uuid primary key default uuid_generate_v4(),
  student_id uuid not null references profiles(id) on delete cascade,
  assessment_item_id uuid not null references assessment_items(id) on delete cascade,
  check_value text,          -- 'O'/'X', '상'/'중'/'하', '완료'/'보류'/'미제출', '85', '피아노 잘 침' 등
  teacher_memo text,
  -- 기록용 컬럼이므로 계정이 지워지면 비운다.
  -- on delete 를 지정하지 않으면 이 값이 교사 계정 삭제를 막는다.
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz default now(),
  unique(student_id, assessment_item_id)
);

-- =============================================
-- 과제 (Assignments)
-- =============================================
create table if not exists assignments (
  id uuid primary key default uuid_generate_v4(),
  teacher_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  description text not null,
  deadline timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 과제 ↔ 반 배포
create table if not exists assignment_classes (
  assignment_id uuid not null references assignments(id) on delete cascade,
  class_id uuid not null references classes(id) on delete cascade,
  primary key (assignment_id, class_id)
);

-- 학생 과제 제출
create table if not exists assignment_submissions (
  id uuid primary key default uuid_generate_v4(),
  assignment_id uuid not null references assignments(id) on delete cascade,
  student_id uuid not null references profiles(id) on delete cascade,
  content text not null,
  submitted_at timestamptz default now(),
  feedback text,
  feedback_at timestamptz,
  -- 기록용 컬럼이므로 계정이 지워지면 비운다 (updated_by 와 같은 이유)
  feedback_by uuid references auth.users(id) on delete set null,
  unique(assignment_id, student_id)
);

-- =============================================
-- 관찰일지 (Observations)
-- =============================================
create table if not exists observations (
  id uuid primary key default uuid_generate_v4(),
  teacher_id uuid not null references auth.users(id) on delete cascade,
  student_id uuid not null references profiles(id) on delete cascade,
  content text not null,
  subject text,
  observed_at date default current_date,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- =============================================
-- 학생부 초안 (Student Record Drafts)
-- =============================================
create table if not exists student_record_drafts (
  id uuid primary key default uuid_generate_v4(),
  teacher_id uuid not null references auth.users(id) on delete cascade,
  student_id uuid not null references profiles(id) on delete cascade,
  subject text,
  content text not null,
  is_final boolean default false,
  generated_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- =============================================
-- 쪽지 (Messages)
-- =============================================
-- sender_id / receiver_id 는 반드시 profiles 를 참조해야 한다.
-- 코드가 profiles!sender_id 형태로 보낸 사람 이름을 함께 조회하기 때문에,
-- auth.users 를 참조하면 그 조회가 실패한다.
create table if not exists messages (
  id uuid primary key default uuid_generate_v4(),
  sender_id uuid not null references profiles(id) on delete cascade,
  receiver_id uuid not null references profiles(id) on delete cascade,
  subject text,
  content text not null,
  reply_to_id uuid references messages(id) on delete set null,
  is_read boolean not null default false,
  deleted_by_sender boolean not null default false,
  deleted_by_receiver boolean not null default false,
  created_at timestamptz default now()
);

create index if not exists messages_receiver_idx on messages(receiver_id, created_at desc);
create index if not exists messages_sender_idx on messages(sender_id, created_at desc);

-- =============================================
-- RLS 정책
-- =============================================
alter table classes enable row level security;
alter table invite_codes enable row level security;
alter table profiles enable row level security;
alter table badges enable row level security;
alter table student_badges enable row level security;
alter table assessments enable row level security;
alter table assessment_classes enable row level security;
alter table assessment_items enable row level security;
alter table student_assessment_checks enable row level security;
alter table assignments enable row level security;
alter table assignment_classes enable row level security;
alter table assignment_submissions enable row level security;
alter table observations enable row level security;
alter table student_record_drafts enable row level security;
alter table messages enable row level security;

-- 이 파일은 여러 번 실행해도 안전해야 한다.
-- create policy 는 if not exists 를 지원하지 않으므로 기존 정책을 먼저 지운다.
do $$
declare r record;
begin
  for r in select schemaname, tablename, policyname from pg_policies where schemaname = 'public'
  loop
    execute format('drop policy if exists %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

-- ---------------------------------------------
-- 내 정보를 읽는 헬퍼 함수
-- ---------------------------------------------
-- profiles 의 정책 안에서 profiles 를 다시 조회하면
-- 그 서브쿼리에도 같은 정책이 적용되어 아래 오류가 난다.
--   ERROR: infinite recursion detected in policy for relation "profiles"
-- security definer 함수는 RLS 를 우회하므로 이 고리를 끊는다.
-- 예전 정책에 있던 current_user_role() 은 쓰지 않는다. 역할만 보고 허용하면
-- 아무 교사나 남의 학생 데이터에 접근할 수 있어, 아래 정책들은 모두
-- teacher_id / 소유 관계로 범위를 좁혔다.
create or replace function current_user_teacher_id()
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select teacher_id from profiles where id = auth.uid()
$$;

create or replace function current_user_class_id()
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select class_id from profiles where id = auth.uid()
$$;

-- assignments 의 정책이 assignment_classes 를 조회하고,
-- assignment_classes 의 정책이 다시 assignments 를 조회하면 서로를 물어
--   ERROR: infinite recursion detected in policy for relation "assignment_classes"
-- 가 난다. 두 판단을 RLS 우회 함수로 빼서 고리를 끊는다.
create or replace function is_my_assignment(p_assignment_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from assignments
    where id = p_assignment_id and teacher_id = auth.uid()
  )
$$;

-- 이 평가 항목이 내가 만든 평가에 속하는지 (평가결과 접근 범위 판단용)
create or replace function is_my_assessment_item(p_item_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from assessment_items ai
    join assessments a on a.id = ai.assessment_id
    where ai.id = p_item_id and a.teacher_id = auth.uid()
  )
$$;

create or replace function is_assignment_for_my_class(p_assignment_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from assignment_classes ac
    join profiles p on p.id = auth.uid()
    where ac.assignment_id = p_assignment_id
      and ac.class_id = p.class_id
  )
$$;

-- profiles
-- 역할만 보고 허용하면 아무 교사나 남의 학생까지 보고 고칠 수 있다.
-- teacher_id 로 좁혀 자기가 담당한 학생만 다루게 한다.
-- (teacher_id 가 빈 학생은 담당 교사가 다룰 수 없다. 학생 계정은 초대코드 가입과
--  create-student API 양쪽 모두 teacher_id 를 채운다)
create policy "profiles_select" on profiles for select using (
  auth.uid() = id
  or teacher_id = auth.uid()
  -- 학생이 쪽지 발신자(선생님) 이름을 표시할 수 있어야 한다
  or id = current_user_teacher_id()
);
create policy "profiles_insert" on profiles for insert with check (auth.uid() = id);
create policy "profiles_update" on profiles for update using (
  auth.uid() = id
  or teacher_id = auth.uid()
);
create policy "profiles_delete" on profiles for delete using (
  teacher_id = auth.uid()
);

-- classes: 교사만 CRUD
create policy "classes_all" on classes for all using (auth.uid() = teacher_id);
create policy "classes_student_select" on classes for select using (
  id = current_user_class_id()
);

-- invite_codes: 교사 관리
create policy "invite_codes_teacher" on invite_codes for all using (auth.uid() = teacher_id);
create policy "invite_codes_student_select" on invite_codes for select using (is_active = true);

-- badges
create policy "badges_teacher" on badges for all using (auth.uid() = teacher_id);
create policy "badges_student_select" on badges for select using (true);
create policy "student_badges_teacher" on student_badges for all using (auth.uid() = awarded_by);
create policy "student_badges_student_select" on student_badges for select using (auth.uid() = student_id);

-- assessments
create policy "assessments_teacher" on assessments for all using (auth.uid() = teacher_id);
create policy "assessment_classes_teacher" on assessment_classes for all using (
  exists (select 1 from assessments a where a.id = assessment_id and a.teacher_id = auth.uid())
);
create policy "assessment_items_teacher" on assessment_items for all using (
  exists (select 1 from assessments a where a.id = assessment_id and a.teacher_id = auth.uid())
);
-- 아무 교사나 남의 학생 평가결과를 보지 못하게, 평가를 만든 교사로 좁힌다.
create policy "student_assessment_checks_teacher" on student_assessment_checks for all using (
  is_my_assessment_item(assessment_item_id)
);
create policy "student_assessment_checks_student_select" on student_assessment_checks for select using (
  auth.uid() = student_id
);

-- assignments
create policy "assignments_teacher" on assignments for all using (auth.uid() = teacher_id);
create policy "assignment_classes_teacher" on assignment_classes for all using (
  is_my_assignment(assignment_id)
);
-- 원래 조건은 (p.class_id = class_id) 였는데, 규칙 없는 class_id 가
-- 서브쿼리 안쪽의 p.class_id 로 해석되어 항상 참이 되었다.
-- 그래서 모든 학생이 다른 반의 과제 배포 정보까지 볼 수 있었다.
create policy "assignment_classes_student_select" on assignment_classes for select using (
  class_id = current_user_class_id()
);
create policy "assignments_student_select" on assignments for select using (
  is_assignment_for_my_class(id)
);
-- 아무 교사나 남의 학생 제출물을 보지 못하게, 과제를 낸 교사로 좁힌다.
create policy "assignment_submissions_teacher" on assignment_submissions for all using (
  is_my_assignment(assignment_id)
);
create policy "assignment_submissions_student" on assignment_submissions for all using (
  auth.uid() = student_id
);

-- observations
create policy "observations_teacher" on observations for all using (auth.uid() = teacher_id);
create policy "observations_student_select" on observations for select using (auth.uid() = student_id);

-- student_record_drafts
create policy "drafts_teacher" on student_record_drafts for all using (auth.uid() = teacher_id);
create policy "drafts_student_select" on student_record_drafts for select using (auth.uid() = student_id);

-- messages: 내가 보낸 쪽지 또는 내가 받은 쪽지만 보인다
create policy "messages_select" on messages for select using (
  auth.uid() = sender_id or auth.uid() = receiver_id
);
create policy "messages_insert" on messages for insert with check (auth.uid() = sender_id);
-- is_read, deleted_by_sender, deleted_by_receiver 갱신용 (당사자만)
create policy "messages_update" on messages for update using (
  auth.uid() = sender_id or auth.uid() = receiver_id
);

-- =============================================
-- 트리거: profiles updated_at 자동 갱신
-- =============================================
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- create trigger 도 if not exists 를 지원하지 않아 먼저 지운다
drop trigger if exists profiles_updated_at on profiles;
create trigger profiles_updated_at before update on profiles
  for each row execute function update_updated_at();

drop trigger if exists assessments_updated_at on assessments;
create trigger assessments_updated_at before update on assessments
  for each row execute function update_updated_at();

drop trigger if exists assignments_updated_at on assignments;
create trigger assignments_updated_at before update on assignments
  for each row execute function update_updated_at();

drop trigger if exists observations_updated_at on observations;
create trigger observations_updated_at before update on observations
  for each row execute function update_updated_at();

drop trigger if exists drafts_updated_at on student_record_drafts;
create trigger drafts_updated_at before update on student_record_drafts
  for each row execute function update_updated_at();

-- =============================================
-- RPC: 초대코드 사용 횟수 증가
-- =============================================
create or replace function increment_invite_code(code text)
returns void as $$
begin
  update invite_codes
  set used_count = used_count + 1
  where invite_codes.code = $1;
end;
$$ language plpgsql security definer;

-- =============================================
-- Realtime: 학생 화면의 새 쪽지 알림
-- =============================================
-- MessageNotifier 가 messages 테이블의 INSERT 를 실시간 구독한다.
-- 이 publication 에 등록되지 않으면 알림 토스트가 뜨지 않는다.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table messages;
  end if;
exception
  when undefined_object then
    raise notice 'supabase_realtime publication 이 없습니다. 대시보드 > Database > Replication 에서 messages 를 켜주세요.';
end $$;
