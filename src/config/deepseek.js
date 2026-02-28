import { fetchEventSource } from '@microsoft/fetch-event-source';
import {
  RETRY_CONFIG,
  calculateRetryDelay,
  isRetryableError,
  shouldUseMockMode,
  getMockResponse,
  simulateStreamOutput,
  formatErrorMessage
} from './api.js';

// API 请求通过本地 Express 代理（server/proxy.js）转发，API Key 由服务端保管
const DEEPSEEK_API_URL = '/proxy/deepseek/v1/chat/completions';

const USE_MOCK_RESPONSE = shouldUseMockMode();

/**
 * 调用 DeepSeek API 生成回复（SSE 流式输出 + 自动重试 + 中断恢复）
 * @param {string} prompt - 用户输入的提示文本
 * @param {string} model - 模型名称（默认为 deepseek-chat）
 * @param {Function} onChunk - 接收每个文本块的回调函数 (chunk) => void
 * @param {Array} conversationHistory - 历史对话消息数组 [{role: 'user'|'assistant', content: string}]
 * @returns {Object} - { promise: Promise<string>, controller: AbortController }
 */
function runChat(prompt, model = "deepseek-chat", onChunk, conversationHistory = []) {

  if (USE_MOCK_RESPONSE) {
    const mockController = new AbortController();
    const mockPromise = (async () => {
      const mockResponse = getMockResponse(prompt, "DeepSeek");
      await simulateStreamOutput(mockResponse, onChunk, mockController);
      return mockResponse;
    })();
    
    return { promise: mockPromise, controller: mockController };
  }

  // 生产模式：使用 fetch-event-source 实现 SSE 流式输出 + 自动重试 + 中断恢复
  const controller = new AbortController();
  let retryCount = 0;
  let accumulatedText = ''; // 累积已接收的文本，用于中断恢复
  
  const promise = new Promise((resolve, reject) => {
    
    const attemptRequest = async (isRecovery = false) => {
      let fullText = accumulatedText; // 从累积的文本开始
      let hasError = false;
      let lastError = null;
      let receivedAnyData = false; // 标记是否收到过数据

      // 构建完整的消息列表
      let messages = [
        {
          role: "system",
          content: "你是一个有用的AI助手，帮助用户回答问题。你会记住之前的对话内容，并基于上下文给出更准确的回答。"
        },
        ...conversationHistory,
        {
          role: "user",
          content: prompt
        }
      ];

      // 如果是中断恢复，添加续写提示
      if (isRecovery && accumulatedText.length > 0) {
        messages.push({
          role: "assistant",
          content: accumulatedText
        });
        messages.push({
          role: "user",
          content: "请继续完成上面的回答，不要重复已经说过的内容，直接从断点继续。"
        });
        
        onChunk('\n\n[正在从断点恢复...]\n\n');
      }

      try {
        await fetchEventSource(DEEPSEEK_API_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: model,
            messages: messages,
            stream: true,
            temperature: 0.7,
            max_tokens: 2000
          }),
          signal: controller.signal,
          
          // 接收 SSE 消息
          onmessage(event) {
            // 跳过心跳消息
            if (event.event === 'ping') return;
            
            const data = event.data;
            
            // 结束标记
            if (data === '[DONE]') {
              controller.abort();
              resolve(fullText);
              return;
            }

            try {
              const parsed = JSON.parse(data);
              const content = parsed.choices?.[0]?.delta?.content;
              
              if (content) {
                receivedAnyData = true;
                fullText += content;
                accumulatedText += content; // 更新累积文本
                onChunk(content);
              }
              
              // 检查是否完成
              if (parsed.choices?.[0]?.finish_reason) {
                controller.abort();
                resolve(fullText);
              }
            } catch (error) {
              // 静默处理解析错误，避免控制台污染
            }
          },
          
          // 流结束
          onclose() {
            if (!hasError) {
              resolve(fullText);
            }
          },
          
          // 错误处理
          onerror(err) {
            hasError = true;
            lastError = err;
            console.error(`SSE 连接错误 (重试 ${retryCount}/${RETRY_CONFIG.maxRetries}):`, err);
            
            // 阻止 fetch-event-source 自动重连
            throw err;
          },
          
          // 请求失败时的重试策略
          openWhenHidden: true,  // 页面隐藏时继续连接
        });
      } catch (error) {
        lastError = error;
        
        // 用户主动取消，不重试
        if (controller.signal.aborted) {
          reject(new Error('用户已取消请求'));
          return;
        }
        
        // 判断是否可以重试
        if (isRetryableError(error) && retryCount < RETRY_CONFIG.maxRetries) {
          retryCount++;
          const delay = calculateRetryDelay(retryCount - 1);
          
          console.log(`将在 ${(delay / 1000).toFixed(1)} 秒后进行第 ${retryCount} 次重试...`);
          
          // 如果已经收到部分数据，使用中断恢复模式
          const recoveryMode = receivedAnyData && accumulatedText.length > 50;
          
          if (recoveryMode) {
            onChunk(`\n\n[连接中断，已保存 ${accumulatedText.length} 字符，将在 ${(delay / 1000).toFixed(1)}s 后尝试续写...]`);
          } else {
            onChunk(`\n\n[网络错误，正在进行第 ${retryCount}/${RETRY_CONFIG.maxRetries} 次重试...]`);
          }
          
          // 延迟后重试（可能是恢复模式）
          setTimeout(() => {
            if (!controller.signal.aborted) {
              attemptRequest(recoveryMode);
            }
          }, delay);
        } else {
          // 重试次数用尽或不可重试的错误
          const errorMessage = formatErrorMessage(lastError, 'DeepSeek', retryCount, accumulatedText);
          onChunk(errorMessage);
          reject(lastError || new Error(errorMessage));
        }
      }
    };
    
    // 开始第一次请求
    attemptRequest(false);
  });
  
  return { promise, controller };
}

export default runChat;