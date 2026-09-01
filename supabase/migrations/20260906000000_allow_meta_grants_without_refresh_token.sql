-- Instagram과 Threads는 refresh token을 발급하지 않는다. 대신 60일짜리 장기 액세스 토큰을
-- 주고, 만료 전에 그 토큰 자체를 다시 제시해서 새 토큰으로 교환한다(th_refresh_token /
-- ig_refresh_token). 그래서 활성 grant에 refresh_token_ciphertext를 요구하는 기존 제약을
-- 이 두 플랫폼에서만 푼다.
--
-- 같은 비밀을 access/refresh 두 칸에 중복 저장해서 제약을 통과시키는 우회는 쓰지 않는다 —
-- 자격증명 사본이 하나 더 생기고, 나중에 읽는 사람이 두 값이 다른 것이라고 오해한다.

alter table public.platform_oauth_grants
  drop constraint platform_oauth_grants_refresh_token_for_active;

alter table public.platform_oauth_grants
  add constraint platform_oauth_grants_refresh_token_for_active check (
    status <> 'active'
    or refresh_token_ciphertext is not null
    or platform in ('instagram', 'threads')
  );

-- 장기 토큰을 쓰는 플랫폼은 만료가 곧 재인증이므로 만료 시각이 반드시 있어야 한다.
alter table public.platform_oauth_grants
  add constraint platform_oauth_grants_meta_needs_expiry check (
    platform not in ('instagram', 'threads')
    or status <> 'active'
    or access_token_expires_at is not null
  );
