/**
 * HTML exporter with GPT-like conversation layout.
 */

const HTMLExporter = {
  export() {
    return window.ChatGPTSaver.Parser.getConversationHTML();
  },

  exportWithFullStyles() {
    const conversation = window.ChatGPTSaver.Parser.parseConversation();
    return this.exportConversation(conversation);
  },

  exportFromMessages(messages, title = '') {
    const parser = window.ChatGPTSaver?.Parser;
    const conversation = {
      title: String(title || parser?.getConversationTitle?.() || '对话节选').trim(),
      isWorkspace: !!parser?.isWorkspacePage?.(),
      url: typeof window !== 'undefined' ? window.location.href : '',
      messages: Array.isArray(messages) ? messages : []
    };
    return this.exportConversation(conversation);
  },

  exportConversation(conversation) {
    const source = conversation && typeof conversation === 'object' ? conversation : {};
    const messages = Array.isArray(source.messages) ? source.messages : [];
    if (!messages.length) return null;

    const title = String(source.title || 'ChatGPT 对话').trim() || 'ChatGPT 对话';
    const safeTitle = this.escapeHtml(title);
    const exportTime = new Date().toLocaleString('zh-CN');
    const rawSourceUrl = String(source.url || (typeof window !== 'undefined' ? window.location.href : '')).trim();
    const sourceUrl = this.escapeHtml(rawSourceUrl);
    const workspaceTag = source.isWorkspace ? '<span class="chat-meta-item workspace">Workspace</span>' : '';

    const turnsHtml = messages.map((msg, index) => {
      const normalizedRole = this.normalizeRole(msg?.role);
      const bodyHtml = this.sanitizeMessageHtml(msg?.content || '');
      const plainText = this.escapeHtml(String(msg?.textContent || '')).replace(/\n/g, '<br>');
      const contentHtml = bodyHtml || `<p>${plainText}</p>`;

      return `
        <article class="chat-turn ${normalizedRole}" data-role="${normalizedRole}" data-index="${index + 1}">
          <div class="turn-body markdown-content" data-copy-source="message">
            ${contentHtml}
          </div>
        </article>
      `;
    }).join('\n');

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${safeTitle} - ChatGPT 对话导出</title>
  <style>
    :root {
      --bg: #ffffff;
      --surface: #ffffff;
      --surface-soft: #f7f7f8;
      --text: #111827;
      --muted: #6b7280;
      --line: #e5e7eb;
      --quote: #f5f5f5;
      --user-bg: #efe7fb;
      --user-border: #e4d8fb;
      --user-text: #3f2f66;
      --code-bg: #f6f6f7;
      --code-line: #e7e7ea;
      --code-text: #111827;
      --btn-bg: #f9fafb;
      --btn-hover: #f3f4f6;
      --ok: #065f46;
      --error: #b91c1c;
    }

    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: var(--bg); }
    body {
      font-family: "Soehne", "PingFang SC", "Noto Sans SC", "Microsoft YaHei", "Segoe UI", sans-serif;
      color: var(--text);
      line-height: 1.75;
      padding: 14px 12px 40px;
    }

    .chat-shell {
      max-width: 900px;
      margin: 0 auto;
      background: var(--surface);
    }

    .chat-toolbar {
      position: sticky;
      top: 10px;
      z-index: 20;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 10px 12px;
      padding: 10px 12px;
      border: 1px solid var(--line);
      border-radius: 12px;
      background: rgba(255, 255, 255, 0.95);
      backdrop-filter: blur(6px);
      margin-bottom: 18px;
    }

    .chat-title {
      margin: 0;
      font-size: 14px;
      line-height: 1.45;
      font-weight: 600;
      color: #374151;
    }

    .chat-meta {
      margin-top: 4px;
      font-size: 12px;
      color: var(--muted);
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      align-items: center;
    }

    .chat-meta-item {
      display: inline-flex;
      align-items: center;
      padding: 0 8px;
      height: 20px;
      border-radius: 999px;
      border: 1px solid var(--line);
      background: #fff;
      color: #4b5563;
    }
    .chat-meta-item.workspace {
      border-color: #d1fae5;
      background: #ecfdf5;
      color: #047857;
      font-weight: 600;
    }

    .toolbar-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .toolbar-btn {
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 6px 12px;
      background: var(--btn-bg);
      color: #111827;
      font-size: 12px;
      cursor: pointer;
      transition: background 120ms ease, border-color 120ms ease;
    }
    .toolbar-btn:hover {
      background: var(--btn-hover);
      border-color: #d1d5db;
    }

    .chat-thread {
      max-width: 760px;
      margin: 0 auto;
    }

    .chat-turn {
      margin: 22px 0;
    }

    .chat-turn.user {
      display: flex;
      justify-content: flex-end;
      margin: 6px 0 26px;
    }

    .turn-body {
      min-width: 0;
      font-size: 15px;
      color: #111827;
      user-select: text;
    }

    .chat-turn.user .turn-body {
      max-width: min(78%, 560px);
      background: var(--user-bg);
      border: 1px solid var(--user-border);
      color: var(--user-text);
      border-radius: 18px;
      padding: 10px 16px;
      line-height: 1.55;
    }

    .chat-turn.assistant .turn-body {
      max-width: 100%;
      background: transparent;
      color: #111827;
      padding: 0;
    }

    .chat-turn.system .turn-body {
      border-left: 3px solid #fda4af;
      padding-left: 10px;
      color: #7f1d1d;
      background: #fff1f2;
      border-radius: 0 8px 8px 0;
    }

    .turn-body > :first-child { margin-top: 0; }
    .turn-body > :last-child { margin-bottom: 0; }

    .markdown-content p { margin: 0 0 14px; }
    .markdown-content h1,
    .markdown-content h2,
    .markdown-content h3,
    .markdown-content h4 {
      margin: 20px 0 10px;
      line-height: 1.35;
      color: #0f172a;
      font-weight: 700;
    }
    .markdown-content h1 { font-size: 22px; }
    .markdown-content h2 { font-size: 20px; }
    .markdown-content h3 { font-size: 18px; }
    .markdown-content h4 { font-size: 16px; }

    .markdown-content ul,
    .markdown-content ol {
      margin: 8px 0 12px 22px;
      padding: 0;
    }
    .markdown-content li { margin: 4px 0; }

    .markdown-content blockquote {
      margin: 14px 0;
      padding: 10px 12px;
      border-left: 4px solid #d1d5db;
      background: var(--quote);
      border-radius: 0 8px 8px 0;
      color: #374151;
    }

    .markdown-content pre {
      margin: 0;
      border: none;
      background: transparent;
      padding: 0;
      overflow: auto;
      white-space: pre;
    }

    .markdown-content code {
      font-family: "SFMono-Regular", Menlo, Consolas, "Liberation Mono", monospace;
      font-size: 0.93em;
      word-break: break-word;
    }
    .markdown-content :not(pre) > code {
      background: #f3f4f6;
      border: 1px solid #e5e7eb;
      border-radius: 6px;
      padding: 1px 6px;
      color: #111827;
    }

    .code-shell {
      margin: 14px 0;
      border: 1px solid var(--code-line);
      border-radius: 16px;
      background: var(--code-bg);
      overflow: hidden;
    }
    .code-head {
      height: 42px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 12px 0 14px;
      border-bottom: 1px solid var(--code-line);
      background: #f2f2f4;
    }
    .code-lang {
      font-size: 13px;
      color: #374151;
    }
    .code-copy-btn {
      border: 1px solid #d1d5db;
      background: #fff;
      border-radius: 999px;
      min-width: 56px;
      height: 28px;
      padding: 0 10px;
      font-size: 12px;
      color: #111827;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 5px;
    }
    .code-copy-btn::before {
      content: "⧉";
      font-size: 11px;
      line-height: 1;
      color: #4b5563;
    }
    .code-copy-btn:hover {
      background: #f9fafb;
      border-color: #9ca3af;
    }
    .code-body {
      display: block;
      margin: 0;
      padding: 12px 14px 14px;
      color: var(--code-text);
      font-size: 13px;
      line-height: 1.6;
      white-space: pre;
    }

    .markdown-content table {
      width: 100%;
      border-collapse: collapse;
      margin: 12px 0;
      font-size: 13px;
      overflow: hidden;
      border: 1px solid var(--line);
      border-radius: 8px;
    }
    .markdown-content th,
    .markdown-content td {
      border: 1px solid var(--line);
      padding: 8px 10px;
      text-align: left;
      vertical-align: top;
    }
    .markdown-content th {
      background: #f9fafb;
      font-weight: 600;
    }

    .markdown-content img {
      max-width: 100%;
      height: auto;
      border-radius: 8px;
      border: 1px solid var(--line);
      margin: 8px 0;
      display: block;
    }

    .markdown-content a {
      color: #0f766e;
      text-decoration: none;
    }
    .markdown-content a:hover { text-decoration: underline; }

    .markdown-content hr {
      border: none;
      border-top: 1px solid var(--line);
      margin: 24px 0;
    }

    .chat-footer {
      max-width: 760px;
      margin: 18px auto 0;
      padding: 14px 0 0;
      border-top: 1px solid var(--line);
      color: var(--muted);
      font-size: 12px;
      word-break: break-all;
    }
    .chat-footer a {
      color: inherit;
      text-decoration: none;
    }
    .chat-footer a:hover {
      text-decoration: underline;
    }

    .chat-toast {
      position: fixed;
      right: 20px;
      bottom: 20px;
      padding: 8px 12px;
      border-radius: 10px;
      border: 1px solid #d1d5db;
      background: #ffffff;
      box-shadow: 0 8px 24px rgba(15, 23, 42, 0.08);
      font-size: 12px;
      color: #111827;
      opacity: 0;
      transform: translateY(8px);
      pointer-events: none;
      transition: opacity 160ms ease, transform 160ms ease;
      max-width: min(300px, calc(100vw - 24px));
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .chat-toast.show {
      opacity: 1;
      transform: translateY(0);
    }
    .chat-toast.error {
      color: var(--error);
      border-color: #fecaca;
      background: #fff1f2;
    }
    .chat-toast.ok {
      color: var(--ok);
      border-color: #a7f3d0;
      background: #ecfdf5;
    }

    @media (max-width: 760px) {
      body { padding: 10px 8px 24px; }
      .chat-toolbar { position: static; padding: 10px; }
      .chat-thread { width: 100%; }
      .chat-turn { margin: 18px 0; }
      .chat-turn.user .turn-body {
        max-width: 100%;
        width: auto;
      }
      .chat-footer { margin-top: 12px; }
      .chat-toast {
        right: 10px;
        bottom: 10px;
      }
    }

    @media print {
      body {
        background: #fff;
        padding: 0;
      }
      .chat-turn {
        page-break-inside: avoid;
      }
      .chat-toolbar,
      .code-copy-btn,
      .chat-toast { display: none !important; }
    }
  </style>
</head>
<body>
  <main class="chat-shell" id="chat-export-root">
    <header class="chat-toolbar">
      <div class="toolbar-main">
        <h1 class="chat-title">${safeTitle}</h1>
      <div class="chat-meta">
        <span class="chat-meta-item">导出时间: ${exportTime}</span>
        <span class="chat-meta-item">消息数: ${messages.length}</span>
        ${workspaceTag}
      </div>
      </div>
      <div class="toolbar-actions">
        <button type="button" class="toolbar-btn" data-copy-kind="text">复制全部文本</button>
        <button type="button" class="toolbar-btn" data-copy-kind="html">复制全部 HTML</button>
      </div>
    </header>
    <section class="chat-thread" id="conversation-content">
      ${turnsHtml}
    </section>
    <footer class="chat-footer">
      来源: ${rawSourceUrl ? `<a href="${sourceUrl}" target="_blank" rel="noopener noreferrer">${sourceUrl}</a>` : 'N/A'}
    </footer>
    <div class="chat-toast" id="copy-toast" aria-live="polite"></div>
  </main>
  <script>
${this.buildRuntimeScript()}
  </script>
</body>
</html>`;
  },

  buildRuntimeScript() {
    return `
(() => {
  const root = document.getElementById('chat-export-root');
  const thread = document.getElementById('conversation-content');
  const toast = document.getElementById('copy-toast');
  if (!root || !thread) return;

  let toastTimer = null;

  function showToast(message, isError) {
    if (!toast) return;
    toast.textContent = String(message || '');
    toast.classList.remove('error', 'ok', 'show');
    toast.classList.add(isError ? 'error' : 'ok');
    toast.classList.add('show');
    if (toastTimer) window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      toast.classList.remove('show');
    }, 1800);
  }

  function normalizeText(value) {
    return String(value || '').replace(/\\r\\n/g, '\\n').trim();
  }

  function fallbackCopyText(text) {
    const value = normalizeText(text);
    if (!value) return false;
    const textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.setAttribute('readonly', 'readonly');
    textarea.style.position = 'fixed';
    textarea.style.left = '-99999px';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch (err) {
      ok = false;
    }
    textarea.remove();
    return ok;
  }

  function fallbackCopyHtml(html) {
    const value = String(html || '').trim();
    if (!value) return false;
    const holder = document.createElement('div');
    holder.contentEditable = 'true';
    holder.innerHTML = value;
    holder.style.position = 'fixed';
    holder.style.left = '-99999px';
    holder.style.top = '0';
    holder.style.opacity = '0';
    document.body.appendChild(holder);
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(holder);
    selection.removeAllRanges();
    selection.addRange(range);
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch (err) {
      ok = false;
    }
    selection.removeAllRanges();
    holder.remove();
    return ok;
  }

  async function copyText(text) {
    const value = normalizeText(text);
    if (!value) return false;
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      try {
        await navigator.clipboard.writeText(value);
        return true;
      } catch (err) {}
    }
    return fallbackCopyText(value);
  }

  async function copyHtml(html, text) {
    const htmlValue = String(html || '').trim();
    const textValue = normalizeText(text);
    if (!htmlValue && !textValue) return false;

    if (window.ClipboardItem && navigator.clipboard && typeof navigator.clipboard.write === 'function') {
      try {
        const item = {};
        if (htmlValue) item['text/html'] = new Blob([htmlValue], { type: 'text/html' });
        if (textValue) item['text/plain'] = new Blob([textValue], { type: 'text/plain' });
        await navigator.clipboard.write([new ClipboardItem(item)]);
        return true;
      } catch (err) {}
    }

    if (htmlValue) return fallbackCopyHtml(htmlValue);
    return fallbackCopyText(textValue);
  }

  function detectLanguage(pre, code) {
    let lang = String(pre.getAttribute('data-language') || '').trim();
    if (!lang && code && code.classList) {
      for (let i = 0; i < code.classList.length; i += 1) {
        const cls = code.classList[i];
        if (cls.indexOf('language-') === 0 && cls.length > 9) {
          lang = cls.slice(9);
          break;
        }
      }
    }
    if (!lang) lang = 'Plain text';
    return lang;
  }

  function initCodeBlocks() {
    const blocks = thread.querySelectorAll('.markdown-content pre');
    blocks.forEach((pre) => {
      if (pre.closest('.code-shell')) return;
      const code = pre.querySelector('code');
      const language = detectLanguage(pre, code);
      const shell = document.createElement('div');
      shell.className = 'code-shell';
      const head = document.createElement('div');
      head.className = 'code-head';
      const lang = document.createElement('span');
      lang.className = 'code-lang';
      lang.textContent = language;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'code-copy-btn';
      btn.textContent = '复制';
      head.appendChild(lang);
      head.appendChild(btn);
      pre.parentNode.insertBefore(shell, pre);
      shell.appendChild(head);
      shell.appendChild(pre);
      pre.classList.add('code-body');

      btn.addEventListener('click', () => {
        const codeText = normalizeText(code ? code.textContent : pre.textContent);
        copyText(codeText).then((ok) => {
          showToast(ok ? '代码已复制' : '复制失败', !ok);
        });
      });
    });
  }

  function roleLabel(role) {
    if (role === 'user') return 'You';
    if (role === 'assistant') return 'ChatGPT';
    return 'System';
  }

  function getConversationText() {
    const rows = [];
    const turns = thread.querySelectorAll('.chat-turn');
    turns.forEach((turn) => {
      const role = roleLabel(turn.getAttribute('data-role'));
      const body = turn.querySelector('.turn-body');
      const text = normalizeText(body ? body.innerText : '');
      if (text) rows.push(role + ':\\n' + text);
    });
    return rows.join('\\n\\n');
  }

  function getConversationHtml() {
    const clone = thread.cloneNode(true);
    clone.querySelectorAll('.code-copy-btn').forEach((btn) => btn.remove());
    return clone.innerHTML;
  }

  initCodeBlocks();

  const copyTextBtn = root.querySelector('[data-copy-kind="text"]');
  if (copyTextBtn) {
    copyTextBtn.addEventListener('click', () => {
      copyText(getConversationText()).then((ok) => {
        showToast(ok ? '全文文本已复制' : '复制失败', !ok);
      });
    });
  }

  const copyHtmlBtn = root.querySelector('[data-copy-kind="html"]');
  if (copyHtmlBtn) {
    copyHtmlBtn.addEventListener('click', () => {
      copyHtml(getConversationHtml(), getConversationText()).then((ok) => {
        showToast(ok ? '全文 HTML 已复制' : '复制失败', !ok);
      });
    });
  }
})();
    `.trim();
  },

  normalizeRole(role) {
    const value = String(role || '').toLowerCase();
    if (value === 'user') return 'user';
    if (value === 'assistant') return 'assistant';
    return 'system';
  },

  detectCodeLanguage(pre, codeEl) {
    const fromData = String(pre?.getAttribute?.('data-language') || '').trim();
    if (fromData) return fromData;

    const sources = [codeEl, pre];
    for (const source of sources) {
      if (!source || !source.classList) continue;
      for (const cls of Array.from(source.classList)) {
        if (cls.startsWith('language-') && cls.length > 9) {
          return cls.slice(9);
        }
      }
    }

    const classText = String(codeEl?.getAttribute?.('class') || pre?.getAttribute?.('class') || '');
    const match = classText.match(/language-([a-z0-9_-]+)/i);
    return match ? match[1] : '';
  },

  normalizePreBlock(pre) {
    if (!pre || !pre.parentNode) return;
    const codeEl = pre.querySelector('code');
    const language = this.detectCodeLanguage(pre, codeEl);
    const codeText = String(codeEl?.textContent || pre.textContent || '').replace(/\u00a0/g, ' ');
    const normalizedPre = document.createElement('pre');
    if (language) normalizedPre.setAttribute('data-language', language);
    const normalizedCode = document.createElement('code');
    if (language) normalizedCode.className = `language-${language}`;
    normalizedCode.textContent = codeText;
    normalizedPre.appendChild(normalizedCode);
    pre.replaceWith(normalizedPre);
  },

  stripEventAttributes(root) {
    root.querySelectorAll('*').forEach((node) => {
      Array.from(node.attributes || []).forEach((attr) => {
        const name = String(attr.name || '').toLowerCase();
        if (name.startsWith('on') || name === 'style') {
          node.removeAttribute(attr.name);
        }
      });
    });
  },

  dropCopyArtifacts(root) {
    root.querySelectorAll('[class*="copy"], [data-testid*="copy"]').forEach((node) => {
      node.remove();
    });

    root.querySelectorAll('[aria-label]').forEach((node) => {
      const aria = String(node.getAttribute('aria-label') || '');
      if (/copy|复制/i.test(aria)) node.remove();
    });

    root.querySelectorAll('p, div, span').forEach((node) => {
      if (node.querySelector('pre')) return;
      const text = String(node.textContent || '').trim().toLowerCase();
      if (text === 'copy code' || text === 'copy' || text === '复制代码') {
        node.remove();
      }
    });
  },

  ensureSafeLinks(root) {
    root.querySelectorAll('a').forEach((anchor) => {
      anchor.setAttribute('target', '_blank');
      anchor.setAttribute('rel', 'noopener noreferrer');
    });
  },

  normalizeCodeBlocks(root) {
    root.querySelectorAll('pre').forEach((pre) => {
      this.normalizePreBlock(pre);
    });
  },

  cleanupEmptyContainers(root) {
    root.querySelectorAll('div, span').forEach((node) => {
      if (node.querySelector('pre, code, img, table, ul, ol, blockquote, p, h1, h2, h3, h4, h5, h6')) return;
      if (String(node.textContent || '').trim()) return;
      node.remove();
    });
  },

  sanitizeMessageHtml(rawHtml) {
    const root = document.createElement('div');
    root.innerHTML = String(rawHtml || '');

    root.querySelectorAll('script, style, iframe, video, audio, button, textarea, input, select, form').forEach((node) => {
      node.remove();
    });

    this.dropCopyArtifacts(root);
    this.stripEventAttributes(root);
    this.ensureSafeLinks(root);
    this.normalizeCodeBlocks(root);
    this.cleanupEmptyContainers(root);

    return root.innerHTML;
  },

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = String(text || '');
    return div.innerHTML;
  }
};

if (typeof window !== 'undefined') {
  window.ChatGPTSaver = window.ChatGPTSaver || {};
  window.ChatGPTSaver.HTMLExporter = HTMLExporter;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { HTMLExporter };
}
