/**
 * BatchExporter：批量导出对话的并发引擎。
 *
 * 跑在 content script context（需要访问 ChatGPTApiSource + FileSystem + Exporter）。
 *
 * 特性：
 *  - 并发限流（默认 3）
 *  - 进度持久化到 chrome.storage.local（中断重启可恢复）
 *  - 可取消（AbortController）
 *  - 失败重试（指数退避，默认 3 次）
 *  - 跳过已存在且未变化的对话（基于 FileSystem.checkConversationNeedsUpdate）
 *  - onProgress 回调实时上报进度
 *
 * 状态机：
 *  idle → running → (paused | done | aborted | failed)
 *
 * Storage key: `batchExportStateV1`
 */

const BATCH_STORAGE_KEY = 'batchExportStateV1';

const BatchExporter = {
  _state: null,
  _abortController: null,
  _running: false,
  _onProgressCallbacks: new Set(),

  /**
   * 启动一个新的批量导出任务。
   * @param {Object} options
   * @param {'chatgpt'} options.platform                ChatGPT 或 future Gemini
   * @param {Array<{id, title}>} [options.conversations] 显式指定要导出的对话列表（若提供，跳过列举步骤）
   * @param {{html,md,pdf,json}} [options.formats]      要保存的格式
   * @param {number} [options.concurrency=3]            并发量
   * @param {number} [options.maxItems=Infinity]        最多导出几条
   * @param {number} [options.retry=3]                  单条失败重试次数
   * @param {'auto'|'visual'|'structured'} [options.pdfMode]
   * @returns {Promise<Object>} 最终汇总
   */
  async start(options = {}) {
    if (this._running) {
      return { success: false, error: 'already_running' };
    }
    this._abortController = new AbortController();
    this._running = true;

    const settings = {
      platform: options.platform || 'chatgpt',
      formats: options.formats || { html: true, md: true, pdf: false, json: true },
      concurrency: Math.max(1, Math.min(8, options.concurrency || 3)),
      maxItems: options.maxItems || Infinity,
      retry: Math.max(0, options.retry ?? 3),
      pdfMode: options.pdfMode || 'auto'
    };

    const state = {
      runId: 'br_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
      status: 'running',
      startedAt: new Date().toISOString(),
      finishedAt: null,
      settings,
      // 待办与结果
      pendingIds: [], // 没动过的 id
      processing: [], // 正在处理的 id
      succeededIds: [],
      skippedIds: [],
      failedItems: [] // [{id, error}]
    };
    this._state = state;
    await this._saveState();
    this._emitProgress();

    try {
      // 1) 列出全部对话（或用 caller 给的列表）
      const list = await this._collectList(options);
      if (this._aborted()) {
        return await this._finish('aborted');
      }
      state.pendingIds = list.map((it) => it.id).filter(Boolean);
      state.titleById = list.reduce((acc, it) => { if (it.id) acc[it.id] = it.title || ''; return acc; }, {});
      await this._saveState();
      this._emitProgress();

      // 2) 并发循环
      await this._runConcurrent(state, settings);
      if (this._aborted()) {
        return await this._finish('aborted');
      }
      return await this._finish('done');
    } catch (err) {
      state.lastError = err?.message || String(err);
      return await this._finish('failed');
    }
  },

  /**
   * 收集要导出的对话列表。
   *  - 若 options.conversations 提供，直接用
   *  - 否则调用 ChatGPTApiSource.listAll 拉全量
   */
  async _collectList(options) {
    if (Array.isArray(options.conversations) && options.conversations.length) {
      return options.conversations;
    }
    const api = window.ChatGPTSaver?.ChatGPTApiSource;
    if (!api) throw new Error('ChatGPTApiSource_unavailable');
    const out = [];
    const max = options.maxItems || Infinity;
    for await (const it of api.listAll({
      pageSize: 100,
      order: 'updated',
      maxItems: max,
      abortSignal: this._abortController.signal
    })) {
      out.push(it);
      if (out.length >= max) break;
    }
    return out;
  },

  async _runConcurrent(state, settings) {
    const workerCount = settings.concurrency;
    const workers = [];
    for (let i = 0; i < workerCount; i++) {
      workers.push(this._worker(state, settings, i));
    }
    await Promise.all(workers);
  },

  async _worker(state, settings, workerId) {
    while (!this._aborted() && state.pendingIds.length) {
      const id = state.pendingIds.shift();
      if (!id) break;
      state.processing.push(id);
      await this._saveState();
      this._emitProgress();
      const result = await this._processOne(id, settings);
      const idx = state.processing.indexOf(id);
      if (idx >= 0) state.processing.splice(idx, 1);
      if (result.success) {
        if (result.skipped) state.skippedIds.push(id);
        else state.succeededIds.push(id);
      } else {
        state.failedItems.push({ id, error: result.error });
      }
      await this._saveState();
      this._emitProgress();
    }
  },

  async _processOne(id, settings) {
    const api = window.ChatGPTSaver?.ChatGPTApiSource;
    const fileSystem = window.ChatGPTSaver?.FileSystem;
    const HTMLExporter = window.ChatGPTSaver?.HTMLExporter;
    const MarkdownExporter = window.ChatGPTSaver?.MarkdownExporter;
    const JSONExporter = window.ChatGPTSaver?.JSONExporter;
    const PDFExporter = window.ChatGPTSaver?.PDFExporter;
    const Model = window.ChatGPTSaver?.ConversationModel;
    if (!api || !fileSystem || !Model) {
      return { success: false, error: 'deps_unavailable' };
    }

    let lastErr = null;
    for (let attempt = 0; attempt <= settings.retry; attempt++) {
      try {
        if (this._aborted()) return { success: false, error: 'aborted' };
        const model = await api.fetchConversationAsModel(id, { abortSignal: this._abortController?.signal });
        if (!model || !model.messages?.length) {
          return { success: false, error: 'empty_conversation' };
        }
        const legacy = Model.modelToLegacyConversation(model);

        // 跳过：基于摘要 + 资产摘要的简单 hash 比对（沿用 single export 路径的去重逻辑）
        const updateMeta = {
          messageCount: legacy.messages.length,
          lastMessageDigest: fileSystem?.simpleHash
            ? fileSystem.simpleHash(JSON.stringify(legacy.messages.slice(-1)))
            : '',
          assetsDigest: ''
        };
        const needsCheck = await fileSystem.checkConversationNeedsUpdate?.(
          legacy.title, model.workspaceName || '', updateMeta
        );
        if (needsCheck && needsCheck.needsUpdate === false) {
          return { success: true, skipped: true, reason: 'unchanged' };
        }

        // 生成各格式
        let htmlContent = null;
        let mdContent = null;
        let jsonContent = null;
        let pdfResult = null;
        if (settings.formats.html && HTMLExporter?.exportConversation) {
          htmlContent = HTMLExporter.exportConversation(legacy);
        }
        if (settings.formats.md && MarkdownExporter?.exportConversation) {
          mdContent = MarkdownExporter.exportConversation(legacy);
        }
        if (settings.formats.json && JSONExporter?.exportFromConversation) {
          const obj = JSONExporter.exportFromConversation(legacy);
          if (obj) jsonContent = JSONExporter.serialize ? JSONExporter.serialize(obj) : JSON.stringify(obj, null, 2);
        }
        if (settings.formats.pdf && PDFExporter?.exportPackage) {
          pdfResult = await PDFExporter.exportPackage({
            mode: settings.pdfMode || 'auto',
            conversation: legacy,
            workspaceName: model.workspaceName || ''
          });
        }

        await fileSystem.saveConversation(
          legacy.title,
          htmlContent,
          mdContent,
          pdfResult?.success ? (pdfResult.split ? { parts: pdfResult.parts } : pdfResult.blob) : null,
          settings.formats,
          model.workspaceName || '',
          jsonContent
        );
        return { success: true };
      } catch (e) {
        lastErr = e?.message || String(e);
        // 指数退避
        const backoff = Math.min(8000, 500 * Math.pow(2, attempt));
        await new Promise((r) => setTimeout(r, backoff));
      }
    }
    return { success: false, error: lastErr || 'unknown' };
  },

  async _saveState() {
    if (!this._state || typeof chrome === 'undefined' || !chrome.storage?.local) return;
    try {
      const snapshot = { ...this._state };
      // 限制写入大小：pendingIds 量过大时不重复落库
      await chrome.storage.local.set({ [BATCH_STORAGE_KEY]: snapshot });
    } catch (_) {
      // ignore
    }
  },

  async _finish(status) {
    if (!this._state) return { success: false, error: 'no_state' };
    this._state.status = status;
    this._state.finishedAt = new Date().toISOString();
    await this._saveState();
    this._emitProgress();
    this._running = false;
    return {
      success: status === 'done',
      runId: this._state.runId,
      status,
      total: (this._state.succeededIds.length + this._state.skippedIds.length + this._state.failedItems.length),
      succeeded: this._state.succeededIds.length,
      skipped: this._state.skippedIds.length,
      failed: this._state.failedItems.length,
      remaining: this._state.pendingIds.length
    };
  },

  /**
   * 取消当前任务。
   */
  abort() {
    if (this._abortController) {
      try { this._abortController.abort(); } catch (_) { /* ignore */ }
    }
    this._running = false;
    return { success: true };
  },

  _aborted() {
    return !!this._abortController?.signal?.aborted;
  },

  /**
   * 拿当前进度（不发出回调）。
   */
  async getProgress() {
    if (this._state) return { ...this._state };
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      const r = await chrome.storage.local.get([BATCH_STORAGE_KEY]);
      return r[BATCH_STORAGE_KEY] || null;
    }
    return null;
  },

  /**
   * 订阅进度变化。
   */
  onProgress(callback) {
    if (typeof callback !== 'function') return () => {};
    this._onProgressCallbacks.add(callback);
    return () => this._onProgressCallbacks.delete(callback);
  },

  _emitProgress() {
    if (!this._state) return;
    const snapshot = JSON.parse(JSON.stringify(this._state));
    this._onProgressCallbacks.forEach((cb) => {
      try { cb(snapshot); } catch (_) { /* ignore */ }
    });
  },

  /**
   * 计算可读统计。
   */
  summarize(state) {
    if (!state) return null;
    const total = (state.pendingIds?.length || 0) +
      (state.processing?.length || 0) +
      (state.succeededIds?.length || 0) +
      (state.skippedIds?.length || 0) +
      (state.failedItems?.length || 0);
    const done = (state.succeededIds?.length || 0) +
      (state.skippedIds?.length || 0) +
      (state.failedItems?.length || 0);
    return {
      runId: state.runId,
      status: state.status,
      total,
      done,
      pending: state.pendingIds?.length || 0,
      processing: state.processing?.length || 0,
      succeeded: state.succeededIds?.length || 0,
      skipped: state.skippedIds?.length || 0,
      failed: state.failedItems?.length || 0,
      pct: total ? Math.round((done / total) * 100) : 0
    };
  }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { BatchExporter, BATCH_STORAGE_KEY };
} else if (typeof window !== 'undefined') {
  window.ChatGPTSaver = window.ChatGPTSaver || {};
  window.ChatGPTSaver.BatchExporter = BatchExporter;
}
