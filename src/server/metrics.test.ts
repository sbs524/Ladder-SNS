import assert from "node:assert/strict";
import test from "node:test";
import { dayOffset, emptyTotals, engagementRate, median, num, percentChange, subscriberConversionRate, utcDayString } from "./metrics";

test("num coerces PostgREST bigint strings and rejects garbage", () => {
  assert.equal(num("33430"), 33430);
  assert.equal(num(175), 175);
  assert.equal(num(null), 0);
  assert.equal(num(undefined), 0);
  assert.equal(num("not a number"), 0);
});

test("percentChange reports null when there is no baseline to compare against", () => {
  assert.equal(percentChange(120, 100), 20);
  assert.equal(percentChange(80, 100), -20);
  assert.equal(percentChange(100, 0), null);
  assert.equal(percentChange(0, 0), null);
});

test("engagementRate is reactions per view, and safe on zero views", () => {
  const totals = { ...emptyTotals(), views: 1000, likes: 50, comments: 20, shares: 30 };
  assert.equal(engagementRate(totals), 10);
  assert.equal(engagementRate(emptyTotals()), 0);
});

test("utcDayString walks back whole days in ISO date form", () => {
  assert.match(utcDayString(0), /^\d{4}-\d{2}-\d{2}$/);
  const today = new Date(utcDayString(0));
  const weekAgo = new Date(utcDayString(7));
  assert.equal((today.getTime() - weekAgo.getTime()) / 86_400_000, 7);
});

test("subscriberConversionRate counts subscribers gained per view, ignoring churn", () => {
  const totals = { ...emptyTotals(), views: 10_000, subscribersGained: 250, subscribersLost: 900 };
  // 이탈이 획득보다 커도 전환율은 획득만 본다 — 이탈은 과거 영상에서도 발생하기 때문.
  assert.equal(subscriberConversionRate(totals), 2.5);
  assert.equal(subscriberConversionRate({ ...emptyTotals(), subscribersGained: 5 }), null);
});

test("median averages the middle pair on even samples and survives an empty set", () => {
  assert.equal(median([5, 1, 3]), 3);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([]), 0);
  // 한 편의 대박이 중앙값을 끌고 가지 않아야 배지가 의미를 가진다.
  assert.equal(median([10, 12, 11, 9, 100_000]), 11);
});

test("dayOffset closes the initial-performance window on the publish day itself", () => {
  assert.equal(dayOffset("2026-08-30", 2), "2026-09-01"); // 발행일 포함 3일
  assert.equal(dayOffset("2026-12-31", 1), "2027-01-01");
});
