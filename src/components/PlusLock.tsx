import React from 'react';
import { Coins, Lock, Sparkles } from 'lucide-react';

/**
 * Paywall overlay for Plus-only content.
 *
 * The blurred layer is a placeholder pattern, not real data — the server never sends Plus values
 * to a free plan (see src/server/insights.ts). So this is presentation only: if the blur failed
 * there would be nothing behind it to read.
 *
 * Placeholder glyphs rather than plausible numbers, deliberately. Blurring a made-up "72.4%" is
 * how the mock data problem started.
 *
 * 한 화면에 잠긴 패널이 여러 개면 CTA는 하나만 둔다. 패널마다 결제 버튼을 붙이면 화면이
 * 결제 버튼 목록이 된다 — 잠긴 패널은 무엇이 잠겼는지만 말하고(`showCta={false}`),
 * 결제 유도는 화면당 하나의 UpgradeCallout이 맡는다.
 */

export const PLUS_MONTHLY_PRICE = '월 4,900원';

export function LockedValue({ width = 'w-10' }: { width?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block ${width} align-middle select-none rounded bg-slate-300/70 text-transparent blur-[3px]`}
    >
      ██
    </span>
  );
}

type PlusLockProps = {
  /** Placeholder layout rendered underneath the overlay. Never real values. */
  children: React.ReactNode;
  title?: string;
  description?: string;
  onUpgrade?: () => void;
  /** Compact variant for locking a single row rather than a whole panel. */
  compact?: boolean;
  /** 같은 화면에 CTA가 따로 있으면 false. 기본은 true(단독으로 쓰일 때). */
  showCta?: boolean;
};

export function PlusLock({ children, title, description, onUpgrade, compact = false, showCta = true }: PlusLockProps) {
  return (
    <div className="relative overflow-hidden rounded-2xl">
      <div aria-hidden="true" className="pointer-events-none select-none blur-[6px] opacity-60">
        {children}
      </div>

      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-white/45 px-4 text-center backdrop-blur-[2px]">
        <div className="flex items-center gap-1.5 rounded-xl border border-indigo-200/70 bg-white/90 px-2.5 py-1 shadow-2xs">
          <Lock className="h-3 w-3 text-indigo-600" />
          <span className="text-[11px] font-extrabold text-slate-900">{title || 'Plus 전용'}</span>
        </div>

        {!compact && description && (
          <p className="max-w-[260px] text-[11px] leading-relaxed text-slate-600">{description}</p>
        )}

        {showCta &&
          (onUpgrade ? (
            <button
              onClick={onUpgrade}
              className="inline-flex items-center gap-1 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 px-3 py-1 text-[11px] font-extrabold text-white shadow-xs transition-opacity hover:opacity-95"
            >
              <Sparkles className="h-3 w-3 text-amber-300" />
              <span>Plus 시작하기 · {PLUS_MONTHLY_PRICE}</span>
            </button>
          ) : (
            // 결제 플로우가 아직 없으므로 누르면 아무 일도 안 일어나는 버튼을 만들지 않는다.
            <span className="inline-flex items-center gap-1 rounded-xl border border-indigo-200/70 bg-indigo-50/80 px-2.5 py-1 text-[11px] font-extrabold text-indigo-700">
              <Sparkles className="h-3 w-3 text-indigo-500" />
              <span>Plus · {PLUS_MONTHLY_PRICE}</span>
            </span>
          ))}
      </div>
    </div>
  );
}

type UpgradeCalloutProps = {
  title: string;
  description: string;
  onUpgrade?: () => void;
  onBuyCredits?: () => void;
};

/**
 * 잠긴 패널이 여러 개인 화면에서 결제 유도를 담당하는 단 하나의 배너.
 *
 * 구독과 크레딧을 나란히 두는 이유: 월 할당량을 다 쓴 Plus 사용자에게 필요한 건 구독이 아니라
 * 충전이고, 아직 Free인 사용자에게 필요한 건 구독이다. 두 사람이 같은 화면을 본다.
 */
export function UpgradeCallout({ title, description, onUpgrade, onBuyCredits }: UpgradeCalloutProps) {
  return (
    <div className="glass-card rounded-2xl border border-indigo-100/70 bg-gradient-to-r from-indigo-50/80 via-white/70 to-purple-50/80 p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-[180px] flex-1">
          <p className="flex items-center gap-1.5 text-xs font-extrabold text-slate-900">
            <Lock className="h-3.5 w-3.5 text-indigo-600" />
            {title}
          </p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-slate-600">{description}</p>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {onUpgrade ? (
            <button
              onClick={onUpgrade}
              className="inline-flex items-center gap-1 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 px-3 py-1.5 text-[11px] font-extrabold text-white shadow-xs transition-opacity hover:opacity-95"
            >
              <Sparkles className="h-3 w-3 text-amber-300" />
              <span>Plus 시작하기 · {PLUS_MONTHLY_PRICE}</span>
            </button>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-xl border border-indigo-200/70 bg-indigo-50/80 px-2.5 py-1.5 text-[11px] font-extrabold text-indigo-700">
              <Sparkles className="h-3 w-3 text-indigo-500" />
              <span>Plus · {PLUS_MONTHLY_PRICE}</span>
            </span>
          )}

          {onBuyCredits ? (
            <button
              onClick={onBuyCredits}
              className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-extrabold text-slate-700 shadow-2xs transition-colors hover:bg-slate-50"
            >
              <Coins className="h-3 w-3 text-amber-500" />
              <span>크레딧 충전</span>
            </button>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white/70 px-2.5 py-1.5 text-[11px] font-extrabold text-slate-400">
              <Coins className="h-3 w-3 text-slate-300" />
              <span>크레딧 충전 준비 중</span>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
