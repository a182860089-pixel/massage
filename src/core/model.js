/**
 * ConversationModel + Block 联合类型
 *
 * 设计目标：让 HTML / Markdown / PDF / JSON renderer 都可以从一份"规范模型"渲染，
 * 摆脱对 window.ChatGPTSaver.Parser（ChatGPT 专属）的硬依赖；新增 Gemini adapter
 * 时只需要把 Gemini DOM 解析为同样的 Block[]，原 4 个 renderer 即可零改动复用。
 *
 * 向后兼容：
 *   - 旧 Message 形状 { role, content(HTML), textContent, element } 视为 "legacy"
 *     条目，工厂函数 normalizeMessages() 会把它们升级成 Block 序列。
 *   - 老代码路径仍可只读取 content/textContent，未来增量替换为读 blocks。
 */

const ROLE = Object.freeze({
  USER: 'user',
  ASSISTANT: 'assistant',
  SYSTEM: 'system',
  TOOL: 'tool'
});

const BLOCK_TYPE = Object.freeze({
  TEXT: 'text',
  CODE: 'code',
  IMAGE: 'image',
  ATTACHMENT: 'attachment',
  CANVAS: 'canvas',
  THOUGHT: 'thought',
  WEB_SEARCH: 'web_search',
  DEEP_RESEARCH: 'deep_research'
});

const PLATFORM = Object.freeze({
  CHATGPT: 'chatgpt',
  GEMINI: 'gemini'
});

/**
 * Block 工厂：所有 Block 至少含 type、role、source（原始 HTML / 文本，便于渲染兜底）。
 */
function makeTextBlock({ role, html = '', text = '' }) {
  return { type: BLOCK_TYPE.TEXT, role, html, text };
}

function makeCodeBlock({ role, lang = '', code = '', renderedHtml = '' }) {
  return { type: BLOCK_TYPE.CODE, role, lang, code, renderedHtml };
}

function makeImageBlock({ role, url, alt = '', localPath = '' }) {
  return { type: BLOCK_TYPE.IMAGE, role, url, alt, localPath };
}

function makeAttachmentBlock({ role, filename, mime = '', size = 0, localPath = '', url = '' }) {
  return { type: BLOCK_TYPE.ATTACHMENT, role, filename, mime, size, localPath, url };
}

function makeCanvasBlock({ role, canvasId = '', title = '', lang = '', content = '', versions = [] }) {
  return { type: BLOCK_TYPE.CANVAS, role, canvasId, title, lang, content, versions };
}

function makeThoughtBlock({ role, summary = '', detailsHtml = '', detailsText = '', durationMs = 0 }) {
  return {
    type: BLOCK_TYPE.THOUGHT,
    role,
    summary,
    detailsHtml,
    detailsText,
    durationMs
  };
}

function makeWebSearchBlock({ role, queries = [], sources = [] }) {
  return { type: BLOCK_TYPE.WEB_SEARCH, role, queries, sources };
}

function makeDeepResearchBlock({ role, reportHtml = '', reportText = '', citations = [] }) {
  return {
    type: BLOCK_TYPE.DEEP_RESEARCH,
    role,
    reportHtml,
    reportText,
    citations
  };
}

/**
 * 把 legacy message（{role, content, textContent}）升级成 [{type:'text', ...}]。
 * 注意：legacy.content 可能是 HTML 串，也可能是纯文本。
 */
function legacyMessageToBlocks(message) {
  if (!message || typeof message !== 'object') return [];
  const role = normalizeRole(message.role);
  const html = typeof message.content === 'string' ? message.content : '';
  const text = typeof message.textContent === 'string' ? message.textContent : '';
  if (!html && !text) return [];
  return [makeTextBlock({ role, html, text })];
}

function normalizeRole(role) {
  const s = String(role || '').toLowerCase();
  if (s === 'user') return ROLE.USER;
  if (s === 'assistant') return ROLE.ASSISTANT;
  if (s === 'tool') return ROLE.TOOL;
  return ROLE.SYSTEM;
}

/**
 * 任何上游对话对象 → 规范 ConversationModel。
 * 接受 3 种入参：
 *   1) 旧 parseConversation() 结果：{ title, messages: [{role,content,textContent,...}], ... }
 *   2) 新 adapter 直接产出的：{ title, messages: [{role, blocks: [...]}], ... }
 *   3) 混合：messages 里部分 legacy 部分新格式（会逐条 normalize）
 */
function normalizeConversation(input, { platform = PLATFORM.CHATGPT } = {}) {
  const src = input && typeof input === 'object' ? input : {};
  const messages = Array.isArray(src.messages) ? src.messages : [];
  const normalizedMessages = messages
    .map((msg) => normalizeMessage(msg))
    .filter((msg) => msg && msg.blocks.length > 0);

  return {
    platform,
    id: src.id || '',
    title: typeof src.title === 'string' ? src.title : '',
    url: typeof src.url === 'string' ? src.url : '',
    workspaceName: typeof src.workspaceName === 'string' ? src.workspaceName : '',
    isWorkspace: !!src.isWorkspace,
    timestamp: typeof src.timestamp === 'string' ? src.timestamp : new Date().toISOString(),
    messages: normalizedMessages
  };
}

function normalizeMessage(message) {
  if (!message || typeof message !== 'object') return null;
  const role = normalizeRole(message.role);
  const id = typeof message.id === 'string' ? message.id : '';

  // 新格式：含 blocks 数组
  if (Array.isArray(message.blocks)) {
    const blocks = message.blocks
      .map((b) => normalizeBlock(b, role))
      .filter((b) => !!b);
    return blocks.length ? { role, id, blocks } : null;
  }

  // 旧格式：升级成 text 块
  const blocks = legacyMessageToBlocks(message);
  return blocks.length ? { role, id, blocks } : null;
}

function normalizeBlock(block, fallbackRole = ROLE.ASSISTANT) {
  if (!block || typeof block !== 'object' || !block.type) return null;
  const role = block.role ? normalizeRole(block.role) : fallbackRole;
  switch (block.type) {
    case BLOCK_TYPE.TEXT:
      return makeTextBlock({ role, html: block.html || '', text: block.text || '' });
    case BLOCK_TYPE.CODE:
      return makeCodeBlock({
        role,
        lang: block.lang || '',
        code: block.code || '',
        renderedHtml: block.renderedHtml || ''
      });
    case BLOCK_TYPE.IMAGE:
      return makeImageBlock({
        role,
        url: block.url || '',
        alt: block.alt || '',
        localPath: block.localPath || ''
      });
    case BLOCK_TYPE.ATTACHMENT:
      return makeAttachmentBlock({
        role,
        filename: block.filename || '',
        mime: block.mime || '',
        size: block.size || 0,
        localPath: block.localPath || '',
        url: block.url || ''
      });
    case BLOCK_TYPE.CANVAS:
      return makeCanvasBlock({
        role,
        canvasId: block.canvasId || '',
        title: block.title || '',
        lang: block.lang || '',
        content: block.content || '',
        versions: Array.isArray(block.versions) ? block.versions : []
      });
    case BLOCK_TYPE.THOUGHT:
      return makeThoughtBlock({
        role,
        summary: block.summary || '',
        detailsHtml: block.detailsHtml || '',
        detailsText: block.detailsText || '',
        durationMs: block.durationMs || 0
      });
    case BLOCK_TYPE.WEB_SEARCH:
      return makeWebSearchBlock({
        role,
        queries: Array.isArray(block.queries) ? block.queries.map(String) : [],
        sources: Array.isArray(block.sources) ? block.sources : []
      });
    case BLOCK_TYPE.DEEP_RESEARCH:
      return makeDeepResearchBlock({
        role,
        reportHtml: block.reportHtml || '',
        reportText: block.reportText || '',
        citations: Array.isArray(block.citations) ? block.citations : []
      });
    default:
      return null;
  }
}

/**
 * 提取消息的"纯文本"——给 PDF / MD 渲染当兜底。
 * - text 块：用 text 或 html.textContent
 * - code 块：返回 ```lang\ncode\n```
 * - thought：默认返回 summary（详情可控）
 * - canvas：返回 "[Canvas: title]" + content
 * - web_search：列 queries + sources
 * - deep_research：reportText
 */
function blockToPlainText(block, options = {}) {
  if (!block) return '';
  const { includeThoughtDetails = false, includeCanvasContent = true } = options;
  switch (block.type) {
    case BLOCK_TYPE.TEXT:
      return block.text || stripHtml(block.html);
    case BLOCK_TYPE.CODE: {
      const fence = '```' + (block.lang || '');
      return `${fence}\n${block.code || ''}\n\`\`\``;
    }
    case BLOCK_TYPE.IMAGE:
      return `![${block.alt || 'image'}](${block.localPath || block.url || ''})`;
    case BLOCK_TYPE.ATTACHMENT:
      return `[attachment: ${block.filename}]`;
    case BLOCK_TYPE.CANVAS: {
      const head = `[Canvas${block.title ? ': ' + block.title : ''}]`;
      if (!includeCanvasContent) return head;
      const fence = '```' + (block.lang || '');
      return `${head}\n${fence}\n${block.content || ''}\n\`\`\``;
    }
    case BLOCK_TYPE.THOUGHT: {
      const head = `[Thinking] ${block.summary || ''}`;
      if (!includeThoughtDetails) return head;
      return `${head}\n${block.detailsText || stripHtml(block.detailsHtml)}`;
    }
    case BLOCK_TYPE.WEB_SEARCH: {
      const q = block.queries.length ? `[Web Search] ${block.queries.join(' / ')}` : '[Web Search]';
      const lines = block.sources.map((s, i) => `  ${i + 1}. ${s.title || ''} ${s.url || ''}`);
      return [q, ...lines].join('\n');
    }
    case BLOCK_TYPE.DEEP_RESEARCH:
      return `[Deep Research]\n${block.reportText || stripHtml(block.reportHtml)}`;
    default:
      return '';
  }
}

function stripHtml(html) {
  if (!html || typeof html !== 'string') return '';
  if (typeof DOMParser !== 'undefined') {
    try {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      return doc.body ? doc.body.textContent || '' : '';
    } catch (_) {
      // fall through
    }
  }
  return html.replace(/<[^>]+>/g, '');
}

/**
 * 把规范 ConversationModel 还原成 "legacy parser" 形状的对象——
 * 用来给尚未迁移的 renderer（HTMLExporter.exportWithFullStyles 等）当输入。
 */
function modelToLegacyConversation(model) {
  if (!model) return null;
  const messages = (model.messages || []).map((m) => {
    const plainParts = m.blocks.map((b) => blockToPlainText(b, { includeThoughtDetails: true }));
    const htmlParts = m.blocks.map((b) => blockToLegacyHtml(b));
    return {
      role: m.role,
      content: htmlParts.join('\n'),
      textContent: plainParts.join('\n').trim(),
      blocks: m.blocks
    };
  });
  return {
    title: model.title,
    url: model.url,
    isWorkspace: model.isWorkspace,
    workspaceName: model.workspaceName,
    timestamp: model.timestamp,
    messages
  };
}

function blockToLegacyHtml(block) {
  if (!block) return '';
  switch (block.type) {
    case BLOCK_TYPE.TEXT:
      return block.html || escapeHtml(block.text).replace(/\n/g, '<br>');
    case BLOCK_TYPE.CODE:
      return block.renderedHtml ||
        `<pre><code class="language-${escapeHtml(block.lang)}">${escapeHtml(block.code)}</code></pre>`;
    case BLOCK_TYPE.IMAGE:
      return `<p><img src="${escapeHtml(block.localPath || block.url)}" alt="${escapeHtml(block.alt)}"></p>`;
    case BLOCK_TYPE.ATTACHMENT:
      return `<p class="attachment">📎 ${escapeHtml(block.filename)}</p>`;
    case BLOCK_TYPE.CANVAS: {
      const inner = block.content
        ? `<pre><code class="language-${escapeHtml(block.lang)}">${escapeHtml(block.content)}</code></pre>`
        : '';
      return `<aside class="canvas-block" data-canvas-id="${escapeHtml(block.canvasId)}"><h4>Canvas${block.title ? '：' + escapeHtml(block.title) : ''}</h4>${inner}</aside>`;
    }
    case BLOCK_TYPE.THOUGHT: {
      const summary = escapeHtml(block.summary || 'Thoughts');
      const details = block.detailsHtml || escapeHtml(block.detailsText).replace(/\n/g, '<br>');
      return `<details class="thought-block"><summary>💭 ${summary}</summary>${details}</details>`;
    }
    case BLOCK_TYPE.WEB_SEARCH: {
      const queries = block.queries.length
        ? `<p class="search-queries">🔍 ${block.queries.map(escapeHtml).join(' · ')}</p>`
        : '';
      const items = block.sources.map((s) => {
        const title = escapeHtml(s.title || s.url || '');
        const url = escapeHtml(s.url || '');
        const snippet = s.snippet ? `<div class="snippet">${escapeHtml(s.snippet)}</div>` : '';
        return `<li><a href="${url}" target="_blank" rel="noopener">${title}</a>${snippet}</li>`;
      }).join('');
      return `<section class="web-search-block">${queries}<ol class="search-sources">${items}</ol></section>`;
    }
    case BLOCK_TYPE.DEEP_RESEARCH: {
      const body = block.reportHtml || (block.reportText
        ? `<p>${escapeHtml(block.reportText).replace(/\n/g, '<br>')}</p>`
        : '');
      const cites = block.citations.length
        ? `<ol class="dr-citations">${block.citations.map((c) => {
          const title = escapeHtml(c.title || c.url || '');
          const url = escapeHtml(c.url || '');
          return `<li><a href="${url}" target="_blank" rel="noopener">${title}</a></li>`;
        }).join('')}</ol>`
        : '';
      return `<section class="deep-research-block"><h4>Deep Research</h4>${body}${cites}</section>`;
    }
    default:
      return '';
  }
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const ConversationModel = {
  ROLE,
  BLOCK_TYPE,
  PLATFORM,
  makeTextBlock,
  makeCodeBlock,
  makeImageBlock,
  makeAttachmentBlock,
  makeCanvasBlock,
  makeThoughtBlock,
  makeWebSearchBlock,
  makeDeepResearchBlock,
  normalizeRole,
  normalizeBlock,
  normalizeMessage,
  normalizeConversation,
  legacyMessageToBlocks,
  modelToLegacyConversation,
  blockToPlainText,
  blockToLegacyHtml
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ConversationModel };
} else if (typeof window !== 'undefined') {
  window.ChatGPTSaver = window.ChatGPTSaver || {};
  window.ChatGPTSaver.ConversationModel = ConversationModel;
}
