export type AuthUser = {
  profile_id: string;
  email: string | null;
  email_confirmed_at: string | null;
};

export type AuthProfile = {
  profile_id: string;
  display_name: string | null;
  avatar_url: string | null;
  user_type: 'individual' | 'team' | 'enterprise' | null;
  onboarding_completed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type AuthSessionResponse = {
  user: AuthUser;
  profile: AuthProfile | null;
};

type ApiErrorPayload = { error?: { message?: string } };

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    credentials: 'include',
    ...init,
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  });
  const body = response.headers.get('content-type')?.includes('application/json')
    ? ((await response.json()) as T & ApiErrorPayload)
    : null;

  if (!response.ok) {
    throw new Error(body?.error?.message || '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.');
  }
  return body as T;
}

export function requestEmailOtp(email: string, displayName?: string) {
  return request<{ message: string; expires_in_seconds: number }>('/api/auth/otp/request', {
    method: 'POST',
    body: JSON.stringify({ email, ...(displayName ? { display_name: displayName } : {}) }),
  });
}

export function verifyEmailOtp(email: string, token: string) {
  return request<AuthSessionResponse>('/api/auth/otp/verify', {
    method: 'POST',
    body: JSON.stringify({ email, token }),
  });
}

export function getCurrentSession() {
  return request<AuthSessionResponse>('/api/auth/me');
}

export function updateCurrentProfile(changes: {
  display_name?: string;
  user_type?: 'individual' | 'team' | 'enterprise';
  onboarding_completed?: boolean;
}) {
  return request<{ profile: AuthProfile }>('/api/auth/me/profile', {
    method: 'PATCH',
    body: JSON.stringify(changes),
  });
}

export function logout() {
  return request<void>('/api/auth/logout', { method: 'POST' });
}

export function beginGoogleSignIn() {
  window.location.assign('/api/auth/google');
}
