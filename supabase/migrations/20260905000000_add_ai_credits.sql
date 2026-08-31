-- 구매 크레딧. 월 할당량을 다 쓴 Plus 사용자가 추가로 쓰는 별도 잔액이다.
-- 차감 규칙은 docs/과금_및_지표_정의.md §2: 할당량 먼저, 그다음 크레딧, 둘 다 없으면 402.
--
-- 할당량과 크레딧은 별도 잔액이다. 할당량은 매달 리셋되고 이월되지 않지만, 구매 크레딧은
-- 이월된다. 그래서 합산해서 한 숫자로 보여주지 않는다.
alter table public.profiles
  add column ai_credits integer not null default 0,
  add constraint profiles_ai_credits_not_negative check (ai_credits >= 0);

-- 잔액은 결제로만 늘어난다. 사용자가 자기 잔액을 직접 올릴 수 있으면 안 된다.
revoke update (ai_credits) on public.profiles from authenticated;

-- 각 호출이 크레딧을 얼마나 썼는지. 0이면 월 할당량으로 처리된 호출이다.
alter table public.ai_usage_events
  add column credits_spent integer not null default 0,
  add constraint ai_usage_events_credits_spent_not_negative check (credits_spent >= 0);

/**
 * 크레딧을 원자적으로 차감한다.
 *
 * 읽고-빼고-쓰는 3단계를 애플리케이션에서 하면 동시 요청이 잔액을 음수로 만들 수 있다.
 * 조건부 update 한 방이라 경쟁 상태에서도 잔액이 음수가 되지 않는다.
 *
 * 잔액이 모자라면 아무 행도 갱신하지 않고 null을 돌려준다 — 호출부는 그걸 보고 402를 낸다.
 */
create or replace function public.spend_ai_credits(target_profile_id uuid, amount integer)
returns integer
language sql
security definer
set search_path = public
as $$
  update public.profiles
     set ai_credits = ai_credits - amount
   where profile_id = target_profile_id
     and ai_credits >= amount
     and amount > 0
  returning ai_credits;
$$;

revoke all on function public.spend_ai_credits(uuid, integer) from public, anon, authenticated;
grant execute on function public.spend_ai_credits(uuid, integer) to service_role;
