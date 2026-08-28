-- YouTube-first social connection, analytics, and real-time comment foundation.
-- All application access is mediated by the Express server. OAuth secrets are service-role only.

begin;

create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_trgm with schema extensions;

create type public.social_platform as enum ('youtube', 'instagram', 'threads', 'x');
create type public.platform_oauth_grant_status as enum ('active', 'requires_reauth', 'revoked', 'error');
create type public.social_channel_status as enum ('active', 'paused', 'disconnected', 'error');
create type public.social_content_visibility as enum ('public', 'unlisted', 'private', 'scheduled', 'deleted', 'unknown');
create type public.social_comment_kind as enum ('comment', 'reply', 'live_chat', 'super_chat', 'super_sticker', 'membership_event', 'system_event');
create type public.social_comment_visibility as enum ('active', 'deleted', 'hidden', 'held_for_review', 'rejected', 'unavailable');
create type public.social_comment_event_type as enum ('created', 'updated', 'deleted', 'moderation_changed', 'reply_created');
create type public.social_comment_sync_resource as enum ('comment_threads', 'live_chat');
create type public.platform_sync_job_kind as enum ('initial', 'channel', 'content', 'analytics', 'comments', 'live_chat', 'full');
create type public.platform_sync_job_status as enum ('queued', 'running', 'succeeded', 'failed', 'cancelled');

-- One Google grant can expose several YouTube or Brand channels.
-- Ciphertext columns must contain authenticated encryption output, never plaintext tokens.
create table public.platform_oauth_grants (
  platform_oauth_grant_id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(profile_id) on delete cascade,
  platform public.social_platform not null,
  provider text not null default 'google',
  provider_subject text not null,
  access_token_ciphertext text,
  refresh_token_ciphertext text,
  encryption_key_version smallint not null default 1 check (encryption_key_version > 0),
  access_token_expires_at timestamptz,
  granted_scopes text[] not null default '{}',
  status public.platform_oauth_grant_status not null default 'active',
  last_token_refresh_at timestamptz,
  last_error_code text,
  last_error_at timestamptz,
  connected_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint platform_oauth_grants_provider_subject_length check (char_length(provider_subject) between 1 and 255),
  constraint platform_oauth_grants_refresh_token_for_active check (
    status <> 'active' or refresh_token_ciphertext is not null
  ),
  unique (profile_id, platform, provider, provider_subject)
);

create index platform_oauth_grants_profile_status_idx
  on public.platform_oauth_grants (profile_id, status);

create table public.social_channels (
  social_channel_id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(profile_id) on delete cascade,
  platform_oauth_grant_id uuid references public.platform_oauth_grants(platform_oauth_grant_id) on delete restrict,
  platform public.social_platform not null,
  external_channel_id text not null,
  handle text,
  display_name text not null,
  avatar_url text,
  is_dashboard_enabled boolean not null default true,
  status public.social_channel_status not null default 'active',
  last_synced_at timestamptz,
  disconnected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint social_channels_external_channel_id_length check (char_length(external_channel_id) between 1 and 255),
  constraint social_channels_display_name_length check (char_length(btrim(display_name)) between 1 and 255),
  constraint social_channels_handle_length check (handle is null or char_length(handle) <= 255),
  constraint social_channels_avatar_url_length check (avatar_url is null or char_length(avatar_url) <= 2048),
  unique (platform, external_channel_id)
);

create index social_channels_profile_enabled_idx
  on public.social_channels (profile_id, is_dashboard_enabled, status);

-- Common parent for videos, posts, shorts, live broadcasts, and future platform content.
create table public.social_contents (
  social_content_id uuid primary key default gen_random_uuid(),
  social_channel_id uuid not null references public.social_channels(social_channel_id) on delete cascade,
  platform public.social_platform not null,
  external_content_id text not null,
  content_type text not null,
  title text,
  body_text text,
  permalink text,
  thumbnail_url text,
  visibility public.social_content_visibility not null default 'unknown',
  source_published_at timestamptz,
  source_updated_at timestamptz,
  current_metrics jsonb not null default '{}'::jsonb,
  source_metadata jsonb not null default '{}'::jsonb,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint social_contents_external_content_id_length check (char_length(external_content_id) between 1 and 255),
  constraint social_contents_content_type_length check (char_length(content_type) between 1 and 64),
  constraint social_contents_permalink_length check (permalink is null or char_length(permalink) <= 2048),
  constraint social_contents_thumbnail_url_length check (thumbnail_url is null or char_length(thumbnail_url) <= 2048),
  constraint social_contents_current_metrics_object check (jsonb_typeof(current_metrics) = 'object'),
  constraint social_contents_source_metadata_object check (jsonb_typeof(source_metadata) = 'object'),
  unique (platform, external_content_id)
);

create index social_contents_channel_published_idx
  on public.social_contents (social_channel_id, source_published_at desc nulls last);

create index social_contents_channel_type_published_idx
  on public.social_contents (social_channel_id, content_type, source_published_at desc nulls last);

-- YouTube-only channel properties that do not belong in the multi-platform channel table.
create table public.youtube_channel_profiles (
  youtube_channel_profile_id uuid primary key default gen_random_uuid(),
  social_channel_id uuid not null unique references public.social_channels(social_channel_id) on delete cascade,
  uploads_playlist_external_id text,
  description text,
  custom_url text,
  country_code char(2),
  default_language text,
  keywords text,
  privacy_status text,
  made_for_kids boolean,
  long_uploads_status text,
  subscriber_count bigint check (subscriber_count is null or subscriber_count >= 0),
  view_count bigint check (view_count is null or view_count >= 0),
  video_count bigint check (video_count is null or video_count >= 0),
  source_metadata jsonb not null default '{}'::jsonb,
  source_retrieved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint youtube_channel_profiles_playlist_id_length check (uploads_playlist_external_id is null or char_length(uploads_playlist_external_id) <= 255),
  constraint youtube_channel_profiles_source_metadata_object check (jsonb_typeof(source_metadata) = 'object')
);

-- YouTube video attributes; current counters live in social_contents.current_metrics.
create table public.youtube_videos (
  youtube_video_id uuid primary key default gen_random_uuid(),
  social_content_id uuid not null unique references public.social_contents(social_content_id) on delete cascade,
  youtube_channel_profile_id uuid not null references public.youtube_channel_profiles(youtube_channel_profile_id) on delete cascade,
  duration_seconds integer check (duration_seconds is null or duration_seconds >= 0),
  category_external_id text,
  tags text[] not null default '{}',
  default_audio_language text,
  default_language text,
  caption_status text,
  definition text,
  dimension text,
  licensed_content boolean,
  made_for_kids boolean,
  self_declared_made_for_kids boolean,
  live_broadcast_content text,
  actual_start_at timestamptz,
  actual_end_at timestamptz,
  scheduled_start_at timestamptz,
  active_live_chat_external_id text,
  source_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint youtube_videos_source_metadata_object check (jsonb_typeof(source_metadata) = 'object')
);

create index youtube_videos_channel_live_idx
  on public.youtube_videos (youtube_channel_profile_id, live_broadcast_content, scheduled_start_at desc nulls last);

-- Fixed, query-efficient metrics used directly by the dashboard.
-- Revenue columns remain null unless the user separately grants monetary analytics scope.
create table public.youtube_channel_daily_metrics (
  youtube_channel_daily_metric_id uuid primary key default gen_random_uuid(),
  social_channel_id uuid not null references public.social_channels(social_channel_id) on delete cascade,
  metric_date date not null,
  views bigint check (views is null or views >= 0),
  engaged_views bigint check (engaged_views is null or engaged_views >= 0),
  estimated_minutes_watched numeric(20, 3) check (estimated_minutes_watched is null or estimated_minutes_watched >= 0),
  average_view_duration_seconds numeric(20, 3) check (average_view_duration_seconds is null or average_view_duration_seconds >= 0),
  average_view_percentage numeric(9, 4) check (average_view_percentage is null or average_view_percentage >= 0),
  likes bigint check (likes is null or likes >= 0),
  dislikes bigint check (dislikes is null or dislikes >= 0),
  comments bigint check (comments is null or comments >= 0),
  shares bigint check (shares is null or shares >= 0),
  subscribers_gained bigint check (subscribers_gained is null or subscribers_gained >= 0),
  subscribers_lost bigint check (subscribers_lost is null or subscribers_lost >= 0),
  videos_published bigint check (videos_published is null or videos_published >= 0),
  impressions bigint check (impressions is null or impressions >= 0),
  impressions_click_through_rate numeric(9, 6) check (impressions_click_through_rate is null or impressions_click_through_rate >= 0),
  estimated_revenue numeric(20, 4),
  estimated_ad_revenue numeric(20, 4),
  estimated_youtube_premium_revenue numeric(20, 4),
  gross_revenue numeric(20, 4),
  ad_impressions bigint check (ad_impressions is null or ad_impressions >= 0),
  monetized_playbacks bigint check (monetized_playbacks is null or monetized_playbacks >= 0),
  cpm numeric(20, 4),
  playback_based_cpm numeric(20, 4),
  revenue_currency char(3),
  source_retrieved_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (social_channel_id, metric_date)
);

create index youtube_channel_daily_metrics_date_idx
  on public.youtube_channel_daily_metrics (metric_date desc);

create table public.youtube_video_daily_metrics (
  youtube_video_daily_metric_id uuid primary key default gen_random_uuid(),
  youtube_video_id uuid not null references public.youtube_videos(youtube_video_id) on delete cascade,
  metric_date date not null,
  views bigint check (views is null or views >= 0),
  engaged_views bigint check (engaged_views is null or engaged_views >= 0),
  estimated_minutes_watched numeric(20, 3) check (estimated_minutes_watched is null or estimated_minutes_watched >= 0),
  average_view_duration_seconds numeric(20, 3) check (average_view_duration_seconds is null or average_view_duration_seconds >= 0),
  average_view_percentage numeric(9, 4) check (average_view_percentage is null or average_view_percentage >= 0),
  likes bigint check (likes is null or likes >= 0),
  dislikes bigint check (dislikes is null or dislikes >= 0),
  comments bigint check (comments is null or comments >= 0),
  shares bigint check (shares is null or shares >= 0),
  impressions bigint check (impressions is null or impressions >= 0),
  impressions_click_through_rate numeric(9, 6) check (impressions_click_through_rate is null or impressions_click_through_rate >= 0),
  estimated_revenue numeric(20, 4),
  estimated_ad_revenue numeric(20, 4),
  monetized_playbacks bigint check (monetized_playbacks is null or monetized_playbacks >= 0),
  source_retrieved_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (youtube_video_id, metric_date)
);

-- Flexible storage for country, traffic source, device, audience, and future Analytics API reports.
create table public.youtube_analytics_breakdowns (
  youtube_analytics_breakdown_id uuid primary key default gen_random_uuid(),
  social_channel_id uuid not null references public.social_channels(social_channel_id) on delete cascade,
  youtube_video_id uuid references public.youtube_videos(youtube_video_id) on delete cascade,
  metric_date date not null,
  report_type text not null,
  dimension_key text not null,
  dimension_hash char(64) not null,
  dimension_values jsonb not null,
  metric_values jsonb not null,
  query_start_date date not null,
  query_end_date date not null,
  source_retrieved_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint youtube_analytics_breakdowns_report_type_length check (char_length(report_type) between 1 and 100),
  constraint youtube_analytics_breakdowns_dimension_key_length check (char_length(dimension_key) between 1 and 255),
  constraint youtube_analytics_breakdowns_dimension_hash_format check (dimension_hash ~ '^[0-9a-f]{64}$'),
  constraint youtube_analytics_breakdowns_dimension_values_object check (jsonb_typeof(dimension_values) = 'object'),
  constraint youtube_analytics_breakdowns_metric_values_object check (jsonb_typeof(metric_values) = 'object'),
  constraint youtube_analytics_breakdowns_date_range check (query_end_date >= query_start_date),
  unique (social_channel_id, metric_date, report_type, dimension_key, dimension_hash)
);

create index youtube_analytics_breakdowns_channel_report_date_idx
  on public.youtube_analytics_breakdowns (social_channel_id, report_type, metric_date desc);

-- Generic comment storage. body_text is plain text only; rendering must still escape it.
create table public.social_comments (
  social_comment_id uuid primary key default gen_random_uuid(),
  social_channel_id uuid not null references public.social_channels(social_channel_id) on delete cascade,
  social_content_id uuid references public.social_contents(social_content_id) on delete cascade,
  platform public.social_platform not null,
  external_comment_id text not null,
  external_thread_id text,
  parent_social_comment_id uuid references public.social_comments(social_comment_id) on delete set null,
  comment_kind public.social_comment_kind not null default 'comment',
  author_external_id text,
  author_display_name text,
  author_avatar_url text,
  author_channel_url text,
  body_text text,
  like_count bigint check (like_count is null or like_count >= 0),
  reply_count bigint check (reply_count is null or reply_count >= 0),
  moderation_status text,
  visibility_status public.social_comment_visibility not null default 'active',
  source_published_at timestamptz,
  source_updated_at timestamptz,
  first_seen_at timestamptz not null default now(),
  last_synced_at timestamptz not null default now(),
  deleted_at timestamptz,
  search_document tsvector generated always as (
    to_tsvector('simple', coalesce(author_display_name, '') || ' ' || coalesce(body_text, ''))
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint social_comments_external_comment_id_length check (char_length(external_comment_id) between 1 and 255),
  constraint social_comments_thread_id_length check (external_thread_id is null or char_length(external_thread_id) <= 255),
  constraint social_comments_author_avatar_url_length check (author_avatar_url is null or char_length(author_avatar_url) <= 2048),
  constraint social_comments_author_channel_url_length check (author_channel_url is null or char_length(author_channel_url) <= 2048),
  unique (platform, external_comment_id)
);

create index social_comments_channel_published_idx
  on public.social_comments (social_channel_id, source_published_at desc nulls last)
  where visibility_status = 'active';

create index social_comments_content_published_idx
  on public.social_comments (social_content_id, source_published_at desc nulls last)
  where visibility_status = 'active';

create index social_comments_parent_published_idx
  on public.social_comments (parent_social_comment_id, source_published_at asc)
  where parent_social_comment_id is not null;

create index social_comments_author_external_idx
  on public.social_comments (social_channel_id, author_external_id)
  where author_external_id is not null;

create index social_comments_search_document_idx
  on public.social_comments using gin (search_document);

create index social_comments_body_trgm_idx
  on public.social_comments using gin (body_text extensions.gin_trgm_ops)
  where body_text is not null;

create index social_comments_author_name_trgm_idx
  on public.social_comments using gin (author_display_name extensions.gin_trgm_ops)
  where author_display_name is not null;

-- Append-only application events feed SSE/WebSocket delivery and preserves sync observability.
create table public.social_comment_events (
  social_comment_event_id uuid primary key default gen_random_uuid(),
  social_channel_id uuid not null references public.social_channels(social_channel_id) on delete cascade,
  social_comment_id uuid not null references public.social_comments(social_comment_id) on delete cascade,
  event_type public.social_comment_event_type not null,
  observed_at timestamptz not null default now(),
  source_occurred_at timestamptz,
  event_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint social_comment_events_payload_object check (jsonb_typeof(event_payload) = 'object')
);

create index social_comment_events_channel_observed_idx
  on public.social_comment_events (social_channel_id, observed_at desc);

create index social_comment_events_comment_observed_idx
  on public.social_comment_events (social_comment_id, observed_at desc);

-- Durable cursor state prevents duplicate polling and lets workers resume after deployment or failure.
create table public.social_comment_sync_states (
  social_comment_sync_state_id uuid primary key default gen_random_uuid(),
  social_channel_id uuid not null references public.social_channels(social_channel_id) on delete cascade,
  social_content_id uuid references public.social_contents(social_content_id) on delete cascade,
  resource_type public.social_comment_sync_resource not null,
  external_resource_id text not null,
  cursor text,
  polling_interval_ms integer check (polling_interval_ms is null or polling_interval_ms >= 1000),
  next_sync_at timestamptz,
  last_success_at timestamptz,
  last_error_code text,
  last_error_at timestamptz,
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint social_comment_sync_states_resource_id_length check (char_length(external_resource_id) between 1 and 255),
  unique (social_channel_id, resource_type, external_resource_id)
);

create index social_comment_sync_states_due_idx
  on public.social_comment_sync_states (next_sync_at asc)
  where next_sync_at is not null;

create table public.platform_sync_jobs (
  platform_sync_job_id uuid primary key default gen_random_uuid(),
  social_channel_id uuid not null references public.social_channels(social_channel_id) on delete cascade,
  social_content_id uuid references public.social_contents(social_content_id) on delete cascade,
  job_kind public.platform_sync_job_kind not null,
  status public.platform_sync_job_status not null default 'queued',
  cursor text,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  scheduled_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  error_code text,
  error_message text,
  result_summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint platform_sync_jobs_result_summary_object check (jsonb_typeof(result_summary) = 'object')
);

create index platform_sync_jobs_queue_idx
  on public.platform_sync_jobs (status, scheduled_at asc)
  where status = 'queued';

create index platform_sync_jobs_channel_created_idx
  on public.platform_sync_jobs (social_channel_id, created_at desc);

create trigger set_platform_oauth_grants_updated_at
  before update on public.platform_oauth_grants
  for each row execute function public.set_updated_at();

create trigger set_social_channels_updated_at
  before update on public.social_channels
  for each row execute function public.set_updated_at();

create trigger set_social_contents_updated_at
  before update on public.social_contents
  for each row execute function public.set_updated_at();

create trigger set_youtube_channel_profiles_updated_at
  before update on public.youtube_channel_profiles
  for each row execute function public.set_updated_at();

create trigger set_youtube_videos_updated_at
  before update on public.youtube_videos
  for each row execute function public.set_updated_at();

create trigger set_youtube_channel_daily_metrics_updated_at
  before update on public.youtube_channel_daily_metrics
  for each row execute function public.set_updated_at();

create trigger set_youtube_video_daily_metrics_updated_at
  before update on public.youtube_video_daily_metrics
  for each row execute function public.set_updated_at();

create trigger set_youtube_analytics_breakdowns_updated_at
  before update on public.youtube_analytics_breakdowns
  for each row execute function public.set_updated_at();

create trigger set_social_comments_updated_at
  before update on public.social_comments
  for each row execute function public.set_updated_at();

create trigger set_social_comment_sync_states_updated_at
  before update on public.social_comment_sync_states
  for each row execute function public.set_updated_at();

create trigger set_platform_sync_jobs_updated_at
  before update on public.platform_sync_jobs
  for each row execute function public.set_updated_at();

alter table public.platform_oauth_grants enable row level security;
alter table public.social_channels enable row level security;
alter table public.social_contents enable row level security;
alter table public.youtube_channel_profiles enable row level security;
alter table public.youtube_videos enable row level security;
alter table public.youtube_channel_daily_metrics enable row level security;
alter table public.youtube_video_daily_metrics enable row level security;
alter table public.youtube_analytics_breakdowns enable row level security;
alter table public.social_comments enable row level security;
alter table public.social_comment_events enable row level security;
alter table public.social_comment_sync_states enable row level security;
alter table public.platform_sync_jobs enable row level security;

revoke all on table public.platform_oauth_grants from anon, authenticated;
revoke all on table public.social_channels from anon, authenticated;
revoke all on table public.social_contents from anon, authenticated;
revoke all on table public.youtube_channel_profiles from anon, authenticated;
revoke all on table public.youtube_videos from anon, authenticated;
revoke all on table public.youtube_channel_daily_metrics from anon, authenticated;
revoke all on table public.youtube_video_daily_metrics from anon, authenticated;
revoke all on table public.youtube_analytics_breakdowns from anon, authenticated;
revoke all on table public.social_comments from anon, authenticated;
revoke all on table public.social_comment_events from anon, authenticated;
revoke all on table public.social_comment_sync_states from anon, authenticated;
revoke all on table public.platform_sync_jobs from anon, authenticated;

-- Atomically claims queued work so multiple server/worker instances never process the same sync job.
create function public.claim_platform_sync_jobs(worker_name text, batch_size integer default 1)
returns setof public.platform_sync_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  safe_batch_size integer := least(greatest(coalesce(batch_size, 1), 1), 10);
begin
  return query
  with next_jobs as (
    select job.platform_sync_job_id
    from public.platform_sync_jobs as job
    where job.status = 'queued'
      and job.scheduled_at <= now()
    order by job.scheduled_at asc, job.created_at asc
    for update skip locked
    limit safe_batch_size
  )
  update public.platform_sync_jobs as job
  set
    status = 'running',
    started_at = coalesce(job.started_at, now()),
    attempt_count = job.attempt_count + 1,
    result_summary = job.result_summary || jsonb_build_object('worker_name', worker_name)
  from next_jobs
  where job.platform_sync_job_id = next_jobs.platform_sync_job_id
  returning job.*;
end;
$$;

revoke all on function public.claim_platform_sync_jobs(text, integer) from public, anon, authenticated;
grant execute on function public.claim_platform_sync_jobs(text, integer) to service_role;
commit;
