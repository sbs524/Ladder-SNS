import React, { useState } from 'react';
import { Navbar } from './components/Navbar';
import { OnboardingHero } from './components/OnboardingHero';
import { Dashboard } from './components/Dashboard';
import { AuthModal } from './components/AuthModal';
import { PostComposerModal } from './components/PostComposerModal';
import { AIAnalysisModal } from './components/AIAnalysisModal';
import { UserProfile, PlatformType, ScheduledPost } from './types';

export function App() {
  // Application State
  const [user, setUser] = useState<UserProfile>({
    name: '크리에이터 민우',
    email: 'creator@laddersns.io',
    userType: 'individual',
    selectedPlatforms: ['youtube', 'instagram', 'threads', 'x'],
    platformHandles: {
      youtube: '@creator_minwoo',
      instagram: '@minwoo.live',
      threads: '@minwoo.live',
      x: '@minwoo_tech',
    },
    isLoggedIn: false,
  });

  // View Mode: starts in Hero Onboarding mode ("온보딩 ui가 가운데 뜨면서 시작 이런 느낌")
  const [isHeroMode, setIsHeroMode] = useState<boolean>(true);

  // Modals
  const [authModal, setAuthModal] = useState<{ isOpen: boolean; mode: 'login' | 'signup' }>({
    isOpen: false,
    mode: 'login',
  });
  const [isComposerOpen, setIsComposerOpen] = useState<boolean>(false);
  const [publishedPosts, setPublishedPosts] = useState<ScheduledPost[]>([]);
  const [analysisModal, setAnalysisModal] = useState<{ isOpen: boolean; platform: PlatformType | 'all' }>({
    isOpen: false,
    platform: 'all',
  });

  const handleOpenAnalysis = (platform: PlatformType | 'all' = 'all') => {
    setAnalysisModal({ isOpen: true, platform });
  };

  const handleOnboardingComplete = (updatedProfile: UserProfile) => {
    setUser(updatedProfile);
    setIsHeroMode(false); // Move to compact dashboard
  };

  const handleLoginSuccess = (name: string, email: string) => {
    setUser((prev) => ({
      ...prev,
      name,
      email,
      isLoggedIn: true,
    }));
    setAuthModal({ isOpen: false, mode: 'login' });
    setIsHeroMode(false);
  };

  const handleLogout = () => {
    setUser((prev) => ({
      ...prev,
      isLoggedIn: false,
    }));
  };

  return (
    <div className="min-h-screen bg-mesh-glow text-slate-900 flex flex-col justify-between selection:bg-indigo-500 selection:text-white relative overflow-x-hidden">
      
      {/* Dynamic ambient glass light spheres */}
      <div className="fixed top-[-10%] left-[-5%] w-[45vw] h-[45vw] rounded-full bg-indigo-200/25 blur-3xl pointer-events-none -z-10" />
      <div className="fixed bottom-[-10%] right-[-5%] w-[45vw] h-[45vw] rounded-full bg-rose-100/30 blur-3xl pointer-events-none -z-10" />
      <div className="fixed top-[30%] right-[10%] w-[35vw] h-[35vw] rounded-full bg-sky-100/25 blur-3xl pointer-events-none -z-10" />

      {/* 1. Ultra Minimal Glass Header */}
      <Navbar
        user={user}
        onOpenAuth={(mode) => setAuthModal({ isOpen: true, mode })}
        onOpenOnboarding={() => setIsHeroMode(true)}
        onOpenComposer={() => setIsComposerOpen(true)}
        onOpenAnalysis={() => handleOpenAnalysis('all')}
        onLogout={handleLogout}
        isHeroMode={isHeroMode}
        onToggleView={() => setIsHeroMode((prev) => !prev)}
      />

      {/* 2. Main Content Area */}
      <main className="flex-1 flex flex-col justify-center px-3 sm:px-6 py-2">
        {isHeroMode ? (
          <OnboardingHero
            initialProfile={user}
            onComplete={handleOnboardingComplete}
            onSkipToDashboard={() => setIsHeroMode(false)}
          />
        ) : (
          <Dashboard
            user={user}
            onOpenComposer={() => setIsComposerOpen(true)}
            onOpenOnboarding={() => setIsHeroMode(true)}
            onOpenAnalysis={handleOpenAnalysis}
            publishedPosts={publishedPosts}
          />
        )}
      </main>

      {/* 3. Subtle Clean Footer */}
      <footer className="w-full text-center py-2 text-[11px] text-slate-400 font-medium">
        <span>Ladder SNS — 유튜브 · 인스타그램 · 쓰레드 · X 통합 관리</span>
      </footer>

      {/* Modals */}
      {/* Rendered only while open so each open starts from fresh state */}
      {authModal.isOpen && (
      <AuthModal
        isOpen={authModal.isOpen}
        mode={authModal.mode}
        onClose={() => setAuthModal({ isOpen: false, mode: 'login' })}
        onSuccess={handleLoginSuccess}
      />
      )}

      {isComposerOpen && (
      <PostComposerModal
        isOpen={isComposerOpen}
        availablePlatforms={user.selectedPlatforms}
        onPublish={(post) => setPublishedPosts((prev) => [post, ...prev])}
        onClose={() => setIsComposerOpen(false)}
      />
      )}

      {analysisModal.isOpen && (
      <AIAnalysisModal
        isOpen={analysisModal.isOpen}
        user={user}
        initialPlatform={analysisModal.platform}
        onClose={() => setAnalysisModal({ isOpen: false, platform: 'all' })}
      />
      )}

    </div>
  );
}

export default App;

