/**
 * 公共 API 配置和工具函数
 * 供 DeepSeek 和 Gemini 共用
 */

// ===== 重试配置 =====
export const RETRY_CONFIG = {
  maxRetries: 3,           // 最多重试 3 次
  baseDelay: 1000,         // 基础延迟
  maxDelay: 10000,         // 最大延迟
  jitterRange: 1000        // 随机抖动范围 0-1000ms
};

/**
 * 计算重试延迟（指数退避 + 随机抖动）
 * @param {number} retryCount - 当前重试次数（0-based）
 * @returns {number} - 延迟毫秒数
 */
export function calculateRetryDelay(retryCount) {
  // 指数退避：2^n * baseDelay
  const exponentialDelay = Math.pow(2, retryCount) * RETRY_CONFIG.baseDelay;
  
  // 添加随机抖动，避免多个请求同时重试
  const jitter = Math.random() * RETRY_CONFIG.jitterRange;
  
  // 限制最大延迟
  return Math.min(exponentialDelay + jitter, RETRY_CONFIG.maxDelay);
}

/**
 * 判断错误是否可以重试
 * @param {Error} error - 错误对象
 * @returns {boolean} - 是否可以重试
 */
export function isRetryableError(error) {
  // 用户主动取消不重试
  if (error.name === 'AbortError') return false;
  if (error.message.includes('网络') || error.message.includes('Network')) return true;
  if (error.message.includes('timeout') || error.message.includes('超时')) return true;
  // 429 (Too Many Requests) 可重试
  if (error.message.includes('429')) return true;
  // 500+ 服务器错误可重试
  if (error.message.includes('500') || error.message.includes('502') || error.message.includes('503')) return true;
  
  // 其他错误不重试（如 401 认证失败、400 参数错误）
  return false;
}

// ===== Mock 模式配置 =====

/**
 * 检查是否应该使用 Mock 模式
 * @param {string} apiKey - API 密钥
 * @returns {boolean} - 是否使用 Mock 模式
 */
export function shouldUseMockMode(apiKey) {
  return !apiKey || apiKey === "your_api_key_here" || apiKey.trim() === "";
}

/**
 * Mock 回复数据库
 */
const MOCK_RESPONSES = {
  // 常见问题的模拟回复
  "你好": "你好！我是AI助手，很高兴为你提供帮助。请问有什么我可以帮你的吗？",
  "你是谁": "我是一个AI助手。在实际部署时，你需要配置有效的API密钥才能使用完整功能。",
  "什么是AI": "人工智能（AI）是计算机科学的一个分支，致力于创建能够模拟人类智能行为的系统。这些系统可以学习、推理、解决问题、理解自然语言、感知环境等。\n\n注意：这是一个模拟回复。在生产环境中，你需要配置有效的API密钥来获取更准确的信息。",
  "如何学习编程": "学习编程是一个循序渐进的过程。以下是一些建议：\n\n1. 选择一门入门语言（如Python或JavaScript）\n2. 学习基础概念（变量、条件语句、循环、函数等）\n3. 实践编码，从小项目开始\n4. 参与社区，向他人学习\n5. 不断挑战自己，尝试更复杂的项目\n\n注意：这是一个模拟回复。配置API密钥后可以获得更详细的指导。"
};

/**
 * 生成模拟回复（开发模式使用）
 * @param {string} prompt - 用户输入的提示文本
 * @param {string} modelName - 模型名称（用于提示信息）
 * @returns {string} - 模拟的AI回复
 */
export function getMockResponse(prompt, modelName = "AI") {
  // 查找匹配的回复
  const lowerPrompt = prompt.toLowerCase();
  for (const [key, value] of Object.entries(MOCK_RESPONSES)) {
    if (lowerPrompt.includes(key)) {
      return value;
    }
  }

  // 默认回复
  return `这是一个模拟回复。你的问题是："${prompt}"\n\n要使用真实的 ${modelName} 回复，请按照以下步骤操作：\n1. 获取 ${modelName} API Key\n2. 在项目根目录创建 .env.local 文件\n3. 添加配置：VITE_${modelName.toUpperCase()}_API_KEY=你的密钥\n4. 重新启动应用`;
}

/**
 * 模拟流式输出（Mock模式）
 * @param {string} text - 要输出的完整文本
 * @param {Function} onChunk - 接收每个字符的回调函数
 * @param {AbortController} controller - 中断控制器
 * @returns {Promise<string>} - 完整文本
 */
export async function simulateStreamOutput(text, onChunk, controller) {
  for (let i = 0; i < text.length; i++) {
    if (controller.signal.aborted) break;
    onChunk(text[i]);
    await new Promise(resolve => setTimeout(resolve, 20)); // 模拟打字速度
  }
  return text;
}

/**
 * 构建系统提示词
 * @param {string} customPrompt - 自定义系统提示（可选）
 * @returns {string} - 系统提示词
 */
export function buildSystemPrompt(customPrompt) {
  const defaultPrompt = "你是一个有用的AI助手，帮助用户回答问题。你会记住之前的对话内容，并基于上下文给出更准确的回答。";
  return customPrompt || defaultPrompt;
}

/**
 * 格式化错误消息
 * @param {Error} error - 错误对象
 * @param {string} modelName - 模型名称
 * @param {number} retryCount - 当前重试次数
 * @param {string} partialText - 已接收的部分文本
 * @returns {string} - 格式化后的错误消息
 */
export function formatErrorMessage(error, modelName, retryCount, partialText = '') {
  const errorType = error.name === 'AbortError' ? '用户取消' :
                   retryCount >= RETRY_CONFIG.maxRetries ? '重试次数已达上限' :
                   'API 错误';
  
  const partialResult = partialText.length > 0 ? 
    `\n\n**已接收部分回答（${partialText.length} 字符）**` : '';
  
  return `\n\n**${modelName} 连接失败 (${errorType})**\n\n` +
         `错误详情：${error?.message || '未知错误'}${partialResult}\n\n` +
         `请检查：\n` +
         `1. 网络连接是否正常\n` +
         `2. API Key 是否有效\n` +
         `3. API 配额是否充足`;
}
