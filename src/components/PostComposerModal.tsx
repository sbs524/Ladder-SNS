import React, { useState } from 'react';
import { motion } from 'motion/react';
import { 
  X, 
  Sparkles, 
  Send, 
  Calendar, 
  Image as ImageIcon, 
  Hash, 
  Check, 
  Youtube, 
  Instagram, 
  AtSign, 
  Twitter, 
  Wand2,
  Clock
} from 'lucide-react';
import { PlatformType, ScheduledPost } from '../types';
import { PLATFORM_CONFIGS } from '../data/mockData';

interface PostComposerModalProps {
  isOpen: boolean;
  onClose: () => void;
  availablePlatforms: PlatformType[];
  onPublish: (post: ScheduledPost) => void;
}

export const PostComposerModal: React.FC<PostComposerModalProps> = ({
  isOpen,
  onClose,
  availablePlatforms,
  onPublish,
}) => {
  const [content, setContent] = useState('');
  const [selectedPlatforms, setSelectedPlatforms] = useState<PlatformType[]>(availablePlatforms);
  const [tags, setTags] = useState<string[]>(['#SNS관리', '#크리에이터', '#마케팅']);
  const [customTagInput, setCustomTagInput] = useState('');
  const [scheduledTime, setScheduledTime] = useState('');
  const [isScheduled, setIsScheduled] = useState(false);
  const [isGeneratingAI, setIsGeneratingAI] = useState(false);
  const [aiTopic, setAiTopic] = useState('');

  if (!isOpen) return null;

  const togglePlatform = (p: PlatformType) => {
    if (selectedPlatforms.includes(p)) {
      if (selectedPlatforms.length === 1) return;
      setSelectedPlatforms(selectedPlatforms.filter((item) => item !== p));
    } else {
      setSelectedPlatforms([...selectedPlatforms, p]);
    }
  };

  const handleAddTag = () => {
    if (!customTagInput.trim()) return;
    const formatted = customTagInput.startsWith('#') ? customTagInput.trim() : `#${customTagInput.trim()}`;
    if (!tags.includes(formatted)) {
      setTags([...tags, formatted]);
    }
    setCustomTagInput('');
  };

  const handleRemoveTag = (t: string) => {
    setTags(tags.filter((item) => item !== t));
  };

  const handleGenerateAICaption = () => {
    setIsGeneratingAI(true);
    setTimeout(() => {
      const suggestions = [
        `✨ 이번 주 핵심 소셜 트렌드 요약 💡\n유튜브, 인스타그램, 쓰레드, X 각 채널별 알고리즘 변화와 가장 높은 도달률을 기록한 포맷을 정리했습니다.\n\n댓글로 여러분의 최애 채널을 알려주세요! 👇`,
        `🚀 소셜 미디어 멀티 채널을 1명이서 효율적으로 운영하는 실전 노하우 공개!\n1. 주간 콘텐츠 캘린더 템플릿\n2. 플랫폼별 최적 발행 시간대\n3. 반응을 2배 높이는 후킹 멘트 작성법\n\n저장해두고 필요할 때마다 확인하세요 ✨`,
        `오늘 출시된 Ladder SNS 2.0 버전으로 4대 소셜 채널(YouTube, Instagram, Threads, X) 지표를 단 하나의 투명한 글래스 대시보드에서 실시간 모니터링하세요 🌐✨`,
      ];
      const random = suggestions[Math.floor(Math.random() * suggestions.length)];
      setContent(random);
      setIsGeneratingAI(false);
    }, 600);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim()) return;

    const newPost: ScheduledPost = {
      id: `post-${Date.now()}`,
      content: content.trim(),
      platforms: selectedPlatforms,
      scheduledDate: isScheduled && scheduledTime ? scheduledTime : '방금 전 (즉시 발행)',
      status: isScheduled ? 'scheduled' : 'published',
      tags,
    };

    onPublish(newPost);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/30 backdrop-blur-sm overflow-y-auto">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 15 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 15 }}
        className="w-full max-w-xl glass-panel-elevated rounded-3xl p-6 sm:p-7 relative border border-white/95 shadow-2xl my-6"
      >
        <button
          onClick={onClose}
          className="absolute top-5 right-5 p-1.5 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100/80 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-2 mb-4">
          <div className="w-9 h-9 rounded-xl bg-indigo-600 text-white flex items-center justify-center shadow-xs">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-xl font-extrabold text-slate-900">통합 콘텐츠 작성 & 동시 발행</h2>
            <p className="text-xs text-slate-500">선택한 모든 SNS 채널에 최적화된 포맷으로 동시 발행합니다.</p>
          </div>
        </div>

        {/* Target Platforms Toggle */}
        <div className="mb-4">
          <label className="block text-xs font-bold text-slate-700 mb-1.5">
            발행 대상 채널 ({selectedPlatforms.length}개 선택됨)
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {availablePlatforms.map((p) => {
              const cfg = PLATFORM_CONFIGS[p];
              const isSelected = selectedPlatforms.includes(p);
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => togglePlatform(p)}
                  className={`p-2.5 rounded-xl border text-xs font-bold flex items-center justify-between transition-all ${
                    isSelected
                      ? 'border-indigo-600 bg-white shadow-xs text-slate-900 ring-1 ring-indigo-500/20'
                      : 'border-slate-200/80 bg-white/50 text-slate-400 opacity-60'
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    {p === 'youtube' && <Youtube className="w-3.5 h-3.5 text-red-500" />}
                    {p === 'instagram' && <Instagram className="w-3.5 h-3.5 text-pink-500" />}
                    {p === 'threads' && <AtSign className="w-3.5 h-3.5 text-black" />}
                    {p === 'x' && <Twitter className="w-3.5 h-3.5 text-slate-900" />}
                    <span>{cfg.koreanName}</span>
                  </div>
                  {isSelected && <Check className="w-3.5 h-3.5 text-indigo-600" />}
                </button>
              );
            })}
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          
          {/* Post Content Textarea */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-bold text-slate-700">게시물 본문 내용</label>
              <button
                type="button"
                onClick={handleGenerateAICaption}
                disabled={isGeneratingAI}
                className="inline-flex items-center gap-1 text-[11px] font-bold text-indigo-600 hover:text-indigo-800 bg-indigo-50 px-2.5 py-1 rounded-lg border border-indigo-200/60 hover:bg-indigo-100/60 transition-colors"
              >
                <Wand2 className="w-3 h-3 text-indigo-600" />
                <span>{isGeneratingAI ? 'AI 캡션 추천 생성 중...' : 'AI 캡션 자동 완성'}</span>
              </button>
            </div>
            <textarea
              rows={4}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="공유할 소식이나 꿀팁, 영상 소개글을 입력하세요. 각 채널 규격에 맞춰 자동 포맷팅됩니다."
              required
              className="w-full glass-input p-3.5 rounded-2xl text-sm font-medium text-slate-900 leading-relaxed resize-none"
            />
            <div className="flex items-center justify-between text-[11px] text-slate-400 mt-1 px-1">
              <span>글자수: {content.length}자</span>
              <span className={content.length > 280 ? 'text-amber-600 font-semibold' : 'text-slate-400'}>
                {selectedPlatforms.includes('x') && content.length > 280 ? 'X 280자 제한 초과시 자동 타래 분할' : '모든 채널 규격 만족'}
              </span>
            </div>
          </div>

          {/* Hashtags Section */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5">해시태그 추천 및 관리</label>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg bg-indigo-50/80 text-indigo-700 border border-indigo-100 font-medium"
                >
                  <Hash className="w-3 h-3" />
                  {tag.replace('#', '')}
                  <button
                    type="button"
                    onClick={() => handleRemoveTag(tag)}
                    className="ml-1 text-indigo-400 hover:text-rose-500 text-xs"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={customTagInput}
                onChange={(e) => setCustomTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddTag();
                  }
                }}
                placeholder="태그 입력 후 추가 (예: SNS성장)"
                className="flex-1 glass-input px-3 py-1.5 rounded-xl text-xs"
              />
              <button
                type="button"
                onClick={handleAddTag}
                className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs transition-colors"
              >
                + 추가
              </button>
            </div>
          </div>

          {/* Schedule / Time Option */}
          <div className="p-3 rounded-2xl bg-white/70 border border-slate-200/80">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-indigo-600" />
                <span className="text-xs font-bold text-slate-800">예약 발행 설정</span>
              </div>
              <input
                type="checkbox"
                id="schedule-toggle"
                checked={isScheduled}
                onChange={(e) => setIsScheduled(e.target.checked)}
                className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
              />
            </div>
            {isScheduled && (
              <div className="mt-2 pt-2 border-t border-slate-100 flex items-center gap-2">
                <input
                  type="datetime-local"
                  value={scheduledTime}
                  onChange={(e) => setScheduledTime(e.target.value)}
                  className="glass-input px-3 py-1.5 rounded-xl text-xs text-slate-800 font-medium flex-1"
                />
                <span className="text-[11px] text-slate-500">최적 시간대 추천 (저녁 8:00)</span>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-2.5 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 transition-colors"
            >
              취소
            </button>
            <button
              type="submit"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-slate-900 text-white font-bold text-xs sm:text-sm hover:bg-slate-800 transition-all shadow-md active:scale-98"
            >
              <Send className="w-3.5 h-3.5 text-indigo-300" />
              <span>{isScheduled ? '지정 시간 예약하기' : '선택 채널 즉시 동시 발행'}</span>
            </button>
          </div>

        </form>
      </motion.div>
    </div>
  );
};
