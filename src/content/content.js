/**
 * ChatGPT 对话保存助手 - Content Script 主逻辑
 */

(function() {
  'use strict';
  
  // 全局错误处理 - 防止单点故障导致整个插件崩溃
  window.addEventListener('error', (event) => {
    if (event.filename?.includes('chat-massage') || event.filename?.includes('ChatGPTSaver')) {
      console.error('[ChatGPT Saver] 全局错误:', event.message, event.filename, event.lineno);
      // 不阻止默认处理，但记录错误
    }
  });
  
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason?.message || event.reason || 'Unknown';
    if (reason.includes('Extension context invalidated')) {
      console.log('[ChatGPT Saver] 插件已重载，请刷新页面');
      showRefreshPrompt();
    } else {
      console.error('[ChatGPT Saver] 未处理的 Promise 拒绝:', reason);
    }
  });
  
  // 配置
  const config = {
    autoSave: true,
    formats: { html: true, md: true, pdf: true },
    debounceDelay: 2000 // 保存防抖延迟
  };
  
  // 日志收集器（支持实时显示）
  const ExportLogger = {
    logs: [],
    panelVisible: false,
    
    clear() {
      this.logs = [];
    },
    
    add(message) {
      const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
      this.logs.push({ time, message });
      // 实时更新日志面板
      this.updatePanel();
    },
    
    getLogs() {
      return this.logs;
    },
    
    // 显示日志面板
    showPanel() {
      if (this.panelVisible) return;
      this.panelVisible = true;
      
      let panel = document.getElementById('chatgpt-saver-log-panel');
      if (!panel) {
        panel = document.createElement('div');
        panel.id = 'chatgpt-saver-log-panel';
        panel.style.cssText = `
          position: fixed;
          bottom: 20px;
          right: 20px;
          width: 420px;
          background: #1e1e1e;
          color: white;
          border-radius: 12px;
          font-size: 14px;
          z-index: 10000;
          animation: chatgpt-saver-slideIn 0.3s ease;
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          overflow: hidden;
        `;
        
        panel.innerHTML = `
          <div id="chatgpt-saver-log-header" style="
            padding: 12px 16px;
            background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
            display: flex;
            align-items: center;
            gap: 10px;
          ">
            <div id="chatgpt-saver-status-icon" style="font-size: 18px;">⏳</div>
            <div style="flex: 1;">
              <div id="chatgpt-saver-status-title" style="font-weight: 600;">正在导出...</div>
              <div id="chatgpt-saver-status-msg" style="font-size: 12px; opacity: 0.9;"></div>
            </div>
            <button id="chatgpt-saver-panel-close" style="
              background: rgba(255,255,255,0.2);
              border: none;
              color: white;
              font-size: 14px;
              cursor: pointer;
              padding: 4px 8px;
              border-radius: 4px;
            ">×</button>
          </div>
          <div id="chatgpt-saver-log-content" style="
            max-height: 280px;
            overflow-y: auto;
            padding: 12px;
            background: #252525;
            font-family: 'Consolas', 'Monaco', monospace;
          "></div>
        `;
        
        document.body.appendChild(panel);
        
        // 绑定关闭按钮
        document.getElementById('chatgpt-saver-panel-close').addEventListener('click', () => {
          this.hidePanel();
        });
      }
      
      // 重置状态
      this.setStatus('loading', '正在导出...', '');
      document.getElementById('chatgpt-saver-log-content').innerHTML = '';
    },
    
    // 隐藏日志面板
    hidePanel() {
      const panel = document.getElementById('chatgpt-saver-log-panel');
      if (panel) {
        panel.style.animation = 'chatgpt-saver-slideOut 0.3s ease forwards';
        setTimeout(() => panel.remove(), 300);
      }
      this.panelVisible = false;
    },
    
    // 更新日志面板内容
    updatePanel() {
      const content = document.getElementById('chatgpt-saver-log-content');
      if (!content) return;
      
      const lastLog = this.logs[this.logs.length - 1];
      if (lastLog) {
        const logItem = document.createElement('div');
        logItem.style.cssText = 'padding: 3px 0; border-bottom: 1px solid #333; font-size: 12px; line-height: 1.4;';
        logItem.innerHTML = `
          <span style="color: #888; margin-right: 8px;">${lastLog.time}</span>
          <span style="color: #d4d4d4;">${lastLog.message}</span>
        `;
        content.appendChild(logItem);
        content.scrollTop = content.scrollHeight;
      }
    },
    
    // 设置状态
    setStatus(type, title, message) {
      const header = document.getElementById('chatgpt-saver-log-header');
      const icon = document.getElementById('chatgpt-saver-status-icon');
      const titleEl = document.getElementById('chatgpt-saver-status-title');
      const msgEl = document.getElementById('chatgpt-saver-status-msg');
      
      if (!header) return;
      
      if (type === 'success') {
        header.style.background = 'linear-gradient(135deg, #10a37f 0%, #0d8a6a 100%)';
        icon.textContent = '✅';
      } else if (type === 'error') {
        header.style.background = 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)';
        icon.textContent = '❌';
      } else {
        header.style.background = 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)';
        icon.textContent = '⏳';
      }
      
      titleEl.textContent = title;
      msgEl.textContent = message;
    },
    
    // 完成导出（成功）
    complete(title, message) {
      this.setStatus('success', title, message);
      // 10秒后自动关闭
      setTimeout(() => this.hidePanel(), 10000);
    },
    
    // 导出失败
    fail(message) {
      this.setStatus('error', '导出失败', message);
      setTimeout(() => this.hidePanel(), 10000);
    }
  };
  
  // 全局暴露日志收集器
  window.ChatGPTSaver = window.ChatGPTSaver || {};
  window.ChatGPTSaver.Logger = ExportLogger;
  
  // 状态
  let isInitialized = false;
  let saveDebounceTimer = null;
  
  /**
   * 初始化插件
   */
  async function init() {
    if (isInitialized) {
      return;
    }
    
    console.log('ChatGPT 对话保存助手正在初始化...');
    
    // 等待页面加载
    await waitForPage();
    
    // 加载设置
    await loadSettings();
    
    // 尝试恢复文件夹授权
    await tryRestoreFileAccess();
    
    // 设置消息监听
    setupMessageListener();
    
    // 启动对话监听
    if (config.autoSave) {
      startAutoSave();
    }
    
    // 监听 URL 变化（对话切换）
    window.ChatGPTSaver.URLObserver.start(handleURLChange);
    
    isInitialized = true;
    console.log('ChatGPT 对话保存助手初始化完成');
    
    // 显示授权状态
    if (window.ChatGPTSaver.FileSystem.isAuthorized()) {
      console.log('✅ 文件夹已授权，自动保存已启用');
    } else {
      console.log('⚠️ 未授权文件夹，请点击插件图标进行授权');
    }
  }
  
  /**
   * 尝试恢复文件夹访问权限
   */
  async function tryRestoreFileAccess() {
    const restored = await window.ChatGPTSaver.FileSystem.tryRestoreAccess();
    if (restored) {
      console.log('文件夹访问权限已恢复');
    } else {
      // 权限恢复失败，同步更新 storage 状态，避免 popup 显示已授权但实际无法保存
      try {
        const storageState = await chrome.storage.local.get(['isAuthorized']);
        if (storageState.isAuthorized) {
          // storage 显示已授权但实际没有权限，清除授权状态
          await chrome.storage.local.set({ isAuthorized: false });
          console.log('⚠️ 文件夹权限已过期，请重新授权');
        }
      } catch (e) {
        // 忽略 storage 更新失败
      }
    }
  }
  
  /**
   * 等待页面加载完成
   */
  function waitForPage() {
    return new Promise((resolve) => {
      const checkReady = () => {
        const container = window.ChatGPTSaver.Parser.getConversationContainer();
        if (container) {
          resolve();
        } else {
          setTimeout(checkReady, 500);
        }
      };
      
      if (document.readyState === 'complete') {
        checkReady();
      } else {
        window.addEventListener('load', checkReady);
      }
    });
  }
  
  /**
   * 加载设置
   */
  async function loadSettings() {
    try {
      const result = await chrome.storage.local.get(['autoSave', 'exportFormats']);
      
      if (typeof result.autoSave !== 'undefined') {
        config.autoSave = result.autoSave;
      }
      
      if (result.exportFormats) {
        config.formats = result.exportFormats;
      }
    } catch (error) {
      console.error('加载设置失败:', error);
    }
  }
  
  /**
   * 设置消息监听（与 popup 通信）
   */
  function setupMessageListener() {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      handleMessage(request, sender, sendResponse);
      return true; // 保持消息通道开放
    });
  }
  
  /**
   * 处理消息
   */
  async function handleMessage(request, sender, sendResponse) {
    try {
      switch (request.action) {
        case 'requestFolderAccess':
          const accessResult = await window.ChatGPTSaver.FileSystem.requestFolderAccess();
          sendResponse(accessResult);
          break;
          
        case 'exportNow':
          const formats = request.formats || config.formats;
          const exportResult = await window.ChatGPTSaver.Exporter.exportConversation(formats);
          sendResponse(exportResult);
          break;
          
        case 'updateFormats':
          config.formats = request.formats;
          sendResponse({ success: true });
          break;
          
        case 'getStatus':
          sendResponse({
            isInitialized: isInitialized,
            isWatching: window.ChatGPTSaver.Observer.isActive(),
            canExport: window.ChatGPTSaver.Exporter.canExport()
          });
          break;
          
        default:
          sendResponse({ error: '未知操作' });
      }
    } catch (error) {
      console.error('处理消息失败:', error);
      sendResponse({ success: false, error: error.message });
    }
  }
  
  /**
   * 检查插件上下文是否有效
   */
  function isExtensionContextValid() {
    try {
      return !!(chrome.runtime && chrome.runtime.id);
    } catch (e) {
      return false;
    }
  }
  
  // 记录是否已显示过刷新提示
  let refreshPromptShown = false;
  
  /**
   * 显示刷新页面提示
   */
  function showRefreshPrompt() {
    if (refreshPromptShown) return;
    refreshPromptShown = true;
    
    // 创建提示框
    const overlay = document.createElement('div');
    overlay.id = 'chatgpt-saver-refresh-prompt';
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 99999;
    `;
    
    const dialog = document.createElement('div');
    dialog.style.cssText = `
      background: white;
      padding: 24px;
      border-radius: 12px;
      max-width: 400px;
      text-align: center;
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.2);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    `;
    
    dialog.innerHTML = `
      <div style="font-size: 48px; margin-bottom: 16px;">⚠️</div>
      <h2 style="margin: 0 0 12px 0; font-size: 18px; color: #333;">插件需要刷新</h2>
      <p style="margin: 0 0 20px 0; font-size: 14px; color: #666; line-height: 1.5;">
        ChatGPT 对话保存助手已更新，请刷新页面以继续自动保存功能。
      </p>
      <div style="display: flex; gap: 12px; justify-content: center;">
        <button id="chatgpt-saver-refresh-btn" style="
          background: #10a37f;
          color: white;
          border: none;
          padding: 10px 24px;
          border-radius: 6px;
          font-size: 14px;
          cursor: pointer;
          font-weight: 500;
        ">立即刷新</button>
        <button id="chatgpt-saver-dismiss-btn" style="
          background: #f3f4f6;
          color: #333;
          border: none;
          padding: 10px 24px;
          border-radius: 6px;
          font-size: 14px;
          cursor: pointer;
        ">稍后再说</button>
      </div>
    `;
    
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    
    // 绑定事件
    document.getElementById('chatgpt-saver-refresh-btn').addEventListener('click', () => {
      window.location.reload();
    });
    
    document.getElementById('chatgpt-saver-dismiss-btn').addEventListener('click', () => {
      overlay.remove();
    });
  }
  
  /**
   * 启动自动保存
   */
  function startAutoSave() {
    window.ChatGPTSaver.Observer.start(async () => {
      // 防抖处理
      if (saveDebounceTimer) {
        clearTimeout(saveDebounceTimer);
      }
      
      // 立即显示日志面板，提示用户即将保存
      if (window.ChatGPTSaver.FileSystem.isAuthorized()) {
        ExportLogger.clear();
        ExportLogger.showPanel();
        ExportLogger.add('⏳ 检测到对话变化，等待稳定后保存...');
      }
      
      saveDebounceTimer = setTimeout(async () => {
        // 检查是否已授权（不需要 chrome API）
        if (!window.ChatGPTSaver.FileSystem.isAuthorized()) {
          console.log('未授权文件夹访问，跳过自动保存');
          ExportLogger.hidePanel();
          return;
        }
        
        // 检查是否可以导出（不需要 chrome API）
        if (!window.ChatGPTSaver.Exporter.canExport()) {
          console.log('无可导出内容，跳过自动保存');
          ExportLogger.hidePanel();
          return;
        }
        
        console.log('触发自动保存...');
        
        try {
          const result = await window.ChatGPTSaver.Exporter.exportConversation(config.formats);
          
          if (result.success) {
            console.log('✅ 自动保存成功:', result.saved);
            // 日志面板已在 exporter.js 中处理
            // 尝试更新保存计数（可能失败，但不影响保存）
            updateSavedCount();
          } else {
            console.error('❌ 自动保存失败:', result.error);
          }
        } catch (error) {
          console.error('❌ 保存出错:', error);
          console.error('错误详情:', error.message, error.stack);
          // 如果是上下文失效错误，显示刷新提示
          if (error.message?.includes('Extension context invalidated')) {
            showRefreshPrompt();
          }
        }
      }, config.debounceDelay);
    });
  }
  
  /**
   * 处理 URL 变化（对话切换）
   */
  function handleURLChange(newURL) {
    console.log('对话切换:', newURL);
    
    // 停止当前观察器
    window.ChatGPTSaver.Observer.stop();
    
    // 清除之前的防抖定时器
    if (saveDebounceTimer) {
      clearTimeout(saveDebounceTimer);
      saveDebounceTimer = null;
    }
    
    // 立即显示日志面板
    if (window.ChatGPTSaver.FileSystem.isAuthorized()) {
      ExportLogger.clear();
      ExportLogger.showPanel();
      ExportLogger.add('🔄 切换对话，等待页面加载...');
    }
    
    // 等待新页面加载完成后重新初始化
    setTimeout(async () => {
      // 等待对话容器出现
      await waitForConversationReady();
      
      if (window.ChatGPTSaver.FileSystem.isAuthorized()) {
        ExportLogger.add('✅ 页面加载完成，开始保存...');
      }
      
      // 重新启动自动保存
      if (config.autoSave) {
        console.log('重新启动对话监听...');
        startAutoSave();
      }
    }, 1500);
  }
  
  /**
   * 等待对话容器准备就绪
   */
  function waitForConversationReady() {
    return new Promise((resolve) => {
      let attempts = 0;
      const maxAttempts = 20;
      
      const check = () => {
        attempts++;
        const container = window.ChatGPTSaver.Parser.getConversationContainer();
        const messages = window.ChatGPTSaver.Parser.getMessageElements();
        
        if (container && messages.length > 0) {
          console.log(`对话容器已就绪，共 ${messages.length} 条消息`);
          resolve();
        } else if (attempts < maxAttempts) {
          setTimeout(check, 500);
        } else {
          console.log('等待对话容器超时，继续启动监听');
          resolve();
        }
      };
      
      check();
    });
  }
  
  /**
   * 更新保存计数
   */
  async function updateSavedCount() {
    try {
      // 检查 chrome.runtime 是否可用
      if (!chrome.runtime?.id) {
        console.log('插件上下文已失效，跳过更新计数');
        return;
      }
      const result = await chrome.storage.local.get(['savedCount']);
      const newCount = (result.savedCount || 0) + 1;
      await chrome.storage.local.set({ savedCount: newCount });
    } catch (error) {
      // 忽略上下文失效错误
      if (error.message?.includes('Extension context invalidated')) {
        console.log('插件已重载，请刷新页面');
      } else {
        console.error('更新保存计数失败:', error);
      }
    }
  }
  
  /**
   * 显示带日志的通知弹框（日志默认展开）
   */
  function showNotification(title, message, type = 'success') {
    // 移除已有的通知
    const existing = document.getElementById('chatgpt-saver-notification');
    if (existing) {
      existing.remove();
    }
    
    const logs = ExportLogger.getLogs();
    const hasLogs = logs.length > 0;
    
    const notification = document.createElement('div');
    notification.id = 'chatgpt-saver-notification';
    notification.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      background: #1e1e1e;
      color: white;
      border-radius: 12px;
      font-size: 14px;
      z-index: 10000;
      animation: chatgpt-saver-slideIn 0.3s ease;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
      width: 400px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      overflow: hidden;
    `;
    
    // 构建日志 HTML（默认展开）
    let logsHtml = '';
    if (hasLogs) {
      const logItems = logs.map(log => 
        `<div style="padding: 3px 0; border-bottom: 1px solid #333; font-size: 12px; line-height: 1.4;">
          <span style="color: #888; margin-right: 8px;">${log.time}</span>
          <span style="color: #d4d4d4;">${log.message}</span>
        </div>`
      ).join('');
      
      logsHtml = `
        <div id="chatgpt-saver-logs" style="
          max-height: 250px;
          overflow-y: auto;
          padding: 12px;
          background: #252525;
          font-family: 'Consolas', 'Monaco', monospace;
        ">${logItems}</div>
      `;
    }
    
    notification.innerHTML = `
      <div style="
        padding: 12px 16px;
        background: ${type === 'success' ? 'linear-gradient(135deg, #10a37f 0%, #0d8a6a 100%)' : 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)'};
        display: flex;
        align-items: center;
        gap: 12px;
      ">
        <div style="font-size: 20px; line-height: 1;">${type === 'success' ? '✅' : '❌'}</div>
        <div style="flex: 1;">
          <div style="font-weight: 600;">${title}</div>
          <div style="font-size: 12px; opacity: 0.9;">${message}</div>
        </div>
        <button id="chatgpt-saver-close" style="
          background: rgba(255,255,255,0.2);
          border: none;
          color: white;
          font-size: 14px;
          cursor: pointer;
          padding: 4px 8px;
          border-radius: 4px;
          line-height: 1;
        ">×</button>
      </div>
      ${logsHtml}
    `;
    
    document.body.appendChild(notification);
    
    // 滚动日志到底部
    if (hasLogs) {
      const logsDiv = document.getElementById('chatgpt-saver-logs');
      logsDiv.scrollTop = logsDiv.scrollHeight;
    }
    
    // 绑定关闭按钮
    document.getElementById('chatgpt-saver-close').addEventListener('click', () => {
      notification.style.animation = 'chatgpt-saver-slideOut 0.3s ease forwards';
      setTimeout(() => notification.remove(), 300);
    });
    
    // 10秒后自动关闭
    setTimeout(() => {
      if (document.getElementById('chatgpt-saver-notification')) {
        notification.style.animation = 'chatgpt-saver-slideOut 0.3s ease forwards';
        setTimeout(() => notification.remove(), 300);
      }
    }, 10000);
  }
  
  // 添加动画样式
  const style = document.createElement('style');
  style.textContent = `
    @keyframes chatgpt-saver-slideIn {
      from {
        transform: translateX(100%);
        opacity: 0;
      }
      to {
        transform: translateX(0);
        opacity: 1;
      }
    }
    
    @keyframes chatgpt-saver-slideOut {
      from {
        transform: translateX(0);
        opacity: 1;
      }
      to {
        transform: translateX(100%);
        opacity: 0;
      }
    }
  `;
  document.head.appendChild(style);
  
  // 启动初始化
  init();
  
})();
