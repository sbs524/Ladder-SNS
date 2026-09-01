export type AuthUser = {
  profile_id: string;
  email: string | null;
  email_confirmed_at: string | null;
};

export type BillingPlan = 'free' | 'plus';
export type SocialPlatform = 'youtube' | 'instagram' | 'threads' | 'x';

export type AuthProfile = {
  profile_id: string;
  display_name: string | null;
  avatar_url: string | null;
  user_type: 'individual' | 'team' | 'enterprise' | null;
  /** 서버가 늘 내려보내는 값이다. 요금제는 서비스 롤로만 바뀌므로 클라이언트는 읽기만 한다. */
  plan: BillingPlan;
  ai_credits: number;
  selected_platforms: SocialPlatform[];
  onboarding_completed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type AuthSessionResponse = {
  user: AuthUser;
  profile: AuthProfile | null;
};

type ApiErrorPayload = { error?: { message?: string } };

function send(path: string, init: RequestInit) {
  return fetch(path, {
    credentials: 'include',
    ...init,
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  });
}

/**
 * 액세스 토큰 쿠키는 1시간이면 만료된다. refresh 토큰 쿠키는 30일이라 세션 자체는 살아 있으므로,
 * 401을 만나면 조용히 갱신하고 원래 요청을 한 번만 다시 보낸다. 이게 없으면 사용자는 로그아웃한
 * 적이 없는데도 한 시간 뒤 새로고침에서 로그인 화면을 만난다.
 *
 * 갱신 요청 자신은 재시도하지 않는다 — 무한 루프가 된다.
 */
let refreshInFlight: Promise<boolean> | null = null;

export function refreshSession(): Promise<boolean> {
  // 동시에 401이 여러 개 나도 갱신은 한 번만 한다.
  refreshInFlight ??= send('/api/auth/session/refresh', { method: 'POST' })
    .then((response) => response.ok)
    .catch(() => false)
    .finally(() => {
      refreshInFlight = null;
    });
  return refreshInFlight;
}

async function request<T>(path: string, init: RequestInit = {}, allowRetry = true): Promise<T> {
  let response = await send(path, init);

  if (response.status === 401 && allowRetry && path !== '/api/auth/session/refresh') {
    if (await refreshSession()) response = await send(path, init);
  }

  const body = response.headers.get('content-type')?.includes('application/json')
    ? ((await response.json()) as T & ApiErrorPayload)
    : null;

  if (!response.ok) {
    throw new Error(body?.error?.message || '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.');
  }
  return body as T;
}

export function requestEmailOtp(email: string) {
  return request<{ message: string; expires_in_seconds: number }>('/api/auth/otp/request', {
    method: 'POST',
    body: JSON.stringify({ email }),
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
  selected_platforms?: SocialPlatform[];
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

// Bypasses request(): a FormData body must not get a manually-set Content-Type header (the browser
// sets its own multipart boundary), but request() always adds 'Content-Type: application/json'
// whenever a body is present.
export function uploadAvatar(file: File) {
  const formData = new FormData();
  formData.append('avatar', file);
  return fetch('/api/auth/me/avatar', { method: 'POST', credentials: 'include', body: formData }).then(async (response) => {
    const body = response.headers.get('content-type')?.includes('application/json')
      ? ((await response.json()) as { profile: AuthProfile } & ApiErrorPayload)
      : null;
    if (!response.ok) throw new Error(body?.error?.message || '이미지를 업로드하지 못했습니다.');
    return body as { profile: AuthProfile };
  });
}

export function deleteAccount() {
  return request<void>('/api/auth/me', { method: 'DELETE' });
}

export function beginGoogleSignIn() {
  window.location.assign('/api/auth/google');
}
