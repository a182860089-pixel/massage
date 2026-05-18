/**
 * 批量导出页：作为 chrome 扩展资源（chrome-extension://.../src/popup/batch.html）
 * 打开。所有真正的逻辑（API 拉列表 / 单条详情 / 导出 / 写盘）跑在 ChatGPT 标签页
 * 的 content script 里——这个页面只是 UI + 进度展示。
 *
 * 通信：用 chrome.tabs.sendMessage 发到当前 ChatGPT 标签页。
 */

const $ = (id) => document.getElementById(id);

const els = {
  btnLoadList: $('btn-load-list'),
  btnStart: $('btn-start'),
  btnAbort: $('btn-abort'),
  btnOpenChatgpt: $('open-chatgpt'),
  listStatus: $('list-status'),
  filterInput: $('filter-input'),
  selectAll: $('select-all'),
  selectCount: $('select-count'),
  tbody: $('conv-tbody'),
  runSummary: $('run-summary'),
  progressFill: $('progress-fill'),
  statSuccess: $('stat-success'),
  statSkipped: $('stat-skipped'),
  statFailed: $('stat-failed'),
  statPending: $('stat-pending'),
  logsBody: $('logs-body'),
  fmtHtml: $('fmt-html'),
  fmtMd: $('fmt-md'),
  fmtJson: $('fmt-json'),
  fmtPdf: $('fmt-pdf'),
  concurrencyInput: $('concurrency'),
  retryInput: $('retry')
};

let allConversations = [];   // [{id, title, update_time}]
let selectedIds = new Set();
let activeTabId = null;
let progressPoller = null;

function log(msg, kind = '') {
  const t = new Date().toLocaleTimeString();
  const line = document.createElement('div');
  if (kind) line.className = `log-${kind}`;
  line.textContent = `[${t}] ${msg}`;
  els.logsBody.appendChild(line);
  els.logsBody.scrollTop = els.logsBody.scrollHeight;
}

async function findChatGPTTab() {
  const tabs = await chrome.tabs.query({});
  return tabs.find((t) => /chatgpt\.com|chat\.openai\.com/.test(t.url || '')) || null;
}

async function ensureActiveTab() {
  if (activeTabId) {
    try { await chrome.tabs.get(activeTabId); return activeTabId; }
    catch { activeTabId = null; }
  }
  const tab = await findChatGPTTab();
  if (!tab) {
    log('未找到 ChatGPT 标签页，请先打开 chatgpt.com', 'error');
    return null;
  }
  activeTabId = tab.id;
  return tab.id;
}

async function send(action, payload = {}) {
  const tabId = await ensureActiveTab();
  if (!tabId) return { success: false, error: 'no_tab' };
  try {
    const resp = await chrome.tabs.sendMessage(tabId, { action, ...payload });
    return resp || { success: false, error: 'empty_response' };
  } catch (e) {
    log(`发送 ${action} 失败: ${e?.message || e}`, 'error');
    return { success: false, error: e?.message || String(e) };
  }
}

els.btnOpenChatgpt.addEventListener('click', async (e) => {
  e.preventDefault();
  const tab = await findChatGPTTab();
  if (tab) {
    await chrome.tabs.update(tab.id, { active: true });
  } else {
    await chrome.tabs.create({ url: 'https://chatgpt.com/' });
  }
});

els.btnLoadList.addEventListener('click', async () => {
  els.btnLoadList.disabled = true;
  els.listStatus.textContent = '加载中…';
  log('开始拉取对话列表…');
  const resp = await send('batchListConversations', { maxItems: 2000 });
  els.btnLoadList.disabled = false;
  if (!resp.success) {
    els.listStatus.textContent = '加载失败';
    log(`加载失败：${resp.error || 'unknown'}`, 'error');
    return;
  }
  allConversations = Array.isArray(resp.list) ? resp.list : [];
  els.listStatus.textContent = `共 ${allConversations.length} 个对话`;
  log(`✅ 加载完毕，共 ${allConversations.length} 个对话`, 'ok');
  renderList();
});

els.filterInput.addEventListener('input', () => renderList());
els.selectAll.addEventListener('change', () => {
  if (els.selectAll.checked) {
    visibleConversations().forEach((c) => selectedIds.add(c.id));
  } else {
    visibleConversations().forEach((c) => selectedIds.delete(c.id));
  }
  renderList();
});

function visibleConversations() {
  const q = els.filterInput.value.trim().toLowerCase();
  if (!q) return allConversations;
  return allConversations.filter((c) => (c.title || '').toLowerCase().includes(q));
}

function renderList() {
  const visible = visibleConversations();
  els.tbody.innerHTML = '';
  if (!visible.length) {
    els.tbody.innerHTML = '<tr><td colspan="3" class="empty">没有匹配项</td></tr>';
  } else {
    visible.forEach((c) => {
      const tr = document.createElement('tr');
      const checked = selectedIds.has(c.id);
      if (checked) tr.classList.add('selected');
      tr.innerHTML = `
        <td><input type="checkbox" data-id="${c.id}" ${checked ? 'checked' : ''}></td>
        <td>${escape(c.title || '(无标题)')}</td>
        <td>${formatTime(c.update_time)}</td>
      `;
      tr.querySelector('input').addEventListener('change', (e) => {
        const checked = e.target.checked;
        if (checked) selectedIds.add(c.id);
        else selectedIds.delete(c.id);
        tr.classList.toggle('selected', checked);
        updateSelectCount();
        updateStartBtn();
      });
      els.tbody.appendChild(tr);
    });
  }
  updateSelectCount();
  updateStartBtn();
}

function updateSelectCount() {
  const total = allConversations.length;
  els.selectCount.textContent = `${selectedIds.size} / ${total} 选中`;
}

function updateStartBtn() {
  els.btnStart.disabled = selectedIds.size === 0;
}

function escape(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function formatTime(ts) {
  if (!ts) return '-';
  const seconds = typeof ts === 'number' ? ts : Number(ts);
  if (!Number.isFinite(seconds)) return '-';
  return new Date(seconds * 1000).toLocaleString('zh-CN');
}

els.btnStart.addEventListener('click', async () => {
  const ids = Array.from(selectedIds);
  if (!ids.length) return;
  const conversations = allConversations.filter((c) => selectedIds.has(c.id));
  const formats = {
    html: els.fmtHtml.checked,
    md: els.fmtMd.checked,
    json: els.fmtJson.checked,
    pdf: els.fmtPdf.checked
  };
  const concurrency = parseInt(els.concurrencyInput.value, 10) || 3;
  const retry = parseInt(els.retryInput.value, 10) || 3;

  els.btnStart.disabled = true;
  els.btnAbort.disabled = false;
  log(`🚀 开始批量导出 ${conversations.length} 条对话…`);

  const resp = await send('batchStart', { conversations, formats, concurrency, retry });
  startProgressPolling();

  if (resp.success && resp.summary) {
    finalizeRun(resp.summary);
  } else if (!resp.success) {
    log(`运行失败：${resp.error || 'unknown'}`, 'error');
    els.btnStart.disabled = false;
    els.btnAbort.disabled = true;
    stopProgressPolling();
  }
});

els.btnAbort.addEventListener('click', async () => {
  els.btnAbort.disabled = true;
  log('⏹ 已请求停止…');
  await send('batchAbort', {});
});

function startProgressPolling() {
  if (progressPoller) clearInterval(progressPoller);
  progressPoller = setInterval(async () => {
    const resp = await send('batchGetProgress', {});
    if (!resp.success || !resp.state) return;
    applyProgressState(resp.state);
    if (['done', 'aborted', 'failed'].includes(resp.state.status)) {
      stopProgressPolling();
      finalizeRun(resp.state);
    }
  }, 800);
}

function stopProgressPolling() {
  if (progressPoller) clearInterval(progressPoller);
  progressPoller = null;
}

function applyProgressState(s) {
  const total = (s.pendingIds?.length || 0) + (s.processing?.length || 0) +
    (s.succeededIds?.length || 0) + (s.skippedIds?.length || 0) + (s.failedItems?.length || 0);
  const done = (s.succeededIds?.length || 0) + (s.skippedIds?.length || 0) + (s.failedItems?.length || 0);
  const pct = total ? Math.round((done / total) * 100) : 0;
  els.progressFill.style.width = pct + '%';
  els.statSuccess.textContent = s.succeededIds?.length || 0;
  els.statSkipped.textContent = s.skippedIds?.length || 0;
  els.statFailed.textContent = s.failedItems?.length || 0;
  els.statPending.textContent = s.pendingIds?.length || 0;
  els.runSummary.textContent = `${s.status} · ${done}/${total} 完成`;
}

function finalizeRun(state) {
  els.btnStart.disabled = false;
  els.btnAbort.disabled = true;
  const status = state.status || 'done';
  log(`运行结束（${status}）：成功 ${state.succeededIds?.length || state.succeeded || 0}, 跳过 ${state.skippedIds?.length || state.skipped || 0}, 失败 ${state.failedItems?.length || state.failed || 0}`, status === 'done' ? 'ok' : 'error');
  if (state.failedItems?.length) {
    state.failedItems.slice(0, 8).forEach((it) => {
      log(`  · ${it.id}: ${it.error}`, 'error');
    });
  }
}

// 启动时检查一下是否有未完成的批量任务
(async function init() {
  const resp = await send('batchGetProgress', {});
  if (resp?.success && resp.state && resp.state.status === 'running') {
    log('⚠️ 检测到上次未结束的批量任务，继续展示进度…');
    applyProgressState(resp.state);
    startProgressPolling();
  }
})();
