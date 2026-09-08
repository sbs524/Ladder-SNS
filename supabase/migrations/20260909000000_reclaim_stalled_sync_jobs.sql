-- 워커가 잡을 잡은 채로 죽으면(배포 전환, 무료 인스턴스 스핀다운, 응답 없는 API 호출)
-- 그 행은 'running'으로 영원히 남는다. 기존 claim 함수는 'queued'만 집어가므로 아무도
-- 회수하지 않고, 스케줄러는 running을 "이미 처리 중"으로 보고 새 잡도 넣지 않는다.
-- 결과: 채널 하나가 죽은 행 하나에 영구히 막힌다.
--
-- 오래 매달린 잡을 회수하고, 몇 번을 되풀이해도 못 끝내는 잡은 실패로 닫는다.
begin;

-- 실제로 도는 잡을 뺏지 않도록 넉넉히 잡는다. 지금까지 관측된 가장 무거운 full 잡이 약 6분이다.
create or replace function public.claim_platform_sync_jobs(worker_name text, batch_size integer default 1)
returns setof public.platform_sync_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  safe_batch_size integer := least(greatest(coalesce(batch_size, 1), 1), 10);
  stall_deadline timestamptz := now() - interval '15 minutes';
  max_attempts constant integer := 3;
begin
  -- 되풀이해도 끝나지 않는 잡은 무한 회수 대상이 되지 않도록 닫아 둔다.
  update public.platform_sync_jobs as job
  set
    status = 'failed',
    finished_at = now(),
    error_code = coalesce(job.error_code, 'SYNC_STALLED'),
    error_message = coalesce(job.error_message, 'The worker stopped responding and the job exceeded its retry budget.')
  where job.status = 'running'
    and job.started_at < stall_deadline
    and job.attempt_count >= max_attempts;

  return query
  with next_jobs as (
    select job.platform_sync_job_id
    from public.platform_sync_jobs as job
    where (
        (job.status = 'queued' and job.scheduled_at <= now())
        or (job.status = 'running' and job.started_at < stall_deadline and job.attempt_count < max_attempts)
      )
    order by job.scheduled_at asc, job.created_at asc
    for update skip locked
    limit safe_batch_size
  )
  update public.platform_sync_jobs as job
  set
    status = 'running',
    started_at = now(),
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
