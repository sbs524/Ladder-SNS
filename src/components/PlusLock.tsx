import React from 'react';
import { Lock, Sparkles } from 'lucide-react';

/**
 * Paywall overlay for Plus-only content.
 *
 * The blurred layer is a placeholder pattern, not real data — the server never sends Plus values
 * to a free plan (see src/server/insights.ts). So this is presentation only: if the blur failed
 * there would be nothing behind it to read.
 *
 * Placeholder glyphs rather than plausible numbers, deliberately. Blurring a made-up "72.4%" is
 * how the mock data problem started.
 */

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
};

export function PlusLock({ children, title, description, onUpgrade, compact = false }: PlusLockProps) {
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

        {onUpgrade ? (
          <button
            onClick={onUpgrade}
            className="inline-flex items-center gap-1 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 px-3 py-1 text-[11px] font-extrabold text-white shadow-xs transition-opacity hover:opacity-95"
          >
            <Sparkles className="h-3 w-3 text-amber-300" />
            <span>Plus 시작하기 · 월 14,900원</span>
          </button>
        ) : (
          // 결제 플로우가 아직 없으므로 누르면 아무 일도 안 일어나는 버튼을 만들지 않는다.
          // Phase 4에서 onUpgrade를 넘기면 그때 버튼으로 바뀐다.
          <span className="inline-flex items-center gap-1 rounded-xl border border-indigo-200/70 bg-indigo-50/80 px-2.5 py-1 text-[11px] font-extrabold text-indigo-700">
            <Sparkles className="h-3 w-3 text-indigo-500" />
            <span>Plus · 월 14,900원</span>
          </span>
        )}
      </div>
    </div>
  );
}
