/**
 * 剪贴板工具：把 ConversationModel 或子集复制为 Markdown / 富文本 / 纯文本。
 *
 * 跑在 content / popup 页面（service worker 没有 navigator.clipboard）。
 * 所有方法返回 Promise<{success, mime}>。
 */

const ClipboardManager = {
  /**
   * 写纯文本。
   */
  async writeText(text) {
    const value = String(text || '').replace(/\r\n/g, '\n').trim();
    if (!value) return { success: false, error: 'empty' };
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(value);
        return { success: true, mime: 'text/plain' };
      } catch (e) {
        // fall through
      }
    }
    return this._fallbackCopyText(value);
  },

  /**
   * 同时写 HTML 与纯文本（粘贴到 Notion/Word 显示富文本，粘贴到 Markdown 编辑器显示纯文本）。
   */
  async writeRich(html, plainText) {
    const htmlValue = String(html || '').trim();
    const textValue = String(plainText || '').replace(/\r\n/g, '\n').trim();
    if (!htmlValue && !textValue) return { success: false, error: 'empty' };

    if (typeof window !== 'undefined' && window.ClipboardItem &&
        navigator.clipboard?.write) {
      try {
        const item = {};
        if (htmlValue) item['text/html'] = new Blob([htmlValue], { type: 'text/html' });
        if (textValue) item['text/plain'] = new Blob([textValue], { type: 'text/plain' });
        await navigator.clipboard.write([new ClipboardItem(item)]);
        return { success: true, mime: 'text/html' };
      } catch (e) {
        // fall through
      }
    }
    if (htmlValue) return this._fallbackCopyHtml(htmlValue);
    return this._fallbackCopyText(textValue);
  },

  _fallbackCopyText(text) {
    if (typeof document === 'undefined') return { success: false, error: 'no_document' };
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    ta.setAttribute('readonly', 'readonly');
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (_) { ok = false; }
    document.body.removeChild(ta);
    return ok ? { success: true, mime: 'text/plain' } : { success: false, error: 'execCommand_failed' };
  },

  _fallbackCopyHtml(html) {
    if (typeof document === 'undefined') return { success: false, error: 'no_document' };
    const holder = document.createElement('div');
    holder.contentEditable = 'true';
    holder.innerHTML = html;
    holder.style.position = 'fixed';
    holder.style.opacity = '0';
    holder.style.left = '-9999px';
    document.body.appendChild(holder);
    const range = document.createRange();
    range.selectNodeContents(holder);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (_) { ok = false; }
    sel.removeAllRanges();
    document.body.removeChild(holder);
    return ok ? { success: true, mime: 'text/html' } : { success: false, error: 'execCommand_failed' };
  },

  /**
   * 把 ConversationModel.messages 转 Markdown 文本（不写剪贴板，纯转换）。
   * 用 ConversationModel.blockToPlainText 走 plain，简单稳定。
   */
  conversationToMarkdown(modelOrMessages, options = {}) {
    const Model = (typeof window !== 'undefined' && window.ChatGPTSaver?.ConversationModel) ||
      (typeof require === 'function' ? (function () { try { return require('../core/model').ConversationModel; } catch (_) { return null; } })() : null);
    const messages = this._extractMessages(modelOrMessages);
    if (!messages.length) return '';
    const lines = [];
    if (options.title) lines.push(`# ${options.title}`, '');
    messages.forEach((msg) => {
      const role = (msg.role === 'user') ? 'You' : (msg.role === 'assistant' ? 'ChatGPT' : (msg.role || 'System'));
      lines.push(`## ${role}`);
      const blocks = Array.isArray(msg.blocks) ? msg.blocks : [];
      if (blocks.length && Model) {
        blocks.forEach((b) => {
          const text = Model.blockToPlainText(b, { includeThoughtDetails: !!options.includeThoughtDetails });
          if (text) lines.push(text);
        });
      } else {
        const t = String(msg.textContent || msg.text || msg.content || '').trim();
        if (t) lines.push(t);
      }
      lines.push('');
    });
    return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  },

  /**
   * 把 ConversationModel 转「富文本 HTML」（不含 wrapper，直接是 body 片段）。
   * 走 modelToLegacyConversation 后再拿每条 message.content。
   */
  conversationToRichHtml(modelOrMessages, options = {}) {
    const Model = (typeof window !== 'undefined' && window.ChatGPTSaver?.ConversationModel) || null;
    const messages = this._extractMessages(modelOrMessages);
    if (!messages.length) return '';
    const parts = [];
    if (options.title) parts.push(`<h1>${this._escape(options.title)}</h1>`);
    messages.forEach((msg) => {
      const role = (msg.role === 'user') ? 'You' : (msg.role === 'assistant' ? 'ChatGPT' : (msg.role || 'System'));
      parts.push(`<h2>${this._escape(role)}</h2>`);
      if (Array.isArray(msg.blocks) && Model) {
        msg.blocks.forEach((b) => {
          const html = Model.blockToLegacyHtml ? Model.blockToLegacyHtml(b) : '';
          if (html) parts.push(html);
        });
      } else if (msg.content) {
        parts.push(`<div>${msg.content}</div>`);
      } else if (msg.textContent) {
        parts.push(`<p>${this._escape(msg.textContent)}</p>`);
      }
    });
    return parts.join('\n');
  },

  _extractMessages(modelOrMessages) {
    if (!modelOrMessages) return [];
    if (Array.isArray(modelOrMessages)) return modelOrMessages;
    if (Array.isArray(modelOrMessages.messages)) return modelOrMessages.messages;
    return [];
  },

  _escape(s) {
    return String(s || '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ClipboardManager };
} else if (typeof window !== 'undefined') {
  window.ChatGPTSaver = window.ChatGPTSaver || {};
  window.ChatGPTSaver.ClipboardManager = ClipboardManager;
}
