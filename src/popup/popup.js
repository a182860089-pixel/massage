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

// popup 当前操作模式：'pick'=首次选择文件夹；'restore'=尝试恢复已有文件夹的权限
let authorizeMode = 'pick';

function setAuthorizeButton(label, iconChar, authorized) {
  authorizeBtn.textContent = '';
  const icon = document.createElement('span');
  icon.className = 'btn-icon';
  icon.textContent = iconChar;
  const text = document.createTextNode(` ${label}`);
  authorizeBtn.appendChild(icon);
  authorizeBtn.appendChild(text);
  authorizeBtn.classList.toggle('btn-primary', !authorized);
  authorizeBtn.classList.toggle('btn-secondary', authorized);
}

function normalizeFolderState(data = {}) {
  const folderAuthState = String(data.folderAuthState || (data.isAuthorized ? 'granted' : 'missing'));
  const folderDisplayName = String(data.folderDisplayName || data.savePath || '');
  const folderLastFailureReason = String(data.folderLastFailureReason || '');
  return { folderAuthState, folderDisplayName, folderLastFailureReason };
}

function showSetupSection(message = '首次使用需要选择一个文件夹来保存对话记录。', { mode = 'pick', folderName = '' } = {}) {
  authorizeMode = mode;
  const welcomeCard = document.querySelector('.welcome-card');
  if (mode === 'restore' && folderName) {
    welcomeCard.querySelector('.welcome-icon').textContent = '🔓';
    welcomeCard.querySelector('h2').textContent = '需要重新授权';
    welcomeCard.querySelector('p').textContent = message;
    setAuthorizeButton(`恢复访问「${folderName}」`, '🔓', false);
  } else {
    welcomeCard.querySelector('.welcome-icon').textContent = '👋';
    welcomeCard.querySelector('h2').textContent = '欢迎使用';
    welcomeCard.querySelector('p').textContent = message;
    setAuthorizeButton('选择保存文件夹', '📂', false);
  }
  setupSection.classList.remove('hidden');
  mainSection.classList.add('hidden');
}

function showMainSection(folderName) {
  authorizeMode = 'pick';
  const welcomeCard = document.querySelector('.welcome-card');
  welcomeCard.querySelector('.welcome-icon').textContent = '✅';
  welcomeCard.querySelector('h2').textContent = '已设置保存位置';
  welcomeCard.querySelector('p').textContent = `对话将自动保存到「${folderName}」文件夹`;
  setAuthorizeButton(folderName, '📂', true);
  savePath.textContent = folderName;
  setupSection.classList.add('hidden');
  mainSection.classList.remove('hidden');
}

function showToast(message, type = 'success') {
  toast.textContent = message;
  toast.className = `toast ${type}`;
  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), 3000);
}

async function getActiveChatGPTTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || (!String(tab.url || '').includes('chat.openai.com') && !String(tab.url || '').includes('chatgpt.com'))) {
    return null;
  }
  return tab;
}

async function loadSettings() {
  const result = await chrome.storage.local.get([
    'folderAuthState',
    'folderDisplayName',
    'folderLastFailureReason',
    'isAuthorized',
    'savePath',
    'savedCount',
    'exportFormats'
  ]);
  const folder = normalizeFolderState(result);
  if (folder.folderAuthState === 'granted' && folder.folderDisplayName) {
    showMainSection(folder.folderDisplayName);
    savedCount.textContent = result.savedCount || 0;
  } else if (folder.folderDisplayName && folder.folderLastFailureReason === 'permission_required') {
    // 浏览器重启后权限被降级，handle 还在 IndexedDB 里，引导走 requestPermission 而非重新选
    showSetupSection(
      `浏览器重启后需要重新确认对「${folder.folderDisplayName}」的访问权限。点击下方按钮恢复访问，无需重新选择文件夹。`,
      { mode: 'restore', folderName: folder.folderDisplayName }
    );
  } else {
    showSetupSection(folder.folderAuthState === 'stale'
      ? '保存文件夹已失效，请重新选择后再继续自动保存、手动导出和上下文延续。'
      : '首次使用需要选择一个文件夹来保存对话记录。');
  }

  if (result.exportFormats) {
    exportHtml.checked = result.exportFormats.html !== false;
    exportMd.checked = result.exportFormats.md !== false;
    exportPdf.checked = result.exportFormats.pdf !== false;
    exportJson.checked = result.exportFormats.json !== false;
  }
}

async function updateStatus() {
  try {
    const tab = await getActiveChatGPTTab();
    if (tab) {
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

async function requestFolderAccess() {
  const tab = await getActiveChatGPTTab();
  if (!tab) {
    showToast('请先打开 ChatGPT 页面', 'error');
    return null;
  }
  try {
    return await chrome.tabs.sendMessage(tab.id, { action: 'requestFolderAccess' });
  } catch {
    showToast('页面正在加载，请稍后重试', 'error');
    return null;
  }
}

async function restoreFolderPermission() {
  const tab = await getActiveChatGPTTab();
  if (!tab) {
    showToast('请先打开 ChatGPT 页面', 'error');
    return null;
  }
  try {
    return await chrome.tabs.sendMessage(tab.id, { action: 'restoreFolderPermission' });
  } catch {
    showToast('页面正在加载，请稍后重试', 'error');
    return null;
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  await updateStatus();
  setTimeout(loadTokenBudget, 600);
});

authorizeBtn.addEventListener('click', async () => {
  // restore 模式优先调 restorePermission（不弹文件夹选择器，只弹小确认框）
  // 若 restore 失败再回退到 requestFolderAccess
  let response = null;
  if (authorizeMode === 'restore') {
    response = await restoreFolderPermission();
    if (response && !response.success && !response.notFound && !response.unsupported) {
      // 恢复失败但 handle 还在（如用户点了拒绝），不主动弹文件夹选择器，提示用户即可
      showToast(response.error || '恢复访问失败，请重试', 'error');
      return;
    }
    if (response?.notFound) {
      // IndexedDB 里没有可恢复的 handle，回退到正常选择流程
      response = await requestFolderAccess();
    }
  } else {
    response = await requestFolderAccess();
  }

  if (response?.success) {
    const folderName = response.folderState?.folderDisplayName || response.folderName || 'ChatGPT-Backup';
    showMainSection(folderName);
    showToast(authorizeMode === 'restore' ? '已恢复对原文件夹的访问！' : '文件夹授权成功！');
  } else if (response?.unsupported) {
    showToast('浏览器不支持文件保存，请使用最新版Chrome/Edge', 'error');
  } else if (response) {
    showToast(response.error || '授权失败，请重试', 'error');
  }
});

changeFolderBtn.addEventListener('click', async () => {
  // 主动更换文件夹：始终走 picker，不要走 restore
  const response = await requestFolderAccess();
  if (response?.success) {
    const folderName = response.folderState?.folderDisplayName || response.folderName || 'ChatGPT-Backup';
    showMainSection(folderName);
    showToast('已更换保存文件夹');
  } else if (response?.unsupported) {
    showToast('浏览器不支持文件保存，请使用最新版Chrome/Edge', 'error');
  } else if (response) {
    showToast(response.error || '更换失败，请重试', 'error');
  }
});

exportNowBtn.addEventListener('click', async () => {
  const tab = await getActiveChatGPTTab();
  if (!tab) {
    showToast('请先打开 ChatGPT 页面', 'error');
    return;
  }

  const formats = {
    html: exportHtml.checked,
    md: exportMd.checked,
    pdf: exportPdf.checked,
    json: exportJson.checked
  };

  try {
    const response = await chrome.tabs.sendMessage(tab.id, { action: 'exportNow', formats });
    if (response?.success) {
      showToast(response.skipped ? '没有新内容，无需导出' : '导出成功！');
      if (!response.skipped && Array.isArray(response.saved) && response.saved.length > 0) {
        const result = await chrome.storage.local.get(['savedCount']);
        const next = (result.savedCount || 0) + 1;
        await chrome.storage.local.set({ savedCount: next });
        savedCount.textContent = next;
      }
    } else {
      showToast(response?.error || '导出失败', 'error');
      if (response?.folderState?.folderAuthState && response.folderState.folderAuthState !== 'granted') {
        await loadSettings();
      }
    }
  } catch (error) {
    console.error('导出失败:', error);
    showToast('导出失败，请重试', 'error');
  }
});

[exportHtml, exportMd, exportPdf, exportJson].forEach((checkbox) => {
  checkbox.addEventListener('change', async () => {
    const formats = {
      html: exportHtml.checked,
      md: exportMd.checked,
      pdf: exportPdf.checked,
      json: exportJson.checked
    };
    await chrome.storage.local.set({ exportFormats: formats });
    try {
      const tab = await getActiveChatGPTTab();
      if (tab) await chrome.tabs.sendMessage(tab.id, { action: 'updateFormats', formats });
    } catch {
      // ignore
    }
  });
});

async function loadTokenBudget() {
  try {
    const tab = await getActiveChatGPTTab();
    if (!tab) return;
    const response = await chrome.tabs.sendMessage(tab.id, { action: 'getWorkspaceTokenStats' });
    if (!response?.workspace) return;
    document.getElementById('token-workspace').textContent = response.workspace;
    document.getElementById('token-consumed').textContent = response.consumed.toLocaleString();
    const progressEl = document.getElementById('token-progress');
    const pct = Math.min(100, (response.consumed / 100000) * 100);
    progressEl.style.width = `${pct}%`;
    progressEl.style.background = pct > 80 ? '#ef4444' : (pct > 50 ? '#f59e0b' : '#10a37f');
  } catch {
    // ignore
  }
}
