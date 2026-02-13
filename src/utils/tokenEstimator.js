/**
 * Token 估算器 - 本地估算 token 消耗，按工作空间追踪预算
 */

const TokenEstimator = {
  /**
   * 估算文本的 token 数量
   * 英文按词（×1.3），中文按字符（×1.5），向上取整
   * @param {string} text
   * @returns {number}
   */
  estimateTokens(text) {
    if (!text || text.length === 0) return 0;

    let englishTokens = 0;
    let chineseTokens = 0;

    // 匹配中文字符（CJK统一汉字）
    const chineseChars = text.match(/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/g);
    if (chineseChars) {
      chineseTokens = chineseChars.length * 1.5;
    }

    // 移除中文字符后，按空白分词计算英文 token
    const nonChinese = text.replace(/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/g, ' ');
    const words = nonChinese.split(/\s+/).filter(w => w.length > 0);
    if (words.length > 0) {
      englishTokens = words.length * 1.3;
    }

    return Math.ceil(englishTokens + chineseTokens);
  },

  /**
   * 获取工作空间的 token 统计
   * @param {string} workspaceName
   * @returns {Promise<{consumed: number, conversations: Object, lastUpdated: string}>}
   */
  async getWorkspaceStats(workspaceName) {
    const allData = await this._loadData();
    const ws = allData[workspaceName];
    if (!ws) {
      return { consumed: 0, conversations: {}, lastUpdated: '' };
    }
    return ws;
  },

  /**
   * 记录某个对话在某个工作空间的 token 使用
   * @param {string} workspaceName
   * @param {string} conversationTitle
   * @param {number} tokens
   */
  async recordUsage(workspaceName, conversationTitle, tokens) {
    const allData = await this._loadData();
    if (!allData[workspaceName]) {
      allData[workspaceName] = { consumed: 0, conversations: {}, lastUpdated: '' };
    }

    const ws = allData[workspaceName];
    const prev = ws.conversations[conversationTitle]?.tokens || 0;
    const diff = tokens - prev;

    ws.conversations[conversationTitle] = {
      tokens,
      lastUpdated: new Date().toISOString()
    };

    // 累加差值（如果对话更新了，只加增量）
    ws.consumed = Math.max(0, (ws.consumed || 0) + diff);
    ws.lastUpdated = new Date().toISOString();

    await this._saveData(allData);
  },

  /**
   * 序列化工作空间数据
   * @param {Object} data
   * @returns {string}
   */
  serialize(data) {
    return JSON.stringify(data);
  },

  /**
   * 反序列化工作空间数据
   * @param {string} jsonString
   * @returns {Object}
   */
  deserialize(jsonString) {
    return JSON.parse(jsonString);
  },

  /**
   * 从 storage 加载数据
   * @returns {Promise<Object>}
   */
  async _loadData() {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        const result = await chrome.storage.local.get(['workspaceTokens']);
        return result.workspaceTokens || {};
      }
      // GM_getValue fallback
      if (typeof GM_getValue === 'function') {
        const raw = GM_getValue('workspaceTokens', '{}');
        return typeof raw === 'string' ? JSON.parse(raw) : (raw || {});
      }
    } catch (e) {
      console.error('[TokenEstimator] 加载数据失败:', e);
    }
    return {};
  },

  /**
   * 保存数据到 storage
   * @param {Object} data
   */
  async _saveData(data) {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        await chrome.storage.local.set({ workspaceTokens: data });
        return;
      }
      if (typeof GM_setValue === 'function') {
        GM_setValue('workspaceTokens', JSON.stringify(data));
        return;
      }
    } catch (e) {
      console.error('[TokenEstimator] 保存数据失败:', e);
    }
  }
};

// 浏览器环境
if (typeof window !== 'undefined') {
  window.ChatGPTSaver = window.ChatGPTSaver || {};
  window.ChatGPTSaver.TokenEstimator = TokenEstimator;
}

// Node.js 测试环境
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { TokenEstimator };
}
