import React, {
  useContext,
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
} from "react";
import { FixedSizeList as List } from "react-window";
import "./SideBar.css";
import { assets } from "../../assets/assets";
import { Context } from "../../context/Context";

const SideBar = () => {
  const [isExpanded, setIsExpanded] = useState(true);
  const listRef = useRef(null);
  const {
    loadChat,
    chatSessions,
    currentSessionId,
    newChat,
    deletePromptItem,
    renameSession,
    toggleContrast,
    isDarkMode,
    isStreaming,
  } = useContext(Context);

  const [menuOpenId, setMenuOpenId] = useState(null);
  const [renamingId, setRenamingId] = useState(null);
  const renameDraftRef = useRef(""); // 改用 ref 避免 IME 输入问题

  // 使用 useMemo 缓存反转后的会话列表
  const reversedSessions = useMemo(() => {
    return chatSessions.slice().reverse();
  }, [chatSessions]);

  // 使用 ref 存储函数和状态，避免 SessionItem 频繁重新创建
  const functionsRef = useRef();
  functionsRef.current = {
    loadChat,
    deletePromptItem,
    renameSession,
    reversedSessions, // 将 reversedSessions 也存入 ref
  };

  useEffect(() => {
    if (!renamingId) {
      renameDraftRef.current = "";
    }
  }, [renamingId]);

  const handleMenuToggle = useCallback((sessionId) => {
    setMenuOpenId((prev) => (prev === sessionId ? null : sessionId));
  }, []);

  const handleRenameStart = useCallback((session) => {
    setRenamingId(session.id);
    renameDraftRef.current = session.title;
    setMenuOpenId(null);
  }, []);

  const handleRenameSubmit = useCallback((sessionId) => {
    const trimmed = renameDraftRef.current.trim().substring(0, 50);
    if (trimmed) {
      functionsRef.current.renameSession(sessionId, trimmed);
    }
    setRenamingId(null);
  }, []);

  // 渲染单个会话项 - 函数和 draft 通过 ref 访问，避免中文输入法重复
  const SessionItem = useCallback(
    ({ index, style }) => {
      const fns = functionsRef.current;
      const session = fns.reversedSessions[index]; // 从 ref 读取
      const isRenaming = renamingId === session.id;
      const submitRename = () => handleRenameSubmit(session.id);

      return (
        <div
          style={style}
          onClick={() => {
            if (!isStreaming) {
              fns.loadChat(session.id);
            }
          }}
          className={`recent-entry ${session.id === currentSessionId ? "active" : ""} ${isStreaming ? "disabled" : ""}`}
        >
          <img src={assets.message_icon} alt="消息" />
          {isRenaming ? (
            <input
              type="text"
              className="rename-input"
              defaultValue={renameDraftRef.current}
              onChange={(e) => {
                renameDraftRef.current = e.target.value;
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  submitRename();
                } else if (e.key === "Escape") {
                  setRenamingId(null);
                }
              }}
              onBlur={submitRename}
              autoFocus
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <p>{session.title}</p>
          )}

          <div className="entry-actions">
            <img
              src={
                isDarkMode
                  ? assets.more_vertical_dark
                  : assets.more_vertical_light
              }
              alt="更多"
              className="more-icon"
              onClick={(e) => {
                e.stopPropagation();
                handleMenuToggle(session.id);
              }}
            />
            {menuOpenId === session.id && (
              <div className="context-menu">
                <div
                  className="menu-item"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRenameStart(session);
                  }}
                >
                  <img src={assets.edit} alt="重命名" />
                  <span>Rename</span>
                </div>
                <div
                  className="menu-item delete"
                  onClick={(e) => {
                    e.stopPropagation();
                    fns.deletePromptItem(session.id);
                    setMenuOpenId(null);
                  }}
                >
                  <img src={assets.trash} alt="删除" />
                  <span>Delete</span>
                </div>
              </div>
            )}
          </div>
        </div>
      );
    },
    [
      currentSessionId,
      renamingId,
      menuOpenId,
      isDarkMode,
      handleRenameSubmit,
      isStreaming,
      handleMenuToggle,
      handleRenameStart,
    ],
  );

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuOpenId && !e.target.closest(".entry-actions")) {
        setMenuOpenId(null);
      }
    };
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, [menuOpenId, setMenuOpenId]);

  return (
    <div className={`sidebar ${isExpanded ? "" : "collapsed"}`}>
      <div className="top">
        <img
          className="menu"
          src={assets.menu_icon}
          alt="菜单"
          onClick={() => setIsExpanded(!isExpanded)}
        />
        <div
          onClick={() => {
            if (!isStreaming) {
              newChat();
            }
          }}
          className={`new-chat ${isStreaming ? "disabled" : ""}`}
        >
          <img src={assets.plus_icon} alt="新建对话" />
          {isExpanded ? <p>New Chat</p> : null}
        </div>
        {isExpanded && (
          <div className="recent">
            <p className="recent-title">Recent</p>
            {reversedSessions && reversedSessions.length > 0 ? (
              <List
                ref={listRef}
                height={400}
                itemCount={reversedSessions.length}
                itemSize={50}
                width="100%"
                className="virtual-list"
              >
                {SessionItem}
              </List>
            ) : null}
          </div>
        )}
      </div>
      <div className="bottom">
        <div className="bottom-item recent-entry" onClick={toggleContrast}>
          <img src={assets.contrast_icon} alt="对比度切换" />
          {isExpanded ? <p>Contrast</p> : null}
        </div>
        <div className="bottom-item recent-entry">
          <img src={assets.question_icon} alt="帮助" />
          {isExpanded ? <p>Help</p> : null}
        </div>
        <div className="bottom-item recent-entry">
          <img src={assets.history_icon} alt="活动" />
          {isExpanded ? <p>Activity</p> : null}
        </div>
        <div className="bottom-item recent-entry">
          <img src={assets.setting_icon} alt="设置" />
          {isExpanded ? <p>Setting</p> : null}
        </div>
      </div>
    </div>
  );
};

export default React.memo(SideBar);
