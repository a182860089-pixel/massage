// ==UserScript==
// @name         ChatGPT 对话保存助手
// @namespace    https://github.com/a182860089-pixel/massage
// @version      2.4
// @description  自动保存 ChatGPT 对话，支持导出为 HTML、Markdown、PDF 格式，支持上下文导出与导入
// @author       ChatGPT Saver
// @match        https://chat.openai.com/*
// @match        https://chatgpt.com/*
// @match        https://*.openai.com/*
// @match        https://*.chatgpt.com/*
// @icon         https://chat.openai.com/favicon.ico
// @updateURL    https://mirror.ghproxy.com/https://raw.githubusercontent.com/a182860089-pixel/massage/main/chatgpt-saver.user.js
// @downloadURL  https://mirror.ghproxy.com/https://raw.githubusercontent.com/a182860089-pixel/massage/main/chatgpt-saver.user.js
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @grant        GM_download
// @grant        GM_notification
// @grant        GM_xmlhttpRequest
// @connect      raw.githubusercontent.com
// @connect      mirror.ghproxy.com
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
    saveMode: 'download', // 'download' 或 'folder'
    // 更新检查配置
    updateCheckInterval: 3 * 24 * 60 * 60 * 1000, // 3天（毫秒）
    updateURL: 'https://mirror.ghproxy.com/https://raw.githubusercontent.com/a182860089-pixel/massage/main/chatgpt-saver.user.js',
    currentVersion: '2.4'
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

  // ==================== 附件管理器 ====================
  const AttachmentManager = {
    attachmentModal: null,
    detectedFiles: [],
    selectedFiles: [],
    resolveCallback: null,
    collectionFolderHandle: null,  // 文件收集文件夹句柄
    collectionFiles: [],  // 收集文件夹中的文件列表
    
    // 初始化：尝试恢复收集文件夹
    async init() {
      // 从 IndexedDB 恢复文件夹句柄
      try {
        const db = await Utils.openDB();
        const handle = await new Promise((resolve) => {
          const tx = db.transaction('fileHandles', 'readonly');
          const store = tx.objectStore('fileHandles');
          const request = store.get('collectionFolderHandle');
          request.onsuccess = () => resolve(request.result || null);
          request.onerror = () => resolve(null);
        });
        
        if (handle) {
          const permission = await handle.queryPermission({ mode: 'read' });
          if (permission === 'granted') {
            this.collectionFolderHandle = handle;
            console.log('[ChatGPT Saver] 收集文件夹已恢复:', handle.name);
          }
        }
      } catch (e) {
        console.log('[ChatGPT Saver] 恢复收集文件夹失败:', e.message);
      }
    },
    
    // 选择收集文件夹
    async selectCollectionFolder() {
      if (!Utils.isFileSystemSupported()) {
        alert('您的浏览器不支持文件夹选择功能');
        return null;
      }
      try {
        const handle = await window.showDirectoryPicker({ mode: 'read' });
        this.collectionFolderHandle = handle;
        
        // 保存到 IndexedDB
        const db = await Utils.openDB();
        await new Promise((resolve, reject) => {
          const tx = db.transaction('fileHandles', 'readwrite');
          const store = tx.objectStore('fileHandles');
          store.put(handle, 'collectionFolderHandle');
          tx.oncomplete = () => resolve(true);
          tx.onerror = () => reject(tx.error);
        });
        
        console.log('[ChatGPT Saver] 收集文件夹已设置:', handle.name);
        return handle;
      } catch (e) {
        if (e.name !== 'AbortError') {
          console.error('[ChatGPT Saver] 选择收集文件夹失败:', e);
        }
        return null;
      }
    },
    
    // 扫描收集文件夹中的文件
    async scanCollectionFolder() {
      if (!this.collectionFolderHandle) {
        return [];
      }
      
      const files = [];
      try {
        // 检查权限
        const permission = await this.collectionFolderHandle.queryPermission({ mode: 'read' });
        if (permission !== 'granted') {
          const request = await this.collectionFolderHandle.requestPermission({ mode: 'read' });
          if (request !== 'granted') {
            console.log('[ChatGPT Saver] 收集文件夹权限被拒绝');
            return [];
          }
        }
        
        for await (const entry of this.collectionFolderHandle.values()) {
          if (entry.kind === 'file') {
            const file = await entry.getFile();
            files.push({
              name: file.name,
              handle: entry,
              file: file,
              size: file.size,
              type: this.guessFileType(file.name),
              icon: this.getFileIcon(this.guessFileType(file.name))
            });
          }
        }
        
        // 按文件名排序
        files.sort((a, b) => a.name.localeCompare(b.name));
        console.log(`[ChatGPT Saver] 收集文件夹中有 ${files.length} 个文件`);
      } catch (e) {
        console.error('[ChatGPT Saver] 扫描收集文件夹失败:', e);
      }
      
      this.collectionFiles = files;
      return files;
    },

    // 扫描页面上的附件元素
    scanAttachments() {
      console.log('[ChatGPT Saver] ===== 开始扫描附件 =====');
      const attachments = [];
      
      // 首先尝试通过消息内容区域查找附件
      const userMessages = document.querySelectorAll('[data-message-author-role="user"]');
      console.log(`[ChatGPT Saver] 找到 ${userMessages.length} 条用户消息`);
      
      for (const msgEl of userMessages) {
        // 在每条用户消息中查找附件
        // ChatGPT 附件通常包含在消息元素内部
        const parent = msgEl.closest('[class*="group"]') || msgEl.parentElement?.parentElement;
        if (parent) {
          // 查找包含文件名的元素
          const fileElements = parent.querySelectorAll('[class*="truncate"], [class*="overflow-hidden"], [class*="text-ellipsis"]');
          for (const el of fileElements) {
            const text = el.textContent?.trim();
            // 检查是否像文件名（包含扩展名或特定模式）
            if (text && text.length < 200 && (text.match(/\.[a-zA-Z0-9]{2,5}$/) || text.match(/\.[a-zA-Z0-9]{2,5}\.\.\./))) {
              console.log(`[ChatGPT Saver] 通过消息区域找到可能的文件: "${text}"`);
              const cleanName = text.replace(/\.\.\.\s*$/, '').trim();
              if (cleanName && !attachments.some(a => a.name === cleanName)) {
                attachments.push({
                  name: cleanName,
                  type: this.guessFileType(cleanName),
                  icon: this.getFileIcon(this.guessFileType(cleanName))
                });
              }
            }
          }
        }
      }
      
      // 查找所有可能的附件元素
      const selectors = [
        '[data-testid="attachment"]',
        '[data-testid="file-thumbnail"]',
        '[class*="attachment"]',
        '[class*="file"][class*="preview"]',
        'img[src*="files.oaiusercontent.com"]',
        'a[href*="/mnt/data/"]',
        'a[download]',
        // 更多 ChatGPT 文件相关选择器
        '[data-testid*="file"]',
        '[aria-label*="file"]',
        '[aria-label*="文件"]',
        '.uploaded-file',
        '[class*="upload"]',
        // 新增：文档图标相关
        '[class*="document"]',
        'button[class*="group"]',
        // 查找包含文件名模式的元素
        '[title*="."]'
      ];
      
      for (const selector of selectors) {
        try {
          const elements = document.querySelectorAll(selector);
          console.log(`[ChatGPT Saver] 选择器 "${selector}" 找到 ${elements.length} 个元素`);
          for (const el of elements) {
            console.log(`[ChatGPT Saver]   - 元素:`, el.tagName, el.className?.substring(0, 50), el.getAttribute('data-testid'));
            const attachment = this.parseAttachmentElement(el);
            if (attachment) {
              console.log(`[ChatGPT Saver]   → 解析到文件: ${attachment.name}`);
              if (!attachments.some(a => a.name === attachment.name)) {
                attachments.push(attachment);
              }
            }
          }
        } catch (e) {
          console.log(`[ChatGPT Saver] 选择器 "${selector}" 错误:`, e.message);
        }
      }
      
      console.log(`[ChatGPT Saver] ===== 扫描完成，共 ${attachments.length} 个附件 =====`);
      if (attachments.length > 0) {
        console.log('[ChatGPT Saver] 附件列表:', attachments.map(a => a.name));
      }
      return attachments;
    },
    
    // 解析附件元素
    parseAttachmentElement(element) {
      // 尝试从不同属性提取文件名
      let filename = null;
      let fileType = 'unknown';
      
      // 从 download 属性
      if (element.hasAttribute('download')) {
        filename = element.getAttribute('download');
      }
      
      // 从 alt 或 title
      if (!filename) {
        filename = element.getAttribute('alt') || element.getAttribute('title');
      }
      
      // 从 href 或 src
      if (!filename) {
        const url = element.getAttribute('href') || element.getAttribute('src');
        if (url) {
          const match = url.match(/\/([^\/]+\.[a-zA-Z0-9]{2,5})(?:\?|$)/);
          if (match) filename = match[1];
        }
      }
      
      // 从内部文本
      if (!filename) {
        const textContent = element.textContent?.trim();
        if (textContent && textContent.length < 100 && textContent.match(/\.[a-zA-Z0-9]{2,5}$/)) {
          filename = textContent;
        }
      }
      
      if (!filename) return null;
      
      // 清理文件名（去除末尾的 ... 等）
      filename = filename.replace(/\.\.\.\s*$/, '').trim();
      
      // 识别文件类型
      const ext = filename.split('.').pop()?.toLowerCase();
      if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) {
        fileType = 'image';
      } else if (['pdf'].includes(ext)) {
        fileType = 'pdf';
      } else if (['txt', 'md', 'json', 'csv'].includes(ext)) {
        fileType = 'document';
      } else if (['zip', 'rar', '7z'].includes(ext)) {
        fileType = 'archive';
      } else if (['py', 'js', 'java', 'cpp', 'ts'].includes(ext)) {
        fileType = 'code';
      }
      
      return {
        name: filename,
        type: fileType,
        icon: this.getFileIcon(fileType)
      };
    },
    
    // 获取文件图标
    getFileIcon(fileType) {
      const icons = {
        image: '🖼️',
        pdf: '📕',
        document: '📄',
        archive: '📦',
        code: '💻',
        unknown: '📎'
      };
      return icons[fileType] || icons.unknown;
    },
    
    // 根据文件名猜测文件类型
    guessFileType(filename) {
      if (!filename) return 'unknown';
      const ext = filename.split('.').pop()?.toLowerCase();
      if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'].includes(ext)) {
        return 'image';
      } else if (['pdf'].includes(ext)) {
        return 'pdf';
      } else if (['txt', 'md', 'json', 'csv', 'doc', 'docx', 'xls', 'xlsx'].includes(ext)) {
        return 'document';
      } else if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) {
        return 'archive';
      } else if (['py', 'js', 'java', 'cpp', 'ts', 'html', 'css', 'c', 'h'].includes(ext)) {
        return 'code';
      }
      return 'unknown';
    },
    
    // 显示附件选择器弹窗
    async showAttachmentPicker(detectedFiles) {
      return new Promise(async (resolve) => {
        this.detectedFiles = detectedFiles;
        this.selectedFiles = [];
        this.resolveCallback = resolve;
        
        // 扫描收集文件夹
        await this.scanCollectionFolder();
        
        this.createAttachmentModal();
        this.renderFileList();
        this.attachmentModal.classList.add('show');
      });
    },
    
    // 创建附件选择器弹窗
    createAttachmentModal() {
      if (this.attachmentModal) {
        // 已存在，只更新内容
        return;
      }
      
      const modal = document.createElement('div');
      modal.className = 'saver-attachment-modal';
      modal.innerHTML = `
        <div class="saver-attachment-dialog">
          <div class="saver-attachment-header">
            <h3>📎 保存附件文件</h3>
            <p>检测到对话中的附件，请选择本地源文件一起保存</p>
          </div>
          <div class="saver-attachment-content">
            <!-- 收集文件夹区域 -->
            <div id="saver-collection-area" class="saver-collection-area">
              <div class="saver-collection-header">
                <span>📂 收集文件夹</span>
                <button class="saver-collection-set-btn" id="saver-set-collection">设置文件夹</button>
              </div>
              <div id="saver-collection-files" class="saver-collection-files"></div>
            </div>
            
            <!-- 检测到的附件列表 -->
            <div class="saver-detected-header">检测到的附件：</div>
            <div id="saver-attachment-list"></div>
            
            <div class="saver-attachment-hint">
              💡 <strong>提示：</strong><br/>
              • 建议将常用附件放到「收集文件夹」，可快速选择<br/>
              • 也可以点击「浏览...」从任意位置选择文件<br/>
              • Windows 搜索：按 Win 键，输入文件名即可查找
            </div>
          </div>
          <div class="saver-attachment-footer">
            <button class="saver-import-btn secondary" id="saver-attach-skip">跳过</button>
            <button class="saver-import-btn primary" id="saver-attach-confirm" disabled>保存已选文件</button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);
      this.attachmentModal = modal;
      
      // 绑定事件
      modal.querySelector('#saver-attach-skip').onclick = () => this.closeModal([]);
      modal.querySelector('#saver-attach-confirm').onclick = () => this.closeModal(this.selectedFiles);
      modal.querySelector('#saver-set-collection').onclick = () => this.handleSetCollectionFolder();
      modal.onclick = (e) => {
        if (e.target === modal) this.closeModal([]);
      };
    },
    
    // 设置收集文件夹
    async handleSetCollectionFolder() {
      const handle = await this.selectCollectionFolder();
      if (handle) {
        await this.scanCollectionFolder();
        this.renderCollectionFiles();
        UI.showToast(`✅ 收集文件夹已设置: ${handle.name}`, 'success', 3000);
      }
    },
    
    // 渲染收集文件夹中的文件
    renderCollectionFiles() {
      const container = document.getElementById('saver-collection-files');
      if (!container) return;
      
      if (!this.collectionFolderHandle) {
        container.innerHTML = `
          <div class="saver-collection-empty">
            未设置收集文件夹。请点击上方「设置文件夹」按钮选择一个文件夹。
          </div>
        `;
        return;
      }
      
      if (this.collectionFiles.length === 0) {
        container.innerHTML = `
          <div class="saver-collection-empty">
            📂 ${this.collectionFolderHandle.name}<br/>
            <span style="font-size: 11px; opacity: 0.7;">文件夹为空，请先将附件文件复制到该文件夹</span>
          </div>
        `;
        return;
      }
      
      container.innerHTML = `
        <div class="saver-collection-folder-name">📂 ${this.collectionFolderHandle.name}</div>
        <div class="saver-collection-list">
          ${this.collectionFiles.map((file, index) => `
            <div class="saver-collection-file" data-index="${index}" title="点击选择此文件">
              <span class="saver-collection-file-icon">${file.icon}</span>
              <span class="saver-collection-file-name">${file.name}</span>
              <span class="saver-collection-file-size">${this.formatFileSize(file.size)}</span>
            </div>
          `).join('')}
        </div>
      `;
      
      // 绑定点击事件
      container.querySelectorAll('.saver-collection-file').forEach(el => {
        el.addEventListener('click', () => {
          const index = parseInt(el.dataset.index);
          const file = this.collectionFiles[index];
          if (file) {
            this.selectCollectionFile(file);
          }
        });
      });
    },
    
    // 选择收集文件夹中的文件
    selectCollectionFile(collectionFile) {
      // 找到第一个未选择的附件槽位
      let targetIndex = this.selectedFiles.findIndex((f, i) => f === undefined && i < this.detectedFiles.length);
      if (targetIndex === -1) {
        // 所有槽位都已填充，替换第一个
        targetIndex = 0;
      }
      
      // 设置文件
      this.handleFileSelected(targetIndex, collectionFile.file);
      
      // 高亮显示已选择
      const collectionFileEl = document.querySelector(`.saver-collection-file[data-index="${this.collectionFiles.indexOf(collectionFile)}"]`);
      if (collectionFileEl) {
        collectionFileEl.classList.add('selected');
      }
    },
    
    // 格式化文件大小
    formatFileSize(bytes) {
      if (bytes < 1024) return bytes + ' B';
      if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
      return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    },
    
    // 渲染文件列表
    renderFileList() {
      // 先渲染收集文件夹
      this.renderCollectionFiles();
      
      const listEl = document.getElementById('saver-attachment-list');
      if (!listEl) return;
      
      if (this.detectedFiles.length === 0) {
        listEl.innerHTML = '<div style="text-align: center; padding: 20px; color: #888;">未检测到附件</div>';
        return;
      }
      
      listEl.innerHTML = this.detectedFiles.map((file, index) => `
        <div class="saver-attachment-item" data-index="${index}">
          <span class="saver-attach-icon">${file.icon}</span>
          <span class="saver-attach-name" title="${file.name}">${file.name}</span>
          <input type="file" class="saver-attach-input" id="saver-attach-file-${index}" style="display: none;" />
          <button class="saver-attach-select-btn" data-index="${index}">浏览...</button>
          <button class="saver-attach-copy-btn" data-name="${file.name}" title="复制文件名用于搜索">📋</button>
          <span class="saver-attach-status" id="saver-attach-status-${index}">未选择</span>
        </div>
      `).join('');
      
      // 绑定选择按钮事件
      listEl.querySelectorAll('.saver-attach-select-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const index = parseInt(e.target.dataset.index);
          this.triggerFileSelect(index);
        });
      });
      
      // 绑定复制按钮事件
      listEl.querySelectorAll('.saver-attach-copy-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const name = e.target.dataset.name;
          navigator.clipboard.writeText(name).then(() => {
            UI.showToast(`✅ 已复制文件名: ${name}`, 'success', 2000);
          });
        });
      });
      
      // 绑定文件输入事件
      listEl.querySelectorAll('.saver-attach-input').forEach((input, index) => {
        input.addEventListener('change', (e) => {
          this.handleFileSelected(index, e.target.files[0]);
        });
      });
    },
    
    // 触发文件选择
    triggerFileSelect(index) {
      const input = document.getElementById(`saver-attach-file-${index}`);
      if (input) input.click();
    },
    
    // 处理文件选择
    handleFileSelected(index, file) {
      if (!file) return;
      
      // 更新已选文件列表
      this.selectedFiles[index] = file;
      
      // 更新状态显示
      const statusEl = document.getElementById(`saver-attach-status-${index}`);
      if (statusEl) {
        statusEl.textContent = `✅ ${file.name}`;
        statusEl.style.color = '#10a37f';
      }
      
      // 检查是否至少选择了一个文件
      const hasSelected = this.selectedFiles.some(f => f !== undefined);
      const confirmBtn = document.getElementById('saver-attach-confirm');
      if (confirmBtn) {
        confirmBtn.disabled = !hasSelected;
      }
    },
    
    // 关闭弹窗
    closeModal(selectedFiles) {
      if (this.attachmentModal) {
        this.attachmentModal.classList.remove('show');
      }
      if (this.resolveCallback) {
        // 过滤掉未选择的文件
        const files = selectedFiles.filter(f => f !== undefined);
        this.resolveCallback(files);
        this.resolveCallback = null;
      }
    }
  };

  // ==================== 上下文 JSON 导出器 ====================
  const ContextExporter = {
    // 分片配置
    CHUNK_CONFIG: {
      MAX_TOKENS_PER_CHUNK: 80000,  // 每个分片最大 80k tokens（留 buffer 给 AI 响应）
      TOKENS_PER_CHAR: 0.75,        // 中文约 0.75 token/字符
      MAX_MESSAGES_PER_CHUNK: 25    // 或者按消息数分（25条）
    },

    // 将 HTML 内容转换为纯文本 + 保留代码块
    htmlToPlainText(html) {
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = html;
      
      // 处理代码块：保留 ```language 格式
      tempDiv.querySelectorAll('pre code').forEach(codeEl => {
        const pre = codeEl.closest('pre');
        if (pre) {
          let language = '';
          const langClass = Array.from(codeEl.classList).find(c => c.startsWith('language-'));
          if (langClass) language = langClass.replace('language-', '');
          const codeText = codeEl.textContent;
          pre.textContent = '```' + language + '\n' + codeText + '\n```';
        }
      });
      
      // 处理行内代码
      tempDiv.querySelectorAll('code').forEach(codeEl => {
        if (!codeEl.closest('pre')) {
          codeEl.textContent = '`' + codeEl.textContent + '`';
        }
      });
      
      // 移除按钮等非内容元素
      tempDiv.querySelectorAll('button, svg, [class*="copy"]').forEach(el => el.remove());
      
      return tempDiv.textContent.trim();
    },

    // 估算 tokens 数量
    estimateTokens(text) {
      if (!text) return 0;
      // 粗略估算：中文约 0.75 token/字符，英文约 0.25 token/字符
      const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
      const otherChars = text.length - chineseChars;
      return Math.ceil(chineseChars / this.CHUNK_CONFIG.TOKENS_PER_CHAR + otherChars * 0.25);
    },

    // 提取对话上下文（带消息处理）
    extractContext(conversation) {
      const messages = conversation.messages.map((msg, index) => {
        const content = this.htmlToPlainText(msg.content);
        return {
          index: index + 1,
          role: msg.role,
          content: content,
          tokens: this.estimateTokens(content)
        };
      });

      const totalTokens = messages.reduce((sum, m) => sum + m.tokens, 0);

      return {
        version: '2.0',  // 升级版本号，支持分片
        title: conversation.title,
        url: conversation.url,
        exportedAt: new Date().toISOString(),
        messageCount: messages.length,
        totalTokens: totalTokens,
        workspace: Parser.getWorkspaceName(),
        messages: messages
      };
    },

    // 智能分片：按 token 数量分割消息
    splitIntoChunks(contextData) {
      const { MAX_TOKENS_PER_CHUNK, MAX_MESSAGES_PER_CHUNK } = this.CHUNK_CONFIG;
      const messages = contextData.messages;
      const chunks = [];
      
      let currentChunk = [];
      let currentTokens = 0;
      
      for (const msg of messages) {
        const msgTokens = msg.tokens || this.estimateTokens(msg.content);
        
        // 如果单条消息超过限制，强制作为单独一个分片
        if (msgTokens > MAX_TOKENS_PER_CHUNK) {
          // 先保存当前分片
          if (currentChunk.length > 0) {
            chunks.push({ messages: currentChunk, tokens: currentTokens });
            currentChunk = [];
            currentTokens = 0;
          }
          // 单独保存超长消息
          chunks.push({ messages: [msg], tokens: msgTokens });
          continue;
        }
        
        // 检查是否需要开始新分片
        const wouldExceedTokens = currentTokens + msgTokens > MAX_TOKENS_PER_CHUNK;
        const wouldExceedMessages = currentChunk.length >= MAX_MESSAGES_PER_CHUNK;
        
        if (wouldExceedTokens || wouldExceedMessages) {
          if (currentChunk.length > 0) {
            chunks.push({ messages: currentChunk, tokens: currentTokens });
          }
          currentChunk = [msg];
          currentTokens = msgTokens;
        } else {
          currentChunk.push(msg);
          currentTokens += msgTokens;
        }
      }
      
      // 保存最后一个分片
      if (currentChunk.length > 0) {
        chunks.push({ messages: currentChunk, tokens: currentTokens });
      }
      
      return chunks;
    },

    // 创建分片文件的数据结构
    createChunkData(contextData, chunkMessages, chunkIndex, totalChunks) {
      const startIndex = chunkMessages[0].index;
      const endIndex = chunkMessages[chunkMessages.length - 1].index;
      const chunkTokens = chunkMessages.reduce((sum, m) => sum + (m.tokens || 0), 0);
      
      return {
        version: '2.0',
        type: 'chunk',  // 标记为分片
        title: contextData.title,
        url: contextData.url,
        exportedAt: contextData.exportedAt,
        workspace: contextData.workspace,
        // 分片信息
        chunk: {
          index: chunkIndex,           // 当前是第几个分片（从1开始）
          total: totalChunks,          // 总共几个分片
          messageRange: `${startIndex}-${endIndex}`,  // 消息范围
          messageCount: chunkMessages.length,
          tokens: chunkTokens
        },
        // 总体信息
        original: {
          totalMessages: contextData.messageCount,
          totalTokens: contextData.totalTokens
        },
        // 消息内容（移除 tokens 字段，减少文件大小）
        messages: chunkMessages.map(m => ({
          index: m.index,
          role: m.role,
          content: m.content
        }))
      };
    },

    // 生成 JSON 字符串
    toJSON(contextData) {
      return JSON.stringify(contextData, null, 2);
    },

    // 导出为 JSON 文件（支持智能分片）
    async export() {
      // 点击后立即显示提示
      UI.showToast('⏳ 正在导出上下文...', 'info', 0);
      
      const conversation = Parser.parseConversation();
      if (!conversation.messages.length) {
        UI.showToast('⚠️ 没有找到可导出的对话内容', 'error', 3000);
        return null;
      }

      const contextData = this.extractContext(conversation);
      const workspaceName = Parser.getWorkspaceName();
      const safeWorkspace = Utils.sanitizeFileName(workspaceName || '个人帐户');
      const safeTitle = Utils.sanitizeFileName(conversation.title);
      
      // 检查是否需要分片
      const { MAX_TOKENS_PER_CHUNK } = this.CHUNK_CONFIG;
      const needsChunking = contextData.totalTokens > MAX_TOKENS_PER_CHUNK || contextData.messageCount > 25;
      
      let result;
      if (needsChunking) {
        result = await this.exportChunked(contextData, safeWorkspace, safeTitle);
      } else {
        result = await this.exportSingle(contextData, safeWorkspace, safeTitle);
      }
      
      // 导出完成后，检测并保存附件
      if (result && CONFIG.saveMode === 'folder' && savedFolderHandle) {
        await this.detectAndSaveAttachments(safeWorkspace, safeTitle);
      }
      
      return result;
    },
    
    // 检测并保存附件
    async detectAndSaveAttachments(safeWorkspace, safeTitle) {
      console.log('[ChatGPT Saver] ===== detectAndSaveAttachments 被调用 =====');
      console.log('[ChatGPT Saver] safeWorkspace:', safeWorkspace, ', safeTitle:', safeTitle);
      
      // 扫描页面上的附件
      const detectedFiles = AttachmentManager.scanAttachments();
      
      if (detectedFiles.length === 0) {
        console.log('[ChatGPT Saver] 未检测到附件，跳过附件保存流程');
        return;
      }
      
      console.log(`[ChatGPT Saver] 检测到 ${detectedFiles.length} 个附件，弹出选择器`);
      
      // 弹出附件选择器让用户选择本地文件
      const selectedFiles = await AttachmentManager.showAttachmentPicker(detectedFiles);
      
      if (selectedFiles.length === 0) {
        console.log('[ChatGPT Saver] 用户跳过附件保存');
        return;
      }
      
      // 保存附件到 attachments 文件夹
      try {
        const workspaceFolder = await Utils.getOrCreateFolder(savedFolderHandle, safeWorkspace);
        const conversationFolder = await Utils.getOrCreateFolder(workspaceFolder, safeTitle);
        const attachmentsFolder = await Utils.getOrCreateFolder(conversationFolder, 'attachments');
        
        let savedCount = 0;
        for (const file of selectedFiles) {
          if (file) {
            const success = await Utils.saveToFolder(attachmentsFolder, file.name, file, file.type);
            if (success) {
              savedCount++;
              console.log(`[ChatGPT Saver] 附件已保存: ${file.name}`);
            }
          }
        }
        
        if (savedCount > 0) {
          UI.showToast(`✅ 已保存 ${savedCount} 个附件到 attachments 文件夹`, 'success', 3000);
        }
      } catch (e) {
        console.error('[ChatGPT Saver] 保存附件失败:', e);
        UI.showToast('⚠️ 附件保存失败', 'error', 3000);
      }
    },

    // 导出单个文件（短对话）
    async exportSingle(contextData, safeWorkspace, safeTitle) {
      // 移除 tokens 字段减少文件大小
      const cleanData = {
        ...contextData,
        type: 'single',  // 标记为单文件
        messages: contextData.messages.map(m => ({
          index: m.index,
          role: m.role,
          content: m.content
        }))
      };
      
      const jsonStr = this.toJSON(cleanData);
      const filename = `${safeTitle}.json`;
      
      if (CONFIG.saveMode === 'folder' && savedFolderHandle) {
        try {
          const workspaceFolder = await Utils.getOrCreateFolder(savedFolderHandle, safeWorkspace);
          const conversationFolder = await Utils.getOrCreateFolder(workspaceFolder, safeTitle);
          const contextFolder = await Utils.getOrCreateFolder(conversationFolder, 'context');
          
          await Utils.saveToFolder(contextFolder, filename, jsonStr, 'application/json');
          
          UI.showToast(`✅ 上下文已保存 (${contextData.messageCount}条消息, ~${Math.round(contextData.totalTokens/1000)}k tokens)`, 'success', 3000);
          console.log(`[ChatGPT Saver] 上下文 JSON 已保存: ${safeWorkspace}/${safeTitle}/context/${filename}`);
          
          return { contextData: cleanData, filename, chunked: false };
        } catch (e) {
          console.error('[ChatGPT Saver] 保存上下文 JSON 失败:', e);
        }
      }
      
      // 降级到浏览器下载
      const downloadFilename = `context_${safeTitle}_${Utils.getTimestamp()}.json`;
      Utils.downloadFile(jsonStr, downloadFilename, 'application/json');
      UI.showToast('✅ 上下文 JSON 已下载', 'success', 3000);
      
      return { contextData: cleanData, filename: downloadFilename, chunked: false };
    },

    // 导出分片文件（长对话）
    async exportChunked(contextData, safeWorkspace, safeTitle) {
      const chunks = this.splitIntoChunks(contextData);
      const totalChunks = chunks.length;
      
      console.log(`[ChatGPT Saver] 对话将分成 ${totalChunks} 个分片导出`);
      console.log(`[ChatGPT Saver] 总消息数: ${contextData.messageCount}, 总 tokens: ~${contextData.totalTokens}`);
      
      const savedFiles = [];
      
      if (CONFIG.saveMode === 'folder' && savedFolderHandle) {
        try {
          const workspaceFolder = await Utils.getOrCreateFolder(savedFolderHandle, safeWorkspace);
          const conversationFolder = await Utils.getOrCreateFolder(workspaceFolder, safeTitle);
          const contextFolder = await Utils.getOrCreateFolder(conversationFolder, 'context');
          
          // 保存每个分片
          for (let i = 0; i < totalChunks; i++) {
            const chunkData = this.createChunkData(contextData, chunks[i].messages, i + 1, totalChunks);
            const filename = `${safeTitle}_part${String(i + 1).padStart(2, '0')}_of_${String(totalChunks).padStart(2, '0')}.json`;
            const jsonStr = this.toJSON(chunkData);
            
            await Utils.saveToFolder(contextFolder, filename, jsonStr, 'application/json');
            savedFiles.push(filename);
            
            console.log(`[ChatGPT Saver] 分片 ${i + 1}/${totalChunks} 已保存: ${filename}`);
          }
          
          // 创建索引文件
          const indexData = {
            version: '2.0',
            type: 'index',
            title: contextData.title,
            url: contextData.url,
            exportedAt: contextData.exportedAt,
            workspace: contextData.workspace,
            totalMessages: contextData.messageCount,
            totalTokens: contextData.totalTokens,
            chunks: chunks.map((chunk, i) => ({
              index: i + 1,
              filename: `${safeTitle}_part${String(i + 1).padStart(2, '0')}_of_${String(totalChunks).padStart(2, '0')}.json`,
              messageRange: `${chunk.messages[0].index}-${chunk.messages[chunk.messages.length - 1].index}`,
              messageCount: chunk.messages.length,
              tokens: chunk.tokens
            })),
            instructions: {
              zh: `此对话已分成 ${totalChunks} 个文件。请将所有 part*.json 文件上传到 ChatGPT Projects，AI 会自动索引并检索相关内容。`,
              en: `This conversation is split into ${totalChunks} files. Upload all part*.json files to ChatGPT Projects for automatic indexing.`
            }
          };
          
          await Utils.saveToFolder(contextFolder, `_index.json`, this.toJSON(indexData), 'application/json');
          
          UI.showToast(`✅ 已分成 ${totalChunks} 个文件保存 (共 ${contextData.messageCount} 条消息)\n💡 建议上传到 ChatGPT Projects 使用`, 'success', 5000);
          
          return { 
            contextData, 
            files: savedFiles, 
            indexFile: '_index.json',
            chunked: true, 
            totalChunks 
          };
        } catch (e) {
          console.error('[ChatGPT Saver] 保存分片文件失败:', e);
        }
      }
      
      // 降级到浏览器下载：打包成 zip 或者逐个下载
      // 简化处理：提示用户使用文件夹保存模式
      alert(`对话内容较长（${contextData.messageCount}条消息, ~${Math.round(contextData.totalTokens/1000)}k tokens），需要分成 ${totalChunks} 个文件。\n\n请先点击"选择文件夹"设置保存位置，然后重新导出。`);
      return null;
    }
  };

  // ==================== 上下文导入器 ====================
  const ContextImporter = {
    importModal: null,
    currentContextData: null,
    currentFileInfo: null,  // 当前选中的文件信息
    fileInput: null,
    availableContextFiles: [], // 可用的上下文文件列表

    // 创建导入弹窗
    createImportModal() {
      if (this.importModal) return;
      
      const modal = document.createElement('div');
      modal.className = 'saver-import-modal';
      modal.id = 'saver-import-modal';
      modal.innerHTML = `
        <div class="saver-import-dialog">
          <div class="saver-import-header">
            <h3>📥 导入上下文</h3>
            <p>将之前的对话上下文导入到新对话中</p>
          </div>
          <div class="saver-import-content">
            <!-- 文件列表区域 -->
            <div id="saver-file-list-area" style="display: none;">
              <div style="font-size: 12px; color: var(--saver-text); opacity: 0.8; margin-bottom: 8px;">📂 从保存文件夹中选择：</div>
              <div id="saver-file-list" style="max-height: 200px; overflow-y: auto; border: 1px solid var(--saver-border); border-radius: 8px;"></div>
            </div>
            
            <!-- 预览区域 -->
            <div class="saver-import-preview" id="saver-import-preview">
              正在扫描文件夹...
            </div>
            <div class="saver-import-meta" id="saver-import-meta" style="display: none;">
              <div class="saver-import-meta-item">
                <span class="saver-import-meta-label">对话标题</span>
                <span class="saver-import-meta-value" id="saver-meta-title">-</span>
              </div>
              <div class="saver-import-meta-item">
                <span class="saver-import-meta-label">消息数量</span>
                <span class="saver-import-meta-value" id="saver-meta-count">-</span>
              </div>
              <div class="saver-import-meta-item">
                <span class="saver-import-meta-label">导出时间</span>
                <span class="saver-import-meta-value" id="saver-meta-time">-</span>
              </div>
            </div>
            <div class="saver-import-options" id="saver-import-options" style="display: none;">
              <label>
                <input type="checkbox" id="saver-auto-send" />
                <span>导入后自动发送</span>
              </label>
            </div>
          </div>
          <div class="saver-import-footer">
            <button class="saver-import-btn secondary" id="saver-import-cancel">取消</button>
            <button class="saver-import-btn secondary" id="saver-import-select">从本地选择</button>
            <button class="saver-import-btn primary" id="saver-import-confirm" disabled>导入</button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);
      this.importModal = modal;
      
      // 绑定事件
      modal.querySelector('#saver-import-cancel').onclick = () => this.hideModal();
      modal.querySelector('#saver-import-select').onclick = () => this.selectLocalFile();
      modal.querySelector('#saver-import-confirm').onclick = () => this.confirmImport();
      modal.onclick = (e) => {
        if (e.target === modal) this.hideModal();
      };
      
      // 创建隐藏的文件选择器
      this.createFileInput();
    },

    // 创建隐藏的文件输入
    createFileInput() {
      if (this.fileInput) return;
      
      const input = document.createElement('input');
      input.type = 'file';
      input.id = 'saver-file-input';
      input.accept = '.json,application/json';
      input.onchange = (e) => this.handleLocalFileSelect(e);
      document.body.appendChild(input);
      this.fileInput = input;
    },

    // 从本地选择文件（系统文件选择器）
    selectLocalFile() {
      if (this.fileInput) {
        this.fileInput.click();
      }
    },

    // 处理本地文件选择
    async handleLocalFileSelect(event) {
      const file = event.target.files[0];
      if (!file) return;
      
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        
        // 验证 JSON 结构
        if (!data.messages || !Array.isArray(data.messages)) {
          throw new Error('无效的上下文 JSON 格式');
        }
        
        this.currentContextData = data;
        this.showContentPreview(data);
        
      } catch (e) {
        alert('解析 JSON 文件失败: ' + e.message);
        console.error('[ChatGPT Saver] JSON 解析错误:', e);
      }
      
      event.target.value = '';
    },

    // 扫描保存文件夹中的所有上下文 JSON 文件
    async scanContextFiles() {
      if (!savedFolderHandle) {
        return [];
      }
      
      const files = [];
      
      try {
        // 遍历工作空间文件夹
        for await (const workspaceEntry of savedFolderHandle.values()) {
          if (workspaceEntry.kind !== 'directory') continue;
          
          const workspaceName = workspaceEntry.name;
          const workspaceHandle = await savedFolderHandle.getDirectoryHandle(workspaceName);
          
          // 遍历对话文件夹
          for await (const convEntry of workspaceHandle.values()) {
            if (convEntry.kind !== 'directory') continue;
            
            const convName = convEntry.name;
            const convHandle = await workspaceHandle.getDirectoryHandle(convName);
            
            // 检查是否有 context 文件夹
            try {
              const contextFolder = await convHandle.getDirectoryHandle('context', { create: false });
              
              // 遍历 context 文件夹中的 JSON 文件
              for await (const fileEntry of contextFolder.values()) {
                if (fileEntry.kind === 'file' && fileEntry.name.endsWith('.json')) {
                  files.push({
                    workspace: workspaceName,
                    conversation: convName,
                    filename: fileEntry.name,
                    path: `${workspaceName}/${convName}/context/${fileEntry.name}`,
                    handle: fileEntry
                  });
                }
              }
            } catch (e) {
              // 没有 context 文件夹，跳过
            }
          }
        }
      } catch (e) {
        console.error('[ChatGPT Saver] 扫描文件夹失败:', e);
      }
      
      // 按路径排序
      files.sort((a, b) => a.path.localeCompare(b.path));
      
      return files;
    },

    // 显示文件列表（树形结构）
    renderFileList(files) {
      const listArea = document.getElementById('saver-file-list-area');
      const listEl = document.getElementById('saver-file-list');
      const previewEl = document.getElementById('saver-import-preview');
      
      if (files.length === 0) {
        listArea.style.display = 'none';
        previewEl.textContent = '文件夹中没有找到上下文文件\n\n请先导出一些对话上下文，或点击"从本地选择"按钮选择文件';
        return;
      }
      
      listArea.style.display = 'block';
      previewEl.textContent = '请从上方列表中选择一个文件';
      
      // 构建树形结构
      const tree = this.buildFileTree(files);
      
      // 渲染树形结构
      listEl.innerHTML = this.renderTree(tree);
      
      // 绑定事件
      this.bindTreeEvents(listEl, files);
    },
    
    // 构建文件树结构
    buildFileTree(files) {
      const tree = {};
      
      for (const file of files) {
        if (!tree[file.workspace]) {
          tree[file.workspace] = {};
        }
        if (!tree[file.workspace][file.conversation]) {
          tree[file.workspace][file.conversation] = [];
        }
        tree[file.workspace][file.conversation].push(file);
      }
      
      return tree;
    },
    
    // 渲染树形结构 HTML
    renderTree(tree) {
      let html = '';
      
      for (const workspace of Object.keys(tree).sort()) {
        html += `
          <div class="saver-tree-workspace" data-workspace="${workspace}">
            <div class="saver-tree-folder" style="
              padding: 8px 12px; cursor: pointer; font-weight: 600;
              color: var(--saver-text); display: flex; align-items: center; gap: 8px;
              border-bottom: 1px solid var(--saver-border);
            ">
              <span class="saver-tree-icon">📁</span>
              <span>${workspace}</span>
              <span style="margin-left: auto; font-size: 11px; color: #888;">工作空间</span>
            </div>
            <div class="saver-tree-children" style="display: none; padding-left: 16px;">
        `;
        
        for (const conversation of Object.keys(tree[workspace]).sort()) {
          const convFiles = tree[workspace][conversation];
          html += `
            <div class="saver-tree-conversation" data-conversation="${conversation}">
              <div class="saver-tree-folder" style="
                padding: 6px 12px; cursor: pointer; font-weight: 500;
                color: var(--saver-text); display: flex; align-items: center; gap: 8px;
                border-bottom: 1px solid var(--saver-border); font-size: 13px;
              ">
                <span class="saver-tree-icon">📁</span>
                <span>${conversation}</span>
                <span style="margin-left: auto; font-size: 10px; color: #888;">${convFiles.length} 个文件</span>
              </div>
              <div class="saver-tree-children" style="display: none; padding-left: 16px;">
          `;
          
          for (const file of convFiles) {
            const isChunk = file.filename.includes('_part');
            const isIndex = file.filename === '_index.json';
            const icon = isIndex ? '📊' : (isChunk ? '📦' : '📄');
            // 使用 file.path 作为唯一标识符（已经在 scanContextFiles 中生成）
            html += `
              <div class="saver-tree-file" data-file-path="${file.path}" style="
                padding: 6px 12px; cursor: pointer; font-size: 12px;
                color: var(--saver-text); display: flex; align-items: center; gap: 8px;
                border-bottom: 1px solid var(--saver-border); transition: background 0.2s;
              ">
                <span>${icon}</span>
                <span style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${file.filename}</span>
              </div>
            `;
          }
          
          html += `
              </div>
            </div>
          `;
        }
        
        html += `
            </div>
          </div>
        `;
      }
      
      return html;
    },
    
    // 绑定树形结构事件
    bindTreeEvents(listEl, files) {
      // 创建文件映射：path -> file（使用 file.path 作为唯一标识）
      const fileMap = {};
      for (const file of files) {
        fileMap[file.path] = file;
        console.log('[ChatGPT Saver] 映射文件:', file.path);
      }
      
      // 文件夹展开/收起
      listEl.querySelectorAll('.saver-tree-folder').forEach(folder => {
        folder.addEventListener('click', (e) => {
          e.stopPropagation();
          const children = folder.nextElementSibling;
          const icon = folder.querySelector('.saver-tree-icon');
          if (children && children.classList.contains('saver-tree-children')) {
            const isOpen = children.style.display !== 'none';
            children.style.display = isOpen ? 'none' : 'block';
            icon.textContent = isOpen ? '📁' : '📂';
          }
        });
        
        // 鼠标悬停效果
        folder.addEventListener('mouseenter', () => {
          folder.style.background = 'var(--saver-format-active-bg)';
        });
        folder.addEventListener('mouseleave', () => {
          folder.style.background = 'transparent';
        });
      });
      
      // 文件点击
      listEl.querySelectorAll('.saver-tree-file').forEach(fileEl => {
        fileEl.addEventListener('click', async (e) => {
          e.stopPropagation();
          const filePath = fileEl.dataset.filePath;
          const file = fileMap[filePath];
          
          if (!file) {
            console.error('[ChatGPT Saver] 找不到文件:', filePath);
            console.error('[ChatGPT Saver] 可用的 keys:', Object.keys(fileMap));
            return;
          }
          
          console.log('[ChatGPT Saver] 加载文件:', file.filename, '路径:', filePath);
          await this.loadContextFile(file);
          
          // 高亮选中项
          listEl.querySelectorAll('.saver-tree-file').forEach(el => {
            el.classList.remove('selected');
            el.style.background = 'transparent';
            el.style.borderLeft = 'none';
          });
          fileEl.classList.add('selected');
          fileEl.style.background = 'var(--saver-format-active-bg)';
          fileEl.style.borderLeft = '3px solid #10a37f';
        });
        
        // 鼠标悬停效果
        fileEl.addEventListener('mouseenter', function() {
          if (!this.classList.contains('selected')) {
            this.style.background = 'var(--saver-format-active-bg)';
          }
        });
        fileEl.addEventListener('mouseleave', function() {
          if (!this.classList.contains('selected')) {
            this.style.background = 'transparent';
          }
        });
      });
    },

    // 加载上下文文件
    async loadContextFile(fileInfo) {
      try {
        const file = await fileInfo.handle.getFile();
        const text = await file.text();
        const data = JSON.parse(text);
        
        // 检查是否是索引文件
        if (data.type === 'index') {
          this.showChunkedInfo(data, fileInfo);
          return;
        }
        
        // 检查是否是分片文件
        if (data.type === 'chunk') {
          this.showChunkWarning(data, fileInfo);
          return;
        }
        
        // 普通单文件
        if (!data.messages || !Array.isArray(data.messages)) {
          throw new Error('无效的上下文 JSON 格式');
        }
        
        this.currentContextData = data;
        this.currentFileInfo = fileInfo;  // 保存文件信息，用于文件上传
        this.showContentPreview(data);
        
      } catch (e) {
        alert('读取文件失败: ' + e.message);
        console.error('[ChatGPT Saver] 读取上下文文件失败:', e);
      }
    },

    // 显示分片信息（索引文件）
    showChunkedInfo(indexData, fileInfo) {
      const previewEl = document.getElementById('saver-import-preview');
      const metaEl = document.getElementById('saver-import-meta');
      const optionsEl = document.getElementById('saver-import-options');
      const confirmBtn = document.getElementById('saver-import-confirm');
      
      // 显示分片信息
      const chunksList = indexData.chunks.map(c => 
        `  ${c.index}. ${c.filename}\n     消息 ${c.messageRange} (共 ${c.messageCount} 条, ~${Math.round(c.tokens/1000)}k tokens)`
      ).join('\n\n');
      
      previewEl.textContent = `📦 检测到分片导出（共 ${indexData.chunks.length} 个文件）\n\n总消息数：${indexData.totalMessages} 条\n总 tokens：~${Math.round(indexData.totalTokens/1000)}k\n\n分片列表：\n${chunksList}\n\n💡 建议使用方法：\n1. 在 ChatGPT 点击右上角头像 -> Projects\n2. 创建新 Project 或选择现有 Project\n3. 将所有 part*.json 文件上传到 Project\n4. AI 会自动索引并检索相关内容\n\n⚠️ 不建议通过文本注入导入，因为总内容超过了 ChatGPT 上下文窗口限制。`;
      
      metaEl.style.display = 'none';
      optionsEl.style.display = 'none';
      confirmBtn.disabled = true;
    },

    // 显示分片警告（单个分片文件）- 自动查找同组所有分片
    async showChunkWarning(chunkData, fileInfo) {
      const previewEl = document.getElementById('saver-import-preview');
      const metaEl = document.getElementById('saver-import-meta');
      const optionsEl = document.getElementById('saver-import-options');
      const confirmBtn = document.getElementById('saver-import-confirm');
      
      // 查找同组的所有分片文件
      const allChunkFiles = await this.findAllChunkFiles(fileInfo, chunkData.chunk.total);
      const foundCount = allChunkFiles.length;
      const totalCount = chunkData.chunk.total;
      
      // 显示分片信息
      let previewText = `📦 检测到分片文件（共 ${totalCount} 个分片）\n\n`;
      previewText += `✅ 已找到 ${foundCount}/${totalCount} 个分片文件\n\n`;
      
      // 列出找到的文件
      previewText += `分片列表：\n`;
      allChunkFiles.forEach((f, i) => {
        previewText += `  ${i + 1}. ${f.filename}\n`;
      });
      
      previewText += `\n原始对话总计：\n`;
      previewText += `- 总消息：${chunkData.original.totalMessages} 条\n`;
      previewText += `- 总 tokens：~${Math.round(chunkData.original.totalTokens/1000)}k\n\n`;
      previewText += `👇 点击下方按钮一次性上传所有分片文件`;
      
      previewEl.textContent = previewText;
      
      // 保存所有分片文件
      this.currentContextData = chunkData;
      this.currentFileInfo = fileInfo;
      this.allChunkFiles = allChunkFiles;  // 保存所有分片
      
      metaEl.style.display = 'none';
      optionsEl.style.display = 'block';
      confirmBtn.disabled = false;
      confirmBtn.textContent = `上传全部 ${foundCount} 个分片`;
    },
    
    // 查找同组的所有分片文件
    async findAllChunkFiles(fileInfo, totalChunks) {
      const chunkFiles = [];
      
      try {
        // 获取 context 文件夹
        const workspaceHandle = await savedFolderHandle.getDirectoryHandle(fileInfo.workspace);
        const convHandle = await workspaceHandle.getDirectoryHandle(fileInfo.conversation);
        const contextHandle = await convHandle.getDirectoryHandle('context');
        
        // 遍历所有文件，查找 part*.json
        for await (const entry of contextHandle.values()) {
          if (entry.kind === 'file' && entry.name.includes('_part') && entry.name.endsWith('.json')) {
            chunkFiles.push({
              filename: entry.name,
              handle: entry,
              workspace: fileInfo.workspace,
              conversation: fileInfo.conversation
            });
          }
        }
        
        // 按文件名排序（part01, part02...)
        chunkFiles.sort((a, b) => a.filename.localeCompare(b.filename));
        
      } catch (e) {
        console.error('[ChatGPT Saver] 查找分片文件失败:', e);
      }
      
      return chunkFiles;
    },

    // 显示内容预览（单文件）
    showContentPreview(data) {
      const previewEl = document.getElementById('saver-import-preview');
      const metaEl = document.getElementById('saver-import-meta');
      const optionsEl = document.getElementById('saver-import-options');
      const confirmBtn = document.getElementById('saver-import-confirm');
      
      // 显示前几条消息预览
      const previewMessages = data.messages.slice(0, 3).map(m => 
        `[${m.role}] ${m.content.substring(0, 100)}${m.content.length > 100 ? '...' : ''}`
      ).join('\n\n');
      
      previewEl.textContent = previewMessages + 
        (data.messages.length > 3 ? `\n\n... 还有 ${data.messages.length - 3} 条消息` : '');
      
      // 显示元信息
      document.getElementById('saver-meta-title').textContent = data.title || '未知';
      document.getElementById('saver-meta-count').textContent = data.messageCount || data.messages.length;
      document.getElementById('saver-meta-time').textContent = data.exportedAt 
        ? new Date(data.exportedAt).toLocaleString('zh-CN') 
        : '未知';
      
      // 显示 tokens 信息（如果有）
      if (data.totalTokens) {
        const tokensInfo = document.createElement('div');
        tokensInfo.className = 'saver-import-meta-item';
        tokensInfo.innerHTML = `
          <span class="saver-import-meta-label">Tokens</span>
          <span class="saver-import-meta-value">~${Math.round(data.totalTokens/1000)}k</span>
        `;
        document.getElementById('saver-import-meta').appendChild(tokensInfo);
      }
      
      metaEl.style.display = 'block';
      optionsEl.style.display = 'block';
      confirmBtn.disabled = false;
      confirmBtn.textContent = '作为附件导入';  // 改为文件上传
    },

    // 显示弹窗
    async showModal() {
      this.createImportModal();
      this.importModal.classList.add('show');
      
      // 重置状态
      this.currentContextData = null;
      document.getElementById('saver-import-preview').textContent = '正在扫描文件夹...';
      document.getElementById('saver-import-meta').style.display = 'none';
      document.getElementById('saver-import-options').style.display = 'none';
      document.getElementById('saver-import-confirm').disabled = true;
      document.getElementById('saver-auto-send').checked = false;
      document.getElementById('saver-file-list-area').style.display = 'none';
      
      // 如果有保存文件夹，扫描并显示文件列表
      if (CONFIG.saveMode === 'folder' && savedFolderHandle) {
        console.log('[ChatGPT Saver] 扫描保存文件夹中的上下文文件...');
        this.availableContextFiles = await this.scanContextFiles();
        this.renderFileList(this.availableContextFiles);
      } else {
        document.getElementById('saver-import-preview').textContent = '未选择保存文件夹\n\n请点击“从本地选择”按钮选择 JSON 文件';
      }
    },

    // 隐藏弹窗
    hideModal() {
      if (this.importModal) {
        this.importModal.classList.remove('show');
      }
    },

    // 确认导入
    async confirmImport() {
      if (!this.currentContextData) return;
      
      const autoSend = document.getElementById('saver-auto-send').checked;
      const data = this.currentContextData;
      
      console.log('[ChatGPT Saver] confirmImport 被调用, 数据类型:', data.type);
      
      this.hideModal();
      
      // 决策逻辑：优先使用文件上传
      const isChunk = data.type === 'chunk';
      const shouldUploadAsFile = isChunk || this.currentFileInfo;  // 分片或有文件引用，就上传文件
      
      if (shouldUploadAsFile) {
        const fileCount = isChunk && this.allChunkFiles ? this.allChunkFiles.length : 1;
        console.log(`[ChatGPT Saver] 尝试上传 ${fileCount} 个 JSON 附件...`);
        UI.showToast(`📎 正在上传 ${fileCount} 个 JSON 附件...`, 'saving', 0);
        const uploadedCount = await this.uploadAsAttachment();
        
        if (uploadedCount) {
          UI.showToast(`✅ 已上传 ${uploadedCount} 个 JSON 文件`, 'success', 3000);
          // 清理
          this.allChunkFiles = null;
          
          // 自动上传附件文件夹中的文件
          await this.uploadAttachmentsIfExist();
          
          // 注入预设提示词到输入框
          await this.injectContextPrompt(data, fileCount);
          
          if (autoSend) {
            setTimeout(() => this.triggerSend(), 1000);
          }
        } else {
          UI.hideToast();
          alert('文件上传失败。请手动点击附件按钮上传 JSON 文件。');
        }
      } else {
        // 降级方案：文本注入（通常不会走到这里）
        console.log('[ChatGPT Saver] 使用文本注入...');
        UI.showToast('🔄 正在导入上下文...', 'saving', 0);
        const success = await this.injectToInput();
        
        if (success) {
          UI.showToast('✅ 上下文已导入', 'success', 3000);
          if (autoSend) {
            setTimeout(() => this.triggerSend(), 800);
          }
        } else {
          UI.hideToast();
          alert('导入失败，请手动复制粘贴上下文内容');
        }
      }
    },
    
    // 注入预设提示词到输入框
    async injectContextPrompt(data, fileCount) {
      try {
        const input = await this.findInputElement();
        if (!input) {
          console.warn('[ChatGPT Saver] 未找到输入框，无法注入提示词');
          return;
        }
        
        // 构建预设提示词
        const promptText = this.buildContextPrompt(data, fileCount);
        
        if (input.tagName === 'TEXTAREA') {
          // 设置值
          input.value = promptText;
          
          // 触发多种事件确保 React 感知
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          
          // 尝试触发 React 的合成事件
          const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
            window.HTMLTextAreaElement.prototype, 'value'
          ).set;
          nativeInputValueSetter.call(input, promptText);
          input.dispatchEvent(new Event('input', { bubbles: true }));
          
        } else if (input.getAttribute('contenteditable') === 'true') {
          input.innerText = promptText;
          input.dispatchEvent(new InputEvent('input', { 
            bubbles: true, 
            inputType: 'insertText',
            data: promptText 
          }));
        }
        
        input.focus();
        console.log('[ChatGPT Saver] 已注入预设提示词');
        
      } catch (e) {
        console.error('[ChatGPT Saver] 注入提示词失败:', e);
      }
    },
    
    // 构建上下文导入的预设提示词
    buildContextPrompt(data, fileCount) {
      const title = data.title || '未知对话';
      const messageCount = data.messageCount || data.messages?.length || 0;
      const isChunked = data.type === 'chunk' || fileCount > 1;
      
      // 根据是否分片构建不同的提示词
      if (isChunked) {
        return `我已上传了 ${fileCount} 个 JSON 文件，这是之前对话「${title}」的上下文记录（共 ${data.original?.totalMessages || messageCount} 条消息）。

请你：
1. 仔细阅读这些 JSON 文件中的对话内容
2. 理解对话的主题、背景和我们讨论的要点
3. 简要总结对话的核心内容（用 3-5 个要点）
4. 然后告诉我你已准备好继续这个对话

注意：请基于文件中的实际内容来理解，而不是猜测。`;
      } else {
        return `我已上传了一个 JSON 文件，这是之前对话「${title}」的上下文记录（共 ${messageCount} 条消息）。

请你：
1. 仔细阅读这个 JSON 文件中的对话内容
2. 理解对话的主题、背景和我们讨论的要点
3. 简要总结对话的核心内容（用 3-5 个要点）
4. 然后告诉我你已准备好继续这个对话

注意：请基于文件中的实际内容来理解，而不是猜测。`;
      }
    },
    
    // 上传为附件（支持批量上传所有分片）
    async uploadAsAttachment() {
      try {
        // 检查是否有多个分片文件
        const filesToUpload = [];
        
        if (this.allChunkFiles && this.allChunkFiles.length > 0) {
          // 批量上传所有分片
          console.log(`[ChatGPT Saver] 批量上传 ${this.allChunkFiles.length} 个分片文件`);
          for (const chunkFile of this.allChunkFiles) {
            const file = await chunkFile.handle.getFile();
            filesToUpload.push(file);
          }
        } else if (this.currentFileInfo && this.currentFileInfo.handle) {
          // 单个文件
          const file = await this.currentFileInfo.handle.getFile();
          filesToUpload.push(file);
        } else {
          // 从当前数据创建文件
          const jsonStr = JSON.stringify(this.currentContextData, null, 2);
          const blob = new Blob([jsonStr], { type: 'application/json' });
          const filename = `context_${this.currentContextData.title || 'import'}.json`;
          const file = new File([blob], filename, { type: 'application/json', lastModified: Date.now() });
          filesToUpload.push(file);
        }
        
        console.log(`[ChatGPT Saver] 尝试上传 ${filesToUpload.length} 个文件:`);
        filesToUpload.forEach(f => console.log(`  - ${f.name} (${f.size} bytes)`));
        
        // 查找 ChatGPT 的文件输入
        const fileInputs = document.querySelectorAll('input[type="file"]');
        let targetInput = null;
        for (const input of fileInputs) {
          if (input.id !== 'saver-file-input') {
            targetInput = input;
            break;
          }
        }
        
        if (!targetInput) {
          console.error('[ChatGPT Saver] 未找到文件输入框');
          return false;
        }
        
        console.log('[ChatGPT Saver] 找到文件输入框:', targetInput);
        
        // 创建 DataTransfer 并添加所有文件
        const dataTransfer = new DataTransfer();
        for (const file of filesToUpload) {
          dataTransfer.items.add(file);
        }
        targetInput.files = dataTransfer.files;
        
        // 触发事件
        targetInput.dispatchEvent(new Event('change', { bubbles: true }));
        targetInput.dispatchEvent(new Event('input', { bubbles: true }));
        
        console.log(`[ChatGPT Saver] ${filesToUpload.length} 个文件上传事件已触发`);
        
        // 等待并返回成功
        await this.sleep(500);
        return filesToUpload.length;  // 返回上传文件数量
        
      } catch (e) {
        console.error('[ChatGPT Saver] uploadAsAttachment 错误:', e);
        return false;
      }
    },
    
    // 自动上传附件文件夹中的文件
    async uploadAttachmentsIfExist() {
      // 检查是否有文件信息
      if (!this.currentFileInfo) {
        console.log('[ChatGPT Saver] 没有文件信息，跳过附件上传');
        return;
      }
      
      try {
        // 获取 attachments 文件夹
        const workspaceHandle = await savedFolderHandle.getDirectoryHandle(this.currentFileInfo.workspace);
        const convHandle = await workspaceHandle.getDirectoryHandle(this.currentFileInfo.conversation);
        
        let attachmentsFolder;
        try {
          attachmentsFolder = await convHandle.getDirectoryHandle('attachments', { create: false });
        } catch (e) {
          console.log('[ChatGPT Saver] 没有 attachments 文件夹，跳过');
          return;
        }
        
        // 扫描 attachments 文件夹中的文件
        const attachmentFiles = [];
        for await (const entry of attachmentsFolder.values()) {
          if (entry.kind === 'file') {
            attachmentFiles.push(entry);
          }
        }
        
        if (attachmentFiles.length === 0) {
          console.log('[ChatGPT Saver] attachments 文件夹为空');
          return;
        }
        
        console.log(`[ChatGPT Saver] 发现 ${attachmentFiles.length} 个附件文件，准备上传`);
        UI.showToast(`📎 正在上传 ${attachmentFiles.length} 个附件文件...`, 'saving', 0);
        
        // 等待上一次上传完成
        await this.sleep(1000);
        
        // 加载所有附件文件
        const filesToUpload = [];
        for (const fileHandle of attachmentFiles) {
          const file = await fileHandle.getFile();
          filesToUpload.push(file);
        }
        
        // 查找 ChatGPT 的文件输入
        const fileInputs = document.querySelectorAll('input[type="file"]');
        let targetInput = null;
        for (const input of fileInputs) {
          if (input.id !== 'saver-file-input') {
            targetInput = input;
            break;
          }
        }
        
        if (!targetInput) {
          console.error('[ChatGPT Saver] 未找到文件输入框');
          return;
        }
        
        // 创建 DataTransfer 并添加所有文件
        const dataTransfer = new DataTransfer();
        for (const file of filesToUpload) {
          dataTransfer.items.add(file);
          console.log(`[ChatGPT Saver] 添加附件: ${file.name}`);
        }
        targetInput.files = dataTransfer.files;
        
        // 触发事件
        targetInput.dispatchEvent(new Event('change', { bubbles: true }));
        targetInput.dispatchEvent(new Event('input', { bubbles: true }));
        
        await this.sleep(500);
        
        UI.showToast(`✅ 已上传 ${attachmentFiles.length} 个附件文件`, 'success', 3000);
        console.log(`[ChatGPT Saver] ${attachmentFiles.length} 个附件文件上传完成`);
        
      } catch (e) {
        console.error('[ChatGPT Saver] 上传附件失败:', e);
      }
    },

    // 方案 A: 尝试模拟上传文件附件
    async tryUploadAsAttachment() {
      try {
        const jsonStr = JSON.stringify(this.currentContextData, null, 2);
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const filename = `context_${this.currentContextData.title || 'import'}.json`;
        const file = new File([blob], filename, {
          type: 'application/json',
          lastModified: Date.now()
        });

        // 创建 DataTransfer
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);

        // 方式1: 查找隐藏的 file input
        const fileInputs = document.querySelectorAll('input[type="file"]');
        for (const input of fileInputs) {
          if (input.id !== 'saver-file-input') {
            try {
              input.files = dataTransfer.files;
              input.dispatchEvent(new Event('change', { bubbles: true }));
              await this.sleep(500);
              
              // 检查是否有附件出现
              if (this.checkAttachmentAdded()) {
                console.log('[ChatGPT Saver] 方案A成功: 通过 file input 上传');
                return true;
              }
            } catch (e) {
              console.log('[ChatGPT Saver] file input 方式失败:', e);
            }
          }
        }

        // 方式2: 模拟拖放到输入区域
        const dropTargets = [
          document.querySelector('body'), // 尝试直接对 body 触发，因为 ChatGPT 的拖放通常是全局监听的
          document.querySelector('[data-testid="composer"]'),
          document.querySelector('form'),
          document.querySelector('#prompt-textarea')?.closest('div'),
          document.querySelector('main')
        ].filter(Boolean);

        for (const target of dropTargets) {
          try {
            // 模拟 dragenter -> dragover -> drop 序列
            const dragEnter = new DragEvent('dragenter', {
              bubbles: true, cancelable: true, dataTransfer
            });
            const dragOver = new DragEvent('dragover', {
              bubbles: true, cancelable: true, dataTransfer
            });
            const drop = new DragEvent('drop', {
              bubbles: true, cancelable: true, dataTransfer
            });
            
            target.dispatchEvent(dragEnter);
            target.dispatchEvent(dragOver);
            target.dispatchEvent(drop);
            
            await this.sleep(500);
            
            if (this.checkAttachmentAdded()) {
              console.log('[ChatGPT Saver] 方案A成功: 通过拖放上传');
              return true;
            }
          } catch (e) {
            console.log('[ChatGPT Saver] 拖放方式失败:', e);
          }
        }

        console.log('[ChatGPT Saver] 方案A失败，降级到方案B');
        return false;
      } catch (e) {
        console.error('[ChatGPT Saver] tryUploadAsAttachment 错误:', e);
        return false;
      }
    },

    // 检查是否有附件添加成功
    checkAttachmentAdded() {
      // ChatGPT 附件相关的选择器
      const attachmentSelectors = [
        '[data-testid="attachment"]',
        '[data-testid="file-thumbnail"]',
        '[class*="attachment"]',
        '[class*="file-preview"]'
      ];
      
      for (const selector of attachmentSelectors) {
        if (document.querySelector(selector)) {
          return true;
        }
      }
      return false;
    },

    // 方案 B: 注入到输入框
    async injectToInput() {
      try {
        const input = await this.findInputElement();
        if (!input) {
          console.error('[ChatGPT Saver] 未找到输入框');
          return false;
        }

        const promptText = this.buildPromptText();
        
        if (input.tagName === 'TEXTAREA') {
          // 设置值
          input.value = promptText;
          
          // 触发多种事件确保 React 感知
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          
          // 尝试触发 React 的合成事件
          const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
            window.HTMLTextAreaElement.prototype, 'value'
          ).set;
          nativeInputValueSetter.call(input, promptText);
          input.dispatchEvent(new Event('input', { bubbles: true }));
          
        } else if (input.getAttribute('contenteditable') === 'true') {
          input.innerText = promptText;
          input.dispatchEvent(new InputEvent('input', { 
            bubbles: true, 
            inputType: 'insertText',
            data: promptText 
          }));
        }

        input.focus();
        console.log('[ChatGPT Saver] 方案B成功: 已注入到输入框');
        return true;
      } catch (e) {
        console.error('[ChatGPT Saver] injectToInput 错误:', e);
        return false;
      }
    },

    // 查找输入框
    async findInputElement(timeout = 5000) {
      const selectors = [
        '#prompt-textarea',
        'textarea[data-id="root"]',
        'div[contenteditable="true"][id*="prompt"]',
        'textarea[placeholder*="Message"]',
        'textarea[placeholder*="消息"]',
        'textarea[placeholder*="发送"]',
        'form textarea'
      ];
      
      const startTime = Date.now();
      
      while (Date.now() - startTime < timeout) {
        for (const selector of selectors) {
          const el = document.querySelector(selector);
          if (el) return el;
        }
        await this.sleep(200);
      }
      
      return null;
    },

    // 构建提示文本（智能压缩）
    buildPromptText() {
      const data = this.currentContextData;
      const messageCount = data.messages.length;
      
      // 估算 token 数（粗略：1 token ≈ 0.75 中文字或 1 英文单词）
      const totalChars = data.messages.reduce((sum, m) => sum + m.content.length, 0);
      const estimatedTokens = Math.ceil(totalChars / 0.75);
      
      // 阈值：大于 30k tokens 就需要智能摘要
      const MAX_TOKENS = 30000;
      
      let messagesContent;
      let summary = '';
      
      if (estimatedTokens > MAX_TOKENS || messageCount > 50) {
        // 长对话：只保留开头 5 条 + 结尾 10 条，中间摘要
        const firstMessages = data.messages.slice(0, 5);
        const lastMessages = data.messages.slice(-10);
        const middleCount = messageCount - 15;
        
        messagesContent = [
          ...firstMessages.map(m => `【${m.role === 'user' ? '用户' : 'ChatGPT'}】\n${m.content}`),
          `\n[... 中间省略 ${middleCount} 条消息 ...]\n`,
          ...lastMessages.map(m => `【${m.role === 'user' ? '用户' : 'ChatGPT'}】\n${m.content}`)
        ].join('\n\n---\n\n');
        
        summary = `\n⚠️ **注意**：原对话共 ${messageCount} 条消息，估计 ${estimatedTokens.toLocaleString()} tokens。为了适应上下文窗口，已智能压缩：保留开头 5 条和最近 10 条消息。`;
      } else {
        // 短对话：全部保留
        messagesContent = data.messages.map(m => 
          `【${m.role === 'user' ? '用户' : 'ChatGPT'}】\n${m.content}`
        ).join('\n\n---\n\n');
      }
      
      return `请基于以下之前的对话上下文继续我们的讨论：

📝 **对话信息**
- 标题：${data.title || '未知'}
- 总消息数：${messageCount} 条
- 导出时间：${data.exportedAt ? new Date(data.exportedAt).toLocaleString('zh-CN') : '未知'}${summary}

=== 对话内容 ===

${messagesContent}

=== 对话结束 ===

请先确认你已理解上述对话上下文，然后我们继续。`;
    },

    // 触发发送
    triggerSend() {
      const sendButtonSelectors = [
        'button[data-testid="send-button"]',
        'button[data-testid="fruitjuice-send-button"]',
        'form button[type="submit"]',
        'button[aria-label*="Send"]',
        'button[aria-label*="发送"]'
      ];
      
      for (const selector of sendButtonSelectors) {
        const btn = document.querySelector(selector);
        if (btn && !btn.disabled) {
          btn.click();
          console.log('[ChatGPT Saver] 已触发发送按钮');
          return;
        }
      }
      
      console.warn('[ChatGPT Saver] 未找到可用的发送按钮');
    },

    sleep(ms) {
      return new Promise(resolve => setTimeout(resolve, ms));
    }
  };

  // ==================== 更新检查器 ====================
  const UpdateChecker = {
    // 检查更新
    async checkForUpdate(manual = false) {
      const lastCheck = GM_getValue('lastUpdateCheck', 0);
      const now = Date.now();
      
      // 如果不是手动检查，且距离上次检查不到 3 天，则跳过
      if (!manual && (now - lastCheck) < CONFIG.updateCheckInterval) {
        console.log('[ChatGPT Saver] 距离上次检查不到 3 天，跳过自动检查');
        return null;
      }
      
      if (manual) {
        UI.showToast('⚙️ 正在检查更新...', 'info', 0);
      }
      
      try {
        const remoteVersion = await this.fetchRemoteVersion();
        GM_setValue('lastUpdateCheck', now);
        
        if (!remoteVersion) {
          if (manual) {
            // 网络失败时提供手动检查链接
            UI.showToast('❌ 网络请求失败，可能是网络问题', 'error', 5000);
            // 显示手动检查指引
            this.showManualCheckGuide();
          }
          return null;
        }
        
        const hasUpdate = this.compareVersions(remoteVersion, CONFIG.currentVersion) > 0;
        
        if (hasUpdate) {
          console.log(`[ChatGPT Saver] 发现新版本: ${remoteVersion} (当前: ${CONFIG.currentVersion})`);
          this.showUpdateNotification(remoteVersion, manual);
          return { hasUpdate: true, remoteVersion };
        } else {
          console.log(`[ChatGPT Saver] 已是最新版本: ${CONFIG.currentVersion}`);
          if (manual) {
            UI.showToast(`✅ 已是最新版本 (v${CONFIG.currentVersion})`, 'success', 3000);
          }
          return { hasUpdate: false, remoteVersion };
        }
      } catch (e) {
        console.error('[ChatGPT Saver] 检查更新失败:', e);
        if (manual) {
          UI.showToast('❌ 检查更新失败', 'error', 3000);
        }
        return null;
      }
    },
    
    // 从远程获取版本号
    fetchRemoteVersion() {
      return new Promise((resolve) => {
        // 检查 GM_xmlhttpRequest 是否可用
        if (typeof GM_xmlhttpRequest === 'undefined') {
          console.error('[ChatGPT Saver] GM_xmlhttpRequest 不可用');
          resolve(null);
          return;
        }
        
        console.log('[ChatGPT Saver] 正在请求:', CONFIG.updateURL);
        
        GM_xmlhttpRequest({
          method: 'GET',
          url: CONFIG.updateURL + '?t=' + Date.now(), // 缓存破坏
          timeout: 15000, // 增加超时时间
          headers: {
            'Cache-Control': 'no-cache'
          },
          onload: (response) => {
            console.log('[ChatGPT Saver] 请求响应状态:', response.status);
            if (response.status === 200) {
              // 从脚本头部提取版本号
              const match = response.responseText.match(/@version\s+([\d.]+)/);
              if (match) {
                console.log('[ChatGPT Saver] 获取到远程版本:', match[1]);
                resolve(match[1]);
              } else {
                console.error('[ChatGPT Saver] 无法解析版本号');
                resolve(null);
              }
            } else {
              console.error('[ChatGPT Saver] 请求失败:', response.status);
              resolve(null);
            }
          },
          onerror: (error) => {
            console.error('[ChatGPT Saver] 网络请求错误:', error);
            resolve(null);
          },
          ontimeout: () => {
            console.error('[ChatGPT Saver] 请求超时');
            resolve(null);
          }
        });
      });
    },
    
    // 版本号比较：返回 1 表示 v1 > v2，0 表示相等，-1 表示 v1 < v2
    compareVersions(v1, v2) {
      const parts1 = v1.split('.').map(Number);
      const parts2 = v2.split('.').map(Number);
      
      for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
        const num1 = parts1[i] || 0;
        const num2 = parts2[i] || 0;
        if (num1 > num2) return 1;
        if (num1 < num2) return -1;
      }
      return 0;
    },
    
    // 显示更新通知
    showUpdateNotification(newVersion, isManual) {
      // 使用 GM_notification 显示系统通知
      GM_notification({
        title: 'ChatGPT 对话保存助手',
        text: `发现新版本 v${newVersion}！\n点击此处更新`,
        timeout: 10000,
        onclick: () => this.openUpdatePage()
      });
      
      // 同时在页面上显示 Toast
      UI.showToast(`🆕 发现新版本 v${newVersion}，点击更新`, 'success', 0);
      
      // 在面板上显示更新按钮
      this.showUpdateButton(newVersion);
    },
    
    // 在面板上显示更新按钮
    showUpdateButton(newVersion) {
      const updateArea = document.getElementById('saver-update-area');
      if (updateArea) {
        updateArea.style.display = 'block';
        updateArea.innerHTML = `
          <div style="background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%); border-radius: 8px; padding: 10px 12px; margin-bottom: 8px;">
            <div style="font-size: 12px; font-weight: 600; color: #92400e; margin-bottom: 6px;">🆕 发现新版本 v${newVersion}</div>
            <button id="saver-do-update" style="
              width: 100%; padding: 8px; border: none; border-radius: 6px;
              background: #f59e0b; color: white; font-size: 12px; font-weight: 600;
              cursor: pointer; transition: background 0.2s;
            "点击立即更新</button>
          </div>
        `;
        document.getElementById('saver-do-update').onclick = () => this.openUpdatePage();
      }
    },
    
    // 打开更新页面
    openUpdatePage() {
      window.open(CONFIG.updateURL, '_blank');
    },
    
    // 显示手动检查指引（网络失败时）
    showManualCheckGuide() {
      const updateArea = document.getElementById('saver-update-area');
      if (updateArea) {
        updateArea.style.display = 'block';
        updateArea.innerHTML = `
          <div style="background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%); border-radius: 8px; padding: 10px 12px; margin-bottom: 8px;">
            <div style="font-size: 12px; font-weight: 600; color: #92400e; margin-bottom: 6px;">⚠️ 无法自动检查更新</div>
            <div style="font-size: 11px; color: #78350f; margin-bottom: 8px; line-height: 1.5;">
              可能是网络问题（raw.githubusercontent.com 在国内访问可能不稳定）。<br/>
              你可以点击下方按钮手动查看最新版本：
            </div>
            <button id="saver-manual-check" style="
              width: 100%; padding: 8px; border: none; border-radius: 6px;
              background: #f59e0b; color: white; font-size: 12px; font-weight: 600;
              cursor: pointer; transition: background 0.2s;
            ">打开 GitHub 查看最新版本</button>
            <div style="font-size: 10px; color: #78350f; margin-top: 6px; opacity: 0.8;">
              当前版本: v${CONFIG.currentVersion}
            </div>
          </div>
        `;
        document.getElementById('saver-manual-check').onclick = () => {
          window.open('https://github.com/a182860089-pixel/massage', '_blank');
        };
      }
    },
    
    // 自动检查（启动时调用）
    autoCheck() {
      // 延迟 5 秒检查，不阻塞页面加载
      setTimeout(() => {
        this.checkForUpdate(false);
      }, 5000);
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

  // 小鹿图标（内联 SVG，支持动画）
  const DEER_ICON_SVG = `
    <svg class="saver-deer-icon" viewBox="0 -5 50 65" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="faceGrad" x1="50%" y1="0%" x2="50%" y2="100%">
          <stop offset="0%" stop-color="#B8E4F9"/>
          <stop offset="100%" stop-color="#8DD0F0"/>
        </linearGradient>
        <linearGradient id="antlerGrad" x1="50%" y1="0%" x2="50%" y2="100%">
          <stop offset="0%" stop-color="#E8C896"/>
          <stop offset="100%" stop-color="#D4A86A"/>
        </linearGradient>
      </defs>
      <!-- 左鹿角 -->
      <path d="M11 16 Q 8 10 9 3 Q 10 -2 13 0 Q 15 2 14 8 L 14 11 Q 17 6 20 8 Q 22 10 18 14 Q 16 17 14 18 Z" fill="url(#antlerGrad)"/>
      <!-- 右鹿角 -->
      <path d="M39 16 Q 42 10 41 3 Q 40 -2 37 0 Q 35 2 36 8 L 36 11 Q 33 6 30 8 Q 28 10 32 14 Q 34 17 36 18 Z" fill="url(#antlerGrad)"/>
      <!-- 左耳朵 -->
      <ellipse cx="4" cy="32" rx="5" ry="7" fill="#9DD5F3" stroke="#5B9FC7" stroke-width="1"/>
      <ellipse cx="4.5" cy="32" rx="2.5" ry="4.5" fill="#B8E4F9"/>
      <!-- 右耳朵 -->
      <ellipse cx="46" cy="32" rx="5" ry="7" fill="#9DD5F3" stroke="#5B9FC7" stroke-width="1"/>
      <ellipse cx="45.5" cy="32" rx="2.5" ry="4.5" fill="#B8E4F9"/>
      <!-- 脸 -->
      <circle cx="25" cy="35" r="23" fill="url(#faceGrad)" stroke="#5B9FC7" stroke-width="1.5"/>
      <!-- 左眼（开着） -->
      <g class="deer-eye-left">
        <ellipse cx="17" cy="36" rx="5" ry="5.5" fill="#3D5A6E"/>
        <ellipse cx="17" cy="36" rx="4" ry="4.5" fill="#2C4356"/>
        <circle cx="15.5" cy="34.5" r="2.2" fill="white"/>
        <circle cx="18" cy="37.5" r="1" fill="white" opacity="0.6"/>
      </g>
      <!-- 左眼（闭着 - 用于眨眼） -->
      <path class="deer-eye-left-closed" d="M12 36 Q17 38 22 36" stroke="#2C4356" stroke-width="2" fill="none" stroke-linecap="round" style="display:none;"/>
      <!-- 右眼（开着） -->
      <g class="deer-eye-right">
        <ellipse cx="33" cy="36" rx="5" ry="5.5" fill="#3D5A6E"/>
        <ellipse cx="33" cy="36" rx="4" ry="4.5" fill="#2C4356"/>
        <circle cx="31.5" cy="34.5" r="2.2" fill="white"/>
        <circle cx="34" cy="37.5" r="1" fill="white" opacity="0.6"/>
      </g>
      <!-- 右眼（闭着 - 用于眨眼） -->
      <path class="deer-eye-right-closed" d="M28 36 Q33 38 38 36" stroke="#2C4356" stroke-width="2" fill="none" stroke-linecap="round" style="display:none;"/>
      <!-- 鼻子 -->
      <ellipse cx="25" cy="44" rx="2.8" ry="2" fill="#3D5A6E"/>
      <ellipse cx="24.5" cy="43.5" rx="1" ry="0.6" fill="white" opacity="0.4"/>
      <!-- 嘴巴（普通微笑） -->
      <path class="deer-mouth" d="M22 47 Q25 50 28 47" stroke="#3D5A6E" stroke-width="1.3" fill="none" stroke-linecap="round"/>
      <!-- 嘴巴（开心大笑 - 隐藏） -->
      <path class="deer-mouth-happy" d="M20 46 Q25 53 30 46" stroke="#3D5A6E" stroke-width="1.5" fill="none" stroke-linecap="round" style="display:none;"/>
      <!-- 腮红 -->
      <ellipse class="deer-blush-left" cx="9" cy="42" rx="3.5" ry="2.2" fill="#F5A9B8" opacity="0.45"/>
      <ellipse class="deer-blush-right" cx="41" cy="42" rx="3.5" ry="2.2" fill="#F5A9B8" opacity="0.45"/>
      <!-- 额头代码标记 -->
      <text x="25" y="27" font-size="7" fill="white" text-anchor="middle" font-family="Consolas,monospace" font-weight="bold" opacity="0.85">&lt;/&gt;</text>
    </svg>
  `;

  // 保留旧变量名兼容
  const DEER_ICON_URL = 'data:image/svg+xml,' + encodeURIComponent('<svg viewBox="0 0 50 60"></svg>');
  const FACE_IMG_URL = DEER_ICON_URL;
  const ANTLERS_IMG_URL = DEER_ICON_URL;
  const LOGO_IMG_URL = DEER_ICON_URL;
  const LOGO_SVG = DEER_ICON_SVG;

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
        :root {
          --saver-bg: #ffffff;
          --saver-text: #333333;
          --saver-sub-text: #666666;
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

        :root.saver-dark {
          --saver-bg: #2d2d2d;
          --saver-text: #e0e0e0;
          --saver-sub-text: #aaaaaa;
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
          position: fixed; bottom: 20px; right: 20px; width: 50px; height: 65px;
          background: transparent;
          border: none; cursor: grab; z-index: 99999;
          box-shadow: none;
          display: flex; align-items: flex-end; justify-content: center;
          transition: transform 0.2s;
          padding: 0;
          overflow: visible;
          user-select: none;
          touch-action: none;
        }
        #chatgpt-saver-btn.dragging {
          cursor: grabbing;
          transform: scale(1.1);
          transition: none;
          z-index: 99999 !important; /* 拖动时提升到最高层，防止被遮挡 */
        }
        #chatgpt-saver-btn .saver-deer-icon {
          width: 50px;
          height: 65px;
          pointer-events: none;
          filter: drop-shadow(0 3px 8px rgba(135, 206, 235, 0.5));
          animation: deerBounce 2.5s ease-in-out infinite;
        }
        #chatgpt-saver-btn:hover:not(.dragging) { transform: scale(1.1); }
        #chatgpt-saver-btn:hover .saver-deer-icon { animation: deerWiggle 0.5s ease-in-out infinite; }
        #chatgpt-saver-btn.dragging .saver-deer-icon { animation: none; }
        
        @keyframes deerBounce {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-3px); }
        }
        @keyframes deerWiggle {
          0%, 100% { transform: rotate(0deg); }
          25% { transform: rotate(-5deg); }
          75% { transform: rotate(5deg); }
        }

        /* Toast 通知样式 */
        #chatgpt-saver-toast {
          position: fixed;
          background: rgba(0, 0, 0, 0.85); color: white;
          padding: 10px 16px; border-radius: 8px;
          font-size: 13px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          z-index: 99998; opacity: 0; transform: translateY(10px);
          transition: opacity 0.3s ease, transform 0.3s ease; pointer-events: none;
          max-width: 220px; text-align: center;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
          white-space: nowrap;
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

        /* 面板样式 */
        #chatgpt-saver-panel {
          position: fixed; bottom: 80px; right: 20px; width: 320px;
          background: var(--saver-bg); border-radius: 16px; z-index: 10003;
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
        .saver-format-btn span { display: block; font-size: 12px; color: var(--saver-sub-text); margin-top: 4px; }

        .saver-action-btn {
          width: 100%; padding: 12px; border: none; border-radius: 8px;
          background: var(--saver-primary-btn-bg);
          color: var(--saver-primary-btn-text); font-size: 14px; font-weight: 600; cursor: pointer;
          margin-bottom: 8px; transition: opacity 0.2s;
        }
        .saver-action-btn:hover { opacity: 0.9; }
        .saver-action-btn.secondary { background: var(--saver-sec-btn-bg); color: var(--saver-sec-btn-text); }

        .saver-status { font-size: 12px; color: var(--saver-sub-text); text-align: center; padding-top: 8px; border-top: 1px solid var(--saver-border); }
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

        /* 导入预览弹窗 */
        .saver-import-modal {
          position: fixed; top: 0; left: 0; right: 0; bottom: 0;
          background: rgba(0, 0, 0, 0.6); z-index: 10005;
          display: flex; align-items: center; justify-content: center;
          opacity: 0; visibility: hidden; transition: all 0.3s ease;
        }
        .saver-import-modal.show { opacity: 1; visibility: visible; }
        
        .saver-import-dialog {
          background: var(--saver-bg); border-radius: 16px; width: 90%; max-width: 500px;
          max-height: 80vh; overflow: hidden; box-shadow: 0 20px 60px rgba(0,0,0,0.3);
          display: flex; flex-direction: column;
          border: 1px solid var(--saver-border);
        }
        
        .saver-import-header {
          padding: 20px; background: var(--saver-header-bg);
          color: var(--saver-header-text);
        }
        .saver-import-header h3 { margin: 0 0 4px 0; font-size: 18px; font-weight: 600; }
        .saver-import-header p { margin: 0; font-size: 13px; opacity: 0.7; }
        
        .saver-import-content { padding: 20px; overflow-y: auto; flex: 1; }
        
        .saver-import-preview {
          background: var(--saver-log-bg); border-radius: 8px; padding: 12px;
          font-size: 12px; max-height: 200px; overflow-y: auto;
          font-family: 'Consolas', 'Monaco', monospace; white-space: pre-wrap;
          word-break: break-all; color: var(--saver-log-text);
          border: 1px solid var(--saver-border);
        }
        
        .saver-import-meta {
          margin-top: 16px; padding: 12px; background: var(--saver-format-bg);
          border-radius: 8px; font-size: 13px;
          border: 1px solid var(--saver-border);
        }
        .saver-import-meta-item {
          display: flex; justify-content: space-between; padding: 4px 0;
          border-bottom: 1px solid var(--saver-border);
        }
        .saver-import-meta-item:last-child { border-bottom: none; }
        .saver-import-meta-label { color: var(--saver-sub-text); opacity: 0.8; }
        .saver-import-meta-value { font-weight: 600; color: var(--saver-text); }
        
        .saver-import-options {
          margin-top: 16px; padding: 12px; background: var(--saver-format-bg);
          border-radius: 8px;
          border: 1px solid var(--saver-border);
        }
        .saver-import-options label {
          display: flex; align-items: center; gap: 8px; cursor: pointer;
          padding: 8px 0; font-size: 14px; color: var(--saver-text);
        }
        .saver-import-options input[type="checkbox"] {
          width: 18px; height: 18px; cursor: pointer;
        }
        
        .saver-import-footer {
          padding: 16px 20px; border-top: 1px solid var(--saver-border);
          display: flex; gap: 12px; justify-content: flex-end;
          background: var(--saver-bg);
        }
        
        .saver-import-btn {
          padding: 10px 20px; border-radius: 8px; font-size: 14px; font-weight: 600;
          cursor: pointer; border: none; transition: all 0.2s;
        }
        .saver-import-btn.primary {
          background: var(--saver-primary-btn-bg); color: var(--saver-primary-btn-text);
        }
        .saver-import-btn.primary:hover { opacity: 0.9; transform: translateY(-1px); }
        .saver-import-btn.secondary {
          background: var(--saver-sec-btn-bg); color: var(--saver-sec-btn-text);
        }
        .saver-import-btn.secondary:hover { opacity: 0.8; }
        
        /* 隐藏的文件选择器 */
        #saver-file-input { display: none; }
        
        /* 附件选择器弹窗 */
        .saver-attachment-modal {
          position: fixed; top: 0; left: 0; right: 0; bottom: 0;
          background: rgba(0, 0, 0, 0.6); z-index: 10006;
          display: flex; align-items: center; justify-content: center;
          opacity: 0; visibility: hidden; transition: all 0.3s ease;
        }
        .saver-attachment-modal.show { opacity: 1; visibility: visible; }
        
        .saver-attachment-dialog {
          background: var(--saver-bg); border-radius: 16px; width: 90%; max-width: 600px;
          max-height: 80vh; overflow: hidden; box-shadow: 0 20px 60px rgba(0,0,0,0.3);
          display: flex; flex-direction: column;
          border: 1px solid var(--saver-border);
        }
        
        .saver-attachment-header {
          padding: 20px; background: var(--saver-header-bg);
          color: var(--saver-header-text);
        }
        .saver-attachment-header h3 { margin: 0 0 4px 0; font-size: 18px; font-weight: 600; }
        .saver-attachment-header p { margin: 0; font-size: 13px; opacity: 0.7; }
        
        .saver-attachment-content { padding: 20px; overflow-y: auto; flex: 1; }
        
        #saver-attachment-list { margin-bottom: 16px; }
        
        .saver-attachment-item {
          display: flex; align-items: center; gap: 12px; padding: 12px;
          background: var(--saver-format-bg); border-radius: 8px; margin-bottom: 8px;
          border: 1px solid var(--saver-border);
        }
        .saver-attach-icon { font-size: 20px; }
        .saver-attach-name { flex: 1; font-size: 13px; color: var(--saver-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .saver-attach-select-btn {
          padding: 6px 12px; border-radius: 6px; font-size: 12px; border: none;
          background: var(--saver-sec-btn-bg); color: var(--saver-sec-btn-text);
          cursor: pointer; transition: all 0.2s;
        }
        .saver-attach-select-btn:hover { opacity: 0.8; }
        .saver-attach-status { font-size: 12px; color: var(--saver-sub-text); min-width: 80px; }
        
        .saver-attachment-hint {
          padding: 12px; background: var(--saver-log-bg); border-radius: 8px;
          font-size: 12px; color: var(--saver-log-text); border: 1px solid var(--saver-border);
          line-height: 1.6;
        }
        
        /* 收集文件夹区域 */
        .saver-collection-area {
          margin-bottom: 16px; padding: 12px; background: var(--saver-format-bg);
          border-radius: 8px; border: 1px solid var(--saver-border);
        }
        .saver-collection-header {
          display: flex; justify-content: space-between; align-items: center;
          margin-bottom: 12px; font-weight: 600; font-size: 13px;
          color: var(--saver-text);
        }
        .saver-collection-set-btn {
          padding: 4px 12px; border-radius: 6px; font-size: 12px; border: none;
          background: var(--saver-sec-btn-bg); color: var(--saver-sec-btn-text);
          cursor: pointer; transition: all 0.2s;
        }
        .saver-collection-set-btn:hover { opacity: 0.8; }
        
        .saver-collection-files {
          max-height: 150px; overflow-y: auto;
        }
        .saver-collection-empty {
          text-align: center; padding: 20px; font-size: 12px;
          color: var(--saver-sub-text); opacity: 0.8;
        }
        .saver-collection-folder-name {
          font-size: 12px; font-weight: 600; margin-bottom: 8px;
          color: var(--saver-text); opacity: 0.9;
        }
        .saver-collection-list {
          display: flex; flex-direction: column; gap: 4px;
        }
        .saver-collection-file {
          display: flex; align-items: center; gap: 8px; padding: 8px;
          background: var(--saver-bg); border-radius: 6px; cursor: pointer;
          transition: all 0.2s; border: 1px solid var(--saver-border);
        }
        .saver-collection-file:hover {
          background: var(--saver-format-active-bg); border-color: #10a37f;
        }
        .saver-collection-file.selected {
          background: #e6f7f2; border-color: #10a37f;
        }
        .saver-collection-file-icon { font-size: 16px; }
        .saver-collection-file-name {
          flex: 1; font-size: 12px; overflow: hidden; text-overflow: ellipsis;
          white-space: nowrap; color: var(--saver-text);
        }
        .saver-collection-file-size {
          font-size: 11px; color: var(--saver-sub-text); opacity: 0.7;
        }
        
        .saver-detected-header {
          font-weight: 600; font-size: 13px; margin-bottom: 8px;
          color: var(--saver-text);
        }
        
        .saver-attach-copy-btn {
          padding: 4px 8px; border-radius: 4px; font-size: 12px; border: none;
          background: var(--saver-sec-btn-bg); cursor: pointer;
          transition: all 0.2s; margin-left: 4px;
        }
        .saver-attach-copy-btn:hover { opacity: 0.8; transform: scale(1.1); }
        
        .saver-attachment-footer {
          padding: 16px 20px; border-top: 1px solid var(--saver-border);
          display: flex; gap: 12px; justify-content: flex-end;
          background: var(--saver-bg);
        }
        
        /* 分隔线 */
        .saver-divider {
          height: 1px; background: var(--saver-border); margin: 12px 0;
        }
        
        /* 按钮组样式优化 */
        .saver-btn-group {
          display: flex; gap: 8px; margin-bottom: 8px;
        }
        .saver-btn-group .saver-action-btn {
          flex: 1; margin-bottom: 0;
          pointer-events: auto !important;
          cursor: pointer !important;
        }
      `);
    },

    createFloatingButton() {
      const btn = document.createElement('button');
      btn.id = 'chatgpt-saver-btn';

      // 内联 SVG，支持动画
      btn.innerHTML = DEER_ICON_SVG;

      btn.title = 'ChatGPT 对话保存助手 (可拖动)';
      document.body.appendChild(btn);

      // 启动表情动画
      this.startDeerAnimations(btn);

      // 拖动功能
      this.initDraggable(btn);
    },
    
    // 小鹿表情动画
    startDeerAnimations(btn) {
      const blink = () => {
        const eyeLeftOpen = btn.querySelector('.deer-eye-left');
        const eyeLeftClosed = btn.querySelector('.deer-eye-left-closed');
        const eyeRightOpen = btn.querySelector('.deer-eye-right');
        const eyeRightClosed = btn.querySelector('.deer-eye-right-closed');
        
        if (!eyeLeftOpen) return;
        
        // 闭眼
        eyeLeftOpen.style.display = 'none';
        eyeLeftClosed.style.display = 'block';
        eyeRightOpen.style.display = 'none';
        eyeRightClosed.style.display = 'block';
        
        // 150ms 后睁开
        setTimeout(() => {
          eyeLeftOpen.style.display = 'block';
          eyeLeftClosed.style.display = 'none';
          eyeRightOpen.style.display = 'block';
          eyeRightClosed.style.display = 'none';
        }, 150);
      };
      
      // 随机眨眼（2-5秒一次）
      const scheduleBlink = () => {
        const delay = 2000 + Math.random() * 3000;
        setTimeout(() => {
          blink();
          scheduleBlink();
        }, delay);
      };
      scheduleBlink();
      
      // 悬停时开心大笑
      btn.addEventListener('mouseenter', () => {
        const mouthNormal = btn.querySelector('.deer-mouth');
        const mouthHappy = btn.querySelector('.deer-mouth-happy');
        const blushLeft = btn.querySelector('.deer-blush-left');
        const blushRight = btn.querySelector('.deer-blush-right');
        
        if (mouthNormal) mouthNormal.style.display = 'none';
        if (mouthHappy) mouthHappy.style.display = 'block';
        if (blushLeft) blushLeft.setAttribute('opacity', '0.7');
        if (blushRight) blushRight.setAttribute('opacity', '0.7');
      });
      
      btn.addEventListener('mouseleave', () => {
        const mouthNormal = btn.querySelector('.deer-mouth');
        const mouthHappy = btn.querySelector('.deer-mouth-happy');
        const blushLeft = btn.querySelector('.deer-blush-left');
        const blushRight = btn.querySelector('.deer-blush-right');
        
        if (mouthNormal) mouthNormal.style.display = 'block';
        if (mouthHappy) mouthHappy.style.display = 'none';
        if (blushLeft) blushLeft.setAttribute('opacity', '0.45');
        if (blushRight) blushRight.setAttribute('opacity', '0.45');
      });
    },
    
    initDraggable(btn) {
      let isDragging = false;
      let hasMoved = false;
      let startX, startY, startLeft, startTop;
      
      // 从存储恢复位置
      const savedPos = GM_getValue('btnPosition', null);
      if (savedPos) {
        btn.style.right = 'auto';
        btn.style.bottom = 'auto';
        btn.style.left = savedPos.left + 'px';
        btn.style.top = savedPos.top + 'px';
      }
      
      const onMouseDown = (e) => {
        // 只响应左键
        if (e.button !== 0) return;
        
        isDragging = true;
        hasMoved = false;
        btn.classList.add('dragging');
        
        const rect = btn.getBoundingClientRect();
        startX = e.clientX;
        startY = e.clientY;
        startLeft = rect.left;
        startTop = rect.top;
        
        e.preventDefault();
      };
      
      const onMouseMove = (e) => {
        if (!isDragging) return;
        
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        
        // 如果移动距离超过 5px，认为是拖动
        if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
          hasMoved = true;
        }
        
        let newLeft = startLeft + dx;
        let newTop = startTop + dy;
        
        // 限制在视窗内
        const maxX = window.innerWidth - btn.offsetWidth;
        const maxY = window.innerHeight - btn.offsetHeight;
        newLeft = Math.max(0, Math.min(newLeft, maxX));
        newTop = Math.max(0, Math.min(newTop, maxY));
        
        btn.style.right = 'auto';
        btn.style.bottom = 'auto';
        btn.style.left = newLeft + 'px';
        btn.style.top = newTop + 'px';
      };
      
      const onMouseUp = () => {
        if (!isDragging) return;
        
        isDragging = false;
        btn.classList.remove('dragging');
        
        // 保存位置
        if (hasMoved) {
          const rect = btn.getBoundingClientRect();
          GM_setValue('btnPosition', { left: rect.left, top: rect.top });
        }
      };
      
      const onClick = (e) => {
        // 如果刚才拖动过，不触发点击
        if (hasMoved) {
          e.preventDefault();
          e.stopPropagation();
          hasMoved = false;
          return;
        }
        this.togglePanel();
      };
      
      btn.addEventListener('mousedown', onMouseDown);
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
      btn.addEventListener('click', onClick);
      
      // 触屏支持
      btn.addEventListener('touchstart', (e) => {
        const touch = e.touches[0];
        onMouseDown({ button: 0, clientX: touch.clientX, clientY: touch.clientY, preventDefault: () => {} });
      }, { passive: true });
      
      document.addEventListener('touchmove', (e) => {
        if (!isDragging) return;
        const touch = e.touches[0];
        onMouseMove({ clientX: touch.clientX, clientY: touch.clientY });
      }, { passive: true });
      
      document.addEventListener('touchend', onMouseUp);
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
      
      // 让 Toast 跟随悬浮按钮位置
      const btn = document.getElementById('chatgpt-saver-btn');
      if (btn) {
        const rect = btn.getBoundingClientRect();
        // 显示在按钮上方
        this.toast.style.left = 'auto';
        this.toast.style.right = 'auto';
        this.toast.style.bottom = 'auto';
        this.toast.style.top = 'auto';
        
        const toastHeight = 40; // 预估高度
        const gap = 10;
        
        // 根据按钮位置决定 Toast 显示在上方还是下方
        if (rect.top > toastHeight + gap + 20) {
          // 显示在按钮上方
          this.toast.style.bottom = (window.innerHeight - rect.top + gap) + 'px';
        } else {
          // 显示在按钮下方
          this.toast.style.top = (rect.bottom + gap) + 'px';
        }
        
        // 水平居中对齐按钮
        const btnCenterX = rect.left + rect.width / 2;
        this.toast.style.left = btnCenterX + 'px';
        this.toast.style.transform = 'translateX(-50%)' + (this.toast.classList.contains('show') ? '' : ' translateY(10px)');
      }
      
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
          
          <div class="saver-divider"></div>
          <div style="font-size: 12px; color: #666; margin-bottom: 8px; font-weight: 600;">🔄 上下文传递</div>
          <div class="saver-btn-group">
            <button class="saver-action-btn secondary" id="saver-export-context" style="font-size: 12px; padding: 10px;">📤 导出上下文</button>
            <button class="saver-action-btn secondary" id="saver-import-context" style="font-size: 12px; padding: 10px;">📥 导入上下文</button>
          </div>
          <div class="saver-folder-status" id="saver-folder-status" style="margin-bottom: 8px; font-size: 12px; color: var(--saver-sub-text);">
            保存位置: <span id="saver-folder-name" style="color: var(--saver-active-color);">浏览器下载</span>
          </div>
          <div style="display: flex; gap: 8px; margin-bottom: 8px;">
            <button class="saver-action-btn secondary" id="saver-auto-toggle" style="font-size: 12px; padding: 8px; margin-bottom: 0; flex: 1; display: flex; align-items: center; justify-content: center; gap: 4px;">
              ${CONFIG.autoSave ? '✅ 自动保存' : '⚪ 自动保存'}
            </button>
            <button class="saver-action-btn secondary" id="saver-log-toggle" style="font-size: 12px; padding: 8px; margin-bottom: 0; flex: 1; display: flex; align-items: center; justify-content: center; gap: 4px;">
              ${CONFIG.showLogPanel ? '✅ 显示日志' : '⚪ 显示日志'}
            </button>
          </div>
          <div class="saver-status" id="saver-observer-status">
            状态: <span id="saver-observer-text">未启动</span>
            <span style="margin-left: 12px; color: var(--saver-sub-text);">v${CONFIG.currentVersion}</span>
            <button id="saver-check-update" style="
              margin-left: 8px; padding: 2px 8px; font-size: 11px;
              background: var(--saver-sec-btn-bg); color: var(--saver-sec-btn-text);
              border: 1px solid var(--saver-border); border-radius: 4px;
              cursor: pointer; transition: background 0.2s;
            ">检查更新</button>
          </div>
          
          <!-- 更新提示区域 -->
          <div id="saver-update-area" style="display: none;"></div>
          
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
        e.target.textContent = CONFIG.autoSave ? '✅ 自动保存' : '⚪ 自动保存';
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
        e.target.textContent = CONFIG.showLogPanel ? '✅ 显示日志' : '⚪ 显示日志';
      };

      // 导出上下文 JSON
      const exportContextBtn = document.getElementById('saver-export-context');
      if (exportContextBtn) {
        exportContextBtn.onclick = () => {
          console.log('[ChatGPT Saver] 导出上下文按钮被点击');
          ContextExporter.export();
        };
        console.log('[ChatGPT Saver] 导出上下文按钮事件已绑定');
      } else {
        console.error('[ChatGPT Saver] 找不到导出上下文按钮');
      }

      // 导入上下文
      const importContextBtn = document.getElementById('saver-import-context');
      if (importContextBtn) {
        importContextBtn.onclick = () => {
          console.log('[ChatGPT Saver] 导入上下文按钮被点击');
          ContextImporter.showModal();
        };
        console.log('[ChatGPT Saver] 导入上下文按钮事件已绑定');
      } else {
        console.error('[ChatGPT Saver] 找不到导入上下文按钮');
      }

      // 检查更新按钮
      const checkUpdateBtn = document.getElementById('saver-check-update');
      if (checkUpdateBtn) {
        checkUpdateBtn.onclick = () => {
          console.log('[ChatGPT Saver] 检查更新按钮被点击');
          UpdateChecker.checkForUpdate(true);
        };
      }
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
      const html = document.documentElement;
      const btn = document.getElementById('saver-theme-toggle');
      const panel = document.getElementById('chatgpt-saver-panel');
      
      if (this.theme === 'night') {
        html.classList.add('saver-dark');
        // 兼容旧逻辑，给panel也加上（虽然现在变量在root上，但保持以防万一）
        if(panel) panel.classList.add('saver-dark');
        if(btn) btn.textContent = '🌙';
      } else {
        html.classList.remove('saver-dark');
        if(panel) panel.classList.remove('saver-dark');
        if(btn) btn.textContent = '🌞';
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
    
    // 初始化附件管理器（恢复收集文件夹）
    await AttachmentManager.init();
    console.log('[ChatGPT Saver] 附件管理器已初始化');

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
      
      // 自动检查更新（每 3 天检查一次）
      UpdateChecker.autoCheck();
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
