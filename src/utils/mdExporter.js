/**
 * Markdown exporter based on Turndown + @joplin/turndown-plugin-gfm.
 */

function resolveTurndownServiceCtor() {
  if (typeof TurndownService !== 'undefined') return TurndownService;
  if (typeof window !== 'undefined' && typeof window.TurndownService !== 'undefined') {
    return window.TurndownService;
  }
  return null;
}

function resolveGfmPluginModule() {
  if (typeof TurndownPluginGfm !== 'undefined') return TurndownPluginGfm;
  if (typeof window !== 'undefined' && window.TurndownPluginGfm) return window.TurndownPluginGfm;

  if (typeof module !== 'undefined' && typeof module.require === 'function') {
    try {
      return module.require('@joplin/turndown-plugin-gfm');
    } catch (error) {
      return null;
    }
  }

  if (typeof require === 'function') {
    try {
      return require('@joplin/turndown-plugin-gfm');
    } catch (error) {
      return null;
    }
  }

  return null;
}

function sanitizeImageAltText(alt) {
  return String(alt || '图片')
    .replace(/\r?\n/g, ' ')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]');
}

function normalizeMarkdownOutput(markdownText) {
  return String(markdownText || '')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function createMarkdownTurndownService(options = {}) {
  const TurndownCtor = options.TurndownServiceCtor || resolveTurndownServiceCtor();
  if (!TurndownCtor) return null;

  const service = new TurndownCtor({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
    emDelimiter: '*'
  });

  const gfmModule = options.gfmModule || resolveGfmPluginModule();
  const gfmPlugin = gfmModule?.gfm || gfmModule?.default?.gfm || null;
  if (typeof gfmPlugin === 'function') {
    service.use(gfmPlugin);
  }

  service.addRule('codeBlock', {
    filter(node) {
      return node.nodeName === 'PRE' && !!node.querySelector('code');
    },
    replacement(content, node) {
      const codeEl = node.querySelector('code');
      const code = codeEl?.textContent || node.textContent || '';
      let language = '';

      if (codeEl && codeEl.classList?.length) {
        const langClass = Array.from(codeEl.classList).find(c => c.startsWith('language-'));
        if (langClass) language = langClass.replace('language-', '');
      }
      if (!language && node.hasAttribute('data-language')) {
        language = String(node.getAttribute('data-language') || '').trim();
      }

      return `\n\n\`\`\`${language}\n${code}\n\`\`\`\n\n`;
    }
  });

  service.addRule('inlineCode', {
    filter(node) {
      return node.nodeName === 'CODE' && node.parentNode?.nodeName !== 'PRE';
    },
    replacement(content, node) {
      return '`' + String(node.textContent || '') + '`';
    }
  });

  service.addRule('image', {
    filter: 'img',
    replacement(content, node) {
      const alt = sanitizeImageAltText(node.getAttribute('alt'));
      const src = String(node.getAttribute('src') || '').trim();
      return `![${alt}](${src})`;
    }
  });

  service.addRule('removeButtons', {
    filter(node) {
      return node.nodeName === 'BUTTON' ||
        (node.classList && (
          node.classList.contains('copy-button') ||
          node.classList.contains('absolute')
        ));
    },
    replacement() {
      return '';
    }
  });

  return service;
}

const MarkdownExporter = {
  turndownService: null,

  init() {
    if (this.turndownService) return;
    this.turndownService = createMarkdownTurndownService();
    if (!this.turndownService) {
      console.error('Turndown.js 未加载');
    }
  },

  export() {
    this.init();
    const conversation = window.ChatGPTSaver.Parser.parseConversation();
    return this.exportConversation(conversation);
  },

  exportFromMessages(messages, title = '') {
    this.init();
    const parser = window.ChatGPTSaver?.Parser;
    const safeMessages = Array.isArray(messages) ? messages : [];
    const conversation = {
      title: String(title || parser?.getConversationTitle?.() || '对话节选').trim(),
      isWorkspace: !!parser?.isWorkspacePage?.(),
      url: typeof window !== 'undefined' ? window.location.href : '',
      messages: safeMessages
    };
    return this.exportConversation(conversation);
  },

  exportConversation(conversation) {
    const source = conversation && typeof conversation === 'object' ? conversation : {};
    const messages = Array.isArray(source.messages) ? source.messages : [];
    if (!messages.length) return null;

    const title = String(source.title || 'ChatGPT 对话').trim() || 'ChatGPT 对话';
    const url = String(source.url || (typeof window !== 'undefined' ? window.location.href : '') || '');
    const isWorkspace = source.isWorkspace === true;

    let markdown = '';
    markdown += `# ${title}\n\n`;
    markdown += `> 导出时间: ${new Date().toLocaleString('zh-CN')}  \n`;
    markdown += `> 消息数量: ${messages.length}  \n`;
    if (isWorkspace) markdown += '> 对话类型: 工作区  \n';
    if (url) markdown += `> 来源: ${url}\n\n`;
    markdown += '---\n\n';

    messages.forEach((msg, index) => {
      const role = String(msg?.role || '').toLowerCase();
      const roleLabel = role === 'user'
        ? '## 👤 用户'
        : (role === 'assistant' ? '## 🤖 ChatGPT' : '## ⚙️ 系统');
      markdown += `${roleLabel}\n\n`;

      const rawHtml = String(msg?.content || msg?.textContent || '').trim();
      markdown += this.htmlToMarkdown(rawHtml);
      markdown += '\n\n';

      if (index < messages.length - 1) {
        markdown += '---\n\n';
      }
    });

    markdown += '*由 ChatGPT 对话保存助手导出*\n';
    return normalizeMarkdownOutput(markdown);
  },

  htmlToMarkdown(html) {
    if (!this.turndownService) this.init();

    if (!this.turndownService) {
      const fallbackDiv = document.createElement('div');
      fallbackDiv.innerHTML = html;
      return normalizeMarkdownOutput(fallbackDiv.textContent || fallbackDiv.innerText || '');
    }

    try {
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = html;
      tempDiv.querySelectorAll('button, [class*="copy"]').forEach((el) => el.remove());

      const markdown = this.turndownService.turndown(tempDiv);
      return normalizeMarkdownOutput(markdown);
    } catch (error) {
      console.error('Markdown 转换失败:', error);
      const fallbackDiv = document.createElement('div');
      fallbackDiv.innerHTML = html;
      return normalizeMarkdownOutput(fallbackDiv.textContent || fallbackDiv.innerText || '');
    }
  },

  exportSimple() {
    const conversation = window.ChatGPTSaver.Parser.parseConversation();
    const messages = Array.isArray(conversation?.messages) ? conversation.messages : [];
    if (!messages.length) return null;

    let text = '';
    text += `# ${conversation.title}\n\n`;
    text += `导出时间: ${new Date().toLocaleString('zh-CN')}\n`;
    text += '---\n\n';

    messages.forEach((msg, index) => {
      const roleLabel = msg.role === 'user' ? '## 用户' : '## ChatGPT';
      text += `${roleLabel}\n\n${msg.textContent || ''}\n\n`;
      if (index < messages.length - 1) text += '---\n\n';
    });

    return normalizeMarkdownOutput(text);
  }
};

if (typeof window !== 'undefined') {
  window.ChatGPTSaver = window.ChatGPTSaver || {};
  window.ChatGPTSaver.MarkdownExporter = MarkdownExporter;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    MarkdownExporter,
    createMarkdownTurndownService,
    normalizeMarkdownOutput
  };
}

