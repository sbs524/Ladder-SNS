import React, { useState } from 'react';
import { motion } from 'motion/react';
import { X, Lock, Mail, User, Sparkles, LogIn, UserPlus } from 'lucide-react';
import { UserProfile } from '../types';
import { validatePassword, PASSWORD_RULE_TEXT } from '../passwordPolicy';

interface AuthModalProps {
  isOpen: boolean;
  mode: 'login' | 'signup';
  onClose: () => void;
  onSuccess: (name: string, email: string) => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  mode: initialMode,
  onClose,
  onSuccess,
}) => {
  const [mode, setMode] = useState<'login' | 'signup'>(initialMode);
  const [name, setName] = useState('크리에이터 민우');
  const [email, setEmail] = useState('user@laddersns.io');
  const [password, setPassword] = useState('');

  // 회원가입에만 비밀번호 규칙을 적용한다 (기존 계정 로그인은 규칙 이전 비밀번호일 수 있음)
  const passwordError = mode === 'signup' ? validatePassword(password) : null;
  // 빈 칸일 때는 규칙 안내만, 뭔가 입력하면 어디가 틀렸는지 바로 알려준다
  const showPasswordError = password.length > 0 ? passwordError : null;

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (passwordError) return;
    onSuccess(mode === 'signup' ? name : (name || email.split('@')[0]), email);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/30 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="w-full max-w-md glass-panel-elevated rounded-3xl p-6 sm:p-7 relative border border-white/90 shadow-2xl"
      >
        <button
          onClick={onClose}
          className="absolute top-5 right-5 p-1.5 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100/70 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="text-center mb-6">
          <div className="w-12 h-12 rounded-2xl bg-indigo-600/10 text-indigo-600 flex items-center justify-center mx-auto mb-3">
            {mode === 'login' ? <LogIn className="w-6 h-6" /> : <UserPlus className="w-6 h-6" />}
          </div>
          <h2 className="text-2xl font-extrabold text-slate-900">
            {mode === 'login' ? 'Ladder SNS 로그인' : 'Ladder SNS 회원가입'}
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            {mode === 'login'
              ? '연동된 모든 소셜 채널의 실시간 지표를 확인하세요'
              : '간편 가입 후 유튜브, 인스타, 쓰레드, X 지표를 통합 관리하세요'}
          </p>
        </div>

        {/* Tab switch */}
        <div className="flex rounded-xl bg-slate-100/90 p-1 mb-5 border border-slate-200/80">
          <button
            onClick={() => setMode('login')}
            className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${
              mode === 'login' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500'
            }`}
          >
            로그인
          </button>
          <button
            onClick={() => setMode('signup')}
            className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${
              mode === 'signup' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500'
            }`}
          >
            회원가입
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3.5">
          {mode === 'signup' && (
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">이름</label>
              <div className="relative">
                <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="예: 홍길동"
                  required
                  className="w-full glass-input pl-10 pr-4 py-2.5 rounded-xl text-sm font-medium text-slate-900"
                />
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">이메일 주소</label>
            <div className="relative">
              <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="creator@example.com"
                required
                className="w-full glass-input pl-10 pr-4 py-2.5 rounded-xl text-sm font-medium text-slate-900"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">비밀번호</label>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={mode === 'signup' ? PASSWORD_RULE_TEXT : '••••••••'}
                required
                aria-invalid={Boolean(showPasswordError)}
                aria-describedby="auth-password-hint"
                className={`w-full glass-input pl-10 pr-4 py-2.5 rounded-xl text-sm font-medium text-slate-900 ${
                  showPasswordError ? 'border-rose-400 ring-2 ring-rose-500/15' : ''
                }`}
              />
            </div>
            {mode === 'signup' && (
              <p
                id="auth-password-hint"
                className={`text-[11px] mt-1 font-medium ${
                  showPasswordError ? 'text-rose-600' : 'text-slate-500'
                }`}
              >
                {showPasswordError ? passwordError : PASSWORD_RULE_TEXT}
              </p>
            )}
          </div>

          <button
            type="submit"
            disabled={Boolean(passwordError)}
            className="w-full mt-2 py-3 rounded-xl bg-slate-900 text-white font-bold text-sm hover:bg-slate-800 transition-all shadow-md flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-slate-900"
          >
            <Sparkles className="w-4 h-4 text-indigo-300" />
            <span>{mode === 'login' ? '로그인하여 시작하기' : '회원가입 완료'}</span>
          </button>
        </form>
      </motion.div>
    </div>
  );
};
