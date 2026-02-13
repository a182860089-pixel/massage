/**
 * SearchIndex — IndexedDB 全文搜索索引
 * 支持对话标题、内容的中文子串搜索
 */

const SearchIndex = {
  DB_NAME: 'ChatGPTSaverSearchDB',
  STORE_NAME: 'conversations',
  DB_VERSION: 1,
  _db: null,

  /**
   * 打开/创建 IndexedDB 数据库
   */
  async _openDB() {
    if (this._db) return this._db;
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(this.STORE_NAME)) {
          db.createObjectStore(this.STORE_NAME, { keyPath: 'id' });
        }
      };
      request.onsuccess = (event) => {
        this._db = event.target.result;
        resolve(this._db);
      };
      request.onerror = (event) => {
        reject(new Error('IndexedDB open failed: ' + event.target.error));
      };
    });
  },

  /**
   * 索引一条对话
   * @param {Object} entry - { id, title, workspace, url, timestamp, textContent, messageCount }
   */
  async indexConversation(entry) {
    const db = await this._openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE_NAME, 'readwrite');
      const store = tx.objectStore(this.STORE_NAME);
      store.put(entry);
      tx.oncomplete = () => resolve();
      tx.onerror = (e) => reject(new Error('Index failed: ' + e.target.error));
    });
  },

  /**
   * 搜索对话（大小写不敏感子串匹配）
   * @param {string} query - 搜索关键词
   * @returns {Promise<Array>} 匹配结果
   */
  async search(query) {
    if (!query || !query.trim()) return [];
    const db = await this._openDB();
    const lowerQuery = query.toLowerCase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE_NAME, 'readonly');
      const store = tx.objectStore(this.STORE_NAME);
      const results = [];
      const request = store.openCursor();
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          const entry = cursor.value;
          const titleMatch = (entry.title || '').toLowerCase().includes(lowerQuery);
          const contentMatch = (entry.textContent || '').toLowerCase().includes(lowerQuery);
          if (titleMatch || contentMatch) {
            results.push({
              ...entry,
              snippet: this.extractSnippet(entry.textContent || '', query, 40)
            });
          }
          cursor.continue();
        } else {
          resolve(results);
        }
      };
      request.onerror = (e) => reject(new Error('Search failed: ' + e.target.error));
    });
  },


  /**
   * 提取包含关键词的文本片段
   * @param {string} text - 原始文本
   * @param {string} keyword - 关键词
   * @param {number} contextLength - 关键词前后的上下文字符数
   * @returns {string} 片段
   */
  extractSnippet(text, keyword, contextLength) {
    if (!text || !keyword) return '';
    contextLength = contextLength || 40;
    const lowerText = text.toLowerCase();
    const lowerKeyword = keyword.toLowerCase();
    const idx = lowerText.indexOf(lowerKeyword);
    if (idx < 0) return text.substring(0, contextLength * 2);
    const start = Math.max(0, idx - contextLength);
    const end = Math.min(text.length, idx + keyword.length + contextLength);
    let snippet = text.substring(start, end);
    if (start > 0) snippet = '...' + snippet;
    if (end < text.length) snippet = snippet + '...';
    return snippet;
  },

  /**
   * 删除一条索引
   */
  async removeEntry(id) {
    const db = await this._openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE_NAME, 'readwrite');
      const store = tx.objectStore(this.STORE_NAME);
      store.delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = (e) => reject(new Error('Remove failed: ' + e.target.error));
    });
  },

  /**
   * 清理所有索引
   */
  async cleanup() {
    const db = await this._openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE_NAME, 'readwrite');
      const store = tx.objectStore(this.STORE_NAME);
      store.clear();
      tx.oncomplete = () => resolve();
      tx.onerror = (e) => reject(new Error('Cleanup failed: ' + e.target.error));
    });
  }
};

// Export for both browser and Node.js test environments
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SearchIndex };
} else {
  window.ChatGPTSaver = window.ChatGPTSaver || {};
  window.ChatGPTSaver.SearchIndex = SearchIndex;
}
