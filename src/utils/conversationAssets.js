const ConversationAssets = {
  _pendingGeneratedRequests: new Map(),
  _recentUploadKeys: new Map(),
  _memoryPendingUploads: new Map(),
  _pendingUploadDbPromise: null,
  _bridgeBound: false,
  _pendingUploadDbName: 'ChatGPTSaverUploadCacheDB',
  _pendingUploadStoreName: 'pendingUploads',
  _pendingUploadDbVersion: 1,

  init() {
    if (this._bridgeBound) return;
    this._bridgeBound = true;
    window.addEventListener('message', (event) => {
      if (event.source !== window || !event.data) return;
      if (event.data.type !== 'SAVER_GENERATED_FILES_CANDIDATES') return;
      const requestId = String(event.data.requestId || '');
      if (!requestId || !this._pendingGeneratedRequests.has(requestId)) return;
      const pending = this._pendingGeneratedRequests.get(requestId);
      this._pendingGeneratedRequests.delete(requestId);
      const payload = {
        candidates: Array.isArray(event.data.candidates) ? event.data.candidates : [],
        diagnostics: event.data?.diagnostics && typeof event.data.diagnostics === 'object'
          ? event.data.diagnostics
          : null
      };
      pending.resolve(pending.includeDiagnostics ? payload : payload.candidates);
    });
  },

  _fs() {
    return window.ChatGPTSaver?.FileSystem;
  },

  _logger() {
    return window.ChatGPTSaver?.Logger || null;
  },

  _now() {
    return new Date().toISOString();
  },

  _debugEnabled(options = {}) {
    return options?.debug === true;
  },

  _log(message, options = {}) {
    if (!this._debugEnabled(options)) return;
    this._logger()?.add?.(message);
  },

  _setStatus(type, title, options = {}) {
    if (!this._debugEnabled(options)) return;
    this._logger()?.status?.(type, title);
  },

  _parser() {
    return window.ChatGPTSaver?.Parser;
  },

  _conversationBase(conversation = null) {
    const parser = this._parser();
    const parsed = conversation || parser?.parseConversation?.() || null;
    const title = parsed?.title || parser?.getConversationTitle?.() || '';
    const workspace = parser?.getWorkspaceName?.() || '个人帐户';
    return { conversation: parsed, title, workspace, url: parsed?.url || location.href };
  },

  _messageIdFromNode(node) {
    let current = node;
    while (current && current !== document.body) {
      if (current.getAttribute && current.getAttribute('data-message-id')) return current.getAttribute('data-message-id');
      current = current.parentElement;
    }
    return '';
  },

  _safeName(name, fallback = 'file') {
    return this._fs()?.sanitizeFileName?.(String(name || '').trim()) || fallback;
  },

  _parseDispositionFileName(headerValue) {
    const raw = String(headerValue || '');
    const utf = raw.match(/filename\*=UTF-8''([^;]+)/i);
    if (utf && utf[1]) {
      try {
        return decodeURIComponent(utf[1]);
      } catch {
        return utf[1];
      }
    }
    const basic = raw.match(/filename="?([^";]+)"?/i);
    return basic?.[1] || '';
  },

  _responseFileName(response, fallbackName) {
    const dispositionName = this._parseDispositionFileName(response?.headers?.get?.('content-disposition'));
    if (dispositionName) return this._safeName(dispositionName, fallbackName);
    try {
      const pathname = new URL(String(response?.url || ''), location.origin).pathname;
      const last = pathname.split('/').filter(Boolean).pop();
      if (last) return this._safeName(last, fallbackName);
    } catch {
      // ignore
    }
    return this._safeName(fallbackName, 'file');
  },

  _blobCtor() {
    if (typeof Blob !== 'undefined') return Blob;
    if (typeof window !== 'undefined' && typeof window.Blob !== 'undefined') return window.Blob;
    return null;
  },

  _isFileLike(value) {
    if (!value || typeof value !== 'object') return false;
    const BlobCtor = this._blobCtor();
    if (BlobCtor && value instanceof BlobCtor && typeof value.name === 'string') return true;
    return typeof value.name === 'string'
      && typeof value.size === 'number'
      && typeof value.arrayBuffer === 'function';
  },

  async _toBlob(value) {
    const BlobCtor = this._blobCtor();
    if (!value || !BlobCtor) return null;
    if (value instanceof BlobCtor) return value;
    if (typeof value.arrayBuffer === 'function') {
      const buffer = await value.arrayBuffer();
      return new BlobCtor([buffer], { type: value.type || 'application/octet-stream' });
    }
    return null;
  },

  _looksLikeDirectGeneratedUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) return false;
    return /^(https?:)?\/\//i.test(raw) || /^\/?backend-api\//i.test(raw);
  },

  _normalizeDirectGeneratedUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    try {
      return new URL(raw, location.origin).href;
    } catch {
      return '';
    }
  },

  _candidateDisplayName(candidate = {}) {
    const rawHint = String(candidate?.fileNameHint || '').trim();
    if (rawHint) return this._safeName(rawHint, 'generated-file');
    const locator = String(candidate?.sandboxPath || '').trim();
    if (!locator) return 'generated-file';
    if (this._looksLikeDirectGeneratedUrl(locator)) {
      try {
        const url = new URL(locator, location.origin);
        const queryName = url.searchParams.get('filename') || url.searchParams.get('name');
        if (queryName) return this._safeName(queryName, 'generated-file');
        const id = url.searchParams.get('id');
        if (id) return this._safeName(id, 'generated-file');
        const last = url.pathname.split('/').filter(Boolean).pop();
        if (last) return this._safeName(last, 'generated-file');
      } catch {
        // ignore
      }
    }
    return this._safeName(locator.split('/').pop() || 'generated-file', 'generated-file');
  },

  _formatBytes(size) {
    const value = Number(size || 0);
    if (!Number.isFinite(value) || value <= 0) return '0 B';
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
    if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
    return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  },

  _normalizeCandidateKey(messageId, name) {
    return `${String(messageId || '').trim().toLowerCase()}::${String(name || '').trim().toLowerCase()}`;
  },

  _normalizePendingUploadId(value) {
    return String(value || '').trim().toLowerCase();
  },

  async _openPendingUploadDB() {
    if (typeof indexedDB === 'undefined') return null;
    if (!this._pendingUploadDbPromise) {
      this._pendingUploadDbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(this._pendingUploadDbName, this._pendingUploadDbVersion);
        request.onerror = () => reject(request.error);
        request.onupgradeneeded = (event) => {
          const db = event.target.result;
          if (!db.objectStoreNames.contains(this._pendingUploadStoreName)) {
            db.createObjectStore(this._pendingUploadStoreName, { keyPath: 'id' });
          }
        };
        request.onsuccess = () => resolve(request.result);
      }).catch(() => {
        this._pendingUploadDbPromise = null;
        return null;
      });
    }
    return this._pendingUploadDbPromise;
  },

  async _putPendingUpload(record) {
    const normalized = { ...record, id: this._normalizePendingUploadId(record?.id) };
    if (!normalized.id) return null;
    const db = await this._openPendingUploadDB();
    if (!db) {
      this._memoryPendingUploads.set(normalized.id, normalized);
      return normalized;
    }
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(this._pendingUploadStoreName, 'readwrite');
        tx.objectStore(this._pendingUploadStoreName).put(normalized);
        tx.oncomplete = () => {
          this._memoryPendingUploads.delete(normalized.id);
          resolve(normalized);
        };
        tx.onerror = () => {
          this._memoryPendingUploads.set(normalized.id, normalized);
          resolve(normalized);
        };
      } catch {
        this._memoryPendingUploads.set(normalized.id, normalized);
        resolve(normalized);
      }
    });
  },

  async _deletePendingUpload(id) {
    const normalizedId = this._normalizePendingUploadId(id);
    if (!normalizedId) return;
    this._memoryPendingUploads.delete(normalizedId);
    const db = await this._openPendingUploadDB();
    if (!db) return;
    await new Promise((resolve) => {
      try {
        const tx = db.transaction(this._pendingUploadStoreName, 'readwrite');
        tx.objectStore(this._pendingUploadStoreName).delete(normalizedId);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  },

  async _listPendingUploads() {
    const merged = new Map();
    this._memoryPendingUploads.forEach((record, id) => {
      merged.set(this._normalizePendingUploadId(id), record);
    });
    const db = await this._openPendingUploadDB();
    if (db) {
      const records = await new Promise((resolve) => {
        try {
          const tx = db.transaction(this._pendingUploadStoreName, 'readonly');
          const request = tx.objectStore(this._pendingUploadStoreName).getAll();
          request.onsuccess = () => resolve(Array.isArray(request.result) ? request.result : []);
          request.onerror = () => resolve([]);
        } catch {
          resolve([]);
        }
      });
      records.forEach((record) => {
        const normalizedId = this._normalizePendingUploadId(record?.id);
        if (normalizedId) merged.set(normalizedId, record);
      });
    }
    return Array.from(merged.values()).sort((a, b) => String(a?.capturedAt || '').localeCompare(String(b?.capturedAt || '')));
  },

  _resolvePendingUploadBase(record, options = {}) {
    const currentBase = this._conversationBase(options.conversation || null);
    const currentConversationId = String(options.conversationId || this.getConversationId() || location.pathname || location.href);
    const recordConversationId = String(record?.conversationId || '');
    const sameConversation = !recordConversationId || recordConversationId === currentConversationId;
    return {
      title: String(sameConversation ? (currentBase.title || record?.titleSnapshot || '') : (record?.titleSnapshot || '')).trim(),
      workspace: String(sameConversation ? (currentBase.workspace || record?.workspaceSnapshot || '个人帐户') : (record?.workspaceSnapshot || '个人帐户')).trim() || '个人帐户',
      url: String(sameConversation ? (currentBase.url || record?.conversationUrl || location.href) : (record?.conversationUrl || '')).trim(),
      conversation: sameConversation ? currentBase.conversation : null,
      sameConversation
    };
  },

  async _stagePendingUploads(fileList, meta = {}) {
    const base = this._conversationBase(meta.conversation || null);
    const files = Array.from(fileList || []).filter((file) => this._isFileLike(file));
    if (!files.length) return { staged: [], skippedCount: 0 };

    this._cleanupUploadDedupe();
    const conversationId = String(meta.conversationId || this.getConversationId() || location.pathname || location.href);
    const conversationUrl = String(base.url || meta.conversationUrl || location.href);
    const staged = [];
    let skippedCount = 0;

    for (const file of files) {
      const dedupeKey = [conversationId, file.name, file.size, file.lastModified].join('::');
      if (this._recentUploadKeys.has(dedupeKey)) {
        skippedCount += 1;
        continue;
      }
      this._recentUploadKeys.set(dedupeKey, Date.now());
      const blob = await this._toBlob(file);
      if (!blob) {
        skippedCount += 1;
        continue;
      }
      const record = {
        id: `pending-upload::${dedupeKey}`,
        dedupeKey,
        conversationId,
        conversationUrl,
        titleSnapshot: String(meta.title || base.title || '').trim(),
        workspaceSnapshot: String(meta.workspace || base.workspace || '个人帐户').trim() || '个人帐户',
        source: String(meta.source || 'user_input').trim() || 'user_input',
        messageId: String(meta.messageId || '').trim(),
        name: this._safeName(file.name, 'upload-file'),
        mimeType: String(file.type || blob.type || ''),
        size: Number(file.size || blob.size || 0) || 0,
        lastModified: Number(file.lastModified || 0) || 0,
        capturedAt: this._now(),
        blob
      };
      const savedRecord = await this._putPendingUpload(record);
      if (savedRecord) staged.push(savedRecord);
    }

    return { staged, skippedCount };
  },

  async flushPendingUploads(options = {}) {
    const fs = this._fs();
    const allPending = await this._listPendingUploads();
    const targetIds = Array.isArray(options?.targetIds) && options.targetIds.length
      ? new Set(options.targetIds.map((id) => this._normalizePendingUploadId(id)).filter(Boolean))
      : null;
    const pending = targetIds
      ? allPending.filter((record) => targetIds.has(this._normalizePendingUploadId(record?.id)))
      : allPending;
    if (!pending.length) {
      return {
        success: true,
        flushedCount: 0,
        pendingCount: allPending.length,
        deferredCount: 0,
        failedCount: 0,
        saved: [],
        deferred: [],
        failed: [],
        folderReady: true
      };
    }
    if (!fs) {
      return {
        success: false,
        error: 'file_system_unavailable',
        flushedCount: 0,
        pendingCount: allPending.length,
        deferredCount: pending.length,
        failedCount: 0,
        saved: [],
        deferred: pending.map((record) => ({ pendingId: record.id, error: 'file_system_unavailable', record })),
        failed: [],
        folderReady: false
      };
    }

    const ready = await fs.ensureFolderReady({ interactive: false, reason: options.reason || 'pending_upload_flush' });
    if (!ready.ready) {
      return {
        success: true,
        flushedCount: 0,
        pendingCount: allPending.length,
        deferredCount: pending.length,
        failedCount: 0,
        saved: [],
        deferred: pending.map((record) => ({ pendingId: record.id, error: 'folder_not_ready', record })),
        failed: [],
        folderReady: false
      };
    }

    const groupedEntries = new Map();
    const saved = [];
    const deferred = [];
    const failed = [];

    for (const record of pending) {
      const base = this._resolvePendingUploadBase(record, options);
      if (!base.title) {
        deferred.push({ pendingId: record.id, error: 'missing_title', record });
        continue;
      }
      try {
        const entry = await this._saveAssetBlob('upload', base.title, base.workspace, record.blob, {
          name: record.name,
          mimeType: record.mimeType,
          size: record.size,
          source: record.source || 'pending_upload',
          messageId: record.messageId || ''
        });
        if (!entry) {
          deferred.push({ pendingId: record.id, error: 'write_failed', record, base });
          continue;
        }
        const groupKey = `${base.workspace}::${base.title}::${base.url}`;
        if (!groupedEntries.has(groupKey)) groupedEntries.set(groupKey, { base, entries: [] });
        groupedEntries.get(groupKey).entries.push(entry);
        saved.push({ pendingId: record.id, entry, base });
      } catch (error) {
        failed.push({ pendingId: record.id, error: error?.message || 'flush_failed', record, base });
      }
    }

    for (const { base, entries } of groupedEntries.values()) {
      await fs.upsertAssetEntries(base.title, base.workspace, base.url, 'upload', entries);
    }
    for (const item of saved) {
      await this._deletePendingUpload(item.pendingId);
    }

    const remainingPending = await this._listPendingUploads();
    return {
      success: true,
      flushedCount: saved.length,
      pendingCount: remainingPending.length,
      deferredCount: deferred.length,
      failedCount: failed.length,
      saved,
      deferred,
      failed,
      folderReady: true
    };
  },

  _looksLikeDownloadUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) return false;
    return /^(https?:)?\/\//i.test(raw)
      || /^\/?backend-api\//i.test(raw)
      || /^\/?api\//i.test(raw)
      || /^\/files\//i.test(raw)
      || /^https:\/\/files\.oaiusercontent\.com\//i.test(raw);
  },

  _collectNestedStrings(value, depth = 0, path = '', seen = null, output = null) {
    const target = output || [];
    const visited = seen || new WeakSet();
    if (depth > 5 || value === null || value === undefined) return target;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) target.push({ path, value: trimmed });
      return target;
    }
    if (typeof value !== 'object') return target;
    if (visited.has(value)) return target;
    visited.add(value);
    if (Array.isArray(value)) {
      value.forEach((item, index) => this._collectNestedStrings(item, depth + 1, `${path}[${index}]`, visited, target));
      return target;
    }
    Object.entries(value).forEach(([key, nested]) => {
      const nextPath = path ? `${path}.${key}` : key;
      this._collectNestedStrings(nested, depth + 1, nextPath, visited, target);
    });
    return target;
  },

  _pickAttachmentName(strings = []) {
    const preferred = strings.find((entry) => /(^|\.)(file_?name|filename|name|display_?name|title)$/i.test(entry.path) && !this._looksLikeDownloadUrl(entry.value));
    if (preferred) return preferred.value;
    const withExt = strings.find((entry) => !this._looksLikeDownloadUrl(entry.value) && /\.[a-z0-9]{2,8}$/i.test(entry.value));
    if (withExt) return withExt.value;
    return '';
  },

  _pickAttachmentUrl(strings = []) {
    const preferred = strings.find((entry) => this._looksLikeDownloadUrl(entry.value) && /(download|url|href|link|uri|src|asset|pointer|file)/i.test(entry.path));
    if (preferred) return preferred.value;
    const fallback = strings.find((entry) => this._looksLikeDownloadUrl(entry.value));
    return fallback?.value || '';
  },

  _pickAttachmentFileId(strings = []) {
    const hit = strings.find((entry) => /file_[0-9a-z]+/i.test(entry.value));
    if (!hit) return '';
    const matched = String(hit.value).match(/file_[0-9a-z]+/i);
    return matched ? matched[0] : '';
  },

  _extractUrlLikeValue(payload) {
    if (!payload || typeof payload !== 'object') return '';
    const strings = this._collectNestedStrings(payload);
    const preferred = strings.find((entry) => this._looksLikeDownloadUrl(entry.value) && /(download|url|href|link|uri|src|asset|pointer|file|signed)/i.test(entry.path));
    if (preferred) return this._normalizeDirectGeneratedUrl(preferred.value) || preferred.value;
    const fallback = strings.find((entry) => this._looksLikeDownloadUrl(entry.value));
    return fallback ? (this._normalizeDirectGeneratedUrl(fallback.value) || fallback.value) : '';
  },

  _summarizeMetadataPayload(payload) {
    if (!payload || typeof payload !== 'object') return 'metadata=empty';
    const topKeys = Object.keys(payload).slice(0, 8);
    const strings = this._collectNestedStrings(payload);
    const urlPaths = strings
      .filter((entry) => this._looksLikeDownloadUrl(entry.value))
      .slice(0, 3)
      .map((entry) => entry.path || '(root)');
    const fileIdPaths = strings
      .filter((entry) => /file_[0-9a-z]+/i.test(entry.value))
      .slice(0, 3)
      .map((entry) => entry.path || '(root)');
    const namePaths = strings
      .filter((entry) => /\.[a-z0-9]{2,8}$/i.test(entry.value) && !this._looksLikeDownloadUrl(entry.value))
      .slice(0, 3)
      .map((entry) => entry.path || '(root)');
    return [
      `keys=${topKeys.join(',') || '(none)'}`,
      `urlPaths=${urlPaths.join('|') || '(none)'}`,
      `fileIdPaths=${fileIdPaths.join('|') || '(none)'}`,
      `namePaths=${namePaths.join('|') || '(none)'}`
    ].join('；');
  },

  async _probeUploadDownloadByFileId(candidate, options = {}) {
    const fileId = String(candidate?.fileId || '').trim();
    if (!fileId) return { response: null, error: 'missing_file_id', mode: 'file_id_probe' };
    const token = String(options?.token || '');
    const conversationId = String(options?.conversationId || '');
    const messageId = String(options?.messageId || candidate?.messageId || '').trim();
    const headers = {};
    if (token) headers.authorization = `Bearer ${token}`;

    const probes = [
      { url: `/backend-api/files/${encodeURIComponent(fileId)}/download`, mode: 'files_download' },
      { url: `/backend-api/files/${encodeURIComponent(fileId)}`, mode: 'files_metadata' },
      { url: `/backend-api/files/${encodeURIComponent(fileId)}/content`, mode: 'files_content' }
    ];
    if (messageId) {
      probes.push({
        url: `/backend-api/files/${encodeURIComponent(fileId)}/download?message_id=${encodeURIComponent(messageId)}`,
        mode: 'files_download_with_message'
      });
    }
    if (conversationId) {
      probes.push({
        url: `/backend-api/files/${encodeURIComponent(fileId)}/download?conversation_id=${encodeURIComponent(conversationId)}`,
        mode: 'files_download_with_conversation'
      });
    }
    if (conversationId && messageId) {
      probes.push({
        url: `/backend-api/files/${encodeURIComponent(fileId)}/download?conversation_id=${encodeURIComponent(conversationId)}&message_id=${encodeURIComponent(messageId)}`,
        mode: 'files_download_with_conversation_and_message'
      });
    }

    for (const probe of probes) {
      const probeUrl = this._normalizeDirectGeneratedUrl(probe.url) || probe.url;
      this._log(`尝试通过 fileId 反查上传文件：${probe.mode} -> ${probeUrl}`, options);
      try {
        const response = await fetch(probeUrl, { credentials: 'include', headers });
        if (!response.ok) {
          this._log(`fileId 反查失败：${probe.mode} 返回 HTTP ${response.status}`, options);
          continue;
        }
        const contentType = String(response.headers?.get?.('content-type') || '').toLowerCase();
        if (contentType.includes('application/json') || contentType.includes('text/json')) {
          const payload = await response.json().catch(() => null);
          const downloadUrl = this._extractUrlLikeValue(payload);
          if (!downloadUrl) {
            this._log(`fileId 反查响应为 JSON，但未找到可下载链接：${probe.mode}；${this._summarizeMetadataPayload(payload)}`, options);
            continue;
          }
          this._log(`fileId 反查成功：${probe.mode} 提供了下载地址。`, options);
          const directResponse = await fetch(downloadUrl, { credentials: 'include', headers });
          if (!directResponse.ok) {
            this._log(`fileId 反查得到的下载地址不可用：HTTP ${directResponse.status}`, options);
            continue;
          }
          return { response: directResponse, error: '', mode: probe.mode, requestUrl: probeUrl, downloadUrl };
        }
        if (contentType.includes('text/html')) {
          this._log(`fileId 反查命中 HTML 页面，跳过：${probe.mode}`, options);
          continue;
        }
        this._log(`fileId 反查成功：${probe.mode} 直接返回文件内容。`, options);
        return { response, error: '', mode: probe.mode, requestUrl: probeUrl, downloadUrl: probeUrl };
      } catch (error) {
        this._log(`fileId 反查异常：${probe.mode} -> ${error?.message || 'probe_failed'}`, options);
      }
    }

    return { response: null, error: 'upload_file_id_probe_failed', mode: 'file_id_probe' };
  },

  _extractUploadCandidateFromAttachment(rawAttachment, messageId, source = 'conversation_api') {
    if (!rawAttachment || typeof rawAttachment !== 'object') return null;
    const strings = this._collectNestedStrings(rawAttachment);
    const name = this._pickAttachmentName(strings);
    const href = this._pickAttachmentUrl(strings);
    const fileId = this._pickAttachmentFileId(strings);
    if (!name && !href && !fileId) return null;
    return {
      kind: 'upload',
      name: this._safeName(name || fileId || 'upload-file', 'upload-file'),
      messageId: String(messageId || rawAttachment?.message_id || rawAttachment?.messageId || '').trim(),
      href: this._normalizeDirectGeneratedUrl(href) || href || '',
      fileId: fileId || String(rawAttachment?.file_id || rawAttachment?.id || '').trim(),
      source,
      status: href ? 'detected' : 'missing_original'
    };
  },

  _extractUploadCandidatesFromConversationPayload(payload, source = 'conversation_api') {
    const records = [];
    const mapping = payload?.mapping && typeof payload.mapping === 'object' ? Object.values(payload.mapping) : [];
    const directMessages = Array.isArray(payload?.messages) ? payload.messages : [];
    const candidates = [];
    if (mapping.length) {
      mapping.forEach((node) => {
        if (node?.message) candidates.push({ message: node.message, nodeId: node.id || '' });
      });
    }
    if (directMessages.length) {
      directMessages.forEach((message) => candidates.push({ message, nodeId: message?.id || '' }));
    }
    const seen = new Set();
    candidates.forEach(({ message, nodeId }) => {
      const role = String(message?.author?.role || message?.role || '').toLowerCase();
      if (role !== 'user') return;
      const messageId = String(message?.id || message?.message_id || nodeId || '').trim();
      const attachmentArrays = [
        Array.isArray(message?.content?.attachments) ? message.content.attachments : [],
        Array.isArray(message?.attachments) ? message.attachments : [],
        Array.isArray(message?.metadata?.attachments) ? message.metadata.attachments : []
      ];
      attachmentArrays.forEach((items) => {
        items.forEach((item) => {
          const normalized = this._extractUploadCandidateFromAttachment(item, messageId, source);
          if (!normalized) return;
          const key = this._normalizeCandidateKey(normalized.messageId, normalized.name);
          if (seen.has(key)) return;
          seen.add(key);
          records.push(normalized);
        });
      });
    });
    return records;
  },

  _mergeUploadCandidates(domRecords = [], apiRecords = []) {
    const merged = new Map();
    const insert = (candidate, preferExisting = false) => {
      const key = this._normalizeCandidateKey(candidate?.messageId, candidate?.name);
      if (!key || key === '::') return;
      if (!merged.has(key)) {
        merged.set(key, { ...candidate });
        return;
      }
      const current = merged.get(key);
      merged.set(key, {
        ...current,
        ...candidate,
        name: current.name || candidate.name,
        messageId: current.messageId || candidate.messageId,
        href: preferExisting ? (current.href || candidate.href || '') : (candidate.href || current.href || ''),
        fileId: preferExisting ? (current.fileId || candidate.fileId || '') : (candidate.fileId || current.fileId || ''),
        source: current.source && candidate.source && current.source !== candidate.source
          ? `${current.source}+${candidate.source}`
          : (candidate.source || current.source || ''),
        status: candidate.href || current.href ? 'detected' : (candidate.status || current.status || 'missing_original')
      });
    };
    apiRecords.forEach((item) => insert(item, false));
    domRecords.forEach((item) => insert(item, true));
    return Array.from(merged.values());
  },

  async fetchHistoricalUploadCandidates(options = {}) {
    const conversationId = this.getConversationId();
    if (!conversationId) {
      return {
        records: [],
        diagnostics: { reason: 'conversation_id_unavailable', totalCandidates: 0, hrefCandidates: 0 }
      };
    }
    const token = await this.fetchSessionToken();
    const headers = {};
    if (token) headers.authorization = `Bearer ${token}`;
    const url = `/backend-api/conversation/${conversationId}`;
    try {
      const response = await fetch(url, {
        credentials: 'include',
        headers
      });
      if (!response.ok) {
        return {
          records: [],
          diagnostics: {
            reason: `conversation_api_http_${response.status}`,
            totalCandidates: 0,
            hrefCandidates: 0
          }
        };
      }
      const payload = await response.json().catch(() => null);
      const records = this._extractUploadCandidatesFromConversationPayload(payload, 'conversation_api');
      return {
        records,
        diagnostics: {
          reason: records.length ? 'ok' : 'no_upload_metadata',
          totalCandidates: records.length,
          hrefCandidates: records.filter((item) => item.href).length,
          fileIdCandidates: records.filter((item) => item.fileId).length,
          hasToken: Boolean(token)
        }
      };
    } catch (error) {
      return {
        records: [],
        diagnostics: {
          reason: error?.message || 'conversation_api_failed',
          totalCandidates: 0,
          hrefCandidates: 0,
          fileIdCandidates: 0
        }
      };
    }
  },

  _shortId(value, head = 8, tail = 4) {
    const text = String(value || '').trim();
    if (!text || text.length <= head + tail + 3) return text || '-';
    return `${text.slice(0, head)}...${text.slice(-tail)}`;
  },

  _logBridgeDiagnostics(diagnostics, options = {}) {
    if (!this._debugEnabled(options) || !diagnostics) return;
    if (diagnostics.timedOut) {
      this._log(`主世界补抓桥接超时（${diagnostics.timeoutMs || 0}ms），可能是页面仍在加载，或注入脚本未运行。`, options);
      return;
    }
    const parts = [
      `桥接扫描节点 ${Number(diagnostics.scannedNodes || 0)} 个`,
      `识别候选 ${Number(diagnostics.candidateCount || 0)} 个`
    ];
    if (Number.isFinite(Number(diagnostics.assistantMessages))) parts.push(`助手消息 ${Number(diagnostics.assistantMessages)} 条`);
    if (Number.isFinite(Number(diagnostics.droppedMissingMessageId))) parts.push(`缺少 messageId ${Number(diagnostics.droppedMissingMessageId)} 个`);
    if (Number.isFinite(Number(diagnostics.droppedMissingSandboxPath))) parts.push(`缺少 sandboxPath ${Number(diagnostics.droppedMissingSandboxPath)} 个`);
    this._log(parts.join('，'), options);
  },

  async _getFolders(title, workspace) {
    const fs = this._fs();
    if (!fs) return null;
    const ready = await fs.ensureFolderReady({ interactive: false, reason: 'conversation_assets' });
    if (!ready.ready) return null;
    return fs.createConversationFolders(title, workspace);
  },

  async _saveAssetBlob(kind, title, workspace, blob, meta = {}) {
    const fs = this._fs();
    const folders = await this._getFolders(title, workspace);
    if (!fs || !folders || !(blob instanceof Blob)) return null;
    const dir = kind === 'generated' ? folders.generated : folders.uploads;
    const fileName = this._safeName(meta.name, kind === 'generated' ? 'generated-file' : 'upload-file');
    await fs.writeFile(dir, fileName, blob, meta.mimeType || blob.type || 'application/octet-stream');
    return {
      kind,
      name: fileName,
      mimeType: String(meta.mimeType || blob.type || ''),
      size: Number(meta.size || blob.size || 0) || 0,
      status: 'saved',
      savedPath: `${kind === 'generated' ? 'generated' : 'uploads'}/${fileName}`,
      source: String(meta.source || ''),
      messageId: String(meta.messageId || ''),
      collectedAt: new Date().toISOString(),
      error: '',
      sandboxPath: String(meta.sandboxPath || '')
    };
  },

  _cleanupUploadDedupe() {
    const now = Date.now();
    for (const [key, ts] of this._recentUploadKeys.entries()) {
      if (now - ts > 30000) this._recentUploadKeys.delete(key);
    }
  },

  async captureUploadedFiles(fileList, meta = {}) {
    const stagedResult = await this._stagePendingUploads(fileList, meta);
    if (!stagedResult.staged.length) {
      return {
        success: true,
        saved: [],
        staged: [],
        stagedCount: 0,
        skippedCount: stagedResult.skippedCount || 0,
        pendingCount: (await this._listPendingUploads()).length
      };
    }
    const targetIds = stagedResult.staged.map((record) => record.id);
    const flushResult = await this.flushPendingUploads({
      targetIds,
      conversation: meta.conversation || null,
      conversationId: meta.conversationId || '',
      reason: meta.reason || 'capture_upload'
    });
    const savedIds = new Set((flushResult.saved || []).map((item) => this._normalizePendingUploadId(item.pendingId)));
    const savedEntries = (flushResult.saved || [])
      .filter((item) => targetIds.includes(item.pendingId))
      .map((item) => item.entry);
    const staged = stagedResult.staged.filter((record) => !savedIds.has(this._normalizePendingUploadId(record.id)));
    return {
      success: true,
      saved: savedEntries,
      staged,
      stagedCount: staged.length,
      skippedCount: stagedResult.skippedCount || 0,
      pendingCount: flushResult.pendingCount,
      flushedCount: savedEntries.length,
      folderReady: flushResult.folderReady,
      deferred: flushResult.deferred || [],
      failed: flushResult.failed || []
    };
  },

  scanUploadCandidatesFromDOM(options = {}) {
    const records = [];
    const seen = new Set();
    const userMessages = document.querySelectorAll('[data-message-author-role="user"]');
    const diagnostics = {
      userMessages: userMessages.length,
      totalCandidates: 0,
      hrefCandidates: 0,
      textOnlyCandidates: 0
    };
    userMessages.forEach((msgEl) => {
      const messageId = this._messageIdFromNode(msgEl);
      const links = msgEl.querySelectorAll('a[download], a[href]');
      links.forEach((link) => {
        const name = link.getAttribute('download') || link.textContent?.trim() || link.getAttribute('title') || '';
        const href = link.getAttribute('href') || '';
        if (!name) return;
        const key = `${messageId}::${name}::${href}`;
        if (seen.has(key)) return;
        seen.add(key);
        records.push({
          kind: 'upload',
          name: this._safeName(name, 'upload-file'),
          messageId,
          href,
          source: 'dom_link',
          status: href ? 'detected' : 'missing_original'
        });
        diagnostics.totalCandidates += 1;
        if (href) diagnostics.hrefCandidates += 1;
        else diagnostics.textOnlyCandidates += 1;
      });

      const textNodes = msgEl.querySelectorAll('[class*="truncate"], [class*="line-clamp"], [class*="overflow-hidden"]');
      textNodes.forEach((node) => {
        const text = String(node.textContent || '').trim().replace(/\.\.\.\s*$/, '');
        if (!text || !/\.[a-z0-9]{2,8}$/i.test(text)) return;
        const key = `${messageId}::${text}`;
        if (seen.has(key)) return;
        seen.add(key);
        records.push({
          kind: 'upload',
          name: this._safeName(text, 'upload-file'),
          messageId,
          href: '',
          source: 'dom_text',
          status: 'missing_original'
        });
        diagnostics.totalCandidates += 1;
        diagnostics.textOnlyCandidates += 1;
      });
    });
    return options?.includeDiagnostics ? { records, diagnostics } : records;
  },

  requestGeneratedCandidates(options = {}) {
    this.init();
    return new Promise((resolve) => {
      const includeDiagnostics = options?.includeDiagnostics === true;
      const requestId = `generated_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const timer = setTimeout(() => {
        this._pendingGeneratedRequests.delete(requestId);
        resolve(includeDiagnostics ? {
          candidates: [],
          diagnostics: {
            timedOut: true,
            timeoutMs: 1500,
            reason: 'bridge_timeout'
          }
        } : []);
      }, 1500);
      this._pendingGeneratedRequests.set(requestId, {
        includeDiagnostics,
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        }
      });
      window.postMessage({ type: 'SAVER_REQUEST_GENERATED_FILES', requestId }, '*');
    });
  },

  async fetchSessionToken() {
    try {
      const response = await fetch('/api/auth/session', { credentials: 'include' });
      const data = await response.json();
      return String(data?.accessToken || '');
    } catch {
      return '';
    }
  },

  getConversationId() {
    const match = location.pathname.match(/\/(?:c|g|conversation)\/([a-zA-Z0-9\-]+)/);
    if (match && match[1]) return match[1];
    const uuidMatch = location.pathname.match(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/);
    return uuidMatch ? uuidMatch[0] : '';
  },

  async _resolveGeneratedDownloadUrl(conversationId, messageId, sandboxPath, token) {
    if (!conversationId) return { downloadUrl: '', error: 'conversation_id_unavailable' };
    if (!messageId) return { downloadUrl: '', error: 'message_id_unavailable' };
    if (!sandboxPath) return { downloadUrl: '', error: 'sandbox_path_unavailable' };
    if (this._looksLikeDirectGeneratedUrl(sandboxPath)) {
      const directUrl = this._normalizeDirectGeneratedUrl(sandboxPath);
      return directUrl
        ? { downloadUrl: directUrl, error: '', mode: 'direct_url' }
        : { downloadUrl: '', error: 'direct_url_invalid' };
    }
    if (!token) return { downloadUrl: '', error: 'session_token_unavailable' };
    const url = `/backend-api/conversation/${conversationId}/interpreter/download?message_id=${encodeURIComponent(messageId)}&sandbox_path=${encodeURIComponent(sandboxPath)}`;
    try {
      const response = await fetch(url, { headers: { authorization: `Bearer ${token}` }, credentials: 'include' });
      if (!response.ok) return { downloadUrl: '', error: `download_api_http_${response.status}` };
      const data = await response.json().catch(() => null);
      const downloadUrl = String(data?.download_url || '');
      if (!downloadUrl) return { downloadUrl: '', error: 'download_url_unavailable' };
      return { downloadUrl, error: '', requestUrl: url, mode: 'resolved_url' };
    } catch (error) {
      return { downloadUrl: '', error: error?.message || 'download_api_failed' };
    }
  },

  async collectGeneratedFiles(options = {}) {
    const fs = this._fs();
    if (!fs) return { success: false, error: 'file_system_unavailable', saved: [], failed: [], diagnostics: { reason: 'file_system_unavailable' } };
    const base = this._conversationBase(options.conversation || null);
    if (!base.title) return { success: false, error: 'missing_title', saved: [], failed: [], diagnostics: { reason: 'missing_title' } };
    const folders = await this._getFolders(base.title, base.workspace);
    if (!folders) return { success: false, error: 'folder_not_ready', saved: [], failed: [], diagnostics: { reason: 'folder_not_ready' } };

    this._setStatus('loading', '正在补抓历史文件...', options);
    this._log(`开始补抓当前会话历史文件：${base.title}`, options);

    let bridgeDiagnostics = null;
    let candidates = Array.isArray(options.candidates) ? options.candidates : [];
    if (!Array.isArray(options.candidates)) {
      const snapshot = await this.requestGeneratedCandidates({ includeDiagnostics: this._debugEnabled(options) });
      if (Array.isArray(snapshot)) {
        candidates = snapshot;
      } else {
        candidates = Array.isArray(snapshot?.candidates) ? snapshot.candidates : [];
        bridgeDiagnostics = snapshot?.diagnostics || null;
      }
      this._logBridgeDiagnostics(bridgeDiagnostics, options);
    }

    if (!candidates.length) {
      this._log('未检测到可补抓的生成文件候选。可能是当前会话没有生成文件，或者页面结构已变化。', options);
      return {
        success: true,
        saved: [],
        failed: [],
        diagnostics: {
          reason: 'no_candidates',
          candidateCount: 0,
          bridgeDiagnostics
        }
      };
    }

    this._log(`检测到 ${candidates.length} 个生成文件候选。`, options);
    const conversationId = this.getConversationId();
    if (conversationId) this._log(`当前会话 ID：${this._shortId(conversationId)}`, options);
    else this._log(`当前 URL 未解析出 conversationId：${location.pathname || location.href}`, options);
    const requiresResolver = candidates.some((candidate) => !this._looksLikeDirectGeneratedUrl(candidate?.sandboxPath));
    let token = '';
    if (requiresResolver) {
      token = await this.fetchSessionToken();
      if (token) this._log('已获取会话 accessToken，准备请求下载地址。', options);
      else this._log('未拿到 /api/auth/session 的 accessToken，无法请求生成文件下载地址。', options);
    } else {
      this._log('本次候选均为直链文件地址，跳过 interpreter/download 解析。', options);
    }
    const saved = [];
    const failed = [];
    for (let index = 0; index < candidates.length; index += 1) {
      const candidate = candidates[index];
      const messageId = String(candidate?.messageId || '');
      const sandboxPath = String(candidate?.sandboxPath || '');
      const suggestedName = this._candidateDisplayName(candidate) || this._safeName(`generated_${messageId || 'file'}`, 'generated-file');
      this._log(`候选 ${index + 1}/${candidates.length}：${suggestedName}，messageId=${this._shortId(messageId)}，sandboxPath=${sandboxPath || '-'}`, options);
      const resolution = await this._resolveGeneratedDownloadUrl(conversationId, messageId, sandboxPath, token);
      if (!resolution.downloadUrl) {
        this._log(`候选 ${index + 1} 获取下载地址失败：${resolution.error || 'download_url_unavailable'}`, options);
        failed.push({
          kind: 'generated',
          name: suggestedName,
          messageId,
          sandboxPath,
          status: 'missing_original',
          savedPath: '',
          source: 'sandbox_api',
          collectedAt: new Date().toISOString(),
          error: resolution.error || 'download_url_unavailable'
        });
        continue;
      }
      if (resolution.mode === 'direct_url') {
        this._log(`候选 ${index + 1} 识别为直链文件地址，直接下载文件内容。`, options);
      } else {
        this._log(`候选 ${index + 1} 已拿到下载地址，开始下载文件内容。`, options);
      }
      try {
        const fetchOptions = { credentials: 'include' };
        if (token) fetchOptions.headers = { authorization: `Bearer ${token}` };
        const response = await fetch(resolution.downloadUrl, fetchOptions);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const blob = await response.blob();
        const entry = await this._saveAssetBlob('generated', base.title, base.workspace, blob, {
          name: this._responseFileName(response, suggestedName),
          mimeType: blob.type,
          size: blob.size,
          source: 'sandbox_api',
          messageId,
          sandboxPath
        });
        if (entry) {
          saved.push(entry);
          this._log(`候选 ${index + 1} 保存成功：${entry.name}（${this._formatBytes(entry.size)}）`, options);
        } else {
          this._log(`候选 ${index + 1} 写入本地失败：目录句柄可用但未返回保存结果。`, options);
          failed.push({
            kind: 'generated',
            name: suggestedName,
            messageId,
            sandboxPath,
            status: 'missing_original',
            savedPath: '',
            source: 'sandbox_api',
            collectedAt: new Date().toISOString(),
            error: 'write_failed'
          });
        }
      } catch (error) {
        this._log(`候选 ${index + 1} 下载或写入失败：${error?.message || 'download_failed'}`, options);
        failed.push({
          kind: 'generated',
          name: suggestedName,
          messageId,
          sandboxPath,
          status: 'missing_original',
          savedPath: '',
          source: 'sandbox_api',
          collectedAt: new Date().toISOString(),
          error: error?.message || 'download_failed'
        });
      }
    }

    const entries = saved.concat(failed);
    const assetIndex = entries.length
      ? await fs.upsertAssetEntries(base.title, base.workspace, base.url, 'generated', entries)
      : await fs.upsertAssetEntries(base.title, base.workspace, base.url, 'generated', []);
    this._log(`补抓完成：成功 ${saved.length} 个，失败 ${failed.length} 个。`, options);
    return {
      success: true,
      saved,
      failed,
      assetIndex,
      diagnostics: {
        candidateCount: candidates.length,
        conversationId,
        hasToken: Boolean(token),
        requiresResolver,
        bridgeDiagnostics
      }
    };
  },

  async inspectConversationAssets(conversation = null, options = {}) {
    const base = this._conversationBase(conversation);
    const uploadSnapshot = this.scanUploadCandidatesFromDOM({ includeDiagnostics: options?.includeDiagnostics === true });
    const domUploadCandidates = Array.isArray(uploadSnapshot) ? uploadSnapshot : uploadSnapshot.records;
    const uploadDiagnostics = Array.isArray(uploadSnapshot) ? null : uploadSnapshot.diagnostics;
    const conversationUploadSnapshot = options?.includeConversationApi === true
      ? await this.fetchHistoricalUploadCandidates({ includeDiagnostics: options?.includeDiagnostics === true })
      : { records: [], diagnostics: null };
    const uploadCandidates = this._mergeUploadCandidates(domUploadCandidates, conversationUploadSnapshot.records || []);
    const generatedSnapshot = await this.requestGeneratedCandidates({ includeDiagnostics: options?.includeDiagnostics === true });
    const generatedCandidates = Array.isArray(generatedSnapshot) ? generatedSnapshot : generatedSnapshot?.candidates || [];
    const generatedDiagnostics = Array.isArray(generatedSnapshot) ? null : (generatedSnapshot?.diagnostics || null);
    const digest = this._fs()?.simpleHash?.(JSON.stringify({
      uploads: uploadCandidates.map((item) => [item.name, item.messageId, item.href || '', item.status]),
      generated: generatedCandidates.map((item) => [item.messageId || '', item.sandboxPath || '', item.fileNameHint || ''])
    })) || '';
    return {
      ...base,
      uploadCandidates,
      generatedCandidates,
      uploadDiagnostics,
      generatedDiagnostics,
      conversationUploadDiagnostics: conversationUploadSnapshot.diagnostics || null,
      assetsDigest: digest
    };
  },

  async collectConversationAssets(options = {}) {
    const fs = this._fs();
    if (!fs) return { success: false, savedAssets: [], warnings: ['file_system_unavailable'] };
    const inspected = options.snapshot || await this.inspectConversationAssets(options.conversation || null, {
      includeDiagnostics: this._debugEnabled(options),
      includeConversationApi: options?.historicalProbe === true
    });
    if (!inspected.title) return { success: false, savedAssets: [], warnings: ['missing_title'] };
    const folders = await this._getFolders(inspected.title, inspected.workspace);
    if (!folders) return { success: false, savedAssets: [], warnings: ['folder_not_ready'] };

    if (this._debugEnabled(options)) {
      this._setStatus('loading', '正在补抓历史文件...', options);
      this._log(`开始补抓当前会话历史文件：${inspected.title}`, options);
      const uploadDiagnostics = inspected.uploadDiagnostics || {};
      this._log(
        `上传文件扫描：用户消息 ${Number(uploadDiagnostics.userMessages || 0)} 条，识别候选 ${Number(uploadDiagnostics.totalCandidates || 0)} 个，可下载链接 ${Number(uploadDiagnostics.hrefCandidates || 0)} 个，仅文件名 ${Number(uploadDiagnostics.textOnlyCandidates || 0)} 个`,
        options
      );
      const conversationUploadDiagnostics = inspected.conversationUploadDiagnostics || null;
      if (conversationUploadDiagnostics) {
        this._log(
          `会话接口上传元数据：识别 ${Number(conversationUploadDiagnostics.totalCandidates || 0)} 个，可下载链接 ${Number(conversationUploadDiagnostics.hrefCandidates || 0)} 个，fileId ${Number(conversationUploadDiagnostics.fileIdCandidates || 0)} 个，状态 ${conversationUploadDiagnostics.reason || 'unknown'}`,
          options
        );
      }
      this._logBridgeDiagnostics(inspected.generatedDiagnostics, options);
    }

    const uploadEntries = [];
    const conversationId = this.getConversationId();
    const uploadToken = await this.fetchSessionToken();
    for (let index = 0; index < (inspected.uploadCandidates || []).length; index += 1) {
      const candidate = inspected.uploadCandidates[index];
      this._log(
        `上传候选 ${index + 1}/${inspected.uploadCandidates.length}：${candidate.name || '未知文件'}，messageId=${this._shortId(candidate.messageId)}，source=${candidate.source}${candidate.href ? '，已检测到下载链接' : '，仅识别到文件名'}${candidate.fileId ? `，fileId=${this._shortId(candidate.fileId, 12, 4)}` : ''}`,
        options
      );
      if (!candidate.href) {
        if (!candidate.fileId) {
          this._log(`上传候选 ${index + 1} 无法恢复原文件：页面里只有文件名，没有可下载链接。`, options);
          uploadEntries.push({
            kind: 'upload',
            name: candidate.name,
            mimeType: '',
            size: 0,
            status: 'missing_original',
            savedPath: '',
            source: candidate.source,
            messageId: candidate.messageId,
            collectedAt: new Date().toISOString(),
            error: 'missing_download_link',
            sandboxPath: ''
          });
          continue;
        }
        this._log(`上传候选 ${index + 1} 没有直接下载链接，开始使用 fileId 反查下载源。`, options);
        const probe = await this._probeUploadDownloadByFileId(candidate, {
          ...options,
          token: uploadToken,
          conversationId
        });
        if (!probe.response) {
          this._log(`上传候选 ${index + 1} 无法恢复原文件：页面里只有文件名和 fileId，没有可下载链接。`, options);
          uploadEntries.push({
            kind: 'upload',
            name: candidate.name,
            mimeType: '',
            size: 0,
            status: 'missing_original',
            savedPath: '',
            source: candidate.source,
            messageId: candidate.messageId,
            collectedAt: new Date().toISOString(),
            error: 'missing_download_link_with_file_id',
            sandboxPath: ''
          });
          continue;
        }
        try {
          const blob = await probe.response.blob();
          const saved = await this._saveAssetBlob('upload', inspected.title, inspected.workspace, blob, {
            name: this._responseFileName(probe.response, candidate.name),
            mimeType: blob.type,
            size: blob.size,
            source: `${candidate.source}+${probe.mode}`,
            messageId: candidate.messageId
          });
          if (saved) {
            uploadEntries.push(saved);
            this._log(`上传候选 ${index + 1} 通过 fileId 反查保存成功：${saved.name}（${this._formatBytes(saved.size)}）`, options);
          } else {
            this._log(`上传候选 ${index + 1} 通过 fileId 反查拿到文件，但写入本地失败。`, options);
            uploadEntries.push({
              kind: 'upload',
              name: candidate.name,
              mimeType: '',
              size: 0,
              status: 'missing_original',
              savedPath: '',
              source: candidate.source,
              messageId: candidate.messageId,
              collectedAt: new Date().toISOString(),
              error: 'write_failed',
              sandboxPath: ''
            });
          }
        } catch (error) {
          this._log(`上传候选 ${index + 1} 通过 fileId 反查后处理失败：${error?.message || 'upload_file_id_probe_failed'}`, options);
          uploadEntries.push({
            kind: 'upload',
            name: candidate.name,
            mimeType: '',
            size: 0,
            status: 'missing_original',
            savedPath: '',
            source: candidate.source,
            messageId: candidate.messageId,
            collectedAt: new Date().toISOString(),
            error: error?.message || 'upload_file_id_probe_failed',
            sandboxPath: ''
          });
        }
        continue;
      }
      try {
        const uploadUrl = this._normalizeDirectGeneratedUrl(candidate.href) || candidate.href;
        const response = await fetch(uploadUrl, { credentials: 'include' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const blob = await response.blob();
        const saved = await this._saveAssetBlob('upload', inspected.title, inspected.workspace, blob, {
          name: this._responseFileName(response, candidate.name),
          mimeType: blob.type,
          size: blob.size,
          source: candidate.source,
          messageId: candidate.messageId
        });
        if (saved) {
          uploadEntries.push(saved);
          this._log(`上传候选 ${index + 1} 保存成功：${saved.name}（${this._formatBytes(saved.size)}）`, options);
        } else {
          this._log(`上传候选 ${index + 1} 写入本地失败：目录句柄可用但未返回保存结果。`, options);
          uploadEntries.push({
            kind: 'upload',
            name: candidate.name,
            mimeType: '',
            size: 0,
            status: 'missing_original',
            savedPath: '',
            source: candidate.source,
            messageId: candidate.messageId,
            collectedAt: new Date().toISOString(),
            error: 'write_failed',
            sandboxPath: ''
          });
        }
      } catch (error) {
        this._log(`上传候选 ${index + 1} 下载或写入失败：${error?.message || 'upload_download_failed'}`, options);
        uploadEntries.push({
          kind: 'upload',
          name: candidate.name,
          mimeType: '',
          size: 0,
          status: 'missing_original',
          savedPath: '',
          source: candidate.source,
          messageId: candidate.messageId,
          collectedAt: new Date().toISOString(),
          error: error?.message || 'upload_download_failed',
          sandboxPath: ''
        });
      }
    }

    const uploadIndex = await fs.upsertAssetEntries(inspected.title, inspected.workspace, inspected.url, 'upload', uploadEntries);
    const generatedResult = await this.collectGeneratedFiles({
      conversation: inspected.conversation,
      candidates: inspected.generatedCandidates,
      debug: this._debugEnabled(options)
    });
    const assetIndex = generatedResult.assetIndex || uploadIndex;
    const contextData = await fs.saveConversationContext(inspected.conversation || options.conversation, inspected.workspace, assetIndex);
    const savedUploads = uploadEntries.filter((item) => item.status === 'saved');
    const failedUploads = uploadEntries.filter((item) => item.status !== 'saved');
    const failedGenerated = generatedResult.failed || [];
    if (this._debugEnabled(options)) {
      this._log(
        `历史文件补抓汇总：上传成功 ${savedUploads.length} 个，上传失败 ${failedUploads.length} 个，生成成功 ${(generatedResult.saved || []).length} 个，生成失败 ${failedGenerated.length} 个。`,
        options
      );
    }
    return {
      success: true,
      savedAssets: savedUploads.concat(generatedResult.saved || []),
      warnings: failedUploads.map((item) => item.name).concat(failedGenerated.map((item) => item.name)),
      savedUploads,
      failedUploads,
      savedGenerated: generatedResult.saved || [],
      failedGenerated,
      assetIndex,
      contextData,
      assetsDigest: assetIndex?.summary?.assetsDigest || inspected.assetsDigest || ''
    };
  }
};

if (typeof window !== 'undefined') {
  window.ChatGPTSaver = window.ChatGPTSaver || {};
  window.ChatGPTSaver.ConversationAssets = ConversationAssets;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ConversationAssets };
}
