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
  Bot
} from 'lucide-react';
import { PlatformType, UserProfile, AIAnalysisReport, EngagementDeepMetric, ContentFormatStat } from '../types';
import { PLATFORM_CONFIGS, ENGAGEMENT_DEEP_METRICS, CONTENT_FORMAT_STATS, DEFAULT_AI_REPORT } from '../data/mockData';

interface AIAnalysisModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: UserProfile;
  initialPlatform?: PlatformType | 'all';
}

type TabType = 'metrics' | 'advice' | 'advisor';

export const AIAnalysisModal: React.FC<AIAnalysisModalProps> = ({
  isOpen,
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
  
  // AI Report State
  const [report, setReport] = useState<AIAnalysisReport>(DEFAULT_AI_REPORT);
  const [isLoadingAnalysis, setIsLoadingAnalysis] = useState<boolean>(false);
  const [isLiveAiMode, setIsLiveAiMode] = useState<boolean>(false);

  // AI Advisor Chat State
  const [chatMessages, setChatMessages] = useState<Array<{ id: string; sender: 'user' | 'ai'; text: string; time: string }>>([
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

  // Request fresh AI Analysis from backend
  const handleFetchAiAnalysis = async () => {
    setIsLoadingAnalysis(true);
    try {
      const response = await fetch('/api/gemini/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userProfile: user,
          platformStats: {
            totalFollowers: 322400,
            totalViews: 4190600,
            avgEngagement: 7.7,
          },
        }),
      });

      const resData = await response.json();
      if (resData.success && resData.data && resData.data.overallScore) {
        setReport({
          ...resData.data,
          generatedAt: '방금 전 실시간 Gemini AI 분석 갱신됨',
        });
        setIsLiveAiMode(true);
      }
    } catch (err) {
      console.warn('Live AI endpoint unreachable, loaded default optimized report', err);
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
      const response = await fetch('/api/gemini/advisor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: textToSend,
          context: {
            userType: user.userType,
            platforms: user.selectedPlatforms,
            avgEngagement: '7.7%',
            topPlatform: 'threads (9.8%)',
          },
          history: chatMessages.map((m) => ({ role: m.sender === 'user' ? 'user' : 'model', text: m.text })),
        }),
      });

      const resData = await response.json();
      const aiReply = resData.reply || 'AI 응답을 생성하지 못했습니다.';

      setChatMessages((prev) => [
        ...prev,
        {
          id: `ai-${Date.now()}`,
          sender: 'ai',
          text: aiReply,
          time: '방금 전',
        },
      ]);
    } catch (error) {
      // Fallback response if offline
      setTimeout(() => {
        setChatMessages((prev) => [
          ...prev,
          {
            id: `ai-${Date.now()}`,
            sender: 'ai',
            text: `[실전 성장 팁] "${textToSend}"에 대한 제안:\n1. **쇼츠/릴스 도입 3초 훅**: 도입부에서 의문형 질문보다 '최종 결과/파격적 수치'를 먼저 보여주면 시청지속률이 28% 상승합니다.\n2. **쓰레드 15분 티키타카**: 발행 후 15분 내 달리는 모든 댓글에 맞댓글을 달아 알고리즘 가중치를 획득하세요.\n3. **X(트위터) 링크 분리**: 본문에는 텍스트와 이미지만 넣고, 외부 링크는 첫 번째 답글에 배치해 도달 페널티를 방지하세요.`,
            time: '방금 전',
          },
        ]);
      }, 500);
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
                <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-indigo-100 text-indigo-700 border border-indigo-200">
                  {report.scoreLabel} ({report.overallScore}점)
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                {userPlatforms.map((p) => PLATFORM_CONFIGS[p].koreanName).join(' · ')}의 참여율 심층 지표 및 알고리즘 맞춤 전략
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              id="ai-refresh-btn"
              onClick={handleFetchAiAnalysis}
              disabled={isLoadingAnalysis}
              className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-xl bg-white/70 hover:bg-white text-slate-700 border border-white/80 shadow-2xs transition-all disabled:opacity-50"
              title="실시간 AI 분석 갱신"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-indigo-600 ${isLoadingAnalysis ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">실시간 AI 재분석</span>
            </button>

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
              
              {/* Top Quick Highlights Banner */}
              <div className="glass-card rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3 bg-gradient-to-r from-indigo-50/70 via-purple-50/50 to-rose-50/70">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-indigo-600/10 text-indigo-700 flex items-center justify-center font-bold">
                    <Flame className="w-5 h-5 text-rose-500" />
                  </div>
                  <div>
                    <h4 className="text-xs font-extrabold text-slate-900">
                      최고 인게이지먼트 플랫폼: <span className="text-indigo-600">쓰레드 (Threads 9.8%)</span>
                    </h4>
                    <p className="text-[11px] text-slate-600 mt-0.5">
                      업계 평균(3.2%) 대비 <strong className="text-indigo-600 font-bold">+206%</strong> 높은 참여율을 기록 중입니다.
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-4 text-xs font-semibold text-slate-700 bg-white/70 px-3 py-1.5 rounded-xl border border-white/80">
                  <span className="flex items-center gap-1 text-slate-600">
                    <Clock className="w-3.5 h-3.5 text-indigo-500" />
                    <span>최적 발행 골든타임: <strong>오후 8:30 ~ 9:00</strong></span>
                  </span>
                </div>
              </div>

              {/* 4-Platform Detailed Engagement Metric Cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                {userPlatforms
                  .filter((p) => selectedPlatform === 'all' || selectedPlatform === p)
                  .map((p) => {
                    const metric = ENGAGEMENT_DEEP_METRICS[p];
                    const conf = PLATFORM_CONFIGS[p];
                    if (!metric) return null;

                    return (
                      <div
                        key={p}
                        id={`metric-deep-${p}`}
                        className="glass-card rounded-2xl p-4 space-y-3 transition-all hover:bg-white/80"
                      >
                        {/* Card Header */}
                        <div className="flex items-center justify-between pb-2 border-b border-slate-200/50">
                          <div className="flex items-center gap-2">
                            <div
                              className="w-7 h-7 rounded-xl flex items-center justify-center text-white shadow-2xs"
                              style={{ backgroundColor: conf.color }}
                            >
                              {p === 'youtube' && <Youtube className="w-4 h-4" />}
                              {p === 'instagram' && <Instagram className="w-4 h-4" />}
                              {p === 'threads' && <AtSign className="w-4 h-4" />}
                              {p === 'x' && <Twitter className="w-4 h-4" />}
                            </div>
                            <div>
                              <h5 className="font-bold text-xs text-slate-900">{conf.koreanName}</h5>
                              <span className="text-[10px] text-slate-400">심층 성과 지표</span>
                            </div>
                          </div>
                          <span className="text-[11px] font-extrabold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-md">
                            참여율 {metric.engagementRate}%
                          </span>
                        </div>

                        {/* Progress Indicator Bars for Save, Share, Retention */}
                        <div className="space-y-2 text-[11px]">
                          <div>
                            <div className="flex justify-between text-slate-600 mb-1">
                              <span>시청/열람 완독률</span>
                              <span className="font-bold text-slate-900">{metric.retentionRate}%</span>
                            </div>
                            <div className="w-full h-1.5 rounded-full bg-slate-100 overflow-hidden">
                              <div
                                className="h-full rounded-full bg-indigo-500"
                                style={{ width: `${metric.retentionRate}%` }}
                              />
                            </div>
                          </div>

                          <div>
                            <div className="flex justify-between text-slate-600 mb-1">
                              <span>콘텐츠 저장(Save)률</span>
                              <span className="font-bold text-slate-900">{metric.saveRate}%</span>
                            </div>
                            <div className="w-full h-1.5 rounded-full bg-slate-100 overflow-hidden">
                              <div
                                className="h-full rounded-full bg-rose-500"
                                style={{ width: `${Math.min(metric.saveRate * 4, 100)}%` }}
                              />
                            </div>
                          </div>

                          <div>
                            <div className="flex justify-between text-slate-600 mb-1">
                              <span>공유 & 리포스트 비율</span>
                              <span className="font-bold text-slate-900">{metric.shareRate}%</span>
                            </div>
                            <div className="w-full h-1.5 rounded-full bg-slate-100 overflow-hidden">
                              <div
                                className="h-full rounded-full bg-sky-500"
                                style={{ width: `${Math.min(metric.shareRate * 4, 100)}%` }}
                              />
                            </div>
                          </div>
                        </div>

                        {/* Additional Quick Data */}
                        <div className="pt-2 border-t border-slate-200/50 space-y-1.5 text-[10px] text-slate-600">
                          <div className="flex items-center justify-between">
                            <span className="text-slate-400">바이럴 잠재 지수</span>
                            <span className="font-bold text-emerald-600 flex items-center gap-0.5">
                              <Zap className="w-3 h-3 text-amber-500 fill-amber-500" />
                              {metric.viralityScore} / 100
                            </span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-slate-400">골든 타임</span>
                            <span className="font-semibold text-slate-800">{metric.peakTime}</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-slate-400">주력 연령대</span>
                            <span className="font-semibold text-slate-800">{metric.topAudienceAge}</span>
                          </div>
                        </div>

                      </div>
                    );
                  })}
              </div>

              {/* Format Efficiency Breakdown Table */}
              <div className="glass-panel rounded-2xl p-4 border border-white/70 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-xs font-extrabold text-slate-900 flex items-center gap-1.5">
                      <TrendingUp className="w-3.5 h-3.5 text-indigo-600" />
                      <span>포맷별 제작 효율성 & ROI 비교</span>
                    </h4>
                    <p className="text-[10px] text-slate-500 mt-0.5">
                      숏폼, 릴스, 텍스트 타래, 캐러셀 등 포맷별 반응률 분석
                    </p>
                  </div>
                  <span className="text-[10px] font-semibold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-md">
                    쇼츠 & 텍스트 타래 효율 최고
                  </span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-200/60 text-[11px] font-semibold text-slate-400">
                        <th className="pb-2 pl-2">콘텐츠 포맷</th>
                        <th className="pb-2">플랫폼</th>
                        <th className="pb-2">평균 도달/조회</th>
                        <th className="pb-2">참여율</th>
                        <th className="pb-2">평균 저장/공유</th>
                        <th className="pb-2 pr-2 text-right">종합 효율 점수</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200/40">
                      {CONTENT_FORMAT_STATS.filter((fmt) => userPlatforms.includes(fmt.platform)).map((fmt) => {
                        const conf = PLATFORM_CONFIGS[fmt.platform];
                        return (
                          <tr key={fmt.id} className="hover:bg-white/50 transition-colors">
                            <td className="py-2.5 pl-2 font-bold text-slate-900 flex items-center gap-1.5">
                              <span>{fmt.formatName}</span>
                            </td>
                            <td className="py-2.5">
                              <span className="inline-flex items-center gap-1 font-semibold text-slate-700">
                                <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: conf.color }} />
                                {conf.koreanName}
                              </span>
                            </td>
                            <td className="py-2.5 font-semibold text-slate-800">
                              {fmt.avgViews.toLocaleString()}회
                            </td>
                            <td className="py-2.5 font-bold text-indigo-600">
                              {fmt.avgEngagement}%
                            </td>
                            <td className="py-2.5 text-slate-600">
                              {fmt.avgSavesOrShares.toLocaleString()}건
                            </td>
                            <td className="py-2.5 pr-2 text-right">
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-extrabold text-[11px] bg-emerald-50 text-emerald-700">
                                <ArrowUpRight className="w-3 h-3 text-emerald-500" />
                                {fmt.efficiencyScore}점
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

            </div>
          )}

          {/* ===================== TAB 2: AI DIAGNOSIS & STRATEGIC ADVICE ===================== */}
          {activeTab === 'advice' && (
            <div className="space-y-4">
              
              {/* AI Summary Banner */}
              <div className="glass-card rounded-2xl p-4 bg-gradient-to-r from-indigo-50/80 via-white/70 to-purple-50/80 border border-indigo-100/60 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-indigo-600 flex items-center gap-1">
                    <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
                    <span>Gemini 3.7 AI 채널 종합 진단</span>
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
          {activeTab === 'advisor' && (
            <div className="flex flex-col h-[520px] max-h-[55vh] space-y-3">
              
              {/* Chat Messages Container */}
              <div className="flex-1 overflow-y-auto space-y-3 p-3 glass-card rounded-2xl border border-white/60">
                {chatMessages.map((msg) => {
                  const isUser = msg.sender === 'user';
                  return (
                    <div
                      key={msg.id}
                      className={`flex gap-2.5 ${isUser ? 'justify-end' : 'justify-start'}`}
                    >
                      {!isUser && (
                        <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-indigo-600 to-purple-600 text-white flex items-center justify-center shrink-0 shadow-2xs">
                          <Bot className="w-4 h-4" />
                        </div>
                      )}
                      
                      <div
                        className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-xs ${
                          isUser
                            ? 'bg-slate-900 text-white shadow-2xs rounded-tr-xs'
                            : 'glass-card bg-white/90 text-slate-800 shadow-2xs border border-white/80 rounded-tl-xs'
                        }`}
                      >
                        <p className="whitespace-pre-line leading-relaxed">{msg.text}</p>
                        <span
                          className={`text-[9px] block text-right mt-1 ${
                            isUser ? 'text-slate-400' : 'text-slate-400'
                          }`}
                        >
                          {msg.time}
                        </span>
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
            <span>AI 분석 알고리즘 모델 v3.7 • {userPlatforms.length}개 SNS 연동 데이터 기반</span>
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
