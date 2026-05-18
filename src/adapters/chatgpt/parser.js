/**
 * ChatGPT 平台 adapter：基于现有 ChatGPTParser 增量识别 4 类高级消息块：
 *   - Canvas（独立 panel + 消息内占位）
 *   - Thought Process（<details> 折叠的推理过程）
 *   - Web Search（搜索结果 + 引用列表）
 *   - Deep Research（带 citation 的长报告）
 *
 * 识别策略：宽松启发式 + 软兜底。任何识别不到的子树都回退为普通 text 块，
 * 保证现有"只导 text"路径完全不破坏。
 *
 * 依赖 window.ChatGPTSaver.ConversationModel 与 window.ChatGPTSaver.Parser。
 */

const ChatGPTBlockExtractor = {
  /**
   * 把一个消息根节点 messageEl 拆成结构化 Block[]。
   *
   * 流程：
   *   1) 先克隆 + 清洗（按钮、复制图标等）
   *   2) 顺序扫描子节点，识别 thought / canvas / web_search / deep_research，
   *      命中时切出对应 Block，剩余继续走 text
   *   3) 剩余主体作为 text block 收尾
   *
   * @param {Element} messageEl
   * @param {{role:string}} ctx
   * @returns {Array<Block>}
   */
  extractBlocks(messageEl, ctx = {}) {
    const Model = (typeof window !== 'undefined' && window.ChatGPTSaver?.ConversationModel) || null;
    if (!Model) return [];
    const role = Model.normalizeRole(ctx.role || messageEl.getAttribute('data-message-author-role') || 'assistant');

    // 找内容容器
    const contentEl = this._resolveContentEl(messageEl, role);
    if (!contentEl) return [];

    const clone = contentEl.cloneNode(true);
    this._cleanup(clone);

    const blocks = [];

    // 1) Thought blocks（消息内通常有 <details> 含 Thinking/Thought/Reasoning summary）
    const thoughtNodes = this._findThoughtNodes(clone);
    thoughtNodes.forEach((node) => {
      const block = this._toThoughtBlock(node, role, Model);
      if (block) blocks.push(block);
      node.remove();
    });

    // 2) Canvas placeholders（消息内可能只有"打开 canvas"占位 + canvasId）
    const canvasNodes = this._findCanvasNodes(clone, messageEl);
    canvasNodes.forEach((entry) => {
      const block = this._toCanvasBlock(entry, role, Model);
      if (block) blocks.push(block);
      if (entry.node && entry.node.remove) entry.node.remove();
    });

    // 3) Web Search blocks（"Searching" 折叠 + sources 列表）
    const webSearchNodes = this._findWebSearchNodes(clone);
    webSearchNodes.forEach((node) => {
      const block = this._toWebSearchBlock(node, role, Model);
      if (block) blocks.push(block);
      node.remove();
    });

    // 4) Deep Research blocks
    const deepResearchNodes = this._findDeepResearchNodes(clone);
    deepResearchNodes.forEach((node) => {
      const block = this._toDeepResearchBlock(node, role, Model);
      if (block) blocks.push(block);
      node.remove();
    });

    // 5) 剩余作为 text block
    const restHtml = clone.innerHTML.trim();
    const restText = clone.textContent.trim();
    if (restText.length >= 2 || restHtml.length > 0) {
      blocks.push(Model.makeTextBlock({ role, html: restHtml, text: restText }));
    }

    return blocks;
  },

  _resolveContentEl(messageEl, role) {
    if (role === 'user') {
      return messageEl.querySelector('.whitespace-pre-wrap') ||
        messageEl.querySelector('[data-message-content]') ||
        messageEl.querySelector('div[class*="text-base"]') ||
        messageEl;
    }
    return messageEl.querySelector('[class*="markdown"]') ||
      messageEl.querySelector('.prose') ||
      messageEl.querySelector('[data-message-content]') ||
      messageEl;
  },

  _cleanup(root) {
    if (!root || !root.querySelectorAll) return;
    root.querySelectorAll('button, [class*="copy"], [class*="sticky"], svg, script, style, noscript')
      .forEach((el) => {
        if (el.closest('[class*="markdown"]') === null || el.tagName === 'BUTTON' || el.tagName === 'SCRIPT' || el.tagName === 'STYLE') {
          el.remove();
        }
      });
    // 给 pre>code 标 language
    root.querySelectorAll('pre').forEach((pre) => {
      const codeEl = pre.querySelector('code');
      if (codeEl) {
        const langClass = Array.from(codeEl.classList || []).find((c) => c.startsWith('language-'));
        if (langClass) pre.setAttribute('data-language', langClass.replace('language-', ''));
      }
    });
  },

  // ---------- Thought ----------
  _findThoughtNodes(root) {
    const hits = new Set();
    // 1. <details> 含 Thinking/Thought/Reasoning
    root.querySelectorAll('details').forEach((det) => {
      const summary = (det.querySelector('summary')?.textContent || '').toLowerCase();
      if (/thought|thinking|reasoning|思考|推理|思维/.test(summary)) {
        hits.add(det);
      }
    });
    // 2. ChatGPT 把推理过程包在 [data-message-content-type="thoughts"]
    root.querySelectorAll('[data-message-content-type="thoughts"]').forEach((el) => hits.add(el));
    // 3. testid 命名
    root.querySelectorAll('[data-testid*="reasoning"], [data-testid*="thought"]').forEach((el) => hits.add(el));
    return Array.from(hits);
  },

  _toThoughtBlock(node, role, Model) {
    let summary = '';
    let detailsHtml = '';
    let detailsText = '';
    let durationMs = 0;

    if (node.tagName === 'DETAILS') {
      const summaryEl = node.querySelector('summary');
      summary = (summaryEl?.textContent || 'Thoughts').trim();
      // 去掉 summary 后剩下的就是 details
      const clone = node.cloneNode(true);
      const cs = clone.querySelector('summary');
      if (cs) cs.remove();
      detailsHtml = clone.innerHTML.trim();
      detailsText = clone.textContent.trim();
    } else {
      summary = (node.getAttribute('data-summary') || 'Thoughts').trim();
      detailsHtml = node.innerHTML.trim();
      detailsText = node.textContent.trim();
    }

    const m = summary.match(/(\d+)\s*(s|秒|sec|seconds)/i);
    if (m) durationMs = parseInt(m[1], 10) * 1000;

    if (!detailsText && !detailsHtml) return null;
    return Model.makeThoughtBlock({ role, summary, detailsHtml, detailsText, durationMs });
  },

  // ---------- Canvas ----------
  _findCanvasNodes(messageContentClone, originalMessageEl) {
    const out = [];
    // 占位：消息体内含 data-canvas-id / data-testid 含 canvas
    messageContentClone.querySelectorAll('[data-canvas-id], [data-testid*="canvas"]').forEach((el) => {
      out.push({ node: el, canvasId: el.getAttribute('data-canvas-id') || '', source: 'placeholder' });
    });
    // 文本启发：消息开头含 "🖼 Canvas" / "Open Canvas" / "Canvas" 链接
    messageContentClone.querySelectorAll('a, button').forEach((el) => {
      const t = (el.textContent || '').trim().toLowerCase();
      if (t === 'open canvas' || t === '打开 canvas' || t === '打开画布') {
        out.push({ node: el.closest('p,div,a,button') || el, canvasId: '', source: 'link' });
      }
    });
    // 真实 canvas 内容在主页面 <aside data-testid="..."> 或 <section data-canvas-id="..."> 里
    // 此处通过 originalMessageEl 的 ownerDocument 在外层找
    const doc = originalMessageEl?.ownerDocument || (typeof document !== 'undefined' ? document : null);
    if (doc) {
      const externalCanvases = doc.querySelectorAll('aside [data-canvas-id], section[data-canvas-id], [role="dialog"] [data-canvas-id]');
      externalCanvases.forEach((c) => {
        const id = c.getAttribute('data-canvas-id') || '';
        const match = out.find((o) => o.canvasId && id && o.canvasId === id);
        if (match) {
          match.externalEl = c;
        } else {
          // 仅在消息体内可见过 canvas 关键字时补一条
          if (messageContentClone.textContent.toLowerCase().includes('canvas')) {
            out.push({ node: null, canvasId: id, externalEl: c, source: 'external' });
          }
        }
      });
    }
    return out;
  },

  _toCanvasBlock(entry, role, Model) {
    let title = '';
    let lang = '';
    let content = '';
    if (entry.externalEl) {
      // 取标题
      const titleEl = entry.externalEl.querySelector('[data-canvas-title], h1, h2, header');
      title = (titleEl?.textContent || '').trim();
      // 取代码 / 文档主体
      const codeEl = entry.externalEl.querySelector('pre code, textarea');
      if (codeEl) {
        content = codeEl.textContent || codeEl.value || '';
        const cls = Array.from(codeEl.classList || []).find((c) => c.startsWith('language-'));
        if (cls) lang = cls.replace('language-', '');
      } else {
        content = entry.externalEl.textContent?.trim() || '';
      }
    } else if (entry.node) {
      title = (entry.node.textContent || '').trim().slice(0, 80);
    }
    if (!title && !content) return null;
    return Model.makeCanvasBlock({
      role,
      canvasId: entry.canvasId || '',
      title: title || 'Canvas',
      lang,
      content
    });
  },

  // ---------- Web Search ----------
  _findWebSearchNodes(root) {
    const hits = new Set();
    root.querySelectorAll('[data-testid*="web_search"], [data-testid*="web-search"]').forEach((el) => hits.add(el));
    // 启发式：含「Searching the web / Searched / 搜索结果 / Sources」的 details
    root.querySelectorAll('details').forEach((det) => {
      const s = (det.querySelector('summary')?.textContent || '').toLowerCase();
      if (/searching|searched|web search|sources?|搜索|搜索结果/.test(s)) {
        hits.add(det);
      }
    });
    // 引用 chip：含 cite 或 source-id
    const sourceListContainers = new Set();
    root.querySelectorAll('[data-source-id], cite a, a[data-citation]').forEach((el) => {
      const list = el.closest('ol, ul, section, div');
      if (list) sourceListContainers.add(list);
    });
    sourceListContainers.forEach((c) => hits.add(c));
    return Array.from(hits);
  },

  _toWebSearchBlock(node, role, Model) {
    const queries = [];
    const sources = [];
    // queries：summary 或 .query
    const summary = node.querySelector('summary');
    if (summary) {
      const txt = (summary.textContent || '').trim();
      const m = txt.match(/[""]([^""]+)[""]|"([^"]+)"|'([^']+)'/g);
      if (m) m.forEach((q) => queries.push(q.replace(/^[""'"]|[""'"]$/g, '')));
    }
    node.querySelectorAll('[data-query], .query, [data-search-query]').forEach((q) => {
      const t = (q.textContent || '').trim();
      if (t) queries.push(t);
    });
    // sources：a 元素 + title + url + snippet
    node.querySelectorAll('a[href]').forEach((a) => {
      const href = a.getAttribute('href') || '';
      if (!/^https?:\/\//i.test(href)) return;
      const title = (a.textContent || '').trim() ||
        a.getAttribute('aria-label') || a.getAttribute('title') || href;
      const parent = a.closest('li, article, section, div');
      const snippet = parent && parent !== a
        ? (parent.querySelector('p, .snippet, [data-snippet]')?.textContent || '').trim()
        : '';
      sources.push({ title, url: href, snippet });
    });
    if (!queries.length && !sources.length) return null;
    return Model.makeWebSearchBlock({ role, queries, sources });
  },

  // ---------- Deep Research ----------
  _findDeepResearchNodes(root) {
    const hits = new Set();
    root.querySelectorAll('[data-testid*="research"], [data-testid*="deep-research"], [data-testid*="reasoning-document"]')
      .forEach((el) => hits.add(el));
    // 含 citation 列表 + 长内容（启发式：> 1000 字 + 多于 5 个 [N] 标注）
    root.querySelectorAll('article, section, div').forEach((el) => {
      const text = el.textContent || '';
      if (text.length < 1500) return;
      const citationMarks = (text.match(/\[(\d{1,3})\]/g) || []).length;
      if (citationMarks >= 5 && el.querySelectorAll('a[href]').length >= 5) {
        hits.add(el);
      }
    });
    return Array.from(hits);
  },

  _toDeepResearchBlock(node, role, Model) {
    const reportHtml = node.outerHTML;
    const reportText = (node.textContent || '').trim();
    const citations = [];
    node.querySelectorAll('a[href]').forEach((a) => {
      const url = a.getAttribute('href') || '';
      if (!/^https?:\/\//i.test(url)) return;
      const title = (a.textContent || '').trim() || url;
      citations.push({ title, url });
    });
    if (!reportText) return null;
    return Model.makeDeepResearchBlock({ role, reportHtml, reportText, citations });
  }
};

/**
 * ChatGPT adapter 入口：从 DOM 取整个 ConversationModel。
 */
function parseConversationModel() {
  const Parser = window.ChatGPTSaver?.Parser;
  const Model = window.ChatGPTSaver?.ConversationModel;
  if (!Parser || !Model) return null;

  const title = Parser.getConversationTitle();
  const isWorkspace = Parser.isWorkspacePage();
  const workspaceName = Parser.getWorkspaceName();
  const messageElements = Parser.getMessageElements();

  const messages = messageElements
    .map((el) => {
      const role = Model.normalizeRole(el.getAttribute('data-message-author-role') || 'assistant');
      const blocks = ChatGPTBlockExtractor.extractBlocks(el, { role });
      return blocks.length ? { role, blocks } : null;
    })
    .filter(Boolean);

  const winRef = (typeof window !== 'undefined') ? window : null;
  return Model.normalizeConversation({
    platform: Model.PLATFORM.CHATGPT,
    id: extractConversationIdFromUrl(),
    title,
    url: winRef && winRef.location ? winRef.location.href : '',
    isWorkspace,
    workspaceName,
    timestamp: new Date().toISOString(),
    messages
  }, { platform: Model.PLATFORM.CHATGPT });
}

function extractConversationIdFromUrl() {
  try {
    const win = (typeof window !== 'undefined') ? window : null;
    const pathname = win && win.location ? win.location.pathname : '';
    const m = String(pathname || '').match(/\/c\/([a-zA-Z0-9-]+)/);
    return m ? m[1] : '';
  } catch (_) {
    return '';
  }
}

const ChatGPTAdapter = {
  id: 'chatgpt',
  hostMatches(url) {
    return /https?:\/\/(chat\.openai\.com|chatgpt\.com)\//i.test(url || '');
  },
  parseConversationModel,
  getMessageElements() {
    return window.ChatGPTSaver?.Parser?.getMessageElements?.() || [];
  },
  getTitle() {
    return window.ChatGPTSaver?.Parser?.getConversationTitle?.() || '';
  },
  isTyping() {
    return !!window.ChatGPTSaver?.Parser?.isGPTTyping?.();
  },
  getConversationId() {
    return extractConversationIdFromUrl();
  }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ChatGPTAdapter, ChatGPTBlockExtractor };
} else if (typeof window !== 'undefined') {
  window.ChatGPTSaver = window.ChatGPTSaver || {};
  window.ChatGPTSaver.ChatGPTAdapter = ChatGPTAdapter;
  window.ChatGPTSaver.ChatGPTBlockExtractor = ChatGPTBlockExtractor;
  const registry = window.ChatGPTSaver.PlatformAdapterRegistry;
  if (registry && typeof registry.register === 'function' && !registry.get('chatgpt')) {
    try { registry.register(ChatGPTAdapter); } catch (_) { /* ignore */ }
  }
}
