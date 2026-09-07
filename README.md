# Ladder SNS

유튜브 · 인스타그램 · 쓰레드 · X(트위터) 통합 지표 분석 및 채널 관리 대시보드.

> **기획서는 [`docs/기획서.md`](docs/기획서.md), 개발하며 달라진 결정은
> [`docs/개발_변경사항.md`](docs/개발_변경사항.md) 에 있습니다.** 구현 순서, 도메인 구성,
> 과금 설계(구독 + 크레딧)가 전부 거기 정리돼 있습니다. 코드보다 먼저 읽어주세요.

---

## 실행

**필요한 것**: Node.js 20 이상 (개발 환경은 24.x). `npm` 또는 `bun` 아무거나.

```bash
npm install
npm run dev
```

→ http://localhost:3000

**API 키 없이는 정상 동작하지 않습니다.** Supabase(DB/인증), Google OAuth(YouTube 연동),
Gemini(AI 분석) 키가 없으면 해당 기능 호출 시 서버가 즉시 에러를 반환합니다(과거에는
Gemini 키가 없을 때 하드코딩된 폴백 응답으로 대체했지만, 실데이터가 아닌 응답을 실제인
것처럼 보여주는 것이 문제라 판단해 의도적으로 제거했습니다). 필요한 환경 변수 전체 목록은
[`.env.example`](.env.example)을 참고하세요.

```
GEMINI_API_KEY=여기에_키
VITE_SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
GOOGLE_YOUTUBE_CLIENT_ID=...
GOOGLE_YOUTUBE_CLIENT_SECRET=...
```

---

## 명령어

| 명령 | 설명 |
|---|---|
| `npm run dev` | 개발 서버 (Express + Vite 미들웨어, 포트 3000) |
| `npm run lint` | 타입 검사 (`tsc --noEmit`) |
| `npm run test` | 단위 테스트 (비밀번호 정책, YouTube 동기화, 지표 계산, AI/사용량 게이팅 등) |
| `npm run build` | 프로덕션 빌드 → `dist/` |
| `npm start` | 빌드 결과 실행 |

---

## 화면 둘러보기

1. **온보딩** — 첫 화면. 관리 주체(개인/팀/기업) → 운영 플랫폼 선택 → 계정 등록 3단계
   - 빠르게 대시보드를 보고 싶으면 3단계에서 **`1초 데모`** 버튼
2. **대시보드** — 통합 지표, 채널별 카드, 7일 추이 차트, 최근 발행 콘텐츠
3. **AI 지표 분석** (상단 버튼) — 3개 탭
   - 참여율 & 세부 지표
   - AI 종합 진단 & 처방
   - AI 1:1 컨설턴트 (질문 시 `/api/gemini/advisor` 호출)
4. **글작성** — 통합 발행 모달. 발행하면 대시보드 "최근 발행 콘텐츠"에 반영
   (메모리에만 저장되므로 새로고침하면 사라집니다)

플랫폼을 3개만 선택하면 대시보드·AI 분석 모두 그 3개만 다룹니다.

---

## 구조

```
src/
  App.tsx                       루트. 유저 상태 + 모달 관리
  types.ts                      전체 타입 정의
  passwordPolicy.ts             회원가입 비밀번호 규칙 (+ .test.ts)
  index.css                     글래스모피즘 유틸리티 클래스
  assets/ladder-mark.png        브랜드 마크
  components/
    Navbar.tsx                  상단 헤더
    OnboardingHero.tsx          온보딩 3단계
    Dashboard.tsx               대시보드 본체
    MyPage.tsx                  마이페이지 (플랜/계정 관리)
    AuthModal.tsx                로그인 / 회원가입
    AIAnalysisModal.tsx         AI 분석 (3탭)
    PlatformConnectionsSection.tsx  플랫폼 연동 목록 (YouTube/Instagram/Threads/X)
    PlatformSettingsModal.tsx   개별 플랫폼 연동 설정
    VideoDraftModal.tsx         글작성/영상 초안
    YoutubeRawDataPage.tsx      YouTube 원본 데이터 뷰
    PlusLock.tsx                Plus 전용 기능 잠금 UI
  lib/
    authApi.ts, metricsApi.ts, aiApi.ts, insightsApi.ts, youtubeManageApi.ts
                                 각 서버 API를 감싸는 클라이언트 래퍼
  server/
    auth.ts                    Supabase Auth 세션/플랜 조회
    oauth.ts                   공용 OAuth state/PKCE/토큰 암복호화 유틸
    youtube.ts                 YouTube OAuth·동기화 잡 큐·영상/댓글 관리 API (+ .test.ts)
    socialConnections.ts       Instagram/Threads/X OAuth 어댑터 (+ .test.ts)
    metrics.ts                 대시보드 지표 계산 (+ .test.ts)
    insights.ts                Plus 전용 딥 인사이트(바이럴리티/피크타임/포맷) (+ .test.ts)
    ai.ts                      Gemini 프록시, 서버 측 컨텍스트 재계산, Plus 게이팅 (+ .test.ts)
    usage.ts                   월 할당량/크레딧/채널 수 상한 (+ .test.ts)
    supabaseAdmin.ts           Supabase 서비스 롤 클라이언트, 공용 에러 타입
supabase/migrations/            DB 스키마 (RLS 포함)
server.ts                       Express 서버 진입점 + 라우트 등록
```

---

## 지금 상태에 대해

- ✅ 전체 화면, 온보딩 플로우, 차트, 모달, 반응형
- ✅ 로그인 — Supabase Auth. 이메일 OTP + Google OAuth, HttpOnly 세션 쿠키, 회원탈퇴
- ✅ 데이터베이스 — Supabase(Postgres). 채널·콘텐츠·일별 지표·댓글 영속 저장, RLS로
  클라이언트 직접 접근 차단(서버만 service role로 접근)
- ✅ YouTube 연동 — OAuth(state/PKCE), 토큰 암호화, 동기화 잡 큐, 댓글 SSE,
  영상·댓글 관리(쓰기), 영상별 일별 지표 수집(바이럴리티/피크타임/포맷 통계용)
- ✅ Instagram / Threads / X 연동 — `src/server/socialConnections.ts`에 세 플랫폼
  모두 OAuth 어댑터 구현 완료
- ✅ 결제 / 크레딧 — `src/server/usage.ts`에 월 할당량 + AI 크레딧 시스템 구현
  (구독 결제 연동 자체는 별개 — 플랜 상태만 관리)
- ✅ 대시보드 — 연동된 채널의 **실제 지표** (`GET /api/metrics/overview`)
- ✅ AI 분석 — 클라이언트가 보낸 값이 아니라 **서버가 DB에서 재계산한 실데이터**를
  프롬프트 컨텍스트로 사용 (`src/server/ai.ts`)
- ✅ Gemini 프록시 3개 (`/api/gemini/analyze`, `/api/gemini/advisor`,
  `/api/gemini/draft`) — 전부 `requirePlusUser`로 인증 + Plus 플랜 확인 후 호출
- 🔧 일부 Plus 전용 딥 인사이트(저장/공유 지표, 특정 브레이크다운)는 아직 수집
  파이프라인이 없음 — 자세한 현황은 [`docs/research.md`](docs/research.md)와
  [`docs/plan.md`](docs/plan.md) 참고

계획은 [`docs/기획서.md`](docs/기획서.md) 9장(구현 절차),
**계획에서 달라진 부분은 [`docs/개발_변경사항.md`](docs/개발_변경사항.md)** 에 있습니다.
둘이 어긋나면 `개발_변경사항.md`가 최신입니다. YouTube 연동의 상세 감사 결과와
개선 작업 진행 상황은 [`docs/research.md`](docs/research.md) /
[`docs/plan.md`](docs/plan.md)에 있습니다.

---

## 스택

React 19 · TypeScript 5.8 · Vite 6 · Tailwind CSS v4 · Recharts 3 · motion · lucide-react · Express 4 · @google/genai
