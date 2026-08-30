export type BillingPlan = 'free' | 'plus';

export type ViralityComponents = {
  reachMultiple: number | null;
  engagementRate: number;
  nonSubscriberShare: number | null;
  shareRate: number;
};

export type Virality = { score: number | null; note: string | null; components: ViralityComponents };

export type PeakTimeSlot = { slot: string; label: string; multiple: number | null; videoCount: number };

export type PeakTime = {
  available: boolean;
  reason: string | null;
  totalVideos: number;
  best: { slot: string; label: string; multiple: number; videoCount: number } | null;
  slots: PeakTimeSlot[];
};

export type FormatStat = {
  format: 'shorts' | 'midform' | 'longform' | 'live';
  formatName: string;
  videoCount: number;
  medianInitialViews: number;
  medianShares: number | null;
  efficiencyScore: number | null;
};

export type ChannelInsights = {
  socialChannelId: string;
  displayName: string;
  handle: string | null;
  subscribers: number;
  // Free 플랜에서도 보이는 기본 비율
  engagementRate: number;
  shareRate: number;
  commentRatio: number;
  // 아래는 Plus 전용. Free 플랜에서는 서버가 null로 내려보낸다 (블러가 아니라 실제로 없음)
  retentionRate: number | null;
  clickThroughRate: number | null;
  saveRate: number | null;
  topAudienceAge: { ageGroup: string; sharePercent: number } | null;
  virality: Virality | null;
  peakTime: PeakTime | null;
  formats: FormatStat[] | null;
  bestFormat: FormatStat | null;
  locked: boolean;
  lockedFields: string[];
};

export type InsightsResponse = {
  range: '30d' | '90d';
  days: number;
  plan: BillingPlan;
  connected: boolean;
  channels: ChannelInsights[];
};

export async function fetchInsights(range: '30d' | '90d', signal?: AbortSignal): Promise<InsightsResponse> {
  const response = await fetch(`/api/metrics/insights?range=${range}`, { credentials: 'include', signal });
  const body = response.headers.get('content-type')?.includes('application/json')
    ? ((await response.json()) as InsightsResponse & { error?: { message?: string } })
    : null;
  if (!response.ok) throw new Error(body?.error?.message || '심층 지표를 불러오지 못했습니다.');
  return body as InsightsResponse;
}
