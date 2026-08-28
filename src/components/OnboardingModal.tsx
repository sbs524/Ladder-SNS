import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import confetti from 'canvas-confetti';
import { 
  User, 
  Users, 
  Building2, 
  CheckCircle2, 
  ArrowRight, 
  ArrowLeft, 
  Sparkles, 
  Youtube, 
  Instagram, 
  AtSign, 
  Twitter, 
  Check, 
  ShieldCheck, 
  TrendingUp, 
  BarChart3,
  Lock,
  Mail,
  Zap,
  Globe
} from 'lucide-react';
import { UserType, PlatformType, UserProfile } from '../types';
import { PLATFORM_CONFIGS } from '../data/mockData';

interface OnboardingModalProps {
  isOpen: boolean;
  onComplete: (profile: UserProfile) => void;
  initialProfile: UserProfile;
  onClose?: () => void;
}

export const OnboardingModal: React.FC<OnboardingModalProps> = ({
  isOpen,
  onComplete,
  initialProfile,
  onClose,
}) => {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [selectedType, setSelectedType] = useState<UserType>(initialProfile.userType || 'individual');
  const [selectedPlatforms, setSelectedPlatforms] = useState<PlatformType[]>(
    initialProfile.selectedPlatforms.length > 0 
      ? initialProfile.selectedPlatforms 
      : ['youtube', 'instagram', 'threads', 'x']
  );
  const [handles, setHandles] = useState<Record<PlatformType, string>>({
    youtube: initialProfile.platformHandles.youtube || '@creativelab_kr',
    instagram: initialProfile.platformHandles.instagram || '@omni_creative_space',
    threads: initialProfile.platformHandles.threads || '@omni_threads_log',
    x: initialProfile.platformHandles.x || '@omni_x_updates',
  });

  // Step 3 Auth form states
  const [authMode, setAuthMode] = useState<'signup' | 'login'>('signup');
  const [name, setName] = useState(initialProfile.name || '크리에이터 민우');
  const [email, setEmail] = useState(initialProfile.email || 'creator@laddersns.io');
  const [password, setPassword] = useState('••••••••');
  const [termsAccepted, setTermsAccepted] = useState(true);

  if (!isOpen) return null;

  const togglePlatform = (p: PlatformType) => {
    if (selectedPlatforms.includes(p)) {
      if (selectedPlatforms.length === 1) return; // keep at least 1
      setSelectedPlatforms(selectedPlatforms.filter((item) => item !== p));
    } else {
      setSelectedPlatforms([...selectedPlatforms, p]);
    }
  };

  const handleFinish = (isDemoGuest: boolean = false) => {
    try {
      confetti({
        particleCount: 80,
        spread: 70,
        origin: { y: 0.6 },
        colors: ['#6366f1', '#ec4899', '#f43f5e', '#3b82f6', '#10b981'],
      });
    } catch {
      // ignore
    }

    const updatedProfile: UserProfile = {
      name: isDemoGuest ? '데모 관리자' : (name.trim() || '소셜 관리자'),
      email: isDemoGuest ? 'demo@laddersns.io' : email,
      userType: selectedType,
      selectedPlatforms,
      platformHandles: handles,
      isLoggedIn: true,
      avatarUrl: '',
    };

    onComplete(updatedProfile);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 overflow-y-auto bg-slate-900/30 backdrop-blur-md">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 15 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 15 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
        className="w-full max-w-2xl glass-panel-elevated rounded-3xl p-6 sm:p-8 relative overflow-hidden border border-white/90 shadow-[0_25px_60px_-15px_rgba(0,0,0,0.15)] my-8"
      >
        {/* Subtle decorative glass gradients */}
        <div className="absolute -top-24 -right-24 w-64 h-64 rounded-full bg-gradient-to-br from-indigo-200/40 via-purple-100/30 to-transparent blur-2xl pointer-events-none" />
        <div className="absolute -bottom-24 -left-24 w-64 h-64 rounded-full bg-gradient-to-tr from-sky-200/40 via-emerald-100/30 to-transparent blur-2xl pointer-events-none" />

        {/* Top Progress & Step indicator */}
        <div className="relative z-10 mb-8">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-indigo-600 animate-pulse"></span>
              <span className="text-xs font-bold uppercase tracking-wider text-indigo-700">
                SNS 통합 맞춤 설정 · {step}/3 단계
              </span>
            </div>
            {onClose && (
              <button
                onClick={onClose}
                className="text-xs text-slate-400 hover:text-slate-700 px-2 py-1 rounded-lg hover:bg-slate-100/80 transition-colors"
              >
                닫기
              </button>
            )}
          </div>

          {/* Stepper Bar */}
          <div className="grid grid-cols-3 gap-2">
            {[1, 2, 3].map((s) => (
              <div
                key={s}
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  s === step
                    ? 'bg-indigo-600 shadow-xs shadow-indigo-300'
                    : s < step
                    ? 'bg-indigo-400'
                    : 'bg-slate-200/80'
                }`}
              />
            ))}
          </div>
        </div>

        {/* Step Contents */}
        <div className="relative z-10">
          <AnimatePresence mode="wait">
            
            {/* ----------------- STEP 1: 개인, 팀, 기업 선택 ----------------- */}
            {step === 1 && (
              <motion.div
                key="step1"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.25 }}
                className="space-y-6"
              >
                <div className="text-center sm:text-left">
                  <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
                    어떤 목적으로 SNS를 관리하시나요?
                  </h2>
                  <p className="text-sm text-slate-600 mt-2">
                    운영 주체에 맞춰 최적화된 지표 분석 대시보드와 맞춤형 인사이트를 구성해 드립니다.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5 pt-2">
                  
                  {/* Option 1: 개인 */}
                  <div
                    id="select-type-individual"
                    onClick={() => setSelectedType('individual')}
                    className={`cursor-pointer rounded-2xl p-5 transition-all relative glass-card ${
                      selectedType === 'individual'
                        ? 'border-indigo-600 bg-white shadow-md ring-2 ring-indigo-500/20'
                        : 'hover:border-slate-300'
                    }`}
                  >
                    <div className="w-12 h-12 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center mb-3">
                      <User className="w-6 h-6" />
                    </div>
                    <div className="flex items-center justify-between">
                      <h3 className="font-bold text-slate-900 text-base">개인</h3>
                      {selectedType === 'individual' && (
                        <CheckCircle2 className="w-5 h-5 text-indigo-600" />
                      )}
                    </div>
                    <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
                      1인 크리에이터, 인플루언서, 프리랜서 맞춤 개인 브랜딩
                    </p>
                    <div className="mt-3 pt-3 border-t border-slate-100 flex items-center gap-1.5 text-[11px] font-medium text-indigo-600">
                      <TrendingUp className="w-3.5 h-3.5" />
                      <span>팔로워 성장 & 참여율 중심</span>
                    </div>
                  </div>

                  {/* Option 2: 팀 */}
                  <div
                    id="select-type-team"
                    onClick={() => setSelectedType('team')}
                    className={`cursor-pointer rounded-2xl p-5 transition-all relative glass-card ${
                      selectedType === 'team'
                        ? 'border-indigo-600 bg-white shadow-md ring-2 ring-indigo-500/20'
                        : 'hover:border-slate-300'
                    }`}
                  >
                    <div className="w-12 h-12 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center mb-3">
                      <Users className="w-6 h-6" />
                    </div>
                    <div className="flex items-center justify-between">
                      <h3 className="font-bold text-slate-900 text-base">팀</h3>
                      {selectedType === 'team' && (
                        <CheckCircle2 className="w-5 h-5 text-indigo-600" />
                      )}
                    </div>
                    <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
                      스타트업, 마케팅 부서, 콘텐츠 에이전시 협업
                    </p>
                    <div className="mt-3 pt-3 border-t border-slate-100 flex items-center gap-1.5 text-[11px] font-medium text-purple-600">
                      <BarChart3 className="w-3.5 h-3.5" />
                      <span>채널별 협업 & 예약 발행</span>
                    </div>
                  </div>

                  {/* Option 3: 기업 */}
                  <div
                    id="select-type-enterprise"
                    onClick={() => setSelectedType('enterprise')}
                    className={`cursor-pointer rounded-2xl p-5 transition-all relative glass-card ${
                      selectedType === 'enterprise'
                        ? 'border-indigo-600 bg-white shadow-md ring-2 ring-indigo-500/20'
                        : 'hover:border-slate-300'
                    }`}
                  >
                    <div className="w-12 h-12 rounded-xl bg-sky-50 text-sky-600 flex items-center justify-center mb-3">
                      <Building2 className="w-6 h-6" />
                    </div>
                    <div className="flex items-center justify-between">
                      <h3 className="font-bold text-slate-900 text-base">기업</h3>
                      {selectedType === 'enterprise' && (
                        <CheckCircle2 className="w-5 h-5 text-indigo-600" />
                      )}
                    </div>
                    <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
                      멀티 브랜드, 대규모 커머스, 전사 통합 모니터링
                    </p>
                    <div className="mt-3 pt-3 border-t border-slate-100 flex items-center gap-1.5 text-[11px] font-medium text-sky-600">
                      <ShieldCheck className="w-3.5 h-3.5" />
                      <span>ROI 분석 & 실시간 리포트</span>
                    </div>
                  </div>

                </div>

                <div className="flex items-center justify-end pt-4">
                  <button
                    id="onboarding-next-step1"
                    onClick={() => setStep(2)}
                    className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-slate-900 text-white font-semibold text-sm hover:bg-slate-800 transition-all shadow-md group"
                  >
                    <span>플랫폼 선택하기</span>
                    <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
                  </button>
                </div>
              </motion.div>
            )}

            {/* ----------------- STEP 2: 어떤 플랫폼 이용중인지 선택 (유튜브, 인스타, 쓰레드, X) ----------------- */}
            {step === 2 && (
              <motion.div
                key="step2"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.25 }}
                className="space-y-6"
              >
                <div className="text-center sm:text-left">
                  <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
                    현재 운영 중인 플랫폼을 선택해주세요
                  </h2>
                  <p className="text-sm text-slate-600 mt-2">
                    선택하신 플랫폼(유튜브, 인스타, 쓰레드, X)의 실시간 지표와 반응을 한곳에 연동합니다. (다중 선택 가능)
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 pt-1">
                  
                  {/* YouTube */}
                  <div
                    id="platform-select-youtube"
                    onClick={() => togglePlatform('youtube')}
                    className={`cursor-pointer rounded-2xl p-4 transition-all relative glass-card ${
                      selectedPlatforms.includes('youtube')
                        ? 'border-red-500 bg-white/90 shadow-md ring-2 ring-red-500/10'
                        : 'opacity-70 hover:opacity-100 hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-red-600 text-white flex items-center justify-center shadow-xs">
                          <Youtube className="w-5 h-5" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="font-bold text-slate-900 text-sm">유튜브 (YouTube)</h3>
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-50 text-red-600 font-semibold">동영상·쇼츠</span>
                          </div>
                          <p className="text-xs text-slate-500 mt-0.5">구독자, 누적 조회수, 시청 지속시간</p>
                        </div>
                      </div>
                      <div className={`w-5 h-5 rounded-md flex items-center justify-center transition-colors ${
                        selectedPlatforms.includes('youtube') ? 'bg-red-600 text-white' : 'border border-slate-300 bg-white'
                      }`}>
                        {selectedPlatforms.includes('youtube') && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                      </div>
                    </div>
                  </div>

                  {/* Instagram */}
                  <div
                    id="platform-select-instagram"
                    onClick={() => togglePlatform('instagram')}
                    className={`cursor-pointer rounded-2xl p-4 transition-all relative glass-card ${
                      selectedPlatforms.includes('instagram')
                        ? 'border-pink-500 bg-white/90 shadow-md ring-2 ring-pink-500/10'
                        : 'opacity-70 hover:opacity-100 hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-amber-500 via-rose-500 to-purple-600 text-white flex items-center justify-center shadow-xs">
                          <Instagram className="w-5 h-5" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="font-bold text-slate-900 text-sm">인스타그램 (Instagram)</h3>
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-pink-50 text-pink-600 font-semibold">피드·릴스</span>
                          </div>
                          <p className="text-xs text-slate-500 mt-0.5">팔로워, 도달수, 스토리, 저장수</p>
                        </div>
                      </div>
                      <div className={`w-5 h-5 rounded-md flex items-center justify-center transition-colors ${
                        selectedPlatforms.includes('instagram') ? 'bg-pink-600 text-white' : 'border border-slate-300 bg-white'
                      }`}>
                        {selectedPlatforms.includes('instagram') && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                      </div>
                    </div>
                  </div>

                  {/* Threads */}
                  <div
                    id="platform-select-threads"
                    onClick={() => togglePlatform('threads')}
                    className={`cursor-pointer rounded-2xl p-4 transition-all relative glass-card ${
                      selectedPlatforms.includes('threads')
                        ? 'border-slate-900 bg-white/90 shadow-md ring-2 ring-slate-900/10'
                        : 'opacity-70 hover:opacity-100 hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-black text-white flex items-center justify-center shadow-xs">
                          <AtSign className="w-5 h-5" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="font-bold text-slate-900 text-sm">쓰레드 (Threads)</h3>
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-800 font-semibold">텍스트·대화</span>
                          </div>
                          <p className="text-xs text-slate-500 mt-0.5">답글수, 리포스트, 바이럴 스레드</p>
                        </div>
                      </div>
                      <div className={`w-5 h-5 rounded-md flex items-center justify-center transition-colors ${
                        selectedPlatforms.includes('threads') ? 'bg-slate-900 text-white' : 'border border-slate-300 bg-white'
                      }`}>
                        {selectedPlatforms.includes('threads') && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                      </div>
                    </div>
                  </div>

                  {/* X (Twitter) */}
                  <div
                    id="platform-select-x"
                    onClick={() => togglePlatform('x')}
                    className={`cursor-pointer rounded-2xl p-4 transition-all relative glass-card ${
                      selectedPlatforms.includes('x')
                        ? 'border-slate-900 bg-white/90 shadow-md ring-2 ring-slate-900/10'
                        : 'opacity-70 hover:opacity-100 hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-slate-900 text-white flex items-center justify-center shadow-xs">
                          <Twitter className="w-5 h-5" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="font-bold text-slate-900 text-sm">X (트위터)</h3>
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-50 text-sky-700 font-semibold">임프레션</span>
                          </div>
                          <p className="text-xs text-slate-500 mt-0.5">노출수, 리트윗, 북마크, 링크 클릭</p>
                        </div>
                      </div>
                      <div className={`w-5 h-5 rounded-md flex items-center justify-center transition-colors ${
                        selectedPlatforms.includes('x') ? 'bg-slate-900 text-white' : 'border border-slate-300 bg-white'
                      }`}>
                        {selectedPlatforms.includes('x') && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                      </div>
                    </div>
                  </div>

                </div>

                {/* Selected count info */}
                <div className="p-3.5 rounded-xl bg-indigo-50/80 border border-indigo-100/80 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs text-indigo-900 font-medium">
                    <Sparkles className="w-4 h-4 text-indigo-600" />
                    <span>선택한 {selectedPlatforms.length}개 플랫폼의 지표가 대시보드에 즉시 동기화됩니다.</span>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-4">
                  <button
                    onClick={() => setStep(1)}
                    className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-slate-600 hover:text-slate-900 font-medium text-sm transition-colors"
                  >
                    <ArrowLeft className="w-4 h-4" />
                    <span>이전</span>
                  </button>

                  <button
                    id="onboarding-next-step2"
                    onClick={() => setStep(3)}
                    disabled={selectedPlatforms.length === 0}
                    className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-slate-900 text-white font-semibold text-sm hover:bg-slate-800 transition-all shadow-md group disabled:opacity-50"
                  >
                    <span>계정 등록 / 로그인</span>
                    <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
                  </button>
                </div>
              </motion.div>
            )}

            {/* ----------------- STEP 3: 회원가입 또는 로그인 ----------------- */}
            {step === 3 && (
              <motion.div
                key="step3"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.25 }}
                className="space-y-6"
              >
                <div className="text-center sm:text-left">
                  <div className="flex items-center justify-between">
                    <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
                      {authMode === 'signup' ? '회원가입으로 대시보드 열기' : '로그인하여 대시보드 시작'}
                    </h2>
                  </div>
                  <p className="text-sm text-slate-600 mt-2">
                    설정한 소셜 플랫폼 데이터를 안전하게 저장하고 실시간 모니터링을 시작합니다.
                  </p>
                </div>

                {/* Switch between Signup & Login */}
                <div className="flex rounded-xl bg-slate-100/90 p-1 border border-slate-200/80">
                  <button
                    id="tab-signup-btn"
                    onClick={() => setAuthMode('signup')}
                    className={`flex-1 py-2 rounded-lg text-xs sm:text-sm font-bold transition-all ${
                      authMode === 'signup'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    신규 회원가입
                  </button>
                  <button
                    id="tab-login-btn"
                    onClick={() => setAuthMode('login')}
                    className={`flex-1 py-2 rounded-lg text-xs sm:text-sm font-bold transition-all ${
                      authMode === 'login'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    기존 계정 로그인
                  </button>
                </div>

                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleFinish(false);
                  }}
                  className="space-y-3.5"
                >
                  {authMode === 'signup' && (
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        이름 또는 크리에이터 닉네임
                      </label>
                      <div className="relative">
                        <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                        <input
                          id="input-user-name"
                          type="text"
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          placeholder="예: 크리에이터 민우"
                          required
                          className="w-full glass-input pl-10 pr-4 py-2.5 rounded-xl text-sm font-medium text-slate-900"
                        />
                      </div>
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      이메일 주소
                    </label>
                    <div className="relative">
                      <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                      <input
                        id="input-user-email"
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="creator@laddersns.io"
                        required
                        className="w-full glass-input pl-10 pr-4 py-2.5 rounded-xl text-sm font-medium text-slate-900"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      비밀번호
                    </label>
                    <div className="relative">
                      <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                      <input
                        id="input-user-password"
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="••••••••"
                        required
                        className="w-full glass-input pl-10 pr-4 py-2.5 rounded-xl text-sm font-medium text-slate-900"
                      />
                    </div>
                  </div>

                  {authMode === 'signup' && (
                    <div className="flex items-center gap-2 pt-1">
                      <input
                        id="terms-checkbox"
                        type="checkbox"
                        checked={termsAccepted}
                        onChange={(e) => setTermsAccepted(e.target.checked)}
                        className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                      />
                      <label htmlFor="terms-checkbox" className="text-xs text-slate-600 cursor-pointer">
                        통합 SNS 지표 분석 서비스 이용약관 및 개인정보 처리방침에 동의합니다.
                      </label>
                    </div>
                  )}

                  {/* Summary of Configuration */}
                  <div className="rounded-xl bg-white/70 p-3 border border-slate-200/80 flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2 text-slate-600">
                      <span className="font-semibold text-slate-800">
                        {selectedType === 'individual' ? '👤 개인' : selectedType === 'team' ? '👥 팀' : '🏢 기업'}
                      </span>
                      <span>·</span>
                      <span>{selectedPlatforms.map(p => PLATFORM_CONFIGS[p]?.koreanName).join(', ')} 연동</span>
                    </div>
                    <span className="text-[11px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
                      준비 완료
                    </span>
                  </div>

                  <div className="flex flex-col sm:flex-row items-center gap-2.5 pt-2">
                    <button
                      id="submit-auth-dashboard-btn"
                      type="submit"
                      className="w-full py-3.5 rounded-xl bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white font-bold text-sm hover:opacity-95 transition-all shadow-md flex items-center justify-center gap-2 group"
                    >
                      <Sparkles className="w-4 h-4 text-indigo-300" />
                      <span>
                        {authMode === 'signup' ? '회원가입 완료 & 대시보드 지표 확인' : '로그인 & 대시보드 열기'}
                      </span>
                      <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
                    </button>

                    {/* Quick Demo Instant Start */}
                    <button
                      id="quick-demo-start-btn"
                      type="button"
                      onClick={() => handleFinish(true)}
                      className="w-full sm:w-auto text-nowrap px-4 py-3.5 rounded-xl bg-white/80 hover:bg-white text-slate-700 font-semibold text-xs border border-slate-200 transition-all shadow-2xs flex items-center justify-center gap-1.5"
                      title="가입 없이 1초만에 데모 데이터로 즉시 대시보드 체험"
                    >
                      <Zap className="w-3.5 h-3.5 text-amber-500 fill-amber-400" />
                      <span>1초 데모로 바로보기</span>
                    </button>
                  </div>
                </form>

                <div className="flex items-center justify-start pt-1">
                  <button
                    onClick={() => setStep(2)}
                    className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-800 font-medium transition-colors"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    <span>플랫폼 선택으로 돌아가기</span>
                  </button>
                </div>
              </motion.div>
            )}

          </AnimatePresence>
        </div>

      </motion.div>
    </div>
  );
};
