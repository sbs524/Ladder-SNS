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
  platform: PlatformType;
  title: string;
  publishedAt: string | null;
  permalink: string | null;
  thumbnailUrl: string | null;
  views: number;
  likes: number;
  comments: number;
  shares: number;
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
