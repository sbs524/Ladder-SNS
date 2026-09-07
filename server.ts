import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";
import { registerAuthRoutes } from "./src/server/auth";
import { registerYoutubeRoutes, startYoutubeSyncWorker } from "./src/server/youtube";
import { registerMetricsRoutes } from "./src/server/metrics";
import { registerInsightsRoutes } from "./src/server/insights";
import { registerAiRoutes } from "./src/server/ai";
import { registerSocialConnectionRoutes } from "./src/server/socialConnections";

dotenv.config({ path: ".env.local" });
dotenv.config();

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
      youtubeEnabled: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.GOOGLE_YOUTUBE_CLIENT_ID && process.env.GOOGLE_YOUTUBE_CLIENT_SECRET),
      // 이게 꺼져 있으면 최초 연결(initial job) 이후 채널이 다시는 자동 동기화되지 않는다 —
      // youtubeEnabled가 true라도 이 값이 false면 실질적으로 YouTube 데이터가 멈춰 있는 상태다.
      youtubeSyncWorkerEnabled: process.env.YOUTUBE_SYNC_WORKER_ENABLED === "true",
    });
  });

  registerAuthRoutes(app);
  registerYoutubeRoutes(app);
  registerMetricsRoutes(app);
  registerInsightsRoutes(app);
  registerAiRoutes(app);
  registerSocialConnectionRoutes(app);
  startYoutubeSyncWorker();

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
