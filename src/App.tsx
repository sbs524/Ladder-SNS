import React, { useEffect, useState } from 'react';
import { Navbar } from './components/Navbar';
import { OnboardingHero } from './components/OnboardingHero';
import { Dashboard } from './components/Dashboard';
import { AuthModal } from './components/AuthModal';
import { PostComposerModal } from './components/PostComposerModal';
import { AIAnalysisModal } from './components/AIAnalysisModal';
import { YoutubeRawDataPage } from './components/YoutubeRawDataPage';
import { MyPage } from './components/MyPage';
import { getCurrentSession, logout, updateCurrentProfile, type AuthProfile, type AuthSessionResponse } from './lib/authApi';
import { UserProfile, PlatformType, ScheduledPost, UserType } from './types';

const PENDING_ONBOARDING_KEY = 'ladder-pending-onboarding';

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
    selectedPlatforms: pending?.selectedPlatforms || previous.selectedPlatforms,
    avatarUrl: session.profile?.avatar_url || undefined,
    isLoggedIn: true,
  };
}

export function App() {
  const [user, setUser] = useState<UserProfile>({
    name: '크리에이터 민우',
    email: 'creator@laddersns.io',
    userType: 'individual',
    selectedPlatforms: ['youtube', 'instagram', 'threads', 'x'],
    platformHandles: { youtube: '@creator_minwoo', instagram: '@minwoo.live', threads: '@minwoo.live', x: '@minwoo_tech' },
    isLoggedIn: false,
  });
  const [isHeroMode, setIsHeroMode] = useState(true);
  const [isRawDataOpen, setIsRawDataOpen] = useState(false);
  const [isMyPageOpen, setIsMyPageOpen] = useState(false);
  const [authModal, setAuthModal] = useState<{ isOpen: boolean }>({ isOpen: false });
  const [isComposerOpen, setIsComposerOpen] = useState(false);
  const [publishedPosts, setPublishedPosts] = useState<ScheduledPost[]>([]);
  const [analysisModal, setAnalysisModal] = useState<{ isOpen: boolean; platform: PlatformType | 'all' }>({ isOpen: false, platform: 'all' });

  const applySession = async (session: AuthSessionResponse) => {
    const pending = readPendingOnboarding();
    if (pending) {
      window.sessionStorage.removeItem(PENDING_ONBOARDING_KEY);
      try {
        const result = await updateCurrentProfile({ user_type: pending.userType, onboarding_completed: true });
        session = { ...session, profile: result.profile };
      } catch {
        // The session remains valid even if onboarding persistence is temporarily unavailable.
      }
    }
    setUser((previous) => userFromSession(session, previous, pending));
    setAuthModal({ isOpen: false });
    setIsHeroMode(false);
  };

  useEffect(() => {
    void getCurrentSession().then(applySession).catch(() => undefined);
  }, []);

  const handleOpenAnalysis = (platform: PlatformType | 'all' = 'all') => setAnalysisModal({ isOpen: true, platform });
  const handleOnboardingAuth = (pending: PendingOnboarding) => {
    window.sessionStorage.setItem(PENDING_ONBOARDING_KEY, JSON.stringify(pending));
    setAuthModal({ isOpen: true });
  };
  const handleLogout = () => {
    void logout().catch(() => undefined).finally(() => {
      setUser((previous) => ({ ...previous, isLoggedIn: false }));
      setIsHeroMode(true);
      setIsRawDataOpen(false);
      setIsMyPageOpen(false);
    });
  };
  const handleProfileUpdated = (profile: AuthProfile) => {
    setUser((previous) => ({
      ...previous,
      name: profile.display_name || previous.email.split('@')[0] || previous.name,
      avatarUrl: profile.avatar_url || undefined,
    }));
  };
  const handleAccountDeleted = () => {
    setUser((previous) => ({ ...previous, isLoggedIn: false }));
    setIsMyPageOpen(false);
    setIsHeroMode(true);
  };

  return (
    <div className="min-h-screen bg-mesh-glow text-slate-900 flex flex-col justify-between selection:bg-indigo-500 selection:text-white relative overflow-x-hidden">
      <div className="fixed top-[-10%] left-[-5%] w-[45vw] h-[45vw] rounded-full bg-indigo-200/25 blur-3xl pointer-events-none -z-10" />
      <div className="fixed bottom-[-10%] right-[-5%] w-[45vw] h-[35vw] rounded-full bg-rose-100/30 blur-3xl pointer-events-none -z-10" />
      <div className="fixed top-[30%] right-[10%] w-[35vw] h-[35vw] rounded-full bg-sky-100/25 blur-3xl pointer-events-none -z-10" />

      <Navbar user={user} onOpenAuth={() => setAuthModal({ isOpen: true })} onOpenOnboarding={() => { setIsHeroMode(true); setIsRawDataOpen(false); setIsMyPageOpen(false); }} onOpenComposer={() => setIsComposerOpen(true)} onOpenAnalysis={() => handleOpenAnalysis('all')} onOpenRawData={user.isLoggedIn ? () => setIsRawDataOpen(true) : undefined} onOpenMyPage={user.isLoggedIn ? () => setIsMyPageOpen(true) : undefined} onLogout={handleLogout} isHeroMode={isHeroMode} onToggleView={() => { setIsHeroMode((previous) => !previous); setIsRawDataOpen(false); setIsMyPageOpen(false); }} />

      <main className="flex-1 flex flex-col justify-center px-3 sm:px-6 py-2">
        {isHeroMode ? (
          <OnboardingHero initialProfile={user} onRequestAuth={handleOnboardingAuth} onSkipToDashboard={() => setIsHeroMode(false)} />
        ) : isMyPageOpen ? (
          <MyPage user={user} onBack={() => setIsMyPageOpen(false)} onProfileUpdated={handleProfileUpdated} onAccountDeleted={handleAccountDeleted} />
        ) : isRawDataOpen ? (
          <YoutubeRawDataPage onBack={() => setIsRawDataOpen(false)} />
        ) : (
          <Dashboard user={user} onOpenComposer={() => setIsComposerOpen(true)} onOpenOnboarding={() => setIsHeroMode(true)} onOpenAnalysis={handleOpenAnalysis} publishedPosts={publishedPosts} />
        )}
      </main>

      <footer className="w-full text-center py-2 text-[11px] text-slate-400 font-medium"><span>Ladder SNS — 유튜브 · 인스타그램 · 쓰레드 · X 통합 관리</span></footer>

      {authModal.isOpen && <AuthModal isOpen={authModal.isOpen} onClose={() => setAuthModal({ isOpen: false })} onSuccess={applySession} />}
      {isComposerOpen && <PostComposerModal isOpen={isComposerOpen} availablePlatforms={user.selectedPlatforms} onPublish={(post) => setPublishedPosts((previous) => [post, ...previous])} onClose={() => setIsComposerOpen(false)} />}
      {analysisModal.isOpen && <AIAnalysisModal isOpen={analysisModal.isOpen} user={user} initialPlatform={analysisModal.platform} onClose={() => setAnalysisModal({ isOpen: false, platform: 'all' })} />}
    </div>
  );
}

export default App;

