// ==UserScript==
// @name         ChatGPT 对话保存助手
// @namespace    https://github.com/chatgpt-saver
// @version      1.0.1
// @description  自动保存 ChatGPT 对话，支持导出为 HTML、Markdown、PDF 格式
// @author       ChatGPT Saver
// @match        https://chat.openai.com/*
// @match        https://chatgpt.com/*
// @match        https://*.openai.com/*
// @match        https://*.chatgpt.com/*
// @icon         https://chat.openai.com/favicon.ico
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @grant        GM_download
// @grant        GM_notification
// @require      https://unpkg.com/turndown@7.1.2/dist/turndown.js
// @require      https://unpkg.com/html2canvas@1.4.1/dist/html2canvas.min.js
// @require      https://unpkg.com/jspdf@2.5.1/dist/jspdf.umd.min.js
// @run-at       document-idle
// @noframes
// ==/UserScript==

(function() {
  'use strict';

  // ==================== 配置 ====================
  const CONFIG = {
    autoSave: false, // 默认关闭自动保存（因为需要用户手势来选择文件夹）
    formats: { html: true, md: true, pdf: true },
    debounceDelay: 3000,
    showPanel: true,
    showLogPanel: GM_getValue('showLogPanel', true), // 是否显示日志弹框
    saveMode: 'download' // 'download' 或 'folder'
  };

  // 保存的文件夹句柄
  let savedFolderHandle = null;
  
  // IndexedDB 配置
  const DB_NAME = 'ChatGPTSaverDB';
  const DB_STORE = 'fileHandles';
  const DB_KEY = 'rootFolderHandle';

  // ==================== 工具函数 ====================
  const Utils = {
    // 清理文件名
    sanitizeFileName(name) {
      return name
        .replace(/[/\\:*?"<>|]/g, '-')
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, 100);
    },

    // 获取时间戳
    getTimestamp() {
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');
      const hour = String(now.getHours()).padStart(2, '0');
      const minute = String(now.getMinutes()).padStart(2, '0');
      const second = String(now.getSeconds()).padStart(2, '0');
      return `${year}${month}${day}_${hour}${minute}${second}`;
    },

    // HTML 转义
    escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    },

    // 下载文件
    downloadFile(content, filename, mimeType) {
      const blob = content instanceof Blob ? content : new Blob([content], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    },

    // 检查是否支持 File System Access API
    isFileSystemSupported() {
      return typeof window.showDirectoryPicker === 'function';
    },

    // ==================== IndexedDB 操作 ====================
    // 打开 IndexedDB
    async openDB() {
      return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onerror = () => reject(request.error);
        request.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains(DB_STORE)) {
            db.createObjectStore(DB_STORE);
          }
        };
        request.onsuccess = () => resolve(request.result);
      });
    },

    // 保存文件夹句柄到 IndexedDB
    async saveHandleToDB(handle) {
      try {
        const db = await this.openDB();
        return new Promise((resolve, reject) => {
          const tx = db.transaction(DB_STORE, 'readwrite');
          const store = tx.objectStore(DB_STORE);
          store.put(handle, DB_KEY);
          tx.oncomplete = () => {
            console.log('[ChatGPT Saver] 文件夹句柄已保存到 IndexedDB');
            resolve(true);
          };
          tx.onerror = () => reject(tx.error);
        });
      } catch (e) {
        console.error('[ChatGPT Saver] 保存句柄到 IndexedDB 失败:', e);
        return false;
      }
    },

    // 从 IndexedDB 读取文件夹句柄
    async getHandleFromDB() {
      try {
        const db = await this.openDB();
        return new Promise((resolve) => {
          const tx = db.transaction(DB_STORE, 'readonly');
          const store = tx.objectStore(DB_STORE);
          const request = store.get(DB_KEY);
          request.onsuccess = () => resolve(request.result || null);
          request.onerror = () => resolve(null);
        });
      } catch (e) {
        console.log('[ChatGPT Saver] 从 IndexedDB 读取句柄失败:', e);
        return null;
      }
    },

    // 清除 IndexedDB 中的句柄
    async clearHandleFromDB() {
      try {
        const db = await this.openDB();
        return new Promise((resolve) => {
          const tx = db.transaction(DB_STORE, 'readwrite');
          const store = tx.objectStore(DB_STORE);
          store.delete(DB_KEY);
          tx.oncomplete = () => resolve(true);
          tx.onerror = () => resolve(false);
        });
      } catch (e) {
        return false;
      }
    },

    // 尝试恢复文件夹访问权限
    async tryRestoreAccess() {
      if (!this.isFileSystemSupported()) {
        console.log('[ChatGPT Saver] 浏览器不支持 File System API');
        return false;
      }

      const handle = await this.getHandleFromDB();
      if (!handle) {
        console.log('[ChatGPT Saver] IndexedDB 中没有保存的文件夹');
        return false;
      }

      try {
        // 检查权限状态
        const permission = await handle.queryPermission({ mode: 'readwrite' });
        console.log('[ChatGPT Saver] 文件夹权限状态:', permission);
        
        if (permission === 'granted') {
          // 权限还在，直接使用
          savedFolderHandle = handle;
          CONFIG.saveMode = 'folder';
          console.log('[ChatGPT Saver] ✅ 文件夹权限已恢复:', handle.name);
          return { success: true, handle, needsReauth: false };
        } else {
          // 权限已过期，需要重新授权（但句柄还在）
          console.log('[ChatGPT Saver] 文件夹权限已过期，需要重新授权');
          return { success: false, handle, needsReauth: true };
        }
      } catch (e) {
        console.log('[ChatGPT Saver] 检查权限失败:', e.message);
        // 句柄已失效，清除
        await this.clearHandleFromDB();
        return { success: false, handle: null, needsReauth: false };
      }
    },

    // 重新请求权限（使用已保存的句柄）
    async requestPermissionForSavedHandle(handle) {
      try {
        const permission = await handle.requestPermission({ mode: 'readwrite' });
        if (permission === 'granted') {
          savedFolderHandle = handle;
          CONFIG.saveMode = 'folder';
          console.log('[ChatGPT Saver] ✅ 文件夹权限已重新授予');
          return true;
        }
        return false;
      } catch (e) {
        console.error('[ChatGPT Saver] 请求权限失败:', e);
        return false;
      }
    },

    // 选择文件夹
    async selectFolder() {
      if (!this.isFileSystemSupported()) {
        alert('您的浏览器不支持选择文件夹功能，请使用最新版 Chrome 或 Edge');
        return null;
      }
      try {
        const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
        savedFolderHandle = handle;
        CONFIG.saveMode = 'folder';
        // 保存到 IndexedDB
        await this.saveHandleToDB(handle);
        // 保存文件夹名到 GM storage
        GM_setValue('savedFolderName', handle.name);
        return handle;
      } catch (e) {
        if (e.name !== 'AbortError') {
          console.error('选择文件夹失败:', e);
        }
        return null;
      }
    },

    // 获取或创建文件夹
    async getOrCreateFolder(parentHandle, folderName) {
      try {
        return await parentHandle.getDirectoryHandle(folderName, { create: true });
      } catch (e) {
        console.error('创建文件夹失败:', folderName, e);
        throw e;
      }
    },

    // 保存文件到文件夹
    async saveToFolder(folderHandle, filename, content, mimeType) {
      try {
        const blob = content instanceof Blob ? content : new Blob([content], { type: mimeType });
        const fileHandle = await folderHandle.getFileHandle(filename, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(blob);
        await writable.close();
        return true;
      } catch (e) {
        console.error('保存文件失败:', e);
        return false;
      }
    },

    // 创建分层目录结构: 空间名/对话标题/html|md|pdf
    async createConversationFolders(rootHandle, workspaceName, conversationTitle) {
      const safeWorkspace = this.sanitizeFileName(workspaceName || '个人帐户');
      const safeTitle = this.sanitizeFileName(conversationTitle);
      
      // 创建空间文件夹
      const workspaceFolder = await this.getOrCreateFolder(rootHandle, safeWorkspace);
      // 创建对话文件夹
      const conversationFolder = await this.getOrCreateFolder(workspaceFolder, safeTitle);
      // 创建子文件夹
      const htmlFolder = await this.getOrCreateFolder(conversationFolder, 'html');
      const mdFolder = await this.getOrCreateFolder(conversationFolder, 'md');
      const pdfFolder = await this.getOrCreateFolder(conversationFolder, 'pdf');
      
      return {
        workspace: workspaceFolder,
        conversation: conversationFolder,
        html: htmlFolder,
        md: mdFolder,
        pdf: pdfFolder,
        workspaceName: safeWorkspace,
        title: safeTitle
      };
    },

    // 智能保存（根据模式选择保存方式）- 单文件版本
    async smartSave(filename, content, mimeType) {
      if (CONFIG.saveMode === 'folder' && savedFolderHandle) {
        const success = await this.saveToFolder(savedFolderHandle, filename, content, mimeType);
        if (success) return 'folder';
      }
      // 回退到下载
      this.downloadFile(content, filename, mimeType);
      return 'download';
    },

    // 检查文件是否存在
    async fileExists(folderHandle, filename) {
      try {
        await folderHandle.getFileHandle(filename, { create: false });
        return true;
      } catch (e) {
        return false;
      }
    },

    // 读取文件内容
    async readFileContent(folderHandle, filename) {
      try {
        const fileHandle = await folderHandle.getFileHandle(filename, { create: false });
        const file = await fileHandle.getFile();
        return await file.text();
      } catch (e) {
        return null;
      }
    },

    // 从已保存的HTML文件中提取消息数量
    extractMessageCountFromHtml(htmlContent) {
      if (!htmlContent) return 0;
      // 匹配 "共 X 条消息"
      const match = htmlContent.match(/共\s*(\d+)\s*条消息/);
      return match ? parseInt(match[1], 10) : 0;
    },

    // 检查对话是否需要更新（比较消息数量）
    async checkConversationNeedsUpdate(rootHandle, workspaceName, conversationTitle, currentMessageCount) {
      try {
        const safeWorkspace = this.sanitizeFileName(workspaceName || '个人帐户');
        const safeTitle = this.sanitizeFileName(conversationTitle);
        
        // 检查空间文件夹
        let workspaceFolder;
        try {
          workspaceFolder = await rootHandle.getDirectoryHandle(safeWorkspace, { create: false });
        } catch (e) {
          return { needsUpdate: true, reason: 'new', savedCount: 0 };
        }
        
        // 检查对话文件夹
        let conversationFolder;
        try {
          conversationFolder = await workspaceFolder.getDirectoryHandle(safeTitle, { create: false });
        } catch (e) {
          return { needsUpdate: true, reason: 'new', savedCount: 0 };
        }
        
        // 尝试读取已保存的HTML文件来获取消息数
        let savedMessageCount = 0;
        try {
          const htmlFolder = await conversationFolder.getDirectoryHandle('html', { create: false });
          const htmlContent = await this.readFileContent(htmlFolder, `${safeTitle}.html`);
          if (htmlContent) {
            savedMessageCount = this.extractMessageCountFromHtml(htmlContent);
          }
        } catch (e) {
          // HTML文件不存在，需要保存
          return { needsUpdate: true, reason: 'no_html', savedCount: 0 };
        }
        
        // 比较消息数量
        if (currentMessageCount > savedMessageCount) {
          return { 
            needsUpdate: true, 
            reason: 'updated', 
            savedCount: savedMessageCount,
            currentCount: currentMessageCount
          };
        }
        
        // 消息数等于或小于已保存的，无需更新
        return { 
          needsUpdate: false, 
          reason: 'unchanged', 
          savedCount: savedMessageCount,
          currentCount: currentMessageCount,
          path: `${safeWorkspace}/${safeTitle}`
        };
      } catch (e) {
        console.error('检查对话状态失败:', e);
        return { needsUpdate: true, reason: 'error', savedCount: 0 };
      }
    },

    // 保存对话到分层目录（只保存缺失的格式）
    async saveConversationToFolder(rootHandle, workspaceName, conversationTitle, htmlContent, mdContent, pdfBlob, formats, missingFormats = null) {
      try {
        const folders = await this.createConversationFolders(rootHandle, workspaceName, conversationTitle);
        const saved = [];
        
        // 如果指定了缺失格式，只保存缺失的
        const shouldSaveHtml = formats.html && htmlContent && (!missingFormats || missingFormats.includes('html') || missingFormats.includes('all'));
        const shouldSaveMd = formats.md && mdContent && (!missingFormats || missingFormats.includes('md') || missingFormats.includes('all'));
        const shouldSavePdf = formats.pdf && pdfBlob && (!missingFormats || missingFormats.includes('pdf') || missingFormats.includes('all'));
        
        if (shouldSaveHtml) {
          await this.saveToFolder(folders.html, `${folders.title}.html`, htmlContent, 'text/html');
          saved.push('HTML');
        }
        
        if (shouldSaveMd) {
          await this.saveToFolder(folders.md, `${folders.title}.md`, mdContent, 'text/markdown');
          saved.push('MD');
        }
        
        if (shouldSavePdf) {
          await this.saveToFolder(folders.pdf, `${folders.title}.pdf`, pdfBlob, 'application/pdf');
          saved.push('PDF');
        }
        
        return {
          success: true,
          saved,
          path: `${folders.workspaceName}/${folders.title}`
        };
      } catch (e) {
        console.error('保存对话失败:', e);
        return { success: false, error: e.message };
      }
    }
  };

  // ==================== 解析器 ====================
  const Parser = {
    // 获取对话标题
    getConversationTitle() {
      const pageTitle = document.title;
      if (pageTitle && pageTitle !== 'ChatGPT' && !pageTitle.startsWith('ChatGPT')) {
        let title = pageTitle
          .replace(/\s*[-|]\s*ChatGPT.*$/i, '')
          .replace(/^ChatGPT\s*[-|]\s*/i, '')
          .trim();
        if (title && title.length > 0) {
          return title;
        }
      }

      // 从侧边栏获取
      const sidebarSelectors = [
        'nav li[class*="bg-"] a',
        'nav [data-testid="history-item"][class*="bg-"]',
        'nav a[class*="bg-token-sidebar-surface-secondary"]'
      ];

      for (const selector of sidebarSelectors) {
        const activeItem = document.querySelector(selector);
        if (activeItem) {
          const textContent = activeItem.textContent?.trim();
          if (textContent && textContent.length > 0 && textContent.length < 200) {
            return textContent;
          }
        }
      }

      // 从第一条用户消息获取
      const firstUserMessage = this.getFirstUserMessage();
      if (firstUserMessage) {
        const text = firstUserMessage.trim();
        if (text.length > 0) {
          return text.substring(0, 50) + (text.length > 50 ? '...' : '');
        }
      }

      // 从 URL 生成
      const urlMatch = window.location.pathname.match(/\/c\/([a-zA-Z0-9-]+)/);
      if (urlMatch) {
        return `对话_${urlMatch[1].substring(0, 8)}`;
      }

      return `ChatGPT对话_${new Date().toLocaleDateString('zh-CN')}`;
    },

    // 获取第一条用户消息
    getFirstUserMessage() {
      const userMessages = document.querySelectorAll('[data-message-author-role="user"]');
      if (userMessages.length > 0) {
        const contentEl = userMessages[0].querySelector('.whitespace-pre-wrap') || userMessages[0];
        return contentEl.textContent?.trim() || '';
      }
      return '';
    },

    // 获取工作空间名称
    getWorkspaceName() {
      const workspaceButtons = document.querySelectorAll('[class*="__menu-item"][class*="gap-2"]:not([class*="gap-2.5"])');
      for (const btn of workspaceButtons) {
        const text = btn.textContent?.trim();
        if (text && text.length >= 2 && text.length <= 60) {
          if (text.includes('@') || text.includes('新') || text.includes('搜索') ||
              text.includes('设置') || text.includes('帮助') || text.includes('退出') ||
              text.includes('Ctrl')) {
            continue;
          }
          const nameEl = btn.querySelector('.line-clamp-1');
          let workspaceName = nameEl ? nameEl.textContent?.trim() : text;
          if (workspaceName) {
            if (workspaceName === '个人帐户' || workspaceName.toLowerCase().includes('personal')) {
              return '个人帐户';
            }
            return workspaceName;
          }
        }
      }
      return '个人帐户';
    },

    // 获取对话容器
    getConversationContainer() {
      const selectors = [
        'main [class*="react-scroll-to-bottom"]',
        'main [class*="overflow-y-auto"]',
        '[data-testid="conversation-panel"]',
        'main div[class*="flex"][class*="flex-col"]'
      ];

      for (const selector of selectors) {
        const container = document.querySelector(selector);
        if (container) return container;
      }
      return document.querySelector('main');
    },

    // 获取所有消息元素
    getMessageElements() {
      let messages = document.querySelectorAll('[data-message-author-role]');
      if (messages.length > 0) {
        return Array.from(messages);
      }

      const fallbackSelectors = [
        'main article[data-testid]',
        'main [class*="group/conversation-turn"]'
      ];

      for (const selector of fallbackSelectors) {
        messages = document.querySelectorAll(selector);
        if (messages.length > 0) {
          return Array.from(messages);
        }
      }
      return [];
    },

    // 解析单条消息
    parseMessage(messageEl) {
      const role = messageEl.getAttribute('data-message-author-role');
      const isUser = role === 'user';
      const isAssistant = role === 'assistant';

      let contentEl = null;
      if (isUser) {
        contentEl = messageEl.querySelector('.whitespace-pre-wrap') ||
                    messageEl.querySelector('[data-message-content]');
      }
      if (isAssistant) {
        contentEl = messageEl.querySelector('[class*="markdown"]') ||
                    messageEl.querySelector('.prose');
      }
      if (!contentEl) {
        contentEl = messageEl.querySelector('[class*="markdown"]') ||
                    messageEl.querySelector('.prose') ||
                    messageEl.querySelector('.whitespace-pre-wrap');
      }
      if (!contentEl) contentEl = messageEl;

      const clonedContent = contentEl.cloneNode(true);
      clonedContent.querySelectorAll('button, [class*="copy"], svg').forEach(el => {
        if (el.closest('[class*="markdown"]') === null || el.tagName === 'BUTTON') {
          el.remove();
        }
      });

      const textContent = clonedContent.textContent.trim();
      if (textContent.length < 2) return null;

      return {
        role: isUser ? 'user' : (isAssistant ? 'assistant' : 'system'),
        content: clonedContent.innerHTML,
        textContent: textContent
      };
    },

    // 解析整个对话
    parseConversation() {
      const title = this.getConversationTitle();
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

      return {
        title,
        messages,
        timestamp: new Date().toISOString(),
        url: window.location.href
      };
    },

    // 检测 GPT 是否正在回复
    isGPTTyping() {
      const typingIndicators = [
        '[class*="result-streaming"]',
        '[class*="streaming"]',
        '[data-testid="stop-button"]',
        'button[aria-label="Stop generating"]',
        'button[aria-label="停止生成"]',
        'button[data-testid="stop-button"]',
        // 新版ChatGPT的停止按钮
        'button[class*="stop"]',
        '[data-state="streaming"]'
      ];

      for (const selector of typingIndicators) {
        try {
          const el = document.querySelector(selector);
          if (el && el.offsetParent !== null) {
            return true;
          }
        } catch (e) {
          // 无效选择器，跳过
        }
      }
      return false;
    },

    // 获取内容哈希
    getContentHash() {
      const messages = this.getMessageElements();
      const content = messages.map(m => m.textContent).join('');
      let hash = 0;
      for (let i = 0; i < content.length; i++) {
        const char = content.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
      }
      return hash.toString();
    }
  };

  // ==================== HTML 导出器 ====================
  const HTMLExporter = {
    export() {
      const conversation = Parser.parseConversation();
      if (!conversation.messages.length) return null;

      return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${Utils.escapeHtml(conversation.title)} - ChatGPT 对话记录</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans SC', Roboto, sans-serif;
      line-height: 1.6; background: #f7f7f8; color: #374151;
    }
    .container { max-width: 850px; margin: 0 auto; padding: 40px 20px; }
    .chat-header {
      background: linear-gradient(135deg, #10a37f 0%, #0d8a6a 100%);
      color: white; padding: 30px; border-radius: 16px; margin-bottom: 30px;
      box-shadow: 0 4px 20px rgba(16, 163, 127, 0.3);
    }
    .chat-header h1 { font-size: 24px; font-weight: 600; margin-bottom: 12px; }
    .chat-header .meta { font-size: 14px; opacity: 0.9; }
    .chat-content { display: flex; flex-direction: column; gap: 20px; }
    .message {
      background: white; border-radius: 12px; padding: 20px 24px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
    }
    .message.user { border-left: 4px solid #10a37f; }
    .message.assistant { border-left: 4px solid #6366f1; }
    .message .role {
      display: flex; align-items: center; gap: 8px; font-weight: 600;
      font-size: 14px; margin-bottom: 12px; padding-bottom: 12px; border-bottom: 1px solid #f0f0f0;
    }
    .message.user .role { color: #10a37f; }
    .message.assistant .role { color: #6366f1; }
    .message .content { font-size: 15px; line-height: 1.7; }
    .message .content pre {
      background: #1e1e1e; color: #d4d4d4; padding: 16px 20px;
      border-radius: 8px; overflow-x: auto; margin: 16px 0; font-size: 13px;
    }
    .message .content pre code { font-family: 'Monaco', 'Menlo', monospace; background: transparent; }
    .message .content :not(pre) > code {
      background: #f3f4f6; padding: 2px 6px; border-radius: 4px;
      font-family: 'Monaco', 'Menlo', monospace; font-size: 0.9em; color: #ef4444;
    }
    .chat-footer { text-align: center; margin-top: 40px; padding-top: 20px; border-top: 1px solid #e5e7eb; color: #9ca3af; font-size: 13px; }
  </style>
</head>
<body>
  <div class="container">
    <header class="chat-header">
      <h1>${Utils.escapeHtml(conversation.title)}</h1>
      <div class="meta">
        <span>📅 导出时间: ${new Date().toLocaleString('zh-CN')}</span>
        <span>💬 共 ${conversation.messages.length} 条消息</span>
      </div>
    </header>
    <div class="chat-content">
      ${conversation.messages.map(msg => `
        <div class="message ${msg.role}">
          <div class="role">
            <span>${msg.role === 'user' ? '👤 用户' : '🤖 ChatGPT'}</span>
          </div>
          <div class="content">${msg.content}</div>
        </div>
      `).join('')}
    </div>
    <footer class="chat-footer">
      <p>由 ChatGPT 对话保存助手导出 | ${window.location.href}</p>
    </footer>
  </div>
</body>
</html>`;
    }
  };

  // ==================== Markdown 导出器 ====================
  const MarkdownExporter = {
    turndownService: null,

    init() {
      if (this.turndownService) return;
      if (typeof TurndownService === 'undefined') {
        console.error('Turndown.js 未加载');
        return;
      }

      this.turndownService = new TurndownService({
        headingStyle: 'atx',
        codeBlockStyle: 'fenced',
        bulletListMarker: '-'
      });

      // 代码块处理
      this.turndownService.addRule('codeBlock', {
        filter: node => node.nodeName === 'PRE' && node.querySelector('code'),
        replacement: (content, node) => {
          const codeEl = node.querySelector('code');
          const code = codeEl.textContent;
          let language = '';
          const langClass = Array.from(codeEl.classList).find(c => c.startsWith('language-'));
          if (langClass) language = langClass.replace('language-', '');
          return '\n\n```' + language + '\n' + code + '\n```\n\n';
        }
      });

      // 移除按钮
      this.turndownService.addRule('removeButtons', {
        filter: node => node.nodeName === 'BUTTON',
        replacement: () => ''
      });
    },

    export() {
      this.init();
      const conversation = Parser.parseConversation();
      if (!conversation.messages.length) return null;

      let markdown = `# ${conversation.title}\n\n`;
      markdown += `> 📅 导出时间: ${new Date().toLocaleString('zh-CN')}  \n`;
      markdown += `> 💬 共 ${conversation.messages.length} 条消息  \n`;
      markdown += `> 🔗 来源: ${conversation.url}\n\n`;
      markdown += `---\n\n`;

      conversation.messages.forEach((msg, index) => {
        const roleLabel = msg.role === 'user' ? '## 👤 用户' : '## 🤖 ChatGPT';
        markdown += `${roleLabel}\n\n`;

        let msgContent = msg.content;
        if (this.turndownService) {
          try {
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = msg.content;
            tempDiv.querySelectorAll('button').forEach(el => el.remove());
            msgContent = this.turndownService.turndown(tempDiv);
            msgContent = msgContent.replace(/\n{3,}/g, '\n\n');
          } catch (e) {
            msgContent = msg.textContent;
          }
        } else {
          msgContent = msg.textContent;
        }

        markdown += msgContent.trim() + '\n\n';
        if (index < conversation.messages.length - 1) {
          markdown += `---\n\n`;
        }
      });

      markdown += `\n---\n\n*由 ChatGPT 对话保存助手导出*\n`;
      return markdown;
    }
  };

  // ==================== PDF 导出器 ====================
  const PDFExporter = {
    isAvailable() {
      return typeof html2canvas !== 'undefined' && typeof jspdf !== 'undefined';
    },

    // 让浏览器有时间处理UI更新
    async yieldToMain() {
      return new Promise(resolve => {
        if ('requestIdleCallback' in window) {
          requestIdleCallback(resolve, { timeout: 50 });
        } else {
          setTimeout(resolve, 0);
        }
      });
    },

    async export() {
      if (!this.isAvailable()) {
        console.error('PDF 导出库未加载');
        return null;
      }

      const conversation = Parser.parseConversation();
      if (!conversation.messages.length) return null;

      try {
        const { jsPDF } = jspdf;
        const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

        const pageWidth = 210;
        const pageHeight = 297;
        const margin = 15;
        const contentWidth = pageWidth - margin * 2;
        const contentHeight = pageHeight - margin * 2 - 24;

        // 创建临时容器
        const container = this.createPDFContainer(conversation, contentWidth);
        document.body.appendChild(container);
        
        // 等待DOM渲染
        await new Promise(resolve => setTimeout(resolve, 100));
        await this.yieldToMain();

        // 使用较低的scale减少内存和CPU占用
        UI.addLog('📸 正在捕捉页面内容...');
        const canvas = await html2canvas(container, {
          scale: 1.5,  // 降低 scale，从 2 降到 1.5
          useCORS: true,
          logging: false,
          backgroundColor: '#ffffff',
          // 异步渲染，减少主线程阻塞
          async: true,
          allowTaint: true
        });

        document.body.removeChild(container);
        await this.yieldToMain();

        UI.addLog('📄 正在生成PDF页面...');
        
        const imgWidth = contentWidth;
        const imgHeight = (canvas.height * imgWidth) / canvas.width;
        const totalPages = Math.ceil(imgHeight / contentHeight);

        // 分批处理页面，每页之间yield给主线程
        for (let page = 0; page < totalPages; page++) {
          if (page > 0) pdf.addPage();

          // 页眉
          pdf.setFontSize(9);
          pdf.setTextColor(130, 130, 130);
          pdf.text('ChatGPT Saver', margin, 8);
          pdf.text(new Date().toLocaleDateString('en-US'), pageWidth - margin - 20, 8);

          // 计算裁剪
          const sourceY = page * contentHeight * (canvas.height / imgHeight);
          const sourceHeight = Math.min(contentHeight * (canvas.height / imgHeight), canvas.height - sourceY);

          const pageCanvas = document.createElement('canvas');
          pageCanvas.width = canvas.width;
          pageCanvas.height = sourceHeight;
          const ctx = pageCanvas.getContext('2d');
          ctx.drawImage(canvas, 0, sourceY, canvas.width, sourceHeight, 0, 0, canvas.width, sourceHeight);

          // 使用较低质量减少处理时间
          const pageImgData = pageCanvas.toDataURL('image/jpeg', 0.85);
          const pageImgHeight = (sourceHeight * imgWidth) / canvas.width;
          pdf.addImage(pageImgData, 'JPEG', margin, margin + 12, imgWidth, pageImgHeight);

          // 页脚
          pdf.text(`${page + 1} / ${totalPages}`, pageWidth - margin - 15, pageHeight - 8);

          // 每处理几页后yield一次，让浏览器响应
          if (page % 2 === 0) {
            await this.yieldToMain();
          }
        }

        // 最后输出前yield
        await this.yieldToMain();
        return pdf.output('blob');
      } catch (error) {
        console.error('PDF 生成失败:', error);
        return null;
      }
    },

    createPDFContainer(conversation, widthMM) {
      const widthPx = widthMM * 3.78;
      const container = document.createElement('div');
      container.style.cssText = `
        position: absolute; left: -9999px; top: 0; width: ${widthPx}px;
        background: white; font-family: -apple-system, BlinkMacSystemFont, 'Microsoft YaHei', sans-serif;
        padding: 20px; line-height: 1.6; font-size: 14px;
      `;

      const header = document.createElement('div');
      header.style.cssText = `
        text-align: center; margin-bottom: 20px; padding: 20px;
        background: linear-gradient(135deg, #10a37f 0%, #0d8a6a 100%);
        border-radius: 10px; color: white;
      `;
      header.innerHTML = `
        <h1 style="margin: 0 0 8px 0; font-size: 20px;">${Utils.escapeHtml(conversation.title)}</h1>
        <p style="margin: 0; font-size: 12px; opacity: 0.9;">
          导出时间: ${new Date().toLocaleString('zh-CN')} | 共 ${conversation.messages.length} 条消息
        </p>
      `;
      container.appendChild(header);

      conversation.messages.forEach(msg => {
        const isUser = msg.role === 'user';
        const messageDiv = document.createElement('div');
        messageDiv.style.cssText = `
          margin: 15px 0; padding: 15px; border-radius: 8px;
          background: ${isUser ? '#f0fdf4' : '#f8fafc'};
          border-left: 4px solid ${isUser ? '#10a37f' : '#6366f1'};
        `;
        messageDiv.innerHTML = `
          <div style="font-weight: 600; color: ${isUser ? '#10a37f' : '#6366f1'}; margin-bottom: 10px; padding-bottom: 8px; border-bottom: 1px solid #e5e5e5;">
            ${isUser ? '👤 用户' : '🤖 ChatGPT'}
          </div>
          <div style="color: #374151; font-size: 13px; line-height: 1.7; word-wrap: break-word;">${msg.content}</div>
        `;
        container.appendChild(messageDiv);
      });

      return container;
    }
  };

  // ==================== 观察器 ====================
  const Observer = {
    observer: null,
    debounceTimer: null,
    previousHash: null,
    previousURL: null,
    isWatching: false,
    onCompleteCallback: null,
    retryCount: 0,
    maxRetries: 30, // 最多重试30次，即 30 秒

    start(onComplete) {
      console.log('[ChatGPT Saver] Observer.start() 被调用');
      
      // 如果已经在监听，不重复启动
      if (this.isWatching && this.observer) {
        console.log('[ChatGPT Saver] 已经在监听中，跳过');
        return;
      }

      this.onCompleteCallback = onComplete;
      
      // 切换对话时重置 hash
      const currentURL = window.location.href;
      if (this.previousURL !== currentURL) {
        this.previousHash = null;
        this.previousURL = currentURL;
        console.log('[ChatGPT Saver] URL变化，重置 hash');
      }

      // 直接监听整个 main 元素，更可靠
      const mainEl = document.querySelector('main');
      if (!mainEl) {
        this.retryCount++;
        if (this.retryCount <= this.maxRetries) {
          console.log(`[ChatGPT Saver] 未找到 main 元素，${this.retryCount}/${this.maxRetries} 次重试...`);
          setTimeout(() => this.start(onComplete), 1000);
        } else {
          console.error('[ChatGPT Saver] 达到最大重试次数，停止重试');
        }
        return;
      }

      this.retryCount = 0;
      
      // 清理旧的 observer
      if (this.observer) {
        this.observer.disconnect();
      }

      this.observer = new MutationObserver(mutations => this.handleMutations(mutations));
      this.observer.observe(mainEl, { 
        childList: true, 
        subtree: true, 
        characterData: true,
        attributes: false 
      });
      this.isWatching = true;
      console.log('[ChatGPT Saver] ✅ 对话监听已启动 (监听 main 元素)');
      
      UI.updateStatus();
    },

    handleMutations(mutations) {
      // 过滤无关的变化
      const hasRelevantChange = mutations.some(m => {
        if (m.type === 'childList' && m.addedNodes.length > 0) {
          // 检查是否是消息相关的变化
          for (const node of m.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              // 检查是否包含消息元素
              if (node.querySelector && 
                  (node.querySelector('[data-message-author-role]') ||
                   node.getAttribute?.('data-message-author-role') ||
                   node.classList?.contains('group/conversation-turn'))) {
                return true;
              }
              // 检查是否是消息容器的更新
              if (node.closest && node.closest('[data-message-author-role]')) {
                return true;
              }
            }
            if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) {
              const parent = node.parentElement;
              if (parent && parent.closest && parent.closest('[data-message-author-role]')) {
                return true;
              }
            }
          }
        }
        return false;
      });

      if (!hasRelevantChange) return;

      if (this.debounceTimer) clearTimeout(this.debounceTimer);

      const isTyping = Parser.isGPTTyping();

      if (isTyping) {
        this.debounceTimer = setTimeout(() => this.checkForCompletion(), 500);
        return;
      }

      this.debounceTimer = setTimeout(() => this.checkForCompletion(), CONFIG.debounceDelay);
    },

    checkForCompletion() {
      const isTyping = Parser.isGPTTyping();
      
      if (isTyping) {
        this.debounceTimer = setTimeout(() => this.checkForCompletion(), 1000);
        return;
      }

      setTimeout(() => {
        if (Parser.isGPTTyping()) {
          this.debounceTimer = setTimeout(() => this.checkForCompletion(), 1000);
          return;
        }

        const currentHash = Parser.getContentHash();
        const messages = Parser.getMessageElements();

        console.log(`[ChatGPT Saver] 检查: hash=${currentHash}, prevHash=${this.previousHash}, 消息数=${messages.length}`);

        if (currentHash === this.previousHash) {
          return;
        }
        if (messages.length < 2) {
          return;
        }

        this.previousHash = currentHash;

        if (this.onCompleteCallback) {
          console.log(`[ChatGPT Saver] ✅ 检测到回复完成，共 ${messages.length} 条消息，触发保存`);
          this.onCompleteCallback();
        }
      }, 2000);
    },

    // 重置状态（用于切换对话时）
    reset() {
      this.previousHash = null;
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
        this.debounceTimer = null;
      }
      console.log('[ChatGPT Saver] Observer 状态已重置');
    },

    stop() {
      if (this.observer) {
        this.observer.disconnect();
        this.observer = null;
      }
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
        this.debounceTimer = null;
      }
      this.isWatching = false;
      this.retryCount = 0;
      console.log('[ChatGPT Saver] 对话监听已停止');
      
      UI.updateStatus();
    }
  };

  // Logo SVG (简洁的对话/文档保存图标)
  const LOGO_SVG = `<svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="20" cy="20" r="20" fill="#10a37f"/>
    <rect x="12" y="12" width="16" height="3" rx="1.5" fill="white"/>
    <rect x="12" y="17" width="16" height="3" rx="1.5" fill="white"/>
    <rect x="12" y="22" width="10" height="3" rx="1.5" fill="white"/>
    <path d="M24 25l3 3 5-5" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;

  // ==================== UI 面板 ====================
  const UI = {
    panel: null,
    logPanel: null,
    toastTimer: null,

    init() {
      this.addStyles();
      this.createFloatingButton();
      this.createPanel();
      this.createLogPanel();
      this.createToast();
    },

    addStyles() {
      GM_addStyle(`
        #chatgpt-saver-panel {
          --saver-bg: #ffffff;
          --saver-text: #333333;
          --saver-header-bg: #f3f4f6;
          --saver-header-text: #333333;
          --saver-border: #e5e7eb;
          --saver-sec-btn-bg: #f3f4f6;
          --saver-sec-btn-text: #374151;
          --saver-format-bg: #ffffff;
          --saver-format-active-bg: #f3f4f6;
          --saver-format-active-border: #9ca3af;
          --saver-primary-btn-bg: #f3f4f6;
          --saver-primary-btn-text: #374151;
          --saver-active-color: #374151;
          --saver-log-bg: #f8f9fa;
          --saver-log-text: #374151;
          --saver-log-header-loading-bg: #e0f2fe;
          --saver-log-header-loading-text: #0369a1;
          --saver-log-header-success-bg: #dcfce7;
          --saver-log-header-success-text: #166534;
          --saver-log-header-error-bg: #fee2e2;
          --saver-log-header-error-text: #dc2626;
        }

        #chatgpt-saver-panel.saver-dark {
          --saver-bg: #2d2d2d;
          --saver-text: #e0e0e0;
          --saver-header-bg: #1e1e1e;
          --saver-header-text: #ffffff;
          --saver-border: #444444;
          --saver-sec-btn-bg: #3d3d3d;
          --saver-sec-btn-text: #e0e0e0;
          --saver-format-bg: #3d3d3d;
          --saver-format-active-bg: #3d3d3d;
          --saver-format-active-border: #6b7280;
          --saver-primary-btn-bg: #3d3d3d;
          --saver-primary-btn-text: #e0e0e0;
          --saver-active-color: #e0e0e0;
          --saver-log-bg: #1e1e1e;
          --saver-log-text: #e0e0e0;
          --saver-log-header-loading-bg: #0c4a6e;
          --saver-log-header-loading-text: #e0f2fe;
          --saver-log-header-success-bg: #064e3b;
          --saver-log-header-success-text: #dcfce7;
          --saver-log-header-error-bg: #7f1d1d;
          --saver-log-header-error-text: #fee2e2;
        }

        #chatgpt-saver-btn {
          position: fixed; bottom: 20px; right: 20px; width: 50px; height: 50px;
          background: transparent;
          border: none; border-radius: 50%; cursor: pointer; z-index: 9999;
          box-shadow: 0 4px 12px rgba(16, 163, 127, 0.4);
          display: flex; align-items: center; justify-content: center;
          transition: transform 0.2s;
          padding: 0; overflow: hidden;
        }
        #chatgpt-saver-btn svg {
          width: 100%; height: 100%;
        }
        #chatgpt-saver-btn:hover { transform: scale(1.1); }

        /* Toast 通知样式 */
        #chatgpt-saver-toast {
          position: fixed; bottom: 80px; right: 20px;
          background: rgba(0, 0, 0, 0.85); color: white;
          padding: 10px 16px; border-radius: 8px;
          font-size: 13px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          z-index: 10000; opacity: 0; transform: translateY(10px);
          transition: all 0.3s ease; pointer-events: none;
          max-width: 220px; text-align: center;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        }
        #chatgpt-saver-toast.show {
          opacity: 1; transform: translateY(0);
        }
        #chatgpt-saver-toast.saving {
          background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%);
        }
        #chatgpt-saver-toast.success {
          background: linear-gradient(135deg, #10a37f 0%, #0d8a6a 100%);
        }
        #chatgpt-saver-toast.skip {
          background: linear-gradient(135deg, #6b7280 0%, #4b5563 100%);
        }

        #chatgpt-saver-panel {
          position: fixed; bottom: 80px; right: 20px; width: 320px;
          background: var(--saver-bg); border-radius: 16px; z-index: 9998;
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.15);
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          display: none;
          color: var(--saver-text);
        }
        #chatgpt-saver-panel.show { display: block; animation: slideUp 0.3s ease; }

        @keyframes slideUp {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }

        .saver-panel-header {
          padding: 16px; background: var(--saver-header-bg);
          border-radius: 16px 16px 0 0; color: var(--saver-header-text);
          position: relative;
        }
        .saver-panel-header h3 { margin: 0; font-size: 16px; font-weight: 600; }
        .saver-panel-header p { margin: 4px 0 0; font-size: 12px; opacity: 0.9; }

        .saver-panel-content { padding: 16px; }

        .saver-format-group { display: flex; gap: 8px; margin-bottom: 16px; }
        .saver-format-btn {
          flex: 1; padding: 10px; border: 2px solid var(--saver-border); border-radius: 8px;
          background: var(--saver-format-bg); cursor: pointer; text-align: center; transition: all 0.2s;
        }
        .saver-format-btn.active { border-color: var(--saver-format-active-border); background: var(--saver-format-active-bg); }
        .saver-format-btn span { display: block; font-size: 12px; color: #666; margin-top: 4px; }
        #chatgpt-saver-panel.saver-dark .saver-format-btn span { color: #aaa; }

        .saver-action-btn {
          width: 100%; padding: 12px; border: none; border-radius: 8px;
          background: var(--saver-primary-btn-bg);
          color: var(--saver-primary-btn-text); font-size: 14px; font-weight: 600; cursor: pointer;
          margin-bottom: 8px; transition: opacity 0.2s;
        }
        .saver-action-btn:hover { opacity: 0.9; }
        .saver-action-btn.secondary { background: var(--saver-sec-btn-bg); color: var(--saver-sec-btn-text); }

        .saver-status { font-size: 12px; color: #666; text-align: center; padding-top: 8px; border-top: 1px solid var(--saver-border); }
        #chatgpt-saver-panel.saver-dark .saver-status { color: #aaa; }
        .saver-status .active { color: var(--saver-active-color); }

        /* 内嵌日志区域 */
        .saver-log-area {
          margin-top: 12px; border-top: 1px solid var(--saver-border); padding-top: 12px;
          display: none;
        }
        .saver-log-area.show { display: block; }
        
        .saver-log-header-inline {
          display: flex; align-items: center; gap: 8px; margin-bottom: 8px;
          padding: 8px 12px; border-radius: 8px; font-size: 13px; font-weight: 600;
        }
        .saver-log-header-inline.loading { background: var(--saver-log-header-loading-bg); color: var(--saver-log-header-loading-text); }
        .saver-log-header-inline.success { background: var(--saver-log-header-success-bg); color: var(--saver-log-header-success-text); }
        .saver-log-header-inline.error { background: var(--saver-log-header-error-bg); color: var(--saver-log-header-error-text); }
        
        .saver-log-content-inline {
          max-height: 150px; overflow-y: auto; background: var(--saver-log-bg);
          border-radius: 8px; padding: 8px; font-size: 11px;
          font-family: 'Consolas', 'Monaco', monospace;
        }
        .saver-log-item-inline {
          padding: 3px 0; border-bottom: 1px solid var(--saver-border); color: var(--saver-log-text);
        }
        .saver-log-item-inline:last-child { border-bottom: none; }
        .saver-log-time-inline { color: #9ca3af; margin-right: 6px; }
      `);
    },

    createFloatingButton() {
      const btn = document.createElement('button');
      btn.id = 'chatgpt-saver-btn';
      btn.innerHTML = LOGO_SVG;
      btn.title = 'ChatGPT 对话保存助手';
      btn.onclick = () => this.togglePanel();
      document.body.appendChild(btn);
    },

    createToast() {
      const toast = document.createElement('div');
      toast.id = 'chatgpt-saver-toast';
      document.body.appendChild(toast);
      this.toast = toast;
    },

    showToast(message, type = 'info', duration = 3000) {
      if (!this.toast) return;
      if (this.toastTimer) clearTimeout(this.toastTimer);
      this.toast.textContent = message;
      this.toast.className = 'show ' + type;
      if (duration > 0) {
        this.toastTimer = setTimeout(() => { this.toast.className = ''; }, duration);
      }
    },

    hideToast() {
      if (this.toast) this.toast.className = '';
      if (this.toastTimer) { clearTimeout(this.toastTimer); this.toastTimer = null; }
    },

    createPanel() {
      const panel = document.createElement('div');
      panel.id = 'chatgpt-saver-panel';
      panel.innerHTML = `
        <div class="saver-panel-header">
          <h3>💬 ChatGPT 对话保存助手</h3>
          <p>自动保存您的智慧对话</p>
          <button id="saver-theme-toggle" style="position: absolute; top: 16px; right: 16px; background: none; border: none; cursor: pointer; font-size: 20px; padding: 0; line-height: 1;">🌞</button>
        </div>
        <div class="saver-panel-content">
          <div class="saver-format-group">
            <div class="saver-format-btn active" data-format="html">
              📄<span>HTML</span>
            </div>
            <div class="saver-format-btn active" data-format="md">
              📝<span>Markdown</span>
            </div>
            <div class="saver-format-btn active" data-format="pdf">
              📕<span>PDF</span>
            </div>
          </div>
          <button class="saver-action-btn" id="saver-export-btn">💾 立即导出当前对话</button>
          <button class="saver-action-btn secondary" id="saver-select-folder">📁 选择保存文件夹</button>
          <div class="saver-folder-status" id="saver-folder-status" style="margin-bottom: 8px; font-size: 12px; color: #666;">
            保存位置: <span id="saver-folder-name" style="color: var(--saver-active-color);">浏览器下载</span>
          </div>
          <button class="saver-action-btn secondary" id="saver-auto-toggle" style="font-size: 12px; padding: 8px;">
            ${CONFIG.autoSave ? '🔵 自动保存: 开启' : '⚪ 自动保存: 关闭'}
          </button>
          <button class="saver-action-btn secondary" id="saver-log-toggle" style="font-size: 12px; padding: 8px;">
            ${CONFIG.showLogPanel ? '📋 显示日志弹框: 开启' : '📋 显示日志弹框: 关闭'}
          </button>
          <div class="saver-status" id="saver-observer-status">
            状态: <span id="saver-observer-text">未启动</span>
          </div>
          
          <!-- 内嵌日志区域 -->
          <div class="saver-log-area" id="saver-log-area">
            <div class="saver-log-header-inline loading" id="saver-log-header">
              <span id="saver-log-icon">⏳</span>
              <span id="saver-log-title">正在导出...</span>
            </div>
            <div class="saver-log-content-inline" id="saver-log-content"></div>
          </div>
        </div>
      `;
      document.body.appendChild(panel);
      this.panel = panel;

      // 初始化主题
      this.theme = GM_getValue('theme', 'day');
      this.applyTheme();

      // 绑定主题切换事件
      document.getElementById('saver-theme-toggle').onclick = () => this.toggleTheme();

      // 绑定事件
      panel.querySelectorAll('.saver-format-btn').forEach(btn => {
        btn.onclick = () => {
          btn.classList.toggle('active');
          const format = btn.dataset.format;
          CONFIG.formats[format] = btn.classList.contains('active');
          GM_setValue('formats', CONFIG.formats);
        };
      });

      // 手动点击强制导出（不检查是否已存在）
      document.getElementById('saver-export-btn').onclick = () => Exporter.exportNow(true);

      document.getElementById('saver-select-folder').onclick = async () => {
        const handle = await Utils.selectFolder();
        if (handle) {
          this.updateFolderStatus(handle.name);
          alert(`已选择文件夹: ${handle.name}\n\n导出的文件将保存到该文件夹。\n下次访问时会自动恢复。`);
        }
      };

      document.getElementById('saver-auto-toggle').onclick = (e) => {
        CONFIG.autoSave = !CONFIG.autoSave;
        GM_setValue('autoSave', CONFIG.autoSave);
        e.target.textContent = CONFIG.autoSave ? '🔵 自动保存: 开启' : '⚪ 自动保存: 关闭';
        if (CONFIG.autoSave) {
          startAutoSave();
        } else {
          Observer.stop();
        }
        this.updateStatus();
      };

      document.getElementById('saver-log-toggle').onclick = (e) => {
        CONFIG.showLogPanel = !CONFIG.showLogPanel;
        GM_setValue('showLogPanel', CONFIG.showLogPanel);
        e.target.textContent = CONFIG.showLogPanel ? '📋 显示日志弹框: 开启' : '📋 显示日志弹框: 关闭';
      };
    },

    createLogPanel() {
      // 日志现在内嵌在主面板中，不需要单独创建
      this.logArea = document.getElementById('saver-log-area');
      this.logHeader = document.getElementById('saver-log-header');
      this.logIcon = document.getElementById('saver-log-icon');
      this.logTitle = document.getElementById('saver-log-title');
      this.logContent = document.getElementById('saver-log-content');
    },

    togglePanel() {
      this.panel.classList.toggle('show');
    },

    toggleTheme() {
      this.theme = this.theme === 'day' ? 'night' : 'day';
      GM_setValue('theme', this.theme);
      this.applyTheme();
    },

    applyTheme() {
      const panel = document.getElementById('chatgpt-saver-panel');
      const btn = document.getElementById('saver-theme-toggle');
      if (panel) {
        if (this.theme === 'night') {
          panel.classList.add('saver-dark');
          if(btn) btn.textContent = '🌙';
        } else {
          panel.classList.remove('saver-dark');
          if(btn) btn.textContent = '🌞';
        }
      }
    },

    updateStatus() {
      const statusText = document.getElementById('saver-observer-text');
      if (statusText) {
        statusText.textContent = Observer.isWatching ? '监听中' : '未启动';
        statusText.className = Observer.isWatching ? 'active' : '';
      }
    },

    showLog() {
      // 如果关闭了日志弹框显示，则不弹出
      if (!CONFIG.showLogPanel) {
        return;
      }
      // 确保面板显示
      if (!this.panel.classList.contains('show')) {
        this.panel.classList.add('show');
      }
      // 显示日志区域
      if (this.logArea) {
        this.logArea.classList.add('show');
        this.logContent.innerHTML = '';
        this.setLogStatus('loading', '正在导出...');
      }
    },

    hideLog() {
      // 不隐藏，保持显示状态
    },

    addLog(message) {
      // 如果关闭了日志弹框显示，则不添加日志
      if (!CONFIG.showLogPanel) return;
      if (!this.logContent) return;
      const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
      const item = document.createElement('div');
      item.className = 'saver-log-item-inline';
      item.innerHTML = `<span class="saver-log-time-inline">${time}</span>${message}`;
      this.logContent.appendChild(item);
      this.logContent.scrollTop = this.logContent.scrollHeight;
    },

    setLogStatus(type, title) {
      if (!this.logHeader) return;
      this.logHeader.className = 'saver-log-header-inline ' + type;
      if (this.logIcon) {
        this.logIcon.textContent = type === 'success' ? '✅' : (type === 'error' ? '❌' : '⏳');
      }
      if (this.logTitle) {
        this.logTitle.textContent = title;
      }
    },

    logComplete(title, subtitle) {
      this.setLogStatus('success', `${title} - ${subtitle}`);
    },

    logError(message) {
      this.setLogStatus('error', `导出失败: ${message}`);
    },

    // 清空并隐藏日志区域
    clearLog() {
      if (this.logArea) {
        this.logArea.classList.remove('show');
      }
      if (this.logContent) {
        this.logContent.innerHTML = '';
      }
    },

    // 更新文件夹状态显示
    updateFolderStatus(folderName, needsReauth = false) {
      const folderNameEl = document.getElementById('saver-folder-name');
      if (folderNameEl) {
        if (needsReauth) {
          folderNameEl.innerHTML = `🔒 ${folderName} (点击导出重新授权)`;
          folderNameEl.style.color = '#f59e0b';
        } else {
          folderNameEl.innerHTML = `📂 ${folderName}`;
          folderNameEl.style.removeProperty('color'); // 使用 CSS 变量
        }
      }
    }
  };

  // 等待授权的句柄（需要重新授权时使用）
  let pendingReauthHandle = null;

  // ==================== 导出器 ====================
  const Exporter = {
    // 强制导出（不检查是否已存在）
    async exportNow(forceExport = false) {
      const conversation = Parser.parseConversation();
      if (!conversation.messages.length) {
        alert('没有找到可导出的对话内容');
        return;
      }

      // 如果有等待重新授权的句柄，先请求权限
      if (pendingReauthHandle && !savedFolderHandle) {
        UI.showLog();
        UI.addLog('🔒 请求文件夹访问权限...');
        const granted = await Utils.requestPermissionForSavedHandle(pendingReauthHandle);
        if (granted) {
          UI.addLog('✅ 文件夹权限已恢复');
          UI.updateFolderStatus(pendingReauthHandle.name, false);
          pendingReauthHandle = null;
        } else {
          UI.addLog('⚠️ 权限请求被拒绝，将使用浏览器下载');
          pendingReauthHandle = null;
          CONFIG.saveMode = 'download';
        }
      }

      UI.showLog();
      
      const title = conversation.title;
      const workspaceName = Parser.getWorkspaceName();
      const currentMessageCount = conversation.messages.length;
      
      UI.addLog(`📝 对话: ${title}`);
      UI.addLog(`📁 工作空间: ${workspaceName}`);
      UI.addLog(`💬 当前消息数: ${currentMessageCount}`);

      // 如果使用文件夹模式，检查是否需要更新
      if (CONFIG.saveMode === 'folder' && savedFolderHandle && !forceExport) {
        UI.addLog('🔍 检查是否需要更新...');
        const checkResult = await Utils.checkConversationNeedsUpdate(
          savedFolderHandle,
          workspaceName,
          title,
          currentMessageCount
        );
        
        if (!checkResult.needsUpdate) {
          UI.addLog(`✅ 对话已是最新: ${checkResult.path}`);
          UI.addLog(`💬 已保存 ${checkResult.savedCount} 条消息，当前 ${checkResult.currentCount} 条`);
          UI.logComplete('跳过', '对话无新消息，无需更新');
          UI.showToast('😊 无需更新对话哦', 'skip', 3000);
          return;
        }
        
        // 显示正在保存的提示
        UI.showToast('💾 正在保存更新文件...', 'saving', 0);
        
        // 需要更新
        if (checkResult.reason === 'updated') {
          UI.addLog(`🔄 检测到新消息: ${checkResult.savedCount} → ${checkResult.currentCount}`);
        } else if (checkResult.reason === 'new') {
          UI.addLog('🆕 新对话，将创建保存');
        } else {
          UI.addLog(`📦 需要保存 (原因: ${checkResult.reason})`);
        }
      }

      let htmlContent = null;
      let mdContent = null;
      let pdfBlob = null;

      try {
        // 生成所有选中的格式
        if (CONFIG.formats.html) {
          UI.addLog('📦 生成 HTML...');
          htmlContent = HTMLExporter.export();
          if (htmlContent) UI.addLog('✅ HTML 生成完成');
        }

        if (CONFIG.formats.md) {
          UI.addLog('📦 生成 Markdown...');
          mdContent = MarkdownExporter.export();
          if (mdContent) UI.addLog('✅ Markdown 生成完成');
        }

        if (CONFIG.formats.pdf) {
          UI.addLog('📦 生成 PDF (可能需要几秒钟)...');
          pdfBlob = await PDFExporter.export();
          if (pdfBlob) {
            UI.addLog('✅ PDF 生成完成');
          } else {
            UI.addLog('⚠️ PDF 生成失败，已跳过');
          }
        }

        // 检查是否有内容需要保存
        if (!htmlContent && !mdContent && !pdfBlob) {
          UI.addLog('ℹ️ 没有需要保存的内容');
          UI.logComplete('完成', '没有选中任何格式');
          return;
        }

        // 保存文件
        UI.addLog('💾 开始保存文件...');
        
        if (CONFIG.saveMode === 'folder' && savedFolderHandle) {
          // 保存到分层目录（覆盖旧文件）
          const result = await Utils.saveConversationToFolder(
            savedFolderHandle,
            workspaceName,
            title,
            htmlContent,
            mdContent,
            pdfBlob,
            CONFIG.formats,
            null  // 不指定 missingFormats，全部保存
          );
          
          if (result.success) {
            UI.addLog(`✅ 文件已保存到: ${result.path}`);
            UI.logComplete('保存成功', `${result.saved.join(', ')} → ${result.path}`);
            UI.showToast('✅ 已经成功保存啦', 'success', 3000);
            const count = GM_getValue('savedCount', 0) + 1;
            GM_setValue('savedCount', count);
          } else {
            UI.logError(result.error || '保存失败');
            UI.hideToast();
          }
        } else {
          // 回退到浏览器下载
          const saved = [];
          const timestamp = Utils.getTimestamp();
          const safeWorkspace = Utils.sanitizeFileName(workspaceName);
          const safeTitle = Utils.sanitizeFileName(title);
          const baseName = `${safeWorkspace}_${safeTitle}_${timestamp}`;
          
          if (htmlContent) {
            Utils.downloadFile(htmlContent, `${baseName}.html`, 'text/html');
            saved.push('HTML');
          }
          if (mdContent) {
            Utils.downloadFile(mdContent, `${baseName}.md`, 'text/markdown');
            saved.push('MD');
          }
          if (pdfBlob) {
            Utils.downloadFile(pdfBlob, `${baseName}.pdf`, 'application/pdf');
            saved.push('PDF');
          }
          
          if (saved.length > 0) {
            UI.logComplete('下载成功', `已下载: ${saved.join(', ')}`);
            UI.showToast('✅ 已经成功保存啦', 'success', 3000);
            const count = GM_getValue('savedCount', 0) + 1;
            GM_setValue('savedCount', count);
          } else {
            UI.logError('没有成功导出任何格式');
            UI.hideToast();
          }
        }
      } catch (error) {
        console.error('[ChatGPT Saver] 导出失败:', error);
        UI.logError(error.message);
        UI.hideToast();
      }
    }
  };

  // ==================== 自动保存回调 ====================
  const autoSaveCallback = async () => {
    if (!CONFIG.autoSave) {
      console.log('[ChatGPT Saver] 自动保存已关闭，跳过');
      return;
    }

    console.log('[ChatGPT Saver] 触发自动保存...');
    await Exporter.exportNow();
  };

  // ==================== URL 变化监听 ====================
  let lastURL = window.location.href;
  let urlCheckInterval = null;

  function startURLWatcher() {
    if (urlCheckInterval) return;
    
    urlCheckInterval = setInterval(() => {
      const currentURL = window.location.href;
      if (currentURL !== lastURL) {
        console.log('[ChatGPT Saver] 检测到URL变化:', currentURL);
        lastURL = currentURL;
        
        // 清空日志区域
        if (UI.clearLog) {
          UI.clearLog();
        }
        
        // 重置 Observer 状态（不停止，只重置 hash）
        Observer.reset();
        
        // 确保监听器运行
        if (!Observer.isWatching) {
          console.log('[ChatGPT Saver] 监听器未运行，重新启动...');
          Observer.start(autoSaveCallback);
        }
      }
    }, 500); // 更频繁的检查
  }

  // 使用 History API 监听
  function setupHistoryListener() {
    // 拦截 pushState 和 replaceState
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;

    history.pushState = function(...args) {
      originalPushState.apply(this, args);
      window.dispatchEvent(new Event('locationchange'));
    };

    history.replaceState = function(...args) {
      originalReplaceState.apply(this, args);
      window.dispatchEvent(new Event('locationchange'));
    };

    // 监听 popstate 和 自定义的 locationchange 事件
    window.addEventListener('popstate', () => {
      window.dispatchEvent(new Event('locationchange'));
    });

    window.addEventListener('locationchange', () => {
      console.log('[ChatGPT Saver] History API 检测到导航变化');
      const currentURL = window.location.href;
      if (currentURL !== lastURL) {
        lastURL = currentURL;
        
        if (UI.clearLog) {
          UI.clearLog();
        }
        
        Observer.reset();
        
        if (!Observer.isWatching) {
          Observer.start(autoSaveCallback);
        }
      }
    });
  }

  // ==================== 初始化 ====================
  async function init() {
    console.log('[ChatGPT Saver] 油猴脚本加载中...');
    console.log('[ChatGPT Saver] 当前URL:', window.location.href);
    console.log('[ChatGPT Saver] document.readyState:', document.readyState);

    // 加载保存的配置
    const savedFormats = GM_getValue('formats', null);
    if (savedFormats) CONFIG.formats = savedFormats;

    const savedAutoSave = GM_getValue('autoSave', null);
    if (savedAutoSave !== null) CONFIG.autoSave = savedAutoSave;

    // 尝试恢复文件夹访问权限
    const restoreResult = await Utils.tryRestoreAccess();
    const savedFolderName = GM_getValue('savedFolderName', null);
    
    if (restoreResult.success) {
      console.log('[ChatGPT Saver] 文件夹访问已恢复');
    } else if (restoreResult.needsReauth && restoreResult.handle) {
      pendingReauthHandle = restoreResult.handle;
      console.log('[ChatGPT Saver] 文件夹需要重新授权');
    }

    // 初始化UI
    const initUI = () => {
      console.log('[ChatGPT Saver] 开始初始化UI...');
      try {
        UI.init();
        
        if (restoreResult.success && savedFolderHandle) {
          UI.updateFolderStatus(savedFolderHandle.name, false);
        } else if (restoreResult.needsReauth && savedFolderName) {
          UI.updateFolderStatus(savedFolderName, true);
        }
        
        console.log('[ChatGPT Saver] UI初始化完成');
      } catch (e) {
        console.error('[ChatGPT Saver] UI初始化失败:', e);
      }
    };

    // 启动监听器
    const startObserver = () => {
      console.log('[ChatGPT Saver] 启动全局监听器...');
      Observer.start(autoSaveCallback);
      
      // 启动 URL 监听
      setupHistoryListener();
      startURLWatcher();
    };

    // 确保DOM已加载
    if (document.body) {
      initUI();
      // 稍微延迟启动监听器，等待页面完全加载
      setTimeout(startObserver, 1000);
    } else {
      document.addEventListener('DOMContentLoaded', () => {
        initUI();
        setTimeout(startObserver, 1000);
      });
    }
  }

  // 延迟执行以确保页面已加载
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    setTimeout(init, 500);
  }

})();
