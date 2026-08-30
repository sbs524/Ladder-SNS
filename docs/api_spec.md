# Ladder SNS API 명세

## 구현 현황

| 도메인 | 구현 API | 인증 |
|---|---|---|
| Health | `GET /api/health` | 불필요 |
| Authentication | OTP 요청·검증, Google OAuth, 세션·프로필 관리, 아바타 업로드, 회원탈퇴 | API별 상이 |
| Gemini | `POST /api/gemini/analyze`, `POST /api/gemini/advisor` | 현재 미적용 |
| YouTube 연결·동기화 | OAuth 연결, 채널 조회·해제, 동기화 작업 생성, 원본 데이터 조회, 영상 수정·삭제, 댓글 답글·모더레이션 | 필요 |
| Metrics | 대시보드 통합 지표 조회, AI 분석용 심층 지표 조회 | 필요 |
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

현재 사용자의 서비스 프로필을 변경한다. `profile_id`, 이메일, OAuth 식별자는 수정할 수 없다. `avatar_url`도 이 API로는 바꿀 수 없으며, 프로필 이미지는 `POST /api/auth/me/avatar` 전용 엔드포인트로만 변경한다.

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

**오류**: `400 INVALID_INPUT`(`avatar_url` 필드를 포함한 경우도 해당), `401 UNAUTHENTICATED`, `4xx PROFILE_UPDATE_FAILED`, `503 AUTH_UNAVAILABLE`

### `POST /api/auth/me/avatar`

프로필 이미지를 업로드하거나 교체한다. 이미지는 Supabase Storage의 `avatars` 버킷(공개 읽기)에 사용자당 하나의 고정 경로(`<profile_id>.<ext>`)로 저장되며, 재업로드 시 기존 파일을 덮어쓴다. 서버는 서비스 role 키로만 버킷에 쓴다.

**인증**: 세션 쿠키 필요

**요청**: `multipart/form-data`, 필드명 `avatar`

| 제약 | 값 |
|---|---|
| 허용 포맷 | `image/png`, `image/jpeg`, `image/webp` |
| 최대 크기 | 2MB |

**200 응답**: `PATCH /api/auth/me/profile`과 같은 `profile` 객체. `avatar_url`에는 캐시 무효화용 쿼리 파라미터(`?v=<timestamp>`)가 붙는다.

**오류**: `400 INVALID_AVATAR`(포맷 불일치 또는 파일 없음), `400 AVATAR_TOO_LARGE`, `401 UNAUTHENTICATED`, `503 AVATAR_UPLOAD_FAILED`

### `DELETE /api/auth/me`

회원탈퇴. 계정을 완전히 삭제하지 않고 다음 순서로 처리한다: (1) Supabase Auth 사용자를 사실상 영구히 ban 처리해 이후 로그인·재가입을 막는다, (2) 연결된 YouTube OAuth 토큰을 Google에 best-effort로 revoke하고 채널·콘텐츠·지표·댓글 등 관련 데이터를 즉시 삭제한다, (3) `profiles`는 삭제하지 않고 `display_name`·`avatar_url`을 비운 뒤 `deleted_at`을 기록해 익명화만 한다(추후 결제·크레딧 감사 추적 보존 목적), (4) 현재 브라우저의 세션 쿠키를 지운다. 각 단계는 재시도해도 안전하다(멱등).

**인증**: 세션 쿠키 필요

**204 응답**: 본문 없음

**오류**: `401 UNAUTHENTICATED`, `503 ACCOUNT_DELETION_FAILED`

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

YouTube 로그인은 기존 Supabase Google 로그인과 별개다. 이 도메인의 OAuth는 채널·콘텐츠·분석·댓글을 읽고 쓰기 위한 Google 권한(`youtube.force-ssl`)을 요청하며, 토큰은 AES-256-GCM으로 암호화한 값만 `platform_oauth_grants`에 저장한다. 클라이언트에는 Supabase service role key나 Google client secret을 전달하지 않는다.

`youtube.force-ssl` 권한이 도입되기 전에 연결된 채널은 `youtube.readonly`만 가지고 있어 아래 쓰기 라우트(영상 수정·삭제, 댓글 답글·모더레이션)를 호출하면 `403 YOUTUBE_SCOPE_INSUFFICIENT`가 반환된다 — 사용자가 `GET /api/connections/youtube/start`로 채널을 다시 연결(재동의)해야 해결된다.

### `GET /api/connections/youtube/start`

Google의 YouTube 권한 승인 화면으로 `303` 리다이렉트한다.

**인증**: 세션 쿠키 필요

**쿼리**

| 필드 | 필수 | 설명 |
|---|---|---|
| `include_revenue` | 아니오 | `true`이면 수익 분석 권한도 요청한다. 기본값은 `false`다. |

요청 권한은 `youtube.force-ssl`, `yt-analytics.readonly`이며, 수익 권한은 선택사항이다. 10분 만료의 서명된 HttpOnly state/PKCE 쿠키로 OAuth 콜백을 검증한다.

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
      },
      "can_manage_content": true
    }
  ]
}
```

`can_manage_content`는 이 채널의 grant에 `youtube.force-ssl` 스코프가 포함되어 있는지를 나타낸다. `false`면 영상 수정·삭제, 댓글 답글·모더레이션 라우트가 모두 `403`을 반환하므로 프런트는 이 값으로 해당 UI를 감춘다.

### `GET /api/connections/youtube/:channelId/raw-data`

이 채널에 대해 지금까지 동기화된 채널 프로필, 영상, 일별 지표, 분석 breakdown, 댓글을 가공 없이 전부 반환한다. "원본 데이터" 페이지가 이 응답으로 개요/영상 관리/분석 탭을 채운다.

**인증**: 세션 쿠키 필요, 채널 소유자만 조회 가능

**200 응답**: `{ channel, videos, daily_metrics, breakdowns, comments }` — 각 필드는 해당 테이블의 전체 컬럼을 그대로 담은 배열/객체다.

### `PATCH /api/connections/youtube/:channelId/videos/:contentId`

영상의 제목·설명을 수정하고 Google `videos.update`로 실제 YouTube에 반영한다.

**인증**: 세션 쿠키 필요, `can_manage_content`가 `true`인 채널만 가능(아니면 `403 YOUTUBE_SCOPE_INSUFFICIENT`)

**본문**: `{ "title"?: string, "description"?: string }` — 최소 하나 필수. 제목 100자, 설명 5000자 제한.

**200 응답**: `{ "video": { "social_content_id": "uuid", "title": "...", "body_text": "..." } }`

### `DELETE /api/connections/youtube/:channelId/videos/:contentId`

Google `videos.delete`로 영상을 영구 삭제하고, 로컬 `social_contents.visibility`를 `deleted`로 표시한다. 되돌릴 수 없다.

**인증**: 세션 쿠키 필요, `can_manage_content` 필요

**204 응답**: 본문 없음

### `POST /api/connections/youtube/:channelId/comments/:commentId/reply`

시청자 댓글에 채널 소유자로서 답글(대댓글)을 작성한다. 대상이 이미 답글이면 그 답글의 원본 top-level 댓글에 답글이 달린다(YouTube가 답글의 답글을 지원하지 않음).

**인증**: 세션 쿠키 필요, `can_manage_content` 필요

**본문**: `{ "body": string }` (1~10,000자)

**201 응답**: `{ "comment": { ...새로 저장된 답글 행... } }`

### `PATCH /api/connections/youtube/:channelId/comments/:commentId/moderate`

댓글을 숨기거나 삭제한다.

**인증**: 세션 쿠키 필요, `can_manage_content` 필요

**본문**: `{ "action": "hide" | "delete" }` — `hide`는 Google `comments.setModerationStatus(rejected)`를 호출하고 로컬 `visibility_status`를 `hidden`으로, `delete`는 Google `comments.delete`(영구)를 호출하고 `deleted`로 표시한다.

**204 응답**: 본문 없음

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


---

## Metrics

### `GET /api/metrics/overview`

대시보드 한 화면이 필요로 하는 모든 집계를 한 번에 반환한다. 연동된 모든 플랫폼의 채널을 대상으로 하며, 연동되지 않은 플랫폼도 `connected: false`로 함께 내려간다.

**인증**: 세션 쿠키 필요

| 쿼리 | 필수 | 설명 |
|---|---|---|
| `range` | 아니오 | `7d`(기본) 또는 `30d`. 집계 기간 |

**계산 규칙**

| 지표 | 정의 |
|---|---|
| `totals.engagementRate`, `platforms[].engagementRate` | `(좋아요 + 댓글 + 공유) / 조회수 × 100`, 기간 합계 기준 |
| `totals.views`, `platforms[].views` | `youtube_channel_daily_metrics.views`의 기간 합계 |
| `totals.growthPercent`, `platforms[].viewsChangePercent` | 현재 기간 조회수 vs 직전 동일 길이 기간 조회수. **비교 기준이 0이면 `null`** |
| `platforms[].followers` | `youtube_channel_profiles.subscriber_count` 현재 스냅샷 합계 (기간 무관) |
| `platforms[].followersChange` | 기간 내 `subscribers_gained - subscribers_lost` |

`chart`는 기간 내 모든 날짜를 하루 단위로 채워서 반환한다. 동기화된 데이터가 없는 날도 `0`으로 포함되므로 클라이언트에서 빈 구간을 보정할 필요가 없다.

**200 응답**

```json
{
  "range": "7d",
  "days": 7,
  "hasData": true,
  "connectedCount": 1,
  "totals": {
    "followers": 175,
    "views": 1284,
    "engagementRate": 6.4,
    "growthPercent": 12.3
  },
  "platforms": [
    {
      "platform": "youtube",
      "connected": true,
      "channelCount": 1,
      "handle": "@타루-니케조아",
      "displayName": "TARU",
      "avatarUrl": "https://...",
      "followers": 175,
      "followersChange": 3,
      "views": 1284,
      "viewsChangePercent": 12.3,
      "engagementRate": 6.4,
      "postsCount": 16,
      "lastSyncedAt": "2026-08-30T09:12:00.000Z"
    },
    { "platform": "instagram", "connected": false, "channelCount": 0, "followers": 0, "views": 0, "viewsChangePercent": null, "engagementRate": 0, "postsCount": 0, "handle": null, "displayName": null, "avatarUrl": null, "followersChange": 0, "lastSyncedAt": null }
  ],
  "chart": [
    { "date": "8/24", "isoDate": "2026-08-24", "total": 152, "youtube": 152, "instagram": 0, "threads": 0, "x": 0 }
  ],
  "recentPosts": [
    {
      "id": "9f0c...",
      "platform": "youtube",
      "title": "영상 제목",
      "publishedAt": "2026-08-28T11:00:00.000Z",
      "permalink": "https://www.youtube.com/watch?v=...",
      "thumbnailUrl": "https://...",
      "views": 420,
      "likes": 31,
      "comments": 7,
      "shares": 0
    }
  ]
}
```

`shares`는 콘텐츠 단위로는 YouTube API에서 제공되지 않아 항상 `0`이다. 채널 단위 공유 수는 Analytics API에서 받아 `engagementRate` 계산에는 반영된다.

새 플랫폼을 추가할 때는 `social_channels`에 채널 행을 만들고 `src/server/metrics.ts`의 `loadDailyMetrics()`에 해당 플랫폼의 일별 지표 소스를 더하면 이 엔드포인트가 자동으로 집계한다.

### `GET /api/metrics/insights`

AI 분석 화면(`AIAnalysisModal`)이 쓰는 심층 지표. 채널별로 반환한다. 모든 계산 공식은
[`과금_및_지표_정의.md`](과금_및_지표_정의.md) §5에 정의돼 있고, **코드와 문서 중 하나만 고치면 안 된다.**

**인증**: 세션 쿠키 필요

| 쿼리 | 필수 | 설명 |
|---|---|---|
| `range` | 아니오 | `30d`(기본) 또는 `90d`. 심층 지표는 7일로는 표본이 부족하다 |

**채널별 응답 필드**

| 필드 | 설명 |
|---|---|
| `engagementRate` / `shareRate` / `commentRatio` | 기간 합계 기준 비율(%) |
| `retentionRate` / `clickThroughRate` | **조회수 가중평균**. 데이터 없으면 `null` |
| `saveRate` | 현재 항상 `null` — `videosAddedToPlaylists` 수집 추가 필요 |
| `topAudienceAge` | `{ ageGroup, sharePercent }` 또는 `null` |
| `virality` | `{ score, note, components }`. `score`가 `null`이면 `note`에 이유 |
| `peakTime` | `{ available, reason, totalVideos, best, slots }` |
| `formats` / `bestFormat` | 포맷별 통계. 표본 3개 미만 포맷은 `efficiencyScore: null` |

**표본이 부족하면 숫자 대신 `null` + 사유를 반환한다.** 영상 몇 개로 "저녁이 최적"이라고
단정하면 목업과 다를 게 없기 때문이다. 클라이언트는 `available` / `null`을 반드시 분기 처리한다.

`peakTime`은 YouTube Analytics API에 시간 디멘션이 없어 **우리 DB의 업로드 이력으로 직접 집계**한다
(발행 후 3일 조회수의 KST 시간대별 중앙값 ÷ 채널 전체 중앙값). 상관이지 인과가 아니므로
UI 문구는 "이 시간대에 올린 영상이 잘 됐다"여야 한다.
