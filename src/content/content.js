/**
 * ChatGPT 对话保存助手 - Content Script 主逻辑
 * 使用与油猴版本一致的浮动面板 UI
 */

(function () {
  'use strict';

  // 全局错误处理
  window.addEventListener('error', (event) => {
    if (event.filename?.includes('chat-massage') || event.filename?.includes('ChatGPTSaver')) {
      console.error('[ChatGPT Saver] 全局错误:', event.message, event.filename, event.lineno);
    }
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason?.message || event.reason || 'Unknown';
    if (reason.includes('Extension context invalidated')) {
      console.log('[ChatGPT Saver] 插件已重载，请刷新页面');
      showRefreshPrompt();
    }
  });

  // 配置
  const config = {
    autoSave: true,
    formats: { html: true, md: true, pdf: true, json: true },
    showLogPanel: true,
    debounceDelay: 2000,
    currentVersion: '3.1',
    cardKeyAPI: 'https://seat.20050225.xyz/api/card-keys/verify'
  };

  // ==================== 卡密验证模块 ====================
  const CardKeyManager = {
    verified: false,
    cardData: null,
    recheckInterval: 6 * 60 * 60 * 1000, // 每6小时重新校验一次

    async init() {
      const r = await chrome.storage.local.get(['cardKeyData']);
      if (r.cardKeyData && r.cardKeyData.card_key) {
        // 有缓存的卡密，检查是否需要重新校验
        const lastCheck = r.cardKeyData.lastCheckTime || 0;
        const now = Date.now();
        if (now - lastCheck < this.recheckInterval && r.cardKeyData.valid) {
          // 缓存有效，检查剩余天数
          if (r.cardKeyData.remaining_days > 0) {
            this.verified = true;
            this.cardData = r.cardKeyData;
            return true;
          }
        }
        // 需要重新校验
        const result = await this.verify(r.cardKeyData.card_key);
        return result.valid;
      }
      return false;
    },

    async verify(cardKey) {
      try {
        const json = await new Promise((resolve) => {
          chrome.runtime.sendMessage(
            { action: 'verifyCardKey', apiUrl: config.cardKeyAPI, cardKey },
            (resp) => resolve(resp)
          );
        });
        if (json.success && json.data?.valid) {
          this.verified = true;
          this.cardData = {
            ...json.data,
            card_key: cardKey,
            lastCheckTime: Date.now()
          };
          await chrome.storage.local.set({ cardKeyData: this.cardData });
          return { valid: true, data: json.data };
        }
        this.verified = false;
        this.cardData = null;
        await chrome.storage.local.remove(['cardKeyData']);
        return { valid: false, message: json.message || '卡密无效' };
      } catch (e) {
        // 网络错误时，如果有缓存且未过期就放行
        const r = await chrome.storage.local.get(['cardKeyData']);
        if (r.cardKeyData?.valid && r.cardKeyData?.remaining_days > 0) {
          this.verified = true;
          this.cardData = r.cardKeyData;
          return { valid: true, data: r.cardKeyData };
        }
        return { valid: false, message: '网络错误，无法验证卡密' };
      }
    },

    async logout() {
      this.verified = false;
      this.cardData = null;
      await chrome.storage.local.remove(['cardKeyData']);
    },

    getRemainingDays() {
      return this.cardData?.remaining_days ?? 0;
    },

    getCardType() {
      return this.cardData?.card_type || '';
    },

    isUnlimited() {
      return this.cardData?.card_type === 'unlimited';
    }
  };

  // ==================== 用量统计模块 ====================
  const UsageMonitor = {
    data: null,
    initialized: false,

    targetModels: [
      { id: 'gpt-5-2', name: 'Auto', limit: 10000, window: 3 * 60 * 60 * 1000 },
      { id: 'gpt-5-2-instant', name: 'Instant', limit: 10000, window: 3 * 60 * 60 * 1000 },
      { id: 'gpt-5-2-thinking', name: 'Thinking', limit: 3000, window: 7 * 24 * 60 * 60 * 1000 },
      { id: 'gpt-5-2-pro', name: 'Pro', limit: 15, window: 30 * 24 * 60 * 60 * 1000 }
    ],

    async init() {
      if (this.initialized) return;
      this.initialized = true;
      await this.loadData();
      this.listenForUsage();
    },

    _getWorkspace() {
      try { return window.ChatGPTSaver?.Parser?.getWorkspaceName?.() || '默认'; } catch (e) { return '默认'; }
    },

    _ensureWorkspace(ws) {
      if (!this.data.workspaces) this.data.workspaces = {};
      if (!this.data.workspaces[ws]) this.data.workspaces[ws] = { models: {} };
      if (!this.data.workspaces[ws].models) this.data.workspaces[ws].models = {};
    },

    async loadData() {
      try {
        const r = await chrome.storage.local.get(['usageDataByWs']);
        this.data = r.usageDataByWs || { workspaces: {} };
        if (!this.data.workspaces) this.data.workspaces = {};
      } catch (e) { this.data = { workspaces: {} }; }
    },

    async saveData() {
      try { await chrome.storage.local.set({ usageDataByWs: this.data }); } catch (e) { /* ignore */ }
      if (UI && UI.updateUsage) UI.updateUsage();
    },

    recordUsage(modelKey) {
      if (modelKey === 'gpt-5') modelKey = 'gpt-5-2-instant';
      const ws = this._getWorkspace();
      this._ensureWorkspace(ws);
      const wsModels = this.data.workspaces[ws].models;
      if (!wsModels[modelKey]) wsModels[modelKey] = { requests: [] };
      if (!Array.isArray(wsModels[modelKey].requests)) wsModels[modelKey].requests = [];
      const now = Date.now();
      wsModels[modelKey].requests.push(now);
      const thirtyDays = 30 * 24 * 60 * 60 * 1000;
      wsModels[modelKey].requests = wsModels[modelKey].requests.filter(t => now - t < thirtyDays);
      this.saveData();
    },

    getStats() {
      const stats = {};
      const now = Date.now();
      const ws = this._getWorkspace();
      this._ensureWorkspace(ws);
      const wsModels = this.data.workspaces[ws].models;
      this.targetModels.forEach(m => {
        const requests = wsModels[m.id]?.requests || [];
        const timeWindow = m.window || 24 * 60 * 60 * 1000;
        stats[m.id] = { today: requests.filter(t => now - t < timeWindow).length, total: requests.length, name: m.name };
      });
      return stats;
    },

    listenForUsage() {
      window.addEventListener('message', (event) => {
        if (event.source !== window || !event.data) return;
        if (event.data.type === 'SAVER_USAGE_RECORD' && event.data.modelKey) {
          this.recordUsage(event.data.modelKey);
        }
      });
    }
  };

  // ==================== 小鹿图标 SVG ====================
  const DEER_ICON_SVG = `
    <svg class="saver-deer-icon" viewBox="0 -5 50 65" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="faceGrad" x1="50%" y1="0%" x2="50%" y2="100%">
          <stop offset="0%" stop-color="#B8E4F9"/><stop offset="100%" stop-color="#8DD0F0"/>
        </linearGradient>
        <linearGradient id="antlerGrad" x1="50%" y1="0%" x2="50%" y2="100%">
          <stop offset="0%" stop-color="#E8C896"/><stop offset="100%" stop-color="#D4A86A"/>
        </linearGradient>
      </defs>
      <path d="M11 16 Q 8 10 9 3 Q 10 -2 13 0 Q 15 2 14 8 L 14 11 Q 17 6 20 8 Q 22 10 18 14 Q 16 17 14 18 Z" fill="url(#antlerGrad)"/>
      <path d="M39 16 Q 42 10 41 3 Q 40 -2 37 0 Q 35 2 36 8 L 36 11 Q 33 6 30 8 Q 28 10 32 14 Q 34 17 36 18 Z" fill="url(#antlerGrad)"/>
      <ellipse cx="4" cy="32" rx="5" ry="7" fill="#9DD5F3" stroke="#5B9FC7" stroke-width="1"/>
      <ellipse cx="4.5" cy="32" rx="2.5" ry="4.5" fill="#B8E4F9"/>
      <ellipse cx="46" cy="32" rx="5" ry="7" fill="#9DD5F3" stroke="#5B9FC7" stroke-width="1"/>
      <ellipse cx="45.5" cy="32" rx="2.5" ry="4.5" fill="#B8E4F9"/>
      <circle cx="25" cy="35" r="23" fill="url(#faceGrad)" stroke="#5B9FC7" stroke-width="1.5"/>
      <g class="deer-eye-left"><ellipse cx="17" cy="36" rx="5" ry="5.5" fill="#3D5A6E"/><ellipse cx="17" cy="36" rx="4" ry="4.5" fill="#2C4356"/><circle cx="15.5" cy="34.5" r="2.2" fill="white"/><circle cx="18" cy="37.5" r="1" fill="white" opacity="0.6"/></g>
      <path class="deer-eye-left-closed" d="M12 36 Q17 38 22 36" stroke="#2C4356" stroke-width="2" fill="none" stroke-linecap="round" style="display:none;"/>
      <g class="deer-eye-right"><ellipse cx="33" cy="36" rx="5" ry="5.5" fill="#3D5A6E"/><ellipse cx="33" cy="36" rx="4" ry="4.5" fill="#2C4356"/><circle cx="31.5" cy="34.5" r="2.2" fill="white"/><circle cx="34" cy="37.5" r="1" fill="white" opacity="0.6"/></g>
      <path class="deer-eye-right-closed" d="M28 36 Q33 38 38 36" stroke="#2C4356" stroke-width="2" fill="none" stroke-linecap="round" style="display:none;"/>
      <ellipse cx="25" cy="44" rx="2.8" ry="2" fill="#3D5A6E"/>
      <ellipse cx="24.5" cy="43.5" rx="1" ry="0.6" fill="white" opacity="0.4"/>
      <path class="deer-mouth" d="M22 47 Q25 50 28 47" stroke="#3D5A6E" stroke-width="1.3" fill="none" stroke-linecap="round"/>
      <path class="deer-mouth-happy" d="M20 46 Q25 53 30 46" stroke="#3D5A6E" stroke-width="1.5" fill="none" stroke-linecap="round" style="display:none;"/>
      <ellipse class="deer-blush-left" cx="9" cy="42" rx="3.5" ry="2.2" fill="#F5A9B8" opacity="0.45"/>
      <ellipse class="deer-blush-right" cx="41" cy="42" rx="3.5" ry="2.2" fill="#F5A9B8" opacity="0.45"/>
      <text x="25" y="27" font-size="7" fill="white" text-anchor="middle" font-family="Consolas,monospace" font-weight="bold" opacity="0.85">&lt;/&gt;</text>
    </svg>`;


  // ==================== UI 面板 ====================
  const UI = {
    panel: null,
    logArea: null,
    logHeader: null,
    logIcon: null,
    logTitle: null,
    logContent: null,
    toast: null,
    toastTimer: null,

    init() {
      this.addStyles();
      this.createFloatingButton();
      this.createPanel();
      this.createToast();
    },

    addStyles() {
      const style = document.createElement('style');
      style.textContent = `
        :root {
          --saver-bg: #ffffff; --saver-text: #333333; --saver-sub-text: #666666;
          --saver-header-bg: #f3f4f6; --saver-header-text: #333333; --saver-border: #e5e7eb;
          --saver-sec-btn-bg: #f3f4f6; --saver-sec-btn-text: #374151;
          --saver-format-bg: #ffffff; --saver-format-active-bg: #f3f4f6; --saver-format-active-border: #9ca3af;
          --saver-primary-btn-bg: #f3f4f6; --saver-primary-btn-text: #374151;
          --saver-active-color: #374151;
          --saver-log-bg: #f8f9fa; --saver-log-text: #374151;
          --saver-log-header-loading-bg: #e0f2fe; --saver-log-header-loading-text: #0369a1;
          --saver-log-header-success-bg: #dcfce7; --saver-log-header-success-text: #166534;
          --saver-log-header-error-bg: #fee2e2; --saver-log-header-error-text: #dc2626;
        }
        :root.saver-dark {
          --saver-bg: #2d2d2d; --saver-text: #e0e0e0; --saver-sub-text: #aaaaaa;
          --saver-header-bg: #1e1e1e; --saver-header-text: #ffffff; --saver-border: #444444;
          --saver-sec-btn-bg: #3d3d3d; --saver-sec-btn-text: #e0e0e0;
          --saver-format-bg: #3d3d3d; --saver-format-active-bg: #3d3d3d; --saver-format-active-border: #6b7280;
          --saver-primary-btn-bg: #3d3d3d; --saver-primary-btn-text: #e0e0e0;
          --saver-active-color: #e0e0e0;
          --saver-log-bg: #1e1e1e; --saver-log-text: #e0e0e0;
          --saver-log-header-loading-bg: #0c4a6e; --saver-log-header-loading-text: #e0f2fe;
          --saver-log-header-success-bg: #064e3b; --saver-log-header-success-text: #dcfce7;
          --saver-log-header-error-bg: #7f1d1d; --saver-log-header-error-text: #fee2e2;
        }
        .saver-usage-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin-bottom: 12px; }
        .saver-usage-item { background: var(--saver-bg); border: 1px solid var(--saver-border); border-radius: 8px; padding: 6px; text-align: center; }
        .saver-usage-model { font-size: 11px; color: var(--saver-sub-text); margin-bottom: 2px; }
        .saver-usage-count { font-size: 14px; font-weight: 600; color: #10a37f; }
        #chatgpt-saver-btn {
          position: fixed; bottom: 20px; right: 20px; width: 50px; height: 65px;
          background: transparent; border: none; cursor: grab; z-index: 99999;
          box-shadow: none; display: flex; align-items: flex-end; justify-content: center;
          transition: transform 0.2s; padding: 0; overflow: visible; user-select: none; touch-action: none;
        }
        #chatgpt-saver-btn.dragging { cursor: grabbing; transform: scale(1.1); transition: none; z-index: 99999 !important; }
        #chatgpt-saver-btn .saver-deer-icon {
          width: 50px; height: 65px; pointer-events: none;
          filter: drop-shadow(0 3px 8px rgba(135, 206, 235, 0.5));
          animation: deerBounce 2.5s ease-in-out infinite;
        }
        #chatgpt-saver-btn:hover:not(.dragging) { transform: scale(1.1); }
        #chatgpt-saver-btn:hover .saver-deer-icon { animation: deerWiggle 0.5s ease-in-out infinite; }
        #chatgpt-saver-btn.dragging .saver-deer-icon { animation: none; }
        @keyframes deerBounce { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }
        @keyframes deerWiggle { 0%, 100% { transform: rotate(0deg); } 25% { transform: rotate(-5deg); } 75% { transform: rotate(5deg); } }
        @keyframes slideUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }

        #chatgpt-saver-toast {
          position: fixed; background: rgba(0,0,0,0.85); color: white;
          padding: 10px 16px; border-radius: 8px; font-size: 13px;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          z-index: 99998; opacity: 0; transform: translateY(10px);
          transition: opacity 0.3s ease, transform 0.3s ease; pointer-events: none;
          max-width: 220px; text-align: center; box-shadow: 0 4px 12px rgba(0,0,0,0.3); white-space: nowrap;
        }
        #chatgpt-saver-toast.show { opacity: 1; transform: translateY(0); }
        #chatgpt-saver-toast.saving { background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%); }
        #chatgpt-saver-toast.success { background: linear-gradient(135deg, #10a37f 0%, #0d8a6a 100%); }

        #chatgpt-saver-panel {
          position: fixed; top: 0; right: 0; width: 320px; min-width: 280px; max-width: 600px; height: 100vh;
          background: var(--saver-bg); border-radius: 0; z-index: 10003;
          box-shadow: -2px 0 12px rgba(0,0,0,0.1);
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          display: none; color: var(--saver-text);
          overflow-y: auto; overflow-x: hidden;
        }
        #chatgpt-saver-panel.show { display: flex; flex-direction: column; animation: slideIn 0.3s ease; }
        #chatgpt-saver-panel.resizing { transition: none !important; animation: none !important; }
        @keyframes slideIn { from { transform: translateX(100%); } to { transform: translateX(0); } }
        .saver-resize-handle {
          position: absolute; left: 0; top: 0; width: 5px; height: 100%; cursor: col-resize; z-index: 10;
          background: transparent; transition: background 0.2s;
        }
        .saver-resize-handle:hover, .saver-resize-handle.active { background: rgba(16,163,127,0.3); }
        .saver-panel-header { padding: 16px; background: var(--saver-header-bg); border-radius: 0; color: var(--saver-header-text); flex-shrink: 0; }
        .saver-panel-header h3 { margin: 0; font-size: 16px; font-weight: 600; }
        .saver-panel-header p { margin: 4px 0 0; font-size: 12px; opacity: 0.9; }
        .saver-panel-content { padding: 16px; overflow-y: auto; flex: 1; }
        .saver-format-group { display: flex; gap: 8px; margin-bottom: 16px; }
        .saver-format-btn { flex: 1; padding: 10px; border: 2px solid var(--saver-border); border-radius: 8px; background: var(--saver-format-bg); cursor: pointer; text-align: center; transition: all 0.2s; }
        .saver-format-btn.active { border-color: var(--saver-format-active-border); background: var(--saver-format-active-bg); }
        .saver-format-btn span { display: block; font-size: 12px; color: var(--saver-sub-text); margin-top: 4px; }
        .saver-action-btn { width: 100%; padding: 12px; border: none; border-radius: 8px; background: var(--saver-primary-btn-bg); color: var(--saver-primary-btn-text); font-size: 14px; font-weight: 600; cursor: pointer; margin-bottom: 8px; transition: opacity 0.2s; }
        .saver-action-btn:hover { opacity: 0.9; }
        .saver-action-btn.secondary { background: var(--saver-sec-btn-bg); color: var(--saver-sec-btn-text); }
        .saver-status { font-size: 12px; color: var(--saver-sub-text); text-align: center; padding-top: 8px; border-top: 1px solid var(--saver-border); }
        .saver-status .active { color: var(--saver-active-color); }
        .saver-divider { height: 1px; background: var(--saver-border); margin: 12px 0; }
        .saver-log-area { margin-top: 12px; border-top: 1px solid var(--saver-border); padding-top: 12px; display: none; }
        .saver-log-area.show { display: block; }
        .saver-log-header-inline { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; user-select: none; }
        .saver-log-header-inline .saver-log-toggle-arrow { margin-left: auto; font-size: 10px; transition: transform 0.2s; }
        .saver-log-header-inline .saver-log-toggle-arrow.expanded { transform: rotate(90deg); }
        .saver-log-header-inline.loading { background: var(--saver-log-header-loading-bg); color: var(--saver-log-header-loading-text); }
        .saver-log-header-inline.success { background: var(--saver-log-header-success-bg); color: var(--saver-log-header-success-text); }
        .saver-log-header-inline.error { background: var(--saver-log-header-error-bg); color: var(--saver-log-header-error-text); }
        .saver-log-content-inline { max-height: 150px; overflow-y: auto; background: var(--saver-log-bg); border-radius: 8px; padding: 8px; font-size: 11px; font-family: 'Consolas','Monaco',monospace; display: none; margin-top: 8px; }
        .saver-log-content-inline.expanded { display: block; }
        .saver-log-item-inline { padding: 3px 0; border-bottom: 1px solid var(--saver-border); color: var(--saver-log-text); }
        .saver-log-item-inline:last-child { border-bottom: none; }
        .saver-log-time-inline { color: #9ca3af; margin-right: 6px; }
        .saver-tab-bar { display: flex; border-bottom: 2px solid var(--saver-border); flex-shrink: 0; }
        .saver-tab { flex: 1; padding: 10px; text-align: center; font-size: 13px; font-weight: 600; cursor: pointer; color: var(--saver-sub-text); border-bottom: 2px solid transparent; margin-bottom: -2px; transition: all 0.2s; background: none; border-top: none; border-left: none; border-right: none; }
        .saver-tab.active { color: #10a37f; border-bottom-color: #10a37f; }
        .saver-tab:hover:not(.active) { color: var(--saver-text); background: var(--saver-format-active-bg); }
        .saver-tab-content { display: none; flex: 1; overflow-y: auto; }
        .saver-tab-content.active { display: flex; flex-direction: column; }
        .saver-context-list { flex: 1; overflow-y: auto; margin-bottom: 8px; }
        .saver-ws-group { margin-bottom: 4px; }
        .saver-ws-header { display: flex; align-items: center; gap: 6px; padding: 8px 10px; cursor: pointer; font-size: 13px; font-weight: 600; color: var(--saver-text); border-radius: 6px; transition: background 0.15s; user-select: none; }
        .saver-ws-header:hover { background: var(--saver-format-active-bg); }
        .saver-ws-arrow { font-size: 10px; transition: transform 0.2s; color: var(--saver-sub-text); }
        .saver-ws-header.expanded .saver-ws-arrow { transform: rotate(90deg); }
        .saver-ws-count { font-size: 10px; color: var(--saver-sub-text); font-weight: 400; margin-left: auto; }
        .saver-ws-children { display: none; padding-left: 12px; }
        .saver-ws-header.expanded + .saver-ws-children { display: block; }
        .saver-context-item { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border: 1px solid var(--saver-border); border-radius: 8px; margin-bottom: 4px; font-size: 12px; cursor: grab; transition: all 0.2s; background: var(--saver-format-bg); user-select: none; }
        .saver-context-item:hover { border-color: #10a37f; background: var(--saver-format-active-bg); }
        .saver-context-item:active { opacity: 0.7; transform: scale(0.98); }
        .saver-context-item .ctx-icon { font-size: 18px; flex-shrink: 0; }
        .saver-context-item .ctx-info { flex: 1; overflow: hidden; }
        .saver-context-item .ctx-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--saver-text); font-weight: 500; }
        .saver-context-item .ctx-meta { font-size: 10px; color: var(--saver-sub-text); margin-top: 2px; }
        .saver-context-item .ctx-drag-hint { font-size: 10px; color: var(--saver-sub-text); opacity: 0.5; flex-shrink: 0; }
        .saver-context-status { font-size: 12px; color: var(--saver-sub-text); text-align: center; padding: 16px 12px; line-height: 1.6; }
        .saver-cardkey-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 100000; }
        .saver-cardkey-dialog { background: var(--saver-bg, #fff); border-radius: 16px; padding: 32px 24px; width: 340px; box-shadow: 0 20px 60px rgba(0,0,0,0.3); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; text-align: center; color: var(--saver-text, #333); }
        .saver-cardkey-dialog h3 { margin: 0 0 8px; font-size: 18px; }
        .saver-cardkey-dialog p { margin: 0 0 20px; font-size: 13px; color: var(--saver-sub-text, #666); }
        .saver-cardkey-input { width: 100%; padding: 12px; border: 2px solid var(--saver-border, #e5e7eb); border-radius: 8px; font-size: 14px; text-align: center; letter-spacing: 1px; outline: none; transition: border-color 0.2s; background: var(--saver-format-bg, #fff); color: var(--saver-text, #333); box-sizing: border-box; }
        .saver-cardkey-input:focus { border-color: #10a37f; }
        .saver-cardkey-input.error { border-color: #ef4444; }
        .saver-cardkey-btn { width: 100%; padding: 12px; border: none; border-radius: 8px; background: #10a37f; color: white; font-size: 14px; font-weight: 600; cursor: pointer; margin-top: 12px; transition: opacity 0.2s; }
        .saver-cardkey-btn:hover { opacity: 0.9; }
        .saver-cardkey-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .saver-cardkey-msg { margin-top: 12px; font-size: 12px; min-height: 18px; }
        .saver-cardkey-msg.error { color: #ef4444; }
        .saver-cardkey-msg.success { color: #10a37f; }
        .saver-cardkey-info { display: inline-block; font-size: 11px; color: var(--saver-sub-text, #666); background: var(--saver-format-active-bg, #f3f4f6); padding: 4px 10px; border-radius: 12px; margin-left: 8px; cursor: pointer; }
        .saver-cardkey-info:hover { opacity: 0.8; }
        .saver-tpl-editor-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 100000; animation: fadeIn 0.15s ease; }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        .saver-tpl-editor-dialog { background: var(--saver-bg, #fff); border-radius: 16px; padding: 24px; width: 480px; max-width: 90vw; max-height: 80vh; display: flex; flex-direction: column; box-shadow: 0 20px 60px rgba(0,0,0,0.3); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: var(--saver-text, #333); }
        .saver-tpl-editor-dialog h3 { margin: 0 0 6px; font-size: 16px; font-weight: 600; }
        .saver-tpl-editor-dialog .saver-tpl-vars { font-size: 11px; color: var(--saver-sub-text, #666); margin-bottom: 12px; line-height: 1.6; }
        .saver-tpl-editor-dialog .saver-tpl-vars code { background: var(--saver-format-active-bg, #f3f4f6); padding: 1px 5px; border-radius: 4px; font-family: Consolas, Monaco, monospace; font-size: 11px; }
        .saver-tpl-editor-textarea { width: 100%; min-height: 200px; max-height: 50vh; padding: 12px; border: 2px solid var(--saver-border, #e5e7eb); border-radius: 10px; font-size: 13px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height: 1.6; resize: vertical; outline: none; transition: border-color 0.2s; background: var(--saver-format-bg, #fff); color: var(--saver-text, #333); box-sizing: border-box; }
        .saver-tpl-editor-textarea:focus { border-color: #10a37f; }
        .saver-tpl-editor-actions { display: flex; gap: 8px; margin-top: 14px; justify-content: flex-end; }
        .saver-tpl-editor-actions button { padding: 9px 20px; border: none; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; transition: opacity 0.2s; }
        .saver-tpl-editor-actions .saver-tpl-save { background: #10a37f; color: white; }
        .saver-tpl-editor-actions .saver-tpl-save:hover { opacity: 0.9; }
        .saver-tpl-editor-actions .saver-tpl-cancel { background: var(--saver-sec-btn-bg, #f3f4f6); color: var(--saver-sec-btn-text, #374151); }
        .saver-tpl-editor-actions .saver-tpl-cancel:hover { opacity: 0.8; }
        .saver-tpl-editor-actions .saver-tpl-reset { background: none; color: #ef4444; font-weight: 500; padding: 9px 12px; margin-right: auto; }
        .saver-tpl-editor-actions .saver-tpl-reset:hover { opacity: 0.7; }
      `;
      document.head.appendChild(style);
    },

    createFloatingButton() {
      const btn = document.createElement('button');
      btn.id = 'chatgpt-saver-btn';
      btn.innerHTML = DEER_ICON_SVG;
      btn.title = 'ChatGPT 对话保存助手';
      document.body.appendChild(btn);
      this.startDeerAnimations(btn);
      this.initDraggable(btn);
    },

    startDeerAnimations(btn) {
      const blink = () => {
        const els = ['deer-eye-left', 'deer-eye-right'].map(c => [btn.querySelector('.' + c), btn.querySelector('.' + c + '-closed')]);
        els.forEach(([open, closed]) => { if (open) { open.style.display = 'none'; closed.style.display = 'block'; } });
        setTimeout(() => { els.forEach(([open, closed]) => { if (open) { open.style.display = 'block'; closed.style.display = 'none'; } }); }, 150);
      };
      const scheduleBlink = () => { setTimeout(() => { blink(); scheduleBlink(); }, 2000 + Math.random() * 3000); };
      scheduleBlink();
      btn.addEventListener('mouseenter', () => {
        const m = btn.querySelector('.deer-mouth'), mh = btn.querySelector('.deer-mouth-happy');
        const bl = btn.querySelector('.deer-blush-left'), br = btn.querySelector('.deer-blush-right');
        if (m) m.style.display = 'none'; if (mh) mh.style.display = 'block';
        if (bl) bl.setAttribute('opacity', '0.7'); if (br) br.setAttribute('opacity', '0.7');
      });
      btn.addEventListener('mouseleave', () => {
        const m = btn.querySelector('.deer-mouth'), mh = btn.querySelector('.deer-mouth-happy');
        const bl = btn.querySelector('.deer-blush-left'), br = btn.querySelector('.deer-blush-right');
        if (m) m.style.display = 'block'; if (mh) mh.style.display = 'none';
        if (bl) bl.setAttribute('opacity', '0.45'); if (br) br.setAttribute('opacity', '0.45');
      });
    },

    initDraggable(btn) {
      let isDragging = false, hasMoved = false, startX, startY, startLeft, startTop;
      chrome.storage.local.get(['btnPosition'], (r) => {
        if (r.btnPosition) { btn.style.right = 'auto'; btn.style.bottom = 'auto'; btn.style.left = r.btnPosition.left + 'px'; btn.style.top = r.btnPosition.top + 'px'; }
      });
      const onMouseDown = (e) => { if (e.button !== 0) return; isDragging = true; hasMoved = false; btn.classList.add('dragging'); const rect = btn.getBoundingClientRect(); startX = e.clientX; startY = e.clientY; startLeft = rect.left; startTop = rect.top; e.preventDefault(); };
      const onMouseMove = (e) => { if (!isDragging) return; const dx = e.clientX - startX, dy = e.clientY - startY; if (Math.abs(dx) > 5 || Math.abs(dy) > 5) hasMoved = true; let nl = startLeft + dx, nt = startTop + dy; nl = Math.max(0, Math.min(nl, window.innerWidth - btn.offsetWidth)); nt = Math.max(0, Math.min(nt, window.innerHeight - btn.offsetHeight)); btn.style.right = 'auto'; btn.style.bottom = 'auto'; btn.style.left = nl + 'px'; btn.style.top = nt + 'px'; };
      const onMouseUp = () => { if (!isDragging) return; isDragging = false; btn.classList.remove('dragging'); if (hasMoved) { const rect = btn.getBoundingClientRect(); chrome.storage.local.set({ btnPosition: { left: rect.left, top: rect.top } }); } };
      const onClick = (e) => { if (hasMoved) { e.preventDefault(); e.stopPropagation(); hasMoved = false; return; } if (!CardKeyManager.verified) { this.showCardKeyOverlay(); return; } this.togglePanel(); };
      btn.addEventListener('mousedown', onMouseDown); document.addEventListener('mousemove', onMouseMove); document.addEventListener('mouseup', onMouseUp); btn.addEventListener('click', onClick);
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
      const btn = document.getElementById('chatgpt-saver-btn');
      if (btn) { const rect = btn.getBoundingClientRect(); this.toast.style.bottom = (window.innerHeight - rect.top + 10) + 'px'; this.toast.style.left = (rect.left + rect.width / 2) + 'px'; this.toast.style.transform = 'translateX(-50%)'; }
      if (duration > 0) { this.toastTimer = setTimeout(() => { this.toast.className = ''; }, duration); }
    },

    hideToast() { if (this.toast) this.toast.className = ''; },


    createPanel() {
      const panel = document.createElement('div');
      panel.id = 'chatgpt-saver-panel';
      panel.innerHTML = `
        <div class="saver-resize-handle" id="saver-resize-handle"></div>
        <div class="saver-panel-header" style="position: relative;">
          <h3>💬 ChatGPT 对话保存助手</h3>
          <p>自动保存您的智慧对话 <span id="saver-cardkey-badge" class="saver-cardkey-info" style="display:none;" title="点击管理卡密"></span></p>
          <button id="saver-sidebar-close" style="position: absolute; top: 12px; right: 40px; background: none; border: none; cursor: pointer; font-size: 18px; padding: 0; line-height: 1; color: var(--saver-header-text); opacity: 0.7;" title="收起侧边栏">✕</button>
          <button id="saver-theme-toggle" style="position: absolute; top: 12px; right: 12px; background: none; border: none; cursor: pointer; font-size: 18px; padding: 0; line-height: 1;">🌞</button>
        </div>
        <div class="saver-tab-bar">
          <button class="saver-tab active" data-tab="save">💾 保存</button>
          <button class="saver-tab" data-tab="context">🔄 延续</button>
          <button class="saver-tab" data-tab="template">📋 模板</button>
        </div>
        <div class="saver-tab-content active" id="saver-tab-save">
          <div class="saver-panel-content">
            <div style="font-size: 12px; color: var(--saver-sub-text); margin-bottom: 8px; font-weight: 600;">📊 GPT-5.2 用量统计 <span id="saver-usage-workspace" style="font-weight: 400; opacity: 0.8;"></span></div>
            <div class="saver-usage-stats" id="saver-usage-stats">
              <div class="saver-usage-item"><div class="saver-usage-model">加载中...</div></div>
            </div>
            <div class="saver-format-group">
              <div class="saver-format-btn ${config.formats.html ? 'active' : ''}" data-format="html">📄<span>HTML</span></div>
              <div class="saver-format-btn ${config.formats.md ? 'active' : ''}" data-format="md">📝<span>Markdown</span></div>
              <div class="saver-format-btn ${config.formats.pdf ? 'active' : ''}" data-format="pdf">📕<span>PDF</span></div>
              <div class="saver-format-btn ${config.formats.json ? 'active' : ''}" data-format="json">📦<span>JSON</span></div>
            </div>
            <button class="saver-action-btn" id="saver-export-btn">💾 立即导出当前对话</button>
            <button class="saver-action-btn secondary" id="saver-selection-btn">✂️ 选择导出</button>
            <div id="saver-selection-bar" style="display:none;margin-bottom:8px;">
              <div style="display:flex;gap:8px;">
                <button class="saver-action-btn" id="saver-export-selected" disabled style="flex:1;">导出选中 (0)</button>
                <button class="saver-action-btn secondary" id="saver-exit-selection" style="flex:1;">退出选择</button>
              </div>
            </div>
            <button class="saver-action-btn secondary" id="saver-select-folder">📁 选择保存文件夹</button>
            <div class="saver-divider"></div>
            <div id="saver-folder-status" style="margin-bottom: 8px; font-size: 12px; color: var(--saver-sub-text);">
              保存位置: <span id="saver-folder-name" style="color: var(--saver-active-color);">未设置</span>
            </div>
            <div style="display: flex; gap: 8px; margin-bottom: 8px;">
              <button class="saver-action-btn secondary" id="saver-auto-toggle" style="font-size: 12px; padding: 8px; margin-bottom: 0; flex: 1;">
                ${config.autoSave ? '✅ 自动保存' : '⚪ 自动保存'}
              </button>
              <button class="saver-action-btn secondary" id="saver-log-toggle" style="font-size: 12px; padding: 8px; margin-bottom: 0; flex: 1;">
                ${config.showLogPanel ? '✅ 显示日志' : '⚪ 显示日志'}
              </button>
            </div>
            <div class="saver-status" id="saver-observer-status">
              状态: <span id="saver-observer-text">未启动</span>
              <span style="margin-left: 12px; color: var(--saver-sub-text);">v${config.currentVersion}</span>
            </div>
            <div class="saver-log-area" id="saver-log-area">
              <div class="saver-log-header-inline loading" id="saver-log-header">
                <span id="saver-log-icon">⏳</span>
                <span id="saver-log-title">正在导出...</span>
                <span class="saver-log-toggle-arrow" id="saver-log-arrow">▶</span>
              </div>
              <div class="saver-log-content-inline" id="saver-log-content"></div>
            </div>
          </div>
        </div>
        <div class="saver-tab-content" id="saver-tab-context">
          <div class="saver-panel-content">
            <div style="font-size: 12px; color: var(--saver-sub-text); margin-bottom: 4px; font-weight: 600;">📂 已保存的上下文</div>
            <div style="font-size: 11px; color: var(--saver-sub-text); opacity: 0.7; margin-bottom: 10px;">拖拽文件到 ChatGPT 对话框即可导入</div>
            <div style="display:flex;gap:6px;margin-bottom:8px;">
              <select id="saver-ctx-prompt-select" style="flex:1;padding:7px 8px;border:1px solid var(--saver-border);border-radius:8px;font-size:11px;background:var(--saver-format-bg);color:var(--saver-text);outline:none;cursor:pointer;"></select>
              <button id="saver-ctx-lang-toggle" style="padding:7px 10px;border:1px solid var(--saver-border);border-radius:8px;font-size:11px;background:var(--saver-format-bg);color:var(--saver-text);cursor:pointer;white-space:nowrap;" title="切换提示词语言">🌐 中文</button>
            </div>
            <input type="text" id="saver-context-search" placeholder="🔍 搜索上下文..." style="width:100%;padding:8px 10px;border:1px solid var(--saver-border);border-radius:8px;font-size:12px;outline:none;background:var(--saver-format-bg);color:var(--saver-text);box-sizing:border-box;margin-bottom:8px;" />
            <div class="saver-context-list" id="saver-context-list">
              <div class="saver-context-status">加载中...</div>
            </div>
          </div>
        </div>
        <div class="saver-tab-content" id="saver-tab-template">
          <div class="saver-panel-content">
            <div style="font-size: 12px; color: var(--saver-sub-text); margin-bottom: 6px; font-weight: 600;">🔄 对话延续模板</div>
            <div id="saver-ctx-template-list" style="overflow-y:auto;margin-bottom:8px;"></div>
          </div>
        </div>
      `;
      document.body.appendChild(panel);
      this.panel = panel;
      this.logArea = document.getElementById('saver-log-area');
      this.logHeader = document.getElementById('saver-log-header');
      this.logIcon = document.getElementById('saver-log-icon');
      this.logTitle = document.getElementById('saver-log-title');
      this.logContent = document.getElementById('saver-log-content');
      this.logArrow = document.getElementById('saver-log-arrow');

      // 点击日志头部展开/收起详细日志
      this.logHeader.onclick = () => {
        const isExpanded = this.logContent.classList.toggle('expanded');
        if (this.logArrow) this.logArrow.classList.toggle('expanded', isExpanded);
      };

      // 初始化主题
      chrome.storage.local.get(['theme'], (r) => {
        this.theme = r.theme || 'day';
        this.applyTheme();
      });

      // 主题切换
      document.getElementById('saver-theme-toggle').onclick = () => this.toggleTheme();

      // 侧边栏关闭按钮
      document.getElementById('saver-sidebar-close').onclick = () => this.togglePanel();

      // 侧边栏拖拽调整宽度
      const resizeHandle = document.getElementById('saver-resize-handle');
      if (resizeHandle) {
        let isResizing = false;
        resizeHandle.addEventListener('mousedown', (e) => {
          isResizing = true;
          panel.classList.add('resizing');
          resizeHandle.classList.add('active');
          e.preventDefault();
        });
        document.addEventListener('mousemove', (e) => {
          if (!isResizing) return;
          const newWidth = Math.min(600, Math.max(280, window.innerWidth - e.clientX));
          panel.style.width = newWidth + 'px';
          const main = document.querySelector('main') || document.querySelector('[role="main"]') || document.querySelector('.flex-1');
          if (main && panel.classList.contains('show')) main.style.marginRight = newWidth + 'px';
        });
        document.addEventListener('mouseup', () => {
          if (!isResizing) return;
          isResizing = false;
          panel.classList.remove('resizing');
          resizeHandle.classList.remove('active');
          chrome.storage.local.set({ sidebarWidth: parseInt(panel.style.width) });
        });
        // 恢复上次保存的宽度
        chrome.storage.local.get(['sidebarWidth'], (r) => {
          if (r.sidebarWidth) panel.style.width = r.sidebarWidth + 'px';
        });
      }

      // 格式按钮
      panel.querySelectorAll('.saver-format-btn').forEach(btn => {
        btn.onclick = () => {
          btn.classList.toggle('active');
          config.formats[btn.dataset.format] = btn.classList.contains('active');
          chrome.storage.local.set({ exportFormats: config.formats });
        };
      });

      // 导出按钮 - 手动点击强制导出
      document.getElementById('saver-export-btn').onclick = async () => {
        if (!window.ChatGPTSaver.Exporter.canExport()) { this.showToast('没有可导出的内容', 'error'); return; }
        this.showToast('💾 正在导出...', 'saving', 0);
        const result = await window.ChatGPTSaver.Exporter.exportConversation(config.formats, true);
        if (result.success) {
          this.showToast('✅ 导出成功', 'success', 3000);
          updateSavedCount();
        } else {
          this.showToast('❌ ' + (result.error || '导出失败'), 'error', 3000);
        }
      };

      // 选择导出模式
      document.getElementById('saver-selection-btn').onclick = () => {
        const sm = window.ChatGPTSaver.SelectionManager;
        if (!sm) return;
        sm.activate();
        document.getElementById('saver-selection-bar').style.display = 'block';
        document.getElementById('saver-selection-btn').style.display = 'none';
        this._injectCheckboxOverlays();
      };

      document.getElementById('saver-exit-selection').onclick = () => {
        this._exitSelectionMode();
      };

      document.getElementById('saver-export-selected').onclick = async () => {
        const sm = window.ChatGPTSaver.SelectionManager;
        if (!sm || sm.selectedCount() === 0) return;
        const allMessages = window.ChatGPTSaver.Parser.parseConversation().messages;
        const selected = sm.getSelectedMessages(allMessages);
        if (!selected.length) { this.showToast('没有选中消息', 'error'); return; }
        this.showToast('💾 正在导出选中消息...', 'saving', 0);
        // Build a temporary conversation object with selected messages
        const title = window.ChatGPTSaver.Parser.getConversationTitle() + ' (节选)';
        const tempConv = { title, messages: selected };
        // Use exporter with selected messages
        try {
          const result = await window.ChatGPTSaver.Exporter.exportSelectedMessages(tempConv, config.formats);
          if (result && result.success) {
            this.showToast(`✅ 已导出 ${selected.length} 条消息`, 'success', 3000);
          } else {
            this.showToast('❌ 导出失败', 'error', 3000);
          }
        } catch (e) {
          this.showToast('❌ ' + e.message, 'error', 3000);
        }
        this._exitSelectionMode();
      };

      // 选择文件夹
      document.getElementById('saver-select-folder').onclick = async () => {
        const result = await window.ChatGPTSaver.FileSystem.requestFolderAccess();
        if (result.success) {
          this.updateFolderStatus(result.folderName);
          chrome.storage.local.set({ isAuthorized: true, savePath: result.folderName });
          this.showToast('✅ 文件夹已设置', 'success');
        } else if (!result.unsupported) {
          this.showToast(result.error || '选择失败', 'error');
        }
      };

      // 自动保存开关
      document.getElementById('saver-auto-toggle').onclick = (e) => {
        config.autoSave = !config.autoSave;
        chrome.storage.local.set({ autoSave: config.autoSave });
        e.target.textContent = config.autoSave ? '✅ 自动保存' : '⚪ 自动保存';
        if (config.autoSave) startAutoSave(); else window.ChatGPTSaver.Observer.stop();
        this.updateStatus();
      };

      // 日志开关
      document.getElementById('saver-log-toggle').onclick = (e) => {
        config.showLogPanel = !config.showLogPanel;
        chrome.storage.local.set({ showLogPanel: config.showLogPanel });
        e.target.textContent = config.showLogPanel ? '✅ 显示日志' : '⚪ 显示日志';
      };

      // Tab 切换
      panel.querySelectorAll('.saver-tab').forEach(tab => {
        tab.onclick = () => {
          panel.querySelectorAll('.saver-tab').forEach(t => t.classList.remove('active'));
          panel.querySelectorAll('.saver-tab-content').forEach(c => c.classList.remove('active'));
          tab.classList.add('active');
          document.getElementById('saver-tab-' + tab.dataset.tab).classList.add('active');
          if (tab.dataset.tab === 'context') ContextManager.refreshList();
        };
      });

      // 上下文列表搜索过滤
      const ctxSearchInput = document.getElementById('saver-context-search');
      if (ctxSearchInput) {
        ctxSearchInput.addEventListener('input', () => {
          const query = ctxSearchInput.value.trim().toLowerCase();
          const listEl = document.getElementById('saver-context-list');
          if (!listEl) return;
          listEl.querySelectorAll('.saver-ws-group').forEach(group => {
            const items = group.querySelectorAll('.saver-context-item');
            let visibleCount = 0;
            items.forEach(item => {
              const title = (item.querySelector('.ctx-title')?.textContent || '').toLowerCase();
              const wsName = (group.dataset.ws || '').toLowerCase();
              const match = !query || title.includes(query) || wsName.includes(query);
              item.style.display = match ? '' : 'none';
              if (match) visibleCount++;
            });
            group.style.display = visibleCount > 0 || !query ? '' : 'none';
            // Auto-expand groups when searching
            const header = group.querySelector('.saver-ws-header');
            if (query && visibleCount > 0 && header) header.classList.add('expanded');
          });
        });
      }

      // 模板功能
      // Tab 切换时刷新模板列表
      panel.querySelectorAll('.saver-tab').forEach(tab => {
        const origHandler = tab.onclick;
        tab.onclick = () => {
          if (origHandler) origHandler();
          if (tab.dataset.tab === 'template') this._refreshTemplateList();
        };
      });

    },

    togglePanel() {
      const isShowing = this.panel.classList.toggle('show');
      const main = document.querySelector('main') || document.querySelector('[role="main"]') || document.querySelector('.flex-1');
      if (main) {
        main.style.transition = 'margin-right 0.3s ease';
        main.style.marginRight = isShowing ? this.panel.style.width || '320px' : '';
      }
    },

    // 显示卡密输入弹窗
    showCardKeyOverlay(message = '') {
      let overlay = document.getElementById('saver-cardkey-overlay');
      if (overlay) { overlay.style.display = 'flex'; return; }
      overlay = document.createElement('div');
      overlay.id = 'saver-cardkey-overlay';
      overlay.className = 'saver-cardkey-overlay';
      overlay.innerHTML = `
        <div class="saver-cardkey-dialog" style="position: relative;">
          <button id="saver-cardkey-close" style="position: absolute; top: 12px; right: 12px; background: none; border: none; font-size: 20px; cursor: pointer; color: var(--saver-sub-text, #999); line-height: 1; padding: 4px;">✕</button>
          <img src="${chrome.runtime.getURL('icons/logo.jpg')}" style="width: 80px; height: 80px; border-radius: 50%; margin: 0 auto 12px; display: block; box-shadow: 0 4px 12px rgba(0,0,0,0.1); object-fit: cover;" />
          <h3>激活 ChatGPT 对话保存助手</h3>
          <p>请输入卡密以激活插件功能</p>
          <input type="text" class="saver-cardkey-input" id="saver-cardkey-input" placeholder="请输入卡密" autocomplete="off" />
          <button class="saver-cardkey-btn" id="saver-cardkey-submit">🔑 验证激活</button>
          <div class="saver-cardkey-msg" id="saver-cardkey-msg">${message}</div>
        </div>
      `;
      document.body.appendChild(overlay);

      // 关闭按钮
      document.getElementById('saver-cardkey-close').onclick = () => { overlay.style.display = 'none'; };

      const input = document.getElementById('saver-cardkey-input');
      const btn = document.getElementById('saver-cardkey-submit');
      const msg = document.getElementById('saver-cardkey-msg');

      const doVerify = async () => {
        const key = input.value.trim();
        if (!key) { msg.textContent = '请输入卡密'; msg.className = 'saver-cardkey-msg error'; input.classList.add('error'); return; }
        btn.disabled = true;
        btn.textContent = '⏳ 验证中...';
        msg.textContent = '';
        input.classList.remove('error');
        const result = await CardKeyManager.verify(key);
        if (result.valid) {
          msg.textContent = '✅ 激活成功！';
          msg.className = 'saver-cardkey-msg success';
          btn.textContent = '✅ 已激活';
          setTimeout(() => {
            overlay.style.display = 'none';
            this.updateCardKeyBadge();
            initAfterCardKey();
          }, 800);
        } else {
          msg.textContent = result.message || '卡密无效';
          msg.className = 'saver-cardkey-msg error';
          input.classList.add('error');
          btn.disabled = false;
          btn.textContent = '🔑 验证激活';
        }
      };

      btn.onclick = doVerify;
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') doVerify(); });
      input.focus();
    },

    hideCardKeyOverlay() {
      const overlay = document.getElementById('saver-cardkey-overlay');
      if (overlay) overlay.style.display = 'none';
    },

    updateCardKeyBadge() {
      const badge = document.getElementById('saver-cardkey-badge');
      if (!badge) return;
      if (CardKeyManager.verified) {
        const days = CardKeyManager.getRemainingDays();
        badge.style.display = 'inline-block';
        badge.textContent = `🔑 剩余 ${days} 天`;
        if (days <= 3) badge.style.color = '#ef4444';
        else badge.style.color = '';
      } else {
        badge.style.display = 'none';
      }
    },

    initCardKeyBadgeClick() {
      const badge = document.getElementById('saver-cardkey-badge');
      if (badge) {
        badge.onclick = async () => {
          if (confirm('是否要更换卡密？当前卡密将被清除。')) {
            await CardKeyManager.logout();
            this.updateCardKeyBadge();
            this.showCardKeyOverlay();
          }
        };
      }
    },

    updateStatus() {
      const el = document.getElementById('saver-observer-text');
      if (el) { el.textContent = window.ChatGPTSaver.Observer?.isActive() ? '监听中' : '未启动'; el.className = window.ChatGPTSaver.Observer?.isActive() ? 'active' : ''; }
    },

    updateFolderStatus(name) {
      const el = document.getElementById('saver-folder-name');
      if (el) el.textContent = name ? '📂 ' + name : '未设置';
    },

    showLog() {
      if (!config.showLogPanel) return;
      if (!this.panel.classList.contains('show')) {
        this.panel.classList.add('show');
        const main = document.querySelector('main') || document.querySelector('[role="main"]') || document.querySelector('.flex-1');
        if (main) { main.style.transition = 'margin-right 0.3s ease'; main.style.marginRight = this.panel.style.width || '320px'; }
      }
      if (this.logArea) {
        this.logArea.classList.add('show');
        this.logContent.innerHTML = '';
        this.logContent.classList.remove('expanded');
        if (this.logArrow) this.logArrow.classList.remove('expanded');
        this.setLogStatus('loading', '正在导出...');
      }
    },

    addLog(message) {
      if (!config.showLogPanel || !this.logContent) return;
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
      if (this.logIcon) this.logIcon.textContent = type === 'success' ? '✅' : (type === 'error' ? '❌' : '⏳');
      if (this.logTitle) this.logTitle.textContent = title;
    },

    logComplete(title, subtitle) { this.setLogStatus('success', `${title} - ${subtitle}`); },
    logError(message) { this.setLogStatus('error', `导出失败: ${message}`); },
    clearLog() {
      if (this.logArea) this.logArea.classList.remove('show');
      if (this.logContent) { this.logContent.innerHTML = ''; this.logContent.classList.remove('expanded'); }
      if (this.logArrow) this.logArrow.classList.remove('expanded');
    },

    toggleTheme() {
      this.theme = this.theme === 'day' ? 'night' : 'day';
      chrome.storage.local.set({ theme: this.theme });
      this.applyTheme();
    },

    applyTheme() {
      const html = document.documentElement;
      const btn = document.getElementById('saver-theme-toggle');
      const panel = document.getElementById('chatgpt-saver-panel');
      if (this.theme === 'night') {
        html.classList.add('saver-dark');
        if (panel) panel.classList.add('saver-dark');
        if (btn) btn.textContent = '🌙';
      } else {
        html.classList.remove('saver-dark');
        if (panel) panel.classList.remove('saver-dark');
        if (btn) btn.textContent = '🌞';
      }
    },

    updateUsage() {
      const stats = UsageMonitor.getStats();
      const container = document.getElementById('saver-usage-stats');
      const wsLabel = document.getElementById('saver-usage-workspace');
      if (!container) return;

      // 显示当前工作空间名
      try {
        const wsName = window.ChatGPTSaver?.Parser?.getWorkspaceName?.() || '';
        if (wsLabel) wsLabel.textContent = wsName ? `· ${wsName}` : '';
      } catch (e) { /* ignore */ }

      let html = '';
      UsageMonitor.targetModels.forEach(m => {
        const s = stats[m.id];
        if (s) {
          const limit = m.limit || 0;
          let color = '#10a37f';
          if (limit > 0) {
            const ratio = s.today / limit;
            if (ratio >= 1.0) color = '#ef4444';
            else if (ratio >= 0.8) color = '#f59e0b';
          }
          html += `<div class="saver-usage-item"><div class="saver-usage-model">${s.name}</div><div class="saver-usage-count" style="color: ${color}">${s.today}<span style="font-size: 0.85em; opacity: 0.6; color: var(--saver-text);">/${limit}</span></div></div>`;
        }
      });

      // 添加当前工作空间的已保存次数
      const savedEl = document.getElementById('saver-ws-saved-count');
      if (savedEl) {
        // 异步更新保存次数
        this._refreshSavedCount();
      } else {
        // 首次渲染，追加已保存卡片
        html += `<div class="saver-usage-item" style="grid-column: 1 / -1; display: flex; align-items: center; justify-content: center; gap: 6px; padding: 4px 6px;">
          <div class="saver-usage-model" style="margin: 0;">💾 已保存</div>
          <div class="saver-usage-count" id="saver-ws-saved-count" style="margin: 0; font-size: 13px;">0</div>
          <div class="saver-usage-model" style="margin: 0;">次</div>
        </div>`;
      }

      container.innerHTML = html;
      this._refreshSavedCount();
    },

    async _refreshSavedCount() {
      try {
        const wsName = window.ChatGPTSaver?.Parser?.getWorkspaceName?.() || '默认';
        const r = await chrome.storage.local.get(['wsSavedCounts']);
        const counts = r.wsSavedCounts || {};
        const count = counts[wsName] || 0;
        const el = document.getElementById('saver-ws-saved-count');
        if (el) el.textContent = count;
      } catch (e) { /* ignore */ }
    },

    _injectCheckboxOverlays() {
      this._removeCheckboxOverlays();
      const msgEls = window.ChatGPTSaver.Parser.getMessageElements();
      msgEls.forEach((el, idx) => {
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.className = 'saver-select-cb';
        cb.dataset.idx = idx;
        cb.style.cssText = 'position:absolute;left:-28px;top:12px;width:18px;height:18px;cursor:pointer;z-index:10;accent-color:#10a37f;';
        const wrapper = el.closest('[data-message-author-role]') || el;
        wrapper.style.position = 'relative';
        wrapper.prepend(cb);
        cb.addEventListener('click', (e) => {
          const sm = window.ChatGPTSaver.SelectionManager;
          if (!sm) return;
          if (e.shiftKey) {
            sm.shiftSelect(idx);
          } else {
            sm.toggle(idx);
          }
          this._syncCheckboxes();
          this._updateSelectionCount();
        });
      });
    },

    _syncCheckboxes() {
      const sm = window.ChatGPTSaver.SelectionManager;
      if (!sm) return;
      const indices = sm.getSelectedIndices();
      document.querySelectorAll('.saver-select-cb').forEach(cb => {
        cb.checked = indices.has(parseInt(cb.dataset.idx));
      });
    },

    _updateSelectionCount() {
      const sm = window.ChatGPTSaver.SelectionManager;
      const btn = document.getElementById('saver-export-selected');
      if (!sm || !btn) return;
      const count = sm.selectedCount();
      btn.textContent = `导出选中 (${count})`;
      btn.disabled = count === 0;
    },

    _removeCheckboxOverlays() {
      document.querySelectorAll('.saver-select-cb').forEach(cb => cb.remove());
    },

    _exitSelectionMode() {
      const sm = window.ChatGPTSaver.SelectionManager;
      if (sm) sm.deactivate();
      this._removeCheckboxOverlays();
      const bar = document.getElementById('saver-selection-bar');
      const btn = document.getElementById('saver-selection-btn');
      if (bar) bar.style.display = 'none';
      if (btn) btn.style.display = 'block';
    },

    async _refreshTemplateList() {
      // 渲染预设延续模板
      this._refreshCtxTemplateList();
    },

    _refreshCtxTemplateList() {
      const listEl = document.getElementById('saver-ctx-template-list');
      if (!listEl) return;
      const lang = ContextPromptTemplates._lang;
      const templates = ContextPromptTemplates.templates;
      const selectedIdx = ContextPromptTemplates._selectedIdx;

      listEl.innerHTML = templates.map((t, i) => {
        const preview = (t.prompt[lang] || '').substring(0, 60).replace(/\{title\}/g, '…').replace(/\{msgCount\}/g, 'N').replace(/\{attNote\}/g, '') + '...';
        const isActive = i === selectedIdx;
        return `<div class="saver-context-item" data-ctx-tpl-idx="${i}" style="cursor:pointer;${isActive ? 'border-color:#10a37f;background:var(--saver-format-active-bg);' : ''}">
          <span class="ctx-icon" style="font-size:14px;">${isActive ? '✅' : '⚪'}</span>
          <div class="ctx-info">
            <div class="ctx-title" style="font-size:12px;">${t.name[lang]}</div>
            <div class="ctx-meta">${preview}</div>
          </div>
          <button class="saver-ctx-tpl-edit" data-idx="${i}" style="background:none;border:none;cursor:pointer;font-size:14px;flex-shrink:0;" title="编辑">✏️</button>
        </div>`;
      }).join('');

      // 点击选中模板
      listEl.querySelectorAll('.saver-context-item').forEach(item => {
        item.onclick = (e) => {
          if (e.target.closest('.saver-ctx-tpl-edit')) return;
          const idx = parseInt(item.dataset.ctxTplIdx);
          ContextPromptTemplates._selectedIdx = idx;
          try { chrome.storage.local.set({ ctxPromptIdx: idx }); } catch (err) { /* ignore */ }
          // 同步更新延续 tab 的下拉框
          const sel = document.getElementById('saver-ctx-prompt-select');
          if (sel) sel.value = idx;
          this._refreshCtxTemplateList();
          this.showToast('✅ 已切换延续模板', 'success');
        };
      });

      // 编辑模板
      listEl.querySelectorAll('.saver-ctx-tpl-edit').forEach(btn => {
        btn.onclick = (e) => {
          e.stopPropagation();
          const idx = parseInt(btn.dataset.idx);
          const tpl = templates[idx];
          if (!tpl) return;
          this._showTemplateEditor(idx, tpl, lang);
        };
      });
    },

    _showTemplateEditor(idx, tpl, lang) {
      // 移除已有的编辑器
      const existing = document.getElementById('saver-tpl-editor-overlay');
      if (existing) existing.remove();

      const currentPrompt = tpl.prompt[lang];
      const overlay = document.createElement('div');
      overlay.id = 'saver-tpl-editor-overlay';
      overlay.className = 'saver-tpl-editor-overlay';

      // 获取默认模板用于重置
      const defaultTemplates = this._getDefaultTemplates();
      const hasOverride = defaultTemplates[idx] && currentPrompt !== defaultTemplates[idx][lang];

      overlay.innerHTML = `
        <div class="saver-tpl-editor-dialog">
          <h3>✏️ 编辑「${tpl.name[lang]}」</h3>
          <div class="saver-tpl-vars">
            可用变量：<code>{title}</code> 对话标题 · <code>{msgCount}</code> 消息数 · <code>{attNote}</code> 附件说明
          </div>
          <textarea class="saver-tpl-editor-textarea" id="saver-tpl-editor-input">${currentPrompt.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</textarea>
          <div class="saver-tpl-editor-actions">
            <button class="saver-tpl-reset" id="saver-tpl-reset-btn" ${hasOverride ? '' : 'style="display:none;"'}>↩ 恢复默认</button>
            <button class="saver-tpl-cancel" id="saver-tpl-cancel-btn">取消</button>
            <button class="saver-tpl-save" id="saver-tpl-save-btn">💾 保存</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);

      const textarea = document.getElementById('saver-tpl-editor-input');
      const saveBtn = document.getElementById('saver-tpl-save-btn');
      const cancelBtn = document.getElementById('saver-tpl-cancel-btn');
      const resetBtn = document.getElementById('saver-tpl-reset-btn');

      // 自动聚焦并把光标放到末尾
      textarea.focus();
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);

      const close = () => overlay.remove();

      saveBtn.onclick = () => {
        const newPrompt = textarea.value;
        if (newPrompt === currentPrompt) { close(); return; }
        tpl.prompt[lang] = newPrompt;
        this._saveCtxTemplateOverrides();
        this._refreshCtxTemplateList();
        this.showToast('✅ 模板已更新', 'success');
        close();
      };

      cancelBtn.onclick = close;

      resetBtn.onclick = () => {
        if (defaultTemplates[idx]) {
          textarea.value = defaultTemplates[idx][lang];
          textarea.focus();
        }
      };

      // 点击遮罩关闭
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) close();
      });

      // ESC 关闭
      const onKey = (e) => {
        if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); }
      };
      document.addEventListener('keydown', onKey);
    },

    _getDefaultTemplates() {
      // 返回默认模板内容，用于"恢复默认"功能
      return {
        0: {
          zh: '我已上传了一个 JSON 文件，这是之前对话「{title}」的上下文记录（共 {msgCount} 条消息）。{attNote}\n\n请你：\n1. 仔细阅读这个 JSON 文件中的对话内容\n2. 理解对话的主题、背景和我们讨论的要点\n3. 简要总结对话的核心内容（用 3-5 个要点）\n4. 然后告诉我你已准备好继续这个对话\n\n注意：请基于文件中的实际内容来理解，而不是猜测。',
          en: 'I\'ve uploaded a JSON file containing the context of a previous conversation titled "{title}" ({msgCount} messages).{attNote}\n\nPlease:\n1. Carefully read the conversation content in the JSON file\n2. Understand the topic, background, and key discussion points\n3. Briefly summarize the core content (3-5 key points)\n4. Then let me know you\'re ready to continue this conversation\n\nNote: Please base your understanding on the actual file content, not assumptions.'
        },
        1: {
          zh: '我已上传了一个 JSON 文件，这是之前对话「{title}」的上下文记录（共 {msgCount} 条消息）。{attNote}\n\n这是一个跨工作空间的项目开发对话延续。请你：\n1. 阅读 JSON 文件中的完整对话记录\n2. 识别项目的技术栈、架构和当前开发进度\n3. 梳理已完成的功能、待解决的问题和下一步计划\n4. 列出对话中提到的关键文件和代码变更\n5. 总结当前项目状态，然后告诉我你已准备好继续开发\n\n请特别注意代码片段、错误信息和技术决策的上下文。',
          en: 'I\'ve uploaded a JSON file with the context of conversation "{title}" ({msgCount} messages).{attNote}\n\nThis is a cross-workspace project development continuation. Please:\n1. Read the complete conversation in the JSON file\n2. Identify the tech stack, architecture, and current development progress\n3. Outline completed features, pending issues, and next steps\n4. List key files and code changes mentioned in the conversation\n5. Summarize the current project status, then let me know you\'re ready to continue\n\nPay special attention to code snippets, error messages, and technical decisions.'
        },
        2: {
          zh: '我已上传了一个 JSON 文件，这是之前对话「{title}」的上下文记录（共 {msgCount} 条消息）。{attNote}\n\n我们之前在排查一个问题，请你：\n1. 阅读 JSON 文件中的对话内容\n2. 识别我们正在排查的问题/Bug 是什么\n3. 梳理已经尝试过的解决方案和排查步骤\n4. 总结哪些方案有效、哪些无效\n5. 分析问题的当前状态（已解决/部分解决/未解决）\n6. 如果未解决，提出下一步排查建议\n\n请基于对话中的实际错误信息和代码来分析。',
          en: 'I\'ve uploaded a JSON file with the context of conversation "{title}" ({msgCount} messages).{attNote}\n\nWe were debugging an issue. Please:\n1. Read the conversation content in the JSON file\n2. Identify the problem/bug we were investigating\n3. Outline solutions and debugging steps already attempted\n4. Summarize what worked and what didn\'t\n5. Analyze the current status (resolved/partially resolved/unresolved)\n6. If unresolved, suggest next debugging steps\n\nPlease base your analysis on actual error messages and code from the conversation.'
        },
        3: {
          zh: '我已上传了一个 JSON 文件，这是之前对话「{title}」的上下文记录（共 {msgCount} 条消息）。{attNote}\n\n我们之前在讨论系统架构/设计方案，请你：\n1. 阅读 JSON 文件中的完整讨论\n2. 梳理讨论过的架构方案和设计决策\n3. 列出已确定的技术选型和设计模式\n4. 总结各方案的优缺点对比\n5. 明确当前的设计共识和待决定的事项\n6. 准备好继续深入讨论\n\n请保持对之前讨论中技术细节的准确理解。',
          en: 'I\'ve uploaded a JSON file with the context of conversation "{title}" ({msgCount} messages).{attNote}\n\nWe were discussing system architecture/design. Please:\n1. Read the complete discussion in the JSON file\n2. Outline the architecture proposals and design decisions discussed\n3. List confirmed technology choices and design patterns\n4. Summarize pros and cons of each approach\n5. Clarify current design consensus and pending decisions\n6. Be ready to continue the in-depth discussion\n\nPlease maintain accurate understanding of technical details from the previous discussion.'
        },
        4: {
          zh: '我已上传了对话「{title}」的上下文（{msgCount} 条消息）。{attNote}\n\n请快速阅读并用 2-3 句话总结核心内容，然后我们继续。',
          en: 'I\'ve uploaded the context of conversation "{title}" ({msgCount} messages).{attNote}\n\nPlease quickly read and summarize the core content in 2-3 sentences, then let\'s continue.'
        }
      };
    },

    _saveCtxTemplateOverrides() {
      const overrides = {};
      ContextPromptTemplates.templates.forEach((t, i) => {
        overrides[i] = { zh: t.prompt.zh, en: t.prompt.en };
      });
      try { chrome.storage.local.set({ ctxTemplateOverrides: overrides }); } catch (e) { /* ignore */ }
    },

  };

  // 暴露 UI 的日志接口给 Exporter 使用（兼容 Logger 接口）
  window.ChatGPTSaver = window.ChatGPTSaver || {};
  window.ChatGPTSaver.UI = UI;
  // SelectionManager 由 selectionManager.js 注入到 window.ChatGPTSaver.SelectionManager
  window.ChatGPTSaver.Logger = {
    panelVisible: false,
    clear() { UI.clearLog(); },
    add(msg) { UI.addLog(msg); },
    showPanel() { UI.showLog(); this.panelVisible = true; },
    hidePanel() { this.panelVisible = false; },
    complete(title, msg) { UI.logComplete(title, msg); },
    fail(msg) { UI.logError(msg); }
  };


  // ==================== 附件管理器 ====================
  const AttachmentManager = {
    uploadInterceptorStarted: false,
    fetchListenerStarted: false,

    init() {
      this.startUploadInterceptor();
      this.startFetchListener();
    },

    // 监听 fetchInterceptor 通过 postMessage 发来的文件上传通知
    startFetchListener() {
      if (this.fetchListenerStarted) return;
      this.fetchListenerStarted = true;
      window.addEventListener('message', async (event) => {
        if (event.source !== window || !event.data) return;
        if (event.data.type === 'SAVER_FILE_UPLOADED' && Array.isArray(event.data.files)) {
          const files = event.data.files;
          if (files.length === 0) return;
          console.log(`[ChatGPT Saver] fetch 拦截到 ${files.length} 个文件上传`);
          await this.interceptUploadedFiles(files);
        }
      });
    },

    // 监听用户上传文件，自动保存到对话的 attachments 文件夹
    startUploadInterceptor() {
      if (this.uploadInterceptorStarted) return;
      this.uploadInterceptorStarted = true;

      document.addEventListener('change', async (e) => {
        const target = e.target;
        if (target.type === 'file' && !target.id?.startsWith('saver-')) {
          const files = target.files;
          if (files && files.length > 0) {
            console.log(`[ChatGPT Saver] 检测到用户上传 ${files.length} 个文件`);
            await this.interceptUploadedFiles(files);
          }
        }
      }, true);

      document.addEventListener('drop', async (e) => {
        setTimeout(async () => {
          const dt = e.dataTransfer;
          if (dt && dt.files && dt.files.length > 0) {
            console.log(`[ChatGPT Saver] 检测到拖放上传 ${dt.files.length} 个文件`);
            await this.interceptUploadedFiles(dt.files);
          }
        }, 100);
      }, true);
    },

    async interceptUploadedFiles(fileList) {
      const fs = window.ChatGPTSaver?.FileSystem;
      if (!fs || !fs.isAuthorized()) return;
      try {
        const parser = window.ChatGPTSaver.Parser;
        const wsName = parser.getWorkspaceName() || '个人帐户';
        const title = parser.getConversationTitle();
        if (!title) return;
        const sanitize = (n) => n.replace(/[/\\:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim().substring(0, 100);
        const rootHandle = await fs.getBackupRootHandle();
        if (!rootHandle) return;
        const wsFolder = await rootHandle.getDirectoryHandle(sanitize(wsName), { create: true });
        const convFolder = await wsFolder.getDirectoryHandle(sanitize(title), { create: true });
        const attFolder = await convFolder.getDirectoryHandle('attachments', { create: true });

        let savedCount = 0;
        // 去重：记录最近保存的文件名+大小，避免 change 事件和 fetch 拦截重复保存
        if (!this._recentSaves) this._recentSaves = new Map();
        const now = Date.now();
        // 清理 30 秒前的记录
        for (const [key, ts] of this._recentSaves) {
          if (now - ts > 30000) this._recentSaves.delete(key);
        }

        for (const file of fileList) {
          const dedupeKey = `${file.name}_${file.size}`;
          if (this._recentSaves.has(dedupeKey)) {
            console.log(`[ChatGPT Saver] 跳过重复附件: ${file.name}`);
            continue;
          }
          try {
            await fs.writeFile(attFolder, file.name, file, file.type);
            savedCount++;
            this._recentSaves.set(dedupeKey, now);
            console.log(`[ChatGPT Saver] ✅ 附件已保存: ${file.name}`);
          } catch (e) { console.error(`[ChatGPT Saver] 保存附件失败 ${file.name}:`, e); }
        }
        if (savedCount > 0) UI.showToast(`📥 已自动保存 ${savedCount} 个附件`, 'success', 3000);
      } catch (e) { console.log('[ChatGPT Saver] 拦截附件保存失败:', e.message); }
    },

    // 扫描页面 DOM 中用户上传的附件名称
    scanAttachmentsFromDOM() {
      const attachments = [];
      const userMessages = document.querySelectorAll('[data-message-author-role="user"]');
      for (const msgEl of userMessages) {
        const container = msgEl.closest('[class*="group"]') || msgEl.closest('article') || msgEl.parentElement?.parentElement;
        if (!container) continue;
        // 查找带文件扩展名的文本元素
        const textEls = container.querySelectorAll('[class*="truncate"], [class*="overflow-hidden"], [class*="text-ellipsis"], [class*="line-clamp"]');
        for (const el of textEls) {
          if (el.closest('[data-message-author-role="assistant"]') || el.closest('[class*="footnote"]') || el.closest('[class*="citation"]')) continue;
          const text = el.textContent?.trim();
          if (text && text.length < 200 && text.length > 2) {
            if (text.match(/\.(doc|docx|pdf|txt|md|json|csv|xls|xlsx|ppt|pptx|zip|rar|png|jpg|jpeg|gif|py|js|ts|html|css|java|cpp|c|xml|yaml|yml)(\.\.\.)?$/i)) {
              const cleanName = text.replace(/\.\.\.\s*$/, '').trim();
              if (cleanName && !attachments.some(a => a.name === cleanName)) attachments.push({ name: cleanName });
            }
          }
        }
        // 查找附件特定选择器
        const selectors = ['[data-testid="attachment"]', '[data-testid="file-thumbnail"]', 'a[download]'];
        for (const sel of selectors) {
          try {
            for (const el of container.querySelectorAll(sel)) {
              if (el.closest('[data-message-author-role="assistant"]')) continue;
              let name = el.getAttribute('download') || el.getAttribute('alt') || el.getAttribute('title');
              if (!name) { const t = el.textContent?.trim(); if (t && t.length < 100 && t.match(/\.[a-zA-Z0-9]{2,5}$/)) name = t; }
              if (name) { name = name.replace(/\.\.\.\s*$/, '').trim(); if (!attachments.some(a => a.name === name)) attachments.push({ name }); }
            }
          } catch (e) { /* ignore */ }
        }
      }
      return attachments;
    },

    // 保存 DOM 检测到的附件（从 attachments 文件夹匹配或跳过）
    async detectAndSaveAttachments(safeWs, safeTitle) {
      const fs = window.ChatGPTSaver?.FileSystem;
      if (!fs || !fs.isAuthorized()) return;
      const detected = this.scanAttachmentsFromDOM();
      if (detected.length === 0) return;
      console.log(`[ChatGPT Saver] DOM 检测到 ${detected.length} 个附件`);
      // attachments 文件夹已由 interceptUploadedFiles 创建，这里只做日志
      UI.addLog?.(`📎 检测到 ${detected.length} 个附件`);
    }
  };

  // ==================== 上下文延续提示词模板 ====================
  const ContextPromptTemplates = {
    _lang: 'zh', // 'zh' or 'en'
    _selectedIdx: 0,

    templates: [
      {
        name: { zh: '📋 标准延续', en: '📋 Standard Resume' },
        prompt: {
          zh: '我已上传了一个 JSON 文件，这是之前对话「{title}」的上下文记录（共 {msgCount} 条消息）。{attNote}\n\n请你：\n1. 仔细阅读这个 JSON 文件中的对话内容\n2. 理解对话的主题、背景和我们讨论的要点\n3. 简要总结对话的核心内容（用 3-5 个要点）\n4. 然后告诉我你已准备好继续这个对话\n\n注意：请基于文件中的实际内容来理解，而不是猜测。',
          en: 'I\'ve uploaded a JSON file containing the context of a previous conversation titled "{title}" ({msgCount} messages).{attNote}\n\nPlease:\n1. Carefully read the conversation content in the JSON file\n2. Understand the topic, background, and key discussion points\n3. Briefly summarize the core content (3-5 key points)\n4. Then let me know you\'re ready to continue this conversation\n\nNote: Please base your understanding on the actual file content, not assumptions.'
        }
      },
      {
        name: { zh: '🔧 项目开发延续', en: '🔧 Dev Project Resume' },
        prompt: {
          zh: '我已上传了一个 JSON 文件，这是之前对话「{title}」的上下文记录（共 {msgCount} 条消息）。{attNote}\n\n这是一个跨工作空间的项目开发对话延续。请你：\n1. 阅读 JSON 文件中的完整对话记录\n2. 识别项目的技术栈、架构和当前开发进度\n3. 梳理已完成的功能、待解决的问题和下一步计划\n4. 列出对话中提到的关键文件和代码变更\n5. 总结当前项目状态，然后告诉我你已准备好继续开发\n\n请特别注意代码片段、错误信息和技术决策的上下文。',
          en: 'I\'ve uploaded a JSON file with the context of conversation "{title}" ({msgCount} messages).{attNote}\n\nThis is a cross-workspace project development continuation. Please:\n1. Read the complete conversation in the JSON file\n2. Identify the tech stack, architecture, and current development progress\n3. Outline completed features, pending issues, and next steps\n4. List key files and code changes mentioned in the conversation\n5. Summarize the current project status, then let me know you\'re ready to continue\n\nPay special attention to code snippets, error messages, and technical decisions.'
        }
      },
      {
        name: { zh: '🐛 问题排查延续', en: '🐛 Debug Resume' },
        prompt: {
          zh: '我已上传了一个 JSON 文件，这是之前对话「{title}」的上下文记录（共 {msgCount} 条消息）。{attNote}\n\n我们之前在排查一个问题，请你：\n1. 阅读 JSON 文件中的对话内容\n2. 识别我们正在排查的问题/Bug 是什么\n3. 梳理已经尝试过的解决方案和排查步骤\n4. 总结哪些方案有效、哪些无效\n5. 分析问题的当前状态（已解决/部分解决/未解决）\n6. 如果未解决，提出下一步排查建议\n\n请基于对话中的实际错误信息和代码来分析。',
          en: 'I\'ve uploaded a JSON file with the context of conversation "{title}" ({msgCount} messages).{attNote}\n\nWe were debugging an issue. Please:\n1. Read the conversation content in the JSON file\n2. Identify the problem/bug we were investigating\n3. Outline solutions and debugging steps already attempted\n4. Summarize what worked and what didn\'t\n5. Analyze the current status (resolved/partially resolved/unresolved)\n6. If unresolved, suggest next debugging steps\n\nPlease base your analysis on actual error messages and code from the conversation.'
        }
      },
      {
        name: { zh: '📐 架构设计延续', en: '📐 Architecture Resume' },
        prompt: {
          zh: '我已上传了一个 JSON 文件，这是之前对话「{title}」的上下文记录（共 {msgCount} 条消息）。{attNote}\n\n我们之前在讨论系统架构/设计方案，请你：\n1. 阅读 JSON 文件中的完整讨论\n2. 梳理讨论过的架构方案和设计决策\n3. 列出已确定的技术选型和设计模式\n4. 总结各方案的优缺点对比\n5. 明确当前的设计共识和待决定的事项\n6. 准备好继续深入讨论\n\n请保持对之前讨论中技术细节的准确理解。',
          en: 'I\'ve uploaded a JSON file with the context of conversation "{title}" ({msgCount} messages).{attNote}\n\nWe were discussing system architecture/design. Please:\n1. Read the complete discussion in the JSON file\n2. Outline the architecture proposals and design decisions discussed\n3. List confirmed technology choices and design patterns\n4. Summarize pros and cons of each approach\n5. Clarify current design consensus and pending decisions\n6. Be ready to continue the in-depth discussion\n\nPlease maintain accurate understanding of technical details from the previous discussion.'
        }
      },
      {
        name: { zh: '📝 快速恢复（简洁）', en: '📝 Quick Resume (Brief)' },
        prompt: {
          zh: '我已上传了对话「{title}」的上下文（{msgCount} 条消息）。{attNote}\n\n请快速阅读并用 2-3 句话总结核心内容，然后我们继续。',
          en: 'I\'ve uploaded the context of conversation "{title}" ({msgCount} messages).{attNote}\n\nPlease quickly read and summarize the core content in 2-3 sentences, then let\'s continue.'
        }
      }
    ],

    init() {
      this._loadPreference();
      this._renderSelect();
      this._bindEvents();
    },

    _loadPreference() {
      try {
        chrome.storage.local.get(['ctxPromptLang', 'ctxPromptIdx', 'ctxTemplateOverrides'], (r) => {
          if (r.ctxPromptLang) this._lang = r.ctxPromptLang;
          if (typeof r.ctxPromptIdx === 'number') this._selectedIdx = r.ctxPromptIdx;
          // 恢复用户编辑过的模板内容
          if (r.ctxTemplateOverrides) {
            Object.keys(r.ctxTemplateOverrides).forEach(idx => {
              const i = parseInt(idx);
              if (this.templates[i] && r.ctxTemplateOverrides[idx]) {
                if (r.ctxTemplateOverrides[idx].zh) this.templates[i].prompt.zh = r.ctxTemplateOverrides[idx].zh;
                if (r.ctxTemplateOverrides[idx].en) this.templates[i].prompt.en = r.ctxTemplateOverrides[idx].en;
              }
            });
          }
          this._renderSelect();
          this._updateLangBtn();
        });
      } catch (e) { /* ignore */ }
    },

    _renderSelect() {
      const sel = document.getElementById('saver-ctx-prompt-select');
      if (!sel) return;
      sel.innerHTML = '';
      this.templates.forEach((t, i) => {
        const opt = document.createElement('option');
        opt.value = i;
        opt.textContent = t.name[this._lang];
        if (i === this._selectedIdx) opt.selected = true;
        sel.appendChild(opt);
      });
    },

    _updateLangBtn() {
      const btn = document.getElementById('saver-ctx-lang-toggle');
      if (btn) btn.textContent = this._lang === 'zh' ? '🌐 中文' : '🌐 EN';
    },

    _bindEvents() {
      const sel = document.getElementById('saver-ctx-prompt-select');
      if (sel) {
        sel.addEventListener('change', () => {
          this._selectedIdx = parseInt(sel.value) || 0;
          try { chrome.storage.local.set({ ctxPromptIdx: this._selectedIdx }); } catch (e) { /* ignore */ }
        });
      }
      const langBtn = document.getElementById('saver-ctx-lang-toggle');
      if (langBtn) {
        langBtn.addEventListener('click', () => {
          this._lang = this._lang === 'zh' ? 'en' : 'zh';
          this._updateLangBtn();
          this._renderSelect();
          try { chrome.storage.local.set({ ctxPromptLang: this._lang }); } catch (e) { /* ignore */ }
        });
      }
    },

    buildPrompt(title, msgCount, ctxFiles = [], attFiles = []) {
      // 兼容旧调用方式：buildPrompt(title, msgCount, attFiles)
      // 新调用方式：buildPrompt(title, msgCount, ctxFiles, attFiles)
      // 区分：如果第3个参数的元素没有 .name 以 .json 结尾，当作 attFiles
      let ctxArr = Array.isArray(ctxFiles) ? ctxFiles : [];
      let attArr = Array.isArray(attFiles) ? attFiles : [];
      if (ctxArr.length > 0 && !ctxArr[0]?.name?.endsWith('.json')) {
        // 旧调用方式，第3个参数其实是 attFiles
        attArr = ctxArr;
        ctxArr = [];
      }

      const tpl = this.templates[this._selectedIdx] || this.templates[0];
      const lang = this._lang;

      // 构建 JSON 文件描述
      let jsonDesc = '';
      if (ctxArr.length > 1) {
        jsonDesc = lang === 'zh'
          ? `${ctxArr.length} 个 JSON 上下文文件（${ctxArr.map(f => f.name).join('、')}）`
          : `${ctxArr.length} JSON context files (${ctxArr.map(f => f.name).join(', ')})`;
      }

      // 构建附件描述
      let attNote = '';
      if (attArr.length > 0) {
        attNote = lang === 'zh'
          ? `\n\n同时我还上传了 ${attArr.length} 个相关附件文件（${attArr.map(f => f.name).join('、')}），请在需要时参考这些文件。`
          : `\n\nI've also uploaded ${attArr.length} related attachment(s) (${attArr.map(f => f.name).join(', ')}). Please refer to them when needed.`;
      }

      let result = tpl.prompt[lang]
        .replace(/\{title\}/g, title)
        .replace(/\{msgCount\}/g, msgCount)
        .replace(/\{attNote\}/g, attNote);

      // 如果有多个 JSON 文件，替换模板中"一个 JSON 文件"为实际数量
      if (ctxArr.length > 1) {
        if (lang === 'zh') {
          result = result.replace(/一个 JSON 文件/g, jsonDesc);
          result = result.replace(/这个 JSON 文件/g, '这些 JSON 文件');
        } else {
          result = result.replace(/a JSON file/gi, jsonDesc);
          result = result.replace(/the JSON file/gi, 'the JSON files');
        }
      }

      return result;
    }
  };

  // ==================== 上下文管理器 ====================
  const ContextManager = {
    _cachedFiles: [],

    async scanContextFiles() {
      const fs = window.ChatGPTSaver?.FileSystem;
      if (!fs || !fs.isAuthorized()) return [];
      try {
        const rootHandle = await fs.getBackupRootHandle();
        if (!rootHandle) return [];
        const files = [];
        for await (const wsEntry of rootHandle.values()) {
          if (wsEntry.kind !== 'directory') continue;
          const wsHandle = await rootHandle.getDirectoryHandle(wsEntry.name);
          for await (const convEntry of wsHandle.values()) {
            if (convEntry.kind !== 'directory') continue;
            const convHandle = await wsHandle.getDirectoryHandle(convEntry.name);
            // 扫描 context JSON 文件
            let contextFiles = [];
            try {
              const ctxFolder = await convHandle.getDirectoryHandle('context', { create: false });
              for await (const fileEntry of ctxFolder.values()) {
                if (fileEntry.kind === 'file' && fileEntry.name.endsWith('.json') && !fileEntry.name.startsWith('_')) {
                  contextFiles.push(fileEntry);
                }
              }
            } catch (e) { /* no context folder */ }
            if (contextFiles.length === 0) continue;
            // 扫描 attachments 文件夹
            let attachmentHandles = [];
            try {
              const attFolder = await convHandle.getDirectoryHandle('attachments', { create: false });
              for await (const attEntry of attFolder.values()) {
                if (attEntry.kind === 'file') attachmentHandles.push(attEntry);
              }
            } catch (e) { /* no attachments folder */ }
            // 智能匹配：排除所有上下文 JSON 文件名，只保留真正的附件
            const ctxNames = new Set(contextFiles.map(f => f.name));
            const relevantAttachments = attachmentHandles.filter(att => !ctxNames.has(att.name));
            // 合并同一对话下的所有 JSON 上下文为一个条目
            files.push({
              workspace: wsEntry.name, conversation: convEntry.name,
              filename: contextFiles[0].name,
              handle: contextFiles[0],
              allContextHandles: contextFiles,
              attachments: relevantAttachments
            });
          }
        }
        files.sort((a, b) => a.conversation.localeCompare(b.conversation));
        return files;
      } catch (e) { console.error('[ContextManager] 扫描失败:', e); return []; }
    },

    async refreshList() {
      const listEl = document.getElementById('saver-context-list');
      if (!listEl) return;
      listEl.innerHTML = '<div class="saver-context-status">扫描中...</div>';
      const files = await this.scanContextFiles();
      if (files.length === 0) {
        listEl.innerHTML = '<div class="saver-context-status">暂无上下文文件<br><span style="font-size:11px;opacity:0.7;">保存对话时会自动生成上下文</span></div>';
        return;
      }
      this._cachedFiles = files;

      // 按 workspace 分组
      const groups = {};
      files.forEach((f, i) => {
        if (!groups[f.workspace]) groups[f.workspace] = [];
        groups[f.workspace].push({ ...f, _idx: i });
      });

      let html = '';
      Object.keys(groups).sort().forEach(ws => {
        const items = groups[ws];
        html += `<div class="saver-ws-group" data-ws="${ws}">
          <div class="saver-ws-header expanded">
            <span class="saver-ws-arrow">▶</span>
            <span>📁 ${ws}</span>
            <span class="saver-ws-count">${items.length}</span>
          </div>
          <div class="saver-ws-children">`;
        items.forEach(f => {
          const attCount = f.attachments?.length || 0;
          const ctxCount = f.allContextHandles?.length || 1;
          const metaParts = [];
          if (ctxCount > 1) metaParts.push(`📄${ctxCount} 个上下文`);
          if (attCount > 0) metaParts.push(`📎${attCount} 个附件`);
          html += `<div class="saver-context-item" draggable="true" data-idx="${f._idx}" title="拖拽到 ChatGPT 对话框导入\n${f.workspace}/${f.conversation}${ctxCount > 1 ? '\n含 ' + ctxCount + ' 个上下文文件' : ''}${attCount ? '\n含 ' + attCount + ' 个附件' : ''}">
            <span class="ctx-icon">${attCount > 0 ? '📎' : '📄'}</span>
            <div class="ctx-info">
              <div class="ctx-title">${f.conversation}</div>
              <div class="ctx-meta">${metaParts.join(' · ') || ''}</div>
            </div>
            <span class="ctx-drag-hint">⠿</span>
          </div>`;
        });
        html += `</div></div>`;
      });
      listEl.innerHTML = html;

      // 绑定 workspace 折叠/展开
      listEl.querySelectorAll('.saver-ws-header').forEach(header => {
        header.addEventListener('click', () => header.classList.toggle('expanded'));
      });

      // 绑定拖拽事件 — 让 JSON + 附件一起拖出到 ChatGPT 对话框
      listEl.querySelectorAll('.saver-context-item').forEach(item => {
        item.addEventListener('dragstart', async (e) => {
          const idx = parseInt(item.dataset.idx);
          const fileInfo = this._cachedFiles[idx];
          if (!fileInfo) return;
          try {
            // 添加所有上下文 JSON 文件
            const ctxHandles = fileInfo.allContextHandles || [fileInfo.handle];
            for (const h of ctxHandles) {
              try { e.dataTransfer.items.add(await h.getFile()); } catch (err) { /* skip */ }
            }
            // 添加所有关联附件
            if (fileInfo.attachments?.length) {
              for (const attHandle of fileInfo.attachments) {
                try { e.dataTransfer.items.add(await attHandle.getFile()); } catch (err) { /* skip */ }
              }
            }
            e.dataTransfer.setData('text/plain', fileInfo.filename);
            e.dataTransfer.effectAllowed = 'copy';
            item.style.opacity = '0.5';
          } catch (err) {
            console.error('[ContextManager] 拖拽准备失败:', err);
          }
        });
        item.addEventListener('dragend', () => { item.style.opacity = '1'; });

        // 点击也支持：上传所有 JSON + 附件到 ChatGPT
        item.addEventListener('click', async () => {
          const idx = parseInt(item.dataset.idx);
          const fileInfo = this._cachedFiles[idx];
          if (!fileInfo) return;
          try {
            UI.showToast('📎 正在导入上下文...', 'saving', 0);
            // 收集所有上下文 JSON 文件
            const ctxHandles = fileInfo.allContextHandles || [fileInfo.handle];
            const ctxFiles = [];
            for (const h of ctxHandles) {
              try { ctxFiles.push(await h.getFile()); } catch (e) { /* skip */ }
            }
            // 收集所有附件
            const attFiles = [];
            if (fileInfo.attachments?.length) {
              for (const attHandle of fileInfo.attachments) {
                try { attFiles.push(await attHandle.getFile()); } catch (e) { /* skip */ }
              }
            }
            await this._uploadToChatGPT(ctxFiles, fileInfo, attFiles);
          } catch (err) {
            UI.showToast('❌ 导入失败: ' + err.message, 'error');
          }
        });
      });
    },

    // 点击时：通过 ChatGPT 的 file input 上传所有 JSON + 附件，并注入提示词
    async _uploadToChatGPT(ctxFiles, fileInfo, attFiles = []) {
      // ctxFiles 可以是单个 File 或 File 数组（兼容）
      const ctxArr = Array.isArray(ctxFiles) ? ctxFiles : [ctxFiles];

      const fileInputs = document.querySelectorAll('input[type="file"]');
      let targetInput = null;
      for (const inp of fileInputs) {
        if (!inp.id?.startsWith('saver-') && (!inp.accept || inp.accept.includes('*') || inp.accept.includes('json'))) { targetInput = inp; break; }
      }
      if (!targetInput && fileInputs.length > 0) {
        for (const inp of fileInputs) { if (!inp.id?.startsWith('saver-')) { targetInput = inp; break; } }
      }

      if (targetInput) {
        const dt = new DataTransfer();
        for (const cf of ctxArr) dt.items.add(cf);
        for (const att of attFiles) dt.items.add(att);
        targetInput.files = dt.files;
        targetInput.dispatchEvent(new Event('change', { bubbles: true }));
      }

      // 注入提示词（使用选中的模板）
      await new Promise(r => setTimeout(r, 500));

      // 汇总所有 JSON 上下文的消息数
      let title = fileInfo.conversation;
      let totalMsgCount = 0;
      for (const cf of ctxArr) {
        try {
          const text = await cf.text();
          const data = JSON.parse(text);
          if (!title || title === fileInfo.conversation) title = data.title || title;
          totalMsgCount += data.messageCount || data.messages?.length || 0;
        } catch (e) { /* ignore */ }
      }

      const prompt = ContextPromptTemplates.buildPrompt(title, totalMsgCount, ctxArr, attFiles);

      const input = document.querySelector('#prompt-textarea, [contenteditable="true"][data-placeholder]');
      if (input) {
        if (input.getAttribute('contenteditable') === 'true') {
          const p = input.querySelector('p') || input;
          p.textContent = prompt;
          input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: prompt }));
        } else {
          const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
          if (setter) { setter.call(input, prompt); input.dispatchEvent(new Event('input', { bubbles: true })); }
        }
        input.focus();
      }
      const totalFiles = ctxArr.length + attFiles.length;
      UI.showToast(`✅ 已导入 ${totalFiles} 个文件，请发送消息`, 'success', 3000);
    }
  };

  // ==================== 核心逻辑 ====================
  let isInitialized = false;
  let saveDebounceTimer = null;
  let refreshPromptShown = false;

  async function init() {
    if (isInitialized) return;
    console.log('ChatGPT 对话保存助手正在初始化...');
    await waitForPage();
    await loadSettings();

    // 先初始化 UI（按钮 + 面板 + toast）
    UI.init();

    // 卡密验证
    const cardValid = await CardKeyManager.init();
    if (!cardValid) {
      // 未激活，显示卡密输入界面，隐藏功能面板
      console.log('[ChatGPT Saver] 卡密未激活，等待用户输入');
      UI.showCardKeyOverlay();
      return;
    }

    // 卡密有效，继续初始化
    await initAfterCardKey();
  }

  async function initAfterCardKey() {
    if (isInitialized) return;
    UI.updateCardKeyBadge();
    UI.initCardKeyBadgeClick();
    await UsageMonitor.init();
    AttachmentManager.init();
    ContextPromptTemplates.init();
    await tryRestoreFileAccess();
    setupMessageListener();
    if (config.autoSave) startAutoSave();
    window.ChatGPTSaver.URLObserver.start(handleURLChange);
    isInitialized = true;
    UI.updateStatus();
    UI.updateUsage();
    console.log('ChatGPT 对话保存助手初始化完成');
  }

  async function tryRestoreFileAccess() {
    const restored = await window.ChatGPTSaver.FileSystem.tryRestoreAccess();
    if (restored) {
      console.log('文件夹访问权限已恢复');
      try {
        const r = await chrome.storage.local.get(['savePath']);
        UI.updateFolderStatus(r.savePath || '已授权');
      } catch (e) { UI.updateFolderStatus('已授权'); }
    } else {
      try {
        const s = await chrome.storage.local.get(['isAuthorized']);
        if (s.isAuthorized) await chrome.storage.local.set({ isAuthorized: false });
      } catch (e) { /* ignore */ }
    }
  }

  function waitForPage() {
    return new Promise((resolve) => {
      const check = () => {
        if (window.ChatGPTSaver.Parser.getConversationContainer()) resolve();
        else setTimeout(check, 500);
      };
      document.readyState === 'complete' ? check() : window.addEventListener('load', check);
    });
  }

  async function loadSettings() {
    try {
      const result = await chrome.storage.local.get(['autoSave', 'exportFormats', 'showLogPanel']);
      if (typeof result.autoSave !== 'undefined') config.autoSave = result.autoSave;
      if (result.exportFormats) config.formats = { ...config.formats, ...result.exportFormats };
      if (typeof result.showLogPanel !== 'undefined') config.showLogPanel = result.showLogPanel;
    } catch (e) { console.error('加载设置失败:', e); }
  }

  function setupMessageListener() {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      handleMessage(request, sender, sendResponse);
      return true;
    });
  }

  async function handleMessage(request, sender, sendResponse) {
    try {
      switch (request.action) {
        case 'requestFolderAccess':
          sendResponse(await window.ChatGPTSaver.FileSystem.requestFolderAccess());
          break;
        case 'exportNow':
          sendResponse(await window.ChatGPTSaver.Exporter.exportConversation(request.formats || config.formats));
          break;
        case 'updateFormats':
          config.formats = request.formats;
          sendResponse({ success: true });
          break;
        case 'getStatus':
          sendResponse({ isInitialized, isWatching: window.ChatGPTSaver.Observer.isActive(), canExport: window.ChatGPTSaver.Exporter.canExport() });
          break;
        case 'getWorkspaceTokenStats':
          try {
            const wsName = window.ChatGPTSaver.Parser.getWorkspaceName();
            const stats = await window.ChatGPTSaver.TokenEstimator.getWorkspaceStats(wsName);
            sendResponse({ workspace: wsName, consumed: stats.consumed || 0 });
          } catch (e) { sendResponse({ workspace: '未知', consumed: 0 }); }
          break;
        default:
          sendResponse({ error: '未知操作' });
      }
    } catch (error) {
      sendResponse({ success: false, error: error.message });
    }
  }

  function showRefreshPrompt() {
    if (refreshPromptShown) return;
    refreshPromptShown = true;
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:99999;';
    overlay.innerHTML = `<div style="background:white;padding:24px;border-radius:12px;max-width:400px;text-align:center;box-shadow:0 20px 40px rgba(0,0,0,0.2);font-family:-apple-system,sans-serif;">
      <div style="font-size:48px;margin-bottom:16px;">⚠️</div>
      <h2 style="margin:0 0 12px;font-size:18px;color:#333;">插件需要刷新</h2>
      <p style="margin:0 0 20px;font-size:14px;color:#666;">请刷新页面以继续自动保存功能。</p>
      <div style="display:flex;gap:12px;justify-content:center;">
        <button onclick="location.reload()" style="background:#10a37f;color:white;border:none;padding:10px 24px;border-radius:6px;font-size:14px;cursor:pointer;">立即刷新</button>
        <button onclick="this.closest('div[style]').parentElement.remove()" style="background:#f3f4f6;color:#333;border:none;padding:10px 24px;border-radius:6px;font-size:14px;cursor:pointer;">稍后再说</button>
      </div></div>`;
    document.body.appendChild(overlay);
  }

  function startAutoSave() {
    window.ChatGPTSaver.Observer.start(async () => {
      if (saveDebounceTimer) clearTimeout(saveDebounceTimer);
      if (window.ChatGPTSaver.FileSystem.isAuthorized()) {
        UI.showLog();
        UI.addLog('⏳ 检测到对话变化，等待稳定后保存...');
      }
      saveDebounceTimer = setTimeout(async () => {
        if (!window.ChatGPTSaver.FileSystem.isAuthorized() || !window.ChatGPTSaver.Exporter.canExport()) {
          UI.clearLog();
          return;
        }
        try {
          const result = await window.ChatGPTSaver.Exporter.exportConversation(config.formats);
          if (result.success) {
            if (result.skipped) {
              UI.showToast('😊 无需更新对话哦', 'success', 3000);
            } else {
              UI.showToast(`✅ 对话已保存 (${result.saved?.join(', ').toUpperCase() || ''})`, 'success', 3000);
              updateSavedCount();
            }
          }
        } catch (error) {
          if (error.message?.includes('Extension context invalidated')) showRefreshPrompt();
        }
      }, config.debounceDelay);
    });
    UI.updateStatus();
  }

  function handleURLChange(newURL) {
    window.ChatGPTSaver.Observer.stop();
    if (saveDebounceTimer) { clearTimeout(saveDebounceTimer); saveDebounceTimer = null; }
    if (window.ChatGPTSaver.FileSystem.isAuthorized()) { UI.clearLog(); UI.showLog(); UI.addLog('🔄 切换对话，等待页面加载...'); }
    setTimeout(async () => {
      await waitForConversationReady();
      if (window.ChatGPTSaver.FileSystem.isAuthorized()) UI.addLog('✅ 页面加载完成');
      if (config.autoSave) startAutoSave();
      UI.updateUsage();
    }, 1500);
  }

  function waitForConversationReady() {
    return new Promise((resolve) => {
      let attempts = 0;
      const check = () => {
        attempts++;
        const c = window.ChatGPTSaver.Parser.getConversationContainer();
        const m = window.ChatGPTSaver.Parser.getMessageElements();
        if ((c && m.length > 0) || attempts >= 20) resolve();
        else setTimeout(check, 500);
      };
      check();
    });
  }

  async function updateSavedCount() {
    try {
      if (!chrome.runtime?.id) return;
      const wsName = window.ChatGPTSaver?.Parser?.getWorkspaceName?.() || '默认';
      const r = await chrome.storage.local.get(['wsSavedCounts']);
      const counts = r.wsSavedCounts || {};
      counts[wsName] = (counts[wsName] || 0) + 1;
      await chrome.storage.local.set({ wsSavedCounts: counts });
      UI.updateUsage();
      // 自动导出上下文
      autoExportContext();
    } catch (e) { /* ignore */ }
  }

  async function autoExportContext() {
    const fs = window.ChatGPTSaver?.FileSystem;
    if (!fs || !fs.isAuthorized()) return;
    try {
      const parser = window.ChatGPTSaver.Parser;
      const conversation = parser.parseConversation();
      if (!conversation.messages.length) return;
      const wsName = parser.getWorkspaceName() || '个人帐户';
      const title = parser.getConversationTitle();
      if (!title) return;
      const sanitize = (n) => n.replace(/[/\\:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim().substring(0, 100);
      const safeWs = sanitize(wsName);
      const safeTitle = sanitize(title);
      const rootHandle = await fs.getBackupRootHandle();
      if (!rootHandle) return;
      const wsFolder = await rootHandle.getDirectoryHandle(safeWs, { create: true });
      const convFolder = await wsFolder.getDirectoryHandle(safeTitle, { create: true });
      const ctxFolder = await convFolder.getDirectoryHandle('context', { create: true });
      // 生成上下文 JSON
      const messages = conversation.messages.map((msg, i) => ({ index: i + 1, role: msg.role, content: msg.textContent || '' }));
      const contextData = {
        version: '2.0', type: 'single', title, url: location.href,
        exportedAt: new Date().toISOString(), messageCount: messages.length,
        workspace: wsName, messages
      };
      const jsonStr = JSON.stringify(contextData, null, 2);
      const filename = `${safeTitle}.json`;
      const fileHandle = await ctxFolder.getFileHandle(filename, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(new Blob([jsonStr], { type: 'application/json' }));
      await writable.close();
      console.log('[ChatGPT Saver] 上下文已自动保存:', filename);
      // 检测并保存附件
      await AttachmentManager.detectAndSaveAttachments(safeWs, safeTitle);
      // 索引到搜索数据库
      try {
        const si = window.ChatGPTSaver?.SearchIndex;
        if (si) {
          const textContent = conversation.messages.map(m => m.textContent || '').join('\n');
          await si.indexConversation({
            id: location.href || title,
            title,
            workspace: wsName,
            url: location.href,
            timestamp: new Date().toISOString(),
            textContent,
            messageCount: conversation.messages.length
          });
          console.log('[ChatGPT Saver] 搜索索引已更新');
        }
      } catch (indexErr) { console.log('[ChatGPT Saver] 搜索索引更新失败:', indexErr.message); }
    } catch (e) { console.log('[ChatGPT Saver] 自动导出上下文失败:', e.message); }
  }

  // 启动
  init();

})();
