import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";
import { getAppUrl } from "./auth";
import { ApiError, requireString } from "./supabaseAdmin";

/**
 * 플랫폼 공용 OAuth 부품.
 *
 * state 서명·PKCE·토큰 암호화는 플랫폼마다 복사하면 안 되는 코드다 — 네 벌이 되는 순간 한 곳만
 * 고친 채로 남는 버전이 반드시 생기고, 그게 하필 자격증명을 다루는 코드다. 제공자별로 다른 건
 * 인증 URL·토큰 교환 방식·프로필 조회뿐이라 그것만 각 어댑터가 갖는다.
 */

const STATE_TTL_MS = 10 * 60 * 1000;

export function isProduction() {
  return process.env.NODE_ENV === "production";
}

export function getCookie(req: Request, name: string) {
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

function getStateSecret() {
  return requireString(process.env.OAUTH_STATE_SECRET, "OAUTH_STATE_SECRET");
}

function signState(payload: string) {
  return createHmac("sha256", getStateSecret()).update(payload).digest("base64url");
}

export type OAuthStateCookie = { name: string; path: string };

/** 각 어댑터가 자기 쿠키 이름·콜백 경로·에러코드 접두어를 들고 이 함수들을 부른다. */
export function createOAuthState(profileId: string, extra: Record<string, unknown> = {}) {
  const verifier = randomBytes(48).toString("base64url");
  const state = randomBytes(32).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ ...extra, profileId, state, verifier, expiresAt: Date.now() + STATE_TTL_MS })).toString("base64url");
  return { state, verifier, cookieValue: `${payload}.${signState(payload)}`, maxAge: STATE_TTL_MS };
}

export function readOAuthState(req: Request, returnedState: string | null, cookie: OAuthStateCookie, codePrefix: string) {
  const value = getCookie(req, cookie.name);
  if (!value) throw new ApiError(401, `${codePrefix}_OAUTH_STATE_MISSING`, "The connection session has expired. Start the connection again.");
  const separator = value.lastIndexOf(".");
  if (separator < 0) throw new ApiError(401, `${codePrefix}_OAUTH_STATE_INVALID`, "Invalid connection state.");
  const payload = value.slice(0, separator);
  const signature = value.slice(separator + 1);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(signState(payload));
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) {
    throw new ApiError(401, `${codePrefix}_OAUTH_STATE_INVALID`, "Invalid connection state.");
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    throw new ApiError(401, `${codePrefix}_OAUTH_STATE_INVALID`, "Invalid connection state.");
  }
  if (
    typeof parsed.profileId !== "string" ||
    typeof parsed.state !== "string" ||
    typeof parsed.verifier !== "string" ||
    typeof parsed.expiresAt !== "number" ||
    parsed.expiresAt < Date.now() ||
    parsed.state !== returnedState
  ) {
    throw new ApiError(401, `${codePrefix}_OAUTH_STATE_INVALID`, "Invalid or expired connection state.");
  }
  return { profileId: parsed.profileId, verifier: parsed.verifier, extra: parsed };
}

export function setOAuthStateCookie(res: Response, cookie: OAuthStateCookie, value: string, maxAge: number) {
  res.cookie(cookie.name, value, { httpOnly: true, secure: isProduction(), sameSite: "lax", path: cookie.path, maxAge });
}

export function clearOAuthState(res: Response, cookie: OAuthStateCookie) {
  res.clearCookie(cookie.name, { httpOnly: true, secure: isProduction(), sameSite: "lax", path: cookie.path });
}

function getEncryptionKey() {
  const value = requireString(process.env.OAUTH_TOKEN_ENCRYPTION_KEY, "OAUTH_TOKEN_ENCRYPTION_KEY");
  const key = /^[0-9a-f]{64}$/i.test(value) ? Buffer.from(value, "hex") : Buffer.from(value, "base64");
  if (key.length !== 32) throw new ApiError(503, "OAUTH_NOT_CONFIGURED", "OAUTH_TOKEN_ENCRYPTION_KEY must be a 32-byte base64 or 64-character hex key.");
  return key;
}

export function encryptToken(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
}

export function decryptToken(value: string | null, codePrefix = "OAUTH") {
  if (!value) throw new ApiError(401, `${codePrefix}_REAUTH_REQUIRED`, "Reconnect this platform to refresh its access token.");
  const payload = Buffer.from(value, "base64");
  if (payload.length < 29) throw new ApiError(503, `${codePrefix}_TOKEN_INVALID`, "Stored credentials are invalid.");
  const decipher = createDecipheriv("aes-256-gcm", getEncryptionKey(), payload.subarray(0, 12));
  decipher.setAuthTag(payload.subarray(12, 28));
  return Buffer.concat([decipher.update(payload.subarray(28)), decipher.final()]).toString("utf8");
}

export function encodeCiphertext(value: Buffer) {
  return value.toString("base64");
}

export function pkceChallenge(verifier: string) {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function callbackUrl(path: string) {
  return `${getAppUrl()}${path}`;
}

/**
 * 연결 결과를 쿼리스트링으로 알리며 앱으로 돌려보낸다. 플랫폼 이름을 키로 써서 프런트가 어느
 * 연결이 끝났는지 구분한다 (?youtube=connected, ?x=denied 처럼).
 */
export function redirectToApp(res: Response, platform: string, status: "connected" | "denied" | "error", reason?: string) {
  const url = new URL(getAppUrl());
  url.searchParams.set(platform, status);
  if (reason) url.searchParams.set(`${platform}_reason`, reason);
  return res.redirect(303, url.toString());
}
