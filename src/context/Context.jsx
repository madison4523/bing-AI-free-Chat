import { createContext, useState, useEffect, useMemo, useCallback, useRef } from "react";
import runDeepSeekChat from "../config/deepseek";
import runGeminiChat from "../config/gemini";
import {
    getAllSessions,
    saveSession as dbSaveSession,
    deleteSession as dbDeleteSession,
    updateSession as dbUpdateSession,
} from "../config/db";


export const Context = createContext();

const ContextProvider = (props) =>{
    // 核心状态
    const [input, setInput] = useState("");
    // 初始化为空数组，由 useEffect 异步从 IndexedDB 加载
    const [chatSessions, setChatSessions] = useState([]);
    const [dbReady, setDbReady] = useState(false); // 数据库就绪标记

    const [currentSessionId, setCurrentSessionId] = useState(null);
    const [currentMessages, setCurrentMessages] = useState([]);
    const [loading, setLoading] = useState(false);
    const [isStreaming, setIsStreaming] = useState(false);
    const [showResult, setShowResult] = useState(false);
    const [abortController, setAbortController] = useState(null);
    const [selectedModel, setSelectedModel] = useState(() => {
        return localStorage.getItem('selectedModel') || "deepseek-chat";
    });
    const [isDarkMode, setIsDarkMode] = useState(() => {
        const savedTheme = localStorage.getItem('darkMode');
        return savedTheme === 'true';
    });
    
    // 使用 useMemo 缓存 models 数组，避免每次渲染都创建新对象
    const models = useMemo(() => [
        { id: "deepseek-chat", name: "DeepSeek Chat" },
        { id: "deepseek-reasoner", name: "DeepSeek Reasoner" },
        { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash" },
        { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro" }
    ], []);

    // 使用 ref 存储状态，避免 onSent 频繁重新创建
    const stateRef = useRef();
    stateRef.current = {
        loading,
        input,
        currentSessionId,
        currentMessages,
        selectedModel,
        abortController
    };

    // 批量更新优化：用于暂存流式输出的文本
    const textBufferRef = useRef('');
    const updateTimerRef = useRef(null);

    const handleModelSelect = useCallback((modelId) => {
        setSelectedModel(modelId);
    }, []);

  const toggleContrast = useCallback(() => {
    setIsDarkMode(prevMode => {
      const newMode = !prevMode;
      // 保存到 localStorage
      localStorage.setItem('darkMode', newMode.toString());
      if (newMode) {
        document.body.classList.add('dark-mode');
      } else {
        document.body.classList.remove('dark-mode');
      }
      return newMode;
    });
  }, []);

    // ===== 初始化：从 IndexedDB 加载数据 =====
    useEffect(() => {
        const initDB = async () => {
            try {
                const sessions = await getAllSessions();
                setChatSessions(sessions);
            } catch (error) {
                console.error('IndexedDB 初始化失败:', error);
            } finally {
                setDbReady(true);
            }
        };

        initDB();
    }, []);

    // 持久化选中的模型
    useEffect(() => {
        localStorage.setItem('selectedModel', selectedModel);
    }, [selectedModel]);

    // 初始化主题
    useEffect(() => {
        if (isDarkMode) {
            document.body.classList.add('dark-mode');
        } else {
            document.body.classList.remove('dark-mode');
        }
    }, [isDarkMode]);

    const stopGeneration = useCallback(() => {
        if (abortController) {
            abortController.abort();
            setAbortController(null);
            setLoading(false);
            setIsStreaming(false);
        }
    }, [abortController]);

    const newChat = useCallback(() => {
        // 创建新会话
        const newSessionId = Date.now().toString();
        setCurrentSessionId(newSessionId);
        setCurrentMessages([]);
        setShowResult(false);
        setInput('');
    }, []);

    const loadChat = useCallback((sessionId) => {
        const session = chatSessions.find(s => s.id === sessionId);
        if (session) {
            setCurrentSessionId(session.id);
            setCurrentMessages(session.messages);
            setShowResult(true);
            setInput('');
        }
    }, [chatSessions]);

    const deletePromptItem = useCallback((sessionId) => {
        // 从 IndexedDB 删除
        dbDeleteSession(sessionId).catch(err => 
            console.error('从 IndexedDB 删除会话失败:', err)
        );

        // 更新内存状态
        setChatSessions(prev => prev.filter(s => s.id !== sessionId));
        
        // 如果删除的是当前会话，则开启新会话
        if (sessionId === currentSessionId) {
            const newSessionId = Date.now().toString();
            setCurrentSessionId(newSessionId);
            setCurrentMessages([]);
            setShowResult(false);
            setInput('');
        }
    }, [currentSessionId]);

    const renameSession = useCallback((sessionId, newTitle) => {
        // 更新 IndexedDB
        dbUpdateSession(sessionId, { title: newTitle }).catch(err => 
            console.error('重命名会话失败:', err)
        );

        // 更新内存状态
        setChatSessions(prev => 
            prev.map(s => 
                s.id === sessionId 
                    ? { ...s, title: newTitle }
                    : s
            )
        );
    }, []);

    // 实时更新会话到 IndexedDB（带防抖）
    const saveTimerRef = useRef(null);
    const updateSessionToDB = useCallback((sessionId, messages) => {
        if (!sessionId || messages.length === 0) return;
        
        setChatSessions(prev => {
            const existing = prev.find(s => s.id === sessionId);
            
            const session = {
                id: sessionId,
                title: existing?.title || messages[0]?.prompt.substring(0, 50) || 'New Chat',
                messages: messages,
                timestamp: Date.now(),
                model: stateRef.current.selectedModel
            };
            
            // 防抖写入 IndexedDB（500ms）
            if (saveTimerRef.current) {
                clearTimeout(saveTimerRef.current);
            }
            saveTimerRef.current = setTimeout(() => {
                dbSaveSession(session).catch(err => 
                    console.error('保存会话到 IndexedDB 失败:', err)
                );
                saveTimerRef.current = null;
            }, 500);
            
            if (existing) {
                return prev.map(s => s.id === sessionId ? session : s);
            }
            return [...prev, session];
        });
    }, []);

    const onSent = useCallback(async () => {
        const state = stateRef.current;
        if (state.loading) return;
        
        const userMessage = state.input;
        
        if (!userMessage.trim()) {
            return;
        }
        
        if (userMessage.length > 4000) {
            alert("输入内容过长，请控制在4000字以内");
            return;
        }
        
        setInput("");
        
        // 如果没有当前会话，创建新会话
        let sessionId = state.currentSessionId;
        if (!sessionId) {
            sessionId = Date.now().toString();
            setCurrentSessionId(sessionId);
        }
        
        setShowResult(true);
        setLoading(true);
        setIsStreaming(true);
        
        // 添加用户消息到当前会话
        const newMessage = {
            id: Date.now().toString(),
            prompt: userMessage,
            result: "",
            timestamp: Date.now()
        };
        
        const updatedMessages = [...state.currentMessages, newMessage];
        setCurrentMessages(updatedMessages);
    
        try {
            let accumulatedText = "";
            
            // 构建历史对话（使用滑动窗口，只保留最近10轮）
            const MAX_HISTORY_MESSAGES = 10;
            const conversationHistory = state.currentMessages
                .slice(-MAX_HISTORY_MESSAGES)
                .map(msg => [
                    { role: "user", content: msg.prompt },
                    { role: "assistant", content: msg.result }
                ]).flat().filter(msg => msg.content); // 过滤空回复
            
            const apiFunction = state.selectedModel.startsWith('gemini') 
                ? runGeminiChat 
                : runDeepSeekChat;

            const { promise, controller } = apiFunction(
                userMessage, 
                state.selectedModel, 
                (chunk) => {
                    accumulatedText += chunk;
                    
                    // 收到第一个 chunk，关闭加载动画
                    setLoading(false);
                
                    // 批量更新优化：将文本暂存到 buffer，定时批量更新 UI
                    textBufferRef.current = accumulatedText;
                    
                    // 如果没有待执行的定时器，创建一个新的（100ms 批量更新）
                    if (!updateTimerRef.current) {
                        updateTimerRef.current = setTimeout(() => {
                            setCurrentMessages(prev => {
                                const updated = prev.map((msg, idx) => 
                                    idx === prev.length - 1 
                                        ? { ...msg, result: textBufferRef.current }
                                        : msg
                                );
                            
                                updateSessionToDB(sessionId, updated);
                            
                                return updated;
                            });
                            
                            // 清除定时器引用，允许下一次批量更新
                            updateTimerRef.current = null;
                        }, 100); // 每 100ms 批量更新一次 UI
                    }
                },
                conversationHistory  // 传递历史消息
            );
            
            // 保存 controller 以便外部中断
            setAbortController(controller);
            
            // 等待流式传输完成
            await promise;
            
            // 流式输出结束，立即执行最后一次更新（清空定时器）
            if (updateTimerRef.current) {
                clearTimeout(updateTimerRef.current);
                updateTimerRef.current = null;
            }
            
            // 确保最后的内容被更新到 UI
            setCurrentMessages(prev => {
                const updated = prev.map((msg, idx) => 
                    idx === prev.length - 1 
                        ? { ...msg, result: textBufferRef.current }
                        : msg
                );
                
                updateSessionToDB(sessionId, updated);
                
                return updated;
            });
            
            // 清空 buffer
            textBufferRef.current = '';
            
        } catch (error) {
            // 用户主动取消不显示错误
            if (error.name === 'AbortError' || stateRef.current.abortController?.signal.aborted) {
                console.log('用户已停止生成');
                return;
            }
            
            console.error("API 调用失败:", error);
            const errorMessage = `**错误：** API 调用失败\n\n详情：${error.message}\n\n请检查：\n1. API Key 是否正确\n2. 网络连接是否正常\n3. 浏览器控制台是否有详细错误`;
            
            // 更新错误信息
            setCurrentMessages(prev => {
                const updated = prev.map((msg, idx) => 
                    idx === prev.length - 1 
                        ? { ...msg, result: errorMessage, isError: true }
                        : msg
                );
                
                // 保存错误信息
                updateSessionToDB(sessionId, updated);
                
                return updated;
            });
        } finally {
            // 清理定时器
            if (updateTimerRef.current) {
                clearTimeout(updateTimerRef.current);
                updateTimerRef.current = null;
            }
            
            // 清空 buffer
            textBufferRef.current = '';
            
            setLoading(false);
            setIsStreaming(false);
            setAbortController(null);
        }
    }, [updateSessionToDB]); // updateSessionToDB 引用稳定（依赖为空）
    
    const handleKeyPress = useCallback((e) => {
        if (e.key === "Enter") {
            onSent(); // onSent 内部已经有 loading 检查
        }
    }, [onSent]);

    const contextValue = {
        // 消息相关
        input,
        setInput,
        currentMessages,
        chatSessions,
        currentSessionId,
        
        // 核心方法
        onSent,
        newChat,
        loadChat,
        stopGeneration,
        deletePromptItem,
        renameSession,
        handleKeyPress,
        
        // UI 状态
        showResult,
        loading,
        isStreaming,
        dbReady,
        
        // 模型选择
        models,
        selectedModel,
        setSelectedModel,
        handleModelSelect,
        
        // 主题切换
        isDarkMode,
        toggleContrast
    }

    return (
        <Context.Provider value ={contextValue}>
            {props.children}
        </Context.Provider>
    )
}

export default ContextProvider