import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { 
  Users, 
  TrendingUp, 
  Eye, 
  Heart, 
  Share2, 
  MessageSquare, 
  ArrowUpRight, 
  ArrowDownRight, 
  Sparkles,
  ExternalLink,
  BarChart3,
  Youtube,
  Instagram,
  AtSign,
  Twitter,
  RefreshCw,
  ChevronRight,
  Link2,
  LoaderCircle
} from 'lucide-react';
import { 
  ResponsiveContainer, 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  Tooltip, 
  CartesianGrid
} from 'recharts';
import { PlatformType, UserProfile } from '../types';
import { PLATFORM_CONFIGS } from '../data/platformConfig';
import { fetchMetricsOverview, type MetricsOverview, type OverviewPost, type PlatformSummary } from '../lib/metricsApi';

import { PlatformConnectionsSection } from './PlatformConnectionsSection';

function relativeDay(value: string | null) {
  if (!value) return '';
  const published = new Date(value);
  if (Number.isNaN(published.getTime())) return '';
  const days = Math.floor((Date.now() - published.getTime()) / 86_400_000);
  if (days <= 0) return '오늘';
  if (days === 1) return '어제';
  if (days < 30) return `${days}일 전`;
  return published.toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' });
}

function compactNumber(value: number) {
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return value.toLocaleString();
}

interface DashboardProps {
  user: UserProfile;
  onOpenComposer?: () => void;
  onOpenOnboarding: () => void;
  onOpenAnalysis: (platform?: PlatformType | 'all') => void;
  onOpenRawData?: () => void;
  /** 값이 바뀌면 지표를 다시 읽는다. 영상 문구를 저장한 직후 갱신용. */
  dataVersion?: number;
}

export const Dashboard: React.FC<DashboardProps> = ({
  user,
  onOpenComposer,
  onOpenOnboarding,
  onOpenAnalysis,
  onOpenRawData,
  dataVersion = 0,
}) => {
  const [activePlatformFilter, setActivePlatformFilter] = useState<PlatformType | 'all'>('all');
  const [timeRange, setTimeRange] = useState<'7d' | '30d'>('7d');
  const [overview, setOverview] = useState<MetricsOverview | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadOverview = useCallback((range: '7d' | '30d', signal?: AbortSignal) => {
    if (!user.isLoggedIn) {
      setOverview(null);
      return;
    }
    setIsLoading(true);
    setLoadError(null);
    fetchMetricsOverview(range, signal)
      .then((data) => setOverview(data))
      .catch((error: unknown) => {
        if (signal?.aborted) return;
        setLoadError(error instanceof Error ? error.message : '지표를 불러오지 못했습니다.');
      })
      .finally(() => {
        if (!signal?.aborted) setIsLoading(false);
      });
  }, [user.isLoggedIn]);

  useEffect(() => {
    const controller = new AbortController();
    loadOverview(timeRange, controller.signal);
    return () => controller.abort();
  }, [loadOverview, timeRange, dataVersion]);

  // Onboarding decides which platform cards render; the overview decides which of them have a
  // connected channel behind them. Unconnected ones show a connect prompt, never a number.
  const activePlatforms = useMemo(() => {
    return user.selectedPlatforms.length > 0
      ? user.selectedPlatforms
      : (['youtube', 'instagram', 'threads', 'x'] as PlatformType[]);
  }, [user.selectedPlatforms]);

  const summaryByPlatform = useMemo(() => {
    const map = new Map<PlatformType, PlatformSummary>();
    overview?.platforms.forEach((summary) => map.set(summary.platform, summary));
    return map;
  }, [overview]);

  const connectedPlatforms = useMemo(
    () => activePlatforms.filter((p) => summaryByPlatform.get(p)?.connected),
    [activePlatforms, summaryByPlatform],
  );

  const aggregateMetrics = useMemo(() => ({
    totalFollowers: overview?.totals.followers ?? 0,
    totalViews: overview?.totals.views ?? 0,
    avgEngagement: (overview?.totals.engagementRate ?? 0).toFixed(1),
    growthPercent: overview?.totals.growthPercent ?? null,
  }), [overview]);

  const chartData = useMemo(() => overview?.chart ?? [], [overview]);

  // Labels follow the selected toggle even before the response lands, so "30D" never sits next
  // to a "최근 7일" label.
  const rangeDays = overview?.days ?? (timeRange === '30d' ? 30 : 7);

  const allRecentPosts = useMemo(
    () => (overview?.recentPosts ?? []).filter((post) => activePlatforms.includes(post.platform)),
    [activePlatforms, overview],
  );

  const filteredPosts = useMemo(() => {
    if (activePlatformFilter === 'all') return allRecentPosts;
    return allRecentPosts.filter((p) => p.platform === activePlatformFilter);
  }, [activePlatformFilter, allRecentPosts]);

  return (
    <div className="w-full max-w-7xl mx-auto space-y-3 pb-4">
      
      {/* 1. Header Bar: Profile badge, AI Analysis trigger & Compact Filter Chips */}
      <div className="glass-panel rounded-2xl px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 border border-white/70">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            <span>{user.name}의 통합 대시보드</span>
          </span>
          <span className="text-[10px] font-medium px-2 py-0.5 rounded-md bg-indigo-50/80 text-indigo-700 border border-indigo-200/50">
            {user.userType === 'individual' ? '개인' : user.userType === 'team' ? '팀' : '기업'}
          </span>
        </div>

        {/* AI Analysis Main Button + Platform Selector Filter */}
        <div className="flex items-center gap-1.5 overflow-x-auto py-0.5">
          <button
            id="dashboard-open-ai-analysis-btn"
            onClick={() => onOpenAnalysis('all')}
            className="inline-flex items-center gap-1.5 text-xs font-extrabold px-3 py-1 rounded-xl bg-gradient-to-r from-indigo-600 via-purple-600 to-rose-600 text-white hover:opacity-95 shadow-xs transition-all cursor-pointer mr-1"
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-300 animate-pulse" />
            <span>AI 지표 분석</span>
          </button>

          <button
            id="filter-all"
            onClick={() => setActivePlatformFilter('all')}
            className={`text-xs px-2.5 py-1 rounded-xl font-medium transition-all ${
              activePlatformFilter === 'all'
                ? 'bg-slate-900 text-white shadow-2xs'
                : 'bg-white/40 hover:bg-white/70 text-slate-600 border border-white/60'
            }`}
          >
            전체 통합
          </button>
          {activePlatforms.map((p) => {
            const conf = PLATFORM_CONFIGS[p];
            const isSelected = activePlatformFilter === p;
            return (
              <button
                key={p}
                id={`filter-${p}`}
                onClick={() => setActivePlatformFilter(p)}
                className={`text-xs px-2.5 py-1 rounded-xl font-medium flex items-center gap-1.5 transition-all ${
                  isSelected
                    ? 'bg-white text-slate-900 shadow-2xs ring-1 ring-slate-300'
                    : 'bg-white/40 hover:bg-white/70 text-slate-600 border border-white/60'
                }`}
              >
                <div
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: conf.color }}
                />
                <span>{conf.koreanName}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 2. Compact High-Level Metrics (4-Column in single row) */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
        
        {/* Total Followers */}
        <div 
          onClick={() => onOpenAnalysis('all')}
          className="glass-card rounded-2xl p-3.5 flex items-center justify-between cursor-pointer hover:bg-white/70 transition-all group"
        >
          <div>
            <p className="text-[11px] font-semibold text-slate-500 flex items-center gap-1">
              <span>통합 구독자/팔로워</span>
              <Sparkles className="w-2.5 h-2.5 text-indigo-400 opacity-0 group-hover:opacity-100 transition-opacity" />
            </p>
            <h3 className="text-xl font-extrabold text-slate-900 tracking-tight mt-0.5">
              {aggregateMetrics.totalFollowers.toLocaleString()}
            </h3>
          </div>
          <div className="w-8 h-8 rounded-xl bg-indigo-500/10 text-indigo-600 flex items-center justify-center group-hover:scale-105 transition-transform">
            <Users className="w-4 h-4" />
          </div>
        </div>

        {/* Total Views / Impressions */}
        <div 
          onClick={() => onOpenAnalysis('all')}
          className="glass-card rounded-2xl p-3.5 flex items-center justify-between cursor-pointer hover:bg-white/70 transition-all group"
        >
          <div>
            <p className="text-[11px] font-semibold text-slate-500 flex items-center gap-1">
              <span>최근 {rangeDays}일 조회수</span>
              <Sparkles className="w-2.5 h-2.5 text-sky-400 opacity-0 group-hover:opacity-100 transition-opacity" />
            </p>
            <h3 className="text-xl font-extrabold text-slate-900 tracking-tight mt-0.5">
              {compactNumber(aggregateMetrics.totalViews)}
            </h3>
          </div>
          <div className="w-8 h-8 rounded-xl bg-sky-500/10 text-sky-600 flex items-center justify-center group-hover:scale-105 transition-transform">
            <Eye className="w-4 h-4" />
          </div>
        </div>

        {/* Avg Engagement Rate (Interactive AI Trigger) */}
        <div 
          onClick={() => onOpenAnalysis('all')}
          className="glass-card rounded-2xl p-3.5 flex items-center justify-between cursor-pointer hover:bg-white/70 transition-all group ring-1 ring-rose-200/50 hover:ring-rose-300"
        >
          <div>
            <div className="flex items-center gap-1">
              <p className="text-[11px] font-semibold text-slate-500">평균 참여율</p>
              <span className="text-[9px] font-extrabold text-rose-600 bg-rose-50 px-1 rounded">AI 분석</span>
            </div>
            <h3 className="text-xl font-extrabold text-slate-900 tracking-tight mt-0.5">
              {aggregateMetrics.avgEngagement}%
            </h3>
          </div>
          <div className="w-8 h-8 rounded-xl bg-rose-500/10 text-rose-600 flex items-center justify-center group-hover:scale-105 transition-transform">
            <Heart className="w-4 h-4" />
          </div>
        </div>

        {/* Growth Rate */}
        <div 
          onClick={() => onOpenAnalysis('all')}
          className="glass-card rounded-2xl p-3.5 flex items-center justify-between cursor-pointer hover:bg-white/70 transition-all group"
        >
          <div>
            <p className="text-[11px] font-semibold text-slate-500">직전 {rangeDays}일 대비</p>
            {aggregateMetrics.growthPercent === null ? (
              <h3 className="text-xl font-extrabold text-slate-400 tracking-tight mt-0.5">–</h3>
            ) : (
              <h3
                className={`text-xl font-extrabold tracking-tight mt-0.5 flex items-center gap-0.5 ${
                  aggregateMetrics.growthPercent >= 0 ? 'text-emerald-600' : 'text-rose-600'
                }`}
              >
                {aggregateMetrics.growthPercent >= 0 ? (
                  <ArrowUpRight className="w-4 h-4 stroke-[3]" />
                ) : (
                  <ArrowDownRight className="w-4 h-4 stroke-[3]" />
                )}
                <span>{Math.abs(aggregateMetrics.growthPercent).toFixed(1)}%</span>
              </h3>
            )}
          </div>
          <div className="w-8 h-8 rounded-xl bg-emerald-500/10 text-emerald-600 flex items-center justify-center group-hover:scale-105 transition-transform">
            <TrendingUp className="w-4 h-4" />
          </div>
        </div>

      </div>

      {/* 3. Platform Breakdown Cards Strip (Compact Horizontal Grid) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
        {activePlatforms.map((p) => {
          const conf = PLATFORM_CONFIGS[p];
          const stats = summaryByPlatform.get(p);
          const isConnected = Boolean(stats?.connected);

          return (
            <div
              key={p}
              id={`platform-card-${p}`}
              onClick={() => isConnected && setActivePlatformFilter(activePlatformFilter === p ? 'all' : p)}
              className={`rounded-2xl p-3 glass-card-compact transition-all ${
                isConnected ? 'cursor-pointer' : 'opacity-70'
              } ${
                activePlatformFilter === p ? 'ring-2 ring-indigo-500/40 bg-white/70' : 'hover:bg-white/60'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div
                    className="w-6 h-6 rounded-lg flex items-center justify-center text-white"
                    style={{ backgroundColor: conf.color }}
                  >
                    {p === 'youtube' && <Youtube className="w-3.5 h-3.5" />}
                    {p === 'instagram' && <Instagram className="w-3.5 h-3.5" />}
                    {p === 'threads' && <AtSign className="w-3.5 h-3.5" />}
                    {p === 'x' && <Twitter className="w-3.5 h-3.5" />}
                  </div>
                  <div>
                    <span className="font-bold text-xs text-slate-900">{conf.koreanName}</span>
                    <span className="text-[10px] text-slate-400 block -mt-0.5">
                      {isConnected ? stats?.handle || stats?.displayName : '연동 안 됨'}
                    </span>
                  </div>
                </div>

                {isConnected && (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenAnalysis(p);
                      }}
                      className="text-[10px] font-bold text-indigo-600 hover:text-indigo-800 bg-indigo-50/90 hover:bg-indigo-100 px-1.5 py-0.5 rounded-md flex items-center gap-0.5 transition-all shadow-2xs"
                      title={`${conf.koreanName} 세부 분석 및 AI 조언`}
                    >
                      <Sparkles className="w-2.5 h-2.5 text-indigo-500" />
                      <span>분석</span>
                    </button>
                    {stats!.followersChange !== 0 && (
                      <span
                        className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md ${
                          stats!.followersChange > 0 ? 'text-emerald-600 bg-emerald-50' : 'text-rose-600 bg-rose-50'
                        }`}
                      >
                        {stats!.followersChange > 0 ? '+' : ''}
                        {stats!.followersChange.toLocaleString()}
                      </span>
                    )}
                  </div>
                )}
              </div>

              {isConnected ? (
                <div className="grid grid-cols-2 gap-1.5 pt-1 border-t border-slate-200/40">
                  <div>
                    <span className="text-[10px] text-slate-500">팔로워/구독</span>
                    <p className="text-xs font-bold text-slate-800">{stats!.followers.toLocaleString()}</p>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500">최근 {rangeDays}일 조회</span>
                    <p className="text-xs font-bold text-slate-800">{compactNumber(stats!.views)}</p>
                  </div>
                </div>
              ) : p === 'youtube' ? (
                // 유튜브만 실제 연결 경로가 있다. 로그인 전에는 OAuth를 시작할 수 없으므로 로그인으로 보낸다.
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (user.isLoggedIn) window.location.assign('/api/connections/youtube/start');
                    else onOpenOnboarding();
                  }}
                  className="w-full mt-1 pt-1.5 border-t border-slate-200/40 text-[10px] font-semibold text-indigo-600 hover:text-indigo-800 flex items-center justify-center gap-1"
                >
                  <Link2 className="w-3 h-3" />
                  <span>{user.isLoggedIn ? '연동하기' : '로그인하고 연동하기'}</span>
                </button>
              ) : (
                // 인스타그램·쓰레드·X는 아직 연동 수단이 없다. 누르면 아무 일도 없는
                // "연동하기" 버튼 대신 상태를 그대로 적는다.
                <p className="w-full mt-1 pt-1.5 border-t border-slate-200/40 text-[10px] font-semibold text-slate-400 text-center">
                  연동 지원 예정
                </p>
              )}
            </div>
          );
        })}
      </div>

      {/* 4. Compact Dual Dashboard Panel: Trend Chart (Left) + Posts & Action (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-2.5">
        
        {/* Left: Interactive Multi-Platform Growth Area Chart (7 Cols) */}
        <div className="lg:col-span-7 glass-panel rounded-2xl p-4 flex flex-col justify-between border border-white/70">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h4 className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                <BarChart3 className="w-3.5 h-3.5 text-indigo-600" />
                <span>플랫폼별 도달·조회 트렌드</span>
              </h4>
              <p className="text-[10px] text-slate-500 mt-0.5">최근 {rangeDays}일간의 채널별 조회수 추이</p>
            </div>
            
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => onOpenAnalysis(activePlatformFilter)}
                className="text-[11px] font-bold px-2 py-1 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200/60 flex items-center gap-1 transition-all"
              >
                <Sparkles className="w-3 h-3 text-indigo-600" />
                <span>세부 지표 AI 분석</span>
              </button>

              <div className="flex items-center gap-1 bg-white/40 p-0.5 rounded-lg border border-white/60">
                {(['7d', '30d'] as const).map((r) => (
                  <button
                    key={r}
                    onClick={() => setTimeRange(r)}
                    className={`text-[10px] px-2 py-0.5 rounded-md font-semibold transition-all ${
                      timeRange === r ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-500'
                    }`}
                  >
                    {r.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="h-[200px] w-full">
            {isLoading && !overview ? (
              <div className="h-full flex items-center justify-center text-[11px] text-slate-400 gap-1.5">
                <LoaderCircle className="w-3.5 h-3.5 animate-spin" />
                <span>지표를 불러오는 중…</span>
              </div>
            ) : loadError ? (
              <div className="h-full flex flex-col items-center justify-center gap-2 text-center">
                <p className="text-[11px] text-rose-600">{loadError}</p>
                <button
                  onClick={() => loadOverview(timeRange)}
                  className="text-[11px] font-semibold text-indigo-600 hover:underline flex items-center gap-1"
                >
                  <RefreshCw className="w-3 h-3" />
                  <span>다시 시도</span>
                </button>
              </div>
            ) : !overview?.hasData ? (
              <div className="h-full flex flex-col items-center justify-center gap-1.5 text-center px-4">
                <p className="text-[11px] font-semibold text-slate-600">아직 수집된 지표가 없습니다</p>
                <p className="text-[10px] text-slate-400">
                  {connectedPlatforms.length === 0
                    ? '채널을 연동하면 여기에 실제 지표가 표시됩니다.'
                    : '연동 정보에서 동기화를 실행하면 지표가 채워집니다.'}
                </p>
              </div>
            ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorTotal" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0.0} />
                  </linearGradient>
                  <linearGradient id="colorPlatform" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#ec4899" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#ec4899" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(203, 213, 225, 0.4)" />
                <XAxis 
                  dataKey="date" 
                  tick={{ fontSize: 10, fill: '#64748b' }} 
                  axisLine={false} 
                  tickLine={false} 
                />
                <YAxis 
                  tick={{ fontSize: 10, fill: '#64748b' }} 
                  axisLine={false} 
                  tickLine={false}
                  tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} 
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'rgba(255, 255, 255, 0.85)',
                    backdropFilter: 'blur(12px)',
                    borderRadius: '12px',
                    border: '1px solid rgba(255, 255, 255, 0.9)',
                    boxShadow: '0 8px 24px -4px rgba(0,0,0,0.08)',
                    fontSize: '11px',
                  }}
                />
                {activePlatformFilter === 'all' ? (
                  <Area
                    type="monotone"
                    dataKey="total"
                    name="통합 총합"
                    stroke="#6366f1"
                    strokeWidth={2.5}
                    fillOpacity={1}
                    fill="url(#colorTotal)"
                  />
                ) : (
                  <Area
                    type="monotone"
                    dataKey={activePlatformFilter}
                    name={PLATFORM_CONFIGS[activePlatformFilter].koreanName}
                    stroke={PLATFORM_CONFIGS[activePlatformFilter].color}
                    strokeWidth={2.5}
                    fillOpacity={1}
                    fill="url(#colorPlatform)"
                  />
                )}
              </AreaChart>
            </ResponsiveContainer>
            )}
          </div>

          <div className="flex items-center justify-between text-[11px] text-slate-500 pt-2 border-t border-slate-200/40">
            <span className="flex items-center gap-1">
              <Sparkles className="w-3 h-3 text-indigo-500" />
              <span>참여율 = (좋아요+댓글+공유) / 조회수</span>
            </span>
            {onOpenComposer && (
              <button
                onClick={onOpenComposer}
                className="text-indigo-600 hover:text-indigo-800 font-semibold text-[11px] flex items-center gap-0.5"
              >
                <span>영상 문구 다듬기</span>
                <ChevronRight className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>

        {/* Right: Compact Recent Multi-Channel Posts (5 Cols) */}
        <div className="lg:col-span-5 glass-panel rounded-2xl p-4 flex flex-col justify-between border border-white/70">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
              <Share2 className="w-3.5 h-3.5 text-indigo-600" />
              <span>최근 발행 콘텐츠</span>
            </h4>
            {onOpenComposer && (
              <button
                onClick={onOpenComposer}
                className="text-[11px] font-semibold px-2 py-0.5 rounded-lg bg-slate-900 text-white hover:bg-slate-800 transition-all flex items-center gap-1"
              >
                <Sparkles className="w-3 h-3 text-indigo-300" />
                <span>문구 편집</span>
              </button>
            )}
          </div>

          {/* Posts compact list */}
          <div className="space-y-2 overflow-y-auto max-h-[200px] pr-1">
            {filteredPosts.length === 0 && (
              <p className="text-[11px] text-slate-400 py-6 text-center">
                {connectedPlatforms.length === 0 ? '채널을 연동하면 발행한 콘텐츠가 표시됩니다.' : '아직 동기화된 콘텐츠가 없습니다.'}
              </p>
            )}
            {filteredPosts.slice(0, 3).map((post) => {
              const conf = PLATFORM_CONFIGS[post.platform];
              return (
                <div
                  key={post.id}
                  className="glass-card-compact rounded-xl p-2.5 transition-all hover:bg-white/70"
                >
                  <div className="flex items-center justify-between text-[10px] text-slate-400 mb-1">
                    <div className="flex items-center gap-1.5">
                      <span
                        className="w-1.5 h-1.5 rounded-full"
                        style={{ backgroundColor: conf.color }}
                      />
                      <span className="font-semibold text-slate-700">{conf.koreanName}</span>
                    </div>
                    <span>{relativeDay(post.publishedAt)}</span>
                  </div>

                  {post.permalink ? (
                    <a
                      href={post.permalink}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs font-medium text-slate-800 line-clamp-1 mb-1.5 hover:text-indigo-600 flex items-center gap-1"
                    >
                      <span className="line-clamp-1">{post.title}</span>
                      <ExternalLink className="w-2.5 h-2.5 shrink-0 text-slate-400" />
                    </a>
                  ) : (
                    <p className="text-xs font-medium text-slate-800 line-clamp-1 mb-1.5">
                      {post.title}
                    </p>
                  )}

                  <div className="flex items-center gap-3 text-[10px] font-medium text-slate-500">
                    <span className="flex items-center gap-0.5">
                      <Eye className="w-3 h-3 text-sky-400" />
                      {(post.views ?? 0).toLocaleString()}
                    </span>
                    <span className="flex items-center gap-0.5">
                      <Heart className="w-3 h-3 text-rose-400" />
                      {post.likes.toLocaleString()}
                    </span>
                    <span className="flex items-center gap-0.5">
                      <MessageSquare className="w-3 h-3 text-indigo-400" />
                      {post.comments.toLocaleString()}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="pt-2 mt-1 border-t border-slate-200/40 flex items-center justify-between text-[10px] text-slate-500">
            <span>
              {connectedPlatforms.length}/{activePlatforms.length}개 플랫폼 연동됨
              {overview?.connectedCount ? ` · ${overview.recentPosts.length}개 콘텐츠 동기화` : ''}
            </span>
            <button
              onClick={onOpenOnboarding}
              className="text-indigo-600 hover:underline font-medium"
            >
              질문 다시하기
            </button>
          </div>
        </div>

      </div>

      <PlatformConnectionsSection isAuthenticated={user.isLoggedIn} onOpenRawData={onOpenRawData} />

    </div>
  );
};
