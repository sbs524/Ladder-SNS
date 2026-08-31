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
        return {
          id: content.social_content_id,
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
