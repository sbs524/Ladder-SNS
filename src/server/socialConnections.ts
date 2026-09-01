import type { Express, Request, Response } from "express";
import { getAuthenticatedUser } from "./auth";
import { ApiError, getAdminClient, requireString, toErrorResponse } from "./supabaseAdmin";
import {
  callbackUrl,
  clearOAuthState,
  createOAuthState,
  decryptToken,
  encodeCiphertext,
  encryptToken,
  pkceChallenge,
  readOAuthState,
  redirectToApp,
  setOAuthStateCookie,
  type OAuthStateCookie,
} from "./oauth";

/**
 * Instagram · Threads · X 연동.
 *
 * 세 곳 모두 흐름은 같다: 인증 URL로 보내고 → 코드를 토큰으로 바꾸고 → 프로필을 읽어
 * social_channels 한 줄을 만든다. 그래서 라우트는 한 번만 쓰고 어댑터가 다른 부분만 채운다.
 * 유튜브는 동기화 워커·댓글 스트림까지 얽혀 있어 이 일반 경로로 끌어오지 않았다 — 돌아가는
 * 연동을 리팩터링하는 위험이 얻는 것보다 크다.
 *
 * 토큰 수명 차이가 핵심이다:
 *  - X   : refresh token 있음(회전식). 갱신하면 refresh token도 새것으로 바뀌므로 반드시 덮어쓴다.
 *  - Meta: refresh token 없음. 60일 장기 토큰을 만료 전에 자기 자신으로 교환한다.
 */

const META_GRAPH_VERSION = "v23.0";

type ConnectablePlatform = "instagram" | "threads" | "x";

type GrantTokens = {
  accessToken: string;
  /** Meta 계열은 null. 스키마 제약도 이 두 플랫폼만 예외로 열려 있다. */
  refreshToken: string | null;
  expiresInSeconds: number | null;
  scopes: string[];
};

type RemoteProfile = {
  /** platform_oauth_grants.provider_subject — 이 제공자 안에서 계정을 식별하는 값. */
  subject: string;
  externalChannelId: string;
  handle: string | null;
  displayName: string;
  avatarUrl: string | null;
};

type ProviderAdapter = {
  platform: ConnectablePlatform;
  provider: string;
  /** 에러 코드 접두어. 프런트가 코드로 분기하므로 플랫폼마다 달라야 한다. */
  codePrefix: string;
  label: string;
  scopes: string[];
  usesPkce: boolean;
  config(): { clientId: string; clientSecret: string };
  authorizeUrl(input: { clientId: string; redirectUri: string; state: string; verifier: string }): string;
  exchangeCode(input: { code: string; verifier: string; redirectUri: string }): Promise<GrantTokens>;
  fetchProfile(accessToken: string): Promise<RemoteProfile>;
  /** 저장된 자격증명으로 새 액세스 토큰을 받는다. */
  refresh(input: { accessToken: string | null; refreshToken: string | null }): Promise<GrantTokens>;
};

function sendError(res: Response, status: number, code: string, message: string) {
  return res.status(status).json({ error: { code, message } });
}

function callbackPath(platform: ConnectablePlatform) {
  return `/api/connections/${platform}/callback`;
}

function cookieSpec(platform: ConnectablePlatform): OAuthStateCookie {
  return { name: `ladder_${platform}_oauth`, path: callbackPath(platform) };
}

/** 응답 본문을 에러 메시지에 그대로 흘리지 않는다 — 토큰이 섞여 나올 수 있다. */
async function providerJson<T>(url: string, init: RequestInit, codePrefix: string): Promise<T> {
  const response = await fetch(url, init);
  const text = await response.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  if (!response.ok) {
    const detail = (parsed as { error?: { message?: string }; error_description?: string } | null);
    const message = detail?.error?.message || detail?.error_description || `HTTP ${response.status}`;
    throw new ApiError(502, `${codePrefix}_API_FAILED`, message);
  }
  if (parsed === null) throw new ApiError(502, `${codePrefix}_API_FAILED`, "The platform returned an unreadable response.");
  return parsed as T;
}

// ---------------------------------------------------------------------------
// X (Twitter) — OAuth 2.0 Authorization Code with PKCE, confidential client
// ---------------------------------------------------------------------------

const xAdapter: ProviderAdapter = {
  platform: "x",
  provider: "x",
  codePrefix: "X",
  label: "X",
  // offline.access 가 있어야 refresh token이 나온다. 없으면 2시간 뒤 재로그인을 요구하게 된다.
  scopes: ["tweet.read", "tweet.write", "users.read", "offline.access"],
  usesPkce: true,
  config() {
    return {
      clientId: requireString(process.env.X_CLIENT_ID, "X_CLIENT_ID"),
      clientSecret: requireString(process.env.X_CLIENT_SECRET, "X_CLIENT_SECRET"),
    };
  },
  authorizeUrl({ clientId, redirectUri, state, verifier }) {
    const url = new URL("https://x.com/i/oauth2/authorize");
    url.search = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: xAdapter.scopes.join(" "),
      state,
      code_challenge: pkceChallenge(verifier),
      code_challenge_method: "S256",
    }).toString();
    return url.toString();
  },
  async exchangeCode({ code, verifier, redirectUri }) {
    const { clientId, clientSecret } = xAdapter.config();
    const token = await providerJson<{ access_token: string; refresh_token?: string; expires_in?: number; scope?: string }>(
      "https://api.x.com/2/oauth2/token",
      {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
        },
        body: new URLSearchParams({ code, grant_type: "authorization_code", client_id: clientId, redirect_uri: redirectUri, code_verifier: verifier }).toString(),
      },
      "X",
    );
    return {
      accessToken: token.access_token,
      refreshToken: token.refresh_token ?? null,
      expiresInSeconds: token.expires_in ?? null,
      scopes: (token.scope || "").split(" ").filter(Boolean),
    };
  },
  async fetchProfile(accessToken) {
    const me = await providerJson<{ data: { id: string; name: string; username: string; profile_image_url?: string } }>(
      "https://api.x.com/2/users/me?user.fields=profile_image_url,username",
      { headers: { authorization: `Bearer ${accessToken}` } },
      "X",
    );
    return {
      subject: me.data.id,
      externalChannelId: me.data.id,
      handle: me.data.username ? `@${me.data.username}` : null,
      displayName: me.data.name || me.data.username || "X",
      avatarUrl: me.data.profile_image_url ?? null,
    };
  },
  async refresh({ refreshToken }) {
    if (!refreshToken) throw new ApiError(401, "X_REAUTH_REQUIRED", "Reconnect X to refresh its access token.");
    const { clientId, clientSecret } = xAdapter.config();
    const token = await providerJson<{ access_token: string; refresh_token?: string; expires_in?: number; scope?: string }>(
      "https://api.x.com/2/oauth2/token",
      {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
        },
        body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: clientId }).toString(),
      },
      "X",
    );
    return {
      accessToken: token.access_token,
      // X는 갱신할 때마다 refresh token을 회전시킨다. 옛것을 그대로 두면 다음 갱신이 실패한다.
      refreshToken: token.refresh_token ?? null,
      expiresInSeconds: token.expires_in ?? null,
      scopes: (token.scope || "").split(" ").filter(Boolean),
    };
  },
};

// ---------------------------------------------------------------------------
// Threads — 단기 토큰을 받아 즉시 60일 장기 토큰으로 교환한다 (PKCE 없음)
// ---------------------------------------------------------------------------

const threadsAdapter: ProviderAdapter = {
  platform: "threads",
  provider: "meta",
  codePrefix: "THREADS",
  label: "쓰레드",
  scopes: ["threads_basic", "threads_content_publish"],
  usesPkce: false,
  config() {
    return {
      clientId: requireString(process.env.THREADS_APP_ID, "THREADS_APP_ID"),
      clientSecret: requireString(process.env.THREADS_APP_SECRET, "THREADS_APP_SECRET"),
    };
  },
  authorizeUrl({ clientId, redirectUri, state }) {
    const url = new URL("https://threads.net/oauth/authorize");
    url.search = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: threadsAdapter.scopes.join(","),
      response_type: "code",
      state,
    }).toString();
    return url.toString();
  },
  async exchangeCode({ code, redirectUri }) {
    const { clientId, clientSecret } = threadsAdapter.config();
    const short = await providerJson<{ access_token: string; user_id: string }>(
      "https://graph.threads.net/oauth/access_token",
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: "authorization_code", redirect_uri: redirectUri, code }).toString(),
      },
      "THREADS",
    );
    // 단기 토큰은 1시간짜리라 그대로 저장하면 안 된다. 바로 60일 토큰으로 바꾼다.
    const longLived = await providerJson<{ access_token: string; expires_in?: number }>(
      `https://graph.threads.net/access_token?${new URLSearchParams({ grant_type: "th_exchange_token", client_secret: clientSecret, access_token: short.access_token })}`,
      { method: "GET" },
      "THREADS",
    );
    return { accessToken: longLived.access_token, refreshToken: null, expiresInSeconds: longLived.expires_in ?? null, scopes: threadsAdapter.scopes };
  },
  async fetchProfile(accessToken) {
    const me = await providerJson<{ id: string; username?: string; name?: string; threads_profile_picture_url?: string }>(
      `https://graph.threads.net/${META_GRAPH_VERSION}/me?${new URLSearchParams({ fields: "id,username,name,threads_profile_picture_url", access_token: accessToken })}`,
      { method: "GET" },
      "THREADS",
    );
    return {
      subject: me.id,
      externalChannelId: me.id,
      handle: me.username ? `@${me.username}` : null,
      displayName: me.name || me.username || "Threads",
      avatarUrl: me.threads_profile_picture_url ?? null,
    };
  },
  async refresh({ accessToken }) {
    if (!accessToken) throw new ApiError(401, "THREADS_REAUTH_REQUIRED", "Reconnect Threads to refresh its access token.");
    const refreshed = await providerJson<{ access_token: string; expires_in?: number }>(
      `https://graph.threads.net/refresh_access_token?${new URLSearchParams({ grant_type: "th_refresh_token", access_token: accessToken })}`,
      { method: "GET" },
      "THREADS",
    );
    return { accessToken: refreshed.access_token, refreshToken: null, expiresInSeconds: refreshed.expires_in ?? null, scopes: threadsAdapter.scopes };
  },
};

// ---------------------------------------------------------------------------
// Instagram — Instagram Login (비즈니스/크리에이터 계정), Threads와 같은 장기 토큰 방식
// ---------------------------------------------------------------------------

const instagramAdapter: ProviderAdapter = {
  platform: "instagram",
  provider: "meta",
  codePrefix: "INSTAGRAM",
  label: "인스타그램",
  scopes: ["instagram_business_basic", "instagram_business_content_publish"],
  usesPkce: false,
  config() {
    return {
      clientId: requireString(process.env.INSTAGRAM_APP_ID, "INSTAGRAM_APP_ID"),
      clientSecret: requireString(process.env.INSTAGRAM_APP_SECRET, "INSTAGRAM_APP_SECRET"),
    };
  },
  authorizeUrl({ clientId, redirectUri, state }) {
    const url = new URL("https://www.instagram.com/oauth/authorize");
    url.search = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: instagramAdapter.scopes.join(","),
      response_type: "code",
      state,
    }).toString();
    return url.toString();
  },
  async exchangeCode({ code, redirectUri }) {
    const { clientId, clientSecret } = instagramAdapter.config();
    const short = await providerJson<{ access_token: string; user_id: string | number }>(
      "https://api.instagram.com/oauth/access_token",
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: "authorization_code", redirect_uri: redirectUri, code }).toString(),
      },
      "INSTAGRAM",
    );
    const longLived = await providerJson<{ access_token: string; expires_in?: number }>(
      `https://graph.instagram.com/access_token?${new URLSearchParams({ grant_type: "ig_exchange_token", client_secret: clientSecret, access_token: short.access_token })}`,
      { method: "GET" },
      "INSTAGRAM",
    );
    return { accessToken: longLived.access_token, refreshToken: null, expiresInSeconds: longLived.expires_in ?? null, scopes: instagramAdapter.scopes };
  },
  async fetchProfile(accessToken) {
    const me = await providerJson<{ user_id?: string; id?: string; username?: string; name?: string; profile_picture_url?: string }>(
      `https://graph.instagram.com/${META_GRAPH_VERSION}/me?${new URLSearchParams({ fields: "user_id,username,name,profile_picture_url", access_token: accessToken })}`,
      { method: "GET" },
      "INSTAGRAM",
    );
    const id = me.user_id || me.id;
    if (!id) throw new ApiError(502, "INSTAGRAM_API_FAILED", "Instagram did not return an account id.");
    return {
      subject: id,
      externalChannelId: id,
      handle: me.username ? `@${me.username}` : null,
      displayName: me.name || me.username || "Instagram",
      avatarUrl: me.profile_picture_url ?? null,
    };
  },
  async refresh({ accessToken }) {
    if (!accessToken) throw new ApiError(401, "INSTAGRAM_REAUTH_REQUIRED", "Reconnect Instagram to refresh its access token.");
    const refreshed = await providerJson<{ access_token: string; expires_in?: number }>(
      `https://graph.instagram.com/refresh_access_token?${new URLSearchParams({ grant_type: "ig_refresh_token", access_token: accessToken })}`,
      { method: "GET" },
      "INSTAGRAM",
    );
    return { accessToken: refreshed.access_token, refreshToken: null, expiresInSeconds: refreshed.expires_in ?? null, scopes: instagramAdapter.scopes };
  },
};

const ADAPTERS: ProviderAdapter[] = [instagramAdapter, threadsAdapter, xAdapter];

export function getAdapter(platform: string): ProviderAdapter | null {
  return ADAPTERS.find((adapter) => adapter.platform === platform) || null;
}

// ---------------------------------------------------------------------------
// 저장 · 갱신
// ---------------------------------------------------------------------------

type StoredGrant = {
  platform_oauth_grant_id: string;
  access_token_ciphertext: string | null;
  refresh_token_ciphertext: string | null;
  access_token_expires_at: string | null;
};

function expiryIso(expiresInSeconds: number | null) {
  return expiresInSeconds === null ? null : new Date(Date.now() + expiresInSeconds * 1000).toISOString();
}

async function saveGrant(
  db: ReturnType<typeof getAdminClient>,
  adapter: ProviderAdapter,
  profileId: string,
  subject: string,
  tokens: GrantTokens,
  existing: StoredGrant | null,
) {
  // X는 회전식이라 새 refresh token이 오면 반드시 덮어쓰고, 안 오면 기존 것을 지키지 않고
  // 재인증을 요구한다 — 만료된 토큰을 붙들고 있으면 다음 갱신에서 조용히 실패한다.
  const refreshCiphertext = tokens.refreshToken ? encodeCiphertext(encryptToken(tokens.refreshToken)) : null;
  const payload = {
    profile_id: profileId,
    platform: adapter.platform,
    provider: adapter.provider,
    provider_subject: subject,
    access_token_ciphertext: encodeCiphertext(encryptToken(tokens.accessToken)),
    refresh_token_ciphertext: refreshCiphertext,
    access_token_expires_at: expiryIso(tokens.expiresInSeconds),
    granted_scopes: tokens.scopes,
    status: "active" as const,
    connected_at: new Date().toISOString(),
    revoked_at: null,
    last_error_code: null,
    last_error_at: null,
  };
  const result = existing
    ? await db.from("platform_oauth_grants").update(payload).eq("platform_oauth_grant_id", existing.platform_oauth_grant_id).select("platform_oauth_grant_id").single()
    : await db.from("platform_oauth_grants").insert(payload).select("platform_oauth_grant_id").single();
  if (result.error || !result.data) throw result.error || new Error(`Unable to save ${adapter.label} credentials.`);
  return result.data.platform_oauth_grant_id as string;
}

/**
 * 만료 5분 전부터 미리 갱신한다. 정확히 만료 시각에 맞춰 쓰면 요청이 왕복하는 사이에 만료된다.
 */
export const REFRESH_SKEW_MS = 5 * 60 * 1000;

/** 만료 시각을 모르면 갱신한다 — 모르는 토큰을 유효하다고 가정하는 쪽이 훨씬 비싸다. */
export function needsRefresh(expiresAt: string | null, hasAccessToken: boolean, now = Date.now()) {
  if (!hasAccessToken) return true;
  if (!expiresAt) return true;
  const parsed = Date.parse(expiresAt);
  if (Number.isNaN(parsed)) return true;
  return parsed - REFRESH_SKEW_MS <= now;
}

export async function getAccessTokenForGrant(db: ReturnType<typeof getAdminClient>, adapter: ProviderAdapter, grant: StoredGrant) {
  if (!needsRefresh(grant.access_token_expires_at, Boolean(grant.access_token_ciphertext))) {
    return decryptToken(grant.access_token_ciphertext, adapter.codePrefix);
  }

  const tokens = await adapter.refresh({
    accessToken: grant.access_token_ciphertext ? decryptToken(grant.access_token_ciphertext, adapter.codePrefix) : null,
    refreshToken: grant.refresh_token_ciphertext ? decryptToken(grant.refresh_token_ciphertext, adapter.codePrefix) : null,
  });
  const update: Record<string, unknown> = {
    access_token_ciphertext: encodeCiphertext(encryptToken(tokens.accessToken)),
    access_token_expires_at: expiryIso(tokens.expiresInSeconds),
    last_token_refresh_at: new Date().toISOString(),
  };
  if (tokens.refreshToken) update.refresh_token_ciphertext = encodeCiphertext(encryptToken(tokens.refreshToken));
  const { error } = await db.from("platform_oauth_grants").update(update).eq("platform_oauth_grant_id", grant.platform_oauth_grant_id);
  if (error) throw error;
  return tokens.accessToken;
}

async function persistChannel(
  db: ReturnType<typeof getAdminClient>,
  adapter: ProviderAdapter,
  profileId: string,
  grantId: string,
  profile: RemoteProfile,
) {
  const payload = {
    profile_id: profileId,
    platform_oauth_grant_id: grantId,
    platform: adapter.platform,
    external_channel_id: profile.externalChannelId,
    handle: profile.handle,
    display_name: profile.displayName,
    avatar_url: profile.avatarUrl,
    status: "active" as const,
    disconnected_at: null,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await db
    .from("social_channels")
    .upsert(payload, { onConflict: "platform,external_channel_id" })
    .select("social_channel_id")
    .single();
  if (error) throw error;
  return data.social_channel_id as string;
}

// ---------------------------------------------------------------------------
// 라우트 — 어댑터마다 같은 네 개를 등록한다
// ---------------------------------------------------------------------------

export function registerSocialConnectionRoutes(app: Express) {
  for (const adapter of ADAPTERS) {
    const cookie = cookieSpec(adapter.platform);
    const redirectUri = () => callbackUrl(callbackPath(adapter.platform));

    app.get(`/api/connections/${adapter.platform}/start`, async (req: Request, res: Response) => {
      try {
        const authenticatedUser = await getAuthenticatedUser(req);
        if (!authenticatedUser) return sendError(res, 401, "UNAUTHENTICATED", "A valid session is required.");
        const { clientId } = adapter.config();
        const oauth = createOAuthState(authenticatedUser.user.id);
        setOAuthStateCookie(res, cookie, oauth.cookieValue, oauth.maxAge);
        return res.redirect(303, adapter.authorizeUrl({ clientId, redirectUri: redirectUri(), state: oauth.state, verifier: oauth.verifier }));
      } catch (error) {
        return toErrorResponse(res, error, `${adapter.codePrefix}_CONNECTION_START_FAILED`);
      }
    });

    app.get(callbackPath(adapter.platform), async (req: Request, res: Response) => {
      const denied = typeof req.query.error === "string" ? req.query.error : null;
      if (denied) {
        clearOAuthState(res, cookie);
        return redirectToApp(res, adapter.platform, "denied", denied);
      }
      const code = typeof req.query.code === "string" ? req.query.code : null;
      const state = typeof req.query.state === "string" ? req.query.state : null;
      if (!code || !state) return sendError(res, 400, `MISSING_${adapter.codePrefix}_OAUTH_CODE`, "Missing OAuth code or state.");
      try {
        const oauth = readOAuthState(req, state, cookie, adapter.codePrefix);
        clearOAuthState(res, cookie);
        const tokens = await adapter.exchangeCode({ code, verifier: oauth.verifier, redirectUri: redirectUri() });
        const profile = await adapter.fetchProfile(tokens.accessToken);
        const db = getAdminClient();
        const { data: existing, error: existingError } = await db
          .from("platform_oauth_grants")
          .select("platform_oauth_grant_id, access_token_ciphertext, refresh_token_ciphertext, access_token_expires_at")
          .eq("profile_id", oauth.profileId)
          .eq("platform", adapter.platform)
          .eq("provider", adapter.provider)
          .eq("provider_subject", profile.subject)
          .maybeSingle();
        if (existingError) throw existingError;
        const grantId = await saveGrant(db, adapter, oauth.profileId, profile.subject, tokens, existing as StoredGrant | null);
        await persistChannel(db, adapter, oauth.profileId, grantId, profile);
        return redirectToApp(res, adapter.platform, "connected");
      } catch (error) {
        clearOAuthState(res, cookie);
        console.error(`${adapter.label} OAuth callback failed:`, error);
        return redirectToApp(res, adapter.platform, "error", error instanceof ApiError ? error.code : "callback_failed");
      }
    });

    app.get(`/api/connections/${adapter.platform}`, async (req: Request, res: Response) => {
      try {
        const authenticatedUser = await getAuthenticatedUser(req);
        if (!authenticatedUser) return sendError(res, 401, "UNAUTHENTICATED", "A valid session is required.");
        const db = getAdminClient();
        const { data, error } = await db
          .from("social_channels")
          .select("social_channel_id, external_channel_id, display_name, handle, avatar_url, last_synced_at, status")
          .eq("profile_id", authenticatedUser.user.id)
          .eq("platform", adapter.platform)
          .eq("status", "active")
          .order("created_at", { ascending: true });
        if (error) throw error;
        return res.status(200).json({ platform: adapter.platform, channels: data || [] });
      } catch (error) {
        return toErrorResponse(res, error, `${adapter.codePrefix}_CONNECTIONS_FAILED`);
      }
    });

    app.delete(`/api/connections/${adapter.platform}/:channelId`, async (req: Request, res: Response) => {
      try {
        const authenticatedUser = await getAuthenticatedUser(req);
        if (!authenticatedUser) return sendError(res, 401, "UNAUTHENTICATED", "A valid session is required.");
        const db = getAdminClient();
        const { data: channel, error: channelError } = await db
          .from("social_channels")
          .select("social_channel_id, platform_oauth_grant_id")
          .eq("social_channel_id", req.params.channelId)
          .eq("profile_id", authenticatedUser.user.id)
          .eq("platform", adapter.platform)
          .maybeSingle();
        if (channelError) throw channelError;
        if (!channel) return sendError(res, 404, `${adapter.codePrefix}_CHANNEL_NOT_FOUND`, "Channel not found.");

        const { error: deleteError } = await db.from("social_channels").delete().eq("social_channel_id", channel.social_channel_id);
        if (deleteError) throw deleteError;
        if (channel.platform_oauth_grant_id) {
          // 채널이 사라지면 남은 grant는 아무도 쓰지 않는 자격증명이다. 폐기 표시하고 토큰을 지운다.
          const { error: grantError } = await db
            .from("platform_oauth_grants")
            .update({ status: "revoked", revoked_at: new Date().toISOString(), access_token_ciphertext: null, refresh_token_ciphertext: null })
            .eq("platform_oauth_grant_id", channel.platform_oauth_grant_id);
          if (grantError) throw grantError;
        }
        return res.status(204).end();
      } catch (error) {
        return toErrorResponse(res, error, `${adapter.codePrefix}_DISCONNECT_FAILED`);
      }
    });
  }
}
