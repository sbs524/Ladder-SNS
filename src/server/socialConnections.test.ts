import assert from "node:assert/strict";
import test from "node:test";
import { needsRefresh, REFRESH_SKEW_MS } from "./socialConnections";

const NOW = Date.parse("2026-09-01T12:00:00.000Z");
const iso = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();

test("needsRefresh keeps a token that outlives the skew window", () => {
  assert.equal(needsRefresh(iso(REFRESH_SKEW_MS + 60_000), true, NOW), false);
});

test("needsRefresh renews before expiry, not at it", () => {
  // 만료 직전에 쓰면 요청이 왕복하는 사이에 만료된다.
  assert.equal(needsRefresh(iso(REFRESH_SKEW_MS - 1), true, NOW), true);
  assert.equal(needsRefresh(iso(0), true, NOW), true);
  assert.equal(needsRefresh(iso(-60_000), true, NOW), true);
});

test("needsRefresh treats unknown or missing credentials as stale", () => {
  assert.equal(needsRefresh(null, true, NOW), true);
  assert.equal(needsRefresh("not-a-date", true, NOW), true);
  assert.equal(needsRefresh(iso(86_400_000), false, NOW), true);
});
