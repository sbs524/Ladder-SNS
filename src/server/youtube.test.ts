import assert from "node:assert/strict";
import test from "node:test";
import { asBigint, classifyGoogleError, commentPayload, contentTypeForVideo, hasWriteScope, makeCursor, parseCursor, parseDurationSeconds, parseGoogleErrorReason, pickVideoMetricColumns, readJobCursor, requireWriteScope, stableHash, syncRetryDelayMs } from "./youtube";
import { ApiError } from "./supabaseAdmin";

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

test("parseGoogleErrorReason extracts the first error reason, tolerating malformed bodies", () => {
  assert.equal(parseGoogleErrorReason(JSON.stringify({ error: { errors: [{ reason: "quotaExceeded" }] } })), "quotaExceeded");
  assert.equal(parseGoogleErrorReason("not json"), null);
  assert.equal(parseGoogleErrorReason(JSON.stringify({ error: {} })), null);
  assert.equal(parseGoogleErrorReason(""), null);
});

test("classifyGoogleError distinguishes daily quota exhaustion from transient rate limiting", () => {
  const quota = classifyGoogleError(403, JSON.stringify({ error: { errors: [{ reason: "quotaExceeded" }] } }), "quota");
  assert.equal(quota.code, "GOOGLE_QUOTA_EXCEEDED");
  assert.equal(quota.status, 429);

  const dailyLimit = classifyGoogleError(403, JSON.stringify({ error: { errors: [{ reason: "dailyLimitExceeded" }] } }), "quota");
  assert.equal(dailyLimit.code, "GOOGLE_QUOTA_EXCEEDED");

  const burstLimit = classifyGoogleError(403, JSON.stringify({ error: { errors: [{ reason: "userRateLimitExceeded" }] } }), "burst");
  assert.equal(burstLimit.code, "GOOGLE_RATE_LIMITED");

  const plain429 = classifyGoogleError(429, "", "rate limited");
  assert.equal(plain429.code, "GOOGLE_RATE_LIMITED");

  const notFound = classifyGoogleError(404, "", "gone");
  assert.equal(notFound.code, "GOOGLE_NOT_FOUND");
  assert.equal(notFound.status, 404);

  const unauthorized = classifyGoogleError(401, "", "bad token");
  assert.equal(unauthorized.code, "GOOGLE_API_FAILED");
  assert.equal(unauthorized.status, 401);

  const serverError = classifyGoogleError(503, "", "down");
  assert.equal(serverError.code, "GOOGLE_API_TRANSIENT");
  assert.equal(serverError.status, 502);

  const other = classifyGoogleError(400, "", "bad request");
  assert.equal(other.code, "GOOGLE_API_FAILED");
});

test("syncRetryDelayMs waits hours for daily quota but backs off in minutes for transient errors", () => {
  assert.equal(syncRetryDelayMs("GOOGLE_QUOTA_EXCEEDED", 1), 6 * 60 * 60 * 1000);
  assert.equal(syncRetryDelayMs("GOOGLE_QUOTA_EXCEEDED", 4), 6 * 60 * 60 * 1000);
  assert.equal(syncRetryDelayMs("GOOGLE_RATE_LIMITED", 1), 60_000);
  assert.equal(syncRetryDelayMs("GOOGLE_RATE_LIMITED", 2), 120_000);
  assert.equal(syncRetryDelayMs("GOOGLE_API_TRANSIENT", 3), 240_000);
  // 지수 백오프가 상한(30분)을 넘지 않는다.
  assert.equal(syncRetryDelayMs("GOOGLE_API_TRANSIENT", 20), 30 * 60_000);
});

const baseGrant = {
  platform_oauth_grant_id: "11111111-1111-1111-1111-111111111111",
  profile_id: "22222222-2222-2222-2222-222222222222",
  platform: "youtube" as const,
  provider: "google",
  provider_subject: "subject",
  access_token_ciphertext: null,
  refresh_token_ciphertext: null,
  access_token_expires_at: null,
  status: "active" as const,
};

test("hasWriteScope only recognizes the force-ssl scope, not the plain readonly one", () => {
  assert.equal(hasWriteScope(["https://www.googleapis.com/auth/youtube.force-ssl"]), true);
  assert.equal(hasWriteScope(["https://www.googleapis.com/auth/youtube.readonly"]), false);
  assert.equal(hasWriteScope(null), false);
  assert.equal(hasWriteScope([]), false);
});

test("requireWriteScope blocks channels connected before the write scope existed", () => {
  assert.throws(
    () => requireWriteScope({ ...baseGrant, granted_scopes: ["https://www.googleapis.com/auth/youtube.readonly"] }),
    (error: unknown) => error instanceof ApiError && error.code === "YOUTUBE_SCOPE_INSUFFICIENT" && error.status === 403,
  );
  assert.doesNotThrow(() => requireWriteScope({ ...baseGrant, granted_scopes: ["https://www.googleapis.com/auth/youtube.force-ssl"] }));
});

test("asBigint accepts non-negative safe integers (including numeric strings) and rejects the rest", () => {
  assert.equal(asBigint("12345"), 12345);
  assert.equal(asBigint(42), 42);
  assert.equal(asBigint(-1), null);
  assert.equal(asBigint("not a number"), null);
  assert.equal(asBigint(null), null);
  assert.equal(asBigint(Number.MAX_SAFE_INTEGER + 1), null);
});

const baseChannel = {
  social_channel_id: "33333333-3333-3333-3333-333333333333",
  profile_id: "22222222-2222-2222-2222-222222222222",
  platform_oauth_grant_id: "11111111-1111-1111-1111-111111111111",
  platform: "youtube" as const,
  external_channel_id: "UC_channel",
  handle: null,
  display_name: "Test Channel",
  avatar_url: null,
  is_dashboard_enabled: true,
  status: "active",
};

test("commentPayload marks a top-level comment vs. a reply, and resolves its social_content_id from the video id map", () => {
  const contentIds = new Map([["video-1", "44444444-4444-4444-4444-444444444444"]]);
  const topLevel = commentPayload({ id: "c1", snippet: { videoId: "video-1", textOriginal: "hi", publishedAt: "2026-09-01T00:00:00Z" } }, baseChannel, contentIds);
  assert.equal(topLevel.comment_kind, "comment");
  assert.equal(topLevel.parent_social_comment_id, null);
  assert.equal(topLevel.external_thread_id, "c1");
  assert.equal(topLevel.social_content_id, "44444444-4444-4444-4444-444444444444");

  const reply = commentPayload({ id: "c2", snippet: { videoId: "video-1", textOriginal: "reply" } }, baseChannel, contentIds, "44444444-4444-4444-4444-444444444444");
  assert.equal(reply.comment_kind, "reply");
  assert.equal(reply.parent_social_comment_id, "44444444-4444-4444-4444-444444444444");
  assert.equal(reply.external_thread_id, "44444444-4444-4444-4444-444444444444");
});

test("commentPayload leaves social_content_id null when the comment's video was never synced", () => {
  const payload = commentPayload({ id: "c3", snippet: { videoId: "unknown-video" } }, baseChannel, new Map());
  assert.equal(payload.social_content_id, null);
});
