import assert from "node:assert/strict";
import test from "node:test";
import { CHANNEL_LIMITS, CREDIT_COSTS, MONTHLY_LIMITS, kstMonthStartIso } from "./usage";

// 월 경계가 틀리면 매월 1일 아침 9시간 동안 사용량이 지난달로 새거나, 지난달 마지막 날
// 저녁 호출이 이번 달로 넘어온다. 요금제 한도가 그만큼 헐거워진다.

test("kstMonthStartIso returns the KST month start expressed in UTC", () => {
  // 2026-08-31 15:00 UTC = 2026-09-01 00:00 KST → 9월이 막 시작된 시점
  assert.equal(kstMonthStartIso(new Date("2026-08-31T15:00:00Z")), "2026-08-31T15:00:00.000Z");
});

test("kstMonthStartIso keeps the last KST evening of a month in that month", () => {
  // 2026-08-31 14:59 UTC = 2026-08-31 23:59 KST → 아직 8월
  assert.equal(kstMonthStartIso(new Date("2026-08-31T14:59:00Z")), "2026-07-31T15:00:00.000Z");
});

test("kstMonthStartIso keeps the first KST morning of a month in the new month", () => {
  // 2026-09-01 03:00 UTC = 2026-09-01 12:00 KST. UTC 기준으로 세면 9월 1일이지만
  // 경계는 KST 자정이어야 하므로 8/31 15:00Z가 나와야 한다.
  assert.equal(kstMonthStartIso(new Date("2026-09-01T03:00:00Z")), "2026-08-31T15:00:00.000Z");
});

test("free plan has no AI allowance because the features are Plus-only", () => {
  assert.equal(MONTHLY_LIMITS.report.free, 0);
  assert.equal(MONTHLY_LIMITS.advisor.free, 0);
});

test("plus limits match the ₩4,900 plan", () => {
  assert.equal(MONTHLY_LIMITS.report.plus, 3);
  assert.equal(MONTHLY_LIMITS.advisor.plus, 30);
  assert.equal(MONTHLY_LIMITS.draft.plus, 30);
  assert.equal(CHANNEL_LIMITS.free, 2);
  assert.equal(CHANNEL_LIMITS.plus, 5);
});

// 가격을 내릴 때 한도를 같이 내리지 않으면 원가 비율이 조용히 3배가 된다.
// 이 테스트는 그 계산을 코드에 붙들어 둔다 — 원가는 docs/과금_및_지표_정의.md §1.
test("plus monthly allowance stays around a tenth of the ₩4,900 price", () => {
  const unitCostWon = { report: 29, advisor: 7, draft: 7 };
  const monthlyCost =
    MONTHLY_LIMITS.report.plus * unitCostWon.report +
    MONTHLY_LIMITS.advisor.plus * unitCostWon.advisor +
    MONTHLY_LIMITS.draft.plus * unitCostWon.draft;
  assert.equal(monthlyCost, 507);
  assert.ok(monthlyCost / 4900 < 0.12, `AI 원가가 매출의 12%를 넘습니다: ${monthlyCost}원`);
});

test("credit costs match the pricing doc (1 credit ≈ 100 KRW)", () => {
  assert.equal(CREDIT_COSTS.report, 5);
  assert.equal(CREDIT_COSTS.advisor, 1);
  assert.equal(CREDIT_COSTS.draft, 1);
  // 크레딧 1개 100원 기준으로 원가보다 확실히 위여야 한다.
  assert.ok(CREDIT_COSTS.report * 100 > 29);
  assert.ok(CREDIT_COSTS.advisor * 100 > 7);
});
