-- Ladder SNS signup foundation: Supabase Auth owns credentials and identities.

create type public.user_type as enum ('individual', 'team', 'enterprise');

create table public.profiles (
  profile_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  user_type public.user_type,
  onboarding_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint profiles_display_name_length
    check (display_name is null or char_length(btrim(display_name)) between 1 and 100),
  constraint profiles_avatar_url_length
    check (avatar_url is null or char_length(avatar_url) <= 2048)
);

comment on table public.profiles is
  'Application profile data for an auth.users account. Credentials and provider identities remain in Supabase Auth.';
comment on column public.profiles.profile_id is
  'The matching auth.users.id. This creates a strict one-to-one relationship with the authenticated user.';
comment on column public.profiles.display_name is
  'User-facing name. It may be seeded from non-authoritative OAuth metadata and changed by the user.';
comment on column public.profiles.avatar_url is
  'URL of a profile image from an OAuth provider or future Supabase Storage upload.';
comment on column public.profiles.user_type is
  'Onboarding selection used to tailor the product: individual, team, or enterprise.';
comment on column public.profiles.onboarding_completed_at is
  'Timestamp that distinguishes an unfinished first-run flow from completed onboarding.';
comment on column public.profiles.created_at is
  'Profile creation timestamp for auditing and signup conversion analysis.';
comment on column public.profiles.updated_at is
  'Last application-profile change timestamp, maintained by trigger.';

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (profile_id, display_name, avatar_url)
  values (
    new.id,
    nullif(left(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'), 100), ''),
    nullif(left(new.raw_user_meta_data ->> 'avatar_url', 2048), '')
  )
  on conflict (profile_id) do nothing;

  return new;
end;
$$;

comment on function public.handle_new_user() is
  'Creates the application profile when Supabase Auth creates an email OTP or OAuth user.';

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;

revoke all on table public.profiles from anon;
grant select, update on table public.profiles to authenticated;

create policy "Profiles are readable by their owner"
  on public.profiles
  for select
  to authenticated
  using ((select auth.uid()) = profile_id);

create policy "Profiles are updatable by their owner"
  on public.profiles
  for update
  to authenticated
  using ((select auth.uid()) = profile_id)
  with check ((select auth.uid()) = profile_id);
