/**
 * PlatformAdapter 接口骨架。
 *
 * 每个 AI 平台（chatgpt / gemini / ...）实现一份 adapter，把站点 DOM 解析为统一的
 * ConversationModel，由 src/core/exporter.js 统一编排导出。
 *
 * 接口（鸭子类型即可，不强制 class 继承）：
 *
 *   const adapter = {
 *     id: 'chatgpt',                    // 平台 ID
 *     hostMatches(url): boolean,        // 是否当前页
 *     parseConversationModel(): Model,  // 同步：DOM → ConversationModel
 *     getMessageElements(): Element[],  // 单条消息根节点列表（给复制按钮注入用）
 *     getTitle(): string,
 *     isTyping(): boolean,
 *     getConversationId(): string,
 *     // 可选：API 数据源（Phase 2）
 *     listConversationsFromApi?(opts): AsyncIterable<ConvSummary>,
 *     fetchConversationFromApi?(id): Promise<Model>,
 *   };
 */

const PlatformAdapterRegistry = {
  _byId: new Map(),
  _ordered: [],

  register(adapter) {
    if (!adapter || typeof adapter !== 'object') throw new Error('adapter required');
    if (typeof adapter.id !== 'string' || !adapter.id) throw new Error('adapter.id required');
    if (typeof adapter.hostMatches !== 'function') throw new Error('adapter.hostMatches required');
    if (typeof adapter.parseConversationModel !== 'function') {
      throw new Error('adapter.parseConversationModel required');
    }
    this._byId.set(adapter.id, adapter);
    if (!this._ordered.includes(adapter.id)) this._ordered.push(adapter.id);
    return adapter;
  },

  get(id) {
    return this._byId.get(id) || null;
  },

  list() {
    return this._ordered.map((id) => this._byId.get(id)).filter(Boolean);
  },

  /**
   * 找出与当前 URL 匹配的 adapter；按注册顺序优先取第一个匹配。
   */
  resolveForUrl(url) {
    const target = typeof url === 'string' ? url : (typeof location !== 'undefined' ? location.href : '');
    for (const id of this._ordered) {
      const adapter = this._byId.get(id);
      if (!adapter) continue;
      try {
        if (adapter.hostMatches(target)) return adapter;
      } catch (_) {
        // ignore
      }
    }
    return null;
  },

  reset() {
    this._byId.clear();
    this._ordered = [];
  }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { PlatformAdapterRegistry };
} else if (typeof window !== 'undefined') {
  window.ChatGPTSaver = window.ChatGPTSaver || {};
  window.ChatGPTSaver.PlatformAdapterRegistry = PlatformAdapterRegistry;
}
