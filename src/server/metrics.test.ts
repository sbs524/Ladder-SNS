import assert from "node:assert/strict";
import test from "node:test";
import { emptyTotals, engagementRate, num, percentChange, utcDayString } from "./metrics";

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
