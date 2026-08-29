-- The previous migration revoked anon/authenticated access to these tables but never granted
-- service_role access. This project has auto-expose-to-Data-API-roles disabled, so service_role
-- needs explicit GRANTs even though it already bypasses RLS. Without this, every server query
-- against these tables fails with "permission denied" (42501).

begin;

grant select, insert, update, delete on public.platform_oauth_grants to service_role;
grant select, insert, update, delete on public.social_channels to service_role;
grant select, insert, update, delete on public.social_contents to service_role;
grant select, insert, update, delete on public.youtube_channel_profiles to service_role;
grant select, insert, update, delete on public.youtube_videos to service_role;
grant select, insert, update, delete on public.youtube_channel_daily_metrics to service_role;
grant select, insert, update, delete on public.youtube_video_daily_metrics to service_role;
grant select, insert, update, delete on public.youtube_analytics_breakdowns to service_role;
grant select, insert, update, delete on public.social_comments to service_role;
grant select, insert, update, delete on public.social_comment_events to service_role;
grant select, insert, update, delete on public.social_comment_sync_states to service_role;
grant select, insert, update, delete on public.platform_sync_jobs to service_role;

commit;
