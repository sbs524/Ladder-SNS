import type { Express, Response } from "express";
import { getAuthenticatedUser, getPlanForProfile } from "./auth";
import { getAdminClient, toErrorResponse } from "./supabaseAdmin";
import { num, utcDayString } from "./metrics";

// Deep engagement metrics for the AI analysis screen. Every formula here is specified in
// docs/과금_및_지표_정의.md §5 — change one and change the other.
//
// Everything below is computed from data the sync already stores. The two metrics that still
// need collection work (saveRate → videosAddedToPlaylists, per-video shares) return null and
// the UI shows "–" until those columns exist.

const KST_OFFSET_MS = 9 * 60 * 60 * 1000; // Korea has no DST, so a fixed offset is exact.

// Deep metrics need more history than the dashboard's 7-day default to be meaningful.
const RANGE_DAYS = { "30d": 30, "90d": 90 } as const;
type RangeKey = keyof typeof RANGE_DAYS;

const TIME_SLOTS = [
  { id: "dawn", label: "새벽 00–06시", fromHour: 0 },
  { id: "morning", label: "오전 06–12시", fromHour: 6 },
  { id: "afternoon", label: "오후 12–18시", fromHour: 12 },
  { id: "evening", label: "저녁 18–24시", fromHour: 18 },
] as const;
type SlotId = (typeof TIME_SLOTS)[number]["id"];

// Minimum sample sizes. Below these we report "not enough data" rather than a number, because a
// confident recommendation drawn from four videos is indistinguishable from the mock it replaces.
const MIN_VIDEOS_FOR_PEAK_TIME = 12;
const MIN_VIDEOS_PER_SLOT = 3;
const MIN_VIDEOS_PER_FORMAT = 3;
const INITIAL_PERFORMANCE_DAYS = 3; // 발행일 포함 3일
const MIN_SUBSCRIBERS_FOR_REACH = 10;

// Plus-only fields. The basic engagement ratios stay free so that connecting a channel is still
// worth doing on the free plan (기획서 6.1) — what Plus buys is the interpretation layer.
//
// These are withheld by the server, not hidden by the client. A CSS blur over data that was
// already sent is not a paywall; anyone can read it in devtools.
const PLUS_ONLY_FIELDS = ["retentionRate", "clickThroughRate", "saveRate", "topAudienceAge", "virality", "peakTime", "formats", "bestFormat"] as const;

export type FormatId = "shorts" | "midform" | "longform" | "live";

const FORMAT_LABELS: Record<FormatId, string> = {
  shorts: "쇼츠 (3분 이하)",
  midform: "미들폼 (3~10분)",
  longform: "롱폼 (10분 초과)",
  live: "라이브",
};

/**
 * Shared 0~100 normalisation. Logarithmic because reach and view counts are long-tailed: with a
 * linear curve one breakout video pins every score at 100.
 *
 * 0.25x → 0, 0.5x → 25, 1x → 50, 2x → 75, 4x+ → 100.
 */
export function norm(value: number, ref: number): number {
  if (!(value > 0) || !(ref > 0)) return 0;
  return Math.max(0, Math.min(100, 50 + 25 * Math.log2(value / ref)));
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

/**
 * Averages a rate by views rather than by row. A day with 10 views and a day with 10,000 must not
 * carry the same weight.
 */
export function weightedAverage(samples: Array<{ value: number | null; weight: number }>): number | null {
  let weighted = 0;
  let totalWeight = 0;
  for (const sample of samples) {
    if (sample.value === null || !Number.isFinite(sample.value) || sample.weight <= 0) continue;
    weighted += sample.value * sample.weight;
    totalWeight += sample.weight;
  }
  return totalWeight > 0 ? weighted / totalWeight : null;
}

export function kstSlot(publishedAt: string): SlotId | null {
  const time = new Date(publishedAt).getTime();
  if (Number.isNaN(time)) return null;
  const hour = new Date(time + KST_OFFSET_MS).getUTCHours();
  let slot: SlotId = "dawn";
  for (const candidate of TIME_SLOTS) if (hour >= candidate.fromHour) slot = candidate.id;
  return slot;
}

export function classifyFormat(durationSeconds: number | null, liveBroadcastContent: string | null): FormatId {
  if (liveBroadcastContent && liveBroadcastContent !== "none") return "live";
  const duration = num(durationSeconds);
  if (duration <= 180) return "shorts";
  if (duration <= 600) return "midform";
  return "longform";
}

export type ViralityInput = {
  views: number;
  subscribers: number;
  likes: number;
  comments: number;
  shares: number;
  /** Views from viewers who are not subscribed, from the subscribed_status breakdown. */
  nonSubscriberViews: number | null;
};

export type ViralityResult = {
  score: number | null;
  /** Why the score is null, or which components were dropped and the weights renormalised. */
  note: string | null;
  components: {
    reachMultiple: number | null;
    engagementRate: number;
    nonSubscriberShare: number | null;
    shareRate: number;
  };
};

/**
 * Virality = how far content travelled beyond the existing subscriber base. Reach multiple and
 * non-subscriber share carry 65% between them for that reason; engagement and share rate are
 * corroborating signals. Reference values are assumptions — see 과금_및_지표_정의.md §5.2.
 */
export function viralityScore(input: ViralityInput): ViralityResult {
  const reachMultiple = input.subscribers >= MIN_SUBSCRIBERS_FOR_REACH ? input.views / input.subscribers : null;
  const engagementRate = input.views > 0 ? ((input.likes + input.comments + input.shares) / input.views) * 100 : 0;
  const nonSubscriberShare =
    input.nonSubscriberViews !== null && input.views > 0 ? (input.nonSubscriberViews / input.views) * 100 : null;
  const shareRate = input.views > 0 ? (input.shares / input.views) * 1000 : 0;

  const components = { reachMultiple, engagementRate, nonSubscriberShare, shareRate };

  if (input.views <= 0) return { score: null, note: "기간 내 조회수가 없어 점수를 계산할 수 없습니다.", components };

  // Weights are renormalised over whatever is available so a missing component shifts the balance
  // instead of silently scoring zero.
  const parts: Array<{ weight: number; score: number }> = [
    { weight: 0.2, score: norm(engagementRate, 5) },
    { weight: 0.15, score: norm(shareRate, 2) },
  ];
  const dropped: string[] = [];
  if (reachMultiple !== null) parts.push({ weight: 0.35, score: norm(reachMultiple, 0.5) });
  else dropped.push(`구독자 ${MIN_SUBSCRIBERS_FOR_REACH}명 미만`);
  if (nonSubscriberShare !== null) parts.push({ weight: 0.3, score: norm(nonSubscriberShare, 50) });
  else dropped.push("구독 상태별 데이터 없음");

  const totalWeight = parts.reduce((sum, part) => sum + part.weight, 0);
  const score = Math.round(parts.reduce((sum, part) => sum + part.weight * part.score, 0) / totalWeight);
  return { score, note: dropped.length > 0 ? `${dropped.join(", ")} — 가중치를 재정규화했습니다.` : null, components };
}

export type VideoSample = { publishedAt: string | null; initialViews: number; format: FormatId; shares: number | null };

export type PeakTimeResult = {
  available: boolean;
  reason: string | null;
  totalVideos: number;
  best: { slot: SlotId; label: string; multiple: number; videoCount: number } | null;
  slots: Array<{ slot: SlotId; label: string; multiple: number | null; videoCount: number }>;
};

/**
 * The YouTube Analytics API has no hour dimension, so "best time to post" cannot be fetched — it is
 * derived here from this channel's own upload history: median initial performance per KST time slot,
 * as a multiple of the channel's overall median.
 *
 * Median, not mean: with few videos a single breakout would own whichever slot it landed in.
 *
 * This is correlation, not causation. Present it as "videos posted then did better", never as
 * "post at this time".
 */
export function peakTimeByUploadSlot(videos: VideoSample[]): PeakTimeResult {
  const dated = videos.filter((video) => video.publishedAt && kstSlot(video.publishedAt) !== null);
  const overallMedian = median(dated.map((video) => video.initialViews));

  const bySlot = new Map<SlotId, number[]>();
  for (const video of dated) {
    const slot = kstSlot(video.publishedAt as string) as SlotId;
    const bucket = bySlot.get(slot) || [];
    bucket.push(video.initialViews);
    bySlot.set(slot, bucket);
  }

  const slots = TIME_SLOTS.map((definition) => {
    const bucket = bySlot.get(definition.id) || [];
    const enough = bucket.length >= MIN_VIDEOS_PER_SLOT && overallMedian > 0;
    return {
      slot: definition.id as SlotId,
      label: definition.label,
      multiple: enough ? Number((median(bucket) / overallMedian).toFixed(2)) : null,
      videoCount: bucket.length,
    };
  });

  if (dated.length < MIN_VIDEOS_FOR_PEAK_TIME) {
    return {
      available: false,
      reason: `영상 ${MIN_VIDEOS_FOR_PEAK_TIME}개 이상부터 집계합니다. 현재 ${dated.length}개.`,
      totalVideos: dated.length,
      best: null,
      slots,
    };
  }

  const ranked = slots.filter((slot) => slot.multiple !== null).sort((a, b) => (b.multiple as number) - (a.multiple as number));
  if (ranked.length === 0) {
    return {
      available: false,
      reason: `시간대별로 영상이 ${MIN_VIDEOS_PER_SLOT}개 이상 쌓여야 비교할 수 있습니다.`,
      totalVideos: dated.length,
      best: null,
      slots,
    };
  }
  const top = ranked[0];
  return {
    available: true,
    reason: null,
    totalVideos: dated.length,
    best: { slot: top.slot, label: top.label, multiple: top.multiple as number, videoCount: top.videoCount },
    slots,
  };
}

export type FormatStat = {
  format: FormatId;
  formatName: string;
  videoCount: number;
  medianInitialViews: number;
  medianShares: number | null;
  efficiencyScore: number | null;
};

export function formatStats(videos: VideoSample[]): { stats: FormatStat[]; best: FormatStat | null } {
  const overallMedian = median(videos.map((video) => video.initialViews));
  const byFormat = new Map<FormatId, VideoSample[]>();
  for (const video of videos) {
    const bucket = byFormat.get(video.format) || [];
    bucket.push(video);
    byFormat.set(video.format, bucket);
  }

  const stats = (Object.keys(FORMAT_LABELS) as FormatId[])
    .map((format) => {
      const bucket = byFormat.get(format) || [];
      const shareSamples = bucket.map((video) => video.shares).filter((value): value is number => value !== null);
      const enough = bucket.length >= MIN_VIDEOS_PER_FORMAT && overallMedian > 0;
      const medianInitialViews = median(bucket.map((video) => video.initialViews));
      return {
        format,
        formatName: FORMAT_LABELS[format],
        videoCount: bucket.length,
        medianInitialViews,
        medianShares: shareSamples.length > 0 ? median(shareSamples) : null,
        efficiencyScore: enough ? Math.round(norm(medianInitialViews / overallMedian, 1)) : null,
      };
    })
    .filter((stat) => stat.videoCount > 0);

  const ranked = stats.filter((stat) => stat.efficiencyScore !== null);
  ranked.sort((a, b) => (b.efficiencyScore as number) - (a.efficiencyScore as number));
  return { stats, best: ranked[0] || null };
}

function sendError(res: Response, status: number, code: string, message: string) {
  return res.status(status).json({ error: { code, message } });
}

function dayOffset(from: string, days: number) {
  const date = new Date(`${from}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function registerInsightsRoutes(app: Express) {
  app.get("/api/metrics/insights", async (req, res) => {
    try {
      const authenticatedUser = await getAuthenticatedUser(req);
      if (!authenticatedUser) return sendError(res, 401, "UNAUTHENTICATED", "A valid session is required.");

      const plan = await getPlanForProfile(authenticatedUser.user.id);
      const range: RangeKey = req.query.range === "90d" ? "90d" : "30d";
      const days = RANGE_DAYS[range];
      const since = utcDayString(days - 1);
      const db = getAdminClient();

      const { data: channelData, error: channelError } = await db
        .from("social_channels")
        .select("social_channel_id, platform, display_name, handle, youtube_channel_profiles(youtube_channel_profile_id, subscriber_count)")
        .eq("profile_id", authenticatedUser.user.id)
        .eq("platform", "youtube")
        .eq("is_dashboard_enabled", true)
        .eq("status", "active");
      if (channelError) throw channelError;
      const channels = channelData || [];
      if (channels.length === 0) {
        return res.status(200).json({ range, days, plan, connected: false, channels: [] });
      }
      const channelIds = channels.map((channel) => channel.social_channel_id as string);

      const [dailyResult, breakdownResult, contentResult] = await Promise.all([
        db
          .from("youtube_channel_daily_metrics")
          .select("social_channel_id, views, likes, comments, shares, average_view_percentage, impressions_click_through_rate")
          .in("social_channel_id", channelIds)
          .gte("metric_date", since),
        db
          .from("youtube_analytics_breakdowns")
          .select("social_channel_id, report_type, dimension_values, metric_values")
          .in("social_channel_id", channelIds)
          .in("report_type", ["subscribed_status", "audience"])
          .gte("metric_date", since),
        db
          .from("social_contents")
          .select("social_content_id, social_channel_id, source_published_at, youtube_videos(youtube_video_id, duration_seconds, live_broadcast_content)")
          .in("social_channel_id", channelIds)
          .eq("platform", "youtube"),
      ]);
      if (dailyResult.error) throw dailyResult.error;
      if (breakdownResult.error) throw breakdownResult.error;
      if (contentResult.error) throw contentResult.error;

      type VideoRef = { youtubeVideoId: string; channelId: string; publishedAt: string | null; format: FormatId };
      const videoRefs: VideoRef[] = [];
      for (const content of contentResult.data || []) {
        const relation = content.youtube_videos as { youtube_video_id: string; duration_seconds: number | null; live_broadcast_content: string | null } | null | Array<{ youtube_video_id: string; duration_seconds: number | null; live_broadcast_content: string | null }>;
        const video = Array.isArray(relation) ? relation[0] : relation;
        if (!video) continue;
        videoRefs.push({
          youtubeVideoId: video.youtube_video_id,
          channelId: content.social_channel_id as string,
          publishedAt: (content.source_published_at as string | null) || null,
          format: classifyFormat(video.duration_seconds, video.live_broadcast_content),
        });
      }

      // Initial performance is per-video views over the first few days after publishing, so that
      // older videos do not automatically outrank recent ones.
      const videoDaily = new Map<string, Array<{ date: string; views: number; shares: number | null }>>();
      if (videoRefs.length > 0) {
        const { data: videoMetrics, error: videoMetricsError } = await db
          .from("youtube_video_daily_metrics")
          .select("youtube_video_id, metric_date, views, shares")
          .in("youtube_video_id", videoRefs.map((video) => video.youtubeVideoId));
        if (videoMetricsError) throw videoMetricsError;
        for (const row of videoMetrics || []) {
          const id = row.youtube_video_id as string;
          const bucket = videoDaily.get(id) || [];
          bucket.push({ date: row.metric_date as string, views: num(row.views), shares: row.shares === null ? null : num(row.shares) });
          videoDaily.set(id, bucket);
        }
      }

      const todayString = utcDayString(0);
      const samplesByChannel = new Map<string, VideoSample[]>();
      for (const video of videoRefs) {
        if (!video.publishedAt) continue;
        const publishedDay = video.publishedAt.slice(0, 10);
        const windowEnd = dayOffset(publishedDay, INITIAL_PERFORMANCE_DAYS - 1);
        // Videos younger than the window have not had a fair chance yet.
        if (windowEnd > todayString) continue;
        const rows = videoDaily.get(video.youtubeVideoId) || [];
        const inWindow = rows.filter((row) => row.date >= publishedDay && row.date <= windowEnd);
        if (inWindow.length === 0) continue;
        const shareRows = rows.map((row) => row.shares).filter((value): value is number => value !== null);
        const bucket = samplesByChannel.get(video.channelId) || [];
        bucket.push({
          publishedAt: video.publishedAt,
          initialViews: inWindow.reduce((sum, row) => sum + row.views, 0),
          format: video.format,
          shares: shareRows.length > 0 ? shareRows.reduce((sum, value) => sum + value, 0) : null,
        });
        samplesByChannel.set(video.channelId, bucket);
      }

      const result = channels.map((channel) => {
        const channelId = channel.social_channel_id as string;
        const profileRelation = channel.youtube_channel_profiles as { subscriber_count: number | string | null } | null | Array<{ subscriber_count: number | string | null }>;
        const profile = Array.isArray(profileRelation) ? profileRelation[0] : profileRelation;
        const daily = (dailyResult.data || []).filter((row) => row.social_channel_id === channelId);

        const totals = daily.reduce(
          (accumulator, row) => {
            accumulator.views += num(row.views);
            accumulator.likes += num(row.likes);
            accumulator.comments += num(row.comments);
            accumulator.shares += num(row.shares);
            return accumulator;
          },
          { views: 0, likes: 0, comments: 0, shares: 0 },
        );

        let nonSubscriberViews: number | null = null;
        const ageGroups = new Map<string, number>();
        for (const row of breakdownResult.data || []) {
          if (row.social_channel_id !== channelId) continue;
          const dimensions = (row.dimension_values || {}) as Record<string, unknown>;
          const metrics = (row.metric_values || {}) as Record<string, unknown>;
          if (row.report_type === "subscribed_status") {
            if (String(dimensions.subscribedStatus).toUpperCase() === "UNSUBSCRIBED") {
              nonSubscriberViews = (nonSubscriberViews || 0) + num(metrics.views);
            }
          } else if (row.report_type === "audience") {
            const ageGroup = String(dimensions.ageGroup || "");
            if (ageGroup) ageGroups.set(ageGroup, (ageGroups.get(ageGroup) || 0) + num(metrics.views));
          }
        }

        const audienceTotal = [...ageGroups.values()].reduce((sum, value) => sum + value, 0);
        const topAge = [...ageGroups.entries()].sort((a, b) => b[1] - a[1])[0];

        const samples = samplesByChannel.get(channelId) || [];
        const formats = formatStats(samples);
        const subscribers = num(profile?.subscriber_count);

        return {
          socialChannelId: channelId,
          displayName: channel.display_name,
          handle: channel.handle,
          subscribers,
          engagementRate: totals.views > 0 ? Number((((totals.likes + totals.comments + totals.shares) / totals.views) * 100).toFixed(2)) : 0,
          shareRate: totals.views > 0 ? Number(((totals.shares / totals.views) * 100).toFixed(2)) : 0,
          commentRatio: totals.views > 0 ? Number(((totals.comments / totals.views) * 100).toFixed(2)) : 0,
          retentionRate: weightedAverage(daily.map((row) => ({ value: row.average_view_percentage === null ? null : num(row.average_view_percentage), weight: num(row.views) }))),
          clickThroughRate: weightedAverage(daily.map((row) => ({ value: row.impressions_click_through_rate === null ? null : num(row.impressions_click_through_rate) * 100, weight: num(row.views) }))),
          // Needs the videosAddedToPlaylists metric added to the channel daily sync — see §5.5.
          saveRate: null,
          topAudienceAge: topAge && audienceTotal > 0 ? { ageGroup: topAge[0], sharePercent: Number(((topAge[1] / audienceTotal) * 100).toFixed(1)) } : null,
          virality: viralityScore({ ...totals, subscribers, nonSubscriberViews }),
          peakTime: peakTimeByUploadSlot(samples),
          formats: formats.stats,
          bestFormat: formats.best,
        };
      });

      const payload =
        plan === "plus"
          ? result.map((channel) => ({ ...channel, locked: false, lockedFields: [] as string[] }))
          : result.map((channel) => {
              const visible = { ...channel } as Record<string, unknown>;
              for (const field of PLUS_ONLY_FIELDS) visible[field] = null;
              return { ...visible, locked: true, lockedFields: [...PLUS_ONLY_FIELDS] };
            });

      return res.status(200).json({ range, days, plan, connected: true, channels: payload });
    } catch (error) {
      return toErrorResponse(res, error, "METRICS_INSIGHTS_FAILED");
    }
  });
}
