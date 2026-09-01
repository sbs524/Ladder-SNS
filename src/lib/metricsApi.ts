import { PlatformType } from '../types';

export type PlatformSummary = {
  platform: PlatformType;
  connected: boolean;
  channelCount: number;
  handle: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  followers: number;
  followersChange: number;
  subscribersGained: number;
  subscribersLost: number;
  /** 조회수 대비 신규 구독(%). 기간 내 조회수가 없으면 null. */
  subscriberConversionRate: number | null;
  views: number;
  viewsChangePercent: number | null;
  engagementRate: number;
  postsCount: number;
  lastSyncedAt: string | null;
};

export type OverviewChartPoint = {
  date: string;
  isoDate: string;
  total: number;
  youtube: number;
  instagram: number;
  threads: number;
  x: number;
};

export type OverviewPost = {
  id: string;
  socialChannelId: string;
  platform: PlatformType;
  title: string;
  publishedAt: string | null;
  permalink: string | null;
  thumbnailUrl: string | null;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  /** 발행 직후 3일 조회수. 그 기간을 아직 못 채운 영상은 null. */
  initialViews: number | null;
  /** 초기 조회수 ÷ 채널 초기 조회수 중앙값. 비교할 표본이 없으면 null. */
  medianMultiple: number | null;
};

export type MetricsOverview = {
  range: '7d' | '30d';
  days: number;
  hasData: boolean;
  connectedCount: number;
  totals: {
    followers: number;
    views: number;
    engagementRate: number;
    growthPercent: number | null;
    subscribersGained: number;
    subscribersLost: number;
    subscriberConversionRate: number | null;
  };
  platforms: PlatformSummary[];
  chart: OverviewChartPoint[];
  recentPosts: OverviewPost[];
};

export async function fetchMetricsOverview(range: '7d' | '30d', signal?: AbortSignal): Promise<MetricsOverview> {
  const response = await fetch(`/api/metrics/overview?range=${range}`, { credentials: 'include', signal });
  const body = response.headers.get('content-type')?.includes('application/json')
    ? ((await response.json()) as MetricsOverview & { error?: { message?: string } })
    : null;
  if (!response.ok) throw new Error(body?.error?.message || '지표를 불러오지 못했습니다.');
  return body as MetricsOverview;
}
