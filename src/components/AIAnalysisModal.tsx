import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  X,
  Sparkles,
  TrendingUp,
  BarChart3,
  MessageSquare,
  Flame,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Lightbulb,
  Calendar,
  Send,
  RefreshCw,
  Zap,
  Bookmark,
  Share2,
  Eye,
  Heart,
  ChevronRight,
  ShieldCheck,
  Layers,
  Youtube,
  Instagram,
  AtSign,
  Twitter,
  ArrowUpRight,
  Coins,
  Bot
} from 'lucide-react';
import { PlatformType, UserProfile, AIAnalysisReport } from '../types';
import { PLATFORM_CONFIGS } from '../data/platformConfig';
import { fetchInsights, type ChannelInsights, type InsightsResponse } from '../lib/insightsApi';
import { askAdvisor, requestAiReport } from '../lib/aiApi';
import { PlusLock, LockedValue, UpgradeCallout } from './PlusLock';

interface AIAnalysisModalProps {
  isOpen: boolean;
  /** 결제 플로우가 생기면 연결한다. 없으면 잠금 오버레이가 가격만 안내한다. */
  onUpgrade?: () => void;
  /** 크레딧 충전 진입점. 없으면 '준비 중'으로 표시된다. */
  onBuyCredits?: () => void;
  onClose: () => void;
  user: UserProfile;
  initialPlatform?: PlatformType | 'all';
}

type TabType = 'metrics' | 'advice' | 'advisor';

export const AIAnalysisModal: React.FC<AIAnalysisModalProps> = ({
  isOpen,
  onUpgrade,
  onBuyCredits,
  onClose,
  user,
  initialPlatform = 'all',
}) => {
  // Only analyse the channels this user actually runs
  const userPlatforms = (['youtube', 'instagram', 'threads', 'x'] as PlatformType[]).filter((p) =>
    user.selectedPlatforms.includes(p),
  );

  const [activeTab, setActiveTab] = useState<TabType>('metrics');
  const [selectedPlatform, setSelectedPlatform] = useState<PlatformType | 'all'>(initialPlatform);
  
  // AI Report State — 목업 기본값을 두지 않는다. 리포트는 AI가 만들기 전까지 존재하지 않는다.
  const [report, setReport] = useState<AIAnalysisReport | null>(null);
  const [isLoadingAnalysis, setIsLoadingAnalysis] = useState<boolean>(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [reportModel, setReportModel] = useState<string | null>(null);
  const [insights, setInsights] = useState<InsightsResponse | null>(null);
  const [isLoadingInsights, setIsLoadingInsights] = useState(false);
  const [insightsError, setInsightsError] = useState<string | null>(null);

  // AI Advisor Chat State
  const [chatMessages, setChatMessages] = useState<Array<{ id: string; sender: 'user' | 'ai' | 'error'; text: string; time: string }>>([
    {
      id: 'welcome',
      sender: 'ai',
      text: `반갑습니다, ${user.name}님! 저는 Ladder SNS 전담 AI 성장 전략가입니다. 현재 채널 지표를 기반으로 어떤 질문이든 구체적인 실전 액션 플랜을 제시해드릴게요. 아래 추천 질문을 누르거나 직접 물어보세요!`,
      time: '방금 전',
    },
  ]);
  const [inputQuery, setInputQuery] = useState('');
  const [isSendingQuery, setIsSendingQuery] = useState(false);

  useEffect(() => {
    if (initialPlatform) {
      setSelectedPlatform(initialPlatform);
    }
  }, [initialPlatform]);

  useEffect(() => {
    if (!isOpen || !user.isLoggedIn) return;
    const controller = new AbortController();
    setIsLoadingInsights(true);
    setInsightsError(null);
    fetchInsights('30d', controller.signal)
      .then(setInsights)
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setInsightsError(error instanceof Error ? error.message : '심층 지표를 불러오지 못했습니다.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoadingInsights(false);
      });
    return () => controller.abort();
  }, [isOpen, user.isLoggedIn]);

  const isPlus = insights?.plan === 'plus';
  const youtubeInsights: ChannelInsights[] = insights?.channels ?? [];

  // Request fresh AI Analysis from backend.
  // 분석 대상 수치는 보내지 않는다 — 서버가 이 사용자의 DB에서 직접 만든다.
  const handleFetchAiAnalysis = async () => {
    if (isLoadingAnalysis) return;
    setIsLoadingAnalysis(true);
    setAnalysisError(null);
    try {
      const response = await requestAiReport();
      setReportModel(response.model);
      setReport({
        ...response.report,
        generatedAt: new Date(response.generatedAt).toLocaleString('ko-KR'),
      });
    } catch (error) {
      setAnalysisError(error instanceof Error ? error.message : 'AI 분석에 실패했습니다.');
    } finally {
      setIsLoadingAnalysis(false);
    }
  };

  // Send message to AI Advisor
  const handleSendMessage = async (customPrompt?: string) => {
    const textToSend = customPrompt || inputQuery;
    if (!textToSend.trim() || isSendingQuery) return;

    const userMsg = {
      id: `u-${Date.now()}`,
      sender: 'user' as const,
      text: textToSend,
      time: '방금 전',
    };

    setChatMessages((prev) => [...prev, userMsg]);
    setInputQuery('');
    setIsSendingQuery(true);

    try {
      // 채널 현황은 보내지 않는다. 서버가 DB에서 만들어 프롬프트에 넣는다.
      const response = await askAdvisor(
        textToSend,
        chatMessages
          .filter((m) => m.id !== 'welcome')
          .map((m) => ({ role: m.sender === 'user' ? ('user' as const) : ('model' as const), text: m.text })),
      );

      setChatMessages((prev) => [
        ...prev,
        { id: `ai-${Date.now()}`, sender: 'ai', text: response.reply, time: '방금 전' },
      ]);
    } catch (error) {
      // AI가 답하지 못하면 그렇게 말한다. 미리 써둔 조언을 AI 답변인 척 보여주지 않는다.
      setChatMessages((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          sender: 'error',
          text: error instanceof Error ? error.message : '답변을 가져오지 못했습니다. 잠시 후 다시 시도해주세요.',
          time: '방금 전',
        },
      ]);
    } finally {
      setIsSendingQuery(false);
    }
  };

  const samplePrompts = [
    '🔥 이번 주 유튜브 쇼츠 3초 후킹 대본 공식',
    '📈 쓰레드 참여율 10% 돌파하는 타래 작성법',
    '🎯 인스타그램 릴스 저장(Save)률 2배 높이는 팁',
    '⚡ X(트위터) 바이럴 인용 RT 유도 전략',
  ];

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 md:p-6 overflow-y-auto">
      {/* Blurred Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 bg-slate-900/30 backdrop-blur-md transition-opacity"
      />

      {/* Main Glass Modal Window */}
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 15 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 15 }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        className="relative w-full max-w-5xl max-h-[90vh] glass-modal rounded-3xl shadow-2xl border border-white/80 flex flex-col overflow-hidden z-10 my-auto"
      >
        {/* 1. Modal Top Bar */}
        <div className="px-5 py-4 border-b border-white/60 flex items-center justify-between bg-white/40 backdrop-blur-xl shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-indigo-600 via-purple-600 to-rose-500 text-white flex items-center justify-center shadow-md">
              <Sparkles className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-extrabold text-slate-900 tracking-tight">
                  AI 정밀 지표 분석 & 성장 처방전
                </h3>
                {report && (
                  <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-indigo-100 text-indigo-700 border border-indigo-200">
                    {report.scoreLabel} ({report.overallScore}점)
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                {userPlatforms.map((p) => PLATFORM_CONFIGS[p].koreanName).join(' · ')}의 참여율 심층 지표 및 알고리즘 맞춤 전략
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Free 플랜에서는 호출해봐야 403이므로 버튼 자체를 내보내지 않는다. */}
            {isPlus && (
              <button
                id="ai-refresh-btn"
                onClick={handleFetchAiAnalysis}
                disabled={isLoadingAnalysis}
                className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-xl bg-white/70 hover:bg-white text-slate-700 border border-white/80 shadow-2xs transition-all disabled:opacity-50"
                title="실시간 AI 분석 갱신"
              >
                <RefreshCw className={`w-3.5 h-3.5 text-indigo-600 ${isLoadingAnalysis ? 'animate-spin' : ''}`} />
                <span className="hidden sm:inline">{report ? '실시간 AI 재분석' : 'AI 분석 실행'}</span>
              </button>
            )}

            <button
              id="ai-modal-close-btn"
              onClick={onClose}
              className="w-8 h-8 rounded-xl bg-white/50 hover:bg-white/90 text-slate-500 hover:text-slate-900 flex items-center justify-center transition-all border border-white/60"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* 2. Top Navigation Tabs */}
        <div className="px-5 py-2.5 bg-white/30 border-b border-white/50 flex flex-wrap items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-1.5 p-1 bg-white/50 rounded-2xl border border-white/70 shadow-2xs">
            <button
              id="tab-metrics-btn"
              onClick={() => setActiveTab('metrics')}
              className={`text-xs font-bold px-3.5 py-1.5 rounded-xl transition-all flex items-center gap-1.5 ${
                activeTab === 'metrics'
                  ? 'bg-slate-900 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-white/50'
              }`}
            >
              <BarChart3 className="w-3.5 h-3.5" />
              <span>참여율 & 세부 지표</span>
            </button>

            <button
              id="tab-advice-btn"
              onClick={() => setActiveTab('advice')}
              className={`text-xs font-bold px-3.5 py-1.5 rounded-xl transition-all flex items-center gap-1.5 ${
                activeTab === 'advice'
                  ? 'bg-slate-900 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-white/50'
              }`}
            >
              <Lightbulb className="w-3.5 h-3.5 text-amber-300" />
              <span>AI 종합 진단 & 처방</span>
            </button>

            <button
              id="tab-advisor-btn"
              onClick={() => setActiveTab('advisor')}
              className={`text-xs font-bold px-3.5 py-1.5 rounded-xl transition-all flex items-center gap-1.5 ${
                activeTab === 'advisor'
                  ? 'bg-slate-900 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-white/50'
              }`}
            >
              <Bot className="w-3.5 h-3.5 text-indigo-300" />
              <span>AI 1:1 컨설턴트</span>
            </button>
          </div>

          {/* Platform Sub-filter (for metrics & advice tabs) */}
          {activeTab !== 'advisor' && (
            <div className="flex items-center gap-1 text-xs">
              <span className="text-[11px] font-semibold text-slate-400 mr-1 hidden sm:inline">플랫폼 필터:</span>
              <button
                onClick={() => setSelectedPlatform('all')}
                className={`px-2.5 py-1 rounded-lg font-semibold transition-all ${
                  selectedPlatform === 'all'
                    ? 'bg-indigo-600 text-white shadow-2xs'
                    : 'bg-white/40 hover:bg-white/70 text-slate-600 border border-white/60'
                }`}
              >
                전체
              </button>
              {userPlatforms.map((p) => {
                const conf = PLATFORM_CONFIGS[p];
                const isSel = selectedPlatform === p;
                return (
                  <button
                    key={p}
                    onClick={() => setSelectedPlatform(p)}
                    className={`px-2 py-1 rounded-lg font-semibold flex items-center gap-1 transition-all ${
                      isSel
                        ? 'bg-white text-slate-900 shadow-2xs ring-1 ring-slate-300'
                        : 'bg-white/40 hover:bg-white/70 text-slate-600 border border-white/60'
                    }`}
                  >
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: conf.color }} />
                    <span className="hidden md:inline">{conf.koreanName}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* 3. Modal Body Content (Scrollable) */}
        <div className="p-4 sm:p-6 overflow-y-auto flex-1 space-y-4">
          
          {/* ===================== TAB 1: PARTICIPATION & DETAILED METRICS ===================== */}
          {activeTab === 'metrics' && (
            <div className="space-y-4">

              {!user.isLoggedIn && (
                <div className="glass-card rounded-2xl p-8 text-center space-y-1">
                  <p className="text-xs font-bold text-slate-700">로그인이 필요합니다</p>
                  <p className="text-[11px] text-slate-500">로그인하고 채널을 연동하면 실제 지표로 심층 분석을 볼 수 있습니다.</p>
                </div>
              )}

              {user.isLoggedIn && isLoadingInsights && !insights && (
                <div className="glass-card rounded-2xl p-8 text-center text-xs text-slate-500">
                  심층 지표를 불러오는 중…
                </div>
              )}

              {insightsError && (
                <div className="glass-card rounded-2xl p-6 text-center space-y-1">
                  <p className="text-xs font-semibold text-rose-600">{insightsError}</p>
                  <p className="text-[11px] text-slate-500">잠시 후 다시 시도해 주세요.</p>
                </div>
              )}

              {insights && youtubeInsights.length === 0 && (
                <div className="glass-card rounded-2xl p-8 text-center space-y-1">
                  <p className="text-xs font-bold text-slate-700">연동된 채널이 없습니다</p>
                  <p className="text-[11px] text-slate-500">채널을 연동하면 실제 지표로 심층 분석을 볼 수 있습니다.</p>
                </div>
              )}

              {!isPlus && youtubeInsights.length > 0 && (
                <UpgradeCallout
                  title="심층 지표는 Plus 전용입니다"
                  description="시청 지속률·CTR·바이럴 점수·시간대·포맷별 효율을 실제 채널 데이터로 봅니다. 아래 잠긴 항목이 모두 열립니다."
                  onUpgrade={onUpgrade}
                  onBuyCredits={onBuyCredits}
                />
              )}

              {youtubeInsights.map((channel) => {
                const conf = PLATFORM_CONFIGS.youtube;

                const deepPanel = (
                  <div className="glass-card rounded-2xl p-4 space-y-3">
                    <h5 className="text-xs font-extrabold text-slate-900 flex items-center gap-1.5">
                      <BarChart3 className="w-3.5 h-3.5 text-indigo-600" />
                      <span>심층 성과 지표</span>
                    </h5>
                    <div className="space-y-2 text-[11px]">
                      {[
                        { label: '시청 지속률', value: channel.retentionRate, bar: 'bg-indigo-500' },
                        { label: '저장(재생목록 추가)률', value: channel.saveRate, bar: 'bg-rose-500' },
                        { label: '노출 클릭률(CTR)', value: channel.clickThroughRate, bar: 'bg-sky-500' },
                      ].map((row) => (
                        <div key={row.label}>
                          <div className="flex justify-between text-slate-600 mb-1">
                            <span>{row.label}</span>
                            <span className="font-bold text-slate-900">
                              {row.value === null ? <LockedValue /> : `${row.value.toFixed(1)}%`}
                            </span>
                          </div>
                          <div className="w-full h-1.5 rounded-full bg-slate-100 overflow-hidden">
                            <div className={`h-full rounded-full ${row.bar}`} style={{ width: `${Math.min(row.value ?? 60, 100)}%` }} />
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="pt-2 border-t border-slate-200/50 flex items-center justify-between text-[10px]">
                      <span className="text-slate-400">주력 연령대</span>
                      <span className="font-semibold text-slate-800">
                        {channel.topAudienceAge
                          ? `${channel.topAudienceAge.ageGroup.replace('age', '')}세 (${channel.topAudienceAge.sharePercent}%)`
                          : <LockedValue width="w-16" />}
                      </span>
                    </div>
                  </div>
                );

                const viralityPanel = (
                  <div className="glass-card rounded-2xl p-4 space-y-2">
                    <h5 className="text-xs font-extrabold text-slate-900 flex items-center gap-1.5">
                      <Zap className="w-3.5 h-3.5 text-amber-500 fill-amber-500" />
                      <span>바이럴 점수</span>
                    </h5>
                    {channel.virality && channel.virality.score === null ? (
                      <p className="text-[11px] text-slate-500 py-3">{channel.virality.note}</p>
                    ) : (
                      <>
                        <p className="text-2xl font-extrabold text-slate-900">
                          {channel.virality ? channel.virality.score : <LockedValue width="w-12" />}
                          <span className="text-xs font-semibold text-slate-400"> / 100</span>
                        </p>
                        <div className="space-y-1 text-[10px] text-slate-600 pt-1 border-t border-slate-200/50">
                          <div className="flex justify-between">
                            <span className="text-slate-400">도달 배수 (조회/구독자)</span>
                            <span className="font-semibold">
                              {channel.virality && channel.virality.components.reachMultiple !== null
                                ? `${channel.virality.components.reachMultiple.toFixed(2)}배`
                                : <LockedValue />}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-400">비구독자 시청 비중</span>
                            <span className="font-semibold">
                              {channel.virality && channel.virality.components.nonSubscriberShare !== null
                                ? `${channel.virality.components.nonSubscriberShare.toFixed(1)}%`
                                : <LockedValue />}
                            </span>
                          </div>
                        </div>
                        {channel.virality && channel.virality.note && (
                          <p className="text-[10px] text-amber-700 bg-amber-50 rounded-lg px-2 py-1">{channel.virality.note}</p>
                        )}
                      </>
                    )}
                  </div>
                );

                const peakPanel = (
                  <div className="glass-card rounded-2xl p-4 space-y-2">
                    <h5 className="text-xs font-extrabold text-slate-900 flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-indigo-600" />
                      <span>업로드 시간대별 반응</span>
                    </h5>
                    {channel.peakTime && !channel.peakTime.available ? (
                      <p className="text-[11px] text-slate-500 py-3">{channel.peakTime.reason}</p>
                    ) : (
                      <>
                        <p className="text-sm font-extrabold text-slate-900">
                          {channel.peakTime && channel.peakTime.best ? channel.peakTime.best.label : <LockedValue width="w-20" />}
                        </p>
                        <p className="text-[11px] text-slate-600">
                          {channel.peakTime && channel.peakTime.best
                            ? `이 시간대에 올린 영상이 채널 평균의 ${channel.peakTime.best.multiple}배 · 영상 ${channel.peakTime.best.videoCount}개 기준`
                            : '표본 수와 함께 표시됩니다.'}
                        </p>
                        <p className="text-[10px] text-slate-400 pt-1 border-t border-slate-200/50">
                          업로드 시각과 성과의 상관입니다. 인과가 아니므로 참고용으로 보세요.
                        </p>
                      </>
                    )}
                  </div>
                );

                const formatRows = channel.formats ?? [
                  { format: 'shorts' as const, formatName: '쇼츠 (3분 이하)', videoCount: 0, medianInitialViews: 0, medianShares: null, efficiencyScore: null },
                  { format: 'longform' as const, formatName: '롱폼 (10분 초과)', videoCount: 0, medianInitialViews: 0, medianShares: null, efficiencyScore: null },
                ];

                const formatPanel = (
                  <div className="glass-panel rounded-2xl p-4 border border-white/70 space-y-3">
                    <div>
                      <h4 className="text-xs font-extrabold text-slate-900 flex items-center gap-1.5">
                        <TrendingUp className="w-3.5 h-3.5 text-indigo-600" />
                        <span>포맷별 효율</span>
                      </h4>
                      <p className="text-[10px] text-slate-500 mt-0.5">발행 후 3일 조회수 중앙값 기준</p>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead>
                          <tr className="border-b border-slate-200/60 text-[11px] font-semibold text-slate-400">
                            <th className="pb-2 pl-2">포맷</th>
                            <th className="pb-2">영상 수</th>
                            <th className="pb-2">초기 조회수(중앙값)</th>
                            <th className="pb-2 pr-2 text-right">효율 점수</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200/40">
                          {formatRows.map((fmt) => (
                            <tr key={fmt.format} className="hover:bg-white/50 transition-colors">
                              <td className="py-2.5 pl-2 font-bold text-slate-900">{fmt.formatName}</td>
                              <td className="py-2.5 text-slate-600">{fmt.videoCount}개</td>
                              <td className="py-2.5 font-semibold text-slate-800">
                                {channel.formats ? `${fmt.medianInitialViews.toLocaleString()}회` : <LockedValue width="w-14" />}
                              </td>
                              <td className="py-2.5 pr-2 text-right">
                                {fmt.efficiencyScore === null ? (
                                  channel.formats ? (
                                    <span className="text-[10px] text-slate-400">표본 부족</span>
                                  ) : (
                                    <LockedValue />
                                  )
                                ) : (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-extrabold text-[11px] bg-emerald-50 text-emerald-700">
                                    <ArrowUpRight className="w-3 h-3 text-emerald-500" />
                                    {fmt.efficiencyScore}점
                                  </span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {channel.bestFormat && (
                      <p className="text-[11px] text-slate-600">
                        가장 효율이 높은 포맷: <strong className="text-indigo-600">{channel.bestFormat.formatName}</strong>
                        {` · 영상 ${channel.bestFormat.videoCount}개 기준`}
                      </p>
                    )}
                  </div>
                );

                return (
                  <div key={channel.socialChannelId} className="space-y-3">

                    <div className="glass-card rounded-2xl p-4 space-y-3">
                      <div className="flex items-center justify-between pb-2 border-b border-slate-200/50">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-xl flex items-center justify-center text-white shadow-2xs" style={{ backgroundColor: conf.color }}>
                            <Youtube className="w-4 h-4" />
                          </div>
                          <div>
                            <h5 className="font-bold text-xs text-slate-900">{channel.displayName}</h5>
                            <span className="text-[10px] text-slate-400">
                              {channel.handle || '유튜브'} · 구독자 {channel.subscribers.toLocaleString()}
                            </span>
                          </div>
                        </div>
                        <span className="text-[10px] font-semibold text-slate-500">최근 {insights ? insights.days : 30}일</span>
                      </div>

                      <div className="grid grid-cols-3 gap-2 text-center">
                        {[
                          { label: '참여율', value: `${channel.engagementRate}%`, tone: 'text-rose-600' },
                          { label: '공유율', value: `${channel.shareRate}%`, tone: 'text-sky-600' },
                          { label: '댓글 비율', value: `${channel.commentRatio}%`, tone: 'text-indigo-600' },
                        ].map((item) => (
                          <div key={item.label} className="rounded-xl bg-white/60 py-2">
                            <span className="text-[10px] text-slate-500">{item.label}</span>
                            <p className={`text-sm font-extrabold mt-0.5 ${item.tone}`}>{item.value}</p>
                          </div>
                        ))}
                      </div>
                    </div>

                    {isPlus ? deepPanel : (
                      <PlusLock
                        title="심층 성과 지표는 Plus 전용"
                        description="시청 지속률·저장률·CTR·주력 연령대를 실제 채널 데이터로 확인할 수 있습니다."
                        showCta={false}
                      >
                        {deepPanel}
                      </PlusLock>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {isPlus ? viralityPanel : (
                        <PlusLock title="바이럴 점수는 Plus 전용" compact showCta={false}>
                          {viralityPanel}
                        </PlusLock>
                      )}
                      {isPlus ? peakPanel : (
                        <PlusLock title="시간대 분석은 Plus 전용" compact showCta={false}>
                          {peakPanel}
                        </PlusLock>
                      )}
                    </div>

                    {isPlus ? formatPanel : (
                      <PlusLock
                        title="포맷별 효율은 Plus 전용"
                        description="쇼츠·미들폼·롱폼·라이브 중 어떤 포맷이 이 채널에서 실제로 잘 되는지 비교합니다."
                        showCta={false}
                      >
                        {formatPanel}
                      </PlusLock>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* ===================== TAB 2: AI DIAGNOSIS & STRATEGIC ADVICE ===================== */}
          {/* AI 종합 진단은 Plus 전용. 서버도 403으로 막으므로 이 잠금은 표시일 뿐이다. */}
          {activeTab === 'advice' && !isPlus && (
            <PlusLock
              title="AI 종합 진단은 Plus 전용"
              description="연동된 채널의 실제 지표를 AI가 읽고 강점·병목·플랫폼별 처방과 주간 콘텐츠 로드맵을 만들어 드립니다."
              onUpgrade={onUpgrade}
            >
              <div className="space-y-4">
                <div className="glass-card rounded-2xl p-4 space-y-2">
                  <div className="h-3 w-32 rounded bg-slate-200/80" />
                  <div className="h-2.5 w-full rounded bg-slate-200/60" />
                  <div className="h-2.5 w-4/5 rounded bg-slate-200/60" />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {[0, 1].map((i) => (
                    <div key={i} className="glass-card rounded-2xl p-4 space-y-2">
                      <div className="h-3 w-28 rounded bg-slate-200/80" />
                      {[0, 1, 2].map((j) => (
                        <div key={j} className="h-2.5 w-full rounded bg-slate-200/60" />
                      ))}
                    </div>
                  ))}
                </div>
                <div className="glass-card rounded-2xl p-4 h-28" />
              </div>
            </PlusLock>
          )}

          {activeTab === 'advice' && isPlus && !report && (
            <div className="glass-card rounded-2xl p-8 flex flex-col items-center justify-center gap-3 text-center">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-indigo-600 to-purple-600 text-white flex items-center justify-center">
                <Sparkles className={`w-6 h-6 ${isLoadingAnalysis ? 'animate-spin' : ''}`} />
              </div>
              <p className="text-xs font-semibold text-slate-700">
                {isLoadingAnalysis
                  ? 'AI가 연동된 채널의 실제 지표를 읽고 리포트를 작성 중입니다...'
                  : '아직 생성된 리포트가 없습니다. 지금 채널 데이터를 기준으로 진단을 만들어 보세요.'}
              </p>
              {analysisError && (
                <div className="flex flex-col items-center gap-2">
                  <p className="max-w-sm text-xs font-semibold text-rose-600">{analysisError}</p>
                  {onBuyCredits && analysisError.includes('크레딧') && (
                    <button
                      onClick={onBuyCredits}
                      className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-extrabold text-slate-700 hover:bg-slate-50"
                    >
                      <Coins className="h-3 w-3 text-amber-500" />크레딧 충전
                    </button>
                  )}
                </div>
              )}
              <button
                onClick={handleFetchAiAnalysis}
                disabled={isLoadingAnalysis}
                className="inline-flex items-center gap-1.5 text-xs font-bold px-4 py-2 rounded-xl bg-slate-900 text-white hover:bg-slate-800 transition-all disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isLoadingAnalysis ? 'animate-spin' : ''}`} />
                <span>{isLoadingAnalysis ? '분석 중' : 'AI 종합 진단 생성'}</span>
              </button>
            </div>
          )}

          {activeTab === 'advice' && isPlus && report && (
            <div className="space-y-4">

              {analysisError && (
                <div className="glass-card rounded-2xl p-3 border-l-4 border-l-rose-500">
                  <p className="text-xs font-semibold text-rose-600">{analysisError}</p>
                </div>
              )}

              {/* AI Summary Banner */}
              <div className="glass-card rounded-2xl p-4 bg-gradient-to-r from-indigo-50/80 via-white/70 to-purple-50/80 border border-indigo-100/60 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-indigo-600 flex items-center gap-1">
                    <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
                    <span>AI 채널 종합 진단{reportModel ? ` · ${reportModel}` : ''}</span>
                  </span>
                  <span className="text-[10px] text-slate-400">{report.generatedAt}</span>
                </div>
                <p className="text-xs font-medium text-slate-800 leading-relaxed">
                  {report.summary}
                </p>
              </div>

              {/* Strengths & Bottlenecks Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                
                {/* Strengths */}
                <div className="glass-card rounded-2xl p-4 border-l-4 border-l-emerald-500 space-y-2">
                  <h4 className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    <span>핵심 성장 동력 (Key Strengths)</span>
                  </h4>
                  <ul className="space-y-2">
                    {report.keyStrengths.map((item, idx) => (
                      <li key={idx} className="text-xs text-slate-700 flex items-start gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mt-1.5 shrink-0" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Bottlenecks */}
                <div className="glass-card rounded-2xl p-4 border-l-4 border-l-amber-500 space-y-2">
                  <h4 className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4 text-amber-500" />
                    <span>성장 병목 및 개선점 (Action Required)</span>
                  </h4>
                  <ul className="space-y-2">
                    {report.bottlenecks.map((item, idx) => (
                      <li key={idx} className="text-xs text-slate-700 flex items-start gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 mt-1.5 shrink-0" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>

              </div>

              {/* Platform-by-Platform Actionable Strategies */}
              <div className="space-y-3">
                <h4 className="text-xs font-extrabold text-slate-900 flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-indigo-600" />
                  <span>플랫폼별 2026 알고리즘 최적화 처방전</span>
                </h4>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {report.channelAdvice
                    .filter((item) => userPlatforms.includes(item.platform))
                    .filter((item) => selectedPlatform === 'all' || selectedPlatform === item.platform)
                    .map((item) => {
                      const conf = PLATFORM_CONFIGS[item.platform];
                      return (
                        <div
                          key={item.platform}
                          id={`advice-card-${item.platform}`}
                          className="glass-card rounded-2xl p-4 space-y-2.5 transition-all hover:bg-white/80"
                        >
                          <div className="flex items-center justify-between pb-2 border-b border-slate-200/50">
                            <div className="flex items-center gap-2">
                              <div
                                className="w-6 h-6 rounded-lg flex items-center justify-center text-white"
                                style={{ backgroundColor: conf.color }}
                              >
                                {item.platform === 'youtube' && <Youtube className="w-3.5 h-3.5" />}
                                {item.platform === 'instagram' && <Instagram className="w-3.5 h-3.5" />}
                                {item.platform === 'threads' && <AtSign className="w-3.5 h-3.5" />}
                                {item.platform === 'x' && <Twitter className="w-3.5 h-3.5" />}
                              </div>
                              <h5 className="font-bold text-xs text-slate-900">{conf.koreanName}</h5>
                            </div>
                            <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-md">
                              {item.expectedGrowth}
                            </span>
                          </div>

                          <p className="text-xs font-bold text-indigo-950">
                            🎯 {item.strategy}
                          </p>

                          <div className="space-y-1.5">
                            {item.tactics.map((tactic, tIdx) => (
                              <div key={tIdx} className="text-[11px] text-slate-600 flex items-start gap-1.5">
                                <span className="font-bold text-indigo-500">{tIdx + 1}.</span>
                                <span>{tactic}</span>
                              </div>
                            ))}
                          </div>

                          <div className="pt-2 border-t border-slate-200/40 text-[10px] space-y-1">
                            <div className="text-indigo-700 font-medium bg-indigo-50/80 p-2 rounded-xl">
                              {item.hookTip}
                            </div>
                            <div className="flex justify-between text-slate-500 pt-0.5">
                              <span>추천 발행 시간:</span>
                              <span className="font-semibold text-slate-800">{item.recommendedPostingTime}</span>
                            </div>
                          </div>

                        </div>
                      );
                    })}
                </div>
              </div>

              {/* Weekly 7-Day Content Roadmap */}
              <div className="glass-panel rounded-2xl p-4 border border-white/70 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-extrabold text-slate-900 flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-indigo-600" />
                    <span>이번 주 7일 AI 추천 콘텐츠 로드맵</span>
                  </h4>
                  <span className="text-[10px] text-slate-500">지표 기반 맞춤 주제</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
                  {report.contentRoadmap.filter((road) => userPlatforms.includes(road.platform)).slice(0, 4).map((road, rIdx) => {
                    const conf = PLATFORM_CONFIGS[road.platform];
                    return (
                      <div
                        key={rIdx}
                        className="glass-card-compact rounded-xl p-2.5 space-y-1.5 hover:bg-white/80 transition-all"
                      >
                        <div className="flex items-center justify-between text-[10px]">
                          <span className="font-bold text-indigo-600">{road.day}</span>
                          <span
                            className="px-1.5 py-0.5 rounded font-semibold text-white text-[9px]"
                            style={{ backgroundColor: conf.color }}
                          >
                            {conf.koreanName}
                          </span>
                        </div>
                        <p className="text-xs font-bold text-slate-900 line-clamp-1">
                          {road.topic}
                        </p>
                        <p className="text-[10px] text-slate-500 italic line-clamp-2">
                          "{road.hook}"
                        </p>
                        <div className="text-[9px] font-medium text-slate-400 pt-1 border-t border-slate-200/40">
                          포맷: {road.format}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

            </div>
          )}

          {/* ===================== TAB 3: AI ADVISOR 1:1 CHAT ===================== */}
          {/* 1:1 컨설턴트도 Plus 전용. 서버가 403으로 막고, 여기서는 그 상태를 보여준다. */}
          {activeTab === 'advisor' && !isPlus && (
            <PlusLock
              title="AI 1:1 컨설턴트는 Plus 전용"
              description="내 채널의 실제 지표를 읽은 AI에게 성장 전략을 직접 물어볼 수 있습니다."
              onUpgrade={onUpgrade}
            >
              <div className="flex flex-col h-[420px] max-h-[45vh] gap-3">
                <div className="flex-1 glass-card rounded-2xl border border-white/60 p-3 space-y-3">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className={`flex ${i % 2 === 1 ? 'justify-end' : 'justify-start'}`}>
                      <div className="h-12 w-2/3 rounded-2xl bg-slate-200/70" />
                    </div>
                  ))}
                </div>
                <div className="h-10 rounded-2xl bg-slate-200/60" />
              </div>
            </PlusLock>
          )}

          {activeTab === 'advisor' && isPlus && (
            <div className="flex flex-col h-[520px] max-h-[55vh] space-y-3">
              
              {/* Chat Messages Container */}
              <div className="flex-1 overflow-y-auto space-y-3 p-3 glass-card rounded-2xl border border-white/60">
                {chatMessages.map((msg) => {
                  const isUser = msg.sender === 'user';
                  const isError = msg.sender === 'error';
                  return (
                    <div
                      key={msg.id}
                      className={`flex gap-2.5 ${isUser ? 'justify-end' : 'justify-start'}`}
                    >
                      {!isUser && (
                        <div
                          className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 shadow-2xs ${
                            isError
                              ? 'bg-rose-100 text-rose-600 border border-rose-200'
                              : 'bg-gradient-to-tr from-indigo-600 to-purple-600 text-white'
                          }`}
                        >
                          {isError ? <AlertTriangle className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
                        </div>
                      )}

                      <div
                        className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-xs ${
                          isUser
                            ? 'bg-slate-900 text-white shadow-2xs rounded-tr-xs'
                            : isError
                              ? 'bg-rose-50 text-rose-700 border border-rose-200 rounded-tl-xs'
                              : 'glass-card bg-white/90 text-slate-800 shadow-2xs border border-white/80 rounded-tl-xs'
                        }`}
                      >
                        <p className="whitespace-pre-line leading-relaxed">{msg.text}</p>
                        <span className="text-[9px] block text-right mt-1 text-slate-400">{msg.time}</span>
                      </div>
                    </div>
                  );
                })}

                {isSendingQuery && (
                  <div className="flex gap-2.5 items-center text-xs text-slate-500 pl-1">
                    <div className="w-6 h-6 rounded-lg bg-indigo-500/10 text-indigo-600 flex items-center justify-center">
                      <Sparkles className="w-3.5 h-3.5 animate-spin" />
                    </div>
                    <span>AI가 채널 데이터를 분석하여 최적의 답변을 작성 중입니다...</span>
                  </div>
                )}
              </div>

              {/* Sample Prompt Chips */}
              <div className="flex items-center gap-1.5 overflow-x-auto py-1 shrink-0">
                <span className="text-[10px] font-bold text-slate-400 shrink-0">추천 질문:</span>
                {samplePrompts.map((prompt, pIdx) => (
                  <button
                    key={pIdx}
                    onClick={() => handleSendMessage(prompt)}
                    className="text-[11px] px-2.5 py-1 rounded-xl bg-white/60 hover:bg-white text-slate-700 border border-white/80 shadow-2xs whitespace-nowrap transition-all hover:text-indigo-600"
                  >
                    {prompt}
                  </button>
                ))}
              </div>

              {/* Message Input Box */}
              <div className="flex items-center gap-2 shrink-0">
                <input
                  type="text"
                  value={inputQuery}
                  onChange={(e) => setInputQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSendMessage();
                  }}
                  placeholder="소셜 미디어 성장 전략, 바이럴 팁, 알고리즘 대응에 대해 질문하세요..."
                  className="flex-1 text-xs px-4 py-2.5 rounded-2xl glass-card bg-white/80 border border-white/80 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 text-slate-900 placeholder:text-slate-400"
                />
                <button
                  id="ai-send-btn"
                  onClick={() => handleSendMessage()}
                  disabled={!inputQuery.trim() || isSendingQuery}
                  className="px-4 py-2.5 rounded-2xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold flex items-center gap-1.5 transition-all disabled:opacity-50 shadow-xs"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>전송</span>
                </button>
              </div>

            </div>
          )}

        </div>

        {/* 4. Modal Footer */}
        <div className="px-5 py-3 border-t border-white/60 bg-white/40 backdrop-blur-xl flex items-center justify-between text-xs text-slate-500 shrink-0">
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-indigo-600" />
            <span>{userPlatforms.length}개 SNS 연동 데이터 기반{reportModel ? ` • ${reportModel}` : ''}</span>
          </div>
          <button
            onClick={onClose}
            className="text-xs font-semibold px-3 py-1 rounded-xl bg-slate-900 text-white hover:bg-slate-800 transition-all shadow-2xs"
          >
            확인 및 닫기
          </button>
        </div>

      </motion.div>
    </div>
  );
};
