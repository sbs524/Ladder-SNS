export type UserType = 'individual' | 'team' | 'enterprise';

export type PlatformType = 'youtube' | 'instagram' | 'threads' | 'x';

export interface PlatformConfig {
  id: PlatformType;
  name: string;
  koreanName: string;
  color: string;
  bgColor: string;
  lightBg: string;
  borderColor: string;
  textColor: string;
  icon: string;
  description: string;
}

export interface UserProfile {
  name: string;
  email: string;
  userType: UserType;
  selectedPlatforms: PlatformType[];
  /** 서버가 정하는 값. 클라이언트는 표시에만 쓴다. */
  plan: BillingPlan;
  /** 구매 크레딧 잔액. 월 할당량과는 별개다. */
  aiCredits: number;
  isLoggedIn: boolean;
  avatarUrl?: string;
}

export type BillingPlan = 'free' | 'plus';

export interface MetricItem {
  label: string;
  value: string | number;
  change: string;
  isPositive: boolean;
  subtext?: string;
}

export interface PostItem {
  id: string;
  title: string;
  date: string;
  thumbnail?: string;
  likes: number;
  comments: number;
  shares: number;
  views?: number;
  url?: string;
}

export interface PlatformMetrics {
  platform: PlatformType;
  handle: string;
  followers: number;
  followersChange: string;
  impressions: number;
  impressionsChange: string;
  engagementRate: number;
  engagementChange: string;
  postsCount: number;
  secondaryMetrics: {
    label: string;
    value: string;
    change: string;
    isPositive: boolean;
  }[];
  recentPosts: PostItem[];
}

export interface DailyChartPoint {
  date: string;
  total: number;
  youtube: number;
  instagram: number;
  threads: number;
  x: number;
}

export interface ActivityNotification {
  id: string;
  platform: PlatformType;
  type: 'like' | 'comment' | 'follow' | 'share' | 'mention';
  user: string;
  userAvatar?: string;
  content: string;
  timeAgo: string;
  targetPost?: string;
}

export interface EngagementDeepMetric {
  platform: PlatformType;
  engagementRate: number; // e.g. 8.9%
  saveRate: number; // e.g. 4.2%
  shareRate: number; // e.g. 3.8%
  commentRatio: number; // e.g. 1.4%
  retentionRate: number; // e.g. 68%
  clickThroughRate: number; // e.g. 3.2%
  viralityScore: number; // 0~100
  peakTime: string; // e.g. "오후 8시 ~ 11시"
  bestFormat: string; // e.g. "60초 미만 쇼츠"
  topAudienceAge: string; // e.g. "25~34세 (48%)"
}

export interface ContentFormatStat {
  id: string;
  formatName: string;
  platform: PlatformType;
  avgViews: number;
  avgEngagement: number;
  avgSavesOrShares: number;
  efficiencyScore: number; // 1~100
  trend: 'up' | 'stable' | 'down';
}

export interface AIChannelAdvice {
  platform: PlatformType;
  strategy: string;
  tactics: string[];
  recommendedPostingTime: string;
  expectedGrowth: string;
  hookTip: string;
}

export interface AIContentRoadmapItem {
  day: string;
  platform: PlatformType;
  topic: string;
  hook: string;
  format: string;
}

export interface AIAnalysisReport {
  overallScore: number;
  scoreLabel: string;
  summary: string;
  keyStrengths: string[];
  bottlenecks: string[];
  channelAdvice: AIChannelAdvice[];
  contentRoadmap: AIContentRoadmapItem[];
  generatedAt: string;
}
