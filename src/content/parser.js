/**
 * ChatGPT 对话解析器
 * 支持普通对话和工作区（Workspace）对话
 */

const ChatGPTParser = {
  /**
   * 获取对话标题
   */
  getConversationTitle() {
    // 方式1: 从页面标题获取（最可靠）
    const pageTitle = document.title;
    if (pageTitle && pageTitle !== 'ChatGPT' && !pageTitle.startsWith('ChatGPT')) {
      // 标题格式通常是 "对话标题 - ChatGPT" 或 "对话标题 | ChatGPT"
      let title = pageTitle
        .replace(/\s*[-|]\s*ChatGPT.*$/i, '')
        .replace(/^ChatGPT\s*[-|]\s*/i, '')
        .trim();
      if (title && title.length > 0) {
        return title;
      }
    }
    
    // 方式2: 从侧边栏当前选中的对话获取
    const sidebarSelectors = [
      'nav li[class*="bg-"] a',
      'nav [data-testid="history-item"][class*="bg-"]',
      'nav a[class*="bg-token-sidebar-surface-secondary"]',
      'nav li.bg-token-sidebar-surface-secondary a',
      'nav [class*="active"]',
      'nav li[class*="relative"][class*="bg-"]'
    ];
    
    for (const selector of sidebarSelectors) {
      const activeItem = document.querySelector(selector);
      if (activeItem) {
        // 获取文本内容，排除按钮和图标
        const textContent = activeItem.textContent?.trim();
        if (textContent && textContent.length > 0 && textContent.length < 200) {
          return textContent;
        }
      }
    }
    
    // 方式3: 从第一条用户消息获取
    const firstUserMessage = this.getFirstUserMessage();
    if (firstUserMessage) {
      const text = firstUserMessage.trim();
      if (text.length > 0) {
        return text.substring(0, 50) + (text.length > 50 ? '...' : '');
      }
    }
    
    // 方式4: 从 URL 生成
    const urlMatch = window.location.pathname.match(/\/c\/([a-zA-Z0-9-]+)/);
    if (urlMatch) {
      return `对话_${urlMatch[1].substring(0, 8)}`;
    }
    
    // 默认标题
    return `ChatGPT对话_${new Date().toLocaleDateString('zh-CN')}`;
  },
  
  /**
   * 获取第一条用户消息
   */
  getFirstUserMessage() {
    const userMessages = document.querySelectorAll('[data-message-author-role="user"]');
    if (userMessages.length > 0) {
      const contentEl = userMessages[0].querySelector('.whitespace-pre-wrap') || userMessages[0];
      return contentEl.textContent?.trim() || '';
    }
    return '';
  },
  
  /**
   * 检测是否为工作区（Workspace）页面
   */
  isWorkspacePage() {
    // 检查 URL 是否包含 workspace 或 project
    return window.location.pathname.includes('/g/') || 
           window.location.pathname.includes('/gpts/') ||
           document.querySelector('[data-testid="workspace"]') !== null;
  },
  
  /**
   * 获取当前工作空间名称
   * 返回空间名称，如果是个人帐户则返回 "个人帐户"
   */
  getWorkspaceName() {
    console.log('[Parser] 开始检测工作空间...');
    
    // 方式1: 查找侧边栏中的工作空间按钮（class 包含 __menu-item 和 gap-2，且文本不是常见菜单项）
    // 这个按钮显示当前工作空间名称，格式如 "London26.1.5"(图标+名称)
    const workspaceButtons = document.querySelectorAll('[class*="__menu-item"][class*="gap-2"]:not([class*="gap-2.5"])');
    for (const btn of workspaceButtons) {
      const text = btn.textContent?.trim();
      // 过滤掉常见的非工作空间菜单项
      if (text && text.length >= 2 && text.length <= 60) {
        if (text.includes('@') || text.includes('新') || text.includes('New') ||
            text.includes('搜索') || text.includes('Search') ||
            text.includes('设置') || text.includes('Setting') ||
            text.includes('帮助') || text.includes('Help') ||
            text.includes('退出') || text.includes('Logout') ||
            text.includes('Ctrl') || text.includes('Shift')) {
          continue;
        }
        
        // 找到了工作空间按钮，提取名称
        // 文本可能是 "Logo名称" 或纯名称，需要提取最后的名称部分
        // 查找 class 为 line-clamp-1 的元素（通常包含纯名称）
        const nameEl = btn.querySelector('.line-clamp-1');
        let workspaceName = nameEl ? nameEl.textContent?.trim() : text;
        
        if (workspaceName) {
          // 检查是否是个人帐户
          if (workspaceName === '个人帐户' || workspaceName.toLowerCase().includes('personal')) {
            console.log('[Parser] 检测到个人帐户');
            return '个人帐户';
          }
          console.log('[Parser] 从工作空间按钮获取:', workspaceName);
          return workspaceName;
        }
      }
    }
    
    // 方式2: 查找弹出菜单中选中的工作空间（没有 gap-1.5 的 __menu-item）
    // 当工作空间选择器打开时，选中的项没有 gap-1.5
    const popoverItems = document.querySelectorAll('[class*="popover"] [class*="__menu-item"]');
    for (const item of popoverItems) {
      const className = item.className;
      // 选中的工作空间项没有 gap-1.5，但其他项有
      if (className.includes('__menu-item') && !className.includes('gap-1.5') && !className.includes('gap-2')) {
        const nameEl = item.querySelector('.line-clamp-1');
        const text = nameEl ? nameEl.textContent?.trim() : item.textContent?.trim();
        
        if (text && text.length >= 1 && text.length <= 50) {
          // 排除非工作空间项
          if (text.includes('@') || text.includes('设置') || text.includes('帮助') ||
              text.includes('退出') || text.includes('Ctrl')) {
            continue;
          }
          
          if (text === '个人帐户' || text.toLowerCase().includes('personal')) {
            console.log('[Parser] 从弹出菜单检测到个人帐户');
            return '个人帐户';
          }
          
          console.log('[Parser] 从弹出菜单获取工作空间:', text);
          return text;
        }
      }
    }
    
    // 方式3: 直接查找包含 line-clamp-1 且在 nav 内的元素
    const navLineClamps = document.querySelectorAll('nav .line-clamp-1');
    for (const el of navLineClamps) {
      const text = el.textContent?.trim();
      // 检查是否像工作空间名称（短文本，不是对话标题）
      if (text && text.length >= 1 && text.length <= 30) {
        // 检查父元素是否是工作空间相关
        const parent = el.closest('[class*="__menu-item"]');
        if (parent && parent.className.includes('gap-2')) {
          if (text === '个人帐户' || text.toLowerCase().includes('personal')) {
            return '个人帐户';
          }
          console.log('[Parser] 从 line-clamp 获取工作空间:', text);
          return text;
        }
      }
    }
    
    // 默认返回个人帐户
    console.log('[Parser] 未能检测到工作空间，使用默认: 个人帐户');
    return '个人帐户';
  },
  
  /**
   * 获取对话容器
   */
  getConversationContainer() {
    // ChatGPT 主对话容器的选择器（可能随版本变化）
    const selectors = [
      'main [class*="react-scroll-to-bottom"]',
      'main [class*="overflow-y-auto"]',
      '[data-testid="conversation-panel"]',
      'main div[class*="flex"][class*="flex-col"]'
    ];
    
    for (const selector of selectors) {
      const container = document.querySelector(selector);
      if (container) {
        return container;
      }
    }
    
    return document.querySelector('main');
  },
  
  /**
   * 获取所有消息元素
   */
  getMessageElements() {
    // 优先使用 data-message-author-role 属性
    let messages = document.querySelectorAll('[data-message-author-role]');
    if (messages.length > 0) {
      return Array.from(messages);
    }
    
    // 备用选择器
    const fallbackSelectors = [
      'main article[data-testid]',
      'main [class*="group/conversation-turn"]',
      'main [class*="agent-turn"]',
      'main [class*="user-turn"]'
    ];
    
    for (const selector of fallbackSelectors) {
      messages = document.querySelectorAll(selector);
      if (messages.length > 0) {
        return Array.from(messages);
      }
    }
    
    return [];
  },
  
  /**
   * 解析单条消息
   */
  parseMessage(messageEl) {
    const role = messageEl.getAttribute('data-message-author-role');
    const isUser = role === 'user';
    const isAssistant = role === 'assistant';
    
    // 获取消息内容 - 使用更精确的选择器
    let contentEl = null;
    
    // 对于用户消息
    if (isUser) {
      contentEl = messageEl.querySelector('.whitespace-pre-wrap') ||
                  messageEl.querySelector('[data-message-content]') ||
                  messageEl.querySelector('div[class*="text-base"]');
    }
    
    // 对于助手消息
    if (isAssistant) {
      contentEl = messageEl.querySelector('[class*="markdown"]') ||
                  messageEl.querySelector('.prose') ||
                  messageEl.querySelector('[data-message-content]');
    }
    
    // 默认回退
    if (!contentEl) {
      contentEl = messageEl.querySelector('[class*="markdown"]') ||
                  messageEl.querySelector('.prose') ||
                  messageEl.querySelector('.whitespace-pre-wrap') ||
                  messageEl.querySelector('[data-message-content]');
    }
    
    if (!contentEl) {
      // 最后尝试查找任何有内容的子元素
      const allDivs = messageEl.querySelectorAll('div');
      for (const div of allDivs) {
        if (div.textContent.trim().length > 10 && !div.querySelector('button')) {
          contentEl = div;
          break;
        }
      }
    }
    
    if (!contentEl) {
      contentEl = messageEl;
    }
    
    // 克隆元素以避免修改原始 DOM
    const clonedContent = contentEl.cloneNode(true);
    
    // 移除不需要的元素（按钮、复制图标等）
    clonedContent.querySelectorAll('button, [class*="copy"], [class*="sticky"], svg').forEach(el => {
      if (el.closest('[class*="markdown"]') === null || el.tagName === 'BUTTON') {
        el.remove();
      }
    });
    
    // 处理代码块
    const codeBlocks = clonedContent.querySelectorAll('pre');
    codeBlocks.forEach(pre => {
      const codeEl = pre.querySelector('code');
      if (codeEl) {
        const langClass = Array.from(codeEl.classList).find(c => c.startsWith('language-'));
        if (langClass) {
          pre.setAttribute('data-language', langClass.replace('language-', ''));
        }
      }
    });
    
    const textContent = clonedContent.textContent.trim();
    
    // 过滤掉太短的内容（可能是按钮文本等）
    if (textContent.length < 2) {
      return null;
    }
    
    return {
      role: isUser ? 'user' : (isAssistant ? 'assistant' : 'system'),
      content: clonedContent.innerHTML,
      textContent: textContent,
      element: clonedContent
    };
  },
  
  /**
   * 解析整个对话
   */
  parseConversation() {
    const title = this.getConversationTitle();
    const isWorkspace = this.isWorkspacePage();
    const container = this.getConversationContainer();
    const messageElements = this.getMessageElements();
    
    const messages = [];
    
    messageElements.forEach(el => {
      try {
        const message = this.parseMessage(el);
        if (message && message.textContent && message.textContent.length > 1) {
          messages.push(message);
        }
      } catch (error) {
        console.error('解析消息失败:', error);
      }
    });
    
    console.log(`解析到 ${messages.length} 条消息`);
    
    return {
      title,
      isWorkspace,
      messages,
      timestamp: new Date().toISOString(),
      url: window.location.href,
      container
    };
  },
  
  /**
   * 获取对话的原始 HTML（保留样式）
   */
  getConversationHTML() {
    const conversation = this.parseConversation();
    const container = this.getConversationContainer();
    
    if (!container) {
      return null;
    }
    
    // 收集需要的样式
    const styles = this.collectStyles();
    
    // 构建完整的 HTML 文档
    const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${this.escapeHtml(conversation.title)}</title>
  <style>
    ${styles}
    
    /* 自定义样式 */
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      line-height: 1.6;
      max-width: 800px;
      margin: 0 auto;
      padding: 20px;
      background: #f7f7f8;
    }
    
    .chat-header {
      text-align: center;
      padding: 20px;
      margin-bottom: 20px;
      border-bottom: 1px solid #e5e5e5;
    }
    
    .chat-header h1 {
      font-size: 24px;
      margin: 0 0 10px 0;
    }
    
    .chat-header .meta {
      color: #666;
      font-size: 14px;
    }
    
    .message {
      margin: 16px 0;
      padding: 16px;
      border-radius: 8px;
    }
    
    .message.user {
      background: #f7f7f8;
      border-left: 4px solid #10a37f;
    }
    
    .message.assistant {
      background: #fff;
      border-left: 4px solid #6366f1;
    }
    
    .message .role {
      font-weight: 600;
      margin-bottom: 8px;
      color: #333;
    }
    
    .message .role.user-role {
      color: #10a37f;
    }
    
    .message .role.assistant-role {
      color: #6366f1;
    }
    
    pre {
      background: #1e1e1e;
      color: #d4d4d4;
      padding: 16px;
      border-radius: 8px;
      overflow-x: auto;
    }
    
    code {
      font-family: 'Monaco', 'Menlo', monospace;
    }
    
    pre code {
      background: transparent;
      padding: 0;
    }
    
    :not(pre) > code {
      background: #f0f0f0;
      padding: 2px 6px;
      border-radius: 4px;
    }
  </style>
</head>
<body>
  <div class="chat-header">
    <h1>${this.escapeHtml(conversation.title)}</h1>
    <div class="meta">
      <span>导出时间: ${new Date().toLocaleString('zh-CN')}</span>
      ${conversation.isWorkspace ? '<span> | 工作区对话</span>' : ''}
    </div>
  </div>
  
  <div class="chat-content">
    ${conversation.messages.map(msg => `
      <div class="message ${msg.role}">
        <div class="role ${msg.role}-role">${msg.role === 'user' ? '👤 用户' : '🤖 ChatGPT'}</div>
        <div class="content">${msg.content}</div>
      </div>
    `).join('')}
  </div>
</body>
</html>`;
    
    return html;
  },
  
  /**
   * 收集页面样式
   */
  collectStyles() {
    const styles = [];
    
    // 收集 <style> 标签中的样式
    document.querySelectorAll('style').forEach(styleEl => {
      // 只收集与对话相关的样式
      if (styleEl.textContent.includes('markdown') || 
          styleEl.textContent.includes('prose') ||
          styleEl.textContent.includes('code')) {
        styles.push(styleEl.textContent);
      }
    });
    
    return styles.join('\n');
  },
  
  /**
   * HTML 转义
   */
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  },
  
  /**
   * 检测是否有新消息
   */
  hasNewContent(previousHash) {
    const currentHash = this.getContentHash();
    return currentHash !== previousHash;
  },
  
  /**
   * 获取内容哈希（用于检测变化）
   */
  getContentHash() {
    const messages = this.getMessageElements();
    const content = messages.map(m => m.textContent).join('');
    
    // 简单的哈希函数
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash.toString();
  },
  
  /**
   * 检测 GPT 是否正在回复
   */
  isGPTTyping() {
    // 检测打字动画或加载指示器
    const typingIndicators = [
      '[class*="result-streaming"]',
      '[class*="streaming"]',
      '[data-testid="stop-button"]',
      'button[aria-label="Stop generating"]',
      'button[aria-label="停止生成"]',
      '.animate-pulse',
      '[class*="typing"]',
      // 检测“正在思考”或“正在输入”状态
      '[class*="thinking"]',
      '[data-state="streaming"]'
    ];
    
    for (const selector of typingIndicators) {
      const el = document.querySelector(selector);
      if (el) {
        // 确保元素可见
        if (el.offsetParent !== null || el.style.display !== 'none') {
          return true;
        }
      }
    }
    
    // 检查是否有加载动画
    const loadingDots = document.querySelector('[class*="dot"][class*="animate"]');
    if (loadingDots) {
      return true;
    }
    
    return false;
  }
};

// 导出
window.ChatGPTSaver = window.ChatGPTSaver || {};
window.ChatGPTSaver.Parser = ChatGPTParser;
