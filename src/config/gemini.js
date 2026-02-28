import {
  RETRY_CONFIG,
  calculateRetryDelay,
  isRetryableError,
  shouldUseMockMode,
  getMockResponse,
  simulateStreamOutput,
  formatErrorMessage,
} from "./api.js";

// API 请求通过本地 Express 代理（server/proxy.js）转发，API Key 由服务端保管

// 开发模式：如果API密钥未设置或为空，使用模拟回复
const USE_MOCK_RESPONSE = shouldUseMockMode();

/**
 * 调用 Gemini API 生成回复（流式输出 + 自动重试 + 对话历史）
 * @param {string} prompt - 用户输入的提示文本
 * @param {string} model - 模型名称（默认为 gemini-2.5-flash）
 * @param {Function} onChunk - 接收每个文本块的回调函数 (chunk) => void
 * @param {Array} conversationHistory - 历史对话消息数组 [{role: 'user'|'model', parts: [{text: string}]}]
 * @returns {Object} - { promise: Promise<string>, controller: AbortController }
 */
function runChat(
  prompt,
  model = "gemini-2.5-flash",
  onChunk,
  conversationHistory = [],
) {
  // Mock 模式：模拟流式输出
  if (USE_MOCK_RESPONSE) {
    const mockController = new AbortController();
    const mockPromise = (async () => {
      const mockResponse = getMockResponse(prompt, "Gemini");
      await simulateStreamOutput(mockResponse, onChunk, mockController);
      return mockResponse;
    })();

    return { promise: mockPromise, controller: mockController };
  }

  // 生产模式：使用 Gemini SDK 的流式输出
  const controller = new AbortController();
  let retryCount = 0;

  const promise = new Promise((resolve, reject) => {
    const attemptRequest = async () => {
      let fullText = "";
      let lastError = null;

      try {
        // 构建 Gemini REST API 请求体（转化历史消息格式）
        const contents = [
          ...conversationHistory.map((msg) => ({
            role: msg.role === "assistant" ? "model" : msg.role,
            parts: [{ text: msg.content || msg.parts?.[0]?.text }],
          })),
          { role: "user", parts: [{ text: prompt }] },
        ];

        const response = await fetch(`/proxy/gemini/${model}?stream=true`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents,
            generationConfig: {
              temperature: 0.9,
              topK: 1,
              topP: 1,
              maxOutputTokens: 2048,
            },
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`Gemini API 错误 ${response.status}: ${errText}`);
        }

        // 手动解析 SSE 流（alt=sse 格式："data: {...}\n")
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          if (controller.signal.aborted) break;

          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          // 最后一行可能不完整，留到下一个循环
          buffer = lines.pop();

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const jsonStr = line.slice(6).trim();
            if (jsonStr === '[DONE]' || jsonStr === '') continue;
            try {
              const parsed = JSON.parse(jsonStr);
              const text = parsed?.candidates?.[0]?.content?.parts?.[0]?.text;
              if (text) {
                fullText += text;
                onChunk(text);
              }
            } catch {
              // 静默处理解析失败
            }
          }
        }

        // 用户取消
        if (controller.signal.aborted) {
          reject(new Error("用户已取消请求"));
          return;
        }

        resolve(fullText);
      } catch (error) {
        lastError = error;

        // 用户主动取消，不重试
        if (controller.signal.aborted) {
          reject(new Error("用户已取消请求"));
          return;
        }

        // 判断是否可以重试
        if (isRetryableError(error) && retryCount < RETRY_CONFIG.maxRetries) {
          retryCount++;
          const delay = calculateRetryDelay(retryCount - 1);

          console.log(
            `Gemini API 错误，将在 ${(delay / 1000).toFixed(1)} 秒后进行第 ${retryCount} 次重试...`,
          );
          onChunk(
            `\n\n[网络错误，正在进行第 ${retryCount}/${RETRY_CONFIG.maxRetries} 次重试...]`,
          );

          // 延迟后重试
          setTimeout(() => {
            if (!controller.signal.aborted) {
              attemptRequest();
            }
          }, delay);
        } else {
          // 重试次数用尽或不可重试的错误
          const errorMessage = formatErrorMessage(
            lastError,
            "Gemini",
            retryCount,
            fullText,
          );
          onChunk(errorMessage);
          reject(lastError || new Error(errorMessage));
        }
      }
    };

    // 开始第一次请求
    attemptRequest();
  });

  return { promise, controller };
}

export default runChat;
