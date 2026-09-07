import assert from "node:assert/strict";
import test from "node:test";
import { contentTypeForVideo, makeCursor, parseCursor, parseDurationSeconds, pickVideoMetricColumns, readJobCursor, stableHash } from "./youtube";

test("parseDurationSeconds reads ISO 8601 durations and rejects garbage", () => {
  assert.equal(parseDurationSeconds("PT1H2M3S"), 3723);
  assert.equal(parseDurationSeconds("PT45S"), 45);
  assert.equal(parseDurationSeconds("PT2M"), 120);
  assert.equal(parseDurationSeconds(undefined), null);
  assert.equal(parseDurationSeconds("not a duration"), null);
});

test("contentTypeForVideo classifies live broadcasts, Shorts, and regular videos", () => {
  assert.equal(contentTypeForVideo({ id: "a", snippet: { liveBroadcastContent: "live" } }), "live");
  assert.equal(contentTypeForVideo({ id: "b", liveStreamingDetails: { actualStartTime: "2026-01-01T00:00:00Z" } }), "live");
  assert.equal(contentTypeForVideo({ id: "c", contentDetails: { duration: "PT59S" } }), "short");
  assert.equal(contentTypeForVideo({ id: "d", contentDetails: { duration: "PT61S" } }), "video");
  // 길이 정보가 없으면 숏폼으로 오분류하지 않는다.
  assert.equal(contentTypeForVideo({ id: "e" }), "video");
});

test("parseCursor/makeCursor round-trip a valid comment cursor and reject malformed input", () => {
  const row = { source_published_at: "2026-09-01T00:00:00Z", social_comment_id: "12345678-1234-1234-1234-123456789012" };
  const cursor = makeCursor(row);
  assert.ok(cursor);
  const parsed = parseCursor(cursor);
  assert.deepEqual(parsed, { at: row.source_published_at, id: row.social_comment_id });

  assert.equal(makeCursor({ source_published_at: null, social_comment_id: row.social_comment_id }), null);
  assert.equal(parseCursor(null), null);
  assert.equal(parseCursor(""), null);
  assert.equal(parseCursor(Buffer.from(JSON.stringify({ at: "not-a-date", id: row.social_comment_id })).toString("base64url")), null);
  assert.equal(parseCursor(Buffer.from(JSON.stringify({ at: row.source_published_at, id: "not-a-uuid" })).toString("base64url")), null);
});

test("readJobCursor only accepts a well-formed page_token payload", () => {
  assert.deepEqual(readJobCursor(null), {});
  assert.deepEqual(readJobCursor("not json"), {});
  assert.deepEqual(readJobCursor(JSON.stringify({ page_token: "abc" })), { page_token: "abc" });
  assert.deepEqual(readJobCursor(JSON.stringify({ page_token: 123 })), {});
});

test("stableHash is order-independent and changes when values change", () => {
  const a = stableHash({ country: "KR", views: 10 });
  const b = stableHash({ views: 10, country: "KR" });
  const c = stableHash({ country: "US", views: 10 });
  assert.equal(a, b);
  assert.notEqual(a, c);
});

test("pickVideoMetricColumns keeps only Analytics fields that youtube_video_daily_metrics has columns for", () => {
  const picked = pickVideoMetricColumns({
    views: 100,
    shares: 5,
    likes: 20,
    // 채널 단위에서만 존재하는 지표는 영상 테이블에 컬럼이 없으므로 버려져야 한다.
    subscribersGained: 3,
    cpm: 1.5,
  });
  assert.deepEqual(picked, { views: 100, shares: 5, likes: 20 });
});

test("pickVideoMetricColumns skips fields the Analytics response omitted", () => {
  assert.deepEqual(pickVideoMetricColumns({ views: 10 }), { views: 10 });
  assert.deepEqual(pickVideoMetricColumns({}), {});
});
