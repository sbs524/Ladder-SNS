import React, { useState } from 'react';
import { motion } from 'motion/react';
import { AlertCircle, AtSign, Check, Instagram, LoaderCircle, Twitter, X, Youtube } from 'lucide-react';
import { updateCurrentProfile, type AuthProfile } from '../lib/authApi';
import { PlatformType } from '../types';

/**
 * 대시보드에 표시할 플랫폼을 다시 고른다.
 *
 * 온보딩을 다시 열어서 바꾸게 하면 로그인한 사용자에게 로그인 화면을 또 보여주게 된다. 설정은
 * 설정이 있어야 할 곳에 둔다.
 *
 * 여기서 고르는 건 "대시보드에 보일 카드"지 "계정 연동"이 아니다 — 연동은 연동 정보 섹션에서
 * 플랫폼별 OAuth로 따로 한다. 둘을 같은 화면에 섞으면 체크만 해두고 연동된 줄 안다.
 */

const OPTIONS: Array<{ id: PlatformType; name: string; detail: string; icon: React.ComponentType<{ className?: string }>; activeClass: string }> = [
  { id: 'youtube', name: '유튜브', detail: '동영상·쇼츠', icon: Youtube, activeClass: 'border-red-400 text-red-600' },
  { id: 'instagram', name: '인스타그램', detail: '피드·릴스', icon: Instagram, activeClass: 'border-pink-400 text-pink-600' },
  { id: 'threads', name: '쓰레드', detail: '스레드·답글', icon: AtSign, activeClass: 'border-slate-700 text-slate-900' },
  { id: 'x', name: 'X (트위터)', detail: '임프레션', icon: Twitter, activeClass: 'border-slate-700 text-slate-900' },
];

interface PlatformSettingsModalProps {
  selectedPlatforms: PlatformType[];
  onClose: () => void;
  onSaved: (profile: AuthProfile) => void;
}

export const PlatformSettingsModal: React.FC<PlatformSettingsModalProps> = ({ selectedPlatforms, onClose, onSaved }) => {
  const [selected, setSelected] = useState<PlatformType[]>(selectedPlatforms.length ? selectedPlatforms : ['youtube']);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (platform: PlatformType) => {
    setSelected((current) => {
      // 하나는 남겨야 한다. 전부 끄면 빈 대시보드가 되고, 서버 제약도 최소 1개를 요구한다.
      if (current.includes(platform)) return current.length === 1 ? current : current.filter((item) => item !== platform);
      return [...current, platform];
    });
  };

  const save = async () => {
    setIsSaving(true);
    setError(null);
    try {
      const result = await updateCurrentProfile({ selected_platforms: selected });
      onSaved(result.profile);
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '플랫폼 설정을 저장하지 못했습니다.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 backdrop-blur-sm p-4" role="dialog" aria-modal="true" aria-labelledby="platform-settings-title">
      <motion.div initial={{ opacity: 0, scale: 0.96, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ duration: 0.2 }} className="w-full max-w-md glass-panel-elevated rounded-3xl p-5 border border-white/80 shadow-xl">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h2 id="platform-settings-title" className="text-base font-extrabold text-slate-900">표시할 플랫폼</h2>
            <p className="mt-0.5 text-[11px] leading-4 text-slate-500">대시보드에 어떤 플랫폼 카드를 띄울지 고릅니다. 계정 연동은 아래 연동 정보에서 따로 합니다.</p>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="닫기"><X className="w-4 h-4" /></button>
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          {OPTIONS.map((option) => {
            const isSelected = selected.includes(option.id);
            const Icon = option.icon;
            return (
              <button
                type="button"
                key={option.id}
                onClick={() => toggle(option.id)}
                aria-pressed={isSelected}
                className={`rounded-2xl p-3 transition-all glass-card-compact flex items-center justify-between ${isSelected ? `bg-white/90 shadow-xs ${option.activeClass}` : 'opacity-60 hover:opacity-100'}`}
              >
                <span className="flex items-center gap-2.5">
                  <span className="w-8 h-8 rounded-xl bg-slate-900 text-white flex items-center justify-center"><Icon className="w-4 h-4" /></span>
                  <span className="text-left">
                    <span className="block font-bold text-xs text-slate-900">{option.name}</span>
                    <span className="block text-[10px] text-slate-500">{option.detail}</span>
                  </span>
                </span>
                {isSelected && <Check className="w-4 h-4 stroke-[3]" />}
              </button>
            );
          })}
        </div>

        {error && <div role="alert" className="mt-3 rounded-xl border border-rose-100 bg-rose-50/70 px-3 py-2.5 text-[11px] text-rose-700 flex gap-2"><AlertCircle className="w-4 h-4 shrink-0" />{error}</div>}

        <div className="mt-4 flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="px-3 py-2 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100">취소</button>
          <button type="button" onClick={() => void save()} disabled={isSaving} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-extrabold hover:bg-slate-800 disabled:opacity-50">
            {isSaving && <LoaderCircle className="w-3.5 h-3.5 animate-spin" />}저장
          </button>
        </div>
      </motion.div>
    </div>
  );
};
