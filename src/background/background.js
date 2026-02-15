/**
 * ChatGPT 对话保存助手 - Background Service Worker
 */

// 监听安装事件
chrome.runtime.onInstalled.addListener((details) => {
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

      case 'verifyCardKey':
        await handleVerifyCardKey(request, sendResponse);
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

// 监听标签页更新
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // 当 ChatGPT 页面加载完成时
  if (changeInfo.status === 'complete' && tab.url) {
    if (tab.url.includes('chat.openai.com') || tab.url.includes('chatgpt.com')) {
      console.log('检测到 ChatGPT 页面加载');
    }
  }
});

/**
 * 处理卡密验证（在 background 中发起请求，避免 CORS）
 */
async function handleVerifyCardKey(request, sendResponse) {
  try {
    const resp = await fetch(request.apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ card_key: request.cardKey })
    });
    const json = await resp.json();
    sendResponse(json);
  } catch (e) {
    sendResponse({ success: false, message: '网络错误: ' + e.message, data: { valid: false } });
  }
}

/**
 * 插件卡密接口转发
 */
async function handlePluginCardKeyRequest(path, request, sendResponse) {
  try {
    const baseUrl = 'https://seat.20050225.xyz';
    const resp = await fetch(baseUrl + path, {
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
