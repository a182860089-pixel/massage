/**
 * ChatGPT 对话保存助手 - Background Service Worker
 */

import '../utils/clientConfigCache.js';

const CLIENT_CONFIG_URL = 'https://seat.20050225.xyz/api/plugin/card-keys/client-config';
const BASE_API_URL = 'https://seat.20050225.xyz';
const CLIENT_CONFIG_REFRESH_PERIOD_MS = 6 * 60 * 60 * 1000;
const CLIENT_CONFIG_REFRESH_PERIOD_MINUTES = CLIENT_CONFIG_REFRESH_PERIOD_MS / (60 * 1000);
const CLIENT_CONFIG_REFRESH_ALARM = 'chatgptSaverClientConfigAutoRefreshV1';

const clientConfigCacheApi = globalThis.ChatGPTSaver?.ClientConfigCache;
const clientConfigCache = clientConfigCacheApi?.createClientConfigCache
  ? clientConfigCacheApi.createClientConfigCache({
      ttlMs: CLIENT_CONFIG_REFRESH_PERIOD_MS,
      cacheKey: 'pluginClientConfigCacheV1',
      storageGet: async (cacheKey) => chrome.storage.local.get([cacheKey]),
      storageSet: async (value) => chrome.storage.local.set(value)
    })
  : null;

function ensureClientConfigAutoRefreshAlarm() {
  if (!chrome.alarms?.create) return;
  try {
    chrome.alarms.create(CLIENT_CONFIG_REFRESH_ALARM, {
      periodInMinutes: CLIENT_CONFIG_REFRESH_PERIOD_MINUTES
    });
  } catch (error) {
    console.warn('创建客户端配置自动刷新定时器失败:', error?.message || error);
  }
}

async function refreshClientConfigInBackground(reason = 'manual') {
  try {
    if (clientConfigCache) {
      const result = await clientConfigCache.fetchWithCache(fetchClientConfigFromApi, { forceRefresh: true });
      if (!result?.success) {
        console.warn(`[ClientConfig] 后台刷新失败(${reason}):`, result?.error || 'unknown error');
        return;
      }
      console.log(`[ClientConfig] 后台刷新完成(${reason}) source=${result.source || 'network'} stale=${result.stale === true}`);
      return;
    }
    await fetchClientConfigFromApi();
    console.log(`[ClientConfig] 后台刷新完成(${reason}) source=network(no-cache)`);
  } catch (error) {
    console.warn(`[ClientConfig] 后台刷新异常(${reason}):`, error?.message || error);
  }
}

// 监听安装事件
chrome.runtime.onInstalled.addListener((details) => {
  ensureClientConfigAutoRefreshAlarm();
  void refreshClientConfigInBackground(`onInstalled:${details.reason || 'unknown'}`);
  void ensureContextMenus();

  if (details.reason === 'install') {
    console.log('ChatGPT 对话保存助手已安装');
    
    // 初始化默认设置
    chrome.storage.local.set({
      folderAuthState: 'missing',
      folderDisplayName: '',
      folderChosenAt: '',
      folderLastVerifiedAt: '',
      folderLastFailureReason: '',
      folderVersion: 2,
      guideBannerDismissed: false,
      guideLastViewedAt: '',
      guideVersion: 1,
      isAuthorized: false,
      savePath: '',
      savedCount: 0,
      exportFormats: { html: true, md: true, pdf: true, json: true },
      autoSave: true
    });
  } else if (details.reason === 'update') {
    console.log('ChatGPT 对话保存助手已更新');
  }
});

// 右键菜单注册
const CONTEXT_MENU_DOCUMENT_URL_PATTERNS = [
  'https://chat.openai.com/*',
  'https://chatgpt.com/*'
];

async function ensureContextMenus() {
  if (!chrome.contextMenus?.removeAll) return;
  try {
    await new Promise((resolve) => chrome.contextMenus.removeAll(resolve));
    chrome.contextMenus.create({
      id: 'saver_save_now',
      title: '💾 立即保存当前对话',
      contexts: ['page', 'selection'],
      documentUrlPatterns: CONTEXT_MENU_DOCUMENT_URL_PATTERNS
    });
    chrome.contextMenus.create({
      id: 'saver_copy_markdown',
      title: '📋 复制当前对话为 Markdown',
      contexts: ['page', 'selection'],
      documentUrlPatterns: CONTEXT_MENU_DOCUMENT_URL_PATTERNS
    });
    chrome.contextMenus.create({
      id: 'saver_copy_richtext',
      title: '📄 复制当前对话为富文本（HTML）',
      contexts: ['page', 'selection'],
      documentUrlPatterns: CONTEXT_MENU_DOCUMENT_URL_PATTERNS
    });
    chrome.contextMenus.create({
      id: 'saver_open_panel',
      title: '🗂 打开保存助手侧边栏',
      contexts: ['page'],
      documentUrlPatterns: CONTEXT_MENU_DOCUMENT_URL_PATTERNS
    });
  } catch (error) {
    console.warn('注册右键菜单失败:', error?.message || error);
  }
}

// 右键菜单 → 转发到 content
chrome.contextMenus?.onClicked?.addListener(async (info, tab) => {
  if (!tab?.id || !isChatGPTUrl(tab.url)) return;
  const map = {
    saver_save_now: { commandId: 'export.current', args: { source: 'context_menu' } },
    saver_copy_markdown: { commandId: 'copy.markdown', args: { source: 'context_menu' } },
    saver_copy_richtext: { commandId: 'copy.richtext', args: { source: 'context_menu' } },
    saver_open_panel: { action: 'togglePanel' }
  };
  const entry = map[info.menuItemId];
  if (!entry) return;
  try {
    if (entry.action) {
      await chrome.tabs.sendMessage(tab.id, { action: entry.action });
    } else {
      await chrome.tabs.sendMessage(tab.id, {
        action: 'runCommand',
        commandId: entry.commandId,
        args: entry.args || {}
      });
    }
  } catch (error) {
    console.warn('转发右键菜单失败:', error?.message || error);
  }
});

// 键盘快捷键 → 转发到 content
chrome.commands?.onCommand?.addListener(async (commandName) => {
  const map = {
    'save-now': 'export.current',
    'copy-markdown': 'copy.markdown',
    'open-saver-panel': '__open_panel__'
  };
  const target = map[commandName];
  if (!target) return;
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!activeTab?.id || !isChatGPTUrl(activeTab.url)) return;
    if (target === '__open_panel__') {
      await chrome.tabs.sendMessage(activeTab.id, { action: 'togglePanel' });
    } else {
      await chrome.tabs.sendMessage(activeTab.id, {
        action: 'runCommand',
        commandId: target,
        args: { source: 'shortcut' }
      });
    }
  } catch (error) {
    console.warn('转发快捷键失败:', error?.message || error);
  }
});

chrome.runtime.onStartup.addListener(() => {
  ensureClientConfigAutoRefreshAlarm();
  void refreshClientConfigInBackground('onStartup');
  void ensureContextMenus();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (!alarm || alarm.name !== CLIENT_CONFIG_REFRESH_ALARM) return;
  void refreshClientConfigInBackground('alarm');
});

ensureClientConfigAutoRefreshAlarm();

function isChatGPTUrl(url) {
  return typeof url === 'string' && (
    url.includes('chat.openai.com') ||
    url.includes('chatgpt.com')
  );
}

// 点击扩展图标：切换侧边栏显示/隐藏
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.id || !isChatGPTUrl(tab.url)) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { action: 'togglePanel' });
  } catch (error) {
    console.warn('切换侧边栏失败，可能页面尚未完成初始化:', error?.message || error);
  }
});

// 监听消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  handleMessage(request, sender, sendResponse);
  return true; // 保持消息通道开放用于异步响应
});

/**
 * 处理消息
 */
async function handleMessage(request, sender, sendResponse) {
  try {
    switch (request.action) {
      case 'download':
        // 处理文件下载请求
        await handleDownload(request, sendResponse);
        break;
        
      case 'getSettings':
        const settings = await chrome.storage.local.get([
          'folderAuthState',
          'folderDisplayName',
          'folderChosenAt',
          'folderLastVerifiedAt',
          'folderLastFailureReason',
          'folderVersion',
          'isAuthorized', 
          'savePath', 
          'savedCount', 
          'exportFormats',
          'autoSave'
        ]);
        sendResponse(settings);
        break;
        
      case 'updateSettings':
        await chrome.storage.local.set(request.settings);
        sendResponse({ success: true });
        break;
        
      case 'incrementSavedCount':
        const result = await chrome.storage.local.get(['savedCount']);
        const newCount = (result.savedCount || 0) + 1;
        await chrome.storage.local.set({ savedCount: newCount });
        sendResponse({ success: true, count: newCount });
        break;

      case 'openGuidePage':
        await chrome.tabs.create({ url: chrome.runtime.getURL('src/help/guide.html') });
        sendResponse({ success: true });
        break;

      case 'pluginActivateCardKey':
        await handlePluginCardKeyRequest('/api/plugin/card-keys/activate', request, sendResponse);
        break;

      case 'pluginCheckCardKeyStatus':
        await handlePluginCardKeyRequest('/api/plugin/card-keys/status', request, sendResponse);
        break;

      case 'pluginRebindCardKey':
        await handlePluginCardKeyRequest('/api/plugin/card-keys/rebind', request, sendResponse);
        break;

      case 'pluginGetClientConfig':
        await handlePluginGetClientConfig(request, sendResponse);
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
 * 处理文件下载
 */
async function handleDownload(request, sendResponse) {
  try {
    const downloadId = await chrome.downloads.download({
      url: request.url,
      filename: request.filename,
      saveAs: false
    });
    
    sendResponse({ success: true, downloadId: downloadId });
  } catch (error) {
    console.error('下载失败:', error);
    sendResponse({ success: false, error: error.message });
  }
}

/**
 * 插件卡密接口转发
 *
 * 关键约定：网络错误（fetch 抛出、HTTP 非 2xx）只标 network_error: true，
 * 不告诉前端 authorized:false。前端 CardKeyManager 看到 network_error
 * 一律跳过 clearOnInvalid，保留本地卡密缓存，避免抖动时把用户踢回免费版。
 */
async function handlePluginCardKeyRequest(path, request, sendResponse) {
  try {
    const resp = await fetch(BASE_API_URL + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        card_key: request.card_key,
        email: request.email,
        client_id: request.client_id
      })
    });
    if (!resp.ok) {
      sendResponse({
        success: false,
        network_error: true,
        message: `网络错误: HTTP ${resp.status}`,
        data: { authorized: false }
      });
      return;
    }
    let json;
    try {
      json = await resp.json();
    } catch (parseError) {
      sendResponse({
        success: false,
        network_error: true,
        message: '网络错误: 响应不是合法 JSON',
        data: { authorized: false }
      });
      return;
    }
    sendResponse(json);
  } catch (e) {
    sendResponse({
      success: false,
      network_error: true,
      message: '网络错误: ' + e.message,
      data: { authorized: false }
    });
  }
}

async function fetchClientConfigFromApi() {
  const resp = await fetch(CLIENT_CONFIG_URL, {
    method: 'GET',
    cache: 'no-store',
    headers: {
      Accept: 'application/json'
    }
  });
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}`);
  }

  const json = await resp.json();
  if (json?.success === false) {
    throw new Error(json?.message || '获取配置失败');
  }
  return json?.data || json || {};
}

async function handlePluginGetClientConfig(request, sendResponse) {
  try {
    if (!clientConfigCache) {
      const payload = await fetchClientConfigFromApi();
      sendResponse({
        success: true,
        data: payload,
        stale: false,
        source: 'network',
        fetchedAt: Date.now()
      });
      return;
    }

    const result = await clientConfigCache.fetchWithCache(fetchClientConfigFromApi, {
      forceRefresh: request?.forceRefresh === true
    });

    if (result.success) {
      sendResponse({
        success: true,
        data: result.data || {},
        stale: result.stale === true,
        source: result.source || 'cache',
        fetchedAt: result.fetchedAt || null,
        error: result.error || null
      });
      return;
    }

    sendResponse({
      success: false,
      data: null,
      stale: false,
      source: result.source || 'empty',
      message: result.error || '获取配置失败'
    });
  } catch (error) {
    sendResponse({
      success: false,
      data: null,
      stale: false,
      source: 'empty',
      message: error?.message || '获取配置失败'
    });
  }
}
