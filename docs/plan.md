# YouTube 연동 수정 계획

작성 기준: `docs/research.md` (2026-09-06 감사 보고서)

이 문서는 감사에서 발견된 문제를 실제로 고치기 위한 작업 단위 계획이다. 순서는
research.md의 "결론 및 권장 우선순위"를 따르되, 각 항목을 착수 가능한 작업으로
쪼갰다.

## 0. 공통 원칙

- 각 단계는 독립된 커밋(또는 PR)으로 나눈다. 서로 의존성이 없는 한 순서를 바꿔도
  무방하지만, 1번(데이터 파이프라인)은 다른 항목들이 검증에 쓰는 실데이터를
  만들어내므로 최우선으로 처리한다.
- 코드 변경이 있는 단계는 반드시 대응하는 테스트를 함께 추가한다(3번 항목과 별개로,
  새로 만드는 코드에는 처음부터 테스트를 붙인다).
- 문서 갱신(4번)은 코드가 실제로 바뀐 뒤에 그 결과를 반영해 마지막에 정리한다.

---

## 1. [최우선] `youtube_video_daily_metrics` 데이터 파이프라인 구현

**목표**: 영상별 일별 조회수(및 필요 시 shares)를 실제로 적재하여 `virality`,
`peakTime`, `formats`, `bestFormat`, `medianMultiple` 배지가 실데이터로 동작하게 한다.

- [x] 1-1. 설계 확정: **A안 채택** — YouTube Analytics API에 `filters=video==ID`로
  영상별 일별 조회수를 조회. `syncRetentionCurves`(`src/server/youtube.ts`)와 동일한
  패턴이라 구현 리스크가 낮고, 이미 존재하는 리텐션 곡선 수집과 대상 영상 목록을
  공유할 수 있어 쿼터 증가분을 최소화할 수 있다는 점을 근거로 B안(누적 스냅샷 diff)
  대신 선택. 채택 이유는 `docs/과금_및_지표_정의.md`(§영상별 초기 성과)에 기록.
- [x] 1-2. `src/server/youtube.ts`에 `loadRecentVideoTargets`(리텐션 곡선과 공유하는
  "최근 발행 15개 영상" 대상 목록 조회)와 `syncVideoDailyMetrics`(영상별 일별 지표
  upsert)를 추가하고, `syncAnalytics`에서 `syncRetentionCurves`와 함께 호출하도록
  연결. 기존 채널 단위 동기화와 동일하게 실패한 영상 1개가 전체 동기화를 막지 않도록
  try/catch로 개별 격리.
- [x] 1-3. 신규 로직의 핵심 매핑(`pickVideoMetricColumns`)을 순수 함수로 분리해
  export하고 `src/server/youtube.test.ts`(신규, `youtube.ts`의 첫 테스트 파일)에서
  검증. 동시에 `parseDurationSeconds`, `contentTypeForVideo`, `parseCursor`/`makeCursor`,
  `readJobCursor`, `stableHash` 등 이번 감사에서 지적된 순수 함수 테스트 공백도 함께
  메움(3번 항목 착수 일부 겸함).
- [ ] 1-4. `src/server/metrics.ts`의 `loadInitialSamples()` 및 이를 사용하는
  `medianMultiple`, `viralityScore`, `peakTimeByUploadSlot`, `formatStats`/`bestFormat`
  경로가 실제로 채워진 데이터를 정상적으로 소비하는지 통합 테스트로 검증. (스키마·컬럼명은
  이미 일치함을 코드 리딩으로 확인했으나, 실제 Supabase 환경에서의 end-to-end 검증은
  아직 미실시.)
- [ ] 1-5. 기존 연결(과거 데이터 없음)에 대한 백필 여부 결정: 신규 데이터만
  쌓을지, 과거 구간을 소급 조회할지 정하고 필요 시 1회성 백필 스크립트 작성.
  (현재는 신규 동기화 시점부터만 쌓이며, 채널당 최근 15개 영상으로 범위가 제한됨.)

---

## 2. [상] Google API 에러 코드 세분화 + 쿼터/레이트리밋 재시도

**목표**: `googleJson`이 403/429/5xx를 구분하고, 일시적 오류에는 재시도하며,
쿼터 초과는 사용자에게 명확히 안내한다.

- [x] 2-1. `src/server/youtube.ts`의 `googleJson`에서 실패 응답 바디를 JSON으로 파싱해
  `error.errors[].reason`을 추출하는 `parseGoogleErrorReason` 추가.
- [x] 2-2. 신규 에러 코드 정의: `GOOGLE_QUOTA_EXCEEDED`(403 quotaExceeded/
  dailyLimitExceeded), `GOOGLE_RATE_LIMITED`(429 또는 rateLimitExceeded/
  userRateLimitExceeded/backendError), `GOOGLE_NOT_FOUND`(404), `GOOGLE_API_TRANSIENT`
  (5xx), 기존 `GOOGLE_API_FAILED`는 401 및 그 외 케이스로 유지 — `classifyGoogleError`
  함수로 구현.
- [x] 2-3. `GOOGLE_RATE_LIMITED`/`GOOGLE_API_TRANSIENT`에 한해 `googleJson` 내부에서
  최대 3회, 지수 백오프(500ms 시작)로 즉시 재시도. `GOOGLE_QUOTA_EXCEEDED`(일일
  쿼터 소진)는 즉시 재시도해도 소용없으므로 재시도 대상에서 제외.
- [x] 2-4. `runSyncJob`의 실패 처리(`failJob`)를 개선: 쿼터/레이트리밋/일시 장애로
  실패한 동기화 잡은 `failed`로 확정하지 않고, 기존 `platform_sync_jobs.scheduled_at`
  컬럼을 이용해 `queued` 상태로 되돌려 지연 재시도(쿼터 소진은 6시간 뒤, 레이트
  리밋/일시 장애는 1분부터 지수 백오프, 최대 30분, 최대 5회 재시도) — 스키마 변경
  없이 기존 `claim_platform_sync_jobs`의 `scheduled_at <= now()` 조건을 그대로 활용.
- [ ] 2-5. 클라이언트 노출 메시지 정리: `classifyGoogleError`가 이미 사용자 친화적
  한국어 메시지(`ApiError.message`)를 담아 던지므로 수동 관리 라우트(영상/댓글
  수정 등)에서는 별도 매핑 없이 그대로 노출됨. 다만 `src/lib/youtubeManageApi.ts`
  및 관련 UI 에러 배너가 이 메시지를 그대로 사용자에게 보여주는지는 아직 UI
  단에서 확인하지 않음 — 실제 화면 확인 필요.
- [x] 2-6. `classifyGoogleError`/`parseGoogleErrorReason`/`syncRetryDelayMs`를 순수
  함수로 export해 `src/server/youtube.test.ts`에 403/429/404/401/5xx/기타 분기와
  재시도 지연 시간 계산에 대한 유닛 테스트 추가.

---

## 3. [상] `youtube.ts`에 대한 유닛/통합 테스트 도입

**목표**: 가장 크고 위험도 높은 파일(1460줄)에 최소한의 회귀 안전망을 만든다.

- [x] 3-1. 순수 함수 테스트 완료(1번 항목과 겸함): `parseDurationSeconds`,
  `contentTypeForVideo`, `parseCursor`/`makeCursor`, `stableHash`, `readJobCursor`,
  `pickVideoMetricColumns`, `parseGoogleErrorReason`, `classifyGoogleError`,
  `syncRetryDelayMs`, `hasWriteScope`, `requireWriteScope`, `asBigint`,
  `commentPayload` — 모두 `src/server/youtube.test.ts`에 존재.
- [ ] 3-2. 토큰 갱신 로직: `refreshGrantAccessToken`이 만료 60초 전 갱신을
  트리거하는지, 갱신 실패 시 grant를 `requires_reauth`로 전이하는지 검증.
  **미착수** — `getAdminClient()`(Supabase)와 `fetch`(Google OAuth 토큰 엔드포인트)를
  모두 모킹해야 하는데, 이 저장소에는 아직 Supabase 클라이언트를 모킹하는 테스트
  인프라가 전혀 없다(기존 테스트는 전부 순수 함수만 검증). 이 함수를 테스트하려면
  먼저 `db.from(...).select().eq().maybeSingle()`류 체이닝을 흉내내는 최소 페이크
  빌더를 만들거나, DB 접근 로직을 주입 가능하게 리팩터링해야 한다 — 별도 선행
  작업으로 분리 필요.
- [ ] 3-3. 권한 검사 중 `requireWriteScope`는 순수 함수라 3-1에서 테스트 완료.
  `requireOwnedChannel`, `requireOwnedVideo`, `requireOwnedComment`는 전부 DB 조회를
  포함하므로 3-2와 같은 이유로 **미착수**.
- [x] 3-4-a. `commentPayload`의 parent/reply 매핑은 순수 함수라 테스트 완료(3-1 참고).
- [ ] 3-4-b. `resolveGoogleParentCommentId`는 DB 조회를 포함해 **미착수**(3-2와 동일한
  이유).
- [ ] 3-5. 계정 삭제 흐름(`deleteAllYoutubeDataForProfile`)은 DB 삭제 순서와 Google
  revoke API 호출이 섞여 있어 **미착수**(3-2와 동일한 이유).
- [ ] 3-6. 동기화 잡 큐 경합 테스트(`claim_platform_sync_jobs`)는 실제 Postgres가
  필요해 **미착수**.

**남은 작업(3-2, 3-3 나머지, 3-4-b, 3-5, 3-6)의 공통 선행 조건**: Supabase
`getAdminClient()`를 모킹하거나 주입 가능하게 만드는 최소 테스트 하네스. 이것부터
별도 작업으로 만들고 나면 나머지는 각각 빠르게 붙일 수 있다.

---

## 4. [중] 문서 정합성 회복

**목표**: README.md와 docs/과금_및_지표_정의.md를 실제 코드 상태와 일치시킨다.
1~3번 작업이 끝난 뒤(또는 최소한 1번이 끝난 뒤) 최종 상태를 반영해 갱신한다.

- [x] 4-1. `README.md` "지금 상태에 대해" 절 전면 재작성 완료:
  - AI 분석/기타 API 키: "키 없이도 전부 동작"을 "키 없으면 즉시 에러"로 정정하고
    하드코딩 폴백이 의도적으로 제거됐음을 명시.
  - Instagram/Threads/X 연동: 구현 완료로 정정.
  - 결제/크레딧: `usage.ts` 기준 구현 완료로 정정(구독 결제 자체는 별개임을 명시).
  - AI 분석 실데이터 여부: 서버 측 재계산 그라운딩 구조로 정정.
  - `/api/gemini/*` 인증: 3개 라우트 모두 `requirePlusUser` 적용됨으로 정정.
  - 아직 미구현인 일부 딥 인사이트(saveRate, avgSavesOrShares)는 남겨두고
    `docs/research.md`/`docs/plan.md` 링크 추가.
- [x] 4-2. `README.md` "구조" 절을 `src/server/{oauth,youtube,socialConnections,
  metrics,insights,ai,usage,supabaseAdmin}.ts`, `src/lib/*Api.ts`, 실제 컴포넌트
  목록으로 전면 교체, 옛 `data/mockData.ts` 중심 서술 제거.
- [x] 4-3. `docs/과금_및_지표_정의.md`의 `youtube_video_daily_metrics` 관련 서술을
  1번 작업 완료 후 실제 구현 상태(A안 채택, 채널당 최근 15개 영상 제한)로 갱신.
- [x] 4-4. `docs/과금_및_지표_정의.md` §5.5의 "나머지는 전부 이미 수집 중" 서술을
  검토 — `saveRate`/`avgSavesOrShares`는 이미 문서 자체가 🔧 미구현으로 정확히
  표시하고 있었고, 영상별 일별 지표는 1번 작업으로 실제 구현됐으므로 해당 서술은
  이제 사실과 일치함. 수집 범위 제한(최근 15개 영상)만 각주로 추가.

---

## 5. [중] YouTube 쓰기 스코프(force-ssl) 선택적 요청

**목표**: 최소 권한 원칙에 맞게 지표 전용 연결과 관리(쓰기) 연결을 분리한다.

- [ ] 5-1. 정책 결정: (a) 연결 시 사용자가 "지표만 보기" vs "댓글/영상 관리까지
  포함"을 선택하게 할지, (b) 우선 현재처럼 통합 유지하되 UI 고지만 강화할지 결정.
  (a)를 택할 경우 스코프 조합이 2가지로 늘어나 토큰/재인증 로직에 영향을 주므로
  범위가 커진다 — 별도 설계 검토 필요.
- [ ] 5-2. (a) 채택 시: `src/server/youtube.ts:976-981` 스코프 목록을 옵션 파라미터로
  분기, DB에 연결 시 선택한 스코프 종류 저장, `requireWriteScope`가 실제 토큰
  스코프를 검사하도록 보강(현재는 존재 여부만 확인하는지 재확인 필요).
- [ ] 5-3. (b) 채택 시: `PlatformConnectionsSection.tsx`의 `scopeNote`를 더 눈에 띄게
  또는 별도 동의 체크박스로 강화.
- [ ] 5-4. 최종 정책을 `docs/과금_및_지표_정의.md` 또는 `docs/api_spec.md`에 반영.

---

## 6. [하] 잔여 정리 항목

- [ ] 6-1. `src/server/metrics.ts:362`의 `shares: 0` 하드코딩 제거: 값이 없음을
  UI에서 "–"로 표시하거나, 채널 일별 합계를 참고 표시하도록 변경.
- [ ] 6-2. `src/types.ts:92-104` `EngagementDeepMetric` 미사용 타입 삭제(또는
  `src/lib/insightsApi.ts` 실사용 타입과 통일).
- [ ] 6-3. `/api/health`(`server.ts:29`)에 `youtubeSyncWorkerEnabled` 필드 추가,
  워커가 꺼진 채로 기동될 때 서버 시작 로그에 경고 남기기.

---

## 작업 순서 요약

1. 1번 (데이터 파이프라인) — 가장 먼저, 가장 크게
2. 2번, 3번 — 병행 가능 (에러 처리 개선과 테스트 추가는 서로 의존성 낮음)
3. 5번 — 정책 결정 필요, 별도 논의 후 착수
4. 6번 — 자투리 시간에 병행 가능
5. 4번 (문서 갱신) — 위 항목들의 실제 반영 상태를 확인한 뒤 마지막에 정리
