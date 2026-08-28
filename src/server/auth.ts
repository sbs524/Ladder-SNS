import type { Express, Request, Response } from "express";
import { createClient, type Session, type User } from "@supabase/supabase-js";

type UserType = "individual" | "team" | "enterprise";

type Profile = {
  profile_id: string;
  display_name: string | null;
  avatar_url: string | null;
  user_type: UserType | null;
  onboarding_completed_at: string | null;
  created_at: string;
  updated_at: string;
};

type AuthenticatedUser = { user: User; accessToken: string };

const ACCESS_TOKEN_COOKIE = "ladder_access_token";
const REFRESH_TOKEN_COOKIE = "ladder_refresh_token";
const OAUTH_PKCE_COOKIE = "ladder_oauth_pkce";
const OTP_COOLDOWN_MS = 60_000;
const OTP_EXPIRY_SECONDS = 300;
const otpRequests = new Map<string, number>();

function getAuthConfig() {
  const url = process.env.VITE_SUPABASE_URL;
  const publishableKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) throw new Error("Supabase authentication is not configured.");
  return { url, publishableKey };
}

function getAppUrl() {
  return (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
}

function isProduction() {
  return process.env.NODE_ENV === "production";
}

function readCookie(req: Request, name: string) {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return null;

  for (const part of cookieHeader.split(";")) {
    const separatorIndex = part.indexOf("=");
    if (separatorIndex < 0 || part.slice(0, separatorIndex).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(separatorIndex + 1));
    } catch {
      return null;
    }
  }
  return null;
}

function sessionCookieOptions(maxAge?: number) {
  return {
    httpOnly: true,
    secure: isProduction(),
    sameSite: "lax" as const,
    path: "/",
    ...(maxAge ? { maxAge } : {}),
  };
}

function setSessionCookies(res: Response, session: Session) {
  res.cookie(
    ACCESS_TOKEN_COOKIE,
    session.access_token,
    sessionCookieOptions(session.expires_in ? session.expires_in * 1000 : undefined),
  );
  res.cookie(REFRESH_TOKEN_COOKIE, session.refresh_token, sessionCookieOptions(30 * 24 * 60 * 60 * 1000));
}

function clearSessionCookies(res: Response) {
  res.clearCookie(ACCESS_TOKEN_COOKIE, sessionCookieOptions());
  res.clearCookie(REFRESH_TOKEN_COOKIE, sessionCookieOptions());
}

function oauthPkceStorage(req: Request, res: Response) {
  return {
    getItem: async (key: string) => (key.includes("code-verifier") ? readCookie(req, OAUTH_PKCE_COOKIE) : null),
    setItem: async (key: string, value: string) => {
      if (!key.includes("code-verifier")) return;
      res.cookie(OAUTH_PKCE_COOKIE, value, {
        httpOnly: true,
        secure: isProduction(),
        sameSite: "lax" as const,
        path: "/api/auth/callback",
        maxAge: 10 * 60 * 1000,
      });
    },
    removeItem: async (key: string) => {
      if (!key.includes("code-verifier")) return;
      res.clearCookie(OAUTH_PKCE_COOKIE, {
        httpOnly: true,
        secure: isProduction(),
        sameSite: "lax" as const,
        path: "/api/auth/callback",
      });
    },
  };
}

function createSupabaseClient(accessToken?: string) {
  const { url, publishableKey } = getAuthConfig();
  return createClient(url, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: accessToken ? { headers: { Authorization: `Bearer ${accessToken}` } } : undefined,
  });
}

function createOAuthClient(req: Request, res: Response) {
  const { url, publishableKey } = getAuthConfig();
  return createClient(url, publishableKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: true,
      detectSessionInUrl: false,
      flowType: "pkce",
      storage: oauthPkceStorage(req, res),
    },
  });
}

function readEmail(value: unknown) {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function readDisplayName(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") return null;
  const displayName = value.trim();
  return displayName.length >= 1 && displayName.length <= 100 ? displayName : null;
}

function readUserType(value: unknown): UserType | null {
  return value === "individual" || value === "team" || value === "enterprise" ? value : null;
}

function errorStatus(error: unknown) {
  const status = typeof error === "object" && error !== null ? (error as { status?: unknown }).status : undefined;
  return typeof status === "number" && status >= 400 && status < 600 ? status : 502;
}

function errorMessage(error: unknown) {
  const message = typeof error === "object" && error !== null ? (error as { message?: unknown }).message : undefined;
  return typeof message === "string" && message ? message : "Authentication service is temporarily unavailable.";
}

function sendError(res: Response, status: number, code: string, message: string) {
  return res.status(status).json({ error: { code, message } });
}

function isOtpRequestRateLimited(req: Request, email: string) {
  const now = Date.now();
  for (const [key, requestedAt] of otpRequests) {
    if (requestedAt < now - OTP_COOLDOWN_MS) otpRequests.delete(key);
  }
  const key = `${req.ip}:${email}`;
  if (otpRequests.has(key)) return true;
  otpRequests.set(key, now);
  return false;
}

async function getAuthenticatedUser(req: Request): Promise<AuthenticatedUser | null> {
  const accessToken = readCookie(req, ACCESS_TOKEN_COOKIE);
  if (!accessToken) return null;
  const { data, error } = await createSupabaseClient().auth.getUser(accessToken);
  return error || !data.user ? null : { user: data.user, accessToken };
}

async function getProfile(accessToken: string, profileId: string): Promise<Profile | null> {
  const { data, error } = await createSupabaseClient(accessToken)
    .from("profiles")
    .select("profile_id, display_name, avatar_url, user_type, onboarding_completed_at, created_at, updated_at")
    .eq("profile_id", profileId)
    .maybeSingle();
  if (error) throw error;
  return data as Profile | null;
}

function serializeUser(user: User, profile: Profile | null) {
  return {
    profile,
    user: {
      profile_id: user.id,
      email: user.email ?? null,
      email_confirmed_at: user.email_confirmed_at ?? null,
    },
  };
}

export function registerAuthRoutes(app: Express) {
  app.post("/api/auth/otp/request", async (req, res) => {
    const email = readEmail(req.body?.email);
    const displayName = readDisplayName(req.body?.display_name);
    if (!email || displayName === null) {
      return sendError(res, 400, "INVALID_INPUT", "A valid email and optional display_name are required.");
    }
    if (isOtpRequestRateLimited(req, email)) {
      return sendError(res, 429, "OTP_RATE_LIMITED", "Please wait one minute before requesting another code.");
    }

    try {
      const { error } = await createSupabaseClient().auth.signInWithOtp({
        email,
        options: {
          shouldCreateUser: true,
          emailRedirectTo: getAppUrl(),
          ...(displayName ? { data: { full_name: displayName } } : {}),
        },
      });
      if (error) return sendError(res, errorStatus(error), "OTP_REQUEST_FAILED", errorMessage(error));
      return res.status(202).json({
        message: "If the email address can receive messages, a sign-in code has been sent.",
        expires_in_seconds: OTP_EXPIRY_SECONDS,
      });
    } catch (error) {
      return sendError(res, 503, "AUTH_UNAVAILABLE", errorMessage(error));
    }
  });

  app.post("/api/auth/otp/verify", async (req, res) => {
    const email = readEmail(req.body?.email);
    const token = typeof req.body?.token === "string" ? req.body.token.trim() : "";
    if (!email || !/^\d{6}$/.test(token)) {
      return sendError(res, 400, "INVALID_INPUT", "A valid email and six-digit verification code are required.");
    }

    try {
      let otpResult = await createSupabaseClient().auth.verifyOtp({ email, token, type: "email" });
      if (otpResult.error || !otpResult.data.session || !otpResult.data.user) {
        otpResult = await createSupabaseClient().auth.verifyOtp({ email, token, type: "signup" });
      }
      const { data, error } = otpResult;
      if (error || !data.session || !data.user) {
        return sendError(res, error ? errorStatus(error) : 401, "OTP_VERIFICATION_FAILED", error ? errorMessage(error) : "Invalid verification code.");
      }
      setSessionCookies(res, data.session);
      return res.status(200).json(serializeUser(data.user, await getProfile(data.session.access_token, data.user.id)));
    } catch (error) {
      return sendError(res, 503, "AUTH_UNAVAILABLE", errorMessage(error));
    }
  });

  app.get("/api/auth/google", async (req, res) => {
    try {
      const { data, error } = await createOAuthClient(req, res).auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${getAppUrl()}/api/auth/callback`,
          scopes: "openid email profile",
          skipBrowserRedirect: true,
        },
      });
      if (error || !data.url) {
        return sendError(res, error ? errorStatus(error) : 502, "GOOGLE_SIGN_IN_FAILED", error ? errorMessage(error) : "Unable to start Google sign-in.");
      }
      return res.redirect(303, data.url);
    } catch (error) {
      return sendError(res, 503, "AUTH_UNAVAILABLE", errorMessage(error));
    }
  });

  app.get("/api/auth/callback", async (req, res) => {
    const code = typeof req.query.code === "string" ? req.query.code : null;
    if (!code) return sendError(res, 400, "MISSING_OAUTH_CODE", "Missing OAuth authorization code.");
    try {
      const { data, error } = await createOAuthClient(req, res).auth.exchangeCodeForSession(code);
      if (error || !data.session) {
        return sendError(res, error ? errorStatus(error) : 401, "GOOGLE_CALLBACK_FAILED", error ? errorMessage(error) : "Google sign-in could not be completed.");
      }
      setSessionCookies(res, data.session);
      return res.redirect(303, getAppUrl());
    } catch (error) {
      return sendError(res, 503, "AUTH_UNAVAILABLE", errorMessage(error));
    }
  });

  app.get("/api/auth/me", async (req, res) => {
    try {
      const authenticatedUser = await getAuthenticatedUser(req);
      if (!authenticatedUser) return sendError(res, 401, "UNAUTHENTICATED", "A valid session is required.");
      return res.status(200).json(serializeUser(authenticatedUser.user, await getProfile(authenticatedUser.accessToken, authenticatedUser.user.id)));
    } catch (error) {
      return sendError(res, 503, "AUTH_UNAVAILABLE", errorMessage(error));
    }
  });

  app.patch("/api/auth/me/profile", async (req, res) => {
    const displayName = readDisplayName(req.body?.display_name);
    const userType = req.body?.user_type === undefined ? undefined : readUserType(req.body.user_type);
    const onboardingCompleted = req.body?.onboarding_completed;
    if (
      displayName === null ||
      userType === null ||
      (onboardingCompleted !== undefined && typeof onboardingCompleted !== "boolean") ||
      (displayName === undefined && userType === undefined && onboardingCompleted === undefined)
    ) {
      return sendError(res, 400, "INVALID_INPUT", "Provide valid profile fields to update.");
    }

    try {
      const authenticatedUser = await getAuthenticatedUser(req);
      if (!authenticatedUser) return sendError(res, 401, "UNAUTHENTICATED", "A valid session is required.");
      const changes: Record<string, string | UserType | null> = {};
      if (displayName !== undefined) changes.display_name = displayName;
      if (userType !== undefined) changes.user_type = userType;
      if (onboardingCompleted !== undefined) changes.onboarding_completed_at = onboardingCompleted ? new Date().toISOString() : null;
      const { data, error } = await createSupabaseClient(authenticatedUser.accessToken)
        .from("profiles")
        .update(changes)
        .eq("profile_id", authenticatedUser.user.id)
        .select("profile_id, display_name, avatar_url, user_type, onboarding_completed_at, created_at, updated_at")
        .single();
      if (error) return sendError(res, errorStatus(error), "PROFILE_UPDATE_FAILED", errorMessage(error));
      return res.status(200).json({ profile: data as Profile });
    } catch (error) {
      return sendError(res, 503, "AUTH_UNAVAILABLE", errorMessage(error));
    }
  });

  app.post("/api/auth/session/refresh", async (req, res) => {
    const refreshToken = readCookie(req, REFRESH_TOKEN_COOKIE);
    if (!refreshToken) return sendError(res, 401, "UNAUTHENTICATED", "A refresh token is required.");
    try {
      const { data, error } = await createSupabaseClient().auth.refreshSession({ refresh_token: refreshToken });
      if (error || !data.session) {
        clearSessionCookies(res);
        return sendError(res, error ? errorStatus(error) : 401, "SESSION_REFRESH_FAILED", error ? errorMessage(error) : "Your session has expired.");
      }
      setSessionCookies(res, data.session);
      return res.status(204).send();
    } catch (error) {
      clearSessionCookies(res);
      return sendError(res, 503, "AUTH_UNAVAILABLE", errorMessage(error));
    }
  });

  app.post("/api/auth/logout", async (req, res) => {
    const refreshToken = readCookie(req, REFRESH_TOKEN_COOKIE);
    const accessToken = readCookie(req, ACCESS_TOKEN_COOKIE);
    clearSessionCookies(res);
    if (refreshToken && accessToken) {
      try {
        const client = createSupabaseClient();
        await client.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
        await client.auth.signOut({ scope: "local" });
      } catch {
        // The local application session is already removed by clearing its cookies.
      }
    }
    return res.status(204).send();
  });
}
