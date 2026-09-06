# YouTube 연동 시스템 코드베이스 감사 보고서

작성일: 2026-09-06

## 개요

`server.ts`, `src/server/{oauth,youtube,socialConnections,metrics,insights,usage,ai}.ts`,
`src/lib/youtubeManageApi.ts`, 관련 컴포넌트(`YoutubeRawDataPage.tsx`,
`PlatformConnectionsSection.tsx` 등), Supabase 마이그레이션(`20260829000000`,
`20260829010000`, `20260906000000` 등), 그리고 `docs/과금_및_지표_정의.md`·`README.md`를
전체 열람하여 YouTube 연동의 OAuth·동기화·지표 계산·AI 연동·문서 정합성을 검토했다.

## 정상 동작 확인된 부분

- **OAuth state/CSRF 보호**: `src/server/oauth.ts:39-82` — HMAC 서명 state,
  `timingSafeEqual` 비교, PKCE(S256), 10분 TTL이 모두 구현되어 있다.
- **토큰 암호화**: `src/server/oauth.ts:99-113` — AES-256-GCM으로 access/refresh
  토큰을 암호화해 DB에 저장하고, 클라이언트로는 어떤 토큰도 노출하지 않는다.
- **YouTube 전용 refresh token 강제**: `src/server/youtube.ts:1019` — 콜백에서
  `refresh_token`이 없으면 명시적으로 `YOUTUBE_REFRESH_TOKEN_MISSING` 에러를 던진다.
  `supabase/migrations/20260906000000_allow_meta_grants_without_refresh_token.sql:9-17`에서
  refresh token 없이 active를 허용하는 예외를 **`instagram`, `threads`에만** 열어두고
  YouTube는 제외했다 — 메타 예외가 YouTube에도 새는 문제는 실제로는 없다.
- **토큰 사전 갱신**: `src/server/youtube.ts:248-284` — 만료 60초 전부터 갱신하며,
  갱신 실패 시 grant를 `requires_reauth`로 전이하고 에러를 기록한다.
- **계정 탈퇴 시 Google 토큰 revoke**: `src/server/youtube.ts:359-388` — best-effort로
  Google에 토큰 폐기를 통보하고, 실패해도 탈퇴 자체는 막지 않는다.
- **채널 수 상한으로 쿼터 방어**: `src/server/usage.ts:32-37` — YouTube Data API 일
  10,000 unit 고정 상한을 채널 연동 개수 제한(`CHANNEL_LIMITS`, free 2 / plus 5)으로
  우회 방어한다는 설계 의도가 주석에 명시돼 있고 실제로
  `persistDiscoveredChannels`(`youtube.ts:420-447`)에서 강제된다.
- **동기화 워커의 원자적 잡 클레임**:
  `20260829000000_create_social_platform_data.sql:457-489`의 `claim_platform_sync_jobs`가
  `FOR UPDATE SKIP LOCKED`로 다중 워커 경쟁을 안전하게 처리한다.
- **AI 컨텍스트의 서버 측 그라운딩**: `src/server/ai.ts:99-204` — 프롬프트에 들어가는
  수치를 클라이언트 입력이 아니라 DB에서 직접 재계산하며, 대시보드(`metrics.ts`)와
  동일한 공식(`engagementRate`, `percentChange` 등)을 재사용해 숫자 불일치를 방지한다.
- **AI 기능의 Plus 게이팅 및 사용량/크레딧 처리**: `src/server/ai.ts:277-289`,
  `src/server/usage.ts:100-141` — `requirePlusUser`로 403 차단, 할당량 소진 시 크레딧으로
  전환, 크레딧 부족 시 402. 동시 요청 안전성을 위해 `spend_ai_credits` RPC 단일 원자적
  차감을 사용.
- **RLS/권한 분리**: 모든 YouTube 관련 테이블에 RLS를 켜고 `anon`/`authenticated`의
  접근을 완전히 차단, `service_role`에만 권한을 부여(`20260829000000...sql:430-454`,
  `20260829010000...sql`). 클라이언트가 직접 Supabase에 접근할 수 없고 Express 서버만
  매개하는 구조.
- **비디오/댓글 관리 API의 소유권 검증과 쓰기 스코프 체크**: `requireOwnedChannel`,
  `requireOwnedVideo`, `requireOwnedComment`, `requireWriteScope`(`youtube.ts:286-341`,
  `305-315`)가 모든 관리용 라우트 앞단에서 일관되게 호출된다.
- **UI 로딩/에러/빈 상태**: `PlatformConnectionsSection.tsx`에 로딩 스피너,
  `role="alert"` 에러 배너, 연결/미연결 상태 분기가 존재한다.

## 발견된 문제점

### 1. [Critical] `youtube_video_daily_metrics`가 스키마에는 존재하지만 동기화 코드가 절대 채우지 않음 — 다수의 유료(Plus) 지표가 항상 빈 값

- **파일**: `src/server/metrics.ts:132-136` (읽는 곳), `src/server/youtube.ts` 전체
  (쓰는 코드 없음), `docs/과금_및_지표_정의.md:249, 314-318, 398-399`
- **문제**: `docs/과금_및_지표_정의.md`는 "`youtube_video_daily_metrics`에 영상별·일별
  조회수가 **이미 쌓이므로** 추가 수집 없이 계산된다"(318행), "`peakTime`의
  `youtube_video_daily_metrics`는 **이미 있다**"(399행)라고 명시하지만, 실제 동기화
  로직(`syncAnalytics`, `syncRetentionCurves` 등, `youtube.ts:625-793`)은 채널
  단위(`youtube_channel_daily_metrics`)와 브레이크다운(`youtube_analytics_breakdowns`)만
  upsert하며, `youtube_video_daily_metrics`에 대한 insert/upsert 코드는 리포지토리
  전체에 **단 한 줄도 없다**(grep 확인 완료).

  ```ts
  // src/server/metrics.ts:132
  const { data: videoMetrics, error: videoMetricsError } = await db
    .from("youtube_video_daily_metrics")   // 항상 빈 테이블을 조회
    .select("youtube_video_id, metric_date, views, shares")
  ```

- **영향**: `loadInitialSamples()`가 항상 빈 배열을 반환하므로, 이를 사용하는 아래
  기능들이 전부 사실상 죽어 있다:
  - 대시보드 "최근 발행 콘텐츠"의 `medianMultiple` 배지 (`metrics.ts:346-351`) — 항상 `null`
  - `viralityScore`의 `reachMultiple` 관련 표본, `peakTimeByUploadSlot` — 영상 0개로
    집계되어 항상 `available: false`
  - `formatStats`/`bestFormat` — 포맷별 영상 수 항상 0으로 항상 "데이터 부족"
  - 이 항목들은 모두 **Plus 전용 유료 기능**(`insights.ts:46` `PLUS_ONLY_FIELDS`)인데,
    실제로는 Plus 사용자에게도 항상 "데이터 부족" 또는 `null`만 노출된다. 즉 결제
    사유가 되는 핵심 기능이 실제로는 동작하지 않는다.
- **개선 제안**: (a) YouTube Analytics API에서 영상별 일별 조회수를 가져오는 동기화
  단계를 `syncAnalytics`에 추가(`filters=video==ID` 방식은 이미 `syncRetentionCurves`에
  선례가 있음)하거나, (b) 애초에 `social_contents.current_metrics`의 누적 조회수
  스냅샷을 일 단위로 diff하여 채우는 대안 설계를 택하고 문서를 갱신해야 한다.
  우선순위 최상.

### 2. [High] YouTube API 에러 처리에서 HTTP 상태 코드가 뭉개짐 — 403 quotaExceeded/429 rate limit을 구분할 수 없고 재시도/백오프 전무

- **파일**: `src/server/youtube.ts:206-223` (`googleJson`)

  ```ts
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const message = body.slice(0, 300) || `Google API returned ${response.status}.`;
    throw new ApiError(response.status === 401 ? 401 : 502, "GOOGLE_API_FAILED", message);
  }
  ```

- **문제**: 401만 구분하고 403(quotaExceeded, 권한 부족), 404(영상/채널 삭제됨),
  429(rate limit), 5xx(일시 장애)를 전부 502로 뭉갠다. 코드 자체(`GOOGLE_API_FAILED`)도
  하나뿐이라 호출부(`runSyncJob`, 비디오/댓글 관리 라우트)가 원인별로 다르게 대응할
  수 없다.
- **영향**: 쿼터 초과(403 quotaExceeded)가 발생해도 일반 502 에러로 처리되어
  (1) 재시도/백오프 로직이 전혀 없어 즉시 잡을 `failed`로 처리하고, (2) 클라이언트에는
  "Google API returned 403"류의 원문 메시지가 그대로 노출될 수 있으며(`toErrorResponse`
  경유 여부는 라우트마다 다름), (3) 쿼터 소진 시 사용자에게 "쿼터 초과, N시간 후
  재시도" 같은 명확한 안내를 줄 수 없다.
- **개선 제안**: 응답 바디의 `error.errors[].reason`(`quotaExceeded`,
  `dailyLimitExceeded` 등)을 파싱해 전용 에러 코드로 매핑하고, 429/특정 5xx에 한해
  지수 백오프 재시도를 추가한다. 최소한 403/429는 사용자에게 "지금은 동기화할 수
  없습니다. 잠시 후 다시 시도하세요" 같은 문구로 구분해 보여줘야 한다.

### 3. [High] `youtube.ts`에 전용 테스트가 전무

- **파일**: `src/server/*.test.ts` 목록 확인 결과 `youtube.test.ts` 없음
  (`ai.test.ts`, `insights.test.ts`, `metrics.test.ts`, `socialConnections.test.ts`,
  `usage.test.ts`만 존재, 그중 `youtube` 언급은 `ai.test.ts`의 2건뿐)
- **문제**: 1460줄짜리 `youtube.ts`는 이 저장소에서 가장 크고 위험도가 높은
  파일(암호화, OAuth 토큰 교환/갱신, 실제 계정에 쓰기 작업을 하는 비디오
  수정/삭제·댓글 답글/모더레이션 API, 동기화 잡 큐, SSE 스트림)인데 유닛 테스트가
  하나도 없다.
- **영향**: 토큰 갱신 실패 처리, `requireWriteScope` 분기, 페이지네이션 커서 처리,
  `commentPayload`의 parent/reply 매핑, `deleteAllYoutubeDataForProfile`의 삭제
  순서(FK 제약과 맞물림) 같은 회귀에 취약한 로직이 리팩터링 시 안전망 없이 깨질 수
  있다.
- **개선 제안**: 최소한 순수 함수(`parseDurationSeconds`, `contentTypeForVideo`,
  `parseCursor`/`makeCursor`, `stableHash`, `readJobCursor`)와
  `refreshGrantAccessToken`/`requireWriteScope`/`resolveGoogleParentCommentId` 같은
  분기 로직부터 유닛 테스트를 추가해야 한다.

### 4. [Medium] `youtube.force-ssl`(쓰기 권한) 스코프를 모든 연결에서 무조건 요청

- **파일**: `src/server/youtube.ts:976-981`

  ```ts
  const scopes = [
    "openid",
    YOUTUBE_WRITE_SCOPE, // force-ssl — 항상 포함
    "https://www.googleapis.com/auth/yt-analytics.readonly",
    ...(includeRevenue ? [...] : []),
  ];
  ```

- **문제**: 지표 조회만 원하는 사용자도 채널 전체를 수정/삭제할 수 있는
  `youtube.force-ssl` 권한을 처음부터 강제로 요청한다(코드 주석 132행은 "readonly
  대신 이걸 요청한다"고 설명하지만, 이는 최소 권한 원칙에 반한다).
  `PlatformConnectionsSection.tsx:38`의 `scopeNote`에 이 사실이 사용자에게 고지되긴
  하나, 선택권은 없다.
- **영향**: (1) Google OAuth 검증(민감 스코프 심사) 부담이 커진다. (2) 사용자가 단순
  지표 조회만 원해도 계정 삭제/수정 권한을 넘겨야 하며, 토큰 유출 시 피해 범위가
  커진다.
- **개선 제안**: 지표 전용 연결(readonly)과 관리 기능(쓰기) 연결을 사용자가 선택할
  수 있게 분리하거나, 최소한 온보딩/연결 UI에서 이 권한 범위를 더 명확히 사전
  고지해야 한다.

### 5. [Medium] `docs/과금_및_지표_정의.md`의 "이미 수집 중" 서술과 실제 구현의 괴리 (문서 신뢰도 문제)

- **파일**: `docs/과금_및_지표_정의.md:249, 314-318, 398-399` vs `src/server/youtube.ts`
- 위 1번 문제의 문서 쪽 원인이자 별도로 짚어야 할 문제: 문서가 "친구가 수집 구조를
  맡으므로"(391행)라며 별도 담당자의 작업을 전제하지만, 실제로 그 작업이 반영되지
  않은 채 문서만 "✅ 구현됨"으로 표시되어 있다. 코드를 읽지 않고 문서만 본 개발자는
  이 기능이 동작한다고 오인하게 된다.
- **개선 제안**: 상태 열을 "🔧 미구현"으로 정정하거나, 실제 데이터 파이프라인을
  구현한 뒤에만 "✅"로 바꿔야 한다.

### 6. [Medium] `README.md`가 현재 코드와 크게 어긋남 (심각한 문서 드리프트)

- **파일**: `README.md:22-23, 92-95`
- **불일치 목록**:
  - README: "API 키 없이도 전부 동작합니다. AI 분석은 **하드코딩된 폴백 응답**으로
    대체" → 실제(`ai.ts:42-47`, 주석 25-26행): `GEMINI_API_KEY` 없으면
    `requireString`이 즉시 에러를 던지고, 폴백 응답을 반환하던 예전 동작은
    "거짓말"이라며 의도적으로 제거됨.
  - README: "❌ Instagram / Threads / X 연동 — 코드 없음" → 실제:
    `src/server/socialConnections.ts`(557줄)에 세 플랫폼 모두 완전한 OAuth 어댑터가
    구현돼 있음.
  - README: "❌ 결제 / 크레딧 / 구독 — 코드 없음" → 실제: `src/server/usage.ts`에
    월 할당량·크레딧·`spend_ai_credits` RPC까지 구현.
  - README: "❌ AI 분석 실데이터 — 아직 클라이언트가 보낸 지표로 분석" → 실제:
    `ai.ts:buildChannelContext`가 서버에서 DB 실데이터로 재계산(위 "정상 동작" 항목
    참고).
  - README: "🔴 `/api/gemini/*` 인증 없음 — 최우선 수정 대상" → 실제:
    `requirePlusUser`가 `getAuthenticatedUser`로 인증을 검사함(이미 수정됨).
- **영향**: 신규 합류자나 이 감사와 같은 검토 작업이 README만 보고 잘못된
  결론(플랫폼 미구현, AI 미검증 등)을 낼 위험이 크다.
- **개선 제안**: README의 "지금 상태에 대해" 절과 파일 구조 절을 현재 커밋 기준으로
  전면 갱신.

### 7. [Low] 대시보드 "최근 발행 콘텐츠"의 `shares`가 항상 0으로 하드코딩

- **파일**: `src/server/metrics.ts:362`

  ```ts
  comments: num(metrics.commentCount),
  shares: 0,
  ```

- **문제**: YouTube Data API `videos.statistics`에는 공유수 필드가 없어
  `current_metrics`에 저장되지 않는다. 반면 `youtube_channel_daily_metrics.shares`
  (Analytics API)에는 실제 값이 쌓이고 있다(`syncAnalytics`). 영상 단위 카드에서는
  채널 합산 공유 수를 끌어오지 않고 그냥 0으로 고정되어 있어, 실제로 공유가 있어도
  항상 "0"으로 표시된다.
- **개선 제안**: 최소한 UI에서 "공유수 없음(–)"으로 표시하거나, 채널 일별 합계라도
  참고 표시. 값이 있는 것처럼 0을 보여주는 것은 사용자에게 오인을 줄 수 있다.

### 8. [Low] 죽은 타입 `EngagementDeepMetric` (mock 시대 잔재)

- **파일**: `src/types.ts:92-104`
- **문제**: `saveRate: number`, `peakTime: string`처럼 실제 API(`insights.ts`)가
  반환하는 `null` 허용 구조화 객체(`PeakTimeResult`, `ViralityResult` 등)와 전혀 다른
  옛 mock 데이터용 타입이 남아 있고, grep 결과 이 타입을 import하는 곳이 `types.ts`
  자신 외에는 없다(완전 미사용).
- **개선 제안**: 삭제하거나, 실사용 중인 `src/lib/insightsApi.ts`의 타입과 통일.

### 9. [Low] YouTube 동기화 워커가 기본적으로 꺼져 있음 (설정 누락 시 조용히 미동작)

- **파일**: `server.ts:39`, `src/server/youtube.ts:960-965`, `.env.example:12`
- **문제**: `YOUTUBE_SYNC_WORKER_ENABLED=false`가 기본값이며, 꺼진 상태에서도 서버는
  정상 기동되고 어떤 경고도 로그에 남기지 않는다(`startYoutubeSyncWorker`가 조건
  불충족 시 그냥 return). `/api/health`(`server.ts:29`)는
  `GOOGLE_YOUTUBE_CLIENT_ID/SECRET`, `SUPABASE_SERVICE_ROLE_KEY`만 확인하고 워커
  활성화 여부는 반영하지 않는다.
- **영향**: 운영 환경에서 이 env var를 빠뜨리면 최초 연결(`initial` job) 이후 채널이
  다시는 자동 동기화되지 않는데, 헬스체크는 "정상"으로 보고한다.
- **개선 제안**: `/api/health`에 `youtubeSyncWorkerEnabled` 필드 추가, 혹은 최소 서버
  시작 로그에 워커 비활성 상태를 명시.

## 문서-코드 불일치

- `docs/과금_및_지표_정의.md`의 `youtube_video_daily_metrics` "✅ 구현됨/이미 있다"
  서술이 실제 미구현 상태와 불일치 (발견 1, 5 참고).
- `README.md` 전체가 Instagram/Threads/X 연동, 결제/크레딧, AI 실데이터 검증,
  `/api/gemini/*` 인증 여부에 대해 실제 코드와 반대로 서술 (발견 6 참고).
- `README.md`의 "구조" 절이 `src/server/{oauth,youtube,socialConnections,metrics,
  insights,ai,usage}.ts`, `src/lib/*Api.ts` 등 실제 존재하는 핵심 서버 파일들을 전혀
  언급하지 않고, 옛 구조(`data/mockData.ts` 중심)를 기술.
- `docs/과금_및_지표_정의.md` §5.5는 "나머지는 전부 이미 수집 중"이라 하나,
  `saveRate`(videosAddedToPlaylists)와 `avgSavesOrShares`(video 디멘션 브레이크다운)는
  문서 자신도 미구현(🔧)으로 인정하고 있어 실제로는 3가지(영상별 일별 지표 포함)가
  미구현 상태.

## 테스트 커버리지 갭

- `src/server/youtube.ts` 전용 테스트 파일이 아예 없음 — OAuth 토큰 교환/갱신,
  쓰기 스코프 검사, 댓글/비디오 관리 API, 동기화 잡 실행 로직이 전부 미검증
  (발견 3).
- `socialConnections.test.ts`는 23줄로 매우 짧고 Instagram/Threads/X 어댑터
  각각의 refresh 로직(회전식 vs 비회전식) 분기를 충분히 커버하는지 불확실.
- `metrics.test.ts`/`insights.test.ts`는 순수 계산 함수(`median`, `viralityScore`,
  `formatStats` 등) 위주로, `loadInitialSamples`가 항상 빈 배열을 반환하는 현재
  상태(발견 1)를 잡아낼 통합 테스트가 없다 — 이런 회귀를 사전에 잡을 수 있는 유일한
  지점이었는데 비어 있다.
- 쿼터 초과(403)·레이트리밋(429) 시나리오에 대한 테스트가 전무(재시도/백오프
  자체가 없으므로 당연히 테스트도 없음).

## 결론 및 권장 우선순위

1. **[최우선] `youtube_video_daily_metrics` 데이터 파이프라인 구현** — 현재 Plus
   유료 기능(`virality`, `peakTime`, `formats`, `bestFormat`, 대시보드
   `medianMultiple` 배지)이 사실상 항상 빈 값을 반환하는 상태이므로, 과금 근거가
   되는 기능이 실제로 고객에게 전달되지 않고 있다. 영상별 일별 조회수 수집
   (Analytics API `filters=video==ID` 또는 대안)을 최우선으로 구현한다.
2. **[상] Google API 에러 코드 세분화 + 쿼터/레이트리밋 재시도** — `googleJson`이
   403/429/5xx를 구분해 처리하고, 최소 지수 백오프를 도입한다.
3. **[상] `youtube.ts`에 대한 유닛/통합 테스트 도입** — 특히 토큰 갱신 실패, 쓰기
   스코프 검사, 페이지네이션 커서, 계정 삭제 시 리소스 정리 순서.
4. **[중] `README.md`와 `docs/과금_및_지표_정의.md`를 현재 코드 기준으로 갱신** —
   특히 "이미 구현됨"으로 표시된 항목들의 실제 구현 여부 재검증.
5. **[중] YouTube 쓰기 스코프(force-ssl) 요청을 선택적으로 전환**하거나 최소 권한
   원칙 재검토.
6. **[하] `shares: 0` 하드코딩 수정, 죽은 `EngagementDeepMetric` 타입 제거, 헬스체크에
   동기화 워커 상태 노출.**
