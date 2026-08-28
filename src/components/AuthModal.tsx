import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { ArrowLeft, CheckCircle2, Clipboard, LogIn, Mail, User, UserPlus, X } from 'lucide-react';
import { beginGoogleSignIn, requestEmailOtp, verifyEmailOtp, type AuthSessionResponse } from '../lib/authApi';

interface AuthModalProps {
  isOpen: boolean;
  mode: 'login' | 'signup';
  onClose: () => void;
  onSuccess: (session: AuthSessionResponse) => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({ isOpen, mode: initialMode, onClose, onSuccess }) => {
  const [mode, setMode] = useState<'login' | 'signup'>(initialMode);
  const [step, setStep] = useState<'request' | 'verify'>('request');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [token, setToken] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [otpExpiresAt, setOtpExpiresAt] = useState<number | null>(null);
  const [currentTime, setCurrentTime] = useState(Date.now());
  const remainingSeconds = otpExpiresAt ? Math.max(0, Math.ceil((otpExpiresAt - currentTime) / 1000)) : 0;
  const otpExpired = otpExpiresAt !== null && remainingSeconds === 0;
  const remainingTime = `${String(Math.floor(remainingSeconds / 60)).padStart(2, '0')}:${String(remainingSeconds % 60).padStart(2, '0')}`;

  useEffect(() => {
    if (!isOpen || step !== 'verify' || !otpExpiresAt) return;
    const timerId = window.setInterval(() => {
      const nextCurrentTime = Date.now();
      setCurrentTime(nextCurrentTime);
      if (nextCurrentTime >= otpExpiresAt) window.clearInterval(timerId);
    }, 1_000);
    return () => window.clearInterval(timerId);
  }, [isOpen, otpExpiresAt, step]);

  const requestCode = async (event?: React.FormEvent) => {
    event?.preventDefault();
    const displayName = name.trim();
    if (!email.trim()) return;
    if (mode === 'signup' && !displayName) {
      setError('회원가입에는 이름 또는 크리에이터 닉네임이 필요합니다.');
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      const result = await requestEmailOtp(email.trim(), mode === 'signup' ? displayName : undefined);
      setMessage(`인증 코드를 ${email.trim()}(으)로 보냈습니다. ${Math.floor(result.expires_in_seconds / 60)}분 안에 입력해 주세요.`);
      setOtpExpiresAt(Date.now() + result.expires_in_seconds * 1_000);
      setCurrentTime(Date.now());
      setStep('verify');
      setToken('');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '인증 코드를 보내지 못했습니다.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const verifyCode = async (event: React.FormEvent) => {
    event.preventDefault();
    if (otpExpired) {
      setError('인증 코드가 만료되었습니다. 새 코드를 요청해 주세요.');
      return;
    }
    if (!/^\d{6}$/.test(token)) {
      setError('이메일로 받은 6자리 인증 코드를 입력해 주세요.');
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      onSuccess(await verifyEmailOtp(email.trim(), token));
    } catch (verifyError) {
      setError(verifyError instanceof Error ? verifyError.message : '인증 코드 확인에 실패했습니다.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const pasteCode = async () => {
    try {
      setToken((await navigator.clipboard.readText()).replace(/\D/g, '').slice(0, 6));
      setError(null);
    } catch {
      setError('클립보드 접근을 허용한 뒤 다시 시도해 주세요.');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/30 backdrop-blur-sm">
      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="w-full max-w-md glass-panel-elevated rounded-3xl p-6 sm:p-7 relative border border-white/90 shadow-2xl">
        <button onClick={onClose} aria-label="닫기" className="absolute top-5 right-5 p-1.5 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100/70 transition-colors"><X className="w-5 h-5" /></button>
        <div className="text-center mb-6">
          <div className="w-12 h-12 rounded-2xl bg-indigo-600/10 text-indigo-600 flex items-center justify-center mx-auto mb-3">{step === 'verify' ? <CheckCircle2 className="w-6 h-6" /> : mode === 'login' ? <LogIn className="w-6 h-6" /> : <UserPlus className="w-6 h-6" />}</div>
          <h2 className="text-2xl font-extrabold text-slate-900">{step === 'verify' ? '이메일 인증' : mode === 'login' ? 'Ladder SNS 로그인' : 'Ladder SNS 회원가입'}</h2>
          <p className="text-xs text-slate-500 mt-1">{step === 'verify' ? '이메일로 받은 6자리 코드를 입력해 주세요.' : '비밀번호 없이 이메일 또는 Google 계정으로 시작하세요.'}</p>
        </div>

        {step === 'request' ? (
          <>
            <div className="flex rounded-xl bg-slate-100/90 p-1 mb-5 border border-slate-200/80">
              <button type="button" onClick={() => { setMode('login'); setError(null); }} className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${mode === 'login' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500'}`}>로그인</button>
              <button type="button" onClick={() => { setMode('signup'); setError(null); }} className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${mode === 'signup' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500'}`}>회원가입</button>
            </div>
            <form onSubmit={requestCode} className="space-y-3.5">
              {mode === 'signup' && <div><label className="block text-xs font-semibold text-slate-700 mb-1">이름 또는 크리에이터 닉네임</label><div className="relative"><User className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" /><input type="text" value={name} onChange={(event) => setName(event.target.value)} placeholder="예: 홍길동" required className="w-full glass-input pl-10 pr-4 py-2.5 rounded-xl text-sm font-medium text-slate-900" /></div></div>}
              <div><label className="block text-xs font-semibold text-slate-700 mb-1">이메일 주소</label><div className="relative"><Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" /><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="creator@example.com" required autoComplete="email" className="w-full glass-input pl-10 pr-4 py-2.5 rounded-xl text-sm font-medium text-slate-900" /></div></div>
              {error && <p role="alert" className="text-xs font-medium text-rose-600">{error}</p>}
              <button type="submit" disabled={isSubmitting} className="w-full py-3 rounded-xl bg-slate-900 text-white font-bold text-sm hover:bg-slate-800 transition-all shadow-md flex items-center justify-center gap-2 disabled:opacity-50"><Mail className="w-4 h-4 text-indigo-300" /><span>{isSubmitting ? '코드 보내는 중...' : '이메일로 인증 코드 받기'}</span></button>
            </form>
            <div className="flex items-center gap-3 py-4"><div className="h-px flex-1 bg-slate-200" /><span className="text-[11px] font-medium text-slate-400">또는</span><div className="h-px flex-1 bg-slate-200" /></div>
            <button type="button" onClick={beginGoogleSignIn} className="w-full py-2.5 rounded-xl bg-white text-slate-700 font-bold text-sm border border-slate-200 hover:bg-slate-50 transition-all flex items-center justify-center gap-2"><span className="w-4 h-4 rounded-full border border-slate-300 text-[10px] leading-[14px] text-center font-extrabold text-red-500">G</span>Google로 계속하기</button>
          </>
        ) : (
          <form onSubmit={verifyCode} className="space-y-4">
            <div className="rounded-xl bg-indigo-50 border border-indigo-100 px-3 py-2.5 text-xs text-indigo-800 flex items-center justify-between gap-3"><span className="min-w-0">{otpExpired ? '인증 코드가 만료되었습니다. 새 코드를 요청해 주세요.' : message}</span><span className={`shrink-0 font-bold tabular-nums ${otpExpired ? 'text-rose-600' : 'text-indigo-700'}`}>남은 시간 {remainingTime}</span></div>
            <div><label className="block text-xs font-semibold text-slate-700 mb-1">인증 코드</label><div className="flex gap-2"><input type="text" inputMode="numeric" autoComplete="one-time-code" value={token} onChange={(event) => setToken(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="123456" maxLength={6} disabled={otpExpired} className="min-w-0 flex-1 glass-input px-3 py-3 rounded-xl text-center text-lg tracking-[0.35em] font-bold text-slate-900 disabled:opacity-50" /><button type="button" onClick={pasteCode} disabled={otpExpired} className="shrink-0 px-3 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50" title="클립보드에서 붙여넣기"><Clipboard className="w-4 h-4" /></button></div></div>
            {error && <p role="alert" className="text-xs font-medium text-rose-600">{error}</p>}
            <button type="submit" disabled={isSubmitting || otpExpired} className="w-full py-3 rounded-xl bg-slate-900 text-white font-bold text-sm hover:bg-slate-800 transition-all shadow-md disabled:opacity-50">{isSubmitting ? '확인 중...' : '인증하고 시작하기'}</button>
            <div className="flex items-center justify-between text-xs"><button type="button" onClick={() => { setStep('request'); setError(null); }} className="inline-flex items-center gap-1 text-slate-500 hover:text-slate-800"><ArrowLeft className="w-3.5 h-3.5" />이메일 변경</button><button type="button" onClick={() => void requestCode()} disabled={isSubmitting} className="text-indigo-600 hover:text-indigo-700 font-semibold disabled:opacity-50">코드 다시 보내기</button></div>
          </form>
        )}
      </motion.div>
    </div>
  );
};
