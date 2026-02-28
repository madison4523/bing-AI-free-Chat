/**
 * Express 代理服务器
 * 负责将前端请求转发到 DeepSeek / Gemini API，并在服务端附加 API Key
 * 前端永远不会看到真实的 API Key
 */

import express from "express";
import cors from "cors";
import { config } from "dotenv";
import { fileURLToPath } from "url";
import path from "path";

// 加载项目根目录下的 .env
const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, "..", ".env") });

const app = express();
const PORT = process.env.PROXY_PORT || 3001;

// ===== 中间件 =====
app.use(cors({ origin: ["http://localhost:5173", "http://127.0.0.1:5173"] }));
app.use(express.json());

// ===== 健康检查 =====
app.get("/proxy/health", (_req, res) => {
  res.json({ status: "ok", port: PORT });
});

// ===== DeepSeek 代理 =====
// POST /proxy/deepseek/v1/chat/completions
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

    // 透传响应头（SSE 相关）
    res.setHeader(
      "Content-Type",
      upstream.headers.get("content-type") || "text/event-stream",
    );
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no"); // 禁止 nginx 缓冲

    // 流式管道
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
      res.end();
    });
  } catch (err) {
    console.error("[DeepSeek proxy] fetch error:", err.message);
    res
      .status(502)
      .json({ error: "Upstream request failed", detail: err.message });
  }
});

// ===== Gemini 代理 =====
// POST /proxy/gemini/:model   (query: ?stream=true)
app.post("/proxy/gemini/:model", async (req, res) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res
      .status(500)
      .json({ error: "GEMINI_API_KEY not configured on server" });
  }

  const { model } = req.params;
  const useStream = req.query.stream === "true";
  const action = useStream ? "streamGenerateContent" : "generateContent";
  const upstreamUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:${action}?key=${apiKey}&alt=sse`;

  try {
    const upstream = await fetch(upstreamUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body),
    });

    if (!upstream.ok) {
      const errText = await upstream.text();
      return res.status(upstream.status).send(errText);
    }

    // 透传 SSE 响应头
    res.setHeader("Content-Type", "text/event-stream");
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
      console.error("[Gemini proxy] stream error:", err.message);
      res.end();
    });
  } catch (err) {
    console.error("[Gemini proxy] fetch error:", err.message);
    res
      .status(502)
      .json({ error: "Upstream request failed", detail: err.message });
  }
});

// ===== 启动 =====
app.listen(PORT, () => {
  console.log(`[proxy] running on http://localhost:${PORT}`);
  console.log(
    `[proxy] DeepSeek key: ${process.env.DEEPSEEK_API_KEY ? "✅ loaded" : "❌ missing"}`,
  );
  console.log(
    `[proxy] Gemini  key: ${process.env.GEMINI_API_KEY ? "✅ loaded" : "❌ missing"}`,
  );
});
