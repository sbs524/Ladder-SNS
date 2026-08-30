-- 요금제. 결제 도메인(구독/원장/PG)은 아직 없으므로 지금은 이 컬럼 하나가 유일한 권한 기준이다.
-- Phase 4에서 subscriptions 테이블이 생기면 이 컬럼은 그 테이블에서 파생되는 캐시가 된다.
create type public.billing_plan as enum ('free', 'plus');

alter table public.profiles
  add column plan public.billing_plan not null default 'free';

-- 서비스 롤만 요금제를 바꿀 수 있다. 사용자가 자기 프로필을 수정해서 Plus가 되면 안 된다.
revoke update (plan) on public.profiles from authenticated;
