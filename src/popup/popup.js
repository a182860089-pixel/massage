// DOM 元素
const setupSection = document.getElementById('setup-section');
const mainSection = document.getElementById('main-section');
const authorizeBtn = document.getElementById('authorize-btn');
const changeFolderBtn = document.getElementById('change-folder-btn');
const exportNowBtn = document.getElementById('export-now-btn');
const statusText = document.getElementById('status-text');
const savePath = document.getElementById('save-path');
const savedCount = document.getElementById('saved-count');
const exportHtml = document.getElementById('export-html');
const exportMd = document.getElementById('export-md');
const exportPdf = document.getElementById('export-pdf');
const exportJson = document.getElementById('export-json');
const toast = document.getElementById('toast');

// 初始化
document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  await updateStatus();
  // 定期检查 storage 状态（以防 content script 更新了状态）
  setTimeout(async () => {
    const result = await chrome.storage.local.get(['isAuthorized']);
    if (!result.isAuthorized) {
      // 权限已过期，显示设置界面
      resetSetupSection();
      showSetupSection();
    }
  }, 500);
});

// 加载设置
async function loadSettings() {
  const result = await chrome.storage.local.get(['isAuthorized', 'savePath', 'savedCount', 'exportFormats']);
  
  if (result.isAuthorized && result.savePath) {
    // 已授权：更新 setupSection 的显示状态
    updateSetupSectionForAuthorized(result.savePath);
    
    // 显示主界面
    showMainSection();
    savePath.textContent = result.savePath;
    savedCount.textContent = result.savedCount || 0;
    
    if (result.exportFormats) {
      exportHtml.checked = result.exportFormats.html !== false;
      exportMd.checked = result.exportFormats.md !== false;
      exportPdf.checked = result.exportFormats.pdf !== false;
      exportJson.checked = result.exportFormats.json !== false;
    }
  } else {
    showSetupSection();
  }
}

// 更新 setupSection 为已授权状态的显示
function updateSetupSectionForAuthorized(folderName) {
  const welcomeCard = document.querySelector('.welcome-card');
  const welcomeIcon = welcomeCard.querySelector('.welcome-icon');
  const welcomeTitle = welcomeCard.querySelector('h2');
  const welcomeDesc = welcomeCard.querySelector('p');
  
  welcomeIcon.textContent = '✅';
  welcomeTitle.textContent = '已设置保存位置';
  welcomeDesc.textContent = `对话将自动保存到「${folderName}」文件夹`;
  
  // 更新按钮显示
  authorizeBtn.innerHTML = `<span class="btn-icon">📂</span> ${folderName}`;
  authorizeBtn.classList.remove('btn-primary');
  authorizeBtn.classList.add('btn-secondary');
}

// 重置 setupSection 为未授权状态
function resetSetupSection() {
  const welcomeCard = document.querySelector('.welcome-card');
  const welcomeIcon = welcomeCard.querySelector('.welcome-icon');
  const welcomeTitle = welcomeCard.querySelector('h2');
  const welcomeDesc = welcomeCard.querySelector('p');
  
  welcomeIcon.textContent = '👋';
  welcomeTitle.textContent = '欢迎使用';
  welcomeDesc.textContent = '首次使用需要选择一个文件夹来保存对话记录。';
  
  authorizeBtn.innerHTML = `<span class="btn-icon">📂</span> 选择保存文件夹`;
  authorizeBtn.classList.remove('btn-secondary');
  authorizeBtn.classList.add('btn-primary');
}

// 更新状态
async function updateStatus() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && (tab.url.includes('chat.openai.com') || tab.url.includes('chatgpt.com'))) {
      statusText.textContent = '监听中';
      statusText.className = 'status-badge status-active';
    } else {
      statusText.textContent = '未在 ChatGPT 页面';
      statusText.className = 'status-badge status-inactive';
    }
  } catch (error) {
    console.error('更新状态失败:', error);
  }
}

// 显示设置界面
function showSetupSection() {
  setupSection.classList.remove('hidden');
  mainSection.classList.add('hidden');
}

// 显示主界面
function showMainSection() {
  setupSection.classList.add('hidden');
  mainSection.classList.remove('hidden');
}

// 显示提示
function showToast(message, type = 'success') {
  toast.textContent = message;
  toast.className = `toast ${type}`;
  toast.classList.remove('hidden');
  
  setTimeout(() => {
    toast.classList.add('hidden');
  }, 3000);
}

// 检查是否在 ChatGPT 页面
async function isOnChatGPTPage() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab && (tab.url.includes('chat.openai.com') || tab.url.includes('chatgpt.com'));
  } catch {
    return false;
  }
}

// 授权文件夹
authorizeBtn.addEventListener('click', async () => {
  try {
    // 检查是否在 ChatGPT 页面
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab || (!tab.url.includes('chat.openai.com') && !tab.url.includes('chatgpt.com'))) {
      showToast('请先打开 ChatGPT 页面', 'error');
      return;
    }
    
    // 尝试发送消息，并处理连接失败的情况
    let response;
    try {
      response = await chrome.tabs.sendMessage(tab.id, { action: 'requestFolderAccess' });
    } catch (sendError) {
      // content script 还没加载完成
      console.log('等待页面加载...', sendError.message);
      showToast('页面正在加载，请稍后重试', 'error');
      return;
    }
    
    if (response && response.success) {
      const folderName = response.folderName || 'ChatGPT-Backup';
      await chrome.storage.local.set({ 
        isAuthorized: true, 
        savePath: folderName
      });
      
      // 更新 setupSection 状态
      updateSetupSectionForAuthorized(folderName);
      
      showMainSection();
      savePath.textContent = folderName;
      showToast('文件夹授权成功！');
    } else if (response?.unsupported) {
      // API 不支持，显示更友好的提示
      showToast('浏览器不支持文件保存，请使用最新版Chrome/Edge', 'error');
    } else {
      showToast(response?.error || '授权失败，请重试', 'error');
    }
  } catch (error) {
    console.log('授权操作异常:', error.message);
    showToast('操作失败，请重试', 'error');
  }
});

// 更换文件夹
changeFolderBtn.addEventListener('click', async () => {
  authorizeBtn.click();
});

// 立即导出
exportNowBtn.addEventListener('click', async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab || (!tab.url.includes('chat.openai.com') && !tab.url.includes('chatgpt.com'))) {
      showToast('请先打开 ChatGPT 页面', 'error');
      return;
    }
    
    const formats = {
      html: exportHtml.checked,
      md: exportMd.checked,
      pdf: exportPdf.checked,
      json: exportJson.checked
    };
    
    const response = await chrome.tabs.sendMessage(tab.id, { 
      action: 'exportNow',
      formats: formats
    });
    
    if (response && response.success) {
      showToast('导出成功！');
      // 更新保存计数
      const result = await chrome.storage.local.get(['savedCount']);
      const newCount = (result.savedCount || 0) + 1;
      await chrome.storage.local.set({ savedCount: newCount });
      savedCount.textContent = newCount;
    } else {
      showToast(response?.error || '导出失败', 'error');
    }
  } catch (error) {
    console.error('导出失败:', error);
    showToast('导出失败，请重试', 'error');
  }
});

// 保存导出格式设置
[exportHtml, exportMd, exportPdf, exportJson].forEach(checkbox => {
  checkbox.addEventListener('change', async () => {
    const formats = {
      html: exportHtml.checked,
      md: exportMd.checked,
      pdf: exportPdf.checked,
      json: exportJson.checked
    };
    await chrome.storage.local.set({ exportFormats: formats });
    
    // 通知 content script 更新设置
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) {
        chrome.tabs.sendMessage(tab.id, { action: 'updateFormats', formats: formats });
      }
    } catch (error) {
      // 忽略错误
    }
  });
});


// Token 预算显示
async function loadTokenBudget() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || (!tab.url.includes('chat.openai.com') && !tab.url.includes('chatgpt.com'))) {
      return;
    }

    let response;
    try {
      response = await chrome.tabs.sendMessage(tab.id, { action: 'getWorkspaceTokenStats' });
    } catch (e) {
      return;
    }

    if (response && response.workspace) {
      const wsEl = document.getElementById('token-workspace');
      const consumedEl = document.getElementById('token-consumed');
      const progressEl = document.getElementById('token-progress');

      wsEl.textContent = response.workspace;
      consumedEl.textContent = response.consumed.toLocaleString();

      // 简单进度条（基于估算上限）
      const maxTokens = 100000; // 默认 100k 上限
      const pct = Math.min(100, (response.consumed / maxTokens) * 100);
      progressEl.style.width = pct + '%';
      progressEl.style.background = pct > 80 ? '#ef4444' : pct > 50 ? '#f59e0b' : '#10a37f';
    }
  } catch (e) {
    // 静默失败
  }
}

// 页面加载后获取 token 数据
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(loadTokenBudget, 600);
});
