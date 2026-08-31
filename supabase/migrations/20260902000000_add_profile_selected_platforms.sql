-- 온보딩에서 고른 "운영 중인 플랫폼". 지금까지는 sessionStorage에만 있었고 DB에 저장되지 않아,
-- 새로고침하면 프런트엔드에 박혀 있던 기본값(4개 전부)으로 되돌아갔다.
--
-- 대시보드가 어떤 플랫폼 카드를 그릴지 정하는 값이므로 사용자 소유 데이터다. plan과 달리
-- 과금 기준이 아니라 표시 설정이라 본인이 직접 수정할 수 있다(RLS의 기존 profiles 정책을 따른다).
alter table public.profiles
  add column selected_platforms public.social_platform[] not null default array['youtube']::public.social_platform[];

-- 빈 배열이면 대시보드에 아무 카드도 그릴 수 없다. 최소 하나는 있어야 한다.
alter table public.profiles
  add constraint profiles_selected_platforms_not_empty
  check (array_length(selected_platforms, 1) >= 1);
