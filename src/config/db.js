/**
 * IndexedDB 封装模块
 * 替代 localStorage 存储 chatSessions，解决 5MB 存储上限问题
 */

const DB_NAME = 'bingAIChatDB';
const DB_VERSION = 1;
const STORE_NAME = 'chatSessions';

/**
 * 打开/初始化数据库（单例缓存）
 * @returns {Promise<IDBDatabase>}
 */
let dbInstance = null;

function openDB() {
  if (dbInstance) return Promise.resolve(dbInstance);

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('timestamp', 'timestamp', { unique: false });
      }
    };

    request.onsuccess = () => {
      dbInstance = request.result;
      // 数据库意外关闭时清除缓存
      dbInstance.onclose = () => { dbInstance = null; };
      resolve(dbInstance);
    };

    request.onerror = () => reject(request.error);
  });
}

/**
 * 获取所有会话
 * @returns {Promise<Array>}
 */
export async function getAllSessions() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => {
      // 按 timestamp 排序，保持与原 localStorage 行为一致
      const sessions = request.result.sort((a, b) => a.timestamp - b.timestamp);
      resolve(sessions);
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * 保存或更新单个会话（put = insert or update）
 * @param {Object} session - 会话对象，必须包含 id 字段
 * @returns {Promise<void>}
 */
export async function saveSession(session) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put(session);

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * 删除单个会话
 * @param {string} sessionId
 * @returns {Promise<void>}
 */
export async function deleteSession(sessionId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.delete(sessionId);

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * 更新会话的部分字段（先读后写）
 * @param {string} sessionId
 * @param {Object} updates - 要更新的字段
 * @returns {Promise<void>}
 */
export async function updateSession(sessionId, updates) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const getRequest = store.get(sessionId);

    getRequest.onsuccess = () => {
      const session = getRequest.result;
      if (session) {
        Object.assign(session, updates);
        store.put(session);
      }
    };

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
