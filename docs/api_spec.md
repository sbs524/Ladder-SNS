# Ladder SNS API 명세

## 구현 현황

| 도메인 | 구현 API | 인증 |
|---|---|---|
| Health | `GET /api/health` | 불필요 |
| Authentication | OTP 요청·검증, Google OAuth, 세션·프로필 관리 | API별 상이 |
| Gemini | `POST /api/gemini/analyze`, `POST /api/gemini/advisor` | 현재 미적용 |
| YouTube 연결·동기화 | OAuth 연결, 채널 조회·해제, 동기화 작업 생성 | 필요 |
| Social comments | 댓글·이벤트 조회, SSE 스트림 | 필요 |

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
## YouTube 연결 및 동기화

YouTube 로그인은 기존 Supabase Google 로그인과 별개다. 이 도메인의 OAuth는 채널·콘텐츠·분석·댓글을 읽기 위한 Google 권한을 요청하며, 토큰은 AES-256-GCM으로 암호화한 값만 `platform_oauth_grants`에 저장한다. 클라이언트에는 Supabase service role key나 Google client secret을 전달하지 않는다.

### `GET /api/connections/youtube/start`

Google의 YouTube 권한 승인 화면으로 `303` 리다이렉트한다.

**인증**: 세션 쿠키 필요

**쿼리**

| 필드 | 필수 | 설명 |
|---|---|---|
| `include_revenue` | 아니오 | `true`이면 수익 분석 권한도 요청한다. 기본값은 `false`다. |

요청 권한은 `youtube.readonly`, `yt-analytics.readonly`이며, 수익 권한은 선택사항이다. 10분 만료의 서명된 HttpOnly state/PKCE 쿠키로 OAuth 콜백을 검증한다.

### `GET /api/connections/youtube/callback`

Google OAuth 전용 내부 콜백이다. 호출자가 직접 사용하지 않는다. 승인 후 연결된 채널을 발견해 저장하고 `initial` 동기화 작업을 큐에 추가한 뒤 `APP_URL?youtube=connected`로 리다이렉트한다.

**사전 설정**: Google Cloud OAuth Client의 Authorized redirect URI에 `<APP_URL>/api/connections/youtube/callback`을 정확히 등록해야 한다.

### `GET /api/connections/youtube`

현재 사용자가 연결한 YouTube 채널과 마지막으로 저장된 기본 지표를 반환한다.

**인증**: 세션 쿠키 필요

**200 응답**

```json
{
  "channels": [
    {
      "social_channel_id": "uuid",
      "external_channel_id": "UC...",
      "display_name": "내 채널",
      "last_synced_at": "2026-08-29T00:00:00.000Z",
      "youtube_channel_profiles": {
        "subscriber_count": 1200,
        "view_count": 40000,
        "video_count": 20
      }
    }
  ]
}
```

### `POST /api/connections/youtube/:channelId/sync`

채널 메타데이터, 업로드 영상, 최근 30일 분석 지표, 일반 댓글의 동기화 작업을 큐에 추가한다. 작업이 완료될 때까지 요청을 붙잡지 않는다.

**인증**: 세션 쿠키 필요

**202 응답**

```json
{
  "job": {
    "platform_sync_job_id": "uuid",
    "social_channel_id": "uuid",
    "job_kind": "full",
    "status": "queued"
  }
}
```

### `POST /api/connections/youtube/:channelId/comments/sync`

일반 댓글 전용 동기화 작업을 추가한다. 댓글이 비활성화된 채널·영상의 오류는 다른 채널 데이터 동기화를 실패시키지 않는다.

**인증**: 세션 쿠키 필요

**202 응답**: `POST /api/connections/youtube/:channelId/sync`와 같은 `job` 객체

### `DELETE /api/connections/youtube/:channelId`

사용자가 소유한 채널을 연결 해제한다. 해당 채널의 콘텐츠·지표·댓글·작업은 FK cascade로 삭제된다. 같은 Google grant를 쓰는 다른 채널이 없을 때만 암호화 토큰 grant도 삭제한다.

**인증**: 세션 쿠키 필요

**204 응답**: 본문 없음

## Social comments

### `GET /api/social/comments`

소유 채널의 저장된 댓글을 최신순으로 조회한다.

**인증**: 세션 쿠키 필요

**쿼리**

| 필드 | 필수 | 설명 |
|---|---|---|
| `channel_id` | 예 | `social_channels.social_channel_id` |
| `content_id` | 아니오 | 특정 영상/콘텐츠로 제한 |
| `query` | 아니오 | 작성자·본문 전체 단어 검색, 최대 100자 |
| `limit` | 아니오 | 1~100, 기본 30 |
| `cursor` | 아니오 | 이전 응답의 `next_cursor` |

**200 응답**

```json
{
  "comments": [
    {
      "social_comment_id": "uuid",
      "comment_kind": "comment",
      "author_display_name": "작성자",
      "body_text": "댓글 내용",
      "source_published_at": "2026-08-29T00:00:00.000Z"
    }
  ],
  "next_cursor": "eyJhdCI6Ii4uLiIsImlkIjoiLi4uIn0"
}
```

조회는 `source_published_at, social_comment_id` 복합 정렬을 이용한 keyset pagination이라 데이터가 커져도 이전 페이지를 건너뛰지 않는다. `query`는 `search_document` GIN 인덱스를 사용한다.

### `GET /api/social/comment-events`

동기화 과정에서 새로 발견한 댓글 이벤트를 반환한다.

**인증**: 세션 쿠키 필요

| 필드 | 필수 | 설명 |
|---|---|---|
| `channel_id` | 예 | `social_channels.social_channel_id` |
| `after` | 아니오 | ISO-8601 시각 이후 이벤트만 반환 |
| `limit` | 아니오 | 1~100, 기본 30 |

### `GET /api/social/comment-events/stream`

새 댓글 이벤트를 Server-Sent Events(SSE)로 전달한다. `channel_id`를 주면 해당 채널만 구독하고, 생략하면 현재 사용자의 연결 채널 이벤트를 구독한다.

**인증**: 세션 쿠키 필요

현재는 동일 서버 인스턴스에서 열린 스트림으로 즉시 전달한다. 여러 인스턴스 간 실시간 fan-out은 추후 Supabase Realtime 또는 Redis를 연결할 때 이 이벤트 테이블을 공통 소스로 사용한다.
