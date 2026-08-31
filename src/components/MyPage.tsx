import React, { useRef, useState } from 'react';
import { AlertCircle, AlertTriangle, ArrowLeft, Camera, CheckCircle2, Coins, LoaderCircle, Sparkles } from 'lucide-react';
import { PLUS_MONTHLY_PRICE } from './PlusLock';
import { deleteAccount, updateCurrentProfile, uploadAvatar, type AuthProfile } from '../lib/authApi';
import { UserProfile } from '../types';

const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const ALLOWED_AVATAR_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const DELETE_CONFIRM_DELAY_MS = 2000;

interface MyPageProps {
  user: UserProfile;
  onBack: () => void;
  onProfileUpdated: (profile: AuthProfile) => void;
  onAccountDeleted: () => void;
  /** 결제 플로우가 생기면 연결한다. 없으면 가격만 안내하고 버튼을 만들지 않는다. */
  onUpgrade?: () => void;
  /** 크레딧 결제 플로우. 없으면 '준비 중'으로 표시한다. */
  onBuyCredits?: () => void;
}

export function MyPage({ user, onBack, onProfileUpdated, onAccountDeleted, onUpgrade, onBuyCredits }: MyPageProps) {
  const isPlus = user.plan === 'plus';
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);

  const [name, setName] = useState(user.name);
  const [isSavingName, setIsSavingName] = useState(false);
  const [nameMessage, setNameMessage] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);

  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [isDeleteReady, setIsDeleteReady] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const handleAvatarChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setAvatarError(null);
    if (!ALLOWED_AVATAR_TYPES.includes(file.type)) {
      setAvatarError('PNG, JPEG, WebP 이미지만 업로드할 수 있습니다.');
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      setAvatarError('이미지 크기는 2MB를 넘을 수 없습니다.');
      return;
    }
    setIsUploadingAvatar(true);
    try {
      const result = await uploadAvatar(file);
      onProfileUpdated(result.profile);
    } catch (error) {
      setAvatarError(error instanceof Error ? error.message : '이미지를 업로드하지 못했습니다.');
    } finally {
      setIsUploadingAvatar(false);
    }
  };

  const saveName = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || trimmed === user.name) return;
    setIsSavingName(true);
    setNameError(null);
    setNameMessage(null);
    try {
      const result = await updateCurrentProfile({ display_name: trimmed });
      onProfileUpdated(result.profile);
      setNameMessage('이름을 저장했습니다.');
    } catch (error) {
      setNameError(error instanceof Error ? error.message : '이름을 저장하지 못했습니다.');
    } finally {
      setIsSavingName(false);
    }
  };

  const openDeleteConfirm = () => {
    setIsDeleteConfirmOpen(true);
    setIsDeleteReady(false);
    setDeleteError(null);
    window.setTimeout(() => setIsDeleteReady(true), DELETE_CONFIRM_DELAY_MS);
  };

  const confirmDelete = async () => {
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await deleteAccount();
      onAccountDeleted();
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : '회원탈퇴를 처리하지 못했습니다.');
      setIsDeleting(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 px-1 py-2">
      <div className="flex items-center gap-2.5">
        <button type="button" onClick={onBack} className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white/70 px-2.5 py-1.5 text-[11px] font-bold text-slate-600 hover:bg-white">
          <ArrowLeft className="h-3.5 w-3.5" />대시보드로
        </button>
        <h2 className="text-base font-extrabold text-slate-900">마이페이지</h2>
      </div>

      <section className="glass-panel rounded-2xl border border-white/70 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-extrabold text-slate-900">요금제</h3>
            <div className="mt-1.5 flex items-center gap-2">
              <span className={isPlus
                ? 'rounded-lg bg-gradient-to-r from-indigo-600 to-purple-600 px-2.5 py-1 text-xs font-extrabold text-white'
                : 'rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-extrabold text-slate-600'}>
                {isPlus ? 'Plus' : 'Free'}
              </span>
              <span className="text-[11px] text-slate-500">
                {isPlus ? `${PLUS_MONTHLY_PRICE} · 연동 채널 5개` : '연동 채널 2개 · AI 기능은 잠김'}
              </span>
            </div>
          </div>
          {!isPlus && (onUpgrade ? (
            <button type="button" onClick={onUpgrade} className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 px-3.5 py-2 text-xs font-extrabold text-white hover:opacity-95">
              <Sparkles className="h-3.5 w-3.5 text-amber-300" />Plus 시작하기 · {PLUS_MONTHLY_PRICE}
            </button>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-xl border border-indigo-200/70 bg-indigo-50/80 px-3 py-2 text-xs font-extrabold text-indigo-700">
              <Sparkles className="h-3.5 w-3.5 text-indigo-500" />Plus {PLUS_MONTHLY_PRICE} · 결제 준비 중
            </span>
          ))}
        </div>

        <ul className="mt-3 grid grid-cols-1 gap-1.5 border-t border-slate-200/50 pt-3 text-[11px] text-slate-600 sm:grid-cols-2">
          <li>· AI 종합 진단 {isPlus ? '월 3회' : 'Plus 전용'}</li>
          <li>· AI 1:1 컨설턴트 {isPlus ? '월 30회' : 'Plus 전용'}</li>
          <li>· 영상 문구 AI 초안 {isPlus ? '월 30회' : 'Plus 전용'}</li>
          <li>· 심층 지표(지속률·바이럴·시간대) {isPlus ? '이용 가능' : 'Plus 전용'}</li>
        </ul>
        <p className="mt-2 text-[10px] leading-relaxed text-slate-400">
          참여율·공유율·댓글 비율은 Free에서도 제공합니다. 월 할당량은 매달 1일(KST)에 초기화되며 이월되지 않습니다.
        </p>
      </section>

      {/* 크레딧은 할당량과 별개 잔액이다. 할당량을 다 쓴 뒤에만 차감된다 — 합산해 보여주지 않는다. */}
      <section className="glass-panel rounded-2xl border border-white/70 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-1.5 text-sm font-extrabold text-slate-900">
              <Coins className="h-4 w-4 text-amber-500" />크레딧
            </h3>
            <p className="mt-1.5 text-lg font-extrabold text-slate-900">
              {user.aiCredits.toLocaleString()}<span className="ml-1 text-xs font-bold text-slate-400">크레딧</span>
            </p>
            <p className="mt-0.5 text-[11px] text-slate-500">월 할당량을 다 쓴 뒤에 차감됩니다. 구매 크레딧은 이월됩니다.</p>
          </div>
          {onBuyCredits ? (
            <button type="button" onClick={onBuyCredits} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-extrabold text-slate-700 shadow-2xs hover:bg-slate-50">
              <Coins className="h-3.5 w-3.5 text-amber-500" />크레딧 충전
            </button>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white/70 px-3 py-2 text-xs font-extrabold text-slate-400">
              <Coins className="h-3.5 w-3.5 text-slate-300" />크레딧 충전 준비 중
            </span>
          )}
        </div>
        <ul className="mt-3 grid grid-cols-1 gap-1.5 border-t border-slate-200/50 pt-3 text-[11px] text-slate-600 sm:grid-cols-3">
          <li>· AI 종합 진단 <strong className="text-slate-800">5크레딧</strong></li>
          <li>· 컨설턴트 질문 <strong className="text-slate-800">1크레딧</strong></li>
          <li>· 영상 문구 초안 <strong className="text-slate-800">1크레딧</strong></li>
        </ul>
      </section>

      <section className="glass-panel rounded-2xl border border-white/70 p-4 sm:p-5">
        <h3 className="mb-3 text-sm font-extrabold text-slate-900">프로필 이미지</h3>
        <div className="flex items-center gap-4">
          <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-full bg-indigo-600 text-xl font-bold text-white flex items-center justify-center">
            {user.avatarUrl ? <img src={user.avatarUrl} alt="" className="h-full w-full object-cover" /> : (user.name.charAt(0) || 'U')}
            {isUploadingAvatar && <div className="absolute inset-0 flex items-center justify-center bg-slate-900/40"><LoaderCircle className="h-5 w-5 animate-spin text-white" /></div>}
          </div>
          <div>
            <button type="button" onClick={() => fileInputRef.current?.click()} disabled={isUploadingAvatar} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
              <Camera className="h-3.5 w-3.5" />이미지 변경
            </button>
            <p className="mt-1.5 text-[10px] text-slate-400">PNG · JPEG · WebP, 최대 2MB</p>
          </div>
          <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void handleAvatarChange(event)} className="hidden" />
        </div>
        {avatarError && <p role="alert" className="mt-3 flex items-center gap-1.5 text-xs font-medium text-rose-600"><AlertCircle className="h-3.5 w-3.5 shrink-0" />{avatarError}</p>}
      </section>

      <section className="glass-panel rounded-2xl border border-white/70 p-4 sm:p-5">
        <h3 className="mb-3 text-sm font-extrabold text-slate-900">표시 이름</h3>
        <form onSubmit={saveName} className="flex flex-col gap-2.5 sm:flex-row">
          <input
            type="text"
            value={name}
            onChange={(event) => { setName(event.target.value); setNameMessage(null); setNameError(null); }}
            maxLength={100}
            className="glass-input flex-1 rounded-xl px-3.5 py-2.5 text-sm font-medium text-slate-900"
          />
          <button type="submit" disabled={isSavingName || !name.trim() || name.trim() === user.name} className="shrink-0 rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-50">
            {isSavingName ? '저장 중...' : '저장'}
          </button>
        </form>
        {nameMessage && <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-emerald-600"><CheckCircle2 className="h-3.5 w-3.5 shrink-0" />{nameMessage}</p>}
        {nameError && <p role="alert" className="mt-2 flex items-center gap-1.5 text-xs font-medium text-rose-600"><AlertCircle className="h-3.5 w-3.5 shrink-0" />{nameError}</p>}
      </section>

      <section className="glass-panel rounded-2xl border border-rose-100 p-4 sm:p-5">
        <h3 className="flex items-center gap-1.5 text-sm font-extrabold text-rose-700"><AlertTriangle className="h-4 w-4" />회원탈퇴</h3>
        <p className="mt-2 text-xs leading-5 text-slate-500">
          탈퇴하면 이 계정으로는 다시 로그인하거나 재가입할 수 없습니다. 연결된 YouTube 등 SNS 인증 정보는 즉시 삭제되며, 이후 복구할 수 없습니다.
        </p>
        {!isDeleteConfirmOpen ? (
          <button type="button" onClick={openDeleteConfirm} className="mt-3 rounded-xl border border-rose-200 bg-white px-3.5 py-2 text-xs font-bold text-rose-600 hover:bg-rose-50">
            회원탈퇴
          </button>
        ) : (
          <div className="mt-3 space-y-3 rounded-xl border border-rose-200 bg-rose-50/70 p-3.5">
            <p className="text-xs font-bold text-rose-800">정말 탈퇴하시겠습니까? 이 작업은 되돌릴 수 없습니다.</p>
            <ul className="list-disc space-y-0.5 pl-4 text-[11px] text-rose-700">
              <li>로그인이 영구적으로 차단됩니다.</li>
              <li>연결된 SNS 인증 정보와 수집된 데이터가 즉시 삭제됩니다.</li>
              <li>같은 이메일로 다시 가입할 수 없습니다.</li>
            </ul>
            {deleteError && <p role="alert" className="flex items-center gap-1.5 text-xs font-medium text-rose-700"><AlertCircle className="h-3.5 w-3.5 shrink-0" />{deleteError}</p>}
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setIsDeleteConfirmOpen(false)} disabled={isDeleting} className="rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50">
                취소
              </button>
              <button type="button" onClick={() => void confirmDelete()} disabled={!isDeleteReady || isDeleting} className="rounded-xl bg-rose-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-rose-700 disabled:opacity-50">
                {isDeleting ? '처리 중...' : '네, 탈퇴합니다'}
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
