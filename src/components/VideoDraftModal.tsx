import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { AlertCircle, CheckCircle2, Coins, ExternalLink, LoaderCircle, Save, Sparkles, Wand2, X, Youtube } from 'lucide-react';
import { requestVideoDraft } from '../lib/aiApi';
import { updateVideo } from '../lib/youtubeManageApi';
import { fetchMetricsOverview, type OverviewPost } from '../lib/metricsApi';
import { PlusLock } from './PlusLock';

/**
 * 이미 올라간 YouTube 영상의 제목·설명을 AI 도움을 받아 다시 쓰고, 실제로 저장한다.
 *
 * 이 화면의 전신은 "4개 SNS 동시 발행" 컴포저였는데 전부 가짜였다 — 발행 API가 서버에 없어
 * 버튼을 눌러도 로컬 배열에만 쌓였고, 'AI 캡션 자동 완성'은 setTimeout으로 미리 써둔 문단
 * 세 개 중 하나를 골라 넣었다.
 *
 * 실제로 쓰기 권한이 있는 곳은 YouTube 하나뿐이고(youtube.force-ssl), 그 권한으로 할 수 있는
 * 건 새 영상 업로드가 아니라 기존 영상의 메타데이터 수정이다. 그래서 화면을 그 사실에 맞췄다.
 * 저장은 이미 있는 PATCH .../videos/:contentId 를 그대로 쓴다.
 */

const MAX_TITLE = 100;
const MAX_DESCRIPTION = 5000;

interface VideoDraftModalProps {
  isOpen: boolean;
  onClose: () => void;
  isPlus: boolean;
  onUpgrade?: () => void;
  onBuyCredits?: () => void;
  /** 저장이 성공하면 대시보드가 지표를 다시 읽도록 알린다. */
  onSaved?: () => void;
}

export const VideoDraftModal: React.FC<VideoDraftModalProps> = ({ isOpen, onClose, isPlus, onUpgrade, onBuyCredits, onSaved }) => {
  const [videos, setVideos] = useState<OverviewPost[]>([]);
  const [isLoadingVideos, setIsLoadingVideos] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [tone, setTone] = useState('');

  const [isDrafting, setIsDrafting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [usage, setUsage] = useState<{ remaining: number; credits: number } | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const controller = new AbortController();
    setIsLoadingVideos(true);
    setListError(null);
    // 대시보드가 이미 쓰는 엔드포인트다. 영상 목록만을 위한 API를 새로 만들지 않는다.
    fetchMetricsOverview('30d', controller.signal)
      .then((overview) => setVideos(overview.recentPosts.filter((post) => post.platform === 'youtube')))
      .catch((requestError: unknown) => {
        if (controller.signal.aborted) return;
        setListError(requestError instanceof Error ? requestError.message : '영상 목록을 불러오지 못했습니다.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoadingVideos(false);
      });
    return () => controller.abort();
  }, [isOpen]);

  if (!isOpen) return null;

  const selected = videos.find((video) => video.id === selectedId) || null;

  const selectVideo = (video: OverviewPost) => {
    setSelectedId(video.id);
    setTitle(video.title);
    setDescription('');
    setError(null);
    setSavedMessage(null);
  };

  const handleDraft = async () => {
    if (!selected || isDrafting) return;
    setIsDrafting(true);
    setError(null);
    setSavedMessage(null);
    try {
      const result = await requestVideoDraft(selected.id, tone.trim());
      setTitle(result.draft.title);
      setDescription(result.draft.description);
      setUsage({ remaining: result.usage.remaining, credits: result.usage.credits });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'AI 초안을 만들지 못했습니다.');
    } finally {
      setIsDrafting(false);
    }
  };

  const handleSave = async () => {
    if (!selected || isSaving || !title.trim()) return;
    setIsSaving(true);
    setError(null);
    setSavedMessage(null);
    try {
      // 설명을 비운 채 저장하면 YouTube의 기존 설명이 지워진다. 사용자가 손대지 않았으면 보내지 않는다.
      await updateVideo(selected.socialChannelId, selected.id, {
        title: title.trim(),
        ...(description ? { description } : {}),
      });
      setSavedMessage('YouTube에 반영했습니다.');
      onSaved?.();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '저장하지 못했습니다.');
    } finally {
      setIsSaving(false);
    }
  };

  const body = !isPlus ? (
    <PlusLock
      title="영상 문구 AI 초안은 Plus 전용"
      description="채널의 실제 지표를 읽은 AI가 제목과 설명을 다시 써줍니다. 직접 수정은 원본 데이터 화면에서 언제든 가능합니다."
      onUpgrade={onUpgrade}
    >
      <div className="space-y-3">
        <div className="h-24 rounded-2xl bg-slate-200/60" />
        <div className="h-10 rounded-xl bg-slate-200/60" />
        <div className="h-28 rounded-xl bg-slate-200/60" />
      </div>
    </PlusLock>
  ) : (
    <div className="space-y-4">
      <div>
        <label className="mb-1.5 block text-xs font-bold text-slate-700">대상 영상 선택</label>
        {isLoadingVideos ? (
          <p className="flex items-center gap-1.5 py-4 text-[11px] text-slate-500">
            <LoaderCircle className="h-3.5 w-3.5 animate-spin" />영상 목록을 불러오는 중입니다.
          </p>
        ) : listError ? (
          <p className="py-3 text-[11px] font-semibold text-rose-600">{listError}</p>
        ) : videos.length === 0 ? (
          <p className="py-4 text-[11px] text-slate-500">
            동기화된 YouTube 영상이 없습니다. 연동 정보에서 동기화를 먼저 실행해주세요.
          </p>
        ) : (
          <div className="max-h-40 space-y-1.5 overflow-y-auto pr-1">
            {videos.map((video) => (
              <button
                key={video.id}
                type="button"
                onClick={() => selectVideo(video)}
                className={`w-full rounded-xl border p-2.5 text-left transition-all ${
                  selectedId === video.id
                    ? 'border-indigo-500 bg-white shadow-xs ring-1 ring-indigo-500/20'
                    : 'border-slate-200/80 bg-white/50 hover:bg-white/80'
                }`}
              >
                <div className="flex items-center gap-2">
                  <Youtube className="h-3.5 w-3.5 shrink-0 text-red-500" />
                  <span className="line-clamp-1 flex-1 text-xs font-semibold text-slate-800">{video.title}</span>
                  <span className="shrink-0 text-[10px] text-slate-400">조회 {video.views.toLocaleString()}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {selected && (
        <>
          <div>
            <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
              <label className="text-xs font-bold text-slate-700">어떤 방향으로 다시 쓸까요? (선택)</label>
              {usage && (
                <span className="text-[10px] text-slate-400">
                  이번 달 남은 초안 {usage.remaining}회 · 크레딧 {usage.credits}
                </span>
              )}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={tone}
                onChange={(event) => setTone(event.target.value)}
                maxLength={100}
                placeholder="예: 검색에 걸리게, 더 짧고 담백하게"
                className="glass-input flex-1 rounded-xl px-3 py-2 text-xs text-slate-900"
              />
              <button
                type="button"
                onClick={() => void handleDraft()}
                disabled={isDrafting}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 px-3.5 py-2 text-xs font-extrabold text-white hover:opacity-95 disabled:opacity-50"
              >
                <Wand2 className={`h-3.5 w-3.5 ${isDrafting ? 'animate-spin' : ''}`} />
                {isDrafting ? '작성 중' : 'AI 초안'}
              </button>
            </div>
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label className="text-xs font-bold text-slate-700">제목</label>
              <span className={`text-[10px] ${title.length > MAX_TITLE ? 'font-bold text-rose-600' : 'text-slate-400'}`}>
                {title.length}/{MAX_TITLE}
              </span>
            </div>
            <input
              type="text"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={MAX_TITLE}
              className="glass-input w-full rounded-xl px-3.5 py-2.5 text-sm font-medium text-slate-900"
            />
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label className="text-xs font-bold text-slate-700">설명</label>
              <span className="text-[10px] text-slate-400">{description.length}/{MAX_DESCRIPTION}</span>
            </div>
            <textarea
              rows={6}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={MAX_DESCRIPTION}
              placeholder="비워두면 YouTube의 기존 설명을 그대로 둡니다."
              className="glass-input w-full resize-none rounded-2xl p-3.5 text-sm leading-relaxed text-slate-900"
            />
          </div>

          {error && (
            <div role="alert" className="space-y-2">
              <p className="flex items-start gap-1.5 text-xs font-semibold text-rose-600">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {error}
              </p>
              {onBuyCredits && error.includes('크레딧') && (
                <button
                  type="button"
                  onClick={onBuyCredits}
                  className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-extrabold text-slate-700 hover:bg-slate-50"
                >
                  <Coins className="h-3 w-3 text-amber-500" />크레딧 충전
                </button>
              )}
            </div>
          )}
          {savedMessage && (
            <p className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600">
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
              {savedMessage}
            </p>
          )}

          <div className="flex items-center justify-between gap-2 pt-1">
            {selected.permalink ? (
              <a
                href={selected.permalink}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-500 hover:text-indigo-600"
              >
                YouTube에서 보기<ExternalLink className="h-3 w-3" />
              </a>
            ) : (
              <span />
            )}
            <div className="flex items-center gap-2">
              <button type="button" onClick={onClose} className="rounded-xl px-4 py-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-100">
                닫기
              </button>
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={isSaving || !title.trim()}
                className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-5 py-2.5 text-xs font-bold text-white hover:bg-slate-800 disabled:opacity-50"
              >
                <Save className="h-3.5 w-3.5 text-indigo-300" />
                {isSaving ? '저장 중' : 'YouTube에 저장'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-900/30 p-4 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 15 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 15 }}
        className="glass-panel-elevated relative my-6 w-full max-w-xl rounded-3xl border border-white/95 p-6 shadow-2xl sm:p-7"
      >
        <button
          onClick={onClose}
          className="absolute right-5 top-5 rounded-xl p-1.5 text-slate-400 transition-colors hover:bg-slate-100/80 hover:text-slate-700"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="mb-4 flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-xs">
            <Sparkles className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-xl font-extrabold text-slate-900">영상 제목 · 설명 다듬기</h2>
            <p className="text-xs text-slate-500">이미 올라간 YouTube 영상의 문구를 고쳐 실제로 반영합니다.</p>
          </div>
        </div>

        {body}
      </motion.div>
    </div>
  );
};
