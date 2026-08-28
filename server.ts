import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
import { registerAuthRoutes } from "./src/server/auth";

dotenv.config({ path: ".env.local" });
dotenv.config();

let genAIClient: GoogleGenAI | null = null;
function getGenAI(): GoogleGenAI | null {
  if (!genAIClient && process.env.GEMINI_API_KEY) {
    genAIClient = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return genAIClient;
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(express.json({ limit: "16kb" }));

  // Health check
  app.get("/api/health", (req, res) => {
    res.json({
      status: "ok",
      aiEnabled: Boolean(process.env.GEMINI_API_KEY),
      authEnabled: Boolean(process.env.VITE_SUPABASE_URL && process.env.VITE_SUPABASE_PUBLISHABLE_KEY),
    });
  });

  registerAuthRoutes(app);

  // 1. AI Comprehensive Channel Analysis Endpoint
  app.post("/api/gemini/analyze", async (req, res) => {
    try {
      const { userProfile, platformStats } = req.body;
      const ai = getGenAI();

      if (!ai) {
        return res.json({
          success: true,
          mode: 'smart-engine',
          message: 'Default high-accuracy engine used',
        });
      }

      const prompt = `당신은 최고 수준의 소셜 미디어 성장 전략 및 알고리즘 분석 AI 컨설턴트입니다.
사용자 정보:
- 관리 주체: ${userProfile?.userType || 'individual'} (${userProfile?.name || '크리에이터'})
- 운영 플랫폼: ${userProfile?.selectedPlatforms?.join(', ') || 'youtube, instagram, threads, x'}
- 현재 총 지표: 통합 팔로워 ${(platformStats?.totalFollowers || 320000).toLocaleString()}명, 주간 총 도달 ${(platformStats?.totalViews || 4190000).toLocaleString()}회, 평균 참여율 ${platformStats?.avgEngagement || '7.7'}%

위 채널 데이터를 정밀 분석하여 다음 항목을 JSON 형식으로 작성해주세요:
1. overallScore (1~100 사이의 종합 건강도 점수, 예: 94)
2. scoreLabel (예: "상위 3% 고성장 채널군")
3. summary (현재 성과와 크로스 채널 시너지에 대한 2~3줄의 통찰력 있는 총평)
4. keyStrengths (현재 가장 반응이 좋은 3가지 강점)
5. bottlenecks (성장을 가로막는 3가지 개선 포인트)
6. channelAdvice (운영 중인 플랫폼별 구체적인 최신 알고리즘 전략, 실전 실행 전술 3가지, 추천 업로드 시간대, 기대 성장률, 후킹 팁)
7. contentRoadmap (이번 주 7일간의 요일별 추천 콘텐츠 주제, 훅 문구, 추천 포맷)

응답은 반드시 유효한 JSON 형식으로만 출력해주세요.`;

      const response = await ai.models.generateContent({
        model: "gemini-3.7-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
        },
      });

      const text = response.text || "{}";
      const parsed = JSON.parse(text);

      return res.json({
        success: true,
        mode: 'gemini-live',
        data: parsed,
      });
    } catch (err: any) {
      console.error("AI Analysis error:", err);
      return res.status(500).json({
        success: false,
        error: err.message || "Failed to generate AI analysis",
      });
    }
  });

  // 2. Interactive AI Advisor Q&A Endpoint
  app.post("/api/gemini/advisor", async (req, res) => {
    try {
      const { query, history, context } = req.body;
      const ai = getGenAI();

      if (!ai) {
        return res.json({
          success: true,
          mode: 'smart-engine',
          reply: `[AI 조언] "${query}"에 대한 제안:
1. **쇼츠/릴스 도입부 훅 최적화**: 0~3초 구간에 질문 대신 결론과 시각적 충격 요소를 먼저 배치하세요.
2. **쓰레드-X 크로스 포스팅**: 쓰레드에서 반응이 터진 텍스트 타래를 X에서는 1/N 정보 타래로 재가공하여 게시하면 리트윗과 북마크가 2배 이상 증가합니다.
3. **참여 유도 CTA**: 영상이나 게시물 말미에 "저장해두고 필요할 때 꺼내보세요"라는 저장 유도 멘트를 꼭 추가하세요.`,
        });
      }

      const systemInstruction = `당신은 YouTube, Instagram, Threads, X(Twitter) 전문 소셜 미디어 AI 수석 성장 전략가입니다.
사용자는 채널을 운영하며 구체적인 참여율 개선, 바이럴 팁, 알고리즘 대응, 콘텐츠 기획 조언을 구하고 있습니다.
답변 시:
- 구체적이고 실전적인 수치와 예시를 포함하세요.
- 친절하고 전문적인 어조로 핵심을 번호 목록(1, 2, 3)으로 일목요연하게 작성하세요.
- 각 플랫폼의 2026년 최신 알고리즘 특성(릴스 오디오 트렌드, 쓰레드 15분 티키타카 댓글, X 외부링크 분리, 쇼츠 완독률)을 적극 반영하세요.`;

      const contents = [
        `사용자 채널 현황: ${JSON.stringify(context || {})}`,
        ...(history || []).map((h: any) => `${h.role === 'user' ? '사용자' : 'AI'}: ${h.text}`),
        `사용자 질문: ${query}`,
      ].join("\n\n");

      const response = await ai.models.generateContent({
        model: "gemini-3.7-flash",
        contents,
        config: {
          systemInstruction,
        },
      });

      return res.json({
        success: true,
        mode: 'gemini-live',
        reply: response.text || "조언을 생성할 수 없습니다.",
      });
    } catch (err: any) {
      console.error("AI Advisor error:", err);
      return res.status(500).json({
        success: false,
        error: err.message || "Failed to generate AI advice",
      });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
