-- AI 호출 원장. 요금제별 월 사용량 제한(docs/과금_및_지표_정의.md §6)을 세는 유일한 근거다.
--
-- 왜 필요한가: AI 기능이 Plus 전용이 된 뒤에도 Plus 사용자는 무제한으로 호출할 수 있었다.
-- 리포트 1건 약 29원, 컨설턴트 질문 1건 약 7원이라 한 사람이 하루에 수천 번 부르면 월 구독료를
-- 그대로 넘긴다. 상한이 없으면 요금제가 요금제가 아니다.
--
-- 성공한 호출만 기록한다. 실패한 호출에 사용자의 한도를 소모시키지 않는다.

-- report: AI 종합 진단 / advisor: 1:1 컨설턴트 질문 / draft: 영상 제목·설명 AI 초안
create type public.ai_usage_action as enum ('report', 'advisor', 'draft');

create table public.ai_usage_events (
  ai_usage_event_id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(profile_id) on delete cascade,
  action public.ai_usage_action not null,
  model text not null,
  created_at timestamptz not null default now(),
  constraint ai_usage_events_model_length check (char_length(model) between 1 and 200)
);

-- 월 사용량 집계는 항상 (profile_id, action, 기간) 조합으로 센다.
create index ai_usage_events_profile_action_time_idx
  on public.ai_usage_events (profile_id, action, created_at desc);

alter table public.ai_usage_events enable row level security;

-- 서비스 롤만 쓴다. 사용자가 자기 사용 기록을 지워서 한도를 되돌릴 수 있으면 안 된다.
revoke all on table public.ai_usage_events from anon, authenticated;
