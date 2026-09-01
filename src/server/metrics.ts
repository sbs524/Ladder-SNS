import type { Express, Response } from "express";
import { getAuthenticatedUser } from "./auth";
import { getAdminClient, toErrorResponse } from "./supabaseAdmin";

// The dashboard reads every connected platform through this one endpoint, so the aggregation
// below stays platform-agnostic: a new platform only needs its channel rows in social_channels
// and a daily-metrics loader added to loadDailyMetrics().

const PLATFORMS = ["youtube", "instagram", "threads", "x"] as const;
type Platform = (typeof PLATFORMS)[number];

const RANGE_DAYS = { "7d": 7, "30d": 30 } as const;
type RangeKey = keyof typeof RANGE_DAYS;

export type ChannelRow = {
  social_channel_id: string;
  platform: Platform;
  handle: string | null;
  display_name: string;
  avatar_url: string | null;
  last_synced_at: string | null;
  youtube_channel_profiles: ProfileRelation | ProfileRelation[] | null;
};

export type ProfileRelation = { subscriber_count: number | string | null; view_count: number | string | null; video_count: number | string | null };

export type DailyRow = {
  social_channel_id: string;
  metric_date: string;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  subscribers_gained: number;
  subscribers_lost: number;
};

type ContentRow = {
  social_content_id: string;
  social_channel_id: string;
  platform: Platform;
  title: string | null;
  body_text: string | null;
  permalink: string | null;
  thumbnail_url: string | null;
  source_published_at: string | null;
  current_metrics: Record<string, unknown> | null;
};

function sendError(res: Response, status: number, code: string, message: string) {
  return res.status(status).json({ error: { code, message } });
}

export function num(value: unknown): number {
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : 0;
}

export function utcDayString(daysAgo: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - daysAgo);
  return date.toISOString().slice(0, 10);
}

// A zero baseline means we have nothing to compare against yet — the UI shows "–" instead of a
// meaningless +100%.
export function percentChange(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return Number((((current - previous) / previous) * 100).toFixed(1));
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

// 발행일 포함 3일. 영상 성과는 항상 이 초기 구간으로 비교한다 — 누적 조회수로 줄을 세우면
// 오래된 영상이 자동으로 이기기 때문이다. 대시보드 배지와 심층 지표가 같은 숫자를 쓰도록
// 표본 수집은 loadInitialSamples() 한 곳에만 둔다.
export const INITIAL_PERFORMANCE_DAYS = 3;

export type InitialSample = {
  contentId: string;
  channelId: string;
  publishedAt: string;
  initialViews: number;
  shares: number | null;
  durationSeconds: number | null;
  liveBroadcastContent: string | null;
};

export function dayOffset(from: string, days: number) {
  const date = new Date(`${from}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

type VideoRelation = { youtube_video_id: string; duration_seconds: number | null; live_broadcast_content: string | null };

/**
 * 채널의 모든 유튜브 영상에 대해 "발행 직후 N일 조회수"를 모은다. 아직 그 기간을 채우지 못한
 * 영상은 공정한 비교가 불가능하므로 표본에서 빠진다.
 */
export async function loadInitialSamples(db: ReturnType<typeof getAdminClient>, channelIds: string[]): Promise<InitialSample[]> {
  if (channelIds.length === 0) return [];

  const { data: contentData, error: contentError } = await db
    .from("social_contents")
    .select("social_content_id, social_channel_id, source_published_at, youtube_videos(youtube_video_id, duration_seconds, live_broadcast_content)")
    .in("social_channel_id", channelIds)
    .eq("platform", "youtube");
  if (contentError) throw contentError;

  const refs = (contentData || []).flatMap((content) => {
    const relation = content.youtube_videos as VideoRelation | VideoRelation[] | null;
    const video = Array.isArray(relation) ? relation[0] : relation;
    const publishedAt = content.source_published_at as string | null;
    if (!video || !publishedAt) return [];
    return [{
      contentId: content.social_content_id as string,
      channelId: content.social_channel_id as string,
      youtubeVideoId: video.youtube_video_id,
      publishedAt,
      durationSeconds: video.duration_seconds,
      liveBroadcastContent: video.live_broadcast_content,
    }];
  });
  if (refs.length === 0) return [];

  const { data: videoMetrics, error: videoMetricsError } = await db
    .from("youtube_video_daily_metrics")
    .select("youtube_video_id, metric_date, views, shares")
    .in("youtube_video_id", refs.map((ref) => ref.youtubeVideoId));
  if (videoMetricsError) throw videoMetricsError;

  const byVideo = new Map<string, Array<{ date: string; views: number; shares: number | null }>>();
  for (const row of videoMetrics || []) {
    const id = row.youtube_video_id as string;
    const bucket = byVideo.get(id) || [];
    bucket.push({ date: row.metric_date as string, views: num(row.views), shares: row.shares === null ? null : num(row.shares) });
    byVideo.set(id, bucket);
  }

  const today = utcDayString(0);
  return refs.flatMap((ref) => {
    const publishedDay = ref.publishedAt.slice(0, 10);
    const windowEnd = dayOffset(publishedDay, INITIAL_PERFORMANCE_DAYS - 1);
    if (windowEnd > today) return []; // 아직 초기 구간이 끝나지 않은 영상.
    const rows = byVideo.get(ref.youtubeVideoId) || [];
    const inWindow = rows.filter((row) => row.date >= publishedDay && row.date <= windowEnd);
    if (inWindow.length === 0) return [];
    const shareRows = rows.map((row) => row.shares).filter((value): value is number => value !== null);
    return [{
      contentId: ref.contentId,
      channelId: ref.channelId,
      publishedAt: ref.publishedAt,
      initialViews: inWindow.reduce((sum, row) => sum + row.views, 0),
      shares: shareRows.length > 0 ? shareRows.reduce((sum, value) => sum + value, 0) : null,
      durationSeconds: ref.durationSeconds,
      liveBroadcastContent: ref.liveBroadcastContent,
    }];
  });
}

function profileOf(channel: ChannelRow): ProfileRelation | null {
  const relation = channel.youtube_channel_profiles;
  return Array.isArray(relation) ? relation[0] || null : relation;
}

export function emptyTotals() {
  return { views: 0, likes: 0, comments: 0, shares: 0, subscribersGained: 0, subscribersLost: 0 };
}

export type Totals = ReturnType<typeof emptyTotals>;

function addDaily(totals: Totals, row: DailyRow) {
  totals.views += row.views;
  totals.likes += row.likes;
  totals.comments += row.comments;
  totals.shares += row.shares;
  totals.subscribersGained += row.subscribers_gained;
  totals.subscribersLost += row.subscribers_lost;
}

function addTotals(target: Totals, source: Totals) {
  target.views += source.views;
  target.likes += source.likes;
  target.comments += source.comments;
  target.shares += source.shares;
  target.subscribersGained += source.subscribersGained;
  target.subscribersLost += source.subscribersLost;
}

// Engagement rate is defined here and only here: reactions per view over the selected range.
// Every number the dashboard shows as "참여율" comes from this formula.
export function engagementRate(totals: Totals) {
  if (totals.views <= 0) return 0;
  return Number((((totals.likes + totals.comments + totals.shares) / totals.views) * 100).toFixed(1));
}

// 조회수 대비 신규 구독. 순증(획득-이탈)이 아니라 획득만 쓴다 — 이탈은 이 기간에 보지도 않은
// 과거 영상 때문에도 일어나므로, 섞으면 "이 기간 콘텐츠의 구독 전환력"이라는 뜻이 흐려진다.
export function subscriberConversionRate(totals: Totals): number | null {
  if (totals.views <= 0) return null;
  return Number(((totals.subscribersGained / totals.views) * 100).toFixed(2));
}

export async function loadDailyMetrics(db: ReturnType<typeof getAdminClient>, channels: ChannelRow[], since: string): Promise<DailyRow[]> {
  const youtubeChannelIds = channels.filter((channel) => channel.platform === "youtube").map((channel) => channel.social_channel_id);
  if (youtubeChannelIds.length === 0) return [];
  const { data, error } = await db
    .from("youtube_channel_daily_metrics")
    .select("social_channel_id, metric_date, views, likes, comments, shares, subscribers_gained, subscribers_lost")
    .in("social_channel_id", youtubeChannelIds)
    .gte("metric_date", since)
    .order("metric_date", { ascending: true });
  if (error) throw error;
  return (data || []).map((row) => ({
    social_channel_id: row.social_channel_id as string,
    metric_date: row.metric_date as string,
    views: num(row.views),
    likes: num(row.likes),
    comments: num(row.comments),
    shares: num(row.shares),
    subscribers_gained: num(row.subscribers_gained),
    subscribers_lost: num(row.subscribers_lost),
  }));
}

export function registerMetricsRoutes(app: Express) {
  app.get("/api/metrics/overview", async (req, res) => {
    try {
      const authenticatedUser = await getAuthenticatedUser(req);
      if (!authenticatedUser) return sendError(res, 401, "UNAUTHENTICATED", "A valid session is required.");

      const range: RangeKey = req.query.range === "30d" ? "30d" : "7d";
      const days = RANGE_DAYS[range];
      const db = getAdminClient();

      const { data: channelData, error: channelError } = await db
        .from("social_channels")
        .select("social_channel_id, platform, handle, display_name, avatar_url, last_synced_at, youtube_channel_profiles(subscriber_count, view_count, video_count)")
        .eq("profile_id", authenticatedUser.user.id)
        .eq("is_dashboard_enabled", true)
        .eq("status", "active")
        .order("created_at", { ascending: true });
      if (channelError) throw channelError;
      const channels = (channelData || []) as unknown as ChannelRow[];

      // Two windows of history so the current range can be compared against the one before it.
      const currentWindowStart = utcDayString(days - 1);
      const dailyRows = await loadDailyMetrics(db, channels, utcDayString(days * 2 - 1));

      const channelPlatform = new Map(channels.map((channel) => [channel.social_channel_id, channel.platform]));
      const currentTotals = new Map<Platform, Totals>();
      const previousTotals = new Map<Platform, Totals>();
      const chartBuckets = new Map<string, Map<Platform, number>>();

      for (const row of dailyRows) {
        const platform = channelPlatform.get(row.social_channel_id);
        if (!platform) continue;
        const isCurrent = row.metric_date >= currentWindowStart;
        const bucket = isCurrent ? currentTotals : previousTotals;
        const totals = bucket.get(platform) || emptyTotals();
        addDaily(totals, row);
        bucket.set(platform, totals);
        if (!isCurrent) continue;
        const day = chartBuckets.get(row.metric_date) || new Map<Platform, number>();
        day.set(platform, (day.get(platform) || 0) + row.views);
        chartBuckets.set(row.metric_date, day);
      }

      const channelIds = channels.map((channel) => channel.social_channel_id);
      let contents: ContentRow[] = [];
      if (channelIds.length > 0) {
        const { data: contentData, error: contentError } = await db
          .from("social_contents")
          .select("social_content_id, social_channel_id, platform, title, body_text, permalink, thumbnail_url, source_published_at, current_metrics")
          .in("social_channel_id", channelIds)
          .order("source_published_at", { ascending: false, nullsFirst: false })
          .limit(12);
        if (contentError) throw contentError;
        contents = (contentData || []) as unknown as ContentRow[];
      }

      // 채널 자기 자신의 초기 성과 중앙값. 최근 영상이 평소보다 잘 됐는지를 남과 비교하지 않고
      // 이 채널의 평소치와 비교해서 보여준다.
      const initialSamples = await loadInitialSamples(db, channelIds);
      const initialViewsByContent = new Map(initialSamples.map((sample) => [sample.contentId, sample.initialViews]));
      const initialViewsMedian = median(initialSamples.map((sample) => sample.initialViews));

      const platforms = PLATFORMS.map((platform) => {
        const platformChannels = channels.filter((channel) => channel.platform === platform);
        const current = currentTotals.get(platform) || emptyTotals();
        const previous = previousTotals.get(platform) || emptyTotals();
        const followers = platformChannels.reduce((sum, channel) => sum + num(profileOf(channel)?.subscriber_count), 0);
        const postsCount = platformChannels.reduce((sum, channel) => sum + num(profileOf(channel)?.video_count), 0);
        const primary = platformChannels[0];
        return {
          platform,
          connected: platformChannels.length > 0,
          channelCount: platformChannels.length,
          handle: primary?.handle || null,
          displayName: primary?.display_name || null,
          avatarUrl: primary?.avatar_url || null,
          followers,
          followersChange: current.subscribersGained - current.subscribersLost,
          subscribersGained: current.subscribersGained,
          subscribersLost: current.subscribersLost,
          subscriberConversionRate: subscriberConversionRate(current),
          views: current.views,
          viewsChangePercent: percentChange(current.views, previous.views),
          engagementRate: engagementRate(current),
          postsCount,
          lastSyncedAt: platformChannels.reduce<string | null>((latest, channel) => {
            if (!channel.last_synced_at) return latest;
            return !latest || channel.last_synced_at > latest ? channel.last_synced_at : latest;
          }, null),
        };
      });

      const connectedPlatforms = platforms.filter((platform) => platform.connected);
      const overallCurrent = emptyTotals();
      const overallPrevious = emptyTotals();
      for (const totals of currentTotals.values()) addTotals(overallCurrent, totals);
      for (const totals of previousTotals.values()) addTotals(overallPrevious, totals);

      // One point per calendar day so gaps in the synced data render as 0 instead of collapsing
      // the x-axis.
      const chart = Array.from({ length: days }, (_, index) => {
        const date = utcDayString(days - 1 - index);
        const day = chartBuckets.get(date);
        const point: Record<string, string | number> = { date: `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`, isoDate: date, total: 0 };
        for (const platform of PLATFORMS) {
          const views = day?.get(platform) || 0;
          point[platform] = views;
          point.total = num(point.total) + views;
        }
        return point;
      });

      const recentPosts = contents.map((content) => {
        const metrics = content.current_metrics || {};
        const initialViews = initialViewsByContent.get(content.social_content_id) ?? null;
        return {
          id: content.social_content_id,
          initialViews,
          // 표본이 없거나 초기 구간이 아직 안 끝난 영상은 배지를 띄우지 않는다.
          medianMultiple: initialViews !== null && initialViewsMedian > 0 ? Number((initialViews / initialViewsMedian).toFixed(2)) : null,
          // 영상 문구 편집(PATCH .../videos/:contentId)이 채널 ID를 필요로 한다.
          socialChannelId: content.social_channel_id,
          platform: content.platform,
          title: content.title || content.body_text || "제목 없음",
          publishedAt: content.source_published_at,
          permalink: content.permalink,
          thumbnailUrl: content.thumbnail_url,
          views: num(metrics.viewCount),
          likes: num(metrics.likeCount),
          comments: num(metrics.commentCount),
          shares: 0,
        };
      });

      return res.status(200).json({
        range,
        days,
        hasData: dailyRows.length > 0,
        connectedCount: connectedPlatforms.length,
        totals: {
          followers: platforms.reduce((sum, platform) => sum + platform.followers, 0),
          views: overallCurrent.views,
          engagementRate: engagementRate(overallCurrent),
          growthPercent: percentChange(overallCurrent.views, overallPrevious.views),
          subscribersGained: overallCurrent.subscribersGained,
          subscribersLost: overallCurrent.subscribersLost,
          subscriberConversionRate: subscriberConversionRate(overallCurrent),
        },
        platforms,
        chart,
        recentPosts,
      });
    } catch (error) {
      return toErrorResponse(res, error, "METRICS_OVERVIEW_FAILED");
    }
  });
}
