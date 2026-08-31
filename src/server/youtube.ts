import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Express, Request, Response } from "express";
import { getAppUrl, getAuthenticatedUser, getPlanForProfile } from "./auth";
import { CHANNEL_LIMITS } from "./usage";
import { ApiError, getAdminClient, requireString, toErrorResponse } from "./supabaseAdmin";

type SocialPlatform = "youtube" | "instagram" | "threads" | "x";
type GrantStatus = "active" | "requires_reauth" | "revoked" | "error";
type SyncJobKind = "initial" | "channel" | "content" | "analytics" | "comments" | "live_chat" | "full";
type SyncJobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";
type JsonRecord = Record<string, unknown>;

type OAuthGrant = {
  platform_oauth_grant_id: string;
  profile_id: string;
  platform: SocialPlatform;
  provider: string;
  provider_subject: string;
  access_token_ciphertext: string | null;
  refresh_token_ciphertext: string | null;
  access_token_expires_at: string | null;
  granted_scopes: string[];
  status: GrantStatus;
};

type SocialChannel = {
  social_channel_id: string;
  profile_id: string;
  platform_oauth_grant_id: string | null;
  platform: SocialPlatform;
  external_channel_id: string;
  handle: string | null;
  display_name: string;
  avatar_url: string | null;
  is_dashboard_enabled: boolean;
  status: string;
};

type SyncJob = {
  platform_sync_job_id: string;
  social_channel_id: string;
  social_content_id: string | null;
  job_kind: SyncJobKind;
  status: SyncJobStatus;
  cursor: string | null;
  attempt_count: number;
};

type GoogleChannel = {
  id: string;
  snippet?: {
    title?: string;
    description?: string;
    customUrl?: string;
    publishedAt?: string;
    country?: string;
    defaultLanguage?: string;
    thumbnails?: { default?: { url?: string }; medium?: { url?: string }; high?: { url?: string } };
  };
  contentDetails?: { relatedPlaylists?: { uploads?: string } };
  statistics?: { subscriberCount?: string; viewCount?: string; videoCount?: string };
  status?: { privacyStatus?: string; madeForKids?: boolean; longUploadsStatus?: string };
  brandingSettings?: { channel?: { keywords?: string; defaultLanguage?: string } };
  topicDetails?: JsonRecord;
};

type GoogleVideo = {
  id: string;
  snippet?: {
    title?: string;
    description?: string;
    publishedAt?: string;
    channelId?: string;
    categoryId?: string;
    tags?: string[];
    defaultLanguage?: string;
    defaultAudioLanguage?: string;
    thumbnails?: { default?: { url?: string }; medium?: { url?: string }; high?: { url?: string } };
    liveBroadcastContent?: string;
  };
  contentDetails?: {
    duration?: string;
    caption?: string;
    definition?: string;
    dimension?: string;
    licensedContent?: boolean;
  };
  statistics?: JsonRecord;
  status?: { privacyStatus?: string; madeForKids?: boolean; selfDeclaredMadeForKids?: boolean };
  liveStreamingDetails?: { actualStartTime?: string; actualEndTime?: string; scheduledStartTime?: string; activeLiveChatId?: string };
  topicDetails?: JsonRecord;
};

type GoogleComment = {
  id: string;
  snippet?: {
    channelId?: string;
    videoId?: string;
    textDisplay?: string;
    textOriginal?: string;
    authorDisplayName?: string;
    authorProfileImageUrl?: string;
    authorChannelUrl?: string;
    authorChannelId?: { value?: string };
    likeCount?: number;
    publishedAt?: string;
    updatedAt?: string;
    parentId?: string;
    moderationStatus?: string;
  };
};

type CommentStream = { profileId: string; channelId?: string; response: Response };

const YOUTUBE_STATE_COOKIE = "ladder_youtube_oauth";
const YOUTUBE_CALLBACK_PATH = "/api/connections/youtube/callback";
// A superset of youtube.readonly (read + write) — requesting it lets the app manage videos and
// comments without also requesting the now-redundant readonly scope.
const YOUTUBE_WRITE_SCOPE = "https://www.googleapis.com/auth/youtube.force-ssl";
const DEFAULT_COMMENT_LIMIT = 30;
const MAX_COMMENT_LIMIT = 100;
const SYNC_WINDOW_DAYS = 30;
const activeCommentStreams = new Set<CommentStream>();
let workerTimer: NodeJS.Timeout | null = null;
let workerBusy = false;

function sendError(res: Response, status: number, code: string, message: string) {
  return res.status(status).json({ error: { code, message } });
}

function getGoogleConfig() {
  return {
    clientId: requireString(process.env.GOOGLE_YOUTUBE_CLIENT_ID, "GOOGLE_YOUTUBE_CLIENT_ID"),
    clientSecret: requireString(process.env.GOOGLE_YOUTUBE_CLIENT_SECRET, "GOOGLE_YOUTUBE_CLIENT_SECRET"),
  };
}

function isProduction() {
  return process.env.NODE_ENV === "production";
}

function getCookie(req: Request, name: string) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1));
    } catch {
      return null;
    }
  }
  return null;
}

function callbackUrl() {
  return `${getAppUrl()}${YOUTUBE_CALLBACK_PATH}`;
}

function redirectToApp(res: Response, status: "connected" | "denied" | "error", reason?: string) {
  const url = new URL(getAppUrl());
  url.searchParams.set("youtube", status);
  if (reason) url.searchParams.set("youtube_reason", reason);
  return res.redirect(303, url.toString());
}

function parsePositiveInt(value: unknown, fallback: number, maximum: number) {
  const parsed = typeof value === "string" ? Number.parseInt(value, 10) : Number.NaN;
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
}

function readId(value: unknown) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f-]{27,36}$/i.test(value) ? value : null;
}

function parseCursor(value: unknown): { at: string; id: string } | null {
  if (typeof value !== "string" || !value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as { at?: unknown; id?: unknown };
    if (typeof parsed.at !== "string" || typeof parsed.id !== "string") return null;
    if (Number.isNaN(Date.parse(parsed.at)) || !readId(parsed.id)) return null;
    return { at: parsed.at, id: parsed.id };
  } catch {
    return null;
  }
}

function makeCursor(row: { source_published_at: string | null; social_comment_id: string }) {
  if (!row.source_published_at) return null;
  return Buffer.from(JSON.stringify({ at: row.source_published_at, id: row.social_comment_id })).toString("base64url");
}

function getStateSecret() {
  return requireString(process.env.OAUTH_STATE_SECRET, "OAUTH_STATE_SECRET");
}

function signState(payload: string) {
  return createHmac("sha256", getStateSecret()).update(payload).digest("base64url");
}

function createOAuthState(profileId: string, includeRevenue: boolean) {
  const verifier = randomBytes(48).toString("base64url");
  const state = randomBytes(32).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ profileId, includeRevenue, state, verifier, expiresAt: Date.now() + 10 * 60 * 1000 })).toString("base64url");
  return { state, verifier, cookieValue: `${payload}.${signState(payload)}` };
}

function readOAuthState(req: Request, returnedState: string | null) {
  const value = getCookie(req, YOUTUBE_STATE_COOKIE);
  if (!value) throw new ApiError(401, "YOUTUBE_OAUTH_STATE_MISSING", "The YouTube connection session has expired.");
  const separator = value.lastIndexOf(".");
  if (separator < 0) throw new ApiError(401, "YOUTUBE_OAUTH_STATE_INVALID", "Invalid YouTube connection state.");
  const payload = value.slice(0, separator);
  const signature = value.slice(separator + 1);
  const expected = signState(payload);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) {
    throw new ApiError(401, "YOUTUBE_OAUTH_STATE_INVALID", "Invalid YouTube connection state.");
  }
  let parsed: { profileId?: unknown; includeRevenue?: unknown; state?: unknown; verifier?: unknown; expiresAt?: unknown };
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    throw new ApiError(401, "YOUTUBE_OAUTH_STATE_INVALID", "Invalid YouTube connection state.");
  }
  if (
    typeof parsed.profileId !== "string" ||
    typeof parsed.state !== "string" ||
    typeof parsed.verifier !== "string" ||
    typeof parsed.expiresAt !== "number" ||
    parsed.expiresAt < Date.now() ||
    parsed.state !== returnedState
  ) {
    throw new ApiError(401, "YOUTUBE_OAUTH_STATE_INVALID", "Invalid or expired YouTube connection state.");
  }
  return { profileId: parsed.profileId, verifier: parsed.verifier, includeRevenue: parsed.includeRevenue === true };
}

function clearOAuthState(res: Response) {
  res.clearCookie(YOUTUBE_STATE_COOKIE, { httpOnly: true, secure: isProduction(), sameSite: "lax", path: YOUTUBE_CALLBACK_PATH });
}

function getEncryptionKey() {
  const value = requireString(process.env.OAUTH_TOKEN_ENCRYPTION_KEY, "OAUTH_TOKEN_ENCRYPTION_KEY");
  const key = /^[0-9a-f]{64}$/i.test(value) ? Buffer.from(value, "hex") : Buffer.from(value, "base64");
  if (key.length !== 32) throw new ApiError(503, "YOUTUBE_NOT_CONFIGURED", "OAUTH_TOKEN_ENCRYPTION_KEY must be a 32-byte base64 or 64-character hex key.");
  return key;
}

function encryptToken(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
}

function decryptToken(value: string | null) {
  if (!value) throw new ApiError(401, "YOUTUBE_REAUTH_REQUIRED", "Reconnect YouTube to refresh its access token.");
  const payload = Buffer.from(value, "base64");
  if (payload.length < 29) throw new ApiError(503, "YOUTUBE_TOKEN_INVALID", "Stored YouTube credentials are invalid.");
  const decipher = createDecipheriv("aes-256-gcm", getEncryptionKey(), payload.subarray(0, 12));
  decipher.setAuthTag(payload.subarray(12, 28));
  return Buffer.concat([decipher.update(payload.subarray(28)), decipher.final()]).toString("utf8");
}

function encodeCiphertext(value: Buffer) {
  return value.toString("base64");
}

function pkceChallenge(verifier: string) {
  return createHash("sha256").update(verifier).digest("base64url");
}

async function googleJson<T>(url: URL | string, accessToken?: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...(init?.headers || {}),
    },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const message = body.slice(0, 300) || `Google API returned ${response.status}.`;
    throw new ApiError(response.status === 401 ? 401 : 502, "GOOGLE_API_FAILED", message);
  }
  // videos.delete, comments.delete, and comments.setModerationStatus all return 204 No Content.
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

async function exchangeGoogleCode(code: string, verifier: string) {
  const { clientId, clientSecret } = getGoogleConfig();
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: callbackUrl(),
    grant_type: "authorization_code",
    code_verifier: verifier,
  });
  return googleJson<{ access_token: string; refresh_token?: string; expires_in?: number; scope?: string }>("https://oauth2.googleapis.com/token", undefined, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
}

async function getGoogleSubject(accessToken: string) {
  const user = await googleJson<{ sub?: string }>("https://openidconnect.googleapis.com/v1/userinfo", accessToken);
  if (!user.sub) throw new ApiError(502, "GOOGLE_SUBJECT_MISSING", "Google did not return an account identifier.");
  return user.sub;
}

async function refreshGrantAccessToken(db: ReturnType<typeof getAdminClient>, grant: OAuthGrant) {
  if (grant.status !== "active") throw new ApiError(401, "YOUTUBE_REAUTH_REQUIRED", "Reconnect YouTube before synchronizing data.");
  const expiresAt = grant.access_token_expires_at ? Date.parse(grant.access_token_expires_at) : 0;
  if (grant.access_token_ciphertext && Number.isFinite(expiresAt) && expiresAt > Date.now() + 60_000) {
    return decryptToken(grant.access_token_ciphertext);
  }
  const { clientId, clientSecret } = getGoogleConfig();
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token",
    refresh_token: decryptToken(grant.refresh_token_ciphertext),
  });
  try {
    const token = await googleJson<{ access_token: string; expires_in?: number }>("https://oauth2.googleapis.com/token", undefined, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const { error } = await db.from("platform_oauth_grants").update({
      access_token_ciphertext: encodeCiphertext(encryptToken(token.access_token)),
      access_token_expires_at: new Date(Date.now() + (token.expires_in || 3600) * 1000).toISOString(),
      last_token_refresh_at: new Date().toISOString(),
      last_error_code: null,
      last_error_at: null,
    }).eq("platform_oauth_grant_id", grant.platform_oauth_grant_id);
    if (error) throw error;
    return token.access_token;
  } catch (error) {
    await db.from("platform_oauth_grants").update({
      status: "requires_reauth",
      last_error_code: "TOKEN_REFRESH_FAILED",
      last_error_at: new Date().toISOString(),
    }).eq("platform_oauth_grant_id", grant.platform_oauth_grant_id);
    throw error instanceof ApiError ? error : new ApiError(401, "YOUTUBE_REAUTH_REQUIRED", "Reconnect YouTube to continue synchronizing data.");
  }
}

async function requireOwnedChannel(db: ReturnType<typeof getAdminClient>, profileId: string, channelId: string) {
  const { data, error } = await db.from("social_channels").select("social_channel_id, profile_id, platform_oauth_grant_id, platform, external_channel_id, handle, display_name, avatar_url, is_dashboard_enabled, status").eq("social_channel_id", channelId).eq("profile_id", profileId).eq("platform", "youtube").maybeSingle();
  if (error) throw error;
  if (!data) throw new ApiError(404, "YOUTUBE_CHANNEL_NOT_FOUND", "The YouTube channel was not found.");
  return data as SocialChannel;
}

async function requireOwnedGrant(db: ReturnType<typeof getAdminClient>, profileId: string, grantId: string) {
  const { data, error } = await db.from("platform_oauth_grants").select("platform_oauth_grant_id, profile_id, platform, provider, provider_subject, access_token_ciphertext, refresh_token_ciphertext, access_token_expires_at, granted_scopes, status").eq("platform_oauth_grant_id", grantId).eq("profile_id", profileId).eq("platform", "youtube").maybeSingle();
  if (error) throw error;
  if (!data) throw new ApiError(404, "YOUTUBE_CONNECTION_NOT_FOUND", "The YouTube connection was not found.");
  return data as OAuthGrant;
}

async function getGrantForChannel(db: ReturnType<typeof getAdminClient>, channel: SocialChannel) {
  if (!channel.platform_oauth_grant_id) throw new ApiError(409, "YOUTUBE_CONNECTION_MISSING", "This channel has no active YouTube connection.");
  return requireOwnedGrant(db, channel.profile_id, channel.platform_oauth_grant_id);
}

function hasWriteScope(scopes: string[] | null | undefined) {
  return Array.isArray(scopes) && scopes.includes(YOUTUBE_WRITE_SCOPE);
}

// Channels connected before the write scope was introduced only granted youtube.readonly — this
// throws until the user reconnects the channel and re-consents to the write scope.
function requireWriteScope(grant: OAuthGrant) {
  if (!hasWriteScope(grant.granted_scopes)) {
    throw new ApiError(403, "YOUTUBE_SCOPE_INSUFFICIENT", "Reconnect this YouTube channel to grant permission to manage videos and comments.");
  }
}

async function requireOwnedVideo(db: ReturnType<typeof getAdminClient>, channelId: string, contentId: string) {
  const { data, error } = await db
    .from("social_contents")
    .select("social_content_id, social_channel_id, external_content_id, title, body_text, youtube_videos(category_external_id, tags, default_language)")
    .eq("social_content_id", contentId)
    .eq("social_channel_id", channelId)
    .eq("platform", "youtube")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new ApiError(404, "YOUTUBE_VIDEO_NOT_FOUND", "The video was not found.");
  return data;
}

async function requireOwnedComment(db: ReturnType<typeof getAdminClient>, channelId: string, commentId: string) {
  const { data, error } = await db
    .from("social_comments")
    .select("social_comment_id, social_channel_id, social_content_id, external_comment_id, comment_kind, parent_social_comment_id")
    .eq("social_comment_id", commentId)
    .eq("social_channel_id", channelId)
    .eq("platform", "youtube")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new ApiError(404, "YOUTUBE_COMMENT_NOT_FOUND", "The comment was not found.");
  return data;
}

// YouTube only supports one level of replies, so replying to a reply must target the reply's
// top-level parent instead. Note: commentPayload()'s external_thread_id is not reusable for this —
// it stores the parent's *internal* social_comment_id on reply rows, not an external YouTube id.
async function resolveGoogleParentCommentId(db: ReturnType<typeof getAdminClient>, comment: { comment_kind: string; external_comment_id: string; parent_social_comment_id: string | null }) {
  if (comment.comment_kind !== "reply" || !comment.parent_social_comment_id) return comment.external_comment_id;
  const { data, error } = await db.from("social_comments").select("external_comment_id").eq("social_comment_id", comment.parent_social_comment_id).maybeSingle();
  if (error) throw error;
  if (!data) throw new ApiError(404, "YOUTUBE_COMMENT_NOT_FOUND", "The parent comment was not found.");
  return data.external_comment_id as string;
}

// Called from account deletion (src/server/auth.ts). Best-effort revokes each grant's token with
// Google before deleting our copy — deleting the local ciphertext alone doesn't invalidate a token
// that's still valid at Google's end. social_channels must be deleted before platform_oauth_grants
// (which is ON DELETE RESTRICT from social_channels) — same ordering as the per-channel disconnect
// route below, generalized to every channel owned by the profile.
export async function deleteAllYoutubeDataForProfile(profileId: string) {
  const db = getAdminClient();
  const { data: grants, error } = await db
    .from("platform_oauth_grants")
    .select("platform_oauth_grant_id, access_token_ciphertext, refresh_token_ciphertext")
    .eq("profile_id", profileId);
  if (error) throw error;

  for (const grant of grants || []) {
    try {
      const ciphertext = grant.refresh_token_ciphertext || grant.access_token_ciphertext;
      if (!ciphertext) continue;
      const token = decryptToken(ciphertext);
      await fetch("https://oauth2.googleapis.com/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token }),
      });
    } catch (revokeError) {
      // Google's revoke endpoint being unreachable, or a stale/corrupt ciphertext, must not block
      // account deletion — this is a best-effort cleanup, not a precondition.
      console.warn(`Failed to revoke Google token for grant ${grant.platform_oauth_grant_id}:`, revokeError instanceof Error ? revokeError.message : revokeError);
    }
  }

  const { error: channelsError } = await db.from("social_channels").delete().eq("profile_id", profileId);
  if (channelsError) throw channelsError;
  const { error: grantsError } = await db.from("platform_oauth_grants").delete().eq("profile_id", profileId);
  if (grantsError) throw grantsError;
}

function asBigint(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function parseDurationSeconds(value: string | undefined) {
  if (!value) return null;
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(value);
  if (!match) return null;
  return Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0);
}

function contentTypeForVideo(video: GoogleVideo) {
  if (video.snippet?.liveBroadcastContent === "live" || video.liveStreamingDetails?.actualStartTime) return "live";
  const duration = parseDurationSeconds(video.contentDetails?.duration);
  return duration !== null && duration <= 60 ? "short" : "video";
}

async function fetchOwnedGoogleChannels(accessToken: string) {
  const url = new URL("https://www.googleapis.com/youtube/v3/channels");
  url.search = new URLSearchParams({ mine: "true", maxResults: "50", part: "snippet,contentDetails,statistics,status,brandingSettings,topicDetails" }).toString();
  const response = await googleJson<{ items?: GoogleChannel[] }>(url, accessToken);
  return response.items || [];
}

async function persistDiscoveredChannels(db: ReturnType<typeof getAdminClient>, profileId: string, grantId: string, channels: GoogleChannel[]) {
  const externalIds = channels.map((channel) => channel.id).filter(Boolean);
  if (externalIds.length === 0) return [] as SocialChannel[];

  // 요금제별 연동 채널 상한. 이미 연결된 채널을 다시 연결(재동의)하는 건 새 채널이 아니므로
  // 세지 않는다 — 스코프 추가를 위한 재연결이 한도에 걸려서는 안 된다.
  const plan = await getPlanForProfile(profileId);
  const channelLimit = CHANNEL_LIMITS[plan];
  const { count: ownedCount, error: ownedError } = await db
    .from("social_channels")
    .select("social_channel_id", { count: "exact", head: true })
    .eq("profile_id", profileId);
  if (ownedError) throw ownedError;
  let owned = ownedCount ?? 0;
  const { data: existingRows, error: existingError } = await db.from("social_channels").select("social_channel_id, profile_id, platform_oauth_grant_id, platform, external_channel_id, handle, display_name, avatar_url, is_dashboard_enabled, status").eq("platform", "youtube").in("external_channel_id", externalIds);
  if (existingError) throw existingError;
  const existingByExternalId = new Map((existingRows || []).map((row) => [row.external_channel_id as string, row as SocialChannel]));
  const saved: SocialChannel[] = [];

  for (const channel of channels) {
    if (!channel.id) continue;
    const existing = existingByExternalId.get(channel.id);
    if (existing && existing.profile_id !== profileId) {
      throw new ApiError(409, "YOUTUBE_CHANNEL_ALREADY_CONNECTED", "One of these YouTube channels is already connected to another Ladder SNS account.");
    }
    if (!existing && owned >= channelLimit) {
      throw new ApiError(
        403,
        "CHANNEL_LIMIT_REACHED",
        `${plan === "plus" ? "Plus" : "Free"} 요금제는 채널을 ${channelLimit}개까지 연동할 수 있습니다.` +
          (plan === "free" ? " Plus로 업그레이드하면 5개까지 연동할 수 있습니다." : ""),
      );
    }
    const snippet = channel.snippet || {};
    const avatarUrl = snippet.thumbnails?.high?.url || snippet.thumbnails?.medium?.url || snippet.thumbnails?.default?.url || null;
    const payload = {
      profile_id: profileId,
      platform_oauth_grant_id: grantId,
      platform: "youtube" as const,
      external_channel_id: channel.id,
      handle: snippet.customUrl || null,
      display_name: snippet.title || channel.id,
      avatar_url: avatarUrl,
      is_dashboard_enabled: true,
      status: "active",
    };
    const result = existing
      ? await db.from("social_channels").update(payload).eq("social_channel_id", existing.social_channel_id).select("social_channel_id, profile_id, platform_oauth_grant_id, platform, external_channel_id, handle, display_name, avatar_url, is_dashboard_enabled, status").single()
      : await db.from("social_channels").insert(payload).select("social_channel_id, profile_id, platform_oauth_grant_id, platform, external_channel_id, handle, display_name, avatar_url, is_dashboard_enabled, status").single();
    if (result.error || !result.data) throw result.error || new Error("Unable to save YouTube channel.");
    const savedChannel = result.data as SocialChannel;
    if (!existing) owned += 1;
    saved.push(savedChannel);
    const profilePayload = {
      social_channel_id: savedChannel.social_channel_id,
      uploads_playlist_external_id: channel.contentDetails?.relatedPlaylists?.uploads || null,
      description: snippet.description || null,
      custom_url: snippet.customUrl || null,
      country_code: snippet.country || null,
      default_language: channel.brandingSettings?.channel?.defaultLanguage || snippet.defaultLanguage || null,
      keywords: channel.brandingSettings?.channel?.keywords || null,
      privacy_status: channel.status?.privacyStatus || null,
      made_for_kids: channel.status?.madeForKids ?? null,
      long_uploads_status: channel.status?.longUploadsStatus || null,
      subscriber_count: asBigint(channel.statistics?.subscriberCount),
      view_count: asBigint(channel.statistics?.viewCount),
      video_count: asBigint(channel.statistics?.videoCount),
      source_metadata: { topic_details: channel.topicDetails || {} },
      source_retrieved_at: new Date().toISOString(),
    };
    const { error: profileError } = await db.from("youtube_channel_profiles").upsert(profilePayload, { onConflict: "social_channel_id" });
    if (profileError) throw profileError;
  }
  return saved;
}

async function queueSyncJob(db: ReturnType<typeof getAdminClient>, channelId: string, kind: SyncJobKind, cursor?: string, contentId?: string | null) {
  const { data, error } = await db.from("platform_sync_jobs").insert({
    social_channel_id: channelId,
    social_content_id: contentId || null,
    job_kind: kind,
    status: "queued",
    cursor: cursor || null,
  }).select("platform_sync_job_id, social_channel_id, social_content_id, job_kind, status, cursor, attempt_count").single();
  if (error || !data) throw error || new Error("Unable to queue a YouTube sync job.");
  return data as SyncJob;
}

async function syncChannelMetadata(db: ReturnType<typeof getAdminClient>, channel: SocialChannel, accessToken: string) {
  const url = new URL("https://www.googleapis.com/youtube/v3/channels");
  url.search = new URLSearchParams({ id: channel.external_channel_id, part: "snippet,contentDetails,statistics,status,brandingSettings,topicDetails" }).toString();
  const response = await googleJson<{ items?: GoogleChannel[] }>(url, accessToken);
  const source = response.items?.[0];
  if (!source) throw new ApiError(404, "YOUTUBE_CHANNEL_GONE", "The connected YouTube channel is no longer available.");
  await persistDiscoveredChannels(db, channel.profile_id, channel.platform_oauth_grant_id || "", [source]);
  return source;
}

async function syncVideoPage(db: ReturnType<typeof getAdminClient>, channel: SocialChannel, accessToken: string, pageToken?: string | null) {
  const { data: channelProfile, error: profileError } = await db.from("youtube_channel_profiles").select("youtube_channel_profile_id, uploads_playlist_external_id").eq("social_channel_id", channel.social_channel_id).maybeSingle();
  if (profileError) throw profileError;
  const uploadsId = channelProfile?.uploads_playlist_external_id as string | null | undefined;
  if (!channelProfile || !uploadsId) return { videos: 0, nextPageToken: null };

  const playlistUrl = new URL("https://www.googleapis.com/youtube/v3/playlistItems");
  const params = new URLSearchParams({ playlistId: uploadsId, maxResults: "50", part: "contentDetails" });
  if (pageToken) params.set("pageToken", pageToken);
  playlistUrl.search = params.toString();
  const playlist = await googleJson<{ items?: Array<{ contentDetails?: { videoId?: string } }>; nextPageToken?: string }>(playlistUrl, accessToken);
  const videoIds = (playlist.items || []).map((item) => item.contentDetails?.videoId).filter((id): id is string => Boolean(id));
  if (videoIds.length === 0) return { videos: 0, nextPageToken: playlist.nextPageToken || null };

  const videosUrl = new URL("https://www.googleapis.com/youtube/v3/videos");
  videosUrl.search = new URLSearchParams({ id: videoIds.join(","), part: "snippet,contentDetails,statistics,status,liveStreamingDetails,topicDetails" }).toString();
  const response = await googleJson<{ items?: GoogleVideo[] }>(videosUrl, accessToken);
  const videos = response.items || [];
  const contentPayloads = videos.map((video) => ({
    social_channel_id: channel.social_channel_id,
    platform: "youtube" as const,
    external_content_id: video.id,
    content_type: contentTypeForVideo(video),
    title: video.snippet?.title || null,
    body_text: video.snippet?.description || null,
    permalink: `https://www.youtube.com/watch?v=${video.id}`,
    thumbnail_url: video.snippet?.thumbnails?.high?.url || video.snippet?.thumbnails?.medium?.url || video.snippet?.thumbnails?.default?.url || null,
    visibility: video.status?.privacyStatus || "unknown",
    source_published_at: video.snippet?.publishedAt || null,
    current_metrics: video.statistics || {},
    source_metadata: { topic_details: video.topicDetails || {} },
    last_synced_at: new Date().toISOString(),
  }));
  const { error: contentsError } = await db.from("social_contents").upsert(contentPayloads, { onConflict: "platform,external_content_id" });
  if (contentsError) throw contentsError;
  const { data: contents, error: contentsSelectError } = await db.from("social_contents").select("social_content_id, external_content_id").eq("platform", "youtube").in("external_content_id", videoIds);
  if (contentsSelectError) throw contentsSelectError;
  const contentIds = new Map((contents || []).map((content) => [content.external_content_id as string, content.social_content_id as string]));
  const videoPayloads = videos.flatMap((video) => {
    const socialContentId = contentIds.get(video.id);
    if (!socialContentId) return [];
    return [{
      social_content_id: socialContentId,
      youtube_channel_profile_id: channelProfile.youtube_channel_profile_id,
      duration_seconds: parseDurationSeconds(video.contentDetails?.duration),
      category_external_id: video.snippet?.categoryId || null,
      tags: video.snippet?.tags || [],
      default_audio_language: video.snippet?.defaultAudioLanguage || null,
      default_language: video.snippet?.defaultLanguage || null,
      caption_status: video.contentDetails?.caption || null,
      definition: video.contentDetails?.definition || null,
      dimension: video.contentDetails?.dimension || null,
      licensed_content: video.contentDetails?.licensedContent ?? null,
      made_for_kids: video.status?.madeForKids ?? null,
      self_declared_made_for_kids: video.status?.selfDeclaredMadeForKids ?? null,
      live_broadcast_content: video.snippet?.liveBroadcastContent || null,
      actual_start_at: video.liveStreamingDetails?.actualStartTime || null,
      actual_end_at: video.liveStreamingDetails?.actualEndTime || null,
      scheduled_start_at: video.liveStreamingDetails?.scheduledStartTime || null,
      active_live_chat_external_id: video.liveStreamingDetails?.activeLiveChatId || null,
      source_metadata: { topic_details: video.topicDetails || {} },
    }];
  });
  if (videoPayloads.length > 0) {
    const { error: videosError } = await db.from("youtube_videos").upsert(videoPayloads, { onConflict: "social_content_id" });
    if (videosError) throw videosError;
  }
  return { videos: videoPayloads.length, nextPageToken: playlist.nextPageToken || null };
}

type AnalyticsResponse = { columnHeaders?: Array<{ name?: string }>; rows?: Array<Array<number | string>> };

async function analyticsRows(accessToken: string, startDate: string, endDate: string, dimensions: string, metrics: string, filters?: string) {
  const url = new URL("https://youtubeanalytics.googleapis.com/v2/reports");
  const params: Record<string, string> = { ids: "channel==MINE", startDate, endDate, dimensions, metrics, maxResults: "200" };
  if (filters) params.filters = filters;
  url.search = new URLSearchParams(params).toString();
  const response = await googleJson<AnalyticsResponse>(url, accessToken);
  const headers = (response.columnHeaders || []).map((header) => header.name || "");
  return (response.rows || []).map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index]])) as JsonRecord);
}

const metricColumnNames: Record<string, string> = {
  views: "views",
  engagedViews: "engaged_views",
  estimatedMinutesWatched: "estimated_minutes_watched",
  averageViewDuration: "average_view_duration_seconds",
  averageViewPercentage: "average_view_percentage",
  likes: "likes",
  dislikes: "dislikes",
  comments: "comments",
  shares: "shares",
  subscribersGained: "subscribers_gained",
  subscribersLost: "subscribers_lost",
  impressions: "impressions",
  impressionsClickThroughRate: "impressions_click_through_rate",
  estimatedRevenue: "estimated_revenue",
  estimatedAdRevenue: "estimated_ad_revenue",
  estimatedRedPartnerRevenue: "estimated_youtube_premium_revenue",
  grossRevenue: "gross_revenue",
  adImpressions: "ad_impressions",
  monetizedPlaybacks: "monetized_playbacks",
  cpm: "cpm",
  playbackBasedCpm: "playback_based_cpm",
};

function stableHash(value: JsonRecord) {
  const ordered = Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)));
  return createHash("sha256").update(JSON.stringify(ordered)).digest("hex");
}

async function syncAnalytics(db: ReturnType<typeof getAdminClient>, channel: SocialChannel, grant: OAuthGrant, accessToken: string) {
  const end = new Date();
  const start = new Date(end.getTime() - (SYNC_WINDOW_DAYS - 1) * 24 * 60 * 60 * 1000);
  const startDate = start.toISOString().slice(0, 10);
  const endDate = end.toISOString().slice(0, 10);
  const baseMetrics = "views,engagedViews,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,likes,dislikes,comments,shares,subscribersGained,subscribersLost,impressions,impressionsClickThroughRate";
  const daily = new Map<string, JsonRecord>();
  const mergeRows = (rows: JsonRecord[]) => {
    for (const row of rows) {
      const day = typeof row.day === "string" ? row.day : null;
      if (!day) continue;
      const target = daily.get(day) || { social_channel_id: channel.social_channel_id, metric_date: day };
      for (const [apiName, databaseName] of Object.entries(metricColumnNames)) {
        if (row[apiName] !== undefined) target[databaseName] = row[apiName];
      }
      daily.set(day, target);
    }
  };
  mergeRows(await analyticsRows(accessToken, startDate, endDate, "day", baseMetrics));
  if (grant.granted_scopes.includes("https://www.googleapis.com/auth/yt-analytics-monetary.readonly")) {
    mergeRows(await analyticsRows(accessToken, startDate, endDate, "day", "estimatedRevenue,estimatedAdRevenue,estimatedRedPartnerRevenue,grossRevenue,adImpressions,monetizedPlaybacks,cpm,playbackBasedCpm"));
    for (const row of daily.values()) row.revenue_currency = "USD";
  }
  if (daily.size > 0) {
    const { error } = await db.from("youtube_channel_daily_metrics").upsert([...daily.values()], { onConflict: "social_channel_id,metric_date" });
    if (error) throw error;
  }

  const breakdownReports: Array<{ reportType: string; dimensions: string; metrics: string; filters?: string }> = [
    { reportType: "country", dimensions: "day,country", metrics: "views,estimatedMinutesWatched,likes,comments,shares" },
    // "insightTrafficSourceType" is the correct API dimension name (not "trafficSourceType").
    { reportType: "traffic_source", dimensions: "day,insightTrafficSourceType", metrics: "views,estimatedMinutesWatched,averageViewDuration" },
    { reportType: "device", dimensions: "day,deviceType", metrics: "views,estimatedMinutesWatched,averageViewDuration" },
    { reportType: "audience", dimensions: "day,ageGroup,gender", metrics: "views,estimatedMinutesWatched,averageViewDuration" },
    { reportType: "playback_location", dimensions: "day,insightPlaybackLocationType", metrics: "views,estimatedMinutesWatched,averageViewDuration" },
    { reportType: "subscribed_status", dimensions: "day,subscribedStatus", metrics: "views,estimatedMinutesWatched,averageViewDuration" },
    // insightTrafficSourceDetail requires filtering to a single insightTrafficSourceType value.
    { reportType: "search_terms", dimensions: "day,insightTrafficSourceDetail", metrics: "views", filters: "insightTrafficSourceType==YT_SEARCH" },
    { reportType: "external_traffic", dimensions: "day,insightTrafficSourceDetail", metrics: "views", filters: "insightTrafficSourceType==EXT_URL" },
  ];
  let breakdownCount = 0;
  for (const report of breakdownReports) {
    try {
      const rows = await analyticsRows(accessToken, startDate, endDate, report.dimensions, report.metrics, report.filters);
      const rowsToStore = rows.flatMap((row) => {
        const metricDate = typeof row.day === "string" ? row.day : null;
        if (!metricDate) return [];
        const dimensionValues: JsonRecord = {};
        const metricValues: JsonRecord = {};
        for (const [name, value] of Object.entries(row)) {
          if (name === "day") continue;
          if (metricColumnNames[name]) metricValues[name] = value;
          else dimensionValues[name] = value;
        }
        return [{
          social_channel_id: channel.social_channel_id,
          metric_date: metricDate,
          report_type: report.reportType,
          dimension_key: report.dimensions,
          dimension_hash: stableHash(dimensionValues),
          dimension_values: dimensionValues,
          metric_values: metricValues,
          query_start_date: startDate,
          query_end_date: endDate,
        }];
      });
      if (rowsToStore.length > 0) {
        const { error } = await db.from("youtube_analytics_breakdowns").upsert(rowsToStore, { onConflict: "social_channel_id,metric_date,report_type,dimension_key,dimension_hash" });
        if (error) throw error;
        breakdownCount += rowsToStore.length;
      }
    } catch (error) {
      // Some channel types and privacy thresholds make a valid Analytics report unavailable.
      console.warn(`Skipping unavailable YouTube ${report.reportType} breakdown for ${channel.social_channel_id}:`, error instanceof Error ? error.message : error);
    }
  }

  // "sharingService" is a lifetime/date-range snapshot dimension; it does not combine with "day".
  try {
    const shareRows = await analyticsRows(accessToken, startDate, endDate, "sharingService", "shares");
    const shareRowsToStore = shareRows.flatMap((row) => {
      if (typeof row.sharingService !== "string" || row.shares === undefined) return [];
      const dimensionValues: JsonRecord = { sharingService: row.sharingService };
      return [{
        social_channel_id: channel.social_channel_id,
        metric_date: endDate,
        report_type: "sharing_service",
        dimension_key: "sharingService",
        dimension_hash: stableHash(dimensionValues),
        dimension_values: dimensionValues,
        metric_values: { shares: row.shares },
        query_start_date: startDate,
        query_end_date: endDate,
      }];
    });
    if (shareRowsToStore.length > 0) {
      const { error } = await db.from("youtube_analytics_breakdowns").upsert(shareRowsToStore, { onConflict: "social_channel_id,metric_date,report_type,dimension_key,dimension_hash" });
      if (error) throw error;
      breakdownCount += shareRowsToStore.length;
    }
  } catch (error) {
    console.warn(`Skipping unavailable YouTube sharing_service breakdown for ${channel.social_channel_id}:`, error instanceof Error ? error.message : error);
  }

  const retentionPoints = await syncRetentionCurves(db, channel, accessToken);
  return { dailyMetrics: daily.size, breakdowns: breakdownCount, retentionPoints };
}

// Audience retention is per-video only (the API requires filters=video==ID) and is capped to the
// most recently published videos so a channel with a large back catalog doesn't multiply API calls.
const RETENTION_VIDEO_LIMIT = 15;

async function syncRetentionCurves(db: ReturnType<typeof getAdminClient>, channel: SocialChannel, accessToken: string) {
  const { data: contents, error } = await db
    .from("social_contents")
    .select("external_content_id, youtube_videos(youtube_video_id)")
    .eq("social_channel_id", channel.social_channel_id)
    .eq("platform", "youtube")
    .order("source_published_at", { ascending: false, nullsFirst: false })
    .limit(RETENTION_VIDEO_LIMIT);
  if (error) throw error;

  const targets = (contents || []).flatMap((row) => {
    const relation = row.youtube_videos as { youtube_video_id: string } | { youtube_video_id: string }[] | null;
    const youtubeVideoId = Array.isArray(relation) ? relation[0]?.youtube_video_id : relation?.youtube_video_id;
    return youtubeVideoId ? [{ externalId: row.external_content_id as string, youtubeVideoId }] : [];
  });
  if (targets.length === 0) return 0;

  const endDate = new Date().toISOString().slice(0, 10);
  const startDate = "2005-01-01";
  let stored = 0;
  for (const target of targets) {
    try {
      const rows = await analyticsRows(accessToken, startDate, endDate, "elapsedVideoTimeRatio", "audienceWatchRatio,relativeRetentionPerformance", `video==${target.externalId}`);
      const rowsToStore = rows.flatMap((row) => {
        if (row.elapsedVideoTimeRatio === undefined) return [];
        // The video id is folded into dimension_values so the generic (channel, date, report_type,
        // dimension_key, dimension_hash) uniqueness key doesn't collide across different videos that
        // share the same elapsedVideoTimeRatio bucket value.
        const dimensionValues: JsonRecord = { elapsedVideoTimeRatio: row.elapsedVideoTimeRatio, video_external_id: target.externalId };
        const metricValues: JsonRecord = {};
        if (row.audienceWatchRatio !== undefined) metricValues.audience_watch_ratio = row.audienceWatchRatio;
        if (row.relativeRetentionPerformance !== undefined) metricValues.relative_retention_performance = row.relativeRetentionPerformance;
        return [{
          social_channel_id: channel.social_channel_id,
          youtube_video_id: target.youtubeVideoId,
          metric_date: endDate,
          report_type: "retention_curve",
          dimension_key: "elapsedVideoTimeRatio",
          dimension_hash: stableHash(dimensionValues),
          dimension_values: dimensionValues,
          metric_values: metricValues,
          query_start_date: startDate,
          query_end_date: endDate,
        }];
      });
      if (rowsToStore.length > 0) {
        const { error: upsertError } = await db.from("youtube_analytics_breakdowns").upsert(rowsToStore, { onConflict: "social_channel_id,metric_date,report_type,dimension_key,dimension_hash" });
        if (upsertError) throw upsertError;
        stored += rowsToStore.length;
      }
    } catch (error) {
      // Retention data can be withheld below a view-count threshold; skip that one video, not the whole sync.
      console.warn(`Skipping retention curve for YouTube video ${target.externalId}:`, error instanceof Error ? error.message : error);
    }
  }
  return stored;
}

function commentPayload(comment: GoogleComment, channel: SocialChannel, contentIds: Map<string, string>, parentId: string | null = null) {
  const snippet = comment.snippet || {};
  return {
    social_channel_id: channel.social_channel_id,
    social_content_id: snippet.videoId ? contentIds.get(snippet.videoId) || null : null,
    platform: "youtube" as const,
    external_comment_id: comment.id,
    external_thread_id: parentId || comment.id,
    parent_social_comment_id: parentId,
    comment_kind: parentId ? "reply" : "comment",
    author_external_id: snippet.authorChannelId?.value || null,
    author_display_name: snippet.authorDisplayName || null,
    author_avatar_url: snippet.authorProfileImageUrl || null,
    author_channel_url: snippet.authorChannelUrl || null,
    body_text: snippet.textOriginal || snippet.textDisplay || null,
    like_count: snippet.likeCount ?? null,
    moderation_status: snippet.moderationStatus || null,
    source_published_at: snippet.publishedAt || null,
    source_updated_at: snippet.updatedAt || null,
    visibility_status: "active",
    last_synced_at: new Date().toISOString(),
  };
}

function publishCommentEvents(profileId: string, events: Array<{ social_channel_id: string; [key: string]: unknown }>) {
  for (const event of events) {
    const payload = `event: comment\ndata: ${JSON.stringify(event)}\n\n`;
    for (const stream of activeCommentStreams) {
      if (stream.profileId === profileId && (!stream.channelId || stream.channelId === event.social_channel_id)) stream.response.write(payload);
    }
  }
}

async function syncCommentPage(db: ReturnType<typeof getAdminClient>, channel: SocialChannel, accessToken: string, pageToken?: string | null) {
  const url = new URL("https://www.googleapis.com/youtube/v3/commentThreads");
  const params = new URLSearchParams({ allThreadsRelatedToChannelId: channel.external_channel_id, maxResults: "100", order: "time", part: "snippet,replies", textFormat: "plainText" });
  if (pageToken) params.set("pageToken", pageToken);
  url.search = params.toString();
  const response = await googleJson<{
    items?: Array<{ id?: string; snippet?: { topLevelComment?: GoogleComment; totalReplyCount?: number }; replies?: { comments?: GoogleComment[] } }>;
    nextPageToken?: string;
  }>(url, accessToken);
  const threads = response.items || [];
  const allComments = threads.flatMap((thread) => [thread.snippet?.topLevelComment, ...(thread.replies?.comments || [])].filter((item): item is GoogleComment => Boolean(item?.id)));
  if (allComments.length === 0) return { comments: 0, nextPageToken: response.nextPageToken || null };
  const videoIds = [...new Set(allComments.map((comment) => comment.snippet?.videoId).filter((id): id is string => Boolean(id)))];
  const { data: contents, error: contentsError } = videoIds.length > 0
    ? await db.from("social_contents").select("social_content_id, external_content_id").eq("platform", "youtube").in("external_content_id", videoIds)
    : { data: [], error: null };
  if (contentsError) throw contentsError;
  const contentIds = new Map((contents || []).map((content) => [content.external_content_id as string, content.social_content_id as string]));
  const externalIds = allComments.map((comment) => comment.id);
  const { data: existing, error: existingError } = await db.from("social_comments").select("social_comment_id, external_comment_id").eq("platform", "youtube").in("external_comment_id", externalIds);
  if (existingError) throw existingError;
  const existingByExternalId = new Map((existing || []).map((comment) => [comment.external_comment_id as string, comment.social_comment_id as string]));
  const topLevelComments = threads.map((thread) => thread.snippet?.topLevelComment).filter((comment): comment is GoogleComment => Boolean(comment?.id));
  const topLevelPayload = topLevelComments.map((comment) => ({ ...commentPayload(comment, channel, contentIds), reply_count: threads.find((thread) => thread.snippet?.topLevelComment?.id === comment.id)?.snippet?.totalReplyCount ?? null }));
  const { data: savedTopLevel, error: topLevelError } = await db.from("social_comments").upsert(topLevelPayload, { onConflict: "platform,external_comment_id" }).select("social_comment_id, external_comment_id");
  if (topLevelError) throw topLevelError;
  const parentIds = new Map([...(savedTopLevel || []).map((comment) => [comment.external_comment_id as string, comment.social_comment_id as string] as const), ...existingByExternalId]);
  const replies = threads.flatMap((thread) => (thread.replies?.comments || []).map((comment) => ({ comment, parentExternalId: thread.snippet?.topLevelComment?.id || null }))).filter((value) => value.parentExternalId);
  if (replies.length > 0) {
    const replyPayload = replies.map(({ comment, parentExternalId }) => commentPayload(comment, channel, contentIds, parentIds.get(parentExternalId || "") || null));
    const { error: repliesError } = await db.from("social_comments").upsert(replyPayload, { onConflict: "platform,external_comment_id" });
    if (repliesError) throw repliesError;
  }
  const newExternalIds = externalIds.filter((id) => !existingByExternalId.has(id));
  if (newExternalIds.length > 0) {
    const { data: savedComments, error: savedError } = await db.from("social_comments").select("social_comment_id, external_comment_id, social_channel_id, source_published_at").eq("platform", "youtube").in("external_comment_id", newExternalIds);
    if (savedError) throw savedError;
    const eventRows = (savedComments || []).map((comment) => ({
      social_channel_id: comment.social_channel_id,
      social_comment_id: comment.social_comment_id,
      event_type: "created",
      source_occurred_at: comment.source_published_at,
      event_payload: { external_comment_id: comment.external_comment_id },
    }));
    if (eventRows.length > 0) {
      const { data: events, error: eventError } = await db.from("social_comment_events").insert(eventRows).select("social_comment_event_id, social_channel_id, social_comment_id, event_type, observed_at, source_occurred_at, event_payload");
      if (eventError) throw eventError;
      publishCommentEvents(channel.profile_id, events || []);
    }
  }
  return { comments: allComments.length, nextPageToken: response.nextPageToken || null };
}

async function completeJob(db: ReturnType<typeof getAdminClient>, job: SyncJob, summary: JsonRecord) {
  const { error } = await db.from("platform_sync_jobs").update({ status: "succeeded", finished_at: new Date().toISOString(), result_summary: summary, error_code: null, error_message: null }).eq("platform_sync_job_id", job.platform_sync_job_id);
  if (error) throw error;
}

async function failJob(db: ReturnType<typeof getAdminClient>, job: SyncJob, error: unknown) {
  const message = error instanceof Error ? error.message.slice(0, 500) : "YouTube sync failed.";
  await db.from("platform_sync_jobs").update({ status: "failed", finished_at: new Date().toISOString(), error_code: error instanceof ApiError ? error.code : "SYNC_FAILED", error_message: message }).eq("platform_sync_job_id", job.platform_sync_job_id);
}

function readJobCursor(cursor: string | null) {
  if (!cursor) return {} as { page_token?: string };
  try {
    const parsed = JSON.parse(cursor) as { page_token?: unknown };
    return typeof parsed.page_token === "string" ? { page_token: parsed.page_token } : {};
  } catch {
    return {};
  }
}

async function runSyncJob(db: ReturnType<typeof getAdminClient>, job: SyncJob) {
  const { data: channelRow, error: channelError } = await db.from("social_channels").select("social_channel_id, profile_id, platform_oauth_grant_id, platform, external_channel_id, handle, display_name, avatar_url, is_dashboard_enabled, status").eq("social_channel_id", job.social_channel_id).maybeSingle();
  if (channelError) throw channelError;
  if (!channelRow) throw new ApiError(404, "YOUTUBE_CHANNEL_NOT_FOUND", "The queued channel no longer exists.");
  const channel = channelRow as SocialChannel;
  const grant = await getGrantForChannel(db, channel);
  const accessToken = await refreshGrantAccessToken(db, grant);
  const summary: JsonRecord = {};
  const cursor = readJobCursor(job.cursor);

  if (job.job_kind === "initial" || job.job_kind === "full" || job.job_kind === "channel") {
    await syncChannelMetadata(db, channel, accessToken);
    summary.channel = "synchronized";
  }
  if (job.job_kind === "initial" || job.job_kind === "full" || job.job_kind === "content") {
    const content = await syncVideoPage(db, channel, accessToken, cursor.page_token);
    summary.videos = content.videos;
    if (content.nextPageToken) await queueSyncJob(db, channel.social_channel_id, "content", JSON.stringify({ page_token: content.nextPageToken }));
  }
  if (job.job_kind === "initial" || job.job_kind === "full" || job.job_kind === "analytics") {
    summary.analytics = await syncAnalytics(db, channel, grant, accessToken);
  }
  if (job.job_kind === "initial" || job.job_kind === "full" || job.job_kind === "comments") {
    try {
      const comments = await syncCommentPage(db, channel, accessToken, cursor.page_token);
      summary.comments = comments.comments;
      if (comments.nextPageToken) await queueSyncJob(db, channel.social_channel_id, "comments", JSON.stringify({ page_token: comments.nextPageToken }));
    } catch (error) {
      // Comments can be disabled per channel or video; this must not discard the rest of a successful channel sync.
      summary.comments_error = error instanceof Error ? error.message.slice(0, 200) : "unavailable";
    }
  }
  await db.from("social_channels").update({ last_synced_at: new Date().toISOString(), status: "active" }).eq("social_channel_id", channel.social_channel_id);
  await completeJob(db, job, summary);
}

export async function processYoutubeSyncQueue() {
  if (workerBusy) return;
  workerBusy = true;
  try {
    const db = getAdminClient();
    const workerName = process.env.YOUTUBE_SYNC_WORKER_NAME || `web-${process.pid}`;
    const { data, error } = await db.rpc("claim_platform_sync_jobs", { worker_name: workerName, batch_size: 1 });
    if (error) throw error;
    for (const row of (data || []) as SyncJob[]) {
      try {
        await runSyncJob(db, row);
      } catch (error) {
        console.error(`YouTube sync job ${row.platform_sync_job_id} failed:`, error);
        await failJob(db, row, error);
      }
    }
  } catch (error) {
    console.error("YouTube sync worker unavailable:", error);
  } finally {
    workerBusy = false;
  }
}

export function startYoutubeSyncWorker() {
  if (process.env.YOUTUBE_SYNC_WORKER_ENABLED !== "true" || workerTimer) return;
  workerTimer = setInterval(() => void processYoutubeSyncQueue(), 5_000);
  workerTimer.unref();
  void processYoutubeSyncQueue();
}

export function registerYoutubeRoutes(app: Express) {
  app.get("/api/connections/youtube/start", async (req, res) => {
    try {
      const authenticatedUser = await getAuthenticatedUser(req);
      if (!authenticatedUser) return sendError(res, 401, "UNAUTHENTICATED", "A valid session is required.");
      const includeRevenue = req.query.include_revenue === "true";
      const { clientId } = getGoogleConfig();
      const oauth = createOAuthState(authenticatedUser.user.id, includeRevenue);
      res.cookie(YOUTUBE_STATE_COOKIE, oauth.cookieValue, {
        httpOnly: true,
        secure: isProduction(),
        sameSite: "lax",
        path: YOUTUBE_CALLBACK_PATH,
        maxAge: 10 * 60 * 1000,
      });
      const scopes = [
        "openid",
        YOUTUBE_WRITE_SCOPE,
        "https://www.googleapis.com/auth/yt-analytics.readonly",
        ...(includeRevenue ? ["https://www.googleapis.com/auth/yt-analytics-monetary.readonly"] : []),
      ];
      const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      url.search = new URLSearchParams({
        client_id: clientId,
        redirect_uri: callbackUrl(),
        response_type: "code",
        scope: scopes.join(" "),
        access_type: "offline",
        include_granted_scopes: "true",
        prompt: "consent",
        state: oauth.state,
        code_challenge: pkceChallenge(oauth.verifier),
        code_challenge_method: "S256",
      }).toString();
      return res.redirect(303, url.toString());
    } catch (error) {
      return toErrorResponse(res, error, "YOUTUBE_CONNECTION_START_FAILED");
    }
  });

  app.get(YOUTUBE_CALLBACK_PATH, async (req, res) => {
    const errorName = typeof req.query.error === "string" ? req.query.error : null;
    if (errorName) {
      clearOAuthState(res);
      return redirectToApp(res, "denied", errorName);
    }
    const code = typeof req.query.code === "string" ? req.query.code : null;
    const state = typeof req.query.state === "string" ? req.query.state : null;
    if (!code || !state) return sendError(res, 400, "MISSING_YOUTUBE_OAUTH_CODE", "Missing YouTube OAuth code or state.");
    try {
      const oauth = readOAuthState(req, state);
      clearOAuthState(res);
      const token = await exchangeGoogleCode(code, oauth.verifier);
      const subject = await getGoogleSubject(token.access_token);
      const db = getAdminClient();
      const { data: existing, error: existingError } = await db.from("platform_oauth_grants").select("platform_oauth_grant_id, profile_id, platform, provider, provider_subject, access_token_ciphertext, refresh_token_ciphertext, access_token_expires_at, granted_scopes, status").eq("profile_id", oauth.profileId).eq("platform", "youtube").eq("provider", "google").eq("provider_subject", subject).maybeSingle();
      if (existingError) throw existingError;
      const refreshCiphertext = token.refresh_token ? encodeCiphertext(encryptToken(token.refresh_token)) : (existing as OAuthGrant | null)?.refresh_token_ciphertext;
      if (!refreshCiphertext) throw new ApiError(502, "YOUTUBE_REFRESH_TOKEN_MISSING", "Google did not return a refresh token. Remove this app from Google permissions and connect YouTube again.");
      const grantPayload = {
        profile_id: oauth.profileId,
        platform: "youtube" as const,
        provider: "google",
        provider_subject: subject,
        access_token_ciphertext: encodeCiphertext(encryptToken(token.access_token)),
        refresh_token_ciphertext: refreshCiphertext,
        access_token_expires_at: new Date(Date.now() + (token.expires_in || 3600) * 1000).toISOString(),
        granted_scopes: (token.scope || "").split(" ").filter(Boolean),
        status: "active",
        connected_at: new Date().toISOString(),
        revoked_at: null,
        last_error_code: null,
        last_error_at: null,
      };
      const result = existing
        ? await db.from("platform_oauth_grants").update(grantPayload).eq("platform_oauth_grant_id", (existing as OAuthGrant).platform_oauth_grant_id).select("platform_oauth_grant_id").single()
        : await db.from("platform_oauth_grants").insert(grantPayload).select("platform_oauth_grant_id").single();
      if (result.error || !result.data) throw result.error || new Error("Unable to save YouTube credentials.");
      const discovered = await fetchOwnedGoogleChannels(token.access_token);
      const channels = await persistDiscoveredChannels(db, oauth.profileId, result.data.platform_oauth_grant_id, discovered);
      for (const channel of channels) await queueSyncJob(db, channel.social_channel_id, "initial");
      void processYoutubeSyncQueue();
      return redirectToApp(res, "connected");
    } catch (error) {
      clearOAuthState(res);
      console.error("YouTube OAuth callback failed:", error);
      return redirectToApp(res, "error", error instanceof ApiError ? error.code : "callback_failed");
    }
  });

  app.get("/api/connections/youtube", async (req, res) => {
    try {
      const authenticatedUser = await getAuthenticatedUser(req);
      if (!authenticatedUser) return sendError(res, 401, "UNAUTHENTICATED", "A valid session is required.");
      const db = getAdminClient();
      const { data, error } = await db.from("social_channels").select("social_channel_id, external_channel_id, handle, display_name, avatar_url, is_dashboard_enabled, status, last_synced_at, youtube_channel_profiles(subscriber_count, view_count, video_count), platform_oauth_grants(granted_scopes)").eq("profile_id", authenticatedUser.user.id).eq("platform", "youtube").order("created_at", { ascending: true });
      if (error) throw error;
      const channels = (data || []).map((row) => {
        const grantRelation = row.platform_oauth_grants as { granted_scopes?: string[] } | { granted_scopes?: string[] }[] | null;
        const grant = Array.isArray(grantRelation) ? grantRelation[0] : grantRelation;
        const { platform_oauth_grants: _omit, ...rest } = row;
        return { ...rest, can_manage_content: hasWriteScope(grant?.granted_scopes) };
      });
      return res.status(200).json({ channels });
    } catch (error) {
      return toErrorResponse(res, error, "YOUTUBE_UNAVAILABLE");
    }
  });

  // Everything currently synced for one channel. Backs the "원본 데이터" management page
  // (channel profile, videos, analytics breakdowns, comments) — the video/comment management
  // routes below operate on the same social_contents/social_comments rows this returns.
  app.get("/api/connections/youtube/:channelId/raw-data", async (req, res) => {
    try {
      const authenticatedUser = await getAuthenticatedUser(req);
      if (!authenticatedUser) return sendError(res, 401, "UNAUTHENTICATED", "A valid session is required.");
      const channelId = readId(req.params.channelId);
      if (!channelId) return sendError(res, 400, "INVALID_CHANNEL_ID", "A valid channel ID is required.");
      const db = getAdminClient();
      const channel = await requireOwnedChannel(db, authenticatedUser.user.id, channelId);

      const { data: profile, error: profileError } = await db.from("youtube_channel_profiles").select("*").eq("social_channel_id", channelId).maybeSingle();
      if (profileError) throw profileError;

      const { data: videos, error: videosError } = await db.from("social_contents").select("*, youtube_videos(*)").eq("social_channel_id", channelId).eq("platform", "youtube").order("source_published_at", { ascending: false, nullsFirst: false }).limit(200);
      if (videosError) throw videosError;

      const { data: dailyMetrics, error: dailyError } = await db.from("youtube_channel_daily_metrics").select("*").eq("social_channel_id", channelId).order("metric_date", { ascending: false });
      if (dailyError) throw dailyError;

      const { data: breakdownRows, error: breakdownError } = await db.from("youtube_analytics_breakdowns").select("*").eq("social_channel_id", channelId).order("metric_date", { ascending: false }).limit(5000);
      if (breakdownError) throw breakdownError;
      const breakdowns: Record<string, unknown[]> = {};
      for (const row of breakdownRows || []) {
        const reportType = row.report_type as string;
        (breakdowns[reportType] ||= []).push(row);
      }

      const { data: comments, error: commentsError } = await db.from("social_comments").select("*").eq("social_channel_id", channelId).eq("visibility_status", "active").order("source_published_at", { ascending: false, nullsFirst: false }).limit(100);
      if (commentsError) throw commentsError;

      return res.status(200).json({
        channel: { ...channel, profile: profile || null },
        videos: videos || [],
        daily_metrics: dailyMetrics || [],
        breakdowns,
        comments: comments || [],
      });
    } catch (error) {
      return toErrorResponse(res, error, "YOUTUBE_RAW_DATA_FAILED");
    }
  });

  app.patch("/api/connections/youtube/:channelId/videos/:contentId", async (req, res) => {
    try {
      const authenticatedUser = await getAuthenticatedUser(req);
      if (!authenticatedUser) return sendError(res, 401, "UNAUTHENTICATED", "A valid session is required.");
      const channelId = readId(req.params.channelId);
      const contentId = readId(req.params.contentId);
      if (!channelId || !contentId) return sendError(res, 400, "INVALID_INPUT", "A valid channel ID and video ID are required.");
      const title = typeof req.body?.title === "string" ? req.body.title.trim() : undefined;
      const description = typeof req.body?.description === "string" ? req.body.description : undefined;
      if (title === undefined && description === undefined) return sendError(res, 400, "INVALID_INPUT", "Provide a title or description to update.");
      if (title !== undefined && title.length === 0) return sendError(res, 400, "INVALID_INPUT", "Title cannot be empty.");
      if (title !== undefined && title.length > 100) return sendError(res, 400, "INVALID_INPUT", "Title cannot exceed 100 characters.");
      if (description !== undefined && description.length > 5000) return sendError(res, 400, "INVALID_INPUT", "Description cannot exceed 5000 characters.");

      const db = getAdminClient();
      const channel = await requireOwnedChannel(db, authenticatedUser.user.id, channelId);
      const grant = await getGrantForChannel(db, channel);
      requireWriteScope(grant);
      const video = await requireOwnedVideo(db, channelId, contentId);
      const youtubeVideo = (Array.isArray(video.youtube_videos) ? video.youtube_videos[0] : video.youtube_videos) as { category_external_id?: string | null; tags?: string[] | null; default_language?: string | null } | null;
      const accessToken = await refreshGrantAccessToken(db, grant);

      // videos.update replaces the whole snippet part, so fields the user didn't touch must be
      // resent from our own copy or Google will clear them.
      const snippet: JsonRecord = {
        title: title ?? video.title ?? "",
        description: description ?? video.body_text ?? "",
        categoryId: youtubeVideo?.category_external_id || undefined,
        tags: youtubeVideo?.tags || undefined,
        defaultLanguage: youtubeVideo?.default_language || undefined,
      };
      const url = new URL("https://www.googleapis.com/youtube/v3/videos");
      url.search = new URLSearchParams({ part: "snippet" }).toString();
      await googleJson(url, accessToken, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: video.external_content_id, snippet }),
      });

      const { data: updated, error: updateError } = await db
        .from("social_contents")
        .update({ title: snippet.title, body_text: snippet.description })
        .eq("social_content_id", contentId)
        .select("social_content_id, title, body_text")
        .single();
      if (updateError) throw updateError;
      return res.status(200).json({ video: updated });
    } catch (error) {
      return toErrorResponse(res, error, "YOUTUBE_VIDEO_UPDATE_FAILED");
    }
  });

  app.delete("/api/connections/youtube/:channelId/videos/:contentId", async (req, res) => {
    try {
      const authenticatedUser = await getAuthenticatedUser(req);
      if (!authenticatedUser) return sendError(res, 401, "UNAUTHENTICATED", "A valid session is required.");
      const channelId = readId(req.params.channelId);
      const contentId = readId(req.params.contentId);
      if (!channelId || !contentId) return sendError(res, 400, "INVALID_INPUT", "A valid channel ID and video ID are required.");
      const db = getAdminClient();
      const channel = await requireOwnedChannel(db, authenticatedUser.user.id, channelId);
      const grant = await getGrantForChannel(db, channel);
      requireWriteScope(grant);
      const video = await requireOwnedVideo(db, channelId, contentId);
      const accessToken = await refreshGrantAccessToken(db, grant);

      const url = new URL("https://www.googleapis.com/youtube/v3/videos");
      url.search = new URLSearchParams({ id: video.external_content_id }).toString();
      await googleJson(url, accessToken, { method: "DELETE" });

      const { error: updateError } = await db.from("social_contents").update({ visibility: "deleted" }).eq("social_content_id", contentId);
      if (updateError) throw updateError;
      return res.status(204).send();
    } catch (error) {
      return toErrorResponse(res, error, "YOUTUBE_VIDEO_DELETE_FAILED");
    }
  });

  app.post("/api/connections/youtube/:channelId/sync", async (req, res) => {
    try {
      const authenticatedUser = await getAuthenticatedUser(req);
      if (!authenticatedUser) return sendError(res, 401, "UNAUTHENTICATED", "A valid session is required.");
      const channelId = readId(req.params.channelId);
      if (!channelId) return sendError(res, 400, "INVALID_CHANNEL_ID", "A valid channel ID is required.");
      const db = getAdminClient();
      await requireOwnedChannel(db, authenticatedUser.user.id, channelId);
      const job = await queueSyncJob(db, channelId, "full");
      void processYoutubeSyncQueue();
      return res.status(202).json({ job });
    } catch (error) {
      return toErrorResponse(res, error, "YOUTUBE_SYNC_QUEUE_FAILED");
    }
  });

  app.post("/api/connections/youtube/:channelId/comments/sync", async (req, res) => {
    try {
      const authenticatedUser = await getAuthenticatedUser(req);
      if (!authenticatedUser) return sendError(res, 401, "UNAUTHENTICATED", "A valid session is required.");
      const channelId = readId(req.params.channelId);
      if (!channelId) return sendError(res, 400, "INVALID_CHANNEL_ID", "A valid channel ID is required.");
      const db = getAdminClient();
      await requireOwnedChannel(db, authenticatedUser.user.id, channelId);
      const job = await queueSyncJob(db, channelId, "comments");
      void processYoutubeSyncQueue();
      return res.status(202).json({ job });
    } catch (error) {
      return toErrorResponse(res, error, "YOUTUBE_COMMENT_SYNC_QUEUE_FAILED");
    }
  });

  app.post("/api/connections/youtube/:channelId/comments/:commentId/reply", async (req, res) => {
    try {
      const authenticatedUser = await getAuthenticatedUser(req);
      if (!authenticatedUser) return sendError(res, 401, "UNAUTHENTICATED", "A valid session is required.");
      const channelId = readId(req.params.channelId);
      const commentId = readId(req.params.commentId);
      if (!channelId || !commentId) return sendError(res, 400, "INVALID_INPUT", "A valid channel ID and comment ID are required.");
      const body = typeof req.body?.body === "string" ? req.body.body.trim() : "";
      if (!body) return sendError(res, 400, "INVALID_INPUT", "Reply text is required.");
      if (body.length > 10_000) return sendError(res, 400, "INVALID_INPUT", "Reply text cannot exceed 10,000 characters.");

      const db = getAdminClient();
      const channel = await requireOwnedChannel(db, authenticatedUser.user.id, channelId);
      const grant = await getGrantForChannel(db, channel);
      requireWriteScope(grant);
      const target = await requireOwnedComment(db, channelId, commentId);
      const parentExternalId = await resolveGoogleParentCommentId(db, target);
      const accessToken = await refreshGrantAccessToken(db, grant);

      const url = new URL("https://www.googleapis.com/youtube/v3/comments");
      url.search = new URLSearchParams({ part: "snippet" }).toString();
      const created = await googleJson<GoogleComment>(url, accessToken, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ snippet: { parentId: parentExternalId, textOriginal: body } }),
      });

      const parentSocialCommentId = target.comment_kind === "reply" ? target.parent_social_comment_id : target.social_comment_id;
      const snippet = created.snippet || {};
      const payload = {
        social_channel_id: channel.social_channel_id,
        social_content_id: target.social_content_id ?? null,
        platform: "youtube" as const,
        external_comment_id: created.id,
        external_thread_id: parentExternalId,
        parent_social_comment_id: parentSocialCommentId,
        comment_kind: "reply" as const,
        author_external_id: snippet.authorChannelId?.value || null,
        author_display_name: snippet.authorDisplayName || null,
        author_avatar_url: snippet.authorProfileImageUrl || null,
        author_channel_url: snippet.authorChannelUrl || null,
        body_text: snippet.textOriginal || snippet.textDisplay || body,
        like_count: snippet.likeCount ?? 0,
        moderation_status: snippet.moderationStatus || null,
        source_published_at: snippet.publishedAt || new Date().toISOString(),
        source_updated_at: snippet.updatedAt || null,
        visibility_status: "active" as const,
        authored_by_profile_id: authenticatedUser.user.id,
        last_synced_at: new Date().toISOString(),
      };
      const { data: saved, error: saveError } = await db
        .from("social_comments")
        .upsert(payload, { onConflict: "platform,external_comment_id" })
        .select("social_comment_id, social_channel_id, social_content_id, external_comment_id, parent_social_comment_id, comment_kind, author_display_name, author_avatar_url, body_text, like_count, source_published_at, visibility_status")
        .single();
      if (saveError) throw saveError;

      const { data: event, error: eventError } = await db
        .from("social_comment_events")
        .insert({
          social_channel_id: channel.social_channel_id,
          social_comment_id: saved.social_comment_id,
          event_type: "reply_created",
          source_occurred_at: payload.source_published_at,
          event_payload: { external_comment_id: created.id },
        })
        .select("social_comment_event_id, social_channel_id, social_comment_id, event_type, observed_at, source_occurred_at, event_payload")
        .single();
      if (eventError) throw eventError;
      publishCommentEvents(channel.profile_id, [event]);

      return res.status(201).json({ comment: saved });
    } catch (error) {
      return toErrorResponse(res, error, "YOUTUBE_COMMENT_REPLY_FAILED");
    }
  });

  app.patch("/api/connections/youtube/:channelId/comments/:commentId/moderate", async (req, res) => {
    try {
      const authenticatedUser = await getAuthenticatedUser(req);
      if (!authenticatedUser) return sendError(res, 401, "UNAUTHENTICATED", "A valid session is required.");
      const channelId = readId(req.params.channelId);
      const commentId = readId(req.params.commentId);
      if (!channelId || !commentId) return sendError(res, 400, "INVALID_INPUT", "A valid channel ID and comment ID are required.");
      const action = req.body?.action;
      if (action !== "hide" && action !== "delete") return sendError(res, 400, "INVALID_INPUT", "action must be 'hide' or 'delete'.");

      const db = getAdminClient();
      const channel = await requireOwnedChannel(db, authenticatedUser.user.id, channelId);
      const grant = await getGrantForChannel(db, channel);
      requireWriteScope(grant);
      const target = await requireOwnedComment(db, channelId, commentId);
      const accessToken = await refreshGrantAccessToken(db, grant);

      if (action === "hide") {
        const url = new URL("https://www.googleapis.com/youtube/v3/comments/setModerationStatus");
        url.search = new URLSearchParams({ id: target.external_comment_id, moderationStatus: "rejected" }).toString();
        await googleJson(url, accessToken, { method: "POST" });
        const { error: updateError } = await db.from("social_comments").update({ moderation_status: "rejected", visibility_status: "hidden" }).eq("social_comment_id", commentId);
        if (updateError) throw updateError;
      } else {
        const url = new URL("https://www.googleapis.com/youtube/v3/comments");
        url.search = new URLSearchParams({ id: target.external_comment_id }).toString();
        await googleJson(url, accessToken, { method: "DELETE" });
        const { error: updateError } = await db.from("social_comments").update({ visibility_status: "deleted" }).eq("social_comment_id", commentId);
        if (updateError) throw updateError;
      }

      const { data: event, error: eventError } = await db
        .from("social_comment_events")
        .insert({
          social_channel_id: channel.social_channel_id,
          social_comment_id: commentId,
          event_type: action === "hide" ? "moderation_changed" : "deleted",
          source_occurred_at: new Date().toISOString(),
          event_payload: { action },
        })
        .select("social_comment_event_id, social_channel_id, social_comment_id, event_type, observed_at, source_occurred_at, event_payload")
        .single();
      if (eventError) throw eventError;
      publishCommentEvents(channel.profile_id, [event]);

      return res.status(204).send();
    } catch (error) {
      return toErrorResponse(res, error, "YOUTUBE_COMMENT_MODERATE_FAILED");
    }
  });

  app.delete("/api/connections/youtube/:channelId", async (req, res) => {
    try {
      const authenticatedUser = await getAuthenticatedUser(req);
      if (!authenticatedUser) return sendError(res, 401, "UNAUTHENTICATED", "A valid session is required.");
      const channelId = readId(req.params.channelId);
      if (!channelId) return sendError(res, 400, "INVALID_CHANNEL_ID", "A valid channel ID is required.");
      const db = getAdminClient();
      const channel = await requireOwnedChannel(db, authenticatedUser.user.id, channelId);
      const grantId = channel.platform_oauth_grant_id;
      const { error } = await db.from("social_channels").delete().eq("social_channel_id", channelId);
      if (error) throw error;
      if (grantId) {
        const { count, error: countError } = await db.from("social_channels").select("social_channel_id", { count: "exact", head: true }).eq("platform_oauth_grant_id", grantId);
        if (countError) throw countError;
        if (count === 0) {
          const { error: grantError } = await db.from("platform_oauth_grants").delete().eq("platform_oauth_grant_id", grantId);
          if (grantError) throw grantError;
        }
      }
      return res.status(204).send();
    } catch (error) {
      return toErrorResponse(res, error, "YOUTUBE_DISCONNECT_FAILED");
    }
  });

  app.get("/api/social/comments", async (req, res) => {
    try {
      const authenticatedUser = await getAuthenticatedUser(req);
      if (!authenticatedUser) return sendError(res, 401, "UNAUTHENTICATED", "A valid session is required.");
      const channelId = readId(req.query.channel_id);
      const contentId = req.query.content_id === undefined ? null : readId(req.query.content_id);
      const queryText = typeof req.query.query === "string" ? req.query.query.trim().slice(0, 100) : "";
      const cursor = parseCursor(req.query.cursor);
      const limit = parsePositiveInt(req.query.limit, DEFAULT_COMMENT_LIMIT, MAX_COMMENT_LIMIT);
      if (!channelId || (req.query.content_id !== undefined && !contentId) || (req.query.cursor && !cursor)) {
        return sendError(res, 400, "INVALID_INPUT", "A valid channel_id, optional content_id, and cursor are required.");
      }
      const db = getAdminClient();
      await requireOwnedChannel(db, authenticatedUser.user.id, channelId);
      let query = db.from("social_comments").select("social_comment_id, social_content_id, external_comment_id, external_thread_id, parent_social_comment_id, comment_kind, author_external_id, author_display_name, author_avatar_url, author_channel_url, body_text, like_count, reply_count, moderation_status, visibility_status, source_published_at, source_updated_at").eq("social_channel_id", channelId).eq("visibility_status", "active").order("source_published_at", { ascending: false, nullsFirst: false }).order("social_comment_id", { ascending: false }).limit(limit + 1);
      if (contentId) query = query.eq("social_content_id", contentId);
      if (cursor) query = query.or(`source_published_at.lt.${cursor.at},and(source_published_at.eq.${cursor.at},social_comment_id.lt.${cursor.id})`);
      if (queryText) {
        const searchable = queryText.replace(/[^\p{L}\p{N}\s_-]/gu, " ").trim();
        if (!searchable) return sendError(res, 400, "INVALID_QUERY", "The search query must contain letters or numbers.");
        // This uses the GIN index on search_document and keeps the keyset cursor predicate intact.
        query = query.textSearch("search_document", searchable, { config: "simple", type: "websearch" });
      }
      const { data, error } = await query;
      if (error) throw error;
      const rows = data || [];
      const hasMore = rows.length > limit;
      const comments = hasMore ? rows.slice(0, limit) : rows;
      const last = comments[comments.length - 1] as { source_published_at: string | null; social_comment_id: string } | undefined;
      return res.status(200).json({ comments, next_cursor: hasMore && last ? makeCursor(last) : null });
    } catch (error) {
      return toErrorResponse(res, error, "COMMENT_QUERY_FAILED");
    }
  });

  app.get("/api/social/comment-events", async (req, res) => {
    try {
      const authenticatedUser = await getAuthenticatedUser(req);
      if (!authenticatedUser) return sendError(res, 401, "UNAUTHENTICATED", "A valid session is required.");
      const channelId = readId(req.query.channel_id);
      const after = typeof req.query.after === "string" && !Number.isNaN(Date.parse(req.query.after)) ? req.query.after : null;
      const limit = parsePositiveInt(req.query.limit, DEFAULT_COMMENT_LIMIT, MAX_COMMENT_LIMIT);
      if (!channelId) return sendError(res, 400, "INVALID_CHANNEL_ID", "A valid channel_id is required.");
      const db = getAdminClient();
      await requireOwnedChannel(db, authenticatedUser.user.id, channelId);
      let query = db.from("social_comment_events").select("social_comment_event_id, social_comment_id, event_type, observed_at, source_occurred_at, event_payload").eq("social_channel_id", channelId).order("observed_at", { ascending: false }).limit(limit);
      if (after) query = query.gt("observed_at", after);
      const { data, error } = await query;
      if (error) throw error;
      return res.status(200).json({ events: data || [] });
    } catch (error) {
      return toErrorResponse(res, error, "COMMENT_EVENT_QUERY_FAILED");
    }
  });

  app.get("/api/social/comment-events/stream", async (req, res) => {
    try {
      const authenticatedUser = await getAuthenticatedUser(req);
      if (!authenticatedUser) return sendError(res, 401, "UNAUTHENTICATED", "A valid session is required.");
      const channelId = req.query.channel_id === undefined ? undefined : readId(req.query.channel_id);
      if (req.query.channel_id !== undefined && !channelId) return sendError(res, 400, "INVALID_CHANNEL_ID", "A valid channel_id is required.");
      const db = getAdminClient();
      if (channelId) await requireOwnedChannel(db, authenticatedUser.user.id, channelId);
      res.status(200).set({
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      res.flushHeaders();
      res.write("retry: 5000\n\n");
      const stream: CommentStream = { profileId: authenticatedUser.user.id, channelId: channelId || undefined, response: res };
      activeCommentStreams.add(stream);
      const heartbeat = setInterval(() => res.write(": heartbeat\n\n"), 25_000);
      req.on("close", () => {
        clearInterval(heartbeat);
        activeCommentStreams.delete(stream);
        res.end();
      });
    } catch (error) {
      return toErrorResponse(res, error, "COMMENT_STREAM_FAILED");
    }
  });
}
