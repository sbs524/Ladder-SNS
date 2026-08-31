-- 20260903000000이 ai_usage_events에서 anon/authenticated 권한만 회수하고 service_role에는
-- GRANT를 주지 않았다. 이 프로젝트는 public 스키마 자동 노출이 꺼져 있어 service_role도
-- 명시적 GRANT가 필요하다(20260829010000과 같은 이유). 없으면 사용량 기록·조회가 전부
-- "permission denied" (42501)로 실패한다 — 즉 요금제 한도가 동작하지 않는다.
grant select, insert on public.ai_usage_events to service_role;
