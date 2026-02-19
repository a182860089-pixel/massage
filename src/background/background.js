/**
 * ChatGPT 对话保存助手 - Background Service Worker
 */

import '../utils/clientConfigCache.js';

const CLIENT_CONFIG_URL = 'https://seat.20050225.xyz/api/plugin/card-keys/client-config';
const BASE_API_URL = 'https://seat.20050225.xyz';
const DEBUGGER_PROTOCOL_VERSION = '1.3';
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

  if (details.reason === 'install') {
    console.log('ChatGPT 对话保存助手已安装');
    
    // 初始化默认设置
    chrome.storage.local.set({
      isAuthorized: false,
      savePath: '',
      savedCount: 0,
      exportFormats: { html: true, md: true, pdf: true },
      autoSave: true
    });
  } else if (details.reason === 'update') {
    console.log('ChatGPT 对话保存助手已更新');
  }
});

chrome.runtime.onStartup.addListener(() => {
  ensureClientConfigAutoRefreshAlarm();
  void refreshClientConfigInBackground('onStartup');
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

      case 'printToPdfFromHtml':
        await handlePrintToPdfFromHtml(request, sender, sendResponse);
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
    const json = await resp.json();
    sendResponse(json);
  } catch (e) {
    sendResponse({
      success: false,
      message: '网络错误: ' + e.message,
      data: { authorized: false }
    });
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

async function waitForTabComplete(tabId, timeoutMs = 8000) {
  const current = await chrome.tabs.get(tabId);
  if (current?.status === 'complete') return;

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('等待临时标签页加载超时'));
    }, timeoutMs);

    const onUpdated = (updatedTabId, changeInfo) => {
      if (updatedTabId !== tabId) return;
      if (changeInfo.status === 'complete') {
        cleanup();
        resolve();
      }
    };

    function cleanup() {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
    }

    chrome.tabs.onUpdated.addListener(onUpdated);
  });
}

async function waitForPrintReady(debuggee, timeoutMs = 8000) {
  const startedAt = Date.now();
  while ((Date.now() - startedAt) < timeoutMs) {
    try {
      const stateResult = await chrome.debugger.sendCommand(debuggee, 'Runtime.evaluate', {
        expression: '(() => { const imgs = Array.from(document.images || []); const imgReady = imgs.every(img => img.complete); const fontsReady = !document.fonts || document.fonts.status === "loaded"; return { readyState: document.readyState, imgReady, fontsReady }; })()',
        returnByValue: true
      });

      const payload = stateResult?.result?.value || {};
      if (payload.readyState === 'complete' && payload.imgReady && payload.fontsReady) {
        return;
      }
    } catch (e) {
      // ignore and retry
    }
    await delay(120);
  }
}

function normalizePrintOptions(input) {
  const opts = input && typeof input === 'object' ? input : {};
  const toNumber = (value, fallback) => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };

  return {
    printBackground: opts.printBackground !== false,
    preferCSSPageSize: opts.preferCSSPageSize !== false,
    landscape: opts.landscape === true,
    scale: Math.max(0.1, Math.min(2, toNumber(opts.scale, 1))),
    paperWidth: toNumber(opts.paperWidth, 8.27),
    paperHeight: toNumber(opts.paperHeight, 11.69),
    marginTop: Math.max(0, toNumber(opts.marginTop, 0.4)),
    marginBottom: Math.max(0, toNumber(opts.marginBottom, 0.4)),
    marginLeft: Math.max(0, toNumber(opts.marginLeft, 0.35)),
    marginRight: Math.max(0, toNumber(opts.marginRight, 0.35))
  };
}

async function handlePrintToPdfFromHtml(request, sender, sendResponse) {
  const html = String(request?.html || '');
  if (!html.trim()) {
    sendResponse({ success: false, error: 'HTML 内容为空' });
    return;
  }
  if (html.length > 12_000_000) {
    sendResponse({ success: false, error: 'HTML 内容过大，请缩短对话后重试' });
    return;
  }

  let tabId = null;
  let attached = false;
  const debuggee = { tabId: -1 };

  try {
    const createdTab = await chrome.tabs.create({
      url: 'about:blank',
      active: false
    });

    tabId = createdTab?.id;
    if (!tabId) throw new Error('创建临时打印标签页失败');
    debuggee.tabId = tabId;

    await waitForTabComplete(tabId, 8000);
    await chrome.debugger.attach(debuggee, DEBUGGER_PROTOCOL_VERSION);
    attached = true;

    await chrome.debugger.sendCommand(debuggee, 'Page.enable');
    await chrome.debugger.sendCommand(debuggee, 'Runtime.enable');

    const frameTree = await chrome.debugger.sendCommand(debuggee, 'Page.getFrameTree');
    const frameId = frameTree?.frameTree?.frame?.id;
    if (!frameId) throw new Error('获取打印页面 frame 失败');

    await chrome.debugger.sendCommand(debuggee, 'Page.setDocumentContent', {
      frameId,
      html
    });
    await delay(120);
    await waitForPrintReady(debuggee, 8000);
    await chrome.debugger.sendCommand(debuggee, 'Emulation.setEmulatedMedia', {
      media: 'print'
    });

    const pdfResult = await chrome.debugger.sendCommand(
      debuggee,
      'Page.printToPDF',
      normalizePrintOptions(request?.options)
    );

    if (!pdfResult?.data) {
      throw new Error('printToPDF 未返回数据');
    }

    sendResponse({
      success: true,
      data: pdfResult.data,
      mimeType: 'application/pdf'
    });
  } catch (error) {
    console.error('HTML 原样 PDF 导出失败:', error);
    sendResponse({
      success: false,
      error: error?.message || 'HTML 原样 PDF 导出失败'
    });
  } finally {
    if (attached) {
      try {
        await chrome.debugger.detach(debuggee);
      } catch (e) {
        // ignore detach failures
      }
    }
    if (tabId) {
      try {
        await chrome.tabs.remove(tabId);
      } catch (e) {
        // ignore remove failures
      }
    }
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
