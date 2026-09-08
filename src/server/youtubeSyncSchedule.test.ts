import assert from "node:assert/strict";
import test from "node:test";
import { channelsNeedingRefresh } from "./youtube";

const STALE_BEFORE = "2026-09-08T00:00:00.000Z";
const latest = (status: string, created_at: string) => ({ status, created_at });

test("한 번도 동기화하지 않은 채널은 바로 큐에 들어간다", () => {
  assert.deepEqual(channelsNeedingRefresh(["a"], new Map(), STALE_BEFORE), ["a"]);
});

test("이미 큐에 있거나 돌고 있는 채널은 중복으로 넣지 않는다", () => {
  const jobs = new Map([
    ["a", latest("queued", "2026-09-01T00:00:00.000Z")],
    ["b", latest("running", "2026-09-01T00:00:00.000Z")],
  ]);
  assert.deepEqual(channelsNeedingRefresh(["a", "b"], jobs, STALE_BEFORE), []);
});

test("갱신 주기가 지난 채널만 다시 넣는다", () => {
  const jobs = new Map([
    ["old", latest("succeeded", "2026-09-07T00:00:00.000Z")],
    ["fresh", latest("succeeded", "2026-09-08T06:00:00.000Z")],
  ]);
  assert.deepEqual(channelsNeedingRefresh(["old", "fresh"], jobs, STALE_BEFORE), ["old"]);
});

test("실패한 채널도 같은 주기로 물러난다 — 5초마다 구글을 두드리지 않는다", () => {
  const jobs = new Map([["a", latest("failed", "2026-09-08T06:00:00.000Z")]]);
  assert.deepEqual(channelsNeedingRefresh(["a"], jobs, STALE_BEFORE), []);
  const stale = new Map([["a", latest("failed", "2026-09-06T00:00:00.000Z")]]);
  assert.deepEqual(channelsNeedingRefresh(["a"], stale, STALE_BEFORE), ["a"]);
});
