# Ladder SNS

유튜브 · 인스타그램 · 쓰레드 · X(트위터) 통합 지표 분석 및 채널 관리 대시보드.

> **기획서는 [`docs/기획서.md`](docs/기획서.md) 에 있습니다.** 구현 순서, 도메인 구성,
> 과금 설계(구독 + 크레딧)가 전부 거기 정리돼 있습니다. 코드보다 먼저 읽어주세요.

---

## 실행

**필요한 것**: Node.js 20 이상 (개발 환경은 24.x). `npm` 또는 `bun` 아무거나.

```bash
npm install
npm run dev
```

→ http://localhost:3000

**API 키 없이도 전부 동작합니다.** AI 분석은 하드코딩된 폴백 응답으로 대체되고,
나머지 화면은 목업 데이터로 정상적으로 렌더링됩니다.

실제 Gemini를 붙이고 싶으면 프로젝트 루트에 `.env`:

```
GEMINI_API_KEY=여기에_키
```

---

## 명령어

| 명령 | 설명 |
|---|---|
| `npm run dev` | 개발 서버 (Express + Vite 미들웨어, 포트 3000) |
| `npm run lint` | 타입 검사 (`tsc --noEmit`) |
| `npm run test` | 단위 테스트 (비밀번호 정책) |
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
  App.tsx                  루트. 유저 상태 + 모달 관리
  types.ts                 전체 타입 정의
  passwordPolicy.ts        회원가입 비밀번호 규칙 (+ .test.ts)
  index.css                글래스모피즘 유틸리티 클래스
  data/mockData.ts         ★ 목업 데이터 전부 여기
  assets/ladder-mark.png   브랜드 마크
  components/
    Navbar.tsx             상단 헤더
    OnboardingHero.tsx     온보딩 3단계
    Dashboard.tsx          대시보드 본체
    AuthModal.tsx          로그인 / 회원가입
    AIAnalysisModal.tsx    AI 분석 (3탭)
    PostComposerModal.tsx  글 작성
    OnboardingModal.tsx    ⚠️ 미사용 (어디서도 import 안 함)
server.ts                  Express + Gemini 프록시
```

---

## 지금 상태에 대해

**동작하는 UI 프로토타입입니다.** 화면과 플로우는 완성됐고, 그 뒤는 비어 있습니다.

- ✅ 전체 화면, 온보딩 플로우, 차트, 모달, 반응형
- ✅ 비밀번호 정책 검증 (8자 이상 + 특수문자)
- ✅ Gemini 프록시 2개 (`/api/gemini/analyze`, `/api/gemini/advisor`)
- ❌ 로그인 — `AuthModal`은 입력값을 그냥 통과시킵니다. 인증이 아닙니다
- ❌ 데이터베이스 — 영속 저장 없음
- ❌ SNS 플랫폼 연동 — OAuth 코드 없음. 지표는 전부 목업
- ❌ 결제 / 크레딧 / 구독
- ❌ **`/api/gemini/*` 인증 없음** — 이대로 공개 배포하면 API 키 비용이 털립니다

무엇을 어떤 순서로 채울지는 [`docs/기획서.md`](docs/기획서.md) 9장(구현 절차)에 있습니다.

---

## 스택

React 19 · TypeScript 5.8 · Vite 6 · Tailwind CSS v4 · Recharts 3 · motion · lucide-react · Express 4 · @google/genai
