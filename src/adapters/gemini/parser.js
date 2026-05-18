/**
 * Gemini 平台 adapter：识别 Gemini Web (gemini.google.com) 的对话 DOM。
 *
 * 主要 selector（社区反推 + AI Studio 版本通用）：
 *   - 容器：     ms-chat-turn / .conversation-turn
 *   - 用户 / 助手：ms-chat-turn[author="user"] / [author="model"]，
 *                  或子节点 [data-test-id="user-prompt-container"] 等
 *   - 思维链：    ms-thought-chunk
 *   - 富文本主体： .markdown / [data-test-id="markdown"] / .turn-content
 *   - 编辑原值：  ms-autosize-textarea[data-value]
 *
 * 对 Shadow DOM 做了穿透兜底（部分 ms-* 元素是 Web Component）。
 */

const GeminiBlockExtractor = {
  extractBlocks(turnEl, ctx = {}) {
    const Model = (typeof window !== 'undefined' && window.ChatGPTSaver?.ConversationModel) || null;
    if (!Model) return [];
    const role = Model.normalizeRole(ctx.role || this._inferRole(turnEl));
    const blocks = [];

    // 1) Thoughts
    const thoughtChunks = this._queryDeep(turnEl, 'ms-thought-chunk');
    thoughtChunks.forEach((tc) => {
      const summary = (this._queryDeep(tc, '[role="heading"], h3, .thought-title')[0]?.textContent || 'Thoughts').trim();
      const body = tc.cloneNode(true);
      this._queryDeep(body, '[role="heading"], h3, .thought-title').forEach((n) => n.remove());
      const detailsHtml = body.innerHTML.trim();
      const detailsText = body.textContent.trim();
      if (detailsText) {
        blocks.push(Model.makeThoughtBlock({ role, summary, detailsHtml, detailsText }));
      }
      try { tc.remove(); } catch (_) { /* ignore */ }
    });

    // 2) 主体内容（markdown），text 为空时优先用 ms-autosize-textarea[data-value] 兜底
    const bodyEl = this._resolveBodyEl(turnEl, role);
    const html = bodyEl ? bodyEl.innerHTML.trim() : '';
    const text = bodyEl ? bodyEl.textContent.trim() : '';
    if (text.length >= 2) {
      blocks.push(Model.makeTextBlock({ role, html, text }));
    } else {
      const ta = this._queryDeep(turnEl, 'ms-autosize-textarea')[0];
      const raw = (ta?.getAttribute?.('data-value') || ta?.textContent || '').trim();
      if (raw) {
        blocks.push(Model.makeTextBlock({ role, html: '', text: raw }));
      } else if (html.length > 0) {
        blocks.push(Model.makeTextBlock({ role, html, text }));
      }
    }

    return blocks;
  },

  _inferRole(turnEl) {
    const a = (turnEl.getAttribute?.('author') || turnEl.getAttribute?.('data-author') || '').toLowerCase();
    if (a === 'user') return 'user';
    if (a === 'model' || a === 'assistant') return 'assistant';
    if (turnEl.querySelector?.('[data-test-id="user-prompt-container"]')) return 'user';
    if (turnEl.querySelector?.('[data-test-id="model-response-text"]')) return 'assistant';
    return 'assistant';
  },

  _resolveBodyEl(turnEl, role) {
    const candidates = [
      '[data-test-id="model-response-text"]',
      '[data-test-id="user-prompt-text"]',
      '[data-test-id="markdown"]',
      '.markdown',
      '.turn-content',
      '.response-content',
      '.message-content'
    ];
    for (const sel of candidates) {
      const el = this._queryDeep(turnEl, sel)[0];
      if (el) return el;
    }
    return turnEl;
  },

  /**
   * 深度查询，穿透 shadow root。
   */
  _queryDeep(root, selector) {
    if (!root || !root.querySelectorAll) return [];
    const results = Array.from(root.querySelectorAll(selector) || []);
    // 找所有 shadow root
    const walker = (typeof document !== 'undefined' && document.createTreeWalker)
      ? document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT)
      : null;
    if (!walker) return results;
    let node;
    while ((node = walker.nextNode())) {
      if (node.shadowRoot) {
        try {
          const sub = node.shadowRoot.querySelectorAll(selector);
          if (sub && sub.length) results.push(...sub);
        } catch (_) { /* ignore */ }
      }
    }
    return results;
  }
};

const GeminiParser = {
  getConversationTitle() {
    const pageTitle = (typeof document !== 'undefined' ? document.title : '') || '';
    if (pageTitle && !pageTitle.toLowerCase().startsWith('gemini')) {
      const t = pageTitle.replace(/\s*[-|]\s*Gemini.*$/i, '').trim();
      if (t) return t;
    }
    // 侧边栏选中项
    const sidebar = document?.querySelector?.('[data-test-id="conversation-list"] .selected, [class*="selected"][class*="conversation"]');
    if (sidebar) {
      const t = sidebar.textContent?.trim();
      if (t && t.length <= 80) return t;
    }
    return `Gemini对话_${new Date().toLocaleDateString('zh-CN')}`;
  },

  getMessageElements() {
    if (typeof document === 'undefined') return [];
    const turns = Array.from(document.querySelectorAll('ms-chat-turn'));
    if (turns.length) return turns;
    // 兜底：[data-test-id="conversation-turn"]
    return Array.from(document.querySelectorAll('[data-test-id*="conversation-turn"]'));
  },

  getWorkspaceName() { return ''; },

  isTyping() {
    if (typeof document === 'undefined') return false;
    // Gemini 输入中常含 .response-pending / .stop-generating / [data-loading="true"]
    return !!document.querySelector(
      '[data-loading="true"], .response-pending, .stop-generating, [aria-label*="Stop"]'
    );
  }
};

function parseConversationModel() {
  const Model = window.ChatGPTSaver?.ConversationModel;
  if (!Model) return null;
  const title = GeminiParser.getConversationTitle();
  const turns = GeminiParser.getMessageElements();
  const messages = turns
    .map((el) => {
      const role = Model.normalizeRole(GeminiBlockExtractor._inferRole(el));
      const blocks = GeminiBlockExtractor.extractBlocks(el, { role });
      return blocks.length ? { role, blocks } : null;
    })
    .filter(Boolean);
  const winRef = typeof window !== 'undefined' ? window : null;
  return Model.normalizeConversation({
    platform: Model.PLATFORM.GEMINI,
    id: extractGeminiConversationId(),
    title,
    url: winRef && winRef.location ? winRef.location.href : '',
    timestamp: new Date().toISOString(),
    messages
  }, { platform: Model.PLATFORM.GEMINI });
}

function extractGeminiConversationId() {
  try {
    const win = (typeof window !== 'undefined') ? window : null;
    if (!win || !win.location) return '';
    const m = String(win.location.pathname || '').match(/\/app\/([a-zA-Z0-9_-]+)/);
    return m ? m[1] : '';
  } catch (_) {
    return '';
  }
}

const GeminiAdapter = {
  id: 'gemini',
  hostMatches(url) {
    return /https?:\/\/(gemini\.google\.com)\//i.test(url || '');
  },
  parseConversationModel,
  getMessageElements() { return GeminiParser.getMessageElements(); },
  getTitle() { return GeminiParser.getConversationTitle(); },
  isTyping() { return GeminiParser.isTyping(); },
  getConversationId() { return extractGeminiConversationId(); }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { GeminiAdapter, GeminiParser, GeminiBlockExtractor };
} else if (typeof window !== 'undefined') {
  window.ChatGPTSaver = window.ChatGPTSaver || {};
  window.ChatGPTSaver.GeminiAdapter = GeminiAdapter;
  window.ChatGPTSaver.GeminiParser = GeminiParser;
  window.ChatGPTSaver.GeminiBlockExtractor = GeminiBlockExtractor;
  const registry = window.ChatGPTSaver.PlatformAdapterRegistry;
  if (registry && typeof registry.register === 'function' && !registry.get('gemini')) {
    try { registry.register(GeminiAdapter); } catch (_) { /* ignore */ }
  }
}
