import {
  GoogleGenerativeAI,
  HarmCategory,
  HarmBlockThreshold
} from "@google/generative-ai";
import {
  RETRY_CONFIG,
  calculateRetryDelay,
  isRetryableError,
  shouldUseMockMode,
  getMockResponse,
  simulateStreamOutput,
  buildSystemPrompt,
  formatErrorMessage
} from './api.js';

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY;

// 开发模式：如果API密钥未设置或为空，使用模拟回复
const USE_MOCK_RESPONSE = shouldUseMockMode(GEMINI_API_KEY);

/**
 * 调用 Gemini API 生成回复（流式输出 + 自动重试 + 对话历史）
 * @param {string} prompt - 用户输入的提示文本
 * @param {string} model - 模型名称（默认为 gemini-2.5-flash）
 * @param {Function} onChunk - 接收每个文本块的回调函数 (chunk) => void
 * @param {Array} conversationHistory - 历史对话消息数组 [{role: 'user'|'model', parts: [{text: string}]}]
 * @returns {Object} - { promise: Promise<string>, controller: AbortController }
 */
function runChat(prompt, model = "gemini-2.5-flash", onChunk, conversationHistory = []) {
  
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
      let fullText = '';
      let hasError = false;
      let lastError = null;

      try {
        const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
        const geminiModel = genAI.getGenerativeModel({ model });

        const generationConfig = {
          temperature: 0.9,
          topK: 1,
          topP: 1,
          maxOutputTokens: 2048
        };

        const safetySettings = [
          {
            category: HarmCategory.HARM_CATEGORY_HARASSMENT,
            threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE
          },
          {
            category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
            threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE
          },
          {
            category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
            threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE
          },
          {
            category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
            threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE
          }
        ];

        // 构建历史对话（Gemini 格式）
        const history = conversationHistory.map(msg => ({
          role: msg.role === 'assistant' ? 'model' : msg.role, // 转换为 Gemini 的 role
          parts: [{ text: msg.content || msg.parts?.[0]?.text }]
        }));

        const chat = geminiModel.startChat({
          generationConfig,
          safetySettings,
          history
        });

        // 使用流式 API
        const result = await chat.sendMessageStream(prompt);

        // 处理流式输出
        for await (const chunk of result.stream) {
          if (controller.signal.aborted) {
            break;
          }

          const chunkText = chunk.text();
          if (chunkText) {
            fullText += chunkText;
            onChunk(chunkText);
          }
        }

        // 用户取消
        if (controller.signal.aborted) {
          reject(new Error('用户已取消请求'));
          return;
        }

        resolve(fullText);

      } catch (error) {
        lastError = error;
        hasError = true;

        // 用户主动取消，不重试
        if (controller.signal.aborted) {
          reject(new Error('用户已取消请求'));
          return;
        }
        
        // 判断是否可以重试
        if (isRetryableError(error) && retryCount < RETRY_CONFIG.maxRetries) {
          retryCount++;
          const delay = calculateRetryDelay(retryCount - 1);
          
          console.log(`Gemini API 错误，将在 ${(delay / 1000).toFixed(1)} 秒后进行第 ${retryCount} 次重试...`);
          onChunk(`\n\n[网络错误，正在进行第 ${retryCount}/${RETRY_CONFIG.maxRetries} 次重试...]`);
          
          // 延迟后重试
          setTimeout(() => {
            if (!controller.signal.aborted) {
              attemptRequest();
            }
          }, delay);
        } else {
          // 重试次数用尽或不可重试的错误
          const errorMessage = formatErrorMessage(lastError, 'Gemini', retryCount, fullText);
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