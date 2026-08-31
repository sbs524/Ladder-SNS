import type { BillingPlan } from "./auth";
import { ApiError, getAdminClient } from "./supabaseAdmin";

// 요금제별 월 AI 사용량 상한과 크레딧 차감 — docs/과금_및_지표_정의.md §1~2.
//
// Free가 0인 이유: AI 종합 진단·1:1 컨설턴트·영상 문구 초안은 Plus 전용 기능이다
// (src/server/ai.ts의 requirePlusUser가 403으로 막는다). 기능 자체가 잠겨 있으므로 한도는 0이다.
//
// ※ 문서 §2는 "Free 플랜도 크레딧을 살 수 있다"고 적고 있지만 지금 구현은 Plus 전용이다.
//    Free에 크레딧 판매를 열려면 requirePlusUser부터 바꿔야 한다.

export type UsageAction = "report" | "advisor" | "draft";

/**
 * 월 할당량. Plus ₩4,900 기준으로 100% 소진 시 AI 원가는
 * 리포트 3×29 + 질문 30×7 + 초안 30×7 = 507원 → 매출의 약 10%.
 * (₩14,900 시절의 10/30/150 조합이 12%였다. 가격을 1/3로 내리면서 한도도 같이 내렸다.)
 */
export const MONTHLY_LIMITS: Record<UsageAction, Record<BillingPlan, number>> = {
  report: { free: 0, plus: 3 },
  advisor: { free: 0, plus: 30 },
  draft: { free: 0, plus: 30 },
};

/** 할당량을 다 쓴 뒤 1회당 차감할 크레딧 — 문서 §2의 확정 표(1 크레딧 ≈ 100원). */
export const CREDIT_COSTS: Record<UsageAction, number> = {
  report: 5,
  advisor: 1,
  draft: 1,
};

// 연동 채널 수 상한 — docs/과금_및_지표_정의.md §6.
//
// 기획 문서가 "요금제에서 제일 중요한 줄"이라고 못박은 값이다. AI 원가는 사용량에 비례해
// 저렴하지만 YouTube Data API는 일 10,000 units 고정 상한이고 돈으로 늘릴 수 없다.
// 늘어나는 축이 연동 채널 수라서, 여기가 실제로 서비스를 지키는 제한이다.
export const CHANNEL_LIMITS: Record<BillingPlan, number> = { free: 2, plus: 5 };

const ACTION_LABELS: Record<UsageAction, string> = {
  report: "AI 종합 진단",
  advisor: "AI 1:1 컨설턴트 질문",
  draft: "영상 문구 AI 초안",
};

// 한국 사용자 기준 서비스라 "이번 달"은 KST 달력 기준이다. UTC로 세면 매월 1일 오전 9시
// 이전 호출이 지난달로 잡힌다.
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** KST 기준 이번 달 1일 00:00을 UTC ISO 문자열로 돌려준다. */
export function kstMonthStartIso(now: Date = new Date()): string {
  const kst = new Date(now.getTime() + KST_OFFSET_MS);
  const startKst = Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), 1, 0, 0, 0, 0);
  return new Date(startKst - KST_OFFSET_MS).toISOString();
}

export type UsageStatus = {
  used: number;
  limit: number;
  /** 이번 달 남은 할당량. 크레딧과 합산하지 않는다 — 이월 여부가 다른 별도 잔액이다. */
  remaining: number;
  credits: number;
  /** 할당량을 다 썼을 때 1회당 차감될 크레딧 수. */
  creditCost: number;
};

async function readCredits(profileId: string): Promise<number> {
  const { data, error } = await getAdminClient()
    .from("profiles")
    .select("ai_credits")
    .eq("profile_id", profileId)
    .maybeSingle();
  if (error) throw error;
  return data?.ai_credits ?? 0;
}

export async function getUsage(profileId: string, action: UsageAction, plan: BillingPlan): Promise<UsageStatus> {
  const limit = MONTHLY_LIMITS[action][plan];
  const [countResult, credits] = await Promise.all([
    getAdminClient()
      .from("ai_usage_events")
      .select("ai_usage_event_id", { count: "exact", head: true })
      .eq("profile_id", profileId)
      .eq("action", action)
      .gte("created_at", kstMonthStartIso()),
    readCredits(profileId),
  ]);
  if (countResult.error) throw countResult.error;
  const used = countResult.count ?? 0;
  return { used, limit, remaining: Math.max(0, limit - used), credits, creditCost: CREDIT_COSTS[action] };
}

/** 이 호출을 무엇으로 처리할지. quota는 차감 없음, credits는 성공 후 CREDIT_COSTS만큼 차감. */
export type AiCallPlan = { source: "quota" | "credits"; usage: UsageStatus };

/**
 * 할당량 → 크레딧 → 402 순서로 확인한다 (문서 §2 차감 규칙).
 *
 * 할당량을 먼저 쓰는 이유: 할당량은 이월되지 않고 크레딧은 이월된다. 사용자에게 유리한 순서다.
 */
export async function planAiCall(profileId: string, action: UsageAction, plan: BillingPlan): Promise<AiCallPlan> {
  const usage = await getUsage(profileId, action, plan);
  if (usage.remaining > 0) return { source: "quota", usage };
  if (usage.credits >= usage.creditCost) return { source: "credits", usage };
  throw new ApiError(
    402,
    "INSUFFICIENT_CREDITS",
    usage.limit > 0
      ? `이번 달 ${ACTION_LABELS[action]} 할당량 ${usage.limit}회를 모두 사용했습니다. 크레딧을 충전하면 계속 사용할 수 있습니다. (필요 ${usage.creditCost}크레딧 · 보유 ${usage.credits}크레딧)`
      : `${ACTION_LABELS[action]}에는 크레딧이 필요합니다. (필요 ${usage.creditCost}크레딧 · 보유 ${usage.credits}크레딧)`,
  );
}

/**
 * 성공한 호출만 기록하고, 크레딧으로 처리된 건이면 그때 차감한다.
 *
 * 차감은 조건부 update 한 방(spend_ai_credits)이라 동시 요청에도 잔액이 음수가 되지 않는다.
 * 다만 planAiCall과 차감 사이에 잔액이 빠져나가면 이미 만들어준 답변에 대해 차감이 실패할 수
 * 있다. 그 손해는 건당 29원 이하라 답변을 회수하지 않고 로그만 남긴다 — 문서 §2가 MVP에서
 * 홀드/커밋 2단계를 쓰지 않기로 한 것과 같은 판단이다.
 */
export async function recordUsage(
  profileId: string,
  action: UsageAction,
  model: string,
  source: "quota" | "credits",
): Promise<void> {
  const db = getAdminClient();
  const creditsSpent = source === "credits" ? CREDIT_COSTS[action] : 0;

  if (creditsSpent > 0) {
    const { data, error } = await db.rpc("spend_ai_credits", { target_profile_id: profileId, amount: creditsSpent });
    if (error) console.error("Failed to spend AI credits:", error);
    else if (data === null) console.error(`AI credit balance changed before deduction (profile ${profileId}, action ${action}).`);
  }

  const { error } = await db
    .from("ai_usage_events")
    .insert({ profile_id: profileId, action, model, credits_spent: creditsSpent });
  // 기록 실패가 이미 만들어준 답변을 취소할 이유는 안 된다. 로그만 남긴다.
  if (error) console.error("Failed to record AI usage:", error);
}
