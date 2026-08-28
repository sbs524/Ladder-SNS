# Ladder SNS API 명세

## 구현 현황

| 도메인 | 구현 API | 인증 |
|---|---|---|
| Health | `GET /api/health` | 불필요 |
| Authentication | OTP 요청·검증, Google OAuth, 세션·프로필 관리 | API별 상이 |
| Gemini | `POST /api/gemini/analyze`, `POST /api/gemini/advisor` | 현재 미적용 |

인증은 Supabase Auth를 사용한다. 이메일 OTP와 Google OAuth는 모두 `auth.users`의 한 사용자에 연결되고, 앱 프로필은 `public.profiles`에 자동 생성된다.

## 공통 규칙

- Base URL: 개발 환경 `http://localhost:3000`
- 본문: `Content-Type: application/json`
- 로그인 성공 시 서버가 `HttpOnly`, `SameSite=Lax` 세션 쿠키를 설정한다. 브라우저 호출은 `credentials: 'include'`를 사용한다.
- 오류 형식:

```json
{
  "error": {
    "code": "INVALID_INPUT",
    "message": "A valid email and optional display_name are required."
  }
}
```

## Health

### `GET /api/health`

서버와 환경 변수 설정 여부를 확인한다. Supabase에 데이터를 생성하지 않는다.

**200 응답**

```json
{
  "status": "ok",
  "aiEnabled": true,
  "authEnabled": true
}
```

## Authentication

### `POST /api/auth/otp/request`

이메일 OTP를 발송한다. 신규 이메일이라면 Supabase Auth 사용자가 생성되고 DB 트리거가 `profiles` 행을 만든다. 동일 IP와 이메일 조합은 서버에서 60초마다 한 번만 요청할 수 있다.

**요청**

```json
{
  "email": "creator@example.com",
  "display_name": "홍길동"
}
```

| 필드 | 필수 | 제약 |
|---|---|---|
| `email` | 예 | 유효한 이메일, 최대 254자 |
| `display_name` | 아니오 | 신규 사용자의 초기 이름, 1~100자 |

**202 응답**

```json
{
  "message": "If the email address can receive messages, a sign-in code has been sent.",
  "expires_in_seconds": 300
}
```

**오류**: `400 INVALID_INPUT`, `429 OTP_RATE_LIMITED`, `4xx OTP_REQUEST_FAILED`, `503 AUTH_UNAVAILABLE`

> 신규 사용자는 Confirm Signup 템플릿, 기존 사용자는 Magic Link or OTP 템플릿을 사용한다. 두 템플릿 모두 6자리 OTP 본문으로 구성해야 한다.

### `POST /api/auth/otp/verify`

OTP를 검증하고 세션 쿠키를 설정한다.

**요청**

```json
{
  "email": "creator@example.com",
  "token": "123456"
}
```

**200 응답**

```json
{
  "profile": {
    "profile_id": "uuid",
    "display_name": "홍길동",
    "avatar_url": null,
    "user_type": null,
    "onboarding_completed_at": null,
    "created_at": "2026-08-28T00:00:00.000Z",
    "updated_at": "2026-08-28T00:00:00.000Z"
  },
  "user": {
    "profile_id": "uuid",
    "email": "creator@example.com",
    "email_confirmed_at": "2026-08-28T00:00:00.000Z"
  }
}
```

**오류**: `400 INVALID_INPUT`, `401 OTP_VERIFICATION_FAILED`, `503 AUTH_UNAVAILABLE`

### `GET /api/auth/google`

Google OAuth를 시작한다. Google 로그인 화면으로 `303` 리다이렉트한다.

**인증**: 불필요

**사전 설정**

- Supabase Dashboard → Authentication → Providers → Google 활성화
- Supabase URL Configuration의 Redirect URLs에 `<APP_URL>/api/auth/callback` 등록
- Google Cloud Console의 Authorized redirect URI에 `https://<project-ref>.supabase.co/auth/v1/callback` 등록

### `GET /api/auth/callback`

Supabase의 OAuth 인가 코드를 받는 내부 콜백이다. 10분짜리 HttpOnly PKCE verifier 쿠키로 세션을 교환한 뒤, 세션 쿠키를 설정하고 `APP_URL`로 `303` 리다이렉트한다.

**쿼리**: `code` (필수, Supabase가 전달)

**오류**: `400 MISSING_OAUTH_CODE`, `401 GOOGLE_CALLBACK_FAILED`, `503 AUTH_UNAVAILABLE`

### `GET /api/auth/me`

현재 사용자와 해당 `profiles` 레코드를 반환한다.

**인증**: 세션 쿠키 필요

**200 응답**: `POST /api/auth/otp/verify`의 응답과 같다.

**오류**: `401 UNAUTHENTICATED`, `503 AUTH_UNAVAILABLE`

### `PATCH /api/auth/me/profile`

현재 사용자의 서비스 프로필을 변경한다. `profile_id`, 이메일, OAuth 식별자는 수정할 수 없다.

**인증**: 세션 쿠키 필요

**요청**

```json
{
  "display_name": "새 이름",
  "user_type": "individual",
  "onboarding_completed": true
}
```

| 필드 | 허용 값 | 설명 |
|---|---|---|
| `display_name` | 1~100자 문자열 | 대시보드 표시 이름 |
| `user_type` | `individual`, `team`, `enterprise` | 관리 주체 |
| `onboarding_completed` | boolean | `true`면 완료 시각 기록, `false`면 완료 시각 삭제 |

**200 응답**

```json
{
  "profile": {
    "profile_id": "uuid",
    "display_name": "새 이름",
    "user_type": "individual"
  }
}
```

**오류**: `400 INVALID_INPUT`, `401 UNAUTHENTICATED`, `4xx PROFILE_UPDATE_FAILED`, `503 AUTH_UNAVAILABLE`

### `POST /api/auth/session/refresh`

Refresh token 쿠키로 세션을 갱신하고 새 HttpOnly 쿠키를 설정한다.

**인증**: refresh token 쿠키 필요

**204 응답**: 본문 없음

**오류**: `401 UNAUTHENTICATED` 또는 `SESSION_REFRESH_FAILED`, `503 AUTH_UNAVAILABLE`

### `POST /api/auth/logout`

현재 브라우저의 세션 쿠키를 삭제하고 Supabase의 로컬 세션 로그아웃을 시도한다.

**204 응답**: 본문 없음

## Gemini

### `POST /api/gemini/analyze`

채널 종합 분석을 요청한다. 현재 레거시 프로토타입 API이며 회원가입 인증은 아직 적용되지 않았다.

### `POST /api/gemini/advisor`

AI 컨설턴트 질의를 요청한다. 현재 레거시 프로토타입 API이며 회원가입 인증은 아직 적용되지 않았다.
