import {
  createContext,
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
} from "react";
import runDeepSeekChat from "../config/deepseek";
import {
  getAllSessions,
  saveSession as dbSaveSession,
  deleteSession as dbDeleteSession,
  updateSession as dbUpdateSession,
} from "../config/db";

export const Context = createContext();

const ContextProvider = (props) => {
  const [input, setInput] = useState("");
  const [chatSessions, setChatSessions] = useState([]);
  const [dbReady, setDbReady] = useState(false);
  const [currentSessionId, setCurrentSessionId] = useState(null);
  const [currentMessages, setCurrentMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [showResult, setShowResult] = useState(false);
  const [abortController, setAbortController] = useState(null);
  const [selectedModel, setSelectedModel] = useState(() => {
    const saved = localStorage.getItem("selectedModel");
    // 若之前存的是 Gemini 模型，重置为 deepseek-chat
    if (saved && saved.startsWith("gemini")) return "deepseek-chat";
    return saved || "deepseek-chat";
  });
  const [isDarkMode, setIsDarkMode] = useState(() => {
    return localStorage.getItem("darkMode") === "true";
  });

  // 只保留 DeepSeek 模型
  const models = useMemo(
    () => [
      { id: "deepseek-chat", name: "DeepSeek Chat" },
      { id: "deepseek-reasoner", name: "DeepSeek Reasoner" },
    ],
    [],
  );

  const stateRef = useRef();
  stateRef.current = {
    loading,
    input,
    currentSessionId,
    currentMessages,
    selectedModel,
    abortController,
  };

  const textBufferRef = useRef("");
  const updateTimerRef = useRef(null);
  const saveTimerRef = useRef(null);

  const handleModelSelect = useCallback((modelId) => {
    setSelectedModel(modelId);
  }, []);

  const toggleContrast = useCallback(() => {
    setIsDarkMode((prevMode) => {
      const newMode = !prevMode;
      localStorage.setItem("darkMode", newMode.toString());
      document.body.classList.toggle("dark-mode", newMode);
      return newMode;
    });
  }, []);

  // ===== IndexedDB 初始化 =====
  useEffect(() => {
    const initDB = async () => {
      try {
        const sessions = await getAllSessions();
        setChatSessions(sessions);
      } catch (error) {
        console.error("IndexedDB 初始化失败:", error);
      } finally {
        setDbReady(true);
      }
    };
    initDB();
  }, []);

  // 持久化选中模型
  useEffect(() => {
    localStorage.setItem("selectedModel", selectedModel);
  }, [selectedModel]);

  // 初始化主题
  useEffect(() => {
    document.body.classList.toggle("dark-mode", isDarkMode);
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
    setCurrentSessionId(Date.now().toString());
    setCurrentMessages([]);
    setShowResult(false);
    setInput("");
  }, []);

  const loadChat = useCallback(
    (sessionId) => {
      const session = chatSessions.find((s) => s.id === sessionId);
      if (session) {
        setCurrentSessionId(session.id);
        setCurrentMessages(session.messages);
        setShowResult(true);
        setInput("");
      }
    },
    [chatSessions],
  );

  const deletePromptItem = useCallback((sessionId) => {
    dbDeleteSession(sessionId).catch((err) =>
      console.error("从 IndexedDB 删除会话失败:", err),
    );
    setChatSessions((prev) => prev.filter((s) => s.id !== sessionId));
    if (sessionId === stateRef.current.currentSessionId) {
      setCurrentSessionId(Date.now().toString());
      setCurrentMessages([]);
      setShowResult(false);
      setInput("");
    }
  }, []);

  const renameSession = useCallback((sessionId, newTitle) => {
    dbUpdateSession(sessionId, { title: newTitle }).catch((err) =>
      console.error("重命名会话失败:", err),
    );
    setChatSessions((prev) =>
      prev.map((s) => (s.id === sessionId ? { ...s, title: newTitle } : s)),
    );
  }, []);

  const updateSessionToDB = useCallback((sessionId, messages) => {
    if (!sessionId || messages.length === 0) return;

    setChatSessions((prev) => {
      const existing = prev.find((s) => s.id === sessionId);
      const session = {
        id: sessionId,
        title:
          existing?.title || messages[0]?.prompt.substring(0, 50) || "New Chat",
        messages,
        timestamp: Date.now(),
        model: stateRef.current.selectedModel,
      };

      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        dbSaveSession(session).catch((err) =>
          console.error("保存会话到 IndexedDB 失败:", err),
        );
        saveTimerRef.current = null;
      }, 500);

      return existing
        ? prev.map((s) => (s.id === sessionId ? session : s))
        : [...prev, session];
    });
  }, []);

  const onSent = useCallback(async () => {
    const state = stateRef.current;
    if (state.loading) return;

    const userMessage = state.input;
    if (!userMessage.trim()) return;

    if (userMessage.length > 4000) {
      alert("输入内容过长，请控制在4000字以内");
      return;
    }

    setInput("");

    let sessionId = state.currentSessionId;
    if (!sessionId) {
      sessionId = Date.now().toString();
      setCurrentSessionId(sessionId);
    }

    setShowResult(true);
    setLoading(true);
    setIsStreaming(true);

    const newMessage = {
      id: Date.now().toString(),
      prompt: userMessage,
      result: "",
      timestamp: Date.now(),
    };

    const updatedMessages = [...state.currentMessages, newMessage];
    setCurrentMessages(updatedMessages);

    try {
      let accumulatedText = "";

      const MAX_HISTORY_MESSAGES = 10;
      const conversationHistory = state.currentMessages
        .slice(-MAX_HISTORY_MESSAGES)
        .flatMap((msg) => [
          { role: "user", content: msg.prompt },
          { role: "assistant", content: msg.result },
        ])
        .filter((msg) => msg.content);

      // 全部走 DeepSeek（已移除 Gemini 分支）
      const { promise, controller } = runDeepSeekChat(
        userMessage,
        state.selectedModel,
        (chunk) => {
          accumulatedText += chunk;
          setLoading(false);
          textBufferRef.current = accumulatedText;

          if (!updateTimerRef.current) {
            updateTimerRef.current = setTimeout(() => {
              setCurrentMessages((prev) => {
                const updated = prev.map((msg, idx) =>
                  idx === prev.length - 1
                    ? { ...msg, result: textBufferRef.current }
                    : msg,
                );
                updateSessionToDB(sessionId, updated);
                return updated;
              });
              updateTimerRef.current = null;
            }, 100);
          }
        },
        conversationHistory,
      );

      setAbortController(controller);
      await promise;

      if (updateTimerRef.current) {
        clearTimeout(updateTimerRef.current);
        updateTimerRef.current = null;
      }

      setCurrentMessages((prev) => {
        const updated = prev.map((msg, idx) =>
          idx === prev.length - 1
            ? { ...msg, result: textBufferRef.current }
            : msg,
        );
        updateSessionToDB(sessionId, updated);
        return updated;
      });

      textBufferRef.current = "";
    } catch (error) {
      if (
        error.name === "AbortError" ||
        stateRef.current.abortController?.signal.aborted
      ) {
        console.log("用户已停止生成");
        return;
      }

      console.error("API 调用失败:", error);
      const errorMessage =
        `**错误：** API 调用失败\n\n详情：${error.message}\n\n` +
        `请检查：\n1. API Key 是否正确\n2. 网络连接是否正常\n3. 浏览器控制台是否有详细错误`;

      setCurrentMessages((prev) => {
        const updated = prev.map((msg, idx) =>
          idx === prev.length - 1
            ? { ...msg, result: errorMessage, isError: true }
            : msg,
        );
        updateSessionToDB(sessionId, updated);
        return updated;
      });
    } finally {
      if (updateTimerRef.current) {
        clearTimeout(updateTimerRef.current);
        updateTimerRef.current = null;
      }
      textBufferRef.current = "";
      setLoading(false);
      setIsStreaming(false);
      setAbortController(null);
    }
  }, [updateSessionToDB]);

  const handleKeyPress = useCallback(
    (e) => {
      if (e.key === "Enter") onSent();
    },
    [onSent],
  );

  const contextValue = {
    input,
    setInput,
    currentMessages,
    chatSessions,
    currentSessionId,
    onSent,
    newChat,
    loadChat,
    stopGeneration,
    deletePromptItem,
    renameSession,
    handleKeyPress,
    showResult,
    loading,
    isStreaming,
    dbReady,
    models,
    selectedModel,
    setSelectedModel,
    handleModelSelect,
    isDarkMode,
    toggleContrast,
  };

  return (
    <Context.Provider value={contextValue}>{props.children}</Context.Provider>
  );
};

export default ContextProvider;
