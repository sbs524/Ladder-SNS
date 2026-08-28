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
  Lock,
  Mail,
  Zap,
  TrendingUp,
  BarChart3,
  ShieldCheck
} from 'lucide-react';
import { UserType, PlatformType, UserProfile } from '../types';
import { PLATFORM_CONFIGS } from '../data/mockData';
import { validatePassword, PASSWORD_RULE_TEXT } from '../passwordPolicy';

interface OnboardingHeroProps {
  initialProfile: UserProfile;
  onComplete: (profile: UserProfile) => void;
  onSkipToDashboard?: () => void;
}

export const OnboardingHero: React.FC<OnboardingHeroProps> = ({
  initialProfile,
  onComplete,
  onSkipToDashboard,
}) => {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [selectedType, setSelectedType] = useState<UserType>(initialProfile.userType || 'individual');
  const [selectedPlatforms, setSelectedPlatforms] = useState<PlatformType[]>(
    initialProfile.selectedPlatforms.length > 0 
      ? initialProfile.selectedPlatforms 
      : ['youtube', 'instagram', 'threads', 'x']
  );

  // Step 3 state
  const [authMode, setAuthMode] = useState<'signup' | 'login'>('signup');
  const [name, setName] = useState(initialProfile.name || '크리에이터 민우');
  const [email, setEmail] = useState(initialProfile.email || 'creator@laddersns.io');
  const [password, setPassword] = useState('');

  // 회원가입에만 비밀번호 규칙 적용. '1초 데모'는 폼 제출이 아니라 그대로 통과한다.
  const passwordError = authMode === 'signup' ? validatePassword(password) : null;
  // 빈 칸일 때는 규칙 안내만, 뭔가 입력하면 어디가 틀렸는지 바로 알려준다
  const showPasswordError = password.length > 0 ? passwordError : null;

  const togglePlatform = (p: PlatformType) => {
    if (selectedPlatforms.includes(p)) {
      if (selectedPlatforms.length === 1) return;
      setSelectedPlatforms(selectedPlatforms.filter((item) => item !== p));
    } else {
      setSelectedPlatforms([...selectedPlatforms, p]);
    }
  };

  const handleFinish = (isDemo: boolean = false) => {
    try {
      confetti({
        particleCount: 70,
        spread: 60,
        origin: { y: 0.6 },
        colors: ['#6366f1', '#ec4899', '#3b82f6', '#10b981'],
      });
    } catch {
      // ignore
    }

    const updatedProfile: UserProfile = {
      name: isDemo ? '데모 관리자' : (name.trim() || '소셜 관리자'),
      email: isDemo ? 'demo@laddersns.io' : email,
      userType: selectedType,
      selectedPlatforms,
      platformHandles: initialProfile.platformHandles,
      isLoggedIn: true,
    };

    onComplete(updatedProfile);
  };

  return (
    <div className="w-full flex items-center justify-center p-3 sm:p-4 my-auto">
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="w-full max-w-xl glass-panel-elevated rounded-3xl p-5 sm:p-7 relative border border-white/80 shadow-xl"
      >
        {/* Subtle decorative glow */}
        <div className="absolute -top-16 -right-16 w-44 h-44 rounded-full bg-indigo-200/30 blur-2xl pointer-events-none" />
        <div className="absolute -bottom-16 -left-16 w-44 h-44 rounded-full bg-sky-200/30 blur-2xl pointer-events-none" />

        {/* Minimal Progress Bar */}
        <div className="relative z-10 mb-6">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500 mb-2">
            <span className="flex items-center gap-1.5 text-indigo-600 font-bold">
              <span className="w-2 h-2 rounded-full bg-indigo-600 animate-pulse"></span>
              {step === 1 ? '1. 관리 주체 선택' : step === 2 ? '2. 플랫폼 선택' : '3. 계정 등록'}
            </span>
            <span className="text-[11px] text-slate-400">{step} / 3</span>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {[1, 2, 3].map((s) => (
              <div
                key={s}
                className={`h-1 rounded-full transition-all duration-300 ${
                  s === step
                    ? 'bg-indigo-600'
                    : s < step
                    ? 'bg-indigo-400'
                    : 'bg-white/60'
                }`}
              />
            ))}
          </div>
        </div>

        {/* Step Flow */}
        <div className="relative z-10">
          <AnimatePresence mode="wait">
            
            {/* ---------------- STEP 1: 개인, 팀, 기업 선택 ---------------- */}
            {step === 1 && (
              <motion.div
                key="step1"
                initial={{ opacity: 0, x: 15 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -15 }}
                className="space-y-4"
              >
                <div className="text-center">
                  <h2 className="text-xl sm:text-2xl font-extrabold text-slate-900 tracking-tight">
                    어떤 목적으로 SNS를 관리하시나요?
                  </h2>
                  <p className="text-xs text-slate-500 mt-1">
                    운영 목적에 맞춰 최적화된 지표 분석 화면을 구성합니다.
                  </p>
                </div>

                <div className="grid grid-cols-3 gap-2.5 pt-1">
                  
                  {/* 개인 */}
                  <div
                    id="hero-select-individual"
                    onClick={() => setSelectedType('individual')}
                    className={`cursor-pointer rounded-2xl p-3.5 text-center transition-all glass-card-compact flex flex-col items-center justify-center min-h-[120px] ${
                      selectedType === 'individual'
                        ? 'bg-white/90 border-indigo-500 shadow-md ring-2 ring-indigo-500/20'
                        : 'hover:bg-white/60'
                    }`}
                  >
                    <div className="w-9 h-9 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center mb-2">
                      <User className="w-4 h-4" />
                    </div>
                    <h3 className="font-bold text-slate-900 text-sm">개인</h3>
                    <p className="text-[10px] text-slate-500 mt-0.5">1인 크리에이터</p>
                  </div>

                  {/* 팀 */}
                  <div
                    id="hero-select-team"
                    onClick={() => setSelectedType('team')}
                    className={`cursor-pointer rounded-2xl p-3.5 text-center transition-all glass-card-compact flex flex-col items-center justify-center min-h-[120px] ${
                      selectedType === 'team'
                        ? 'bg-white/90 border-indigo-500 shadow-md ring-2 ring-indigo-500/20'
                        : 'hover:bg-white/60'
                    }`}
                  >
                    <div className="w-9 h-9 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center mb-2">
                      <Users className="w-4 h-4" />
                    </div>
                    <h3 className="font-bold text-slate-900 text-sm">팀</h3>
                    <p className="text-[10px] text-slate-500 mt-0.5">마케팅 에이전시</p>
                  </div>

                  {/* 기업 */}
                  <div
                    id="hero-select-enterprise"
                    onClick={() => setSelectedType('enterprise')}
                    className={`cursor-pointer rounded-2xl p-3.5 text-center transition-all glass-card-compact flex flex-col items-center justify-center min-h-[120px] ${
                      selectedType === 'enterprise'
                        ? 'bg-white/90 border-indigo-500 shadow-md ring-2 ring-indigo-500/20'
                        : 'hover:bg-white/60'
                    }`}
                  >
                    <div className="w-9 h-9 rounded-xl bg-sky-50 text-sky-600 flex items-center justify-center mb-2">
                      <Building2 className="w-4 h-4" />
                    </div>
                    <h3 className="font-bold text-slate-900 text-sm">기업</h3>
                    <p className="text-[10px] text-slate-500 mt-0.5">브랜드 & 커머스</p>
                  </div>

                </div>

                <div className="flex items-center justify-end pt-2">
                  <button
                    id="hero-next-step1"
                    onClick={() => setStep(2)}
                    className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-6 py-2.5 rounded-xl bg-slate-900 text-white font-semibold text-xs hover:bg-slate-800 transition-all shadow-xs"
                  >
                    <span>플랫폼 선택하기</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </motion.div>
            )}

            {/* ---------------- STEP 2: 플랫폼 이용중인지 선택 (유튜브, 인스타, 쓰레드, X) ---------------- */}
            {step === 2 && (
              <motion.div
                key="step2"
                initial={{ opacity: 0, x: 15 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -15 }}
                className="space-y-4"
              >
                <div className="text-center">
                  <h2 className="text-xl sm:text-2xl font-extrabold text-slate-900 tracking-tight">
                    운영 중인 플랫폼을 선택하세요
                  </h2>
                  <p className="text-xs text-slate-500 mt-1">
                    선택한 플랫폼의 지표를 대시보드에 모아 실시간으로 비교 분석합니다.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-2.5 pt-1">
                  
                  {/* YouTube */}
                  <div
                    id="hero-platform-youtube"
                    onClick={() => togglePlatform('youtube')}
                    className={`cursor-pointer rounded-2xl p-3 transition-all glass-card-compact flex items-center justify-between ${
                      selectedPlatforms.includes('youtube')
                        ? 'bg-white/90 border-red-400 shadow-xs'
                        : 'opacity-60 hover:opacity-100'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-xl bg-red-600 text-white flex items-center justify-center">
                        <Youtube className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="font-bold text-xs text-slate-900">유튜브</div>
                        <div className="text-[10px] text-slate-500">동영상·쇼츠</div>
                      </div>
                    </div>
                    {selectedPlatforms.includes('youtube') && (
                      <Check className="w-4 h-4 text-red-600 stroke-[3]" />
                    )}
                  </div>

                  {/* Instagram */}
                  <div
                    id="hero-platform-instagram"
                    onClick={() => togglePlatform('instagram')}
                    className={`cursor-pointer rounded-2xl p-3 transition-all glass-card-compact flex items-center justify-between ${
                      selectedPlatforms.includes('instagram')
                        ? 'bg-white/90 border-pink-400 shadow-xs'
                        : 'opacity-60 hover:opacity-100'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-amber-500 via-rose-500 to-purple-600 text-white flex items-center justify-center">
                        <Instagram className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="font-bold text-xs text-slate-900">인스타그램</div>
                        <div className="text-[10px] text-slate-500">피드·릴스</div>
                      </div>
                    </div>
                    {selectedPlatforms.includes('instagram') && (
                      <Check className="w-4 h-4 text-pink-600 stroke-[3]" />
                    )}
                  </div>

                  {/* Threads */}
                  <div
                    id="hero-platform-threads"
                    onClick={() => togglePlatform('threads')}
                    className={`cursor-pointer rounded-2xl p-3 transition-all glass-card-compact flex items-center justify-between ${
                      selectedPlatforms.includes('threads')
                        ? 'bg-white/90 border-slate-900 shadow-xs'
                        : 'opacity-60 hover:opacity-100'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-xl bg-black text-white flex items-center justify-center">
                        <AtSign className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="font-bold text-xs text-slate-900">쓰레드</div>
                        <div className="text-[10px] text-slate-500">스레드·답글</div>
                      </div>
                    </div>
                    {selectedPlatforms.includes('threads') && (
                      <Check className="w-4 h-4 text-slate-900 stroke-[3]" />
                    )}
                  </div>

                  {/* X (Twitter) */}
                  <div
                    id="hero-platform-x"
                    onClick={() => togglePlatform('x')}
                    className={`cursor-pointer rounded-2xl p-3 transition-all glass-card-compact flex items-center justify-between ${
                      selectedPlatforms.includes('x')
                        ? 'bg-white/90 border-slate-900 shadow-xs'
                        : 'opacity-60 hover:opacity-100'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-xl bg-slate-900 text-white flex items-center justify-center">
                        <Twitter className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="font-bold text-xs text-slate-900">X (트위터)</div>
                        <div className="text-[10px] text-slate-500">임프레션</div>
                      </div>
                    </div>
                    {selectedPlatforms.includes('x') && (
                      <Check className="w-4 h-4 text-slate-900 stroke-[3]" />
                    )}
                  </div>

                </div>

                <div className="flex items-center justify-between pt-2">
                  <button
                    onClick={() => setStep(1)}
                    className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-900 font-medium px-2 py-1"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    <span>이전</span>
                  </button>

                  <button
                    id="hero-next-step2"
                    onClick={() => setStep(3)}
                    disabled={selectedPlatforms.length === 0}
                    className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-slate-900 text-white font-semibold text-xs hover:bg-slate-800 transition-all shadow-xs disabled:opacity-50"
                  >
                    <span>계정 등록</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </motion.div>
            )}

            {/* ---------------- STEP 3: 회원가입 또는 로그인 ---------------- */}
            {step === 3 && (
              <motion.div
                key="step3"
                initial={{ opacity: 0, x: 15 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -15 }}
                className="space-y-3.5"
              >
                <div className="text-center">
                  <h2 className="text-xl sm:text-2xl font-extrabold text-slate-900 tracking-tight">
                    {authMode === 'signup' ? '간편 회원가입' : '계정 로그인'}
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    설정한 소셜 채널의 통합 지표 대시보드로 이동합니다.
                  </p>
                </div>

                {/* Switcher */}
                <div className="flex rounded-xl bg-white/40 p-1 border border-white/60">
                  <button
                    onClick={() => setAuthMode('signup')}
                    className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all ${
                      authMode === 'signup' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-500'
                    }`}
                  >
                    회원가입
                  </button>
                  <button
                    onClick={() => setAuthMode('login')}
                    className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all ${
                      authMode === 'login' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-500'
                    }`}
                  >
                    로그인
                  </button>
                </div>

                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (passwordError) return;
                    handleFinish(false);
                  }}
                  className="space-y-2.5"
                >
                  {authMode === 'signup' && (
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 mb-1">이름</label>
                      <input
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="예: 크리에이터 민우"
                        required
                        className="w-full glass-input px-3 py-2 rounded-xl text-xs text-slate-900 font-medium"
                      />
                    </div>
                  )}

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">이메일</label>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="creator@laddersns.io"
                      required
                      className="w-full glass-input px-3 py-2 rounded-xl text-xs text-slate-900 font-medium"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">비밀번호</label>
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                            placeholder={authMode === 'signup' ? PASSWORD_RULE_TEXT : '••••••••'}
                      required
                      aria-invalid={Boolean(showPasswordError)}
                      aria-describedby="hero-password-hint"
                      className={`w-full glass-input px-3 py-2 rounded-xl text-xs text-slate-900 font-medium ${
                        showPasswordError ? 'border-rose-400 ring-2 ring-rose-500/15' : ''
                      }`}
                    />
                    {authMode === 'signup' && (
                      <p
                        id="hero-password-hint"
                        className={`text-[10px] mt-1 font-medium ${
                          showPasswordError ? 'text-rose-600' : 'text-slate-500'
                        }`}
                      >
                        {showPasswordError ? passwordError : PASSWORD_RULE_TEXT}
                      </p>
                    )}
                  </div>

                  <div className="flex flex-col sm:flex-row items-center gap-2 pt-1">
                    <button
                      id="hero-submit-btn"
                      type="submit"
                      disabled={Boolean(passwordError)}
                      className="w-full py-2.5 rounded-xl bg-slate-900 text-white font-bold text-xs hover:bg-slate-800 transition-all shadow-xs flex items-center justify-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-slate-900"
                    >
                      <Sparkles className="w-3.5 h-3.5 text-indigo-300" />
                      <span>{authMode === 'signup' ? '대시보드 시작하기' : '로그인하여 시작'}</span>
                    </button>

                    <button
                      id="hero-demo-direct-btn"
                      type="button"
                      onClick={() => handleFinish(true)}
                      className="w-full sm:w-auto text-nowrap px-3.5 py-2.5 rounded-xl bg-white/60 hover:bg-white text-slate-700 font-semibold text-xs border border-white/80 transition-all"
                    >
                      <span className="flex items-center gap-1">
                        <Zap className="w-3 h-3 text-amber-500 fill-amber-400" />
                        <span>1초 데모</span>
                      </span>
                    </button>
                  </div>
                </form>

                <div className="flex items-center justify-start pt-1">
                  <button
                    onClick={() => setStep(2)}
                    className="inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-800 font-medium"
                  >
                    <ArrowLeft className="w-3 h-3" />
                    <span>플랫폼 다시 선택</span>
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
