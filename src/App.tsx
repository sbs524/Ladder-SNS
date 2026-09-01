import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Navbar } from './components/Navbar';
import { OnboardingHero } from './components/OnboardingHero';
import { Dashboard } from './components/Dashboard';
import { AuthModal } from './components/AuthModal';
import { VideoDraftModal } from './components/VideoDraftModal';
import { AIAnalysisModal } from './components/AIAnalysisModal';
import { YoutubeRawDataPage, type RawDataTab } from './components/YoutubeRawDataPage';
import { MyPage } from './components/MyPage';
import { PlatformSettingsModal } from './components/PlatformSettingsModal';
import { getCurrentSession, logout, refreshSession, updateCurrentProfile, type AuthProfile, type AuthSessionResponse } from './lib/authApi';
import { UserProfile, PlatformType, UserType } from './types';

const PENDING_ONBOARDING_KEY = 'ladder-pending-onboarding';

/**
 * 화면은 한 번에 하나만 열린다. 예전에는 isHeroMode / isMyPageOpen / isRawDataOpen 세 불리언이
 * 8가지 조합을 만들 수 있었는데 실제로 뜻이 있는 건 아래 4개뿐이었고, 어느 화면인지가 렌더링
 * 순서에 숨어 있어서 브라우저 히스토리에 실을 수가 없었다.
 */
type View = 'onboarding' | 'dashboard' | 'rawdata' | 'mypage';

type HistoryState = { view: View; rawDataTab: RawDataTab };

/** 액세스 토큰이 1시간이라 그보다 넉넉히 앞서 갱신한다. */
const SESSION_KEEPALIVE_MS = 30 * 60 * 1000;

type PendingOnboarding = {
  userType: UserType;
  selectedPlatforms: PlatformType[];
};

function readPendingOnboarding(): PendingOnboarding | null {
  try {
    const value = window.sessionStorage.getItem(PENDING_ONBOARDING_KEY);
    if (!value) return null;
    const pending = JSON.parse(value) as Partial<PendingOnboarding>;
    if (!pending.userType || !Array.isArray(pending.selectedPlatforms)) return null;
    return { userType: pending.userType, selectedPlatforms: pending.selectedPlatforms };
  } catch {
    return null;
  }
}

function userFromSession(session: AuthSessionResponse, previous: UserProfile, pending?: PendingOnboarding | null): UserProfile {
  const email = session.user.email || previous.email;
  return {
    ...previous,
    name: session.profile?.display_name || email.split('@')[0] || 'Ladder 사용자',
    email,
    userType: pending?.userType || session.profile?.user_type || previous.userType,
    selectedPlatforms: pending?.selectedPlatforms || session.profile?.selected_platforms || previous.selectedPlatforms,
    plan: session.profile?.plan || 'free',
    aiCredits: session.profile?.ai_credits ?? 0,
    avatarUrl: session.profile?.avatar_url || undefined,
    isLoggedIn: true,
  };
}

export function App() {
  // 로그인 전에는 신원이 없다. 예전에는 여기에 '크리에이터 민우 / creator@laddersns.io'와
  // 가짜 핸들 4개가 박혀 있어서, 로그아웃 상태의 대시보드가 존재하지 않는 사람을 보여줬다.
  const [user, setUser] = useState<UserProfile>({
    name: '',
    email: '',
    userType: 'individual',
    selectedPlatforms: ['youtube'],
    plan: 'free',
    aiCredits: 0,
    isLoggedIn: false,
  });
  const [view, setView] = useState<View>('onboarding');
  const [rawDataTab, setRawDataTab] = useState<RawDataTab>('개요');
  const [authModal, setAuthModal] = useState<{ isOpen: boolean }>({ isOpen: false });
  const [isPlatformSettingsOpen, setIsPlatformSettingsOpen] = useState(false);
  const [isComposerOpen, setIsComposerOpen] = useState(false);
  // 대시보드가 저장 직후 지표를 다시 읽게 하는 신호.
  const [dataVersion, setDataVersion] = useState(0);
  const [analysisModal, setAnalysisModal] = useState<{ isOpen: boolean; platform: PlatformType | 'all' }>({ isOpen: false, platform: 'all' });

  // popstate 안에서 최신 로그인 상태를 봐야 하는데, 리스너는 한 번만 붙이므로 ref로 읽는다.
  const isLoggedInRef = useRef(false);
  isLoggedInRef.current = user.isLoggedIn;

  /**
   * 화면 전환을 브라우저 히스토리에 남긴다. 이게 없으면 원본 데이터 화면에서 뒤로가기를 눌렀을 때
   * 대시보드가 아니라 사이트 밖으로 나가버린다.
   */
  const navigate = useCallback((next: View, options?: { replace?: boolean; rawDataTab?: RawDataTab }) => {
    const nextTab = options?.rawDataTab;
    if (nextTab) setRawDataTab(nextTab);
    setView(next);
    setIsPlatformSettingsOpen(false);
    const state: HistoryState = { view: next, rawDataTab: nextTab ?? '개요' };
    if (options?.replace) window.history.replaceState(state, '');
    else window.history.pushState(state, '');
  }, []);

  useEffect(() => {
    // 첫 진입 항목에도 상태를 심어둬야 뒤로 돌아왔을 때 어느 화면이었는지 알 수 있다.
    window.history.replaceState({ view: 'onboarding', rawDataTab: '개요' } satisfies HistoryState, '');
    const onPopState = (event: PopStateEvent) => {
      const state = event.state as Partial<HistoryState> | null;
      if (state?.rawDataTab) setRawDataTab(state.rawDataTab);
      setIsPlatformSettingsOpen(false);
      setView(state?.view ?? (isLoggedInRef.current ? 'dashboard' : 'onboarding'));
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const applySession = async (session: AuthSessionResponse) => {
    const pending = readPendingOnboarding();
    if (pending) {
      window.sessionStorage.removeItem(PENDING_ONBOARDING_KEY);
      try {
        const result = await updateCurrentProfile({
          user_type: pending.userType,
          selected_platforms: pending.selectedPlatforms,
          onboarding_completed: true,
        });
        session = { ...session, profile: result.profile };
      } catch {
        // The session remains valid even if onboarding persistence is temporarily unavailable.
      }
    }
    setUser((previous) => userFromSession(session, previous, pending));
    setAuthModal({ isOpen: false });
    // 로그인은 새 화면이 아니라 시작 지점의 교체다. 밀어 넣으면 뒤로가기가 온보딩으로 되돌아간다.
    navigate('dashboard', { replace: true });
  };

  useEffect(() => {
    void getCurrentSession().then(applySession).catch(() => undefined);
  }, []);

  // 탭을 오래 열어두면 액세스 토큰이 만료돼 모든 요청이 401이 된다. 로그인 중에는 주기적으로,
  // 그리고 탭으로 돌아올 때마다 갱신해서 로그아웃을 누르기 전까지 세션을 유지한다.
  useEffect(() => {
    if (!user.isLoggedIn) return;
    const timer = window.setInterval(() => void refreshSession(), SESSION_KEEPALIVE_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refreshSession();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [user.isLoggedIn]);

  const handleOpenAnalysis = (platform: PlatformType | 'all' = 'all') => setAnalysisModal({ isOpen: true, platform });
  // 결제 플로우가 붙기 전까지 업그레이드 동선은 마이페이지 요금제 섹션에서 끝난다.
  // 아무 데도 못 가는 버튼을 만들지 않기 위해 로그인한 사용자에게만 넘긴다.
  const handleUpgrade = user.isLoggedIn
    ? () => {
        setAnalysisModal({ isOpen: false, platform: 'all' });
        navigate('mypage');
      }
    : undefined;
  const handleOnboardingAuth = (pending: PendingOnboarding) => {
    window.sessionStorage.setItem(PENDING_ONBOARDING_KEY, JSON.stringify(pending));
    setAuthModal({ isOpen: true });
  };
  const handleLogout = () => {
    void logout().catch(() => undefined).finally(() => {
      setUser((previous) => ({ ...previous, isLoggedIn: false }));
      navigate('onboarding', { replace: true });
    });
  };
  const handleProfileUpdated = (profile: AuthProfile) => {
    setUser((previous) => ({
      ...previous,
      name: profile.display_name || previous.email.split('@')[0] || previous.name,
      avatarUrl: profile.avatar_url || undefined,
      plan: profile.plan,
      aiCredits: profile.ai_credits ?? previous.aiCredits,
      selectedPlatforms: profile.selected_platforms || previous.selectedPlatforms,
    }));
  };
  const handleAccountDeleted = () => {
    setUser((previous) => ({ ...previous, isLoggedIn: false }));
    navigate('onboarding', { replace: true });
  };

  return (
    <div className="min-h-screen bg-mesh-glow text-slate-900 flex flex-col justify-between selection:bg-indigo-500 selection:text-white relative overflow-x-hidden">
      <div className="fixed top-[-10%] left-[-5%] w-[45vw] h-[45vw] rounded-full bg-indigo-200/25 blur-3xl pointer-events-none -z-10" />
      <div className="fixed bottom-[-10%] right-[-5%] w-[45vw] h-[35vw] rounded-full bg-rose-100/30 blur-3xl pointer-events-none -z-10" />
      <div className="fixed top-[30%] right-[10%] w-[35vw] h-[35vw] rounded-full bg-sky-100/25 blur-3xl pointer-events-none -z-10" />

      <Navbar
        user={user}
        onOpenAuth={() => setAuthModal({ isOpen: true })}
        onOpenComposer={user.isLoggedIn ? () => setIsComposerOpen(true) : undefined}
        onOpenAnalysis={() => handleOpenAnalysis('all')}
        onOpenMyPage={user.isLoggedIn ? () => navigate('mypage') : undefined}
        onLogout={handleLogout}
        isHeroMode={view === 'onboarding'}
        // 로고는 언제나 홈으로 간다. 로그인했으면 홈은 대시보드지 온보딩이 아니다.
        onGoHome={() => navigate(user.isLoggedIn ? 'dashboard' : 'onboarding')}
        onOpenPlatformSettings={user.isLoggedIn ? () => setIsPlatformSettingsOpen(true) : undefined}
      />

      <main className="flex-1 flex flex-col justify-center px-3 sm:px-6 py-2">
        {view === 'onboarding' ? (
          <OnboardingHero initialProfile={user} onRequestAuth={handleOnboardingAuth} onSkipToDashboard={() => navigate('dashboard')} />
        ) : view === 'mypage' ? (
          <MyPage user={user} onBack={() => navigate('dashboard')} onProfileUpdated={handleProfileUpdated} onAccountDeleted={handleAccountDeleted} />
        ) : view === 'rawdata' ? (
          <YoutubeRawDataPage key={rawDataTab} initialTab={rawDataTab} onBack={() => navigate('dashboard')} />
        ) : (
          <Dashboard
            user={user}
            onOpenComposer={user.isLoggedIn ? () => setIsComposerOpen(true) : undefined}
            onOpenPlatformSettings={user.isLoggedIn ? () => setIsPlatformSettingsOpen(true) : undefined}
            onOpenAuth={() => setAuthModal({ isOpen: true })}
            onOpenAnalysis={handleOpenAnalysis}
            onOpenRawData={user.isLoggedIn ? (tab?: RawDataTab) => navigate('rawdata', { rawDataTab: tab ?? '개요' }) : undefined}
            dataVersion={dataVersion}
          />
        )}
      </main>

      <footer className="w-full text-center py-2 text-[11px] text-slate-400 font-medium"><span>Ladder SNS — 유튜브 · 인스타그램 · 쓰레드 · X 통합 관리</span></footer>

      {isPlatformSettingsOpen && <PlatformSettingsModal selectedPlatforms={user.selectedPlatforms} onClose={() => setIsPlatformSettingsOpen(false)} onSaved={handleProfileUpdated} />}
      {authModal.isOpen && <AuthModal isOpen={authModal.isOpen} onClose={() => setAuthModal({ isOpen: false })} onSuccess={applySession} />}
      {isComposerOpen && <VideoDraftModal isOpen={isComposerOpen} isPlus={user.plan === 'plus'} onUpgrade={handleUpgrade} onBuyCredits={handleUpgrade} onSaved={() => setDataVersion((previous) => previous + 1)} onClose={() => setIsComposerOpen(false)} />}
      {analysisModal.isOpen && <AIAnalysisModal isOpen={analysisModal.isOpen} user={user} initialPlatform={analysisModal.platform} onUpgrade={handleUpgrade} onBuyCredits={handleUpgrade} onClose={() => setAnalysisModal({ isOpen: false, platform: 'all' })} />}
    </div>
  );
}

export default App;

