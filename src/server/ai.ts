import type { Express, Request, Response } from "express";
import { GoogleGenAI } from "@google/genai";
import { getAuthenticatedUser, getPlanForProfile, type BillingPlan } from "./auth";
import { getUsage, planAiCall, recordUsage } from "./usage";
import { ApiError, getAdminClient, requireString, toErrorResponse } from "./supabaseAdmin";
import {
  emptyTotals,
  engagementRate,
  loadDailyMetrics,
  num,
  percentChange,
  utcDayString,
  type ChannelRow,
  type Totals,
} from "./metrics";

// AI 종합 진단(analyze)과 1:1 컨설턴트(advisor). 둘 다 Plus 전용이고, 둘 다 프롬프트에 들어가는
// 숫자를 서버가 DB에서 직접 만든다.
//
// 이 파일이 지키는 두 가지 규칙:
//
//  1. 지표는 요청 본문에서 받지 않는다. 예전 구현은 클라이언트가 보낸 platformStats를 그대로
//     프롬프트에 넣었는데, 그 값은 컴포넌트에 박힌 상수(322,400 / 4,190,600 / 7.7%)였다.
//     AI가 실존하지 않는 채널을 진단하고 있었다는 뜻이다.
//  2. AI를 못 쓰면 실패한다. 예전 구현은 GEMINI_API_KEY가 없을 때 미리 써둔 조언 문단을
//     success: true로 반환했다. 사람이 쓴 문장을 AI 답변으로 보여주는 건 기능이 아니라 거짓말이다.

// 리포트·심층 분석·컨설턴트 전부 같은 모델을 쓴다 — docs/과금_및_지표_정의.md §7.
const DEFAULT_MODEL = "gemini-3.7-flash";
const REPORT_RANGE_DAYS = 30;
const ADVISOR_RANGE_DAYS = 30;
const MAX_QUERY_LENGTH = 1000;
// YouTube videos.update의 제약과 같은 값 — 서버가 초안을 만들 때부터 넘지 않게 한다.
const MAX_VIDEO_TITLE = 100;
const MAX_VIDEO_DESCRIPTION = 5000;
const MAX_HISTORY_TURNS = 10;

function model() {
  return process.env.GEMINI_MODEL || DEFAULT_MODEL;
}

let client: GoogleGenAI | null = null;
function getGenAI(): GoogleGenAI {
  const apiKey = requireString(process.env.GEMINI_API_KEY, "GEMINI_API_KEY");
  if (!client) client = new GoogleGenAI({ apiKey });
  return client;
}

function sendError(res: Response, status: number, code: string, message: string) {
  return res.status(status).json({ error: { code, message } });
}

export type ChannelSnapshot = {
  platform: string;
  displayName: string;
  handle: string | null;
  subscribers: number;
  totalVideos: number;
  /** 채널 개설 이후 누적 조회수. 동기화가 아직 안 돌았어도 프로필에는 있다. */
  lifetimeViews: number;
  /** 기간 내 일별 지표가 실제로 쌓인 날 수. 0이면 아래 기간 집계는 전부 0이며, 실적이 없다는 뜻이 아니다. */
  daysWithMetrics: number;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  subscribersGained: number;
  subscribersLost: number;
  engagementRatePercent: number;
  viewsChangePercentVsPreviousPeriod: number | null;
};

export type ContextSnapshot = {
  generatedAt: string;
  rangeDays: number;
  connectedPlatforms: string[];
  channels: ChannelSnapshot[];
  totals: {
    followers: number;
    lifetimeViews: number;
    views: number;
    engagementRatePercent: number;
    viewsChangePercentVsPreviousPeriod: number | null;
  };
  recentPosts: Array<{
    platform: string;
    title: string;
    publishedAt: string | null;
    views: number;
    likes: number;
    comments: number;
  }>;
};

/**
 * 프롬프트에 넣을 채널 스냅샷. 대시보드(/api/metrics/overview)와 같은 테이블·같은 공식을 쓰므로
 * AI가 말하는 숫자와 사용자가 화면에서 보는 숫자가 어긋나지 않는다.
 */
export async function buildChannelContext(profileId: string, days: number): Promise<ContextSnapshot> {
  const db = getAdminClient();
  const { data: channelData, error: channelError } = await db
    .from("social_channels")
    .select(
      "social_channel_id, platform, handle, display_name, avatar_url, last_synced_at, youtube_channel_profiles(subscriber_count, view_count, video_count)",
    )
    .eq("profile_id", profileId)
    .eq("is_dashboard_enabled", true)
    .eq("status", "active")
    .order("created_at", { ascending: true });
  if (channelError) throw channelError;
  const channels = (channelData || []) as unknown as ChannelRow[];
  if (channels.length === 0) {
    throw new ApiError(409, "NO_CONNECTED_CHANNEL", "분석할 채널이 없습니다. 채널을 먼저 연동해주세요.");
  }

  const currentWindowStart = utcDayString(days - 1);
  const dailyRows = await loadDailyMetrics(db, channels, utcDayString(days * 2 - 1));

  const current = new Map<string, Totals>();
  const previous = new Map<string, Totals>();
  const metricDays = new Map<string, Set<string>>();
  for (const row of dailyRows) {
    const bucket = row.metric_date >= currentWindowStart ? current : previous;
    if (row.metric_date >= currentWindowStart) {
      const dates = metricDays.get(row.social_channel_id) || new Set<string>();
      dates.add(row.metric_date);
      metricDays.set(row.social_channel_id, dates);
    }
    const totals = bucket.get(row.social_channel_id) || emptyTotals();
    totals.views += row.views;
    totals.likes += row.likes;
    totals.comments += row.comments;
    totals.shares += row.shares;
    totals.subscribersGained += row.subscribers_gained;
    totals.subscribersLost += row.subscribers_lost;
    bucket.set(row.social_channel_id, totals);
  }

  const { data: contentData, error: contentError } = await db
    .from("social_contents")
    .select("platform, title, body_text, source_published_at, current_metrics")
    .in(
      "social_channel_id",
      channels.map((channel) => channel.social_channel_id),
    )
    .order("source_published_at", { ascending: false, nullsFirst: false })
    .limit(10);
  if (contentError) throw contentError;

  const overallCurrent = emptyTotals();
  const overallPrevious = emptyTotals();
  const snapshots: ChannelSnapshot[] = channels.map((channel) => {
    const relation = channel.youtube_channel_profiles;
    const profile = Array.isArray(relation) ? relation[0] || null : relation;
    const currentTotals = current.get(channel.social_channel_id) || emptyTotals();
    const previousTotals = previous.get(channel.social_channel_id) || emptyTotals();
    for (const key of Object.keys(overallCurrent) as Array<keyof Totals>) {
      overallCurrent[key] += currentTotals[key];
      overallPrevious[key] += previousTotals[key];
    }
    return {
      platform: channel.platform,
      displayName: channel.display_name,
      handle: channel.handle,
      subscribers: num(profile?.subscriber_count),
      totalVideos: num(profile?.video_count),
      lifetimeViews: num(profile?.view_count),
      daysWithMetrics: metricDays.get(channel.social_channel_id)?.size ?? 0,
      views: currentTotals.views,
      likes: currentTotals.likes,
      comments: currentTotals.comments,
      shares: currentTotals.shares,
      subscribersGained: currentTotals.subscribersGained,
      subscribersLost: currentTotals.subscribersLost,
      engagementRatePercent: engagementRate(currentTotals),
      viewsChangePercentVsPreviousPeriod: percentChange(currentTotals.views, previousTotals.views),
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    rangeDays: days,
    connectedPlatforms: [...new Set(snapshots.map((channel) => channel.platform))],
    channels: snapshots,
    totals: {
      followers: snapshots.reduce((sum, channel) => sum + channel.subscribers, 0),
      lifetimeViews: snapshots.reduce((sum, channel) => sum + channel.lifetimeViews, 0),
      views: overallCurrent.views,
      engagementRatePercent: engagementRate(overallCurrent),
      viewsChangePercentVsPreviousPeriod: percentChange(overallCurrent.views, overallPrevious.views),
    },
    recentPosts: (contentData || []).map((content) => {
      const metrics = (content.current_metrics || {}) as Record<string, unknown>;
      return {
        platform: content.platform as string,
        title: (content.title as string | null) || (content.body_text as string | null) || "제목 없음",
        publishedAt: (content.source_published_at as string | null) || null,
        views: num(metrics.viewCount),
        likes: num(metrics.likeCount),
        comments: num(metrics.commentCount),
      };
    }),
  };
}

/**
 * 모델 응답을 화면에 넘기기 전에 형태를 확인한다. 하나라도 어긋나면 렌더링 중에 터지는 대신
 * 여기서 502로 끊는다 — 반쯤 채워진 리포트는 목업보다 나쁘다.
 */
export function validateReport(value: unknown): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return "리포트가 객체가 아닙니다.";
  const report = value as Record<string, unknown>;
  if (typeof report.overallScore !== "number" || !Number.isFinite(report.overallScore)) return "overallScore가 없습니다.";
  if (report.overallScore < 0 || report.overallScore > 100) return "overallScore가 0~100 범위를 벗어났습니다.";
  if (typeof report.scoreLabel !== "string" || report.scoreLabel.trim() === "") return "scoreLabel이 없습니다.";
  if (typeof report.summary !== "string" || report.summary.trim() === "") return "summary가 없습니다.";
  for (const field of ["keyStrengths", "bottlenecks"] as const) {
    const list = report[field];
    if (!Array.isArray(list) || list.length === 0 || list.some((item) => typeof item !== "string")) {
      return `${field}가 비어 있지 않은 문자열 배열이어야 합니다.`;
    }
  }
  if (!Array.isArray(report.channelAdvice) || report.channelAdvice.length === 0) return "channelAdvice가 비어 있습니다.";
  for (const advice of report.channelAdvice as Array<Record<string, unknown>>) {
    if (typeof advice?.platform !== "string") return "channelAdvice 항목에 platform이 없습니다.";
    if (!Array.isArray(advice.tactics) || advice.tactics.length === 0) return "channelAdvice 항목에 tactics가 없습니다.";
  }
  if (!Array.isArray(report.contentRoadmap)) return "contentRoadmap이 배열이 아닙니다.";
  return null;
}

const GROUNDING_RULES = `규칙:
- 아래 JSON은 이 사용자의 실제 채널 데이터다. 여기 없는 수치는 절대 지어내지 마라.
- 연동되지 않은 플랫폼은 언급하지 마라. connectedPlatforms에 있는 것만 다룬다.
- 데이터가 부족해 판단할 수 없으면 그렇게 말해라. 그럴듯한 숫자로 빈칸을 채우지 마라.
- 수치를 인용할 때는 주어진 값을 그대로 쓴다.
- daysWithMetrics가 0이면 그 기간의 조회수·참여율 집계는 아직 수집되지 않은 것이다.
  실적이 0이라고 단정하지 말고, 판단에 쓸 수 있는 값(구독자 수, 누적 조회수, 영상 수)만으로 답하라.`;

function reportPrompt(context: ContextSnapshot): string {
  return `당신은 소셜 미디어 성장 전략 분석가입니다. 아래 채널의 최근 ${context.rangeDays}일 실적을 진단하세요.

${GROUNDING_RULES}

채널 데이터:
${JSON.stringify(context, null, 2)}

다음 구조의 JSON만 출력하세요:
{
  "overallScore": 0~100 정수 (참여율·조회수 추세·구독자 증감에 근거),
  "scoreLabel": "점수를 한 줄로 설명하는 라벨",
  "summary": "현재 성과 총평 2~3줄. 실제 수치를 인용할 것",
  "keyStrengths": ["데이터로 뒷받침되는 강점 3개"],
  "bottlenecks": ["데이터에서 드러나는 개선 포인트 3개"],
  "channelAdvice": [{ "platform": "connectedPlatforms 중 하나", "strategy": "핵심 전략 한 줄", "tactics": ["실행 전술 3개"], "recommendedPostingTime": "추천 업로드 시간대", "expectedGrowth": "기대 효과", "hookTip": "후킹 팁" }],
  "contentRoadmap": [{ "day": "요일", "platform": "connectedPlatforms 중 하나", "topic": "주제", "hook": "훅 문구", "format": "포맷" }]
}`;
}

export type VideoDraft = { title: string; description: string };

/** 초안이 YouTube가 거부할 길이로 오면 저장 단계가 아니라 여기서 끊는다. */
export function validateDraft(value: unknown): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return "초안이 객체가 아닙니다.";
  const draft = value as Record<string, unknown>;
  if (typeof draft.title !== "string" || draft.title.trim() === "") return "title이 비어 있습니다.";
  if (draft.title.length > MAX_VIDEO_TITLE) return `title이 ${MAX_VIDEO_TITLE}자를 넘습니다.`;
  if (typeof draft.description !== "string") return "description이 문자열이 아닙니다.";
  if (draft.description.length > MAX_VIDEO_DESCRIPTION) return `description이 ${MAX_VIDEO_DESCRIPTION}자를 넘습니다.`;
  return null;
}

export function registerAiRoutes(app: Express) {
  // Plus 게이트. 리포트와 컨설턴트는 Free에서 아예 호출되지 않는다.
  // insights처럼 필드를 잘라 내려보내는 방식이 아니라 기능 전체가 잠긴다 — 반쪽짜리 진단은
  // 의미가 없고, AI 호출 자체가 비용이라 Free에서 태우면 안 된다.
  async function requirePlusUser(req: Request, res: Response): Promise<{ profileId: string; plan: BillingPlan } | null> {
    const authenticatedUser = await getAuthenticatedUser(req);
    if (!authenticatedUser) {
      sendError(res, 401, "UNAUTHENTICATED", "A valid session is required.");
      return null;
    }
    const plan = await getPlanForProfile(authenticatedUser.user.id);
    if (plan !== "plus") {
      sendError(res, 403, "PLUS_REQUIRED", "AI 종합 진단과 1:1 컨설턴트는 Plus 전용 기능입니다.");
      return null;
    }
    return { profileId: authenticatedUser.user.id, plan };
  }

  app.post("/api/gemini/analyze", async (req, res) => {
    try {
      const account = await requirePlusUser(req, res);
      if (!account) return;
      // 할당량도 크레딧도 없으면 AI에 요청조차 하지 않는다.
      const call = await planAiCall(account.profileId, "report", account.plan);

      const ai = getGenAI();
      const context = await buildChannelContext(account.profileId, REPORT_RANGE_DAYS);

      const response = await ai.models.generateContent({
        model: model(),
        contents: reportPrompt(context),
        config: { responseMimeType: "application/json" },
      });

      let parsed: unknown;
      try {
        parsed = JSON.parse(response.text || "");
      } catch {
        throw new ApiError(502, "AI_INVALID_RESPONSE", "AI가 올바른 형식의 리포트를 반환하지 않았습니다. 다시 시도해주세요.");
      }
      const problem = validateReport(parsed);
      if (problem) throw new ApiError(502, "AI_INVALID_RESPONSE", `AI 리포트 형식 오류: ${problem}`);

      await recordUsage(account.profileId, "report", model(), call.source);
      return res.status(200).json({
        model: model(),
        generatedAt: context.generatedAt,
        rangeDays: context.rangeDays,
        report: parsed,
        usage: await getUsage(account.profileId, "report", account.plan),
      });
    } catch (error) {
      return toErrorResponse(res, error, "AI_ANALYSIS_FAILED");
    }
  });

  app.post("/api/gemini/advisor", async (req, res) => {
    try {
      const account = await requirePlusUser(req, res);
      if (!account) return;

      const query = typeof req.body?.query === "string" ? req.body.query.trim() : "";
      if (!query) return sendError(res, 400, "QUERY_REQUIRED", "질문을 입력해주세요.");
      if (query.length > MAX_QUERY_LENGTH) {
        return sendError(res, 400, "QUERY_TOO_LONG", `질문은 ${MAX_QUERY_LENGTH}자 이내로 입력해주세요.`);
      }

      const call = await planAiCall(account.profileId, "advisor", account.plan);

      const ai = getGenAI();
      const context = await buildChannelContext(account.profileId, ADVISOR_RANGE_DAYS);

      // 대화 이력은 사용자 본인의 것이라 요청 본문에서 받되, 개수와 길이는 서버가 자른다.
      const history = (Array.isArray(req.body?.history) ? req.body.history : [])
        .filter((turn: unknown): turn is { role?: string; text: string } => typeof (turn as { text?: unknown })?.text === "string")
        .slice(-MAX_HISTORY_TURNS)
        .map((turn: { role?: string; text: string }) => `${turn.role === "user" ? "사용자" : "AI"}: ${turn.text.slice(0, MAX_QUERY_LENGTH)}`);

      const response = await ai.models.generateContent({
        model: model(),
        contents: [`채널 데이터:\n${JSON.stringify(context)}`, ...history, `사용자 질문: ${query}`].join("\n\n"),
        config: {
          systemInstruction: `당신은 이 사용자의 채널 데이터를 보고 답하는 소셜 미디어 성장 전략가입니다.

${GROUNDING_RULES}

답변은 핵심을 번호 목록으로 정리하고, 채널 데이터에서 근거를 찾을 수 있으면 해당 수치를 인용하세요.`,
        },
      });

      const reply = (response.text || "").trim();
      if (!reply) throw new ApiError(502, "AI_EMPTY_RESPONSE", "AI가 답변을 생성하지 못했습니다. 다시 시도해주세요.");

      await recordUsage(account.profileId, "advisor", model(), call.source);
      return res.status(200).json({ model: model(), reply, usage: await getUsage(account.profileId, "advisor", account.plan) });
    } catch (error) {
      return toErrorResponse(res, error, "AI_ADVISOR_FAILED");
    }
  });

  // 이미 올라가 있는 영상의 제목·설명 초안. 저장은 기존
  // PATCH /api/connections/youtube/:channelId/videos/:contentId 가 담당한다 — 여기서는 문구만 만든다.
  app.post("/api/gemini/draft", async (req, res) => {
    try {
      const account = await requirePlusUser(req, res);
      if (!account) return;

      const socialContentId = typeof req.body?.socialContentId === "string" ? req.body.socialContentId : "";
      if (!socialContentId) return sendError(res, 400, "INVALID_INPUT", "대상 영상을 선택해주세요.");
      const tone = typeof req.body?.tone === "string" ? req.body.tone.slice(0, 100) : "";

      const call = await planAiCall(account.profileId, "draft", account.plan);

      const db = getAdminClient();
      // 본인 채널의 영상인지 확인한다. social_contents만 봐서는 소유자를 알 수 없다.
      const { data: content, error: contentError } = await db
        .from("social_contents")
        .select("social_content_id, title, body_text, current_metrics, source_published_at, social_channels!inner(profile_id, display_name)")
        .eq("social_content_id", socialContentId)
        .eq("platform", "youtube")
        .maybeSingle();
      if (contentError) throw contentError;
      const owner = content && (Array.isArray(content.social_channels) ? content.social_channels[0] : content.social_channels);
      if (!content || !owner || owner.profile_id !== account.profileId) {
        return sendError(res, 404, "VIDEO_NOT_FOUND", "해당 영상을 찾을 수 없습니다.");
      }

      const ai = getGenAI();
      const context = await buildChannelContext(account.profileId, REPORT_RANGE_DAYS);
      const metrics = (content.current_metrics || {}) as Record<string, unknown>;

      const response = await ai.models.generateContent({
        model: model(),
        contents: `이 크리에이터가 이미 올린 YouTube 영상의 제목과 설명을 다시 써주세요.

${GROUNDING_RULES}

채널 데이터:
${JSON.stringify(context)}

대상 영상:
${JSON.stringify({
  현재제목: content.title,
  현재설명: content.body_text,
  발행일: content.source_published_at,
  조회수: num(metrics.viewCount),
  좋아요: num(metrics.likeCount),
  댓글수: num(metrics.commentCount),
})}
${tone ? `
사용자가 요청한 방향: ${tone}` : ""}

제약:
- title은 ${MAX_VIDEO_TITLE}자 이내. 낚시성 과장 없이 영상 내용을 그대로 담을 것.
- description은 ${MAX_VIDEO_DESCRIPTION}자 이내. 첫 두 줄에 핵심을 넣고, 필요하면 해시태그를 마지막 줄에 둘 것.
- 영상 내용을 모르면 현재 제목·설명에 있는 정보만 쓴다. 없는 내용을 지어내지 마라.

{"title": "...", "description": "..."} 형식의 JSON만 출력하세요.`,
        config: { responseMimeType: "application/json" },
      });

      let parsed: unknown;
      try {
        parsed = JSON.parse(response.text || "");
      } catch {
        throw new ApiError(502, "AI_INVALID_RESPONSE", "AI가 올바른 형식의 초안을 반환하지 않았습니다. 다시 시도해주세요.");
      }
      const problem = validateDraft(parsed);
      if (problem) throw new ApiError(502, "AI_INVALID_RESPONSE", `AI 초안 형식 오류: ${problem}`);

      await recordUsage(account.profileId, "draft", model(), call.source);
      return res.status(200).json({
        model: model(),
        draft: parsed as VideoDraft,
        usage: await getUsage(account.profileId, "draft", account.plan),
      });
    } catch (error) {
      return toErrorResponse(res, error, "AI_DRAFT_FAILED");
    }
  });
}
