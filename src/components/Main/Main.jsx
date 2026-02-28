import React, {
  useState,
  useContext,
  useEffect,
  useRef,
  useMemo,
  useCallback,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import "./Main.css";
import { assets } from "../../assets/assets";
import { Context } from "../../context/Context";
import ReactMarkdown from "react-markdown";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import { vs } from "react-syntax-highlighter/dist/esm/styles/prism";
import VoiceRecorder from "../VoiceRecorder/VoiceRecorder";

const Main = () => {
  const {
    onSent,
    currentMessages,
    showResult,
    loading,
    isStreaming,
    setInput,
    input,
    handleKeyPress,
    selectedModel,
    models,
    handleModelSelect,
    stopGeneration,
    isDarkMode,
  } = useContext(Context);

  const [showModelDropdown, setShowModelDropdown] = useState(false);

  const handleModelChange = useCallback(
    (modelId) => {
      handleModelSelect(modelId);
      setShowModelDropdown(false);
    },
    [handleModelSelect],
  );

  // 处理语音识别结果
  const handleVoiceTranscript = useCallback(
    (transcript) => {
      setInput((prev) => prev + transcript);
    },
    [setInput],
  );

  const parentRef = useRef(null);

  // 虚拟滚动配置
  const virtualizer = useVirtualizer({
    count: currentMessages.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 200, // 估计高度
    overscan: 2, // 预渲染 2 个项
  });

  // 自动滚动到底部 - 仅在消息数量变化或开始流式输出时触发
  useEffect(() => {
    if (parentRef.current && currentMessages.length > 0) {
      // 滚动到最后一个消息
      virtualizer.scrollToIndex(currentMessages.length - 1, {
        align: "end",
        behavior: "smooth",
      });
    }
  }, [currentMessages.length, loading, virtualizer]);

  // 缓存 Markdown 组件配置
  const markdownComponents = useMemo(
    () => ({
      code({ inline, className, children, ...props }) {
        const match = /language-(\w+)/.exec(className || "");
        return !inline && match ? (
          <SyntaxHighlighter
            style={isDarkMode ? vscDarkPlus : vs}
            language={match[1]}
            PreTag="div"
            {...props}
          >
            {String(children).replace(/\n$/, "")}
          </SyntaxHighlighter>
        ) : (
          <code className={className} {...props}>
            {children}
          </code>
        );
      },
    }),
    [isDarkMode],
  );

  return (
    <div className="main">
      <div className="nav">
        <p>bingAI</p>
        <img src={assets.user_icon} alt="" />
      </div>
      <div className="main-container">
        {!showResult ? (
          <>
            <div className="greet">
              <p>
                <span>hello, bing</span>
              </p>
              <p>How can I help you?</p>
            </div>
            <div className="cards">
              <div className="card">
                <p>建议一些自驾游时可以去的美丽景点</p>
                <img src={assets.compass_icon} alt="" />
              </div>
              <div className="card">
                <p>简要总结一下"城市规划"这个概念</p>
                <img src={assets.bulb_icon} alt="" />
              </div>
              <div className="card">
                <p>为我们的团队拓展活动集思广益</p>
                <img src={assets.message_icon} alt="" />
              </div>
              <div className="card">
                <p>提升以下代码的可读性</p>
                <img src={assets.code_icon} alt="" />
              </div>
            </div>
          </>
        ) : (
          <div ref={parentRef} className="result">
            <div
              style={{
                height: `${virtualizer.getTotalSize()}px`,
                width: "100%",
                position: "relative",
              }}
            >
              {virtualizer.getVirtualItems().map((virtualItem) => {
                const message = currentMessages[virtualItem.index];
                const index = virtualItem.index;

                return (
                  <div
                    key={message.id}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      transform: `translateY(${virtualItem.start}px)`,
                    }}
                    data-index={virtualItem.index}
                    ref={virtualizer.measureElement}
                  >
                    <div className="result-title">
                      <img src={assets.user_icon} alt="" />
                      <p>{message.prompt}</p>
                    </div>
                    <div className="result-data">
                      {index === currentMessages.length - 1 && loading ? (
                        <div className="loader">
                          <hr />
                          <hr />
                          <hr />
                        </div>
                      ) : (
                        <div className="markdown-content">
                          <ReactMarkdown components={markdownComponents}>
                            {message.result}
                          </ReactMarkdown>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="main-bottom">
          <div className="search-box">
            <input
              onChange={(e) => setInput(e.target.value)}
              value={input}
              type="text"
              onKeyDown={handleKeyPress}
              placeholder="在这里输入提示"
            />
            <div>
              <div className="model-selector">
                <div
                  className="model-selector-button"
                  onClick={() => setShowModelDropdown(!showModelDropdown)}
                >
                  <span>
                    {models.find((m) => m.id === selectedModel)?.name}
                  </span>
                  <img src={assets.dropdown_icon} alt="选择模型" />
                </div>
                {showModelDropdown && (
                  <div className="model-dropdown">
                    {models.map((model) => (
                      <div
                        key={model.id}
                        className={`model-option ${selectedModel === model.id ? "active" : ""}`}
                        onClick={() => handleModelChange(model.id)}
                      >
                        {model.name}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <VoiceRecorder onTranscript={handleVoiceTranscript} />
              {loading || isStreaming ? (
                <img
                  onClick={stopGeneration}
                  src={assets.stop_icon}
                  alt="停止生成"
                  className="stop-icon"
                  title="停止生成"
                />
              ) : input ? (
                <img
                  onClick={() => onSent()}
                  src={assets.send_icon}
                  alt="发送"
                />
              ) : null}
            </div>
          </div>
          <p className="bottom-info">
            bingAI 可能会显示不准确的信息，请仔细检查其回复。
          </p>
        </div>
      </div>
    </div>
  );
};

export default React.memo(Main);
