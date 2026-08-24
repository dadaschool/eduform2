# 여러 교사 · 전체 관리자 설계

에듀폼2 의 핵심 변경. 이 문서가 합의된 설계다.
작업을 이어받는 사람은 이 문서부터 읽으면 된다.

**진행 상태** (2026-08-24)

- 스키마·RLS·트리거, 관리자 화면, 교사 반 선택, 학생 쪽지의 교사별 보기 — 구현 완료
- 학생 화면의 나머지 교사별 그룹화(과제·배지·대시보드) — 남음
- `schema.sql` 을 운영 DB 에 적용하기 전까지는 위 화면들이 동작하지 않는다

---

## 왜 바꾸는가

요구사항 세 개가 들어왔고, 셋 다 현재 데이터 모델에서는 불가능하다.

1. 교사 반관리 페이지에서 **기존에 만들어진 반을 클릭해서 가져오게** 한다
2. 학생관리는 **해당 반 학생들이 자동으로 모두 연결**되어야 한다
3. 학생들은 **교사별로 데이터를 확인**할 수 있어야 한다

### 막히는 지점

```
classes.teacher_id      반은 만든 교사 한 명의 것
profiles.teacher_id     학생은 교사 한 명에 속함

반 목록   .eq('teacher_id', 내 id)   ← 남이 만든 반이 안 보인다
학생 목록 .eq('teacher_id', 내 id)   ← 반이 아니라 교사 기준이다
학생 화면 .eq('student_id', 내 id)   ← 교사별 구분이 없다
```

- ①은 클릭할 대상 자체가 목록에 없다.
- ②는 학생이 `teacher_id` 하나에 묶여 있어, 다른 교사가 같은 반을 담당해도 안 보인다.
- ③은 학생 화면에 교사 구분 개념이 아예 없다.

실제 증거: 앞선 운영 DB 에 이름이 같은 `1-3` 반이 **두 개** 있었다.
같은 반을 교사마다 따로 만든 흔적이다. 지금 구조가 그걸 강제한다.

---

## 확정된 결정

사용자에게 확인받은 두 가지. 학생 개인정보가 걸린 부분이라 임의로 정하지 않았다.

### 기록 공유 범위 — **각자 자기 기록만**

교사 A 와 B 가 같은 반을 담당해도:

| 대상 | 공유 여부 |
|---|---|
| 학생 명단, 반 정보 | **공유** |
| 평가 · 평가결과 | 만든 교사만 |
| 과제 · 제출물 · 피드백 | 낸 교사만 |
| 관찰기록 | 쓴 교사만 |
| 생활기록부 초안 | 쓴 교사만 |
| 배지 · 쪽지 | 수여자 / 당사자만 |

이미 조여둔 격리(`is_my_assignment`, `is_my_assessment_item`, `observations_teacher` 등)를
**그대로 유지**한다. 바뀌는 것은 "학생을 볼 수 있는 범위"뿐이다.

이 결정이 요구사항 ③과도 맞물린다. 기록이 교사별로 분리되어 있으니,
학생 화면에서 교사별로 묶어 보여주는 것이 자연스럽다.

### 반 관리 권한 — **교사 자유 + 관리자 정리**

- 교사는 학교의 반 목록을 보고 **필요한 반에 스스로 붙는다** (요구사항 ①)
- 관리자는 전체를 보며 **중복 반을 정리하거나 배정을 수정**한다

### 관리자 권한 범위 — **계정·반 관리만**

관리자는 학생 기록을 보지 못한다.

| 대상 | 관리자 |
|---|---|
| 교사·학생 계정 (profiles) | 조회·생성·수정 |
| 반, 교사 배정 (classes, class_teachers) | 전부 |
| 초대코드 | 전부 (교사용 코드는 관리자만 발급) |
| 관찰기록 · 생활기록부 초안 | **볼 수 없음** |
| 평가 · 평가결과 · 과제 제출물 | **볼 수 없음** |
| 배지 · 쪽지 | **볼 수 없음** |

교사가 안심하고 관찰기록을 쓸 수 있어야 한다는 판단이다. 부수적으로 RLS 표면도 줄어든다.

### 교사 가입 — **초대코드로 자기 가입**

관리자가 교사용 초대코드를 발급하고, 교사는 학생과 같은 방식으로 스스로 가입한다.
관리자가 남의 비밀번호를 알게 되는 상황을 피한다.

> ⚠️ **교사 코드는 학생 코드보다 위험도가 훨씬 높다.** 코드가 유출되면 외부인이
> 교사가 되고, 교사는 아무 반에나 스스로 붙을 수 있으므로 학생 명단이 노출된다.
> 그래서 기본값을 학생 코드보다 조이고, 관리자가 누가 가입했는지 볼 수 있게 한다.
>
> - 유효기간 기본 7일 (학생 코드는 30일)
> - 사용한도 기본 5명 (학생 코드는 100명)
> - 관리자 화면에서 코드별 가입자 목록 확인
> - 필요 없어지면 즉시 비활성화

### 첫 관리자

`dadat@geoje-m.gne.go.kr`. 앱에서는 관리자를 만들 수 없으므로 SQL 로 한 번만 지정한다.

---

## 데이터 모델 변경

### 신규 테이블 `class_teachers`

```sql
create table class_teachers (
  class_id   uuid not null references classes(id) on delete cascade,
  teacher_id uuid not null references auth.users(id) on delete cascade,
  role       text not null default 'subject'
               check (role in ('homeroom', 'subject')),   -- 담임 / 교과
  joined_at  timestamptz default now(),
  primary key (class_id, teacher_id)
);
```

반↔교사 다대다. 이 한 테이블이 ①②를 동시에 푼다.

### 기존 컬럼의 의미 변경

| 컬럼 | 현재 | 변경 후 |
|---|---|---|
| `classes.teacher_id` | 소유자 (배타적) | `created_by` 성격. 삭제 권한 판단에만 씀 |
| `profiles.teacher_id` | 학생의 소속 교사 (유일) | **담임 표시용**. 접근 판단에는 쓰지 않음 |
| `profiles.class_id` | 학생의 반 | 그대로. **이제 이게 접근 판단의 기준** |

`profiles.teacher_id` 를 지우지 않는 이유: 초대코드 가입 시 담임을 기록해 두면
쪽지 기본 상대와 담임 표시에 쓸 수 있다. 다만 **"내 학생인가"의 판단 기준은
`class_teachers` 를 거친 반 소속으로 바뀐다.**

### 역할에 `admin` 추가

```sql
-- profiles.role 제약 변경
role text not null check (role in ('admin', 'teacher', 'student'))
```

관리자 부트스트랩은 SQL 로 한 번만 (첫 관리자는 앱에서 만들 수 없다).

---

## RLS 변경

### 새 헬퍼

```sql
-- 내가 담당하는 반 id 목록
create or replace function my_class_ids()
returns setof uuid
language sql security definer stable set search_path = public
as $$ select class_id from class_teachers where teacher_id = auth.uid() $$;

-- 이 학생이 내가 담당하는 반에 있는가
create or replace function is_my_student(p_student_id uuid)
returns boolean
language sql security definer stable set search_path = public
as $$
  select exists (
    select 1 from profiles p
    join class_teachers ct on ct.class_id = p.class_id
    where p.id = p_student_id and ct.teacher_id = auth.uid()
  )
$$;

create or replace function is_admin()
returns boolean
language sql security definer stable set search_path = public
as $$ select exists (select 1 from profiles where id = auth.uid() and role = 'admin') $$;
```

`security definer` 인 이유는 기존 헬퍼와 같다. `profiles` 정책 안에서
`profiles` 를 다시 조회하면 `infinite recursion detected in policy` 가 난다.
이건 이 프로젝트에서 실제로 겪고 재현까지 한 함정이다.

### 정책 교체

```
profiles_select
  현재: auth.uid() = id or teacher_id = auth.uid() or id = current_user_teacher_id()
  변경: auth.uid() = id
        or is_my_student(id)          -- 내 반 학생
        or id = current_user_teacher_id()
        or is_admin()

classes 조회
  현재: 교사는 auth.uid() = teacher_id 인 반만
  변경: 교사는 학교의 모든 반을 조회 가능 (요구사항 ① — 클릭해서 붙으려면 목록이 보여야 한다)
        수정·삭제는 class_teachers 에 속한 교사 또는 관리자만

class_teachers
  select: 교사는 전부 조회 (누가 어느 반을 담당하는지 보여야 협업이 된다)
  insert: 자기 자신만 추가 (teacher_id = auth.uid()) 또는 관리자
  delete: 자기 자신만 제거 또는 관리자
```

기록 계열(`assessments`, `observations`, `student_record_drafts`,
`assignment_submissions`)의 정책은 **건드리지 않는다.** 각자 자기 기록만 보는
결정을 유지한다.

> ⚠️ `badges_student_select` 가 `current_user_teacher_id()` 를 쓰고 있다.
> 학생이 여러 교사의 배지를 받게 되므로 `is_my_teacher(badges.teacher_id)` 형태로
> 바꿔야 한다. 안 바꾸면 담임 아닌 교사가 준 배지의 이름이 빈칸으로 나온다.

---

## 화면 변경

### 교사 — 반 관리

- 학교의 **전체 반 목록**을 보여준다
- 내가 담당하는 반: `담당 중` 배지 + 초대코드·학생수 표시
- 담당하지 않는 반: **`담당하기` 버튼** ← 요구사항 ①
- 담임/교과 구분 선택
- 반 삭제는 만든 사람 또는 관리자만 (지금은 아무 소유자나 삭제 가능)

### 교사 — 학생 관리

- 조회 기준을 `profiles.teacher_id` → **내가 담당하는 반의 학생 전체**로 변경 ← 요구사항 ②
- 반 필터는 내가 담당하는 반만 표시
- 엑셀 업로드 시 대상 반을 고르게 (현재는 단일 교사 가정)

### 학생 — 교사별 보기 ← 요구사항 ③

학생 화면 전부가 `student_id` 기준 단일 목록이다. 교사별로 묶는다.

| 화면 | 변경 |
|---|---|
| 대시보드 | 교사별 섹션. 각 교사의 과제·평가·배지 요약 |
| 과제 | 출제 교사별 그룹 헤더 |
| 내 배지 | 수여 교사별 그룹 |
| 쪽지 | 상대 교사별 대화 목록 (현재는 담임 한 명 고정) |
| 관찰·평가 | 교사별 탭 |

`assessments.teacher_id`, `assignments.teacher_id`, `observations.teacher_id`,
`student_badges.awarded_by` 가 이미 있으므로 스키마 추가 없이 그룹화 가능하다.
**쪽지만 예외** — 현재 학생 화면이 담임 한 명만 상대로 가정한다
(`profiles.teacher_id` 로 상대를 정한다). 교사 목록에서 고르게 바꿔야 한다.

### 관리자 화면 (신규)

- 교사 목록 · **교사 계정 생성** ← 지금은 앱에 이 기능이 아예 없어서
  Supabase 대시보드에서 SQL 을 직접 실행해야 한다. 교사가 여러 명이면 못 쓴다.
- 반 목록 · 교사 배정 수정 · 중복 반 정리
- 비밀번호 초기화

`/api/admin/create-teacher` 라우트가 필요하다. `service_role` 로
`auth.users` 와 `profiles` 를 함께 만든다. 기존 `/api/teacher/create-student`
와 같은 방식이고, 호출자가 관리자인지 검사하는 부분만 다르다.

> 계정을 만들 때 `profiles` 행을 빼먹으면 **무한 리다이렉트**에 빠진다.
> 교사 레이아웃은 role≠teacher 면 학생 화면으로, 학생 레이아웃은 role≠student 면
> 교사 화면으로 보내기 때문이다. 이번 세션에서 실제로 겪었다.
> 관리자 라우트는 두 행을 한 트랜잭션처럼 함께 만들고, 실패 시 auth 사용자를
> 되돌려야 한다 (create-student 라우트가 이미 그렇게 한다).

---

## 마이그레이션

기존 데이터를 잃지 않고 옮기는 순서.

```sql
-- 1. class_teachers 생성 (위 DDL)

-- 2. 기존 소유 관계를 담임으로 이관
insert into class_teachers (class_id, teacher_id, role)
select id, teacher_id, 'homeroom' from classes
on conflict do nothing;

-- 3. profiles.role 제약에 admin 추가
alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_check
  check (role in ('admin', 'teacher', 'student'));

-- 4. 첫 관리자 지정 (이메일을 실제 값으로)
update profiles set role = 'admin' where email = '관리자이메일';

-- 5. 헬퍼 함수와 정책 교체 (schema.sql 재실행)
```

`schema.sql` 은 정책을 전부 지우고 다시 만들므로 재실행이 곧 적용이다.
테이블과 데이터는 건드리지 않는다.

---

## 검증 계획

로컬 PostgreSQL 로 실행 검증한다. 현재 45건이 통과 중이고, 추가할 항목:

- 교사 A 가 반 1-1 에 붙으면 그 반 학생 전체가 보인다
- 교사 B 도 같은 반에 붙을 수 있고, 같은 학생 명단을 본다
- **A 는 B 가 만든 평가·관찰기록·생활기록부를 볼 수 없다** (핵심)
- A 가 반에서 빠지면 그 반 학생이 더 이상 안 보인다
- 학생은 자기 반의 여러 교사 이름을 조회할 수 있다 (교사별 보기용)
- 학생은 다른 반 학생을 볼 수 없다
- 관리자는 전체 교사·반을 조회하고 배정을 수정할 수 있다
- 관리자가 아닌 교사는 남의 배정을 수정할 수 없다
- 비로그인은 여전히 아무것도 못 읽는다 (12개 테이블)
- 초대코드 열거 차단이 유지된다

기존 45건이 하나도 깨지지 않아야 한다. 특히 교사 간 기록 격리 회귀 항목.

---

## 작업 순서

1. `supabase/schema.sql` — `class_teachers`, 헬퍼 3개, 정책 교체, `admin` 역할
2. 로컬 Postgres 검증 (45건 + 신규 항목)
3. `src/app/(teacher)/teacher/classes/page.tsx` — 전체 반 목록 + 담당하기
4. `src/app/(teacher)/teacher/students/page.tsx` — 반 기준 조회
5. `src/app/(student)/*` — 교사별 그룹화
6. `src/app/(admin)/*` + `/api/admin/create-teacher` — 관리자 화면
7. `supabase/seed.sql` — 교사 2명이 한 반을 공유하는 시범 데이터로 확장
   (지금 시범 데이터는 교사 1명이라 이 기능을 눌러볼 수 없다)

3~6 은 서로 독립적이라 나눠 진행할 수 있다.
1~2 를 먼저 끝내고 DB 에 적용해야 나머지가 동작한다.

---

## 주의점

- **작업 위치는 이 저장소(dadaschool/eduform)다.** 배포 중인 곳이라 푸시하면
  eduform-eight.vercel.app 에 자동 반영된다. 사용자가 앞으로 여기로만 배포한다고
  정했다. 에듀폼2 는 이 작업이 끝난 뒤 내부 서버용으로 다시 만든다.
- 사용자에게 안내하는 주소는 `dadaschool.github.io/eduform` 이고, 그 안내
  페이지가 위 배포로 보낸다. Pages 는 정적이라 앱 자체가 돌 수 없다.
- `schema.sql` 을 재실행하면 `public` 스키마의 **기존 정책이 전부 교체**된다.
  손으로 추가한 정책이 있으면 사라진다.
- `profiles.teacher_id` 가 빈 학생은 담임이 없는 상태다. 접근 판단은
  `class_id` 기준으로 바뀌므로 문제되지 않지만, 담임 표시는 비어 보인다.
