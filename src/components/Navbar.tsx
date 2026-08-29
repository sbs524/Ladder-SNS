import React from 'react';
import { Sparkles, LogIn, UserPlus, LogOut, RefreshCw, Plus, Bell, Database } from 'lucide-react';
import ladderMark from '../assets/ladder-mark.png';
import { UserProfile } from '../types';
import { PLATFORM_CONFIGS } from '../data/mockData';

interface NavbarProps {
  user: UserProfile;
  onOpenAuth: (mode: 'login' | 'signup') => void;
  onOpenOnboarding: () => void;
  onOpenComposer: () => void;
  onOpenAnalysis?: () => void;
  onOpenRawData?: () => void;
  onLogout: () => void;
  isHeroMode: boolean;
  onToggleView: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  user,
  onOpenAuth,
  onOpenOnboarding,
  onOpenComposer,
  onOpenAnalysis,
  onOpenRawData,
  onLogout,
  isHeroMode,
  onToggleView,
}) => {
  return (
    <header className="w-full px-3 sm:px-6 py-2.5 z-40 transition-all">
      <div className="max-w-7xl mx-auto glass-panel rounded-2xl px-4 py-2 flex items-center justify-between border border-white/70">
        
        {/* Brand & Left minimal icon */}
        <button 
          id="nav-brand-btn"
          onClick={onToggleView} 
          className="flex items-center gap-2.5 text-left group"
        >
          <img
            src={ladderMark}
            alt=""
            draggable={false}
            className="w-8 h-8 select-none group-hover:scale-105 transition-transform"
          />
          <div className="flex items-center gap-1.5">
            <span className="font-extrabold text-base tracking-tight text-slate-900">
              Ladder<span className="text-indigo-600"> SNS</span>
            </span>
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-white/60 text-slate-600 border border-white/80">
              {isHeroMode ? '온보딩' : '대시보드'}
            </span>
          </div>
        </button>

        {/* Right Action buttons with top-right Login / Sign Up */}
        <div className="flex items-center gap-1.5 sm:gap-2">
          
          {/* Quick toggle to restart onboarding */}
          {!isHeroMode && (
            <button
              id="nav-switch-onboarding-btn"
              onClick={onOpenOnboarding}
              className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 rounded-xl bg-white/40 hover:bg-white/70 text-slate-700 border border-white/60 transition-all"
              title="설문 다시 열기"
            >
              <RefreshCw className="w-3 h-3 text-slate-500" />
              <span className="hidden sm:inline">질문 다시하기</span>
            </button>
          )}

          {/* Quick AI Analysis Button */}
          {!isHeroMode && onOpenAnalysis && (
            <button
              id="nav-ai-analysis-btn"
              onClick={onOpenAnalysis}
              className="inline-flex items-center gap-1.5 text-xs font-bold px-2.5 sm:px-3 py-1.5 rounded-xl bg-gradient-to-r from-indigo-600 via-purple-600 to-rose-600 text-white hover:opacity-95 transition-all shadow-xs"
            >
              <Sparkles className="w-3.5 h-3.5 text-amber-300 animate-pulse" />
              <span className="hidden sm:inline">AI 지표 분석</span>
              <span className="sm:hidden">분석</span>
            </button>
          )}

          {/* Raw YouTube data explorer */}
          {!isHeroMode && onOpenRawData && (
            <button
              id="nav-raw-data-btn"
              onClick={onOpenRawData}
              className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 rounded-xl bg-white/40 hover:bg-white/70 text-slate-700 border border-white/60 transition-all"
              title="YouTube 원본 데이터 보기"
            >
              <Database className="w-3.5 h-3.5 text-slate-500" />
              <span className="hidden sm:inline">원본 데이터</span>
            </button>
          )}

          {/* Quick Write Post */}
          {!isHeroMode && (
            <button
              id="nav-composer-quick-btn"
              onClick={onOpenComposer}
              className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 sm:px-3 py-1.5 rounded-xl bg-slate-900/90 hover:bg-slate-900 text-white transition-all shadow-xs"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>글작성</span>
            </button>
          )}

          {/* Top-Right Login / Sign Up */}
          <div className="flex items-center gap-1 pl-1.5 border-l border-slate-200/50">
            {user.isLoggedIn ? (
              <div className="flex items-center gap-1.5">
                <div className="w-7 h-7 rounded-xl bg-indigo-600 text-white flex items-center justify-center font-bold text-xs shadow-xs">
                  {user.name.charAt(0) || 'U'}
                </div>
                <span className="text-xs font-semibold text-slate-800 hidden md:inline">{user.name}</span>
                <button
                  id="nav-logout-btn"
                  onClick={onLogout}
                  title="로그아웃"
                  className="p-1 rounded-lg text-slate-400 hover:text-rose-600 transition-colors ml-1"
                >
                  <LogOut className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <>
                <button
                  id="nav-login-btn"
                  onClick={() => onOpenAuth('login')}
                  className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 rounded-xl text-slate-700 hover:text-slate-900 bg-white/40 hover:bg-white/70 border border-white/60 transition-all"
                >
                  <LogIn className="w-3 h-3 text-slate-500" />
                  <span>로그인</span>
                </button>

                <button
                  id="nav-signup-btn"
                  onClick={() => onOpenAuth('signup')}
                  className="inline-flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-xl bg-slate-900 text-white hover:bg-slate-800 transition-all shadow-2xs"
                >
                  <UserPlus className="w-3 h-3 text-indigo-300" />
                  <span>회원가입</span>
                </button>
              </>
            )}
          </div>

        </div>

      </div>
    </header>
  );
};
