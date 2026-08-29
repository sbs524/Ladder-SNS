import type { Response } from "express";
import { createClient } from "@supabase/supabase-js";

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

export function requireString(value: string | undefined, name: string) {
  if (!value) throw new ApiError(503, "SERVICE_NOT_CONFIGURED", `${name} is not configured.`);
  return value;
}

export function getSupabaseConfig() {
  return {
    url: requireString(process.env.VITE_SUPABASE_URL, "VITE_SUPABASE_URL"),
    serviceRoleKey: requireString(process.env.SUPABASE_SERVICE_ROLE_KEY, "SUPABASE_SERVICE_ROLE_KEY"),
  };
}

export function getAdminClient() {
  const { url, serviceRoleKey } = getSupabaseConfig();
  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}

function sendError(res: Response, status: number, code: string, message: string) {
  return res.status(status).json({ error: { code, message } });
}

export function toErrorResponse(res: Response, error: unknown, fallbackCode: string) {
  if (error instanceof ApiError) return sendError(res, error.status, error.code, error.message);
  console.error("Server error:", error);
  return sendError(res, 503, fallbackCode, "This feature is temporarily unavailable.");
}
