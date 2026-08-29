begin;

-- Marks a reply as authored from the Ladder SNS dashboard (vs. synced from YouTube), so
-- dashboard-originated writes can later be distinguished/audited separately from viewer comments.
alter table public.social_comments
  add column authored_by_profile_id uuid references public.profiles(profile_id) on delete set null;

commit;
