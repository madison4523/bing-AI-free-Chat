import express from "express";
import cors from "cors";
import { config } from "dotenv";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, "..", ".env") });

const app = express();
const PORT = process.env.PROXY_PORT || 3001;

app.use(cors({ origin: ["http://localhost:5173", "http://127.0.0.1:5173"] }));
app.use(express.json());

// ===== 健康检查 =====
app.get("/proxy/health", (_req, res) => {
  res.json({
    status: "ok",
    port: PORT,
    deepseek: !!process.env.DEEPSEEK_API_KEY,
  });
});

// ===== DeepSeek 代理 =====
app.post("/proxy/deepseek/v1/chat/completions", async (req, res) => {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return res
      .status(500)
      .json({ error: "DEEPSEEK_API_KEY not configured on server" });
  }

  try {
    const upstream = await fetch(
      "https://api.deepseek.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          Accept: req.headers["accept"] || "text/event-stream",
        },
        body: JSON.stringify(req.body),
      },
    );

    if (!upstream.ok) {
      const errText = await upstream.text();
      return res.status(upstream.status).send(errText);
    }

    res.setHeader(
      "Content-Type",
      upstream.headers.get("content-type") || "text/event-stream",
    );
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");

    const reader = upstream.body.getReader();
    const pump = async () => {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          res.end();
          break;
        }
        res.write(value);
      }
    };
    pump().catch((err) => {
      console.error("[DeepSeek proxy] stream error:", err.message);
      if (!res.writableEnded) res.end();
    });
  } catch (err) {
    console.error("[DeepSeek proxy] fetch error:", err.message);
    if (!res.headersSent) {
      res
        .status(502)
        .json({ error: "Upstream request failed", detail: err.message });
    }
  }
});

// ===== 启动 =====
app.listen(PORT, () => {
  console.log(`[proxy] running on http://localhost:${PORT}`);
  console.log(
    `[proxy] DeepSeek key: ${process.env.DEEPSEEK_API_KEY ? "✅ loaded" : "❌ missing"}`,
  );
});
