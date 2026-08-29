begin;

-- Soft-delete marker for withdrawn accounts (docs/기획서.md §5.1 "deleted_at ... 탈퇴 후 결제 이력 보존").
alter table public.profiles
  add column deleted_at timestamptz;

comment on column public.profiles.deleted_at is
  'Set when the user withdraws (회원탈퇴). The auth.users row is banned (not deleted) and this row is anonymized, not removed, to preserve a future billing/audit trail.';

-- service_role needs explicit grants (this project has auto-expose-to-Data-API-roles disabled —
-- see 20260829010000_grant_service_role_social_platform_data.sql for the same class of bug).
grant select, update on public.profiles to service_role;

-- Public-read avatar bucket. All writes go through the service-role admin client from the
-- Express server; no RLS policies needed (reads bypass RLS via the public object URL path,
-- writes always use the service-role key which bypasses RLS).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

commit;
