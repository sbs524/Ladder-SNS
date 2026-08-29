import React, { useState } from 'react';
import { motion } from 'motion/react';
import { ArrowLeft, ArrowRight, Building2, Check, Instagram, Sparkles, Twitter, User, Users, Youtube, AtSign } from 'lucide-react';
import { PlatformType, UserProfile, UserType } from '../types';

interface OnboardingHeroProps {
  initialProfile: UserProfile;
  onRequestAuth: (pending: { userType: UserType; selectedPlatforms: PlatformType[] }) => void;
  onSkipToDashboard?: () => void;
}

const platformOptions: Array<{ id: PlatformType; name: string; detail: string; icon: React.ReactNode; activeClass: string }> = [
  { id: 'youtube', name: '유튜브', detail: '동영상·쇼츠', icon: <Youtube className="w-4 h-4" />, activeClass: 'border-red-400 text-red-600' },
  { id: 'instagram', name: '인스타그램', detail: '피드·릴스', icon: <Instagram className="w-4 h-4" />, activeClass: 'border-pink-400 text-pink-600' },
  { id: 'threads', name: '쓰레드', detail: '스레드·답글', icon: <AtSign className="w-4 h-4" />, activeClass: 'border-slate-700 text-slate-900' },
  { id: 'x', name: 'X (트위터)', detail: '임프레션', icon: <Twitter className="w-4 h-4" />, activeClass: 'border-slate-700 text-slate-900' },
];

export const OnboardingHero: React.FC<OnboardingHeroProps> = ({ initialProfile, onRequestAuth, onSkipToDashboard }) => {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [selectedType, setSelectedType] = useState<UserType>(initialProfile.userType || 'individual');
  const [selectedPlatforms, setSelectedPlatforms] = useState<PlatformType[]>(
    initialProfile.selectedPlatforms.length ? initialProfile.selectedPlatforms : ['youtube', 'instagram', 'threads', 'x'],
  );

  const togglePlatform = (platform: PlatformType) => {
    setSelectedPlatforms((current) => {
      if (current.includes(platform)) return current.length === 1 ? current : current.filter((item) => item !== platform);
      return [...current, platform];
    });
  };

  const beginAuth = () => {
    onRequestAuth({ userType: selectedType, selectedPlatforms });
  };

  return (
    <div className="w-full flex items-center justify-center p-3 sm:p-4 my-auto">
      <motion.div initial={{ opacity: 0, scale: 0.96, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ duration: 0.3 }} className="w-full max-w-xl glass-panel-elevated rounded-3xl p-5 sm:p-7 relative border border-white/80 shadow-xl">
        <div className="absolute -top-16 -right-16 w-44 h-44 rounded-full bg-indigo-200/30 blur-2xl pointer-events-none" />
        <div className="absolute -bottom-16 -left-16 w-44 h-44 rounded-full bg-sky-200/30 blur-2xl pointer-events-none" />

        <div className="relative z-10 mb-6">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500 mb-2">
            <span className="flex items-center gap-1.5 text-indigo-600 font-bold"><span className="w-2 h-2 rounded-full bg-indigo-600 animate-pulse" />{step === 1 ? '1. 관리 주체 선택' : step === 2 ? '2. 플랫폼 선택' : '3. 계정 인증'}</span>
            <span className="text-[11px] text-slate-400">{step} / 3</span>
          </div>
          <div className="grid grid-cols-3 gap-1.5">{[1, 2, 3].map((item) => <div key={item} className={`h-1 rounded-full transition-all duration-300 ${item <= step ? 'bg-indigo-600' : 'bg-white/60'}`} />)}</div>
        </div>

        {step === 1 && (
          <div className="relative z-10 space-y-4">
            <div className="text-center"><h2 className="text-xl sm:text-2xl font-extrabold text-slate-900">어떤 목적으로 SNS를 관리하시나요?</h2><p className="text-xs text-slate-500 mt-1">목적에 맞춰 지표 분석 화면을 구성합니다.</p></div>
            <div className="grid grid-cols-3 gap-2.5">
              {[
                { id: 'individual' as const, title: '개인', detail: '1인 크리에이터', icon: <User className="w-4 h-4" /> },
                { id: 'team' as const, title: '팀', detail: '마케팅 에이전시', icon: <Users className="w-4 h-4" /> },
                { id: 'enterprise' as const, title: '기업', detail: '브랜드 & 커머스', icon: <Building2 className="w-4 h-4" /> },
              ].map((option) => (
                <button type="button" key={option.id} onClick={() => setSelectedType(option.id)} className={`rounded-2xl p-3.5 text-center transition-all glass-card-compact flex flex-col items-center justify-center min-h-[120px] ${selectedType === option.id ? 'bg-white/90 border-indigo-500 shadow-md ring-2 ring-indigo-500/20' : 'hover:bg-white/60'}`}>
                  <span className="w-9 h-9 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center mb-2">{option.icon}</span><span className="font-bold text-slate-900 text-sm">{option.title}</span><span className="text-[10px] text-slate-500 mt-0.5">{option.detail}</span>
                </button>
              ))}
            </div>
            <div className="flex justify-end"><button type="button" onClick={() => setStep(2)} className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-6 py-2.5 rounded-xl bg-slate-900 text-white font-semibold text-xs hover:bg-slate-800"><span>플랫폼 선택하기</span><ArrowRight className="w-3.5 h-3.5" /></button></div>
          </div>
        )}

        {step === 2 && (
          <div className="relative z-10 space-y-4">
            <div className="text-center"><h2 className="text-xl sm:text-2xl font-extrabold text-slate-900">운영 중인 플랫폼을 선택하세요</h2><p className="text-xs text-slate-500 mt-1">최소 하나를 선택해 주세요.</p></div>
            <div className="grid grid-cols-2 gap-2.5">
              {platformOptions.map((platform) => {
                const selected = selectedPlatforms.includes(platform.id);
                return <button type="button" key={platform.id} onClick={() => togglePlatform(platform.id)} className={`rounded-2xl p-3 transition-all glass-card-compact flex items-center justify-between ${selected ? `bg-white/90 shadow-xs ${platform.activeClass}` : 'opacity-60 hover:opacity-100'}`}><span className="flex items-center gap-2.5"><span className="w-8 h-8 rounded-xl bg-slate-900 text-white flex items-center justify-center">{platform.icon}</span><span className="text-left"><span className="block font-bold text-xs text-slate-900">{platform.name}</span><span className="block text-[10px] text-slate-500">{platform.detail}</span></span></span>{selected && <Check className="w-4 h-4 stroke-[3]" />}</button>;
              })}
            </div>
            <div className="flex items-center justify-between"><button type="button" onClick={() => setStep(1)} className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-900"><ArrowLeft className="w-3.5 h-3.5" />이전</button><button type="button" onClick={() => setStep(3)} disabled={!selectedPlatforms.length} className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-slate-900 text-white font-semibold text-xs hover:bg-slate-800 disabled:opacity-50">계정 등록<ArrowRight className="w-3.5 h-3.5" /></button></div>
          </div>
        )}

        {step === 3 && (
          <div className="relative z-10 space-y-4">
            <div className="text-center"><div className="w-11 h-11 rounded-2xl bg-indigo-600/10 text-indigo-600 flex items-center justify-center mx-auto mb-3"><Sparkles className="w-5 h-5" /></div><h2 className="text-xl sm:text-2xl font-extrabold text-slate-900">계정을 인증하고 시작하세요</h2><p className="text-xs text-slate-500 mt-1">비밀번호 없이 이메일 인증 코드 또는 Google 계정으로 로그인합니다.</p></div>
            <div className="rounded-xl bg-indigo-50/80 border border-indigo-100 px-3 py-2.5 text-xs text-indigo-800"><strong>{selectedType === 'individual' ? '개인' : selectedType === 'team' ? '팀' : '기업'}</strong> · {selectedPlatforms.length}개 플랫폼 선택 완료</div>
            <button type="button" onClick={beginAuth} className="w-full py-3 rounded-xl bg-slate-900 text-white font-bold text-sm hover:bg-slate-800">로그인</button>
            <button type="button" onClick={() => setStep(2)} className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800"><ArrowLeft className="w-3.5 h-3.5" />플랫폼 다시 선택</button>
            {onSkipToDashboard && <button type="button" onClick={onSkipToDashboard} className="block mx-auto text-[11px] text-slate-400 hover:text-slate-600">데모 대시보드 둘러보기</button>}
          </div>
        )}
      </motion.div>
    </div>
  );
};
